// backend/src/lib/acessoExterno.js
//
// 🔴 O PROFISSIONAL EXTERNO NÃO É EQUIPE — MAS PRECISA DE UM CARTÃO DE ACESSO.
//
// Decisão de produto de 2026-09-09: **Fornecedor e Prestador são atuações estanques**,
// não fazem parte da equipe. Eles saem da tela Equipe, da grade da Agenda e dos
// contadores, e passam a ser geridos pelos PRÓPRIOS cadastros
// (`/cadastro/fornecedores`, `/cadastro/prestadores`) + Designações.
//
// ⚠️ O QUE **NÃO** MUDA, e por quê: `MembroEquipe` continua existindo para eles.
// Não é contradição — é infraestrutura. Todo o controle de acesso do sistema se
// resolve por ele:
//   • `resolveEquipeId` procura `MembroEquipe`; sem ela devolve `null`;
//   • `checkPermission` então cai no ramo final e responde **403 "Nenhuma equipe
//     ativa encontrada"** — e `userType FORNECEDOR` NÃO tem rota de escape (os dois
//     bypasses de dono têm `&& userType !== 'FORNECEDOR'` explícito);
//   • `PermissaoMembro` é chaveada por `(equipeId, userId, moduloSlug)`;
//   • `DesignacaoPrestador` é por equipe.
// Era exatamente esse o buraco documentado em `Prestador.userId` no schema: "dá para
// logar, mas sem RBAC — quem precisa de tela de verdade continua indo por Equipe >
// Incluir Membro". O cadastro prometia acesso e entregava uma tela vazia.
//
// Então o vínculo passa a ser um CARTÃO DE ACESSO emitido pelo cadastro, e não uma
// cadeira na equipe: quem o cria e o revoga é `/cadastro/prestadores`, e a tela Equipe
// nem o enxerga (`listarMembros` filtra a família — ver `lib/cargosPrestador.js`).
'use strict';

const prisma = require('./prisma').default;
const logger = require('./logger');
const { salvarVinculo, salvarPagamentoEAcesso } = require('./usuarioEmpresa');

/**
 * Equipe onde o cartão será emitido.
 *
 * O cadastro guarda `equipeId` denormalizado, mas ele é NULO em registro SYSTEM/legado
 * — nesse caso cai na primeira equipe da empresa. Sem empresa não há onde emitir: quem
 * chama decide o que fazer (hoje, seguir sem cartão e registrar o aviso).
 */
async function resolverEquipeDoCartao(client, { empresaId, equipeId }) {
  if (equipeId) return Number(equipeId);
  if (!empresaId) return null;
  const equipe = await client.equipe.findFirst({
    where:   { empresaId: Number(empresaId) },
    select:  { id: true },
    orderBy: { id: 'asc' },
  });
  return equipe?.id ?? null;
}

/**
 * Emite (ou reaproveita) o cartão de acesso do profissional externo.
 *
 * Roda DENTRO da transaction do cadastro: ou o cadastro e o acesso nascem juntos, ou
 * nenhum dos dois. A propagação das permissões padrão fica FORA (ver `aplicarPermissoes`),
 * porque `PermissaoService` abre transaction própria.
 *
 * @returns {Promise<{ equipeId: number, membroId: number }|null>} `null` quando não há
 *   equipe onde emitir — o login existe, mas sem RBAC (estado anterior, preservado).
 */
async function emitirCartaoAcesso(tx, { userId, empresaId, equipeId, cargo, cadastro = {} }) {
  if (!userId) return null;
  const equipeAlvo = await resolverEquipeDoCartao(tx, { empresaId, equipeId });
  if (!equipeAlvo) {
    logger.warn(`[acessoExterno] ${cargo} userId=${userId} sem equipe para emitir o cartão — login sem RBAC.`);
    return null;
  }

  // ⚠️ `upsert`, nunca `create`: o mesmo cadastro pode ser salvo mais de uma vez, e o
  // par (equipeId, userId) é @unique. E o `update` NÃO reescreve o cargo quando já
  // existe um — quem já é VETERINARIO/GESTOR nesta equipe não vira prestador porque
  // alguém marcou "terá acesso" num cadastro homônimo.
  const existente = await tx.membroEquipe.findUnique({
    where:  { equipeId_userId: { equipeId: equipeAlvo, userId: Number(userId) } },
    select: { id: true, cargo: true },
  });
  const membro = existente
    ? existente
    : await tx.membroEquipe.create({
        data: { equipeId: equipeAlvo, userId: Number(userId), cargo },
        select: { id: true, cargo: true },
      });

  // Cadastro por empresa (tb_usuario_empresa) — é dele que saem nome/telefone/endereço
  // nas telas da clínica. Sem esta linha o profissional aparece sem cadastro nenhum.
  const empresaDoCartao = empresaId ?? (await tx.equipe.findUnique({
    where: { id: equipeAlvo }, select: { empresaId: true },
  }))?.empresaId;
  if (empresaDoCartao) {
    await salvarVinculo(tx, Number(userId), Number(empresaDoCartao), {
      // Perfil só é imposto quando o vínculo NASCE aqui: rebaixar o perfil de quem já
      // é da casa seria o mesmo erro do cargo acima.
      ...(existente ? {} : { perfil: cargo }),
      ...cadastro,
    });
    await salvarPagamentoEAcesso(tx, Number(userId), Number(empresaDoCartao), { acessoSistema: true });
  }

  return { userId: Number(userId), equipeId: equipeAlvo, membroId: membro.id, cargoEfetivo: membro.cargo, criado: !existente };
}

/**
 * Propaga a Matriz do perfil para o membro recém-criado.
 *
 * FORA da transaction de propósito: `PermissaoService.aplicarPermissoesPadrao` abre a
 * própria. Best-effort — falhar aqui deixa o acesso sem permissão configurada (o
 * gestor ajusta no Controle de Acesso), mas não pode desfazer o cadastro que já gravou.
 */
async function aplicarPermissoes({ equipeId, userId, cargo, atualizadoPor }) {
  if (!equipeId || !userId) return;
  try {
    // `require` tardio: evita ciclo com PermissaoService, que já importa libs deste nível.
    const PermissaoService = require('../services/PermissaoService');
    await PermissaoService.aplicarPermissoesPadrao({ equipeId, userId, cargo, atualizadoPor });
  } catch (e) {
    logger.error(`[acessoExterno] Falha ao propagar permissões (userId=${userId}): ${e?.message ?? e}`);
  }
}

/**
 * Revoga o cartão — usado quando o cadastro desmarca "Terá acesso ao sistema".
 *
 * ⚠️ **NÃO apaga o `MembroEquipe`.** Apagar levaria junto, por cascade, a
 * `PermissaoMembro` daquela pessoa — e religar o acesso depois a devolveria sem
 * nenhuma das permissões que o gestor tinha configurado, em silêncio. O que corta o
 * login é `UsuarioEmpresa.acesso_sistema = false`, que `podeAcessarSistema` já
 * consulta em `login`, `2fa/verificar`, Google OAuth e `refresh`.
 */
async function revogarCartaoAcesso(tx, { userId, empresaId }) {
  if (!userId || !empresaId) return;
  await salvarPagamentoEAcesso(tx, Number(userId), Number(empresaId), { acessoSistema: false });
}

/**
 * Anexa `acessoEquipeId` a cada cadastro da lista — a equipe onde o cartão foi emitido.
 *
 * POR QUE A TELA PRECISA DISSO: a rota de designação é
 * `/equipes/:equipeId/prestadores/:userId/designacoes`, e o `equipeId` gravado NO
 * CADASTRO não serve: ele é `req.equipeId ?? null` no momento da criação, e em empresa
 * com CNPJ o seletor de contexto resolve no nível da EMPRESA — ou seja, vem nulo.
 * O cartão, esse sim, sempre nasce numa equipe concreta.
 *
 * Sem `acessoEquipeId` a tela teria de adivinhar a equipe, e o botão "Gerenciar Acesso"
 * falharia depois do clique (armadilha 28-d). Com ele, quem não tem cartão simplesmente
 * não ganha o botão.
 *
 * UMA consulta para a lista inteira.
 */
async function anexarEquipeDoAcesso(client, lista) {
  const itens = Array.isArray(lista) ? lista : [];
  const userIds = [...new Set(itens.map(i => i?.userId).filter(Boolean))].map(Number);
  if (userIds.length === 0) return itens.map(i => ({ ...i, acessoEquipeId: null }));

  const vinculos = await client.membroEquipe.findMany({
    where:   { userId: { in: userIds } },
    select:  { userId: true, equipeId: true },
    orderBy: { createdAt: 'asc' },
  }).catch(() => []);

  // Primeiro vínculo de cada um: o profissional externo tem um só por empresa, e o
  // `orderBy` deixa a escolha determinística quando ele atende a mais de uma clínica.
  const mapa = new Map();
  for (const v of vinculos) if (!mapa.has(v.userId)) mapa.set(v.userId, v.equipeId);

  return itens.map(i => ({ ...i, acessoEquipeId: i?.userId ? (mapa.get(Number(i.userId)) ?? null) : null }));
}

module.exports = { emitirCartaoAcesso, aplicarPermissoes, revogarCartaoAcesso, resolverEquipeDoCartao, anexarEquipeDoAcesso };
