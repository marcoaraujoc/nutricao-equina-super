import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';

interface User {
  id: number;
  email: string;
  fullName: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (token: string) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function isJWT(token: string) {
  return token.split('.').length === 3;
}

function decodeToken(token: string): User | null {
  try {
    if (isJWT(token)) {
      const decoded: any = jwtDecode(token);

      return {
        id: Number(decoded.sub) || 0,
        email: decoded.email,
        fullName: decoded.name || '',
        role: decoded.role || 'USER',
      };
    } else {
      return JSON.parse(atob(token));
    }
  } catch (e) {
    console.error('❌ Erro ao decodificar token:', e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (token) {
      const userData = decodeToken(token);
      if (userData) setUser(userData);
    }

    setLoading(false);
  }, []);

  const login = (token: string) => {
    localStorage.setItem('token', token);

    const userData = decodeToken(token);
    if (userData) {
      setUser(userData);
    } else {
      logout();
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}