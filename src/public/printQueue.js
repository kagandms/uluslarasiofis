/** Submit independent print jobs in order while honoring the upload rate limit. */
export async function submitPrintEntries(entries, submitEntry) {
    const outcomes = [];
    for (const entry of entries) {
        try {
            await submitEntry(entry);
            outcomes.push({ entry, status: 'sent' });
        } catch (error) {
            const status = error?.message === 'rate_limit' ? 'rate_limited'
                : error?.message === 'queue_paused' ? 'queue_paused' : 'failed';
            outcomes.push({ entry, status });
            if (status === 'rate_limited' || status === 'queue_paused') break;
        }
    }
    return outcomes;
}
