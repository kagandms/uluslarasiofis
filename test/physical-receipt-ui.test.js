import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPhysicalReceiptTemplate } from '../src/services/physical-receipt-template.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import { PHYSICAL_RECEIPT_MESSAGES } from '../src/public/i18n/physical-receipt-messages.js';
import { PUBLIC_MESSAGES } from '../src/public/i18n/messages.js';
import { buildDocumentAssetUrl,waitDocumentAssets } from '../src/services/document-logo-loader.js';

const SNAPSHOT={first_name:'<script>Synthetic</script>',last_name:'Русский العربية',passport_number:'TEST',application_date:'2026-10-12',tracking_reference:'ITU-26-ABCDEFG',portal_origin:'https://portal.test'};

test('receipt HTML escapes student content and shares exactly five localized home labels',()=>{
    const dom=new JSDOM('<main></main>');

    const root=createPhysicalReceiptTemplate(dom.window.document,SNAPSHOT,{university:'data:image/png;base64,test',migration:'data:image/png;base64,test'});

    assert.equal(root.querySelector('script'),null);assert.match(root.textContent,/<script>Synthetic<\/script>/);
    assert.equal(root.querySelectorAll('section').length,5);assert.equal(root.querySelector('[lang=ar]').dir,'rtl');
    assert.equal(root.querySelector('.physical-receipt-code').dir,'ltr');assert.equal(root.querySelectorAll('img').length,2);
    for(const [locale,messages] of Object.entries(PHYSICAL_RECEIPT_MESSAGES)) {
        assert.equal(PUBLIC_MESSAGES[locale].homeTrackAction,messages.action);
        assert.ok(root.querySelector(`[lang=${locale}]`).textContent.includes(messages.action));
    }
    dom.window.close();
});

test('metadata-first creation has no PDF prerequisite and requires explicit application type',()=>{
    const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');let allocations=0;
    const state={view:'create',isMetadataFirst:true,receiptConfig:{today:'2026-10-12'},draft:{application_date:'2026-10-13',application_type:''},message:'Synthetic'};

    renderPhysicalIntakes(root,state,{assignReference:()=>{allocations++;},back:()=>{},create:()=>{}});
    [...root.querySelectorAll('button')].find(button=>button.textContent==='Başvuru No Ata').click();

    assert.equal(allocations,1);assert.match(root.textContent,/İleri bir teslim tarihi/);assert.equal(root.querySelector('select').value,'');
    assert.equal(root.querySelector('a[href^=blob]'),null);assert.equal(root.querySelector('input[type=file]'),null);
    assert.equal([...root.querySelectorAll('button')].find(button=>button.textContent==='Oluştur ve Yazdır').disabled,true);
    dom.window.close();
});

test('closed intake keeps receipt download/history and hides PDF mutation controls',()=>{
    const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');
    const intake={id:'synthetic',tracking_reference:SNAPSHOT.tracking_reference,application_date:SNAPSHOT.application_date,processing_closed_at:'2026-10-12',processing_closure_reason:'Synthetic closure',status:'under_review',metadata_version:2};

    renderPhysicalIntakes(root,{view:'detail',detail:{intake,files:[],allowed_transitions:[],receipts:[{id:'receipt',document_version:1,state:'ready',metadata_version:1}]},printAttempts:[{id:'attempt',status:'unknown',blocks_new_attempt:1}]},{});

    assert.match(root.textContent,/bu A4 güncel değil/);assert.match(root.textContent,/unknown/);assert.match(root.textContent,/ikamet izni onayı değildir/);
    assert.ok(root.querySelector('a[href*=download]'));
    assert.equal([...root.querySelectorAll('button')].some(button=>['PDF Ekle','Bilgileri Düzenle','Baskıyı Güvenle İptal Et'].includes(button.textContent)),false);
    dom.window.close();
});

test('physical code form remains first through an online owner session and locale changes',async()=>{
    const dom=new JSDOM('<main></main>',{url:'https://portal.test'});const document=dom.window.document;const root=document.querySelector('main');
    const payload={found:true,application:{id:'online',student_number:'TEST',application_type:'initial',status:'submitted'},documents:[]};
    const api={lookupApplicationTracking:async()=>payload,readCurrentApplicationTracking:async()=>payload};
    await initializeApplicationTracking(root,api);
    root.querySelector('input[name=student_number]').value='TEST';
    root.querySelector('.tracking-lookup-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await new Promise(resolve=>setImmediate(resolve));

    assert.equal(root.firstElementChild.classList.contains('physical-tracking-panel'),true);assert.ok(root.querySelector('input[name=tracking_reference]'));
    document.documentElement.lang='ar';document.dispatchEvent(new dom.window.Event('public:locale-changed'));
    assert.ok(root.querySelector('input[name=tracking_reference]'));assert.match(root.firstElementChild.textContent,/رقم متابعة الطلب/);
    dom.window.close();
});

test('shared logo readiness waits for both image decodes and rejects missing dimensions',async()=>{
    const dom=new JSDOM('<main><img><img></main>');const root=dom.window.document.querySelector('main');let decodes=0;
    for(const image of root.querySelectorAll('img')) {
        image.decode=async()=>{decodes++;};Object.defineProperty(image,'naturalWidth',{value:100,configurable:true});Object.defineProperty(image,'naturalHeight',{value:100});
    }
    Object.defineProperty(dom.window.document,'fonts',{value:{ready:Promise.resolve()}});

    await waitDocumentAssets(root);
    Object.defineProperty(root.querySelector('img'),'naturalWidth',{value:0});

    assert.equal(decodes,2);await assert.rejects(()=>waitDocumentAssets(root));assert.equal(buildDocumentAssetUrl('goc_logo.png'),'/goc_logo.png');
    dom.window.close();
});

test('metadata edits warn about future dates while preserving the assigned tracking number',()=>{
    const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');
    const intake={id:'synthetic',first_name:'Synthetic',last_name:'Student',passport_number:'TEST',application_type:'initial',application_date:'2026-10-12',tracking_reference:'ITU-26-ABCDEFG',metadata_version:1,status:'under_review'};
    const state={view:'detail',detail:{intake,files:[],receipts:[],allowed_transitions:[]},receiptConfig:{today:'2026-10-12'},isEditingMetadata:true,metadataDraft:{...intake}};

    renderPhysicalIntakes(root,state,{});
    const day=root.querySelector('input[type=date]');day.value='2027-01-01';day.dispatchEvent(new dom.window.Event('input'));

    assert.match(root.textContent,/İleri bir teslim tarihi/);assert.match(root.textContent,/ITU-26-ABCDEFG/);assert.equal(state.metadataDraft.application_date,'2027-01-01');
    dom.window.close();
});

test('new intake dialog preserves the queue DOM and never asks for a student number', () => {
    const dom = new JSDOM('<main></main>');
    const root = dom.window.document.querySelector('main');
    const state = { view: 'queue', result: { items: [], pagination: {} }, query: { q: '', status: 'all' } };
    const handlers = { newReceipt: () => {}, search: () => {}, back: () => {} };
    renderPhysicalIntakes(root, state, handlers);
    const background = root.firstElementChild;
    const search = root.querySelector('input');
    search.value = 'Preserved search';

    Object.assign(state, { view: 'create', isMetadataFirst: true, draft: { application_date: '2026-10-12' }, receiptConfig: { today: '2026-10-12' } });
    renderPhysicalIntakes(root, state, handlers);
    state.reservation = { tracking_reference: 'ITU-26-ABCDEFG', application_date: '2026-10-12' };
    renderPhysicalIntakes(root, state, handlers);

    assert.equal(root.firstElementChild, background);
    assert.equal(root.querySelector('input'), search);
    assert.equal(search.value, 'Preserved search');
    assert.ok(root.querySelector('dialog[open]'));
    assert.equal(root.querySelector('input[name=student_number]'), null);
    assert.equal(root.querySelectorAll('dialog').length, 1);
    state.view = 'queue';
    renderPhysicalIntakes(root, state, handlers);
    assert.equal(root.querySelector('dialog'), null);
    dom.window.close();
});
