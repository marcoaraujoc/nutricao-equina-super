// frontend/src/utils/contextoAcessos.ts
// Último acesso e favoritos do seletor de contexto (empresa/equipe) — preferências
// PURAMENTE do navegador, sem contrapartida no backend. Não existe "quando o usuário
// esteve nesta empresa pela última vez" no servidor, e criar essa coluna só para
// alimentar um rótulo relativo no seletor seria dado demais para pouco uso.
import type { ContextoOpcao } from '../contexts/EmpresaContext';

const ACESSOS_KEY    = 's2vet_contexto_acessos';
const FAVORITOS_KEY  = 's2vet_contexto_favoritos';

export function chaveContexto(o: Pick<ContextoOpcao, 'empresaId' | 'equipeId'>): string {
  return `${o.empresaId}:${o.equipeId ?? ''}`;
}

function lerMapa(key: string): Record<string, string> {
  try {
    const bruto = localStorage.getItem(key);
    return bruto ? JSON.parse(bruto) : {};
  } catch {
    return {};
  }
}

export function getUltimosAcessos(): Record<string, string> {
  return lerMapa(ACESSOS_KEY);
}

/** Grava "agora" como último acesso da opção — chamado ao trocar de contexto e ao
 *  resolver o contexto ativo no carregamento, para ele sempre aparecer como recente. */
export function registrarAcesso(o: Pick<ContextoOpcao, 'empresaId' | 'equipeId'>) {
  const mapa = lerMapa(ACESSOS_KEY);
  mapa[chaveContexto(o)] = new Date().toISOString();
  try { localStorage.setItem(ACESSOS_KEY, JSON.stringify(mapa)); } catch { /* storage cheio/bloqueado — ignora */ }
}

export function getFavoritos(): Set<string> {
  try {
    const bruto = localStorage.getItem(FAVORITOS_KEY);
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function alternarFavorito(o: Pick<ContextoOpcao, 'empresaId' | 'equipeId'>): Set<string> {
  const favoritos = getFavoritos();
  const k = chaveContexto(o);
  if (favoritos.has(k)) favoritos.delete(k); else favoritos.add(k);
  try { localStorage.setItem(FAVORITOS_KEY, JSON.stringify([...favoritos])); } catch { /* ignora */ }
  return favoritos;
}

/** "Agora há pouco" / "Ontem, 18:40" / "Há 3 dias" / "Há 2 semanas" / "Há 1 mês" — pt-BR,
 *  no mesmo vocabulário do resto do produto (ex.: `useVetPendentes`/toasts). */
export function formatarUltimoAcesso(iso: string | undefined): string {
  if (!iso) return 'Nunca acessada';
  const data = new Date(iso);
  const agora = new Date();
  const diffMs = agora.getTime() - data.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 5) return 'Agora há pouco';
  if (diffMin < 60) return `Há ${diffMin} minuto${diffMin === 1 ? '' : 's'}`;

  const hoje  = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dia   = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const diffDias = Math.round((hoje.getTime() - dia.getTime()) / 86400000);
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (diffDias === 0) return `Hoje, ${hora}`;
  if (diffDias === 1) return `Ontem, ${hora}`;
  if (diffDias < 7)   return `Há ${diffDias} dias`;
  if (diffDias < 30)  { const s = Math.round(diffDias / 7);  return `Há ${s} semana${s === 1 ? '' : 's'}`; }
  const m = Math.round(diffDias / 30);
  return `Há ${m} ${m === 1 ? 'mês' : 'meses'}`;
}
