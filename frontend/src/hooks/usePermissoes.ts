// src/hooks/usePermissoes.ts
// =============================================================================
// Carrega e disponibiliza as permissões do usuário logado.
// Gestores recebem FULL em tudo (isGestor=true). Usuários sem equipe recebem {}.
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
  const precisaCarregar = user && !isAdminUser;

  const [permissoes, setPermissoes] = useState<PermissaoMap>({});
  const [isGestor,    setIsGestor]    = useState(false);
  const [temEquipe,  setTemEquipe]  = useState(false);
  // Começa true quando há permissões reais a carregar — evita flash de "sem acesso"
  const [loading,    setLoading]    = useState(() => !!precisaCarregar);

  // Sequência para descartar respostas obsoletas: se o contexto ativo mudar (ex.:
  // multi-perfil trocando de empresa) enquanto um fetch está em voo, só o resultado
  // da última chamada é aplicado — evita que uma resposta antiga (ex.: FORNECEDOR)
  // sobrescreva a correta (ex.: GESTOR) por chegar fora de ordem.
  const fetchSeq = useRef(0);

  const carregar = useCallback(async () => {
    if (!precisaCarregar) {
      fetchSeq.current++; // invalida qualquer fetch em voo
      setPermissoes({});
      setIsGestor(false);
      setTemEquipe(false);
      setLoading(false);
      return;
    }
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await api.get('/equipes/minhas-permissoes');
      if (seq !== fetchSeq.current) return; // resposta obsoleta — ignora
      setPermissoes(res.data?.dados?.permissoes ?? {});
      setIsGestor(res.data?.dados?.isGestor     ?? false);
      setTemEquipe(res.data?.dados?.temEquipe  ?? false);
    } catch {
      if (seq !== fetchSeq.current) return;
      setPermissoes({});
      setTemEquipe(false);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [precisaCarregar]);

  // Só busca depois que o contexto ativo foi resolvido/persistido (empresaLoading=false)
  // e refaz quando o contexto muda (empresaId/equipeId) — garante o header correto.
  useEffect(() => {
    if (empresaLoading) return;
    carregar();
  }, [carregar, empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  const podeExecutar = useCallback((slug: string, nivelMinimo: Nivel = 'LEITURA'): boolean => {
    if (isGestor || isAdminUser) return true;
    // PROPRIETARIO e demais: verifica o mapa retornado pelo backend
    const nivelAtual = permissoes[slug] ?? 'NENHUM';
    return NIVEL_ORDINAL[nivelAtual] >= NIVEL_ORDINAL[nivelMinimo];
  }, [isGestor, isAdminUser, permissoes]);

  return { permissoes, isGestor, temEquipe, loading, podeExecutar, recarregar: carregar };
}