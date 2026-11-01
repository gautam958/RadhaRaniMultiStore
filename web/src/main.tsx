import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './lib/auth';
import type { Role } from './lib/api';
import { Layout, MorePage, isSuperAdmin } from './components/Layout';
import { Toasts } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { PosPage } from './pages/Pos';
import { ProductsPage } from './pages/Products';
import { StockInPage } from './pages/StockIn';
import { SalesPage } from './pages/Sales';
import { CustomersPage } from './pages/Customers';
import { DayBookPage } from './pages/DayBook';
import { SuppliersPage } from './pages/Suppliers';
import { UsersPage } from './pages/Users';
import { AuditPage } from './pages/Audit';
import { ReportsPage } from './pages/Reports';
import './styles.css';

function Guard({ min, children }: { min: Role; children: JSX.Element }) {
  const { can } = useAuth();
  return can(min) ? children : <Navigate to="/pos" replace />;
}

function SuperAdmin({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return isSuperAdmin(user) ? children : <Navigate to="/pos" replace />;
}

function App() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Guard min="Manager"><DashboardPage /></Guard>} />
        <Route path="pos" element={<PosPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="stock-in" element={<Guard min="Manager"><StockInPage /></Guard>} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="daybook" element={<Guard min="Manager"><DayBookPage /></Guard>} />
        <Route path="reports" element={<Guard min="Owner"><ReportsPage /></Guard>} />
        <Route path="suppliers" element={<Guard min="Manager"><SuppliersPage /></Guard>} />
        <Route path="users" element={<SuperAdmin><UsersPage /></SuperAdmin>} />
        <Route path="audit" element={<SuperAdmin><AuditPage /></SuperAdmin>} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <App />
          <Toasts />
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  </StrictMode>
);
