#!/bin/sh

# 引入统一目录解析、日志与 Compose 检查函数。
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

# 在执行任何容器操作前确认本机具备 Compose v2。
require_compose

log_info "正在停止本地基础设施；命名卷中的开发数据将被保留。"
run_compose down --remove-orphans
log_info "本地基础设施已停止。"
