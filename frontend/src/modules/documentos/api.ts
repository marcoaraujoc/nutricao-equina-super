// src/modules/documentos/api.ts
// Cliente HTTP da Central de Documentos.
//
// Substitui a persistência em `localStorage` que o módulo usava até 2026-08-26
// (`s2vet_docs_templates` e amigas). O `store.ts` já dizia que trocar por
// `api.get`/`api.post` seria "mexer em um lugar só" — este arquivo é esse lugar.
//
// ⚠️ TUDO passa por `services/api` (axios), NUNCA por `fetch` cru: só o interceptor
// do axios injeta `x-empresa-id`/`x-equipe-id`, e sem eles o backend cai no vínculo
// mais recente do usuário — o modelo da clínica errada (§36-g). Isso vale em dobro
// aqui, onde o RLS decide o que a consulta enxerga a partir do tenant carimbado.
//
// ⚠️ GET com 403 resolve `{ data: null }` (interceptor de `services/api`), então toda
// leitura checa `res.data` antes de tocar em `.dados` (armadilha 23).

import api from '../../services/api';
import type { Bloco, DocumentoEmitido, Template } from './types';
import type { CampoDocumento } from './campos';

// ─── Modelos ─────────────────────────────────────────────────────────────────

export async function listarTemplates(incluirExcluidos = true): Promise<Template[]> {
  const res = await api.get('/documentos/templates', { params: incluirExcluidos ? { incluirExcluidos: 1 } : {} });
  if (!res.data) return [];
  return (res.data.dados ?? []) as Template[];
}

export async function criarTemplate(dados: Partial<Template>): Promise<Template> {
  const res = await api.post('/documentos/templates', dados);
  return res.data.dados as Template;
}

/**
 * Salva o modelo.
 *
 * ⚠️ Em modelo GLOBAL (do sistema) o backend NÃO altera o global: cria a cópia da
 * empresa e devolve ELA, com `copiado: true`. Por isso o retorno traz o template —
 * quem chama tem de trocar o id aberto pelo que voltou, senão o próximo salvar
 * criaria outra cópia.
 */
export async function salvarTemplate(
  id: string, dados: Partial<Template> & { novaVersao?: boolean; nota?: string },
): Promise<{ template: Template; copiado: boolean }> {
  const res = await api.put(`/documentos/templates/${id}`, dados);
  return { template: res.data.dados as Template, copiado: res.data.copiado === true };
}

export async function duplicarTemplate(id: string): Promise<Template> {
  const res = await api.post(`/documentos/templates/${id}/duplicar`);
  return res.data.dados as Template;
}

export async function favoritarTemplate(id: string): Promise<{ template: Template; copiado: boolean }> {
  const res = await api.patch(`/documentos/templates/${id}/favorito`);
  return { template: res.data.dados as Template, copiado: res.data.copiado === true };
}

/** Exclusão exige justificativa (§33) — o axios manda o corpo do DELETE em `data`. */
export async function excluirTemplate(id: string, motivo: string): Promise<void> {
  await api.delete(`/documentos/templates/${id}`, { data: { motivo } });
}

export async function restaurarTemplate(id: string): Promise<Template> {
  const res = await api.patch(`/documentos/templates/${id}/restaurar`);
  return res.data.dados as Template;
}

// ─── Contexto do paciente ────────────────────────────────────────────────────

/** Identidade visual e assinatura que o render precisa e que não é texto. */
export interface MarcaDocumento {
  logoUrl:       string | null;
  empresaNome:   string;
  assinaturaUrl: string | null;
  crmv:          string;
  assinanteNome: string;
}

export interface ContextoDocumento {
  variaveis:  Record<string, string>;
  marca:      MarcaDocumento;
  evolucaoId: number | null;
}

/**
 * Variáveis do paciente JÁ RESOLVIDAS pelo backend. É o que faz o preview deixar de
 * mostrar "Thor"/"Haras Boa Vista" (os exemplos do catálogo) e passar a mostrar o
 * paciente de verdade assim que ele é selecionado.
 */
export async function carregarContexto(animalId: number, evolucaoId?: number | null): Promise<ContextoDocumento | null> {
  const res = await api.get(`/documentos/contexto/${animalId}`, {
    params: evolucaoId ? { evolucaoId } : {},
  });
  if (!res.data) return null;   // 403 → sem permissão; a tela segue no modo exemplo
  return res.data.dados as ContextoDocumento;
}

// ─── Documentos emitidos ─────────────────────────────────────────────────────

/**
 * "O que falta preencher para emitir ESTE documento para ESTE paciente."
 * É a chamada que abre a tela de emissão.
 *
 * 🔴 A COLETA é do BACKEND, não daqui: decidir se um campo está vazio exige saber o
 * que as variáveis resolveram, e quem resolve é o servidor. Uma segunda implementação
 * no front divergiria — e divergiria pedindo campo já preenchido, ou deixando de
 * pedir um que vai sair em branco no papel.
 */
export async function carregarCampos(dados: {
  animalId: number; blocos: Bloco[]; evolucaoId?: number | null;
}): Promise<{ campos: CampoDocumento[]; variaveis: Record<string, string>; marca: MarcaDocumento; evolucaoId: number | null }> {
  const res = await api.post('/documentos/campos', dados);
  return res.data.dados;
}

export async function emitirDocumento(dados: {
  animalId:   number;
  templateId?: string | null;
  templateNome?: string;
  blocos:     Bloco[];
  evolucaoId?: number | null;
  /** O que a pessoa digitou na tela de emissão, por chave de rótulo. */
  preenchimento?: Record<string, string>;
}): Promise<DocumentoEmitido> {
  const res = await api.post('/documentos/emitidos', dados);
  return res.data.dados as DocumentoEmitido;
}

export async function listarEmitidos(animalId?: number | null): Promise<DocumentoEmitido[]> {
  const res = await api.get('/documentos/emitidos', { params: animalId ? { animalId } : {} });
  if (!res.data) return [];
  return (res.data.dados ?? []) as DocumentoEmitido[];
}

export async function cancelarEmitido(id: string, motivo: string): Promise<void> {
  await api.delete(`/documentos/emitidos/${id}`, { data: { motivo } });
}

// ─── Chat da IA ──────────────────────────────────────────────────────────────

export interface TurnoChat {
  papel: 'usuario' | 'assistente';
  texto: string;
}

export interface RespostaChat {
  resposta:   string;
  acao:       'USAR_TEMPLATE' | 'AJUSTAR' | 'RESPONDER';
  templateId: string | null;
  nome:       string | null;
  blocos:     Bloco[];
}

/**
 * Um turno do chat. O backend ancora a resposta NO ACERVO de modelos da clínica —
 * ver `services/documentoLLMService.js`. Mandamos os blocos DO EDITOR (que podem
 * estar editados e não salvos) porque é sobre o que o vet está vendo que o pedido
 * de ajuste incide.
 */
export async function conversarIA(dados: {
  conversa:    TurnoChat[];
  templateId?: string | null;
  blocos?:     Bloco[] | null;
}): Promise<RespostaChat> {
  const res = await api.post('/documentos/chat', dados);
  return res.data.dados as RespostaChat;
}
