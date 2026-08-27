// backend/src/services/resumoAtendimentoService.js
// MEMÓRIA CLÍNICA DO PACIENTE — duas camadas, geradas por IA e PERSISTIDAS
// (tb_resumo_atendimento_ia, 1 registro por animal+empresa do contexto):
//
//   1. highlights — padrões factuais entre atendimentos (ex.: perda progressiva
//      de peso), cada um ancorado nos tópicos que o comprovam;
//   2. topicos    — um por evento, com "ref" apontando para o registro de origem
//      (evolucao-31, vacina-7…), o que permite navegar do resumo até a evolução.
//
// O LLM só é chamado quando há eventos NOVOS desde a última consolidação (append
// incremental) — abrir a tela de novo NÃO varre as evoluções nem gasta IA.
// A IA é proibida de sugerir conduta, diagnosticar ou emitir laudo: ela apenas
// descreve e correlaciona o que está registrado (ver prompt 'memoria_clinica').
//
// Fontes: evoluções, vacinas, exames clínicos, prescrições, encaminhamentos
// (mesma segregação multi-clínica do Histórico) + itens de FATURA lançados
// MANUALMENTE (sem FK de origem clínica — ex.: atendimento emergencial).
//
// NOTA: a tabela é acessada via SQL parametrizado (funciona com o client Prisma
// desatualizado — mesmo padrão de lib/auditoria.js).
'use strict';

const prisma = require('../lib/prisma').default;
const { escopoEvolucaoWhere, escopoFilhoEvolucaoWhere, escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt, PROMPTS } = require('../ai/prompts');

const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');

const PROMPT_KEY   = 'memoria_clinica';
const VERSAO_ATUAL = `${PROMPT_KEY}@${PROMPTS[PROMPT_KEY].version}`;

const TIPOS_HIGHLIGHT = new Set(['TENDENCIA', 'RECORRENCIA', 'PENDENCIA', 'ALTERACAO']);
const DIRECOES        = new Set(['aumento', 'reducao', 'estavel', 'nao_aplicavel']);

// ── Registro persistido ───────────────────────────────────────────────────────

async function buscarRegistro(animalId, empresaId) {
  const rows = empresaId
    ? await prisma.$queryRawUnsafe(
        `SELECT id, resumo, dados, versao_prompt AS "versaoPrompt", ultimo_evento_em AS "ultimoEventoEm",
                total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id = $2 LIMIT 1`,
        animalId, empresaId)
    : await prisma.$queryRawUnsafe(
        `SELECT id, resumo, dados, versao_prompt AS "versaoPrompt", ultimo_evento_em AS "ultimoEventoEm",
                total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id IS NULL LIMIT 1`,
        animalId);
  return rows[0] ?? null;
}

async function salvarRegistro(animalId, empresaId, { resumo, dados, ultimoEventoEm, totalEventos }) {
  const existente = await buscarRegistro(animalId, empresaId);
  const dadosJson = JSON.stringify(dados);
  if (existente) {
    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet.tb_resumo_atendimento_ia
          SET resumo = $1, dados = $2::jsonb, versao_prompt = $3, ultimo_evento_em = $4,
              total_eventos = $5, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $6`,
      resumo, dadosJson, VERSAO_ATUAL, ultimoEventoEm, totalEventos, existente.id);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_resumo_atendimento_ia
         (animal_id, empresa_id, resumo, dados, versao_prompt, ultimo_evento_em, total_eventos)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      animalId, empresaId ?? null, resumo, dadosJson, VERSAO_ATUAL, ultimoEventoEm, totalEventos);
  }
}

// `dados` pode voltar como objeto (jsonb) ou string, conforme o driver.
function lerDados(registro) {
  const bruto = registro?.dados;
  if (!bruto) return { highlights: [], topicos: [] };
  const obj = typeof bruto === 'string' ? safeParse(bruto) : bruto;
  return {
    highlights: Array.isArray(obj?.highlights) ? obj.highlights : [],
    topicos:    Array.isArray(obj?.topicos)    ? obj.topicos    : [],
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ── Coleta de eventos ─────────────────────────────────────────────────────────
// Retorna TODOS os eventos do escopo, ordenados por data. Cada evento:
// { data, origem, ref, texto }. `ref` casa com o id do Histórico
// (evolucao-31, vacina-7…) e é o que torna o tópico clicável no front.

async function coletarEventos(req, animalId) {
  const whereAtivo   = { animalId, ativo: true };
  const escopoEvo    = escopoEvolucaoWhere(req);
  const escopoFilho  = escopoFilhoEvolucaoWhere(req);
  const escopoPresc  = escopoPrescricaoGrupoWhere(req);

  const [evolucoes, vacinas, exames, encaminhamentos, grupos, itensManuais, documentos] = await Promise.all([
    prisma.evolucaoClinica.findMany({
      where:  { ...whereAtivo, status: { in: ['EM_ANDAMENTO', 'FINALIZADA', 'CONCLUIDO'] }, AND: [escopoEvo] },
      select: { id: true, titulo: true, especialidade: true, texto: true, dataInicio: true },
      orderBy: { dataInicio: 'asc' },
    }),
    prisma.vacinaClinica.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { id: true, nome: true, fabricante: true, observacao: true, dataAplicacao: true },
      orderBy: { dataAplicacao: 'asc' },
    }),
    prisma.exameClinico.findMany({
      where:  { ...whereAtivo, status: { in: ['SOLICITADO', 'REALIZADO', 'CONCLUIDO'] }, AND: [escopoFilho] },
      select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true },
      orderBy: { dataSolicitacao: 'asc' },
    }),
    prisma.encaminhamentoClinico.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { id: true, especialidade: true, motivo: true, status: true, dataEncaminhamento: true },
      orderBy: { dataEncaminhamento: 'asc' },
    }),
    // Somente as 5 prescrições mais recentes entram no resumo (evita prompt gigante
    // em pacientes com longo histórico de prescrição)
    prisma.prescricaoGrupo.findMany({
      where:  { animalId, status: { in: ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'] }, AND: [escopoPresc] },
      select: { id: true, numero: true, status: true, createdAt: true, itens: { where: { ativo: true }, select: { medicamento: true, tipo: true }, take: 8 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Itens de fatura lançados MANUALMENTE (sem vínculo com origem clínica)
    prisma.faturaItem.findMany({
      where: {
        animalId,
        exameClinicoId: null, prescricaoId: null, vacinaClinicaId: null, encaminhamentoClinicoId: null,
      },
      select: { id: true, tipo: true, descricao: true, valor: true, quantidade: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    }),
    // Documentos EMITIDOS (Central de Documentos). Entram na memória clínica porque
    // são fato do atendimento: um termo de consentimento para eutanásia assinado em
    // março explica a ausência de evolução depois dele, e um atestado sanitário
    // marca a data em que o animal foi declarado apto ao trânsito.
    // Recorte por EMPRESA (o modelo tem `empresaId` próprio, e a evolução é opcional).
    prisma.documentoEmitido.findMany({
      where: { animalId, ativo: true, ...(req.empresaId ? { empresaId: req.empresaId } : {}) },
      select: { id: true, numero: true, titulo: true, templateNome: true, emitidoEm: true },
      orderBy: { emitidoEm: 'asc' },
    // Tabela ainda não migrada não pode derrubar a memória clínica inteira.
    }).catch(() => []),
  ]);

  const eventos = [
    ...evolucoes.map(e => ({
      data: e.dataInicio, origem: 'ATENDIMENTO', ref: `evolucao-${e.id}`,
      texto: `${e.titulo?.trim() || 'Evolução clínica'}${e.especialidade ? ` (${e.especialidade})` : ''}: ${(e.texto ?? '').slice(0, 500)}`,
    })),
    ...vacinas.map(v => ({
      data: v.dataAplicacao, origem: 'VACINA', ref: `vacina-${v.id}`,
      texto: `Vacina ${v.nome}${v.fabricante ? ` (${v.fabricante})` : ''}${v.observacao ? `. ${v.observacao.slice(0, 120)}` : ''}`,
    })),
    ...exames.map(x => ({
      data: x.dataSolicitacao, origem: 'EXAME', ref: `exame-${x.id}`,
      texto: `Exame ${x.tipo} — ${x.status}${x.descricao ? `: ${x.descricao.slice(0, 150)}` : ''}${x.resultado ? `. Resultado: ${x.resultado.slice(0, 200)}` : ''}`,
    })),
    ...encaminhamentos.map(en => ({
      data: en.dataEncaminhamento, origem: 'ENCAMINHAMENTO', ref: `encaminhamento-${en.id}`,
      texto: `Encaminhamento para ${en.especialidade} (${en.status}): ${(en.motivo ?? '').slice(0, 150)}`,
    })),
    ...grupos.map(g => ({
      data: g.createdAt, origem: 'PRESCRICAO', ref: `prescricao-${g.id}`,
      texto: `Prescrição nº ${String(g.numero).padStart(3, '0')} (${g.status}): ${g.itens.map(i => i.medicamento).join(', ').slice(0, 200)}`,
    })),
    ...itensManuais.map(f => ({
      data: f.criadoEm, origem: 'FATURA_MANUAL', ref: `fatura-item-${f.id}`,
      texto: `Serviço lançado na fatura: ${f.descricao}${f.quantidade > 1 ? ` (x${f.quantidade})` : ''}`,
    })),
    ...documentos.map(d => ({
      data: d.emitidoEm, origem: 'DOCUMENTO', ref: `documento-${d.id}`,
      texto: `Documento emitido: ${d.titulo || d.templateNome}${d.numero != null ? ` (nº ${String(d.numero).padStart(4, '0')})` : ''}`,
    })),
  ].sort((a, b) => new Date(a.data) - new Date(b.data));

  const ultimoEventoEm = eventos.length ? new Date(eventos[eventos.length - 1].data) : null;
  return { eventos, total: eventos.length, ultimoEventoEm };
}

// ── Normalização da resposta do LLM ───────────────────────────────────────────
// Descarta qualquer id/ref que o modelo tenha inventado: um tópico só vale se
// casar com um evento realmente coletado, e um highlight só vale se apontar
// para 2+ tópicos existentes.

function normalizarTopicos(brutos, eventosPorId) {
  const saida = [];
  for (const t of Array.isArray(brutos) ? brutos : []) {
    const evento = eventosPorId.get(String(t?.id ?? ''));
    if (!evento) continue;
    const texto = String(t?.texto ?? '').trim();
    if (!texto) continue;
    saida.push({
      id:     evento.id,
      ref:    evento.ref,          // sempre do evento — nunca o que o LLM devolveu
      data:   evento.data,
      origem: evento.origem,
      texto:  texto.slice(0, 400),
    });
  }
  return saida;
}

function normalizarHighlights(brutos, idsValidos) {
  const saida = [];
  for (const h of Array.isArray(brutos) ? brutos : []) {
    const texto = String(h?.texto ?? '').trim();
    if (!texto) continue;
    const topicos = (Array.isArray(h?.topicos) ? h.topicos : [])
      .map(String)
      .filter(id => idsValidos.has(id));
    if (topicos.length < 2) continue;   // highlight sem 2 evidências não entra
    saida.push({
      texto:    texto.slice(0, 200),
      tipo:     TIPOS_HIGHLIGHT.has(h?.tipo)     ? h.tipo     : 'TENDENCIA',
      direcao:  DIRECOES.has(h?.direcao)         ? h.direcao  : 'nao_aplicavel',
      topicos,
    });
    if (saida.length === 6) break;
  }
  return saida;
}

// Texto corrido derivado dos tópicos — alimenta a coluna "resumo" (compat) e a
// busca/impressão, sem exigir uma segunda chamada ao LLM.
function montarTextoCorrido(topicos) {
  return topicos.map(t => `${t.data} — ${t.texto}`).join('\n');
}

// ── API do serviço ────────────────────────────────────────────────────────────

function montarSaida(registro, dados, totalEventos, desatualizado) {
  return {
    resumo:       registro?.resumo ?? '',
    highlights:   dados.highlights,
    topicos:      dados.topicos,
    atualizadoEm: registro?.updatedAt ?? null,
    totalEventos,
    desatualizado,
  };
}

/**
 * Estado atual da memória clínica + flag de desatualização (sem chamar o LLM).
 */
async function obterResumo(req, animalId) {
  const empresaId = req.empresaId ?? null;
  const [registro, coleta] = await Promise.all([
    buscarRegistro(animalId, empresaId),
    coletarEventos(req, animalId),
  ]);

  const desatualizado = coleta.total > 0 && (
    !registro ||
    registro.totalEventos !== coleta.total ||
    registro.versaoPrompt !== VERSAO_ATUAL ||
    (coleta.ultimoEventoEm && registro.ultimoEventoEm &&
      new Date(coleta.ultimoEventoEm) > new Date(registro.ultimoEventoEm))
  );

  return montarSaida(registro, lerDados(registro), coleta.total, desatualizado);
}

/**
 * Consolida a memória clínica via LLM quando há eventos novos e persiste.
 * Sem eventos novos → devolve o que está salvo, sem chamar a IA.
 */
async function atualizarResumo(req, animalId, animalNome = null) {
  const empresaId = req.empresaId ?? null;
  const registro  = await buscarRegistro(animalId, empresaId);
  const coleta    = await coletarEventos(req, animalId);
  const salvos    = lerDados(registro);

  if (coleta.total === 0) {
    return montarSaida(registro, salvos, 0, false);
  }

  const marcaAnterior = registro?.ultimoEventoEm ? new Date(registro.ultimoEventoEm) : null;
  const novos = marcaAnterior ? coleta.eventos.filter(e => new Date(e.data) > marcaAnterior) : coleta.eventos;
  // Append puro = todos os eventos extras têm data posterior à marca anterior
  const appendConsistente = registro && registro.totalEventos + novos.length === coleta.total;
  const versaoAtual       = registro?.versaoPrompt === VERSAO_ATUAL;

  // Nada novo e prompt na versão corrente → mantém o salvo (não gasta IA)
  if (registro && appendConsistente && versaoAtual && novos.length === 0) {
    return montarSaida(registro, salvos, coleta.total, false);
  }

  // Append incremental quando consistente; senão (primeiro resumo, lançamento
  // retroativo, exclusão de evento ou bump de versão do prompt) reconstrói do
  // zero com a lista completa.
  const fazAppend = Boolean(registro && appendConsistente && versaoAtual && salvos.topicos.length);
  const base      = fazAppend ? salvos.topicos : [];
  const paraIa    = fazAppend ? novos : coleta.eventos;

  // Os ids são atribuídos AQUI (t1..tN), nunca pelo modelo — ele só os ecoa.
  const offset      = base.length;
  const eventosPrompt = paraIa.map((e, i) => ({
    id:     `t${offset + i + 1}`,
    ref:    e.ref,
    data:   dataBR(e.data),
    tipo:   e.origem,
    evento: e.texto,
  }));
  const eventosPorId = new Map(eventosPrompt.map(e => [e.id, {
    id: e.id, ref: e.ref, data: e.data, origem: e.tipo,
  }]));

  const { operacaoVers, prompt } = buildPrompt(PROMPT_KEY, {
    topicosAtuais: base.map(t => ({ id: t.id, data: t.data, texto: t.texto })),
    eventos:       eventosPrompt,
    animalNome,
  });

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.MEMORIA_CLINICA,
    prompt,
    maxTokens:   1800,
    temperature: 0.2,
    userId:      req.user?.id ?? null,
    animalId,
    empresaId,
  });

  const jsonMatch = (respostaTexto ?? '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM não retornou JSON');

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { throw new Error('LLM retornou JSON inválido'); }

  const topicosNovos = normalizarTopicos(parsed.topicos, eventosPorId);
  if (topicosNovos.length === 0) throw new Error('LLM não produziu nenhum tópico válido');

  const topicos    = [...base, ...topicosNovos];
  const idsValidos = new Set(topicos.map(t => t.id));
  const highlights = normalizarHighlights(parsed.highlights, idsValidos);
  const dados      = { highlights, topicos };
  const resumo     = montarTextoCorrido(topicos);

  await salvarRegistro(animalId, empresaId, {
    resumo,
    dados,
    ultimoEventoEm: coleta.ultimoEventoEm,
    totalEventos:   coleta.total,
  });

  return {
    resumo,
    highlights,
    topicos,
    atualizadoEm:  new Date(),
    totalEventos:  coleta.total,
    desatualizado: false,
  };
}

module.exports = { obterResumo, atualizarResumo, VERSAO_ATUAL };
