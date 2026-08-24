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
import { registrarAcesso } from '../utils/contextoAcessos';
import { definirFusoDaEmpresa } from '../utils/dateUtils';

export const EMPRESA_ATIVA_KEY = 's2vet_empresa_id';
export const EQUIPE_ATIVA_KEY  = 's2vet_equipe_id';

/**
 * Rotas que carregam um ID DE ANIMAL na URL (ver App.tsx). O id é sempre de UMA
 * empresa — ao trocar de contexto, continuar nelas faz a empresa nova pedir um
 * paciente a que não tem acesso e a tela inteira responde 403.
 * O `\d` no fim é o que separa a rota de detalhe da rota de lista (/exames/12 × /exames).
 */
export const ROTA_COM_ANIMAL =
  /#\/(?:animal|animais|dieta|exames|relatorio-nutricional|exame-compra|resenha)\/\d|#\/clinica\/(?:evolucao|prescricao|vacina|exames|encaminhamento)\/\d/;

export interface ContextoOpcao {
  empresaId: number;
  /** null = opção no nível da empresa (CNPJ); número a equipe ativa (CPF) */
  equipeId: number | null;
  /** Nome da empresa/equipe, sem o cargo — fonte das iniciais do avatar */
  nome?: string;
  label: string;
  /** Cargo do usuário nesse contexto (GESTOR, VETERINARIO, FORNECEDOR...) */
  cargo?: string;
  cidade?: string | null;
  estado?: string | null;
}

/** Identidade visual da empresa do contexto ativo (logo + nome), de /equipes/logo */
export interface EmpresaMarca {
  logoUrl: string | null;
  empresaNome: string | null;
}

interface EmpresaContextType {
  /** Opções de contexto (empresas CNPJ + equipes de empresas pessoais). Vazio para demais perfis */
  opcoes: ContextoOpcao[];
  contextoAtivo: ContextoOpcao | null;
  /** Persiste a seleção e recarrega a aplicação para refazer todos os fetches */
  trocarContexto: (opcao: ContextoOpcao) => void;
  loading: boolean;
  /** Logo/nome da empresa ativa — buscado UMA vez aqui e consumido por Sidebar e rodapé */
  marca: EmpresaMarca;
}

const EmpresaContext = createContext<EmpresaContextType>({
  opcoes: [],
  contextoAtivo: null,
  trocarContexto: () => undefined,
  loading: true,
  marca: { logoUrl: null, empresaNome: null },
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

    // CRÍTICO (multi-perfil): enquanto o contexto ativo não estiver resolvido, mantém
    // loading=true para que o usePermissoes NÃO dispare um fetch prematuro sem os headers
    // x-empresa-id/x-equipe-id. Sem isto, no login o backend cai no vínculo mais recente
    // (ex.: FORNECEDOR) e o gestor via o sidebar limitado (só Cadastro) de forma instável —
    // duas buscas concorrentes podiam resolver fora de ordem e a errada sobrescrevia a certa.
    setLoading(true);

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
          // Contexto em uso conta como "acessado agora" — é o que faz o seletor
          // sempre mostrar a opção ativa como a mais recente.
          registrarAcesso(ativa);
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

  // Logomarca da empresa ativa. Vive aqui (e não no Sidebar) porque header, sidebar e
  // rodapé exibem a mesma marca — três cópias do fetch dariam três requisições e três
  // estados que podem divergir na troca de contexto.
  const [marca, setMarca] = useState<EmpresaMarca>({ logoUrl: null, empresaNome: null });
  useEffect(() => {
    // Sem usuário (logout) ou ao TROCAR de empresa, zera o fuso antes de recarregar:
    // manter o da empresa anterior exibiria os horários da nova clínica no fuso errado
    // até a resposta chegar — mesma razão pela qual `trocarContexto` limpa a seleção.
    if (!user) { setMarca({ logoUrl: null, empresaNome: null }); definirFusoDaEmpresa(null); return; }
    definirFusoDaEmpresa(null);

    let ativo = true;
    const carregar = () => {
      api.get('/equipes/logo')
        .then((r) => {
          if (!ativo || !r.data) return;  // GET 403 → data null (armadilha #23)
          setMarca({
            logoUrl:     r.data?.dados?.logoUrl ?? null,
            empresaNome: r.data?.dados?.empresaNome ?? null,
          });
          // FUSO DA CLÍNICA — empurrado para utils/dateUtils, que é quem formata
          // data/hora no app inteiro. Vem junto da marca porque esta é a única rota
          // de configuração legível por QUALQUER membro. A partir daqui a tela
          // mostra o relógio da clínica, e não o do aparelho de quem abriu.
          definirFusoDaEmpresa(r.data?.dados?.fusoHorario ?? null);
        })
        .catch(() => { /* silencioso — a marca tem fallback textual */ });
    };
    carregar();
    // Configurações dispara este evento ao salvar — atualiza a marca sem reload
    window.addEventListener('s2vet:config-atualizada', carregar);
    return () => {
      ativo = false;
      window.removeEventListener('s2vet:config-atualizada', carregar);
    };
  }, [user, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  const trocarContexto = (opcao: ContextoOpcao) => {
    if (opcao.empresaId === contextoAtivo?.empresaId && opcao.equipeId === contextoAtivo?.equipeId) return;
    registrarAcesso(opcao);
    localStorage.setItem(EMPRESA_ATIVA_KEY, String(opcao.empresaId));
    if (opcao.equipeId) localStorage.setItem(EQUIPE_ATIVA_KEY, String(opcao.equipeId));
    else localStorage.removeItem(EQUIPE_ATIVA_KEY);

    // O paciente selecionado é DAQUELA empresa — mantê-lo faz a próxima empresa abrir
    // as telas com um animal a que ela não tem acesso, e tudo responde 403.
    localStorage.removeItem('lastSelectedAnimalId');

    // Troca de contexto sempre pousa no Painel Principal — a tela em que se estava é
    // de outra empresa (paciente, agenda, fatura...) e não faz sentido no contexto novo.
    window.location.hash = '#/painel-principal';

    // Reload garante que todas as páginas refaçam os fetches no novo contexto
    window.location.reload();
  };

  return (
    <EmpresaContext.Provider value={{ opcoes, contextoAtivo, trocarContexto, loading, marca }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  return useContext(EmpresaContext);
}
