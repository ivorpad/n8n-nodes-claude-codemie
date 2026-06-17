/**
 * List models from the CodeMie proxy. `GET {proxy}/v1/llm_models?include_all=true`
 * is forwarded upstream by the proxy with the SSO cookies injected; we pass the
 * gateway key as the bearer token. Model id selection mirrors the CodeMie CLI:
 * `id || base_name || deployment_name || label`.
 */

import { httpGet } from './http';
import type { ProxyHandle } from './proxy';

export interface CodeMieModelOption {
	id: string;
	label: string;
}

interface RawModel {
	id?: string;
	base_name?: string;
	deployment_name?: string;
	label?: string;
	enabled?: boolean;
}

function modelId(model: RawModel): string {
	return (model.id || model.base_name || model.deployment_name || model.label || '').trim();
}

export function parseCodeMieModels(payload: unknown): CodeMieModelOption[] {
	const list: unknown[] = Array.isArray(payload)
		? payload
		: Array.isArray((payload as { data?: unknown })?.data)
			? (payload as { data: unknown[] }).data
			: [];

	const seen = new Set<string>();
	const options: CodeMieModelOption[] = [];
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue;
		const model = raw as RawModel;
		const id = modelId(model);
		if (!id || id === 'unknown' || seen.has(id)) continue;
		seen.add(id);
		options.push({ id, label: (model.label || id).trim() });
	}
	options.sort((a, b) => a.id.localeCompare(b.id));
	return options;
}

export async function fetchCodeMieModels(proxy: ProxyHandle): Promise<CodeMieModelOption[]> {
	const url = `${proxy.url.replace(/\/$/, '')}/v1/llm_models?include_all=true`;
	const res = await httpGet(url, { Authorization: `Bearer ${proxy.gatewayKey}` });

	if (res.status === 401 || res.status === 403) {
		throw new Error(
			'CodeMie session expired or invalid (401). Re-authenticate the CodeMie SSO credential.',
		);
	}
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`Failed to list CodeMie models: HTTP ${res.status}.`);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(res.body);
	} catch {
		throw new Error('CodeMie model list response was not valid JSON.');
	}
	return parseCodeMieModels(payload);
}
