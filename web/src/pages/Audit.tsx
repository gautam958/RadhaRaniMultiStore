import { useState } from 'react';
import type { AuditEntry } from '../lib/api';
import { useApi, useDebounced } from '../lib/hooks';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { dateTime, todayIso } from '../lib/util';

interface AuditPage { total: number; page: number; pageSize: number; items: AuditEntry[]; users: string[]; entities: string[] }
interface Change { field: string; from?: string | null; to?: string | null }

const ACTION_TONE: Record<string, string> = {
  Created: 'InStock', Restored: 'InStock', 'Signed in': '', Updated: 'Advance',
  Removed: 'OutOfStock', Cancelled: 'OutOfStock', Deleted: 'OutOfStock', Damaged: 'Low', Adjusted: 'Low'
};

const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Owner & Manager: who did what and when, with old → new values. */
export function AuditPage() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(todayIso());
  const [user, setUser] = useState('');
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useDebounced(search.trim());

  const params = new URLSearchParams({ from, to, page: String(page), pageSize: '50' });
  if (user) params.set('user', user);
  if (entity) params.set('entity', entity);
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useApi<AuditPage>(`/api/audit?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="page">
      <div className="row between wrap">
        <h1>Audit Log {data && <span className="muted">({data.total})</span>}</h1>
        <button className="btn ghost" onClick={reload}>↻ Refresh</button>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>Every change made in the app — who, when and what changed. Entries cannot be edited or deleted.</p>

      <div className="card audit-filters">
        <label className="field"><span>From</span><input className="input" type="date" value={from} max={to} onChange={e => reset(() => setFrom(e.target.value))} /></label>
        <label className="field"><span>To</span><input className="input" type="date" value={to} max={todayIso()} onChange={e => reset(() => setTo(e.target.value))} /></label>
        <label className="field"><span>Staff</span>
          <select className="input" value={user} onChange={e => reset(() => setUser(e.target.value))}>
            <option value="">Everyone</option>
            {data?.users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="field"><span>Type</span>
          <select className="input" value={entity} onChange={e => reset(() => setEntity(e.target.value))}>
            <option value="">All</option>
            {data?.entities.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="field grow-2"><span>Search</span><input className="input" placeholder="item, bill no, customer, price…" value={search} onChange={e => reset(() => setSearch(e.target.value))} /></label>
      </div>
      <div className="chips" style={{ margin: '10px 0' }}>
        {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([label, n]) => (
          <button key={label} className={`chip ${from === daysAgo(n as number) && to === todayIso() ? 'on' : ''}`}
            onClick={() => reset(() => { setFrom(daysAgo(n as number)); setTo(todayIso()); })}>{label}</button>
        ))}
      </div>

      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty>No activity for these filters.</Empty>}

      <div className="card audit-list">
        {data?.items.map(a => {
          const changes: Change[] = a.changes ? safeParse(a.changes) : [];
          const expanded = open === a.id;
          return (
            <button key={a.id} className={`audit-row ${expanded ? 'open' : ''}`} onClick={() => setOpen(expanded ? null : a.id)}>
              <div className="audit-when">{dateTime(a.at)}</div>
              <div className="audit-main">
                <div><span className={`badge ${ACTION_TONE[a.action] ?? ''}`}>{a.action}</span> <b>{a.entity}</b> <span>{a.summary}</span></div>
                <div className="muted small">by {a.userEmail}{changes.length > 0 && !expanded ? ` · ${changes.length} change${changes.length > 1 ? 's' : ''} — tap to see` : ''}</div>
                {expanded && changes.length > 0 && (
                  <table className="table audit-changes">
                    <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>{changes.map((c, i) => (
                      <tr key={i}><td>{c.field}</td><td className="danger">{c.from ?? '—'}</td><td className="save">{c.to ?? '—'}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {pages > 1 && (
        <div className="row gap center pager">
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Newer</button>
          <span>{page} / {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older ›</button>
        </div>
      )}
    </div>
  );
}

function safeParse(s: string): Change[] { try { return JSON.parse(s); } catch { return []; } }
