const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.goto('file:///Users/kagansmtdms/Downloads/Проекты/ikamet-main/index.html');
    
    await page.evaluate(() => showToast('Test toast', 'info'));
    await new Promise(r => setTimeout(r, 100));
    let toastHtml = await page.evaluate(() => document.getElementById('toast-container').innerHTML);
    console.log("Toast after explicit showToast:", toastHtml);
    
    await browser.close();
})();
