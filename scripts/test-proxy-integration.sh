#!/usr/bin/env bash
set -Eeuo pipefail

# Use only disposable containers with no mounts of working or production data.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="taskira-proxy-${RANDOM}-${RANDOM}"
NETWORK="${PREFIX}-net"
DB="${PREFIX}-db"
API="${PREFIX}-api"
CLIENT="${PREFIX}-client"
cleanup() {
  docker rm -f -v "$CLIENT" "$API" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The default subnet and a custom 10.x subnet must both match TRUST_PROXY.
for scenario in '172.30.0.0/24:26214400' '10.253.250.0/24:3145728'; do
  cidr="${scenario%:*}"
  max="${scenario##*:}"
  POSTGRES_PASSWORD=temporaryci JWT_SECRET=proxy-smoke-ci-only-secret-0000000000000000 \
    ADMIN_PASSWORD=Temporary-CI-Secret42! TASKIRA_NETWORK_CIDR="$cidr" \
    docker compose -f "$ROOT/docker-compose.yml" config --format json | \
    node -e 'const assert=require("node:assert/strict");let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const c=JSON.parse(s);assert.equal(c.services.server.environment.TRUST_PROXY,process.argv[1]);assert.equal(c.networks.default.ipam.config[0].subnet,process.argv[1]);});' "$cidr"
  docker network create --subnet "$cidr" "$NETWORK" >/dev/null
  docker run -d --name "$DB" --network "$NETWORK" --network-alias postgres \
    -e POSTGRES_USER=taskira -e POSTGRES_PASSWORD=temporaryci -e POSTGRES_DB=taskira_proxy postgres:16 >/dev/null
  for i in $(seq 1 60); do
    if docker exec "$DB" pg_isready -U taskira -d taskira_proxy >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$DB" pg_isready -U taskira -d taskira_proxy

  # Both the default 25 MiB limit and an env override must work through the same image.
  docker run -d --name "$API" --network "$NETWORK" --network-alias server \
    -e DATABASE_URL=postgresql://taskira:temporaryci@postgres:5432/taskira_proxy \
    -e JWT_SECRET=proxy-smoke-ci-only-secret-0000000000000000 \
    -e ADMIN_USERNAME=smoke_admin -e ADMIN_PASSWORD=Temporary-CI-Secret42! \
    -e TRUST_PROXY="$cidr" -e ATTACH_MAX_BYTES="$max" \
    -e NOTIFY_WORKER_ENABLED=false -e MAINTENANCE_ENABLED=false \
    taskira-server:security >/dev/null
  docker run -d --name "$CLIENT" --network "$NETWORK" -p 127.0.0.1::80 taskira-client:security >/dev/null
  port="$(docker port "$CLIENT" 80/tcp)"
  base="http://${port}"
  ready=false
  for i in $(seq 1 90); do
    if curl -fsS "$base/api/instance/brand" >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if [ "$ready" != true ]; then docker logs "$API"; docker logs "$CLIENT"; exit 1; fi
  # Clear test limiter state between the two container configurations.
  docker exec "$DB" psql -U taskira -d taskira_proxy -c 'TRUNCATE login_attempts' >/dev/null
  TASKIRA_PROXY_TEST_URL="$base" TASKIRA_PROXY_TEST_MAX_BYTES="$max" node "$ROOT/server/scripts/proxy-smoke.mjs"
  count="$(docker exec "$DB" psql -U taskira -d taskira_proxy -Atqc 'SELECT count(DISTINCT ip) FROM login_attempts')"
  test "$count" = 1
  spoofed="$(docker exec "$DB" psql -U taskira -d taskira_proxy -Atqc "SELECT count(*) FROM audit_log WHERE details->>'ip' LIKE '192.0.2.%'")"
  test "$spoofed" = 0
  docker rm -f -v "$CLIENT" "$API" "$DB" >/dev/null
  docker network rm "$NETWORK" >/dev/null
done
