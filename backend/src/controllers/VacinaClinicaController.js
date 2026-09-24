// VacinaClinicaController.js — registro clínico de vacinas por animal
const prisma = require('../lib/prisma').default;
// FORMA DE CÁLCULO do produto (2026-09-16) — a unidade da dosagem, do lote e da fatura.
const catalogoEmpresa = require('../lib/catalogoEmpresa');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { getOrCreateFatura, adicionarOuSomarFaturaItem, removerFaturaItensDaOrigem } = require('../lib/faturaUtils');
const itemOrigens = require('../lib/faturaItemOrigens');
// CONTA A PAGAR do fornecedor da vacina (2026-09-10) — o outro lado do balcão da
// fatura. Lido/gravado por SQL cru: as tabelas são da migration 20261006000000.
const contasPagar       = require('../lib/contasPagar');
const produtoFornecedor = require('../lib/produtoFornecedor');
const formaCobranca     = require('../lib/formaCobrancaEstoque');
// Etapa de Execução de Prescrição OPCIONAL por empresa (2026-09-24) — ver
// `executarNaFinalizacao`.
const etapaExecucao     = require('../lib/etapaExecucaoPrescricao');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
const { animalEstaInativo, bloquearSeAnimalInativo, lerInativosEmLote } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { garantirMedicamentoDaEmpresa } = require('../lib/catalogoManual');
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');

const INCLUDE_VACINA = {
  veterinario: { select: { id: true, fullName: true } },
  vacina: { select: { id: true, nome: true, fabricante: true, via: true } },
  loteVacina: { select: { id: true, lote: true, validade: true, qtdDisponivel: true } },
};

// 🔴 ATÉ SER APLICADA, A VACINA É CORRIGÍVEL (2026-09-23). SALVA é o rascunho e
// FINALIZADA é a dose na fila do plantão — nenhuma das duas tirou frasco da prateleira
// nem gerou cobrança (a FINALIZADA tem RESERVA, que `atualizar` refaz). EXECUTADA e
// CANCELADA ficam de fora: lá existe fatura e baixa de estoque para preservar.
// ⚠️ Lista usada pelo backend E espelhada no botão "Alterar" da tela (SubModuloVacina):
// afrouxar uma sem a outra deixa o botão aparecendo para uma dose que a rota recusa.
const STATUS_ALTERAVEIS = ['SALVA', 'FINALIZADA'];

// ─── Reserva de estoque (FEFO) para VACINA ───────────────────────────────────
// Espelha PrescricaoGrupoController (medicamento): reserva ao FINALIZAR (SALVA→
// FINALIZADA), consome de verdade (decrementa qtd_disponivel) ao EXECUTAR, libera sem
// debitar ao CANCELAR antes da execução. Tabela `tb_reservas_estoque_vacina`
// (migration 20260830000000) — por SQL cru, mesmo padrão do resto deste controller
// ("fora do client gerado"): funciona sem depender de `npx prisma generate` ter
// reconhecido o model novo. Não existe para `cliente:true` (nunca debita) nem para
// aplicadaPeloProprietario×!cliente (debita direto na FINALIZAÇÃO — ver `finalizar` —
// nunca passa pelo plantão, então não há intervalo "reservado, aguardando execução").

// Lotes do medicamento/vacina em ordem FEFO (validade mais próxima primeiro), cada um
// com `reservadoOutros` = soma do que JÁ está reservado por OUTRAS vacinas — é o que
// permite duas vacinas concorrentes disputarem o mesmo lote sem uma "roubar" doses que
// a outra já tinha garantido ao finalizar. `vacinaIdExcluir` tira a própria vacina da
// conta (reenvio/edição antes de executar recalcula do zero).
async function buscarLotesVacinaFEFO(client, medicamentoCatId, empresaId, vacinaIdExcluir = null) {
  if (!medicamentoCatId) return [];
  const params = empresaId != null ? [Number(medicamentoCatId), Number(empresaId)] : [Number(medicamentoCatId)];
  const empresaFilter = empresaId != null ? 'AND (empresa_id = $2 OR empresa_id IS NULL)' : '';
  const lotes = await client.$queryRawUnsafe(
    `SELECT id, lote, qtd_disponivel AS "qtdDisponivel", doses_por_frasco AS "dosesPorFrasco",
            COALESCE(valor_unitario_repassado, valor_unitario, 0)::float AS "valorBruto"
     FROM schs2vet.tb_lotes_vacina
     WHERE medicamento_cat_id = $1 AND ativo = true ${empresaFilter}
     ORDER BY validade ASC NULLS LAST, id ASC`,
    ...params
  );
  if (lotes.length === 0) return [];

  const ids = lotes.map(l => Number(l.id));
  const reservasParams = vacinaIdExcluir != null ? [ids, Number(vacinaIdExcluir)] : [ids];
  const reservas = await client.$queryRawUnsafe(
    `SELECT "loteVacinaId", quantidade FROM schs2vet.tb_reservas_estoque_vacina
     WHERE "loteVacinaId" = ANY($1::int[]) ${vacinaIdExcluir != null ? 'AND "vacinaClinicaId" != $2' : ''}`,
    ...reservasParams
  );
  const reservadoPorLote = new Map();
  for (const r of reservas) {
    reservadoPorLote.set(r.loteVacinaId, (reservadoPorLote.get(r.loteVacinaId) ?? 0) + Number(r.quantidade));
  }
  return lotes.map(l => ({ ...l, reservadoOutros: reservadoPorLote.get(Number(l.id)) ?? 0 }));
}

/**
 * 🔴 A DOSAGEM DA VACINA DEIXOU DE SER CONTAGEM INTEIRA (2026-09-16).
 *
 * `quantidade` era "quantas doses" e vinha por `Math.max(1, …)`. Com o campo virando
 * Valor + Forma de Cálculo, 0,5 mL é dosagem legítima — e o piso em 1 a transformava
 * em 1 mL em SILÊNCIO, dobrando a baixa do lote e a linha da fatura.
 *
 * ⚠️ O fallback 1 FICA para o registro sem valor (legado, importação): ali "1" é a
 * leitura conservadora de uma aplicação, não uma afirmação sobre volume.
 */
function dosagemDaVacina(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** A coluna `forma_calculo` da vacina existe? (migration 20261012000000) */
let _temFormaVac = null;
async function temColunaFormaVacina(client) {
  if (_temFormaVac !== null) return _temFormaVac;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_vacinas_clinicas'
          AND column_name = 'forma_calculo' LIMIT 1`);
    _temFormaVac = rows.length > 0;
  } catch { _temFormaVac = false; }
  return _temFormaVac;
}

/**
 * A Forma de Cálculo do PRODUTO, para virar SNAPSHOT na aplicação.
 *
 * 🔴 SNAPSHOT e não leitura ao vivo: o atestado e a fatura de dois anos atrás têm de
 * sair na unidade DAQUELE dia. Reler o cadastro faria uma vacina aplicada em "5 mL"
 * passar a ser exibida em "5 doses" porque alguém mexeu no produto depois.
 * ⚠️ Resolvida no SERVIDOR a partir do `medicamentoCatId`, nunca recebida do cliente:
 * unidade vinda da tela é unidade que pode não bater com a do estoque.
 */
async function formaDoProduto(client, medicamentoCatId) {
  if (!medicamentoCatId) return null;
  const mapa = await catalogoEmpresa.multidosePorItem(client, [Number(medicamentoCatId)]);
  const info = mapa.get(Number(medicamentoCatId));
  return (info?.multidose && info.formaCalculo && Number(info.dosesPorEmbalagem) > 0)
    ? info.formaCalculo
    : null;
}

// Cria a reserva ao FINALIZAR — distribui `quantidade` entre os lotes em FEFO,
// respeitando o que já está reservado por outras vacinas; se mesmo assim faltar, o
// restante é reservado na ÚLTIMA entrada (mesma "finalização forçada" da prescrição —
// nunca bloqueia o registro clínico por estoque insuficiente).
async function criarReservaVacina(tx, { vacinaId, animalId, medicamentoCatId, quantidade, empresaId }) {
  // Recalcula do zero: reenvio/edição antes da execução não pode duplicar reserva.
  await tx.$executeRawUnsafe(
    `DELETE FROM schs2vet.tb_reservas_estoque_vacina WHERE "vacinaClinicaId" = $1`, vacinaId
  );
  if (!medicamentoCatId) return;
  const lotes = await buscarLotesVacinaFEFO(tx, medicamentoCatId, empresaId, vacinaId);
  if (lotes.length === 0) return;

  let restante = dosagemDaVacina(quantidade);
  for (let i = 0; i < lotes.length && restante > 0; i++) {
    const l = lotes[i];
    const disponivel    = Math.max(Number(l.qtdDisponivel) - l.reservadoOutros, 0);
    const ultimaEntrada  = i === lotes.length - 1;
    const qtdEntrada    = ultimaEntrada ? restante : Math.min(disponivel, restante);
    if (qtdEntrada <= 0) continue;
    await tx.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_reservas_estoque_vacina ("loteVacinaId", "vacinaClinicaId", "animalId", quantidade)
       VALUES ($1, $2, $3, $4)`,
      Number(l.id), vacinaId, animalId, qtdEntrada
    );
    restante -= qtdEntrada;
  }
}

// Consome a(s) reserva(s) desta vacina ao EXECUTAR: decrementa `qtd_disponivel` de
// verdade em cada lote reservado e apaga as linhas de reserva. Retorna `null` quando
// não há reserva (vacina aplicada pelo proprietário, que nunca reserva, ou registro
// legado anterior a esta migration) — o chamador cai no lookup direto de sempre.
async function consumirReservaVacina(tx, vacinaId) {
  const reservas = await tx.$queryRawUnsafe(
    `SELECT r."loteVacinaId" AS "loteId", r.quantidade,
            l.lote, l.doses_por_frasco AS "dosesPorFrasco",
            COALESCE(l.valor_unitario_repassado, l.valor_unitario, 0)::float AS "valorBruto"
     FROM schs2vet.tb_reservas_estoque_vacina r
     JOIN schs2vet.tb_lotes_vacina l ON l.id = r."loteVacinaId"
     WHERE r."vacinaClinicaId" = $1`,
    vacinaId
  );
  if (reservas.length === 0) return null;

  let valorTotal   = 0;
  let qtdTotal     = 0;
  let loteIdFinal  = null;
  let loteNomeFinal = null;
  for (const r of reservas) {
    const qtd = Number(r.quantidade);
    await tx.$executeRawUnsafe(
      `UPDATE schs2vet.tb_lotes_vacina SET qtd_disponivel = GREATEST(qtd_disponivel - $1, 0) WHERE id = $2`,
      qtd, r.loteId
    );
    const dosesFrasco = Number(r.dosesPorFrasco) || 1;
    valorTotal += (Number(r.valorBruto) / dosesFrasco) * qtd;
    qtdTotal   += qtd;
    loteIdFinal   = r.loteId;   // último lote tocado — mantém compat com o campo único `loteId` da vacina
    loteNomeFinal = r.lote;
  }
  await tx.$executeRawUnsafe(
    `DELETE FROM schs2vet.tb_reservas_estoque_vacina WHERE "vacinaClinicaId" = $1`, vacinaId
  );

  // Preço MÉDIO por dose (pode ter vindo de lotes com preços diferentes) — o chamador
  // multiplica de volta por `qtd` ao lançar na fatura, então precisa ser por-dose.
  return { loteId: loteIdFinal, loteNome: loteNomeFinal, valorPorDose: qtdTotal > 0 ? valorTotal / qtdTotal : 0 };
}

async function listarPorAnimal(req, res) {
  try {
    const { animalId } = req.params;

    // Transferência de Propriedade — o PROPRIETÁRIO atual só vê o que foi aplicado
    // a partir de `propriedadeDesde`; GESTOR/VET/ADMIN (corte null) veem tudo.
    const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
    const corte = corteDePropriedade(req, animalCorte);

    // Mostra todas as vacinas (ativas, vencidas e inativas) para histórico completo
    const vacinas = await prisma.vacinaClinica.findMany({
      // Segregação multi-clínica: cada empresa vê só as próprias vacinas do animal
      where: { animalId: Number(animalId), AND: [escopoFilhoEvolucaoWhere(req)], ...(corte ? { dataAplicacao: { gte: corte } } : {}) },
      include: INCLUDE_VACINA,
      orderBy: { dataAplicacao: 'desc' },
    });

    // Enriquece com campos adicionados via migration (fora do client gerado)
    if (vacinas.length > 0) {
      const ids = vacinas.map(v => v.id);
      const extras = await prisma.$queryRawUnsafe(
        `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
                quantidade, valor::float AS valor, cliente, status,
                aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
                motivo_inativacao AS "motivoInativacao",
                forma_calculo AS "formaCalculo",
                medicamento_cat_id AS "medicamentoCatId"
         FROM schs2vet.tb_vacinas_clinicas
         WHERE id = ANY($1::int[])`,
        ids
      );
      const extrasMap = Object.fromEntries(extras.map(e => [e.id, e]));
      const enriched = vacinas.map(v => ({ ...v, ...extrasMap[v.id] }));
      return res.json({ dados: enriched });
    }

    res.json({ dados: vacinas });
  } catch (err) {
    console.error('listarPorAnimal vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas' });
  }
}

// Catálogo ativo para dropdown clínico
async function listarCatalogoAtivo(req, res) {
  try {
    const vacinas = await prisma.vacina.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, fabricante: true, via: true },
    });
    res.json({ dados: vacinas });
  } catch (err) {
    console.error('listarCatalogoAtivo:', err);
    res.status(500).json({ error: 'Erro ao listar catálogo' });
  }
}

// Lotes disponíveis para uma vacina (com saldo > 0 e dentro da validade)
async function listarLotesDisponiveis(req, res) {
  try {
    const { vacinaId } = req.params;
    const { empresaId } = req.query;
    const hoje = new Date();

    const where = {
      vacinaId: Number(vacinaId),
      ativo: true,
      qtdDisponivel: { gt: 0 },
      validade: { gte: hoje },
    };
    if (empresaId) where.empresaId = Number(empresaId);

    const lotes = await prisma.loteVacina.findMany({
      where,
      orderBy: { validade: 'asc' },
      select: { id: true, lote: true, validade: true, qtdDisponivel: true, empresaId: true },
    });
    res.json({ dados: lotes });
  } catch (err) {
    console.error('listarLotesDisponiveis:', err);
    res.status(500).json({ error: 'Erro ao listar lotes' });
  }
}

async function registrar(req, res) {
  try {
    const veterinarioId = req.user.id;
    const {
      animalId, vacinaId, loteId, medicamentoCatId,
      nome, fabricante, lote: loteNum,
      dose, via, dataAplicacao, dataReforco, observacao,
      evolucaoId,
      quantidade, valor,
      cliente: clienteRaw,
      aplicadaPeloProprietario: aplicadaPropRaw,
    } = req.body;

    // cliente = vacina fornecida pelo próprio cliente → sem débito de estoque, sem lançamento na fatura
    const isCliente = clienteRaw === true || clienteRaw === 'true';
    // aplicadaPeloProprietario = quem APLICA a dose. Decisão IRMÃ de `cliente` (quem
    // FORNECE) — é o cruzamento das duas que decide execução e fatura. Ver a matriz em
    // `finalizar` e na migration 20260815000001.
    const isAplicadaProp = aplicadaPropRaw === true || aplicadaPropRaw === 'true';

    if (!animalId)    return res.status(400).json({ error: 'animalId é obrigatório' });
    if (await animalFoiExcluido(animalId)) {
      return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
    }
    if (await animalEstaInativo(animalId)) {
      return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
    }

    // Evolução é opcional — busca para montar a descrição na fatura E para checar autoria
    const evolucao = evolucaoId
      ? await prisma.evolucaoClinica.findFirst({
          where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
          select: { id: true, numero: true, tipoAtendimento: true, veterinarioId: true },
        })
      : null;

    // Autoria: registrar vacina dentro do atendimento de outro profissional é operar
    // um documento que não é seu — mesma regra de editar/finalizar/excluir (ver
    // `podeOperarRegistro` mais abaixo neste arquivo), só que aqui é ANTES do
    // registro existir. Quem não conduz a evolução (não criou nem assumiu) só
    // registra vacina depois de assumi-la.
    if (evolucao && !podeOperarRegistro(req, evolucao.veterinarioId)) {
      return res.status(403).json({ error: 'Só é possível registrar vacina dentro de uma evolução sua. Assuma o atendimento antes de registrar.' });
    }

    let nomeVacina = nome;
    let fabricanteVacina = fabricante;
    let loteNumFinal = loteNum;
    let viaFinal = via;
    let medCatIdFinal = medicamentoCatId ? Number(medicamentoCatId) : null;

    // Busca nome do catálogo de medicamentos (novo fluxo)
    if (medicamentoCatId) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT nome FROM schs2vet.tb_medicamentos WHERE id = $1 LIMIT 1`,
        Number(medicamentoCatId)
      );
      if (rows.length > 0) {
        nomeVacina = rows[0].nome;
      }
    } else if (vacinaId) {
      // Fluxo legado: busca da tb_vacinas
      const vacinaData = await prisma.vacina.findUnique({ where: { id: Number(vacinaId) } });
      if (vacinaData) {
        nomeVacina = vacinaData.nome;
        fabricanteVacina = vacinaData.fabricante ?? fabricante;
        viaFinal = viaFinal ?? vacinaData.via;
      }
    } else if (nome?.trim()) {
      // Vacina DIGITADA À MÃO, sem id de catálogo nem legado — mesmo fallback que
      // Medicamento/Procedimento já têm na Prescrição (lib/catalogoManual.js):
      // cadastra (ou reaproveita) uma entrada PRIVADA da empresa com esse nome, e
      // a vacina passa a ter medicamentoCatId de verdade — sem isso ela nasceria
      // sem FK, invisível nas buscas futuras e sem rastreio de estoque/lote.
      const animalDaVacina = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { especieId: true },
      });
      medCatIdFinal = await garantirMedicamentoDaEmpresa(prisma, {
        nome:       nome.trim(),
        vacina:     true,
        especieIds: animalDaVacina?.especieId ? [animalDaVacina.especieId] : [],
      }, req.empresaId ?? null);
    }

    if (!nomeVacina?.trim()) return res.status(400).json({ error: 'Vacina é obrigatória' });

    // Gera número sequencial VC-XXXX por animal (raw SQL — client pode não ter campo ainda)
    const maxRows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS next_numero
       FROM schs2vet.tb_vacinas_clinicas
       WHERE "animalId" = $1 AND tipo_atendimento = 'VC' AND ativo = true`,
      Number(animalId)
    );
    const numero = Number(maxRows[0]?.next_numero ?? 1);

    const qtdFinal   = dosagemDaVacina(quantidade);
    const valorFinal = valor != null && valor !== '' ? Number(valor) : null;

    let loteValor   = 0;
    let loteIdFinal = loteId ? Number(loteId) : null;

    if (loteIdFinal) {
      const loteData = await prisma.loteVacina.findUnique({ where: { id: loteIdFinal } });
      if (!loteData) return res.status(404).json({ error: 'Lote não encontrado' });
      if (!isCliente) {
        // 🔴 SALDO NÃO RECUSA O REGISTRO DA VACINA (2026-09-23) — aqui havia um
        // 400 'Lote sem saldo disponível'. Mesma decisão já tomada para a prescrição
        // em 2026-09-23 (`__tests__/execucaoSemTravas.test.js`): estoque é CONTROLE,
        // não autorização clínica. A dose foi (ou será) aplicada na baia de qualquer
        // jeito; recusar o registro não devolve o frasco — só apaga o rastro (fatura,
        // histórico, baixa, conta a pagar) e pune a clínica que mantém o estoque em dia,
        // porque quem não cadastra lote nenhum nunca foi barrado.
        // ⚠️ A BAIXA continua acontecendo, e nunca gera saldo negativo: `executar` →
        // `darBaixaEFaturar` debita o que HOUVER, em FEFO. O que saiu foi o BLOQUEIO.
        // ⚠️ A VALIDADE segue barrando, logo abaixo, e de propósito: "acabou o saldo"
        // e "o frasco está vencido" são perguntas diferentes — a segunda é segurança do
        // paciente, não controle de inventário.
        if (loteData.validade && new Date(loteData.validade) < new Date()) {
          return res.status(400).json({ error: `Lote ${loteData.lote} está vencido (validade: ${new Date(loteData.validade).toLocaleDateString('pt-BR')}). Selecione um lote dentro da validade.` });
        }
      }
      loteNumFinal = loteData.lote;
      // Valor por frasco ÷ doses por frasco = valor proporcional por dose (só referência —
      // o débito do lote acontece na EXECUÇÃO, não aqui no registro).
      const valorFrascoExplicito = Number(loteData.valorUnitarioRepassado ?? loteData.valorUnitario ?? 0);
      const dosesFrascoExplicito = Number(loteData.dosesPorFrasco) || 1;
      loteValor = valorFrascoExplicito / dosesFrascoExplicito;

    } else if (medCatIdFinal && !isCliente) {
      // Auto-seleciona o melhor lote disponível (FEFO — primeiro a vencer primeiro)
      const empresaId = req.empresaId ?? null;
      const agora     = new Date();
      const params    = empresaId
        ? [medCatIdFinal, qtdFinal, agora, empresaId]
        : [medCatIdFinal, qtdFinal, agora];
      const empresaFilter = empresaId
        ? 'AND (empresa_id = $4 OR empresa_id IS NULL)'
        : '';

      const loteRows = await prisma.$queryRawUnsafe(
        `SELECT id, lote, qtd_disponivel AS "qtdDisponivel", qtd_total AS "qtdTotal",
                doses_por_frasco AS "dosesPorFrasco",
                COALESCE(valor_unitario_repassado, valor_unitario, 0)::float AS "valorBruto"
         FROM schs2vet.tb_lotes_vacina
         WHERE medicamento_cat_id = $1
           AND ativo = true
           AND qtd_disponivel >= $2
           AND (validade IS NULL OR validade >= $3)
           ${empresaFilter}
         ORDER BY validade ASC NULLS LAST
         LIMIT 1`,
        ...params
      );

      if (loteRows.length > 0) {
        const loteAuto     = loteRows[0];
        loteIdFinal        = Number(loteAuto.id);
        loteNumFinal       = loteAuto.lote ?? loteNumFinal;
        const dosesFrasco  = Number(loteAuto.dosesPorFrasco) || 1;
        loteValor          = Number(loteAuto.valorBruto) / dosesFrasco;
        // Débito do lote só na EXECUÇÃO (plantão) — aqui apenas fixa o lote sugerido.
      }
    }

    const criada = await prisma.vacinaClinica.create({
      data: {
        animalId:     Number(animalId),
        veterinarioId,
        vacinaId:     vacinaId ? Number(vacinaId) : null,
        loteId:       loteIdFinal,
        evolucaoId:   evolucaoId ? Number(evolucaoId) : null,
        nome:         nomeVacina.trim(),
        fabricante:   fabricanteVacina?.trim() || null,
        lote:         loteNumFinal?.trim() || null,
        dose:         dose?.trim() || null,
        via:          viaFinal?.trim() || null,
        dataAplicacao: dataAplicacao ? new Date(dataAplicacao) : new Date(),
        dataReforco:  dataReforco ? new Date(dataReforco) : null,
        observacao:   observacao?.trim() || null,
      },
      include: INCLUDE_VACINA,
    });

    // Salva campos adicionados via migration (fora do client gerado) usando raw SQL
    const formaSnapshot = await formaDoProduto(prisma, medCatIdFinal);
    if (await temColunaFormaVacina(prisma)) {
      await prisma.$executeRawUnsafe(
        `UPDATE schs2vet."tb_vacinas_clinicas" SET forma_calculo = $2 WHERE id = $1`,
        criada.id, formaSnapshot,
      ).catch(() => {});
    }
    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet."tb_vacinas_clinicas"
       SET "medicamento_cat_id" = $1,
           numero              = $2,
           tipo_atendimento    = 'VC',
           quantidade          = $3,
           valor               = $4,
           cliente             = $5,
           aplicada_pelo_proprietario = $6
       WHERE id = $7`,
      medCatIdFinal ?? null,
      numero,
      qtdFinal,
      valorFinal,
      isCliente,
      isAplicadaProp,
      criada.id
    );

    // NÃO lança na fatura nem debita estoque aqui: a vacina nasce SALVA. O débito do
    // lote e o lançamento na fatura acontecem na EXECUÇÃO (tela de Execução de Prescrição),
    // mesma lógica da prescrição. Ver `finalizar` (SALVA→FINALIZADA) e `executar`.
    void loteValor; // valor de referência calculado; usado de fato na execução

    res.status(201).json({ dados: criada });
  } catch (err) {
    console.error('registrar vacina:', err);
    res.status(500).json({ error: 'Erro ao registrar vacina' });
  }
}

// PUT /clinica/vacinas/:id — altera um registro ainda SALVA (antes de finalizar).
// Mesma autoria de editar/finalizar/excluir (`podeOperarRegistro`).
//
// 🔴 ALTERÁVEL ENQUANTO A DOSE NÃO FOI APLICADA (2026-09-23) — vale para SALVA **e**
// FINALIZADA. Antes só a SALVA era editável, "porque a partir da finalização o registro
// pode ter fatura/estoque envolvidos". O que a FINALIZADA tem é uma RESERVA, não uma
// baixa: o débito e a cobrança só acontecem em `executar`. Na prática, corrigir a dose
// de uma vacina que já estava na fila do plantão exigia cancelar e registrar de novo —
// e o cancelamento pede justificativa e some do histórico útil.
//
// ⚠️ EXECUTADA e CANCELADA continuam fechadas: ali a dose foi aplicada (ou o registro
// desfeito), e existe fatura e baixa de estoque que não podem ser reescritas por baixo.
//
// ⚠️ Alterar uma FINALIZADA REFAZ o destino dela pela MATRIZ "quem FORNECE × quem
// APLICA" (a mesma de `finalizar`) — não basta gravar os campos:
//   • a RESERVA antiga sai sempre (a vacina, a quantidade ou o quadrante podem ter
//     mudado) e é recriada quando a dose segue indo ao plantão;
//   • marcar "aplicada pelo proprietário" tira a dose do plantão: ela é debitada,
//     faturada e agendada AQUI, e o status vai para EXECUTADA — é a única oportunidade
//     de cobrá-la, exatamente como em `finalizar`;
//   • marcar "fornecida pelo cliente" libera a reserva sem débito nem cobrança.
// A tela de Execução de Prescrição lê ao vivo (`para-execucao`), então acompanha sozinha.
async function atualizar(req, res) {
  try {
    const { id } = req.params;
    const vacina = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) } });
    if (!vacina || !vacina.ativo) return res.status(404).json({ error: 'Registro não encontrado' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a vacina não é
    // alterada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, vacina.animalId)) return;

    if (!podeOperarRegistro(req, vacina.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar vacinas que você registrou.' });
    }

    const infoRows = await prisma.$queryRawUnsafe(
      `SELECT status, quantidade, valor::float AS valor, cliente,
              medicamento_cat_id AS "medicamentoCatId",
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    const infoAntes = infoRows[0] ?? {};
    // Enquanto a dose NÃO foi aplicada, o registro é corrigível — ver a nota da função.
    if (!STATUS_ALTERAVEIS.includes(infoAntes.status)) {
      return res.status(400).json({
        error: 'Só é possível alterar vacinas que ainda não foram aplicadas.',
        code:  'VACINA_JA_APLICADA',
      });
    }
    const eraFinalizada = infoAntes.status === 'FINALIZADA';

    const {
      medicamentoCatId, loteId, dose, via, dataAplicacao, observacao,
      quantidade, cliente: clienteRaw, aplicadaPeloProprietario: aplicadaPropRaw,
    } = req.body;

    const isCliente      = clienteRaw === true || clienteRaw === 'true';
    const isAplicadaProp = aplicadaPropRaw === true || aplicadaPropRaw === 'true';

    let nomeVacina    = vacina.nome;
    const medCatIdFinal = medicamentoCatId != null && medicamentoCatId !== '' ? Number(medicamentoCatId) : null;
    if (medCatIdFinal) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT nome FROM schs2vet.tb_medicamentos WHERE id = $1 LIMIT 1`, medCatIdFinal,
      );
      if (rows.length > 0) nomeVacina = rows[0].nome;
    }
    if (!nomeVacina?.trim()) return res.status(400).json({ error: 'Vacina é obrigatória' });

    const qtdFinal = dosagemDaVacina(quantidade);

    let loteNumFinal = null;
    const loteIdFinal = loteId ? Number(loteId) : null;
    if (loteIdFinal) {
      const loteData = await prisma.loteVacina.findUnique({ where: { id: loteIdFinal } });
      if (!loteData) return res.status(404).json({ error: 'Lote não encontrado' });
      if (!isCliente) {
        // 🔴 SALDO NÃO RECUSA O REGISTRO DA VACINA (2026-09-23) — aqui havia um
        // 400 'Lote sem saldo disponível'. Mesma decisão já tomada para a prescrição
        // em 2026-09-23 (`__tests__/execucaoSemTravas.test.js`): estoque é CONTROLE,
        // não autorização clínica. A dose foi (ou será) aplicada na baia de qualquer
        // jeito; recusar o registro não devolve o frasco — só apaga o rastro (fatura,
        // histórico, baixa, conta a pagar) e pune a clínica que mantém o estoque em dia,
        // porque quem não cadastra lote nenhum nunca foi barrado.
        // ⚠️ A BAIXA continua acontecendo, e nunca gera saldo negativo: `executar` →
        // `darBaixaEFaturar` debita o que HOUVER, em FEFO. O que saiu foi o BLOQUEIO.
        // ⚠️ A VALIDADE segue barrando, logo abaixo, e de propósito: "acabou o saldo"
        // e "o frasco está vencido" são perguntas diferentes — a segunda é segurança do
        // paciente, não controle de inventário.
        if (loteData.validade && new Date(loteData.validade) < new Date()) {
          return res.status(400).json({ error: `Lote ${loteData.lote} está vencido (validade: ${new Date(loteData.validade).toLocaleDateString('pt-BR')}). Selecione um lote dentro da validade.` });
        }
      }
      loteNumFinal = loteData.lote;
    }

    const doseNova = dose?.trim() || null;
    const viaNova  = via?.trim() || null;

    // Só quem pode sair do plantão nesta alteração precisa do dono (fatura) e do nome
    // do paciente (conta a pagar) — ler sempre seria um SELECT por edição de campo.
    const empresaIdEfetivo = req.empresaId ?? null;
    const agora = new Date();
    const animal = eraFinalizada
      ? await prisma.animal.findUnique({ where: { id: vacina.animalId }, select: { userId: true, nome: true } })
      : null;

    const atualizada = await prisma.$transaction(async (tx) => {
      const upd = await tx.vacinaClinica.update({
        where: { id: vacina.id },
        data: {
          loteId:        loteIdFinal,
          nome:          nomeVacina.trim(),
          lote:          loteNumFinal?.trim() || null,
          dose:          doseNova,
          via:           viaNova,
          dataAplicacao: dataAplicacao ? new Date(dataAplicacao) : vacina.dataAplicacao,
          observacao:    observacao?.trim() || null,
        },
        include: INCLUDE_VACINA,
      });

      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas
         SET medicamento_cat_id = $1, quantidade = $2, cliente = $3, aplicada_pelo_proprietario = $4
         WHERE id = $5`,
        medCatIdFinal, qtdFinal, isCliente, isAplicadaProp, vacina.id,
      );

      // 🔴 A FINALIZADA REFAZ O DESTINO PELA MATRIZ — ver a nota da função. É o MESMO
      // encadeamento de `finalizar`, e de propósito: duas leituras diferentes da matriz
      // fariam a dose corrigida ser cobrada por um critério e a original por outro.
      if (eraFinalizada) {
        // A reserva antiga sai SEMPRE: mudou a vacina, a quantidade ou o quadrante, e
        // uma reserva do estado anterior seguraria lote que não é mais o desta dose.
        await tx.$executeRawUnsafe(
          `DELETE FROM schs2vet.tb_reservas_estoque_vacina WHERE "vacinaClinicaId" = $1`, vacina.id,
        );

        // Quadrante "clínica FORNECE × proprietário APLICA": nunca chega ao plantão, e
        // esta é a única chance de cobrar. Debita, fatura e agenda o reforço agora.
        const cobrarAgora = isAplicadaProp && !isCliente;
        if (cobrarAgora) {
          // `origemJaFaturada`, não a FK: a linha da fatura é COMPARTILHADA (2026-09-17)
          // e pela FK uma segunda vacina na mesma linha pareceria nunca cobrada.
          const jaFaturada = await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', vacina.id);
          if (!jaFaturada) {
            await darBaixaEFaturar(tx, {
              vacina: upd,
              // `valor: null` de propósito: o preço volta a sair do LOTE debitado agora,
              // e não do valor de referência gravado quando a vacina foi registrada com
              // outro produto. Passar o antigo cobraria o frasco errado.
              info: {
                ...infoAntes,
                valor:            null,
                quantidade:       qtdFinal,
                cliente:          isCliente,
                medicamentoCatId: medCatIdFinal,
              },
              qtd:           qtdFinal,
              veterinarioId: req.user.id,
              empresaIdEfetivo,
              agora,
              animal,
            });
            await agendarReforcos(tx, {
              vacina:        upd,
              dose:          doseNova,
              veterinarioId: req.user.id,
              empresaId:     empresaIdEfetivo,
              equipeId:      req.equipeId ?? null,
              aplicadaEm:    upd.dataAplicacao ?? agora,
            });
          }
        } else if (!isCliente) {
          // Segue indo ao plantão e sai do estoque da clínica → reserva de novo, agora
          // com a vacina e a quantidade corrigidas.
          await criarReservaVacina(tx, {
            vacinaId:         vacina.id,
            animalId:         vacina.animalId,
            medicamentoCatId: medCatIdFinal,
            quantidade:       qtdFinal,
            empresaId:        empresaIdEfetivo,
          });
        }
        // Fornecida pelo cliente e aplicada pela clínica: sem reserva (nada sai do
        // estoque) e SEGUE no plantão — é lá que a aplicação é registrada.

        // Mesma regra de `finalizar`: quem aplica em casa já nasce no último passo, em
        // vez de ficar esperando para sempre uma execução que não vai acontecer.
        await tx.$executeRawUnsafe(
          `UPDATE schs2vet.tb_vacinas_clinicas SET status = $2 WHERE id = $1`,
          vacina.id, isAplicadaProp ? 'EXECUTADA' : 'FINALIZADA',
        );
      }

      await registrarAlteracao(tx, req, {
        entidade:       'VACINA',
        entidadeId:     vacina.id,
        animalId:       vacina.animalId,
        donoAnteriorId: vacina.veterinarioId,
        donoAtualId:    vacina.veterinarioId,
        campos: {
          nome:       { de: vacina.nome, para: nomeVacina.trim() },
          dose:       { de: vacina.dose, para: doseNova },
          via:        { de: vacina.via,  para: viaNova },
          quantidade: { de: infoAntes.quantidade, para: qtdFinal },
          // Os dois checkboxes e o status entram no rastro porque, depois que a
          // FINALIZADA passou a ser editável, alterá-los MOVE a dose de quadrante:
          // pode tirá-la do plantão, debitar o lote e lançar a cobrança na hora.
          // Sem isto o ledger mostraria a vacina cobrada sem dizer o que mudou.
          cliente:                  { de: infoAntes.cliente, para: isCliente },
          aplicadaPeloProprietario: { de: infoAntes.aplicadaPeloProprietario, para: isAplicadaProp },
          status: { de: infoAntes.status, para: eraFinalizada ? (isAplicadaProp ? 'EXECUTADA' : 'FINALIZADA') : infoAntes.status },
        },
      });

      return upd;
    });

    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
              quantidade, valor::float AS valor, cliente, status,
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
              motivo_inativacao AS "motivoInativacao",
              forma_calculo AS "formaCalculo",
              medicamento_cat_id AS "medicamentoCatId"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      vacina.id,
    );
    res.json({ dados: { ...atualizada, ...(extras[0] ?? {}) } });
  } catch (err) {
    console.error('atualizar vacina:', err);
    res.status(500).json({ error: 'Erro ao alterar vacina' });
  }
}

async function obterPorId(req, res) {
  try {
    const { id } = req.params;
    const vacina = await prisma.vacinaClinica.findUnique({
      where:   { id: Number(id) },
      include: INCLUDE_VACINA,
    });
    if (!vacina) return res.status(404).json({ error: 'Registro não encontrado' });

    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
              quantidade, valor::float AS valor, cliente, status,
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
              motivo_inativacao AS "motivoInativacao",
              forma_calculo AS "formaCalculo",
              medicamento_cat_id AS "medicamentoCatId"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    return res.json({ dados: { ...vacina, ...(extras[0] ?? {}) } });
  } catch (err) {
    console.error('obterPorId vacina:', err);
    res.status(500).json({ error: 'Erro ao obter registro' });
  }
}

// PATCH /clinica/vacinas/:id/finalizar — transita SALVA -> FINALIZADA.
//
// MATRIZ "quem FORNECE × quem APLICA" (a mesma da prescrição — CLAUDE.md):
//
//   fornecida p/ Cliente | aplicada p/ Proprietário | Execução de Prescrição | Fatura
//           não          |           não            |         ENTRA          | na EXECUÇÃO
//           SIM          |           não            |         ENTRA          | nunca
//           não          |           SIM            |        não vai         | AQUI
//           SIM          |           SIM            |        não vai         | nunca
//
// Ou seja: só entra aqui a dose que a clínica FORNECE e o proprietário APLICA. Ela
// nunca chega ao plantão, então esta é a única oportunidade de cobrá-la — e o frasco
// saiu do estoque de verdade, então o lote é debitado junto (é por isso que a vacina
// NÃO tem o buraco de "valor 0" que a prescrição tem no mesmo quadrante: lá o item
// aplicado pelo proprietário não debita lote, e sem lote não há preço).
async function finalizar(req, res) {
  try {
    const { id } = req.params;
    const veterinarioId = req.user.id;

    const vacina = await prisma.vacinaClinica.findUnique({
      where: { id: Number(id) }, include: INCLUDE_VACINA,
    });
    if (!vacina || !vacina.ativo) return res.status(404).json({ error: 'Registro não encontrado' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a vacina não é
    // finalizada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, vacina.animalId)) return;

    // Autoria via RBAC (nível efetivo em atendimento.vacinas.finalizar):
    // PROPRIO → só finaliza o que registrou; EQUIPE/FULL → qualquer da equipe.
    if (!podeOperarRegistro(req, vacina.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar vacinas que você registrou.' });
    }

    // status e as duas flags vivem fora do client gerado (raw SQL, mesmo padrão)
    const infoRows = await prisma.$queryRawUnsafe(
      `SELECT status, quantidade, valor::float AS valor, cliente, numero,
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
              tipo_atendimento AS "tipoAtendimento", medicamento_cat_id AS "medicamentoCatId"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    const info = infoRows[0] ?? {};
    if (info.status === 'FINALIZADA') {
      return res.status(400).json({ error: 'Vacina já está finalizada.' });
    }

    const isCliente    = info.cliente === true;
    const aplicaDono   = info.aplicadaPeloProprietario === true;
    // Cobra na finalização SÓ o quadrante "clínica fornece × proprietário aplica".
    const cobrarAgora  = aplicaDono && !isCliente;
    // ⚠️ `origemJaFaturada`, não `findFirst` pela FK: a linha da fatura passou a ser
    // COMPARTILHADA (2026-09-17) e a FK guarda só a PRIMEIRA vacina que caiu nela —
    // pela FK, a segunda pareceria nunca cobrada e seria cobrada de novo.
    const jaFaturada   = cobrarAgora
      ? await itemOrigens.origemJaFaturada(prisma, 'vacinaClinicaId', vacina.id)
      : false;

    const empresaIdEfetivo = req.empresaId ?? null;
    const agora = new Date();

    // 🔴 EMPRESA SEM ETAPA DE EXECUÇÃO (Configurações, 2026-09-24): a dose que a
    // CLÍNICA aplica não vai para o plantão — é debitada, cobrada e tem o reforço
    // agendado AQUI, e a vacina já nasce EXECUTADA. Ver `executarNaFinalizacao`.
    // ⚠️ A aplicada pelo proprietário segue a matriz de sempre (ramo abaixo).
    if (!aplicaDono && await etapaExecucao.execucaoDispensada(prisma, empresaIdEfetivo)) {
      await prisma.$transaction(async (tx) => {
        await executarNaFinalizacao(tx, vacina.id, {
          veterinarioId, empresaId: empresaIdEfetivo, equipeId: req.equipeId ?? null, agora, req,
        });
      });
      const executada = await prisma.vacinaClinica.findUnique({
        where: { id: Number(id) }, include: INCLUDE_VACINA,
      });
      const extrasExec = await prisma.$queryRawUnsafe(
        `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
                quantidade, valor::float AS valor, cliente, status,
                aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
                motivo_inativacao AS "motivoInativacao"
         FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
        Number(id)
      );
      return res.json({ dados: { ...executada, ...(extrasExec[0] ?? {}) } });
    }

    let evolucao = null;
    let animal   = null;
    if (cobrarAgora && !jaFaturada) {
      if (vacina.evolucaoId) {
        evolucao = await prisma.evolucaoClinica.findUnique({
          where: { id: vacina.evolucaoId }, select: { numero: true, tipoAtendimento: true },
        });
      }
      animal = await prisma.animal.findUnique({ where: { id: vacina.animalId }, select: { userId: true } });
    }

    await prisma.$transaction(async (tx) => {
      if (cobrarAgora && !jaFaturada) {
        await darBaixaEFaturar(tx, {
          vacina, info,
          qtd: dosagemDaVacina(info.quantidade),
          veterinarioId, empresaIdEfetivo, agora, evolucao, animal,
        });
        // A dose foi entregue ao dono e não passará pelo plantão: os reforços do
        // esquema periódico precisam ser agendados aqui, senão nunca seriam.
        await agendarReforcos(tx, {
          vacina,
          dose:          vacina.dose,
          veterinarioId,
          empresaId:     empresaIdEfetivo,
          equipeId:      req.equipeId ?? null,
          aplicadaEm:    vacina.dataAplicacao ?? agora,
        });
      } else if (!isCliente) {
        // Vai para o plantão (Execução de Prescrição) — RESERVA agora, mesma lógica do
        // medicamento (PrescricaoGrupoController): o débito de verdade só acontece na
        // EXECUÇÃO (`executar` → `darBaixaEFaturar` → `consumirReservaVacina`). Sem
        // isto o lote só era "tocado" na execução, sem nenhum rastro entre finalizar e
        // executar — duas vacinas concorrentes podiam disputar o mesmo lote sem que
        // nenhuma soubesse da outra.
        await criarReservaVacina(tx, {
          vacinaId:         vacina.id,
          animalId:         vacina.animalId,
          medicamentoCatId: info.medicamentoCatId,
          quantidade:       dosagemDaVacina(info.quantidade),
          empresaId:        empresaIdEfetivo,
        });
      }

      // 🔴 VACINA APLICADA PELO PROPRIETÁRIO JÁ ENCERRA NO ÚLTIMO PASSO.
      // Ela nunca chega ao plantão: `listarParaExecucao` filtra
      // `aplicadaPeloProprietario !== true`. Parada em FINALIZADA ("Em Execução"), o
      // registro ficaria para sempre esperando uma aplicação que, por construção, não
      // vai acontecer — e a dose já foi debitada e cobrada AQUI, na finalização
      // (quadrante "clínica fornece × proprietário aplica"), então não falta nada.
      // Mesma decisão da prescrição (`lib/prescricaoProprietario.js`): o valor gravado
      // é o `EXECUTADA` que já existe, e não um status novo — quem acrescenta o
      // "pelo Proprietário" é a EXIBIÇÃO, a partir da flag. Status novo faria os
      // filtros que só conhecem os quatro atuais ignorarem o registro em silêncio.
      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas SET status = $2 WHERE id = $1`,
        Number(id),
        aplicaDono ? 'EXECUTADA' : 'FINALIZADA',
      );
    });

    const atualizada = await prisma.vacinaClinica.findUnique({
      where: { id: Number(id) }, include: INCLUDE_VACINA,
    });
    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
              quantidade, valor::float AS valor, cliente, status,
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
              motivo_inativacao AS "motivoInativacao"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    res.json({ dados: { ...atualizada, ...(extras[0] ?? {}) } });
  } catch (err) {
    console.error('finalizar vacina:', err);
    res.status(500).json({ error: 'Erro ao finalizar vacina' });
  }
}

// GET /clinica/vacinas/para-execucao — vacinas FINALIZADAS aguardando aplicação, para
// aparecer na tela de Execução de Prescrição (plantão). Escopo por empresa (multi-clínica).
async function listarParaExecucao(req, res) {
  try {
    const { animalId } = req.query;

    const where = {
      ativo:  true,
      // EXCLUSÃO LÓGICA (lib/visibilidade.js) — o `animal: { ativo: true }` já estava
      // aqui; `ANIMAL_VISIVEL` acrescenta o cliente, para que inativar o proprietário
      // também tire as vacinas dos animais dele da fila de aplicação.
      animal: ANIMAL_VISIVEL,
      AND:    [escopoFilhoEvolucaoWhere(req)],
    };

    // TENANCY DO PLANTÃO — a fila de aplicação é da EMPRESA ATIVA e de mais ninguém.
    //
    // ⚠️ `escopoFilhoEvolucaoWhere` NÃO basta aqui: para o GESTOR ele devolve `{}`
    // (bypass de `semEscopoClinico`, CLAUDE.md §35), e sem filtro nenhum a tela lista
    // vacinas de TODAS as clínicas. Aquele bypass existe para o gestor enxergar o que
    // a equipe dele registrou sem depender da resolução de empresaId — o que não pode
    // é atravessar a fronteira da empresa. Vacina não tem `empresaId` próprio: a
    // tenancy vem da EVOLUÇÃO do atendimento e, no avulso, da empresa do autor
    // (mesmo critério do escopo clínico, sem a saída "é minha, então vejo").
    if (req.empresaId) {
      const empresaId = Number(req.empresaId);
      where.AND.push({
        OR: [
          { evolucao: { empresaId } },
          { evolucaoId: null, veterinario: { membrosEquipe: { some: { equipe: { empresaId } } } } },
        ],
      });
    }
    if (animalId) where.animalId = Number(animalId);

    const vacinas = await prisma.vacinaClinica.findMany({
      where,
      include: {
        ...INCLUDE_VACINA,
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true, baia: true,
            // Mesmos campos do select da PRESCRIÇÃO para a fila do plantão: a linha sob o
            // paciente é "Local • Peso • Idade" e as duas listas usam o MESMO componente.
            local: true, dataNascimento: true, idadeAnos: true,
            localizacao: { select: { nome: true } },
            especie: { select: { nome: true } },
            raca:    { select: { nome: true } },
          },
        },
      },
      orderBy: { dataAplicacao: 'asc' },
    });
    if (vacinas.length === 0) return res.json({ dados: [] });

    // status vive fora do client gerado — enriquece via raw SQL e filtra as FINALIZADAS
    const ids = vacinas.map((v) => v.id);
    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento", quantidade,
              valor::float AS valor, cliente, status, forma_calculo AS "formaCalculo",
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = ANY($1::int[])`,
      ids
    );
    const extrasMap = Object.fromEntries(extras.map((e) => [e.id, e]));

    const dados = vacinas
      .map((v) => ({ ...v, ...extrasMap[v.id] }))
      // Aplicada pelo PROPRIETÁRIO não vai ao plantão: quem aplica é o dono, em casa.
      // Ela já foi cobrada (e o lote debitado) na finalização — ver a matriz em `finalizar`.
      .filter((v) => v.status === 'FINALIZADA' && v.aplicadaPeloProprietario !== true);

    // 🔴 O PACIENTE INATIVO CONTINUA SENDO DEVOLVIDO — sumir com ele daqui
    // esconderia da equipe que aquela vacina existe e ficou parada.
    // ⚠️ Quem decide ONDE ele aparece é a TELA, e mudou em 2026-09-05: a vacina de
    // paciente inativo saiu da fila "a aplicar" e passou a sair no HISTÓRICO, na aba
    // "Paciente inativo" (ExecucaoPrescricao.tsx#vacinasInativasBase).
    // NÃO filtrar aqui: sem estas linhas a aba nova nasceria vazia.
    // O prontuário segue congelado — `executar`/`cancelar` respondem 400
    // (lib/animalInativo.js) — e a tela não renderiza esses botões (28-d).
    // ⚠️ `animalInativo` é lido por SQL cru (`lerInativosEmLote`), NUNCA pelo `where`
    // do Prisma: `Animal.inativo` é lida assim em todo o projeto porque o client pode
    // não estar regenerado (CLAUDE.md §11), e `where` com campo desconhecido derruba a
    // fila inteira com "Unknown argument".
    const inativos = await lerInativosEmLote(dados.map((v) => v.animalId));
    const fila = dados.map((v) => ({
      ...v,
      animalInativo: !!inativos.get(Number(v.animalId))?.inativo,
    }));

    res.json({ dados: fila });
  } catch (err) {
    console.error('listarParaExecucao vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas para execução' });
  }
}

// Data 'YYYY-MM-DD' no fuso LOCAL do servidor — mesmo critério de
// PrescricaoGrupoController#hojeLocalStr (nunca `toISOString()`, que já é o dia
// seguinte a partir das 21h em Brasília).
function hojeLocalStrVacina() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// GET /clinica/vacinas/executadas-hoje — vacinas que passaram por EXECUTADA na data
// informada (`?data=YYYY-MM-DD`, default hoje), para a faixa "Histórico" da tela de
// Execução de Prescrição. Aceita `data` pela mesma razão que `listarParaExecucao` das
// prescrições já aceita: a tela navega por dia (calendário) e, sem o parâmetro, a
// vacina executada num dia anterior nunca aparecia ao voltar para aquele dia — a busca
// ficava travada em "hoje" (`new Date()`) não importa a data selecionada no front.
// Mesma seção que já mostra medicamento/procedimento executado; a vacina só faltava
// porque `VacinaClinica` não tem coluna própria de "quando executou" — aqui reusa o
// registro de auditoria `EXECUCAO/VACINA` gravado em `executar()` como a fonte do
// timestamp.
async function listarExecutadasHoje(req, res) {
  try {
    const dataParam = req.query.data;
    const dataStr = (typeof dataParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataParam))
      ? dataParam
      : hojeLocalStrVacina();
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    const inicioDia = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
    const fimDia     = new Date(ano, mes - 1, dia + 1, 0, 0, 0, 0);

    // 🔴 EXECUÇÃO **E** CANCELAMENTO (2026-09-04). Antes só `EXECUCAO` era lido, e a
    // vacina cancelada não aparecia em lugar nenhum do Histórico — nem na aba
    // "Cancelado", que ficava sempre vazia para vacina. Medicamento e procedimento já
    // apareciam ali; a vacina era a única sem rastro do cancelamento do dia.
    // ⚠️ O AuditLog é a ÚNICA fonte do QUANDO: `VacinaClinica` não tem coluna de
    // "executada em" nem de "cancelada em" — o ciclo dela é só o campo `status`.
    // Por isso o `timestamp` vem daqui e é devolvido como `executadoEm`, que é o que
    // permite ao Histórico escrever "Executada em 04/09 às 20:08" (a linha da vacina
    // dizia só "Executada", sem dia nem hora, ao lado das outras duas que diziam).
    const logs = await prisma.auditLog.findMany({
      where: {
        categoria: { in: ['EXECUCAO', 'CANCELAMENTO'] },
        entidade:  'VACINA',
        timestamp: { gte: inicioDia, lt: fimDia },
      },
      select: { entidadeId: true, categoria: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });
    const ids = [...new Set(logs.map((l) => l.entidadeId).filter((v) => v != null))];
    if (ids.length === 0) return res.json({ dados: [] });

    // Quando houve os dois no mesmo dia (executada e depois cancelada), o
    // CANCELAMENTO é o estado final e é ele que a linha deve mostrar.
    const quando = {};
    for (const l of logs) {
      const atual = quando[l.entidadeId];
      if (!atual || (l.categoria === 'CANCELAMENTO' && atual.categoria !== 'CANCELAMENTO')) {
        quando[l.entidadeId] = { categoria: l.categoria, timestamp: l.timestamp };
      }
    }

    // ⚠️ SEM `ativo: true` e SEM `status: 'EXECUTADA'` no `where`: cancelar a vacina
    // faz `ativo: false` (exclusão lógica), então esses dois filtros eram justamente o
    // que escondia a cancelada. O recorte passou a ser feito abaixo, item a item.
    const vacinas = await prisma.vacinaClinica.findMany({
      where: { id: { in: ids } },
      include: {
        ...INCLUDE_VACINA,
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true, baia: true,
            local: true, dataNascimento: true, idadeAnos: true,
            localizacao: { select: { nome: true } },
            especie: { select: { nome: true } },
            raca:    { select: { nome: true } },
          },
        },
      },
      orderBy: { dataAplicacao: 'asc' },
    });
    if (vacinas.length === 0) return res.json({ dados: [] });

    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento", quantidade,
              valor::float AS valor, cliente, status, forma_calculo AS "formaCalculo",
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = ANY($1::int[])`,
      vacinas.map((v) => v.id),
    );
    const extrasMap = Object.fromEntries(extras.map((e) => [e.id, e]));

    // Recorte final: entra a vacina EXECUTADA que ainda está ativa, e a CANCELADA
    // naquele dia (que está inativa por definição). Fica de fora o registro que
    // apenas passou pelo log e não está em nenhum dos dois estados.
    const dados = vacinas
      .map((v) => {
        const extra = extrasMap[v.id] ?? {};
        const reg   = quando[v.id] ?? null;
        return {
          ...v,
          ...extra,
          cancelada:   reg?.categoria === 'CANCELAMENTO',
          executadoEm: reg?.timestamp ?? null,
        };
      })
      .filter((v) => (v.cancelada ? true : v.ativo && v.status === 'EXECUTADA'));

    res.json({ dados });
  } catch (err) {
    console.error('listarExecutadasHoje vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas executadas hoje' });
  }
}

// Reforço periódico → intervalo entre as doses, em MESES. Espelha INTERVALO_REFORCO_MESES
// do SubModuloVacina. Tipo de dose fora deste mapa não gera agendamento automático.
const INTERVALO_REFORCO_MESES = {
  'reforço mensal': 1,
  'reforco mensal': 1,
  'reforço anual':  12,
  'reforco anual':  12,
};

const intervaloDaDose = (dose) =>
  INTERVALO_REFORCO_MESES[String(dose ?? '').trim().toLowerCase()] ?? null;

/**
 * Agenda as doses SEGUINTES de um esquema de reforço periódico.
 *
 * 🔴 AGENDA UMA DOSE — a PRÓXIMA (2026-09-16). Antes agendava `quantidade - 1` de uma
 * vez, porque "Qtd Doses" declarava o tamanho da série. Esse campo virou a DOSAGEM
 * (Valor + Forma de Cálculo), então a série deixou de ser informada — e deduzi-la de
 * um volume em mL afirmaria um esquema de reforço que ninguém prescreveu. Agendada a
 * próxima, a execução dela agenda a seguinte, e assim por diante.
 *
 * Idempotente: se já existirem agendamentos de VACINA criados por esta mesma vacina
 * (mesma observação de rastreio), não duplica — reexecutar não enche a agenda.
 */
async function agendarReforcos(tx, { vacina, dose, veterinarioId, empresaId, equipeId, aplicadaEm }) {
  const meses = intervaloDaDose(dose);
  if (!meses) return 0;
  const restantes = 1;   // sempre a PRÓXIMA dose — ver a nota acima

  const marca = `[VC-${vacina.id}]`;   // rastreio: liga o agendamento à vacina de origem
  const jaExiste = await tx.agendamentoClinico.findFirst({
    where:  { animalId: vacina.animalId, tipo: 'VACINA', ativo: true, observacao: { contains: marca } },
    select: { id: true },
  });
  if (jaExiste) return 0;

  for (let i = 1; i <= restantes; i++) {
    const quando = new Date(aplicadaEm);
    // setMonth normaliza sozinho o estouro de mês (31/01 + 1 mês → 03/03); é o
    // comportamento aceitável para reforço, que não exige o mesmo dia exato.
    quando.setMonth(quando.getMonth() + meses * i);
    await tx.agendamentoClinico.create({
      data: {
        animalId:      vacina.animalId,
        tipo:          'VACINA',
        titulo:        `${vacina.nome} — ${i + 1}ª dose (${dose})`,
        dataHora:      quando,
        status:        'AGENDADO',
        veterinarioId: veterinarioId ?? null,
        criadoPorId:   veterinarioId ?? null,
        empresaId:     empresaId ?? null,
        equipeId:      equipeId ?? null,
        observacao:    `${marca} Agendado automaticamente na aplicação da 1ª dose.`,
      },
    });
  }
  return restantes;
}

// PATCH /clinica/vacinas/:id/executar — aplica a vacina no plantão: debita o lote
// (FEFO) e lança na fatura. Só FINALIZADA → EXECUTADA. Guarda contra registros legados
// que já foram faturados/debitados no antigo `registrar` (não duplica).
async function executar(req, res) {
  try {
    const { id } = req.params;
    const veterinarioId = req.user.id;

    const vacina = await prisma.vacinaClinica.findUnique({
      where: { id: Number(id) }, include: INCLUDE_VACINA,
    });
    if (!vacina || !vacina.ativo) return res.status(404).json({ error: 'Registro não encontrado' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a vacina não é
    // executada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, vacina.animalId)) return;

    const extras = await prisma.$queryRawUnsafe(
      `SELECT status, quantidade, valor::float AS valor, cliente, numero,
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
              tipo_atendimento AS "tipoAtendimento", medicamento_cat_id AS "medicamentoCatId"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    const info = extras[0] ?? {};
    if (info.status === 'EXECUTADA') return res.status(400).json({ error: 'Vacina já executada.' });
    if (info.status !== 'FINALIZADA') return res.status(400).json({ error: 'Apenas vacinas FINALIZADAS podem ser executadas.' });

    const qtd       = dosagemDaVacina(info.quantidade);
    const isCliente = info.cliente === true;
    const jaFaturada = await itemOrigens.origemJaFaturada(prisma, 'vacinaClinicaId', vacina.id);

    const empresaIdEfetivo = req.empresaId ?? null;
    const agora = new Date();
    let agendados = 0;   // nº de reforços agendados automaticamente (ver agendarReforcos)

    let evolucao = null;
    if (vacina.evolucaoId) {
      evolucao = await prisma.evolucaoClinica.findUnique({
        where: { id: vacina.evolucaoId }, select: { numero: true, tipoAtendimento: true },
      });
    }
    const animal = await prisma.animal.findUnique({ where: { id: vacina.animalId }, select: { userId: true } });

    await prisma.$transaction(async (tx) => {
      // Débito de estoque + fatura só quando NÃO for do cliente e ainda não faturada (legado).
      if (!isCliente && !jaFaturada) {
        await darBaixaEFaturar(tx, {
          vacina, info, qtd, veterinarioId, empresaIdEfetivo, agora, evolucao, animal,
        });
      }

      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas SET status = 'EXECUTADA' WHERE id = $1`, Number(id)
      );

      // Marca QUANDO a vacina foi executada — é o que permite a tela de Execução de
      // Prescrição achar "executadas hoje" para o Histórico (VacinaClinica não tem
      // coluna própria de execução; reusa o ledger da Auditoria, que já tem timestamp).
      await registrarAuditoria(tx, req, {
        categoria:  'EXECUCAO',
        entidade:   'VACINA',
        entidadeId: vacina.id,
        animalId:   vacina.animalId,
        detalhes:   `${vacina.nome}${vacina.dose ? ` — ${vacina.dose}` : ''}`,
      });

      // Esquema de reforço (mensal/anual): agenda a PRÓXIMA dose. Ver `agendarReforcos`.
      agendados = await agendarReforcos(tx, {
        vacina,
        dose:          vacina.dose,
        veterinarioId,
        empresaId:     empresaIdEfetivo,
        equipeId:      req.equipeId ?? null,
        aplicadaEm:    vacina.dataAplicacao ?? agora,
      });
    });

    const atualizada = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) }, include: INCLUDE_VACINA });
    const extras2 = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento", quantidade,
              valor::float AS valor, cliente, status, motivo_inativacao AS "motivoInativacao",
              aplicada_pelo_proprietario AS "aplicadaPeloProprietario"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    res.json({ dados: { ...atualizada, ...(extras2[0] ?? {}) }, reforcosAgendados: agendados });
  } catch (err) {
    console.error('executar vacina:', err);
    res.status(500).json({ error: 'Erro ao executar vacina' });
  }
}

/**
 * 🔴 EMPRESA SEM ETAPA DE EXECUÇÃO — a vacina que a CLÍNICA aplica é "executada" na
 * própria finalização: débito do lote (FEFO), linha de fatura, conta a pagar do
 * fornecedor, reforço agendado e status EXECUTADA. É o que `executar` faz no plantão,
 * sem o plantão. Ver lib/etapaExecucaoPrescricao.js.
 *
 * DOIS chamadores: `finalizar` e a cascata da finalização do ATENDIMENTO
 * (lib/finalizacaoEvolucao.js), que promove a vacina SALVA sem passar por `finalizar` —
 * sem o segundo, a vacina fechada junto do atendimento ficaria FINALIZADA esperando um
 * plantão que a clínica não tem, e nunca seria cobrada.
 *
 * ⚠️ Pula a aplicada pelo proprietário (matriz de sempre, tratada em `finalizar`) e a
 * que já passou adiante (EXECUTADA/CANCELADA). Fornecida pelo cliente: sem débito nem
 * cobrança, mas a dose ACONTECEU — status e reforço seguem.
 * ⚠️ IDEMPOTENTE: `origemJaFaturada` impede a segunda cobrança.
 * ⚠️ `req` é opcional (o cron da cascata não tem): sem ele não há linha de auditoria,
 * que é só o que alimenta o Histórico do plantão.
 */
async function executarNaFinalizacao(tx, vacinaId, { veterinarioId, empresaId = null, equipeId = null, agora = new Date(), req = null } = {}) {
  const vacina = await tx.vacinaClinica.findUnique({ where: { id: Number(vacinaId) }, include: INCLUDE_VACINA });
  if (!vacina || !vacina.ativo) return false;

  const rows = await tx.$queryRawUnsafe(
    `SELECT status, quantidade, valor::float AS valor, cliente, numero,
            aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
            tipo_atendimento AS "tipoAtendimento", medicamento_cat_id AS "medicamentoCatId"
     FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
    Number(vacinaId)
  );
  const info = rows?.[0] ?? {};
  if (info.aplicadaPeloProprietario === true) return false;
  if (info.status === 'EXECUTADA' || info.status === 'CANCELADA') return false;

  const qtd        = dosagemDaVacina(info.quantidade);
  const isCliente  = info.cliente === true;
  const jaFaturada = await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', vacina.id);
  const animal     = await tx.animal.findUnique({
    where: { id: vacina.animalId }, select: { userId: true, nome: true },
  });

  if (!isCliente && !jaFaturada) {
    await darBaixaEFaturar(tx, {
      vacina, info, qtd, veterinarioId, empresaIdEfetivo: empresaId, agora, animal,
    });
  }

  await tx.$executeRawUnsafe(
    `UPDATE schs2vet.tb_vacinas_clinicas SET status = 'EXECUTADA' WHERE id = $1`, Number(vacinaId)
  );

  if (req) {
    await registrarAuditoria(tx, req, {
      categoria:  'EXECUCAO',
      entidade:   'VACINA',
      entidadeId: vacina.id,
      animalId:   vacina.animalId,
      detalhes:   `${vacina.nome}${vacina.dose ? ` — ${vacina.dose}` : ''} (encerrada na finalização — empresa sem etapa de Execução de Prescrição)`,
    });
  }

  await agendarReforcos(tx, {
    vacina,
    dose:       vacina.dose,
    veterinarioId,
    empresaId,
    equipeId,
    aplicadaEm: vacina.dataAplicacao ?? agora,
  });
  return true;
}

/**
 * Debita o lote (FEFO quando o vinculado não serve) e lança o FaturaItem da vacina.
 *
 * Extraído de `executar` porque a EXECUÇÃO deixou de ser o único momento em que isso
 * acontece: a vacina que o PROPRIETÁRIO aplica em casa nunca chega ao plantão, e a
 * clínica ainda assim entregou a dose — para ela, quem chama é o `finalizar`.
 * Chamar sempre dentro de uma transaction (recebe o `tx`).
 */
// Retrato dos LOTES em estoque (preço POR DOSE e doses disponíveis) do mesmo
// medicamento, na empresa. É daqui que saem MAIOR_VALOR e CUSTO_MEDIO — lido ANTES
// da baixa, porque a forma de cobrança olha o que a clínica TEM no momento em que
// cobra. Ver lib/formaCobrancaEstoque.js.
async function entradasCobrancaVacina(tx, medicamentoCatId, empresaId) {
  if (!medicamentoCatId) return [];
  try {
    const params = empresaId ? [Number(medicamentoCatId), Number(empresaId)] : [Number(medicamentoCatId)];
    const filtro = empresaId ? 'AND (empresa_id = $2 OR empresa_id IS NULL)' : '';
    const rows = await tx.$queryRawUnsafe(
      `SELECT COALESCE(valor_unitario_repassado, valor_unitario, 0)::float AS "valorBruto",
              doses_por_frasco AS "dosesPorFrasco",
              qtd_disponivel   AS "qtdDisponivel"
         FROM schs2vet.tb_lotes_vacina
        WHERE medicamento_cat_id = $1 AND ativo = true AND qtd_disponivel > 0 ${filtro}`,
      ...params,
    );
    return (rows ?? []).map(r => ({
      preco: Number(r.valorBruto) / (Number(r.dosesPorFrasco) || 1),
      qtd:   Number(r.qtdDisponivel),
    }));
  } catch {
    return []; // sem retrato, `precoDeVenda` cai no preço do lote debitado
  }
}

async function darBaixaEFaturar(tx, { vacina, info, qtd, veterinarioId, empresaIdEfetivo, agora, animal }) {
  let loteIdFinal = vacina.loteId ?? null;
  let loteValor   = 0;

  // Forma de cobrança + retrato do estoque, os DOIS antes de qualquer baixa.
  const cfgCobranca = await formaCobranca.lerForma(tx, empresaIdEfetivo);
  const entradas    = await entradasCobrancaVacina(tx, info.medicamentoCatId, empresaIdEfetivo);

  // Reserva feita ao FINALIZAR (fila do plantão) — consome ela primeiro: é o débito de
  // VERDADE, já apurado por FEFO no momento em que o pedido entrou na fila, podendo
  // estar espalhado por mais de um lote. Sem reserva (vacina aplicada pelo proprietário
  // — debita direto aqui, na finalização, nunca reserva — ou registro legado anterior a
  // esta migration), cai no lookup direto de sempre.
  const consumida = await consumirReservaVacina(tx, vacina.id);
  if (consumida) {
    loteIdFinal = consumida.loteId;
    loteValor   = consumida.valorPorDose;
    if (loteIdFinal != null && loteIdFinal !== vacina.loteId) {
      await tx.vacinaClinica.update({ where: { id: vacina.id }, data: { loteId: loteIdFinal, lote: consumida.loteNome ?? vacina.lote } });
    }
  } else {
    let loteData = loteIdFinal ? await tx.loteVacina.findUnique({ where: { id: loteIdFinal } }) : null;
    const loteInvalido = !loteData
      || loteData.qtdDisponivel < qtd
      || (loteData.validade && new Date(loteData.validade) < agora);

    // Lote vinculado inválido/insuficiente → tenta FEFO pelo medicamento
    if (loteInvalido && info.medicamentoCatId) {
      const params = empresaIdEfetivo
        ? [Number(info.medicamentoCatId), qtd, agora, empresaIdEfetivo]
        : [Number(info.medicamentoCatId), qtd, agora];
      const empresaFilter = empresaIdEfetivo ? 'AND (empresa_id = $4 OR empresa_id IS NULL)' : '';
      const loteRows = await tx.$queryRawUnsafe(
        `SELECT id, lote, doses_por_frasco AS "dosesPorFrasco",
                COALESCE(valor_unitario_repassado, valor_unitario, 0)::float AS "valorBruto"
         FROM schs2vet.tb_lotes_vacina
         WHERE medicamento_cat_id = $1 AND ativo = true AND qtd_disponivel >= $2
           AND (validade IS NULL OR validade >= $3) ${empresaFilter}
         ORDER BY validade ASC NULLS LAST LIMIT 1`,
        ...params
      );
      loteData = loteRows.length > 0
        ? { id: Number(loteRows[0].id), lote: loteRows[0].lote, dosesPorFrasco: loteRows[0].dosesPorFrasco, valorUnitario: loteRows[0].valorBruto, valorUnitarioRepassado: null }
        : null;
    } else if (loteInvalido) {
      loteData = null; // sem medicamentoCat p/ FEFO e lote vinculado inválido
    }

    if (loteData) {
      loteIdFinal = loteData.id;
      const valorFrasco = Number(loteData.valorUnitarioRepassado ?? loteData.valorUnitario ?? 0);
      const dosesFrasco = Number(loteData.dosesPorFrasco) || 1;
      loteValor = valorFrasco / dosesFrasco;
      await tx.loteVacina.update({ where: { id: loteData.id }, data: { qtdDisponivel: { decrement: qtd } } });
      if (loteIdFinal !== vacina.loteId) {
        await tx.vacinaClinica.update({ where: { id: vacina.id }, data: { loteId: loteIdFinal, lote: loteData.lote ?? vacina.lote } });
      }
    }
  }

  // 🔴 FORMA DE COBRANÇA — aplicada UMA vez, depois de saber de qual lote a dose saiu:
  // VALOR_REPASSADO devolve o preço daquele lote (o que sempre foi), PERCENTUAL soma o
  // acréscimo e MAIOR_VALOR/CUSTO_MEDIO trocam pelo preço tirado do estoque inteiro.
  // Sem lote debitado não há o que precificar — a linha nasce zerada, como antes.
  if (loteIdFinal) loteValor = formaCobranca.precoDeVenda(cfgCobranca, loteValor, entradas);

  if (animal?.userId) {
    // 🔴 A DESCRIÇÃO NÃO CARREGA MAIS `[VC-0004] [AG-0012]` (2026-09-17, a pedido).
    // Enquanto carregava, a MESMA vacina, na MESMA dose e pelo MESMO preço, aplicada
    // duas vezes no mês, virava duas linhas idênticas fora os números. Eles passaram a
    // ser OBSERVAÇÃO da linha (`lib/faturaItemOrigens.js`), com data e quantidade de
    // cada aplicação e clicáveis para o registro de origem — que é o que eles serviam
    // para dizer. A DOSE fica no texto: dose diferente é cobrança diferente.
    const descricao = `${vacina.nome}${vacina.dose ? ` — ${vacina.dose}` : ''}`;
    // Sem lote debitado (sem estoque) → valor 0, financeiro ajusta depois.
    const valorItem = info.valor != null ? info.valor : (loteIdFinal ? Number(loteValor) : 0);
    const fatura = await getOrCreateFatura(tx, animal.userId, empresaIdEfetivo);
    // Consolida com a aplicação anterior da mesma vacina em vez de abrir linha nova —
    // o mesmo helper da dose de prescrição. Cada aplicação continua sendo uma cobrança;
    // o que muda é que elas somam na quantidade de uma linha só.
    await adicionarOuSomarFaturaItem(tx, {
      faturaId:        fatura.id,
      animalId:        vacina.animalId,
      tipo:            'VACINA',
      descricao,
      valor:           valorItem,
      quantidade:      qtd,
      veterinarioId,
      vacinaClinicaId: vacina.id,
      ocorridoEm:      agora,
    });
  }

  // 🔴 CONTA A PAGAR DO FORNECEDOR (2026-09-10) — a vacina que a clínica NÃO estoca
  // e pediu ao fornecedor vira dívida com ele no MESMO momento em que o cliente é
  // cobrado. Espelho exato do que a prescrição faz com o medicamento.
  //
  // ⚠️ Fica FORA do `if (animal?.userId)` de propósito: o que a clínica DEVE ao
  // fornecedor não depende de o paciente ter dono cadastrado para ser cobrado. A
  // vacina foi pedida e entregue de qualquer jeito.
  //
  // ⚠️ Só quando NÃO houve lote debitado (`!loteIdFinal`): com lote, a vacina saiu
  // do estoque próprio — já foi comprada antes, na entrada da nota, e cobrá-la de
  // novo aqui contaria a mesma compra duas vezes.
  //
  // ⚠️ Sem preço de COMPRA cadastrado no produto, não lança: dívida de valor
  // inventado é pior que dívida ausente.
  if (!loteIdFinal && info.medicamentoCatId && !info.cliente) {
    const produto = await produtoFornecedor.fornecedorDoItem(
      tx, empresaIdEfetivo, info.medicamentoCatId,
    );
    if (produto?.valorUnitario != null) {
      // Quem SOLICITOU: o veterinário que registrou a vacina — a compra foi
      // provocada por ele, não por quem aplicou a dose no plantão.
      const solicitante = vacina.veterinarioId
        ? await tx.user.findUnique({
            where: { id: Number(vacina.veterinarioId) }, select: { id: true, fullName: true },
          }).catch(() => null)
        : null;
      await contasPagar.lancarItem(tx, {
        empresaId:   empresaIdEfetivo,
        tipo:        'FORNECEDOR',
        credorId:    produto.fornecedorId,
        credorNome:  produto.fornecedorNome ?? '',
        animalId:    vacina.animalId,
        animalNome:  animal?.nome ?? '',
        descricao:   vacina.nome,
        quantidade:  qtd,
        valor:       produto.valorUnitario,
        solicitanteId:   solicitante?.id ?? null,
        solicitanteNome: solicitante?.fullName ?? '',
        ocorridoEm:  agora,
        // Uma linha por REGISTRO de vacina — reprocessar não duplica.
        origemTipo:  contasPagar.ORIGENS.VACINA,
        origemId:    vacina.id,
      });
    }
  }
}

async function excluir(req, res) {
  try {
    const { id } = req.params;
    const { motivo } = req.body ?? {};

    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const vacina = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) } });
    if (!vacina) return res.status(404).json({ error: 'Registro não encontrado' });
    if (!vacina.ativo) return res.status(400).json({ error: 'Registro já está inativo' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a vacina não é
    // cancelada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, vacina.animalId)) return;

    // Autoria: só o gestor (FULL) exclui vacina de outro; os demais só as que registraram.
    if (!podeOperarRegistro(req, vacina.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite excluir vacinas que você registrou.' });
    }

    await prisma.$transaction(async (tx) => {
      // Reserva pendente (FINALIZADA, ainda não executada) — libera SEM tocar
      // `qtdDisponivel`: a reserva nunca decrementou o lote, só separou a quantidade
      // para esta vacina (ver `criarReservaVacina`). Sem isto, cancelar deixava a
      // reserva viva, contando contra a disponibilidade de qualquer outra vacina para
      // sempre — o mesmo bug de "estoque inflado", só que ao contrário (encolhido).
      await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_reservas_estoque_vacina WHERE "vacinaClinicaId" = $1`, vacina.id
      );

      // O lote só foi DEBITADO se a vacina chegou a ser cobrada — mesmo caminho que
      // debita o estoque (`darBaixaEFaturar`, chamado só por `finalizar` no quadrante
      // aplicadaPeloProprietario×!cliente, ou por `executar` no plantão — nunca por
      // `registrar`). `vacina.loteId` sozinho NÃO prova débito: `registrar` já grava
      // essa coluna como referência de preço/lote sugerido, sem tocar `qtdDisponivel`
      // (ver os comentários "só referência"/"aqui apenas fixa o lote sugerido" em
      // `registrar`). Sem este cheque, cancelar uma vacina ainda SALVA/FINALIZADA
      // (nunca debitada) DEVOLVIA ao lote doses que nunca saíram dele — inflava o
      // estoque a cada registro seguido de cancelamento antes da execução.
      const jaFaturada = await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', vacina.id);

      // Remove o FaturaItem vinculado, se houver (vacina do cliente nunca gerou um).
      // Bloqueia (lança FaturaPagaError) se a fatura de destino já estiver PAGA.
      await removerFaturaItensDaOrigem(tx, 'vacinaClinicaId', vacina.id);

      // Restaura as doses ao lote SÓ quando havia FaturaItem (prova do débito) — nunca
      // pela mera presença de `loteId`.
      if (vacina.loteId && jaFaturada) {
        const lote = await tx.loteVacina.findUnique({ where: { id: vacina.loteId } });
        if (lote) {
          const qtdRows = await tx.$queryRawUnsafe(
            `SELECT quantidade FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`, Number(id)
          );
          const qtdRestaurar = Number(qtdRows[0]?.quantidade ?? 1);
          await tx.loteVacina.update({
            where: { id: lote.id },
            data: { qtdDisponivel: lote.qtdDisponivel + qtdRestaurar },
          });
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas SET ativo = false, motivo_inativacao = $1 WHERE id = $2`,
        motivo.trim(),
        Number(id)
      );

      await registrarAuditoria(tx, req, {
        categoria:  'CANCELAMENTO',
        entidade:   'VACINA',
        entidadeId: vacina.id,
        animalId:   vacina.animalId,
        motivo,
        detalhes:   vacina.nome ?? null,
      });
    });

    res.json({ mensagem: 'Registro inativado com sucesso' });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
    console.error('excluir vacina:', err);
    res.status(500).json({ error: 'Erro ao remover registro' });
  }
}

module.exports = {
  listarPorAnimal,
  listarCatalogoAtivo,
  listarLotesDisponiveis,
  registrar,
  atualizar,
  obterPorId,
  finalizar,
  listarParaExecucao,
  listarExecutadasHoje,
  executar,
  excluir,
  // Reusada pela cascata da finalização do ATENDIMENTO (`lib/finalizacaoEvolucao.js`):
  // empresa sem etapa de execução cobra ali também a vacina promovida de SALVA.
  executarNaFinalizacao,
};
