"""Public CLI / local HTTP / service-manager boundary checks; no real services touched."""
import contextlib
import http.server
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).with_name('coffee-watchdog.py'))
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class WatchdogTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='coffee-watchdog-test-')
        self.root = Path(self.temporary.name)
        self.now = 100000
        self.payload = {'ok': True, 'role': 'host'}
        self.status_code = 200
        fixture = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(fixture.status_code)
                self.end_headers()
                self.wfile.write(json.dumps(fixture.payload).encode())
            def log_message(self, *args):
                pass
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.unit = {'LoadState':'loaded', 'ActiveState':'active', 'SubState':'running',
                     'Result':'success', 'MainPID':'999', 'NRestarts':'0'}
        self.write_unit()
        self.controller = self.root/'systemctl'
        self.controller.write_text('''#!/usr/bin/python3
import json, sys
from pathlib import Path
root=Path(__file__).parent
state=json.loads((root/'unit.json').read_text())
if 'show' in sys.argv:
 for key,value in state.items(): print(key+'='+str(value))
 sys.exit(int(state.get('showExit',0)))
with (root/'actions.jsonl').open('a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')
sys.exit(int(state.get('actionExit',0)))
''')
        self.controller.chmod(0o700)
        self.config = self.root/'config.json'
        self.config.write_text(json.dumps({'version':1,'targets':[{'id':'host','unit':'pi-coffee-fixture.service',
             'manager':'user','role':'host','healthUrl':f'http://127.0.0.1:{self.server.server_port}/healthz'}]}))
        self.args = ['--config',str(self.config),'--state-dir',str(self.root/'state'),'--systemctl',str(self.controller)]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def write_unit(self):
        (self.root/'unit.json').write_text(json.dumps(self.unit))

    def run_cli(self, *args, expected=0):
        out = io.StringIO()
        with patch('time.time',return_value=self.now), contextlib.redirect_stdout(out):
            code=watchdog.main([*self.args,*args])
        self.assertEqual(code,expected,out.getvalue())
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def status(self):
        return self.run_cli('status')[0]['targets'].get('host',{})

    def tick(self, seconds=30):
        self.now += seconds
        return self.run_cli('check')

    def actions(self):
        p=self.root/'actions.jsonl'
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def unhealthy(self):
        self.status_code=503

    def test_healthy_service_is_observed_without_restart(self):
        self.tick()
        self.assertEqual(self.status()['status'],'healthy')
        self.assertEqual(self.actions(),[])

    def test_three_failures_request_recovery_and_persist_budget(self):
        self.unhealthy()
        self.tick(); self.tick()
        self.assertEqual(self.actions(),[])
        self.tick()
        self.assertEqual(self.actions(),[['--user','--no-block','restart','pi-coffee-fixture.service']])
        self.assertEqual(len(self.status()['attempts']),1)
        self.tick(299)
        self.assertEqual(len(self.actions()),1)
        self.assertEqual(self.status()['status'],'cooldown')

    def test_dead_service_starts_instead_of_restarting_other_units(self):
        self.unit.update(ActiveState='failed',Result='exit-code');self.write_unit()
        for _ in range(3):self.tick()
        self.assertEqual(self.actions(),[['--user','--no-block','start','pi-coffee-fixture.service']])

    def test_persistent_fault_opens_circuit_even_after_window_expires(self):
        self.unhealthy()
        for _ in range(4):
            for _ in range(3):self.tick(301)
        self.assertEqual(len(self.actions()),3)
        self.assertTrue(self.status()['circuitOpen'])
        self.tick(7200)
        self.assertEqual(len(self.actions()),3)
        self.assertEqual(self.status()['status'],'circuit-open')

    def test_native_start_limit_is_latched_without_reset_failed(self):
        self.unit.update(ActiveState='failed',Result='start-limit-hit');self.write_unit()
        self.tick();self.tick(7200)
        self.assertTrue(self.status()['circuitOpen'])
        self.assertEqual(self.actions(),[])

    def test_start_stop_and_manager_errors_are_not_restarted(self):
        for phase in ['activating','deactivating','reloading']:
            self.unit['ActiveState']=phase;self.write_unit()
            for _ in range(3):self.tick()
        self.unit['showExit']=1;self.write_unit();self.tick()
        self.assertEqual(self.status()['status'],'manager-unavailable')
        self.assertEqual(self.actions(),[])

    def test_pause_expires_and_resume_does_not_erase_restart_budget(self):
        self.unhealthy()
        for _ in range(3):self.tick()
        self.run_cli('pause','--seconds','900')
        for _ in range(5):self.tick()
        self.assertEqual(len(self.actions()),1)
        self.run_cli('resume')
        self.assertEqual(len(self.status()['attempts']),1)
        self.run_cli('pause','--seconds','1');self.tick(301)
        self.assertEqual(len(self.actions()),1)

    def test_failed_recovery_commands_consume_the_same_budget(self):
        self.unhealthy();self.unit['actionExit']=1;self.write_unit()
        for _ in range(12):self.tick(301)
        self.assertEqual(len(self.actions()),3)
        self.assertTrue(self.status()['circuitOpen'])

    def test_sustained_health_resets_budget_but_not_a_latched_circuit(self):
        self.unhealthy()
        for _ in range(3):self.tick()
        self.status_code=200;self.tick();self.tick(601)
        self.assertEqual(self.status()['incidentAttempts'],0)
        self.assertEqual(len(self.status()['attempts']),1)
        self.unit.update(ActiveState='failed',Result='start-limit-hit');self.write_unit();self.tick()
        self.unit.update(ActiveState='active',Result='success');self.write_unit();self.tick();self.tick(601)
        self.assertTrue(self.status()['circuitOpen'])
        self.run_cli('rearm','host');self.tick()
        self.assertEqual(self.status()['status'],'healthy')

    def test_corrupt_state_fails_closed_without_overwriting_evidence(self):
        self.tick();path=self.root/'state/state.json';path.write_text('broken-json')
        self.unhealthy();self.run_cli('check',expected=2)
        self.assertEqual(path.read_text(),'broken-json');self.assertEqual(self.actions(),[])

    def test_wrong_role_or_non_object_health_is_not_healthy(self):
        self.payload={'ok':True,'role':'web'};self.tick()
        self.assertFalse(self.status()['healthy'])
        self.payload=[];self.tick()
        self.assertFalse(self.status()['healthy'])
        self.assertEqual(self.actions(),[])

    def test_healthy_resets_do_not_erase_the_rolling_restart_limit(self):
        config=json.loads(self.config.read_text());config['policy']={'healthyResetSeconds':1,'cooldownSeconds':1}
        self.config.write_text(json.dumps(config))
        for _ in range(4):
            self.unhealthy()
            for _ in range(3):self.tick()
            self.status_code=200;self.tick();self.tick(2)
        self.assertEqual(len(self.actions()),3)
        self.assertTrue(self.status()['circuitOpen'])

    def test_unknown_observations_break_the_healthy_reset_streak(self):
        self.unhealthy()
        for _ in range(3):self.tick()
        self.status_code=200;self.tick()
        self.unit['showExit']=1;self.write_unit();self.tick(500)
        self.unit['showExit']=0;self.write_unit();self.tick(101)
        self.assertEqual(self.status()['incidentAttempts'],1)


if __name__ == '__main__':
    unittest.main()
