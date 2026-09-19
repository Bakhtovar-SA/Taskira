#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

bash -n scripts/build-release.sh
bash -n scripts/release/install.sh

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
  info|pull|build|tag) exit 0 ;;
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
  *) echo "unexpected fake podman command: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$TMP_DIR/bin/podman"

PATH="$TMP_DIR/bin:$PATH" ALLOW_DIRTY_RELEASE=1 CONTAINER_ENGINE=podman \
  scripts/build-release.sh 9.8.7-test --output "$TMP_DIR/output" >/dev/null

RELEASE_DIR="$TMP_DIR/output/taskira-9.8.7-test"
[ -f "$TMP_DIR/output/taskira-9.8.7-test.tar.gz" ]
[ -f "$TMP_DIR/output/taskira-9.8.7-test.tar.gz.sha256" ]
[ -f "$RELEASE_DIR/manifest.json" ]
[ -f "$RELEASE_DIR/README_INSTALL.md" ]
[ -f "$RELEASE_DIR/CHANGELOG.md" ]
[ "$(cat "$RELEASE_DIR/VERSION")" = "9.8.7-test" ]
[ "$(find "$RELEASE_DIR/images" -type f -name '*.tar' | wc -l | tr -d ' ')" = "3" ]
grep -q '"version": "9.8.7-test"' "$RELEASE_DIR/manifest.json"
grep -q '"architecture": "amd64"' "$RELEASE_DIR/manifest.json"
grep -q 'localhost/taskira-client:9.8.7-test' "$RELEASE_DIR/docker-compose.yml"
if grep -R '__VERSION__\|__DATE__\|__GIT_SHA__\|__ARCH__' "$RELEASE_DIR" --exclude=SHA256SUMS >/dev/null; then
  echo "release contains an unresolved template placeholder" >&2
  exit 1
fi
grep -q 'pull_policy: never' "$RELEASE_DIR/docker-compose.yml"
if grep -qE '^[[:space:]]+build:' "$RELEASE_DIR/docker-compose.yml"; then
  echo "release compose must not contain build instructions" >&2
  exit 1
fi

(cd "$TMP_DIR/output" && sha256sum --check taskira-9.8.7-test.tar.gz.sha256 >/dev/null)
(cd "$RELEASE_DIR" && bash install.sh --verify-only >/dev/null)

printf 'corruption\n' >> "$RELEASE_DIR/manifest.json"
if (cd "$RELEASE_DIR" && bash install.sh --verify-only >/dev/null 2>&1); then
  echo "install.sh did not detect a corrupted file" >&2
  exit 1
fi

echo "release script checks passed"
