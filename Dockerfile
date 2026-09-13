# Taskira client. Статическая SPA — сборка Vite, раздаёт nginx. Хэш-роутинг
# (#/issue/<pid>/<iid>, см. CLAUDE.md) — фрагмент в браузере, серверу
# ВСЕГДА виден только "/"; try_files на index.html в nginx.conf — просто
# защитный дефолт на случай прямого захода на несуществующий путь, а не
# обязательное условие для работы хэш-роутинга.
#
# VITE_API_URL печётся В СБОРКУ (Vite инлайнит env на этапе build, не runtime) —
# указывайте адрес, откуда сервер реально будет доступен браузеру пользователя,
# не адрес контейнера в docker-сети. См. docker-compose.yml + .env.example.
#
#   docker build -t taskira-client --build-arg VITE_API_URL=https://api.example.com .

FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
