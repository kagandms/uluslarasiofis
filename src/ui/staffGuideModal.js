export function openStaffGuideModal() {
    let existingModal = document.getElementById('staff-guide-modal-overlay');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'staff-guide-modal-overlay';
    overlay.className = 'staff-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Yetkili Portal Kullanım Rehberi');

    const modal = document.createElement('div');
    modal.className = 'staff-modal-card staff-guide-modal-card';
    modal.style.maxWidth = '780px';
    modal.style.width = '94%';
    modal.style.maxHeight = '88vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';

    // Header
    const header = document.createElement('div');
    header.className = 'staff-modal-header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.paddingBottom = '12px';
    header.style.borderBottom = '1px solid var(--border-color, rgba(0,0,0,0.08))';

    const titleGroup = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = '📖 Yetkili Paneli Araçları Kullanım Rehberi';
    title.style.margin = '0 0 4px 0';
    title.style.fontSize = '1.2rem';
    title.style.color = 'var(--text-primary, #1e293b)';

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Portalda yer alan tüm ofis araçlarının işlevleri ve pratik kullanım adımları.';
    subtitle.style.margin = '0';
    subtitle.style.fontSize = '0.85rem';
    subtitle.style.color = 'var(--text-secondary, #64748b)';
    titleGroup.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-outline';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Kapat');
    closeBtn.style.padding = '4px 10px';
    closeBtn.addEventListener('click', () => overlay.remove());

    header.append(titleGroup, closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.flex = '1';
    body.style.overflowY = 'auto';
    body.style.padding = '16px 0';

    const guideItems = [
        {
            icon: '📋',
            title: '1. İkamet Başvuruları',
            summary: 'Öğrenci başvuru kuyruğu, evrak inceleme ve durum yönetimi',
            details: [
                '<strong>Başvuru Listesi:</strong> Öğrencilerin sisteme gönderdiği ikamet başvurularını tarih, ad/soyad, durum ve ülke bazında filtreleyin.',
                '<strong>Evrak İnceleme:</strong> Öğrencinin yüklediği pasaport, öğrenci belgesi, sigorta ve harç dekontu gibi belgeleri tarayıcıda doğrudan önizleyin.',
                '<strong>Eksik Evrak Talebi:</strong> Hatalı veya okunamayan bir evrak varsa "Belge Güncellemesi" seçeneğiyle gerekçeli not ekleyerek öğrenciye tekrar yükleme talebi iletin.',
                '<strong>Durum İlerlemesi:</strong> İncelemesi tamamlanan dosyaları "Göç İdaresine İletildi" veya "Tamamlandı" aşamasına aktarın.'
            ]
        },
        {
            icon: '🗄️',
            title: '2. Arşiv',
            summary: 'Sonuçlanan, iptal edilen ve geçmiş başvuruların kaydı',
            details: [
                'Tamamlanmış, iptal edilmiş veya reddedilmiş dosyaların geçmiş kayıtlarına tek tıkla ulaşın.',
                'Öğrenci numarası veya pasaport numarasıyla geçmiş dönemlere ait evrakları sorgulayın.',
                'Gerek duyulduğunda dosya evraklarını toplu ZIP paketi olarak bilgisayarınıza indirin.'
            ]
        },
        {
            icon: '🎓',
            title: '3. YKN (Öğrenci Sorgulama & YÖKSİS Aktarımı)',
            summary: 'Apply Topkapı sorgusu, OCR ve YKN tarayıcı eklentisiyle otomatik YÖKSİS doldurma',
            details: [
                '<strong>Pasaport ile Arama:</strong> Pasaport numarasını girip "Ara"ya bastığınızda Apply Topkapı veritabanından öğrenci profili çekilir.',
                '<strong>Kabul Mektubu & YÖKSİS:</strong> "1. Kabul Mektubunu Oku ve YÖKSİS\'te Ara" butonuyla kabul mektubundaki YÖKSİS ID okunur ve YÖKSİS sekmesinde öğrenci açılır.',
                '<strong>Pasaport OCR & Kırpma:</strong> "2. Bilgileri Al ve Pasaport Fotoğrafını Kırp" butonuyla pasaporttaki geçerlilik tarihleri, doğum yeri, anne/baba adı otomatik okunur ve vesikalık biyometrik fotoğraf hazır hale getirilir.',
                '<strong>Otomatik Aktarım:</strong> YKN tarayıcı eklentisi sayesinde YÖKSİS formundaki tüm alanlar ve fotoğraf tek tıkla hatasız doldurulur.'
            ]
        },
        {
            icon: '📄',
            title: '4. Kapak Hazırla',
            summary: 'İkamet formu OCR taraması, otomatik veri çıkarma ve kapak PDF\'i',
            details: [
                '<strong>Fotoğraf Yükle:</strong> Öğrencinin ikamet başvuru formu fotoğraflarını (1. ve 2. sayfa) yükleyin.',
                '<strong>Otomatik OCR:</strong> Sistem Türkçe karakter desteğiyle formdaki ad, soyad, pasaport no, telefon ve adres bilgilerini otomatik okur.',
                '<strong>Önizleme & Düzenleme:</strong> Okunan alanları ekranda kontrol edip gerekiyorsa düzenleyin.',
                '<strong>Kapak PDF İndir:</strong> Göç İdaresi standartlarına uygun resmi dosya kapağını anında PDF olarak oluşturup yazdırın.'
            ]
        },
        {
            icon: '🔍',
            title: '5. Tebliğ Bul',
            summary: 'İl Göç İdaresi tebligat kayıtları ve sorgulama',
            details: [
                'Göç İdaresi tarafından üniversiteye gönderilen güncel tebliğ listelerinde öğrenci pasaportu veya ismiyle arama yapın.',
                'Öğrencinin tebligat durumunu görüntüleyin; tebliğ yapıldığında listede "Tebliğ Edildi" olarak işaretleyin.'
            ]
        },
        {
            icon: '📁',
            title: '6. Belgeler',
            summary: 'Ofis formları, kontrol listeleri ve dilekçe şablonları',
            details: [
                'Uluslararası Öğrenci Ofisi bünyesindeki tüm güncel dilekçe, taahhütname ve kontrol evraklarına hızlıca erişin ve indirin.'
            ]
        },
        {
            icon: '📸',
            title: '7. Toplu Fotoğraf / PDF Birleştirici',
            summary: '30 adede kadar fotoğrafı seri çekip tek bir A4 PDF dosyasında birleştirme',
            details: [
                '<strong>Üst Menüden Erişim:</strong> Üst barda yer alan "PDF Birleştir" butonuna tıklayarak her an açabilirsiniz.',
                '<strong>Seri Fotoğraf Çek (Kamera):</strong> Mobilde veya tablette arka arkaya 30\'a kadar fotoğraf çekebilirsiniz. Her çekimden sonra "kaydedildi" bildirimi ve ses gelir, sıradaki çekim otomatik olarak açılır.',
                '<strong>Galeriden / Dosyalardan Seç:</strong> Cihazınızdaki birden çok fotoğraf veya PDF dosyasını aynı anda seçip listeye ekleyebilirsiniz.',
                '<strong>Sıralama & Düzenleme:</strong> Listede ↑ ve ↓ butonlarıyla sayfa sırasını belirleyebilir, hatalı çekimleri silebilirsiniz.',
                '<strong>Tek PDF İndir:</strong> "Tek PDF Olarak Birleştir ve İndir" butonuna bastığınızda tüm sayfalar A4 boyutuna ölçeklenerek tek bir PDF olarak indirilir.'
            ]
        }
    ];

    guideItems.forEach(item => {
        const card = document.createElement('div');
        card.style.background = 'rgba(126, 24, 48, 0.04)';
        card.style.border = '1px solid var(--border-color, rgba(0, 0, 0, 0.08))';
        card.style.borderRadius = '10px';
        card.style.padding = '14px 16px';
        card.style.marginBottom = '12px';

        const head = document.createElement('div');
        head.style.display = 'flex';
        head.style.alignItems = 'center';
        head.style.gap = '10px';
        head.style.marginBottom = '6px';

        const iconEl = document.createElement('span');
        iconEl.style.fontSize = '1.4rem';
        iconEl.textContent = item.icon;

        const titleEl = document.createElement('h4');
        titleEl.textContent = item.title;
        titleEl.style.margin = '0';
        titleEl.style.fontSize = '1.05rem';
        titleEl.style.color = 'var(--accent, #7e1830)';

        head.append(iconEl, titleEl);

        const summaryEl = document.createElement('p');
        summaryEl.textContent = item.summary;
        summaryEl.style.margin = '0 0 10px 0';
        summaryEl.style.fontSize = '0.88rem';
        summaryEl.style.fontWeight = '500';
        summaryEl.style.color = 'var(--text-primary, #1e293b)';

        const list = document.createElement('ul');
        list.style.margin = '0';
        list.style.paddingLeft = '18px';
        list.style.fontSize = '0.85rem';
        list.style.lineHeight = '1.5';
        list.style.color = 'var(--text-secondary, #475569)';

        item.details.forEach(d => {
            const li = document.createElement('li');
            li.style.marginBottom = '4px';
            li.innerHTML = d;
            list.append(li);
        });

        card.append(head, summaryEl, list);
        body.append(card);
    });

    // Footer
    const footer = document.createElement('div');
    footer.className = 'staff-modal-footer';
    footer.style.paddingTop = '12px';
    footer.style.borderTop = '1px solid var(--border-color, rgba(0,0,0,0.08))';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';

    const closeBottomBtn = document.createElement('button');
    closeBottomBtn.type = 'button';
    closeBottomBtn.className = 'btn btn-primary';
    closeBottomBtn.textContent = 'Anladım';
    closeBottomBtn.addEventListener('click', () => overlay.remove());
    footer.append(closeBottomBtn);

    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', handleKeydown);
            overlay.remove();
        }
    };
    document.addEventListener('keydown', handleKeydown);
}
