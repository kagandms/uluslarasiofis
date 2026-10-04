import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const viteCliPath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const build = spawnSync(process.execPath, [viteCliPath, 'build'], {
    cwd: projectRoot,
    env: { ...process.env, CLOUDFLARE_ENV: 'production' },
    stdio: 'inherit'
});

if (build.error) throw build.error;
process.exitCode = build.status ?? 1;
