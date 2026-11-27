const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Sarj } = require('../dist/nodes/Sarj/Sarj.node.js');
const { SarjApi } = require('../dist/credentials/SarjApi.credentials.js');
const { SarjReadClient, SARJ_API_BASE, READ_OPERATIONS } = require('../dist/nodes/Sarj/api.js');
const { operationFor, listArgs, detailArgs, STATUS } = require('../dist/nodes/Sarj/inputs.js');

const CALL = '00000000-0000-4000-8000-000000000001';
const SCENARIO = '00000000-0000-4000-8000-000000000002';
const NODE = {
	id: 'synthetic-node',
	name: 'Sarj AI',
	type: 'n8n-nodes-sarj.sarj',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const summary = {
	id: CALL,
	status: 'completed',
	scenario_id: SCENARIO,
	direction: 'inbound',
	created_at: '2026-01-01T00:00:00Z',
	started_at: '2026-01-01T00:00:00Z',
	ended_at: '2026-01-01T00:01:50Z',
	duration: 110,
	outcome: 'success',
};
const response = (data) => ({
	statusCode: 200,
	body: { data, meta: { request_id: 'synthetic-request' } },
	headers: {},
});

function context(
	parameters = {},
	handler = () => response({ calls: [summary], next_cursor: null }),
	options = {},
) {
	const requests = [];
	const defaults = {
		resource: 'call',
		operation: 'getMany',
		returnAll: false,
		limit: 50,
		filters: {},
		callId: CALL,
	};
	const ctx = {
		getInputData: () => options.items ?? [{ json: {} }],
		getNodeParameter: (name, index) => {
			const values = Array.isArray(parameters) ? parameters[index] : parameters;
			return Object.hasOwn(values, name) ? values[name] : defaults[name];
		},
		getNode: () => NODE,
		getExecutionCancelSignal: () => options.signal,
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: async function (credential, request) {
				assert.equal(this, ctx);
				assert.equal(credential, 'sarjApi');
				requests.push(request);
				return handler(request, requests.length);
			},
		},
	};
	return { ctx, requests, run: () => new Sarj().execute.call(ctx) };
}

for (const [operation, suffix, data] of [
	['get', '', { ...summary, phone_number: null }],
	['getTranscript', '/transcript', { call_id: CALL, started_at: null, turns: [] }],
	[
		'getAnalysis',
		'/analysis',
		{
			call_id: CALL,
			collected_data: null,
			outcome: null,
			agent_outcome: null,
			caller_experience: null,
			flags: [],
			analysis_state: { flags: 'not_configured', caller_experience: 'not_configured' },
		},
	],
]) {
	test(`native node action ${operation} reads its fixed REST path and retains null fields`, async () => {
		const fixture = context({ operation }, () => response(data));
		assert.deepEqual(await fixture.run(), [[{ json: data, pairedItem: { item: 0 } }]]);
		assert.equal(fixture.requests.length, 1);
		assert.equal(fixture.requests[0].url, SARJ_API_BASE + '/calls/' + CALL + suffix);
		assert.equal(fixture.requests[0].method, 'GET');
		assert.equal(fixture.requests[0].body, undefined);
	});
}

test('native Get Many action maps all supported filters and preserves paired items', async () => {
	const fixture = context({
		filters: {
			scenarioId: SCENARIO,
			status: 'completed',
			createdFrom: '2026-01-01T00:00:00Z',
			createdTo: '2026-02-01T00:00:00+00:00',
			cursor: 'demo-cursor',
		},
		limit: 1,
	});
	assert.deepEqual(await fixture.run(), [[{ json: summary, pairedItem: { item: 0 } }]]);
	assert.deepEqual(fixture.requests[0].qs, {
		limit: 1,
		scenario_id: SCENARIO,
		status: 'completed',
		created_from: '2026-01-01T00:00:00Z',
		created_to: '2026-02-01T00:00:00+00:00',
		cursor: 'demo-cursor',
	});
	assert.equal(fixture.requests[0].url, SARJ_API_BASE + '/calls');
});

test('empty history produces no fabricated call or analysis', async () => {
	assert.deepEqual(await context({}, () => response({ calls: [], next_cursor: null })).run(), [[]]);
});

test('Return All follows server cursors and returns individual calls', async () => {
	const second = { ...summary, id: '00000000-0000-4000-8000-000000000003' };
	const fixture = context({ returnAll: true }, (request, count) => {
		assert.equal(request.qs.limit, 100);
		if (count === 1) return response({ calls: [summary], next_cursor: 'demo-page-2' });
		assert.equal(request.qs.cursor, 'demo-page-2');
		return response({ calls: [second], next_cursor: null });
	});
	assert.deepEqual(
		(await fixture.run())[0].map((item) => item.json.id),
		[CALL, second.id],
	);
	assert.equal(fixture.requests.length, 2);
});

test('Return All rejects repeating cursors without returning a partial result', async () => {
	const fixture = context({ returnAll: true }, () =>
		response({ calls: [summary], next_cursor: 'same-cursor' }),
	);
	await assert.rejects(fixture.run(), /unsupported or incomplete response/);
	assert.equal(fixture.requests.length, 2);
});

test('pagination is bounded to 100 pages without an infinite retry loop', async () => {
	const fixture = context({ returnAll: true }, (_request, count) =>
		response({ calls: [], next_cursor: 'page-' + count }),
	);
	await assert.rejects(fixture.run(), /pagination bound/);
	assert.equal(fixture.requests.length, 100);
});

test('multiple input items use their own parameters and linked output indices', async () => {
	const fixture = context(
		[{ operation: 'get' }, { operation: 'getAnalysis' }],
		(request) => response({ call_id: CALL, route: request.url }),
		{ items: [{ json: { demo: 1 } }, { json: { demo: 2 } }] },
	);
	assert.deepEqual(
		(await fixture.run())[0].map((item) => item.pairedItem.item),
		[0, 1],
	);
	assert.equal(fixture.requests.length, 2);
});

for (const [status, expected] of [
	[401, /authentication failed/],
	[403, /pilot eligibility/],
	[404, /could not find/],
	[429, /rate limit/],
	[503, /request failed/],
]) {
	test(`HTTP ${status} is sanitized and preserves useful action context`, async () => {
		const secret = 'PRIVATE-KEY-AND-CUSTOMER-MARKER';
		const fixture = context({}, () => {
			throw {
				statusCode: status,
				message: secret,
				response: { data: { customer: secret } },
				request: { headers: { Authorization: secret } },
			};
		});
		await assert.rejects(fixture.run(), (error) => {
			assert.match(error.message, expected);
			assert.equal(JSON.stringify(error).includes(secret), false);
			assert.equal(String(error.stack).includes(secret), false);
			assert.equal(error.name, 'NodeApiError');
			return true;
		});
		assert.equal(fixture.requests.length, 1);
	});
}

test('continueOnFail emits only the safe error for the failing input', async () => {
	const fixture = context(
		{},
		() => {
			throw { statusCode: 403, message: 'PRIVATE-CUSTOMER' };
		},
		{ continueOnFail: true },
	);
	const output = await fixture.run();
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
	assert.match(output[0][0].json.error, /pilot eligibility/);
	assert.equal(JSON.stringify(output).includes('PRIVATE-CUSTOMER'), false);
});

for (const [label, values] of [
	['unsupported operation', { operation: 'createCall' }],
	['unsupported resource', { resource: 'scenario' }],
	['nonboolean Return All', { returnAll: 'true' }],
	['zero limit', { limit: 0 }],
	['oversized limit', { limit: 101 }],
	['fractional limit', { limit: 1.5 }],
	['organization override', { filters: { organizationId: SCENARIO } }],
	['unknown filter', { filters: { url: 'https://example.invalid' } }],
	['invalid scenario UUID', { filters: { scenarioId: 'bad' } }],
	['invalid status', { filters: { status: 'unknown' } }],
	['oversized cursor', { filters: { cursor: 'x'.repeat(129) } }],
	['invalid calendar date', { filters: { createdFrom: '2026-02-31T00:00:00Z' } }],
	['missing timezone', { filters: { createdFrom: '2026-01-01T00:00:00' } }],
	[
		'reversed range',
		{ filters: { createdFrom: '2026-02-01T00:00:00Z', createdTo: '2026-01-01T00:00:00Z' } },
	],
	['invalid transcript UUID', { operation: 'getTranscript', callId: 'bad' }],
	['empty call ID', { operation: 'get', callId: '' }],
	['path dot segment', { operation: 'get', callId: '..' }],
]) {
	test(`rejects ${label} before sending a request`, async () => {
		const fixture = context(values);
		await assert.rejects(fixture.run(), (error) => error.name === 'NodeOperationError');
		assert.equal(fixture.requests.length, 0);
	});
}

test('all documented call statuses and limit boundaries are accepted', () => {
	for (const status of STATUS) assert.equal(listArgs({ status }, 1).status, status);
	assert.equal(listArgs({}, 100).limit, 100);
	assert.equal(
		listArgs({ createdFrom: '2024-02-29T00:00:00Z' }, 1).created_from,
		'2024-02-29T00:00:00Z',
	);
	assert.deepEqual(detailArgs('getCall', 'opaque-call-id'), { call_id: 'opaque-call-id' });
	assert.throws(() => operationFor('call', '__proto__'));
});

test('request bounds, cancellation and no redirect credential transfer are enforced', async () => {
	const controller = new AbortController();
	const fixture = context(
		{},
		(options) => {
			assert.equal(options.disableFollowRedirect, true);
			assert.equal(options.maxRedirects, 0);
			assert.equal(options.maxResponseBodyBytes, 2 * 1024 * 1024);
			assert.ok(options.timeout > 0 && options.timeout <= 30_000);
			assert.equal(options.abortSignal, controller.signal);
			assert.equal(options.headers.Authorization, undefined);
			controller.abort();
			throw { code: 'ABORT_ERR', message: 'PRIVATE' };
		},
		{ signal: controller.signal },
	);
	await assert.rejects(fixture.run(), /cancelled/);
	const stopped = context({}, undefined, { signal: controller.signal });
	await assert.rejects(stopped.run(), /cancelled/);
	assert.equal(stopped.requests.length, 0);
});

test('total 45-second input deadline bounds pagination', async () => {
	const original = Date.now;
	let now = original();
	Date.now = () => now;
	try {
		const fixture = context({ returnAll: true }, () => {
			now += 46_000;
			return response({ calls: [], next_cursor: 'next-page' });
		});
		await assert.rejects(fixture.run(), /timed out/);
		assert.equal(fixture.requests.length, 1);
	} finally {
		Date.now = original;
	}
});

test('non-2xx responses and malformed envelopes are never emitted as successful data', async () => {
	for (const result of [
		null,
		{ statusCode: 302, body: { data: {} } },
		response(null),
		response([]),
		response({ calls: 'bad', next_cursor: null }),
		response({ calls: [{ id: CALL }, { id: CALL }], next_cursor: null }),
	]) {
		const fixture = context({ limit: 1 }, () => result);
		await assert.rejects(fixture.run());
	}
});

test('only the four existing REST read operations can be requested', async () => {
	assert.deepEqual(READ_OPERATIONS, [
		'listCalls',
		'getCall',
		'getCallTranscript',
		'getCallAnalysis',
	]);
	let sent = false;
	const client = new SarjReadClient(async () => {
		sent = true;
		return response({});
	}, NODE);
	await assert.rejects(client.read('createCall', {}));
	assert.equal(sent, false);
});

test('credential definition uses n8n secret storage and a bounded read-only eligibility test', () => {
	const credential = new SarjApi();
	assert.equal(credential.properties[0].typeOptions.password, true);
	assert.equal(credential.properties[0].required, true);
	assert.equal(
		credential.authenticate.properties.headers.Authorization,
		'=Bearer {{$credentials.apiKey}}',
	);
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(credential.test.request.baseURL, SARJ_API_BASE);
	assert.equal(credential.test.request.url, '/calls');
	assert.equal(credential.test.request.qs.limit, 1);
	assert.equal(credential.test.request.disableFollowRedirect, true);
});
