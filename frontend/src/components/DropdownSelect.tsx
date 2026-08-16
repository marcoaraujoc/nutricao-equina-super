// src/components/DropdownSelect.tsx
//
// Substituto do <select> nativo para os casos em que o navegador decide abrir
// as opções PARA CIMA (calcula que não há espaço embaixo — comum em modal perto
// do rodapé da tela) e a lista precisa sempre abrir PARA BAIXO. Não há CSS
// confiável para isso num <select> nativo entre navegadores; a saída é um
// dropdown próprio, com o painel sempre `absolute top-full` (mesma técnica do
// `ExameBuscaCombo` em pages/Exames.tsx).

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className: string;
  disabled?: boolean;
}

export default function DropdownSelect({ value, onChange, options, placeholder, className, disabled }: Props) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  const selecionar = (v: string) => { onChange(v); setAberto(false); };

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled}
        onClick={() => setAberto(a => !a)}
        className={`${className} flex items-center justify-between gap-2 text-left disabled:bg-gray-50 disabled:cursor-not-allowed`}>
        <span className={value ? '' : 'text-gray-400'}>{value || (placeholder ?? '— Selecionar —')}</span>
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
          {placeholder && (
            <button type="button" onClick={() => selecionar('')}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50">
              {placeholder}
            </button>
          )}
          {options.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-3 py-2">Nenhuma opção disponível</p>
          ) : options.map(o => (
            <button key={o} type="button" onClick={() => selecionar(o)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                o === value ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
