// frontend/src/components/SeloOrigemCatalogo.tsx
//
// De quem é a linha do catálogo: do SISTEMA (compartilhada por todas as clínicas, só o
// ADMIN da plataforma altera) ou DESTA CLÍNICA (dela, inclusive para excluir).
//
// Sem o selo, o gestor veria duas linhas idênticas e a ação de editar aparecendo só em
// uma delas, sem nada que explicasse a diferença.

interface Props {
  /** `true` = linha global; `false` = da clínica; ausente = backend antigo, tratado como do sistema. */
  doSistema?: boolean;
  className?: string;
}

export default function SeloOrigemCatalogo({ doSistema, className = '' }: Props) {
  const daClinica = doSistema === false;
  return (
    <span
      title={daClinica
        ? 'Cadastrado por esta clínica — pode ser editado e excluído aqui.'
        : 'Catálogo do sistema — somente leitura. Cadastre um item próprio da clínica para usar valores diferentes.'}
      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${
        daClinica ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
      } ${className}`}
    >
      {daClinica ? 'Da clínica' : 'Sistema'}
    </span>
  );
}
