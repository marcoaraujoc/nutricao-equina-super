import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  raca?: any;
  user?: any;
}

interface SelectedAnimalContextType {
  selectedAnimal: Animal | null;
  setSelectedAnimal: (animal: Animal | null) => void;
  clearSelectedAnimal: () => void;
  hasSingleAnimal: boolean;
}

const SelectedAnimalContext = createContext<SelectedAnimalContextType | undefined>(undefined);

export const SelectedAnimalProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [selectedAnimal, setSelectedAnimalState] = useState<Animal | null>(null);
  const [hasSingleAnimal, setHasSingleAnimal] = useState(false);

  // ✅ NOVA LÓGICA: busca por e-mail no login (ID interno do banco)
  useEffect(() => {
    if (!user?.email) return;

    axios.get('/api/animais', { params: { email: user.email } })
      .then((res) => {
        const animais = res.data;
        setHasSingleAnimal(animais.length === 1);

        if (animais.length === 1) {
          setSelectedAnimalState(animais[0]);
        }
      })
      .catch(console.error);
  }, [user?.email]);

  const setSelectedAnimal = (animal: Animal | null) => {
    setSelectedAnimalState(animal);
    if (animal) localStorage.setItem('selectedAnimal', JSON.stringify(animal));
  };

  const clearSelectedAnimal = () => {
    setSelectedAnimalState(null);
    localStorage.removeItem('selectedAnimal');
  };

  // Recupera do localStorage
  useEffect(() => {
    const saved = localStorage.getItem('selectedAnimal');
    if (saved) setSelectedAnimalState(JSON.parse(saved));
  }, []);

  return (
    <SelectedAnimalContext.Provider value={{ selectedAnimal, setSelectedAnimal, clearSelectedAnimal, hasSingleAnimal }}>
      {children}
    </SelectedAnimalContext.Provider>
  );
};

export const useSelectedAnimal = () => {
  const context = useContext(SelectedAnimalContext);
  if (!context) throw new Error('useSelectedAnimal deve ser usado dentro de SelectedAnimalProvider');
  return context;
};