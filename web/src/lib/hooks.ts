import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Loads JSON from the API; re-runs when `path` changes. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Tiny toast store without a library. */
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  const t = { id: Date.now() + Math.random(), text, kind };
  toasts = [...toasts, t];
  listeners.forEach(l => l(toasts));
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); listeners.forEach(l => l(toasts)); }, kind === 'err' ? 5000 : 2500);
}
export function useToasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter(l => l !== setList); }; }, []);
  return list;
}
