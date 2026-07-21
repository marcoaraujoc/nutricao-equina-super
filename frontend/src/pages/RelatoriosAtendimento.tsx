// frontend/src/pages/RelatoriosAtendimento.tsx
// Indicadores de Atendimento — GET /api/relatorios/atendimento.

import { useState, useEffect } from 'react';
import { CalendarClock, MapPin } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import { StatTiles, CarregandoRelatorio, ErroRelatorio, Card, EmptyState } from '../components/relatorios/RelatorioUI';

interface AtendimentoPorAnimal { animal: string; total: number }
interface AtendimentoPorLocalidade { localizacao: string; total: number; animais: AtendimentoPorAnimal[] }

interface Atendimento {
  periodo: { agendadas: number; realizadas: number; canceladas: number; naoRealizadas: number; procedimentos: number; exames: number };
  atendimentosPorLocalidade: AtendimentoPorLocalidade[];
}

export default function RelatoriosAtendimento() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Atendimento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/atendimento', { params: periodoParams(granularidade, dataRef) })
      .then(res => { if (!res.data) return; setDados(res.data.dados as Atendimento); })
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, [loadingPerms, podeVer, granularidade, dataRef]);

  if (!loadingPerms && !podeVer) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="font-bold text-gray-800">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <CalendarClock size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Indicadores de Atendimento</h1>
          <p className="text-xs text-gray-400">Agenda e atendimentos da empresa ativa</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">No período</p>
          <StatTiles tiles={[
            { label: 'Consultas agendadas',      valor: dados.periodo.agendadas },
            { label: 'Consultas realizadas',     valor: dados.periodo.realizadas, tom: 'emerald' },
            { label: 'Consultas não realizadas', valor: dados.periodo.naoRealizadas, tom: dados.periodo.naoRealizadas > 0 ? 'amber' : 'gray' },
            { label: 'Consultas canceladas',     valor: dados.periodo.canceladas, tom: dados.periodo.canceladas > 0 ? 'red' : 'gray' },
          ]} />
          <StatTiles cols={2} tiles={[
            { label: 'Procedimentos realizados', valor: dados.periodo.procedimentos },
            { label: 'Exames solicitados',       valor: dados.periodo.exames },
          ]} />

          {/* ── Atendimentos por animal e localidade ── */}
          <Card icon={<MapPin size={16} />} titulo="Atendimentos por localidade"
            subtitulo="Evoluções finalizadas no período, por local e animal">
            {dados.atendimentosPorLocalidade.length === 0 ? (
              <EmptyState texto="Nenhum atendimento finalizado no período" />
            ) : (
              <div className="divide-y divide-gray-100">
                {dados.atendimentosPorLocalidade.map(loc => (
                  <div key={loc.localizacao} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">{loc.localizacao}</p>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        {loc.total} atendimento{loc.total !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {loc.animais.map(a => (
                        <span key={a.animal} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">
                          {a.animal} <span className="font-semibold text-gray-800">· {a.total}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
