import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import '../ykn_eklenti-main/gocnet-transfer-controller.js';

const { autoSaveAndUploadGocnet } = globalThis.YoksisGocnetTransferController;

function createAutoSaveFixture({ includeSaveButton = true, includeUploadSection = false, islemKayitNo = '' } = {}) {
    const html = `<!doctype html>
<html lang="tr">
<body>
<main>
  <section>
    <h2>1. E-İkamet Başvuru Sorgulama</h2>
    <label>E-İkamet Başvuru No: <input type="text" value="2099-12-99999999"></label>
    <button type="button">Başvuru Sorgula</button>
  </section>
  <section>
    <table><tbody><tr>
      <td><span class="z-label">Mevcut GöçNet İşlem Kayıt No:</span></td>
      <td><span class="z-label" data-testid="islem-no">${islemKayitNo}</span></td>
    </tr></tbody></table>
    ${includeSaveButton ? '<button type="button" class="z-button">İşlemi Başlat / Kaydet</button>' : ''}
  </section>
  ${includeUploadSection ? `
  <section data-testid="upload-section">
    <h2>4. GöçNet Tarafından İstenen Belgeler &amp; Yükleme İşlemleri</h2>
    <table><tbody>
      <tr><td>999</td><td>Başvuru Belgeleri</td><td>Yüklenmedi</td><td><button type="button">Yükle</button><input type="file"></td></tr>
    </tbody></table>
  </section>` : ''}
</main>
</body>
</html>`;
    const dom = new JSDOM(html, { pretendToBeVisual: true });
    const pdfFile = new dom.window.File(['%PDF-1.4\n'], 'basvuru.pdf', { type: 'application/pdf' });
    return { dom, document: dom.window.document, pdfFile };
}

function wireUploadInputMock(dom) {
    const input = dom.window.document.querySelector('input[type="file"]');
    let assignedFiles = [];
    let changes = 0;
    input.addEventListener('change', () => { changes += 1; });
    dom.window.DataTransfer = class {
        files = [];
        items = { add: (item) => this.files.push(item) };
    };
    Object.defineProperty(input, 'files', {
        configurable: true,
        get: () => assignedFiles,
        set: (files) => { assignedFiles = files; }
    });
    return {
        getAssignedFiles: () => assignedFiles,
        getChanges: () => changes
    };
}

function appendUploadSection(document) {
    document.querySelector('main').insertAdjacentHTML('beforeend', `
      <section data-testid="upload-section">
        <h2>4. GöçNet Tarafından İstenen Belgeler &amp; Yükleme İşlemleri</h2>
        <table><tbody>
          <tr><td>999</td><td>Başvuru Belgeleri</td><td>Yüklenmedi</td><td><button type="button">Yükle</button><input type="file"></td></tr>
        </tbody></table>
      </section>`);
}

test('autoSaveAndUploadGocnet completes full flow: save clicked once, popup closed, upload section appears, PDF dispatched', async () => {
    const { dom, document, pdfFile } = createAutoSaveFixture();
    let saveClicks = 0;
    let popupClicks = 0;
    let uploadMock = null;

    document.querySelector('.z-button').addEventListener('click', () => {
        saveClicks += 1;
        document.querySelector('[data-testid="islem-no"]').textContent = '70001';
        document.body.insertAdjacentHTML('beforeend', `
          <div class="z-messagebox-window">
            <div class="z-window-header">Başarılı</div>
            <div class="z-messagebox">İşlem kaydı GöçNet sistemine ve yerel veritabanına başarıyla kaydedildi. İşlem Kayıt No: 70001</div>
            <button class="z-messagebox-button">Tamam</button>
          </div>`);
        document.querySelector('.z-messagebox-button').addEventListener('click', () => {
            popupClicks += 1;
            document.querySelector('.z-messagebox-window').remove();
            appendUploadSection(document);
            uploadMock = wireUploadInputMock(dom);
        });
    });

    try {
        const result = await autoSaveAndUploadGocnet(document, {
            applicationNumber: '2099-12-99999999',
            pdfFile,
            timeoutMs: 150
        });
        assert.deepEqual(result, {
            state: 'dispatched',
            saveClicked: true,
            recordId: '70001'
        });
        assert.equal(saveClicks, 1);
        assert.equal(popupClicks, 1);
        assert.equal(document.querySelector('.z-messagebox-window'), null);
        assert.ok(document.querySelector('[data-testid="upload-section"]'));
        assert.equal(uploadMock.getChanges(), 1);
        assert.equal(uploadMock.getAssignedFiles()[0], pdfFile);
    } finally {
        dom.window.close();
    }
});

test('autoSaveAndUploadGocnet skips save click when an existing record is already present', async () => {
    const { dom, document, pdfFile } = createAutoSaveFixture({
        includeSaveButton: true,
        includeUploadSection: true,
        islemKayitNo: '70001'
    });
    const uploadMock = wireUploadInputMock(dom);
    let saveClicks = 0;
    document.querySelector('.z-button').addEventListener('click', () => {
        saveClicks += 1;
    });

    try {
        const result = await autoSaveAndUploadGocnet(document, {
            applicationNumber: '2099-12-99999999',
            pdfFile,
            timeoutMs: 150
        });
        assert.deepEqual(result, {
            state: 'dispatched',
            saveClicked: false,
            recordId: '70001'
        });
        assert.equal(saveClicks, 0);
        assert.equal(uploadMock.getChanges(), 1);
        assert.equal(uploadMock.getAssignedFiles()[0], pdfFile);
    } finally {
        dom.window.close();
    }
});

test('autoSaveAndUploadGocnet resumes after interruption without clicking save a second time', async () => {
    const { dom, document, pdfFile } = createAutoSaveFixture();
    let saveClicks = 0;

    document.querySelector('.z-button').addEventListener('click', () => {
        saveClicks += 1;
        document.body.insertAdjacentHTML('beforeend', `
          <div class="z-messagebox-window">
            <div class="z-window-header">Onay</div>
            <div class="z-messagebox">Kayıt oluşturuldu.</div>
            <button class="z-messagebox-button">Tamam</button>
          </div>`);
        document.querySelector('.z-messagebox-button').addEventListener('click', () => {
            document.querySelector('.z-messagebox-window').remove();
        });
    });

    try {
        const firstRun = await autoSaveAndUploadGocnet(document, {
            applicationNumber: '2099-12-99999998',
            pdfFile,
            timeoutMs: 30
        });
        assert.deepEqual(firstRun, { state: 'unknown', reason: 'upload_section_missing' });
        assert.equal(saveClicks, 1);

        appendUploadSection(document);
        const uploadMock = wireUploadInputMock(dom);

        const retryRun = await autoSaveAndUploadGocnet(document, {
            applicationNumber: '2099-12-99999998',
            pdfFile,
            timeoutMs: 100
        });
        assert.deepEqual(retryRun, { state: 'dispatched', saveClicked: false });
        assert.equal(saveClicks, 1);
        assert.equal(uploadMock.getChanges(), 1);
        assert.equal(uploadMock.getAssignedFiles()[0], pdfFile);
    } finally {
        dom.window.close();
    }
});

test('autoSaveAndUploadGocnet returns expected reason codes on failure paths', async () => {
    // bad_input & pdf_missing / pdf_invalid
    const invalidDom = createAutoSaveFixture();
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(invalidDom.document, { applicationNumber: 'invalid', pdfFile: invalidDom.pdfFile }),
            { state: 'unknown', reason: 'bad_input' }
        );
        assert.deepEqual(
            await autoSaveAndUploadGocnet(invalidDom.document, { applicationNumber: '2099-12-99999997' }),
            { state: 'unknown', reason: 'pdf_missing' }
        );
        const badFile = new invalidDom.dom.window.File(['x'], 'bad.txt', { type: 'text/plain' });
        assert.deepEqual(
            await autoSaveAndUploadGocnet(invalidDom.document, { applicationNumber: '2099-12-99999997', pdfFile: badFile }),
            { state: 'unknown', reason: 'pdf_invalid' }
        );
    } finally {
        invalidDom.dom.window.close();
    }

    // save_button_missing
    const noSaveDom = createAutoSaveFixture({ includeSaveButton: false });
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(noSaveDom.document, {
                applicationNumber: '2099-12-99999996',
                pdfFile: noSaveDom.pdfFile,
                timeoutMs: 30
            }),
            { state: 'unknown', reason: 'save_button_missing' }
        );
    } finally {
        noSaveDom.dom.window.close();
    }

    // save_no_response
    const noRespDom = createAutoSaveFixture();
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(noRespDom.document, {
                applicationNumber: '2099-12-99999995',
                pdfFile: noRespDom.pdfFile,
                timeoutMs: 30
            }),
            { state: 'unknown', reason: 'save_no_response' }
        );
    } finally {
        noRespDom.dom.window.close();
    }

    // save_failed
    const errorDom = createAutoSaveFixture();
    errorDom.document.querySelector('.z-button').addEventListener('click', () => {
        errorDom.document.body.insertAdjacentHTML('beforeend', `
          <div class="z-messagebox-window">
            <div class="z-window-header">Hata</div>
            <div class="z-messagebox">Kayıt başarısız.</div>
            <button class="z-messagebox-button">Tamam</button>
          </div>`);
    });
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(errorDom.document, {
                applicationNumber: '2099-12-99999994',
                pdfFile: errorDom.pdfFile,
                timeoutMs: 50
            }),
            { state: 'unknown', reason: 'save_failed' }
        );
    } finally {
        errorDom.dom.window.close();
    }

    // save_popup_ack_failed
    const noTamamDom = createAutoSaveFixture();
    noTamamDom.document.querySelector('.z-button').addEventListener('click', () => {
        noTamamDom.document.body.insertAdjacentHTML('beforeend', `
          <div class="z-messagebox-window">
            <div class="z-window-header">Bilgi</div>
            <div class="z-messagebox">Onay bekleniyor.</div>
          </div>`);
    });
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(noTamamDom.document, {
                applicationNumber: '2099-12-99999993',
                pdfFile: noTamamDom.pdfFile,
                timeoutMs: 50
            }),
            { state: 'unknown', reason: 'save_popup_ack_failed' }
        );
    } finally {
        noTamamDom.dom.window.close();
    }

    // pdf_dispatch_failed (DataTransfer missing)
    const dispatchFailDom = createAutoSaveFixture({ includeUploadSection: true, islemKayitNo: '70002' });
    try {
        assert.deepEqual(
            await autoSaveAndUploadGocnet(dispatchFailDom.document, {
                applicationNumber: '2099-12-99999992',
                pdfFile: dispatchFailDom.pdfFile,
                timeoutMs: 50
            }),
            { state: 'unknown', reason: 'pdf_dispatch_failed' }
        );
    } finally {
        dispatchFailDom.dom.window.close();
    }
});

test('autoSaveAndUploadGocnet accepts base64 PDF with SHA-256 verification', async () => {
    const { dom, document } = createAutoSaveFixture({
        includeSaveButton: false,
        includeUploadSection: true,
        islemKayitNo: '70003'
    });
    const uploadMock = wireUploadInputMock(dom);
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const pdfBase64 = pdfBytes.toString('base64');
    const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');

    try {
        const result = await autoSaveAndUploadGocnet(document, {
            applicationNumber: '2099-12-99999991',
            pdfBase64,
            pdfSha256,
            pdfFileName: 'staff-doc.pdf',
            timeoutMs: 100
        });
        assert.deepEqual(result, {
            state: 'dispatched',
            saveClicked: false,
            recordId: '70003'
        });
        assert.equal(uploadMock.getChanges(), 1);
        assert.equal(uploadMock.getAssignedFiles()[0]?.name, 'staff-doc.pdf');
        assert.equal(uploadMock.getAssignedFiles()[0]?.type, 'application/pdf');
    } finally {
        dom.window.close();
    }
});
