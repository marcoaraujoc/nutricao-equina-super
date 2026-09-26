// frontend/src/pages/CadastroProcedimento.tsx
// Cadastro > Procedimentos — catálogo da clínica por CATEGORIA + combos da empresa.
//
// 🔴 REFORMULADA EM 2026-09-22, no formato de Cadastro > Produtos:
//   - "Especialidade / Exame de imagem" virou CATEGORIA (rótulo único na tela);
//   - "Valor cliente" virou VALOR, e a coluna Categoria saiu da grade — repetia o
//     que o próprio seletor já diz, já que é por ele que a lista é recortada;
//   - cadastrar deixou de ser efeito colateral da BUSCA ("Cadastrar «X»") e passou a
//     ser o botão NOVO PROCEDIMENTO, com Categoria, Procedimento e Valor;
//   - alterar, inativar e ativar seguem a mesma lógica de Produtos (lápis + chave,
//     trio Todos/Ativos/Inativos, justificativa só na inativação).
//
// ⚠️ MULTI-TENANT: a lista mistura o catálogo GLOBAL (empresa_id nulo) com o da
//    clínica. Só o DELA pode ser renomeado ou inativado — a policy de
//    tb_procedimentos_vet lê global + próprio mas só ESCREVE o próprio. O VALOR é
//    sempre da empresa (tabela à parte), então vale para os dois casos.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import JanelaLista from '../components/JanelaLista';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ModalJustificativa from '../components/ModalJustificativa';
import DropdownSelect from '../components/DropdownSelect';
import {
  ListChecks, Search, Pencil, X, Loader2, Check, Layers, PackagePlus, ToggleRight, ToggleLeft, Globe, Trash2,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Procedimento {
  id:            number;
  nome:          string;
  nomeAbreviado: string | null;
  categoria:     string;
  subcategoria:  string | null;
  especialidade: string | null;
  tipoProcedimento: string | null;
  duracao:       number | null;
  valorVenda:    number | null;
  descricao:     string | null;
  valorEmpresa:  number | null;
  /** false = linha GLOBAL do catálogo (de todas as clínicas) — ver o cabeçalho. */
  daEmpresa:     boolean;
  ativo:         boolean;
}

interface ComboItem {
  id: number;
  procedimento: { id: number; nome: string; categoria: string; especialidade: string | null; valorVenda: number | null };
}

interface Combo {
  id:            number;
  nome:          string;
  descricao:     string | null;
  especialidade: string | null;
  /** VALOR CLIENTE do pacote — o nome do campo é histórico (ver o schema). */
  valor:         number;
  itens:         ComboItem[];
  ativo:         boolean;
  /**
   * Prestador do pacote (migration 20261002000000). A tela DEIXOU DE OFERECÊ-LO em
   * 2026-09-11, mas o valor gravado continua sendo lido e REENVIADO no salvar — sem
   * isso, editar o nome de um combo apagaria em silêncio o prestador que alguém
   * cadastrou enquanto o campo existia.
   */
  prestadorId?:    number | null;
  valorPrestador?: number | null;
}

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Máscara monetária de digitação: "R$ 000.000,00" (mesmo padrão do CadastroProprietario)
const maskBRL = (v: string): string => {
  const nums = v.replace(/\D/g, '');
  if (!nums) return '';
  const n = parseInt(nums, 10) / 100;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const parseBRL = (v: string): number =>
  parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
const numToMask = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : maskBRL(String(Math.round(v * 100)));

/**
 * Especialidades REAIS do combo: as dos procedimentos que o compõem, sem repetir.
 *
 * `Combo.especialidade` é só a CLASSIFICAÇÃO gravada no cadastro — a que estava no
 * seletor na hora de salvar. Num combo montado com três áreas, exibi-lo sozinho
 * mostrava apenas a última usada e escondia as outras duas. O campo continua servindo
 * ao filtro do Orçamento; quem descreve o conteúdo do pacote são os itens.
 * Combo cujos procedimentos não têm especialidade cai na classificação (não fica sem
 * nenhum selo).
 */
const especialidadesDoCombo = (c: Combo): string[] => {
  const dosItens = [...new Set(
    c.itens.map(i => i.procedimento.especialidade).filter((e): e is string => !!e?.trim()),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (dosItens.length > 0) return dosItens;
  return c.especialidade ? [c.especialidade] : [];
};

// ─── Selos da linha ──────────────────────────────────────────────────────────
/**
 * Os dois avisos que a linha precisa dar, no mesmo formato de Cadastro > Produtos.
 *
 * ⚠️ "inativo": sem ele, o procedimento inativado fica IDÊNTICO ao ativo na aba
 * "Todos" — e a chave ao lado seria a única pista.
 * ⚠️ "do sistema": a linha GLOBAL vale para todas as clínicas. O selo evita a leitura
 * de que alterar o nome ali valeria para todo mundo (não vale, e o backend recusa).
 */
function SelosProcedimento({ p }: { p: Procedimento }) {
  return (
    <>
      {!p.ativo && (
        <span className="ml-2 inline-flex items-center text-[10px] text-gray-600 bg-gray-100 border border-gray-300 px-1.5 py-0.5 rounded-full align-middle">
          inativo
        </span>
      )}
      {!p.daEmpresa && (
        <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full align-middle">
          <Globe size={10} /> do sistema
        </span>
      )}
    </>
  );
}

// ─── Ações da linha ──────────────────────────────────────────────────────────
/**
 * UMA declaração para a tabela E para o card (armadilha 28-g): duas listas separadas
 * divergiriam na primeira correção — foi assim que o card da Prescrição ficou sem o
 * Finalizar.
 *
 * ⚠️ Ordem e cor da §6: Alterar (laranja) primeiro; a CHAVE (tom `ativar`, azul) por
 * último — é o ÍCONE que diz a posição, não a cor.
 * ⚠️ A chave (2026-09-25) vale também no procedimento DO SISTEMA: o backend cria uma
 * cópia própria da clínica na primeira vez que ela ativa/inativa um item global — ver
 * `toggleAtivoProprio`. **Excluir** continua só no procedimento DA CLÍNICA: só faz
 * sentido apagar uma linha que já é dela (a cópia recém-criada já entra nesse grupo).
 */
function AcoesProcedimento({
  p, podeEditar, podeExcluir, onEditar, onAlternar, onExcluir,
}: {
  p: Procedimento;
  podeEditar: boolean;
  podeExcluir: boolean;
  onEditar: (p: Procedimento) => void;
  onAlternar: (p: Procedimento) => void;
  onExcluir: (p: Procedimento) => void;
}) {
  return (
    <AcoesRegistro>
      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
        visivel={podeEditar} onClick={() => onEditar(p)} />
      <AcaoRegistro
        tom="ativar"
        icone={p.ativo ? ToggleRight : ToggleLeft}
        rotulo={p.ativo ? 'Inativar' : 'Ativar'}
        visivel={podeExcluir}
        onClick={() => onAlternar(p)} />
      {/* EXCLUIR DE VEZ (2026-09-23) — vermelho e por último, depois da chave.
          ⚠️ Convive com o INATIVAR, não o substitui: quem já foi usado uma vez deixa
          de ser excluível para sempre, e sem a chave não haveria como tirá-lo da
          frente. Quem responde "já foi usado?" é o BACKEND (409 `PROCEDIMENTO_EM_USO`)
          — a tela não tem como saber, e esconder o botão por um palpite deixaria a
          pessoa sem entender por que ele some em algumas linhas e não em outras. */}
      <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Excluir"
        visivel={podeExcluir && p.daEmpresa}
        onClick={() => onExcluir(p)} />
    </AcoesRegistro>
  );
}

// ─── Linha da grade (desktop) ────────────────────────────────────────────────
/**
 * 🔴 A LINHA VOLTOU A SER SÓ LEITURA (2026-09-22, a pedido). O valor era um campo
 * digitável direto na grade (`ValorInline`, de 2026-09-10) com um par Salvar/Cancelar
 * próprio; agora quem altera é o LÁPIS, que abre o formulário com os três campos —
 * Categoria, Procedimento e Valor —, exatamente como em Cadastro > Produtos.
 *
 * ⚠️ NÃO reintroduzir a edição na célula junto com o lápis: dois caminhos para gravar
 * o MESMO valor, um deles sem confirmação visível, é como a pessoa perde a alteração
 * sem saber qual dos dois valia.
 */
function LinhaProcedimento({
  p, podeEditar, podeExcluir, onEditar, onAlternar, onExcluir,
}: {
  p: Procedimento;
  podeEditar: boolean;
  podeExcluir: boolean;
  onEditar: (p: Procedimento) => void;
  onAlternar: (p: Procedimento) => void;
  onExcluir: (p: Procedimento) => void;
}) {
  return (
    <tr className={`border-b border-gray-50 hover:bg-gray-50/60 ${p.ativo ? '' : 'opacity-60'}`}>
      <td className="px-5 py-3">
        <p className="font-medium text-gray-900">
          {p.nome}
          <SelosProcedimento p={p} />
        </p>
        {p.descricao && <p className="text-[11px] text-gray-400 truncate max-w-md">{p.descricao}</p>}
      </td>
      <td className="px-5 py-3 text-right">
        <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
          {brl(p.valorEmpresa)}
        </span>
      </td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        <AcoesProcedimento p={p} podeEditar={podeEditar} podeExcluir={podeExcluir}
          onEditar={onEditar} onAlternar={onAlternar} onExcluir={onExcluir} />
      </td>
    </tr>
  );
}

// ─── Card do procedimento (mobile) ───────────────────────────────────────────
/** Espelho do desktop — mesmos dados, mesmas ações, mesma regra de visibilidade. */
function CardProcedimento({
  p, podeEditar, podeExcluir, onEditar, onAlternar, onExcluir,
}: {
  p: Procedimento;
  podeEditar: boolean;
  podeExcluir: boolean;
  onEditar: (p: Procedimento) => void;
  onAlternar: (p: Procedimento) => void;
  onExcluir: (p: Procedimento) => void;
}) {
  return (
    <div data-item-lista className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${p.ativo ? '' : 'opacity-60'}`}>
      <p className="font-semibold text-gray-900 text-sm">
        {p.nome}
        <SelosProcedimento p={p} />
      </p>
      {p.descricao && <p className="text-[11px] text-gray-400 mt-0.5">{p.descricao}</p>}

      <div className="flex items-center justify-between gap-2 mt-2 text-xs">
        <span className="text-gray-500">Valor</span>
        <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
          {brl(p.valorEmpresa)}
        </span>
      </div>

      {/* ⚠️ As ações do card vão no RODAPÉ (§6): com rótulo, ao lado do nome elas
          espremeriam o procedimento até ele quebrar de linha. */}
      {(podeEditar || podeExcluir) && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          <AcoesProcedimento p={p} podeEditar={podeEditar} podeExcluir={podeExcluir}
            onEditar={onEditar} onAlternar={onAlternar} onExcluir={onExcluir} />
        </div>
      )}
    </div>
  );
}

// ─── Formulário do procedimento ──────────────────────────────────────────────
/**
 * 🔴 OS TRÊS CAMPOS PEDIDOS (2026-09-22): **Categoria, Procedimento e Valor**.
 *
 * ⚠️ SUBSTITUI o cadastro-ao-digitar-na-busca ("Cadastrar «X»", de 2026-09-18), que
 * saiu a pedido. Criar registro como efeito colateral de uma BUSCA fazia erro de
 * digitação virar cadastro, e não havia onde informar categoria nem valor — o item
 * nascia genérico e zerado para alguém corrigir depois.
 *
 * ⚠️ "Categoria" aqui é a MESMA lista do seletor da tela: especialidades clínicas +
 * categorias de exame de imagem, em dois blocos. É o backend que traduz cada uma para
 * a coluna certa (`especialidade` × `categoria` + `tipoProcedimento`) — ver
 * `camposDaCategoria` no controller.
 *
 * ⚠️ No item DO SISTEMA, Categoria e Procedimento ficam desabilitados e SÓ o valor é
 * editável: a linha global vale para todas as clínicas e o RLS recusa a escrita. O
 * desabilitado é a explicação; a autorização é a do backend.
 */
function ProcedimentoModal({
  item, especialidades, imagemCategorias, categoriaInicial, salvando, erro, onSalvar, onFechar,
}: {
  item: Procedimento | null;
  especialidades: string[];
  imagemCategorias: string[];
  categoriaInicial: string;
  salvando: boolean;
  erro: string | null;
  onSalvar: (dados: { nome: string; categoria: string; valor: number | null }) => void;
  onFechar: () => void;
}) {
  const ehEdicao = !!item;
  const doSistema = ehEdicao && !item!.daEmpresa;

  const [nome, setNome] = useState(item?.nome ?? '');
  // ⚠️ Qual das duas colunas é a "Categoria" depende da NATUREZA do item: exame de
  // imagem se organiza por `categoria` (Radiografia…), procedimento clínico por
  // `especialidade`. Quem responde isso é a lista que veio do backend — nunca uma
  // cópia da constante `TIPO_IMAGEM` aqui, que divergiria na primeira mudança lá.
  const [categoria, setCategoria] = useState(
    item
      ? (imagemCategorias.includes(item.categoria) ? item.categoria : (item.especialidade ?? ''))
      : categoriaInicial,
  );
  const [valor, setValor] = useState(numToMask(item?.valorEmpresa));

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <h3 className="font-bold text-gray-900">{ehEdicao ? 'Alterar Procedimento' : 'Novo Procedimento'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {doSistema && (
            <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
              <Globe size={12} className="mt-0.5 flex-shrink-0" />
              Procedimento do catálogo do sistema — vale para todas as clínicas. Aqui só o
              valor cobrado por esta clínica pode ser alterado.
            </p>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Categoria *</label>
            {/* DOIS blocos com cabeçalho: sem eles "Radiografia" apareceria no meio das
                especialidades clínicas e leria como se fosse uma delas. */}
            <DropdownSelect
              value={categoria}
              onChange={setCategoria}
              grupos={[
                { label: 'Especialidades',   options: especialidades },
                { label: 'Exames de imagem', options: imagemCategorias },
              ]}
              placeholder="— Selecionar —"
              className={inputCls}
              disabled={doSistema}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Procedimento *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} disabled={doSistema}
              placeholder="Nome do procedimento" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valor</label>
            <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={valor}
              onChange={e => setValor(maskBRL(e.target.value))} className={inputCls} />
            <p className="text-[10px] text-gray-400 mt-1">
              Valor cobrado do cliente por esta clínica. Em branco = sem valor definido.
            </p>
          </div>
        </div>

        {/* Erro da AÇÃO fica ABAIXO do botão que a disparou (§6). */}
        <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
          <button onClick={onFechar} disabled={salvando}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({
              nome: nome.trim(),
              categoria: categoria.trim(),
              valor: valor.trim() === '' ? null : parseBRL(valor),
            })}
            disabled={salvando}
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
            {salvando && <Loader2 size={13} className="animate-spin" />}
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        {erro && <div className="px-5 pb-5"><InlineError message={erro} /></div>}
      </div>
    </div>
  );
}

export default function CadastroProcedimento() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms, podeExecutar } = usePermissoes();
  const isAdmin = (user?.userType ?? '').toUpperCase() === 'ADMIN';

  const [especialidades, setEspecialidades] = useState<string[]>([]);
  /**
   * 🔴 CATEGORIAS DE EXAME DE IMAGEM (2026-09-09) — Radiografia, Ultrassonografia,
   * Endoscopia, Termografia, Tomografia e Ressonância, Laparoscopia.
   * Vieram no lugar da especialidade 'Diagnóstico por Imagem', que SAIU do seletor: os
   * 119 exames de imagem passaram a ser procedimentos do catálogo e se organizam por
   * categoria, não por especialidade. Quem manda a lista (e a ORDEM clínica dela) é o
   * backend — deduzi-la aqui daria ordem alfabética e mudaria sozinha.
   */
  const [imagemCategorias, setImagemCategorias] = useState<string[]>([]);
  const [gestorBackend,  setGestorBackend]  = useState(false);
  const [espSel,         setEspSel]         = useState('');
  const [procedimentos,  setProcedimentos]  = useState<Procedimento[]>([]);
  const [combos,         setCombos]         = useState<Combo[]>([]);
  const [buscaCombos,    setBuscaCombos]    = useState('');
  const [filtroAtivoCombos, setFiltroAtivoCombos] = useState<'ativo' | 'inativo' | 'all'>('ativo');
  const [busca,          setBusca]          = useState('');
  const [aba,            setAba]            = useState<'procedimentos' | 'combos'>('procedimentos');
  const [loading,        setLoading]        = useState(true);
  const [loadingProcs,   setLoadingProcs]   = useState(false);
  /**
   * Trio Todos/Ativos/Inativos das demais telas de cadastro. É por ele que se alcança
   * o procedimento inativado para reativá-lo — sem ele, inativar é caminho sem volta.
   */
  const [filtroAtivoProcs, setFiltroAtivoProcs] = useState<'all' | 'ativo' | 'inativo'>('ativo');

  // 🔴 O LÁPIS VOLTOU (2026-09-22): alterar abre o formulário com Categoria,
  // Procedimento e Valor, como em Cadastro > Produtos. O campo de valor digitável na
  // própria grade (2026-09-10/11) saiu junto — ver `LinhaProcedimento`.
  const [showProcModal, setShowProcModal] = useState(false);
  const [procEditando,  setProcEditando]  = useState<Procedimento | null>(null);
  const [salvandoProc,  setSalvandoProc]  = useState(false);
  const [inativandoProc, setInativandoProc] = useState<Procedimento | null>(null);
  // Exclusão DEFINITIVA (2026-09-23) — só o procedimento da clínica que nunca foi
  // usado. Quem decide isso é o backend; a tela oferece e mostra a recusa.
  const [excluindoProc, setExcluindoProc] = useState<Procedimento | null>(null);
  const [excluindoEmCurso, setExcluindoEmCurso] = useState(false);
  // ⚠️ O erro da exclusão fica NO MODAL, não no topo da página (§6): com o overlay
  // aberto, a explicação de por que o procedimento não pôde ser excluído ficaria
  // atrás dele — e o clique pareceria não ter feito nada.
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  /**
   * CHEGADA GUIADA — `?especialidade=&busca=<procedimento>` posiciona a tela na
   * especialidade certa e já filtrada pelo procedimento, para quem vem de outra tela
   * não cair numa lista de centenas de linhas.
   */
  const [params] = useSearchParams();
  const espDaUrl      = params.get('especialidade') ?? '';
  const buscaDaUrl    = params.get('busca') ?? '';

  // Modal combo (gestor)
  const [showCombo,     setShowCombo]     = useState(false);
  const [comboEditando, setComboEditando] = useState<Combo | null>(null);
  const [comboNome,     setComboNome]     = useState('');
  const [comboEsp,      setComboEsp]      = useState('');
  const [comboValor,    setComboValor]    = useState('');
  const [comboDesc,     setComboDesc]     = useState('');
  const [comboIds,      setComboIds]      = useState<number[]>([]);
  /**
   * Prestador do combo — a tela NÃO o oferece mais (2026-09-11), mas o que está gravado
   * é carregado na edição e reenviado no salvar. Sem isso, editar o nome de um combo
   * apagaria em silêncio o prestador cadastrado enquanto o campo existia.
   */
  const [comboPrestId,    setComboPrestId]    = useState<number | null>(null);
  const [comboValorPrest, setComboValorPrest] = useState<number | null>(null);
  const [comboBusca,    setComboBusca]    = useState('');
  const [todosProcs,    setTodosProcs]    = useState<Procedimento[]>([]);
  const [salvandoCombo, setSalvandoCombo] = useState(false);
  // Erros inline: página (lista), formulário do procedimento e modal de combo
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  const [erroProc,      setErroProc]      = useState<string | null>(null);
  const [erroCombo,     setErroCombo]     = useState<string | null>(null);
  const [comboToggle,   setComboToggle]   = useState<Combo | null>(null);

  // Controle de acesso — slug cadastro.procedimento.* (GESTOR/ADMIN têm bypass via podeExecutar)
  const podeVer    = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.ler');
  const podeEditar = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.editar');
  const podeCriar  = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.criar');
  const podeExcluir = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.deletar');
  // "Gerir" = tem alguma ação de escrita (mostra textos/afford. de gestão)
  const podeGerirEmpresa = podeEditar || podeCriar || podeExcluir;

  // ── Loaders ───────────────────────────────────────────────────────────────

  const carregarEspecialidades = useCallback(async () => {
    try {
      const res = await api.get('/procedimentos/especialidades-minhas');
      if (!res.data) return;
      setEspecialidades(res.data?.dados ?? []);
      setImagemCategorias(res.data?.imagemCategorias ?? []);
      setGestorBackend(Boolean(res.data?.gestor));
    } catch { /* silencioso */ }
  }, []);

  /**
   * A MESMA lista serve às duas naturezas: `sel` é uma especialidade clínica OU uma
   * categoria de exame de imagem, e o parâmetro enviado muda conforme o caso — o
   * backend recorta por `especialidade` ou por `imagemCategoria`, nunca pelos dois.
   * ⚠️ `ehImagem` entra nas dependências: sem isso, escolher uma categoria antes de a
   * lista de categorias chegar mandaria `especialidade=Radiografia` e voltaria vazio.
   */
  // ⚠️ O CADASTRO DEIXOU DE SAIR DAQUI (2026-09-22). O "Cadastrar «X»" pelo campo de
  // busca (2026-09-18) saiu a pedido: criar registro como efeito colateral de uma
  // BUSCA fazia erro de digitação virar cadastro, e não havia onde informar categoria
  // nem valor. Quem cadastra agora é o botão "Novo Procedimento" — e ele abre um
  // formulário com os três campos. A busca voltou a ser só busca.

  const carregarProcedimentos = useCallback(async (
    sel: string, ehImagem: boolean, situacao: 'all' | 'ativo' | 'inativo',
  ) => {
    if (!sel) { setProcedimentos([]); return; }
    setLoadingProcs(true);
    try {
      // ⚠️ O `ativo` é MANDADO por esta tela, e só por ela: o mesmo endpoint alimenta
      // os seletores do Orçamento e da Prescrição, onde o default (só ativos) é o que
      // impede oferecer um procedimento que a clínica tirou de circulação.
      const params = {
        ...(ehImagem ? { imagemCategoria: sel } : { especialidade: sel }),
        ativo: situacao === 'all' ? 'all' : situacao === 'inativo' ? 'false' : 'true',
      };
      const res = await api.get('/procedimentos/cadastro/lista', { params });
      if (!res.data) { setProcedimentos([]); return; }
      setProcedimentos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingProcs(false); }
  }, []);

  const carregarCombos = useCallback(async (ativo: 'ativo' | 'inativo' | 'all') => {
    try {
      const params = ativo === 'all' ? { ativo: 'all' } : { ativo: ativo === 'ativo' ? 'true' : 'false' };
      const res = await api.get('/procedimentos/cadastro/combos', { params });
      if (!res.data) return;
      setCombos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([
      carregarEspecialidades(), carregarCombos(filtroAtivoCombos),
    ]).finally(() => setLoading(false));
  }, [loadingPerms, carregarEspecialidades, carregarCombos, filtroAtivoCombos]);

  /** O que está escolhido no seletor é categoria de imagem (e não especialidade)? */
  const selEhImagem = imagemCategorias.includes(espSel);

  useEffect(() => {
    if (loadingPerms) return;
    carregarProcedimentos(espSel, selEhImagem, filtroAtivoProcs);
  }, [espSel, selEhImagem, filtroAtivoProcs, loadingPerms, carregarProcedimentos]);

  // Auto-seleciona quando há UMA opção só no seletor inteiro — contando as categorias
  // de imagem junto. Com uma especialidade e seis categorias não há o que adivinhar.
  useEffect(() => {
    if (espSel) return;
    const todas = [...especialidades, ...imagemCategorias];
    if (todas.length === 1) setEspSel(todas[0]);
  }, [especialidades, imagemCategorias, espSel]);

  // Chegada guiada: posiciona a tela (especialidade + busca). A especialidade só é
  // imposta quando a empresa realmente a atende — vinda de outra clínica, ela não
  // estaria na lista e o seletor ficaria com um valor sem opção.
  useEffect(() => {
    if (!espDaUrl) return;
    // Vale para os dois tipos de opção: a chegada pode ter partido de uma categoria de
    // imagem, e sem isto o seletor voltaria vazio.
    const conhecidas = [...especialidades, ...imagemCategorias];
    if (conhecidas.length > 0 && !conhecidas.includes(espDaUrl)) return;
    setEspSel(espDaUrl);
  }, [espDaUrl, especialidades, imagemCategorias]);

  useEffect(() => { if (buscaDaUrl) setBusca(buscaDaUrl); }, [buscaDaUrl]);

  const procsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return procedimentos;
    return procedimentos.filter(p =>
      p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  }, [procedimentos, busca]);

  // ── Novo / Alterar / Ativar-Inativar (2026-09-22) ─────────────────────────

  const abrirNovoProc = () => {
    setErroProc(null);
    setProcEditando(null);
    setShowProcModal(true);
  };

  const abrirEdicaoProc = (p: Procedimento) => {
    setErroProc(null);
    setProcEditando(p);
    setShowProcModal(true);
  };

  /**
   * Um só handler para criar e alterar — muda só o verbo HTTP.
   *
   * ⚠️ O `valor` vai SEMPRE, inclusive `null`: é assim que se APAGA um valor definido
   * antes. Omiti-lo faria o backend manter o que estava, e limpar o campo não teria
   * efeito nenhum — a pessoa salvaria e veria o número antigo de volta.
   */
  const salvarProcedimento = async (
    dados: { nome: string; categoria: string; valor: number | null },
  ) => {
    setErroProc(null);
    if (!dados.categoria) { setErroProc('Selecione a categoria.'); return; }
    if (dados.nome.length < 2) { setErroProc('Informe o nome do procedimento.'); return; }

    setSalvandoProc(true);
    try {
      if (procEditando) {
        await api.put(`/procedimentos/cadastro/proprio/${procEditando.id}`, dados);
        toast.success('Procedimento alterado.');
      } else {
        const res = await api.post('/procedimentos/cadastro/proprio', dados);
        toast.success(res.data?.criado
          ? `"${dados.nome}" cadastrado.`
          : `"${dados.nome}" já existia no catálogo — o valor desta clínica foi atualizado.`);
      }
      setShowProcModal(false);
      setProcEditando(null);
      // A categoria salva pode não ser a que está no seletor: recarregar a lista atual
      // deixaria o item recém-criado fora da tela sem nenhuma explicação. Então o
      // seletor ACOMPANHA o que foi cadastrado.
      if (dados.categoria !== espSel) setEspSel(dados.categoria);
      else await carregarProcedimentos(espSel, selEhImagem, filtroAtivoProcs);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroProc(e.response?.data?.error ?? 'Erro ao salvar o procedimento.');
    } finally { setSalvandoProc(false); }
  };

  /**
   * Inativar pede justificativa; ativar é correção e vai direto (§13, armadilha 33).
   *
   * ⚠️ Em item DO SISTEMA (2026-09-25) o backend cria uma CÓPIA própria da clínica
   * (`copiado: true` na resposta) e aplica o ativo/inativo NELA — o global nunca é
   * tocado. O toast avisa, senão a pessoa veria o item ganhar as ações de "da
   * clínica" (chave, excluir) sem entender por quê.
   */
  const alternarAtivoProc = async (p: Procedimento, motivo?: string) => {
    setErroInline(null);
    try {
      const res = await api.patch(`/procedimentos/cadastro/proprio/${p.id}/toggle`, motivo ? { motivo } : {});
      const base = p.ativo ? 'Procedimento inativado.' : 'Procedimento ativado.';
      toast.success(res.data?.copiado ? `${base} Foi criada uma cópia própria da sua clínica.` : base);
      setInativandoProc(null);
      await carregarProcedimentos(espSel, selEhImagem, filtroAtivoProcs);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao alterar a situação do procedimento.');
    }
  };

  const abrirExclusaoProc = (p: Procedimento) => { setErroExcluir(null); setExcluindoProc(p); };

  /**
   * EXCLUIR DE VEZ. O backend recusa com 409 `PROCEDIMENTO_EM_USO` quando o
   * procedimento já apareceu numa prescrição/evolução, num orçamento, num combo ou
   * numa execução lançada — e a mensagem dele já diz ONDE e aponta o inativar como
   * saída. Por isso o modal continua ABERTO na recusa: fechá-lo apagaria a
   * explicação junto.
   *
   * ⚠️ `motivo` vai em `data` da config do DELETE — o axios não aceita corpo no
   * segundo argumento (armadilha 33).
   */
  const excluirProc = async (p: Procedimento, motivo: string) => {
    setErroExcluir(null);
    setExcluindoEmCurso(true);
    try {
      await api.delete(`/procedimentos/cadastro/proprio/${p.id}`, { data: { motivo } });
      toast.success('Procedimento excluído.');
      setExcluindoProc(null);
      await carregarProcedimentos(espSel, selEhImagem, filtroAtivoProcs);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroExcluir(e.response?.data?.error ?? 'Erro ao excluir o procedimento.');
    } finally { setExcluindoEmCurso(false); }
  };

  // Busca pelo NOME do combo OU pelo seu CONTEÚDO (nome de qualquer procedimento
  // que o compõe) — sem isso, procurar por um procedimento que só existe dentro
  // de um combo (nunca no nome dele) não achava o combo nenhum.
  const combosFiltrados = useMemo(() => {
    const q = buscaCombos.trim().toLowerCase();
    return combos.filter(c =>
      !q || c.nome.toLowerCase().includes(q)
         || c.itens.some(i => i.procedimento.nome.toLowerCase().includes(q)));
  }, [combos, buscaCombos]);

  // ── Combos (gestor) ───────────────────────────────────────────────────────

  const abrirNovoCombo = async () => {
    setErroCombo(null);
    setComboEditando(null);
    setComboNome(''); setComboEsp(''); setComboValor(''); setComboDesc(''); setComboIds([]); setComboBusca('');
    setComboPrestId(null); setComboValorPrest(null);
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const abrirEdicaoCombo = async (c: Combo) => {
    setErroCombo(null);
    setComboEditando(c);
    setComboNome(c.nome);
    setComboEsp(c.especialidade ?? '');
    setComboValor(numToMask(c.valor));
    setComboDesc(c.descricao ?? '');
    setComboIds(c.itens.map(i => i.procedimento.id));
    setComboBusca('');
    setComboPrestId(c.prestadorId ?? null);
    setComboValorPrest(c.valorPrestador ?? null);
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const salvarCombo = async () => {
    setErroCombo(null);
    if (!comboNome.trim())            { setErroCombo('Nome do combo é obrigatório'); return; }
    if (!comboEsp.trim())             { setErroCombo('Selecione a especialidade do combo'); return; }
    const valorNum = parseBRL(comboValor);
    if (!valorNum || valorNum <= 0)   { setErroCombo('Informe o valor do combo'); return; }
    if (comboIds.length < 2)          { setErroCombo('Selecione pelo menos 2 procedimentos'); return; }
    setSalvandoCombo(true);
    try {
      const payload = {
        nome: comboNome.trim(), especialidade: comboEsp.trim(),
        // `valor` é o VALOR CLIENTE do pacote — o nome do campo é histórico (ver o
        // schema); o que mudou foi só o rótulo na tela.
        valor: valorNum,
        descricao: comboDesc.trim() || undefined,
        procedimentoIds: comboIds,
        // A tela não oferece prestador desde 2026-09-11, mas reenvia o que já está
        // gravado: o backend grava `null` quando o campo não vem, e isso apagaria em
        // silêncio o prestador de um combo antigo ao editar qualquer outro campo.
        prestadorId:    comboPrestId,
        valorPrestador: comboValorPrest,
      };
      if (comboEditando) await api.put(`/procedimentos/cadastro/combos/${comboEditando.id}`, payload);
      else               await api.post('/procedimentos/cadastro/combos', payload);
      toast.success(comboEditando ? 'Combo atualizado' : 'Combo criado');
      setShowCombo(false);
      carregarCombos(filtroAtivoCombos);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroCombo(e.response?.data?.error ?? 'Erro ao salvar combo');
    } finally { setSalvandoCombo(false); }
  };

  const toggleCombo = async (motivo: string) => {
    if (!comboToggle) return;
    try {
      await api.patch(`/procedimentos/cadastro/combos/${comboToggle.id}/toggle`, { motivo });
      toast.success(comboToggle.ativo ? 'Combo inativado' : 'Combo ativado');
      setComboToggle(null);
      carregarCombos(filtroAtivoCombos);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao alterar status do combo');
    }
  };

  const somaItensCombo = useMemo(() =>
    todosProcs.filter(p => comboIds.includes(p.id))
      .reduce((acc, p) => acc + (p.valorEmpresa ?? p.valorVenda ?? 0), 0),
  [todosProcs, comboIds]);

  /**
   * Procedimentos LISTADOS na montagem do combo: os da especialidade escolhida no
   * seletor, filtrados pela busca.
   *
   * O seletor de especialidade tem DOIS papéis: classifica o combo (badge do card,
   * filtro do Orçamento) e escolhe o que aparece nesta lista. Trocar a especialidade
   * troca a lista — e **NÃO limpa o que já foi marcado**: é assim que o combo reúne
   * áreas diferentes (marca em Clínica Médica, troca para Anestesiologia, marca mais).
   * O que está selecionado fora da especialidade atual continua visível e removível
   * nos chips de "Selecionados", logo acima da lista; sem eles, item de outra área
   * ficaria preso no combo sem nenhuma forma de tirar.
   */
  const procsCombo = useMemo(() => {
    if (!comboEsp) return [];
    const q = comboBusca.trim().toLowerCase();
    const daEsp = todosProcs.filter(p => (p.especialidade ?? '') === comboEsp);
    const base = q
      ? daEsp.filter(p => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
      : daEsp;
    return base.slice(0, 60);
  }, [todosProcs, comboBusca, comboEsp]);

  // Tudo que está no combo, de QUALQUER especialidade — a memória da montagem.
  const procsSelecionados = useMemo(
    () => todosProcs.filter(p => comboIds.includes(p.id)),
    [todosProcs, comboIds]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!podeVer) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-16">
        <h2 className="text-lg font-bold text-gray-900">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
      </div>
    </PageContainer>
  );

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500';

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />

      <InlineError message={erroInline} className="mb-4" />

      {/* Cabeçalho no formato de Cadastro > Produtos: título à esquerda, botão de
          incluir à direita.
          ⚠️ A linha "Catálogo por especialidade, valores da empresa e combos" SAIU a
          pedido (2026-09-22): as abas logo abaixo já dizem Procedimentos × Combos, e
          o seletor de Categoria diz o resto. */}
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <ListChecks size={20} className="text-emerald-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Procedimentos</h1>
        </div>
        {/* 🔴 NOVO PROCEDIMENTO (2026-09-22) — substitui o "Cadastrar «X»" que saía do
            campo de busca. O botão antigo daqui era ADMIN-only e escrevia o catálogo
            GLOBAL; este cadastra o procedimento DESTA clínica, que é o que a tela faz.
            ⚠️ Sem "+": o sinal é ruído, e o ícone da ENTIDADE já identifica a ação
                (mesma decisão do "Novo Produto"). */}
        {podeCriar && aba === 'procedimentos' && (
          <button onClick={abrirNovoProc}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
            <ListChecks size={16} /> Novo Procedimento
          </button>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {([
          { key: 'procedimentos', label: 'Procedimentos', icon: <ListChecks size={14} /> },
          { key: 'combos',        label: 'Combos',        icon: <Layers size={14} /> },
        ] as { key: 'procedimentos' | 'combos'; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.key} onClick={() => { setAba(t.key); setBusca(''); setBuscaCombos(''); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              aba === t.key ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-emerald-300'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {aba === 'procedimentos' && (
        <div className="space-y-4">
          {/* Categoria + busca + situação */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
              <div>
                {/* 🔴 "CATEGORIA" (2026-09-22) — era "Especialidade / Exame de imagem".
                    O rótulo é único na tela; quem sabe que por baixo são duas colunas
                    diferentes do banco é o backend (`camposDaCategoria`). */}
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Categoria</label>
                {/* DOIS blocos com cabeçalho: sem eles "Radiografia" apareceria no meio
                    das especialidades clínicas e leria como se fosse uma delas. */}
                <DropdownSelect
                  value={espSel}
                  onChange={setEspSel}
                  grupos={[
                    { label: 'Especialidades',    options: especialidades },
                    { label: 'Exames de imagem',  options: imagemCategorias },
                  ]}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  {/* ⚠️ A busca voltou a ser SÓ BUSCA: o "Cadastrar «X»" que ficava aqui
                      (2026-09-18) saiu a pedido — quem cadastra é o botão do cabeçalho. */}
                  <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Digite o nome do procedimento..." className={`${inputCls} pl-8`} />
                </div>
              </div>
            </div>

            {/* Trio Todos/Ativos/Inativos das demais telas de cadastro — é por ele que
                se alcança o procedimento inativado para reativá-lo. */}
            {podeGerirEmpresa && (
              <div className="mt-3 flex border border-gray-200 rounded-xl overflow-hidden text-sm w-fit">
                {(['all', 'ativo', 'inativo'] as const).map(v => (
                  <button key={v} onClick={() => setFiltroAtivoProcs(v)}
                    className={`px-4 py-2 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                      filtroAtivoProcs === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}>
                    {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
                  </button>
                ))}
              </div>
            )}

            {especialidades.length === 0 && imagemCategorias.length === 0 && (
              <p className="text-xs text-amber-600 mt-3">
                Nenhuma especialidade vinculada ao seu cadastro. Atualize suas especialidades no Cadastro Pessoal.
              </p>
            )}
          </div>

          {/* Lista */}
          {!espSel ? (
            <div className="text-center py-14 text-gray-400 text-sm">Selecione uma categoria para ver os procedimentos.</div>
          ) : loadingProcs ? (
            <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : procsFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              <p>Nenhum procedimento encontrado para {espSel}.</p>
              {/* Não achou? O caminho é cadastrar — e o formulário abre na categoria em
                  que a pessoa já está, para ela não reescolher o que acabou de escolher. */}
              {podeCriar && (
                <button type="button" onClick={abrirNovoProc}
                  className="mt-3 inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
                  <ListChecks size={15} /> Novo Procedimento
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Cabeçalho FIXO no topo, dados rolando por baixo — ver JanelaLista. */}
                <JanelaLista maxItens={12} className="rounded-2xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-3 font-semibold">Procedimento</th>
                      {/* ⚠️ A coluna CATEGORIA saiu (2026-09-22): a lista JÁ é recortada
                          pelo seletor de Categoria logo acima, então a célula repetia o
                          mesmo valor em todas as linhas. */}
                      <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {procsFiltrados.map(p => (
                      <LinhaProcedimento
                        key={p.id}
                        p={p}
                        podeEditar={podeEditar}
                        podeExcluir={podeExcluir}
                        onEditar={abrirEdicaoProc}
                        onAlternar={x => (x.ativo ? setInativandoProc(x) : alternarAtivoProc(x))}
                        onExcluir={abrirExclusaoProc}
                      />
                    ))}
                  </tbody>
                </table>
                </JanelaLista>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                <JanelaLista maxItens={12}>
                  {procsFiltrados.map(p => (
                    <CardProcedimento
                      key={p.id}
                      p={p}
                      podeEditar={podeEditar}
                      podeExcluir={podeExcluir}
                      onEditar={abrirEdicaoProc}
                      onAlternar={x => (x.ativo ? setInativandoProc(x) : alternarAtivoProc(x))}
                      onExcluir={abrirExclusaoProc}
                    />
                  ))}
                </JanelaLista>
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'combos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {podeCriar && (
              <button onClick={abrirNovoCombo}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
                <PackagePlus size={15} /> Novo Combo
              </button>
            )}
            {podeGerirEmpresa && (
              <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
                {(['all', 'ativo', 'inativo'] as const).map(v => (
                  <button key={v} onClick={() => setFiltroAtivoCombos(v)}
                    className={`px-3 py-2 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                      filtroAtivoCombos === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}>
                    {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
                  </button>
                ))}
              </div>
            )}
            {combos.length > 0 && (
              <div className="relative sm:max-w-xs w-full">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input type="text" value={buscaCombos} onChange={e => setBuscaCombos(e.target.value)}
                  placeholder="Buscar combo por nome..." className={`${inputCls} pl-8`} />
              </div>
            )}
          </div>
          {combos.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo cadastrado{podeGerirEmpresa ? ' — crie o primeiro combo de procedimentos da empresa.' : '.'}
            </div>
          ) : combosFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo encontrado para &ldquo;{buscaCombos}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
              {combosFiltrados.map(c => (
                <div key={c.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col ${c.ativo ? 'border-gray-100' : 'border-red-100 opacity-70'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-gray-900 text-sm truncate">{c.nome}</p>
                        {!c.ativo && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 flex-shrink-0">Inativo</span>
                        )}
                      </div>
                      {/* TODAS as especialidades do combo, uma por selo — ver
                          `especialidadesDoCombo`. */}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {especialidadesDoCombo(c).map(esp => (
                          <span key={esp} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            {esp}
                          </span>
                        ))}
                      </div>
                      {c.descricao && <p className="text-[11px] text-gray-400 mt-0.5">{c.descricao}</p>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className="block text-sm font-bold text-emerald-700">{brl(c.valor)}</span>
                      <span className="block text-[10px] text-gray-400">Valor</span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 flex-1">
                    {c.itens.map(i => (
                      <li key={i.id} className="text-xs text-gray-600 flex items-center gap-1.5">
                        <Check size={11} className="text-emerald-500 flex-shrink-0" />
                        <span className="truncate">{i.procedimento.nome}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Ícone no desktop, botão com rótulo no mobile — `AcaoRegistro`. */}
                  {(podeEditar || podeExcluir) && (
                    <AcoesRegistro className="mt-3 pt-2 border-t border-gray-50 md:justify-end">
                      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
                        visivel={podeEditar && c.ativo} onClick={() => abrirEdicaoCombo(c)} />
                      <AcaoRegistro tom="ativar" icone={c.ativo ? ToggleRight : ToggleLeft}
                        rotulo={c.ativo ? 'Inativar' : 'Ativar'}
                        visivel={podeExcluir} onClick={() => setComboToggle(c)} />
                    </AcoesRegistro>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Formulário do procedimento: Categoria · Procedimento · Valor ── */}
      {showProcModal && (
        <ProcedimentoModal
          item={procEditando}
          especialidades={especialidades}
          imagemCategorias={imagemCategorias}
          categoriaInicial={espSel}
          salvando={salvandoProc}
          erro={erroProc}
          onSalvar={salvarProcedimento}
          onFechar={() => { setShowProcModal(false); setProcEditando(null); setErroProc(null); }}
        />
      )}

      {/* ── Modal: combo (gestor) ── */}
      {showCombo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">{comboEditando ? 'Editar Combo' : 'Novo Combo de Procedimentos'}</h3>
              <button onClick={() => setShowCombo(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nome do combo *</label>
                  <input value={comboNome} onChange={e => setComboNome(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Especialidade *</label>
                  {/* DOIS papéis: classifica o combo (badge do card, filtro do Orçamento)
                      e escolhe o que a lista de procedimentos mostra. Trocá-la troca a
                      lista, mas NÃO limpa o que já foi marcado — é assim que se reúnem
                      áreas diferentes no mesmo pacote. */}
                  <DropdownSelect
                    value={comboEsp}
                    onChange={v => { setComboEsp(v); setComboBusca(''); }}
                    options={especialidades}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Valor *</label>
                <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={comboValor}
                  onChange={e => setComboValor(maskBRL(e.target.value))} className={inputCls} />
                {comboIds.length > 0 && somaItensCombo > 0 && (
                  <p className="text-[10px] text-gray-400 mt-1">Soma dos itens avulsos: {brl(somaItensCombo)}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                <input value={comboDesc} onChange={e => setComboDesc(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Procedimentos do combo * <span className="text-gray-400">({comboIds.length} selecionado{comboIds.length !== 1 ? 's' : ''} — mínimo 2)</span>
                </label>
                {/* Selecionados de QUALQUER especialidade. A lista abaixo só mostra a
                    especialidade escolhida no seletor, então sem estes chips o item de
                    outra área ficaria no combo sem forma de conferir nem de remover. */}
                {procsSelecionados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {procsSelecionados.map(p => (
                      <span key={p.id}
                        className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg pl-2 pr-1 py-0.5 text-[11px] max-w-full">
                        <span className="truncate">{p.nome}</span>
                        {p.especialidade && p.especialidade !== comboEsp && (
                          <span className="text-emerald-600/70 whitespace-nowrap">· {p.especialidade}</span>
                        )}
                        <button type="button" title="Remover do combo"
                          onClick={() => setComboIds(prev => prev.filter(i => i !== p.id))}
                          className="p-0.5 text-emerald-600 hover:text-red-600 rounded">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={comboBusca} onChange={e => setComboBusca(e.target.value)}
                    disabled={!comboEsp}
                    placeholder={comboEsp ? 'Buscar procedimento...' : 'Selecione a especialidade primeiro'}
                    className={`${inputCls} pl-8 ${!comboEsp ? 'bg-gray-50 cursor-not-allowed' : ''}`} />
                </div>
                <div className="border border-gray-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-gray-50">
                  {!comboEsp ? (
                    <p className="text-xs text-gray-400 p-3">Selecione a especialidade para listar os procedimentos.</p>
                  ) : procsCombo.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">
                      {comboBusca.trim() ? 'Nenhum procedimento encontrado para a busca.' : `Nenhum procedimento em ${comboEsp}.`}
                    </p>
                  ) : procsCombo.map(p => {
                    const sel = comboIds.includes(p.id);
                    return (
                      <button key={p.id} type="button"
                        onClick={() => setComboIds(prev => sel ? prev.filter(i => i !== p.id) : [...prev, p.id])}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${sel ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${sel ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                          {sel && <Check size={11} className="text-white" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-gray-900 truncate">{p.nome}</span>
                          <span className="block text-[10px] text-gray-400 truncate">
                            {p.categoria} · {brl(p.valorEmpresa ?? p.valorVenda)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Rodapé no padrão da aplicação: ações à DIREITA, tamanho padrão, Cancelar
                ao lado do Salvar. Eram dois botões `flex-1` de largura total — o
                Cancelar com o mesmo peso visual do Salvar. O rótulo é só "Salvar" nos
                dois modos: o que muda é o estado do formulário, não a ação (o título
                do modal já diz se é novo ou edição). */}
            <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowCombo(false)} disabled={salvandoCombo}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
                Cancelar
              </button>
              <button onClick={salvarCombo} disabled={salvandoCombo}
                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
                {salvandoCombo && <Loader2 size={13} className="animate-spin" />}
                {salvandoCombo ? 'Salvando…' : 'Salvar'}
              </button>
            </div>

            {/* Erro ABAIXO do botão que o disparou (CLAUDE.md §6) — estava ACIMA do
                rodapé, e num modal que rola o usuário clicava em Salvar sem ver nada. */}
            {erroCombo && (
              <div className="px-5 pb-5">
                <InlineError message={erroCombo} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Só a INATIVAÇÃO pede justificativa — ativar é correção e vai direto. */}
      <ModalJustificativa
        aberto={inativandoProc !== null}
        titulo="Inativar procedimento"
        descricao={inativandoProc
          ? `O procedimento "${inativandoProc.nome}" deixa de aparecer no Orçamento e na Prescrição desta clínica. Orçamentos e faturas que já o usaram não são alterados. Esta ação será registrada na auditoria.`
          : undefined}
        acaoLabel="Inativar"
        onConfirmar={async motivo => { if (inativandoProc) await alternarAtivoProc(inativandoProc, motivo); }}
        onFechar={() => setInativandoProc(null)}
      />

      {/* Exclusão definitiva — justificativa obrigatória e Auditoria, como toda ação
          destrutiva (§13, armadilha 33). */}
      <ModalJustificativa
        aberto={excluindoProc !== null}
        titulo="Excluir procedimento"
        descricao={excluindoProc
          ? `"${excluindoProc.nome}" será APAGADO do catálogo desta clínica, junto com o valor e os prestadores configurados para ele. Só é possível se ele nunca tiver sido usado — caso contrário, o caminho é inativar.`
          : undefined}
        acaoLabel="Excluir"
        processando={excluindoEmCurso}
        erro={erroExcluir}
        onConfirmar={async motivo => { if (excluindoProc) await excluirProc(excluindoProc, motivo); }}
        onFechar={() => { setExcluindoProc(null); setErroExcluir(null); }}
      />

      <ModalJustificativa
        aberto={comboToggle !== null}
        titulo={comboToggle?.ativo ? 'Inativar combo' : 'Ativar combo'}
        descricao={comboToggle
          ? comboToggle.ativo
            ? `O combo "${comboToggle.nome}" deixa de aparecer no Orçamento e na Prescrição. Orçamentos e faturas que já usaram este combo não são alterados. Esta ação será registrada na auditoria.`
            : `O combo "${comboToggle.nome}" volta a aparecer no Orçamento e na Prescrição.`
          : undefined}
        acaoLabel={comboToggle?.ativo ? 'Inativar' : 'Ativar'}
        onConfirmar={toggleCombo}
        onFechar={() => setComboToggle(null)}
      />
    </PageContainer>
  );
}
