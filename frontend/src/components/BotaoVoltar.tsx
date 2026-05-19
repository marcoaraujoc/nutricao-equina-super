// src/components/BotaoVoltar.tsx
// Componente padronizado de voltar — usar em todas as telas exceto Dashboard

import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface BotaoVoltarProps {
  /** Rota específica. Se omitido, usa navigate(-1) — volta para a página anterior */
  para?: string;
  /** Label customizado. Padrão: "Voltar" */
  label?: string;
  className?: string;
}

export default function BotaoVoltar({ para, label = 'Voltar', className = '' }: BotaoVoltarProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => para ? navigate(para) : navigate(-1)}
      className={`flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium transition-colors ${className}`}
    >
      <ArrowLeft size={18} />
      <span className="text-sm">{label}</span>
    </button>
  );
}