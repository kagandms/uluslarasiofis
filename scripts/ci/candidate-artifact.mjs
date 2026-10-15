import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const [mode, expectedSha, artifactRootArg] = process.argv.slice(2);
assert.ok(['create', 'verify'].includes(mode), 'Usage: candidate-artifact.mjs create|verify <full-sha> [artifact-root]');
assert.match(expectedSha || '', /^[a-f0-9]{40}$/, 'Candidate SHA must be a full lowercase commit SHA.');
assert.ok(mode === 'verify' || !artifactRootArg, 'Artifact root is supported only for verification.');
const artifactRoot = resolve(artifactRootArg || '.');
const root = resolve(artifactRoot, 'dist');
const manifestPath = resolve(artifactRoot, 'candidate-artifact.json');

const allowedHiddenPaths = new Set([
    'client/.assetsignore',
    'uluslarasiofis_local/.vite/manifest.json'
]);
const allowedHiddenDirectories = new Set(['uluslarasiofis_local/.vite']);
const sensitiveName = /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:sqlite(?:3)?(?:-(?:wal|shm))?|db3?(?:-(?:wal|shm))?|sql|pem|key|p8|p12|pfx|crt|cer|der|jks|kdbx|bak|dump))$/i;

if (mode === 'verify' && artifactRootArg) {
    const rootEntries = await readdir(artifactRoot, { withFileTypes: true });
    assert.deepEqual(rootEntries.map(entry => entry.name).sort(), [
        'candidate-artifact.json', 'candidate-config.sha256', 'candidate-sha.txt', 'dist'
    ], 'Downloaded artifact contains unexpected or missing top-level files.');
    assert.ok(rootEntries.every(entry => !entry.isSymbolicLink()), 'Downloaded artifact may not contain symbolic links.');
    assert.ok(rootEntries.find(entry => entry.name === 'dist').isDirectory(), 'Downloaded artifact dist entry must be a directory.');
}

function assertSafePath(path, isDirectory) {
    const artifactPath = relative(root, path).split('\\').join('/');
    const pathParts = artifactPath.split('/');
    for (const part of pathParts) {
        assert.ok(!sensitiveName.test(part), `Sensitive or local-only file is forbidden in candidate artifact: ${artifactPath}`);
    }
    const hiddenParts = pathParts.filter(part => part.startsWith('.'));
    if (hiddenParts.length === 0) return;
    const permitted = (isDirectory && allowedHiddenDirectories.has(artifactPath))
        || (!isDirectory && allowedHiddenPaths.has(artifactPath));
    assert.ok(permitted, `Unexpected hidden path is forbidden in candidate artifact: ${artifactPath}`);
}

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Artifact may not contain symbolic links.');
        if (entry.isDirectory()) {
            assertSafePath(path, true);
            files.push(...await walk(path));
        } else if (entry.isFile()) {
            assertSafePath(path, false);
            files.push(path);
        }
    }
    return files;
}

const files = (await walk(root)).sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
assert.ok(files.length > 0, 'Production build artifact is empty.');
const entries = [];
for (const path of files) {
    const bytes = await readFile(path);
    assert.ok(!/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(bytes.toString('ascii')), `Private key material is forbidden in candidate artifact: ${relative(root, path)}`);
    entries.push({ path: relative(root, path).split('\\').join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = { schema: 1, commit_sha: expectedSha, files: entries };
if (mode === 'create') {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(`Candidate artifact manifest created for ${expectedSha} (${entries.length} files).`);
} else {
    const approved = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(approved, manifest, 'Downloaded artifact does not match the exact tested candidate manifest.');
    console.log(`Candidate artifact verified for ${expectedSha} (${entries.length} files).`);
}
