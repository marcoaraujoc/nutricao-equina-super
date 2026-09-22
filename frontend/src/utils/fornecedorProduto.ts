// frontend/src/utils/fornecedorProduto.ts
//
// QUEM É FORNECEDOR DE PRODUTO (medicamento ou vacina) — fonte ÚNICA do recorte que a
// Farmácia e o Estoque de Vacinas fazem na lista de fornecedores (2026-09-19).
//
// 🔴 O cadastro de Fornecedor guarda VÁRIOS tipos de serviço num CSV, e nem todo
// fornecedor cadastrado entrega produto: o mesmo cadastro comporta o prestador de
// serviço clínico. Sem o recorte, o seletor da entrada de estoque ofereceria o
// fisioterapeuta como origem de um frasco de vacina.
//
// ⚠️ Nasceu duplicado dentro de `Farmacia.tsx` e foi extraído quando o Estoque de
// Vacinas passou a ter o mesmo seletor: duas listas divergiriam na primeira correção,
// e o que divergiria é QUEM a clínica consegue escolher como credor da compra — ou
// seja, para quem a conta a pagar vai.

/** Tipos de serviço que caracterizam quem ENTREGA produto. */
export const TIPOS_FORNECEDOR_PRODUTO = new Set(['Farmácia', 'Laboratório', 'Loja']);

/** Basta UM tipo relevante no CSV para o fornecedor aparecer no seletor. */
export const fornecedorDeProduto = (tipoServico: string | null | undefined): boolean =>
  (tipoServico ?? '').split(',').some(t => TIPOS_FORNECEDOR_PRODUTO.has(t.trim()));

/** Valor sentinela do seletor: abre o cadastro de um fornecedor novo. */
export const NOVO_FORNECEDOR = -1;
