// backend/src/lib/profissionalPerfil.js
'use strict';

/**
 * Perfil do PROFISSIONAL por EMPRESA — fonte única de leitura/escrita do cadastro
 * de um membro de equipe (veterinário, estagiário, enfermeiro, fornecedor…) dentro
 * de uma clínica.
 *
 * POR QUE EXISTE
 * `User.email` é único global: o mesmo profissional que atende em duas clínicas é
 * UMA linha em `users`. Sem isto, editar o telefone/endereço/CRMV na empresa A
 * mudava o cadastro da empresa B, e incluir alguém que já existia trazia os dados
 * da outra empresa prontos. O `User` ficou sendo só a IDENTIDADE (e-mail, senha,
 * userType, ativo global) e o cadastro passou para `tb_profissional_perfis`, um
 * registro por empresa. Mesmo login, cadastros INDEPENDENTES — a empresa é
 * escolhida no seletor de contexto que já existe.
 *
 * REGRA DE MERGE (igual à do proprietário)
 * Havendo perfil para a empresa do contexto, ele é a AUTORIDADE de todos os seus
 * campos — `null` no perfil significa "vazio nesta empresa" e NÃO cai de volta no
 * User. Sem perfil (dado legado ou ADMIN global sem contexto), lê-se o User.
 * `ativo` é a conjunção: inativo global (ADMIN) OU inativo na empresa → inativo.
 */

const prisma = require('./prisma').default;

// Campos que pertencem à empresa (o resto — email, senha, userType — é do User)
const CAMPOS_PERFIL = [
  'fullName', 'phone',
  'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'estado',
];

const SELECT_PERFIL = {
  id: true, userId: true, empresaId: true, ativo: true, crmv: true,
  ...Object.fromEntries(CAMPOS_PERFIL.map(c => [c, true])),
};

/** Aplica o perfil sobre o objeto do User (não muta o original). */
function mesclar(user, perfil) {
  if (!user || !perfil) return user;
  const out = { ...user };
  for (const campo of CAMPOS_PERFIL) {
    if (campo in user) out[campo] = perfil[campo];
  }
  // crmv não vem do User (mora em VetPerfil) — só sobrescreve o que a empresa definiu
  if ('crmv' in user && perfil.crmv != null) out.crmv = perfil.crmv;
  if ('ativo' in user) out.ativo = user.ativo !== false && perfil.ativo !== false;
  return out;
}

/** Perfis de vários profissionais numa empresa → Map(userId → perfil). */
async function buscarPerfis(userIds, empresaId, client = prisma) {
  if (!empresaId || userIds.length === 0) return new Map();
  const perfis = await client.profissionalPerfil.findMany({
    where:  { empresaId: Number(empresaId), userId: { in: userIds.map(Number) } },
    select: SELECT_PERFIL,
  });
  return new Map(perfis.map(p => [p.userId, p]));
}

/** Perfil cru (sem merge) de UM profissional na empresa. */
async function obterPerfil(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return null;
  return client.profissionalPerfil.findUnique({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    select: SELECT_PERFIL,
  });
}

/** Aplica o perfil da empresa a UM profissional já carregado. */
async function aplicarPerfil(user, empresaId, client = prisma) {
  if (!user || !empresaId) return user;
  return mesclar(user, await obterPerfil(user.id, empresaId, client));
}

/** Aplica os perfis da empresa a uma LISTA de profissionais (1 query). */
async function aplicarPerfilEmLista(users, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(users) || users.length === 0) return users;
  const mapa = await buscarPerfis(users.map(u => u.id), empresaId, client);
  return users.map(u => mesclar(u, mapa.get(u.id)));
}

/**
 * Aplica o perfil ao profissional aninhado em registros (ex.: `membro.user`,
 * `evolucao.veterinario`). `caminho` é o nome da propriedade que contém o User.
 */
async function aplicarPerfilEmRelacao(registros, caminho, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(registros) || registros.length === 0) return registros;
  const ids = [...new Set(registros.map(r => r?.[caminho]?.id).filter(Boolean))];
  if (ids.length === 0) return registros;
  const mapa = await buscarPerfis(ids, empresaId, client);
  return registros.map(r => {
    const alvo = r?.[caminho];
    if (!alvo) return r;
    return { ...r, [caminho]: mesclar(alvo, mapa.get(alvo.id)) };
  });
}

/**
 * Grava o cadastro do profissional NA EMPRESA (upsert). Só os campos presentes em
 * `dados` são tocados — `undefined` não altera, `null`/'' limpa naquela empresa.
 * NUNCA escrever esses campos direto no `User`: volta a vazar entre clínicas.
 */
async function salvarPerfil(client, userId, empresaId, dados = {}) {
  if (!userId || !empresaId) return null;
  const campos = {};
  for (const campo of [...CAMPOS_PERFIL, 'crmv']) {
    if (dados[campo] !== undefined) campos[campo] = dados[campo];
  }
  if (dados.ativo !== undefined) campos.ativo = Boolean(dados.ativo);
  return client.profissionalPerfil.upsert({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    update: campos,
    create: { userId: Number(userId), empresaId: Number(empresaId), ...campos },
    select: SELECT_PERFIL,
  });
}

/**
 * Garante que existe perfil do profissional na empresa. Usado ao INCLUIR alguém que
 * já tem login (cadastrado por outra clínica): o cadastro nasce com o que ESTA empresa
 * informou — nunca com os dados da outra.
 */
async function garantirPerfil(client, userId, empresaId, sementes = {}) {
  if (!userId || !empresaId) return null;
  const existente = await obterPerfil(userId, empresaId, client);
  if (existente) return existente;
  return salvarPerfil(client, userId, empresaId, sementes);
}

module.exports = {
  CAMPOS_PERFIL,
  mesclar,
  buscarPerfis,
  obterPerfil,
  aplicarPerfil,
  aplicarPerfilEmLista,
  aplicarPerfilEmRelacao,
  salvarPerfil,
  garantirPerfil,
};
