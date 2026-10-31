import { useState } from 'react';
import { api, type PaymentMode, type Supplier } from '../lib/api';
import { useApi, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, Field, Loading, Modal } from '../components/ui';
import { modeLabel, money } from '../lib/util';

export function SuppliersPage() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<Supplier[]>('/api/suppliers');
  const [add, setAdd] = useState(false);
  const [pay, setPay] = useState<Supplier | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);

  return (
    <div className="page">
      <div className="row between"><h1>Suppliers</h1><button className="btn primary" onClick={() => setAdd(true)}>+ Add supplier</button></div>
      {loading && !data && <Loading />}
      {data?.length === 0 && <Empty>No suppliers yet.</Empty>}
      <div className="product-list">
        {data?.map(s => (
          <article key={s.id} className="card product-row">
            <div className="grow"><b>{s.name}</b><div className="muted small">{[s.phone, s.email, s.gstin].filter(Boolean).join(' · ')}</div></div>
            <div className="row-actions">
              <span className={`badge ${s.due > 0 ? 'Low' : 'InStock'}`}>{s.due > 0 ? `We owe ${money(s.due)}` : 'No dues'}</span>
              <div className="row gap">
                {can('Owner') && s.due > 0 && <button className="btn sm" onClick={() => setPay(s)}>Pay</button>}
                <button className="btn sm ghost" onClick={() => setEditing(s)}>Edit</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {add && <SupplierForm onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); }} />}
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {pay && <PayModal title={`Pay ${pay.name}`} due={pay.due} url={`/api/suppliers/${pay.id}/payments`} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />}
    </div>
  );
}

export function SupplierForm({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const [f, setF] = useState({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', gstin: supplier?.gstin ?? '', address: supplier?.address ?? '' });
  async function save() {
    try {
      const s = supplier
        ? await api<Supplier>(`/api/suppliers/${supplier.id}`, { method: 'PUT', body: f })
        : await api<Supplier>('/api/suppliers', { body: f });
      onSaved(s); toast(supplier ? 'Supplier updated' : 'Supplier added');
    }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} onClose={onClose}>
      <div className="stack">
        <Field label="Name *"><input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" inputMode="email" autoCapitalize="none" placeholder="optional" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="GSTIN"><input className="input" value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
        <Field label="Address"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <button className="btn primary block" disabled={!f.name.trim()} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

/** Shared by supplier payments (money out) and customer payments (money in). */
export function PayModal({ title, due, url, onClose, onSaved }: { title: string; due: number; url: string; onClose: () => void; onSaved: (newDue: number) => void }) {
  const [amount, setAmount] = useState(due > 0 ? String(due) : '');
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ due: number }>(url, { body: { amount: Number(amount), mode, narration: note || null } });
      toast(`Saved · balance ${money(r.due)}`);
      onSaved(r.due);
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p>Current balance: <b>{money(due)}</b></p>
        <Field label="Amount ₹"><input className="input" autoFocus type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <div className="modes">
          {(['Cash', 'Upi', 'Card'] as PaymentMode[]).map(m => <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{modeLabel[m]}</button>)}
        </div>
        <Field label="Note"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <button className="btn primary block" disabled={busy || !(Number(amount) > 0)} onClick={save}>Save payment</button>
      </div>
    </Modal>
  );
}
