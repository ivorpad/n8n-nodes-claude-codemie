/**
 * CodeMie proxy daemon lifecycle.
 *
 * `ensureCodemieProxy` reuses a healthy daemon (state file pid alive + same
 * target + `/health` ok) or spawns a detached one and waits for it to come up.
 * The daemon is persistent and reused across requests — there is no teardown.
 * Cross-platform: spawns `process.execPath` with the resolved daemon script, no
 * shell. The injection seams exist purely for unit tests.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { codemieHome } from './credentialStore';
import { httpGet } from './http';
import { ensureSanitizingProxy } from './sanitizingProxy';
import { ensureApiBase, normalizeToBase } from './token';

export const DEFAULT_GATEWAY_KEY = 'codemie-proxy';

export interface ProxyHandle {
	url: string;
	gatewayKey: string;
}

interface DaemonState {
	pid?: number;
	url?: string;
	gatewayKey?: string;
	targetUrl?: string;
}

function proxyPort(): number {
	const raw = Number(process.env.CODEMIE_PROXY_PORT);
	return Number.isFinite(raw) && raw > 0 ? raw : 4001;
}

function stateFilePath(): string {
	return path.join(codemieHome(), 'proxy-daemon.json');
}

/** Locate `bin/proxy-daemon.js` inside the installed `@codemieai/code`. */
export function resolveProxyDaemonScript(): string {
	const req = createRequire(__filename);
	const pkgJson = req.resolve('@codemieai/code/package.json');
	return path.join(path.dirname(pkgJson), 'bin', 'proxy-daemon.js');
}

function readState(file: string): DaemonState | undefined {
	try {
		if (!existsSync(file)) return undefined;
		return JSON.parse(readFileSync(file, 'utf8')) as DaemonState;
	} catch {
		return undefined;
	}
}

function isPidAlive(pid: number | undefined): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but is owned by another user.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

async function defaultHealth(url: string): Promise<boolean> {
	try {
		const res = await httpGet(`${url.replace(/\/$/, '')}/health`, {}, 3000);
		return res.status >= 200 && res.status < 300;
	} catch {
		return false;
	}
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface EnsureProxyOptions {
	instanceUrl: string;
	/** Test seams. */
	spawnFn?: typeof spawn;
	readStateFn?: (file: string) => DaemonState | undefined;
	healthFn?: (url: string) => Promise<boolean>;
	resolveDaemonFn?: () => string;
	maxWaitMs?: number;
	pollIntervalMs?: number;
	/** Wraps the daemon URL with the request-sanitizing proxy. Test seam. */
	sanitizeFn?: (daemonUrl: string) => Promise<string>;
}

export async function ensureCodemieProxy(options: EnsureProxyOptions): Promise<ProxyHandle> {
	const instanceUrl = (options.instanceUrl ?? '').trim();
	if (!instanceUrl) {
		throw new Error('CodeMie instance URL is required to start the proxy.');
	}

	const targetUrl = ensureApiBase(instanceUrl);
	const stateFile = stateFilePath();
	const readStateFn = options.readStateFn ?? readState;
	const healthFn = options.healthFn ?? defaultHealth;
	const spawnFn = options.spawnFn ?? spawn;
	const resolveDaemonFn = options.resolveDaemonFn ?? resolveProxyDaemonScript;
	const sanitizeFn = options.sanitizeFn ?? ensureSanitizingProxy;

	// Reuse a healthy daemon that targets the same instance.
	const existing = readStateFn(stateFile);
	if (existing?.url && isPidAlive(existing.pid)) {
		const sameTarget =
			!existing.targetUrl || normalizeToBase(existing.targetUrl) === normalizeToBase(targetUrl);
		if (!sameTarget) {
			throw new Error(
				`A CodeMie proxy is already running for a different instance (${existing.targetUrl}). ` +
					'Stop it or use a separate CODEMIE_HOME for this instance.',
			);
		}
		if (await healthFn(existing.url)) {
			return {
				url: await sanitizeFn(existing.url),
				gatewayKey: existing.gatewayKey || DEFAULT_GATEWAY_KEY,
			};
		}
	}

	// Spawn a detached daemon; it outlives this request and is reused next time.
	const daemonScript = resolveDaemonFn();
	const args = [
		daemonScript,
		'--target-url', targetUrl,
		'--provider', 'ai-run-sso',
		'--auth-method', 'sso',
		'--gateway-key', DEFAULT_GATEWAY_KEY,
		'--port', String(proxyPort()),
		'--state-file', stateFile,
	];
	const child = spawnFn(process.execPath, args, {
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, CODEMIE_HOME: codemieHome() },
	});
	child.unref?.();

	const maxWaitMs = options.maxWaitMs ?? 10000;
	const pollIntervalMs = options.pollIntervalMs ?? 200;
	const deadline = Date.now() + maxWaitMs;
	while (Date.now() < deadline) {
		await delay(pollIntervalMs);
		const state = readStateFn(stateFile);
		if (state?.url && (await healthFn(state.url))) {
			return {
				url: await sanitizeFn(state.url),
				gatewayKey: state.gatewayKey || DEFAULT_GATEWAY_KEY,
			};
		}
	}

	throw new Error(
		'CodeMie proxy did not become healthy in time. Verify @codemieai/code is installed and the SSO session is valid.',
	);
}
