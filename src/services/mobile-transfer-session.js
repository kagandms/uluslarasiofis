import { requestMobileTransfer } from './mobile-transfer-client.js';

/** Creates a page-lifetime coordinator for a paired phone and one active student batch. */
export function createMobileTransferSession() {
    let transfer = null;
    let batchId = null;
    let isPhonePaired = false;

    async function ensureTransfer() {
        if (transfer?.expiresAt * 1000 > Date.now()) return transfer;
        transfer = await requestMobileTransfer('/api/staff/mobile-transfers', { method: 'POST' });
        batchId = null;
        isPhonePaired = false;
        return transfer;
    }

    async function activateBatch(options = {}) {
        const activeTransfer = await ensureTransfer();
        const result = await requestMobileTransfer(`/api/staff/mobile-transfers/${activeTransfer.id}/batches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discardPending: options.discardPending === true })
        });
        batchId = result.batchId;
        return { transfer: activeTransfer, batchId };
    }

    async function readPhotos(options = {}) {
        if (!transfer) return { batchId: null, files: [], phonePaired: false };
        const result = await requestMobileTransfer(`/api/staff/mobile-transfers/${transfer.id}`, options);
        isPhonePaired = result.phonePaired === true;
        if (result.batchId !== batchId) return { batchId: result.batchId, files: [], phonePaired: isPhonePaired };
        return { ...result, phonePaired: isPhonePaired };
    }

    async function consumePhoto(transferId, photoBatchId, photoId) {
        if (transfer?.id !== transferId || batchId !== photoBatchId) throw new Error('Öğrenci aktarım partisi değişti.');
        await requestMobileTransfer(`/api/staff/mobile-transfers/${transferId}/files/${photoId}`, { method: 'DELETE' });
    }

    async function closeBatch(batchToClose) {
        const currentTransfer = transfer;
        const currentBatchId = batchToClose;
        if (!currentTransfer || !currentBatchId) return;
        await requestMobileTransfer(`/api/staff/mobile-transfers/${currentTransfer.id}/batches/${currentBatchId}/close`, {
            method: 'POST'
        });
        if (batchId === currentBatchId) batchId = null;
    }

    async function closeTransfer() {
        const currentTransfer = transfer;
        if (!currentTransfer) return;
        try {
            await requestMobileTransfer(`/api/staff/mobile-transfers/${currentTransfer.id}`, { method: 'DELETE' });
        } catch (error) {
            // A lost close response can be retried after the server has already expired the transfer.
            if (error.code !== 'TRANSFER_EXPIRED') throw error;
        }
        if (transfer?.id !== currentTransfer.id) return;
        transfer = null;
        batchId = null;
        isPhonePaired = false;
    }

    function getSnapshot() {
        return { transfer, batchId, isPhonePaired };
    }

    return { activateBatch, closeBatch, closeTransfer, consumePhoto, getSnapshot, readPhotos };
}

export const mobileTransferSession = createMobileTransferSession();
