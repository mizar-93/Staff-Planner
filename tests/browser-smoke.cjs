// No dependencies: Node 22+ and a Chromium browser (EDGE_PATH may override the path).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-planner-review-'));
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  const filename = path.resolve(root, name);
  if (path.dirname(filename) !== root || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', `${types[path.extname(name)] || 'application/octet-stream'}; charset=utf-8`);
  res.end(fs.readFileSync(filename));
});
let browser;
let socket;
let sequence = 0;
const pending = new Map();
const errors = [];

async function connect(url) {
  socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(code) {
  const result = await call('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`return Boolean(${expression});`)) return;
    await delay(100);
  }
  throw new Error(`Not ready: ${expression}`);
}
async function navigate(name, signedIn = true) {
  await call('Page.navigate', { url: `${base}/${name}` });
  await waitFor(`location.pathname.endsWith('/${name}') && document.readyState === 'complete'`);
  if (signedIn) {
    await waitFor(`appUnlocked && !document.getElementById('appShell').classList.contains('hidden')`);
    await evaluate('await refreshAppViews(); renderExtraAssignmentManager();');
  }
}
async function screenshot(name) {
  const result = await call('Page.captureScreenshot', { captureBeyondViewport: true });
  fs.writeFileSync(path.join(profile, name), Buffer.from(result.data, 'base64'));
}
let base;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(edge, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, base], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => errors.push(error.message));
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
  assert.ok(fs.existsSync(portFile), 'Browser failed to start');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  let pages = [];
  for (let i = 0; i < 50; i++) {
    pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (pages.some(page => page.type === 'page')) break;
    await delay(100);
  }
  await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitFor(`typeof setupPassword === 'function'`);
  await evaluate(`
    await setupPassword('review-test-password');
    await saveAppSettings({...DEFAULT_APP_SETTINGS, onboardingComplete:true});
    await savePeople(Array.from({length:12}, (_,i) => ({id:'p'+i,name:'Testperson '+i,company:'Review',availability:'available'})));
    await saveMachineSkills(Object.fromEntries(Array.from({length:12}, (_,i) => ['p'+i,['GD','ETIKETTO','Logimark','Packa']])));
    await saveCustomWorkItems([{id:'extra3',name:'Extra person 3',type:'extra',enabled:true,showInSchema:true,after:'Extra person 2'}]);
    await saveSchedule({GD1:{Måndag:'p0'}, 'Extra person 3':{Måndag:'p1'}, 'Utbildning 1':{Måndag:'p2'}});
    await saveTrainingLeaders({'Utbildning 1':{Måndag:'p3'}});
    await saveTrainingLocations({'Utbildning 1':{Måndag:'GD2'}});
    await saveExtraPersonLocations({'Extra person 3':{Måndag:'Lock & dosor'}});
    await openAppUI();
  `);
  console.log('PASS authenticated startup with isolated test data');
  await evaluate(`
    const trainingCell = document.querySelector('[data-task="GD2"][data-day="Måndag"]');
    const emptyCell = document.querySelector('[data-task="GD3"][data-day="Måndag"]');
    if (!trainingCell.classList.contains('schedule-training-cell') || trainingCell.classList.contains('schedule-shortage')) throw new Error('Training must have its own status');
    if (!emptyCell.classList.contains('schedule-shortage')) throw new Error('Empty workplace must keep its shortage status');
    if (getComputedStyle(trainingCell).backgroundColor === getComputedStyle(emptyCell).backgroundColor) throw new Error('Training and empty workplaces must have distinct colors');
  `);
  console.log('PASS training reservations use a distinct color instead of the red shortage status');

  await evaluate(`
    scheduleAdvancedToolsOpen = true; await renderSchedule();
    document.getElementById('copyDayFrom').value = 'Måndag';
    document.getElementById('copyDayTo').value = 'Tisdag';
    document.getElementById('copyScheduleDay').click();
  `);
  await waitFor(`document.querySelector('[data-task="Extra person 3"][data-day="Tisdag"] .extra-person-location-select')?.value === 'Lock & dosor'`);
  assert.equal(await evaluate(`return (await getTrainingLeaders())['Utbildning 1'].Tisdag;`), 'p3');
  assert.equal(await evaluate(`return (await getTrainingLocations())['Utbildning 1'].Tisdag;`), 'GD2');
  await evaluate(`document.getElementById('undoSchedule').click();`);
  await waitFor(`document.querySelector('[data-task="Extra person 3"][data-day="Tisdag"] .extra-person-location-select')?.value === ''`);
  await evaluate(`document.getElementById('redoSchedule').click();`);
  await waitFor(`document.querySelector('[data-task="Extra person 3"][data-day="Tisdag"] .extra-person-location-select')?.value === 'Lock & dosor'`);
  await screenshot('schedule-desktop.png');
  console.log('PASS day copy, undo and redo restore training and extra task details');

  await evaluate(`
    scheduleFilters.company = 'Another company'; await renderSchedule();
    if (document.querySelector('[data-task="GD1"][data-day="Måndag"] select').value !== 'p0') throw new Error('Filter hides saved assignment');
    scheduleFilters.company = ''; await renderSchedule();
    const originalPrompt = window.prompt; window.prompt = () => 'Review template';
    document.getElementById('saveScheduleTemplate').click(); window.prompt = originalPrompt;
  `);
  await waitFor(`document.querySelector('#scheduleTemplateSelect option[value]:not([value=""])')`);
  await evaluate(`
    await saveExtraPersonLocations({}); await saveTrainingLeaders({}); await saveTrainingLocations({}); await renderSchedule();
    document.getElementById('scheduleTemplateSelect').selectedIndex = 1;
    document.getElementById('applyScheduleTemplate').click();
  `);
  await waitFor(`document.querySelector('[data-task="Extra person 3"][data-day="Måndag"] .extra-person-location-select')?.value === 'Lock & dosor'`);
  assert.equal(await evaluate(`return (await getTrainingLeaders())['Utbildning 1'].Måndag;`), 'p3');
  console.log('PASS filters keep saved selections and weekly templates restore placement details');

  await navigate('add.html');
  await evaluate(`const input = document.querySelector('#extraAssignmentManager input'); input.value = 'Hjälp på lagret'; input.form.requestSubmit(); input.form.requestSubmit();`);
  await waitFor(`EXTRA_PERSON_ASSIGNMENTS.includes('Hjälp på lagret')`);
  assert.equal(await evaluate(`return EXTRA_PERSON_ASSIGNMENTS.filter(value => value === 'Hjälp på lagret').length;`), 1);
  await waitFor(`document.querySelector('.extra-assignment-status').textContent.includes('lagts till')`);
  await screenshot('add-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('add-mobile.png');
  assert.ok(await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'Add page overflows on mobile');
  console.log('PASS adding extra tasks prevents double submits; Add page fits mobile');

  await evaluate(`const row = [...document.querySelectorAll('.extra-assignment-row')].find(row => row.querySelector('span').textContent === 'Lock & dosor'); row.querySelector('button').click();`);
  await waitFor(`!EXTRA_PERSON_ASSIGNMENTS.includes('Lock & dosor')`);

  await navigate('index.html');
  assert.equal(await evaluate(`return document.querySelector('#extraAssignmentManager');`), null);
  assert.ok(await evaluate(`return [...document.querySelector('[data-task="Extra person 3"] .extra-person-location-select').options].some(option => option.value === 'Hjälp på lagret');`));
  assert.equal(await evaluate(`return document.querySelector('[data-task="Extra person 3"][data-day="Måndag"] .extra-person-location-select').value;`), 'Lock & dosor');
  assert.ok(await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'Five-day schedule overflows the mobile page');
  await evaluate(`document.getElementById('shareScheduleBtn').click();`);
  await waitFor(`document.querySelector('[role="dialog"]')`);
  assert.ok(await evaluate(`return document.querySelector('[role="dialog"]').contains(document.activeElement);`));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('[role="dialog"]')`);
  console.log('PASS task selection remains on schedule and preview supports keyboard dismissal');

  await evaluate(`
    await saveSchedulePriorityLines(['GD1']); await renderSchedule();
    window.confirm = () => { throw new Error('Auto scheduling must fill the table without a confirmation dialog'); };
    document.getElementById('autoScheduleBtn').click();
  `);
  await waitFor(`document.getElementById('autoScheduleMessage').textContent.includes('Schemat har sparats')`);
  assert.equal(await evaluate(`return document.querySelector('.schedule-preview-modal');`), null);
  assert.ok(await evaluate(`return (await getSchedule()).ETIKETTO.Måndag;`));
  assert.ok(await evaluate(`return document.querySelector('[data-task="ETIKETTO"][data-day="Måndag"] select').value;`));
  await evaluate(`
    const select = document.querySelector('[data-task="ETIKETTO"][data-day="Måndag"] select');
    select.value = ''; select.dispatchEvent(new Event('change'));
  `);
  await waitFor(`document.querySelector('[data-task="ETIKETTO"][data-day="Måndag"] select').value === ''`);
  await waitFor(`document.getElementById('undoSchedule') && !document.getElementById('undoSchedule').disabled`);
  assert.equal(await evaluate(`return (await getSchedule()).ETIKETTO.Måndag;`), '');
  await evaluate(`document.getElementById('undoSchedule').click();`);
  await waitFor(`Boolean(document.querySelector('[data-task="ETIKETTO"][data-day="Måndag"] select').value)`);
  console.log('PASS Skapa veckoschema fills and saves the editable table directly; manual changes can be undone');

  await navigate('installningar.html');
  await evaluate(`
    document.querySelector('.password-change').open = true;
    document.getElementById('currentPasswordSetting').value = 'review-test-password';
    document.getElementById('newPasswordSetting').value = 'updated-test-password';
    document.getElementById('confirmPasswordSetting').value = 'updated-test-password';
    document.getElementById('changePasswordForm').requestSubmit();
  `);
  await waitFor(`document.getElementById('passwordChangeMessage').textContent.includes('ändrats')`);
  assert.equal(await evaluate(`return document.getElementById('newPasswordSetting').value;`), '');
  assert.equal(await evaluate(`return (await getPeople()).length;`), 12);
  console.log('PASS password change re-encrypts stored data and resets the form');

  const expectedTuesdayOperator = await evaluate(`return (await getSchedule()).GD1.Tisdag;`);
  await evaluate(`await saveAppSettings({...appSettings, workDays:['Tisdag','Torsdag'], productionMachines:['GD1', 'Lager "A"']});`);
  await navigate('produktion.html');
  await evaluate(`
    const tuesday = getStartOfWeek(); tuesday.setDate(tuesday.getDate()+1);
    selectedProductionDate = formatDateKey(tuesday); await renderProduction();
  `);
  assert.equal(await evaluate(`return document.querySelector('[data-machine="GD1"][data-field="personId"]').value;`), expectedTuesdayOperator);
  assert.ok(await evaluate(`return [...document.querySelectorAll('.production-machine-row strong')].some(node => node.textContent === 'Lager "A"');`));
  await evaluate(`
    document.querySelector('.production-result').value = '-1';
    document.getElementById('saveProductionBtn').click();
  `);
  await delay(100);
  assert.equal(await evaluate(`return Boolean((await getProductionRecords())[selectedProductionDate]);`), false);
  await evaluate(`
    document.querySelector('.production-result').value = '25';
    document.getElementById('productionTarget').value = '0';
    document.getElementById('saveProductionBtn').click();
  `);
  await waitFor(`document.querySelector('.production-history-item')`);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].total;`), 25);
  assert.equal(await evaluate(`return document.getElementById('productionTarget').value;`), '0');
  console.log('PASS production uses actual weekdays, validates numbers and supports quoted machine names');

  assert.equal(await evaluate(`return document.querySelector('.production-cans').value;`), '');
  await evaluate(`const boxes = document.querySelectorAll('.production-result')[1]; boxes.value = '0'; boxes.focus(); boxes.click();`);
  await call('Input.insertText', { text: '7' });
  assert.equal(await evaluate(`return document.querySelectorAll('.production-result')[1].value;`), '7');
  await evaluate(`const cans = document.querySelector('.production-cans'); cans.value = '0'; cans.focus(); cans.click();`);
  await call('Input.insertText', { text: '8' });
  assert.equal(await evaluate(`return document.querySelector('.production-cans').value;`), '8');
  console.log('PASS typing in BOX and dosor inputs replaces the existing zero');
  await evaluate(`
    const cans = document.querySelectorAll('.production-cans');
    cans[0].value = '5376'; cans[0].dispatchEvent(new Event('input'));
    cans[1].value = '5424'; cans[1].dispatchEvent(new Event('input'));
  `);
  assert.deepEqual(await evaluate(`return [...document.querySelectorAll('.production-result')].map(input => input.value);`), ['22', '23']);
  assert.equal(await evaluate(`return document.getElementById('productionTotal').textContent;`), '45');
  await evaluate(`document.getElementById('saveProductionBtn').click();`);
  await waitFor(`document.querySelector('.production-cans').value === '5376' && document.querySelector('.production-result').value === '22'`);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].machines.GD1.cans;`), 5376);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].total;`), 45);
  await screenshot('production-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'Production overflows desktop');
  await screenshot('production-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 960, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'Production overflows a narrow desktop');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`
    const boxes = document.querySelector('.production-result');
    boxes.value = '32'; boxes.dispatchEvent(new Event('input'));
  `);
  assert.equal(await evaluate(`return document.querySelector('.production-cans').value;`), '');
  assert.equal(await evaluate(`return document.getElementById('productionTotal').textContent;`), '55');
  console.log('PASS dosor convert to BOX per machine, update totals, persist counts and retain manual BOX entry');

  await waitFor(`document.getElementById('productionSaveStatus').textContent === 'Sparat automatiskt'`);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].machines[appSettings.productionMachines[0]].result;`),32);
  await evaluate(`
    const comment=document.querySelector('[data-field="comment"]');comment.focus();comment.value='Automatic save';comment.dispatchEvent(new Event('input'));
    const waste=document.querySelector('.production-waste');waste.value='1.25';waste.dispatchEvent(new Event('input'));
  `);
  await waitFor(`document.getElementById('productionSaveStatus').textContent === 'Sparat automatiskt'`);
  assert.deepEqual(await evaluate(`const m=(await getProductionRecords())[selectedProductionDate].machines[appSettings.productionMachines[0]];return [m.comment,m.waste,document.activeElement.dataset.field];`),['Automatic save',1.25,'comment']);
  console.log('PASS automatic production save preserves focus and saves comments and waste without a button');

  await evaluate(`const input=document.querySelector('.production-result');input.value='-1';input.dispatchEvent(new Event('input'));`);
  await waitFor(`document.getElementById('productionSaveStatus').textContent.includes('giltiga')`);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].machines[appSettings.productionMachines[0]].result;`),32);
  await evaluate(`
    window.originalProductionSave=saveProductionRecords;
    saveProductionRecords=async()=>{throw Error('Expected save failure');};
    const input=document.querySelector('.production-result');input.value='33';input.dispatchEvent(new Event('input'));
  `);
  await waitFor(`document.getElementById('productionSaveStatus').textContent.includes('Kunde inte spara')`);
  assert.equal(await evaluate(`return document.querySelector('.production-result').value;`),'33');
  await evaluate(`saveProductionRecords=window.originalProductionSave;document.getElementById('saveProductionBtn').click();`);
  await waitFor(`document.getElementById('productionSaveStatus').textContent === 'Sparat automatiskt'`);
  console.log('PASS invalid production values are not saved; failed saves retain input and retry');

  await evaluate(`
    saveProductionRecords=async records=>{await new Promise(resolve=>setTimeout(resolve,300));await window.originalProductionSave(records);};
    const input=document.querySelector('.production-result');input.value='34';input.dispatchEvent(new Event('input'));
  `);
  await waitFor(`document.getElementById('productionSaveStatus').textContent === 'Sparar…'`);
  await evaluate(`const input=document.querySelector('.production-result');input.value='35';input.dispatchEvent(new Event('input'));`);
  await waitFor(`document.getElementById('productionSaveStatus').textContent === 'Sparat automatiskt'`);
  assert.equal(await evaluate(`return (await getProductionRecords())[selectedProductionDate].machines[appSettings.productionMachines[0]].result;`),35);
  await evaluate(`
    saveProductionRecords=window.originalProductionSave;
    window.previousProductionDate=selectedProductionDate;
    const input=document.querySelector('.production-result');input.value='36';input.dispatchEvent(new Event('input'));
    const date=document.getElementById('productionDate');date.value='2026-11-02';date.dispatchEvent(new Event('change'));
  `);
  await waitFor(`selectedProductionDate === '2026-11-02' && document.getElementById('productionDate').value === '2026-11-02' && document.querySelector('.production-result').value !== '36'`);
  assert.equal(await evaluate(`return (await getProductionRecords())[window.previousProductionDate].machines[appSettings.productionMachines[0]].result;`),36);
  console.log('PASS edits during saves persist the latest value; switching dates flushes the previous day');

  for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
    await navigate(name);
    assert.equal(await evaluate(`return document.querySelectorAll('.nav-link[aria-current="page"]').length;`), 1, `${name}: active navigation`);
    const duplicates = await evaluate(`const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id,index) => ids.indexOf(id) !== index);`);
    assert.deepEqual(duplicates, [], `${name}: duplicate DOM IDs`);
    assert.ok(await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), `${name}: mobile horizontal overflow`);
    console.log(`PASS page ${name}`);
  }
  await evaluate(`await navigator.serviceWorker.ready;`);
  await waitFor(`navigator.serviceWorker.controller`);
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await navigate('index.html');
  assert.equal(await evaluate(`const response = await fetch('app.js?v=offline-check'); return response.status;`), 200);
  console.log('PASS offline navigation and JavaScript assets with cache-busting queries');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`\nBrowser checks passed. Screenshots: ${profile}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close'); } catch { /* The browser may already have exited. */ }
  }
  socket?.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  browser?.kill();
  server.close();
});
