import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';

interface User {
  id: number;
  email: string;
  fullName: string;
  role: string;
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
  login: (token: string) => void;
  logout: () => void;
  loading: boolean;
  auditLogs: AuditLog[];
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeToken(token: string): User | null {
  try {
    const decoded: any = jwtDecode(token);
    return {
      id: Number(decoded.sub) || Number(decoded.id) || 0,
      email: decoded.email,
      fullName: decoded.fullName || decoded.name || '',
      role: decoded.role || 'USER',
    };
  } catch (e) {
    console.error('❌ Erro ao decodificar token:', e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      const userData = decodeToken(token);
      if (userData) setUser(userData);
    }

    const savedLogs = localStorage.getItem('auditLogs');
    if (savedLogs) setAuditLogs(JSON.parse(savedLogs));

    setLoading(false);
  }, []);

  // Função para registrar auditoria (não bloqueia o login)
  const registrarAuditoria = async (action: 'LOGIN' | 'LOGOUT') => {
    if (!user) return;

    try {
      const res = await fetch('/api/audit/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          userName: user.fullName,
          email: user.email,
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

  const login = (token: string) => {
    localStorage.setItem('token', token);
    const userData = decodeToken(token);

    if (userData) {
      setUser(userData);
      registrarAuditoria('LOGIN');   // ← agora não bloqueia
    }
  };

  const logout = () => {
    registrarAuditoria('LOGOUT');
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, auditLogs }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
