import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * CodeMie SSO credential.
 *
 * Holds the instance URL (non-secret) and the pasted SSO login token (secret).
 * It deliberately has NO declarative `test`: the complete-login flow runs as the
 * CodeMieAuth node's function-based `credentialTest` (`codeMieLoginTest`), which
 * n8n resolves by scanning registered nodes for the matching `testedBy`.
 */
export class CodeMieSsoApi implements ICredentialType {
	name = 'codeMieSsoApi';

	displayName = 'CodeMie SSO API';

	documentationUrl = 'https://github.com/ivorpad/n8n-nodes-claude-codemie';

	icon = {
		light: 'file:../nodes/CodeMieAuth/codemie.svg',
		dark: 'file:../nodes/CodeMieAuth/codemie.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Instance URL',
			name: 'instanceUrl',
			type: 'string',
			required: true,
			default: 'https://codemie.lab.epam.com',
			placeholder: 'https://codemie.lab.epam.com',
			description:
				'Root URL of your CodeMie instance (no path). Used to build the login link and the proxy target.',
		},
		{
			displayName: 'Login Token',
			name: 'loginToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The token=... value from the post-login redirect page. On the Claude Agent SDK node, click the Authenticate link to open CodeMie sign-in, then paste the token here and click Test.',
		},
		{
			displayName:
				'Steps: 1) Enter the Instance URL. 2) On the Claude Agent SDK node, open the Authenticate link and sign in. 3) Copy the token from the redirect page into Login Token. 4) Click Test. SSO sessions expire roughly every 24 hours — re-paste a fresh token when prompted.',
			name: 'ssoNotice',
			type: 'notice',
			default: '',
		},
	];
}
