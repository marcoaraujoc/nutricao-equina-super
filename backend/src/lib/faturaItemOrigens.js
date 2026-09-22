// backend/src/lib/faturaItemOrigens.js
//
// 🔴 AS ORIGENS DE UMA LINHA DE FATURA — a observação por baixo da cobrança.
//
// Até 2026-09-17 a linha da fatura era 1:1 com o registro que a originou: a chave de
// consolidação de `adicionarOuSomarFaturaItem` incluía a FK de origem, e a descrição
// carregava o número do atendimento (`[AG-0012] Amoxicilina — …`). Consequência: o
// MESMO medicamento, na MESMA dose e pelo MESMO preço, aplicado em dois atendimentos
// do mês, virava DUAS linhas idênticas fora o número — e o financeiro somava a olho.
//
// Agora a linha consolida por (tipo, descrição, animal, valor unitário) e cada
// execução vira uma CONTRIBUIÇÃO registrada aqui: de qual registro veio, quando e
// quantas unidades. É essa lista que a fatura mostra como observação, com o número
// clicável para o registro de origem.
//
// ⚠️ **ESTA TABELA É O QUE MANTÉM O ESTORNO CERTO.** A FK de origem em
// `tb_fatura_itens` sozinha não comporta uma linha compartilhada: cancelar uma das
// prescrições apagaria a linha inteira e levaria embora a cobrança das outras. Com as
// contribuições, `removerFaturaItensDaOrigem` SUBTRAI o que era daquela origem e só
// apaga a linha quando não sobra contribuição nenhuma.
//
// ⚠️ INVARIANTE: `FaturaItem.quantidade` = soma das `quantidade` das contribuições
// dele. Quem lança item COM origem passa por aqui; quem não tem origem (lançamento
// manual do financeiro, assistência mensal) simplesmente não tem contribuição — e aí
// a linha se comporta como sempre se comportou.
//
// ⚠️ TUDO POR SQL CRU, com `catch`: a tabela é nova (migration
// 20261015000000_fatura_item_origens) e o client Prisma pode não conhecê-la — no
// Windows o `prisma generate` falha com o backend rodando (CLAUDE.md §11). Base ainda
// não migrada devolve lista vazia / `null`, e TODO o caminho cai no comportamento
// anterior — nunca em erro na tela.
'use strict';

/** Campo de origem aceito no payload → coluna real da tabela. */
const COLUNA_ORIGEM = {
  exameClinicoId:          'exame_clinico_id',
  prescricaoId:            'prescricao_id',
  vacinaClinicaId:         'vacina_clinica_id',
  encaminhamentoClinicoId: 'encaminhamento_clinico_id',
};

const CAMPOS_ORIGEM = Object.keys(COLUNA_ORIGEM);

/** A origem informada no payload, ou null quando o lançamento não tem nenhuma. */
function origemDoPayload(opts = {}) {
  for (const campo of CAMPOS_ORIGEM) {
    const valor = opts[campo];
    if (valor != null) return { campo, id: Number(valor) };
  }
  return null;
}

/**
 * Registra a contribuição de uma execução na linha da fatura.
 *
 * ⚠️ Best-effort de propósito: perder a OBSERVAÇÃO não pode derrubar a execução
 * clínica nem desfazer a cobrança que acabou de ser lançada. Sem a linha aqui a
 * fatura continua com o valor certo — o que se perde é o detalhe de onde ele veio.
 *
 * ⚠️ `NOW() AT TIME ZONE 'UTC'`, nunca `NOW()` puro: a coluna é `timestamp` sem fuso
 * e o Prisma a lê como UTC naive — com `NOW()` a hora local entraria disfarçada de
 * UTC e a observação sairia 3h atrasada na tela (CLAUDE.md §6).
 *
 * @returns {Promise<boolean>} true quando gravou
 */
async function registrarOrigem(tx, { faturaItemId, quantidade = 1, ocorridoEm = null, ...origem }) {
  const de = origemDoPayload(origem);
  if (!faturaItemId || !de) return false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_fatura_item_origens
         (fatura_item_id, ${COLUNA_ORIGEM[de.campo]}, quantidade, ocorrido_em)
       VALUES ($1, $2, $3, COALESCE($4::timestamp, NOW() AT TIME ZONE 'UTC'))`,
      Number(faturaItemId), de.id, Number(quantidade) || 1,
      ocorridoEm ? new Date(ocorridoEm) : null,
    );
    return true;
  } catch {
    return false; // base sem a tabela — a linha da fatura já foi lançada
  }
}

/**
 * Contribuições de uma ou mais linhas, JÁ resolvidas para exibição.
 *
 * O número e o destino do clique saem do registro de origem:
 *   prescrição     → nº do ATENDIMENTO da evolução do grupo (AG-0012 / EV-0007)
 *   vacina         → VC-0004 (a vacina é o registro de origem dela mesma)
 *   exame          → EX-0004
 *   encaminhamento → nº do atendimento da evolução
 *
 * ⚠️ O nº do atendimento é montado por `formatAtendimentoNum`, NUNCA à mão — escrever
 * `AG-${numero}` aqui produziria um formato que o resto do sistema não reconheceria
 * como o mesmo número (CLAUDE.md, nº do atendimento).
 *
 * @returns {Promise<Map<number, Array<object>>>} faturaItemId → contribuições (mais antiga primeiro)
 */
async function origensPorItem(client, faturaItemIds) {
  const ids = [...new Set((faturaItemIds ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (ids.length === 0) return mapa;

  let linhas = [];
  try {
    linhas = await client.$queryRawUnsafe(
      `SELECT o.id,
              o.fatura_item_id            AS "faturaItemId",
              o.quantidade::float         AS quantidade,
              o.ocorrido_em               AS "ocorridoEm",
              o.prescricao_id             AS "prescricaoId",
              o.vacina_clinica_id         AS "vacinaClinicaId",
              o.exame_clinico_id          AS "exameClinicoId",
              o.encaminhamento_clinico_id AS "encaminhamentoClinicoId",
              vc.numero                   AS "vacinaNumero",
              vc."animalId"               AS "vacinaAnimalId",
              ex.numero                   AS "exameNumero",
              ev.id                       AS "evolucaoId",
              ev.numero                   AS "evolucaoNumero",
              ev.tipo_atendimento         AS "tipoAtendimento",
              ev.agendamento_id           AS "agendamentoId",
              ev."animalId"               AS "evolucaoAnimalId"
         FROM schs2vet.tb_fatura_item_origens o
         LEFT JOIN schs2vet.tb_prescricoes p        ON p.id  = o.prescricao_id
         LEFT JOIN schs2vet.tb_prescricao_grupos g  ON g.id  = p."grupoId"
         LEFT JOIN schs2vet.tb_vacinas_clinicas vc  ON vc.id = o.vacina_clinica_id
         LEFT JOIN schs2vet.tb_exames_clinicos ex   ON ex.id = o.exame_clinico_id
         LEFT JOIN schs2vet.tb_encaminhamentos_clinicos en ON en.id = o.encaminhamento_clinico_id
         LEFT JOIN schs2vet.tb_evolucoes_clinicas ev
                ON ev.id = COALESCE(g.evolucao_id, vc.evolucao_id, ex.evolucao_id, en.evolucao_id)
        WHERE o.fatura_item_id = ANY($1::int[])
        ORDER BY o.ocorrido_em ASC, o.id ASC`,
      ids,
    );
  } catch {
    return mapa; // base sem a tabela — a fatura sai sem observação, como antes
  }

  const { formatAtendimentoNum } = require('./faturaUtils');
  for (const l of linhas) {
    const atendimento = formatAtendimentoNum(l.tipoAtendimento, l.evolucaoNumero);
    // A VACINA é o registro de origem dela mesma: o clique vai para a tela de Vacina,
    // não para a evolução. Sem número gravado (legado) cai no nº do atendimento — e
    // sem nenhum dos dois a contribuição ainda aparece, só não vira link.
    const ehVacina = l.vacinaClinicaId != null;
    const ehExame  = l.exameClinicoId != null;
    const numero = ehVacina
      ? (l.vacinaNumero != null ? `VC-${String(l.vacinaNumero).padStart(4, '0')}` : atendimento)
      : (ehExame && l.exameNumero != null
          ? `EX-${String(l.exameNumero).padStart(4, '0')}`
          : atendimento);

    const item = Number(l.faturaItemId);
    if (!mapa.has(item)) mapa.set(item, []);
    mapa.get(item).push({
      id:         Number(l.id),
      quantidade: Number(l.quantidade) || 0,
      data:       l.ocorridoEm,
      numero:     numero ?? null,
      // Destino do clique. `vacinaId` manda a tela para /clinica/vacina/:animalId?item=;
      // `evolucaoId` + `animalId` mandam para o atendimento. Quem decide é a tela.
      vacinaId:      ehVacina ? Number(l.vacinaClinicaId) : null,
      evolucaoId:    l.evolucaoId != null ? Number(l.evolucaoId) : null,
      agendamentoId: l.agendamentoId != null ? Number(l.agendamentoId) : null,
      animalId: l.vacinaAnimalId != null
        ? Number(l.vacinaAnimalId)
        : (l.evolucaoAnimalId != null ? Number(l.evolucaoAnimalId) : null),
    });
  }
  return mapa;
}

/**
 * 🔴 ESTE REGISTRO JÁ FOI FATURADO? — a pergunta que a FK sozinha deixou de responder.
 *
 * `faturaItem.findFirst({ where: { vacinaClinicaId: X } })` era a prova de que a
 * vacina X tinha sido cobrada. Com a linha COMPARTILHADA, a FK guarda só a origem
 * PRINCIPAL (a primeira): a segunda vacina a cair na mesma linha foi cobrada e a FK
 * não a menciona — a consulta antiga responderia "não faturada".
 *
 * Não é detalhe de leitura: é esse "sim" que, no CANCELAMENTO da vacina, prova que o
 * lote foi debitado e autoriza devolver as doses ao estoque. Um falso "não" ali deixa
 * o estoque ENCOLHIDO em silêncio — exatamente o bug que o cheque veio corrigir em
 * 2026-08-18, por outro caminho.
 *
 * @returns {Promise<boolean>}
 */
async function origemJaFaturada(client, campo, origemId) {
  const porFk = await client.faturaItem.findFirst({
    where: { [campo]: Number(origemId) }, select: { id: true },
  });
  if (porFk) return true;
  const contribs = await contribuicoesDaOrigem(client, campo, origemId);
  return contribs.length > 0;
}

/**
 * Quantidade que uma origem contribuiu em cada linha da fatura.
 *
 * É o que `removerFaturaItensDaOrigem` precisa saber para SUBTRAIR em vez de apagar:
 * a linha pode ter doses de outras prescrições que continuam devidas.
 *
 * @returns {Promise<Array<{faturaItemId:number, quantidade:number, contribuicoes:number}>>}
 */
async function contribuicoesDaOrigem(tx, campo, origemId) {
  const coluna = COLUNA_ORIGEM[campo];
  if (!coluna) return [];
  try {
    const linhas = await tx.$queryRawUnsafe(
      `SELECT fatura_item_id AS "faturaItemId",
              SUM(quantidade)::float AS quantidade,
              COUNT(*)::int AS contribuicoes
         FROM schs2vet.tb_fatura_item_origens
        WHERE ${coluna} = $1
        GROUP BY fatura_item_id`,
      Number(origemId),
    );
    return linhas.map(l => ({
      faturaItemId:  Number(l.faturaItemId),
      quantidade:    Number(l.quantidade) || 0,
      contribuicoes: Number(l.contribuicoes) || 0,
    }));
  } catch {
    return [];
  }
}

/** Apaga as contribuições de uma origem. Devolve quantas linhas saíram. */
async function apagarContribuicoes(tx, campo, origemId) {
  const coluna = COLUNA_ORIGEM[campo];
  if (!coluna) return 0;
  try {
    return await tx.$executeRawUnsafe(
      `DELETE FROM schs2vet.tb_fatura_item_origens WHERE ${coluna} = $1`,
      Number(origemId),
    );
  } catch {
    return 0;
  }
}

/**
 * Quantas contribuições a linha ainda tem (e quanto elas somam).
 *
 * `null` = NÃO DEU PARA SABER (tabela ausente). ⚠️ `null` não é zero: quem chama tem
 * de tratar "não sei" como "não mexa", nunca como "pode apagar" — colapsar os dois
 * apagaria a linha compartilhada numa base sem a tabela.
 */
async function resumoDaLinha(tx, faturaItemId) {
  try {
    const linhas = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(quantidade), 0)::float AS quantidade
         FROM schs2vet.tb_fatura_item_origens
        WHERE fatura_item_id = $1`,
      Number(faturaItemId),
    );
    const l = linhas[0] ?? {};
    return { total: Number(l.total) || 0, quantidade: Number(l.quantidade) || 0 };
  } catch {
    return null;
  }
}

/**
 * A linha da fatura tem contribuição de ALGUMA outra origem além desta?
 *
 * Usado antes de reaproveitar, renomear ou reprecificar uma linha por conta de UMA
 * origem: com a linha compartilhada, fazer isso reescreveria o que as outras já
 * cobraram. `null` (não sei) é tratado como "pode ser" por quem chama.
 */
async function temOutraOrigem(tx, faturaItemId, campo, origemId) {
  const coluna = COLUNA_ORIGEM[campo];
  if (!coluna) return null;
  try {
    const linhas = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS fora
         FROM schs2vet.tb_fatura_item_origens
        WHERE fatura_item_id = $1 AND (${coluna} IS DISTINCT FROM $2)`,
      Number(faturaItemId), Number(origemId),
    );
    return (Number(linhas[0]?.fora) || 0) > 0;
  } catch {
    return null;
  }
}

/**
 * Reaponta a FK de origem da LINHA para a contribuição mais antiga que restou.
 *
 * A FK em `tb_fatura_itens` continua existindo e continua sendo a origem PRINCIPAL da
 * linha — é dela que saem o link do cabeçalho, o agrupamento do insumo (seringa/agulha)
 * e os relatórios que filtram por origem. Quando a origem principal é estornada e a
 * linha SOBREVIVE (porque outra prescrição também contribuiu), a FK precisa passar
 * para quem ficou; senão ela aponta para um registro que foi cancelado.
 */
async function reapontarOrigemPrincipal(tx, faturaItemId) {
  try {
    await tx.$executeRawUnsafe(
      `UPDATE schs2vet.tb_fatura_itens fi
          SET "exameClinicoId"          = o.exame_clinico_id,
              "prescricaoId"            = o.prescricao_id,
              "vacinaClinicaId"         = o.vacina_clinica_id,
              "encaminhamentoClinicoId" = o.encaminhamento_clinico_id
         FROM (SELECT * FROM schs2vet.tb_fatura_item_origens
                WHERE fatura_item_id = $1
                ORDER BY ocorrido_em ASC, id ASC
                LIMIT 1) o
        WHERE fi.id = $1`,
      Number(faturaItemId),
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  COLUNA_ORIGEM,
  CAMPOS_ORIGEM,
  origemDoPayload,
  registrarOrigem,
  origemJaFaturada,
  origensPorItem,
  contribuicoesDaOrigem,
  apagarContribuicoes,
  resumoDaLinha,
  temOutraOrigem,
  reapontarOrigemPrincipal,
};
