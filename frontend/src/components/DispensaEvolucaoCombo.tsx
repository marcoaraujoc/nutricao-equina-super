// src/components/DispensaEvolucaoCombo.tsx
//
// "PODE SER PRESCRITO SEM EVOLUÇÃO" — combo de Cadastro da Empresa › Funcionamento
// (2026-10-03). Escolhe as especialidades, os procedimentos e as classificações de
// medicamento que a Prescrição aceita SEM uma evolução aberta, da mesma forma que a
// vacina já não exige. Vazio = padrão: toda prescrição exige evolução.
//
// ⚠️ Só ESCOLHE. Quem decide é o backend (`lib/dispensaEvolucaoPrescricao.js`), que
// resolve no catálogo a especialidade do procedimento e a classificação do medicamento.
// 🔴 ABRE PARA CIMA — EXCEÇÃO CONSCIENTE à regra "sempre para baixo" do §6, a pedido
// (2026-10-03): o campo fica no FIM da aba Funcionamento, e para baixo a lista nascia
// fora da tela. A direção é FIXA (não decide pelo espaço — o que encolhe é a altura).
// 🔴 A LISTA É DESENHADA EM PORTAL (`document.body`), com `position: fixed` — mesmo
// padrão de `catalogo/SeletoresCatalogo`. Com `absolute` ela abria DENTRO do card do
// Cadastro da Empresa (preso a ele). O reposicionamento escuta `scroll` em CAPTURA:
// quem rola é o `<main>` do shell, não a janela.
// ⚠️ As opções vêm do BANCO: procedimentos (`/procedimentos/cadastro/lista`) e combos
// da clínica, e as classificações do catálogo de medicamentos SEM as vacinas
// (`/medicamentos/opcoes-catalogo`). Valor já gravado que saiu do catálogo continua
// aparecendo como chip — a lista é a escolha da clínica, não um espelho do catálogo.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import api from '../services/api';
import type { DispensaEvolucao } from '../hooks/useConfiguracaoOperacional';

type Grupo = keyof DispensaEvolucao;

const GRUPOS: { key: Grupo; titulo: string; chip: string }[] = [
  { key: 'especialidades', titulo: 'Especialidades (todos os procedimentos dela)', chip: 'bg-sky-50 border-sky-200 text-sky-800' },
  { key: 'procedimentos',  titulo: 'Procedimentos',                                 chip: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  { key: 'classificacoes', titulo: 'Tipos de medicamento (classificação do catálogo)', chip: 'bg-amber-50 border-amber-200 text-amber-800' },
];

const ROTULO_CHIP: Record<Grupo, string> = {
  especialidades: 'Especialidade',
  procedimentos:  'Procedimento',
  classificacoes: 'Medicamento',
};

// ⚠️ SEM teto de renderização: com corte, os procedimentos depois do 150º não
// apareciam e não havia como marcá-los. Um checkbox por linha aguenta o catálogo.

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

// 🔴 Dedup SEM acento e SEM caixa — é a MESMA comparação de `marcado`/`alternar` (e
// do backend). Com dedup só por texto exato, "Clínica Médica" e "Clinica Medica"
// viravam DUAS opções que marcam a mesma coisa: clicar na segunda desmarcava a
// primeira e a opção parecia não selecionável.
const ordenar = (lista: string[]) => {
  const porChave = new Map<string, string>();
  for (const bruto of lista) {
    const v = String(bruto ?? '').trim();
    const k = semAcento(v);
    if (v && !porChave.has(k)) porChave.set(k, v);
  }
  return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
};

/** Primeiro ancestral que ROLA de verdade (no shell é o `<main>`, não a janela). */
function contentorRolavel(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** O clique caiu na BARRA DE ROLAGEM do elemento (e não no conteúdo)? */
function cliqueNaBarra(e: MouseEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return el.scrollHeight > el.clientHeight && e.clientX > r.left + el.clientWidth;
}

interface Props {
  value:     DispensaEvolucao;
  onChange:  (v: DispensaEvolucao) => void;
  disabled?: boolean;
}

export default function DispensaEvolucaoCombo({ value, onChange, disabled }: Props) {
  const [aberto,     setAberto]     = useState(false);
  const [busca,      setBusca]      = useState('');
  const [carregando, setCarregando] = useState(true);
  const [opcoes, setOpcoes] = useState<DispensaEvolucao>({ especialidades: [], procedimentos: [], classificacoes: [] });
  // Posição da lista flutuante (fixed), ancorada ACIMA do campo (pela borda de baixo).
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number; alturaLista: number } | null>(null);
  const raizRef   = useRef<HTMLDivElement>(null);
  const ancoraRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const listaRef  = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!aberto) { setPos(null); return; }
    const calcular = () => {
      const r = ancoraRef.current?.getBoundingClientRect();
      if (!r) return;
      // Espaço ACIMA do campo, menos a caixa de busca (~56px). Piso de 160px: a
      // lista não vira uma fresta junto ao topo.
      const acima = r.top - 16 - 56;
      setPos({
        left: r.left,
        bottom: window.innerHeight - r.top + 4,
        width: r.width,
        alturaLista: Math.max(160, Math.min(360, acima)),
      });
    };
    calcular();
    window.addEventListener('resize', calcular);
    window.addEventListener('scroll', calcular, true);
    return () => {
      window.removeEventListener('resize', calcular);
      window.removeEventListener('scroll', calcular, true);
    };
  }, [aberto]);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.get('/procedimentos/cadastro/lista').catch(() => null),
      api.get('/procedimentos/cadastro/combos').catch(() => null),
      api.get('/medicamentos/opcoes-catalogo', { params: { tipo: 'medicamento' } }).catch(() => null),
    ]).then(([procs, combos, catalogo]) => {
      if (!vivo) return;
      const listaProc: { nome: string; especialidade: string | null }[] = procs?.data?.dados ?? [];
      const listaCombo: { nome: string; especialidade: string | null }[] = combos?.data?.dados ?? [];
      setOpcoes({
        especialidades: ordenar([...listaProc, ...listaCombo].map(p => p.especialidade ?? '')),
        procedimentos:  ordenar([...listaProc, ...listaCombo].map(p => p.nome)),
        classificacoes: ordenar(catalogo?.data?.dados?.classificacoes ?? []),
      });
    }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    // A lista vive FORA da raiz (portal) — o clique nela não é "fora".
    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (raizRef.current?.contains(alvo) || painelRef.current?.contains(alvo)) return;
      // Arrastar a barra de rolagem da PÁGINA não fecha a lista: ela acompanha a rolagem.
      if (cliqueNaBarra(e) || e.clientX >= document.documentElement.clientWidth) return;
      setAberto(false);
    };
    // 🔴 `click`, NÃO `mousedown`: mexer na BARRA DE ROLAGEM dispara mousedown (e o
    // combo sumia, levando a rolagem junto), mas não gera `click`.
    document.addEventListener('click', aoClicar);
    return () => document.removeEventListener('click', aoClicar);
  }, [aberto]);

  // 🔴 A ROLAGEM DA PÁGINA CONTINUA COM A LISTA ABERTA. A lista vive no
  // `document.body` (portal), e quem rola no shell é o `<main>` — o navegador não
  // encadeia a roda do mouse de um para o outro. Então: enquanto a LISTA ainda tem o
  // que rolar naquela direção, rola a lista; senão (no fim/topo dela, ou sobre a
  // caixa de busca) a roda vai para a página, e a lista acompanha o campo.
  const encaminharRoda = (e: React.WheelEvent) => {
    const lista = listaRef.current;
    if (lista && lista.contains(e.target as Node)) {
      const noTopo = lista.scrollTop <= 0;
      const noFim  = lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 1;
      if ((e.deltaY < 0 && !noTopo) || (e.deltaY > 0 && !noFim)) return;
    }
    contentorRolavel(ancoraRef.current)?.scrollBy({ top: e.deltaY });
  };

  const abrir = () => {
    if (disabled) return;
    // Abre PARA CIMA: sem espaço acima do campo (rolado até o topo), traz o campo para
    // o meio da tela antes — senão o começo da lista nasceria fora da tela.
    const r = ancoraRef.current?.getBoundingClientRect();
    if (!aberto && r && r.top < 300) {
      ancoraRef.current?.scrollIntoView({ block: 'center' });
    }
    setAberto(a => !a);
  };

  const marcado = (g: Grupo, v: string) =>
    value[g].some(x => semAcento(x) === semAcento(v));

  const alternar = (g: Grupo, v: string) => {
    const atual = value[g];
    onChange({
      ...value,
      [g]: marcado(g, v) ? atual.filter(x => semAcento(x) !== semAcento(v)) : [...atual, v],
    });
  };

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    const filtrar = (l: string[]) => (termo ? l.filter(v => semAcento(v).includes(termo)) : l);
    return {
      especialidades: filtrar(opcoes.especialidades),
      procedimentos:  filtrar(opcoes.procedimentos),
      classificacoes: filtrar(opcoes.classificacoes),
    };
  }, [busca, opcoes]);

  const total = value.especialidades.length + value.procedimentos.length + value.classificacoes.length;
  const resumo = total === 0
    ? 'Nenhum — toda prescrição exige evolução'
    : `${total} liberado${total > 1 ? 's' : ''} para prescrever sem evolução`;

  return (
    <div ref={raizRef} className="relative">
      <button ref={ancoraRef} type="button" onClick={abrir} disabled={disabled}
        aria-expanded={aberto}
        className="w-full h-[42px] flex items-center justify-between gap-2 border border-gray-300 rounded-2xl px-4 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed">
        <span className={total === 0 ? 'text-gray-500' : 'text-gray-900'}>{resumo}</span>
        <ChevronDown size={16} className={`flex-shrink-0 text-gray-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && createPortal(
        <div ref={painelRef} onWheel={encaminharRoda}
          style={{
            position: 'fixed', left: pos?.left ?? 0, bottom: pos?.bottom ?? 0, width: pos?.width ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[80] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar especialidade, procedimento ou tipo de medicamento…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
          <div ref={listaRef} className="overflow-y-auto overscroll-contain" style={{ maxHeight: pos?.alturaLista ?? 320 }}>
            {carregando ? (
              <p className="px-4 py-3 text-sm text-gray-500">Carregando opções…</p>
            ) : GRUPOS.map(g => {
              const lista = filtradas[g.key];
              return (
                <div key={g.key} className="py-1">
                  <p className="sticky top-0 bg-gray-50 px-4 py-1.5 text-xs font-bold text-gray-600">
                    {g.titulo}
                  </p>
                  {lista.length === 0 ? (
                    <p className="px-4 py-1.5 text-xs text-gray-400">
                      {busca ? 'Nada encontrado.' : 'Nenhuma opção no catálogo.'}
                    </p>
                  ) : lista.map(v => {
                    const on = marcado(g.key, v);
                    return (
                      <label key={v}
                        className={`flex items-center gap-2 px-4 py-1.5 text-sm cursor-pointer hover:bg-gray-50 ${on ? 'text-emerald-900' : 'text-gray-700'}`}>
                        <input type="checkbox" checked={on} onChange={() => alternar(g.key, v)}
                          className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0" />
                        <span className="truncate">{v}</span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {total > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {GRUPOS.flatMap(g => value[g.key].map(v => (
            <span key={`${g.key}:${v}`}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border text-xs ${g.chip}`}>
              <span className="opacity-70">{ROTULO_CHIP[g.key]}:</span> {v}
              {!disabled && (
                <button type="button" onClick={() => alternar(g.key, v)}
                  aria-label={`Remover ${v}`} title={`Remover ${v}`}
                  className="p-0.5 rounded-full hover:bg-black/5">
                  <X size={12} />
                </button>
              )}
            </span>
          )))}
        </div>
      )}
    </div>
  );
}
