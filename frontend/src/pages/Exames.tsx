import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import InlineError from '../components/InlineError';
import { Eye, Calendar, Edit, Trash2, Microscope, ClipboardList, Scan } from 'lucide-react';
import AnimalCard from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import SeletorAnimal from '../components/SeletorAnimal';
import PageContainer from '../components/PageContainer';
import { formatDate } from '../utils/dateUtils';
import DateInputBR from '../components/DateInputBR';
import ModalJustificativa from '../components/ModalJustificativa';
import ExamesSolicitadosPanel, { type ExameSolicitado } from '../components/ExamesSolicitadosPanel';
import { temResultadoExame } from '../utils/exameClinico';

const Exames = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();
  const [searchParams] = useSearchParams();
  // Submenu do Sidebar (Resultado de Exame > Laboratorial | Imagem) — o título acompanha
  const tipoExame = (searchParams.get('tipo') ?? '').toLowerCase();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('atendimento.exames.editar');
  const podeDeletar = isGestor || podeExecutar('atendimento.exames.deletar');
  const [erroInline, setErroInline] = useState<string | null>(null);
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [exames, setExames] = useState<any[]>([]);
  const [currentAnimal, setCurrentAnimal] = useState<any>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [confirmId,  setConfirmId]  = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [nutrientes, setNutrientes] = useState<any[]>([]);
  const [filtroData,      setFiltroData]      = useState('');
  const [filtroExame,     setFiltroExame]     = useState('');
  const [filtroStatus,    setFiltroStatus]    = useState('');
  // Exames CLÍNICOS (Laboratorial/Bioquímico/Imagem) já REALIZADOS/CONCLUIDOS desta
  // aba — vêm do ExamesSolicitadosPanel (sistema separado do exame nutricional
  // abaixo) e são exibidos dentro do MESMO card "Resultados do Exame": é onde o
  // usuário espera ver o que acabou de salvar, não numa seção à parte.
  const [resultadosClinicos, setResultadosClinicos] = useState<ExameSolicitado[]>([]);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  // Imagens armazenadas (página Resultado de Exame · Imagem)
  const [imagensAnexos, setImagensAnexos] = useState<any[]>([]);
  useEffect(() => {
    if (loadingPerms || tipoExame !== 'imagem' || !effectiveAnimalId) { setImagensAnexos([]); return; }
    api.get(`/exames/imagens/animal/${effectiveAnimalId}`)
      .then(r => { if (r.data) setImagensAnexos(r.data.dados ?? []); })
      .catch(() => setImagensAnexos([]));
  }, [loadingPerms, tipoExame, effectiveAnimalId]);

  useEffect(() => {
    const loadNutrientes = async () => {
      try {
        const res = await api.get('/nutrientes');
        setNutrientes(res.data);
      } catch (err) {
        console.error('Erro ao carregar nutrientes:', err);
      }
    };
    loadNutrientes();
  }, []);

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data?.dados ?? res.data ?? [];
      setAnimaisDoProprietario(lista);
      // Auto-seleciona um animal quando não há seleção (evita o falso "sem animais"
      // para gestor/vet com vários pacientes)
      if (lista.length > 0 && !selectedAnimal) {
        const alvo = (animalId && lista.find((a: { id: number }) => String(a.id) === animalId)) || lista[0];
        setSelectedAnimal({
          ...alvo,
          photoUrl:       alvo.photoUrl       ?? undefined,
          dataNascimento: alvo.dataNascimento ?? undefined,
        });
        if (!animalId) {
          const qs = searchParams.toString();
          navigate(`/exames/${alvo.id}${qs ? `?${qs}` : ''}`, { replace: true });
        }
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  };

  const loadExamesAndAnimal = async () => {
    if (!effectiveAnimalId) return;
    try {
      const resExames = await api.get(`/exames/animal/${effectiveAnimalId}`);
      setExames(resExames.data?.dados ?? resExames.data ?? []);
      const resAnimal = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(resAnimal.data?.dados ?? resAnimal.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

  useEffect(() => {
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([loadAnimais(), loadExamesAndAnimal()]).finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id, loadingPerms]);

  // Os botões "Carregar Resultado" e "Preencher Manualmente" que ficavam FORA do card
  // foram retirados a pedido — os dois caminhos agora vivem em cada linha do card de
  // exames solicitados (ExamesSolicitadosPanel), junto do exame a que se referem.
  // ⚠️ Com eles saiu a única entrada para `/exames/:animalId/novo`
  // (CriaExameNutricional — criação de EXAME NUTRICIONAL, outro módulo; ver armadilha
  // 27 do CLAUDE.md). A rota continua montada; se aquele fluxo voltar a ser necessário,
  // precisa de um ponto de entrada novo.

  const startEdit = (ex: any) => { setEditingId(ex.id); setEditValues({ ...ex }); };
  const cancelEdit = () => { setEditingId(null); setEditValues({}); };

  const saveEdit = async (id: number) => {
    if (!podeEditar) { semPermissao('editar exame'); return; }
    try {
      await api.put(`/exames/${id}`, editValues);
      setExames(exames.map(ex => ex.id === id ? { ...ex, ...editValues } : ex));
      setEditingId(null);
      setEditValues({});
      setErroInline(null);
    } catch {
      setErroInline('Erro ao salvar edição');
    }
  };

  const handleDelete = (id: number) => {
    if (!podeDeletar) { semPermissao('excluir exame'); return; }
    setConfirmId(id);
  };

  const handleDeleteConfirmado = async (motivo: string) => {
    if (confirmId == null) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await api.delete(`/exames/${id}`, { data: { motivo } });
      setExames(exames.filter(ex => ex.id !== id));
      setErroInline(null);
    } catch (error) {
      setErroInline('Erro ao excluir o exame');
      console.error(error);
    }
  };

  const getStatus = (ex: any) => {
    const valor = parseFloat(ex.valorEncontrado);
    const min   = parseFloat(ex.valorMinRef);
    const max   = parseFloat(ex.valorMaxRef);
    if ((min === 0 && max === 0) || (isNaN(min) && isNaN(max))) return 'naoCalculado';
    if (isNaN(valor) || isNaN(min) || isNaN(max)) return 'normal';
    if (valor < min) return 'baixo';
    if (valor > max) return 'alto';
    return 'normal';
  };

  const examesFiltrados = useMemo(() => exames.filter(ex => {
    if (filtroData && ex.dataExame?.split('T')[0] !== filtroData) return false;
    if (filtroExame && !(ex.nutriente?.nome ?? '').toLowerCase().includes(filtroExame.toLowerCase())) return false;
    if (filtroStatus && getStatus(ex) !== filtroStatus) return false;
    return true;
  }), [exames, filtroData, filtroExame, filtroStatus]);

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.ler')) return (
    <PageContainer>
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar exames.</p>
      </div>
    </PageContainer>
  );

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!effectiveAnimalId) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">Você ainda não possui animais sob sua responsabilidade.</p>
        <p className="text-gray-400 text-xs mt-1">Solicite o vínculo com um animal para começar.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div className="space-y-5">

        <BotaoVoltar />

        <InlineError message={erroInline} />

        {/* Cabeçalho de página (mesmo padrão de Agendamentos): ícone em box + título por submenu */}
        <div className="mt-2 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            {tipoExame === 'laboratorial' ? <ClipboardList size={20} className="text-emerald-700" />
              : tipoExame === 'imagem'    ? <Scan          size={20} className="text-emerald-700" />
              :                             <Microscope    size={20} className="text-emerald-700" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {tipoExame === 'laboratorial' ? 'Resultado de Exame · Laboratorial'
                : tipoExame === 'imagem'    ? 'Resultado de Exame · Imagem'
                :                             'Resultado de Exame'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Resultados de exames do paciente e comparação com os valores de referência.
            </p>
          </div>
        </div>

        <SeletorAnimal
          animais={animaisDoProprietario}
          animalIdAtual={effectiveAnimalId}
          rotaBase="/exames"
        />

        {currentAnimal && <AnimalCard animal={currentAnimal} />}

        {/* Exames PEDIDOS no Atendimento que ainda aguardam resultado. Cada um traz os
            dois caminhos (carregar o laudo ou digitar), e o resultado fica amarrado ao
            pedido de origem — sem esta lista, quem chega com o laudo não sabe o que foi
            pedido e acaba lançando resultado solto. */}
        {effectiveAnimalId && (
          <ExamesSolicitadosPanel
            animalId={effectiveAnimalId}
            tipo={tipoExame}
            onSalvo={() => { loadExamesAndAnimal(); }}
            onRealizadosChange={setResultadosClinicos}
          />
        )}

        {/* Imagens armazenadas — só na página de Imagem */}
        {tipoExame === 'imagem' && imagensAnexos.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Imagens armazenadas ({imagensAnexos.length})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {imagensAnexos.map((img: any) => (
                <a key={img.id} href={img.arquivoUrl} target="_blank" rel="noreferrer"
                  className="group border border-gray-100 rounded-xl overflow-hidden hover:border-emerald-300 transition-colors">
                  <img src={img.arquivoUrl} alt={img.nome ?? 'Imagem de exame'}
                    className="w-full h-28 object-cover bg-gray-50" loading="lazy" />
                  <div className="px-2 py-1.5">
                    <p className="text-[11px] text-gray-600 truncate">{img.nome ?? 'Imagem'}</p>
                    <p className="text-[10px] text-gray-400">{formatDate(img.createdAt)}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Data</label>
              <DateInputBR
                value={filtroData}
                onChange={setFiltroData}
                className="border border-gray-200 rounded-xl px-3 py-2 focus-within:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Exame</label>
              <input
                type="text"
                value={filtroExame}
                onChange={e => setFiltroExame(e.target.value)}
                placeholder="Buscar exame..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
              <select
                value={filtroStatus}
                onChange={e => setFiltroStatus(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              >
                <option value="">Todos</option>
                <option value="normal">Normal</option>
                <option value="alto">Alto</option>
                <option value="baixo">Baixo</option>
                <option value="naoCalculado">Não calculado</option>
              </select>
            </div>
          </div>
          {(filtroData || filtroExame || filtroStatus) && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-400">{examesFiltrados.length} de {exames.length} exames</span>
              <button
                onClick={() => { setFiltroData(''); setFiltroExame(''); setFiltroStatus(''); }}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resultados do Exame</p>
            <span className="text-xs text-gray-400">{examesFiltrados.length} registro{examesFiltrados.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Exames CLÍNICOS (Laboratorial/Bioquímico/Imagem) já com resultado — vêm
              do ExamesSolicitadosPanel acima. Ficam DENTRO deste card porque é aqui
              que o usuário olha depois de salvar; o exame nutricional (tabela logo
              abaixo) é outro sistema, com seus próprios filtros/edição/exclusão. */}
          {resultadosClinicos.length > 0 && (
            <div className="divide-y divide-gray-50 border-b border-gray-100">
              {resultadosClinicos.map(ex => (
                <div key={ex.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{ex.descricao}</span>
                    {temResultadoExame(ex) ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                        {ex.status === 'REALIZADO' ? 'Realizado' : 'Finalizado'}
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                        Finalizado sem Resultado
                      </span>
                    )}
                    {ex.arquivoUrl && (
                      <a href={ex.arquivoUrl} target="_blank" rel="noreferrer"
                        className="text-[11px] font-semibold text-emerald-700 hover:underline">
                        ver laudo
                      </a>
                    )}
                    {ex.laboratorio && (
                      <span className="text-[11px] text-gray-500">{ex.laboratorio}</span>
                    )}
                  </div>
                  {ex.dataResultado && (
                    <p className="text-[11px] text-gray-400 mt-0.5">resultado em {formatDate(ex.dataResultado)}</p>
                  )}
                  {ex.resultado && (
                    <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{ex.resultado}</p>
                  )}
                  {ex.resultadoItens?.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-400">
                            <th className="py-1 pr-3 font-semibold">Parâmetro</th>
                            <th className="py-1 pr-3 font-semibold">Valor</th>
                            <th className="py-1 pr-3 font-semibold">Unidade</th>
                            <th className="py-1 font-semibold">Referência</th>
                          </tr>
                        </thead>
                        <tbody className="text-gray-700">
                          {ex.resultadoItens.map(it => (
                            <tr key={it.id} className="border-t border-gray-50">
                              <td className="py-1 pr-3">{it.parametro}</td>
                              <td className="py-1 pr-3 font-medium">{it.valor ?? '—'}</td>
                              <td className="py-1 pr-3 text-gray-500">{it.unidade ?? '—'}</td>
                              <td className="py-1 text-gray-500">{it.referencia ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {ex.imagens?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {ex.imagens.map(img => (
                        <a key={img.id} href={img.arquivoUrl} target="_blank" rel="noreferrer"
                          className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                          {img.nome ?? `imagem ${img.id}`}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <datalist id="exames-list">
            {nutrientes.map(n => <option key={n.id} value={n.nome} />)}
          </datalist>

          {examesFiltrados.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              {exames.length === 0 ? 'Nenhum exame registrado ainda.' : 'Nenhum exame corresponde aos filtros.'}
            </div>
          ) : (
          <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <span className="flex items-center gap-1"><Calendar size={11} /> Data</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exame</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {examesFiltrados.map((ex: any) => {
                  const isEditing = editingId === ex.id;
                  const status    = getStatus(ex);
                  return (
                    <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <DateInputBR
                            value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                            onChange={v => setEditValues({ ...editValues, dataExame: v })}
                            className="border rounded p-1 text-sm"
                          />
                        ) : formatDate(ex.dataExame)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {isEditing ? (
                          <input
                            list="exames-list"
                            value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                            onChange={e => {
                              const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                              setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                            }}
                            className="border rounded p-1 text-sm w-full"
                            placeholder="Digite o exame..."
                          />
                        ) : ex.nutriente?.nome || '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-700 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number" step="0.01"
                            value={editValues.valorEncontrado || ex.valorEncontrado}
                            onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                            className="border rounded p-1 text-sm w-20 text-center"
                          />
                        ) : `${ex.valorEncontrado} ${ex.unidade}`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(ex.id)} className="px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50">Salvar</button>
                              <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                            </>
                          ) : (
                            <>
                              {ex.arquivoUrl && (
                                <button onClick={() => window.open(ex.arquivoUrl, '_blank')} title="Ver laudo"
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                  <Eye size={15} />
                                </button>
                              )}
                              <button onClick={() => startEdit(ex)} title="Editar"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Edit size={15} />
                              </button>
                              <button onClick={() => handleDelete(ex.id)} title="Excluir"
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {examesFiltrados.map((ex: any) => {
              const isEditing = editingId === ex.id;
              const status    = getStatus(ex);
              return (
                <div key={ex.id} className="px-4 py-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <DateInputBR
                        value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                        onChange={v => setEditValues({ ...editValues, dataExame: v })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                      />
                      <input
                        list="exames-list"
                        value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                        onChange={e => {
                          const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                          setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                        }}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Digite o exame..."
                      />
                      <input
                        type="number" step="0.01"
                        value={editValues.valorEncontrado || ex.valorEncontrado}
                        onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Valor"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(ex.id)} className="flex-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Salvar</button>
                        <button onClick={cancelEdit} className="flex-1 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-sm truncate">{ex.nutriente?.nome || '—'}</span>
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Calendar size={11} /> {formatDate(ex.dataExame)}
                        {' · '}<span className="font-semibold text-emerald-700">{ex.valorEncontrado} {ex.unidade}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ex.arquivoUrl && (
                          <button onClick={() => window.open(ex.arquivoUrl, '_blank')}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                            <Eye size={11} /> Laudo
                          </button>
                        )}
                        <button onClick={() => startEdit(ex)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                          <Edit size={11} /> Editar
                        </button>
                        <button onClick={() => handleDelete(ex.id)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                          <Trash2 size={11} /> Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </>
          )}
        </div>
      </div>
      <ModalJustificativa
        aberto={confirmId != null}
        titulo="Excluir exame"
        descricao="Deseja realmente excluir este exame? Esta ação não pode ser desfeita."
        acaoLabel="Excluir"
        onConfirmar={handleDeleteConfirmado}
        onFechar={() => setConfirmId(null)}
      />
    </PageContainer>
  );
};

export default Exames;