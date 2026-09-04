# SpeechOptimizer 本地基础设施

此目录提供 MVP 当前需要的本地依赖：PostgreSQL、MinIO 和 Mailpit。Redis 暂无已确认的运行时需求，因此不在编排中。

## 服务与地址

| 服务 | 默认地址 | 用途 |
| --- | --- | --- |
| PostgreSQL 16 | `localhost:5432` | 账户、分析、权益与计费等后续持久化 |
| MinIO S3 API | `http://localhost:9000` | 私有音频对象存储 |
| MinIO 控制台 | `http://localhost:9001` | 本地对象检查与调试 |
| Mailpit SMTP | `localhost:1025` | 捕获 Magic Link 与通知邮件 |
| Mailpit Web | `http://localhost:8025` | 浏览本地捕获邮件 |

默认凭证仅用于隔离的本地开发环境。生产环境必须使用独立密钥、最小权限账号、TLS、备份和受控网络，不能直接复用本目录默认值。

## 使用方式

1. 可选地将 `.env.example` 复制为同目录 `.env` 并修改端口或本地凭证。
2. 运行 `./scripts/check.sh` 做静态检查；该命令不会启动容器或拉取镜像。
3. 运行 `./scripts/start.sh` 启动依赖并等待健康检查通过。
4. 在 `http://localhost:9001` 查看 MinIO，或在 `http://localhost:8025` 查看测试邮件。
5. 运行 `./scripts/stop.sh` 停止容器并保留命名卷数据。

首次启动时，PostgreSQL 会执行 `postgres/initdb/001-bootstrap.sql` 和基线迁移；MinIO 初始化任务会幂等创建 `.env` 中 `MINIO_BUCKET` 指定的私有桶。

## 应用连接契约

应用可从 `.env.example` 使用以下标准变量：

- `DATABASE_URL`：PostgreSQL 连接串。
- `S3_ENDPOINT`、`S3_REGION`、`S3_FORCE_PATH_STYLE`：S3 兼容端点配置。
- `MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD`、`MINIO_BUCKET`：本地 Access Key、Secret Key 与桶名。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`MAIL_FROM`：本地邮件发送配置。

当前账户服务仍使用内存邮件捕获适配器；本目录只建立后续 SMTP 适配器需要遵循的协议边界，不修改服务实现。

## 数据与重置

`stop.sh` 不删除数据。若确实需要完全重置本地开发数据，请先确认不再需要数据库、音频对象和捕获邮件，再在本目录手动执行 `docker compose down --volumes`。该破坏性命令不会封装进脚本，避免误删。

PostgreSQL 官方入口只在全新 `postgres_data` 卷上执行初始化 SQL。新增迁移后应使用项目最终选定的迁移工具显式执行，不能依赖重建数据卷作为常规升级方式。

## 验证边界

`./scripts/test.sh` 会执行 shell 语法、文件完整性、Compose 服务范围、健康检查、私有桶和迁移幂等性等静态断言。若本机存在 Docker Compose v2，还会调用 `docker compose config --quiet` 解析配置，但仍不会连接并启动任何服务。

本轮按约束不拉取镜像、不启动容器，因此只有静态配置证据；真实健康检查、持久化和端到端连接需要在允许启动 Docker 后另行验收。
