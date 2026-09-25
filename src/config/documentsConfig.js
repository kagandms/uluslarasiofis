/**
 * Uluslararası Öğrenci Ofisi - Sık Kullanılan Belgeler Yapılandırması
 */

export const DOCUMENT_CATEGORIES = [
    { id: 'all', label: 'Tümü' },
    { id: 'basvuru-kayit', label: 'Başvuru & Kayıt' },
    { id: 'dilekce', label: 'Dilekçeler' },
    { id: 'taahhutname', label: 'Taahhütnameler' }
];

export const OFFICE_DOCUMENTS = [
    {
        id: 'ogrenci-basvuru-formu',
        title: 'Uluslararası Öğrenci Başvuru Formu',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: 'Uluslararası öğrenci kayıt, kimlik bilgileri, bölüm tercihi ve ikametgah adresi bildirim başvuru formu.',
        fileName: 'uluslararasi_ogrenci_basvuru_formu.pdf',
        fileUrl: '/documents/uluslararasi_ogrenci_basvuru_formu.pdf',
        tags: ['başvuru', 'application form', 'kayıt', 'öğrenci bilgileri', 'adres', 'ikamet'],
        badge: 'PDF • Form'
    },
    {
        id: 'ikamet-kimlik-evrak-listesi',
        title: 'İkamet / Kimlik Başvurusu İçin Verilmesi Gereken Evraklar',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: 'Göç İdaresi Başkanlığı ve üniversiteye teslim edilecek e-ikamet başvuru formu, pasaport, sigorta, UETS, öğrenci belgesi, harç ve adres belgelerini içeren evrak kontrol listesi.',
        fileName: 'ikamet_kimlik_basvurusu_icin_verilmesi_gereken_evraklar.pdf',
        fileUrl: '/documents/ikamet_kimlik_basvurusu_icin_verilmesi_gereken_evraklar.pdf',
        tags: ['ikamet', 'kimlik', 'göç idaresi', 'başvuru', 'evrak listesi', 'uets', 'öğrenci belgesi', 'kira sözleşmesi', 'kart bedeli', 'sigorta', 'parmak izi', 'checklist'],
        badge: 'PDF • Liste'
    },
    {
        id: 'eksik-evrak-taahhutnamesi',
        title: 'Şartlı Kayıt Eksik Evrak Taahhütnamesi',
        category: 'taahhutname',
        categoryLabel: 'Taahhütnameler',
        description: 'Kayıt esnasında eksik bulunan lise diploması, denklik veya tercümelerin teslim edileceğini taahhüt eden çift dilli (TR/EN) form.',
        fileName: 'sartli_kayit_eksik_evrak_taahhutnamesi.pdf',
        fileUrl: '/documents/sartli_kayit_eksik_evrak_taahhutnamesi.pdf',
        tags: ['taahhütname', 'eksik evrak', 'şartlı kayıt', 'denklik', 'diploma', 'undertaking', 'kayıt'],
        badge: 'PDF • TR/EN'
    },
    {
        id: 'lisansustu-evrak-kontrol',
        title: 'Yüksek Lisans / Doktora Evrak Kontrol Listesi',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: 'Yabancı uyruklu yüksek lisans ve doktora öğrenci dosyalarında bulunması zorunlu evrak ve sertifikaların kontrol listesi.',
        fileName: 'yuksek_lisans_doktora_ogrenci_evrak_kontrol_listesi.pdf',
        fileUrl: '/documents/yuksek_lisans_doktora_ogrenci_evrak_kontrol_listesi.pdf',
        tags: ['yüksek lisans', 'doktora', 'kontrol listesi', 'checklist', 'evrak', 'transkript', 'tömer', 'tanınırlık'],
        badge: 'PDF • Liste'
    },
    {
        id: 'kayit-silme-formu',
        title: 'Kayıt Silme / İlişik Kesme Formu (Disenrollment Form)',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: 'Öğrencinin kendi isteğiyle üniversiteden ilişiğinin kesilmesi, muhasebe ve ofis onayını içeren İngilizce/Türkçe form.',
        fileName: 'kayit_silme_ilisik_kesme_formu.pdf',
        fileUrl: '/documents/kayit_silme_ilisik_kesme_formu.pdf',
        tags: ['kayıt silme', 'ilişik kesme', 'disenrollment', 'ayrılma', 'muhasebe onayı'],
        badge: 'PDF • TR/EN'
    },
    {
        id: 'taksitlendirme-dilekcesi',
        title: 'Öğrenim Ücreti Taksitlendirme Dilekçesi',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: 'Öğrenim ücreti birinci taksit ödemesi sonrası kalan tutarın vadeli taksitlendirilmesi için Mütevelli Heyetine hitaben dilekçe.',
        fileName: 'ogrenim_ucreti_taksitlendirme_dilekcesi.pdf',
        fileUrl: '/documents/ogrenim_ucreti_taksitlendirme_dilekcesi.pdf',
        tags: ['taksitlendirme', 'ücret', 'mütevelli heyet', 'dilekçe', 'ödeme planı', 'öğrenim harcı'],
        badge: 'PDF • Dilekçe'
    }
];
