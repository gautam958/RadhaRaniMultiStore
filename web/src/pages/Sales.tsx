import { useMemo, useState } from 'react';
import { api, type PaymentMode, type Sale } from '../lib/api';
import { useApi, useDebounced, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, Field, Loading, Modal, DateInput } from '../components/ui';
import { Receipt, whatsappBillText, whatsappLink } from '../components/Receipt';
import { BillPeek, ItemStrip } from '../components/BillPeek';
import { modeLabel, money, time, todayIso } from '../lib/util';

export function SalesPage() {
  const { can } = useAuth();
  const [date, setDate] = useState(todayIso());
  const { data, loading, reload } = useApi<Sale[]>(`/api/sales?date=${date}`);
  const [open, setOpen] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'All' | PaymentMode>('All');
  const [status, setStatus] = useState<'All' | 'Completed' | 'Voided'>('All');
  const [cashier, setCashier] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase());
  const [newestFirst, setNewestFirst] = useState(true);

  const cashiers = useMemo(() => Array.from(new Set((data ?? []).map(s => s.cashierEmail))).sort(), [data]);
  const shown = useMemo(() => {
    let list = data ?? [];
    if (mode !== 'All') list = list.filter(s => s.paymentMode === mode);
    if (status !== 'All') list = list.filter(s => s.status === status);
    if (cashier) list = list.filter(s => s.cashierEmail === cashier);
    if (q) {
      const digits = q.replace(/\D/g, '');
      list = list.filter(s =>
        s.billNo.toLowerCase().includes(q) || (digits && String(s.id) === digits.replace(/^0+/, '')) ||
        (s.customerName ?? '').toLowerCase().includes(q) || (s.customerPhone ?? '').includes(q) ||
        (s.remarks ?? '').toLowerCase().includes(q) || s.items.some(i => i.productName.toLowerCase().includes(q)));
    }
    return newestFirst ? list : [...list].reverse();
  }, [data, mode, status, cashier, q, newestFirst]);
  const done = shown.filter(s => s.status === 'Completed');
  const cancelled = shown.length - done.length;
  const filtered = mode !== 'All' || status !== 'All' || !!cashier || !!q;
  const clear = () => { setMode('All'); setStatus('All'); setCashier(''); setSearch(''); };

  async function doVoid() {
    if (!open) return;
    try {
      const s = await api<Sale>(`/api/sales/${open.id}/void`, { body: { reason } });
      toast(`Bill ${s.billNo} cancelled, stock returned`);
      setOpen(s); setVoiding(false); setReason(''); reload();
    } catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <div className="page">
      <div className="row between wrap">
        <h1>Bills</h1>
        <DateInput className="input sm" value={date} max={todayIso()} onChange={setDate} aria-label="Bill date" />
      </div>
      <div className="stats">
        {status === 'Voided' ? <>
          <div className="stat card"><small>Cancelled bills</small><b>{cancelled}</b></div>
          <div className="stat card"><small>Cancelled value</small><b>{money(shown.reduce((s, x) => s + x.total, 0))}</b></div>
        </> : <>
          <div className="stat card"><small>Bills{filtered ? ' (filtered)' : ''}</small><b>{done.length}</b>{cancelled > 0 && <span className="muted small">+ {cancelled} cancelled</span>}</div>
          <div className="stat card"><small>Total</small><b>{money(done.reduce((s, x) => s + x.total, 0))}</b></div>
        </>}
        {status !== 'Voided' && <div className="stat card"><small>Discount given</small><b>{money(done.reduce((s, x) => s + x.itemDiscount + x.billDiscount, 0))}</b></div>}
        {can('Owner') && status !== 'Voided' && <div className="stat card"><small>Gross profit</small><b>{money(done.reduce((s, x) => s + (x.profit ?? 0), 0))}</b></div>}
      </div>
      <div className="filters" style={{ marginTop: 14 }}>
        <div className="search-row">
          <input className="input" placeholder="Search bill no, customer, phone, item or remark" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn ghost" onClick={() => setNewestFirst(v => !v)}>{newestFirst ? '↓ Newest' : '↑ Oldest'}</button>
        </div>
        <div className="chips">
          {(['All', 'Cash', 'Upi', 'Card', 'Credit'] as const).map(m => (
            <button key={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m === 'All' ? 'All modes' : modeLabel[m]}</button>
          ))}
          <span className="chip-sep" />
          {([['All', 'All bills'], ['Completed', 'Completed'], ['Voided', 'Cancelled']] as const).map(([v, label]) => (
            <button key={v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>{label}</button>
          ))}
          {can('Manager') && cashiers.length > 1 && (
            <select className="input sm" value={cashier} onChange={e => setCashier(e.target.value)}>
              <option value="">All staff</option>
              {cashiers.map(c => <option key={c} value={c}>{c.split('@')[0]}</option>)}
            </select>
          )}
          {filtered && <button className="link" onClick={clear}>Clear filters</button>}
        </div>
      </div>
      {loading && !data && <Loading />}
      {data?.length === 0 && <Empty>No bills on this day.</Empty>}
      {!!data?.length && shown.length === 0 && <Empty>No bills match these filters. <button className="link" onClick={clear}>Clear filters</button></Empty>}
      <div className="card">
        <ul className="list">
          {shown.map(s => (
            <li key={s.id}>
              <div role="button" tabIndex={0} className={`list-row btn-row bill-row ${s.status === 'Voided' ? 'voided' : ''}`}
                onClick={() => setOpen(s)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(s); } }}>
                <span className="grow"><BillPeek sale={s} label={s.billNo} onOpen={setOpen} /> <span className="muted">{time(s.createdAt)}</span>
                  <div className="muted small">{s.items.length} {s.items.length === 1 ? 'item' : 'items'} · {s.customerName ?? 'Walk-in'} · {s.cashierEmail.split('@')[0]}</div>
                  <ItemStrip items={s.items} />
                  {s.cashReceived != null && <div className="muted small">Cash recd {money(s.cashReceived)} · change {money(s.changeReturned ?? 0)}</div>}
                  {s.remarks && <div className="small remark-line">📝 {s.remarks}</div>}</span>
                <span className="badge">{modeLabel[s.paymentMode]}</span>
                <b>{money(s.total)}</b>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {open && (
        <Modal title={open.billNo} onClose={() => { setOpen(null); setVoiding(false); }}>
          <Receipt sale={open} />
          {!voiding ? (
            <div className="row gap wrap no-print" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => window.print()}>🖨 Print</button>
              <a className="btn" target="_blank" rel="noreferrer" href={whatsappLink(open.customerPhone, whatsappBillText(open))}>WhatsApp</a>
              {can('Manager') && open.status === 'Completed' && <button className="btn danger-btn" onClick={() => setVoiding(true)}>Cancel bill</button>}
            </div>
          ) : (
            <div className="stack no-print" style={{ marginTop: 12 }}>
              <Field label="Why cancel? (stock goes back, money reversed)"><input className="input" autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field>
              <div className="row gap"><button className="btn" onClick={() => setVoiding(false)}>Back</button><button className="btn danger-btn grow" disabled={!reason.trim()} onClick={doVoid}>Confirm cancel</button></div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
