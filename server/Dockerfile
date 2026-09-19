# Taskira API. Двухступенчатая сборка: tsc в builder, тонкий рантайм без
# devDependencies и без исходников — только dist/ + migrations/ + package.json.
#
# Собирать из ЭТОЙ папки (server/), контекст — server/.dockerignore:
#   docker build -t taskira-server -f server/Dockerfile server
# Обычно через docker-compose.yml в корне репозитория (build.context: ./server).

ARG TASKIRA_VERSION=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ARG TASKIRA_VERSION
WORKDIR /app
ENV NODE_ENV=production
ENV TASKIRA_VERSION=$TASKIRA_VERSION
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# STORAGE_DRIVER=local (по умолчанию) пишет сюда — см. docker-compose.yml,
# том storage-data монтируется в этот же путь. Владелец — не root (образ
# node:*-alpine уже создаёт uid/gid 1000 "node").
RUN mkdir -p /app/var/attachments && chown -R node:node /app
USER node

EXPOSE 8080
# initPool → migrate() → seedAdmin/seedProject → listen — всё в index.ts,
# отдельного entrypoint-скрипта не нужно (см. src/index.ts).
CMD ["node", "dist/index.js"]
