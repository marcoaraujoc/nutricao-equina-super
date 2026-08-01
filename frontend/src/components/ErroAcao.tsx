// src/components/ErroAcao.tsx
// Erro de AÇÃO — renderiza na superfície que disparou a ação (rodapé do modal, ao lado
// do botão), NUNCA no topo da página.
//
// POR QUÊ: com o formulário num modal, um <InlineError> no topo da página fica ATRÁS do
// overlay. O usuário clica em "Salvar", nada acontece visivelmente, e a mensagem só
// aparece quando ele fecha o modal — em outra tela, já sem contexto. Além da mensagem,
// os campos culpados precisam ser apontados: dizer "Telefone é obrigatório" sem marcar
// o campo obriga o usuário a caçar qual dos vinte inputs está vazio.
//
// USO
//   const [erro, setErro] = useState<ErroAcaoDados | null>(null);
//   setErro({ mensagem: 'Telefone é obrigatório', campos: ['phone'] });
//   <ErroAcao erro={erro} />                       // junto ao botão
//   <input className={classeErro(erro, 'phone', inputCls)} />
//
// Ver também `InlineError`, que continua correto para erro de CARGA da página
// (falha ao listar, sem permissão) — esse sim pertence ao topo.

import { AlertCircle } from 'lucide-react';

export interface ErroAcaoDados {
  mensagem: string;
  /** Nomes dos campos a destacar; devem casar com as chaves usadas em `classeErro` */
  campos?: string[];
}

interface Props {
  erro: ErroAcaoDados | null;
  className?: string;
}

export default function ErroAcao({ erro, className = '' }: Props) {
  if (!erro?.mensagem) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 ${className}`}
    >
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
      <span className="min-w-0">{erro.mensagem}</span>
    </div>
  );
}

/** Acrescenta o destaque de erro à classe do input quando o campo está na lista. */
export function classeErro(erro: ErroAcaoDados | null, campo: string, base: string): string {
  return erro?.campos?.includes(campo)
    ? `${base} border-red-400 ring-1 ring-red-300 focus:border-red-400`
    : base;
}

/** true quando o campo está marcado como culpado — para `aria-invalid` e afins. */
export function temErro(erro: ErroAcaoDados | null, campo: string): boolean {
  return !!erro?.campos?.includes(campo);
}
