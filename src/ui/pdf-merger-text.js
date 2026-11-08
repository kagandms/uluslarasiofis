/** Default (Turkish, staff) texts for the PDF page composer. Callers may pass `text` overrides per locale. */
export const PDF_MERGER_DEFAULT_TEXT = Object.freeze({
    title: 'Belge sayfaları ekle',
    busy: 'PDF işlemi devam ediyor. Tamamlanmasını bekleyin.',
    subtitle: 'Fotoğraf çekin ya da galeriden dosya seçin. Sayfalar tek PDF dosyasında birleştirilir (en fazla {max}).',
    camera: 'Fotoğraf çek',
    fileSelect: 'Galeri veya dosya seç',
    seriesModeLabel: 'Seri Çekim Modu:',
    seriesMode: 'Fotoğraf kaydedildi. Bir sonraki fotoğraf için aşağıdaki Kamera butonuna tıklayın.',
    seriesActiveLabel: 'Seri Çekim Aktif:',
    seriesActive: 'Fotoğrafı çekin; sıradaki çekim için Kamera butonuna tekrar basın.',
    seriesPausedLabel: 'Seri Çekim Duraklatıldı:',
    seriesPaused: '{n} fotoğraf eklendi. Devam etmek için butona basın.',
    nextShot: '📸 Sonraki Fotoğrafı Çek',
    stopCapture: '✅ Çekimi Tamamla',
    maxReached: 'Maksimum {max} belge sınırına ulaşıldı.',
    captureDone: 'Seri çekim tamamlandı. Belgelerinizi inceleyip PDF oluşturabilirsiniz.',
    photoSaved: '📸 {n}. fotoğraf kaydedildi! ({n} / {max})',
    photoProgress: '{n}/{max} fotoğraf kaydedildi. Sıradaki çekim için Kamera tuşuna basın.',
    photoLimit: '{max} fotoğraf sınırına ulaşıldı. PDF birleştirmeye hazırsınız.',
    clearAll: 'Tümünü Temizle',
    listHint: 'Eklenen sayfaları önizleyip sıralayabilirsiniz.',
    merge: 'PDF oluştur ve boyutu göster',
    previewLink: 'PDF’i aç ve yakınlaştırarak kontrol et',
    tooLarge: 'PDF 9 MiB güvenli sınırının altında değil. Sayfa sayısını azaltıp yeniden oluşturun.',
    saving: 'PDF öğrenci kaydına kaydediliyor…',
    saved: 'PDF öğrenci kaydına kaydedildi.',
    merging: 'Belgeler sırayla birleştiriliyor ve 9 MiB sınırı kontrol ediliyor…',
    targetReached: 'YÖKSİS’in 10 MB sınırının altında.',
    compressionUsed: ' Kullanılan sıkıştırma kademesi: %{p}.',
    compressionNone: ' PDF sayfaları yeniden sıkıştırılmadan korundu.',
    rasterNotice: ' PDF sayfaları görüntüye çevrildi; seçilebilir metin ve form alanları korunmaz.',
    checkReadable: 'Açıp okunabilirliği kontrol edin.',
    confirmSave: 'Kontrol ettim, öğrenci kaydına ekle',
    confirmDownload: 'Kontrol ettim, PDF’i indir',
    mustBeSmall: 'PDF 9 MiB altında olmalı.',
    mergeFailed: 'PDF birleştirme başarısız: {error}',
    error: 'Hata oluştu.',
    photo: 'Fotoğraf',
    thumbAlt: '{label} küçük önizlemesi',
    thumbFailed: 'Küçük önizleme hazırlanamadı; belgeyi açmak için tıklayın.',
    openPreview: '{label} önizlemesini aç',
    moveUp: '{label} yukarı taşı',
    moveDown: '{label} aşağı taşı',
    remove: '{label} sil',
    drag: '{label} sürükleyerek sırala',
    empty: 'Henüz hiçbir belge eklenmedi. Fotoğraf çekebilir veya dosya seçebilirsiniz.',
    position: '{n}. sırada {label}',
    fromPhone: 'Telefondan',
    closePreview: 'Önizlemeyi kapat',
    previewOf: '{label} önizlemesi'
});

/** Merges caller overrides onto the defaults. */
export function resolvePdfMergerText(overrides) {
    return { ...PDF_MERGER_DEFAULT_TEXT, ...(overrides || {}) };
}

/** Replaces `{name}` placeholders. */
export function formatPdfMergerText(template, values = {}) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}
