import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestUploadedVersion, readOnlyVersionReport, assertUploadHead, assertPreflightVersion } from '../scripts/ci/worker-version.mjs';
import { publishPrepared, inheritWorkerMetadata, cloudflareClient } from '../scripts/ci/worker-upload.mjs';
import { assertProductionRuntimeSecretMetadata } from '../scripts/ci/runtime-secret-metadata.mjs';
import { assertStagedVersion } from '../scripts/ci/worker-settings.mjs';
const active='11111111-1111-1111-1111-111111111111';
const candidate='22222222-2222-2222-2222-222222222222';
const other='33333333-3333-3333-3333-333333333333';
const sha='a'.repeat(40);
const deployments=id=>({deployments:[{created_on:'2026-10-16T06:00:00Z',versions:[{version_id:id,percentage:100}]}]});
const versions=id=>({items:[{id,number:2},{id:other,number:1}]});
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
// Reviewed names only, synthetic type metadata. No runtime values are loaded.
const names=['APPS_SCRIPT_API_KEY','APPS_SCRIPT_URL','AZURE_VISION_ENDPOINT','AZURE_VISION_KEY','D1_ANALYTICS_API_TOKEN',
    'PRINTER_SECRET','PRINT_R2_ACCESS_KEY_ID','PRINT_R2_SECRET_ACCESS_KEY','R2_ACCESS_KEY_ID','R2_ACCOUNT_ID',
    'R2_SECRET_ACCESS_KEY','SCANNER_SECRET','STAFF_BOOTSTRAP_TOKEN'];
const settings={compatibility_date:config.compatibility_date,compatibility_flags:[],bindings:[
    {name:'ASSETS',type:'assets'},{name:'DB',type:'d1',database_id:'synthetic'},
    {name:'DOCUMENTS',type:'r2_bucket',bucket_name:'synthetic-documents'},
    {name:'PRINT_FILES',type:'r2_bucket',bucket_name:'synthetic-print'},
    ...names.map(name=>({name,type:'secret_text'}))]};
const metadata={main_module:'index.js',compatibility_date:settings.compatibility_date};
function fakeTransport(change={}) {
    let uploaded=false, reads=0;const writes=[];
    return { writes, api:async(path,options={})=>{
        if(!options.method){
            if(path.endsWith('/deployments'))return deployments(change.active || active);
            if(path.endsWith('/versions')){
                reads++;
                return versions(uploaded ? (change.afterUpload || candidate) : (reads===1 ? (change.initialLatest || active) : (change.afterAssets || active)));
            }
            throw Error('Unreviewed read');
        }
        writes.push({path,options});
        if(path.endsWith('/assets-upload-session'))return{jwt:'synthetic-session',buckets:[]};
        if(path==='/workers/scripts/goc/versions?bindings_inherit=strict'){
            const payload=JSON.parse(options.body.get('metadata'));
            assert.ok(payload.bindings.filter(b=>b.type==='inherit').every(b=>b.version_id==='latest'), '10057 latest-only API contract');
            assert.equal(payload.bindings.length,settings.bindings.length);uploaded=true;return{id:candidate};
        }
        if(path.endsWith('/deployments'))return{};
        throw Error('Unreviewed write');
    }};
}
const publish=io=>publishPrepared({bundle:{form:new FormData(),metadata},plan:{manifest:{},byHash:new Map()},
    settings,sha,activeVersion:active,api:io.api,beforeActivation:async()=>{}});

test('10057: every inherited binding uses latest, never a UUID; strict endpoint is unchanged',async()=>{
    const io=fakeTransport();await publish(io);
    assert.deepEqual(io.writes.map(c=>c.path),['/workers/scripts/goc/assets-upload-session','/workers/scripts/goc/versions?bindings_inherit=strict','/workers/scripts/goc/deployments']);
    const payload=JSON.parse(io.writes[1].options.body.get('metadata'));
    assert.deepEqual(payload.bindings.map(b=>b.name).sort(),settings.bindings.map(b=>b.name).sort());
    assert.deepEqual(payload.bindings.find(b=>b.name==='ASSETS'),{name:'ASSETS',type:'assets'});
    assert.ok(!JSON.stringify(payload.bindings).includes(active));
});
for(const [name,change,expectedWrites] of [
    ['inactive latest before staging',{initialLatest:other},0],
    ['active changed before staging',{active:other},0],
    ['latest changed during asset upload',{afterAssets:other},1],
    ['external upload after our candidate',{afterUpload:other},2]
])test(`10057: ${name} blocks safely without activation or retries`,async()=>{
    const io=fakeTransport(change);await assert.rejects(publish(io));
    assert.equal(io.writes.length,expectedWrites);
    assert.ok(!io.writes.some(w=>w.path.endsWith('/deployments')));
});
test('missing/invalid/unordered latest metadata blocks rather than guessing active equals latest',()=>{
    for(const value of [undefined,{items:[]},{items:[{id:'invalid',number:1}]},{items:[{id:active}]},
        {items:[{id:active,number:1},{id:other,number:2}]},{items:[{id:active,number:2},{id:other,number:2}]}])assert.throws(()=>latestUploadedVersion(value));
    assert.equal(latestUploadedVersion(versions(active)),active);
});
test('read-only diagnostic reports actual active/latest IDs and deployment time, including mismatch',()=>{
    assert.deepEqual(readOnlyVersionReport(deployments(active),versions(other)),{worker:'goc',active_version:active,
        latest_uploaded_version:other,deployed_at:'2026-10-16T06:00:00.000Z',latest_matches_active:false});
    assert.equal(readOnlyVersionReport(deployments(active),versions(active)).latest_matches_active,true);
    const bad=deployments(active);delete bad.deployments[0].created_on;
    assert.throws(()=>readOnlyVersionReport(bad,versions(active)));
});
test('all 13 runtime secret names plus D1/R2 and ASSETS must survive staged metadata verification',()=>{
    assertProductionRuntimeSecretMetadata(names.map(name=>({name,type:'secret_text'})),config.env.production.secrets.required);
    const inherited=inheritWorkerMetadata(metadata,settings,sha,'synthetic',active);
    assert.ok(inherited.bindings.filter(b=>b.type==='inherit').every(b=>b.version_id==='latest' && !('text' in b)));
    const staged={annotations:{'workers/message':`release:${sha}`},resources:{bindings:settings.bindings,
        script_runtime:{compatibility_date:settings.compatibility_date},script:{handlers:['fetch','scheduled']}}};
    const previous={handlers:['fetch','scheduled']};assertStagedVersion(staged,previous,settings,sha);
    for(const binding of settings.bindings){
        const bad=structuredClone(staged);bad.resources.bindings=bad.resources.bindings.filter(b=>b.name!==binding.name);
        assert.throws(()=>assertStagedVersion(bad,previous,settings,sha),binding.name);
    }
});
test('metadata read failure stops before all writes; unfiltered list endpoint is GET-only',async()=>{
    let count=0;await assert.rejects(assertUploadHead(async()=>{count++;throw Error('denied');},active));assert.equal(count,2);
    const calls=[];const api=cloudflareClient('a'.repeat(32),'synthetic',async(url,opts)=>{
        calls.push(opts.method || 'GET');return{ok:true,json:async()=>({success:true,result:versions(active)})};
    });
    await api('/workers/scripts/goc/versions');await assert.rejects(api('/workers/scripts/goc/versions',{method:'POST'}));
    await assert.rejects(api('/workers/scripts/goc/versions?deployable=true'));
    assert.deepEqual(calls,['GET']);
});
test('read-only diagnostics stay in existing preflight and preserve manual publication gate',()=>{
    const preflight=readFileSync(new URL('../scripts/ci/cloudflare-preflight.mjs',import.meta.url),'utf8');
    const workflow=readFileSync(new URL('../.github/workflows/production-release.yml',import.meta.url),'utf8');
    assert.match(preflight,/GITHUB_STEP_SUMMARY/);assert.match(preflight,/readOnlyVersionReport/);
    assert.match(preflight,/await assertPreflightVersion/);
    assert.match(workflow,/default: preflight/);assert.match(workflow,/inputs.operation == 'publish'/);
});
test('ordinary preflight refuses a different latest; staged preflight accepts only its verified same-SHA candidate',async()=>{
    const ordinary=readOnlyVersionReport(deployments(active),versions(active));
    const staged=readOnlyVersionReport(deployments(active),versions(candidate));
    await assertPreflightVersion(ordinary);
    await assert.rejects(assertPreflightVersion(staged));
    const context={staged:candidate,operation:'publish',approvedActive:active,sha};
    const reader=async id=>{assert.equal(id,candidate);return{annotations:{'workers/message':`release:${sha}`}};};
    await assertPreflightVersion(staged,context,reader);
    for(const override of [{staged:'latest'},{operation:'preflight'},{approvedActive:other},{sha:'short'}])
        await assert.rejects(assertPreflightVersion(staged,{...context,...override},reader));
    await assert.rejects(assertPreflightVersion(staged,context,async()=>({annotations:{'workers/message':'unapproved'}})));
    await assert.rejects(assertPreflightVersion({...staged,latest_uploaded_version:other},context,reader));
});
test('post-publication preflight accepts only the active version annotated with the exact release SHA', async () => {
    const activeRelease = readOnlyVersionReport(deployments(candidate), versions(candidate));
    await assertPreflightVersion(activeRelease, {
        expectedActiveReleaseSha: sha,
        approvedActive: active
    }, async id => {
        assert.equal(id, candidate);
        return { annotations: { 'workers/message': `release:${sha}` } };
    });
    await assert.rejects(assertPreflightVersion(activeRelease, {
        expectedActiveReleaseSha: 'c'.repeat(40),
        approvedActive: active
    }, async () => ({ annotations: { 'workers/message': `release:${sha}` } })));
});
