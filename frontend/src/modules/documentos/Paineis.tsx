// src/modules/documentos/Paineis.tsx
// Painel ESQUERDO (Biblioteca) e painel CENTRAL (Modelos) do layout desktop.

import { useMemo, useState } from 'react';
import {
  Search, Star, Clock, Share2, Trash2, Layers, Copy, Pencil, Eye, FileOutput,
  MoreHorizontal, RotateCcw, ChevronDown, ShieldCheck,
} from 'lucide-react';
import { CATEGORIAS, rotuloCategoria } from './catalogo';
import type { CategoriaId, ColecaoId, FiltroBiblioteca, Template } from './types';

// ─── Painel esquerdo: Biblioteca ─────────────────────────────────────────────

const COLECOES: { id: ColecaoId; rotulo: string; icone: React.ReactNode }[] = [
  { id: 'favoritos',     rotulo: 'Favoritos',     icone: <Star   size={14} /> },
  { id: 'recentes',      rotulo: 'Recentes',      icone: <Clock  size={14} /> },
  { id: 'compartilhados',rotulo: 'Compartilhados',icone: <Share2 size={14} /> },
  { id: 'lixeira',       rotulo: 'Lixeira',       icone: <Trash2 size={14} /> },
];

export function PainelBiblioteca({
  filtro, onFiltro, contarCategoria, contarColecao, termo, onTermo,
}: {
  filtro:          FiltroBiblioteca;
  onFiltro:        (f: FiltroBiblioteca) => void;
  contarCategoria: (id: CategoriaId | 'todos') => number;
  contarColecao:   (id: ColecaoId) => number;
  termo:           string;
  onTermo:         (t: string) => void;
}) {
  const ativo = (f: FiltroBiblioteca) =>
    f.tipo === filtro.tipo && f.id === filtro.id;

  const linha = (
    chave: string, rotulo: string, contador: number, f: FiltroBiblioteca, icone?: React.ReactNode,
  ) => (
    <button
      key={chave}
      onClick={() => onFiltro(f)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
        ativo(f) ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icone && <span className="flex-shrink-0 text-current opacity-70">{icone}</span>}
      <span className="flex-1 text-left truncate">{rotulo}</span>
      {/* Contador some quando é zero: um "0" ao lado de cada categoria vira ruído
          numa coluna de 15 linhas. */}
      {contador > 0 && (
        <span className={`text-[11px] tabular-nums ${ativo(f) ? 'text-emerald-600' : 'text-gray-400'}`}>
          {contador}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={termo}
            onChange={e => onTermo(e.target.value)}
            placeholder="Pesquisar modelos..."
            className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-transparent rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-emerald-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {linha('todos', 'Todos', contarCategoria('todos'), { tipo: 'categoria', id: 'todos' }, <Layers size={14} />)}

        <p className="px-3 pt-4 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Categorias</p>
        {CATEGORIAS.map(c =>
          linha(c.id, c.rotulo, contarCategoria(c.id), { tipo: 'categoria', id: c.id }))}

        <div className="pt-3 mt-3 border-t border-gray-100 space-y-0.5">
          {COLECOES.map(c =>
            linha(c.id, c.rotulo, contarColecao(c.id), { tipo: 'colecao', id: c.id }, c.icone))}
        </div>
      </div>
    </div>
  );
}

// ─── Painel central: Modelos ─────────────────────────────────────────────────

const CLS_ESPECIE: Record<Template['especie'], string> = {
  EQUINO: 'bg-amber-50  text-amber-700',
  BOVINO: 'bg-sky-50    text-sky-700',
  AMBOS:  'bg-gray-100  text-gray-600',
};

const ROTULO_ESPECIE: Record<Template['especie'], string> = {
  EQUINO: 'Equino', BOVINO: 'Bovino', AMBOS: 'Ambos',
};

function tempoRelativo(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Só VER não pode render botão de ação — ver CLAUDE.md, armadilha 28-d. */
export interface PermissoesModelos {
  podeEditar:  boolean;
  podeCriar:   boolean;
  podeEmitir:  boolean;
  podeExcluir: boolean;
}

export interface AcoesTemplate {
  onEditar:    (t: Template) => void;
  onVisualizar:(t: Template) => void;
  onDuplicar:  (t: Template) => void;
  onGerar:     (t: Template) => void;
  onExcluir:   (t: Template) => void;
  onRestaurar: (t: Template) => void;
  onFavorito:  (t: Template) => void;
}

function CardModelo({ t, ativo, acoes, perm }: {
  t: Template; ativo: boolean; acoes: AcoesTemplate; perm: PermissoesModelos;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div
      onClick={() => acoes.onEditar(t)}
      className={`group relative rounded-2xl p-4 cursor-pointer transition-all ${
        ativo ? 'bg-emerald-50/60 ring-1 ring-emerald-200' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{t.nome}</h3>
            {/* Modelo do sistema: o vet precisa saber, ANTES de clicar, que editar
                aqui não altera o original (o backend cria a cópia da clínica). */}
            {t.global && (
              <span
                title="Modelo oficial do CFMV — editar cria a versão da sua clínica"
                className="flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-full flex-shrink-0"
              >
                <ShieldCheck size={10} /> CFMV
              </span>
            )}
            {t.status === 'RASCUNHO' && !t.global && (
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                Rascunho
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.descricao || 'Sem descrição'}</p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); acoes.onFavorito(t); }}
          title={t.favorito ? 'Remover dos favoritos' : 'Favoritar'}
          aria-label={t.favorito ? 'Remover dos favoritos' : 'Favoritar'}
          className="p-1 flex-shrink-0 transition-colors"
        >
          <Star size={15} className={t.favorito ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-400'} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CLS_ESPECIE[t.especie]}`}>
          {ROTULO_ESPECIE[t.especie]}
        </span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {rotuloCategoria(t.categoria)}
        </span>
        {t.tags.slice(0, 2).map(tag => (
          <span key={tag} className="text-[10px] text-gray-400">#{tag}</span>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 mt-2.5">
        {t.autor} · {tempoRelativo(t.atualizadoEm)} · {t.usos} uso{t.usos === 1 ? '' : 's'}
      </p>

      {/* Ações aparecem no hover (desktop) e ficam sempre visíveis no toque —
          `group-hover` sozinho esconderia o menu inteiro em tablet. */}
      <div className="flex items-center gap-1 mt-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {t.excluido ? (
          perm.podeExcluir && (
          <button
            onClick={e => { e.stopPropagation(); acoes.onRestaurar(t); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            <RotateCcw size={12} /> Restaurar
          </button>
          )
        ) : (
          <>
            {perm.podeEmitir && (
              <button
                onClick={e => { e.stopPropagation(); acoes.onGerar(t); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <FileOutput size={12} /> Gerar
              </button>
            )}
            {perm.podeEditar && (
              <button onClick={e => { e.stopPropagation(); acoes.onEditar(t); }}
                title={t.global ? 'Personalizar para a sua clínica' : 'Editar'}
                aria-label={t.global ? 'Personalizar para a sua clínica' : 'Editar'}
                className="p-1.5 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                <Pencil size={13} />
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); acoes.onVisualizar(t); }}
              title="Visualizar" aria-label="Visualizar"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              <Eye size={13} />
            </button>

            <div className="relative ml-auto">
              <button onClick={e => { e.stopPropagation(); setMenu(m => !m); }}
                title="Mais ações" aria-label="Mais ações"
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <MoreHorizontal size={13} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setMenu(false); }} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1">
                    {perm.podeCriar && (
                      <button
                        onClick={e => { e.stopPropagation(); setMenu(false); acoes.onDuplicar(t); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                        <Copy size={12} /> Duplicar
                      </button>
                    )}
                    {/* Modelo do sistema não vai para a lixeira de ninguém: ele é o
                        catálogo normativo, compartilhado por todas as clínicas. O
                        backend recusa, e botão que só falha depois do clique é o
                        antipadrão da armadilha 28-d. */}
                    {perm.podeExcluir && !t.global && (
                      <button
                        onClick={e => { e.stopPropagation(); setMenu(false); acoes.onExcluir(t); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                        <Trash2 size={12} /> Excluir
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Quantos cards renderizar de cada vez (lazy). */
const PAGINA = 12;

export function PainelModelos({
  templates, ativoId, acoes, titulo, perm,
}: {
  templates: Template[];
  ativoId:   string | null;
  acoes:     AcoesTemplate;
  titulo:    string;
  perm:      PermissoesModelos;
}) {
  const [limite, setLimite] = useState(PAGINA);
  const visiveis = useMemo(() => templates.slice(0, limite), [templates, limite]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{titulo}</p>
        <span className="text-[11px] text-gray-400 tabular-nums">{templates.length}</span>
      </div>

      {templates.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <Layers size={30} className="text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">Nenhum modelo aqui</p>
          <p className="text-xs text-gray-300 mt-1">Crie um do zero ou peça um à IA.</p>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto px-2 pb-4 space-y-1"
          onScroll={e => {
            // Lazy: só amplia perto do fim. Evita montar 300 cards de uma vez sem
            // trazer um virtualizador (e uma dependência) para o projeto.
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
              setLimite(l => (l < templates.length ? l + PAGINA : l));
            }
          }}
        >
          {visiveis.map(t => (
            <CardModelo key={t.id} t={t} ativo={t.id === ativoId} acoes={acoes} perm={perm} />
          ))}
          {limite < templates.length && (
            <button onClick={() => setLimite(l => l + PAGINA)}
              className="w-full flex items-center justify-center gap-1 py-3 text-xs text-gray-400 hover:text-gray-600">
              <ChevronDown size={13} /> Carregar mais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
