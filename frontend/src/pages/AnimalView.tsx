// src/pages/AnimaisVet.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Unlink, Search, LayoutDashboard, ArrowLeft } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import ModalJustificativa from '../components/ModalJustificativa';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';

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
  raca?:            { nome: string } | null;
  especie?:         { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
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
function AnimalCardMobile({ animal, onDashboard, onEditar, onDesvincular, onExcluir }: {
  animal:        Animal;
  onDashboard:   () => void;
  onEditar:      () => void;
  onDesvincular: () => void;
  onExcluir:     () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        {animal.photoUrl
          ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🐴</div>
        }
      </div>

      <div className="flex-1 min-w-0" onClick={onDashboard}>
        <p className="font-semibold text-gray-900 truncate">{animal.nome}</p>
        <p className="text-xs text-gray-500 truncate">
          {animal.raca?.nome || animal.especie?.nome || '—'}
        </p>
        {animal.user?.fullName && (
          <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
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
        <button onClick={onDashboard}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Ver detalhes">
          <LayoutDashboard size={15} />
        </button>
        <button onClick={onEditar}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Editar">
          <Pencil size={15} />
        </button>
        <button onClick={onDesvincular}
          className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
          title="Desvincular">
          <Unlink size={15} />
        </button>
        <button onClick={onExcluir}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Excluir">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [loading,        setLoading]        = useState(true);
  const [animalToDelete, setAnimalToDelete] = useState<Animal | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO (confirmar/excluir/desvincular): vai para o modal que disparou
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [animalToUnlink, setAnimalToUnlink] = useState<Animal | null>(null);
  const [unlinking,      setUnlinking]      = useState(false);

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      setAnimais(res.data?.dados ?? res.data ?? []);
    } catch {
      setErroInline('Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id) loadAnimais(); }, [user?.id]);

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

  const confirmDelete = async (motivo: string) => {
    if (!animalToDelete) return;
    try {
      // Exclusão exige justificativa (registrada na Auditoria)
      await api.delete(`/animais/${animalToDelete.id}`, { data: { motivo } });
      setAnimalToDelete(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success('Paciente excluído');
    } catch {
      setErroAcao({ mensagem: 'Erro ao excluir paciente' });
    }
  };

  const confirmDesvincular = async () => {
    if (!animalToUnlink) return;
    setUnlinking(true);
    try {
      await api.delete(`/animais/${animalToUnlink.id}/desvincular-vet`);
      setAnimalToUnlink(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success(`${animalToUnlink.nome} removido da sua lista`);
    } catch {
      setErroAcao({ mensagem: 'Erro ao desvincular' });
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <PageContainer maxWidth="7xl">
      <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium">
              <ArrowLeft size={16} /> Voltar
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Meus Pacientes</h1>
          </div>
          <button
            onClick={() => navigate('/animais')}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                       px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
          >
            <span className="hidden sm:inline">Novo Paciente</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>

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
                  onDesvincular={() => setAnimalToUnlink(animal)}
                  onExcluir={() => setAnimalToDelete(animal)}
                />
              ))}
            </div>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[44px_1fr_160px_130px_90px_70px_130px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Categoria NRC</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Idade</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sexo</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Ações</span>
              </div>

              <div className="divide-y divide-gray-50">
                {animaisFiltrados.map(animal => (
                  <div
                    key={animal.id}
                    onClick={() => irParaAnimal(animal)}
                    className="grid grid-cols-[44px_1fr_160px_130px_90px_70px_130px] items-center gap-4
                               px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      {animal.photoUrl
                        ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xl">🐴</div>
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                        {animal.nome}
                      </p>
                      {animal.user?.fullName && (
                        <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      {animal.raca?.nome || animal.especie?.nome || '—'}
                    </p>
                    <p className="text-sm text-gray-600 truncate">
                      {animal.categoriaAnimal || '—'}
                    </p>
                    <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>
                    <p className="text-sm text-gray-600">{animal.sexo || '—'}</p>
                    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => irParaAnimal(animal)}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Ver detalhes">
                        <LayoutDashboard size={15} />
                      </button>
                      <button onClick={() => irParaEditar(animal)}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Editar">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => setAnimalToUnlink(animal)}
                        className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                        title="Desvincular">
                        <Unlink size={15} />
                      </button>
                      <button onClick={() => setAnimalToDelete(animal)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
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

      {/* Modal — Desvincular */}
      {animalToUnlink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Unlink size={24} className="text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Desvincular paciente?</h2>
            <p className="text-gray-500 text-sm mb-6">
              Você não será mais o veterinário responsável por{' '}
              <strong className="text-gray-700">{animalToUnlink.nome}</strong>.
              O animal continua no sistema e o proprietário será notificado.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setAnimalToUnlink(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={confirmDesvincular} disabled={unlinking}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold">
                {unlinking ? 'Removendo...' : 'Desvincular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Excluir (justificativa obrigatória → Auditoria) */}
      <ModalJustificativa
        erro={erroAcao}
        aberto={!!animalToDelete}
        titulo="Excluir paciente?"
        descricao={animalToDelete
          ? `${animalToDelete.nome} será removido das listagens. O histórico clínico e nutricional é preservado.`
          : undefined}
        onConfirmar={confirmDelete}
        onFechar={() => setAnimalToDelete(null)}
      />
    </PageContainer>
  );
};

export default AnimaisVet;