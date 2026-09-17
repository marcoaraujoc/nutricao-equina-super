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
import { FORMAS_CALCULO, FORMA_DOSES, qtdDoNome, fmtQtdForma } from '../../utils/formaCalculo';
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
  const qtdPreenchida = !!form.formaCalculo && !!form.dosesPorEmbalagem.trim();

  /**
   * Desmarcar LIMPA forma e quantidade.
   * ⚠️ Deixá-las gravadas faria o item voltar a ser multidose na gravação seguinte sem
   * ninguém ter pedido — e o que volta junto é a divisão do preço da dose na fatura.
   */
  const trocarMultidose = (marcado: boolean) => {
    onForm(marcado ? { multidose: true } : { multidose: false, formaCalculo: '', dosesPorEmbalagem: '' });
  };

  /**
   * Trocar a Forma de Cálculo REPREENCHE a Qtd a partir do NOME do produto.
   *
   * As três regras pedidas caem numa linha só, porque `qtdDoNome` já devolve `null`
   * no que não deve preencher: `doses` nunca é extraída do nome (rótulo não traz
   * contagem de aplicação) e nome sem a medida na forma escolhida também não casa.
   * ⚠️ Só no TROCA da forma, nunca a cada tecla do Nome: repreencher enquanto a pessoa
   * digita sobrescreveria a Qtd que ela acabou de informar à mão.
   */
  const trocarForma = (nova: string) => {
    const achada = qtdDoNome(form.nome, nova);
    onForm({ formaCalculo: nova, dosesPorEmbalagem: achada != null ? fmtQtdForma(achada) : '' });
  };

  return (
    <div className="space-y-4">
      {/* ⚠️ A faixa "Este item vem do catálogo do sistema…" foi REMOVIDA a pedido
          (2026-09-16). A REGRA continua valendo e não mudou: editar um item GLOBAL cria
          a CÓPIA desta clínica (copy-on-write, `lib/catalogoEmpresa.js`) e o catálogo
          das demais segue intocado. O que saiu foi o texto — o selo "do sistema" na
          LISTA continua dizendo de onde o item vem. */}
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

      {/* ── 1. O QUE IDENTIFICA O ITEM, numa linha só no desktop (a pedido) ─────
          Nome · Forma farmacêutica · Apresentação. O NOME é campo LIVRE desde
          2026-09-15 — deixou de ser seletor. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              placeholder={ehVacina ? 'Ex.: Vacina contra Influenza' : 'Ex.: Dipirona 500 mg/mL'}
              className={`${inputCls} ${consultandoNome ? 'pr-9' : ''} ${erro('Nome') ? 'border-red-400' : ''}`}
            />
            {consultandoNome && (
              <Loader2 size={14} className="animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>

        <SeletorBusca label="Forma farmacêutica" valor={form.formaFarmaceutica}
          opcoes={opcoes.formas} placeholder="Selecione a forma…"
          erro={erro('Forma farmacêutica')} onChange={v => onForm({ formaFarmaceutica: v })} />
        <SeletorBusca label="Apresentação" valor={form.apresentacao}
          opcoes={opcoes.apresentacoes} placeholder="Selecione a apresentação…"
          erro={erro('Apresentação')} onChange={v => onForm({ apresentacao: v })} />
      </div>

      {/* 🔴 PREENCHER SOZINHO SEM DIZER POR QUÊ ASSUSTA (mesma regra do
          `AvisoCadastroEncontrado` do cadastro por e-mail): a faixa conta de onde os
          dados vieram e o que o Salvar vai fazer.
          ⚠️ FORA da grade e em LARGURA INTEIRA: ela fala do formulário todo ("os campos
          abaixo foram trazidos"), não do campo Nome — e espremida em um terço da linha
          viraria uma tira de texto quebrado ao lado de dois seletores vazios. */}
      {avisoCatalogo && (
        <div className={`text-[11px] rounded-lg px-3 py-2 border flex items-start gap-1.5 ${
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

      {/* 🔴 TRÊS COLUNAS NA MESMA LINHA (a pedido, 2026-09-16):
             MEDICAMENTO → Unidade · Vias · Controlado
             VACINA      → Unidade · Vias · Fabricante
          ⚠️ A terceira coluna TROCA de campo, não some: vacina não é controlada (o
          backend força `false`) e medicamento nunca pediu fabricante em tela nenhuma.
          Deixar o vão faria a grade ler como campo que sumiu. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SeletorBusca label="Unidade" valor={form.unidade}
          opcoes={opcoes.unidades} placeholder="Selecione a unidade…"
          erro={erro('Unidade')} onChange={v => onForm({ unidade: v })} />
        <SeletorVias valores={form.vias} opcoes={opcoes.vias}
          erro={erro('Via de administração')} onChange={v => onForm({ vias: v })} />

        {/* 🔴 Vacina NÃO é controlado: aceitar a marcação ali faria uma dose de rotina
            sair no receituário de controle especial. O backend também força `false`. */}
        {ehVacina ? (
          <div>
            <label className={rotuloCls}>Fabricante</label>
            <input value={form.fabricante} onChange={e => onForm({ fabricante: e.target.value })}
              maxLength={150} placeholder="Opcional" className={inputCls} />
          </div>
        ) : (
          <div>
            <label className={rotuloCls}>Controlado <span className="text-red-500">*</span></label>
            {/* Metade da largura da coluna: são dois botões de uma palavra, e ocupando
                a linha inteira competiam visualmente com os dois seletores ao lado. */}
            <div className="flex items-center gap-2 w-1/2">
              {[{ v: true, l: 'Sim' }, { v: false, l: 'Não' }].map(o => (
                <button key={String(o.v)} type="button"
                  onClick={() => onForm({ controlado: o.v })}
                  className={`flex-1 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    form.controlado === o.v
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 3. MULTIDOSE: a Forma de Cálculo e o CONTEÚDO da embalagem ────────
          🔴 O QUE ESTE BLOCO RESOLVE (2026-09-16): embalagem e conteúdo eram a mesma
          coisa. O frasco de 20 mL era cadastrado como "1 Un.", e uma dose de 5 mL
          debitava 5 UNIDADES (cinco frascos) e cobrava cinco frascos — a conversão
          mL → Un. é impossível e a baixa caía no valor BRUTO, sem erro na tela.
          Marcado, o produto passa a declarar EM QUÊ é medido e QUANTO cabe na
          embalagem, e daí saem o estoque, a receita e a linha da fatura.
          ⚠️ O checkbox voltou a ser explícito: antes o NÚMERO era a marcação. Com a
          Forma de Cálculo no meio, o número sozinho não diz mais em que unidade ele
          está — e um número sem unidade não divide preço nenhum. */}
      {multidoseDisponivel && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox" checked={form.multidose}
              onChange={e => trocarMultidose(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <span className="min-w-0">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Layers size={13} className="text-emerald-600" />
                Produto multidose
              </span>
              <span className="block text-[11px] text-gray-500 leading-snug">
                A embalagem rende mais de uma aplicação e é medida por dentro
                (frasco de 20&nbsp;mL, bisnaga de 50&nbsp;g…).
              </span>
            </span>
          </label>

          {form.multidose && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={rotuloCls}>
                  Forma de Cálculo <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.formaCalculo}
                  onChange={e => trocarForma(e.target.value)}
                  className={`${inputCls} ${erro('Forma de Cálculo') ? 'border-red-400' : ''}`}>
                  <option value="">Selecione…</option>
                  {FORMAS_CALCULO.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className={rotuloCls}>
                  Qtd
                  {form.formaCalculo && (
                    <span className="text-gray-400 font-normal normal-case tracking-normal ml-1">
                      ({form.formaCalculo} por Unidade)
                    </span>
                  )}
                </label>
                {/* ⚠️ SEMPRE EDITÁVEL (a pedido): o que a Forma de Cálculo muda é só o
                    que ele traz PREENCHIDO. Aceita decimal — dose de 2,5 mL é rotina,
                    e campo inteiro truncaria a fração em silêncio. */}
                <input
                  type="text" inputMode="decimal" value={form.dosesPorEmbalagem}
                  onChange={e => onForm({
                    dosesPorEmbalagem: e.target.value.replace(/[^\d.,]/g, '').replace('.', ','),
                  })}
                  placeholder={form.formaCalculo === FORMA_DOSES ? 'Ex.: 10' : 'Ex.: 20'}
                  className={`${inputCls} ${erro('Qtd') ? 'border-red-400' : ''}`}
                />
              </div>
            </div>
          )}

          <p className={`text-[11px] leading-snug ${form.multidose ? 'text-emerald-700' : 'text-gray-500'}`}>
            {form.multidose
              ? (qtdPreenchida
                  ? `Cada embalagem entra no estoque como ${form.dosesPorEmbalagem} ${form.formaCalculo}, `
                    + `a receita é escrita em ${form.formaCalculo} e a fatura sai pelo preço da embalagem ÷ ${form.dosesPorEmbalagem}.`
                  : 'Informe a Forma de Cálculo e a Qtd — é desse par que saem a baixa do estoque e o valor da dose na fatura.')
              : 'Desmarcado, a embalagem é a própria unidade: entra inteira no estoque e é cobrada inteira a cada uso.'}
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
