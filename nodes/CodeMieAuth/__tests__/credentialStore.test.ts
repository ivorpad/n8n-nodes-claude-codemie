import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	credentialFilePath,
	decryptCredential,
	encryptCredential,
	getUrlStorageKey,
	storeSsoCredentials,
} from '../credentialStore';

describe('getUrlStorageKey', () => {
	it('matches CodeMie: sha256 of the lowercased, trailing-slash-stripped base', () => {
		const base = 'https://codemie.lab.epam.com';
		const expected = `sso-${createHash('sha256').update(base.toLowerCase()).digest('hex')}`;
		expect(getUrlStorageKey(base)).toBe(expected);
		expect(getUrlStorageKey('https://CodeMie.lab.epam.com/')).toBe(expected);
	});
});

describe('credentialFilePath', () => {
	it('keys the file by the instance origin under $CODEMIE_HOME/credentials', () => {
		const prev = process.env.CODEMIE_HOME;
		process.env.CODEMIE_HOME = '/tmp/ch';
		try {
			expect(credentialFilePath('https://codemie.lab.epam.com/code-assistant-api')).toBe(
				path.join('/tmp/ch', 'credentials', `${getUrlStorageKey('https://codemie.lab.epam.com')}.enc`),
			);
		} finally {
			if (prev === undefined) delete process.env.CODEMIE_HOME;
			else process.env.CODEMIE_HOME = prev;
		}
	});
});

describe('encrypt/decrypt round-trip', () => {
	it('produces ivHex:tagHex:encHex and decrypts back', () => {
		const text = JSON.stringify({ cookies: { a: '1' }, apiUrl: 'https://x', expiresAt: 123 });
		const enc = encryptCredential(text);
		expect(enc.split(':')).toHaveLength(3);
		expect(decryptCredential(enc)).toBe(text);
	});
});

describe('storeSsoCredentials', () => {
	const home = path.join(os.tmpdir(), `codemie-test-${process.pid}`);

	beforeEach(() => {
		process.env.CODEMIE_HOME = home;
	});

	afterEach(async () => {
		await fs.rm(home, { recursive: true, force: true });
		delete process.env.CODEMIE_HOME;
	});

	it('replica fallback writes a decryptable file at the daemon lookup path', async () => {
		const importer = vi.fn().mockRejectedValue(new Error('no dist'));
		await storeSsoCredentials('https://codemie.lab.epam.com', { codemie_access_token: 'x' }, importer);

		const file = credentialFilePath('https://codemie.lab.epam.com');
		const decoded = JSON.parse(decryptCredential(await fs.readFile(file, 'utf8')));
		expect(decoded.cookies).toEqual({ codemie_access_token: 'x' });
		expect(decoded.apiUrl).toBe('https://codemie.lab.epam.com/code-assistant-api');
		expect(typeof decoded.expiresAt).toBe('number');
	});

	it('prefers the real CredentialStore, storing under the instance origin', async () => {
		const storeSSOCredentials = vi.fn().mockResolvedValue(undefined);
		const importer = vi
			.fn()
			.mockResolvedValue({ CredentialStore: { getInstance: () => ({ storeSSOCredentials }) } });

		await storeSsoCredentials('https://codemie.lab.epam.com', { a: '1' }, importer);

		expect(storeSSOCredentials).toHaveBeenCalledTimes(1);
		const [creds, base] = storeSSOCredentials.mock.calls[0];
		expect(base).toBe('https://codemie.lab.epam.com');
		expect(creds.apiUrl).toBe('https://codemie.lab.epam.com/code-assistant-api');
		await expect(
			fs.readFile(credentialFilePath('https://codemie.lab.epam.com'), 'utf8'),
		).rejects.toThrow();
	});
});
