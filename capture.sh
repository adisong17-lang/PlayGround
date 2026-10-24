#!/usr/bin/env bash
# Capture desktop and mobile evidence without stopping the preview server.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$PROJECT_DIR/scripts/capture.mjs"

timed() {
  printf '\n$' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
  /usr/bin/time -p "$@"
}

if [[ -z "${CAPTURE_URL:-}" ]]; then
  echo 'CAPTURE_URL is required.' >&2
  exit 1
fi
if [[ -z "${CAPTURE_DIR:-}" ]]; then
  echo 'CAPTURE_DIR is required.' >&2
  exit 1
fi

CAPTURE_ABS="$(realpath -m "$CAPTURE_DIR")"
case "$CAPTURE_ABS/" in
  "$PROJECT_DIR"/*)
    echo 'CAPTURE_DIR must be outside the project directory.' >&2
    exit 1
    ;;
esac

cd "$PROJECT_DIR"
timed test -f "$SCRIPT"
timed mkdir -p "$CAPTURE_ABS"

set +e
timed node "$SCRIPT"
status=$?
set -e
case "$status" in
  0|75) exit "$status" ;;
  *) exit 1 ;;
esac
