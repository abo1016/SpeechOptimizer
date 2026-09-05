-- 复合游标按 created_at 与 id 同时排序，防止同一时间戳的 150+ 条账户分析在分页删除时遗漏。
CREATE INDEX IF NOT EXISTS analyses_owner_created_id_idx
  ON analyses(owner_type, owner_id, created_at DESC, id DESC);

-- Cron 会按过期时间清理短期认证记录和事件；索引使清理不需要扫描整张 D1 表。
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS magic_links_expires_at_idx ON magic_links(expires_at);
CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS analysis_events_created_at_idx ON analysis_events(created_at);
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events(received_at);
