// backend/src/controllers/PrescricaoGrupoController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem, recalcularTotal } = require('../lib/faturaUtils');
const { garantirMedicamentoDaEmpresa, garantirProcedimentoDaEmpresa } = require('../lib/catalogoManual');
const { registrarAuditoria, registrarAlteracao, registrarTransferencia, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
const { animalEstaInativo } = require('../lib/animalInativo');

const MSG_PACIENTE_INATIVO = 'Paciente inativo — reative com o gestor antes de registrar algo novo.';

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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
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

    // Segregação multi-clínica: cada empresa vê só as próprias prescrições do animal
    const whereBase = { animalId: Number(animalId), AND: [escopoPrescricaoGrupoWhere(req)] };
    const where = status ? { ...whereBase, status } : whereBase;

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

    // Contagem por status (sempre sobre TODOS os registros do animal, ignorando o
    // filtro atual) — alimenta as abas de filtro por status do histórico no front.
    const contagensRaw = await prisma.prescricaoGrupo.groupBy({
      by:     ['status'],
      where:  whereBase,
      _count: { _all: true },
    });
    const contagens = Object.fromEntries(contagensRaw.map((c) => [c.status, c._count._all]));
    const salvos = contagens.SALVO ?? 0;

    return res.json({
      dados:   await anexarFlagEmGrupos(
        prisma,
        grupos.map((g) => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      ),
      total,
      salvos,
      contagens,
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
    return res.json({
      dados: await anexarFlagEmGrupos(prisma, { ...grupo, numeroFormatado: formatNumero(grupo.numero) }),
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar prescrição.' });
  }
};

// ─── Criar grupo(s) com itens ─────────────────────────────────────────────────
// Medicamento comum e PROCEDIMENTO saem JUNTOS, numa única prescrição — o
// atendimento é um só e separá-los obrigava o profissional a lidar com dois
// documentos para a mesma conduta (alterado em 2026-07-30, a pedido).
//
// O CONTROLADO continua em prescrição PRÓPRIA, e isso NÃO é preferência de UI: o
// receituário de controle especial é um documento legalmente distinto (Portaria
// SVS/MS 344/98), com numeração e retenção próprias. Misturá-lo com item comum
// produziria um receituário inválido para dispensação.
//   CONTROLADO → medicamento com Medicamento.controlado = true
//   GERAL      → medicamento comum (controlado = false / sem catálogo) + PROCEDIMENTO
// Com itens de uma só categoria, cria uma única prescrição.
// Retorna SEMPRE um array em `dados` (1 ou mais grupos), ordenado por número.

const ORDEM_CATEGORIAS = ['CONTROLADO', 'GERAL'];

/**
 * A coluna `aplicada_pelo_proprietario` já existe no banco?
 *
 * ⚠️ ESTE GUARD NÃO É OPCIONAL. SQL cru para uma coluna inexistente DENTRO de uma
 * transaction aborta a TRANSACTION INTEIRA no Postgres — os comandos seguintes
 * morrem com 25P02 ("current transaction is aborted"), e o `try/catch` em JS não
 * desfaz isso: quem estoura é o comando SEGUINTE, longe do culpado. Foi assim que
 * o Salvar da prescrição quebrou em `catalogoManual.js`, que não tem nada a ver.
 *
 * Consultado uma vez por processo. O `false` expira em 60s para que rodar a
 * migration com o backend no ar volte a funcionar sem restart.
 */
let _temColunaProp = null;
let _temColunaPropEm = 0;
async function temColunaProprietario() {
  if (_temColunaProp === true) return true;
  if (_temColunaProp === false && Date.now() - _temColunaPropEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_prescricoes'
          AND column_name = 'aplicada_pelo_proprietario' LIMIT 1`,
    );
    _temColunaProp = rows.length > 0;
  } catch { _temColunaProp = false; }
  _temColunaPropEm = Date.now();
  return _temColunaProp;
}

/**
 * Anexa `aplicadaPeloProprietario` a ITENS já carregados (aceita item, lista de
 * itens, ou lista de GRUPOS — neste caso percorre `grupo.itens`).
 *
 * Lido por SQL cru porque o client Prisma pode não conhecer a coluna ainda (no
 * Windows o `prisma generate` falha com o backend rodando) — mesmo padrão do
 * `isConvidado`/`cadastroConfirmadoEm`. Sem a coluna, devolve false.
 *
 * Toda leitura que decida EXECUÇÃO, FATURA ou ESTOQUE precisa passar por aqui:
 * sem a flag, o item aplicado em casa volta a ser cobrado e a debitar estoque.
 *
 * `client` é sempre o cliente FORA da transaction (ver `temColunaProprietario`):
 * a flag não é alterada pelas transactions que a leem, então ler por fora é seguro
 * e não arrisca abortá-las.
 */
async function anexarAplicadaProprietario(client, itens) {
  const lista = Array.isArray(itens) ? itens : [itens];
  const ids = lista.map(i => i?.id).filter(Number.isInteger);
  if (ids.length === 0) return itens;
  let marcados = new Set();
  if (!(await temColunaProprietario())) {
    const semFlag = (i) => ({ ...i, aplicadaPeloProprietario: false });
    return Array.isArray(itens) ? itens.map(semFlag) : semFlag(itens);
  }
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id FROM schs2vet.tb_prescricoes
        WHERE aplicada_pelo_proprietario = true AND id IN (${ph})`,
      ...ids,
    );
    marcados = new Set(rows.map(r => r.id));
  } catch { /* coluna ainda não migrada */ }
  const aplicar = (i) => ({ ...i, aplicadaPeloProprietario: marcados.has(i.id) });
  return Array.isArray(itens) ? itens.map(aplicar) : aplicar(itens);
}

/** Mesma coisa, para grupos já carregados com `itens`. */
async function anexarFlagEmGrupos(client, grupos) {
  const lista = Array.isArray(grupos) ? grupos : [grupos];
  const todos = lista.flatMap(g => g?.itens ?? []);
  const comFlag = await anexarAplicadaProprietario(client, todos);
  const porId = new Map(comFlag.map(i => [i.id, i]));
  const aplicar = (g) => ({ ...g, itens: (g.itens ?? []).map(i => porId.get(i.id) ?? i) });
  return Array.isArray(grupos) ? lista.map(aplicar) : aplicar(grupos);
}

/**
 * Grava a coluna do item por SQL cru (o client pode não conhecê-la). `undefined`
 * não toca no valor — mantém a semântica de PATCH parcial do `atualizarItem`.
 */
async function gravarAplicadaProprietario(client, itemId, valor) {
  if (valor === undefined) return;
  if (!(await temColunaProprietario())) return;
  try {
    await client.$executeRawUnsafe(
      'UPDATE schs2vet.tb_prescricoes SET aplicada_pelo_proprietario = $1 WHERE id = $2',
      valor === true,
      itemId,
    );
  } catch { /* coluna ainda não migrada */ }
}

// Categoria de um item cru (do body). `controladoDe` resolve o flag do catálogo.
// FONTE ÚNICA da regra de agrupamento — criação e edição usam esta função.
function categoriaPara({ tipo, medicamentoCatId }, controladoDe) {
  if ((tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO') return 'GERAL';
  return controladoDe(medicamentoCatId) ? 'CONTROLADO' : 'GERAL';
}

const criar = async (req, res) => {
  try {
    const { animalId, empresaId, evolucaoId, itens = [] } = req.body;
    const veterinarioId = req.user.id;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });
    if (await animalEstaInativo(animalId)) {
      return res.status(400).json({ error: MSG_PACIENTE_INATIVO, code: 'PACIENTE_INATIVO' });
    }
    if (!evolucaoId) return res.status(400).json({ error: 'evolucaoId é obrigatório.', code: 'EVOLUCAO_REQUIRED' });
    if (!Array.isArray(itens) || itens.length === 0)
      return res.status(400).json({ error: 'Inclua ao menos um item na prescrição.' });

    // Medicamento sem dosagem não pode ser prescrito (o item importado do orçamento
    // chega sem dosagem — a regra vale para qualquer origem).
    const semDosagem = itens.find(
      i => (i.tipo ?? 'MEDICAMENTO') === 'MEDICAMENTO' && !String(i.dosagem ?? '').trim(),
    );
    if (semDosagem) {
      return res.status(400).json({
        error: `Informe a dosagem de "${semDosagem.medicamento ?? 'medicamento'}".`,
        code:  'DOSAGEM_OBRIGATORIA',
      });
    }

    // Valida que a evolução existe e pertence ao animal
    const evolucao = await prisma.evolucaoClinica.findFirst({
      where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
      select: { id: true },
    });
    if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal.', code: 'EVOLUCAO_NOT_FOUND' });

    // Resolve o flag `controlado` de cada medicamento do catálogo (1 query)
    const catIds = [...new Set(
      itens
        .filter(i => (i.tipo ?? 'MEDICAMENTO') === 'MEDICAMENTO' && i.medicamentoCatId)
        .map(i => Number(i.medicamentoCatId)),
    )];
    const controladoPorId = new Map();
    if (catIds.length > 0) {
      const meds = await prisma.medicamento.findMany({
        where:  { id: { in: catIds } },
        select: { id: true, controlado: true },
      });
      for (const m of meds) controladoPorId.set(m.id, m.controlado);
    }

    const ehControlado = (catId) =>
      !!catId && controladoPorId.get(Number(catId)) === true;

    // Agrupa preservando a ordem original dentro de cada categoria
    const buckets = { CONTROLADO: [], GERAL: [] };
    for (const item of itens) buckets[categoriaPara(item, ehControlado)].push(item);
    const categoriasComItens = ORDEM_CATEGORIAS.filter(c => buckets[c].length > 0);

    // Espécie do animal atendido — usada para cadastrar no catálogo da empresa o item
    // que o vet digitou à mão (sem ela, o novo item não voltaria nas buscas).
    const animalDaPrescricao = await prisma.animal.findUnique({
      where:  { id: Number(animalId) },
      select: { especieId: true, especie: { select: { nome: true } } },
    });
    const empresaDoGrupo = empresaId ? Number(empresaId) : (req.empresaId ?? null);

    const gruposCriados = await prisma.$transaction(async (tx) => {
      let numero = await proximoNumero(tx, Number(animalId));
      const idsCriados = [];
      const cacheCatalogo = new Map(); // não recadastra o mesmo nome duas vezes

      for (const categoria of categoriasComItens) {
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
        for (const item of buckets[categoria]) {
          // Item fora do catálogo (digitado à mão) → cadastra para a EMPRESA e, no
          // caso de medicamento, já vincula a prescrição ao registro criado.
          let medicamentoCatId = item.medicamentoCatId ? Number(item.medicamentoCatId) : null;
          const tipoItem = item.tipo ?? 'MEDICAMENTO';
          const nomeItem = String(item.medicamento ?? '').trim();
          const chaveCatalogo = `${tipoItem}|${nomeItem.toLowerCase()}`;
          if (!medicamentoCatId && nomeItem) {
            if (!cacheCatalogo.has(chaveCatalogo)) {
              cacheCatalogo.set(chaveCatalogo, tipoItem === 'PROCEDIMENTO'
                ? await garantirProcedimentoDaEmpresa(tx, {
                    nome:        nomeItem,
                    especieNome: animalDaPrescricao?.especie?.nome ?? null,
                  }, empresaDoGrupo)
                : await garantirMedicamentoDaEmpresa(tx, {
                    nome:       nomeItem,
                    unidade:    item.unidade,
                    especieIds: animalDaPrescricao?.especieId ? [animalDaPrescricao.especieId] : [],
                  }, empresaDoGrupo));
            }
            // Só o medicamento tem FK na prescrição; o procedimento é guardado pelo nome
            if (tipoItem !== 'PROCEDIMENTO') medicamentoCatId = cacheCatalogo.get(chaveCatalogo);
          }

          const criado = await tx.prescricao.create({
            data: {
              animalId:           Number(animalId),
              veterinarioId,
              grupoId:            grp.id,
              medicamentoCatId,
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
              // Importado do orçamento: guarda o valor UNITÁRIO aceito pelo cliente —
              // é ele que vai para a fatura, e não o preço do catálogo/estoque.
              orcamentoItemId:    item.orcamentoItemId ? Number(item.orcamentoItemId) : null,
              valorOrcado:        item.valorOrcado != null && item.valorOrcado !== ''
                ? Number(item.valorOrcado)
                : null,
            },
          });
          // Coluna nova gravada por SQL cru — o client Prisma pode não tê-la ainda
          // (no Windows o `generate` falha com o backend rodando).
          await gravarAplicadaProprietario(tx, criado.id, item.aplicadaPeloProprietario === true);
        }

        idsCriados.push(grp.id);
        numero += 1;
      }

      return tx.prescricaoGrupo.findMany({
        where:   { id: { in: idsCriados } },
        include: GRUPO_INCLUDE,
        orderBy: { numero: 'asc' },
      });
    });

    return res.status(201).json({
      dados: await anexarFlagEmGrupos(
        prisma,
        gruposCriados.map(g => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      ),
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar prescrição.' });
  }
};

// ─── Helpers de categoria (split por tipo também na edição) ───────────────────

// Categoria homogênea de uma lista de itens (cada item com medicamentoCat.controlado
// carregado): null = vazio | 'MISTO' = categorias diferentes | senão a categoria única.
// Usa a MESMA regra da criação (`categoriaPara`): medicamento comum e procedimento
// convivem em GERAL; só o CONTROLADO se separa. Sem isso, editar uma prescrição
// mista criada agora a estilhaçaria de novo em dois documentos.
function categoriaDeItens(itens) {
  const cats = new Set(itens.map(i =>
    categoriaPara(i, () => !!i.medicamentoCat?.controlado),
  ));
  if (cats.size === 0) return null;
  if (cats.size === 1) return [...cats][0];
  return 'MISTO';
}

// Categoria de um item a partir do body/estado (consulta o flag controlado quando med).
async function categoriaDoItem(client, { tipo, medicamentoCatId }) {
  if ((tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO') return 'GERAL';
  if (!medicamentoCatId) return 'GERAL';
  const med = await client.medicamento.findUnique({
    where:  { id: Number(medicamentoCatId) },
    select: { controlado: true },
  });
  return med?.controlado ? 'CONTROLADO' : 'GERAL';
}

// Encontra um grupo SALVO irmão (mesma evolução/animal) da categoria alvo, ou cria
// um novo. Retorna { id, numero, novo }. Usado ao editar uma prescrição e inserir/
// alterar um item de categoria diferente — mantém cada prescrição homogênea.
async function resolverGrupoDestino(tx, { animalId, evolucaoId, empresaId, veterinarioId, excluirGrupoId, categoriaAlvo }) {
  const irmaos = await tx.prescricaoGrupo.findMany({
    where: { animalId, evolucaoId, status: 'SALVO', id: { not: excluirGrupoId } },
    include: { itens: { where: { ativo: true }, include: { medicamentoCat: { select: { controlado: true } } } } },
  });
  const irmao = irmaos.find(g => categoriaDeItens(g.itens) === categoriaAlvo);
  if (irmao) return { id: irmao.id, numero: irmao.numero, novo: false };

  const numero = await proximoNumero(tx, animalId);
  const novo = await tx.prescricaoGrupo.create({
    data: { numero, animalId, veterinarioId, evolucaoId, empresaId: empresaId ?? null, status: 'SALVO' },
  });
  return { id: novo.id, numero: novo.numero, novo: true };
}

// ─── Adicionar item ao grupo ──────────────────────────────────────────────────

const adicionarItem = async (req, res) => {
  try {
    const grupoId      = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true }, include: { medicamentoCat: { select: { controlado: true } } } } },
    });
    if (!grupo)               return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível adicionar itens em prescrições com status SALVO.' });

    // Autoria: incluir item na prescrição de outro é alterar o documento clínico dele.
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar prescrições criadas por você.' });
    }
    if (await animalEstaInativo(grupo.animalId)) {
      return res.status(400).json({ error: MSG_PACIENTE_INATIVO, code: 'PACIENTE_INATIVO' });
    }

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente, aplicadaPeloProprietario } = req.body;

    if (!medicamento) return res.status(400).json({ error: 'Campo medicamento é obrigatório.' });

    // Split na edição: se o item é de categoria diferente de um grupo homogêneo,
    // vai para uma prescrição irmã (ou nova) da categoria correta.
    const catItem  = await categoriaDoItem(prisma, { tipo, medicamentoCatId });
    const catGrupo = categoriaDeItens(grupo.itens);

    const resultado = await prisma.$transaction(async (tx) => {
      let destinoId   = grupoId;
      let destinoInfo = null;
      if (catGrupo && catGrupo !== 'MISTO' && catGrupo !== catItem) {
        destinoInfo = await resolverGrupoDestino(tx, {
          animalId:       grupo.animalId,
          evolucaoId:     grupo.evolucaoId,
          empresaId:      grupo.empresaId,
          veterinarioId,
          excluirGrupoId: grupoId,
          categoriaAlvo:  catItem,
        });
        destinoId = destinoInfo.id;
      }

      const novoItem = await tx.prescricao.create({
        data: {
          animalId:          grupo.animalId,
          veterinarioId,
          grupoId:           destinoId,
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

      await gravarAplicadaProprietario(tx, novoItem.id, aplicadaPeloProprietario === true);

      // Responsável passa a ser quem adicionou (no grupo de destino)
      await tx.prescricaoGrupo.update({ where: { id: destinoId }, data: { veterinarioId } });
      return { item: novoItem, destinoInfo };
    });

    return res.status(201).json({
      dados:        await anexarAplicadaProprietario(prisma, resultado.item),
      grupoDestino: resultado.destinoInfo
        ? { id: resultado.destinoInfo.id, numeroFormatado: formatNumero(resultado.destinoInfo.numero), novo: resultado.destinoInfo.novo }
        : null,
    });
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

    // Autoria: o dono do DOCUMENTO manda no item. Sem isto, qualquer profissional com
    // "alterar prescrição" reescrevia a posologia prescrita por outro — e o antigo
    // `data.veterinarioId = <quem editou>` ainda fazia o documento mudar de dono calado.
    if (!podeOperarRegistro(req, item.grupo?.veterinarioId ?? item.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar prescrições criadas por você.' });
    }

    // Regra: prescrição que já teve QUALQUER execução não pode ser alterada.
    const execucoesNoGrupo = await prisma.prescricao.count({
      where: { grupoId: item.grupoId, executadoEm: { not: null } },
    });
    if (execucoesNoGrupo > 0 || item.grupo?.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser alterada.', code: 'EXECUTADO' });
    }

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente, aplicadaPeloProprietario } = req.body;

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
    // Editar NÃO transfere a autoria (2026-08-04): quem chegou até aqui é o próprio dono
    // ou o gestor, e um ajuste feito pelo gestor não pode tirar do veterinário a
    // prescrição que ele conduz. A troca de dono tem caminho próprio (assumir/transferir).
    const donoDoDocumento = item.grupo?.veterinarioId ?? item.veterinarioId ?? veterinarioId;
    data.veterinarioId = donoDoDocumento;

    // Split na edição: se a alteração muda a categoria do item e o grupo tem OUTROS
    // itens de categoria diferente (ficaria misto), move o item para uma prescrição
    // irmã (ou nova) da categoria correta. Sem outros itens (ou já misto/legado) →
    // altera no lugar (o grupo só acompanha a nova categoria).
    const tipoFinal  = tipo             !== undefined ? tipo             : item.tipo;
    const catIdFinal = medicamentoCatId !== undefined ? medicamentoCatId : item.medicamentoCatId;
    const catItem    = await categoriaDoItem(prisma, { tipo: tipoFinal, medicamentoCatId: catIdFinal });

    const outros = await prisma.prescricao.findMany({
      where:   { grupoId: item.grupoId, ativo: true, id: { not: itemId } },
      include: { medicamentoCat: { select: { controlado: true } } },
    });
    const catOutros    = categoriaDeItens(outros);
    const precisaRotear = outros.length > 0 && catOutros !== 'MISTO' && catOutros !== catItem;

    const resultado = await prisma.$transaction(async (tx) => {
      let destinoInfo = null;
      if (precisaRotear) {
        destinoInfo = await resolverGrupoDestino(tx, {
          animalId:       item.animalId,
          evolucaoId:     item.grupo.evolucaoId,
          empresaId:      item.grupo.empresaId,
          veterinarioId,
          excluirGrupoId: item.grupoId,
          categoriaAlvo:  catItem,
        });
        data.grupoId = destinoInfo.id;
        await tx.prescricaoGrupo.update({ where: { id: destinoInfo.id }, data: { veterinarioId: donoDoDocumento } });
      }

      const updated = await tx.prescricao.update({
        where: { id: itemId },
        data,
        include: {
          veterinario:    { select: { id: true, fullName: true } },
          medicamentoCat: { select: { id: true, nome: true } },
        },
      });

      await gravarAplicadaProprietario(tx, itemId, aplicadaPeloProprietario);

      // O grupo de origem MANTÉM o responsável (ver comentário em `donoDoDocumento`);
      // só assume um quando estava órfão.
      if (item.grupo?.veterinarioId == null) {
        await tx.prescricaoGrupo.update({ where: { id: item.grupoId }, data: { veterinarioId: donoDoDocumento } });
      }

      await registrarAlteracao(tx, req, {
        entidade: 'PRESCRICAO', entidadeId: item.grupoId, animalId: item.animalId,
        donoAtualId: donoDoDocumento,
        campos: {
          [`item.medicamento`]: { de: item.medicamento, para: updated.medicamento },
          [`item.dosagem`]:     { de: item.dosagem,     para: updated.dosagem },
          [`item.unidade`]:     { de: item.unidade,     para: updated.unidade },
          [`item.via`]:         { de: item.via,         para: updated.via },
          [`item.frequencia`]:  { de: item.frequencia,  para: updated.frequencia },
          [`item.duracaoDias`]: { de: item.duracaoDias, para: updated.duracaoDias },
          [`item.horaInicio`]:  { de: item.horaInicio,  para: updated.horaInicio },
          [`item.observacao`]:  { de: resumoTexto(item.observacao), para: resumoTexto(updated.observacao) },
        },
      });

      return { updated, destinoInfo };
    });

    return res.json({
      dados:        await anexarAplicadaProprietario(prisma, resultado.updated),
      grupoDestino: resultado.destinoInfo
        ? { id: resultado.destinoInfo.id, numeroFormatado: formatNumero(resultado.destinoInfo.numero), novo: resultado.destinoInfo.novo }
        : null,
    });
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

    // Autoria: cancelar item da prescrição de outro é ato do dono — ou do gestor.
    if (!podeOperarRegistro(req, item.grupo?.veterinarioId ?? item.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }

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
          const itensRestantes = await anexarAplicadaProprietario(prisma, await tx.prescricao.findMany({
            where: { grupoId: item.grupoId, ativo: true, id: { not: itemId } },
          }));
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
      include: {
        itens:    { where: { ativo: true } },
        evolucao: { select: { tipoAtendimento: true, numero: true } },
      },
    });

    if (!grupo)                   return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível finalizar prescrições com status SALVO.' });

    // Autoria via RBAC (nível efetivo em atendimento.prescricoes.finalizar):
    // PROPRIO → só as próprias; EQUIPE/FULL → qualquer da equipe.
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar prescrições criadas por você.' });
    }
    if (grupo.itens.length === 0) return res.status(400).json({ error: 'A prescrição não possui itens ativos.' });

    // Sem a flag no item, o que o cliente aplica em casa voltaria a reservar estoque
    // e a ser cobrado logo aqui, na finalização.
    grupo.itens = await anexarAplicadaProprietario(prisma, grupo.itens);

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

    const animal = await prisma.animal.findUnique({
      where: { id: grupo.animalId }, select: { userId: true },
    });
    const proprietarioId = animal?.userId ?? null;
    const atendNum = grupo.evolucao
      ? formatAtendimentoNum(grupo.evolucao.tipoAtendimento, grupo.evolucao.numero)
      : null;

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

      // ── MATRIZ "quem FORNECE × quem APLICA" (2026-08-01) ────────────────────
      // MEDICAMENTO:
      // fornecido pelo Cliente | aplicado pelo Proprietário | execução | fatura
      //          não          |            não             |   ENTRA  | na EXECUÇÃO
      //          SIM          |            não             |   ENTRA  | nunca
      //          não          |            SIM             |  não vai | AQUI (finalização)
      //          SIM          |            SIM             |  não vai | nunca
      //
      // Ou seja: aqui só entra o item que a clínica FORNECE e o proprietário APLICA —
      // ele nunca chega ao plantão, então a finalização é a única oportunidade de
      // cobrá-lo. Todo o resto que é cobrável espera a execução (`executar`), que é
      // quando o serviço de fato acontece.
      //
      // PROCEDIMENTO marcado "Será executado pelo Proprietário" NUNCA é cobrado.
      // Procedimento não é bem entregue, é SERVIÇO: se quem executa é o proprietário,
      // a clínica não faz nada e não há o que faturar — diferente do medicamento, em
      // que a clínica ainda entrega o frasco mesmo sem aplicar. Por isso o filtro é
      // pelo tipo MEDICAMENTO, e não "não é procedimento": só o que a clínica de fato
      // ENTREGA pode ser cobrado sem execução.
      // ⚠️ Mudança de premissa: até 2026-08-01 a finalização lançava TUDO (com o
      // medicamento zerado até a 1ª execução preencher o valor). Agora o que vai ser
      // executado só vira linha de fatura ao ser executado.
      const itensParaFaturarAgora = grupo.itens.filter(
        i => i.tipo === 'MEDICAMENTO' && !i.medicamentoCliente && i.aplicadaPeloProprietario,
      );
      // Sem nada a cobrar agora, nem abre fatura: senão a finalização criaria uma
      // fatura vazia para o cliente todo mês.
      if (proprietarioId && itensParaFaturarAgora.length > 0) {
        // A fatura segue a tenancy do GRUPO (clínica que prescreveu), não o contexto
        // de quem executa — cada empresa tem a sua fatura para o mesmo cliente.
        const fatura = await getOrCreateFatura(tx, proprietarioId, empresaIdEfetivo);
        for (const item of itensParaFaturarAgora) {
          const jaLancado = await tx.faturaItem.findFirst({ where: { prescricaoId: item.id } });
          if (jaLancado) continue;
          await adicionarFaturaItem(tx, {
            faturaId:     fatura.id,
            animalId:     grupo.animalId,
            tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
            descricao:    descricaoItemFatura(item, atendNum),
            // Valor aceito no orçamento manda; sem orçamento, procedimento sai pelo
            // catálogo/combo.
            // ⚠️ MEDICAMENTO cai em 0 aqui: o preço nasce do LOTE debitado, e este item
            // nunca é executado (quem aplica é o proprietário) — logo não há lote. Se a
            // clínica entrega o medicamento, hoje é preciso ajustar o valor na fatura à
            // mão, ou orçar o item antes (o `valorOrcado` tem precedência).
            valor:        item.valorOrcado != null
              ? item.valorOrcado
              : (item.tipo === 'PROCEDIMENTO'
                  ? await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento)
                  : 0),
            quantidade:   1,
            veterinarioId,
            prescricaoId: item.id,
          });
        }
      }

      // Finalizar grava `veterinarioId` = quem finalizou. Quando isso muda o dono do
      // documento (gestor finalizando a prescrição de outro), é uma TRANSFERÊNCIA e
      // precisa do mesmo rastro do assumir — senão o documento troca de mãos calado.
      if (grupo.veterinarioId != null && Number(grupo.veterinarioId) !== Number(veterinarioId)) {
        await registrarTransferencia(tx, req, {
          entidade: 'PRESCRICAO', entidadeId: grupoId, animalId: grupo.animalId,
          deVetId: grupo.veterinarioId, paraVetId: veterinarioId,
          motivo: 'Prescrição finalizada por outro profissional',
        });
      }

      await registrarAlteracao(tx, req, {
        entidade: 'PRESCRICAO', entidadeId: grupoId, animalId: grupo.animalId,
        donoAnteriorId: grupo.veterinarioId,
        donoAtualId:    veterinarioId,
        campos: { status: { de: grupo.status, para: 'FINALIZADO' } },
      });
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
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
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

    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
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
      // O item foi lançado na fatura na finalização; cancelado sem execução, sai da
      // fatura (nunca foi aplicado). Itens já executados permanecem faturados.
      for (const item of grupo.itens.filter(i => !i.executadoEm)) {
        await removerFaturaItensDaOrigem(tx, 'prescricaoId', item.id);
      }
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
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
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

    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite editar prescrições criadas por você.' });
    }
    if (grupo.status === 'SALVO') {
      const g = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
      // Anexar a flag aqui não é detalhe: o objeto devolvido vai direto para o
      // formulário de edição. Sem ela, a caixa "aplicada pelo Proprietário" reabre
      // desmarcada em cada item e o Salvar seguinte apagaria a marcação.
      return res.json({ dados: await anexarFlagEmGrupos(prisma, { ...g, numeroFormatado: formatNumero(g.numero) }) });
    }
    if (grupo.status === 'EXECUTADO' || grupo.itens.some(i => i.executadoEm)) {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser editada.', code: 'EXECUTADO' });
    }
    if (grupo.status !== 'FINALIZADO') {
      return res.status(400).json({ error: 'Somente prescrições finalizadas e não executadas podem ser reabertas.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      // Volta a ser rascunho → sai da fatura (será relançada na próxima finalização)
      for (const item of grupo.itens) {
        await removerFaturaItensDaOrigem(tx, 'prescricaoId', item.id);
      }
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'RASCUNHO' } });
      await tx.prescricaoGrupo.update({ where: { id: grupoId }, data: { status: 'SALVO', veterinarioId: userId } });
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({
      dados: await anexarFlagEmGrupos(prisma, { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) }),
    });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
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

// Descrição do item na fatura — mesma forma no lançamento da finalização e na execução
function descricaoItemFatura(item, atendNum) {
  const dose = item.dosagem
    ? `${item.dosagem}${item.unidade ?? ''} × ${item.frequencia}`
    : item.frequencia;
  const base = item.tipo === 'MEDICAMENTO' ? `${item.medicamento} — ${dose}` : item.medicamento;
  return atendNum ? `[${atendNum}] ${base}` : base;
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
    grupo.itens = await anexarAplicadaProprietario(prisma, grupo.itens);

    // Item aplicado pelo proprietário nunca é executado pela clínica — a lista do
    // plantão já não o mostra, e o filtro aqui fecha a porta de um POST com itemIds
    // (execução item a item) que o alcançasse mesmo assim.
    const itensHoje = grupo.itens.filter(item =>
      !item.aplicadaPeloProprietario &&
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

      // Lança na fatura ABERTA do proprietário NESTA empresa (quantidade do dia)
      const fatura = await getOrCreateFatura(tx, proprietarioId, empresaIdEfetivo);

      for (const item of itensHoje) {
        // precos já contém o valor proporcional da dose (regra de 3)
        // MEDICAMENTO sem estoque no sistema → valor 0 na fatura (lança para o financeiro saber)
        // PROCEDIMENTO → valor do combo/valor da empresa/catálogo (Cadastro > Procedimentos)
        // Valor da dose: o que foi ACEITO no orçamento tem precedência; sem orçamento,
        // procedimento sai pelo catálogo/combo e medicamento pelo preço do lote debitado.
        const valorDaDose = item.valorOrcado != null
          ? item.valorOrcado
          : (item.tipo === 'PROCEDIMENTO'
              ? await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento)
              : (item.medicamentoCatId ? (precos.get(item.medicamentoCatId) ?? 0) : 0));
        const descricao = descricaoItemFatura(item, atendNum);

        // Fornecido pelo cliente NÃO é cobrado — não gera item na fatura, mesmo após
        // executado. (A seringa/agulha da aplicação, insumos da clínica, continuam
        // sendo lançados abaixo quando a via for injetável.)
        // É AQUI que nasce a cobrança do item sem flag nenhuma — a finalização deixou
        // de lançá-lo em 2026-08-01 (ver a matriz em `finalizar`). O item aplicado pelo
        // proprietário nem chega neste laço: `itensHoje` já o excluiu.
        if (!item.medicamentoCliente) {
          // Prescrição finalizada ANTES da mudança já tem uma linha zerada criada na
          // finalização: na PRIMEIRA execução ela é aproveitada (só confirma o valor)
          // em vez de duplicar. Nas finalizadas depois, não há linha e cada dose entra
          // como uma linha nova — o total continua sendo o efetivamente aplicado.
          // `item.executadoEm` ainda reflete o estado ANTES desta execução (a marcação
          // acontece adiante no laço) e `itensHoje` já excluiu quem executou hoje.
          const primeiraExecucao = !item.executadoEm;
          const lancamentoDaFinalizacao = primeiraExecucao
            ? await tx.faturaItem.findFirst({ where: { prescricaoId: item.id }, orderBy: { id: 'asc' } })
            : null;
          if (lancamentoDaFinalizacao) {
            await tx.faturaItem.update({
              where: { id: lancamentoDaFinalizacao.id },
              data:  { descricao, valor: valorDaDose },
            });
          } else {
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
      // Item aplicado pelo proprietário está FORA da conta: ele nunca será executado,
      // e exigi-lo aqui deixaria o documento eternamente FINALIZADO — preso na tela
      // de execução mesmo com tudo o que é da clínica já aplicado.
      const itensAtuais = (await anexarAplicadaProprietario(prisma, await tx.prescricao.findMany({
        where:  { grupoId, ativo: true },
        select: { id: true, executadoEm: true, dataInicio: true, duracaoDias: true },
      }))).filter(i => !i.aplicadaPeloProprietario);
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

      // O preenchimento do valor do item já lançado na finalização é um UPDATE —
      // não passa pelo incremento de `adicionarFaturaItem`. Recalcula para fechar.
      await recalcularTotal(tx, fatura.id);
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
    // TENANCY DO DOCUMENTO — o plantão é da EMPRESA ATIVA e de mais ninguém.
    //
    // ⚠️ Esta linha é o que impede o vazamento entre clínicas. O `empresaId` só entrava
    // quando vinha na QUERY, e o front nunca o manda: o filtro simplesmente não existia,
    // e o escopo por ANIMAL abaixo não substitui isso por dois motivos —
    //   1. `buildAnimalScopeWhere` inclui, para dono/gestor, os vínculos do vet em
    //      QUALQUER empresa (regra da tela de Pacientes: "base própria vê o co-tratado
    //      de outra empresa" — CLAUDE.md §5). Correto lá, vazamento aqui.
    //   2. Mesmo com o animal certo, o MESMO paciente pode ser tratado por duas
    //      clínicas: sem este filtro, o plantão de uma exibia (e deixava executar) a
    //      prescrição da outra.
    // Mesma decisão da busca global (§16): escopo é a empresa do contexto, nunca
    // "todos os vínculos do usuário". `empresaId` da query NÃO pode ampliar — ele só
    // estreita dentro da empresa ativa; tenant vindo do cliente jamais define escopo.
    // Seguro para o legado: 100% dos PrescricaoGrupo têm `empresaId` gravado.
    if (req.empresaId) {
      whereGrupo.empresaId = Number(req.empresaId);
    } else if (empresaId) {
      whereGrupo.empresaId = Number(empresaId);
    }
    if (animalId)  whereGrupo.animalId  = Number(animalId);

    // Escopo base × convidado por ANIMAL (mesma regra da listagem/agendamento): o vet
    // vinculado (convidado) só vê os grupos dos SEUS animais + os liberados por outros
    // vets (designação) na empresa ativa; dono/gestor vê os pacientes que trata.
    const { where: animalScopeWhere } = await buildAnimalScopeWhere(req);
    // `ANIMAL_VISIVEL` = `{ ativo: true, user: { ativo: true } }` — EXCLUSÃO LÓGICA
    // (lib/visibilidade.js). O `ativo: true` do animal já estava aqui; o que faltava
    // era o do CLIENTE: inativar o proprietário não tirava do plantão as prescrições
    // dos animais dele.
    whereGrupo.animal = { ...animalScopeWhere, ...ANIMAL_VISIVEL };

    const gruposCrus = await prisma.prescricaoGrupo.findMany({
      where:   whereGrupo,
      include: {
        veterinario:  { select: { id: true, fullName: true } },
        finalizadoPor:{ select: { id: true, fullName: true } },
        executadoPor: { select: { id: true, fullName: true } },
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true, baia: true,
            // A fila do plantão mostra "Local • Peso • Idade" sob o paciente: quem vai
            // aplicar precisa saber PARA ONDE ir e o peso da dose. `local` é o campo
            // textual legado (fallback de quem foi cadastrado antes do catálogo).
            local: true, dataNascimento: true, idadeAnos: true,
            localizacao: { select: { nome: true } },
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

    // O que o PROPRIETÁRIO aplica em casa não é serviço da clínica: sai do plantão.
    // O corte é por ITEM — o mesmo documento pode ter o injetável da baia (fica) e a
    // pomada que o tratador passa (sai). Grupo que ficou sem nenhum item some da tela;
    // como FaturaItem e baixa de estoque só nascem na EXECUÇÃO, não aparecer aqui é o
    // que garante que esse item nunca seja cobrado nem debitado.
    const grupos = (await anexarFlagEmGrupos(prisma, gruposCrus))
      .map(g => ({ ...g, itens: g.itens.filter(i => !i.aplicadaPeloProprietario) }))
      .filter(g => g.itens.length > 0);

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