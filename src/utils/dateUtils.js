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
    
    // Evrak teslim haftasini takip eden haftanin Carsamba gunu baslangictir.
    // Pazartesi tesliminde +9, cuma tesliminde +5 gun eder.
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const daysToFollowingWednesday = 9 - daysFromMonday;
    const tebligatDate = new Date(y, m, d + daysToFollowingWednesday);
    const tdd = String(tebligatDate.getDate()).padStart(2, '0');
    const tmm = String(tebligatDate.getMonth() + 1).padStart(2, '0');
    const tyyyy = tebligatDate.getFullYear();
    
    const gunAdlari = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const gunAdi = gunAdlari[tebligatDate.getDay()];
    
    return `${tdd}.${tmm}.${tyyyy} (${gunAdi})`;
}
