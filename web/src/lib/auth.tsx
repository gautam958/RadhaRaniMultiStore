import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getSession, roleRank, setSession, setUnauthorizedHandler, type Me, type Role, type Session } from './api';

interface AuthCtx {
  user: Me | null;
  loginWithGoogle: (credential: string) => Promise<void>;
  loginDev: (email: string) => Promise<void>;
  logout: () => void;
  can: (min: Role) => boolean;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(() => getSession()?.user ?? null);

  const logout = useCallback(() => { setSession(null); setUser(null); }, []);
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  // Refresh role/name from the server on start (owner may have changed it).
  useEffect(() => {
    if (!getSession()) return;
    api<Me>('/api/me').then(me => {
      const s = getSession();
      if (s) setSession({ ...s, user: me });
      setUser(me);
    }).catch(() => { /* offline: keep cached user */ });
  }, []);

  const loginWithGoogle = async (credential: string) => {
    const s = await api<Session>('/api/auth/google', { body: { credential } });
    setSession(s);
    setUser(s.user);
  };

  const loginDev = async (email: string) => {
    const s = await api<Session>('/api/auth/dev', { body: { email } });
    setSession(s);
    setUser(s.user);
  };

  const can = (min: Role) => !!user && roleRank[user.role] >= roleRank[min];

  return <Ctx.Provider value={{ user, loginWithGoogle, loginDev, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
