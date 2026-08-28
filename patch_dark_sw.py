import sys

with open('app.js', 'r') as f:
    content = f.read()

dark_logic = """
    // --- Dark Mode Logic ---
    const btnDarkMode = document.getElementById('btn-dark-mode');
    const isDark = localStorage.getItem('theme') === 'dark';
    
    if (isDark) {
        document.body.classList.add('dark-mode');
    }
    
    if (btnDarkMode) {
        btnDarkMode.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'dark');
            } else {
                localStorage.setItem('theme', 'light');
            }
        });
    }

    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                console.log('Service Worker registered', reg);
            }).catch(err => {
                console.warn('Service Worker registration failed', err);
            });
        });
    }
"""

content = content.replace("// Initial setup\n    setActiveStep(1);", dark_logic + "\n    // Initial setup\n    setActiveStep(1);")

with open('app.js', 'w') as f:
    f.write(content)
