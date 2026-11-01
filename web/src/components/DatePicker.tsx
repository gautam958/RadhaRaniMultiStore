import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* Dates are plain 'YYYY-MM-DD' strings (shop's local day). All maths done on local noon to dodge DST edges. */
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return toIso(d); };
const todayIso = () => toIso(new Date());
const inRange = (s: string, min?: string, max?: string) => (!min || s >= min) && (!max || s <= max);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const label = (s: string) => {
  if (!s) return 'Pick a date';
  const d = fromIso(s);
  const t = todayIso();
  const prefix = s === t ? 'Today, ' : s === addDays(t, -1) ? 'Yesterday, ' : `${d.toLocaleDateString('en-IN', { weekday: 'short' })}, `;
  return prefix + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The app's own date picker (no browser date control, so it behaves the same in Chrome, Safari and on phones).
 * A button shows the date; clicking it opens a month calendar with Today / Yesterday shortcuts.
 * `stepper` adds ‹ › buttons to move one day back / forward. Dates outside min/max can't be picked.
 */
export function DateInput({ value, onChange, min, max, stepper, className = 'input', ...rest }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; stepper?: boolean; className?: string;
  'aria-label'?: string; id?: string; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pick = (v: string) => { if (inRange(v, min, max) && v !== value) onChange(v); setOpen(false); btn.current?.focus(); };
  const prev = value ? addDays(value, -1) : '';
  const next = value ? addDays(value, 1) : '';

  return (
    <span className={`date-picker ${stepper ? 'with-stepper' : ''}`}>
      {stepper && (
        <button type="button" className="dp-step" aria-label="Previous day" disabled={!prev || !inRange(prev, min, max)} onClick={() => pick(prev)}>‹</button>
      )}
      <button ref={btn} type="button" className={`${className} dp-button`} id={rest.id} aria-label={rest['aria-label']}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        </svg>
        <span>{label(value)}</span>
      </button>
      {stepper && (
        <button type="button" className="dp-step" aria-label="Next day" disabled={!next || !inRange(next, min, max)} onClick={() => pick(next)}>›</button>
      )}
      {open && <Calendar anchor={btn} value={value} min={min} max={max} onPick={pick} onClose={() => setOpen(false)} />}
    </span>
  );
}

function Calendar({ anchor, value, min, max, onPick, onClose }: {
  anchor: React.RefObject<HTMLButtonElement>; value: string; min?: string; max?: string; onPick: (v: string) => void; onClose: () => void;
}) {
  const start = fromIso(value || todayIso());
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [focus, setFocus] = useState(value || todayIso());
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const w = 296, h = box.current?.offsetHeight ?? 340;
      const below = r.bottom + h + 8 <= window.innerHeight || r.top - h - 8 < 0;
      setPos({ top: below ? r.bottom + 6 : r.top - h - 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, view]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, onClose]);

  useEffect(() => { box.current?.querySelector<HTMLButtonElement>('[data-focus="1"]')?.focus(); }, [focus, view]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1, 12);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toIso(new Date(view.y, view.m, i + 1, 12)))];
  }, [view]);

  const shiftMonth = (n: number) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monthStart = toIso(new Date(view.y, view.m, 1, 12));
  const monthEnd = toIso(new Date(view.y, view.m + 1, 0, 12));
  const canPrev = !min || min < monthStart;
  const canNext = !max || max > monthEnd;
  const t = todayIso(), y = addDays(t, -1);
  const moveFocus = (n: number) => {
    const f = addDays(focus, n);
    setFocus(f);
    const d = fromIso(f);
    if (d.getMonth() !== view.m || d.getFullYear() !== view.y) setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const years = useMemo(() => {
    const lo = min ? +min.slice(0, 4) : new Date().getFullYear() - 5;
    const hi = max ? +max.slice(0, 4) : new Date().getFullYear() + 1;
    return Array.from({ length: Math.max(1, hi - lo + 1) }, (_, i) => lo + i);
  }, [min, max]);

  return createPortal(
    <div ref={box} className="dp-pop" role="dialog" aria-label="Choose date"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      onKeyDown={e => {
        const k: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (e.key in k) { e.preventDefault(); moveFocus(k[e.key]); }
        else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
        else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
        else if (e.key === 'Escape') { e.preventDefault(); onClose(); anchor.current?.focus(); }
      }}>
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => shiftMonth(-1)} disabled={!canPrev} aria-label="Previous month">‹</button>
        <span className="dp-title">
          <select value={view.m} onChange={e => setView(v => ({ ...v, m: +e.target.value }))} aria-label="Month">
            {MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select value={view.y} onChange={e => setView(v => ({ ...v, y: +e.target.value }))} aria-label="Year">
            {years.map(yy => <option key={yy} value={yy}>{yy}</option>)}
          </select>
        </span>
        <button type="button" className="dp-nav" onClick={() => shiftMonth(1)} disabled={!canNext} aria-label="Next month">›</button>
      </div>
      <div className="dp-grid" role="grid">
        {DAYS.map(d => <span key={d} className="dp-dow">{d}</span>)}
        {cells.map((c, i) => c == null ? <span key={`b${i}`} /> : (
          <button key={c} type="button" role="gridcell" disabled={!inRange(c, min, max)}
            className={`dp-day ${c === value ? 'sel' : ''} ${c === t ? 'today' : ''}`}
            data-focus={c === focus ? '1' : undefined} tabIndex={c === focus ? 0 : -1}
            aria-selected={c === value} aria-label={label(c)} onClick={() => onPick(c)}>
            {+c.slice(8)}
          </button>
        ))}
      </div>
      <div className="dp-foot">
        <button type="button" className="chip" disabled={!inRange(t, min, max)} onClick={() => onPick(t)}>Today</button>
        <button type="button" className="chip" disabled={!inRange(y, min, max)} onClick={() => onPick(y)}>Yesterday</button>
        <span className="grow" />
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body
  );
}
