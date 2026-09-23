// frontend/src/utils/formasRecebimentoFatura.ts
//
// COMO O CLIENTE QUER RECEBER A FATURA — e-mail, WhatsApp e/ou impresso.
// FONTE ÚNICA da lista, dos rótulos e da pergunta "este canal está liberado?".
//
// Escolhido no cadastro do cliente (ProprietarioFormModal) e OBEDECIDO na tela de
// Faturamento, tanto no painel de uma fatura quanto no fechamento em lote. Duas
// cópias da lista divergiriam, e o que divergiria é qual botão o financeiro vê.
//
// ⚠️ A preferência é POR EMPRESA (mora em `tb_proprietario_perfis`, o cadastro do
// cliente naquela clínica) — quem pede impresso aqui pode querer WhatsApp na outra.
// Quem entrega isso pronto é o backend; o front só consome o que veio na lista.
//
// ⚠️ Exportar CSV NÃO é uma forma de recebimento: baixa um arquivo para a clínica,
// não entrega nada ao cliente. É a mesma distinção que a §6 do CLAUDE.md faz ao dar
// cor própria ao "exportar", e é por isso que aquele botão nunca é bloqueado aqui.

export type FormaRecebimentoFatura = 'EMAIL' | 'WHATSAPP' | 'IMPRESSO';

export const FORMAS_RECEBIMENTO_FATURA: {
  valor: FormaRecebimentoFatura; rotulo: string; ajuda: string;
}[] = [
  { valor: 'EMAIL',    rotulo: 'E-mail',   ajuda: 'A fatura em PDF chega no e-mail do cliente.' },
  { valor: 'WHATSAPP', rotulo: 'WhatsApp', ajuda: 'A fatura em PDF é enviada pelo WhatsApp.' },
  { valor: 'IMPRESSO', rotulo: 'Impresso', ajuda: 'A fatura é impressa e entregue em mãos.' },
];

export const TODAS_FORMAS_RECEBIMENTO: FormaRecebimentoFatura[] =
  FORMAS_RECEBIMENTO_FATURA.map(f => f.valor);

/**
 * O canal está liberado para este cliente?
 *
 * ⚠️ `undefined` (cliente legado, ou resposta de uma rota que ainda não devolve o
 * campo) e lista VAZIA respondem SIM. Bloquear no desconhecido apagaria os botões de
 * envio de toda a base — e um botão que some sem explicação é lido como perda de
 * permissão, não como preferência do cliente.
 */
export function formaLiberada(
  formas: FormaRecebimentoFatura[] | undefined | null,
  forma: FormaRecebimentoFatura,
): boolean {
  if (!formas || formas.length === 0) return true;
  return formas.includes(forma);
}

/**
 * Texto do tooltip quando o canal está bloqueado — diz O QUE fazer, não só que não
 * dá. Sem isto, o financeiro encara um botão cinza sem saber que a decisão é do
 * cadastro do cliente e que ele mesmo pode mudá-la.
 */
export function motivoFormaBloqueada(forma: FormaRecebimentoFatura): string {
  const rotulo = FORMAS_RECEBIMENTO_FATURA.find(f => f.valor === forma)?.rotulo ?? forma;
  return `O cliente não escolheu receber a fatura por ${rotulo}. `
    + 'Para liberar, altere as formas de recebimento no cadastro do proprietário.';
}

/** "E-mail e WhatsApp" / "E-mail, WhatsApp e Impresso" — para resumo em uma linha. */
export function resumoFormas(formas: FormaRecebimentoFatura[] | undefined | null): string {
  const lista = (formas && formas.length > 0 ? formas : TODAS_FORMAS_RECEBIMENTO)
    .map(v => FORMAS_RECEBIMENTO_FATURA.find(f => f.valor === v)?.rotulo ?? v);
  if (lista.length === 1) return lista[0];
  return `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
}
