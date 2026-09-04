export function calculateTebligatDate(dateStr) {
    if (!dateStr) return '';
    const normalizedDate = dateStr.replace(/[\/\-\s]/g, '.');
    const parts = normalizedDate.split('.');
    if (parts.length !== 3) return '';
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1; 
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return '';
    
    const date = new Date(y, m, d);
    const dayOfWeek = date.getDay();
    
    let daysToThisFriday = (5 - dayOfWeek + 7) % 7;
    const daysToNextFriday = daysToThisFriday + 7;
    
    const tebligatDate = new Date(y, m, d + daysToNextFriday);
    const tdd = String(tebligatDate.getDate()).padStart(2, '0');
    const tmm = String(tebligatDate.getMonth() + 1).padStart(2, '0');
    const tyyyy = tebligatDate.getFullYear();
    
    const gunAdlari = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const gunAdi = gunAdlari[tebligatDate.getDay()];
    
    return `${tdd}.${tmm}.${tyyyy} (${gunAdi})`;
}
