import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { SUPER_ADMIN_EMAIL, type Me, type Role } from '../lib/api';
import { shop } from '../lib/util';

interface NavItem { to: string; label: string; icon: string; min: Role; mobile?: boolean; superAdmin?: boolean }

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◧', min: 'Manager', mobile: true },
  { to: '/pos', label: 'Billing', icon: '₹', min: 'Cashier', mobile: true },
  { to: '/products', label: 'Items', icon: '▤', min: 'Cashier', mobile: true },
  { to: '/stock-in', label: 'Stock In', icon: '⇣', min: 'Manager', mobile: true },
  { to: '/sales', label: 'Bills', icon: '🧾', min: 'Cashier' },
  { to: '/customers', label: 'Customers', icon: '👥', min: 'Cashier', mobile: true },
  { to: '/daybook', label: 'Day Book', icon: '📒', min: 'Manager' },
  { to: '/suppliers', label: 'Suppliers', icon: '🚚', min: 'Manager' },
  { to: '/audit', label: 'Audit Log', icon: '🕵', min: 'Owner', superAdmin: true },
  { to: '/users', label: 'Staff', icon: '🔑', min: 'Owner', superAdmin: true }
];

export const isSuperAdmin = (u: Me | null | undefined) => u?.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
const visible = (n: NavItem, user: Me | null, can: (r: Role) => boolean) => can(n.min) && (!n.superAdmin || isSuperAdmin(user));

export function Layout() {
  const { user, can, logout } = useAuth();
  const items = NAV.filter(n => visible(n, user, can));
  const mobile = items.filter(n => n.mobile).slice(0, 4);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /><div><b>{shop.name}</b><small>POS & Inventory</small></div></div>
        <nav>
          {items.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
              <span className="nav-ico">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          {user?.pictureUrl && <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" />}
          <div><b>{user?.name}</b><small>{user?.role}</small></div>
          <button className="btn sm ghost" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="content"><Outlet /></main>

      <nav className="bottom-nav">
        {mobile.map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="bn-link">
            <span className="nav-ico">{n.icon}</span><small>{n.label}</small>
          </NavLink>
        ))}
        <NavLink to="/more" className="bn-link"><span className="nav-ico">☰</span><small>More</small></NavLink>
      </nav>
    </div>
  );
}

export function MorePage() {
  const { user, can, logout } = useAuth();
  return (
    <div className="page">
      <h1>More</h1>
      <div className="more-grid">
        {NAV.filter(n => visible(n, user, can)).map(n => (
          <NavLink key={n.to} to={n.to} className="card more-tile"><span className="nav-ico big">{n.icon}</span>{n.label}</NavLink>
        ))}
      </div>
      <div className="card row between" style={{ marginTop: 16 }}>
        <div><b>{user?.name}</b><div className="muted">{user?.email} · {user?.role}</div></div>
        <button className="btn" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
