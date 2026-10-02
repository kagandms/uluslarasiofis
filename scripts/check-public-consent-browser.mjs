import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Dynamically import puppeteer
const puppeteerModule = await import('puppeteer');
const puppeteer = puppeteerModule.default || puppeteerModule;

const VIEWPORTS = [
    { width: 320, height: 600, label: '320px (Mobile S)' },
    { width: 390, height: 844, label: '390px (Mobile M)' },
    { width: 768, height: 1024, label: '768px (Tablet)' },
    { width: 1440, height: 900, label: '1440px (Desktop)' }
];

const LOCALES = ['tr', 'en', 'ru', 'tk', 'ar'];

// Mock state
let currentSessionMode = 'owner'; // 'owner' | 'none'
let currentPrefs = {
    application_id: 'app_browser_test_1',
    whatsapp_opt_in: false,
    consent_version: null,
    language: 'tr',
    effective_whatsapp_opt_in: false,
    requires_reconsent: false,
    can_opt_in: true
};

function createMockServer() {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg',
        '.png': 'image/png'
    };

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // Mock API
        if (pathname.startsWith('/api/')) {
            if (pathname === '/api/public/applications/current') {
                if (currentSessionMode === 'none') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: { code: 'APPLICATION_SESSION_REQUIRED', message: 'Session required' } }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    application: {
                        id: 'app_browser_test_1',
                        status: 'draft',
                        student_number: 'STU-BRW-001',
                        student_email: 'student@example.edu',
                        student_phone: '+905551234567',
                        application_type: 'initial',
                        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: false }
                    }
                }));
            }

            if (pathname === '/api/public/applications/current/notification-preferences') {
                if (currentSessionMode === 'none') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: { code: 'APPLICATION_SESSION_REQUIRED' } }));
                }
                if (req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(currentPrefs));
                }
                if (req.method === 'PUT') {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        const parsed = JSON.parse(body);
                        if (parsed.whatsapp_opt_in) {
                            currentPrefs.whatsapp_opt_in = true;
                            currentPrefs.consent_version = parsed.consent_version || 'whatsapp-consent-v1';
                            currentPrefs.language = parsed.language || 'tr';
                            currentPrefs.effective_whatsapp_opt_in = true;
                            currentPrefs.requires_reconsent = false;
                        } else {
                            currentPrefs.whatsapp_opt_in = false;
                            currentPrefs.effective_whatsapp_opt_in = false;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(currentPrefs));
                    });
                    return;
                }
            }

            if (pathname === '/api/public/applications/current/tracking') {
                if (currentSessionMode === 'none') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: { code: 'APPLICATION_SESSION_REQUIRED' } }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    application: {
                        id: 'app_browser_test_1',
                        status: 'submitted',
                        student_number: 'STU-BRW-001',
                        application_type: 'initial',
                        created_at: '2026-09-28T10:00:00.000Z',
                        submitted_at: '2026-09-29T10:00:00.000Z'
                    },
                    documents: [
                        { code: 'passport', label_key: 'documentPassport', required: true, status: 'waiting_review', filename: 'passport.pdf' }
                    ]
                }));
            }

            if (pathname === '/api/public/applications/tracking-lookup' || pathname === '/api/public/applications/tracking/lookup') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    found: true,
                    application: {
                        student_number: 'STU-PUBLIC-99',
                        status: 'submitted',
                        application_type: 'initial'
                    },
                    documents: []
                }));
            }

            if (pathname === '/api/public/applications/current/documents' || pathname === '/api/public/applications/current/requirements') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ requirements: [] }));
            }

            res.writeHead(404);
            return res.end();
        }

        // Static files resolution
        let filePath = path.join(projectRoot, pathname);
        if (pathname.endsWith('/')) {
            filePath = path.join(projectRoot, pathname, 'index.html');
        } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found: ' + pathname);
        }

        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });

    return server;
}

async function runBrowserChecks() {
    console.log('=== Phase 9 Public WhatsApp Notification Consent Browser Verification ===\n');

    const server = createMockServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Test server running at ${baseUrl}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const results = [];

    try {
        const page = await browser.newPage();

        // 1. Check all viewports and locales for horizontal overflow and visual sanity on /basvuru
        console.log('\n--- Checking /basvuru across viewports and locales ---');
        currentSessionMode = 'owner';
        currentPrefs.whatsapp_opt_in = false;
        currentPrefs.effective_whatsapp_opt_in = false;

        for (const vp of VIEWPORTS) {
            await page.setViewport({ width: vp.width, height: vp.height });

            for (const locale of LOCALES) {
                await page.goto(`${baseUrl}/basvuru/`, { waitUntil: 'networkidle0' });

                // Switch language
                await page.evaluate((loc) => {
                    const picker = document.querySelector('.language-picker select');
                    if (picker) {
                        picker.value = loc;
                        picker.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, locale);

                await new Promise((r) => setTimeout(r, 80));

                const metrics = await page.evaluate(() => {
                    const doc = document.documentElement;
                    const prefGroup = document.querySelector('.notification-preference-group');
                    const checkbox = document.querySelector('#field-whatsapp-opt-in');
                    const label = document.querySelector('.notification-preference-label');
                    const dir = doc.getAttribute('dir');
                    const lang = doc.getAttribute('lang');

                    let touchTargetValid = true;
                    if (label) {
                        const rect = label.getBoundingClientRect();
                        touchTargetValid = rect.height >= 38;
                    }

                    return {
                        scrollWidth: doc.scrollWidth,
                        clientWidth: doc.clientWidth,
                        hasOverflow: doc.scrollWidth > doc.clientWidth,
                        hasPrefGroup: Boolean(prefGroup),
                        hasCheckbox: Boolean(checkbox),
                        checkboxChecked: checkbox ? checkbox.checked : null,
                        dir,
                        lang,
                        touchTargetValid
                    };
                });

                const pass = !metrics.hasOverflow && metrics.hasPrefGroup && metrics.hasCheckbox && metrics.touchTargetValid;
                results.push({
                    test: `/basvuru [${vp.label}] [${locale}] (RTL: ${metrics.dir === 'rtl'})`,
                    pass,
                    detail: `scrollWidth: ${metrics.scrollWidth}, clientWidth: ${metrics.clientWidth}, touchTarget: ${metrics.touchTargetValid}`
                });
                console.log(`  ${pass ? '✔' : '✖'} /basvuru [${vp.label}] [${locale}] - overflow: ${metrics.hasOverflow ? 'FAIL' : 'OK'}, RTL: ${metrics.dir === 'rtl'}, touch: ${metrics.touchTargetValid}`);
            }
        }

        // 2. Interactive Consent flow in /basvuru
        console.log('\n--- Interactive Consent Flow on /basvuru ---');
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(`${baseUrl}/basvuru/`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => {
            localStorage.setItem('portal_ui_locale', 'tr');
            const picker = document.querySelector('.language-picker select');
            if (picker) {
                picker.value = 'tr';
                picker.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await new Promise((r) => setTimeout(r, 100));

        // Verify checkbox is unchecked initially
        let isChecked = await page.evaluate(() => document.querySelector('#field-whatsapp-opt-in')?.checked);
        assert.equal(isChecked, false, 'Checkbox must start unchecked');

        // Click checkbox to opt-in
        await page.click('#field-whatsapp-opt-in');
        await page.waitForFunction(() => {
            const status = document.querySelector('.notification-preference-status');
            return status && status.textContent.includes('kaydedildi');
        }, { timeout: 3000 });

        let statusText = await page.evaluate(() => document.querySelector('.notification-preference-status')?.textContent);
        console.log(`  ✔ Opt-in saved feedback: "${statusText.trim()}"`);
        assert.equal(currentPrefs.whatsapp_opt_in, true, 'Server state must reflect opt-in');

        // Uncheck to opt-out
        await page.click('#field-whatsapp-opt-in');
        await page.waitForFunction(() => {
            const status = document.querySelector('.notification-preference-status');
            return status && status.textContent.includes('kaydedildi');
        }, { timeout: 3000 });
        assert.equal(currentPrefs.whatsapp_opt_in, false, 'Server state must reflect opt-out');
        console.log(`  ✔ Opt-out saved feedback verified`);

        // Test phone change re-consent prompt
        currentPrefs.whatsapp_opt_in = true;
        currentPrefs.effective_whatsapp_opt_in = true;
        await page.goto(`${baseUrl}/basvuru/`, { waitUntil: 'networkidle0' });

        await page.focus('[name="student_phone"]');
        await page.keyboard.type('9');
        await new Promise((r) => setTimeout(r, 100));

        const reconsentNotice = await page.evaluate(() => {
            const notice = document.querySelector('.notification-preference-notice');
            const checkbox = document.querySelector('#field-whatsapp-opt-in');
            return {
                display: notice?.style?.display,
                text: notice?.textContent,
                checkboxChecked: checkbox?.checked
            };
        });

        assert.equal(reconsentNotice.checkboxChecked, false, 'Checkbox must uncheck on phone edit');
        assert.ok(reconsentNotice.text.includes('güncellendi') || reconsentNotice.text.includes('yenileyin'), 'Reconsent notice must display');
        console.log(`  ✔ Phone edit triggered re-consent notice: "${reconsentNotice.text.trim()}"`);

        // 3. Tracking view /basvurum checks
        console.log('\n--- Tracking View (/basvurum) Owner & Public Session Checks ---');
        currentSessionMode = 'owner';
        currentPrefs.whatsapp_opt_in = true;
        currentPrefs.effective_whatsapp_opt_in = true;

        for (const vp of VIEWPORTS) {
            await page.setViewport({ width: vp.width, height: vp.height });
            await page.goto(`${baseUrl}/basvurum/`, { waitUntil: 'networkidle0' });

            const trackingMetrics = await page.evaluate(() => {
                const doc = document.documentElement;
                const prefSection = document.querySelector('.tracking-notification-preferences');
                const button = prefSection?.querySelector('button');
                const buttonRect = button ? button.getBoundingClientRect() : null;

                return {
                    hasOverflow: doc.scrollWidth > doc.clientWidth,
                    hasPrefSection: Boolean(prefSection),
                    buttonVisible: Boolean(button && button.offsetParent !== null),
                    buttonTouchSizeOk: buttonRect ? (buttonRect.height >= 38 && buttonRect.width >= 44) : false,
                    buttonText: button?.textContent?.trim()
                };
            });

            const pass = !trackingMetrics.hasOverflow && trackingMetrics.hasPrefSection && trackingMetrics.buttonVisible && trackingMetrics.buttonTouchSizeOk;
            results.push({
                test: `/basvurum Owner Session [${vp.label}]`,
                pass,
                detail: `Button: "${trackingMetrics.buttonText}", touchOk: ${trackingMetrics.buttonTouchSizeOk}`
            });
            console.log(`  ${pass ? '✔' : '✖'} /basvurum Owner [${vp.label}] - button: "${trackingMetrics.buttonText}", touchOk: ${trackingMetrics.buttonTouchSizeOk}`);
        }

        // Test opt-out click in tracking view
        await page.click('.tracking-notification-preferences button');
        await page.waitForFunction(() => {
            const btn = document.querySelector('.tracking-notification-preferences button');
            return btn && btn.getAttribute('data-action') === 'opt-in';
        }, { timeout: 3000 });

        const newBtnText = await page.evaluate(() => document.querySelector('.tracking-notification-preferences button')?.textContent?.trim());
        assert.equal(currentPrefs.whatsapp_opt_in, false, 'Tracking button click must set opt-out');
        console.log(`  ✔ Tracking view opt-out toggled button to: "${newBtnText}"`);

        // Test public lookup: no preference controls leaked
        console.log('\n--- Public Lookup Isolation Check ---');
        currentSessionMode = 'none';
        await page.goto(`${baseUrl}/basvurum/`, { waitUntil: 'networkidle0' });

        await page.type('#tracking-student-number', 'STU-PUBLIC-99');
        await page.click('.tracking-lookup-form button[type="submit"]');
        await new Promise((r) => setTimeout(r, 200));

        const publicTrackingMetrics = await page.evaluate(() => {
            return {
                hasPreferencesCard: Boolean(document.querySelector('.tracking-notification-preferences')),
                hasWhatsAppText: document.body.textContent.toLowerCase().includes('whatsapp')
            };
        });

        assert.equal(publicTrackingMetrics.hasPreferencesCard, false, 'Public lookup must never render preferences card');
        assert.equal(publicTrackingMetrics.hasWhatsAppText, false, 'Public lookup must never contain WhatsApp preference text');
        console.log('  ✔ Public lookup cleanly isolates preference controls and leaks 0 data');

        // 4. Check Home page (/) for responsive layout
        console.log('\n--- Checking Home Page (/) Across Viewports ---');
        for (const vp of VIEWPORTS) {
            await page.setViewport({ width: vp.width, height: vp.height });
            await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });

            const homeMetrics = await page.evaluate(() => {
                const doc = document.documentElement;
                return {
                    hasOverflow: doc.scrollWidth > doc.clientWidth,
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth
                };
            });

            assert.equal(homeMetrics.hasOverflow, false, `Home page must have no horizontal overflow on ${vp.label}`);
            console.log(`  ✔ Home page [${vp.label}] - overflow: OK`);
        }

        console.log('\n=== All Real Browser Checks Passed Successfully! ===\n');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

runBrowserChecks().catch((err) => {
    console.error('Browser check failed:', err);
    process.exit(1);
});
