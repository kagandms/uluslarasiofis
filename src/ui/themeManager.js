import { STORAGE_KEYS } from '../config/constants.js';

export function initTheme() {
    const btnDarkMode = document.getElementById('btn-dark-mode');
    const isDark = localStorage.getItem(STORAGE_KEYS.THEME) === 'dark';
    
    if (isDark) {
        document.body.classList.add('dark-mode');
    }
    
    if (btnDarkMode) {
        btnDarkMode.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
            } else {
                localStorage.setItem(STORAGE_KEYS.THEME, 'light');
            }
        });
    }
}
