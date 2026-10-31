import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Customer, type Paged, type PaymentMode, type Product, type Sale } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Scanner } from '../components/Scanner';
import { Modal, StockBadge, Thumb, Field } from '../components/ui';
import { Receipt, UpiQr, whatsappBillText, whatsappLink } from '../components/Receipt';
import { money, qty, shop, upiLink, modeLabel, allowsFraction } from '../lib/util';

interface Line { product: Product; qty: number }
const CART_KEY = 'rr.pos.cart';

function loadCart(): Line[] {
  try { return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]'); } catch { return []; }
}

export function PosPage() {
  const { user } = useAuth();
  const [cart, setCart] = useState<Line[]>(loadCart);
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pane, setPane] = useState<'items' | 'cart'>('items');
  const [billDiscount, setBillDiscount] = useState(0);
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cashGiven, setCashGiven] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [showUpi, setShowUpi] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ } }, [cart]);

  const q = useDebounced(search.trim(), 200);
  const { data: results } = useApi<Paged<Product>>(`/api/products?pageSize=24${q ? `&search=${encodeURIComponent(q)}` : ''}`);

  const linesTotal = useMemo(() => cart.reduce((s, l) => s + round2(l.product.effectivePrice * l.qty), 0), [cart]);
  const mrpTotal = useMemo(() => cart.reduce((s, l) => s + l.product.mrp * l.qty, 0), [cart]);
  // Same breakdown as the printed bill: items at selling price, minus item discounts.
  const itemsTotal = useMemo(() => cart.reduce((s, l) => s + round2(l.product.sellingPrice * l.qty), 0), [cart]);
  const total = Math.max(0, round2(linesTotal - billDiscount));
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const cashNum = Number(cashGiven) > 0 ? Number(cashGiven) : 0;
  const change = cashNum > 0 ? round2(cashNum - total) : 0;
  const cashShort = mode === 'Cash' && cashNum > 0 && cashNum < total;
  // Quick-tap amounts: exact, then the next round notes above the total.
  const quickCash = Array.from(new Set([total, ...[50, 100, 200, 500, 2000].map(n => Math.ceil(total / n) * n)]))
    .filter(v => v > 0 && v >= total).sort((a, b) => a - b).slice(0, 4);

  function add(p: Product, n = 1) {
    if (!p.isActive) { toast(`${p.name} is inactive`, 'err'); return; }
    setCart(c => {
      const i = c.findIndex(l => l.product.id === p.id);
      if (i >= 0) { const copy = [...c]; copy[i] = { ...copy[i], product: p, qty: copy[i].qty + n }; return copy; }
      return [{ product: p, qty: n }, ...c];
    });
    if (p.qtyOnHand <= 0) toast(`${p.name}: system shows no stock — check later`, 'err');
  }
  const setQty = (id: number, n: number) =>
    setCart(c => (n <= 0 ? c.filter(l => l.product.id !== id) : c.map(l => (l.product.id === id ? { ...l, qty: n } : l))));

  async function addByCode(code: string) {
    try { add(await api<Product>(`/api/products/code/${encodeURIComponent(code)}`)); }
    catch (e) { toast(e instanceof ApiError && e.status === 404 ? `No item with barcode ${code}` : (e as Error).message, 'err'); }
  }

  // USB / Bluetooth barcode guns type the code and press Enter.
  async function onSearchEnter() {
    const s = search.trim();
    if (!s) return;
    if (/^\d{6,14}$/.test(s)) await addByCode(s);
    else if (results?.items.length === 1) add(results.items[0]);
    else return;
    setSearch('');
  }

  function reset() {
    setCart([]); setBillDiscount(0); setMode('Cash'); setCustomer(null); setCashGiven(''); setRemarks(''); setPane('items');
    searchRef.current?.focus();
  }

  async function checkout() {
    if (cart.length === 0) return;
    if (mode === 'Credit' && !customer) { setPickCustomer(true); return; }
    setBusy(true);
    try {
      const sale = await api<Sale>('/api/sales', {
        body: {
          items: cart.map(l => ({ productId: l.product.id, qty: l.qty })),
          billDiscount, paymentMode: mode, customerId: customer?.id ?? null, remarks: remarks.trim() || null,
          cashReceived: mode === 'Cash' && cashNum > 0 ? cashNum : null
        }
      });
      setShowUpi(false);
      setDone(sale);
      reset();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  const onPay = () => (mode === 'Upi' && shop.upiId ? setShowUpi(true) : checkout());

  return (
    <div className="page pos">
      <div className="seg mobile-only">
        <button className={pane === 'items' ? 'on' : ''} onClick={() => setPane('items')}>Add items</button>
        <button className={pane === 'cart' ? 'on' : ''} onClick={() => setPane('cart')}>Cart ({qty(count)})</button>
      </div>

      <div className="pos-grid">
        {/* ---------- item picker ---------- */}
        <section className={`pos-items ${pane === 'items' ? '' : 'hide-mobile'}`}>
          <div className="search-row">
            <input ref={searchRef} autoFocus className="input" placeholder="Search name / scan or type barcode…"
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSearchEnter()} />
            <button className="btn primary" onClick={() => setScanning(true)} aria-label="Scan barcode">📷 Scan</button>
          </div>
          {scanning && <Scanner continuous onScan={addByCode} onClose={() => setScanning(false)} />}

          <div className="item-grid">
            {results?.items.map(p => (
              <button key={p.id} className="item-card" onClick={() => add(p)} disabled={!p.isActive}>
                <Thumb url={p.imageUrl} name={p.name} size={64} />
                {p.discountPercent > 0 && <span className="off">{p.discountPercent}% OFF</span>}
                <b className="item-name">{p.name}</b>
                <span className="price">
                  {p.mrp > p.effectivePrice && <s>{money(p.mrp)}</s>} {money(p.effectivePrice)}
                </span>
                <StockBadge p={p} />
              </button>
            ))}
          </div>
          {results && results.items.length === 0 && <p className="muted">No items match “{q}”.</p>}
        </section>

        {/* ---------- cart & payment ---------- */}
        <section className={`pos-cart card ${pane === 'cart' ? '' : 'hide-mobile'}`}>
          <div className="row between"><h2>Bill</h2>{cart.length > 0 && <button className="link" onClick={reset}>Clear</button>}</div>
          {cart.length === 0 ? <p className="muted">Scan or tap items to add them.</p> : (
            <ul className="cart-list">
              {cart.map(l => (
                <li key={l.product.id}>
                  <div className="grow">
                    <b>{l.product.name}</b>
                    <div className="muted small">{money(l.product.effectivePrice)} × {qty(l.qty)} {l.product.unit}</div>
                  </div>
                  <div className="stepper">
                    <button onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Less">−</button>
                    <input inputMode={allowsFraction(l.product.unit) ? 'decimal' : 'numeric'} value={l.qty}
                      onChange={e => {
                        const n = Number(e.target.value);
                        if (Number.isNaN(n)) return;
                        setQty(l.product.id, allowsFraction(l.product.unit) ? n : Math.floor(n));
                      }} />
                    <button onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="More">+</button>
                  </div>
                  <b className="line-total">{money(round2(l.product.effectivePrice * l.qty))}</b>
                </li>
              ))}
            </ul>
          )}

          <div className="totals">
            <div className="row between"><span>Items total</span><span>{money(itemsTotal)}</span></div>
            {itemsTotal - linesTotal > 0.004 && <div className="row between save"><span>Item discount</span><span>−{money(itemsTotal - linesTotal)}</span></div>}
            <div className="row between">
              <span>Bill discount ₹{user?.role === 'Cashier' && <small className="muted"> (max 5%)</small>}</span>
              <input className="input sm num" inputMode="decimal" value={billDiscount || ''} placeholder="0"
                onChange={e => setBillDiscount(Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <div className="row between grand"><span>Total</span><span>{money(total)}</span></div>
            {mrpTotal - total > 0.5 && <div className="muted small">Customer saves {money(mrpTotal - total)} on MRP ({money(mrpTotal)})</div>}
          </div>

          <div className="modes">
            {(['Cash', 'Upi', 'Card', 'Credit'] as PaymentMode[]).map(m => (
              <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{modeLabel[m]}</button>
            ))}
          </div>

          {mode === 'Cash' && (
            <div className="row between">
              <span>Cash received</span>
              <input className="input sm num" inputMode="decimal" placeholder={total.toFixed(0)} value={cashGiven} onChange={e => setCashGiven(e.target.value)} />
            </div>
          )}
          {mode === 'Cash' && cart.length > 0 && (
            <div className="chips">
              {quickCash.map(v => (
                <button key={v} className={`chip ${cashNum === v ? 'on' : ''}`} onClick={() => setCashGiven(String(v))}>
                  {v === total ? 'Exact' : `₹${v}`}
                </button>
              ))}
            </div>
          )}
          {mode === 'Cash' && change > 0 && <div className="change">Return change: <b>{money(change)}</b></div>}
          {cashShort && <div className="change short">Short by <b>{money(total - cashNum)}</b> — collect more cash</div>}

          <div className="row between">
            <span>Customer {mode === 'Credit' && <b className="danger">*</b>}</span>
            <button className="btn sm ghost" onClick={() => setPickCustomer(true)}>
              {customer ? `${customer.name}${customer.due > 0 ? ` · due ${money(customer.due)}` : ''}` : 'Walk-in · select'}
            </button>
          </div>

          <textarea className="input remarks" rows={2} maxLength={500} placeholder="Remarks (optional) — e.g. deliver tomorrow, gift pack, exchange"
            value={remarks} onChange={e => setRemarks(e.target.value)} />

          <button className="btn primary block xl" disabled={cart.length === 0 || busy || cashShort} onClick={onPay}>
            {busy ? 'Saving…' : `${mode === 'Credit' ? 'Save udhaar' : 'Collect'} ${money(total)}`}
          </button>
        </section>
      </div>

      {/* sticky pay bar on phones */}
      {cart.length > 0 && pane === 'items' && (
        <button className="paybar mobile-only" onClick={() => setPane('cart')}>
          <span>{qty(count)} items</span><b>{money(total)} →</b>
        </button>
      )}

      {showUpi && (
        <Modal title="Scan & pay with any UPI app" onClose={() => setShowUpi(false)}>
          <div className="r-center stack">
            <UpiQr link={upiLink(total, `${shop.name} bill`)} size={240} />
            <b className="big-amt">{money(total)}</b>
            <span className="muted">{shop.upiId}</span>
            <button className="btn primary block xl" disabled={busy} onClick={checkout}>✓ Payment received</button>
          </div>
        </Modal>
      )}

      {pickCustomer && (
        <CustomerPicker onClose={() => setPickCustomer(false)} onPick={c => { setCustomer(c); setPickCustomer(false); }} onClear={() => { setCustomer(null); setPickCustomer(false); }} />
      )}

      {done && (
        <Modal title={`Bill ${done.billNo} saved`} onClose={() => setDone(null)}>
          <Receipt sale={done} />
          <div className="row gap wrap no-print" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => window.print()}>🖨 Print</button>
            <a className="btn" target="_blank" rel="noreferrer" href={whatsappLink(done.customerPhone, whatsappBillText(done))}>WhatsApp</a>
            <button className="btn primary grow" onClick={() => setDone(null)}>Next bill</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomerPicker({ onPick, onClose, onClear }: { onPick: (c: Customer) => void; onClose: () => void; onClear: () => void }) {
  const [s, setS] = useState('');
  const q = useDebounced(s.trim());
  const { data } = useApi<Customer[]>(`/api/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });

  async function create() {
    try { onPick(await api<Customer>('/api/customers', { body: form })); }
    catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <Modal title="Customer" onClose={onClose}>
      {!adding ? (
        <>
          <input className="input" autoFocus placeholder="Search name or phone" value={s} onChange={e => setS(e.target.value)} />
          <ul className="list pick">
            {data?.slice(0, 30).map(c => (
              <li key={c.id}><button className="list-row btn-row" onClick={() => onPick(c)}>
                <span className="grow"><b>{c.name}</b> <span className="muted">{c.phone}</span></span>
                {c.due > 0 && <span className="badge Low">due {money(c.due)}</span>}
                {c.due < 0 && <span className="badge Advance">advance {money(-c.due)}</span>}
              </button></li>
            ))}
          </ul>
          <div className="row gap">
            <button className="btn" onClick={onClear}>Walk-in</button>
            <button className="btn primary grow" onClick={() => { setAdding(true); setForm({ name: /^\d+$/.test(s) ? '' : s, phone: /^\d+$/.test(s) ? s : '' }); }}>+ New customer</button>
          </div>
        </>
      ) : (
        <div className="stack">
          <Field label="Name"><input className="input" autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Mobile"><input className="input" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="row gap"><button className="btn" onClick={() => setAdding(false)}>Back</button><button className="btn primary grow" disabled={!form.name.trim()} onClick={create}>Save</button></div>
        </div>
      )}
    </Modal>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
