'use strict';
/**
 * VENCIMENTO DA CONTA A PAGAR — quando o que a clínica DEVE vence (2026-09-22)
 *
 * 🔴 FONTE ÚNICA da regra, para os dois lados: o CADASTRO (validar o que o fornecedor
 * ou o prestador declarou) e a TELA DE PAGAMENTOS (dizer a data e se já passou).
 * Duas implementações divergiriam na primeira correção — e o que divergiria é a data
 * em que a clínica acha que precisa pagar.
 *
 * 🔴 A FORMA É A MESMA DO FECHAMENTO DA FATURA (`EmpresaConfiguracao.tipoFechamento`):
 * DIA_FIXO | DIA_UTIL | ULTIMO_DIA_MES + o número que só tem sentido dentro dela.
 * Foi assim que o pedido veio ("da mesma forma como é feito hoje na tela de fechamento
 * da fatura"), e é o que permite reusar `nEsimoDiaUtil` — o cálculo de dia útil já
 * considera fim de semana e feriado nacional, e escrever um segundo faria a mesma
 * conta dar respostas diferentes em duas telas.
 *
 * ⚠️ NULL = NÃO DECLARADO, e isso NÃO é "vence hoje". Sem vencimento no cadastro a
 * conta não tem data e NUNCA atrasa — é o comportamento que a base inteira tinha
 * antes da migration `20261020000000`, e por isso ela não tem backfill.
 *
 * ⚠️ O vencimento é no mês SEGUINTE ao de referência, igual à fatura
 * (`marcarFaturasAtrasadas` em server.ts): a conta de setembro fecha no fim de
 * setembro e vence em outubro. Vencer dentro do próprio mês faria a conta nascer
 * atrasada em todo lançamento feito depois do dia configurado.
 */

const { nEsimoDiaUtil } = require('./faturaUtils');

const TIPOS_VENCIMENTO = ['DIA_FIXO', 'DIA_UTIL', 'ULTIMO_DIA_MES'];

/** Limite do "dia" conforme a forma — o mesmo de `EquipeController.salvarConfiguracao`. */
const LIMITE_DIA = { DIA_FIXO: 28, DIA_UTIL: 10 };

/**
 * Valida e normaliza o par (tipo, dia) vindo de um formulário.
 *
 * Devolve `{ erro }` ou `{ dados: { tipoVencimento, diaVencimento } }`. Campo ausente
 * no corpo devolve `{ dados: null }` — "não mexer", que é diferente de "limpar":
 * um PUT parcial não pode apagar o vencimento que ninguém tocou.
 */
function resolverVencimento(body = {}) {
  const tipoBruto = body.tipoVencimento;
  const diaBruto  = body.diaVencimento;
  if (tipoBruto === undefined && diaBruto === undefined) return { dados: null };

  // String vazia / null = o cadastro voltou a não declarar vencimento.
  if (tipoBruto === '' || tipoBruto === null) {
    return { dados: { tipoVencimento: null, diaVencimento: null } };
  }
  if (!TIPOS_VENCIMENTO.includes(tipoBruto)) {
    return { erro: `Forma de vencimento inválida. Use uma de: ${TIPOS_VENCIMENTO.join(', ')}.` };
  }
  if (tipoBruto === 'ULTIMO_DIA_MES') {
    return { dados: { tipoVencimento: 'ULTIMO_DIA_MES', diaVencimento: null } };
  }

  const n = Number(diaBruto);
  const limite = LIMITE_DIA[tipoBruto];
  if (!Number.isInteger(n) || n < 1 || n > limite) {
    return {
      erro: tipoBruto === 'DIA_UTIL'
        // 1 a 10: acima disso um mês curto pode não ter o dia útil pedido, e a conta
        // ficaria sem data em fevereiro e com data em março.
        ? 'O dia útil do vencimento deve estar entre 1 e 10.'
        // 1 a 28 para existir em TODO mês do ano — a mesma razão do dia de fechamento.
        : 'O dia do vencimento deve estar entre 1 e 28.',
    };
  }
  return { dados: { tipoVencimento: tipoBruto, diaVencimento: n } };
}

/**
 * A data em que a conta do mês `mesReferencia` ("2026-09") vence.
 *
 * ⚠️ Fim do dia (23:59:59.999): a conta não está atrasada ÀS 00:01 do dia em que
 * vence — ela vence no decorrer dele. Mesma escolha de `marcarFaturasAtrasadas`.
 * ⚠️ `Date` local, não UTC: o vencimento é um DIA DE CALENDÁRIO acordado com o
 * credor, e convertê-lo para instante UTC o jogaria para o dia anterior à noite.
 */
function calcularVencimento({ tipoVencimento, diaVencimento }, mesReferencia) {
  if (!tipoVencimento || !mesReferencia) return null;
  const [ano, mes] = String(mesReferencia).split('-').map(Number);
  if (!ano || !mes) return null;

  // `mes` é 1-based e vira monthIndex → o mês SEGUINTE ao de referência.
  const fimDoMesSeguinte = new Date(ano, mes + 1, 0);

  if (tipoVencimento === 'ULTIMO_DIA_MES') {
    return new Date(ano, mes + 1, 0, 23, 59, 59, 999);
  }
  if (tipoVencimento === 'DIA_UTIL') {
    const d = nEsimoDiaUtil(Number(diaVencimento), new Date(ano, mes, 1));
    // Mês sem o N-ésimo dia útil pedido cai no ÚLTIMO dia — nunca em "sem data",
    // que faria a conta sumir do controle de atraso naquele mês só.
    const alvo = d ?? fimDoMesSeguinte;
    return new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate(), 23, 59, 59, 999);
  }
  // DIA_FIXO — clamp no último dia do mês, igual a `diaFixoBateHoje`: dia 31 acordado
  // com o credor vence em 28/02, nunca em 03/03.
  // ⚠️ `mes` (1-based) usado como monthIndex JÁ É o mês seguinte ao de referência.
  const dia = Math.min(Number(diaVencimento) || 1, fimDoMesSeguinte.getDate());
  return new Date(ano, mes, dia, 23, 59, 59, 999);
}

/**
 * O status que a TELA mostra — o gravado, ou ATRASADA quando ele é FECHADA e o
 * vencimento já passou.
 *
 * 🔴 ATRASADA É DERIVADA, NÃO GRAVADA. A fatura persiste o dela porque ~20 leitores
 * dependem da coluna e um cron é o único lugar que os serve de uma vez; a conta a
 * pagar tem UM leitor (a tela de Pagamentos), então derivar é mais simples e sempre
 * atual — não existe a janela entre o vencimento e a próxima passada do cron.
 *
 * ⚠️ Só a FECHADA atrasa. ABERTA/REABERTA ainda recebem lançamento (o mês não
 * terminou de ser apurado), PAGA já foi quitada e CANCELADA deixou de valer.
 */
function statusExibicao(status, vencimentoEm, agora = new Date()) {
  if (status !== 'FECHADA') return status;
  if (!vencimentoEm) return status;
  return agora > new Date(vencimentoEm) ? 'ATRASADA' : status;
}

// ─── Persistência: SQL CRU, pelo motivo de sempre ───────────────────────────
//
// ⚠️ As colunas são da migration `20261020000000`, e no Windows o `prisma generate`
// falha com o backend rodando (§11). Passá-las ao `fornecedor.update` TIPADO com o
// client defasado derrubaria o CADASTRO INTEIRO — não só o campo novo. Mesmo padrão de
// `lib/formasRecebimentoFatura.js` e `lib/animalFei.js`: SQL cru, guarda de coluna e
// falha silenciosa que preserva o resto do salvar.

const TABELAS = {
  FORNECEDOR: 'tb_fornecedores',
  PRESTADOR:  'tb_prestadores',
};

/** A base já tem as colunas? Cacheado por tabela, como `contasPagar.temTabelas`. */
const _temColuna = {};
async function temColuna(client, tabela) {
  if (_temColuna[tabela] !== undefined) return _temColuna[tabela];
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = $1
          AND column_name = 'tipo_vencimento'`, tabela);
    _temColuna[tabela] = rows.length > 0;
  } catch {
    // ⚠️ Falha de CONSULTA não é "a coluna não existe": cravar `false` num soluço do
    // banco faria o vencimento deixar de ser gravado em silêncio. Sem resposta
    // anterior devolve `false` SEM cachear, para a próxima chamada perguntar de novo.
    return false;
  }
  return _temColuna[tabela];
}

/**
 * Grava o vencimento de um credor. `dados` vem de `resolverVencimento`; `null` ali
 * significa "o corpo não mencionou o campo" e NÃO escreve nada — um PUT parcial não
 * pode apagar o vencimento que ninguém tocou.
 */
async function gravarVencimento(client, entidade, id, dados) {
  const tabela = TABELAS[entidade];
  if (!tabela || !id || !dados) return false;
  if (!(await temColuna(client, tabela))) return false;
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.${tabela}
          SET tipo_vencimento = $2, dia_vencimento = $3
        WHERE id = $1`,
      Number(id), dados.tipoVencimento ?? null,
      dados.diaVencimento == null ? null : Number(dados.diaVencimento),
    );
    return true;
  } catch (err) {
    console.error('vencimentoCredor.gravarVencimento:', err.message);
    return false;
  }
}

/**
 * Anexa `tipoVencimento`/`diaVencimento` a uma LISTA de registros já lidos.
 *
 * ⚠️ UMA consulta para a lista inteira, nunca uma por linha: a tela de cadastro traz
 * dezenas de credores por página.
 * ⚠️ A listagem TEM de devolver o campo — sem ele a edição abriria com o vencimento em
 * branco e o salvar o APAGARIA em silêncio (a lição do `temposConsulta`, 2026-07-28).
 */
async function anexarVencimentoEmLista(client, entidade, registros) {
  const tabela = TABELAS[entidade];
  const lista  = Array.isArray(registros) ? registros : [];
  if (!tabela || lista.length === 0) return lista;
  if (!(await temColuna(client, tabela))) return lista;
  try {
    const ids = lista.map(r => Number(r.id)).filter(Boolean);
    if (ids.length === 0) return lista;
    const ph  = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id, tipo_vencimento, dia_vencimento
         FROM schs2vet.${tabela} WHERE id IN (${ph})`, ...ids);
    const porId = new Map(rows.map(r => [r.id, r]));
    return lista.map(r => ({
      ...r,
      tipoVencimento: porId.get(r.id)?.tipo_vencimento ?? null,
      diaVencimento:  porId.get(r.id)?.dia_vencimento  ?? null,
    }));
  } catch (err) {
    console.error('vencimentoCredor.anexarVencimentoEmLista:', err.message);
    return lista;
  }
}

/** Um registro só — o `obterPorId` das telas de cadastro. */
async function anexarVencimento(client, entidade, registro) {
  if (!registro) return registro;
  const [r] = await anexarVencimentoEmLista(client, entidade, [registro]);
  return r ?? registro;
}

module.exports = {
  TIPOS_VENCIMENTO,
  LIMITE_DIA,
  TABELAS,
  resolverVencimento,
  calcularVencimento,
  statusExibicao,
  gravarVencimento,
  anexarVencimento,
  anexarVencimentoEmLista,
};
