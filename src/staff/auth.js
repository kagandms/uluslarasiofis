const LOGIN_ERROR_MESSAGES = Object.freeze({
    400: 'Şifre alanı zorunludur.',
    401: 'Şifre hatalı. Bilgilerinizi kontrol edip tekrar deneyin.',
    500: 'Giriş şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.'
});

async function requestSession() {
    const response = await fetch('/api/session', {
        credentials: 'same-origin',
        cache: 'no-store'
    });
    return readStaffSessionState(response);
}

/**
 * Reads the authenticated state returned by the staff session API.
 * @param {Response} response The response from `/api/session`.
 * @returns {Promise<'authenticated' | 'unauthenticated' | 'error'>} The validated session state.
 */
export async function readStaffSessionState(response) {
    if (response.status === 401) return 'unauthenticated';
    if (!response.ok) return 'error';

    try {
        const payload = await response.json();
        return payload?.authenticated === true ? 'authenticated' : 'error';
    } catch {
        return 'error';
    }
}

function setAlert(alertElement, message) {
    if (!alertElement) return;
    alertElement.textContent = message;
    alertElement.hidden = !message;
}

/**
 * Verifies the server session and installs staff login and logout controls.
 * @returns {Promise<boolean>} Resolves when the staff application may initialize.
 */
export async function initStaffAuth() {
    const loginOverlay = document.getElementById('login-overlay');
    const appContent = document.getElementById('app-content');
    const loginForm = document.getElementById('login-form');
    const passwordInput = document.getElementById('login-password');
    const rememberCheckbox = document.getElementById('login-remember');
    const loginButton = document.getElementById('btn-login-submit');
    const loginError = document.getElementById('login-error');
    const logoutButton = document.getElementById('btn-staff-logout');
    const globalError = document.getElementById('staff-global-error');
    let resolveAuthorization;
    const authorization = new Promise((resolve) => {
        resolveAuthorization = resolve;
    });

    const setAuthorized = (isAuthorized) => {
        if (appContent) appContent.hidden = !isAuthorized;
        if (loginOverlay) {
            loginOverlay.hidden = isAuthorized;
            loginOverlay.style.display = isAuthorized ? 'none' : 'flex';
        }
        if (isAuthorized) {
            setAlert(loginError, '');
            setAlert(globalError, '');
            resolveAuthorization(true);
        }
    };

    const verifySession = async () => {
        try {
            const sessionState = await requestSession();
            if (sessionState === 'authenticated') {
                setAuthorized(true);
                return;
            }
            setAuthorized(false);
            if (sessionState === 'error') {
                setAlert(loginError, 'Oturum doğrulanamadı. Bağlantınızı kontrol edip yeniden deneyin.');
            }
        } catch {
            setAuthorized(false);
            setAlert(loginError, 'Oturum doğrulanamadı. Bağlantınızı kontrol edip yeniden deneyin.');
        }
    };

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!loginButton || !passwordInput) return;

        const originalContent = loginButton.innerHTML;
        loginButton.disabled = true;
        loginButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Bekleyiniz...';
        setAlert(loginError, '');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: passwordInput.value,
                    rememberMe: rememberCheckbox?.checked === true
                })
            });
            let result;
            try {
                result = await response.json();
            } catch {
                result = null;
            }

            if (!response.ok || result?.success !== true) {
                setAlert(loginError, LOGIN_ERROR_MESSAGES[response.status] || 'Giriş tamamlanamadı. Lütfen tekrar deneyin.');
                return;
            }

            const sessionState = await requestSession();
            if (sessionState !== 'authenticated') {
                setAlert(loginError, 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.');
                return;
            }
            passwordInput.value = '';
            setAuthorized(true);
        } catch {
            setAlert(loginError, 'Giriş tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.');
        } finally {
            loginButton.innerHTML = originalContent;
            loginButton.disabled = false;
        }
    });

    logoutButton?.addEventListener('click', async () => {
        logoutButton.disabled = true;
        setAlert(globalError, '');
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'same-origin'
            });
            if (!response.ok) {
                setAlert(globalError, 'Çıkış yapılamadı. Lütfen tekrar deneyin.');
                return;
            }
            window.location.assign('/');
        } catch {
            setAlert(globalError, 'Çıkış yapılamadı. Bağlantınızı kontrol edip tekrar deneyin.');
        } finally {
            logoutButton.disabled = false;
        }
    });

    await verifySession();
    return authorization;
}
