// backend/src/lib/cargosPrestador.js
//
// 🔴 DOIS CARGOS, UM COMPORTAMENTO: **FORNECEDOR** e **PRESTADOR**.
//
// Até 2026-09-08 existia UM cargo só — `FORNECEDOR` — e a tela o exibia como
// "Prestador" (só o rótulo; ver §12, sessão 2026-09-08 parte 5). O pedido de
// 2026-09-09 separou os dois: `PRESTADOR` passa a ser um cargo PRÓPRIO, ao lado de
// `FORNECEDOR`, e **nada do que já está gravado muda** — todo membro cadastrado
// continua com cargo `FORNECEDOR`, e `PRESTADOR` fica disponível para as inclusões
// dali em diante. Por isso os dois precisam conviver: um é o passado, o outro é o
// futuro, e AMBOS são o mesmo profissional EXTERNO para efeito de regra.
//
// O que os dois compartilham (e o que este módulo garante que não divirja):
//   • escopo de paciente por DESIGNAÇÃO (`DesignacaoPrestador`) — nunca herdam a
//     equipe (`lib/animalScope.js`, `lib/animalAccess.js`);
//   • só enxergam a PRÓPRIA agenda (`AgendamentoController`);
//   • entram no seletor de destino do encaminhamento e ganham designação ao serem
//     encaminhados (`EncaminhamentoController`);
//   • permissão por MEMBRO (`PermissaoMembro`), não pela Matriz do perfil
//     (`EquipeController.minhasPermissoes`);
//   • `userType` efetivo `FORNECEDOR` (`lib/tipoContexto.js#CARGO_PARA_TIPO`) — é o
//     que faz TODO gate escrito contra `userType` funcionar para os dois sem mudança.
//
// O que os distingue é só o CADASTRO a que o login se amarra:
//   FORNECEDOR → `tb_fornecedores` (Fornecedor.userId)
//   PRESTADOR  → `tb_prestadores`  (Prestador.userId)
// — as duas tabelas já existiam com `userId @unique` justamente para isso.
//
// ⚠️ REGRA: nenhum `cargo === 'FORNECEDOR'` novo no código. Comparação de cargo que
// signifique "é prestador externo" passa por aqui — foi para não ter de caçar 15
// comparações soltas na próxima vez que um cargo entrar nessa família.
'use strict';

const CARGOS_PRESTADOR = ['FORNECEDOR', 'PRESTADOR'];

/** O cargo pertence à família do prestador externo? */
const ehCargoPrestador = (cargo) => CARGOS_PRESTADOR.includes(cargo);

/**
 * O MEMBRO é prestador externo? Olha `cargo` (o principal) e `cargos[]` (multi-cargo).
 * Membro com mais de um cargo entra na regra se QUALQUER um deles for da família —
 * o escopo por designação é restrição, e restrição não se perde por acúmulo de papel.
 */
const membroEhPrestador = (m) =>
  ehCargoPrestador(m?.cargo) || (Array.isArray(m?.cargos) && m.cargos.some(ehCargoPrestador));

/**
 * Cláusulas `OR` do Prisma para achar membros da família — cobre `cargo` e `cargos[]`.
 * Espalhe com `...OR_CARGO_PRESTADOR` dentro do `OR` da consulta.
 */
const OR_CARGO_PRESTADOR = CARGOS_PRESTADOR.flatMap((c) => [{ cargo: c }, { cargos: { has: c } }]);

/**
 * 🔴 **ELES NÃO SÃO EQUIPE** (decisão de 2026-09-09) — `where` que tira a família da
 * listagem de membros.
 *
 * `MembroEquipe` continua existindo para eles, mas como CARTÃO DE ACESSO emitido pelo
 * cadastro, não como cadeira na equipe (ver `lib/acessoExterno.js`). Aplicado nas
 * consultas de `listarMembros`/`listarMembrosPorEquipe`, que alimentam de uma vez a
 * tela **Equipe**, o **Controle de Acesso** e a **grade da Agenda** — filtrar no
 * ENDPOINT é o que faz as três saírem juntas, sem depender de cada tela lembrar.
 *
 * ⚠️ Filtra pelo cargo PRIMÁRIO. Quem é VETERINARIO e acumula PRESTADOR em `cargos[]`
 * CONTINUA na equipe — ele é da casa e também atende como externo; sumir da lista o
 * tornaria ingerenciável. É o oposto de `membroEhPrestador`, que existe para
 * RESTRINGIR acesso (e ali qualquer cargo da família basta).
 *
 * ⚠️ NÃO se aplica ao inventário da plataforma (`listarTodasEmpresasAdmin`): ali o
 * ADMIN precisa ver todo vínculo que existe, inclusive os cartões de acesso.
 */
const SEM_EXTERNOS = { cargo: { notIn: CARGOS_PRESTADOR } };

module.exports = { CARGOS_PRESTADOR, ehCargoPrestador, membroEhPrestador, OR_CARGO_PRESTADOR, SEM_EXTERNOS };
