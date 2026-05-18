// src/pages/AnimaisVet.tsx
// Baseado em MeusAnimais.tsx — botão "Novo Paciente" vai direto para /animais
// O formulário Animal.tsx detecta que é vet e mostra a seção de proprietário

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Plus } from 'lucide-react';

interface Animal {
  id: number;
  nome: string;
  sexo: string;
  peso: number;
  photoUrl?: string | null;
  dataNascimento?: string | null;
  idadeAnos?: number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?: string | null;
  raca?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
}

const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const anoHoje = hoje.getFullYear();
  const mesHoje = hoje.getMonth();
  const diaHoje = hoje.getDate();
  const diffMs  = hoje.getTime() - new Date(anoNasc, mesNasc, diaNasc).getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let diffMeses  = (anoHoje - anoNasc) * 12 + (mesHoje - mesNasc);
  if (diaHoje < diaNasc) diffMeses--;
  let diffAnos = anoHoje - anoNasc;
  if (mesHoje < mesNasc || (mesHoje === mesNasc && diaHoje < diaNasc)) diffAnos--;
  if (diffDias < 30)  return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [animalToDelete, setAnimalToDelete] = useState<Animal | null>(null);

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      const lista: Animal[] = res.data?.dados ?? res.data ?? [];
      setAnimais(lista);
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id) loadAnimais();
  }, [user?.id]);

  const filteredAnimais = animais.filter(a =>
    a.nome.toLowerCase().includes(search.toLowerCase()) ||
    (a.user?.fullName ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleEdit = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      user:            animal.user
        ? { fullName: animal.user.fullName, email: animal.user.email }
        : undefined,
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
    } catch (error) {
      console.error(error);
      toast.error('Erro ao excluir paciente');
    }
  };

  return (
    <div className="space-y-5 md:space-y-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Meus Pacientes</h1>
        <button
          onClick={() => navigate('/animais')}
          className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl font-semibold transition-colors w-full sm:w-auto"
        >
          <Plus size={20} />
          Novo Paciente
        </button>
      </div>

      {/* Busca */}
      <div>
        <input
          type="text"
          placeholder="Buscar por nome ou proprietário..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-3xl px-6 py-3 md:py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
        />
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-center text-gray-500 py-12">Carregando pacientes...</p>
      ) : filteredAnimais.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Nenhum paciente encontrado.</p>
      ) : (
        <div className="space-y-4">
          {filteredAnimais.map(animal => (
            <div
              key={animal.id}
              className="bg-white rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all overflow-hidden w-full cursor-pointer"
              onClick={() => handleEdit(animal)}
            >
              <div className="flex">
                {/* Foto */}
                <div className="w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0 bg-gray-200">
                  {animal.photoUrl ? (
                    <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl sm:text-6xl">🐴</div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 p-3 sm:p-6 min-w-0">
                  <h3 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{animal.nome}</h3>
                  <p className="text-emerald-700 font-medium text-sm sm:text-lg truncate">
                    {animal.raca?.nome || 'Raça não informada'}
                  </p>
                  <p className="text-gray-500 text-xs sm:text-sm mt-1 truncate">
                    {animal.categoriaAnimal
                      ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
                      : 'Categoria NRC não informada'}
                  </p>
                  {animal.user?.fullName && (
                    <p className="text-gray-400 text-xs mt-1 truncate">
                      Proprietário: {animal.user.fullName}
                    </p>
                  )}
                  <div className="flex gap-4 mt-2 sm:hidden">
                    <span className="text-xs text-gray-500">{idadeDisplay(animal)}</span>
                    <span className="text-xs text-gray-500">{animal.sexo}</span>
                  </div>
                </div>

                {/* Idade + Sexo desktop */}
                <div className="hidden sm:flex items-center gap-8 px-4 flex-shrink-0">
                  <div className="text-right">
                    <span className="block text-xs uppercase text-gray-500 tracking-widest">IDADE</span>
                    <span className="font-semibold text-gray-800">{idadeDisplay(animal)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-xs uppercase text-gray-500 tracking-widest">SEXO</span>
                    <span className="font-semibold text-gray-800">{animal.sexo}</span>
                  </div>
                </div>

                {/* Botões */}
                <div className="flex flex-col sm:flex-row items-center justify-center p-3 sm:p-6 gap-2 border-l border-gray-100">
                  <button
                    onClick={e => { e.stopPropagation(); handleEdit(animal); }}
                    className="flex items-center gap-1 sm:gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-3xl text-xs sm:text-sm font-medium transition-colors"
                  >
                    <Pencil size={15} /><span className="hidden sm:inline">Editar</span>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setAnimalToDelete(animal); }}
                    className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-3xl text-xs sm:text-sm font-medium transition-colors"
                  >
                    <Trash2 size={15} /><span className="hidden sm:inline">Excluir</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal exclusão */}
      {animalToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-emerald-700 text-white p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4 text-3xl">⚠️</div>
              <h2 className="text-xl sm:text-2xl font-bold">Excluir paciente?</h2>
              <p className="text-emerald-100 mt-2 text-sm">
                Tem certeza que deseja excluir <strong>{animalToDelete.nome}</strong> permanentemente?
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 flex-shrink-0">
                  {animalToDelete.photoUrl
                    ? <img src={animalToDelete.photoUrl} alt={animalToDelete.nome} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-3xl">🐴</div>
                  }
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-gray-900">{animalToDelete.nome}</h3>
                  <p className="text-gray-600 text-sm">{animalToDelete.raca?.nome || ''}</p>
                </div>
              </div>
            </div>
            <div className="border-t flex">
              <button onClick={() => setAnimalToDelete(null)}
                className="flex-1 py-4 sm:py-6 text-base sm:text-lg font-semibold text-gray-700 hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-4 sm:py-6 text-base sm:text-lg font-semibold text-red-600 hover:bg-red-50 border-l">
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnimaisVet;