const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
new vm.Script(source, { filename: 'app.js' });
const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
new vm.Script(workerSource, { filename: 'service-worker.js' });
const assetVersion = /staff-planner-v([^"\s]+)/.exec(workerSource)[1];

function storage() {
  const values = {};
  Object.defineProperties(values, {
    getItem: { value: key => values[key] ?? null },
    setItem: { value: (key, value) => { values[key] = String(value); } },
    removeItem: { value: key => { delete values[key]; } },
    clear: { value: () => Object.keys(values).forEach(key => { delete values[key]; }) }
  });
  return values;
}

const context = vm.createContext({
  console, crypto: webcrypto, TextEncoder, TextDecoder, structuredClone,
  setTimeout, clearTimeout, btoa, atob,
  localStorage: storage(), sessionStorage: storage(),
  document: { getElementById: () => null, addEventListener() {} },
  window: { addEventListener() {} },
  navigator: {}, location: { pathname: '/index.html' }
});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, action) {
  await action();
  passed++;
  console.log(`PASS ${name}`);
}

(async () => {
  await test('JavaScript syntax and unique function declarations', () => {
    const names = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map(match => match[1]);
    assert.equal(new Set(names).size, names.length);
  });
  await test('Extra people support numbered names and arbitrary explicit extra rows', () => {
    run('applyCustomWorkItems([{name:"Extra person 3", type:"machine", showInSchema:true}, {name:"Lagerhjälp", type:"extra", showInSchema:true}])');
    assert.equal(run('isExtraPersonTask("Extra person 3")'), true);
    assert.equal(run('isExtraPersonTask("Lagerhjälp")'), true);
    assert.equal(run('isExtraPersonTask("GD3")'), false);
  });
  await test('Editing keeps paused rows and disabled workdays', () => {
    run('DAYS = ["Måndag", "Onsdag"];');
    const state = run('normalizeSchedule({GD1:{Måndag:"p1", Tisdag:"p2"}, Pausad:{Fredag:"p3"}})');
    assert.equal(state.GD1.Tisdag, 'p2');
    assert.equal(state.Pausad.Fredag, 'p3');
    assert.equal(state.GD2.Måndag, '');
    const details = run('normalizeExtraPersonLocations({"Extra person 3":{Tisdag:"Borttagen uppgift"}, Pausad:{Fredag:"Lager"}})');
    assert.equal(details['Extra person 3'].Tisdag, 'Borttagen uppgift');
    assert.equal(details.Pausad.Fredag, 'Lager');
    const breaks = run('normalizeBreakPlan({Tisdag:{group1Break1:"10:00"}})');
    assert.equal(breaks.Tisdag.group1Break1, '10:00');
  });
  await test('Settings trim and deduplicate names while allowing an empty extra task list', () => {
    const settings = run('normalizeAppSettings({extraAssignments:[" Lager ", "lager", null, ""], productionMachines:[" GD1 ", "gd1"], workDays:["Onsdag"], autoLockMinutes:"bad", breakLines:[{id:"L1",label:"Linje",workplaces:[" GD1 ","GD1"]}]})');
    assert.deepEqual(plain(settings.extraAssignments), ['Lager']);
    assert.deepEqual(plain(settings.productionMachines), ['GD1']);
    assert.deepEqual(plain(settings.breakLines[0].workplaces), ['GD1']);
    assert.equal(settings.autoLockMinutes, 30);
    assert.deepEqual(plain(run('normalizeAppSettings({extraAssignments:[]}).extraAssignments')), []);
  });
  await test('Can counts convert at 240 per BOX and round up only at 0.6 or above', () => {
    assert.equal(run('convertProductionCansToBoxes(240)'), 1);
    assert.equal(run('convertProductionCansToBoxes("7200")'), 30);
    assert.equal(run('convertProductionCansToBoxes(360)'), 1);
    assert.equal(run('convertProductionCansToBoxes(241)'), 1);
    assert.equal(run('convertProductionCansToBoxes(5376)'), 22); // 22.4
    assert.equal(run('convertProductionCansToBoxes(5400)'), 22); // 22.5
    assert.equal(run('convertProductionCansToBoxes(5423)'), 22); // just below 22.6
    assert.equal(run('convertProductionCansToBoxes(5424)'), 23); // exactly 22.6
    assert.equal(run('convertProductionCansToBoxes(5425)'), 23);
    assert.equal(run('convertProductionCansToBoxes(0)'), 0);
    assert.equal(run('convertProductionCansToBoxes("")'), '');
    assert.equal(run('convertProductionCansToBoxes(-1)'), null);
    assert.equal(run('convertProductionCansToBoxes(1.5)'), null);
    assert.equal(run('convertProductionCansToBoxes("invalid")'), null);
  });
  await test('Day copy includes training and extra tasks without mutating its source', () => {
    const state = {
      schedule: { GD1: { Måndag: 'p1', Tisdag: 'p2' } },
      trainingLeaders: { Utbildning: { Måndag: 'p3', Tisdag: '' } },
      trainingLocations: { Utbildning: { Måndag: 'GD2', Tisdag: '' } },
      extraPersonLocations: { Extra: { Måndag: 'Lager', Tisdag: 'Lock' } }
    };
    context.testState = state;
    const copied = run('copyScheduleDay(testState, "Måndag", "Tisdag")');
    assert.equal(copied.schedule.GD1.Tisdag, 'p1');
    assert.equal(copied.trainingLeaders.Utbildning.Tisdag, 'p3');
    assert.equal(copied.trainingLocations.Utbildning.Tisdag, 'GD2');
    assert.equal(copied.extraPersonLocations.Extra.Tisdag, 'Lager');
    assert.equal(state.schedule.GD1.Tisdag, 'p2');
  });
  await test('Undo snapshots include every placement and cannot cross weeks', () => {
    run('recordScheduleHistory({GD1:{Måndag:"p1"}}, {}, {}, {Extra:{Måndag:"Lager"}})');
    assert.equal(run('scheduleUndoStack.at(-1).extraPersonLocations.Extra.Måndag'), 'Lager');
    run('sessionStorage.setItem(SELECTED_WEEK_KEY, "2099-01-05"); recordScheduleHistory({GD1:{Måndag:"p2"}})');
    assert.equal(run('scheduleUndoStack.length'), 1);
    assert.equal(run('scheduleUndoStack[0].schedule.GD1.Måndag'), 'p2');
    run('sessionStorage.clear(); resetScheduleHistory();');
  });
  await test('AES storage round trips and staff survive a year rollover', async () => {
    await run('setupPassword("test-password")');
    await run('savePeople([{id:"p1",name:"Anna",company:"Test"}])');
    run('localStorage.setItem(STORAGE_KEYS.peopleYear, "2000")');
    const people = await run('getPeople()');
    assert.equal(people[0].name, 'Anna');
    assert.equal(run('localStorage.getItem(STORAGE_KEYS.peopleYear)'), run('getCurrentYearKey()'));
    assert.ok(!run('localStorage.getItem(STORAGE_KEYS.people)').includes('Anna'));
  });
  await test('Auto scheduling fills custom extra rows and keeps hidden saved data', async () => {
    run('applyAppSettings({workDays:["Måndag"], extraAssignments:["Lager"]}); applyCustomWorkItems([{name:"Extra person 3",type:"extra",showInSchema:true}]);');
    await run('savePeople(Array.from({length:8}, (_,i) => ({id:"p"+i,name:"Person "+i})))');
    await run('saveMachineSkills(Object.fromEntries(Array.from({length:8}, (_,i) => ["p"+i,["GD", "ETIKETTO", "Packa"]])))');
    await run('saveSchedule({GD1:{Tisdag:"hidden"}, Pausad:{Måndag:"saved"}})');
    const result = await run('createFairWeeklySchedule(["GD1"])');
    assert.equal(result.ok, true);
    assert.ok(result.schedule['Extra person 3'].Måndag);
    assert.equal(result.extraPersonLocations['Extra person 3'].Måndag, 'Lager');
    assert.equal(result.schedule.GD1.Tisdag, 'hidden');
    assert.equal(result.schedule.Pausad.Måndag, 'saved');
    const ids = Object.values(result.schedule).map(row => row.Måndag).filter(id => id && id !== 'saved');
    assert.equal(new Set(ids).size, ids.length);
  });
  await test('Renaming extra and training rows preserves details and weekly templates', async () => {
    await run('saveExtraPersonLocations({"Extra person 3":{Måndag:"Lager"}})');
    await run('saveTrainingLeaders({"Egen utbildning":{Måndag:"p1"}})');
    await run('saveTrainingLocations({"Egen utbildning":{Måndag:"GD1"}})');
    await run('dataStore.set(STORAGE_KEYS.scheduleTemplates, [{id:"t",schedule:{"Extra person 3":{Måndag:"p2"}},extraPersonLocations:{"Extra person 3":{Måndag:"Lager"}}}])');
    await run('renameWorkItemReferences("Extra person 3", "Extra person 4")');
    assert.equal((await run('getExtraPersonLocations()'))['Extra person 4'].Måndag, 'Lager');
    const templates = await run('dataStore.get(STORAGE_KEYS.scheduleTemplates, [])');
    assert.equal(templates[0].extraPersonLocations['Extra person 4'].Måndag, 'Lager');
    await run('renameWorkItemReferences("Egen utbildning", "Ny utbildning")');
    assert.equal((await run('getTrainingLeaders()'))['Ny utbildning'].Måndag, 'p1');
    assert.equal((await run('getTrainingLocations()'))['Ny utbildning'].Måndag, 'GD1');
  });
  await test('Backup validation rejects missing encryption keys before replacing data', () => {
    assert.equal(run('isValidBackupPayload(createBackupPayload())'), true);
    assert.equal(run('isValidBackupPayload({app:"Staff Planner", version:1, data:{}})'), false);
    assert.equal(run('(() => { const payload = createBackupPayload(); delete payload.data[STORAGE_KEYS.salt]; return isValidBackupPayload(payload); })()'), false);
  });
  await test('Failed settings persistence leaves in-memory settings unchanged', async () => {
    run('originalDataStoreSet = dataStore.set; dataStore.set = async () => { throw new Error("storage full"); };');
    const before = run('JSON.stringify(appSettings)');
    await assert.rejects(run('saveAppSettings({...appSettings, extraAssignments:["unsaved"]})'), /storage full/);
    assert.equal(run('JSON.stringify(appSettings)'), before);
    run('dataStore.set = originalDataStoreSet;');
  });
  await test('Expired production records are removed from encrypted storage without changing production settings', async () => {
    await run('setupPassword("retention-test-password")');
    await run('saveProductionSettings({dailyTarget:160,factoryRecord:999})');
    await run('encryptStoredItem(STORAGE_KEYS.productionRecords,{"2000-01-01":{date:"2000-01-01",total:10},[getProductionRetentionStart()]:{date:getProductionRetentionStart(),total:20}})');
    const retained=plain(await run('getProductionRecords()'));
    assert.equal(retained['2000-01-01'],undefined);
    assert.deepEqual(plain(await run('decryptStoredItem(STORAGE_KEYS.productionRecords,{})')),retained);
    assert.deepEqual(plain(await run('getProductionSettings()')),{dailyTarget:160,factoryRecord:999});
    await run('saveProductionRecords({"2000-01-01":{total:10},[getProductionRetentionStart()]:{total:20}})');
    assert.equal((plain(await run('decryptStoredItem(STORAGE_KEYS.productionRecords,{})')))['2000-01-01'],undefined);
  });
  await test('Clearing application data removes weekly timestamps and keeps unrelated data', () => {
    run('localStorage.setItem("staff_schedule_updated_at:2026-10-12", "now"); localStorage.setItem("other_app", "keep"); clearPersistentData();');
    assert.equal(run('localStorage.getItem("staff_schedule_updated_at:2026-10-12")'), null);
    assert.equal(run('localStorage.getItem("other_app")'), 'keep');
  });
  await test('Every page references existing local assets with unique IDs', () => {
    for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(root, name), 'utf8');
      assert.ok(html.includes(`style.css?v=${assetVersion}`) && html.includes(`app.js?v=${assetVersion}`), `${name}: stale asset version`);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ID`);
      for (const match of html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)) {
        if (/^(?:https?:|mailto:|app:)/.test(match[1])) continue;
        assert.ok(fs.existsSync(path.join(root, match[1])), `${name}: missing ${match[1]}`);
      }
    }
  });
  console.log(`\n${passed} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
