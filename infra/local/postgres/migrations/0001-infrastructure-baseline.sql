-- SpeechOptimizer 基础设施基线迁移。
-- 当前迁移刻意不创建用户、分析、计费等领域表，避免在领域契约确认前固化 schema。

-- 遇到 SQL 错误立即停止，保证迁移登记具有原子性。
\set ON_ERROR_STOP on

BEGIN;

-- 记录本地基础设施基线；重复执行时保持幂等。
INSERT INTO infra.schema_migrations (version, description)
VALUES ('0001', '初始化本地 PostgreSQL 扩展、schema 与迁移登记表')
ON CONFLICT (version) DO NOTHING;

COMMIT;
