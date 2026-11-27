const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = resolve(__dirname, '../scripts/ci-publish.sh');
const synthetic = 'npm_' + 'syntheticBootstrapKey'.repeat(2);

function simulate({ token = synthetic, identity = 'sarj', publish = 0, logout = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sarj-release-security-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const log = join(root, 'calls.jsonl');
  writeFileSync(join(root, 'package.tgz'), 'synthetic archive');
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2),config=process.env.NPM_CONFIG_USERCONFIG;
const content=fs.readFileSync(config,'utf8');
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({args,mode:fs.statSync(config).mode&0o777,hasToken:content.includes('_authToken='),tokenEnv:!!process.env.NPM_TOKEN,logsMax:process.env.NPM_CONFIG_LOGS_MAX})+'\\n');
if(args[0]==='whoami')console.log(process.env.MOCK_IDENTITY);
process.exit(args[0]==='publish'?Number(process.env.MOCK_PUBLISH):args[0]==='logout'?Number(process.env.MOCK_LOGOUT):0);
`, { mode: 0o700 });
  try {
    const result = spawnSync('/bin/bash', [script, join(root, 'package.tgz')], {
      encoding: 'utf8', timeout: 10000,
      env: {
        PATH: bin + ':' + dirname(process.execPath) + ':/usr/bin:/bin',
        RUNNER_TEMP: root, NPM_TOKEN: token,
        MOCK_LOG: log, MOCK_IDENTITY: identity,
        MOCK_PUBLISH: String(publish), MOCK_LOGOUT: String(logout),
      },
    });
    const calls = readdirSync(root).includes('calls.jsonl')
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    assert.equal(readdirSync(root).some(name => name.startsWith('sarj-publish.')), false);
    assert.equal((result.stdout + result.stderr).includes(synthetic), false);
    for (const call of calls) {
      assert.equal(call.mode, 0o600);
      assert.equal(call.tokenEnv, false);
      assert.equal(call.logsMax, '0');
      assert.equal(JSON.stringify(call.args).includes(synthetic), false);
    }
    return { result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('bootstrap publishes the checked archive then revokes only its own token', () => {
  const { result, calls } = simulate();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.map(c => c.args[0]), ['whoami', 'publish', 'logout']);
  assert.ok(calls.every(c => c.hasToken));
  assert.ok(calls[1].args.includes('--provenance'));
});

test('failed publication still revokes bootstrap access and preserves failure', () => {
  const { result, calls } = simulate({ publish: 23 });
  assert.equal(result.status, 23);
  assert.equal(calls.at(-1).args[0], 'logout');
});

test('unexpected account cannot publish and its bootstrap token is revoked', () => {
  const { result, calls } = simulate({ identity: 'synthetic-wrong-owner' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls.map(c => c.args[0]), ['whoami', 'logout']);
});

test('revocation failure is a visible failed job rather than a successful cleanup claim', () => {
  const { result } = simulate({ logout: 19 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner revocation is required/);
});

test('OIDC path uses no stored token, does not log out another identity, and still requires provenance', () => {
  const { result, calls } = simulate({ token: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.map(c => c.args[0]), ['publish']);
  assert.equal(calls[0].hasToken, false);
  assert.ok(calls[0].args.includes('--provenance'));
});

test('malformed bootstrap input cannot inject npm configuration or reach publication', () => {
  const { result, calls } = simulate({ token: synthetic + '\nregistry=https://synthetic.invalid/' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls, []);
});
