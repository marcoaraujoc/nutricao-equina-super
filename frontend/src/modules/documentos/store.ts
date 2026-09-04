// src/modules/documentos/store.ts
// Estado da Central de Documentos: biblioteca de modelos (do BACKEND) + editor com
// undo/redo.
//
// 🔴 A PERSISTÊNCIA SAIU DO `localStorage` (2026-08-26). Antes o módulo guardava os
// modelos em `s2vet_docs_templates` e os emitidos em `s2vet_docs_emitidos`: não
// sobrevivia a trocar de navegador, não era compartilhado com a equipe e não era
// multi-tenant. Agora tudo passa por `./api`, que fala com as rotas sob RLS.
//
// O que CONTINUA no `localStorage` é só a lista de RECENTES: é conveniência de quem
// está usando aquele dispositivo, não dado da clínica.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { criarBloco, novoId } from './catalogo';
import * as apiDocs from './api';
import type { Bloco, DocumentoEmitido, Template, TipoBloco } from './types';
import type { PreenchimentoListas } from './listas';

const CHAVE_RECENTES = 's2vet_docs_recentes';

function carregarRecentes(): string[] {
  try {
    const cru = localStorage.getItem(CHAVE_RECENTES);
    return cru ? (JSON.parse(cru) as string[]) : [];
  } catch {
    return [];   // storage corrompido não pode derrubar a tela
  }
}

function persistirRecentes(valor: string[]): void {
  try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify(valor)); }
  catch { /* cota estourada: perder os recentes não custa trabalho a ninguém */ }
}

// ─── Biblioteca ──────────────────────────────────────────────────────────────

export interface UsoBiblioteca {
  templates:   Template[];
  documentos:  DocumentoEmitido[];
  recentes:    string[];
  carregando:  boolean;
  erro:        string | null;
  limparErro:  () => void;
  recarregar:  () => Promise<void>;
  /** Grava e devolve o modelo salvo — que pode ter OUTRO id, ver `salvar`. */
  salvar:      (t: Template, opcoes?: { novaVersao?: boolean; nota?: string }) => Promise<Template | null>;
  criar:       (nome?: string) => Promise<Template | null>;
  duplicar:    (id: string) => Promise<Template | null>;
  excluir:     (id: string, motivo: string) => Promise<boolean>;
  restaurar:   (id: string) => Promise<void>;
  alternarFavorito: (id: string) => Promise<Template | null>;
  registrarUso: (id: string) => void;
  carregarEmitidos: (animalId?: number | null) => Promise<void>;
  emitir:      (t: Template, blocos: Bloco[], animalId: number, evolucaoId?: number | null, preenchimento?: Record<string, string>, listas?: PreenchimentoListas) => Promise<DocumentoEmitido | null>;
}

/**
 * Blocos com que um modelo novo nasce. Título + assinatura são os dois que TODO
 * documento veterinário tem, e partir do branco puro custa dois cliques a mais.
 */
function blocosIniciais(): Bloco[] {
  return [criarBloco('titulo'), criarBloco('assinatura')];
}

export function useBiblioteca(): UsoBiblioteca {
  const [templates,  setTemplates]  = useState<Template[]>([]);
  const [documentos, setDocumentos] = useState<DocumentoEmitido[]>([]);
  const [recentes,   setRecentes]   = useState<string[]>(carregarRecentes);
  const [carregando, setCarregando] = useState(true);
  const [erro,       setErro]       = useState<string | null>(null);

  useEffect(() => { persistirRecentes(recentes); }, [recentes]);

  const limparErro = useCallback(() => setErro(null), []);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      // Inclui a lixeira: a coleção "Lixeira" do painel esquerdo é montada no
      // cliente a partir desta mesma lista, e uma segunda chamada só para ela pagaria
      // ida e volta para mostrar, quase sempre, zero item.
      setTemplates(await apiDocs.listarTemplates(true));
    } catch {
      setErro('Não foi possível carregar os modelos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void recarregar(); }, [recarregar]);

  /** Substitui (ou insere) o modelo na lista em memória, sem refazer a busca. */
  const aplicar = useCallback((t: Template) => {
    setTemplates(prev => (prev.some(x => x.id === t.id) ? prev.map(x => (x.id === t.id ? t : x)) : [t, ...prev]));
  }, []);

  /**
   * Salva o modelo.
   *
   * ⚠️ O id do retorno PODE SER OUTRO: salvar um modelo GLOBAL não altera o global —
   * o backend cria a cópia da empresa e devolve ela (copy-on-write). Quem chama tem
   * de adotar o id devolvido, senão o salvar seguinte cria mais uma cópia.
   */
  const salvar = useCallback(async (t: Template, opcoes?: { novaVersao?: boolean; nota?: string }) => {
    try {
      const { template } = await apiDocs.salvarTemplate(t.id, {
        nome: t.nome, descricao: t.descricao, categoria: t.categoria, especie: t.especie,
        tags: t.tags, blocos: t.blocos, status: t.status, compartilhado: t.compartilhado,
        ...opcoes,
      });
      aplicar(template);
      return template;
    } catch {
      setErro('Não foi possível salvar o modelo.');
      return null;
    }
  }, [aplicar]);

  const criar = useCallback(async (nome = 'Novo modelo') => {
    try {
      const t = await apiDocs.criarTemplate({
        nome, descricao: '', categoria: 'personalizados', especie: 'AMBOS',
        tags: [], blocos: blocosIniciais(), status: 'RASCUNHO',
      });
      aplicar(t);
      return t;
    } catch {
      setErro('Não foi possível criar o modelo.');
      return null;
    }
  }, [aplicar]);

  const duplicar = useCallback(async (id: string) => {
    try {
      const t = await apiDocs.duplicarTemplate(id);
      aplicar(t);
      return t;
    } catch {
      setErro('Não foi possível duplicar o modelo.');
      return null;
    }
  }, [aplicar]);

  const excluir = useCallback(async (id: string, motivo: string) => {
    try {
      await apiDocs.excluirTemplate(id, motivo);
      // Soft delete: some da lista ativa mas continua na Lixeira, então MARCAMOS em
      // vez de remover — remover exigiria recarregar para a Lixeira ficar correta.
      setTemplates(prev => prev.map(t => (t.id === id ? { ...t, excluido: true } : t)));
      return true;
    } catch {
      setErro('Não foi possível excluir o modelo.');
      return false;
    }
  }, []);

  const restaurar = useCallback(async (id: string) => {
    try { aplicar(await apiDocs.restaurarTemplate(id)); }
    catch { setErro('Não foi possível restaurar o modelo.'); }
  }, [aplicar]);

  const alternarFavorito = useCallback(async (id: string) => {
    try {
      const { template } = await apiDocs.favoritarTemplate(id);
      aplicar(template);
      return template;
    } catch {
      setErro('Não foi possível favoritar.');
      return null;
    }
  }, [aplicar]);

  const registrarUso = useCallback((id: string) => {
    // Recentes: sem repetição e no máximo 8 — a lista é atalho, não histórico.
    setRecentes(prev => [id, ...prev.filter(x => x !== id)].slice(0, 8));
  }, []);

  const carregarEmitidos = useCallback(async (animalId?: number | null) => {
    try { setDocumentos(await apiDocs.listarEmitidos(animalId ?? null)); }
    catch { /* lista secundária: falhar aqui não pode bloquear a edição */ }
  }, []);

  /**
   * Emite o documento para um PACIENTE.
   *
   * `blocos` vêm do EDITOR (o vet pode ter ajustado o modelo antes de emitir) e vão
   * com as variáveis AINDA CRUAS: quem as resolve é o backend, sob o tenant, e é o
   * resultado dele que fica gravado.
   */
  const emitir = useCallback(async (
    t: Template, blocos: Bloco[], animalId: number,
    evolucaoId?: number | null, preenchimento?: Record<string, string>,
    listas?: PreenchimentoListas,
  ) => {
    try {
      const doc = await apiDocs.emitirDocumento({
        animalId, templateId: t.id, templateNome: t.nome, blocos, evolucaoId, preenchimento, listas,
      });
      setDocumentos(prev => [doc, ...prev]);
      registrarUso(t.id);
      // O contador de usos vive no banco; refletir aqui evita recarregar a lista
      // inteira só para o número do card mudar.
      setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, usos: x.usos + 1 } : x)));
      return doc;
    } catch {
      setErro('Não foi possível emitir o documento.');
      return null;
    }
  }, [registrarUso]);

  return {
    templates, documentos, recentes, carregando, erro, limparErro,
    recarregar, salvar, criar, duplicar, excluir, restaurar,
    alternarFavorito, registrarUso, carregarEmitidos, emitir,
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
  /** Troca a folha inteira PRESERVANDO o histórico — o passo é desfazível. */
  substituirTudo: (blocos: Bloco[]) => void;
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

  /**
   * Substitui TODOS os blocos, mas como um passo do histórico (ao contrário de
   * `trocarBase`, que recomeça o histórico).
   *
   * É o caminho da IA: o vet pede um ajuste, a folha muda, e `Ctrl+Z` traz de volta
   * o que ele tinha. Sem isso, aceitar uma sugestão ruim custaria o trabalho todo.
   */
  const substituirTudo = useCallback((novos: Bloco[]) => {
    empurrar(novos);
    setSelecionado(null);
  }, [empurrar]);

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
    substituirTudo,
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
