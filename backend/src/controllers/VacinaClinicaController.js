// VacinaClinicaController.js — registro clínico de vacinas por animal
const prisma = require('../lib/prisma').default;
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');

const INCLUDE_VACINA = {
  veterinario: { select: { id: true, fullName: true } },
  vacina: { select: { id: true, nome: true, fabricante: true, via: true } },
  loteVacina: { select: { id: true, lote: true, validade: true, qtdDisponivel: true } },
};

async function listarPorAnimal(req, res) {
  try {
    const { animalId } = req.params;
    // Mostra todas as vacinas (ativas, vencidas e inativas) para histórico completo
    const vacinas = await prisma.vacinaClinica.findMany({
      // Segregação multi-clínica: cada empresa vê só as próprias vacinas do animal
      where: { animalId: Number(animalId), AND: [escopoFilhoEvolucaoWhere(req)] },
      include: INCLUDE_VACINA,
      orderBy: { dataAplicacao: 'desc' },
    });

    // Enriquece com campos adicionados via migration (fora do client gerado)
    if (vacinas.length > 0) {
      const ids = vacinas.map(v => v.id);
      const extras = await prisma.$queryRawUnsafe(
        `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
                quantidade, valor::float AS valor, cliente,
                motivo_inativacao AS "motivoInativacao"
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
    } = req.body;

    // cliente = vacina fornecida pelo próprio cliente → sem débito de estoque, sem lançamento na fatura
    const isCliente = clienteRaw === true || clienteRaw === 'true';

    if (!animalId)    return res.status(400).json({ error: 'animalId é obrigatório' });

    // Evolução é opcional — busca apenas para montar a descrição na fatura
    const evolucao = evolucaoId
      ? await prisma.evolucaoClinica.findFirst({
          where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
          select: { id: true, numero: true, tipoAtendimento: true },
        })
      : null;

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

    const qtdFinal   = Math.max(1, Number(quantidade) || 1);
    const valorFinal = valor != null && valor !== '' ? Number(valor) : null;

    let loteValor   = 0;
    let loteIdFinal = loteId ? Number(loteId) : null;

    if (loteIdFinal) {
      const loteData = await prisma.loteVacina.findUnique({ where: { id: loteIdFinal } });
      if (!loteData) return res.status(404).json({ error: 'Lote não encontrado' });
      if (!isCliente) {
        if (loteData.qtdDisponivel < qtdFinal) return res.status(400).json({ error: 'Lote sem saldo disponível' });
        if (loteData.validade && new Date(loteData.validade) < new Date()) {
          return res.status(400).json({ error: `Lote ${loteData.lote} está vencido (validade: ${new Date(loteData.validade).toLocaleDateString('pt-BR')}). Selecione um lote dentro da validade.` });
        }
      }
      loteNumFinal = loteData.lote;
      // Valor por frasco ÷ doses por frasco = valor proporcional por dose
      const valorFrascoExplicito = Number(loteData.valorUnitarioRepassado ?? loteData.valorUnitario ?? 0);
      const dosesFrascoExplicito = Number(loteData.dosesPorFrasco) || 1;
      loteValor = valorFrascoExplicito / dosesFrascoExplicito;
      if (!isCliente) {
        await prisma.loteVacina.update({
          where: { id: loteIdFinal },
          data:  { qtdDisponivel: loteData.qtdDisponivel - qtdFinal },
        });
      }

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
        await prisma.loteVacina.update({
          where: { id: loteIdFinal },
          data:  { qtdDisponivel: { decrement: qtdFinal } },
        });
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
    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet."tb_vacinas_clinicas"
       SET "medicamento_cat_id" = $1,
           numero              = $2,
           tipo_atendimento    = 'VC',
           quantidade          = $3,
           valor               = $4,
           cliente             = $5
       WHERE id = $6`,
      medCatIdFinal ?? null,
      numero,
      qtdFinal,
      valorFinal,
      isCliente,
      criada.id
    );

    // Lança na fatura quando não for vacina do cliente.
    // Sem lote (sem estoque debitado) → valor 0, para o financeiro saber o que foi aplicado.
    if (!isCliente) setImmediate(async () => {
      try {
        const animal = await prisma.animal.findUnique({
          where:  { id: Number(animalId) },
          select: { userId: true },
        });
        if (animal?.userId) {
          const vcNum     = `VC-${String(numero).padStart(4, '0')}`;
          const evNum     = evolucao ? `[${formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero)}] ` : '';
          const descricao = `[${vcNum}] ${evNum}${nomeVacina.trim()}${dose ? ` — ${dose.trim()}` : ''}`;
          const valorItem = loteIdFinal ? (valorFinal ?? Number(loteValor) ?? 0) : 0;
          await prisma.$transaction(async (tx) => {
            const fatura = await getOrCreateFatura(tx, animal.userId);
            await adicionarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     Number(animalId),
              tipo:         'VACINA',
              descricao,
              valor:        valorItem,
              quantidade:   qtdFinal,
              veterinarioId,
              vacinaClinicaId: criada.id,
            });
          });
        }
      } catch { /* silencioso — fatura não bloqueia o registro */ }
    }); // end if (!isCliente)

    res.status(201).json({ dados: criada });
  } catch (err) {
    console.error('registrar vacina:', err);
    res.status(500).json({ error: 'Erro ao registrar vacina' });
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
              quantidade, valor::float AS valor, cliente,
              motivo_inativacao AS "motivoInativacao"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    return res.json({ dados: { ...vacina, ...(extras[0] ?? {}) } });
  } catch (err) {
    console.error('obterPorId vacina:', err);
    res.status(500).json({ error: 'Erro ao obter registro' });
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

    await prisma.$transaction(async (tx) => {
      // Remove o FaturaItem vinculado, se houver (vacina do cliente nunca gerou um).
      // Bloqueia (lança FaturaPagaError) se a fatura de destino já estiver PAGA.
      await removerFaturaItensDaOrigem(tx, 'vacinaClinicaId', vacina.id);

      // Restaura as doses ao lote se havia vínculo
      if (vacina.loteId) {
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
        categoria:  'EXCLUSAO',
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
  obterPorId,
  excluir,
};
