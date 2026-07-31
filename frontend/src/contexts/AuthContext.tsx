import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

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
  login: () => Promise<User | null>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
  auditLogs: AuditLog[];
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Sessão por cookie HttpOnly ──────────────────────────────────────────────
// O token vive em cookies HttpOnly (s2vet_at/s2vet_rt) que o JS não consegue ler.
// A identidade do usuário vem sempre de /api/users/me (o cookie é enviado
// automaticamente com credentials: 'include'). Não há token em storage.
// O cookie-dica `s2vet_auth` (NÃO-HttpOnly, sem token) sinaliza que há sessão —
// sem ele, o front não sonda /me nem /refresh (evita 401 no console na tela de login).

function temDicaDeSessao(): boolean {
  return document.cookie.split(';').some(c => c.trim().startsWith('s2vet_auth='));
}
function limparDicaDeSessao(): void {
  document.cookie = 's2vet_auth=; Max-Age=0; path=/';
}

async function fetchMe(): Promise<User | null> {
  try {
    // `fetch` cru NÃO leva `x-empresa-id`/`x-equipe-id` (só o axios injeta): o /me
    // voltava com o tipo e o cadastro do FALLBACK do backend — o vínculo de equipe
    // mais recente — em vez dos da empresa selecionada. Como o `userType` daqui
    // alimenta o app inteiro (rotas, Sidebar, gates), o app inteiro via a empresa
    // errada. Headers lidos do mesmo localStorage que o EmpresaContext escreve.
    const headers: Record<string, string> = {};
    const empresaId = localStorage.getItem('s2vet_empresa_id');
    const equipeId  = localStorage.getItem('s2vet_equipe_id');
    if (empresaId) headers['x-empresa-id'] = empresaId;
    if (equipeId)  headers['x-equipe-id']  = equipeId;

    const res = await fetch('/api/users/me', { credentials: 'include', headers });
    if (!res.ok) return null;
    const perfil = await res.json();
    return {
      id:                 perfil.id,
      email:              perfil.email,
      fullName:           perfil.fullName ?? '',
      role:               perfil.role ?? perfil.userType ?? 'USER',
      userType:           perfil.userType,
      mustChangePassword: perfil.mustChangePassword ?? false,
      profileComplete:    perfil.profileComplete    ?? false,
      isConvidado:        perfil.isConvidado        ?? false,
      pendingInvite:      perfil.pendingInvite       ?? null,
    };
  } catch {
    return null;
  }
}

// Renova a sessão via cookie de refresh (HttpOnly) — sem token no corpo.
async function tryRefreshSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Fetch autenticado com refresh automático em 401 ─────────────────────────
// Mantido para os poucos call sites que ainda usam fetch cru. Envia o cookie.
export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let res = await fetch(input, { ...init, credentials: 'include' });
  if (res.status === 401) {
    const ok = await tryRefreshSession();
    if (ok) res = await fetch(input, { ...init, credentials: 'include' });
  }
  return res;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [loading, setLoading]     = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    const init = async () => {
      // Só sonda a sessão se houver dica de sessão — sem ela (nunca logou / logout),
      // evita GET /me e POST /refresh 401 na tela de login.
      if (temDicaDeSessao()) {
        let me = await fetchMe();
        if (!me) {
          // Cookie de acesso expirado — tenta renovar via refresh token (cookie)
          const renovou = await tryRefreshSession();
          if (renovou) me = await fetchMe();
        }
        if (me) setUser(me);
        else limparDicaDeSessao(); // sondagem falhou — remove a dica órfã
      }
      const savedLogs = localStorage.getItem('auditLogs');
      if (savedLogs) setAuditLogs(JSON.parse(savedLogs));
      setLoading(false);
    };
    init();
  }, []);

  // ── Re-sincroniza a identidade quando a janela volta ao foco ────────────────
  // Cookies de sessão são por PERFIL do navegador (não por aba/janela): abrir outra
  // janela do mesmo perfil e logar com outro usuário troca o cookie COMPARTILHADO.
  // Ao focar esta janela (ou a aba ficar visível), re-buscamos /me e adotamos a
  // identidade REAL da sessão — evita exibir um usuário e operar como outro.
  useEffect(() => {
    const sincronizar = async () => {
      if (!temDicaDeSessao()) { setUser(prev => (prev ? null : prev)); return; }
      let me = await fetchMe();
      if (!me) { const ok = await tryRefreshSession(); if (ok) me = await fetchMe(); }
      if (me) {
        const atual = me;
        // Só re-renderiza quando a identidade muda de fato (id diferente)
        setUser(prev => (prev && prev.id === atual.id ? prev : atual));
      }
    };
    const onFocus = () => { void sincronizar(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void sincronizar(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ── Logout automático por inatividade (1 hora sem interação) ───────────────
  useEffect(() => {
    if (!user) return;

    const TIMEOUT_MS = 60 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => logout(), TIMEOUT_MS);
    };

    const eventos: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    eventos.forEach(evento => window.addEventListener(evento, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timer);
      eventos.forEach(evento => window.removeEventListener(evento, resetTimer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const registrarAuditoria = async (action: 'LOGIN' | 'LOGOUT', u: User | null) => {
    if (!u) return;
    try {
      await fetch('/api/audit/log', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, userName: u.fullName, email: u.email, action }),
      });
    } catch (err) {
      console.warn(`⚠️ Falha ao registrar auditoria (${action}):`, err);
    }
  };

  // ── Recarrega perfil do usuário logado sem fazer logout ────────────────────
  const refreshUser = async (): Promise<void> => {
    const me = await fetchMe();
    if (me) setUser(me);
  };

  // O backend já autenticou e setou os cookies HttpOnly na resposta de login.
  // Aqui apenas carregamos a identidade a partir de /me e limpamos o contexto ativo.
  // Devolve o usuário carregado para quem chamou decidir o destino pós-login
  // (a tela de Login manda profissional para o Mapa de Atendimento).
  const login = async (): Promise<User | null> => {
    localStorage.removeItem('s2vet_empresa_id');
    localStorage.removeItem('s2vet_equipe_id');
    const me = await fetchMe();
    if (me) {
      setUser(me);
      registrarAuditoria('LOGIN', me);
    }
    return me;
  };

  const logout = () => {
    const atual = user;
    registrarAuditoria('LOGOUT', atual);
    // Encerra a sessão no backend (revoga refresh token + limpa cookies HttpOnly)
    fetch('/api/auth/logout', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        '{}',
    }).catch(() => { /* best-effort */ });
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
