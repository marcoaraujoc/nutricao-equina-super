// src/components/InlineError.tsx
// Bloco de erro inline reutilizável — substitui toast.error()/alert() para erros de
// ação/salvamento que devem ficar visíveis perto do que falhou, sem popup.
// Para erro de campo de formulário (mensagem curta abaixo do input), usar FieldError.
import { AlertCircle } from 'lucide-react';

interface InlineErrorProps {
  message?: string | null;
  className?: string;
}

export default function InlineError({ message, className = '' }: InlineErrorProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700 ${className}`}
    >
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
