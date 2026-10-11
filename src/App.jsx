import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Pill, Truck, Building2, LayoutDashboard, ReceiptText,
  Package, Search, LogOut, Bell, User, Plus, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Hospital, MapPin,
  LogIn, UserPlus, ShieldCheck, Zap, Mail, Phone, Send, Inbox, FileText, Printer, ChevronDown, ChevronUp,
  Navigation, Locate, RefreshCw, Clock, ArrowRight, Check, WifiOff, Wifi, QrCode
} from 'lucide-react';
import {
  NetworkError, setNet, isOnline, useOfflineTick, useStock, startSession, rememberUser, lastUser, forgetUser, bindApi, onSynced,
  scheduleSync, syncNow, retryFailed, discardOp, getQueue, getDash, setDash, getStock, lastSync, isSyncing, describeOp,
  localAddStock, localSetQty, localDelete, localBill, tryNow, newId, localAlerts, startAutoSync, isTemp
} from './offline.js';
import * as ex from './explain.js';
import ScanTrace from './Trace.jsx';

// a QR scanned with the phone's own camera opens the app at /?trace=TOKEN; the Scan QR page shows that batch after sign in
let pendingTrace = (() => { try { return new URLSearchParams(window.location.search).get('trace') || ''; } catch { return ''; } })();
const AUTO_AT = 1; // stock level that triggers the automatic request (same value as AUTO_AT in backend/api.php)
const TN_DISTRICTS = ['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanyakumari','Karur','Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivagangai','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli','Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Villupuram','Virudhunagar'];
const LOW = 4; // medicines with fewer than 4 units are shown as warnings (same rule is used in the PHP API)

/* ---------- API helper (PHP + MySQL backend, proxied at /api) ---------- */
async function api(action, body = {}) {
  let res, data;
  try {
    res = await fetch('/api/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    setNet(false);
    throw new NetworkError();   // no internet (or the shop server is switched off): callers decide whether to save on the device
  }
  if ([502, 503, 504].includes(res.status)) { setNet(false); throw new NetworkError(); }
  try { data = await res.json(); } catch { throw new Error('The server sent a reply that could not be read, so please try once more.'); }
  setNet(true);
  if (!res.ok || data.error) throw new Error(data.error || 'The request did not work, so please try once more.');
  return data;
}
bindApi(api);

function useApi(action, body = {}) {
  const key = JSON.stringify(body);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useOfflineTick();
  const up = isOnline();
  const load = useCallback(
    () => api(action, JSON.parse(key)).then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message)),
    [action, key]
  );
  useEffect(() => { load(); }, [load]);
  // a page that failed only because there was no internet loads again by itself when the connection returns
  useEffect(() => { if (up && err && /no internet/i.test(err)) load(); }, [up]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload: load };
}

const Tag = ({ c, children, icon: Icon }) => (
  <span className={'tag ' + c}>
    {Icon && <Icon size={14} />} {children}
  </span>
);

const Toasts = ({ list }) => list.length ? (
  <div className="toasts">
    {list.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.err ? <AlertTriangle size={18} /> : <Bell size={18} />} <span>{t.m}</span></div>)}
  </div>
) : null;
const Loading = () => <p className="sub">Loading…</p>;
const ErrBox = ({ m }) => /no internet/i.test(m || '')
  ? <div className="alert"><div><b><WifiOff size={16} style={{ verticalAlign: -3 }} /> You are offline</b><br />{ex.needsInternet()}</div></div>
  : <div className="alert danger"><div><b>Something went wrong</b><br />{ex.plain(m)}</div></div>;
// PHC essential medicines are handed out FREE (same list as FREE_MED_RE in backend/api.php); all other medicines are paid
const FREE_RE = /\b(paracetamol|cetirizine|omeprazole|antacid|amoxicillin|ors|zinc|metformin|amlodipine|salbutamol|folic|povidone|clotrimazole|albendazole)\b|\bvitamin[\s-]*a\b/i;
const isFree = n => FREE_RE.test(String(n || ''));
const day = s => String(s || '').slice(0, 10);
const place = (...p) => p.filter(Boolean).join(', ');
// toast text for automatic low-stock requests returned by the API
// expiry helpers (batch-wise inventory): days left until a YYYY-MM-DD expiry date (negative = already expired)
const EXPIRY_WARN = 30; // same value as EXPIRY_WARN_DAYS in backend/api.php
const daysTo = d => d ? Math.round((new Date(day(d) + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000) : null;
const isExpired = d => d ? daysTo(d) < 0 : false;
const expLabel = d => { const x = new Date(day(d) + 'T00:00:00'); return isNaN(x) ? '—' : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
// unique medicine names (an inventory has one row per batch)
const medNames = stock => [...new Set((stock || []).map(x => x.name))];
// usable (non-expired) units of one medicine across all its batches
const usableOf = (stock, name) => (stock || []).filter(x => x.name.toLowerCase() === name.trim().toLowerCase() && !isExpired(x.expiry_date)).reduce((a, x) => a + x.qty, 0);
// one plain sentence per automatic restock request (returned as a list; say() shows each as its own message)
const autoMsg = (a, skipped) => [
  ...((a || []).map(x => ex.autoSent(x.product, x.to))),
  ...((skipped || []).filter(x => x.why === 'none').map(x => ex.autoNobody(x.product)))
];

/* ---------- App root ---------- */
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking session
  const [down, setDown] = useState('');
  const [toasts, setToasts] = useState([]);
  // every message is ONE plain sentence; a list of sentences is shown as separate messages
  const say = m => {
    (Array.isArray(m) ? m : [m]).filter(Boolean).forEach(x => {
      const err = /^Error:/i.test(x);
      const t = { id: Date.now() + Math.random(), m: err ? ex.plain(x) : x, err };
      setToasts(l => [...l.slice(-3), t]);
      setTimeout(() => setToasts(l => l.filter(y => y.id !== t.id)), err ? 6500 : 5000);
    });
  };

  useEffect(() => {
    startAutoSync();
    api('me').then(d => setUser(d.user)).catch(e => {
      // no internet at start-up: open with the last signed-in user so stock entry and billing still work
      const mine = e instanceof NetworkError ? lastUser() : null;
      if (mine) setUser(mine);
      else { setDown(e.message); setUser(null); }
    });
  }, []);

  // messages about entries that were saved on the device and sent later
  useEffect(() => {
    onSynced(ev => {
      if (ev.type === 'sent' && ev.result) say(autoMsg(ev.result.auto, ev.result.auto_skipped));
      if (ev.type === 'summary') {
        if (ev.held > 0) say(ev.held === 1 ? 'Your saved entry reached the server.' : `Your ${ev.held} saved entries reached the server.`);
        if (ev.failed > 0) say('Error: ' + ex.failedBar(ev.failed));
      }
      if (ev.type === 'login') say('Error: You have been signed out, so please sign in again and your saved entries will be sent.');
    });
    return () => onSynced(null);
  }, []);

  if (user) { startSession(user.id); }   // must be ready before the pages below load their stock
  useEffect(() => { if (user) { rememberUser(user); scheduleSync(1000); } }, [user]);

  const logout = async () => {
    const waiting = getQueue().filter(o => o.state !== 'failed').length;
    if (waiting && !window.confirm(`${waiting === 1 ? '1 entry has' : `${waiting} entries have`} not been sent yet, so it stays saved on this device and is sent after you sign in with the internet on. Sign out now?`)) return;
    try { await api('logout'); } catch { /* ignore */ }
    forgetUser(); setUser(null);
  };

  if (user === undefined) return <div className="boot">Loading ChemiConnect…</div>;

  return (
    <>
      {user
        ? <Shell user={user} out={logout} say={say} />
        : <PublicSite down={down} onLogin={setUser} say={say} />}
      <Toasts list={toasts} />
    </>
  );
}

/* ---------- Public website (navbar + pages + auth) ---------- */

function PublicSite({ down, onLogin, say }) {
  const [pg, setPg] = useState('home');      // home | about | contact | pharmacy | wholesaler
  const [mode, setMode] = useState('login'); // login | signup

  const openAuth = m => { setMode(m); setPg('pharmacy'); window.scrollTo(0, 0); };
  const nav = [['home', 'Home'], ['about', 'About Us'], ['contact', 'Contact']];

  return (
    <>
      <header className="nv">
        <div className="nv-brand" onClick={() => setPg('home')}><Pill size={24} /> ChemiConnect</div>

        <nav className="nv-center">
          {nav.map(([k, l]) => (
            <button key={k} className={'nv-link ' + (pg === k ? 'on' : '')} onClick={() => setPg(k)}>{l}</button>
          ))}
        </nav>

        <div className="nv-right">
          <button className={'nv-ws ' + (pg === 'wholesaler' ? 'on' : '')} onClick={() => { setMode('login'); setPg('wholesaler'); }}>
            <Truck size={16} /> For District Main PHC
          </button>
          <button className="btn-ghost" onClick={() => openAuth('login')}><LogIn size={16} /> Login</button>
          <button className="btn" onClick={() => openAuth('signup')}><UserPlus size={16} /> Sign Up</button>
        </div>
      </header>

      {down && (
        <div className="alert danger" style={{ margin: '16px 32px 0' }}>
          <div><b>No connection</b><br />{down}</div>
        </div>
      )}

      {pg === 'home' && <Home openAuth={openAuth} goWs={() => { setMode('login'); setPg('wholesaler'); }} />}
      {pg === 'about' && <About />}
      {pg === 'contact' && <Contact say={say} />}
      {pg === 'pharmacy' && (
        <AuthPage key="p" role="pharmacy" mode={mode} setMode={setMode} onLogin={onLogin} say={say}
          icon={Hospital} title="PHC Pharma Portal" desc="Track your stock, get low-stock warnings and share medicines with nearby PHC pharmas." />
      )}
      {pg === 'wholesaler' && (
        <AuthPage key="w" role="wholesaler" mode={mode} setMode={setMode} onLogin={onLogin} say={say}
          icon={Truck} title="District Main PHC Hub" desc="List your catalogue, receive PHC pharma orders and indents, and grow your distribution network." />
      )}
    </>
  );
}

function Home({ openAuth, goWs }) {
  const feats = [
    [Package, 'Real-time Stock', 'Track inventory and get low-stock warnings instantly.'],
    [Zap, 'Faster Replenishment', 'Request stock from the District Main PHC and nearby PHC pharmas in a click.'],
    [ShieldCheck, 'Trusted Network', 'Connect only with registered PHC pharmas and District Main PHCs.']
  ];
  return (
    <>
      <section className="home-hero">
        <h1>Smarter Supply Chain.</h1>
        <h2>Connect PHC pharmas and District Main PHCs for real-time stock updates, faster replenishment and better healthcare access.</h2>
        <div className="cta">
          <button className="btn big" onClick={() => openAuth('signup')}>Get Started as PHC Pharma</button>
          <button className="btn-ghost big" onClick={goWs}>I'm a District Main PHC</button>
        </div>
      </section>
      <section className="feats">
        {feats.map(([Icon, t, d]) => (
          <div key={t} className="card feat">
            <div className="stat-icon blue"><Icon size={24} /></div>
            <b>{t}</b><p className="sub">{d}</p>
          </div>
        ))}
      </section>
    </>
  );
}

function About() {
  return (
    <section className="page">
      <h1 className="t big-t">About Us</h1>
      <p className="sub lead">ChemiConnect is a B2B pharmaceutical platform that connects PHC pharmas with each other and with the District Main PHC.</p>
      <div className="card">
        <p>PHC pharmas often run out of essential medicines because stock updates and reorders are slow. ChemiConnect warns you when a medicine is running low, lets you request it from nearby PHC pharmas that have it, and gives the District Main PHC a clear view of incoming orders and indents.</p>
        <p style={{ marginBottom: 0 }}>Our goal: faster replenishment, fewer stock-outs and better healthcare access for everyone.</p>
      </div>
    </section>
  );
}

function Contact({ say }) {
  const [n, setN] = useState(''); const [e, setE] = useState(''); const [m, setM] = useState('');
  const send = async () => {
    if (!n || !e || !m) return say('Error: Please fill all fields');
    try {
      await api('contact', { name: n, email: e, message: m });
      setN(''); setE(''); setM(''); say('Message sent. We will get back to you soon.');
    } catch (err) { say('Error: ' + err.message); }
  };
  return (
    <section className="page">
      <h1 className="t big-t">Contact Us</h1>
      <p className="sub lead">Questions about ChemiConnect? Send us a message.</p>
      <div className="card">
        <div className="contact-info">
          <span><Mail size={16} /> support@chemiconnect.in</span>
          <span><Phone size={16} /> +91 00000 00000</span>
        </div>
        <input placeholder="Your Name" value={n} onChange={x => setN(x.target.value)} />
        <input placeholder="Email" value={e} onChange={x => setE(x.target.value)} />
        <textarea placeholder="Message" rows={4} value={m} onChange={x => setM(x.target.value)} />
        <button className="btn w" onClick={send}>Send Message</button>
      </div>
    </section>
  );
}

function AuthPage({ role, mode, setMode, onLogin, say, icon: Icon, title, desc }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', address: '', area: '', city: '', state: '', pincode: '', district: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';
  const label = role === 'pharmacy' ? 'PHC Pharma' : 'District Main PHC';
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    const email = f.email.trim().toLowerCase();
    if (!email || !f.pw) return say('Error: Enter email and password');
    if (!isLogin) {
      if (!f.name.trim()) return say(`Error: Enter the ${label} name`);
      if (!f.address.trim() || !f.area.trim() || !f.city.trim() || !f.state.trim()) return say('Error: Enter your full address (street, area, city and state)');
      if (!f.district) return say('Error: Select your district');
      if (!/^\d{6}$/.test(f.pincode.trim())) return say('Error: Enter a valid 6-digit pincode');
      if (f.pw.length < 6) return say('Error: Password must be at least 6 characters');
      if (f.pw !== f.pw2) return say('Error: Passwords do not match');
    }
    setBusy(true);
    try {
      const d = isLogin
        ? await api('login', { role, email, password: f.pw })
        : await api('signup', {
            role, name: f.name, email, phone: f.phone, address: f.address, area: f.area,
            city: f.city, state: f.state, district: f.district, pincode: f.pincode.trim(), password: f.pw
          });
      onLogin(d.user);
    } catch (err) {
      say('Error: ' + err.message);
      setBusy(false);
    }
  };

  const switchMode = m => { setMode(m); setF({ ...f, pw: '', pw2: '' }); };

  return (
    <div className="login">
      <div className="hero">
        <div className="stat-icon blue" style={{ marginBottom: 16 }}><Icon size={26} /></div>
        <h1>{title}</h1>
        <h2>{desc}</h2>
      </div>
      <form className="card lc" onSubmit={submit}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button type="button" className={isLogin ? 'on' : ''} onClick={() => switchMode('login')}>Login</button>
          <button type="button" className={!isLogin ? 'on' : ''} onClick={() => switchMode('signup')}>Sign Up</button>
        </div>
        <h2 className="t">{isLogin ? `${title} Login` : `Create ${label} Account`}</h2>
        <p className="sub">{isLogin ? 'Welcome back! Sign in to your dashboard.' : 'Register to start using ChemiConnect.'}</p>

        {!isLogin && <input placeholder={label + ' Name'} value={f.name} onChange={set('name')} />}
        {!isLogin && <input placeholder="Phone" value={f.phone} onChange={set('phone')} />}
        {!isLogin && <input placeholder="Full address (door no., street, landmark)" value={f.address} onChange={set('address')} />}
        {!isLogin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <input placeholder="Area / Locality" value={f.area} onChange={set('area')} />
            <input placeholder="City" value={f.city} onChange={set('city')} />
          </div>
        )}
        {!isLogin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <input placeholder="State" value={f.state} onChange={set('state')} />
            <input placeholder="Pincode" inputMode="numeric" maxLength={6} value={f.pincode}
              onChange={e => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} />
          </div>
        )}
        {!isLogin && (
          <select value={f.district} onChange={set('district')}>
            <option value="">{role === 'pharmacy' ? 'Select your district' : 'Select the district this account serves'}</option>
            {TN_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <input type="email" placeholder="Work Email" value={f.email} onChange={set('email')} />
        <input type="password" placeholder="Password" value={f.pw} onChange={set('pw')} />
        {!isLogin && <input type="password" placeholder="Confirm Password" value={f.pw2} onChange={set('pw2')} />}

        <button className="btn w" type="submit" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Please wait…' : isLogin ? 'Sign In to Dashboard' : 'Create Account'}
        </button>
        <p className="sub switch">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <a onClick={() => switchMode(isLogin ? 'signup' : 'login')}>{isLogin ? 'Sign Up' : 'Login'}</a>
        </p>
      </form>
    </div>
  );
}

/* ---------- Logged-in shell ---------- */

// Scan QR page. Defined once here (not inside Shell) so typing in the top search box never restarts the camera.
// The batch from a ?trace= link is used once, the first time this page opens after sign in.
function ScanPage(props) {
  const [tok] = useState(() => { const t = pendingTrace; pendingTrace = ''; return t; });
  return <ScanTrace {...props} call={api} initialToken={tok} />;
}

const MENU = {
  pharmacy: [
    { n: 'Dashboard', i: LayoutDashboard },
    { n: 'Nearby Map', i: MapPin },
    { n: 'Scan QR', i: QrCode },
    { n: 'Inventory', i: Package },
    { n: 'Network', i: Building2 },
    { n: 'Requests', i: Truck },
    { n: 'Indent', i: FileText },
    { n: 'Billing POS', i: ReceiptText }
  ],
  wholesaler: [
    { n: 'Dashboard', i: LayoutDashboard },
    { n: 'Nearby Map', i: MapPin },
    { n: 'Scan QR', i: QrCode },
    { n: 'Catalogue', i: Pill },
    { n: 'Orders', i: ReceiptText },
    { n: 'PHC Pharmas', i: Building2 }
  ]
};

/* ---------- Connection bar: tells the pharmacist, in one sentence, what is happening with saving and sending ---------- */
function ConnBar({ role }) {
  useOfflineTick();
  const [open, setOpen] = useState(false);
  const online = isOnline();
  const q = role === 'pharmacy' ? getQueue() : [];
  const waiting = q.filter(o => o.state !== 'failed');
  const failed = q.filter(o => o.state === 'failed');
  const busy = isSyncing();
  if (online && !waiting.length && !failed.length) return null;

  let tone = 'amber', Icon = WifiOff, text = ex.offlineBar();
  if (online && busy) { tone = 'blue'; Icon = RefreshCw; text = ex.sendingBar(); }
  else if (online && failed.length) { tone = 'red'; Icon = AlertTriangle; text = ex.failedBar(failed.length); }
  else if (online && waiting.length) { tone = 'blue'; Icon = Wifi; text = ex.waitingBar(waiting.length); }
  else if (!online && waiting.length) text = ex.waitingBar(waiting.length) + ' ' + '';
  const ls = lastSync();

  return (
    <div className={'conn ' + tone}>
      <div className="conn-row">
        <Icon size={18} className={busy ? 'spin' : ''} />
        <span className="conn-text">{text.trim()}</span>
        {(waiting.length > 0 || failed.length > 0) && role === 'pharmacy' && (
          <button className="btn s g" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'See entries'}</button>
        )}
        {waiting.length > 0 && (
          <button className="btn s" disabled={busy} onClick={() => syncNow()}><RefreshCw size={14} /> Send now</button>
        )}
      </div>
      {open && (
        <div className="conn-list">
          {q.map(o => (
            <div key={o.cid} className="conn-item">
              <div>
                <b>{describeOp(o)}</b>
                <div className="why">{o.state === 'failed' ? o.why : ex.notSentYet()}</div>
              </div>
              {o.state === 'failed' && <button className="btn s no" onClick={() => discardOp(o.cid)}><Trash2 size={13} /> Remove</button>}
            </div>
          ))}
          {failed.length > 0 && <button className="btn s" onClick={() => retryFailed()}><RefreshCw size={14} /> Try the refused entries again</button>}
          {ls && <div className="why" style={{ marginTop: 8 }}>{`The server last confirmed everything at ${new Date(ls).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`}</div>}
        </div>
      )}
    </div>
  );
}

function Shell({ user, out, say }) {
  const [pg, setPg] = useState(pendingTrace ? 'Scan QR' : 'Dashboard');
  const [q, setQ] = useState('');
  const role = user.role;

  const P = {
    pharmacy: {
      Dashboard: PDash,
      'Nearby Map': (props) => <div className="page" style={{ padding: 0 }}><NearbyPharmacyMap {...props} standalone /></div>,
      'Scan QR': ScanPage,
      'Billing POS': Billing,
      Inventory: Stock,
      Network: Nearby,
      Requests: PReqs,
      Indent: Indent
    },
    wholesaler: {
      Dashboard: WDash,
      'Nearby Map': (props) => <div className="page" style={{ padding: 0 }}><NearbyPharmacyMap {...props} standalone /></div>,
      'Scan QR': ScanPage,
      Catalogue: Products,
      Orders: Orders,
      'PHC Pharmas': Pharmacies
    }
  }[role][pg] || (() => null);

  return (
    <div className="app">
      <div className="sb">
        <h3><Pill /> ChemiConnect</h3>
        <div style={{ flex: 1, marginTop: 24 }}>
          {MENU[role].map(m => (
            <a key={m.n} className={pg === m.n ? 'on' : ''} onClick={() => setPg(m.n)}>
              <m.i size={18} /> <span>{m.n}</span>
            </a>
          ))}
        </div>
        <a onClick={out} style={{ color: 'var(--sidebar-text)' }}>
          <LogOut size={18} /> <span>Sign Out</span>
        </a>
      </div>

      <div className="main">
        <div className="top">
          <div className="top-search">
            <Search className="search-icon" size={18} />
            <input placeholder="Search platform..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="usr">
            <div>
              <b style={{ color: 'var(--text-main)' }}>{user.name}</b><br />
              <span className="sub" style={{ fontSize: 12, margin: 0 }}>{role === 'pharmacy' ? 'PHC Pharma' : 'District Main PHC'}</span>
            </div>
            <div className="usr-avatar"><User size={20} /></div>
          </div>
        </div>

        <ConnBar role={role} />
        <P key={pg} q={q} go={setPg} say={say} user={user} />
      </div>
    </div>
  );
}

/* ---------- Nearby Pharmacy & Wholesaler Map Component ---------- */

function NearbyPharmacyMap({ user, say, go, standalone }) {
  const initialLat = (user && user.latitude) ? parseFloat(user.latitude) : 13.0827;
  const initialLng = (user && user.longitude) ? parseFloat(user.longitude) : 80.2707;
  const [coords, setCoords] = useState({ lat: initialLat, lng: initialLng });
  const [geoState, setGeoState] = useState({
    status: (user && user.latitude) ? 'saved' : 'idle',
    message: (user && user.latitude) ? 'Using registered location coordinates' : 'Location not yet detected'
  });

  const [product, setProduct] = useState('');
  const [debouncedProduct, setDebouncedProduct] = useState('');
  const [qty, setQty] = useState(1);
  const [radius, setRadius] = useState(25);
  const [roleFilter, setRoleFilter] = useState('pharmacy');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState([]);
  const [searchingAddr, setSearchingAddr] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);

  const [suggestions, setSuggestions] = useState([]);

  const [suppliers, setSuppliers] = useState([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliersErr, setSuppliersErr] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const [routeInfo, setRouteInfo] = useState(null);
  const [routingLoading, setRoutingLoading] = useState(false);

  const [reqModal, setReqModal] = useState({
    open: false,
    supplier: null,
    product: '',
    qty: 1,
    busy: false
  });

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const userMarkerRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedProduct(product.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [product]);

  useEffect(() => {
    if (!product.trim() || product.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    api('medicines_search', { q: product.trim() })
      .then(d => {
        if (active && d && d.medicines) setSuggestions(d.medicines);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [product]);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoState({ status: 'error', message: 'Geolocation is not supported by your browser.' });
      return;
    }
    setGeoState({ status: 'loading', message: 'Detecting GPS coordinates…' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCoords = {
          lat: parseFloat(pos.coords.latitude.toFixed(6)),
          lng: parseFloat(pos.coords.longitude.toFixed(6))
        };
        setCoords(newCoords);
        setGeoState({ status: 'success', message: 'GPS location detected successfully.' });
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([newCoords.lat, newCoords.lng], 13);
        }
      },
      (err) => {
        let msg = 'Location access failed.';
        if (err.code === 1) msg = 'Location permission denied. You can search your address or use registered location.';
        else if (err.code === 2) msg = 'Position unavailable. Check your network or GPS.';
        else if (err.code === 3) msg = 'Location request timed out.';
        setGeoState({ status: 'denied', message: msg });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    if (!user || !user.latitude) {
      detectLocation();
    }
  }, [detectLocation, user]);

  const saveAsMyPharmaLocation = async () => {
    setSavingLocation(true);
    try {
      await api('user_update_location', { lat: coords.lat, lng: coords.lng });
      say('Location saved successfully as your pharmacy coordinates.');
      setGeoState({ status: 'saved', message: 'Saved as your pharmacy coordinates' });
    } catch (e) {
      say('Error saving location: ' + e.message);
    } finally {
      setSavingLocation(false);
    }
  };

  const handleAddressSearch = async (e) => {
    e.preventDefault();
    if (!addressSearch.trim()) return;
    setSearchingAddr(true);
    try {
      const q = encodeURIComponent(addressSearch.trim() + ', Tamil Nadu, India');
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${q}`);
      const data = await res.json();
      setAddressResults(data || []);
      if (!data || data.length === 0) {
        say('No locations found for this address. Try another area.');
      }
    } catch (err) {
      say('Could not search address: ' + err.message);
    } finally {
      setSearchingAddr(false);
    }
  };

  const selectAddressResult = (item) => {
    const lat = parseFloat(parseFloat(item.lat).toFixed(6));
    const lng = parseFloat(parseFloat(item.lon).toFixed(6));
    setCoords({ lat, lng });
    setGeoState({ status: 'success', message: `Location set: ${item.display_name.slice(0, 40)}…` });
    setAddressResults([]);
    setAddressSearch('');
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 13);
    }
  };

  const fetchSuppliers = useCallback(() => {
    setLoadingSuppliers(true);
    setSuppliersErr('');
    api('nearby_suppliers', {
      lat: coords.lat,
      lng: coords.lng,
      radius,
      product: debouncedProduct,
      qty,
      role_filter: roleFilter
    })
      .then((data) => {
        setSuppliers(data.suppliers || []);
      })
      .catch((err) => {
        setSuppliersErr(err.message);
      })
      .finally(() => {
        setLoadingSuppliers(false);
      });
  }, [coords.lat, coords.lng, radius, debouncedProduct, qty, roleFilter]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!window.L) {
      console.warn('Leaflet (window.L) is not yet available.');
      return;
    }

    if (!mapInstanceRef.current) {
      const map = window.L.map(mapContainerRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 12,
        zoomControl: true
      });

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      markersLayerRef.current = window.L.layerGroup().addTo(map);
      routeLayerRef.current = window.L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const map = mapInstanceRef.current;

    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
    }

    const userIcon = window.L.divIcon({
      className: 'user-marker-wrap',
      html: '<div class="pulse-user-marker" title="Your Current Location"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    userMarkerRef.current = window.L.marker([coords.lat, coords.lng], { icon: userIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<b>Your Location</b><br/><span style="font-size:12px;color:#64748b">${user?.name || 'Staff'}<br/>${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}</span>`);
  }, [coords.lat, coords.lng, user?.name]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !window.L) return;
    const layer = markersLayerRef.current;
    layer.clearLayers();

    const displayList = onlyInStock ? suppliers.filter(s => s.has_sufficient_stock) : suppliers;

    displayList.forEach((s) => {
      if (!s.latitude || !s.longitude) return;

      const isWholesaler = s.role === 'wholesaler';
      const hasStock = s.has_stock;
      const isSelected = selectedSupplier?.id === s.id;

      let bgColor = '#10b981';
      if (isWholesaler) {
        bgColor = '#6366f1';
      } else if (!hasStock) {
        bgColor = '#ef4444';
      } else if (!s.has_sufficient_stock) {
        bgColor = '#f59e0b';
      }

      const iconHtml = `
        <div class="custom-pin" style="background: ${bgColor}; width: ${isSelected ? 36 : 30}px; height: ${isSelected ? 36 : 30}px; font-size: ${isSelected ? 16 : 14}px;">
          ${isWholesaler ? '🚚' : '💊'}
        </div>
      `;

      const markerIcon = window.L.divIcon({
        className: 'supplier-pin-icon',
        html: iconHtml,
        iconSize: [isSelected ? 36 : 30, isSelected ? 36 : 30],
        iconAnchor: [isSelected ? 18 : 15, isSelected ? 18 : 15]
      });

      const marker = window.L.marker([s.latitude, s.longitude], { icon: markerIcon });

      const popupHtml = `
        <div style="font-family: inherit; font-size: 13px; min-width: 180px;">
          <b style="font-size: 14px; color: #0f172a;">${s.name}</b>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${s.type_label} · ${s.distance_km} km away</div>
          <div style="font-size: 12px; margin-bottom: 6px;">${place(s.address, s.area, s.city)}</div>
          <div style="margin-bottom: 8px;">
            ${isWholesaler
              ? (s.wholesaler_listed ? `<span style="color:#10b981;font-weight:600">Listed: ₹${s.wholesaler_price}</span>` : `<span style="color:#f59e0b">Not listed in catalogue</span>`)
              : (hasStock ? `<span style="color:#10b981;font-weight:600">${debouncedProduct ? `${s.available_stock} units in stock` : 'Stock available'}</span>` : `<span style="color:#ef4444;font-weight:600">Out of stock</span>`)
            }
          </div>
          <button id="pop-select-${s.id}" style="width:100%; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">
            Select &amp; Route
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('popupopen', () => {
        const btn = document.getElementById(`pop-select-${s.id}`);
        if (btn) {
          btn.onclick = () => selectSupplier(s);
        }
      });

      marker.on('click', () => {
        selectSupplier(s);
      });

      layer.addLayer(marker);
    });
  }, [suppliers, onlyInStock, selectedSupplier, debouncedProduct]);

  const selectSupplier = async (supplier) => {
    setSelectedSupplier(supplier);
    if (!mapInstanceRef.current || !routeLayerRef.current || !window.L) return;

    const layer = routeLayerRef.current;
    layer.clearLayers();
    setRoutingLoading(true);

    const fromLat = coords.lat;
    const fromLng = coords.lng;
    const toLat = supplier.latitude;
    const toLng = supplier.longitude;

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();

      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const distKm = (route.distance / 1000).toFixed(1);
        const durMin = Math.max(1, Math.round(route.duration / 60));
        const polyCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        const polyline = window.L.polyline(polyCoords, {
          color: '#2563eb',
          weight: 5,
          opacity: 0.85,
          lineJoin: 'round'
        }).addTo(layer);

        setRouteInfo({
          distanceKm: distKm,
          durationMin: durMin,
          isDirectFallback: false
        });

        mapInstanceRef.current.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      } else {
        throw new Error('No driving route found');
      }
    } catch (e) {
      const dist = supplier.distance_km;
      const polyline = window.L.polyline([[fromLat, fromLng], [toLat, toLng]], {
        color: '#f59e0b',
        weight: 3,
        opacity: 0.8,
        dashArray: '6, 8'
      }).addTo(layer);

      setRouteInfo({
        distanceKm: dist,
        durationMin: Math.max(1, Math.round(dist * 2)),
        isDirectFallback: true
      });

      mapInstanceRef.current.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    } finally {
      setRoutingLoading(false);
    }
  };

  const clearRoute = () => {
    if (routeLayerRef.current) routeLayerRef.current.clearLayers();
    setSelectedSupplier(null);
    setRouteInfo(null);
  };

  const openRequestDialog = (supplier) => {
    setReqModal({
      open: true,
      supplier,
      product: debouncedProduct || '',
      qty: Math.max(1, qty),
      busy: false
    });
  };

  const handleRequestSubmit = async () => {
    if (!reqModal.supplier) return;
    const reqProduct = reqModal.product.trim();
    const reqQty = parseInt(reqModal.qty, 10);

    if (!reqProduct) {
      say('Error: Please enter a medicine name');
      return;
    }
    if (!reqQty || reqQty < 1) {
      say('Error: Please enter a quantity of 1 or more');
      return;
    }

    setReqModal(prev => ({ ...prev, busy: true }));
    try {
      await api('request_create', {
        to_id: reqModal.supplier.id,
        product: reqProduct,
        qty: reqQty
      });
      say(`Request for ${reqQty} × ${reqProduct} sent to ${reqModal.supplier.name}`);
      setReqModal({ open: false, supplier: null, product: '', qty: 1, busy: false });
      fetchSuppliers();
    } catch (e) {
      say('Error: ' + e.message);
      setReqModal(prev => ({ ...prev, busy: false }));
    }
  };

  const filteredSuppliers = onlyInStock
    ? suppliers.filter(s => s.has_sufficient_stock)
    : suppliers;

  return (
    <div className={`map-section card ${standalone ? 'standalone' : ''}`} style={{ padding: 20 }}>
      <div className="map-header">
        <div>
          <h3><MapPin size={20} style={{ color: 'var(--primary)' }} /> Nearby Pharmacy &amp; Wholesaler Discovery Map</h3>
          <p className="sub" style={{ margin: 0 }}>
            Real-time geolocation map to find nearby PHC pharmas of your own district, verify live medicine stock, and calculate road driving routes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`btn s ${geoState.status === 'success' || geoState.status === 'saved' ? 'ok' : 'g'}`}
            onClick={detectLocation}
            title="Detect GPS Location via browser"
          >
            <Locate size={14} /> {geoState.status === 'loading' ? 'Locating…' : 'Detect GPS Location'}
          </button>
          {geoState.status === 'success' && (
            <button
              className="btn s"
              onClick={saveAsMyPharmaLocation}
              disabled={savingLocation}
              title="Save this location to your registered pharmacy record in database"
            >
              <Check size={14} /> {savingLocation ? 'Saving…' : 'Save As My Pharmacy Location'}
            </button>
          )}
        </div>
      </div>

      {geoState.status === 'denied' && (
        <div className="alert danger" style={{ margin: '0 0 16px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b>Location Notice:</b> {geoState.message}
          </div>
          <button className="btn s g" onClick={() => setAddressResults([])}>Dismiss</button>
        </div>
      )}

      <form onSubmit={handleAddressSearch} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Search an address or area in Tamil Nadu to center map (e.g. Royapettah, Chennai or Gandhipuram, Coimbatore)…"
          value={addressSearch}
          onChange={e => setAddressSearch(e.target.value)}
          style={{ flex: 1, margin: 0 }}
        />
        <button type="submit" className="btn s g" disabled={searchingAddr} style={{ whiteSpace: 'nowrap' }}>
          <Search size={14} /> {searchingAddr ? 'Searching…' : 'Search Address'}
        </button>
      </form>

      {addressResults.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 10, background: '#f8fafc', border: '1px solid var(--border)' }}>
          <small style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select location to update map position:</small>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {addressResults.map((r, i) => (
              <div
                key={i}
                onClick={() => selectAddressResult(r)}
                style={{ padding: '6px 10px', background: '#fff', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', fontSize: 13 }}
              >
                <MapPin size={12} style={{ marginRight: 4, color: 'var(--primary)' }} />
                {r.display_name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="map-controls-bar">
        <div className="map-search-group" style={{ position: 'relative' }}>
          <input
            placeholder="Search medicine (e.g. Paracetamol 500mg, Amoxicillin)…"
            value={product}
            onChange={e => setProduct(e.target.value)}
            style={{ margin: 0 }}
          />
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1100,
              background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: 'var(--shadow-md)', maxHeight: 180, overflowY: 'auto', marginTop: 4
            }}>
              {suggestions.map(s => (
                <div
                  key={s}
                  onClick={() => { setProduct(s); setSuggestions([]); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--primary-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <Pill size={12} style={{ marginRight: 6, color: 'var(--primary)' }} /> {s}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="map-qty-group">
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Qty:</span>
          <input
            type="number"
            min="1"
            value={qty}
            onChange={e => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </div>

        <div className="radius-selector">
          <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', color: 'var(--text-muted)' }}>RADIUS:</span>
          {[5, 10, 25, 0].map(r => (
            <button
              key={r}
              className={`radius-btn ${radius === r ? 'on' : ''}`}
              onClick={() => setRadius(r)}
            >
              {r === 0 ? 'All' : `${r} km`}
            </button>
          ))}
        </div>

        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          style={{ width: 'auto', margin: 0, padding: '8px 12px', fontSize: 13 }}
        >
          <option value="pharmacy">PHC Pharmas</option>
        </select>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={onlyInStock}
            onChange={e => setOnlyInStock(e.target.checked)}
          />
          <span>In-stock only</span>
        </label>

        <button className="btn s g" onClick={fetchSuppliers} disabled={loadingSuppliers} title="Refresh nearby suppliers">
          <RefreshCw size={14} className={loadingSuppliers ? 'spin' : ''} />
        </button>
      </div>

      <div className="map-view-grid">
        <div className="map-canvas-container">
          <div ref={mapContainerRef} className="leaflet-map-target" />

          {routeInfo && selectedSupplier && (
            <div className="route-banner">
              <div className="route-banner-info">
                <Navigation size={18} style={{ color: '#60a5fa' }} />
                <span><b>Route to {selectedSupplier.name}:</b></span>
                <span className="route-stat-chip">
                  <MapPin size={12} /> {routeInfo.distanceKm} km
                </span>
                <span className="route-stat-chip">
                  <Clock size={12} /> ~{routeInfo.durationMin} mins drive
                </span>
                {routeInfo.isDirectFallback && (
                  <span style={{ fontSize: 11, color: '#fef08a' }}>(Direct distance fallback)</span>
                )}
              </div>
              <button className="route-close-btn" onClick={clearRoute} title="Close Route">
                <XCircle size={18} />
              </button>
            </div>
          )}

          {routingLoading && (
            <div style={{
              position: 'absolute', top: 16, right: 16, zIndex: 1000,
              background: '#fff', padding: '6px 12px', borderRadius: 6,
              boxShadow: 'var(--shadow-md)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6
            }}>
              <RefreshCw size={12} className="spin" /> Calculating road route…
            </div>
          )}
        </div>

        <div className="map-suppliers-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <b style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {filteredSuppliers.length} SUPPLIER{filteredSuppliers.length === 1 ? '' : 'S'} FOUND
            </b>
            {debouncedProduct && (
              <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                Filtering: {debouncedProduct} (Qty: {qty})
              </span>
            )}
          </div>

          {loadingSuppliers && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: 13 }}>Searching nearby suppliers…</p>
            </div>
          )}

          {!loadingSuppliers && suppliersErr && (
            <div className="alert danger" style={{ margin: 0, fontSize: 13 }}>
              <b>Error loading suppliers:</b> {suppliersErr}
            </div>
          )}

          {!loadingSuppliers && !suppliersErr && filteredSuppliers.length === 0 && (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <Building2 size={36} />
              <p style={{ fontSize: 13 }}>No suppliers found within {radius === 0 ? 'the network' : `${radius} km`}.</p>
              <button className="btn s g" onClick={() => setRadius(0)} style={{ marginTop: 8 }}>
                Expand Search to All Network
              </button>
            </div>
          )}

          {!loadingSuppliers && filteredSuppliers.map((s) => {
            const isSelected = selectedSupplier?.id === s.id;
            const isWholesaler = s.role === 'wholesaler';

            return (
              <div
                key={s.id}
                className={`supplier-item-card ${isSelected ? 'selected' : ''}`}
                onClick={() => selectSupplier(s)}
              >
                <div className="supplier-card-header">
                  <div className="supplier-card-title">
                    {isWholesaler ? <Truck size={16} style={{ color: '#6366f1' }} /> : <Hospital size={16} style={{ color: '#2563eb' }} />}
                    <span>{s.name}</span>
                  </div>
                  <Tag c={isWholesaler ? 'blue' : 'green'}>{s.type_label}</Tag>
                </div>

                <div className="supplier-meta-row">
                  <span><MapPin size={12} /> {place(s.area, s.city) || '—'} {s.pincode ? `(${s.pincode})` : ''}</span>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>• {s.distance_km} km away</span>
                  {s.phone && <span>• <Phone size={11} /> {s.phone}</span>}
                </div>

                <div className="supplier-stock-row">
                  {isWholesaler ? (
                    <div>
                      {debouncedProduct ? (
                        s.wholesaler_listed ? (
                          <Tag c="green">Listed: ₹{s.wholesaler_price}</Tag>
                        ) : (
                          <Tag c="amber">Not listed in catalogue</Tag>
                        )
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Catalogue available</span>
                      )}
                    </div>
                  ) : (
                    <div>
                      {debouncedProduct ? (
                        s.has_stock ? (
                          s.has_sufficient_stock ? (
                            <Tag c="green" icon={CheckCircle2}>{s.available_stock} units in stock</Tag>
                          ) : (
                            <Tag c="amber" icon={AlertTriangle}>Only {s.available_stock} of {qty} units in stock</Tag>
                          )
                        ) : (
                          <Tag c="red" icon={XCircle}>Out of stock</Tag>
                        )
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {s.available_stock > 0 ? `${s.available_stock} units across batches` : 'No active inventory'}
                        </span>
                      )}
                      {s.earliest_expiry && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Earliest batch exp: {expLabel(s.earliest_expiry)}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="supplier-card-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="btn s"
                      disabled={!isWholesaler && (!s.has_stock || !s.has_sufficient_stock)}
                      onClick={() => openRequestDialog(s)}
                    >
                      <Send size={12} /> Request Medicine
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {reqModal.open && reqModal.supplier && (
        <div className="modal-overlay" onClick={() => !reqModal.busy && setReqModal({ ...reqModal, open: false })}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              <Pill size={20} style={{ color: 'var(--primary)' }} /> Send Medicine Request
            </h3>
            <p className="sub" style={{ margin: '0 0 16px' }}>
              Request emergency stock from <b>{reqModal.supplier.name}</b> ({reqModal.supplier.type_label}).
            </p>

            <div className="modal-body">
              <div className="modal-info-box">
                <div><b>Supplier:</b> {reqModal.supplier.name}</div>
                <div><b>Location:</b> {place(reqModal.supplier.address, reqModal.supplier.area, reqModal.supplier.city)}</div>
                <div><b>Distance:</b> {reqModal.supplier.distance_km} km</div>
                {reqModal.supplier.phone && <div><b>Phone:</b> {reqModal.supplier.phone}</div>}
              </div>

              <label style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                Medicine Name:
                <input
                  placeholder="e.g. Paracetamol 500mg"
                  value={reqModal.product}
                  onChange={e => setReqModal({ ...reqModal, product: e.target.value })}
                  style={{ marginTop: 4 }}
                />
              </label>

              <label style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                Quantity Required:
                <input
                  type="number"
                  min="1"
                  value={reqModal.qty}
                  onChange={e => setReqModal({ ...reqModal, qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  style={{ marginTop: 4 }}
                />
              </label>

              {reqModal.supplier.role === 'pharmacy' && reqModal.supplier.available_stock > 0 && reqModal.qty > reqModal.supplier.available_stock && (
                <div className="alert danger" style={{ margin: 0, fontSize: 12 }}>
                  <AlertTriangle size={14} style={{ marginRight: 4 }} />
                  Notice: Requested quantity ({reqModal.qty}) exceeds supplier's recorded usable stock ({reqModal.supplier.available_stock}). Backend will reject if insufficient.
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="btn-ghost"
                onClick={() => setReqModal({ ...reqModal, open: false })}
                disabled={reqModal.busy}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleRequestSubmit}
                disabled={reqModal.busy || !reqModal.product.trim()}
              >
                <Send size={14} /> {reqModal.busy ? 'Submitting…' : 'Confirm & Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Pharmacy: dashboard ---------- */

function PDash({ go, user, say }) {
  useOfflineTick();
  const online = isOnline();
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);   // true = the request numbers are the last ones received, not live
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        if (getQueue().some(o => o.state !== 'failed')) await syncNow();   // so the numbers include what was entered offline
        const d = await api('dashboard');
        setDash(d);
        if (on) { setData(d); setStale(false); setErr(''); }
      } catch (e) {
        if (!(e instanceof NetworkError)) { if (on) setErr(e.message); return; }
        const c = getDash();
        if (on) { setData(c || { low: [], expiring: [], sent: 0, sent_pending: 0, sent_approved: 0, received: 0, received_pending: 0, received_approved: 0, empty: true }); setStale(true); setErr(''); }
      }
    })();
    return () => { on = false; };
  }, [online]);

  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  // with no internet (or entries still waiting) the alerts are worked out from the inventory kept on this device
  const mine = getStock();
  const useLocal = mine && (stale || getQueue().some(o => o.state !== 'failed'));
  const local = useLocal ? localAlerts(mine) : null;
  const low = local ? local.low : data.low;
  const expiring = local ? local.expiring : (data.expiring || []);
  const live = !stale;

  const cards = [
    ['Low Stock Warnings', low.length, AlertTriangle, low.length > 0 ? 'red' : 'green', `medicines below ${LOW} units`, 'Inventory'],
    ['Requests Sent', data.sent, Send, 'blue', `to other PHC pharmas · ${data.sent_pending} pending · ${data.sent_approved} in progress${live ? '' : ' · last known'}`, 'Requests'],
    ['Requests Received', data.received, Inbox, 'amber', `from other PHC pharmas · ${data.received_pending} pending · ${data.received_approved} in progress${live ? '' : ' · last known'}`, 'Requests']
  ];

  return (
    <>
      <h2 className="t">Welcome back, {user.name}</h2>
      <p className="sub">Your stock sharing overview{data.empty && !mine ? ' - nothing is saved on this device yet, so connect to the internet once to load your stock.' : ''}</p>

      <div className="stats">
        {cards.map(([a, b, Icon, c, cap, to]) => (
          <div key={a} className="card stat click" onClick={() => go(to)}>
            <div className={`stat-icon ${c}`}><Icon size={24} /></div>
            <div className="stat-content">
              <small>{a}</small><b>{b}</b>
              <span className="cap">{cap}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row">
          <b style={{ fontSize: 16 }}>Stock Warnings</b>
          {low.length > 0 && <button className="btn s" disabled={!online} title={online ? '' : ex.needsInternet()} onClick={() => go('Network')}><Building2 size={14} /> Request from Network</button>}
        </div>
        {low.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 size={48} />
            <p>No warnings. Every medicine has {LOW} or more units.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Medicine</th><th>Units Left</th><th>Status</th><th>What it means</th></tr></thead>
            <tbody>
              {low.map(x => (
                <tr key={x.name}>
                  <td><b>{x.name}</b></td>
                  <td><b>{x.qty}</b></td>
                  <td>{x.qty === 0
                    ? <Tag c="red" icon={XCircle}>Out of stock</Tag>
                    : <Tag c="amber" icon={AlertTriangle}>Low stock</Tag>}</td>
                  <td className="why-cell">{ex.lowStock(x.name, x.qty, { offline: !online, autoAt: AUTO_AT })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="row">
          <b style={{ fontSize: 16 }}>Expiry Alerts</b>
          {expiring.length > 0 && <button className="btn s g" onClick={() => go('Inventory')}><Package size={14} /> Open Inventory</button>}
        </div>
        {expiring.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 size={48} />
            <p>No batch is expired or expiring within {EXPIRY_WARN} days.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Medicine</th><th>Batch No.</th><th>Expiry Date</th><th>Units</th><th>Status</th><th>What it means</th></tr></thead>
            <tbody>
              {expiring.map((x, i) => (
                <tr key={i}>
                  <td><b>{x.name}</b></td><td>{x.batch_no || '—'}</td><td>{expLabel(x.expiry_date)}</td><td>{x.qty}</td>
                  <td>{x.expired
                    ? <Tag c="red" icon={XCircle}>Expired</Tag>
                    : <Tag c="amber" icon={AlertTriangle}>Expires in {daysTo(x.expiry_date)} day{daysTo(x.expiry_date) === 1 ? '' : 's'}</Tag>}</td>
                  <td className="why-cell">{ex.expiry(x.name, x.batch_no, daysTo(x.expiry_date))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Nearby Pharmacy & Wholesaler Discovery Map - at the bottom of PHC Pharma Dashboard */}
      <NearbyPharmacyMap user={user} say={say} go={go} />
    </>
  );
}

/* ---------- Pharmacy: inventory ---------- */

function Stock({ q, say }) {
  const { stock: rows, err, refresh, local } = useStock();
  const [an, setAn] = useState(''); const [ab, setAb] = useState(''); const [ae, setAe] = useState('');
  const [aq, setAq] = useState(''); const [ap, setAp] = useState('');

  if (err && !rows) return <ErrBox m={err} />;
  if (!rows) return <Loading />;
  const stock = rows;
  const online = isOnline();
  // low stock is per medicine: usable (non-expired) units added up over all its batches
  const L = medNames(stock).filter(n => usableOf(stock, n) < LOW);
  const needle = q.toLowerCase();
  const v = stock.filter(x => x.name.toLowerCase().includes(needle) || (x.batch_no || '').toLowerCase().includes(needle));

  // after a change on this device: say so, and warn (one sentence) if a medicine just reached the automatic-request level
  const afterLocal = (name, first) => {
    local();
    const left = usableOf(getStock() || [], name);
    const msgs = [first];
    if (left <= AUTO_AT && !isOnline()) msgs.push(ex.lowStock(name, left, { offline: true, autoAt: AUTO_AT }));
    say(msgs);
  };

  const addStock = async () => {
    const free = isFree(an);
    if (!an.trim() || !ab.trim() || !ae || aq === '' || (!free && ap === '')) return say(free ? 'Error: Please fill the medicine name, batch number, expiry date and quantity.' : 'Error: Please fill the medicine name, batch number, expiry date, quantity and price.');
    if (+aq < 0 || (!free && +ap < 0)) return say('Error: Quantity and price cannot be less than zero, so please correct them.');
    const body = { name: an.trim(), batch_no: ab.trim(), expiry_date: ae, qty: +aq, price: free ? 0 : +ap };
    const what = `${an.trim()} (batch ${ab.trim()})`;
    const cid = newId();
    try {
      const r = await tryNow('stock_add', body, cid);   // online: straight to the server; offline: saved on this device
      if (r.d) {
        say([ex.savedOnline(what), ...autoMsg(r.d.auto, r.d.auto_skipped)]);
        refresh();
      } else {
        const bad = localAddStock({ ...body, free }, cid);
        if (bad) return say('Error: ' + bad);
        afterLocal(body.name, isOnline() ? ex.savedOnline(what) : ex.savedOffline(what));
      }
      setAn(''); setAb(''); setAe(''); setAq(''); setAp('');
    } catch (e) { say('Error: ' + e.message); }
  };
  const setQty = async (x, val) => {
    if (val === '' || +val === x.qty) return;
    if (+val < 0) return say('Error: The quantity cannot be less than zero, so please type zero or more.');
    const what = `${x.name} (batch ${x.batch_no || '—'})`;
    const cid = newId();
    try {
      const r = isTemp(x.id) ? { queued: true } : await tryNow('stock_update', { id: x.id, qty: +val }, cid);
      if (r.d) { say([`${what} is updated.`, ...autoMsg(r.d.auto, r.d.auto_skipped)]); refresh(); return; }
      localSetQty(x, +val, cid);
      afterLocal(x.name, isOnline() ? `${what} is updated.` : ex.savedOffline(`The new quantity of ${what}`));
    } catch (e) { say('Error: ' + e.message); refresh(); }
  };
  const remove = async x => {
    try {
      if (isTemp(x.id) || !isOnline() || getQueue().length) { localDelete(x); local(); say(isOnline() ? 'The batch is removed.' : ex.savedOffline('Removing this batch')); return; }
      await api('stock_delete', { id: x.id }); say('The batch is removed.'); refresh();
    } catch (e) {
      if (e instanceof NetworkError) { localDelete(x); local(); say(ex.savedOffline('Removing this batch')); }
      else say('Error: ' + e.message);
    }
  };

  return (
    <>
      <h2 className="t">Inventory Management</h2>
      <p className="sub">Stock is kept batch by batch (batch number + expiry date), and you can keep entering stock even when the internet is down. Medicines below {LOW} usable units show up as warnings on the dashboard. Items from an approved indent are added here automatically.</p>

      {L[0] && (
        <div className="alert danger">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <AlertTriangle size={24} />
            <div><b>Low Stock Alert</b><br />{ex.lowStockList(L, LOW)}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <b style={{ display: 'block', marginBottom: 12 }}>Add New Medicine / Batch</b>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input list="stock-meds" placeholder="Medicine Name" value={an} onChange={e => setAn(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
          <datalist id="stock-meds">{medNames(stock).map(n => <option key={n} value={n} />)}</datalist>
          <input placeholder="Batch Number" value={ab} onChange={e => setAb(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
          <label className="fld" style={{ flex: 1, minWidth: 150 }}>Expiry Date<input type="date" value={ae} onChange={e => setAe(e.target.value)} /></label>
          <input type="number" min="0" placeholder="Quantity" value={aq} onChange={e => setAq(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
          <input type="number" min="0" placeholder={isFree(an) ? 'FREE medicine' : 'Unit Price (₹)'} value={isFree(an) ? '' : ap} disabled={isFree(an)} onChange={e => setAp(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
          <button className="btn" onClick={addStock}><Plus size={16} /> Add</button>
        </div>
      </div>

      <div className="card">
        {stock.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>Inventory is empty. Add your first medicine above.</p>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Medicine</th><th>Batch No.</th><th>Expiry Date</th><th>Unit Price</th><th>Stock (editable)</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {v.map(x => {
                  const dl = daysTo(x.expiry_date);
                  const expired = dl !== null && dl < 0;
                  const soon = dl !== null && dl >= 0 && dl <= EXPIRY_WARN;
                  const low = !expired && usableOf(stock, x.name) < LOW;
                  return (
                    <tr key={x.id}>
                      <td><b>{x.name}</b></td>
                      <td>{x.batch_no || '—'}</td>
                      <td>{x.expiry_date ? expLabel(x.expiry_date) : '—'}</td>
                      <td>{x.free ? <Tag c="green">FREE</Tag> : <>₹{x.price}</>}</td>
                      <td>
                        <input className="num" type="number" min="0" defaultValue={x.qty} key={x.id + ':' + x.qty}
                          onBlur={e => setQty(x, e.target.value)} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {expired && <Tag c="red" icon={XCircle}>Expired</Tag>}
                          {soon && <Tag c="amber" icon={AlertTriangle}>Expires in {dl} day{dl === 1 ? '' : 's'}</Tag>}
                          {low && <Tag c="red" icon={AlertTriangle}>Low Stock</Tag>}
                          {!expired && !soon && !low && <Tag c="green" icon={CheckCircle2}>Optimal</Tag>}
                          {x.pending && <Tag c="blue" icon={Clock}>Not sent yet</Tag>}
                        </div>
                        <div className="why">
                          {expired ? ex.expiry(x.name, x.batch_no, dl)
                            : soon ? ex.expiry(x.name, x.batch_no, dl)
                            : low ? ex.lowStock(x.name, usableOf(stock, x.name), { offline: !online, autoAt: AUTO_AT })
                            : ex.optimal()}
                        </div>
                        {x.pending && <div className="why">{ex.notSentYet()}</div>}
                      </td>
                      <td><button className="btn s g" onClick={() => remove(x)}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Pharmacy: network (request stock from others) ---------- */

function Nearby({ say, user }) {
  const [product, setProduct] = useState('');
  const [prod, setProd] = useState('');
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setProd(product.trim()), 300);
    return () => clearTimeout(t);
  }, [product]);

  const { data, err } = useApi('network', { product: prod });
  const mine = useApi('stock_list');

  const ready = prod !== '' && prod === product.trim() && qty >= 1;
  const send = async p => {
    try {
      await api('request_create', { to_id: p.id, product: prod, qty });
      say(`Request for ${qty} × ${prod} sent to ${p.name}`);
    } catch (e) { say('Error: ' + e.message); }
  };

  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  return (
    <>
      <h2 className="t">PHC Pharma Network</h2>
      <p className="sub">Type a medicine to see which PHC pharmas <b>in your district{user && user.district ? ` (${user.district})` : ''}</b> have it in stock (nearest first), then send a request. When a medicine drops to {AUTO_AT} unit, a request is sent to the nearest PHC pharma automatically.</p>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input list="my-meds" placeholder="Medicine name (e.g. Paracetamol 500mg)" value={product}
            onChange={e => setProduct(e.target.value)} style={{ flex: 3, minWidth: 220 }} />
          <datalist id="my-meds">{medNames(mine.data?.stock).map(n => <option key={n} value={n} />)}</datalist>
          <input type="number" min="1" placeholder="Qty" value={qty}
            onChange={e => setQty(Math.max(1, +e.target.value))} style={{ flex: 1, minWidth: 90 }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <b style={{ display: 'block', marginBottom: 12 }}>Nearby PHC Pharmas</b>
        {data.pharmacies.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px 0' }}>
            <Building2 size={32} />
            <p>No other PHC pharmas have registered yet.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>PHC Pharma</th><th>Location</th><th>Availability</th><th>Action</th></tr></thead>
            <tbody>
              {data.pharmacies.map(p => (
                <tr key={p.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Hospital size={16} /> <b>{p.name}</b></div></td>
                  <td>{place(p.area, p.city) || '—'}{p.pincode && <><br /><span className="sub" style={{ fontSize: 12, margin: 0 }}>{p.pincode}</span></>}</td>
                  <td>{!prod ? '—' : p.avail > 0 ? <Tag c="green">{p.avail} in stock</Tag> : <Tag c="red">Not available</Tag>}</td>
                  <td><button className="btn s" disabled={!ready || p.avail < qty} onClick={() => send(p)}>Request</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </>
  );
}

/* ---------- Requests table (shared by pharmacy + wholesaler) ---------- */

function ReqTable({ box, filter, limit, compact, say }) {
  const { data, err, reload } = useApi('requests_list', { box });
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  let list = data.requests;
  if (filter === 'pending') list = list.filter(r => r.status === 'Pending' || r.status === 'Approved'); // still needs the supplier's action
  if (filter === 'done') list = list.filter(r => r.status !== 'Pending' && r.status !== 'Approved');
  if (limit) list = list.slice(0, limit);

  const act = async (id, status) => {
    try {
      const d = await api('request_update', { id, status });
      say(status === 'Received' ? 'Marked as received. Stock updated for both sides.'
        : status === 'Rejected' ? 'Request rejected.' + (d.auto?.length ? ` It was passed on to ${d.auto[0].to}.` : '')
        : status === 'Dispatched' ? 'Marked as dispatched. The requester can now confirm receipt.'
        : 'Request approved. Mark it dispatched once you hand over the units.');
    } catch (e) { say('Error: ' + e.message); }
    reload();
  };

  if (!list.length) {
    return (
      <div className="empty-state">
        <Inbox size={48} />
        <p>No requests here yet.</p>
      </div>
    );
  }

  const showAct = box === 'received' && !compact;
  const showRecv = box === 'sent';
  return (
    <table>
      <thead>
        <tr><th>{box === 'sent' ? 'To' : 'From'}</th><th>Medicine</th><th>Qty</th><th>Date</th><th>{showAct || showRecv ? 'Status / Action' : 'Status'}</th></tr>
      </thead>
      <tbody>
        {list.map(r => (
          <tr key={r.id}>
            <td>
              <b>{r.other_name}</b>
              {place(r.other_area, r.other_city) && <><br /><span className="sub" style={{ fontSize: 12, margin: 0 }}><MapPin size={11} /> {place(r.other_area, r.other_city)}</span></>}
              {r.other_address && <><br /><span className="sub" style={{ fontSize: 12, margin: 0 }}>{place(r.other_address, r.other_state, r.other_pincode)}{r.other_phone ? ` · ${r.other_phone}` : ''}</span></>}
            </td>
            <td>{r.product}{r.auto && <> <Tag c="blue" icon={Zap}>Auto</Tag></>}</td><td>{r.qty} units</td><td>{day(r.created_at)}</td>
            <td>
              {r.status === 'Rejected' ? <Tag c="red" icon={XCircle}>Rejected</Tag>
                : r.status === 'Received' ? <Tag c="green" icon={CheckCircle2}>Received</Tag>
                : r.status === 'Pending' ? (showAct ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn ok s" onClick={() => act(r.id, 'Approved')}><CheckCircle2 size={14} /> Approve</button>
                    <button className="btn no s" onClick={() => act(r.id, 'Rejected')}><XCircle size={14} /> Reject</button>
                  </div>
                ) : <Tag c="amber">Pending</Tag>)
                : r.status === 'Approved' ? (showAct
                  ? <button className="btn s" onClick={() => act(r.id, 'Dispatched')}><Truck size={14} /> Mark Dispatched</button>
                  : <Tag c="amber" icon={Truck}>Approved · waiting for dispatch</Tag>)
                : (showRecv
                  ? <button className="btn ok s" onClick={() => act(r.id, 'Received')}><CheckCircle2 size={14} /> Mark Received</button>
                  : <Tag c="blue" icon={Truck}>Dispatched · awaiting receipt</Tag>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PReqs({ say }) {
  const [tab, setTab] = useState('received');
  return (
    <>
      <h2 className="t">Stock Requests</h2>
      <p className="sub">Approve a request you can fulfil, then mark it <b>Dispatched</b> when you hand over the units. The requesting PHC pharma then confirms with <b>Mark Received</b>, and only at that moment its stock increases and yours decreases. Rejected automatic requests move on to the next nearest PHC pharma.</p>
      <div className="tabs">
        <button className={tab === 'received' ? 'on' : ''} onClick={() => setTab('received')}>Received</button>
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>Sent</button>
      </div>
      <div className="card"><ReqTable key={tab} box={tab} say={say} /></div>
    </>
  );
}

/* ---------- Indent (Tamil Nadu PHC style drug indent) ---------- */

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthLabel = p => { const d = new Date((p || '') + '-01'); return isNaN(d) ? (p || '—') : d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }); };
const blankRow = () => ({ code: '', name: '', unit: '', stock: '', avg: '', qty: '', remarks: '' });
const IND_TAG = { Pending: ['amber', null], Approved: ['green', CheckCircle2], Rejected: ['red', XCircle] };

function FormHead({ sub }) {
  return (
    <div className="ind-head">
      <div className="ind-gov">GOVERNMENT OF TAMIL NADU</div>
      <div>Department of Health and Family Welfare</div>
      <h3>INDENT FORM FOR DRUGS &amp; MEDICAL CONSUMABLES</h3>
      <div>{sub || 'Primary Health Centre (PHC)'}</div>
    </div>
  );
}

function Indent({ say, user }) {
  const [tab, setTab] = useState('new');
  return (
    <>
      <h2 className="t">Indent</h2>
      <p className="sub">Raise an indent in the Tamil Nadu PHC format. It goes only to the District Main PHC of <b>your own district ({user.district || '—'})</b>, and appears under its <b>Orders → Indents</b>. Once the District Main PHC approves it, the issued medicines (name, batch number, quantity and expiry date) are <b>added to your inventory automatically</b>.</p>
      <div className="tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>New Indent</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My Indents</button>
      </div>
      {tab === 'new' ? <NewIndent user={user} say={say} done={() => setTab('mine')} /> : <IndentList role="pharmacy" say={say} />}
    </>
  );
}

function NewIndent({ user, say, done }) {
  const ws = useApi('wholesalers_list');
  const mine = useApi('stock_list');
  const [h, setH] = useState({
    institution: user.name, district: user.district || '', block: user.area || '',
    address: place(user.address, user.area, user.city, user.state, user.pincode),
    indent_date: todayStr(), period: todayStr().slice(0, 7), officer: '', remarks: ''
  });
  const [rows, setRows] = useState([blankRow(), blankRow(), blankRow()]);
  const [busy, setBusy] = useState(false);

  const wlist = ws.data?.wholesalers || [];
  const main = wlist[0] || null;   // the server only returns the District Main PHC of this pharma's own district
  const to = main ? String(main.id) : '';
  const setHd = k => e => setH({ ...h, [k]: e.target.value });
  const setRow = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setName = (i, v) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const have = usableOf(mine.data?.stock, v);   // usable units over all non-expired batches
    const known = (mine.data?.stock || []).some(x => x.name.toLowerCase() === v.trim().toLowerCase());
    return { ...r, name: v, stock: known && r.stock === '' ? String(have) : r.stock }; // stock in hand comes from your inventory
  }));

  const submit = async () => {
    const items = rows.filter(r => r.name.trim());
    if (!to) return say(`Error: No District Main PHC account exists for ${user.district || 'your'} district yet`);
    if (!h.institution.trim()) return say('Error: Enter the name of the institution');
    if (!items.length) return say('Error: Add at least one medicine');
    const bad = items.find(r => !(+r.qty >= 1));
    if (bad) return say(`Error: Enter the quantity required for ${bad.name}`);
    setBusy(true);
    try {
      const d = await api('indent_create', {
        ...h,
        items: items.map(r => ({ code: r.code, name: r.name, unit: r.unit, stock: +r.stock || 0, avg: +r.avg || 0, qty: +r.qty, remarks: r.remarks }))
      });
      say(`Indent ${d.indent_no} sent to the District Main PHC.`);
      done();
    } catch (e) { say('Error: ' + e.message); setBusy(false); }
  };

  return (
    <div className="card ind">
      <FormHead />
      <datalist id="ind-meds">{medNames(mine.data?.stock).map(n => <option key={n} value={n} />)}</datalist>

      <div className="ind-grid">
        <label>Indent To (District Main PHC of your district)
          <input readOnly value={main ? `${main.name} — ${user.district}` : (ws.data ? `No District Main PHC registered for ${user.district || 'your'} district yet` : 'Loading…')} />
        </label>
        <label>Indent Date<input type="date" value={h.indent_date} onChange={setHd('indent_date')} /></label>
        <label>Indent Period (Month)<input type="month" value={h.period} onChange={setHd('period')} /></label>
        <label>Name of Institution (PHC Pharma)<input value={h.institution} onChange={setHd('institution')} /></label>
        <label>Block<input value={h.block} onChange={setHd('block')} /></label>
        <label>District<input readOnly value={h.district} /></label>
        <label className="wide">Address<input value={h.address} onChange={setHd('address')} /></label>
        <label>Indenting Officer (Medical Officer / Pharmacist)<input value={h.officer} onChange={setHd('officer')} /></label>
      </div>

      <div className="tbl-wrap">
        <table className="ind-table">
          <thead>
            <tr>
              <th>S.No</th><th>Drug Code</th><th>Name of Drug / Item</th><th>Unit / Strength</th>
              <th>Stock in Hand</th><th>Avg. Monthly Consumption</th><th>Quantity Required</th><th>Remarks</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input value={r.code} onChange={e => setRow(i, 'code', e.target.value)} /></td>
                <td><input list="ind-meds" value={r.name} onChange={e => setName(i, e.target.value)} placeholder="e.g. Paracetamol 500mg" /></td>
                <td><input value={r.unit} onChange={e => setRow(i, 'unit', e.target.value)} placeholder="Tab / Strip" /></td>
                <td><input type="number" min="0" value={r.stock} onChange={e => setRow(i, 'stock', e.target.value)} /></td>
                <td><input type="number" min="0" value={r.avg} onChange={e => setRow(i, 'avg', e.target.value)} /></td>
                <td><input type="number" min="1" value={r.qty} onChange={e => setRow(i, 'qty', e.target.value)} /></td>
                <td><input value={r.remarks} onChange={e => setRow(i, 'remarks', e.target.value)} /></td>
                <td><button className="btn s no" disabled={rows.length === 1} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn s g" style={{ marginTop: 12 }} onClick={() => setRows(rs => [...rs, blankRow()])}><Plus size={14} /> Add Row</button>

      <label className="ind-rem">General Remarks<input value={h.remarks} onChange={setHd('remarks')} /></label>

      <div className="ind-sign">
        <div>Signature of Indenting Officer<span>Date: {h.indent_date}</span></div>
        <div>Signature of Medical Officer / Pharmacist-in-charge</div>
      </div>

      <button className="btn w" onClick={submit} disabled={busy} style={{ marginTop: 20 }}>
        <Send size={16} /> {busy ? 'Sending…' : 'Submit Indent to District Main PHC'}
      </button>
    </div>
  );
}

// Read-only form view. For the District Main PHC and a Pending indent it also lets them set the issued quantity,
// batch number and expiry date per item, then approve / reject. Approving adds the issued items to the PHC pharma's inventory.
function IndentView({ ind, canAct, say, onDone }) {
  const [lines, setLines] = useState(() => Object.fromEntries(ind.items.map(i => [i.id, { qty: String(i.qty_required), batch: '', expiry: '' }])));
  const [busy, setBusy] = useState(false);
  const setLn = (id, k, v) => setLines(l => ({ ...l, [id]: { ...l[id], [k]: v } }));

  const act = async status => {
    if (status === 'Approved') {
      const t = todayStr();
      let total = 0;
      for (const i of ind.items) {
        const l = lines[i.id];
        const q = Math.min(Math.max(Math.floor(+l.qty) || 0, 0), i.qty_required);
        if (q < 1) continue;
        total += q;
        if (!l.batch.trim()) return say(`Error: Enter the batch number for ${i.name}`);
        if (!l.expiry) return say(`Error: Enter the expiry date for ${i.name}`);
        if (l.expiry < t) return say(`Error: ${i.name} batch ${l.batch.trim()} has already expired`);
      }
      if (!total) return say('Error: Issue at least one item, or reject the indent');
    }
    setBusy(true);
    try {
      const d = await api('indent_update', {
        id: ind.id, status,
        lines: Object.fromEntries(ind.items.map(i => [i.id, { qty: +lines[i.id].qty || 0, batch: lines[i.id].batch, expiry: lines[i.id].expiry }]))
      });
      say(status === 'Approved'
        ? `Indent ${ind.indent_no} approved. ${d.stocked} item${d.stocked === 1 ? '' : 's'} added to the PHC pharma's inventory.`
        : `Indent ${ind.indent_no} rejected.`);
      onDone();
    } catch (e) { say('Error: ' + e.message); setBusy(false); }
  };
  const showIssued = ind.status === 'Approved' || canAct;
  const stocked = ind.status === 'Approved' && ind.items.some(i => i.batch_no);
  const [c, Icon] = IND_TAG[ind.status];

  return (
    <div className="print-area ind">
      <FormHead />
      <div className="ind-grid view">
        <div><small>Indent No</small><b>{ind.indent_no}</b></div>
        <div><small>Date</small><b>{day(ind.indent_date)}</b></div>
        <div><small>Period</small><b>{monthLabel(ind.period)}</b></div>
        <div><small>Institution</small><b>{ind.institution}</b></div>
        <div><small>Block</small><b>{ind.block || '—'}</b></div>
        <div><small>District</small><b>{ind.district || '—'}</b></div>
        <div className="wide"><small>Address</small><b>{ind.address || '—'}</b></div>
        <div><small>Indenting Officer</small><b>{ind.officer || '—'}</b></div>
        <div><small>Status</small><Tag c={c} icon={Icon}>{ind.status}</Tag></div>
      </div>

      {canAct && <p className="sub no-print">Enter the <b>batch number</b> and <b>expiry date</b> of the units you are issuing. They go into the PHC pharma's inventory as soon as you approve.</p>}

      <div className="tbl-wrap">
        <table className="ind-table">
          <thead>
            <tr>
              <th>S.No</th><th>Drug Code</th><th>Name of Drug / Item</th><th>Unit / Strength</th>
              <th>Stock in Hand</th><th>Avg. Monthly Consumption</th><th>Qty Required</th>
              {showIssued && <th>Qty Issued</th>}{showIssued && <th>Batch No.</th>}{showIssued && <th>Expiry Date</th>}<th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {ind.items.map(i => (
              <tr key={i.id}>
                <td>{i.sno}</td><td>{i.drug_code || '—'}</td><td><b>{i.name}</b></td><td>{i.unit || '—'}</td>
                <td>{i.stock_in_hand}</td><td>{i.avg_monthly}</td><td><b>{i.qty_required}</b></td>
                {showIssued && (canAct ? <>
                  <td><input type="number" min="0" max={i.qty_required} value={lines[i.id].qty} onChange={e => setLn(i.id, 'qty', e.target.value)} /></td>
                  <td><input value={lines[i.id].batch} placeholder="Batch no." onChange={e => setLn(i.id, 'batch', e.target.value)} /></td>
                  <td><input type="date" min={todayStr()} value={lines[i.id].expiry} onChange={e => setLn(i.id, 'expiry', e.target.value)} /></td>
                </> : <>
                  <td><b>{i.qty_issued ?? '—'}</b></td>
                  <td>{i.batch_no || '—'}</td>
                  <td>{i.expiry_date ? expLabel(i.expiry_date) : '—'}</td>
                </>)}
                <td>{i.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stocked && <p className="sub no-print" style={{ marginBottom: 0 }}><CheckCircle2 size={14} /> The issued items (name, batch number, quantity and expiry date) were added to the PHC pharma's inventory automatically.</p>}
      {ind.remarks && <p className="sub" style={{ marginBottom: 0 }}><b>Remarks:</b> {ind.remarks}</p>}

      <div className="ind-sign">
        <div>Signature of Indenting Officer</div>
        <div>Signature of Medical Officer / Pharmacist-in-charge</div>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {canAct && <>
          <button className="btn ok s" disabled={busy} onClick={() => act('Approved')}><CheckCircle2 size={14} /> Approve &amp; Issue</button>
          <button className="btn no s" disabled={busy} onClick={() => act('Rejected')}><XCircle size={14} /> Reject</button>
        </>}
        <button className="btn s g" onClick={() => window.print()}><Printer size={14} /> Print</button>
      </div>
    </div>
  );
}

function IndentList({ role, filter, say }) {
  const { data, err, reload } = useApi('indents_list');
  const [open, setOpen] = useState(null);
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  let list = data.indents;
  if (filter === 'pending') list = list.filter(i => i.status === 'Pending');
  if (filter === 'done') list = list.filter(i => i.status !== 'Pending');

  if (!list.length) {
    return (
      <div className="card"><div className="empty-state"><FileText size={48} /><p>No indents here yet.</p></div></div>
    );
  }
  return (
    <>
      {list.map(i => {
        const [c, Icon] = IND_TAG[i.status];
        const on = open === i.id;
        return (
          <div key={i.id} className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ marginBottom: on ? 16 : 0, cursor: 'pointer' }} onClick={() => setOpen(on ? null : i.id)}>
              <div>
                <b>{i.indent_no}</b> · {i.institution}
                <div className="sub" style={{ margin: 0, fontSize: 12 }}>
                  {role === 'pharmacy' ? `To ${i.other_name}` : `From ${i.other_name}${i.other_city ? ', ' + i.other_city : ''}`} · {day(i.indent_date)} · {i.items.length} item{i.items.length === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Tag c={c} icon={Icon}>{i.status}</Tag>
                {on ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
            </div>
            {on && <IndentView ind={i} canAct={role === 'wholesaler' && i.status === 'Pending'} say={say} onDone={() => { setOpen(null); reload(); }} />}
          </div>
        );
      })}
    </>
  );
}

/* ---------- Pharmacy: billing ---------- */

function Billing({ say }) {
  const [tab, setTab] = useState('new');
  return (
    <>
      <h2 className="t">Billing POS</h2>
      <p className="sub">Generate invoices, and keep every sale on record: bill by bill, and day by day.</p>
      <div className="tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>New Bill</button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Sales Log</button>
        <button className={tab === 'daily' ? 'on' : ''} onClick={() => setTab('daily')}>Daily Summary</button>
      </div>
      {tab === 'new' && <NewBill say={say} />}
      {tab === 'log' && <SalesLog />}
      {tab === 'daily' && <DailySummary />}
    </>
  );
}

function NewBill({ say }) {
  const { stock: rows, err, refresh, local } = useStock();
  const [items, setItems] = useState([]);
  const [cust, setCust] = useState('');
  const [s, setS] = useState('');

  if (err && !rows) return <ErrBox m={err} />;
  if (!rows) return <Loading />;
  const stock = rows;

  const price = id => { const r = stock.find(x => x.id === id); return !r || r.free ? 0 : r.price; };
  const isFreeRow = id => !!stock.find(x => x.id === id)?.free;
  const total = items.reduce((a, i) => a + price(i.id) * i.qty, 0);
  const add = x => {
    if (isExpired(x.expiry_date)) return say('Error: ' + ex.expiredCannotSell(x.name, x.batch_no));
    setItems(it => it.find(i => i.id === x.id) ? it.map(i => i.id === x.id ? { ...i, qty: i.qty + 1 } : i) : [...it, { id: x.id, name: x.name, batch: x.batch_no, exp: x.expiry_date, qty: 1 }]);
    setS('');
  };
  const gen = async () => {
    if (!items.length) return say('Error: The bill is empty, so please add at least one medicine first.');
    const payload = { customer: cust, items: items.map(({ id, qty }) => ({ id, qty })) };
    const cid = newId();
    try {
      // online: the server gives the final invoice number; offline: the bill is saved on this device with a temporary number
      const r = items.some(i => isTemp(i.id)) ? { queued: true } : await tryNow('bill_create', payload, cid);
      if (r.d) {
        setItems([]); setCust(''); refresh();
        say([`Invoice ${r.d.bill_no} for ₹${r.d.total} is saved.`, ...autoMsg(r.d.auto, r.d.auto_skipped)]);
        return;
      }
      const b = localBill({ customer: cust, items: payload.items, cid });
      if (b.error) return say('Error: ' + b.error);
      setItems([]); setCust(''); local();
      const names = [...new Set(payload.items.map(i => stock.find(x => x.id === i.id)?.name).filter(Boolean))];
      const msgs = [isOnline()
        ? `Bill ${b.ref} for ₹${b.total} is saved and its final invoice number will appear in a moment.`
        : `Bill ${b.ref} for ₹${b.total} is saved on this device, its final invoice number will be given when the internet returns, and the stock is already reduced.`];
      names.forEach(n => { const left = usableOf(getStock() || [], n); if (left <= AUTO_AT && !isOnline()) msgs.push(ex.lowStock(n, left, { offline: true, autoAt: AUTO_AT })); });
      say(msgs);
    } catch (e) { say('Error: ' + e.message); }
  };
  const m = s ? stock.filter(x => x.name.toLowerCase().includes(s.toLowerCase()) || (x.batch_no || '').toLowerCase().includes(s.toLowerCase())) : [];   // listed earliest expiry first

  return (
    <>
      <div className="bill">
        <div className="card">
          <div className="top-search">
            <Search className="search-icon" size={18} />
            <input placeholder="Search inventory by product name or batch..." value={s} onChange={e => setS(e.target.value)} />
          </div>

          {m.map(x => (
            <div key={x.id} className="row" style={{ padding: '8px 12px', background: 'var(--bg-app)', borderRadius: 6 }}>
              <span><b>{x.name}</b> <span className="sub" style={{ margin: 0, fontSize: 12 }}> · Batch {x.batch_no || '—'} · Exp {x.expiry_date ? expLabel(x.expiry_date) : '—'} · Stock: {x.qty}</span>
                {x.free && <> <Tag c="green">FREE</Tag></>}{isExpired(x.expiry_date) && <> <Tag c="red" icon={XCircle}>Expired</Tag> <span className="why" style={{ display: 'inline' }}>{ex.expiredCannotSell(x.name, x.batch_no)}</span></>}</span>
              <button className="btn g s" disabled={isExpired(x.expiry_date)} onClick={() => add(x)}><Plus size={14} /> Add</button>
            </div>
          ))}

          <table style={{ marginTop: 20 }}>
            <thead><tr><th>#</th><th>Item Description</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th></th></tr></thead>
            <tbody>
              {items.map((i, k) => (
                <tr key={i.id}>
                  <td>{k + 1}</td><td><b>{i.name}</b></td><td>{i.batch || '—'}</td><td>{i.exp ? expLabel(i.exp) : '—'}</td>
                  <td><input className="num" type="number" min="1" value={i.qty} onChange={e => setItems(items.map(z => z === i ? { ...z, qty: Math.max(1, +e.target.value) } : z))} /></td>
                  <td>{isFreeRow(i.id) ? <Tag c="green">FREE</Tag> : <>₹{price(i.id)}</>}</td><td><b>{isFreeRow(i.id) ? 'FREE' : <>₹{price(i.id) * i.qty}</>}</b></td>
                  <td><button className="btn no s" onClick={() => setItems(items.filter(z => z !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <Package size={32} />
              <p>Cart is empty. Search inventory to add items.</p>
            </div>
          )}
        </div>

        <div className="card" style={{ height: 'fit-content' }}>
          <h3 style={{ marginTop: 0 }}>Invoice Details</h3>
          <label className="sub" style={{ fontSize: 12 }}>Customer Name</label>
          <input value={cust} onChange={e => setCust(e.target.value)} placeholder="Walk-in Customer" style={{ marginBottom: 24 }} />

          <div className="row"><span className="sub" style={{ margin: 0 }}>Subtotal</span><b>₹ {total}</b></div>
          <div className="row"><span className="sub" style={{ margin: 0 }}>Tax (0%)</span><b>₹ 0</b></div>
          <hr style={{ border: 0, borderTop: '1px dashed var(--border)', margin: '16px 0' }} />
          <div className="row"><span><b>Total Amount</b></span><h1 style={{ margin: 0, color: 'var(--primary)' }}>₹ {total}</h1></div>

          <button className="btn w" onClick={gen} style={{ marginTop: 24 }}><ReceiptText size={18} /> Generate Invoice</button>
        </div>
      </div>
    </>
  );
}

/* ---------- Pharmacy: sales records ---------- */

const money2 = n => '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
const timeOf = s => String(s || '').slice(11, 16);
const longDay = d => {
  const x = new Date(d + 'T00:00:00');
  return isNaN(x) ? d : x.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
};

// Every sale line as its own row: Bill ID, date, product, unit cost, quantity, amount.
function SalesLog() {
  const [date, setDate] = useState('');
  const { data, err } = useApi('sales_log', { date });
  if (err) return <ErrBox m={err} />;

  const rows = data?.sales || [];
  const qty = rows.reduce((a, r) => a + r.qty, 0);
  const amt = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="card">
      <div className="row">
        <div>
          <b style={{ fontSize: 16 }}>Sales Log</b>
          <div className="sub" style={{ margin: 0, fontSize: 12 }}>Every bill line, newest first.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ margin: 0, width: 170 }} />
          {date && <button className="btn s g" onClick={() => setDate('')}>All dates</button>}
        </div>
      </div>

      {!data ? <Loading /> : rows.length === 0 ? (
        <div className="empty-state"><ReceiptText size={48} /><p>{date ? 'No sales on this date.' : 'No sales yet. Bills you generate will be listed here.'}</p></div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Bill ID</th><th>Date</th><th>Product</th><th>Cost (₹)</th><th>Quantity</th><th>Amount</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.bill_no + ':' + i}>
                    <td><b>{r.bill_no}</b></td>
                    <td>{day(r.created_at)} <span className="sub" style={{ margin: 0, fontSize: 12 }}>{timeOf(r.created_at)}</span></td>
                    <td>{r.name}</td><td>₹{r.price}</td><td>{r.qty}</td><td><b>{money2(r.amount)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ marginBottom: 0 }}>
            {rows.length} line{rows.length === 1 ? '' : 's'} · {qty} units · {money2(amt)}
            {data.truncated && ' · showing the latest 1000 lines (pick a date to see older ones)'}
          </p>
        </>
      )}
    </div>
  );
}

// One card per date: each product sold that day with its total quantity. A new date starts automatically at midnight.
function DailySummary() {
  const { data, err } = useApi('sales_daily');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  if (!data.days.length) {
    return <div className="card"><div className="empty-state"><ReceiptText size={48} /><p>No sales yet. Each day's sales will be summarised here.</p></div></div>;
  }
  return (
    <>
      {data.days.map(d => {
        const isToday = d.date === data.today;
        const units = d.items.reduce((a, i) => a + i.qty, 0);
        return (
          <div key={d.date} className="card" style={{ marginBottom: 16 }}>
            <div className="row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <b style={{ fontSize: 16 }}>{longDay(d.date)}</b>
                {isToday ? <Tag c="amber">Today · in progress</Tag> : <Tag c="green" icon={CheckCircle2}>Day closed</Tag>}
              </div>
              <span className="sub" style={{ margin: 0 }}>{d.bills} bill{d.bills === 1 ? '' : 's'} · {units} units · <b>{money2(d.total)}</b></span>
            </div>
            <table>
              <thead><tr><th>Product</th><th>Quantity Sold</th><th>Amount</th></tr></thead>
              <tbody>
                {d.items.map(i => (
                  <tr key={i.name}><td><b>{i.name}</b></td><td>{i.qty}</td><td>{money2(i.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/* ---------- District Main PHC (wholesaler role) ---------- */

function WDash({ say, user }) {
  const { data, err } = useApi('dashboard');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  return (
    <>
      <h2 className="t">District Main PHC Dashboard: {user.name}{user.district ? ` (${user.district} district)` : ''}</h2>
      <p className="sub">Monitor incoming PHC pharma orders and indents.</p>

      <div className="stats">
        {[
          ['Active Catalogue', data.catalogue, Pill, 'blue'],
          ['Pending Orders', data.pending, ReceiptText, data.pending > 0 ? 'amber' : 'green'],
          ['Registered PHC Pharmas', data.pharmacies, Building2, 'blue']
        ].map(([a, b, Icon, c]) => (
          <div key={a} className="card stat">
            <div className={`stat-icon ${c}`}><Icon size={24} /></div>
            <div className="stat-content"><small>{a}</small><b>{b}</b></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row"><b style={{ fontSize: 16 }}>Recent Inbound Orders</b></div>
        <ReqTable box="received" limit={5} compact say={say} />
      </div>
    </>
  );
}

function Products({ q, say }) {
  const { data, err, reload } = useApi('catalogue_list');
  const [an, setAn] = useState(''); const [ap, setAp] = useState('');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  const add = async () => {
    if (!an.trim() || ap === '') return say('Error: Enter product name and supply price');
    try {
      await api('catalogue_add', { name: an, price: +ap });
      setAn(''); setAp(''); say('Product added to catalogue'); reload();
    } catch (e) { say('Error: ' + e.message); }
  };
  const remove = async p => {
    try { await api('catalogue_delete', { id: p.id }); say('Item removed'); reload(); }
    catch (e) { say('Error: ' + e.message); }
  };
  const v = data.products.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <h2 className="t">Product Catalogue</h2>
      <p className="sub">Manage the items available to PHC pharmas.</p>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <input placeholder="New Product Name" value={an} onChange={e => setAn(e.target.value)} style={{ flex: 2 }} />
          <input type="number" min="0" placeholder="Supply Price (₹)" value={ap} onChange={e => setAp(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" onClick={add}><Plus size={16} /> Add Item</button>
        </div>
      </div>

      <div className="card">
        {data.products.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>Catalogue is empty. Add your products above.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Product Name</th><th>Supply Price</th><th>Action</th></tr></thead>
            <tbody>
              {v.map(p => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td><td>₹{p.price}</td>
                  <td><button className="btn s g" onClick={() => remove(p)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Orders({ say }) {
  const [kind, setKind] = useState('stock');
  const [tab, setTab] = useState('pending');
  return (
    <>
      <h2 className="t">Manage Inbound Orders</h2>
      <p className="sub">Stock orders and indents (PHC format) sent to you by PHC pharmas. Stock orders add units to the PHC pharma's inventory once it marks them as received. When you approve an indent, enter the batch number and expiry date of the issued items and they are added to the PHC pharma's inventory automatically.</p>
      <div className="tabs">
        <button className={kind === 'stock' ? 'on' : ''} onClick={() => setKind('stock')}>Stock Orders</button>
        <button className={kind === 'indent' ? 'on' : ''} onClick={() => setKind('indent')}>Indents</button>
      </div>
      <div className="tabs">
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Pending Orders</button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Processed History</button>
      </div>
      {kind === 'stock'
        ? <div className="card"><ReqTable key={'s' + tab} box="received" filter={tab} say={say} /></div>
        : <IndentList key={'i' + tab} role="wholesaler" filter={tab} say={say} />}
    </>
  );
}

function Pharmacies() {
  const { data, err } = useApi('pharmacies_list');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  return (
    <>
      <h2 className="t">Registered PHC Pharmas</h2>
      <p className="sub">PHC pharmas in the network.</p>

      <div className="card">
        {data.pharmacies.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} />
            <p>No PHC pharmas have registered yet.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>PHC Pharma Name</th><th>Address</th><th>Phone</th><th>Joined</th></tr></thead>
            <tbody>
              {data.pharmacies.map(n => (
                <tr key={n.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Hospital size={16} /> <b>{n.name}</b></div></td>
                  <td><div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}><MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} /> <span>{place(n.address, n.area, n.city, n.state, n.pincode) || '—'}</span></div></td>
                  <td>{n.phone || '—'}</td>
                  <td>{day(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
