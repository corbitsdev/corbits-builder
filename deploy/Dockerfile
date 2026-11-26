ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d

FROM ${BUN_IMAGE} AS source
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY plugins ./plugins
COPY workflows ./workflows
COPY vendor/interchange/package.json vendor/interchange/tsconfig.json vendor/interchange/tsconfig.base.json vendor/interchange/bunfig.toml ./vendor/interchange/
COPY vendor/interchange/packages ./vendor/interchange/packages
COPY vendor/interchange/apps/sidecar ./vendor/interchange/apps/sidecar

FROM source AS install
RUN bun install --frozen-lockfile

# The hub and sidecar run on production dependencies only; build and dev tools stay in install.
# better-auth lists drizzle-kit as an optional peer, so a production install still links it and
# its esbuild binaries. Only migration generation uses them, and nothing at runtime imports them.
FROM source AS deps
RUN bun install --frozen-lockfile --production \
 && rm -rf node_modules/.bun/drizzle-kit@* node_modules/.bun/esbuild@* \
      node_modules/.bun/esbuild-register@* node_modules/.bun/@esbuild+* node_modules/.bun/@esbuild-kit+*

FROM install AS web
RUN bun run --cwd apps/web build

# What a sidecar's coder and designer run beside Bun: bubblewrap and socat for the sandbox
# (@anthropic-ai/sandbox-runtime on Linux), unzip for the Chrome headless shell the sidecar
# fetches, the libraries and font that shell loads, ps for the hub's sidecar lookup, and git for
# the hub reading each run's committed conversation.
FROM ${BUN_IMAGE} AS runtime
ARG RUNTIME_CACHE_ID
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends \
      bubblewrap \
      git \
      socat \
      unzip \
      procps \
      fonts-liberation \
      libasound2t64 \
      libatk-bridge2.0-0t64 \
      libatk1.0-0t64 \
      libatspi2.0-0t64 \
      libdbus-1-3 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0t64 \
      libnspr4 \
      libnss3 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

# Docker sidecars load the hub's inference adapters at the paths the hub resolves them to,
# so this image keeps the hub's /app layout.
FROM runtime AS sidecar
WORKDIR /app
COPY --from=deps --chown=bun:bun /app/package.json ./
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/apps/hub ./apps/hub
COPY --from=deps --chown=bun:bun /app/packages ./packages
COPY --from=deps --chown=bun:bun /app/vendor/interchange ./vendor/interchange
RUN mkdir -p /data && chown bun:bun /data
USER bun
WORKDIR /app/vendor/interchange
ENV SIDECAR_DATA_DIR=/data HOME=/data
CMD ["bun", "--no-env-file", "--conditions=intx-src", "apps/sidecar/src/index.ts"]

FROM runtime AS hub
WORKDIR /app
COPY --from=deps --chown=bun:bun /app/package.json /app/bun.lock /app/tsconfig.json ./
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/apps/hub ./apps/hub
COPY --from=web --chown=bun:bun /app/apps/web/dist ./apps/web/dist
COPY --from=deps --chown=bun:bun /app/packages ./packages
COPY --from=deps --chown=bun:bun /app/plugins ./plugins
COPY --from=deps --chown=bun:bun /app/workflows ./workflows
COPY --from=deps --chown=bun:bun /app/vendor/interchange ./vendor/interchange
RUN mkdir -p /app/data/hub && chown -R bun:bun /app/data
USER bun
ENV HOST=0.0.0.0 PORT=8000 HUB_DATA_DIR=/app/data/hub HUB_WEB_DIR=/app/apps/web/dist
EXPOSE 8000
# ChatGPT (1455) and xAI (1456) send a subscription login back to a fixed localhost port, where the
# hub listens on loopback only. socat carries the published port from the container's address to it.
CMD ["sh", "-c", "ip=$(hostname -i | cut -d' ' -f1); for port in 1455 1456; do socat TCP-LISTEN:$port,bind=$ip,fork,reuseaddr TCP:127.0.0.1:$port & done; bun --no-env-file --conditions=intx-src apps/hub/src/migrate.ts && exec bun --no-env-file --conditions=intx-src apps/hub/src/server.ts"]
