// backend/src/lib/destinatariosEnvio.js
//
// PARA QUEM o documento clínico pode ser enviado (2026-10-09) — Evolução, Prescrição,
// Exames e Encaminhamento ganharam a escolha do destinatário no WhatsApp e no e-mail:
// proprietário, equipe veterinária inteira, um veterinário da equipe ou um prestador.
//
// ⚠️ CONTATO SEMPRE DO CADASTRO DESTA EMPRESA (§36 / §36-f): telefone e e-mail do
// proprietário saem do `ProprietarioPerfil`, os do veterinário do vínculo
// `tb_usuario_empresa`. Ler do `users` mandaria o documento para o número que OUTRA
// clínica cadastrou.
// ⚠️ A empresa é SEMPRE a do contexto (`req.empresaId`), nunca do cliente — e as
// consultas passam pelo carimbo de tenant (RLS).
// ⚠️ Prestador é o CADASTRO de prestador da empresa (com ou sem login), que é quem
// recebe encaminhamento (ver hist-atendimento, 2026-09-23 parte 3).
'use strict';

const prisma = require('./prisma').default;
const { aplicarPerfil } = require('./proprietarioPerfil');
const { aplicarVinculoEmLista } = require('./usuarioEmpresa');

/** Cargos que contam como "equipe veterinária". GESTOR é veterinário (userType VET). */
const CARGOS_VETERINARIOS = ['VETERINARIO', 'GESTOR'];

const limpo = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

async function proprietarioDoAnimal(animalId, empresaId) {
  const animal = await prisma.animal.findUnique({
    where:  { id: Number(animalId) },
    select: { user: { select: { id: true, fullName: true, phone: true, email: true, ativo: true } } },
  });
  if (!animal?.user) return null;
  const u = await aplicarPerfil(animal.user, empresaId);
  return { id: u.id, nome: u.fullName ?? 'Proprietário', telefone: limpo(u.phone), email: limpo(u.email) };
}

async function veterinariosDaEquipe(empresaId, equipeId) {
  const membros = await prisma.membroEquipe.findMany({
    where: {
      equipe: { empresaId: Number(empresaId), ...(equipeId ? { id: Number(equipeId) } : {}) },
      OR: [{ cargo: { in: CARGOS_VETERINARIOS } }, { cargos: { hasSome: CARGOS_VETERINARIOS } }],
      user: { ativo: true },
    },
    select: { user: { select: { id: true, fullName: true, phone: true, email: true, ativo: true } } },
  });
  // Um profissional pode estar em mais de uma equipe da mesma empresa: aparece uma vez.
  const unicos = [...new Map(membros.map(m => [m.user.id, m.user])).values()];
  const comVinculo = await aplicarVinculoEmLista(unicos, empresaId);
  return comVinculo
    .filter(u => u.ativo !== false)
    .map(u => ({ id: u.id, nome: u.fullName ?? 'Veterinário', telefone: limpo(u.phone), email: limpo(u.email) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function prestadoresDaEmpresa(empresaId) {
  const lista = await prisma.prestador.findMany({
    where:   { empresaId: Number(empresaId), ativo: true },
    select:  { id: true, nome: true, telefone: true, email: true },
    orderBy: { nome: 'asc' },
  });
  return lista.map(p => ({ id: p.id, nome: p.nome, telefone: limpo(p.telefone), email: limpo(p.email) }));
}

/**
 * { proprietario, veterinarios[], prestadores[] } — cada um com `nome`, `telefone` e
 * `email` (null quando o cadastro não tem). Quem decide se o canal está disponível
 * para aquela pessoa é a TELA, com o motivo à mostra.
 */
async function destinatariosDoEnvio({ empresaId, equipeId = null, animalId = null }) {
  const [proprietario, veterinarios, prestadores] = await Promise.all([
    animalId ? proprietarioDoAnimal(animalId, empresaId) : Promise.resolve(null),
    veterinariosDaEquipe(empresaId, equipeId),
    prestadoresDaEmpresa(empresaId),
  ]);
  return { proprietario, veterinarios, prestadores };
}

module.exports = { destinatariosDoEnvio, CARGOS_VETERINARIOS };
