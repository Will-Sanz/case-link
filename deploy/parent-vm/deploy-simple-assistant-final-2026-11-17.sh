#!/bin/bash
# One-time request-assistant web rollout; run through the existing Azure VM Run Command.
set -euo pipefail
umask 077
unit=caselink-parent@web.service
work=/var/tmp/caselink-simple-assistant-final-20261117
release=/opt/caselink/releases/d6e9e9e19aed1d7421d6964cafca9409dd2d0b3c-www-20261117
override=/etc/systemd/system/caselink-parent@web.service.d/zzzzz-simple-assistant-final.conf
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
test "$base" = /opt/caselink/releases/148ec2128aae9427f34b33c5a7d5f13b414a36e7-www-20261117
export CASELINK_BANNER_BASE="$base" CASELINK_BANNER_RELEASE="$release" CASELINK_BANNER_WORK="$work"
python3 - <<'PY'
import os,pathlib,hashlib,json,subprocess
base=pathlib.Path(os.environ['CASELINK_BANNER_BASE'])
expected={'src/app/page.tsx':'454682ba0610a986f68c4d9c33723493b7cd8c1bf2d966f8a1300575119d0b16'}
assert all(hashlib.sha256((base/p).read_bytes()).hexdigest()==h for p,h in expected.items())
def snapshot():
 return {'profiles':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/caselink').glob('*/profile.json')},'private':{s:subprocess.check_output(['systemctl','show','caselink-parent@'+s+'.service','-p','ActiveState','-p','MainPID','-p','ExecMainStartTimestamp'],text=True) for s in ['worker','broker','review','sender']}}
work=pathlib.Path(os.environ['CASELINK_BANNER_WORK'])
(work/'before.json').write_text(json.dumps(snapshot(),sort_keys=True))
(work/'old-marker.json').write_text((base/'tmp/parent-hosted-build.json').read_text())
PY
curl --fail --location --max-time 90 --silent --show-error https://codeload.github.com/Will-Sanz/case-link/tar.gz/d6e9e9e19aed1d7421d6964cafca9409dd2d0b3c -o "$work/source.tgz"
mkdir "$release"
tar -xzf "$work/source.tgz" --strip-components=1 -C "$release"
cp -a --reflink=auto "$(readlink -f "$base/node_modules")" "$release/node_modules"
test "$(readlink -f "$release/node_modules")" = "$release/node_modules"
test -f "$release/node_modules/next/package.json"
python3 - <<'PY'
import os,pathlib,hashlib
r=pathlib.Path(os.environ['CASELINK_BANNER_RELEASE']);b=pathlib.Path(os.environ['CASELINK_BANNER_BASE'])
for p,h in {'src/features/parent/floating-assistant.tsx': '660041faf2d1c76069ac953bb9f463441016dee8cfcb1ce45d7d7829656987b4', 'src/features/parent/support-assistant.tsx': 'e61b129feb26286968fb8acaf600b08e4f26f2bb07776a2543a1397b95c4607e', 'src/features/parent/my-support.tsx': 'cfa7ed2ed0fd9777cc61e53a63434d59f3111825fe970f8b095d8d79895a9cc3', 'src/lib/parent/assistant.ts': 'd1865ce1f4c269cd6717ca9f5a9a89fe12a0db4531cb5b597d2670211608f3ce'}.items(): assert hashlib.sha256((r/p).read_bytes()).hexdigest()==h
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
cache=/var/lib/caselink-web/cache-assistant-d6e9e9e
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
