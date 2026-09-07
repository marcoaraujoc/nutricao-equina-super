// backend/src/__tests__/proprietarioInativoNoCadastro.test.js
//
// CADASTRAR PACIENTE PARA UM CLIENTE INATIVO NESTA CLÍNICA — pergunta, não silêncio.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE, e por que ele é estrutural: o defeito não é uma
// exceção nem um teste vermelho — é o cadastro seguir em frente. Até 2026-09-06 o
// `criar` REATIVAVA o cliente sozinho para o animal não nascer com dono inativo. O
// invariante estava certo; o silêncio, não: alguém tinha inativado aquele cliente de
// propósito (`removerDaEmpresa`) e ele voltava sem ninguém decidir nem ficar sabendo.
//
// A regressão aqui volta do jeito mais fácil que existe — apagar o guard "para
// simplificar" e deixar o `salvarPerfil({ ativo: true })` reativar como antes. Nada
// quebra, nenhum teste de fluxo fica vermelho, e o cliente removido reaparece.
'use strict';

const fs   = require('fs');
const path = require('path');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** Remove comentários: o gate não pode ser satisfeito (nem acusado) por um texto. */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('AnimalController.criar — cliente inativo na empresa', () => {
  const src = semComentarios(ler('controllers/AnimalController.js'));

  test('recusa o cadastro quando o cadastro do cliente está INATIVO nesta clínica', () => {
    // O 409 é o que devolve a decisão para a pessoa. Sem ele, ou o animal nasce com
    // dono inativo (e some da lista) ou o cliente é reativado em silêncio.
    expect(src).toMatch(/ativo === false/);
    expect(src).toMatch(/status\(409\)[\s\S]{0,200}inativo:\s*true/);
  });

  test('devolve QUEM é o cliente — sem isso a tela não tem o que perguntar', () => {
    expect(src).toMatch(/proprietario:\s*\{\s*id:\s*prop\.id/);
  });

  test('só reativa com a confirmação explícita da tela', () => {
    expect(src).toMatch(/reativarProprietario/);
    // A confirmação é lida do corpo nas duas formas (JSON e multipart, onde tudo é string).
    expect(src).toMatch(/reativarProprietario === true/);
    expect(src).toMatch(/reativarProprietario === 'true'/);
  });

  test('🔴 confirmar no formulário do ANIMAL não é bypass do Controle de Acesso', () => {
    // Reativar cliente é `cadastro.proprietario.ativar`. Se a confirmação bastasse,
    // qualquer um com "criar animal" reativaria clientes que a clínica removeu.
    expect(src).toMatch(/getNivelEfetivo\(req,\s*'cadastro\.proprietario\.ativar'\)/);
    expect(src).toMatch(/status\(403\)/);
  });

  test('o guard vem ANTES da reativação — depois dela não há o que perguntar', () => {
    const posGuard   = src.indexOf('reativarProprietario');
    const posReativa = src.search(/salvarPerfilProprietario\([^)]*ativo:\s*true/);
    expect(posGuard).toBeGreaterThan(-1);
    expect(posReativa).toBeGreaterThan(-1);
    expect(posGuard).toBeLessThan(posReativa);
  });

  test('cliente NOVO não passa pelo guard — não há cadastro anterior a respeitar', () => {
    // `isNewProprietario` acabou de ser criado nesta chamada: perguntar ali seria
    // pedir confirmação para reativar quem nunca foi inativado.
    expect(src).toMatch(/vetEmpresaId && !isNewProprietario/);
  });
});
