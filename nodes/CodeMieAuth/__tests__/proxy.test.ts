import { describe, expect, it, vi } from 'vitest';

import { ensureCodemieProxy } from '../proxy';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('ensureCodemieProxy', () => {
	it('reuses a healthy daemon on the same target without spawning', async () => {
		const spawnFn = vi.fn();
		const handle = await ensureCodemieProxy({
			instanceUrl: 'https://codemie.lab.epam.com',
			spawnFn: spawnFn as any,
			readStateFn: () => ({
				pid: process.pid,
				url: 'http://127.0.0.1:4001',
				gatewayKey: 'codemie-proxy',
				targetUrl: 'https://codemie.lab.epam.com/code-assistant-api',
			}),
			healthFn: async () => true,
			resolveDaemonFn: () => '/fake/proxy-daemon.js',
			sanitizeFn: async (u) => u,
		});

		expect(handle).toEqual({ url: 'http://127.0.0.1:4001', gatewayKey: 'codemie-proxy' });
		expect(spawnFn).not.toHaveBeenCalled();
	});

	it('routes the daemon URL through the sanitizing proxy', async () => {
		const sanitizeFn = vi.fn(async () => 'http://127.0.0.1:55555');
		const handle = await ensureCodemieProxy({
			instanceUrl: 'https://codemie.lab.epam.com',
			spawnFn: vi.fn() as any,
			readStateFn: () => ({
				pid: process.pid,
				url: 'http://127.0.0.1:4001',
				gatewayKey: 'codemie-proxy',
				targetUrl: 'https://codemie.lab.epam.com/code-assistant-api',
			}),
			healthFn: async () => true,
			resolveDaemonFn: () => '/fake/proxy-daemon.js',
			sanitizeFn,
		});

		expect(sanitizeFn).toHaveBeenCalledWith('http://127.0.0.1:4001');
		expect(handle).toEqual({ url: 'http://127.0.0.1:55555', gatewayKey: 'codemie-proxy' });
	});

	it('spawns a detached daemon when no healthy state exists', async () => {
		const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() });
		let reads = 0;
		const readStateFn = () => {
			reads += 1;
			// First read is the reuse check (nothing yet); later reads see the daemon up.
			return reads === 1 ? undefined : { url: 'http://127.0.0.1:4001', gatewayKey: 'codemie-proxy' };
		};

		const handle = await ensureCodemieProxy({
			instanceUrl: 'https://codemie.lab.epam.com',
			spawnFn: spawnFn as any,
			readStateFn,
			healthFn: async () => true,
			resolveDaemonFn: () => '/fake/proxy-daemon.js',
			maxWaitMs: 1000,
			pollIntervalMs: 1,
			sanitizeFn: async (u) => u,
		});

		expect(handle.url).toBe('http://127.0.0.1:4001');
		expect(spawnFn).toHaveBeenCalledTimes(1);
		const [bin, args] = spawnFn.mock.calls[0];
		expect(bin).toBe(process.execPath);
		expect(args).toEqual(
			expect.arrayContaining([
				'/fake/proxy-daemon.js',
				'--target-url',
				'https://codemie.lab.epam.com/code-assistant-api',
				'--auth-method',
				'sso',
				'--provider',
				'ai-run-sso',
			]),
		);
	});

	it('refuses to reuse a daemon bound to a different instance', async () => {
		await expect(
			ensureCodemieProxy({
				instanceUrl: 'https://codemie.lab.epam.com',
				readStateFn: () => ({
					pid: process.pid,
					url: 'http://127.0.0.1:4001',
					targetUrl: 'https://other.example.com/code-assistant-api',
				}),
				healthFn: async () => true,
				spawnFn: (() => {
					throw new Error('should not spawn');
				}) as any,
				resolveDaemonFn: () => '/fake/proxy-daemon.js',
			}),
		).rejects.toThrow(/different instance/i);
	});

	it('throws a clear error when the daemon never becomes healthy', async () => {
		await expect(
			ensureCodemieProxy({
				instanceUrl: 'https://codemie.lab.epam.com',
				spawnFn: vi.fn().mockReturnValue({ unref: vi.fn() }) as any,
				readStateFn: () => undefined,
				healthFn: async () => false,
				resolveDaemonFn: () => '/fake/proxy-daemon.js',
				maxWaitMs: 5,
				pollIntervalMs: 1,
			}),
		).rejects.toThrow(/did not become healthy/i);
	});
});
