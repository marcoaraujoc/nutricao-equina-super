// src/pages/CentralDocumentos.tsx
// Central de Documentos — página que compõe os três painéis (desktop), o layout de
// duas colunas (tablet) e o fluxo próprio de celular.
//
// A página é só COMPOSIÇÃO e orquestração: o domínio está em modules/documentos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { PanelLeft, Layers, FileText, Braces, X } from 'lucide-react';

import PageContainer from '../components/PageContainer';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';

import { PainelBiblioteca, PainelModelos } from '../modules/documentos/Paineis';
import type { AcoesTemplate } from '../modules/documentos/Paineis';
import {
  DrawerVariaveis, ListaBlocos, PaletaBlocos, PainelPropriedades, PreviewA4, Toolbar,
} from '../modules/documentos/Editor';
import ModalCriarIA from '../modules/documentos/ModalCriarIA';
import CentralMobile from '../modules/documentos/Mobile';
import { useBiblioteca, useBusca, useEditor } from '../modules/documentos/store';
import { CATEGORIAS } from '../modules/documentos/catalogo';
import type {
  Bloco, CategoriaId, ColecaoId, FiltroBiblioteca, Template,
} from '../modules/documentos/types';

/** Vira `true` abaixo de 768px — o mesmo corte do `md:` do Tailwind. */
function useEhMobile(): boolean {
  const [ehMobile, setEhMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setEhMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return ehMobile;
}

export default function CentralDocumentos() {
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const ehMobile = useEhMobile();

  // ── Guard de permissão ────────────────────────────────────────────────────
  // Slugs próprios do módulo, já no catálogo (002_permissoes_padrao.seed.js):
  // `documentos.templates.*` para o MODELO e `documentos.emitidos.*` para a EMISSÃO.
  // São separados de propósito — quem emite atestado no campo não precisa poder
  // reescrever o modelo da clínica.
  const podeVer      = isGestor || podeExecutar('documentos.templates.ler');
  const podeEditar   = isGestor || podeExecutar('documentos.templates.editar');
  const podeCriar    = isGestor || podeExecutar('documentos.templates.criar');
  const podeEmitir   = isGestor || podeExecutar('documentos.emitidos.criar');
  const podeExcluir  = isGestor || podeExecutar('documentos.templates.deletar');

  const autor = user?.fullName ?? 'Profissional';
  const bib   = useBiblioteca(autor);

  const [filtro,  setFiltro]  = useState<FiltroBiblioteca>({ tipo: 'categoria', id: 'todos' });
  const [termo,   setTermo]   = useState('');
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [aba,     setAba]     = useState<'editor' | 'preview'>('editor');
  const [zoom,    setZoom]    = useState(100);
  const [varsAberto, setVarsAberto] = useState(false);
  const [iaAberto,   setIaAberto]   = useState(false);
  const [bibAberta,  setBibAberta]  = useState(false);   // drawer do tablet
  const [salvando,   setSalvando]   = useState(false);

  const folhaRef = useRef<HTMLDivElement>(null);

  const ativo = useMemo(
    () => bib.templates.find(t => t.id === ativoId) ?? null,
    [bib.templates, ativoId],
  );

  // Autosave: grava os blocos no template aberto sem passar pelo botão Salvar.
  const aoAutosave = useCallback((blocos: Bloco[]) => {
    if (!ativo) return;
    bib.salvar({ ...ativo, blocos });
  }, [ativo, bib]);

  const editor = useEditor(ativo?.blocos ?? [], aoAutosave);

  // Trocar de template reinicia o editor (e o histórico de undo junto).
  const trocarBase = editor.trocarBase;
  useEffect(() => {
    if (ativo) trocarBase(ativo.blocos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativoId]);

  // ── Recortes da biblioteca ────────────────────────────────────────────────

  const vivos = useMemo(() => bib.templates.filter(t => !t.excluido), [bib.templates]);

  const doFiltro = useMemo((): Template[] => {
    if (filtro.tipo === 'colecao') {
      switch (filtro.id) {
        case 'favoritos':      return vivos.filter(t => t.favorito);
        case 'compartilhados': return vivos.filter(t => t.compartilhado);
        case 'lixeira':        return bib.templates.filter(t => t.excluido);
        case 'recentes':
          // Ordem da lista de recentes, não a do acervo — é o que a torna útil.
          return bib.recentes
            .map(id => vivos.find(t => t.id === id))
            .filter((t): t is Template => !!t);
      }
    }
    return filtro.id === 'todos' ? vivos : vivos.filter(t => t.categoria === filtro.id);
  }, [filtro, vivos, bib.templates, bib.recentes]);

  const listados = useBusca(doFiltro, termo);

  const contarCategoria = useCallback((id: CategoriaId | 'todos') =>
    id === 'todos' ? vivos.length : vivos.filter(t => t.categoria === id).length, [vivos]);

  const contarColecao = useCallback((id: ColecaoId) => {
    switch (id) {
      case 'favoritos':      return vivos.filter(t => t.favorito).length;
      case 'recentes':       return bib.recentes.length;
      case 'compartilhados': return vivos.filter(t => t.compartilhado).length;
      case 'lixeira':        return bib.templates.filter(t => t.excluido).length;
    }
  }, [vivos, bib.recentes, bib.templates]);

  const tituloLista = filtro.tipo === 'colecao'
    ? ({ favoritos: 'Favoritos', recentes: 'Recentes', compartilhados: 'Compartilhados', lixeira: 'Lixeira' })[filtro.id]
    : filtro.id === 'todos' ? 'Todos os modelos'
    : (CATEGORIAS.find(c => c.id === filtro.id)?.rotulo ?? 'Modelos');

  // ── Ações ─────────────────────────────────────────────────────────────────

  const abrir = useCallback((t: Template) => {
    setAtivoId(t.id);
    setAba('editor');
    setBibAberta(false);
  }, []);

  const salvar = useCallback(() => {
    if (!ativo) return;
    if (!podeEditar) { toast.error('Sem permissão para editar modelos.'); return; }
    setSalvando(true);
    bib.salvar({ ...ativo, blocos: editor.blocos, status: 'PUBLICADO' });
    editor.marcarSalvo();
    setSalvando(false);
    toast.success('Modelo salvo');
  }, [ativo, bib, editor, podeEditar]);

  const salvarVersao = useCallback(() => {
    if (!ativo) return;
    const versao = ativo.versao + 1;
    bib.salvar({
      ...ativo,
      blocos:  editor.blocos,
      versao,
      // A versão guarda os blocos ANTERIORES: é o estado ao qual se volta.
      versoes: [
        { versao: ativo.versao, criadoEm: new Date().toISOString(), autor, nota: 'Versão automática', blocos: ativo.blocos },
        ...ativo.versoes,
      ].slice(0, 30),
    });
    editor.marcarSalvo();
    toast.success(`Versão ${versao} salva`);
  }, [ativo, bib, editor, autor]);

  const gerar = useCallback((t: Template) => {
    if (!podeEmitir) { toast.error('Sem permissão para emitir documentos.'); return; }
    const doc = bib.emitir({ ...t, blocos: t.id === ativoId ? editor.blocos : t.blocos });
    toast.success(`Documento emitido para ${doc.animalNome}`);
  }, [bib, ativoId, editor.blocos, podeEmitir]);

  const compartilhar = useCallback(async (t: Template) => {
    const texto = `${t.nome} — ${t.descricao}`;
    // Web Share API é o caminho nativo no celular (WhatsApp do vet em campo);
    // sem ela, copia o resumo para a área de transferência.
    if (navigator.share) {
      try { await navigator.share({ title: t.nome, text: texto }); return; } catch { /* cancelado */ }
    }
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('Resumo copiado');
    } catch {
      toast.error('Não foi possível compartilhar');
    }
  }, []);

  const exportarPdf = useCallback(async () => {
    const no = folhaRef.current;
    if (!no || !ativo) { toast.error('Abra a visualização antes de exportar'); return; }
    const t = toast.loading('Gerando PDF...');
    try {
      // Import dinâmico: jspdf + html2canvas somam ~600 kB. Carregar só quando o vet
      // exporta mantém a entrada do módulo leve — que é o requisito de velocidade.
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ]);
      const canvas = await html2canvas(no, { scale: 2, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const largura = pdf.internal.pageSize.getWidth();
      const altura  = (canvas.height * largura) / canvas.width;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, largura, altura);
      pdf.save(`${ativo.nome.replace(/\s+/g, '-').toLowerCase()}.pdf`);
      toast.success('PDF gerado', { id: t });
    } catch {
      toast.error('Falha ao gerar o PDF', { id: t });
    }
  }, [ativo]);

  const acoesTemplate: AcoesTemplate = {
    onEditar:     abrir,
    onVisualizar: (t) => { abrir(t); setAba('preview'); },
    onDuplicar:   (t) => { const c = bib.duplicar(t.id); if (c) { abrir(c); toast.success('Modelo duplicado'); } },
    onGerar:      gerar,
    onExcluir:    (t) => { bib.excluir(t.id); if (t.id === ativoId) setAtivoId(null); toast.success('Movido para a lixeira'); },
    onRestaurar:  (t) => { bib.restaurar(t.id); toast.success('Modelo restaurado'); },
    onFavorito:   (t) => bib.alternarFavorito(t.id),
  };

  const criarNovo = useCallback(() => {
    if (!podeCriar) { toast.error('Sem permissão para criar modelos.'); return; }
    const t = bib.criarVazio();
    bib.salvar(t);
    abrir(t);
  }, [bib, abrir, podeCriar]);

  const aplicarIA = useCallback((dados: Pick<Template, 'nome' | 'descricao' | 'especie' | 'blocos'>) => {
    const t: Template = { ...bib.criarVazio(dados.nome), ...dados, categoria: 'personalizados' };
    bib.salvar(t);
    abrir(t);
    toast.success('Template gerado — ajuste o que precisar');
  }, [bib, abrir]);

  /** Insere a variável no bloco selecionado; sem seleção, cria um bloco de texto. */
  const inserirVariavel = useCallback((chave: string) => {
    const sel = editor.blocos.find(b => b.id === editor.selecionado);
    if (!sel) { toast('Selecione um bloco antes de inserir a variável', { icon: 'ℹ️' }); return; }
    if (sel.tipo === 'campoAuto') {
      editor.atualizar(sel.id, { conteudo: { ...sel.conteudo, variavel: chave } });
    } else {
      editor.atualizar(sel.id, { conteudo: { ...sel.conteudo, texto: `${sel.conteudo.texto ?? ''}${chave}` } });
    }
  }, [editor]);

  if (!loadingPerms && !podeVer) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para a Central de Documentos.</p>
        </div>
      </PageContainer>
    );
  }

  // ── Mobile: fluxo próprio ─────────────────────────────────────────────────
  if (ehMobile) {
    return (
      <>
        <CentralMobile
          templates={vivos}
          recentes={bib.recentes.map(id => vivos.find(t => t.id === id)).filter((t): t is Template => !!t)}
          favoritos={vivos.filter(t => t.favorito)}
          selecionado={ativo}
          editor={editor}
          onSelecionar={t => setAtivoId(t.id)}
          onGerar={gerar}
          onCompartilhar={compartilhar}
          onNovo={criarNovo}
          onCriarIA={() => setIaAberto(true)}
          onSalvar={salvar}
        />
        <ModalCriarIA aberto={iaAberto} onFechar={() => setIaAberto(false)} onGerado={aplicarIA} />
      </>
    );
  }

  // ── Desktop / tablet ──────────────────────────────────────────────────────
  return (
    <PageContainer maxWidth="full" noPadding className="h-full">
      {/* Altura travada na viewport: os três painéis rolam por dentro, e a página em
          si não rola. Sem isto o editor empurraria o rodapé do shell para baixo. */}
      <div className="flex flex-col h-[calc(100dvh-8rem)] min-h-[560px] px-4 py-4 md:px-6">
        <header className="flex items-center gap-3 mb-3 flex-shrink-0">
          <button
            onClick={() => setBibAberta(v => !v)}
            className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Abrir biblioteca"
          >
            <PanelLeft size={18} />
          </button>
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText size={20} className="text-emerald-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">Central de Documentos</h1>
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              Modelos, edição por blocos e emissão em segundos.
            </p>
          </div>
        </header>

        <div className="flex-1 flex gap-3 min-h-0">

          {/* ── 22% · Biblioteca ── (drawer abaixo de lg) */}
          <aside className="hidden lg:flex w-[22%] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <PainelBiblioteca
              filtro={filtro} onFiltro={setFiltro}
              contarCategoria={contarCategoria} contarColecao={contarColecao}
              termo={termo} onTermo={setTermo}
            />
          </aside>

          {bibAberta && (
            <>
              <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setBibAberta(false)} />
              <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white shadow-2xl z-50 lg:hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-900">Biblioteca</p>
                  <button onClick={() => setBibAberta(false)} className="p-1 text-gray-400" aria-label="Fechar">
                    <X size={16} />
                  </button>
                </div>
                <PainelBiblioteca
                  filtro={filtro} onFiltro={f => { setFiltro(f); setBibAberta(false); }}
                  contarCategoria={contarCategoria} contarColecao={contarColecao}
                  termo={termo} onTermo={setTermo}
                />
              </aside>
            </>
          )}

          {/* ── 33% · Modelos ── */}
          <section className="w-[38%] lg:w-[33%] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <PainelModelos
              templates={listados} ativoId={ativoId} acoes={acoesTemplate} titulo={tituloLista}
              perm={{ podeEditar, podeCriar, podeEmitir, podeExcluir }}
            />
          </section>

          {/* ── 45% · Editor + Preview ── */}
          <section className="flex-1 min-w-0 flex bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {!ativo ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
                <Layers size={32} className="text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Selecione um modelo para editar</p>
                {podeCriar && (
                  <div className="flex gap-2 mt-4">
                    <button onClick={criarNovo}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                      Criar do zero
                    </button>
                    <button onClick={() => setIaAberto(true)}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors">
                      Criar com IA
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0 flex flex-col">
                  <Toolbar
                    editor={editor}
                    salvando={salvando}
                    acoes={{
                      onNovo: criarNovo,
                      onSalvar: salvar,
                      onSalvarVersao: salvarVersao,
                      onDuplicar: () => acoesTemplate.onDuplicar(ativo),
                      onCompartilhar: () => compartilhar(ativo),
                      onExportarPdf: exportarPdf,
                      onImprimir: () => window.print(),
                      onHistorico: () => toast(`${ativo.versoes.length} versão(ões) salvas`, { icon: '🕘' }),
                      onConfiguracoes: () => toast('Configurações do modelo em breve', { icon: '⚙️' }),
                      onCriarIA: () => setIaAberto(true),
                    }}
                  />

                  <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 flex-shrink-0">
                    {(['editor', 'preview'] as const).map(k => (
                      <button key={k} onClick={() => setAba(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          aba === k ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                        }`}>
                        {k === 'editor' ? 'Editor' : 'Visualizar'}
                      </button>
                    ))}
                    <button
                      onClick={() => setVarsAberto(true)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
                    >
                      <Braces size={13} /> Variáveis
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0">
                    {aba === 'editor' ? (
                      <>
                        <PaletaBlocos onAdicionar={editor.adicionar} />
                        <div className="border-t border-gray-100 pt-2">
                          <ListaBlocos editor={editor} />
                        </div>
                      </>
                    ) : (
                      <PreviewA4
                        template={ativo} blocos={editor.blocos}
                        zoom={zoom} onZoom={setZoom} refFolha={folhaRef}
                      />
                    )}
                  </div>
                </div>

                {editor.selecionado && aba === 'editor' && (
                  <PainelPropriedades
                    editor={editor}
                    onFechar={() => editor.selecionar(null)}
                    onAbrirVariaveis={() => setVarsAberto(true)}
                  />
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <DrawerVariaveis
        aberto={varsAberto}
        onFechar={() => setVarsAberto(false)}
        onInserir={inserirVariavel}
      />
      <ModalCriarIA aberto={iaAberto} onFechar={() => setIaAberto(false)} onGerado={aplicarIA} />
    </PageContainer>
  );
}
