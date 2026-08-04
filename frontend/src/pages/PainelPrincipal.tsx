// src/pages/PainelPrincipal.tsx
//
// Painel do VETERINÁRIO DE CAMPO — a visão de "o que eu faço hoje", numa tela só:
// agenda do dia, fila de execução agrupada por LOCALIDADE (para quem roda fazenda:
// o roteiro é geográfico, não por paciente), o que precisa ir no carro e a busca
// rápida de animais.
//
// TELA NOVA E AUTOSSUFICIENTE: não altera nenhum comportamento existente. Só consome
// endpoints que já existiam:
//   GET /clinica/agendamentos?data=            → agenda do dia
//   GET /clinica/prescricoes/grupos/execucao?data=  → fila de execução (mesma de /execucao-prescricao)
//   GET /animais                               → busca rápida E a LOCALIDADE de cada animal
//
// ⚠️ POR QUE `/animais` também alimenta a fila: `grupos/execucao` devolve o animal SEM
// `localizacao`/`local` (o select do controller não os traz). Como agrupar por
// localidade é o ponto da tela, o local vem do cruzamento por id com a lista de
// animais — que já é carregada para a busca da coluna da direita, então não custa
// requisição a mais.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Search, MapPin, AlertTriangle, Clock, Syringe,
  ClipboardList, PackageCheck, PlusCircle, Stethoscope, RefreshCw,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import InlineError from '../components/InlineError';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';

// ─── Tipos (espelham o que os endpoints já devolvem) ──────────────────────────

interface AnimalLista {
  id:          number;
  nome:        string;
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

interface ItemExec {
  id:          number;
  tipo:        'MEDICAMENTO' | 'PROCEDIMENTO';
  medicamento: string;
  dosagem:     string | null;
  unidade:     string | null;
  via:         string;
  duracaoDias: number;
  dataInicio:  string;
  executadoEm?: string | null;
}

interface GrupoExec {
  id:     number;
  status: string;
  animal: { id: number; nome: string; especie?: { nome: string } | null; raca?: { nome: string } | null };
  itens:  ItemExec[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hojeISO = () => new Date().toISOString().split('T')[0];

const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Onde o animal está: catálogo → campo textual legado → null (mesma regra da Agenda). */
const localDoAnimal = (a?: AnimalLista | Agendamento['animal'] | null): string | null =>
  a?.localizacao?.nome?.trim() || a?.local?.trim() || null;

/** "BAIA 04 · HARAS SANTA FÉ" — baia (quando houver) + localidade. */
function rotuloLocalidade(a?: AnimalLista): string {
  const local = localDoAnimal(a);
  const baia  = a?.baia?.trim();
  if (baia && local) return `${baia} · ${local}`;
  return baia || local || 'Sem localidade definida';
}

/** Descrição curta do animal: "Quarto de Milha" / "Equino". */
const descricaoAnimal = (a?: { especie?: { nome: string } | null; raca?: { nome: string } | null } | null) =>
  a?.raca?.nome || a?.especie?.nome || null;

/** Só o que ainda falta aplicar HOJE — item já executado hoje sai da fila. */
const pendenteHoje = (i: ItemExec): boolean => {
  if (!i.executadoEm) return true;
  return new Date(i.executadoEm).toISOString().split('T')[0] !== hojeISO();
};

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
  const { loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
  const { setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();

  const [animais,       setAnimais]       = useState<AnimalLista[]>([]);
  const [agenda,        setAgenda]        = useState<Agendamento[]>([]);
  const [grupos,        setGrupos]        = useState<GrupoExec[]>([]);
  const [crmv,          setCrmv]          = useState<string | null>(null);
  const [busca,         setBusca]         = useState('');
  const [loading,       setLoading]       = useState(true);
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  const [atualizadoEm,  setAtualizadoEm]  = useState<Date | null>(null);
  const [agora,         setAgora]         = useState(new Date());

  // Relógio do cabeçalho — o painel fica aberto o dia todo no carro.
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErroInline(null);
    const hoje = hojeISO();
    try {
      // GET 403 resolve com { data: null } (services/api.ts) — daí o `?.` em tudo.
      const [resAnimais, resAgenda, resExec, resMe] = await Promise.all([
        api.get('/animais').catch(() => null),
        api.get(`/clinica/agendamentos?data=${hoje}`).catch(() => null),
        api.get('/clinica/prescricoes/grupos/execucao', { params: { data: hoje } }).catch(() => null),
        api.get('/users/me').catch(() => null),
      ]);

      const listaAnimais = resAnimais?.data?.dados ?? resAnimais?.data ?? [];
      setAnimais(Array.isArray(listaAnimais) ? listaAnimais : []);
      setAgenda(resAgenda?.data?.dados ?? []);
      setGrupos(resExec?.data?.dados ?? []);
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

  // ── Derivações ─────────────────────────────────────────────────────────────

  const animalPorId = useMemo(
    () => new Map(animais.map(a => [a.id, a])),
    [animais],
  );

  /** Fila agrupada por LOCALIDADE — o roteiro do dia é geográfico. */
  const filaPorLocalidade = useMemo(() => {
    const mapa = new Map<string, { grupo: GrupoExec; itens: ItemExec[] }[]>();
    for (const g of grupos) {
      const itens = g.itens.filter(pendenteHoje);
      if (itens.length === 0) continue;
      const chave = rotuloLocalidade(animalPorId.get(g.animal.id));
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push({ grupo: g, itens });
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [grupos, animalPorId]);

  const totalPendentes = useMemo(
    () => filaPorLocalidade.reduce((s, [, gs]) => s + gs.length, 0),
    [filaPorLocalidade],
  );

  /**
   * O que carregar no carro: soma dos MEDICAMENTOS ainda pendentes hoje, por
   * medicamento + unidade. Derivado da MESMA fila — não há endpoint de "resumo de
   * farmácia", e inventar um número aqui seria pior que não mostrar.
   * Dose não numérica (ex.: "1 ampola") entra sem soma, só com a contagem de aplicações.
   */
  const resumoFarmacia = useMemo(() => {
    const mapa = new Map<string, { nome: string; unidade: string | null; total: number; aplicacoes: number; somavel: boolean }>();
    for (const [, gs] of filaPorLocalidade) {
      for (const { itens } of gs) {
        for (const i of itens) {
          if (i.tipo !== 'MEDICAMENTO') continue;
          const chave = `${i.medicamento}|${i.unidade ?? ''}`;
          const dose  = Number(String(i.dosagem ?? '').replace(',', '.'));
          const atual = mapa.get(chave) ?? {
            nome: i.medicamento, unidade: i.unidade, total: 0, aplicacoes: 0, somavel: true,
          };
          atual.aplicacoes += 1;
          if (Number.isFinite(dose) && dose > 0) atual.total += dose;
          else atual.somavel = false;
          mapa.set(chave, atual);
        }
      }
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [filaPorLocalidade]);

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
      .filter(a => a.status !== 'CANCELADO')
      .sort((a, b) => a.dataHora.localeCompare(b.dataHora)),
    [agenda],
  );

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
      <PageContainer maxWidth="3xl">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">O Painel Principal é exclusivo do perfil veterinário.</p>
        </div>
      </PageContainer>
    );
  }

  if (loadingPerms || empresaLoading || loading) {
    return (
      <PageContainer maxWidth="7xl">
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-emerald-600" size={32} />
        </div>
      </PageContainer>
    );
  }

  const dataLonga = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  return (
    <PageContainer maxWidth="7xl">
      <InlineError message={erroInline} className="mb-3" />

      <div className="rounded-3xl overflow-hidden border border-gray-100 shadow-sm bg-gray-50">

        {/* ── Cabeçalho ────────────────────────────────────────────────────── */}
        <header className="bg-emerald-900 text-white px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-11 h-11 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
              {iniciais(user?.fullName ?? '')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm sm:text-base uppercase truncate">
                {user?.fullName ?? 'Veterinário'}
              </p>
              <p className="text-[11px] text-emerald-200 uppercase tracking-wide truncate">
                Médico Veterinário de Campo{crmv ? ` · CRMV ${crmv}` : ''}
              </p>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold capitalize">{dataLonga}</p>
              <p className="text-[11px] text-emerald-200">{horaDe(agora.toISOString())}</p>
            </div>
            <span className="flex items-center gap-1.5 bg-emerald-800 border border-emerald-700 rounded-full px-3 py-1 text-[11px] font-semibold flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {totalPendentes} pendente{totalPendentes === 1 ? '' : 's'}
            </span>
          </div>
        </header>

        {/* ── Corpo: 3 colunas no desktop, empilhado no mobile ─────────────── */}
        <div className="p-3 grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] gap-3">

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
                        {itensLocal.map(({ grupo, itens }) => (
                          <li key={grupo.id}
                            className="flex items-center gap-2.5 border border-gray-100 rounded-xl px-2.5 py-2">
                            <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                              {iniciais(grupo.animal.nome)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-gray-800 truncate">
                                {grupo.animal.nome}
                                {descricaoAnimal(grupo.animal) && (
                                  <span className="font-normal text-gray-500"> ({descricaoAnimal(grupo.animal)})</span>
                                )}
                              </span>
                              <span className="block text-[11px] text-gray-500 truncate">
                                {itens.map(i => i.medicamento).join(' · ')}
                              </span>
                            </span>
                            {/* Executar é da tela de plantão, que tem o modal item a item,
                                a baixa de estoque e o gate de permissão próprio. Aqui é só
                                a porta de entrada — duplicar a execução criaria um segundo
                                caminho para faturar e debitar estoque. */}
                            <button
                              type="button"
                              onClick={() => navigate('/execucao-prescricao')}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold transition-colors flex-shrink-0"
                            >
                              EXECUTAR
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Painel>

            <Painel
              titulo="Resumo de farmácia (para carregar no carro)"
              icone={<PackageCheck size={13} />}
              acao={
                <button type="button" onClick={() => navigate('/farmacia')}
                  className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 uppercase tracking-wide flex-shrink-0">
                  Lista completa
                </button>
              }
              className="bg-emerald-50/40"
            >
              {resumoFarmacia.length === 0 ? (
                <Vazio texto="Nenhum medicamento pendente na fila de hoje." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {resumoFarmacia.map(m => (
                    <div key={`${m.nome}-${m.unidade}`}
                      className="flex items-center justify-between gap-2 bg-white border border-emerald-100 rounded-xl px-3 py-2">
                      <span className="text-xs text-gray-700 truncate">{m.nome}</span>
                      <span className="text-xs font-bold text-gray-900 whitespace-nowrap flex-shrink-0">
                        {m.somavel && m.total > 0
                          ? `${Number(m.total.toFixed(2))} ${m.unidade ?? ''}`.trim()
                          : `${m.aplicacoes} aplic.`}
                      </span>
                    </div>
                  ))}
                </div>
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

            <button
              type="button"
              onClick={() => navigate('/atendimento')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-emerald-200 text-emerald-700 rounded-2xl text-xs font-bold uppercase tracking-wide hover:bg-emerald-50 transition-colors"
            >
              <PlusCircle size={14} /> Cadastrar nova ocorrência
            </button>
          </div>
        </div>

        {/* ── Rodapé: atalhos reais + estado da carga ──────────────────────── */}
        <footer className="bg-emerald-900 text-emerald-100 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => navigate('/atendimento')}
              className="flex items-center gap-1.5 text-[11px] font-medium hover:text-white transition-colors">
              <Stethoscope size={12} /> Atendimento
            </button>
            <span className="text-emerald-700">|</span>
            <button type="button" onClick={() => navigate('/execucao-prescricao')}
              className="flex items-center gap-1.5 text-[11px] font-medium hover:text-white transition-colors">
              <Syringe size={12} /> Execução de prescrição
            </button>
            <span className="text-emerald-700">|</span>
            <button type="button" onClick={() => navigate('/mapa-atendimento')}
              className="flex items-center gap-1.5 text-[11px] font-medium hover:text-white transition-colors">
              <MapPin size={12} /> Mapa de atendimento
            </button>
          </div>
          {/* "Sincronizado há X" do mockup pressupõe modo offline, que a aplicação não
              tem. O que existe de verdade é a hora da última carga — é o que mostramos. */}
          <button type="button" onClick={carregar}
            className="flex items-center gap-1.5 text-[11px] font-medium hover:text-white transition-colors">
            <RefreshCw size={11} />
            {atualizadoEm ? `Atualizado às ${horaDe(atualizadoEm.toISOString())}` : 'Atualizar'}
          </button>
        </footer>
      </div>
    </PageContainer>
  );
}
