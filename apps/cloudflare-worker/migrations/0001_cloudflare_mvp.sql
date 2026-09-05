PRAGMA foreign_keys = ON;

-- 用户只保存认证和产品偏好需要的最小字段，邮箱使用规范化值保证跨 Provider 唯一。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  provider_subject TEXT,
  retain_audio INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS users_provider_subject_idx
  ON users(provider, provider_subject) WHERE provider_subject IS NOT NULL;

-- Session、Magic Link 与 OAuth state 均只保存摘要，不把 bearer token 明文落入 D1。
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anonymous_trials (
  anonymous_id TEXT PRIMARY KEY,
  consumed_at TEXT NOT NULL,
  analysis_id TEXT
);

-- analyses 是任务事实源；状态与 attempt 通过条件 UPDATE 推进，避免重复 Queue 消息重复执行。
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('anonymous', 'account')),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  retain_audio INTEGER NOT NULL DEFAULT 0,
  audio_key TEXT,
  audio_size INTEGER,
  audio_mime TEXT,
  audio_duration_ms INTEGER,
  audio_etag TEXT,
  result_json TEXT,
  error_code TEXT,
  error_retryable INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS analyses_owner_created_idx
  ON analyses(owner_type, owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_type, owner_id, key_hash)
);

CREATE TABLE IF NOT EXISTS analysis_events (
  event_id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analysis_events_analysis_idx
  ON analysis_events(analysis_id, created_at);

-- 免费 Beta 仍保留最小权益流水，保证匿名/注册配额扣减在重复消息下可审计且幂等。
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  units INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  units INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(analysis_id, attempt)
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_id TEXT,
  entry_type TEXT NOT NULL,
  units INTEGER NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider, event_id)
);

-- 每日护栏在应用层先占用计数；主键确保跨实例下仍由 D1 串行化同一指标。
CREATE TABLE IF NOT EXISTS quota_counters (
  metric TEXT NOT NULL,
  period_key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(metric, period_key)
);
