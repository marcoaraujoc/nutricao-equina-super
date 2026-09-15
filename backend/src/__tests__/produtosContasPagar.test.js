'use strict';

/**
 * PRODUTOS DE FORNECEDOR + CONTAS A PAGAR (2026-09-10)
 *
 * 🔴 POR QUE ESTE GATE EXISTE: as regras abaixo quebram em SILÊNCIO, e quase todas no
 * DINHEIRO — o defeito só aparece quando alguém for pagar o fornecedor.
 *
 *   1. `null` NÃO É ZERO no preço de compra. "Não cadastrei quanto pago" e "recebo de
 *      graça" precisam continuar distintos: colapsar os dois lança conta a pagar de
 *      R$ 0,00 afirmando que o fornecedor não cobra nada, e ninguém confere uma linha
 *      zerada.
 *
 *   2. O ELO do lançamento. A execução é o ÚNICO ponto em que a dívida com o
 *      fornecedor e com o prestador nasce. Removida a chamada, TUDO continua
 *      funcionando — o cliente é cobrado, o estoque baixa, a tela não acusa nada — e
 *      a clínica simplesmente para de saber o que deve.
 *
 *   3. A IDEMPOTÊNCIA. Sem a chave de origem, reprocessar uma execução cria a segunda
 *      linha e a conta do mês fecha com o dobro.
 *
 *   4. O `ON CONFLICT` sobre índice PARCIAL. Já mordeu uma vez (42P10, seed 005 em
 *      2026-09-09): o predicado tem de ser REPETIDO na cláusula, e `node --check` não
 *      pega — só o banco reprova, em execução.
 *
 *   5. O RLS das tabelas novas. Elas guardam o que a clínica PAGA: vazamento aqui
 *      expõe a margem dela para a concorrente.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const lerFonte = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const lerMigration = (nome) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'migrations', nome, 'migration.sql'), 'utf8');

/** Descarta comentários: um gate satisfeito pela própria documentação da regra é um
 *  gate que se aprende a ignorar. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = '20261006000000_produtos_contas_pagar';

// ─────────────────────────────────────────────────────────────────────────────
// 1. MIGRATION — RLS, índices e o que NÃO pode existir
// ─────────────────────────────────────────────────────────────────────────────
describe('migration de produtos e contas a pagar', () => {
  const sql = lerMigration(MIGRATION);

  it('as três tabelas nascem com ENABLE + FORCE + policy', () => {
    for (const t of ['tb_produtos_fornecedor', 'tb_contas_pagar', 'tb_conta_pagar_itens']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE[^;]*"${t}" ENABLE ROW LEVEL SECURITY`));
      // FORCE vale até para o dono do schema — sem ele, quem roda migration e scripts
      // enxerga tudo, e o isolamento vira uma promessa que só o app cumpre.
      expect(sql).toMatch(new RegExp(`ALTER TABLE[^;]*"${t}" FORCE  ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY "tenant_${t}"`));
    }
  });

  it('toda policy tem USING E WITH CHECK', () => {
    // Só `USING` protege a LEITURA: sem `WITH CHECK`, a clínica grava linha carimbada
    // para outra empresa — e some da vista dela mesma no instante seguinte.
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(p).toMatch(/USING/);
      expect(p).toMatch(/WITH CHECK/);
    }
  });

  it('é ADITIVA — não altera nem apaga dado gravado', () => {
    const semComent = sql.replace(/--.*$/gm, '');
    expect(semComent).not.toMatch(/\bUPDATE\s+"?schs2vet"?\./i);
    expect(semComent).not.toMatch(/\bDELETE\s+FROM/i);
    expect(semComent).not.toMatch(/\bDROP\s+TABLE/i);
  });

  it('a conta ABERTA é única por (empresa, tipo, credor, mês) — índice PARCIAL', () => {
    // Sem o índice, duas contas correntes do mesmo fornecedor partem o mês em duas e
    // metade dos lançamentos some da vista. Parcial porque a conta FECHADA/PAGA do mês
    // anterior tem de coexistir com a nova.
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*tb_contas_pagar_aberta_unica[\s\S]*?WHERE "status" = 'ABERTA'/);
  });

  it('o item tem índice único por ORIGEM — é o que torna o lançamento idempotente', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*tb_conta_pagar_itens_origem_unica/);
    // Parcial: lançamento MANUAL não tem origem, e vários deles na mesma conta são
    // legítimos. Sem o predicado, o segundo lançamento manual seria recusado.
    expect(sql).toMatch(/tb_conta_pagar_itens_origem_unica[\s\S]*?WHERE "origem_tipo" IS NOT NULL AND "origem_id" IS NOT NULL/);
  });

  it('o lote de vacina ganha fornecedor e nota fiscal', () => {
    expect(sql).toMatch(/ALTER TABLE[^;]*"tb_lotes_vacina"[\s\S]*?ADD COLUMN IF NOT EXISTS "fornecedor_id"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "nota_fiscal"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `ON CONFLICT` com índice PARCIAL — a armadilha 42P10
// ─────────────────────────────────────────────────────────────────────────────
describe('ON CONFLICT sobre índice parcial', () => {
  const src = semComentarios(lerFonte('lib/contasPagar.js'));

  it('a conta repete o predicado do índice parcial', () => {
    // `ON CONFLICT (...)` sozinho NÃO casa com índice parcial e morre com
    // `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
    // specification`. Erro de EXECUÇÃO: `node --check` passa e só o banco reprova.
    const trecho = src.slice(src.indexOf('ON CONFLICT (empresa_id, tipo, credor_id, mes_referencia)'));
    expect(trecho.slice(0, 200)).toMatch(/WHERE status = 'ABERTA'/);
  });

  it('o item repete o predicado do índice parcial', () => {
    const trecho = src.slice(src.indexOf('ON CONFLICT (origem_tipo, origem_id)'));
    expect(trecho.slice(0, 200)).toMatch(/WHERE origem_tipo IS NOT NULL AND origem_id IS NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. `null` ≠ 0, e o que NÃO vira lançamento
// ─────────────────────────────────────────────────────────────────────────────
describe('preço e lançamento', () => {
  const contas   = semComentarios(lerFonte('lib/contasPagar.js'));
  const produtos = semComentarios(lerFonte('lib/produtoFornecedor.js'));

  it('valor zero ou nulo NÃO vira linha na conta', () => {
    // Conta a pagar de R$ 0,00 é ruído no fechamento do mês e afirma uma dívida que
    // não existe.
    expect(contas).toMatch(/if \(!v \|\| v <= 0\) return null;/);
  });

  it('dinheiro é arredondado ao CENTAVO', () => {
    // Percentual fecha em 55.000000000000004 e a conta sairia com um centavo que
    // ninguém consegue explicar.
    expect(contas).toMatch(/Math\.round\(Number\(v\) \* 100\) \/ 100/);
  });

  it('o total é RECALCULADO a partir dos itens, nunca incrementado', () => {
    // Somar no lançamento faria o total divergir dos itens em qualquer caminho que
    // remova uma linha — e aí não há qual dos dois acreditar.
    const fn = contas.slice(contas.indexOf('async function recalcularTotal'));
    expect(fn).toMatch(/SET total = COALESCE\(\(\s*SELECT SUM/);
    expect(fn).not.toMatch(/total = total \+/);
  });

  it('o preço vazio do produto vira null, nunca 0', () => {
    const fn = produtos.slice(produtos.indexOf('const num ='));
    expect(fn.slice(0, 250)).toMatch(/=== ''\) return null/);
  });

  it('o fornecedor mais barato vence, com NULLS LAST', () => {
    // Fornecedor SEM preço cadastrado não pode ser escolhido na frente de quem tem
    // preço — senão a conta a pagar nunca é lançada, por causa da ordenação.
    expect(produtos).toMatch(/ORDER BY pf\.valor_unitario ASC NULLS LAST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GATES ESTRUTURAIS — os elos que somem em silêncio
// ─────────────────────────────────────────────────────────────────────────────
describe('elos que não podem sumir', () => {
  it('a execução da prescrição lança a conta do FORNECEDOR', () => {
    const src = semComentarios(lerFonte('controllers/PrescricaoGrupoController.js'));
    expect(src).toMatch(/contasPagar\.lancarItem\(tx, \{[\s\S]*?tipo:\s*'FORNECEDOR'/);
    // Só o que é PRODUTO: item de estoque próprio já foi comprado na entrada da nota,
    // e cobrá-lo de novo contaria a mesma compra duas vezes.
    expect(src).toMatch(/produtoFornecedor\.fornecedorDoItem\(/);
    expect(src).toMatch(/produto\?\.valorUnitario != null/);
  });

  it('a execução do procedimento lança a conta do PRESTADOR', () => {
    const src = semComentarios(lerFonte('controllers/PrescricaoGrupoController.js'));
    expect(src).toMatch(/contasPagar\.lancarItem\(tx, \{[\s\S]*?tipo:\s*'PRESTADOR'/);
    // O valor sai do MESMO cálculo do recibo — duas contas para a mesma dívida fariam
    // recibo e conta a pagar discordarem entre si.
    expect(src).toMatch(/vinculoPrestador\.calcularValorAPagar\(\{/);
  });

  it('a vacina lança a conta do fornecedor no mesmo ponto da fatura', () => {
    const src = semComentarios(lerFonte('controllers/VacinaClinicaController.js'));
    const fn = src.slice(src.indexOf('async function darBaixaEFaturar'));
    expect(fn).toMatch(/contasPagar\.lancarItem\(tx, \{/);
    // Só sem lote debitado: com lote, a vacina saiu do estoque próprio e já foi
    // comprada antes.
    expect(fn).toMatch(/if \(!loteIdFinal && info\.medicamentoCatId/);
  });

  it('todo lançamento automático leva ORIGEM — sem ela não há idempotência', () => {
    for (const arq of ['controllers/PrescricaoGrupoController.js', 'controllers/VacinaClinicaController.js']) {
      const src = semComentarios(lerFonte(arq));
      const chamadas = src.match(/contasPagar\.lancarItem\(tx, \{[\s\S]*?\}\);/g) ?? [];
      expect(chamadas.length).toBeGreaterThan(0);
      for (const c of chamadas) {
        expect(c).toMatch(/origemTipo:\s*contasPagar\.ORIGENS\./);
        expect(c).toMatch(/origemId:/);
      }
    }
  });

  it('o lançamento roda DENTRO da transaction da execução', () => {
    // Fora dela existiria a janela em que a clínica cobrou o cliente e não deve a
    // ninguém — a mesma premissa do ledger do prestador.
    const src = semComentarios(lerFonte('controllers/PrescricaoGrupoController.js'));
    expect(src).toMatch(/contasPagar\.lancarItem\(tx,/);
    expect(src).not.toMatch(/contasPagar\.lancarItem\(prisma,/);
  });

  it('a lista do atendimento ordena em três grupos e devolve o fornecedor', () => {
    const src = semComentarios(lerFonte('controllers/MedicamentoController.js'));
    // Em estoque → produto → o resto. Sem isso, o que a clínica tem em mãos fica
    // misturado com o que ela não tem, numa lista de milhares de itens.
    expect(src).toMatch(/const posto = \(x\) => \(x\.emEstoque \? 0 : x\.ehProduto \? 1 : 2\)/);
    expect(src).toMatch(/produtoFornecedor\.produtosPorMedicamento\(/);
    // Produto SÓ quando não está em estoque — senão a cor deixa de distinguir "tenho"
    // de "preciso pedir".
    expect(src).toMatch(/if \(emEstoque \|\| lista\.length === 0\) return \{ ehProduto: false/);
  });

  it('nenhuma lib nova lança — falha ao registrar não derruba o ato clínico', () => {
    for (const arq of ['lib/contasPagar.js', 'lib/produtoFornecedor.js']) {
      const src = semComentarios(lerFonte(arq));
      // Toda função exportada que fala com o banco tem catch. O gate mede o mínimo:
      // há pelo menos tantos `catch` quanto blocos `try`.
      const tries   = (src.match(/\btry\s*\{/g) ?? []).length;
      const catches = (src.match(/\bcatch\b/g) ?? []).length;
      expect(catches).toBeGreaterThanOrEqual(tries);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. LEITURA DA NOTA FISCAL — nada inventado, e falha não derruba o cadastro
// ─────────────────────────────────────────────────────────────────────────────
describe('leitura da nota fiscal', () => {
  const servico = semComentarios(lerFonte('services/notaFiscalService.js'));
  const ctrl    = semComentarios(lerFonte('controllers/NotaFiscalController.js'));

  it('passa pelo GATE DE QUOTA antes de gastar token', () => {
    // O caminho multimodal não passa por `callAI`, então o gate é feito à mão —
    // esquecê-lo deixaria este caminho fora do teto do plano do cliente (§7).
    expect(servico).toMatch(/await garantirQuota\(req\.empresaId \?\? null\)/);
  });

  it('registra o uso de IA no módulo próprio', () => {
    expect(servico).toMatch(/modulo:\s*MODULOS_IA\.PRODUTOS/);
    // Começa no modelo padrão: na FALHA não há `r`, e `logAiUsage` morre com
    // "Argument `modelo` is missing" — perdendo o registro da falha que se investiga.
    expect(servico).toMatch(/let modelo = MODELO_PADRAO;/);
  });

  it('item sem nome é descartado, e quantidade/valor negativos viram null', () => {
    expect(servico).toMatch(/\.filter\(i => i\.nome\)/);
    expect(servico).toMatch(/n != null && n > 0 \? n : null/);
  });

  it('falha da IA responde 200 com o MOTIVO, não 500', () => {
    // Cair no cadastro manual é aceitável; cair sem saber por quê, não (lição de
    // 2026-09-01). Perder o cadastro por um 500 do modelo seria trocar "digitar os
    // campos" por "não conseguir cadastrar".
    expect(ctrl).toMatch(/return res\.json\(\{\s*dados: \{ ehNotaFiscal: false, motivo:/);
  });

  it('o 429 de QUOTA é o ÚNICO erro propagado', () => {
    expect(ctrl).toMatch(/if \(err\.code === 'IA_QUOTA_EXCEDIDA'\) return next\(err\);/);
  });

  it('a nota NÃO grava nada — só devolve a proposta', () => {
    expect(ctrl).not.toMatch(/prisma\.(medicamento|estoqueClinica|loteVacina|fornecedor)\.create/);
    expect(ctrl).not.toMatch(/\$executeRaw/);
  });

  // ── O CRITÉRIO É "DOCUMENTO DE COMPRA", NÃO "DOCUMENTO FISCAL" ──────────────
  // Ampliado em 2026-09-10 depois de um caso real: o balcão do fornecedor
  // veterinário entrega papel com "ORÇAMENTO - SEM VALOR FISCAL" impresso, trazendo
  // emitente, itens, quantidade e preço — tudo o que a tela precisa. A v1 exigia uma
  // NOTA FISCAL e o modelo recusava, corretamente, o que o prompt mandava recusar.
  // A REGRESSÃO É SILENCIOSA: reapertado o critério, o orçamento volta a ser recusado
  // e nada no sistema acusa — o sintoma é a clínica voltar a digitar item a item.
  const prompt = semComentarios(lerFonte('ai/prompts/lerNotaFiscal.js'));

  it('aceita documento de compra SEM valor fiscal', () => {
    expect(prompt).toMatch(/SEM VALOR FISCAL/);
    expect(prompt).toMatch(/or[çc]amento/i);
    expect(prompt).toMatch(/cupom/i);
    expect(prompt).toMatch(/recibo/i);
    // A instrução tem de ser AFIRMATIVA ("é aceito"), não uma ressalva perdida: o
    // documento traz o dizer em caixa alta, e a ambiguidade cai do lado da recusa.
    expect(prompt).toMatch(/\*\*Documento SEM valor fiscal É ACEITO\.\*\*/i);
  });

  it('a recusa fica reservada ao que NÃO registra compra', () => {
    // Afrouxar mais que isto encheria o formulário com o que não é produto.
    expect(prompt).toMatch(/ehNotaFiscal: false.*(?:receita|laudo|exame)/s);
    expect(prompt).toMatch(/ileg[íi]vel/i);
  });

  it('a recusa DIZ o que é aceito', () => {
    // "Não parece ser uma nota fiscal" não dava a quem tinha um orçamento na mão como
    // saber se o problema era o papel, a foto ou o sistema.
    expect(servico).toMatch(/or[çc]amento de balc[ãa]o/i);
  });

  it('continua proibido inventar campo', () => {
    // A ampliação é do CRITÉRIO DE ACEITE, nunca da liberdade do modelo: quantidade
    // adivinhada vira estoque que não existe e preço adivinhado vira dívida que
    // ninguém contraiu.
    expect(prompt).toMatch(/NUNCA invente, deduza ou complete/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. PERMISSÕES — os slugs existem em TODO perfil
// ─────────────────────────────────────────────────────────────────────────────
describe('slugs de permissão', () => {
  const { MODULOS_SISTEMA, PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');
  const NOVOS = [
    'cadastro.produto.ler', 'cadastro.produto.criar', 'cadastro.produto.editar',
    'cadastro.produto.deletar',
    'financeiro.pagamentos.ler', 'financeiro.pagamentos.lancar', 'financeiro.pagamentos.pagar',
  ];

  it('todos entraram no catálogo de módulos', () => {
    const slugs = new Set(MODULOS_SISTEMA.map(m => m.slug));
    for (const s of NOVOS) expect(slugs.has(s)).toBe(true);
  });

  it('todo perfil tem nível declarado para todos eles', () => {
    // Slug ausente resolve como NENHUM na prática, mas não aparece na matriz do
    // Controle de Acesso — e o gestor não vê que a decisão existe.
    for (const [perfil, mapa] of Object.entries(PERMISSOES_PADRAO)) {
      for (const s of NOVOS) {
        expect(`${perfil}:${s}=${mapa[s]}`).not.toMatch(/=undefined$/);
      }
    }
  });

  it('pagamentos NÃO é liberado a quem só fatura', () => {
    // A fatura é o que se COBRA do cliente; pagamentos é o que se PAGA a terceiros,
    // inclusive a remuneração de quem presta serviço. Reaproveitar o nível de
    // `faturas` daria a folha de pagamento de terceiros a todo mundo que fatura.
    expect(PERMISSOES_PADRAO.VETERINARIO['financeiro.faturas.ler']).not.toBe('NENHUM');
    expect(PERMISSOES_PADRAO.VETERINARIO['financeiro.pagamentos.ler']).toBe('NENHUM');
    expect(PERMISSOES_PADRAO.PROPRIETARIO['financeiro.pagamentos.ler']).toBe('NENHUM');
  });
});
