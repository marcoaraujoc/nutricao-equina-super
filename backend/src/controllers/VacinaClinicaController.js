// VacinaClinicaController.js — registro clínico de vacinas por animal
const prisma = require('../lib/prisma').default;
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
const { animalEstaInativo } = require('../lib/animalInativo');

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
                aplicada_pelo_proprietario AS "aplicadaPeloProprietario",
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
      aplicadaPeloProprietario: aplicadaPropRaw,
    } = req.body;

    // cliente = vacina fornecida pelo próprio cliente → sem débito de estoque, sem lançamento na fatura
    const isCliente = clienteRaw === true || clienteRaw === 'true';
    // aplicadaPeloProprietario = quem APLICA a dose. Decisão IRMÃ de `cliente` (quem
    // FORNECE) — é o cruzamento das duas que decide execução e fatura. Ver a matriz em
    // `finalizar` e na migration 20260815000001.
    const isAplicadaProp = aplicadaPropRaw === true || aplicadaPropRaw === 'true';

    if (!animalId)    return res.status(400).json({ error: 'animalId é obrigatório' });
    if (await animalEstaInativo(animalId)) {
      return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
    }

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
    const jaFaturada   = cobrarAgora
      ? await prisma.faturaItem.findFirst({ where: { vacinaClinicaId: vacina.id }, select: { id: true } })
      : null;

    const empresaIdEfetivo = req.empresaId ?? null;
    const agora = new Date();
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
          qtd: Math.max(1, Number(info.quantidade) || 1),
          veterinarioId, empresaIdEfetivo, agora, evolucao, animal,
        });
        // A dose foi entregue ao dono e não passará pelo plantão: os reforços do
        // esquema periódico precisam ser agendados aqui, senão nunca seriam.
        await agendarReforcos(tx, {
          vacina,
          dose:          vacina.dose,
          quantidade:    Math.max(1, Number(info.quantidade) || 1),
          veterinarioId,
          empresaId:     empresaIdEfetivo,
          equipeId:      req.equipeId ?? null,
          aplicadaEm:    vacina.dataAplicacao ?? agora,
        });
      }

      await tx.$executeRawUnsafe(
        `UPDATE schs2vet.tb_vacinas_clinicas SET status = 'FINALIZADA' WHERE id = $1`, Number(id)
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
              valor::float AS valor, cliente, status,
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

    res.json({ dados });
  } catch (err) {
    console.error('listarParaExecucao vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas para execução' });
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
 * A dose aplicada agora é a PRIMEIRA da série, então de `quantidade` doses restam
 * `quantidade - 1` a agendar: 5 doses de Reforço Mensal → 4 agendamentos, em +1, +2,
 * +3 e +4 meses a partir da aplicação.
 *
 * Idempotente: se já existirem agendamentos de VACINA criados por esta mesma vacina
 * (mesma observação de rastreio), não duplica — reexecutar não enche a agenda.
 */
async function agendarReforcos(tx, { vacina, dose, quantidade, veterinarioId, empresaId, equipeId, aplicadaEm }) {
  const meses = intervaloDaDose(dose);
  if (!meses) return 0;
  const restantes = Math.max(0, (Number(quantidade) || 1) - 1);
  if (restantes === 0) return 0;

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

    const qtd       = Math.max(1, Number(info.quantidade) || 1);
    const isCliente = info.cliente === true;
    const jaFaturada = await prisma.faturaItem.findFirst({
      where: { vacinaClinicaId: vacina.id }, select: { id: true },
    });

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

      // Esquema de reforço (mensal/anual) com mais de uma dose: agenda as seguintes.
      // A aplicação de agora é a 1ª — por isso `quantidade - 1` agendamentos.
      agendados = await agendarReforcos(tx, {
        vacina,
        dose:          vacina.dose,
        quantidade:    qtd,
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
 * Debita o lote (FEFO quando o vinculado não serve) e lança o FaturaItem da vacina.
 *
 * Extraído de `executar` porque a EXECUÇÃO deixou de ser o único momento em que isso
 * acontece: a vacina que o PROPRIETÁRIO aplica em casa nunca chega ao plantão, e a
 * clínica ainda assim entregou a dose — para ela, quem chama é o `finalizar`.
 * Chamar sempre dentro de uma transaction (recebe o `tx`).
 */
async function darBaixaEFaturar(tx, { vacina, info, qtd, veterinarioId, empresaIdEfetivo, agora, evolucao, animal }) {
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
    const fatura = await getOrCreateFatura(tx, animal.userId, empresaIdEfetivo);
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
    if (!podeOperarRegistro(req, vacina.veterinarioId)) {
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
