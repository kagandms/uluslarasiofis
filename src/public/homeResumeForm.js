/**
 * Binds the homepage's existing-application access form to the owner-session API.
 * @param {{root?: Document, api: {accessApplicationWithReference: Function}, navigate?: (path: string) => void, getMessage: (key: string) => string}} options Page document and application API.
 * @returns {void} Handles owner access when the form is present.
 */
export function initHomeResumeForm({ root = document, api, navigate, getMessage }) {
    const form = root.getElementById('resume-application-form');
    if (!form) return;
    const referenceInput = form.elements.namedItem('resume_reference_number');
    const studentNumberInput = form.elements.namedItem('resume_student_number');
    const submitButton = form.querySelector('[type="submit"]');
    const feedback = form.querySelector('.resume-feedback');
    const panel = form.closest('.application-resume-card');
    const openButton = root.getElementById('btn-home-resume');
    const goTo = navigate || ((path) => root.defaultView.location.assign(path));

    if (panel && openButton) {
        openButton.addEventListener('click', () => {
            const isOpening = panel.hidden;
            panel.hidden = !isOpening;
            openButton.setAttribute('aria-expanded', String(isOpening));
            if (isOpening) referenceInput.focus();
        });
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const referenceNumber = referenceInput.value.trim();
        const studentNumber = studentNumberInput.value.trim();
        if (!referenceNumber || !studentNumber) return;
        submitButton.disabled = true;
        feedback.textContent = '';
        try {
            const application = await api.accessApplicationWithReference({
                reference_number: referenceNumber,
                student_number: studentNumber
            });
            goTo(application.status === 'draft' ? '/basvuru/' : '/basvurum/');
        } catch (error) {
            submitButton.disabled = false;
            if (error?.status === 429 || error?.code === 'RATE_LIMITED') {
                feedback.textContent = getMessage('trackingLookupRateLimited');
            } else if (error?.status === 401 || error?.status === 404 || error?.code === 'INVALID_ACCESS_CREDENTIALS') {
                feedback.textContent = getMessage('accessInvalidCredentials');
            } else {
                feedback.textContent = getMessage('applicationLoadFailed');
            }
        }
    });
}
