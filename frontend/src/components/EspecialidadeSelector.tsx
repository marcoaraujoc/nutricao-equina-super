import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import api from '../services/api';

export interface Especialidade {
  id: number;
  nome: string;
  especieId: number;
  especie: { id: number; nome: string };
}

interface Props {
  /** IDs de especialidade selecionados. */
  value: number[];
  onChange: (ids: number[]) => void;
  /**
   * Filtra o catálogo pelas espécies informadas (ex.: as que a empresa atende, ou
   * as que o veterinário atende). Vazio/undefined = mostra todas as espécies.
   */
  especieIds?: number[] | null;
  disabled?: boolean;
  /** Mensagem quando o filtro de espécies não retorna nenhuma especialidade. */
  emptyText?: string;
  /** 'checkbox' (grade, padrão) ou 'dropdown' (select + chips, ideal para modais). */
  variant?: 'checkbox' | 'dropdown';
}

/**
 * Seletor multi-especialidade do catálogo por espécie (fonte única — tb_especialidades).
 * Busca o catálogo uma vez e agrupa por espécie. Usado no Cadastro Pessoal, Novo
 * Fornecedor e Novo Membro (VET/FORNECEDOR).
 */
export default function EspecialidadeSelector({
  value, onChange, especieIds, disabled = false, emptyText, variant = 'checkbox',
}: Props) {
  const [todas,   setTodas]   = useState<Especialidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState(false);

  const carregar = () => {
    setErro(false);
    setLoading(true);
    api.get('/especialidades')
      .then(res => {
        const lista = res.data?.dados ?? [];
        setTodas(Array.isArray(lista) ? lista : []);
      })
      .catch(() => setErro(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { carregar(); }, []);

  // Filtra por espécie (quando houver filtro) e agrupa por espécie para exibição.
  const grupos = useMemo(() => {
    const filtro = (especieIds ?? []).filter(n => Number.isInteger(n));
    const filtradas = filtro.length > 0
      ? todas.filter(e => filtro.includes(e.especieId))
      : todas;
    const map = new Map<number, { nome: string; itens: Especialidade[] }>();
    for (const e of filtradas) {
      if (!map.has(e.especieId)) map.set(e.especieId, { nome: e.especie?.nome ?? '', itens: [] });
      map.get(e.especieId)!.itens.push(e);
    }
    return [...map.entries()].map(([id, g]) => ({ especieId: id, ...g }));
  }, [todas, especieIds]);

  const toggle = (id: number) => {
    if (disabled) return;
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  // Rótulo dos chips (dropdown) — resolve o nome mesmo se o item ficou fora do filtro atual.
  const nomeById = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of todas) m.set(e.id, e.nome);
    return m;
  }, [todas]);

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Carregando especialidades...
      </p>
    );
  }
  if (erro) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-red-500">Erro ao carregar especialidades.</p>
        <button type="button" onClick={carregar} className="text-xs text-emerald-600 underline">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (grupos.length === 0) {
    return (
      <p className="text-xs text-amber-600">
        {emptyText ?? 'Nenhuma especialidade disponível para as espécies atendidas.'}
      </p>
    );
  }

  if (variant === 'dropdown') {
    const selectCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors disabled:bg-gray-50';
    return (
      <div className="space-y-2">
        <select
          value=""
          disabled={disabled}
          onChange={e => {
            const id = Number(e.target.value);
            if (id && !value.includes(id)) onChange([...value, id]);
          }}
          className={selectCls}
        >
          <option value="">Adicionar especialidade…</option>
          {grupos.map(grupo => (
            <optgroup key={grupo.especieId} label={grupos.length > 1 ? grupo.nome : ''}>
              {grupo.itens.filter(e => !value.includes(e.id)).map(e => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map(id => (
              <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                {nomeById.get(id) ?? `#${id}`}
                {!disabled && (
                  <button type="button" onClick={() => onChange(value.filter(v => v !== id))}
                    className="ml-0.5 hover:text-emerald-900 transition-colors">
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {grupos.map(grupo => (
        <div key={grupo.especieId}>
          {grupos.length > 1 && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              {grupo.nome}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {grupo.itens.map(esp => {
              const selecionada = value.includes(esp.id);
              return (
                <label key={esp.id}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border transition-colors select-none ${
                    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    selecionada
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300'
                  }`}>
                  <input type="checkbox" className="accent-emerald-600 flex-shrink-0"
                    checked={selecionada} disabled={disabled} onChange={() => toggle(esp.id)} />
                  <span className="text-sm font-medium">{esp.nome}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
