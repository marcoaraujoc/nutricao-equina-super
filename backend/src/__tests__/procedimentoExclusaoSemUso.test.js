// backend/src/__tests__/procedimentoExclusaoSemUso.test.js
//
// EXCLUIR PROCEDIMENTO SÓ QUANDO ELE NUNCA FOI USADO — premissa de 2026-09-23.
//
// 🔴 POR QUE UM GATE: a ligação entre o CADASTRO do procedimento e o uso dele é pelo
// NOME, não por chave estrangeira — `tb_prescricoes` guarda o procedimento em
// `medicamento` (texto) e o ledger do prestador em `procedimento_nome`. Como o banco
// não tem FK para recusar, o `DELETE` PASSA e o prontuário fica apontando para um
// cadastro que não existe mais. A falha é silenciosa: nada quebra na hora, e o buraco
// só aparece quando alguém abre um atendimento antigo.
//
// ⚠️ O que se trava aqui é a EXISTÊNCIA de cada checagem, não a redação dela.
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.join(__dirname, '..');
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');

const leia      = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const leiaFront = (p) => fs.readFileSync(path.join(FRONT, p), 'utf8');

/** Tira comentários: o que vale é o CÓDIGO, não a intenção escrita ao lado dele. */
const semComentarios = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('exclusão de procedimento da clínica', () => {
  const ctrl = semComentarios(leia('controllers/ProcedimentoCadastroController.js'));

  test('as QUATRO origens de uso são consultadas antes de apagar', () => {
    // Prescrição/evolução: o par (tipo PROCEDIMENTO, nome) é a única ligação que existe.
    expect(ctrl).toMatch(/prisma\.prescricao\.count\(\{ where: \{ tipo: 'PROCEDIMENTO', medicamento: porNome \} \}\)/);
    // Orçamento: por `refId` (o id do catálogo) OU pela descrição, porque item antigo
    // pode ter nascido sem a referência.
    expect(ctrl).toMatch(/prisma\.orcamentoItem\.count/);
    expect(ctrl).toMatch(/OR: \[\{ refId: id \}, \{ descricao: porNome \}\]/);
    // Combo: o `onDelete: Cascade` de tb_procedimento_combo_itens ESVAZIARIA o pacote
    // de alguém em silêncio se esta contagem saísse.
    expect(ctrl).toMatch(/prisma\.procedimentoComboItem\.count\(\{ where: \{ procedimentoId: id \} \}\)/);
    // Ledger do prestador: recibo e conta a pagar já lançados.
    expect(ctrl).toMatch(/contarNoLedgerDoPrestador\(nome\)/);
  });

  test('o ledger é lido por SQL CRU e atrás do guarda de schema', () => {
    // A tabela nasceu numa migration que pode não estar aplicada, e no Windows o
    // `prisma generate` falha com o backend rodando (§11): pelo client tipado, uma
    // base defasada derrubaria a checagem inteira com 500 — e ninguém saberia que o
    // uso não foi conferido.
    expect(ctrl).toMatch(/vinculoPrestador\.temTabelas\(\)/);
    expect(ctrl).toMatch(/tb_execucoes_procedimento_prestador/);
  });

  test('uso encontrado RECUSA com 409 e aponta o inativar como saída', () => {
    expect(ctrl).toMatch(/PROCEDIMENTO_EM_USO/);
    expect(ctrl).toMatch(/status\(409\)/);
  });

  test('linha GLOBAL não é excluível aqui', () => {
    // Ela vale para todas as clínicas do SaaS e o RLS recusaria de qualquer forma —
    // o que viraria um 500 sem explicação no lugar de uma recusa legível.
    const trecho = ctrl.slice(ctrl.indexOf('const excluirProprio'));
    expect(trecho).toMatch(/item\.empresaId == null/);
    expect(trecho).toMatch(/ITEM_DO_SISTEMA/);
  });

  test('motivo obrigatório e auditoria EXCLUSAO na MESMA transação do delete', () => {
    const trecho = ctrl.slice(ctrl.indexOf('const excluirProprio'));
    expect(trecho).toMatch(/motivo\.length < 3/);
    // A auditoria vem ANTES do delete: a linha some do catálogo, então o rastro é o
    // único lugar onde ela continua existindo.
    const iAudit  = trecho.indexOf("categoria:  'EXCLUSAO'");
    const iDelete = trecho.indexOf('procedimentoVeterinario.delete');
    expect(iAudit).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iAudit);
  });

  test('a rota é LITERAL, antes de /:id, e usa o slug de deletar', () => {
    const rotas = semComentarios(leia('routes/procedimentos.js'));
    const iProprio = rotas.indexOf("router.delete('/cadastro/proprio/:id'");
    const iGenerica = rotas.indexOf("router.delete('/:id'");
    expect(iProprio).toBeGreaterThan(-1);
    // Armadilha 1: com a ordem invertida o Express leria "cadastro" como valor de :id.
    expect(iGenerica).toBeGreaterThan(iProprio);
    expect(rotas).toMatch(/router\.delete\('\/cadastro\/proprio\/:id'[\s\S]{0,160}cadastro\.procedimento\.deletar/);
  });

  test('a tela oferece EXCLUIR ao lado do INATIVAR, com justificativa', () => {
    const tela = leiaFront('pages/CadastroProcedimento.tsx');
    expect(tela).toMatch(/tom="cancelar" icone=\{Trash2\} rotulo="Excluir"/);
    // Armadilha 33: o motivo vai em `data` da config do DELETE (o axios não aceita
    // corpo no segundo argumento).
    expect(tela).toMatch(/api\.delete\(`\/procedimentos\/cadastro\/proprio\/\$\{p\.id\}`, \{ data: \{ motivo \} \}\)/);
    // Inativar CONTINUA existindo: usado uma vez, o cadastro deixa de ser excluível
    // para sempre — sem a chave não haveria como tirá-lo da frente.
    expect(tela).toMatch(/rotulo=\{p\.ativo \? 'Inativar' : 'Ativar'\}/);
    // O erro da recusa fica NO MODAL: no topo da página ficaria atrás do overlay.
    expect(tela).toMatch(/erro=\{erroExcluir\}/);
  });
});
