import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SarjApi implements ICredentialType {
	name = 'sarjApi';
	displayName = 'Sarj API';
	documentationUrl = 'https://github.com/sarj-ai/n8n-nodes-sarj#credentials';
	icon = {
		light: 'file:../nodes/Sarj/sarj.svg',
		dark: 'file:../nodes/Sarj/sarj.dark.svg',
	} as const;
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'A Sarj API key with calls:read scope for the intended organization',
		},
	];
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://platform-api.sarj.ai/api/v1',
			url: '/calls',
			method: 'GET',
			qs: { limit: 1 },
			headers: { Accept: 'application/json' },
			json: true,
			timeout: 10_000,
			disableFollowRedirect: true,
			maxRedirects: 0,
			maxResponseBodyBytes: 2 * 1024 * 1024,
		},
		rules: [
			{ type: 'responseCode', properties: { value: 401, message: 'Check your Sarj API key.' } },
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'Check calls:read scope, organization access and pilot eligibility.',
				},
			},
		],
	};
}
