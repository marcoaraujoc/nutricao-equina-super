// src/hooks/usePermissoes.ts
// =============================================================================
// Carrega e disponibiliza as permissões do usuário logado.
// Gestores recebem FULL em tudo (isGestor=true). Usuários sem equipe recebem {}.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

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

  const userType  = (user?.userType ?? '').toUpperCase();
  const userRole  = (user?.role     ?? '').toUpperCase();
  const isAdminUser = userType === 'ADMIN' || userRole === 'ADMIN';
  const precisaCarregar = user && !isAdminUser;

  const [permissoes, setPermissoes] = useState<PermissaoMap>({});
  const [isGestor,    setIsGestor]    = useState(false);
  const [temEquipe,  setTemEquipe]  = useState(false);
  // Começa true quando há permissões reais a carregar — evita flash de "sem acesso"
  const [loading,    setLoading]    = useState(() => !!precisaCarregar);

  const carregar = useCallback(async () => {
    if (!precisaCarregar) {
      setPermissoes({});
      setIsGestor(false);
      setTemEquipe(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get('/equipes/minhas-permissoes');
      setPermissoes(res.data?.dados?.permissoes ?? {});
      setIsGestor(res.data?.dados?.isGestor     ?? false);
      setTemEquipe(res.data?.dados?.temEquipe  ?? false);
    } catch {
      setPermissoes({});
      setTemEquipe(false);
    } finally {
      setLoading(false);
    }
  }, [precisaCarregar]);

  useEffect(() => { carregar(); }, [carregar]);

  const podeExecutar = useCallback((slug: string, nivelMinimo: Nivel = 'LEITURA'): boolean => {
    if (isGestor || isAdminUser) return true;
    // PROPRIETARIO e demais: verifica o mapa retornado pelo backend
    const nivelAtual = permissoes[slug] ?? 'NENHUM';
    return NIVEL_ORDINAL[nivelAtual] >= NIVEL_ORDINAL[nivelMinimo];
  }, [isGestor, isAdminUser, permissoes]);

  return { permissoes, isGestor, temEquipe, loading, podeExecutar, recarregar: carregar };
}