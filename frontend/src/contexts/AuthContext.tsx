import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';

export interface PendingInvite {
  id:                number;
  cargo:             string;
  equipeNome:        string;
  especiesHerdadas?: number[];
}

interface User {
  id: number;
  email: string;
  fullName: string;
  role: string;
  userType?:           string;
  mustChangePassword?: boolean;
  profileComplete?:    boolean;
  isConvidado?:        boolean;
  pendingInvite?:      PendingInvite | null;
}

interface AuditLog {
  id: number;
  userName: string;
  email: string;
  action: 'LOGIN' | 'LOGOUT';
  timestamp: string;
}

interface AuthContextType {
  user: User | null;
  login: (token: string, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
  auditLogs: AuditLog[];
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeToken(token: string): User | null {
  try {
    const decoded: any = jwtDecode(token);
    return {
      id:       Number(decoded.sub) || Number(decoded.id) || 0,
      email:    decoded.email,
      fullName: decoded.fullName || decoded.name || '',
      role:     decoded.role || 'USER',
    };
  } catch (e) {
    console.error('❌ Erro ao decodificar token:', e);
    return null;
  }
}

async function enriquecerComPerfil(userData: User): Promise<User> {
  try {
    const token = localStorage.getItem('token');
    const res   = await fetch('/api/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return userData;
    const perfil = await res.json();
    return {
      ...userData,
      fullName:           perfil.fullName || userData.fullName,
      userType:           perfil.userType ?? userData.role,
      mustChangePassword: perfil.mustChangePassword ?? false,
      profileComplete:    perfil.profileComplete    ?? false,
      isConvidado:        perfil.isConvidado        ?? false,
      pendingInvite:      perfil.pendingInvite       ?? null,
      role: perfil.userType === 'VETERINARIO' ? 'VETERINARIO' : userData.role,
    };
  } catch {
    return userData;
  }
}

// ── Token refresh silencioso ────────────────────────────────────────────────
async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  try {
    const res = await fetch('/api/auth/refresh', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      localStorage.removeItem('refreshToken');
      return null;
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

// ── Fetch autenticado com refresh automático em 401 ─────────────────────────
export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('token');
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
    }
  }

  return res;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [loading, setLoading]     = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    const init = async () => {
      let token = localStorage.getItem('token');
      if (token) {
        const userData = decodeToken(token);
        if (userData) {
          const enriquecido = await enriquecerComPerfil(userData);
          setUser(enriquecido);
        }
      } else {
        // sem token de acesso — tenta renovar via refresh token
        token = await tryRefreshToken();
        if (token) {
          const userData = decodeToken(token);
          if (userData) {
            const enriquecido = await enriquecerComPerfil(userData);
            setUser(enriquecido);
          }
        }
      }
      const savedLogs = localStorage.getItem('auditLogs');
      if (savedLogs) setAuditLogs(JSON.parse(savedLogs));
      setLoading(false);
    };
    init();
  }, []);

  const registrarAuditoria = async (action: 'LOGIN' | 'LOGOUT') => {
    if (!user) return;
    try {
      const res = await fetch('/api/audit/log', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:   user.id,
          userName: user.fullName,
          email:    user.email,
          action,
        }),
      });
      if (res.ok) {
        console.log(`✅ Auditoria registrada: ${action}`);
      } else {
        console.warn(`⚠️ Auditoria não gravada (${action}) - Status:`, res.status);
      }
    } catch (err) {
      console.warn(`⚠️ Falha ao registrar auditoria (${action}):`, err);
    }
  };

  // ── Recarrega perfil do usuário logado sem fazer logout ────────────────────
  const refreshUser = async (): Promise<void> => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const base = decodeToken(token);
    if (!base) return;
    const enriquecido = await enriquecerComPerfil(base);
    setUser(enriquecido);
  };

  const login = async (token: string, refreshToken?: string) => {
    localStorage.setItem('token', token);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    const userData = decodeToken(token);
    if (userData) {
      setUser(userData);
      enriquecerComPerfil(userData).then(enriquecido => setUser(enriquecido));
      registrarAuditoria('LOGIN');
    }
  };

  const logout = () => {
    registrarAuditoria('LOGOUT');
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      fetch('/api/auth/logout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken }),
      }).catch(() => { /* best-effort */ });
    }
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('s2vet_empresa_id');
    localStorage.removeItem('s2vet_equipe_id');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, loading, auditLogs }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}