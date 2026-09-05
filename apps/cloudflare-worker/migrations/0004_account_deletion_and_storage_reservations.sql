-- 账户删除先禁用登录与写入，再由请求或 Cron 重试清理对象；未完成清理不会删除 D1 事实记录。
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;

-- 每个分析任务最多持有一个存储预占。reserved 和 confirmed 都计入全局存储上限，避免签名 URL 并发越界。
CREATE TABLE IF NOT EXISTS storage_reservations (
  analysis_id TEXT PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved', 'confirmed', 'released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS storage_reservations_status_updated_idx
  ON storage_reservations(status, updated_at);
CREATE INDEX IF NOT EXISTS users_deletion_requested_idx
  ON users(status, deletion_requested_at) WHERE status = 'disabled';

-- 已有上传记录在升级后直接标记为 confirmed，保证后续清理可以统一释放其容量计数。
INSERT OR IGNORE INTO storage_reservations(analysis_id, bytes, status, created_at, updated_at)
SELECT id, audio_size, 'confirmed', updated_at, updated_at
FROM analyses
WHERE audio_key IS NOT NULL AND audio_size IS NOT NULL AND audio_size > 0;

-- limit_value 让条件递增受 SQLite CHECK 约束保护；约束失败会回滚同一 D1 batch 内的任务、幂等键和审计事件。
ALTER TABLE quota_counters ADD COLUMN limit_value INTEGER
  CHECK(limit_value IS NULL OR value <= limit_value);

-- 初始值取历史计数与已知音频大小的较大值，宁可暂时保守拒绝也不能在升级时低估实际占用。
INSERT INTO quota_counters(metric, period_key, value, updated_at, limit_value)
SELECT 'storage-bytes', 'current', COALESCE(SUM(bytes), 0), CURRENT_TIMESTAMP, NULL
FROM storage_reservations
WHERE 1
ON CONFLICT(metric, period_key) DO UPDATE SET value=MAX(value, excluded.value), updated_at=excluded.updated_at;

-- 禁用账户后，任何并发登录、创建任务或继续预占上传容量都会由 D1 拒绝。
CREATE TRIGGER IF NOT EXISTS sessions_require_active_user
BEFORE INSERT ON sessions
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND status = 'active' AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DISABLED');
END;

CREATE TRIGGER IF NOT EXISTS account_analyses_require_active_user
BEFORE INSERT ON analyses
WHEN NEW.owner_type = 'account'
  AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id AND status = 'active' AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DISABLED');
END;

CREATE TRIGGER IF NOT EXISTS storage_reservations_require_active_user
BEFORE INSERT ON storage_reservations
WHEN EXISTS (SELECT 1 FROM analyses WHERE id = NEW.analysis_id AND owner_type = 'account')
  AND NOT EXISTS (
    SELECT 1 FROM analyses a JOIN users u ON u.id = a.owner_id
    WHERE a.id = NEW.analysis_id AND u.status = 'active' AND u.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DISABLED');
END;

-- uploaded 只能在已确认容量预占后落库，杜绝绕过签发或重复完成请求留下未计数音频。
CREATE TRIGGER IF NOT EXISTS uploaded_analysis_requires_confirmed_reservation
BEFORE UPDATE OF status ON analyses
WHEN NEW.status = 'uploaded' AND OLD.status = 'created'
  AND NOT EXISTS (
    SELECT 1 FROM storage_reservations
    WHERE analysis_id = NEW.id AND status = 'confirmed' AND bytes = NEW.audio_size
  )
BEGIN
  SELECT RAISE(ABORT, 'STORAGE_RESERVATION_REQUIRED');
END;

-- 释放预占只在状态首次变为 released 时扣减一次，因此重复删除和 Cron 重试都不会双重回收容量。
CREATE TRIGGER IF NOT EXISTS released_storage_reservation_updates_counter
AFTER UPDATE OF status ON storage_reservations
WHEN OLD.status != 'released' AND NEW.status = 'released'
BEGIN
  UPDATE quota_counters
  SET value = MAX(0, value - NEW.bytes), updated_at = NEW.updated_at
  WHERE metric = 'storage-bytes' AND period_key = 'current';
END;

-- 只有对象 Provider 删除成功后应用才会清空 audio_key；该状态变化触发一次幂等释放。
CREATE TRIGGER IF NOT EXISTS cleared_audio_key_releases_reservation
AFTER UPDATE OF audio_key ON analyses
WHEN OLD.audio_key IS NOT NULL AND NEW.audio_key IS NULL
BEGIN
  UPDATE storage_reservations SET status='released', updated_at=NEW.updated_at
  WHERE analysis_id=NEW.id AND status!='released';
END;
