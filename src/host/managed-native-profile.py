"""Trusted supervisor-side setup; none of these paths or FDs enter model env."""
import fcntl
import json
import os
from pathlib import Path
import stat
import socket
import struct


def prepare(profile_path, custody_root, executable, arguments):
    path = Path(profile_path)
    if path != custody_root / 'managed-profile.json':
        raise ValueError('Invalid managed profile location')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 65536:
        raise ValueError('Invalid managed profile')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as source:
        value = json.load(source)
    if value.get('schema') != 1:
        raise ValueError('Unknown managed profile')
    parent = Path(value['sourceParent'])
    p = parent.lstat()
    if parent.resolve() != parent or not stat.S_ISDIR(p.st_mode) or p.st_uid != os.getuid() or p.st_mode & 0o077:
        raise ValueError('Managed source parent changed')
    lock_path = Path(value['lock'])
    if parent not in lock_path.parents:
        raise ValueError('Invalid group authority')
    lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    lock_info = os.fstat(lock)
    if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077 or lock_info.st_nlink != 1:
        raise ValueError('Invalid group lock')
    fcntl.flock(lock, fcntl.LOCK_SH)  # held by supervisor through the entire namespace lifetime
    descriptors = []
    command = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled', '--cap-drop', 'ALL', '--new-session', '--die-with-parent', '--as-pid-1', '--clearenv', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/run', '--symlink', 'usr/bin', '/bin']
    for runtime in value['runtimeRoots']:
        r = Path(runtime)
        if r.resolve() != r or not r.is_dir() or parent == r or parent in r.parents or r in parent.parents:
            raise ValueError('Invalid runtime grant')
        command += ['--ro-bind', runtime, runtime]
    for grant in value['sources']:
        source = Path(grant['path'])
        if parent not in source.parents or source.resolve() != source:
            raise ValueError('Source grant changed')
        descriptor = os.open(source, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        identity = os.fstat(descriptor)
        if (identity.st_dev, identity.st_ino, identity.st_uid) != (grant['dev'], grant['ino'], grant['uid']):
            raise ValueError('Source grant identity changed')
        descriptors.append(descriptor)
        command += ['--bind-fd', str(descriptor), grant['destination']]
    provider = value.get('provider')
    if provider:
        endpoint = Path(provider['socket'])
        before = endpoint.lstat()
        directory = endpoint.parent.lstat()
        if endpoint.resolve() != endpoint or not stat.S_ISSOCK(before.st_mode) or before.st_uid != provider['serviceUid'] or not stat.S_ISDIR(directory.st_mode) or directory.st_uid not in (0, provider['serviceUid']) or directory.st_mode & 0o022:
            raise ValueError('Untrusted provider endpoint')
        endpoint_fd = os.open(endpoint, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
        pinned = os.fstat(endpoint_fd)
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(5)
            probe.connect(str(endpoint))
            _, uid, _ = struct.unpack('3i', probe.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
            after = endpoint.lstat()
            if uid != provider['serviceUid'] or (before.st_dev, before.st_ino) != (pinned.st_dev, pinned.st_ino) or (after.st_dev, after.st_ino) != (pinned.st_dev, pinned.st_ino):
                raise ValueError('Provider identity changed')
        descriptors.append(endpoint_fd)
        command += ['--dir', '/run/pi-coffee', '--ro-bind-fd', str(endpoint_fd), '/run/pi-coffee/provider.sock']
        runtime = Path(provider['runtime'])
        if runtime.resolve() != runtime or not runtime.is_dir() or parent == runtime or parent in runtime.parents or runtime in parent.parents:
            raise ValueError('Invalid provider runtime')
        command += ['--ro-bind', str(runtime), str(runtime)]
        overlay = list(arguments)
        if provider['engine'] == 'pi':
            overlay += ['--extension', str(runtime / 'managed-pi-provider.mjs')]
            command += ['--setenv', 'PI_COFFEE_PROVIDER_ID', provider['provider'], '--setenv', 'PI_COFFEE_PROVIDER_PORT', str(provider['port'])]
        elif provider['engine'] == 'codex':
            overlay += ['-c', 'model_provider=' + json.dumps(provider['provider'])]
            prefix = 'model_providers.' + provider['provider'] + '.'
            overrides = {'name': provider['provider'], 'base_url': 'http://127.0.0.1:' + str(provider['port']) + '/v1', 'env_key': 'PI_COFFEE_PROVIDER_PLACEHOLDER', 'requires_openai_auth': False, 'supports_websockets': False}
            for name, content in overrides.items():
                overlay += ['-c', prefix + name + '=' + json.dumps(content)]
        else:
            raise ValueError('Unknown provider engine')
        executable, arguments = provider['node'], [str(runtime / 'provider-loopback.mjs'), '--socket', '/run/pi-coffee/provider.sock', '--port', str(provider['port']), '--', executable, *overlay]
    for name, content in value['environment'].items():
        command += ['--setenv', name, content]
    command += ['--chdir', value['cwd'], '--', '/usr/bin/python3', str(Path(__file__).with_name('managed-runtime-init.py')), executable, *arguments]
    # The init script is an immutable runtime dependency, not a writable source.
    init = str(Path(__file__).with_name('managed-runtime-init.py'))
    offset = command.index('--chdir')
    command[offset:offset] = ['--ro-bind', init, init]
    return command, descriptors, lock
