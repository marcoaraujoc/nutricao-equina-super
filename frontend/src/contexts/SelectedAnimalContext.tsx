import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  raca?: any;
  especie?: any;
  sexo?: string;
  user?: any;
}

interface SelectedAnimalContextType {
  selectedAnimal: Animal | null;
  setSelectedAnimal: (animal: Animal | null) => void;
  refreshSelectedAnimal: () => Promise<void>;   // ← Nova função
  clearSelectedAnimal: () => void;
  hasAnimals: boolean;
  hasSingleAnimal: boolean;
  isNewUser: boolean;
}

const SelectedAnimalContext = createContext<SelectedAnimalContextType | undefined>(undefined);

export const SelectedAnimalProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [selectedAnimal, setSelectedAnimalState] = useState<Animal | null>(null);
  const [hasAnimals, setHasAnimals] = useState(false);
  const [hasSingleAnimal, setHasSingleAnimal] = useState(false);

  const loadAnimais = useCallback(async () => {
    if (!user?.id) return;

    try {
      const res = await api.get('/animais');
      const animais = res.data as Animal[];

      setHasAnimals(animais.length > 0);
      setHasSingleAnimal(animais.length === 1);

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
    } catch (error) {
      console.error('Erro ao carregar animais no context:', error);
    }
  }, [user?.id]);

  // Carrega os animais quando o usuário muda
  useEffect(() => {
    loadAnimais();
  }, [loadAnimais]);

  // ✅ Nova função para forçar atualização
  const refreshSelectedAnimal = async () => {
    await loadAnimais();
  };

  const setSelectedAnimal = (animal: Animal | null) => {
    setSelectedAnimalState(animal);
    if (animal) {
      localStorage.setItem('lastSelectedAnimalId', animal.id.toString());
    }
  };

  const clearSelectedAnimal = () => {
    setSelectedAnimalState(null);
    localStorage.removeItem('lastSelectedAnimalId');
  };

  return (
    <SelectedAnimalContext.Provider
      value={{
        selectedAnimal,
        setSelectedAnimal,
        refreshSelectedAnimal,     // ← Exportada
        clearSelectedAnimal,
        hasAnimals,
        hasSingleAnimal,
        isNewUser: !hasAnimals,
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