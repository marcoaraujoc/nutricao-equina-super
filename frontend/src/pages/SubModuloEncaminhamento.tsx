// src/pages/SubModuloEncaminhamento.tsx
// Encaminhamentos clínicos — destino interno (prestador da equipe, ex: quiroprata,
// ferrador) ou externo (texto livre). Encaminhar para prestador da equipe libera o
// acesso dele a ESTE animal (DesignacaoPrestador); concluir/cancelar encerra o acesso.
//
// No destino EXTERNO a especialidade é um COMBOBOX, não um <select> fechado: quem é de
// fora pode ter uma área que o catálogo da clínica não cobre (quiropraxia, acupuntura,
// odontologia equina...), e ali o campo obrigatório virava beco sem saída. O que se
// digita e não existe é cadastrado no catálogo DA CLÍNICA ao encaminhar
// (`lib/catalogoManual.js#garantirEspecialidadeDaEmpresa`, `empresa_id` setado — nunca
// global), então na próxima vez já aparece na lista dela e de mais ninguém.

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import {
  Share2, Loader2, Check, Ban, CheckSquare,
  UserCheck, ExternalLink, ShieldCheck, AlertTriangle, FileText,
  ChevronLeft, ChevronRight, MessageCircle, Mail,
} from 'lucide-react';
import api from '../services/api';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import { usePermissoes } from '../hooks/usePermissoes';
import ModalJustificativa from '../components/ModalJustificativa';
import ErroAcao, { classeErro, temErro, type ErroAcaoDados } from '../components/ErroAcao';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';


// ─── Types ────────────────────────────────────────────────────────────────────

type StatusEnc   = 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO';
type Urgencia    = 'NORMAL' | 'ALTA' | 'URGENTE';
type DestinoTipo = 'EQUIPE' | 'EXTERNO';
// Campo culpado na validação do formulário novo — vira `ErroAcaoDados.campos`, que é o
// que `classeErro` usa para destacar a borda do input.
type CampoForm   = 'especialidade' | 'prestador' | 'profissional' | 'motivo';

interface Prestador {
  userId:      number;
  fullName:    string;
  email:       string;
  phone:       string | null;
  tipoServico: string | null;
  /** Serviços/especialidades individuais (tipoServico legado + catálogo do usuário) */
  servicos?:   string[];
  /** FORNECEDOR (true) ganha acesso ao animal via designação; VETERINARIO (false) já tem acesso de equipe */
  precisaDesignacao?: boolean;
  jaDesignado: boolean;
}

// Serviços do prestador como lista — usa `servicos` do backend; fallback: CSV do tipoServico
const servicosDoPrestador = (p: Prestador): string[] =>
  p.servicos ?? (p.tipoServico ? p.tipoServico.split(',').map(s => s.trim()).filter(Boolean) : []);

interface Encaminhamento {
  id:                 number;
  especialidade:      string;
  motivo:             string;
  veterinarioDestino: string | null;
  clinicaDestino:     string | null;
  urgencia:           Urgencia;
  status:             StatusEnc;
  dataEncaminhamento: string;
  observacao:         string | null;
  prestadorId:        number | null;
  prestador:          { id: number; fullName: string } | null;
  veterinario:        { id: number; fullName: string } | null;
  // Justificativa do CANCELAMENTO (não confundir com `motivo`, que é o motivo do
  // ENCAMINHAMENTO em si). O registro não tem coluna própria — o backend a resolve
  // a partir do AuditLog na listagem, só para os `status === 'CANCELADO'`.
  justificativaCancelamento?: string | null;
}

interface Props {
  animalId:           number;
  evolucaoId?:        number;
  /** Evolução ativa existe, mas pertence a OUTRO profissional (não assumida por
   *  mim, e eu não sou gestor) — bloqueia a CRIAÇÃO de encaminhamento nela. O
   *  backend já recusa com 403 (EncaminhamentoController.criar); isto só evita o
   *  formulário inteiro preenchido pra falhar no fim. */
  evolucaoDeOutro?:   boolean;
  atendimentoNumero?: string;
  onSalvo?:           () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// O STATUS deixou de ser EXIBIDO nesta tela (badge do card e coluna da tabela saíram
// a pedido). O campo continua existindo e governando o comportamento — só encaminhamento
// PENDENTE pode ser cancelado, e é ele que mantém a designação do prestador ativa.
// Não reintroduzir a exibição sem pedido.

const URGENCIA_BADGE: Record<Urgencia, { label: string; cls: string }> = {
  NORMAL:  { label: 'Normal',  cls: 'bg-gray-100 text-gray-500' },
  ALTA:    { label: 'Alta',    cls: 'bg-amber-100 text-amber-700' },
  URGENTE: { label: 'Urgente', cls: 'bg-red-100 text-red-700' },
};

const formatData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ─── Helpers de item ──────────────────────────────────────────────────────────

const getDestino = (enc: Encaminhamento): { destino: string; interno: boolean } => {
  const interno = !!enc.prestador;
  const destino = interno
    ? enc.prestador!.fullName
    : [enc.veterinarioDestino, enc.clinicaDestino].filter(Boolean).join(' — ') || 'Não informado';
  return { destino, interno };
};

const montarTextoEncaminhamento = (enc: Encaminhamento): string => {
  const { destino, interno } = getDestino(enc);
  const urgencia = URGENCIA_BADGE[enc.urgencia] ?? URGENCIA_BADGE.NORMAL;
  return [
    '*Encaminhamento*',
    `Especialidade: ${enc.especialidade}`,
    `Destino: ${destino}${interno ? ' (prestador da equipe)' : ' (externo)'}`,
    enc.urgencia !== 'NORMAL' ? `Urgência: ${urgencia.label}` : '',
    `Data: ${formatData(enc.dataEncaminhamento)}`,
    enc.veterinario ? `Responsável: ${enc.veterinario.fullName}` : '',
    enc.motivo ? `\nMotivo: ${enc.motivo}` : '',
    enc.observacao ? `Obs: ${enc.observacao}` : '',
  ].filter(Boolean).join('\n');
};

// ─── Ações do encaminhamento — UMA declaração para o card e para a tabela ──────
// `AcaoRegistro` decide a forma por CSS (ícone no desktop, botão com rótulo no
// mobile), então card e linha renderizam o MESMO componente. Antes eram duas listas
// idênticas em dois componentes — e divergiam a cada correção.
function AcoesEncaminhamento({ enc, podeEditar, podeFinalizar, podeCompartilhar, finalizando, onStatus, onFinalizar }: {
  enc:              Encaminhamento;
  podeEditar:       boolean;
  podeFinalizar:    boolean;
  podeCompartilhar: boolean;
  finalizando:      boolean;
  onStatus:         (id: number, status: 'CANCELADO') => void;
  onFinalizar:      (id: number) => void;
}) {
  const texto = montarTextoEncaminhamento(enc);
  return (
    <AcoesRegistro>
      <AcaoRegistro tom="finalizar" icone={CheckSquare} rotulo="Concluir"
        visivel={enc.status === 'PENDENTE' && podeFinalizar} carregando={finalizando}
        onClick={() => onFinalizar(enc.id)} />
      {/* Compartilhar é saída de conteúdo do sistema: segue IMPRIMIR */}
      <AcaoRegistro tom="whatsapp" icone={MessageCircle} rotulo="WhatsApp"
        visivel={podeCompartilhar} onClick={() => abrirWhatsApp(texto)} />
      <AcaoRegistro tom="email" icone={Mail} rotulo="E-mail"
        visivel={podeCompartilhar}
        onClick={() => abrirEmail(`Encaminhamento - ${enc.especialidade}`, texto)} />
      <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar"
        visivel={enc.status === 'PENDENTE' && podeEditar}
        onClick={() => onStatus(enc.id, 'CANCELADO')} />
    </AcoesRegistro>
  );
}

// ─── Card mobile (padrão do Histórico de Evolução Clínica) ─────────────────────

function EncaminhamentoCard({ enc, podeEditar, podeFinalizar, podeCompartilhar, finalizando, erro, onStatus, onFinalizar }: {
  enc:              Encaminhamento;
  podeEditar:       boolean;
  podeFinalizar:    boolean;
  podeCompartilhar: boolean;
  finalizando:      boolean;
  /** Erro da ação DESTA linha (concluir/cancelar) — ver `erroDaLinha` no pai. */
  erro:             ErroAcaoDados | null;
  onStatus:         (id: number, status: 'CANCELADO') => void;
  onFinalizar:      (id: number) => void;
}) {
  const urgencia = URGENCIA_BADGE[enc.urgencia] ?? URGENCIA_BADGE.NORMAL;
  const { destino, interno } = getDestino(enc);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-900 truncate">{enc.especialidade}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {enc.urgencia !== 'NORMAL' && (
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${urgencia.cls}`}>{urgencia.label}</span>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        {interno
          ? <UserCheck size={12} className="text-emerald-600 flex-shrink-0" />
          : <ExternalLink size={12} className="text-gray-400 flex-shrink-0" />}
        <span className="truncate">{destino}</span>
        <span className="text-[10px] text-gray-400 flex-shrink-0">{interno ? '· prestador' : '· externo'}</span>
      </p>

      {enc.motivo && <p title={enc.motivo} className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{enc.motivo}</p>}
      {enc.status === 'CANCELADO' && enc.justificativaCancelamento && (
        <p className="text-[11px] text-gray-400 mt-0.5">
          Justificativa:{' '}
          <JustificativaCancelamento texto={enc.justificativaCancelamento} className="inline-block align-bottom max-w-[70vw]" />
        </p>
      )}

      {interno && enc.status === 'PENDENTE' && (
        <p className="flex items-center gap-1 mt-1 text-[11px] text-emerald-700">
          <ShieldCheck size={12} className="flex-shrink-0" /> Prestador com acesso a este paciente
        </p>
      )}

      <p className="text-[11px] text-gray-400 mt-0.5">
        {formatData(enc.dataEncaminhamento)}{enc.veterinario ? ` • ${enc.veterinario.fullName}` : ''}
      </p>

      <div className="mt-2">
        <AcoesEncaminhamento
          enc={enc} podeEditar={podeEditar} podeFinalizar={podeFinalizar}
          podeCompartilhar={podeCompartilhar} finalizando={finalizando}
          onStatus={onStatus} onFinalizar={onFinalizar}
        />
      </div>

      <ErroAcao erro={erro} className="mt-2" />
    </div>
  );
}

// ─── Linha da tabela desktop (padrão do Histórico de Evolução Clínica) ─────────

function EncaminhamentoRow({ enc, podeEditar, podeFinalizar, podeCompartilhar, finalizando, onStatus, onFinalizar }: {
  enc:              Encaminhamento;
  podeEditar:       boolean;
  podeFinalizar:    boolean;
  podeCompartilhar: boolean;
  finalizando:      boolean;
  onStatus:         (id: number, status: 'CANCELADO') => void;
  onFinalizar:      (id: number) => void;
}) {
  const urgencia = URGENCIA_BADGE[enc.urgencia] ?? URGENCIA_BADGE.NORMAL;
  const { destino, interno } = getDestino(enc);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
        {formatData(enc.dataEncaminhamento)}
      </td>
      <td className="px-4 py-3 text-gray-800 max-w-xs">
        <p className="text-xs font-medium text-gray-800 line-clamp-2">{enc.especialidade}</p>
        {enc.urgencia !== 'NORMAL' && (
          <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgencia.cls}`}>
            {urgencia.label}
          </span>
        )}
        {enc.motivo && <p title={enc.motivo} className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{enc.motivo}</p>}
      </td>
      <td className="px-4 py-3">
        {enc.status === 'CANCELADO'
          ? <JustificativaCancelamento texto={enc.justificativaCancelamento} />
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3 max-w-[180px]">
        <p className="flex items-center gap-1.5 text-xs text-gray-700">
          {interno
            ? <UserCheck size={12} className="text-emerald-600 flex-shrink-0" />
            : <ExternalLink size={12} className="text-gray-400 flex-shrink-0" />}
          <span className="truncate">{destino}</span>
        </p>
        <span className="text-[10px] text-gray-400">{interno ? 'prestador da equipe' : 'externo'}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <p className="text-xs font-medium text-gray-800">{enc.veterinario?.fullName ?? '—'}</p>
      </td>
      <td className="px-4 py-3">
        <AcoesEncaminhamento
          enc={enc} podeEditar={podeEditar} podeFinalizar={podeFinalizar}
          podeCompartilhar={podeCompartilhar} finalizando={finalizando}
          onStatus={onStatus} onFinalizar={onFinalizar}
        />
      </td>
    </tr>
  );
}

// ─── Formulário de novo encaminhamento ────────────────────────────────────────

// ─── ComboEspecialidade ───────────────────────────────────────────────────────
// Campo de especialidade que ACEITA texto novo. Sugere o catálogo enquanto se digita,
// e avisa quando o que está escrito ainda não existe — o cadastro em si acontece no
// backend, ao encaminhar, no catálogo da própria clínica.

const semAcento = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function ComboEspecialidade({ valor, opcoes, erro, onChange, inputRef }: {
  valor:     string;
  opcoes:    string[];
  erro:      boolean;
  onChange:  (v: string) => void;
  inputRef:  React.MutableRefObject<HTMLElement | null>;
}) {
  const [aberto, setAberto] = useState(false);

  const jaExiste = opcoes.some(o => semAcento(o) === semAcento(valor));
  // Texto que É exatamente uma opção não filtra nada: senão, escolhida a especialidade,
  // a lista ficaria com um item só e não haveria como trocar sem apagar o campo antes.
  const sugestoes = (!valor.trim() || jaExiste)
    ? opcoes
    : opcoes.filter(o => semAcento(o).includes(semAcento(valor)));

  const ehNova = valor.trim().length > 0 && !jaExiste;

  return (
    <div className="relative">
      <input
        type="text"
        ref={el => { inputRef.current = el; }}
        value={valor}
        onChange={e => { onChange(e.target.value); setAberto(true); }}
        // `onClick` ALÉM de `onFocus`: a opção é escolhida num onMouseDown com
        // preventDefault, então o foco nunca sai do input — e `focus` não dispara de
        // novo num campo já focado. Só com onFocus, clicar no campo depois de escolher
        // não reabriria a lista.
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        placeholder="Digite ou escolha — ex: Quiropraxia, Oftalmologia..."
        className={`w-full border rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 ${erro ? 'border-red-400' : 'border-gray-200'}`}
      />

      {aberto && sugestoes.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {sugestoes.map(s => (
            <button
              key={s}
              type="button"
              // preventDefault mantém o foco no input: sem isso o blur fecharia a lista
              // antes de o clique chegar na opção.
              onMouseDown={e => { e.preventDefault(); onChange(s); setAberto(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 ${
                semAcento(s) === semAcento(valor) ? 'text-emerald-700 font-medium' : 'text-gray-700'
              }`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {ehNova && (
        <p className="mt-1 text-[11px] text-emerald-700">
          Nova especialidade — será cadastrada no catálogo da sua clínica ao encaminhar.
        </p>
      )}
    </div>
  );
}

function FormNovoEncaminhamento({ animalId, evolucaoId, onCriado, onFechar }: {
  animalId:    number;
  evolucaoId?: number;
  onCriado:    () => void;
  onFechar:    () => void;
}) {
  const [prestadores,         setPrestadores]         = useState<Prestador[]>([]);
  const [servicosDisponiveis, setServicosDisponiveis] = useState<string[]>([]);
  // Erro de AÇÃO (`components/ErroAcao`): a mensagem mora no rodapé, junto do botão que
  // a disparou, e `campos` diz qual input destacar. `InlineError` fica para o erro de
  // CARGA, no topo da página — é a divisão que o componente documenta.
  const [erro, setErro] = useState<ErroAcaoDados | null>(null);
  const [especialidadesBanco, setEspecialidadesBanco] = useState<string[]>([]);
  const [loadingPrest,        setLoadingPrest]        = useState(true);
  const [destinoTipo,         setDestinoTipo]         = useState<DestinoTipo>('EQUIPE');
  const [filtroServico,       setFiltroServico]       = useState('');
  const [prestadorSel,        setPrestadorSel]        = useState<Prestador | null>(null);
  const [especialidade,  setEspecialidade]  = useState('');
  const [motivo,         setMotivo]         = useState('');
  const [urgencia,       setUrgencia]       = useState<Urgencia>('NORMAL');
  const [observacao,     setObservacao]     = useState('');
  const [vetDestino,     setVetDestino]     = useState('');
  const [clinicaDestino, setClinicaDestino] = useState('');
  const [salvando,       setSalvando]       = useState(false);
  const refEspecEquipe  = useRef<HTMLSelectElement>(null);
  const refEspecExterno = useRef<HTMLElement | null>(null);
  const refProfissional = useRef<HTMLInputElement>(null);
  const refMotivo       = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoadingPrest(true);
      try {
        const res = await api.get(`/clinica/encaminhamentos/prestadores/${animalId}`);
        if (cancelado) return;
        if (!res.data) { setPrestadores([]); setServicosDisponiveis([]); return; } // GET 403 → null
        setPrestadores(res.data.dados ?? []);
        setServicosDisponiveis(res.data.servicosDisponiveis ?? []);
      } catch { if (!cancelado) { setPrestadores([]); setServicosDisponiveis([]); } }
      finally { if (!cancelado) setLoadingPrest(false); }
    })();
    // Catálogo de especialidades do banco (tb_especialidades) — alimenta o campo
    // Especialidade além dos serviços dos prestadores da equipe
    (async () => {
      try {
        const res = await api.get('/especialidades');
        if (cancelado || !res.data) return;
        const nomes = ((res.data?.dados ?? []) as { nome: string }[]).map(e => e.nome);
        setEspecialidadesBanco([...new Set(nomes)]);
      } catch { /* silencioso */ }
    })();
    return () => { cancelado = true; };
  }, [animalId]);

  // União: especialidades do catálogo (banco) + serviços dos prestadores da equipe
  const servicos = useMemo(() =>
    [...new Set([...servicosDisponiveis, ...especialidadesBanco])]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [servicosDisponiveis, especialidadesBanco]);

  const prestadoresFiltrados = filtroServico
    ? prestadores.filter(p => servicosDoPrestador(p).includes(filtroServico))
    : [];

  // Um único prestador disponível → pré-seleciona
  useEffect(() => {
    if (!loadingPrest && destinoTipo === 'EQUIPE' && prestadoresFiltrados.length === 1 && !prestadorSel) {
      selecionarPrestador(prestadoresFiltrados[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPrest, destinoTipo, filtroServico]);

  const selecionarPrestador = (p: Prestador) => {
    setPrestadorSel(p);
    // Prioriza a especialidade filtrada; senão a primeira do prestador
    const servs = servicosDoPrestador(p);
    if (filtroServico && servs.includes(filtroServico)) setEspecialidade(filtroServico);
    else if (servs.length > 0) setEspecialidade(servs[0]);
  };

  // A mensagem fica junto do botão, mas o campo culpado pode estar fora da dobra num
  // formulário longo — por isso ele também recebe o foco.
  const reprovar = (campo: CampoForm, mensagem: string, el: HTMLElement | null) => {
    setErro({ mensagem, campos: [campo] });
    el?.scrollIntoView({ block: 'nearest' });
    el?.focus();
  };

  const handleSalvar = async () => {
    if (!evolucaoId) { setErro({ mensagem: 'Inicie uma evolução antes de criar um encaminhamento.' }); return; }

    // Para EQUIPE, a especialidade escolhida no filtro já conta como "informada" mesmo
    // que `especialidade` (setada só ao clicar num prestador) ainda esteja vazia —
    // evita o erro "Informe a especialidade" quando o usuário já selecionou no filtro.
    const especialidadeEfetiva = especialidade.trim() || filtroServico.trim();

    // Validação NA ORDEM DOS CAMPOS na tela: quem corrige lê o formulário de cima para
    // baixo, e apontar primeiro o motivo (que é o último campo) mandava a pessoa para o
    // fim da tela antes de ela saber que a especialidade também faltava.
    if (!especialidadeEfetiva) {
      reprovar('especialidade', 'Informe a especialidade',
        destinoTipo === 'EQUIPE' ? refEspecEquipe.current : refEspecExterno.current);
      return;
    }
    if (destinoTipo === 'EQUIPE' && !prestadorSel) {
      reprovar('prestador', 'Selecione o prestador da equipe', refEspecEquipe.current);
      return;
    }
    // Profissional é OBRIGATÓRIO no destino EXTERNO: sem o nome, o encaminhamento não
    // registra PARA QUEM o paciente foi. A clínica segue opcional (pode ser autônomo).
    if (destinoTipo === 'EXTERNO' && !vetDestino.trim()) {
      reprovar('profissional', 'Informe o profissional de destino', refProfissional.current);
      return;
    }
    if (!motivo.trim()) {
      reprovar('motivo', 'Informe o motivo do encaminhamento', refMotivo.current);
      return;
    }

    setSalvando(true);
    try {
      await api.post('/clinica/encaminhamentos', {
        animalId,
        evolucaoId,
        especialidade:      especialidadeEfetiva,
        motivo:             motivo.trim(),
        urgencia,
        observacao:         observacao.trim() || undefined,
        prestadorId:        destinoTipo === 'EQUIPE' ? prestadorSel?.userId : undefined,
        veterinarioDestino: destinoTipo === 'EXTERNO' ? vetDestino.trim() || undefined : undefined,
        clinicaDestino:     destinoTipo === 'EXTERNO' ? clinicaDestino.trim() || undefined : undefined,
      });
      toast.success(
        destinoTipo === 'EQUIPE'
          ? (prestadorSel?.precisaDesignacao !== false
              ? `Encaminhado para ${prestadorSel?.fullName} — acesso ao paciente liberado`
              : `Encaminhado para ${prestadorSel?.fullName}`)
          : 'Encaminhamento registrado');
      onCriado();
    } catch (err) {
      // A mensagem do backend vence a genérica — é ela que diz QUAL regra reprovou
      // (destino obrigatório, evolução de outro, paciente inativo...).
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErro({ mensagem: e.response?.data?.error ?? 'Erro ao criar encaminhamento' });
    } finally { setSalvando(false); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">

      {/* Alterou qualquer campo → o erro anterior some (change borbulha) */}
      <div className="p-5 space-y-4"
        onChange={() => setErro(null)}
        onInput={() => setErro(null)}>

      {/* Tipo de destino */}
      <div className="flex gap-2">
        {([
          { key: 'EQUIPE',  label: 'Prestador da equipe', icon: <UserCheck size={13} /> },
          { key: 'EXTERNO', label: 'Profissional externo', icon: <ExternalLink size={13} /> },
        ] as { key: DestinoTipo; label: string; icon: React.ReactNode }[]).map(opt => (
          <button key={opt.key} onClick={() => { setDestinoTipo(opt.key); setPrestadorSel(null); setEspecialidade(''); setFiltroServico(''); setErro(null); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
              destinoTipo === opt.key
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
            }`}>
            {opt.icon}{opt.label}
          </button>
        ))}
      </div>

      {/* ⚠️ As duas pernas levam `key` PRÓPRIA. Sem ela o React reconcilia por posição,
          reusa o mesmo nó DOM entre os ramos e o <select> de especialidade da equipe
          (value=filtroServico) vira o campo do externo (value=especialidade) — foi o que
          fazia o campo, depois de trocar de destino, não exibir o que se acabou de
          escolher. */}
      {destinoTipo === 'EQUIPE' ? (
        <div key="destino-equipe" className="space-y-3">
          {/* Seletor de especialidade — lista só aparece após selecionar */}
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Especialidade</label>
            <select ref={refEspecEquipe} value={filtroServico}
              onChange={e => { setFiltroServico(e.target.value); setPrestadorSel(null); }}
              aria-invalid={temErro(erro, 'especialidade') || temErro(erro, 'prestador')}
              className={classeErro(
                temErro(erro, 'prestador') ? { mensagem: '', campos: ['especialidade'] } : erro,
                'especialidade',
                `w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600 ${!filtroServico ? 'text-gray-400' : 'text-gray-900'}`,
              )}>
              <option value="">— Selecionar —</option>
              {servicos.map(s => <option key={s} value={s} className="text-gray-900">{s}</option>)}
            </select>
          </div>

          {/* Lista de prestadores — só aparece após selecionar especialidade */}
          {filtroServico && (
            loadingPrest ? (
              <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-emerald-600" /></div>
            ) : prestadoresFiltrados.length === 0 ? (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Nenhum profissional com a especialidade {filtroServico} na equipe deste paciente.
                  Cadastre a especialidade no profissional (Cadastro Pessoal) ou inclua um
                  fornecedor pela aba Equipe do Controle de Acesso e tente novamente.
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {prestadoresFiltrados.map(p => (
                  <button key={p.userId} onClick={() => selecionarPrestador(p)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      prestadorSel?.userId === p.userId
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 bg-white hover:border-emerald-300'
                    }`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.fullName}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {p.tipoServico ?? 'Especialidade não informada'}
                        {p.phone ? ` · ${p.phone}` : ''}
                      </p>
                    </div>
                    {p.jaDesignado && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">
                        já tem acesso
                      </span>
                    )}
                    {prestadorSel?.userId === p.userId && (
                      <Check size={15} className="text-emerald-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )
          )}

          {prestadorSel && prestadorSel.precisaDesignacao !== false && !prestadorSel.jaDesignado && (
            <div className="flex items-start gap-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
              <ShieldCheck size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Ao salvar, <strong>{prestadorSel.fullName}</strong> passa a acessar somente este paciente.
                O acesso é encerrado quando o encaminhamento for concluído ou cancelado.
              </span>
            </div>
          )}

          {prestadorSel && prestadorSel.precisaDesignacao === false && (
            <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              <UserCheck size={13} className="flex-shrink-0 mt-0.5 text-emerald-600" />
              <span>
                <strong>{prestadorSel.fullName}</strong> é veterinário da equipe e já tem acesso a este paciente.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div key="destino-externo" className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Especialidade *</label>
            <ComboEspecialidade
              valor={especialidade}
              opcoes={servicos}
              erro={temErro(erro, 'especialidade')}
              onChange={v => { setEspecialidade(v); setErro(null); }}
              inputRef={refEspecExterno}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Profissional *</label>
              <input type="text" ref={refProfissional} value={vetDestino} onChange={e => setVetDestino(e.target.value)}
                placeholder="Nome do profissional"
                aria-invalid={temErro(erro, 'profissional')}
                className={classeErro(erro, 'profissional',
                  'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600')} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Clínica</label>
              <input type="text" value={clinicaDestino} onChange={e => setClinicaDestino(e.target.value)}
                placeholder="Nome da clínica"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Motivo *</label>
        <textarea ref={refMotivo} value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
          placeholder="Descreva o motivo do encaminhamento..."
          aria-invalid={temErro(erro, 'motivo')}
          className={classeErro(erro, 'motivo',
            'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 resize-none')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Urgência</label>
          <select value={urgencia} onChange={e => setUrgencia(e.target.value as Urgencia)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600">
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
            <option value="URGENTE">Urgente</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Observação</label>
          <input type="text" value={observacao} onChange={e => setObservacao(e.target.value)}
            placeholder="Opcional"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
        </div>
      </div>

        </div>

      <div className="px-5 py-4 border-t border-gray-100 space-y-3">
      <ErroAcao erro={erro} />
      <div className="flex justify-end gap-2">
        <button onClick={onFechar}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-2xl transition-colors">
          Cancelar
        </button>
        <button onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          Encaminhar
        </button>
      </div>
      </div>

    </div>
  );
}

// ─── SubModuloEncaminhamento ──────────────────────────────────────────────────

export default function SubModuloEncaminhamento({ animalId, evolucaoId, evolucaoDeOutro, onSalvo }: Props) {
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar   = isGestor || podeExecutar('atendimento.encaminhamentos.criar');
  const podeEditar  = isGestor || podeExecutar('atendimento.encaminhamentos.editar');
  // Concluir é uma ação PRÓPRIA (`atendimento.encaminhamentos.finalizar`) — não pode
  // herdar de `editar`, senão o Controle de Acesso deixa de ter efeito: um perfil com
  // Editar liberado e Finalizar negado (ou vice-versa) precisa dos dois resultados
  // distintos na tela, exatamente como já acontece em Evolução/Prescrição/Vacina/Exames.
  const podeFinalizar = isGestor || podeExecutar('atendimento.encaminhamentos.finalizar');
  // WhatsApp/e-mail tiram o conteúdo do sistema — mesmo gate do IMPRIMIR.
  const podeCompartilhar = isGestor || podeExecutar('atendimento.encaminhamentos.imprimir');
  // FORNECEDOR só cancela/edita/finaliza encaminhamentos que ele próprio criou

  const [encaminhamentos, setEncaminhamentos] = useState<Encaminhamento[]>([]);
  const [loading,          setLoading]         = useState(true);
  const [formKey,          setFormKey]         = useState(0);
  const [cancelandoId,     setCancelandoId]    = useState<number | null>(null);
  const [finalizandoId,    setFinalizandoId]   = useState<number | null>(null);
  const [page,             setPage]            = useState(1);
  // Erro de AÇÃO, guardado com o id da LINHA que o disparou — concluir e cancelar são
  // ações de uma linha específica, e a mensagem no topo da página deixaria o usuário
  // sem saber a qual encaminhamento ela se refere. Mesmo padrão da tela de Vacina.
  const [erroLinha, setErroLinha] = useState<{ id: number; dados: ErroAcaoDados } | null>(null);
  const erroDaLinha = (id: number) => (erroLinha?.id === id ? erroLinha.dados : null);

  const semPermissao = (id: number, acao: string) =>
    setErroLinha({ id, dados: { mensagem: `Sem permissão para ${acao}. Verifique com o responsável da equipe.` } });

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/clinica/encaminhamentos/animal/${animalId}`);
      if (!res.data) { setEncaminhamentos([]); return; } // GET 403 → null
      setEncaminhamentos(res.data.dados ?? []);
    } catch { setEncaminhamentos([]); }
    finally { setLoading(false); }
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregar();
  }, [carregar, loadingPerms]);

  useEffect(() => { setPage(1); }, [animalId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  // Cancelamento — rota /status, gateada por `atendimento.encaminhamentos.editar`.
  const handleStatus = async (id: number, status: 'CANCELADO', motivo?: string) => {
    if (!podeEditar) { semPermissao(id, 'alterar encaminhamentos'); return; }
    // Exige justificativa — abre o modal e retorna aqui com o motivo
    if (!motivo) { setCancelandoId(id); return; }
    setErroLinha(null);
    try {
      await api.patch(`/clinica/encaminhamentos/${id}/status`, { status, motivo });
      const enc = encaminhamentos.find(e => e.id === id);
      toast(enc?.prestador
        ? 'Encaminhamento cancelado — acesso do prestador encerrado'
        : 'Encaminhamento cancelado', { icon: '🔒' });
      carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) {
        setErroLinha({ id, dados: { mensagem: e.response?.data?.error ?? 'Erro ao atualizar encaminhamento' } });
      }
    } finally {
      setCancelandoId(null);
    }
  };

  // Concluir — rota PRÓPRIA /finalizar, gateada por `atendimento.encaminhamentos.finalizar`
  // (mesmo padrão de Evolução/Prescrição/Vacina/Exames: não reusa a rota /status,
  // que é do `editar` — senão o Controle de Acesso deixaria de valer para esta ação).
  const handleFinalizar = async (id: number) => {
    if (!podeFinalizar) { semPermissao(id, 'finalizar encaminhamentos'); return; }
    setErroLinha(null);
    setFinalizandoId(id);
    try {
      await api.patch(`/clinica/encaminhamentos/${id}/finalizar`);
      const enc = encaminhamentos.find(e => e.id === id);
      toast.success(enc?.prestador
        ? 'Encaminhamento concluído — acesso do prestador encerrado'
        : 'Encaminhamento concluído');
      carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) {
        setErroLinha({ id, dados: { mensagem: e.response?.data?.error ?? 'Erro ao concluir encaminhamento' } });
      }
    } finally {
      setFinalizandoId(null);
    }
  };


  // ── Guard ───────────────────────────────────────────────────────────────────

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.encaminhamentos.ler')) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar encaminhamentos.</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!evolucaoId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <FileText size={32} className="mb-3 text-gray-200" />
        <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
        <p className="text-xs mt-1 text-center max-w-xs">
          Inicie uma evolução na aba Evolução para registrar encaminhamentos neste atendimento.
        </p>
      </div>
    );
  }

  // Evolução existe, mas é de OUTRO profissional (não assumida) — mesma regra que
  // o backend já aplica em EncaminhamentoController.criar; aqui só evita chegar ao
  // formulário pra falhar com 403 no fim.
  if (evolucaoDeOutro) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <FileText size={32} className="mb-3 text-gray-200" />
        <p className="font-medium text-sm text-gray-500">Evolução de outro profissional</p>
        <p className="text-xs mt-1 text-center max-w-xs">
          Você só pode encaminhar dentro de um atendimento seu. Assuma esta evolução na aba Evolução para registrar encaminhamentos aqui.
        </p>
      </div>
    );
  }

  const LIMIT_ENC = 10;
  const totalPags = Math.max(1, Math.ceil(encaminhamentos.length / LIMIT_ENC));
  const pageAtual = Math.min(page, totalPags);
  const pageItems = encaminhamentos.slice((pageAtual - 1) * LIMIT_ENC, pageAtual * LIMIT_ENC);

  return (
    <div className="p-4 space-y-4">

      {podeCriar && (
        <FormNovoEncaminhamento
          key={formKey}
          animalId={animalId}
          evolucaoId={evolucaoId}
          onCriado={() => { setFormKey(k => k + 1); carregar(); onSalvo?.(); }}
          onFechar={() => setFormKey(k => k + 1)}
        />
      )}

      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Encaminhamentos</p>
        <span className="text-xs text-gray-400">{encaminhamentos.length} registro{encaminhamentos.length !== 1 ? 's' : ''}</span>
      </div>

      {loading || loadingPerms ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : encaminhamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <Share2 size={40} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhum encaminhamento encontrado</p>
          {podeCriar && (
            <p className="text-xs text-gray-300 mt-1">
              Encaminhe o paciente a um prestador da equipe ou profissional externo.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Mobile — cards no padrão do Histórico de Evolução Clínica */}
          <div className="md:hidden divide-y divide-gray-50">
            {pageItems.map(enc => {
              const eAutor = enc.veterinario?.id === (user?.id ?? 0);
              return (
                <EncaminhamentoCard
                  key={enc.id}
                  enc={enc}
                  podeEditar={podeEditar && (isGestor || eAutor)}
                  podeFinalizar={podeFinalizar && (isGestor || eAutor)}
                  podeCompartilhar={podeCompartilhar}
                  finalizando={finalizandoId === enc.id}
                  erro={erroDaLinha(enc.id)}
                  onStatus={handleStatus}
                  onFinalizar={handleFinalizar}
                />
              );
            })}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Data</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Especialidade</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Destino</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Responsável</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageItems.map(enc => {
                  const eAutor = enc.veterinario?.id === (user?.id ?? 0);
                  const erroDesta = erroDaLinha(enc.id);
                  // O erro vai numa <tr> própria logo abaixo da linha: dentro de uma
                  // célula ele espremeria a coluna, e no topo da tabela não diria a
                  // QUAL encaminhamento se refere.
                  return (
                    <Fragment key={enc.id}>
                      <EncaminhamentoRow
                        enc={enc}
                        podeEditar={podeEditar && (isGestor || eAutor)}
                        podeFinalizar={podeFinalizar && (isGestor || eAutor)}
                        podeCompartilhar={podeCompartilhar}
                        finalizando={finalizandoId === enc.id}
                        onStatus={handleStatus}
                        onFinalizar={handleFinalizar}
                      />
                      {erroDesta && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-3">
                            <ErroAcao erro={erroDesta} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
              <span className="text-xs text-gray-400">{encaminhamentos.length} registro{encaminhamentos.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-3">
                <button disabled={pageAtual === 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">{pageAtual} / {totalPags}</span>
                <button disabled={pageAtual >= totalPags} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ModalJustificativa
        aberto={cancelandoId !== null}
        titulo="Cancelar encaminhamento?"
        descricao={(() => {
          const enc = encaminhamentos.find(e => e.id === cancelandoId);
          if (!enc) return undefined;
          const destino = enc.prestador?.fullName ?? enc.veterinarioDestino ?? enc.clinicaDestino ?? 'externo';
          return `${enc.especialidade ?? 'Encaminhamento'} — ${destino}${enc.prestador ? ' (o acesso do prestador será encerrado)' : ''}`;
        })()}
        acaoLabel="Cancelar encaminhamento"
        onConfirmar={(motivo) => { if (cancelandoId !== null) handleStatus(cancelandoId, 'CANCELADO', motivo); }}
        onFechar={() => setCancelandoId(null)}
      />
    </div>
  );
}
