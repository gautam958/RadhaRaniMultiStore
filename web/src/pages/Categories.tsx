import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Category } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, ErrorBox, Field, Loading, Modal } from '../components/ui';
import { money } from '../lib/util';

interface Stats {
  itemCount: number; activeCount: number; outOfStock: number; low: number;
  stockAtPrice: number; stockAtCost?: number | null; sales30d: number; profit30d?: number | null;
}
interface CategoryRow extends Category { stats: Stats }
interface CategoryList { categories: CategoryRow[]; uncategorised: Stats }

type Show = 'all' | 'active' | 'hidden';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function CategoriesPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<CategoryList>('/api/categories?stats=true');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase());
  const [show, setShow] = useState<Show>('all');
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  const list = useMemo(() => (data?.categories ?? [])
    .filter(c => show === 'all' || (show === 'active' ? c.isActive : !c.isActive))
    .filter(c => !q || c.name.toLowerCase().includes(q)), [data, show, q]);
  const nextOrder = Math.max(0, ...(data?.categories ?? []).map(c => c.sortOrder)) + 1;
  const u = data?.uncategorised;

  return (
    <div className="page">
      <div className="row between"><h1>Categories</h1><button className="btn primary" onClick={() => setAdd(true)}>+ Add category</button></div>

      {data && (
        <div className="filters">
          <div className="search-row"><input className="input" placeholder="Search categories" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="chips">
            {([['all', `All (${data.categories.length})`], ['active', 'In use'], ['hidden', 'Hidden']] as [Show, string][]).map(([v, l]) => (
              <button key={v} className={`chip ${show === v ? 'on' : ''}`} onClick={() => setShow(v)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data?.categories.length === 0 && <Empty>No categories yet. Add groups like Snacks, Grocery, Cosmetics, Pan masala — then pick one when adding an item.</Empty>}
      {!!data?.categories.length && list.length === 0 && <Empty>No categories match.</Empty>}

      <div className="product-list">
        {list.map(c => (
          <article key={c.id} className={`card product-row cat-row ${c.isActive ? '' : 'inactive'}`}>
            <div className="grow">
              <b>{c.name}</b>{!c.isActive && <span className="badge" style={{ marginLeft: 6 }}>Hidden</span>}
              <div className="muted small">
                {plural(c.stats.itemCount, 'item')}
                {c.stats.outOfStock > 0 && <> · <span className="danger">{c.stats.outOfStock} out of stock</span></>}
                {c.stats.low > 0 && <> · <span className="warn-text">{c.stats.low} low</span></>}
              </div>
              <div className="muted small">
                Stock {money(c.stats.stockAtPrice)}{c.stats.stockAtCost != null && <> (cost {money(c.stats.stockAtCost)})</>}
                {' · '}Sold {money(c.stats.sales30d)} in 30 days{c.stats.profit30d != null && c.stats.sales30d > 0 && <>, profit {money(c.stats.profit30d)}</>}
              </div>
            </div>
            <div className="row-actions">
              <Link className="btn sm" to={`/products?categoryId=${c.id}`}>View items</Link>
              <div className="row gap">
                <button className="btn sm ghost" onClick={() => setEditing(c)}>Edit</button>
                {can('Manager') && <button className="btn sm ghost danger-text" onClick={() => setDeleting(c)}>Delete</button>}
              </div>
            </div>
          </article>
        ))}
        {u && u.itemCount > 0 && show !== 'hidden' && !q && (
          <article className="card product-row cat-row none">
            <div className="grow"><b>No category</b>
              <div className="muted small">{plural(u.itemCount, 'item')} without a category · stock {money(u.stockAtPrice)}</div>
              <div className="muted small">Give them a category in Items → Edit, so reports group them properly.</div>
            </div>
            <div className="row-actions"><Link className="btn sm" to="/products?categoryId=-1">View items</Link></div>
          </article>
        )}
      </div>

      {add && <CategoryForm nextOrder={nextOrder} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); }} />}
      {editing && <CategoryForm category={editing} nextOrder={nextOrder} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && <DeleteCategory category={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); reload(); }} />}
    </div>
  );
}

function CategoryForm({ category, nextOrder, onClose, onSaved }: { category?: CategoryRow; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: category?.name ?? '', sortOrder: String(category?.sortOrder ?? nextOrder), isActive: category?.isActive ?? true });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = { name: f.name, sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive };
      if (category) await api(`/api/categories/${category.id}`, { method: 'PUT', body });
      else await api('/api/categories', { body });
      toast(category ? 'Category updated' : 'Category added');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={category ? `Edit ${category.name}` : 'Add category'} onClose={onClose}>
      <div className="stack">
        <Field label="Name *"><input className="input" autoFocus value={f.name} maxLength={60} placeholder="e.g. Snacks, Grocery, Cosmetics"
          onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && f.name.trim() && save()} /></Field>
        <Field label="Display order" hint="Smaller numbers show first in lists and the item form.">
          <input className="input" type="number" inputMode="numeric" value={f.sortOrder} onChange={e => setF({ ...f, sortOrder: e.target.value })} />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={f.isActive} onChange={e => setF({ ...f, isActive: e.target.checked })} />
          <span>Show in the item form<div className="muted small">Untick to hide an old category from new items. Existing items keep it.</div></span>
        </label>
        <button className="btn primary block" disabled={busy || !f.name.trim()} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

function DeleteCategory({ category, onClose, onDone }: { category: CategoryRow; onClose: () => void; onDone: () => void }) {
  const n = category.stats.itemCount;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const needsConfirm = n > 0;
  async function del() {
    setBusy(true);
    try {
      const r = await api<{ movedItems: number }>(`/api/categories/${category.id}/delete`, { body: {} });
      toast(r.movedItems ? `Deleted · ${plural(r.movedItems, 'item')} moved to No category` : 'Category deleted');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={`Delete ${category.name}?`} onClose={onClose}>
      <div className="stack">
        {needsConfirm ? (
          <>
            <p className="note">{plural(n, 'item')} in this category will move to <b>No category</b>. The items, their stock and old bills are not affected.</p>
            <p className="muted small">If you only want to stop using it, <b>Edit → untick "Show in the item form"</b> instead.</p>
            <Field label={`Type DELETE to confirm`}><input className="input" autoFocus value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" /></Field>
          </>
        ) : <p>This category has no items. It will be removed.</p>}
        <div className="row gap">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger-btn grow" disabled={busy || (needsConfirm && typed.trim().toUpperCase() !== 'DELETE')} onClick={del}>Delete category</button>
        </div>
      </div>
    </Modal>
  );
}
