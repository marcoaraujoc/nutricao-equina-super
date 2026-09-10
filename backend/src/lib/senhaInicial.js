// backend/src/lib/senhaInicial.js
//
// SENHA INICIAL de conta nova (regra de 2026-09-08). Composição pedida:
//
//   1. as 3 primeiras letras do E-MAIL, a primeira maiúscula;
//   2. os 2 últimos dígitos do TELEFONE;
//   3. as 3 primeiras letras do NOME — tendo só 2, acrescenta-se uma consoante;
//   4. 1 caractere especial.
//
// 🔴 ELA NUNCA É MOSTRADA. Antes o valor era a constante `Inicial_001`, devolvida ao
// front e impressa na tela de quem cadastrava ("A senha padrão é Inicial_001"). Duas
// coisas erradas ali: a senha aparecia para um TERCEIRO (quem cadastra não é o dono da
// conta), e sendo a MESMA para todo mundo, qualquer pessoa que tivesse lido a tela uma
// vez sabia a senha de toda conta nova do sistema — inclusive as que ainda nem
// existiam. Agora ela é derivada por conta e sai SÓ pelo e-mail de boas-vindas.
//
// ⚠️ O que NÃO mudou: `mustChangePassword` continua true, a troca no primeiro acesso
// continua obrigatória, e nenhum outro passo do fluxo foi alterado.
'use strict';

/** Sem acento e sem o que não for letra — a senha não deve depender de teclado. */
function letras(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
}

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Consoante de recheio para o nome curto ("Bo" → "Bok"). Fixa e não aleatória: a senha
// precisa ser REPRODUZÍVEL a partir do cadastro — é ela que o e-mail de boas-vindas
// informa, e um sorteio faria a mensagem divergir do que foi gravado se o e-mail
// tivesse de ser reenviado.
const CONSOANTE_RECHEIO = 'k';
const ESPECIAL = '@';

// Complementos usados quando o cadastro não tem o material da regra. Preferir isto a
// gerar senha CURTA: o que falta é dado do cliente, e a senha não pode encolher por
// causa disso.
const RECHEIO_LETRA  = 'x';
const RECHEIO_DIGITO = '0';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '');

/**
 * Monta a senha inicial da conta.
 *
 * ⚠️ Determinística de propósito (mesmo cadastro → mesma senha): é o que permite
 * reenviar o e-mail de boas-vindas sem redefinir a senha de quem ainda não entrou.
 * A proteção não vem de ela ser imprevisível — vem de ela ser de USO ÚNICO
 * (`mustChangePassword`) e de nunca aparecer em tela.
 *
 * @returns {string} ex.: "Mar45Sil@"
 */
function gerarSenhaInicial({ email, telefone, nome } = {}) {
  const doEmail = letras(String(email ?? '').split('@')[0]).slice(0, 3);
  const doNome  = letras(nome).slice(0, 3);
  const tel     = digitos(telefone);

  // 1) 3 letras do e-mail, primeira maiúscula.
  const parte1 = cap((doEmail + RECHEIO_LETRA.repeat(3)).slice(0, 3));

  // 2) 2 últimos dígitos do telefone.
  const parte2 = tel.length >= 2 ? tel.slice(-2) : (tel + RECHEIO_DIGITO.repeat(2)).slice(0, 2);

  // 3) 3 letras do nome. Com só 2, entra a consoante — que é a regra pedida; com
  //    menos que isso, o recheio completa (nome de uma letra existe em cadastro real).
  let parte3 = doNome;
  if (parte3.length === 2) parte3 += CONSOANTE_RECHEIO;
  if (parte3.length < 3)   parte3 = (parte3 + RECHEIO_LETRA.repeat(3)).slice(0, 3);
  parte3 = cap(parte3);

  return `${parte1}${parte2}${parte3}${ESPECIAL}`;
}

module.exports = { gerarSenhaInicial, CONSOANTE_RECHEIO, ESPECIAL };
