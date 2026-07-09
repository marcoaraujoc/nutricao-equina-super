// frontend/src/contexts/EmpresaContext.tsx
// Contexto ativo do gestor multi-empresa/multi-equipe.
// - Empresa com CNPJ → o gestor trabalha no nível da EMPRESA (1 opção por empresa).
// - Empresa pessoal (CPF, cnpj null) → o gestor trabalha no nível da EQUIPE
//   (1 opção por equipe da empresa pessoal).
// A seleção é persistida em localStorage e enviada em toda requisição via headers
// x-empresa-id / x-equipe-id (interceptor em services/api.ts). O backend valida o
// vínculo do usuário antes de usar (auth.js) — valores inválidos são ignorados lá.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';

export const EMPRESA_ATIVA_KEY = 's2vet_empresa_id';
export const EQUIPE_ATIVA_KEY  = 's2vet_equipe_id';

export interface ContextoOpcao {
  empresaId: number;
  /** null = opção no nível da empresa (CNPJ); número = equipe ativa (CPF) */
  equipeId: number | null;
  label: string;
  /** Cargo do usuário nesse contexto (GESTOR, VETERINARIO, FORNECEDOR...) */
  cargo?: string;
}

interface EmpresaContextType {
  /** Opções de contexto (empresas CNPJ + equipes de empresas pessoais). Vazio para demais perfis */
  opcoes: ContextoOpcao[];
  contextoAtivo: ContextoOpcao | null;
  /** Persiste a seleção e recarrega a aplicação para refazer todos os fetches */
  trocarContexto: (opcao: ContextoOpcao) => void;
  loading: boolean;
}

const EmpresaContext = createContext<EmpresaContextType>({
  opcoes: [],
  contextoAtivo: null,
  trocarContexto: () => undefined,
  loading: true,
});

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [opcoes, setOpcoes] = useState<ContextoOpcao[]>([]);
  const [contextoAtivo, setContextoAtivo] = useState<ContextoOpcao | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sem gate por userType: qualquer usuário com vínculos (dono/gestor de empresa
    // OU membro de equipe — ex: FORNECEDOR que assinou e virou gestor da própria
    // empresa) recebe suas opções de contexto. Quem não tem vínculo recebe [].
    if (!user) {
      setOpcoes([]);
      setContextoAtivo(null);
      setLoading(false);
      return;
    }

    let cancelado = false;
    (async () => {
      try {
        const res = await api.get('/equipes/meus-contextos');
        if (cancelado) return;
        if (!res.data) { setOpcoes([]); setContextoAtivo(null); return; } // GET 403 → null
        const lista = (res.data.dados ?? []) as ContextoOpcao[];
        setOpcoes(lista);

        const empresaSalva = Number(localStorage.getItem(EMPRESA_ATIVA_KEY));
        const equipeSalva  = Number(localStorage.getItem(EQUIPE_ATIVA_KEY));
        const salva =
          lista.find((o) => o.equipeId !== null && o.equipeId === equipeSalva) ??
          lista.find((o) => o.equipeId === null && o.empresaId === empresaSalva);
        // Sem contexto salvo (login recém-feito): perfil GESTOR tem preferência —
        // quem é gestor de uma empresa entra nela por padrão, mesmo que também
        // tenha vínculos como fornecedor/vet em outras equipes
        const padrao = lista.find((o) => o.cargo === 'GESTOR') ?? lista[0] ?? null;
        const ativa = salva ?? padrao;
        setContextoAtivo(ativa);

        if (ativa) {
          localStorage.setItem(EMPRESA_ATIVA_KEY, String(ativa.empresaId));
          if (ativa.equipeId) localStorage.setItem(EQUIPE_ATIVA_KEY, String(ativa.equipeId));
          else localStorage.removeItem(EQUIPE_ATIVA_KEY);
        } else {
          localStorage.removeItem(EMPRESA_ATIVA_KEY);
          localStorage.removeItem(EQUIPE_ATIVA_KEY);
        }
      } catch {
        if (!cancelado) { setOpcoes([]); setContextoAtivo(null); }
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();

    return () => { cancelado = true; };
  }, [user]);

  const trocarContexto = (opcao: ContextoOpcao) => {
    if (opcao.empresaId === contextoAtivo?.empresaId && opcao.equipeId === contextoAtivo?.equipeId) return;
    localStorage.setItem(EMPRESA_ATIVA_KEY, String(opcao.empresaId));
    if (opcao.equipeId) localStorage.setItem(EQUIPE_ATIVA_KEY, String(opcao.equipeId));
    else localStorage.removeItem(EQUIPE_ATIVA_KEY);
    // Reload garante que todas as páginas refaçam os fetches no novo contexto
    window.location.reload();
  };

  return (
    <EmpresaContext.Provider value={{ opcoes, contextoAtivo, trocarContexto, loading }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  return useContext(EmpresaContext);
}
