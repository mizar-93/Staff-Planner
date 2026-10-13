import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {pool,data,save} from './store.mjs';
import {allowed,roles,shifts,workerSchedule,isDeputy,canDelegate,validDeputySchedule} from './access.mjs';
const app = express();
const origin = process.env.PUBLIC_ORIGIN;
const tenant = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
if (!origin || !/^[\da-f-]{36}$/i.test(tenant || '') || !clientId || !process.env.ENTRA_CLIENT_SECRET || !process.env.DATABASE_URL) throw Error('Fill .env before starting corporate mode');
const authority = `https://login.microsoftonline.com/${tenant}`;
const jwks = createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`));
const callback = `${origin}/auth/callback`;
const hash = v => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const pending = new Map();
const secure = origin.startsWith('https://');
const cookieOptions = {httpOnly:true,secure,sameSite:'lax',path:'/'};
function cookie(req,name) {return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);}
app.disable('x-powered-by');
app.use(express.json({limit:'4mb'}));
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','same-origin');
  if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) return res.sendStatus(403);
  next();
});
app.get('/corporate-config.js',(_req,res)=>res.type('js').send('window.STAFF_CORPORATE=true;'));
app.get('/auth/login',(req,res)=>{
  for (const [key,value] of pending) if (value.expires < Date.now()) pending.delete(key);
  if (pending.size > 1000) return res.sendStatus(429);
  const state=random(),nonce=random(),verifier=random(),browser=random();
  pending.set(state,{nonce,verifier,browser:hash(browser),expires:Date.now()+600000});
  res.cookie('planner_login',browser,{...cookieOptions,maxAge:600000});
  const query = new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:callback,response_mode:'query',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  res.redirect(`${authority}/oauth2/v2.0/authorize?${query}`);
});
app.get('/auth/callback',async(req,res)=>{
  const attempt=pending.get(req.query.state); pending.delete(req.query.state);
  if (!attempt || attempt.expires<Date.now() || hash(cookie(req,'planner_login') || '')!==attempt.browser || typeof req.query.code!=='string') return res.status(401).send('Inloggningen kunde inte verifieras.');
  const response=await fetch(`${authority}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:process.env.ENTRA_CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:callback,code_verifier:attempt.verifier})});
  if (!response.ok) return res.status(401).send('Microsoft-inloggningen misslyckades.');
  const token=await response.json();
  const {payload}=await jwtVerify(token.id_token,jwks,{issuer:`${authority}/v2.0`,audience:clientId});
  if(payload.nonce!==attempt.nonce || payload.tid!==tenant || !payload.oid) return res.sendStatus(401);
  // Accounts are explicitly provisioned with immutable Microsoft Object IDs.
  const user=(await pool.query('SELECT * FROM planner_users WHERE oid=$1 AND active=true',[payload.oid])).rows[0];
  if (!user) return res.status(403).send('Ditt konto saknar behörighet. Kontakta produktionsledaren.');
  const session=random();
  await pool.query('DELETE FROM planner_sessions WHERE expires_at < now()');
  await pool.query('INSERT INTO planner_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'8 hours\')',[hash(session),user.id]);
  res.clearCookie('planner_login',cookieOptions);
  res.cookie('planner_session',session,{...cookieOptions,maxAge:28800000});
  res.redirect('/dashboard.html');
});
app.use('/api',async(req,res,next)=>{
  const token=cookie(req,'planner_session'); if(!token) return res.sendStatus(401);
  req.user=(await pool.query("SELECT u.*, EXISTS(SELECT 1 FROM planner_delegations d JOIN planner_users leader ON leader.id=d.leader_id WHERE d.user_id=u.id AND leader.active=true AND leader.role='shift_leader' AND leader.shift_id=u.shift_id AND u.role='worker') AS deputy FROM planner_sessions s JOIN planner_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",[hash(token)])).rows[0];
  if(!req.user) return res.sendStatus(401); next();
});
app.get('/api/me',(req,res)=>res.json(req.user));
app.get('/api/delegation',async(req,res)=>{
  if(req.user.role!=='shift_leader') return res.sendStatus(403);
  const workers=(await pool.query("SELECT id,name,email FROM planner_users WHERE role='worker' AND active=true AND shift_id=$1 ORDER BY name",[req.user.shift_id])).rows;
  const delegation=(await pool.query('SELECT user_id,granted_at FROM planner_delegations WHERE leader_id=$1',[req.user.id])).rows[0] || null;
  res.json({workers,delegation});
});
app.post('/api/delegation',async(req,res)=>{
  if(req.user.role!=='shift_leader') return res.sendStatus(403);
  if(!/^[\da-f-]{36}$/i.test(req.body.userId || '')) return res.sendStatus(400);
  const connection=await pool.connect();
  try {
    await connection.query('BEGIN');
    const leader=(await connection.query('SELECT * FROM planner_users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
    const worker=(await connection.query('SELECT * FROM planner_users WHERE id=$1 FOR UPDATE',[req.body.userId])).rows[0];
    if(!canDelegate(leader,worker)) {await connection.query('ROLLBACK');return res.sendStatus(403);}
    await connection.query('DELETE FROM planner_delegations WHERE leader_id=$1',[leader.id]);
    await connection.query('INSERT INTO planner_delegations(user_id,leader_id) VALUES($1,$2)',[worker.id,leader.id]);
    await connection.query('COMMIT');res.sendStatus(204);
  } catch(error) {await connection.query('ROLLBACK');throw error;} finally {connection.release();}
});
app.delete('/api/delegation',async(req,res)=>{
  if(req.user.role!=='shift_leader') return res.sendStatus(403);
  await pool.query('DELETE FROM planner_delegations WHERE leader_id=$1',[req.user.id]);res.sendStatus(204);
});
app.use('/api/deputy',(req,res,next)=>{if(!isDeputy(req.user))return res.sendStatus(403);next();});
app.get('/api/deputy/planning',async(req,res)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || ''))return res.sendStatus(400);
  const [people,schedule,items]=await Promise.all([data(req.user.shift_id,'staff_people_enc'),data(req.user.shift_id,`staff_schedule_enc:${req.query.week}`),data(req.user.shift_id,'staff_work_items_enc')]);
  res.json({people:(Array.isArray(people.value)?people.value:[]).map(p=>({id:p.id,name:p.name,availability:p.availability || 'available'})),peopleVersion:people.version,schedule:schedule.value || {},version:schedule.version,workItems:(Array.isArray(items.value)?items.value:[]).filter(item=>item.showInSchema!==false).map(item=>({name:item.name}))});
});
app.put('/api/deputy/planning',async(req,res)=>{
  const {week,schedule,version}=req.body;
  const people=(await data(req.user.shift_id,'staff_people_enc')).value || [];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week || '') || !Number.isInteger(version) || version<0 || !validDeputySchedule(schedule,people))return res.sendStatus(400);
  const result=await save(req.user.shift_id,`staff_schedule_enc:${week}`,schedule,version);
  if(!result)return res.status(409).json({error:'Schemat ändrades. Ladda om innan du sparar.'});res.json(result);
});
app.patch('/api/deputy/availability',async(req,res)=>{
  const {personId,availability,version}=req.body;
  if(!['available','sick','vacation','vab','unavailable'].includes(availability) || !Number.isInteger(version))return res.sendStatus(400);
  const stored=await data(req.user.shift_id,'staff_people_enc');
  const people=Array.isArray(stored.value)?stored.value:[];
  const person=people.find(p=>p.id===personId);if(!person)return res.sendStatus(404);
  person.availability=availability;
  const result=await save(req.user.shift_id,'staff_people_enc',people,version);
  if(!result)return res.status(409).json({error:'Personalstatus ändrades. Ladda om innan du sparar.'});res.json(result);
});
app.get('/api/deputy/todos',async(req,res)=>{
  res.json((await pool.query('SELECT value,version FROM planner_private_todos WHERE user_id=$1',[req.user.id])).rows[0] || {value:[],version:0});
});
app.put('/api/deputy/todos',async(req,res)=>{
  const {value,version}=req.body;
  if(!Array.isArray(value) || value.length>500 || !value.every(item=>typeof item.id==='string' && typeof item.text==='string' && item.text.length<=200 && typeof item.done==='boolean') || !Number.isInteger(version) || version<0)return res.sendStatus(400);
  const result=version===0 ? await pool.query('INSERT INTO planner_private_todos(user_id,value) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING version',[req.user.id,JSON.stringify(value)]) : await pool.query('UPDATE planner_private_todos SET value=$2,version=version+1 WHERE user_id=$1 AND version=$3 RETURNING version',[req.user.id,JSON.stringify(value),version]);
  if(!result.rows[0])return res.status(409).json({error:'Uppgifterna ändrades. Ladda om sidan.'});res.json(result.rows[0]);
});
app.post('/api/logout',async(req,res)=>{await pool.query('DELETE FROM planner_sessions WHERE token_hash=$1',[hash(cookie(req,'planner_session'))]);res.clearCookie('planner_session',cookieOptions);res.sendStatus(204);});
app.get('/api/data/:shift/:key',async(req,res)=>{
  if(!allowed(req.user,req.params.shift,req.params.key)) return res.sendStatus(403);
  res.json(await data(req.params.shift,req.params.key));
});
app.put('/api/data/:shift/:key',async(req,res)=>{
  const {shift,key}=req.params;
  if(!allowed(req.user,shift,key,true)) return res.sendStatus(403);
  if(!Number.isInteger(req.body.version) || req.body.version<0 || req.body.value===undefined) return res.sendStatus(400);
  const saved=await save(shift,key,req.body.value,req.body.version);
  if(!saved) return res.status(409).json({error:'Data ändrades av en annan användare. Ladda om sidan.'});
  res.json(saved);
});
app.get('/api/my-schedule',async(req,res)=>{
  if(req.user.role!=='worker' || !/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '')) return res.sendStatus(400);
  const [people,schedule]=await Promise.all([data(req.user.shift_id,'staff_people_enc'),data(req.user.shift_id,`staff_schedule_enc:${req.query.week}`)]);
  res.json(workerSchedule(schedule.value,Array.isArray(people.value)?people.value:[],req.user));
});
app.get('/api/summary',async(req,res)=>{
  if(req.user.role!=='production_manager') return res.sendStatus(403);
  const result=await Promise.all(shifts.map(async shift=>{
    const records=(await data(shift,'staff_production_records_enc')).value || {};
    return {shift,days:Object.values(records).map(day=>({date:day.date,production:Object.values(day.machines||{}).reduce((s,m)=>s+(Number(m.result)||0),0),waste:Object.values(day.machines||{}).reduce((s,m)=>s+(Number(m.waste)||0),0)}))};
  }));res.json(result);
});
app.get('/api/users',async(req,res)=>{
  if(req.user.role!=='production_manager') return res.sendStatus(403);
  res.json((await pool.query('SELECT * FROM planner_users ORDER BY name')).rows);
});
app.put('/api/users/:id',async(req,res)=>{
  if(req.user.role!=='production_manager') return res.sendStatus(403);
  const u=req.body;
  if(!/^[\da-f-]{36}$/i.test(req.params.id) || !/^[\da-f-]{36}$/i.test(u.oid || '') || !roles.includes(u.role) || typeof u.name!=='string' || !u.name.trim() || typeof u.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) || typeof u.active!=='boolean' || (u.role!=='production_manager' && !shifts.includes(u.shift_id)) || (u.role==='worker' && (!u.group_id || !u.person_id))) return res.sendStatus(400);
  if(req.params.id===req.user.id && (u.role!=='production_manager' || !u.active || u.oid!==req.user.oid)) return res.status(400).json({error:'Du kan inte ta bort din egen administratörsbehörighet.'});
  if(u.role==='worker') {
    const people=(await data(u.shift_id,'staff_people_enc')).value;
    if(!Array.isArray(people) || !people.some(person=>person.id===u.person_id && person.groupId===u.group_id)) return res.status(400).json({error:'Personal-ID och grupp måste matcha en person i valt skift. Tilldela schemagrupp först.'});
  }
  await pool.query('INSERT INTO planner_users(id,email,name,oid,role,shift_id,group_id,person_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET email=$2,name=$3,oid=$4,role=$5,shift_id=$6,group_id=$7,person_id=$8,active=$9',[req.params.id,u.email.toLowerCase(),u.name.trim(),u.oid,u.role,u.role==='production_manager'?null:u.shift_id,u.group_id||null,u.person_id||null,u.active]);
  await pool.query('DELETE FROM planner_sessions WHERE user_id=$1',[req.params.id]);
  await pool.query('DELETE FROM planner_delegations WHERE user_id=$1 OR leader_id=$1',[req.params.id]);
  res.sendStatus(204);
});
// Explicit public asset list: never expose .env, SQL, tests, or server source.
const root=fileURLToPath(new URL('../',import.meta.url));
const assets=['index.html','dashboard.html','produktion.html','rast.html','personal.html','testresultat.html','maskiner.html','bedomning.html','todo.html','add.html','installningar.html','hjalp.html','app.js','corporate.js','style.css','app-icon.svg','manifest.webmanifest'];
for(const asset of assets) app.get(`/${asset}`,(_req,res)=>res.sendFile(asset,{root}));
app.get('/',(_req,res)=>res.redirect('/dashboard.html'));
app.get('/service-worker.js',(_req,res)=>res.type('js').send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('staff-planner-')).map(k=>caches.delete(k)))),self.registration.unregister()]).then(()=>self.clients.claim())));"));
app.use((error,_req,res,_next)=>{console.error('Request failed',error.code || error.name);res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'E-post, Microsoft-ID eller skiftledare finns redan.':'Åtgärden misslyckades.'});});
app.listen(Number(process.env.PORT)||3000,()=>console.log('Staff Planner corporate server ready'));
