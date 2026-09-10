// frontend/src/hooks/useEspeciesDaEmpresa.ts
import { useEffect, useState } from 'react';
import api from '../services/api';

export interface EspecieBasica {
  id: number;
  nome: string;
}

/**
 * Espécies que o produto atende hoje. A lista é presa a NOMES, e não a ids, porque
 * o id de `Especie` varia por base (mesma decisão de `useConfiguracaoOperacional`).
 * O catálogo tem mais espécies (Canino/Felino/Réptil) — elas não são oferecidas.
 */
export const ESPECIES_PERMITIDAS = ['EQUINO', 'BOVINO'];

export const normalizarNomeEspecie = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

/**
 * As espécies que a TELA deve oferecer: as permitidas ∩ as que a EMPRESA declarou
 * atender em `/configuracoes`.
 *
 * ⚠️ Sobrando UMA, o campo não deve ser exibido — não há escolha a fazer, e um
 * `<select>` de opção única é um passo que só existe para ser confirmado. Quem usa
 * este hook lê `unica` e aplica a espécie sozinho.
 *
 * ⚠️ Empresa SEM configuração (ou ADMIN da plataforma, sem empresa no contexto)
 * devolve as duas permitidas — nunca lista vazia: sem sinal do que a clínica atende,
 * esconder as duas trancaria o cadastro sem dizer por quê.
 */
export function useEspeciesDaEmpresa() {
  const [especies, setEspecies] = useState<EspecieBasica[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const [catRes, atendRes] = await Promise.all([
          api.get('/especies'),
          // Legível por QUALQUER membro (ao contrário de /equipes/configuracoes,
          // que é do gestor). Falha aqui não pode derrubar a tela.
          api.get('/equipes/especies-atendidas').catch(() => null),
        ]);
        if (!vivo) return;

        const catalogo: EspecieBasica[] = catRes.data?.dados ?? catRes.data ?? [];
        const permitidas = (Array.isArray(catalogo) ? catalogo : []).filter((e) =>
          ESPECIES_PERMITIDAS.includes(normalizarNomeEspecie(e.nome)),
        );

        const atendidas: number[] = atendRes?.data?.dados?.especiesAtendidas ?? [];
        const daEmpresa = permitidas.filter((e) => atendidas.map(Number).includes(Number(e.id)));

        setEspecies(daEmpresa.length > 0 ? daEmpresa : permitidas);
      } catch {
        if (vivo) setEspecies([]);
      } finally {
        if (vivo) setLoading(false);
      }
    })();

    return () => { vivo = false; };
  }, []);

  return {
    especies,
    loading,
    /** A única espécie oferecida — `null` quando há escolha a fazer. */
    unica: especies.length === 1 ? especies[0] : null,
  };
}
