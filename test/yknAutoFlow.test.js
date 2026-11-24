import assert from 'node:assert/strict';
import test from 'node:test';
import { createYknAutoFlow } from '../src/managers/yknAutoFlow.js';
import { evaluatePassportPage } from '../src/services/passportDocumentGuard.js';

function createHarness(overrides = {}) {
    const clicks = [];
    const appliedCrops = [];
    const defaultsCalls = [];
    const reports = [];
    let submitCount = 0;
    let selectNextCalls = 0;
    const order = [];

    const deps = {
        enabled: () => true,
        click: (id) => {
            clicks.push(id);
            order.push(`click:${id}`);
        },
        getPages: () => [{ dataUrl: 'data:image/jpeg;base64,abc', text: 'P<EXMYILMAZ<<AHMET<<<\nAB1234567' }],
        getPageIndex: () => 0,
        selectNextSource: async () => {
            selectNextCalls += 1;
            return false;
        },
        detectFace: async () => ({ x: 10, y: 20, width: 150, height: 200 }),
        evaluatePage: () => ({
            isPassport: true,
            hasMrz: true,
            passportNoMatched: true,
            nameMatched: true,
            score: 180,
            reason: 'Pasaport kimlik sayfası doğrulandı.'
        }),
        applyCrop: (box) => {
            appliedCrops.push(box);
            order.push('applyCrop');
            return true;
        },
        setDefaults: (defaults) => {
            defaultsCalls.push(defaults);
            order.push('setDefaults');
        },
        getGender: () => 'Erkek',
        submit: () => {
            submitCount += 1;
            order.push('submit');
        },
        report: (message, level) => {
            reports.push({ message, level });
        },
        ...overrides
    };

    const flow = createYknAutoFlow(deps);
    return {
        flow,
        clicks,
        appliedCrops,
        defaultsCalls,
        reports,
        order,
        getSubmitCount: () => submitCount,
        getSelectNextCalls: () => selectNextCalls
    };
}

test('enabled() false and force false does nothing and performs no clicks', () => {
    const h = createHarness({ enabled: () => false });

    h.flow.start('AB1234567');
    assert.equal(h.flow.isActive(), false);
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();

    assert.deepEqual(h.clicks, []);
    assert.equal(h.getSubmitCount(), 0);
});

test('start with force:true runs even when enabled() is false', () => {
    const h = createHarness({ enabled: () => false });

    h.flow.start('AB1234567', { force: true });
    assert.equal(h.flow.isActive(), true);
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });

    assert.deepEqual(h.clicks, ['read-acceptance']);
});

test('onSearchDone clicks read-acceptance and does not click copy without onYoksisReady', async () => {
    const h = createHarness();

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(h.clicks, ['read-acceptance']);
    assert.equal(h.getSubmitCount(), 0);
});

test('duplicate onSearchDone events trigger only a single chain', () => {
    const h = createHarness();

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });

    assert.deepEqual(h.clicks, ['read-acceptance']);
});

test('events after cancel are ignored', async () => {
    const h = createHarness();

    h.flow.start('AB1234567');
    h.flow.cancel('Kullanıcı iptal etti.');
    assert.equal(h.flow.isActive(), false);

    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(h.clicks, []);
    assert.equal(h.getSubmitCount(), 0);
    assert.ok(h.reports.some((r) => r.level === 'error'));
});

test('cancel while idle does not call report even when a reason is provided', () => {
    const h = createHarness();

    h.flow.cancel('Yeni arama başlatıldı');

    assert.equal(h.flow.isActive(), false);
    assert.deepEqual(h.reports, []);
});

test('onSearchDone auto-starts a new run after STOPPED or DONE when enabled() is true', async () => {
    const h = createHarness();

    // First run ends in STOPPED
    h.flow.start('AB1234567');
    h.flow.cancel('Durduruldu');
    assert.equal(h.flow.isActive(), false);

    // Subsequent manual search with enabled() === true should start a new chain
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'CD7654321' });
    assert.deepEqual(h.clicks, ['read-acceptance']);

    // Complete the run so state becomes DONE
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });
    assert.equal(h.flow.isActive(), false);
    assert.equal(h.getSubmitCount(), 1);

    // Another manual search after DONE should also auto-start
    h.flow.onSearchDone({ studentName: 'AYSE KAYA', passportNo: 'EF9999999' });
    assert.deepEqual(h.clicks, ['read-acceptance', 'copy', 'read-acceptance']);
});

test('start while active cancels the previous run and starts a new one', async () => {
    let resolveFirstDetect;
    let detectCalls = 0;
    const h = createHarness({
        detectFace: () => {
            detectCalls += 1;
            if (detectCalls === 1) {
                return new Promise((resolve) => {
                    resolveFirstDetect = resolve;
                });
            }
            return Promise.resolve({ x: 5, y: 5, width: 100, height: 120 });
        }
    });

    h.flow.start('FIRST111');
    h.flow.onSearchDone({ studentName: 'FIRST STUDENT', passportNo: 'FIRST111' });
    h.flow.onYoksisReady();
    const firstCropPromise = h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    // Start a second run while first is awaiting detectFace
    h.flow.start('SECOND222');
    resolveFirstDetect({ x: 1, y: 1, width: 90, height: 120 });
    await firstCropPromise;

    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), true);
});

test('non-passport page tries selectNextSource and stops with error when all sources fail', async () => {
    let sourceIdx = 0;
    const sources = [
        [{ dataUrl: 'data:image/jpeg;base64,1', text: 'DIPLOMA' }],
        [{ dataUrl: 'data:image/jpeg;base64,2', text: 'ACCEPTANCE LETTER' }]
    ];
    let nextCalls = 0;

    const h = createHarness({
        getPages: () => sources[sourceIdx],
        getPageIndex: () => 0,
        selectNextSource: async () => {
            nextCalls += 1;
            if (sourceIdx + 1 < sources.length) {
                sourceIdx += 1;
                return true;
            }
            return false;
        },
        evaluatePage: () => ({
            isPassport: false,
            hasMrz: false,
            passportNoMatched: false,
            nameMatched: false,
            score: 0,
            reason: 'Sayfada pasaport MRZ alanı bulunamadı.'
        })
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(nextCalls, 2);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(h.reports.some((r) => r.level === 'error' && r.message.includes('MRZ')));
});

test('face detection errors (no-face, multiple-faces, unavailable) stop flow without submit', async () => {
    for (const errorCode of ['no-face', 'multiple-faces', 'unavailable']) {
        const h = createHarness({
            detectFace: async () => ({ error: errorCode })
        });

        h.flow.start('AB1234567');
        h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
        h.flow.onYoksisReady();
        await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

        assert.equal(h.getSubmitCount(), 0);
        assert.equal(h.appliedCrops.length, 0);
        assert.equal(h.flow.isActive(), false);
        assert.ok(h.reports.some((r) => r.level === 'error'));
    }
});

test('empty gender stops flow without submit and reports Cinsiyeti seçin', async () => {
    const h = createHarness({
        getGender: () => ''
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(h.reports.some((r) => r.level === 'error' && r.message.includes('Cinsiyeti seçin')));
});

test('happy path sets default medeni Bekar, applies crop, and calls submit in order', async () => {
    const expectedBox = { x: 12, y: 24, width: 180, height: 231 };
    const h = createHarness({
        detectFace: async () => expectedBox
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(h.clicks, ['read-acceptance', 'copy']);
    assert.deepEqual(h.defaultsCalls, [{ medeni: 'Bekar' }]);
    assert.deepEqual(h.appliedCrops, [expectedBox]);
    assert.equal(h.getSubmitCount(), 1);
    assert.equal(h.flow.isActive(), false);
    assert.deepEqual(h.order, [
        'click:read-acceptance',
        'click:copy',
        'setDefaults',
        'applyCrop',
        'submit'
    ]);
});

test('step exception cancels flow and reports error without submit', async () => {
    const h = createHarness({
        click: (id) => {
            if (id === 'read-acceptance') {
                throw new Error('DOM missing');
            }
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });

    assert.equal(h.flow.isActive(), false);
    assert.equal(h.getSubmitCount(), 0);
    assert.ok(h.reports.some((r) => r.level === 'error'));
});

test('image-only page with empty text continues when ensurePageText returns passport MRZ text', async () => {
    const ocrCalls = [];
    const expectedBox = { x: 15, y: 25, width: 140, height: 180 };
    const h = createHarness({
        getPages: () => [{ dataUrl: 'data:image/jpeg;base64,scan-passport', text: '' }],
        evaluatePage: evaluatePassportPage,
        ensurePageText: async (page) => {
            ocrCalls.push(page.dataUrl);
            return 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nAB12345670EXM9001011M3001015<<<<<<<<<<<<<<04';
        },
        detectFace: async () => expectedBox
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(ocrCalls, ['data:image/jpeg;base64,scan-passport']);
    assert.deepEqual(h.appliedCrops, [expectedBox]);
    assert.equal(h.getSubmitCount(), 1);
    assert.equal(h.flow.isActive(), false);
});

test('image-only page where ensurePageText returns diploma text is rejected and next source is tried', async () => {
    let sourceIdx = 0;
    const sources = [
        [{ dataUrl: 'data:image/jpeg;base64,scan-diploma', text: '   ' }],
        [{ dataUrl: 'data:image/jpeg;base64,scan-passport-2', text: '' }]
    ];
    let nextCalls = 0;

    const h = createHarness({
        getPages: () => sources[sourceIdx],
        getPageIndex: () => 0,
        selectNextSource: async () => {
            nextCalls += 1;
            if (sourceIdx + 1 < sources.length) {
                sourceIdx += 1;
                return true;
            }
            return false;
        },
        evaluatePage: evaluatePassportPage,
        ensurePageText: async (page) => {
            if (page.dataUrl.includes('diploma')) {
                return 'T.C. UNIVERSITE DIPLOMASI\nAHMET YILMAZ MEZUNIYET BELGESI';
            }
            return 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nAB12345670EXM9001011M3001015<<<<<<<<<<<<<<04';
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(nextCalls, 1);
    assert.equal(h.appliedCrops.length, 1);
    assert.equal(h.getSubmitCount(), 1);
    assert.equal(h.flow.isActive(), false);
});

test('ensurePageText throwing falls back to empty text, reports existing message, and does not submit', async () => {
    const h = createHarness({
        getPages: () => [{ dataUrl: 'data:image/jpeg;base64,scan-error', text: '' }],
        evaluatePage: evaluatePassportPage,
        ensurePageText: async () => {
            throw new Error('OCR failed');
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message.includes('Sayfada okunabilir metin bulunamadı; pasaport belgesini kontrol edin. Lütfen doğru pasaport belgesini elle seçip kırpın.')
        )
    );
});

test('each image-only page is OCRd at most once via cache and pages with text skip ensurePageText', async () => {
    let ocrCalls = 0;
    let nextCalls = 0;
    const h = createHarness({
        getPages: () => [{ dataUrl: 'data:image/jpeg;base64,scan-repeat', text: '' }],
        selectNextSource: async () => {
            nextCalls += 1;
            return nextCalls === 1;
        },
        evaluatePage: evaluatePassportPage,
        ensurePageText: async () => {
            ocrCalls += 1;
            return 'DIPLOMA BELGESI';
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(nextCalls, 2);
    assert.equal(ocrCalls, 1);
    assert.equal(h.getSubmitCount(), 0);

    let textPageOcrCalls = 0;
    const hWithText = createHarness({
        evaluatePage: evaluatePassportPage,
        ensurePageText: async () => {
            textPageOcrCalls += 1;
            return '';
        }
    });

    hWithText.flow.start('AB1234567');
    hWithText.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    hWithText.flow.onYoksisReady();
    await hWithText.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(textPageOcrCalls, 0);
    assert.equal(hWithText.getSubmitCount(), 1);
});
