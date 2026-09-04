#!/bin/sh

# 引入统一目录解析与日志函数；测试只读取文件，不启动容器。
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

# 记录语义测试失败数量，便于一次修复多个配置问题。
FAILURES=0

# 断言文件包含给定固定文本，避免正则转义造成误判。
assert_contains() {
  relative_path=$1
  expected=$2
  description=$3
  if ! grep -Fq -- "$expected" "$INFRA_DIR/$relative_path"; then
    log_error "测试失败：$description"
    FAILURES=$((FAILURES + 1))
  fi
}

# 校验安全边界、健康检查与初始化契约。
run_contract_tests() {
  assert_contains docker-compose.yml 'condition: service_healthy' "MinIO 初始化任务必须等待对象存储健康"
  assert_contains docker-compose.yml 'mc mb --ignore-existing' "MinIO 建桶操作必须幂等"
  assert_contains docker-compose.yml 'mc anonymous set none' "音频桶必须保持私有"
  assert_contains docker-compose.yml 'pg_isready' "PostgreSQL 必须声明健康检查"
  assert_contains docker-compose.yml '/mailpit", "readyz' "Mailpit 必须声明健康检查"
  assert_contains .env.example 'DATABASE_URL=postgresql://' "必须提供标准 PostgreSQL 连接串"
  assert_contains .env.example 'S3_FORCE_PATH_STYLE=true' "本地 MinIO 必须启用路径风格寻址"
  assert_contains postgres/initdb/001-bootstrap.sql 'CREATE TABLE IF NOT EXISTS infra.schema_migrations' "必须创建迁移登记表"
  assert_contains postgres/initdb/001-bootstrap.sql 'current_database()' "初始化 SQL 必须兼容自定义数据库名称"
  assert_contains postgres/migrations/0001-infrastructure-baseline.sql 'ON CONFLICT (version) DO NOTHING' "基线迁移必须可重复执行"
}

# 先运行静态门禁，再执行基础设施语义断言。
main() {
  log_info "开始运行本地基础设施测试。"
  "$INFRA_DIR/scripts/check.sh"
  run_contract_tests
  if [ "$FAILURES" -ne 0 ]; then
    log_error "基础设施测试失败，共发现 $FAILURES 个问题。"
    return 1
  fi
  log_info "基础设施测试通过。"
}

main "$@"
