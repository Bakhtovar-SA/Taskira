#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CALLER_DIR="$(pwd -P)"
TEMPLATE_DIR="$ROOT_DIR/scripts/release"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$ROOT_DIR/dist/releases}"
ENGINE="${CONTAINER_ENGINE:-}"
VERSION=""
POSTGRES_SOURCE_IMAGE="docker.io/library/postgres:16-alpine"

usage() {
  cat <<'EOF'
Build a complete, single-host Taskira offline release.

Usage:
  ./scripts/build-release.sh VERSION [--engine docker|podman] [--output DIR]

Examples:
  ./scripts/build-release.sh 1.4.0
  CONTAINER_ENGINE=podman ./scripts/build-release.sh 1.4.0-rc.1

VERSION must be SemVer without build metadata (for example 1.4.0 or
1.4.0-rc.1). The version is also the exact container image tag.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engine)
      [ "$#" -ge 2 ] || { echo "--engine requires docker or podman" >&2; exit 2; }
      ENGINE="$2"; shift 2 ;;
    --output)
      [ "$#" -ge 2 ] || { echo "--output requires a directory" >&2; exit 2; }
      OUTPUT_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    *)
      [ -z "$VERSION" ] || { echo "Only one VERSION is allowed" >&2; exit 2; }
      VERSION="$1"; shift ;;
  esac
done

[ -n "$VERSION" ] || { usage >&2; exit 2; }
if ! printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$'; then
  echo "ERROR: VERSION must be SemVer without +build metadata: $VERSION" >&2
  exit 2
fi
if [[ "$VERSION" == *-* ]]; then
  prerelease="${VERSION#*-}"
  IFS='.' read -r -a identifiers <<< "$prerelease"
  for identifier in "${identifiers[@]}"; do
    if [[ "$identifier" =~ ^[0-9]+$ && "$identifier" != "0" && "$identifier" == 0* ]]; then
      echo "ERROR: numeric SemVer prerelease identifiers cannot have leading zeroes: $identifier" >&2
      exit 2
    fi
  done
fi

for command_name in git tar gzip sha256sum sed awk find sort xargs date mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: $command_name is required" >&2; exit 1; }
done

. "$TEMPLATE_DIR/container-engine.sh"

case "$OUTPUT_ROOT" in
  /*) ;;
  *) OUTPUT_ROOT="$CALLER_DIR/$OUTPUT_ROOT" ;;
esac

cd "$ROOT_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run this script from a Git checkout" >&2; exit 1; }
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "ERROR: a shallow Git checkout cannot produce a complete CHANGELOG.md" >&2
  echo "Fetch complete history (for example: git fetch --unshallow --tags) and retry." >&2
  exit 1
fi
if [ "${ALLOW_DIRTY_RELEASE:-0}" != "1" ] && [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "ERROR: the Git tree is dirty. Commit the release contents first." >&2
  echo "Set ALLOW_DIRTY_RELEASE=1 only for a disposable test build." >&2
  exit 1
fi

detect_engine

GIT_SHA="$(git rev-parse HEAD)"
SOURCE_EPOCH="${SOURCE_DATE_EPOCH:-$(git show -s --format=%ct HEAD)}"
BUILD_DATE="${RELEASE_DATE:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}"
if ! printf '%s' "$BUILD_DATE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  echo "ERROR: RELEASE_DATE must use UTC RFC 3339 format, for example 2026-09-19T12:00:00Z" >&2
  exit 2
fi
CLIENT_IMAGE="localhost/taskira-client:$VERSION"
SERVER_IMAGE="localhost/taskira-server:$VERSION"
POSTGRES_IMAGE="localhost/taskira-postgres:$VERSION"
RELEASE_NAME="taskira-$VERSION"

mkdir -p "$OUTPUT_ROOT"
FINAL_DIR="$OUTPUT_ROOT/$RELEASE_NAME"
FINAL_ARCHIVE="$OUTPUT_ROOT/$RELEASE_NAME.tar.gz"
FINAL_ARCHIVE_SUM="$FINAL_ARCHIVE.sha256"
if [ -e "$FINAL_DIR" ] || [ -e "$FINAL_ARCHIVE" ] || [ -e "$FINAL_ARCHIVE_SUM" ]; then
  echo "ERROR: release already exists: $FINAL_DIR or $FINAL_ARCHIVE" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "$OUTPUT_ROOT/.${RELEASE_NAME}.XXXXXX")"
cleanup() { rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT INT TERM
mkdir -p "$WORK_DIR/images"

echo "[1/7] Building $CLIENT_IMAGE"
"$ENGINE" build --pull \
  --label "org.opencontainers.image.title=Taskira client" \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$GIT_SHA" \
  --label "org.opencontainers.image.created=$BUILD_DATE" \
  --build-arg VITE_API_URL= \
  --build-arg "VITE_APP_VERSION=$VERSION" \
  --tag "$CLIENT_IMAGE" "$ROOT_DIR"

echo "[2/7] Building $SERVER_IMAGE"
"$ENGINE" build --pull \
  --label "org.opencontainers.image.title=Taskira server" \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$GIT_SHA" \
  --label "org.opencontainers.image.created=$BUILD_DATE" \
  --build-arg "TASKIRA_VERSION=$VERSION" \
  --tag "$SERVER_IMAGE" "$ROOT_DIR/server"

echo "[3/7] Ensuring the PostgreSQL runtime image is available"
if ! "$ENGINE" image inspect "$POSTGRES_SOURCE_IMAGE" >/dev/null 2>&1; then
  "$ENGINE" pull "$POSTGRES_SOURCE_IMAGE"
fi
"$ENGINE" tag "$POSTGRES_SOURCE_IMAGE" "$POSTGRES_IMAGE"

echo "[4/7] Exporting images"
CLIENT_TAR="images/taskira-client-$VERSION.tar"
SERVER_TAR="images/taskira-server-$VERSION.tar"
POSTGRES_TAR="images/postgres-16-alpine.tar"
"$ENGINE" save --output "$WORK_DIR/$CLIENT_TAR" "$CLIENT_IMAGE"
"$ENGINE" save --output "$WORK_DIR/$SERVER_TAR" "$SERVER_IMAGE"
"$ENGINE" save --output "$WORK_DIR/$POSTGRES_TAR" "$POSTGRES_IMAGE"

CLIENT_ID="$("$ENGINE" image inspect --format '{{.Id}}' "$CLIENT_IMAGE")"
SERVER_ID="$("$ENGINE" image inspect --format '{{.Id}}' "$SERVER_IMAGE")"
POSTGRES_ID="$("$ENGINE" image inspect --format '{{.Id}}' "$POSTGRES_IMAGE")"
IMAGE_ARCH="$("$ENGINE" image inspect --format '{{.Architecture}}' "$SERVER_IMAGE")"
CLIENT_SUM="$(sha256sum "$WORK_DIR/$CLIENT_TAR" | awk '{print $1}')"
SERVER_SUM="$(sha256sum "$WORK_DIR/$SERVER_TAR" | awk '{print $1}')"
POSTGRES_SUM="$(sha256sum "$WORK_DIR/$POSTGRES_TAR" | awk '{print $1}')"

echo "[5/7] Writing installation files and release manifest"
"$ROOT_DIR/scripts/render-compose.sh" release "$VERSION" > "$WORK_DIR/docker-compose.yml"
sed \
  -e "s/__VERSION__/$VERSION/g" \
  -e "s/__DATE__/$BUILD_DATE/g" \
  -e "s/__GIT_SHA__/$GIT_SHA/g" \
  -e "s/__ARCH__/$IMAGE_ARCH/g" \
  "$TEMPLATE_DIR/README_INSTALL.md.in" > "$WORK_DIR/README_INSTALL.md"
cp "$TEMPLATE_DIR/.env.example" "$WORK_DIR/.env.example"
cp "$TEMPLATE_DIR/install.sh" "$WORK_DIR/install.sh"
cp "$ROOT_DIR/scripts/upgrade.sh" "$WORK_DIR/upgrade.sh"
cp "$TEMPLATE_DIR/container-engine.sh" "$WORK_DIR/container-engine.sh"
chmod 0755 "$WORK_DIR/install.sh" "$WORK_DIR/upgrade.sh"
find "$ROOT_DIR/server/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$WORK_DIR/MIGRATIONS.txt"
printf '%s\n%s\n%s\n' "$CLIENT_IMAGE" "$SERVER_IMAGE" "$POSTGRES_IMAGE" > "$WORK_DIR/IMAGES.txt"
printf '%s\n' "$VERSION" > "$WORK_DIR/VERSION"

cat > "$WORK_DIR/manifest.json" <<EOF
{
  "product": "Taskira",
  "version": "$VERSION",
  "created_at": "$BUILD_DATE",
  "git_sha": "$GIT_SHA",
  "architecture": "$IMAGE_ARCH",
  "source_date_epoch": $SOURCE_EPOCH,
  "migrations": "embedded in $SERVER_IMAGE; ordered list in MIGRATIONS.txt",
  "images": [
    {"name": "taskira-client", "tag": "$CLIENT_IMAGE", "id": "$CLIENT_ID", "archive": "$CLIENT_TAR", "sha256": "$CLIENT_SUM"},
    {"name": "taskira-server", "tag": "$SERVER_IMAGE", "id": "$SERVER_ID", "archive": "$SERVER_TAR", "sha256": "$SERVER_SUM"},
    {"name": "postgres", "tag": "$POSTGRES_IMAGE", "source": "$POSTGRES_SOURCE_IMAGE", "id": "$POSTGRES_ID", "archive": "$POSTGRES_TAR", "sha256": "$POSTGRES_SUM"}
  ]
}
EOF

PREVIOUS_TAG=""
if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  PREVIOUS_TAG="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)"
fi
{
  printf '# Taskira %s\n\n' "$VERSION"
  printf 'Built on %s from `%s`.\n\n' "$BUILD_DATE" "$GIT_SHA"
  printf '## Changes\n\n'
  if [ -n "$PREVIOUS_TAG" ]; then
    git log --no-merges --format='- %h %s' "$PREVIOUS_TAG..HEAD"
  else
    git log --no-merges --format='- %h %s' HEAD
  fi
  printf '\n'
} > "$WORK_DIR/CHANGELOG.md"

echo "[6/7] Calculating SHA-256 checksums"
(
  cd "$WORK_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

echo "[7/7] Creating $FINAL_ARCHIVE"
mv "$WORK_DIR" "$FINAL_DIR"
trap - EXIT INT TERM
(
  cd "$OUTPUT_ROOT"
  tar --sort=name --mtime="@$SOURCE_EPOCH" --owner=0 --group=0 --numeric-owner \
    -czf "$FINAL_ARCHIVE" "$RELEASE_NAME"
  sha256sum "$RELEASE_NAME.tar.gz" > "$RELEASE_NAME.tar.gz.sha256"
)

echo
echo "Offline release created:"
echo "  directory: $FINAL_DIR"
echo "  archive:   $FINAL_ARCHIVE"
echo "  checksum:  $FINAL_ARCHIVE_SUM"
echo "  version:   $VERSION"
echo "  git SHA:   $GIT_SHA"
