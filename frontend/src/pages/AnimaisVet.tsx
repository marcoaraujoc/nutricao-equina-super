// src/pages/AnimaisVet.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Plus, Unlink, Search, LayoutDashboard } from 'lucide-react';

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

const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [loading,        setLoading]        = useState(true);
  const [animalToDelete, setAnimalToDelete] = useState<Animal | null>(null);
  const [animalToUnlink, setAnimalToUnlink] = useState<Animal | null>(null);
  const [unlinking,      setUnlinking]      = useState(false);

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      setAnimais(res.data?.dados ?? res.data ?? []);
    } catch {
      toast.error('Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id) loadAnimais(); }, [user?.id]);

  // ── Filtro por tipo (item 1) ─────────────────────────────────────────────
  const animaisFiltrados = animais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  // Navegar para o detalhe do animal (linha clicável)
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

  const confirmDelete = async () => {
    if (!animalToDelete) return;
    try {
      await api.delete(`/animais/${animalToDelete.id}`);
      setAnimalToDelete(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success('Paciente excluído');
    } catch {
      toast.error('Erro ao excluir paciente');
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
      toast.error('Erro ao desvincular');
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} className="text-sm text-emerald-700 hover:text-emerald-800 flex items-center gap-1 font-medium">
            ← Voltar
          </button>
        </div>
        <button
          onClick={() => navigate('/animais')}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors"
        >
          <Plus size={16} /> Novo Paciente
        </button>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 -mt-2">Meus Pacientes</h1>

      {/* Busca com seletor de campo */}
      <div className="flex gap-2">
        <select
          value={filtroCampo}
          onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
          className="border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-600 bg-white min-w-[160px]"
        >
          <option value="animal">Buscar por animal</option>
          <option value="proprietario">Buscar por proprietário</option>
        </select>
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors"
          />
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Carregando pacientes...</div>
      ) : animaisFiltrados.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-3xl mb-3">🔍</p>
          <p className="text-gray-400 text-sm">
            {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum paciente cadastrado'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

          {/* Cabeçalho */}
          <div className="grid grid-cols-[40px_1fr_160px_120px_80px_60px_120px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
            <span />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:block">Categoria NRC</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Idade</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sexo</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Ações</span>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-gray-50">
            {animaisFiltrados.map(animal => (
              <div
                key={animal.id}
                onClick={() => irParaAnimal(animal)}
                className="grid grid-cols-[40px_1fr_160px_120px_80px_60px_120px] items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors group"
              >
                {/* Foto */}
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  {animal.photoUrl
                    ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xl">🐴</div>
                  }
                </div>

                {/* Nome + proprietário */}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                    {animal.nome}
                  </p>
                  {animal.user?.fullName && (
                    <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                  )}
                </div>

                {/* Raça */}
                <p className="text-sm text-gray-600 truncate">
                  {animal.raca?.nome || animal.especie?.nome || '—'}
                </p>

                {/* Categoria NRC */}
                <p className="text-sm text-gray-600 truncate hidden sm:block">
                  {animal.categoriaAnimal || '—'}
                </p>

                {/* Idade */}
                <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>

                {/* Sexo */}
                <p className="text-sm text-gray-600">{animal.sexo || '—'}</p>

                {/* Ações */}
                <div
                  className="flex items-center justify-end gap-1"
                  onClick={e => e.stopPropagation()} // impede navegar ao clicar nos botões
                >
                  <button
                    onClick={() => irParaAnimal(animal)}
                    className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Ver detalhes"
                  >
                    <LayoutDashboard size={15} />
                  </button>
                  <button
                    onClick={() => irParaEditar(animal)}
                    className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setAnimalToUnlink(animal)}
                    className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                    title="Desvincular"
                  >
                    <Unlink size={15} />
                  </button>
                  <button
                    onClick={() => setAnimalToDelete(animal)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Rodapé */}
          <div className="px-5 py-3 border-t border-gray-50 text-center">
            <p className="text-xs text-gray-400">
              {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

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

      {/* Modal — Excluir */}
      {animalToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">⚠️</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Excluir paciente?</h2>
            <p className="text-gray-500 text-sm mb-6">
              Isso removerá permanentemente <strong>{animalToDelete.nome}</strong> do sistema.
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setAnimalToDelete(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnimaisVet;