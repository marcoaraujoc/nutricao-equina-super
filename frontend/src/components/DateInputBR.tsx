// DateInputBR.tsx — input de data que exibe DD/MM/YYYY e aceita digitação manual
// O valor interno é sempre YYYY-MM-DD (padrão HTML date input).
//
// 🔴 DATA INVÁLIDA RECLAMA (2026-08-28). Antes o componente detectava 31/02/2026 mas
// só pintava o texto de vermelho e punha um `title` — que não aparece no celular e
// ninguém procura no desktop. Agora mostra a mensagem, e ela diz O QUE está errado.
// A regra é a mesma do `DateInput` (`utils/dataValidacao.ts`): duas validações de data
// diferentes na mesma aplicação davam veredictos diferentes para o mesmo texto.

import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { formatDate } from '../utils/dateUtils';
import { validarDataBR } from '../utils/dataValidacao';

interface Props {
  value:          string;          // YYYY-MM-DD ou ''
  onChange:       (v: string) => void;
  placeholder?:   string;
  className?:     string;          // classe do wrapper externo
  inputClassName?: string;         // classe do input de texto
  min?:           string;          // YYYY-MM-DD
  disabled?:      boolean;
  showIcon?:      boolean;
}

export default function DateInputBR({
  value,
  onChange,
  placeholder = 'DD/MM/AAAA',
  className = '',
  inputClassName = '',
  min,
  disabled = false,
  showIcon = true,
}: Props) {
  const [text,    setText]    = useState(value ? formatDate(value) : '');
  const [erro, setErro] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ? formatDate(value) : '');
    setErro(null);
  }, [value]);

  const handleTextChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);

    let display = digits;
    if (digits.length > 4) {
      display = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    } else if (digits.length > 2) {
      display = digits.slice(0, 2) + '/' + digits.slice(2);
    }

    setText(display);

    const r = validarDataBR(display, { min });
    // Incompleta não é erro: a pessoa ainda está digitando.
    setErro(r.incompleta ? null : r.erro);
    // ⚠️ Emite SEMPRE — inclusive '' quando ficou inválida. Antes o `onChange` só era
    // disparado no caminho feliz, então trocar uma data válida por uma inválida deixava
    // o formulário com a data ANTIGA e o campo mostrando a nova: o que era salvo não
    // era o que estava na tela.
    onChange(r.iso);
  };

  const openPicker = () => {
    if (disabled) return;
    try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.click(); }
  };

  return (
    <div className="w-full">
    <div className={`flex items-center gap-1 ${className} ${erro ? 'border-red-400' : ''}`}>
      <input
        type="text"
        value={text}
        onChange={e => handleTextChange(e.target.value)}
        placeholder={placeholder}
        maxLength={10}
        disabled={disabled}
        aria-invalid={erro ? true : undefined}
        className={`flex-1 bg-transparent text-sm focus:outline-none disabled:text-gray-400 ${
          erro ? 'text-red-600' : 'text-gray-900'
        } ${inputClassName}`}
      />
      {showIcon && (
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          tabIndex={-1}
          className="text-gray-500 hover:text-emerald-600 disabled:opacity-40 flex-shrink-0 p-0.5"
        >
          <Calendar size={14} />
        </button>
      )}
      {/* Input nativo oculto — só abre o calendário */}
      <input
        ref={pickerRef}
        type="date"
        value={value}
        min={min}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        tabIndex={-1}
      />
    </div>
      {erro && <p className="text-[11px] text-red-500 mt-1" role="alert">{erro}</p>}
    </div>
  );
}