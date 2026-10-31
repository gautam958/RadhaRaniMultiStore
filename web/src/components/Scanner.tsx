import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from 'html5-qrcode';
import { beep } from '../lib/util';

/**
 * Camera barcode scanner (EAN-13, EAN-8, UPC, Code128, QR).
 * continuous=true keeps scanning (POS / stock-in); otherwise closes after the first read.
 *
 * Camera shutdown is deliberately belt-and-braces: the library's stop() is skipped when the camera
 * is still starting (or the DOM is already gone), which used to leave the webcam light on. So on
 * close we also stop every MediaStream track ourselves — including streams that finish starting
 * after the scanner was closed. The camera also stops when the tab/app goes to the background.
 */
export function Scanner({ onScan, onClose, continuous = false }: {
  onScan: (code: string) => void; onClose: () => void; continuous?: boolean;
}) {
  const id = useRef(`scan-${Math.random().toString(36).slice(2)}`).current;
  const last = useRef({ code: '', at: 0 });
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onScan);
  cb.current = onScan;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let disposed = false;
    const streams = new Set<MediaStream>();

    // Capture every camera stream opened while this scanner is mounted.
    const md = navigator.mediaDevices;
    const originalGUM = md?.getUserMedia?.bind(md);

    // Phones block the camera on plain http:// (except localhost) — say so instead of failing silently.
    if (!window.isSecureContext || !originalGUM) {
      setErr(`Camera is blocked on this connection. Open https://${location.host}${location.pathname} (not http://)`);
      return () => { disposed = true; };
    }
    if (md && originalGUM) {
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        const s = await originalGUM(c);
        if (disposed) s.getTracks().forEach(t => t.stop());   // started after close → stop at once
        else streams.add(s);
        return s;
      };
    }

    const stopTracks = () => {
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      streams.clear();
      document.querySelectorAll<HTMLVideoElement>(`#${id} video`).forEach(v => {
        (v.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
        v.srcObject = null;
      });
    };

    const qr = new Html5Qrcode(id, {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE]
    });

    const started = qr.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 320), height: Math.min(h * 0.4, 140) }) },
      text => {
        if (disposed) return;
        const now = Date.now();
        if (text === last.current.code && now - last.current.at < 1500) return; // ignore repeat frames
        last.current = { code: text, at: now };
        beep();
        navigator.vibrate?.(60);
        cb.current(text);
        if (!continuous) closeRef.current();
      },
      () => { /* frame without a code */ }
    ).catch(e => {
      if (disposed) return;
      const msg = String(e?.name ?? '') + ' ' + String(e?.message ?? e);
      setErr(/Permission|NotAllowed/i.test(msg)
        ? 'Camera permission denied — allow camera for this site in the browser settings'
        : /NotReadable|in use/i.test(msg) ? 'Camera is being used by another app — close it and try again'
        : /NotFound|Overconstrained/i.test(msg) ? 'No camera found on this device'
        : 'Camera not available');
    });

    // Camera off when the app/tab is hidden (phone locked, switched app, other tab).
    const onHidden = () => { if (document.hidden) closeRef.current(); };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onHidden);
      if (md && originalGUM) md.getUserMedia = originalGUM;
      stopTracks();
      // Let the library tidy up too, once it has finished starting (errors are irrelevant now).
      started.finally(async () => {
        stopTracks();
        try { if (qr.isScanning) await qr.stop(); } catch { /* already stopped */ }
        try { qr.clear(); } catch { /* element gone */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scanner">
      <div id={id} className="scanner-view" />
      {err && <p className="scanner-err">{err}. You can type the barcode instead.</p>}
      <div className="scanner-bar">
        <span>{continuous ? 'Scanning… point at the next item' : 'Point the camera at a barcode'}</span>
        <button className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
