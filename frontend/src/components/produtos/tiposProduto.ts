// frontend/src/components/produtos/tiposProduto.ts
//
// Tipos compartilhados entre a tela de Produtos e os componentes dela.
// Ficam num arquivo próprio para o formulário e a lista não importarem a PÁGINA (o
// que criaria um ciclo de imports).

/** Item do catálogo (`tb_medicamentos`) — global ou próprio da empresa. */
export interface ItemCatalogo {
  id:                number;
  nome:              string;
  formaFarmaceutica: string;
  unidade:           string;
  empresaId:         number | null;
  apresentacao?:     string | null;
  classificacao?:    string | null;
  fabricante?:       string | null;
  controlado?:       boolean;
  ehVacina?:         boolean;
}

/** Fornecedor disponível para vincular ao produto. */
export interface FornecedorOpcao {
  id:          number;
  nome:        string;
  tipoServico: string | null;
}

/** Uma linha da lista de produtos cadastrados. */
export interface ProdutoCadastrado {
  id:              number;
  medicamentoId:   number;
  medicamentoNome: string;
  fornecedorId:    number;
  fornecedorNome:  string | null;
  valorUnitario:   number | null;
  valorVenda:      number | null;
  unidade:         string | null;
  unidadeCatalogo: string | null;
  notaFiscal:      string | null;
  observacao:      string | null;
  ativo:           boolean;
  ehVacina:        boolean;
  criadoEm:        string | null;
  /** O frasco rende mais de uma aplicação — governa a baixa e a cobrança POR DOSE. */
  multidose:        boolean;
  /** Quantas aplicações saem de uma embalagem. `null` = marcado e ainda não informado. */
  dosesPorEmbalagem: number | null;
}

/**
 * O formulário.
 *
 * ⚠️ Os valores são STRING, não number: são campos de digitação e o vazio precisa ser
 * distinguível de zero — `valorUnitario` em branco significa "não cadastrei o preço"
 * (e a conta a pagar não é lançada), enquanto 0 afirmaria que o fornecedor entrega de
 * graça. A conversão acontece na borda, ao salvar.
 */
export interface FormProdutoDados {
  nome:            string;
  medicamentoId:   number | null;
  unidade:         string;
  fornecedorId:    number | null;
  notaFiscal:      string;
  valorUnitario:   string;
  valorVenda:      string;
  entrarNoEstoque: boolean;
  quantidade:      string;
  lote:            string;
  validade:        string;
  estoqueMinimo:   string;
  /**
   * 🔴 MULTIDOSE — o frasco rende N aplicações.
   *
   * Não é cosmético: é ele que faz cada dose debitar `1/N` da embalagem e a linha da
   * fatura sair pelo preço do frasco ÷ N. Sem ele, o item contado em embalagens
   * ("Un.") debitava e cobrava o frasco INTEIRO a cada aplicação.
   */
  multidose:         boolean;
  dosesPorEmbalagem: string;
  /** Vínculo já existente (empresa+item+fornecedor) que o formulário está editando. */
  produtoId:         number | null;
}

export const FORM_PRODUTO_VAZIO: FormProdutoDados = {
  nome: '', medicamentoId: null, unidade: '', fornecedorId: null, notaFiscal: '',
  valorUnitario: '', valorVenda: '', entrarNoEstoque: false,
  quantidade: '', lote: '', validade: '', estoqueMinimo: '',
  multidose: false, dosesPorEmbalagem: '', produtoId: null,
};

/**
 * "1.234,56" ou "1234.56" → 1234.56. Vazio → null.
 *
 * ⚠️ `null` e 0 são coisas diferentes aqui, e é por isso que a função não devolve 0
 * no vazio: sem preço cadastrado a conta a pagar NÃO é lançada; com preço 0 ela seria
 * lançada afirmando que o item é de graça.
 */
export function paraNumero(v: string): number | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const bruto = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/** R$ para a tela. `null` vira "—": valor não informado não é zero. */
export const brlProduto = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
