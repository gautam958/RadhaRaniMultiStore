export const shop = {
  name: import.meta.env.VITE_SHOP_NAME || 'Radha Rani Multi Store',
  address: import.meta.env.VITE_SHOP_ADDRESS || '',
  phone: import.meta.env.VITE_SHOP_PHONE || '',
  gstin: import.meta.env.VITE_SHOP_GSTIN || '',
  upiId: import.meta.env.VITE_UPI_ID || ''
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => inr.format(n ?? 0);
export const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ''));

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const dateTime = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const time = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleTimeString('en-IN', { timeStyle: 'short' });

/** Loose units can be sold in fractions; counted units (pcs, box, pack…) only in whole numbers. */
export const allowsFraction = (unit?: string) => ['kg', 'g', 'gm', 'ltr', 'l', 'ml', 'mtr', 'm'].includes((unit ?? '').trim().toLowerCase());
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const modeLabel: Record<string, string> = { Cash: 'Cash', Upi: 'UPI', Card: 'Card', Credit: 'Udhaar' };

/** UPI deep link — encoded into a QR so the customer scans and pays the exact bill amount. */
export function upiLink(amount: number, note: string) {
  const p = new URLSearchParams({ pa: shop.upiId, pn: shop.name, am: amount.toFixed(2), cu: 'INR', tn: note });
  return `upi://pay?${p.toString()}`;
}

const TARGET_BYTES = 250 * 1024;

/** Decode any image the browser can show (JPEG, PNG, WebP, HEIC on Safari…). */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Some formats (e.g. iPhone HEIC in Safari) only decode through an <img> element.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrink a camera/gallery photo for upload: max 800px, WebP where supported, otherwise JPEG
 * (Safari can't encode WebP and would silently return a huge PNG). Keeps reducing quality and
 * size until the file is under ~250 KB.
 */
export async function compressImage(file: File, max = 800): Promise<Blob> {
  const src = await decode(file);
  let side = max;
  let quality = 0.82;

  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(src.width, src.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(src.width * scale));
    canvas.height = Math.max(1, Math.round(src.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';                       // JPEG has no transparency — use a white background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

    let blob = await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
    if (!blob) throw new Error('Image conversion failed');
    if (blob.size <= TARGET_BYTES) return blob;

    // Too big: lower quality first, then dimensions.
    if (quality > 0.55) quality -= 0.12;
    else side = Math.round(side * 0.8);
  }
  throw new Error('Could not make this photo small enough — try a different photo');
}

export function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 1200;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* no audio */ }
}
