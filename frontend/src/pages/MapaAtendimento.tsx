// frontend/src/pages/MapaAtendimento.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Users, CheckCircle2, Clock, XCircle, AlertCircle, ChevronDown, RefreshCw } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import api from '../services/api';
import { usePermissoes } from '../hooks/usePermissoes';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Localizacao { id: number; nome: string }
interface Veterinario { id: number; fullName: string }
interface AnimalInfo  { id: number; nome: string; especie?: string }

interface CronogramaItem {
  id:            number;
  tipo:          string;
  animal:        AnimalInfo;
  localizacao:   Localizacao | null;
  procedimento:  string;
  descricao:     string;
  status:        'AGENDADO' | 'CONCLUIDO' | 'CANCELADO' | 'SEM_ATENDIMENTO';
  dataHora:      string | null;
  responsavel:   string | null;
  responsavelId: number | null;
}

interface ResumoData {
  isGestor:          boolean;
  distribuicaoHaras: Array<{ id: number; nome: string; total: number }>;
  consultasClinicas: { agendado: number; concluido: number; cancelado: number; total: number; progresso: number };
  prescricoes:       { total: number; ativas: number };
  animaisSemAtendimento: { semAtendimento: number; comAtendimento: number; total: number };
  cronograma:        CronogramaItem[];
  filtros:           { localizacoes: Localizacao[]; veterinarios: Veterinario[] };
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────
interface DonutSegment {
  value:   number;
  label:   string;
  color:   string;
  id?:     string | number;
}

interface DonutChartProps {
  segments:       DonutSegment[];
  size?:          number;
  strokeWidth?:   number;
  activeId?:      string | number | null;
  onHover?:       (id: string | number | null) => void;
  onClick?:       (id: string | number | null) => void;
  centerLabel?:   string;
  centerSub?:     string;
  noDisplace?:    boolean; // desabilita o deslocamento do segmento ativo
}

function DonutChart({
  segments,
  size = 140,
  strokeWidth = 22,
  activeId,
  onHover,
  onClick,
  centerLabel,
  centerSub,
  noDisplace = false,
}: DonutChartProps) {
  const r      = (size - strokeWidth) / 2;
  const circ   = 2 * Math.PI * r;
  const total  = segments.reduce((s, seg) => s + seg.value, 0);
  const cx     = size / 2;
  const cy     = size / 2;
  const DISPLACE = 10;

  // Segmento ativo: determina label dinâmico no centro
  const activeSeg = (activeId !== null && activeId !== undefined && total > 0)
    ? segments.find((s, i) => String(s.id ?? i) === String(activeId)) ?? null
    : null;

  // Exibe o segmento ativo, ou o primeiro por padrão (igual ao estilo da imagem)
  const displaySeg = activeSeg ?? (total > 0 ? segments[0] : null);

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        {centerLabel && (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="700" fill="#9ca3af">{centerLabel}</text>
            {centerSub && <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#9ca3af">{centerSub}</text>}
          </>
        )}
      </svg>
    );
  }

  let offset = 0;
  const paths = segments.map((seg, i) => {
    const frac     = seg.value / total;
    const dash     = frac * circ;
    const gap      = circ - dash;
    const active   = !noDisplace && activeId !== undefined && activeId !== null && String(seg.id ?? i) === String(activeId);
    const midAngle = -Math.PI / 2 + 2 * Math.PI * (offset + frac / 2);
    const dx       = active ? Math.cos(midAngle) * DISPLACE : 0;
    const dy       = active ? Math.sin(midAngle) * DISPLACE : 0;
    const path = (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${gap}`}
        strokeDashoffset={(0.25 - offset) * circ}
        strokeLinecap="butt"
        style={{ transform: `translate(${dx}px, ${dy}px)`, transition: 'transform 0.2s ease', cursor: 'pointer' }}
        onMouseEnter={() => onHover?.(seg.id ?? i)}
        onMouseLeave={() => onHover?.(null)}
        onClick={() => onClick?.(seg.id ?? i)}
        onTouchStart={(e) => { e.preventDefault(); onClick?.(seg.id ?? i); }}
      />
    );
    offset += frac;
    return path;
  });

  // Centro: segmento ativo ou primeiro segmento por padrão — nome em maiúsculas + valor + %
  const pct = displaySeg ? Math.round((displaySeg.value / total) * 100) : null;
  const rawName = displaySeg?.label ?? '';
  const truncName = (rawName.length > 13 ? rawName.slice(0, 13) + '…' : rawName).toUpperCase();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      {paths}
      {displaySeg ? (
        <>
          <text x={cx} y={cy - 20} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="600" fill="#6b7280">{truncName}</text>
          <text x={cx} y={cy - 3}  textAnchor="middle" dominantBaseline="middle" fontSize="20" fontWeight="700" fill="#1f2937">{displaySeg.value}</text>
          <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#6b7280">{pct}%</text>
        </>
      ) : centerLabel ? (
        <>
          <text x={cx} y={cy - (centerSub ? 8 : 0)} textAnchor="middle" dominantBaseline="middle" fontSize="20" fontWeight="700" fill="#1f2937">{centerLabel}</text>
          {centerSub && <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#6b7280">{centerSub}</text>}
        </>
      ) : null}
    </svg>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'CONCLUIDO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
      <CheckCircle2 size={11} /> Concluído
    </span>
  );
  if (status === 'CANCELADO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <XCircle size={11} /> Cancelado
    </span>
  );
  if (status === 'SEM_ATENDIMENTO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
      <AlertCircle size={11} /> Sem atendimento
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <Clock size={11} /> Agendado
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  AGENDADO:        'Agendado',
  CONCLUIDO:       'Concluído',
  CANCELADO:       'Cancelado',
  SEM_ATENDIMENTO: 'Sem atendimento',
};

// ── Tipo badge ────────────────────────────────────────────────────────────────
const TIPO_LABELS: Record<string, string> = {
  CONSULTA:    'Consulta',
  VACINA:      'Vacina',
  RETORNO:     'Retorno',
  EXAME:       'Exame',
  PROCEDIMENTO: 'Procedimento',
};

// ── Colors ────────────────────────────────────────────────────────────────────
const HARAS_COLORS = [
  '#6366f1','#22d3ee','#f59e0b','#10b981','#f43f5e','#8b5cf6','#0ea5e9','#84cc16',
  '#ec4899','#14b8a6','#fb923c','#a78bfa',
];

// ── Custom select ─────────────────────────────────────────────────────────────
interface SelectOption { value: string; label: string }
function SimpleSelect({
  options, value, onChange, placeholder,
}: { options: SelectOption[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MapaAtendimento() {
  const { podeExecutar, loading: loadingPerms } = usePermissoes();

  const [resumo,        setResumo]        = useState<ResumoData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [dataFiltro,    setDataFiltro]    = useState(() => new Date().toISOString().slice(0, 10));
  const [localizacaoId, setLocalizacaoId] = useState('');
  const [veterinarioId, setVeterinarioId] = useState('');
  const [tipoFiltro,    setTipoFiltro]    = useState('');
  const [hoveredHaras,  setHoveredHaras]  = useState<number | null>(null);
  const [activeHaras,   setActiveHaras]   = useState<number | null>(null);
  const [activeStatus,  setActiveStatus]  = useState<string | null>(null);
  const cronogramaRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    if (loadingPerms) return;
    if (!podeExecutar('dashboard.geral.ler')) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ data: dataFiltro });
      if (localizacaoId) params.set('localizacaoId', localizacaoId);
      if (veterinarioId) params.set('veterinarioId', veterinarioId);
      const res = await api.get(`/mapa-atendimento/resumo?${params}`);
      if (res.data) setResumo(res.data.data);
    } finally {
      setLoading(false);
    }
  }, [loadingPerms, podeExecutar, dataFiltro, localizacaoId, veterinarioId]);

  useEffect(() => { carregar(); }, [carregar]);

  if (!loadingPerms && !podeExecutar('dashboard.geral.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">Você não tem permissão para visualizar esta página.</p>
        </div>
      </PageContainer>
    );
  }

  const harasSegments: DonutSegment[] = (resumo?.distribuicaoHaras ?? []).map((h, i) => ({
    value: h.total,
    label: h.nome,
    color: HARAS_COLORS[i % HARAS_COLORS.length],
    id:    h.id,
  }));
  const harasTop3 = harasSegments.slice(0, 3);

  const consultasSegments: DonutSegment[] = resumo ? [
    { value: resumo.consultasClinicas.concluido, label: 'Concluído', color: '#10b981', id: 'CONCLUIDO' },
    { value: resumo.consultasClinicas.agendado,  label: 'Agendado',  color: '#f59e0b', id: 'AGENDADO'  },
    { value: resumo.consultasClinicas.cancelado, label: 'Cancelado', color: '#f43f5e', id: 'CANCELADO' },
  ] : [];

  const semAtend    = resumo?.animaisSemAtendimento.semAtendimento ?? 0;
  const comAtend    = resumo?.animaisSemAtendimento.comAtendimento ?? 0;
  const semAtendSeg: DonutSegment[] = [
    { value: semAtend, label: 'Sem atendimento', color: '#f43f5e', id: 'SEM_ATENDIMENTO' },
    { value: comAtend, label: 'Com atendimento', color: '#10b981', id: 'COM' },
  ];

  // Filtra cronograma pelo haras clicado + status clicado + tipo.
  // Itens SEM_ATENDIMENTO só aparecem quando esse status está explicitamente selecionado.
  const cronogramaFiltrado = (resumo?.cronograma ?? []).filter(item => {
    if (item.status === 'SEM_ATENDIMENTO' && activeStatus !== 'SEM_ATENDIMENTO') return false;
    if (activeHaras !== null && (item.localizacao?.id ?? 0) !== activeHaras) return false;
    if (activeStatus && item.status !== activeStatus) return false;
    if (tipoFiltro && item.procedimento !== tipoFiltro) return false;
    return true;
  });

  const scrollToCronograma = () => {
    setTimeout(() => cronogramaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleHarasClick = (id: string | number | null) => {
    const nid = id === null ? null : Number(id);
    setActiveHaras(prev => prev === nid ? null : nid);
    if (id !== null) scrollToCronograma();
  };

  const handleStatusClick = (id: string | number | null) => {
    const sid = id === null ? null : String(id);
    setActiveStatus(prev => prev === sid ? null : sid);
    if (id !== null) scrollToCronograma();
  };

  const dataLabel = new Date(dataFiltro + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const locOpcoes: SelectOption[] = (resumo?.filtros.localizacoes ?? []).map(l => ({ value: String(l.id), label: l.nome }));
  const vetOpcoes: SelectOption[] = (resumo?.filtros.veterinarios ?? []).map(v => ({ value: String(v.id), label: v.fullName }));
  const tiposUnicos = [...new Set((resumo?.cronograma ?? [])
    .filter(c => c.status !== 'SEM_ATENDIMENTO')
    .map(c => c.procedimento))];
  const tipoOpcoes: SelectOption[] = tiposUnicos.map(t => ({ value: t, label: TIPO_LABELS[t] ?? t }));

  return (
    <PageContainer maxWidth="7xl">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mapa de Atendimento</h1>
          <p className="text-sm text-gray-500 capitalize mt-0.5">{dataLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dataFiltro}
            onChange={e => setDataFiltro(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={carregar}
            disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Filtros rápidos ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
          <MapPin size={15} className="text-indigo-500" />
          <span>Haras/Propriedades</span>
        </div>
        <SimpleSelect
          options={locOpcoes}
          value={localizacaoId}
          onChange={v => { setLocalizacaoId(v); setActiveHaras(null); }}
          placeholder="Todos"
        />
        {resumo?.isGestor && (
          <>
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500 ml-2">
              <Users size={15} className="text-indigo-500" />
              <span>Veterinário</span>
            </div>
            <SimpleSelect
              options={vetOpcoes}
              value={veterinarioId}
              onChange={setVeterinarioId}
              placeholder="Todos"
            />
          </>
        )}
      </div>

      {/* ── Cards de KPI ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">

        {/* Card 1 — Distribuição por Haras */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Distribuição por Haras</h2>
          <div className="flex items-center justify-center mb-3">
            <DonutChart
              segments={harasSegments}
              activeId={hoveredHaras ?? activeHaras}
              onHover={id => setHoveredHaras(id === null ? null : Number(id))}
              onClick={handleHarasClick}
              centerLabel={String(resumo?.animaisSemAtendimento.total ?? 0)}
              centerSub="animais"
            />
          </div>
          <div className="space-y-1.5 pr-1">
            {harasTop3.map((seg, i) => (
              <button
                key={seg.id}
                onClick={() => handleHarasClick(seg.id ?? null)}
                className={`w-full flex items-center justify-between text-xs rounded-lg px-2 py-1 transition-colors ${
                  activeHaras === seg.id ? 'bg-indigo-50 font-semibold' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: HARAS_COLORS[i % HARAS_COLORS.length] }} />
                  <span className="truncate max-w-[120px] text-left">{seg.label}</span>
                </span>
                <span className="font-semibold text-gray-700">{seg.value}</span>
              </button>
            ))}
            {harasSegments.length === 0 && <p className="text-xs text-gray-400 text-center py-2">Sem dados</p>}
          </div>
        </div>

        {/* Card 2 — Consultas Clínicas */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Consultas Clínicas</h2>
          <div className="flex items-center justify-center mb-3">
            <DonutChart
              segments={consultasSegments}
              activeId={activeStatus}
              onHover={() => {}}
              onClick={handleStatusClick}
              centerLabel={String(resumo?.consultasClinicas.total ?? 0)}
              centerSub="total"
              noDisplace
            />
          </div>
          <div className="space-y-1.5">
            {consultasSegments.map(seg => (
              <button
                key={seg.id}
                onClick={() => handleStatusClick(seg.id ?? null)}
                className={`w-full flex items-center justify-between text-xs rounded-lg px-2 py-1 transition-colors ${
                  activeStatus === seg.id ? 'bg-indigo-50 font-semibold' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
                  {seg.label}
                </span>
                <span className="font-semibold text-gray-700">{seg.value}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Card 3 — Prescrições/Dosagens */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Prescrições / Dosagens</h2>
          <div className="flex items-center justify-center mb-3">
            <DonutChart
              segments={[
                { value: resumo?.prescricoes.ativas ?? 0, label: 'Ativas', color: '#6366f1', id: 'ATIVAS' },
                { value: Math.max(0, (resumo?.animaisSemAtendimento.total ?? 0) - (resumo?.prescricoes.ativas ?? 0)), label: 'Sem prescrição', color: '#e5e7eb', id: 'SEM' },
              ]}
              centerLabel={String(resumo?.prescricoes.total ?? 0)}
              centerSub="prescrições"
              noDisplace
            />
          </div>
          <div className="mt-3 text-center">
            <p className="text-xs text-gray-500">Prescrições com protocolo ativo no dia</p>
          </div>
        </div>

        {/* Card 4 — Animais sem Atendimento */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Animais sem Atendimento</h2>
          <div className="flex items-center justify-center mb-3">
            <DonutChart
              segments={semAtendSeg}
              activeId={activeStatus}
              onHover={() => {}}
              onClick={handleStatusClick}
              centerLabel={String(semAtend)}
              centerSub="pendentes"
              noDisplace
            />
          </div>
          <div className="space-y-1.5">
            {semAtendSeg.map(seg => (
              <div key={seg.id} className="flex items-center justify-between text-xs px-2 py-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
                  {seg.label}
                </span>
                <span className="font-semibold text-gray-700">{seg.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cronograma Diário ────────────────────────────────────────── */}
      <div ref={cronogramaRef} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cronograma Diário de Atendimentos</h2>
            {(activeHaras !== null || activeStatus) && (
              <p className="text-xs text-indigo-600 mt-0.5">
                Filtrado
                {activeHaras !== null && ` por ${resumo?.distribuicaoHaras.find(h => h.id === activeHaras)?.nome ?? 'haras'}`}
                {activeStatus && ` · ${STATUS_LABELS[activeStatus] ?? activeStatus}`}
                {' — '}
                <button onClick={() => { setActiveHaras(null); setActiveStatus(null); }} className="underline">limpar</button>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SimpleSelect
              options={tipoOpcoes}
              value={tipoFiltro}
              onChange={setTipoFiltro}
              placeholder="Todos os Procedimentos"
            />
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Animal</th>
                <th className="px-4 py-3">Procedimento</th>
                <th className="px-4 py-3">O que precisa ser feito</th>
                <th className="px-4 py-3">Horário</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    <RefreshCw size={18} className="inline animate-spin mr-2" />Carregando...
                  </td>
                </tr>
              )}
              {!loading && cronogramaFiltrado.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    <AlertCircle size={20} className="inline mb-1 mr-1" />
                    Nenhum atendimento encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
              {cronogramaFiltrado.map(item => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{item.animal.nome}</div>
                    {item.localizacao && <div className="text-xs text-gray-400">{item.localizacao.nome}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {item.status === 'SEM_ATENDIMENTO' ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {TIPO_LABELS[item.procedimento] ?? item.procedimento}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs">
                    <span className="line-clamp-2">{item.descricao}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {item.dataHora
                      ? new Date(item.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {item.responsavel ?? <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {loading && (
            <div className="p-6 text-center text-gray-400">
              <RefreshCw size={18} className="inline animate-spin mr-2" />Carregando...
            </div>
          )}
          {!loading && cronogramaFiltrado.length === 0 && (
            <div className="p-6 text-center text-gray-400">
              <AlertCircle size={20} className="inline mb-1 mr-1" />
              Nenhum atendimento encontrado.
            </div>
          )}
          {cronogramaFiltrado.map(item => (
            <div key={item.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900">{item.animal.nome}</div>
                  {item.localizacao && <div className="text-xs text-gray-400">{item.localizacao.nome}</div>}
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {item.status !== 'SEM_ATENDIMENTO' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                    {TIPO_LABELS[item.procedimento] ?? item.procedimento}
                  </span>
                )}
                {item.dataHora && (
                  <span>{new Date(item.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
              <p className="text-sm text-gray-600">{item.descricao}</p>
              {item.responsavel && (
                <p className="text-xs text-gray-400">Responsável: {item.responsavel}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
