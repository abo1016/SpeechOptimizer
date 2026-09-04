#!/bin/sh

# 引入统一目录解析、日志与 Compose 检查函数。
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

# 在执行任何容器操作前确认本机具备 Compose v2。
require_compose

log_info "正在启动 PostgreSQL、MinIO、MinIO 初始化任务与 Mailpit。"
run_compose up -d --wait

log_info "本地基础设施已健康：PostgreSQL localhost:${POSTGRES_PORT:-5432}。"
log_info "MinIO API http://localhost:${MINIO_API_PORT:-9000}，控制台 http://localhost:${MINIO_CONSOLE_PORT:-9001}。"
log_info "Mailpit SMTP localhost:${MAILPIT_SMTP_PORT:-1025}，Web http://localhost:${MAILPIT_WEB_PORT:-8025}。"
