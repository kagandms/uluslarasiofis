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
        title: 'Başvuru Formu',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: '',
        fileName: 'uluslararasi_ogrenci_basvuru_formu.pdf',
        fileUrl: '/documents/uluslararasi_ogrenci_basvuru_formu.pdf',
        tags: ['başvuru', 'application form', 'kayıt', 'öğrenci bilgileri', 'adres', 'ikamet'],
        badge: 'PDF • Form'
    },
    {
        id: 'eksik-evrak-taahhutnamesi',
        title: 'Taahhütname',
        category: 'taahhutname',
        categoryLabel: 'Taahhütnameler',
        description: '',
        fileName: 'sartli_kayit_eksik_evrak_taahhutnamesi.pdf',
        fileUrl: '/documents/sartli_kayit_eksik_evrak_taahhutnamesi.pdf',
        tags: ['taahhütname', 'eksik evrak', 'şartlı kayıt', 'denklik', 'diploma', 'undertaking', 'kayıt'],
        badge: 'PDF • TR/EN'
    },
    {
        id: 'on-lisans-lisans-checklist',
        title: 'Ön Lisans/Lisans Checklist',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: '',
        fileName: 'on_lisans_lisans_ogrenci_evrak_kontrol_listesi.pdf',
        fileUrl: '/documents/on_lisans_lisans_ogrenci_evrak_kontrol_listesi.pdf',
        tags: ['ön lisans', 'lisans', 'kontrol listesi', 'checklist', 'evrak', 'başvuru', 'kabul mektubu', 'tömer', 'denklik'],
        badge: 'PDF • Liste'
    },
    {
        id: 'lisansustu-evrak-kontrol',
        title: 'Yüksek Lisans/Doktora Checklist',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: '',
        fileName: 'yuksek_lisans_doktora_ogrenci_evrak_kontrol_listesi.pdf',
        fileUrl: '/documents/yuksek_lisans_doktora_ogrenci_evrak_kontrol_listesi.pdf',
        tags: ['yüksek lisans', 'doktora', 'kontrol listesi', 'checklist', 'evrak', 'transkript', 'tömer', 'tanınırlık'],
        badge: 'PDF • Liste'
    },
    {
        id: 'kayit-silme-formu',
        title: 'Kayıt Silme',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: '',
        fileName: 'kayit_silme_ilisik_kesme_formu.pdf',
        fileUrl: '/documents/kayit_silme_ilisik_kesme_formu.pdf',
        tags: ['kayıt silme', 'ilişik kesme', 'disenrollment', 'ayrılma', 'muhasebe onayı'],
        badge: 'PDF • TR/EN'
    },
    {
        id: 'taksitlendirme-dilekcesi',
        title: 'Taksit Dilekçesi',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: '',
        fileName: 'ogrenim_ucreti_taksitlendirme_dilekcesi.pdf',
        fileUrl: '/documents/ogrenim_ucreti_taksitlendirme_dilekcesi.pdf',
        tags: ['taksitlendirme', 'ücret', 'mütevelli heyet', 'dilekçe', 'ödeme planı', 'öğrenim harcı'],
        badge: 'PDF • Dilekçe'
    },
    {
        id: 'bos-dilekce-formu',
        title: 'Boş Dilekçe',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: '',
        fileName: 'bos_dilekce_formu.pdf',
        fileUrl: '/documents/bos_dilekce_formu.pdf',
        tags: ['boş dilekçe', 'dilekçe', 'mütevelli heyet', 'talep', 'başvuru'],
        badge: 'PDF • Dilekçe'
    },
    {
        id: 'ikamet-kimlik-evrak-listesi',
        title: 'İkamet/Kimlik Başvurusu İçin Gerekli Evrak Listesi',
        category: 'basvuru-kayit',
        categoryLabel: 'Başvuru & Kayıt',
        description: '',
        fileName: 'ikamet_kimlik_basvurusu_icin_verilmesi_gereken_evraklar.pdf',
        fileUrl: '/documents/ikamet_kimlik_basvurusu_icin_verilmesi_gereken_evraklar.pdf',
        tags: ['ikamet', 'kimlik', 'göç idaresi', 'başvuru', 'evrak listesi', 'uets', 'öğrenci belgesi', 'kira sözleşmesi', 'kart bedeli', 'sigorta', 'parmak izi', 'checklist'],
        badge: 'PDF • Liste'
    },
    {
        id: 'indirim-dilekcesi',
        title: 'İndirim Dilekçesi',
        category: 'dilekce',
        categoryLabel: 'Dilekçeler',
        description: '',
        fileName: 'indirim_dilekcesi.pdf',
        fileUrl: '/documents/indirim_dilekcesi.pdf',
        tags: ['indirim dilekçesi', 'tömer', 'indirim', 'mütevelli heyet', 'ücret', 'dilekçe', 'tömer ücreti'],
        badge: 'PDF • Dilekçe'
    }
];
