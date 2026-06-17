import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { storeSsoCredentials } from './credentialStore';
import { fetchCodeMieModels } from './models';
import { ensureCodemieProxy } from './proxy';
import { buildLoginUrl, decodeLoginToken } from './token';

/**
 * Hidden helper node. It is never placed on a canvas; it exists so n8n can
 * resolve the function-based credential test for the CodeMie SSO credential
 * (n8n scans registered nodes for a `credentials[].testedBy` match). The test
 * performs the complete-login flow: decode the pasted token, store the SSO
 * credentials where the proxy daemon reads them, start/reuse the proxy, and
 * verify by listing models.
 */
export class CodeMieAuth implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'CodeMie Authentication',
		name: 'codeMieAuth',
		icon: 'file:codemie.svg',
		group: ['transform'],
		version: 1,
		hidden: true,
		description:
			'Helper for the CodeMie SSO API credential. Configure CodeMie from the Claude Agent SDK node — you do not add this node to a workflow.',
		defaults: { name: 'CodeMie Authentication' },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		inputs: [] as any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		outputs: [] as any,
		credentials: [
			{
				name: 'codeMieSsoApi',
				required: true,
				testedBy: 'codeMieLoginTest',
			},
		],
		properties: [
			{
				displayName:
					'This is a helper node for the CodeMie SSO API credential. Configure CodeMie from the Claude Agent SDK node instead — you do not need to add this node to a workflow.',
				name: 'helperNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	methods = {
		credentialTest: {
			async codeMieLoginTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = (credential.data ?? {}) as { instanceUrl?: string; loginToken?: string };
				const instanceUrl = (data.instanceUrl ?? '').trim();
				const loginToken = (data.loginToken ?? '').trim();

				if (!instanceUrl) {
					return {
						status: 'Error',
						message: 'Enter the Instance URL first (e.g. https://codemie.lab.epam.com).',
					};
				}

				if (!loginToken) {
					return {
						status: 'Error',
						message:
							`No login token yet. Open ${buildLoginUrl(instanceUrl)} in your browser, sign in, ` +
							'then copy the token=... value from the redirect page into "Login Token" and click Test again.',
					};
				}

				try {
					const { cookies } = decodeLoginToken(loginToken);
					await storeSsoCredentials(instanceUrl, cookies);
					const proxy = await ensureCodemieProxy({ instanceUrl });
					const models = await fetchCodeMieModels(proxy);
					if (models.length === 0) {
						return {
							status: 'Error',
							message:
								'Logged in and proxy started, but no models were returned. The session may be invalid — re-authenticate.',
						};
					}
					return {
						status: 'OK',
						message: `Logged in. ${models.length} model(s) available via the CodeMie proxy.`,
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { status: 'Error', message: `CodeMie login failed: ${message}` };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Hidden helper node — not meant to run inside a workflow.
		throw new NodeOperationError(
			this.getNode(),
			'CodeMie Authentication is a helper node for credential testing and cannot be executed in a workflow. Use the Claude Agent SDK node with the CodeMie Proxy authentication instead.',
		);
	}
}
