/**
 * Minimal dependency-free HTTP GET used to probe the local proxy daemon
 * (`/health`) and list models (`/v1/llm_models`). All calls target the
 * loopback proxy; the proxy itself handles any upstream TLS.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

export interface HttpResponse {
	status: number;
	body: string;
}

export async function httpGet(
	url: string,
	headers: Record<string, string> = {},
	timeoutMs = 15000,
): Promise<HttpResponse> {
	const parsed = new URL(url);
	const lib = parsed.protocol === 'https:' ? https : http;

	return await new Promise<HttpResponse>((resolve, reject) => {
		const options: https.RequestOptions = {
			method: 'GET',
			headers: { Accept: 'application/json', ...headers },
			// Enterprise CodeMie deployments commonly use self-signed certs. Our
			// calls hit the loopback proxy (http), but stay lenient for https.
			...(parsed.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
		};

		const req = lib.request(url, options, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
			res.on('end', () =>
				resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
			);
		});

		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request to ${parsed.host} timed out after ${timeoutMs}ms.`));
		});
		req.end();
	});
}
