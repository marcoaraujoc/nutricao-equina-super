// frontend/src/components/produtos/tiposProduto.ts
//
// Tipos compartilhados entre a tela de Produtos e os componentes dela.
// Ficam num arquivo próprio para o formulário e a lista não importarem a PÁGINA (o
// que criaria um ciclo de imports).
//
// 🔴 O QUE MUDOU EM 2026-09-15: a tela deixou de cadastrar o VÍNCULO com o fornecedor
// (de quem se compra, por quanto, com entrada no estoque) e passou a cadastrar o ITEM
// — medicamento e vacina com forma, apresentação, unidade, via, controlado e doses por
// embalagem. Fornecedor, nota fiscal, preços, leitura do documento de compra e a
// entrada no estoque saíram a pedido: quem trata de compra e de saldo é a Farmácia /
// o Estoque de Vacinas.

/** Uma linha da lista / o item do catálogo visível da clínica. */
export interface ItemCatalogo {
  id:                number;
  nome:              string;
  formaFarmaceutica: string;
  unidade:           string;
  apresentacao:      string;
  classificacao?:    string | null;
  fabricante?:       string | null;
  controlado:        boolean;
  ativo:             boolean;
  empresaId:         number | null;
  /** `false` = item do catálogo GLOBAL. Alterá-lo cria a cópia DESTA clínica. */
  daEmpresa:         boolean;
  ehVacina:          boolean;
  vias:              { id: number; via: string }[];
  /** A embalagem tem conteúdo medido — governa a baixa do estoque e a cobrança. */
  multidose:         boolean;
  /**
   * QUANTO a embalagem contém, na `formaCalculo` (frasco de 20 mL → 20).
   * ⚠️ O nome vem da coluna legada `doses_por_embalagem`, que até 2026-09-16
   * significava "N aplicações por frasco". Hoje é o CONTEÚDO — ver
   * `backend/src/lib/formaCalculo.js`. `null` = não informado (≠ 1).
   */
  dosesPorEmbalagem: number | null;
  /** EM QUÊ a embalagem é medida: mL, L, g, kg, mcg, mg ou doses. `null` = não é multidose. */
  formaCalculo:      string | null;
}

/**
 * O formulário.
 *
 * ⚠️ `dosesPorEmbalagem` é STRING: é campo de digitação e o vazio precisa ser
 * distinguível de zero — em branco significa "não informei", e o item continua sendo
 * cobrado pela embalagem inteira. A conversão acontece na borda, ao salvar.
 */
export interface FormProdutoDados {
  /** Item que está sendo EDITADO. `null` = produto novo. */
  medicamentoId:     number | null;
  nome:              string;
  formaFarmaceutica: string;
  unidade:           string;
  apresentacao:      string;
  vias:              string[];
  controlado:        boolean;
  fabricante:        string;
  /** "Produto multidose" — é ele que abre Forma de Cálculo + Qtd. */
  multidose:         boolean;
  /** Qtd por embalagem, como TEXTO: o vazio precisa ser distinguível de zero. */
  dosesPorEmbalagem: string;
  /** Forma de Cálculo escolhida — vazio enquanto multidose está desmarcado. */
  formaCalculo:      string;
  /** Item de origem GLOBAL — salvar cria a cópia desta clínica. */
  daEmpresa:         boolean;
}

export const FORM_PRODUTO_VAZIO: FormProdutoDados = {
  medicamentoId: null, nome: '', formaFarmaceutica: '', unidade: '', apresentacao: '',
  vias: [], controlado: false, fabricante: '',
  multidose: false, dosesPorEmbalagem: '', formaCalculo: '', daEmpresa: true,
};

/** Item do backend → formulário. */
export function formDoItem(item: ItemCatalogo): FormProdutoDados {
  return {
    medicamentoId:     item.id,
    nome:              item.nome ?? '',
    formaFarmaceutica: item.formaFarmaceutica ?? '',
    unidade:           item.unidade ?? '',
    apresentacao:      item.apresentacao ?? '',
    vias:              (item.vias ?? []).map(v => v.via),
    controlado:        !!item.controlado,
    fabricante:        item.fabricante ?? '',
    multidose:         !!item.multidose,
    dosesPorEmbalagem: item.dosesPorEmbalagem != null ? String(item.dosesPorEmbalagem).replace('.', ',') : '',
    formaCalculo:      item.formaCalculo ?? '',
    daEmpresa:         !!item.daEmpresa,
  };
}

/**
 * "Dipirona 500 " → "dipirona 500" — espelho do `normalizarNome` do backend
 * (`ProdutoController`). Os dois lados precisam concordar: é essa comparação que
 * decide se o nome digitado é O MESMO do cadastro que voltou, e uma divergência faria
 * a tela avisar "já existe" sobre um item de outro nome (ou não avisar sobre o certo).
 */
export function normalizarNomeProduto(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/** O formulário está vazio fora o nome? Decide se a carga automática pode sobrescrever. */
export function formSoTemNome(f: FormProdutoDados): boolean {
  return !f.formaFarmaceutica && !f.apresentacao && !f.unidade
    && f.vias.length === 0 && !f.fabricante.trim() && !f.dosesPorEmbalagem
    && !f.formaCalculo && !f.multidose && !f.controlado;
}
