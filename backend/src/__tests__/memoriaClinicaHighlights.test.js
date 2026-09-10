'use strict';

/**
 * DESTAQUE É TEXTO PARA GENTE LER (2026-09-08).
 *
 * Dois defeitos que aparecem na tela e não produzem erro nenhum:
 *
 *   1. O modelo terminava o destaque com a lista de ids que o sustenta —
 *      "Recorrência de dor lombar em 06/09/2026: t3, t6, t7, t9, t11." — e "t3" não
 *      diz nada a quem abre a ficha do paciente. Os ids já têm campo próprio
 *      (`topicos`), que é o que torna o destaque clicável; no texto são ruído.
 *
 *   2. O MESMO achado voltava em dois destaques, com datas diferentes. A lista existe
 *      para ser lida em meio minuto; repetida, deixa de servir para isso.
 *
 * O prompt v5 proíbe os dois. Isto aqui é a REDE atrás dele — prompt é instrução, não
 * garantia, e o defeito volta calado na próxima variação do modelo.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../ai', () => ({ callAI: jest.fn(), MODULOS_IA: { MEMORIA_CLINICA: 'MEMORIA_CLINICA' } }), { virtual: true });

const { semIdsDeTopico, normalizarHighlights } = require('../services/resumoAtendimentoService');

const ids = new Set(['t1', 't2', 't3', 't6', 't7', 't9', 't11']);
const h = (texto, topicos = ['t1', 't2']) => ({ texto, tipo: 'RECORRENCIA', direcao: 'nao_aplicavel', topicos });

describe('semIdsDeTopico — o id sai do texto, a frase fica', () => {
  it('remove a enumeração depois de dois-pontos (o caso relatado)', () => {
    expect(semIdsDeTopico('Recorrência de dor lombar em 06/09/2026: t3, t6, t7, t9, t11.'))
      .toBe('Recorrência de dor lombar em 06/09/2026');
  });

  it('remove a enumeração com "e" e com travessão', () => {
    expect(semIdsDeTopico('Perda de peso - t1, t2 e t3')).toBe('Perda de peso');
  });

  it('remove a enumeração entre parênteses, em qualquer posição', () => {
    expect(semIdsDeTopico('Dor lombar (t3, t6) recorrente em três consultas.'))
      .toBe('Dor lombar recorrente em três consultas.');
  });

  it('NÃO mexe no texto que não tem id — nem em número solto', () => {
    const frase = 'Thor teve recorrência (06/09, 07/09 e 10/09) de dor lombar leve, com massagem com NGF-5 feita.';
    expect(semIdsDeTopico(frase)).toBe(frase);
  });

  it('NÃO mutila palavra que por acaso contém "t" e dígito', () => {
    // "T4" aqui é vértebra, não id de tópico — apagar seria pior que o resíduo.
    const frase = 'Sensibilidade em T4 registrada em 06/09 e 07/09.';
    expect(semIdsDeTopico(frase)).toBe(frase);
  });
});

describe('normalizarHighlights — sem ids, sem repetição', () => {
  it('limpa o texto e preserva os ids no campo que os usa', () => {
    const [saida] = normalizarHighlights([h('Dor lombar recorrente: t1, t2', ['t1', 't2'])], ids);
    expect(saida.texto).toBe('Dor lombar recorrente');
    // O clique no destaque depende DELES — o que saiu foi só a cópia no texto.
    expect(saida.topicos).toEqual(['t1', 't2']);
  });

  it('descarta o segundo destaque sobre o mesmo achado', () => {
    const saida = normalizarHighlights([
      h('Dor lombar recorrente em 06/09 e 07/09.'),
      h('DOR LOMBAR RECORRENTE EM 06/09 E 07/09!', ['t3', 't6']),
    ], ids);
    expect(saida).toHaveLength(1);
  });

  it('a deduplicação ignora acento e pontuação, não o conteúdo', () => {
    const saida = normalizarHighlights([
      h('Recorrência de dor lombar'),
      h('Recorrencia de dor lombar.', ['t3', 't6']),
      h('Perda de peso progressiva', ['t7', 't9']),
    ], ids);
    expect(saida).toHaveLength(2);
    expect(saida[1].texto).toBe('Perda de peso progressiva');
  });

  it('destaque que fica VAZIO depois da limpeza não entra', () => {
    // Um texto que era só a lista de ids não vira destaque em branco na tela.
    expect(normalizarHighlights([h(': t1, t2')], ids)).toHaveLength(0);
  });

  it('continua exigindo 2 evidências — a regra antiga não foi afrouxada', () => {
    expect(normalizarHighlights([h('Dor lombar', ['t1'])], ids)).toHaveLength(0);
  });
});
