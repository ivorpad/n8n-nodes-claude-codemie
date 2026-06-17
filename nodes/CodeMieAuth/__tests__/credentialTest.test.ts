import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../credentialStore', () => ({ storeSsoCredentials: vi.fn() }));
vi.mock('../proxy', () => ({ ensureCodemieProxy: vi.fn() }));
vi.mock('../models', () => ({ fetchCodeMieModels: vi.fn() }));

import { storeSsoCredentials } from '../credentialStore';
import { ensureCodemieProxy } from '../proxy';
import { fetchCodeMieModels } from '../models';
import { CodeMieAuth } from '../CodeMieAuth.node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const validToken = Buffer.from(
	JSON.stringify({ cookies: { codemie_access_token: 'x' } }),
).toString('base64');

const runTest = (data: Record<string, unknown>) =>
	new CodeMieAuth().methods.credentialTest.codeMieLoginTest.call({} as any, { data } as any);

describe('codeMieLoginTest', () => {
	beforeEach(() => {
		(storeSsoCredentials as any).mockReset();
		(ensureCodemieProxy as any).mockReset();
		(fetchCodeMieModels as any).mockReset();
	});

	it('asks for the Instance URL when it is missing', async () => {
		const res = await runTest({ loginToken: validToken });
		expect(res.status).toBe('Error');
		expect(res.message).toMatch(/Instance URL/i);
		expect(storeSsoCredentials).not.toHaveBeenCalled();
	});

	it('returns the clickable-style login URL when no token has been pasted', async () => {
		const res = await runTest({ instanceUrl: 'https://codemie.lab.epam.com' });
		expect(res.status).toBe('Error');
		expect(res.message).toContain(
			'https://codemie.lab.epam.com/code-assistant-api/v1/auth/login/54321',
		);
		expect(storeSsoCredentials).not.toHaveBeenCalled();
	});

	it('completes login: stores creds, starts the proxy, lists models', async () => {
		(ensureCodemieProxy as any).mockResolvedValue({
			url: 'http://127.0.0.1:4001',
			gatewayKey: 'codemie-proxy',
		});
		(fetchCodeMieModels as any).mockResolvedValue([
			{ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet' },
		]);

		const res = await runTest({
			instanceUrl: 'https://codemie.lab.epam.com',
			loginToken: validToken,
		});

		expect(storeSsoCredentials).toHaveBeenCalledWith('https://codemie.lab.epam.com', {
			codemie_access_token: 'x',
		});
		expect(ensureCodemieProxy).toHaveBeenCalledWith({
			instanceUrl: 'https://codemie.lab.epam.com',
		});
		expect(res.status).toBe('OK');
		expect(res.message).toMatch(/1 model/);
	});

	it('reports a clear error when the token is malformed', async () => {
		const res = await runTest({
			instanceUrl: 'https://codemie.lab.epam.com',
			loginToken: 'garbage===',
		});
		expect(res.status).toBe('Error');
		expect(res.message).toMatch(/CodeMie login failed/);
		expect(ensureCodemieProxy).not.toHaveBeenCalled();
	});

	it('flags an empty model list as not logged in', async () => {
		(ensureCodemieProxy as any).mockResolvedValue({
			url: 'http://127.0.0.1:4001',
			gatewayKey: 'codemie-proxy',
		});
		(fetchCodeMieModels as any).mockResolvedValue([]);

		const res = await runTest({
			instanceUrl: 'https://codemie.lab.epam.com',
			loginToken: validToken,
		});
		expect(res.status).toBe('Error');
		expect(res.message).toMatch(/no models/i);
	});
});
