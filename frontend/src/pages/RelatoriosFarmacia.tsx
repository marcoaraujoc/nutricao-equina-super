// frontend/src/pages/RelatoriosFarmacia.tsx
// Relatórios de Farmácia e Estoque — GET /api/relatorios/farmacia.

import { useState, useEffect } from 'react';
import { Boxes, AlertTriangle, CalendarX, Ban, Syringe, Pill, Activity } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import {
  Card, Tabela, StatTiles, RankBars, EmptyState,
  CarregandoRelatorio, ErroRelatorio, formatBRL, formatNum, formatData,
} from '../components/relatorios/RelatorioUI';

interface ItemMin  { nome: string; qtd: number | null; minimo?: number; lote: string | null }
interface ItemVal  { categoria: string; nome: string; lote: string | null; validade: string | null; qtd: number | null }
interface ItemSem  { nome: string; qtd: number | null; lote: string | null; validade: string | null }
interface Ranking  { nome: string; quantidade: number }

interface Farmacia {
  valorTotalEstoque: number;
  totais: { abaixoMinimo: number; vencidos: number; vencendo: number; semMovimentacao: number };
  abaixoMinimo: ItemMin[];
  vencidos:  ItemVal[];
  vencendo:  ItemVal[];
  semMovimentacao: ItemSem[];
  consumo: {
    medicamentosMaisVendidos: Ranking[];
    procedimentosMaisRealizados: Ranking[];
    vacinasMaisAplicadas: Ranking[];
    giroEstoque: number;
  };
}

export default function RelatoriosFarmacia() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Farmacia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/farmacia', { params: periodoParams(granularidade, dataRef) })
      .then(res => { if (!res.data) return; setDados(res.data.dados as Farmacia); })
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

  const badgeCategoria = (c: string) =>
    c === 'Vacina' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700';

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <Boxes size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Farmácia & Estoque</h1>
          <p className="text-xs text-gray-400">Posição de estoque, alertas e consumo da empresa ativa</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">
          <StatTiles tiles={[
            { label: 'Valor total em estoque', valor: formatBRL(dados.valorTotalEstoque), tom: 'emerald' },
            { label: 'Abaixo do mínimo',       valor: dados.totais.abaixoMinimo, tom: dados.totais.abaixoMinimo > 0 ? 'red' : 'gray' },
            { label: 'Vencendo (30 dias)',     valor: dados.totais.vencendo, tom: dados.totais.vencendo > 0 ? 'amber' : 'gray' },
            { label: 'Vencidos',               valor: dados.totais.vencidos, tom: dados.totais.vencidos > 0 ? 'red' : 'gray' },
          ]} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* Abaixo do mínimo */}
            <Card icon={<AlertTriangle size={16} />} titulo="Produtos abaixo do estoque mínimo">
              {dados.abaixoMinimo.length === 0 ? <EmptyState texto="Nenhum produto abaixo do mínimo" /> : (
                <Tabela colunas={['Produto', 'Lote', 'Atual', 'Mínimo']}>
                  {dados.abaixoMinimo.map((i, k) => (
                    <tr key={i.nome + k}>
                      <td className="px-4 py-2 text-xs text-gray-800">{i.nome}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 text-right">{i.lote ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-red-600 text-right font-semibold">{formatNum(i.qtd ?? 0)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 text-right">{formatNum(i.minimo ?? 0)}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </Card>

            {/* Sem movimentação */}
            <Card icon={<Ban size={16} />} titulo="Produtos sem movimentação"
              subtitulo="Sem saídas no período selecionado">
              {dados.semMovimentacao.length === 0 ? <EmptyState texto="Todos os produtos tiveram saída recente" /> : (
                <Tabela colunas={['Produto', 'Lote', 'Em estoque']}>
                  {dados.semMovimentacao.map((i, k) => (
                    <tr key={i.nome + k}>
                      <td className="px-4 py-2 text-xs text-gray-800">{i.nome}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 text-right">{i.lote ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-800 text-right font-semibold">{formatNum(i.qtd ?? 0)}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </Card>

            {/* Vencendo */}
            <Card icon={<CalendarX size={16} />} titulo="Próximos do vencimento" subtitulo="Vencem em até 30 dias">
              <ListaValidade itens={dados.vencendo} vazio="Nada vencendo nos próximos 30 dias" badge={badgeCategoria} tomData="text-amber-600" />
            </Card>

            {/* Vencidos */}
            <Card icon={<CalendarX size={16} />} titulo="Produtos vencidos">
              <ListaValidade itens={dados.vencidos} vazio="Nenhum produto vencido 🎉" badge={badgeCategoria} tomData="text-red-600" />
            </Card>
          </div>

          {/* Consumo */}
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pt-2">Consumo</p>
          <StatTiles cols={2} tiles={[
            { label: 'Giro de estoque (no período, estimado)', valor: `${dados.consumo.giroEstoque.toFixed(2)}×`, hint: 'saídas ÷ valor atual em estoque' },
          ]} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            <Card icon={<Pill size={16} />} titulo="Medicamentos mais vendidos">
              <RankBars itens={dados.consumo.medicamentosMaisVendidos.map(m => ({ nome: m.nome, valor: m.quantidade }))} />
            </Card>
            <Card icon={<Syringe size={16} />} titulo="Vacinas mais aplicadas">
              <RankBars itens={dados.consumo.vacinasMaisAplicadas.map(m => ({ nome: m.nome, valor: m.quantidade }))} />
            </Card>
            <Card icon={<Activity size={16} />} titulo="Procedimentos mais realizados">
              <RankBars itens={dados.consumo.procedimentosMaisRealizados.map(m => ({ nome: m.nome, valor: m.quantidade }))} />
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function ListaValidade({ itens, vazio, badge, tomData }: {
  itens: ItemVal[]; vazio: string; badge: (c: string) => string; tomData: string;
}) {
  if (itens.length === 0) return <EmptyState texto={vazio} />;
  return (
    <Tabela colunas={['Produto', 'Tipo', 'Validade', 'Qtd']}>
      {itens.map((i, k) => (
        <tr key={i.nome + k}>
          <td className="px-4 py-2 text-xs text-gray-800">
            {i.nome}
            {i.lote && <span className="block text-[10px] text-gray-400">Lote {i.lote}</span>}
          </td>
          <td className="px-4 py-2 text-right">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badge(i.categoria)}`}>{i.categoria}</span>
          </td>
          <td className={`px-4 py-2 text-xs text-right font-semibold whitespace-nowrap ${tomData}`}>{formatData(i.validade)}</td>
          <td className="px-4 py-2 text-xs text-gray-800 text-right">{formatNum(i.qtd ?? 0)}</td>
        </tr>
      ))}
    </Tabela>
  );
}
