import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../http', () => ({ httpGet: vi.fn() }));

import { httpGet } from '../http';
import { fetchCodeMieModels, parseCodeMieModels } from '../models';

const mockedHttpGet = httpGet as unknown as ReturnType<typeof vi.fn>;

describe('parseCodeMieModels', () => {
	it('prefers id > base_name > deployment_name > label, dedups and sorts', () => {
		expect(
			parseCodeMieModels([
				{ base_name: 'b' },
				{ id: 'a' },
				{ id: 'a' },
				{ deployment_name: 'd' },
				{ label: 'l' },
				{},
				null,
			]),
		).toEqual([
			{ id: 'a', label: 'a' },
			{ id: 'b', label: 'b' },
			{ id: 'd', label: 'd' },
			{ id: 'l', label: 'l' },
		]);
	});

	it('reads a { data: [...] } envelope', () => {
		expect(parseCodeMieModels({ data: [{ id: 'm', label: 'M' }] })).toEqual([
			{ id: 'm', label: 'M' },
		]);
	});

	it('returns [] for non-array payloads', () => {
		expect(parseCodeMieModels(null)).toEqual([]);
		expect(parseCodeMieModels({})).toEqual([]);
	});
});

describe('fetchCodeMieModels', () => {
	const proxy = { url: 'http://127.0.0.1:4001', gatewayKey: 'codemie-proxy' };

	beforeEach(() => mockedHttpGet.mockReset());

	it('GETs /v1/llm_models with the gateway bearer and parses the result', async () => {
		mockedHttpGet.mockResolvedValue({
			status: 200,
			body: JSON.stringify([{ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet' }]),
		});

		await expect(fetchCodeMieModels(proxy)).resolves.toEqual([
			{ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet' },
		]);
		expect(mockedHttpGet).toHaveBeenCalledWith(
			'http://127.0.0.1:4001/v1/llm_models?include_all=true',
			{ Authorization: 'Bearer codemie-proxy' },
		);
	});

	it('throws a re-authenticate error on 401', async () => {
		mockedHttpGet.mockResolvedValue({ status: 401, body: '' });
		await expect(fetchCodeMieModels(proxy)).rejects.toThrow(/re-authenticate|expired|401/i);
	});

	it('throws on non-2xx', async () => {
		mockedHttpGet.mockResolvedValue({ status: 502, body: '' });
		await expect(fetchCodeMieModels(proxy)).rejects.toThrow(/HTTP 502/);
	});
});
