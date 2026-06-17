/**
 * URL helpers + login-token decoding for CodeMie SSO.
 *
 * `ensureApiBase` / `normalizeToBase` / `deriveExpiresAt` mirror the equivalents
 * in the CodeMie CLI (`@codemieai/code`) byte-for-byte so the credentials we
 * write are looked up under the same storage key the proxy daemon expects.
 */

import { URL } from 'node:url';

/** Append `/code-assistant-api` to an instance URL if not already present. */
export function ensureApiBase(rawUrl: string): string {
	let base = rawUrl.trim().replace(/\/$/, '');
	if (!/\/code-assistant-api(\/|$)/i.test(base)) {
		base = `${base}/code-assistant-api`;
	}
	return base;
}

/** Reduce a URL to its origin `${protocol}//${host}` (CodeMie's normalizeToBase). */
export function normalizeToBase(url: string): string {
	try {
		const parsed = new URL(url.trim());
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return url.trim();
	}
}

/**
 * Fixed redirect port for the browser login URL. CodeMie validates the port path
 * param must be >= 1 (port 0 is rejected after sign-in), but no server needs to
 * listen on it: after authenticating, the browser lands on a dead
 * `http://localhost:<PORT>/auth?token=...` page and the user copies the token
 * from the address bar. The token is port-independent and reusable. A high
 * private-range port minimises the chance of colliding with a local service.
 */
export const SSO_REDIRECT_PORT = 54321;

/** Browser login URL the user opens to obtain an SSO token. */
export function buildLoginUrl(instanceUrl: string): string {
	return `${ensureApiBase(instanceUrl)}/v1/auth/login/${SSO_REDIRECT_PORT}`;
}

export interface DecodedLoginToken {
	cookies: Record<string, string>;
	apiUrl?: string;
}

/**
 * Decode the base64 login token copied from the post-auth redirect page
 * (`http://localhost:<port>/auth?token=<base64>`). The token is base64-encoded
 * JSON; only `cookies` is required (any `provider` field is ignored, matching
 * the CLI). Tolerates the user pasting the whole redirect URL or a `token=...`
 * fragment instead of just the value.
 */
export function decodeLoginToken(raw: string): DecodedLoginToken {
	let value = (raw ?? '').trim();
	if (!value) {
		throw new Error('Login token is empty.');
	}

	const match = value.match(/(?:[?&](?:token|auth|data)=)([^&\s]+)/i);
	if (match) {
		value = decodeURIComponent(match[1]);
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
	} catch {
		throw new Error('Login token is not valid base64-encoded JSON. Re-copy the full token value.');
	}

	if (!decoded || typeof decoded !== 'object') {
		throw new Error('Login token did not decode to an object.');
	}

	const cookies = (decoded as { cookies?: unknown }).cookies;
	if (!cookies || typeof cookies !== 'object') {
		throw new Error('Login token is missing the "cookies" field. Re-copy the full token value.');
	}

	const apiUrl = (decoded as { apiUrl?: unknown }).apiUrl;
	return {
		cookies: cookies as Record<string, string>,
		apiUrl: typeof apiUrl === 'string' ? apiUrl : undefined,
	};
}

/**
 * Derive credential expiry from the `codemie_access_token` JWT `exp` claim,
 * falling back to 24h. The proxy daemon clears expired credentials, so this
 * must be a future timestamp. `now` is injectable for deterministic tests.
 */
export function deriveExpiresAt(cookies: Record<string, string>, now: number = Date.now()): number {
	const DEFAULT_TTL = 24 * 60 * 60 * 1000;
	const accessToken = cookies?.codemie_access_token;
	if (accessToken) {
		try {
			const parts = accessToken.split('.');
			if (parts.length === 3) {
				const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as {
					exp?: number;
				};
				if (typeof payload.exp === 'number') {
					return payload.exp * 1000;
				}
			}
		} catch {
			// malformed JWT — fall through to default
		}
	}
	return now + DEFAULT_TTL;
}
