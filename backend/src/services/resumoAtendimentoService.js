// backend/src/services/resumoAtendimentoService.js
// Resumo consolidado de atendimentos do animal, gerado por IA e PERSISTIDO
// (tb_resumo_atendimento_ia, 1 registro por animal+empresa do contexto).
// O LLM só é chamado quando há eventos NOVOS desde o último resumo (append
// incremental). Fontes: evoluções, vacinas, exames clínicos, prescrições,
// encaminhamentos (mesma segregação multi-clínica do Histórico) + itens de
// FATURA lançados MANUALMENTE (sem FK de origem clínica — ex.: atd. emergencial).
// NOTA: a tabela é acessada via SQL parametrizado (funciona com o client
// Prisma desatualizado — mesmo padrão de lib/auditoria.js).
'use strict';

const prisma = require('../lib/prisma').default;
const { escopoEvolucaoWhere, escopoFilhoEvolucaoWhere, escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { callAI }      = require('../ai');
const { buildPrompt } = require('../ai/prompts');

const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');

// ── Registro persistido ───────────────────────────────────────────────────────

async function buscarRegistro(animalId, empresaId) {
  const rows = empresaId
    ? await prisma.$queryRawUnsafe(
        `SELECT id, resumo, ultimo_evento_em AS "ultimoEventoEm", total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id = $2 LIMIT 1`,
        animalId, empresaId)
    : await prisma.$queryRawUnsafe(
        `SELECT id, resumo, ultimo_evento_em AS "ultimoEventoEm", total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id IS NULL LIMIT 1`,
        animalId);
  return rows[0] ?? null;
}

async function salvarRegistro(animalId, empresaId, resumo, ultimoEventoEm, totalEventos) {
  const existente = await buscarRegistro(animalId, empresaId);
  if (existente) {
    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet.tb_resumo_atendimento_ia
          SET resumo = $1, ultimo_evento_em = $2, total_eventos = $3, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $4`,
      resumo, ultimoEventoEm, totalEventos, existente.id);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_resumo_atendimento_ia (animal_id, empresa_id, resumo, ultimo_evento_em, total_eventos)
       VALUES ($1, $2, $3, $4, $5)`,
      animalId, empresaId ?? null, resumo, ultimoEventoEm, totalEventos);
  }
}

// ── Coleta de eventos ─────────────────────────────────────────────────────────
// Retorna TODOS os eventos do escopo, ordenados por data. Cada evento:
// { data: Date, origem, texto }. `texto` já vem compacto para o prompt.

async function coletarEventos(req, animalId) {
  const whereAtivo   = { animalId, ativo: true };
  const escopoEvo    = escopoEvolucaoWhere(req);
  const escopoFilho  = escopoFilhoEvolucaoWhere(req);
  const escopoPresc  = escopoPrescricaoGrupoWhere(req);

  const [evolucoes, vacinas, exames, encaminhamentos, grupos, itensManuais] = await Promise.all([
    prisma.evolucaoClinica.findMany({
      where:  { ...whereAtivo, status: { in: ['EM_ANDAMENTO', 'FINALIZADA', 'CONCLUIDO'] }, AND: [escopoEvo] },
      select: { titulo: true, especialidade: true, texto: true, dataInicio: true },
      orderBy: { dataInicio: 'asc' },
    }),
    prisma.vacinaClinica.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { nome: true, fabricante: true, observacao: true, dataAplicacao: true },
      orderBy: { dataAplicacao: 'asc' },
    }),
    prisma.exameClinico.findMany({
      where:  { ...whereAtivo, status: { in: ['SOLICITADO', 'CONCLUIDO'] }, AND: [escopoFilho] },
      select: { tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true },
      orderBy: { dataSolicitacao: 'asc' },
    }),
    prisma.encaminhamentoClinico.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { especialidade: true, motivo: true, status: true, dataEncaminhamento: true },
      orderBy: { dataEncaminhamento: 'asc' },
    }),
    // Somente as 5 prescrições mais recentes entram no resumo (evita prompt gigante
    // em pacientes com longo histórico de prescrição)
    prisma.prescricaoGrupo.findMany({
      where:  { animalId, status: { in: ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'] }, AND: [escopoPresc] },
      select: { numero: true, status: true, createdAt: true, itens: { where: { ativo: true }, select: { medicamento: true, tipo: true }, take: 8 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Itens de fatura lançados MANUALMENTE (sem vínculo com origem clínica)
    prisma.faturaItem.findMany({
      where: {
        animalId,
        exameClinicoId: null, prescricaoId: null, vacinaClinicaId: null, encaminhamentoClinicoId: null,
      },
      select: { tipo: true, descricao: true, valor: true, quantidade: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    }),
  ]);

  const eventos = [
    ...evolucoes.map(e => ({
      data: e.dataInicio, origem: 'ATENDIMENTO',
      texto: `${e.titulo?.trim() || 'Evolução clínica'}${e.especialidade ? ` (${e.especialidade})` : ''}: ${(e.texto ?? '').slice(0, 300)}`,
    })),
    ...vacinas.map(v => ({
      data: v.dataAplicacao, origem: 'VACINA',
      texto: `Vacina ${v.nome}${v.fabricante ? ` (${v.fabricante})` : ''}${v.observacao ? `. ${v.observacao.slice(0, 120)}` : ''}`,
    })),
    ...exames.map(x => ({
      data: x.dataSolicitacao, origem: 'EXAME',
      texto: `Exame ${x.tipo} — ${x.status}${x.descricao ? `: ${x.descricao.slice(0, 150)}` : ''}${x.resultado ? `. Resultado: ${x.resultado.slice(0, 150)}` : ''}`,
    })),
    ...encaminhamentos.map(en => ({
      data: en.dataEncaminhamento, origem: 'ENCAMINHAMENTO',
      texto: `Encaminhamento para ${en.especialidade} (${en.status}): ${(en.motivo ?? '').slice(0, 150)}`,
    })),
    ...grupos.map(g => ({
      data: g.createdAt, origem: 'PRESCRICAO',
      texto: `Prescrição nº ${String(g.numero).padStart(3, '0')} (${g.status}): ${g.itens.map(i => i.medicamento).join(', ').slice(0, 200)}`,
    })),
    ...itensManuais.map(f => ({
      data: f.criadoEm, origem: 'FATURA_MANUAL',
      texto: `Serviço lançado na fatura: ${f.descricao}${f.quantidade > 1 ? ` (x${f.quantidade})` : ''}`,
    })),
  ].sort((a, b) => new Date(a.data) - new Date(b.data));

  const ultimoEventoEm = eventos.length ? new Date(eventos[eventos.length - 1].data) : null;
  return { eventos, total: eventos.length, ultimoEventoEm };
}

// ── API do serviço ────────────────────────────────────────────────────────────

/**
 * Estado atual do resumo + flag de desatualização (sem chamar o LLM).
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
    (coleta.ultimoEventoEm && registro.ultimoEventoEm &&
      new Date(coleta.ultimoEventoEm) > new Date(registro.ultimoEventoEm))
  );

  return {
    resumo:        registro?.resumo ?? '',
    atualizadoEm:  registro?.updatedAt ?? null,
    totalEventos:  coleta.total,
    desatualizado,
  };
}

/**
 * Gera/apenda o resumo via LLM quando há eventos novos e persiste.
 * Sem eventos novos → retorna o salvo sem chamar a IA.
 */
async function atualizarResumo(req, animalId, animalNome = null) {
  const empresaId = req.empresaId ?? null;
  const registro  = await buscarRegistro(animalId, empresaId);
  const coleta    = await coletarEventos(req, animalId);

  if (coleta.total === 0) {
    return { resumo: registro?.resumo ?? '', atualizadoEm: registro?.updatedAt ?? null, desatualizado: false, totalEventos: 0 };
  }

  const marcaAnterior = registro?.ultimoEventoEm ? new Date(registro.ultimoEventoEm) : null;
  const novos = marcaAnterior ? coleta.eventos.filter(e => new Date(e.data) > marcaAnterior) : coleta.eventos;
  // Append puro = todos os eventos extras têm data posterior à marca anterior
  const appendConsistente = registro && registro.totalEventos + novos.length === coleta.total;

  // Nada novo → mantém o salvo (não gasta IA)
  if (registro && appendConsistente && novos.length === 0) {
    return { resumo: registro.resumo, atualizadoEm: registro.updatedAt, desatualizado: false, totalEventos: coleta.total };
  }

  // Append incremental quando consistente; senão (primeiro resumo, lançamento
  // retroativo ou exclusão de evento) reconstrói do zero com a lista completa.
  const fazAppend      = Boolean(registro && appendConsistente && registro.resumo);
  const base           = fazAppend ? registro.resumo : '';
  const eventosPrompt  = (fazAppend ? novos : coleta.eventos)
    .map(e => ({ data: dataBR(e.data), tipo: e.origem, evento: e.texto }));

  const { operacaoVers, prompt } = buildPrompt('resumo_atendimentos', {
    resumoAtual: base,
    eventos:     eventosPrompt,
    animalNome,
  });

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    prompt,
    maxTokens:   900,
    temperature: 0.2,
    userId:      req.user?.id ?? null,
    animalId,
  });

  const resumoNovo = (respostaTexto ?? '').trim();
  if (!resumoNovo) throw new Error('LLM retornou resumo vazio');

  await salvarRegistro(animalId, empresaId, resumoNovo, coleta.ultimoEventoEm, coleta.total);
  return { resumo: resumoNovo, atualizadoEm: new Date(), desatualizado: false, totalEventos: coleta.total };
}

module.exports = { obterResumo, atualizarResumo };
