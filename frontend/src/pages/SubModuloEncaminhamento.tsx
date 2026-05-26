import { Share2 } from 'lucide-react';

export default function SubModuloEncaminhamento() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-200">
      <Share2 size={40} className="mb-3" />
      <p className="text-sm font-medium text-gray-300">Encaminhamentos</p>
      <p className="text-xs text-gray-300 mt-1">Em desenvolvimento</p>
    </div>
  );
}