// src/modules/documentos/Mobile.tsx
// Fluxo MOBILE — não é o desktop encolhido.
//
// Premissa: o vet está de pé no curral, com uma mão no celular e a outra no animal.
// Consequências de projeto, todas deliberadas:
//  • navegação por TELAS inteiras (início → preview → editor), não por painéis;
//  • ações críticas em botões grandes na METADE DE BAIXO, ao alcance do polegar;
//  • edição de bloco em BOTTOM SHEET (sobe do rodapé), nunca em modal centralizado;
//  • sem drag and drop: reordenar é ▲▼, que funciona com o dedo e com luva.

import { useState } from 'react';
import {
  Search, Star, Clock, Plus, ChevronLeft, FileOutput, Share2, Pencil, PenLine,
  X, ChevronUp, ChevronDown, Trash2, Sparkles, Eye,
} from 'lucide-react';
import BlocoView from './BlocoView';
import type { MarcaFolha } from './BlocoView';
import { BLOCOS } from './catalogo';
import type { ContextoVariaveis } from './catalogo';
import type { Bloco, Template, TipoBloco } from './types';
import type { UsoEditor } from './store';

type TelaMobile = 'inicio' | 'preview' | 'editor';

// ─── Bottom sheet ────────────────────────────────────────────────────────────

function BottomSheet({ aberto, titulo, onFechar, children }: {
  aberto: boolean; titulo: string; onFechar: () => void; children: React.ReactNode;
}) {
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onFechar}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full bg-white rounded-t-3xl max-h-[85vh] flex flex-col animate-[subir_.18s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* Alça: o gesto esperado num sheet é arrastar para baixo — a alça é o que
            comunica isso antes de a pessoa tentar. */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <span className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="flex items-center justify-between px-5 py-2 flex-shrink-0">
          <p className="font-bold text-gray-900">{titulo}</p>
          <button onClick={onFechar} className="p-2 -mr-2 text-gray-400" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-8">{children}</div>
      </div>
    </div>
  );
}

// ─── Tela inicial ────────────────────────────────────────────────────────────

function CardMobile({ t, onAbrir }: { t: Template; onAbrir: (t: Template) => void }) {
  return (
    <button
      onClick={() => onAbrir(t)}
      className="w-full text-left px-4 py-3.5 rounded-2xl bg-white active:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[15px] font-semibold text-gray-900 truncate">{t.nome}</p>
        {t.favorito && <Star size={14} className="fill-amber-400 text-amber-400 flex-shrink-0" />}
      </div>
      <p className="text-xs text-gray-400 mt-0.5 truncate">
        {t.especie === 'EQUINO' ? 'Equino' : t.especie === 'BOVINO' ? 'Bovino' : 'Equino e Bovino'}
        {' · '}{t.usos} uso{t.usos === 1 ? '' : 's'}
      </p>
    </button>
  );
}

// ─── Fluxo ───────────────────────────────────────────────────────────────────

export default function CentralMobile({
  templates, recentes, favoritos, selecionado, editor, contexto, marca, cabecalhoPaciente,
  onSelecionar, onGerar, onCompartilhar, onNovo, onCriarIA, onSalvar,
}: {
  templates:    Template[];
  recentes:     Template[];
  favoritos:    Template[];
  selecionado:  Template | null;
  editor:       UsoEditor;
  /** Variáveis do paciente resolvidas pelo backend; `null` = modo exemplo. */
  contexto?:    ContextoVariaveis | null;
  /** Logomarca da clínica e assinatura de quem emite. */
  marca?:       MarcaFolha | null;
  /** Seletor de paciente montado pela página — o mobile o exibe no topo da lista. */
  cabecalhoPaciente?: React.ReactNode;
  onSelecionar: (t: Template) => void;
  onGerar:      (t: Template) => void;
  onCompartilhar: (t: Template) => void;
  onNovo:       () => void;
  onCriarIA:    () => void;
  onSalvar:     () => void;
}) {
  const [tela,  setTela]  = useState<TelaMobile>('inicio');
  const [termo, setTermo] = useState('');
  const [sheetBloco,  setSheetBloco]  = useState<string | null>(null);
  const [sheetPaleta, setSheetPaleta] = useState(false);

  const filtrados = termo.trim()
    ? templates.filter(t => t.nome.toLowerCase().includes(termo.trim().toLowerCase()))
    : [];

  const abrir = (t: Template) => { onSelecionar(t); setTela('preview'); };

  // ── Início ───────────────────────────────────────────────────────────────
  if (tela === 'inicio') {
    return (
      <div className="relative min-h-full bg-gray-50 pb-28">
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Emita em segundos, direto do campo.</p>
        </div>

        {/* Paciente: é ele que governa todo o conteúdo da folha (e sem ele não se
            emite documento nenhum), então fica no topo, antes da busca.
            Sem invólucro: o `AnimalCard` que vem aqui já é um card, e embrulhá-lo
            num segundo daria card dentro de card. */}
        {cabecalhoPaciente && <div className="px-4">{cabecalhoPaciente}</div>}

        <div className="px-4 py-3 sticky top-0 bg-gray-50 z-10">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={termo}
              onChange={e => setTermo(e.target.value)}
              placeholder="Pesquisar modelo..."
              className="w-full pl-10 pr-4 py-3 bg-white border border-transparent rounded-2xl text-[15px] placeholder:text-gray-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="px-4 space-y-5">
          {termo.trim() ? (
            <section>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                Resultados ({filtrados.length})
              </p>
              <div className="space-y-1.5">
                {filtrados.map(t => <CardMobile key={t.id} t={t} onAbrir={abrir} />)}
                {filtrados.length === 0 && (
                  <p className="text-sm text-gray-400 py-6 text-center">Nenhum modelo encontrado</p>
                )}
              </div>
            </section>
          ) : (
            <>
              {recentes.length > 0 && (
                <section>
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    <Clock size={11} /> Recentes
                  </p>
                  <div className="space-y-1.5">
                    {recentes.map(t => <CardMobile key={t.id} t={t} onAbrir={abrir} />)}
                  </div>
                </section>
              )}

              <section>
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  <Star size={11} /> Favoritos
                </p>
                <div className="space-y-1.5">
                  {favoritos.map(t => <CardMobile key={t.id} t={t} onAbrir={abrir} />)}
                  {favoritos.length === 0 && (
                    <p className="text-sm text-gray-400 py-4">Nenhum favorito ainda.</p>
                  )}
                </div>
              </section>

              <section>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Todos os modelos</p>
                <div className="space-y-1.5">
                  {templates.map(t => <CardMobile key={t.id} t={t} onAbrir={abrir} />)}
                </div>
              </section>
            </>
          )}
        </div>

        {/* FAB — canto inferior direito, na zona natural do polegar. */}
        <div className="fixed bottom-6 right-4 flex flex-col items-end gap-2 z-30">
          <button
            onClick={onCriarIA}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white shadow-lg border border-gray-100 text-sm font-semibold text-gray-700"
          >
            <Sparkles size={15} /> IA
          </button>
          <button
            onClick={onNovo}
            className="flex items-center gap-2 px-5 py-4 rounded-2xl bg-emerald-600 text-white shadow-lg font-semibold"
          >
            <Plus size={18} /> Criar documento
          </button>
        </div>
      </div>
    );
  }

  // ── Preview ──────────────────────────────────────────────────────────────
  if (tela === 'preview') {
    return (
      <div className="min-h-full bg-gray-100 flex flex-col pb-40">
        <div className="sticky top-0 z-20 flex items-center gap-2 px-2 py-2 bg-white border-b border-gray-100">
          <button onClick={() => setTela('inicio')} className="p-2 text-gray-500" aria-label="Voltar">
            <ChevronLeft size={22} />
          </button>
          <p className="flex-1 font-semibold text-gray-900 truncate">{selecionado?.nome}</p>
        </div>

        <div className="flex-1 p-3">
          <div className="bg-white rounded-xl shadow-sm p-5 text-[11px]">
            {editor.blocos.map(b => <BlocoView key={b.id} bloco={b} contexto={contexto} marca={marca} />)}
          </div>
        </div>

        {/* Ações grandes, fixas embaixo: é o que o polegar alcança sem trocar a
            pegada do aparelho. */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 grid grid-cols-2 gap-2 z-30">
          <button
            onClick={() => selecionado && onGerar(selecionado)}
            className="col-span-2 flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-600 text-white font-semibold"
          >
            <FileOutput size={18} /> Gerar Documento
          </button>
          <button
            onClick={() => selecionado && onCompartilhar(selecionado)}
            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-gray-200 text-gray-700 font-semibold"
          >
            <Share2 size={16} /> Compartilhar
          </button>
          <button
            onClick={() => setTela('editor')}
            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-gray-200 text-gray-700 font-semibold"
          >
            <Pencil size={16} /> Editar
          </button>
          <button
            className="col-span-2 flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-gray-200 text-gray-700 font-semibold"
          >
            <PenLine size={16} /> Assinar
          </button>
        </div>
      </div>
    );
  }

  // ── Editor em tela cheia ─────────────────────────────────────────────────
  const bloco: Bloco | undefined = editor.blocos.find(b => b.id === sheetBloco);

  return (
    <div className="min-h-full bg-gray-50 flex flex-col pb-28">
      <div className="sticky top-0 z-20 flex items-center gap-2 px-2 py-2 bg-white border-b border-gray-100">
        <button onClick={() => setTela('preview')} className="p-2 text-gray-500" aria-label="Voltar">
          <ChevronLeft size={22} />
        </button>
        <p className="flex-1 font-semibold text-gray-900 truncate">{selecionado?.nome}</p>
        <button onClick={() => setTela('preview')} className="p-2 text-gray-500" aria-label="Visualizar">
          <Eye size={19} />
        </button>
        <button onClick={onSalvar} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold">
          Salvar
        </button>
      </div>

      <div className="flex-1 p-3 space-y-1.5">
        {editor.blocos.map((b, i) => (
          <div key={b.id} className="flex items-center gap-2 bg-white rounded-2xl px-3 py-3">
            <button onClick={() => setSheetBloco(b.id)} className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-gray-800">
                {BLOCOS.find(x => x.tipo === b.tipo)?.rotulo ?? b.tipo}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {b.conteudo.texto || b.conteudo.variavel || b.conteudo.rotulo || '—'}
              </p>
            </button>
            {/* ▲▼ em vez de arrastar: drag and drop com o dedo, num item de 44px,
                erra mais do que acerta — e o vet está de luva. */}
            <button onClick={() => editor.mover(i, i - 1)} disabled={i === 0}
              className="p-2 text-gray-400 disabled:opacity-25" aria-label="Mover para cima">
              <ChevronUp size={18} />
            </button>
            <button onClick={() => editor.mover(i, i + 2)} disabled={i === editor.blocos.length - 1}
              className="p-2 text-gray-400 disabled:opacity-25" aria-label="Mover para baixo">
              <ChevronDown size={18} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setSheetPaleta(true)}
        className="fixed bottom-6 right-4 flex items-center gap-2 px-5 py-4 rounded-2xl bg-emerald-600 text-white shadow-lg font-semibold z-30"
      >
        <Plus size={18} /> Bloco
      </button>

      {/* Sheet: adicionar bloco */}
      <BottomSheet aberto={sheetPaleta} titulo="Adicionar bloco" onFechar={() => setSheetPaleta(false)}>
        <div className="grid grid-cols-2 gap-2 pt-2">
          {BLOCOS.map(b => (
            <button
              key={b.tipo}
              onClick={() => { editor.adicionar(b.tipo as TipoBloco); setSheetPaleta(false); }}
              className="py-3.5 rounded-2xl bg-gray-50 text-sm font-medium text-gray-700 active:bg-emerald-50"
            >
              {b.rotulo}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Sheet: editar bloco */}
      <BottomSheet
        aberto={!!bloco}
        titulo={bloco ? (BLOCOS.find(x => x.tipo === bloco.tipo)?.rotulo ?? bloco.tipo) : ''}
        onFechar={() => setSheetBloco(null)}
      >
        {bloco && (
          <div className="space-y-4 pt-2">
            {['titulo', 'subtitulo', 'texto', 'rodape', 'observacoes'].includes(bloco.tipo) && (
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Texto</label>
                <textarea
                  value={bloco.conteudo.texto ?? ''}
                  onChange={e => editor.atualizar(bloco.id, { conteudo: { ...bloco.conteudo, texto: e.target.value } })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-2xl px-3 py-3 text-[15px] focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            )}

            {bloco.tipo === 'campoAuto' && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Rótulo</label>
                  <input value={bloco.conteudo.rotulo ?? ''}
                    onChange={e => editor.atualizar(bloco.id, { conteudo: { ...bloco.conteudo, rotulo: e.target.value } })}
                    className="w-full border border-gray-200 rounded-2xl px-3 py-3 text-[15px] focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Variável</label>
                  <input value={bloco.conteudo.variavel ?? ''}
                    onChange={e => editor.atualizar(bloco.id, { conteudo: { ...bloco.conteudo, variavel: e.target.value } })}
                    className="w-full border border-gray-200 rounded-2xl px-3 py-3 text-[15px] font-mono focus:outline-none focus:border-emerald-500" />
                </div>
              </>
            )}

            <div className="grid grid-cols-3 gap-2">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a}
                  onClick={() => editor.atualizar(bloco.id, { estilo: { ...bloco.estilo, alinhamento: a } })}
                  className={`py-3 rounded-2xl text-sm font-medium ${
                    (bloco.estilo.alinhamento ?? 'left') === a ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-600'
                  }`}>
                  {a === 'left' ? 'Esquerda' : a === 'center' ? 'Centro' : 'Direita'}
                </button>
              ))}
            </div>

            <button
              onClick={() => { editor.remover(bloco.id); setSheetBloco(null); }}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-200 text-red-600 font-semibold"
            >
              <Trash2 size={16} /> Remover bloco
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
