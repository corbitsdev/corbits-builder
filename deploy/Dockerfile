ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d

FROM ${BUN_IMAGE} AS install
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY workflows ./workflows
COPY vendor/interchange/package.json vendor/interchange/tsconfig.json vendor/interchange/tsconfig.base.json vendor/interchange/bunfig.toml ./vendor/interchange/
COPY vendor/interchange/packages ./vendor/interchange/packages
COPY vendor/interchange/apps/sidecar ./vendor/interchange/apps/sidecar
RUN bun install --frozen-lockfile

FROM install AS web
RUN bun run --cwd apps/web build

# What a sidecar's coder and designer run beside Bun: bubblewrap and socat for the sandbox
# (@anthropic-ai/sandbox-runtime on Linux), unzip for the Chrome headless shell the sidecar
# fetches, the libraries and font that shell loads, ps for the hub's sidecar lookup, and git for
# the hub reading each run's committed conversation.
FROM ${BUN_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bubblewrap=0.12.0-1~deb13u1 \
      git=1:2.47.3-0+deb13u1 \
      socat=1.8.0.3-1+deb13u1 \
      unzip=6.0-29+deb13u1 \
      procps=2:4.0.4-9 \
      fonts-liberation=1:2.1.5-3 \
      libasound2t64=1.2.14-1+deb13u1 \
      libatk-bridge2.0-0t64=2.56.2-1+deb13u2 \
      libatk1.0-0t64=2.56.2-1+deb13u2 \
      libatspi2.0-0t64=2.56.2-1+deb13u2 \
      libdbus-1-3=1.16.2-2 \
      libexpat1=2.9.0-1~deb13u1 \
      libgbm1=25.0.7-2+deb13u1 \
      libglib2.0-0t64=2.84.4-3~deb13u5 \
      libnspr4=2:4.36-1 \
      libnss3=2:3.110-1+deb13u4 \
      libx11-6=2:1.8.12-1 \
      libxcb1=1.17.0-2+b1 \
      libxcomposite1=1:0.4.6-1 \
      libxdamage1=1:1.1.6-1+b2 \
      libxext6=2:1.3.4-1+b3 \
      libxfixes3=1:6.0.0-2+b4 \
      libxkbcommon0=1.7.0-2 \
      libxrandr2=2:1.5.4-1+b3 \
 && rm -rf /var/lib/apt/lists/*

# Docker sidecars load the hub's inference adapters at the paths the hub resolves them to,
# so this image keeps the hub's /app layout.
FROM runtime AS sidecar
WORKDIR /app
COPY --from=install --chown=bun:bun /app/package.json ./
COPY --from=install --chown=bun:bun /app/node_modules ./node_modules
COPY --from=install --chown=bun:bun /app/apps/hub ./apps/hub
COPY --from=install --chown=bun:bun /app/packages ./packages
COPY --from=install --chown=bun:bun /app/vendor/interchange ./vendor/interchange
RUN mkdir -p /data && chown bun:bun /data
USER bun
WORKDIR /app/vendor/interchange
ENV SIDECAR_DATA_DIR=/data HOME=/data
CMD ["bun", "--no-env-file", "--conditions=intx-src", "apps/sidecar/src/index.ts"]

FROM runtime AS hub
WORKDIR /app
COPY --from=install --chown=bun:bun /app/package.json /app/bun.lock /app/tsconfig.json ./
COPY --from=install --chown=bun:bun /app/node_modules ./node_modules
COPY --from=install --chown=bun:bun /app/apps/hub ./apps/hub
COPY --from=web --chown=bun:bun /app/apps/web/dist ./apps/web/dist
COPY --from=install --chown=bun:bun /app/packages ./packages
COPY --from=install --chown=bun:bun /app/workflows ./workflows
COPY --from=install --chown=bun:bun /app/vendor/interchange ./vendor/interchange
RUN mkdir -p /app/data/hub && chown -R bun:bun /app/data
USER bun
ENV HOST=0.0.0.0 PORT=8000 HUB_DATA_DIR=/app/data/hub HUB_WEB_DIR=/app/apps/web/dist
EXPOSE 8000
# ChatGPT (1455) and xAI (1456) send a subscription login back to a fixed localhost port, where the
# hub listens on loopback only. socat carries the published port from the container's address to it.
CMD ["sh", "-c", "ip=$(hostname -i | cut -d' ' -f1); for port in 1455 1456; do socat TCP-LISTEN:$port,bind=$ip,fork,reuseaddr TCP:127.0.0.1:$port & done; bun --no-env-file --conditions=intx-src apps/hub/src/migrate.ts && exec bun --no-env-file --conditions=intx-src apps/hub/src/server.ts"]
