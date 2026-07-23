// src/pages/MeusAnimais.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Clock, MapPin, Search, XCircle, CheckCircle2 } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import ModalJustificativa from '../components/ModalJustificativa';
import InlineError from '../components/InlineError';


interface Solicitacao {
  id:               number;
  tipo:             string; // 'VINCULO' | 'DESVINCULO' | 'TROCA_VET'
  status:           string;
  vetUserId?:       number;
  solicitanteId?:   number | null;
  novoVetUserId?:   number | null;
  veterinario?:     { fullName: string };
  novoVeterinario?: { fullName: string } | null;
}

interface Animal {
  id:               number;
  nome:             string;
  sexo:             string;
  peso:             number;
  local?:           string | null;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  raca?:            { nome: string } | null;
  solicitacoes?:    Solicitacao[];
}

const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const nasc    = new Date(anoNasc, mesNasc, diaNasc);
  const dias    = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);
  let meses     = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) meses--;
  let anos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) anos--;
  if (dias < 30)  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const getSolicitacaoPendente = (animal: Animal): Solicitacao | undefined =>
  animal.solicitacoes?.find(s => s.status === 'PENDENTE');

type BannerInfo = { text: string; bg: string; borderColor: string; textColor: string; iconColor: string };
const getBannerInfo = (tipo: string): BannerInfo => {
  if (tipo === 'DESVINCULO') return {
    text: 'Aguardando confirmação de remoção do veterinário',
    bg: 'bg-red-50', borderColor: 'border-red-100', textColor: 'text-red-700', iconColor: 'text-red-400',
  };
  if (tipo === 'TROCA_VET') return {
    text: 'Aguardando aprovação de troca de veterinário',
    bg: 'bg-blue-50', borderColor: 'border-blue-100', textColor: 'text-blue-700', iconColor: 'text-blue-400',
  };
  return {
    text: 'Aguardando aprovação do veterinário',
    bg: 'bg-amber-50', borderColor: 'border-amber-100', textColor: 'text-amber-700', iconColor: 'text-amber-500',
  };
};

const getBadgeInfo = (tipo: string): { text: string; className: string } => {
  if (tipo === 'DESVINCULO') return { text: 'Remoção pendente', className: 'bg-red-100 text-red-700' };
  if (tipo === 'TROCA_VET')  return { text: 'Troca pendente',   className: 'bg-blue-100 text-blue-700' };
  return { text: 'Pendente', className: 'bg-amber-100 text-amber-700' };
};

const getCardBorderClass = (tipo: string): string => {
  if (tipo === 'DESVINCULO') return 'border-red-200 opacity-80';
  if (tipo === 'TROCA_VET')  return 'border-blue-200 opacity-80';
  return 'border-amber-200 opacity-80';
};

const CANCEL_TEXTOS: Record<string, { titulo: string; descricao: string }> = {
  VINCULO:    {
    titulo: 'Cancelar solicitação de vínculo?',
    descricao: 'O veterinário não será mais notificado e o vínculo não será criado.',
  },
  DESVINCULO: {
    titulo: 'Cancelar remoção do veterinário?',
    descricao: 'A solicitação de remoção será cancelada e o veterinário continuará vinculado ao animal.',
  },
  TROCA_VET:  {
    titulo: 'Cancelar troca de veterinário?',
    descricao: 'A solicitação de troca será cancelada e o vínculo atual será mantido.',
  },
};

const MeusAnimais = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();
  const { podeExecutar, loading: loadingPerms }      = usePermissoes();
  const podeCriarAnimal  = podeExecutar('animais.criar');
  const podeEditarAnimal = podeExecutar('animais.editar');
  const podeDeletarAnimal = podeExecutar('animais.deletar');

  const [animais,                setAnimais]                = useState<Animal[]>([]);
  const [search,                 setSearch]                 = useState('');
  const [loading,                setLoading]                = useState(true);
  const [animalToDelete,         setAnimalToDelete]         = useState<Animal | null>(null);
  const [cancelSolicitacaoAnimal, setCancelSolicitacaoAnimal] = useState<Animal | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [cancelando,             setCancelando]             = useState(false);
  const [respondendo,            setRespondendo]            = useState(false);

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      setAnimais(res.data?.dados ?? res.data ?? []);
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id && !loadingPerms) loadAnimais(); }, [user?.id, loadingPerms]);

  const filteredAnimais = animais.filter(a =>
    a.nome.toLowerCase().includes(search.toLowerCase())
  );

  const isPendente = (animal: Animal): boolean =>
    !!getSolicitacaoPendente(animal);

  const handleEdit = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
    });
    navigate(`/animais/${animal.id}`);
  };

  const confirmDelete = async (motivo: string) => {
    if (!animalToDelete) return;
    try {
      // Exclusão exige justificativa (registrada na Auditoria)
      await api.delete(`/animais/${animalToDelete.id}`, { data: { motivo } });
      setAnimalToDelete(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success('Animal excluído.');
    } catch (error) {
      console.error(error);
      setErroInline('Erro ao excluir animal.');
    }
  };

  const confirmCancelar = async () => {
    if (!cancelSolicitacaoAnimal) return;
    setCancelando(true);
    try {
      await api.delete(`/animais/${cancelSolicitacaoAnimal.id}/cancelar-solicitacao`);
      setCancelSolicitacaoAnimal(null);
      loadAnimais();
    } catch (error) {
      console.error('Erro ao cancelar solicitação:', error);
    } finally {
      setCancelando(false);
    }
  };

  const handleResponderVet = async (solId: number, status: 'ACEITO' | 'RECUSADO') => {
    setRespondendo(true);
    try {
      const res = await api.patch(`/animais/solicitacoes/${solId}/responder`, { status });
      toast.success(res.data?.mensagem ?? (status === 'ACEITO' ? 'Vínculo autorizado!' : 'Vínculo recusado.'));
      loadAnimais();
    } catch (err: any) {
      setErroInline(err?.response?.data?.mensagem ?? 'Erro ao responder solicitação');
    } finally {
      setRespondendo(false);
    }
  };

  const isVetIniciado = (sol: Solicitacao) =>
    !!sol.solicitanteId && !!sol.vetUserId && sol.solicitanteId === sol.vetUserId;

  return (
    <PageContainer>
      <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Meus Animais</h1>
          {podeCriarAnimal && (
            <button
              onClick={() => navigate('/animais')}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                         px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
            >
              <span className="hidden sm:inline">Novo Animal</span>
              <span className="sm:hidden">Novo</span>
            </button>
          )}
        </div>

        {/* ── Busca ──────────────────────────────────────────────────────── */}
        <div className="relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                       text-gray-900 focus:outline-none focus:border-emerald-600
                       focus:ring-2 focus:ring-emerald-100 transition-colors"
          />
        </div>

        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : filteredAnimais.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🐴</p>
            <p className="text-gray-400 text-sm">
              {search ? `Nenhum resultado para "${search}"` : 'Nenhum animal cadastrado'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAnimais.map(animal => {
              const pendente     = isPendente(animal);
              const solPendente  = getSolicitacaoPendente(animal);
              const vetInit     = solPendente ? isVetIniciado(solPendente) : false;
              const bannerInfo   = solPendente
                ? (vetInit && solPendente.tipo === 'VINCULO'
                  ? { text: 'Veterinário solicitou acesso — aguardando sua aprovação', bg: 'bg-green-50', borderColor: 'border-green-100', textColor: 'text-green-700', iconColor: 'text-green-500' }
                  : vetInit && solPendente.tipo === 'DESVINCULO'
                  ? { text: `Dr(a). ${solPendente.veterinario?.fullName ?? 'Veterinário'} quer se desvincular — aguardando sua decisão`, bg: 'bg-amber-50', borderColor: 'border-amber-100', textColor: 'text-amber-700', iconColor: 'text-amber-500' }
                  : getBannerInfo(solPendente.tipo))
                : null;
              const badgeInfo    = solPendente
                ? (vetInit && solPendente.tipo === 'VINCULO'
                  ? { text: 'Aguardando sua aprovação', className: 'bg-green-100 text-green-700' }
                  : vetInit && solPendente.tipo === 'DESVINCULO'
                  ? { text: 'Desvinculo aguardando aprovação', className: 'bg-amber-100 text-amber-700' }
                  : getBadgeInfo(solPendente.tipo))
                : null;
              const cardBorder   = pendente && solPendente
                ? (vetInit && solPendente.tipo === 'VINCULO' ? 'border-green-200 opacity-80'
                  : vetInit && solPendente.tipo === 'DESVINCULO' ? 'border-amber-200 opacity-80'
                  : getCardBorderClass(solPendente.tipo))
                : 'border-gray-100 hover:shadow-md cursor-pointer';
              return (
                <div
                  key={animal.id}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${cardBorder}`}
                  onClick={() => !pendente && handleEdit(animal)}
                >
                  {/* Banner pendente */}
                  {pendente && bannerInfo && (
                    <div className={`flex items-center gap-2 px-4 py-2 ${bannerInfo.bg} border-b ${bannerInfo.borderColor}`}>
                      <Clock size={12} className={`${bannerInfo.iconColor} flex-shrink-0`} />
                      <span className={`text-xs ${bannerInfo.textColor} font-medium`}>
                        {bannerInfo.text}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-3 sm:p-4">
                    {/* Foto */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      {animal.photoUrl ? (
                        <img
                          src={animal.photoUrl}
                          alt={animal.nome}
                          className={`w-full h-full object-cover ${pendente ? 'grayscale-[40%]' : ''}`}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl">🐴</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                          {animal.nome}
                        </h3>
                        {pendente && badgeInfo && (
                          <span className={`inline-flex items-center gap-1 text-[10px] ${badgeInfo.className} px-2 py-0.5 rounded-full font-medium flex-shrink-0`}>
                            <Clock size={9} /> {badgeInfo.text}
                          </span>
                        )}
                      </div>

                      <p className="text-emerald-700 font-medium text-sm truncate">
                        {animal.raca?.nome || 'Raça não informada'}
                      </p>

                      <p className="text-gray-500 text-xs mt-0.5 truncate">
                        {animal.categoriaAnimal
                          ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
                          : 'Categoria NRC não informada'}
                      </p>

                      {animal.local && (
                        <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 truncate">
                          <MapPin size={10} className="flex-shrink-0" />
                          {animal.local}
                        </p>
                      )}

                      {/* Badges idade + sexo */}
                      <div className="flex gap-2 mt-1.5">
                        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                          {idadeDisplay(animal)}
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                          {animal.sexo}
                        </span>
                      </div>
                    </div>

                    {/* Ações */}
                    <div
                      className="flex flex-col sm:flex-row gap-2 flex-shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      {podeEditarAnimal && (
                        <button
                          onClick={() => handleEdit(animal)}
                          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700
                                     text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                        >
                          <Pencil size={13} />
                          <span className="hidden sm:inline">Editar</span>
                        </button>
                      )}

                      {pendente && solPendente && isVetIniciado(solPendente) && solPendente.tipo === 'DESVINCULO' ? (
                        <>
                          <button
                            onClick={() => handleResponderVet(solPendente.id, 'ACEITO')}
                            disabled={respondendo}
                            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300
                                       text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                          >
                            <CheckCircle2 size={13} />
                            <span className="hidden sm:inline">Aceitar remoção</span>
                          </button>
                          <button
                            onClick={() => handleResponderVet(solPendente.id, 'RECUSADO')}
                            disabled={respondendo}
                            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300
                                       text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                          >
                            <XCircle size={13} />
                            <span className="hidden sm:inline">Manter vínculo</span>
                          </button>
                        </>
                      ) : pendente && solPendente && isVetIniciado(solPendente) ? (
                        <>
                          <button
                            onClick={() => handleResponderVet(solPendente.id, 'ACEITO')}
                            disabled={respondendo}
                            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300
                                       text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                          >
                            <CheckCircle2 size={13} />
                            <span className="hidden sm:inline">Autorizar</span>
                          </button>
                          <button
                            onClick={() => handleResponderVet(solPendente.id, 'RECUSADO')}
                            disabled={respondendo}
                            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300
                                       text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                          >
                            <XCircle size={13} />
                            <span className="hidden sm:inline">Recusar</span>
                          </button>
                        </>
                      ) : pendente ? (
                        <button
                          onClick={() => setCancelSolicitacaoAnimal(animal)}
                          className="flex items-center gap-1.5 bg-gray-500 hover:bg-gray-600
                                     text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                        >
                          <XCircle size={13} />
                          <span className="hidden sm:inline">Cancelar</span>
                        </button>
                      ) : null}

                      {!pendente && podeDeletarAnimal && (
                        <button
                          onClick={() => setAnimalToDelete(animal)}
                          className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600
                                     text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                        >
                          <Trash2 size={13} />
                          <span className="hidden sm:inline">Excluir</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal — Excluir (justificativa obrigatória → Auditoria) */}
      <ModalJustificativa
        aberto={!!animalToDelete}
        titulo="Excluir animal?"
        descricao={animalToDelete
          ? `${animalToDelete.nome}${animalToDelete.raca?.nome ? ` (${animalToDelete.raca.nome})` : ''} será removido das listagens. O histórico clínico e nutricional é preservado.`
          : undefined}
        onConfirmar={confirmDelete}
        onFechar={() => setAnimalToDelete(null)}
      />

      {/* Modal — Cancelar solicitação */}
      {cancelSolicitacaoAnimal && (() => {
        const solPend = getSolicitacaoPendente(cancelSolicitacaoAnimal);
        const tipo    = solPend?.tipo ?? 'VINCULO';
        const info    = CANCEL_TEXTOS[tipo] ?? CANCEL_TEXTOS.VINCULO;
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">
                ⚠️
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">{info.titulo}</h2>
              <p className="text-gray-500 text-sm mb-2">
                Animal: <strong className="text-gray-700">{cancelSolicitacaoAnimal.nome}</strong>
              </p>
              <p className="text-gray-500 text-sm mb-6">{info.descricao}</p>

              <div className="flex gap-3">
                <button
                  onClick={() => setCancelSolicitacaoAnimal(null)}
                  disabled={cancelando}
                  className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  onClick={confirmCancelar}
                  disabled={cancelando}
                  className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-2xl text-sm font-semibold disabled:opacity-50"
                >
                  {cancelando ? 'Cancelando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </PageContainer>
  );
};

export default MeusAnimais;