/* ICE standalone: on-device database that speaks the same interface the app already uses.
   Swap this file for a Supabase adapter later to add multi-device sync. */
(function(){
  const DBN='ice-inventory',ST='docs';let idb=null;const mem=new Map();const subs=new Set();
  const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  const tx=(mode,fn)=>new Promise((res,rej)=>{const t=idb.transaction(ST,mode);const s=t.objectStore(ST);fn(s);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)});
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  let pend=false;const notify=()=>{if(pend)return;pend=true;setTimeout(()=>{pend=false;subs.forEach(f=>{try{f()}catch(e){console.error(e)}})},0)};
  const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  async function put(k,v){mem.set(k,clone(v));await tx('readwrite',s=>s.put(clone(v),k));notify()}
  async function del(k){mem.delete(k);await tx('readwrite',s=>s.delete(k));notify()}
  function col(path){return{
    doc(id){id=id||rid();const k=path+'/'+id;return{id,
      get:async()=>({id,exists:mem.has(k),data:()=>clone(mem.get(k))}),
      set:async d=>put(k,d),
      update:async d=>{if(!mem.has(k))throw{code:'not_found',message:'No such record'};const cur=clone(mem.get(k));for(const f in d){if(d[f]&&d[f].__delete__)delete cur[f];else cur[f]=d[f]}await put(k,cur)},
      delete:async()=>del(k),
      onSnapshot(next){const f=()=>next({id,exists:mem.has(k),data:()=>clone(mem.get(k))});subs.add(f);f();return()=>subs.delete(f)}}},
    onSnapshot(next){const pre=path+'/';const f=()=>next({docs:[...mem.keys()].filter(k=>k.startsWith(pre)&&k.slice(pre.length).indexOf('/')<0).map(k=>({id:k.slice(pre.length),data:()=>clone(mem.get(k))})),metadata:{fromCache:false}});subs.add(f);f();return()=>subs.delete(f)}}}
  const db={collection:col,doc:p=>{const i=p.lastIndexOf('/');return col(p.slice(0,i)).doc(p.slice(i+1))}};
  // device user
  const LS=k=>{try{return localStorage.getItem(k)}catch(e){return null}},LSset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
  let uid=LS('ice-uid');if(!uid){uid='d_'+rid();LSset('ice-uid',uid)}
  function askName(){return new Promise(res=>{const n=LS('ice-uname');if(n)return res(n);
    const w=document.createElement('div');w.id='ice-who';w.innerHTML='<form><h2>Who is using this device?</h2><p>Your name goes on every ticket you post from this device.</p><input id="ice-who-n" autocomplete="name" placeholder="e.g. Maria, Receiving" required><button class="btn primary" type="submit">Start</button></form>';
    document.body.appendChild(w);const f=w.querySelector('form');setTimeout(()=>w.querySelector('input').focus(),50);
    f.onsubmit=e=>{e.preventDefault();const v=w.querySelector('input').value.trim();if(!v)return;LSset('ice-uname',v);w.remove();res(v)}})}
  async function profilesMap(ids){const out={};for(const id of ids){const u=mem.get('users/'+id);out[id]={name:u&&u.name||''}}return out}
  const user={id:async()=>uid,me:async()=>({id:uid,name:LS('ice-uname')||''}),isOwner:()=>true,canEdit:async()=>true,can:async()=>true,profiles:profilesMap};
  const downloads={save:async({filename,data})=>{const b=data instanceof Blob?data:new Blob([data],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);return{status:'saved'}}};
  const ready=(async()=>{idb=await open();await new Promise((res,rej)=>{const t=idb.transaction(ST,'readonly');const s=t.objectStore(ST);const rq=s.openCursor();rq.onsuccess=()=>{const c=rq.result;if(c){mem.set(c.key,c.value);c.continue()}else res()};rq.onerror=()=>rej(rq.error)});
    if(navigator.storage&&navigator.storage.persist){try{await navigator.storage.persist()}catch(e){}}
    const name=await askName();if(!mem.get('users/'+uid)||mem.get('users/'+uid).name!==name)await put('users/'+uid,{name,at:new Date().toISOString()});})();

  // Connection check: look for a network first, then work from the device.
  async function reach(){if(!navigator.onLine)return false;try{const r=await fetch('manifest.webmanifest?ping='+Date.now(),{cache:'no-store'});return r.ok}catch(e){return false}}
  let netOn=null;
  async function netCheck(){const on=await reach();const was=netOn;netOn=on;window.__iceOnline=on;
    const t=document.getElementById('liveTxt'),l=document.getElementById('live');
    if(t){t.textContent=on?'Wi-Fi connected · saved on this device':'No Wi-Fi · working offline';if(l)l.dataset.on=on?1:0}
    if(was!==null&&was!==on){const ts=document.getElementById('toast');if(ts){ts.textContent=on?'Wi-Fi is back. Everything you did offline is saved.':'Wi-Fi lost. Keep working: everything saves on this device.';ts.hidden=false;setTimeout(()=>ts.hidden=true,3500)}}
    document.dispatchEvent(new CustomEvent('ice-net',{detail:{online:on}}))}
  addEventListener('online',netCheck);addEventListener('offline',netCheck);setInterval(netCheck,30000);
  const netReady=netCheck();
  window.__iceNet={check:netCheck,get online(){return netOn}};
  window.__ICE_STANDALONE=true;
  window.__iceLocal={
    async replaceAll(backup){const C=backup&&backup.collections;if(!C)throw new Error('Not an ICE backup file');
      await tx('readwrite',s=>s.clear());mem.clear();
      const add=(p,arr)=>(arr||[]).forEach(d=>{if(!d||!d.id)return;const v=Object.assign({},d);delete v.id;mem.set(p+'/'+d.id,v)});
      add('receipts',C.receipts);add('items',C.items);add('itemEdits',C.itemEdits);add('vendors',C.vendors);add('opening',C.opening);add('settings',C.settings);add('archive',C.archive);add('users',C.users);
      await tx('readwrite',s=>{for(const [k,v] of mem)s.put(v,k)});notify()},
    users:()=>[...mem.keys()].filter(k=>k.startsWith('users/')).map(k=>Object.assign({id:k.slice(6)},mem.get(k))),
    count:()=>mem.size};
  window.claude={use:async n=>{await ready;await netReady;return n==='db'?db:n==='user'?user:n==='downloads'?downloads:null}};
  if('serviceWorker' in navigator&&location.protocol!=='file:')addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
