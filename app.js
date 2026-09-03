const S={parties:[],bills:[],deposits:[],doctors:[],rx:[],targets:[],items:[]};
let mem=null, openParty=null, editParty=null;
let openDoc=null, editDoc=null, editRx=null, editTg=null, editItem=null;
let fh=null, dirty=false, lastSaved=null, timer=null, fsMsg='';
const canFS=typeof window.showSaveFilePicker==='function';
const V={};
const $=id=>document.getElementById(id);
/* round-off: when CFG.round is on, every rupee figure is shown as a whole number,
   half a rupee and above going up, the rest going down; the stored data is untouched */
const rup=n=>{n=+n||0;return CFG.round?(n<0?-Math.round(-n):Math.round(n)):n};
const money=n=>'\u20B9'+rup(n).toLocaleString('en-IN');
const smoney=n=>(+n<0?'\u2212':'+')+'\u20B9'+rup(Math.abs(+n||0)).toLocaleString('en-IN');
const gapTxt=n=>n>0?money(n)+' short':n<0?money(-n)+' ahead':'\u2014';
const dmy=s=>{if(!s)return'\u2014';const p=s.split('-');return p[2]+'/'+p[1]+'/'+p[0]};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
let tsSeq=0;
/* strictly-increasing epoch-ms: a distinct value for every object even when
   several are stamped inside the same millisecond */
const nowTs=()=>{const n=Date.now();return tsSeq=n>tsSeq?n:tsSeq+1};
/* give every stored record a stable creation timestamp; existing ones keep theirs */
const stampTs=()=>['parties','bills','deposits','doctors','rx','targets','items']
  .forEach(k=>(S[k]||[]).forEach(o=>{if(o&&o.ts==null)o.ts=nowTs()}));
const esc=s=>String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const val=id=>$(id).value.trim();
const T=(t,c,a)=>({t:t==null?'':String(t),c:c||'',a:a||'l'});

/* ---------- storage: artifact store, then localStorage, then memory ---------- */
const store={
  async get(k){
    try{if(window.storage){const r=await window.storage.get(k);if(r&&r.value!=null)return r.value}}catch(e){}
    try{const v=localStorage.getItem(k);if(v!=null)return v}catch(e){}
    return null;
  },
  async set(k,v){
    let ok=false;
    try{if(window.storage){await window.storage.set(k,v);ok=true}}catch(e){}
    try{localStorage.setItem(k,v);ok=true}catch(e){}
    return ok;
  }
};
const CFG={min:1,on:true,asked:false,name:'',theme:'',round:false};
function applyTheme(){
  if(CFG.theme)document.documentElement.setAttribute('data-theme',CFG.theme);
  else document.documentElement.removeAttribute('data-theme');
}
$('themeToggle').onclick=async()=>{
  const sysDark=matchMedia('(prefers-color-scheme: dark)').matches;
  const current=CFG.theme||(sysDark?'dark':'light');
  CFG.theme=current==='dark'?'light':'dark';
  applyTheme();
  await saveCfg();
};
/* ---------- software key and single-device claim ---------- */
const LOCKMIN=10;
const LIC={hash:'',devId:'',devName:'',key:''};
let locked=false;
function keyHash(k){
  let h=0x811c9dc5;const str='bts::'+String(k||'');
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=(h*0x01000193)>>>0}
  let g=0x9e3779b9;
  for(let i=str.length-1;i>=0;i--){g^=str.charCodeAt(i);g=(g*0x85ebca6b)>>>0}
  return (h>>>0).toString(16).padStart(8,'0')+(g>>>0).toString(16).padStart(8,'0');
}
const newDevId=()=>'d'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const saveLic=()=>store.set('btslic',JSON.stringify(LIC));
const claim=()=>({id:LIC.devId,name:LIC.devName||'Unnamed device',at:Date.now()});
const ago=ms=>{const m=Math.round(ms/60000);return m<1?'less than a minute ago':m===1?'a minute ago':m+' minutes ago'};
/* bills and deposits are no longer used by the app; anything already recorded is carried
   through saves and backups untouched so nothing is lost */
const snapshot=(release)=>(stampTs(),{exportedAt:new Date().toISOString(),
  lic:{hash:LIC.hash,device:release?{id:LIC.devId,name:LIC.devName,at:0}:claim()},
  parties:S.parties,items:S.items,
  doctors:S.doctors,rx:S.rx,targets:S.targets,bills:S.bills,deposits:S.deposits});
const saveCfg=()=>store.set('btscfg',JSON.stringify(CFG));

/* ---------- Firebase-backed device claim: enforces "one device per key" over the
   internet, independent of any shared file, using the public RTDB REST API ---------- */
const FB_URL='https://medman-f69c9-default-rtdb.firebaseio.com';
async function fbGet(path){
  try{const r=await fetch(FB_URL+'/'+path+'.json');if(!r.ok)return null;return await r.json()}catch(e){return null}
}
async function fbSet(path,v){
  try{const r=await fetch(FB_URL+'/'+path+'.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});return r.ok}catch(e){return false}
}
async function fbGuard(hash){
  hash=hash||LIC.hash;
  if(!hash)return{ok:true};
  const c=await fbGet('licenses/'+hash+'/claim');
  if(!c||!c.id||c.id===LIC.devId)return{ok:true};
  if((Date.now()-(+c.at||0))<LOCKMIN*60000)return{ok:false,why:'device',dev:c,source:'license'};
  return{ok:true};
}
function fbClaim(){if(LIC.hash)fbSet('licenses/'+LIC.hash+'/claim',claim())}
/* validates an activated key against the catalog the admin portal manages: it must exist,
   not be revoked, and not be past its expiry date. Caches the record in LICINFO so the
   "licence details" panel can show it without a second round trip. */
let LICINFO={};
async function fbLicenseCheck(hash){
  hash=hash||LIC.hash;
  if(!hash)return{ok:true};
  const lic=await fbGet('licenses/'+hash);
  if(!lic)return{ok:false,why:'unknown'};
  LICINFO=lic;
  if(lic.active===false)return{ok:false,why:'revoked'};
  if(lic.expiresAt&&Date.now()>+lic.expiresAt)return{ok:false,why:'expired'};
  return{ok:true};
}
function licenseKickOut(why){
  clearInterval(fbTimer);fbTimer=null;clearInterval(timer);timer=null;
  LIC.hash='';LIC.key='';LICINFO={};saveLic();
  alert(why==='revoked'?'This software key has been revoked. Contact your administrator for a new key.'
    :why==='expired'?'This software key has expired. Contact your administrator to renew it.'
    :'This software key is not recognised. Contact your administrator for a valid key.');
  licPaint();fsPaint();showActivate();
}
async function fbRelease(){
  if(!LIC.hash)return;
  const c=await fbGet('licenses/'+LIC.hash+'/claim');
  if(c&&c.id===LIC.devId)await fbSet('licenses/'+LIC.hash+'/claim',null);
}
let fbTimer=null;
function fbStart(){
  clearInterval(fbTimer);fbTimer=null;
  if(!LIC.hash)return;
  fbClaim();
  fbTimer=setInterval(async()=>{
    if(locked)return;
    const lc=await fbLicenseCheck();
    if(!lc.ok){licenseKickOut(lc.why);return}
    licPaint();
    const g=await fbGuard();
    if(!g.ok){showLock(g);return}
    fbClaim();
  },30000);
}

/* ---------- the data file: pick it once, then write to it silently ---------- */
function idb(){return new Promise((res,rej)=>{
  if(!window.indexedDB)return rej('no idb');
  const r=indexedDB.open('bts-fs',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('h');
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbPut(k,v){const db=await idb();return new Promise((res,rej)=>{
  const t=db.transaction('h','readwrite');t.objectStore('h').put(v,k);t.oncomplete=()=>res(1);t.onerror=()=>rej(t.error)})}
async function idbGet(k){const db=await idb();return new Promise((res,rej)=>{
  const t=db.transaction('h','readonly'),q=t.objectStore('h').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function idbDel(k){const db=await idb();return new Promise((res,rej)=>{
  const t=db.transaction('h','readwrite');t.objectStore('h').delete(k);t.oncomplete=()=>res(1);t.onerror=()=>rej(t.error)})}

async function fsRestore(){try{const h=await idbGet('fh');if(h)fh=h}catch(e){}}
async function fsPerm(ask){
  if(!fh)return false;
  try{
    if(fh.queryPermission){const p=await fh.queryPermission({mode:'readwrite'});if(p==='granted')return true}
    if(ask&&fh.requestPermission)return (await fh.requestPermission({mode:'readwrite'}))==='granted';
    return !fh.queryPermission;
  }catch(e){return false}
}
async function fsRead(){
  if(!fh)return null;
  try{const txt=await (await fh.getFile()).text();return txt.trim()?JSON.parse(txt):null}catch(e){return null}
}
/* nobody writes to a file another device is holding, and nobody opens a file locked to a different key */
async function fsGuard(){
  if(!fh)return {ok:true};
  const d=await fsRead();
  if(!d||!d.lic)return {ok:true};
  if(LIC.hash&&d.lic.hash&&d.lic.hash!==LIC.hash)return {ok:false,why:'key'};
  const dev=d.lic.device;
  if(dev&&dev.id&&dev.id!==LIC.devId&&(Date.now()-(+dev.at||0))<LOCKMIN*60000)return {ok:false,why:'device',dev};
  return {ok:true};
}
async function fsWrite(force,release){
  if(!fh)return false;
  if(!force&&!dirty)return true;
  if(!(await fsPerm(false))){fsMsg='needperm';fsPaint();return false}
  const g=await fsGuard();
  if(!g.ok){showLock(g);return false}
  try{
    const w=await fh.createWritable();
    await w.write(JSON.stringify(snapshot(release),null,2));
    await w.close();
    dirty=false;lastSaved=new Date();fsMsg='';fsPaint();return true;
  }catch(e){fsMsg='Could not write to the file: '+(e.message||e);fsPaint();return false}
}
async function fsPick(){
  if(!canFS){fsMsg='unsupported';fsPaint();return false}
  try{
    const h=await window.showSaveFilePicker({suggestedName:CFG.name||'bill-tracking-data.json',
      types:[{description:'Bill Tracking data',accept:{'application/json':['.json']}}]});
    fh=h;CFG.name=h.name;CFG.asked=true;CFG.on=true;
    try{await idbPut('fh',h)}catch(e){}
    await saveCfg();
    const g=await fsGuard();
    if(!g.ok){showLock(g);return true}
    dirty=true;await fsWrite(true);startTimer();licPaint();fsPaint();return true;
  }catch(e){if(e&&e.name==='AbortError')return false;
    fsMsg=(e&&e.name==='SecurityError')?'blocked':'Could not open the file picker: '+(e.message||e);fsPaint();return false}
}
async function fsOpenExisting(){
  if(!canFS){fsMsg='unsupported';fsPaint();return false}
  try{
    const [h]=await window.showOpenFilePicker({types:[{description:'Bill Tracking data',accept:{'application/json':['.json']}}]});
    const d=JSON.parse(await (await h.getFile()).text());
    if(!d||(!d.parties&&!d.bills&&!d.deposits&&!d.doctors&&!d.rx&&!d.targets))
      {alert('That file is not a Bill Tracking data file.');return false}
    const has=S.parties.length||S.items.length||S.doctors.length||S.rx.length||S.targets.length;
    if(has&&confirm('This device already holds data.\n\nOK = replace it with what is in '+h.name+
      '\nCancel = merge the file into what is already here'))
      {S.parties=[];S.bills=[];S.deposits=[];S.doctors=[];S.rx=[];S.targets=[];S.items=[];}
    mergeData(d);
    fh=h;CFG.name=h.name;CFG.asked=true;CFG.on=true;
    try{await idbPut('fh',h)}catch(e){}
    await saveCfg();openParty=null;openDoc=null;await save();await fsWrite(true);startTimer();
    $('dataHint').textContent='Loaded '+h.name+'. Now holding '+S.parties.length+' medicals, '+S.items.length+' items, '+S.doctors.length+' doctors, '+S.rx.length+' prescriptions, '+S.targets.length+' targets.';
    return true;
  }catch(e){if(e&&e.name==='AbortError')return false;
    fsMsg=(e&&e.name==='SecurityError')?'blocked':'Could not open that file: '+(e.message||e);fsPaint();return false}
}
async function fsStop(){
  if(!confirm('Stop auto-saving into '+(CFG.name||'the data file')+'?\nYour data stays on this device and the file keeps its last saved copy.'))return;
  fh=null;CFG.name='';try{await idbDel('fh')}catch(e){}
  await saveCfg();fsPaint();
}
function startTimer(){
  clearInterval(timer);timer=null;
  const m=Math.max(1,+CFG.min||1);
  if(!CFG.on)return;
  timer=setInterval(()=>{if(fh)fsWrite();},m*60000);
}
function fsPaint(){
  const on=CFG.on,m=Math.max(1,+CFG.min||1);
  const every=m%60===0&&m>=60?(m/60)+' hour'+(m===60?'':'s'):m+' minute'+(m===1?'':'s');
  let head;
  if(fh)head=(on?'Auto-saving to ':'File set, auto-save off: ')+CFG.name+(lastSaved?' \u00B7 last saved '+lastSaved.toTimeString().slice(0,5):(dirty?' \u00B7 unsaved changes':''));
  else head=mem?'Session only \u2014 download a backup before closing':'Saved on this device';
  $('saveState').textContent=head;
  if(!$('fsStat'))return;
  const dot=fh?(fsMsg==='needperm'?'warn':on?'':'off'):'off';
  const state=!canFS?'This browser cannot write straight to a file.'
    :fsMsg==='needperm'?'Permission to write to '+CFG.name+' has lapsed. Press Reconnect.'
    :fh?(on?'Auto-saving to '+CFG.name+' every '+every:'Linked to '+CFG.name+', auto-save is switched off')
    :'No data file chosen. Data lives in this browser only.';
  $('fsStat').innerHTML='<span><span class="dot '+dot+'"></span>'+esc(state)+'</span>'+
    (lastSaved?'<span>Last written '+lastSaved.toTimeString().slice(0,8)+'</span>':'')+
    (dirty&&fh?'<span class="due">Changes waiting</span>':'');
  $('fsPick').textContent=fh?'Change data file':'Choose data file';
  $('fsStop').style.display=fh?'':'none';
  $('fsNow').textContent=fsMsg==='needperm'?'Reconnect and save now':'Save to file now';
  $('fsNow').disabled=!fh;
  $('fsOn').checked=!!on;
  $('roundOff').checked=!!CFG.round;
  if(d0!==CFG.min){d0=CFG.min;$('fsMin').value=(m%60===0&&m>=60)?m/60:m;$('fsUnit').value=(m%60===0&&m>=60)?'60':'1'}
  $('fsHint').innerHTML=!canFS
    ? 'Chrome or Edge on a computer can write straight into a file you pick, so your data sits in your own folder and syncs through Google Drive or OneDrive if you keep it there. This browser cannot, so use Download backup JSON above and load it back when you need it.'
    : (fsMsg&&fsMsg!=='needperm'&&fsMsg!=='unsupported'&&fsMsg!=='blocked'?'<span class="due">'+esc(fsMsg)+'</span><br>':'')+
      (fsMsg==='blocked'?'<span class="due">The browser blocked the file picker here. Save this page to your computer and open it directly, then it will work.</span><br>':'')+
      'Pick a file once and this app keeps writing your data into it on its own. Put it in a Drive or OneDrive folder and every device stays in step. Saving also happens whenever you close or switch away from the tab.';
}
let d0=null;

/* ---------- activation ---------- */
function licPaint(){
  if(!$('licStat'))return;
  $('licDev').value=LIC.devName||'';
  $('licStat').innerHTML='<span><span class="dot'+(locked?' warn':'')+'"></span>'+
    (LIC.hash?'Activated on '+esc(LIC.devName||'this device'):'No key set')+'</span>'+
    (LIC.hash?'<span>Checked against the licence server every 30 seconds</span>':'')+
    (fh?'<span>Holding '+esc(CFG.name)+'</span>':'')+(locked?'<span class="due">Locked by another device</span>':'');
  if(LIC.hash&&LICINFO&&LICINFO.label){
    const st=LICINFO.active===false?['Revoked','due']:(LICINFO.expiresAt&&Date.now()>+LICINFO.expiresAt?['Expired','due']:['Active','paid']);
    $('licDetails').style.display='';
    $('licDetails').innerHTML=fmtSum([
      ['Licensed to',esc(LICINFO.label)],
      ['Status',st[0],st[1]],
      ['Expires',LICINFO.expiresAt?dmy(new Date(+LICINFO.expiresAt).toISOString().slice(0,10)):'No expiry'],
      ['Last paid',LICINFO.lastPaidAt?dmy(new Date(+LICINFO.lastPaidAt).toISOString().slice(0,10)):'—'],
    ]);
  } else $('licDetails').style.display='none';
  if(LIC.hash&&LIC.key){
    $('licKeyRow').style.display='';
    $('licKeyMasked').textContent=$('licKeyMasked').dataset.shown==='1'?LIC.key:'•'.repeat(10);
  } else $('licKeyRow').style.display='none';
}
function showActivate(change){
  $('actTitle').textContent=change?'Change the software key':'Set the key for this software';
  $('actText').textContent=change
    ? 'Every device that opens this data file must use the new key. Change it on the others too, or they will be shut out.'
    : 'Enter the software key your administrator issued you. It is checked online, only one device may hold it at a time, and it stops working on its own if it is revoked or its expiry date passes.';
  $('actKey').value='';$('actDev').value=LIC.devName||'';
  $('actHint').textContent=change?'':'Ask your administrator if you do not have a key.';
  $('actWrap').style.display='flex';$('actKey').focus();
}
$('actGo').onclick=async()=>{
  const k=$('actKey').value.trim();
  if(k.length<4)return alert('Use a key of at least 4 characters.');
  if(!LIC.devId)LIC.devId=newDevId();
  const newHash=keyHash(k),oldHash=LIC.hash;
  const lc=await fbLicenseCheck(newHash);
  if(!lc.ok){$('actWrap').style.display='none';licenseKickOut(lc.why);return}
  const g=await fbGuard(newHash);
  if(!g.ok){$('actWrap').style.display='none';showLock(g);return}
  if(oldHash&&oldHash!==newHash)await fbSet('licenses/'+oldHash+'/claim',null);
  LIC.hash=newHash;
  LIC.key=k;
  LIC.devName=$('actDev').value.trim()||'This device';
  await saveLic();
  $('actWrap').style.display='none';
  fbClaim();fbStart();
  licPaint();fsPaint();
  if(!CFG.asked)firstRun(); else if(fh){dirty=true;fsWrite(true)}
};

/* ---------- request a key: anyone can create a licenseRequests entry (never read
   or edit existing ones) — the admin portal reviews these and issues a key by hand */
$('actReqLink').onclick=(e)=>{
  e.preventDefault();
  $('actWrap').style.display='none';
  $('reqName').value='';$('reqPhone').value='';$('reqEmail').value='';$('reqAddress').value='';$('reqNote').value='';$('reqHint').textContent='';
  $('reqSend').disabled=false;$('reqSend').textContent='Send request';
  $('reqWrap').style.display='flex';$('reqName').focus();
};
$('reqCancel').onclick=()=>{$('reqWrap').style.display='none';showActivate()};
$('reqSend').onclick=async()=>{
  const name=$('reqName').value.trim(),phone=$('reqPhone').value.trim(),email=$('reqEmail').value.trim(),address=$('reqAddress').value.trim();
  if(!name||!(phone||email))return alert('Name and at least a phone number or email are needed.');
  if(!LIC.devId)LIC.devId=newDevId();
  $('reqSend').disabled=true;$('reqSend').textContent='Sending...';
  const ok=await fbSet('licenseRequests/'+uid(),{
    name,phone,email,address,note:$('reqNote').value.trim(),
    devId:LIC.devId,devName:LIC.devName||$('actDev').value.trim()||'Unnamed device',
    requestedAt:Date.now(),status:'pending'});
  if(!ok){$('reqSend').disabled=false;$('reqSend').textContent='Send request';
    $('reqHint').innerHTML='<span class="due">Could not send the request. Check your connection and try again.</span>';return}
  $('reqWrap').style.display='none';
  alert('Request sent. You will hear back by email or phone once a key has been issued.');
  showActivate();
};

/* ---------- device lock ---------- */
let lockSource=null;
function showLock(g){
  locked=true;clearInterval(timer);timer=null;
  const key=g.why==='key';
  const license=g.source==='license';
  lockSource=license?'license':(key?'key':'file');
  const devName=(g.dev&&g.dev.name)?g.dev.name:'Another device';
  const lastActive=ago(Date.now()-(+((g.dev||{}).at)||0));
  $('lockTitle').textContent=key?'This data file belongs to another key'
    :license?'This key is already in use on another device'
    :'In use on another device';
  $('lockText').textContent=key
    ? 'The file '+(CFG.name||'you picked')+' was activated with a different software key. Enter that key to open it, or work without the file.'
    : license
    ? devName+' is currently signed in with this software key ('+lastActive+'). A licence covers one device at a time — moving it here signs that device out immediately. Need this key active on more than one device at once? Ask your administrator for a multi-device licence; pricing is different for that.'
    : devName+' has this file open and last saved '+lastActive+'. Saving is paused here so the two of you do not overwrite each other.';
  $('lockKeyRow').style.display=key?'':'none';
  $('lockTake').style.display=key?'none':'';
  $('lockTake').textContent=license?'Move licence to this device':'Use this device instead';
  $('lockDetach').style.display=license?'none':'';
  $('lockKey').value='';
  $('lockWrap').style.display='flex';
  licPaint();fsPaint();
}
function unlock(){locked=false;$('lockWrap').style.display='none';startTimer();fbStart();licPaint();fsPaint()}
$('lockRetry').onclick=async()=>{
  const fg=await fbGuard();
  if(!fg.ok){showLock(fg);return}
  const g=await fsGuard();
  if(g.ok){unlock();dirty=true;fsWrite(true)} else showLock(g);
};
$('lockTake').onclick=async()=>{
  const msg=lockSource==='license'
    ?'Move this licence to this device? The device currently signed in will be signed out immediately.'
    :'Take the file over on this device? Whichever device is holding it now will stop saving into it.';
  if(!confirm(msg))return;
  locked=false;$('lockWrap').style.display='none';
  const d=await fsRead();
  if(d&&d.lic&&d.lic.hash&&LIC.hash&&d.lic.hash!==LIC.hash){showLock({why:'key'});return}
  dirty=true;
  fbClaim();fbStart();
  if(await fsWriteForce())startTimer();
  licPaint();fsPaint();
};
async function fsWriteForce(){
  if(!(await fsPerm(true)))return false;
  try{const w=await fh.createWritable();await w.write(JSON.stringify(snapshot(),null,2));await w.close();
    dirty=false;lastSaved=new Date();fsMsg='';return true}catch(e){fsMsg='Could not write to the file: '+(e.message||e);return false}
}
$('lockDetach').onclick=()=>{fh=null;CFG.name='';locked=false;$('lockWrap').style.display='none';saveCfg();licPaint();fsPaint()};
$('lockUnlock').onclick=async()=>{
  const k=$('lockKey').value.trim();
  const d=await fsRead();
  if(!d||!d.lic||keyHash(k)!==d.lic.hash)return alert('That key does not match this file.');
  LIC.hash=keyHash(k);LIC.key=k;await saveLic();
  const g=await fsGuard();
  if(g.ok){unlock();dirty=true;fsWrite(true)} else showLock(g);
};
$('licChange').onclick=()=>showActivate(true);
$('licKeyShow').onclick=()=>{
  const shown=$('licKeyMasked').dataset.shown==='1';
  $('licKeyMasked').dataset.shown=shown?'0':'1';
  $('licKeyShow').textContent=shown?'Show':'Hide';
  licPaint();
};
$('licKeyCopy').onclick=async()=>{
  if(!LIC.key)return;
  try{await navigator.clipboard.writeText(LIC.key);$('licKeyCopy').textContent='Copied ✓';
    setTimeout(()=>{$('licKeyCopy').textContent='Copy key'},1500)}
  catch(e){alert('Could not copy automatically. Your key: '+LIC.key)}
};
$('licDevSave').onclick=async()=>{
  LIC.devName=$('licDev').value.trim()||'This device';await saveLic();licPaint();
  if(fh){dirty=true;fsWrite(true)}
};
$('licRelease').onclick=async()=>{
  if(!fh&&!LIC.hash)return alert('Nothing is linked yet, so there is nothing to release.');
  if(!confirm('Release this key/device claim so another device can take it? This device stops auto-saving'+(fh?' into '+CFG.name:'')+'.'))return;
  if(fh)await fsWrite(true,true);
  await fbRelease();
  clearInterval(timer);timer=null;clearInterval(fbTimer);fbTimer=null;CFG.on=false;await saveCfg();
  licPaint();fsPaint();
  alert('Released. Switch auto-save back on when you want this device to hold it again.');
};

function firstRun(){
  $('frText').textContent=canFS
    ? 'Pick a file on your computer and this app will keep saving into it by itself, every '+(CFG.min===1?'minute':CFG.min+' minutes')+' and whenever you close the tab. Put it inside a Google Drive or OneDrive folder and your data follows you to any device. You can change all of this later under Backup.'
    : 'This browser cannot write straight into a file you choose. Your data will be kept inside this browser, and you can download a backup any time from the Backup tab. For file auto-save, open this page in Chrome or Edge on a computer.';
  $('frPick').style.display=$('frOpen').style.display=canFS?'':'none';
  $('frHint').textContent=canFS?'Choosing a file also lets you carry your data between computers without exporting anything by hand.':'';
  $('firstRun').style.display='flex';
}
async function firstRunDone(){$('firstRun').style.display='none';CFG.asked=true;await saveCfg();fsPaint()}
$('frPick').onclick=async()=>{if(await fsPick())firstRunDone();};
$('frOpen').onclick=async()=>{if(await fsOpenExisting())firstRunDone();};
$('frSkip').onclick=()=>firstRunDone();
$('fsPick').onclick=()=>fsPick();
$('fsOpen').onclick=()=>fsOpenExisting();
$('fsStop').onclick=()=>fsStop();
async function saveNow(){
  const say=m=>{if($('fsBkHint'))$('fsBkHint').textContent=m};
  if(!fh){say('No data file is linked yet — use "Choose data file" in the Auto-save card above, then this writes straight into it.');return}
  if(!(await fsPerm(true))){fsMsg='needperm';fsPaint();say('Permission to write to '+CFG.name+' has lapsed — press Reconnect in the Auto-save card.');return}
  fsMsg='';
  const ok=await fsWrite(true);
  say(ok?'Saved all data to '+CFG.name+' at '+new Date().toTimeString().slice(0,8)+'.'
       :'Could not write to '+CFG.name+' — see the Auto-save card above.');
}
$('fsNow').onclick=saveNow;
$('fsBk').onclick=saveNow;
$('fsApply').onclick=async()=>{
  const n=+$('fsMin').value,u=+$('fsUnit').value||1;
  if(!n||n<1)return alert('Enter how often to save, as a whole number.');
  CFG.min=n*u;d0=null;await saveCfg();startTimer();fsPaint();
};
$('fsOn').onchange=async()=>{CFG.on=$('fsOn').checked;await saveCfg();startTimer();fsPaint()};
$('roundOff').onchange=async()=>{CFG.round=$('roundOff').checked;await saveCfg();render()};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&fh&&dirty)fsWrite()});
window.addEventListener('pagehide',()=>{if(fh&&dirty)fsWrite()});

async function load(){
  const c=await store.get('btscfg');if(c)try{Object.assign(CFG,JSON.parse(c))}catch(e){}
  applyTheme();
  const lc=await store.get('btslic');if(lc)try{Object.assign(LIC,JSON.parse(lc))}catch(e){}
  if(!LIC.devId){LIC.devId=newDevId();await saveLic()}
  const raw=await store.get('bts');
  if(raw)try{Object.assign(S,JSON.parse(raw))}catch(e){}
  ['parties','bills','deposits','doctors','rx','targets','items'].forEach(k=>{if(!Array.isArray(S[k]))S[k]=[]});
  stampTs();
  mem=!(await store.set('bts',JSON.stringify(S)));
  await fsRestore();
  render();
  licPaint();fsPaint();
  if(LIC.hash){
    const lc=await fbLicenseCheck();
    if(!lc.ok){licenseKickOut(lc.why);return}
    licPaint();
    const fg=await fbGuard();
    if(!fg.ok){showLock(fg);return}
  }
  const g=await fsGuard();
  if(!g.ok){showLock(g);return}
  fbStart();
  startTimer();
  if(!LIC.hash)showActivate();
  else if(!CFG.asked)firstRun();
}
async function save(){
  render();
  stampTs();
  dirty=true;
  if(!mem){if(!(await store.set('bts',JSON.stringify(S))))mem=true}
  fsPaint();
}

const party=id=>S.parties.find(p=>p.id===id)||{name:'\u2014',city:'\u2014'};
const inRange=(d,f,t)=>(!f||(d||'')>=f)&&(!t||(d||'')<=t);
const pRx=(pid,f,t)=>S.rx.filter(r=>r.partyId===pid&&inRange(r.date,f,t));
const pValue=(pid,f,t)=>pRx(pid,f,t).reduce((s,r)=>s+rxTot(r),0);
const pQty=(pid,f,t)=>pRx(pid,f,t).reduce((s,r)=>s+rxQty(r),0);
const pDocs=(pid,f,t)=>new Set(pRx(pid,f,t).map(r=>r.doctorId)).size;
/* ---------- bill items ---------- */
const itemsOf=b=>Array.isArray(b.items)?b.items:[];
const itemNames=b=>itemsOf(b).map(i=>i.name+(+i.qty?' \u00D7'+i.qty:'')).join(', ');
const itemQty=b=>itemsOf(b).reduce((s,i)=>s+ +i.qty,0);
const itemVal=b=>itemsOf(b).reduce((s,i)=>s+ +i.amount,0);
const billQty=b=>(b.qty!=null&&b.qty!=='')?+b.qty:itemQty(b);
/* older bills carried a text parcel field and a bilty number; pull the count out and drop the rest */
function fixBill(b){
  if(!Array.isArray(b.items))b.items=[];
  if(b.qty==null||b.qty===''){
    const n=typeof b.parcel==='string'?parseFloat(b.parcel.replace(/[^0-9.]/g,'')):+b.parcel;
    b.qty=isFinite(n)&&n?n:itemQty(b);
  }
  b.qty=+b.qty||0;
  delete b.biltyNo;delete b.parcel;
  return b;
}
function itemCatalog(){
  const set=new Set();
  S.items.forEach(i=>i.name&&set.add(i.name));
  S.bills.forEach(b=>itemsOf(b).forEach(i=>i.name&&set.add(i.name)));
  S.rx.forEach(r=>(r.lines||[]).forEach(l=>l.name&&set.add(l.name)));
  return [...set].sort((a,b)=>a.localeCompare(b));
}
const findItem=n=>S.items.find(i=>i.name.trim().toLowerCase()===String(n||'').trim().toLowerCase());
/* names typed straight into a bill or prescription join the collection by themselves */
function absorbItems(lines){
  let added=0;
  (lines||[]).forEach(l=>{
    const n=(l.name||'').trim();if(!n||findItem(n))return;
    S.items.push({id:uid(),name:n,pack:'',rate:+l.rate||0,note:''});added++;
  });
  return added;
}
const scriptedOf=(name,f,t)=>{let q=0,v=0,n=0;const docs=new Set(),meds=new Set();
  S.rx.forEach(r=>{if(!inRange(r.date,f,t))return;
    (r.lines||[]).forEach(l=>{if((l.name||'').trim().toLowerCase()!==name.trim().toLowerCase())return;
      q+=+l.qty;v+=+l.amount;n++;docs.add(r.doctorId);meds.add(r.partyId)})});
  return {q,v,n,docs:docs.size,meds:meds.size}};

const tab=t=>document.querySelector('.tabs button[data-t="'+t+'"]').click();
const cls=n=>n>0?'due':(n<0?'muted':'paid');

/* ---------- doctors / prescriptions / targets ---------- */
const doctor=id=>S.doctors.find(d=>d.id===id)||{name:'\u2014',city:'\u2014'};
const rxGross=r=>(r.lines||[]).reduce((s,l)=>s+ +l.amount,0);
/* entry value after the whole-entry discount %, then GST % */
const rxTot=r=>rxGross(r)*(1-(+r.disc||0)/100)*(1+(+r.gst||0)/100);
const rxQty=r=>(r.lines||[]).reduce((s,l)=>s+ +l.qty,0);
const rxOf=(did,f,t)=>S.rx.filter(r=>r.doctorId===did&&inRange(r.date,f,t));
const rxValue=(did,f,t)=>rxOf(did,f,t).reduce((s,r)=>s+rxTot(r),0);
const medicalsOf=(did,f,t)=>new Set(rxOf(did,f,t).map(r=>r.partyId)).size;
function shiftDay(s,n){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
function addSpan(s,n,unit){
  const d=new Date(s+'T00:00:00');
  if(unit==='days')d.setDate(d.getDate()+n);
  else if(unit==='years')d.setFullYear(d.getFullYear()+n);
  else{const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);
    d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()))}
  return d.toISOString().slice(0,10);
}
const unitTxt=(n,u)=>n+' '+(u==='days'?'day':u==='years'?'year':'month')+(n==1?'':'s');
/* builds every period of a target, applying carried-in rollover */
function periodsOf(t){
  const dur=Math.max(1,+t.dur||1),out=[];
  const lastRx=S.rx.filter(r=>r.doctorId===t.doctorId).map(r=>r.date).sort().pop()||'';
  const lim=[today(),lastRx].sort().pop();
  let s=t.start||today(),carry=0,i=0;
  while(i<240){
    const nx=addSpan(s,dur,t.unit),e=shiftDay(nx,-1);
    const base=+t.amount||0,ach=rxValue(t.doctorId,s,e),eff=base+carry,gap=eff-ach;
    const rolled=!!(t.auto||(t.rolls&&t.rolls[i]));
    out.push({i,s,e,base,carry,eff,ach,gap,rolled,cur:today()>=s&&today()<=e});
    carry=rolled?gap:0;
    s=nx;i++;
    if(s>lim)break;
  }
  return out;
}

/* ---------- generic table rendering ---------- */
function paint(elId,D,opt){
  opt=opt||{};
  const el=$(elId);
  const head='<thead><tr>'+D.headers.map((h,i)=>'<th class="'+(D.aligns[i]==='r'?'r ':'')+(h==='Edit'?'act-col':'')+'">'+esc(h)+'</th>').join('')+'</tr></thead>';
  const body=D.rows.length?D.rows.map((r,ri)=>{
    const attrs=(opt.clickId?' class="clk'+(D.rowCls&&D.rowCls[ri]?' '+D.rowCls[ri]:'')+'" data-p="'+D.ids[ri]+'"':(D.rowCls&&D.rowCls[ri]?' class="'+D.rowCls[ri]+'"':''));
    let tds=r.map(c=>'<td class="'+(c.a==='r'?'r ':'')+'num-maybe '+(c.c||'')+'">'+esc(c.t)+'</td>').join('');
    if(opt.act)tds+='<td class="r nowrap act-col"><button class="ico e" data-e'+opt.act+'="'+D.ids[ri]+'" title="Edit">\u270E</button><button class="ico d" data-d'+opt.act+'="'+D.ids[ri]+'" title="Delete">\u2715</button></td>';
    return '<tr'+attrs+'>'+tds+'</tr>';
  }).join(''):'<tr><td colspan="'+(D.headers.length+1)+'" class="empty">'+(opt.empty||'Nothing to show.')+'</td></tr>';
  const foot=D.foot&&D.rows.length?'<tfoot><tr>'+D.foot.map(c=>'<td class="'+(c.a==='r'?'r ':'')+(c.c||'')+'">'+esc(c.t)+'</td>').join('')+(opt.act?'<td class="act-col"></td>':'')+'</tr></tfoot>':'';
  el.innerHTML=head+'<tbody>'+body+'</tbody>'+foot;
  el.querySelectorAll('td.num-maybe').forEach(td=>{if(/[0-9]/.test(td.textContent))td.classList.add('num')});
}
function fmtSum(pairs){return pairs.map(p=>'<div><span>'+p[0]+'</span><b class="num '+(p[2]||'')+'">'+p[1]+'</b></div>').join('')}
function rangeTxt(f,t){return (f||t)?('Dates '+(f?dmy(f):'start')+' to '+(t?dmy(t):'today')):'All dates'}

/* ---------- view builders ---------- */
function ledgerRows(){
  const did=val('fDoc'),pid=val('fParty'),city=val('fCity'),item=val('fItem'),
    q=val('fQ').toLowerCase(),f=val('fFrom'),t=val('fTo');
  const out=[];
  S.rx.forEach(r=>{
    if(did&&r.doctorId!==did)return;
    if(pid&&r.partyId!==pid)return;
    if(!inRange(r.date,f,t))return;
    const p=party(r.partyId),d=doctor(r.doctorId);
    if(city&&p.city!==city)return;
    (r.lines||[]).forEach(l=>{
      if(item&&(l.name||'').trim().toLowerCase()!==item.trim().toLowerCase())return;
      if(q&&(d.name+' '+p.name+' '+(p.city||'')+' '+(l.name||'')+' '+(r.note||'')).toLowerCase().indexOf(q)<0)return;
      out.push({date:r.date,rxId:r.id,doctorId:r.doctorId,partyId:r.partyId,doc:d.name,med:p.name,city:p.city||'',
        note:r.note||'',name:l.name||'',qty:+l.qty||0,rate:+l.rate||0,amt:+l.amount||0});
    });
  });
  return out;
}
function ledgerData(){
  const g=val('fGroup'),srt=val('fSort'),f=val('fFrom'),t=val('fTo');
  const L=ledgerRows();
  const sub=rangeTxt(f,t)+(val('fDoc')?' \u00B7 '+doctor(val('fDoc')).name:'')+(val('fParty')?' \u00B7 '+party(val('fParty')).name:'')
    +(val('fCity')?' \u00B7 City '+val('fCity'):'')+(val('fItem')?' \u00B7 '+val('fItem'):'')+(val('fQ')?' \u00B7 Search "'+val('fQ')+'"':'');
  const tq=L.reduce((s,r)=>s+r.qty,0),tv=L.reduce((s,r)=>s+r.amt,0);
  const D={title:'Prescription ledger',sub,ids:[],rows:[]};
  const by=(key,label,extra)=>{
    const m={};
    L.forEach(r=>{const k=key(r);(m[k]=m[k]||{k,rows:[]}).rows.push(r)});
    let gs=Object.values(m).map(o=>({k:o.k,rows:o.rows,
      qty:o.rows.reduce((s,r)=>s+r.qty,0),val:o.rows.reduce((s,r)=>s+r.amt,0),
      entries:new Set(o.rows.map(r=>r.rxId)).size,
      docs:new Set(o.rows.map(r=>r.doctorId)).size,
      meds:new Set(o.rows.map(r=>r.partyId)).size,
      items:new Set(o.rows.map(r=>r.name)).size,
      last:o.rows.map(r=>r.date).sort().pop()}));
    gs.sort((a,b)=>srt==='name'?String(a.k).localeCompare(String(b.k)):srt==='qtyD'?b.qty-a.qty
      :srt==='dateA'?(a.last||'').localeCompare(b.last||''):srt==='dateD'?(b.last||'').localeCompare(a.last||''):b.val-a.val);
    D.headers=[label].concat(extra.headers);
    D.aligns=['l'].concat(extra.aligns);
    D.rows=gs.map(o=>[T(o.k)].concat(extra.cells(o)));
    D.ids=gs.map(()=>'');
    D.foot=[T('Total, '+gs.length+' '+extra.unit+(gs.length===1?'':'s'))].concat(extra.foot(gs));
  };
  if(g==='line'){
    L.sort((a,b)=>srt==='dateA'?(a.date||'').localeCompare(b.date||''):srt==='valD'?b.amt-a.amt
      :srt==='qtyD'?b.qty-a.qty:srt==='name'?a.name.localeCompare(b.name):(b.date||'').localeCompare(a.date||''));
    D.headers=['Date','Doctor','Medical','City','Item','Qty','Rate','Amount'];
    D.aligns=['l','l','l','l','l','r','r','r'];
    D.ids=L.map(r=>r.rxId);
    D.rows=L.map(r=>[T(dmy(r.date)),T(r.doc),T(r.med),T(r.city||'\u2014'),T(r.name),
      T(r.qty||'\u2014','','r'),T(r.rate?money(r.rate):'\u2014','','r'),T(money(r.amt),'','r')]);
    D.foot=[T('Total, '+L.length+' line'+(L.length===1?'':'s')),T(''),T(''),T(''),T(''),T(tq,'','r'),T(''),T(money(tv),'','r')];
  }
  else if(g==='doc')by(r=>r.doc,'Doctor',{headers:['Medicals','Entries','Items','Qty','Value','Last written'],
    aligns:['r','r','r','r','r','l'],unit:'doctor',
    cells:o=>[T(o.meds,'','r'),T(o.entries,'','r'),T(o.items,'','r'),T(o.qty,'','r'),T(money(o.val),'','r'),T(dmy(o.last))],
    foot:gs=>[T(''),T(gs.reduce((s,o)=>s+o.entries,0),'','r'),T(''),T(tq,'','r'),T(money(tv),'','r'),T('')]});
  else if(g==='party')by(r=>r.med,'Medical',{headers:['City','Doctors','Entries','Items','Qty','Value','Last written'],
    aligns:['l','r','r','r','r','r','l'],unit:'medical',
    cells:o=>[T(o.rows[0].city||'\u2014'),T(o.docs,'','r'),T(o.entries,'','r'),T(o.items,'','r'),T(o.qty,'','r'),T(money(o.val),'','r'),T(dmy(o.last))],
    foot:gs=>[T(''),T(''),T(gs.reduce((s,o)=>s+o.entries,0),'','r'),T(''),T(tq,'','r'),T(money(tv),'','r'),T('')]});
  else if(g==='item')by(r=>r.name,'Item',{headers:['Doctors','Medicals','Entries','Qty','Value','Last written'],
    aligns:['r','r','r','r','r','l'],unit:'item',
    cells:o=>[T(o.docs,'','r'),T(o.meds,'','r'),T(o.entries,'','r'),T(o.qty,'','r'),T(money(o.val),'','r'),T(dmy(o.last))],
    foot:gs=>[T(''),T(''),T(gs.reduce((s,o)=>s+o.entries,0),'','r'),T(tq,'','r'),T(money(tv),'','r'),T('')]});
  else by(r=>r.doc+' \u2192 '+r.med,'Doctor \u2192 Medical',{headers:['City','Entries','Items','Qty','Value','Last written'],
    aligns:['l','r','r','r','r','l'],unit:'pairing',
    cells:o=>[T(o.rows[0].city||'\u2014'),T(o.entries,'','r'),T(o.items,'','r'),T(o.qty,'','r'),T(money(o.val),'','r'),T(dmy(o.last))],
    foot:gs=>[T(''),T(gs.reduce((s,o)=>s+o.entries,0),'','r'),T(''),T(tq,'','r'),T(money(tv),'','r'),T('')]});
  D.sums=[['Medicine lines',L.length],['Entries',new Set(L.map(r=>r.rxId)).size],['Doctors',new Set(L.map(r=>r.doctorId)).size],
    ['Medicals',new Set(L.map(r=>r.partyId)).size],['Qty',tq],['Value prescribed',money(tv),'paid']];
  return D;
}
function partiesData(){
  const q=val('pfQ').toLowerCase(),city=val('pfCity'),srt=val('pfSort'),f=val('pfFrom'),t=val('pfTo');
  let rows=S.parties.filter(p=>(!city||p.city===city)&&(!q||(p.name+' '+p.city+' '+(p.phone||'')).toLowerCase().indexOf(q)>-1));
  rows.sort((a,b)=>srt==='name'?a.name.localeCompare(b.name):srt==='city'?(a.city+a.name).localeCompare(b.city+b.name)
    :srt==='rxD'?pRx(b.id,f,t).length-pRx(a.id,f,t).length:pValue(b.id,f,t)-pValue(a.id,f,t));
  const D={title:'Medical directory',sub:rangeTxt(f,t)+(city?' \u00B7 City '+city:'')+(q?' \u00B7 Search "'+val('pfQ')+'"':''),
    headers:['Name','City','Phone','Doctors','Entries','Qty','Value prescribed','Last entry'],
    aligns:['l','l','l','r','r','r','r','l'],ids:rows.map(p=>p.id),rowCls:rows.map(p=>editParty===p.id?'hl':''),
    rows:rows.map(p=>[T(p.name),T(p.city||'\u2014'),T(p.phone||'\u2014'),T(pDocs(p.id,f,t)||'\u2014','','r'),
      T(pRx(p.id,f,t).length||'\u2014','','r'),T(pQty(p.id,f,t)||'\u2014','','r'),T(money(pValue(p.id,f,t)),'','r'),
      T(dmy(pRx(p.id,f,t).map(r=>r.date).sort().pop()))])};
  const tc=rows.reduce((s,p)=>s+pRx(p.id,f,t).length,0),tq=rows.reduce((s,p)=>s+pQty(p.id,f,t),0),
    tv=rows.reduce((s,p)=>s+pValue(p.id,f,t),0);
  D.foot=[T('Total, '+rows.length+' medical'+(rows.length===1?'':'s')),T(''),T(''),T(''),T(tc,'','r'),T(tq,'','r'),T(money(tv),'','r'),T('')];
  D.sums=[['Medicals',rows.length],['Entries',tc],['Qty',tq],['Value prescribed',money(tv)]];
  return D;
}
function partyRxData(pid){
  const f=val('pfFrom'),t=val('pfTo');
  const rows=pRx(pid,f,t).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const D={title:'Medical statement \u2014 '+party(pid).name,sub:rangeTxt(f,t),
    headers:['Date','Doctor','Medicine','Qty','Rate','Amount'],aligns:['l','l','l','r','r','r'],ids:[],rows:[]};
  rows.forEach(r=>(r.lines||[]).forEach((l,li)=>{D.ids.push(r.id);
    D.rows.push([T(li?'':dmy(r.date)),T(li?'':doctor(r.doctorId).name),T(l.name),
      T(l.qty||'\u2014','','r'),T(+l.rate?money(l.rate):'\u2014','','r'),T(money(l.amount),'','r')])}));
  D.foot=[T('Total, '+rows.length+' entr'+(rows.length===1?'y':'ies')),T(''),T(''),T(pQty(pid,f,t),'','r'),T(''),T(money(pValue(pid,f,t)),'','r')];
  return D;
}
function itemsData(){
  const q=val('ifQ').toLowerCase(),srt=val('ifSort'),f=val('ifFrom'),t=val('ifTo');
  let rows=S.items.filter(i=>!q||(i.name+' '+(i.pack||'')+' '+(i.note||'')).toLowerCase().indexOf(q)>-1);
  const X={};
  rows.forEach(i=>{X[i.id]=scriptedOf(i.name,f,t)});
  rows.sort((a,b)=>srt==='name'?a.name.localeCompare(b.name):srt==='qtyD'?X[b.id].q-X[a.id].q
    :srt==='rxD'?X[b.id].n-X[a.id].n:X[b.id].v-X[a.id].v);
  const D={title:'Item collection',sub:rangeTxt(f,t)+(q?' \u00B7 Search "'+val('ifQ')+'"':''),
    headers:['Item','Pack / unit','Default rate','Company / note','Doctors','Medicals','Entries','Qty prescribed','Value prescribed'],
    aligns:['l','l','r','l','r','r','r','r','r'],ids:rows.map(i=>i.id),rowCls:rows.map(i=>editItem===i.id?'hl':''),
    rows:rows.map(i=>[T(i.name),T(i.pack||'\u2014'),T(+i.rate?money(i.rate):'\u2014','','r'),T(i.note||'\u2014'),
      T(X[i.id].docs||'\u2014','','r'),T(X[i.id].meds||'\u2014','','r'),T(X[i.id].n||'\u2014','','r'),
      T(X[i.id].q||'\u2014','','r'),T(money(X[i.id].v),'paid','r')])};
  const xq=rows.reduce((s,i)=>s+X[i.id].q,0),xv=rows.reduce((s,i)=>s+X[i.id].v,0),
    xn=rows.reduce((s,i)=>s+X[i.id].n,0);
  D.foot=[T('Total, '+rows.length+' item'+(rows.length===1?'':'s')),T(''),T(''),T(''),T(''),T(''),
    T(xn,'','r'),T(xq,'','r'),T(money(xv),'paid','r')];
  D.sums=[['Items',rows.length],['Lines prescribed',xn],['Qty',xq],['Value prescribed',money(xv),'paid']];
  return D;
}
function doctorsData(){
  const q=val('kfQ').toLowerCase(),city=val('kfCity'),srt=val('kfSort'),f=val('kfFrom'),t=val('kfTo');
  let rows=S.doctors.filter(d=>(!city||d.city===city)&&(!q||(d.name+' '+(d.speciality||'')+' '+(d.clinic||'')+' '+(d.city||'')+' '+(d.phone||'')).toLowerCase().indexOf(q)>-1));
  rows.sort((a,b)=>srt==='name'?a.name.localeCompare(b.name):srt==='city'?((a.city||'')+a.name).localeCompare((b.city||'')+b.name)
    :srt==='rxD'?rxOf(b.id,f,t).length-rxOf(a.id,f,t).length:rxValue(b.id,f,t)-rxValue(a.id,f,t));
  const D={title:'Doctor directory',sub:rangeTxt(f,t)+(city?' \u00B7 City '+city:'')+(q?' \u00B7 Search "'+val('kfQ')+'"':''),
    headers:['Doctor','Speciality','Clinic','City','Phone','Medicals','Entries','Value prescribed','Target status'],
    aligns:['l','l','l','l','l','r','r','r','l'],ids:rows.map(d=>d.id),rowCls:rows.map(d=>editDoc===d.id?'hl':''),
    rows:rows.map(d=>[T(d.name),T(d.speciality||'\u2014'),T(d.clinic||'\u2014'),T(d.city||'\u2014'),T(d.phone||'\u2014'),
      T(medicalsOf(d.id,f,t),'','r'),T(rxOf(d.id,f,t).length,'','r'),T(money(rxValue(d.id,f,t)),'','r'),T(statusOf(d.id))])};
  const tv=rows.reduce((s,d)=>s+rxValue(d.id,f,t),0),tc=rows.reduce((s,d)=>s+rxOf(d.id,f,t).length,0);
  D.foot=[T('Total, '+rows.length+' doctor'+(rows.length===1?'':'s')),T(''),T(''),T(''),T(''),T(''),T(tc,'','r'),T(money(tv),'','r'),T('')];
  D.sums=[['Doctors',rows.length],['Entries',tc],['Value prescribed',money(tv)]];
  return D;
}
function statusOf(did){
  const ts=S.targets.filter(t=>t.doctorId===did);
  if(!ts.length)return 'No target';
  const p=periodsOf(ts[0]).slice(-1)[0];
  if(!p)return 'No target';
  const pct=p.eff>0?Math.round(p.ach/p.eff*100):0;
  return (p.gap>0?'Short by '+money(p.gap):p.gap<0?'Ahead by '+money(-p.gap):'On target')+' \u00B7 P'+(p.i+1)+' \u00B7 '+pct+'%';
}
function rxData(){
  const q=val('rfQ').toLowerCase(),did=val('rfDoc'),pid=val('rfParty'),city=val('rfCity'),f=val('rfFrom'),t=val('rfTo'),srt=val('rfSort');
  let rows=S.rx.filter(r=>{const p=party(r.partyId),d=doctor(r.doctorId);
    return (!did||r.doctorId===did)&&(!pid||r.partyId===pid)&&(!city||p.city===city)&&inRange(r.date,f,t)
      &&(!q||(d.name+' '+p.name+' '+(p.city||'')+' '+(r.note||'')+' '+(r.lines||[]).map(l=>l.name).join(' ')).toLowerCase().indexOf(q)>-1)});
  rows.sort((a,b)=>srt==='dateA'?(a.date||'').localeCompare(b.date||''):srt==='amtD'?rxTot(b)-rxTot(a)
    :srt==='doc'?doctor(a.doctorId).name.localeCompare(doctor(b.doctorId).name)
    :srt==='party'?party(a.partyId).name.localeCompare(party(b.partyId).name):(b.date||'').localeCompare(a.date||''));
  const D={title:'Prescriptions',sub:rangeTxt(f,t)+(did?' \u00B7 '+doctor(did).name:'')+(city?' \u00B7 City '+city:'')+(q?' \u00B7 Search "'+val('rfQ')+'"':''),
    headers:['Date','Doctor','Medical','City','Medicines','Qty','Discount','Amount'],aligns:['l','l','l','l','l','r','r','r'],
    ids:rows.map(r=>r.id),rowCls:rows.map(r=>editRx===r.id?'hl':''),
    rows:rows.map(r=>[T(dmy(r.date)),T(doctor(r.doctorId).name),T(party(r.partyId).name),T(party(r.partyId).city||'\u2014'),
      T((r.lines||[]).map(l=>l.name+(+l.qty?' \u00D7'+l.qty:'')).join(', ')||'\u2014'),T(rxQty(r)||'\u2014','','r'),
      T(+r.disc?r.disc+'% \u00B7 '+money(rxGross(r)*r.disc/100):'\u2014',+r.disc?'due':'','r'),T(money(rxTot(r)),'','r')])};
  const tv=rows.reduce((s,r)=>s+rxTot(r),0),tq=rows.reduce((s,r)=>s+rxQty(r),0),
    td=rows.reduce((s,r)=>s+(+r.disc?rxGross(r)*r.disc/100:0),0);
  D.foot=[T('Total, '+rows.length+' entr'+(rows.length===1?'y':'ies')),T(''),T(''),T(''),T(''),T(tq,'','r'),T(td?money(td):'\u2014','','r'),T(money(tv),'','r')];
  D.sums=[['Entries',rows.length],['Medicine lines',rows.reduce((s,r)=>s+(r.lines||[]).length,0)],['Qty',tq],['Value',money(tv)]];
  D.raw=rows;
  return D;
}
function rxLinesData(){
  const src=V.rx&&V.rx.raw?V.rx.raw:[];
  const D={title:'Prescriptions, medicine wise',sub:V.rx?V.rx.sub:'',
    headers:['Date','Doctor','Medical','City','Medicine','Qty','Rate','Amount'],aligns:['l','l','l','l','l','r','r','r'],ids:[],rows:[]};
  src.forEach(r=>(r.lines||[]).forEach(l=>{D.ids.push(r.id);
    D.rows.push([T(dmy(r.date)),T(doctor(r.doctorId).name),T(party(r.partyId).name),T(party(r.partyId).city||'\u2014'),
      T(l.name),T(l.qty||'\u2014','','r'),T(+l.rate?money(l.rate):'\u2014','','r'),T(money(l.amount),'','r')])}));
  const tv=D.rows.reduce((s,r)=>s+ +String(r[7].t).replace(/[^0-9]/g,''),0);
  D.foot=[T('Total, '+D.rows.length+' line'+(D.rows.length===1?'':'s')),T(''),T(''),T(''),T(''),T(''),T(''),T(money(tv),'','r')];
  return D;
}
function targetsData(){
  const did=val('gfDoc'),show=val('gfShow');
  const list=S.targets.filter(t=>!did||t.doctorId===did)
    .sort((a,b)=>doctor(a.doctorId).name.localeCompare(doctor(b.doctorId).name)||(a.start||'').localeCompare(b.start||''));
  const D={title:'Target tracking',sub:(did?doctor(did).name:'All doctors')+' \u00B7 '+$('gfShow').selectedOptions[0].text,
    headers:['Doctor','Label','Period','From','To','Base target','Carried in','Effective target','Achieved','Short / surplus','Rolled'],
    aligns:['l','l','l','l','l','r','r','r','r','r','l'],ids:[],rows:[],cards:[]};
  list.forEach(t=>{
    let ps=periodsOf(t);
    if(show==='cur'){const c=ps.filter(p=>p.cur);ps=c.length?c:ps.slice(-1)}
    else if(show==='run'){const ci=ps.findIndex(p=>p.cur);ps=ci>-1?ps.slice(0,ci+1):ps}
    D.cards.push({t,ps,all:periodsOf(t).length});
    ps.forEach(p=>{D.ids.push(t.id);
      D.rows.push([T(doctor(t.doctorId).name),T(t.note||'\u2014'),T('P'+(p.i+1)),T(dmy(p.s)),T(dmy(p.e)),
        T(money(p.base),'','r'),T(p.carry?smoney(p.carry):'\u2014',p.carry>0?'due':p.carry<0?'paid':'','r'),
        T(money(p.eff),'','r'),T(money(p.ach),'paid','r'),
        T(gapTxt(p.gap),cls(p.gap),'r'),T(p.rolled?'Yes':'No')])});
  });
  D.sums=[['Targets',list.length],['Periods shown',D.rows.length]];
  return D;
}
function paintTargets(D){
  const el=$('tgList');
  if(!D.cards.length){el.innerHTML='<div class="empty">No targets set. Add one above.</div>';return}
  el.innerHTML=D.cards.map(c=>{
    const t=c.t,d=doctor(t.doctorId);
    const head='<div class="thead"><b>'+esc(d.name)+'</b>'+
      '<span class="meta">'+money(t.amount)+' every '+esc(unitTxt(t.dur,t.unit))+' \u00B7 from '+dmy(t.start)+
      ' \u00B7 '+c.all+' period'+(c.all===1?'':'s')+(t.note?' \u00B7 '+esc(t.note):'')+'</span>'+
      '<span class="pill">'+(t.auto?'Auto rollover on':'Auto rollover off')+'</span>'+
      '<span class="sp noprint">'+
        '<button class="ghost" data-tgauto="'+t.id+'">'+(t.auto?'Turn off auto rollover':'Roll over into next period, always')+'</button>'+
        '<button class="ico e" data-etg="'+t.id+'" title="Edit">\u270E</button>'+
        '<button class="ico d" data-dtg="'+t.id+'" title="Delete">\u2715</button>'+
      '</span></div>';
    const rows=c.ps.map(p=>'<tr'+(p.cur?' class="hl"':'')+'><td class="num">P'+(p.i+1)+(p.cur?' \u00B7 now':'')+'</td>'+
      '<td class="num">'+dmy(p.s)+'</td><td class="num">'+dmy(p.e)+'</td>'+
      '<td class="r num">'+money(p.base)+'</td>'+
      '<td class="r num '+(p.carry>0?'due':p.carry<0?'paid':'muted')+'">'+(p.carry?smoney(p.carry):'\u2014')+'</td>'+
      '<td class="r num"><b>'+money(p.eff)+'</b></td>'+
      '<td class="r num paid">'+money(p.ach)+'</td>'+
      '<td class="r num '+cls(p.gap)+'">'+gapTxt(p.gap)+'</td>'+
      '<td class="nowrap act-col noprint">'+(t.auto?'<span class="muted">auto</span>'
        :'<button class="ghost" data-roll="'+t.id+':'+p.i+'">'+(p.rolled?'Rolled \u2713 undo':'Roll into next')+'</button>')+'</td></tr>').join('')
      ||'<tr><td colspan="9" class="empty">No periods to show.</td></tr>';
    const done=c.ps.filter(p=>p.gap<=0).length;
    const tgt=c.ps.reduce((s,p)=>s+p.base,0),got=c.ps.reduce((s,p)=>s+p.ach,0);
    const pct=tgt>0?got/tgt*100:0,lvl=pct>=100?'full':pct>=50?'mid':'low';
    const prog=tgt>0?'<div class="tprog"><div class="tprog-track"><div class="tprog-fill '+lvl+'" style="width:'+
      Math.min(100,pct).toFixed(1)+'%"></div><span class="tprog-pct">'+Math.round(pct)+'%</span></div>'+
      '<div class="tprog-cap">of target achieved so far · '+money(got)+' against '+money(tgt)+
      (c.ps.length>1?' over '+c.ps.length+' periods':'')+'</div></div>':'';
    return '<div class="tcard">'+head+'<div class="scroll"><table><thead><tr><th>Period</th><th>From</th><th>To</th>'+
      '<th class="r">Base target</th><th class="r">Carried in</th><th class="r">Effective target</th><th class="r">Achieved</th>'+
      '<th class="r">Short / surplus</th><th class="act-col noprint">Rollover</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      prog+'<div class="bar2">'+done+' of '+c.ps.length+' period'+(c.ps.length===1?'':'s')+' met.</div></div>';
  }).join('');
}

function fillSelects(){
  $('itemCat').innerHTML=itemCatalog().map(x=>'<option value="'+esc(x)+'"></option>').join('');
  const sorted=S.parties.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const opts=sorted.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' \u2014 '+esc(p.city)+'</option>').join('');
  {const el=$('rParty'),v=el.value;el.innerHTML='<option value="">Select medical</option>'+opts;el.value=v;}
  const docs=S.doctors.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const dopts=docs.map(d=>'<option value="'+d.id+'">'+esc(d.name)+(d.city?' \u2014 '+esc(d.city):'')+'</option>').join('');
  ['rDoc','gDoc'].forEach(id=>{const el=$(id),v=el.value;el.innerHTML='<option value="">Select doctor</option>'+dopts;el.value=v;});
  ['rfDoc','gfDoc','fDoc'].forEach(id=>{const el=$(id),v=el.value;el.innerHTML=fPh(id,'All doctors')+dopts;
    el.value=docs.some(d=>d.id===v)?v:'';});
  ['rfParty','fParty'].forEach(id=>{const el=$(id),v=el.value;el.innerHTML=fPh(id,'All medicals')+
    sorted.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');el.value=sorted.some(p=>p.id===v)?v:'';});
  {const cat=itemCatalog(),el=$('fItem'),v=el.value;
    el.innerHTML=fPh('fItem','All items')+cat.map(x=>'<option>'+esc(x)+'</option>').join('');
    el.value=cat.indexOf(v)>-1?v:'';}
  {const dc=[...new Set(S.doctors.map(d=>d.city).filter(Boolean))].sort(),el=$('kfCity'),v=el.value;
    el.innerHTML='<option value="">All cities</option>'+dc.map(c=>'<option>'+esc(c)+'</option>').join('');
    el.value=dc.indexOf(v)>-1?v:'';}
  const cities=[...new Set(S.parties.map(p=>p.city).filter(Boolean))].sort();
  ['pfCity','rfCity','fCity'].forEach(id=>{const el=$(id),v=el.value;
    el.innerHTML=fPh(id,'All cities')+cities.map(c=>'<option>'+esc(c)+'</option>').join('');
    el.value=cities.indexOf(v)>-1?v:'';});
}
/* ledger filter dropdowns show "None selected"; the same selects elsewhere keep "All …" */
const LEDGER_F=new Set(['fDoc','fParty','fCity','fItem']);
const fPh=(id,all)=>'<option value="">'+(LEDGER_F.has(id)?'None selected':all)+'</option>';

function render(){
  fillSelects();
  V.ledger=ledgerData();paint('tLedger',V.ledger,{empty:'Nothing prescribed under these filters.'});
  $('totals').innerHTML=fmtSum(V.ledger.sums);
  $('fCount').textContent=V.ledger.rows.length+' row'+(V.ledger.rows.length===1?'':'s');
  V.parties=partiesData();paint('tAllParties',V.parties,{act:'p',clickId:1,empty:'No medicals match these filters.'});
  detail();
  $('pfCount').textContent=V.parties.rows.length+' of '+S.parties.length+' medicals';
  V.items=itemsData();paint('tItems',V.items,{act:'i',empty:'No items yet. Add one above, or just type names into a bill.'});
  $('ifCount').textContent=V.items.rows.length+' of '+S.items.length+' items';
  V.doctors=doctorsData();paint('tDocs',V.doctors,{act:'k',clickId:1,empty:'No doctors match these filters.'});
  $('kfCount').textContent=V.doctors.rows.length+' of '+S.doctors.length+' doctors';
  docDetail();
  V.rx=rxData();paint('tRx',V.rx,{act:'r',empty:'No prescriptions match these filters.'});
  $('rfCount').textContent=V.rx.rows.length+' of '+S.rx.length+' entries';
  V.rxlines=rxLinesData();
  V.targets=targetsData();paintTargets(V.targets);
  $('gfCount').textContent=V.targets.cards.length+' of '+S.targets.length+' targets';
  $('dataTot').innerHTML=fmtSum([['Medicals',S.parties.length],['Items',S.items.length],['Doctors',S.doctors.length],
    ['Prescriptions',S.rx.length],['Targets',S.targets.length],['Value prescribed',money(S.rx.reduce((s,r)=>s+rxTot(r),0))]]);
}

function docDetail(){
  const c=$('docDetail');
  if(!openDoc||!S.doctors.some(d=>d.id===openDoc)){c.style.display='none';return}
  c.style.display='';
  const d=doctor(openDoc),f=val('ddFrom'),t=val('ddTo');
  $('docDetailName').textContent=d.name+(d.speciality?' \u00B7 '+d.speciality:'')+(d.city?' \u00B7 '+d.city:'')+(d.phone?' \u00B7 '+d.phone:'');
  paint('tDocRx',docRxData(openDoc),{empty:'Nothing prescribed in this date range.'});
  $('docDetailTot').innerHTML=fmtSum([['Entries',rxOf(openDoc,f,t).length],['Medicals covered',medicalsOf(openDoc,f,t)],
    ['Value prescribed',money(rxValue(openDoc,f,t))],['Target',statusOf(openDoc)]]);
}
function docRxData(did){
  const f=val('ddFrom'),t=val('ddTo');
  const rows=rxOf(did,f,t).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const note=rows.some(r=>(r.note||'').trim());
  const D={title:'Doctor statement \u2014 '+doctor(did).name,sub:rangeTxt(f,t),
    headers:['Date','Medical','City','Medicine','Qty','Rate','Amount'].concat(note?['Note']:[]),
    aligns:['l','l','l','l','r','r','r'].concat(note?['l']:[]),ids:[],rows:[]};
  rows.forEach(r=>(r.lines||[]).forEach((l,li)=>{D.ids.push(r.id);
    D.rows.push([T(li?'':dmy(r.date)),T(li?'':party(r.partyId).name),T(li?'':(party(r.partyId).city||'\u2014')),
      T(l.name),T(l.qty||'\u2014','','r'),T(+l.rate?money(l.rate):'\u2014','','r'),T(money(l.amount),'','r')]
      .concat(note?[T(li?'':(r.note||''))]:[]))}));
  D.foot=[T('Total, '+rows.length+' entr'+(rows.length===1?'y':'ies')),T(''),T(''),T(''),T(''),T(''),T(money(rxValue(did,f,t)),'','r')]
    .concat(note?[T('')]:[]);
  return D;
}

function detail(){
  const c=$('detailCard');
  if(!openParty||!S.parties.some(p=>p.id===openParty)){c.style.display='none';return}
  c.style.display='';
  const p=party(openParty),f=val('pfFrom'),t=val('pfTo');
  $('detailName').textContent=p.name+' \u00B7 '+(p.city||'\u2014')+(p.phone?' \u00B7 '+p.phone:'');
  paint('tPartyRx',partyRxData(openParty),{empty:'Nothing prescribed to this medical in this date range.'});
  $('detailTot').innerHTML=fmtSum([['Entries',pRx(openParty,f,t).length],['Doctors',pDocs(openParty,f,t)],
    ['Qty',pQty(openParty,f,t)],['Value prescribed',money(pValue(openParty,f,t))],
    ['Last entry',dmy(pRx(openParty,f,t).map(r=>r.date).sort().pop())]]);
}

document.querySelectorAll('.tabs button[data-t]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs button[data-t]').forEach(x=>x.classList.toggle('on',x===b));
  ['ledger','parties','items','doctors','rx','targets','data'].forEach(t=>$('v-'+t).style.display=(t===b.dataset.t)?'':'none');
});

/* ---------- pocket calculator ---------- */
(function(){
  let expr='';
  const disp=$('calcDisplay'),panel=$('calcPanel'),toggle=$('calcToggle');
  const pretty=s=>s.replace(/\*/g,'×').replace(/\//g,'÷');
  const show=()=>disp.value=pretty(expr||'0');
  const evalExpr=s=>{
    if(!/^[-+*/.\d()\s]+$/.test(s))return null;
    try{const r=Function('"use strict";return('+s+')')();
      return typeof r==='number'&&isFinite(r)?String(Math.round(r*1e10)/1e10):null;}
    catch(e){return null}
  };
  const press=k=>{
    if(k==='clear')expr='';
    else if(k==='back')expr=expr.slice(0,-1);
    else if(k==='eq'){const r=evalExpr(expr);if(r==null){expr='';disp.value='Error';return}expr=r;}
    else if(k==='pct'){
      /* like a pocket calculator: 300-10% -> 300-(300*10/100) -> 270; a bare 10% -> 0.1 */
      const m=expr.match(/^(.*?)([-+*/])(\d*\.?\d+)$/);
      const ne=m?((m[2]==='+'||m[2]==='-')?m[1]+m[2]+'('+m[1]+')*'+m[3]+'/100':m[1]+m[2]+'('+m[3]+'/100)')
        :expr.replace(/(\d*\.?\d+)$/,'($1/100)');
      const r=evalExpr(ne);if(r!=null)expr=r;
    }
    else if('+-*/'.includes(k)){if(!expr&&k!=='-')return;expr=/[-+*/]$/.test(expr)?expr.slice(0,-1)+k:expr+k;}
    else if(k==='.'){const seg=expr.split(/[-+*/]/).pop();if(!seg.includes('.'))expr+=seg===''?'0.':'.';}
    else expr+=k;
    show();
  };
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-calc]');if(b)press(b.dataset.calc)});
  const open=v=>{panel.hidden=!v;toggle.classList.toggle('on',v);toggle.setAttribute('aria-expanded',v)};
  toggle.onclick=()=>open(panel.hidden);
  document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!toggle.contains(e.target))open(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)open(false)});
  show();
})();

/* ---------- filters ---------- */
const LF=['fDoc','fParty','fCity','fItem','fQ','fFrom','fTo','fGroup','fSort','pfQ','pfCity','pfFrom','pfTo','pfSort',
  'ifQ','ifFrom','ifTo','ifSort','kfQ','kfCity','kfFrom','kfTo','kfSort','ddFrom','ddTo','rfQ','rfDoc','rfParty','rfCity','rfFrom','rfTo','rfSort','gfDoc','gfShow'];
LF.forEach(id=>{const el=$(id);el.oninput=render;el.onchange=render});
function clearF(ids){ids.forEach(i=>{const el=$(i);el.value=el.tagName==='SELECT'?el.options[0].value:''});render()}
$('fClear').onclick=()=>clearF(['fDoc','fParty','fCity','fItem','fQ','fFrom','fTo']);
$('pfClear').onclick=()=>{openParty=null;clearF(['pfQ','pfCity','pfFrom','pfTo'])};
$('ifClear').onclick=()=>clearF(['ifQ','ifFrom','ifTo']);
$('kfClear').onclick=()=>{openDoc=null;clearF(['kfQ','kfCity','kfFrom','kfTo'])};
$('rfClear').onclick=()=>clearF(['rfQ','rfDoc','rfParty','rfCity','rfFrom','rfTo']);
$('gfClear').onclick=()=>clearF(['gfDoc','gfShow']);
$('tAllParties').onclick=e=>{if(e.target.closest('button'))return;const tr=e.target.closest('tr[data-p]');if(!tr)return;
  openParty=tr.dataset.p;detail();$('detailCard').scrollIntoView({behavior:'smooth',block:'start'})};
$('tDocs').onclick=e=>{if(e.target.closest('button'))return;const tr=e.target.closest('tr[data-p]');if(!tr)return;
  openDoc=tr.dataset.p;$('ddFrom').value=val('kfFrom');$('ddTo').value=val('kfTo');
  docDetail();$('docDetail').scrollIntoView({behavior:'smooth',block:'start'})};
$('ddClear').onclick=()=>{$('ddFrom').value=$('ddTo').value='';render()};

/* ---------- edit / delete ---------- */
function loadParty(id){
  const p=S.parties.find(x=>x.id===id);if(!p)return;
  editParty=id;$('pName').value=p.name;$('pCity').value=p.city;$('pArea').value=p.area||'';$('pPhone').value=p.phone||'';
  $('partyFormTitle').textContent='Editing '+p.name;$('pSave').textContent='Update medical';
  $('pCancel').style.display='';$('partyCard').classList.add('editing');
  tab('parties');$('partyCard').scrollIntoView({behavior:'smooth',block:'start'});render();
}
function clearParty(){
  editParty=null;$('pName').value=$('pCity').value=$('pArea').value=$('pPhone').value='';
  $('partyFormTitle').textContent='New medical (one time setup)';$('pSave').textContent='Save medical';
  $('pCancel').style.display='none';$('partyCard').classList.remove('editing');
}
function removeParty(id){
  const p=S.parties.find(x=>x.id===id);if(!p)return;
  const nr=S.rx.filter(r=>r.partyId===id).length;
  if(!confirm('Delete '+p.name+' ('+p.city+') along with '+nr+' prescription entr'+(nr===1?'y':'ies')+'?\nThis cannot be undone.'))return;
  S.rx=S.rx.filter(r=>r.partyId!==id);
  S.parties=S.parties.filter(x=>x.id!==id);
  if(openParty===id)openParty=null;
  if(editParty===id)clearParty();
  if(editRx&&!S.rx.some(r=>r.id===editRx))clearRx();
  save();
}
function loadItem(id){
  const i=S.items.find(x=>x.id===id);if(!i)return;
  editItem=id;$('iName').value=i.name;$('iPack').value=i.pack||'';$('iRate').value=i.rate||'';$('iNote').value=i.note||'';
  $('itemFormTitle').textContent='Editing '+i.name;$('iSave').textContent='Update item';
  $('iCancel').style.display='';$('itemCard').classList.add('editing');
  tab('items');$('itemCard').scrollIntoView({behavior:'smooth',block:'start'});render();
}
function clearItem(){
  editItem=null;['iName','iPack','iRate','iNote'].forEach(x=>$(x).value='');
  $('itemFormTitle').textContent='New item';$('iSave').textContent='Save item';
  $('iCancel').style.display='none';$('itemCard').classList.remove('editing');
}
function removeItem(id){
  const i=S.items.find(x=>x.id===id);if(!i)return;
  const x=scriptedOf(i.name,'','');
  if(!confirm('Take '+i.name+' out of the item collection?'+
    (x.n?'\nIt appears on '+x.n+' prescription row(s) \u2014 those stay exactly as they are.':'')))return;
  S.items=S.items.filter(v=>v.id!==id);
  if(editItem===id)clearItem();
  save();
}
function loadDoc(id){
  const d=S.doctors.find(x=>x.id===id);if(!d)return;
  editDoc=id;$('kName').value=d.name;$('kSpec').value=d.speciality||'';$('kClinic').value=d.clinic||'';
  $('kCity').value=d.city||'';$('kPhone').value=d.phone||'';
  $('docFormTitle').textContent='Editing '+d.name;$('kSave').textContent='Update doctor';
  $('kCancel').style.display='';$('docCard').classList.add('editing');
  tab('doctors');$('docCard').scrollIntoView({behavior:'smooth',block:'start'});render();
}
function clearDoc(){
  editDoc=null;['kName','kSpec','kClinic','kCity','kPhone'].forEach(i=>$(i).value='');
  $('docFormTitle').textContent='New doctor';$('kSave').textContent='Save doctor';
  $('kCancel').style.display='none';$('docCard').classList.remove('editing');
}
function removeDoc(id){
  const d=S.doctors.find(x=>x.id===id);if(!d)return;
  const nr=S.rx.filter(r=>r.doctorId===id).length,nt=S.targets.filter(t=>t.doctorId===id).length;
  if(!confirm('Delete '+d.name+' along with '+nr+' prescription entr'+(nr===1?'y':'ies')+' and '+nt+' target'+(nt===1?'':'s')+'?\nThis cannot be undone.'))return;
  S.rx=S.rx.filter(r=>r.doctorId!==id);S.targets=S.targets.filter(t=>t.doctorId!==id);
  S.doctors=S.doctors.filter(x=>x.id!==id);
  if(openDoc===id)openDoc=null;
  if(editDoc===id)clearDoc();
  if(editRx&&!S.rx.some(r=>r.id===editRx))clearRx();
  if(editTg&&!S.targets.some(t=>t.id===editTg))clearTg();
  save();
}
/* --- medicine lines --- */
function addLine(l){
  l=l||{};
  const d=document.createElement('div');d.className='line';
  d.innerHTML='<div class="f" style="flex:1;min-width:200px"><label>Medicine</label><input data-k="name" list="itemCat" placeholder="pick from the list or type a new one"></div>'+
    '<div class="f"><label>Qty</label><input data-k="qty" class="num" inputmode="decimal" style="min-width:80px"></div>'+
    '<div class="f"><label>Rate &#8377; / unit</label><input data-k="rate" class="num" inputmode="decimal" style="min-width:100px"></div>'+
    '<div class="f"><label>Amount &#8377;</label><input data-k="amount" class="num" inputmode="decimal" style="min-width:110px"></div>'+
    '<button class="ico d" data-rmline="1" title="Remove medicine">\u2715</button>';
  ['name','qty','rate','amount'].forEach(k=>{const v=l[k];if(v!==undefined&&v!==0&&v!=='')d.querySelector('[data-k="'+k+'"]').value=v});
  $('rxLines').appendChild(d);
  return d;
}
function round2(n){return Math.round((+n||0)*100)/100}
function readLines(){
  return [...$('rxLines').querySelectorAll('.line')].map(d=>{
    const g=k=>d.querySelector('[data-k="'+k+'"]').value.trim();
    return {name:g('name'),qty:+g('qty')||0,rate:+g('rate')||0,amount:+g('amount')||0};
  }).filter(l=>l.name||l.amount);
}
function lineTot(){
  const sub=readLines().reduce((s,l)=>s+ +l.amount,0);
  const disc=Math.max(0,+val('rDisc')||0),gst=Math.max(0,+val('rGst')||0);
  const dAmt=sub*disc/100,taxable=sub-dAmt,gAmt=taxable*gst/100;
  $('rxSub').textContent=money(sub);
  $('rxDiscAmt').textContent='\u2212'+money(dAmt);$('rxDiscWrap').hidden=!disc;
  $('rxGstAmt').textContent='+'+money(gAmt);$('rxGstWrap').hidden=!gst;
  $('rxLineTot').textContent=money(taxable+gAmt);
}
$('rxLines').addEventListener('input',e=>{
  const k=e.target.dataset.k;if(!k)return;
  const row=e.target.closest('.line'),g=n=>row.querySelector('[data-k="'+n+'"]');
  if(k==='name'){
    const hit=findItem(e.target.value);
    if(hit&&+hit.rate&&!g('rate').value)g('rate').value=hit.rate;
  }
  const q=+g('qty').value||0,r=+g('rate').value||0;
  /* amount edited -> rate = amount / qty; anything else -> amount = qty x rate */
  if(k==='amount'){
    if(q&&g('amount').value.trim()!=='')g('rate').value=round2((+g('amount').value||0)/q);
  }else if(q&&r){
    g('amount').value=round2(q*r);
  }
  lineTot();
});
$('rxLines').addEventListener('click',e=>{
  if(!e.target.dataset.rmline)return;
  const rows=$('rxLines').querySelectorAll('.line');
  if(rows.length<=1){e.target.closest('.line').querySelectorAll('input').forEach(i=>i.value='')}
  else e.target.closest('.line').remove();
  lineTot();
});
$('rxAdd').onclick=()=>{addLine().querySelector('input').focus()};
function loadRx(id){
  const r=S.rx.find(x=>x.id===id);if(!r)return;
  editRx=id;$('rDoc').value=r.doctorId;$('rParty').value=r.partyId;$('rDate').value=r.date||today();$('rNote').value=r.note||'';
  $('rDisc').value=r.disc||'';$('rGst').value=r.gst||'';
  $('rxLines').innerHTML='';(r.lines&&r.lines.length?r.lines:[{}]).forEach(addLine);lineTot();
  $('rxFormTitle').textContent='Editing entry of '+dmy(r.date)+' \u00B7 '+doctor(r.doctorId).name;
  $('rSave').textContent='Update prescription';$('rCancel').style.display='';$('rxCard').classList.add('editing');
  tab('rx');$('rxCard').scrollIntoView({behavior:'smooth',block:'start'});render();
}
function clearRx(){
  editRx=null;$('rNote').value='';$('rDisc').value='';$('rGst').value='';$('rxLines').innerHTML='';addLine();lineTot();
  $('rxFormTitle').textContent='New prescription entry';$('rSave').textContent='Save prescription';
  $('rCancel').style.display='none';$('rxCard').classList.remove('editing');
}
function loadTg(id){
  const t=S.targets.find(x=>x.id===id);if(!t)return;
  editTg=id;$('gDoc').value=t.doctorId;$('gAmt').value=t.amount;$('gDur').value=t.dur;$('gUnit').value=t.unit;
  $('gStart').value=t.start;$('gNote').value=t.note||'';$('gAuto').checked=!!t.auto;
  $('tgFormTitle').textContent='Editing target for '+doctor(t.doctorId).name;$('gSave').textContent='Update target';
  $('gCancel').style.display='';$('tgCard').classList.add('editing');
  tab('targets');$('tgCard').scrollIntoView({behavior:'smooth',block:'start'});render();
}
function clearTg(){
  editTg=null;$('gAmt').value='';$('gDur').value='1';$('gUnit').value='months';$('gNote').value='';$('gAuto').checked=false;
  $('tgFormTitle').textContent='New target';$('gSave').textContent='Save target';
  $('gCancel').style.display='none';$('tgCard').classList.remove('editing');
}
$('iCancel').onclick=()=>{clearItem();render()};
$('kCancel').onclick=()=>{clearDoc();render()};
$('rCancel').onclick=()=>{clearRx();render()};
$('gCancel').onclick=()=>{clearTg();render()};
$('pCancel').onclick=()=>{clearParty();render()};
$('delPartyAll').onclick=()=>{if(openParty)removeParty(openParty)};

document.body.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const d=b.dataset;
  if(d.ep)loadParty(d.ep);
  if(d.dp)removeParty(d.dp);
  if(d.ei)loadItem(d.ei);
  if(d.di)removeItem(d.di);
  if(d.ek)loadDoc(d.ek);
  if(d.dk)removeDoc(d.dk);
  if(d.er)loadRx(d.er);
  if(d.dr){const x=S.rx.find(v=>v.id===d.dr);
    if(confirm('Delete the entry of '+dmy(x?x.date:'')+' for '+(x?doctor(x.doctorId).name:'')+' \u2014 '+money(x?rxTot(x):0)+'?')){
      S.rx=S.rx.filter(v=>v.id!==d.dr);if(editRx===d.dr)clearRx();save();}}
  if(d.etg)loadTg(d.etg);
  if(d.dtg){const x=S.targets.find(v=>v.id===d.dtg);
    if(confirm('Delete the '+money(x?x.amount:0)+' target for '+(x?doctor(x.doctorId).name:'')+'?')){
      S.targets=S.targets.filter(v=>v.id!==d.dtg);if(editTg===d.dtg)clearTg();save();}}
  if(d.tgauto){const t=S.targets.find(v=>v.id===d.tgauto);if(t){t.auto=!t.auto;save()}}
  if(d.roll){const [tid,pi]=d.roll.split(':'),t=S.targets.find(v=>v.id===tid);
    if(t){t.rolls=t.rolls||{};if(t.rolls[pi])delete t.rolls[pi];else t.rolls[pi]=1;save()}}
  if(d.x)exportIt(d.x,e.target.closest('.card'));
});

/* ---------- forms ---------- */

$('pSave').onclick=()=>{
  const name=val('pName'),city=val('pCity'),area=val('pArea'),phone=val('pPhone');
  if(!name||!city)return alert('Medical name and city are both needed.');
  if(S.parties.some(p=>p.id!==editParty&&p.name.toLowerCase()===name.toLowerCase()&&p.city.toLowerCase()===city.toLowerCase()))
    return alert('That medical already exists in this city.');
  if(editParty){const p=S.parties.find(x=>x.id===editParty);p.name=name;p.city=city;p.area=area;p.phone=phone;}
  else S.parties.push({id:uid(),name,city,area,phone});
  clearParty();save();
};
['rDisc','rGst'].forEach(id=>$(id).addEventListener('input',lineTot));
$('rDate').value=today(); $('gStart').value=today(); addLine(); lineTot();

$('iSave').onclick=()=>{
  const name=val('iName');
  if(!name)return alert('Item name is needed.');
  const dup=S.items.find(i=>i.id!==editItem&&i.name.trim().toLowerCase()===name.toLowerCase());
  if(dup)return alert(name+' is already in the collection.');
  const rec={name,pack:val('iPack'),rate:+$('iRate').value||0,note:val('iNote')};
  if(editItem)Object.assign(S.items.find(x=>x.id===editItem),rec);
  else S.items.push(Object.assign({id:uid()},rec));
  clearItem();save();
};
$('kSave').onclick=()=>{
  const name=val('kName');
  if(!name)return alert('Doctor name is needed.');
  if(S.doctors.some(d=>d.id!==editDoc&&d.name.toLowerCase()===name.toLowerCase()&&(d.city||'').toLowerCase()===val('kCity').toLowerCase()))
    return alert('That doctor already exists in this city.');
  const rec={name,speciality:val('kSpec'),clinic:val('kClinic'),city:val('kCity'),phone:val('kPhone')};
  if(editDoc)Object.assign(S.doctors.find(x=>x.id===editDoc),rec);
  else S.doctors.push(Object.assign({id:uid()},rec));
  clearDoc();save();
};
$('rSave').onclick=()=>{
  const doctorId=val('rDoc'),partyId=val('rParty'),lines=readLines();
  if(!doctorId)return alert('Pick a doctor.');
  if(!partyId)return alert('Pick the medical this went to.');
  if(!lines.length)return alert('Add at least one medicine.');
  const bad=lines.find(l=>!l.name);
  if(bad)return alert('Every medicine line needs a name.');
  absorbItems(lines);
  const rec={doctorId,partyId,date:$('rDate').value||today(),note:val('rNote'),
    disc:Math.max(0,+val('rDisc')||0),gst:Math.max(0,+val('rGst')||0),lines};
  if(editRx)Object.assign(S.rx.find(x=>x.id===editRx),rec);
  else S.rx.push(Object.assign({id:uid()},rec));
  clearRx();save();
};
$('gSave').onclick=()=>{
  const doctorId=val('gDoc'),amount=+$('gAmt').value,dur=+$('gDur').value,unit=val('gUnit'),start=$('gStart').value;
  if(!doctorId)return alert('Pick a doctor.');
  if(!amount||amount<=0)return alert('Enter the target amount in rupees.');
  if(!dur||dur<=0)return alert('Enter how long one period runs.');
  if(!start)return alert('Pick the start date. You decide when the target begins.');
  const rec={doctorId,amount,dur,unit,start,note:val('gNote'),auto:$('gAuto').checked};
  if(editTg){const t=S.targets.find(x=>x.id===editTg);const keep=t.rolls;Object.assign(t,rec);t.rolls=keep||{};}
  else S.targets.push(Object.assign({id:uid(),rolls:{}},rec));
  clearTg();save();tab('targets');
};

/* ---------- Enter moves to the next field ---------- */
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.shiftKey)return;
  const el=e.target;
  if(!el.matches('input:not([type=file]),select'))return;
  const card=el.closest('.card');if(!card)return;
  e.preventDefault();
  const fields=[...card.querySelectorAll('input:not([type=file]),select')].filter(x=>!x.disabled&&x.offsetParent!==null);
  const next=fields[fields.indexOf(el)+1];
  if(next){next.focus();if(next.select)try{next.select()}catch(err){}return}
  const btn=card.querySelector('button.act');
  if(btn){btn.click();(fields.find(x=>x.tagName==='SELECT')||fields[0]).focus()}
  else el.blur();
});

/* ---------- exports: PDF / PNG / CSV ---------- */
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())}
function dl(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click()}
function csvOf(D){
  const clean=t=>String(t).replace(/\u20B9/g,'').replace(/(\d),(?=\d)/g,'$1').replace(/\u2014/g,'');
  const q=t=>'"'+clean(t).replace(/"/g,'""')+'"';
  const lines=[D.headers.map(q).join(','),...D.rows.map(r=>r.map(c=>q(c.t)).join(','))];
  if(D.foot)lines.push(D.foot.map(c=>q(c.t)).join(','));
  return '\ufeff'+lines.join('\r\n');
}
function pngOf(title,sub,blocks){
  const dpr=2,pad=30,cp=12,rowH=26,headH=30,capH=28,gap=24;
  const c=document.createElement('canvas'),x=c.getContext('2d');
  const fH='bold 12px system-ui,sans-serif',fC='13px ui-monospace,monospace',fF='bold 13px ui-monospace,monospace',
    fT='bold 21px system-ui,sans-serif',fS='12px system-ui,sans-serif',fCap='bold 12px system-ui,sans-serif';
  blocks.forEach(b=>{
    b.w=b.headers.map((h,i)=>{x.font=fH;let w=x.measureText(String(h).toUpperCase()).width;
      x.font=fC;b.rows.forEach(r=>{const cell=r[i];w=Math.max(w,x.measureText(cell?cell.t:'').width)});
      if(b.foot){x.font=fF;w=Math.max(w,x.measureText(b.foot[i]?b.foot[i].t:'').width)}
      return Math.ceil(w)+cp*2});
    b.tw=b.w.reduce((a,v)=>a+v,0);
  });
  const footLine='Bill Tracking System · generated '+dmy(today())+' '+new Date().toTimeString().slice(0,5);
  /* wrap the title and sub-line so a long name never runs past the canvas edge */
  const blockW=Math.max(0,...blocks.map(b=>b.tw));
  const wrapW=Math.min(1100,Math.max(blockW,520));
  const wrap=(t,font)=>{
    x.font=font;const lines=[];let ln='';
    String(t==null?'':t).split(/\s+/).filter(Boolean).forEach(w=>{
      const test=ln?ln+' '+w:w;
      if(!ln||x.measureText(test).width<=wrapW){ln=test}
      else{lines.push(ln);ln=w}
      while(ln.length>1&&x.measureText(ln).width>wrapW){
        let k=ln.length;while(k>1&&x.measureText(ln.slice(0,k)).width>wrapW)k--;
        lines.push(ln.slice(0,k));ln=ln.slice(k);
      }
    });
    if(ln)lines.push(ln);
    return lines.length?lines:[''];
  };
  const tLines=wrap(title,fT),sLines=wrap(sub,fS);
  x.font=fT;let textW=Math.max(...tLines.map(l=>x.measureText(l).width));
  x.font=fS;textW=Math.max(textW,x.measureText(footLine).width,...sLines.map(l=>x.measureText(l).width));
  x.font=fCap;blocks.forEach(b=>{if(b.caption)textW=Math.max(textW,x.measureText(b.caption.toUpperCase()).width)});
  const width=Math.ceil(Math.max(460,textW,blockW))+pad*2;
  const tLH=27,sLH=18,headBlock=tLines.length*tLH+6+sLines.length*sLH+14;
  let height=pad+headBlock;
  blocks.forEach(b=>{height+=(b.caption?capH:0)+headH+Math.max(1,b.rows.length)*rowH+(b.foot?rowH+6:0)+gap});
  height+=pad-gap+22;
  c.width=width*dpr;c.height=height*dpr;x.scale(dpr,dpr);
  x.fillStyle='#fff';x.fillRect(0,0,width,height);
  let y=pad;
  x.fillStyle='#152420';x.font=fT;x.textBaseline='alphabetic';x.textAlign='left';
  tLines.forEach(l=>{x.fillText(l,pad,y+18);y+=tLH});
  y+=6;
  x.font=fS;x.fillStyle='#3d4f49';
  sLines.forEach(l=>{x.fillText(l,pad,y+12);y+=sLH});
  y+=14;
  const colors={due:'#a83a24',paid:'#2f7a3f',muted:'#3d4f49','':'#152420'};
  blocks.forEach(b=>{
    x.textAlign='left';
    if(b.caption){x.font=fCap;x.fillStyle='#3d4f49';x.fillText(b.caption.toUpperCase(),pad,y+14);y+=capH}
    const cx=[];let acc=pad;b.w.forEach(w=>{cx.push(acc);acc+=w});
    x.font=fH;x.fillStyle='#3d4f49';
    b.headers.forEach((h,i)=>{const r=b.aligns[i]==='r';
      x.textAlign=r?'right':'left';x.fillText(h.toUpperCase(),r?cx[i]+b.w[i]-cp:cx[i]+cp,y+18)});
    y+=headH;x.strokeStyle='#152420';x.lineWidth=1;
    x.beginPath();x.moveTo(pad,y-6);x.lineTo(pad+b.tw,y-6);x.stroke();
    if(!b.rows.length){x.font=fC;x.fillStyle='#3d4f49';x.textAlign='left';x.fillText('Nothing to show.',pad+cp,y+17);y+=rowH}
    b.rows.forEach((r,ri)=>{
      if(ri%2){x.fillStyle='#f5f7f5';x.fillRect(pad,y,b.tw,rowH)}
      x.font=fC;
      r.forEach((cell,i)=>{const rr=b.aligns[i]==='r';x.textAlign=rr?'right':'left';
        x.fillStyle=colors[cell.c]||'#152420';x.fillText(cell.t,rr?cx[i]+b.w[i]-cp:cx[i]+cp,y+17)});
      x.strokeStyle='#e4e8e4';x.beginPath();x.moveTo(pad,y+rowH);x.lineTo(pad+b.tw,y+rowH);x.stroke();
      y+=rowH;
    });
    if(b.foot){
      x.strokeStyle='#152420';x.lineWidth=1.5;x.beginPath();x.moveTo(pad,y+2);x.lineTo(pad+b.tw,y+2);x.stroke();
      y+=6;x.font=fF;
      b.foot.forEach((cell,i)=>{const rr=b.aligns[i]==='r';x.textAlign=rr?'right':'left';
        x.fillStyle=colors[cell.c]||'#152420';x.fillText(cell.t,rr?cx[i]+b.w[i]-cp:cx[i]+cp,y+17)});
      y+=rowH;
    }
    y+=gap;
  });
  x.textAlign='left';x.font=fS;x.fillStyle='#7b8a85';
  x.fillText(footLine,pad,height-pad+10);
  return c;
}
let printJob=0;
function printOut(title,sub,card){
  const job=++printJob;
  document.querySelectorAll('.print-me').forEach(c=>c.classList.remove('print-me'));
  $('phTitle').textContent=title;$('phSub').textContent=sub;
  if(card){card.classList.add('print-me');document.body.classList.add('printing')}
  setTimeout(()=>{
    if(job!==printJob)return;
    window.print();
    setTimeout(()=>{
      if(job!==printJob)return;
      document.body.classList.remove('printing');
      document.querySelectorAll('.print-me').forEach(c=>c.classList.remove('print-me'));
    },400);
  },60);
}
function partyBlocks(){
  const p=party(openParty),f=val('pfFrom'),t=val('pfTo');
  const D=partyRxData(openParty);
  return {name:p.name,city:p.city,phone:p.phone,blocks:[
    {caption:'Prescribed to this medical',headers:D.headers,aligns:D.aligns,rows:D.rows,foot:D.foot},
    {caption:'Summary',headers:['Entries','Doctors','Qty','Value prescribed'],aligns:['r','r','r','r'],
      rows:[[T(pRx(openParty,f,t).length,'','r'),T(pDocs(openParty,f,t),'','r'),
        T(pQty(openParty,f,t),'','r'),T(money(pValue(openParty,f,t)),'','r')]]}
  ]};
}
function doctorBlocks(){
  const d=doctor(openDoc),f=val('kfFrom'),t=val('kfTo');
  const D=docRxData(openDoc);
  const tg=S.targets.filter(x=>x.doctorId===openDoc);
  const blocks=[{caption:'Medicines prescribed',headers:D.headers,aligns:D.aligns,rows:D.rows,foot:D.foot}];
  if(tg.length){
    const rows=[];
    tg.forEach(x=>periodsOf(x).forEach(p=>rows.push([T('P'+(p.i+1)),T(dmy(p.s)),T(dmy(p.e)),T(money(p.eff),'','r'),
      T(money(p.ach),'paid','r'),T(gapTxt(p.gap),cls(p.gap),'r'),T(p.rolled?'Yes':'No')])));
    blocks.push({caption:'Targets',headers:['Period','From','To','Effective target','Achieved','Short / surplus','Rolled'],
      aligns:['l','l','l','r','r','r','l'],rows});
  }
  blocks.push({caption:'Summary',headers:['Entries','Medicals covered','Value prescribed'],aligns:['r','r','r'],
    rows:[[T(rxOf(openDoc,f,t).length,'','r'),T(medicalsOf(openDoc,f,t),'','r'),T(money(rxValue(openDoc,f,t)),'','r')]]});
  return {name:d.name,city:d.city||'',phone:d.phone||'',blocks};
}
function exportIt(what,card){
  const [which,fmt]=what.split('-');
  if(which==='doctor'){
    if(!openDoc)return;
    const P=doctorBlocks(),title=P.name+(P.city?' \u00B7 '+P.city:''),sub=rangeTxt(val('kfFrom'),val('kfTo'))+(P.phone?' \u00B7 '+P.phone:'');
    if(fmt==='pdf')return printOut('Doctor statement \u2014 '+title,sub,card);
    const c=pngOf('Doctor statement \u2014 '+title,sub,P.blocks);
    return dl(c.toDataURL('image/png'),'bts-doctor-'+P.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+stamp()+'.png');
  }
  if(which==='party'){
    if(!openParty)return;
    const P=partyBlocks(),title=P.name+' \u00B7 '+P.city,sub=rangeTxt(val('pfFrom'),val('pfTo'))+(P.phone?' \u00B7 '+P.phone:'');
    if(fmt==='pdf')return printOut('Medical statement \u2014 '+title,sub,card);
    const c=pngOf('Medical statement \u2014 '+title,sub,P.blocks);
    return dl(c.toDataURL('image/png'),'bts-'+P.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+stamp()+'.png');
  }
  const D=V[which];if(!D)return;
  const base='bts-'+which+'-'+stamp();
  if(fmt==='csv')return dl(URL.createObjectURL(new Blob([csvOf(D)],{type:'text/csv;charset=utf-8'})),base+'.csv');
  if(fmt==='pdf')return printOut(D.title,D.sub,card);
  const c=pngOf(D.title,D.sub,[{headers:D.headers,aligns:D.aligns,rows:D.rows,foot:D.foot}]);
  dl(c.toDataURL('image/png'),base+'.png');
}

/* ---------- backup ---------- */
$('exp').onclick=()=>{
  dl(URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'})),'bts-backup-'+stamp()+'.json');
  $('dataHint').textContent='Downloaded bts-backup-'+stamp()+'.json with '+S.parties.length+' medicals, '+S.items.length+' items, '+S.doctors.length+' doctors, '+S.rx.length+' prescriptions, '+S.targets.length+' targets.';
};
function mergeData(d){
  const map={},add={p:0,k:0,r:0,g:0,i:0},skip={p:0,k:0,r:0,g:0,i:0};
  const dmap={};
  (d.items||[]).forEach(i=>{
    if(!i||!i.name)return;
    if(findItem(i.name)){skip.i++;return}
    S.items.push({id:S.items.some(x=>x.id===i.id)?uid():(i.id||uid()),name:i.name,pack:i.pack||'',rate:+i.rate||0,note:i.note||'',ts:+i.ts||nowTs()});add.i++;
  });
  (d.parties||[]).forEach(p=>{
    const hit=S.parties.find(x=>x.name.trim().toLowerCase()===String(p.name).trim().toLowerCase()&&String(x.city).trim().toLowerCase()===String(p.city).trim().toLowerCase());
    if(hit){map[p.id]=hit.id;if(!hit.phone&&p.phone)hit.phone=p.phone;skip.p++;return}
    const id=S.parties.some(x=>x.id===p.id)?uid():p.id;
    map[p.id]=id;S.parties.push({id,name:p.name,city:p.city,phone:p.phone||'',ts:+p.ts||nowTs()});add.p++;
  });
  (d.bills||[]).forEach(b=>{if(!S.bills.some(x=>x.id===b.id))S.bills.push(b)});
  (d.deposits||[]).forEach(v=>{if(!S.deposits.some(x=>x.id===v.id))S.deposits.push(v)});
  (d.doctors||[]).forEach(k=>{
    const hit=S.doctors.find(x=>x.name.trim().toLowerCase()===String(k.name).trim().toLowerCase()
      &&String(x.city||'').trim().toLowerCase()===String(k.city||'').trim().toLowerCase());
    if(hit){dmap[k.id]=hit.id;if(!hit.phone&&k.phone)hit.phone=k.phone;skip.k++;return}
    const id=S.doctors.some(x=>x.id===k.id)?uid():k.id;
    dmap[k.id]=id;S.doctors.push({id,name:k.name,speciality:k.speciality||'',clinic:k.clinic||'',city:k.city||'',phone:k.phone||'',ts:+k.ts||nowTs()});add.k++;
  });
  (d.rx||[]).forEach(r=>{
    const did=dmap[r.doctorId]||r.doctorId,pid=map[r.partyId]||r.partyId;
    if(!S.doctors.some(x=>x.id===did)||!S.parties.some(x=>x.id===pid))return;
    const lines=(r.lines||[]).map(l=>({name:l.name||'',qty:+l.qty||0,rate:+l.rate||0,amount:+l.amount||0}));
    if(r.id&&S.rx.some(x=>x.id===r.id)){skip.r++;return}
    S.rx.push({id:(r.id&&!S.rx.some(x=>x.id===r.id))?r.id:uid(),doctorId:did,partyId:pid,date:r.date,note:r.note||'',lines,ts:+r.ts||nowTs()});add.r++;
  });
  (d.targets||[]).forEach(t=>{
    const did=dmap[t.doctorId]||t.doctorId;
    if(!S.doctors.some(x=>x.id===did))return;
    if(S.targets.some(x=>x.id===t.id||(x.doctorId===did&&x.start===t.start&&+x.amount===+t.amount&&+x.dur===+t.dur&&x.unit===t.unit))){skip.g++;return}
    S.targets.push({id:S.targets.some(x=>x.id===t.id)?uid():t.id,doctorId:did,amount:+t.amount||0,dur:+t.dur||1,
      unit:t.unit||'months',start:t.start,note:t.note||'',auto:!!t.auto,rolls:t.rolls||{},ts:+t.ts||nowTs()});add.g++;
  });
  return {add,skip};
}
$('imp').onchange=async e=>{
  const files=[...e.target.files];if(!files.length)return;
  const replace=val('impMode')==='replace';
  if(replace&&(S.parties.length||S.items.length||S.doctors.length||S.rx.length||S.targets.length)){
    if(!confirm('Replace mode will erase the current '+S.parties.length+' medicals, '+S.items.length+' items, '+S.doctors.length+' doctors, '+S.rx.length+' prescriptions and '+S.targets.length+
      ' targets, then load the selected file(s). Continue?')){e.target.value='';return}
    S.parties=[];S.bills=[];S.deposits=[];S.doctors=[];S.rx=[];S.targets=[];S.items=[];
  }
  const rep=[];let ok=0;
  for(const f of files){
    try{
      const d=JSON.parse(await f.text());
      if(!d||(!d.parties&&!d.bills&&!d.deposits&&!d.doctors&&!d.rx&&!d.targets&&!d.items)){rep.push({n:f.name,err:'Not a backup file'});continue}
      const r=mergeData(d);ok++;rep.push({n:f.name,a:r.add,s:r.skip});
    }catch(err){rep.push({n:f.name,err:'Could not be read as JSON'})}
  }
  openParty=null;await save();
  $('impReport').innerHTML='<div class="scroll" style="margin-top:12px"><table><thead><tr><th>File</th>'+
    '<th class="r">Medicals</th><th class="r">Items</th><th class="r">Doctors</th><th class="r">Rx</th>'+
    '<th class="r">Targets</th><th>Skipped as duplicate</th></tr></thead><tbody>'+
    rep.map(r=>r.err?'<tr><td>'+esc(r.n)+'</td><td colspan="6" class="due">'+r.err+'</td></tr>'
      :'<tr><td>'+esc(r.n)+'</td><td class="r num">+'+r.a.p+'</td>'+
       '<td class="r num">+'+r.a.i+'</td><td class="r num">+'+r.a.k+'</td><td class="r num">+'+r.a.r+'</td><td class="r num">+'+r.a.g+'</td>'+
       '<td class="num muted">'+r.s.p+' / '+r.s.i+' / '+r.s.k+' / '+r.s.r+' / '+r.s.g+'</td></tr>').join('')+'</tbody></table></div>';
  $('dataHint').textContent=(replace?'Replaced with ':'Merged ')+ok+' of '+files.length+' file(s). Now holding '+S.parties.length+
    ' medicals, '+S.items.length+' items, '+S.doctors.length+' doctors, '+S.rx.length+
    ' prescriptions, '+S.targets.length+' targets.';
  e.target.value='';
  tab('ledger');
};
$('seed').onclick=()=>{
  const a=uid(),b=uid(),c=uid();
  S.parties.push({id:a,name:'Asnani Medical Store',city:'Indore',phone:'9876543210'},
    {id:b,name:'Shri Ram Medicals',city:'Bhopal',phone:'9812345678'},
    {id:c,name:'Krishna Chemist',city:'Indore',phone:''});
  [['Amoxycillin 500','10 x 10 caps',120,'Alkem'],['Pantoprazole 40','10 x 10 tab',100,'Sun Pharma'],
   ['Paracetamol 650','15 x 10 tab',50,'Micro Labs'],['Azithromycin 500','10 x 3 tab',150,'Cipla'],
   ['Cough syrup 100ml','box of 20',80,'Glenmark'],['Metformin 500','10 x 10 tab',100,'USV']]
    .forEach(([nm,pk,rt,co])=>S.items.push({id:uid(),name:nm,pack:pk,rate:rt,note:co}));
  const d1=uid(),d2=uid();
  S.doctors.push({id:d1,name:'Dr. R. Sharma',speciality:'Physician',clinic:'Sharma Clinic',city:'Indore',phone:'9822001100'},
    {id:d2,name:'Dr. A. Verma',speciality:'Paediatrics',clinic:'City Hospital',city:'Bhopal',phone:'9822004400'});
  S.rx.push({id:uid(),doctorId:d1,partyId:a,date:'2026-07-14',note:'',lines:[{name:'Amoxycillin 500',qty:100,rate:9,amount:900},{name:'Pantoprazole 40',qty:200,rate:6,amount:1200}]},
    {id:uid(),doctorId:d1,partyId:c,date:'2026-08-06',note:'monthly',lines:[{name:'Amoxycillin 500',qty:150,rate:9,amount:1350}]},
    {id:uid(),doctorId:d2,partyId:b,date:'2026-08-18',note:'',lines:[{name:'Paracetamol syrup',qty:80,rate:42,amount:3360}]});
  S.targets.push({id:uid(),doctorId:d1,amount:2000,dur:1,unit:'months',start:'2026-07-01',note:'Monsoon scheme',auto:true,rolls:{}},
    {id:uid(),doctorId:d2,amount:5000,dur:15,unit:'days',start:'2026-08-01',note:'',auto:false,rolls:{}});
  save();$('dataHint').textContent='Sample data loaded.';
};
$('wipe').onclick=()=>{
  if(!confirm('Erase all '+S.parties.length+' medicals, '+S.items.length+' items, '+S.doctors.length+' doctors, '+S.rx.length+' prescriptions and '+S.targets.length+' targets?\nDownload a backup first if you need it.'))return;
  if(!confirm('Last check. Erase everything?'))return;
  S.parties=[];S.bills=[];S.deposits=[];S.doctors=[];S.rx=[];S.targets=[];S.items=[];
  openParty=null;openDoc=null;clearParty();clearDoc();clearRx();clearTg();clearItem();
  save();$('dataHint').textContent='All data erased.';
};

$('splashEnter').onclick=()=>{$('splash').classList.add('out')};

load();
