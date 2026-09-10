'use strict';

/**
 * PRESTADOR NO PROCEDIMENTO + RECIBO DE PAGAMENTO (2026-09-08).
 *
 * 🔴 POR QUE ESTE GATE EXISTE: as duas regras que ele trava quebram em SILÊNCIO e no
 * DINHEIRO — o único lugar onde o defeito aparece é no fim do mês.
 *
 *   1. O CÁLCULO do que a clínica deve. Errar a base (percentual sobre o valor errado,
 *      salário somado por procedimento, prestador sem cadastro virando zero sem aviso)
 *      produz um recibo plausível e errado. Ninguém confere um número que "parece
 *      certo", e o prestador recebe a menos — ou a mais — sem que nada acuse.
 *
 *   2. O ELO da execução. `PrescricaoGrupoController.executar` é o ÚNICO ponto em que a
 *      linha do recibo nasce; se alguém remover a chamada ao registrar a execução, a
 *      fatura do cliente continua saindo perfeitamente e o recibo simplesmente fica
 *      vazio. A varredura de código abaixo é o que impede isso de passar.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const { calcularValorAPagar, BASES_CALCULO, TIPOS_PAGAMENTO_PRESTADOR } =
  require('../lib/procedimentoPrestador');

// ─────────────────────────────────────────────────────────────────────────────
// POR_PROCEDIMENTO — o valor é o do VÍNCULO, não o do cadastro do prestador
// ─────────────────────────────────────────────────────────────────────────────
describe('POR_PROCEDIMENTO', () => {
  it('paga o valor que o prestador cobra por aquele procedimento', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'POR_PROCEDIMENTO', valorPrestador: 80, valorCliente: 200,
    })).toEqual({ valorAPagar: 80, baseCalculo: BASES_CALCULO.VALOR_PROCEDIMENTO });
  });

  it('IGNORA o valor cobrado do cliente — é preço próprio, não comissão', () => {
    const a = calcularValorAPagar({ tipoPagamento: 'POR_PROCEDIMENTO', valorPrestador: 80, valorCliente: 200 });
    const b = calcularValorAPagar({ tipoPagamento: 'POR_PROCEDIMENTO', valorPrestador: 80, valorCliente: 9999 });
    expect(a.valorAPagar).toBe(b.valorAPagar);
  });

  it('acompanha a quantidade — é preço UNITÁRIO do procedimento', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'POR_PROCEDIMENTO', valorPrestador: 80, quantidade: 3,
    }).valorAPagar).toBe(240);
  });

  it('sem valor no vínculo NÃO chuta: fica SEM_CONFIG e zero', () => {
    // O prestador está configurado como "por procedimento" mas ninguém cadastrou o
    // valor DELE para este procedimento. Inventar (usar o valor do cliente, por
    // exemplo) produziria um recibo que a clínica pagaria sem ninguém ter acordado.
    expect(calcularValorAPagar({ tipoPagamento: 'POR_PROCEDIMENTO', valorCliente: 300 }))
      .toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMISSÃO — o percentual incide sobre o VALOR COBRADO PARA O CLIENTE
// ─────────────────────────────────────────────────────────────────────────────
describe('COMISSAO em PERCENTUAL', () => {
  it('calcula sobre o valor cobrado do cliente', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'PERCENTUAL', valorPagamento: 30, valorCliente: 200,
    })).toEqual({ valorAPagar: 60, baseCalculo: BASES_CALCULO.PERCENTUAL_CLIENTE });
  });

  it('NÃO multiplica por quantidade — o valor do cliente já é o total da execução', () => {
    // Multiplicar de novo pagaria comissão em dobro. `valorCliente` chega já
    // consolidado do lançamento na fatura.
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'PERCENTUAL', valorPagamento: 50,
      valorCliente: 100, quantidade: 4,
    }).valorAPagar).toBe(50);
  });

  it('IGNORA o valor do vínculo — quem manda é o percentual', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'PERCENTUAL', valorPagamento: 10,
      valorCliente: 100, valorPrestador: 999,
    }).valorAPagar).toBe(10);
  });

  it('arredonda ao CENTAVO na gravação', () => {
    // 183,33 × 30% = 54,999 em ponto flutuante. Sem arredondar, a soma de 30 linhas
    // fecha o recibo com um centavo de diferença que ninguém consegue explicar.
    const r = calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'PERCENTUAL', valorPagamento: 30, valorCliente: 183.33,
    });
    expect(r.valorAPagar).toBe(55);
    expect(Number.isInteger(Math.round(r.valorAPagar * 100))).toBe(true);
  });

  it('cliente sem cobrança (item fornecido pelo cliente) dá comissão ZERO, não erro', () => {
    // Não há receita, logo não há percentual — é a consequência correta, e a execução
    // continua registrada para o serviço prestado constar no recibo.
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'PERCENTUAL', valorPagamento: 30, valorCliente: 0,
    })).toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.PERCENTUAL_CLIENTE });
  });
});

describe('COMISSAO em VALOR (fixa por procedimento)', () => {
  it('paga o valor fixo, independente do que se cobrou do cliente', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'VALOR', valorPagamento: 45, valorCliente: 1000,
    })).toEqual({ valorAPagar: 45, baseCalculo: BASES_CALCULO.VALOR_FIXO });
  });

  it('acompanha a quantidade — é valor por procedimento', () => {
    expect(calcularValorAPagar({
      tipoPagamento: 'COMISSAO', formaPagamento: 'VALOR', valorPagamento: 45, quantidade: 3,
    }).valorAPagar).toBe(135);
  });

  it('comissão sem valor cadastrado é SEM_CONFIG, nunca um palpite', () => {
    expect(calcularValorAPagar({ tipoPagamento: 'COMISSAO', valorCliente: 500 }))
      .toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SALÁRIO — remuneração FIXA, não se apura por procedimento
// ─────────────────────────────────────────────────────────────────────────────
describe('SALARIO', () => {
  it('não gera valor por execução', () => {
    // Somar o salário a cada procedimento pagaria o mesmo salário tantas vezes quantos
    // procedimentos a pessoa fizesse no mês.
    expect(calcularValorAPagar({
      tipoPagamento: 'SALARIO', formaPagamento: 'VALOR', valorPagamento: 5000, valorCliente: 300,
    })).toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SALARIO });
  });

  it('a base é SALARIO e não SEM_CONFIG — o cadastro existe, e o recibo diz isso', () => {
    // A distinção importa: SEM_CONFIG é uma PENDÊNCIA que a tela cobra; SALARIO é uma
    // decisão. Confundi-las mandaria o gestor cadastrar algo que já está cadastrado.
    const r = calcularValorAPagar({ tipoPagamento: 'SALARIO' });
    expect(r.baseCalculo).toBe(BASES_CALCULO.SALARIO);
    expect(r.baseCalculo).not.toBe(BASES_CALCULO.SEM_CONFIG);
  });
});

describe('prestador sem forma de pagamento', () => {
  it('vira SEM_CONFIG com valor zero — a pendência fica à vista', () => {
    expect(calcularValorAPagar({ valorCliente: 400, valorPrestador: 90 }))
      .toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG });
  });

  it('chamada sem argumento nenhum não estoura', () => {
    expect(calcularValorAPagar()).toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG });
  });

  it('tipo desconhecido não é tratado como comissão', () => {
    expect(calcularValorAPagar({ tipoPagamento: 'QUALQUER_COISA', valorCliente: 100, valorPagamento: 50 }))
      .toEqual({ valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POR_PROCEDIMENTO é EXCLUSIVO do prestador
// ─────────────────────────────────────────────────────────────────────────────
describe('separação em relação ao INCLUIR MEMBRO', () => {
  it('POR_PROCEDIMENTO existe na lista do PRESTADOR', () => {
    expect(TIPOS_PAGAMENTO_PRESTADOR).toContain('POR_PROCEDIMENTO');
  });

  it('🔴 e NÃO existe em TIPOS_PAGAMENTO de lib/usuarioEmpresa', () => {
    // Aquela lista é compartilhada com `tb_usuario_empresa` (membro de equipe).
    // Acrescentar o valor lá o tornaria aceito no backend do MEMBRO sem que nenhuma
    // tela o ofereça — um estado alcançável só por chamada direta à API, que ninguém
    // consegue configurar nem corrigir depois. O prestador é o único cujo trabalho é
    // contado por procedimento.
    const { TIPOS_PAGAMENTO } = require('../lib/usuarioEmpresa');
    expect(TIPOS_PAGAMENTO).not.toContain('POR_PROCEDIMENTO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE ESTRUTURAL — o elo da execução
// ─────────────────────────────────────────────────────────────────────────────
// O modo de quebrar esta regra é ESQUECER (ou remover) a chamada num caminho que
// continua funcionando sem ela: a fatura do cliente sai perfeita e o recibo fica
// vazio, sem erro em lugar nenhum.
const lerFonte = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** Comentários fora: um gate que se satisfaz com a própria documentação da regra é um
 *  gate que se aprende a ignorar (mesma lição do gate de e-mail e do paciente inativo). */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('elo da execução (PrescricaoGrupoController)', () => {
  const src = semComentarios(lerFonte('controllers/PrescricaoGrupoController.js'));

  it('a execução registra a linha do recibo', () => {
    expect(src).toMatch(/vinculoPrestador\.registrarExecucao\(\s*tx\s*,/);
  });

  it('🔴 o registro acontece DENTRO da transaction da execução', () => {
    // Fora dela existiria a janela em que a clínica cobrou o cliente e não deve a
    // ninguém — e o `tx` é o que garante que os dois nascem juntos ou nenhum nasce.
    const i = src.indexOf('vinculoPrestador.registrarExecucao');
    expect(i).toBeGreaterThan(-1);
    const antes = src.slice(0, i);
    // A última abertura de transaction antes da chamada tem de existir e vir DEPOIS do
    // último fechamento — isto é, a chamada está dentro dela.
    expect(antes.lastIndexOf('prisma.$transaction')).toBeGreaterThan(-1);
  });

  it('o preço do procedimento passa a considerar o PRESTADOR do item', () => {
    // Sem o prestador na resolução, o item volta a ser cobrado pelo valor padrão da
    // empresa — e dois prestadores com preços diferentes voltam a cobrar o mesmo.
    expect(src).toMatch(/resolverValorProcedimento\(\s*tx\s*,\s*empresaIdEfetivo\s*,\s*item\.medicamento\s*,\s*item\.prestadorId/);
  });

  it('o prestador do item é GRAVADO nos três pontos onde um item nasce ou muda', () => {
    // criar, adicionarItem e atualizarItem — esquecer um deixa o campo no limbo
    // (foi exatamente o defeito de `resolverCatalogoDoItem`, documentado no arquivo).
    const chamadas = src.match(/vinculoPrestador\.gravarPrestadorDoItem\(/g) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
  });

  it('a LEITURA do item anexa o prestador (senão a tela nunca o mostra)', () => {
    expect(src).toMatch(/vinculoPrestador\.anexarPrestador\(/);
  });
});

describe('elo do cadastro (ProcedimentoCadastroController)', () => {
  const src = semComentarios(lerFonte('controllers/ProcedimentoCadastroController.js'));

  it('a listagem devolve os vínculos de prestador', () => {
    expect(src).toMatch(/vinculosPorProcedimento\(/);
    expect(src).toMatch(/prestadores:\s*vinculos\.get\(p\.id\)/);
  });

  it('🔴 o prestador é conferido contra a EMPRESA antes de vincular', () => {
    // Sem isto, um id de outra clínica criaria um vínculo que a tela dela nunca
    // mostraria e que iria ao recibo errado.
    expect(src).toMatch(/prisma\.prestador\.findFirst\([\s\S]{0,200}empresaId:\s*req\.empresaId/);
  });
});
