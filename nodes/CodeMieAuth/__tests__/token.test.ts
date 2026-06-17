import { describe, expect, it } from 'vitest';

import {
	buildLoginUrl,
	decodeLoginToken,
	deriveExpiresAt,
	ensureApiBase,
	normalizeToBase,
} from '../token';

const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64');

describe('ensureApiBase', () => {
	it('appends /code-assistant-api when missing', () => {
		expect(ensureApiBase('https://codemie.lab.epam.com')).toBe(
			'https://codemie.lab.epam.com/code-assistant-api',
		);
	});

	it('strips one trailing slash before appending', () => {
		expect(ensureApiBase('https://codemie.lab.epam.com/')).toBe(
			'https://codemie.lab.epam.com/code-assistant-api',
		);
	});

	it('leaves an existing /code-assistant-api intact', () => {
		expect(ensureApiBase('https://x.example.com/code-assistant-api')).toBe(
			'https://x.example.com/code-assistant-api',
		);
	});
});

describe('normalizeToBase', () => {
	it('reduces a deep URL to its origin', () => {
		expect(normalizeToBase('https://codemie.lab.epam.com/code-assistant-api/v1/x')).toBe(
			'https://codemie.lab.epam.com',
		);
	});

	it('returns the input on parse failure', () => {
		expect(normalizeToBase('not a url')).toBe('not a url');
	});
});

describe('buildLoginUrl', () => {
	it('builds the login URL with a valid redirect port (CodeMie rejects port 0)', () => {
		expect(buildLoginUrl('https://codemie.lab.epam.com')).toBe(
			'https://codemie.lab.epam.com/code-assistant-api/v1/auth/login/54321',
		);
	});
});

describe('decodeLoginToken', () => {
	it('decodes base64 JSON with cookies and apiUrl', () => {
		expect(decodeLoginToken(b64({ cookies: { a: '1' }, apiUrl: 'https://x' }))).toEqual({
			cookies: { a: '1' },
			apiUrl: 'https://x',
		});
	});

	it('extracts token= from a pasted redirect URL', () => {
		const token = b64({ cookies: { a: '1' } });
		expect(decodeLoginToken(`http://localhost:0/auth?token=${token}`)).toEqual({
			cookies: { a: '1' },
			apiUrl: undefined,
		});
	});

	it('throws when the cookies field is missing', () => {
		expect(() => decodeLoginToken(b64({ provider: 'x' }))).toThrow(/cookies/);
	});

	it('throws on input that is not base64 JSON', () => {
		expect(() => decodeLoginToken('@@@not-json@@@')).toThrow(/base64/);
	});

	it('throws on an empty token', () => {
		expect(() => decodeLoginToken('   ')).toThrow(/empty/);
	});
});

describe('deriveExpiresAt', () => {
	it('uses the codemie_access_token JWT exp claim', () => {
		const exp = 2000000000;
		const jwt = `h.${Buffer.from(JSON.stringify({ exp })).toString('base64')}.s`;
		expect(deriveExpiresAt({ codemie_access_token: jwt }, 1000)).toBe(exp * 1000);
	});

	it('falls back to now + 24h when no access token is present', () => {
		expect(deriveExpiresAt({}, 1000)).toBe(1000 + 24 * 60 * 60 * 1000);
	});

	it('falls back when the JWT is malformed', () => {
		expect(deriveExpiresAt({ codemie_access_token: 'not.a.jwt' }, 1000)).toBe(
			1000 + 24 * 60 * 60 * 1000,
		);
	});
});
