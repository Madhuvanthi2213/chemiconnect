/* ChemiConnect offline layer
 *
 * A health centre's internet is unreliable, so stock entry and billing never wait for the network:
 *   1. every change is applied to a copy of the inventory kept on this device (localStorage),
 *   2. the change is also put in an "outbox" (a queue, in the order it happened),
 *   3. whenever the connection is back the outbox is sent to the server one entry at a time, oldest first.
 *
 * Each outbox entry has a unique client_id; the server remembers it (table sync_log), so an entry that was
 * already received is never applied twice even if the reply was lost on a weak connection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const K = uid => ({
  stock: `cc:${uid}:stock`,          // working copy of the inventory (server rows + not-yet-sent changes)
  queue: `cc:${uid}:outbox`,         // entries waiting to be sent
  dash: `cc:${uid}:dashboard`,       // last dashboard numbers received from the server
  synced: `cc:${uid}:lastSync`,      // when the server last confirmed everything
  user: 'cc:lastUser'                // last logged-in user (so the app can open with no internet)
});

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export class NetworkError extends Error {
  constructor() { super('There is no internet connection right now, so this could not be done.'); this.name = 'NetworkError'; this.offline = true; }
}

/* ---------- tiny event bus so every screen re-renders when the outbox / connection changes ---------- */
const subs = new Set();
const bump = () => subs.forEach(f => f());
let session = { uid: null };
let netUp = typeof navigator === 'undefined' ? true : navigator.onLine !== false;   // best guess; failed requests correct it
let syncing = false;
let syncTimer = null;
let lastToast = null;

export const useOfflineTick = () => {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(n => n + 1); subs.add(f); return () => subs.delete(f); }, []);
};

export const setNet = up => { if (netUp !== up) { netUp = up; bump(); } };
export const isOnline = () => netUp;

/* ---------- last user (offline start) ---------- */
export const rememberUser = u => { if (u) write(K(u.id).user, u); };
export const lastUser = () => {
  try { const v = localStorage.getItem('cc:lastUser'); return v ? JSON.parse(v) : null; } catch { return null; }
};
export const forgetUser = () => { try { localStorage.removeItem('cc:lastUser'); } catch { /* ignore */ } };

/* ---------- local copy of data ---------- */
export const startSession = uid => { session = { uid }; };
const keys = () => K(session.uid);

export const getStock = () => read(keys().stock, null);
export const setStock = rows => { write(keys().stock, rows); bump(); };
export const getQueue = () => read(keys().queue, []);
const setQueue = q => { write(keys().queue, q); bump(); };
export const getDash = () => read(keys().dash, null);
export const setDash = d => write(keys().dash, d);
export const lastSync = () => read(keys().synced, null);

export const pendingCount = () => getQueue().filter(o => o.state !== 'failed').length;
export const failedOps = () => getQueue().filter(o => o.state === 'failed');

export const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
let tempSeq = 0;
const tempId = () => -(Date.now() * 100 + (tempSeq++ % 100));   // negative ids = rows that exist only on this device

export const isTemp = id => typeof id === 'number' && id < 0;
const nowLocal = () => {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* ---------- local actions (they work with or without internet) ---------- */

// New medicine batch. Returns an error sentence (plain text) or null when it was saved.
export function localAddStock({ name, batch_no, expiry_date, qty, price, free }, cid) {
  const rows = getStock() || [];
  const dup = rows.find(r => r.name.toLowerCase() === name.trim().toLowerCase() && String(r.batch_no || '').toLowerCase() === batch_no.trim().toLowerCase() && String(r.expiry_date || '').slice(0, 10) === expiry_date);
  if (dup) return 'This batch is already in your inventory, so change its quantity in the table instead of adding it again.';
  const known = rows.find(r => r.name.toLowerCase() === name.trim().toLowerCase());
  const row = {
    id: tempId(), name: known ? known.name : name.trim(), batch_no: batch_no.trim(), expiry_date,
    qty: +qty, price: known ? known.price : +price, free: known ? known.free : !!free, pending: true
  };
  setStock([...rows, row]);
  setQueue([...getQueue(), { cid: cid || newId(), type: 'stock_add', at: Date.now(), tid: row.id, body: { name: row.name, batch_no: row.batch_no, expiry_date, qty: row.qty, price: +price } }]);
  scheduleSync(300);
  return null;
}

// Change the quantity of one batch. If the batch itself is still waiting to be sent, its waiting entry is simply updated.
export function localSetQty(row, qty, cid) {
  setStock((getStock() || []).map(r => r.id === row.id ? { ...r, qty: +qty, pending: true } : r));
  let q = getQueue();
  if (isTemp(row.id)) {
    // The waiting "add" is replayed BEFORE the waiting bills that sold from this batch, so it must start with the
    // new quantity plus whatever those bills will take out again; otherwise the units would be taken out twice.
    const billed = q.filter(o => o.type === 'bill_create').reduce((n, o) => n + o.body.items.filter(i => i.id === row.id).reduce((m, i) => m + i.qty, 0), 0);
    q = q.map(o => o.type === 'stock_add' && o.tid === row.id ? { ...o, body: { ...o.body, qty: +qty + billed } } : o);
  } else {
    // only the latest quantity matters, so older waiting changes for this batch are replaced
    q = q.filter(o => !(o.type === 'stock_update' && o.body.id === row.id && o.state !== 'sending'));
    q.push({ cid: cid || newId(), type: 'stock_update', at: Date.now(), body: { id: row.id, qty: +qty }, label: row.name, batch: row.batch_no });
  }
  setQueue(q);
  scheduleSync(300);
}

// Remove a batch from the inventory. A batch that was never sent is simply forgotten.
export function localDelete(row) {
  setStock((getStock() || []).filter(r => r.id !== row.id));
  let q = getQueue();
  if (isTemp(row.id)) {
    q = q.filter(o => !(o.type === 'stock_add' && o.tid === row.id));
  } else {
    q = q.filter(o => !(o.type === 'stock_update' && o.body.id === row.id));
    q.push({ cid: newId(), type: 'stock_delete', at: Date.now(), body: { id: row.id }, label: row.name, batch: row.batch_no });
  }
  setQueue(q);
  scheduleSync(300);
}

// Make a bill. Stock goes down on this device straight away; the final invoice number is given when it reaches the server.
// Returns { ref, total } or { error } (an error is one plain sentence).
export function localBill({ customer, items, cid }) {
  const rows = getStock() || [];
  let total = 0;
  for (const i of items) {
    const r = rows.find(x => x.id === i.id);
    if (!r) return { error: 'One medicine on the bill is no longer in your inventory, so please remove it and add it again.' };
    if (r.expiry_date && dayDiff(r.expiry_date) < 0) return { error: `${r.name} (batch ${r.batch_no || '-'}) is past its expiry date, so it cannot be sold.` };
    if (r.qty < i.qty) return { error: `Only ${r.qty} unit${r.qty === 1 ? '' : 's'} of ${r.name} (batch ${r.batch_no || '-'}) ${r.qty === 1 ? 'is' : 'are'} in stock, so please lower the quantity on the bill.` };
    total += (r.free ? 0 : +r.price) * i.qty;
  }
  setStock(rows.map(r => { const l = items.find(i => i.id === r.id); return l ? { ...r, qty: r.qty - l.qty, pending: true } : r; }));
  const ref = 'OFF-' + String(getQueue().filter(o => o.type === 'bill_create').length + 1).padStart(3, '0');
  setQueue([...getQueue(), { cid: cid || newId(), type: 'bill_create', at: Date.now(), ref, body: { customer, items: items.map(({ id, qty }) => ({ id, qty })), sold_at: nowLocal() }, total }]);
  scheduleSync(300);
  return { ref, total };
}

// Try to do something on the server right now. Returns { d } when it worked, { queued: true } when the caller
// should save it on this device instead (no internet, or older entries are still waiting and must go first).
// Real refusals from the server (wrong data) are thrown so the user sees them straight away.
export async function tryNow(action, body, cid) {
  if (!netUp || getQueue().some(o => o.state !== 'failed')) return { queued: true };
  try { return { d: await apiRef(action, { ...body, client_id: cid }) }; }
  catch (e) { if (e instanceof NetworkError || e.offline) return { queued: true }; throw e; }
}

/* ---------- plain-words description of one waiting entry ---------- */
export function describeOp(o) {
  if (o.type === 'stock_add') return `Added ${o.body.name}, batch ${o.body.batch_no}, ${o.body.qty} unit${o.body.qty === 1 ? '' : 's'}.`;
  if (o.type === 'stock_update') return `Changed ${o.label || 'a medicine'}${o.batch ? ` (batch ${o.batch})` : ''} to ${o.body.qty} unit${o.body.qty === 1 ? '' : 's'}.`;
  if (o.type === 'stock_delete') return `Removed ${o.label || 'a medicine'}${o.batch ? ` (batch ${o.batch})` : ''} from the inventory.`;
  if (o.type === 'bill_create') return `Bill ${o.ref} for ${o.body.customer || 'a walk-in customer'}, ₹${o.total}.`;
  return 'An entry.';
}

/* ---------- sending the outbox ---------- */
const FRIENDLY = [
  [/already in your inventory/i, 'This batch was already in the server inventory, so it was not added a second time.'],
  [/insufficient stock/i, 'There was not enough stock on the server for this bill, so it was not sent.'],
  [/has expired/i, 'A batch in this bill had expired, so the bill was not sent.'],
  [/not found in your inventory/i, 'This medicine batch no longer exists on the server, so the entry could not be applied.'],
  [/please login/i, 'You were signed out, so please sign in again and the waiting entries will be sent.']
];
const whyFailed = msg => (FRIENDLY.find(([re]) => re.test(msg)) || [0, msg.replace(/\s+$/, '').replace(/([^.!?])$/, '$1.')])[1];

let apiRef = null;
export const bindApi = fn => { apiRef = fn; };
export const onSynced = fn => { lastToast = fn; };   // App registers a callback to show "sent" / "needs attention" sentences

export function scheduleSync(ms = 0) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow(); }, ms);
}

export async function syncNow() {
  if (syncing || !apiRef || session.uid == null) return { sent: 0, failed: 0, offline: !netUp };
  const todo = () => getQueue().find(o => o.state !== 'failed');
  if (!todo()) return { sent: 0, failed: 0, offline: false };
  syncing = true; bump();
  let sent = 0, failed = 0, offline = false, auth = false, held = 0;
  const idMap = {};   // device-only id -> real server id, for entries sent in this run
  const mapId = id => (isTemp(id) ? (idMap[id] ?? getQueue().find(o => o.tid === id)?.serverId ?? id) : id);
  try {
    for (;;) {
      const op = todo();
      if (!op) break;
      let body = { ...op.body, client_id: op.cid };
      if (op.type === 'bill_create') {
        body.items = body.items.map(i => ({ ...i, id: mapId(i.id) }));
        if (body.items.some(i => isTemp(i.id))) {   // the batch it sells is itself waiting; it is earlier in the queue so this is rare
          markFailed(op.cid, 'A batch in this bill has not reached the server yet, so the bill was held back.');
          failed++; continue;
        }
      }
      if (op.type === 'stock_update') {
        const real = mapId(body.id);
        if (isTemp(real)) { markFailed(op.cid, 'This batch has not reached the server yet, so the change was held back.'); failed++; continue; }
        body.id = real;
      }
      try {
        const d = await apiRef(op.type, body);
        if (op.type === 'stock_add' && d && d.id) { idMap[op.tid] = d.id; patchQueue(o => o.tid === op.tid ? { ...o, serverId: d.id } : o); }
        setQueue(getQueue().filter(o => o.cid !== op.cid));
        sent++;
        if (Date.now() - op.at > 10000) held++;   // it really waited for the connection
        setNet(true);
        if (lastToast) lastToast({ type: 'sent', op, result: d });
      } catch (e) {
        if (e instanceof NetworkError || e.offline) { offline = true; setNet(false); break; }
        if (/please login/i.test(String(e.message))) { auth = true; if (lastToast) lastToast({ type: 'login' }); break; }   // entries stay saved; nothing is lost
        markFailed(op.cid, whyFailed(String(e.message || 'The server could not accept this entry.')));
        failed++;
        if (lastToast) lastToast({ type: 'failed', op, why: getQueue().find(o => o.cid === op.cid)?.why });
      }
    }
  } finally {
    syncing = false;
    if (!getQueue().some(o => o.state !== 'failed') && !offline) write(keys().synced, Date.now());
    bump();
  }
  if (lastToast && (held > 0 || failed > 0)) lastToast({ type: 'summary', sent, held, failed });
  return { sent, failed, offline, auth };
}

function patchQueue(fn) { setQueue(getQueue().map(fn)); }
function markFailed(cid, why) { patchQueue(o => o.cid === cid ? { ...o, state: 'failed', why } : o); }
export const retryFailed = () => { patchQueue(o => o.state === 'failed' ? { ...o, state: undefined, why: undefined } : o); return syncNow(); };
export const discardOp = cid => {
  const q = getQueue(); const op = q.find(o => o.cid === cid);
  setQueue(q.filter(o => o.cid !== cid));
  // the device copy no longer matches what the user decided; the next refresh from the server fixes it
  if (op) { const s = getStock(); if (s) setStock(s.filter(r => !(op.type === 'stock_add' && r.id === op.tid))); }
};
export const isSyncing = () => syncing;

/* ---------- inventory load: server copy when possible, device copy otherwise ---------- */
// Returns { stock, fromDevice }. Never throws for connection problems.
export async function loadStock() {
  if (getQueue().some(o => o.state !== 'failed')) await syncNow();
  const waiting = getQueue().some(o => o.state !== 'failed');
  if (!waiting) {
    try {
      const d = await apiRef('stock_list', {});
      // entries that failed are shown with the server's real numbers; the problem is listed in the sync panel
      setStock(d.stock); setNet(true);
      return { stock: d.stock, fromDevice: false };
    } catch (e) {
      if (!(e instanceof NetworkError || e.offline)) throw e;
      setNet(false);
    }
  }
  const mine = getStock();
  if (mine) return { stock: mine, fromDevice: true };
  throw new NetworkError();
}

/* ---------- automatic triggers ---------- */
let started = false;
export function startAutoSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => { setNet(true); scheduleSync(500); });
  window.addEventListener('offline', () => setNet(false));
  setInterval(() => { if (getQueue().some(o => o.state !== 'failed')) syncNow(); }, 20000);   // keep trying while entries are waiting
}

/* ---------- local alert calculation (so alerts still work with no internet) ---------- */
const LOW_UNITS = 4;
const WARN_DAYS = 30;
const ymd = s => String(s || '').slice(0, 10);
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayDiff = d => Math.round((new Date(ymd(d) + 'T00:00:00') - new Date(todayYmd() + 'T00:00:00')) / 86400000);

export function localAlerts(stock) {
  const rows = stock || [];
  const per = new Map();
  rows.forEach(r => {
    const k = r.name.toLowerCase();
    const cur = per.get(k) || { name: r.name, qty: 0 };
    if (!r.expiry_date || dayDiff(r.expiry_date) >= 0) cur.qty += r.qty;
    per.set(k, cur);
  });
  const low = [...per.values()].filter(x => x.qty < LOW_UNITS).sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
  const expiring = rows
    .filter(r => r.qty > 0 && r.expiry_date && dayDiff(r.expiry_date) <= WARN_DAYS)
    .sort((a, b) => ymd(a.expiry_date).localeCompare(ymd(b.expiry_date)))
    .map(r => ({ name: r.name, batch_no: r.batch_no, expiry_date: r.expiry_date, qty: r.qty, expired: dayDiff(r.expiry_date) < 0 }));
  return { low, expiring };
}

/* ---------- React hook used by Inventory, Billing and the Dashboard ---------- */
// stock: the rows to show; fromDevice: true while the numbers come from this device; refresh(): sync + fetch;
// local(): re-read the device copy right after a local change.
export function useStock() {
  useOfflineTick();
  const [st, setSt] = useState({ stock: null, fromDevice: false, err: '' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const refresh = useCallback(async () => {
    try { const r = await loadStock(); if (alive.current) setSt({ ...r, err: '' }); }
    catch (e) { if (alive.current) setSt(s => ({ ...s, err: e.message })); }
  }, []);
  const local = useCallback(() => setSt({ stock: getStock() || [], fromDevice: !isOnline() || getQueue().length > 0, err: '' }), []);
  useEffect(() => { refresh(); }, [refresh]);
  // when the last waiting entry has been sent, load the real numbers (and real ids) from the server
  const waiting = getQueue().some(o => o.state !== 'failed');
  const was = useRef(waiting);
  useEffect(() => { if (was.current && !waiting) refresh(); was.current = waiting; }, [waiting, refresh]);
  // coming back online with nothing waiting: refresh once
  const up = isOnline(); const wasUp = useRef(up);
  useEffect(() => { if (!wasUp.current && up && !waiting) refresh(); wasUp.current = up; }, [up, waiting, refresh]);
  return { ...st, refresh, local };
}
