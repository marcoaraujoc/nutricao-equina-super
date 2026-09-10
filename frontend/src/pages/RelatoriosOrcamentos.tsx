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
import DetalheDoCard from '../components/relatorios/DetalheDoCard';
import { formatDate } from '../utils/dateUtils';
import { Link } from 'react-router-dom';

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

/** Item do orçamento, na quebra que o "aprovado parcialmente" precisa mostrar. */
interface ItemOrcamento {
  id: number; descricao: string; tipo: string;
  animal: string | null; valor: number;
  statusItem: 'ACEITO' | 'REJEITADO' | 'PENDENTE';
  /** Só no recusado. Vazio quando a decisão é anterior a 2026-09-08, quando o motivo
   *  passou a ser obrigatório — inventar um retroativo seria pior que a lacuna. */
  motivo: string | null;
}

/** Linha do detalhe — as colunas que o pedido fixou. */
interface LinhaOrcamento {
  id: number; numero: number;
  proprietario: string; animal: string | null;
  data: string | null; valor: number; status: string;
  /** Recusa do orçamento inteiro, ou o motivo do CANCELAMENTO (manual ou pelo cron
   *  de validade, que o acrescenta à observação). `null` = não foi recusado. */
  motivo: string | null;
  /** 🔴 A QUEBRA POR ITEM (a pedido, 2026-09-08). Saber que "3 de 7 caíram" sem saber
   *  QUAIS e POR QUÊ não permite renegociar nada — é o que este bloco responde. */
  itens: {
    total: number; aprovados: number; recusados: number; pendentes: number;
    valorAprovado: number; valorRecusado: number;
    lista: ItemOrcamento[];
  };
}

const COR_ITEM: Record<ItemOrcamento['statusItem'], string> = {
  ACEITO:    'text-emerald-700 bg-emerald-50 border-emerald-100',
  REJEITADO: 'text-red-700 bg-red-50 border-red-100',
  PENDENTE:  'text-amber-700 bg-amber-50 border-amber-100',
};
const LABEL_ITEM: Record<ItemOrcamento['statusItem'], string> = {
  ACEITO: 'Aprovado', REJEITADO: 'Reprovado', PENDENTE: 'Sem decisão',
};

type CardId = 'valorTotal' | 'valorAprovado' | 'valorRejeitado'
            | 'aprovados' | 'parciais' | 'rejeitados' | 'cancelados' | 'rascunhos';

const ROTULO_CARD: Record<CardId, string> = {
  valorTotal:     'Valor total orçado',
  valorAprovado:  'Valor aprovado',
  valorRejeitado: 'Valor rejeitado',
  aprovados:      'Aprovados',
  parciais:       'Aprovados parcial.',
  rejeitados:     'Rejeitados',
  cancelados:     'Cancelados',
  rascunhos:      'Aguardando decisão',
};

interface Orcamentos {
  resumo: {
    total: number; aprovados: number; parciais: number; rejeitados: number; rascunhos: number;
    cancelados?: number;
    valorTotal: number; valorAprovado: number; valorRejeitado: number;
  };
  detalhes: Record<CardId, LinhaOrcamento[]>;
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
  const [selecionado, setSelecionado] = useState<CardId | null>(null);

  /** Props de seleção do card — clicar no aberto FECHA (é o mesmo botão). */
  const card = (id: CardId) => ({
    onSelect: () => setSelecionado(a => (a === id ? null : id)),
    ativo:    selecionado === id,
  });

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    setSelecionado(null);
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
          <StatTiles cols={3} tiles={[
            { label: ROTULO_CARD.valorTotal,     valor: formatBRL(dados.resumo.valorTotal), ...card('valorTotal') },
            { label: ROTULO_CARD.valorAprovado,  valor: formatBRL(dados.resumo.valorAprovado), tom: 'emerald', ...card('valorAprovado') },
            { label: ROTULO_CARD.valorRejeitado, valor: formatBRL(dados.resumo.valorRejeitado),
              tom: dados.resumo.valorRejeitado > 0 ? 'red' : 'gray', ...card('valorRejeitado') },
          ]} />

          <StatTiles tiles={[
            { label: ROTULO_CARD.aprovados,  valor: String(dados.resumo.aprovados),  tom: 'emerald', ...card('aprovados') },
            { label: ROTULO_CARD.parciais,   valor: String(dados.resumo.parciais),   tom: 'amber',   ...card('parciais') },
            { label: ROTULO_CARD.rejeitados, valor: String(dados.resumo.rejeitados), tom: 'red',     ...card('rejeitados') },
            { label: ROTULO_CARD.cancelados, valor: String(dados.resumo.cancelados ?? 0),
              tom: (dados.resumo.cancelados ?? 0) > 0 ? 'red' : 'gray', ...card('cancelados') },
            { label: ROTULO_CARD.rascunhos,  valor: String(dados.resumo.rascunhos),  tom: 'amber',   ...card('rascunhos') },
          ]} />

          {/* A lista do card aberto — proprietário, animal, data, valor e o MOTIVO,
              que é o que faltava para saber POR QUE um orçamento não virou receita. */}
          <DetalheDoCard
            titulo={selecionado ? ROTULO_CARD[selecionado] : null}
            linhas={selecionado ? (dados.detalhes?.[selecionado] ?? []) : []}
            onFechar={() => setSelecionado(null)}
            vazio="Nenhum orçamento neste recorte"
            colunas={[
              { titulo: 'Nº', celula: (l: LinhaOrcamento) => (
                <Link to={`/orcamento?orcamentoId=${l.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">
                  {String(l.numero).padStart(4, '0')}
                </Link>
              ) },
              { titulo: 'Proprietário', celula: (l: LinhaOrcamento) => l.proprietario },
              { titulo: 'Animal',       celula: (l: LinhaOrcamento) => l.animal, somenteDesktop: true },
              { titulo: 'Data',         celula: (l: LinhaOrcamento) => (l.data ? formatDate(l.data) : null) },
              // Quantos itens de quantos — é a resposta direta de "o que foi aprovado
              // parcialmente". Reprovados aparecem em vermelho, e só quando existem.
              { titulo: 'Itens', celula: (l: LinhaOrcamento) => (
                <span className="whitespace-nowrap">
                  <span className="text-emerald-700 font-semibold">{l.itens.aprovados}</span>
                  <span className="text-gray-400">/{l.itens.total}</span>
                  {l.itens.recusados > 0 && (
                    <span className="text-red-600"> · {l.itens.recusados} reprov.</span>
                  )}
                </span>
              ) },
              { titulo: 'Valor',        celula: (l: LinhaOrcamento) => formatBRL(l.valor), className: 'text-right whitespace-nowrap' },
              { titulo: 'Motivo', celula: (l: LinhaOrcamento) => (
                l.motivo ? <span title={l.motivo} className="line-clamp-2">{l.motivo}</span> : null
              ) },
            ]}
            /* 🔴 A QUEBRA POR ITEM (a pedido, 2026-09-08). O card conta orçamentos; a
               seta abre o que aconteceu DENTRO de cada um — quais itens foram
               aprovados, quais foram reprovados e por quê. Sem isto, "aprovado
               parcialmente" é um número que não deixa agir.
               ⚠️ Só quem TEM item ganha a seta: `null` faz a linha ficar comum, em vez
               de oferecer uma expansão vazia (armadilha 28-d). */
            detalheDaLinha={(l: LinhaOrcamento) => (l.itens.lista.length === 0 ? null : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span><b className="text-emerald-700">{l.itens.aprovados}</b> aprovado(s) · {formatBRL(l.itens.valorAprovado)}</span>
                  {l.itens.recusados > 0 && (
                    <span><b className="text-red-600">{l.itens.recusados}</b> reprovado(s) · {formatBRL(l.itens.valorRecusado)}</span>
                  )}
                  {l.itens.pendentes > 0 && (
                    <span><b className="text-amber-600">{l.itens.pendentes}</b> sem decisão</span>
                  )}
                </div>
                <ul className="space-y-1">
                  {l.itens.lista.map(it => (
                    <li key={it.id} className="flex items-start gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border flex-shrink-0 mt-0.5 ${COR_ITEM[it.statusItem]}`}>
                        {LABEL_ITEM[it.statusItem]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-gray-800 truncate">{it.descricao}</p>
                        <p className="text-[10px] text-gray-400">
                          {it.animal ?? 'Proprietário'}
                          {/* O motivo é o que o pedido pede junto do "quantos": sem ele
                              a lista diz o que caiu e não diz por quê. */}
                          {it.motivo ? <> · <span className="text-red-600">{it.motivo}</span></> : ''}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold text-gray-700 flex-shrink-0">{formatBRL(it.valor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          />

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
