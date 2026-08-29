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
//   `onChange` emite '' quando vazio/incompleto/inválido.
// - Ícone de calendário abre o seletor nativo (showPicker) quando disponível.
//
// 🔴 DATA INVÁLIDA AGORA RECLAMA (2026-08-28). Antes o campo recusava 31/02/2026 em
// SILÊNCIO — e fazia pior: ao sair, VOLTAVA ao último valor válido. Quem digitava
// errado via o campo "consertar-se" sozinho para a data ANTERIOR e salvava aquela,
// achando que tinha trocado. Agora:
//   · o texto digitado PERMANECE (dá para corrigir o dígito errado, não recomeçar);
//   · a mensagem diz O QUE está errado ("fevereiro de 2026 tem 28 dias"), não um
//     genérico "data inválida" que deixa a pessoa olhando para os três campos;
//   · `onChange('')` avisa o formulário de que NÃO há data — é isso que impede o
//     salvamento com o valor antigo e faz a validação de campo obrigatório disparar.
// A regra mora em `utils/dataValidacao.ts`, compartilhada com o `DateInputBR`.

import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { validarDataBR } from '../utils/dataValidacao';

interface DateInputProps {
  value: string;                       // ISO ('YYYY-MM-DD' ou 'YYYY-MM-DDTHH:MM') | ''
  onChange: (value: string) => void;   // emite o ISO correspondente (ou '')
  withTime?: boolean;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  /**
   * Barra de filtros / toolbar: só pinta de vermelho e explica no `title`, sem o
   * bloco de mensagem embaixo — ali ele empurraria a barra inteira e desalinharia os
   * campos vizinhos. Em formulário (o padrão) a mensagem aparece abaixo do campo.
   */
  compacto?: boolean;
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

export default function DateInput({
  value, onChange, withTime = false, className = '', min, max, disabled, id,
  compacto = false, ...rest
}: DateInputProps) {
  const [text, setText] = useState<string>(isoToBR(value, withTime));
  const [erro, setErro] = useState<string | null>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Sincroniza quando o valor externo muda (ex.: reset do formulário).
  useEffect(() => {
    setText(isoToBR(value, withTime));
    setErro(null);
  }, [value, withTime]);

  const handleText = (raw: string) => {
    const masked = maskBR(raw, withTime);
    setText(masked);

    const r = validarDataBR(masked, { withTime, min, max });
    // Enquanto a data está INCOMPLETA não se reclama de nada: a pessoa ainda está
    // digitando, e um erro a cada tecla é ruído, não ajuda.
    setErro(r.incompleta ? null : r.erro);
    // Vazio, incompleto ou inválido → o formulário fica SEM data. É o que impede
    // salvar com o valor anterior sem que ninguém perceba.
    onChange(r.iso);
  };

  const handleBlur = () => {
    if (text === '') { setErro(null); onChange(''); return; }
    const r = validarDataBR(text, { withTime, min, max });
    // Ao SAIR do campo, incompleto vira erro — aqui a pessoa já terminou de digitar.
    // ⚠️ O texto NÃO é revertido: apagar o que ela escreveu esconde onde está o
    // engano e a obriga a redigitar tudo.
    setErro(r.erro);
    onChange(r.iso);
  };

  const abrirSeletor = () => {
    const el = nativeRef.current;
    if (!el || disabled) return;
    el.showPicker?.();
  };

  const caixa = (
    <div
      className={`relative flex items-center ${className} ${erro ? 'border-red-400' : ''}`}
      title={compacto && erro ? erro : undefined}
    >
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
        aria-invalid={erro ? true : undefined}
        maxLength={withTime ? 16 : 10}
        className={`w-full bg-transparent focus:outline-none pr-5 ${erro ? 'text-red-600' : ''}`}
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

  // Em modo compacto o componente continua sendo UM elemento só — envolvê-lo num
  // wrapper quebraria as toolbars que o tratam como item de flex.
  if (compacto) return caixa;

  return (
    <div className="w-full">
      {caixa}
      {erro && <p className="text-[11px] text-red-500 mt-1" role="alert">{erro}</p>}
    </div>
  );
}
