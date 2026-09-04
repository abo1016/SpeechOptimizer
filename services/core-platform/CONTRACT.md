# Core Platform Contract

更新日期：2026-09-01

## 1. 模块职责

`core-platform` 负责分析任务、幂等、状态机、本地业务持久化、音频对象生命周期和审计事件。它不负责登录令牌解析、STT/LLM 供应商实现、计费或前端状态。

## 2. 嵌入式接口

通过 `createCorePlatform(options)` 创建服务。必须注入：

```js
const speechProcessor = {
  async transcribe({ analysisId, bytes, media }) {},
  async analyze({ analysisId, transcript }) {},
};
```

- `transcribe` 返回可持久化的结构化转写结果。
- `analyze` 返回可持久化的指标和建议。
- 两个端口均不得自行修改核心任务状态。
- 临时错误应携带 `code` 和 `retryable: true`；日志不得记录 `bytes` 或完整 `transcript`。

可选注入项：

- `durationResolver({ bytes, mime })`：为 MP3、M4A、WebM 返回真实媒体时长毫秒数。默认实现只内建精确 WAV 时长解析，未配置时拒绝其他容器，而不是信任客户端时长。
- `database`、`repository`、`objectStore`、`mediaInspector`：用于替换本地适配器。
- `clock`：持久化时间源，便于确定性测试。
- `logger`：应遵守安全字段白名单；默认日志器会丢弃内容字段。

核心方法：

- `createAnalysis({ idempotencyKey, owner, retainAudio })`
- `getAnalysis({ analysisId, actor })`
- `uploadAudio({ analysisId, actor, bytes })`
- `runAnalysis({ analysisId, actor })`
- `retryAnalysis({ analysisId, actor })`
- `cancelAnalysis({ analysisId, actor })`
- `deleteAnalysis({ analysisId, actor })`
- `deleteAccount({ accountId, actor })`
- `listAudits({ analysisId, actor })`

`owner`/`actor` 结构为 `{ type: "anonymous" | "account", id: string }`。匿名 ID 应由上游签名会话生成，不能直接信任浏览器自由填写。

## 3. HTTP Contract

`createHttpServer` 是薄适配层，必须注入 `identityResolver(request)`。解析 Cookie、Bearer Token、Google OAuth 或 Magic Link 都属于账户模块职责。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/health` | 无认证健康检查 |
| `POST` | `/v1/analyses` | 创建任务；必须带 `Idempotency-Key` |
| `GET` | `/v1/analyses/:id` | 刷新后恢复任务与结果 |
| `PUT` | `/v1/analyses/:id/audio` | 上传原始二进制；忽略客户端 MIME |
| `POST` | `/v1/analyses/:id/run` | 执行本地处理，成功返回最终任务 |
| `POST` | `/v1/analyses/:id/retry` | 重试保留音频的失败任务 |
| `POST` | `/v1/analyses/:id/cancel` | 取消任务并删除音频 |
| `DELETE` | `/v1/analyses/:id` | 删除单次分析及音频 |
| `GET` | `/v1/analyses/:id/audits` | 查询该任务最小审计事件 |
| `DELETE` | `/v1/accounts/:id` | 账户级核心数据级联删除 |

错误体固定包含 `code`，业务错误使用明确的 4xx；未知异常只返回 `INTERNAL_ERROR`。

## 4. 状态与恢复

```text
created -> uploaded -> transcribing -> analyzing -> completed
   |          |             |             |
   +----------+-------------+-------------+-> cancelled
              +-------------+-------------+-> failed -> uploaded (retry)
```

- 幂等创建在相同 owner、幂等键和参数下返回原任务；参数变化返回 `409 IDEMPOTENCY_CONFLICT`。
- 任务和对象均落本地磁盘；新进程使用相同配置目录即可恢复查询和重试。
- `runAnalysis` 同步等待注入端口完成；生产队列应调用同一服务方法，不能绕开状态机直接改库。

## 5. 隐私与删除

- 匿名任务完成前必须成功删除原始音频，否则不能进入 `completed`。
- 注册账户默认同样删除音频；只有该次创建明确 `retainAudio: true` 才保留。
- 取消、删除单次分析和账户级删除同步清理对象；账户级删除还会清除关联审计标识。
- 审计只保存 ID、动作、状态和时间，不保存音频、完整转写、报告内容或密钥。
- 本地 JSON 适配器仅支持单进程串行写；多实例部署必须替换为事务数据库。

## 6. 配置

配置由 `src/config.js` 集中定义并带中文注释：

- `rootDirectory`：本地持久化根目录。
- `databaseFile`：JSON 数据库文件或数据库目录。
- `objectDirectory`：音频对象目录或对象目录根路径。
- `maxAudioBytes`：音频字节上限。
- `minDurationMs` / `maxDurationMs`：服务端媒体时长边界。
