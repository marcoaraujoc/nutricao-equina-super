// src/pages/AnimaisVet.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import { Pencil, Search, ShieldOff, ClipboardList, Zap, ToggleRight, ToggleLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';
import ModalJustificativa from '../components/ModalJustificativa';
import { type ErroAcaoDados } from '../components/ErroAcao';


interface Animal {
  id:               number;
  nome:             string;
  sexo:             string;
  peso:             number;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  baia?:            string | null;
  local?:           string | null;
  localizacao?:     { nome: string } | null;
  pelagem?:         string | null;
  raca?:            { nome: string } | null;
  especie?:         { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
  // Paciente INATIVO — somente leitura, sem sumir da lista (diferente de exclusão
  // lógica). Só o gestor reativa.
  inativo?:         boolean;
  inativoMotivo?:   string | null;
  inativoPor?:      { fullName: string } | null;
}

type FiltroCampo = 'animal' | 'proprietario';

const calcularIdade = (dataNascimento: string): string => {
  const p       = dataNascimento.split('T')[0].split('-').map(Number);
  const nasc    = new Date(p[0], p[1] - 1, p[2]);
  const hoje    = new Date();
  let anos      = hoje.getFullYear() - p[0];
  let meses     = hoje.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (hoje.getDate() < p[2]) meses--;
  const dias = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);
  if (dias < 30)  return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '—';
};

// ─── Card mobile ──────────────────────────────────────────────────────────────
function AnimalCardMobile({ animal, onDashboard, onEditar, podeEditar, podeInativar, isGestor, onInativar, onAtivar }: {
  animal:        Animal;
  onDashboard:   () => void;
  onEditar:      () => void;
  podeEditar:    boolean;
  podeInativar:  boolean;
  isGestor:      boolean;
  onInativar:    () => void;
  onAtivar:      () => void;
}) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3 ${animal.inativo ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        <FotoAnimal url={animal.photoUrl} nome={animal.nome} />
      </div>

      <div className="flex-1 min-w-0" onClick={onDashboard}>
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-gray-900 truncate">{animal.nome}</p>
          {animal.inativo && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">Inativo</span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {animal.raca?.nome || animal.especie?.nome || '—'}
        </p>
        {animal.user?.fullName && (
          <p className="text-xs text-gray-400 truncate">Prop.: {animal.user.fullName}</p>
        )}
        {(animal.localizacao?.nome || animal.local) && (
          <p className="text-xs text-gray-500 truncate">
            📍 {animal.localizacao?.nome || animal.local}
            {animal.baia ? ` · Baia ${animal.baia}` : ''}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
            {idadeDisplay(animal)}
          </span>
          {animal.sexo && (
            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {animal.sexo}
            </span>
          )}
          {animal.categoriaAnimal && (
            <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 truncate max-w-[120px]">
              {animal.categoriaAnimal}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        {podeEditar && !animal.inativo && (
          <button onClick={onEditar}
            className="p-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors"
            title="Editar">
            <Pencil size={15} />
          </button>
        )}
        {!animal.inativo && podeInativar && (
          <button onClick={onInativar}
            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            title="Inativar paciente">
            <ToggleRight size={15} />
          </button>
        )}
        {animal.inativo && isGestor && (
          <button onClick={onAtivar}
            className="p-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Reativar paciente">
            <ToggleLeft size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ⚠️ SEÇÃO DE SOLICITAÇÕES REMOVIDA na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6): acabaram os vínculos e aprovações entre
// veterinário, proprietário e empresa. O paciente aparece aqui por pertencer à
// EMPRESA do contexto ativo — não há mais convite a aceitar ou recusar.


// ─── Main ─────────────────────────────────────────────────────────────────────
const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const isVet                                        = (user?.userType ?? '').toUpperCase() === 'VETERINARIO';
  const { setSelectedAnimal } = useSelectedAnimal();
  const { podeExecutar, isGestor, temEquipe, loading: loadingPerms } = usePermissoes();
  const podeCriarAnimal                              = podeExecutar('animais.criar');
  const podeEditarAnimal                             = podeExecutar('animais.editar');
  // Inativar: qualquer perfil com o slug concedido. Reativar é SEMPRE gestor — regra
  // fixa no backend (AnimalController.ativar), independente da matriz.
  const podeInativarAnimal                           = podeExecutar('animais.ativar');
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [loading,        setLoading]        = useState(true);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // ⚠️ O botão "Desvincular" saiu na fase 3 do multi-tenancy: não há mais vínculo entre
  // veterinário e animal para desfazer. O paciente pertence à EMPRESA, e quem deixa de
  // atendê-lo é quem sai da equipe.

  // ── Inativar / Reativar paciente (ModalJustificativa — motivo obrigatório) ──
  const [modalInativar, setModalInativar] = useState<Animal | null>(null);
  const [modalAtivar,   setModalAtivar]   = useState<Animal | null>(null);
  const [processandoStatus, setProcessandoStatus] = useState(false);
  const [erroModalStatus,   setErroModalStatus]   = useState<ErroAcaoDados | null>(null);

  const fecharModaisStatus = () => {
    setModalInativar(null); setModalAtivar(null); setErroModalStatus(null);
  };

  const confirmarInativar = async (motivo: string) => {
    if (!modalInativar) return;
    setProcessandoStatus(true); setErroModalStatus(null);
    try {
      await api.patch(`/animais/${modalInativar.id}/inativar`, { motivo });
      toast.success('Paciente inativado com sucesso');
      fecharModaisStatus();
      await loadAnimais();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModalStatus({ mensagem: msg ?? 'Erro ao inativar paciente' });
    } finally { setProcessandoStatus(false); }
  };

  const confirmarAtivar = async (motivo: string) => {
    if (!modalAtivar) return;
    setProcessandoStatus(true); setErroModalStatus(null);
    try {
      await api.patch(`/animais/${modalAtivar.id}/ativar`, { motivo });
      toast.success('Paciente reativado com sucesso');
      fecharModaisStatus();
      await loadAnimais();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModalStatus({ mensagem: msg ?? 'Erro ao reativar paciente' });
    } finally { setProcessandoStatus(false); }
  };

  const loadAnimais = async () => {
    try {
      const animaisRes = await api.get('/animais');
      setAnimais(animaisRes.data?.dados ?? animaisRes.data ?? []);
    } catch {
      setErroInline('Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id && !loadingPerms) loadAnimais(); }, [user?.id, loadingPerms]);

  const animaisFiltrados = animais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  const irParaAnimal = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animal/${animal.id}`);
  };

  const irParaEditar = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animais/${animal.id}`);
  };

  if (!loadingPerms && !podeExecutar('animais.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para visualizar pacientes.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer maxWidth="7xl">
        <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <BotaoVoltar para="/" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
            <Zap size={22} className="text-emerald-600" />
            Meus Pacientes
          </h1>
          {podeCriarAnimal && (
            <div className="flex gap-2 self-end sm:self-auto">
              <button
                onClick={() => navigate('/animais')}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <span className="hidden sm:inline">Novo Paciente</span>
                <span className="sm:hidden">Novo</span>
              </button>
              <button
                onClick={() => navigate('/exame-compra')}
                className="flex items-center gap-2 bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <ClipboardList size={15} />
                <span>Exame de Compra</span>
              </button>
              {/* Resenha — inativado temporariamente (removido do frontend a pedido).
                  Para reativar: descomentar este bloco e reimportar `ScrollText`.
              <button
                onClick={() => navigate('/resenha')}
                className="flex items-center gap-2 bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <ScrollText size={15} />
                <span className="hidden sm:inline">Resenha</span>
                <span className="sm:hidden">Resenha</span>
              </button>
              */}
            </div>
          )}
        </div>

        {/* ── Aviso: sem equipe / perfil configurado ─────────────────────── */}
        {isVet && !temEquipe && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 text-sm">
            <ShieldOff size={16} className="flex-shrink-0" />
            <span>Você não está associado a nenhuma equipe. Solicite ao administrador que configure seu perfil para liberar as ações.</span>
          </div>
        )}

        {/* ── Busca ──────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <select
            value={filtroCampo}
            onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
            className="border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-700
                       focus:outline-none focus:border-emerald-600 bg-white flex-shrink-0"
          >
            <option value="animal">Por animal</option>
            <option value="proprietario">Por proprietário</option>
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                         text-gray-900 focus:outline-none focus:border-emerald-600
                         focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
          </div>
        </div>



        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : animaisFiltrados.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-gray-400 text-sm">
              {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum paciente cadastrado'}
            </p>
          </div>
        ) : (
          <>
            {/* MOBILE — cards */}
            <div className="space-y-3 md:hidden">
              {animaisFiltrados.map(animal => (
                <AnimalCardMobile
                  key={animal.id}
                  animal={animal}
                  onDashboard={() => irParaAnimal(animal)}
                  onEditar={() => irParaEditar(animal)}
                  podeEditar={podeEditarAnimal}
                  podeInativar={podeInativarAnimal}
                  isGestor={isGestor}
                  onInativar={() => setModalInativar(animal)}
                  onAtivar={() => setModalAtivar(animal)}
                />
              ))}
            </div>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="overflow-x-auto rounded-2xl">
                <table className="w-full min-w-[1020px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="w-14 pl-5 py-3" />
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Local</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Baia</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Raça</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Pelagem</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Categoria NRC</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">Idade</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-14">Sexo</th>
                      <th className="text-right pr-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {animaisFiltrados.map(animal => (
                      <tr
                        key={animal.id}
                        onClick={() => irParaAnimal(animal)}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors group ${animal.inativo ? 'bg-amber-50/40' : ''}`}
                      >
                        <td className="pl-5 py-3.5">
                          <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                            <FotoAnimal url={animal.photoUrl} nome={animal.nome} />
                          </div>
                        </td>
                        <td className="px-3 py-3.5 max-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                              {animal.nome}
                            </p>
                            {animal.inativo && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">Inativo</span>
                            )}
                          </div>
                          {animal.user?.fullName && (
                            <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 truncate">
                            {animal.localizacao?.nome || animal.local || <span className="text-gray-300">—</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          {animal.baia
                            ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">{animal.baia}</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 truncate">{animal.raca?.nome || animal.especie?.nome || '—'}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 truncate">{animal.pelagem || <span className="text-gray-300">—</span>}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 truncate">{animal.categoriaAnimal || '—'}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 whitespace-nowrap">{idadeDisplay(animal)}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600">{animal.sexo || '—'}</p>
                        </td>
                        <td className="pr-5 py-3.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {podeEditarAnimal && !animal.inativo && (
                              <button onClick={() => irParaEditar(animal)}
                                className="p-1.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors"
                                title="Editar">
                                <Pencil size={15} />
                              </button>
                            )}
                            {!animal.inativo && podeInativarAnimal && (
                              <button onClick={() => setModalInativar(animal)}
                                className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Inativar paciente">
                                <ToggleRight size={15} />
                              </button>
                            )}
                            {animal.inativo && isGestor && (
                              <button onClick={() => setModalAtivar(animal)}
                                className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Reativar paciente">
                                <ToggleLeft size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-gray-50 text-center">
                <p className="text-xs text-gray-400">
                  {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Rodapé mobile */}
            <p className="md:hidden text-xs text-gray-400 text-center">
              {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>


      </PageContainer>

      <ModalJustificativa
        aberto={!!modalInativar}
        titulo="Inativar paciente?"
        descricao={modalInativar
          ? `${modalInativar.nome} vira somente leitura: nenhum registro novo (evolução, prescrição, vacina, exame, encaminhamento, agendamento, dieta) poderá ser criado, e o cadastro do animal não poderá ser editado. Só o gestor consegue reverter.`
          : undefined}
        acaoLabel="Inativar"
        placeholder="Descreva o motivo da inativação (obrigatório)..."
        processando={processandoStatus}
        erro={erroModalStatus}
        onConfirmar={confirmarInativar}
        onFechar={fecharModaisStatus}
      />

      <ModalJustificativa
        aberto={!!modalAtivar}
        titulo="Reativar paciente?"
        descricao={modalAtivar
          ? `${modalAtivar.nome} volta a poder receber novos registros clínicos.`
          : undefined}
        acaoLabel="Reativar"
        placeholder="Descreva o motivo da reativação (obrigatório)..."
        processando={processandoStatus}
        erro={erroModalStatus}
        onConfirmar={confirmarAtivar}
        onFechar={fecharModaisStatus}
      />
    </>
  );
};

export default AnimaisVet;
