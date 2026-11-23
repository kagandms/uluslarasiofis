/**
 * Creates an in-memory fake Workers AI binding that records call count and arguments without network calls.
 * @param {Array<object|Error|Function>|object|Function} [script] Queued replies, a static reply, or a handler `(model, input, options) => response`.
 * @returns {{calls: Array<{model: string, input: object, options: object}>, callCount: number, reset: () => void, run: (model: string, input: object, options?: object) => Promise<object>}} Fake AI binding.
 */
export function createFakeAiBinding(script = { response: 'Merhaba.' }) {
    const calls = [];
    let index = 0;

    async function resolveStep(model, input, options) {
        let step;
        if (Array.isArray(script)) {
            if (index >= script.length) {
                throw new Error(`Fake AI binding received unexpected call #${index + 1}.`);
            }
            step = script[index];
            index += 1;
        } else {
            step = script;
        }

        if (typeof step === 'function') {
            return step(model, input, options);
        }
        if (step instanceof Error) {
            throw step;
        }
        return structuredClone(step);
    }

    return {
        calls,
        get callCount() {
            return calls.length;
        },
        reset() {
            calls.length = 0;
            index = 0;
        },
        async run(model, input, options = {}) {
            calls.push({
                model,
                input: structuredClone(input),
                options: { ...options }
            });
            if (options?.signal?.aborted) {
                throw options.signal.reason || new DOMException('Aborted', 'AbortError');
            }
            return resolveStep(model, input, options);
        }
    };
}
