import { useState } from 'react';
import { api, ApiError, type Paged, type PaymentMode, type Product, type Supplier } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { Field, StockBadge, Thumb, DateInput } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { SupplierForm } from './Suppliers';
import { money, qty, todayIso, modeLabel, dateTime } from '../lib/util';

interface Line { product: Product; qty: number; unitCost: number; newSellingPrice?: number }

/** Record goods received from a supplier: stock goes up, cost price updates, payment/dues go to the ledger. */
export function StockInPage() {
  const { data: suppliers, reload: reloadSuppliers } = useApi<Supplier[]>('/api/suppliers');
  const { data: recent, reload: reloadRecent } = useApi<{ id: number; invoiceNo?: string; total: number; paidAmount: number; supplier?: string; itemCount: number; createdAt: string }[]>('/api/purchases?take=10');
  const [supplierId, setSupplierId] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState<string>('');
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [addSupplier, setAddSupplier] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = useDebounced(search.trim());
  const [browse, setBrowse] = useState<'NeedsReorder' | 'all'>('NeedsReorder');
  // Typing searches all items; otherwise show items needing reorder (or all items) so you can tap to add.
  const listPath = q
    ? `/api/products?pageSize=20&search=${encodeURIComponent(q)}`
    : `/api/products?pageSize=60${browse === 'NeedsReorder' ? '&status=NeedsReorder' : ''}`;
  const { data: results } = useApi<Paged<Product>>(listPath);
  const inBill = new Set(lines.map(l => l.product.id));

  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.unitCost * 100) / 100, 0);
  const paidNum = paid === '' ? total : Math.min(total, Math.max(0, Number(paid) || 0));

  function add(p: Product) {
    setLines(ls => {
      const i = ls.findIndex(l => l.product.id === p.id);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], qty: c[i].qty + 1 }; return c; }
      return [{ product: p, qty: 1, unitCost: p.costPrice ?? 0 }, ...ls];
    });
    if (q) setSearch('');
  }
  const upd = (id: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.product.id === id ? { ...l, ...patch } : l)));

  async function byCode(code: string) {
    try { add(await api<Product>(`/api/products/code/${encodeURIComponent(code)}`)); }
    catch (e) { toast(e instanceof ApiError && e.status === 404 ? `Barcode ${code} not found — add it under Items first` : (e as Error).message, 'err'); }
  }

  async function save() {
    if (paidNum < total && !supplierId) { toast('Select the supplier to record the pending amount', 'err'); return; }
    setBusy(true);
    try {
      const r = await api<{ id: number; unpaid: number }>('/api/purchases', {
        body: {
          supplierId: supplierId || null, invoiceNo: invoiceNo || null, invoiceDate,
          items: lines.map(l => ({ productId: l.product.id, qty: l.qty, unitCost: l.unitCost, newSellingPrice: l.newSellingPrice || null })),
          paidAmount: paidNum, paidMode: mode
        }
      });
      toast(`Stock in #${r.id} saved${r.unpaid > 0 ? ` · ${money(r.unpaid)} pending to supplier` : ''}`);
      setLines([]); setInvoiceNo(''); setPaid('');
      reloadRecent(); reloadSuppliers();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <h1>Stock In</h1>
      <section className="card form-grid">
        <Field label="Supplier">
          <div className="search-row">
            <select className="input" value={supplierId} onChange={e => setSupplierId(Number(e.target.value))}>
              <option value={0}>— Local purchase / none —</option>
              {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}{s.due > 0 ? ` (due ${money(s.due)})` : ''}</option>)}
            </select>
            <button className="btn" onClick={() => setAddSupplier(true)}>+</button>
          </div>
        </Field>
        <Field label="Supplier bill no."><input className="input" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} /></Field>
        <Field label="Bill date"><DateInput value={invoiceDate} max={todayIso()} onChange={setInvoiceDate} aria-label="Bill date" /></Field>
      </section>

      <section className="card">
        <div className="search-row">
          <input className="input" placeholder="Search item or type barcode + Enter" value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && /^\d{6,14}$/.test(search.trim())) { byCode(search.trim()); setSearch(''); } }} />
          <button className="btn primary" onClick={() => setScan(true)}>📷 Scan</button>
        </div>
        {scan && <Scanner continuous onScan={byCode} onClose={() => setScan(false)} />}
        {!q && (
          <div className="chips" style={{ marginTop: 10 }}>
            <button className={`chip ${browse === 'NeedsReorder' ? 'on' : ''}`} onClick={() => setBrowse('NeedsReorder')}>Need reorder</button>
            <button className={`chip ${browse === 'all' ? 'on' : ''}`} onClick={() => setBrowse('all')}>All items</button>
            <span className="muted small">Tap an item to add it to this stock-in</span>
          </div>
        )}
        {results && (
          results.items.length === 0 ? (
            <p className="muted">
              {q ? `No item matches “${q}”. Add it under Items first.`
                 : browse === 'NeedsReorder' ? 'No items below their reorder level. Switch to “All items”.' : 'No items yet — add them under Items.'}
            </p>
          ) : (
            <ul className="list pick">
              {results.items.map(p => (
                <li key={p.id}><button className="list-row btn-row" onClick={() => add(p)}>
                  <Thumb url={p.imageUrl} name={p.name} size={32} />
                  <span className="grow"><b>{p.name}</b>
                    <div className="muted small">{[p.brand, p.barcode].filter(Boolean).join(' · ')}{p.costPrice != null ? ` · cost ${money(p.costPrice)}` : ''}</div>
                  </span>
                  <StockBadge p={p} />
                  {inBill.has(p.id) && <span className="badge InStock">+ added</span>}
                </button></li>
              ))}
            </ul>
          )
        )}

        {lines.length > 0 && (
          <div className="table-wrap">
            <table className="table stock-in">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost / unit</th><th className="num">New sell price</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.product.id}>
                    <td><b>{l.product.name}</b><div className="muted small">now {qty(l.product.qtyOnHand)} · sells {money(l.product.sellingPrice)}</div></td>
                    <td className="num"><input className="input sm num" type="number" inputMode="decimal" value={l.qty} onChange={e => upd(l.product.id, { qty: Number(e.target.value) })} /></td>
                    <td className="num"><input className="input sm num" type="number" inputMode="decimal" value={l.unitCost} onChange={e => upd(l.product.id, { unitCost: Number(e.target.value) })} /></td>
                    <td className="num"><input className="input sm num" type="number" inputMode="decimal" placeholder={String(l.product.sellingPrice)} value={l.newSellingPrice ?? ''} onChange={e => upd(l.product.id, { newSellingPrice: Number(e.target.value) || undefined })} /></td>
                    <td className="num">{money(l.qty * l.unitCost)}</td>
                    <td><button className="icon-btn" onClick={() => setLines(ls => ls.filter(x => x !== l))} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="card stack">
          <div className="row between grand"><span>Bill total</span><span>{money(total)}</span></div>
          <div className="row between">
            <span>Paid now ₹</span>
            <input className="input sm num" type="number" inputMode="decimal" placeholder={total.toFixed(2)} value={paid} onChange={e => setPaid(e.target.value)} />
          </div>
          <div className="modes">
            {(['Cash', 'Upi', 'Card'] as PaymentMode[]).map(m => <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{modeLabel[m]}</button>)}
          </div>
          {paidNum < total && <p className="note">{money(total - paidNum)} will be added to supplier dues.</p>}
          <button className="btn primary block xl" disabled={busy || lines.some(l => l.qty <= 0)} onClick={save}>{busy ? 'Saving…' : `Save stock in (${lines.length} items)`}</button>
        </section>
      )}

      <section className="card">
        <h2>Recent stock in</h2>
        <ul className="list">
          {recent?.map(r => (
            <li key={r.id} className="list-row">
              <span className="grow"><b>#{r.id}</b> {r.supplier ?? 'Local'} {r.invoiceNo && <span className="muted">· {r.invoiceNo}</span>}<div className="muted small">{dateTime(r.createdAt)} · {r.itemCount} items</div></span>
              <span>{money(r.total)}{r.paidAmount < r.total && <div className="danger small">due {money(r.total - r.paidAmount)}</div>}</span>
            </li>
          ))}
        </ul>
      </section>

      {addSupplier && <SupplierForm onClose={() => setAddSupplier(false)} onSaved={s => { setAddSupplier(false); reloadSuppliers(); setSupplierId(s.id); }} />}
    </div>
  );
}
