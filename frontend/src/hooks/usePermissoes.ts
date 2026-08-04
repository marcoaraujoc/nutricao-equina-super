// src/hooks/usePermissoes.ts
// =============================================================================
// Carrega e disponibiliza as permissões do usuário logado.
// Gestores recebem FULL em tudo (isGestor=true). Usuários sem equipe recebem {}.
//
// STORE ÚNICO no módulo (2026-08-02). O hook é consumido por ~46 componentes —
// Sidebar, AppHeader, a página e cada submódulo dela ficam montados ao mesmo tempo.
// Com estado por instância, CADA UM disparava o seu `GET /equipes/minhas-permissoes`,
// e o mesmo mapa era buscado 4-6 vezes por navegação. Isso sozinho consumia a maior
// fatia do rate limit (200 req/min em /api) e produzia 429 em uso normal.
//
// Agora: UMA requisição por contexto (empresa/equipe), compartilhada por todos os
// assinantes; quem monta depois recebe o valor já em memória, sem tocar na rede.
// Mesmo padrão de `useVetPendentes`. Regra geral: hook de fetch consumido em mais de
// um lugar precisa de store — ver CLAUDE.md.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useEmpresa } from '../contexts/EmpresaContext';

export type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL' | 'NEGADO';

export type PermissaoMap = Record<string, Nivel>;

const NIVEL_ORDINAL: Record<Nivel, number> = {
  NEGADO:  -1, // bloqueio explícito — nunca satisfaz nenhum nível mínimo
  NENHUM:  0,
  LEITURA: 1,
  PROPRIO: 2,
  EQUIPE:  3,
  FULL:    4,
};

interface UsePermissoesResult {
  permissoes:    PermissaoMap;
  isGestor:       boolean;
  temEquipe:     boolean;   // true se o usuário pertence a alguma equipe
  loading:       boolean;
  // Retorna true se o usuário tem ao menos o nível informado no slug dado
  podeExecutar:  (slug: string, nivelMinimo?: Nivel) => boolean;
  recarregar:    () => void;
}

// ADMIN tem bypass total via podeExecutar.
// PROPRIETARIO carrega permissões reais do backend (Dashboard sempre + grants do vet/empresa).

// ─── Store de módulo ─────────────────────────────────────────────────────────

interface EstadoPermissoes {
  permissoes: PermissaoMap;
  isGestor:   boolean;
  temEquipe:  boolean;
  loading:    boolean;
}

const VAZIO: EstadoPermissoes = { permissoes: {}, isGestor: false, temEquipe: false, loading: false };

let estado: EstadoPermissoes = VAZIO;
// Chave do que está em memória: userId + contexto ativo. Mudou a chave, os dados em
// cache são de outro escopo e não valem — é o que impede o gestor de ver o mapa da
// empresa anterior por um instante depois de trocar de contexto.
let chaveAtual: string | null = null;
// Requisição em VOO: o segundo componente a montar no mesmo tick não dispara outra,
// aguarda esta. Sem isso, o ganho do store sumiria no carregamento inicial da tela,
// que é justamente quando todos montam juntos.
let emVoo: Promise<void> | null = null;
const assinantes = new Set<(e: EstadoPermissoes) => void>();

function publicar(novo: EstadoPermissoes) {
  estado = novo;
  assinantes.forEach(notificar => notificar(novo));
}

async function buscar(chave: string, manterDados: boolean): Promise<void> {
  // Troca de contexto ZERA o mapa antes de buscar: manter o anterior enquanto carrega
  // exibiria, por um instante, as permissões da OUTRA empresa (menus e botões que a
  // pessoa não tem ali). Numa recarga do MESMO contexto os dados ficam, para a tela
  // não piscar.
  publicar(manterDados ? { ...estado, loading: true } : { ...VAZIO, loading: true });
  try {
    const res = await api.get('/equipes/minhas-permissoes');
    // Contexto trocou enquanto a resposta vinha: ela é de outro escopo — descarta.
    // (Mesmo motivo do `fetchSeq` que existia aqui antes do store.)
    if (chave !== chaveAtual) return;
    publicar({
      permissoes: res.data?.dados?.permissoes ?? {},
      isGestor:   res.data?.dados?.isGestor   ?? false,
      temEquipe:  res.data?.dados?.temEquipe  ?? false,
      loading:    false,
    });
  } catch {
    if (chave !== chaveAtual) return;
    publicar({ permissoes: {}, isGestor: false, temEquipe: false, loading: false });
  } finally {
    if (chave === chaveAtual) emVoo = null;
  }
}

/** Garante os dados da `chave` em memória, sem duplicar requisição. */
function garantir(chave: string, forcar = false): Promise<void> {
  const mesmaChave = chave === chaveAtual;
  // Já é a chave em memória e não é recarga explícita: aproveita o cache (ou a
  // requisição em voo). É AQUI que os 4-6 pedidos idênticos por navegação viram um.
  if (!forcar && mesmaChave) return emVoo ?? Promise.resolve();
  chaveAtual = chave;
  emVoo = buscar(chave, mesmaChave);
  return emVoo;
}

/** Limpa o store — logout ou usuário sem permissões a carregar (ADMIN). */
function limpar() {
  chaveAtual = null;
  emVoo = null;
  publicar(VAZIO);
}

export function usePermissoes(): UsePermissoesResult {
  const { user } = useAuth();
  // O contexto ativo (empresa/equipe) define QUAIS permissões o backend resolve.
  // Precisamos aguardá-lo antes de buscar, senão no 1º login (localStorage ainda
  // vazio) a requisição vai sem header e o backend resolve o vínculo mais recente
  // (ex.: um FORNECEDOR) em vez da empresa do GESTOR — sidebar vinha limitado.
  const { contextoAtivo, loading: empresaLoading } = useEmpresa();

  const userType  = (user?.userType ?? '').toUpperCase();
  const userRole  = (user?.role     ?? '').toUpperCase();
  const isAdminUser = userType === 'ADMIN' || userRole === 'ADMIN';
  const precisaCarregar = !!user && !isAdminUser;

  const chave = precisaCarregar
    ? `${user!.id}|${contextoAtivo?.empresaId ?? ''}|${contextoAtivo?.equipeId ?? ''}`
    : '';

  const [local, setLocal] = useState<EstadoPermissoes>(() =>
    // Já há dados desta mesma chave? Começa com eles — quem monta depois não passa
    // por um `loading` falso nem re-dispara a busca.
    precisaCarregar && chave === chaveAtual ? estado : { ...VAZIO, loading: precisaCarregar },
  );

  // Evita publicar em componente desmontado no meio de uma troca de contexto
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  useEffect(() => {
    const ouvinte = (e: EstadoPermissoes) => { if (vivo.current) setLocal(e); };
    assinantes.add(ouvinte);

    if (!precisaCarregar) {
      // ADMIN (bypass) ou deslogado: nada a buscar. Só limpa se o store ainda
      // guardava algo — senão o logout de um usuário zeraria o de outro em outra aba.
      if (chaveAtual !== null) limpar();
      else setLocal(VAZIO);
    } else if (!empresaLoading) {
      // Só busca depois que o contexto ativo foi resolvido/persistido, e refaz quando
      // ele muda — garante o header x-empresa-id/x-equipe-id correto.
      // `garantir` publica de forma síncrona (loading ou cache) antes de retornar, e
      // `setLocal(estado)` logo abaixo adota esse valor: quem monta com o cache quente
      // não passa por um `loading` falso nem dispara requisição nenhuma.
      garantir(chave);
      setLocal(estado);
    }

    return () => { assinantes.delete(ouvinte); };
  }, [chave, precisaCarregar, empresaLoading]);

  const recarregar = useCallback(() => {
    if (!precisaCarregar) return;
    garantir(chave, true);   // força: é um pedido explícito de recarga
  }, [chave, precisaCarregar]);

  const { permissoes, isGestor, temEquipe, loading } = local;

  const podeExecutar = useCallback((slug: string, nivelMinimo: Nivel = 'LEITURA'): boolean => {
    if (isGestor || isAdminUser) return true;
    // PROPRIETARIO e demais: verifica o mapa retornado pelo backend
    const nivelAtual = permissoes[slug] ?? 'NENHUM';
    return NIVEL_ORDINAL[nivelAtual] >= NIVEL_ORDINAL[nivelMinimo];
  }, [isGestor, isAdminUser, permissoes]);

  return { permissoes, isGestor, temEquipe, loading, podeExecutar, recarregar };
}
