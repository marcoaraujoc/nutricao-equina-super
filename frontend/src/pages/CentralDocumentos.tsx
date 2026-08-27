// src/pages/CentralDocumentos.tsx
// Central de Documentos — composição dos painéis (desktop), duas colunas (tablet) e
// o fluxo próprio de celular.
//
// A página é COMPOSIÇÃO e orquestração: o domínio está em modules/documentos.
//
// 🔴 O QUE MUDOU EM 2026-08-26 (a tela deixou de ser protótipo):
//   · Os modelos vêm do BACKEND, sob RLS, e não mais do `localStorage`.
//   · Existe SELETOR DE PACIENTE. Escolhido o animal, as variáveis do documento
//     passam a mostrar o dado REAL dele (`GET /documentos/contexto/:animalId`), e
//     a folha ganha a logomarca da clínica e a assinatura de quem emite.
//   · EMITIR grava um documento de verdade, vinculado ao paciente — e o documento
//     aparece no Histórico e na Memória Clínica da tela do animal.
//   · O "Criar com IA" virou CHAT multi-turno, ancorado no acervo de modelos.
//
// ⚠️ MODELO DO SISTEMA É SÓ LEITURA. Os 12 anexos da Res. CFMV 1.321/2020 são
// globais: salvar um deles NÃO altera o global — o backend cria a cópia da clínica e
// devolve outro id (copy-on-write). Por isso `salvar` adota o id devolvido, e por
// isso NÃO há autosave em modelo global: um autosave ali criaria uma cópia da
// clínica a cada pausa de digitação, sem ninguém ter pedido.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { PanelLeft, Layers, FileText, Braces, X, Sparkles, Loader2, ShieldCheck } from 'lucide-react';

import PageContainer from '../components/PageContainer';
import InlineError from '../components/InlineError';
import SeletorAnimalInteligente from '../components/SeletorAnimalInteligente';
import AnimalCard from '../components/AnimalCard';
import ModalJustificativa from '../components/ModalJustificativa';
import api from '../services/api';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';

import { PainelBiblioteca, PainelModelos } from '../modules/documentos/Paineis';
import type { AcoesTemplate } from '../modules/documentos/Paineis';
import {
  DrawerVariaveis, ListaBlocos, PaletaBlocos, PainelPropriedades, PreviewA4, Toolbar,
} from '../modules/documentos/Editor';
import ChatIA from '../modules/documentos/ChatIA';
import ModalPreencher from '../modules/documentos/ModalPreencher';
import CentralMobile from '../modules/documentos/Mobile';
import { carregarCampos, carregarContexto } from '../modules/documentos/api';
import type { ContextoDocumento } from '../modules/documentos/api';
import type { CampoDocumento, Preenchimento } from '../modules/documentos/campos';
import { useBiblioteca, useBusca, useEditor } from '../modules/documentos/store';
import { CATEGORIAS } from '../modules/documentos/catalogo';
import type {
  Bloco, CategoriaId, ColecaoId, FiltroBiblioteca, Template,
} from '../modules/documentos/types';

/**
 * Paciente como o `AnimalCard` (o card da tela de Atendimento) o consome — os campos
 * são os que ele exibe: nome, espécie, raça, idade, peso, baia, local, tipo de
 * trabalho e proprietário. `GET /animais` já devolve todos.
 */
interface AnimalDoc {
  id:              number;
  nome:            string;
  photoUrl?:       string | null;
  dataNascimento?: string | null;
  idadeAnos?:      number | null;
  peso?:           number | null;
  tipoExercicio?:  string | null;
  baia?:           string | null;
  local?:          string | null;
  raca?:           { nome: string } | null;
  especie?:        { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
  veterinarioNome?: string | null;
}

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
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { contextoAtivo, loading: empresaLoading } = useEmpresa();
  const { selectedAnimal } = useSelectedAnimal();
  const ehMobile = useEhMobile();

  // ── Guard de permissão ────────────────────────────────────────────────────
  // `documentos.templates.*` para o MODELO e `documentos.emitidos.*` para a EMISSÃO.
  // São separados de propósito — quem emite atestado no campo não precisa poder
  // reescrever o modelo da clínica.
  const podeVer      = isGestor || podeExecutar('documentos.templates.ler');
  const podeEditar   = isGestor || podeExecutar('documentos.templates.editar');
  const podeCriar    = isGestor || podeExecutar('documentos.templates.criar');
  const podeEmitir   = isGestor || podeExecutar('documentos.emitidos.criar');
  const podeExcluir  = isGestor || podeExecutar('documentos.templates.deletar');

  const bib = useBiblioteca();

  const [filtro,  setFiltro]  = useState<FiltroBiblioteca>({ tipo: 'categoria', id: 'todos' });
  const [termo,   setTermo]   = useState('');
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [aba,     setAba]     = useState<'editor' | 'preview'>('editor');
  const [zoom,    setZoom]    = useState(100);
  const [varsAberto, setVarsAberto] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);
  const [bibAberta,  setBibAberta]  = useState(false);   // drawer do tablet
  const [salvando,   setSalvando]   = useState(false);
  const [emitindo,   setEmitindo]   = useState(false);
  // Emissão: o "Gerar" abre a tela de preenchimento em vez de emitir direto.
  // `emitindoTpl` guarda QUAL modelo está sendo emitido — pode não ser o aberto no
  // editor (dá para clicar em Gerar direto no card da lista).
  const [emitindoTpl,   setEmitindoTpl]   = useState<Template | null>(null);
  const [blocosEmissao, setBlocosEmissao] = useState<Bloco[]>([]);
  const [camposEmissao, setCamposEmissao] = useState<CampoDocumento[]>([]);
  const [carregandoCampos, setCarregandoCampos] = useState(false);
  const [erroEmissao,   setErroEmissao]   = useState<string | null>(null);
  const [excluindo,  setExcluindo]  = useState<Template | null>(null);

  // ── Paciente ──────────────────────────────────────────────────────────────
  const [animais,   setAnimais]   = useState<AnimalDoc[]>([]);
  const [animalId,  setAnimalId]  = useState<number | null>(null);
  const [contexto,  setContexto]  = useState<ContextoDocumento | null>(null);
  const [carregandoCtx, setCarregandoCtx] = useState(false);

  const folhaRef = useRef<HTMLDivElement>(null);

  const ativo = useMemo(
    () => bib.templates.find(t => t.id === ativoId) ?? null,
    [bib.templates, ativoId],
  );

  const animal = useMemo(
    () => animais.find(a => a.id === animalId) ?? null,
    [animais, animalId],
  );

  /**
   * Lista de pacientes do contexto ativo.
   *
   * ⚠️ Espera `empresaLoading` terminar: nenhum fetch escopado por empresa antes de o
   * contexto estar resolvido, senão a chamada sai sem `x-empresa-id` e o backend cai
   * no vínculo mais recente — a lista da OUTRA clínica (armadilha da sessão 2026-07-28).
   */
  useEffect(() => {
    if (empresaLoading || loadingPerms || !podeVer) return;
    let vivo = true;
    api.get('/animais')
      .then(res => { if (vivo) setAnimais((res.data?.dados ?? []) as AnimalDoc[]); })
      .catch(() => { /* lista vazia: a tela segue utilizável no modo exemplo */ });
    return () => { vivo = false; };
  }, [empresaLoading, loadingPerms, podeVer, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  // Adota o paciente já selecionado no shell — quem veio da tela do animal não
  // deveria ter de escolher de novo o mesmo paciente aqui.
  useEffect(() => {
    if (animalId != null) return;
    if (selectedAnimal?.id) setAnimalId(selectedAnimal.id);
  }, [selectedAnimal?.id, animalId]);

  /**
   * Contexto do paciente: variáveis resolvidas + logomarca + assinatura.
   *
   * É isto que faz "ao selecionar o animal, preencher automaticamente as informações
   * do animal": o preview deixa de mostrar os exemplos do catálogo ("Thor", "Haras
   * Boa Vista") e passa a mostrar o paciente de verdade.
   */
  useEffect(() => {
    if (empresaLoading || animalId == null) { setContexto(null); return; }
    let vivo = true;
    setCarregandoCtx(true);
    carregarContexto(animalId)
      .then(ctx => { if (vivo) setContexto(ctx); })
      .catch(() => { if (vivo) setContexto(null); })
      .finally(() => { if (vivo) setCarregandoCtx(false); });
    return () => { vivo = false; };
  }, [animalId, empresaLoading, contextoAtivo?.empresaId]);

  // Documentos já emitidos PARA ESTE PACIENTE. Alimentam a lista do estado vazio do
  // editor — é onde o vet confere se o atestado que ele ia emitir já foi emitido hoje.
  const carregarEmitidos = bib.carregarEmitidos;
  useEffect(() => {
    if (empresaLoading || animalId == null) return;
    void carregarEmitidos(animalId);
  }, [animalId, empresaLoading, carregarEmitidos]);

  /**
   * Autosave — SÓ em modelo da própria clínica.
   *
   * ⚠️ Modelo GLOBAL fica de fora: salvar um global dispara o copy-on-write no
   * backend, e um autosave ali criaria uma cópia da clínica a cada pausa de
   * digitação. Quem quer a versão própria clica em Salvar, que é um ato explícito.
   */
  const aoAutosave = useCallback((blocos: Bloco[]) => {
    if (!ativo || ativo.global || !podeEditar) return;
    void bib.salvar({ ...ativo, blocos });
  }, [ativo, bib, podeEditar]);

  const editor = useEditor(ativo?.blocos ?? [], aoAutosave);

  // Trocar de modelo reinicia o editor (e o histórico de undo junto).
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

  /**
   * Salva o modelo aberto.
   *
   * ⚠️ Em modelo GLOBAL o backend devolve a CÓPIA da clínica (id novo). Adotar esse
   * id é obrigatório: sem isso, o salvar seguinte criaria mais uma cópia, e a tela
   * ficaria editando um registro que não é o que está sendo gravado.
   */
  const salvar = useCallback(async (opcoes?: { novaVersao?: boolean }) => {
    if (!ativo) return;
    if (!podeEditar) { toast.error('Sem permissão para editar modelos.'); return; }
    setSalvando(true);
    const eraGlobal = ativo.global;
    const salvo = await bib.salvar(
      { ...ativo, blocos: editor.blocos, status: 'PUBLICADO' },
      opcoes?.novaVersao ? { novaVersao: true, nota: 'Versão manual' } : undefined,
    );
    setSalvando(false);
    if (!salvo) { toast.error('Não foi possível salvar o modelo.'); return; }

    if (salvo.id !== ativo.id) setAtivoId(salvo.id);
    editor.marcarSalvo();

    toast.success(eraGlobal
      ? 'Modelo do sistema personalizado — agora existe a versão da sua clínica.'
      : opcoes?.novaVersao ? `Versão ${salvo.versao} salva` : 'Modelo salvo');
  }, [ativo, bib, editor, podeEditar]);

  /**
   * Emite o documento para o PACIENTE selecionado.
   *
   * Manda os blocos do EDITOR (o vet pode ter ajustado antes de emitir, que é o que
   * se quer permitir) ainda com as variáveis cruas: quem as resolve é o backend, sob
   * o tenant, e é o resultado dele que fica gravado no snapshot.
   */
  /**
   * Clicar em GERAR abre a tela de preenchimento — não emite direto.
   *
   * Pergunta ao backend o que falta preencher NESTE modelo para ESTE paciente
   * (`POST /documentos/campos`) e abre o `ModalPreencher` com a lista. Mesmo quando
   * não falta nada a tela abre: é a conferência antes de emitir um documento que tem
   * valor legal, e é onde o vet vê a folha final antes de assinar.
   */
  const abrirEmissao = useCallback(async (t: Template) => {
    if (!podeEmitir) { toast.error('Sem permissão para emitir documentos.'); return; }
    if (animalId == null) { toast.error('Selecione o paciente antes de emitir.'); return; }

    // Os blocos do EDITOR quando o modelo é o que está aberto (o vet pode tê-lo
    // ajustado sem salvar); os do modelo, quando o clique veio do card da lista.
    const blocos = t.id === ativoId ? editor.blocos : t.blocos;

    setEmitindoTpl(t);
    setBlocosEmissao(blocos);
    setCamposEmissao([]);
    setErroEmissao(null);
    setCarregandoCampos(true);
    try {
      const r = await carregarCampos({ animalId, blocos, evolucaoId: contexto?.evolucaoId ?? null });
      setCamposEmissao(r.campos ?? []);
    } catch {
      // Falhar aqui não pode fechar a tela: sem a lista, ainda dá para conferir a
      // folha e emitir com os campos em branco — que é o comportamento do papel.
      setErroEmissao('Não foi possível carregar os campos. Você ainda pode emitir com eles em branco.');
    } finally {
      setCarregandoCampos(false);
    }
  }, [podeEmitir, animalId, ativoId, editor.blocos, contexto?.evolucaoId]);

  /** Confirmação da tela de preenchimento: aí sim emite. */
  const confirmarEmissao = useCallback(async (preenchimento: Preenchimento) => {
    if (!emitindoTpl || animalId == null) return;
    setEmitindo(true);
    setErroEmissao(null);
    const doc = await bib.emitir(
      emitindoTpl, blocosEmissao, animalId, contexto?.evolucaoId ?? null, preenchimento,
    );
    setEmitindo(false);
    if (!doc) { setErroEmissao('Não foi possível emitir o documento.'); return; }
    setEmitindoTpl(null);
    toast.success(`${doc.numeroFmt ?? 'Documento'} emitido para ${doc.animalNome}`);
  }, [emitindoTpl, blocosEmissao, animalId, contexto?.evolucaoId, bib]);

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
    onDuplicar:   async (t) => {
      const c = await bib.duplicar(t.id);
      if (c) { abrir(c); toast.success('Modelo duplicado'); }
    },
    onGerar:      (t) => { void abrirEmissao(t); },
    // A exclusão exige justificativa (§33) — o modal a coleta antes de chamar a API.
    onExcluir:    (t) => setExcluindo(t),
    onRestaurar:  async (t) => { await bib.restaurar(t.id); toast.success('Modelo restaurado'); },
    onFavorito:   async (t) => {
      const salvo = await bib.alternarFavorito(t.id);
      // Favoritar um modelo do sistema também vira cópia da clínica — se o aberto
      // era ele, a tela passa a editar a cópia.
      if (salvo && t.id === ativoId && salvo.id !== t.id) setAtivoId(salvo.id);
    },
  };

  const confirmarExclusao = useCallback(async (motivo: string) => {
    if (!excluindo) return;
    const ok = await bib.excluir(excluindo.id, motivo);
    if (ok) {
      if (excluindo.id === ativoId) setAtivoId(null);
      toast.success('Movido para a lixeira');
    } else {
      toast.error('Modelo do sistema não pode ser excluído — personalize-o para ter a versão da sua clínica.');
    }
    setExcluindo(null);
  }, [excluindo, bib, ativoId]);

  const criarNovo = useCallback(async () => {
    if (!podeCriar) { toast.error('Sem permissão para criar modelos.'); return; }
    const t = await bib.criar();
    if (t) abrir(t);
  }, [bib, abrir, podeCriar]);

  /** A IA reescreveu a folha: entra como um passo do editor, desfazível. */
  const aplicarBlocosDaIA = useCallback((blocos: Bloco[], nome: string | null) => {
    editor.substituirTudo(blocos);
    if (nome && ativo && !ativo.global) {
      // Renomear um modelo do sistema criaria a cópia sem o vet pedir — o nome
      // sugerido só é adotado quando o modelo já é da clínica.
      void bib.salvar({ ...ativo, nome, blocos });
    }
  }, [editor, ativo, bib]);

  const escolherTemplateDaIA = useCallback((templateId: string) => {
    const t = bib.templates.find(x => x.id === templateId);
    if (t) abrir(t);
  }, [bib.templates, abrir]);

  /** Insere a variável no bloco selecionado; sem seleção, avisa. */
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

  // ── Paciente: o MESMO par da tela de Atendimento ───────────────────────────
  // `SeletorAnimalInteligente` + `AnimalCard`, na mesma ordem e sem invólucro
  // próprio. Um card diferente aqui obrigaria o vet a reaprender onde estão baia,
  // local e proprietário a cada tela — e as duas versões divergiriam na primeira
  // correção (a lição do `SubModuloMinhaAgenda`, armadilha 28-g).
  const seletorPaciente = (
    <>
      <SeletorAnimalInteligente
        animais={animais}
        animalAtual={animal}
        onSelecionar={(a) => setAnimalId(a.id)}
      />
      {animal && <AnimalCard animal={animal} />}
      {carregandoCtx && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-1">
          <Loader2 size={11} className="animate-spin" /> Carregando os dados do paciente…
        </p>
      )}
    </>
  );

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
          contexto={contexto?.variaveis ?? null}
          marca={contexto?.marca ?? null}
          cabecalhoPaciente={seletorPaciente}
          onSelecionar={t => setAtivoId(t.id)}
          onGerar={(t) => { void abrirEmissao(t); }}
          onCompartilhar={compartilhar}
          onNovo={() => { void criarNovo(); }}
          onCriarIA={() => setChatAberto(true)}
          onSalvar={() => { void salvar(); }}
        />
        <ChatIA
          aberto={chatAberto}
          onFechar={() => setChatAberto(false)}
          templateAtivo={ativo}
          blocosAtuais={editor.blocos}
          onAplicarBlocos={aplicarBlocosDaIA}
          onEscolherTemplate={escolherTemplateDaIA}
        />
        {/* A mesma tela de preenchimento do desktop — ela já é responsiva (abas
            "Preencher"/"Prévia" abaixo de sm). Duas versões divergiriam. */}
        <ModalPreencher
          aberto={!!emitindoTpl}
          onFechar={() => { setEmitindoTpl(null); setErroEmissao(null); }}
          templateNome={emitindoTpl?.nome ?? ''}
          animalNome={animal?.nome ?? ''}
          blocos={blocosEmissao}
          campos={camposEmissao}
          contexto={contexto?.variaveis ?? null}
          marca={contexto?.marca ?? null}
          carregando={carregandoCampos}
          emitindo={emitindo}
          erro={erroEmissao}
          onEmitir={(p) => { void confirmarEmissao(p); }}
        />
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
              Modelos oficiais do CFMV, edição por blocos e emissão para o paciente.
            </p>
          </div>

        </header>

        {/* Erro de CARGA vai no topo (§6): não veio de clique nenhum. */}
        {bib.erro && <InlineError message={bib.erro} className="mb-3 flex-shrink-0" />}

        {/* Paciente — ACIMA dos painéis e em largura cheia, na mesma posição e com o
            MESMO card da tela de Atendimento. É ele que governa todo o conteúdo da
            folha, então fica visível o tempo todo em vez de escondido num modal.
            `flex-shrink-0`: o espaço sai dos painéis, que rolam por dentro. */}
        <div className="flex-shrink-0 mb-3">{seletorPaciente}</div>

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
            {bib.carregando ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            ) : (
              <PainelModelos
                templates={listados} ativoId={ativoId} acoes={acoesTemplate} titulo={tituloLista}
                perm={{ podeEditar, podeCriar, podeEmitir, podeExcluir }}
              />
            )}
          </section>

          {/* ── 45% · Editor + Preview ── */}
          <section className="flex-1 min-w-0 flex bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {!ativo ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
                <Layers size={32} className="text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Selecione um modelo para editar</p>
                {podeCriar && (
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => void criarNovo()}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                      Criar do zero
                    </button>
                    <button onClick={() => setChatAberto(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors">
                      <Sparkles size={14} /> Pedir à IA
                    </button>
                  </div>
                )}

                {/* Já emitidos para este paciente. Evita a emissão em duplicidade —
                    dois atestados sanitários no mesmo dia não são dois documentos,
                    são um reenvio de formulário. */}
                {animal && bib.documentos.length > 0 && (
                  <div className="mt-8 w-full max-w-sm text-left">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                      Emitidos para {animal.nome}
                    </p>
                    <div className="space-y-1">
                      {bib.documentos.slice(0, 5).map(d => (
                        <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50">
                          <FileText size={13} className="text-gray-400 flex-shrink-0" />
                          <span className="text-xs text-gray-700 truncate flex-1">
                            {d.titulo || d.templateNome}
                          </span>
                          <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                            {d.numeroFmt ?? ''}
                          </span>
                        </div>
                      ))}
                    </div>
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
                      onNovo: () => void criarNovo(),
                      onSalvar: () => void salvar(),
                      onSalvarVersao: () => void salvar({ novaVersao: true }),
                      onDuplicar: () => acoesTemplate.onDuplicar(ativo),
                      onCompartilhar: () => compartilhar(ativo),
                      onExportarPdf: exportarPdf,
                      onImprimir: () => window.print(),
                      onHistorico: () => toast(`${ativo.versoes.length} versão(ões) salvas`, { icon: '🕘' }),
                      onConfiguracoes: () => toast('Configurações do modelo em breve', { icon: '⚙️' }),
                      onCriarIA: () => setChatAberto(true),
                    }}
                  />

                  {/* Faixa do modelo do sistema. É a única pista de que Salvar aqui
                      não altera o original — sem ela, "salvei e o modelo continua o
                      mesmo para todo mundo?" vira dúvida legítima. */}
                  {ativo.global && (
                    <div className="flex items-start gap-2 mx-3 mt-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
                      <ShieldCheck size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        <strong>Modelo oficial do CFMV.</strong> Ao salvar, o original continua
                        intacto e a sua clínica passa a ter uma cópia própria para editar.
                      </p>
                    </div>
                  )}

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

                    {podeEmitir && (
                      <button
                        onClick={() => void abrirEmissao(ativo)}
                        disabled={emitindo || animalId == null}
                        title={animalId == null ? 'Selecione o paciente para emitir' : 'Emitir para o paciente'}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                      >
                        {emitindo ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                        Emitir
                      </button>
                    )}
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
                        contexto={contexto?.variaveis ?? null}
                        marca={contexto?.marca ?? null}
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
      <ChatIA
        aberto={chatAberto}
        onFechar={() => setChatAberto(false)}
        templateAtivo={ativo}
        blocosAtuais={editor.blocos}
        onAplicarBlocos={aplicarBlocosDaIA}
        onEscolherTemplate={escolherTemplateDaIA}
      />
      <ModalPreencher
        aberto={!!emitindoTpl}
        onFechar={() => { setEmitindoTpl(null); setErroEmissao(null); }}
        templateNome={emitindoTpl?.nome ?? ''}
        animalNome={animal?.nome ?? ''}
        blocos={blocosEmissao}
        campos={camposEmissao}
        contexto={contexto?.variaveis ?? null}
        marca={contexto?.marca ?? null}
        carregando={carregandoCampos}
        emitindo={emitindo}
        erro={erroEmissao}
        onEmitir={(p) => { void confirmarEmissao(p); }}
      />
      <ModalJustificativa
        aberto={!!excluindo}
        titulo="Excluir modelo"
        descricao={excluindo ? `O modelo "${excluindo.nome}" vai para a Lixeira.` : ''}
        acaoLabel="Excluir"
        onConfirmar={confirmarExclusao}
        onFechar={() => setExcluindo(null)}
      />
    </PageContainer>
  );
}
