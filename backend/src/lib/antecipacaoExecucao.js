// backend/src/lib/antecipacaoExecucao.js
//
// 🔴 ANTECIPAR PRESCRIÇÃO / VACINA DE DATA FUTURA (2026-10-05).
//
// Regra de negócio: o plantão PODE executar hoje o que foi prescrito para um dia
// FUTURO, desde que NÃO exista, para o MESMO paciente, outra prescrição ANTERIOR da
// MESMA medicação ainda pendente de execução.
//
//   hoje 05/10 · vacina X para 06/10 · nada pendente antes      → antecipa
//   hoje 05/10 · vacina X para 05/10 (ou antes) ainda pendente
//              · vacina X para 06/10                            → NÃO antecipa a de 06/10
//
// POR QUÊ a trava: antecipar a de amanhã com a de hoje ainda na fila aplicaria a
// medicação "por cima" da dose anterior — o paciente receberia duas, ou a anterior
// ficaria esquecida com cara de feita. A ordem é a da prescrição.
//
// FONTE ÚNICA da regra: é ela que o `executar` consulta (quem MANDA) e é ela que as
// listagens do plantão usam para anotar o item (`antecipacaoBloqueadaPor`) — a tela
// não oferece um botão que só falharia depois do clique (armadilha 28-d). Duas
// cópias dariam veredictos diferentes para o mesmo item.
//
// ⚠️ "Data futura" é DIA, não hora: a dose das 14:00 executada às 10:00 do MESMO dia
// continua sendo a antecipação de sempre (pergunta e executa), sem esta checagem.
// ⚠️ A comparação é sempre entre itens do MESMO TIPO de registro: prescrição com
// prescrição, vacina com vacina.
'use strict';

const {
  elegivelParaFluxoNovo, semAncoraDeHorario, dosesTotaisEsperadas,
  horarioPrevistoDoItem, janelaDoCurso,
} = require('./agendaDoses');
const { diaNaEmpresa } = require('./fusoEmpresa');

// Mesmo corte de `PrescricaoGrupoController#FREQUENCIAS_FORA_DA_EXECUCAO`: "se
// necessário"/"SOS" não têm agenda e nem chegam ao plantão — não são "pendentes de
// execução" e não podem travar ninguém.
const FREQUENCIAS_SEM_FILA = new Set(['seNecessario', 'SOS']);

const STATUS_GRUPO_EM_EXECUCAO = ['FINALIZADO', 'CANCELADO_PARCIALMENTE'];

// ─── Identificação da medicação ──────────────────────────────────────────────

function normalizarNome(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mesma medicação? Mesma regra de identificação do resto do sistema: o CATÁLOGO
 * manda quando os dois lados o têm (`medicamentoCatId`, e na vacina também
 * `vacinaId`); sem catálogo dos dois lados, o NOME (sem acento/caixa/espaço extra),
 * que é como o item digitado à mão é reconhecido no catálogo da empresa.
 * ⚠️ Catálogos DIFERENTES nunca são a mesma medicação, ainda que o nome coincida.
 */
function mesmaMedicacao(a, b) {
  if (!a || !b) return false;
  if ((a.tipo ?? null) !== (b.tipo ?? null)) return false;
  if (a.medicamentoCatId != null && b.medicamentoCatId != null) {
    return Number(a.medicamentoCatId) === Number(b.medicamentoCatId);
  }
  if (a.vacinaId != null && b.vacinaId != null) {
    return Number(a.vacinaId) === Number(b.vacinaId);
  }
  const na = normalizarNome(a.nome ?? a.medicamento);
  return !!na && na === normalizarNome(b.nome ?? b.medicamento);
}

// ─── Datas ───────────────────────────────────────────────────────────────────

/** Dia do CALENDÁRIO de uma DATA PURA (gravada como meia-noite UTC). Mesma convenção
 *  de `janelaDoItem` e do front (`split('T')`). Nunca usar para INSTANTE. */
function diaDaDataPura(d) {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function somarDias(diaStr, n) {
  const d = new Date(diaStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'DD/MM'. */
function diaMes(diaStr) {
  const [, m, d] = String(diaStr).split('-');
  return d && m ? `${d}/${m}` : String(diaStr);
}

// ─── Prescrição ──────────────────────────────────────────────────────────────

/**
 * DIA ('YYYY-MM-DD', no fuso da clínica) da próxima dose AINDA PENDENTE do item, ou
 * `null` quando ele não tem nada pendente (curso concluído, cancelado, aplicado pelo
 * proprietário, fora da fila, janela vencida).
 *
 *   ELEGÍVEL com âncora → o dia de `horarioPrevistoDoItem` (rolling schedule real).
 *     Dose VENCIDA e não aplicada devolve o dia em que era devida — continua
 *     pendente até o cron de dose perdida cancelá-la.
 *   ELEGÍVEL sem âncora → a janela do curso: o 1º dia, se ainda não começou; HOJE,
 *     se ela está correndo (é a dose de hoje que falta).
 *   LEGADO ('agora')    → a janela do item, um dia por vez.
 */
function diaDaProximaDose(item, hojeStr, fuso = null) {
  if (!item || item.ativo === false) return null;
  if (item.status === 'CANCELADA' || item.aplicadaPeloProprietario) return null;
  if (FREQUENCIAS_SEM_FILA.has(item.frequencia)) return null;

  if (elegivelParaFluxoNovo(item)) {
    if ((item.dosesExecutadas ?? 0) >= dosesTotaisEsperadas(item)) return null;
    if (semAncoraDeHorario(item)) {
      const { inicioStr, fimStr } = janelaDoCurso(item);
      if (inicioStr > hojeStr) return inicioStr;
      return hojeStr <= fimStr ? hojeStr : null;
    }
    const previsto = horarioPrevistoDoItem(item);
    return previsto ? diaNaEmpresa(previsto, fuso) : null;
  }

  const inicio = diaDaDataPura(item.dataInicio);
  if (!inicio) return null;
  const fim = somarDias(inicio, Math.max(Number(item.duracaoDias) || 1, 1) - 1);
  if (inicio > hojeStr) return inicio;
  if (hojeStr > fim) return null;
  const executadoHoje = !!item.executadoEm && diaNaEmpresa(item.executadoEm, fuso) === hojeStr;
  if (!executadoHoje) return hojeStr;
  const amanha = somarDias(hojeStr, 1);
  return amanha <= fim ? amanha : null;
}

/**
 * A pendência ANTERIOR que impede antecipar `alvo` (cuja próxima dose cai em
 * `diaAlvo`), ou `null`. Varre `candidatos` (os itens do plantão do paciente) e
 * devolve a MAIS ANTIGA — é ela que precisa sair primeiro.
 * "Anterior" é ESTRITAMENTE antes do dia do alvo: duas prescrições da mesma
 * medicação no MESMO dia não se travam.
 */
function prescricaoPendenteAnterior(alvo, diaAlvo, candidatos, hojeStr, fuso = null) {
  if (!alvo || !diaAlvo) return null;
  let achado = null;
  for (const c of candidatos ?? []) {
    if (c.id === alvo.id) continue;
    if (alvo.animalId != null && c.animalId != null && Number(c.animalId) !== Number(alvo.animalId)) continue;
    if (!mesmaMedicacao(alvo, c)) continue;
    const dia = diaDaProximaDose(c, hojeStr, fuso);
    if (!dia || dia >= diaAlvo) continue;
    if (!achado || dia < achado.dia) achado = { item: c, dia };
  }
  if (!achado) return null;
  const numero = achado.item.grupo?.numero ?? null;
  return {
    id:          achado.item.id,
    grupoId:     achado.item.grupo?.id ?? achado.item.grupoId ?? null,
    numero:      numero != null ? String(numero).padStart(3, '0') : null,
    medicamento: achado.item.medicamento,
    dia:         achado.dia,
  };
}

/**
 * Itens de prescrição PENDENTES DE EXECUÇÃO dos pacientes informados — os
 * candidatos de `prescricaoPendenteAnterior`. Mesmo recorte do plantão: grupo
 * FINALIZADO/CANCELADO_PARCIALMENTE da empresa, item ativo e não cancelado.
 * ⚠️ `aplicadaPeloProprietario` vem por SQL cru (o client Prisma pode não conhecer
 * a coluna — CLAUDE.md §11); sem ela, o item aplicado em casa travaria o plantão.
 */
async function carregarPrescricoesPendentes(client, animalIds, empresaId = null) {
  const ids = [...new Set((animalIds ?? []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return [];
  const itens = await client.prescricao.findMany({
    where: {
      animalId: { in: ids },
      ativo:    true,
      status:   { not: 'CANCELADA' },
      grupo:    {
        status: { in: STATUS_GRUPO_EM_EXECUCAO },
        ...(empresaId ? { empresaId: Number(empresaId) } : {}),
      },
    },
    select: {
      id: true, animalId: true, grupoId: true, tipo: true, medicamento: true,
      medicamentoCatId: true, frequencia: true, duracaoDias: true, horaInicio: true,
      dataInicio: true, dosesExecutadas: true, proximaDoseEm: true, executadoEm: true,
      status: true, ativo: true,
      grupo: { select: { id: true, numero: true } },
    },
  });
  if (itens.length === 0) return [];
  let doProprietario = new Set();
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT id FROM schs2vet.tb_prescricoes
        WHERE aplicada_pelo_proprietario = true AND id = ANY($1::int[])`,
      itens.map(i => i.id),
    );
    doProprietario = new Set(rows.map(r => Number(r.id)));
  } catch { /* coluna ainda não migrada: ninguém é do proprietário */ }
  return itens.map(i => ({ ...i, aplicadaPeloProprietario: doProprietario.has(i.id) }));
}

// ─── Vacina ──────────────────────────────────────────────────────────────────

/** Dia em que a vacina está prescrita — `dataAplicacao` é DATA PURA (§6). */
function diaDaVacina(v) {
  return diaDaDataPura(v?.dataAplicacao);
}

/** Vacina pendente de execução no plantão: FINALIZADA, ativa e aplicada pela clínica. */
function vacinaPendente(v) {
  return !!v && v.ativo !== false && v.status === 'FINALIZADA' && v.aplicadaPeloProprietario !== true;
}

/**
 * A vacina ANTERIOR, da mesma medicação e do mesmo paciente, ainda pendente — que
 * impede antecipar `alvo`. Devolve a mais antiga, ou `null`.
 */
function vacinaPendenteAnterior(alvo, lista) {
  const diaAlvo = diaDaVacina(alvo);
  if (!diaAlvo) return null;
  const chaveAlvo = { ...alvo, tipo: 'VACINA' };
  let achado = null;
  for (const v of lista ?? []) {
    if (v.id === alvo.id) continue;
    if (Number(v.animalId) !== Number(alvo.animalId)) continue;
    if (!vacinaPendente(v)) continue;
    if (!mesmaMedicacao(chaveAlvo, { ...v, tipo: 'VACINA' })) continue;
    const dia = diaDaVacina(v);
    if (!dia || dia >= diaAlvo) continue;
    if (!achado || dia < achado.dia) achado = { v, dia };
  }
  if (!achado) return null;
  return {
    id:          achado.v.id,
    numero:      achado.v.numero != null ? String(achado.v.numero).padStart(3, '0') : null,
    medicamento: achado.v.nome,
    dia:         achado.dia,
  };
}

// ─── Mensagem ────────────────────────────────────────────────────────────────

/** Texto da recusa — o MESMO no 400 do `executar` e no `title` da tela. */
function mensagemBloqueio(pendente, registro = 'prescrição') {
  if (!pendente) return null;
  const num = pendente.numero ? ` #${pendente.numero}` : '';
  return `Não é possível antecipar: existe ${registro}${num} de "${pendente.medicamento}" `
    + `prevista para ${diaMes(pendente.dia)} ainda pendente de execução. Execute-a antes.`;
}

module.exports = {
  normalizarNome,
  mesmaMedicacao,
  diaDaDataPura,
  diaMes,
  diaDaProximaDose,
  prescricaoPendenteAnterior,
  carregarPrescricoesPendentes,
  diaDaVacina,
  vacinaPendente,
  vacinaPendenteAnterior,
  mensagemBloqueio,
  STATUS_GRUPO_EM_EXECUCAO,
};
