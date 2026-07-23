// backend/src/lib/proprietarioPerfil.js
'use strict';

/**
 * Perfil do PROPRIETÁRIO por EMPRESA — fonte única de leitura/escrita do cadastro
 * do cliente dentro de uma clínica.
 *
 * POR QUE EXISTE
 * `User.email` é único global: o mesmo cliente atendido por duas clínicas é UMA
 * linha em `users`. Sem isto, editar o telefone do cliente na empresa A mudava o
 * cadastro da empresa B. O `User` ficou sendo só a IDENTIDADE (e-mail, senha,
 * ativo global) e os dados cadastrais passaram para `tb_proprietario_perfis`,
 * um registro por empresa.
 *
 * REGRA DE MERGE
 * Havendo perfil para a empresa do contexto, ele é a AUTORIDADE de todos os seus
 * campos — `null` no perfil significa "vazio nesta empresa" e NÃO cai de volta no
 * User. Sem perfil (dado legado ou ADMIN global sem contexto), lê-se o User.
 * `ativo` é a conjunção: inativo global (ADMIN) OU inativo na empresa → inativo.
 */

const prisma = require('./prisma').default;

// Campos que pertencem à empresa (o resto — email, senha, userType — é do User)
const CAMPOS_PERFIL = [
  'fullName', 'phone', 'phone2', 'cpf', 'cnpj',
  'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'estado',
  'mensalista', 'valorAssistencia', 'frequenciaVisitas', 'diaVencimentoFatura',
];

const SELECT_PERFIL = {
  id: true, userId: true, empresaId: true, ativo: true,
  ...Object.fromEntries(CAMPOS_PERFIL.map(c => [c, true])),
};

/** Aplica o perfil sobre o objeto do User (não muta o original). */
function mesclar(user, perfil) {
  if (!user) return user;
  if (!perfil) return user;
  const out = { ...user };
  for (const campo of CAMPOS_PERFIL) {
    if (campo in user) out[campo] = perfil[campo];
  }
  if ('ativo' in user) out.ativo = user.ativo !== false && perfil.ativo !== false;
  return out;
}

/** Perfis de vários proprietários numa empresa → Map(userId → perfil). */
async function buscarPerfis(userIds, empresaId, client = prisma) {
  if (!empresaId || userIds.length === 0) return new Map();
  const perfis = await client.proprietarioPerfil.findMany({
    where:  { empresaId: Number(empresaId), userId: { in: userIds.map(Number) } },
    select: SELECT_PERFIL,
  });
  return new Map(perfis.map(p => [p.userId, p]));
}

/** Aplica o perfil da empresa a UM proprietário já carregado. */
async function aplicarPerfil(user, empresaId, client = prisma) {
  if (!user || !empresaId) return user;
  const perfil = await client.proprietarioPerfil.findUnique({
    where:  { userId_empresaId: { userId: user.id, empresaId: Number(empresaId) } },
    select: SELECT_PERFIL,
  });
  return mesclar(user, perfil);
}

/** Aplica os perfis da empresa a uma LISTA de proprietários (1 query). */
async function aplicarPerfilEmLista(users, empresaId, client = prisma) {
  if (!empresaId || users.length === 0) return users;
  const mapa = await buscarPerfis(users.map(u => u.id), empresaId, client);
  return users.map(u => mesclar(u, mapa.get(u.id)));
}

/**
 * Aplica o perfil ao proprietário aninhado em registros (ex.: `animal.user`,
 * `fatura.proprietario`). `caminho` é o nome da propriedade que contém o User.
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
 * Cria/atualiza o perfil do proprietário NA EMPRESA informada.
 * Aceita `tx` para rodar dentro de transação. Campos ausentes em `dados` não são
 * tocados no update (permite salvamentos parciais vindos de telas diferentes).
 */
async function salvarPerfil(client, userId, empresaId, dados = {}) {
  if (!empresaId) return null;
  const data = {};
  for (const campo of CAMPOS_PERFIL) {
    if (dados[campo] !== undefined) data[campo] = dados[campo];
  }
  if (dados.ativo !== undefined) data.ativo = Boolean(dados.ativo);

  return client.proprietarioPerfil.upsert({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    update: data,
    create: { userId: Number(userId), empresaId: Number(empresaId), ...data },
    select: SELECT_PERFIL,
  });
}

/**
 * Garante que o proprietário tenha perfil na empresa, semeando com os dados
 * informados (ou, na falta deles, com o que estiver no User). Usado quando um
 * cliente que já existe no sistema é cadastrado por OUTRA clínica: ela começa
 * com o próprio cadastro em vez de herdar o da clínica anterior.
 */
async function garantirPerfil(client, userId, empresaId, sementes = {}) {
  if (!empresaId) return null;
  const existente = await client.proprietarioPerfil.findUnique({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    select: { id: true },
  });
  if (existente) return existente;
  return salvarPerfil(client, userId, empresaId, sementes);
}

module.exports = {
  CAMPOS_PERFIL,
  SELECT_PERFIL,
  mesclar,
  buscarPerfis,
  aplicarPerfil,
  aplicarPerfilEmLista,
  aplicarPerfilEmRelacao,
  salvarPerfil,
  garantirPerfil,
};
