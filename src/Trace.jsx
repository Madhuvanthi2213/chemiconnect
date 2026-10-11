import { useState, useEffect, useRef, useCallback } from 'react';
import {
  QrCode, ScanLine, Camera, CameraOff, Search, Factory, Truck, Building2, PackageCheck, ArrowRightLeft,
  ReceiptText, Pill, Printer, ShieldCheck, AlertTriangle, MapPin, X, Plus, Clock, WifiOff
} from 'lucide-react';
import { NetworkError, useOfflineTick, isOnline } from './offline.js';
import { qrSvg } from './qr.js';
import * as ex from './explain.js';

/* ---------------------------------------------------------------------------------------------
 * Scan QR  -  follow one medicine batch from manufacturing to expiry.
 *   Scan tab      : camera (or typed batch number) -> the full journey of the batch, where it is now, and its expiry status.
 *   QR labels tab : a QR label for every batch in the inventory (PHC Pharma) / every batch registered or issued (District Main PHC).
 *   Register tab  : District Main PHC only - register a batch received from the manufacturer; this is where the journey starts.
 * The QR holds a link  <this site>/?trace=<TOKEN>  so a phone's own camera app also opens the journey after sign in.
 * --------------------------------------------------------------------------------------------- */

const qrLink = token => `${window.location.origin}/?trace=${token}`;
const fmtDate = d => {
  if (!d) return '—';
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return isNaN(x) ? '—' : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtTime = d => {
  if (!d) return '';
  const x = new Date(String(d).replace(' ', 'T'));
  return isNaN(x) ? '' : x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const units = n => `${n} unit${n === 1 ? '' : 's'}`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const roleName = r => (r === 'wholesaler' ? 'District Main PHC' : 'PHC Pharma');
const EXPIRY_WARN = 30; // same as EXPIRY_WARN_DAYS in backend/api.php

function QR({ text, size = 140 }) {
  let svg = '';
  try { svg = qrSvg(text, { size, margin: 2 }); } catch { svg = ''; }
  return <span className="qr-box" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/* ---------- reading a QR from the camera or from a photo ---------- */
async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : null;
      if (!formats || formats.includes('qr_code')) {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async src => { const r = await bd.detect(src); return r.length ? r[0].rawValue : null; };
      }
    } catch { /* use the built-in reader below */ }
  }
  // browsers without BarcodeDetector (iPhone Safari, Firefox): jsQR reads the camera picture
  const jsQR = (await import('jsqr')).default;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return async src => {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return null;
    const k = Math.min(1, 800 / Math.max(w, h));
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    return r ? r.data : null;
  };
}

function Scanner({ onCode, onClose }) {
  const videoRef = useRef(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [msg, setMsg] = useState('Starting the camera…');

  useEffect(() => {
    let stop = false, stream = null, raf = 0, last = 0;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMsg('The camera cannot be used here. It needs https or localhost, so please type the batch number below instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        setMsg(e && e.name === 'NotAllowedError'
          ? 'Camera permission was refused, so please allow the camera for this site, or type the batch number below.'
          : 'The camera could not be opened, so please type the batch number below instead.');
        return;
      }
      if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      try { await v.play(); } catch { /* the user can tap the picture */ }
      let detect;
      try { detect = await makeDetector(); } catch { setMsg('The QR reader could not start, so please type the batch number below.'); return; }
      setMsg('Hold the QR code on the medicine pack inside the square.');
      const tick = async t => {
        if (stop) return;
        if (t - last > 220 && v.readyState >= 2) {
          last = t;
          try {
            const code = await detect(v);
            if (code && !stop) { stop = true; cb.current(code); return; }
          } catch { /* keep looking */ }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { stop = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);

  return (
    <div className="scan-cam">
      <div className="scan-frame">
        <video ref={videoRef} muted playsInline />
        <div className="scan-aim"><ScanLine size={28} /></div>
      </div>
      <p className="sub" style={{ margin: '10px 0' }}>{msg}</p>
      <button className="btn g s" onClick={onClose}><CameraOff size={14} /> Stop camera</button>
    </div>
  );
}

/* ---------- the journey of one batch ---------- */
const STEP = {
  manufactured: { icon: Factory, tone: 'blue', title: 'Manufactured' },
  received: { icon: Building2, tone: 'blue', title: 'Received at District Main PHC' },
  issued: { icon: Truck, tone: 'blue', title: 'Issued to a PHC Pharma' },
  transferred: { icon: ArrowRightLeft, tone: 'blue', title: 'Moved between PHC Pharmas' },
  stocked: { icon: PackageCheck, tone: 'green', title: 'In PHC Pharma inventory' },
  dispensed: { icon: ReceiptText, tone: 'green', title: 'Given out to patients' }
};

function stepText(e, batch) {
  const from = e.from ? e.from.name : '', to = e.to ? e.to.name : '';
  switch (e.kind) {
    case 'manufactured': return batch.manufacturer ? `Made by ${batch.manufacturer}.` : (e.note || '');
    case 'received': return `${to || 'The District Main PHC'} received ${units(e.qty)}.${e.note ? ' ' + e.note + '.' : ''}`;
    case 'issued': return `${from} issued ${units(e.qty)} to ${to}.${e.note ? ' (' + e.note + ')' : ''}`;
    case 'transferred': return `${from} gave ${units(e.qty)} to ${to}.${e.note ? ' (' + e.note + ')' : ''}`;
    case 'stocked': return `${to}: ${e.note || 'added to inventory'}${e.qty > 0 ? `, ${units(e.qty)}` : ''}.`;
    case 'dispensed': return `${from} gave out ${units(e.qty)}${e.count > 1 ? ` in ${e.count} bills` : (e.note ? ` (${e.note})` : '')}.`;
    default: return e.note || '';
  }
}

function expiryInfo(b) {
  const d = b.days_left;
  if (d === null || d === undefined) return { tone: 'blue', head: 'No expiry date on record', body: 'This batch has no expiry date saved, so check the pack.' };
  if (d < 0) return { tone: 'red', head: `Expired ${-d} day${d === -1 ? '' : 's'} ago`, body: 'Do not give this medicine to any patient. Set it aside for safe disposal.' };
  if (d === 0) return { tone: 'amber', head: 'Expires today', body: 'Give it out first, or set it aside before the day ends.' };
  if (d <= EXPIRY_WARN) return { tone: 'amber', head: `Expires in ${d} day${d === 1 ? '' : 's'}`, body: 'Still safe to give out. Use it before newer batches.' };
  return { tone: 'green', head: 'Within its expiry date', body: `${d} days left, about ${Math.max(1, Math.round(d / 30))} month${Math.round(d / 30) <= 1 ? '' : 's'}.` };
}

function Journey({ t, say }) {
  const { batch, events, holders, totals } = t;
  const exp = expiryInfo(batch);
  const hasMaker = events.some(e => e.kind === 'manufactured');
  const expired = batch.days_left !== null && batch.days_left < 0;
  const ExpIcon = exp.tone === 'green' ? ShieldCheck : AlertTriangle;

  const stats = [
    ['Received at warehouse', totals.received, Building2, 'blue'],
    ['Issued to PHC Pharmas', totals.issued, Truck, 'amber'],
    ['Given to patients', totals.dispensed, ReceiptText, 'green'],
    ['In stock now', totals.in_stock, PackageCheck, totals.in_stock > 0 ? 'blue' : 'red']
  ];

  return (
    <>
      <div className="card trace-head">
        <QR text={qrLink(batch.token)} size={120} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ margin: '0 0 4px' }}><Pill size={18} style={{ verticalAlign: -3 }} /> {batch.name} {batch.free && <span className="tag green" style={{ marginLeft: 6 }}>FREE</span>}</h3>
          <div className="trace-meta">
            <span><small>Batch</small><b>{batch.batch_no || '—'}</b></span>
            <span><small>Manufactured</small><b>{fmtDate(batch.mfg_date)}</b></span>
            <span><small>Expiry</small><b>{fmtDate(batch.expiry_date)}</b></span>
            <span><small>Manufacturer</small><b>{batch.manufacturer || '—'}</b></span>
          </div>
          <div className="why" style={{ marginTop: 8 }}>Code {batch.token}</div>
        </div>
        <button className="btn g s no-print" onClick={() => printLabels([batch])}><Printer size={14} /> Print label</button>
      </div>

      <div className={'alert' + (exp.tone === 'red' ? ' danger' : '') + (exp.tone === 'green' ? ' good' : '')} style={{ justifyContent: 'flex-start', gap: 12 }}>
        <ExpIcon size={22} style={{ flexShrink: 0 }} />
        <div><b>{exp.head}</b><br />{exp.body}</div>
      </div>

      <div className="stats">
        {stats.map(([label, n, Icon, tone]) => (
          <div key={label} className="card stat">
            <div className={`stat-icon ${tone}`}><Icon size={22} /></div>
            <div className="stat-content"><small>{label}</small><b>{n}</b></div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <b style={{ fontSize: 16 }}>Journey: manufacturing to expiry</b>
        <ol className="tl">
          {!hasMaker && (
            <li className="tl-item ghost">
              <span className="tl-dot"><Factory size={14} /></span>
              <div><b>Manufacturing</b><div className="why">The manufacturer and manufacturing date of this batch have not been recorded yet. A District Main PHC adds them when it registers the batch.</div></div>
            </li>
          )}
          {events.map((e, i) => {
            const s = STEP[e.kind] || { icon: Clock, tone: 'blue', title: e.kind };
            const Icon = s.icon;
            return (
              <li key={i} className="tl-item">
                <span className={`tl-dot ${s.tone}`}><Icon size={14} /></span>
                <div>
                  <b>{s.title}</b> <span className="why">· {e.kind === 'manufactured' ? fmtDate(e.at) : fmtTime(e.at)}</span>
                  <div>{stepText(e, batch)}</div>
                  {(e.from || e.to) && e.kind !== 'dispensed' && e.kind !== 'stocked' && (
                    <div className="why">{[e.from && `${roleName(e.from.role)}${e.from.district ? ', ' + e.from.district : ''}`, e.to && `${roleName(e.to.role)}${e.to.district ? ', ' + e.to.district : ''}`].filter(Boolean).join('  →  ')}</div>
                  )}
                </div>
              </li>
            );
          })}
          <li className="tl-item end">
            <span className={`tl-dot ${exp.tone}`}><Clock size={14} /></span>
            <div>
              <b>{expired ? 'Expired' : 'Expiry'}</b> <span className="why">· {fmtDate(batch.expiry_date)}</span>
              <div>{exp.head}.</div>
            </div>
          </li>
        </ol>
      </div>

      <div className="card">
        <b style={{ fontSize: 16 }}>Where it is now</b>
        {holders.length === 0 ? (
          <p className="sub" style={{ margin: '10px 0 0' }}>No PHC Pharma has units of this batch in its inventory right now.</p>
        ) : (
          <table>
            <thead><tr><th>PHC Pharma</th><th>District</th><th className="num">Units</th></tr></thead>
            <tbody>
              {holders.map((h, i) => (
                <tr key={i}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MapPin size={14} /> <b>{h.name}</b></div></td>
                  <td>{h.district || h.city || '—'}</td>
                  <td className="num"><b>{h.qty}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- printing QR labels ---------- */
function printLabels(list) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = list.map(b => {
    let svg = '';
    try { svg = qrSvg(qrLink(b.token), { size: 110, margin: 1 }); } catch { /* skip */ }
    return `<div class="l">${svg}<div class="t"><b>${esc(b.name)}</b>Batch ${esc(b.batch_no || '—')}<br>Exp ${esc(fmtDate(b.expiry_date))}<br><small>${esc(b.token)}</small></div></div>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Medicine QR labels</title><style>
    body{font-family:Arial,Helvetica,sans-serif;margin:12px}
    .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
    .l{display:flex;gap:8px;align-items:center;border:1px dashed #94a3b8;border-radius:6px;padding:6px;break-inside:avoid}
    .l svg{flex:none}.t{font-size:12px;line-height:1.35}.t b{display:block;font-size:13px}.t small{color:#475569}
    h4{margin:0 0 8px}@media print{h4{display:none}}
  </style></head><body><h4>${list.length} label${list.length === 1 ? '' : 's'} - use your browser's Print</h4><div class="g">${body}</div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* the page stays open for manual printing */ } }, 400);
  return true;
}

function Labels({ call, role, say, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [s, setS] = useState('');
  useOfflineTick();
  const up = isOnline();
  const load = useCallback(() => call('trace_list', {}).then(d => { setRows(d.batches); setErr(''); }).catch(e => setErr(e instanceof NetworkError ? 'offline' : e.message)), [call]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (up && err === 'offline') load(); }, [up]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err === 'offline') return <div className="alert"><div><b><WifiOff size={16} style={{ verticalAlign: -3 }} /> You are offline</b><br />{ex.needsInternet()}</div></div>;
  if (err) return <div className="alert danger"><div><b>Something went wrong</b><br />{ex.plain(err)}</div></div>;
  if (!rows) return <p className="sub">Loading…</p>;

  const needle = s.trim().toLowerCase();
  const list = rows.filter(r => !needle || r.name.toLowerCase().includes(needle) || (r.batch_no || '').toLowerCase().includes(needle));
  const doPrint = items => { if (!printLabels(items)) say('Error: The label page was blocked by the browser, so please allow pop-ups for this site and try again.'); };
  const pharma = role === 'pharmacy';

  return (
    <div className="card">
      <div className="row">
        <div>
          <b style={{ fontSize: 16 }}>QR labels</b>
          <div className="why">{pharma ? 'One QR for every batch in your inventory. Stick it on the pack or shelf, and anyone can scan it to see the batch journey.' : 'Batches you registered or issued. Print the label and stick it on the carton.'}</div>
        </div>
        <button className="btn s no-print" disabled={!list.length} onClick={() => doPrint(list.slice(0, 120))}><Printer size={14} /> Print {list.length > 120 ? 'first 120' : list.length === rows.length ? 'all' : 'these'}</button>
      </div>
      <div className="top-search" style={{ marginBottom: 12, maxWidth: 360 }}>
        <Search className="search-icon" size={18} />
        <input placeholder="Search medicine or batch number" value={s} onChange={e => setS(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <div className="empty-state"><QrCode size={48} /><p>{rows.length ? 'No batch matches your search.' : (pharma ? 'Your inventory has no batches yet. Add a medicine with a batch number first.' : 'No batches yet. Register a batch from the Register tab.')}</p></div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>QR</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">{pharma ? 'In stock' : 'Received / issued'}</th><th></th></tr></thead>
            <tbody>
              {list.map(b => (
                <tr key={b.token}>
                  <td><QR text={qrLink(b.token)} size={56} /></td>
                  <td><b>{b.name}</b></td>
                  <td>{b.batch_no || '—'}</td>
                  <td>{fmtDate(b.expiry_date)}</td>
                  <td className="num">{pharma ? b.qty : `${b.qty_in} / ${b.qty_out}`}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn s g" onClick={() => onOpen(b.token)}><ScanLine size={14} /> Journey</button>{' '}
                    <button className="btn s g" onClick={() => doPrint([b])}><Printer size={14} /> Label</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- District Main PHC: register a batch from the manufacturer ---------- */
function Register({ call, say, onOpen }) {
  const blank = { name: '', batch_no: '', manufacturer: '', mfg_date: '', expiry_date: '', qty: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    if (!f.name.trim() || !f.batch_no.trim() || !f.manufacturer.trim() || !f.mfg_date || !f.expiry_date || f.qty === '')
      return say('Error: Please fill the medicine name, batch number, manufacturer, both dates and the quantity.');
    if (f.expiry_date <= f.mfg_date) return say('Error: The expiry date must come after the manufacturing date, so please check both.');
    if (f.mfg_date > todayStr()) return say('Error: The manufacturing date cannot be in the future, so please correct it.');
    if (+f.qty < 1) return say('Error: The quantity must be at least 1.');
    setBusy(true);
    try {
      const r = await call('trace_register', { ...f, name: f.name.trim(), batch_no: f.batch_no.trim(), manufacturer: f.manufacturer.trim(), qty: +f.qty });
      say(r.existing ? 'This batch was already registered, so the new units were added to its journey.' : 'The batch is registered and its QR code is ready.');
      setDone({ token: r.token, name: f.name.trim(), batch_no: f.batch_no.trim(), expiry_date: f.expiry_date });
      setF(blank);
    } catch (e) { say('Error: ' + (e instanceof NetworkError ? ex.needsInternet() : e.message)); }
    setBusy(false);
  };

  return (
    <div className="card">
      <b style={{ fontSize: 16 }}>Register a batch received from the manufacturer</b>
      <div className="why" style={{ marginBottom: 14 }}>This is where the journey starts. After this, every indent you approve with the same medicine name, batch number and expiry date is added to the same journey.</div>
      {done && (
        <div className="alert good" style={{ justifyContent: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <QR text={qrLink(done.token)} size={96} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <b>{done.name} (batch {done.batch_no}) is ready</b><br />Code {done.token}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn s" onClick={() => printLabels([done])}><Printer size={14} /> Print label</button>
              <button className="btn s g" onClick={() => onOpen(done.token)}><ScanLine size={14} /> See the journey</button>
            </div>
          </div>
        </div>
      )}
      <div className="reg-grid">
        <label className="fld">Medicine name<input value={f.name} onChange={set('name')} placeholder="e.g. Paracetamol 500mg Tablet" /></label>
        <label className="fld">Batch number<input value={f.batch_no} onChange={set('batch_no')} placeholder="From the carton" /></label>
        <label className="fld">Manufacturer<input value={f.manufacturer} onChange={set('manufacturer')} placeholder="Company name" /></label>
        <label className="fld">Quantity received (units)<input type="number" min="1" value={f.qty} onChange={set('qty')} /></label>
        <label className="fld">Manufacturing date<input type="date" max={todayStr()} value={f.mfg_date} onChange={set('mfg_date')} /></label>
        <label className="fld">Expiry date<input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></label>
      </div>
      <button className="btn" disabled={busy} onClick={submit}><Plus size={16} /> {busy ? 'Saving…' : 'Register batch and make QR'}</button>
    </div>
  );
}

/* ---------- the page ---------- */
export default function ScanTrace({ user, say, call, initialToken }) {
  const wholesaler = user.role === 'wholesaler';
  const [tab, setTab] = useState('scan');
  const [cam, setCam] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);       // { trace } or { matches }
  const [err, setErr] = useState('');
  const [recent, setRecent] = useState(() => { try { return JSON.parse(localStorage.getItem('cc:scans:' + user.id) || '[]'); } catch { return []; } });
  const fileRef = useRef(null);
  useOfflineTick();

  const remember = b => {
    setRecent(l => {
      const next = [{ token: b.token, name: b.name, batch_no: b.batch_no }, ...l.filter(x => x.token !== b.token)].slice(0, 8);
      try { localStorage.setItem('cc:scans:' + user.id, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const lookup = useCallback(async code => {
    const c = String(code || '').trim();
    if (!c) return;
    setCam(false); setBusy(true); setErr('');
    try {
      const d = await call('trace_lookup', { code: c });
      setRes(d);
      if (d.trace) remember(d.trace.batch);
    } catch (e) {
      setRes(null);
      setErr(e instanceof NetworkError ? ex.needsInternet() : ex.plain(e.message));
    }
    setBusy(false);
  }, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  // a QR opened from the phone's own camera app arrives as /?trace=TOKEN
  useEffect(() => {
    if (initialToken) {
      lookup(initialToken);
      try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openToken = token => { setTab('scan'); setTyped(''); lookup(token); window.scrollTo(0, 0); };

  const fromPhoto = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const det = await makeDetector();
      const bmp = await createImageBitmap(file);
      const code = await det(bmp);
      if (bmp.close) bmp.close();
      if (!code) { setBusy(false); return setErr('No QR code was found in that photo, so please take a clearer, closer picture.'); }
      setBusy(false);
      lookup(code);
    } catch { setBusy(false); setErr('That photo could not be read, so please try another picture or type the batch number.'); }
  };

  const tabs = [['scan', 'Scan & Track'], ['labels', 'QR Labels'], ...(wholesaler ? [['register', 'Register Batch']] : [])];

  return (
    <>
      <h2 className="t">Scan QR</h2>
      <p className="sub">Scan the QR on a medicine pack to follow that batch from manufacturing, through the District Main PHC and PHC Pharmas, to the patient and its expiry date.</p>
      <div className="tabs">
        {tabs.map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
      </div>

      {tab === 'labels' && <Labels call={call} role={user.role} say={say} onOpen={openToken} />}
      {tab === 'register' && wholesaler && <Register call={call} say={say} onOpen={openToken} />}

      {tab === 'scan' && (
        <>
          <div className="card scan-box" style={{ marginBottom: 24 }}>
            {cam ? (
              <Scanner onCode={lookup} onClose={() => setCam(false)} />
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn" disabled={busy} onClick={() => { setErr(''); setCam(true); }}><Camera size={16} /> Scan with camera</button>
                <button className="btn g" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}><QrCode size={16} /> Read QR from a photo</button>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={fromPhoto} style={{ display: 'none' }} />
              </div>
            )}
            <div className="scan-or"><span>or type</span></div>
            <form onSubmit={e => { e.preventDefault(); lookup(typed); }} style={{ display: 'flex', gap: 10 }}>
              <div className="top-search" style={{ flex: 1, margin: 0 }}>
                <Search className="search-icon" size={18} />
                <input style={{ margin: 0 }} placeholder="Batch number, medicine name or the code under the QR" value={typed} onChange={e => setTyped(e.target.value)} />
              </div>
              <button className="btn" type="submit" disabled={busy || !typed.trim()}>Track</button>
            </form>
            {recent.length > 0 && (
              <div className="recent">
                <small>Recently scanned</small>
                {recent.map(r => <button key={r.token} className="btn s g" onClick={() => lookup(r.token)}>{r.name} · {r.batch_no || '—'}</button>)}
              </div>
            )}
          </div>

          {busy && <p className="sub">Looking up the batch…</p>}
          {err && !busy && <div className="alert danger"><div><b>Could not track this</b><br />{err}</div><button className="btn s g" onClick={() => setErr('')}><X size={14} /></button></div>}

          {res && res.matches && !busy && (
            <div className="card">
              <b style={{ fontSize: 16 }}>{res.matches.length} batches match</b>
              <table>
                <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th></th></tr></thead>
                <tbody>
                  {res.matches.map(m => (
                    <tr key={m.token}>
                      <td><b>{m.name}</b></td><td>{m.batch_no || '—'}</td><td>{fmtDate(m.expiry_date)}</td>
                      <td><button className="btn s" onClick={() => lookup(m.token)}><ScanLine size={14} /> Track</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res && res.trace && !busy && <Journey t={res.trace} say={say} />}
          {!res && !err && !busy && !cam && (
            <div className="empty-state"><QrCode size={48} /><p>Scan a QR code, or type a batch number, to see where that batch has been.</p></div>
          )}
        </>
      )}
    </>
  );
}
