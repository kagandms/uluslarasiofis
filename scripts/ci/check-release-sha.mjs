import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const sha = process.env.RELEASE_SHA;
assert.equal(process.env.GITHUB_REPOSITORY, 'kagandms/uluslarasiofis');
assert.equal(process.env.GITHUB_REF, 'refs/heads/production', 'Dispatch must use the reviewed production workflow');
assert.match(sha || '', /^[a-f0-9]{40}$/, 'A full lowercase commit SHA is required');
assert.equal(process.env.GITHUB_SHA, sha, 'Dispatch workflow revision differs from approved SHA');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), sha, 'Checkout differs from approved SHA');
assert.equal(git('rev-parse', 'refs/remotes/origin/production'), sha, 'Release SHA must equal fetched production head');
console.log(`Release candidate verified: ${sha}`);
