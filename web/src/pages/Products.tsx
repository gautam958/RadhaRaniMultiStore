import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readSheet } from 'read-excel-file/browser';
import { api, type Category, type Paged, type Product } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, ErrorBox, Field, Loading, Modal, StockBadge, Thumb } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { compressImage, dateTime, money, qty } from '../lib/util';

const STATUS = [
  { v: '', label: 'All' }, { v: 'NeedsReorder', label: 'Need reorder' }, { v: 'Low', label: 'Low' }, { v: 'OutOfStock', label: 'Out of stock' }
];
const UNITS = ['pcs', 'kg', 'g', 'ltr', 'ml', 'pack', 'box', 'dozen', 'mtr'];
const GST = [0, 5, 12, 18, 28];

export function ProductsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryIdState] = useState(() => Number(params.get('categoryId')) || 0);
  // Keep ?categoryId= in the URL so "View items" from Categories (and the back button) work.
  const setCategoryId = (id: number) => {
    setCategoryIdState(id);
    const next = new URLSearchParams(params);
    if (id) next.set('categoryId', String(id)); else next.delete('categoryId');
    setParams(next, { replace: true });
  };
  const [page, setPage] = useState(1);
  const [scan, setScan] = useState(false);
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [adjust, setAdjust] = useState<Product | null>(null);
  const [history, setHistory] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<Product | null>(null);
  const [restoring, setRestoring] = useState<Product | null>(null);
  const showingRemoved = status === 'Removed';

  const q = useDebounced(search.trim());
  const path = `/api/products?page=${page}&pageSize=50&active=all${q ? `&search=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${categoryId ? `&categoryId=${categoryId}` : ''}`;
  const { data, error, loading, reload } = useApi<Paged<Product>>(path);
  const { data: cats, reload: reloadCats } = useApi<Category[]>('/api/categories');
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  async function exportCsv() {
    const all = await api<Paged<Product>>('/api/products?pageSize=500&active=all');
    const cols = ['name', 'nameHindi', 'categoryName', 'brand', 'sku', 'barcode', 'unit', 'mrp', 'sellingPrice', 'costPrice', 'discountPercent', 'gstRate', 'hsn', 'reorderLevel', 'qtyOnHand'] as const;
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.join(',').replace('categoryName', 'category').replace('qtyOnHand', 'qty'), ...all.items.map(p => cols.map(c => esc(p[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `items-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="page">
      <div className="row between wrap">
        <h1>Items {data && <span className="muted">({data.total})</span>}</h1>
        {can('Manager') && (
          <div className="row gap wrap">
            <button className="btn ghost" onClick={exportCsv}>⇩ Export</button>
            <button className="btn ghost" onClick={() => setImporting(true)}>⇧ Import Excel</button>
            <button className="btn primary" onClick={() => setEdit('new')}>+ Add item</button>
          </div>
        )}
      </div>

      <div className="filters">
        <div className="search-row">
          <input className="input" placeholder="Search name, brand, barcode…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <button className="btn" onClick={() => setScan(true)} aria-label="Scan">📷</button>
        </div>
        <div className="chips">
          {[...STATUS, ...(can('Manager') ? [{ v: 'Removed', label: '🗑 Removed' }] : [])].map(s => (
            <button key={s.v} className={`chip ${status === s.v ? 'on' : ''}`}
              onClick={() => { const next = new URLSearchParams(params); if (s.v) next.set('status', s.v); else next.delete('status'); setParams(next); setPage(1); }}>{s.label}</button>
          ))}
          <select className="input sm" value={categoryId} onChange={e => { setCategoryId(Number(e.target.value)); setPage(1); }}>
            <option value={0}>All categories</option>
            {cats?.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (hidden)'}</option>)}
            <option value={-1}>No category</option>
          </select>
        </div>
      </div>
      {scan && <Scanner onScan={code => setSearch(code)} onClose={() => setScan(false)} />}

      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && (showingRemoved
        ? <Empty>No removed items. Removed items appear here and can be restored.</Empty>
        : <Empty>No items found. {can('Manager') && 'Add your first item or import from Excel.'}</Empty>)}

      <div className="product-list">
        {data?.items.map(p => (
          <article key={p.id} className={`card product-row ${p.isActive ? '' : 'inactive'}`}>
            <Thumb url={p.imageUrl} name={p.name} size={56} />
            <div className="grow">
              <b>{p.name}</b> {p.nameHindi && <span className="muted">{p.nameHindi}</span>}
              <div className="muted small">{[p.categoryName, p.brand, p.barcode].filter(Boolean).join(' · ')}</div>
              <div className="price">
                {p.mrp > p.effectivePrice && <s>{money(p.mrp)}</s>} <b>{money(p.effectivePrice)}</b>
                {p.discountPercent > 0 && <span className="off inline">{p.discountPercent}% off</span>}
                {p.costPrice != null && <span className="muted small"> · cost {money(p.costPrice)}</span>}
              </div>
            </div>
            {showingRemoved ? (
              <div className="row-actions">
                <span className="badge OutOfStock">Removed {p.deletedAt ? dateTime(p.deletedAt) : ''}</span>
                <span className="muted small">{p.deletedBy?.split('@')[0]}{p.deletedReason ? ` · ${p.deletedReason}` : ''}</span>
                <button className="btn sm primary" onClick={() => setRestoring(p)}>↺ Restore</button>
              </div>
            ) : (
            <div className="row-actions">
              <StockBadge p={p} />
              {can('Manager') && (
                <div className="row gap">
                  <button className="btn sm" onClick={() => setAdjust(p)}>± Stock</button>
                  <button className="btn sm ghost" onClick={() => setHistory(p)}>History</button>
                  <button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button>
                </div>
              )}
            </div>
            )}
          </article>
        ))}
      </div>

      {pages > 1 && (
        <div className="row gap center pager">
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span>{page} / {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}

      {edit && <ProductForm product={edit === 'new' ? null : edit} categories={cats ?? []}
        onCategoryAdded={reloadCats} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }}
        onRemove={edit === 'new' ? undefined : () => { setRemoving(edit); setEdit(null); }} />}
      {removing && <RemoveDialog product={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); reload(); }} />}
      {restoring && <RestoreDialog product={restoring} onClose={() => setRestoring(null)} onDone={() => { setRestoring(null); reload(); }} />}
      {adjust && <AdjustForm product={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); reload(); }} />}
      {history && <History product={history} onClose={() => setHistory(null)} />}
      {importing && <ImportForm onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); reloadCats(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProductForm({ product, categories, onClose, onSaved, onCategoryAdded, onRemove }: {
  product: Product | null; categories: Category[]; onClose: () => void; onSaved: () => void; onCategoryAdded: () => void;
  onRemove?: () => void;
}) {
  const [f, setF] = useState({
    name: product?.name ?? '', nameHindi: product?.nameHindi ?? '', categoryId: product?.categoryId ?? 0,
    brand: product?.brand ?? '', sku: product?.sku ?? '', barcode: product?.barcode ?? '', unit: product?.unit ?? 'pcs',
    mrp: product?.mrp ?? 0, sellingPrice: product?.sellingPrice ?? 0, costPrice: product?.costPrice ?? 0,
    discountPercent: product?.discountPercent ?? 0, gstRate: product?.gstRate ?? 0, hsn: product?.hsn ?? '',
    reorderLevel: product?.reorderLevel ?? 5, isActive: product?.isActive ?? true, openingQty: 0
  });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const effective = Math.round(f.sellingPrice * (1 - f.discountPercent / 100) * 100) / 100;
  const margin = f.costPrice > 0 ? effective - f.costPrice : null;

  async function pickPhoto(file?: File) {
    if (!file) return;
    try { const b = await compressImage(file); setPhoto(b); setPreview(URL.createObjectURL(b)); }
    catch (e) { toast((e as Error).message || 'Could not read that photo', 'err'); }
  }

  async function addCategory() {
    const name = prompt('New category name');
    if (!name?.trim()) return;
    try { const c = await api<Category>('/api/categories', { body: { name } }); onCategoryAdded(); setF({ ...f, categoryId: c.id }); }
    catch (e) { toast((e as Error).message, 'err'); }
  }

  async function save() {
    setBusy(true);
    try {
      const body = { ...f, categoryId: f.categoryId || null, openingQty: product ? null : f.openingQty };
      const saved = product
        ? await api<Product>(`/api/products/${product.id}`, { method: 'PUT', body })
        : await api<Product>('/api/products', { body });
      if (photo) {
        try { await api(`/api/products/${saved.id}/image`, { method: 'PUT', raw: photo }); }
        catch (e) {
          // The item itself is saved — close the form so a retry can't create a duplicate.
          toast(`${product ? 'Item updated' : 'Item added'}, but the photo failed: ${(e as Error).message}. Use Edit to add it again.`, 'err');
          onSaved();
          return;
        }
      }
      toast(product ? 'Item updated' : 'Item added');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={product ? `Edit ${product.name}` : 'Add item'} onClose={onClose} wide>
      <div className="form-grid">
        <div className="photo-field span-2">
          <label className="photo-pick">
            {preview || product?.imageUrl
              ? <img src={preview ?? `${import.meta.env.VITE_API_BASE ?? ''}${product!.imageUrl}`} alt="" />
              : <span>📷<br />Add photo</span>}
            <input type="file" accept="image/*" capture="environment" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
          </label>
          <div className="grow stack">
            <Field label="Item name *"><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
            <Field label="Name in Hindi"><input className="input" value={f.nameHindi} onChange={set('nameHindi')} /></Field>
          </div>
        </div>

        <Field label="Barcode">
          <div className="search-row">
            <input className="input" inputMode="numeric" value={f.barcode} onChange={set('barcode')} />
            <button type="button" className="btn" onClick={() => setScan(true)}>📷</button>
          </div>
        </Field>
        <Field label="Category">
          <div className="search-row">
            <select className="input" value={f.categoryId} onChange={set('categoryId')}>
              <option value={0}>—</option>
              {categories.filter(c => c.isActive || c.id === product?.categoryId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn" onClick={addCategory}>+</button>
          </div>
        </Field>
        {scan && <div className="span-2"><Scanner onScan={code => setF(x => ({ ...x, barcode: code }))} onClose={() => setScan(false)} /></div>}

        <Field label="Brand"><input className="input" value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Unit">
          <select className="input" value={f.unit} onChange={set('unit')}>{UNITS.map(u => <option key={u}>{u}</option>)}</select>
        </Field>

        <Field label="MRP ₹"><input className="input" type="number" inputMode="decimal" value={f.mrp || ''} onChange={set('mrp')} /></Field>
        <Field label="Selling price ₹ *"><input className="input" type="number" inputMode="decimal" value={f.sellingPrice || ''} onChange={set('sellingPrice')} /></Field>
        <Field label="Discount %" hint={f.discountPercent > 0 ? `Customer pays ${money(effective)}` : undefined}>
          <input className="input" type="number" inputMode="decimal" value={f.discountPercent || ''} onChange={set('discountPercent')} />
        </Field>
        <Field label="Cost price ₹" hint={margin != null ? `Margin ${money(margin)} (${((margin / effective) * 100 || 0).toFixed(0)}%)` : undefined}>
          <input className="input" type="number" inputMode="decimal" value={f.costPrice || ''} onChange={set('costPrice')} />
        </Field>

        <Field label="GST %">
          <select className="input" value={f.gstRate} onChange={set('gstRate')}>{GST.map(g => <option key={g} value={g}>{g}%</option>)}</select>
        </Field>
        <Field label="HSN code"><input className="input" value={f.hsn} onChange={set('hsn')} /></Field>
        <Field label="Low-stock alert at" hint="Shows on dashboard when stock reaches this">
          <input className="input" type="number" inputMode="decimal" value={f.reorderLevel} onChange={set('reorderLevel')} />
        </Field>
        {!product
          ? <Field label="Opening stock"><input className="input" type="number" inputMode="decimal" value={f.openingQty || ''} onChange={set('openingQty')} /></Field>
          : <Field label="SKU / item code"><input className="input" value={f.sku} onChange={set('sku')} /></Field>}

        {product && <label className="check span-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Active (can be sold)</label>}
        {margin != null && margin < 0 && <p className="note danger span-2">Selling below cost price!</p>}
      </div>
      <div className="row gap end" style={{ marginTop: 16 }}>
        {onRemove && <button className="btn danger-btn" style={{ marginRight: 'auto' }} onClick={onRemove}>🗑 Remove item</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !f.name.trim() || f.sellingPrice <= 0} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button>
      </div>
    </Modal>
  );
}

function AdjustForm({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'Adjustment' | 'Damage'>('Adjustment');
  const [counted, setCounted] = useState<string>('');
  const [damaged, setDamaged] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const delta = type === 'Adjustment' ? (counted === '' ? 0 : Number(counted) - product.qtyOnHand) : -Math.abs(Number(damaged) || 0);

  async function save() {
    setBusy(true);
    try {
      await api('/api/stock/adjust', { body: { productId: product.id, qty: delta, type, note: note || (type === 'Adjustment' ? 'Physical count' : 'Damaged') } });
      toast('Stock updated');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Stock · ${product.name}`} onClose={onClose}>
      <p>System stock: <b>{qty(product.qtyOnHand)} {product.unit}</b></p>
      <div className="seg">
        <button className={type === 'Adjustment' ? 'on' : ''} onClick={() => setType('Adjustment')}>Recount</button>
        <button className={type === 'Damage' ? 'on' : ''} onClick={() => setType('Damage')}>Damaged / expired</button>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {type === 'Adjustment'
          ? <Field label="Actual count on shelf"><input className="input" autoFocus type="number" inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} /></Field>
          : <Field label="Quantity damaged"><input className="input" autoFocus type="number" inputMode="decimal" value={damaged} onChange={e => setDamaged(e.target.value)} /></Field>}
        <Field label="Reason / note"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        {delta !== 0 && <p className={delta > 0 ? 'save' : 'danger'}>Change: {delta > 0 ? '+' : ''}{qty(delta)} → new stock {qty(product.qtyOnHand + delta)}</p>}
        <p className="muted small">New stock from suppliers? Use <b>Stock In</b> instead so cost and supplier dues are recorded.</p>
        <button className="btn primary block" disabled={busy || delta === 0} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

/** Two-step confirmation: (1) explain consequences, (2) type REMOVE + give a reason. */
function RemoveDialog({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/products/${product.id}/remove`, { body: { confirm, reason } });
      toast(`${product.name} removed. You can restore it from Items → Removed.`);
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={step === 1 ? 'Remove this item?' : 'Confirm removal'} onClose={onClose}>
      {step === 1 ? (
        <div className="stack">
          <div className="row gap"><Thumb url={product.imageUrl} name={product.name} size={48} /><div><b>{product.name}</b><div className="muted small">Stock: {qty(product.qtyOnHand)} {product.unit}</div></div></div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>It will disappear from Billing, Stock In, Items and the dashboard.</li>
            <li>Old bills, stock history and khata entries are <b>kept</b>.</li>
            <li>You can bring it back any time from <b>Items → Removed → Restore</b>.</li>
          </ul>
          {product.qtyOnHand > 0 && <p className="note">This item still has {qty(product.qtyOnHand)} {product.unit} in stock.</p>}
          <div className="row gap end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger-btn" onClick={() => setStep(2)}>Yes, continue</button></div>
        </div>
      ) : (
        <div className="stack">
          <Field label="Reason"><input className="input" autoFocus placeholder="e.g. discontinued, duplicate entry" value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <Field label="Type REMOVE to confirm"><input className="input" autoCapitalize="characters" value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} /></Field>
          <div className="row gap end">
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn danger-btn" disabled={busy || confirm !== 'REMOVE' || !reason.trim()} onClick={remove}>{busy ? 'Removing…' : 'Remove item'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RestoreDialog({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    try { await api(`/api/products/${product.id}/restore`, { method: 'POST' }); toast(`${product.name} restored`); onDone(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Restore item?" onClose={onClose}>
      <div className="stack">
        <p><b>{product.name}</b> will be back in Billing, Stock In and Items with its stock of {qty(product.qtyOnHand)} {product.unit}.</p>
        <div className="row gap end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={restore}>↺ Restore</button></div>
      </div>
    </Modal>
  );
}

interface Movement { id: number; qty: number; qtyAfter: number; type: string; note?: string; refType?: string; refId?: number; userEmail: string; createdAt: string }

function History({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data } = useApi<Movement[]>(`/api/stock/movements?productId=${product.id}&take=100`);
  return (
    <Modal title={`History · ${product.name}`} onClose={onClose} wide>
      {!data ? <Loading /> : data.length === 0 ? <Empty>No stock movements yet.</Empty> : (
        <table className="table">
          <thead><tr><th>When</th><th>Type</th><th className="num">Change</th><th className="num">Stock</th><th>By / note</th></tr></thead>
          <tbody>
            {data.map(m => (
              <tr key={m.id}>
                <td>{dateTime(m.createdAt)}</td>
                <td>{m.type}{m.refType === 'Sale' ? ` RR-${String(m.refId).padStart(6, '0')}` : m.refId ? ` #${m.refId}` : ''}</td>
                <td className={`num ${m.qty > 0 ? 'save' : 'danger'}`}>{m.qty > 0 ? '+' : ''}{qty(m.qty)}</td>
                <td className="num">{qty(m.qtyAfter)}</td>
                <td className="muted small">{m.userEmail.split('@')[0]}{m.note ? ` · ${m.note}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// Column headers accepted in the Excel / CSV file (case-insensitive).
const IMPORT_COLS = ['name', 'nameHindi', 'category', 'brand', 'sku', 'barcode', 'unit', 'mrp', 'sellingPrice', 'costPrice', 'discountPercent', 'gstRate', 'hsn', 'reorderLevel', 'qty'];
const NUMERIC = new Set(['mrp', 'sellingPrice', 'costPrice', 'discountPercent', 'gstRate', 'reorderLevel', 'qty']);

function ImportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file?: File) {
    if (!file) return;
    try {
      const grid: unknown[][] = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : (await readSheet(file)) as unknown[][];
      const header = grid[0].map(h => String(h ?? '').trim());
      const map = header.map(h => IMPORT_COLS.find(c => c.toLowerCase() === h.toLowerCase().replace(/[\s_]/g, '')) ?? null);
      if (!map.includes('name')) { toast('First row must have column headers incl. "name"', 'err'); return; }
      setRows(grid.slice(1).filter(r => r.some(c => c !== null && c !== '')).map(r => {
        const o: Record<string, unknown> = {};
        map.forEach((k, i) => {
          if (!k) return;
          const v = r[i];
          o[k] = v === '' || v == null ? null : NUMERIC.has(k) ? Number(v) : String(v);
        });
        return o;
      }));
    } catch (e) { toast(`Could not read file: ${(e as Error).message}`, 'err'); }
  }

  async function upload() {
    if (!rows) return;
    setBusy(true);
    try { setResult(await api('/api/products/import', { body: rows })); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  function template() {
    const csv = IMPORT_COLS.join(',') + '\nParle-G 250g,पारले-जी,Biscuits,Parle,,8901719110016,pcs,25,25,21,0,5,1905,10,48\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'items-template.csv';
    a.click();
  }

  return (
    <Modal title="Import items from Excel / CSV" onClose={onClose} wide>
      {result ? (
        <div className="stack">
          <p>✅ Created <b>{result.created}</b>, updated <b>{result.updated}</b> items.</p>
          {result.errors.length > 0 && <div className="error-box"><b>{result.errors.length} rows skipped:</b><ul>{result.errors.slice(0, 20).map(e => <li key={e}>{e}</li>)}</ul></div>}
          <button className="btn primary" onClick={onDone}>Done</button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Columns: <code>{IMPORT_COLS.join(', ')}</code>. Existing items are matched by barcode, then SKU, then name. For existing items, <code>qty</code> sets stock to that count (recount).</p>
          <button className="btn ghost" onClick={template}>⇩ Download template</button>
          <input type="file" accept=".xlsx,.csv" onChange={e => readFile(e.target.files?.[0])} />
          {rows && (
            <>
              <p><b>{rows.length}</b> rows ready. First few:</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Barcode</th><th className="num">Price</th><th className="num">Qty</th></tr></thead>
                  <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}><td>{String(r.name ?? '')}</td><td>{String(r.barcode ?? '')}</td><td className="num">{String(r.sellingPrice ?? '')}</td><td className="num">{String(r.qty ?? '')}</td></tr>)}</tbody>
                </table>
              </div>
              <button className="btn primary" disabled={busy} onClick={upload}>{busy ? 'Importing…' : `Import ${rows.length} rows`}</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
