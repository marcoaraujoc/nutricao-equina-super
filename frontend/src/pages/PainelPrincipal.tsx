// src/pages/PainelPrincipal.tsx
//
// Painel do VETERINÁRIO DE CAMPO — a visão de "o que eu faço hoje", numa tela só:
// agenda do dia, fila de execução agrupada por LOCALIDADE (para quem roda fazenda:
// o roteiro é geográfico, não por paciente), o que precisa ir no carro e a busca
// rápida de animais.
//
// Consome os MESMOS endpoints das telas de origem — não há endpoint próprio do painel:
//   GET /clinica/agendamentos?data=                → agenda do dia
//   GET /clinica/prescricoes/grupos/execucao?data= → fila de prescrições (a do plantão)
//   GET /clinica/vacinas/para-execucao             → fila de vacinas (a do plantão)
//   GET /animais                                   → busca rápida (e reserva de local/foto)
//
// A FILA e o RESUMO DE FARMÁCIA cobrem TUDO que se aplica hoje — prescrições E vacinas —
// e as ações são as MESMAS de /execucao-prescricao: executar abre o popup de execução
// (`ModalExecucao` / `ModalExecucaoVacina`, importados de lá) e cancelar pede
// justificativa. Nada de execução própria aqui: um segundo caminho para debitar estoque e
// faturar seria a primeira coisa a divergir.
//
// ⚠️ O popup ABRE SOBRE ESTA TELA e, ao fechar, é ESTA tela que recarrega — por isso
// executar pelo painel volta ao painel, e executar pela fila do plantão volta ao plantão.
// Não navegue para /execucao-prescricao para executar: isso trocaria a tela de retorno.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Search, MapPin, AlertTriangle, Clock, Syringe,
  ClipboardList, PackageCheck, Stethoscope, RefreshCw,
  CheckCircle2, Ban, Pill, Lock,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';
import ModalJustificativa from '../components/ModalJustificativa';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import {
  ModalExecucao, ModalExecucaoVacina, itemPendenteEm,
  itemAtrasadoEm, previsaoPendenteISO, vacinaAtrasadaEm,
  type GrupoExecucao, type ItemExecucao, type VacinaExecucao,
} from './ExecucaoPrescricao';
import { hojeISO, formatHora, formatDiaMes, formatDateShort } from '../utils/dateUtils';

// ─── Tipos (espelham o que os endpoints já devolvem) ──────────────────────────

interface AnimalLista {
  id:          number;
  nome:        string;
  photoUrl?:   string | null;
  baia?:       string | null;
  local?:      string | null;
  localizacao?: { id: number; nome: string } | null;
  especie?:    { nome: string } | null;
  raca?:       { nome: string } | null;
}

interface Agendamento {
  id:       number;
  tipo:     string;
  titulo:   string;
  dataHora: string;
  status:   string;
  animal?:  { id: number; nome: string; local?: string | null; localizacao?: { nome: string } | null } | null;
}

// Prescrição e vacina da fila são os MESMOS tipos de /execucao-prescricao (mesmos
// endpoints): tipo local aqui viraria um segundo contrato para o mesmo dado.

/** Uma parada da fila — a prescrição com o que falta dela hoje, ou a vacina. */
type EntradaFila =
  | { kind: 'PRESC'; id: string; animal: GrupoExecucao['animal']; grupo: GrupoExecucao; itens: ItemExecucao[] }
  | { kind: 'VAC';   id: string; animal: VacinaExecucao['animal']; vacina: VacinaExecucao };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// `hojeISO` e `formatHora` vêm de utils/dateUtils (fonte única de data/hora — ver
// o cabeçalho daquele arquivo). Havia aqui uma cópia local de cada uma.
const horaDe = (iso: string) => formatHora(iso) ?? '—';

type Localizavel = { local?: string | null; localizacao?: { nome: string } | null } | null | undefined;

/** Onde o animal está: catálogo → campo textual legado → null (mesma regra da Agenda). */
const localDoAnimal = (a: Localizavel): string | null =>
  a?.localizacao?.nome?.trim() || a?.local?.trim() || null;

/** "BAIA 04 · HARAS SANTA FÉ" — baia (quando houver) + localidade. */
function rotuloLocalidade(a: (Localizavel & { baia?: string | null }) | undefined): string {
  const local = localDoAnimal(a);
  const baia  = a?.baia?.trim();
  if (baia && local) return `${baia} · ${local}`;
  return baia || local || 'Sem localidade definida';
}

/** Descrição curta do animal: "Quarto de Milha" / "Equino". */
const descricaoAnimal = (a?: { especie?: { nome: string } | null; raca?: { nome: string } | null } | null) =>
  a?.raca?.nome || a?.especie?.nome || null;

// ─── Componentes de apoio ─────────────────────────────────────────────────────

function Painel({ titulo, icone, badge, acao, children, className = '' }: {
  titulo: string; icone: React.ReactNode; badge?: React.ReactNode;
  acao?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-w-0 ${className}`}>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
        <span className="text-emerald-600 flex-shrink-0">{icone}</span>
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex-1 min-w-0 truncate">
          {titulo}
        </h2>
        {badge}
        {acao}
      </header>
      <div className="p-3 flex-1 min-h-0 overflow-y-auto">{children}</div>
    </section>
  );
}

const Contador = ({ n, tom = 'emerald' }: { n: number; tom?: 'emerald' | 'amber' }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
    tom === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
  }`}>
    {n}
  </span>
);

const Vazio = ({ texto }: { texto: string }) => (
  <p className="text-xs text-gray-400 text-center py-6 px-2">{texto}</p>
);

// ─── Página ───────────────────────────────────────────────────────────────────

export default function PainelPrincipal() {
  const { user } = useAuth();
  // Mesmos gates da tela de plantão — executar e cancelar aqui são as MESMAS ações.
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeExecutarAcao = isGestor || podeExecutar('enfermagem.prescricao.executar');
  const podeCancelar     = isGestor || podeExecutar('enfermagem.prescricao.deletar');
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
  const { setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();

  const [animais,       setAnimais]       = useState<AnimalLista[]>([]);
  const [agenda,        setAgenda]        = useState<Agendamento[]>([]);
  const [grupos,        setGrupos]        = useState<GrupoExecucao[]>([]);
  const [vacinas,       setVacinas]       = useState<VacinaExecucao[]>([]);
  const [crmv,          setCrmv]          = useState<string | null>(null);
  const [busca,         setBusca]         = useState('');
  const [loading,       setLoading]       = useState(true);
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  const [atualizadoEm,  setAtualizadoEm]  = useState<Date | null>(null);
  const [agora,         setAgora]         = useState(new Date());

  // Popups de execução — os MESMOS de /execucao-prescricao, abertos SOBRE esta tela.
  const [modalGrupo,  setModalGrupo]  = useState<GrupoExecucao | null>(null);
  const [modalVacina, setModalVacina] = useState<VacinaExecucao | null>(null);
  // Alvo do cancelamento (justificativa obrigatória, como no plantão)
  const [cancelarGrupo,  setCancelarGrupo]  = useState<GrupoExecucao | null>(null);
  const [cancelarVacina, setCancelarVacina] = useState<VacinaExecucao | null>(null);
  const [cancelando,     setCancelando]     = useState(false);

  // Mantém a DATA do cabeçalho correta — o painel fica aberto o dia todo no carro e
  // atravessa a virada da meia-noite. (A hora saiu do cabeçalho junto com a barra
  // escura; o que ficou é a data por extenso.)
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErroInline(null);
    const hoje = hojeISO();
    try {
      // GET 403 resolve com { data: null } (services/api.ts) — daí o `?.` em tudo.
      // As DUAS filas do plantão (prescrição e vacina) vêm dos mesmos endpoints de
      // /execucao-prescricao — o painel mostra a execução do dia INTEIRA.
      const [resAnimais, resAgenda, resExec, resVac, resMe] = await Promise.all([
        api.get('/animais').catch(() => null),
        api.get(`/clinica/agendamentos?data=${hoje}`).catch(() => null),
        api.get('/clinica/prescricoes/grupos/execucao', { params: { data: hoje } }).catch(() => null),
        api.get('/clinica/vacinas/para-execucao').catch(() => null),
        api.get('/users/me').catch(() => null),
      ]);

      const listaAnimais = resAnimais?.data?.dados ?? resAnimais?.data ?? [];
      setAnimais(Array.isArray(listaAnimais) ? listaAnimais : []);
      setAgenda(resAgenda?.data?.dados ?? []);
      setGrupos(resExec?.data?.dados ?? []);
      setVacinas(resVac?.data?.dados ?? []);
      setCrmv(resMe?.data?.crmv ?? null);
      setAtualizadoEm(new Date());
    } catch {
      setErroInline('Não foi possível carregar o painel. Tente atualizar.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mesmo gate do usePermissoes/SelectedAnimalContext: nenhum fetch escopado por
  // empresa antes de o contexto ativo resolver, senão volta dado da empresa errada.
  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    carregar();
  }, [loadingPerms, empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId, carregar]);

  /**
   * Recarga automática a cada 2 min — o painel fica aberto o dia todo e precisa refletir
   * o que a equipe executou; o botão "Atualizar" saiu por isso. A hora da última carga
   * continua no cabeçalho, que é como se sabe que o painel está vivo.
   *
   * ⚠️ NÃO recarrega com POPUP ABERTO: `carregar()` troca `grupos`/`vacinas`, e puxar o
   * dado debaixo de um diálogo em uso é receita de execução no registro errado. Ao fechar
   * o popup a tela já recarrega (é o `onClose`), então nada se perde.
   */
  const popupAberto = !!(modalGrupo || modalVacina || cancelarGrupo || cancelarVacina);
  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    const t = setInterval(() => { if (!popupAberto) carregar(); }, 120_000);
    return () => clearInterval(t);
  }, [loadingPerms, empresaLoading, popupAberto, carregar]);

  // ── Derivações ─────────────────────────────────────────────────────────────

  const animalPorId = useMemo(
    () => new Map(animais.map(a => [a.id, a])),
    [animais],
  );

  /**
   * Fila agrupada por LOCALIDADE — o roteiro do dia é geográfico. Traz a execução do dia
   * INTEIRA: prescrições (só com o que ainda falta hoje, `itemPendenteEm` — a MESMA
   * regra do plantão) e vacinas FINALIZADAS aguardando aplicação.
   *
   * O local sai do PRÓPRIO animal devolvido por cada endpoint (os dois selects trazem
   * `localizacao`/`local`); o cruzamento com `/animais` ficou só para a baia e a foto,
   * que a lista da busca já tem em memória.
   */
  const filaPorLocalidade = useMemo(() => {
    const mapa = new Map<string, EntradaFila[]>();
    const add = (chave: string, e: EntradaFila) => {
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(e);
    };

    // Local/baia do PRÓPRIO animal da fila, com a lista de `/animais` como reserva.
    // ⚠️ Nada de `{ ...doCache, ...daFila }`: a chave existe com `null` na fila e o
    // spread APAGARIA o valor da reserva. Campo a campo, com `??`.
    const ondeEsta = (a: GrupoExecucao['animal']) => {
      const cache = animalPorId.get(a.id);
      return {
        local:       a.local       ?? cache?.local       ?? null,
        localizacao: a.localizacao ?? cache?.localizacao ?? null,
        baia:        a.baia        ?? cache?.baia        ?? null,
      };
    };

    for (const g of grupos) {
      if (g.status === 'CANCELADO') continue;
      const itens = g.itens.filter(i => itemPendenteEm(i, hojeISO()));
      if (itens.length === 0) continue;
      add(rotuloLocalidade(ondeEsta(g.animal)), { kind: 'PRESC', id: `p-${g.id}`, animal: g.animal, grupo: g, itens });
    }

    for (const v of vacinas) {
      add(rotuloLocalidade(ondeEsta(v.animal)), { kind: 'VAC', id: `v-${v.id}`, animal: v.animal, vacina: v });
    }

    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [grupos, vacinas, animalPorId]);

  const totalPendentes = useMemo(
    () => filaPorLocalidade.reduce((s, [, es]) => s + es.length, 0),
    [filaPorLocalidade],
  );

  /**
   * O que separar para o carro: TUDO que se aplica hoje — medicamento da prescrição e
   * vacina —, agrupado por item. Duas amoxicilinas em prescrições distintas viram UMA
   * linha com quantidade 2; é uma lista de separação, não o extrato das prescrições.
   *
   * QUANTIDADE = nº de aplicações pendentes hoje (medicamento) ou nº de doses (vacina).
   * A soma da DOSAGEM ("20 mL") vai à parte, e só quando ela é numérica em todas as
   * linhas somadas — "1 ampola" não soma com "2 mL", e um total errado numa lista de
   * separação é pior do que total nenhum.
   */
  const resumoFarmacia = useMemo(() => {
    interface LinhaFarmacia {
      chave: string; nome: string; tipo: 'MEDICAMENTO' | 'VACINA';
      qtd: number; unidade: string | null; total: number; somavel: boolean;
    }
    const mapa = new Map<string, LinhaFarmacia>();

    const acumular = (
      nome: string, tipo: LinhaFarmacia['tipo'], qtd: number,
      unidade: string | null, dose: number | null,
    ) => {
      const chave = `${tipo}|${nome.trim().toLowerCase()}|${unidade ?? ''}`;
      const atual = mapa.get(chave) ?? { chave, nome: nome.trim(), tipo, qtd: 0, unidade, total: 0, somavel: true };
      atual.qtd += qtd;
      if (dose != null && Number.isFinite(dose) && dose > 0) atual.total += dose * qtd;
      else atual.somavel = false;
      mapa.set(chave, atual);
    };

    for (const [, entradas] of filaPorLocalidade) {
      for (const e of entradas) {
        if (e.kind === 'PRESC') {
          for (const i of e.itens) {
            if (i.tipo !== 'MEDICAMENTO') continue;   // procedimento não se carrega no carro
            const dose = Number(String(i.dosagem ?? '').replace(',', '.'));
            acumular(i.medicamento, 'MEDICAMENTO', 1, i.unidade, Number.isFinite(dose) ? dose : null);
          }
        } else {
          acumular(e.vacina.nome, 'VACINA', e.vacina.quantidade ?? 1, 'dose', null);
        }
      }
    }

    return [...mapa.values()].sort((a, b) =>
      a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : (a.tipo === 'MEDICAMENTO' ? -1 : 1));
  }, [filaPorLocalidade]);

  /**
   * Itens já separados — checklist de conferência do carro. Vive em localStorage POR
   * DIA: o painel é recarregado o tempo todo (e o botão Atualizar existe justamente para
   * isso), e perder o que já foi conferido a cada carga tornaria o checklist inútil.
   * A chave do dia também é a limpeza: amanhã a lista nasce vazia sozinha.
   */
  const chaveSeparados = `s2vet_farmacia_separados_${hojeISO()}`;
  const [separados, setSeparados] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(chaveSeparados) ?? '[]')); }
    catch { return new Set(); }
  });
  const alternarSeparado = (chave: string) => {
    setSeparados(prev => {
      const proximo = new Set(prev);
      if (proximo.has(chave)) proximo.delete(chave); else proximo.add(chave);
      try { localStorage.setItem(chaveSeparados, JSON.stringify([...proximo])); } catch { /* ignore */ }
      return proximo;
    });
  };

  const animaisFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = [...animais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!q) return base.slice(0, 30);
    return base.filter(a =>
      a.nome.toLowerCase().includes(q) ||
      (localDoAnimal(a) ?? '').toLowerCase().includes(q) ||
      (a.baia ?? '').toLowerCase().includes(q),
    ).slice(0, 30);
  }, [animais, busca]);

  const agendaOrdenada = useMemo(
    () => [...agenda]
      // CANCELADO_AUTOMATICAMENTE sai daqui pelo mesmo motivo que CANCELADO: a rotina
      // noturna também é uma desistência do atendimento, só que do sistema.
      .filter(a => a.status !== 'CANCELADO' && a.status !== 'CANCELADO_AUTOMATICAMENTE')
      .sort((a, b) => a.dataHora.localeCompare(b.dataHora)),
    [agenda],
  );

  // ── Cancelamento (mesmas rotas de plantão da tela de execução) ─────────────

  const handleCancelarGrupo = async (motivo: string) => {
    if (!cancelarGrupo) return;
    const alvo = cancelarGrupo;
    setCancelando(true);
    try {
      await api.post(`/clinica/prescricoes/grupos/${alvo.id}/cancelar-plantao`, { motivo });
      toast.success(`Prescrição #${alvo.numeroFormatado} cancelada`);
      setCancelarGrupo(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCancelarGrupo(null);   // fecha o modal, senão o erro fica atrás dele
      setErroInline(msg ?? 'Erro ao cancelar prescrição');
    } finally { setCancelando(false); }
  };

  const handleCancelarVacina = async (motivo: string) => {
    if (!cancelarVacina) return;
    const alvo = cancelarVacina;
    setCancelando(true);
    try {
      await api.delete(`/clinica/vacinas/${alvo.id}/cancelar-plantao`, { data: { motivo } });
      toast.success(`${alvo.nome} — cancelada`);
      setCancelarVacina(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCancelarVacina(null);
      setErroInline(msg ?? 'Erro ao cancelar vacina');
    } finally { setCancelando(false); }
  };

  // ── Navegação ──────────────────────────────────────────────────────────────

  /**
   * Mesmo padrão de AnimaisVet/VetDashboard: seleciona o animal no contexto e navega.
   * Os dados vêm da lista de `/animais` (mais completa que o resumo do agendamento);
   * sem ela, vai o mínimo — a tela do animal recarrega tudo pelo id da rota.
   */
  const abrirAnimal = (a: { id: number; nome: string }) => {
    const completo = animalPorId.get(a.id);
    setSelectedAnimal({
      id:      a.id,
      nome:    completo?.nome    ?? a.nome,
      especie: completo?.especie ?? undefined,
      raca:    completo?.raca    ?? undefined,
    });
    navigate(`/animal/${a.id}`);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  // Painel do veterinário. `userType` aqui é o tipo NA EMPRESA ATIVA (o backend o
  // resolve pelo cargo do vínculo — lib/tipoContexto.js), então quem é veterinária
  // nesta clínica vê, e quem é estagiária aqui não vê, mesmo sendo vet na outra.
  const ehVeterinario = (user?.userType ?? '').toUpperCase() === 'VETERINARIO';

  if (!loadingPerms && !ehVeterinario) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">O Painel Principal é exclusivo do perfil veterinário.</p>
        </div>
      </PageContainer>
    );
  }

  const dataLonga = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const carregando = loadingPerms || empresaLoading || loading;

  return (
    <PageContainer maxWidth="7xl">
      {/* Layout no padrão da aplicação (referência: /equipe): BotaoVoltar → erro de carga
          → cabeçalho com título+ícone e a ação da tela à direita → conteúdo em cards
          brancos. O bloco escuro que existia aqui (barra do usuário no topo e barra de
          atalhos no rodapé) foi REMOVIDO: identidade do usuário e rodapé são do SHELL
          (AppHeader/AppFooter, §16) e a tela não repete o que ele já mostra. */}
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope size={24} className="text-emerald-600 flex-shrink-0" />
            Painel Principal
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="capitalize">{dataLonga}</span>
            {crmv ? ` · CRMV ${crmv}` : ''}
            {totalPendentes > 0 && (
              <span className="ml-2 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                {totalPendentes} pendente{totalPendentes === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        {/* A tela se recarrega sozinha a cada 2 min — o botão "Atualizar" saiu. O que
            fica é a hora da última carga: é assim que se sabe que o painel está vivo.
            ("Sincronizado há X" pressuporia modo offline, que a aplicação não tem.) */}
        {atualizadoEm && (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
            <RefreshCw size={11} className={carregando ? 'animate-spin' : ''} />
            Atualizado às {horaDe(atualizadoEm.toISOString())}
          </span>
        )}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : (
      <>
        {/* ── Corpo: 3 colunas no desktop, empilhado no mobile ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] gap-4">

          {/* ── Coluna 1 ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 min-w-0">
            <Painel
              titulo="Agenda do dia"
              icone={<Clock size={13} />}
              badge={<Contador n={agendaOrdenada.length} />}
            >
              {agendaOrdenada.length === 0 ? (
                <Vazio texto="Nenhum atendimento agendado para hoje." />
              ) : (
                <ul className="space-y-1.5">
                  {agendaOrdenada.map(ag => {
                    const emCurso = ag.status === 'EM_ANDAMENTO';
                    return (
                      <li key={ag.id}>
                        <button
                          type="button"
                          onClick={() => ag.animal && abrirAnimal(ag.animal)}
                          disabled={!ag.animal}
                          className={`w-full text-left flex gap-2.5 px-2.5 py-2 rounded-xl border transition-colors ${
                            emCurso
                              ? 'border-emerald-200 bg-emerald-50/70'
                              : 'border-transparent hover:bg-gray-50'
                          } ${ag.animal ? '' : 'cursor-default'}`}
                        >
                          <span className="text-xs font-bold text-gray-500 tabular-nums pt-0.5 flex-shrink-0">
                            {horaDe(ag.dataHora)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-800 truncate">
                              {ag.animal?.nome ?? ag.titulo}
                            </span>
                            <span className="block text-[11px] text-gray-500 truncate">
                              {ag.animal ? ag.titulo : ag.tipo}
                            </span>
                            {localDoAnimal(ag.animal) && (
                              <span className="flex items-center gap-1 text-[11px] text-gray-400 truncate">
                                <MapPin size={9} className="flex-shrink-0" />
                                {localDoAnimal(ag.animal)}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Painel>

            {/* ⚠️ NÃO HÁ marcador de "acompanhamento crítico" no modelo de dados —
                nem flag no Animal, nem campo de urgência clínica. Preencher isto com
                um palpite (a prescrição mais longa, o último atendido) daria ao vet
                uma lista que ninguém marcou como crítica, e é exatamente o tipo de
                informação em que ele confiaria. Fica o estado vazio, honesto. */}
            <Painel
              titulo="Acompanhamento crítico"
              icone={<AlertTriangle size={13} />}
              badge={<Contador n={0} tom="amber" />}
              className="border-amber-100"
            >
              <Vazio texto="O sistema ainda não tem como marcar um paciente em acompanhamento crítico. Defina o critério e este painel passa a listá-los." />
            </Painel>
          </div>

          {/* ── Coluna 2 ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 min-w-0">
            <Painel
              titulo="Fila de execução por localidade"
              icone={<ClipboardList size={13} />}
              badge={<Contador n={totalPendentes} tom={totalPendentes > 0 ? 'amber' : 'emerald'} />}
            >
              {filaPorLocalidade.length === 0 ? (
                <Vazio texto="Nada pendente de execução hoje." />
              ) : (
                <div className="space-y-3">
                  {filaPorLocalidade.map(([localidade, itensLocal]) => (
                    <div key={localidade}>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600 uppercase tracking-wide mb-1.5">
                        <MapPin size={11} className="flex-shrink-0" /> {localidade}
                      </p>
                      <ul className="space-y-1.5">
                        {itensLocal.map(entrada => {
                          const ehVac  = entrada.kind === 'VAC';
                          const animal = entrada.animal;
                          // Prontuário congelado (Animal.inativo) — vem do backend na
                          // própria linha da fila, para a tela não precisar consultar.
                          const congelado = ehVac
                            ? !!entrada.vacina.animalInativo
                            : !!entrada.grupo.animalInativo;
                          const resumo = ehVac
                            ? [entrada.vacina.nome, entrada.vacina.dose, entrada.vacina.via]
                                .filter(Boolean).join(' · ')
                            : entrada.itens.map(i => i.medicamento).join(' · ');
                          // A fila do painel usa a MESMA `itemPendenteEm` do plantão e,
                          // desde 2026-08-29, ela mantém a dose vencida na lista. Sem o
                          // selo, o atrasado voltaria a se confundir com o do dia — que
                          // é justamente o defeito que a mudança veio corrigir.
                          const atraso = ehVac
                            ? (vacinaAtrasadaEm(entrada.vacina, hojeISO())
                                ? formatDateShort(entrada.vacina.dataAplicacao) : null)
                            : entrada.itens
                                .filter(i => itemAtrasadoEm(i, hojeISO()))
                                .map(i => previsaoPendenteISO(i))
                                .filter((v): v is string => !!v)
                                .sort()
                                .map(v => formatDiaMes(v) ?? formatDateShort(v))[0] ?? null;
                          return (
                          <li key={entrada.id}
                            className="flex items-center gap-2.5 border border-gray-100 rounded-xl px-2.5 py-2">
                            {/* Sem foto → ícone de paciente, o MESMO vazio de todas as
                                telas (components/FotoAnimal). Era a letra inicial, que é
                                justamente o que aquele componente veio eliminar. */}
                            <FotoAnimal
                              url={animal.photoUrl ?? animalPorId.get(animal.id)?.photoUrl ?? null}
                              nome={animal.nome}
                              animalId={animal.id}
                              className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0"
                              iconSize={16}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 ${
                                  ehVac ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {ehVac ? <Syringe size={8} /> : <Pill size={8} />}
                                  {ehVac ? 'Vacina' : 'Med'}
                                </span>
                                <span className="text-sm font-semibold text-gray-800 truncate">
                                  {animal.nome}
                                  {descricaoAnimal(animal) && (
                                    <span className="font-normal text-gray-500"> ({descricaoAnimal(animal)})</span>
                                  )}
                                </span>
                              </span>
                              <span className="block text-[11px] text-gray-500 truncate">{resumo}</span>
                              {atraso && (
                                <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-red-600">
                                  <AlertTriangle size={10} /> Atrasada — era {atraso}
                                </span>
                              )}
                            </span>
                            {/* AS MESMAS ações do plantão, na mesma ordem e cores:
                                EXECUTAR abre o popup de execução (o próprio ModalExecucao /
                                ModalExecucaoVacina de lá) e CANCELAR pede justificativa.
                                Como o popup abre SOBRE esta tela, executar pelo painel
                                volta ao painel — a tela de retorno é sempre a chamadora. */}
                            <AcoesRegistro className="flex-shrink-0">
                              {/* 🔴 Paciente INATIVO: a parada CONTINUA na fila (a equipe
                                  precisa saber que existe e ficou parada), mas sem ação —
                                  executar e cancelar respondem 400 (lib/animalInativo.js).
                                  O selo é o que evita "sumiu o botão". */}
                              {congelado && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold whitespace-nowrap"
                                  title="Paciente inativo — prontuário em somente leitura. Reative com o gestor.">
                                  <Lock size={9} /> Somente leitura
                                </span>
                              )}
                              <AcaoRegistro tom="executar" icone={CheckCircle2}
                                rotulo={ehVac ? 'Aplicar' : 'Executar'}
                                titulo={ehVac ? 'Aplicar vacina' : 'Executar prescrição'}
                                visivel={podeExecutarAcao && !congelado}
                                onClick={() => ehVac ? setModalVacina(entrada.vacina) : setModalGrupo(entrada.grupo)} />
                              <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar"
                                titulo={ehVac ? 'Cancelar vacina' : 'Cancelar prescrição'}
                                visivel={podeCancelar && !congelado}
                                onClick={() => {
                                  setErroInline(null);
                                  if (ehVac) setCancelarVacina(entrada.vacina);
                                  else       setCancelarGrupo(entrada.grupo);
                                }} />
                            </AcoesRegistro>
                          </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Painel>

            <Painel
              titulo="Resumo de farmácia (para carregar no carro)"
              icone={<PackageCheck size={13} />}
              badge={
                resumoFarmacia.length > 0 ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-emerald-100 text-emerald-700">
                    {resumoFarmacia.filter(m => separados.has(m.chave)).length}/{resumoFarmacia.length}
                  </span>
                ) : undefined
              }
              acao={
                <button type="button" onClick={() => navigate('/farmacia')}
                  className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 uppercase tracking-wide flex-shrink-0">
                  Lista completa
                </button>
              }
              className="bg-emerald-50/40"
            >
              {resumoFarmacia.length === 0 ? (
                <Vazio texto="Nada a separar — nenhum medicamento ou vacina na fila de hoje." />
              ) : (
                /* Uma linha por item: [checkbox] [qtd] [medicamento ou vacina]. O
                   checkbox é a conferência do que JÁ FOI SEPARADO — não executa nada e
                   não toca no estoque; quem faz isso é a execução, na fila ao lado. */
                <ul className="space-y-1.5">
                  {resumoFarmacia.map(m => {
                    const ok = separados.has(m.chave);
                    return (
                      <li key={m.chave}>
                        <label className={`flex items-center gap-2.5 border rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                          ok ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-emerald-100 hover:border-emerald-200'
                        }`}>
                          <input
                            type="checkbox"
                            checked={ok}
                            onChange={() => alternarSeparado(m.chave)}
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer flex-shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            {/* "2x • Acetilcisteína - xarope" — quantidade NA FRENTE do
                                item, no mesmo tamanho de fonte, separada por "•". */}
                            {/* TUDO numa linha só, com o mesmo separador:
                                "1x • Acetilcisteína - xarope • 10 mL no total".
                                O total da dosagem entra só quando TODAS as linhas somadas
                                são numéricas — "1 ampola" não soma com "2 mL", e um total
                                errado numa lista de separação é pior que total nenhum. */}
                            <span className={`block text-xs truncate ${ok ? 'text-gray-500 line-through' : 'text-gray-700'}`}>
                              <span className="tabular-nums">{m.qtd}x</span>
                              {' • '}
                              {m.nome}
                              {m.somavel && m.total > 0 && (
                                <> {' • '}{`${Number(m.total.toFixed(2))} ${m.unidade ?? ''}`.trim()} no total</>
                              )}
                            </span>
                          </span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            m.tipo === 'VACINA' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {m.tipo === 'VACINA' ? 'Vacina' : 'Med'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Painel>
          </div>

          {/* ── Coluna 3 ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 min-w-0">
            <Painel titulo="Busca rápida de animais" icone={<Search size={13} />}>
              <div className="relative mb-2">
                <input
                  type="text"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Nome ou localidade..."
                  className="w-full border border-gray-200 rounded-xl pl-3 pr-9 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
              </div>

              {animaisFiltrados.length === 0 ? (
                <Vazio texto={busca ? `Nenhum animal para "${busca}".` : 'Nenhum animal cadastrado.'} />
              ) : (
                <ul className="space-y-0.5">
                  {animaisFiltrados.map(a => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => abrirAnimal(a)}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <span className="block text-sm font-bold text-gray-800 truncate">
                          {a.nome}
                          {descricaoAnimal(a) && (
                            <span className="font-normal text-gray-500"> ({descricaoAnimal(a)})</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-gray-400 truncate">
                          {rotuloLocalidade(a)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>

          </div>
        </div>

        {/* ── Atalhos ─────────────────────────────────────────────────────────
            Eram uma barra escura de rodapé, que competia com o AppFooter global.
            Viraram botões secundários no padrão da aplicação, no fim do conteúdo. */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={() => navigate('/atendimento')}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <Stethoscope size={14} className="text-emerald-600" /> Atendimento
          </button>
          <button type="button" onClick={() => navigate('/execucao-prescricao')}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <Syringe size={14} className="text-emerald-600" /> Execução de prescrição
          </button>
        </div>
      </>
      )}

      {/* ── Popups de execução ───────────────────────────────────────────────
          Os MESMOS componentes de /execucao-prescricao. Abrem SOBRE o painel e, ao
          fechar, é o PAINEL que recarrega: quem executa daqui volta para cá. */}
      {modalGrupo && (
        <ModalExecucao
          grupo={modalGrupo}
          onClose={() => { setModalGrupo(null); carregar(); }}
          podeCancelar={podeCancelar}
        />
      )}

      {modalVacina && (
        <ModalExecucaoVacina
          v={modalVacina}
          onClose={() => setModalVacina(null)}
          onExecutada={carregar}
          podeExecutarAcao={podeExecutarAcao}
          podeCancelar={podeCancelar}
        />
      )}

      {cancelarGrupo && (
        <ModalJustificativa
          aberto
          titulo={`Cancelar prescrição #${cancelarGrupo.numeroFormatado}`}
          descricao={`Cancela toda a prescrição de ${cancelarGrupo.animal.nome} e libera o estoque reservado. Prescrição que já teve execução não pode ser cancelada. A justificativa vai para a auditoria.`}
          acaoLabel="Cancelar prescrição"
          onConfirmar={handleCancelarGrupo}
          onFechar={() => { if (!cancelando) setCancelarGrupo(null); }}
        />
      )}

      {cancelarVacina && (
        <ModalJustificativa
          aberto
          titulo={`Cancelar vacina — ${cancelarVacina.nome}`}
          descricao={`Cancela a vacina de ${cancelarVacina.animal.nome}, devolve as doses ao lote e remove o lançamento da fatura. A justificativa vai para a auditoria.`}
          acaoLabel="Cancelar vacina"
          onConfirmar={handleCancelarVacina}
          onFechar={() => { if (!cancelando) setCancelarVacina(null); }}
        />
      )}
    </PageContainer>
  );
}
