import { Syringe } from 'lucide-react';
import { usePermissoes } from '../hooks/usePermissoes';
import PageContainer from '../components/PageContainer';

export default function SubModuloVacina() {
  const { podeExecutar, isSocio, loading: loadingPerms } = usePermissoes();

  if (!loadingPerms && !isSocio && !podeExecutar('atendimento.vacinas.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para visualizar vacinas.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-200">
      <Syringe size={40} className="mb-3" />
      <p className="text-sm font-medium text-gray-300">Vacinas</p>
      <p className="text-xs text-gray-300 mt-1">Em desenvolvimento</p>
    </div>
  );
}
