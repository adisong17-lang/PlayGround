#!/usr/bin/env bash
# Build the static research dashboard and serve it in the foreground.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
DIST="$PROJECT_DIR/dist"
REPORT="$PROJECT_DIR/results/performance_report.html"

timed() {
  printf '\n$' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
  /usr/bin/time -p "$@"
}

cd "$PROJECT_DIR"

timed test -f config.yaml
timed test -f requirements.txt

echo "Checking Python dependencies"
if ! timed python3 -c 'import pandas, numpy, scipy, matplotlib, seaborn, yaml' >/dev/null; then
  timed python3 -m pip install --user --disable-pip-version-check -r requirements.txt
fi

needs_build=false
if [[ ! -f "$REPORT" ]]; then
  needs_build=true
else
  newer="$(timed find src -type f -newer "$REPORT" -print -quit; timed find config.yaml run_backtest.py run_scanner.py -newer "$REPORT" -print -quit)"
  [[ -z "$newer" ]] || needs_build=true
fi

if [[ "$needs_build" == true ]]; then
  echo "Building research report"
  if [[ ! -f data/synthetic/clean_uptrend/NIFTY50.csv ]]; then
    timed python3 -m src.synthetic --output data/synthetic --sessions 760
  fi
  timed python3 run_backtest.py --config config.yaml
  timed python3 run_scanner.py --capital 200000 --config config.yaml
fi

echo "Publishing static output"
timed rm -rf "$DIST"
timed mkdir -p "$DIST"
timed cp "$REPORT" "$DIST/index.html"
if [[ -f results/metrics.json ]]; then
  timed cp results/metrics.json "$DIST/metrics.json"
fi
if compgen -G 'results/scanner_*.csv' >/dev/null; then
  latest_scanner="$(ls -1 results/scanner_*.csv | sort | tail -n 1)"
  timed cp "$latest_scanner" "$DIST/scanner.csv"
fi

DIST_ABS="$(cd "$DIST" && pwd)"
PROJECT_ABS="$(cd "$PROJECT_DIR" && pwd)"
timed mkdir -p "$WEB_DIR"
timed python3 -c 'import json, sys; open(sys.argv[3], "w", encoding="utf-8").write(json.dumps({"project": sys.argv[1], "directory": sys.argv[2]}))' "$PROJECT_ABS" "$DIST_ABS" "$WEB_DIR/deployment-output.json"

echo "Serving $DIST_ABS on port $PORT"
exec /usr/bin/time -p python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIST_ABS"
