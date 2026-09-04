#!/bin/sh

# 引入统一目录解析与日志函数；静态检查不会启动容器或拉取镜像。
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

# 记录静态检查失败数量，集中展示所有可修复问题。
FAILURES=0

# 验证必需文件存在且非空。
check_required_file() {
  relative_path=$1
  if [ ! -s "$INFRA_DIR/$relative_path" ]; then
    log_error "缺少必需文件或文件为空：$relative_path"
    FAILURES=$((FAILURES + 1))
  fi
}

# 验证脚本具备可执行权限，避免文档命令在其他开发机直接失败。
check_executable() {
  relative_path=$1
  if [ ! -x "$INFRA_DIR/$relative_path" ]; then
    log_error "脚本缺少可执行权限：$relative_path"
    FAILURES=$((FAILURES + 1))
  fi
}

# 验证 Compose 中包含目标服务且没有超出 MVP 范围的 Redis 服务。
check_compose_contract() {
  for service in postgres minio minio-init mailpit; do
    if ! grep -Eq "^  ${service}:$" "$COMPOSE_FILE"; then
      log_error "Compose 缺少服务：$service"
      FAILURES=$((FAILURES + 1))
    fi
  done
  if grep -Eq '^  redis:$' "$COMPOSE_FILE"; then
    log_error "当前 MVP 不需要 Redis，Compose 不应声明 redis 服务。"
    FAILURES=$((FAILURES + 1))
  fi
}

# 在 Docker 可用时只解析 Compose 配置，不创建网络、卷或容器。
check_compose_syntax() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_info "检测到 Compose v2，正在执行只读配置解析。"
    if ! (cd "$INFRA_DIR" && docker compose -f "$COMPOSE_FILE" config --quiet); then
      log_error "Compose 配置解析失败。"
      FAILURES=$((FAILURES + 1))
    fi
  else
    log_info "未检测到 Compose v2，跳过 docker compose config；其余静态检查继续。"
  fi
}

# 汇总所有检查并以明确退出码报告结果。
main() {
  log_info "开始本地基础设施静态检查，不会启动容器或拉取镜像。"
  for file in docker-compose.yml .env.example README.md postgres/initdb/001-bootstrap.sql postgres/migrations/0001-infrastructure-baseline.sql; do
    check_required_file "$file"
  done
  for script in scripts/start.sh scripts/stop.sh scripts/check.sh scripts/test.sh; do
    check_required_file "$script"
    check_executable "$script"
    sh -n "$INFRA_DIR/$script" || FAILURES=$((FAILURES + 1))
  done
  check_compose_contract
  check_compose_syntax
  if [ "$FAILURES" -ne 0 ]; then
    log_error "静态检查失败，共发现 $FAILURES 个问题。"
    return 1
  fi
  log_info "静态检查通过。"
}

main "$@"
