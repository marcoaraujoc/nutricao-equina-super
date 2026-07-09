import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  idadeAnos?: number;
  peso?: number;
  sexo?: string;
  categoriaAnimal?: string;
  tipoExercicio?: string;
  veterinarioNome?: string;
  veterinarioClinica?: string;
  raca?: { nome: string };
  especie?: { nome: string };
  user?: { fullName: string; email: string };
  logoUrl?: string | null;
}

interface SelectedAnimalContextType {
  selectedAnimal: Animal | null;
  setSelectedAnimal: (animal: Animal | null) => void;
  selectedAnimals: Animal[];
  toggleAnimalSelection: (animal: Animal) => void;
  refreshSelectedAnimal: () => Promise<void>;
  clearSelectedAnimal: () => void;
  hasAnimals: boolean;
  hasSingleAnimal: boolean;
  isNewUser: boolean;
}

const SelectedAnimalContext = createContext<SelectedAnimalContextType | undefined>(undefined);

export const SelectedAnimalProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [selectedAnimal, setSelectedAnimalState] = useState<Animal | null>(null);
  const [selectedAnimals, setSelectedAnimalsState] = useState<Animal[]>([]);
  const [hasAnimals, setHasAnimals] = useState(false);
  const [hasSingleAnimal, setHasSingleAnimal] = useState(false);
  const [cadastroCompleto, setCadastroCompleto] = useState(false);
  const [isProprietario, setIsProprietario] = useState(false);

  const loadAnimais = useCallback(async () => {
    if (!user?.id) return;
    // Convites pendentes indicam que o usuário ainda não pertence a uma equipe —
    // evita 403 no checkPermission antes da aceitação do convite.
    if (user.pendingInvite) return;

    try {
      const [animaisRes, perfilRes] = await Promise.allSettled([
        api.get('/animais'),
        api.get('/users/me')
      ]);

      // Animais
      const animais = animaisRes.status === 'fulfilled'
      ? ((animaisRes.value.data?.dados ?? animaisRes.value.data ?? []) as Animal[])
      : [];

      setHasAnimals(animais.length > 0);
      setHasSingleAnimal(animais.length === 1);

      // Perfil
      if (perfilRes.status === 'fulfilled') {
        const perfil         = perfilRes.value.data;
        const prop           = perfil?.userType === 'PROPRIETARIO';
        const perfilCompleto = !!(perfil?.phone && perfil?.endereco && perfil?.cep);

        setCadastroCompleto(perfilCompleto);
        setIsProprietario(prop);

        // Só o PROPRIETÁRIO precisa de animal para liberar os módulos — vet,
        // gestor e fornecedor sem animais continuam com acesso
        if (!prop && animais.length === 0) {
          setHasAnimals(true);
          setHasSingleAnimal(false);
        }
      } else {
        console.warn('Não foi possível carregar cadastro pessoal:', perfilRes.reason);
        setCadastroCompleto(false);
      }

      if (animais.length === 0) {
        setSelectedAnimalState(null);
        return;
      }

      let toSelect = animais.reduce((prev, curr) =>
        prev.id < curr.id ? prev : curr
      );

      const lastSelectedId = localStorage.getItem('lastSelectedAnimalId');
      if (lastSelectedId) {
        const found = animais.find(a => a.id.toString() === lastSelectedId);
        if (found) toSelect = found;
      }

      setSelectedAnimalState(toSelect);
      setSelectedAnimalsState(prev => {
        if (prev.length > 0) return prev;
        return [toSelect];
      });
    } catch (error) {
      console.error('Erro ao carregar dados no context:', error);
    }
  }, [user?.id, user?.pendingInvite]);

  useEffect(() => {
    loadAnimais();
  }, [loadAnimais]);

  const refreshSelectedAnimal = async () => {
    await loadAnimais();
  };

  const setSelectedAnimal = (animal: Animal | null) => {
    setSelectedAnimalState(animal);
    if (animal) {
      localStorage.setItem('lastSelectedAnimalId', animal.id.toString());
    }
  };

  const toggleAnimalSelection = (animal: Animal) => {
    setSelectedAnimalsState(prev => {
      const exists = prev.some(a => a.id === animal.id);
      return exists ? prev.filter(a => a.id !== animal.id) : [...prev, animal];
    });
  };

  const clearSelectedAnimal = () => {
    setSelectedAnimalState(null);
    setSelectedAnimalsState([]);
    localStorage.removeItem('lastSelectedAnimalId');
  };

  return (
    <SelectedAnimalContext.Provider
      value={{
        selectedAnimal,
        setSelectedAnimal,
        selectedAnimals,
        toggleAnimalSelection,
        refreshSelectedAnimal,
        clearSelectedAnimal,
        hasAnimals,
        hasSingleAnimal,
        // PROPRIETÁRIO: precisa de cadastro completo + ao menos um animal.
        // Demais perfis (vet, gestor, fornecedor): apenas cadastro completo.
        isNewUser: isProprietario ? (!hasAnimals || !cadastroCompleto) : !cadastroCompleto,
      }}
    >
      {children}
    </SelectedAnimalContext.Provider>
  );
};

export const useSelectedAnimal = () => {
  const context = useContext(SelectedAnimalContext);
  if (!context) {
    throw new Error('useSelectedAnimal deve ser usado dentro de SelectedAnimalProvider');
  }
  return context;
};

export { SelectedAnimalContext };