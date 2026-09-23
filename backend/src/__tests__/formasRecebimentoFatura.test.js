// backend/src/__tests__/formasRecebimentoFatura.test.js
//
// COMO O CLIENTE QUER RECEBER A FATURA — premissa de 2026-09-22.
//
// 🔴 POR QUE UM GATE. A regra tem DOIS lados que só funcionam juntos, e cada um
// falha em SILÊNCIO sozinho:
//   (1) o cadastro do proprietário GRAVA a escolha;
//   (2) a tela de Faturamento OBEDECE a escolha.
// Sem (1) a tela lê sempre o default e nada muda; sem (2) o gestor marca "só
// impresso", o cadastro grava bonitinho e o financeiro continua mandando WhatsApp.
// Nenhum dos dois quebra nada — a tela funciona, e a preferência é ignorada.
//
// 🔴 A ARMADILHA CENTRAL é o DEFAULT. Preferência ausente (toda a base anterior à
// migration, que nasce com NULL de propósito) tem de significar TODAS AS FORMAS. Se
// alguém trocar isso por "nenhuma", os botões de envio somem da base inteira de uma
// vez, sem erro e sem log — é o pior desfecho possível e o mais fácil de escrever.
//
// ⚠️ Lista VAZIA no payload NÃO é a mesma coisa que ausência: é uma escolha inválida
// (o cliente não receberia a fatura por meio nenhum) e precisa dar 400.
'use strict';

// A lib importa o client Prisma (TypeScript) só para o acesso ao banco; o que se
// testa aqui é a NORMALIZAÇÃO e a forma do código. Mesmo mock de `cadastroPorEmail`.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const formas = require('../lib/formasRecebimentoFatura');

const SRC     = path.join(__dirname, '..');
const FRONT   = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const leBack  = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const leFront = (...p) => fs.readFileSync(path.join(FRONT, ...p), 'utf8');

describe('lib/formasRecebimentoFatura — normalização', () => {
  test('as formas são as três que ENTREGAM a fatura ao cliente', () => {
    expect(formas.FORMAS).toEqual(['EMAIL', 'WHATSAPP', 'IMPRESSO']);
  });

  test('exportar CSV NÃO é forma de recebimento (baixa arquivo para a clínica)', () => {
    expect(formas.FORMAS).not.toContain('CSV');
    expect(formas.FORMAS).not.toContain('EXPORTAR');
  });

  test('campo ausente não grava nada — payload parcial não apaga a preferência', () => {
    expect(formas.normalizarFormas(undefined).formas).toBeUndefined();
    expect(formas.normalizarFormas(null).formas).toBeUndefined();
    expect(formas.normalizarFormas(undefined).erro).toBeUndefined();
  });

  test('lista VAZIA é recusada — a fatura ficaria sem nenhuma saída', () => {
    expect(formas.normalizarFormas([]).erro).toBeTruthy();
    expect(formas.normalizarFormas([]).formas).toBeUndefined();
    expect(formas.normalizarFormas('').erro).toBeTruthy();
    // Só valor desconhecido também esvazia — e vazio é erro, nunca "todas".
    expect(formas.normalizarFormas(['CARTA_POMBO']).erro).toBeTruthy();
  });

  test('aceita array ou CSV, ignora caixa/espaço/desconhecido e não repete', () => {
    expect(formas.normalizarFormas([' whatsapp ', 'EMAIL', 'xx', 'EMAIL']).formas)
      .toEqual(['EMAIL', 'WHATSAPP']);
    expect(formas.normalizarFormas('IMPRESSO,email').formas).toEqual(['EMAIL', 'IMPRESSO']);
  });

  test('a ordem gravada é sempre a canônica — senão a auditoria acusa mudança inexistente', () => {
    const a = formas.normalizarFormas(['IMPRESSO', 'EMAIL', 'WHATSAPP']).formas.join(',');
    const b = formas.normalizarFormas(['WHATSAPP', 'IMPRESSO', 'EMAIL']).formas.join(',');
    expect(a).toBe(b);
    expect(a).toBe('EMAIL,WHATSAPP,IMPRESSO');
  });

  test('🔴 sem preferência gravada = TODAS as formas (não "nenhuma")', () => {
    // Toda a base anterior à migration está assim, e é isso que preserva o
    // comportamento atual da tela de Faturamento.
    expect(formas.formasDoTexto(null)).toEqual(formas.FORMAS);
    expect(formas.formasDoTexto('')).toEqual(formas.FORMAS);
    expect(formas.formasDoTexto('   ')).toEqual(formas.FORMAS);
    // CSV corrompido também cai no default — nunca em lista vazia.
    expect(formas.formasDoTexto('lixo,outra-coisa')).toEqual(formas.FORMAS);
  });

  test('CSV gravado volta como a escolha feita', () => {
    expect(formas.formasDoTexto('WHATSAPP')).toEqual(['WHATSAPP']);
    expect(formas.formasDoTexto('IMPRESSO,EMAIL')).toEqual(['EMAIL', 'IMPRESSO']);
  });

  test('salvarFormas não faz nada sem valor, sem usuário ou sem empresa', async () => {
    const client = { $executeRawUnsafe: jest.fn() };
    await formas.salvarFormas(client, 1, 1, undefined);
    await formas.salvarFormas(client, null, 1, ['EMAIL']);
    await formas.salvarFormas(client, 1, null, ['EMAIL']);
    expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('gate estrutural — o cadastro GRAVA a escolha', () => {
  const src = leBack('controllers', 'ProprietarioController.js');

  test('criar e atualizar normalizam o campo e respondem 400 na escolha inválida', () => {
    expect(src).toMatch(/lib\/formasRecebimentoFatura/);
    // Duas normalizações: uma em criar(), outra em atualizar().
    expect(src.match(/formasFatura\.normalizarFormas\(/g)).toHaveLength(2);
    expect(src.match(/formasParsed\.erro/g).length).toBeGreaterThanOrEqual(2);
  });

  test('🔴 grava DEPOIS do salvarPerfil — é um UPDATE na linha do perfil', () => {
    // Antes do upsert do perfil o UPDATE acertaria ZERO linhas, em silêncio: a
    // escolha some e ninguém percebe até o financeiro reclamar.
    const gravacoes = [...src.matchAll(/formasFatura\.salvarFormas\(/g)];
    // criar() tem dois caminhos (login já existia / cliente novo) + atualizar().
    expect(gravacoes).toHaveLength(3);
    for (const g of gravacoes) {
      const antes = src.slice(0, g.index);
      const ultimoPerfil = antes.lastIndexOf('perfilProp.salvarPerfil(');
      expect(ultimoPerfil).toBeGreaterThan(-1);
      expect(g.index - ultimoPerfil).toBeLessThan(700);
    }
  });

  test('as leituras devolvem o campo (lista, ficha, busca por e-mail e os salvares)', () => {
    expect(src.match(/formasFatura\.anexarFormas\(/g).length).toBeGreaterThanOrEqual(6);
  });

  test('a troca de dono do paciente honra a escolha feita no mesmo formulário', () => {
    const t = leBack('lib', 'transferenciaPropriedadeAnimal.js');
    expect(t).toMatch(/salvarFormasRecebimento\(/);
    expect(t.indexOf('salvarFormasRecebimento(')).toBeGreaterThan(t.indexOf('salvarPerfilProprietario('));
  });
});

describe('gate estrutural — a tela de Faturamento OBEDECE a escolha', () => {
  test('o backend entrega a preferência nos DOIS ramos de listarProprietarios', () => {
    const src = leBack('controllers', 'FaturaController.js');
    // Um para o PROPRIETARIO vendo a própria fatura, outro para a clínica.
    expect(src.match(/formasFatura\.anexarFormas\(/g)).toHaveLength(2);
    // O ramo da clínica precisa CONSUMIR o resultado — atribuir e não usar deixaria
    // a lista sem o campo, e a tela cairia no default silenciosamente.
    expect(src).toMatch(/const dados = comFormas/);
  });

  test('E-mail, WhatsApp e Imprimir são desabilitados conforme a escolha', () => {
    const tela = leFront('pages', 'Faturamento.tsx');
    for (const b of ['bloqueioEmail', 'bloqueioWhatsApp', 'bloqueioImpresso']) {
      // Derivado da preferência, aplicado ao `disabled` E guardado no handler —
      // a regra não pode morar só no atributo (teclado / leitor de tela).
      expect(tela).toMatch(new RegExp('const ' + b + '\\s*='));
      expect(tela).toMatch(new RegExp('disabled=\\{[^}]*!!' + b));
      expect(tela).toMatch(new RegExp('if \\(' + b + '\\)'));
    }
  });

  test('o fechamento em LOTE não vira a porta dos fundos', () => {
    const tela = leFront('pages', 'Faturamento.tsx');
    expect(tela).toMatch(/whatsappIndisponivel=\{/);
    expect(tela).toMatch(/emailIndisponivel=\{/);
  });

  test('exportar CSV NUNCA é bloqueado — é arquivo da clínica, não entrega ao cliente', () => {
    const tela = leFront('pages', 'Faturamento.tsx');
    const i = tela.indexOf('const handleCSV');
    expect(i).toBeGreaterThan(-1);
    expect(tela.slice(i, i + 400)).not.toMatch(/bloqueio/);
  });

  test('🔴 preferência desconhecida libera tudo — o front repete o default do backend', () => {
    const util = leFront('utils', 'formasRecebimentoFatura.ts');
    // `formaLiberada` com lista ausente/vazia responde SIM. Trocar por `false`
    // apagaria os botões de envio de toda a base legada de uma vez.
    expect(util).toMatch(/if \(!formas \|\| formas\.length === 0\) return true;/);
  });
});
