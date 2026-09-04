# SpeechOptimizer MVP API 生产容器。
# 构建上下文必须是仓库根目录，因为 mvp-server 当前直接复用 packages/ 与 services/ 的源码模块。
FROM node:24-bookworm-slim

# ffprobe 由 ffmpeg 软件包提供，用于服务端校验非 WAV 音频真实时长；ca-certificates 用于外部 HTTPS Provider。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# 固定 pnpm 版本，保证容器依赖解析与 CI 使用同一主版本，不在构建时漂移到 latest。
RUN npm install --global pnpm@11.25.0

WORKDIR /app

# 先复制依赖清单以复用 Docker layer cache；当前只有 mvp-server 存在运行时第三方依赖。
COPY apps/mvp-server/package.json apps/mvp-server/pnpm-lock.yaml ./apps/mvp-server/
RUN pnpm --dir apps/mvp-server install --prod --frozen-lockfile

# 仅复制运行时需要的源码，测试、本地数据、文档和构建缓存均不进入生产镜像。
COPY apps/mvp-server/src ./apps/mvp-server/src
COPY services/core-platform/package.json ./services/core-platform/package.json
COPY services/core-platform/src ./services/core-platform/src
COPY services/account-billing/package.json ./services/account-billing/package.json
COPY services/account-billing/src ./services/account-billing/src
COPY services/account-billing/fixtures ./services/account-billing/fixtures
COPY packages/speech-engine/package.json ./packages/speech-engine/package.json
COPY packages/speech-engine/src ./packages/speech-engine/src
COPY packages/provider-adapters/package.json ./packages/provider-adapters/package.json
COPY packages/provider-adapters/src ./packages/provider-adapters/src

WORKDIR /app/apps/mvp-server

# 生产容器监听所有网卡，由托管平台注入 PORT；数据目录必须挂载持久卷或后续迁移到远程存储。
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    MVP_DATA_DIRECTORY=/var/lib/speechoptimizer

EXPOSE 8787

# 数据目录由 Railway 卷挂载；镜像不声明 VOLUME，因为 Railway 构建器不支持该指令。

# 只验证应用自身健康端点，不访问外部 Provider，避免第三方波动导致容器被错误重启。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8787') + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
