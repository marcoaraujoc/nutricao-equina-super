// backend/src/lib/motivosInativacao.js
//
// Lista FECHADA de motivos de inativação — a fonte de verdade do que pode entrar em
// `tb_animais.desativado_motivo_tipo`.
//
// POR QUE VALIDAR NO BACKEND, e não confiar no seletor da tela: a coluna existe para
// ser AGRUPADA num relatório. Um valor fora da lista (typo, tela desatualizada, chamada
// direta à API) não quebra nada na hora — só aparece meses depois como uma fatia órfã
// no gráfico, e aí ninguém sabe se é dado real ou lixo. Recusar na entrada é o que
// mantém o relatório confiável.
//
// ⚠️ ESPELHO NO FRONT: `frontend/src/utils/motivosInativacao.ts` monta o seletor com a
// MESMA lista. Divergir faz o backend recusar (400 `MOTIVO_TIPO_INVALIDO`) — de
// propósito: falha ALTA e imediata, no primeiro uso, em vez de gravar silenciosamente
// uma categoria que o relatório não conhece.
//
// ⚠️ ACRESCENTAR motivo é seguro (linha antiga continua válida). REMOVER ou RENOMEAR
// não é: as linhas já gravadas mantêm o texto antigo e sairiam do agrupamento. Para
// renomear, migre os dados junto.
'use strict';

/** Cabe em VARCHAR(40) — o maior aqui tem 20 caracteres ('Troca de Veterinário'). */
const MOTIVOS_INATIVACAO_ANIMAL = [
  'Troca de Veterinário',
  'Troca de Local',
  'Aposentadoria',
  'Falecimento',
  'Outro',
];

/** Só "Outro" exige descrição — sozinho ele não informa nada. */
const MOTIVOS_QUE_EXIGEM_DESCRICAO = new Set(['Outro']);

/**
 * Normaliza e valida o tipo recebido.
 *
 * @returns {{ tipo: string|null, erro: string|null }}
 *   `tipo: null` sem erro = não foi informado (legado, cascata do sistema, ou uma
 *   tela que ainda não manda o campo) — a inativação segue funcionando.
 */
function validarMotivoTipo(valor) {
  const t = String(valor ?? '').trim();
  if (!t) return { tipo: null, erro: null };
  const achado = MOTIVOS_INATIVACAO_ANIMAL.find(m => m.toLowerCase() === t.toLowerCase());
  if (!achado) {
    return { tipo: null, erro: `Motivo de inativação inválido: "${t}".` };
  }
  // Devolve o rótulo CANÔNICO (com a acentuação e a caixa da lista), não o que veio —
  // é isso que garante que o GROUP BY não separe "Falecimento" de "falecimento".
  return { tipo: achado, erro: null };
}

/** A descrição é obrigatória para este tipo? */
function exigeDescricao(tipo) {
  return MOTIVOS_QUE_EXIGEM_DESCRICAO.has(String(tipo ?? '').trim());
}

module.exports = {
  MOTIVOS_INATIVACAO_ANIMAL,
  MOTIVOS_QUE_EXIGEM_DESCRICAO,
  validarMotivoTipo,
  exigeDescricao,
};
