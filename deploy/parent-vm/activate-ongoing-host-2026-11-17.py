#!/usr/bin/env python3
"""Stage only reviewed launcher changes, then activate the owner's existing profiles."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

WORK = Path('/var/tmp/caselink-ongoing-20261117')
ROLES = ['web', 'frontdoor', 'worker', 'broker', 'review', 'retention', 'ordinary-retention', 'sender']
BASES = {
    'web': 'd6e9e9e19aed1d7421d6964cafca9409dd2d0b3c-www-20261117',
    'shared': '5900b9404b0ac8f20e8fe71c6d18327fc979f9ca-www-20261110-r3',
    'worker': '636373b4625b92780983ffa49cabfd7a7bbe4a23-worker-assistant-20261117',
}
FILES = {
    'scripts/parent-hosted-profile.ts': ('670ee4adb0a571372bd3b288fee7cf0aaae48dcec09f26fc70e75bd1632385cd', 'a8ea63d023306a1a68a76a131a10ca839d26235114990b72a5b071ea3a337e4c'),
    'scripts/parent-support-retention.ts': ('22df76adfc03a0e5a9b85bff6f385ced4d13a9bfd355e8387fca995255dc99d8', 'ac5b9bacba47a8e171d2b6bab780ffc26ef48bf660b1ef22285b9de15421858d'),
    'src/lib/parent/hosted-service.ts': ('8486d993c0b0e90fe88c3ca45003b38daa4fcd8071a449bf132f6c00bba4a93e', '72d2932a6473b9af9b098bbc17fdd5c0783fe0a16f316e66332739dd203b1846'),
}
REFERENCE = 'Owner explicitly approved ongoing existing services until revoked on 2026-11-17; sending remains disabled'
OVERRIDE = 'zzzzzz-ongoing-20261117.conf'


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unit(role):
    return 'caselink-parent@' + role + '.service'


def target(role):
    key = role if role in ('web', 'worker') else 'shared'
    return Path('/opt/caselink/releases') / (BASES[key] + '-ongoing-20261117')


def profile_path(role):
    return Path('/etc/caselink') / role / 'profile.json'


def ongoing_profile(value, role):
    assert value['service'] == role, 'Profile service changed'
    assert value['publicOrigin'] == ('https://pilot.thecaselink.com' if role == 'sender' else 'https://www.thecaselink.com'), 'Public origin changed'
    assert value['projectOrigin'] == 'https://zpfypkizsapvsxeykmdq.supabase.co', 'Project changed'
    assert value['enabled'] is (role != 'sender'), 'Service enablement changed'
    if role == 'sender':
        assert value['sendingApproved'] is False, 'Sending must remain disabled'
    until = '2000-01-01T00:00:00Z' if role == 'sender' else '2027-11-08T05:00:00Z' if role in ('web', 'frontdoor') else '2026-11-17T21:07:45Z' if role == 'worker' else '2026-11-11T05:00:00Z'
    assert value['approvedUntil'] == until, 'Operating profile changed'
    return {**value, 'approvedUntil': None, 'approvalReference': REFERENCE}


def replace_private(path, contents, metadata):
    assert not path.is_symlink() and path.is_file(), 'Private profile must be a regular file'
    assert path.stat().st_nlink == 1, 'Private profile has extra links'
    fd, name = tempfile.mkstemp(prefix='.ongoing-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)



def backup_private(path, contents, metadata):
    backup = path.with_name('profile.before-ongoing-20261117.json')
    if backup.exists():
        assert not backup.is_symlink() and backup.stat().st_nlink == 1
        assert backup.stat().st_mode & 0o777 == 0o600 and backup.stat().st_uid == metadata.st_uid
        assert backup.read_bytes() == contents, 'Existing rollback profile changed'
    else:
        with open(backup, 'xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
    return backup


def stage():
    assert os.getuid() == 0, 'Run as the existing VM administrator'
    assert shutil.disk_usage('/opt/caselink').free > 3_000_000_000, 'Insufficient staging space'
    snapshot = {}
    for role in ROLES:
        p = profile_path(role)
        assert not p.is_symlink() and p.stat().st_nlink == 1 and p.stat().st_mode & 0o777 == 0o600
        assert p.parent.stat().st_mode & 0o777 == 0o700
        ongoing_profile(json.loads(p.read_bytes()), role)
        key = role if role in ('web', 'worker') else 'shared'
        base = Path(run(['systemctl', 'show', unit(role), '-p', 'WorkingDirectory', '--value'])).resolve()
        assert base == Path('/opt/caselink/releases') / BASES[key], 'Installed release changed'
        snapshot[role] = {'hash': sha(p), 'base': str(base)}
    assert not WORK.is_symlink(), 'Staging path changed'
    WORK.mkdir(mode=0o755, exist_ok=True)
    for f, (_, expected) in FILES.items():
        dst = WORK / 'source' / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '60', 'https://raw.githubusercontent.com/Will-Sanz/case-link/f5b5de90a9c27fffc06251e6d3bb659411d01566/' + f, '-o', str(dst)])
        assert sha(dst) == expected, 'Reviewed source hash mismatch'
    for key, name in BASES.items():
        base = Path('/opt/caselink/releases') / name
        dst = target(key if key != 'shared' else 'frontdoor')
        for f, (expected, _) in FILES.items():
            assert sha(base / f) == expected, 'Baseline source changed'
        if dst.exists():
            assert all(sha(dst / f) == expected for f, (_, expected) in FILES.items()), 'Existing staged source changed'
            assert (dst / 'node_modules').resolve() == (base / 'node_modules').resolve(), 'Staged dependencies changed'
        else:
            shutil.copytree(base, dst, symlinks=True, ignore=lambda directory, names: [n for n in names if Path(directory) == base and n in ('node_modules', '.git', 'tmp', 'output')])
            (dst / 'node_modules').symlink_to((base / 'node_modules').resolve())
            for f in FILES:
                shutil.copyfile(WORK / 'source' / f, dst / f)
                (dst / f).chmod(0o644)
        if key == 'web':
            (dst / 'tmp').mkdir(mode=0o755, exist_ok=True)
            (dst / 'tmp').chmod(0o755)
            shutil.copyfile(base / 'tmp/parent-hosted-build.json', dst / 'tmp/parent-hosted-build.json')
            (dst / 'tmp/parent-hosted-build.json').chmod(0o644)
            assert (base / '.next/BUILD_ID').read_bytes() == (dst / '.next/BUILD_ID').read_bytes()
        for f in ('package.json', 'package-lock.json'):
            assert sha(base / f) == sha(dst / f), 'Dependencies changed'
    check = """import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
import * as profile from './scripts/parent-hosted-profile.ts'; import * as launch from './scripts/parent-hosted-services.ts';
const p=profile.default??profile,l=launch.default??launch,s=process.argv[1],path='/etc/caselink/'+s+'/profile.json';
const c=JSON.parse(readFileSync(path,'utf8')),next={...c,approvedUntil:null,approvalReference:'Explicit ongoing owner approval'};
if(s==='sender'){assert.equal(c.enabled,false);assert.equal(c.sendingApproved,false);assert.throws(()=>p.parseHostedProfile(next));}
else{const cfg=p.parseHostedProfile(next,Date.parse('2030-01-01T00:00:00Z'));assert.equal(p.hostedChildEnvironment(cfg).CASELINK_PARENT_HOSTED_APPROVED_UNTIL,'ongoing');
if(s==='web')assert.equal(l.hostedWebFingerprint(cfg),JSON.parse(readFileSync('tmp/parent-hosted-build.json','utf8')).fingerprint);}
for(const other of ['web','frontdoor','worker','broker','review','retention','ordinary-retention','sender'])if(other!==s)assert.throws(()=>readFileSync('/etc/caselink/'+other+'/profile.json'),{code:'EACCES'});
"""
    for role in ROLES:
        run(['/usr/sbin/runuser', '-u', 'caselink-' + role, '--', '/usr/bin/node', '--import', 'tsx', '--input-type=module', '-e', check, role], cwd=target(role), env={'PATH': '/usr/bin:/bin', 'NODE_ENV': 'production'})
        assert sha(profile_path(role)) == snapshot[role]['hash'], 'Concurrent profile change'
    (WORK / 'snapshot.json').write_text(json.dumps(snapshot))
    print('STAGED: three existing releases; eight own-profile reads and 56 cross-profile denials passed; profiles and services unchanged.')


def activate():
    snapshot = json.loads((WORK / 'snapshot.json').read_text())
    overrides = []
    changed = []
    timers = ['caselink-parent-' + r + '.timer' for r in ('retention', 'ordinary-retention')]
    services = ['caselink-parent-' + r + '.service' for r in ('retention', 'ordinary-retention')]
    assert all(sha(profile_path(r)) == snapshot[r]['hash'] for r in ROLES), 'Concurrent profile change'
    for r in ROLES:
        assert Path(run(['systemctl', 'show', unit(r), '-p', 'WorkingDirectory', '--value'])).resolve() == Path(snapshot[r]['base'])
    try:
        run(['systemctl', 'stop', *timers, *services])
        for role in ROLES:
            p = profile_path(role); assert not p.is_symlink(); raw = p.read_bytes(); metadata = p.stat()
            assert hashlib.sha256(raw).hexdigest() == snapshot[role]['hash'], 'Concurrent profile change'
            backup_private(p, raw, metadata)
            value = ongoing_profile(json.loads(raw), role)
            replace_private(p, json.dumps(value).encode(), metadata)
            changed.append(role)
            override = Path('/etc/systemd/system') / (unit(role) + '.d') / OVERRIDE
            override.parent.mkdir(parents=True, exist_ok=True)
            assert not override.exists()
            override.write_text('[Service]\nWorkingDirectory=' + str(target(role)) + '\n'); override.chmod(0o644); overrides.append(override)
        for service, role in zip(services, ('retention', 'ordinary-retention')):
            override = Path('/etc/systemd/system') / (service + '.d') / OVERRIDE
            override.parent.mkdir(parents=True, exist_ok=True); assert not override.exists()
            override.write_text('[Service]\nWorkingDirectory=' + str(target(role)) + '\n'); override.chmod(0o644); overrides.append(override)
        run(['systemctl', 'daemon-reload'])
        for service in [unit(r) for r in ('web', 'frontdoor', 'broker', 'review', 'worker')] + services:
            if run(['systemctl', 'show', service, '-p', 'ActiveState', '--value']) == 'failed':
                run(['systemctl', 'reset-failed', service])
        run(['systemctl', 'restart', unit('web'), unit('frontdoor')])
        run(['systemctl', 'start', unit('broker'), unit('review'), unit('worker')])
        run(['systemctl', 'start', *timers])
        deadline = time.monotonic() + 20
        ready = False
        while time.monotonic() < deadline:
            active = all(subprocess.run(['systemctl', 'is-active', unit(r)], capture_output=True).returncode == 0 for r in ('web', 'frontdoor', 'broker', 'review', 'worker'))
            health = subprocess.run(['curl', '--fail', '--silent', '--max-time', '2', 'http://127.0.0.1:3100/api/health'], capture_output=True).returncode == 0
            if active and health:
                ready = True
                break
            time.sleep(1)
        assert ready, 'Service readiness failed; restoring original profiles and releases'
        for role in ROLES:
            p = profile_path(role); actual = json.loads(p.read_bytes()); before = json.loads(p.with_name('profile.before-ongoing-20261117.json').read_bytes())
            assert actual == ongoing_profile(before, role), 'Unexpected profile change'
            assert p.stat().st_mode & 0o777 == 0o600 and p.stat().st_uid == p.parent.stat().st_uid
        assert subprocess.run(['systemctl', 'is-active', unit('sender')], capture_output=True).returncode != 0, 'Sender must remain stopped'
        (WORK / 'activated.json').write_text(json.dumps({'profiles': 8, 'deadline': None, 'senderStarted': False}))
        print('ACTIVATED: all eight profiles have no operating deadline; sending remains disabled; existing cleanup timers resumed.')
    except BaseException:
        subprocess.run(['systemctl', 'stop', *timers, *services, unit('worker'), unit('broker'), unit('review')], capture_output=True)
        for role in reversed(changed):
            p = profile_path(role); replace_private(p, p.with_name('profile.before-ongoing-20261117.json').read_bytes(), p.stat())
        for override in reversed(overrides):
            override.unlink()
        subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
        subprocess.run(['systemctl', 'restart', unit('web'), unit('frontdoor'), *timers], capture_output=True)
        raise


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ('stage', 'activate')
    try:
        (stage if sys.argv[1] == 'stage' else activate)()
    except Exception as error:
        print('STOPPED:', type(error).__name__, str(error)[:200])
        sys.exit(1)
