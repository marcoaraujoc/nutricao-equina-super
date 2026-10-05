// frontend/src/utils/faturaQuantidade.ts
//
// Quantidade de uma linha da fatura, com a UNIDADE em que ela está contada
// (2026-10-02, a pedido). FONTE ÚNICA da tela (Faturamento) e dos documentos
// (FaturaExport — impressão, PDF e CSV): as duas escritas divergiriam na primeira
// correção.
//
// 🔴 `unidade` só vem preenchida na linha do medicamento MULTIDOSE em mL — ali a
// quantidade é o que saiu do frasco ("15 mL") e o unitário é o R$/mL. `null` é o de
// sempre: doses, embalagens ou unidades, exibidas como número puro.
// ⚠️ Em mL a quantidade pode ser fracionária (0,5 mL): por isso o formato pt-BR com até
// 2 casas, e não o número cru ("0.5").

export function formatarQtdItem(quantidade: number, unidade?: string | null): string {
  const n = Number(quantidade) || 0;
  const num = n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return unidade ? `${num} ${unidade}` : num;
}

/** A linha conta em unidade de CONTEÚDO (mL) — aceita fração na edição. */
export function qtdFracionaria(unidade?: string | null): boolean {
  return Boolean(unidade);
}
