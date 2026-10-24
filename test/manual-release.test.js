import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { releaseWithPorts } from '../scripts/ci/exact-artifact-release.mjs';
import { verifyCodeOnlyScope, protectedPaths } from '../scripts/ci/code-only-scope.mjs';
import { singleWorkerVersion } from '../scripts/ci/worker-version.mjs';
import { cloudflareClient, inheritWorkerMetadata, publishPrepared, uploadAssets, readPreparedBundle, assetPlan, digest } from '../scripts/ci/worker-upload.mjs';
import { assertWorkerSettings, settingsSnapshot, assertStagedVersion } from '../scripts/ci/worker-settings.mjs';

const sha = 'a'.repeat(40), old = '11111111-1111-1111-1111-111111111111', next = '22222222-2222-2222-2222-222222222222';
function ports(fail) {
    const calls = []; let active = 0;
    const io = Object.fromEntries(['verifySource', 'verifyArtifact', 'verifyScope', 'preflight', 'verifyLedger', 'verifyPreservedSettings', 'health', 'record'].map(name => [name, async () => {
        calls.push(name); if (fail === name) throw Error('synthetic failure');
    }]));
    io.activeVersion = async () => (++active === 1 ? { id: old, release_sha: null } : { id: next, release_sha: sha });
    io.publish = async () => { calls.push('publish'); if (fail === 'publish') throw Error('uncertain'); return next; };
    return { calls, io };
}
const context = { sha, approvedCurrentVersion: old };
test('manual publisher verifies all guards and confirms exact active version/source and health', async () => {
    const { io, calls } = ports(); await releaseWithPorts({ enabled: true }, context, io);
    assert.deepEqual(calls, ['verifySource', 'verifyArtifact', 'verifyScope', 'preflight', 'verifyLedger', 'verifySource', 'verifyArtifact',
        'publish', 'verifyArtifact', 'verifyPreservedSettings', 'preflight', 'health', 'record']);
});
for (const fail of ['verifySource', 'verifyArtifact', 'verifyScope', 'preflight', 'verifyLedger', 'publish', 'verifyPreservedSettings', 'health']) {
    test(`publisher stops on ${fail}; never retries or rolls back`, async () => {
        const { io, calls } = ports(fail);
        await assert.rejects(releaseWithPorts({ enabled: true }, context, io));
        assert.ok(calls.filter(x => x === 'publish').length <= (['publish', 'verifyPreservedSettings', 'health'].includes(fail) ? 1 : 0));
        assert.ok(!calls.some(x => /rollback|migration|restore/.test(x)));
    });
}
test('disabled policy, malformed SHA, changed live version and duplicate source cannot publish', async () => {
    for (const [policy, ctx, existing] of [[{enabled:false},context,null], [{enabled:true},{...context,sha:'short'},null],
        [{enabled:true},{...context,approvedCurrentVersion:next},null], [{enabled:true},context,sha]]) {
        const { io, calls } = ports(); if(existing) io.activeVersion=async()=>({id:old,release_sha:existing});
        await assert.rejects(releaseWithPorts(policy,ctx,io)); assert.ok(!calls.includes('publish'));
    }
});
test('wrong uploaded version or source annotation fails before health', async()=>{
    for(const value of [{id:old,release_sha:sha},{id:next,release_sha:null}]){
        const {io,calls}=ports();let count=0;io.activeVersion=async()=>++count===1?{id:old,release_sha:null}:value;
        await assert.rejects(releaseWithPorts({enabled:true},context,io));assert.ok(!calls.includes('health'));
    }
});
test('only one fully active immutable Worker version is accepted',()=>{
    assert.equal(singleWorkerVersion({deployments:[{versions:[{version_id:old,percentage:100}]}]}),old);
    for(const versions of [[],[{version_id:old,percentage:50},{version_id:next,percentage:50}],[{version_id:'bad',percentage:100}]])
        assert.throws(()=>singleWorkerVersion({deployments:[{versions}]}));
});
test('code-only scope rejects schema/storage/secret configuration edits against reviewed baseline',()=>{
    const root=mkdtempSync(join(tmpdir(),'code-only-'));const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
    try {
        git('init','--initial-branch=production');git('-c','user.name=Synthetic','-c','user.email=ci@example.invalid','commit','--allow-empty','-m','baseline');
        const baseline=git('rev-parse','HEAD');
        const run=args=>git(...args);verifyCodeOnlyScope(baseline,baseline,run);
        for(const path of protectedPaths){
            const p=path==='migrations'?'migrations/new.sql':path;mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),'synthetic');
            git('add','.');git('-c','user.name=Synthetic','-c','user.email=ci@example.invalid','commit','-m','synthetic configuration change');
            assert.throws(()=>verifyCodeOnlyScope(baseline,git('rev-parse','HEAD'),run));
        }
        assert.throws(()=>verifyCodeOnlyScope('invalid',baseline,run));
    }finally{rmSync(root,{recursive:true,force:true});}
});
test('Cloudflare transport is target-restricted, sanitizes errors and never retries even on 429/503/timeout',async()=>{
    for(const status of [403,429,503]){
        let calls=0;const api=cloudflareClient('a'.repeat(32),'synthetic',async(url,opts)=>{
            calls++;assert.equal(new URL(url).hostname,'api.cloudflare.com');assert.equal(opts.redirect,'error');
            return{ok:false,status,json:async()=>({success:false,errors:[{code:10000,message:'PRIVATE_PROVIDER_PAYLOAD'}]})};
        });
        await assert.rejects(api('/workers/scripts/goc/deployments',{method:'POST'}),e=>!e.message.includes('PRIVATE_PROVIDER_PAYLOAD'));
        assert.equal(calls,1);
        for(const path of ['/workers/scripts/other/deployments','/workers/scripts/goc/../other/deployments','/workers/scripts/goc/settings'])
            await assert.rejects(api(path,{method:'POST'}));
        assert.equal(calls,1);
    }
    let calls=0;await assert.rejects(cloudflareClient('a'.repeat(32),'synthetic',async()=>{calls++;throw Error('private');})('/workers/scripts/goc/deployments'));assert.equal(calls,1);
});
test('Cloudflare transport permits only the protected cron schedules PUT for configuration writes',async()=>{
    const requests=[];const api=cloudflareClient('a'.repeat(32),'synthetic',async(url,options)=>{
        requests.push({url,options});return{ok:true,status:200,json:async()=>({success:true,result:{schedules:[{cron:'*/5 * * * *'}]}})};
    });
    await api('/workers/scripts/goc/schedules');
    await api('/workers/scripts/goc/schedules',{method:'PUT',headers:{'content-type':'application/json'},body:'[{"cron":"*/5 * * * *"}]'});
    assert.equal(requests.length,2);
    assert.equal(new URL(requests[1].url).pathname,'/client/v4/accounts/'+ 'a'.repeat(32) + '/workers/scripts/goc/schedules');
    assert.equal(requests[1].options.method,'PUT');
    await assert.rejects(api('/workers/scripts/goc/schedules',{method:'POST'}));
    await assert.rejects(api('/workers/scripts/goc/settings',{method:'PUT'}));
    assert.equal(requests.length,2);
});
const settings={compatibility_date:'2026-09-28',compatibility_flags:[],bindings:[{name:'ASSETS',type:'assets'},{name:'DB',type:'d1',id:'synthetic'},
    {name:'DOCUMENTS',type:'r2_bucket'},{name:'PRINT_FILES',type:'r2_bucket'},{name:'SECRET',type:'secret_text'},{name:'PRINT_ENABLED',type:'plain_text',text:'true'}],
    observability:{enabled:true},placement:{mode:'smart'},limits:{cpu_ms:100},logpush:true};
test('upload inherits binding/secret values and versioned settings; never writes cron or non-versioned settings',()=>{
    const value=inheritWorkerMetadata({main_module:'index.js',compatibility_date:'2026-09-28',compatibility_flags:[]},settings,sha,'synthetic-asset-token',old);
    assert.deepEqual(value.bindings.slice(1),settings.bindings.slice(1).map(b=>({name:b.name,type:'inherit',version_id:'latest'})));
    assert.deepEqual(value.placement,settings.placement);assert.deepEqual(value.limits,settings.limits);
    assert.ok(!value.observability&&!value.logpush&&!value.triggers&&!value.migrations);
    assert.throws(()=>inheritWorkerMetadata({compatibility_date:'other'},settings,sha,'synthetic',old));
});
test('unknown/duplicate/missing non-secret bindings and compatibility drift stop preflight',()=>{
    const prod={vars:{PRINT_ENABLED:'true'},r2_buckets:[{binding:'DOCUMENTS'},{binding:'PRINT_FILES'}]};
    assertWorkerSettings(settings,prod,'2026-09-28');
    for(const bindings of [settings.bindings.slice(1),[...settings.bindings,{name:'UNREVIEWED',type:'kv_namespace'}],[...settings.bindings,settings.bindings[0]]])
        assert.throws(()=>assertWorkerSettings({...settings,bindings},prod,'2026-09-28'));
    assert.throws(()=>assertWorkerSettings(settings,prod,'different'));
    assert.equal(settingsSnapshot({...settings,bindings:[{name:'S',type:'secret_text',text:'MUST_NOT_CAPTURE'}]}).bindings[0].text,undefined);
});
test('activation uses only staged candidate at 100%, once, after final source/live checks',async()=>{
    const calls=[];const form=new FormData();form.set('metadata','{}');let uploaded=false;
    await publishPrepared({bundle:{form,metadata:{main_module:'index.js',compatibility_date:'2026-09-28'}},plan:{manifest:{},byHash:new Map()},settings,sha,activeVersion:old,
        api:async(path,opts={})=>{
            if(!opts.method){if(path.endsWith('/deployments'))return{deployments:[{versions:[{version_id:old,percentage:100}]}]};
                return{items:[{id:uploaded?next:old,number:uploaded?2:1}]};}
            calls.push(path);if(path.endsWith('assets-upload-session'))return{jwt:'synthetic',buckets:[]};
            if(path.includes('/versions?')){const metadata=JSON.parse(opts.body.get('metadata'));assert.equal(metadata.annotations['workers/message'],`release:${sha}`);uploaded=true;return{id:next};}
            assert.deepEqual(JSON.parse(opts.body).versions,[{version_id:next,percentage:100}]);return{};},
        beforeActivation:async id=>{assert.equal(id,next);calls.push('final-check');}});
    assert.deepEqual(calls,['/workers/scripts/goc/assets-upload-session','/workers/scripts/goc/versions?bindings_inherit=strict','final-check','/workers/scripts/goc/deployments']);
});
test('staging failure or final guard failure cannot activate; failed activation is never repeated',async()=>{
    for(const fail of ['assets','version','guard','activation']){
        const calls=[];let uploaded=false;await assert.rejects(publishPrepared({bundle:{form:new FormData(),metadata:{main_module:'index.js',compatibility_date:'2026-09-28'}},
            plan:{manifest:{},byHash:new Map()},settings,sha,activeVersion:old,api:async(path,opts={})=>{
                if(!opts.method){if(path.endsWith('/deployments'))return{deployments:[{versions:[{version_id:old,percentage:100}]}]};
                    return{items:[{id:uploaded?next:old,number:uploaded?2:1}]};}
                calls.push(path);if(path.endsWith('assets-upload-session')){if(fail==='assets')throw Error();return{jwt:'synthetic',buckets:[]};}
                if(path.includes('/versions?')){if(fail==='version')throw Error();uploaded=true;return{id:next};}throw Error('activation failed');
            },beforeActivation:async()=>{if(fail==='guard')throw Error();}}));
        assert.equal(calls.filter(p=>p.endsWith('/deployments')).length,fail==='activation'?1:0);
    }
});
test('asset uploader accepts requested tested hashes only, never leaks tokens into metadata records',async()=>{
    const plan={manifest:{'/index.html':{hash:'hash',size:2}},byHash:new Map([['hash',{bytes:Buffer.from('ok'),type:'text/html'}]])};
    let count=0;const token=await uploadAssets(plan,async(path,opts,credential)=>{
        if(++count===1)return{jwt:'private-session',buckets:[['hash']]};
        assert.equal(path,'/workers/assets/upload?base64=true');assert.equal(credential,'private-session');
        assert.equal(await opts.body.get('hash').text(),Buffer.from('ok').toString('base64'));return{jwt:'private-completion'};
    });assert.equal(token,'private-completion');assert.equal(count,2);
    await assert.rejects(uploadAssets(plan,async()=>({jwt:'synthetic',buckets:[['unknown']]})));
});
test('local serialization preserves original code and map bytes, rejects changed module bytes',async()=>{
    const root=mkdtempSync(join(tmpdir(),'tested-bundle-'));
    try{
        const dir=join(root,'dist/uluslarasiofis_local');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'index.js'),'export default {};');writeFileSync(join(dir,'index.js.map'),'original map');
        const form=new FormData();form.set('metadata',JSON.stringify({main_module:'index.js'}));form.set('index.js',new Blob(['export default {};']), 'index.js');form.set('index.js.map',new Blob(['rewritten map']),'index.js.map');
        const result=await readPreparedBundle(Buffer.from(await new Response(form).arrayBuffer()),root);assert.equal(await result.form.get('index.js.map').text(),'original map');
        form.set('index.js',new Blob(['changed code']),'index.js');await assert.rejects(readPreparedBundle(Buffer.from(await new Response(form).arrayBuffer()),root));
    }finally{rmSync(root,{recursive:true,force:true});}
});
test('asset manifest excludes ignore file, binds exact bytes/sizes and rejects new ignore semantics',()=>{
    const root=mkdtempSync(join(tmpdir(),'asset-plan-'));
    try{mkdirSync(join(root,'dist/client'),{recursive:true});writeFileSync(join(root,'dist/client/.assetsignore'),'wrangler.json\n.dev.vars\n');
        writeFileSync(join(root,'dist/client/index.html'),'test');writeFileSync(join(root,'candidate-artifact.json'),JSON.stringify({files:[{path:'client/index.html',bytes:4,sha256:digest('test')},{path:'client/.assetsignore'}]}));
        assert.deepEqual(Object.keys(assetPlan(root).manifest),['/index.html']);writeFileSync(join(root,'dist/client/index.html'),'tampered');assert.throws(()=>assetPlan(root));
        writeFileSync(join(root,'dist/client/.assetsignore'),'*');assert.throws(()=>assetPlan(root));
    }finally{rmSync(root,{recursive:true,force:true});}
});
test('real publisher CLI rejects non-dispatch/non-production/unapproved invocation without reading credentials',()=>{
    const result=spawnSync(process.execPath,['scripts/ci/exact-artifact-release.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,RELEASE_OPERATION:'preflight'}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Publication blocked/);
});
test('focused release workflow has no recovery maintenance dependency and CI rehearses serialized upload bytes',()=>{
    const w=readFileSync(new URL('../.github/workflows/production-release.yml',import.meta.url),'utf8');
    assert.doesNotMatch(w,/recovery|backup-evidence|rollback-evidence|exit 1|npm run build/);
    assert.match(w,/ref: \$\{\{ github.sha \}\}/);assert.match(w,/CURRENT_WORKER_VERSION/);assert.match(w,/RELEASE_OPERATION/);
    assert.match(readFileSync(new URL('../scripts/ci/artifact-dry-run.mjs',import.meta.url),'utf8'),/readPreparedBundle/);
});
test('single-asset upload session uses raw bytes and one request for each requested hash',async()=>{
    const a='a'.repeat(32),b='b'.repeat(32),calls=[];
    const jwt=`synthetic.${Buffer.from(JSON.stringify({wrangler_single_asset_uploads:true})).toString('base64url')}.synthetic`;
    const result=await uploadAssets({manifest:{},byHash:new Map([[a,{bytes:Buffer.from('a'),type:'text/plain'}],[b,{bytes:Buffer.from('b'),type:'text/plain'}]])},async(path,opts,credential)=>{
        calls.push(path);if(calls.length===1)return{jwt,buckets:[[a,b]]};
        assert.equal(credential,jwt);assert.ok(Buffer.isBuffer(opts.body));return calls.length===3?{jwt:'completed'}:{};
    });
    assert.equal(result,'completed');assert.deepEqual(calls,['/workers/scripts/goc/assets-upload-session',`/workers/assets/upload/${a}`,`/workers/assets/upload/${b}`]);
});
test('staged version requires the approved bindings, source SHA, compatibility settings and scheduled handler',()=>{
    const version={annotations:{'workers/message':`release:${sha}`},resources:{bindings:settings.bindings,
        script_runtime:{compatibility_date:settings.compatibility_date,compatibility_flags:[]},script:{handlers:['fetch','scheduled']}}};
    const previous={handlers:['fetch','scheduled']};assertStagedVersion(version,previous,settings,sha);
    for(const change of [v=>{v.annotations['workers/message']='unknown';},v=>{v.resources.bindings=[];},
        v=>{v.resources.script_runtime.compatibility_date='different';},v=>{v.resources.script_runtime.compatibility_flags=['different'];},
        v=>{v.resources.script.handlers=['fetch'];}]){
        const bad=structuredClone(version);change(bad);assert.throws(()=>assertStagedVersion(bad,previous,settings,sha));
    }
});
