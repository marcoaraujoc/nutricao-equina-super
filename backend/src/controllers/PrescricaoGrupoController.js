// backend/src/controllers/PrescricaoGrupoController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');

// ─── Include padrão ───────────────────────────────────────────────────────────

const GRUPO_INCLUDE = {
  veterinario: { select: { id: true, fullName: true, userType: true } },
  evolucao: { select: { id: true, numero: true, tipoAtendimento: true } },
  itens: {
    where:   { ativo: true },
    include: {
      veterinario:    { select: { id: true, fullName: true } },
      medicamentoCat: { select: { id: true, nome: true, formaFarmaceutica: true, unidade: true, controlado: true } },
    },
    orderBy: { id: 'asc' },
  },
};

// ─── Helper: numero formatado ─────────────────────────────────────────────────

const formatNumero = (n) => String(n).padStart(3, '0');

// ─── Helper: próximo número de prescrição para um animal ─────────────────────

const proximoNumero = async (tx, animalId) => {
  const ultimo = await tx.prescricaoGrupo.findFirst({
    where:   { animalId },
    orderBy: { numero: 'desc' },
    select:  { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
};

// ─── Helpers: cálculo, reserva e baixa de estoque ────────────────────────────

const DOSES_POR_DIA = {
  '1xDia':        1,    '12em12h':  2,    '8em8h':        3,
  '6em6h':        4,    '4em4h':    6,    '1em1h':        24,
  'continuo':     1,    'seNecessario': 1, 'SOS':         1,
  '1x2dias':      1/2,  '1x3dias':  1/3,  '1xSemana':    1/7,
  '1x21dias':     1/21, '1x30dias': 1/30, '1x90dias':    1/90,
};

// ─── Conversão de unidades ────────────────────────────────────────────────────
// Estratégia: converter TUDO para a unidade base (g para massa, mL para volume),
// fazer a conta na base e converter de volta para a unidade do estoque.
// Kg → g (×1000) | mg → g (×0.001) | L → mL (×1000)
// Se as unidades são incompatíveis (ex: g vs mL) ou desconhecidas, usa o valor bruto.

const FATOR_PARA_BASE = {
  // Massa → gramas
  'g': 1, 'mg': 0.001, 'kg': 1000, 'mcg': 0.000001, 'µg': 0.000001,
  // Volume → mL
  'ml': 1, 'l': 1000,
};

const GRUPO_UNIDADE = {
  'g': 'm', 'mg': 'm', 'kg': 'm', 'mcg': 'm', 'µg': 'm',
  'ml': 'v', 'l': 'v',
};

// qty (em `unidade`) → unidade base (g ou mL)
function paraBase(qty, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qty * f : qty;
}

// qty (em unidade base) → unidade original
function deBase(qtyBase, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qtyBase / f : qtyBase;
}

function mesmoGrupo(u1, u2) {
  const g1 = GRUPO_UNIDADE[(u1 ?? '').trim().toLowerCase()];
  const g2 = GRUPO_UNIDADE[(u2 ?? '').trim().toLowerCase()];
  return g1 != null && g1 === g2;
}

// ─── Quantidade total do curso ────────────────────────────────────────────────

function calcularQuantidadeTotal(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  const dias       = Math.max(Number(item.duracaoDias) || 1, 1);
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia * dias;
}

// ─── Quantidade de 1 dia (sem multiplicar por duracaoDias) ───────────────────

function calcularQuantidadeDiaria(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia;
}

// Data de hoje no fuso LOCAL do servidor, como 'YYYY-MM-DD'. Não usar
// `new Date().toISOString()` para "hoje": isso dá a data em UTC, que já virou
// o dia seguinte a partir das 21h no horário de Brasília (UTC-3) — faria o
// sistema achar que um tratamento de N dias já acabou um dia mais cedo.
function hojeLocalStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Janela de execução de um item (dataInicio .. dataInicio+duracaoDias) ────
// hojeStr: 'YYYY-MM-DD'. Retorna { dentro, ultimoDia } — ultimoDia = hoje é o
// último dia coberto pela janela do item (ou já passou dela).
function janelaDoItem(item, hojeStr) {
  const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
  const inicio    = new Date(inicioStr + 'T00:00:00Z');
  const fim       = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1));
  const fimStr    = fim.toISOString().split('T')[0];
  // fimStr é exclusivo (dataInicio + duracaoDias): o último dia válido é fimStr - 1 dia
  const ultimoDiaValido = new Date(fim);
  ultimoDiaValido.setUTCDate(ultimoDiaValido.getUTCDate() - 1);
  const ultimoDiaStr = ultimoDiaValido.toISOString().split('T')[0];
  return {
    dentro:    inicioStr <= hojeStr && hojeStr < fimStr,
    ultimoDia: hojeStr >= ultimoDiaStr,
  };
}

function qtdDiariaEstoque(item, unidadeEstoque) {
  const qtdBruta = calcularQuantidadeDiaria(item);
  if (!mesmoGrupo(item.unidade, unidadeEstoque)) return qtdBruta;
  return deBase(paraBase(qtdBruta, item.unidade), unidadeEstoque);
}

// Converte a quantidade prescrita (item.unidade) para a unidade do estoque via base.
// Ex: 500g → kg: paraBase(500,'g')=500g → deBase(500,'kg')=0.5 kg
function qtdNaUnidadeEstoque(item, unidadeEstoque) {
  const qtdBruta = calcularQuantidadeTotal(item);
  if (!mesmoGrupo(item.unidade, unidadeEstoque)) return qtdBruta; // incompatível, retorna bruto
  return deBase(paraBase(qtdBruta, item.unidade), unidadeEstoque);
}

// ─── Multi-lote (FEFO) ───────────────────────────────────────────────────────
// Um medicamento pode ter VÁRIAS entradas de estoque (lotes). Todas as operações
// de reserva/baixa/verificação consideram o CONJUNTO das entradas: quando uma
// entrada não é suficiente, o restante é reservado/debitado nas demais.
// Ordem FEFO: validade mais próxima primeiro; sem validade por último; empate → id.

async function buscarEstoquesFEFO(client, medicamentoCatId, empresaId, grupoIdExcluir = null) {
  const estoques = await client.estoqueClinica.findMany({
    where:   { medicamentoId: medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
    include: {
      medicamento: { select: { nome: true, unidade: true } },
      reservas: {
        ...(grupoIdExcluir != null ? { where: { prescricaoGrupoId: { not: grupoIdExcluir } } } : {}),
        include: { animal: { select: { nome: true } }, prescricaoGrupo: { select: { numero: true } } },
      },
    },
  });
  return estoques.sort((a, b) => {
    const va = a.validade ? new Date(a.validade).getTime() : Infinity;
    const vb = b.validade ? new Date(b.validade).getTime() : Infinity;
    return va !== vb ? va - vb : a.id - b.id;
  });
}

// Cria reservas de estoque em unidade do estoque (não altera qtdEstoque).
// MULTI-LOTE: distribui a quantidade do curso entre as entradas do medicamento
// (FEFO), respeitando o que já está reservado por OUTRAS prescrições. Se mesmo
// assim faltar, o restante é reservado na última entrada (finalização forçada).
async function criarReservas(tx, grupoId, animalId, itens, empresaId) {
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoques = await buscarEstoquesFEFO(tx, item.medicamentoCatId, empresaId, grupoId);
    if (estoques.length === 0) continue;

    // Recalcula do zero (re-finalização): limpa reservas anteriores deste grupo p/ este medicamento
    await tx.reservaEstoque.deleteMany({
      where: { prescricaoGrupoId: grupoId, estoqueId: { in: estoques.map(e => e.id) } },
    });

    const unidadeEstoque = estoques[0].medicamento?.unidade;
    let restante = qtdNaUnidadeEstoque(item, unidadeEstoque);

    for (let i = 0; i < estoques.length && restante > 0.0001; i++) {
      const e = estoques[i];
      const reservadoOutros = (e.reservas ?? []).reduce((s, r) => s + r.quantidade, 0);
      const disponivel      = Math.max(e.qtdEstoque - reservadoOutros, 0);
      const ultimaEntrada   = i === estoques.length - 1;
      const quantidade      = ultimaEntrada ? restante : Math.min(disponivel, restante);
      if (quantidade <= 0.0001) continue;
      await tx.reservaEstoque.create({
        data: { prescricaoGrupoId: grupoId, estoqueId: e.id, animalId, quantidade },
      });
      restante -= quantidade;
    }
  }
}

// Consome reservas e dá baixa no estoque (ao executar).
// Estratégia: converte tudo para a menor unidade (g ou mL), subtrai, converte de volta.
// Retorna { precos: Map<catId, R$/unidadeEstoque>, unidades: Map<catId, unidadeEstoque> }
async function consumirReservas(tx, grupoId, itens, empresaId) {
  const precos   = new Map();
  const unidades = new Map();
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await tx.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { unidade: true } } },
    });
    if (!estoque) continue;
    const unidadeEstoque = estoque.medicamento?.unidade ?? item.unidade;
    const qtdTotal       = calcularQuantidadeTotal(item);

    let novaQtd;
    if (mesmoGrupo(item.unidade, unidadeEstoque)) {
      // Converte TUDO para a menor unidade base (g ou mL), faz a conta, volta para unidade do estoque
      const estoqueBase  = paraBase(estoque.qtdEstoque, unidadeEstoque);
      const prescritaBase = paraBase(qtdTotal, item.unidade);
      novaQtd = deBase(Math.max(estoqueBase - prescritaBase, 0), unidadeEstoque);
    } else {
      // Unidades incompatíveis — subtrai diretamente
      novaQtd = Math.max(estoque.qtdEstoque - qtdTotal, 0);
    }

    const deduzido = estoque.qtdEstoque - novaQtd;
    const desc     = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} × ${item.duracaoDias}d`
      : item.frequencia;
    await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
    await tx.movimentoEstoque.create({
      data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
    });
    await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } });
    // Preço proporcional ao cliente por unidade base (R$/g ou R$/mL).
    // Usa precoUnitarioBase (campo fixo gravado na entrada do estoque) quando disponível;
    // cai no cálculo dinâmico apenas para itens legados sem o campo.
    const precoVenda = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
    let precoPorUnidade;
    if (estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0) {
      precoPorUnidade = estoque.precoUnitarioBase; // R$/g ou R$/mL
    } else {
      const qtdEstoqueBase = paraBase(estoque.qtdEstoque, unidadeEstoque);
      precoPorUnidade = qtdEstoqueBase > 0 ? precoVenda / qtdEstoqueBase : 0;
    }
    precos.set(item.medicamentoCatId, precoPorUnidade);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
  }
  return { precos, unidades };
}

// Libera reservas sem dar baixa (ao cancelar)
async function liberarReservas(tx, grupoId) {
  await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId } });
}

// Debita 1 dia de tratamento do estoque e cria MovimentoEstoque.
// MULTI-LOTE: a dose do dia é debitada em FEFO através das entradas do
// medicamento — quando uma entrada não basta, o restante sai da próxima.
// Se `grupoId` for informado, as reservas DESTE grupo são abatidas na mesma
// proporção (evita contagem dupla: estoque já baixado + reserva ainda ativa).
// Retorna { precos, unidades } por medicamentoCatId (para lançar na fatura) —
// precos contém o VALOR TOTAL da dose do dia (soma dos lotes debitados).
async function debitarEstoqueDia(tx, itens, empresaId, grupoId = null) {
  const precos   = new Map();
  const unidades = new Map();
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoques = await buscarEstoquesFEFO(tx, item.medicamentoCatId, empresaId);
    if (estoques.length === 0) continue;
    const unidadeEstoque = estoques[0].medicamento?.unidade ?? item.unidade;
    const qtdDia         = calcularQuantidadeDiaria(item);

    // Quantidade do dia na unidade do estoque
    let restante = mesmoGrupo(item.unidade, unidadeEstoque)
      ? deBase(paraBase(qtdDia, item.unidade), unidadeEstoque)
      : qtdDia;

    const desc = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} (1 dia)`
      : `${item.frequencia} (1 dia)`;

    let valorDaDose = 0;
    for (const estoque of estoques) {
      if (restante <= 0.0001) break;
      if (estoque.qtdEstoque <= 0) continue;

      const deduzido = Math.min(estoque.qtdEstoque, restante);
      const novaQtd  = estoque.qtdEstoque - deduzido;
      await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
      await tx.movimentoEstoque.create({
        data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
      });

      // Abate a reserva deste grupo nesta entrada (na mesma proporção do débito)
      if (grupoId != null) {
        const reserva = await tx.reservaEstoque.findUnique({
          where: { prescricaoGrupoId_estoqueId: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } },
        });
        if (reserva) {
          const novaReserva = reserva.quantidade - deduzido;
          if (novaReserva > 0.0001) {
            await tx.reservaEstoque.update({ where: { id: reserva.id }, data: { quantidade: novaReserva } });
          } else {
            await tx.reservaEstoque.delete({ where: { id: reserva.id } });
          }
        }
      }

      // Valor da dose = qtdDebitBase × precoUnitarioBase (R$/g ou R$/mL) da ENTRADA
      // debitada (cada lote pode ter preço próprio). precoUnitarioBase é gravado na
      // entrada do estoque e permanece fixo; itens legados (sem o campo) caem no
      // cálculo dinâmico, que tem o bug de aumentar o preço conforme o estoque diminui.
      const precoVenda   = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
      const qtdDebitBase = paraBase(deduzido, unidadeEstoque);
      if (estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0) {
        valorDaDose += qtdDebitBase * estoque.precoUnitarioBase;
      } else {
        const qtdEstoqueBase = paraBase(estoque.qtdEstoque, unidadeEstoque);
        valorDaDose += qtdEstoqueBase > 0 ? (qtdDebitBase * precoVenda) / qtdEstoqueBase : 0;
      }

      restante -= deduzido;
    }

    precos.set(item.medicamentoCatId, valorDaDose);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
  }
  return { precos, unidades };
}

// ─── Insumos de aplicação injetável (seringa + agulha) ───────────────────────
// Vias que caracterizam uma aplicação injetável — IV/IM/ID/SC/EV.
const VIA_INJETAVEL_REGEX = /intramuscular|intraven|subcut|intraderm|endovenos/i;

function isViaInjetavel(via) {
  if (!via) return false;
  const v = String(via).trim().toLowerCase();
  // Abreviações injetáveis usadas no catálogo (IM, IV, EV, SC, ID) — o valor da via
  // costuma vir abreviado do cadastro do medicamento, não como nome completo.
  if (['im', 'iv', 'ev', 'sc', 'id'].includes(v)) return true;
  // Nomes completos (ex.: Intramuscular, Endovenosa, Subcutânea, Intradérmica).
  return VIA_INJETAVEL_REGEX.test(v);
}

// Localiza no estoque da empresa um item cujo nome do medicamento comece com
// `prefixoNome` (ex: 'Seringa', 'Agulha') e tenha saldo disponível. Sem
// cadastro/sem estoque → null (não bloqueia, apenas não é lançado).
async function buscarInsumoDisponivel(tx, prefixoNome, empresaId) {
  return tx.estoqueClinica.findFirst({
    where: {
      ativo:      true,
      qtdEstoque: { gt: 0 },
      ...(empresaId != null ? { empresaId } : {}),
      medicamento: { nome: { startsWith: prefixoNome, mode: 'insensitive' }, ativo: true },
    },
    include: { medicamento: { select: { id: true, nome: true } } },
    orderBy: { id: 'asc' },
  });
}

// Debita 1 unidade do insumo (seringa/agulha) e retorna { valor, nome } para lançar na
// fatura. Sem estoque disponível → retorna null silenciosamente (não bloqueia a execução).
async function debitarInsumoUnidade(tx, prefixoNome, empresaId, motivo) {
  const estoque = await buscarInsumoDisponivel(tx, prefixoNome, empresaId);
  if (!estoque) return null;

  const novaQtd = Math.max(estoque.qtdEstoque - 1, 0);
  await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
  await tx.movimentoEstoque.create({
    data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: 1, motivo },
  });

  const valor = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
  return { valor, nome: estoque.medicamento.nome };
}

// Verifica estoque para 1 dia de tratamento — retorna lista de alertas.
// MULTI-LOTE: soma a quantidade de TODAS as entradas do medicamento — uma
// entrada insuficiente não bloqueia se outra cobre o restante.
async function verificarEstoqueParaDia(itens, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoques = await buscarEstoquesFEFO(prisma, item.medicamentoCatId, empresaId);
    if (estoques.length === 0) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque = estoques[0].medicamento?.unidade ?? item.unidade;
    const totalEstoque   = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
    const disponBase     = paraBase(totalEstoque, unidadeEstoque);
    const necessarioBase = paraBase(calcularQuantidadeDiaria(item), item.unidade);
    const comparavel     = mesmoGrupo(item.unidade, unidadeEstoque);
    const insuficiente   = comparavel ? disponBase < necessarioBase : totalEstoque < calcularQuantidadeDiaria(item);
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: qtdDiariaEstoque(item, unidadeEstoque),
        qtdDisponivel: totalEstoque,
      });
    }
  }
  return alertas;
}

// Verifica estoque real antes de executar — retorna lista de alertas.
// Compara em unidade base para evitar mismatch kg vs g.
async function verificarEstoqueParaExecucao(itens, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await prisma.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { nome: true, unidade: true } } },
    });
    if (!estoque) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque  = estoque.medicamento?.unidade ?? item.unidade;
    const disponBase      = paraBase(estoque.qtdEstoque ?? 0, unidadeEstoque);
    const necessarioBase  = paraBase(calcularQuantidadeTotal(item), item.unidade);
    const comparavel      = mesmoGrupo(item.unidade, unidadeEstoque);
    const insuficiente    = comparavel ? disponBase < necessarioBase : estoque.qtdEstoque < calcularQuantidadeTotal(item);
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: qtdNaUnidadeEstoque(item, unidadeEstoque),
        qtdDisponivel: estoque.qtdEstoque ?? 0,
      });
    }
  }
  return alertas;
}

// Verifica disponibilidade antes de reservar — retorna lista de alertas.
// Compara em unidade base (g/mL) para suportar kg vs g, L vs mL, etc.
// MULTI-LOTE: agrega TODAS as entradas do medicamento (estoque, reservas de
// outras prescrições e disponível são somados entre os lotes).
// tipo 'INSUFICIENTE': disponível < necessário
// tipo 'ZERADO':       ficará zerado após esta reserva
async function verificarDisponibilidade(itens, grupoId, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoques = await buscarEstoquesFEFO(prisma, item.medicamentoCatId, empresaId, grupoId);
    if (estoques.length === 0) continue;
    const unidadeEstoque = estoques[0].medicamento?.unidade ?? item.unidade;
    const qtdEstoqueTotal = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
    const todasReservas   = estoques.flatMap(e => e.reservas ?? []);
    const qtdReservada    = todasReservas.reduce((s, r) => s + r.quantidade, 0); // em unidadeEstoque
    const disponivel      = qtdEstoqueTotal - qtdReservada;                      // em unidadeEstoque

    // Compara em unidade base
    const dispBase  = paraBase(disponivel, unidadeEstoque);
    const necBase   = paraBase(calcularQuantidadeTotal(item), item.unidade);
    const comparavel = mesmoGrupo(item.unidade, unidadeEstoque);
    const necessario = qtdNaUnidadeEstoque(item, unidadeEstoque); // em unidadeEstoque para exibição

    const reservasInfo = todasReservas.map(r => ({
      animalNome:       r.animal.nome,
      prescricaoNumero: String(r.prescricaoGrupo.numero).padStart(3, '0'),
      quantidade:       r.quantidade,
    }));

    const dispInsuf  = comparavel ? dispBase < necBase        : disponivel < calcularQuantidadeTotal(item);
    const dispZerado = comparavel ? Math.abs(dispBase - necBase) < 0.001 : Math.abs(disponivel - calcularQuantidadeTotal(item)) < 0.001;

    if (dispInsuf) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: Math.max(disponivel, 0),
        qtdEstoque:    qtdEstoqueTotal,
        qtdReservada,
        reservas:      reservasInfo,
      });
    } else if (necessario > 0 && dispZerado) {
      alertas.push({
        tipo:          'ZERADO',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: disponivel,
        qtdEstoque:    qtdEstoqueTotal,
        qtdReservada,
        reservas:      reservasInfo,
      });
    }
  }
  return alertas;
}

// ─── Listar grupos por animal ─────────────────────────────────────────────────

const listarPorAnimal = async (req, res) => {
  try {
    const { animalId } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    const where = { animalId: Number(animalId) };
    if (status) where.status = status;
    // Segregação multi-clínica: cada empresa vê só as próprias prescrições do animal
    where.AND = [escopoPrescricaoGrupoWhere(req)];

    const [grupos, total] = await Promise.all([
      prisma.prescricaoGrupo.findMany({
        where,
        include: GRUPO_INCLUDE,
        orderBy: { numero: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.prescricaoGrupo.count({ where }),
    ]);

    const salvos = await prisma.prescricaoGrupo.count({ where: { animalId: Number(animalId), status: 'SALVO', AND: [escopoPrescricaoGrupoWhere(req)] } });

    return res.json({
      dados:   grupos.map((g) => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      total,
      salvos,
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarPorAnimal:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições.' });
  }
};

// ─── Obter grupo por ID ───────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: Number(req.params.id) },
      include: GRUPO_INCLUDE,
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    return res.json({ dados: { ...grupo, numeroFormatado: formatNumero(grupo.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar prescrição.' });
  }
};

// ─── Criar grupo com itens ────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const { animalId, empresaId, evolucaoId, itens = [] } = req.body;
    const veterinarioId = req.user.id;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });
    if (!evolucaoId) return res.status(400).json({ error: 'evolucaoId é obrigatório.', code: 'EVOLUCAO_REQUIRED' });
    if (!Array.isArray(itens) || itens.length === 0)
      return res.status(400).json({ error: 'Inclua ao menos um item na prescrição.' });

    // Valida que a evolução existe e pertence ao animal
    const evolucao = await prisma.evolucaoClinica.findFirst({
      where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
      select: { id: true },
    });
    if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal.', code: 'EVOLUCAO_NOT_FOUND' });

    const grupo = await prisma.$transaction(async (tx) => {
      const numero = await proximoNumero(tx, Number(animalId));

      const grp = await tx.prescricaoGrupo.create({
        data: {
          numero,
          animalId:     Number(animalId),
          veterinarioId,
          evolucaoId:   Number(evolucaoId),
          empresaId:    empresaId ? Number(empresaId) : (req.empresaId ?? null),
          status:       'SALVO',
        },
      });

      for (const item of itens) {
        await tx.prescricao.create({
          data: {
            animalId:           Number(animalId),
            veterinarioId,
            grupoId:            grp.id,
            medicamentoCatId:   item.medicamentoCatId ? Number(item.medicamentoCatId) : null,
            tipo:               item.tipo             ?? 'MEDICAMENTO',
            medicamento:        String(item.medicamento ?? ''),
            dosagem:            item.dosagem           ?? null,
            unidade:            item.unidade           ?? null,
            via:                item.via               ?? 'Oral',
            frequencia:         item.frequencia        ?? '',
            duracaoDias:        Number(item.duracaoDias ?? 1),
            horaInicio:         item.horaInicio        ?? null,
            observacao:         item.observacao        ?? null,
            dataInicio:         item.dataInicio ? new Date(item.dataInicio) : new Date(),
            status:             'RASCUNHO',
            medicamentoCliente: item.medicamentoCliente === true,
          },
        });
      }

      return tx.prescricaoGrupo.findUnique({ where: { id: grp.id }, include: GRUPO_INCLUDE });
    });

    return res.status(201).json({ dados: { ...grupo, numeroFormatado: formatNumero(grupo.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar prescrição.' });
  }
};

// ─── Adicionar item ao grupo ──────────────────────────────────────────────────

const adicionarItem = async (req, res) => {
  try {
    const grupoId      = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId } });
    if (!grupo)               return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível adicionar itens em prescrições com status SALVO.' });

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente } = req.body;

    if (!medicamento) return res.status(400).json({ error: 'Campo medicamento é obrigatório.' });

    const item = await prisma.prescricao.create({
      data: {
        animalId:          grupo.animalId,
        veterinarioId,
        grupoId,
        medicamentoCatId:  medicamentoCatId ? Number(medicamentoCatId) : null,
        tipo:              tipo              ?? 'MEDICAMENTO',
        medicamento:       String(medicamento),
        dosagem:           dosagem           ?? null,
        unidade:           unidade           ?? null,
        via:               via               ?? 'Oral',
        frequencia:        frequencia        ?? '',
        duracaoDias:       Number(duracaoDias ?? 1),
        horaInicio:        horaInicio        ?? null,
        observacao:        observacao        ?? null,
        dataInicio:        dataInicio ? new Date(dataInicio) : new Date(),
        status:            'RASCUNHO',
        medicamentoCliente: medicamentoCliente === true,
      },
      include: {
        veterinario:    { select: { id: true, fullName: true } },
        medicamentoCat: { select: { id: true, nome: true } },
      },
    });

    // Atualiza veterinarioId do grupo para quem adicionou
    await prisma.prescricaoGrupo.update({ where: { id: grupoId }, data: { veterinarioId } });

    return res.status(201).json({ dados: item });
  } catch (err) {
    console.error('PrescricaoGrupoController.adicionarItem:', err);
    return res.status(500).json({ error: 'Erro ao adicionar item.' });
  }
};

// ─── Atualizar item ───────────────────────────────────────────────────────────

const atualizarItem = async (req, res) => {
  try {
    const itemId       = Number(req.params.itemId);
    const veterinarioId = req.user.id;

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)       return res.status(404).json({ error: 'Item não encontrado.' });
    if (!item.ativo) return res.status(400).json({ error: 'Item já foi removido.' });

    // Regra: prescrição que já teve QUALQUER execução não pode ser alterada.
    const execucoesNoGrupo = await prisma.prescricao.count({
      where: { grupoId: item.grupoId, executadoEm: { not: null } },
    });
    if (execucoesNoGrupo > 0 || item.grupo?.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser alterada.', code: 'EXECUTADO' });
    }

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente } = req.body;

    const data = {};
    if (tipo               !== undefined) data.tipo              = tipo;
    if (medicamento        !== undefined) data.medicamento       = String(medicamento);
    if (medicamentoCatId   !== undefined) data.medicamentoCatId  = medicamentoCatId ? Number(medicamentoCatId) : null;
    if (dosagem            !== undefined) data.dosagem           = dosagem;
    if (unidade            !== undefined) data.unidade           = unidade;
    if (via                !== undefined) data.via               = via;
    if (frequencia         !== undefined) data.frequencia        = frequencia;
    if (duracaoDias        !== undefined) data.duracaoDias       = Number(duracaoDias);
    if (horaInicio         !== undefined) data.horaInicio        = horaInicio;
    if (observacao         !== undefined) data.observacao        = observacao;
    if (dataInicio         !== undefined) data.dataInicio        = new Date(dataInicio);
    if (medicamentoCliente !== undefined) data.medicamentoCliente = medicamentoCliente === true;
    data.veterinarioId = veterinarioId;

    const updated = await prisma.prescricao.update({
      where: { id: itemId },
      data,
      include: {
        veterinario:    { select: { id: true, fullName: true } },
        medicamentoCat: { select: { id: true, nome: true } },
      },
    });

    // Responsável passa a ser quem editou
    await prisma.prescricaoGrupo.update({ where: { id: item.grupoId }, data: { veterinarioId } });

    return res.json({ dados: updated });
  } catch (err) {
    console.error('PrescricaoGrupoController.atualizarItem:', err);
    return res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
};

// ─── Remover item (soft delete) ───────────────────────────────────────────────

const removerItem = async (req, res) => {
  try {
    const itemId     = Number(req.params.itemId);
    const { motivo } = req.body ?? {};

    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)             return res.status(404).json({ error: 'Item não encontrado.' });
    if (!item.ativo)       return res.status(400).json({ error: 'Item já foi removido.' });

    // Regra: prescrição que já teve QUALQUER execução não pode ser excluída.
    const execucoesNoGrupoRem = await prisma.prescricao.count({
      where: { grupoId: item.grupoId, executadoEm: { not: null } },
    });
    if (execucoesNoGrupoRem > 0 || item.grupo?.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser excluída.', code: 'EXECUTADO' });
    }

    const grupoJaFinalizado = item.grupo?.status !== 'SALVO';

    await prisma.$transaction(async (tx) => {
      await tx.prescricao.update({
        where: { id: itemId },
        data:  { ativo: false, ...(grupoJaFinalizado ? { status: 'CANCELADA' } : {}) },
      });

      let statusGrupo;
      if (grupoJaFinalizado) {
        // Item nunca foi executado (bloqueado acima), então nunca teve FaturaItem —
        // chamada apenas por paridade/segurança com os demais controllers.
        await removerFaturaItensDaOrigem(tx, 'prescricaoId', itemId);

        const restantes = await tx.prescricao.count({
          where: { grupoId: item.grupoId, ativo: true, id: { not: itemId } },
        });
        if (restantes === 0) {
          await liberarReservas(tx, item.grupoId);
          statusGrupo = 'CANCELADO';
        } else {
          statusGrupo = 'CANCELADO_PARCIALMENTE';

          // Recalcula as reservas do grupo com os itens restantes (multi-lote) —
          // sem isso, a reserva do item removido ficaria órfã, bloqueando o
          // estoque para outras prescrições.
          const itensRestantes = await tx.prescricao.findMany({
            where: { grupoId: item.grupoId, ativo: true, id: { not: itemId } },
          });
          const empresaIdEfetivo = item.grupo?.empresaId ?? null;
          if (item.medicamentoCatId && !itensRestantes.some(i => i.medicamentoCatId === item.medicamentoCatId)) {
            // Nenhum item restante usa o medicamento do item removido → limpa as reservas dele
            const estoquesDoMed = await tx.estoqueClinica.findMany({
              where:  { medicamentoId: item.medicamentoCatId, ...(empresaIdEfetivo != null ? { empresaId: empresaIdEfetivo } : {}), ativo: true },
              select: { id: true },
            });
            if (estoquesDoMed.length > 0) {
              await tx.reservaEstoque.deleteMany({
                where: { prescricaoGrupoId: item.grupoId, estoqueId: { in: estoquesDoMed.map(e => e.id) } },
              });
            }
          }
          await criarReservas(tx, item.grupoId, item.animalId, itensRestantes, empresaIdEfetivo);
        }
      }

      // Responsável passa a ser quem removeu (+ transição de status quando aplicável)
      await tx.prescricaoGrupo.update({
        where: { id: item.grupoId },
        data:  { veterinarioId: req.user.id, ...(statusGrupo ? { status: statusGrupo } : {}) },
      });

      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PRESCRICAO_ITEM',
        entidadeId: itemId,
        animalId:   item.animalId,
        motivo,
        detalhes:   item.medicamento || null,
      });
    });

    return res.json({ dados: { message: 'Item removido.' } });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
    console.error('PrescricaoGrupoController.removerItem:', err);
    return res.status(500).json({ error: 'Erro ao remover item.' });
  }
};

// ─── Finalizar grupo ──────────────────────────────────────────────────────────
// SALVO → FINALIZADO.

const finalizar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });

    if (!grupo)                   return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível finalizar prescrições com status SALVO.' });

    // Autoria via RBAC (nível efetivo em atendimento.prescricoes.finalizar):
    // PROPRIO → só as próprias; EQUIPE/FULL → qualquer da equipe.
    if (!podeOperarRegistro(req.permissaoNivel, grupo.veterinarioId, veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar prescrições criadas por você.' });
    }
    if (grupo.itens.length === 0) return res.status(400).json({ error: 'A prescrição não possui itens ativos.' });

    const empresaIdEfetivo = grupo.empresaId ?? req.empresaId ?? null;

    // Disponibilidade MULTI-LOTE (soma das entradas − reservas de outras prescrições).
    // Insuficiente → 409 com alertas; o usuário pode reenviar com forcarFinalizacao.
    if (!req.body?.forcarFinalizacao) {
      const alertas = await verificarDisponibilidade(grupo.itens, grupoId, empresaIdEfetivo);
      if (alertas.length > 0) {
        return res.status(409).json({ erro: 'ESTOQUE_INSUFICIENTE', alertas });
      }
    }

    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true },
        data:  { status: 'ATIVA', veterinarioId },
      });

      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  {
          status:          'FINALIZADO',
          veterinarioId,
          finalizadoPorId: veterinarioId,
          finalizadoEm:    agora,
        },
      });

      // Reserva o curso completo no estoque (multi-lote FEFO) — liberado ao
      // cancelar e abatido conforme a execução diária debita o estoque.
      await criarReservas(tx, grupoId, grupo.animalId, grupo.itens, empresaIdEfetivo);
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.finalizar:', err);
    return res.status(500).json({ error: 'Erro ao finalizar prescrição.' });
  }
};

// ─── Cancelar grupo ───────────────────────────────────────────────────────────
// Libera reservas de estoque sem dar baixa.

const cancelar = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;
    const motivo  = req.body?.motivo?.trim() ?? null;

    if (!motivo) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
    }

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });

    // Autoria via RBAC (nível efetivo em atendimento.prescricoes.deletar)
    if (!podeOperarRegistro(req.permissaoNivel, grupo.veterinarioId, userId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }

    // Regra: prescrição que já teve QUALQUER execução (mesmo parcial, em
    // tratamento de vários dias) não pode ser cancelada/excluída.
    if (grupo.status === 'EXECUTADO' || grupo.executadoEm || grupo.itens.some(i => i.executadoEm)) {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser cancelada.', code: 'EXECUTADO' });
    }

    if (!['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Status não permite cancelamento.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'CANCELADA' } });
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'CANCELADO', motivoCancelamento: motivo },
      });

      await registrarAuditoria(tx, req, {
        categoria:  'CANCELAMENTO',
        entidade:   'PRESCRICAO',
        entidadeId: grupoId,
        animalId:   grupo.animalId,
        motivo,
        detalhes:   `status anterior: ${grupo.status} — ${grupo.itens.length} item(ns)`,
      });
    });

    return res.json({ dados: { message: 'Prescrição cancelada. Estoque reservado liberado.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.cancelar:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Cancelar na TELA DE EXECUÇÃO ─────────────────────────────────────────────
// Permite cancelar toda a prescrição mesmo com execução PARCIAL (tratamento de
// vários dias). Itens já executados/faturados são preservados; os ainda NÃO
// executados são cancelados (ativo=false) e as reservas remanescentes liberadas.
// Justificativa obrigatória → AuditLog (CANCELAMENTO).
const cancelarNaExecucao = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;
    const motivo  = req.body?.motivo?.trim() ?? null;
    if (!motivo) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
    }

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });

    if (!podeOperarRegistro(req.permissaoNivel, grupo.veterinarioId, userId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }
    if (grupo.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já totalmente executada não pode ser cancelada.', code: 'EXECUTADO' });
    }
    if (!['FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Status não permite cancelamento na execução.' });
    }

    const houveExecucao = grupo.itens.some(i => i.executadoEm);
    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      // Cancela só os itens ainda NÃO executados (preserva os executados/faturados).
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true, executadoEm: null },
        data:  { status: 'CANCELADA', ativo: false },
      });
      // Cancelamento na execução é SEMPRE definitivo: status CANCELADO, execução
      // bloqueada e prescrição imutável — itens já executados permanecem na fatura.
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'CANCELADO', motivoCancelamento: motivo },
      });
      await registrarAuditoria(tx, req, {
        categoria:  'CANCELAMENTO',
        entidade:   'PRESCRICAO',
        entidadeId: grupoId,
        animalId:   grupo.animalId,
        motivo,
        detalhes:   houveExecucao
          ? 'Cancelada na execução (execução parcial — itens executados preservados)'
          : 'Cancelada na execução',
      });
    });

    return res.json({ dados: { message: 'Prescrição cancelada.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.cancelarNaExecucao:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Reabrir para edição ──────────────────────────────────────────────────────
// Prescrição FINALIZADA e ainda NÃO executada → volta para SALVO e libera as
// reservas de estoque. O usuário edita como rascunho e finaliza novamente.
// (SALVO já é editável; EXECUTADO/parcial/cancelada não podem ser reabertas.)
const reabrirParaEdicao = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });

    if (!podeOperarRegistro(req.permissaoNivel, grupo.veterinarioId, userId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite editar prescrições criadas por você.' });
    }
    if (grupo.status === 'SALVO') {
      const g = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
      return res.json({ dados: { ...g, numeroFormatado: formatNumero(g.numero) } });
    }
    if (grupo.status === 'EXECUTADO' || grupo.itens.some(i => i.executadoEm)) {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser editada.', code: 'EXECUTADO' });
    }
    if (grupo.status !== 'FINALIZADO') {
      return res.status(400).json({ error: 'Somente prescrições finalizadas e não executadas podem ser reabertas.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'RASCUNHO' } });
      await tx.prescricaoGrupo.update({ where: { id: grupoId }, data: { status: 'SALVO', veterinarioId: userId } });
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.reabrirParaEdicao:', err);
    return res.status(500).json({ error: 'Erro ao reabrir prescrição.' });
  }
};

// ─── Executar grupo (por dia / item a item) ──────────────────────────────────
// Debita a dose do dia do estoque e lança CADA item na fatura ao ser executado.
// body.itemIds (opcional) → executa só esses itens; sem itemIds → todos os da janela
// de hoje ainda não executados. Não reexecuta o mesmo item no mesmo dia.
// Transita para EXECUTADO (backend-autoritativo) quando TODOS os itens ativos já
// foram executados e alcançaram o último dia da sua janela.

// Data local (YYYY-MM-DD) da última execução do item — para não reexecutar/refaturar
// o MESMO item no MESMO dia (permite execução item a item sem duplicar na fatura).
function executadoHojeItem(item, hojeStr) {
  if (!item.executadoEm) return false;
  const d = new Date(item.executadoEm);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === hojeStr;
}

// Valor de um item PROCEDIMENTO na fatura, resolvido pelo NOME (o item guarda só o
// nome): combo da empresa > valor da empresa p/ o procedimento (Cadastro >
// Procedimentos) > valorVenda do catálogo > 0.
async function resolverValorProcedimento(tx, empresaId, nome) {
  const n = (nome ?? '').trim();
  if (!n) return 0;
  if (empresaId) {
    const combo = await tx.procedimentoCombo.findFirst({
      where:  { empresaId, ativo: true, nome: { equals: n, mode: 'insensitive' } },
      select: { valor: true },
    });
    if (combo) return combo.valor ?? 0;
  }
  const proc = await tx.procedimentoVeterinario.findFirst({
    where:  { nome: { equals: n, mode: 'insensitive' }, ativo: true },
    select: { id: true, valorVenda: true },
  });
  if (!proc) return 0;
  if (empresaId) {
    const ve = await tx.procedimentoValorEmpresa.findFirst({
      where:  { empresaId, procedimentoId: proc.id },
      select: { valor: true },
    });
    if (ve) return ve.valor ?? 0;
  }
  return proc.valorVenda ?? 0;
}

const executar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;
    // itemIds (opcional): executa/fatura SOMENTE esses itens (execução item a item).
    // Sem itemIds → mantém o comportamento antigo (todos os itens da janela de hoje).
    const itemIdsFiltro = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.map(Number).filter(Number.isInteger)
      : null;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: {
        itens:   { where: { ativo: true }, include: { medicamentoCat: true } },
        evolucao: { select: { id: true, numero: true, tipoAtendimento: true, status: true } },
      },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (!['FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Apenas prescrições FINALIZADAS podem ser executadas.' });
    }
    // Premissa alterada (2026-07-16): a prescrição FINALIZADA pode ser executada mesmo
    // com a evolução ainda EM_ANDAMENTO — não exige mais a evolução FINALIZADA.

    const hojeStr = hojeLocalStr();

    // Só processa/trava hoje os itens cuja própria janela (dataInicio + duracaoDias)
    // cobre o dia de hoje — itens de duração menor já executados em dias anteriores
    // não são re-debitados/re-faturados, e itens que ainda não começaram são ignorados.
    // Itens processáveis hoje: dentro da janela, ainda não executados HOJE, e — se
    // itemIds foi enviado — restritos a esses (execução item a item).
    const itensHoje = grupo.itens.filter(item =>
      janelaDoItem(item, hojeStr).dentro &&
      !executadoHojeItem(item, hojeStr) &&
      (!itemIdsFiltro || itemIdsFiltro.includes(item.id))
    );
    if (itensHoje.length === 0) {
      return res.status(400).json({ error: 'Nenhum item da prescrição para executar agora.' });
    }

    const empresaIdEfetivo = grupo.empresaId ?? req.empresaId ?? null;

    // Verifica estoque para a dose do dia (não para o tratamento completo)
    const alertasEstoque = await verificarEstoqueParaDia(itensHoje, empresaIdEfetivo);
    if (alertasEstoque.length > 0) {
      return res.status(409).json({ erro: 'ESTOQUE_INSUFICIENTE', alertas: alertasEstoque });
    }

    const animal = await prisma.animal.findUnique({ where: { id: grupo.animalId }, select: { userId: true } });
    const proprietarioId = animal?.userId ?? null;

    const atendNum = grupo.evolucao
      ? formatAtendimentoNum(grupo.evolucao.tipoAtendimento, grupo.evolucao.numero)
      : null;
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      // Debita dose do dia (multi-lote FEFO) e retorna preços/unidades por medicamento.
      // Passa o grupoId para abater as reservas deste grupo junto com a baixa.
      const { precos, unidades } = await debitarEstoqueDia(tx, itensHoje, empresaIdEfetivo, grupoId);

      // Lança na fatura ABERTA do proprietário (quantidade do dia)
      const fatura = await getOrCreateFatura(tx, proprietarioId);

      for (const item of itensHoje) {
        // precos já contém o valor proporcional da dose (regra de 3)
        // MEDICAMENTO sem estoque no sistema → valor 0 na fatura (lança para o financeiro saber)
        // PROCEDIMENTO → valor do combo/valor da empresa/catálogo (Cadastro > Procedimentos)
        const valorDaDose = item.tipo === 'PROCEDIMENTO'
          ? await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento)
          : (item.medicamentoCatId ? (precos.get(item.medicamentoCatId) ?? 0) : 0);
        const dose = item.dosagem
          ? `${item.dosagem}${item.unidade ?? ''} × ${item.frequencia}`
          : item.frequencia;
        const descBase = item.tipo === 'MEDICAMENTO'
          ? `${item.medicamento} — ${dose}`
          : item.medicamento;
        const descricao = atendNum ? `[${atendNum}] ${descBase}` : descBase;

        // Medicamento fornecido pelo cliente NÃO é cobrado — não gera item na fatura,
        // mesmo após executado. (A seringa/agulha da aplicação, insumos da clínica,
        // continuam sendo lançados abaixo quando a via for injetável.)
        if (!item.medicamentoCliente) {
          await adicionarFaturaItem(tx, {
            faturaId:     fatura.id,
            animalId:     grupo.animalId,
            tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
            descricao,
            valor:        valorDaDose,  // valor total da dose (regra de 3)
            quantidade:   1,
            veterinarioId,
            prescricaoId: item.id,
          });
        }

        // Via injetável (IV/IM/ID/SC/EV): 1 seringa + 1 agulha por dose aplicada.
        // Se não houver estoque cadastrado/disponível, apenas não lança (não bloqueia a execução).
        if (item.tipo === 'MEDICAMENTO' && isViaInjetavel(item.via)) {
          for (const prefixo of ['Seringa', 'Agulha']) {
            const insumo = await debitarInsumoUnidade(
              tx, prefixo, empresaIdEfetivo,
              `Aplicação injetável (${item.via}): ${item.medicamento}`,
            );
            if (!insumo) continue;
            const descInsumo = atendNum
              ? `[${atendNum}] ${insumo.nome} — aplicação ${item.via} (${item.medicamento})`
              : `${insumo.nome} — aplicação ${item.via} (${item.medicamento})`;
            await adicionarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     grupo.animalId,
              tipo:         'PROCEDIMENTO',
              descricao:    descInsumo,
              valor:        insumo.valor,
              quantidade:   1,
              veterinarioId,
              prescricaoId: item.id,
            });
          }
        }

        // Trava o item (edição/exclusão) e registra a data da última execução —
        // atualizado a cada dia processado, para o Mapa de Atendimento saber se a
        // dose de HOJE já foi dada (não só se o item já foi executado alguma vez).
        await tx.prescricao.update({ where: { id: item.id }, data: { executadoEm: agora } });
      }

      // Transita para EXECUTADO só quando TODOS os itens ativos já foram executados
      // e cada um alcançou o último dia da sua janela (respeita execução item a item
      // e durações diferentes). Backend-autoritativo — relê o estado já atualizado.
      const itensAtuais = await tx.prescricao.findMany({
        where:  { grupoId, ativo: true },
        select: { executadoEm: true, dataInicio: true, duracaoDias: true },
      });
      const tudoConcluido = itensAtuais.length > 0 &&
        itensAtuais.every(item => item.executadoEm && janelaDoItem(item, hojeStr).ultimoDia);
      if (tudoConcluido) {
        await tx.prescricaoGrupo.update({
          where: { id: grupoId },
          data:  {
            status:         'EXECUTADO',
            executadoPorId: veterinarioId,
            executadoEm:    agora,
          },
        });
        // Curso concluído: libera eventuais reservas remanescentes do grupo
        await liberarReservas(tx, grupoId);
      }
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.executar:', err);
    return res.status(500).json({ error: 'Erro ao executar prescrição.' });
  }
};

// ─── Listar para execução ─────────────────────────────────────────────────────
// Retorna grupos FINALIZADO cujo janela de tratamento inclui hoje.
// Filtro de data usa dataInicio + duracaoDias dos itens (não updatedAt).

const listarParaExecucao = async (req, res) => {
  try {
    const { busca, empresaId, animalId, data } = req.query;

    const whereGrupo = {
      // A prescrição vai para a execução assim que o GRUPO é FINALIZADO (prescrição
      // finalizada dentro da evolução) — NÃO depende mais de a evolução estar FINALIZADA.
      // (Premissa alterada 2026-07-16: antes exigia evolucao.status = 'FINALIZADA'.)
      // EXECUTADO incluído para o histórico do dia (executado no último dia da janela).
      // CANCELADO incluído para exibir com status "Cancelada" (execução bloqueada) as
      // prescrições canceladas no meio da execução — filtradas abaixo (só com execução).
      status: { in: ['FINALIZADO', 'CANCELADO_PARCIALMENTE', 'EXECUTADO', 'CANCELADO'] },
    };
    if (empresaId) whereGrupo.empresaId = Number(empresaId);
    if (animalId)  whereGrupo.animalId  = Number(animalId);

    // Escopo base × convidado por ANIMAL (mesma regra da listagem/agendamento): o vet
    // vinculado (convidado) só vê os grupos dos SEUS animais + os liberados por outros
    // vets (designação) na empresa ativa; dono/gestor vê os pacientes que trata.
    const { where: animalScopeWhere } = await buildAnimalScopeWhere(req);
    whereGrupo.animal = { ...animalScopeWhere, ativo: true };

    const grupos = await prisma.prescricaoGrupo.findMany({
      where:   whereGrupo,
      include: {
        veterinario:  { select: { id: true, fullName: true } },
        finalizadoPor:{ select: { id: true, fullName: true } },
        executadoPor: { select: { id: true, fullName: true } },
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true,
            // baia: true, ← reabilitar após npx prisma generate com servidor parado
            especie: { select: { nome: true } },
            raca:    { select: { nome: true } },
          },
        },
        itens: {
          where:   { ativo: true },
          include: { medicamentoCat: { select: { id: true, nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ animalId: 'asc' }, { numero: 'asc' }],
    });

    // Data de referência — usa param ?data=YYYY-MM-DD ou hoje
    const hojeStr = (data && /^\d{4}-\d{2}-\d{2}$/.test(data))
      ? data
      : hojeLocalStr();
    const hoje    = new Date(hojeStr + 'T00:00:00Z'); // meia-noite UTC

    // Mantém apenas grupos onde pelo menos um item cobre hoje.
    // CANCELADO só aparece quando teve execução (cancelada no meio do tratamento) —
    // canceladas antes de qualquer execução não pertencem à tela de execução.
    const dentroJanela = grupos.filter(g =>
      g.itens.some(item => janelaDoItem(item, hojeStr).dentro) &&
      (g.status !== 'CANCELADO' || g.itens.some(i => i.executadoEm))
    );

    // Filtro de busca textual (nome animal, baia, nº prescrição, vet)
    let resultado = dentroJanela;
    if (busca?.trim()) {
      const q = busca.toLowerCase();
      resultado = grupos.filter(g =>
        g.animal.nome.toLowerCase().includes(q) ||
        (g.animal.baia ?? '').toLowerCase().includes(q) ||
        String(g.numero).padStart(3, '0').includes(q) ||
        g.veterinario.fullName.toLowerCase().includes(q)
      );
    }

    // Adiciona diaAtual em cada item para exibição frontend (base UTC)
    const comDia = resultado.map(g => ({
      ...g,
      numeroFormatado: formatNumero(g.numero),
      itens: g.itens.map(item => {
        const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
        const inicio    = new Date(inicioStr + 'T00:00:00Z');
        const diaAtual  = Math.floor((hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return { ...item, diaAtual };
      }),
    }));

    return res.json({ dados: comDia, total: comDia.length });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarParaExecucao:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições para execução.' });
  }
};

module.exports = {
  listarPorAnimal,
  obterPorId,
  criar,
  adicionarItem,
  atualizarItem,
  removerItem,
  finalizar,
  cancelar,
  cancelarNaExecucao,
  reabrirParaEdicao,
  executar,
  listarParaExecucao,
};