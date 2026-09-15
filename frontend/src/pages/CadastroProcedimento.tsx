// frontend/src/pages/CadastroProcedimento.tsx
// Cadastro > Procedimentos — catálogo por especialidade + preços/combos da empresa.
//   - Seletor de especialidades: vet vê SÓ as suas; GESTOR/ADMIN veem todas.
//   - Incluir procedimento no catálogo: exclusivo do ADMIN.
//   - Empresa (GESTOR): define valor por procedimento e monta combos com valor.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ModalJustificativa from '../components/ModalJustificativa';
import DropdownSelect from '../components/DropdownSelect';
import {
  ListChecks, Search, Pencil, X, Loader2, Check, Layers, PackagePlus, ToggleRight, ToggleLeft,
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

interface FormNovoProc {
  nome: string; categoria: string; especialidade: string; valorVenda: string; descricao: string;
}

const FORM_PROC_INICIAL: FormNovoProc = { nome: '', categoria: '', especialidade: '', valorVenda: '', descricao: '' };

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

// ─── Campo de dinheiro SEMPRE editável ───────────────────────────────────────
/**
 * Valor que se digita direto na grade, sem passar por um lápis (pedido de 2026-09-10).
 *
 * 🔴 NÃO SALVA SOZINHO (pedido de 2026-09-11). Ele é um campo CONTROLADO: quem guarda
 * o texto, compara com o gravado e decide quando gravar é a LINHA (`LinhaProcedimento`
 * / `CardProcedimento`), que mostra Salvar/Cancelar assim que algo difere.
 *
 * ⚠️ REVERTE o auto-save no blur de 10/09. O motivo daquela decisão continua válido —
 * não se dispara um PUT por célula visitada com Tab —, e é justamente por isso que a
 * confirmação virou EXPLÍCITA em vez de voltar a ser automática em outro evento.
 */
function ValorInline({
  texto, onTexto, onEnter, onEsc, placeholder, titulo, className = '', desabilitado,
}: {
  texto: string;
  onTexto: (v: string) => void;
  /** Enter salva a linha — o atalho de quem digita sem tirar a mão do teclado. */
  onEnter?: () => void;
  /** Esc desfaz: sem a volta, quem começou a digitar por engano não tem como cancelar. */
  onEsc?: () => void;
  placeholder?: string;
  titulo?: string;
  className?: string;
  desabilitado?: boolean;
}) {
  return (
    <input
      type="text" inputMode="numeric" title={titulo}
      value={texto} placeholder={placeholder} disabled={desabilitado}
      onChange={e => onTexto(maskBRL(e.target.value))}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); }
        if (e.key === 'Escape') { e.preventDefault(); onEsc?.(); }
      }}
      className={`w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right bg-white
        focus:outline-none focus:border-emerald-500 hover:border-gray-300
        disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
    />
  );
}

// ─── Salvar / Cancelar da linha ──────────────────────────────────────────────
/**
 * Os dois controles que confirmam ou desfazem a edição de uma linha (2026-09-11).
 *
 * 🔴 SAI PELO `AcaoRegistro`, a fonte única da §6: **ícone pintado no desktop, pílula
 * com rótulo no mobile**. Uma versão própria daria dois botões que divergiriam do
 * resto da aplicação na primeira correção — e no celular, sem rótulo, ✓ e ✕ pequenos
 * ao lado de um campo de dinheiro são alvo difícil e ambíguo.
 *
 * ⚠️ Só são RENDERIZADOS quando há alteração pendente (quem decide é a linha). Botão
 * que na maior parte do tempo não faz nada é ruído — e, desabilitado, cairia no cinza
 * que a §6 reserva ao indisponível.
 *
 * ⚠️ NÃO existe "Alterar": os campos já são sempre editáveis, então ele não teria o
 * que destravar (decidido com o usuário em 2026-09-11).
 */
function AcoesEdicao({ onSalvar, onCancelar, salvando }: {
  onSalvar: () => void;
  onCancelar: () => void;
  salvando: boolean;
}) {
  return (
    <AcoesRegistro>
      <AcaoRegistro
        rotulo="Salvar" icone={Check} tom="finalizar"
        titulo="Salvar alterações desta linha"
        onClick={onSalvar} carregando={salvando}
      />
      <AcaoRegistro
        rotulo="Cancelar" icone={X} tom="cancelar"
        titulo="Cancelar — volta ao valor gravado"
        onClick={onCancelar} desabilitado={salvando}
      />
    </AcoesRegistro>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

// ─── Linha da grade (desktop) ────────────────────────────────────────────────
/**
 * A LINHA é quem guarda o texto em edição, compara com o gravado e decide quando
 * gravar (pedido de 2026-09-11). Por isso ela é um componente: dentro de um `.map`
 * não há como ter estado por linha.
 *
 * ⚠️ Ressincroniza quando o valor vem DE FORA (recarga da lista, salvamento de outra
 * linha) — mas só enquanto NÃO há edição pendente: sobrescrever o que a pessoa está
 * digitando porque a lista recarregou é perder trabalho em silêncio.
 */
function LinhaProcedimento({
  p, podeEditar, onSalvarValor,
}: {
  p: Procedimento;
  podeEditar: boolean;
  onSalvarValor: (p: Procedimento, texto: string) => Promise<boolean>;
}) {
  const gravado = numToMask(p.valorEmpresa);
  const [texto, setTexto] = useState(gravado);
  const [salvando, setSalvando] = useState(false);
  const mudou = texto !== gravado;

  useEffect(() => { if (!salvando) setTexto(numToMask(p.valorEmpresa)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.valorEmpresa]);

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    const ok = await onSalvarValor(p, texto);
    setSalvando(false);
    // Falhou: a tela volta a dizer a verdade — nunca fica exibindo número que não gravou.
    if (!ok) setTexto(gravado);
  };

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/60">
      <td className="px-5 py-3">
        <p className="font-medium text-gray-900">{p.nome}</p>
        {p.descricao && <p className="text-[11px] text-gray-400 truncate max-w-md">{p.descricao}</p>}
      </td>
      <td className="px-5 py-3 text-gray-500">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</td>
      <td className="px-5 py-3 text-right">
        {podeEditar ? (
          <ValorInline
            texto={texto}
            onTexto={setTexto}
            onEnter={salvar}
            onEsc={() => setTexto(gravado)}
            placeholder="R$ 0,00"
            titulo="Valor cobrado do cliente por este procedimento"
            desabilitado={salvando}
          />
        ) : (
          <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
            {brl(p.valorEmpresa)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {mudou && (
          <AcoesEdicao onSalvar={salvar} onCancelar={() => setTexto(gravado)} salvando={salvando} />
        )}
      </td>
    </tr>
  );
}

// ─── Card do procedimento (mobile) ───────────────────────────────────────────
/**
 * Espelho do desktop: os mesmos campos, o mesmo par Salvar/Cancelar e a mesma regra de
 * "só aparece quando há alteração pendente".
 *
 * ⚠️ Aqui os ícones ficam JUNTO do bloco de valores, e não numa coluna de ações que o
 * card não tem — mas continuam sendo os mesmos `AcoesEdicao`, para as duas telas não
 * divergirem na primeira correção (armadilha 28-g).
 */
function CardProcedimento({
  p, podeEditar, onSalvarValor,
}: {
  p: Procedimento;
  podeEditar: boolean;
  onSalvarValor: (p: Procedimento, texto: string) => Promise<boolean>;
}) {
  const gravado = numToMask(p.valorEmpresa);
  const [texto, setTexto] = useState(gravado);
  const [salvando, setSalvando] = useState(false);
  const mudou = texto !== gravado;

  useEffect(() => { if (!salvando) setTexto(numToMask(p.valorEmpresa)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.valorEmpresa]);

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    const ok = await onSalvarValor(p, texto);
    setSalvando(false);
    if (!ok) setTexto(gravado);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="font-semibold text-gray-900 text-sm">{p.nome}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</p>

      <div className="flex items-center justify-between gap-2 mt-2 text-xs">
        <span className="text-gray-500">Valor Cliente</span>
        {podeEditar ? (
          <ValorInline
            texto={texto} onTexto={setTexto} onEnter={salvar} onEsc={() => setTexto(gravado)}
            placeholder="R$ 0,00" className="w-24 text-xs" desabilitado={salvando}
          />
        ) : (
          <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
            {brl(p.valorEmpresa)}
          </span>
        )}
      </div>
      {/* ⚠️ As ações do card vão no RODAPÉ, nunca ao lado do campo (§6): com rótulo
          elas espremeriam o valor até ele quebrar de linha. */}
      {mudou && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          <AcoesEdicao onSalvar={salvar} onCancelar={() => setTexto(gravado)} salvando={salvando} />
        </div>
      )}
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

  // 🔴 O LÁPIS SAIU (pedido de 2026-09-10): o valor é campo SEMPRE editável na grade
  // (`ValorInline`); quem confirma é o par Salvar/Cancelar da linha (2026-09-11).

  /**
   * CHEGADA GUIADA — `?especialidade=&busca=<procedimento>` posiciona a tela na
   * especialidade certa e já filtrada pelo procedimento, para quem vem de outra tela
   * não cair numa lista de centenas de linhas.
   */
  const [params] = useSearchParams();
  const espDaUrl      = params.get('especialidade') ?? '';
  const buscaDaUrl    = params.get('busca') ?? '';

  // Modal novo procedimento (ADMIN)
  const [showNovoProc, setShowNovoProc] = useState(false);
  const [formProc,     setFormProc]     = useState<FormNovoProc>(FORM_PROC_INICIAL);
  const [salvandoProc, setSalvandoProc] = useState(false);

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
  // Erros inline: página (lista/valor), modal de novo procedimento e modal de combo
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
  const carregarProcedimentos = useCallback(async (sel: string, ehImagem: boolean) => {
    if (!sel) { setProcedimentos([]); return; }
    setLoadingProcs(true);
    try {
      const params = ehImagem ? { imagemCategoria: sel } : { especialidade: sel };
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
    carregarProcedimentos(espSel, selEhImagem);
  }, [espSel, selEhImagem, loadingPerms, carregarProcedimentos]);

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

  // Busca pelo NOME do combo OU pelo seu CONTEÚDO (nome de qualquer procedimento
  // que o compõe) — sem isso, procurar por um procedimento que só existe dentro
  // de um combo (nunca no nome dele) não achava o combo nenhum.
  const combosFiltrados = useMemo(() => {
    const q = buscaCombos.trim().toLowerCase();
    return combos.filter(c =>
      !q || c.nome.toLowerCase().includes(q)
         || c.itens.some(i => i.procedimento.nome.toLowerCase().includes(q)));
  }, [combos, buscaCombos]);

  // ── Valor da empresa (gestor) ─────────────────────────────────────────────

  /**
   * Valor CLIENTE padrão da empresa. Devolve `true`/`false` para o `ValorInline` saber
   * se pode dar o valor por salvo — falhando, a célula volta ao que o banco tem, em vez
   * de deixar na tela um número que não foi gravado.
   */
  const salvarValorEmpresa = async (p: Procedimento, texto: string): Promise<boolean> => {
    setErroInline(null);
    try {
      const res = await api.put(`/procedimentos/cadastro/valor/${p.id}`, {
        valor: texto.trim() === '' ? null : parseBRL(texto),
      });
      const novo = res.data?.dados?.valorEmpresa ?? null;
      setProcedimentos(prev => prev.map(x => x.id === p.id ? { ...x, valorEmpresa: novo } : x));
      return true;
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao salvar o Valor Cliente');
      return false;
    }
  };

  // ── Novo procedimento (ADMIN) ─────────────────────────────────────────────

  const salvarNovoProc = async () => {
    setErroProc(null);
    if (!formProc.nome.trim())      { setErroProc('Nome é obrigatório'); return; }
    if (!formProc.categoria.trim()) { setErroProc('Categoria é obrigatória'); return; }
    setSalvandoProc(true);
    try {
      await api.post('/procedimentos', {
        nome:          formProc.nome.trim(),
        categoria:     formProc.categoria.trim(),
        especialidade: formProc.especialidade.trim() || null,
        valorVenda:    formProc.valorVenda ? parseBRL(formProc.valorVenda) : null,
        descricao:     formProc.descricao.trim() || null,
      });
      toast.success('Procedimento incluído no catálogo');
      setShowNovoProc(false);
      setFormProc(FORM_PROC_INICIAL);
      if (espSel) carregarProcedimentos(espSel, selEhImagem);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroProc(e.response?.data?.error ?? 'Erro ao incluir procedimento');
    } finally { setSalvandoProc(false); }
  };

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
    if (!valorNum || valorNum <= 0)   { setErroCombo('Informe o Valor Cliente do combo'); return; }
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

      {/* Cabeçalho (mesmo padrão de Agendamentos): ícone em box + título + descritivo */}
      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <ListChecks size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procedimentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Catálogo por especialidade{podeGerirEmpresa ? ', valores da empresa e combos' : ' e combos da empresa'}.
          </p>
        </div>
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
          {/* Seletor de especialidade + busca + novo (ADMIN) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Especialidade / Exame de imagem</label>
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
                  <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Nome ou categoria..." className={`${inputCls} pl-8`} />
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => { setFormProc({ ...FORM_PROC_INICIAL, especialidade: espSel }); setShowNovoProc(true); }}
                  className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                  Novo Procedimento
                </button>
              )}
            </div>
            {especialidades.length === 0 && imagemCategorias.length === 0 && (
              <p className="text-xs text-amber-600 mt-3">
                Nenhuma especialidade vinculada ao seu cadastro. Atualize suas especialidades no Cadastro Pessoal.
              </p>
            )}
          </div>

          {/* Lista */}
          {!espSel ? (
            <div className="text-center py-14 text-gray-400 text-sm">Selecione uma especialidade para ver os procedimentos.</div>
          ) : loadingProcs ? (
            <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : procsFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum procedimento encontrado para {espSel}.
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto rounded-2xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-3 font-semibold">Procedimento</th>
                      <th className="px-5 py-3 font-semibold">Categoria</th>
                      <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor Cliente</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {procsFiltrados.map(p => (
                      <LinhaProcedimento
                        key={p.id}
                        p={p}
                        podeEditar={podeEditar}
                        onSalvarValor={salvarValorEmpresa}
                      />
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {procsFiltrados.map(p => (
                  <CardProcedimento
                    key={p.id}
                    p={p}
                    podeEditar={podeEditar}
                    onSalvarValor={salvarValorEmpresa}
                  />
                ))}
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
                      <span className="block text-[10px] text-gray-400">Valor Cliente</span>
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

      {/* ── Modal: novo procedimento (ADMIN) ── */}
      {showNovoProc && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">Novo Procedimento (catálogo)</h3>
              <button onClick={() => setShowNovoProc(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome *</label>
                <input value={formProc.nome} onChange={e => setFormProc(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Categoria *</label>
                  <input value={formProc.categoria} onChange={e => setFormProc(f => ({ ...f, categoria: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor padrão</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={formProc.valorVenda}
                    onChange={e => setFormProc(f => ({ ...f, valorVenda: maskBRL(e.target.value) }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Especialidade</label>
                <DropdownSelect
                  value={formProc.especialidade}
                  onChange={especialidade => setFormProc(f => ({ ...f, especialidade }))}
                  options={especialidades}
                  placeholder="— Sem especialidade —"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                <textarea value={formProc.descricao} onChange={e => setFormProc(f => ({ ...f, descricao: e.target.value }))}
                  rows={3} className={inputCls} />
              </div>
            </div>
            <InlineError message={erroProc} className="mx-5 mt-3" />

            <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowNovoProc(false)} disabled={salvandoProc}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarNovoProc} disabled={salvandoProc}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                {salvandoProc && <Loader2 size={13} className="animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
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
                <label className="block text-xs text-gray-500 mb-1">Valor Cliente *</label>
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
