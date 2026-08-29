const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('file:///Users/kagansmtdms/Downloads/Проекты/ikamet-main/index.html');
    
    // Check if offline triggers toast automatically
    await page.setOfflineMode(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    
    await new Promise(r => setTimeout(r, 500));
    
    let toastHtml = await page.evaluate(() => document.getElementById('toast-container').innerHTML);
    console.log("Toast after offline event:", toastHtml);
    
    // Clear toast
    await page.evaluate(() => document.getElementById('toast-container').innerHTML = '');
    
    // Click wrapper
    await page.evaluate(() => {
        const wrapper = document.getElementById('upload-wrapper');
        console.log(wrapper.outerHTML);
        wrapper.click();
    });
    
    await new Promise(r => setTimeout(r, 500));
    toastHtml = await page.evaluate(() => document.getElementById('toast-container').innerHTML);
    console.log("Toast after click:", toastHtml);
    
    await browser.close();
})();
