import { useEffect, type ReactNode } from 'react';
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
