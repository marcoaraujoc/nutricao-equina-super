// frontend/src/pages/RelatoriosOrcamentos.tsx
// Relatório de Orçamentos — GET /api/relatorios/orcamentos.
// Aprovados / aprovados parcialmente / rejeitados, por proprietário e por animal.

import { useState, useEffect } from 'react';
import { Receipt, Users, PawPrint, ListChecks } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import {
  Card, Tabela, StatTiles, RankBars, EmptyState, CelulaLink,
  CarregandoRelatorio, ErroRelatorio, formatBRL,
} from '../components/relatorios/RelatorioUI';

// Cada número leva à tela de Orçamentos JÁ FILTRADA pelo status correspondente —
// "1 em rascunho" só vale se der para ver QUAL. O rótulo vem do backend em texto
// ("Aprovado Parcialmente"); o filtro da tela usa o ENUM, então o de-para é aqui.
const ORC = '/orcamento';
const orcPorStatus = (status: string) => `${ORC}?status=${status}`;
const STATUS_ENUM: Record<string, string> = {
  'Aprovado':              'APROVADO',
  'Aprovado Parcialmente': 'APROVADO_PARCIALMENTE',
  'Rejeitado':             'REJEITADO',
  'Rascunho':              'RASCUNHO',
};

interface Orcamentos {
  resumo: {
    total: number; aprovados: number; parciais: number; rejeitados: number; rascunhos: number;
    valorTotal: number; valorAprovado: number;
  };
  porStatus: { status: string; quantidade: number }[];
  porProprietario: { nome: string; quantidade: number; total: number; aceito: number }[];
  porAnimal: { nome: string; total: number; aceito: number }[];
}

export default function RelatoriosOrcamentos() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Orcamentos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/orcamentos', { params: periodoParams(granularidade, dataRef) })
      .then(res => { if (!res.data) return; setDados(res.data.dados as Orcamentos); })
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
          <Receipt size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Relatório de Orçamentos</h1>
          <p className="text-xs text-gray-400">Aprovados, parciais e rejeitados — por proprietário e animal (empresa ativa)</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">
          <StatTiles cols={2} tiles={[
            { label: 'Valor total orçado',   valor: formatBRL(dados.resumo.valorTotal), to: ORC },
            { label: 'Valor aprovado',       valor: formatBRL(dados.resumo.valorAprovado), tom: 'emerald', to: orcPorStatus('APROVADO') },
          ]} />

          <StatTiles tiles={[
            { label: 'Orçamentos',           valor: String(dados.resumo.total),        to: ORC },
            { label: 'Aprovados',            valor: String(dados.resumo.aprovados),   tom: 'emerald', to: orcPorStatus('APROVADO') },
            { label: 'Aprovados parcial.',   valor: String(dados.resumo.parciais),    tom: 'amber',   to: orcPorStatus('APROVADO_PARCIALMENTE') },
            { label: 'Rejeitados',           valor: String(dados.resumo.rejeitados),  tom: 'red',     to: orcPorStatus('REJEITADO') },
            { label: 'Aguardando decisão',   valor: String(dados.resumo.rascunhos),   tom: 'amber',   to: orcPorStatus('RASCUNHO') },
          ]} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <Card icon={<ListChecks size={16} />} titulo="Por status" subtitulo="Quantidade de orçamentos por status (no período)">
              <RankBars itens={dados.porStatus.map(s => ({
                nome:  s.status,
                valor: s.quantidade,
                to:    STATUS_ENUM[s.status] ? orcPorStatus(STATUS_ENUM[s.status]) : undefined,
              }))} />
            </Card>

            <Card icon={<Users size={16} />} titulo="Por proprietário" subtitulo="Valor total e aprovado por proprietário">
              {dados.porProprietario.length === 0 ? <EmptyState texto="Nenhum orçamento no período" /> : (
                <Tabela colunas={['Proprietário', 'Orç.', 'Total', 'Aprovado']}>
                  {dados.porProprietario.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5 text-xs text-gray-800"><CelulaLink to={ORC}>{p.nome}</CelulaLink></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 text-right">{p.quantidade}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-800 text-right whitespace-nowrap">{formatBRL(p.total)}</td>
                      <td className="px-4 py-2.5 text-xs text-emerald-700 font-semibold text-right whitespace-nowrap">{formatBRL(p.aceito)}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </Card>

            <Card icon={<PawPrint size={16} />} titulo="Por animal" subtitulo="Valor total e aprovado por animal">
              {dados.porAnimal.length === 0 ? <EmptyState texto="Nenhum orçamento no período" /> : (
                <Tabela colunas={['Animal', 'Total', 'Aprovado']}>
                  {dados.porAnimal.map((a, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5 text-xs text-gray-800"><CelulaLink to={ORC}>{a.nome}</CelulaLink></td>
                      <td className="px-4 py-2.5 text-xs text-gray-800 text-right whitespace-nowrap">{formatBRL(a.total)}</td>
                      <td className="px-4 py-2.5 text-xs text-emerald-700 font-semibold text-right whitespace-nowrap">{formatBRL(a.aceito)}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
