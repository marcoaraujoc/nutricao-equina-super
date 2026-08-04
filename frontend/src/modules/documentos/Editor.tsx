// src/modules/documentos/Editor.tsx
// Painel DIREITO: toolbar, editor de blocos (drag and drop), preview A4,
// painel de propriedades e drawer de variáveis.

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Plus, Save, GitBranch, Copy, Share2, FileDown, Printer, History, Settings,
  Sparkles, Undo2, Redo2, X, Search, GripVertical, Eye, EyeOff, Trash2,
  LayoutTemplate, ZoomIn,
} from 'lucide-react';
import BlocoView from './BlocoView';
import { BLOCOS, GRUPOS_VARIAVEL, VARIAVEIS } from './catalogo';
import type { Alinhamento, Bloco, Borda, PesoFonte, Template, TipoBloco } from './types';
import type { UsoEditor } from './store';

// ─── Toolbar ─────────────────────────────────────────────────────────────────

export interface AcoesToolbar {
  onNovo:        () => void;
  onSalvar:      () => void;
  onSalvarVersao:() => void;
  onDuplicar:    () => void;
  onCompartilhar:() => void;
  onExportarPdf: () => void;
  onImprimir:    () => void;
  onHistorico:   () => void;
  onConfiguracoes: () => void;
  onCriarIA:     () => void;
}

export function Toolbar({ editor, acoes, salvando }: {
  editor:   UsoEditor;
  acoes:    AcoesToolbar;
  salvando: boolean;
}) {
  const botao = (
    rotulo: string, icone: React.ReactNode, onClick: () => void, desabilitado = false,
  ) => (
    <button
      onClick={onClick}
      disabled={desabilitado}
      title={rotulo}
      aria-label={rotulo}
      className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {icone}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 flex-shrink-0 overflow-x-auto">
      {botao('Novo', <Plus size={16} />, acoes.onNovo)}
      <span className="w-px h-5 bg-gray-100 mx-1" />
      {botao('Desfazer', <Undo2 size={16} />, editor.desfazer, !editor.podeDesfazer)}
      {botao('Refazer', <Redo2 size={16} />, editor.refazer, !editor.podeRefazer)}
      <span className="w-px h-5 bg-gray-100 mx-1" />
      {botao('Salvar', <Save size={16} />, acoes.onSalvar)}
      {botao('Salvar versão', <GitBranch size={16} />, acoes.onSalvarVersao)}
      {botao('Duplicar', <Copy size={16} />, acoes.onDuplicar)}
      <span className="w-px h-5 bg-gray-100 mx-1" />
      {botao('Compartilhar', <Share2 size={16} />, acoes.onCompartilhar)}
      {botao('Exportar PDF', <FileDown size={16} />, acoes.onExportarPdf)}
      {botao('Imprimir', <Printer size={16} />, acoes.onImprimir)}
      <span className="w-px h-5 bg-gray-100 mx-1" />
      {botao('Histórico', <History size={16} />, acoes.onHistorico)}
      {botao('Configurações', <Settings size={16} />, acoes.onConfiguracoes)}

      <button
        onClick={acoes.onCriarIA}
        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors flex-shrink-0"
      >
        <Sparkles size={13} /> Criar com IA
      </button>

      {/* Estado do autosave — discreto, mas é o que dá confiança para o vet sair da
          tela no meio do curral sem clicar em Salvar. */}
      <span className="ml-2 text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
        {salvando ? 'Salvando…' : editor.sujo ? 'Alterações não salvas' : 'Salvo'}
      </span>
    </div>
  );
}

// ─── Paleta de blocos ────────────────────────────────────────────────────────

const GRUPOS_BLOCO = ['Estrutura', 'Conteúdo', 'Clínico', 'Fecho'] as const;

export function PaletaBlocos({ onAdicionar }: { onAdicionar: (t: TipoBloco) => void }) {
  return (
    <div className="p-3 space-y-3">
      {GRUPOS_BLOCO.map(g => (
        <div key={g}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{g}</p>
          <div className="flex flex-wrap gap-1.5">
            {BLOCOS.filter(b => b.grupo === g).map(b => (
              <button
                key={b.tipo}
                draggable
                onDragStart={e => {
                  // "novo:<tipo>" x "mover:<índice>" no MESMO dataTransfer: a lista de
                  // blocos é alvo dos dois gestos (inserir da paleta e reordenar), e o
                  // prefixo é o que diz qual é qual no drop.
                  e.dataTransfer.setData('text/plain', `novo:${b.tipo}`);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAdicionar(b.tipo)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-gray-600 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 border border-transparent hover:border-emerald-200 transition-colors cursor-grab active:cursor-grabbing"
              >
                {b.rotulo}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Lista de blocos (editor) ────────────────────────────────────────────────

function resumoBloco(b: Bloco): string {
  const c = b.conteudo;
  return (c.texto || c.variavel || c.rotulo || c.fonteDados || (c.colunas ?? []).join(' · ') || '—')
    .toString().slice(0, 70);
}

export function ListaBlocos({ editor }: { editor: UsoEditor }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const arrastando = useRef<number | null>(null);

  const soltar = (indice: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setSobre(null);
    const dado = e.dataTransfer.getData('text/plain');
    if (dado.startsWith('novo:')) {
      editor.adicionar(dado.slice(5) as TipoBloco, indice);
    } else if (dado.startsWith('mover:')) {
      editor.mover(Number(dado.slice(6)), indice);
    }
    arrastando.current = null;
  };

  const zona = (indice: number) => (
    <div
      onDragOver={e => { e.preventDefault(); setSobre(indice); }}
      onDragLeave={() => setSobre(s => (s === indice ? null : s))}
      onDrop={soltar(indice)}
      className={`h-2 -my-1 rounded transition-colors ${sobre === indice ? 'bg-emerald-400' : 'bg-transparent'}`}
    />
  );

  if (editor.blocos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center"
        onDragOver={e => e.preventDefault()} onDrop={soltar(0)}>
        <LayoutTemplate size={28} className="text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">Arraste um bloco para começar</p>
      </div>
    );
  }

  return (
    <div className="px-3 pb-4">
      {editor.blocos.map((b, i) => (
        <div key={b.id}>
          {zona(i)}
          <div
            draggable
            onDragStart={e => {
              arrastando.current = i;
              e.dataTransfer.setData('text/plain', `mover:${i}`);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => editor.selecionar(b.id)}
            className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
              editor.selecionado === b.id ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-gray-50'
            } ${b.visivel ? '' : 'opacity-40'}`}
          >
            <GripVertical size={13} className="text-gray-300 flex-shrink-0 cursor-grab active:cursor-grabbing" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-700">
                {BLOCOS.find(x => x.tipo === b.tipo)?.rotulo ?? b.tipo}
              </p>
              <p className="text-[11px] text-gray-400 truncate">{resumoBloco(b)}</p>
            </div>
            <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={e => { e.stopPropagation(); editor.atualizar(b.id, { visivel: !b.visivel }); }}
                title={b.visivel ? 'Ocultar bloco' : 'Mostrar bloco'}
                aria-label={b.visivel ? 'Ocultar bloco' : 'Mostrar bloco'}
                className="p-1 text-gray-400 hover:text-gray-700 rounded">
                {b.visivel ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                onClick={e => { e.stopPropagation(); editor.duplicarBloco(b.id); }}
                title="Duplicar bloco" aria-label="Duplicar bloco"
                className="p-1 text-gray-400 hover:text-gray-700 rounded">
                <Copy size={12} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); editor.remover(b.id); }}
                title="Remover bloco" aria-label="Remover bloco"
                className="p-1 text-gray-400 hover:text-red-600 rounded">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      ))}
      {zona(editor.blocos.length)}
    </div>
  );
}

// ─── Painel de propriedades ──────────────────────────────────────────────────

const campoCls = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500';
const rotuloCls = 'block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1';

export function PainelPropriedades({ editor, onFechar, onAbrirVariaveis }: {
  editor: UsoEditor;
  onFechar: () => void;
  onAbrirVariaveis: () => void;
}) {
  const b = editor.blocos.find(x => x.id === editor.selecionado);
  if (!b) return null;

  const setEstilo = <K extends keyof Bloco['estilo']>(k: K, v: Bloco['estilo'][K]) =>
    editor.atualizar(b.id, { estilo: { ...b.estilo, [k]: v } });
  const setConteudo = <K extends keyof Bloco['conteudo']>(k: K, v: Bloco['conteudo'][K]) =>
    editor.atualizar(b.id, { conteudo: { ...b.conteudo, [k]: v } });

  const temTexto  = ['titulo', 'subtitulo', 'texto', 'rodape', 'observacoes'].includes(b.tipo);
  const temTabela = ['tabela'].includes(b.tipo);

  return (
    <aside className="w-72 flex-shrink-0 border-l border-gray-100 bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <p className="text-xs font-bold text-gray-700">
          {BLOCOS.find(x => x.tipo === b.tipo)?.rotulo ?? b.tipo}
        </p>
        <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fechar propriedades">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {temTexto && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={rotuloCls}>Texto</label>
              <button onClick={onAbrirVariaveis} className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">
                + variável
              </button>
            </div>
            <textarea
              value={b.conteudo.texto ?? ''}
              onChange={e => setConteudo('texto', e.target.value)}
              rows={4}
              className={`${campoCls} resize-none`}
            />
          </div>
        )}

        {b.tipo === 'campoAuto' && (
          <>
            <div>
              <label className={rotuloCls}>Rótulo</label>
              <input value={b.conteudo.rotulo ?? ''} onChange={e => setConteudo('rotulo', e.target.value)} className={campoCls} />
            </div>
            <div>
              <label className={rotuloCls}>Variável</label>
              <input value={b.conteudo.variavel ?? ''} onChange={e => setConteudo('variavel', e.target.value)} className={campoCls} />
            </div>
          </>
        )}

        {b.tipo === 'checklist' && (
          <div>
            <label className={rotuloCls}>Itens (um por linha)</label>
            <textarea
              value={(b.conteudo.itens ?? []).join('\n')}
              onChange={e => setConteudo('itens', e.target.value.split('\n'))}
              rows={5}
              className={`${campoCls} resize-none`}
            />
          </div>
        )}

        {temTabela && (
          <>
            <div>
              <label className={rotuloCls}>Colunas (separadas por ;)</label>
              <input
                value={(b.conteudo.colunas ?? []).join('; ')}
                onChange={e => setConteudo('colunas', e.target.value.split(';').map(s => s.trim()))}
                className={campoCls}
              />
            </div>
            <div>
              <label className={rotuloCls}>Linhas</label>
              <button
                onClick={() => setConteudo('linhas', [...(b.conteudo.linhas ?? []), (b.conteudo.colunas ?? []).map(() => '')])}
                className="w-full py-1.5 border border-dashed border-gray-200 rounded-lg text-xs text-gray-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
              >
                + linha ({(b.conteudo.linhas ?? []).length})
              </button>
            </div>
          </>
        )}

        {(b.tipo === 'assinatura') && (
          <>
            <div>
              <label className={rotuloCls}>Papel</label>
              <input value={b.conteudo.rotulo ?? ''} onChange={e => setConteudo('rotulo', e.target.value)} className={campoCls} />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!b.conteudo.mostrarCrmv}
                onChange={e => setConteudo('mostrarCrmv', e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600" />
              Exibir CRMV
            </label>
          </>
        )}

        {(b.tipo === 'imagem' || b.tipo === 'qrcode') && (
          <div>
            <label className={rotuloCls}>URL</label>
            <input value={b.conteudo.url ?? ''} onChange={e => setConteudo('url', e.target.value)} className={campoCls} />
          </div>
        )}

        <div className="pt-2 border-t border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotuloCls}>Tamanho</label>
              <input type="number" min={6} max={48} value={b.estilo.tamanho ?? ''}
                onChange={e => setEstilo('tamanho', e.target.value === '' ? undefined : Number(e.target.value))}
                className={campoCls} />
            </div>
            <div>
              <label className={rotuloCls}>Peso</label>
              <select value={b.estilo.peso ?? 'normal'} onChange={e => setEstilo('peso', e.target.value as PesoFonte)} className={campoCls}>
                <option value="normal">Normal</option>
                <option value="medium">Médio</option>
                <option value="semibold">Semibold</option>
                <option value="bold">Negrito</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotuloCls}>Cor</label>
              <input type="color" value={b.estilo.cor ?? '#111827'} onChange={e => setEstilo('cor', e.target.value)}
                className="w-full h-8 border border-gray-200 rounded-lg cursor-pointer" />
            </div>
            <div>
              <label className={rotuloCls}>Alinhamento</label>
              <select value={b.estilo.alinhamento ?? 'left'} onChange={e => setEstilo('alinhamento', e.target.value as Alinhamento)} className={campoCls}>
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
                <option value="justify">Justificado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotuloCls}>Espaço acima</label>
              <input type="number" min={0} max={120} value={b.estilo.espacamentoTopo ?? ''}
                onChange={e => setEstilo('espacamentoTopo', e.target.value === '' ? undefined : Number(e.target.value))} className={campoCls} />
            </div>
            <div>
              <label className={rotuloCls}>Espaço abaixo</label>
              <input type="number" min={0} max={120} value={b.estilo.espacamentoBase ?? ''}
                onChange={e => setEstilo('espacamentoBase', e.target.value === '' ? undefined : Number(e.target.value))} className={campoCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotuloCls}>Borda</label>
              <select value={b.estilo.borda ?? 'nenhuma'} onChange={e => setEstilo('borda', e.target.value as Borda)} className={campoCls}>
                <option value="nenhuma">Nenhuma</option>
                <option value="inferior">Inferior</option>
                <option value="completa">Completa</option>
              </select>
            </div>
            <div>
              <label className={rotuloCls}>Largura (%)</label>
              <input type="number" min={10} max={100} value={b.estilo.largura ?? ''}
                onChange={e => setEstilo('largura', e.target.value === '' ? undefined : Number(e.target.value))} className={campoCls} />
            </div>
          </div>

          <div>
            <label className={rotuloCls}>Altura (px)</label>
            <input type="number" min={0} max={600} value={b.estilo.altura ?? ''}
              onChange={e => setEstilo('altura', e.target.value === '' ? undefined : Number(e.target.value))} className={campoCls} />
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100 space-y-2">
          <div>
            <label className={rotuloCls}>Condição de exibição</label>
            <input
              value={b.condicao ?? ''}
              onChange={e => editor.atualizar(b.id, { condicao: e.target.value })}
              placeholder="{{animal.especie}} = Equino"
              className={campoCls}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Vazio = sempre aparece. Avaliado na emissão do documento.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={b.visivel}
              onChange={e => editor.atualizar(b.id, { visivel: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600" />
            Bloco visível
          </label>
        </div>
      </div>
    </aside>
  );
}

// ─── Drawer de variáveis ─────────────────────────────────────────────────────

export function DrawerVariaveis({ aberto, onFechar, onInserir }: {
  aberto: boolean;
  onFechar: () => void;
  onInserir: (chave: string) => void;
}) {
  const [termo, setTermo] = useState('');

  const porGrupo = useMemo(() => {
    const q = termo.trim().toLowerCase();
    const filtradas = q
      ? VARIAVEIS.filter(v => v.chave.toLowerCase().includes(q) || v.rotulo.toLowerCase().includes(q))
      : VARIAVEIS;
    return GRUPOS_VARIAVEL
      .map(g => ({ ...g, itens: filtradas.filter(v => v.grupo === g.id) }))
      .filter(g => g.itens.length > 0);
  }, [termo]);

  if (!aberto) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onFechar} />
      <aside className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">Variáveis</p>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fechar variáveis">
            <X size={16} />
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={termo} onChange={e => setTermo(e.target.value)} placeholder="Buscar variável..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-transparent rounded-xl text-sm focus:outline-none focus:bg-white focus:border-emerald-500" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
          {porGrupo.map(g => (
            <div key={g.id}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{g.rotulo}</p>
              <div className="space-y-0.5">
                {g.itens.map(v => (
                  <button
                    key={v.chave}
                    onClick={() => onInserir(`{{${v.chave}}}`)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-50 group transition-colors"
                  >
                    <p className="text-xs font-medium text-gray-700 group-hover:text-emerald-700">{v.rotulo}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{`{{${v.chave}}}`}</p>
                    <p className="text-[10px] text-gray-400 italic">ex: {v.exemplo}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {porGrupo.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">Nenhuma variável encontrada</p>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── Preview A4 ──────────────────────────────────────────────────────────────

const ZOOMS = [50, 75, 100, 125, 150] as const;

export function PreviewA4({ template, blocos, zoom, onZoom, refFolha }: {
  template: Template | null;
  blocos:   Bloco[];
  zoom:     number;
  onZoom:   (z: number) => void;
  refFolha: React.RefObject<HTMLDivElement>;
}) {
  // A4 em milímetros. O navegador converte mm→px na impressão, então a folha na
  // tela tem a MESMA proporção do papel — é o que evita a surpresa no PDF.
  const folha: CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '18mm 16mm',
    transform: `scale(${zoom / 100})`, transformOrigin: 'top center',
    background: '#fff', color: '#111827',
    fontFamily: 'Inter, system-ui, sans-serif',
  };

  return (
    <div className="flex flex-col h-full bg-gray-100">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <ZoomIn size={14} className="text-gray-400" />
        {ZOOMS.map(z => (
          <button
            key={z}
            onClick={() => onZoom(z)}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              zoom === z ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {z}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400 truncate">{template?.nome}</span>
      </div>

      <div className="flex-1 overflow-auto p-6 flex justify-center">
        <div ref={refFolha} style={folha} className="shadow-lg rounded-sm">
          {blocos.length === 0 ? (
            <p className="text-center text-gray-300 text-sm mt-20">Documento vazio</p>
          ) : (
            blocos.map(b => <BlocoView key={b.id} bloco={b} />)
          )}
        </div>
      </div>
    </div>
  );
}
