// backend/src/lib/donoAtivoDoPaciente.js
'use strict';

/**
 * INVARIANTE: PACIENTE ATIVO ⇒ DONO ATIVO NESTA CLÍNICA.
 *
 * POR QUE EXISTE: reativar um paciente cujo dono está inativo produz um cadastro que
 * NASCE INVISÍVEL — a regra de visibilidade (`lib/visibilidade.js`) esconde o animal
 * de quem não é cliente ativo da empresa. A pessoa reativa, recebe "reativado com
 * sucesso" e o paciente não aparece em lugar nenhum. Já foi o sintoma "Horse1" no
 * cadastro (`AnimalController.criar`), e voltava por este outro caminho.
 *
 * A REATIVAÇÃO DO DONO ACOMPANHA A DO PACIENTE, com o MESMO motivo e na MESMA
 * transaction: ou os dois voltam, ou nenhum volta. E o ato do cliente é auditado à
 * parte — quem olhar a trilha do cadastro dele precisa achar lá o porquê, não só na
 * trilha do animal.
 *
 * ⚠️ REATIVA O CADASTRO DE CLIENTE DA EMPRESA (`ProprietarioPerfil`), NUNCA o
 * `users.ativo`. O `ativo` do `users` é o LOGIN, é global, e cai quando a pessoa é
 * inativada como PROFISSIONAL em QUALQUER clínica (`toggleMembro` mexe nele). Ligá-lo
 * daqui desfaria, sem ninguém pedir, a decisão que OUTRA clínica tomou sobre o acesso
 * dela ao sistema — exatamente o vazamento entre empresas que a regra de visibilidade
 * corrigiu em 2026-09-06. Quem precisa do login de volta pede a quem o desligou.
 * Por isso o retorno traz `loginGlobalInativo`: a tela AVISA em vez de fingir que
 * resolveu tudo.
 *
 * ⚠️ NÃO toca `UsuarioEmpresa`: aquela tabela guarda o vínculo de qualquer papel — o
 * profissional inclusive — e mexer nela reativaria o cargo de quem também trabalha na
 * clínica. Aqui só se decide sobre o cadastro de CLIENTE.
 */

const perfilProp = require('./proprietarioPerfil');
const { registrarAuditoria } = require('./auditoria');

/**
 * Garante que o dono do paciente esteja ativo na empresa dele.
 *
 * @param {object} tx        transaction (obrigatória — anda junto com a reativação do animal)
 * @param {object} req       para a auditoria (quem fez, de qual empresa)
 * @param {object} opts
 * @param {object} opts.animal  { id, nome, userId, empresaId }
 * @param {string} opts.motivo  o MESMO motivo informado para o paciente
 * @returns {Promise<{reativou: boolean, nome: string|null, loginGlobalInativo: boolean}>}
 */
async function garantirDonoAtivo(tx, req, { animal, motivo }) {
  const vazio = { reativou: false, nome: null, loginGlobalInativo: false };
  if (!animal?.userId || !animal?.empresaId) return vazio;

  const dono = await tx.user.findUnique({
    where:  { id: Number(animal.userId) },
    select: { id: true, fullName: true, ativo: true },
  });
  if (!dono) return vazio;

  const perfil = await tx.proprietarioPerfil.findUnique({
    where:  { userId_empresaId: { userId: Number(animal.userId), empresaId: Number(animal.empresaId) } },
    select: { id: true, ativo: true, fullName: true },
  }).catch(() => null);

  // Nome DA EMPRESA (§36) — é o que a clínica reconhece; `users.fullName` é a reserva.
  const nome = perfil?.fullName ?? dono.fullName ?? null;
  const loginGlobalInativo = dono.ativo === false;

  // Sem cadastro aqui (cliente legado) ou já ativo: nada a fazer.
  if (!perfil || perfil.ativo !== false) {
    return { reativou: false, nome, loginGlobalInativo };
  }

  await perfilProp.salvarPerfil(tx, animal.userId, animal.empresaId, { ativo: true });

  await registrarAuditoria(tx, req, {
    categoria:  'ATIVACAO',
    entidade:   'PROPRIETARIO',
    entidadeId: Number(animal.userId),
    animalId:   animal.id ?? null,
    motivo,
    // O texto diz o que causou a reativação: quem abrir a trilha do cliente precisa
    // entender por que ele voltou sem ninguém ter mexido no cadastro dele.
    detalhes: `Cliente reativado junto com o paciente ${animal.nome ?? ''} — ${nome ?? ''}`.trim(),
  });

  return { reativou: true, nome, loginGlobalInativo };
}

module.exports = { garantirDonoAtivo };
