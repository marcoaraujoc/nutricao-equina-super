// src/components/ComboBuscavel.tsx
//
// Seletor em que se DIGITA para filtrar — o `<select>` que aceita teclado de verdade.
// Nasceu para os filtros da Agenda (2026-10-01, a pedido: "permitir digitar e
// preencher em todos os campos").
//
// Diferença para `DropdownSelect buscavel`: aquele trabalha com o NOME como valor
// (catálogos onde nome é único). Aqui o valor é um ID e o rótulo é só exibição —
// na Agenda o mesmo nome pode aparecer duas vezes (o profissional que é membro e
// prestador), e casar pelo nome escolheria o errado.
//
// Regras herdadas do `DropdownSelect` (e pelos mesmos motivos):
//   • abre SEMPRE para baixo (§6) — a altura é que encolhe;
//   • enquanto o texto for o rótulo do já escolhido, ele NÃO conta como busca —
//     senão reabrir a lista mostraria "nenhum resultado" para o próprio item;
//   • sair do campo COMPLETA o digitado quando ele designa UMA opção sem
//     ambiguidade; ambíguo ou desconhecido volta ao valor escolhido;
//   • campo APAGADO e abandonado = volta para a opção vazia (o "Todos"), quando ela
//     existe — é o jeito de limpar um filtro sem precisar abrir a lista.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface OpcaoCombo {
  value: string;
  label: string;
  /** Texto menor ao lado do rótulo (ex.: "prestador externo"). Também é buscável. */
  detalhe?: string;
  /**
   * Cabeçalho de seção. Opções CONSECUTIVAS com o mesmo grupo ficam sob um rótulo só
   * (ex.: "Equipe" / "Prestadores" na Agenda). A ordem é a de `opcoes` — quem chama
   * já entrega agrupado; o combo não reordena.
   */
  grupo?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  opcoes: OpcaoCombo[];
  /** Rótulo da opção VAZIA ('' = "Todos"). Sem ele, não há opção vazia na lista. */
  rotuloVazio?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Classes do <input> (borda, fundo, fonte). */
  className: string;
  /** Ícone à esquerda dentro do campo (o input ganha o recuo sozinho). */
  icone?: ReactNode;
  /** Texto da lista quando o filtro não acha nada. */
  vazioTexto?: string;
}

const semAcento = (v: string) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function ComboBuscavel({
  value, onChange, opcoes, rotuloVazio, placeholder, disabled, className, icone,
  vazioTexto = 'Nenhuma opção encontrada',
}: Props) {
  const [aberto, setAberto]   = useState(false);
  // `null` = não está digitando (o campo mostra o rótulo escolhido).
  const [busca, setBusca]     = useState<string | null>(null);
  const [destaque, setDestaque] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selecionada = opcoes.find(o => o.value === value) ?? null;
  const rotuloAtual = selecionada?.label ?? (value === '' ? (rotuloVazio ?? '') : '');

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setAberto(false); setBusca(null); }
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const termo = busca !== null && semAcento(busca) !== semAcento(rotuloAtual) ? semAcento(busca) : '';

  // A opção vazia entra como item da lista (só sem busca), para ser navegável por seta.
  const lista = useMemo<OpcaoCombo[]>(() => {
    const filtradas = termo
      ? opcoes.filter(o => semAcento(`${o.label} ${o.detalhe ?? ''}`).includes(termo))
      : opcoes;
    return rotuloVazio !== undefined && !termo
      ? [{ value: '', label: rotuloVazio }, ...filtradas]
      : filtradas;
  }, [opcoes, termo, rotuloVazio]);

  useEffect(() => { setDestaque(0); }, [termo, aberto]);

  const selecionar = (v: string) => { onChange(v); setAberto(false); setBusca(null); };

  /** O texto designa UMA opção? Exata > único prefixo > único que contém. */
  const resolverDigitado = (texto: string): OpcaoCombo | null => {
    const t = semAcento(texto);
    if (!t) return null;
    const exata = opcoes.filter(o => semAcento(o.label) === t);
    if (exata.length === 1) return exata[0];
    if (exata.length > 1) return null;
    const prefixo = opcoes.filter(o => semAcento(o.label).startsWith(t));
    if (prefixo.length === 1) return prefixo[0];
    const contem = opcoes.filter(o => semAcento(`${o.label} ${o.detalhe ?? ''}`).includes(t));
    return contem.length === 1 ? contem[0] : null;
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { setAberto(true); return; }
      setDestaque(i => Math.max(0, Math.min(lista.length - 1, e.key === 'ArrowDown' ? i + 1 : i - 1)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (aberto && lista[destaque]) selecionar(lista[destaque].value);
      else setAberto(true);
      return;
    }
    if (e.key === 'Escape') { setAberto(false); setBusca(null); }
  };

  const aoSair = () => {
    if (busca !== null) {
      if (!busca.trim() && rotuloVazio !== undefined) {
        if (value !== '') onChange('');
      } else {
        const achada = resolverDigitado(busca);
        if (achada && achada.value !== value) onChange(achada.value);
      }
    }
    setAberto(false);
    setBusca(null);
  };

  return (
    <div className="relative" ref={ref}>
      {icone && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">{icone}</span>}
      <input
        type="text"
        disabled={disabled}
        value={busca ?? rotuloAtual}
        // Abre também por CLICK: depois de escolher o input continua focado, e o
        // `focus` não dispara de novo — só com ele a lista não reabriria.
        onFocus={e => { setAberto(true); e.target.select(); }}
        onClick={() => setAberto(true)}
        onChange={e => { setBusca(e.target.value); setAberto(true); }}
        onKeyDown={aoTeclar}
        onBlur={aoSair}
        placeholder={placeholder ?? rotuloVazio ?? 'Digite para buscar'}
        autoComplete="off"
        className={`${className} ${icone ? 'pl-8' : ''} pr-7 disabled:opacity-50 disabled:cursor-not-allowed`}
      />
      <ChevronDown size={12}
        className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none transition-transform ${aberto ? 'rotate-180' : ''}`} />
      {aberto && !disabled && (
        // preventDefault no mousedown: sem ele o blur do input fecharia a lista
        // antes de o clique na opção registrar.
        <div onMouseDown={e => e.preventDefault()}
          className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
          {lista.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-3 py-2">{vazioTexto}</p>
          ) : lista.map((o, i) => (
            <Fragment key={`${o.value}-${i}`}>
            {o.grupo && o.grupo !== lista[i - 1]?.grupo && (
              <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 border-t border-gray-100 first:border-t-0">
                {o.grupo}
              </p>
            )}
            <button type="button" onClick={() => selecionar(o.value)}
              onMouseEnter={() => setDestaque(i)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                o.value === value ? 'bg-emerald-50 text-emerald-800 font-semibold'
                : i === destaque ? 'bg-gray-100 text-gray-900'
                : o.value === '' ? 'text-gray-500' : 'text-gray-700'
              }`}>
              {o.label}
              {o.detalhe && <span className="ml-1.5 text-[10px] text-gray-400 font-normal">{o.detalhe}</span>}
            </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
