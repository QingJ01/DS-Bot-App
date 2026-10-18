#!/bin/sh
# Runs dsh web as the node user. The container is the sandbox boundary, so the
# image offers only the danger-full-access preset (see docker.patch.yml).
set -eu

PUID=${PUID:-1000}
PGID=${PGID:-1000}
groupmod -o -g "$PGID" node
usermod -o -u "$PUID" node

image_sha=$(sha256sum /opt/ds-bot/ds-bot.tgz | cut -d ' ' -f 1)
snapshot=/data/profiles/.web-ds-bot-snapshot
snapshot_tmp=/data/profiles/.web-ds-bot-snapshot.tmp
stamp=/data/.ds-bot-image.sha256
stamp_tmp=/data/.ds-bot-image.sha256.tmp

# First start: seed the data volume with the template home built into the image
# (a web profile that already has ds-bot installed).
if [ ! -d /data/profiles/web ]; then
  mkdir -p /data
  cp -a /opt/dsh-template/. /data/
  printf '%s\n' "$image_sha" > /data/.ds-bot-image.sha256
fi

if [ -d /opt/ds-bot/pnpm-store/v11 ]; then
  if mkdir -p /data/.pnpm-store/v11 \
    && cp -a /opt/ds-bot/pnpm-store/v11/. /data/.pnpm-store/v11/; then
    :
  else
    echo "entrypoint: could not seed the pnpm store; offline reinstall may fail" >&2
  fi
fi
chown -R node:node /home/node/.cache/pnpm 2>/dev/null || true

# Existing profiles and restored backups can belong to a previous PUID/PGID.
# Do not follow links into workspace shares or descend into other filesystems.
find -P /data -xdev \( ! -uid "$PUID" -o ! -gid "$PGID" \) \
  -exec chown -h node:node -- {} +

restore_snapshot() {
  [ -d "$snapshot" ] || return 0
  echo "entrypoint: recovering an interrupted ds-bot reinstall"
  if [ -d "$snapshot/profile" ]; then
    if ! rm -rf /data/profiles/web || ! mv "$snapshot/profile" /data/profiles/web; then
      echo "entrypoint: could not restore the previous web profile" >&2
      return 1
    fi
  fi
  if [ -f "$snapshot/stamp" ]; then
    if ! rm -f "$stamp" || ! mv "$snapshot/stamp" "$stamp"; then
      echo "entrypoint: could not restore the previous archive stamp" >&2
      return 1
    fi
  elif [ -f "$snapshot/stamp-missing" ]; then
    if ! rm -f "$stamp"; then
      echo "entrypoint: could not restore the missing archive stamp" >&2
      return 1
    fi
  fi
  rm -rf "$snapshot" || echo "entrypoint: could not remove the recovered reinstall snapshot" >&2
}

if ! restore_snapshot; then
  echo "entrypoint: continuing after incomplete profile recovery" >&2
fi
rm -rf "$snapshot_tmp" || echo "entrypoint: could not remove an incomplete reinstall snapshot" >&2

make_snapshot() {
  if ! mkdir -p "$snapshot_tmp"; then return 1; fi
  if ! cp -a /data/profiles/web "$snapshot_tmp/profile"; then
    rm -rf "$snapshot_tmp"
    return 1
  fi
  if [ -f "$stamp" ]; then
    if ! cp -a "$stamp" "$snapshot_tmp/stamp"; then
      rm -rf "$snapshot_tmp"
      return 1
    fi
  else
    : > "$snapshot_tmp/stamp-missing"
  fi
  mv "$snapshot_tmp" "$snapshot"
}

mkdir -p /workspace
# Only claim an empty /workspace; a populated share keeps its owners.
if [ -z "$(ls -A /workspace)" ]; then
  chown node:node /workspace
fi

# Keep an existing volume's ds-bot in step with the image. A failed reinstall
# is logged but never blocks the start — the old plugin keeps working.
installed_ver=$(jq -r .version /data/profiles/web/node_modules/ds-bot/package.json 2>/dev/null || echo missing)
image_ver=$(jq -r .version /opt/dsh-template/profiles/web/node_modules/ds-bot/package.json)
installed_sha=$(cat "$stamp" 2>/dev/null || echo missing)
if [ "$installed_ver" != "$image_ver" ] || [ "$installed_sha" != "$image_sha" ]; then
  echo "entrypoint: ds-bot version or image archive differs; reinstalling into the web profile"
  if make_snapshot; then
    if HOME=/home/node timeout --kill-after=5s 180s gosu node dsh plugin --profile web add /opt/ds-bot/ds-bot.tgz --offline \
      && printf '%s\n' "$image_sha" | gosu node tee "$stamp_tmp" >/dev/null \
      && mv "$stamp_tmp" "$stamp"; then
      rm -rf "$snapshot" || echo "entrypoint: could not remove the completed reinstall snapshot" >&2
    else
      reinstall_status=$?
      rm -f "$stamp_tmp"
      echo "entrypoint: ds-bot reinstall failed or timed out (status $reinstall_status); restoring the previous profile" >&2
      if ! restore_snapshot; then
        echo "entrypoint: continuing after incomplete profile recovery" >&2
      fi
    fi
  else
    echo "entrypoint: could not snapshot the web profile; skipping reinstall" >&2
  fi
fi

# This dsh release accepts only 127.0.0.1 for --host, so an overlay binds all
# interfaces instead; the container's publish rule is the network boundary.
# DSH_LISTEN_PORT only matters with network_mode: host — published ports
# always map to 3080 inside.
HOST=${DSH_HOST:-0.0.0.0}
LISTEN_PORT=${DSH_LISTEN_PORT:-3080}
case "$HOST" in
  0.0.0.0|127.0.0.1) ;;
  *) echo "entrypoint: DSH_HOST must be 0.0.0.0 or 127.0.0.1 (got '$HOST')" >&2; exit 1 ;;
esac
case "$LISTEN_PORT" in
  ''|*[!0-9]*) echo "entrypoint: DSH_LISTEN_PORT must be a port number (got '$LISTEN_PORT')" >&2; exit 1 ;;
esac

# The webserver row's whole config is replaced by a patch, so its bundle values
# (compression on this dsh release) are restated literally.
cat > /tmp/listen.patch.yml <<EOF
- id: webserver
  config:
    host: $HOST
    port: $LISTEN_PORT
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
EOF

# --patch is a dsh option and must precede the app's own flags.
set -- dsh --profile web \
  --patch /opt/ds-bot/docker.patch.yml --patch /tmp/listen.patch.yml \
  --no-open "$@"

if [ -n "${DSH_TRUSTED_HOST:-}" ]; then
  old_ifs=$IFS
  IFS=','
  for trusted in $DSH_TRUSTED_HOST; do
    [ -n "$trusted" ] && set -- "$@" --trusted-host "$trusted"
  done
  IFS=$old_ifs
fi
export HOME=/home/node
cd /workspace
exec gosu node "$@"
