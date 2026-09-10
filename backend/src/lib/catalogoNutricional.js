// backend/src/lib/catalogoNutricional.js
'use strict';

/**
 * CATÁLOGO NUTRICIONAL — quem é dono do quê, e quem pode apagar.
 *
 * Alimento, Nutriente e ComposicaoAlimento viraram CATÁLOGO MISTO em 2026-09-09
 * (migration `20261004000000_catalogo_nutricional_por_empresa`), na MESMA forma de
 * `tb_medicamentos` / `tb_procedimentos_vet` / `tb_especialidades`:
 *
 *   empresa_id IS NULL  → linha GLOBAL do sistema. Toda clínica LÊ, só o ADMIN escreve.
 *   empresa_id setado   → cadastrada pela clínica. Só ela vê, edita e EXCLUI.
 *
 * 🔴 A EXCLUSÃO AQUI É DE VERDADE (`delete`), não `ativo = false` — pedido explícito de
 * 2026-09-09. É a diferença em relação a `MedicamentoController.excluir`, que faz soft
 * delete. Por isso todo caminho de exclusão passa por `bloqueioDeUso()`: catálogo some
 * do banco, mas o que já foi usado num paciente (dieta, exame) NÃO pode virar FK órfã.
 *
 * ⚠️ O RLS é a garantia, não estes helpers. A policy já filtra a LEITURA (global +
 * próprio) e recusa a ESCRITA fora do tenant. O que mora aqui é a resposta HTTP
 * legível — sem ela, tentar editar linha global devolveria "0 linhas atualizadas" ou
 * um erro cru de banco, e ninguém entenderia o motivo.
 */

const { comEscopoPlataforma } = require('./prismaTenant');

/** ADMIN da PLATAFORMA — o dono do catálogo global. Nunca o gestor de uma clínica. */
function ehAdminPlataforma(req) {
  const tipo = String(req?.user?.role ?? req?.user?.userTypeGlobal ?? req?.user?.userType ?? '').toUpperCase();
  return tipo === 'ADMIN';
}

/**
 * A empresa dona de uma linha NOVA.
 * ADMIN da plataforma cria GLOBAL (null); a clínica cria a dela.
 * `undefined` = não há dono possível — quem chama responde 400 (ver `EXIGE_EMPRESA`).
 */
function empresaDoNovoItem(req) {
  if (ehAdminPlataforma(req)) return null;
  return req?.empresaId ?? undefined;
}

/**
 * Executa `fn` no escopo capaz de ESCREVER a linha alvo.
 *
 * ⚠️ Escrever linha GLOBAL exige `app.plataforma = on`: o `WITH CHECK` da policy é
 * `empresa_id = app_empresa_id()`, e com os dois lados NULL isso avalia NULL — que o
 * RLS trata como falso. Sem este envelope, o ADMIN criaria alimento global e receberia
 * "new row violates row-level security policy".
 */
function noEscopoDeEscrita(req, ehGlobal, fn) {
  if (ehGlobal && ehAdminPlataforma(req)) return comEscopoPlataforma(fn);
  return fn();
}

/**
 * Pode ESCREVER (editar/excluir) nesta linha?
 * Devolve `null` quando pode; senão a resposta pronta `{ status, corpo }`.
 *
 * ⚠️ Linha do SISTEMA é somente leitura para a clínica — inclusive para o GESTOR, que
 * tem bypass no Controle de Acesso. O bypass vale sobre o que é DELA; o catálogo global
 * é compartilhado com todas as outras clínicas, e uma alteração ali sairia da empresa.
 */
function bloqueioDeEscrita(req, item, rotulo = 'item') {
  if (ehAdminPlataforma(req)) return null;
  if (item.empresaId == null) {
    return {
      status: 403,
      corpo: {
        sucesso: false,
        code: 'ITEM_DO_SISTEMA',
        mensagem: `Este ${rotulo} é do catálogo do sistema e só pode ser alterado pelo administrador da plataforma. Cadastre um ${rotulo} próprio da clínica para usar valores diferentes.`,
      },
    };
  }
  // Defesa em profundidade: o RLS já não devolveria a linha de outra empresa.
  if (req?.empresaId != null && Number(item.empresaId) !== Number(req.empresaId)) {
    return {
      status: 403,
      corpo: { sucesso: false, code: 'ITEM_DE_OUTRA_EMPRESA', mensagem: `Este ${rotulo} pertence a outra clínica.` },
    };
  }
  return null;
}

/**
 * Monta o 409 de "está em uso" a partir das contagens medidas pelo chamador.
 * `usos` = [{ quantidade, singular, plural }]. Nada em uso ⇒ `null` (pode apagar).
 *
 * 🔴 É isto que torna o hard delete seguro: a linha some do banco, mas só quando não
 * há nada apontando para ela. Apagar um alimento usado numa dieta apagaria a dieta do
 * paciente junto (ou estouraria a FK no meio da transaction) — decisão de 2026-09-09:
 * recusar e DIZER o que impede.
 */
function bloqueioDeUso(usos, rotulo = 'item') {
  const emUso = usos.filter((u) => Number(u.quantidade) > 0);
  if (emUso.length === 0) return null;

  const partes = emUso.map((u) => {
    const n = Number(u.quantidade);
    return `${n} ${n === 1 ? u.singular : u.plural}`;
  });
  return {
    status: 409,
    corpo: {
      sucesso: false,
      code: 'EM_USO',
      mensagem: `Não é possível excluir: este ${rotulo} está em uso em ${partes.join(' e ')}. Remova esses registros antes de excluir.`,
      usos: emUso,
    },
  };
}

const EXIGE_EMPRESA = {
  status: 400,
  corpo: {
    sucesso: false,
    code: 'SEM_EMPRESA',
    mensagem: 'Nenhuma clínica ativa no contexto — não é possível saber de quem seria este cadastro.',
  },
};

/** `true` quando a linha é do catálogo do sistema (usado pelo front para o selo). */
const marcarOrigem = (linha) => ({ ...linha, doSistema: linha?.empresaId == null });
const marcarOrigemEmLista = (lista) => (lista ?? []).map(marcarOrigem);

module.exports = {
  ehAdminPlataforma,
  empresaDoNovoItem,
  noEscopoDeEscrita,
  bloqueioDeEscrita,
  bloqueioDeUso,
  marcarOrigem,
  marcarOrigemEmLista,
  EXIGE_EMPRESA,
};
