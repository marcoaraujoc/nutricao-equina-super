// backend/src/__tests__/motivosInativacao.test.js
//
// O motivo de inativação virou DIMENSÃO DE RELATÓRIO (coluna própria e indexada,
// migration 20260919000000). Isso muda o que quebra em silêncio aqui:
//
//   1. Valor fora da lista não derruba nada na hora — só aparece meses depois como
//      fatia órfã no gráfico, e ninguém sabe se é dado real ou lixo.
//   2. Caixa/acento divergentes PARTEM o agrupamento: "Falecimento" e "falecimento"
//      viram duas fatias do mesmo fato. Por isso o validador devolve o rótulo
//      CANÔNICO, e não o que o cliente mandou.
//   3. A lista do FRONT monta o seletor; a do BACK valida. Divergirem faz o backend
//      recusar a inativação — e o teste de paridade abaixo é o que avisa ANTES.

const {
  MOTIVOS_INATIVACAO_ANIMAL, validarMotivoTipo, exigeDescricao,
} = require('../lib/motivosInativacao');

const fs   = require('fs');
const path = require('path');

describe('validarMotivoTipo', () => {
  it('aceita os motivos da lista', () => {
    for (const m of MOTIVOS_INATIVACAO_ANIMAL) {
      expect(validarMotivoTipo(m)).toEqual({ tipo: m, erro: null });
    }
  });

  it('🔴 normaliza para o rótulo CANÔNICO — é o que mantém o GROUP BY íntegro', () => {
    expect(validarMotivoTipo('falecimento').tipo).toBe('Falecimento');
    expect(validarMotivoTipo('  Troca de Veterinário  ').tipo).toBe('Troca de Veterinário');
  });

  it('recusa valor fora da lista, com o texto recebido na mensagem', () => {
    const r = validarMotivoTipo('Aposentado');
    expect(r.tipo).toBeNull();
    expect(r.erro).toMatch(/Aposentado/);
  });

  it('vazio/ausente NÃO é erro — é "não informado"', () => {
    // Cascata do sistema e telas que ainda não mandam o campo continuam inativando.
    for (const v of ['', '   ', null, undefined]) {
      expect(validarMotivoTipo(v)).toEqual({ tipo: null, erro: null });
    }
  });

  it('só "Outro" exige descrição', () => {
    expect(exigeDescricao('Outro')).toBe(true);
    for (const m of MOTIVOS_INATIVACAO_ANIMAL.filter(x => x !== 'Outro')) {
      expect(exigeDescricao(m)).toBe(false);
    }
    expect(exigeDescricao(null)).toBe(false);
  });

  it('todo rótulo cabe em VARCHAR(40)', () => {
    // Lição da migration 20260914000000: `CANCELADO_AUTOMATICAMENTE` tinha 25
    // caracteres numa coluna VARCHAR(20) e o cron falhava toda noite em silêncio.
    for (const m of MOTIVOS_INATIVACAO_ANIMAL) {
      expect(m.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('paridade com a lista do frontend', () => {
  it('front e back listam EXATAMENTE os mesmos motivos', () => {
    // O front monta o seletor, o back valida. Se divergirem, a inativação passa a
    // ser recusada com 400 no primeiro uso — este teste avisa antes disso.
    const arquivo = path.join(__dirname, '../../../frontend/src/utils/motivosInativacao.ts');
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const bloco = fonte.match(/MOTIVOS_INATIVACAO_ANIMAL[\s\S]*?\[([\s\S]*?)\];/);
    expect(bloco).not.toBeNull();

    const doFront = [...bloco[1].matchAll(/valor:\s*'([^']+)'/g)].map(m => m[1]);
    expect(doFront).toEqual(MOTIVOS_INATIVACAO_ANIMAL);
  });

  it('o front marca `exigeDescricao` no MESMO motivo que o back', () => {
    const arquivo = path.join(__dirname, '../../../frontend/src/utils/motivosInativacao.ts');
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const comFlag = [...fonte.matchAll(/valor:\s*'([^']+)',\s*exigeDescricao:\s*true/g)].map(m => m[1]);
    expect(comFlag).toEqual(MOTIVOS_INATIVACAO_ANIMAL.filter(m => exigeDescricao(m)));
  });
});
