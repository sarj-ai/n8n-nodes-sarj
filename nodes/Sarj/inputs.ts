import type { IDataObject } from 'n8n-workflow';
import { isRecord, SarjReadError, type ReadOperation } from './api';

export const STATUS = [
	'queued',
	'in_progress',
	'transferring',
	'transferred',
	'completed',
	'timeout',
	'user_rejected',
	'max_duration_reached',
	'failed',
	'ringing',
	'voicemail',
	'dialing',
	'cancelled',
	'expired',
	'scheduled',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mapping: Record<string, ReadOperation> = {
	getMany: 'listCalls',
	get: 'getCall',
	getTranscript: 'getCallTranscript',
	getAnalysis: 'getCallAnalysis',
};

export function operationFor(resource: unknown, operation: unknown): ReadOperation {
	if (
		resource !== 'call' ||
		typeof operation !== 'string' ||
		!Object.prototype.hasOwnProperty.call(mapping, operation)
	)
		throw new SarjReadError('INPUT');
	return mapping[operation];
}

export function booleanParameter(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new SarjReadError('INPUT');
	return value;
}

function date(value: unknown): string {
	if (typeof value !== 'string') throw new SarjReadError('INPUT');
	const match =
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
			value,
		);
	if (!match || !Number.isFinite(Date.parse(value))) throw new SarjReadError('INPUT');
	const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match;
	const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
	if (
		Number(year) < 1 ||
		Number(month) < 1 ||
		Number(month) > 12 ||
		Number(day) < 1 ||
		Number(day) > lastDay ||
		Number(hour) > 23 ||
		Number(minute) > 59 ||
		Number(second) > 59 ||
		Number(offsetHour) > 23 ||
		Number(offsetMinute) > 59
	)
		throw new SarjReadError('INPUT');
	return value;
}

export function listArgs(filters: unknown, limit: unknown): IDataObject {
	if (
		!isRecord(filters) ||
		Object.keys(filters).some(
			(name) => !['scenarioId', 'status', 'createdFrom', 'createdTo', 'cursor'].includes(name),
		)
	) {
		throw new SarjReadError('INPUT');
	}
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100)
		throw new SarjReadError('INPUT');
	const args: IDataObject = { limit };
	if (filters.scenarioId !== undefined && filters.scenarioId !== '') {
		if (typeof filters.scenarioId !== 'string' || !UUID.test(filters.scenarioId))
			throw new SarjReadError('INPUT');
		args.scenario_id = filters.scenarioId;
	}
	if (filters.status !== undefined && filters.status !== '') {
		if (typeof filters.status !== 'string' || !STATUS.some((status) => status === filters.status))
			throw new SarjReadError('INPUT');
		args.status = filters.status;
	}
	if (filters.createdFrom !== undefined && filters.createdFrom !== '')
		args.created_from = date(filters.createdFrom);
	if (filters.createdTo !== undefined && filters.createdTo !== '')
		args.created_to = date(filters.createdTo);
	if (
		typeof args.created_from === 'string' &&
		typeof args.created_to === 'string' &&
		Date.parse(args.created_from) >= Date.parse(args.created_to)
	) {
		throw new SarjReadError('INPUT');
	}
	if (filters.cursor !== undefined && filters.cursor !== '') {
		if (typeof filters.cursor !== 'string' || filters.cursor.length > 128)
			throw new SarjReadError('INPUT');
		args.cursor = filters.cursor;
	}
	return args;
}

export function detailArgs(operation: ReadOperation, value: unknown): IDataObject {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		['.', '..'].includes(value) ||
		(operation !== 'getCall' && !UUID.test(value))
	)
		throw new SarjReadError('INPUT');
	return { call_id: value };
}
