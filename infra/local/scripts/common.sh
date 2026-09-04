#!/bin/sh

# 所有本地基础设施脚本共用严格模式，任何未处理错误都会立即停止。
set -eu

# 计算脚本所在的基础设施根目录，避免依赖调用者当前工作目录。
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

# 输出带时间戳和统一前缀的普通运行日志。
log_info() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "[infra] $*"
}

# 输出错误日志到标准错误，便于 CI 或调用脚本准确捕获失败原因。
log_error() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "[infra][错误] $*" >&2
}

# 验证 Docker CLI 与 Compose 子命令存在，但不会连接守护进程或启动容器。
require_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    log_error "未找到 Docker CLI，请先安装 Docker Desktop 或兼容运行时。"
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log_error "未找到 docker compose 子命令，请安装 Compose v2。"
    return 1
  fi
}

# 在基础设施目录执行 Compose，确保相对挂载路径和 .env 解析一致。
run_compose() {
  command_name=$1
  shift
  (cd "$INFRA_DIR" && docker compose -f "$COMPOSE_FILE" "$command_name" "$@")
}
