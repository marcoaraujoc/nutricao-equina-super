// src/modules/documentos/store.ts
// Estado da Central de Documentos: biblioteca de templates + editor com undo/redo.
//
// PERSISTÊNCIA: localStorage, por enquanto. O módulo ainda não tem tabelas nem rotas
// no backend — ver a nota de entrega. Toda a leitura/gravação passa pelas duas funções
// `carregar`/`persistir` abaixo, então trocar por `api.get`/`api.post` é mexer em um
// lugar só, sem tocar em componente nenhum.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { criarBloco, novoId } from './catalogo';
import { TEMPLATES_INICIAIS } from './seeds';
import type { Bloco, DocumentoEmitido, Template, TipoBloco } from './types';

const CHAVE_TEMPLATES  = 's2vet_docs_templates';
const CHAVE_DOCUMENTOS = 's2vet_docs_emitidos';
const CHAVE_RECENTES   = 's2vet_docs_recentes';

// ─── Persistência ────────────────────────────────────────────────────────────

function carregar<T>(chave: string, padrao: T): T {
  try {
    const cru = localStorage.getItem(chave);
    return cru ? (JSON.parse(cru) as T) : padrao;
  } catch {
    return padrao;   // storage corrompido não pode derrubar a tela
  }
}

function persistir(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* cota estourada: o autosave falha em silêncio, a edição em memória continua */
  }
}

// ─── Biblioteca ──────────────────────────────────────────────────────────────

export interface UsoBiblioteca {
  templates:    Template[];
  documentos:   DocumentoEmitido[];
  recentes:     string[];
  salvar:       (t: Template) => void;
  criarVazio:   (nome?: string) => Template;
  duplicar:     (id: string) => Template | null;
  excluir:      (id: string) => void;
  restaurar:    (id: string) => void;
  alternarFavorito: (id: string) => void;
  registrarUso: (id: string) => void;
  emitir:       (t: Template) => DocumentoEmitido;
}

export function useBiblioteca(autor: string): UsoBiblioteca {
  const [templates,  setTemplates]  = useState<Template[]>(() => carregar(CHAVE_TEMPLATES, TEMPLATES_INICIAIS));
  const [documentos, setDocumentos] = useState<DocumentoEmitido[]>(() => carregar<DocumentoEmitido[]>(CHAVE_DOCUMENTOS, []));
  const [recentes,   setRecentes]   = useState<string[]>(() => carregar<string[]>(CHAVE_RECENTES, []));

  useEffect(() => { persistir(CHAVE_TEMPLATES,  templates);  }, [templates]);
  useEffect(() => { persistir(CHAVE_DOCUMENTOS, documentos); }, [documentos]);
  useEffect(() => { persistir(CHAVE_RECENTES,   recentes);   }, [recentes]);

  const salvar = useCallback((t: Template) => {
    setTemplates(prev => {
      const existe = prev.some(x => x.id === t.id);
      const atualizado = { ...t, atualizadoEm: new Date().toISOString() };
      return existe ? prev.map(x => (x.id === t.id ? atualizado : x)) : [atualizado, ...prev];
    });
  }, []);

  const criarVazio = useCallback((nome = 'Novo modelo'): Template => ({
    id:            `tpl-${novoId()}`,
    nome,
    descricao:     '',
    categoria:     'personalizados',
    especie:       'AMBOS',
    tags:          [],
    // Nasce com título + assinatura: são os dois blocos que TODO documento
    // veterinário tem, e partir do branco puro custa dois cliques a mais.
    blocos:        [criarBloco('titulo'), criarBloco('assinatura')],
    favorito:      false,
    compartilhado: false,
    excluido:      false,
    status:        'RASCUNHO',
    autor,
    usos:          0,
    criadoEm:      new Date().toISOString(),
    atualizadoEm:  new Date().toISOString(),
    versao:        1,
    versoes:       [],
  }), [autor]);

  const duplicar = useCallback((id: string): Template | null => {
    const base = templates.find(t => t.id === id);
    if (!base) return null;
    const copia: Template = {
      ...base,
      id:           `tpl-${novoId()}`,
      nome:         `${base.nome} (cópia)`,
      // A cópia começa limpa de histórico e de contadores: são fatos do ORIGINAL.
      usos:         0,
      favorito:     false,
      status:       'RASCUNHO',
      versao:       1,
      versoes:      [],
      autor,
      criadoEm:     new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      blocos:       base.blocos.map(b => ({ ...b, id: novoId() })),
    };
    setTemplates(prev => [copia, ...prev]);
    return copia;
  }, [templates, autor]);

  const excluir = useCallback((id: string) => {
    // Soft delete — vai para a Lixeira. Documento clínico não se apaga de verdade.
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, excluido: true } : t)));
  }, []);

  const restaurar = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, excluido: false } : t)));
  }, []);

  const alternarFavorito = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, favorito: !t.favorito } : t)));
  }, []);

  const registrarUso = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, usos: t.usos + 1 } : t)));
    // Recentes: sem repetição e no máximo 8 — a lista é atalho, não histórico.
    setRecentes(prev => [id, ...prev.filter(x => x !== id)].slice(0, 8));
  }, []);

  const emitir = useCallback((t: Template): DocumentoEmitido => {
    const doc: DocumentoEmitido = {
      id:           `doc-${novoId()}`,
      templateId:   t.id,
      templateNome: t.nome,
      animalNome:   'Thor',                 // resolvido pelo backend na emissão real
      clienteNome:  'Haras Boa Vista',
      emitidoEm:    new Date().toISOString(),
      emitidoPor:   autor,
      assinado:     false,
      // Snapshot: o documento guarda os blocos como estavam AGORA. Editar o template
      // depois não pode reescrever o que o cliente já recebeu.
      blocos:       JSON.parse(JSON.stringify(t.blocos)) as Bloco[],
    };
    setDocumentos(prev => [doc, ...prev]);
    registrarUso(t.id);
    return doc;
  }, [autor, registrarUso]);

  return {
    templates, documentos, recentes,
    salvar, criarVazio, duplicar, excluir, restaurar,
    alternarFavorito, registrarUso, emitir,
  };
}

// ─── Editor (undo / redo / autosave) ─────────────────────────────────────────

const LIMITE_HISTORICO = 60;

export interface UsoEditor {
  blocos:      Bloco[];
  selecionado: string | null;
  sujo:        boolean;
  podeDesfazer: boolean;
  podeRefazer:  boolean;
  selecionar:  (id: string | null) => void;
  adicionar:   (tipo: TipoBloco, indice?: number) => void;
  atualizar:   (id: string, muda: Partial<Bloco>) => void;
  remover:     (id: string) => void;
  duplicarBloco: (id: string) => void;
  mover:       (de: number, para: number) => void;
  desfazer:    () => void;
  refazer:     () => void;
  marcarSalvo: () => void;
  trocarBase:  (blocos: Bloco[]) => void;
}

/**
 * Histórico linear com um ponteiro. Editar depois de desfazer descarta o "futuro" —
 * é o comportamento que todo editor tem e que o usuário espera.
 */
export function useEditor(blocosIniciais: Bloco[], aoAutosave?: (b: Bloco[]) => void): UsoEditor {
  const [historico, setHistorico] = useState<Bloco[][]>([blocosIniciais]);
  const [indice,    setIndice]    = useState(0);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [sujo,      setSujo]      = useState(false);

  const blocos = historico[indice] ?? [];

  const empurrar = useCallback((novos: Bloco[]) => {
    setHistorico(prev => {
      const ate = prev.slice(0, indice + 1);
      const cheio = [...ate, novos];
      // Descarta o começo quando estoura o limite — histórico infinito só serve
      // para segurar memória de um documento que ninguém vai desfazer 60 vezes.
      return cheio.length > LIMITE_HISTORICO ? cheio.slice(cheio.length - LIMITE_HISTORICO) : cheio;
    });
    setIndice(i => Math.min(i + 1, LIMITE_HISTORICO - 1));
    setSujo(true);
  }, [indice]);

  const trocarBase = useCallback((novos: Bloco[]) => {
    // Troca de template: histórico recomeça, senão o "desfazer" traria de volta o
    // conteúdo do modelo ANTERIOR dentro do novo.
    setHistorico([novos]);
    setIndice(0);
    setSelecionado(null);
    setSujo(false);
  }, []);

  const adicionar = useCallback((tipo: TipoBloco, indiceAlvo?: number) => {
    const b = criarBloco(tipo);
    const copia = [...blocos];
    copia.splice(indiceAlvo ?? copia.length, 0, b);
    empurrar(copia);
    setSelecionado(b.id);
  }, [blocos, empurrar]);

  const atualizar = useCallback((id: string, muda: Partial<Bloco>) => {
    empurrar(blocos.map(b => (b.id === id ? { ...b, ...muda } : b)));
  }, [blocos, empurrar]);

  const remover = useCallback((id: string) => {
    empurrar(blocos.filter(b => b.id !== id));
    setSelecionado(s => (s === id ? null : s));
  }, [blocos, empurrar]);

  const duplicarBloco = useCallback((id: string) => {
    const i = blocos.findIndex(b => b.id === id);
    if (i < 0) return;
    const copia = [...blocos];
    const clone: Bloco = JSON.parse(JSON.stringify(blocos[i])) as Bloco;
    clone.id = novoId();
    copia.splice(i + 1, 0, clone);
    empurrar(copia);
    setSelecionado(clone.id);
  }, [blocos, empurrar]);

  const mover = useCallback((de: number, para: number) => {
    if (de === para || de < 0 || para < 0 || de >= blocos.length || para > blocos.length) return;
    const copia = [...blocos];
    const [item] = copia.splice(de, 1);
    copia.splice(de < para ? para - 1 : para, 0, item);
    empurrar(copia);
  }, [blocos, empurrar]);

  const desfazer = useCallback(() => { setIndice(i => Math.max(0, i - 1)); setSujo(true); }, []);
  const refazer  = useCallback(() => { setIndice(i => Math.min(historico.length - 1, i + 1)); setSujo(true); }, [historico.length]);

  // ── Autosave: 800ms parado depois da última tecla ──────────────────────────
  // Salvar a cada tecla escreveria dezenas de vezes por frase; salvar só no botão
  // perde trabalho quando o tablet dorme no meio do curral.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sujo || !aoAutosave) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => aoAutosave(blocos), 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [blocos, sujo, aoAutosave]);

  // ── Atalhos de teclado (desktop) ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); refazer(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desfazer, refazer]);

  return {
    blocos, selecionado, sujo,
    podeDesfazer: indice > 0,
    podeRefazer:  indice < historico.length - 1,
    selecionar: setSelecionado,
    adicionar, atualizar, remover, duplicarBloco, mover,
    desfazer, refazer,
    marcarSalvo: () => setSujo(false),
    trocarBase,
  };
}

/** Filtro de texto reaproveitado pela busca de modelos (desktop e mobile). */
export function useBusca(templates: Template[], termo: string): Template[] {
  return useMemo(() => {
    const q = termo.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.nome.toLowerCase().includes(q)
      || t.descricao.toLowerCase().includes(q)
      || t.tags.some(tag => tag.toLowerCase().includes(q)));
  }, [templates, termo]);
}
