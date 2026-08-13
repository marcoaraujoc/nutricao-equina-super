// src/components/CampoForm.tsx
//
// Rótulo + campo, no padrão das telas de cadastro — mesma formatação de
// `CadastroPessoal.tsx` (label em peso médio, sem caixa alta; input com borda
// cinza-300, cantos arredondados e foco por borda, sem anel).
//
// POR QUÊ existe: `CadastroEmpresa`, `EquipeManager` e `CriacaoGestor` são as telas de
// cadastro da EMPRESA e PRECISAM parecer a mesma família — inclusive do Cadastro Pessoal.
// Com o `Campo` copiado em cada uma, o primeiro ajuste de tipografia num lado deixaria as
// outras para trás — e a diferença aparece justamente na comparação lado a lado.
//
// ⚠️ O rótulo é OBRIGATÓRIO, e é essa a regra que o componente existe para impor:
// placeholder NÃO é título. Ele some no instante em que a pessoa digita, some no
// preenchimento automático do navegador, e não é lido como rótulo por leitor de tela —
// então o campo preenchido fica sem identificação nenhuma.

import type { ReactNode } from 'react';

/** Classe padrão do input das telas de cadastro (mesma de CadastroPessoal.tsx). */
export const INPUT_CLS =
  'w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';

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
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
      {ajuda && <p className="text-xs text-gray-400 mt-1">{ajuda}</p>}
    </div>
  );
}
