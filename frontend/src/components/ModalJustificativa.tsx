// src/components/ModalJustificativa.tsx
// Modal padrão de confirmação de exclusão/cancelamento COM justificativa obrigatória.
// Toda ação destrutiva da aplicação deve usar este modal — o motivo é exigido pelo
// backend e registrado na Auditoria (módulo Geral).

import { useState, useEffect } from 'react';
import ErroAcao, { type ErroAcaoDados } from './ErroAcao';
import { AlertTriangle, X } from 'lucide-react';

interface ModalJustificativaProps {
  aberto: boolean;
  titulo: string;              // ex: "Excluir exame?"
  descricao?: string;          // ex: nome/identificação do registro
  acaoLabel?: string;          // rótulo do botão de confirmação (default "Excluir")
  placeholder?: string;
  processando?: boolean;
  /** Erro da própria ação (ex.: 400 do backend). Renderizado AQUI, junto ao botão —
      no topo da página ficaria atrás deste overlay e o usuário não veria. */
  erro?: ErroAcaoDados | string | null;
  onConfirmar: (motivo: string) => void | Promise<void>;
  onFechar: () => void;
}

export default function ModalJustificativa({
  aberto,
  titulo,
  descricao,
  acaoLabel = 'Excluir',
  placeholder = 'Descreva o motivo (obrigatório)...',
  processando = false,
  erro = null,
  onConfirmar,
  onFechar,
}: ModalJustificativaProps) {
  const [motivo, setMotivo] = useState('');

  // Limpa o campo sempre que o modal abre
  useEffect(() => { if (aberto) setMotivo(''); }, [aberto]);

  if (!aberto) return null;

  const motivoValido = motivo.trim().length >= 3;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[88vh] overflow-hidden">
        <div className="bg-red-600 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-white/90" />
            <p className="font-bold text-sm text-white">{titulo}</p>
          </div>
          <button onClick={onFechar} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {descricao && <p className="text-sm text-gray-700">{descricao}</p>}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Justificativa <span className="text-red-500">*</span>
            </label>
            <textarea
              autoFocus
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={placeholder}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              A justificativa é obrigatória e fica registrada na auditoria.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex-shrink-0">
          <ErroAcao
            erro={typeof erro === 'string' ? { mensagem: erro } : (erro ?? null)}
            className="mb-3"
          />
          <div className="flex gap-2">
          <button
            onClick={() => onConfirmar(motivo.trim())}
            disabled={processando || !motivoValido}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
            {processando ? 'Processando...' : acaoLabel}
          </button>
          <button onClick={onFechar}
            className="px-4 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
            Cancelar
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
