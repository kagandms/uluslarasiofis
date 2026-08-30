    export function extractFromCoordinates(words, extracted) {
        if (!words || words.length === 0) return;
        
        // Yardımcı: iki kelime aynı hücrede/satırda mı?
        const sameRow = (label, word) => {
            const labelH = label.bbox.y1 - label.bbox.y0;
            const wordCenter = (word.bbox.y0 + word.bbox.y1) / 2;
            
            // İngilizce etiketler hücrenin altında, Türkçe etiketler üstündedir.
            // Değerler ise genellikle bu ikisinin ortasındadır.
            // Bu yüzden Y toleransını etiketin diline göre asimetrik veriyoruz.
            const isEnglishLabel = /^(surname|name|nationality|number|appointment|registration)$/i.test(label.text);
            
            let cellY0 = label.bbox.y0 - labelH * 3.0;
            let cellY1 = label.bbox.y1 + labelH * 3.0;
            
            return wordCenter >= cellY0 && wordCenter <= cellY1;
        };
        
        // Form etiketleri — bunları değer olarak almayacağız (OCR hataları dahil)
        // Form etiketlerini OCR hatalarıyla birlikte tanıma listesi
        const coordFormLabels = /^(di[gğ]er|other|citizenship|uyr[uü][gğ]?[uü]?[a-z]*|nationality|nationali|nationally|nation|[dt][oö][gğ][uü]m[a-z]*|born|bom|birth|[öo]nceki|previous|surname|surmame|surnane|sumame|name|nane|mame|father|mother|baba|anne|cinsiyet[iİ]?|sex|gender|medeni|marital|uets|yeri|[üu]lkesi|country|kimlik|id|no|foreigner|place|foreign|date|tarihi|hali|status|biyo(?:metrik)?|number|document|belge(?:si)?|kay[ıi]t|registration|[iİ]kamet|ba[sş]vuru|randevu|talep|seyahat|travel|[iİıI]nformation|type|t[üu]r[üu]|foto[gğ]raf|numara|soyad[ıi]?|ad[ıi]?|ki[sş]i|personal|bilgi|in|of|for|the|that|veren|makam[ıi]?|issuing|authority|adres[iİ]?|address)$/i;
        
        // Resmin tahmini genişliği (words'den hesapla)
        const imageWidth = Math.max(...words.map(w => w.bbox.x1), 1);
        // Sol sütun değerleri kabaca ilk %50'de olur
        const midpoint = imageWidth * 0.50;
        
        // OCR hatalarına karşı daha esnek kontrol (grabName mantığı ile aynı)
        const cleanAndFixWord = (text) => {
            const cleanedWord = text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü'\-]/g, '');
            if (cleanedWord.length < 2) return null;
            return text.toLocaleUpperCase('tr-TR')
                .replace(/[0]/g, 'O').replace(/[1]/g, 'I').replace(/[3]/g, 'E')
                .replace(/[4]/g, 'A').replace(/[5]/g, 'S').replace(/[8]/g, 'B')
                .replace(/[^A-ZÇĞİÖŞÜ'\-]/g, '');
        };

        // Bilinen ülke adları — ad/soyad alanına bulaşmasını önlemek için
        const knownCountryNames = /^(T[ÜU]RKMEN[İI]STAN|[ÖO]ZBEK[İI]STAN|KIRGIZ[İI]STAN|KAZAK[İI]STAN|TAC[İI]K[İI]STAN|AZERBAYCAN|G[ÜU]RC[İI]STAN|ERMENISTAN|AFGAN[İI]STAN|PAK[İI]STAN|[İI]RAN|IRAK|RUSYA|FEDERASYONU|S[UÜ]R[İI]YE|MISIR|LIBYA|TUNUS|FAS|SOMALI|YEMEN|L[İI]BNAN|FILISTIN|BANGLADESH|HINDISTAN|NEPAL|MYANMAR|CHINA|IRAN|IRAQ|SYRIA|EGYPT|INDIA|RUSSIA|SMST|MIA)$/i;

        // Yardımcı: etiket kelimesinin sağında (aynı satır) VEYA hemen altında (aynı sütun) olan değer kelimeleri bul
        // maxX: opsiyonel X sınırı — sol kolon etiketleri için sağ kolona taşmayı önler
        const findValueWordsForLabel = (labelWord, maxX = null, skipCountryFilter = false) => {
            // Etiket sol kolondaysa (midpoint'in solunda), maxX'i otomatik hesapla
            const effectiveMaxX = maxX !== null ? maxX : (labelWord.bbox.x0 < midpoint ? midpoint : null);
            
            const validWords = words
                .filter(w => {
                    // X sınırı kontrolü: kelime sağ kolondan mı geliyor?
                    if (effectiveMaxX !== null && w.bbox.x0 >= effectiveMaxX) return false;
                    
                    // Aynı satırda sağda mı?
                    const isRight = sameRow(labelWord, w) && w.bbox.x0 > labelWord.bbox.x1;
                    // Veya aynı sütunda altta mı? (Sıkı X toleransı ile alt satıra taşan uzun veriler için)
                    const labelCenterX = (labelWord.bbox.x0 + labelWord.bbox.x1) / 2;
                    const wCenterX = (w.bbox.x0 + w.bbox.x1) / 2;
                    const isBelow = w.bbox.y0 > labelWord.bbox.y0 + 5 && Math.abs(wCenterX - labelCenterX) < 30;
                    
                    if (!isRight && !isBelow) return false;
                    if (coordFormLabels.test(w.text)) return false; // Form etiketlerini atla
                    
                    // Ülke adı filtresi — ad/soyad gibi alanlara bulaşmasını önler (uyruk için devre dışı)
                    if (!skipCountryFilter && knownCountryNames.test(w.text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, ''))) return false;
                    
                    // OCR Halüsinasyon filtresi
                    const labelH = labelWord.bbox.y1 - labelWord.bbox.y0;
                    const wH = w.bbox.y1 - w.bbox.y0;
                    if (wH > labelH * 3.5 || wH < labelH * 0.3) return false;
                    
                    return cleanAndFixWord(w.text) !== null;
                })
                .sort((a, b) => {
                    // Etikete Y ekseninde (dikeyde) en yakın olan kelimeyi bul
                    const aDist = Math.abs(a.bbox.y0 - labelWord.bbox.y0);
                    const bDist = Math.abs(b.bbox.y0 - labelWord.bbox.y0);
                    const labelH = labelWord.bbox.y1 - labelWord.bbox.y0;
                    
                    if (Math.abs(aDist - bDist) < labelH * 0.6) {
                        return a.bbox.x0 - b.bbox.x0; // Y ekseninde çok yakınlarsa X'e göre sırala
                    }
                    return aDist - bDist;
                });
            
            if (validWords.length === 0) return [];
            
            // İlk geçerli kelimeyi ve onunla aynı satırdaki diğer geçerli kelimeleri al
            const result = [cleanAndFixWord(validWords[0].text)];
            const firstY = validWords[0].bbox.y0;
            const firstH = validWords[0].bbox.y1 - validWords[0].bbox.y0;
            
            for (let i = 1; i < validWords.length; i++) {
                if (Math.abs(validWords[i].bbox.y0 - firstY) < firstH * 0.6) {
                    result.push(cleanAndFixWord(validWords[i].text));
                } else {
                    break;
                }
            }
            
            return result.slice(0, 3); // En fazla 3 kelime al
        };
        
        
        // --- SOYADI ---
        if (!extracted.soyadi) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/\b(Soyad[ıiIİ]?|Surname)\b/i.test(w.text)) continue;
                
                // Kendi içinde içeriyorsa atla
                if (/Önceki|Previous/i.test(w.text)) continue;
                
                // Önceki kelimelere bak (Önceki Soyadı)
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/Önceki|Previous/i.test(words[j].text) && sameRow(words[j], w)) {
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
                
                const values = findValueWordsForLabel(w);
                if (values.length > 0) {
                    extracted.soyadi = values.join(' ');
                    console.log('[Koordinat] Soyadı bulundu:', extracted.soyadi);
                    break;
                }
            }
        }
        
        // --- ADI ---
        if (!extracted.adi) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/\b(Ad[ıiIİ]?|Name)\b/i.test(w.text)) continue;
                
                // Kendi içinde içeriyorsa atla
                if (/(Soyad|Baba|Anne|Father|Mother|Previous|[öo]nceki)/i.test(w.text)) continue;
                
                // Önceki kelimelere bak (Baba Adı, Anne Adı)
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/(Soyad|Baba|Anne|Father|Mother|Previous|[öo]nceki)/i.test(words[j].text) && sameRow(words[j], w)) {
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
                
                const values = findValueWordsForLabel(w);
                if (values.length > 0) {
                    extracted.adi = values.join(' ');
                    console.log('[Koordinat] Adı bulundu:', extracted.adi);
                    break;
                }
            }
        }
        // --- UYRUĞU ---
        if (!extracted.uyrugu) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/Uyru[gğ]u|Nationality/i.test(w.text)) continue;
                if (/(Di[gğ]er|Other|Do[gğ]um|Born|Bom)/i.test(w.text)) continue;
                
                // Önceki kelimelere bakarak "Diğer Uyruğu" veya "Doğumdaki Uyruğu" ise atla
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/(Di[gğ]er|Other|Do[gğ]um|Born)/i.test(words[j].text)) {
                        if (Math.abs(words[j].bbox.y0 - w.bbox.y0) < (w.bbox.y1 - w.bbox.y0) * 1.5) {
                            skip = true;
                            break;
                        }
                    }
                }
                if (skip) continue;
                
                // Uyruğu sağ sütunda — midpoint kısıtlaması yok, ülke adı filtresi kapalı
                const values = findValueWordsForLabel(w, null, true);
                if (values.length > 0) {
                    const uniqueValues = [...new Set(values)];
                    extracted.uyrugu = uniqueValues.join(' ');
                    console.log('[Koordinat] Uyruğu bulundu:', extracted.uyrugu);
                    break;
                }
                
                // Fallback for coordinates: Look for known country name to the right
                if (!extracted.uyrugu) {
                    const rightWords = words.filter(ow => ow.bbox.x0 > w.bbox.x1 && Math.abs(ow.bbox.y0 - w.bbox.y0) < (w.bbox.y1 - w.bbox.y0) * 3);
                    for (const ow of rightWords) {
                        const cleanOW = ow.text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, '');
                        if (knownCountryNames.test(cleanOW)) {
                            extracted.uyrugu = ow.text;
                            break;
                        }
                    }
                    if (extracted.uyrugu) break;
                }
            }
            
            // Fallback: "Nationality" etiketinden de dene
            if (!extracted.uyrugu) {
                for (const w of words) {
                    if (!/^Nationality$/i.test(w.text)) continue;
                    // "Nationality in Born" satırını atla
                    const hasIn = words.some(other => 
                        /^in$/i.test(other.text) && sameRow(w, other) && other.bbox.x0 > w.bbox.x1
                    );
                    if (hasIn) continue;
                    
                    const values = findValueWordsForLabel(w, null, true);
                    if (values.length > 0) {
                        extracted.uyrugu = values.join(' ');
                        console.log('[Koordinat] Uyruğu (Nationality) bulundu:', extracted.uyrugu);
                        break;
                    }
                }
            }
        }

        // --- DOĞUM TARİHİ ---
        if (!extracted.dogumTarihi) {
            for (const w of words) {
                if (!/(Do[gğ]um|Birth)/i.test(w.text)) continue;
                
                // Sağ sütunda olduğundan emin olalım (Kayıt Tarihi solda karışmasın, esneklik için 0.30)
                if (w.bbox.x0 < imageWidth * 0.30) continue;

                // Kelimenin sağında, aynı hizada olan kelimeleri topla
                const dateWords = words.filter(other => 
                    sameRow(w, other) && 
                    other.bbox.x0 > w.bbox.x1
                ).sort((a, b) => a.bbox.x0 - b.bbox.x0);
                
                const dateStr = dateWords.map(dw => dw.text).join(' ');
                // OCR hatalarını düzelt (S->5, O->0, l/I->1, Z->2)
                const cleanDate = dateStr.replace(/[OoQq]/g, '0').replace(/[Ss\$]/g, '5').replace(/[lI|]/g, '1').replace(/[Zz]/g, '2');
                
                const match = cleanDate.match(/(3[01]|[12]\d|0?[1-9])\s*[/.\-\s]+\s*(1[0-2]|0?[1-9])\s*[/.\-\s]+\s*(\d{4})/);
                if (match) {
                    extracted.dogumTarihi = `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}.${match[3]}`;
                    console.log('[Koordinat] Doğum Tarihi bulundu:', extracted.dogumTarihi);
                    break;
                }
            }
        }
        
        // --- PASAPORT NO (Belge No) ---
        if (!extracted.pasaportNo) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                // "Belge", "Document", veya "Pasaport" etiketini ara
                if (!/\b(Belge|Document|Pasaport|Passport)\b/i.test(w.text)) continue;
                
                // "seyahat belgesi", "belge bedeli" gibi ilişkisiz bağlamları atla
                const nextWords = words.slice(i + 1, i + 4);
                const nearbyText = nextWords.map(nw => nw.text).join(' ');
                if (/bedel|makbuz|izni|seyahat|travel|receipt/i.test(nearbyText)) continue;
                
                // "No", "Number", "Numarası" kelimesi yakınında mı?
                const hasNoLabel = nextWords.some(nw => 
                    /^(No|Number|Numaras)/i.test(nw.text) && sameRow(w, nw)
                );
                // Etiketin kendisi "Belge" ise yakınında "No" olması gerekiyor
                if (/^Belge$/i.test(w.text) && !hasNoLabel) continue;
                
                // Etiketin sağında ve/veya altında alfanumerik pasaport numarası ara
                const passportCandidates = words.filter(pw => {
                    if (pw === w) return false;
                    // Form etiketlerini atla
                    if (coordFormLabels.test(pw.text)) return false;
                    // Ülke adlarını atla
                    if (knownCountryNames.test(pw.text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, ''))) return false;
                    
                    // Aynı satırda sağda mı?
                    const isRight = sameRow(w, pw) && pw.bbox.x0 > w.bbox.x1;
                    // Veya altında mı? (hücre yapısı yüzünden bir alt satırda olabilir)
                    const labelH = w.bbox.y1 - w.bbox.y0;
                    const isBelow = pw.bbox.y0 > w.bbox.y0 && pw.bbox.y0 < w.bbox.y1 + labelH * 3;
                    
                    if (!isRight && !isBelow) return false;
                    
                    // Pasaport numarası formatı: harf(ler) + rakamlar (ör: A2596273, P09986286)
                    const cleaned = pw.text.replace(/[\s\-]/g, '');
                    if (/^[A-Za-z]{1,2}\d{5,9}$/.test(cleaned)) return true;
                    // Sadece rakamlardan oluşan pasaport no (bazı ülkeler)
                    if (/^\d{7,10}$/.test(cleaned)) return true;
                    
                    return false;
                }).sort((a, b) => {
                    // Etikete en yakın olanı tercih et
                    const aDist = Math.abs(a.bbox.y0 - w.bbox.y0) + Math.abs(a.bbox.x0 - w.bbox.x1);
                    const bDist = Math.abs(b.bbox.y0 - w.bbox.y0) + Math.abs(b.bbox.x0 - w.bbox.x1);
                    return aDist - bDist;
                });
                
                if (passportCandidates.length > 0) {
                    let passNo = passportCandidates[0].text.replace(/[\s\-]/g, '').toUpperCase();
                    // OCR rakam düzeltmeleri (harf kısmını koru)
                    const letterPart = passNo.match(/^([A-Z]*)/)[0];
                    const digitPart = passNo.substring(letterPart.length);
                    passNo = letterPart + digitPart
                        .replace(/[Oo]/g, '0').replace(/[Ss]/g, '5')
                        .replace(/[Zz]/g, '2').replace(/[l]/g, '1');
                    
                    // GC ile başlayan barkod numarasını filtrele
                    if (!/^GC/i.test(passNo)) {
                        extracted.pasaportNo = passNo;
                        console.log('[Koordinat] Pasaport No bulundu:', extracted.pasaportNo);
                        break;
                    }
                }
            }
        }
    }

    export function extractFields(text) {
        // Normalize newlines for easier regex matching
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const fullText = lines.join('\n');
        
        const extracted = {
            basvuruNo: '', pasaportNo: '', adi: '', soyadi: '', uyrugu: '', dogumTarihi: ''
        };

        // Known form label words — stops name extraction at right-column labels (OCR hataları dahil)
        const formLabels = /^(di[gğ]er|other|citizenship|uyr[uü][gğ]?[uü]?[a-z]*|nationality|nationali|nationally|nation|[dt][oö][gğ][uü]m[a-z]*|born|bom|birth|[öo]nceki|previous|surname|surmame|surnane|sumame|name|nane|mame|father|mother|baba|anne|cinsiyet[iİ]?|sex|gender|medeni|marital|uets|yeri|[üu]lkesi|country|kimlik|id|no|foreigner|place|foreign|date|tarihi|hali|status|biyo(?:metrik)?|number|document|belge(?:si)?|kay[ıi]t|registration|[iİ]kamet|ba[sş]vuru|randevu|talep|seyahat|travel|[iİıI]nformation|personal|type|t[üu]r[üu]|foto[gğ]raf|numara|soyad[ıi]?|ad[ıi]|veren|makam[ıi]?|issuing|authority|adres[iİ]?|address)$/i;

        // Bilinen ülke adları — ad/soyad alanına bulaşmasını önlemek için
        const knownCountryNames = /^(T[ÜU]RKMEN[İI]STAN|[ÖO]ZBEK[İI]STAN|KIRGIZ[İI]STAN|KAZAK[İI]STAN|TAC[İI]K[İI]STAN|AZERBAYCAN|G[ÜU]RC[İI]STAN|ERMENISTAN|AFGAN[İI]STAN|PAK[İI]STAN|[İI]RAN|IRAK|RUSYA|FEDERASYONU|S[UÜ]R[İI]YE|MISIR|LIBYA|TUNUS|FAS|SOMALI|YEMEN|L[İI]BNAN|FILISTIN|BANGLADESH|HINDISTAN|NEPAL|MYANMAR|CHINA|IRAN|IRAQ|SYRIA|EGYPT|INDIA|RUSSIA|SMST|MIA)$/i;

        // Helper: grab consecutive name words, stopping at form labels.
        // Tolerates 1 lowercase OCR error per word.
        const grabName = (str) => {
            const words = str.split(/[\s,;:]+/).filter(w => w.length > 0);
            const result = [];
            for (const word of words) {
                if (result.length >= 4) break;
                if (formLabels.test(word)) break;
                
                // OCR hatalarına karşı daha esnek kontrol: Kelime içindeki harf dışı karakterleri temizle
                const cleanedWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü'\-]/g, '');
                
                // Ülke adıysa ismi sonlandır (sağ kolondan bulaşmayı önle)
                if (knownCountryNames.test(cleanedWord)) break;
                const isNameWord = cleanedWord.length >= 2;
                
                if (isNameWord) {
                    // OCR'da sık karışan rakamları harfe çevir
                    let fixedWord = word.toLocaleUpperCase('tr-TR')
                        .replace(/[0]/g, 'O')
                        .replace(/[1]/g, 'I')
                        .replace(/[3]/g, 'E')
                        .replace(/[4]/g, 'A')
                        .replace(/[5]/g, 'S')
                        .replace(/[8]/g, 'B')
                        .replace(/[^A-ZÇĞİÖŞÜ'\-]/g, '');
                    
                    if(fixedWord.length >= 2) {
                        result.push(fixedWord);
                    }
                } else if (result.length > 0) {
                    break;
                }
            }
            return result.join(' ');
        };

        // ============================================
        // 1. BAŞVURU NO (Kayıt Numarası)
        //    Format: YYYY-NN-NNNNNNN (e.g. 2026-88-0638278)
        // ============================================

        // Strategy A: GCGM barcode text (most reliable, always on the form)
        // e.g. GCGM03-92026880638278 → 2026-88-0638278
        const cleanForBarcode = fullText.replace(/\s+/g, '');
        const barcodeMatch = cleanForBarcode.match(/GC[CG]M\d+[-–]?\d(\d{4})(\d{2})(\d{7})/i);
        if (barcodeMatch) {
            extracted.basvuruNo = `${barcodeMatch[1]}-${barcodeMatch[2]}-${barcodeMatch[3]}`;
        }

        // Strategy B: Label-anchored (near "Kayıt Numarası" / "Registration Number")
        if (!extracted.basvuruNo) {
            const labelMatch = fullText.match(
                /(?:Kay[ıi]t\s*(?:Numaras[ıi]|No)|Registration\s*(?:Number|No))[^\d]{0,30}(\d{4})\s*[-–.\s]\s*(\d{2})\s*[-–.\s]\s*(\d{5,7})/i
            );
            if (labelMatch) {
                extracted.basvuruNo = `${labelMatch[1]}-${labelMatch[2]}-${labelMatch[3]}`;
            }
        }

        // Strategy C: Generic YYYY-NN-NNNNNNN anchored to 20XX or 50XX (OCR error for 2)
        if (!extracted.basvuruNo) {
            const genericMatch = fullText.match(/\b([25Zz]?0\d{2})\s*[-–]\s*(\d{2})\s*[-–]\s*(\d{5,7})\b/);
            if (genericMatch) {
                extracted.basvuruNo = `${genericMatch[1]}-${genericMatch[2]}-${genericMatch[3]}`;
            }
        }

        // OCR digit corrections for başvuru no
        if (extracted.basvuruNo) {
            const parts = extracted.basvuruNo.split('-');
            if (parts.length === 3) {
                parts.forEach((p, idx) => {
                    parts[idx] = p.replace(/[OoQq]/g, '0').replace(/[S\$]/g, '5').replace(/[Zz]/g, '2').replace(/[l]/g, '1');
                });
                // 5 ile başlayan yılları (OCR hatası) 2'ye zorla
                if (parts[0].startsWith('50') || parts[0].startsWith('Z0')) {
                    parts[0] = '20' + parts[0].substring(2);
                }
                extracted.basvuruNo = parts.join('-');
            }
        }

        // ============================================
        // 2. SOYADI VE ADI
        // ============================================

        const pasaportRegex = /\b(?:Pasaport|Document)\s*(?:No|Number)?\b/gi;
        const adiRegex = /\b(?:Ad[ıiIİ]?|Name)\b/gi;
        const soyadiRegex = /\b(?:Soyad[ıiIİ]?|Surname)\b/gi;
        const uyruguRegex = /\b(?:Uyru[gğ]u|Nationality)\b/gi;

        // Soyadı
        let sM;
        while ((sM = soyadiRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, sM.index - 15), sM.index);
            if (/Önceki|Previous/i.test(before)) continue;

            const after = fullText.substring(sM.index + sM[0].length, sM.index + sM[0].length + 100);
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break;
                    skipped++;
                    if (skipped > 3) break; // Çok fazla etiket atlarsa dur (yanlış satıra kaymayı önler)
                    continue;
                }
                const cleanWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, '');
                if (cleanWord.length < 2) continue;
                
                validParts.push(cleanWord.toLocaleUpperCase('tr-TR'));
                if (validParts.length >= 2) break; // En fazla 2 kelime
            }
            if (validParts.length > 0 && !extracted.soyadi) {
                extracted.soyadi = validParts.join(' ');
                break;
            }
        }

        // Adı
        let aM;
        while ((aM = adiRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, aM.index - 15), aM.index);
            // Soyadı, Baba Adı, Anne Adı gibi kelimelerin içindeki "Adı" kelimesini atla
            if (/soy|baba|anne|father|mother|previous|[öo]nceki/i.test(before)) continue; 
            
            const after = fullText.substring(aM.index + aM[0].length, aM.index + aM[0].length + 100);
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break;
                    skipped++;
                    if (skipped > 3) break;
                    continue;
                }
                const cleanWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, '');
                if (cleanWord.length < 2) continue;
                
                validParts.push(cleanWord.toLocaleUpperCase('tr-TR'));
                if (validParts.length >= 2) break; // En fazla 2 kelime
            }
            if (validParts.length > 0 && !extracted.adi) {
                extracted.adi = validParts.join(' ');
                break;
            }
        }

        // ============================================
        // 4. UYRUĞU — standalone, skip Diğer/Doğumdaki
        // ============================================
        const uyrukRegex = /Uyru[gğ]u/gi;
        let uM;
        while ((uM = uyrukRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, uM.index - 15), uM.index);
            if (/di[gğ]er|do[gğ]um/i.test(before)) continue;

            const after = fullText.substring(uM.index + uM[0].length, uM.index + uM[0].length + 150);
            
            // Tüm kelimeleri alıp aradaki etiketleri atlıyoruz
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break; // Ülke adından sonra etiket gelirse dur
                    skipped++;
                    if (skipped > 4) break;
                    continue; // Başlangıçtaki etiketleri (örn: Foreign, ID, Number) atla
                }
                
                if (/^[A-ZÇĞİÖŞÜa-zçğıöşü]+$/.test(word)) {
                    validParts.push(word.toLocaleUpperCase('tr-TR'));
                } else if (validParts.length > 0) {
                    break;
                }
                
                if (validParts.length >= 2) break; // En fazla 2 kelimelik ülkeler
            }
            
            if (validParts.length > 0) {
                // Aynı kelime tekrar ediyorsa (örn: TÜRKMENİSTAN TÜRKMENİSTAN) tekile düşür
                const uniqueParts = [...new Set(validParts)];
                extracted.uyrugu = uniqueParts.join(' ');
                break;
            }
        }

        if (!extracted.uyrugu) {
            const countryMatch = fullText.match(/(?:^|\s|[^a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ])(T[ÜU]RKMEN[İI]STAN|[ÖO]ZBEK[İI]STAN|KIRGIZ[İI]STAN|KAZAK[İI]STAN|TAC[İI]K[İI]STAN|AZERBAYCAN|RUSYA|G[ÜU]RC[İI]STAN|ERMENISTAN|AFGAN[İI]STAN|PAK[İI]STAN|[İI]RAN|IRAK|S[UÜ]R[İI]YE|MISIR|LIBYA|TUNUS|FAS|SOMALI|YEMEN|L[İI]BNAN|FILISTIN)(?:$|\s|[^a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ])/i);
            if (countryMatch) {
                extracted.uyrugu = countryMatch[1].toLocaleUpperCase('tr-TR');
            }
        }

        // ============================================
        // 5. DOĞUM TARİHİ
        // ============================================
        const dobMatch = fullText.match(
            /(?:Do[gğ]um|Date\s*of\s*Birth|Born)[^\d]{0,120}(3[01]|[12]\d|0?[1-9])\s*[/.\-\s]+\s*(1[0-2]|0?[1-9])\s*[/.\-\s]+\s*(\d{4})/i
        );
        if (dobMatch) {
            extracted.dogumTarihi = `${dobMatch[1].padStart(2, '0')}.${dobMatch[2].padStart(2, '0')}.${dobMatch[3]}`;
        }

        // ============================================
        // 6. PASAPORT NO (Belge No)
        // ============================================
        const belgeMatch = fullText.match(
            /(?:Belge\s*N[oO0]|Number\s*of\s*Document)[^\w]{0,10}([A-Z0-9ĞÜŞİÖÇğüşiöç]{5,15})/i
        );
        if (belgeMatch) {
            let pass = belgeMatch[1].toUpperCase().replace(/\s/g, '');
            if (pass.length >= 5 && !/^INFORMATION$/i.test(pass) && !/^NUMBER$/i.test(pass)) {
                extracted.pasaportNo = pass;
            }
        }

        // Fallback: Letter(s) + digits (e.g. A2596273, P09986286)
        if (!extracted.pasaportNo) {
            const passMatch = fullText.match(/\b([A-Za-z]{1,2}\d{6,9})\b/);
            if (passMatch) {
                const candidate = passMatch[1].toUpperCase();
                if (!/^GC/i.test(candidate)) {
                    extracted.pasaportNo = candidate;
                }
            }
        }

        // OCR corrections for passport digits
        if (extracted.pasaportNo) {
            const letterMatch = extracted.pasaportNo.match(/^([A-Za-zĞÜŞİÖÇ]*)/);
            if (letterMatch && letterMatch[0].length < extracted.pasaportNo.length) {
                const lp = letterMatch[0];
                const dp = extracted.pasaportNo.substring(lp.length);
                extracted.pasaportNo = lp + dp.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/[Zz]/g, '2').replace(/[l]/g, '1');
            }
        }

        // Garbage Collector: Reject overly long extractions
        if (extracted.adi && extracted.adi.split(' ').length > 4) extracted.adi = '';
        if (extracted.soyadi && extracted.soyadi.split(' ').length > 4) extracted.soyadi = '';

        return extracted;
    }
    
    export function extractPage2FromCoordinates(words) {
        let extracted = { adres: '', tel: '', mail: '' };
        if (!words || words.length === 0) return extracted;
        
        const sameRow = (w1, w2) => {
            const h1 = w1.bbox.y1 - w1.bbox.y0;
            const h2 = w2.bbox.y1 - w2.bbox.y0;
            const yCenter1 = w1.bbox.y0 + h1/2;
            const yCenter2 = w2.bbox.y0 + h2/2;
            return Math.abs(yCenter1 - yCenter2) < Math.max(h1, h2) * 0.8;
        };

        const ySorted = [...words].sort((a,b) => a.bbox.y0 - b.bbox.y0);
        let lines = [];
        let currentLine = [];
        for (let i = 0; i < ySorted.length; i++) {
            if (currentLine.length === 0) {
                currentLine.push(ySorted[i]);
            } else {
                if (sameRow(currentLine[currentLine.length-1], ySorted[i])) {
                    currentLine.push(ySorted[i]);
                } else {
                    currentLine.sort((a,b) => a.bbox.x0 - b.bbox.x0);
                    lines.push(currentLine);
                    currentLine = [ySorted[i]];
                }
            }
        }
        if (currentLine.length > 0) {
            currentLine.sort((a,b) => a.bbox.x0 - b.bbox.x0);
            lines.push(currentLine);
        }

        let addressText = "";
        let phoneText = "";
        let mailText = "";
        let inTurkeyAddress = true; // Default true in case they cropped only the address part

        for (let i = 0; i < lines.length; i++) {
            const lineWords = lines[i].map(w => w.text);
            const lineStr = lineWords.join(" ").toUpperCase();
            
            // Region detection
            if (lineStr.includes("DAİMİ") || lineStr.includes("PERMANENT") || lineStr.includes("AÇIK ADRES")) {
                inTurkeyAddress = false;
                continue;
            }
            if (lineStr.includes("TÜRKİYE") || lineStr.includes("TURK") || lineStr.includes("MAIN ADDRESS") || lineStr.includes("ANA ADRES")) {
                inTurkeyAddress = true;
                continue;
            }
            if (lineStr.includes("ÖĞRENİM") || lineStr.includes("OGRENIM") || lineStr.includes("CONTINUING")) {
                inTurkeyAddress = false;
                break; // We reached the next section, stop parsing address
            }

            if (inTurkeyAddress) {
                // Email extraction
                let mailMatch = lineStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (mailMatch && !mailText) mailText = mailMatch[0].toLowerCase();
                
                // Phone extraction (looking for 10-15 digit numbers)
                let phoneMatch = lineStr.match(/(?:\+90|0)?\s*[5]\d{2}\s*\d{3}\s*\d{2}\s*\d{2}/);
                if (!phoneMatch) phoneMatch = lineStr.match(/\b\d{10,13}\b/);
                if (phoneMatch && !phoneText) phoneText = phoneMatch[0].replace(/\s/g, '');

                // Address extraction
                const adresIdx = lineStr.indexOf('ADRES');
                const telIdx = lineStr.indexOf('TELEFON');
                const phoneIdx = lineStr.indexOf('PHONE');
                
                // Remove mail and phone strings from line to not pollute address
                let cleanAddrLine = lineStr;
                if (mailMatch) cleanAddrLine = cleanAddrLine.replace(mailMatch[0], '');
                if (phoneMatch) cleanAddrLine = cleanAddrLine.replace(phoneMatch[0], '');
                
                let endIdx = cleanAddrLine.length;
                if (telIdx !== -1) endIdx = Math.min(endIdx, telIdx);
                if (phoneIdx !== -1) endIdx = Math.min(endIdx, phoneIdx);
                if (cleanAddrLine.indexOf('E POSTA') !== -1) endIdx = Math.min(endIdx, cleanAddrLine.indexOf('E POSTA'));
                if (cleanAddrLine.indexOf('E-MAIL') !== -1) endIdx = Math.min(endIdx, cleanAddrLine.indexOf('E-MAIL'));
                if (cleanAddrLine.indexOf('TAŞINMA') !== -1) endIdx = Math.min(endIdx, cleanAddrLine.indexOf('TAŞINMA'));
                if (cleanAddrLine.indexOf('MOVING') !== -1) endIdx = Math.min(endIdx, cleanAddrLine.indexOf('MOVING'));

                if (adresIdx !== -1) {
                    let addrPart = cleanAddrLine.substring(adresIdx + 5, endIdx).replace(/ADDRESS/i, '').trim();
                    if (addrPart.length > 5) {
                        addressText = addrPart;
                    }
                } else {
                    let cleanLine = cleanAddrLine.substring(0, endIdx).replace(/ADDRESS/i, '').trim();
                    // Exclude lines that are just labels
                    if (!cleanLine.includes("TELEFON") && !cleanLine.includes("TAŞINMA") && !cleanLine.includes("POSTA") && !cleanLine.includes("MAIL") && !cleanLine.includes("DATE") && !cleanLine.includes("PHONE") && !cleanLine.includes("MOVING")) {
                        if (addressText !== "") {
                            if (cleanLine.length > 3) addressText += " " + cleanLine;
                        } else if (cleanLine.length > 5) {
                            addressText = cleanLine;
                        }
                    }
                }
            }
        }
        
        extracted.adres = addressText.trim().replace(/^[,\s]+/, '').replace(/[,\s]+$/, '');
        extracted.tel = phoneText.trim();
        extracted.mail = mailText.trim();
        return extracted;
    }
