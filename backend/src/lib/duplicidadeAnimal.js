// backend/src/lib/duplicidadeAnimal.js
'use strict';

/**
 * DUPLICIDADE DE PACIENTE — mesmo nome, mesmo local, mesmo dono.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A REGRA (decisão de produto, 2026-09-06)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. Mesmo NOME no mesmo LOCAL          → PERGUNTA ("deseja continuar?").
 *   2. Respondido que sim, é do mesmo DONO?
 *        · NÃO  → segue: são dois pacientes diferentes que por acaso têm o mesmo
 *                 nome no mesmo haras. Acontece o tempo todo ("Mel", "Thor").
 *        · SIM  → é DUPLICATA, não se cadastra.
 *            · e o existente está INATIVO → pergunta se quer ATIVAR aquele.
 *            · e está ativo               → não há o que fazer: já está cadastrado.
 *
 * POR QUE NÃO BASTA O NOME: até aqui qualquer paciente com nome repetido NA CLÍNICA
 * era barrado (`jaCadastradoAqui`), e isso é largo demais — dois clientes diferentes
 * não podem ser impedidos de ter cada um o seu "Thor". O que caracteriza duplicata é
 * a TRÍADE: mesmo nome, mesmo lugar, mesmo dono.
 *
 * ⚠️ O ESCOPO É A EMPRESA ATIVA. Paciente com o mesmo nome em OUTRA clínica é outro
 * cadastro, independente (§5 do CLAUDE.md) — nunca entra nesta conta.
 *
 * ⚠️ "INATIVO" AQUI SÃO OS DOIS ESTADOS, e de propósito: `ativo = false` (exclusão
 * lógica, o paciente some de tudo) e `inativo = true` (prontuário congelado, some das
 * ações). Para quem está cadastrando, os dois significam a mesma coisa — "existe, mas
 * não está em uso" —, e a saída é a mesma: reaproveitar o cadastro em vez de criar um
 * segundo. Quem sabe QUAL reativar é o controller, que tem as duas rotas.
 *
 * ⚠️ Comparação de nome SEM ACENTO E SEM CAIXA: "Mel", "mel" e "Mél" são o mesmo
 * paciente para quem digita. Comparar cru deixaria a duplicata passar pela diferença
 * de um acento — que é justamente o erro de digitação mais comum.
 */

const prismaPadrao = require('./prisma').default;

// Pares para o `translate()` do Postgres — a MESMA remoção de acento que
// `normalizarNome` faz em JS, feita no banco (ver a consulta abaixo).
// ⚠️ As duas cadeias precisam ter o mesmo comprimento em CARACTERES: o `translate`
// mapeia posição a posição, e uma sobra desloca todo o resto.
const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN';

/** "Mél " → "mel". Único ponto de normalização — front e back precisam concordar. */
function normalizarNome(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira os acentos (combining marks)
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Procura pacientes que colidem com o que está sendo cadastrado.
 *
 * @param {object}  opts
 * @param {string}  opts.nome
 * @param {number?} opts.localizacaoId  local do animal (null = sem local escolhido)
 * @param {number}  opts.empresaId      SEMPRE a empresa ativa
 * @param {number?} opts.proprietarioId dono pretendido, quando já se sabe quem é
 * @param {number?} opts.ignorarId      o próprio animal (edição)
 * @returns {Promise<{conflitos: Array, mesmoLocal: Array, duplicado: object|null, duplicadoInativo: object|null}>}
 */
async function verificarDuplicidadeAnimal({
  nome, localizacaoId = null, empresaId, proprietarioId = null, ignorarId = null,
}, client = prismaPadrao) {
  const alvo = normalizarNome(nome);
  const vazio = { conflitos: [], mesmoLocal: [], duplicado: null, duplicadoInativo: null };
  if (!alvo || !empresaId) return vazio;

  // 🔴 A COMPARAÇÃO SEM ACENTO É FEITA NO BANCO, e tem de ser.
  // A primeira versão buscava com `contains` e normalizava em JS — e não funcionava:
  // `contains: 'Mel'` (mesmo `insensitive`) NÃO casa "Mél" no Postgres, então o
  // candidato nunca chegava ao filtro de JS e a duplicata passava batido. Foi um teste
  // que pegou isto, não o uso.
  //
  // `translate()` em vez de `unaccent()`: a extensão pode não estar instalada na base
  // do cliente, e uma duplicidade que só funciona em algumas instalações é pior que
  // nenhuma. `lower()` + `btrim()` completam a mesma normalização de `normalizarNome`,
  // que continua sendo a referência dos dois lados.
  const linhas = await client.$queryRawUnsafe(
    // ⚠️ O NOME DO DONO SAI DO CADASTRO DESTA EMPRESA (§36), não de `users`: o mesmo
    // login pode ser "Laura" na identidade global e "Patricia Costa" no cadastro da
    // clínica — e é o nome DAQUI que a pessoa reconhece no aviso. `users.fullName` é
    // só a reserva do cliente LEGADO, que não tem cadastro por empresa.
    `SELECT a.id, a.nome, a.ativo, a.inativo, a.localizacao_id AS "localizacaoId",
            a."userId", l.nome AS "localNome",
            COALESCE(pp.full_name, u."fullName") AS "donoNome"
       FROM schs2vet.tb_animais a
       LEFT JOIN schs2vet.tb_localizacoes_animal l ON l.id = a.localizacao_id
       LEFT JOIN schs2vet.users u ON u.id = a."userId"
       LEFT JOIN schs2vet.tb_proprietario_perfis pp
              ON pp.user_id = a."userId" AND pp.empresa_id = a."empresaId"
      WHERE a."empresaId" = $1
        AND ($3::int IS NULL OR a.id <> $3::int)
        AND translate(lower(btrim(a.nome)), '${COM_ACENTO}', '${SEM_ACENTO}') = $2
      LIMIT 50`,
    Number(empresaId),
    alvo,
    ignorarId ? Number(ignorarId) : null,
  ).catch(() => []);

  const candidatos = linhas.map(a => ({
    id: Number(a.id), nome: a.nome, ativo: a.ativo, inativo: a.inativo,
    localizacaoId: a.localizacaoId == null ? null : Number(a.localizacaoId),
    userId: a.userId == null ? null : Number(a.userId),
    localizacao: a.localNome ? { nome: a.localNome } : null,
    user: a.donoNome ? { fullName: a.donoNome } : null,
  }));

  const conflitos = candidatos
    // Rede de segurança: o SQL já compara normalizado, e este filtro só repete a conta
    // com a MESMA função que o front usa. Se um dia as duas divergirem, some daqui o
    // registro que o banco trouxe a mais — nunca aparece um que ele não trouxe.
    .filter(a => normalizarNome(a.nome) === alvo)
    .map(a => ({
      id:                a.id,
      nome:              a.nome,
      ativo:             a.ativo !== false,
      inativo:           a.inativo === true,
      localizacaoId:     a.localizacaoId ?? null,
      localNome:         a.localizacao?.nome ?? null,
      proprietarioId:    a.userId ?? null,
      proprietarioNome:  a.user?.fullName ?? null,
      // `null` quando ainda não se sabe quem será o dono (a tela pergunta o e-mail
      // depois do nome): a tela não pode concluir "é de outro" antes de saber.
      mesmoProprietario: proprietarioId == null ? null : Number(a.userId) === Number(proprietarioId),
    }));

  // Sem local escolhido ainda, não há como responder a pergunta 1 — devolve os
  // conflitos de nome para a tela, mas nenhum veredito.
  const mesmoLocal = localizacaoId == null
    ? []
    : conflitos.filter(c => c.localizacaoId != null && c.localizacaoId === Number(localizacaoId));

  const doMesmoDono = mesmoLocal.filter(c => c.mesmoProprietario === true);
  // Disponível vence: existindo um ativo, é ele que caracteriza a duplicata pura
  // (não há o que reativar). Só quando TODOS estão fora de uso é que se oferece
  // reaproveitar um.
  const duplicado        = doMesmoDono.find(c => c.ativo && !c.inativo) ?? null;
  const duplicadoInativo = duplicado ? null : (doMesmoDono[0] ?? null);

  return { conflitos, mesmoLocal, duplicado, duplicadoInativo };
}

module.exports = { verificarDuplicidadeAnimal, normalizarNome };
