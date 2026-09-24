// backend/src/lib/etapaExecucaoPrescricao.js
// ETAPA DE EXECUÇÃO DE PRESCRIÇÃO OPCIONAL POR EMPRESA — coluna
// `dispensar_execucao_prescricao` de tb_empresa_configuracoes
// (migration 20261023000000).
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE A OPÇÃO MUDA
// ─────────────────────────────────────────────────────────────────────────────
//   false (PADRÃO) → como sempre: a prescrição/vacina FINALIZADA vai para a tela de
//                    Execução de Prescrição, e a fatura, a baixa de estoque, o recibo e
//                    a conta a pagar do prestador nascem na EXECUÇÃO (dose a dose).
//   true           → a clínica NÃO tem a etapa de execução. Tudo isso passa a nascer na
//                    FINALIZAÇÃO — da prescrição (medicamento e procedimento) e da
//                    vacina —, pelo curso INTEIRO, e o documento já nasce EXECUTADO.
//
// ⚠️ `false` é o comportamento histórico — é por isso que a coluna tem DEFAULT false e
// a migration não tem backfill. A opção NUNCA nasce marcada.
//
// ⚠️ O que o proprietário aplica em casa e o que o cliente fornece seguem a MATRIZ de
// sempre ("quem FORNECE × quem APLICA", `PrescricaoGrupoController.finalizar`): esta
// opção só antecipa o momento da cobrança do que a CLÍNICA aplica.
//
// ⚠️ Prescrição/vacina finalizada ANTES de ligar a opção continua FINALIZADA e segue
// para o plantão — o que já está na fila não é reprocessado. É por isso que a tela de
// Execução de Prescrição continua existindo com a opção ligada.
//
// ⚠️ SQL CRU (mesma razão de formaCobrancaEstoque/validadeOrcamento): no Windows o
// `prisma generate` falha com o backend rodando, e passar um campo que o client ainda
// não conhece ao update derrubaria o SALVAR de Configurações INTEIRO. E
// `tb_empresa_configuracoes` NÃO tem @map nas FKs — as colunas chamam-se
// "empresaId"/"equipeId" (camelCase) e EXIGEM aspas (armadilha 41 do CLAUDE.md).
'use strict';

const TTL_MS = 60_000;
const cache  = new Map(); // empresaId → { valor, expiraEm }

function invalidarCache(empresaId = null) {
  if (empresaId == null) cache.clear();
  else cache.delete(Number(empresaId));
}

/**
 * Normaliza o que veio do request (multipart manda string).
 * `undefined` → não altera (PATCH parcial). Retorna { erro } ou { valor: boolean|undefined }.
 */
function normalizarDispensa(bruto) {
  if (bruto === undefined) return { valor: undefined };
  if (bruto === true || bruto === false) return { valor: bruto };
  const s = String(bruto ?? '').trim().toLowerCase();
  if (['true', '1', 'sim', 'on'].includes(s))          return { valor: true };
  if (['false', '0', 'nao', 'não', 'off', ''].includes(s)) return { valor: false };
  return { erro: 'Valor inválido para a etapa de execução de prescrição.' };
}

/** Lê do ESCOPO exato (empresa CNPJ = equipeId null; pessoal = equipe). Nunca lança. */
async function lerDoEscopo(client, empresaId, equipeId = null) {
  try {
    const rows = equipeId == null
      ? await client.$queryRawUnsafe(
          `SELECT dispensar_execucao_prescricao AS v FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`, Number(empresaId))
      : await client.$queryRawUnsafe(
          `SELECT dispensar_execucao_prescricao AS v FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`, Number(empresaId), Number(equipeId));
    return rows?.[0]?.v === true;
  } catch {
    // Coluna ainda não existe (migration não aplicada) → comportamento de sempre.
    return false;
  }
}

/**
 * A empresa DISPENSA a etapa de execução? Nunca falha e nunca devolve null: quem chama
 * está decidindo se cobra agora ou no plantão — na dúvida, o comportamento de sempre.
 *
 * 🔴 Procura primeiro a linha da EMPRESA (equipeId null) e, não achando, a de uma
 * equipe daquela empresa — empresa pessoal (CPF) configura POR EQUIPE, e sem esse
 * fallback ela nunca enxergaria a própria escolha. Mesma resolução de
 * `formaCobrancaEstoque.lerForma` e de `fusoDaEmpresa`.
 */
async function execucaoDispensada(client, empresaId) {
  if (!empresaId) return false;
  const id    = Number(empresaId);
  const agora = Date.now();
  const hit   = cache.get(id);
  if (hit && hit.expiraEm > agora) return hit.valor;

  let valor = false;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT dispensar_execucao_prescricao AS v
         FROM schs2vet.tb_empresa_configuracoes
        WHERE "empresaId" = $1
        ORDER BY "equipeId" NULLS FIRST LIMIT 1`, id);
    valor = rows?.[0]?.v === true;
  } catch {
    // Migration não aplicada: segue no padrão (fatura na execução), como sempre foi.
  }
  cache.set(id, { valor, expiraEm: agora + TTL_MS });
  return valor;
}

/**
 * Grava no escopo. A linha de configuração já existe quando isto roda.
 *
 * ⚠️ Base sem a coluna (migration não aplicada): gravar `false` é o que já vale, então
 * é ignorado em silêncio — a tela manda o campo SEMPRE, e derrubar o salvar de
 * Configurações inteiro por causa dele travaria logo, expediente e fechamento. Gravar
 * `true` NÃO é ignorado: devolve 400 dizendo o que falta, porque fingir que a opção foi
 * ligada faria a clínica esperar uma cobrança na finalização que nunca aconteceria.
 */
async function salvarDispensa(client, empresaId, equipeId, valor) {
  if (valor === undefined) return;
  const v = valor === true;
  try {
    if (equipeId == null) {
      await client.$executeRawUnsafe(
        `UPDATE schs2vet.tb_empresa_configuracoes SET dispensar_execucao_prescricao = $2
          WHERE "empresaId" = $1 AND "equipeId" IS NULL`, Number(empresaId), v);
    } else {
      await client.$executeRawUnsafe(
        `UPDATE schs2vet.tb_empresa_configuracoes SET dispensar_execucao_prescricao = $2
          WHERE "empresaId" = $1 AND "equipeId" = $3`, Number(empresaId), v, Number(equipeId));
    }
  } catch (err) {
    const semColuna = err?.meta?.code === '42703' || /dispensar_execucao_prescricao/.test(String(err?.message ?? ''));
    if (!semColuna) throw err;
    if (!v) return;
    const e = new Error('A opção de dispensar a Execução de Prescrição ainda não está disponível nesta base (migration 20261023000000 pendente).');
    e.status = 400;
    throw e;
  } finally {
    invalidarCache(empresaId);
  }
}

module.exports = {
  normalizarDispensa, lerDoEscopo, execucaoDispensada, salvarDispensa, invalidarCache,
};
