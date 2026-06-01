// src/hooks/usePermissoes.ts
// =============================================================================
// Carrega e disponibiliza as permissões do usuário logado.
// Sócios recebem FULL em tudo (isSocio=true). Usuários sem equipe recebem {}.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL';

export type PermissaoMap = Record<string, Nivel>;

const NIVEL_ORDINAL: Record<Nivel, number> = {
  NENHUM:  0,
  LEITURA: 1,
  PROPRIO: 2,
  EQUIPE:  3,
  FULL:    4,
};

interface UsePermissoesResult {
  permissoes:    PermissaoMap;
  isSocio:       boolean;
  temEquipe:     boolean;   // true se o usuário pertence a alguma equipe
  loading:       boolean;
  // Retorna true se o usuário tem ao menos o nível informado no slug dado
  podeExecutar:  (slug: string, nivelMinimo?: Nivel) => boolean;
  recarregar:    () => void;
}

const ROLES_SEM_EQUIPE = ['ADMIN', 'PROPRIETARIO'];

export function usePermissoes(): UsePermissoesResult {
  const { user } = useAuth();
  const [permissoes, setPermissoes] = useState<PermissaoMap>({});
  const [isSocio,    setIsSocio]    = useState(false);
  const [temEquipe,  setTemEquipe]  = useState(false);
  const [loading,    setLoading]    = useState(false);

  const userType = (user?.userType ?? '').toUpperCase();
  const precisaCarregar = user && !ROLES_SEM_EQUIPE.includes(userType);

  const carregar = useCallback(async () => {
    if (!precisaCarregar) {
      setPermissoes({});
      setIsSocio(false);
      setTemEquipe(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get('/equipes/minhas-permissoes');
      setPermissoes(res.data?.dados?.permissoes ?? {});
      setIsSocio(res.data?.dados?.isSocio     ?? false);
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
    if (isSocio) return true;
    const nivelAtual = permissoes[slug] ?? 'NENHUM';
    return NIVEL_ORDINAL[nivelAtual] >= NIVEL_ORDINAL[nivelMinimo];
  }, [isSocio, permissoes]);

  return { permissoes, isSocio, temEquipe, loading, podeExecutar, recarregar: carregar };
}