/** Submit independent print jobs in order while honoring the upload rate limit. */
export async function submitPrintEntries(entries, submitEntry) {
    const outcomes = [];
    for (const entry of entries) {
        try {
            await submitEntry(entry);
            outcomes.push({ entry, status: 'sent' });
        } catch (error) {
            const status = error?.message === 'rate_limit' ? 'rate_limited' : 'failed';
            outcomes.push({ entry, status });
            if (status === 'rate_limited') break;
        }
    }
    return outcomes;
}
