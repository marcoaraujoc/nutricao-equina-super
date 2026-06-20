import { FileText } from 'lucide-react';

export function GateEvolucao() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <FileText size={32} className="mb-3 text-gray-200" />
      <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
      <p className="text-xs mt-1 text-center max-w-xs">
        Inicie uma evolução na aba Evolução para registrar prescrições, vacinas, exames e encaminhamentos neste atendimento.
      </p>
    </div>
  );
}
