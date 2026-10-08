import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { createPrintStorage } from '../storage/printStorage.js';

export async function runPrintCleanup(environment, now = new Date().toISOString()) {
    const repository = createPrintRepository(environment.DB);
    const storage = createPrintStorage(environment.PRINT_FILES);
    const pending = await repository.reconcile(now);
    for (const job of pending) {
        try {
            await storage.delete(job.storage_key);
            await repository.markObjectDeleted({ id: job.id, now });
        } catch (error) {
            console.error('[Print cleanup] Object deletion failed.', {
                jobId: job.id,
                errorName: error?.name || 'UnknownError'
            });
            await repository.incrementCleanupAttempt({ id: job.id, now });
        }
    }
    await repository.purgeOldRows(now);
}
