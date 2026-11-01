import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { ErrorBox, Loading, Thumb, DateInput } from '../components/ui';
import { modeLabel, money, qty, todayIso } from '../lib/util';

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
interface Kpis { netSales: number; grossProfit: number; netProfit: number; cogs: number; expenses: number; units: number; bills: number; avgBill: number }
interface Item { productId: number; name: string; unit: string; imageUrl: string; category: string; qty: number; sales: number; cost: number; profit: number; bills: number; noCost: boolean; inStock: number }
interface Report {
  period: Period; label: string; from: string; to: string; isCurrent: boolean;
  previous: { label: string; from: string; to: string };
  kpi: Kpis & { margin: number; prev: Kpis };
  pnl: {
    grossSales: number; itemDiscount: number; billDiscount: number; netSales: number; gst: number; cogs: number; grossProfit: number;
    expenses: number; expenseHeads: { head: string; amount: number; count: number }[]; damage: number; recount: number; netProfit: number;
    mrpSavings: number; cancelled: { bills: number; value: number }; noCost: { lines: number; items: number; sales: number };
  };
  trend: { label: string; sales: number; profit: number; bills: number }[]; trendUnit: string;
  payments: { mode: string; amount: number; bills: number }[];
  money: {
    cashOpening: number; cashClosing: number; cashIn: number; cashOut: number; ownerCashAdded: number;
    udhaarGiven: number; udhaarCollected: number; udhaarOutstanding: number; customersOwing: number;
    stockBought: number; stockBills: number; paidToSuppliers: number; supplierOutstanding: number;
    topSuppliers: { name: string; bills: number; amount: number }[];
  };
  items: Item[]; itemCount: number; belowCost: Item[];
  categories: { name: string; items: number; qty: number; sales: number; cost: number; profit: number }[];
  staff: { email: string; bills: number; sales: number; discount: number; profit: number; cancelled: number; cancelledValue: number }[];
  customers: {
    top: { id: number; name: string; phone?: string; bills: number; sales: number; udhaar: number; due: number }[];
    newCustomers: number; walkInBills: number; walkInSales: number; registeredBills: number; registeredSales: number; uniqueCustomers: number;
  };
  hours: { hour: number; bills: number; sales: number }[];
  weekdays: { day: string; bills: number; sales: number }[];
  stock: {
    items: number; atCost: number; atPrice: number; potentialProfit: number; outOfStock: number; low: number; negative: number; withoutCost: number;
    deadStock: { id: number; name: string; unit: string; imageUrl: string; qty: number; value: number }[]; deadStockValue: number;
  };
}

const PERIODS: [Period, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['custom', 'Custom']];
const pct = (n: number, d: number) => (d === 0 ? 0 : (n * 100) / d);
const fmtPct = (n: number) => `${n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Move the anchor date one period back/forward. */
function shift(date: string, p: Period, dir: -1 | 1) {
  const d = new Date(`${date}T12:00:00`);
  if (p === 'day') d.setDate(d.getDate() + dir);
  else if (p === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (p === 'month') d.setMonth(d.getMonth() + dir, 1);
  else if (p === 'quarter') d.setMonth(d.getMonth() + 3 * dir, 1);
  else if (p === 'year') d.setFullYear(d.getFullYear() + dir, d.getMonth(), 1);
  return iso(d);
}

export function ReportsPage() {
  const [period, setPeriod] = useState<Period>(() => { try { return (localStorage.getItem('rr.report.period') as Period) || 'month'; } catch { return 'month'; } });
  const [date, setDate] = useState(todayIso());
  const [from, setFrom] = useState(() => shift(todayIso(), 'month', -1));
  const [to, setTo] = useState(todayIso());
  const path = period === 'custom' ? `/api/reports/summary?period=custom&from=${from}&to=${to}` : `/api/reports/summary?period=${period}&date=${date}`;
  const { data: r, error, loading, reload } = useApi<Report>(path);
  const pick = (p: Period) => { setPeriod(p); try { localStorage.setItem('rr.report.period', p); } catch { /* ignore */ } };
  const atLatest = period !== 'custom' && !!r?.isCurrent;

  return (
    <div className="page report">
      <div className="row between wrap">
        <h1>Reports</h1>
        <div className="row gap wrap">
          <button className="btn ghost" onClick={reload}>↻ Refresh</button>
          <button className="btn" disabled={!r} onClick={() => r && downloadCsv(r)}>⬇ Excel (CSV)</button>
        </div>
      </div>

      <div className="card report-bar">
        <div className="seg">{PERIODS.map(([p, l]) => <button key={p} className={period === p ? 'on' : ''} onClick={() => pick(p)}>{l}</button>)}</div>
        {period === 'custom' ? (
          <div className="row gap wrap report-nav">
            <DateInput className="input sm" value={from} max={to} onChange={setFrom} aria-label="From" />
            <span className="muted">to</span>
            <DateInput className="input sm" value={to} min={from} max={todayIso()} onChange={setTo} aria-label="To" />
          </div>
        ) : (
          <div className="row gap report-nav">
            <button className="icon-btn" onClick={() => setDate(shift(date, period, -1))} aria-label="Previous period">‹</button>
            <b className="report-label">{r?.label ?? '…'}</b>
            <button className="icon-btn" disabled={atLatest} onClick={() => setDate(shift(date, period, 1))} aria-label="Next period">›</button>
            {!atLatest && <button className="link" onClick={() => setDate(todayIso())}>Today</button>}
          </div>
        )}
      </div>

      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !r && <Loading />}
      {r && <ReportBody r={r} />}
    </div>
  );
}

function ReportBody({ r }: { r: Report }) {
  const k = r.kpi, p = r.pnl;
  return (
    <>
      <div className="stats report-kpis">
        <Kpi label="Net sales" value={k.netSales} prev={k.prev.netSales} sub={`${k.bills} bill${k.bills === 1 ? '' : 's'} · avg ${money(k.avgBill)}`} />
        <Kpi label="Gross profit" value={k.grossProfit} prev={k.prev.grossProfit} sub={`${fmtPct(k.margin)} margin`} accent />
        <Kpi label="Net profit" value={k.netProfit} prev={k.prev.netProfit} sub="after expenses & losses" />
        <Kpi label="Actual cost of goods sold" value={k.cogs} prev={k.prev.cogs} sub={`${qty(k.units)} units sold`} invert />
        <Kpi label="Expenses" value={k.expenses} prev={k.prev.expenses} sub={`${p.expenseHeads.length} expense type${p.expenseHeads.length === 1 ? '' : 's'}`} invert />
        <Kpi label="Bills" value={k.bills} prev={k.prev.bills} count sub={p.cancelled.bills ? `+ ${p.cancelled.bills} cancelled` : 'none cancelled'} />
      </div>
      <p className="muted small compare-note">▲▼ compared with {r.previous.label}{r.isCurrent ? ' — this period is still running' : ''}.</p>

      {p.noCost.items > 0 && (
        <Link to="/products" className="note" style={{ display: 'block' }}>
          ⚠ {p.noCost.items} item{p.noCost.items === 1 ? '' : 's'} sold without a cost price ({money(p.noCost.sales)} of sales) — profit is overstated by up to that much. Add cost prices in Items → Edit.
        </Link>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Profit &amp; loss</h2>
          <table className="table pnl">
            <tbody>
              <tr><td>Sales at selling price</td><td className="num">{money(p.grossSales)}</td></tr>
              {p.itemDiscount > 0 && <tr className="sub"><td>− Item discounts</td><td className="num danger">−{money(p.itemDiscount)}</td></tr>}
              {p.billDiscount > 0 && <tr className="sub"><td>− Bill discounts</td><td className="num danger">−{money(p.billDiscount)}</td></tr>}
              <tr className="total"><td>Net sales</td><td className="num">{money(p.netSales)}</td></tr>
              {p.gst > 0 && <tr className="sub muted"><td>includes GST collected</td><td className="num">{money(p.gst)}</td></tr>}
              <tr className="sub"><td>− Actual cost of goods sold</td><td className="num danger">−{money(p.cogs)}</td></tr>
              <tr className="total"><td>Gross profit <span className="muted small">({fmtPct(pct(p.grossProfit, p.netSales))})</span></td><td className="num">{money(p.grossProfit)}</td></tr>
              {p.expenseHeads.map(e => (
                <tr key={e.head} className="sub"><td>− {e.head} <span className="muted small">×{e.count}</span></td><td className="num danger">−{money(e.amount)}</td></tr>
              ))}
              {p.damage > 0 && <tr className="sub"><td>− Damaged / expired stock</td><td className="num danger">−{money(p.damage)}</td></tr>}
              {p.recount !== 0 && <tr className="sub"><td>{p.recount < 0 ? '− Recount shortage' : '+ Recount extra'}</td><td className={`num ${p.recount < 0 ? 'danger' : 'save'}`}>{money(p.recount)}</td></tr>}
              <tr className={`grand ${p.netProfit < 0 ? 'loss' : ''}`}><td>Net profit</td><td className="num">{money(p.netProfit)}</td></tr>
            </tbody>
          </table>
          <div className="pnl-notes muted small">
            {p.mrpSavings > 0 && <div>🎁 Customers saved {money(p.mrpSavings)} against MRP.</div>}
            {p.cancelled.bills > 0 && <div>🚫 {p.cancelled.bills} cancelled bill{p.cancelled.bills === 1 ? '' : 's'} worth {money(p.cancelled.value)} (not counted above).</div>}
            <div>Cost uses the cost price saved on each bill line when it was sold.</div>
          </div>
        </section>

        <section className="card">
          <h2>Sales trend <span className="muted small">by {r.trendUnit}</span></h2>
          <TrendChart data={r.trend} />
          <h2 style={{ marginTop: 18 }}>How customers paid</h2>
          <Payments rows={r.payments} total={k.netSales} />
        </section>
      </div>

      <MoneyFlow m={r.money} />

      <ItemsSection r={r} />

      <div className="grid-2">
        <section className="card">
          <h2>Categories</h2>
          {r.categories.length === 0 ? <p className="muted">No sales.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Category</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>{r.categories.map(c => (
                <tr key={c.name}><td>{c.name}<div className="muted small">{c.items} items · {qty(c.qty)} units</div>
                  <div className="share"><span style={{ width: `${pct(c.sales, k.netSales)}%` }} /></div></td>
                  <td className="num">{money(c.sales)}</td><td className={`num ${c.profit < 0 ? 'danger' : ''}`}>{money(c.profit)}</td>
                  <td className="num">{fmtPct(pct(c.profit, c.sales))}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="card">
          <h2>Staff</h2>
          {r.staff.length === 0 ? <p className="muted">No bills.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Billed by</th><th className="num">Bills</th><th className="num">Sales</th><th className="num">Discount</th><th className="num">Cancelled</th></tr></thead>
              <tbody>{r.staff.map(s => (
                <tr key={s.email}><td>{s.email.split('@')[0]}<div className="muted small">profit {money(s.profit)}</div></td>
                  <td className="num">{s.bills}</td><td className="num">{money(s.sales)}</td>
                  <td className="num">{money(s.discount)}<div className="muted small">{fmtPct(pct(s.discount, s.sales + s.discount))}</div></td>
                  <td className={`num ${s.cancelled ? 'danger' : 'muted'}`}>{s.cancelled}{s.cancelled > 0 && <div className="small">{money(s.cancelledValue)}</div>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Customers</h2>
          <div className="mini-stats">
            <div><small>Regular customers</small><b>{r.customers.uniqueCustomers}</b><span className="muted small">{money(r.customers.registeredSales)} · {r.customers.registeredBills} bills</span></div>
            <div><small>Walk-in</small><b>{r.customers.walkInBills} bills</b><span className="muted small">{money(r.customers.walkInSales)}</span></div>
            <div><small>New customers added</small><b>{r.customers.newCustomers}</b></div>
          </div>
          {r.customers.top.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Top customers</th><th className="num">Bills</th><th className="num">Bought</th><th className="num">Due now</th></tr></thead>
              <tbody>{r.customers.top.map(c => (
                <tr key={c.id}><td>{c.name}{c.phone && <div className="muted small">{c.phone}</div>}</td><td className="num">{c.bills}</td>
                  <td className="num">{money(c.sales)}{c.udhaar > 0 && <div className="muted small">udhaar {money(c.udhaar)}</div>}</td>
                  <td className={`num ${c.due > 0 ? 'danger' : 'muted'}`}>{c.due > 0 ? money(c.due) : '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="card">
          <h2>When customers buy</h2>
          <BusyHours hours={r.hours} />
          {r.period !== 'day' && <Weekdays rows={r.weekdays} />}
        </section>
      </div>

      <StockSection s={r.stock} />
    </>
  );
}

function Kpi({ label, value, prev, sub, accent, invert, count }: { label: string; value: number; prev: number; sub?: string; accent?: boolean; invert?: boolean; count?: boolean }) {
  const change = prev === 0 ? null : ((value - prev) * 100) / Math.abs(prev);
  const good = change == null ? null : invert ? change <= 0 : change >= 0;
  return (
    <div className={`stat card ${accent ? 'accent' : ''}`}>
      <small>{label}</small>
      <b className={!count && value < 0 ? 'neg' : ''}>{count ? value : money(value)}</b>
      <span className="kpi-foot">
        {change != null && Math.abs(change) >= 0.05 && <span className={`delta ${good ? 'up' : 'down'}`}>{change >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(change))}</span>}
        {change == null && value !== 0 && <span className="delta new">new</span>}
        {sub && <span className="kpi-sub">{sub}</span>}
      </span>
    </div>
  );
}

function TrendChart({ data }: { data: Report['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(d => d.sales));
  const total = data.reduce((s, d) => s + d.sales, 0);
  if (total === 0) return <p className="muted">No sales in this period.</p>;
  const showEvery = Math.ceil(data.length / 12);
  const h = hover != null ? data[hover] : null;
  return (
    <div className="trend">
      <div className="trend-readout">{h
        ? <><b>{h.label}</b> · {money(h.sales)} sales · {money(h.profit)} profit · {h.bills} bill{h.bills === 1 ? '' : 's'}</>
        : <span className="muted">Hover or tap a bar · <span className="key sales" /> sales <span className="key profit" /> profit</span>}</div>
      <div className="trend-bars" onMouseLeave={() => setHover(null)} role="img"
        aria-label={data.filter(d => d.sales > 0).map(d => `${d.label}: ${money(d.sales)}`).join(', ')}>
        {data.map((d, i) => (
          <button key={i} className={`trend-col ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(hover === i ? null : i)}
            aria-label={`${d.label}: ${money(d.sales)} sales, ${money(d.profit)} profit`}>
            <span className="bar" style={{ height: `${(d.sales / max) * 100}%` }}>
              <span className={`bar-profit ${d.profit < 0 ? 'neg' : ''}`} style={{ height: `${d.sales ? Math.min(100, Math.abs(d.profit) / d.sales * 100) : 0}%` }} />
            </span>
            <span className="tick">{i % showEvery === 0 ? d.label : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Payments({ rows, total }: { rows: Report['payments']; total: number }) {
  const shown = rows.filter(r => r.amount > 0);
  if (shown.length === 0) return <p className="muted">No sales.</p>;
  return (
    <>
      <div className="pay-bar">{shown.map(r => <span key={r.mode} className={`pm-${r.mode}`} style={{ width: `${pct(r.amount, total)}%` }} title={`${modeLabel[r.mode]} ${money(r.amount)}`} />)}</div>
      <ul className="pay-list">{shown.map(r => (
        <li key={r.mode}><span className={`dot pm-${r.mode}`} />{modeLabel[r.mode]}<span className="muted small">{r.bills} bill{r.bills === 1 ? '' : 's'}</span>
          <span className="grow" /><b>{money(r.amount)}</b><span className="muted small pay-pct">{fmtPct(pct(r.amount, total))}</span></li>
      ))}</ul>
    </>
  );
}

function MoneyFlow({ m }: { m: Report['money'] }) {
  return (
    <section className="card money-flow">
      <h2>Money flow</h2>
      <div className="flow-grid">
        <div className="flow">
          <h3>💵 Cash drawer</h3>
          <Row l="Opening cash" v={m.cashOpening} />
          <Row l="+ Cash in" v={m.cashIn} cls="save" />
          <Row l="− Cash out" v={-m.cashOut} cls="danger" />
          <Row l="Closing cash" v={m.cashClosing} strong />
          {m.ownerCashAdded > 0 && <p className="muted small">Includes {money(m.ownerCashAdded)} you added to the drawer.</p>}
          {(m.cashClosing < 0 || m.cashOpening < 0) && <p className="small danger">A drawer can't go below ₹0 — cash paid out was more than cash recorded in. Set the starting cash in <Link to="/daybook">Day Book → Set opening cash</Link>, or record that expense as UPI/Card if it wasn't paid from the drawer.</p>}
        </div>
        <div className="flow">
          <h3>📒 Udhaar (customers)</h3>
          <Row l="Given on credit" v={m.udhaarGiven} />
          <Row l="Collected back" v={m.udhaarCollected} cls="save" />
          <Row l="Net change" v={m.udhaarGiven - m.udhaarCollected} />
          <Row l={`To collect now · ${m.customersOwing} customers`} v={m.udhaarOutstanding} strong cls={m.udhaarOutstanding > 0 ? 'danger' : ''} />
        </div>
        <div className="flow">
          <h3>🚚 Suppliers</h3>
          <Row l={`Stock bought · ${m.stockBills} bills`} v={m.stockBought} />
          <Row l="Paid to suppliers" v={m.paidToSuppliers} />
          <Row l="We owe now" v={m.supplierOutstanding} strong cls={m.supplierOutstanding > 0 ? 'danger' : ''} />
          {m.topSuppliers.length > 0 && <p className="muted small">Most bought from: {m.topSuppliers.slice(0, 3).map(s => `${s.name} (${money(s.amount)})`).join(', ')}</p>}
        </div>
      </div>
    </section>
  );
}

function Row({ l, v, strong, cls }: { l: string; v: number; strong?: boolean; cls?: string }) {
  return <div className={`flow-row ${strong ? 'strong' : ''}`}><span>{l}</span><span className={`num ${cls ?? ''}`}>{money(v === 0 ? 0 : v)}</span></div>;
}

type Sort = 'sales' | 'profit' | 'qty' | 'margin';
function ItemsSection({ r }: { r: Report }) {
  const [sort, setSort] = useState<Sort>('sales');
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    const list = [...r.items];
    const m = (i: Item) => (i.sales ? i.profit / i.sales : 0);
    list.sort((a, b) => sort === 'sales' ? b.sales - a.sales : sort === 'profit' ? b.profit - a.profit : sort === 'qty' ? b.qty - a.qty : m(a) - m(b));
    return list;
  }, [r.items, sort]);
  const shown = all ? sorted : sorted.slice(0, 10);
  return (
    <section className="card">
      <div className="row between wrap">
        <h2 style={{ margin: 0 }}>Items sold <span className="muted small">({r.itemCount})</span></h2>
        <div className="chips">
          {([['sales', 'Top sales'], ['profit', 'Most profit'], ['qty', 'Most quantity'], ['margin', 'Lowest margin']] as [Sort, string][]).map(([s, l]) => (
            <button key={s} className={`chip ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}>{l}</button>
          ))}
        </div>
      </div>
      {r.belowCost.length > 0 && (
        <p className="note danger" style={{ marginTop: 10 }}>
          ⚠ Sold below cost: {r.belowCost.slice(0, 5).map(i => `${i.name} (${money(i.profit)})`).join(', ')}{r.belowCost.length > 5 ? ` and ${r.belowCost.length - 5} more` : ''}. Check their price or cost.
        </p>
      )}
      {shown.length === 0 ? <p className="muted">No items sold.</p> : (
        <div className="table-wrap"><table className="table items-table">
          <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Sales</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
          <tbody>{shown.map((i, n) => (
            <tr key={i.productId}>
              <td className="muted">{n + 1}</td>
              <td><span className="row gap"><Thumb url={i.imageUrl || null} name={i.name} size={34} />
                <span>{i.name}<div className="muted small">{i.category} · {i.bills} bill{i.bills === 1 ? '' : 's'} · {qty(i.inStock)} {i.unit} left</div></span></span></td>
              <td className="num">{qty(i.qty)} <span className="muted small">{i.unit}</span></td>
              <td className="num">{money(i.sales)}</td>
              <td className="num">{i.noCost ? <span className="badge Low" title="No cost price on this item">no cost</span> : money(i.cost)}</td>
              <td className={`num ${i.profit < 0 ? 'danger' : ''}`}>{money(i.profit)}</td>
              <td className="num">{i.noCost ? '—' : fmtPct(pct(i.profit, i.sales))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {sorted.length > 10 && <button className="link" onClick={() => setAll(v => !v)}>{all ? 'Show top 10' : `Show all ${sorted.length}`}</button>}
    </section>
  );
}

function BusyHours({ hours }: { hours: Report['hours'] }) {
  const open = hours.filter(h => h.bills > 0);
  if (open.length === 0) return <p className="muted">No bills.</p>;
  const first = Math.max(0, Math.min(...open.map(h => h.hour)) - 1), last = Math.min(23, Math.max(...open.map(h => h.hour)) + 1);
  const rows = hours.slice(first, last + 1);
  const max = Math.max(1, ...rows.map(h => h.bills));
  const peak = rows.reduce((a, b) => (b.bills > a.bills ? b : a));
  const lbl = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
  return (
    <>
      <p className="muted small">Busiest: <b>{lbl(peak.hour)}–{lbl((peak.hour + 1) % 24)}</b> ({peak.bills} bills, {money(peak.sales)})</p>
      <div className="heat">{rows.map(h => (
        <div key={h.hour} className="heat-cell" title={`${lbl(h.hour)}: ${h.bills} bills, ${money(h.sales)}`}>
          <span style={{ opacity: h.bills ? 0.18 + 0.82 * (h.bills / max) : 0.06 }} />
          <small>{h.hour % 12 === 0 ? 12 : h.hour % 12}</small>
        </div>
      ))}</div>
    </>
  );
}

function Weekdays({ rows }: { rows: Report['weekdays'] }) {
  const max = Math.max(1, ...rows.map(r => r.sales));
  if (rows.every(r => r.bills === 0)) return null;
  return (
    <div className="weekdays">{rows.map(r => (
      <div key={r.day} className="wd" title={`${r.day}: ${r.bills} bills, ${money(r.sales)}`}>
        <span className="wd-bar"><span style={{ height: `${(r.sales / max) * 100}%` }} /></span><small>{r.day}</small>
      </div>
    ))}</div>
  );
}

function StockSection({ s }: { s: Report['stock'] }) {
  return (
    <section className="card">
      <h2>Stock right now <span className="muted small">(not tied to the period)</span></h2>
      <div className="mini-stats">
        <div><small>Stock value at cost</small><b>{money(s.atCost)}</b><span className="muted small">{s.items} items</span></div>
        <div><small>Value at selling price</small><b>{money(s.atPrice)}</b><span className="muted small">profit inside: {money(s.potentialProfit)}</span></div>
        <div><small>Out of stock / low</small><b>{s.outOfStock} / {s.low}</b><Link className="link small" to="/products?status=NeedsReorder">Reorder list</Link></div>
        <div><small>Data to fix</small><b>{s.withoutCost + s.negative}</b><span className="muted small">{s.withoutCost} no cost · {s.negative} negative stock</span></div>
      </div>
      {s.deadStock.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Not sold in 30 days <span className="muted small">· {money(s.deadStockValue)} locked up</span></h3>
          <div className="dead-list">{s.deadStock.map(d => (
            <div key={d.id} className="dead"><Thumb url={d.imageUrl || null} name={d.name} size={32} />
              <span className="grow">{d.name}<div className="muted small">{qty(d.qty)} {d.unit}</div></span><b className="num">{money(d.value)}</b></div>
          ))}</div>
        </>
      )}
    </section>
  );
}

/** One CSV that opens in Excel: summary, P&L, trend, payments, items, categories, staff. */
function downloadCsv(r: Report) {
  const rows: (string | number)[][] = [];
  const add = (...cells: (string | number)[]) => rows.push(cells);
  const n = (x: number) => Math.round(x * 100) / 100;
  add('Radha Rani Multi Store — Report', r.label); add('From', r.from, 'To', r.to); add();
  add('Summary', 'This period', r.previous.label);
  ([['Net sales', 'netSales'], ['Gross profit', 'grossProfit'], ['Net profit', 'netProfit'], ['Cost of goods sold', 'cogs'],
    ['Expenses', 'expenses'], ['Bills', 'bills'], ['Average bill', 'avgBill'], ['Units sold', 'units']] as [string, keyof Kpis][])
    .forEach(([l, key]) => add(l, n(r.kpi[key]), n(r.kpi.prev[key])));
  add();
  const p = r.pnl;
  add('Profit & loss'); add('Sales at selling price', n(p.grossSales)); add('Item discounts', -n(p.itemDiscount)); add('Bill discounts', -n(p.billDiscount));
  add('Net sales', n(p.netSales)); add('GST included', n(p.gst)); add('Cost of goods sold', -n(p.cogs)); add('Gross profit', n(p.grossProfit));
  p.expenseHeads.forEach(e => add(`Expense: ${e.head}`, -n(e.amount)));
  add('Damaged stock', -n(p.damage)); add('Recount difference', n(p.recount)); add('Net profit', n(p.netProfit)); add();
  add('Trend', 'Sales', 'Profit', 'Bills'); r.trend.forEach(t => add(t.label, n(t.sales), n(t.profit), t.bills)); add();
  add('Payment mode', 'Amount', 'Bills'); r.payments.forEach(x => add(modeLabel[x.mode], n(x.amount), x.bills)); add();
  add('Item', 'Category', 'Qty', 'Unit', 'Sales', 'Cost', 'Profit', 'Margin %', 'Bills', 'In stock');
  r.items.forEach(i => add(i.name, i.category, i.qty, i.unit, n(i.sales), i.noCost ? 'no cost' : n(i.cost), n(i.profit), i.noCost ? '' : n(pct(i.profit, i.sales)), i.bills, i.inStock));
  add();
  add('Category', 'Items', 'Qty', 'Sales', 'Cost', 'Profit'); r.categories.forEach(c => add(c.name, c.items, c.qty, n(c.sales), n(c.cost), n(c.profit))); add();
  add('Staff', 'Bills', 'Sales', 'Discount', 'Profit', 'Cancelled'); r.staff.forEach(s => add(s.email, s.bills, n(s.sales), n(s.discount), n(s.profit), s.cancelled));
  const csv = rows.map(row => row.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `radharani-report-${r.period}-${r.from}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
