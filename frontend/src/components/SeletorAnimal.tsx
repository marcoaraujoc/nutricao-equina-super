import { useMemo } from 'react';
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
  user?:           { id?: number; fullName: string; email: string } | null;
}

interface SeletorAnimalProps {
  animais:         AnimalOpcao[];
  animalIdAtual?:  string | number | null;
  rotaBase:        string;
  className?:      string;
}

function toAnimal(a: AnimalOpcao) {
  return {
    id:             a.id,
    nome:           a.nome,
    photoUrl:       a.photoUrl       ?? undefined,
    dataNascimento: a.dataNascimento ?? undefined,
    idadeAnos:      a.idadeAnos      ?? undefined,
    raca:           a.raca           ?? undefined,
    especie:        a.especie        ?? undefined,
    user:           a.user           ?? undefined,
  };
}

export default function SeletorAnimal({
  animais,
  animalIdAtual,
  rotaBase,
  className = '',
}: SeletorAnimalProps) {
  const navigate = useNavigate();
  const { setSelectedAnimal } = useSelectedAnimal();

  const currentId = animalIdAtual ? String(animalIdAtual) : '';

  const nomesCount = useMemo(() =>
    animais.reduce<Record<string, number>>((acc, a) => {
      acc[a.nome] = (acc[a.nome] ?? 0) + 1; return acc;
    }, {}),
  [animais]);

  if (animais.length <= 1) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    const a = animais.find(x => String(x.id) === val);
    if (a) {
      setSelectedAnimal(toAnimal(a));
      navigate(`${rotaBase}/${a.id}`);
    }
  };

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
      <select
        value={currentId}
        onChange={handleChange}
        className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm"
      >
        {animais.map(a => (
          <option key={a.id} value={a.id}>
            {a.nome}{(nomesCount[a.nome] ?? 0) > 1 ? ` — ${a.user?.fullName ?? '?'}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
