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
import { comEstiloPadrao } from './catalogo';
import type { Bloco, DocumentoEmitido, Template } from './types';
import type { CampoDocumento } from './campos';
import type { ListaDocumento, PreenchimentoListas } from './listas';

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

/**
 * Sobe UMA imagem do documento enviado pela clínica e devolve a URL
 * (`/api/midia/<chave>`), que vira o `url` de um bloco `imagem`.
 *
 * ⚠️ Só imagem: PDF é convertido em imagem, página por página, ANTES de chegar aqui
 * (ver ./upload.ts). O `Content-Type` fica a cargo do axios, que reconhece o
 * `FormData` e monta o cabeçalho com o `boundary` — sem ele o multer recusa o corpo.
 */
export async function enviarArquivoTemplate(arquivo: Blob, nome: string): Promise<string> {
  const form = new FormData();
  form.append('arquivo', arquivo, nome);
  const res = await api.post('/documentos/templates/upload', form);
  return res.data.dados.url as string;
}

/**
 * Páginas enviadas à IA na conversão. Espelha `MAX_PAGINAS` de
 * `services/documentoConversaoService.js`: modelo de documento com mais que isso é
 * raro, e cada página é uma imagem inteira dentro do prompt.
 */
const MAX_PAGINAS_IA = 4;

/** O que a IA propôs a partir do documento enviado. */
export interface ConversaoDocumento {
  /**
   * `false` = não deu para transformar aquilo num modelo (não é documento, a IA
   * falhou, a resposta veio vazia). NÃO é erro: quem chama cai no envio como IMAGEM,
   * que é o caminho de sempre e nunca falha.
   */
  ehDocumento: boolean;
  titulo:      string | null;
  categoria:   string | null;
  blocos:      Bloco[];
  /**
   * POR QUE a conversão não saiu — e por que ele NUNCA é opcional na prática: sem o
   * motivo, "sem empresa no contexto", "sem permissão", "o servidor recusou o
   * arquivo", "a IA está fora do ar" e "isto não é um documento" viram a MESMA frase
   * na tela, e não há como saber qual foi. Cair no caminho da imagem é aceitável;
   * cair sem saber por quê, não.
   */
  motivo:      string | null;
}

/**
 * Páginas do documento enviado → blocos do modelo, com as variáveis e as lacunas já
 * identificadas pela IA (`services/documentoConversaoService.js`).
 *
 * ⚠️ NÃO cria modelo nenhum: devolve a proposta, e quem grava é `criarTemplate`. É o
 * que permite a tela mostrar o resultado antes de comprometer o acervo — e o que faz
 * uma falha da IA não deixar modelo pela metade.
 *
 * O `texto` é o que o PDF trazia embutido; vai junto das imagens porque um dá a
 * redação exata e o outro dá a estrutura (ver ./upload.ts).
 */
export async function converterArquivoTemplate(dados: {
  paginas: Blob[];
  texto?:  string;
  nome?:   string;
}): Promise<ConversaoDocumento> {
  const form = new FormData();
  // ⚠️ Espelha `MAX_PAGINAS` do `documentoConversaoService` — a rota recusa mais que
  // isso, e o serviço descartaria o excedente de qualquer forma. Cortar aqui evita
  // subir megabytes de imagem que ninguém vai ler.
  dados.paginas.slice(0, MAX_PAGINAS_IA)
    .forEach((p, i) => form.append('paginas', p, `pagina-${i + 1}.jpg`));
  if (dados.texto) form.append('texto', dados.texto);
  if (dados.nome)  form.append('nome',  dados.nome);
  let res;
  try {
    // Timeout EXPLÍCITO e generoso: a chamada carrega imagens e espera o modelo ler a
    // folha inteira — dezenas de segundos é normal. Sem ele, um travamento de rede
    // ficaria pendurado para sempre e a tela nunca sairia de "Identificando os
    // campos…"; com ele, vira uma mensagem.
    res = await api.post('/documentos/templates/converter', form, { timeout: 180_000 });
  } catch (err) {
    // ⚠️ NADA de `catch` mudo aqui. 403 (sem a permissão de criar modelo), 404 (rota
    // não publicada no servidor em execução), 413, 429 de quota e timeout chegam todos
    // por este caminho, e cada um pede uma ação diferente de quem está usando.
    return { ehDocumento: false, titulo: null, categoria: null, blocos: [], motivo: motivoDoErro(err) };
  }
  const d = res.data?.dados;
  if (!d) {
    // GET 403 resolve com `data` null (armadilha 23); num POST isso é resposta vazia.
    return { ehDocumento: false, titulo: null, categoria: null, blocos: [], motivo: 'O servidor não respondeu à conversão.' };
  }
  return {
    ehDocumento: d.ehDocumento === true,
    titulo:      d.titulo ?? null,
    categoria:   d.categoria ?? null,
    // O estilo padrão de cada tipo é aplicado AQUI, na borda: a IA descreve conteúdo,
    // não aparência — ver `comEstiloPadrao` em ./catalogo.
    blocos:      comEstiloPadrao((d.blocos ?? []) as Bloco[]),
    motivo:      d.motivo ?? null,
  };
}

/** Traduz a falha HTTP da conversão em uma frase que diz o que fazer a respeito. */
function motivoDoErro(err: unknown): string {
  const e = err as { code?: string; response?: { status?: number; data?: { error?: string } } };
  if (e?.code === 'ECONNABORTED') return 'A leitura do documento demorou demais e foi interrompida.';
  const status = e?.response?.status;
  const doServidor = e?.response?.data?.error;
  if (status === 403) return 'Sem permissão para criar modelos de documento nesta empresa.';
  if (status === 404) return 'O servidor em execução não tem a rota de conversão (reinicie o backend).';
  if (status === 413) return 'As páginas do documento passaram do tamanho aceito.';
  if (status === 429) return doServidor || 'O limite de uso de IA da empresa foi atingido.';
  if (doServidor) return doServidor;
  return status ? `O servidor recusou a conversão (HTTP ${status}).` : 'Não foi possível falar com o servidor.';
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
  /**
   * Prescrição de origem, quando a emissão foi aberta A PARTIR de uma (o receituário
   * de controle especial da tela de Prescrição). É ela que preenche as listas
   * clínicas; sem isto, o receituário de uma prescrição antiga nasceria com os
   * medicamentos da mais recente.
   */
  prescricaoGrupoId?: number | null;
}): Promise<{
  campos: CampoDocumento[];
  /** Grupos REPETÍVEIS, já com `sugestao` preenchida a partir do paciente. */
  listas: ListaDocumento[];
  variaveis: Record<string, string>;
  marca: MarcaDocumento;
  evolucaoId: number | null;
}> {
  const res = await api.post('/documentos/campos', dados);
  const d = res.data.dados;
  // `listas` não existia antes de 2026-09-01: documento emitido por uma aba aberta
  // desde antes do deploy não pode quebrar a tela por causa de um campo ausente.
  return { ...d, listas: Array.isArray(d?.listas) ? d.listas : [] };
}

export async function emitirDocumento(dados: {
  animalId:   number;
  templateId?: string | null;
  templateNome?: string;
  blocos:     Bloco[];
  evolucaoId?: number | null;
  /** O que a pessoa digitou na tela de emissão, por chave de rótulo. */
  preenchimento?: Record<string, string>;
  /** As linhas dos grupos repetíveis (medicamento, vacina…), por chave de grupo. */
  listas?: PreenchimentoListas;
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
