# Production image of Loophole: the HTTP API, which also serves the built web app, and the job
# worker, chosen by the command (compose.prod.yml). Build from the repo root:
#   docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t loophole .

# All dependencies, for building the web app.
FROM oven/bun:1.3.13-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# The static web app (apps/web/build).
FROM deps AS web
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN bun run --cwd apps/web build

# What runs: production dependencies, the server and core sources, and the built web app.
FROM oven/bun:1.3.13-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production
COPY tsconfig.base.json ./
COPY packages/core/src packages/core/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY --from=web /app/apps/web/build apps/web/build
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/loophole.sqlite \
    WEB_DIR=apps/web/build
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/src/api/main.ts"]
