// Copy non-TS assets (icons) into dist after tsc, since tsc does not emit them.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [['nodes/CodeMieAuth/codemie.svg', 'dist/nodes/CodeMieAuth/codemie.svg']];

for (const [src, dest] of assets) {
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest);
	console.log(`copied ${src} -> ${dest}`);
}
