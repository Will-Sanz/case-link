#!/bin/bash
# One-time web-only rollout; run through the existing Azure VM Run Command.
set -euo pipefail
umask 077
unit=caselink-parent@web.service
work=/var/tmp/caselink-banner-release-20261117
release=/opt/caselink/releases/5128d3933ceca03919c519feb84106e5a39b1393-www-20261117
override=/etc/systemd/system/caselink-parent@web.service.d/zz-banner-cleanup.conf
mkdir -p "$work"
exec >"$work/deploy.log" 2>&1
switched=0
finish() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    if [ "$switched" = 1 ]; then
      rm -f "$override"
      systemctl daemon-reload
      systemctl restart "$unit" || true
    fi
    printf '{"state":"failed","exitCode":%s,"rollbackAttempted":%s}\n' "$code" "$switched" >"$work/status.json"
  fi
  exit "$code"
}
trap finish EXIT
printf '{"state":"checking"}\n' >"$work/status.json"
test ! -e "$release"
test ! -e "$override"
base=$(systemctl show "$unit" -p WorkingDirectory --value)
test "$base" = /opt/caselink/releases/68675c1ca5659830ca1959d37cb883b84e5c77d5-www-20261112
export CASELINK_BANNER_BASE="$base" CASELINK_BANNER_RELEASE="$release" CASELINK_BANNER_WORK="$work"
python3 - <<'PY'
import os,pathlib,hashlib,json,subprocess
base=pathlib.Path(os.environ['CASELINK_BANNER_BASE'])
expected={'src/features/parent/support-detail.tsx':'aedb2cf6225b5693379ec019e722d813f0f24f2b31e71f4f9acbf3e774891e3d','src/features/parent/support-activity.tsx':'f29225df4d103df05e934688c0ad1a5dcf24bffe00d159142782ae9bdb4675d8'}
assert all(hashlib.sha256((base/p).read_bytes()).hexdigest()==h for p,h in expected.items())
def snapshot():
 return {'profiles':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/caselink').glob('*/profile.json')},'private':{s:subprocess.check_output(['systemctl','show','caselink-parent@'+s+'.service','-p','ActiveState','-p','MainPID','-p','ExecMainStartTimestamp'],text=True) for s in ['worker','broker','review','sender']}}
work=pathlib.Path(os.environ['CASELINK_BANNER_WORK'])
(work/'before.json').write_text(json.dumps(snapshot(),sort_keys=True))
(work/'old-marker.json').write_text((base/'tmp/parent-hosted-build.json').read_text())
PY
curl --fail --location --max-time 90 --silent --show-error https://codeload.github.com/Will-Sanz/case-link/tar.gz/5128d3933ceca03919c519feb84106e5a39b1393 -o "$work/source.tgz"
mkdir "$release"
tar -xzf "$work/source.tgz" --strip-components=1 -C "$release"
cp -a --reflink=auto "$(readlink -f "$base/node_modules")" "$release/node_modules"
test "$(readlink -f "$release/node_modules")" = "$release/node_modules"
test -f "$release/node_modules/next/package.json"
python3 - <<'PY'
import os,pathlib,hashlib
r=pathlib.Path(os.environ['CASELINK_BANNER_RELEASE']);b=pathlib.Path(os.environ['CASELINK_BANNER_BASE'])
for p,h in {'src/features/parent/support-detail.tsx':'bce72ad794b57dc6c5700e8b98316115aa7b39e5f6d16a7020f6c52c5f6fbe3b','src/features/parent/support-activity.tsx':'a4ec95fc756d2707b5c25b6dbde33f07a825d1b477c48cdd96271753b2f44493'}.items(): assert hashlib.sha256((r/p).read_bytes()).hexdigest()==h
for p in ['package.json','package-lock.json']: assert (r/p).read_bytes()==(b/p).read_bytes()
assert not any((r/p).exists() for p in ['.env','.env.local','.env.production','.env.production.local'])
PY
chown -hR caselink-web:caselink-web "$release"
printf '{"state":"building"}\n' >"$work/status.json"
cd "$release"
timeout --kill-after=10 600 runuser -u caselink-web -- /usr/bin/node --import tsx scripts/parent-hosted-services.ts /etc/caselink/web/profile.json build
python3 - <<'PY'
import os,pathlib,json,subprocess,hashlib
r=pathlib.Path(os.environ['CASELINK_BANNER_RELEASE']);w=pathlib.Path(os.environ['CASELINK_BANNER_WORK'])
assert json.loads((r/'tmp/parent-hosted-build.json').read_text())['fingerprint']==json.loads((w/'old-marker.json').read_text())['fingerprint']
snapshot={'profiles':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/caselink').glob('*/profile.json')},'private':{s:subprocess.check_output(['systemctl','show','caselink-parent@'+s+'.service','-p','ActiveState','-p','MainPID','-p','ExecMainStartTimestamp'],text=True) for s in ['worker','broker','review','sender']}}
assert snapshot==json.loads((w/'before.json').read_text()),'Concurrent service/configuration change; do not cut over'
PY
cache=/var/lib/caselink-web/cache-banner-5128d39
test ! -e "$cache"
mv "$release/.next/cache" "$cache"
ln -s "$cache" "$release/.next/cache"
chown -hR root:root "$release"
chmod -R a+rX,a-w "$release"
printf '[Service]\nWorkingDirectory=%s\n' "$release" >"$override"
chmod 644 "$override"
switched=1
systemctl daemon-reload
systemctl restart "$unit"
ready=0
for attempt in $(seq 1 15); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3100/api/health >/dev/null; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
test "$(systemctl show "$unit" -p WorkingDirectory --value)" = "$release"
curl --fail --silent --show-error --max-time 15 --resolve www.thecaselink.com:443:127.0.0.1 https://www.thecaselink.com/sign-in >"$work/public-sign-in.html"
python3 - <<'PY'
import os,pathlib,json,hashlib,subprocess
r=pathlib.Path(os.environ['CASELINK_BANNER_RELEASE']);w=pathlib.Path(os.environ['CASELINK_BANNER_WORK'])
snapshot={'profiles':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/caselink').glob('*/profile.json')},'private':{s:subprocess.check_output(['systemctl','show','caselink-parent@'+s+'.service','-p','ActiveState','-p','MainPID','-p','ExecMainStartTimestamp'],text=True) for s in ['worker','broker','review','sender']}}
assert snapshot==json.loads((w/'before.json').read_text()),'Service/configuration changed during cutover'
(w/'status.json').write_text(json.dumps({'state':'deployed','release':str(r),'buildId':(r/'.next/BUILD_ID').read_text().strip()}))
PY
