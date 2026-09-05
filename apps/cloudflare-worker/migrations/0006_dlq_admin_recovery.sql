-- Queue 最终投递失败不能只留在 Cloudflare DLQ；D1 是后台恢复和失败原因展示的业务事实源。
ALTER TABLE analyses ADD COLUMN failure_stage TEXT;
ALTER TABLE analyses ADD COLUMN failed_at TEXT;

-- 管理员仅查询 failed 状态，并沿创建时间做稳定分页；索引避免免费层上扫描完整 analyses 表。
CREATE INDEX IF NOT EXISTS analyses_failed_admin_created_idx
  ON analyses(status, created_at DESC, id DESC);
