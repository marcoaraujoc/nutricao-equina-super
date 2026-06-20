// frontend/src/components/ConfirmModal.tsx
// Modal de confirmação reutilizável — substitui confirm() nativo do browser.
import { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmModalProps {
  open:        boolean;
  titulo:      string;
  mensagem:    string | React.ReactNode;
  labelConfirmar?: string;
  labelCancelar?:  string;
  variante?:   'perigo' | 'aviso' | 'info';
  onConfirmar: () => void;
  onCancelar:  () => void;
}

import type { ReactNode } from 'react';

const VARIANTE = {
  perigo: {
    icon:       <Trash2 size={20} className="text-red-600" />,
    iconBg:     'bg-red-100',
    btnClass:   'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    btnLabel:   'Excluir',
  },
  aviso: {
    icon:       <AlertTriangle size={20} className="text-amber-600" />,
    iconBg:     'bg-amber-100',
    btnClass:   'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    btnLabel:   'Confirmar',
  },
  info: {
    icon:       <AlertTriangle size={20} className="text-teal-600" />,
    iconBg:     'bg-teal-100',
    btnClass:   'bg-teal-700 hover:bg-teal-800 focus:ring-teal-500',
    btnLabel:   'Confirmar',
  },
} satisfies Record<string, { icon: ReactNode; iconBg: string; btnClass: string; btnLabel: string }>;

export default function ConfirmModal({
  open,
  titulo,
  mensagem,
  labelConfirmar,
  labelCancelar = 'Cancelar',
  variante = 'perigo',
  onConfirmar,
  onCancelar,
}: ConfirmModalProps) {
  const btnConfRef = useRef<HTMLButtonElement>(null);
  const v = VARIANTE[variante];

  // Foca o botão cancelar por padrão (safe-default) e fecha com Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancelar]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-titulo"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancelar}
      />

      {/* Card */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-sm border border-gray-100 overflow-hidden">
        {/* Botão fechar */}
        <button
          onClick={onCancelar}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>

        <div className="p-6">
          {/* Ícone + título */}
          <div className="flex items-start gap-4 mb-4">
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${v.iconBg}`}>
              {v.icon}
            </div>
            <div className="pt-1.5">
              <h3 id="confirm-titulo" className="text-base font-bold text-gray-900 leading-snug">
                {titulo}
              </h3>
            </div>
          </div>

          {/* Mensagem */}
          <div className="text-sm text-gray-500 leading-relaxed ml-14">
            {mensagem}
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pb-6 pt-0">
          <button
            onClick={onCancelar}
            className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            {labelCancelar}
          </button>
          <button
            ref={btnConfRef}
            onClick={onConfirmar}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${v.btnClass}`}
          >
            {labelConfirmar ?? v.btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
