import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Product } from '../lib/api';
import { apiUrl } from '../lib/api';
import { qty } from '../lib/util';
import { useToasts } from '../lib/hooks';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function StockBadge({ p }: { p: Pick<Product, 'qtyOnHand' | 'stockStatus' | 'unit'> }) {
  const label = p.stockStatus === 'OutOfStock' ? (p.qtyOnHand < 0 ? `${qty(p.qtyOnHand)} · recount` : 'Out of stock')
    : p.stockStatus === 'Low' ? `Low · ${qty(p.qtyOnHand)} ${p.unit}` : `${qty(p.qtyOnHand)} ${p.unit}`;
  return <span className={`badge ${p.stockStatus}`}>{label}</span>;
}

export function Thumb({ url, name, size = 48 }: { url?: string | null; name: string; size?: number }) {
  return url
    ? <img className="thumb" src={apiUrl(url)} alt="" width={size} height={size} loading="lazy" />
    : <div className="thumb ph" style={{ width: size, height: size }}>{name.slice(0, 1).toUpperCase()}</div>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Loading() { return <div className="empty">Loading…</div>; }
export function ErrorBox({ msg, retry }: { msg: string; retry?: () => void }) {
  return <div className="error-box">{msg} {retry && <button className="btn sm" onClick={retry}>Retry</button>}</div>;
}

export function Toasts() {
  const list = useToasts();
  return <div className="toasts">{list.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = (v: string, min?: string, max?: string) => {
  const m = DATE_RE.exec(v);
  if (!m || +m[1] < 2000) return false;                 // half-typed year like 0002
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d.getDate() !== +m[3]) return false; // e.g. 31 Nov
  return (!min || v >= min) && (!max || v <= max);
};

/**
 * Date box that doesn't reset while you edit it.
 * While a date is half-typed or impossible (e.g. day 31 before switching the month to October) the browser
 * reports an empty value; if React then re-applies a value, Chrome/Safari wipe every part of the date.
 * So the box is left to the browser while you edit (no React-controlled value): only a complete, in-range date
 * is passed on, leaving the box with an unfinished date puts back the last good one, and outside changes
 * (‹ › buttons, "Today") are written in when the box isn't being edited. Clicking anywhere opens the browser's own calendar (see .date-input in styles.css — no script, so nothing can close it).
 */
export function DateInput({ value, onChange, min, max, className = 'input', ...rest }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; className?: string;
  'aria-label'?: string; id?: string; required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useLayoutEffect(() => {
    last.current = value;
    const el = ref.current;
    // Never write into the box while it's being edited — that is what wipes a half-entered date.
    if (el && el.value !== value && document.activeElement !== el) { el.value = value; setBad(false); }
  }, [value, min, max]);
  return (
    <input ref={ref} type="date" className={`${className} date-input ${bad ? 'invalid' : ''}`} min={min} max={max} {...rest}
      onChange={e => { const v = e.target.value; const ok = validDate(v, min, max); setBad(!ok && v !== ''); if (ok && v !== last.current) onChange(v); }}
      onBlur={e => { if (!validDate(e.target.value, min, max)) { e.target.value = last.current; setBad(false); } }}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); }} />
  );
}
