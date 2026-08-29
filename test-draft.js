const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('file:///Users/kagansmtdms/Downloads/Проекты/ikamet-main/index.html');
    
    // Go to manual entry
    await page.click('#btn-manual-entry');
    
    // Type into field-adi
    await page.type('#field-adi', 'Test Name');
    
    // Check localStorage
    const draft = await page.evaluate(() => localStorage.getItem('ikamet_draft'));
    console.log("Draft after typing:", draft);
    
    // Reload page
    await page.reload();
    
    // Go to manual entry again
    await page.click('#btn-manual-entry');
    
    // Check field-adi value
    const nameVal = await page.evaluate(() => document.getElementById('field-adi').value);
    console.log("Name after restore:", nameVal);
    
    await browser.close();
})();
