// frontend/src/utils/tomAcao.ts
//
// BOTÃO DE AÇÃO COM RÓTULO — a barra de ações do FINANCEIRO (2026-09-22).
//
// 🔴 FONTE ÚNICA das classes que `Faturamento.tsx` e `Pagamentos.tsx` usam. As duas
// telas são os dois lados do mesmo balcão (o que se COBRA e o que se PAGA), e uma
// segunda cópia destes tokens divergiria na primeira correção — deixando "Marcar como
// Pago" de uma cor de um lado e de outra no outro.
//
// ⚠️ NÃO substitui `components/AcaoRegistro.tsx`, que é a fonte única da ação de um
// REGISTRO DE LISTA (ícone no desktop, pílula no mobile). Aqui a ação é de um
// DOCUMENTO inteiro — fatura ou conta a pagar —, fica numa barra própria acima dele e
// sempre com rótulo visível, inclusive no desktop.
//
// ⚠️ Ao acrescentar ação nova, escolha o TOM pelo significado (§6) — nunca uma cor nova.

export const BTN_ACAO =
  'flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold transition-colors disabled:opacity-60';

export const TOM_ACAO = {
  /** alterar / reabrir — muda o estado do que já está fechado */
  alterar:   'border-orange-200  text-orange-600  hover:bg-orange-50',
  /** ver / finalizar / executar */
  ver:       'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  finalizar: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  /** saída de conteúdo: imprimir, exportar e e-mail dividem o azul */
  imprimir:  'border-blue-200    text-blue-600    hover:bg-blue-50',
  email:     'border-blue-200    text-blue-600    hover:bg-blue-50',
  /** WhatsApp usa a cor da própria marca */
  whatsapp:  'border-green-200   text-green-600   hover:bg-green-50',
  /** exportar tem tom PRÓPRIO (marrom): baixa arquivo, não põe o documento em
   *  circulação como o imprimir/e-mail azuis ao lado */
  exportar:  'border-amber-300   text-amber-800   hover:bg-amber-50',
  /** cancelar / excluir */
  cancelar:  'border-red-200     text-red-600     hover:bg-red-50',
} as const;
