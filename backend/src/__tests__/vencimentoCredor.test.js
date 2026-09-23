'use strict';
/**
 * VENCIMENTO DO CREDOR E O CICLO DA CONTA A PAGAR (2026-09-22)
 *
 * Trava, juntos, os dois lados da regra: o CADASTRO que declara quando a conta vence e
 * a TELA que obedece. Cada caso aqui existe por um modo de falha SILENCIOSO — coisa que
 * nem `tsc` nem `node --check` pegam, e que só aparece semanas depois no fechamento do
 * mês.
 */

const fs   = require('fs');
const path = require('path');

const {
  TIPOS_VENCIMENTO, resolverVencimento, calcularVencimento, statusExibicao,
} = require('../lib/vencimentoCredor');

const raiz = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const lerFront = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');

const dia = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : null);

// ─────────────────────────────────────────────────────────────────────────────
describe('calcularVencimento — a data acordada com o credor', () => {
  it('DIA_FIXO vence no dia escolhido do mês SEGUINTE ao de referência', () => {
    // O mês fecha e só então vence. Vencer DENTRO do próprio mês faria a conta nascer
    // atrasada em todo lançamento feito depois do dia configurado.
    expect(dia(calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 10 }, '2026-09')))
      .toBe('10/10/2026');
  });

  it('DIA_FIXO atravessa a virada de ano', () => {
    expect(dia(calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 10 }, '2026-12')))
      .toBe('10/01/2027');
  });

  it('DIA_FIXO faz CLAMP no último dia do mês curto', () => {
    // Dia 31 acordado com o credor vence em 28/02, nunca em 03/03 — a mesma regra de
    // `diaFixoBateHoje` no fechamento da fatura.
    expect(dia(calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 31 }, '2026-01')))
      .toBe('28/02/2026');
  });

  it('ULTIMO_DIA_MES vence no último dia do mês seguinte', () => {
    expect(dia(calcularVencimento({ tipoVencimento: 'ULTIMO_DIA_MES', diaVencimento: null }, '2026-09')))
      .toBe('31/10/2026');
  });

  it('DIA_UTIL pula fim de semana e feriado (reusa `nEsimoDiaUtil` da fatura)', () => {
    // Out/2026: 01 (qui) 02 (sex) 05 06 07 → o 5º dia útil é 07/10. Uma segunda conta
    // de dia útil daria respostas diferentes para a mesma regra em duas telas.
    expect(dia(calcularVencimento({ tipoVencimento: 'DIA_UTIL', diaVencimento: 5 }, '2026-09')))
      .toBe('07/10/2026');
  });

  it('vence no FIM do dia, não às 00:00', () => {
    // A conta não está atrasada às 00:01 do dia em que vence — ela vence no decorrer
    // dele. Mesma escolha de `marcarFaturasAtrasadas`.
    const d = calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 10 }, '2026-09');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it('sem tipo declarado NÃO há vencimento — e isso não é "vence hoje"', () => {
    expect(calcularVencimento({ tipoVencimento: null, diaVencimento: null }, '2026-09')).toBeNull();
  });

  it('mês de referência ausente ou inválido devolve null, nunca uma data inventada', () => {
    expect(calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 10 }, null)).toBeNull();
    expect(calcularVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 10 }, 'xx')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolverVencimento — o que o cadastro aceita', () => {
  it('corpo SEM os campos devolve null = "não mexer"', () => {
    // Um PUT parcial não pode apagar o vencimento que ninguém tocou.
    expect(resolverVencimento({}).dados).toBeNull();
    expect(resolverVencimento({ nome: 'x' }).dados).toBeNull();
  });

  it('string vazia LIMPA o vencimento — que é diferente de "não mexer"', () => {
    expect(resolverVencimento({ tipoVencimento: '' }).dados)
      .toEqual({ tipoVencimento: null, diaVencimento: null });
    expect(resolverVencimento({ tipoVencimento: null }).dados)
      .toEqual({ tipoVencimento: null, diaVencimento: null });
  });

  it('ULTIMO_DIA_MES zera o dia — número esquecido ali voltaria a valer sozinho', () => {
    expect(resolverVencimento({ tipoVencimento: 'ULTIMO_DIA_MES', diaVencimento: 9 }).dados)
      .toEqual({ tipoVencimento: 'ULTIMO_DIA_MES', diaVencimento: null });
  });

  it('DIA_FIXO aceita 1 a 28 — para existir em TODO mês do ano', () => {
    expect(resolverVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 28 }).dados)
      .toEqual({ tipoVencimento: 'DIA_FIXO', diaVencimento: 28 });
    expect(resolverVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 29 }).erro).toBeTruthy();
    expect(resolverVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 0 }).erro).toBeTruthy();
    expect(resolverVencimento({ tipoVencimento: 'DIA_FIXO', diaVencimento: 'x' }).erro).toBeTruthy();
  });

  it('DIA_UTIL aceita 1 a 10 — acima disso um mês curto pode não ter o dia pedido', () => {
    expect(resolverVencimento({ tipoVencimento: 'DIA_UTIL', diaVencimento: 10 }).dados)
      .toEqual({ tipoVencimento: 'DIA_UTIL', diaVencimento: 10 });
    expect(resolverVencimento({ tipoVencimento: 'DIA_UTIL', diaVencimento: 11 }).erro).toBeTruthy();
  });

  it('forma desconhecida é RECUSADA, não ignorada', () => {
    const r = resolverVencimento({ tipoVencimento: 'QUINZENAL', diaVencimento: 15 });
    expect(r.erro).toBeTruthy();
    expect(TIPOS_VENCIMENTO).toEqual(['DIA_FIXO', 'DIA_UTIL', 'ULTIMO_DIA_MES']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('statusExibicao — ATRASADA é derivada, nunca gravada', () => {
  const ontem = new Date(Date.now() - 24 * 3600 * 1000);
  const amanha = new Date(Date.now() + 24 * 3600 * 1000);

  it('só a FECHADA atrasa', () => {
    expect(statusExibicao('FECHADA', ontem)).toBe('ATRASADA');
    // ABERTA/REABERTA ainda recebem lançamento (o mês não terminou de ser apurado),
    // PAGA já foi quitada e CANCELADA deixou de valer.
    for (const s of ['ABERTA', 'REABERTA', 'PAGA', 'CANCELADA']) {
      expect(statusExibicao(s, ontem)).toBe(s);
    }
  });

  it('vencimento futuro mantém FECHADA', () => {
    expect(statusExibicao('FECHADA', amanha)).toBe('FECHADA');
  });

  it('SEM vencimento a conta NUNCA atrasa — é o comportamento de antes da migration', () => {
    expect(statusExibicao('FECHADA', null)).toBe('FECHADA');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE ESTRUTURAL — os elos que somem em silêncio
// ─────────────────────────────────────────────────────────────────────────────
describe('gate estrutural — os elos que somem em silêncio', () => {
  it('a listagem de fornecedor e de prestador DEVOLVE o vencimento', () => {
    // Sem isso a edição abriria com o campo em branco e o salvar o APAGARIA em
    // silêncio — a lição do `temposConsulta` (2026-07-28 parte 4).
    for (const f of ['controllers/FornecedorController.js', 'controllers/PrestadorController.js']) {
      expect(ler(f)).toMatch(/anexarVencimentoEmLista\(prisma, '(FORNECEDOR|PRESTADOR)'/);
    }
  });

  it('criar E atualizar GRAVAM o vencimento nos dois cadastros', () => {
    for (const f of ['controllers/FornecedorController.js', 'controllers/PrestadorController.js']) {
      const src = ler(f);
      expect((src.match(/gravarVencimento\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
      // Recusar a forma inválida ANTES de criar: gravar e falhar calado no UPDATE
      // seguinte deixaria o cadastro sem o que a pessoa escolheu.
      expect(src).toMatch(/resolverVencimento\(req\.body\)/);
    }
  });

  it('a listagem de contas devolve `vencimentoEm` e `statusExibicao`', () => {
    const src = ler('lib/contasPagar.js');
    expect(src).toMatch(/vencimentoEm,/);
    expect(src).toMatch(/statusExibicao: statusExibicao\(/);
    // O JOIN carrega o TIPO: as duas tabelas de credor são independentes e não
    // compartilham id — sem ele o fornecedor 7 casaria com o prestador 7.
    expect(src).toMatch(/c\.tipo = 'FORNECEDOR' AND f\.id = c\.credor_id/);
    expect(src).toMatch(/c\.tipo = 'PRESTADOR'\s+AND p\.id = c\.credor_id/);
  });

  it('ATRASADA é FILTRÁVEL mas NUNCA gravável', () => {
    // ⚠️ Lido do FONTE, e não por `require`: `lib/contasPagar.js` importa
    // `lib/prisma` (TypeScript), que o babel do jest não transpila — o mesmo motivo
    // do `{ virtual: true }` nos mocks dos demais gates.
    const src = ler('lib/contasPagar.js');
    // REABERTA é estado REAL da conta (a que voltou a ser editável) e entra nos
    // graváveis; ATRASADA é derivada e só entra nos filtráveis.
    expect(src).toMatch(/const STATUS_ABERTOS\s+= \['ABERTA', 'REABERTA'\]/);
    expect(src).toMatch(/const STATUS_FILTRAVEIS = \[\.\.\.STATUS_VALIDOS, 'ATRASADA'\]/);
    expect(src).not.toMatch(/STATUS_FECHADOS\s+= \[[^\]]*ATRASADA/);
  });

  it('a data de pagamento é INFORMADA, não deduzida do relógio', () => {
    const src = ler('lib/contasPagar.js');
    // O `NOW()` continua como fallback de quem não informa — o que não pode é ser o
    // ÚNICO caminho, senão toda quitação vira a data da digitação.
    expect(src).toMatch(/alterarStatus\(client, empresaId, contaId, status, usuarioId, pagoEm = null\)/);
    expect(src).toMatch(/pago_em\s+= CASE WHEN \$3 = 'PAGA' THEN \$5::timestamp/);
    expect(ler('controllers/ContaPagarController.js')).toMatch(/pagoEm \?\? null\)/);
  });

  it('a data de pagamento vai como TEXTO, nunca como `Date`', () => {
    // 🔴 Achado rodando o código real contra a base: `pago_em` é `timestamp WITHOUT
    // time zone` e um objeto `Date` é tratado como `timestamptz` — o dia 01/09
    // escolhido na tela era gravado 31/08 21:00 e voltava 31/08 no comprovante, sem
    // erro e sem log. É a armadilha do `NOW()` puro (§6) pelo outro lado.
    const src = ler('lib/contasPagar.js');
    expect(src).toMatch(/function timestampNaive\(valor\)/);
    expect(src).toMatch(/const quandoPagou = status === 'PAGA' \? timestampNaive\(pagoEm\) : null;/);
    expect(src).not.toMatch(/new Date\(pagoEm\)/);
    // Os DOIS parâmetros são castados: sem `::int`, o `pago_por_id` nulo é inferido
    // como TEXT e o Postgres recusa com 42804.
    expect(src).toMatch(/\$4::int/);
    expect(src).toMatch(/\$5::timestamp/);
  });

  it('item de conta REABERTA continua editável, como o da ABERTA', () => {
    const src = ler('lib/contasPagar.js');
    expect(src).toMatch(/c\.status = 'ABERTA' OR c\.status = 'REABERTA'/);
  });

  it('a compra do estoque manda a DATA DA ENTRADA como data do pedido', () => {
    // Sem isso, um lançamento reprocessado carimbaria o instante do reprocessamento e
    // a compra apareceria no período errado — a conta pela qual o mês fecha.
    const src = ler('controllers/EstoqueController.js');
    expect(src).toMatch(/ocorridoEm:\s+movimentoEm/);
    expect(src).toMatch(/movimentoEm:\s+movimentoNovo\?\.createdAt/);
    expect(src).toMatch(/movimentoEm:\s+movimentoConsolidado\?\.createdAt/);
  });

  it('o timbre do recibo sai por `financeiro.pagamentos.ler`, não pelo slug de recibos', () => {
    // Quem opera pagamentos pode não ter `financeiro.recibos.ler`; consumindo a rota
    // daquele módulo, a folha sairia sem emitente em silêncio.
    const src = ler('routes/contas-pagar.js');
    expect(src).toMatch(/router\.get\s*\('\/emitente'[^\n]*financeiro\.pagamentos\.ler/);
  });
});

describe('gate estrutural — a tela de Pagamentos', () => {
  const tela = lerFront('pages/Pagamentos.tsx');

  it('filtra por `statusExibicao`, nunca pelo status gravado', () => {
    // Filtrando pelo gravado, o chip "Atrasada" viria sempre vazio enquanto o
    // "Fechada" mostraria contas que já venceram.
    expect(tela).toMatch(/c\.statusExibicao === filtro/);
    expect(tela).toMatch(/c\.statusExibicao === f/);
  });

  it('oferece os SETE status da fatura', () => {
    for (const s of ['TODAS', 'ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA', 'PAGA', 'CANCELADA']) {
      expect(tela).toContain(`'${s}'`);
    }
  });

  it('a aba de PRESTADOR imprime o RECIBO; a de fornecedor, o demonstrativo', () => {
    expect(tela).toMatch(/c\.tipo === 'PRESTADOR'\) imprimirRecibos/);
    expect(tela).toMatch(/else\s+imprimirContasPagar/);
  });

  it('o recibo vindo da conta a pagar NÃO inventa o valor cobrado do cliente', () => {
    // "R$ 0,00" ali afirmaria ao prestador que o cliente não pagou nada pelo serviço.
    expect(tela).toMatch(/valorCliente: null/);
    expect(tela).toMatch(/totalCliente: null/);
  });

  it('traz as ações da fatura, com rótulo', () => {
    for (const r of ['Fechar Pagamento', 'Marcar como Pago', 'E-mail', 'WhatsApp', 'Imprimir', 'Exportar']) {
      expect(tela).toContain(r);
    }
  });

  it('"Marcar como Pago" pergunta a data e não envia sem ela', () => {
    expect(tela).toMatch(/Data de Pagamento/);
    expect(tela).toMatch(/pagoEm: dataPagto/);
    expect(tela).toMatch(/disabled=\{!dataPagto/);
  });

  it('a coluna da data do item se chama "Data do Pedido"', () => {
    expect(tela).toContain('Data do Pedido');
  });

  it('os tokens da barra vêm da fonte única, não de uma cópia local', () => {
    expect(tela).toMatch(/import \{ BTN_ACAO, TOM_ACAO \} from '\.\.\/utils\/tomAcao'/);
    expect(lerFront('pages/Faturamento.tsx')).toMatch(/from '\.\.\/utils\/tomAcao'/);
  });
});

describe('gate estrutural — o campo no cadastro', () => {
  it('fornecedor e prestador usam o MESMO seletor de vencimento', () => {
    // Duas cópias divergiriam na primeira correção, e o que divergiria é a data em que
    // a clínica acha que precisa pagar.
    for (const f of ['pages/CadastroFornecedor.tsx', 'pages/CadastroPrestador.tsx']) {
      const src = lerFront(f);
      expect(src).toMatch(/import SeletorVencimentoCredor/);
      expect(src).toMatch(/<SeletorVencimentoCredor/);
      // Enviados SEMPRE: omitir tornaria impossível VOLTAR o credor a "sem vencimento".
      expect(src).toMatch(/tipoVencimento: form\.tipoVencimento/);
      expect(src).toMatch(/diaVencimento:\s+form\.diaVencimento/);
    }
  });

  it('o seletor nasce em "não informar"', () => {
    for (const f of ['pages/CadastroFornecedor.tsx', 'pages/CadastroPrestador.tsx']) {
      expect(lerFront(f)).toMatch(/tipoVencimento: null, diaVencimento: null/);
    }
  });
});
