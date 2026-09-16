// frontend/src/components/catalogo/SeletoresCatalogo.tsx
//
// 🔴 FONTE ÚNICA dos seletores do CATÁLOGO (forma farmacêutica, unidade,
// apresentação e vias). Extraídos de `CadastroCatalogoModal` em 2026-09-15, quando a
// tela de Produtos passou a cadastrar os MESMOS campos: duas implementações
// divergiriam na primeira correção, e o que divergiria é o que nasce no catálogo —
// item com via numa tela e sem via na outra.
//
// ⚠️ As OPÇÕES vêm sempre do BANCO (`GET /medicamentos/opcoes-catalogo`), nunca de
// lista fixa: uma constante no código divergiria do catálogo no primeiro item novo, e
// o cadastro passaria a criar variações do que já existe ("Frasco" × "Frasco ampola")
// sem ninguém notar.
//
// ⚠️ A LISTA É DESENHADA EM PORTAL, com `position: fixed` — ver `usePosicaoFlutuante`.
// Todo ancestral com overflow RECORTA filho posicionado por `absolute`, e os campos do
// fim do formulário (Apresentação, Vias) abriam cortados dentro da caixa que rola.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ChevronDown, Check, Plus } from 'lucide-react';

export interface OpcoesCatalogo {
  formas: string[];
  unidades: string[];
  apresentacoes: string[];
  vias: string[];
}

export const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface PosicaoFlutuante { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/**
 * 🔴 A LISTA É DESENHADA EM PORTAL, com `position: fixed`.
 *
 * O corpo do modal é `overflow-y-auto` (o formulário rola), e todo ancestral com
 * overflow RECORTA filho posicionado por `absolute`: a lista abria "para dentro da
 * caixa" e ficava cortada — os últimos campos, Apresentação e Vias, eram os mais
 * atingidos, por estarem no fim do rolagem. Sair para o `document.body` resolve o
 * recorte de uma vez, e é também o que permite ABRIR PARA CIMA quando não há espaço
 * embaixo.
 *
 * O reposicionamento escuta `scroll` em fase de CAPTURA: quem rola é o corpo do modal,
 * não a janela, e sem a captura o evento nunca chegaria aqui.
 */
function usePosicaoFlutuante(aberto: boolean) {
  const ancoraRef = useRef<HTMLDivElement>(null);
  const listaRef  = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PosicaoFlutuante | null>(null);

  useLayoutEffect(() => {
    if (!aberto) { setPos(null); return; }
    const calcular = () => {
      const el = ancoraRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const abaixo = window.innerHeight - r.bottom - 12;
      const acima  = r.top - 12;
      const paraCima = abaixo < 180 && acima > abaixo;
      setPos({
        left: r.left,
        width: r.width,
        ...(paraCima
          ? { bottom: window.innerHeight - r.top + 4 }
          : { top: r.bottom + 4 }),
        maxHeight: Math.max(120, Math.min(280, paraCima ? acima : abaixo)),
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

  return { ancoraRef, listaRef, pos };
}

/** Fecha ao clicar fora — considerando que a lista vive FORA da âncora (portal). */
function useFecharAoClicarFora(
  aberto: boolean,
  refs: React.RefObject<HTMLElement>[],
  fechar: () => void,
) {
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (refs.some(r => r.current?.contains(alvo))) return;
      fechar();
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
}

const estiloLista = (pos: PosicaoFlutuante | null): React.CSSProperties => ({
  position: 'fixed',
  left: pos?.left ?? 0,
  width: pos?.width ?? 0,
  ...(pos?.top !== undefined ? { top: pos.top } : {}),
  ...(pos?.bottom !== undefined ? { bottom: pos.bottom } : {}),
  visibility: pos ? 'visible' : 'hidden',
});

/** Seletor de valor ÚNICO com busca — as listas do catálogo passam de 500 itens. */
export function SeletorBusca({ label, valor, opcoes, placeholder, erro, onChange }: {
  label: string;
  valor: string;
  opcoes: string[];
  placeholder: string;
  erro: boolean;
  onChange: (v: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca]   = useState('');
  const { ancoraRef, listaRef, pos } = usePosicaoFlutuante(aberto);

  const fechar = () => { setAberto(false); setBusca(''); };
  useFecharAoClicarFora(aberto, [ancoraRef, listaRef], fechar);

  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    return t ? opcoes.filter(o => semAcento(o).includes(t)) : opcoes;
  }, [busca, opcoes]);

  const borda = erro ? 'border-red-400' : 'border-gray-300';

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="relative" ref={ancoraRef}>
        {!aberto ? (
          <button type="button" onClick={() => { setAberto(true); setBusca(''); }}
            className={`w-full flex items-center justify-between gap-2 border ${borda} rounded-xl px-3 py-2 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500`}>
            {/* `min-w-0` + `truncate`: valor longo fica numa LINHA SÓ, com reticências —
                sem isso a caixa crescia para duas linhas e desalinhava o formulário. */}
            <span className={`min-w-0 truncate ${valor ? 'text-gray-900' : 'text-gray-400'}`} title={valor || undefined}>
              {valor || placeholder}
            </span>
            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          </button>
        ) : (
          <>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
              className={`w-full pl-8 pr-3 border ${borda} rounded-xl py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500`} />
            {createPortal(
              <div ref={listaRef} style={estiloLista(pos)}
                className="z-[80] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                <ul className="overflow-y-auto" style={{ maxHeight: pos?.maxHeight ?? 240 }}>
                  {filtradas.length === 0 ? (
                    <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhuma opção encontrada.</li>
                  ) : filtradas.map(o => (
                    <li key={o}>
                      <button type="button"
                        onMouseDown={() => { onChange(o); fechar(); }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors ${o === valor ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-800'}`}>
                        {o}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>,
              document.body,
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Vias são N por item (`tb_medicamento_vias`) — seleção MÚLTIPLA, em chips. */
export function SeletorVias({ valores, opcoes, erro, onChange }: {
  valores: string[];
  opcoes: string[];
  erro: boolean;
  onChange: (v: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca]   = useState('');
  const { ancoraRef, listaRef, pos } = usePosicaoFlutuante(aberto);

  const fechar = () => { setAberto(false); setBusca(''); };
  useFecharAoClicarFora(aberto, [ancoraRef, listaRef], fechar);

  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    return t ? opcoes.filter(o => semAcento(o).includes(t)) : opcoes;
  }, [busca, opcoes]);

  const alternar = (via: string) =>
    onChange(valores.includes(via) ? valores.filter(v => v !== via) : [...valores, via]);

  const borda = erro ? 'border-red-400' : 'border-gray-300';

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        Vias <span className="text-red-500">*</span>
      </label>

      {valores.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {valores.map(v => (
            <span key={v} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-2 py-0.5 text-[11px] font-medium">
              {v}
              <button type="button" onClick={() => alternar(v)} className="text-emerald-500 hover:text-emerald-800">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={ancoraRef}>
        {!aberto ? (
          <button type="button" onClick={() => { setAberto(true); setBusca(''); }}
            className={`w-full flex items-center justify-between gap-2 border ${borda} rounded-xl px-3 py-2 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500`}>
            <span className="text-gray-400 inline-flex items-center gap-1 min-w-0 truncate"><Plus size={13} className="flex-shrink-0" /> Adicionar via...</span>
            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          </button>
        ) : (
          <>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar via..."
              className={`w-full pl-8 pr-3 border ${borda} rounded-xl py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500`} />
            {createPortal(
              <div ref={listaRef} style={estiloLista(pos)}
                className="z-[80] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                <ul className="overflow-y-auto" style={{ maxHeight: pos?.maxHeight ?? 240 }}>
                  {filtradas.length === 0 ? (
                    <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhuma via encontrada.</li>
                  ) : filtradas.map(o => {
                    const marcada = valores.includes(o);
                    return (
                      <li key={o}>
                        {/* Escolha por mousedown com preventDefault: o foco não sai do
                            input, então a lista não fecha antes de o clique registrar —
                            é o que permite marcar várias vias de uma vez. */}
                        <button type="button" onMouseDown={e => { e.preventDefault(); alternar(o); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors flex items-center gap-2 ${marcada ? 'text-emerald-700 font-semibold' : 'text-gray-800'}`}>
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${marcada ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                            {marcada && <Check size={10} className="text-white" />}
                          </span>
                          <span className="min-w-0 truncate">{o}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>,
              document.body,
            )}
          </>
        )}
      </div>
    </div>
  );
}

