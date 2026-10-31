import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { ErrorBox, Loading, Thumb } from '../components/ui';
import { modeLabel, money, qty } from '../lib/util';

interface Dash {
  date: string;
  today: { total: number; bills: number; byMode: { mode: string; total: number; count: number }[]; profit?: number };
  cashInHand: number;
  products?: { total: number; outOfStock: number; low: number; negative: number; stockValueAtPrice: number };
  stockValueAtCost?: number;
  itemsWithoutCost?: number;
  lowStock: { id: number; name: string; unit: string; qtyOnHand: number; reorderLevel: number; status: string; imageUrl?: string }[];
  topSellers: { productId: number; name: string; qty: number; amount: number }[];
  trend: { date: string; total: number }[];
  customerDueTotal: number;
  supplierDueTotal?: number;
}

export function DashboardPage() {
  const { data: d, error, loading, reload } = useApi<Dash>('/api/dashboard');
  if (loading && !d) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox msg={error} retry={reload} /></div>;
  if (!d) return null;
  const maxTrend = Math.max(1, ...d.trend.map(t => t.total));

  return (
    <div className="page">
      <div className="row between">
        <h1>Today</h1>
        <div className="row gap">
          <button className="btn ghost" onClick={reload}>↻ Refresh</button>
          <Link className="btn primary" to="/pos">+ New bill</Link>
        </div>
      </div>

      <div className="stats">
        <Stat label="Sales today" value={money(d.today.total)} sub={`${d.today.bills} bills`} />
        <Stat label="Cash in drawer" value={money(d.cashInHand)} sub="expected" />
        {d.today.profit != null && <Stat label="Gross profit today" value={money(d.today.profit)} />}
        <Stat label="Udhaar to collect" value={money(d.customerDueTotal)} link="/customers" />
        {d.supplierDueTotal != null && <Stat label="Supplier dues" value={money(d.supplierDueTotal)} link="/suppliers" />}
        {d.stockValueAtCost != null && <Stat label="Stock value (cost)" value={money(d.stockValueAtCost)} sub={`${d.products?.total ?? 0} items`} />}
      </div>

      {!!d.itemsWithoutCost && (
        <Link to="/products" className="note" style={{ display: 'block', marginTop: 12 }}>
          ⚠ {d.itemsWithoutCost} item{d.itemsWithoutCost === 1 ? ' has' : 's have'} no cost price, so profit and stock value are overstated. Add cost prices in Items → Edit.
        </Link>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="row between">
            <h2>Low stock <span className="pill warn">{(d.products?.low ?? 0) + (d.products?.outOfStock ?? 0)}</span></h2>
            <Link to="/products?status=NeedsReorder" className="link">See all</Link>
          </div>
          {d.products && d.products.negative > 0 &&
            <p className="note">{d.products.negative} item(s) show negative stock — do a recount.</p>}
          {d.lowStock.length === 0 ? <p className="muted">All items are above their reorder level.</p> : (
            <ul className="list">
              {d.lowStock.map(p => (
                <li key={p.id} className="list-row">
                  <Thumb url={p.imageUrl} name={p.name} size={36} />
                  <div className="grow"><b>{p.name}</b><div className="muted small">Reorder at {qty(p.reorderLevel)} {p.unit}</div></div>
                  <span className={`badge ${p.status}`}>{p.qtyOnHand <= 0 ? 'Out' : `${qty(p.qtyOnHand)} left`}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/stock-in" className="btn block" style={{ marginTop: 12 }}>⇣ Record stock in</Link>
        </section>

        <div className="stack">
          <section className="card">
            <h2>Payment split today</h2>
            {d.today.byMode.length === 0 ? <p className="muted">No bills yet today.</p> : (
              <ul className="list">
                {d.today.byMode.map(m => (
                  <li key={m.mode} className="list-row"><span className="grow">{modeLabel[m.mode]}</span><span className="muted">{m.count} bills</span><b>{money(m.total)}</b></li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Last 7 days</h2>
            <div className="bars">
              {d.trend.map(t => (
                <div key={t.date} className="bar-col" title={`${t.date}: ${money(t.total)}`}>
                  <div className="bar" style={{ height: `${(t.total / maxTrend) * 100}%` }} />
                  <small>{new Date(t.date).toLocaleDateString('en-IN', { weekday: 'short' })}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Top sellers (7 days)</h2>
            {d.topSellers.length === 0 ? <p className="muted">No sales yet.</p> : (
              <ol className="list numbered">
                {d.topSellers.map(t => (
                  <li key={t.productId} className="list-row"><span className="grow">{t.name}</span><span className="muted">{qty(t.qty)} sold</span><b>{money(t.amount)}</b></li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, link }: { label: string; value: string; sub?: string; link?: string }) {
  const body = <><small>{label}</small><b>{value}</b>{sub && <span className="muted small">{sub}</span>}</>;
  return link ? <Link to={link} className="stat card">{body}</Link> : <div className="stat card">{body}</div>;
}
