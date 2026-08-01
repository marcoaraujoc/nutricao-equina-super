// src/components/AppFooter.tsx
// Rodapé global do shell — identifica a clínica assinante (logomarca da empresa do
// contexto ativo) e o fornecedor do sistema.

import { useEmpresa } from '../contexts/EmpresaContext';
import BrandS2Vet from './BrandS2Vet';

export default function AppFooter() {
  const { marca } = useEmpresa();
  const nome = marca.empresaNome?.trim();

  return (
    <footer
      className="flex-shrink-0 h-12 bg-white border-t border-gray-200 flex items-center justify-between gap-3 px-4 md:px-6"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Empresa assinante */}
      <div className="flex items-center gap-2 min-w-0">
        {marca.logoUrl ? (
          <img src={marca.logoUrl} alt={nome ?? 'Logomarca da empresa'} className="h-6 max-w-[6rem] object-contain flex-shrink-0" />
        ) : nome ? (
          <span className="w-6 h-6 bg-emerald-600 text-white rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0">
            {nome.charAt(0).toUpperCase()}
          </span>
        ) : null}
        <p className="text-xs text-gray-500 truncate">
          {nome ? <span className="font-medium text-gray-700">{nome}</span> : null}
          {nome ? ' · ' : ''}assinante S2Vet
        </p>
      </div>

      {/* Fornecedor do sistema — só a arte, sem rótulo escrito ao lado */}
      <div className="flex items-center flex-shrink-0">
        <BrandS2Vet size="sm" />
      </div>
    </footer>
  );
}
