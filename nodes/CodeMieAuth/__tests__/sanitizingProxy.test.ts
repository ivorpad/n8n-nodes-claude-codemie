import * as http from 'node:http';
import { URL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	closeSanitizingProxy,
	ensureSanitizingProxy,
	sanitizeRequestBody,
} from '../sanitizingProxy';

describe('sanitizeRequestBody', () => {
	it('removes context_management and keeps other fields', () => {
		const input = Buffer.from(
			JSON.stringify({ model: 'm', context_management: { edits: [] }, messages: [] }),
		);
		expect(JSON.parse(sanitizeRequestBody(input).toString())).toEqual({ model: 'm', messages: [] });
	});

	it('leaves bodies without the field unchanged', () => {
		const input = Buffer.from(JSON.stringify({ model: 'm' }));
		expect(sanitizeRequestBody(input).toString()).toBe(input.toString());
	});

	it('passes non-JSON bodies through untouched', () => {
		const input = Buffer.from('not json at all');
		expect(sanitizeRequestBody(input)).toBe(input);
	});

	it('handles an empty body', () => {
		const input = Buffer.from('');
		expect(sanitizeRequestBody(input)).toBe(input);
	});
});

describe('ensureSanitizingProxy', () => {
	let upstream: http.Server;
	let upstreamUrl = '';
	const seen: Array<{ method?: string; url?: string; body: string; auth?: string }> = [];

	beforeAll(async () => {
		upstream = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (c) => chunks.push(Buffer.from(c)));
			req.on('end', () => {
				seen.push({
					method: req.method,
					url: req.url,
					body: Buffer.concat(chunks).toString('utf8'),
					auth: req.headers.authorization as string | undefined,
				});
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
			});
		});
		await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
		const addr = upstream.address();
		upstreamUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
	});

	afterAll(async () => {
		await closeSanitizingProxy();
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
	});

	async function send(
		method: string,
		path: string,
		body?: string,
		headers: Record<string, string> = {},
	): Promise<{ status: number; body: string }> {
		const shimUrl = await ensureSanitizingProxy(upstreamUrl);
		const target = new URL(path, shimUrl);
		return await new Promise((resolve, reject) => {
			const req = http.request(target, { method, headers }, (res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(Buffer.from(c)));
				res.on('end', () =>
					resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }),
				);
			});
			req.on('error', reject);
			if (body !== undefined) req.end(body);
			else req.end();
		});
	}

	it('strips context_management from POST bodies before forwarding', async () => {
		const res = await send(
			'POST',
			'/v1/messages',
			JSON.stringify({ model: 'm', context_management: { edits: [] }, messages: [{ role: 'user' }] }),
			{ 'content-type': 'application/json', authorization: 'Bearer codemie-proxy' },
		);
		expect(res.status).toBe(200);
		const last = seen[seen.length - 1];
		expect(last.method).toBe('POST');
		const forwarded = JSON.parse(last.body);
		expect(forwarded).not.toHaveProperty('context_management');
		expect(forwarded.model).toBe('m');
		expect(last.auth).toBe('Bearer codemie-proxy');
	});

	it('passes GET requests through unchanged', async () => {
		const res = await send('GET', '/v1/llm_models?include_all=true');
		expect(res.status).toBe(200);
		const last = seen[seen.length - 1];
		expect(last.method).toBe('GET');
		expect(last.url).toBe('/v1/llm_models?include_all=true');
	});
});
