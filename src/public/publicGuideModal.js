/** Step-by-step "How to use" guide. Screenshots in /guide were produced from the local app with synthetic data (see public/guide/README.md). */
const UI = {
    tr: { modalTitle: 'Uluslararası Öğrenci Portalı Rehberi', closeAria: 'Kapat', understoodBtn: 'Anladım', prev: 'Önceki', next: 'Sonraki', step: (n, total) => `Adım ${n} / ${total}`, imageNote: 'Büyütmek için görsele dokunun. Numaralar alanların yerini gösterir.' },
    en: { modalTitle: 'International Student Portal Guide', closeAria: 'Close', understoodBtn: 'Got it', prev: 'Previous', next: 'Next', step: (n, total) => `Step ${n} of ${total}`, imageNote: 'Tap the picture to enlarge it. The numbers show where each field is.' },
    ru: { modalTitle: 'Руководство по порталу иностранных студентов', closeAria: 'Закрыть', understoodBtn: 'Понятно', prev: 'Назад', next: 'Далее', step: (n, total) => `Шаг ${n} из ${total}`, imageNote: 'Нажмите на изображение, чтобы увеличить. Номера показывают расположение полей.' },
    tk: { modalTitle: 'Halkara Talyp Portaly Gollanmasy', closeAria: 'Ýap', understoodBtn: 'Düşnükli', prev: 'Öňki', next: 'Indiki', step: (n, total) => `${n} / ${total} ädim`, imageNote: 'Uly görmek üçin surata basyň. Sanlar meýdanlaryň ýerini görkezýär.' },
    ar: { modalTitle: 'دليل بوابة الطلاب الدوليين', closeAria: 'إغلاق', understoodBtn: 'فهمت', prev: 'السابق', next: 'التالي', step: (n, total) => `الخطوة ${n} من ${total}`, imageNote: 'اضغط على الصورة لتكبيرها. تشير الأرقام إلى مكان كل حقل.' }
};

const SLIDES = [
    { image: 'iletisim', title: {
        tr: '1. İletişim bilgileri', en: '1. Contact details', ru: '1. Контактные данные', tk: '1. Habarlaşmak maglumatlary', ar: '1. بيانات الاتصال' },
      text: {
        tr: 'Öğrenci numaranızı, e-postanızı ve telefonunuzu yazın; başvuru türünü seçip onay kutusunu işaretleyin. Kaydedilince ITU ile başlayan başvuru numaranız görünür; bunu not alın.',
        en: 'Enter your student number, email and phone, choose the application type and tick the box. After saving you get an application number starting with ITU; write it down.',
        ru: 'Введите номер студента, почту и телефон, выберите вид заявки и отметьте флажок. После сохранения появится номер заявки, начинающийся с ITU; запишите его.',
        tk: 'Talyp belgiňizi, e-poçtaňyzy we telefonyňyzy ýazyň, arza görnüşini saýlap bellik guutusyny belläň. Ýazdyrylandan soň ITU bilen başlaýan arza belgiňiz görünýär; ýazyp alyň.',
        ar: 'اكتب رقم الطالب والبريد والهاتف، واختر نوع الطلب وضع علامة في المربع. بعد الحفظ يظهر رقم طلب يبدأ بـ ITU؛ دوّنه.' } },
    { image: 'kisisel', title: {
        tr: '2. Kişisel ve ikamet bilgileri', en: '2. Personal and residence details', ru: '2. Личные данные и проживание', tk: '2. Şahsy we ýaşaýyş maglumatlary', ar: '2. البيانات الشخصية والسكن' },
      text: {
        tr: 'Ad, soyad ve pasaport numarasını pasaportunuzdaki gibi yazın. Doğum tarihini gün.ay.yıl biçiminde girin, kaldığınız yeri ve parmak izi durumunu seçin. Parmak izi kaydınız varsa e-İkamet formundaki kodu yazın.',
        en: 'Write your name and passport number exactly as in your passport. Enter the date of birth as day.month.year, pick where you live and your fingerprint status. If you have a fingerprint record, type the code from the e-İkamet form.',
        ru: 'Имя, фамилию и номер паспорта пишите как в паспорте. Дату рождения вводите как день.месяц.год, выберите место проживания и статус отпечатков. Если отпечатки сданы, введите код из формы e-İkamet.',
        tk: 'Ady, familiýany we pasport belgisini pasportdaky ýaly ýazyň. Doglan senäňizi gün.aý.ýyl görnüşinde giriziň, ýaşaýan ýeriňizi we barmak yzy ýagdaýyny saýlaň. Barmak yzy bar bolsa e-İkamet formundaky kody ýazyň.',
        ar: 'اكتب الاسم ورقم الجواز كما في الجواز. أدخل تاريخ الميلاد بصيغة يوم.شهر.سنة، واختر مكان الإقامة وحالة البصمة. إذا كانت لديك بصمة مسجلة فاكتب الرمز من نموذج e-İkamet.' } },
    { image: 'belgeler-bos', title: {
        tr: '3. Belgeleri yükleyin', en: '3. Upload documents', ru: '3. Загрузите документы', tk: '3. Resminamalary ýükläň', ar: '3. ارفع المستندات' },
      text: {
        tr: 'Her belge kendi kutusuna yüklenir. PDF veya fotoğraf kabul edilir (en fazla 10 MB); birden çok sayfa tek PDF olur. Altı zorunlu belgenin hepsi yüklenmeden devam edilemez.',
        en: 'Each document goes into its own box. PDF or photos are accepted (up to 10 MB); several pages become one PDF. You cannot continue until all six required documents are uploaded.',
        ru: 'Каждый документ загружается в свою ячейку. Принимаются PDF и фото (до 10 МБ); несколько страниц объединяются в один PDF. Пока не загружены все шесть документов, продолжить нельзя.',
        tk: 'Her resminama öz gutusyna ýüklenýär. PDF ýa-da surat kabul edilýär (iň köp 10 MB); birnäçe sahypa bir PDF bolýar. Alty hökmany resminamanyň hemmesi ýüklenmänkä dowam etmek bolmaýar.',
        ar: 'يُرفع كل مستند في خانته. يُقبل PDF أو الصور (حتى 10 ميغابايت) وتُدمج الصفحات في PDF واحد. لا يمكن المتابعة قبل رفع المستندات الستة المطلوبة.' } },
    { image: 'belgeler-yuklendi', title: {
        tr: 'Yüklenen belgeleri kontrol edin', en: 'Check the uploaded documents', ru: 'Проверьте загруженные документы', tk: 'Ýüklenen resminamalary barlaň', ar: 'تحقق من المستندات المرفوعة' },
      text: {
        tr: 'Yüklediğiniz dosyanın adı görünür. "Önizle" ile açıp kontrol edin; yanlış belgeyse "Belgeyi değiştir" ile yenisini yükleyin.',
        en: 'The name of the uploaded file appears. Open it with "Preview" to check; if it is wrong, use "Replace document".',
        ru: 'Отображается имя загруженного файла. Откройте его через «Просмотр»; если файл неверный, нажмите «Заменить документ».',
        tk: 'Ýüklän faýlyň ady görünýär. "Öňünden gör" bilen açyp barlaň; ýalňyş bolsa "Resminamany çalyş" bilen täzesini ýükläň.',
        ar: 'يظهر اسم الملف المرفوع. افتحه بزر «معاينة» للتحقق؛ وإذا كان خاطئاً فاستبدله بزر «استبدال المستند».' } },
    { image: 'bilgilendirme', title: {
        tr: '4. Başvuru bilgilendirmesi', en: '4. Application notice', ru: '4. Уведомление о заявке', tk: '4. Arza barada habar', ar: '4. إشعار الطلب' },
      text: {
        tr: 'Bilgilerin doğru olduğunu onaylayıp devam edin. Başvuru numaranızı bu ekranda da kopyalayabilirsiniz; sonuç sorgulamada gerekecek.',
        en: 'Confirm that the information is correct and continue. You can copy your application number here too; you need it to check the result.',
        ru: 'Подтвердите правильность данных и продолжайте. Номер заявки можно скопировать и здесь; он нужен для проверки статуса.',
        tk: 'Maglumatlaryň dogrudygyny tassyklap dowam ediň. Arza belgiňizi şu ýerde hem göçürip bilersiňiz; netijäni barlamak üçin gerek.',
        ar: 'أكّد صحة المعلومات وتابع. يمكنك نسخ رقم الطلب هنا أيضاً؛ فهو لازم لمتابعة النتيجة.' } },
    { image: 'son-kontrol', title: {
        tr: '5. Son kontrol ve gönderme', en: '5. Final check and submit', ru: '5. Проверка и отправка', tk: '5. Soňky barlag we ugratmak', ar: '5. المراجعة والإرسال' },
      text: {
        tr: 'Yazdığınız bilgileri ve belgeleri son kez gözden geçirin. Hata varsa "Geri" ile düzeltin; her şey doğruysa "Başvuruyu gönder"e basın.',
        en: 'Review your details and documents one last time. Fix mistakes with "Back"; if everything is right, press "Submit application".',
        ru: 'Ещё раз проверьте данные и документы. Ошибки исправьте кнопкой «Назад»; если всё верно, нажмите «Отправить заявку».',
        tk: 'Maglumatlary we resminamalary soňky gezek gözden geçiriň. Ýalňyşlyk bar bolsa "Yza" bilen düzediň; ählisi dogry bolsa "Arzany iber" düwmesine basyň.',
        ar: 'راجع بياناتك ومستنداتك للمرة الأخيرة. صحّح الأخطاء بزر «رجوع»، وإذا كان كل شيء صحيحاً فاضغط «إرسال الطلب».' } },
    { image: 'gonderildi', title: {
        tr: 'Başvurunuz gönderildi', en: 'Your application was submitted', ru: 'Заявка отправлена', tk: 'Arzaňyz iberildi', ar: 'تم إرسال طلبك' },
      text: {
        tr: 'Başvuru belgesini mutlaka indirin ve yanınızda bulundurun. Başvuru numaranızı ve öğrenci numaranızı saklayın. Bu ekran başvurunun ofise ulaştığını gösterir; Göç İdaresinin kararı değildir.',
        en: 'Be sure to download the application document and keep it with you. Keep your application number and student number. This screen shows the application reached the office; it is not a Migration Authority decision.',
        ru: 'Обязательно скачайте документ заявки и держите его при себе. Сохраните номер заявки и номер студента. Экран показывает, что заявка дошла до офиса; это не решение миграционной службы.',
        tk: 'Arza resminamasyny hökman ýükläp alyň we ýanyňyzda saklaň. Arza belgiňizi we talyp belgiňizi saklaň. Bu ekran arzanyň ofise ýetendigini görkezýär; Göç edarasynyň karary däl.',
        ar: 'حمّل وثيقة الطلب واحتفظ بها معك. احتفظ برقم الطلب ورقم الطالب. تُظهر هذه الشاشة وصول الطلب إلى المكتب وليست قرار إدارة الهجرة.' } },
    { image: 'sorgula', title: {
        tr: 'Başvurumu sorgula', en: 'Track my application', ru: 'Проверить заявку', tk: 'Arzamy barla', ar: 'الاستعلام عن طلبي' },
      text: {
        tr: 'Ana sayfadaki "Başvurumu Sorgula" ile ITU takip kodunuz ve öğrenci numaranızla giriş yapın. Başvurunuzun aşamasını görür, ofis belge isterse aynı ekrandan yüklersiniz.',
        en: 'Use "Track My Application" on the home page and sign in with your ITU code and student number. You see the stage of your application and can upload any document the office requests.',
        ru: 'На главной странице нажмите «Проверить заявку» и войдите по коду ITU и номеру студента. Вы увидите этап заявки и сможете загрузить документы, запрошенные офисом.',
        tk: 'Baş sahypadaky "Arzamy Barla" bilen ITU kodyňyz we talyp belgiňiz arkaly giriň. Arzaňyzyň tapgyryny görýärsiňiz, ofis resminama sorasa şu ekrandan ýükleýärsiňiz.',
        ar: 'استخدم «الاستعلام عن طلبي» في الصفحة الرئيسية وسجّل الدخول برمز ITU ورقم الطالب. ترى مرحلة طلبك ويمكنك رفع أي مستند يطلبه المكتب.' } },
    { image: 'devam-et', title: {
        tr: 'Başvurunuza başka cihazdan devam edin', en: 'Continue on another device', ru: 'Продолжить на другом устройстве', tk: 'Başga enjamdan dowam ediň', ar: 'المتابعة من جهاز آخر' },
      text: {
        tr: 'Taslağınıza "Başvuruma Devam Et" ile ITU kodunuz ve öğrenci numaranızla devam edebilirsiniz. Başvuru numaranızı bilmiyorsanız veya kaybettiyseniz Uluslararası Öğrenci Ofisi ile iletişime geçin.',
        en: 'Use "Resume My Application" with your ITU code and student number to continue your draft. If you do not know or have lost your application number, contact the International Student Office.',
        ru: 'Продолжите черновик через «Продолжить заявку» по коду ITU и номеру студента. Если вы не знаете или потеряли номер заявки, свяжитесь с Международным студенческим офисом.',
        tk: 'Garalamaňyzy "Arzama dowam et" bilen ITU kodyňyz we talyp belgiňiz arkaly dowam edip bilersiňiz. Arza belgiňizi bilmeseňiz ýa-da ýitiren bolsaňyz, Halkara talyplar ofisi bilen habarlaşyň.',
        ar: 'تابع مسودتك عبر «متابعة طلبي» برمز ITU ورقم الطالب. إذا كنت لا تعرف رقم طلبك أو فقدته فتواصل مع مكتب الطلبة الدوليين.' } }
];

let closeActiveGuide = null;

export function openPublicGuideModal() {
    closeActiveGuide?.();
    const trigger = document.activeElement;
    const locale = UI[document.documentElement.lang] ? document.documentElement.lang : 'tr';
    const t = UI[locale];
    const isRtl = locale === 'ar';
    let index = 0;

    const overlay = document.createElement('div');
    const background = new Map([...document.body.children].map(element => [element, element.inert]));
    const close = () => {
        document.removeEventListener('keydown', handleKeydown);
        overlay.remove();
        for (const [element, wasInert] of background) element.inert = wasInert;
        closeActiveGuide = null;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    overlay.id = 'public-guide-modal-overlay';
    overlay.className = 'public-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t.modalTitle);
    if (isRtl) overlay.setAttribute('dir', 'rtl');

    const modal = document.createElement('div');
    modal.className = 'public-modal-card public-guide-card';

    const header = document.createElement('div');
    header.className = 'public-modal-header';
    const title = document.createElement('h3');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📖';
    const titleText = document.createElement('span');
    titleText.textContent = t.modalTitle;
    title.append(icon, titleText);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'public-modal-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', t.closeAria);
    closeBtn.addEventListener('click', close);
    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'public-modal-body public-guide-body';

    const nav = document.createElement('div');
    nav.className = 'public-guide-nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'home-cta home-cta-secondary public-guide-prev';
    prevBtn.textContent = t.prev;
    const counter = document.createElement('span');
    counter.className = 'public-guide-counter';
    counter.setAttribute('aria-live', 'polite');
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'home-cta home-cta-primary public-guide-next';
    nextBtn.textContent = t.next;
    nav.append(prevBtn, counter, nextBtn);

    const stepTitle = document.createElement('h4');
    stepTitle.className = 'public-guide-step-title';
    const stepText = document.createElement('p');
    stepText.className = 'public-guide-step-text';
    const figure = document.createElement('figure');
    figure.className = 'public-guide-figure';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    const note = document.createElement('figcaption');
    note.textContent = t.imageNote;
    const zoom = document.createElement('a');
    zoom.target = '_blank';
    zoom.rel = 'noopener';
    zoom.append(image);
    figure.append(zoom, note);
    body.append(nav, stepTitle, stepText, figure);

    const footer = document.createElement('div');
    footer.className = 'public-modal-footer';
    const closeBottomBtn = document.createElement('button');
    closeBottomBtn.type = 'button';
    closeBottomBtn.className = 'home-cta home-cta-primary';
    closeBottomBtn.style.minHeight = '2.4rem';
    closeBottomBtn.style.padding = '0.4rem 1.4rem';
    closeBottomBtn.style.fontSize = '0.9rem';
    closeBottomBtn.textContent = t.understoodBtn;
    closeBottomBtn.addEventListener('click', close);
    footer.append(closeBottomBtn);

    const render = () => {
        const slide = SLIDES[index];
        stepTitle.textContent = slide.title[locale];
        stepText.textContent = slide.text[locale];
        image.src = `/guide/${locale}/${slide.image}.jpg`;
        zoom.href = image.src;
        image.alt = `${slide.title[locale]}: ${slide.text[locale]}`;
        counter.textContent = t.step(index + 1, SLIDES.length);
        prevBtn.disabled = index === 0;
        nextBtn.disabled = index === SLIDES.length - 1;
        body.scrollTop = 0;
    };
    const go = (delta) => {
        const target = Math.min(SLIDES.length - 1, Math.max(0, index + delta));
        if (target === index) return;
        index = target;
        render();
    };
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));

    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);
    for (const element of background.keys()) element.inert = true;
    render();

    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (overlay.contains(document.activeElement) && document.activeElement?.tagName !== 'INPUT') {
                e.preventDefault();
                go((e.key === 'ArrowRight') === !isRtl ? 1 : -1);
            }
        } else if (e.key === 'Tab') {
            const focusable = [...overlay.querySelectorAll('button')].filter(button => !button.disabled);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!overlay.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    document.addEventListener('keydown', handleKeydown);
    closeActiveGuide = close;
    closeBtn.focus();
}
