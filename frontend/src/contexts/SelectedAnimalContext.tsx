import { createContext, useContext, useState, useEffect } from 'react';
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

  // Carrega os animais do usuário logado
  useEffect(() => {
    if (!user?.id) return;

    const loadAnimais = async () => {
      try {
        const res = await api.get('/animais');
        const animais = res.data as Animal[];

        setHasAnimals(animais.length > 0);
        setHasSingleAnimal(animais.length === 1);

        if (animais.length === 0) {
          setSelectedAnimalState(null);
          return;
        }

        // Regra: seleciona o animal com menor ID (quando tiver mais de um)
        let toSelect = animais.reduce((prev, curr) => 
          prev.id < curr.id ? prev : curr
        );

        // Respeita a última seleção salva no localStorage
        const lastSelectedId = localStorage.getItem('lastSelectedAnimalId');
        if (lastSelectedId) {
          const found = animais.find(a => a.id.toString() === lastSelectedId);
          if (found) toSelect = found;
        }

        setSelectedAnimalState(toSelect);
      } catch (error) {
        console.error('Erro ao carregar animais no context:', error);
      }
    };

    loadAnimais();
  }, [user?.id]);

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

// Exportação única e limpa
export { SelectedAnimalContext };