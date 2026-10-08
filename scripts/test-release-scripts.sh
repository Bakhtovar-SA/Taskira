#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

bash -n scripts/build-release.sh
bash -n scripts/render-compose.sh
bash -n scripts/test-proxy-integration.sh
bash -n scripts/upgrade.sh
bash -n scripts/backup.sh
bash -n scripts/restore.sh
bash -n scripts/support-bundle.sh
bash -n scripts/operations-common.sh
bash -n scripts/test-upgrade-rollback-mock.sh
bash scripts/test-upgrade-rollback-mock.sh
bash -n scripts/ops-report.sh
bash -n scripts/restore-drill.sh
node --check scripts/restore-drill-probe.cjs
bash scripts/test-ops-report.sh
bash scripts/test-container-storage-space.sh
bash -n scripts/release/install.sh
bash -n scripts/release/container-engine.sh

scripts/render-compose.sh source | cmp - docker-compose.yml
scripts/render-compose.sh release 9.8.7-test | grep -F "localhost:8080/api/health" >/dev/null
# Podman maps localhost to ::1 first; nginx in the client image listens on IPv4 only.
scripts/render-compose.sh release 9.8.7-test | grep -F '"http://127.0.0.1/healthz"' >/dev/null

if scripts/build-release.sh invalid-version >/dev/null 2>&1; then
  echo "build-release.sh accepted an invalid version" >&2
  exit 1
fi
if scripts/build-release.sh 1.2.3-01 >/dev/null 2>&1; then
  echo "build-release.sh accepted a non-SemVer numeric prerelease" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$TMP_DIR"; }
trap cleanup EXIT INT TERM
mkdir -p "$TMP_DIR/bin" "$TMP_DIR/output"

# Fake Podman validates the complete release assembly without downloading or
# building large images. Real image builds remain an operator/release job.
cat > "$TMP_DIR/bin/podman" <<'EOF'
#!/usr/bin/env bash
set -eu
case "${1:-}" in
  info|pull|build|tag|load) exit 0 ;;
  compose) exit 0 ;;
  image)
    if [ "${2:-}" = "inspect" ] && [ "${3:-}" = "--format" ]; then
      case "${4:-}" in
        *Architecture*) printf 'amd64\n' ;;
        *) printf 'sha256:fixture-image-id\n' ;;
      esac
    fi
    exit 0 ;;
  save)
    shift
    [ "${1:-}" = "--output" ] || exit 2
    output="$2"
    image="$3"
    printf 'saved image: %s\n' "$image" > "$output"
    exit 0 ;;
  # Install preflight fixtures: FAKE_VOLUMES="name ...", FAKE_CONTAINERS="id ...",
  # FAKE_WORKDIR=<compose working_dir label>, FAKE_NETWORKS="name=cidr ...".
  volume)
    [ "${2:-}" = "inspect" ] || exit 2
    for v in ${FAKE_VOLUMES:-}; do [ "$v" = "${3:-}" ] && exit 0; done
    exit 1 ;;
  ps) printf '%s\n' ${FAKE_CONTAINERS:-}; exit 0 ;;
  inspect) printf '%s\n' "${FAKE_WORKDIR:-}"; exit 0 ;;
  network)
    case "${2:-}" in
      ls) for n in ${FAKE_NETWORKS:-}; do printf '%s\n' "${n%%=*}"; done ;;
      inspect) for n in ${FAKE_NETWORKS:-}; do
          [ "${n%%=*}" = "${3:-}" ] && printf '[{"subnets": [{"subnet": "%s"}]}]\n' "${n#*=}"
        done ;;
      *) exit 2 ;;
    esac
    exit 0 ;;
  *) echo "unexpected fake podman command: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$TMP_DIR/bin/podman"
cat > "$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '{"ok":true,"version":"9.8.7-test"}\n'
EOF
chmod +x "$TMP_DIR/bin/curl"

PATH="$TMP_DIR/bin:$PATH" ALLOW_DIRTY_RELEASE=1 CONTAINER_ENGINE=podman \
  scripts/build-release.sh 9.8.7-test --output "$TMP_DIR/output" >/dev/null

RELEASE_DIR="$TMP_DIR/output/taskira-9.8.7-test"
[ -f "$TMP_DIR/output/taskira-9.8.7-test.tar.gz" ]
[ -f "$TMP_DIR/output/taskira-9.8.7-test.tar.gz.sha256" ]
[ -f "$RELEASE_DIR/manifest.json" ]
[ -f "$RELEASE_DIR/README_INSTALL.md" ]
[ -f "$RELEASE_DIR/OPERATIONS.md" ]
[ -f "$RELEASE_DIR/SECURITY_OVERVIEW.md" ]
[ -f "$RELEASE_DIR/SECURITY.md" ]
[ -f "$RELEASE_DIR/CHANGELOG.md" ]
[ -f "$RELEASE_DIR/container-engine.sh" ]
[ -x "$RELEASE_DIR/upgrade.sh" ]
[ -x "$RELEASE_DIR/backup.sh" ]
[ -x "$RELEASE_DIR/restore.sh" ]
[ -x "$RELEASE_DIR/support-bundle.sh" ]
[ -x "$RELEASE_DIR/operations-common.sh" ]
[ -x "$RELEASE_DIR/ops-report.sh" ]
[ -x "$RELEASE_DIR/restore-drill.sh" ]
[ -f "$RELEASE_DIR/restore-drill-probe.cjs" ]
[ -f "$RELEASE_DIR/deploy/systemd/taskira-restore-drill.service" ]
[ -f "$RELEASE_DIR/deploy/systemd/taskira-restore-drill.timer" ]
[ -f "$RELEASE_DIR/MIGRATIONS.txt" ]
[ "$(cat "$RELEASE_DIR/VERSION")" = "9.8.7-test" ]
[ "$(find "$RELEASE_DIR/images" -type f -name '*.tar' | wc -l | tr -d ' ')" = "3" ]
grep -q '"version": "9.8.7-test"' "$RELEASE_DIR/manifest.json"
grep -q '"architecture": "amd64"' "$RELEASE_DIR/manifest.json"
grep -q 'localhost/taskira-client:9.8.7-test' "$RELEASE_DIR/docker-compose.yml"
if grep -R '__VERSION__\|__DATE__\|__GIT_SHA__\|__ARCH__' "$RELEASE_DIR" --exclude=SHA256SUMS >/dev/null; then
  echo "release contains an unresolved template placeholder" >&2
  exit 1
fi
if grep -q 'pull_policy:\|extends:' "$RELEASE_DIR/docker-compose.yml"; then
  echo "release compose must stay compatible with basic Compose providers" >&2
  exit 1
fi
if grep -qE '^[[:space:]]+build:' "$RELEASE_DIR/docker-compose.yml"; then
  echo "release compose must not contain build instructions" >&2
  exit 1
fi

(cd "$TMP_DIR/output" && sha256sum --check taskira-9.8.7-test.tar.gz.sha256 >/dev/null)
(cd "$RELEASE_DIR" && bash install.sh --verify-only >/dev/null)

# Windows-edited CRLF env files must not append carriage returns to secrets.
printf 'POSTGRES_PASSWORD=dbsecret\r\nJWT_SECRET=12345678901234567890123456789012\r\nADMIN_PASSWORD=Release-Secure-42!\r\nCORS_ORIGIN=http://10.20.30.40:8081\r\nCLIENT_PORT=8081\r\n' > "$RELEASE_DIR/.env"
(cd "$RELEASE_DIR" && PATH="$TMP_DIR/bin:$PATH" bash install.sh --engine podman --start >/dev/null)

# Rootless Podman preflight (OPS-PODMAN-01): a fake rootless podman plus fixture
# sysctls must turn the usual rootless traps into early, readable failures.
mkdir -p "$TMP_DIR/rootless-bin" "$TMP_DIR/proc/user" "$TMP_DIR/proc/net/ipv4"
cat > "$TMP_DIR/rootless-bin/podman" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "info" ] && [ "\${2:-}" = "--format" ]; then echo true; exit 0; fi
exec "$TMP_DIR/bin/podman" "\$@"
EOF
chmod +x "$TMP_DIR/rootless-bin/podman"
cp "$TMP_DIR/bin/curl" "$TMP_DIR/rootless-bin/curl"
printf '15000\n' > "$TMP_DIR/proc/user/max_user_namespaces"
printf '1024\n' > "$TMP_DIR/proc/net/ipv4/ip_unprivileged_port_start"
rootless_install() {
  (cd "$RELEASE_DIR" && PATH="$TMP_DIR/rootless-bin:$PATH" TASKIRA_PROC_SYS="$TMP_DIR/proc" \
    TASKIRA_SUBUID_FILE="${SUBUID_FIXTURE:-/nonexistent}" XDG_RUNTIME_DIR=/run/user/1000 \
    bash install.sh --engine podman --start 2>&1)
}
rootless_out="$(rootless_install)"
printf '%s' "$rootless_out" | grep -q 'Rootless Podman detected'
sed -i 's/^CLIENT_PORT=.*/CLIENT_PORT=80/' "$RELEASE_DIR/.env"
if rootless_out="$(rootless_install)"; then
  echo "install.sh accepted a privileged port under rootless Podman" >&2
  exit 1
fi
printf '%s' "$rootless_out" | grep -q 'cannot publish port 80'
sed -i 's/^CLIENT_PORT=.*/CLIENT_PORT=8081/' "$RELEASE_DIR/.env"
printf '0\n' > "$TMP_DIR/proc/user/max_user_namespaces"
if rootless_out="$(rootless_install)"; then
  echo "install.sh ignored disabled user namespaces" >&2
  exit 1
fi
printf '%s' "$rootless_out" | grep -q 'user namespaces are disabled'
printf '15000\n' > "$TMP_DIR/proc/user/max_user_namespaces"
printf 'nobody-else:100000:65536\n' > "$TMP_DIR/subuid"
if SUBUID_FIXTURE="$TMP_DIR/subuid" rootless_out="$(SUBUID_FIXTURE="$TMP_DIR/subuid" rootless_install)"; then
  echo "install.sh ignored a missing subuid range" >&2
  exit 1
fi
printf '%s' "$rootless_out" | grep -q 'no subordinate UID range'
# Rootful/Docker-like fake (info prints nothing) must skip the checks entirely.
printf '80\n' > "$TMP_DIR/proc/net/ipv4/ip_unprivileged_port_start"
(cd "$RELEASE_DIR" && PATH="$TMP_DIR/bin:$PATH" TASKIRA_PROC_SYS="$TMP_DIR/proc" \
  bash install.sh --engine podman --start >/dev/null)

# Existing volumes of the same project (a second installation in a directory with
# the same name, OPS-PODMAN-01) must not be silently shared.
fake_start() {
  (cd "$RELEASE_DIR" && PATH="$TMP_DIR/bin:$PATH" bash install.sh --engine podman --start "$@" 2>&1)
}
[ -f "$RELEASE_DIR/.taskira-installed" ]   # written by the successful starts above
rm -f "$RELEASE_DIR/.taskira-installed"
export FAKE_VOLUMES="taskira-987-test_pgdata" FAKE_CONTAINERS="c1" FAKE_WORKDIR="/srv/other/taskira-9.8.7-test"
if out="$(fake_start)"; then
  echo "install.sh started on volumes of another installation" >&2
  exit 1
fi
printf '%s' "$out" | grep -q 'does not belong to this installation'
printf '%s' "$out" | grep -q '/srv/other/taskira-9.8.7-test'
FAKE_WORKDIR="$RELEASE_DIR" fake_start >/dev/null      # containers created from this directory
rm -f "$RELEASE_DIR/.taskira-installed"
export FAKE_CONTAINERS=""                              # leftover volume, no containers
if out="$(fake_start)"; then
  echo "install.sh started on a leftover volume" >&2
  exit 1
fi
printf '%s' "$out" | grep -q 'No container uses it'
fake_start --adopt-existing-volumes >/dev/null
[ -f "$RELEASE_DIR/.taskira-installed" ]
fake_start >/dev/null                                  # adopted once, no flag needed again
unset FAKE_VOLUMES FAKE_CONTAINERS FAKE_WORKDIR

# A network on an overlapping subnet fails early with the variable to change.
if out="$(FAKE_NETWORKS="podman=10.88.0.0/16 other_default=172.30.0.0/16" fake_start)"; then
  echo "install.sh ignored an overlapping network subnet" >&2
  exit 1
fi
printf '%s' "$out" | grep -q 'other_default already uses 172.30.0.0/16, which overlaps TASKIRA_NETWORK_CIDR=172.30.0.0/24'
FAKE_NETWORKS="taskira-987-test_default=172.30.0.0/24 lan=172.31.0.0/24" fake_start >/dev/null
printf 'TASKIRA_NETWORK_CIDR=172.31.8.0/24\n' >> "$RELEASE_DIR/.env"
FAKE_NETWORKS="other_default=172.30.0.0/24" fake_start >/dev/null
sed -i '/^TASKIRA_NETWORK_CIDR=/d' "$RELEASE_DIR/.env"

# SELinux: the bind-mounted storage directory must carry :z.
grep -q 'backup/storage:z' scripts/operations-common.sh

# A relative --output is relative to the caller, not to the repository.
(cd "$TMP_DIR" && PATH="$TMP_DIR/bin:$PATH" ALLOW_DIRTY_RELEASE=1 CONTAINER_ENGINE=podman \
  "$ROOT_DIR/scripts/build-release.sh" 9.8.8-test --output relative-output >/dev/null)
[ -f "$TMP_DIR/relative-output/taskira-9.8.8-test.tar.gz" ]
[ ! -e "$ROOT_DIR/relative-output" ]

printf 'corruption\n' >> "$RELEASE_DIR/manifest.json"
if (cd "$RELEASE_DIR" && bash install.sh --verify-only >/dev/null 2>&1); then
  echo "install.sh did not detect a corrupted file" >&2
  exit 1
fi

echo "release script checks passed"
