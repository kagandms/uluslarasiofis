import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const [mode, expectedSha] = process.argv.slice(2);
assert.ok(['create', 'verify'].includes(mode), 'Usage: candidate-artifact.mjs create|verify <full-sha>');
assert.match(expectedSha || '', /^[a-f0-9]{40}$/, 'Candidate SHA must be a full lowercase commit SHA.');
const root = resolve('dist');
const manifestPath = resolve('candidate-artifact.json');

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Artifact may not contain symbolic links.');
        if (entry.isDirectory()) files.push(...await walk(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

const files = (await walk(root)).sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
assert.ok(files.length > 0, 'Production build artifact is empty.');
const entries = [];
for (const path of files) {
    const bytes = await readFile(path);
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
