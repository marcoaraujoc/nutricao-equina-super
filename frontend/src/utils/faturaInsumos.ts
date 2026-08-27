// frontend/src/utils/faturaInsumos.ts
// Insumo de aplicação (seringa/agulha) embaixo do medicamento que o consumiu.
//
// Via injetável (IM/IV/SC/…) lança 1 seringa + 1 agulha por dose aplicada, cada uma
// como linha própria da fatura — com o MESMO contador, o MESMO desconto e o MESMO
// cancelamento da dose: as três compartilham o item de prescrição de origem
// (`prescricaoItemId`), então cancelar a prescrição leva as três juntas e cada nova
// dose incrementa a quantidade das três.
//
// O que faltava era POSIÇÃO. Soltas na ordem de criação, não dava para saber de qual
// medicamento a agulha saiu — numa fatura com três injetáveis no mês, são seis linhas
// de insumo indistinguíveis. Ordenadas por aqui:
//
//   EV-002  Ivermectina — 10mL × 4/4h      Quant.: 2
//              Agulha — aplicação IM        Quant.: 2
//              Seringa — aplicação IM       Quant.: 2
//
// FONTE ÚNICA: a tela de Faturamento e a impressão/PDF usam esta função. Duas cópias
// divergiriam na primeira correção, e aí a fatura na tela e a que o cliente recebe
// mostrariam ordens diferentes.

/** O mínimo que uma linha de fatura precisa expor para ser agrupada. */
export interface LinhaAgrupavel {
  /** Item de prescrição que originou a linha — dose, seringa e agulha da MESMA
   *  aplicação compartilham este id. */
  prescricaoItemId?: number | null;
  /** Só no INSUMO: repete o `prescricaoItemId` do medicamento que o consumiu. */
  insumoDe?: number | null;
  descricao: string;
}

/**
 * Reordena a lista pondo cada insumo logo abaixo do seu medicamento.
 *
 * ⚠️ A ordem ENTRE os insumos é alfabética (Agulha antes de Seringa) só para ser
 * ESTÁVEL: sem isso ela seguiria o id de criação e mudaria de fatura para fatura.
 * ⚠️ Insumo cujo medicamento pai não está nesta lista (linha do pai removida à mão
 * pelo financeiro, ou item filtrado para outra seção) NÃO é descartado — fica onde
 * está, como linha normal. Sumir com uma cobrança seria pior do que exibi-la fora
 * do lugar.
 */
export function ordenarComInsumos<T extends LinhaAgrupavel>(itens: T[]): T[] {
  const insumosPorPai = new Map<number, T[]>();
  for (const i of itens) {
    if (i.insumoDe == null) continue;
    const lista = insumosPorPai.get(i.insumoDe) ?? [];
    lista.push(i);
    insumosPorPai.set(i.insumoDe, lista);
  }
  if (insumosPorPai.size === 0) return itens;

  const paisPresentes = new Set(
    itens.filter(i => i.insumoDe == null && i.prescricaoItemId != null)
         .map(i => i.prescricaoItemId as number),
  );

  const ordenado: T[] = [];
  for (const item of itens) {
    if (item.insumoDe != null && paisPresentes.has(item.insumoDe)) continue; // entra junto do pai
    ordenado.push(item);
    if (item.prescricaoItemId == null) continue;
    const filhos = insumosPorPai.get(item.prescricaoItemId);
    if (filhos) {
      ordenado.push(...[...filhos].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')));
    }
  }
  return ordenado;
}
