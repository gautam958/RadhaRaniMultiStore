import { useState } from 'react';
import { api, type AppUser, type Role } from '../lib/api';
import { useApi, toast } from '../lib/hooks';
import { Field, Loading, Modal } from '../components/ui';
import { dateTime } from '../lib/util';

const ROLES: { r: Role; desc: string }[] = [
  { r: 'Cashier', desc: 'Billing, view items, add customers, receive udhaar. No cost prices.' },
  { r: 'Manager', desc: 'Everything a cashier can do + add/edit items, stock in, adjust stock, cancel bills, day book.' },
  { r: 'Owner', desc: 'Full access incl. profit, stock value, supplier payments and staff.' }
];

export function UsersPage() {
  const { data, loading, reload } = useApi<AppUser[]>('/api/users');
  const [edit, setEdit] = useState<Partial<AppUser> | null>(null);

  async function save() {
    if (!edit) return;
    try {
      await api('/api/users', { body: { email: edit.email, name: edit.name, role: edit.role ?? 'Cashier', isActive: edit.isActive ?? true } });
      toast('Saved'); setEdit(null); reload();
    } catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <div className="page">
      <div className="row between"><h1>Staff</h1><button className="btn primary" onClick={() => setEdit({ role: 'Cashier', isActive: true })}>+ Add staff</button></div>
      <p className="muted">Add the Google (Gmail) address each person will sign in with.</p>
      {loading && !data && <Loading />}
      <div className="product-list">
        {data?.map(u => (
          <article key={u.id} className={`card product-row ${u.isActive ? '' : 'inactive'}`}>
            <div className="grow"><b>{u.name || u.email}</b><div className="muted small">{u.email} · last login {u.lastLoginAt ? dateTime(u.lastLoginAt) : 'never'}</div></div>
            <div className="row-actions">
              <span className="badge">{u.isActive ? u.role : 'Disabled'}</span>
              <button className="btn sm ghost" onClick={() => setEdit(u)}>Edit</button>
            </div>
          </article>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit staff' : 'Add staff'} onClose={() => setEdit(null)}>
          <div className="stack">
            <Field label="Google email"><input className="input" type="email" disabled={!!edit.id} value={edit.email ?? ''} onChange={e => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Name"><input className="input" value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            {ROLES.map(x => (
              <label key={x.r} className={`role-opt ${edit.role === x.r ? 'on' : ''}`}>
                <input type="radio" name="role" checked={edit.role === x.r} onChange={() => setEdit({ ...edit, role: x.r })} />
                <div><b>{x.r}</b><div className="muted small">{x.desc}</div></div>
              </label>
            ))}
            <label className="check"><input type="checkbox" checked={edit.isActive ?? true} onChange={e => setEdit({ ...edit, isActive: e.target.checked })} /> Can sign in</label>
            <button className="btn primary block" disabled={!edit.email?.includes('@')} onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
