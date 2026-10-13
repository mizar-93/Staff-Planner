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
let role='worker';
let deputy=false, delegation=null, privateTodos=[], scheduleWrites=0, statusWrites=0;
const sharedData=new Map();
const server = http.createServer((req, res) => {
const ep=new URL(req.url,'http://localhost').pathname;
const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
if(ep==='/corporate-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.STAFF_CORPORATE=true;');return;}
if(ep==='/api/me'){json({id:'u',name:'Test user',role,deputy,active:true,shift_id:'shift-1',group_id:'A'});return;}
if(ep==='/api/delegation') {
  if(req.method==='GET'){json({workers:[{id:'worker-a',name:'Ali',email:'ali@test.com'}],delegation});return;}
  if(req.method==='DELETE'){delegation=null;res.writeHead(204);res.end();return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{delegation={user_id:JSON.parse(body).userId};res.writeHead(204);res.end();});return;
}
if(ep==='/api/deputy/planning') {
  if(req.method==='GET'){json({people:[{id:'a',name:'Ali',availability:'available'}],peopleVersion:1,schedule:{GD1:{'Måndag':'a'}},version:1,workItems:[]});return;}
  scheduleWrites++;json({version:2});return;
}
if(ep==='/api/deputy/availability'){statusWrites++;json({version:2});return;}
if(ep==='/api/deputy/todos') {
  if(req.method==='GET'){json({value:privateTodos,version:privateTodos.length?1:0});return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{privateTodos=JSON.parse(body).value;json({version:1});});return;
}
if(ep==='/api/my-schedule'){json({people:[{id:'a',name:'Ali'}],schedule:{GD1:{'Måndag':'a'}}});return;}
if(ep==='/api/summary'){json([{shift:'shift-1',days:[]}]);return;}
if(ep==='/api/users'){json([]);return;}
if(ep.startsWith('/api/data/')){
  const key=decodeURIComponent(ep.split('/').pop());
  if(req.method==='PUT'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const value=JSON.parse(body);sharedData.set(key,value.value);json({version:value.version+1});});return;}
  json({value:sharedData.get(key) ?? (key==='staff_people_enc'?[{id:'a',name:'Ali',groupId:'A'}]:null),version:1});return;
}

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

await navigate('dashboard.html',false);
await waitFor("document.querySelector('main h2')?.textContent === 'Min grupps schema'");
await waitFor("document.querySelector('main').textContent.includes('Ali')");
console.log('PASS worker read-only group schedule');
role='shift_leader';await navigate('index.html');
assert.ok(await evaluate("return document.querySelector('.corporate-context').textContent.includes('Skiftledare');"));
console.log('PASS corporate leader schedule');
await navigate('personal.html');await waitFor("document.querySelector('#grantDeputyBtn')");
await evaluate("document.querySelector('#deputySelect').value='worker-a';document.querySelector('#grantDeputyBtn').click();");
await waitFor("document.querySelector('#delegationControls').textContent.includes('Aktiv')");assert.equal(delegation.user_id,'worker-a');
await evaluate("document.querySelector('#revokeDeputyBtn').click();");await waitFor("document.querySelector('#delegationControls').textContent.includes('Ingen aktiv')");
assert.equal(delegation,null);console.log('PASS leader grants and revokes deputy');
role='worker';deputy=true;await navigate('index.html',false);await waitFor("document.querySelector('#saveDeputyScheduleBtn')");
await evaluate("const status=document.querySelector('select[aria-label=\"Status för Ali\"]');status.value='sick';status.dispatchEvent(new Event('change'));document.querySelector('#saveDeputyScheduleBtn').click();");
await waitFor("!document.querySelector('#saveDeputyScheduleBtn').disabled");assert.equal(scheduleWrites,1);assert.equal(statusWrites,1);
await navigate('todo.html',false);await waitFor("document.querySelector('#deputyTodos form')");
await evaluate("document.querySelector('#deputyTodos form input').value='Private deputy task';document.querySelector('#deputyTodos form').requestSubmit();");
await waitFor("document.querySelector('#deputyTodos').textContent.includes('Private deputy task')");assert.equal(privateTodos.length,1);
deputy=false;await navigate('todo.html',false);await waitFor("document.querySelector('main h2')?.textContent === 'Min grupps schema'");
assert.equal(await evaluate("return document.querySelector('#deputyTodos')===null;"),true);
console.log('PASS deputy edits schedule/status, private tasks, worker view after revocation');
role='production_manager';await navigate('dashboard.html');
await waitFor("document.querySelector('main').textContent.includes('Produktion och svinn per skift')");
await navigate('personal.html');
await waitFor("document.querySelector('main').textContent.includes('Microsoft Object ID')");
await navigate('todo.html');await waitFor("document.querySelector('#todoInput').disabled");
await navigate('installningar.html');await waitFor("document.querySelector('.password-change')?.hidden");
await navigate('produktion.html');
await evaluate("const input=document.querySelector('.production-result');input.value='12';input.dispatchEvent(new Event('input'));");
await waitFor("document.querySelector('#productionSaveStatus').textContent === 'Sparat automatiskt'");
assert.equal(Object.values(sharedData.get('staff_production_records_enc'))[0].machines.GD1.result,12);
console.log('PASS production autosaves through corporate API');
assert.deepEqual(errors,[],'Corporate browser errors');
console.log('PASS corporate manager summary, accounts, read-only tasks, hidden local tools');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close'); } catch { /* The browser may already have exited. */ }
  }
  socket?.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  browser?.kill();
  server.close();
});
