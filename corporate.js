/* Corporate adapter is inert in the existing local application. */
if (window.STAFF_CORPORATE) {
  let currentUser;
  let activeShift;
  const versions = new Map();
  const inflight = new Map();
  async function api(path, options = {}) {
    const response = await fetch(`/api/${path}`, {credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
    if (!response.ok) {
      if (response.status===401) {appUnlocked=false;location.assign('/auth/login');}
      if (response.status===403 && currentUser?.deputy) {appUnlocked=false;location.reload();}
      let message = response.status===403 ? 'Du saknar behörighet.' : 'Åtgärden misslyckades.';
      try {message=(await response.json()).error || message;} catch {}
      throw Error(message);
    }
    return response.status===204 ? null : response.json();
  }
  const pathFor = key => `data/${activeShift}/${encodeURIComponent(key)}`;
  async function read(key) {
    const result=await api(pathFor(key)); if(!versions.has(key))versions.set(key,result.version); return result.value;
  }
  decryptStoredItem = async function(key) {return read(key);};
  encryptStoredItem = async function(key,value) {
    if (!appUnlocked) throw Error('Logga in först.');
    // Serialize writes to the same key; version checks prevent cross-user lost updates.
    const previous=inflight.get(key) || Promise.resolve();
    const action=previous.catch(()=>{}).then(async()=>{
      if(!versions.has(key)) await read(key);
      const result=await api(pathFor(key),{method:'PUT',body:JSON.stringify({value,version:versions.get(key)})});
      versions.set(key,result.version);
    });
    inflight.set(key,action);try {await action;} finally {if(inflight.get(key)===action) inflight.delete(key);}
  };
  createAutomaticBackupIfNeeded = async function() {};
  createWorkItemSafetySnapshot = async function() {};
  setupAutoLock = function() {}; // Server session has an absolute eight-hour lifetime.
  setupOnboarding = async function() {};
  function element(tag,text,parent) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;}
  async function logout() {if(productionEditor && !await productionEditor.flush())return;await api('logout',{method:'POST'});location.assign('/');}
  function hideLocalTools() {
    document.querySelectorAll('#changePasswordForm, .password-change, #exportSettingsBackupBtn, #exportDataBtn, #importDataBtn, #importDataInput, [data-restore-auto-backup], [data-restore-snapshot]').forEach(e=>{e.hidden=true;});
  }
  function toolbar() {
    const sidebar=document.querySelector('.sidebar');
    const box=element('div',undefined,sidebar);box.className='corporate-context';
    element('p',`${currentUser.name} · ${currentUser.role==='production_manager'?'Produktionsledare':currentUser.role==='shift_leader'?'Skiftledare':currentUser.deputy?'Tillfällig ställföreträdare':'Medarbetare'}`,box);
    if(currentUser.role==='production_manager') {
      const select=element('select',undefined,box);select.setAttribute('aria-label','Välj skift');
      ['shift-1','shift-2','shift-3'].forEach((id,i)=>{const option=element('option',`Skift ${i+1}`,select);option.value=id;});select.value=activeShift;
      select.addEventListener('change',()=>{sessionStorage.setItem('corporate_shift',select.value);location.reload();});
    } else element('p',`${currentUser.shift_id}${currentUser.group_id?` · Grupp ${currentUser.group_id}`:''}`,box);
    const button=document.getElementById('logoutBtn'); if(button) {button.replaceWith(button.cloneNode(true));document.getElementById('logoutBtn').addEventListener('click',()=>void logout());}
  }
  async function renderWorker() {
    document.querySelectorAll('.nav-link').forEach(link=>{link.hidden=!link.getAttribute('href').includes('index.html');});
    const main=document.querySelector('main');main.replaceChildren();
    element('h2','Min grupps schema',main);
    const date=element('input',undefined,main);date.type='date';date.value=getSelectedWeekKey();date.setAttribute('aria-label','Veckans måndag');
    const content=element('section',undefined,main);content.className='card';
    async function update() {
      const selected=new Date(`${date.value}T12:00:00`);selected.setDate(selected.getDate()-((selected.getDay()+6)%7));
      const week=formatDateKey(selected);
      const result=await api(`my-schedule?week=${week}`);content.replaceChildren();
      element('p',`Vecka från ${week} · Grupp ${currentUser.group_id}`,content);
      const names=new Map(result.people.map(p=>[p.id,p.name]));
      const table=element('table',undefined,content);table.className='corporate-table';
      const header=element('tr',undefined,element('thead',undefined,table));['Arbetsplats',...ALL_DAYS].forEach(day=>element('th',day,header));
      const body=element('tbody',undefined,table);
      Object.entries(result.schedule).forEach(([task,days])=>{if(!Object.values(days).some(Boolean))return;const row=element('tr',undefined,body);element('td',task,row);ALL_DAYS.forEach(day=>element('td',names.get(days[day])||'—',row));});
      if(!body.children.length) element('p','Inget schema publicerat för din grupp denna vecka.',content);
    }
    date.addEventListener('change',()=>void update().catch(e=>showAppToast(e.message,'error')));await update();
  }
  async function delegationControls() {
    if(!location.pathname.endsWith('personal.html') && !location.pathname.endsWith('dashboard.html'))return;
    const section=element('section',undefined,document.querySelector('main'));section.className='card';section.id='delegationControls';
    element('h3','Tillfällig ställföreträdare',section);
    element('p','Välj en medarbetare i ditt skift som kan ändra schemat och personalstatus under din semester. Ställföreträdaren får en egen Att göra-lista. Återkalla behörigheten när du är tillbaka.',section);
    const result=await api('delegation');
    const current=result.workers.find(w=>w.id===result.delegation?.user_id);
    element('p',current?`Aktiv ställföreträdare: ${current.name}`:'Ingen aktiv ställföreträdare.',section);
    const select=element('select',undefined,section);select.setAttribute('aria-label','Välj ställföreträdare');select.id='deputySelect';
    element('option','Välj medarbetare',select).value='';result.workers.forEach(w=>element('option',`${w.name} (${w.email})`,select).value=w.id);select.value=current?.id || '';
    const grant=element('button','Ge tillfällig behörighet',section);grant.type='button';grant.className='btn primary';grant.id='grantDeputyBtn';
    const revoke=element('button','Återkalla behörighet',section);revoke.type='button';revoke.className='btn danger';revoke.id='revokeDeputyBtn';revoke.disabled=!result.delegation;
    grant.addEventListener('click',async()=>{if(!select.value)return;grant.disabled=true;try{await api('delegation',{method:'POST',body:JSON.stringify({userId:select.value})});location.reload();}catch(e){showAppToast(e.message,'error');grant.disabled=false;}});
    revoke.addEventListener('click',async()=>{revoke.disabled=true;try{await api('delegation',{method:'DELETE'});location.reload();}catch(e){showAppToast(e.message,'error');revoke.disabled=false;}});
  }
  async function renderDeputy() {
    document.querySelectorAll('.nav-link').forEach(link=>{link.hidden=!['index.html','personal.html','todo.html'].includes(link.getAttribute('href'));});
    const main=document.querySelector('main');main.replaceChildren();
    element('h2','Tillfällig ställföreträdare',main);
    element('p','Du kan ändra schema och personalstatus i ditt skift. Dina uppgifter i Att göra är privata.',main);
    if(location.pathname.endsWith('todo.html')) {await deputyTodos(main);return;}
    const card=element('section',undefined,main);card.className='card';
    const date=element('input',undefined,card);date.type='date';date.value=getSelectedWeekKey();date.setAttribute('aria-label','Veckans måndag');
    const content=element('div',undefined,card);
    async function update() {
      const selected=new Date(`${date.value}T12:00:00`);if(Number.isNaN(selected.getTime()))return;
      selected.setDate(selected.getDate()-((selected.getDay()+6)%7));const week=formatDateKey(selected);
      const plan=await api(`deputy/planning?week=${week}`);content.replaceChildren();
      let peopleVersion=plan.peopleVersion;
      const statusSection=element('section',undefined,content);element('h3','Personalstatus',statusSection);
      const labels={available:'Tillgänglig',sick:'Sjuk',vacation:'Semester',vab:'VAB',unavailable:'Ej tillgänglig'};
      plan.people.forEach(person=>{
        const row=element('label',person.name,statusSection);const status=element('select',undefined,row);status.setAttribute('aria-label',`Status för ${person.name}`);
        Object.entries(labels).forEach(([value,text])=>element('option',text,status).value=value);status.value=person.availability;
        status.addEventListener('change',async()=>{const previous=person.availability;status.disabled=true;try{const result=await api('deputy/availability',{method:'PATCH',body:JSON.stringify({personId:person.id,availability:status.value,version:peopleVersion})});peopleVersion=result.version;person.availability=status.value;showAppToast('Status sparades.');}catch(e){status.value=previous;showAppToast(e.message,'error');}finally{status.disabled=false;}});
      });
      element('h3',`Schema · ${week}`,content);
      const schedule=structuredClone(plan.schedule);
      const tasks=[...new Set([...DEFAULT_TASKS,...Object.keys(schedule),...plan.workItems.map(item=>item.name)])];
      const table=element('table',undefined,content);table.className='corporate-table';
      const header=element('tr',undefined,element('thead',undefined,table));['Arbetsplats',...ALL_DAYS].forEach(day=>element('th',day,header));const body=element('tbody',undefined,table);
      tasks.forEach(task=>{
        const row=element('tr',undefined,body);element('td',task,row);
        ALL_DAYS.forEach(day=>{const cell=element('td',undefined,row);const select=element('select',undefined,cell);select.setAttribute('aria-label',`${task} ${day}`);element('option','—',select).value='';plan.people.forEach(p=>element('option',p.name,select).value=p.id);select.value=schedule[task]?.[day] || '';select.addEventListener('change',()=>{schedule[task] ||= {};schedule[task][day]=select.value;});});
      });
      const save=element('button','Spara schema',content);save.type='button';save.className='btn primary';save.id='saveDeputyScheduleBtn';
      save.addEventListener('click',async()=>{save.disabled=true;try{const result=await api('deputy/planning',{method:'PUT',body:JSON.stringify({week,schedule,version:plan.version})});plan.version=result.version;showAppToast('Schemat sparades.');}catch(e){showAppToast(e.message,'error');}finally{save.disabled=false;}});
    }
    date.addEventListener('change',()=>void update().catch(e=>showAppToast(e.message,'error')));await update();
  }
  async function deputyTodos(main) {
    const card=element('section',undefined,main);card.className='card';card.id='deputyTodos';element('h3','Min Att göra',card);
    const result=await api('deputy/todos');let todos=result.value,version=result.version;
    const form=element('form',undefined,card);const input=element('input',undefined,form);input.required=true;input.maxLength=200;input.setAttribute('aria-label','Ny privat uppgift');
    const add=element('button','Lägg till',form);add.type='submit';add.className='btn primary';
    const list=element('div',undefined,card);let pending=false;
    const draw=()=>{list.replaceChildren();todos.forEach(item=>{const row=element('div',undefined,list);const label=element('label',undefined,row);const check=element('input',undefined,label);check.type='checkbox';check.checked=item.done;check.disabled=pending;element('span',item.text,label);check.addEventListener('change',()=>void persist(todos.map(t=>t.id===item.id?{...t,done:check.checked}:t)));const remove=element('button','Ta bort',row);remove.type='button';remove.disabled=pending;remove.addEventListener('click',()=>void persist(todos.filter(t=>t.id!==item.id)));});};
    async function persist(next) {if(pending)return;pending=true;add.disabled=true;draw();try{const saved=await api('deputy/todos',{method:'PUT',body:JSON.stringify({value:next,version})});todos=next;version=saved.version;input.value='';}catch(e){showAppToast(e.message,'error');}finally{pending=false;add.disabled=false;draw();}}
    form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(text)void persist([...todos,{id:crypto.randomUUID(),text,done:false}]);});draw();
  }
  async function managerSummary() {
    const root=document.getElementById('dashboardPage');if(!root)return;
    const card=element('section',undefined,root);card.className='card';element('h3','Produktion och svinn per skift',card);
    const date=element('input',undefined,card);date.type='date';date.value=formatDateKey(new Date());date.setAttribute('aria-label','Datum för skiftöversikt');
    const result=await api('summary');const rows=element('div',undefined,card);
    const update=()=>{rows.replaceChildren();result.forEach(item=>{const day=item.days.find(d=>d.date===date.value);element('p',`${item.shift}: ${day?`${day.production} BOX · ${day.waste.toFixed(2)} KG svinn`:'Ingen produktion registrerad'}`,rows);});};date.addEventListener('change',update);update();
  }
  const renderLocalDashboard = renderDashboard;
  renderDashboard = async function() {
    await renderLocalDashboard();
    if(currentUser?.role==='production_manager') await managerSummary();
  };
  async function accounts() {
    if(!document.getElementById('personalTable') && !location.pathname.endsWith('personal.html'))return;
    const section=element('section',undefined,document.querySelector('main'));section.className='card';
    element('h3','Konton och behörigheter',section);
    element('p','Microsoft Object ID finns i Entra. Grupp och Personal-ID kopplar arbetaren till schemat. Endast en aktiv skiftledare per skift.',section);
    const users=await api('users');const chooser=element('select',undefined,section);chooser.setAttribute('aria-label','Välj konto');element('option','Nytt konto',chooser).value='';
    users.forEach(u=>element('option',`${u.name} (${u.email})`,chooser).value=u.id);
    const form=element('form',undefined,section);const fields={};
    for(const [key,label] of [['name','Namn'],['email','Arbetsmejl'],['oid','Microsoft Object ID'],['group_id','Grupp'],['person_id','Personal-ID']]) {const wrap=element('label',label,form);const input=element('input',undefined,wrap);input.type=key==='email'?'email':'text';input.required=['name','email','oid'].includes(key);fields[key]=input;}
    for(const [key,label,values] of [['role','Behörighet',['production_manager','shift_leader','worker']],['shift_id','Skift',['shift-1','shift-2','shift-3']]]) {const wrap=element('label',label,form);fields[key]=element('select',undefined,wrap);values.forEach(value=>element('option',({production_manager:'Produktionsledare',shift_leader:'Skiftledare',worker:'Medarbetare'})[value]||value,fields[key]).value=value);}
    const activeLabel=element('label','Aktivt konto',form);fields.active=element('input',undefined,activeLabel);fields.active.type='checkbox';fields.active.checked=true;
    const saveButton=element('button','Spara konto',form);saveButton.className='btn primary';saveButton.type='submit';
    chooser.addEventListener('change',()=>{const user=users.find(u=>u.id===chooser.value);for(const [key,input] of Object.entries(fields)){if(key==='active')input.checked=user?.active ?? true;else input.value=user?.[key]|| (key==='role'?'worker':key==='shift_id'?'shift-1':'');}});
    form.addEventListener('submit',async event=>{event.preventDefault();saveButton.disabled=true;try{const value=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='active'?input.checked:input.value.trim()]));await api(`users/${chooser.value || crypto.randomUUID()}`,{method:'PUT',body:JSON.stringify(value)});showAppToast('Kontot sparades.');location.reload();}catch(e){showAppToast(e.message,'error');}finally{saveButton.disabled=false;}});
    const people=await getPeople();element('h3','Tilldela schemagrupp',section);
    for(const person of people) {const row=element('div',undefined,section);element('span',`${person.name} · Personal-ID: ${person.id} `,row);const input=element('input',undefined,row);input.value=person.groupId||'';input.setAttribute('aria-label',`Grupp för ${person.name}`);const button=element('button','Spara grupp',row);button.type='button';button.className='btn';button.addEventListener('click',async()=>{button.disabled=true;try{person.groupId=input.value.trim();await savePeople(people);showAppToast('Gruppen sparades.');}catch(e){showAppToast(e.message,'error');}finally{button.disabled=false;}});}
  }
  setupAuthUI = async function() {
    appUnlocked=false;sessionKey=null;
    const {authScreen,appShell}=getAuthElements();appShell?.classList.add('hidden');authScreen?.classList.remove('hidden');finishInitialViewSetup();
    authScreen.querySelector('.auth-card').replaceChildren();const card=authScreen.querySelector('.auth-card');element('h2','Logga in med arbetskontot',card);element('p','Använd ditt Microsoft 365-konto. Behörighet tilldelas av produktionsledaren.',card);const link=element('a','Logga in med Microsoft',card);link.href='/auth/login';link.className='btn primary';
    const response=await fetch('/api/me',{cache:'no-store'});if(response.status===401)return;if(!response.ok)throw Error('Kunde inte läsa kontot.');currentUser=await response.json();
    activeShift=currentUser.role==='production_manager'?(sessionStorage.getItem('corporate_shift')||'shift-1'):currentUser.shift_id;
    if(!['shift-1','shift-2','shift-3'].includes(activeShift))activeShift='shift-1';
    versions.clear();appUnlocked=true;sessionKey={corporate:true};
    if(currentUser.role==='worker') {setAuthenticatedView(true);authScreen.classList.add('hidden');appShell.classList.remove('hidden');toolbar();if(currentUser.deputy)await renderDeputy();else await renderWorker();return;}
    await openAppUI();toolbar();hideLocalTools();new MutationObserver(hideLocalTools).observe(document.querySelector('main'),{childList:true,subtree:true});
    if(currentUser.role==='shift_leader') await delegationControls();
    if(currentUser.role==='production_manager') {
      if(location.pathname.endsWith('todo.html')) {
        const root=document.getElementById('todoPage') || document.querySelector('main');
        const disable=()=>root.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);disable();new MutationObserver(disable).observe(root,{childList:true,subtree:true});
      }
      await accounts();
    }
  };
}
