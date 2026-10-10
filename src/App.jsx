import { useState, useEffect, useCallback } from 'react';
import {
  Pill, Truck, Building2, LayoutDashboard, ReceiptText,
  Package, Search, LogOut, Bell, User, Plus, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Hospital, MapPin,
  LogIn, UserPlus, ShieldCheck, Zap, Mail, Phone, Send, Inbox, FileText, Printer, ChevronDown, ChevronUp
} from 'lucide-react';

const AUTO_AT = 1; // stock level that triggers the automatic request (same value as AUTO_AT in backend/api.php)
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
    data = await res.json();
  } catch {
    throw new Error('Cannot reach the server. Is the PHP backend running? (npm run api)');
  }
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
  return data;
}

function useApi(action, body = {}) {
  const key = JSON.stringify(body);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(
    () => api(action, JSON.parse(key)).then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message)),
    [action, key]
  );
  useEffect(() => { load(); }, [load]);
  return { data, err, reload: load };
}

const Tag = ({ c, children, icon: Icon }) => (
  <span className={'tag ' + c}>
    {Icon && <Icon size={14} />} {children}
  </span>
);

const Toast = ({ m }) => m ? <div className="toast"><Bell size={18} /> {m}</div> : null;
const Loading = () => <p className="sub">Loading…</p>;
const ErrBox = ({ m }) => <div className="alert danger"><div><b>Something went wrong</b><br />{m}</div></div>;
const day = s => String(s || '').slice(0, 10);
const place = (...p) => p.filter(Boolean).join(', ');
// toast text for automatic low-stock requests returned by the API
const autoMsg = a => (a && a.length) ? ' ' + a.map(x => `Stock is low, so a request for ${x.product} was sent to ${x.to} automatically.`).join(' ') : '';

/* ---------- App root ---------- */
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking session
  const [down, setDown] = useState('');
  const [toast, setToast] = useState('');
  const say = m => { setToast(m); setTimeout(() => setToast(''), 2800); };

  useEffect(() => {
    api('me').then(d => setUser(d.user)).catch(e => { setDown(e.message); setUser(null); });
  }, []);

  const logout = async () => { try { await api('logout'); } catch { /* ignore */ } setUser(null); };

  if (user === undefined) return <div className="boot">Loading ChemiConnect…</div>;

  return (
    <>
      {user
        ? <Shell user={user} out={logout} say={say} />
        : <PublicSite down={down} onLogin={setUser} say={say} />}
      <Toast m={toast} />
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
            <Truck size={16} /> For Wholesalers
          </button>
          <button className="btn-ghost" onClick={() => openAuth('login')}><LogIn size={16} /> Login</button>
          <button className="btn" onClick={() => openAuth('signup')}><UserPlus size={16} /> Sign Up</button>
        </div>
      </header>

      {down && (
        <div className="alert danger" style={{ margin: '16px 32px 0' }}>
          <div><b>Backend not reachable</b><br />{down}</div>
        </div>
      )}

      {pg === 'home' && <Home openAuth={openAuth} goWs={() => { setMode('login'); setPg('wholesaler'); }} />}
      {pg === 'about' && <About />}
      {pg === 'contact' && <Contact say={say} />}
      {pg === 'pharmacy' && (
        <AuthPage key="p" role="pharmacy" mode={mode} setMode={setMode} onLogin={onLogin} say={say}
          icon={Hospital} title="Pharmacy Portal" desc="Track your stock, get low-stock warnings and share medicines with nearby pharmacies." />
      )}
      {pg === 'wholesaler' && (
        <AuthPage key="w" role="wholesaler" mode={mode} setMode={setMode} onLogin={onLogin} say={say}
          icon={Truck} title="Wholesaler Hub" desc="List your catalogue, receive pharmacy orders and grow your distribution network." />
      )}
    </>
  );
}

function Home({ openAuth, goWs }) {
  const feats = [
    [Package, 'Real-time Stock', 'Track inventory and get low-stock warnings instantly.'],
    [Zap, 'Faster Replenishment', 'Request stock from wholesalers and nearby pharmacies in a click.'],
    [ShieldCheck, 'Trusted Network', 'Connect only with registered pharmacies and wholesalers.']
  ];
  return (
    <>
      <section className="home-hero">
        <h1>Smarter Supply Chain.</h1>
        <h2>Connect pharmacies and wholesalers for real-time stock updates, faster replenishment and better healthcare access.</h2>
        <div className="cta">
          <button className="btn big" onClick={() => openAuth('signup')}>Get Started as Pharmacy</button>
          <button className="btn-ghost big" onClick={goWs}>I'm a Wholesaler</button>
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
      <p className="sub lead">ChemiConnect is a B2B pharmaceutical platform that connects retail pharmacies with each other and with wholesale suppliers.</p>
      <div className="card">
        <p>Pharmacies often run out of essential medicines because stock updates and reorders are slow. ChemiConnect warns you when a medicine is running low, lets you request it from nearby pharmacies that have it, and gives wholesalers a clear view of incoming orders.</p>
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
  const [f, setF] = useState({ name: '', email: '', phone: '', address: '', area: '', city: '', state: '', pincode: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';
  const label = role === 'pharmacy' ? 'Pharmacy' : 'Company';
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    const email = f.email.trim().toLowerCase();
    if (!email || !f.pw) return say('Error: Enter email and password');
    if (!isLogin) {
      if (!f.name.trim()) return say('Error: Enter your ' + label.toLowerCase() + ' name');
      if (!f.address.trim() || !f.area.trim() || !f.city.trim() || !f.state.trim()) return say('Error: Enter your full address (street, area, city and state)');
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
            city: f.city, state: f.state, pincode: f.pincode.trim(), password: f.pw
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

const MENU = {
  pharmacy: [
    { n: 'Dashboard', i: LayoutDashboard },
    { n: 'Inventory', i: Package },
    { n: 'Network', i: Building2 },
    { n: 'Requests', i: Truck },
    { n: 'Indent', i: FileText },
    { n: 'Billing POS', i: ReceiptText }
  ],
  wholesaler: [
    { n: 'Dashboard', i: LayoutDashboard },
    { n: 'Catalogue', i: Pill },
    { n: 'Orders', i: ReceiptText },
    { n: 'Pharmacies', i: Building2 }
  ]
};

function Shell({ user, out, say }) {
  const [pg, setPg] = useState('Dashboard');
  const [q, setQ] = useState('');
  const role = user.role;

  const P = {
    pharmacy: { Dashboard: PDash, 'Billing POS': Billing, Inventory: Stock, Network: Nearby, Requests: PReqs, Indent: Indent },
    wholesaler: { Dashboard: WDash, Catalogue: Products, Orders: Orders, Pharmacies: Pharmacies }
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
              <span className="sub" style={{ fontSize: 12, margin: 0 }}>{role === 'pharmacy' ? 'Retail Partner' : 'Wholesale Supplier'}</span>
            </div>
            <div className="usr-avatar"><User size={20} /></div>
          </div>
        </div>

        <P key={pg} q={q} go={setPg} say={say} user={user} />
      </div>
    </div>
  );
}

/* ---------- Pharmacy: dashboard ---------- */

function PDash({ go, user }) {
  const { data, err } = useApi('dashboard');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  const { low } = data;

  const cards = [
    ['Low Stock Warnings', low.length, AlertTriangle, low.length > 0 ? 'red' : 'green', `medicines below ${LOW} units`, 'Inventory'],
    ['Requests Sent', data.sent, Send, 'blue', `to other pharmacies · ${data.sent_pending} pending · ${data.sent_approved} in progress`, 'Requests'],
    ['Requests Received', data.received, Inbox, 'amber', `from other pharmacies · ${data.received_pending} pending · ${data.received_approved} in progress`, 'Requests']
  ];

  return (
    <>
      <h2 className="t">Welcome back, {user.name}</h2>
      <p className="sub">Your stock sharing overview</p>

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
          {low.length > 0 && <button className="btn s" onClick={() => go('Network')}><Building2 size={14} /> Request from Network</button>}
        </div>
        {low.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 size={48} />
            <p>No warnings. Every medicine has {LOW} or more units.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Medicine</th><th>Units Left</th><th>Status</th></tr></thead>
            <tbody>
              {low.map(x => (
                <tr key={x.name}>
                  <td><b>{x.name}</b></td>
                  <td><b>{x.qty}</b></td>
                  <td>{x.qty === 0
                    ? <Tag c="red" icon={XCircle}>Out of stock</Tag>
                    : <Tag c="amber" icon={AlertTriangle}>Low stock</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- Pharmacy: inventory ---------- */

function Stock({ q, say }) {
  const { data, err, reload } = useApi('stock_list');
  const [an, setAn] = useState(''); const [aq, setAq] = useState(''); const [ap, setAp] = useState('');

  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  const stock = data.stock;
  const L = stock.filter(x => x.qty < LOW);
  const v = stock.filter(x => x.name.toLowerCase().includes(q.toLowerCase()));

  const addStock = async () => {
    if (!an.trim() || aq === '' || ap === '') return say('Error: Fill all fields to add stock');
    try {
      const d = await api('stock_add', { name: an, qty: +aq, price: +ap });
      say(`${an} added to inventory successfully.` + autoMsg(d.auto));
      setAn(''); setAq(''); setAp(''); reload();
    } catch (e) { say('Error: ' + e.message); }
  };
  const setQty = async (x, val) => {
    if (val === '' || +val === x.qty) return;
    try { const d = await api('stock_update', { id: x.id, qty: +val }); say(`${x.name} updated.` + autoMsg(d.auto)); }
    catch (e) { say('Error: ' + e.message); }
    reload();
  };
  const remove = async x => {
    try { await api('stock_delete', { id: x.id }); say('Product removed'); reload(); }
    catch (e) { say('Error: ' + e.message); }
  };

  return (
    <>
      <h2 className="t">Inventory Management</h2>
      <p className="sub">Manage your stock. Medicines below {LOW} units show up as warnings on the dashboard.</p>

      {L[0] && (
        <div className="alert danger">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <AlertTriangle size={24} />
            <div><b>Low Stock Alert</b><br />{L.map(x => x.name).join(', ')} {L.length > 1 ? 'are' : 'is'} below {LOW} units.</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <b style={{ display: 'block', marginBottom: 12 }}>Add New Medicine</b>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input placeholder="Medicine Name" value={an} onChange={e => setAn(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
          <input type="number" min="0" placeholder="Quantity" value={aq} onChange={e => setAq(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
          <input type="number" min="0" placeholder="Unit Price (₹)" value={ap} onChange={e => setAp(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
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
          <table>
            <thead><tr><th>Medicine</th><th>Unit Price</th><th>Stock (editable)</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {v.map(x => (
                <tr key={x.id}>
                  <td><b>{x.name}</b></td>
                  <td>₹{x.price}</td>
                  <td>
                    <input className="num" type="number" min="0" defaultValue={x.qty} key={x.id + ':' + x.qty}
                      onBlur={e => setQty(x, e.target.value)} />
                  </td>
                  <td>{x.qty < LOW ? <Tag c="red" icon={AlertTriangle}>Low Stock</Tag> : <Tag c="green" icon={CheckCircle2}>Optimal</Tag>}</td>
                  <td><button className="btn s g" onClick={() => remove(x)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- Pharmacy: network (request stock from others) ---------- */

function Nearby({ say }) {
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
      <h2 className="t">Pharmacy Network</h2>
      <p className="sub">Type a medicine to see which nearby pharmacies have it in stock (nearest first), then send a request. When a medicine drops to {AUTO_AT} unit, a request is sent to the nearest pharmacy automatically.</p>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input list="my-meds" placeholder="Medicine name (e.g. Paracetamol 500mg)" value={product}
            onChange={e => setProduct(e.target.value)} style={{ flex: 3, minWidth: 220 }} />
          <datalist id="my-meds">{(mine.data?.stock || []).map(x => <option key={x.id} value={x.name} />)}</datalist>
          <input type="number" min="1" placeholder="Qty" value={qty}
            onChange={e => setQty(Math.max(1, +e.target.value))} style={{ flex: 1, minWidth: 90 }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <b style={{ display: 'block', marginBottom: 12 }}>Nearby Pharmacies</b>
        {data.pharmacies.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px 0' }}>
            <Building2 size={32} />
            <p>No other pharmacies have registered yet.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Pharmacy</th><th>Location</th><th>Availability</th><th>Action</th></tr></thead>
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

      <div className="card">
        <b style={{ display: 'block', marginBottom: 12 }}>Wholesalers</b>
        {data.wholesalers.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px 0' }}>
            <Truck size={32} />
            <p>No wholesalers have registered yet.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Wholesaler</th><th>Location</th><th>Catalogue</th><th>Action</th></tr></thead>
            <tbody>
              {data.wholesalers.map(w => (
                <tr key={w.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Truck size={16} /> <b>{w.name}</b></div></td>
                  <td>{place(w.area, w.city) || '—'}</td>
                  <td>{!prod ? '—' : w.listed ? <Tag c="green">Listed · ₹{w.price}</Tag> : <Tag c="amber">Not listed</Tag>}</td>
                  <td><button className="btn s" disabled={!ready} onClick={() => send(w)}>Request</button></td>
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
      <p className="sub">Approve a request you can fulfil, then mark it <b>Dispatched</b> when you hand over the units. The requesting pharmacy then confirms with <b>Mark Received</b>, and only at that moment its stock increases and yours decreases. Rejected automatic requests move on to the next nearest pharmacy.</p>
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
      <p className="sub">Raise an indent in the Tamil Nadu PHC format. It reaches the wholesaler you choose under <b>Orders → Indents</b>.</p>
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
    to_id: '', institution: user.name, district: user.city || '', block: user.area || '',
    address: place(user.address, user.area, user.city, user.state, user.pincode),
    indent_date: todayStr(), period: todayStr().slice(0, 7), officer: '', remarks: ''
  });
  const [rows, setRows] = useState([blankRow(), blankRow(), blankRow()]);
  const [busy, setBusy] = useState(false);

  const wlist = ws.data?.wholesalers || [];
  const to = h.to_id || (wlist.length === 1 ? String(wlist[0].id) : '');
  const setHd = k => e => setH({ ...h, [k]: e.target.value });
  const setRow = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setName = (i, v) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const m = (mine.data?.stock || []).find(x => x.name.toLowerCase() === v.trim().toLowerCase());
    return { ...r, name: v, stock: m && r.stock === '' ? String(m.qty) : r.stock }; // stock in hand comes from your inventory
  }));

  const submit = async () => {
    const items = rows.filter(r => r.name.trim());
    if (!to) return say('Error: Select the wholesaler to send this indent to');
    if (!h.institution.trim()) return say('Error: Enter the name of the institution');
    if (!items.length) return say('Error: Add at least one medicine');
    const bad = items.find(r => !(+r.qty >= 1));
    if (bad) return say(`Error: Enter the quantity required for ${bad.name}`);
    setBusy(true);
    try {
      const d = await api('indent_create', {
        ...h, to_id: +to,
        items: items.map(r => ({ code: r.code, name: r.name, unit: r.unit, stock: +r.stock || 0, avg: +r.avg || 0, qty: +r.qty, remarks: r.remarks }))
      });
      say(`Indent ${d.indent_no} sent to the wholesaler.`);
      done();
    } catch (e) { say('Error: ' + e.message); setBusy(false); }
  };

  return (
    <div className="card ind">
      <FormHead />
      <datalist id="ind-meds">{(mine.data?.stock || []).map(x => <option key={x.id} value={x.name} />)}</datalist>

      <div className="ind-grid">
        <label>Indent To (Wholesaler)
          <select value={to} onChange={setHd('to_id')}>
            <option value="">{ws.data ? (wlist.length ? 'Select wholesaler' : 'No wholesalers registered yet') : 'Loading…'}</option>
            {wlist.map(w => <option key={w.id} value={w.id}>{w.name} — {place(w.area, w.city)}</option>)}
          </select>
        </label>
        <label>Indent Date<input type="date" value={h.indent_date} onChange={setHd('indent_date')} /></label>
        <label>Indent Period (Month)<input type="month" value={h.period} onChange={setHd('period')} /></label>
        <label>Name of Institution (PHC / Pharmacy)<input value={h.institution} onChange={setHd('institution')} /></label>
        <label>Block<input value={h.block} onChange={setHd('block')} /></label>
        <label>District<input value={h.district} onChange={setHd('district')} /></label>
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
        <Send size={16} /> {busy ? 'Sending…' : 'Submit Indent to Wholesaler'}
      </button>
    </div>
  );
}

// Read-only form view. For a wholesaler and a Pending indent it also lets them set the issued quantity and approve / reject.
function IndentView({ ind, canAct, say, onDone }) {
  const [issued, setIssued] = useState(() => Object.fromEntries(ind.items.map(i => [i.id, i.qty_required])));
  const act = async status => {
    try {
      await api('indent_update', { id: ind.id, status, issued });
      say(status === 'Approved' ? `Indent ${ind.indent_no} approved.` : `Indent ${ind.indent_no} rejected.`);
      onDone();
    } catch (e) { say('Error: ' + e.message); }
  };
  const showIssued = ind.status === 'Approved' || canAct;
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

      <div className="tbl-wrap">
        <table className="ind-table">
          <thead>
            <tr>
              <th>S.No</th><th>Drug Code</th><th>Name of Drug / Item</th><th>Unit / Strength</th>
              <th>Stock in Hand</th><th>Avg. Monthly Consumption</th><th>Qty Required</th>
              {showIssued && <th>Qty Issued</th>}<th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {ind.items.map(i => (
              <tr key={i.id}>
                <td>{i.sno}</td><td>{i.drug_code || '—'}</td><td><b>{i.name}</b></td><td>{i.unit || '—'}</td>
                <td>{i.stock_in_hand}</td><td>{i.avg_monthly}</td><td><b>{i.qty_required}</b></td>
                {showIssued && (
                  <td>{canAct
                    ? <input type="number" min="0" max={i.qty_required} value={issued[i.id]} onChange={e => setIssued({ ...issued, [i.id]: e.target.value })} />
                    : <b>{i.qty_issued ?? '—'}</b>}</td>
                )}
                <td>{i.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ind.remarks && <p className="sub" style={{ marginBottom: 0 }}><b>Remarks:</b> {ind.remarks}</p>}

      <div className="ind-sign">
        <div>Signature of Indenting Officer</div>
        <div>Signature of Medical Officer / Pharmacist-in-charge</div>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {canAct && <>
          <button className="btn ok s" onClick={() => act('Approved')}><CheckCircle2 size={14} /> Approve &amp; Issue</button>
          <button className="btn no s" onClick={() => act('Rejected')}><XCircle size={14} /> Reject</button>
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
  const { data, err, reload } = useApi('stock_list');
  const [items, setItems] = useState([]);
  const [cust, setCust] = useState('');
  const [s, setS] = useState('');

  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;
  const stock = data.stock;

  const price = id => stock.find(x => x.id === id)?.price || 0;
  const total = items.reduce((a, i) => a + price(i.id) * i.qty, 0);
  const add = x => {
    setItems(it => it.find(i => i.id === x.id) ? it.map(i => i.id === x.id ? { ...i, qty: i.qty + 1 } : i) : [...it, { id: x.id, name: x.name, qty: 1 }]);
    setS('');
  };
  const gen = async () => {
    if (!items.length) return say('Error: Add at least one product to the bill');
    try {
      const d = await api('bill_create', { customer: cust, items: items.map(({ id, qty }) => ({ id, qty })) });
      setItems([]); setCust(''); reload();
      say(`Invoice ${d.bill_no} generated successfully — ₹${d.total}.` + autoMsg(d.auto));
    } catch (e) { say('Error: ' + e.message); }
  };
  const m = s ? stock.filter(x => x.name.toLowerCase().includes(s.toLowerCase())) : [];

  return (
    <>
      <h2 className="t">Point of Sale</h2>
      <p className="sub">Generate invoice and update inventory instantly.</p>

      <div className="bill">
        <div className="card">
          <div className="top-search">
            <Search className="search-icon" size={18} />
            <input placeholder="Search inventory by product name..." value={s} onChange={e => setS(e.target.value)} />
          </div>

          {m.map(x => (
            <div key={x.id} className="row" style={{ padding: '8px 12px', background: 'var(--bg-app)', borderRadius: 6 }}>
              <span><b>{x.name}</b> <span className="sub" style={{ margin: 0, fontSize: 12 }}> (Stock: {x.qty})</span></span>
              <button className="btn g s" onClick={() => add(x)}><Plus size={14} /> Add</button>
            </div>
          ))}

          <table style={{ marginTop: 20 }}>
            <thead><tr><th>#</th><th>Item Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th></th></tr></thead>
            <tbody>
              {items.map((i, k) => (
                <tr key={i.id}>
                  <td>{k + 1}</td><td><b>{i.name}</b></td>
                  <td><input className="num" type="number" min="1" value={i.qty} onChange={e => setItems(items.map(z => z === i ? { ...z, qty: Math.max(1, +e.target.value) } : z))} /></td>
                  <td>₹{price(i.id)}</td><td><b>₹{price(i.id) * i.qty}</b></td>
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

/* ---------- Wholesaler ---------- */

function WDash({ say, user }) {
  const { data, err } = useApi('dashboard');
  if (err) return <ErrBox m={err} />;
  if (!data) return <Loading />;

  return (
    <>
      <h2 className="t">Supplier Dashboard: {user.name}</h2>
      <p className="sub">Monitor wholesale operations and incoming orders.</p>

      <div className="stats">
        {[
          ['Active Catalogue', data.catalogue, Pill, 'blue'],
          ['Pending Orders', data.pending, ReceiptText, data.pending > 0 ? 'amber' : 'green'],
          ['Registered Pharmacies', data.pharmacies, Building2, 'blue']
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
    if (!an.trim() || ap === '') return say('Error: Enter product name and wholesale price');
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
      <p className="sub">Manage wholesale items available to pharmacies.</p>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <input placeholder="New Product Name" value={an} onChange={e => setAn(e.target.value)} style={{ flex: 2 }} />
          <input type="number" min="0" placeholder="Wholesale Price (₹)" value={ap} onChange={e => setAp(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" onClick={add}><Plus size={16} /> Add Item</button>
        </div>
      </div>

      <div className="card">
        {data.products.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>Catalogue is empty. Add wholesale products above.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Product Name</th><th>Wholesale Price</th><th>Action</th></tr></thead>
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
      <p className="sub">Stock orders from pharmacies, and indents (PHC format) sent to you. Stock orders add units to the pharmacy's inventory once the pharmacy marks them as received.</p>
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
      <h2 className="t">Registered Pharmacies</h2>
      <p className="sub">Network of retail partners.</p>

      <div className="card">
        {data.pharmacies.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} />
            <p>No pharmacies have registered yet.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Pharmacy Name</th><th>Address</th><th>Phone</th><th>Joined</th></tr></thead>
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
