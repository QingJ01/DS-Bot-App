import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { cleanVersion, install, newer, registryPlan, releaseRef, sourceOf, updateFailure } from '../src/host/update.js'
const PKG=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const API='https://api.github.com/repos/QingJ01/DS-Bot-App/',SHA='b'.repeat(40),OLD='a'.repeat(40)
const spec=sha=>`github:QingJ01/DS-Bot-App#${sha}&path:ds-bot`
const original=globalThis.fetch,dirs=[]
afterEach(()=>{globalThis.fetch=original;for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true,maxRetries:5})})
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture({source=spec(OLD),version='9.0.0',revision=2,result={application:'restart-required',version},installBundle,removeBundle,config={},home,answers:answerOverrides={}}={}){
 let current=source;const calls=[],fetched=[],warnings=[],ref=`v${version}${revision?`-r${revision}`:''}`
 const manifest=`https://raw.githubusercontent.com/QingJ01/DS-Bot-App/${SHA}/ds-bot/package.json`
 const answers={
  [API+'releases/latest']:{tag_name:`v${version}`,assets:[`ds-bot-${version}${revision?`-r${revision}`:''}.tgz`,revision?`SHA256SUMS-r${revision}`:'SHA256SUMS'].map(name=>({name}))},
  [API+'commits/'+ref]:{sha:SHA},[manifest]:{...PKG,version},
  [API+`git/matching-refs/tags/v${PKG.version}`]:[{ref:`refs/tags/v${PKG.version}`,object:{type:'commit',sha:OLD}}],
  ...answerOverrides,
 }
 globalThis.fetch=async url=>{fetched.push(url);const value=answers[url];if(value instanceof Error)throw value;return{ok:value!==undefined,status:value===undefined?404:200,json:async()=>value}}
 const removes=[]
 const manager={
  listBundles:async()=>[{name:PKG.name,source:current}],
  installBundle:async(...args)=>{calls.push(args);return typeof installBundle==='function'?installBundle(...args,calls.length):result},
  removeBundle:async name=>{removes.push(name);return typeof removeBundle==='function'?removeBundle(name):removeBundle??{application:'applied'}},
 }
 const rt={home,ctx:{get:key=>key==='pluginManager'?manager:undefined,effect(){}},config,warn:(...args)=>warnings.push(args)}
 install(rt);return{rt,manager,answers,manifest,calls,fetched,removes,warnings,setSource:value=>{current=value}}
}
function start({source,result={application:'restart-required',version:'9.0.0'},remove={application:'applied'},config={},home,answers={}}={}){
 const f=fixture({source,version:'9.0.0',revision:2,result:typeof result==='function'?undefined:result,installBundle:typeof result==='function'?(_spec,_options,count)=>result(count):undefined,removeBundle:remove,config,home,answers})
 return{...f,installs:f.calls}
}
test('semver helpers preserve numeric and prerelease ordering',()=>{
 assert.equal(cleanVersion('v1.2.3+build.5'),'1.2.3');assert.equal(cleanVersion('main'),null)
 for(const[a,b,result]of[['0.10.0','0.9.0',true],['1.0.0','1.0.0-beta.2',true],['1.0.0-beta.10','1.0.0-beta.2',true],['0.1.0','0.2.0',false]])assert.equal(newer(a,b),result)
})
test('archive sources and named GitHub aliases are distinct from development links',()=>{
 for(const value of ['file:C:\\Downloads\\ds-bot.tgz','https://host/a.tgz','/tmp/a.tgz'])assert.equal(sourceOf(value).kind,'tarball')
 for(const value of ['link:/work/a','link:/work/a.tgz','file:/work/a'])assert.equal(sourceOf(value).kind,'path')
 assert.deepEqual(sourceOf('ds-bot@'+spec(SHA)),sourceOf(spec(SHA)))
})
test('registry planning remains compatible with the separate DSH updater',async()=>{
 assert.deepEqual(await registryPlan({updateRegistry:'https://private.example'},{}),['https://private.example/'])
})
test('release installation forms migrate to an explicitly named immutable source in this fork',async()=>{
 for(const source of [spec(OLD),'ds-bot@^0.1.0','file:C:\\Downloads\\ds-bot-0.1.0.tgz','https://host/ds-bot.tgz','github:QingJ01/DeepSeek-Bot#v0.1.0&path:/ds-bot']){
  const f=fixture({source}),view=await f.rt.updateCheck();assert.equal(view.available,true,source)
  f.rt.updateStart({targetId:view.targetId});await flush();assert.deepEqual(f.calls,[[`ds-bot@${spec(SHA)}`,{enabled:true}]])
  assert.equal(f.rt.updateView().phase,'installed');assert.equal(f.rt.updateView().restartRequired,true)
  assert.ok(f.fetched.every(url=>!url.includes('registry.npm')))
 }
})
test('same-version revisions are offered from the installed tag identity',async()=>{
 const f=fixture({version:PKG.version,revision:3}),view=await f.rt.updateCheck()
 assert.equal(view.currentRevision,0);assert.equal(view.latestRevision,3);assert.equal(view.available,true)
 const archive=fixture({version:PKG.version,revision:3,source:`file:C:\\Downloads\\ds-bot-${PKG.version}-r2.tgz`})
 assert.equal((await archive.rt.updateCheck()).currentRevision,2)
})
test('current releases require explicit repair; unknown commits are not silently replaced',async()=>{
 for(const source of [spec(SHA),spec('c'.repeat(40))]){
  const f=fixture({source,version:PKG.version}),view=await f.rt.updateCheck();assert.equal(view.available,false);assert.equal(view.canRepair,true)
  assert.throws(()=>f.rt.updateStart(),/No DS Bot update/);f.rt.updateStart({repair:true});await flush();assert.equal(f.calls.length,1)
 }
 const f=fixture({version:'0.0.1'}),view=await f.rt.updateCheck();assert.equal(view.available,false);assert.equal(view.canRepair,false)
 const newerRevision=fixture({version:PKG.version,revision:2,source:`file:/tmp/ds-bot-${PKG.version}-r3.tgz`})
 assert.equal((await newerRevision.rt.updateCheck()).canRepair,false)
})
test('development folders, custom forks and disabled checks never ask the network',async()=>{
 for(const source of ['link:/work/a','file:/work/a','github:QingJ01/DS-Bot-App#main','github:other/project#v0.1.0',undefined]){
  const f=fixture();f.setSource(source);assert.equal((await f.rt.updateCheck()).available,false);assert.deepEqual(f.fetched,[])
 }
 const f=fixture({config:{updateCheck:false}});await f.rt.updateCheck({fresh:true});assert.deepEqual(f.fetched,[])
})
test('release validation rejects incomplete assets, moving commits, drafts and foreign manifests',async()=>{
 for(const change of [f=>{f.answers[API+'releases/latest'].assets=[]},f=>{f.answers[API+'releases/latest'].draft=true},f=>{f.answers[API+'commits/v9.0.0-r2']={sha:'main'}},f=>{f.answers[f.manifest]={...PKG,version:'8.0.0'}},f=>{f.answers[f.manifest]={...PKG,version:'9.0.0',repository:'https://github.com/other/project'}}]){
  const f=fixture();change(f);const view=await f.rt.updateCheck();assert.equal(view.available,false);assert.equal(view.checkErrorCode,'release-invalid');assert.equal(f.calls.length,0)
 }
})
test('the desktop app updates as a whole without fetching plugin releases', async (t) => {
  process.env.DS_BOT_APP = '1'
  t.after(() => { delete process.env.DS_BOT_APP })
  const f = fixture({ source: 'ds-bot@^0.1.2' })
  const view = await f.rt.updateCheck({ fresh: true })
  assert.equal(view.source, 'app')
  assert.equal(view.available, false)
  assert.deepEqual(f.fetched, [])
  assert.throws(() => f.rt.updateStart(), /No DS Bot update/)
})
test('concurrent checks share one lookup and network failures clear a stale offer',async()=>{
 const f=fixture(),views=await Promise.all([f.rt.updateCheck(),f.rt.updateCheck(),f.rt.updateCheck({fresh:true})])
 assert.ok(views.every(view=>view.available));assert.equal(f.fetched.filter(url=>url.endsWith('releases/latest')).length,1)
 f.answers[API+'releases/latest']=Object.assign(Error('limited'),{status:403});const failed=await f.rt.updateCheck({fresh:true})
 assert.equal(failed.available,false);assert.equal(failed.checkErrorCode,'rate-limit');assert.throws(()=>f.rt.updateStart(),/No DS Bot update/)
})
test('stale UI targets and changed installation sources cannot replace a checkout',async()=>{
 const f=fixture();await f.rt.updateCheck();assert.throws(()=>f.rt.updateStart({targetId:'stale'}),/available update changed/)
 f.setSource('link:/work/a');f.rt.updateStart();await flush();assert.equal(f.rt.updateView().errorCode,'source-changed');assert.equal(f.calls.length,0)
})
test('duplicate clicks and checks during installation start exactly one operation',async()=>{
 let done,count=0;const f=fixture({installBundle:()=>{count++;return new Promise(resolve=>{done=resolve})}})
 await f.rt.updateCheck();f.rt.updateStart();f.rt.updateStart();await flush();assert.equal((await f.rt.updateCheck({fresh:true})).phase,'installing');assert.equal(count,1)
 done({application:'applied',version:'9.0.0'});await flush();assert.equal(f.rt.updateView().restartRequired,false);assert.equal(f.rt.updateView().phase,'installed')
})
test('integrity failures and synchronous errors remain retryable without weakening verification',async()=>{
 let attempt=0;const f=fixture({installBundle:()=>{if(++attempt===1)throw Error('ERR_PNPM_MISSING_TARBALL_INTEGRITY');return{application:'restart-required',version:'9.0.0'}}})
 await f.rt.updateCheck();f.rt.updateStart();await flush();assert.equal(f.rt.updateView().errorCode,'integrity')
 f.rt.updateStart();await flush();assert.equal(f.rt.updateView().phase,'installed');assert.equal(attempt,2)
})
test('compatibility, build approval and version mismatches cannot report success',async()=>{
 for(const[result,code]of[[{application:'failed',error:{code:'incompatible-version'}},'incompatible-version'],[{application:'failed',pendingBuilds:['x']},'build-blocked'],[{application:'applied',version:'8.0.0'},'version-mismatch']]){
  const f=fixture({result});await f.rt.updateCheck();f.rt.updateStart();await flush();assert.equal(f.rt.updateView().phase,'failed');assert.equal(f.rt.updateView().errorCode,code)
 }
})
test('receipt records only immutable release identity after success',async()=>{
 const home=mkdtempSync(join(tmpdir(),'ds-bot-update-'));dirs.push(home)
 const f=fixture({home});await f.rt.updateCheck();f.rt.updateStart()
 for(let i=0;i<50;i++){try{readFileSync(join(home,'update-receipt.json'));break}catch{}await new Promise(resolve=>setTimeout(resolve,10))}
 const receipt=JSON.parse(readFileSync(join(home,'update-receipt.json'),'utf8'));assert.equal(receipt.spec,spec(SHA));assert.equal(receipt.ref,'v9.0.0-r2')
 assert.deepEqual(Object.keys(receipt).sort(),['commit','installedAt','ref','spec','version'])
 const reloaded=fixture({home,source:spec(SHA)})
 const pending=await reloaded.rt.updateCheck()
 assert.equal(pending.phase,'installed');assert.equal(pending.restartRequired,true);assert.equal(pending.available,false)
})
test('failure hints describe recovery without exposing raw diagnostics',()=>{
 for(const[cause,code]of[[{message:'ENOSPC'},'disk-full'],[{message:'EPERM'},'permission'],[{name:'TimeoutError'},'timeout'],[{message:'https://user:password@private.example/?token=hidden'},'network']]){
  const value=updateFailure(cause);assert.equal(value.code,code);assert.ok(!value.message.includes('private.example'))
 }
})
test('revision selection is numeric and requires matching checksums',()=>{
 assert.equal(releaseRef({tag_name:'v9.0.0',assets:['ds-bot-9.0.0-r2.tgz','SHA256SUMS-r2','ds-bot-9.0.0-r10.tgz','SHA256SUMS-r10','ds-bot-9.0.0-r11.tgz'].map(name=>({name}))}),'v9.0.0-r10')
})
test('star count remains lazy and cached',async()=>{
 const f=fixture();f.answers[API.slice(0,-1)]={stargazers_count:42};assert.equal(await f.rt.repoStars(),42);assert.equal(await f.rt.repoStars(),42);assert.equal(f.fetched.length,1)
})

// Under HMR the manager refuses a spec the profile already depends on with
// 'already-installed'; the update then removes the bundle and installs it again,
// leaving a note at <home>/update.json for the start that reloads the new copy.
const NOTE = `${PKG.name}@${spec(SHA)}`
const newHome = () => mkdtempSync(join(tmpdir(), 'ds-bot-update-home-'))
const noteIn = home => JSON.parse(readFileSync(join(home, 'update.json'), 'utf8'))

test('a plain refusal or success needs no removal and writes no note', async () => {
  const home = newHome()
  const { rt, installs, removes } = start({
    source: `${PKG.name}@^${PKG.version}`,
    config: { updateRegistry: 'https://registry.example' },
    answers: { [`https://registry.example/${PKG.name}/latest`]: { version: '9.0.0' } },
    result: { application: 'restart-required', version: '9.0.0' },
    home,
  })
  await rt.updateCheck()
  rt.updateStart()
  await flush()
  assert.equal((await rt.updateCheck()).phase, 'installed')
  assert.equal(installs.length, 1)
  assert.deepEqual(removes, [])
  assert.equal(existsSync(join(home, 'update.json')), false)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('an already-installed refusal removes the bundle, reinstalls and leaves a note', async () => {
  const home = newHome()
  const calls = []
  const { rt, installs, removes } = start({
    source: `${PKG.name}@^${PKG.version}`,
    config: { updateRegistry: 'https://registry.example' },
    answers: { [`https://registry.example/${PKG.name}/latest`]: { version: '9.0.0' } },
    result: (count) => {
      calls.push(`install${count}`)
      return count === 1 ? { error: { code: 'already-installed' } } : { application: 'applied', version: '9.0.0' }
    },
    remove: { application: 'applied' },
    home,
  })
  await rt.updateCheck()
  rt.updateStart()
  await flush()
  assert.deepEqual(calls, ['install1', 'install2'])
  assert.deepEqual(installs, [[NOTE, { enabled: true }], [NOTE, { enabled: true }]])
  assert.deepEqual(removes, [PKG.name])
  // The note was written before the removal — and still carries no error on success.
  const note = noteIn(home)
  assert.equal(note.from, PKG.version)
  assert.equal(note.to, '9.0.0')
  assert.equal(note.spec, spec(SHA))
  assert.equal(typeof note.startedAt, 'string')
  assert.equal(note.error, undefined)
  assert.equal((await rt.updateCheck()).phase, 'installed')
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a failed removal fails the update without a second install', async () => {
  const home = newHome()
  const { rt, installs, removes } = start({
    source: `${PKG.name}@^${PKG.version}`,
    config: { updateRegistry: 'https://registry.example' },
    answers: { [`https://registry.example/${PKG.name}/latest`]: { version: '9.0.0' } },
    result: count => (count === 1 ? { error: { code: 'already-installed' } } : { application: 'applied', version: '9.0.0' }),
    remove: { error: { code: 'bundle-in-use' } },
    home,
  })
  await rt.updateCheck()
  rt.updateStart()
  await flush()
  assert.equal(installs.length, 1)
  assert.deepEqual(removes, [PKG.name])
  const view = await rt.updateCheck()
  assert.equal(view.phase, 'failed')
  assert.equal(view.errorCode, 'bundle-in-use')
  assert.equal(existsSync(join(home, 'update.json')), false)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a failed reinstall and failed restore are both recorded in the note', async () => {
  const home = newHome()
  const { rt } = start({
    source: `${PKG.name}@^${PKG.version}`,
    config: { updateRegistry: 'https://registry.example' },
    answers: { [`https://registry.example/${PKG.name}/latest`]: { version: '9.0.0' } },
    result: count => (count === 1 ? { error: { code: 'already-installed' } } : { error: { code: 'operation-error', diagnostic: 'pnpm: tarball 500' } }),
    home,
  })
  await rt.updateCheck()
  rt.updateStart()
  await flush()
  assert.equal((await rt.updateCheck()).phase, 'failed')
  const note = noteIn(home)
  assert.equal(note.to, '9.0.0')
  assert.equal(note.errorCode, 'restore-failed')
  assert.match(note.error, /Update install failed:.*Previous install restore failed:/u)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a failed target install restores the captured immutable source without a success receipt', async () => {
  const home = newHome()
  const { rt, installs } = start({
    source: spec(OLD),
    result: count => count === 1 ? { error: { code: 'already-installed' } }
      : count === 2 ? { error: { code: 'operation-error' } }
        : { application: 'applied', version: PKG.version },
    home,
  })
  await rt.updateCheck()
  rt.updateStart()
  await flush()
  assert.equal(rt.updateView().phase, 'failed')
  assert.deepEqual(installs.map(([value]) => value), [NOTE, NOTE, `${PKG.name}@${spec(OLD)}`])
  const note = noteIn(home)
  assert.equal(note.errorCode, 'network')
  assert.match(note.error, /previous installation was restored/u)
  assert.equal(existsSync(join(home, 'update-receipt.json')), false)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('the note for the version now running shows the update once and is consumed', async () => {
  const home = newHome()
  writeFileSync(join(home, 'update.json'), JSON.stringify({ from: '0.2.0', to: PKG.version, spec: `${PKG.name}@${PKG.version}`, startedAt: new Date().toISOString() }))
  const { rt, warnings } = start({ home })
  const view = rt.updateView()
  assert.equal(view.phase, 'updated')
  assert.equal(view.installed, PKG.version)
  assert.equal(view.available, false)
  assert.equal(existsSync(join(home, 'update.json')), false)
  assert.deepEqual(warnings, [])
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a note for another version warns and is consumed', async () => {
  const home = newHome()
  writeFileSync(join(home, 'update.json'), JSON.stringify({ from: '0.2.0', to: '9.0.0', spec: NOTE, startedAt: new Date().toISOString(), error: 'pnpm: tarball 500' }))
  const { rt, warnings } = start({ home })
  assert.equal(rt.updateView().phase, 'failed')
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][1] ?? warnings[0][0]), /9\.0\.0|pnpm/)
  assert.equal(existsSync(join(home, 'update.json')), false)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a clean note on the version that wrote it waits for a start that runs the target', async () => {
  const home = newHome()
  writeFileSync(join(home, 'update.json'), JSON.stringify({ from: PKG.version, to: '9.0.0', spec: NOTE, startedAt: new Date().toISOString() }))
  const { rt, warnings } = start({ home })
  assert.equal(rt.updateView().phase, 'idle')
  assert.deepEqual(warnings, [])
  assert.equal(existsSync(join(home, 'update.json')), true)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})

test('a note that cannot be read is warned about and deleted', async () => {
  const home = newHome()
  writeFileSync(join(home, 'update.json'), 'not json {')
  const { rt, warnings } = start({ home })
  assert.equal(rt.updateView().phase, 'idle')
  assert.equal(warnings.length, 1)
  assert.equal(existsSync(join(home, 'update.json')), false)
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
})
