// Başvuru numarası hatırlatma akışı ve spam klasörü uyarısı için beş dilli metinler.
export const RECOVERY_MESSAGES = Object.freeze({
    tr: Object.freeze({
        recoveryToggleAction: 'Başvuru Numaramı Unuttum',
        recoveryFormHeading: 'Başvuru numarası hatırlatma',
        recoveryFormIntro: 'Öğrenci numaranızı girin. Aktif bir başvurunuz varsa, başvuru numaranız başvuru yaparken girdiğiniz e-posta adresine gönderilecektir.',
        recoveryEmailLanguageLabel: 'E-posta dili',
        recoveryCurrentLanguageName: 'Türkçe',
        recoveryLanguageSwitchHint: 'Farklı bir dil için sayfanın üstündeki dil seçimini değiştirebilirsiniz.',
        recoveryEmailSubmit: 'E-posta ile Başvuru Numaramı Al',
        recoverySubmitting: 'Gönderiliyor…',
        recoveryConfirmation: 'Aktif bir başvurunuz varsa, başvuru numaranız başvuru yaparken girdiğiniz e-posta adresine gönderildi.',
        recoverySpamWarning: 'E-posta birkaç dakika içinde gelmezse gereksiz (spam) klasörünü kontrol edin',
        recoveryNetworkRetry: 'Bağlantı kurulamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.',
        recoveryTelegramAction: 'Telegram ile Başvuru Numaramı Al'
    }),
    en: Object.freeze({
        recoveryToggleAction: 'I Forgot My Application Number',
        recoveryFormHeading: 'Application number reminder',
        recoveryFormIntro: 'Enter your student number. If you have an active application, your application number will be sent to the email address you entered when applying.',
        recoveryEmailLanguageLabel: 'Email language',
        recoveryCurrentLanguageName: 'English',
        recoveryLanguageSwitchHint: 'You can change the language using the language selector at the top of the page.',
        recoveryEmailSubmit: 'Get My Application Number by Email',
        recoverySubmitting: 'Sending…',
        recoveryConfirmation: 'If you have an active application, your application number has been sent to the email address you entered when applying.',
        recoverySpamWarning: 'If the email does not arrive within a few minutes, please check your junk (spam) folder.',
        recoveryNetworkRetry: 'Could not connect to the service. Please check your connection and try again.',
        recoveryTelegramAction: 'Get My Application Number by Telegram'
    }),
    ru: Object.freeze({
        recoveryToggleAction: 'Я забыл(а) номер заявки',
        recoveryFormHeading: 'Напоминание номера заявки',
        recoveryFormIntro: 'Введите номер студента. Если у вас есть активная заявка, номер вашей заявки будет отправлен на адрес электронной почты, который вы указали при подаче заявки.',
        recoveryEmailLanguageLabel: 'Язык письма',
        recoveryCurrentLanguageName: 'Русский',
        recoveryLanguageSwitchHint: 'Вы можете изменить язык в переключателе языка вверху страницы.',
        recoveryEmailSubmit: 'Получить номер заявки по e-mail',
        recoverySubmitting: 'Отправка…',
        recoveryConfirmation: 'Если у вас есть активная заявка, номер вашей заявки отправлен на адрес электронной почты, который вы указали при подаче заявки.',
        recoverySpamWarning: 'Если письмо не придёт в течение нескольких минут, проверьте папку «Спам» (нежелательная почта).',
        recoveryNetworkRetry: 'Не удалось установить соединение. Проверьте подключение и повторите попытку.',
        recoveryTelegramAction: 'Получить номер заявки в Telegram'
    }),
    tk: Object.freeze({
        recoveryToggleAction: 'Arza belgimi unutdym',
        recoveryFormHeading: 'Arza belgisini almak',
        recoveryFormIntro: 'Talyp belgiňizi giriziň. Işjeň arzaňyz bar bolsa, arza belgiňiz arza tabşyran wagtyňyz girizen e-poçta salgyňyza iberiler.',
        recoveryEmailLanguageLabel: 'E-poçta dili',
        recoveryCurrentLanguageName: 'Türkmençe',
        recoveryLanguageSwitchHint: 'Dili sahypanyň ýokarsyndaky dil saýlawyndan üýtgedip bilersiňiz.',
        recoveryEmailSubmit: 'Arza belgimi e-poçta bilen almak',
        recoverySubmitting: 'Iberilýär…',
        recoveryConfirmation: 'Işjeň arzaňyz bar bolsa, arza belgiňiz arza tabşyran wagtyňyz girizen e-poçta salgyňyza iberildi.',
        recoverySpamWarning: 'E-poçta birnäçe minudyň içinde gelmese, gereksiz (spam) bukjany barlaň.',
        recoveryNetworkRetry: 'Baglanyşyk gurup bolmady. Birikmäňizi barlap, täzeden synanyşyň.',
        recoveryTelegramAction: 'Arza belgimi Telegram bilen almak'
    }),
    ar: Object.freeze({
        recoveryToggleAction: 'نسيت رقم الطلب',
        recoveryFormHeading: 'استرجاع رقم الطلب',
        recoveryFormIntro: 'أدخل رقم الطالب الخاص بك. إذا كان لديك طلب نشط، فسيتم إرسال رقم طلبك إلى عنوان البريد الإلكتروني الذي أدخلته عند تقديم الطلب.',
        recoveryEmailLanguageLabel: 'لغة البريد الإلكتروني',
        recoveryCurrentLanguageName: 'العربية',
        recoveryLanguageSwitchHint: 'يمكنك تغيير اللغة من خلال محدد اللغة في أعلى الصفحة.',
        recoveryEmailSubmit: 'احصل على رقم طلبي عبر البريد الإلكتروني',
        recoverySubmitting: 'جارٍ الإرسال…',
        recoveryConfirmation: 'إذا كان لديك طلب نشط، فقد تم إرسال رقم طلبك إلى عنوان البريد الإلكتروني الذي أدخلته عند تقديم الطلب.',
        recoverySpamWarning: 'إذا لم يصلك البريد الإلكتروني خلال بضع دقائق، يرجى التحقق من مجلد الرسائل غير المرغوب فيها (السبام).',
        recoveryNetworkRetry: 'تعذر الاتصال بالخدمة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.',
        recoveryTelegramAction: 'احصل على رقم طلبي عبر تيليجرام'
    })
});
