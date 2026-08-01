// src/components/BuscaGlobal.tsx
// Busca global do header — pacientes, atendimentos e agendamentos da EMPRESA ATIVA.
// O backend (GET /api/busca) resolve escopo, permissão por grupo e a `rota` de cada
// resultado; aqui só há UI, debounce e navegação.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2, PawPrint, Stethoscope, CalendarClock } from 'lucide-react';
import api from '../services/api';

// Abaixo de 2 caracteres o backend nem consulta — não vale disparar a requisição
const MIN_TERMO   = 2;
const DEBOUNCE_MS = 350;

interface ItemBusca {
  id:         number;
  titulo:     string;
  subtitulo:  string;
  status?:    string | null;
  photoUrl?:  string | null;
  rota:       string;
}

interface ResultadoBusca {
  pacientes:    ItemBusca[];
  atendimentos: ItemBusca[];
  agendamentos: ItemBusca[];
}

const VAZIO: ResultadoBusca = { pacientes: [], atendimentos: [], agendamentos: [] };

const GRUPOS: { chave: keyof ResultadoBusca; label: string; icone: React.ReactNode }[] = [
  { chave: 'pacientes',    label: 'Pacientes',    icone: <PawPrint     size={14} /> },
  { chave: 'atendimentos', label: 'Atendimentos', icone: <Stethoscope  size={14} /> },
  { chave: 'agendamentos', label: 'Agenda',       icone: <CalendarClock size={14} /> },
];

export default function BuscaGlobal() {
  const navigate = useNavigate();
  const [termo,     setTermo]     = useState('');
  const [resultado, setResultado] = useState<ResultadoBusca>(VAZIO);
  const [aberto,    setAberto]    = useState(false);
  const [buscando,  setBuscando]  = useState(false);
  const [destaque,  setDestaque]  = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // Lista achatada na ordem em que aparece — é sobre ela que as setas navegam
  const itens = useMemo(
    () => GRUPOS.flatMap((g) => resultado[g.chave]),
    [resultado],
  );

  const termoValido = termo.trim().length >= MIN_TERMO;

  // Busca com debounce. `cancelado` evita que uma resposta lenta de um termo antigo
  // sobrescreva o resultado de um termo mais novo.
  useEffect(() => {
    if (!termoValido) { setResultado(VAZIO); setBuscando(false); return; }

    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      api.get('/busca', { params: { q: termo.trim() } })
        .then((res) => {
          if (cancelado) return;
          if (!res.data) { setResultado(VAZIO); return; }  // GET 403 → data null
          setResultado(res.data.dados ?? VAZIO);
          setDestaque(0);
        })
        .catch(() => { if (!cancelado) setResultado(VAZIO); })
        .finally(() => { if (!cancelado) setBuscando(false); });
    }, DEBOUNCE_MS);

    return () => { cancelado = true; clearTimeout(timer); };
  }, [termo, termoValido]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  const limpar = () => {
    setTermo('');
    setResultado(VAZIO);
    setAberto(false);
    inputRef.current?.focus();
  };

  const abrirItem = (item: ItemBusca) => {
    setAberto(false);
    setTermo('');
    setResultado(VAZIO);
    navigate(item.rota);
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape')                        { setAberto(false); inputRef.current?.blur(); return; }
    if (!aberto || itens.length === 0)             return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((i) => (i + 1) % itens.length); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setDestaque((i) => (i - 1 + itens.length) % itens.length); }
    if (e.key === 'Enter')     { e.preventDefault(); const alvo = itens[destaque]; if (alvo) abrirItem(alvo); }
  };

  // Índice global do item dentro da lista achatada (para casar com `destaque`)
  let cursor = -1;

  const mostrarPainel = aberto && termoValido;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          name="busca-global"
          autoComplete="off"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={aoTeclar}
          placeholder="Buscar paciente, atendimento..."
          aria-label="Buscar paciente, atendimento"
          className="w-full h-10 pl-11 pr-10 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors"
        />
        {buscando ? (
          <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        ) : termo ? (
          <button
            type="button" onClick={limpar} aria-label="Limpar busca"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-lg"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {mostrarPainel && (
        <div className="absolute z-50 mt-2 w-full max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-lg py-2">
          {itens.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">
              {buscando ? 'Buscando...' : `Nada encontrado para "${termo.trim()}".`}
            </p>
          ) : (
            GRUPOS.map((grupo) => {
              const lista = resultado[grupo.chave];
              if (lista.length === 0) return null;
              return (
                <div key={grupo.chave} className="mb-1 last:mb-0">
                  <p className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                    {grupo.icone} {grupo.label}
                  </p>
                  {lista.map((item) => {
                    cursor += 1;
                    const indice = cursor;
                    return (
                      <button
                        key={`${grupo.chave}-${item.id}`}
                        type="button"
                        onMouseEnter={() => setDestaque(indice)}
                        onClick={() => abrirItem(item)}
                        className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors ${
                          indice === destaque ? 'bg-emerald-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        {item.photoUrl ? (
                          <img src={item.photoUrl} alt="" className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                            {grupo.icone}
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 truncate">{item.titulo}</span>
                          {item.subtitulo && (
                            <span className="block text-xs text-gray-500 truncate">{item.subtitulo}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
