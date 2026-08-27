// frontend/src/pages/Relatorios.tsx
// Módulo Relatórios — indicadores gerenciais da empresa ativa.
// Fonte: GET /api/relatorios/gerencial (RelatorioGerencialController).

import { useState, useEffect } from 'react';
import {
  BarChart3, Zap, MapPin, DollarSign, Award, Clock,
  FileWarning, Pencil, PawPrint, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import { Card, EmptyState, CelulaLink, Tabela, BigNumber, formatBRL, formatMesRef, formatData } from '../components/relatorios/RelatorioUI';

// Destinos das linhas deste relatório.
// ⚠️ O `?local=` é comparado por IGUALDADE EXATA na lista de Pacientes, contra o
// mesmo nome que o backend agrupa aqui (`nomeLocalizacao`: catálogo → texto legado →
// "Sem localização"). Mudar a regra de um lado sem o outro faz o link abrir vazio.
const PACIENTES = '/animais-vet';
const pacientesNoLocal = (local: string) => `${PACIENTES}?local=${encodeURIComponent(local)}`;

// ─── Types (espelho do payload do backend) ────────────────────────────────────

interface ContagemNome        { nome: string;        quantidade: number }
interface ContagemLocalizacao { localizacao: string; quantidade: number }

interface Emergencias {
  total:          number;
  porCavalo:      ContagemNome[];
  porLocalizacao: ContagemLocalizacao[];
}

interface ReceitaLocalidade {
  localizacao:    string;
  receitaBruta:   number;
  receitaLiquida: number;
}

interface Devedor {
  proprietarioId: number;
  nome:           string;
  telefone:       string | null;
  qtdFaturas:     number;
  totalDevido:    number;
  mesMaisAntigo:  string | null;
  mesesEmAtraso:  number;
}

interface Pagador {
  proprietarioId:  number;
  nome:            string;
  totalPago:       number;
  qtdFaturasPagas: number;
  emDia:           boolean;
}

type FaixaSemAtendimento = '3' | '7' | '15' | '30';

interface AnimalSemAtendimento {
  id:                 number;
  nome:               string;
  localizacao:        string;
  proprietario:       string;
  ultimoAtendimento:  string | null;
  diasSemAtendimento: number | null; // null = nunca atendido
  faixa:              FaixaSemAtendimento;
}

interface SemAtendimento {
  totais:  { mais3dias: number; mais7dias: number; mais15dias: number; mais30dias: number };
  animais: AnimalSemAtendimento[];
}

interface FaturaCorrigida {
  id:               number;
  /** null em fatura legada sem proprietário vinculado — aí a linha não vira link. */
  proprietarioId:   number | null;
  proprietario:     string;
  mesReferencia:    string | null;
  status:           string;
  total:            number;
  qtdCorrecoes:     number;
  ultimaCorrecaoEm: string | null;
}

interface EvolucaoEditada {
  id:                  number;
  atendimentoNumero:   string | null;
  titulo:              string;
  animal:              string;
  responsavelOriginal: string;
  editadoPor:          string;
  finalizadaEm:        string;
  editadaEm:           string;
}

interface DadosRelatorios {
  emergencias:           Emergencias;
  receitaPorLocalidade:  ReceitaLocalidade[];
  devedores:             Devedor[];
  melhoresPagadores:     Pagador[];
  semAtendimento:        SemAtendimento;
  animaisPorLocalizacao: ContagemLocalizacao[];
  faturasCorrigidas:     { total: number; faturas: FaturaCorrigida[] };
  evolucoesEditadas:     { total: number; evolucoes: EvolucaoEditada[] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAIXA_LABEL: Record<FaixaSemAtendimento, string> = {
  '3':  '+3 dias',
  '7':  '+7 dias',
  '15': '+15 dias',
  '30': '+1 mês',
};

const FAIXA_CLS: Record<FaixaSemAtendimento, string> = {
  '3':  'bg-amber-100 text-amber-700',
  '7':  'bg-orange-100 text-orange-700',
  '15': 'bg-red-100 text-red-700',
  '30': 'bg-red-200 text-red-800',
};

// ─── Página ───────────────────────────────────────────────────────────────────

export default function Relatorios() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeVer = isGestor || podeExecutar('relatorios.gerencial.ler');
  const { granularidade, data: dataRef } = usePeriodo();

  const [dados,      setDados]      = useState<DadosRelatorios | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro,       setErro]       = useState(false);

  useEffect(() => {
    if (loadingPerms || !podeVer) return;
    setCarregando(true);
    api.get('/relatorios/gerencial', { params: periodoParams(granularidade, dataRef) })
      .then(res => {
        if (!res.data) return; // GET 403 → { data: null }
        setDados(res.data.dados as DadosRelatorios);
      })
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
          <BarChart3 size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Relatórios · Gestão</h1>
          <p className="text-xs text-gray-400">Indicadores de governança da empresa ativa</p>
        </div>
      </div>

      <PeriodoSelector />

      {carregando ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={26} className="animate-spin text-emerald-600" />
        </div>
      ) : erro || !dados ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <AlertCircle size={30} className="mb-2" />
          <p className="text-sm">Não foi possível carregar os relatórios.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

          {/* ── Atendimentos emergenciais ── */}
          <Card icon={<Zap size={16} />} titulo="Atendimentos emergenciais"
            subtitulo='Lançamentos de "Atd. Emergencial" em faturas não canceladas'>
            <BigNumber valor={dados.emergencias.total} label="atendimentos emergenciais no período" />
            {dados.emergencias.total === 0 ? (
              <EmptyState texto="Nenhum atendimento emergencial registrado" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-50">
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Por cavalo</p>
                  <Tabela colunas={['Animal', 'Qtd']}>
                    {dados.emergencias.porCavalo.map(e => (
                      <tr key={e.nome}>
                        <td className="px-4 py-2 text-xs text-gray-800">{e.nome}</td>
                        <td className="px-4 py-2 text-xs text-gray-800 text-right font-semibold">{e.quantidade}</td>
                      </tr>
                    ))}
                  </Tabela>
                </div>
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Por localização</p>
                  <Tabela colunas={['Localização', 'Qtd']}>
                    {dados.emergencias.porLocalizacao.map(e => (
                      <tr key={e.localizacao}>
                        <td className="px-4 py-2 text-xs text-gray-800">{e.localizacao}</td>
                        <td className="px-4 py-2 text-xs text-gray-800 text-right font-semibold">{e.quantidade}</td>
                      </tr>
                    ))}
                  </Tabela>
                </div>
              </div>
            )}
          </Card>

          {/* ── Receita por localidade ── */}
          <Card icon={<DollarSign size={16} />} titulo="Receita por localidade"
            subtitulo="Somente faturas pagas">
            {dados.receitaPorLocalidade.length === 0 ? (
              <EmptyState texto="Nenhuma receita paga no período" />
            ) : (
              <Tabela colunas={['Localização', 'Receita recebida']}>
                {dados.receitaPorLocalidade.map(r => (
                  <tr key={r.localizacao}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">{r.localizacao}</td>
                    <td className="px-4 py-2.5 text-xs text-emerald-700 text-right font-semibold whitespace-nowrap">{formatBRL(r.receitaLiquida)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Devedores ── */}
          <Card icon={<AlertCircle size={16} />} titulo="Devedores"
            subtitulo="Proprietários com fatura de meses anteriores ainda não paga">
            {dados.devedores.length === 0 ? (
              <EmptyState texto="Nenhum devedor — todas as faturas anteriores estão pagas 🎉" />
            ) : (
              <Tabela colunas={['Proprietário', 'Meses em atraso', 'Faturas', 'Total devido']}>
                {dados.devedores.map(d => (
                  <tr key={d.proprietarioId}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">
                      {d.nome}
                      <span className="block text-[10px] text-gray-400">desde {formatMesRef(d.mesMaisAntigo)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        d.mesesEmAtraso >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {d.mesesEmAtraso} {d.mesesEmAtraso === 1 ? 'mês' : 'meses'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-800 text-right">{d.qtdFaturas}</td>
                    <td className="px-4 py-2.5 text-xs text-red-600 text-right font-semibold whitespace-nowrap">{formatBRL(d.totalDevido)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Melhores pagadores ── */}
          <Card icon={<Award size={16} />} titulo="Melhores pagadores"
            subtitulo="Ranking por total pago (faturas com status Paga)">
            {dados.melhoresPagadores.length === 0 ? (
              <EmptyState texto="Nenhuma fatura paga até o momento" />
            ) : (
              <Tabela colunas={['#', 'Proprietário', 'Faturas pagas', 'Total pago']}>
                {dados.melhoresPagadores.map((p, i) => (
                  <tr key={p.proprietarioId}>
                    <td className="px-4 py-2.5 text-xs font-bold text-gray-400">{i + 1}º</td>
                    <td className="px-4 py-2.5 text-xs text-gray-800 text-right">
                      <span className="flex items-center justify-end gap-1.5">
                        {p.nome}
                        {p.emDia && (
                          <span title="Sem faturas em atraso"><CheckCircle2 size={12} className="text-emerald-500" /></span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-800 text-right">{p.qtdFaturasPagas}</td>
                    <td className="px-4 py-2.5 text-xs text-emerald-700 text-right font-semibold whitespace-nowrap">{formatBRL(p.totalPago)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Animais sem atendimento ── */}
          <Card icon={<Clock size={16} />} titulo="Animais sem atendimento"
            subtitulo="Tempo desde a última evolução clínica registrada">
            <div className="grid grid-cols-4 divide-x divide-gray-50 border-b border-gray-50">
              {([
                ['mais3dias',  '+3 dias'],
                ['mais7dias',  '+7 dias'],
                ['mais15dias', '+15 dias'],
                ['mais30dias', '+1 mês'],
              ] as const).map(([chave, label]) => (
                <div key={chave} className="px-3 py-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{dados.semAtendimento.totais[chave]}</p>
                  <p className="text-[10px] text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            {dados.semAtendimento.animais.length === 0 ? (
              <EmptyState texto="Todos os animais foram atendidos nos últimos 3 dias" />
            ) : (
              <Tabela colunas={['Animal', 'Localização', 'Último atendimento', 'Faixa']}>
                {dados.semAtendimento.animais.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">
                      <CelulaLink to={`/animal/${a.id}`}>{a.nome}</CelulaLink>
                      <span className="block text-[10px] text-gray-400">{a.proprietario}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right">{a.localizacao}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right whitespace-nowrap">
                      {a.diasSemAtendimento === null
                        ? <span className="italic text-gray-400">nunca atendido</span>
                        : <>{formatData(a.ultimoAtendimento)} <span className="text-gray-400">({a.diasSemAtendimento}d)</span></>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${FAIXA_CLS[a.faixa]}`}>
                        {FAIXA_LABEL[a.faixa]}
                      </span>
                    </td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Animais por localização ── */}
          <Card icon={<MapPin size={16} />} titulo="Animais por localização"
            subtitulo="Animais ativos agrupados pela localização cadastrada">
            {dados.animaisPorLocalizacao.length === 0 ? (
              <EmptyState texto="Nenhum animal ativo" />
            ) : (
              <Tabela colunas={['Localização', 'Animais']}>
                {dados.animaisPorLocalizacao.map(l => (
                  <tr key={l.localizacao}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">
                      <span className="flex items-center gap-1.5">
                        <PawPrint size={11} className="text-gray-300" />
                        <CelulaLink to={pacientesNoLocal(l.localizacao)}>{l.localizacao}</CelulaLink>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-800 text-right font-semibold">{l.quantidade}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Faturas corrigidas ── */}
          <Card icon={<FileWarning size={16} />} titulo="Faturas editadas / corrigidas"
            subtitulo="Faturas que tiveram itens alterados ou removidos após o lançamento">
            <BigNumber valor={dados.faturasCorrigidas.total} label="faturas com correções" />
            {dados.faturasCorrigidas.faturas.length === 0 ? (
              <EmptyState texto="Nenhuma fatura precisou de correção" />
            ) : (
              <Tabela colunas={['Proprietário', 'Mês', 'Correções', 'Última correção']}>
                {dados.faturasCorrigidas.faturas.map(f => (
                  <tr key={f.id}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">
                      <CelulaLink to={f.proprietarioId ? `/faturamento?proprietarioId=${f.proprietarioId}` : undefined}>
                        {f.proprietario}
                      </CelulaLink>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right whitespace-nowrap">{formatMesRef(f.mesReferencia)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">
                        {f.qtdCorrecoes}×
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right whitespace-nowrap">{formatData(f.ultimaCorrecaoEm)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

          {/* ── Evoluções editadas ── */}
          <Card icon={<Pencil size={16} />} titulo="Evoluções editadas após finalização"
            subtitulo="Evoluções finalizadas que foram alteradas depois — com o responsável original">
            <BigNumber valor={dados.evolucoesEditadas.total} label="evoluções editadas após finalizar" />
            {dados.evolucoesEditadas.evolucoes.length === 0 ? (
              <EmptyState texto="Nenhuma evolução foi alterada após a finalização" />
            ) : (
              <Tabela colunas={['Atendimento', 'Responsável original', 'Editado por', 'Editada em']}>
                {dados.evolucoesEditadas.evolucoes.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 text-xs text-gray-800">
                      <span className="font-mono font-bold text-emerald-700">{e.atendimentoNumero ?? '—'}</span>
                      <span className="block text-[10px] text-gray-400 truncate max-w-[180px]">{e.animal} · {e.titulo}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-800 text-right font-medium">{e.responsavelOriginal}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right">{e.editadoPor}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right whitespace-nowrap">{formatData(e.editadaEm)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Card>

        </div>
      )}
    </PageContainer>
  );
}
