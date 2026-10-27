/* Collab Desk storage + sync.
   Every record lives in IndexedDB on this device first (so the app works offline), and is mirrored to
   Google Drive as one Markdown file per record: Collab Desk/deals/*.md, content/*.md, brands/*.md, profile.md.
   Sync = pull what changed in Drive, push what changed here. Same record changed on both sides: newest save wins. */
(() => {
const CFG = window.COLLAB_DESK_CONFIG || {};
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const COLS = ["deals","content","brands"];
const JSZIP_URL = "jszip.min.js";

/* ---------- small helpers ---------- */
const ls = {
  get(k, d=null){ try{ const v = localStorage.getItem("collabdesk."+k); return v===null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ v===null ? localStorage.removeItem("collabdesk."+k) : localStorage.setItem("collabdesk."+k, JSON.stringify(v)); }catch{} },
};
const keyOf = (col, id) => col + "/" + id;
const slug = s => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,50) || "untitled";
const TITLE = {deals:"brand", content:"title", brands:"name", profile:"name"};
const BODY = {deals:["deliverables","notes","usageNote","productsSent"], content:["notes"], brands:["why","notes"], profile:["signature","rates"]};
const MILESTONES = [["contract","Contract signed"],["products","Products received"],["shoot","Shoot done"],["draft","Draft sent"],["approved","Approved"],["posted","Posted"],["invoiced","Invoiced"],["paid","Paid"]];
const fileName = (col, id, data) => col==="profile" ? "profile.md" : `${slug(data[TITLE[col]])}--${id}.md`;

/* ---------- Markdown <-> record ---------- */
function yv(v){
  if(typeof v==="boolean") return v ? "true" : "false";
  if(typeof v==="number" && isFinite(v)) return String(v);
  if(v===null || v===undefined || v==="") return '""';
  if(typeof v==="object") return JSON.stringify(v);
  return JSON.stringify(String(v));
}
function toMarkdown(col, id, data){
  const fm = [`id: ${yv(id)}`, `type: ${col}`];
  for(const [k,v] of Object.entries(data)){
    if(BODY[col].includes(k) || k==="revisions" || (col==="deals" && k==="milestones")) continue;
    fm.push(`${k}: ${yv(v)}`);
  }
  if(Array.isArray(data.revisions) && data.revisions.length){
    fm.push("revisions:");
    for(const r of data.revisions) fm.push(`  - {date: ${yv(r.date)}, done: ${yv(!!r.done)}, text: ${yv(r.text)}}`);
  }
  const body = [`# ${String(data[TITLE[col]] || id).replace(/\n/g," ")}`];
  const ms = col==="deals" && data.milestones && typeof data.milestones==="object" ? data.milestones : {};
  const msLines = MILESTONES.filter(([k]) => k in ms).map(([k,l]) => `- [${ms[k]?"x":" "}] ${l}${typeof ms[k]==="string" && ms[k] ? ` (${ms[k]})` : ""}`);
  if(msLines.length) body.push("", "## milestones", "", ...msLines);
  for(const k of BODY[col]) if(data[k]) body.push("", `## ${k}`, "", String(data[k]));
  return "---\n" + fm.join("\n") + "\n---\n\n" + body.join("\n") + "\n";
}
function scalar(raw){
  const v = raw.trim();
  if(v==="" || v==='""' || v==="''" || v==="~" || v==="null") return "";
  if(v[0]==='"'){ try{ return JSON.parse(v); }catch{ return v.replace(/^"|"$/g,""); } }
  if(v[0]==="'") return v.replace(/^'|'$/g,"").replace(/''/g,"'");
  if(v==="true") return true;
  if(v==="false") return false;
  if(/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if(v[0]==="[" || v[0]==="{"){ try{ return JSON.parse(v); }catch{ try{ return JSON.parse(v.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g,'$1"$2":')); }catch{} } }
  return v;
}
function parseMilestones(lines){
  const out = {};
  for(const line of lines){
    const m = line.match(/^\s*[-*+]\s*\[([ xX]?)\]\s*(.+?)\s*$/); if(!m) continue;
    const d = m[2].match(/^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)$/);
    const label = (d ? d[1] : m[2]).replace(/\s+/g," ").toLowerCase();
    const hit = MILESTONES.find(([,l]) => l.toLowerCase()===label); if(!hit) continue;
    out[hit[0]] = m[1].trim() ? (d ? d[2] : true) : "";
  }
  return out;
}
function fromMarkdown(text, fname=""){
  text = String(text).replace(/^﻿/,"").replace(/\r\n?/g,"\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if(!m) throw new Error(`${fname||"A file"} isn't a Collab Desk Markdown file (no --- header).`);
  const data = {}; let listKey = null;
  for(const line of m[1].split("\n")){
    const item = line.match(/^\s+-\s+(.*)$/);
    if(item && listKey){ data[listKey].push(scalar(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if(!kv) continue;
    if(kv[2].trim()===""){ data[kv[1]] = []; listKey = kv[1]; continue; }
    listKey = null; data[kv[1]] = scalar(kv[2]);
  }
  for(const [k,v] of Object.entries(data)) if(Array.isArray(v) && !v.length && k!=="revisions") data[k] = "";
  let sec = null, buf = [], msBody = null;
  const flush = () => { if(sec==="milestones") msBody = parseMilestones(buf); else if(sec) data[sec] = buf.join("\n").trim(); };
  for(const line of m[2].split("\n")){
    const h = line.match(/^## ([A-Za-z_]\w*)\s*$/);
    if(h){ flush(); sec = h[1]; buf = []; } else if(sec) buf.push(line);
  }
  flush();
  let col = data.type, id = data.id;
  delete data.type; delete data.id;
  if(!["deals","content","brands","profile"].includes(col)){
    col = /(^|\/)profile\.md$/i.test(fname) ? "profile" : data.brand!==undefined ? "deals" : data.title!==undefined ? "content" : data.name!==undefined ? "brands" : null;
    if(!col) throw new Error(`Couldn't tell what kind of item ${fname||"a file"} is. Add a "type:" line (deals, content, brands or profile).`);
  }
  if(msBody && col==="deals" && Object.keys(msBody).length) data.milestones = msBody;
  if(col==="profile") id = "profile";
  if(!id){ const fm = String(fname).match(/--([A-Za-z0-9_]+)\.md$/i); id = fm ? fm[1] : col[0] + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
  return {col, id: String(id), data};
}

/* ---------- IndexedDB ---------- */
let idb = null;
function open(){
  if(idb) return Promise.resolve();
  return new Promise((res, rej) => {
    const r = indexedDB.open("collabdesk", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("records", {keyPath:"key"});
    r.onsuccess = () => { idb = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
const store = mode => idb.transaction("records", mode).objectStore("records");
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAllRecs = () => req(store("readonly").getAll());
const getRec = key => req(store("readonly").get(key));
const putRec = rec => req(store("readwrite").put(rec));
const delRec = key => req(store("readwrite").delete(key));

/* ---------- events ---------- */
const changeFns = [], statusFns = [];
let statusText = "", statusLevel = "warn";
function emitChange(){ changeFns.forEach(f => { try{ f(); }catch{} }); }
function setStatus(text, level){
  statusText = text; statusLevel = level;
  statusFns.forEach(f => { try{ f(text, level); }catch{} });
  document.querySelectorAll(".syncbar").forEach(el => { el.className = "syncbar " + level; el.style.cursor = needsAuth ? "pointer" : ""; });
}

/* ---------- Google sign-in (OAuth implicit flow, full-page redirect: works in Safari home-screen apps) ---------- */
const clientId = () => CFG.googleClientId || ls.get("clientId", "");
const redirectUri = () => location.origin + location.pathname;
let token = ls.get("token");           // {value, exp}
let needsAuth = false;
const tokenOk = () => { token = ls.get("token"); return !!(token && token.value && Date.now() < token.exp - 60e3); };
function authRedirect(silent){
  const state = Math.random().toString(36).slice(2);
  ls.set("authState", state);
  ls.set("returnHash", location.hash || "");
  if(silent) ls.set("lastSilent", Date.now());
  const p = new URLSearchParams({client_id: clientId(), redirect_uri: redirectUri(), response_type: "token", scope: SCOPE, include_granted_scopes: "true", state});
  const email = ls.get("email");
  if(silent) p.set("prompt", "none"); else p.set("prompt", email ? "consent" : "select_account consent");
  if(email) p.set("login_hint", email);
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p);
}
// Runs before the app script reads location.hash for routing.
(function readAuthResponse(){
  const h = location.hash;
  if(!/[#&](access_token|error)=/.test(h)) return;
  const p = new URLSearchParams(h.slice(1));
  const back = ls.get("returnHash", "");
  const okState = p.get("state") && p.get("state") === ls.get("authState");
  if(okState && p.get("access_token")){
    token = {value: p.get("access_token"), exp: Date.now() + Number(p.get("expires_in")||3600)*1000};
    ls.set("token", token); ls.set("connected", true);
  } else if(okState){
    ls.set("authError", p.get("error") || "error");
  }
  ls.set("authState", null);
  try{ history.replaceState(null, "", location.pathname + location.search + back); }catch{ location.hash = back; }
})();

/* ---------- Drive REST ---------- */
class AuthError extends Error {}
async function gfetch(url, opts={}){
  if(!tokenOk()) throw new AuthError("expired");
  const r = await fetch(url, {...opts, headers: {...(opts.headers||{}), Authorization: "Bearer " + token.value}});
  if(r.status===401){ token = null; ls.set("token", null); throw new AuthError("expired"); }
  if(r.status===403){
    const body = await r.text();
    if(/insufficient|scope/i.test(body)){ token = null; ls.set("token", null); throw new AuthError("scope"); }
    throw new Error("Drive refused the request: " + body.slice(0,200));
  }
  if(!r.ok){ const e = new Error(`Drive error ${r.status}`); e.status = r.status; throw e; }
  return r;
}
const gjson = async (url, opts) => (await gfetch(url, opts)).json();
const q = s => encodeURIComponent(s);
async function findOrCreateFolder(name, prop, val, parent){
  const query = `appProperties has { key='${prop}' and value='${val}' } and mimeType='${FOLDER}' and trashed=false`;
  const r = await gjson(`${API}/files?q=${q(query)}&fields=files(id,name)&spaces=drive&pageSize=10`);
  if(r.files && r.files.length) return r.files[0].id;
  const meta = {name, mimeType: FOLDER, appProperties: {[prop]: val}};
  if(parent) meta.parents = [parent];
  return (await gjson(`${API}/files?fields=id`, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(meta)})).id;
}
let folders = ls.get("folders");       // {root, deals, content, brands}
async function ensureFolders(){
  if(folders && folders.root){
    try{ const f = await gjson(`${API}/files/${folders.root}?fields=id,trashed`); if(!f.trashed) return folders; }catch(e){ if(e instanceof AuthError) throw e; }
  }
  const root = await findOrCreateFolder("Collab Desk", "cdRoot", "1");
  folders = {root};
  for(const c of COLS) folders[c] = await findOrCreateFolder(c, "cdFolder", c, root);
  ls.set("folders", folders);
  return folders;
}
async function listRemote(){
  const out = new Map(); let page = "";
  const query = `appProperties has { key='cdApp' and value='1' } and trashed=false`;
  do{
    const r = await gjson(`${API}/files?q=${q(query)}&spaces=drive&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,appProperties)${page?`&pageToken=${page}`:""}`);
    for(const f of r.files||[]){ const k = f.appProperties && f.appProperties.cdKey; if(k && !out.has(k)) out.set(k, f); }
    page = r.nextPageToken || "";
  } while(page);
  return out;
}
const download = async id => (await gfetch(`${API}/files/${id}?alt=media`)).text();
async function upload(rec){
  const name = fileName(rec.col, rec.id, rec.data);
  const md = toMarkdown(rec.col, rec.id, rec.data);
  const meta = {name, mimeType: "text/markdown"};
  if(!rec.fileId){
    meta.parents = [rec.col==="profile" ? folders.root : folders[rec.col]];
    meta.appProperties = {cdApp:"1", cdKey: rec.key, cdCol: rec.col, cdId: rec.id};
  }
  const boundary = "cd" + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${md}\r\n--${boundary}--`;
  const url = rec.fileId ? `${UPLOAD}/files/${rec.fileId}?uploadType=multipart&fields=id,modifiedTime` : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`;
  return gjson(url, {method: rec.fileId ? "PATCH" : "POST", headers: {"Content-Type": `multipart/related; boundary=${boundary}`}, body});
}
const trash = id => gfetch(`${API}/files/${id}?fields=id`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({trashed:true})});

/* ---------- sync ---------- */
let syncing = false, again = false, lastSync = ls.get("lastSync", 0), timer = null;
const connected = () => !!ls.get("connected");
async function pendingCount(){ return (await getAllRecs()).filter(r => r.dirty).length; }
async function idleStatus(){
  const n = await pendingCount();
  if(!connected()) return setStatus(n ? "On this device only · not synced" : "On this device only", "warn");
  if(needsAuth) return setStatus("Tap to reconnect Google Drive", "bad");
  if(!navigator.onLine) return setStatus(n ? `Offline · ${n} change${n===1?"":"s"} waiting` : "Offline · saved on this device", "warn");
  if(n) return setStatus(`${n} change${n===1?"":"s"} waiting to sync`, "warn");
  setStatus(lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}` : "Connected", "ok");
}
function schedule(ms=1500){ clearTimeout(timer); timer = setTimeout(() => syncNow(), ms); }
async function syncNow(manual){
  if(!connected()) return idleStatus();
  if(!navigator.onLine){ if(manual) alertish("You're offline. Changes are saved here and will sync when you're back online."); return idleStatus(); }
  if(!tokenOk()){
    needsAuth = true; await idleStatus();
    const drawerOpen = !!document.querySelector("#drawerroot .drawer");
    if(manual) authRedirect(false);
    else if(!drawerOpen && Date.now() - ls.get("lastSilent", 0) > 10*60e3) authRedirect(true);
    return;
  }
  needsAuth = false;
  if(syncing){ again = true; return; }
  syncing = true; setStatus("Syncing…", "warn");
  try{
    await ensureFolders();
    if(!ls.get("email")){ try{ const a = await gjson(`${API}/about?fields=user(emailAddress)`); ls.set("email", a.user.emailAddress); }catch(e){ if(e instanceof AuthError) throw e; } }
    let changed = false;
    const remote = await listRemote();
    const locals = new Map((await getAllRecs()).map(r => [r.key, r]));
    // pull
    for(const [key, f] of remote){
      const r = locals.get(key);
      if(r && r.fileId===f.id && r.remoteModified===f.modifiedTime) continue;
      let parsed;
      try{ parsed = fromMarkdown(await download(f.id), f.name); }catch(e){ console.warn("Skipping unreadable file", f.name, e); continue; }
      const col = (f.appProperties && f.appProperties.cdCol) || parsed.col, id = (f.appProperties && f.appProperties.cdId) || parsed.id;
      const remoteTime = [parsed.data.updatedAt, f.modifiedTime].filter(Boolean).sort().pop();
      if(r && r.dirty && (r.updatedAt||"") >= remoteTime){
        await putRec({...r, fileId: f.id, remoteModified: f.modifiedTime});   // local is newer: push it below
      } else {
        await putRec({key, col, id, data: parsed.data, updatedAt: remoteTime, fileId: f.id, remoteModified: f.modifiedTime, dirty: false, deleted: false, rev: (r && r.rev || 0) + 1});
        changed = true;
      }
    }
    // files removed in Drive
    for(const r of locals.values()){
      if(!r.fileId || remote.has(r.key)) continue;
      if(!r.dirty || r.deleted){ await delRec(r.key); if(!r.deleted) changed = true; }
      else await putRec({...r, fileId: null, remoteModified: null});
    }
    if(changed) emitChange();
    // push
    for(const r0 of (await getAllRecs()).filter(r => r.dirty)){
      const rev = r0.rev;
      if(r0.deleted){
        if(r0.fileId){ try{ await trash(r0.fileId); }catch(e){ if(e.status!==404) throw e; } }
        const now = await getRec(r0.key); if(now && now.rev===rev) await delRec(r0.key);
        continue;
      }
      let res;
      try{ res = await upload(r0); }
      catch(e){ if(e.status===404 && r0.fileId){ res = await upload({...r0, fileId: null}); } else throw e; }
      const now = await getRec(r0.key);
      if(now) await putRec({...now, fileId: res.id, remoteModified: res.modifiedTime, dirty: now.rev!==rev});
    }
    lastSync = Date.now(); ls.set("lastSync", lastSync);
    syncing = false; await idleStatus();
  }catch(e){
    syncing = false;
    if(e instanceof AuthError){ needsAuth = true; await idleStatus(); }
    else { console.error(e); setStatus("Sync failed · will retry", "bad"); schedule(60e3); }
  }
  if(again){ again = false; schedule(500); }
}
function alertish(msg){ try{ (window.toast||alert)(msg); }catch{} }

/* ---------- public API used by the app ---------- */
window.CD = {
  open,
  toMarkdown, fromMarkdown, MILESTONES,
  async all(){ return (await getAllRecs()).filter(r => !r.deleted); },
  async put(col, id, data){
    const key = keyOf(col, id), r = await getRec(key);
    await putRec({...(r||{}), key, col, id, data, updatedAt: data.updatedAt || new Date().toISOString(), dirty: true, deleted: false, rev: (r && r.rev || 0) + 1});
    idleStatus(); schedule();
  },
  async del(col, id){
    const key = keyOf(col, id), r = await getRec(key);
    if(!r) return;
    if(!r.fileId) await delRec(key);
    else await putRec({...r, deleted: true, dirty: true, updatedAt: new Date().toISOString(), rev: (r.rev||0) + 1});
    idleStatus(); schedule();
  },
  onChange(fn){ changeFns.push(fn); },
  onStatus(fn){ statusFns.push(fn); if(statusText) fn(statusText, statusLevel); },
  start(){
    const err = ls.get("authError");
    if(err){ ls.set("authError", null); if(err!=="interaction_required" && err!=="login_required" && err!=="consent_required") alertish("Google sign-in didn't finish (" + err + "). Try Connect again."); }
    window.addEventListener("online", () => syncNow());
    window.addEventListener("offline", () => idleStatus());
    document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible" && Date.now() - lastSync > 30e3) syncNow(); });
    setInterval(() => { if(document.visibilityState==="visible") syncNow(); }, 3*60e3);
    document.addEventListener("click", e => { if(needsAuth && e.target.closest(".syncbar, .rail .status")) authRedirect(false); });
    idleStatus(); syncNow();
  },
  syncNow,
  connect(id){
    if(id) ls.set("clientId", id);
    if(!clientId()) return alertish("Add your Google Client ID first.");
    if(!navigator.onLine) return alertish("Connect while you're online.");
    // a new connection re-uploads anything this device has that Drive doesn't (matched by id, so no duplicates)
    authRedirect(false);
  },
  async disconnect(){
    ls.set("connected", null); ls.set("token", null); ls.set("folders", null); ls.set("email", null); ls.set("lastSync", null);
    token = null; folders = null; needsAuth = false; lastSync = 0;
    for(const r of await getAllRecs()){
      if(r.deleted) await delRec(r.key);
      else await putRec({...r, fileId: null, remoteModified: null, dirty: true});
    }
    emitChange(); idleStatus();
  },
  info(){
    return {connected: connected(), email: ls.get("email"), status: statusText, clientId: clientId(), builtInId: !!CFG.googleClientId,
      folderUrl: folders && folders.root ? `https://drive.google.com/drive/folders/${folders.root}` : ""};
  },
  download(name, blob){
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
  },
  async exportZip(){
    const JSZip = await loadZip(), zip = new JSZip(), root = zip.folder("collab-desk");
    for(const r of await this.all()) root.file(r.col==="profile" ? "profile.md" : `${r.col}/${fileName(r.col, r.id, r.data)}`, toMarkdown(r.col, r.id, r.data));
    this.download(`collab-desk-${new Date().toLocaleDateString("en-CA")}.zip`, await zip.generateAsync({type:"blob"}));
  },
  async importFiles(files){
    const items = [];
    for(const f of files){
      if(/\.zip$/i.test(f.name)){
        const JSZip = await loadZip(), zip = await JSZip.loadAsync(f);
        for(const e of Object.values(zip.files)) if(!e.dir && /\.md$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name)) items.push(fromMarkdown(await e.async("string"), e.name));
      } else if(/\.(md|markdown|txt)$/i.test(f.name)) items.push(fromMarkdown(await f.text(), f.name));
    }
    if(!items.length) throw new Error("No Markdown files found.");
    const now = new Date().toISOString();
    const existing = new Map((await getAllRecs()).map(r => [r.key, r]));
    await new Promise((res, rej) => {
      const tx = idb.transaction("records", "readwrite"), st = tx.objectStore("records");
      for(const it of items){
        const key = keyOf(it.col, it.id), r = existing.get(key);
        st.put({...(r||{}), key, col: it.col, id: it.id, data: {...it.data, updatedAt: now}, updatedAt: now, dirty: true, deleted: false, rev: (r && r.rev || 0) + 1});
      }
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    emitChange(); idleStatus(); schedule();
    return items.length;
  },
};
let zipPromise = null;
function loadZip(){
  return zipPromise ||= new Promise((res, rej) => {
    if(window.JSZip) return res(window.JSZip);
    const s = document.createElement("script"); s.src = JSZIP_URL;
    s.onload = () => res(window.JSZip); s.onerror = () => { zipPromise = null; rej(new Error("offline")); };
    document.head.appendChild(s);
  });
}
})();
