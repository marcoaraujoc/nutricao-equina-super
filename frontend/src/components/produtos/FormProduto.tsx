// frontend/src/components/produtos/FormProduto.tsx
//
// O FORMULÁRIO da tela de Produtos.
//
// 🔴 O QUE ELE CADASTRA (2026-09-15): o ITEM — medicamento ou vacina — com forma
// farmacêutica, apresentação, unidade, via de administração, controlado e quantidade
// de doses da embalagem. É o cadastro do PRODUTO, não da compra dele.
//
// ⚠️ SAÍRAM a pedido: Fornecedor, Nota fiscal, Valor de compra, Valor de venda, "Ler
// documento de compra" e "Dar entrada no estoque". Compra e saldo são assunto da
// Farmácia / do Estoque de Vacinas — tê-los aqui misturava "o que é o produto" com
// "quanto eu tenho dele". O backend daquilo continua existindo e funcionando; o que
// sumiu foi a porta de entrada nesta tela.
//
// 🔴 OS SELETORES SÃO OS MESMOS do cadastro rápido do atendimento
// (`components/catalogo/SeletoresCatalogo`), alimentados pelo BANCO: é isso que faz o
// item nascer igual, seja cadastrado aqui, na Prescrição ou na tela de Vacina.
//
// 🔴 EDITAR UM ITEM GLOBAL NÃO ALTERA O GLOBAL: o backend cria a cópia desta clínica
// (copy-on-write, `lib/catalogoEmpresa.js`). A faixa no topo diz isso — sem ela o
// gestor acharia que está mudando o catálogo do sistema.
import { Loader2, Layers, Pencil, Globe } from 'lucide-react';
import { SeletorBusca, SeletorVias, type OpcoesCatalogo } from '../catalogo/SeletoresCatalogo';
import type { FormProdutoDados } from './tiposProduto';

const inputCls =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 bg-white';
const rotuloCls = 'block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5';

interface Props {
  tipo: 'medicamento' | 'vacina';
  form: FormProdutoDados;
  onForm: (patch: Partial<FormProdutoDados>) => void;
  opcoes: OpcoesCatalogo;
  carregandoOpcoes: boolean;
  salvando: boolean;
  onSalvar: () => void;
  onCancelar: () => void;
  /** Campos que a última tentativa de salvar acusou — pinta a borda de vermelho. */
  camposComErro?: string[];
  /**
   * A base tem as colunas de multidose (migration 20261009000000)?
   *
   * ⚠️ Sem a bandeira o campo apareceria e a marcação DESAPARECERIA no salvar, em
   * silêncio — e o item voltaria a ser cobrado pela embalagem inteira sem ninguém
   * notar.
   */
  multidoseDisponivel?: boolean;
  /** Consulta o catálogo ao SAIR do campo Nome (nunca por tecla — seria uma ida ao
   *  banco por caractere digitado). */
  onNomeSaiu?: () => void;
  /** Está consultando o nome — o campo mostra o giro em vez de ficar mudo. */
  consultandoNome?: boolean;
  /** O nome digitado bateu com um item que já existe no catálogo. */
  avisoCatalogo?: { nome: string; daEmpresa: boolean; ativo: boolean; carregado: boolean } | null;
  /** Carrega os dados do item encontrado (quando não foram carregados sozinhos). */
  onCarregarEncontrado?: () => void;
}

export default function FormProduto({
  tipo, form, onForm, opcoes, carregandoOpcoes,
  salvando, onSalvar, onCancelar, camposComErro = [], multidoseDisponivel = true,
  onNomeSaiu, consultandoNome = false, avisoCatalogo = null, onCarregarEncontrado,
}: Props) {
  const ehVacina = tipo === 'vacina';
  const editando = form.medicamentoId != null;
  const erro = (campo: string) => camposComErro.includes(campo);

  return (
    <div className="space-y-4">
      {/* Item do catálogo GLOBAL: alterar cria a cópia desta clínica. Dizer isso aqui
          evita a leitura de que o gestor está mexendo no catálogo do sistema. */}
      {editando && !form.daEmpresa && !avisoCatalogo && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <Globe size={12} className="flex-shrink-0 mt-0.5" />
          Este item vem do catálogo do sistema. Ao salvar, uma cópia dele é criada
          <strong className="mx-1">somente para esta clínica</strong> com as alterações —
          o catálogo das demais clínicas não é tocado.
        </p>
      )}
      {editando && form.daEmpresa && !avisoCatalogo && (
        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Pencil size={12} className="flex-shrink-0" />
          Produto desta clínica — os campos abaixo foram carregados e podem ser alterados.
        </p>
      )}

      {carregandoOpcoes && (
        <p className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Carregando as opções do catálogo…
        </p>
      )}

      {/* ── 1. O NOME — campo LIVRE (a pedido): deixou de ser seletor ─────────── */}
      <div>
        <label className={rotuloCls}>
          {ehVacina ? 'Vacina' : 'Medicamento'} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            value={form.nome}
            onChange={e => onForm({ nome: e.target.value })}
            /* 🔴 Consulta ao SAIR do campo, nunca a cada tecla: um gancho por tecla
               viraria uma consulta por caractere digitado. */
            onBlur={() => onNomeSaiu?.()}
            maxLength={90}
            placeholder={ehVacina ? 'Ex.: Vacina contra Influenza Equina' : 'Ex.: Dipirona 500 mg/mL'}
            className={`${inputCls} ${consultandoNome ? 'pr-9' : ''} ${erro('Nome') ? 'border-red-400' : ''}`}
          />
          {consultandoNome && (
            <Loader2 size={14} className="animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
          )}
        </div>

        {/* 🔴 PREENCHER SOZINHO SEM DIZER POR QUÊ ASSUSTA (mesma regra do
            `AvisoCadastroEncontrado` do cadastro por e-mail): a faixa conta de onde os
            dados vieram e o que o Salvar vai fazer. */}
        {avisoCatalogo && (
          <div className={`mt-2 text-[11px] rounded-lg px-3 py-2 border flex items-start gap-1.5 ${
            avisoCatalogo.daEmpresa
              ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
              : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}>
            {avisoCatalogo.daEmpresa
              ? <Pencil size={12} className="flex-shrink-0 mt-0.5" />
              : <Globe  size={12} className="flex-shrink-0 mt-0.5" />}
            <span className="min-w-0">
              <strong>“{avisoCatalogo.nome}”</strong>{' '}
              já existe {avisoCatalogo.daEmpresa ? 'no catálogo desta clínica' : 'no catálogo do sistema'}
              {!avisoCatalogo.ativo && ' (inativo)'}.{' '}
              {avisoCatalogo.carregado
                ? 'Os campos abaixo foram trazidos desse cadastro e podem ser alterados.'
                : 'O formulário já tem dados digitados, então nada foi sobrescrito.'}
              {!avisoCatalogo.carregado && onCarregarEncontrado && (
                <button type="button" onClick={onCarregarEncontrado}
                  className="ml-1 underline font-semibold hover:opacity-80">
                  Carregar os dados do cadastro
                </button>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── 2. O QUE DEFINE O ITEM ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SeletorBusca label="Forma farmacêutica" valor={form.formaFarmaceutica}
          opcoes={opcoes.formas} placeholder="Selecione a forma…"
          erro={erro('Forma farmacêutica')} onChange={v => onForm({ formaFarmaceutica: v })} />
        <SeletorBusca label="Apresentação" valor={form.apresentacao}
          opcoes={opcoes.apresentacoes} placeholder="Selecione a apresentação…"
          erro={erro('Apresentação')} onChange={v => onForm({ apresentacao: v })} />
        <SeletorBusca label="Unidade" valor={form.unidade}
          opcoes={opcoes.unidades} placeholder="Selecione a unidade…"
          erro={erro('Unidade')} onChange={v => onForm({ unidade: v })} />
        <SeletorVias valores={form.vias} opcoes={opcoes.vias}
          erro={erro('Via de administração')} onChange={v => onForm({ vias: v })} />
      </div>

      {/* Fabricante existe só na VACINA — é o campo que o Estoque de Vacinas exibe
          no lote, e num medicamento ele nunca foi pedido em tela nenhuma. */}
      {ehVacina && (
        <div>
          <label className={rotuloCls}>Fabricante</label>
          <input value={form.fabricante} onChange={e => onForm({ fabricante: e.target.value })}
            maxLength={150} placeholder="Opcional" className={inputCls} />
        </div>
      )}

      {/* ── 3. CONTROLADO — só medicamento ────────────────────────────────────
          🔴 Vacina NÃO é controlado: aceitar a marcação ali faria uma dose de rotina
          sair no receituário de controle especial. O backend também força `false`. */}
      {!ehVacina && (
        <div>
          <label className={rotuloCls}>Controlado <span className="text-red-500">*</span></label>
          <div className="flex items-center gap-2">
            {[{ v: true, l: 'Sim' }, { v: false, l: 'Não' }].map(o => (
              <button key={String(o.v)} type="button"
                onClick={() => onForm({ controlado: o.v })}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                  form.controlado === o.v
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                {o.l}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Item controlado sai no Receituário de Controle Especial, à parte da receita comum.
          </p>
        </div>
      )}

      {/* ── 4. QUANTIDADE DE DOSES ────────────────────────────────────────────
          🔴 Preenchido, o item JÁ NASCE MULTIDOSE (a pedido): "marque a multidose se
          o número for informado" é a regra, então não há um checkbox à parte para
          marcar — o número É a marcação. Cada aplicação passa a descontar 1/N da
          embalagem e é por dose que ela entra na fatura, não pelo frasco inteiro. */}
      {multidoseDisponivel && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <label className={rotuloCls}>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={12} className="text-emerald-600" />
              {ehVacina ? 'Quantidade de Doses' : 'Qtd. de doses por embalagem'}
            </span>
          </label>
          <input type="text" inputMode="numeric" value={form.dosesPorEmbalagem}
            onChange={e => {
              const n = e.target.value.replace(/\D/g, '');
              // O número É a marcação: informado, o item passa a ser multidose;
              // apagado, volta a ser cobrado pela embalagem inteira. Um checkbox à
              // parte daria dois estados para a mesma decisão, e eles divergiriam.
              onForm({ dosesPorEmbalagem: n, multidose: n !== '' && Number(n) > 1 });
            }}
            placeholder="Ex.: 10" className={`${inputCls} max-w-[10rem]`} />
          <p className={`text-[11px] leading-snug mt-1.5 ${form.multidose ? 'text-emerald-700' : 'text-gray-500'}`}>
            {form.multidose
              ? `Produto multidose: cada aplicação desconta 1/${form.dosesPorEmbalagem} da embalagem e é cobrada por esse valor.`
              : 'Em branco (ou 1), a embalagem rende uma aplicação e é cobrada inteira a cada uso.'}
          </p>
        </div>
      )}

      {/* ── Rodapé — ação principal à DIREITA, como no resto da aplicação ─────── */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">
          Cancelar
        </button>
        <button type="button" onClick={onSalvar} disabled={salvando}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
          {salvando && <Loader2 size={14} className="animate-spin" />}
          Salvar
        </button>
      </div>
    </div>
  );
}
