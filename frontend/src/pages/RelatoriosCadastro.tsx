// frontend/src/pages/RelatoriosCadastro.tsx
// Indicadores de Pacientes e Clientes — GET /api/relatorios/cadastro.

import { useState, useEffect } from 'react';
import { Users, PawPrint } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import { Card, StatTiles, RankBars, CarregandoRelatorio, ErroRelatorio, formatMesRef } from '../components/relatorios/RelatorioUI';

// Pacientes → lista de Pacientes (/animais-vet); Clientes → Cadastro de Clientes.
// ⚠️ As barras "por mês" NÃO viram link: nenhuma das duas listas filtra por mês de
// cadastro, então o clique cairia na base inteira e não responderia o que foi
// clicado (armadilha 28-d).
const PACIENTES = '/animais-vet';
const CLIENTES  = '/cadastro/proprietarios';

interface SerieMes { mes: string; total: number }
interface Cadastro {
  pacientes: { ativos: number; novos: number; novosPorMes: SerieMes[] };
  clientes:  { ativos: number; novos: number; novosPorMes: SerieMes[] };
}

export default function RelatoriosCadastro() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Cadastro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/cadastro', { params: periodoParams(granularidade, dataRef) })
      .then(res => { if (!res.data) return; setDados(res.data.dados as Cadastro); })
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

  const serie = (s: SerieMes[]) => s.map(m => ({ nome: formatMesRef(m.mes), valor: m.total }));

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <Users size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pacientes & Clientes</h1>
          <p className="text-xs text-gray-400">Base ativa e novos cadastros da empresa ativa</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">
          <StatTiles tiles={[
            { label: 'Pacientes ativos',        valor: dados.pacientes.ativos, to: PACIENTES },
            { label: 'Novos pacientes no período', valor: dados.pacientes.novos, tom: 'emerald', to: PACIENTES },
            { label: 'Clientes ativos',         valor: dados.clientes.ativos, to: CLIENTES },
            { label: 'Novos clientes no período', valor: dados.clientes.novos, tom: 'emerald', to: CLIENTES },
          ]} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <Card icon={<PawPrint size={16} />} titulo="Novos pacientes por mês" subtitulo="Últimos 6 meses">
              <RankBars itens={serie(dados.pacientes.novosPorMes)} />
            </Card>
            <Card icon={<Users size={16} />} titulo="Novos clientes por mês" subtitulo="Últimos 6 meses">
              <RankBars itens={serie(dados.clientes.novosPorMes)} />
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
