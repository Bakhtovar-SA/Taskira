#!/usr/bin/env bash
# Локальный стенд Taskira одной командой: PostgreSQL + API + клиент за nginx (docker-compose.yml, DOCKER_SETUP.md).
#
#   bash scripts/stand-up.sh            # создать .env (если нет), собрать и поднять, дождаться готовности
#   bash scripts/stand-up.sh down       # остановить (данные остаются в volume)
#   bash scripts/stand-up.sh reset      # остановить и стереть данные (docker compose down -v)
#   STAND_NO_START=1 bash scripts/stand-up.sh   # только подготовить .env, ничего не запускать
#
# .env создаётся из .env.example со случайными секретами и НЕ перезаписывается, если уже есть. Он в .gitignore:
# в репозиторий не попадает. Пароль администратора печатается один раз при создании .env.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-up}"
port_of() { grep -E '^CLIENT_PORT=' .env | head -1 | cut -d= -f2; }

if [ "$cmd" = "down" ]; then docker compose down; exit 0; fi
if [ "$cmd" = "reset" ]; then docker compose down -v; exit 0; fi
if [ "$cmd" != "up" ]; then echo "Использование: $0 [up|down|reset]" >&2; exit 2; fi

command -v docker >/dev/null || { echo "Нужен Docker (Docker Desktop или Docker Engine с плагином compose)." >&2; exit 1; }
command -v openssl >/dev/null || { echo "Нужен openssl для генерации секретов." >&2; exit 1; }

if [ ! -f .env ]; then
  [ -f .env.example ] || { echo ".env.example не найден: запускайте из корня репозитория." >&2; exit 1; }
  cp .env.example .env
  pg_pass="$(openssl rand -hex 24)"      # hex: пароль подставляется в DATABASE_URL без URL-экранирования
  jwt="$(openssl rand -hex 32)"          # >= 32 символов
  admin_pass="$(openssl rand -hex 12)"   # 24 символа; не из списка частых, без логина и слова Taskira
  set_env() { sed -i.bak -E "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; }
  set_env POSTGRES_PASSWORD "$pg_pass"
  set_env JWT_SECRET "$jwt"
  set_env ADMIN_PASSWORD "$admin_pass"
  echo "Создан .env. Вход в приложение: admin / $admin_pass"
else
  echo ".env уже есть, оставляю как есть."
fi

if [ "${STAND_NO_START:-}" = "1" ]; then echo "STAND_NO_START=1: запуск пропущен."; exit 0; fi

docker compose up -d --build

port="$(port_of)"; port="${port:-8081}"
url="http://localhost:${port}"
echo "Жду готовности ${url}/api/health ..."
for _ in $(seq 1 60); do
  if curl -fsS "${url}/api/health" >/dev/null 2>&1; then
    echo "Готово: ${url}"
    echo "Остановить: bash scripts/stand-up.sh down   |   стереть данные: bash scripts/stand-up.sh reset"
    exit 0
  fi
  sleep 3
done
echo "Не дождался ответа за 3 минуты. Логи: docker compose logs -f server" >&2
exit 1
