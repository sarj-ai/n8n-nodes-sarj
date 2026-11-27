import { NodeApiError, type IDataObject, type IHttpRequestOptions, type INode } from 'n8n-workflow';

export const SARJ_API_BASE = 'https://platform-api.sarj.ai/api/v1';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const READ_OPERATIONS = [
	'listCalls',
	'getCall',
	'getCallTranscript',
	'getCallAnalysis',
] as const;
export type ReadOperation = (typeof READ_OPERATIONS)[number];
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;
export type ErrorCode =
	| 'INPUT'
	| 'AUTHENTICATION'
	| 'PERMISSION'
	| 'NOT_FOUND'
	| 'RATE_LIMIT'
	| 'TIMEOUT'
	| 'SERVICE'
	| 'RESPONSE';

const messages: Record<ErrorCode, string> = {
	INPUT:
		'Check the Sarj node parameters. IDs, dates, limits and filters must have the expected format.',
	AUTHENTICATION: 'Sarj authentication failed. Check the API key stored in your credential.',
	PERMISSION:
		'Sarj denied this read. Check calls:read scope, organization access and pilot eligibility.',
	NOT_FOUND: 'Sarj could not find this call. Check its ID and the credential organization.',
	RATE_LIMIT: 'Sarj rate limit reached. Retry the workflow later.',
	TIMEOUT:
		'The Sarj read timed out, was cancelled or reached its pagination bound. Narrow the filters and retry.',
	SERVICE: 'The Sarj request failed. Retry later or contact engineering@sarj.ai.',
	RESPONSE: 'Sarj returned an unsupported or incomplete response. Contact engineering@sarj.ai.',
};

export class SarjReadError extends Error {
	constructor(readonly code: ErrorCode) {
		super(messages[code]);
		this.name = 'SarjReadError';
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpStatus(error: unknown): number | undefined {
	if (!isRecord(error)) return undefined;
	const response = isRecord(error.response) ? error.response : {};
	const status = Number(error.statusCode ?? error.httpCode ?? response.status);
	return Number.isInteger(status) ? status : undefined;
}

export function safeError(error: unknown): SarjReadError {
	if (error instanceof SarjReadError) return error;
	if (error instanceof NodeApiError) {
		const entry = Object.entries(messages).find(([, message]) => message === error.message);
		if (entry) return new SarjReadError(entry[0] as ErrorCode);
	}
	const status = httpStatus(error);
	if (status === 401) return new SarjReadError('AUTHENTICATION');
	if (status === 403) return new SarjReadError('PERMISSION');
	if (status === 404) return new SarjReadError('NOT_FOUND');
	if (status === 429) return new SarjReadError('RATE_LIMIT');
	if (
		isRecord(error) &&
		['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ABORT_ERR'].includes(String(error.code))
	) {
		return new SarjReadError('TIMEOUT');
	}
	return new SarjReadError('SERVICE');
}

/** Fixed-host REST GET client. Authentication and connection management belong to n8n. */
export class SarjReadClient {
	private readonly deadline = Date.now() + 45_000;

	constructor(
		private readonly request: Request,
		private readonly node: INode,
		private readonly signal?: AbortSignal,
	) {}

	async read(operation: ReadOperation, args: IDataObject): Promise<IDataObject> {
		if (!READ_OPERATIONS.includes(operation)) throw new SarjReadError('INPUT');
		const remaining = this.deadline - Date.now();
		if (remaining <= 0 || this.signal?.aborted) throw new SarjReadError('TIMEOUT');
		let path = '/calls';
		if (operation !== 'listCalls') {
			if (typeof args.call_id !== 'string' || ['.', '..', ''].includes(args.call_id))
				throw new SarjReadError('INPUT');
			path += '/' + encodeURIComponent(args.call_id);
			if (operation === 'getCallTranscript') path += '/transcript';
			if (operation === 'getCallAnalysis') path += '/analysis';
		}
		try {
			const response = await this.request({
				url: SARJ_API_BASE + path,
				method: 'GET',
				headers: { Accept: 'application/json' },
				...(operation === 'listCalls' ? { qs: args } : {}),
				returnFullResponse: true,
				encoding: 'json',
				json: true,
				disableFollowRedirect: true,
				maxRedirects: 0,
				timeout: Math.min(30_000, remaining),
				maxResponseBodyBytes: MAX_BODY_BYTES,
				...(this.signal ? { abortSignal: this.signal } : {}),
			});
			if (!isRecord(response)) throw new SarjReadError('RESPONSE');
			const status = Number(response.statusCode);
			if (!Number.isInteger(status) || status < 200 || status >= 300) throw { statusCode: status };
			if (!isRecord(response.body) || !isRecord(response.body.data))
				throw new SarjReadError('RESPONSE');
			return response.body.data as IDataObject;
		} catch (error) {
			const safe = this.signal?.aborted ? new SarjReadError('TIMEOUT') : safeError(error);
			const status = httpStatus(error);
			throw new NodeApiError(
				this.node,
				{ message: safe.message },
				{
					message: safe.message,
					...(status ? { httpCode: String(status) } : {}),
				},
			);
		}
	}

	async list(args: IDataObject, returnAll: boolean): Promise<IDataObject[]> {
		const calls: IDataObject[] = [];
		const seen = new Set<string>();
		if (typeof args.cursor === 'string') seen.add(args.cursor);
		for (let page = 0; page < 100; page++) {
			const result = await this.read('listCalls', args);
			if (
				!Array.isArray(result.calls) ||
				result.calls.length > Number(args.limit) ||
				!result.calls.every(isRecord)
			)
				throw new SarjReadError('RESPONSE');
			calls.push(...(result.calls as IDataObject[]));
			const cursor = result.next_cursor;
			if (!returnAll || cursor === null) return calls;
			if (
				typeof cursor !== 'string' ||
				cursor.length < 1 ||
				cursor.length > 128 ||
				seen.has(cursor)
			)
				throw new SarjReadError('RESPONSE');
			seen.add(cursor);
			args = { ...args, cursor };
		}
		throw new SarjReadError('TIMEOUT');
	}
}
