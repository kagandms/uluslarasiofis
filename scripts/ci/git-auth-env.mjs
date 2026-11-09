/**
 * Git environment that authenticates one read-only fetch with the job's token for a private repository.
 * The token is never written to disk or git config files; it only travels in the child process environment.
 * @param {NodeJS.ProcessEnv} [env] Process environment containing GITHUB_TOKEN.
 * @returns {Record<string, string>} Extra environment variables, or an empty object without a token.
 */
export function gitAuthEnv(env = process.env) {
    const token = env.GITHUB_TOKEN;
    if (typeof token !== 'string' || token.length === 0) return {};
    const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
    return {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`
    };
}
