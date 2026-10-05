'use strict';

/**
 * Aviso ao PROFISSIONAL que vai executar um agendamento recém-criado (e-mail +
 * WhatsApp): paciente, atividade, data, hora e local.
 *
 * Fonte única de três perguntas que o `AgendamentoController.criar` faz:
 *   1. para QUEM vai o aviso, e por quais canais (`contatoDoResponsavel`);
 *   2. o que falta no cadastro dele (`avisosDeContato`) — volta na resposta do POST
 *      e a tela exibe por 3s; o agendamento NUNCA é recusado por isso;
 *   3. o que a mensagem diz (`localDoAnimal`, `descricaoAtividade`,
 *      `mensagemWhatsAppProfissional`).
 *
 * ⚠️ O TELEFONE é o da EMPRESA (`UsuarioEmpresa`, via `aplicarVinculo`), não o do
 * `users`: o cadastro do profissional é por clínica (§36-f) — ler o global mandaria o
 * WhatsApp para o número que outra clínica cadastrou. O E-MAIL é identidade e é global.
 * ⚠️ PRESTADOR: vale o CADASTRO (`tb_prestadores`); o login, se houver, só completa o
 * que o cadastro não tem — o prestador sem login não tem `users` nenhum.
 */

const { aplicarVinculo } = require('./usuarioEmpresa');

const TIPO_LABEL = {
  CONSULTA: 'Consulta', VACINA: 'Vacina', RETORNO: 'Retorno', EXAME: 'Exame', PROCEDIMENTO: 'Procedimento',
  VERMIFUGACAO: 'Vermifugação',
};

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const temTelefone = (v) => texto(v).replace(/\D/g, '').length > 0;

/**
 * { nome, email, phone } de quem executa o agendamento, ou `null` quando o
 * agendamento nasceu sem responsável (não há a quem avisar — e não é erro).
 */
async function contatoDoResponsavel(client, { veterinarioId, prestador, empresaId }) {
  const userId = prestador ? prestador.userId : veterinarioId;
  let user = null;
  if (userId) {
    user = await client.user.findUnique({
      where:  { id: Number(userId) },
      select: { id: true, email: true, fullName: true, phone: true },
    });
    if (user && empresaId) user = await aplicarVinculo(user, empresaId, client);
  }

  if (prestador) {
    return {
      nome:  texto(prestador.nome) || texto(user?.fullName) || 'Prestador',
      email: texto(prestador.email) || texto(user?.email) || null,
      phone: temTelefone(prestador.telefone) ? texto(prestador.telefone)
           : temTelefone(user?.phone)        ? texto(user.phone) : null,
    };
  }
  if (!user) return null;
  return {
    nome:  texto(user.fullName) || 'Profissional',
    email: texto(user.email) || null,
    phone: temTelefone(user.phone) ? texto(user.phone) : null,
  };
}

/** Mensagens para a tela quando faltar e-mail e/ou telefone. Lista vazia = tudo certo. */
function avisosDeContato(contato) {
  if (!contato) return [];
  const semEmail = !contato.email;
  const semFone  = !contato.phone;
  if (semEmail && semFone) {
    return [`${contato.nome} não tem e-mail nem telefone cadastrado — o agendamento foi salvo, mas o profissional não foi avisado.`];
  }
  if (semEmail) return [`${contato.nome} não tem e-mail cadastrado — o aviso do agendamento seguiu só por WhatsApp.`];
  if (semFone)  return [`${contato.nome} não tem telefone cadastrado — o aviso do agendamento seguiu só por e-mail.`];
  return [];
}

/** Onde o paciente está: localização do catálogo → texto legado, mais a baia. */
function localDoAnimal(animal) {
  if (!animal) return null;
  const lugar = texto(animal.localizacao?.nome) || texto(animal.local);
  const baia  = texto(animal.baia);
  if (lugar && baia) return `${lugar} · Baia ${baia}`;
  if (lugar) return lugar;
  return baia ? `Baia ${baia}` : null;
}

/**
 * "Consulta · Dermatologia". O título só entra quando diz algo além do padrão que
 * a Agenda grava ("Consulta - <paciente>"), que repetiria o tipo e o paciente.
 */
function descricaoAtividade({ tipo, titulo, especialidade, animalNome }) {
  const tipoLabel = TIPO_LABEL[tipo] ?? tipo ?? 'Atendimento';
  const t = texto(titulo);
  const tituloPadrao = `${tipoLabel} - ${animalNome ?? ''}`.trim().toLowerCase();
  const partes = [t && t.toLowerCase() !== tituloPadrao ? t : tipoLabel];
  if (texto(especialidade)) partes.push(texto(especialidade));
  return partes.join(' · ');
}

function mensagemWhatsAppProfissional({ animalNome, atividade, dataFmt, horaFmt, local, proprietarioNome, proprietarioPhone }) {
  return [
    `🐴 *S2Vet — Novo agendamento*`,
    `🐎 Paciente: *${animalNome}*`,
    `📋 Atividade: ${atividade}`,
    `📅 Data: ${dataFmt}`,
    `🕐 Hora: *${horaFmt}*`,
    `📍 Local: ${local ?? 'não informado'}`,
    proprietarioNome  ? `👤 Proprietário: ${proprietarioNome}` : '',
    proprietarioPhone ? `📱 Contato: ${proprietarioPhone}`     : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  TIPO_LABEL,
  contatoDoResponsavel,
  avisosDeContato,
  localDoAnimal,
  descricaoAtividade,
  mensagemWhatsAppProfissional,
};
