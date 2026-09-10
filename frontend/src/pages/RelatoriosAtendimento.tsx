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
import { Link } from 'react-router-dom';
import { StatTiles, CarregandoRelatorio, ErroRelatorio, Card, EmptyState } from '../components/relatorios/RelatorioUI';
import DetalheDoCard from '../components/relatorios/DetalheDoCard';
import { formatDate } from '../utils/dateUtils';

// ⚠️ OS INDICADORES DEIXARAM DE SER LINK PARA A AGENDA (a pedido, 2026-09-08).
// Ir para `/agendamentos?status=…` trocava de tela e PERDIA o período do relatório —
// quem clicava em "Consultas canceladas" de julho caía na agenda de hoje. Agora o
// card abre a lista logo abaixo, com o mesmo recorte que ele conta.

interface AtendimentoPorAnimal { animal: string; total: number; animalId?: number | null }
interface AtendimentoPorLocalidade { localizacao: string; total: number; animais: AtendimentoPorAnimal[] }

/** Linha do detalhe — as colunas que o pedido fixou. */
interface LinhaDetalhe {
  animalId:    number | null;
  animal:      string;
  localizacao: string;
  veterinario: string | null;
  data:        string | null;
  status:      string | null;
  /** Só nos cards de "sem atendimento": há quantos dias. `null` = nunca atendido. */
  dias?:       number | null;
}

type CardId = 'agendadas' | 'realizadas' | 'naoRealizadas' | 'canceladas'
            | 'semAtendimentoDia' | 'semAtendimento3' | 'semAtendimento7';

interface Atendimento {
  periodo: {
    agendadas: number; realizadas: number; canceladas: number; naoRealizadas: number;
    procedimentos: number; exames: number;
    semAtendimentoDia: number; semAtendimento3: number; semAtendimento7: number;
  };
  atendimentosPorLocalidade: AtendimentoPorLocalidade[];
  detalhes: Record<CardId, LinhaDetalhe[]>;
}

const ROTULO_CARD: Record<CardId, string> = {
  agendadas:         'Consultas agendadas',
  realizadas:        'Consultas realizadas',
  naoRealizadas:     'Consultas não realizadas',
  canceladas:        'Consultas canceladas',
  semAtendimentoDia: 'Animais sem atendimento no dia',
  semAtendimento3:   'Animais sem atendimento há mais de 3 dias',
  semAtendimento7:   'Animais sem atendimento há mais de 7 dias',
};

/** Rótulo do status do agendamento — o mesmo vocabulário da Agenda. */
const LABEL_STATUS: Record<string, string> = {
  AGENDADO: 'Agendado', EM_ANDAMENTO: 'Em andamento', ATRASADA: 'Atrasada',
  CONCLUIDO: 'Concluído', FINALIZADO: 'Finalizado', CANCELADO: 'Cancelado',
  CANCELADO_AUTOMATICAMENTE: 'Cancelado automaticamente',
  REAGENDADO: 'Reagendado', TRANSFERIDO: 'Reagendado',
};

export default function RelatoriosAtendimento() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados, setDados] = useState<Atendimento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  // Um card aberto por vez: dois abertos exigiriam duas listas na tela e a pessoa
  // deixaria de saber qual número a de baixo está explicando.
  const [selecionado, setSelecionado] = useState<CardId | null>(null);

  /** Props de seleção do card — clicar no aberto FECHA (é o mesmo botão). */
  const card = (id: CardId) => ({
    onSelect: () => setSelecionado(a => (a === id ? null : id)),
    ativo:    selecionado === id,
  });

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    // Trocar o período troca os NÚMEROS: manter o card aberto deixaria a lista de
    // julho embaixo dos cards de agosto até o próximo clique.
    setSelecionado(null);
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
            { label: ROTULO_CARD.agendadas,     valor: dados.periodo.agendadas,     ...card('agendadas') },
            { label: ROTULO_CARD.realizadas,    valor: dados.periodo.realizadas,    tom: 'emerald', ...card('realizadas') },
            { label: ROTULO_CARD.naoRealizadas, valor: dados.periodo.naoRealizadas, tom: dados.periodo.naoRealizadas > 0 ? 'amber' : 'gray', ...card('naoRealizadas') },
            { label: ROTULO_CARD.canceladas,    valor: dados.periodo.canceladas,    tom: dados.periodo.canceladas > 0 ? 'red' : 'gray', ...card('canceladas') },
          ]} />

          {/* ── Animais SEM atendimento (a pedido, 2026-09-08; vieram do Mapa) ──
              "Atendido" é evolução FINALIZADA, o mesmo critério do resto desta tela:
              consulta marcada ou em andamento não conta, senão agenda cheia viraria
              paciente atendido. A contagem parte da data de referência do PERÍODO, não
              do relógio de agora — um relatório de julho responde sobre julho. */}
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pt-1">Sem atendimento</p>
          <StatTiles cols={3} tiles={[
            { label: ROTULO_CARD.semAtendimentoDia, valor: dados.periodo.semAtendimentoDia,
              tom: dados.periodo.semAtendimentoDia > 0 ? 'amber' : 'gray', ...card('semAtendimentoDia') },
            { label: ROTULO_CARD.semAtendimento3,   valor: dados.periodo.semAtendimento3,
              tom: dados.periodo.semAtendimento3 > 0 ? 'amber' : 'gray', ...card('semAtendimento3') },
            { label: ROTULO_CARD.semAtendimento7,   valor: dados.periodo.semAtendimento7,
              tom: dados.periodo.semAtendimento7 > 0 ? 'red' : 'gray', ...card('semAtendimento7') },
          ]} />

          {/* A lista do card aberto. Fica LOGO ABAIXO dos cards, e não no fim da
              página: o clique e a resposta têm de caber no mesmo olhar. */}
          <DetalheDoCard
            titulo={selecionado ? ROTULO_CARD[selecionado] : null}
            linhas={selecionado ? (dados.detalhes?.[selecionado] ?? []) : []}
            onFechar={() => setSelecionado(null)}
            vazio={selecionado?.startsWith('semAtendimento')
              ? 'Todos os pacientes foram atendidos neste recorte'
              : 'Nenhuma consulta neste recorte'}
            colunas={[
              { titulo: 'Paciente', celula: (l: LinhaDetalhe) => (
                l.animalId
                  ? <Link to={`/animal/${l.animalId}`} className="text-emerald-700 font-medium hover:underline">{l.animal}</Link>
                  : <span className="font-medium text-gray-800">{l.animal}</span>
              ) },
              { titulo: 'Local',        celula: (l: LinhaDetalhe) => l.localizacao || null },
              { titulo: 'Veterinário',  celula: (l: LinhaDetalhe) => l.veterinario, somenteDesktop: true },
              { titulo: 'Último atendimento', celula: (l: LinhaDetalhe) => (
                l.data
                  ? <>{formatDate(l.data)}{typeof l.dias === 'number' ? <span className="text-gray-400"> ({l.dias}d)</span> : null}</>
                  : (l.dias === null && selecionado?.startsWith('semAtendimento')
                      ? <span className="text-red-500">nunca atendido</span>
                      : null)
              ) },
              // O status só existe nas consultas — nos cards de "sem atendimento" a
              // coluna sairia vazia em todas as linhas, e coluna vazia é ruído.
              ...(selecionado && !selecionado.startsWith('semAtendimento')
                ? [{ titulo: 'Status', celula: (l: LinhaDetalhe) => (l.status ? (LABEL_STATUS[l.status] ?? l.status) : null) }]
                : []),
            ]}
          />
          {/* Procedimentos e exames NÃO viram link: o primeiro conta itens de
              prescrição executados e o segundo, pedidos de exame — e as duas telas que
              os listam são POR PACIENTE (/execucao-prescricao é a fila do dia, não o
              histórico do período). Link para uma lista que não mostra este recorte
              promete o que a página não entrega (armadilha 28-d). */}
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
                      {/* Chip do animal abre a FICHA dele (histórico do paciente), que é
                          onde os atendimentos contados aqui aparecem um a um. Sem
                          `animalId` (registro sem animal vinculado) fica texto. */}
                      {loc.animais.map(a => (
                        a.animalId ? (
                          <Link key={a.animal} to={`/animal/${a.animalId}`}
                            className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 hover:bg-emerald-100 transition-colors">
                            {a.animal} <span className="font-semibold">· {a.total}</span>
                          </Link>
                        ) : (
                          <span key={a.animal} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">
                            {a.animal} <span className="font-semibold text-gray-800">· {a.total}</span>
                          </span>
                        )
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
