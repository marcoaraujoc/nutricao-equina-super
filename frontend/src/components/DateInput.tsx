// frontend/src/components/DateInput.tsx
// Campo de data (ou data+hora) que SEMPRE exibe no padrão brasileiro DD/MM/YYYY
// (e HH:MM quando withTime), independente do idioma do navegador/OS. O <input type="date">
// nativo segue o locale do browser e no Chrome ignora o `lang` da página — por isso
// aparecia MM/DD/YYYY.
//
// - Exibe uma máscara DD/MM/YYYY [HH:MM] (digitação numérica).
// - Mantém o valor interno em ISO (drop-in para os estados atuais):
//     date-only  → `value`/`onChange` usam 'YYYY-MM-DD'
//     withTime   → 'YYYY-MM-DDTHH:MM' (mesmo formato do <input datetime-local>)
//   `onChange` emite '' quando vazio/incompleto.
// - Ícone de calendário abre o seletor nativo (showPicker) quando disponível.

import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';

interface DateInputProps {
  value: string;                       // ISO ('YYYY-MM-DD' ou 'YYYY-MM-DDTHH:MM') | ''
  onChange: (value: string) => void;   // emite o ISO correspondente (ou '')
  withTime?: boolean;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

const isoToBR = (iso: string, withTime: boolean): string => {
  if (!iso) return '';
  const [datePart, timePartRaw = ''] = iso.split('T');
  const p = datePart.split('-');
  if (p.length !== 3) return '';
  const [y, m, d] = p;
  if (!y || !m || !d) return '';
  const dataBR = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  if (!withTime) return dataBR;
  const hm = timePartRaw.slice(0, 5); // HH:MM
  return hm ? `${dataBR} ${hm}` : dataBR;
};

const maskBR = (raw: string, withTime: boolean): string => {
  const max = withTime ? 12 : 8;
  const d = raw.replace(/\D/g, '').slice(0, max);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '/' + d.slice(2, 4);
  if (d.length > 4) out += '/' + d.slice(4, 8);
  if (withTime && d.length > 8)  out += ' ' + d.slice(8, 10);
  if (withTime && d.length > 10) out += ':' + d.slice(10, 12);
  return out;
};

// DD/MM/YYYY [HH:MM] (mascarado) → ISO válido, ou '' se incompleto/inválido.
const brToISO = (br: string, withTime: boolean): string => {
  const digits = br.replace(/\D/g, '');
  const needed = withTime ? 12 : 8;
  if (digits.length !== needed) return '';
  const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8);
  const hh = withTime ? digits.slice(8, 10) : '00';
  const mm = withTime ? digits.slice(10, 12) : '00';
  const dt = new Date(`${y}-${m}-${d}T${hh}:${mm}:00`);
  if (
    isNaN(dt.getTime()) ||
    dt.getFullYear() !== Number(y) || dt.getMonth() + 1 !== Number(m) || dt.getDate() !== Number(d) ||
    Number(hh) > 23 || Number(mm) > 59
  ) return '';
  return withTime ? `${y}-${m}-${d}T${hh}:${mm}` : `${y}-${m}-${d}`;
};

export default function DateInput({
  value, onChange, withTime = false, className = '', min, max, disabled, id, ...rest
}: DateInputProps) {
  const [text, setText] = useState<string>(isoToBR(value, withTime));
  const nativeRef = useRef<HTMLInputElement>(null);

  // Sincroniza quando o valor externo muda (ex.: reset do formulário).
  useEffect(() => { setText(isoToBR(value, withTime)); }, [value, withTime]);

  const handleText = (raw: string) => {
    const masked = maskBR(raw, withTime);
    setText(masked);
    if (masked === '') { onChange(''); return; }
    const iso = brToISO(masked, withTime);
    if (iso) onChange(iso);
  };

  const handleBlur = () => {
    if (text === '') { onChange(''); return; }
    const iso = brToISO(text, withTime);
    // Incompleto/inválido ao sair → volta ao último valor válido.
    setText(iso ? isoToBR(iso, withTime) : isoToBR(value, withTime));
  };

  const abrirSeletor = () => {
    const el = nativeRef.current;
    if (!el || disabled) return;
    el.showPicker?.();
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={withTime ? 'dd/mm/aaaa hh:mm' : 'dd/mm/aaaa'}
        value={text}
        onChange={e => handleText(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        id={id}
        aria-label={rest['aria-label']}
        maxLength={withTime ? 16 : 10}
        className="w-full bg-transparent focus:outline-none pr-5"
      />
      <button
        type="button"
        onClick={abrirSeletor}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Abrir calendário"
        className="absolute right-0 text-gray-400 hover:text-gray-600 disabled:opacity-40"
      >
        <Calendar size={14} />
      </button>
      {/* Input nativo apenas para o seletor de calendário (não exibe texto). */}
      <input
        ref={nativeRef}
        type={withTime ? 'datetime-local' : 'date'}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
      />
    </div>
  );
}
