// backend/src/services/documentoLLMService.js
//
// CHAT da Central de Documentos — multi-turno, ancorado NO ACERVO da clínica.
//
// 🔴 O assistente não redige documento veterinário do zero: ele escolhe um modelo do
// acervo (os 12 globais da Res. CFMV 1.321/2020 + os da empresa) e o ADAPTA. A
// justificativa normativa está no prompt (`ai/prompts/assistenteDocumento.js`); a
// consequência de código é esta: o acervo é montado AQUI, sob o tenant do request, e
// a resposta do modelo é validada contra ele — `templateId` que não esteja na lista é
// descartado, e bloco de tipo desconhecido é jogado fora.
//
// Substitui a "IA" anterior, que era `montarPorHeuristica` em
// `frontend/src/modules/documentos/ModalCriarIA.tsx`: uma tabela de palavras-chave no
// bundle do navegador, que montava um esqueleto plausível sem nunca chamar modelo
// nenhum. Aquilo entregava um ponto de partida; não entendia pedido de ajuste, e era
// exatamente o que o "chat multi-turno" precisava resolver.
'use strict';

const prisma = require('../lib/prisma').default;
const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt }        = require('../ai/prompts');

/** Espelha `TipoBloco` de frontend/src/modules/documentos/types.ts. */
const TIPOS_BLOCO = new Set([
  'titulo', 'subtitulo', 'texto', 'tabela', 'tabelaDinamica', 'imagem', 'linha',
  'qrcode', 'assinatura', 'checklist', 'campoAuto', 'medicamentos', 'vacinas',
  'procedimentos', 'exames', 'linhaTempo', 'observacoes', 'rodape',
  // Grupo de campos REPETÍVEL (`lib/documentoListas.js`): o "+ Adicionar" da emissão.
  'listaCampos',
]);

const ACOES = new Set(['USAR_TEMPLATE', 'AJUSTAR', 'RESPONDER']);

/** Só estas chaves resolvem de verdade — ver `lib/documentoVariaveis.js`. */
const VARIAVEIS_VALIDAS = [
  'veterinario.nome', 'veterinario.crmv', 'veterinario.clinica', 'veterinario.telefone',
  'cliente.nome', 'cliente.documento', 'cliente.telefone', 'cliente.email',
  'cliente.cep', 'cliente.endereco', 'cliente.complemento', 'cliente.bairro',
  'cliente.cidade', 'cliente.estado', 'cliente.municipio',
  'propriedade.nome', 'propriedade.endereco', 'propriedade.municipio', 'propriedade.inscricao',
  'animal.nome', 'animal.idade', 'animal.raca', 'animal.especie', 'animal.sexo',
  'animal.pelagem', 'animal.peso', 'animal.resenha', 'animal.microchip', 'animal.registro',
  'consulta.data', 'consulta.hora', 'consulta.motivo', 'consulta.anamnese',
  'agenda.proximaVisita', 'agenda.profissional',
  'medicamentos.lista', 'medicamentos.posologia',
  'vacinas.ultima', 'vacinas.proximaDose',
  'exames.solicitados', 'exames.resultado',
  'internacao.baia',
  'sistema.dataEmissao', 'sistema.numeroDocumento',
];

/** Teto de turnos enviados ao modelo — conversa longa vira prompt caro sem ganho. */
const MAX_TURNOS = 12;
/** Teto de modelos listados no acervo do prompt. */
const MAX_ACERVO = 60;

let _seq = 0;
const novoId = () => `b${Date.now().toString(36)}${(_seq++).toString(36)}`;

/**
 * Normaliza o que o modelo devolveu como bloco.
 *
 * ⚠️ Descarta tipo desconhecido em vez de "corrigir" para `texto`: um bloco que o
 * editor não sabe renderizar quebraria a folha, e um bloco convertido em texto
 * mentiria sobre o que o assistente propôs.
 */
function normalizarBlocos(brutos) {
  const saida = [];
  for (const b of Array.isArray(brutos) ? brutos : []) {
    const tipo = String(b?.tipo ?? '').trim();
    if (!TIPOS_BLOCO.has(tipo)) continue;
    const c = b?.conteudo && typeof b.conteudo === 'object' ? b.conteudo : {};
    saida.push({
      // Bloco vindo do modelo aberto preserva o id (o prompt pede isso); bloco novo
      // ganha um id aqui — deixar ao modelo geraria colisão entre turnos.
      id:      typeof b?.id === 'string' && b.id.trim() ? b.id.trim() : novoId(),
      tipo,
      conteudo: {
        ...(typeof c.texto      === 'string' ? { texto: c.texto.slice(0, 8000) } : {}),
        ...(typeof c.rotulo     === 'string' ? { rotulo: c.rotulo.slice(0, 200) } : {}),
        ...(typeof c.variavel   === 'string' ? { variavel: c.variavel.slice(0, 80) } : {}),
        ...(typeof c.url        === 'string' ? { url: c.url.slice(0, 500) } : {}),
        ...(typeof c.fonteDados === 'string' ? { fonteDados: c.fonteDados.slice(0, 80) } : {}),
        ...(typeof c.mostrarCrmv === 'boolean' ? { mostrarCrmv: c.mostrarCrmv } : {}),
        // 🔴 `assinante` decide se a folha carimba a assinatura ESCANEADA do
        // veterinário sobre a linha. Deixá-lo de fora do whitelist fazia a linha do
        // FARMACÊUTICO cair no comportamento antigo e sair assinada pelo vet.
        ...(c.assinante === 'VETERINARIO' || c.assinante === 'OUTRO' ? { assinante: c.assinante } : {}),
        ...(Array.isArray(c.itens)   ? { itens:   c.itens.slice(0, 40).map(x => String(x ?? '').slice(0, 400)) } : {}),
        ...(Array.isArray(c.colunas) ? { colunas: c.colunas.slice(0, 12).map(x => String(x ?? '').slice(0, 120)) } : {}),
        ...(Array.isArray(c.linhas)  ? { linhas:  c.linhas.slice(0, 60).map(l => (Array.isArray(l) ? l.slice(0, 12).map(x => String(x ?? '').slice(0, 400)) : [])) } : {}),
      },
      estilo:  b?.estilo && typeof b.estilo === 'object' ? b.estilo : {},
      visivel: b?.visivel !== false,
    });
    if (saida.length === 80) break;   // folha A4 não comporta mais que isso
  }
  return saida;
}

/**
 * Acervo visível para o contexto: globais + os da empresa. O RLS já faz o recorte;
 * o `select` é curto de propósito — o prompt precisa saber o que EXISTE, não o
 * conteúdo de 60 modelos (que estouraria o contexto e o custo).
 */
async function carregarAcervo() {
  const templates = await prisma.documentoTemplate.findMany({
    where:   { excluido: false },
    select:  { id: true, empresaId: true, nome: true, descricao: true, categoria: true, especie: true, usos: true },
    // Mais usados primeiro: quando o teto corta, corta o que ninguém usa.
    orderBy: [{ usos: 'desc' }, { atualizadoEm: 'desc' }],
    take:    MAX_ACERVO,
  });
  return templates.map(t => ({
    id:        String(t.id),
    nome:      t.nome,
    descricao: (t.descricao ?? '').slice(0, 160),
    categoria: t.categoria,
    especie:   t.especie,
    global:    t.empresaId === null,
  }));
}

/**
 * Um turno do chat.
 *
 * @param {object} req
 * @param {object} entrada
 * @param {Array}  entrada.conversa    — [{ papel: 'usuario'|'assistente', texto }]
 * @param {string} entrada.templateId  — modelo aberto no editor (opcional)
 * @param {Array}  entrada.blocos      — blocos ATUAIS do editor (podem estar editados)
 * @returns {Promise<{resposta, acao, templateId, nome, blocos}>}
 */
async function conversar(req, { conversa = [], templateId = null, blocos = null } = {}) {
  const acervo = await carregarAcervo();

  let aberto = null;
  if (templateId) {
    const t = await prisma.documentoTemplate.findUnique({
      where: { id: Number(templateId) }, select: { id: true, nome: true, blocos: true },
    }).catch(() => null);
    if (t) {
      aberto = {
        id: String(t.id),
        nome: t.nome,
        // Os blocos DO EDITOR vencem os do banco: o vet pode ter alterado sem salvar,
        // e é sobre o que ele está vendo que o pedido de ajuste incide.
        blocos: Array.isArray(blocos) ? blocos : (Array.isArray(t.blocos) ? t.blocos : []),
      };
    }
  } else if (Array.isArray(blocos) && blocos.length > 0) {
    aberto = { id: 'novo', nome: 'Rascunho em edição', blocos };
  }

  const turnos = conversa
    .filter(m => m && typeof m.texto === 'string' && m.texto.trim())
    .slice(-MAX_TURNOS)
    .map(m => ({ papel: m.papel === 'assistente' ? 'assistente' : 'usuario', texto: m.texto.trim() }));

  if (turnos.length === 0) {
    return { resposta: 'Descreva o documento que você precisa.', acao: 'RESPONDER', templateId: null, nome: null, blocos: [] };
  }

  const { operacaoVers, prompt } = buildPrompt('assistente_documento', {
    acervo, aberto, variaveis: VARIAVEIS_VALIDAS, conversa: turnos,
  });

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.DOCUMENTOS,
    prompt,
    maxTokens:   6000,
    temperature: 0.2,
    userId:      req.user?.id ?? null,
    empresaId:   req.empresaId ?? null,
  });

  const bruto = (respostaTexto ?? '').match(/\{[\s\S]*\}/);
  if (!bruto) throw new Error('LLM não retornou JSON');
  let parsed;
  try { parsed = JSON.parse(bruto[0]); }
  catch { throw new Error('LLM retornou JSON inválido'); }

  const acao = ACOES.has(parsed?.acao) ? parsed.acao : 'RESPONDER';

  // ⚠️ O id só vale se estiver NO ACERVO que acabamos de mandar. Sem esta checagem,
  // um id alucinado (ou de outra empresa) viraria um `findUnique` que o RLS recusa —
  // e o vet veria um erro de banco em vez de uma resposta.
  const idsValidos = new Set(acervo.map(t => t.id));
  const escolhido  = typeof parsed?.templateId === 'string' && idsValidos.has(parsed.templateId)
    ? parsed.templateId : null;

  const blocosNovos = acao === 'AJUSTAR' ? normalizarBlocos(parsed?.blocos) : [];

  return {
    resposta: String(parsed?.resposta ?? '').trim().slice(0, 600) || 'Pronto.',
    // "AJUSTAR" sem bloco nenhum aproveitável não é um ajuste — vira resposta de
    // texto, senão a tela limparia o documento do vet achando que recebeu algo.
    acao:     acao === 'AJUSTAR' && blocosNovos.length === 0 ? 'RESPONDER' : acao,
    templateId: acao === 'USAR_TEMPLATE' ? escolhido : null,
    nome:     typeof parsed?.nome === 'string' ? parsed.nome.trim().slice(0, 160) : null,
    blocos:   blocosNovos,
  };
}

module.exports = { conversar, normalizarBlocos, VARIAVEIS_VALIDAS };
