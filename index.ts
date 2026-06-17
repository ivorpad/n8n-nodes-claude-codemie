/**
 * Public API consumed by the main `n8n-nodes-claude-agent-sdk` node when it
 * detects this companion at module-load. Importing this package is the feature
 * flag — there is no env var to toggle CodeMie support.
 */

export { ensureCodemieProxy, DEFAULT_GATEWAY_KEY, resolveProxyDaemonScript } from './nodes/CodeMieAuth/proxy';
export type { ProxyHandle, EnsureProxyOptions } from './nodes/CodeMieAuth/proxy';

export { fetchCodeMieModels, parseCodeMieModels } from './nodes/CodeMieAuth/models';
export type { CodeMieModelOption } from './nodes/CodeMieAuth/models';

export { buildLoginUrl, ensureApiBase, normalizeToBase, decodeLoginToken } from './nodes/CodeMieAuth/token';

export { storeSsoCredentials, credentialFilePath, codemieHome } from './nodes/CodeMieAuth/credentialStore';
