# Asistan bilgi metinleri: ofis incelemesi

- **Tarih:** 2026-11-23
- **Kaynak:** `src/server/domain/chatbotKnowledge.js` (test dalı `test/combined-release-candidate`)
- **Durum:** Ofis ONAYI BEKLİYOR. Yalnızca "Ofis çalışma saatleri" onaylı; diğer 13 konu taslak.
- **Nasıl okunur:** Her konuda önce Türkçe metin var. Asistan bu metinleri öğrencilere aynen gösterir. Yanlış, eksik veya fazla söz verenleri işaretleyin; belge listeleri bu metinlerde YOK (belge listesi tek kaynaktan, belge politikasından gelir).
- Diğer diller Türkçenin karşılığıdır; ofiste o dilleri bilen biri varsa onlara da baktırın.

## 1. Başvuru adımları (`application_steps`)

**Türkçe**

Başvuru adımları: 1) Ana sayfadaki "Başvuruya Başla" (/basvuru/) bölümünde öğrenci numaranızı, e-postanızı, telefonunuzu ve başvuru türünüzü (ilk başvuru, uzatma veya geçiş) girin; kaydedince ITU ile başlayan başvuru numaranız oluşturulur. 2) Kişisel bilgilerinizi, pasaport ve doğum tarihi bilgilerinizi, kaldığınız yeri ve parmak izi kaydı durumunuzu ekleyin. 3) Gerekli belgeleri PDF veya fotoğraf (en fazla 10 MB; birden çok sayfa tek PDF olur) olarak yükleyin. 4) Başvuru bilgilendirmesini onaylayın. 5) Son kontrolü yapıp başvuruyu gönderin ve zorunlu A4 kapak PDF belgesini indirin. Taslağınıza başka cihazdan "Başvuruma Devam Et" (/basvuruya-devam-et/) ile devam edebilir, sürecinizi "Başvurumu Sorgula" (/basvurum/) bölümünden takip edebilirsiniz. Başvuru numaranızı unutursanız ana sayfadaki "Başvuru Numaramı Unuttum" seçeneğini kullanın.

**English**

Application steps: 1) Open "Start My Application" (/basvuru/) from the home page and enter your student number, e-mail, phone number, and application type (initial, extension/renewal, or transition); saving generates an application number starting with ITU. 2) Complete your personal, passport, and date-of-birth details, accommodation type, and fingerprint registration status. 3) Upload the required documents as PDF or photos (up to 10 MB; multiple pages combine into one PDF). 4) Accept the application acknowledgement. 5) Review and submit, then download the required application cover PDF. You can continue a draft from another device via "Continue My Application" (/basvuruya-devam-et/) and check status via "Track my application" (/basvurum/). If you forget your application number, use "I Forgot My Application Number" on the home page.

**Русский**

Этапы подачи заявки: 1) Откройте «Başvuruya Başla» (/basvuru/) на главной странице и укажите номер студента, e-mail, телефон и тип заявки (первичная подача, продление или переход); после сохранения появится номер заявки, начинающийся с ITU. 2) Заполните личные данные, сведения паспорта и дату рождения, место проживания и статус регистрации отпечатков пальцев. 3) Загрузите необходимые документы в формате PDF или фото (до 10 МБ; несколько страниц объединяются в один PDF). 4) Примите подтверждение данных заявки. 5) Проверьте данные, отправьте заявку и обязательно скачайте итоговый PDF-документ заявки. Продолжить черновик с другого устройства можно через «Продолжить заявку» (/basvuruya-devam-et/), а проверить статус — через «Проверить статус заявки» (/basvurum/). Если вы забыли номер заявки, воспользуйтесь напоминанием на главной странице.

**Türkmençe**

Arza ädimleri: 1) Baş sahypadaky «Başvuruya Başla» (/basvuru/) bölüminde talyp belgiňizi, e-poçtaňyzy, telefonyňyzy we arza görnüşini (ilkinji, uzaltma ýa-da geçiş) giriziň; ýazdyrylandan soň ITU bilen başlaýan arza belgiňiz berilýär. 2) Şahsy maglumatlaryňyzy, pasport we doglan sene maglumatlaryny, ýaşaýan ýeriňizi hem-de barmak yzy ýagdaýyňyzy dolduryň. 3) Gerekli resminamalary PDF ýa-da surat görnüşinde (iň köp 10 MB; birnäçe sahypa bir PDF bolýar) ýükläň. 4) Arza baradaky habary tassyklaň. 5) Soňky barlagy geçirip arzany iberiň we hökmany arza resminamasyny (PDF) ýükläp alyň. Taslamany başga enjamdan «Arzama dowam et» (/basvuruya-devam-et/) arkaly dowam etdirip, ýagdaýy «Arzamyň ýagdaýyny barla» (/basvurum/) bölüminden yzarlap bilersiňiz. Arza belgiňizi unutsaňyz, baş sahypadaky ýatlatma düwmesini ulanyň.

**العربية**

خطوات التقديم: 1) افتح صفحة بدء الطلب (/basvuru/) من الصفحة الرئيسية وأدخل رقم الطالب والبريد الإلكتروني والهاتف ونوع الطلب (أولي أو تمديد أو انتقال)؛ عند الحفظ يظهر رقم طلب يبدأ بـ ITU. 2) أكمل البيانات الشخصية وبيانات الجواز وتاريخ الميلاد ومكان الإقامة وحالة تسجيل البصمات. 3) ارفع المستندات المطلوبة بصيغة PDF أو صور (حتى 10 ميغابايت، وتُدمج الصفحات المتعددة في ملف PDF واحد). 4) وافق على إقرار الطلب. 5) راجع البيانات وأرسل الطلب ثم حمّل ملف PDF الخاص بالطلب. يمكنك متابعة المسودة من جهاز آخر عبر (/basvuruya-devam-et/) وتتبع حالة طلبك عبر (/basvurum/). وإذا نسيت رقم الطلب، استخدم خيار استرجاع رقم الطلب في الصفحة الرئيسية.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 2. İkamet izni temel bilgiler (`residence_permit_basics`)

**Türkçe**

Bu portal, İstanbul Topkapı Üniversitesi öğrencilerinin öğrenci ikamet izni belgelerini Uluslararası Öğrenci Ofisine iletmesi ve inceleme sürecini takip etmesi içindir. İlk başvuru, uzatma/yenileme ve öğrenci ikamet iznine geçiş başvuruları desteklenir. Resmî ikamet izni başvurusu ayrıca e-İkamet sistemi üzerinden tamamlanır; portal üzerinden gönderim yapmak başvurunun üniversite ofisine ulaştığını gösterir, Göç İdaresinin ikamet izni kararı değildir. Başvurular Taslak, İncelemede, Belge güncellemesi (gerekirse), Göç İdaresine iletildi ve Tamamlandı aşamalarından geçer.

**English**

This portal lets İstanbul Topkapı University students submit their student residence permit documents to the International Student Office and track review progress. It supports initial, extension/renewal, and student-permit transition applications. The official residence permit application must still be completed separately in the e-İkamet system; submitting on this portal delivers your file to the university office and is not a residence permit decision by the Migration Authority. Portal stages include Draft, Under review, Document update (when requested), Sent to Migration Authority, and Completed.

**Русский**

Этот портал предназначен для подачи студентами İstanbul Topkapı Üniversitesi документов на студенческий ВНЖ в Международный студенческий офис и отслеживания их проверки. Поддерживаются первичная подача, продление и переход на студенческий ВНЖ. Официальное заявление дополнительно оформляется в системе e-İkamet; отправка на портале означает передачу дела в офис университета, а не решение миграционной службы (Göç İdaresi). Этапы на портале: Черновик, На рассмотрении, Обновление документа (при запросе), Передано в миграционную службу и Завершено.

**Türkmençe**

Bu portal İstanbul Topkapı Uniwersitetiniň talyplaryna talyp ýaşaýyş rugsady resminamalaryny Halkara talyplar ofisine ibermek we barlag tapgyryny yzarlamak üçindir. Ilkinji arza, uzaltma/täzeleme we talyp ýaşaýyş rugsadyna geçiş arzalary goldanylýar. Resmi ýaşaýyş rugsady arzasy e-İkamet ulgamynda aýratyn tamamlanýar; portalda ibermek arzanyň ofise ýetendigini görkezýär we Migrasiýa edarasynyň karary däldir. Portal tapgyrlary: Taslama, Barlagda, Resminamany täzelemek (soralsa), Migrasiýa edarasyna iberildi we Tamamlandy.

**العربية**

تتيح هذه البوابة لطلاب جامعة إسطنبول توبكابي رفع مستندات تصريح إقامة الطالب إلى مكتب الطلاب الدوليين ومتابعة مراجعتها. تدعم البوابة الطلب الأولي وطلب التمديد/التجديد وطلب الانتقال إلى إقامة الطالب. يجب استكمال طلب الإقامة الرسمي بشكل منفصل في نظام e-İkamet؛ فالإرسال عبر البوابة يعني وصول الملف إلى مكتب الجامعة وليس قراراً من إدارة الهجرة. تمر الطلبات بمراحل: مسودة، قيد المراجعة، تحديث مستند (عند الطلب)، أُرسل إلى إدارة الهجرة، ومكتمل.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 3. Başvuru türleri (`application_types`)

**Türkçe**

Portalda üç başvuru türü vardır: 1) İlk başvuru: Öğrenci ikamet iznine ilk kez başvuruyorsanız seçin. 2) Uzatma / yenileme: Mevcut öğrenci ikamet izninizi uzatıyorsanız seçin. 3) Geçiş başvurusu: Başka bir ikamet izni türünü öğrenci ikamet iznine çeviriyorsanız seçin; bu seçenekte 11 haneli yabancı kimlik numaranız ve mevcut kart bilgileriniz istenir. Başvuru gönderildikten sonra başvuru türü değiştirilemez. Gerekli belgeler başvuru türüne, yaş grubuna ve konaklama türüne göre değişir; kesin liste için bu sohbette bu bilgilerle "hangi belgeler gerekli?" diye sorabilirsiniz.

**English**

The portal supports three application types: 1) Initial application: choose this when applying for a student residence permit for the first time. 2) Extension / renewal: choose this when extending an existing student residence permit. 3) Transition: choose this when switching from another residence permit type to a student permit; the form asks for your 11-digit foreign ID number and current card details. Application type cannot be changed after submission. Required documents depend on your application type, age group, and accommodation type; to get the exact list, ask "which documents are required?" in this chat with those details.

**Русский**

На портале есть три типа заявок: 1) Первичная подача: выберите при первом оформлении студенческого ВНЖ. 2) Продление: выберите при продлении действующего студенческого ВНЖ. 3) Переход: выберите при переходе с другого вида ВНЖ на студенческий; в форме запрашиваются 11-значный номер иностранца и данные текущей карты. После отправки заявки тип изменить нельзя. Необходимые документы зависят от типа заявки, возрастной группы и типа проживания; чтобы получить точный список, спросите в этом чате «какие документы нужны?» и укажите эти данные.

**Türkmençe**

Portalda üç arza görnüşi bar: 1) Ilkinji arza: talyp ýaşaýyş rugsadyna ilkinji gezek ýüz tutýan bolsaňyz saýlaň. 2) Uzaltma / täzeleme: bar bolan talyp ýaşaýyş rugsadyny uzaltmak üçin saýlaň. 3) Geçiş arzasy: başga ýaşaýyş rugsadyndan talyp rugsadyna geçýän bolsaňyz saýlaň; 11 sanly daşary ýurtly belgiňiz we häzirki kart maglumatlaryňyz soralýar. Arza iberilenden soň görnüşi üýtgedip bolmaýar. Gerekli resminamalar arza görnüşine, ýaş toparyna we ýaşaýan ýeriň görnüşine baglydyr; takyk sanaw üçin şu söhbetde bu maglumatlar bilen «haýsy resminamalar gerek?» diýip sorap bilersiňiz.

**العربية**

تدعم البوابة ثلاثة أنواع للطلبات: 1) الطلب الأولي: اختره عند التقديم لإقامة الطالب أول مرة. 2) التمديد / التجديد: اختره لتمديد إقامة طالب حالية. 3) طلب الانتقال: اختره عند التحويل من نوع إقامة آخر إلى إقامة طالب؛ ويُطلب فيه رقم هوية الأجنبي من 11 رقماً وبيانات البطاقة الحالية. لا يمكن تغيير نوع الطلب بعد الإرسال. تختلف المستندات المطلوبة حسب نوع الطلب والفئة العمرية ونوع السكن؛ وللحصول على القائمة الدقيقة اسأل في هذه المحادثة «ما المستندات المطلوبة؟» مع ذكر هذه التفاصيل.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 4. Belge biçimi (PDF/JPG, boyut) (`document_format`)

**Türkçe**

Belgeleri PDF, JPG/JPEG, PNG veya WebP biçiminde yükleyebilirsiniz; her belge kartında en fazla 10 MB sınırı vardır. Tek bir belge için birden fazla fotoğraf veya PDF seçerseniz (en fazla 20 dosya, birleştirilmiş PDF en fazla 100 sayfa) tarayıcınız bunları otomatik olarak tek PDF dosyasında birleştirir. Her belgeyi yalnızca kendi kutusuna yükleyin; yanlış kutuya yüklenen dosya o belgeyi tamamlamaz. Başvuruyu gönderdikten sonra oluşturulan A4 kapak PDF’ini mutlaka indirip yanınızda bulundurun.

**English**

You can upload documents as PDF, JPG/JPEG, PNG, or WebP; each document slot allows up to 10 MB. If you select multiple photos or PDFs for one document (up to 20 files, combined PDF up to 100 pages), your browser automatically merges them into a single PDF. Upload each document only into its own box; a file placed in the wrong box does not satisfy that requirement. After submitting your application, you must download the required A4 cover PDF and keep it with you.

**Русский**

Документы принимаются в форматах PDF, JPG/JPEG, PNG и WebP; максимальный размер для каждого документа — 10 МБ. Если выбрать несколько фото или PDF для одного документа (до 20 файлов, в сумме до 100 страниц), браузер автоматически объединит их в один PDF. Загружайте каждый документ только в соответствующее поле: файл в чужом поле не засчитывается. После отправки заявки обязательно скачайте итоговый PDF-документ обложки формата A4 и сохраните его.

**Türkmençe**

Resminamalary PDF, JPG/JPEG, PNG ýa-da WebP görnüşinde ýükläp bilersiňiz; her resminama üçin iň köp 10 MB çäk bar. Bir resminama üçin birnäçe surat ýa-da PDF saýlasaňyz (iň köp 20 faýl, jemi 100 sahypa çenli), brauzer olary awtomatik bir PDF-e birleşdirýär. Her resminamany diňe öz gutusyna ýükläň; nädogry ýere ýüklenen faýl talaby ýapmaýar. Arzany ibereniňizden soň taýýarlanýan hökmany A4 gapak PDF resminamasyny ýükläp alyp ýanyňyzda saklaň.

**العربية**

يمكنك رفع المستندات بصيغة PDF أو JPG/JPEG أو PNG أو WebP، بحد أقصى 10 ميغابايت لكل مستند. عند اختيار عدة صور أو ملفات PDF لمستند واحد (حتى 20 ملفاً وبحد أقصى 100 صفحة مدمجة)، يدمجها المتصفح تلقائياً في ملف PDF واحد. ارفع كل مستند في خانته المخصصة فقط؛ فالملف المرفوع في خانة خاطئة لا يُحتسب. وبعد إرسال الطلب يجب تنزيل ملف الغلاف A4 بصيغة PDF والاحتفاظ به معك.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 5. Belgenin yeniden yüklenmesi (`document_resubmission`)

**Türkçe**

Başvurunuzda "Belge yeniden gönderilmeli" veya bir belgede "Yeniden yüklenmesi gerekiyor" görünüyorsa ana sayfadaki "Başvurumu Sorgula" (/basvurum/) veya "Başvuruma Devam Et" (/basvuruya-devam-et/) ekranına ITU başvuru numaranız ve öğrenci numaranızla giriş yapın. Ofis açıklamasını okuyup yalnızca istenen belge kartından yeni PDF veya fotoğrafları yükleyin. Başvuru gönderildikten sonra genel bilgiler değiştirilemez; yalnızca istenen belgeler yenilenebilir. Güvenlik taraması tamamlanmayan veya sorun yaşadığınız belgeler için soru formunu kullanın.

**English**

If your application says "Document resubmission required" or a document says "Replacement upload required", sign in on "Track my application" (/basvurum/) or "Continue My Application" (/basvuruya-devam-et/) using your ITU application number and student number. Read the office message on the card and upload the replacement PDF or photos there. After submission, general application fields cannot be edited—only requested documents can be replaced. If a scan fails or you need help, contact the office via the question form.

**Русский**

Если у заявки статус «Требуется повторно отправить документ» или у файла указано «Требуется загрузить замену», войдите в раздел «Проверить статус заявки» (/basvurum/) или «Продолжить заявку» (/basvuruya-devam-et/) с номером ITU и номером студента. Прочитайте комментарий офиса в карточке и загрузите новый PDF или фото. После отправки общие данные заявки не редактируются — можно заменить только запрошенные документы. При проблемах со сканированием или загрузкой напишите в офис через форму вопросов.

**Türkmençe**

Arzaňyzda «Resminama täzeden iberilmeli» ýa-da resminamada «Täzesini ýüklemek gerek» görünse, baş sahypadaky «Arzamyň ýagdaýyny barla» (/basvurum/) ýa-da «Arzany dowam et» (/basvuruya-devam-et/) bölümine ITU belgiňiz we talyp belgiňiz bilen giriň. Ofisiň düşündirişini okap, şol resminama kartasyndan täze PDF ýa-da suratlary ýükläň. Arza iberilenden soň umumy maglumatlary üýtgedip bolmaýar, diňe soralan resminamalar täzelenýär. Kynçylyk ýüze çyksa, sorag formasy arkaly ofis bilen habarlaşyň.

**العربية**

إذا ظهرت حالة «يلزم إعادة إرسال المستند» أو «يلزم رفع مستند بديل»، فسجّل الدخول في صفحة «تتبّع طلبي» (/basvurum/) أو «متابعة طلبي» (/basvuruya-devam-et/) برقم الطلب ITU ورقم الطالب. اقرأ ملاحظة المكتب في بطاقة المستند وارفع ملف PDF أو الصور البديلة هناك. بعد إرسال الطلب لا يمكن تعديل البيانات العامة، بل استبدال المستندات المطلوبة فقط. وإذا تعذر الفحص الأمني أو احتجت إلى مساعدة، تواصل مع المكتب عبر نموذج الأسئلة.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 6. Başvuru numarasını unuttum (`forgot_reference`)

**Türkçe**

ITU ile başlayan başvuru numaranızı unuttuysanız ana sayfadaki "Başvuru Numaramı Unuttum" düğmesine tıklayın ve öğrenci numaranızı girin. Aktif bir başvurunuz varsa numaranız başvuru sırasında kaydettiğiniz e-posta adresine, sayfanın üstünde seçili olan dilde gönderilir. E-posta birkaç dakika içinde gelmezse gereksiz (spam) klasörünü kontrol edin. Etkinse aynı panelde Telegram ile alma seçeneği de görünebilir. Hâlâ erişemezseniz ana sayfadaki soru formundan Uluslararası Öğrenci Ofisine yazın.

**English**

If you forgot your ITU application number, click "I Forgot My Application Number" on the home page and enter your student number. If you have an active application, your number will be sent to the e-mail address you entered when applying, in the language selected at the top of the page. If it does not arrive within a few minutes, check your junk (spam) folder. When enabled, a Telegram option may also appear in the same panel. If you still cannot retrieve it, contact the International Student Office via the question form.

**Русский**

Если вы забыли номер заявки ITU, нажмите «Я забыл(а) номер заявки» на главной странице и введите номер студента. При наличии активной заявки номер будет отправлен на указанный при подаче e-mail на языке, выбранном вверху страницы. Если письмо не пришло за несколько минут, проверьте папку «Спам». Если опция включена, там же может появиться ссылка для получения в Telegram. Если номер всё равно не удаётся получить, обратитесь в офис через форму вопросов.

**Türkmençe**

ITU bilen başlaýan arza belgiňizi unutsaňyz, baş sahypadaky «Arza belgimi unutdym» düwmesine basyp talyp belgiňizi giriziň. Işjeň arzaňyz bar bolsa, belgiňiz arza tabşyranyňyzda ýazan e-poçtaňyza sahypanyň ýokarsynda saýlanan dilde iberiler. Birnäçe minutda gelmese, spam bukjasyny barlaň. Açyk bolsa şol panelde Telegram bilen almak mümkinçiligi hem görnüp biler. Şonda-da alyp bilmeseňiz, baş sahypadaky sorag formasyndan ofise ýüz tutuň.

**العربية**

إذا نسيت رقم طلبك الذي يبدأ بـ ITU، اضغط على «نسيت رقم الطلب» في الصفحة الرئيسية وأدخل رقم الطالب. إذا كان لديك طلب نشط، سيُرسل الرقم إلى البريد الإلكتروني الذي أدخلته عند التقديم باللغة المختارة أعلى الصفحة. وإذا لم يصلك خلال دقائق، فتحقق من مجلد الرسائل غير المرغوب فيها (السبام). وقد يظهر أيضاً خيار الاسترجاع عبر تيليجرام في اللوحة نفسها عند تفعيله. وإذا تعذر الوصول إليه، راسل المكتب عبر نموذج الأسئلة.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 7. Başvuru takibi (`tracking`)

**Türkçe**

Başvuru durumunuzu iki yolla takip edebilirsiniz: 1) ITU-XXXX-XXXX biçimindeki başvuru numaranızı doğrudan bu sohbete yazarak mevcut aşamayı ve belge özetini öğrenebilirsiniz. 2) Ana sayfadaki "Başvurumu Sorgula" (/basvurum/) sayfasına ITU kodunuz ve öğrenci numaranızla giriş yaparak belge durumlarını, ofis açıklamalarını görebilir ve istenen belgeleri yükleyebilirsiniz. Başlıca aşamalar: Taslak, Gönderildi, İncelemede, Belge yeniden gönderilmeli, Göç İdaresine gönderildi ve Tamamlandı. Yarım kalan taslağa devam etmek için /basvuruya-devam-et/ kullanılır.

**English**

You can track your application in two ways: 1) Paste your ITU-XXXX-XXXX reference number directly into this chat to see your current stage and document counts. 2) Open "Track my application" (/basvurum/) from the home page and sign in with your ITU code and student number to view document statuses, office notes, and upload requested replacements. Main stages include Draft, Submitted, Under review, Document resubmission required, Sent to Migration Authority, and Completed. To resume an unfinished draft on another device, use /basvuruya-devam-et/.

**Русский**

Отслеживать заявку можно двумя способами: 1) Отправьте номер в формате ITU-XXXX-XXXX прямо в этот чат, чтобы узнать текущий этап и сводку по документам. 2) Откройте «Проверить статус заявки» (/basvurum/) на главной странице и войдите с кодом ITU и номером студента, чтобы видеть статусы документов, комментарии офиса и загружать запрошенные замены. Основные этапы: Черновик, Отправлена, На рассмотрении, Требуется повторно отправить документ, Передана в Миграционное управление, Завершена. Для продолжения черновика используйте /basvuruya-devam-et/.

**Türkmençe**

Arzaňyzyň ýagdaýyny iki usul bilen yzarlap bilersiňiz: 1) ITU-XXXX-XXXX görnüşli arza belgiňizi göni şu söhbete ýazyp, häzirki tapgyry we resminama sanawynyň jemini görüp bilersiňiz. 2) Baş sahypadaky «Arzamyň ýagdaýyny barla» (/basvurum/) sahypasyna ITU kodyňyz we talyp belgiňiz bilen girip, resminama ýagdaýlaryny, ofis belliklerini görüp we soralan resminamalary ýükläp bilersiňiz. Esasy tapgyrlar: Taslama, Iberildi, Barlagda, Resminama täzeden iberilmeli, Migrasiýa edarasyna iberildi we Tamamlandy. Taslamany dowam etdirmek üçin /basvuruya-devam-et/ ulanylýar.

**العربية**

يمكنك متابعة طلبك بطريقتين: 1) إرسال رقم الطلب بصيغة ITU-XXXX-XXXX مباشرة في هذه المحادثة لمعرفة المرحلة الحالية وملخص المستندات. 2) فتح صفحة «تتبّع طلبي» (/basvurum/) من الصفحة الرئيسية وتسجيل الدخول برمز ITU ورقم الطالب للاطلاع على حالة كل مستند وملاحظات المكتب ورفع المستندات المطلوبة مجدداً. المراحل الرئيسية هي: مسودة، تم الإرسال، قيد المراجعة، يلزم إعادة إرسال المستند، أُرسل إلى إدارة الهجرة، ومكتمل. ولمتابعة مسودة غير مكتملة استخدم /basvuruya-devam-et/.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 8. Adres kanıtı belgeleri (`address_evidence`)

**Türkçe**

Kaldığınız yere göre altı adres seçeneğinden biri seçilir: 1) Kira sözleşmesi (noter onaylı). 2) Kendi evim (tapu fotokopisi, numarataj belgesi; varsa isteğe bağlı DASK). 3) Öğrenci yurdu (yurtta kalış belgesi, yurdun vergi levhası ve imza sirküleri). 4) Otel/konaklama tesisi (konaklama belgesi). 5) Taahhütname (noter onaylı taahhütname, evli ise eşinin de taahhütnamesi, taahhüt verenin yerleşim yeri belgesi ve adına fatura; Türk vatandaşıysa vukuatlı nüfus kayıt örneği; e-Devlet belgeleri son 1 ayda alınmış olmalı). 6) Adres kaydı (yerleşim yeri belgesi; e-Devlet ise son 1 ay). Kesin liste için başvuru türünüzü, 18 yaş durumunuzu ve konaklama türünüzü paylaşın.

**English**

You choose one of six address options: 1) Rental contract (notarized). 2) Own home (title deed copy, numbering document; optional DASK). 3) Student dormitory (dormitory residence document, tax certificate, signature circular). 4) Hotel (accommodation document with facility and stay dates). 5) Undertaking (notarized undertaking plus spouse’s if married, host’s address certificate, utility bill in host’s name, detailed population record if Turkish citizen; e-Devlet docs within the last month). 6) Registered address (residence certificate; e-Devlet within the last month). For your exact list, share your application type, under-18 status, and accommodation type.

**Русский**

В зависимости от жилья выбирается один из шести вариантов: 1) Договор аренды (нотариальный). 2) Собственное жильё (копия документа о собственности, нумерация адреса; DASK при наличии). 3) Общежитие (справка о проживании, налоговое свидетельство, циркуляр подписей). 4) Отель (подтверждение проживания с названием и датами). 5) Обязательство (нотариальное обязательство и супруга при браке, справка о месте жительства и счёт на имя поручителя; если гражданин Турции — выписка реестра населения; e-Devlet за последний месяц). 6) Регистрация по адресу (справка о месте жительства; e-Devlet за последний месяц). Для точного списка укажите тип заявки, возраст (до 18?) и жильё.

**Türkmençe**

Ýaşaýan ýeriňize görä alty salgy görnüşiniň biri saýlanýar: 1) Kärende şertnamasy (notarial). 2) Öz öýüm (eýeçilik nusgasy, belgilenme resminamasy; bar bolsa DASK). 3) Umumy ýaşaýyş jaýy (galýanlyk resminamasy, salgyt şahadatnamasy, gol nusgalary). 4) Myhmanhana (galýan ýeri we seneleri görkezýän resminama). 5) Borçnama (notarial borçnama we öýlenen bolsa ýanýoldaşynyňky, borçnama berýäniň ýaşaýan ýeri şahadatnamasy we adyna töleg hasaby; Türk raýaty bolsa giňişleýin ilat ýazgysy; e-Devlet soňky 1 aý). 6) Hasaba alnan salgy (ýaşaýan ýeri şahadatnamasy; e-Devlet soňky 1 aý). Takyk sanaw üçin arza görnüşini, 18 ýaş ýagdaýyny we ýaşaýan ýeriňizi ýazyň.

**العربية**

يُختار أحد ستة خيارات لإثبات العنوان حسب السكن: 1) عقد إيجار موثق. 2) مسكن خاص (نسخة سند الملكية، ترقيم العنوان، وDASK اختيارياً). 3) سكن طلابي (إثبات الإقامة، الشهادة الضريبية، وتعميم التوقيعات). 4) فندق (وثيقة الإقامة موضحاً بها المنشأة والتواريخ). 5) تعهد (تعهد موثق من المضيف ومن زوجه إن كان متزوجاً، شهادة محل إقامته، فاتورة باسمه، وقيد نفوس مفصل إذا كان مواطناً تركياً؛ وثائق e-Devlet خلال الشهر الأخير). 6) العنوان المسجل (شهادة محل الإقامة؛ وثائق e-Devlet خلال الشهر الأخير). للقائمة الدقيقة لوضعك، اذكر نوع الطلب، وهل العمر دون 18 عاماً، ونوع السكن.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 9. Parmak izi (`fingerprint`)

**Türkçe**

Portaldaki "Göç İdaresi sisteminde parmak izi kaydınız var mı?" sorusu, daha önce Göç İdaresi sisteminde parmak izi kaydınızın bulunup bulunmadığını sorar. "Evet" seçerseniz e-İkamet üzerinden aldığınız başvuru formundaki parmak izi kayıt / işlem kodunu girmeniz gerekir. "Hayır" seçerseniz mevcut akışta ilerleyemezsiniz; devam etmeden önce parmak izi işleminiz için üniversitedeki Uluslararası Öğrenci Ofisine uğramanız gerekir. Geçiş başvurularında geçerli parmak izi kaydı ve kodu girildiğinde UETS belgesi de istenir. Kodunuzu bulamıyorsanız soru formundan ofise danışabilirsiniz.

**English**

The portal question "Is your fingerprint registration in the Migration Authority system?" asks whether your fingerprints are already registered with Göç İdaresi. If you select Yes, enter the fingerprint registration / transaction code printed on your e-İkamet residence application form. If you select No, the portal cannot proceed to later steps; before continuing, please visit the International Student Office at the university for your fingerprint procedure. In transition applications, having fingerprint registration and a valid code also requires uploading a UETS document. If you are unsure where to find the code, ask the office via the question form.

**Русский**

Вопрос «Есть ли ваша регистрация отпечатков пальцев в системе Управления по миграции?» уточняет, сдавали ли вы ранее отпечатки в Göç İdaresi. Если выберете «Да», нужно ввести код регистрации отпечатков из формы заявления e-İkamet. Если выберете «Нет», портал не позволит продолжить; перед продолжением вам следует обратиться в Международный студенческий офис в университете для прохождения процедуры сдачи отпечатков пальцев. При заявке на переход наличие регистрации и действительного кода также делает обязательным документ UETS. Если не можете найти код или сомневаетесь, напишите в офис через форму вопросов.

**Türkmençe**

Portaldaky «Migrasiýa edarasynda barmak yzlaryňyz hasaba alnanmy?» soragy öň barmak yzyňyzyň hasaba alnyp-alynmandygyny soraýar. «Hawa» saýlasaňyz, e-İkamet arzasyndaky barmak yzy hasaba alyş / amal koduny girizmeli. «Ýok» saýlasaňyz, dowam etmek üçin ilki barmak yzy amalyňyz üçin uniwersitetdäki Halkara talyplar ofisine barmaly bolarsyňyz. Geçiş arzalarynda barmak yzy hasaby we dogry kody bar bolsa, UETS resminamasy hem soralýar. Kody tapyp bilmeseňiz ýa-da soragyňyz bar bolsa, baş sahypadaky sorag formasyndan ofise ýüz tutuň.

**العربية**

يسأل خيار البوابة «هل يوجد تسجيل لبصماتك في نظام إدارة الهجرة؟» عمّا إذا كانت بصماتك مسجلة مسبقاً لدى إدارة الهجرة. عند اختيار «نعم»، يجب إدخال رمز البصمة الظاهر في نموذج طلب الإقامة من e-İkamet. وعند اختيار «لا»، لا تسمح البوابة بالمتابعة؛ وقبل المتابعة يجب زيارة مكتب الطلاب الدوليين في الجامعة لإجراء البصمة. وفي طلبات الانتقال، يؤدي وجود تسجيل بصمة ورمز صالح إلى طلب مستند UETS أيضاً. إذا تعذر عليك العثور على الرمز أو كنت غير متأكد، تواصل مع المكتب عبر نموذج الأسئلة.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 10. Gizlilik / KVKK (`privacy`)

**Türkçe**

Veri sorumlusu İstanbul Topkapı Üniversitesi’dir. Kimlik, iletişim, eğitim ve belge bilgileriniz yalnızca başvurunuzu tamamlamak ve değerlendirmek, durumunu göstermek, eksik veya yenilenecek belgeleri bildirmek ve yüklemelerinizi almak amacıyla (soru formunda ise yalnızca sorunuzu yanıtlamak için) işlenir. Bilgilere yetkili üniversite personeli erişir; yasal zorunluluk hâlinde yetkili kurumlarla paylaşılabilir. Veriler mevzuatın gerektirdiği süre boyunca korunur. KVKK talepleriniz için kisiselverilerim@topkapi.edu.tr adresine yazabilir, resmî metne ana sayfadan ulaşabilirsiniz.

**English**

The data controller is İstanbul Topkapı Üniversitesi. Your identity, contact, education, and document details are processed only to complete and review your application, show its status, notify you about missing or replacement documents, and receive uploads (and for the question form, only to answer your question). Authorized university staff can access this data, and it may be shared with competent authorities when required by law. Data is kept for the legally required period and protected from unauthorized access. For KVKK data requests, write to kisiselverilerim@topkapi.edu.tr; the official notice is linked on the home page.

**Русский**

Оператор данных — İstanbul Topkapı Üniversitesi. Ваши данные о личности, контактах, обучении и документах обрабатываются только для подачи и проверки заявки, показа статуса, уведомлений о недостающих или заменяемых документах и приёма файлов (а в форме вопросов — только для ответа). Доступ имеют уполномоченные сотрудники; передача госорганам возможна лишь по требованию закона. Данные хранятся в установленный законом срок и защищаются от несанкционированного доступа. Обращения по защите данных (KVKK): kisiselverilerim@topkapi.edu.tr; полный текст есть на главной странице.

**Türkmençe**

Maglumatlar üçin jogapkär edara İstanbul Topkapı Üniversitesi-dir. Şahsyýet, aragatnaşyk, bilim we resminama maglumatlaryňyz diňe arzany doldurmak, barlamak, ýagdaýyny görkezmek, ýetmeýän ýa-da täzelenmeli resminamalary habar bermek we faýllary kabul etmek üçin (sorag formasynda bolsa diňe soragyňyza jogap bermek üçin) ulanylýar. Maglumatlara ygtyýarly işgärler girip biler; kanun talap etse degişli edaralara berlip bilner. Maglumatlar kanuny möhletde goralyp saklanýar. KVKK ýüz tutmalary üçin: kisiselverilerim@topkapi.edu.tr; resmi tekst baş sahypadadyr.

**العربية**

الجهة المسؤولة عن البيانات هي İstanbul Topkapı Üniversitesi. تُعالج بيانات الهوية والاتصال والتعليم والمستندات فقط لاستكمال طلبك ومراجعته وعرض حالته وإبلاغك بالمستندات الناقصة أو البديلة واستلام الملفات (وفي نموذج الأسئلة للرد على سؤالك فقط). يطّلع عليها الموظفون المخولون فقط، وقد تُشارك مع الجهات المختصة إذا أوجب القانون ذلك، وتُحفظ محمية للمدة القانونية. لطلبات حماية البيانات (KVKK): kisiselverilerim@topkapi.edu.tr، والنص الرسمي متاح في الصفحة الرئيسية.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 11. Harç ve randevu (`fees_and_appointment`)

**Türkçe**

Bu portal ödeme almaz ve Göç İdaresi randevusu oluşturmaz. Portal yalnızca belgelerinizi (ikamet izni harç belgesi/makbuzu dâhil) Uluslararası Öğrenci Ofisine iletmeniz ve incelemeyi takip etmeniz içindir. Resmî ikamet izni başvurusu e-İkamet sistemi üzerinden ayrı tamamlanır; e-İkamet formunuzdaki süreleri takip etmeniz gerekir. Portalda güncel harç tutarları, ödeme kanalları veya Göç İdaresi randevu takvimi yayımlanmamaktadır; bu konulardaki sorularınızı ana sayfadaki soru formuyla ofise iletebilirsiniz, ofis size dönüş yapacaktır.

**English**

This portal does not take payments and does not book Migration Authority (Göç İdaresi) appointments. It is only for submitting your documents (including your residence permit fee receipt) to the International Student Office and tracking office review. The official residence permit application is completed separately in the e-İkamet system, and you must follow the deadlines on your e-İkamet form. Current fee amounts, payment methods, and appointment scheduling are not published on this portal; please send those questions through the question form below and the office will answer.

**Русский**

Этот портал не принимает оплату и не записывает на приём в Миграционное управление (Göç İdaresi). Он предназначен только для передачи документов (включая квитанцию об оплате сбора ВНЖ) в Международный студенческий офис и отслеживания проверки. Официальная заявка отдельно оформляется в системе e-İkamet; соблюдайте сроки из вашей формы e-İkamet. Размеры сборов, способы оплаты и порядок записи на приём на портале не указаны — задайте эти вопросы через форму вопросов ниже, и офис ответит вам.

**Türkmençe**

Bu portal töleg almaýar we Migrasiýa edarasy (Göç İdaresi) üçin duşuşyk (randewu) bellemeýär. Portal diňe resminamalaryňyzy (ýaşaýyş rugsady töleg resminamasyny hem goşmak bilen) Halkara talyplar ofisine ibermek we barlagy yzarlamak üçindir. Resmi ýaşaýyş rugsady arzasy e-İkamet ulgamynda aýratyn tamamlanýar; e-İkamet formasyndaky möhletleri berjaý ediň. Häzirki töleg mukdary, töleg usuly ýa-da randewu barada maglumatlar portalda ýok; bu soraglary baş sahypadaky sorag formasyndan iberiň, ofis size jogap berer.

**العربية**

لا تستقبل هذه البوابة أي مدفوعات ولا تحجز مواعيد إدارة الهجرة (Göç İdaresi). البوابة مخصصة فقط لرفع مستنداتك (بما في ذلك إيصال رسوم تصريح الإقامة) إلى مكتب الطلاب الدوليين ومتابعة المراجعة. يُستكمل طلب الإقامة الرسمي بشكل منفصل في نظام e-İkamet، مع الالتزام بالمواعيد الواردة في استمارة e-İkamet. لا تُنشر مبالغ الرسوم الحالية أو طرق الدفع أو تفاصيل المواعيد في البوابة؛ أرسل استفسارك عبر نموذج الأسئلة أدناه وسيرد عليك المكتب.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 12. Ofis çalışma saatleri (ONAYLI) (`office_hours`)

**Türkçe**

Uluslararası Öğrenci Ofisi hafta içi 09:00–18:00 saatleri arasında açıktır. Sorularınızı ana sayfadaki soru formundan da iletebilirsiniz. Bu saatler dışında da WhatsApp veya e-posta üzerinden yazabilirsiniz.

**English**

The International Student Office is open on weekdays, 09:00–18:00. You can also send your questions using the question form on the home page. Outside these hours, you can still write via WhatsApp or e-mail.

**Русский**

Международный студенческий офис открыт по будням 09:00–18:00. Вы также можете отправить свои вопросы через форму вопросов на главной странице. Вне этих часов вы также можете написать в WhatsApp или на e-mail.

**Türkmençe**

Halkara talyplar ofisi hepde içi 09:00–18:00 sagatlar aralygynda açykdyr. Soraglaryňyzy baş sahypadaky sorag formasy arkaly hem iberip bilersiňiz. Bu sagatlardan daşary hem WhatsApp ýa-da e-poçta arkaly ýazyp bilersiňiz.

**العربية**

مكتب الطلاب الدوليين مفتوح أيام الأسبوع من الساعة 09:00–18:00. كما يمكنك إرسال أسئلتك عبر نموذج الأسئلة في الصفحة الرئيسية. وخارج هذه الساعات يمكنك أيضاً المراسلة عبر WhatsApp أو البريد الإلكتروني.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 13. Öğrenci kartı (`student_card`)

**Türkçe**

Üniversite öğrenci kimlik kartı işlemleri (basım, kayıp, yenileme) Uluslararası Öğrenci Ofisi tarafından yapılmaz; bu konuda üniversitenin Bilgi İşlem Daire Başkanlığına başvurmanız gerekir. Bu portal yalnızca öğrenci ikamet izni belgelerinin iletilmesi ve başvuru takibi içindir.

**English**

University student ID card procedures (printing, loss, renewal) are not handled by the International Student Office; for this matter, you need to apply to the university’s IT Department (Bilgi İşlem Daire Başkanlığı). This portal is only for submitting student residence permit documents and tracking applications.

**Русский**

Операции с университетской студенческой картой (печать, утеря, перевыпуск) не выполняются Международным студенческим офисом; по этому вопросу вам необходимо обратиться в Управление информационных технологий университета (Bilgi İşlem Daire Başkanlığı). Этот портал предназначен только для передачи документов на студенческий ВНЖ и отслеживания заявок.

**Türkmençe**

Uniwersitet talyp şahadatnama kartynyň işleri (çap etmek, ýitirmek, täzelemek) Halkara talyplar ofisi tarapyndan ýerine ýetirilmeýär; bu meselede uniwersitetiň Maglumat tehnologiýalary müdirligine (Bilgi İşlem Daire Başkanlığı) ýüz tutmagyňyz gerek. Bu portal diňe talyp ýaşaýyş rugsady resminamalaryny ibermek we arzany yzarlamak üçindir.

**العربية**

لا تتم إجراءات بطاقة الطالب الجامعية (الطباعة، الفقدان، التجديد) من قِبل مكتب الطلاب الدوليين؛ ويجب مراجعة إدارة تقنية المعلومات بالجامعة (Bilgi İşlem Daire Başkanlığı) بهذا الخصوص. هذه البوابة مخصصة فقط لإرسال مستندات تصريح إقامة الطالب ومتابعة الطلب.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

## 14. İletişim (`contact`)

**Türkçe**

Genel sorularınız için öncelikle ana sayfadaki soru formunu kullanabilirsiniz. Uluslararası Öğrenci Ofisine hafta içi 09:00–18:00 saatleri arasında WhatsApp üzerinden 0535 455 94 09 (+90 535 455 94 09) numarasına yalnızca mesaj yazarak (aramayın, sesli arama yapılmaz) veya goc.topkapiuni@gmail.com e-posta adresinden ulaşabilirsiniz. Yalnızca KVKK kapsamındaki kişisel veri talepleri için kisiselverilerim@topkapi.edu.tr adresi kullanılır.

**English**

For general questions, the question form on the home page remains the preferred channel to reach the office. You can also contact the International Student Office (weekdays 09:00–18:00) by WhatsApp message only at +90 535 455 94 09 (please write on WhatsApp, do not call) or by e-mail at goc.topkapiuni@gmail.com. For personal data protection (KVKK) requests only, write to kisiselverilerim@topkapi.edu.tr.

**Русский**

По общим вопросам предпочтительно использовать форму вопросов на главной странице — она также передаёт обращение в офис. Кроме того, связаться с Международным студенческим офисом (по будням 09:00–18:00) можно только сообщением в WhatsApp на номер +90 535 455 94 09 (пишите в WhatsApp, не звоните) или по e-mail goc.topkapiuni@gmail.com. Только для обращений по защите персональных данных (KVKK) предназначен адрес kisiselverilerim@topkapi.edu.tr.

**Türkmençe**

Umumy soraglar üçin ilki bilen baş sahypadaky sorag formasyny ulanmak maslahat berilýär; ol hem ofise ýetýär. Halkara talyplar ofisi bilen (hepde içi 09:00–18:00) WhatsApp arkaly +90 535 455 94 09 belgisine diňe hat ýazyp (jaň etmäň, bu belgi jaň üçin däldir) ýa-da goc.topkapiuni@gmail.com e-poçtasy arkaly habarlaşyp bilersiňiz. Diňe şahsy maglumatlary goramak (KVKK) ýüz tutmalary üçin kisiselverilerim@topkapi.edu.tr salgysy niýetlenendir.

**العربية**

للأسئلة العامة، يظل نموذج الأسئلة في الصفحة الرئيسية القناة المفضلة للتواصل مع المكتب. كما يمكنكم التواصل مع مكتب الطلاب الدوليين (أيام الأسبوع 09:00–18:00) عبر رسالة WhatsApp فقط على الرقم +90 535 455 94 09 (يرجى الكتابة عبر WhatsApp وعدم الاتصال هاتفياً) أو عبر البريد الإلكتروني goc.topkapiuni@gmail.com. ولطلبات حماية البيانات الشخصية (KVKK) فقط، يُستخدم البريد kisiselverilerim@topkapi.edu.tr.

**Ofis kararı:** [ ] Onay  [ ] Düzeltme gerekli → ........

---

