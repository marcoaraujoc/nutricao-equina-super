// backend/src/controllers/EstoqueVacinaController.js
// Gestão de lotes de vacinas por clínica — Módulo Vacina
'use strict';

const prisma = require('../lib/prisma').default;
// FORMA DE CÁLCULO do produto (2026-09-16) — quanto o frasco rende e em quê.
const catalogoEmpresa = require('../lib/catalogoEmpresa');
const { escopoCatalogoEmpresa } = require('../middlewares/empresaAtiva.middleware');
const { registrarAuditoria } = require('../lib/auditoria');
const { registrarAtivacao, registrarInativacao, anexarTrilha } = require('../lib/cadastroAtivacao');

const INCLUDE_LOTE = {
  vacina:         { select: { id: true, nome: true, fabricante: true, via: true, ativo: true } },
  medicamentoCat: {
    select: {
      id: true, nome: true, fabricante: true,
      formaFarmaceutica: true, apresentacao: true,
      vias:    { select: { id: true, via: true } },
      especies: { select: { id: true, especie: { select: { id: true, nome: true } } } },
    },
  },
};

// ADMIN pode passar ?empresaId= para ver qualquer empresa; demais sempre usam req.empresaId
function getEmpresaScope(req) {
  if (req.user?.userType === 'ADMIN') {
    return req.query?.empresaId ? Number(req.query.empresaId) : (req.empresaId ?? null);
  }
  return req.empresaId ?? null;
}

// Retorna true se o lote pertence à empresa do usuário (ADMIN bypassa)
function pertenceAEmpresa(lote, req) {
  if (req.user?.userType === 'ADMIN') return true;
  return req.empresaId != null && lote.empresaId === req.empresaId;
}

// ─── Helper: espécies atendidas pela empresa (animais ativos) ────────────────

async function getEspeciesIds(empresaId, userId, userType) {
  // Para VETERINARIO: usa VetEspecie do perfil (explicitamente declarado)
  if (userType === 'VETERINARIO') {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ve."especieId"
       FROM schs2vet.tb_vet_especies ve
       JOIN schs2vet.tb_vet_perfil vp ON vp.id = ve."vetPerfilId"
       WHERE vp."userId" = $1`,
      userId
    );
    if (rows.length > 0) return rows.map(r => r.especieId);
  }

  // Fallback: espécies dos animais ativos da empresa
  if (empresaId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "especieId"
       FROM schs2vet.tb_animais
       WHERE "empresaId" = $1 AND ativo = true AND "especieId" IS NOT NULL`,
      empresaId
    );
    if (rows.length > 0) return rows.map(r => r.especieId);
  }

  return []; // sem filtro
}

// ─── Listar lotes de vacina da clínica ───────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, vacinaId, fabricante } = req.query;
    const empresaId = getEmpresaScope(req);

    // Não-ADMIN sem empresa ativa não vê nada
    if (!empresaId && req.user?.userType !== 'ADMIN') {
      return res.json({ dados: [], meta: { totalLotes: 0, totalVencidos: 0, totalVencendo: 0, totalDoses: 0, totalAbaixoMinimo: 0, totalAbaixoAlarmante: 0 } });
    }

    const where = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (empresaId)           where.empresaId = empresaId;
    if (vacinaId)            where.vacinaId = Number(vacinaId);

    if (busca || fabricante) {
      const orNome = busca ? [
        { medicamentoCat: { nome:       { contains: busca, mode: 'insensitive' } } },
        { medicamentoCat: { fabricante: { contains: busca, mode: 'insensitive' } } },
        { vacina:         { nome:       { contains: busca, mode: 'insensitive' } } },
        { vacina:         { fabricante: { contains: busca, mode: 'insensitive' } } },
      ] : undefined;
      if (orNome) where.OR = orNome;

      if (fabricante) {
        where.OR = undefined;
        where.AND = [
          {
            OR: [
              { medicamentoCat: { fabricante: { equals: fabricante, mode: 'insensitive' } } },
              { vacina:         { fabricante: { equals: fabricante, mode: 'insensitive' } } },
            ],
          },
        ];
      }
    }

    const lotesRaw = await prisma.loteVacina.findMany({
      where,
      include: INCLUDE_LOTE,
      orderBy: { validade: 'asc' },
    });
    const lotes = await anexarTrilha(lotesRaw, 'lote_vacina');

    const hoje = new Date();
    const em30 = new Date(); em30.setDate(em30.getDate() + 30);

    const totalLotes    = lotes.filter(l => l.ativo).length;
    const totalVencidos = lotes.filter(l => l.ativo && new Date(l.validade) < hoje).length;
    const totalVencendo = lotes.filter(l => l.ativo && new Date(l.validade) >= hoje && new Date(l.validade) <= em30).length;
    const totalDoses    = lotes.filter(l => l.ativo).reduce((acc, l) => acc + l.qtdDisponivel, 0);
    const totalAbaixoMinimo    = lotes.filter(l => l.ativo && l.qtdDisponivel <= l.estoqueMinimo).length;
    const totalAbaixoAlarmante = lotes.filter(l => l.ativo && l.qtdDisponivel <= l.estoqueAlarmante && l.qtdDisponivel > l.estoqueMinimo).length;

    return res.json({
      dados: lotes,
      meta: { totalLotes, totalVencidos, totalVencendo, totalDoses, totalAbaixoMinimo, totalAbaixoAlarmante },
    });
  } catch (err) {
    console.error('EstoqueVacinaController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar lotes de vacina.' });
  }
};

// 🔴 O LABORATÓRIO NÃO TEM TABELA PRÓPRIA. Ele existe em dois lugares, e a tela
// precisa dos DOIS:
//   (a) como texto na coluna `fabricante` da vacina (o que sempre foi), e
//   (b) como entrada do catálogo genérico `tb_catalogo_tipo_servico`, categoria
//       LABORATORIO — a MESMA tabela dos tipos de fornecedor/prestador/localização.
// Reusá-la traz de graça o tenant, a policy de RLS (ENABLE+FORCE) e o gate de permissão
// que ela já tem; um catálogo novo exigiria repetir os três — mesma decisão de
// 2026-09-08 para os tipos de local.
// ⚠️ Sem (b), o laboratório só passaria a existir DEPOIS de alguém cadastrar uma vacina
// com ele, e o pedido é o contrário: cadastrar o laboratório na tela de estoque.
// ⚠️ NÃO lança: catálogo indisponível (tabela ausente numa base não migrada) devolve
// lista vazia e a tela cai no comportamento antigo — derrubar a lista de laboratórios
// impediria toda entrada de vacina por causa de um recurso acessório.
const CATEGORIA_LABORATORIO = 'LABORATORIO';

async function labsDoCatalogo() {
  try {
    // O RLS (tenant_tb_catalogo_tipo_servico) já filtra por empresa — a consulta só
    // precisa da categoria.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT nome FROM schs2vet.tb_catalogo_tipo_servico WHERE categoria = $1 ORDER BY nome ASC`,
      CATEGORIA_LABORATORIO,
    );
    return rows.map(r => r.nome).filter(Boolean);
  } catch {
    return [];
  }
}

// Valor sentinela da opção "Outros" do seletor de laboratório. É o ÚNICO jeito de pedir
// "as vacinas SEM laboratório informado": string vazia já significa "todos", e o nome de
// um laboratório de verdade nunca seria este.
const SEM_FABRICANTE = '__SEM_FABRICANTE__';

// ⚠️ O vazio conta como AUSENTE (`btrim(...) = ''`), não só o NULL: o campo Fabricante do
// cadastro é opcional e grava string vazia quando a pessoa passa por ele sem digitar.
// Olhar só o NULL deixaria essas vacinas fora de "Outros" E fora de todo laboratório —
// alcançáveis apenas por "Todos".
const SQL_SEM_FABRICANTE = `(m.fabricante IS NULL OR btrim(m.fabricante) = '')`;

// A opção "Outros" só é oferecida se houver vacina sem laboratório: opção que não filtra
// nada é botão morto, a mesma regra da aba vazia.
async function existeVacinaSemFabricante(especiesIds) {
  try {
    const rows = especiesIds.length > 0
      ? await prisma.$queryRawUnsafe(
          `SELECT 1
             FROM schs2vet.tb_medicamentos m
             INNER JOIN schs2vet.tb_medicamento_especies me ON me."medicamentoId" = m.id
            WHERE m.ativo = true
              AND lower(m.classificacao) LIKE '%vacin%'
              AND me."especieId" = ANY($1::int[])
              AND ${SQL_SEM_FABRICANTE}
            LIMIT 1`,
          especiesIds,
        )
      : await prisma.$queryRawUnsafe(
          `SELECT 1 FROM schs2vet.tb_medicamentos m
            WHERE m.ativo = true AND lower(m.classificacao) LIKE '%vacin%'
              AND ${SQL_SEM_FABRICANTE}
            LIMIT 1`,
        );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ─── Listar fabricantes do catálogo de medicamentos (filtrados por espécie) ──

const listarFabricantes = async (req, res) => {
  try {
    const empresaId = req.empresaId ?? null;
    const especiesIds = await getEspeciesIds(empresaId, req.user?.id, req.user?.userType);

    let rows;
    if (especiesIds.length > 0) {
      rows = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT m.fabricante
         FROM schs2vet.tb_medicamentos m
         INNER JOIN schs2vet.tb_medicamento_especies me ON me."medicamentoId" = m.id
         WHERE m.ativo = true
           AND m.fabricante IS NOT NULL
           AND lower(m.classificacao) LIKE '%vacin%'
           AND me."especieId" = ANY($1::int[])
         ORDER BY m.fabricante ASC`,
        especiesIds
      );
    } else {
      rows = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT fabricante
         FROM schs2vet.tb_medicamentos
         WHERE ativo = true
           AND fabricante IS NOT NULL
           AND lower(classificacao) LIKE '%vacin%'
         ORDER BY fabricante ASC`
      );
    }

    // Dedup SEM OLHAR A CAIXA — 'Zoetis' e 'ZOETIS' são o mesmo laboratório, e duas
    // linhas iguais no seletor fariam a pessoa escolher uma ao acaso. A grafia da VACINA
    // vence a do catálogo: é a que já está gravada no item.
    const vistos = new Map();
    for (const nome of [...rows.map(r => r.fabricante), ...(await labsDoCatalogo())]) {
      const limpo = (nome ?? '').trim();
      if (!limpo) continue;
      const chave = limpo.toLocaleLowerCase('pt-BR');
      if (!vistos.has(chave)) vistos.set(chave, limpo);
    }
    const dados = [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return res.json({ dados, semFabricante: await existeVacinaSemFabricante(especiesIds) });
  } catch (err) {
    console.error('EstoqueVacinaController.listarFabricantes:', err);
    return res.status(500).json({ error: 'Erro ao listar fabricantes.' });
  }
};

// ─── Listar vacinas do catálogo de medicamentos (por fabricante + espécie) ───

const listarVacinasPorFabricante = async (req, res) => {
  try {
    const { fabricante } = req.query;
    // Opção "Outros" do seletor de laboratório — ver SEM_FABRICANTE.
    const semFab = fabricante === SEM_FABRICANTE;
    const empresaId   = req.empresaId ?? null;
    const especiesIds = await getEspeciesIds(empresaId, req.user?.id, req.user?.userType);

    let rows;
    if (especiesIds.length > 0) {
      // "Outros" (`SEM_FABRICANTE`) NÃO vira parâmetro: o filtro é a própria ausência
      // do campo, e mandar a sentinela como texto procuraria um laboratório com esse nome.
      const fabFilter = semFab
        ? `AND ${SQL_SEM_FABRICANTE}`
        : fabricante ? `AND lower(m.fabricante) = lower($2)` : '';
      const params = (!semFab && fabricante) ? [especiesIds, fabricante] : [especiesIds];
      rows = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT ON (m.id)
                m.id, m.nome, m.fabricante, m."formaFarmaceutica",
                m.apresentacao, m.unidade
         FROM schs2vet.tb_medicamentos m
         INNER JOIN schs2vet.tb_medicamento_especies me ON me."medicamentoId" = m.id
         WHERE m.ativo = true
           AND lower(m.classificacao) LIKE '%vacin%'
           AND me."especieId" = ANY($1::int[])
           ${fabFilter}
         ORDER BY m.id, m.nome ASC`,
        ...params
      );
    } else {
      const fabFilter = semFab
        ? `AND (fabricante IS NULL OR btrim(fabricante) = '')`
        : fabricante ? `AND lower(fabricante) = lower($1)` : '';
      const params    = (!semFab && fabricante) ? [fabricante] : [];
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, nome, fabricante,
                "formaFarmaceutica",
                apresentacao, unidade
         FROM schs2vet.tb_medicamentos
         WHERE ativo = true
           AND lower(classificacao) LIKE '%vacin%'
           ${fabFilter}
         ORDER BY nome ASC`,
        ...params
      );
    }

    // Busca vias de cada medicamento
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const vias = await prisma.$queryRawUnsafe(
        `SELECT "medicamentoId", id, via
         FROM schs2vet.tb_medicamento_vias
         WHERE "medicamentoId" = ANY($1::int[])
         ORDER BY via ASC`,
        ids
      );
      const viasPorMed = {};
      for (const v of vias) {
        if (!viasPorMed[v.medicamentoId]) viasPorMed[v.medicamentoId] = [];
        viasPorMed[v.medicamentoId].push({ id: v.id, via: v.via });
      }
      rows = rows.map(r => ({ ...r, vias: viasPorMed[r.id] ?? [] }));
    }

    // 🔴 FORMA DE CÁLCULO + CONTEÚDO DO FRASCO (2026-09-16): é o produto que declara
    // quanto cada frasco rende e em quê, e a Entrada de Estoque só MULTIPLICA. Vai por
    // `multidosePorItem` (SQL cru com feature-detect), nunca no SELECT acima: a coluna
    // é de migration recente e uma base sem ela derrubaria a lista inteira de vacinas.
    return res.json({ dados: await anexarFormaCalculo(rows) });
  } catch (err) {
    console.error('EstoqueVacinaController.listarVacinasPorFabricante:', err);
    return res.status(500).json({ error: 'Erro ao listar vacinas.' });
  }
};

// ─── Catálogo com estoque disponível (para SubModuloVacina no atendimento) ───
// Retorna somente medicamentos que possuem lote ativo com saldo > 0.

const listarCatalogoComEstoque = async (req, res) => {
  try {
    const empresaId   = req.empresaId ?? null;
    const especiesIds = await getEspeciesIds(empresaId, req.user?.id, req.user?.userType);

    const empFilter  = empresaId  ? `AND (lv.empresa_id = ${empresaId} OR lv.empresa_id IS NULL)` : '';
    const espFilter  = especiesIds.length > 0
      ? `AND EXISTS (
           SELECT 1 FROM schs2vet.tb_medicamento_especies me2
           WHERE me2."medicamentoId" = m.id
             AND me2."especieId" = ANY(ARRAY[${especiesIds.join(',')}]::int[])
         )`
      : '';

    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT ON (m.id)
              m.id, m.nome, m.fabricante,
              m."formaFarmaceutica",
              m.apresentacao, m.unidade,
              CASE WHEN COALESCE(lv.doses_por_frasco, 1) > 0
                   THEN COALESCE(lv.valor_unitario_repassado, lv.valor_unitario, 0) / NULLIF(lv.doses_por_frasco, 0)
                   ELSE 0
              END::float AS "valorUnitario"
       FROM schs2vet.tb_medicamentos m
       INNER JOIN schs2vet.tb_lotes_vacina lv ON lv.medicamento_cat_id = m.id
       WHERE m.ativo = true
         AND lv.ativo = true
         AND lv.qtd_disponivel > 0
         ${empFilter}
         ${espFilter}
       ORDER BY m.id, lv.validade ASC NULLS LAST`
    );

    if (rows.length > 0) {
      const ids  = rows.map(r => r.id);
      const vias = await prisma.$queryRawUnsafe(
        `SELECT "medicamentoId", id, via
         FROM schs2vet.tb_medicamento_vias
         WHERE "medicamentoId" = ANY($1::int[])
         ORDER BY via ASC`,
        ids
      );
      const viasPorMed = {};
      for (const v of vias) {
        if (!viasPorMed[v.medicamentoId]) viasPorMed[v.medicamentoId] = [];
        viasPorMed[v.medicamentoId].push({ id: v.id, via: v.via });
      }
      const result = rows.map(r => ({ ...r, vias: viasPorMed[r.id] ?? [] }));
      return res.json({ dados: result });
    }

    return res.json({ dados: [] });
  } catch (err) {
    console.error('EstoqueVacinaController.listarCatalogoComEstoque:', err);
    return res.status(500).json({ error: 'Erro ao listar catálogo com estoque.' });
  }
};

// ─── Helper: normaliza lote para comparação (case-insensitive, vazio=null) ────
function normLote(lote) {
  const t = (lote ?? '').trim();
  return t === '' ? null : t.toLowerCase();
}
// Normaliza validade para comparação (apenas YYYY-MM-DD)
function normValidade(v) {
  if (!v) return null;
  try { return new Date(v).toISOString().split('T')[0]; } catch { return null; }
}

// ─── Criar lote de vacina ────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const {
      vacinaId,
      medicamentoCatId,
      empresaId,
      lote,
      validade,
      qtdFrascos       = 0,
      // ⚠️ SEM DEFAULT, de propósito (2026-09-16). Com `= 1`, o campo AUSENTE virava 1 —
      // valor truthy — e a consulta ao catálogo logo abaixo nunca rodava. Desde que a
      // tela deixou de pedir "Doses por Frasco", é exatamente a ausência dele que
      // precisa acionar o cadastro do produto; caindo no 1, o lote nasceria contando
      // frascos onde o produto conta mL, e cada aplicação cobraria o frasco inteiro.
      dosesPorFrasco,
      validadeHoras,
      validadeDias     = 0,
      valorUnitario,
      valorUnitarioRepassado,
      dataRecebimento,
      estoqueMinimo    = 0,
      estoqueAlarmante = 0,
    } = req.body;

    if (!vacinaId && !medicamentoCatId)
      return res.status(400).json({ error: 'vacinaId ou medicamentoCatId é obrigatório.' });
    if (!validade) return res.status(400).json({ error: 'Validade é obrigatória.' });
    if (Number(estoqueMinimo) < 0 || Number(estoqueAlarmante) < 0)
      return res.status(400).json({ error: 'Quantidades não podem ser negativas.' });

    const qtdFrascosN = Number(qtdFrascos);
    // 🔴 O CONTEÚDO DO FRASCO VEM DO PRODUTO (2026-09-15; desde 2026-09-16 é a ÚNICA
    // fonte na tela).
    //
    // A tela de Produtos registra quanto a embalagem contém, na Forma de Cálculo
    // (`tb_medicamentos.doses_por_embalagem`), e a Entrada de Estoque de vacinas deixou
    // de pedir "Doses por Frasco" — ela só multiplica. O parâmetro CONTINUA aceito para
    // quem o envie (remessa em frasco diferente, cliente antigo), mas o caminho normal
    // é este: sem ele, vem do cadastro. Sem isto, a clínica cadastrava "20 mL por
    // frasco" no produto e o lote nascia valendo 1, cobrando o frasco inteiro a cada
    // aplicação — exatamente o defeito que a Forma de Cálculo corrige.
    //
    // ⚠️ SQL cru com `catch` (§11): a coluna é da migration 20261009000000 e o client
    // pode não conhecê-la. Falhando, cai no 1 — o comportamento anterior.
    let dosesPorFrascoN = Number(dosesPorFrasco) || 0;
    if (!dosesPorFrascoN && medicamentoCatId) {
      dosesPorFrascoN = await dosesDoCatalogo(Number(medicamentoCatId));
    }
    if (!dosesPorFrascoN) dosesPorFrascoN = 1;
    const qtdNovasDoses = qtdFrascosN * dosesPorFrascoN;

    // Valida referência
    if (vacinaId) {
      const vacinaExiste = await prisma.vacina.findUnique({ where: { id: Number(vacinaId) } });
      if (!vacinaExiste) return res.status(404).json({ error: 'Vacina não encontrada no catálogo.' });
    }
    if (medicamentoCatId) {
      const medExiste = await prisma.medicamento.findUnique({ where: { id: Number(medicamentoCatId) } });
      if (!medExiste) return res.status(404).json({ error: 'Medicamento não encontrado no catálogo.' });
    }

    const eId = empresaId ? Number(empresaId) : (req.empresaId ?? null);

    // ── Verifica se existe lote idêntico para consolidar ─────────────────────
    // Critérios: mesmo medicamento/vacina + mesmo lote (case-insensitive, vazio=null)
    //            + mesma validade (date only, null=null) + mesmo valorUnitario (±R$0,01)
    const candidatos = await prisma.loteVacina.findMany({
      where: {
        ativo: true,
        ...(medicamentoCatId ? { medicamentoCatId: Number(medicamentoCatId) } : {}),
        ...(vacinaId         ? { vacinaId: Number(vacinaId) }                : {}),
        ...(eId              ? { empresaId: eId }                            : {}),
      },
    });

    const loteNorm    = normLote(lote);
    const validadeStr = normValidade(validade);
    const valorNovo   = valorUnitario != null ? Number(valorUnitario) : null;

    const existente = candidatos.find(c => {
      if (normLote(c.lote) !== loteNorm) return false;
      if (normValidade(c.validade) !== validadeStr) return false;
      const cValor = c.valorUnitario != null ? Number(c.valorUnitario) : null;
      if (valorNovo === null && cValor === null) return true;
      if (valorNovo === null || cValor === null) return false;
      return Math.abs(valorNovo - cValor) < 0.011; // tolerância R$ 0,01
    });

    if (existente) {
      // ── CONSOLIDAR: soma frascos e doses ao lote existente ─────────────────
      const loteAtualizado = await prisma.loteVacina.update({
        where: { id: existente.id },
        data: {
          qtdFrascos:    { increment: qtdFrascosN },
          qtdTotal:      { increment: qtdNovasDoses },
          qtdDisponivel: { increment: qtdNovasDoses },
        },
        include: INCLUDE_LOTE,
      });
      return res.status(200).json({ dados: loteAtualizado, consolidado: true, mensagem: 'Frascos somados ao lote existente.' });
    }

    // ── NOVA ENTRADA ──────────────────────────────────────────────────────────
    const loteVacina = await prisma.loteVacina.create({
      data: {
        vacinaId:               vacinaId       ? Number(vacinaId)       : null,
        medicamentoCatId:       medicamentoCatId ? Number(medicamentoCatId) : null,
        empresaId:              eId,
        lote:                   loteNorm ?? '',
        validade:               new Date(validade),
        qtdTotal:               qtdNovasDoses,
        qtdDisponivel:          qtdNovasDoses,
        qtdFrascos:             qtdFrascosN,
        dosesPorFrasco:         dosesPorFrascoN,
        estoqueMinimo:          Number(estoqueMinimo)    || 0,
        estoqueAlarmante:       Number(estoqueAlarmante) || 0,
        validadeHoras:          validadeHoras  != null ? Number(validadeHoras)  : null,
        validadeDias:           Number(validadeDias) || 0,
        valorUnitario:          valorUnitario  != null ? Number(valorUnitario)  : null,
        valorUnitarioRepassado: valorUnitarioRepassado != null
          ? Number(valorUnitarioRepassado)
          : (valorUnitario != null ? Number(valorUnitario) : null),
        dataRecebimento:        dataRecebimento ? new Date(dataRecebimento) : null,
      },
      include: INCLUDE_LOTE,
    });

    return res.status(201).json({ dados: loteVacina, consolidado: false });
  } catch (err) {
    console.error('EstoqueVacinaController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar lote de vacina.' });
  }
};

// ─── Atualizar lote ──────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      lote, validade, qtdFrascos, dosesPorFrasco,
      validadeHoras, validadeDias, valorUnitario, valorUnitarioRepassado, dataRecebimento, ativo,
      estoqueMinimo, estoqueAlarmante,
    } = req.body;

    const existe = await prisma.loteVacina.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    if (estoqueMinimo    !== undefined && Number(estoqueMinimo)    < 0) return res.status(400).json({ error: 'Estoque mínimo não pode ser negativo.' });
    if (estoqueAlarmante !== undefined && Number(estoqueAlarmante) < 0) return res.status(400).json({ error: 'Estoque alarmante não pode ser negativo.' });

    const data = {};
    if (lote     !== undefined) data.lote     = lote?.trim() ?? null;
    if (validade !== undefined) data.validade = validade ? new Date(validade) : existe.validade;
    if (qtdFrascos !== undefined) {
      const frascos    = Number(qtdFrascos);
      const doses      = dosesPorFrasco !== undefined ? Number(dosesPorFrasco) : existe.dosesPorFrasco;
      const novoTotal  = frascos * doses;
      data.qtdFrascos     = frascos;
      data.dosesPorFrasco = doses;
      data.qtdTotal       = novoTotal;
      if (Number(existe.qtdDisponivel) === Number(existe.qtdTotal)) {
        data.qtdDisponivel = novoTotal;
      }
    } else if (dosesPorFrasco !== undefined) {
      data.dosesPorFrasco = Number(dosesPorFrasco);
    }
    if (validadeHoras          !== undefined) data.validadeHoras          = validadeHoras         != null ? Number(validadeHoras)          : null;
    if (validadeDias           !== undefined) data.validadeDias           = Number(validadeDias)  || 0;
    if (valorUnitario          !== undefined) data.valorUnitario          = valorUnitario         != null ? Number(valorUnitario)          : null;
    if (valorUnitarioRepassado !== undefined) data.valorUnitarioRepassado = valorUnitarioRepassado != null ? Number(valorUnitarioRepassado) : null;
    if (dataRecebimento        !== undefined) data.dataRecebimento        = dataRecebimento ? new Date(dataRecebimento) : null;
    if (ativo                  !== undefined) data.ativo                  = Boolean(ativo);
    if (estoqueMinimo          !== undefined) data.estoqueMinimo          = Number(estoqueMinimo)    || 0;
    if (estoqueAlarmante       !== undefined) data.estoqueAlarmante       = Number(estoqueAlarmante) || 0;

    const loteAtualizado = await prisma.loteVacina.update({ where: { id }, data, include: INCLUDE_LOTE });
    return res.json({ dados: loteAtualizado });
  } catch (err) {
    console.error('EstoqueVacinaController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar lote.' });
  }
};

// ─── Ativar / Inativar (toggle) ───────────────────────────────────────────────
// Mesma regra de /cadastro/fornecedores: um clique alterna o estado nos dois
// sentidos; a trilha (quem/quando) fica em `ativo_em`/`ativo_por_id`/
// `inativo_em`/`inativo_por_id` (lib/cadastroAtivacao.js). Justificativa
// OBRIGATÓRIA só para INATIVAR (migration 20260901000001) — ativar segue direto.

const toggle = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    const existe = await prisma.loteVacina.findUnique({
      where:   { id },
      include: { vacina: { select: { nome: true } }, medicamentoCat: { select: { nome: true } } },
    });
    if (!existe) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const vaiInativar = existe.ativo;

    if (vaiInativar && !motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da inativação' });
    }

    if (vaiInativar) {
      await registrarInativacao(prisma, 'lote_vacina', id, req.user.id, motivo.trim());
    } else {
      await registrarAtivacao(prisma, 'lote_vacina', id, req.user.id);
    }

    const nome = existe.medicamentoCat?.nome ?? existe.vacina?.nome ?? 'Vacina';
    await registrarAuditoria(null, req, {
      categoria:  'ALTERACAO',
      entidade:   'ESTOQUE_VACINA',
      entidadeId: id,
      motivo:     vaiInativar ? motivo.trim() : null,
      detalhes:   `${req.user.fullName ?? req.user.email} ${vaiInativar ? 'inativou' : 'ativou'} ${nome}${existe.lote ? ` — Lote ${existe.lote}` : ''}`,
    });

    const loteAtualizado = await prisma.loteVacina.findUnique({ where: { id }, include: INCLUDE_LOTE });
    const [comTrilha] = await anexarTrilha([loteAtualizado], 'lote_vacina');

    return res.json({
      dados:    comTrilha,
      mensagem: vaiInativar ? 'Lote inativado' : 'Lote ativado',
    });
  } catch (err) {
    console.error('EstoqueVacinaController.toggle:', err);
    return res.status(500).json({ error: 'Erro ao alternar status.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const existe = await prisma.loteVacina.findUnique({ where: { id }, include: { vacina: { select: { nome: true } } } });
    if (!existe) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });
    await prisma.loteVacina.update({ where: { id }, data: { ativo: false } });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'ESTOQUE_VACINA',
      entidadeId: id,
      motivo,
      detalhes:   [existe.vacina?.nome, existe.lote ? `Lote ${existe.lote}` : null].filter(Boolean).join(' — ') || null,
    });

    return res.json({ dados: { message: 'Lote inativado com sucesso.' } });
  } catch (err) {
    console.error('EstoqueVacinaController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao inativar lote.' });
  }
};

// ─── Ajuste de estoque (correção manual das doses disponíveis) ───────────────
// Espelha o Ajuste de Estoque da farmácia: informa a contagem real de doses e a
// diferença é registrada. Vacinas não têm tabela de movimento — o motivo é
// persistido no AuditLog (categoria AJUSTE). Recontagem acima do total registrado
// eleva o total (encontrou mais doses); abaixo, marca o lote como parcialmente usado.
const ajustar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { quantidade, motivo } = req.body ?? {};

    if (quantidade === undefined || quantidade === null || quantidade === '')
      return res.status(400).json({ error: 'Informe a quantidade de doses disponíveis.' });
    const nova = Number(quantidade);
    if (Number.isNaN(nova) || nova < 0)
      return res.status(400).json({ error: 'Quantidade inválida.' });
    if (!motivo?.trim())
      return res.status(400).json({ error: 'Informe o motivo do ajuste.' });

    const existe = await prisma.loteVacina.findUnique({
      where:   { id },
      include: { vacina: { select: { nome: true } }, medicamentoCat: { select: { nome: true } } },
    });
    if (!existe) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    if (nova === existe.qtdDisponivel)
      return res.status(400).json({ error: 'A quantidade informada é igual ao estoque atual.' });

    const data = { qtdDisponivel: nova };
    if (nova > existe.qtdTotal) data.qtdTotal = nova; // recontagem para cima eleva o total

    const loteAtualizado = await prisma.loteVacina.update({ where: { id }, data, include: INCLUDE_LOTE });

    const nome = existe.medicamentoCat?.nome ?? existe.vacina?.nome ?? 'Vacina';
    await registrarAuditoria(null, req, {
      categoria:  'AJUSTE',
      entidade:   'ESTOQUE_VACINA',
      entidadeId: id,
      motivo,
      detalhes:   `${nome}${existe.lote ? ` — Lote ${existe.lote}` : ''}: ${existe.qtdDisponivel} → ${nova} doses`,
    });

    return res.json({ dados: loteAtualizado });
  } catch (err) {
    console.error('EstoqueVacinaController.ajustar:', err);
    return res.status(500).json({ error: 'Erro ao ajustar estoque.' });
  }
};

// ─── Lotes disponíveis por medicamentoCatId (para seletor clínico) ───────────

const listarLotesDisponiveisPorMed = async (req, res) => {
  try {
    const { medicamentoCatId } = req.query;
    if (!medicamentoCatId) {
      return res.status(400).json({ error: 'medicamentoCatId é obrigatório.' });
    }

    const empresaId = req.empresaId ?? null;
    const hoje      = new Date();

    const where = {
      medicamentoCatId: Number(medicamentoCatId),
      ativo:            true,
      qtdDisponivel:    { gt: 0 },
      validade:         { gte: hoje },
      // FAIL-CLOSED: sem empresa resolvida, `-1` não casa com clínica alguma.
      //
      // ⚠️ Não usa `escopoCatalogoEmpresa`: aquele helper é de CATÁLOGO (nulo = linha
      // global compartilhada). LOTE DE VACINA é do estoque de UMA clínica — não existe
      // lote global —, e `tb_lotes_vacina.empresa_id` virou NOT NULL na fase 5. Com o
      // ramo `empresaId: null`, o Prisma recusa a consulta inteira.
      empresaId: empresaId ? Number(empresaId) : -1,
    };

    const lotes = await prisma.loteVacina.findMany({
      where,
      orderBy: { validade: 'asc' },
      select: {
        id: true, lote: true, validade: true,
        qtdDisponivel: true, qtdTotal: true,
        dosesPorFrasco: true,
        valorUnitario: true, valorUnitarioRepassado: true,
      },
    });

    const dados = lotes.map(l => {
      const valorBruto    = Number(l.valorUnitarioRepassado ?? l.valorUnitario ?? 0);
      const dosesPorFrasco = Number(l.dosesPorFrasco) || 1;
      return {
        id:            l.id,
        lote:          l.lote,
        validade:      l.validade,
        qtdDisponivel: l.qtdDisponivel,
        valorPorDose:  valorBruto / dosesPorFrasco,
      };
    });

    return res.json({ dados });
  } catch (err) {
    console.error('EstoqueVacinaController.listarLotesDisponiveisPorMed:', err);
    return res.status(500).json({ error: 'Erro ao listar lotes disponíveis.' });
  }
};

/**
 * Anexa multidose + conteúdo + forma de cálculo à lista do catálogo de vacinas.
 * EM BLOCO (uma consulta para a lista inteira), nunca um por item.
 */
async function anexarFormaCalculo(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  if (lista.length === 0) return lista;
  const mapa = await catalogoEmpresa.multidosePorItem(prisma, lista.map(i => i.id));
  return lista.map(i => ({
    ...i,
    multidose:         mapa.get(i.id)?.multidose ?? false,
    dosesPorEmbalagem: mapa.get(i.id)?.dosesPorEmbalagem ?? null,
    formaCalculo:      mapa.get(i.id)?.formaCalculo ?? null,
  }));
}

/**
 * O CONTEÚDO da embalagem gravado no ITEM do catálogo (tela de Produtos) — quanto cada
 * frasco rende, na Forma de Cálculo do produto.
 *
 * ⚠️ O nome ("doses") é o da coluna legada `doses_por_embalagem`, que até 2026-09-16
 * significava "N aplicações por frasco" e hoje é o conteúdo (20 mL). É este número que
 * vira `LoteVacina.dosesPorFrasco` e divide o preço do frasco na fatura.
 * ⚠️ `> 0`, não `>= 1`: conteúdo fracionário (0,5 mL) é cadastro legítimo desde que a
 * coluna virou `double precision`, e o piso em 1 o descartaria em silêncio.
 *
 * `0` quando não há coluna ou não há valor — o caller mantém o padrão de sempre.
 */
async function dosesDoCatalogo(medicamentoCatId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT doses_por_embalagem FROM schs2vet.tb_medicamentos
        WHERE id = $1 AND multidose = true AND doses_por_embalagem IS NOT NULL
          AND doses_por_embalagem > 0`,
      Number(medicamentoCatId),
    );
    return Number(rows?.[0]?.doses_por_embalagem ?? 0) || 0;
  } catch { return 0; }
}

module.exports = {
  listar,
  listarFabricantes,
  listarVacinasPorFabricante,
  listarCatalogoComEstoque,
  listarLotesDisponiveisPorMed,
  criar,
  atualizar,
  excluir,
  toggle,
  ajustar,
};
