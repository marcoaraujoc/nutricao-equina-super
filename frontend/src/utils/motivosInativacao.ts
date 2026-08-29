// src/utils/motivosInativacao.ts
//
// Motivos padronizados de inativação, para o seletor do `ModalJustificativa`.
//
// POR QUE PADRONIZAR: o motivo vai para `Animal.desativadoMotivo` e para a Auditoria,
// e é exibido na coluna "Justificativa" da aba Inativos. Em texto livre, o mesmo fato
// vira "troca de vet", "mudou de veterinário", "TROCA VET" e "saiu" — impossível de
// agrupar depois, e é justamente esse agrupamento que responde "por que perdemos
// pacientes?".
//
// ⚠️ A lista é COMPARTILHADA entre as telas que inativam o mesmo registro. Hoje o
// paciente é inativado em DOIS lugares (`AnimaisVet` e `MeusAnimais`, ambos chamando
// `DELETE /animais/:id`); duas listas diferentes gravariam formatos diferentes na
// MESMA coluna, que é o problema que a padronização veio resolver.

import type { MotivoOpcao } from '../components/ModalJustificativa';

/**
 * Inativação de PACIENTE.
 *
 * "Outro" é o único que exige descrição: sem ela o registro diria apenas "Outro", que
 * não informa nada — pior do que o texto livre que havia antes. Nos demais o rótulo já
 * é a informação, e a descrição fica opcional para o detalhe ("foi para o Haras X").
 */
export const MOTIVOS_INATIVACAO_ANIMAL: MotivoOpcao[] = [
  { valor: 'Troca de Veterinário' },
  { valor: 'Troca de Local' },
  { valor: 'Aposentadoria' },
  { valor: 'Falecimento' },
  { valor: 'Outro', exigeDescricao: true },
];

/**
 * Texto a EXIBIR para uma inativação — compõe categoria + descrição.
 *
 * Elas ficam separadas no banco (a categoria é indexada, para o relatório agrupar),
 * mas na tela quem lê quer a frase inteira.
 *
 * ⚠️ Trata os DOIS formatos, e é por isso que existe em vez de um `join` solto:
 *   · linha NOVA   → tipo + descrição ("Falecimento — no pasto", ou só "Falecimento");
 *   · linha LEGADA → tipo nulo e o texto livre inteiro na descrição.
 * Sem isso, a aba Inativos mostraria em branco tudo o que foi inativado antes da
 * migration `20260919000000`.
 */
export function justificativaDe(
  registro: { desativadoMotivoTipo?: string | null; desativadoMotivo?: string | null } | null | undefined,
): string {
  const tipo = registro?.desativadoMotivoTipo?.trim();
  const desc = registro?.desativadoMotivo?.trim();
  return [tipo, desc].filter(Boolean).join(' — ');
}
