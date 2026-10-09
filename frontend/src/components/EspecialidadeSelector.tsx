import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
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
  /**
   * 'checkbox' (grade, padrão), 'dropdown' (select que acrescenta UMA por vez + chips)
   * ou 'multi' (lista com busca e caixas de marcação que FICA ABERTA — marca várias de
   * uma só vez + chips).
   */
  variant?: 'checkbox' | 'dropdown' | 'multi';
  /**
   * Dropdown: troca a faixa de chips por UMA LINHA por especialidade selecionada,
   * deixando o chamador acrescentar colunas ao lado do chip (ex.: tempo de consulta).
   * O NOME vem resolvido daqui de dentro — este componente é quem carrega o catálogo,
   * então quem consome não precisa (nem deve) manter um segundo mapa id→nome.
   */
  renderSelecionado?: (args: { id: number; nome: string; chip: ReactNode; remover: () => void }) => ReactNode;
  /** Cabeçalho das colunas, exibido acima das linhas quando há algo selecionado. */
  cabecalhoSelecionados?: ReactNode;
}

/**
 * Seletor multi-especialidade do catálogo por espécie (fonte única — tb_especialidades).
 * Busca o catálogo uma vez e agrupa por espécie. Usado no Cadastro Pessoal, Novo
 * Fornecedor e Novo Membro (VET/FORNECEDOR).
 */
export default function EspecialidadeSelector({
  value, onChange, especieIds, disabled = false, emptyText, variant = 'checkbox',
  renderSelecionado, cabecalhoSelecionados,
}: Props) {
  const [todas,   setTodas]   = useState<Especialidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState(false);
  // variant 'multi': lista aberta + busca
  const [aberto,  setAberto]  = useState(false);
  const [busca,   setBusca]   = useState('');
  const raizRef = useRef<HTMLDivElement | null>(null);

  // Fecha ao clicar fora ou com Esc — a lista NÃO fecha a cada marcação, é o que
  // permite escolher várias de uma vez.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

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

  if (variant === 'multi') {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const termo = norm(busca.trim());
    const visiveis = grupos
      .map(g => ({ ...g, itens: termo ? g.itens.filter(e => norm(e.nome).includes(termo)) : g.itens }))
      .filter(g => g.itens.length > 0);
    const idsVisiveis = visiveis.flatMap(g => g.itens.map(e => e.id));
    const todosVisiveisMarcados = idsVisiveis.length > 0 && idsVisiveis.every(id => value.includes(id));
    const alternarVisiveis = () => {
      if (disabled) return;
      onChange(todosVisiveisMarcados
        ? value.filter(id => !idsVisiveis.includes(id))
        : [...value, ...idsVisiveis.filter(id => !value.includes(id))]);
    };
    const resumo = value.length === 0
      ? 'Selecionar especialidades…'
      : `${value.length} especialidade${value.length > 1 ? 's' : ''} selecionada${value.length > 1 ? 's' : ''}`;

    return (
      <div className="space-y-2" ref={raizRef}>
        <div className="relative">
          <button type="button" disabled={disabled} onClick={() => setAberto(a => !a)}
            className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-left bg-white focus:outline-none focus:border-emerald-500 transition-colors disabled:bg-gray-50">
            <span className={value.length ? 'text-gray-900' : 'text-gray-400'}>{resumo}</span>
            <ChevronDown size={16} className={`text-gray-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
          </button>

          {/* Abre SEMPRE para baixo (§6) */}
          {aberto && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-2 border-b border-gray-100">
                <div className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg focus-within:border-emerald-500">
                  <Search size={14} className="text-gray-400 flex-shrink-0" />
                  <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar especialidade…"
                    className="flex-1 text-sm outline-none bg-transparent" />
                </div>
              </div>

              {idsVisiveis.length > 0 && (
                <label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-700 border-b border-gray-100 cursor-pointer hover:bg-emerald-50">
                  <input type="checkbox" className="accent-emerald-600"
                    checked={todosVisiveisMarcados} onChange={alternarVisiveis} />
                  {termo ? 'Marcar todas as encontradas' : 'Marcar todas'} ({idsVisiveis.length})
                </label>
              )}

              <div className="max-h-64 overflow-y-auto py-1">
                {visiveis.length === 0 && (
                  <p className="px-3 py-3 text-xs text-gray-400">Nenhuma especialidade encontrada.</p>
                )}
                {visiveis.map(grupo => (
                  <div key={grupo.especieId}>
                    {grupos.length > 1 && (
                      <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {grupo.nome}
                      </p>
                    )}
                    {grupo.itens.map(esp => (
                      <label key={esp.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" className="accent-emerald-600 flex-shrink-0"
                          checked={value.includes(esp.id)} onChange={() => toggle(esp.id)} />
                        {esp.nome}
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex justify-end p-2 border-t border-gray-100">
                <button type="button" onClick={() => setAberto(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors">
                  Concluir
                </button>
              </div>
            </div>
          )}
        </div>

        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map(id => (
              <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                {nomeById.get(id) ?? `#${id}`}
                {!disabled && (
                  <button type="button" onClick={() => onChange(value.filter(v => v !== id))}
                    aria-label={`Remover ${nomeById.get(id) ?? id}`}
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
          renderSelecionado ? (
            <div className="space-y-1.5">
              {cabecalhoSelecionados}
              {value.map(id => {
                const nome = nomeById.get(id) ?? `#${id}`;
                const chip = (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    {nome}
                  </span>
                );
                return (
                  <div key={id}>
                    {renderSelecionado({
                      id, nome, chip,
                      remover: () => { if (!disabled) onChange(value.filter(v => v !== id)); },
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
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
          )
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
