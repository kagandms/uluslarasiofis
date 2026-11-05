console.error('Production yayınları yerel CLI ile yapılamaz. Production release (manual) workflow’unu kullanın; yalnız açıkça istenmiş, incelenmiş tam SHA için publish seçin. Güvenli prova: npm run deploy:dry-run:production.');
process.exitCode = 1;
