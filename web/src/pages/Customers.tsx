import { useState } from 'react';
import { api, type Customer, type Sale } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, Field, Loading, Modal } from '../components/ui';
import { PayModal } from './Suppliers';
import { Receipt, whatsappBillText, whatsappLink } from '../components/Receipt';
import { dateTime, money, shop, modeLabel, plural } from '../lib/util';

/** Customers: contact details, purchase history, udhaar (khata), payments and WhatsApp reminders. */
export function CustomersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const q = useDebounced(search.trim());
  const { data, loading, reload } = useApi<Customer[]>(`/api/customers?withDueOnly=${dueOnly}${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  const [add, setAdd] = useState(false);
  const [pay, setPay] = useState<Customer | null>(null);
  const [view, setView] = useState<Customer | null>(null);
  const [opening, setOpening] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const totalDue = data?.reduce((s, c) => s + Math.max(0, c.due), 0) ?? 0;

  const reminder = (c: Customer) =>
    whatsappLink(c.phone, `Namaste ${c.name} ji 🙏\nAapka ${shop.name} mein ${money(c.due)} baaki hai. Kripya suvidha anusaar bhugtan karein.${shop.upiId ? `\nUPI: ${shop.upiId}` : ''}\nDhanyavaad!`);

  return (
    <div className="page">
      <div className="row between">
        <h1>Customers {data && <span className="muted">({data.length})</span>}</h1>
        <button className="btn primary" onClick={() => setAdd(true)}>+ Add customer</button>
      </div>
      <div className="filters">
        <input className="input" placeholder="Search name, phone or email" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="chips">
          <button className={`chip ${!dueOnly ? 'on' : ''}`} onClick={() => setDueOnly(false)}>All</button>
          <button className={`chip ${dueOnly ? 'on' : ''}`} onClick={() => setDueOnly(true)}>With udhaar</button>
          <span className="muted">Total to collect: <b>{money(totalDue)}</b></span>
        </div>
      </div>
      {loading && !data && <Loading />}
      {data?.length === 0 && <Empty>{q || dueOnly ? 'No customers match.' : 'No customers yet. Add one here or while billing.'}</Empty>}
      <div className="product-list">
        {data?.map(c => (
          <article key={c.id} className="card product-row">
            <div className="avatar">{c.name.slice(0, 1).toUpperCase()}</div>
            <button className="grow text-left" onClick={() => setView(c)}>
              <b>{c.name}</b>
              <div className="muted small">{[c.phone, c.email, c.address].filter(Boolean).join(' · ') || 'No phone'}</div>
              <div className="muted small">
                {c.billCount ? `${plural(c.billCount, 'bill')} · ${money(c.totalPurchases)} total · last ${dateTime(c.lastBillAt!)}` : 'No bills yet'}
                {c.creditLimit > 0 ? ` · limit ${money(c.creditLimit)}` : ''}
              </div>
            </button>
            <div className="row-actions">
              <DueBadge due={c.due} />
              <div className="row gap">
                {c.due > 0 && <button className="btn sm primary" onClick={() => setPay(c)}>Receive</button>}
                {c.due > 0 && c.phone && <a className="btn sm ghost" href={reminder(c)} target="_blank" rel="noreferrer">Remind</a>}
                <button className="btn sm ghost" onClick={() => setView(c)}>View</button>
                <button className="btn sm ghost" onClick={() => setEditing(c)}>Edit</button>
                {can('Owner') && <button className="btn sm ghost" onClick={() => setOpening(c)}>Old balance</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {add && <CustomerForm onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); }} />}
      {editing && <CustomerForm customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {pay && <PayModal title={`Receive from ${pay.name}`} due={pay.due} url={`/api/customers/${pay.id}/payments`} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />}
      {view && <CustomerDetail customer={view} onClose={() => setView(null)} />}
      {opening && <OpeningBalance customer={opening} onClose={() => setOpening(null)} onSaved={() => { setOpening(null); reload(); }} />}
    </div>
  );
}

/** Due > 0: customer owes the shop. Due < 0: shop holds customer's money (advance / refund due). */
function DueBadge({ due }: { due: number }) {
  if (due > 0.004) return <span className="badge Low">Due {money(due)}</span>;
  if (due < -0.004) return <span className="badge Advance" title="Customer has paid more than they owe — adjust on next bill or refund">Advance {money(-due)}</span>;
  return <span className="badge InStock">Clear</span>;
}

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', address: customer?.address ?? '', creditLimit: customer?.creditLimit ?? 0
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const c = customer
        ? await api<Customer>(`/api/customers/${customer.id}`, { method: 'PUT', body: f })
        : await api<Customer>('/api/customers', { body: f });
      toast(customer ? 'Customer updated' : 'Customer added');
      onSaved(c);
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={customer ? `Edit ${customer.name}` : 'Add customer'} onClose={onClose}>
      <div className="stack">
        <Field label="Name *"><input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile"><input className="input" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" inputMode="email" autoCapitalize="none" placeholder="optional" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Address"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        {can('Manager') && <Field label="Udhaar limit ₹" hint="0 = no limit"><input className="input" type="number" inputMode="decimal" value={f.creditLimit || ''} onChange={e => setF({ ...f, creditLimit: Number(e.target.value) })} /></Field>}
        <button className="btn primary block" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

/** Customer detail: Khata (udhaar statement) and Bills (purchase history). */
function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [tab, setTab] = useState<'khata' | 'bills'>(customer.due > 0 ? 'khata' : 'bills');
  return (
    <Modal title={customer.name} onClose={onClose} wide>
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <span className="muted">
          {customer.phone}{customer.email && <> · <a className="link" href={`mailto:${customer.email}`}>{customer.email}</a></>}{customer.address ? ` · ${customer.address}` : ''}
        </span>
        <DueBadge due={customer.due} />
      </div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'bills' ? 'on' : ''} onClick={() => setTab('bills')}>Bills ({customer.billCount ?? 0})</button>
        <button className={tab === 'khata' ? 'on' : ''} onClick={() => setTab('khata')}>Khata</button>
      </div>
      {tab === 'khata' ? <Statement customer={customer} /> : <CustomerBills customer={customer} />}
    </Modal>
  );
}

function CustomerBills({ customer }: { customer: Customer }) {
  const { data } = useApi<Sale[]>(`/api/sales?customerId=${customer.id}`);
  const [open, setOpen] = useState<Sale | null>(null);
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty>No bills for this customer yet.</Empty>;
  if (open) return (
    <div className="stack">
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(null)}>‹ All bills</button>
      <Receipt sale={open} />
      <div className="row gap no-print">
        <button className="btn" onClick={() => window.print()}>🖨 Print</button>
        <a className="btn" target="_blank" rel="noreferrer" href={whatsappLink(open.customerPhone, whatsappBillText(open))}>WhatsApp</a>
      </div>
    </div>
  );
  return (
    <ul className="list">
      {data.map(s => (
        <li key={s.id}>
          <button className={`list-row btn-row ${s.status === 'Voided' ? 'voided' : ''}`} onClick={() => setOpen(s)}>
            <span className="grow"><b>{s.billNo}</b> <span className="muted">{dateTime(s.createdAt)}</span>
              <div className="muted small">{s.items.length} items{s.remarks ? ` · 📝 ${s.remarks}` : ''}</div></span>
            <span className="badge">{modeLabel[s.paymentMode]}</span>
            <b>{money(s.total)}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface StatementData { due: number; lines: { id: number; entryDate: string; category: string; mode: string; debit: number; credit: number; balance: number; narration?: string }[] }

function Statement({ customer }: { customer: Customer }) {
  const { data } = useApi<StatementData>(`/api/customers/${customer.id}/statement`);
  return (
    <>
      {!data ? <Loading /> : data.lines.length === 0 ? <Empty>No udhaar entries.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Details</th><th className="num">Udhaar</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {data.lines.map(l => (
                <tr key={l.id}>
                  <td>{dateTime(l.entryDate)}</td>
                  <td>{l.narration}{l.credit > 0 && l.category === 'CustomerPayment' ? ` (${modeLabel[l.mode]})` : ''}</td>
                  <td className="num danger">{l.debit ? money(l.debit) : ''}</td>
                  <td className="num save">{l.credit ? money(l.credit) : ''}</td>
                  <td className="num"><b>{money(l.balance)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OpeningBalance({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  async function save() {
    try { await api('/api/ledger/opening', { body: { amount: Number(amount), customerId: customer.id, narration: 'Old khata balance (paper register)' } }); toast('Saved'); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <Modal title={`Old balance · ${customer.name}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">Bring over what this customer owed in your paper register before you started using the app.</p>
        <Field label="Amount owed ₹"><input className="input" autoFocus type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <button className="btn primary block" disabled={!(Number(amount) > 0)} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
