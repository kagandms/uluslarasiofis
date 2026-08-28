import sys

with open('app.js', 'r') as f:
    content = f.read()

pwa_logic = """
    // --- PWA Install Logic ---
    let deferredPrompt;
    const btnInstallPwa = document.getElementById('btn-install-pwa');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI notify the user they can install the PWA
        if (btnInstallPwa) {
            btnInstallPwa.style.display = 'inline-flex';
        }
    });

    if (btnInstallPwa) {
        btnInstallPwa.addEventListener('click', async () => {
            if (deferredPrompt) {
                // Show the install prompt
                deferredPrompt.prompt();
                // Wait for the user to respond to the prompt
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                    btnInstallPwa.style.display = 'none';
                }
                // We've used the prompt, and can't use it again, throw it away
                deferredPrompt = null;
            } else {
                // For iOS Safari fallback if they clicked it somehow, or general fallback
                showToast('Uygulamayı yüklemek için tarayıcınızın "Ana Ekrana Ekle" (Add to Home Screen) seçeneğini kullanabilirsiniz.', 'info');
            }
        });
    }

    // Acknowledge installation
    window.addEventListener('appinstalled', () => {
        if (btnInstallPwa) btnInstallPwa.style.display = 'none';
        deferredPrompt = null;
        console.log('PWA was installed');
    });
"""

if "btn-install-pwa" not in content:
    content = content.replace("// Initial setup\n    setActiveStep(1);", pwa_logic + "\n    // Initial setup\n    setActiveStep(1);")
    with open('app.js', 'w') as f:
        f.write(content)
