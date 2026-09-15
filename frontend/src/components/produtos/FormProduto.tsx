// frontend/src/components/produtos/FormProduto.tsx
//
// O FORMULÁRIO da tela de Produtos (2026-09-10).
//
// 🔴 O QUE ELE REÚNE, e que antes exigia três telas: o item do CATÁLOGO (medicamento
// ou vacina), o FORNECEDOR de quem a clínica compra, e — só se ela marcar o checkbox —
// a ENTRADA NO ESTOQUE.
//
// 🔴 A DIFERENÇA QUE O CHECKBOX REGISTRA:
//   • desmarcado → PRODUTO: a clínica não guarda o item, pede quando prescreve.
//     Aparece verde na prescrição, com o nome do fornecedor.
//   • marcado    → produto E estoque: ela comprou daquele fornecedor E guardou o
//     frasco. Aí valem quantidade, lote e validade.
// Sem essa distinção, "cadastrar um produto" e "dar entrada" seriam a mesma coisa — e
// o item que a clínica só revende nunca teria como existir.
import { Package, Loader2, Plus, Truck, Layers, Pencil } from 'lucide-react';
import type { ItemCatalogo, FornecedorOpcao, FormProdutoDados } from './tiposProduto';

const inputCls =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 bg-white';
const rotuloCls = 'block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5';

/** Valor sentinela do seletor: abrir o cadastro de fornecedor. Mesmo padrão da Farmácia. */
export const NOVO_FORNECEDOR = -1;

interface Props {
  tipo: 'medicamento' | 'vacina';
  form: FormProdutoDados;
  onForm: (patch: Partial<FormProdutoDados>) => void;
  catalogo: ItemCatalogo[];
  buscandoCatalogo: boolean;
  fornecedores: FornecedorOpcao[];
  salvando: boolean;
  onSalvar: () => void;
  onCancelar: () => void;
  onNovoFornecedor: () => void;
  /** Escolher o item busca o que já está cadastrado dele — spinner enquanto isso. */
  carregandoItem?: boolean;
  /**
   * A base tem as colunas de multidose (migration 20261008000000)?
   *
   * ⚠️ Sem a bandeira o checkbox apareceria e a marcação DESAPARECERIA no salvar, em
   * silêncio — e o item voltaria a ser cobrado pelo frasco inteiro sem ninguém notar.
   */
  multidoseDisponivel?: boolean;
}

export default function FormProduto({
  tipo, form, onForm, catalogo, buscandoCatalogo, fornecedores,
  salvando, onSalvar, onCancelar, onNovoFornecedor,
  carregandoItem = false, multidoseDisponivel = true,
}: Props) {
  const ehVacina = tipo === 'vacina';
  const rotuloQtd = ehVacina ? 'Doses' : 'Quantidade';
  const editando  = form.produtoId != null;

  return (
    <div className="space-y-4">
      {/* Item que a clínica JÁ compra: os campos vieram do cadastro e seguem
          editáveis. Sem este aviso, a pessoa acharia que está criando um segundo
          registro — e salvar sobrescreveria o que ela nunca viu. */}
      {editando && (
        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Pencil size={12} className="flex-shrink-0" />
          Este produto já está cadastrado para o fornecedor escolhido — os campos abaixo
          foram carregados e podem ser alterados.
        </p>
      )}

      {/* ── 1. O ITEM ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className={rotuloCls}>{ehVacina ? 'Vacina' : 'Medicamento'} *</label>
          <input
            list="catalogo-produtos"
            value={form.nome}
            onChange={e => {
              const v = e.target.value;
              // Escolher da lista casa pelo NOME e reaproveita o item do catálogo;
              // digitar um nome que não existe deixa `medicamentoId` nulo, e aí o
              // backend CRIA o item próprio da empresa. É o mesmo "cadastrar na hora"
              // que a prescrição e a vacina já oferecem — sem passar por outra tela.
              const achado = catalogo.find(c => c.nome.toLowerCase() === v.trim().toLowerCase());
              onForm({
                nome: v,
                medicamentoId: achado?.id ?? null,
                unidade: form.unidade || achado?.unidade || '',
              });
            }}
            placeholder={ehVacina ? 'Nome da vacina…' : 'Nome do medicamento…'}
            className={inputCls}
          />
          <datalist id="catalogo-produtos">
            {catalogo.map(c => <option key={c.id} value={c.nome}>{c.formaFarmaceutica}</option>)}
          </datalist>
          <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
            {(buscandoCatalogo || carregandoItem) && <Loader2 size={10} className="animate-spin" />}
            {carregandoItem
              ? 'Carregando o que já está cadastrado deste item…'
              : form.medicamentoId
                ? 'Item do catálogo — será reaproveitado.'
                : form.nome.trim()
                  ? 'Item novo — será cadastrado como produto próprio desta clínica.'
                  : 'Digite para buscar no catálogo ou cadastrar um item novo.'}
          </p>
        </div>
        <div>
          <label className={rotuloCls}>Unidade</label>
          <input value={form.unidade} onChange={e => onForm({ unidade: e.target.value })}
            placeholder={ehVacina ? 'dose' : 'mL, g, un…'} className={inputCls} />
        </div>
      </div>

      {/* ── 2. O FORNECEDOR ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className={rotuloCls}>Fornecedor *</label>
          <select
            value={form.fornecedorId ?? ''}
            onChange={e => {
              const v = Number(e.target.value);
              // O sentinela abre o CADASTRO em vez de escolher: fornecedor exige nome
              // e documento, então criar por um campo de texto aqui produziria um
              // cadastro incompleto — mesma decisão do combo de prestador.
              if (v === NOVO_FORNECEDOR) { onNovoFornecedor(); return; }
              onForm({ fornecedorId: v || null });
            }}
            className={inputCls}
          >
            <option value="">Selecione o fornecedor…</option>
            {fornecedores.map(f => (
              <option key={f.id} value={f.id}>{f.nome}{f.tipoServico ? ` · ${f.tipoServico}` : ''}</option>
            ))}
            <option value={NOVO_FORNECEDOR}>+ Cadastrar novo fornecedor…</option>
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            É ele que aparece em verde na prescrição, para o vet saber de quem pedir.
          </p>
        </div>
        <div>
          <label className={rotuloCls}>Nota fiscal</label>
          <input value={form.notaFiscal} onChange={e => onForm({ notaFiscal: e.target.value })}
            placeholder="Nº da nota" className={inputCls} />
        </div>
      </div>

      {/* ── 3. OS PREÇOS ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={rotuloCls}>Valor de compra (R$)</label>
          <input type="text" inputMode="decimal" value={form.valorUnitario}
            onChange={e => onForm({ valorUnitario: e.target.value })}
            placeholder="0,00" className={inputCls} />
          {/* 🔴 É ESTE valor que vira a conta a pagar ao fornecedor na execução. Em
              branco, a conta NÃO é lançada — dívida de valor inventado é pior que
              dívida ausente, e é aqui que isso se resolve. */}
          <p className="text-[10px] text-amber-600 mt-1">
            Sem este valor, a conta a pagar do fornecedor não é lançada automaticamente.
          </p>
        </div>
        <div>
          <label className={rotuloCls}>Valor de venda (R$)</label>
          <input type="text" inputMode="decimal" value={form.valorVenda}
            onChange={e => onForm({ valorVenda: e.target.value })}
            placeholder="0,00" className={inputCls} />
          <p className="text-[10px] text-gray-400 mt-1">Opcional — sugestão do que cobrar do cliente.</p>
        </div>
      </div>

      {/* ── 4. MULTIDOSE ───────────────────────────────────────────────────── */}
      {multidoseDisponivel && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.multidose}
              onChange={e => onForm({
                multidose: e.target.checked,
                // Desmarcar limpa o número: deixá-lo faria o item voltar a ser
                // multidose na próxima gravação sem ninguém ter pedido.
                dosesPorEmbalagem: e.target.checked ? form.dosesPorEmbalagem : '',
              })}
              className="mt-0.5 w-4 h-4 accent-emerald-600" />
            <span>
              <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                <Layers size={14} className="text-emerald-600" /> Produto multidose
              </span>
              <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">
                Marque quando a embalagem rende mais de uma aplicação (um frasco para
                várias doses). Cada aplicação passa a descontar uma dose do frasco — e é
                por dose que ela entra na fatura, não pelo frasco inteiro.
              </span>
            </span>
          </label>

          {form.multidose && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={rotuloCls}>Doses por embalagem *</label>
                <input type="text" inputMode="numeric" value={form.dosesPorEmbalagem}
                  onChange={e => onForm({ dosesPorEmbalagem: e.target.value.replace(/\D/g, '') })}
                  placeholder="Ex.: 10" className={inputCls} />
              </div>
              <div className="sm:col-span-2 flex items-end">
                {/* Sem o número, a marcação é uma PENDÊNCIA e não muda cobrança
                    nenhuma — dizer isso aqui evita o cadastro pela metade que
                    silenciosamente volta a cobrar o frasco. */}
                <p className={`text-[11px] leading-snug ${form.dosesPorEmbalagem ? 'text-gray-500' : 'text-amber-600'}`}>
                  {form.dosesPorEmbalagem
                    ? `Cada aplicação desconta 1/${form.dosesPorEmbalagem} da embalagem e é cobrada por esse valor.`
                    : 'Informe quantas doses saem de uma embalagem — sem este número a cobrança continua pelo frasco inteiro.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. O ESTOQUE (opcional) ────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={form.entrarNoEstoque}
            onChange={e => onForm({ entrarNoEstoque: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-emerald-600" />
          <span>
            <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <Package size={14} className="text-emerald-600" /> Dar entrada no estoque
            </span>
            <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">
              Marque quando a clínica RECEBEU o produto. Sem marcar, ele fica cadastrado
              como item que se pede ao fornecedor quando for prescrito.
            </span>
          </span>
        </label>

        {form.entrarNoEstoque && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={rotuloCls}>{rotuloQtd} *</label>
              <input type="text" inputMode="decimal" value={form.quantidade}
                onChange={e => onForm({ quantidade: e.target.value })}
                placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={rotuloCls}>Lote</label>
              <input value={form.lote} onChange={e => onForm({ lote: e.target.value })}
                placeholder="Nº do lote" className={inputCls} />
            </div>
            <div>
              <label className={rotuloCls}>Validade</label>
              {/* ⚠️ `type="date"` cru exibe MM/DD/AAAA no locale en-US (§6). Aqui o
                  valor é ISO e vai direto ao backend, mas o rótulo do navegador segue
                  o locale — por isso o formato esperado está escrito abaixo. */}
              <input type="date" value={form.validade}
                onChange={e => onForm({ validade: e.target.value })} className={inputCls} />
            </div>
            <div>
              {/* ⚠️ "Doses por frasco" NÃO aparece mais aqui: quem o informa é o
                  checkbox de multidose acima, e é de lá que o lote de vacina o
                  recebe. Dois campos para o mesmo dado divergiriam — e o que
                  divergiria é o número que desconta a dose do frasco. */}
              <label className={rotuloCls}>Estoque mínimo</label>
              <input type="text" inputMode="numeric" value={form.estoqueMinimo}
                onChange={e => onForm({ estoqueMinimo: e.target.value })}
                placeholder="0" className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* ── Rodapé — ação principal à DIREITA, como no resto da aplicação ─── */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">
          Cancelar
        </button>
        <button type="button" onClick={onSalvar} disabled={salvando}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
          {salvando ? <Loader2 size={14} className="animate-spin" />
                    : editando ? <Pencil size={14} /> : <Plus size={14} />}
          {editando ? 'Atualizar produto' : 'Salvar produto'}
        </button>
      </div>
    </div>
  );
}

/** Cabeçalho do formulário — diz o que está sendo cadastrado e para quem. */
export function ResumoFornecedor({ nome }: { nome: string | null }) {
  if (!nome) return null;
  return (
    <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5">
      <Truck size={12} /> Fornecedor: <strong>{nome}</strong>
    </p>
  );
}
