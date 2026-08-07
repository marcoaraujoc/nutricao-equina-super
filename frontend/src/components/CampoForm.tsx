// src/components/CampoForm.tsx
//
// Rótulo + campo, no padrão das telas de cadastro (título em CAIXA ALTA acima do input).
//
// POR QUÊ existe: `CadastroEmpresa` e `EquipeManager` são as duas telas de empresa e
// PRECISAM parecer a mesma tela. Com o `Campo` copiado em cada uma, o primeiro ajuste de
// tipografia num lado deixaria a outra para trás — e a diferença aparece justamente na
// comparação lado a lado que o usuário faz entre as duas.
//
// ⚠️ O rótulo é OBRIGATÓRIO, e é essa a regra que o componente existe para impor:
// placeholder NÃO é título. Ele some no instante em que a pessoa digita, some no
// preenchimento automático do navegador, e não é lido como rótulo por leitor de tela —
// então o campo preenchido fica sem identificação nenhuma.

import type { ReactNode } from 'react';

/** Classe padrão do input das telas de cadastro. */
export const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';

interface Props {
  label:      string;
  children:   ReactNode;
  className?: string;
  /** Texto auxiliar sob o campo (ex.: o que acontece se ficar em branco). */
  ajuda?:     string;
}

export default function Campo({ label, children, className = '', ajuda }: Props) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
        {label}
      </label>
      {children}
      {ajuda && <p className="text-[11px] text-gray-400 mt-1">{ajuda}</p>}
    </div>
  );
}
