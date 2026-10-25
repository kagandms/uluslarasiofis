export function getScheduledWork(scheduledTime) {
    const date = scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Scheduled event time is invalid.');

    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const day = date.getUTCDate();
    const shouldRunDailyMaintenance = hour === 0 && minute === 0;
    const shouldSweepReceiptOrphans = day === 1 && hour === 1 && minute === 0;
    return {
        shouldRunScannerMaintenance: minute % 5 === 0,
        shouldRunPrintCleanup: minute % 15 === 0,
        shouldRunDailyMaintenance,
        shouldRunReceiptCleanup: shouldRunDailyMaintenance || shouldSweepReceiptOrphans,
        shouldSweepReceiptOrphans
    };
}
