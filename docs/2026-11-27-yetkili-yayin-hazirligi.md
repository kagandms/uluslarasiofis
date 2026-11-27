# Yayın hazırlığı — yetkili günlük iş akışı sürümü (27 Kasım 2026)

**Durum:** Onay 1 (migration) uygulandı; onay 2 (temel SHA, `production` birleştirmesi ve push) kullanıcı tarafından verildi. Workflow tetikleme ve yayın **yapılmadı**. Her adım ayrı onay ister. Bu belge tarihlidir; adımlardan önce değerler yeniden doğrulanır.

## Aday ve canlı durum

- Aday dal: `claude/portal-update-features-plan-7a67da` (inceleme anındaki kod SHA'sı `0192276faea5acd7233007533eb91f9a52708f5a`; sonraki commit'ler yalnız dokümandır).
- `origin/production` = `097020c144613b49a56afae3162e392dac937060`; aday 0 commit geride.
- Canlı Worker sürümü (salt okunur sorgu): `49234922-c428-464b-ba68-4a0feef66bf7`, açıklama `release:097020c…`. Yani canlı = `origin/production`.
- Uzak D1'de bekleyen migration (salt okunur): yalnız `0048` ve `0049`.
- Korumalı yol farkı: yalnız iki migration. `wrangler.jsonc`, `package.json`, kilit dosyası, `scripts/`, `.github/` değişmedi.

| Migration | SHA-256 | Etki |
| --- | --- | --- |
| `0048_office_inquiry_notes.sql` | `bc836bd507f40fec2efc5d2a3beb0980fbd224cf9a7f5ae484a2549bff5b4a8e` | `office_inquiries` tablosuna 3 boş sütun |
| `0049_migration_office_states.sql` | `f22b0062e749c4e730f800279dbbdfef88f6a626c3f24ab3675d5d857f37a2b2` | yeni `migration_office_states` tablosu + 2 indeks; `yoksis_document_audit_records.record_date` sütunu |

İkisi de yalnız ekleme yapar; mevcut satırı değiştirmez veya silmez.

## Yerel kontroller (kod SHA'sı `0192276`, Node 26; CI Node 24 kullanır)

| Kontrol | Sonuç |
| --- | --- |
| `npm audit --omit=dev --audit-level=high` | 0 bulgu |
| `npm test` (iki kez) | 2.524 test, 2.523 geçti, 0 hata, 1 atlandı |
| `npm run test:receipt-stability -- 20` | 20/20 |
| `npm run ci:local` | 49 migration boş D1'de; sentetik Worker kontrolü geçti |
| `build:production`, `deploy:dry-run:production` | geçti |
| Aday artifact oluştur, doğrula, aynı artifact ile dry-run | geçti (504 dosya) |
| Canlı koddaki testler (`097020c`) + yeni şema | 2.416 testte 2 hata; ikisi de sütun listesini sabit bekleyen şema testi. Davranış hatası görülmedi |

Yerelde **çalıştırılmayan** CI adımları: actionlint ve tarayıcı/yazıcı Python testleri (ilgili dosyalar değişmedi; CI çalıştırır).

## Adımlar ve onaylar

1. **Onay 1 — migration.** Hemen önce yeni Time Travel bookmark kaydedilir (inceleme anındaki: `0000071f-00000d5a-00005130-40becd36e86fd6c58a604c009b2e45d7`). Bekleyen listede yalnız 0048 ve 0049 olduğu doğrulanır, sonra `npm run db:migrate:production`. Ardından salt okunur kontrol: bekleyen migration yok; yeni tablo, indeksler ve sütunlar var; yeni tablo 0 satır; `office_inquiries` ve `yoksis_document_audit_records` satır sayıları aynı.
2. **Onay 2 — temel SHA, birleştirme ve push.** `config/production-publication.json` içinde `code_only_baseline_sha` → `fb3af1b93b1d888135cc96361f63a41ef2daaa4f` (iki migration'ın son halini içeren incelenmiş commit). Kanıt `docs/manual-production-release.md` dosyasına eklenir. Aday `production` dalına **merge commit** ile alınır (squash/rebase yok), testler yeniden çalışır, push edilir.
3. **Onay 3 — preflight.** `origin/production` tam SHA'sı için `operation=preflight`; GitHub Production ortam onayı; kanıt incelenir.
4. **Onay 4 — yayın.** Aynı SHA için `operation=publish`; ortam onayı. Aktif sürüm açıklaması ve sağlık kontrolleri doğrulanır.

Adım 1 ile 4 arasında canlıda eski kod yeni şemayla çalışır. Bu arada `production`'dan migration dosyalarını içermeyen başka bir yayın yapılamaz (ledger kontrolü durdurur); aralık kısa tutulur. Yayın sırasında Dashboard, doğrudan wrangler ve diğer oturumlardan yayın yapılmaz.

## Onay 1 kanıtı — migration uygulandı (27 Kasım 2026)

Kaynak: kullanıcı oturum konuşmasında onayladı. Uygulama öncesi: aday temiz (`3ddb823`), `origin/production` ve canlı sürüm değişmemiş, SHA-256 değerleri yukarıdakiyle aynı, bekleyen liste yalnız 0048 ve 0049. Time Travel bookmark (08:07:05Z): `0000071f-00000e12-00005130-ae09804b1e0a2a2b7bed2066beb9e59a`. Komut: `npm run db:migrate:production`; ikisi de başarılı.

Sonraki salt okunur kontrol: bekleyen migration yok; `office_inquiries` 3 not sütunu, `record_date` sütunu, yeni tablo ve iki indeks mevcut; yeni tablo 0 satır, yeni sütunlar boş; satır sayıları öncekiyle aynı (`office_inquiries` 10, `yoksis_document_audit_records` 2.194, `applications` 1.544, `physical_intakes` 714); `PRAGMA foreign_key_check` boş. Canlı sürüm `49234922-c428-464b-ba68-4a0feef66bf7` (`release:097020c…`); altı sabit sayfa HTTP 200. HTTP 200 işlev kanıtı değildir.

## Geri dönüş

- Kod: önceki sürüm (`097020c`) yeni sütun ve tabloyla çalışacak biçimde ek şema; sürüm geri alma ayrı onay ister. Geri alınırsa kalıcı silme `migration_office_states` satırını temizlemez (zararsız artık satır).
- Veri: eşitlemeyle yapılan durum değişiklikleri kod geri alınınca geri dönmez. Time Travel geri yükleme tüm veritabanını etkiler; yalnız ayrı kararla.

## Yayından sonra

1. YÖKSİS'ten **yeni Excel indirip yükleyin**. Eski aktarım satırlarında kayıt tarihi olmadığı için eşitleme onları "Elle kontrol"e atar.
2. "Durumları portala işle": ilk seferde 3–5 kayıt seçip YÖKSİS ile karşılaştırın. Online kayıtta "henüz iletilmemiş" grubundan seçim belgeleri toplu onaylar.
3. Topi'yi gerçek yapay zekâ ile deneyin; tarayıcıda yazdırma penceresini kontrol edin.
4. Açık işler: okulun puantaj şablonu (6B), Türkmence ana sayfa adımındaki kurum adı.
