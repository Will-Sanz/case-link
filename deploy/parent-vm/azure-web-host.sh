#!/bin/bash
set -euo pipefail
umask 077

# The reviewed runner prepends the fixed operation and validated release metadata.
unit=caselink-parent@web.service
profile=/etc/caselink/web/profile.json
releases=/opt/caselink/releases
origin=https://www.thecaselink.com
active_release() { systemctl show "$unit" --property=WorkingDirectory --value; }
build_of() { cat "$1/.next/BUILD_ID"; }

test "$(hostname)" = caselink-dev-01
test "$(systemctl show "$unit" --property=User --value)" = caselink-web
test "$(stat -c '%U:%a' "$profile")" = caselink-web:600
systemctl show "$unit" --property=ExecStart --value | python3 -c 'import re,sys; a=re.search(r"argv\[\]=([^;]+)",sys.stdin.read()); assert a and a.group(1).split() == ["/usr/bin/node","--import","tsx","scripts/parent-hosted-services.ts","/etc/caselink/web/profile.json"]'

matches_build() {
  local build=$1 body
  curl -fsS --max-time 3 http://127.0.0.1:3100/api/health >/dev/null &&
    body=$(curl -fsS --max-time 5 "$origin/get-support?release=$build") && [[ "$body" == *"$build"* ]]
}

healthy_build() {
  for _ in {1..20}; do
    if matches_build "$1"; then return 0; fi
    sleep 1
  done
  return 1
}

if [ "$operation" = inspect ]; then
  current=$(active_release)
  [[ "$current" =~ ^/opt/caselink/releases/[a-f0-9]{40}-[a-zA-Z0-9_-]+$ ]]
  current_build=$(build_of "$current")
  healthy_build "$current_build"
  printf 'CASELINK %s %s %s\n' "$command_id" "$current" "$current_build"
  exit 0
fi

[[ "$release_id" =~ ^[a-f0-9]{12}$ && "$sha" =~ ^[a-f0-9]{40}$ ]]
[[ "$previous" =~ ^/opt/caselink/releases/[a-f0-9]{40}-[a-zA-Z0-9_-]+$ ]]
stage="/var/tmp/caselink-azure-web-$release_id"
release="$releases/$sha-www-$release_id"
exec 9>/run/lock/caselink-web-release.lock
flock -n 9

if [ "$operation" = stage ]; then
  test "$(active_release)" = "$previous"
  mkdir -m 0700 "$stage"
  sha256sum "$profile" > "$stage/profile.sha256"
  curl -fsSL --retry 2 --max-time 90 "https://raw.githubusercontent.com/Will-Sanz/case-link/$sha/deploy/parent-vm/package-release.py" -o "$stage/packer.py"
  printf '%s  %s\n' "$packer_sha" "$stage/packer.py" | sha256sum -c --status
  printf '%s' "$manifest_b64" | base64 -d | gzip -d > "$stage/manifest.json"
  curl -fsSL --retry 2 --max-time 120 "https://codeload.github.com/Will-Sanz/case-link/tar.gz/$sha" -o "$stage/source.tar.gz"
  python3 "$stage/packer.py" extract --manifest "$stage/manifest.json" --manifest-sha256 "$manifest_sha" \
    --archive "$stage/source.tar.gz" --github-archive --output "$release" > "$stage/source-receipt.json"

  install -d -m 0755 "$release/tmp"
  chown -hR caselink-web:caselink-web "$release"
  build_bin=$(mktemp -d /run/caselink-web-build.XXXXXX)
  chmod 0755 "$build_bin"
  trap 'rm -- "$build_bin/npm"; rmdir -- "$build_bin"' EXIT
  cat > "$build_bin/npm" <<'BUILD_NPM'
#!/bin/bash
set -euo pipefail
if [ "$#" -eq 2 ] && [ "$1" = run ] && [ "$2" = build ]; then
  /usr/bin/node node_modules/next/dist/bin/next typegen
  /usr/bin/node node_modules/typescript/bin/tsc --noEmit
  /usr/bin/npm run build -- --experimental-build-mode compile
  exec /usr/bin/node node_modules/next/dist/bin/next build --experimental-build-mode generate
fi
exec /usr/bin/npm "$@"
BUILD_NPM
  chmod 0755 "$build_bin/npm"
  if ! systemd-run --quiet --wait --pipe --collect --unit="caselink-web-build-$release_id" \
    --uid=caselink-web --gid=caselink-web --working-directory="$release" \
    --property=MemoryMax=2G --property=CPUQuota=100% --property=UMask=0022 --property=RuntimeMaxSec=18min \
    --property=ProtectSystem=strict --property=ReadWritePaths="$release" --property=ProtectHome=yes \
    --property=ProtectProc=invisible --property=PrivateTmp=yes --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes --property=CapabilityBoundingSet= --property=RestrictSUIDSGID=yes \
    /usr/bin/env -i PATH="$build_bin:/usr/bin:/bin" TMPDIR=/tmp HOME="$release/tmp" HUSKY=0 \
    /bin/bash -e -c '/usr/bin/npm ci --no-audit --no-fund && /usr/bin/node --import tsx scripts/parent-hosted-services.ts /etc/caselink/web/profile.json build' > "$stage/build.log" 2>&1; then
    printf 'Build failed. Host-only log: %s/build.log\n' "$stage" >&2
    exit 1
  fi

  test -s "$release/.next/prerender-manifest.json"
  test "$(active_release)" = "$previous"
  sha256sum -c --status "$stage/profile.sha256"
  cache="/var/lib/caselink-web/cache-www-$release_id"
  test ! -e "$cache"
  test ! -L "$cache"
  install -d -o caselink-web -g caselink-web -m 0700 "$cache"
  if [ -d "$release/.next/cache" ]; then mv -- "$release/.next/cache" "$release/tmp/compiled-cache"; fi
  ln -s "$cache" "$release/.next/cache"
  chown -hR root:root "$release"
  find "$release" -type d -exec chmod a+rx,go-w {} +
  chmod -R go-w "$release"
  chmod 0644 "$release/tmp/parent-hosted-build.json"
  runuser -u caselink-web -- test -r "$release/tmp/parent-hosted-build.json"
  runuser -u caselink-web -- test -w "$cache"
  new_build=$(build_of "$release")
  python3 - "$stage/manifest.json" "$release" "$new_build" <<'VERIFY_SOURCE'
import hashlib, json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_bytes())
root = pathlib.Path(sys.argv[2])
for row in manifest['files']:
    path = root / row['path']
    assert path.resolve(strict=True) == path and path.stat().st_size == row['size'], row['path']
    with path.open('rb') as source:
        assert hashlib.file_digest(source, 'sha256').hexdigest() == row['sha256'], row['path']
assert json.loads((root / 'tmp/parent-hosted-build.json').read_bytes())['buildId'] == sys.argv[3]
VERIFY_SOURCE
  printf 'CASELINK %s %s\n' "$command_id" "$new_build"
  exit 0
fi

old_build=$(build_of "$previous")
new_build=$(build_of "$release")
dropdir=/etc/systemd/system/caselink-parent@web.service.d
restore() {
  local current dropin reload=0
  current=$(active_release) || return
  [[ "$current" == "$previous" || "$current" == "$release" ]] || return 1
  if [ -f "$stage/dropin-path" ]; then
    dropin=$(cat "$stage/dropin-path") || return
    [[ "$dropin" == "$dropdir"/zzzzzzzzz-www-*"-$release_id.conf" ]] || return 1
    if [ -e "$dropin" ] || [ -L "$dropin" ]; then
      test ! -L "$dropin" && cmp -- "$dropin" "$stage/dropin.conf" && rm -- "$dropin" || return
      reload=1
    fi
  elif [ "$current" = "$release" ]; then
    return 1
  fi
  if [ "$current" = "$release" ] || [ "$reload" = 1 ]; then
    systemctl daemon-reload && test "$(active_release)" = "$previous" || return
  fi
  if [ "$current" = "$previous" ] && matches_build "$old_build"; then return 0; fi
  test -f "$stage/dropin-path" || return
  if ! systemctl restart "$unit"; then
    test "$(systemctl show "$unit" --property=Result --value)" = start-limit-hit &&
      systemctl reset-failed "$unit" && systemctl restart "$unit" || return
  fi
  healthy_build "$old_build"
}
if [ "$operation" = reconcile ]; then
  current=$(active_release)
  if [ "$current" = "$release" ] && test -f "$stage/activated" && test "$(cat "$stage/activated")" = "$new_build" && healthy_build "$new_build"; then
    printf 'CASELINK %s activated %s\n' "$command_id" "$new_build"
  elif restore; then
    printf 'CASELINK %s previous %s\n' "$command_id" "$old_build"
  else
    printf 'CASELINK %s unverified\n' "$command_id"
  fi
  exit 0
fi
if [ "$operation" = rollback ]; then
  restore
  printf 'CASELINK %s %s\n' "$command_id" "$old_build"
  exit 0
fi

test "$operation" = activate
test "$(active_release)" = "$previous"
sha256sum -c --status "$stage/profile.sha256"
other_state() {
  systemctl show caselink-parent@{frontdoor,broker,review,worker,sender}.service --property=Id,WorkingDirectory,ActiveState,MainPID
  systemctl show caddy.service caselink-parent-retention.timer caselink-parent-ordinary-retention.timer --property=Id,ActiveState,UnitFileState
  sha256sum /etc/caddy/Caddyfile
  find /etc/caselink -maxdepth 2 -name profile.json -type f -print0 | sort -z | xargs -0 sha256sum
}
other_state > "$stage/before-services"
override="$dropdir/zzzzzzzzz-www-$(date -u +%Y%m%d%H%M%S)-$release_id.conf"
test ! -e "$override"
printf '%s\n' "$override" > "$stage/dropin-path"
printf '[Service]\nWorkingDirectory=%s\n' "$release" > "$stage/dropin.conf"
test -d "$dropdir"
candidate=$(mktemp "$dropdir/.caselink-web.XXXXXX")
install -m 0644 "$stage/dropin.conf" "$candidate"
rollback_on_error() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && cmp -s "$override" "$stage/dropin.conf"; then
    if restore; then printf 'Restored the previous healthy build.\n' >&2; else printf 'Rollback could not be verified.\n' >&2; fi
  fi
  exit "$status"
}
trap rollback_on_error EXIT
mv -T -- "$candidate" "$override"
systemctl daemon-reload
test "$(active_release)" = "$release"
systemctl restart "$unit"
healthy_build "$new_build"
other_state > "$stage/after-services"
cmp -- "$stage/before-services" "$stage/after-services"
printf '%s\n' "$new_build" > "$stage/activated"
trap - EXIT
printf 'CASELINK %s %s\n' "$command_id" "$new_build"
