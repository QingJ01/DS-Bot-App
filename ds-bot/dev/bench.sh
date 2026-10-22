#!/bin/sh
# Mock test bench: the scripted mock model (dev/mock-llm.mjs) plus a dsh web whose profile
# links the plugin to this checkout, so edits need no reinstall (host code needs a restart;
# src/client needs `npm run build` and a page reload).
#
#   dev/bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]
#
# Data lives in <checkout>/.dsh-test-<name>; `reset` wipes its Bot team and Sessions before
# starting. Processes are tracked by pid files and stopped by process group, never by name.
# Environment: CONTEXT_WINDOW (the mock models' context window, in tokens, with an 8,000
# token reply; default: the adapter's own), CHECK_RATIO (the plugin's checkRatio), MOCK_DELAY_MS,
# DSH_HARNESS (the deepseek-harness checkout; default: beside this checkout, else at the
# same place in the main worktree). MOBILE_PORT enables the optional mobile bridge on
# loopback only. MOBILE_WEB_ORIGIN allows one local Expo web preview origin.
# PARITY_APPROVAL=1 loads the harmless, bench-only public approval test tool.
# UPDATE_SMOKE=1 allows the isolated update smoke to replace its own test profile.
# DSH_CLI selects an installed public dsh executable instead of the checkout runner.
set -eu
NAME=${1:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
WEB_PORT=${2:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
MOCK_PORT=${3:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
ACTION=${4:-start}
case "$NAME" in *[!a-z0-9-]*|'') echo "bench name must match [a-z0-9-]+" >&2; exit 1 ;; esac
if [ "$WEB_PORT" = 3080 ]; then echo "port 3080 belongs to the real service" >&2; exit 1; fi
if [ -n "${MOBILE_PORT:-}" ]; then
  case "$MOBILE_PORT" in
    [1-9][0-9][0-9][0-9]|[1-9][0-9][0-9][0-9][0-9]) ;;
    *) echo "MOBILE_PORT must be a numeric port from 1024 to 65535" >&2; exit 1 ;;
  esac
  if [ "$MOBILE_PORT" -lt 1024 ] || [ "$MOBILE_PORT" -gt 65535 ] || [ "$MOBILE_PORT" = "$WEB_PORT" ] || [ "$MOBILE_PORT" = "$MOCK_PORT" ] || [ "$MOBILE_PORT" = 3080 ]; then
    echo "MOBILE_PORT must be a distinct test port from 1024 to 65535" >&2; exit 1
  fi
fi
if [ -n "${MOBILE_WEB_ORIGIN:-}" ]; then
  [ -n "${MOBILE_PORT:-}" ] || { echo "MOBILE_WEB_ORIGIN requires MOBILE_PORT" >&2; exit 1; }
  MOBILE_ORIGIN_YAML=$(node --input-type=module -e '
    try {
      const value = process.env.MOBILE_WEB_ORIGIN
      const url = new URL(value)
      if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || value !== url.origin) throw new Error()
      process.stdout.write(JSON.stringify(url.origin))
    } catch { console.error("MOBILE_WEB_ORIGIN must be a complete loopback origin without a path"); process.exit(1) }
  ')
fi

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$PLUGIN")"
HOME_DIR="$ROOT/.dsh-test-$NAME"
if [ -z "${DSH_HARNESS:-}" ]; then
  DSH_HARNESS="$ROOT/deepseek-harness"
  if [ ! -d "$DSH_HARNESS" ]; then
    MAIN="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")/$(git -C "$ROOT" rev-parse --show-prefix)"
    DSH_HARNESS="${MAIN%/}/deepseek-harness"
  fi
  [ -d "$DSH_HARNESS" ] || DSH_HARNESS="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")/deepseek-harness"
fi

alive() { [ -f "$HOME_DIR/$1.pid" ] && kill -0 "-$(cat "$HOME_DIR/$1.pid")" 2>/dev/null; }

# Each process runs in its own session (setsid), so its pid is also its process group, which
# outlives it: pnpm exits before the dsh it started. The process writes its own pid: the `$!`
# of a background job is the subshell that runs setsid, not the session leader it forks, so
# it cannot name the group to keep and stop. dash's kill takes no `--`.
stop_one() {
  file="$HOME_DIR/$1.pid"
  [ -f "$file" ] || return 0
  pid=$(cat "$file")
  kill -TERM "-$pid" 2>/dev/null || true
  i=0
  while kill -0 "-$pid" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i + 1)); done
  kill -KILL "-$pid" 2>/dev/null || true
  rm -f "$file"
}

ensure_profile() {
  profile="$HOME_DIR/profiles/web"
  if [ -f "$profile/package.json" ] && grep -q "\"link:$PLUGIN\"" "$profile/package.json"; then return 0; fi
  mkdir -p "$profile"
  cat > "$profile/package.json" <<EOF
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "ds-bot": "link:$PLUGIN" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "ds-bot"] } }
}
EOF
  printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > "$profile/pnpm-workspace.yaml"
  (cd "$profile" && DSH_HOME="$HOME_DIR" pnpm install >/dev/null)
}

# Bench-only plugin config, layered over the profile with --patch.
write_overlay() {
  overlay="$HOME_DIR/bench.patch.yml"
  : > "$overlay"
  if [ -n "${CHECK_RATIO:-}${MOBILE_PORT:-}${MOBILE_BROWSER:-}" ]; then
    printf -- '- id: bot\n  config:\n' >> "$overlay"
    if [ "${MOBILE_BROWSER:-}" = 1 ]; then printf '    browser: true\n' >> "$overlay"; fi
    if [ -n "${CHECK_RATIO:-}" ]; then
      printf '    checkRatio: %s\n' "$CHECK_RATIO" >> "$overlay"
    fi
    if [ -n "${MOBILE_PORT:-}" ]; then
      {
        printf '    mobile:\n      enabled: true\n      host: 127.0.0.1\n      port: %s\n' "$MOBILE_PORT"
        printf '      publicUrl: "http://127.0.0.1:%s"\n      devAllowInsecure: true\n' "$MOBILE_PORT"
        if [ -n "${MOBILE_WEB_ORIGIN:-}" ]; then
          printf '      allowedOrigins: [%s]\n' "$MOBILE_ORIGIN_YAML"
        fi
      } >> "$overlay"
    fi
  fi
  if [ -n "${CONTEXT_WINDOW:-}" ]; then
    {
      printf -- '- id: llm-deepseek\n  config:\n    models:\n'
      printf -- '      - { id: deepseek-flash, contextWindow: %s, maxTokens: 8000, inputModalities: [text, image] }\n' "$CONTEXT_WINDOW"
      printf -- '      - { id: deepseek-v4-pro, contextWindow: %s, maxTokens: 8000 }\n' "$CONTEXT_WINDOW"
    } >> "$overlay"
  fi
  if [ "${PARITY_UI:-}" = 1 ]; then cat "$PLUGIN/dev/desktop-linux/onboarding.patch.yml" >> "$overlay"; fi
  if [ "${PARITY_APPROVAL:-}" = 1 ]; then
    printf -- '- insert:\n    - id: ds-bot-parity-approval-fixture\n      name: "%s/dev/parity-approval-fixture.mjs"\n      config: {bench: "%s"}\n' "$PLUGIN" "$NAME" >> "$overlay"
  fi
  if [ "${UPDATE_SMOKE:-}" = 1 ]; then
    printf -- '- insert:\n    - id: ds-bot-update-smoke\n      name: "%s/dev/update-fixture.mjs"\n      config: {bench: "%s"}\n' "$PLUGIN" "$NAME" >> "$overlay"
  fi
  if [ "${PARITY_VOICE:-}" = 1 ]; then
    printf -- '- insert:\n    - id: ds-bot-parity-voice-fixture\n      name: "%s/dev/parity-voice-fixture.mjs"\n      config: {bench: "%s"}\n' "$PLUGIN" "$NAME" >> "$overlay"
  fi
  [ -s "$overlay" ] || printf '[]\n' > "$overlay"
}

start() {
  mkdir -p "$HOME_DIR"
  ensure_profile
  write_overlay
  if ! alive mock; then
    rm -f "$HOME_DIR/mock.pid"
    (cd "$PLUGIN" && MOCK_PORT="$MOCK_PORT" MOCK_DELAY_MS="${MOCK_DELAY_MS:-300}" MOCK_LOG="$HOME_DIR/mock.jsonl" \
      exec setsid sh -c 'set -eu; echo $$ >"$1"; shift; exec "$@"' sh "$HOME_DIR/mock.pid" \
      node dev/mock-llm.mjs "$HOME_DIR") </dev/null >"$HOME_DIR/mock.out" 2>&1 &
    # The mock writes its own pid just before it starts; wait for the file so a
    # status or stop right after start does not miss a mock still coming up.
    i=0
    while [ ! -f "$HOME_DIR/mock.pid" ] && [ $i -lt 50 ]; do i=$((i + 1)); sleep 0.1; done
  fi
  if ! alive web; then
    log="$HOME_DIR/web.log"
    rm -f "$log" "$HOME_DIR/web.pid"
    if [ -n "${DSH_CLI:-}" ]; then
      [ -x "$DSH_CLI" ] || { echo "DSH_CLI must name an executable dsh CLI" >&2; exit 1; }
      (cd "$ROOT" && DSH_HOME="$HOME_DIR" DEEPSEEK_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" DEEPSEEK_API_KEY=mock-key \
        exec setsid sh -c 'set -eu; echo $$ >"$1"; shift; exec "$@"' sh "$HOME_DIR/web.pid" \
        "$DSH_CLI" --profile web --patch "$HOME_DIR/bench.patch.yml" --no-open --port "$WEB_PORT") </dev/null >"$log" 2>&1 &
    else
      (cd "$DSH_HARNESS" && DSH_HOME="$HOME_DIR" DEEPSEEK_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" DEEPSEEK_API_KEY=mock-key \
      exec setsid sh -c 'set -eu; echo $$ >"$1"; shift; exec "$@"' sh "$HOME_DIR/web.pid" \
      pnpm -s dsh --profile web --patch apps/web/tests/pin-browse-picker.overlay.yml --patch "$HOME_DIR/bench.patch.yml" \
      --no-open --port "$WEB_PORT") </dev/null >"$log" 2>&1 &
    fi
    # The process writes its own pid just before dsh starts; wait for that file so a
    # start still in progress is not read as an exit.
    i=0
    while [ ! -f "$HOME_DIR/web.pid" ] && [ $i -lt 50 ]; do i=$((i + 1)); sleep 0.1; done
    i=0
    until grep -q "dsh web: http" "$log" 2>/dev/null; do
      i=$((i + 1))
      if [ $i -gt 120 ] || ! alive web; then echo "dsh web did not start; see $log" >&2; tail -20 "$log" | grep -v 'token=' >&2; exit 1; fi
      sleep 1
    done
  fi
  status
}

status() {
  for name in mock web; do
    if alive $name; then echo "$name: running (pid $(cat "$HOME_DIR/$name.pid"))"; else echo "$name: stopped"; fi
  done
  echo "home: $HOME_DIR  web: http://127.0.0.1:$WEB_PORT  mock: $MOCK_PORT"
}

case "$ACTION" in
  start) start ;;
  stop) stop_one web; stop_one mock; status ;;
  reset)
    stop_one web
    stop_one mock
    rm -f "$HOME_DIR/mock.jsonl" "$HOME_DIR/cookies.txt"
    rm -rf "$HOME_DIR/bot" "$HOME_DIR"/sessions/*workspace*/session-*
    start
    ;;
  status) status ;;
  *) echo "unknown action $ACTION" >&2; exit 1 ;;
esac
