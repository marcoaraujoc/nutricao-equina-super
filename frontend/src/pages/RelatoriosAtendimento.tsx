// frontend/src/pages/RelatoriosAtendimento.tsx
// Indicadores de Atendimento — GET /api/relatorios/atendimento.

import { useState, useEffect } from 'react';
import { CalendarClock } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { StatTiles, CarregandoRelatorio, ErroRelatorio } from '../components/relatorios/RelatorioUI';

interface Atendimento {
  hoje: { agendadas: number; realizadas: number };
  mes:  { atendimentos: number; canceladas: number; procedimentos: number; exames: number };
}

export default function RelatoriosAtendimento() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');

  const [dados, setDados] = useState<Atendimento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/atendimento')
      .then(res => { if (!res.data) return; setDados(res.data.dados as Atendimento); })
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, [loadingPerms, podeVer]);

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

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Hoje</p>
          <StatTiles cols={2} tiles={[
            { label: 'Consultas agendadas hoje', valor: dados.hoje.agendadas },
            { label: 'Consultas realizadas hoje', valor: dados.hoje.realizadas, tom: 'emerald' },
          ]} />

          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pt-2">No mês</p>
          <StatTiles tiles={[
            { label: 'Atendimentos no mês',     valor: dados.mes.atendimentos },
            { label: 'Consultas canceladas',    valor: dados.mes.canceladas, tom: dados.mes.canceladas > 0 ? 'red' : 'gray' },
            { label: 'Procedimentos realizados', valor: dados.mes.procedimentos },
            { label: 'Exames solicitados',       valor: dados.mes.exames },
          ]} />
        </div>
      )}
    </PageContainer>
  );
}
