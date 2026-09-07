// src/hooks/useEventosTempoReal.ts
// =============================================================================
// Canal de eventos em tempo real (SSE) — avisa a tela quando outro profissional
// assume um registro que ela tem aberto.
//
// 🔴 ISTO NÃO GARANTE NADA. Quem impede o overwrite é o BACKEND (trava otimista
// em lib/concorrenciaRegistro.js): mesmo com este canal caído, a gravação sobre
// dado velho é recusada com 409. O papel do evento é só EVITAR TRABALHO PERDIDO —
// a pessoa para de digitar na hora, em vez de escrever mais um parágrafo que já
// não vai ser aceito. Nunca mover decisão de integridade para cá.
//
// STORE ÚNICO no módulo, mesmo padrão de `usePermissoes`/`useVetPendentes`: são
// vários componentes montados ao mesmo tempo e UM `EventSource` por componente
// abriria N conexões por pessoa (o backend tem teto de 5 abas e derrubaria as
// mais antigas — a própria tela ficaria surda).
//
// ⚠️ `EventSource` é NATIVO e reconecta sozinho ao cair (o servidor manda
// `retry: 5000`). Não há código de retry aqui de propósito: um retry manual
// sobreposto ao nativo produz duas conexões concorrentes por pessoa.
//
// ⚠️ O cookie de sessão viaja porque a conexão é MESMA-ORIGEM (`/api/...`, pelo
// proxy do Vite). Sem `withCredentials`, e sem token na URL — o token nunca é
// legível por JavaScript neste projeto (§14).
// =============================================================================

import { useEffect, useRef } from 'react';

export interface EventoTempoReal {
  tipo:          string;
  recurso?:      'EVOLUCAO' | 'AGENDAMENTO';
  evolucaoId?:   number;
  agendamentoId?: number;
  animalId?:     number;
  versao?:       number | null;
  porUsuario?:   { id: number; nome: string | null };
  em?:           string;   // ISO — quando o servidor publicou
}

type Ouvinte = (evento: EventoTempoReal) => void;

// ─── Store de módulo ─────────────────────────────────────────────────────────

let fonte: EventSource | null = null;
const ouvintes = new Set<Ouvinte>();

const TIPOS = ['EVOLUCAO_ASSUMIDA', 'EVOLUCAO_ATUALIZADA', 'AGENDAMENTO_ASSUMIDO'];

function entregar(bruto: string) {
  let evento: EventoTempoReal;
  try { evento = JSON.parse(bruto) as EventoTempoReal; }
  catch { return; }                       // payload malformado: descarta em silêncio
  // Cópia da lista: um ouvinte pode se remover durante a entrega (desmontagem).
  for (const ouvir of [...ouvintes]) {
    try { ouvir(evento); } catch { /* um ouvinte com erro não cala os demais */ }
  }
}

function conectar() {
  if (fonte) return;
  try {
    fonte = new EventSource('/api/eventos/stream', { withCredentials: true });
    for (const tipo of TIPOS) {
      fonte.addEventListener(tipo, (e) => entregar((e as MessageEvent).data));
    }
    // Falha de conexão é SILENCIOSA: o EventSource reconecta sozinho, e um toast
    // de "canal caiu" no meio de um atendimento assusta sem oferecer ação. A
    // proteção real (409 do backend) segue de pé com o canal fora do ar.
    fonte.onerror = () => { /* reconexão nativa */ };
  } catch {
    fonte = null;                          // navegador sem EventSource: degrada
  }
}

function desconectar() {
  if (ouvintes.size > 0) return;           // ainda há telas ouvindo
  fonte?.close();
  fonte = null;
}

/**
 * Assina o canal enquanto o componente estiver montado.
 *
 * ⚠️ `aoEvento` entra num `ref`, não nas dependências do efeito: passar uma arrow
 * inline (o caso normal) daria identidade nova a cada render e a conexão seria
 * fechada e reaberta a cada tecla digitada no formulário.
 */
export function useEventosTempoReal(aoEvento: Ouvinte, ativo = true) {
  const ref = useRef(aoEvento);
  ref.current = aoEvento;

  useEffect(() => {
    if (!ativo) return;
    const ouvir: Ouvinte = (ev) => ref.current(ev);
    ouvintes.add(ouvir);
    conectar();
    return () => {
      ouvintes.delete(ouvir);
      desconectar();
    };
  }, [ativo]);
}

/** Encerra o canal (usado no logout — sessão nova abre um canal novo). */
export function encerrarEventos() {
  ouvintes.clear();
  fonte?.close();
  fonte = null;
}
