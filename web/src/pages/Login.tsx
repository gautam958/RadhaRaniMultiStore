import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../lib/auth';
import { shop } from '../lib/util';

export function LoginPage() {
  const { loginWithGoogle, loginDev } = useAuth();
  const [devEmail, setDevEmail] = useState('');
  const hasGoogle = !!import.meta.env.VITE_GOOGLE_CLIENT_ID && !import.meta.env.VITE_GOOGLE_CLIENT_ID.startsWith('YOUR_');
  const devLogin = import.meta.env.VITE_DEV_LOGIN === 'true';
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <div className="login-card">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} />
        <h1>{shop.name}</h1>
        <p className="muted">Billing, stock and khata — sign in with your Google account.</p>
        {hasGoogle && <div className="login-btn">
          <GoogleLogin
            onSuccess={async r => {
              if (!r.credential) return;
              setBusy(true); setErr(null);
              try { await loginWithGoogle(r.credential); }
              catch (e) { setErr((e as Error).message); }
              finally { setBusy(false); }
            }}
            onError={() => setErr('Google sign-in was cancelled or failed')}
            text="signin_with" shape="pill" size="large"
          />
        </div>}
        {devLogin && (
          <form className="stack" style={{ margin: '18px 0 8px' }} onSubmit={async e => {
            e.preventDefault(); setBusy(true); setErr(null);
            try { await loginDev(devEmail); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }}>
            <input className="input" type="email" placeholder="Owner / staff email" value={devEmail} onChange={e => setDevEmail(e.target.value)} />
            <button className="btn primary block" disabled={!devEmail.includes('@') || busy}>Local test sign-in</button>
            <small className="muted">Local testing only — disabled when deployed.</small>
          </form>
        )}
        {busy && <p className="muted">Signing in…</p>}
        {err && <p className="error-box">{err}</p>}
        <p className="muted small">Only staff added by the owner can sign in.</p>
      </div>
    </div>
  );
}
