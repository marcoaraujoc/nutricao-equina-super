// backend/src/lib/usuarioEmpresa.js
//
// PONTO ÚNICO de leitura/escrita do vínculo usuário × empresa (tb_usuario_empresa).
//
// Regra do modelo (2026-07-30): `users` guarda só a IDENTIDADE (e-mail, senha,
// refresh token, 2FA, role de plataforma, ativo global). O PERFIL do usuário na
// empresa e TODO o cadastro dele ali (nome, telefone, documento, endereço, CRMV,
// condição comercial de cliente) vivem nesta tabela, uma linha por (usuário, empresa).
//
// NUNCA leia nome/telefone/endereço/documento de um usuário direto do `users` numa
// tela de empresa — o `users` só tem o resíduo legado. Use `perfilDaEmpresa` /
// `aplicarVinculo` / `aplicarVinculoEmLista`, e para gravar use `salvarVinculo`.
'use strict';

const prisma = require('./prisma').default;

// Campos cadastrais que a empresa mantém sobre a pessoa. `null` aqui significa
// "vazio NESTA empresa" — nunca cai de volta no `users`.
const CAMPOS_CADASTRO = [
  'fullName', 'phone', 'phone2', 'cpf', 'cnpj',
  'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'estado',
  'crmv', 'mensalista', 'valorAssistencia', 'frequenciaVisitas', 'diaVencimentoFatura',
];

const PERFIS_PROFISSIONAIS = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'ENFERMEIRO', 'SECRETARIA', 'FINANCEIRO', 'FORNECEDOR', 'PRESTADOR'];
const ehPerfilProfissional = (p) => PERFIS_PROFISSIONAIS.includes(p);

/** Vínculo do usuário na empresa (null quando ele não pertence a ela). */
async function perfilDaEmpresa(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return null;
  return client.usuarioEmpresa.findUnique({
    where: { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
  });
}

/** Todas as empresas a que o usuário pertence, com o perfil de cada uma. */
async function empresasDoUsuario(userId, client = prisma) {
  return client.usuarioEmpresa.findMany({
    where:   { userId: Number(userId) },
    include: { empresa: { select: { id: true, nome: true, cnpj: true } } },
    orderBy: { empresaId: 'asc' },
  });
}

/**
 * Sobrepõe no objeto de usuário os dados cadastrais DESTA empresa.
 * Havendo vínculo, ele é AUTORIDADE de todos os seus campos (null = vazio aqui).
 * Sem vínculo (ADMIN de plataforma, usuário fora de empresa), devolve como veio.
 */
async function aplicarVinculo(user, empresaId, client = prisma) {
  if (!user || !empresaId) return user;
  const v = await perfilDaEmpresa(user.id, empresaId, client);
  if (!v) return user;
  const out = { ...user };
  for (const campo of CAMPOS_CADASTRO) if (campo in v) out[campo] = v[campo];
  out.perfilEmpresa = v.perfil;
  out.ativoNaEmpresa = v.ativo;
  out.ativo = (user.ativo !== false) && v.ativo;
  return out;
}

/** Versão em lote — uma query só para a lista inteira. */
async function aplicarVinculoEmLista(users, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(users) || users.length === 0) return users;
  const ids = [...new Set(users.map(u => u?.id).filter(Boolean))];
  if (ids.length === 0) return users;
  const vinculos = await client.usuarioEmpresa.findMany({
    where: { empresaId: Number(empresaId), userId: { in: ids } },
  });
  const porUser = new Map(vinculos.map(v => [v.userId, v]));
  return users.map(u => {
    const v = porUser.get(u?.id);
    if (!v) return u;
    const out = { ...u };
    for (const campo of CAMPOS_CADASTRO) if (campo in v) out[campo] = v[campo];
    out.perfilEmpresa   = v.perfil;
    out.ativoNaEmpresa  = v.ativo;
    out.ativo = (u.ativo !== false) && v.ativo;
    return out;
  });
}

/** Idem, quando o usuário está sob uma chave de relação (ex.: membro.user). */
async function aplicarVinculoEmRelacao(itens, chave, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(itens) || itens.length === 0) return itens;
  const users = itens.map(i => i?.[chave]).filter(Boolean);
  const aplicados = await aplicarVinculoEmLista(users, empresaId, client);
  let i = 0;
  return itens.map(item => (item?.[chave] ? { ...item, [chave]: aplicados[i++] } : item));
}

/**
 * Cria/atualiza o vínculo. Só grava os campos ENVIADOS (undefined não apaga o que
 * já está lá) — o caller manda `null` quando quer limpar de verdade.
 */
async function salvarVinculo(client, userId, empresaId, { perfil, ...dados } = {}) {
  if (!userId || !empresaId) return null;
  const limpo = {};
  for (const campo of CAMPOS_CADASTRO) if (dados[campo] !== undefined) limpo[campo] = dados[campo];
  if (dados.ativo !== undefined) limpo.ativo = dados.ativo;

  return client.usuarioEmpresa.upsert({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    create: { userId: Number(userId), empresaId: Number(empresaId), perfil: perfil ?? 'PROPRIETARIO', ...limpo },
    update: { ...(perfil ? { perfil } : {}), ...limpo },
  });
}

/** Troca só o perfil (ex.: gestor muda o cargo do membro). */
async function definirPerfil(client, userId, empresaId, perfil) {
  return salvarVinculo(client, userId, empresaId, { perfil });
}

/**
 * Garante o vínculo a partir de um MembroEquipe: resolve a EMPRESA pela equipe e
 * grava o perfil. TODO ponto que cria/altera `MembroEquipe` tem de chamar isto —
 * senão a pessoa fica na equipe sem linha em tb_usuario_empresa, o tipo dela naquela
 * empresa não é encontrado e a resolução cai no legado (foi o que aconteceu com o
 * GESTOR da própria empresa: `criarEmpresa` criava o membro e não o vínculo).
 */
async function vincularMembro(client, userId, equipeId, perfil) {
  if (!userId || !equipeId) return null;
  const equipe = await client.equipe.findUnique({
    where:  { id: Number(equipeId) },
    select: { empresaId: true },
  });
  if (!equipe?.empresaId) return null;
  return salvarVinculo(client, userId, equipe.empresaId, { perfil });
}

module.exports = {
  CAMPOS_CADASTRO,
  PERFIS_PROFISSIONAIS,
  ehPerfilProfissional,
  perfilDaEmpresa,
  empresasDoUsuario,
  aplicarVinculo,
  aplicarVinculoEmLista,
  aplicarVinculoEmRelacao,
  salvarVinculo,
  definirPerfil,
  vincularMembro,
};
