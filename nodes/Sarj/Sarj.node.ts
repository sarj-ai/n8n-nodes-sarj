import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { booleanParameter, detailArgs, listArgs, STATUS, operationFor } from './inputs';
import { safeError, SarjReadClient } from './api';

export class Sarj implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sarj AI',
		name: 'sarj',
		icon: { light: 'file:sarj.svg', dark: 'file:sarj.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read call history, transcripts and analysis from Sarj AI',
		defaults: { name: 'Sarj AI' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sarjApi', required: true }],
		properties: [
			{
				displayName:
					'Call history, transcripts and analysis must be enabled for your Sarj organization. Ask engineering@sarj.ai about pilot eligibility. Return All is bounded to 100 pages and 45 seconds per input item.',
				name: 'eligibilityNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Call', value: 'call' }],
				default: 'call',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['call'] } },
				options: [
					{ name: 'Get', value: 'get', description: 'Get call details', action: 'Get a call' },
					{
						name: 'Get Analysis',
						value: 'getAnalysis',
						description: 'Get available call outcome and analysis',
						action: 'Get call analysis',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'Get call history with optional filters',
						action: 'Get many calls',
					},
					{
						name: 'Get Transcript',
						value: 'getTranscript',
						description: 'Get an available call transcript',
						action: 'Get a call transcript',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Call ID',
				name: 'callId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: { resource: ['call'], operation: ['get', 'getTranscript', 'getAnalysis'] },
				},
				description: 'The call ID returned by Get Many',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['call'], operation: ['getMany'] } },
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 50,
				displayOptions: {
					show: { resource: ['call'], operation: ['getMany'], returnAll: [false] },
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['call'], operation: ['getMany'] } },
				options: [
					{
						displayName: 'Created From',
						name: 'createdFrom',
						type: 'dateTime',
						default: '',
						description: 'Inclusive lower creation-time bound, as an ISO 8601 timestamp',
					},
					{
						displayName: 'Created To',
						name: 'createdTo',
						type: 'dateTime',
						default: '',
						description: 'Exclusive upper creation-time bound, as an ISO 8601 timestamp',
					},
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description:
							'Optional cursor from a previous Sarj list response; maximum 128 characters',
					},
					{
						displayName: 'Scenario ID',
						name: 'scenarioId',
						type: 'string',
						default: '',
						description: 'Filter by a scenario UUID in the credential organization',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'completed',
						options: STATUS.map((status) => ({
							name: status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
							value: status,
						})),
						description: 'Filter by call status',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const operation = operationFor(
					this.getNodeParameter('resource', i),
					this.getNodeParameter('operation', i),
				);
				const returnAll =
					operation === 'listCalls'
						? booleanParameter(this.getNodeParameter('returnAll', i))
						: false;
				const args =
					operation === 'listCalls'
						? listArgs(
								this.getNodeParameter('filters', i),
								returnAll ? 100 : this.getNodeParameter('limit', i),
							)
						: detailArgs(operation, this.getNodeParameter('callId', i));
				const client = new SarjReadClient(
					(options) => this.helpers.httpRequestWithAuthentication.call(this, 'sarjApi', options),
					this.getNode(),
					this.getExecutionCancelSignal(),
				);
				const data: IDataObject[] =
					operation === 'listCalls'
						? await client.list(args, returnAll)
						: [await client.read(operation, args)];
				output.push(...data.map((call) => ({ json: call, pairedItem: { item: i } })));
			} catch (error) {
				const safe = safeError(error);
				if (this.continueOnFail()) {
					output.push({ json: { error: safe.message }, pairedItem: { item: i } });
					continue;
				}
				if (safe.code === 'INPUT')
					throw new NodeOperationError(this.getNode(), safe.message, { itemIndex: i });
				throw new NodeApiError(
					this.getNode(),
					{ message: safe.message },
					{ message: safe.message, itemIndex: i },
				);
			}
		}
		return [output];
	}
}
