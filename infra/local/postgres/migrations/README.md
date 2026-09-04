# PostgreSQL 迁移目录

此目录保存 SpeechOptimizer 的顺序 SQL 迁移。当前 `0001` 只登记基础设施基线，不定义用户、分析、计费等领域表；领域 schema 应在服务契约稳定并选定迁移工具后补充。

## 约定

- 文件名使用四位递增版本，例如 `0002-create-analysis.sql`。
- 每个迁移默认使用事务，并设置 `\set ON_ERROR_STOP on`。
- 已发布迁移不得改写；需要修正时新增后续版本。
- SQL 必须可审查、避免拼接不可信输入，并为非显然操作添加中文注释。
- `docker-compose.yml` 只挂载 `0001` 作为全新数据卷的基线；后续版本由正式迁移命令执行。

## 本地重建说明

首次启动 PostgreSQL 时，Docker 官方入口会依次执行 `initdb/001-bootstrap.sql` 与 `0001-infrastructure-baseline.sql`。已有 `postgres_data` 卷不会自动重放脚本，避免意外覆盖开发数据。
