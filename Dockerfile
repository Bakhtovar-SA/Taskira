# Taskira client. Статическая SPA — сборка Vite, раздаёт nginx.
# Pathname-маршруты (/p/:key/...) требуют try_files → index.html:
# без SPA fallback прямые ссылки и обновление страницы вернут 404.
#
# По умолчанию клиент использует свой origin, а nginx проксирует /api к server.
# VITE_API_URL нужен только для legacy-развёртывания с API на другом origin.
#
#   docker build -t taskira-client --build-arg VITE_API_URL=https://api.example.com .

FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=""
ARG VITE_APP_VERSION="dev"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.30.5-alpine3.24
# Обновляем исправленные пакеты поверх базового образа до обновления его тега:
# libexpat >= 2.8.5 (CVE-2026-93990), pcre2 >= 10.49-r0 (CVE-2026-103111).
# tiff >= 4.7.2-r0 (CVE-2026-4775).
# Проверка образа в CI остаётся обязательной, исключения для этих CVE не добавляются.
RUN apk upgrade --no-cache libexpat pcre2 tiff
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
