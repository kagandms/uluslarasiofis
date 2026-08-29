const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('file:///Users/kagansmtdms/Downloads/Проекты/ikamet-main/index.html');
    
    // Disable network
    await page.setOfflineMode(true);
    // Trigger offline event manually just in case
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    
    // Click the wrapper
    await page.click('#upload-wrapper');
    
    // Wait a tiny bit for toast
    await new Promise(r => setTimeout(r, 500));
    
    const toastHtml = await page.evaluate(() => document.getElementById('toast-container').innerHTML);
    console.log("Toast HTML:", toastHtml);
    
    await browser.close();
})();
