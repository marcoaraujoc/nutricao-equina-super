// src/components/SeletorAnimal.tsx
// Renderiza um <select> somente quando há mais de um animal disponível.
// Ao trocar, navega para `${rotaBase}/${animal.id}` e atualiza o contexto.

import { useNavigate } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';

interface AnimalOpcao {
  id:              number;
  nome:            string;
  photoUrl?:       string | null;
  dataNascimento?: string | null;
  idadeAnos?:      number | null;
  raca?:           { nome: string } | null;
  especie?:        { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
}

interface SeletorAnimalProps {
  /** Lista de animais disponíveis para seleção */
  animais:          AnimalOpcao[];
  /** ID do animal atualmente selecionado */
  animalIdAtual?:   string | number | null;
  /** Rota base para navegação — ex: "/dieta", "/exames" */
  rotaBase:         string;
  /** Label opcional acima do select */
  label?:           string;
  /** Classe CSS adicional no container */
  className?:       string;
}

export default function SeletorAnimal({
  animais,
  animalIdAtual,
  rotaBase,
  label = 'Animal',
  className = '',
}: SeletorAnimalProps) {
  const navigate           = useNavigate();
  const { setSelectedAnimal } = useSelectedAnimal();

  // Não renderiza se houver apenas um animal
  if (animais.length <= 1) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id       = Number(e.target.value);
    const selecionado = animais.find(a => a.id === id);
    if (!selecionado) return;

    setSelectedAnimal({
      id:             selecionado.id,
      nome:           selecionado.nome,
      photoUrl:       selecionado.photoUrl       ?? undefined,
      dataNascimento: selecionado.dataNascimento ?? undefined,
      idadeAnos:      selecionado.idadeAnos      ?? undefined,
      raca:           selecionado.raca           ?? undefined,
      especie:        selecionado.especie        ?? undefined,
      user:           selecionado.user           ?? undefined,
    });

    navigate(`${rotaBase}/${id}`);
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      )}
      <select
        value={animalIdAtual ?? ''}
        onChange={handleChange}
        className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm"
      >
        {animais.map(a => (
          <option key={a.id} value={a.id}>{a.nome}</option>
        ))}
      </select>
    </div>
  );
}