export const STEP_IDS = {
    UPLOAD: 1,
    PAGE2_UPLOAD: 1.5,
    BATCH_QUEUE: 1.8,
    OCR_PROGRESS: 2,
    FORM_RESULT: 3
};

let currentStep = STEP_IDS.UPLOAD;

export function setActiveStep(stepNumber) {
    currentStep = stepNumber;
    
    const step1 = document.getElementById('step-1');
    const stepPage2 = document.getElementById('step-page2');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const stepBatchQueue = document.getElementById('step-batch-queue');
    
    [step1, stepPage2, stepBatchQueue, step2, step3].forEach((section) => {
        if(section) {
            section.classList.remove('active');
            section.classList.add('hidden');
        }
    });

    if (stepNumber === STEP_IDS.UPLOAD && step1) { step1.classList.remove('hidden'); step1.classList.add('active'); }
    else if (stepNumber === STEP_IDS.PAGE2_UPLOAD && stepPage2) { stepPage2.classList.remove('hidden'); stepPage2.classList.add('active'); }
    else if (stepNumber === STEP_IDS.BATCH_QUEUE && stepBatchQueue) { stepBatchQueue.classList.remove('hidden'); stepBatchQueue.classList.add('active'); }
    else if (stepNumber === STEP_IDS.OCR_PROGRESS && step2) { step2.classList.remove('hidden'); step2.classList.add('active'); }
    else if (stepNumber === STEP_IDS.FORM_RESULT && step3) { step3.classList.remove('hidden'); step3.classList.add('active'); }

    // Update indicators
    [1, 2, 3].forEach(num => {
        const ind = document.getElementById(`indicator-${num}`);
        if (!ind) return;
        ind.classList.remove('active', 'completed');
        
        let logicalStep = stepNumber;
        if (stepNumber === STEP_IDS.PAGE2_UPLOAD || stepNumber === STEP_IDS.BATCH_QUEUE) logicalStep = 1; // page2 upload is still step 1 visually
        
        if (num === logicalStep) ind.classList.add('active');
        else if (num < logicalStep) ind.classList.add('completed');
    });
}

export function getCurrentStep() {
    return currentStep;
}
