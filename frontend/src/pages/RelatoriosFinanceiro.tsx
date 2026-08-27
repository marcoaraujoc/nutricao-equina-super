// frontend/src/pages/RelatoriosFinanceiro.tsx
// Relatórios Financeiros — GET /api/relatorios/financeiro.

import { useState, useEffect } from 'react';
import { DollarSign, Stethoscope, Layers, TrendingUp, Wallet } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import AnaliseFinanceiraIA from '../components/relatorios/AnaliseFinanceiraIA';
import {
  Card, Tabela, StatTiles, RankBars, EmptyState,
  CarregandoRelatorio, ErroRelatorio, formatBRL, formatMesRef,
} from '../components/relatorios/RelatorioUI';

// Os números de recebíveis levam ao Faturamento JÁ FILTRADO pelo status equivalente.
// ⚠️ Receita por categoria/especialidade e o fluxo de caixa NÃO viram link: não
// existe tela que liste faturas por categoria, por especialidade ou por mês
// projetado — e link que cai numa lista sem esse recorte promete o que a página não
// entrega (armadilha 28-d).
const FAT = '/faturamento';
const fatura = (status: string) => `${FAT}?status=${status}`;

interface Financeiro {
  faturamento: { periodo: number; ano: number; granularidade: string };
  ticketMedio: { porAtendimento: number; porCliente: number; atendimentosPeriodo: number; clientesPeriodo: number };
  porEspecialidade: { especialidade: string; receita: number }[];
  porCategoria:     { categoria: string;     receita: number }[];
  contasReceber:  number;
  contasVencidas: number;
  inadimplencia:  number;
  fluxoCaixa: { mediaMensal: number; historico: FluxoItem[]; projecao: FluxoItem[] };
  lucroBruto: { receita: number; custoProdutos: number; lucro: number; margemPct: number };
}
interface FluxoItem { mes: string; valor: number; tipo: 'realizado' | 'projetado' }

export default function RelatoriosFinanceiro() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Financeiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/financeiro', { params: periodoParams(granularidade, dataRef) })
      .then(res => { if (!res.data) return; setDados(res.data.dados as Financeiro); })
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
          <DollarSign size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Relatórios Financeiros</h1>
          <p className="text-xs text-gray-400">Faturamento, recebíveis e resultado da empresa ativa</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? <CarregandoRelatorio /> : (erro || !dados) ? <ErroRelatorio /> : (
        <div className="space-y-4">

          {/* IA Financeira — leitura dos indicadores do período (sob demanda) */}
          <AnaliseFinanceiraIA granularidade={granularidade} dataRef={dataRef} />

          {/* Faturamento */}
          <StatTiles cols={2} tiles={[
            { label: 'Faturamento no período', valor: formatBRL(dados.faturamento.periodo), to: fatura('PAGA') },
            { label: 'Acumulado do ano',       valor: formatBRL(dados.faturamento.ano), tom: 'emerald', to: fatura('PAGA') },
          ]} />

          {/* Ticket médio + recebíveis */}
          <StatTiles tiles={[
            { label: 'Ticket médio / atendimento', valor: formatBRL(dados.ticketMedio.porAtendimento), hint: `${dados.ticketMedio.atendimentosPeriodo} atendimentos no período`, to: FAT },
            { label: 'Ticket médio / cliente',     valor: formatBRL(dados.ticketMedio.porCliente),     hint: `${dados.ticketMedio.clientesPeriodo} clientes no período`, to: FAT },
            { label: 'Contas a receber',           valor: formatBRL(dados.contasReceber),              tom: 'amber', to: fatura('FECHADA') },
            { label: 'Inadimplência',              valor: `${dados.inadimplencia.toFixed(1)}%`,        tom: dados.inadimplencia >= 20 ? 'red' : 'amber', hint: formatBRL(dados.contasVencidas) + ' vencido', to: fatura('ATRASADA') },
          ]} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* Receita por categoria */}
            <Card icon={<Layers size={16} />} titulo="Receita por categoria"
              subtitulo="Consultas · Cirurgias · Vacinas · Exames · Farmácia (no período)">
              <RankBars formato="brl" itens={dados.porCategoria.map(c => ({ nome: c.categoria, valor: c.receita }))} />
            </Card>

            {/* Receita por especialidade */}
            <Card icon={<Stethoscope size={16} />} titulo="Receita por especialidade"
              subtitulo="Pela especialidade da evolução de origem do item (no período)">
              <RankBars formato="brl" itens={dados.porEspecialidade.map(e => ({ nome: e.especialidade, valor: e.receita }))} />
            </Card>

            {/* Lucro bruto estimado */}
            <Card icon={<TrendingUp size={16} />} titulo="Lucro bruto estimado"
              subtitulo="Receita do período − custo dos produtos consumidos (estimativa)">
              <div className="px-5 py-4 space-y-2 text-sm">
                <Linha label="Receita do período"    valor={formatBRL(dados.lucroBruto.receita)} />
                <Linha label="Custo dos produtos"    valor={'− ' + formatBRL(dados.lucroBruto.custoProdutos)} tom="text-red-600" />
                <div className="border-t border-gray-100 pt-2 flex items-center justify-between">
                  <span className="font-semibold text-gray-700">Lucro bruto</span>
                  <span className={`font-bold ${dados.lucroBruto.lucro >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatBRL(dados.lucroBruto.lucro)} <span className="text-xs text-gray-400">({dados.lucroBruto.margemPct.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>
            </Card>

            {/* Fluxo de caixa projetado */}
            <Card icon={<Wallet size={16} />} titulo="Fluxo de caixa projetado"
              subtitulo={`Projeção pela média dos últimos 3 meses recebidos (${formatBRL(dados.fluxoCaixa.mediaMensal)}/mês)`}>
              {dados.fluxoCaixa.historico.length === 0 && dados.fluxoCaixa.projecao.length === 0 ? (
                <EmptyState texto="Sem histórico de recebimentos" />
              ) : (
                <Tabela colunas={['Mês', 'Situação', 'Valor']}>
                  {[...dados.fluxoCaixa.historico, ...dados.fluxoCaixa.projecao].map(f => (
                    <tr key={f.mes + f.tipo}>
                      <td className="px-4 py-2.5 text-xs text-gray-800">{formatMesRef(f.mes)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          f.tipo === 'realizado' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {f.tipo === 'realizado' ? 'Recebido' : 'Projetado'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-800 text-right font-semibold whitespace-nowrap">{formatBRL(f.valor)}</td>
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

function Linha({ label, valor, tom }: { label: string; valor: string; tom?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${tom ?? 'text-gray-800'}`}>{valor}</span>
    </div>
  );
}
