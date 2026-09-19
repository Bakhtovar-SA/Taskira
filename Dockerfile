# Taskira client. Статическая SPA — сборка Vite, раздаёт nginx. Хэш-роутинг
# (#/issue/<pid>/<iid>, см. CLAUDE.md) — фрагмент в браузере, серверу
# ВСЕГДА виден только "/"; try_files на index.html в nginx.conf — просто
# защитный дефолт на случай прямого захода на несуществующий путь, а не
# обязательное условие для работы хэш-роутинга.
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
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
