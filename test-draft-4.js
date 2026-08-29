const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    await page.goto('file:///Users/kagansmtdms/Downloads/Проекты/ikamet-main/index.html');
    
    // Check if offline triggers toast automatically
    await page.setOfflineMode(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    
    await new Promise(r => setTimeout(r, 500));
    
    let toastHtml = await page.evaluate(() => document.getElementById('toast-container').innerHTML);
    console.log("Toast after offline event:", toastHtml);
    
    // Go online, then manual entry, then type, then reload to test draft
    await page.setOfflineMode(false);
    await page.click('#btn-manual-entry');
    await page.type('#field-adi', 'Test Name 123');
    await page.reload();
    await page.click('#btn-manual-entry');
    const nameVal = await page.evaluate(() => document.getElementById('field-adi').value);
    console.log("Name after restore:", nameVal);
    
    await browser.close();
})();
