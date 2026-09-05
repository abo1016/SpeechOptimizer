-- 将签发中的对象与已确认音频分开保存：created 状态只能复用同一对象 key，防止重复申请 URL 产生无计数的孤儿对象。
ALTER TABLE analyses ADD COLUMN upload_object_key TEXT;
ALTER TABLE analyses ADD COLUMN upload_size INTEGER;
ALTER TABLE analyses ADD COLUMN upload_mime TEXT;
ALTER TABLE analyses ADD COLUMN upload_sha256 TEXT;
ALTER TABLE analyses ADD COLUMN upload_issued_at TEXT;

-- uploaded 是 D1 持久化 outbox 状态。Cron 可通过此索引补投 Queue.send 失败后遗留的任务，不依赖请求重试。
CREATE INDEX IF NOT EXISTS analyses_uploaded_dispatch_idx
  ON analyses(status, updated_at ASC, id ASC);

-- 旧实现错误地把每个预占按 1 计入 storage-bytes；迁移时按仍有效的 reservation 字节数重建当前硬护栏。
UPDATE quota_counters
SET value = COALESCE((
  SELECT SUM(bytes)
  FROM storage_reservations
  WHERE status IN ('reserved', 'confirmed')
), 0), updated_at = CURRENT_TIMESTAMP
WHERE metric = 'storage-bytes' AND period_key = 'current';
