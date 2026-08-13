// src/components/GraficosAnimalPanel.tsx
//
// Gráficos do animal (AnimalDetail): peso ao longo do tempo (tb_animal_historico,
// gravado só quando o peso muda de verdade — ver lib/animalHistorico.js do backend)
// e a evolução de UM parâmetro de exame (ExameClinicoResultadoItem) num período.
// Período opcional (De/Até) filtra os dois gráficos ao mesmo tempo.

import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Loader2 } from 'lucide-react';
import api from '../services/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface PontoPeso {
  peso:         number;
  registradoEm: string;
}

interface PontoExame {
  exameId:    number;
  numero:     number | null;
  data:       string;
  valor:      string;
  unidade:    string | null;
  referencia: string | null;
}

interface Props {
  animalId: string;
}

const formatDataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const OPCOES_COMUNS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: false } },
} as const;

export default function GraficosAnimalPanel({ animalId }: Props) {
  const [inicio, setInicio] = useState('');
  const [fim,    setFim]    = useState('');

  const [pesoPontos,     setPesoPontos]     = useState<PontoPeso[]>([]);
  const [carregandoPeso, setCarregandoPeso] = useState(false);

  const [parametros,          setParametros]          = useState<string[]>([]);
  const [parametroEscolhido,  setParametroEscolhido]  = useState('');
  const [examePontos,         setExamePontos]         = useState<PontoExame[]>([]);
  const [carregandoExame,     setCarregandoExame]     = useState(false);

  const periodoQS = useCallback(() => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim)    p.set('fim', fim);
    return p;
  }, [inicio, fim]);

  const carregarPeso = useCallback(async () => {
    if (!animalId) return;
    setCarregandoPeso(true);
    try {
      const res = await api.get(`/clinica/animais/${animalId}/grafico-peso?${periodoQS().toString()}`);
      // GET 403 resolve com data null (interceptor) — sem guard, estoura TypeError
      if (res.data) setPesoPontos(res.data.dados ?? []);
    } catch {
      // silencioso — gráfico vazio é um estado válido
    } finally {
      setCarregandoPeso(false);
    }
  }, [animalId, periodoQS]);

  useEffect(() => { carregarPeso(); }, [carregarPeso]);

  useEffect(() => {
    if (!animalId) return;
    api.get(`/clinica/animais/${animalId}/exames-parametros`)
      .then(res => { if (res.data) setParametros(res.data.dados ?? []); })
      .catch(() => setParametros([]));
  }, [animalId]);

  const carregarExame = useCallback(async () => {
    if (!animalId || !parametroEscolhido) { setExamePontos([]); return; }
    setCarregandoExame(true);
    try {
      const p = periodoQS();
      p.set('parametro', parametroEscolhido);
      const res = await api.get(`/clinica/animais/${animalId}/grafico-exame?${p.toString()}`);
      if (res.data) setExamePontos(res.data.dados ?? []);
    } catch {
      // silencioso
    } finally {
      setCarregandoExame(false);
    }
  }, [animalId, parametroEscolhido, periodoQS]);

  useEffect(() => { carregarExame(); }, [carregarExame]);

  const pesoData = {
    labels: pesoPontos.map(p => formatDataCurta(p.registradoEm)),
    datasets: [{
      label: 'Peso (kg)',
      data: pesoPontos.map(p => p.peso),
      borderColor: '#059669',
      backgroundColor: 'rgba(5,150,105,0.12)',
      fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#059669',
    }],
  };

  const unidadeExame = examePontos.find(p => p.unidade)?.unidade;
  const exameData = {
    labels: examePontos.map(p => formatDataCurta(p.data)),
    datasets: [{
      label: `${parametroEscolhido}${unidadeExame ? ` (${unidadeExame})` : ''}`,
      data: examePontos.map(p => Number(String(p.valor).replace(',', '.'))),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37,99,235,0.12)',
      fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2563eb',
    }],
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 bg-emerald-500 rounded-full" />
          <h2 className="font-bold text-gray-900">Gráficos</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">De</label>
          <input type="date" value={inicio} onChange={e => setInicio(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-500" />
          <label className="text-xs text-gray-400">até</label>
          <input type="date" value={fim} onChange={e => setFim(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Peso */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Peso</p>
            {carregandoPeso && <Loader2 size={13} className="animate-spin text-emerald-600" />}
          </div>
          {pesoPontos.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-10">Sem histórico de peso no período</p>
          ) : (
            <div className="h-56"><Line data={pesoData} options={OPCOES_COMUNS} /></div>
          )}
        </div>

        {/* Evolução de exame */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Evolução de exame</p>
            <div className="flex items-center gap-1.5">
              <select value={parametroEscolhido} onChange={e => setParametroEscolhido(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-500 bg-white">
                <option value="">Selecione um parâmetro…</option>
                {parametros.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {carregandoExame && <Loader2 size={13} className="animate-spin text-emerald-600" />}
            </div>
          </div>
          {!parametroEscolhido ? (
            <p className="text-sm text-gray-300 text-center py-10">Escolha um parâmetro para ver a evolução</p>
          ) : examePontos.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-10">Sem resultados numéricos desse parâmetro no período</p>
          ) : (
            <div className="h-56"><Line data={exameData} options={OPCOES_COMUNS} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
