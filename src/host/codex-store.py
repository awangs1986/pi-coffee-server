"""Pinned local Codex storage boundary. No providers, native execution or secrets in output errors."""
import base64, ctypes, hashlib, json, os, pathlib, signal, sqlite3, sys, tomllib, tempfile, shutil

ROOT = pathlib.Path(__file__).resolve().parent
SCHEMAS = json.loads((ROOT / 'codex-schema-01591.json').read_text())

def encode(value):
    return {'$blob': base64.b64encode(value).decode()} if isinstance(value, bytes) else value

def schema(c):
    return dict(c.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"))

def qualified(c, name):
    expected = SCHEMAS[name]
    if schema(c) != expected['schema']:
        raise ValueError('unsupported_native_schema')
    migrations = [{'version': v, 'description': d, 'sha384': bytes(checksum).hex()} for v,d,checksum,success in c.execute('SELECT version,description,checksum,success FROM _sqlx_migrations ORDER BY version') if success == 1]
    if migrations != [{key: value for key,value in row.items() if key in ('version','description','sha384')} for row in expected['migrations']] or c.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise ValueError('unsupported_native_schema')

def safe(path, directory=False):
    p = pathlib.Path(path)
    s = p.lstat()
    if p.resolve() != p or s.st_uid != os.getuid() or p.is_symlink() or (directory and s.st_mode & 0o077) or (not directory and (not p.is_file() or s.st_nlink != 1)):
        raise ValueError('unsafe_native_source')
    return p

def roots(request):
    home = safe(request['home'], True)
    config_path = home / 'config.toml'
    config = tomllib.loads(safe(config_path).read_text()) if config_path.exists() else {}
    sql = pathlib.Path(config.get('sqlite_home') or request.get('environmentSqliteHome') or home)
    if not sql.is_absolute() or (request.get('sqliteHome') and pathlib.Path(request['sqliteHome']) != sql):
        raise ValueError('sqlite_home_unresolved')
    safe(sql, True)
    if (sql / 'memories_v2_1.sqlite').exists() or (home / 'memories_v2').exists() or config.get('features', {}).get('memory_tool_v2'):
        raise ValueError('unsupported_native_schema')
    # Configuration can name instruction/capability graphs outside these homes.
    # Such a graph needs an explicit mapping before it can be called complete.
    for key in ['model_instructions_file', 'developer_instructions_file', 'experimental_instructions_file']:
        if config.get(key):
            raise ValueError('external_native_resource')
    if config.get('skills', {}).get('config') or config.get('plugins') or config.get('profiles') or config.get('profile'):
        raise ValueError('external_native_resource')
    unknown = [p for p in sql.glob('*.sqlite') if p.name not in SCHEMAS]
    if unknown:
        raise ValueError('unsupported_native_schema')
    return {'schemaVersion': 1, 'cliVersion': '0.159.1', 'nativeHome': str(home), 'sqliteHome': str(sql), 'databases': {}}

def snapshot(request):
    result = roots(request)
    home, sql = pathlib.Path(result['nativeHome']), pathlib.Path(result['sqliteHome'])
    for name in SCHEMAS:
        path = sql / name
        if not path.exists():
            continue
        safe(path)
        for suffix in ['-wal', '-shm']:
            if pathlib.Path(str(path)+suffix).exists(): safe(str(path)+suffix)
        # A logical backup includes committed WAL. The caller holds the entire
        # managed writer group; sequential backups alone are not a group cut.
        source = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=0)
        copy = sqlite3.connect(':memory:')
        source.backup(copy); source.close(); qualified(copy, name)
        tables = {}
        for table, sql_text in SCHEMAS[name]['schema'].items():
            if not sql_text.startswith('CREATE TABLE') or table == '_sqlx_migrations': continue
            cursor = copy.execute('SELECT * FROM "'+table+'"')
            columns = [column[0] for column in cursor.description]
            tables[table] = [dict(zip(columns, map(encode, row))) for row in cursor]
        result['databases'][name] = {'schema': SCHEMAS[name]['schema'], 'migrations': SCHEMAS[name]['migrations'], 'tables': tables}
        copy.close()
    if 'state_5.sqlite' not in result['databases']:
        raise ValueError('native_binding_missing')
    return result

def initialize(path, name):
    # Initializing a staged empty store is separate from publishing it.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600); os.close(fd)
    c = sqlite3.connect(path)
    spec = SCHEMAS[name]
    if 'sqlite_sequence' in spec['schema']:
        c.execute('CREATE TABLE temporary_sequence(id INTEGER PRIMARY KEY AUTOINCREMENT)'); c.execute('DROP TABLE temporary_sequence')
    for table, sql in spec['schema'].items():
        if table != 'sqlite_sequence' and sql.startswith('CREATE TABLE'): c.execute(sql)
    for table, sql in spec['schema'].items():
        if not sql.startswith('CREATE TABLE'): c.execute(sql)
    for row in spec['migrations']:
        c.execute('INSERT INTO _sqlx_migrations VALUES (?,?,CURRENT_TIMESTAMP,1,?,0)', (row['version'], row['description'], bytes.fromhex(row['sha384'])))
    c.commit(); qualified(c, name); c.close()
    with open(path, 'rb') as f: os.fsync(f.fileno())
    return {'initialized': True}

def decode(value):
    return base64.b64decode(value['$blob'], validate=True) if isinstance(value, dict) and set(value) == {'$blob'} else value

def durable(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.codex-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY); os.fsync(directory); os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def inspection_copy(path):
    # Read only the original main/WAL bytes. SQLite recovery and all preflight
    # transactions happen in private scratch, including SHM creation.
    temporary = tempfile.TemporaryDirectory(prefix='coffee-native-preflight-')
    try:
        total = 0
        for suffix in ['', '-wal']:
            source = pathlib.Path(str(path)+suffix)
            if not source.exists(): continue
            source = safe(source)
            total += source.stat().st_size
            if total > 1024**3: raise ValueError('resource_limit')
            shutil.copyfile(source, pathlib.Path(temporary.name)/(path.name+suffix))
        source = sqlite3.connect(pathlib.Path(temporary.name)/path.name, timeout=0)
        memory = sqlite3.connect(':memory:')
        try: source.backup(memory)
        finally: source.close()
        return memory, temporary
    except:
        temporary.cleanup()
        raise

def merge(request):
    plan = request['plan']; root = safe(plan['sqliteHome'], True); dry = request['operation'] == 'preflight'
    journal_path = pathlib.Path(plan['journal']); safe(journal_path.parent, True)
    if journal_path.exists():
        journal = json.loads(safe(journal_path).read_text())
        if journal['operationId'] != request['operationId'] or journal['digest'] != request['digest']:
            raise ValueError('native_receipt_changed')
    else:
        journal = {'operationId': request['operationId'], 'digest': request['digest'], 'databases': {}}
    for name in dict.fromkeys([*plan['databases'], *plan.get('replacements', {})]):
        changes = plan['databases'].get(name, {})
        if name not in SCHEMAS: raise ValueError('unsupported_native_schema')
        target = root / name
        path = safe(request.get('sourceOverrides', {}).get(str(target), target) if dry else target)
        identity = plan['databaseIdentities'][name]
        info = path.stat()
        if [info.st_dev, info.st_ino] != identity: raise ValueError('native_store_changed')
        temporary = None
        if dry: c, temporary = inspection_copy(path)
        else: c = sqlite3.connect(path, timeout=0)
        try:
            qualified(c, name); c.row_factory = sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); c.execute('BEGIN IMMEDIATE')
            pending = []
            replacements = []
            for group in plan.get('replacements', {}).get(name, []):
                table, key, ids = group['table'], group['key'], group['ids']
                if table not in SCHEMAS[name]['schema'] or key not in [v[1] for v in c.execute('PRAGMA table_info("'+table+'")')] or not ids:
                    raise ValueError('unsupported_native_schema')
                current = [{key: encode(value) for key,value in dict(row).items()} for row in c.execute('SELECT * FROM "'+table+'" WHERE "'+key+'" IN ('+','.join('?' for _ in ids)+')', ids)]
                canonical = lambda rows: sorted(json.dumps(row, sort_keys=True, separators=(',', ':')) for row in rows)
                before, after, observed = canonical(group['before']), canonical(group['after']), canonical(current)
                if observed == before:
                    if before != after: replacements.append(group)
                elif name not in journal['databases'] or observed != after:
                    raise ValueError('native_row_changed')
            for table, rows in changes.items():
                if table not in SCHEMAS[name]['schema'] or table in ('sqlite_sequence','_sqlx_migrations'):
                    raise ValueError('unsupported_native_schema')
                columns = [v[1] for v in c.execute('PRAGMA table_info("'+table+'")')]
                pk = [v[1] for v in sorted(c.execute('PRAGMA table_info("'+table+'")'), key=lambda v:v[5]) if v[5]]
                if not pk: raise ValueError('unsupported_native_schema')
                for change in rows:
                    row = {key: decode(value) for key,value in change['row'].items()}
                    if set(row) != set(columns): raise ValueError('unsupported_native_schema')
                    current = c.execute('SELECT * FROM "'+table+'" WHERE '+' AND '.join('"'+key+'" IS ?' for key in pk), [row[key] for key in pk]).fetchone()
                    if current is not None:
                        if dict(current) != row or change['disposition'] != 'same' and name not in journal['databases']:
                            raise ValueError('native_row_conflict')
                    elif change['disposition'] == 'same': raise ValueError('native_row_changed')
                    else: pending.append((table,columns,row))
            # The intent is durable before SQL commits. On a lost response the
            # exact planned rows reconcile; unrelated rows are never touched.
            if not dry:
                journal['databases'][name] = 'started'; durable(journal_path, journal)
            # Children are retired before parents; selected rows are replaced
            # only after comparing their entire approved preimage in this same
            # transaction. No unrelated row or native sequence is restored.
            for group in reversed(replacements):
                c.execute('DELETE FROM "'+group['table']+'" WHERE "'+group['key']+'" IN ('+','.join('?' for _ in group['ids'])+')', group['ids'])
            for table, columns, row in pending:
                c.execute('INSERT INTO "'+table+'" ('+','.join('"'+key+'"' for key in columns)+') VALUES ('+','.join('?' for _ in columns)+')', [row[key] for key in columns])
            for group in replacements:
                for row in group['after']:
                    columns = list(row)
                    c.execute('INSERT INTO "'+group['table']+'" ('+','.join('"'+key+'"' for key in columns)+') VALUES ('+','.join('?' for _ in columns)+')', [decode(row[key]) for key in columns])
            c.commit()
            if not dry:
                print(json.dumps({'event':'committed','database':name}), flush=True)
                if sys.stdin.readline().strip() != 'continue': raise ValueError('native_controller_lost')
                journal['databases'][name] = 'done'; durable(journal_path, journal)
        finally:
            c.close()
            if temporary is not None: temporary.cleanup()
    return {'merged': True}

try:
    if len(sys.argv) > 1:
        ctypes.CDLL(None).prctl(1, signal.SIGKILL)
        if os.getppid() != int(sys.argv[1]): raise ValueError('native_controller_lost')
    request = json.loads(sys.stdin.readline())
    os.umask(0o077)
    if request['operation'] == 'snapshot': result = snapshot(request)
    elif request['operation'] == 'roots': result = roots(request)
    elif request['operation'] == 'initialize': result = initialize(request['path'], request['name'])
    elif request['operation'] in ('merge', 'preflight'): result = merge(request)
    else: raise ValueError('unsupported_operation')
    output = json.dumps(result, separators=(',', ':'))
    if len(output) > 64*1024*1024: raise ValueError('resource_limit')
    sys.stdout.write(output+'\n'); sys.stdout.flush()
except Exception as error:
    code = str(error) if isinstance(error, ValueError) and str(error).replace('_','').isalnum() else 'native_store_refused'
    sys.stderr.write(code+'\n'); sys.exit(1)
