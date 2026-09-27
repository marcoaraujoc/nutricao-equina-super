'use strict';

/**
 * A LOGO DA CLÍNICA ABRE A FATURA — e é a logo da clínica DA FATURA (2026-09-26).
 *
 * 1. Na folha (impressão, PDF, WhatsApp, e-mail — todos saem de `gerarHtmlFatura`) a
 *    logo fica ACIMA da faixa verde, no tamanho do cabeçalho padrão dos documentos.
 * 2. A logo vinha da PRIMEIRA equipe do cliente em qualquer clínica: o cliente de
 *    duas clínicas recebia a fatura de uma com a logo da outra. Agora vem da empresa
 *    do contexto, o mesmo critério do PIX impresso na mesma folha.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

describe('logo da fatura', () => {
  it('a logo vem ANTES da faixa verde, e não dentro dela', () => {
    const src = ler('frontend/src/utils/FaturaExport.ts');
    const corpo = src.slice(src.indexOf('<body>'));
    const logo  = corpo.indexOf('class="topo-logo"');
    const faixa = corpo.indexOf('<div class="header">');
    expect(logo).toBeGreaterThan(-1);
    expect(faixa).toBeGreaterThan(logo);
    expect(src).not.toContain('brand-logo-box');
  });

  it('sem logo, o NOME da clínica ocupa o lugar dela — e chega a todo documento da fatura', () => {
    const src = ler('frontend/src/utils/FaturaExport.ts');
    expect(src).toMatch(/: \(empresaNome\?\.trim\(\) \? `<div class="topo-logo topo-nome">\$\{esc\(/);
    const tela = ler('frontend/src/pages/Faturamento.tsx');
    // painel (imprimir + envio), bloco do paciente (imprimir + envio) e lote
    const chamadas = tela.match(/(gerarHtmlFatura|imprimirFatura)\(.*$/gm) ?? [];
    expect(chamadas.length).toBe(5);
    for (const c of chamadas) expect(c).toMatch(/recebimento, empresaNome\)/);
    const ctrl = ler('backend/src/controllers/FaturaController.js');
    expect(ctrl).toMatch(/dados: \{ logoUrl, recebimento, empresaNome: empresa\?\.nome \?\? null \}/);
  });

  it('a rota da logo da fatura passa a empresa do contexto', () => {
    const src = ler('backend/src/controllers/FaturaController.js');
    expect(src).toMatch(/resolverLogoPorProprietario\(req\.params\.proprietarioId, empresaId,/);
  });

  it('com empresa informada, a logo é a DELA — nunca a da primeira equipe do cliente', async () => {
    jest.resetModules();
    const chamadas = [];
    jest.doMock('../lib/prisma', () => ({
      default: {
        empresa: { findUnique: async ({ where }) => ({ id: where.id, cnpj: '12345678000199' }) },
        empresaConfiguracao: {
          findFirst: async ({ where }) => { chamadas.push(where); return { logoUrl: `/api/midia/logo-${where.empresaId}` }; },
        },
        equipe: { findUnique: async () => ({ empresaId: 999 }) },
      },
    }), { virtual: true });
    jest.doMock('../middlewares/permissao.middleware', () => ({
      getEquipeIdsDoProprietario: async () => [1],
    }), { virtual: true });
    const { resolverLogoPorProprietario } = require('../lib/logoEmpresaUtils');
    await expect(resolverLogoPorProprietario(221, 59, null)).resolves.toBe('/api/midia/logo-59');
    expect(chamadas).toEqual([{ empresaId: 59, equipeId: null }]);
  });
});
