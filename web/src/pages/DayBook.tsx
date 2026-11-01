import { useMemo, useState } from 'react';
import { api, type PaymentMode } from '../lib/api';
import { useApi, toast } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Empty, ErrorBox, Field, Loading, Modal } from '../components/ui';
import { modeLabel, money, time, todayIso } from '../lib/util';
import { BillPeek } from '../components/BillPeek';

interface DayBook {
  date: string; openingCash: number; closingCash: number;
  byMode: { mode: string; in: number; out: number }[];
  salesTotal: number; billCount: number; expensesTotal: number;
  entries: { id: number; entryDate: string; direction: 'In' | 'Out'; category: string; mode: string; amount: number; party?: string; expenseHead?: string; refType?: string; refId?: number; narration?: string; userEmail: string }[];
}

const HEADS = ['Rent', 'Electricity', 'Salary', 'Transport', 'Tea / snacks', 'Packaging', 'Repairs', 'Other'];
const CAT: Record<string, string> = {
  Sale: 'Sale', SaleVoid: 'Bill cancelled', Purchase: 'Stock purchase', Expense: 'Expense',
  CustomerPayment: 'Udhaar received', SupplierPayment: 'Paid supplier', OpeningBalance: 'Opening', Other: 'Other'
};

// Sale rows: show the bill no as a peek chip and the rest of the narration beside it.
const billNo = (id: number) => `RR-${String(id).padStart(6, '0')}`;
const restOf = (n: string | undefined, no: string) =>
  n?.replace(`Bill ${no}`, '').replace(` ${no}`, '').replace(/^[\s:·-]+/, '').trim() || undefined;

/** Rozmel / day book: every rupee in and out for the day, with expected cash in the drawer. */
export function DayBookPage() {
  const { can } = useAuth();
  const [date, setDate] = useState(todayIso());
  const { data: d, error, loading, reload } = useApi<DayBook>(`/api/ledger/daybook?date=${date}`);
  const [expense, setExpense] = useState(false);
  const [openingCash, setOpeningCash] = useState(false);
  const [counted, setCounted] = useState('');
  const [newestFirst, setNewestFirst] = useState(() => { try { return localStorage.getItem('rr.daybook.order') !== 'asc'; } catch { return true; } });
  const [modeFilter, setModeFilter] = useState<'All' | PaymentMode>('All');
  const toggleOrder = () => setNewestFirst(v => { try { localStorage.setItem('rr.daybook.order', v ? 'asc' : 'desc'); } catch { /* ignore */ } return !v; });

  // Running cash-in-drawer is always computed oldest → newest, so it stays correct in either display order.
  const rows = useMemo(() => {
    if (!d) return [];
    let cash = d.openingCash;
    const withBal = [...d.entries]
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id)
      .map(e => {
        if (e.mode === 'Cash') cash += e.direction === 'In' ? e.amount : -e.amount;
        return { ...e, cashAfter: e.mode === 'Cash' ? cash : null as number | null };
      });
    const filtered = modeFilter === 'All' ? withBal : withBal.filter(e => e.mode === modeFilter);
    return newestFirst ? filtered.reverse() : filtered;
  }, [d, newestFirst, modeFilter]);
  const shownIn = rows.filter(e => e.direction === 'In').reduce((s, e) => s + e.amount, 0);
  const shownOut = rows.filter(e => e.direction === 'Out').reduce((s, e) => s + e.amount, 0);

  const diff = counted !== '' && d ? Number(counted) - d.closingCash : null;

  return (
    <div className="page">
      <div className="row between wrap">
        <h1>Day Book</h1>
        <div className="row gap">
          <input className="input sm" type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} />
          <button className="btn primary" onClick={() => setExpense(true)}>+ Expense</button>
        </div>
      </div>
      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !d && <Loading />}
      {d && (
        <>
          <div className="stats">
            <div className="stat card"><small>Opening cash</small><b>{money(d.openingCash)}</b></div>
            <div className="stat card"><small>Sales ({d.billCount} bills)</small><b>{money(d.salesTotal)}</b></div>
            <div className="stat card"><small>Expenses</small><b>{money(d.expensesTotal)}</b></div>
            <div className="stat card accent"><small>Cash should be in drawer</small><b>{money(d.closingCash)}</b></div>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>By payment mode</h2>
              <table className="table">
                <thead><tr><th>Mode</th><th className="num">In</th><th className="num">Out</th></tr></thead>
                <tbody>
                  {d.byMode.map(m => <tr key={m.mode}><td>{modeLabel[m.mode]}</td><td className="num save">{money(m.in)}</td><td className="num danger">{money(m.out)}</td></tr>)}
                </tbody>
              </table>
              <p className="muted small">Udhaar rows are on-account; they don't change cash in hand.</p>
            </section>
            <section className="card stack">
              <h2>Close the day</h2>
              <Field label="Cash counted in drawer ₹"><input className="input" type="number" inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} /></Field>
              {diff != null && (
                <p className={Math.abs(diff) < 1 ? 'save' : 'danger'}>
                  {Math.abs(diff) < 1 ? '✓ Cash matches' : diff > 0 ? `Extra ${money(diff)} in drawer` : `Short by ${money(-diff)}`}
                </p>
              )}
              {can('Owner') && <button className="btn ghost" onClick={() => setOpeningCash(true)}>Set opening cash / add cash</button>}
            </section>
          </div>

          <section className="card">
            <div className="row between wrap" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Entries <span className="muted">({rows.length})</span></h2>
              <div className="row gap wrap">
                <div className="chips">
                  {(['All', 'Cash', 'Upi', 'Card', 'Credit'] as const).map(m => (
                    <button key={m} className={`chip ${modeFilter === m ? 'on' : ''}`} onClick={() => setModeFilter(m)}>{m === 'All' ? 'All' : modeLabel[m]}</button>
                  ))}
                </div>
                <button className="btn sm ghost" onClick={toggleOrder} title="Change order">
                  {newestFirst ? '↓ Newest first' : '↑ Oldest first'}
                </button>
              </div>
            </div>
            {rows.length === 0 ? <Empty>{d.entries.length === 0 ? 'No entries on this day.' : 'No entries for this payment mode.'}</Empty> : (
              <div className="table-wrap">
                <table className="table daybook">
                  <thead><tr><th>Time</th><th>Type</th><th>Details</th><th>Mode</th><th className="num">In</th><th className="num">Out</th><th className="num" title="Cash that should be in the drawer after this entry">Cash in drawer</th></tr></thead>
                  <tbody>
                    {!newestFirst && modeFilter !== 'Credit' && (
                      <tr className="muted"><td></td><td>Opening</td><td>Cash at start of day</td><td>Cash</td><td></td><td></td><td className="num">{money(d.openingCash)}</td></tr>
                    )}
                    {rows.map(e => (
                      <tr key={e.id} className={e.category === 'SaleVoid' ? 'voided-row' : ''}>
                        <td>{time(e.entryDate)}</td>
                        <td>{CAT[e.category] ?? e.category}</td>
                        <td>{e.refType === 'Sale' && e.refId
                          ? <><BillPeek saleId={e.refId} label={billNo(e.refId)} />{' '}
                              <span>{[e.party, restOf(e.narration, billNo(e.refId))].filter(Boolean).join(' · ')}</span></>
                          : [e.expenseHead, e.party, e.narration].filter(Boolean).join(' · ')}
                          <div className="muted small">{e.userEmail.split('@')[0]}</div></td>
                        <td>{modeLabel[e.mode]}</td>
                        <td className="num save">{e.direction === 'In' ? money(e.amount) : ''}</td>
                        <td className="num danger">{e.direction === 'Out' ? money(e.amount) : ''}</td>
                        <td className="num">{e.cashAfter != null ? <b>{money(e.cashAfter)}</b> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                    {newestFirst && modeFilter !== 'Credit' && (
                      <tr className="muted"><td></td><td>Opening</td><td>Cash at start of day</td><td>Cash</td><td></td><td></td><td className="num">{money(d.openingCash)}</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4}><b>Total {modeFilter === 'All' ? '(all modes)' : modeLabel[modeFilter]}</b></td>
                      <td className="num save"><b>{money(shownIn)}</b></td><td className="num danger"><b>{money(shownOut)}</b></td>
                      <td className="num"><b>{money(d.closingCash)}</b></td></tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {expense && <ExpenseForm date={date} onClose={() => setExpense(false)} onSaved={() => { setExpense(false); reload(); }} />}
      {openingCash && <OpeningCash onClose={() => setOpeningCash(false)} onSaved={() => { setOpeningCash(false); reload(); }} />}
    </div>
  );
}

function ExpenseForm({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ expenseHead: 'Tea / snacks', amount: '', mode: 'Cash' as PaymentMode, narration: '' });
  async function save() {
    try {
      // Backdated expense goes in at noon IST of that day; today's uses the current time.
      const entryDate = date === todayIso() ? null : new Date(`${date}T12:00:00+05:30`).toISOString();
      await api('/api/ledger/expense', { body: { ...f, amount: Number(f.amount), entryDate } });
      toast('Expense saved'); onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <Modal title="Add expense" onClose={onClose}>
      <div className="stack">
        <div className="chips">{HEADS.map(h => <button key={h} className={`chip ${f.expenseHead === h ? 'on' : ''}`} onClick={() => setF({ ...f, expenseHead: h })}>{h}</button>)}</div>
        <Field label="Amount ₹"><input className="input" autoFocus type="number" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <div className="modes">{(['Cash', 'Upi', 'Card'] as PaymentMode[]).map(m => <button key={m} className={`mode ${f.mode === m ? 'on' : ''}`} onClick={() => setF({ ...f, mode: m })}>{modeLabel[m]}</button>)}</div>
        <Field label="Note"><input className="input" value={f.narration} onChange={e => setF({ ...f, narration: e.target.value })} /></Field>
        <button className="btn primary block" disabled={!(Number(f.amount) > 0)} onClick={save}>Save expense</button>
      </div>
    </Modal>
  );
}

function OpeningCash({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  async function save() {
    try { await api('/api/ledger/opening', { body: { amount: Number(amount), narration: 'Cash added to drawer' } }); toast('Saved'); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <Modal title="Add cash to drawer" onClose={onClose}>
      <div className="stack">
        <p className="muted">Use on day one for the starting float, or whenever you put your own money into the drawer.</p>
        <Field label="Amount ₹"><input className="input" autoFocus type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <button className="btn primary block" disabled={!(Number(amount) > 0)} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
