// frontend/src/pages/Equipe.tsx
import { Users2 } from 'lucide-react';

export default function Equipe() {
  return (
    <div className="max-w-4xl mx-auto px-4 pt-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <Users2 size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minha Equipe</h1>
          <p className="text-sm text-gray-500">Gerencie veterinários, parceiros e estagiários</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center text-gray-300">
        <Users2 size={40} className="mx-auto mb-3" />
        <p className="text-sm">Em desenvolvimento</p>
      </div>
    </div>
  );
}