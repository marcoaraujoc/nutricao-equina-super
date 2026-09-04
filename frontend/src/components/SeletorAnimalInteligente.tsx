// src/components/SeletorAnimalInteligente.tsx
//
// Seletor de paciente das telas clínicas. "Inteligente" porque resolve o caso de
// XARÁS: quando há mais de um animal com o MESMO nome, um segundo campo aparece para
// filtrar pelo proprietário — sem ele, o select mostraria duas linhas idênticas e a
// escolha viraria adivinhação.
//
// Vivia dentro de Atendimento.tsx; foi extraído quando a tela de Vacina saiu do shell
// e passou a precisar do mesmo seletor. Duas cópias divergiriam na primeira correção.

import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import FotoAnimal from './FotoAnimal';

/** Forma MÍNIMA exigida do animal — cada tela passa o seu tipo, mais rico. */
export interface AnimalSelecionavel {
  id:        number;
  nome:      string;
  photoUrl?: string | null;
  user?:     { fullName: string } | null;
}

export default function SeletorAnimalInteligente<T extends AnimalSelecionavel>({
  animais, animalAtual, onSelecionar,
}: {
  animais:      T[];
  animalAtual:  T | null;
  onSelecionar: (a: T) => void;
}) {
  const [filtroDono,     setFiltroDono]     = useState('');
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownAberto(false); setFiltroDono('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Some com o seletor só quando não há o que escolher: nenhum paciente, ou um único
  // paciente JÁ escolhido. Sem paciente escolhido ele PRECISA aparecer — desde
  // 2026-09-03 a tela de Vacina abre vazia (a pedido), e escondê-lo numa clínica de um
  // paciente só deixaria a tela sem nenhuma forma de escolher.
  if (animais.length === 0) return null;
  if (animais.length === 1 && animalAtual) return null;

  const nomesCount = animais.reduce<Record<string, number>>((acc, a) => {
    acc[a.nome] = (acc[a.nome] ?? 0) + 1; return acc;
  }, {});

  const animalTemDuplicata  = animalAtual ? (nomesCount[animalAtual.nome] ?? 0) > 1 : false;
  const duplicatas          = animalAtual ? animais.filter(a => a.nome === animalAtual.nome) : [];
  const duplicatasFiltradas = filtroDono.trim()
    ? duplicatas.filter(a => (a.user?.fullName ?? '').toLowerCase().includes(filtroDono.toLowerCase()))
    : duplicatas;

  return (
    <div className="space-y-2 mb-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
        <select value={animalAtual?.id ?? ''}
          onChange={e => {
            const sel = animais.find(a => a.id === Number(e.target.value));
            if (sel) { onSelecionar(sel); setFiltroDono(''); }
          }}
          className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm">
          {/* O vazio PRECISA ser uma <option> de verdade: com `value=""` e sem ela, o
              navegador exibe a PRIMEIRA opção da lista e o campo parece preenchido com
              um paciente que ninguém escolheu. */}
          {!animalAtual && <option value="">Selecione o paciente</option>}
          {animais.map(a => (
            <option key={a.id} value={a.id}>
              {a.nome}{(nomesCount[a.nome] ?? 0) > 1 ? ` — ${a.user?.fullName ?? '?'}` : ''}
            </option>
          ))}
        </select>
      </div>
      {animalTemDuplicata && (
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs font-medium text-amber-700 mb-1">
            ⚠️ {duplicatas.length} animais com o nome "{animalAtual?.nome}" — filtre pelo proprietário:
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={filtroDono}
              onChange={e => { setFiltroDono(e.target.value); setDropdownAberto(true); }}
              onFocus={() => setDropdownAberto(true)}
              placeholder="Nome do proprietário..."
              className="w-full pl-9 pr-4 py-2.5 border border-amber-300 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-amber-50" />
          </div>
          {dropdownAberto && duplicatasFiltradas.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-56 overflow-y-auto">
              {duplicatasFiltradas.map(a => (
                <button key={a.id}
                  onClick={() => { onSelecionar(a); setFiltroDono(''); setDropdownAberto(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    a.id === animalAtual?.id ? 'bg-emerald-50' : ''
                  }`}>
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    <FotoAnimal url={a.photoUrl as string} nome="" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{a.nome}</p>
                    <p className="text-xs text-gray-400 truncate">Proprietário: {a.user?.fullName ?? '—'}</p>
                  </div>
                  {a.id === animalAtual?.id && <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
