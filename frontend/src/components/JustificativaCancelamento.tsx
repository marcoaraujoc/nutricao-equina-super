// src/components/JustificativaCancelamento.tsx
// Célula/linha da coluna "Justificativa" nas listas de registros CANCELADOS/inativos
// do módulo Atendimento (Evolução, Prescrição, Vacina, Exames, Encaminhamento):
// mostra as primeiras palavras + "…" (truncamento por CSS, não corte fixo de
// caracteres — acompanha a largura real da coluna) e o texto INTEIRO no tooltip
// nativo (`title`) ao passar o mouse.
export default function JustificativaCancelamento({ texto, className = 'block max-w-[220px]' }: {
  texto:      string | null | undefined;
  className?: string;
}) {
  if (!texto?.trim()) return <span className="text-gray-300">—</span>;
  // `className` controla display + largura (block p/ célula de tabela, inline-block
  // p/ compor numa frase do card mobile) — nunca fixo aqui, senão as duas formas de
  // uso brigam por especificidade.
  return (
    <span title={texto} className={`truncate text-gray-500 cursor-help ${className}`}>
      {texto}
    </span>
  );
}
