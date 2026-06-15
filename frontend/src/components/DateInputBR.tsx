// DateInputBR.tsx — input de data que exibe DD/MM/YYYY e aceita digitação manual
// O valor interno é sempre YYYY-MM-DD (padrão HTML date input).

import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

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
  const [invalid, setInvalid] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ? formatDate(value) : '');
    setInvalid(false);
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
    setInvalid(false);

    if (digits.length === 8) {
      const d = parseInt(digits.slice(0, 2), 10);
      const m = parseInt(digits.slice(2, 4), 10);
      const y = parseInt(digits.slice(4, 8), 10);
      // Valida se a data existe de fato (ex: 31/02 → inválida)
      const dt = new Date(y, m - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
        onChange(`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
      } else {
        setInvalid(true); // data inválida — não dispara onChange
      }
    } else if (raw === '') {
      onChange('');
    }
  };

  const openPicker = () => {
    if (disabled) return;
    try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.click(); }
  };

  return (
    <div className={`flex items-center gap-1 ${className}`} title={invalid ? 'Data inválida' : undefined}>
      <input
        type="text"
        value={text}
        onChange={e => handleTextChange(e.target.value)}
        placeholder={placeholder}
        maxLength={10}
        disabled={disabled}
        className={`flex-1 bg-transparent text-sm focus:outline-none disabled:text-gray-400 ${
          invalid ? 'text-red-600' : 'text-gray-900'
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
  );
}