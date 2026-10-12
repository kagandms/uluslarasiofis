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
