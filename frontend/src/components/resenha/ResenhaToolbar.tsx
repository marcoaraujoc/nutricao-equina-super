// src/components/resenha/ResenhaToolbar.tsx

import { TIPOS_MARCACAO } from '../../types/resenhaGrafica';
import type { TipoMarcacaoResenha } from '../../types/resenhaGrafica';
import type { FerramentaDesenho } from './useResenhaCanvas';

interface ResenhaToolbarProps {
  tipoMarcacaoAtivo: TipoMarcacaoResenha;
  onTipoMarcacaoChange: (tipo: TipoMarcacaoResenha) => void;
  ferramenta: FerramentaDesenho;
  onFerramentaChange: (ferramenta: FerramentaDesenho) => void;
  onDesfazer: () => void;
  onLimpar: () => void;
  desabilitado?: boolean;
}

export function ResenhaToolbar({
  tipoMarcacaoAtivo,
  onTipoMarcacaoChange,
  ferramenta,
  onFerramentaChange,
  onDesfazer,
  onLimpar,
  desabilitado = false,
}: ResenhaToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {TIPOS_MARCACAO.map(({ tipo, label, cor }) => (
        <button
          key={tipo}
          type="button"
          disabled={desabilitado}
          onClick={() => onTipoMarcacaoChange(tipo)}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition-colors ${
            tipoMarcacaoAtivo === tipo
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
          {label}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={desabilitado}
          onClick={() => onFerramentaChange(ferramenta === 'caneta' ? 'borracha' : 'caneta')}
          className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${
            ferramenta === 'borracha'
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          {ferramenta === 'borracha' ? 'Borracha ativa' : 'Borracha'}
        </button>
        <button
          type="button"
          disabled={desabilitado}
          onClick={onDesfazer}
          className="rounded-full px-3 py-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Desfazer
        </button>
        <button
          type="button"
          disabled={desabilitado}
          onClick={onLimpar}
          className="rounded-full px-3 py-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Limpar vista
        </button>
      </div>
    </div>
  );
}
