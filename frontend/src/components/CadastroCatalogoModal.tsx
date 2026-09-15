// frontend/src/components/CadastroCatalogoModal.tsx
//
// CADASTRO RÁPIDO de MEDICAMENTO / VACINA no catálogo da empresa — fonte ÚNICA das
// quatro telas que oferecem "Cadastrar «X»": Prescrição, Vacina (atendimento),
// Entrada de Estoque da Farmácia e Estoque de Vacinas. Cópias divergiriam na primeira
// correção, e o que divergiria é o que nasce no catálogo — item sem via numa tela e
// com via em outra.
//
// 🔴 As opções de Forma / Unidade / Apresentação / Vias vêm do BANCO
// (`GET /medicamentos/opcoes-catalogo`), nunca de lista fixa no código: uma constante
// aqui divergiria do catálogo no primeiro item novo, e o cadastro passaria a criar
// variações do que já existe ("Frasco" × "Frasco ampola") sem ninguém notar. O
// backend entrega UMA opção por valor, ignorando caixa — 'kg' e 'Kg' convivem na base
// e apareciam como duas unidades diferentes.
//
// ⚠️ MULTI-TENANT: as opções saem do catálogo VISÍVEL da empresa (global + o próprio
// dela) e o item nasce PRIVADO dela (`lib/catalogoManual.js` grava o `empresaId`) — o
// catálogo GLOBAL, do ADMIN, nunca é tocado por aqui. O RLS de `tb_medicamentos`
// (ENABLE + FORCE) é o que garante isso no banco: leitura global+própria, escrita só
// própria.
// ⚠️ Nome que JÁ EXISTE no catálogo visível devolve a linha existente e NÃO reescreve
// os campos dela (pode ser global, e o RLS recusaria). Por isso as telas só oferecem
// o cadastro quando não há correspondência EXATA de nome.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ChevronDown, Loader2, Check, Plus } from 'lucide-react';
import api from '../services/api';
import ErroAcao from './ErroAcao';

export interface ItemCatalogoCriado {
  id: number;
  nome: string;
  formaFarmaceutica: string;
  unidade: string;
  apresentacao: string;
  fabricante: string | null;
  controlado: boolean;
  ativo: boolean;
  vias: { id: number; via: string }[];
  emEstoque: boolean;
  qtdEstoque: number | null;
  precoUnitarioBase: number | null;
  valorPorDose: number | null;
  ehProduto: boolean;
  fornecedores: unknown[];
}

interface OpcoesCatalogo {
  formas: string[];
  unidades: string[];
  apresentacoes: string[];
  vias: string[];
}

interface Props {
  aberto: boolean;
  tipo: 'medicamento' | 'vacina';
  /** Texto digitado na busca da tela — abre o formulário já com o nome. */
  nomeInicial?: string;
  /**
   * Paciente da tela, quando existe. É ele que dá a ESPÉCIE do item novo — e é a
   * espécie que o faz aparecer nas buscas depois. Sem paciente (telas de estoque),
   * o backend usa as espécies dos animais ativos da empresa.
   */
  animalId?: number | null;
  onCriado: (item: ItemCatalogoCriado) => void;
  onFechar: () => void;
}

const semAcento = (s: string) =>
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
function SeletorBusca({ label, valor, opcoes, placeholder, erro, onChange }: {
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
function SeletorVias({ valores, opcoes, erro, onChange }: {
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

export default function CadastroCatalogoModal({
  aberto, tipo, nomeInicial = '', animalId = null, onCriado, onFechar,
}: Props) {
  const ehVacina = tipo === 'vacina';
  const rotulo   = ehVacina ? 'Vacina' : 'Medicamento';

  const [nome, setNome]             = useState('');
  const [forma, setForma]           = useState('');
  const [unidade, setUnidade]       = useState('');
  const [apresentacao, setApres]    = useState('');
  const [fabricante, setFabricante] = useState('');
  const [vias, setVias]             = useState<string[]>([]);
  const [controlado, setControlado] = useState(false);

  const [opcoes, setOpcoes]         = useState<OpcoesCatalogo>({ formas: [], unidades: [], apresentacoes: [], vias: [] });
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando]     = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; campos?: string[] } | null>(null);

  // Reabrir com o preenchimento anterior é o caminho mais curto para cadastrar o item
  // errado — o formulário nasce zerado, só com o nome que a pessoa digitou na busca.
  useEffect(() => {
    if (!aberto) return;
    setNome(nomeInicial);
    setForma(''); setUnidade(''); setApres(''); setFabricante('');
    setVias([]); setControlado(false);
    setErro(null);
  }, [aberto, nomeInicial]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    api.get('/medicamentos/opcoes-catalogo', { params: { tipo } })
      .then(res => { if (vivo && res.data?.dados) setOpcoes(res.data.dados); })
      .catch(() => { if (vivo) setErro({ mensagem: 'Erro ao carregar as opções do catálogo.' }); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [aberto, tipo]);

  if (!aberto) return null;

  const faltando = [
    ...(nome.trim()      ? [] : ['nome']),
    ...(forma            ? [] : ['forma']),
    ...(unidade          ? [] : ['unidade']),
    ...(apresentacao     ? [] : ['apresentacao']),
    ...(vias.length > 0  ? [] : ['vias']),
  ];
  const temErro = (campo: string) => !!erro?.campos?.includes(campo);

  const salvar = async () => {
    if (faltando.length > 0) {
      const nomes: Record<string, string> = {
        nome: `Nome ${ehVacina ? 'da vacina' : 'do medicamento'}`, forma: 'Forma',
        unidade: 'Unidade', apresentacao: 'Apresentação', vias: 'Vias',
      };
      setErro({ mensagem: `Preencha: ${faltando.map(c => nomes[c]).join(', ')}.`, campos: faltando });
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await api.post('/medicamentos/garantir', {
        nome: nome.trim(), tipo, animalId: animalId ?? undefined,
        formaFarmaceutica: forma, unidade, apresentacao, vias,
        controlado: ehVacina ? false : controlado,
        ...(ehVacina ? { fabricante: fabricante.trim() } : {}),
      });
      const criado: ItemCatalogoCriado | undefined = res.data?.dados;
      if (!criado) throw new Error('sem dados');
      onCriado(criado);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setErro({ mensagem: e.response?.data?.error ?? `Erro ao cadastrar ${rotulo.toLowerCase()}.` });
    } finally {
      setSalvando(false);
    }
  };

  const inputCls = (campo: string) =>
    `w-full border ${temErro(campo) ? 'border-red-400' : 'border-gray-300'} rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500`;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <p className="font-bold text-sm text-white">Cadastrar {rotulo}</p>
          <button onClick={onFechar} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        {/* Um campo por linha, em largura cheia: os valores do catálogo são longos
            ("Pó Liofilizado para Suspensão Injetável", "Frasco gotejador") e, lado a
            lado, quebravam a caixa em duas linhas. */}
        <div className="p-5 space-y-3 overflow-y-auto">
          {carregando && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Carregando as opções do catálogo...
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Nome {ehVacina ? 'da Vacina' : 'do Medicamento'} <span className="text-red-500">*</span>
            </label>
            <input value={nome} onChange={e => setNome(e.target.value)} maxLength={90}
              placeholder={ehVacina ? 'Ex.: Vacina contra Influenza Equina' : 'Ex.: Dipirona 500 mg/mL'}
              className={inputCls('nome')} />
          </div>

          {/* Fabricante existe só na VACINA: é o campo que o Estoque de Vacinas usa
              para filtrar o catálogo, e o cadastro de vacinas (`/cadastro-vacina`) o
              trata como OPCIONAL — exigi-lo aqui impediria cadastrar a vacina cujo
              laboratório ainda não se conhece. */}
          {ehVacina && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Fabricante</label>
              <input value={fabricante} onChange={e => setFabricante(e.target.value)} maxLength={150}
                placeholder="Opcional — laboratório" className={inputCls('fabricante')} />
            </div>
          )}

          <SeletorBusca label="Forma" valor={forma} opcoes={opcoes.formas} erro={temErro('forma')}
            placeholder="Selecione a forma..." onChange={setForma} />

          <SeletorBusca label="Unidade" valor={unidade} opcoes={opcoes.unidades} erro={temErro('unidade')}
            placeholder="Selecione a unidade..." onChange={setUnidade} />

          <SeletorBusca label="Apresentação" valor={apresentacao} opcoes={opcoes.apresentacoes} erro={temErro('apresentacao')}
            placeholder="Selecione a apresentação..." onChange={setApres} />

          <SeletorVias valores={vias} opcoes={opcoes.vias} erro={temErro('vias')} onChange={setVias} />

          {/* Controlado é do MEDICAMENTO: o catálogo de vacinas (`/cadastro-vacina`)
              nunca expôs esse campo, e oferecê-lo aqui criaria um estado que nenhuma
              outra tela de vacina mostra nem permite corrigir. */}
          {!ehVacina && (
            <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
              <input type="checkbox" checked={controlado} onChange={e => setControlado(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
              <span className="text-sm text-gray-700">Medicamento controlado</span>
            </label>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-gray-100 flex-shrink-0">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onFechar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1.5">
              {salvando && <Loader2 size={13} className="animate-spin" />}
              Cadastrar
            </button>
          </div>
          {/* Erro da AÇÃO fica ABAIXO do botão que a disparou, dentro do modal (§6). */}
          <ErroAcao erro={erro} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
