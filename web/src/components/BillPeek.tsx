import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, apiUrl, type Sale, type SaleItem } from '../lib/api';
import { modeLabel, money, qty, time } from '../lib/util';
import { Thumb } from './ui';

/* Bills fetched for the Day Book peek, shared across rows so each bill loads once. */
const cache = new Map<number, Promise<Sale>>();
function loadSale(id: number) {
  let p = cache.get(id);
  if (!p) { p = api<Sale>(`/api/sales/${id}`); cache.set(id, p); p.catch(() => cache.delete(id)); }
  return p;
}

const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const totalUnits = (items: SaleItem[]) => items.reduce((s, i) => s + i.qty, 0);

/**
 * Bill number chip with a preview of what was sold.
 * Laptop: hover (or keyboard focus) shows it. Phone: tap the chip; tap outside or ✕ closes it.
 * Pass `sale` when it's already loaded (Bills screen) or `saleId` to load on first open (Day Book).
 */
export function BillPeek({ sale, saleId, label, onOpen }: { sale?: Sale; saleId?: number; label: ReactNode; onOpen?: (s: Sale) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Sale | undefined>(sale);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();

  useEffect(() => setData(sale), [sale]);

  const show = useCallback(() => {
    setOpen(true);
    if (!data && saleId) loadSale(saleId).then(setData, e => setErr((e as Error).message));
  }, [data, saleId]);
  const hide = useCallback(() => setOpen(false), []);
  const later = (fn: () => void, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(fn, ms); };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Position next to the chip; flip above when there's no room below, keep inside the screen.
  useLayoutEffect(() => {
    if (!open || !chip.current) return;
    const place = () => {
      const r = chip.current!.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      const h = pop.current?.offsetHeight ?? 260;
      const above = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
      setPos({
        top: above ? r.top - h - 6 : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width, above
      });
    };
    place();
    // Page scroll closes it (it would float away); scrolling the item list inside the card doesn't.
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) hide(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); };
  }, [open, data, hide]);

  // Close on outside tap and Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !chip.current?.contains(t)) hide();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { hide(); chip.current?.focus(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open, hide]);

  const hoverIn = () => { if (canHover()) later(show, 220); };
  const hoverOut = () => { if (canHover()) later(hide, 180); };

  return (
    <>
      <button ref={chip} type="button" className={`bill-chip ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={e => { e.stopPropagation(); open ? hide() : show(); }}
        onKeyDown={e => e.stopPropagation()}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
        onFocus={() => { if (canHover()) show(); }}>
        <span aria-hidden>🧾</span>{label}
      </button>
      {open && createPortal(
        <div ref={pop} className={`bill-peek ${pos?.above ? 'above' : ''}`} role="dialog" aria-label="Items on this bill"
          style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden' }}
          onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={hoverOut}
          onClick={e => e.stopPropagation()}>
          {!data ? (
            <div className="peek-body">{err ? <span className="danger small">{err}</span> : <PeekSkeleton />}</div>
          ) : (
            <>
              <header className="peek-head">
                <div><b>{data.billNo}</b> <span className="muted small">{time(data.createdAt)}</span>
                  <div className="muted small">{data.customerName ?? 'Walk-in'} · {data.cashierEmail.split('@')[0]}</div></div>
                <div className="peek-tags">
                  {data.status === 'Voided' && <span className="badge OutOfStock">Cancelled</span>}
                  <span className="badge">{modeLabel[data.paymentMode]}</span>
                </div>
                {!canHover() && <button className="icon-btn" onClick={hide} aria-label="Close">✕</button>}
              </header>
              <ul className="peek-items">
                {data.items.map((i, n) => (
                  <li key={n}>
                    <span className="peek-thumb">
                      {i.imageUrl
                        ? <img className="thumb" src={apiUrl(i.imageUrl)} alt="" width={44} height={44} loading="lazy" />
                        : <Thumb name={i.productName} size={44} />}
                      <span className="qty-pill">×{qty(i.qty)}</span>
                    </span>
                    <span className="grow peek-name">{i.productName}
                      <span className="muted small">{qty(i.qty)} {i.unit ?? ''} × {money(i.unitPrice)}{i.discountPercent > 0 ? ` · ${i.discountPercent}% off` : ''}</span>
                    </span>
                    <b className="num">{money(i.lineTotal)}</b>
                  </li>
                ))}
              </ul>
              <footer className="peek-foot">
                <span className="muted small">{data.items.length} {data.items.length === 1 ? 'item' : 'items'} · {qty(totalUnits(data.items))} units
                  {data.billDiscount > 0 && <> · bill disc {money(data.billDiscount)}</>}</span>
                <b>{money(data.total)}</b>
              </footer>
              {data.remarks && <div className="peek-remark small">📝 {data.remarks}</div>}
              {onOpen && <button className="btn sm block" onClick={() => { hide(); onOpen(data); }}>Open full bill</button>}
            </>
          )}
        </div>, document.body)}
    </>
  );
}

function PeekSkeleton() {
  return <div className="stack">{[0, 1, 2].map(i => <div key={i} className="peek-skel" />)}</div>;
}

/** Up to 4 item photos with quantity, then "+N" — what's in the bill at a glance, no hover needed. */
export function ItemStrip({ items, max = 4 }: { items: SaleItem[]; max?: number }) {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return (
    <span className="item-strip" aria-label={items.map(i => `${qty(i.qty)} × ${i.productName}`).join(', ')}>
      {shown.map((i, n) => (
        <span key={n} className="strip-cell" title={`${qty(i.qty)} × ${i.productName}`}>
          {i.imageUrl ? <img className="thumb" src={apiUrl(i.imageUrl)} alt="" width={30} height={30} loading="lazy" /> : <Thumb name={i.productName} size={30} />}
          {i.qty !== 1 && <span className="qty-pill sm">{qty(i.qty)}</span>}
        </span>
      ))}
      {more > 0 && <span className="strip-more">+{more}</span>}
    </span>
  );
}
