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

/** Um bloco de opções com cabeçalho — ver `grupos` em Props. */
export interface GrupoOpcoes {
  label: string;
  options: string[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Opções sem agrupamento. Ignorado quando `grupos` é informado. */
  options?: string[];
  /**
   * Opções AGRUPADAS, com um cabeçalho por bloco (o `<optgroup>` que o dropdown
   * próprio não tinha). Existe porque o seletor do cadastro de procedimentos passou a
   * reunir DUAS listas de naturezas diferentes — especialidades clínicas e categorias
   * de exame de imagem —, e sem o cabeçalho elas viravam uma lista só, em que
   * "Radiografia" parecia mais uma especialidade.
   * ⚠️ O VALOR continua sendo o nome puro (sem prefixo): foi conferido que nenhuma
   * categoria de imagem colide com nome de especialidade do catálogo. Surgindo
   * colisão, é aqui que entra um valor qualificado — não no chamador.
   */
  grupos?: GrupoOpcoes[];
  placeholder?: string;
  className: string;
  disabled?: boolean;
}

export default function DropdownSelect({ value, onChange, options, grupos, placeholder, className, disabled }: Props) {
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

  // `grupos` vence `options` — um chamador que passe os dois quer a lista agrupada.
  const blocos: GrupoOpcoes[] = grupos ?? [{ label: '', options: options ?? [] }];
  const vazio = blocos.every(b => b.options.length === 0);

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
          {vazio ? (
            <p className="text-xs text-gray-400 italic px-3 py-2">Nenhuma opção disponível</p>
          ) : blocos.map(bloco => (
            <div key={bloco.label || '_'}>
              {/* Grupo VAZIO não vira cabeçalho solto: um título sem nada embaixo é
                  ruído, e sugere que a lista falhou em carregar. */}
              {bloco.label && bloco.options.length > 0 && (
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50/60 sticky top-0">
                  {bloco.label}
                </p>
              )}
              {bloco.options.map(o => (
                <button key={o} type="button" onClick={() => selecionar(o)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    o === value ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  {o}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
