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

test('5-page source with passport on page 5 calls selectPage(4) once, then detectFace, applyCrop, and submit', async () => {
    const selectPageCalls = [];
    const detectFaceUrls = [];
    const expectedBox = { x: 20, y: 30, width: 160, height: 205 };
    const pages = [
        { dataUrl: 'data:image/jpeg;base64,p1', text: 'TRANSKRIPT BELGESI SAYFA 1' },
        { dataUrl: 'data:image/jpeg;base64,p2', text: 'TRANSKRIPT BELGESI SAYFA 2' },
        { dataUrl: 'data:image/jpeg;base64,p3', text: 'DIPLOMA EKI SAYFA 3' },
        { dataUrl: 'data:image/jpeg;base64,p4', text: 'KABUL MEKTUBU SAYFA 4' },
        { dataUrl: 'data:image/jpeg;base64,p5', text: 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nAB12345670EXM9001011M3001015<<<<<<<<<<<<<<04' }
    ];

    const order = [];
    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 0,
        evaluatePage: evaluatePassportPage,
        selectPage: async (index) => {
            selectPageCalls.push(index);
            order.push(`selectPage:${index}`);
            return true;
        },
        detectFace: async (imageDataUrl) => {
            detectFaceUrls.push(imageDataUrl);
            order.push('detectFace');
            return expectedBox;
        },
        applyCrop: (box) => {
            order.push('applyCrop');
            return Boolean(box);
        },
        submit: () => {
            order.push('submit');
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(selectPageCalls, [4]);
    assert.equal(h.getSelectNextCalls(), 0);
    assert.deepEqual(detectFaceUrls, ['data:image/jpeg;base64,p5']);
    assert.deepEqual(order, ['selectPage:4', 'detectFace', 'applyCrop', 'submit']);
    assert.equal(h.flow.isActive(), false);
});

test('multi-page source with all non-passport pages tries next source, then cancels when no next source remains', async () => {
    let sourceIdx = 0;
    const sources = [
        [
            { dataUrl: 'data:image/jpeg;base64,s0p0', text: 'S0-P0' },
            { dataUrl: 'data:image/jpeg;base64,s0p1', text: 'S0-P1' },
            { dataUrl: 'data:image/jpeg;base64,s0p2', text: 'S0-P2' }
        ],
        [
            { dataUrl: 'data:image/jpeg;base64,s1p0', text: 'S1-P0' },
            { dataUrl: 'data:image/jpeg;base64,s1p1', text: 'S1-P1' }
        ]
    ];
    const events = [];
    const selectPageCalls = [];
    let nextCalls = 0;

    const h = createHarness({
        getPages: () => sources[sourceIdx],
        getPageIndex: () => 0,
        selectPage: async (index) => {
            selectPageCalls.push(index);
            return true;
        },
        selectNextSource: async () => {
            nextCalls += 1;
            events.push(`nextSource:${nextCalls}`);
            if (sourceIdx + 1 < sources.length) {
                sourceIdx += 1;
                return true;
            }
            return false;
        },
        evaluatePage: ({ text }) => {
            events.push(`eval:${text}`);
            return {
                isPassport: false,
                reason: 'Sayfada pasaport MRZ alanı bulunamadı.'
            };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(events, [
        'eval:S0-P0',
        'eval:S0-P1',
        'eval:S0-P2',
        'nextSource:1',
        'eval:S1-P0',
        'eval:S1-P1',
        'nextSource:2'
    ]);
    assert.deepEqual(selectPageCalls, []);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message.includes('Lütfen doğru pasaport belgesini elle seçip kırpın.')
        )
    );
});

test('multi-page source wraps from shown page index to 0 and evaluates each page at most once per source', async () => {
    const pages = [
        { dataUrl: 'data:image/jpeg;base64,p0', text: 'PAGE-0' },
        { dataUrl: 'data:image/jpeg;base64,p1', text: 'PAGE-1' },
        { dataUrl: 'data:image/jpeg;base64,p2', text: 'PAGE-2' },
        { dataUrl: 'data:image/jpeg;base64,p3', text: 'PAGE-3' },
        { dataUrl: 'data:image/jpeg;base64,p4', text: 'PAGE-4' }
    ];
    const evaluated = [];
    const selectPageCalls = [];

    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 2,
        selectPage: async (index) => {
            selectPageCalls.push(index);
            return true;
        },
        evaluatePage: ({ text }) => {
            evaluated.push(text);
            return {
                isPassport: text === 'PAGE-1',
                reason: 'Pasaport değil.'
            };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(evaluated, ['PAGE-2', 'PAGE-3', 'PAGE-4', 'PAGE-0', 'PAGE-1']);
    assert.equal(new Set(evaluated).size, evaluated.length);
    assert.deepEqual(selectPageCalls, [1]);
    assert.equal(h.getSubmitCount(), 1);
});

test('selectPage returning false cancels with existing message and skips detectFace, applyCrop, and submit', async () => {
    const pages = [
        { dataUrl: 'data:image/jpeg;base64,p0', text: 'TRANSKRIPT' },
        { dataUrl: 'data:image/jpeg;base64,p1', text: 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nAB12345670EXM9001011M3001015<<<<<<<<<<<<<<04' }
    ];
    const selectPageCalls = [];
    let detectCalls = 0;

    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 0,
        evaluatePage: evaluatePassportPage,
        selectPage: async (index) => {
            selectPageCalls.push(index);
            return false;
        },
        detectFace: async () => {
            detectCalls += 1;
            return { x: 10, y: 20, width: 100, height: 130 };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(selectPageCalls, [1]);
    assert.equal(detectCalls, 0);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message === 'Lütfen doğru pasaport belgesini elle seçip kırpın.'
        )
    );
});

test('stale run cancelled during selectPage does not detectFace, applyCrop, or submit', async () => {
    let resolveSelectPage;
    let detectCalls = 0;
    const pages = [
        { dataUrl: 'data:image/jpeg;base64,p0', text: 'TRANSKRIPT' },
        { dataUrl: 'data:image/jpeg;base64,p1', text: 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nAB12345670EXM9001011M3001015<<<<<<<<<<<<<<04' }
    ];

    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 0,
        evaluatePage: evaluatePassportPage,
        selectPage: () => new Promise((resolve) => {
            resolveSelectPage = resolve;
        }),
        detectFace: async () => {
            detectCalls += 1;
            return { x: 10, y: 20, width: 100, height: 130 };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    const cropPromise = h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    h.flow.cancel('Kullanıcı durdurdu.');
    resolveSelectPage(true);
    await cropPromise;

    assert.equal(detectCalls, 0);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
});

test('global MAX_SOURCE_ATTEMPTS caps evaluations across many pages so loop cannot run forever', async () => {
    const pages = Array.from({ length: 25 }, (_, i) => ({
        dataUrl: `data:image/jpeg;base64,p${i}`,
        text: `NON-PASSPORT-${i}`
    }));
    let evalCount = 0;

    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 0,
        selectNextSource: async () => true,
        evaluatePage: () => {
            evalCount += 1;
            return { isPassport: false, reason: 'Pasaport değil.' };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(evalCount, 20);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(h.reports.some((r) => r.level === 'error'));
});

test('rotation 90 result calls rotatePage once, reports info, re-runs detectFace without tryRotations, applies crop, and submits', async () => {
    const detectCalls = [];
    const rotateCalls = [];
    const uprightBox = { x: 40, y: 50, width: 140, height: 180 };
    const rotatedDataUrl = 'data:image/jpeg;base64,rotated-90';
    const pages = [
        { dataUrl: 'data:image/jpeg;base64,p0', text: 'TRANSKRIPT' },
        { dataUrl: 'data:image/jpeg;base64,p1-sideways', text: 'P<EXMYILMAZ<<AHMET<<<\nAB1234567' }
    ];

    const h = createHarness({
        getPages: () => pages,
        getPageIndex: () => 0,
        evaluatePage: ({ text }) => (text.includes('P<EXMYILMAZ')
            ? {
                isPassport: true,
                hasMrz: true,
                passportNoMatched: true,
                nameMatched: true,
                score: 180,
                reason: 'Pasaport kimlik sayfası doğrulandı.'
            }
            : {
                isPassport: false,
                hasMrz: false,
                passportNoMatched: false,
                nameMatched: false,
                score: 0,
                reason: 'Sayfada pasaport MRZ alanı bulunamadı.'
            }),
        selectPage: async () => true,
        rotatePage: async (index, rotation) => {
            rotateCalls.push({ index, rotation });
            h.order.push(`rotatePage:${index}:${rotation}`);
            pages[index].dataUrl = rotatedDataUrl;
            return pages[index];
        },
        detectFace: async (imageDataUrl, aspectRatio, options) => {
            detectCalls.push({ imageDataUrl, aspectRatio, options });
            h.order.push(`detectFace:${detectCalls.length}`);
            if (detectCalls.length === 1) {
                return { x: 10, y: 10, width: 100, height: 130, rotation: 90 };
            }
            return uprightBox;
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(rotateCalls, [{ index: 1, rotation: 90 }]);
    assert.equal(detectCalls.length, 2);
    assert.deepEqual(detectCalls[0], {
        imageDataUrl: 'data:image/jpeg;base64,p1-sideways',
        aspectRatio: 35 / 45,
        options: { tryRotations: true }
    });
    assert.equal(detectCalls[1].imageDataUrl, rotatedDataUrl);
    assert.equal(detectCalls[1].options?.tryRotations ?? false, false);
    assert.deepEqual(h.appliedCrops, [uprightBox]);
    assert.equal(h.getSubmitCount(), 1);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'info' && r.message === 'Pasaport sayfası 90° döndürülüp düzeltildi.'
        )
    );
    assert.deepEqual(h.order, [
        'click:read-acceptance',
        'click:copy',
        'detectFace:1',
        'rotatePage:1:90',
        'detectFace:2',
        'setDefaults',
        'applyCrop',
        'submit'
    ]);
});

test('rotation 180 and 270 also rotate page once and report exact degree', async () => {
    for (const deg of [180, 270]) {
        const rotateCalls = [];
        const detectCalls = [];
        const uprightBox = { x: 30, y: 40, width: 120, height: 160 };

        const h = createHarness({
            rotatePage: async (index, rotation) => {
                rotateCalls.push({ index, rotation });
                return { dataUrl: `data:image/jpeg;base64,rot-${rotation}` };
            },
            detectFace: async (url, _ar, options) => {
                detectCalls.push({ url, options });
                if (detectCalls.length === 1) {
                    return { x: 5, y: 5, width: 80, height: 100, rotation: deg };
                }
                return uprightBox;
            }
        });

        h.flow.start('AB1234567');
        h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
        h.flow.onYoksisReady();
        await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

        assert.deepEqual(rotateCalls, [{ index: 0, rotation: deg }]);
        assert.equal(detectCalls[1].url, `data:image/jpeg;base64,rot-${deg}`);
        assert.equal(detectCalls[1].options, undefined);
        assert.equal(h.getSubmitCount(), 1);
        assert.ok(
            h.reports.some(
                (r) => r.level === 'info' && r.message === `Pasaport sayfası ${deg}° döndürülüp düzeltildi.`
            )
        );
    }
});

test('rotatePage returning false cancels with existing manual-crop message without second detect or submit', async () => {
    let detectCalls = 0;
    const rotateCalls = [];

    const h = createHarness({
        rotatePage: async (index, rotation) => {
            rotateCalls.push({ index, rotation });
            return false;
        },
        detectFace: async () => {
            detectCalls += 1;
            return { x: 10, y: 20, width: 100, height: 130, rotation: 90 };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.deepEqual(rotateCalls, [{ index: 0, rotation: 90 }]);
    assert.equal(detectCalls, 1);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message === 'Pasaport sayfasında yüz algılanamadı. Lütfen fotoğrafı elle kırpın.'
        )
    );
});

test('absent rotatePage dep behaves as today and cancels with manual-crop message on rotated result', async () => {
    let detectCalls = 0;

    const h = createHarness({
        detectFace: async () => {
            detectCalls += 1;
            return { x: 10, y: 20, width: 100, height: 130, rotation: 90 };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(detectCalls, 1);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message === 'Pasaport sayfasında yüz algılanamadı. Lütfen fotoğrafı elle kırpın.'
        )
    );
});

test('never rotates more than once per page and keeps manual-crop message if post-rotation detect fails', async () => {
    let rotateCalls = 0;
    let detectCalls = 0;

    const h = createHarness({
        rotatePage: async () => {
            rotateCalls += 1;
            return { dataUrl: 'data:image/jpeg;base64,rotated' };
        },
        detectFace: async () => {
            detectCalls += 1;
            if (detectCalls === 1) {
                return { x: 10, y: 20, width: 100, height: 130, rotation: 90 };
            }
            return { error: 'no-face' };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    await h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    assert.equal(rotateCalls, 1);
    assert.equal(detectCalls, 2);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.flow.isActive(), false);
    assert.ok(
        h.reports.some(
            (r) => r.level === 'error'
                && r.message.includes('Lütfen fotoğrafı elle kırpın.')
        )
    );
});

test('stale run cancelled during rotatePage does not report info, re-detect, applyCrop, or submit', async () => {
    let resolveRotate;
    let detectCalls = 0;

    const h = createHarness({
        rotatePage: () => new Promise((resolve) => {
            resolveRotate = resolve;
        }),
        detectFace: async () => {
            detectCalls += 1;
            return { x: 10, y: 20, width: 100, height: 130, rotation: 90 };
        }
    });

    h.flow.start('AB1234567');
    h.flow.onSearchDone({ studentName: 'AHMET YILMAZ', passportNo: 'AB1234567' });
    h.flow.onYoksisReady();
    const cropPromise = h.flow.onCropperReady({ aspectRatio: 35 / 45 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    h.flow.cancel('Kullanıcı iptal etti.');
    resolveRotate({ dataUrl: 'data:image/jpeg;base64,rotated' });
    await cropPromise;

    assert.equal(detectCalls, 1);
    assert.equal(h.appliedCrops.length, 0);
    assert.equal(h.getSubmitCount(), 0);
    assert.equal(h.reports.some((r) => r.message.includes('döndürülüp düzeltildi')), false);
});
