import test from 'node:test';
import assert from 'node:assert/strict';
import { startPhysicalReceiptDraft,assignPhysicalReference,savePhysicalReceiptDraft,recoverPhysicalReceiptRegistration,sendPhysicalReceiptPrint } from '../src/staff/physical-receipt-workflow.js';

function createContext() {
    const context={state:{receiptConfig:{today:'2026-10-12'},detail:{intake:{id:'old',first_name:'Never copy this'}}},api:{}};
    startPhysicalReceiptDraft(context);
    context.state.draft={...context.state.draft,first_name:'Synthetic',last_name:'Student',passport_number:'TEST',application_type:'initial'};
    context.state.reservation={id:crypto.randomUUID(),application_date:'2026-10-12'};
    return context;
}

async function withStorage(work) {
    const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');const values=new Map();
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
    try {await work(values);}
    finally {if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage;}
}

test('fresh drafts use server today, explicit type and never copy the previous student',async()=>{
    const context={state:{receiptConfig:{today:'2027-01-01'},detail:{intake:{first_name:'Previous',passport_number:'OLD'}}},api:{}};

    startPhysicalReceiptDraft(context);
    context.api.reserve=async body=>({id:'reserved',...body});await assignPhysicalReference(context);

    assert.equal(context.state.draft.application_date,'2027-01-01');assert.equal(context.state.draft.application_type,'');
    assert.equal(context.state.draft.first_name,'');assert.equal(context.state.draft.passport_number,'');assert.equal(context.state.reservation.draft_id,context.state.registrationId);
});

test('a lost registration response freezes the normalized operation and retries the same UUID/body',async()=>withStorage(async values=>{
    const context=createContext();const requests=[];
    context.api.registerMetadata=async body=>{
        requests.push(structuredClone(body));
        if(requests.length===1)throw Object.assign(new Error('Synthetic network loss'),{code:'NETWORK_ERROR'});
        return {intake:{id:body.registration_id}};
    };

    await assert.rejects(()=>savePhysicalReceiptDraft(context));
    context.state.draft.first_name='Uncertain edited value';
    const saved=await savePhysicalReceiptDraft(context);

    assert.deepEqual(requests[0],requests[1]);assert.equal(saved.intake.id,context.state.registrationId);assert.equal(values.size,0);
}));

test('definitive validation or reservation expiry unlocks correction and fresh allocation',async()=>withStorage(async()=>{
    for(const rejection of [{status:400,code:'VALIDATION_ERROR'},{status:409,code:'RESERVATION_EXPIRED'}]) {
        const context=createContext();context.api.registerMetadata=async()=>{throw Object.assign(new Error('Synthetic rejected request'),rejection);};

        await assert.rejects(()=>savePhysicalReceiptDraft(context));

        assert.equal(context.state.registrationBody,null);
        if(rejection.code==='RESERVATION_EXPIRED')assert.equal(context.state.reservation,null);
    }
}));

test('recovery checks only the pending operation UUID and finds the same student after login',async()=>withStorage(async()=>{
    const context=createContext();context.api.registerMetadata=async()=>{throw new Error('Synthetic network loss');};await assert.rejects(()=>savePhysicalReceiptDraft(context));
    context.api.detail=async id=>({intake:{id}});

    const recovered=await recoverPhysicalReceiptRegistration(context);

    assert.equal(recovered.intake.id,context.state.registrationId);assert.equal(await recoverPhysicalReceiptRegistration(context),null);
}));

test('a lost print response retries the same attempt UUID without rendering a different receipt',async()=>{
    const context=createContext();const receiptId=crypto.randomUUID();const requests=[];
    context.state.detail={intake:{id:'student',metadata_version:1},receipts:[{id:receiptId,state:'ready',metadata_version:1,snapshot_json:JSON.stringify({portal_origin:'https://portal.test'})}]};
    context.api.document=async()=>({id:receiptId,state:'ready'});
    context.api.printDocument=async(_id,_receiptId,body)=>{
        requests.push(body);if(requests.length===1)throw new Error('Synthetic network loss');return {status:'queued',id:'same-attempt'};
    };

    await assert.rejects(()=>sendPhysicalReceiptPrint(context));
    const result=await sendPhysicalReceiptPrint(context);

    assert.equal(requests[0].creation_id,requests[1].creation_id);assert.equal(result.status,'queued');assert.equal(context.state.printCreationId,null);
});

test('creation prepares the stored PDF without entering detail or sending a print job', async () => withStorage(async () => {
    const { saveAndPreparePhysicalReceipt } = await import('../src/staff/physical-receipt-workflow.js');
    const context = createContext();
    let registrations = 0;
    const receipt = { id: 'receipt', state: 'ready' };
    context.api.registerMetadata = async () => { registrations++; return { intake: { id: 'saved' } }; };
    context.api.detail = async () => ({ intake: { id: 'saved', metadata_version: 1 }, receipts: [{ ...receipt, metadata_version: 1, snapshot_json: JSON.stringify({ portal_origin: 'https://portal.test' }) }] });
    context.api.document = async () => receipt;
    context.api.printDocument = async () => { assert.fail('creation must not send a printer job'); };

    assert.equal(await saveAndPreparePhysicalReceipt(context), receipt);
    assert.equal(await saveAndPreparePhysicalReceipt(context), receipt);

    assert.equal(context.state.view, 'create');
    assert.equal(context.state.savedIntakeId, 'saved');
    assert.equal(registrations, 1);
}));

test('preloads PDF in background and reuses it if snapshot matches', async () => withStorage(async () => {
    const { preparePhysicalReceiptDocument, buildReceiptSnapshotKey } = await import('../src/staff/physical-receipt-workflow.js');
    const context = createContext();
    const syntheticBytes = new Uint8Array([37, 80, 68, 70, 45]);
    const snapshot = {
        first_name: 'Synthetic',
        last_name: 'Student',
        passport_number: 'TEST',
        application_date: '2026-10-12',
        tracking_reference: 'ITU-26-SYNTHET',
        portal_origin: 'https://portal.test'
    };
    context.state.preloadedReceiptKey = buildReceiptSnapshotKey(snapshot);
    context.state.preloadedReceiptPromise = Promise.resolve(syntheticBytes);
    context.state.detail = {
        intake: { id: 'saved', metadata_version: 1, lock_version: 1 },
        receipts: [{ id: 'receipt', state: 'awaiting_content', metadata_version: 1, snapshot }]
    };
    let uploadedBytes = null;
    let deliveredBytes = null;
    context.api.uploadDocument = async (_id, _receiptId, bytes) => {
        uploadedBytes = bytes;
        return { id: 'receipt', state: 'ready' };
    };

    const result = await preparePhysicalReceiptDocument(context, {
        onBytesReady: bytes => { deliveredBytes = bytes; }
    });

    assert.equal(result.state, 'ready');
    assert.equal(deliveredBytes, syntheticBytes);
    assert.equal(uploadedBytes, syntheticBytes);
    assert.equal(context.state.preloadedReceiptPromise, null);
}));


test('reference allocation ignores repeated and concurrent actions until a new draft', async () => {
    const context = { state: { draft: { application_date: '2026-10-12' }, registrationId: 'draft' }, api: {} };
    let allocations = 0;
    let resolveReservation;
    context.api.reserve = () => { allocations++; return new Promise(resolve => { resolveReservation = resolve; }); };

    const first = assignPhysicalReference(context);
    await assignPhysicalReference(context);
    resolveReservation({ tracking_reference: 'ITU-26-ABCDEFG' });
    await first;
    await assignPhysicalReference(context);

    assert.equal(allocations, 1);
    assert.equal(context.state.isAssigningReference, false);
});

test('failed reference allocation can be retried', async () => {
    const context = { state: { draft: { application_date: '2026-10-12' } }, api: { reserve: async () => { throw new Error('Unavailable'); } } };

    await assert.rejects(() => assignPhysicalReference(context), /Unavailable/);
    context.api.reserve = async () => ({ tracking_reference: 'ITU-26-ABCDEFG' });
    await assignPhysicalReference(context);

    assert.equal(context.state.reservation.tracking_reference, 'ITU-26-ABCDEFG');
});
