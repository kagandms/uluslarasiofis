import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OFFICE_DOCUMENTS, DOCUMENT_CATEGORIES } from '../src/config/documentsConfig.js';

test('Belgeler yapılandırması eksiksiz ve geçerlidir', () => {
    assert.ok(Array.isArray(DOCUMENT_CATEGORIES), 'DOCUMENT_CATEGORIES bir dizi olmalıdır');
    assert.ok(DOCUMENT_CATEGORIES.length >= 2, 'En az 2 kategori olmalıdır');
    assert.ok(DOCUMENT_CATEGORIES.some(c => c.id === 'all'), 'all kategorisi bulunmalıdır');

    assert.ok(Array.isArray(OFFICE_DOCUMENTS), 'OFFICE_DOCUMENTS bir dizi olmalıdır');
    assert.equal(OFFICE_DOCUMENTS.length, 6, 'Tam 6 adet belge tanımlanmış olmalıdır');

    const expectedTitles = [
        'Başvuru Formu',
        'İkamet/Kimlik Başvurusu İçin Gerekli Evraklar',
        'Taahhütname',
        'Yüksek Lisans/Doktora Checklist',
        'Kayıt Silme Formu',
        'Taksit Dilekçesi'
    ];

    const actualTitles = OFFICE_DOCUMENTS.map(d => d.title);
    assert.deepEqual(actualTitles, expectedTitles, 'Belge başlıkları ve sıralaması talep edilen sırada olmalıdır');

    const validCategoryIds = new Set(DOCUMENT_CATEGORIES.map(c => c.id));

    for (const doc of OFFICE_DOCUMENTS) {
        assert.ok(doc.id, 'Belge id alanı zorunludur');
        assert.ok(doc.title, 'Belge title alanı zorunludur');
        assert.ok(doc.category, 'Belge category alanı zorunludur');
        assert.ok(validCategoryIds.has(doc.category), `Belge kategorisi geçerli bir kategori olmalıdır: ${doc.category}`);
        assert.ok(doc.fileName, 'Belge fileName alanı zorunludur');
        assert.ok(doc.fileUrl, 'Belge fileUrl alanı zorunludur');
        assert.equal(doc.description, '', 'Açıklamalar kaldırılmış olmalıdır');

        // Dosyanın public/documents altında var olduğunu kontrol et
        const filePath = path.join(process.cwd(), 'public', 'documents', doc.fileName);
        assert.ok(fs.existsSync(filePath), `Belge dosyası diskte bulunamadı: ${filePath}`);
    }
});

test('index.html içerisinde Belgeler alanı ve navigasyon eksiksizdir', () => {
    const htmlPath = path.join(process.cwd(), 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Ana sayfa butonu
    assert.match(html, /data-workspace-view="documents"[^>]*aria-controls="view-documents"/, 'Ana sayfada Belgeler butonu olmalıdır');
    assert.match(html, /<strong>Belgeler<\/strong>/, 'Ana sayfadaki butonda Belgeler başlığı olmalıdır');

    // Çalışma alanı sekme çubuğu butonu
    assert.match(html, /<button type="button" data-workspace-view="documents"[^>]*>Belgeler<\/button>/, 'Sekme çubuğunda Belgeler butonu bulunmalıdır');

    // Panel
    assert.match(html, /<section id="view-documents" class="view-panel" hidden aria-labelledby="documents-title">/, 'view-documents paneli tanımlı olmalıdır');
    assert.match(html, /id="documents-search-input"/, 'Arama inputu bulunmalıdır');
    assert.match(html, /id="documents-categories"/, 'Kategori kapsayıcısı bulunmalıdır');
    assert.match(html, /id="documents-grid"/, 'Belgeler grid kapsayıcısı bulunmalıdır');
});
