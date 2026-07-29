// VacinaClinicaController.js — registro clínico de vacinas por animal
const prisma = require('../lib/prisma').default;
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');

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
                quantidade, valor::float AS valor, cliente, status,
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

// PATCH /clinica/vacinas/:id/finalizar — transita SALVA -> FINALIZADA.
// Mesmo padrão de Exames (SOLICITADO->CONCLUIDO) e Encaminhamento (PENDENTE->CONCLUIDO):
// a finalização é apenas a transição de status; débito de estoque e lançamento na
// fatura já acontecem no `registrar`.
async function finalizar(req, res) {
  try {
    const { id } = req.params;

    const vacina = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) } });
    if (!vacina || !vacina.ativo) return res.status(404).json({ error: 'Registro não encontrado' });

    // Autoria via RBAC (nível efetivo em atendimento.vacinas.finalizar):
    // PROPRIO → só finaliza o que registrou; EQUIPE/FULL → qualquer da equipe.
    if (!podeOperarRegistro(req.permissaoNivel, vacina.veterinarioId, req.user.id)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar vacinas que você registrou.' });
    }

    // status vive fora do client gerado (raw SQL, mesmo padrão dos demais campos)
    const statusRows = await prisma.$queryRawUnsafe(
      `SELECT status FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`, Number(id)
    );
    if (statusRows[0]?.status === 'FINALIZADA') {
      return res.status(400).json({ error: 'Vacina já está finalizada.' });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet.tb_vacinas_clinicas SET status = 'FINALIZADA' WHERE id = $1`, Number(id)
    );

    const atualizada = await prisma.vacinaClinica.findUnique({
      where: { id: Number(id) }, include: INCLUDE_VACINA,
    });
    const extras = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento",
              quantidade, valor::float AS valor, cliente, status,
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
      animal: { ativo: true },
      AND:    [escopoFilhoEvolucaoWhere(req)],
    };
    if (animalId) where.animalId = Number(animalId);

    const vacinas = await prisma.vacinaClinica.findMany({
      where,
      include: {
        ...INCLUDE_VACINA,
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true,
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
              valor::float AS valor, cliente, status
       FROM schs2vet.tb_vacinas_clinicas WHERE id = ANY($1::int[])`,
      ids
    );
    const extrasMap = Object.fromEntries(extras.map((e) => [e.id, e]));

    const dados = vacinas
      .map((v) => ({ ...v, ...extrasMap[v.id] }))
      .filter((v) => v.status === 'FINALIZADA');

    res.json({ dados });
  } catch (err) {
    console.error('listarParaExecucao vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas para execução' });
  }
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

    const extras = await prisma.$queryRawUnsafe(
      `SELECT status, quantidade, valor::float AS valor, cliente, numero,
              tipo_atendimento AS "tipoAtendimento", medicamento_cat_id AS "medicamentoCatId"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    const info = extras[0] ?? {};
    if (info.status === 'EXECUTADA') return res.status(400).json({ error: 'Vacina já executada.' });
    if (info.status !== 'FINALIZADA') return res.status(400).json({ error: 'Apenas vacinas FINALIZADAS podem ser executadas.' });

    const qtd       = Math.max(1, Number(info.quantidade) || 1);
    const isCliente = info.cliente === true;
    const jaFaturada = await prisma.faturaItem.findFirst({
      where: { vacinaClinicaId: vacina.id }, select: { id: true },
    });

    const empresaIdEfetivo = req.empresaId ?? null;
    const agora = new Date();

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
        let loteIdFinal = vacina.loteId ?? null;
        let loteValor   = 0;

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

        if (animal?.userId) {
          const vcNum     = `VC-${String(info.numero ?? vacina.id).padStart(4, '0')}`;
          const evNum     = evolucao ? `[${formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero)}] ` : '';
          const descricao = `[${vcNum}] ${evNum}${vacina.nome}${vacina.dose ? ` — ${vacina.dose}` : ''}`;
          // Sem lote debitado (sem estoque) → valor 0, financeiro ajusta depois.
          const valorItem = info.valor != null ? info.valor : (loteIdFinal ? Number(loteValor) : 0);
          const fatura = await getOrCreateFatura(tx, animal.userId);
          await adicionarFaturaItem(tx, {
            faturaId:        fatura.id,
            animalId:        vacina.animalId,
            tipo:            'VACINA',
            descricao,
            valor:           valorItem,
            quantidade:      qtd,
            veterinarioId,
            vacinaClinicaId: vacina.id,
          });
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas SET status = 'EXECUTADA' WHERE id = $1`, Number(id)
      );
    });

    const atualizada = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) }, include: INCLUDE_VACINA });
    const extras2 = await prisma.$queryRawUnsafe(
      `SELECT id, numero, tipo_atendimento AS "tipoAtendimento", quantidade,
              valor::float AS valor, cliente, status, motivo_inativacao AS "motivoInativacao"
       FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(id)
    );
    res.json({ dados: { ...atualizada, ...(extras2[0] ?? {}) } });
  } catch (err) {
    console.error('executar vacina:', err);
    res.status(500).json({ error: 'Erro ao executar vacina' });
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

    // Autoria: só o gestor (FULL) exclui vacina de outro; os demais só as que registraram.
    if (!podeOperarRegistro(req.permissaoNivel, vacina.veterinarioId, req.user.id)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite excluir vacinas que você registrou.' });
    }

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
  obterPorId,
  finalizar,
  listarParaExecucao,
  executar,
  excluir,
};
