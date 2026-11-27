const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	symlinkSync,
	rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'sarj-n8n-package-'));
try {
	const packed = Object.values(JSON.parse(
		execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
			cwd: root,
			encoding: 'utf8',
		}),
	));
	assert.equal(packed.length, 1, 'Exactly one package must be packed');
	const [pack] = packed;
	assert.equal(pack.name, '@sarj-ai/n8n-nodes-sarj');
	const allowed =
		/^(?:package\.json|README\.md|LICENSE\.md|CHANGELOG\.md|examples\/review-calls\.json|dist\/(?:credentials\/SarjApi\.credentials\.(?:js(?:\.map)?|d\.ts)|nodes\/Sarj\/(?:Sarj\.node\.(?:js(?:\.map)?|d\.ts|json)|(?:api|inputs)\.(?:js(?:\.map)?|d\.ts)|sarj(?:\.dark)?\.svg)))$/;
	for (const file of pack.files)
		assert.ok(allowed.test(file.path), `Unexpected packaged file: ${file.path}`);
	const modules = join(temporary, 'node_modules');
	mkdirSync(modules);
	execFileSync('tar', ['-xzf', join(temporary, pack.filename), '-C', modules]);
	const packageFolder = join(modules, 'package');
	const manifest = JSON.parse(readFileSync(join(packageFolder, 'package.json'), 'utf8'));
	assert.equal(manifest.name, '@sarj-ai/n8n-nodes-sarj');
	assert.equal(manifest.license, 'MIT');
	assert.equal(manifest.n8n.strict, true);
	assert.deepEqual(manifest.dependencies ?? {}, {});
	assert.deepEqual(Object.keys(manifest.peerDependencies), ['n8n-workflow']);
	for (const file of pack.files.filter((item) => item.path.endsWith('.js'))) {
		const source = readFileSync(join(packageFolder, file.path), 'utf8');
		assert.doesNotMatch(
			source,
			/tools\/call|Mcp-Session-Id|jsonrpc|process\.env|(?:node:)?fs['"]/i,
		);
		for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
			assert.ok(
				match[1].startsWith('.') || match[1] === 'n8n-workflow',
				`Unexpected runtime import: ${match[1]}`,
			);
		}
	}
	mkdirSync(join(modules, '@sarj-ai'));
	symlinkSync(packageFolder, join(modules, '@sarj-ai/n8n-nodes-sarj'), 'dir');
	symlinkSync(join(root, 'node_modules/n8n-workflow'), join(modules, 'n8n-workflow'), 'dir');
	symlinkSync(join(root, 'node_modules/@types'), join(modules, '@types'), 'dir');
	writeFileSync(
		join(temporary, 'consumer.cjs'),
		`
const assert = require('node:assert/strict');
const { Sarj } = require('@sarj-ai/n8n-nodes-sarj/dist/nodes/Sarj/Sarj.node.js');
const { SarjApi } = require('@sarj-ai/n8n-nodes-sarj/dist/credentials/SarjApi.credentials.js');
const node = new Sarj();
const credential = new SarjApi();
assert.equal(credential.name, 'sarjApi');
assert.equal(node.description.credentials[0].name, credential.name);
assert.equal(node.description.properties.find(p => p.name === 'operation').options.length, 4);
const parameters = { resource:'call', operation:'getMany', returnAll:false, limit:1, filters:{} };
const context = {
 getInputData:()=>[{json:{}}], getNodeParameter:name=>parameters[name], getExecutionCancelSignal:()=>undefined,
 getNode:()=>({ id:'demo', name:'Sarj', type:'@sarj-ai/n8n-nodes-sarj.sarj', typeVersion:1, position:[0,0], parameters:{} }),
 continueOnFail:()=>false,
 helpers:{ httpRequestWithAuthentication:async function(name,options){
  assert.equal(name,'sarjApi'); assert.equal(options.method,'GET');
  assert.equal(options.url,'https://platform-api.sarj.ai/api/v1/calls');
  return { statusCode:200, body:{ data:{ calls:[{id:'synthetic-call'}], next_cursor:null }, meta:{} } };
 }}
};
node.execute.call(context).then(result=>assert.equal(result[0][0].json.id,'synthetic-call')).catch(error=>{console.error(error);process.exitCode=1;});
`,
	);
	writeFileSync(
		join(temporary, 'consumer.ts'),
		`
import { Sarj } from '@sarj-ai/n8n-nodes-sarj/dist/nodes/Sarj/Sarj.node';
import { SarjApi } from '@sarj-ai/n8n-nodes-sarj/dist/credentials/SarjApi.credentials';
import type { INodeType, ICredentialType } from 'n8n-workflow';
const node: INodeType = new Sarj();
const credential: ICredentialType = new SarjApi();
void node; void credential;
`,
	);
	writeFileSync(
		join(temporary, 'tsconfig.json'),
		JSON.stringify(
			{
				compilerOptions: {
					strict: true,
			// Match n8n's official starter: its workflow declarations reference unshipped dev-only types.
			skipLibCheck: true,
					noEmit: true,
					target: 'ES2022',
					module: 'Node16',
					moduleResolution: 'Node16',
					esModuleInterop: true,
				},
				files: ['consumer.ts'],
			},
			null,
			2,
		),
	);
	execFileSync(process.execPath, ['consumer.cjs'], { cwd: temporary, stdio: 'pipe' });
	execFileSync(
		process.execPath,
		[join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
		{ cwd: temporary, stdio: 'pipe' },
	);
	console.log(
		JSON.stringify({
			package: manifest.name,
			version: manifest.version,
			packedFiles: pack.files.length,
			packedBytes: pack.size,
			runtimeDependencies: 0,
			independentPackedNodeAction: 'pass',
			strictConsumerTypes: 'pass',
			dependencyDeclarationsChecked: false,
		}),
	);
} catch (error) {
	if (error.stdout) process.stderr.write(error.stdout);
	if (error.stderr) process.stderr.write(error.stderr);
	throw error;
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
