import { spawnSync } from 'node:child_process';

const repetitions = Number(process.argv[2] || 20);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('Expected 1–100 repetitions');
for (let attempt = 1; attempt <= repetitions; attempt++) {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'test/physical-receipts-native.test.js'],
        { stdio: 'inherit', timeout: 60_000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
    if (result.error || result.status !== 0) throw new Error(`Native receipt regression failed on repetition ${attempt}`, { cause: result.error });
    console.log(`Native receipt regression ${attempt}/${repetitions} passed`);
}
