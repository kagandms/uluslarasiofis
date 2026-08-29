    function extractPage2FromCoordinates(words) {
        // Eski bilgilerin kalmaması için önce alanları temizle
        const adresField = document.getElementById('field-adres');
        const telField = document.getElementById('field-tel');
        const mailField = document.getElementById('field-mail');
        if (adresField) {
            adresField.value = '';
            adresField.classList.remove('field-filled');
        }
        if (telField) {
            telField.value = '';
            telField.classList.remove('field-filled');
        }
        if (mailField) {
            mailField.value = '';
            mailField.classList.remove('field-filled');
        }

        if (!words || words.length === 0) return;
        
        const sameRow = (w1, w2) => {
            const h1 = w1.bbox.y1 - w1.bbox.y0;
            const h2 = w2.bbox.y1 - w2.bbox.y0;
            const tolerance = Math.max(h1, h2) * 0.6;
            const center1 = (w1.bbox.y0 + w1.bbox.y1) / 2;
            const center2 = (w2.bbox.y0 + w2.bbox.y1) / 2;
            return Math.abs(center1 - center2) < tolerance;
        };

        // Adım 1: Sınırları belirle (Min Y ve Max Y)
        let minY = 0;
        let maxY = 999999;
        
        for (const w of words) {
            // "KALACAĞI" kelimesi hedef bölümün başlığındadır
            if (/KALACA[GĞ]I/i.test(w.text) && w.bbox.y0 > minY) {
                minY = w.bbox.y1;
                console.log('[Page2] Min Y sınırı bulundu (KALACAĞI):', minY);
            }
            // "ÖĞRENİM" kelimesi sonraki bölümün başlığındadır
            else if (/[OÖ][GĞ]REN[Iİ]M/i.test(w.text) && w.bbox.y0 > minY) {
                maxY = w.bbox.y0;
                console.log('[Page2] Max Y sınırı bulundu (ÖĞRENİM):', maxY);
                break;
            }
        }

        console.log(`[Page2] Arama bölgesi: Y:${minY} - Y:${maxY}`);

        // Bu bölgedeki kelimeler
        const sectionWords = words.filter(w => w.bbox.y0 >= minY && w.bbox.y1 <= maxY);
        const imageWidth = Math.max(...words.map(w => w.bbox.x1), 1);
        const midpoint = imageWidth * 0.50;
        
        let foundAdres = '';
        let foundTel = '';

        // --- ADRES (Çoklu satır desteği) ---
        let adresLabelY = -1;
        let nextLabelY = maxY; // default to end of section
        let rightColumnX = midpoint; // Sağ sütun X sınırı (Telefon vs. adresin içine girmesin diye)
        
        for (const w of sectionWords) {
            if (/^Adres|Address$/i.test(w.text)) {
                if (adresLabelY === -1 || w.bbox.y0 < adresLabelY) {
                    adresLabelY = w.bbox.y0;
                }
            } else if (adresLabelY !== -1 && /^Ta[sŞş][iıI]nma|Moving$/i.test(w.text) && w.bbox.y0 > adresLabelY) {
                if (w.bbox.y0 < nextLabelY) nextLabelY = w.bbox.y0;
            }
            
            // Eğer "Telefon" veya "Phone" kelimesi varsa, Adres bölgesinin sağ sınırını buna göre daralt
            if (/^(?:Telefon|Phone|Tel|E\s*Posta|E-mail)$/i.test(w.text)) {
                if (w.bbox.x0 < rightColumnX) rightColumnX = w.bbox.x0;
            }
        }

        if (adresLabelY !== -1) {
            const adresWords = sectionWords.filter(w => 
                w.bbox.y0 >= adresLabelY - 5 && 
                w.bbox.y1 <= nextLabelY + 5 &&
                w.bbox.x0 < rightColumnX - 5 && // Sağ sütundaki Telefon/Phone etiketleri elenir
                w.bbox.x0 > imageWidth * 0.22 // Sadece değer sütununu al (sol sütundaki etiket artıkları "Ba" vs elenir)
            ).sort((a, b) => {
                if (Math.abs(a.bbox.y0 - b.bbox.y0) > 15) return a.bbox.y0 - b.bbox.y0;
                return a.bbox.x0 - b.bbox.x0;
            });
            
            if (adresWords.length > 0) {
                foundAdres = adresWords.map(aw => aw.text).join(' ').trim();
                // Adresin başındaki "Ba", "İSTANBUL", "," gibi OCR kalıntılarını agresif temizle
                let cleanAdres = foundAdres.replace(/^(?:Ba\s*)?(?:[Iİ]STANBUL\s*)?[\s,]*/i, '').trim();
                // En başa her zaman sabit "İSTANBUL, " ekle
                foundAdres = "İSTANBUL, " + cleanAdres;
                console.log('[Page2] Adres bulundu:', foundAdres);
            }
        }

        // --- TELEFON 1 ---
        // Telefon hücrelerinde Y hizası ("Telefon 1" vs "Phone 1") OCR'ı yanıltabilir. 
        // Bu yüzden bölümün sağ tarafındaki (midpoint'ten büyük) 10 haneli tek numarayı arıyoruz.
        for (const w of sectionWords) {
            if (w.bbox.x0 > midpoint) {
                const digits = w.text.replace(/\D/g, '');
                if (digits.length >= 10) {
                    const last10 = digits.slice(-10);
                    // Başka alan (örn: T.C. kimlik) araya karışmasın diye 5 ile başlıyorsa al (veya standart 10 hane)
                    if (last10.startsWith('5')) {
                        foundTel = `0${last10.slice(0,3)} ${last10.slice(3,6)} ${last10.slice(6,8)} ${last10.slice(8,10)}`;
                        console.log('[Page2] Telefon bulundu (sağ sütun rakam taraması):', foundTel);
                        break;
                    }
                }
            }
        }

        if (foundAdres) {
            const adresField = document.getElementById('field-adres');
            if (adresField) {
                adresField.value = foundAdres.substring(0, 100);
                adresField.classList.add('field-filled');
            }
        }

        if (foundTel) {
            const telField = document.getElementById('field-tel');
            if (telField) {
                telField.value = foundTel;
                telField.classList.add('field-filled');
            }
        }

        // --- E-POSTA ---
        // "E Posta" / "E-mail" / "E-Mail" etiketini bul, ardından aynı satırda veya hemen altında @ içeren metni al
        let foundMail = '';
        let epostaLabelY = -1;
        let epostaLabelX = -1;

        for (let i = 0; i < sectionWords.length; i++) {
            const w = sectionWords[i];
            // "E Posta", "E-Posta", "E-mail", "E-Mail", "Email" etiketlerini tanı
            const isEpostaLabel = /^E[-\s]?Posta$/i.test(w.text) || /^E[-\s]?mail$/i.test(w.text);
            // OCR bazen "E" ve "Posta"yı ayrı kelimeler olarak verir
            const isESplit = /^E$/i.test(w.text) && i + 1 < sectionWords.length && 
                /^Posta$/i.test(sectionWords[i + 1].text) && sameRow(w, sectionWords[i + 1]);
            
            if (isEpostaLabel || isESplit) {
                if (w.bbox.x0 > midpoint * 0.7) { // Sağ taraftaki etiketi al
                    epostaLabelY = w.bbox.y0;
                    epostaLabelX = w.bbox.x0;
                    console.log('[Page2] E-Posta etiketi bulundu:', w.text, 'Y:', epostaLabelY);
                }
            }
        }

        if (epostaLabelY !== -1) {
            // Etiketin yüksekliğinin ~3 katı kadar aşağıya bak
            const searchRangeY = epostaLabelY + 80;
            
            // Önce tüm bölgede @ içeren kelimeleri ara
            const mailCandidates = sectionWords.filter(w =>
                w.text.includes('@') &&
                w.bbox.y0 >= epostaLabelY - 15 &&
                w.bbox.y0 <= searchRangeY
            );

            if (mailCandidates.length > 0) {
                // @ içeren kelimeyi bulduk — bu direkt e-posta adresi olabilir
                foundMail = mailCandidates[0].text.trim();
                console.log('[Page2] E-Posta bulundu (@ içeren kelime):', foundMail);
            } else {
                // OCR bazen e-posta adresini parçalara ayırır (ör: "GURBANNAZAR" "@en-gmail-bgd" ".com")
                // Etiketin sağındaki ve altındaki kelimeleri birleştir
                const nearbyWords = sectionWords.filter(w =>
                    w.bbox.y0 >= epostaLabelY - 10 &&
                    w.bbox.y0 <= searchRangeY &&
                    w.bbox.x0 >= epostaLabelX - 20
                ).sort((a, b) => {
                    if (Math.abs(a.bbox.y0 - b.bbox.y0) > 15) return a.bbox.y0 - b.bbox.y0;
                    return a.bbox.x0 - b.bbox.x0;
                });

                // Etiket kelimelerini atla, geri kalanları birleştir
                const valueParts = nearbyWords
                    .filter(w => !/^(?:E[-\s]?Posta|E[-\s]?mail|E[-\s]?Mail|Phone|Telefon)$/i.test(w.text))
                    .map(w => w.text);

                const combined = valueParts.join('');
                if (combined.includes('@')) {
                    foundMail = combined.trim();
                    console.log('[Page2] E-Posta bulundu (birleştirilmiş):', foundMail);
                }
            }
        }

        // Eğer etiket bulunamazsa, fallback: tüm bölgede @ içeren kelime ara
        if (!foundMail) {
            for (const w of sectionWords) {
                if (w.text.includes('@') && w.text.includes('.')) {
                    foundMail = w.text.trim();
                    console.log('[Page2] E-Posta bulundu (fallback @ taraması):', foundMail);
                    break;
                }
            }
        }

        // E-posta temizliği: gereksiz boşlukları kaldır, küçük harfe dönüştür
        if (foundMail) {
            foundMail = foundMail.replace(/\s+/g, '').toLowerCase();
            // Basit doğrulama: @ ve . içermeli
            if (foundMail.includes('@') && foundMail.includes('.')) {
                const mailField = document.getElementById('field-mail');
                if (mailField) {
                    mailField.value = foundMail;
                    mailField.classList.add('field-filled');
                    console.log('[Page2] E-Posta form alanına yazıldı:', foundMail);
                }
            }
        }
    }
