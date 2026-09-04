-- SpeechOptimizer 本地 PostgreSQL 首次启动初始化脚本。
-- Docker 官方镜像只会在全新数据卷上执行本目录脚本，已有数据卷不会重复执行。

-- 遇到 SQL 错误立即停止，避免留下部分初始化成功的数据库状态。
\set ON_ERROR_STOP on

-- pgcrypto 为后续 UUID 和安全随机值提供 PostgreSQL 原生能力。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext 为登录邮箱等大小写不敏感字段提供明确的数据类型。
CREATE EXTENSION IF NOT EXISTS citext;

-- app schema 隔离产品业务表，避免把业务对象直接放入 public schema。
CREATE SCHEMA IF NOT EXISTS app;

-- infra schema 只保存迁移登记等基础设施元数据。
CREATE SCHEMA IF NOT EXISTS infra;

-- 迁移登记表记录已应用版本；正式服务接入后可由选定迁移工具接管。
CREATE TABLE IF NOT EXISTS infra.schema_migrations (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- 根据当前连接动态生成角色和数据库标识符，兼容 .env 自定义名称并避免 SQL 注入。
SELECT format(
  'ALTER ROLE %I IN DATABASE %I SET search_path TO app, public',
  current_user,
  current_database()
) \gexec
