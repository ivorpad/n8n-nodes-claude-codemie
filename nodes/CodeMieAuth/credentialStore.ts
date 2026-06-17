/**
 * Persist CodeMie SSO credentials where the proxy daemon can read them.
 *
 * Primary path: the installed `@codemieai/code` CredentialStore (guaranteed
 * format match with the daemon). Fallback path: a byte-identical AES-256-GCM
 * replica, so the credential test still works in environments where the
 * package's `dist/` is unavailable. Both write to the same per-instance file,
 * keyed by `normalizeToBase(instanceUrl)` so the daemon's
 * `getStoredCredentials(targetApiUrl)` lookup resolves to the same key.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { arch, homedir, hostname, platform } from 'node:os';
import * as path from 'node:path';

import { deriveExpiresAt, ensureApiBase, normalizeToBase } from './token';

export interface SsoCredentials {
	cookies: Record<string, string>;
	apiUrl: string;
	expiresAt: number;
}

export function codemieHome(): string {
	return process.env.CODEMIE_HOME || path.join(homedir(), '.codemie');
}

/** Storage key, identical to CodeMie CredentialStore.getUrlStorageKey. */
export function getUrlStorageKey(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/$/, '').toLowerCase();
	const hash = createHash('sha256').update(normalized).digest('hex');
	return `sso-${hash}`;
}

/** Absolute path of the per-instance encrypted credential file. */
export function credentialFilePath(instanceUrl: string): string {
	const base = normalizeToBase(instanceUrl);
	return path.join(codemieHome(), 'credentials', `${getUrlStorageKey(base)}.enc`);
}

/** Machine-bound AES key, byte-identical to CodeMie security.ts. */
function aesKey(): Buffer {
	const machineId = hostname() + platform() + arch();
	const derivedHex = createHash('sha256').update(machineId).digest('hex');
	return createHash('sha256').update(derivedHex).digest();
}

/** Replicate CodeMie's AES-256-GCM `ivHex:authTagHex:encHex` encoding. */
export function encryptCredential(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', aesKey(), iv);
	let encrypted = cipher.update(plaintext, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const authTag = cipher.getAuthTag();
	return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/** Inverse of {@link encryptCredential}; used by tests and the replica round-trip. */
export function decryptCredential(text: string): string {
	const [ivHex, tagHex, encHex] = text.split(':');
	const decipher = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	let decrypted = decipher.update(encHex, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}

export function buildSsoCredentials(
	instanceUrl: string,
	cookies: Record<string, string>,
	now: number = Date.now(),
): SsoCredentials {
	return {
		cookies,
		apiUrl: ensureApiBase(instanceUrl),
		expiresAt: deriveExpiresAt(cookies, now),
	};
}

async function writeReplicatedCredential(
	instanceUrl: string,
	creds: SsoCredentials,
): Promise<void> {
	const file = credentialFilePath(instanceUrl);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, encryptCredential(JSON.stringify(creds)), { encoding: 'utf8', mode: 0o600 });
}

/** Loose shape of the bits of `@codemieai/code` security.js we call. */
interface CodeMieCredentialStoreModule {
	CredentialStore?: {
		getInstance(): {
			storeSSOCredentials(credentials: SsoCredentials, baseUrl?: string): Promise<void>;
		};
	};
}

export type EsmImporter = (specifier: string) => Promise<unknown>;

// A genuine ESM dynamic import that survives commonjs down-leveling, so Node
// loads `@codemieai/code` (ESM) via the ESM loader instead of require().
const defaultEsmImport: EsmImporter = new Function('s', 'return import(s);') as EsmImporter;

/**
 * Store SSO credentials for `instanceUrl`. The `importer` seam lets tests
 * exercise both the real-store path and the replica fallback deterministically.
 */
export async function storeSsoCredentials(
	instanceUrl: string,
	cookies: Record<string, string>,
	importer: EsmImporter = defaultEsmImport,
): Promise<void> {
	const creds = buildSsoCredentials(instanceUrl, cookies);
	const baseUrl = normalizeToBase(instanceUrl);

	try {
		const mod = (await importer('@codemieai/code/dist/utils/security.js')) as
			| CodeMieCredentialStoreModule
			| undefined;
		const store = mod?.CredentialStore?.getInstance();
		if (store) {
			await store.storeSSOCredentials(creds, baseUrl);
			return;
		}
	} catch {
		// dist path unavailable (e.g. a dev checkout without a build) — fall back.
	}

	await writeReplicatedCredential(instanceUrl, creds);
}
