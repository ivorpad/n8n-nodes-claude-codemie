/**
 * In-process request-sanitizing reverse proxy.
 *
 * Claude Code 2.x sends a top-level `context_management` field in its Messages
 * API requests (its context-editing feature). The CodeMie / AI-Run gateway
 * (LiteLLM, strict validation) rejects unknown fields:
 *   400 {"message":"context_management: Extra inputs are not permitted"}
 * There is no env knob to disable it (claude.exe is a compiled binary), so this
 * thin proxy sits in front of the CodeMie daemon, removes such fields from JSON
 * request bodies, and streams responses straight through (SSE-safe). One
 * singleton per Node process, on an ephemeral loopback port.
 */

import * as http from 'node:http';
import { URL } from 'node:url';

/** Top-level request fields the CodeMie/AI-Run gateway rejects. Extend if more surface. */
export const STRIPPED_REQUEST_FIELDS = ['context_management'];

/** Remove unsupported top-level fields from a JSON request body; pass non-JSON through. */
export function sanitizeRequestBody(body: Buffer): Buffer {
	if (body.length === 0) return body;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.toString('utf8'));
	} catch {
		return body;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
	const obj = parsed as Record<string, unknown>;
	let changed = false;
	for (const field of STRIPPED_REQUEST_FIELDS) {
		if (field in obj) {
			delete obj[field];
			changed = true;
		}
	}
	return changed ? Buffer.from(JSON.stringify(obj), 'utf8') : body;
}

interface ShimState {
	server: http.Server;
	url: string;
	targetUrl: string;
}

let shim: ShimState | undefined;

function createServer(targetUrl: string): http.Server {
	return http.createServer((clientReq, clientRes) => {
		const chunks: Buffer[] = [];
		clientReq.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
		clientReq.on('end', () => {
			const raw = Buffer.concat(chunks);
			const isBodyless = clientReq.method === 'GET' || clientReq.method === 'HEAD';
			const body = isBodyless ? raw : sanitizeRequestBody(raw);

			let target: URL;
			try {
				target = new URL(clientReq.url || '/', targetUrl);
			} catch {
				clientRes.writeHead(400);
				clientRes.end('bad request url');
				return;
			}

			const headers: http.OutgoingHttpHeaders = { ...clientReq.headers };
			headers.host = target.host;
			if (!isBodyless) headers['content-length'] = String(Buffer.byteLength(body));

			const upstreamReq = http.request(
				target,
				{ method: clientReq.method, headers },
				(upstreamRes) => {
					clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
					upstreamRes.pipe(clientRes);
				},
			);
			upstreamReq.on('error', (err) => {
				if (!clientRes.headersSent) {
					clientRes.writeHead(502, { 'content-type': 'application/json' });
				}
				clientRes.end(
					JSON.stringify({ error: { message: `CodeMie sanitizing proxy: ${err.message}` } }),
				);
			});
			upstreamReq.end(isBodyless ? undefined : body);
		});
		clientReq.on('error', () => {
			try {
				clientRes.destroy();
			} catch {
				/* ignore */
			}
		});
	});
}

/**
 * Start (or reuse) the singleton sanitizing proxy in front of `targetUrl` (the
 * CodeMie daemon). Returns the loopback URL the node should point
 * ANTHROPIC_BASE_URL at.
 */
export async function ensureSanitizingProxy(targetUrl: string): Promise<string> {
	const normalizedTarget = targetUrl.replace(/\/$/, '');
	if (shim && shim.targetUrl === normalizedTarget && shim.server.listening) {
		return shim.url;
	}
	if (shim) {
		try {
			shim.server.close();
		} catch {
			/* ignore */
		}
		shim = undefined;
	}

	const server = createServer(normalizedTarget);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});

	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	shim = { server, url: `http://127.0.0.1:${port}`, targetUrl: normalizedTarget };
	return shim.url;
}

/** Close the singleton sanitizing proxy (used for cleanup / tests). */
export async function closeSanitizingProxy(): Promise<void> {
	if (!shim) return;
	const { server } = shim;
	shim = undefined;
	await new Promise<void>((resolve) => server.close(() => resolve()));
}
