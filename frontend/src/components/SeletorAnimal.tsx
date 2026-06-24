import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
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
  animais:         AnimalOpcao[];
  animalIdAtual?:  string | number | null;
  rotaBase:        string;
  label?:          string;
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
  label = 'Animal',
  className = '',
}: SeletorAnimalProps) {
  const navigate = useNavigate();
  const { selectedAnimals, toggleAnimalSelection, setSelectedAnimal } = useSelectedAnimal();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (animais.length <= 1) return null;

  const primaryId   = animalIdAtual ? Number(animalIdAtual) : null;
  const selectedIds = new Set(selectedAnimals.map(a => a.id));
  const chips       = animais.filter(a => selectedIds.has(a.id));

  const handleToggle = (a: AnimalOpcao) => {
    const animal = toAnimal(a);
    if (selectedIds.has(a.id)) {
      toggleAnimalSelection(animal);
    } else {
      toggleAnimalSelection(animal);
      setSelectedAnimal(animal);
      navigate(`${rotaBase}/${a.id}`);
      setOpen(false);
    }
  };

  const handleRemoveChip = (e: React.MouseEvent, a: AnimalOpcao) => {
    e.stopPropagation();
    const animal = toAnimal(a);
    toggleAnimalSelection(animal);
    if (a.id === primaryId) {
      const remaining = selectedAnimals.filter(s => s.id !== a.id);
      if (remaining.length > 0) {
        setSelectedAnimal(remaining[0]);
        navigate(`${rotaBase}/${remaining[0].id}`);
      }
    }
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      {label && (
        <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-left bg-white shadow-sm flex items-center gap-2 focus:outline-none focus:border-emerald-600 min-h-[44px]"
      >
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {chips.length === 0 ? (
            <span className="text-gray-400">Selecionar animal…</span>
          ) : (
            chips.map(a => (
              <span
                key={a.id}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  a.id === primaryId
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {a.nome}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => handleRemoveChip(e as unknown as React.MouseEvent, a)}
                  onKeyDown={e => e.key === 'Enter' && handleRemoveChip(e as unknown as React.MouseEvent, a)}
                  className="cursor-pointer hover:text-red-500 leading-none"
                >
                  <X size={10} strokeWidth={2.5} />
                </span>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          size={16}
          className={`text-gray-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
          <ul className="max-h-64 overflow-y-auto py-1">
            {animais.map(a => {
              const isSelected = selectedIds.has(a.id);
              const isPrimary  = a.id === primaryId;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => handleToggle(a)}
                    className={`w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {a.photoUrl ? (
                      <img
                        src={a.photoUrl}
                        alt={a.nome}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-emerald-700 leading-none">
                          {a.nome[0].toUpperCase()}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{a.nome}</p>
                      {(a.especie?.nome || a.raca?.nome) && (
                        <p className="text-xs text-gray-400 truncate">
                          {[a.especie?.nome, a.raca?.nome].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isPrimary ? 'bg-emerald-500' : 'bg-gray-300'
                        }`}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
