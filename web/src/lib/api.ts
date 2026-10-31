// Thin fetch wrapper: adds the session token, parses JSON, turns API errors into readable messages.

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'rr.session';

export type Role = 'Cashier' | 'Manager' | 'Owner';
export type PaymentMode = 'Cash' | 'Upi' | 'Card' | 'Credit';
export const roleRank: Record<Role, number> = { Cashier: 1, Manager: 2, Owner: 3 };

export interface Me { id: number; email: string; name: string; role: Role; pictureUrl?: string }
export interface Session { token: string; expiresUtc: string; user: Me }

export interface Category { id: number; name: string; sortOrder: number; isActive: boolean }
export interface Product {
  id: number; name: string; nameHindi?: string; categoryId?: number; categoryName?: string; brand?: string;
  sku?: string; barcode?: string; unit: string;
  mrp: number; sellingPrice: number; costPrice?: number; discountPercent: number; effectivePrice: number;
  gstRate: number; hsn?: string; qtyOnHand: number; reorderLevel: number;
  stockStatus: 'InStock' | 'Low' | 'OutOfStock'; isActive: boolean; imageUrl?: string; updatedAt: string;
  deletedAt?: string; deletedBy?: string; deletedReason?: string;
}
export interface Paged<T> { total: number; page: number; pageSize: number; items: T[] }
export interface Customer {
  id: number; name: string; phone?: string; email?: string; address?: string; creditLimit: number; due: number;
  totalPurchases?: number; billCount?: number; lastBillAt?: string;
}
export interface Supplier { id: number; name: string; phone?: string; email?: string; gstin?: string; address?: string; due: number }
export interface AuditEntry { id: number; at: string; userEmail: string; action: string; entity: string; entityId?: string; summary?: string; changes?: string }
export interface SaleItem { productId: number; productName: string; qty: number; mrp: number; unitPrice: number; discountPercent: number; gstRate: number; lineTotal: number }
export interface Sale {
  id: number; billNo: string; createdAt: string; customerId?: number; customerName?: string; customerPhone?: string;
  subTotal: number; itemDiscount: number; billDiscount: number; total: number; taxAmount: number;
  paymentMode: PaymentMode; paymentRef?: string; status: 'Completed' | 'Voided'; cashierEmail: string; voidReason?: string;
  items: SaleItem[]; profit?: number; remarks?: string; cashReceived?: number; changeReturned?: number;
}
export interface AppUser { id: number; email: string; name: string; role: Role; isActive: boolean; lastLoginAt?: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return new Date(s.expiresUtc) > new Date() ? s : null;
  } catch { return null; }
}
export function setSession(s: Session | null) {
  try { s ? localStorage.setItem(TOKEN_KEY, JSON.stringify(s)) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export function apiUrl(path: string) { return BASE + path; }

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const s = getSession();
  if (s) headers.Authorization = `Bearer ${s.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) { body = opts.raw; headers['Content-Type'] = opts.raw.type || 'application/octet-stream'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }

  let res: Response;
  try {
    res = await fetch(BASE + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, 'No internet / server not reachable');
  }
  if (res.status === 401) onUnauthorized();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Error ${res.status}`);
  return data as T;
}

function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return t; } }
