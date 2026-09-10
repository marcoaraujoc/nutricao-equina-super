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
import DetalheDoCard from '../components/relatorios/DetalheDoCard';
import { Link } from 'react-router-dom';
import { formatDate } from '../utils/dateUtils';

// ⚠️ Os cards deixaram de ser LINK para as listas de cadastro (a pedido, 2026-09-08):
// aquelas telas mostram a base INTEIRA e não sabem recortar por período nem por ato,
// então o clique em "Pacientes inativados no período" caía numa lista que não
// respondia o que foi clicado. Agora a lista abre aqui embaixo.
// ⚠️ As barras "por mês" continuam sem link, pelo mesmo motivo de sempre.

interface SerieMes { mes: string; total: number }

/** Linha do detalhe — as colunas que o pedido fixou. */
interface LinhaDetalhe {
  animalId:    number | null;
  nome:        string;
  localizacao: string | null;
  veterinario: string | null;
  data:        string | null;
  motivo:      string | null;
  por:         string | null;
}

type CardId = 'pacientesAtivos' | 'pacientesNovos' | 'pacientesInativados' | 'pacientesReativados'
            | 'clientesAtivos'  | 'clientesNovos'  | 'clientesInativados'  | 'clientesReativados';

interface Cadastro {
  pacientes: { ativos: number; novos: number; inativados: number; reativados: number; novosPorMes: SerieMes[] };
  clientes:  { ativos: number; novos: number; inativados: number; reativados: number; novosPorMes: SerieMes[] };
  detalhes:  Record<CardId, LinhaDetalhe[]>;
}

const ROTULO_CARD: Record<CardId, string> = {
  pacientesAtivos:     'Pacientes ativos',
  pacientesNovos:      'Novos pacientes no período',
  pacientesInativados: 'Pacientes inativados',
  pacientesReativados: 'Pacientes reativados',
  clientesAtivos:      'Clientes ativos',
  clientesNovos:       'Novos clientes no período',
  clientesInativados:  'Proprietários inativados',
  clientesReativados:  'Proprietários reativados',
};

/** O que a coluna de data significa muda com o card — dizer "Data" em todos seria
 *  esconder que numa é cadastro e na outra é o ato de inativar. */
const ROTULO_DATA: Record<CardId, string> = {
  pacientesAtivos:     'Cadastro',
  pacientesNovos:      'Cadastro',
  pacientesInativados: 'Inativação',
  pacientesReativados: 'Reativação',
  clientesAtivos:      'Cadastro',
  clientesNovos:       'Cadastro',
  clientesInativados:  'Inativação',
  clientesReativados:  'Reativação',
};

const EH_PACIENTE = (id: CardId) => id.startsWith('pacientes');

export default function RelatoriosCadastro() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Cadastro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [selecionado, setSelecionado] = useState<CardId | null>(null);

  /** Props de seleção do card — clicar no aberto FECHA (é o mesmo botão). */
  const card = (id: CardId) => ({
    onSelect: () => setSelecionado(a => (a === id ? null : id)),
    ativo:    selecionado === id,
  });

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    // Trocar o período troca os números — a lista aberta deixaria de corresponder.
    setSelecionado(null);
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
            { label: ROTULO_CARD.pacientesAtivos, valor: dados.pacientes.ativos, ...card('pacientesAtivos') },
            { label: ROTULO_CARD.pacientesNovos,  valor: dados.pacientes.novos, tom: 'emerald', ...card('pacientesNovos') },
            { label: ROTULO_CARD.clientesAtivos,  valor: dados.clientes.ativos, ...card('clientesAtivos') },
            { label: ROTULO_CARD.clientesNovos,   valor: dados.clientes.novos, tom: 'emerald', ...card('clientesNovos') },
          ]} />

          {/* ── Inativações e reativações do período (a pedido, 2026-09-08) ──
              Vêm do AuditLog, que é o único lugar com QUANDO, POR QUE e por QUEM —
              o cadastro guarda só o estado de agora. */}
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pt-1">Movimentação no período</p>
          <StatTiles tiles={[
            { label: ROTULO_CARD.pacientesInativados, valor: dados.pacientes.inativados,
              tom: dados.pacientes.inativados > 0 ? 'red' : 'gray', ...card('pacientesInativados') },
            { label: ROTULO_CARD.clientesInativados,  valor: dados.clientes.inativados,
              tom: dados.clientes.inativados > 0 ? 'red' : 'gray', ...card('clientesInativados') },
            { label: ROTULO_CARD.pacientesReativados, valor: dados.pacientes.reativados,
              tom: dados.pacientes.reativados > 0 ? 'emerald' : 'gray', ...card('pacientesReativados') },
            { label: ROTULO_CARD.clientesReativados,  valor: dados.clientes.reativados,
              tom: dados.clientes.reativados > 0 ? 'emerald' : 'gray', ...card('clientesReativados') },
          ]} />

          <DetalheDoCard
            titulo={selecionado ? ROTULO_CARD[selecionado] : null}
            linhas={selecionado ? (dados.detalhes?.[selecionado] ?? []) : []}
            onFechar={() => setSelecionado(null)}
            vazio="Nenhum registro neste recorte"
            colunas={[
              { titulo: selecionado && EH_PACIENTE(selecionado) ? 'Paciente' : 'Cliente',
                celula: (l: LinhaDetalhe) => (
                  l.animalId
                    ? <Link to={`/animal/${l.animalId}`} className="text-emerald-700 font-medium hover:underline">{l.nome}</Link>
                    : <span className="font-medium text-gray-800">{l.nome}</span>
                ) },
              // Local e veterinário só existem para PACIENTE — nas listas de cliente a
              // coluna sairia vazia em todas as linhas, e coluna vazia é ruído.
              ...(selecionado && EH_PACIENTE(selecionado) ? [
                { titulo: 'Local',       celula: (l: LinhaDetalhe) => l.localizacao },
                { titulo: 'Veterinário', celula: (l: LinhaDetalhe) => l.veterinario, somenteDesktop: true },
              ] : []),
              { titulo: selecionado ? ROTULO_DATA[selecionado] : 'Data',
                celula: (l: LinhaDetalhe) => (l.data ? formatDate(l.data) : null) },
              { titulo: 'Motivo', celula: (l: LinhaDetalhe) => (
                l.motivo
                  ? <span title={l.motivo} className="line-clamp-2">{l.motivo}</span>
                  : null
              ) },
              { titulo: 'Por', celula: (l: LinhaDetalhe) => l.por, somenteDesktop: true },
            ]}
          />

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
