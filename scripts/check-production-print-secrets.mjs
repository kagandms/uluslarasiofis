import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertProductionPrintSecrets } from './lib/production-print-config.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerPath = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const configuration = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const production = configuration.env?.production;
if (!production) throw new Error('Production environment configuration is required.');
const secretList = spawnSync(process.execPath, [wranglerPath, 'secret', 'list', '--env', 'production'], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30_000
});
if (secretList.error || secretList.status !== 0) {
    throw new Error('Production secret metadata could not be verified; deployment stopped.');
}
const bindings = JSON.parse(secretList.stdout);
if (!Array.isArray(bindings)) throw new Error('Production secret metadata format is invalid.');
assertProductionPrintSecrets(production, bindings);
