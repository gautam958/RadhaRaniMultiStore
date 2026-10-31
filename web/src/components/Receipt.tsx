import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Sale } from '../lib/api';
import { dateTime, modeLabel, money, qty, shop } from '../lib/util';

/** 58/80 mm thermal-printer friendly bill. Printing hides everything except .print-area. */
export function Receipt({ sale }: { sale: Sale }) {
  return (
    <div className="receipt print-area">
      <div className="r-center">
        <b className="r-shop">{shop.name}</b>
        {shop.address && <div>{shop.address}</div>}
        {shop.phone && <div>Ph: {shop.phone}</div>}
        {shop.gstin && <div>GSTIN: {shop.gstin}</div>}
      </div>
      <div className="r-sep" />
      <div className="r-row"><span>Bill: {sale.billNo}</span><span>{dateTime(sale.createdAt)}</span></div>
      {sale.customerName && <div>Customer: {sale.customerName}{sale.customerPhone ? ` (${sale.customerPhone})` : ''}</div>}
      {sale.remarks && <div className="r-remarks">Note: {sale.remarks}</div>}
      {sale.status === 'Voided' && <div className="r-void">CANCELLED — {sale.voidReason}</div>}
      <div className="r-sep" />
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amt</th></tr></thead>
        <tbody>
          {sale.items.map((i, n) => (
            <tr key={n}>
              <td>{i.productName}{i.mrp > i.unitPrice && <div className="r-mrp">MRP {money(i.mrp)}</div>}</td>
              <td>{qty(i.qty)}</td><td>{i.unitPrice.toFixed(2)}</td><td>{i.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="r-sep" />
      <div className="r-row"><span>Items total</span><span>{money(sale.subTotal)}</span></div>
      {sale.itemDiscount > 0 && <div className="r-row"><span>Item discount</span><span>−{money(sale.itemDiscount)}</span></div>}
      {sale.billDiscount > 0 && <div className="r-row"><span>Bill discount</span><span>−{money(sale.billDiscount)}</span></div>}
      <div className="r-row r-total"><span>TOTAL</span><span>{money(sale.total)}</span></div>
      {sale.taxAmount > 0 && <div className="r-row small"><span>Incl. GST</span><span>{money(sale.taxAmount)}</span></div>}
      <div className="r-row"><span>Paid by</span><span>{modeLabel[sale.paymentMode]}</span></div>
      {sale.cashReceived != null && <>
        <div className="r-row"><span>Cash received</span><span>{money(sale.cashReceived)}</span></div>
        <div className="r-row"><span>Change returned</span><span>{money(sale.changeReturned ?? 0)}</span></div>
      </>}
      {saved(sale) > 0.5 && <div className="r-center r-save">You saved {money(saved(sale))} on MRP</div>}
      <div className="r-sep" />
      <div className="r-center">Thank you! Visit again 🙏</div>
    </div>
  );
}

const saved = (s: Sale) => s.items.reduce((t, i) => t + (i.mrp - i.unitPrice) * i.qty, 0) + s.billDiscount;

export function whatsappBillText(s: Sale) {
  const lines = [
    `*${shop.name}*`, `Bill ${s.billNo} · ${dateTime(s.createdAt)}`, '',
    ...s.items.map(i => `${i.productName} × ${qty(i.qty)} = ${money(i.lineTotal)}`), '',
    s.itemDiscount + s.billDiscount > 0 ? `Discount: ${money(s.itemDiscount + s.billDiscount)}` : '',
    `*Total: ${money(s.total)}* (${modeLabel[s.paymentMode]})`,
    s.cashReceived != null ? `Cash received: ${money(s.cashReceived)} · Change: ${money(s.changeReturned ?? 0)}` : '',
    s.remarks ? `Note: ${s.remarks}` : '', '', 'Thank you! 🙏'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return lines.join('\n');
}

export function whatsappLink(phone: string | undefined, text: string) {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function UpiQr({ link, size = 220 }: { link: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(link, { width: size, margin: 1 }).then(setSrc).catch(() => setSrc('')); }, [link, size]);
  return src ? <img src={src} width={size} height={size} alt="UPI QR code" className="upi-qr" /> : null;
}
