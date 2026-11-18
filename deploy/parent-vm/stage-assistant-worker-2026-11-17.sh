#!/bin/bash
# Update only assistant source in a copy of the existing inactive worker release.
set -euo pipefail
umask 077
unit=caselink-parent@worker.service
base=/opt/caselink/releases/636373b4625b92780983ffa49cabfd7a7bbe4a23-worker-20261110
candidate=/opt/caselink/releases/636373b4625b92780983ffa49cabfd7a7bbe4a23-worker-assistant-20261117
web=/opt/caselink/releases/d6e9e9e19aed1d7421d6964cafca9409dd2d0b3c-www-20261117
override=/etc/systemd/system/caselink-parent@worker.service.d/zzzz-assistant-context.conf
test "$(systemctl show "$unit" -p ActiveState --value)" = inactive
test "$(systemctl show "$unit" -p WorkingDirectory --value)" = "$base"
test ! -e "$candidate"
test ! -e "$override"
printf '%s  %s\n' b78eb314b56a3fe51d20b86bfbf2c608a0e18c2ad804deaa5148d59d6bd3b5c0 "$base/src/lib/parent/assistant.ts" | sha256sum --check --status
printf '%s  %s\n' d1865ce1f4c269cd6717ca9f5a9a89fe12a0db4531cb5b597d2670211608f3ce "$web/src/lib/parent/assistant.ts" | sha256sum --check --status
before=$(sha256sum /etc/caselink/worker/profile.json)
mkdir "$candidate"
tar -C "$base" --exclude=./node_modules --exclude=./.next --exclude=./tmp --exclude=./output --exclude=./.git -cf - . | tar -C "$candidate" -xf -
ln -s "$(readlink -f "$base/node_modules")" "$candidate/node_modules"
install -m 644 "$web/src/lib/parent/assistant.ts" "$candidate/src/lib/parent/assistant.ts"
for path in package.json package-lock.json; do cmp "$base/$path" "$candidate/$path"; done
chmod -R a+rX,a-w "$candidate"
cd "$candidate"
runuser -u caselink-worker -- /usr/bin/node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as assistant from './src/lib/parent/assistant.ts';
import * as fixtures from './src/lib/parent/test-fixtures.ts';
const { buildAssistantFacts } = assistant.default ?? assistant;
const { fixtureRequest, fixtureNow } = fixtures.default ?? fixtures;
const facts=buildAssistantFacts({request:fixtureRequest(),account:{language:'es',contactPreference:'in_app',quietHoursStart:20,quietHoursEnd:8,updatedAt:fixtureNow.toISOString()},runtime:{planningReady:false,assistantReady:false},operations:[],reports:[],documents:[],history:[]},fixtureNow).facts;
assert.ok(facts.some(f=>f.id==='account-language'&&f.text.includes('Spanish')));
assert.ok(facts.some(f=>f.id==='account-updates'&&f.text.includes('only in My support')));
console.log('Synthetic account/request context self-check passed; no model or database call.');
JS
test "$before" = "$(sha256sum /etc/caselink/worker/profile.json)"
test "$(systemctl show "$unit" -p ActiveState --value)" = inactive
mkdir -p "$(dirname "$override")"
printf '[Service]\nWorkingDirectory=%s\n' "$candidate" >"$override"
chmod 644 "$override"
systemctl daemon-reload
test "$(systemctl show "$unit" -p WorkingDirectory --value)" = "$candidate"
test "$(systemctl show "$unit" -p ActiveState --value)" = inactive
test "$before" = "$(sha256sum /etc/caselink/worker/profile.json)"
printf 'Updated worker source installed; operating profile unchanged and worker remains inactive.\n'
