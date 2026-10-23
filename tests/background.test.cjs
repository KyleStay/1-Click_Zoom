const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function load(dev){const events={};let gets=0;const event=n=>({addListener:f=>events[n]=f});const chrome={runtime:{getManifest:()=>({version_name:dev?'4.1.1 manual development':undefined}),onInstalled:event('install'),onStartup:event('startup'),onMessage:event('message')},storage:{sync:{get(){gets++}},session:{}},tabs:{onUpdated:event('updated'),onActivated:event('activated'),onZoomChange:event('zoom'),get(){gets++}},action:{onClicked:event('action')},commands:{onCommand:event('command')},contextMenus:{onClicked:event('context')},windows:{onRemoved:event('removed')}};const c=vm.createContext({chrome,console,URL,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync('background.js','utf8'),c);return {c,events,gets:()=>gets};}
test('production keeps automatic navigation zoom path',()=>{let x=load(false);let before=x.gets();x.events.updated(1,{status:'complete'},{url:'https://example.com/'});assert.ok(x.gets()>before)});
test('dev ignores navigation zoom and external zoom learning',()=>{let x=load(true);let before=x.gets();x.events.updated(1,{status:'complete'},{url:'https://example.com/'});x.events.zoom({tabId:1,newZoomFactor:2,oldZoomFactor:1});assert.equal(x.gets(),before)});
test('production retains zoom learning',()=>{let x=load(false);let before=x.gets();x.events.zoom({tabId:1,newZoomFactor:2,oldZoomFactor:1});assert.ok(x.gets()>before)});
test('site zoom and exclusion semantics preserved',()=>{let x=load(false);assert.equal(vm.runInContext("getEffectiveZoom('example.com',{isToggledActive:true,toggleZoom:150,siteSettings:{'example.com':{toggleZoom:175}}})",x.c),1.75);assert.equal(vm.runInContext("isExcluded('a.example.com',{patterns:['*.example.com']})",x.c),true);assert.equal(vm.runInContext("isExcluded('evilexample.com',{patterns:['*.example.com']})",x.c),false)});
function settingsHarness(data) {
  const source = fs.readFileSync('background.js', 'utf8');
  const chrome = {runtime: {}, storage: {sync: {
    get(keys, callback) { callback(data); },
    set(next, callback) { Object.assign(data, next); callback(); }
  }}};
  const context = vm.createContext({chrome, DEFAULT_TOGGLE_ZOOM:150,
    updateActionBehavior(){}, updateZoomStateBadge(){}});
  vm.runInContext(source.slice(0, source.indexOf('// Separate-ID')), context);
  vm.runInContext(source.slice(source.indexOf('async function importSettings(')), context);
  return context;
}
test('imported and stored presets are finite integer zooms, unique and bounded', async () => {
  const data = {};
  const context = settingsHarness(data);
  const result = await vm.runInContext('importSettings({settings:{customPresets:[{toString:null},null,"150",NaN,Infinity,24,501,100.5,25,25,100,150,200,250,300,350]}})', context);
  assert.equal(result.success, true);
  assert.deepEqual(Array.from(data.customPresets), [25,100,150,200,250,300]);
  for (const filename of ['background.js','popup.js']) {
    const source = fs.readFileSync(filename,'utf8');
    const normalizer = source.slice(0,source.indexOf('\n\n'));
    const safe = vm.runInNewContext(normalizer+';normalizeCustomPresets([{toString:null},110,110,150.5,500,501])');
    assert.deepEqual(Array.from(safe),[110,500]);
  }
});
test('only saved presets trigger import choice and merge preserves them for old backups', async () => {
  const data = {customPresets:[110], toggleZoom:150};
  const context = settingsHarness(data);
  const check = await vm.runInContext('checkHasCustomSettings()',context);
  assert.equal(check.hasCustomSettings,true);
  assert.equal(check.presetCount,1);
  assert.equal((await vm.runInContext('importSettings({settings:{toggleZoom:175}},"merge")',context)).success,true);
  assert.deepEqual(Array.from(data.customPresets),[110]);
  assert.equal(data.toggleZoom,175);
});
test('merge normalizes malformed stored and imported presets before deduplication', async () => {
  const data={customPresets:[{},100,100,600]};
  const context=settingsHarness(data);
  await vm.runInContext('importSettings({settings:{customPresets:[100,125,NaN]}},"merge")',context);
  assert.deepEqual(Array.from(data.customPresets),[100,125]);
});
