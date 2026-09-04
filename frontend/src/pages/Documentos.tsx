// src/pages/Documentos.tsx
// Central de Documentos — EMISSÃO. É a tela do dia a dia: escolher o paciente e o
// documento, preencher o que falta e emitir.
//
// 🔴 O QUE MUDOU (2026-08-30): esta rota era o EDITOR DE BLOCOS em três painéis
// (biblioteca · modelos · editor+preview). Montar modelo é trabalho de configuração,
// feito uma vez; EMITIR é o que acontece a cada atendimento — e o fluxo de emitir
// estava enterrado atrás de escolher um card, abrir o editor e achar o botão "Gerar".
// O editor NÃO foi removido: mudou para `/documentos/modelos` (`CentralDocumentos`).
//
// ⚠️ ESTA TELA NÃO TEM BOTÃO PARA O EDITOR NEM PARA CRIAR MODELO/CATEGORIA — os três
// ("Modelos", "Novo documento", "Nova categoria") foram REMOVIDOS a pedido em
// 2026-08-30. Consequência conhecida e aceita: `/documentos/modelos` continua montada
// e funcional, mas hoje **não tem porta de entrada na interface** (o Sidebar aponta
// para `/documentos`). Quem precisar dela chega pela URL. Não reintroduzir os botões
// sem pedido; para dar acesso ao editor, o lugar natural é o Sidebar.
//
// LAYOUT — o mesmo de `/agendamentos` (`PageContainer` + `BotaoVoltar` + cabeçalho com
// ícone + cards brancos `rounded-2xl`), porque as duas telas fazem a mesma coisa:
// escolher em uma linha de seletores e agir na lista abaixo.
//
//   1. UMA LINHA:  Paciente · Nome do Documento
//      ⚠️ O campo "Tipo de Documento" (leitura) SAIU em 2026-09-03, a pedido, e com
//      ele o campo "Categoria" do diálogo de envio. A categoria continua existindo no
//      modelo (é ela que agrupa a lista do combobox e o que o editor classifica) — o
//      que saiu foi PEDI-LA e EXIBI-LA aqui: quem emite procura o documento pelo
//      NOME, e o tipo era só o eco da gaveta em que ele foi arquivado. Documento
//      enviado por esta tela nasce em `personalizados` (default da coluna).
//      Não reintroduzir sem pedido.
//   2. LARGURA CHEIA: os campos a preencher, com Cancelar · Inserir · Salvar
//   3. HISTÓRICO: os documentos já emitidos, com Visualizar/Imprimir/WhatsApp/E-mail
//
// INSERIR × SALVAR é o mesmo par de `SubModuloExames` (a tela `/clinica/exames/:id`
// que serviu de referência): **Inserir** guarda o documento preenchido numa fila local
// para emitir vários de uma vez (atestado + TCLE no mesmo atendimento, que é o caso
// comum); **Salvar** emite a fila inteira. Nada da fila existe no banco até o Salvar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileText, ChevronDown, Loader2, CheckCircle2, X, AlertTriangle, Eye, Upload,
} from 'lucide-react';

import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao from '../components/ErroAcao';
import ModalJustificativa from '../components/ModalJustificativa';
import api from '../services/api';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';

import ListaDocumentosEmitidos, { VisualizarDocumentoModal } from '../modules/documentos/Emitidos';
import CampoInput, { ListaCamposInput, preenchimentoPorCep } from '../modules/documentos/CamposForm';
import {
  carregarCampos, carregarContexto, cancelarEmitido, converterArquivoTemplate,
  criarTemplate, emitirDocumento, listarEmitidos, listarTemplates,
} from '../modules/documentos/api';
import type { ContextoDocumento } from '../modules/documentos/api';
import { contarPreenchidos } from '../modules/documentos/campos';
import type { CampoDocumento, Preenchimento } from '../modules/documentos/campos';
import type { ListaDocumento, PreenchimentoListas } from '../modules/documentos/listas';
import { categoriasDisponiveis } from '../modules/documentos/catalogo';
import { blocosDeImagens, ehPdf, paginasDoArquivo, TIPOS_ACEITOS } from '../modules/documentos/upload';
import type { Bloco, CategoriaId, DocumentoEmitido, Template } from '../modules/documentos/types';

/**
 * Só o que ESTA tela usa do paciente: identificar a linha do seletor (nome +
 * proprietário, que é o desempate de xarás) e nomear o documento.
 *
 * ⚠️ Deliberadamente estreito. A versão anterior declarava os 12 campos do
 * `AnimalCard` porque exibia o card; sem o card, manter o tipo largo prometeria um
 * contrato que a tela não consome — e o dado clínico do paciente tem casa própria em
 * `/animal/:id`.
 */
interface AnimalDoc {
  id:    number;
  nome:  string;
  user?: { fullName: string; email: string } | null;
}

/**
 * Um documento já preenchido, esperando o Salvar.
 *
 * Guarda os BLOCOS junto, não só o id do modelo: entre o Inserir e o Salvar alguém
 * pode editar o modelo em `/documentos/modelos`, e o que vai ser emitido tem de ser o
 * que o vet conferiu na tela — não a versão que o modelo tiver no momento do Salvar.
 */
interface DocumentoPendente {
  localId:      string;
  templateId:   string;
  templateNome: string;
  blocos:       Bloco[];
  valores:      Preenchimento;
  /** As linhas dos grupos repetíveis (medicamento, vacina…) daquele documento. */
  listas:       PreenchimentoListas;
  /** Só para o resumo do card: quantos campos sairão em branco. */
  emBranco:     number;
}

/** Busca sem acento e sem caixa — "atestado obito" acha "Atestado de Óbito". */
const normalizar = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CLASSE_SELECT =
  'w-full text-sm border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 bg-gray-50 text-gray-800 ' +
  'font-medium outline-none cursor-pointer appearance-none focus:border-emerald-500 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export default function Documentos() {
  const [params] = useSearchParams();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { contextoAtivo, loading: empresaLoading } = useEmpresa();

  // `documentos.templates.*` para o MODELO e `documentos.emitidos.*` para a EMISSÃO.
  // Separados de propósito: quem emite atestado no campo não precisa poder reescrever
  // o modelo da clínica.
  const podeVer    = isGestor || podeExecutar('documentos.templates.ler');
  const podeEmitir = isGestor || podeExecutar('documentos.emitidos.criar');
  // Enviar um documento que ainda nao existe CRIA um modelo da clinica — segue o slug
  // de criar modelo, nao o de emitir.
  const podeCriarModelo = isGestor || podeExecutar('documentos.templates.criar');

  // ── Dados ─────────────────────────────────────────────────────────────────
  const [animais,    setAnimais]    = useState<AnimalDoc[]>([]);
  const [templates,  setTemplates]  = useState<Template[]>([]);
  const [emitidos,   setEmitidos]   = useState<DocumentoEmitido[]>([]);
  const [contexto,   setContexto]   = useState<ContextoDocumento | null>(null);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [carregandoHist,  setCarregandoHist]  = useState(false);

  // ── Seleção ───────────────────────────────────────────────────────────────
  const [animalId,   setAnimalId]   = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string>('');

  // ── Formulário ────────────────────────────────────────────────────────────
  const [campos,   setCampos]   = useState<CampoDocumento[]>([]);
  const [valores,  setValores]  = useState<Preenchimento>({});
  // Grupos REPETÍVEIS: o descritor (rótulo, colunas, sugestão) e o que está digitado.
  // Ficam separados dos `campos` porque o valor de um grupo é uma TABELA, não um
  // texto — encaixá-lo no mesmo `Record<string,string>` obrigaria a serializar linhas
  // dentro de string, e a primeira vírgula digitada quebraria a leitura.
  const [listas,   setListas]   = useState<ListaDocumento[]>([]);
  const [valListas, setValListas] = useState<PreenchimentoListas>({});
  const [carregandoCampos, setCarregandoCampos] = useState(false);
  const [pendentes, setPendentes] = useState<DocumentoPendente[]>([]);
  const [salvando,  setSalvando]  = useState(false);
  const [previa,    setPrevia]    = useState(false);

  // ── Erros: um por SUPERFÍCIE (§6) ─────────────────────────────────────────
  // O do topo é de CARGA (não veio de clique nenhum); o do rodapé é da AÇÃO, e fica
  // abaixo do botão que a disparou — num formulário longo, erro no topo passa
  // despercebido e o clique parece não ter feito nada.
  const [erroCarga,  setErroCarga]  = useState<string | null>(null);
  const [erroAcao,   setErroAcao]   = useState<string | null>(null);
  const erroAcaoRef = useRef<HTMLDivElement>(null);

  const [cancelando, setCancelando] = useState<DocumentoEmitido | null>(null);

  // ── Combobox do documento (digitação livre) ───────────────────────────────
  const [buscaDoc,    setBuscaDoc]    = useState('');
  const [comboAberto, setComboAberto] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // ── Envio de um documento que ainda não existe ────────────────────────────
  const [envioAberto,  setEnvioAberto]  = useState(false);
  const [envioNome,    setEnvioNome]    = useState('');
  const [envioArquivo, setEnvioArquivo] = useState<File | null>(null);
  // Ligada por PADRÃO: um documento com campos é o produto; a imagem é a reserva de
  // quando a identificação não dá certo. Desligar existe para o papel que não tem
  // nada a preencher (um informativo, uma tabela de referência) e para quem prefere
  // a via digitalizada intacta.
  const [envioIdentificar, setEnvioIdentificar] = useState(true);
  const [enviando,     setEnviando]     = useState(false);
  const [envioPasso,   setEnvioPasso]   = useState('');
  const [erroEnvio,    setErroEnvio]    = useState<string | null>(null);

  const animal   = useMemo(() => animais.find(a => a.id === animalId) ?? null, [animais, animalId]);
  const template = useMemo(() => templates.find(t => t.id === templateId) ?? null, [templates, templateId]);

  // ── Carga: pacientes e modelos ────────────────────────────────────────────
  // ⚠️ Espera `empresaLoading`: nenhum fetch escopado por empresa antes de o contexto
  // estar resolvido, senão a chamada sai sem `x-empresa-id` e o backend cai no vínculo
  // mais recente — a lista da OUTRA clínica (armadilha da sessão 2026-07-28).
  useEffect(() => {
    if (empresaLoading || loadingPerms || !podeVer) return;
    let vivo = true;
    setCarregandoLista(true);
    setErroCarga(null);
    void (async () => {
      try {
        const [resAnimais, tpls] = await Promise.all([
          api.get('/animais'),
          listarTemplates(false),
        ]);
        if (!vivo) return;
        setAnimais((resAnimais.data?.dados ?? []) as AnimalDoc[]);
        setTemplates(tpls.filter(t => !t.excluido));
      } catch {
        if (vivo) setErroCarga('Não foi possível carregar os pacientes e os modelos de documento.');
      } finally {
        if (vivo) setCarregandoLista(false);
      }
    })();
    return () => { vivo = false; };
  }, [empresaLoading, loadingPerms, podeVer, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  /**
   * Paciente de entrada: SÓ o `?animalId=` da URL — é o "Emitir documento" da tela do
   * paciente, um ato explícito de quem chegou aqui por aquele paciente.
   *
   * 🔴 O campo NASCE VAZIO em qualquer outra entrada (2026-09-03, a pedido). O
   * paciente selecionado no shell (`useSelectedAnimal`) NÃO é mais adotado: ele é
   * global e persistido em localStorage, então abrir a Central de Documentos trazia
   * pré-escolhido um paciente que a pessoa não escolheu para ESTE documento — e
   * emitir documento no paciente errado é papel com valor legal saindo com o nome de
   * outro. Escolher é o primeiro passo da tela, não um padrão herdado.
   *
   * ⚠️ Ler a rota pelo ROUTER (`useSearchParams`), NUNCA por `window.location.search`:
   * o app usa `HashRouter`, então a query mora no FRAGMENTO e `location.search` é
   * sempre vazio (§14 do CLAUDE.md).
   */
  const escolherTemplateRef = useRef<((t: Template) => void) | null>(null);

  const animalIdDaUrl = Number(params.get('animalId'));

  /**
   * Documento pedido pela URL (`?templateId=`) e a prescrição que o originou
   * (`?prescricaoGrupoId=`).
   *
   * Quem chega assim veio da tela de Prescrição pedindo o RECEITUÁRIO DE CONTROLE
   * ESPECIAL de uma prescrição concreta — e é o id da prescrição que faz a tabela de
   * medicamentos nascer com os itens DAQUELA receita, não com os da mais recente.
   */
  const templateIdDaUrl = (params.get('templateId') ?? '').trim();
  const grupoDaUrl      = Number(params.get('prescricaoGrupoId'));
  const prescricaoGrupoId = Number.isInteger(grupoDaUrl) && grupoDaUrl > 0 ? grupoDaUrl : null;

  useEffect(() => {
    // ⚠️ SÓ IMPÕE, NUNCA ZERA. Um `else setAnimalId(null)` aqui parece inofensivo
    // (a tela já abre vazia), mas transforma qualquer reexecução deste efeito — uma
    // remontagem da rota, um hot-reload — em "o paciente escolhido sumiu no meio do
    // preenchimento". Quem limpa o paciente é a pessoa, no seletor.
    if (Number.isInteger(animalIdDaUrl) && animalIdDaUrl > 0) setAnimalId(animalIdDaUrl);
  }, [animalIdDaUrl]);

  // ── Contexto do paciente (variáveis resolvidas + timbre) ──────────────────
  useEffect(() => {
    if (empresaLoading || animalId == null) { setContexto(null); return; }
    let vivo = true;
    carregarContexto(animalId)
      .then(ctx => { if (vivo) setContexto(ctx); })
      .catch(() => { if (vivo) setContexto(null); });
    return () => { vivo = false; };
  }, [animalId, empresaLoading, contextoAtivo?.empresaId]);

  // ── Histórico do paciente ─────────────────────────────────────────────────
  const recarregarHistorico = useCallback(async (id: number | null) => {
    if (id == null) { setEmitidos([]); return; }
    setCarregandoHist(true);
    try {
      setEmitidos(await listarEmitidos(id));
    } catch {
      setEmitidos([]);
    } finally {
      setCarregandoHist(false);
    }
  }, []);

  useEffect(() => {
    if (empresaLoading) return;
    void recarregarHistorico(animalId);
  }, [animalId, empresaLoading, recarregarHistorico]);

  /**
   * TODOS os documentos, agrupados por categoria.
   *
   * 🔴 O seletor de documento NÃO é filtrado pelo tipo (2026-08-30, a pedido): ele
   * mostra o acervo inteiro e é a ESCOLHA DO DOCUMENTO que define o tipo, não o
   * contrário. Filtrar pelo tipo obrigava a acertar a categoria antes de achar o
   * papel — e quem procura "atestado de vacinação" sabe o nome do documento, não em
   * qual das 11 gavetas ele foi arquivado. O agrupamento por `<optgroup>` preserva a
   * organização que o filtro dava, sem esconder nada.
   *
   * Favoritos primeiro DENTRO de cada grupo, depois por nome: o acervo tem os 12
   * anexos do CFMV mais os da clínica, e ordem de criação não ajuda a achar nada.
   */
  const gruposDeModelos = useMemo(() => {
    const porCategoria = new Map<CategoriaId, Template[]>();
    for (const t of templates) {
      const lista = porCategoria.get(t.categoria) ?? [];
      lista.push(t);
      porCategoria.set(t.categoria, lista);
    }
    return categoriasDisponiveis(porCategoria.keys())
      .filter(c => porCategoria.has(c.id))
      .map(c => ({
        ...c,
        modelos: [...porCategoria.get(c.id)!].sort((a, b) =>
          (Number(b.favorito) - Number(a.favorito)) || a.nome.localeCompare(b.nome, 'pt-BR')),
      }));
  }, [templates]);

  /**
   * `?templateId=` seleciona o documento assim que o acervo chega.
   *
   * ⚠️ Depende do TAMANHO da lista, não do array: `templates` é objeto novo a cada
   * recarga, e o efeito reimporia o id da URL a cada uma — puxando a pessoa de volta
   * a este documento toda vez que ela escolhesse outro (a mesma armadilha do
   * `?templateId=` do editor).
   */
  useEffect(() => {
    if (!templateIdDaUrl || templates.length === 0) return;
    const t = templates.find(x => x.id === templateIdDaUrl);
    if (t) escolherTemplateRef.current?.(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateIdDaUrl, templates.length]);

  // ── Combobox do documento ─────────────────────────────────────────────────
  const termoDoc = buscaDoc.trim();
  /**
   * ⚠️ Enquanto o texto for o NOME do já selecionado, ele NÃO conta como busca.
   * Sem isso, reabrir o combo depois de escolher mostraria "nenhum documento com esse
   * nome" para o PRÓPRIO item escolhido — e ofereceria enviá-lo de novo. É a mesma
   * armadilha do combo de animal da Agenda (§12, 2026-08-04): quando o campo exibe um
   * RÓTULO, o filtro precisa saber disso.
   */
  const buscandoDoc = termoDoc !== '' && normalizar(termoDoc) !== normalizar(template?.nome ?? '');

  const gruposFiltrados = useMemo(() => {
    if (!buscandoDoc) return gruposDeModelos;
    const alvo = normalizar(termoDoc);
    return gruposDeModelos
      .map(g => ({ ...g, modelos: g.modelos.filter(t => normalizar(t.nome).includes(alvo)) }))
      .filter(g => g.modelos.length > 0);
  }, [gruposDeModelos, buscandoDoc, termoDoc]);

  const semResultado = buscandoDoc && gruposFiltrados.length === 0;

  const escolherTemplate = useCallback((t: Template) => {
    setTemplateId(t.id);
    setBuscaDoc(t.nome);
    setComboAberto(false);
  }, []);

  // A pré-seleção por `?templateId=` roda ANTES desta declaração no arquivo; a ref
  // evita reordenar o componente inteiro só para satisfazer a ordem de declaração.
  escolherTemplateRef.current = escolherTemplate;

  // Clique fora fecha a lista. `mousedown`, não `click`: fecha antes de o clique
  // chegar a outro controle da tela.
  useEffect(() => {
    if (!comboAberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setComboAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [comboAberto]);

  // ── Campos a preencher ────────────────────────────────────────────────────
  /**
   * "O que falta preencher para ESTE modelo e ESTE paciente."
   *
   * 🔴 Quem COLETA é o backend (`POST /documentos/campos`): decidir se um campo está
   * vazio exige saber o que as variáveis resolveram, e quem resolve é o servidor. Uma
   * segunda implementação aqui divergiria — pedindo campo já preenchido, ou deixando
   * de pedir um que vai sair em branco no papel.
   */
  useEffect(() => {
    if (animalId == null || !template) { setCampos([]); setValores({}); setListas([]); setValListas({}); return; }
    let vivo = true;
    setCarregandoCampos(true);
    setValores({});
    setValListas({});
    setErroAcao(null);
    carregarCampos({ animalId, blocos: template.blocos, evolucaoId: contexto?.evolucaoId ?? null, prescricaoGrupoId })
      .then(r => {
        if (!vivo) return;
        setCampos(r.campos ?? []);
        setListas(r.listas ?? []);
        // 🔴 É AQUI que o "já vem preenchido" acontece: as linhas sugeridas pelo
        // backend (a prescrição, as vacinas, os exames DAQUELE paciente) entram como
        // valor inicial e ficam editáveis. Sem dado registrado vem vazio, e o
        // repetidor abre com uma linha em branco.
        const iniciais: PreenchimentoListas = {};
        for (const l of r.listas ?? []) if (l.sugestao?.length) iniciais[l.chave] = l.sugestao;
        setValListas(iniciais);
      })
      .catch(() => {
        // Falhar aqui não pode travar a tela: sem a lista ainda dá para emitir com os
        // campos em branco, que é exatamente o comportamento do papel.
        if (!vivo) return;
        setCampos([]);
        setListas([]);
        setErroAcao('Não foi possível carregar os campos deste documento. Você ainda pode emitir com eles em branco.');
      })
      .finally(() => { if (vivo) setCarregandoCampos(false); });
    return () => { vivo = false; };
  }, [animalId, template, contexto?.evolucaoId, prescricaoGrupoId]);

  /**
   * Campos e LISTAS na mesma seção, na ordem da folha.
   *
   * Os dois são "o que falta preencher" para quem emite — separá-los em dois blocos
   * na tela obrigaria a pessoa a procurar os medicamentos longe do resto do documento.
   */
  const grupos = useMemo(() => {
    const mapa = new Map<string, { secao: string; campos: CampoDocumento[]; listas: ListaDocumento[] }>();
    const secao = (nome: string | null) => {
      const chave = nome ?? 'Documento';
      if (!mapa.has(chave)) mapa.set(chave, { secao: chave, campos: [], listas: [] });
      return mapa.get(chave)!;
    };
    for (const c of campos) secao(c.secao).campos.push(c);
    for (const l of listas) secao(l.secao).listas.push(l);
    return [...mapa.values()];
  }, [campos, listas]);
  const preenchidos = contarPreenchidos(campos, valores);
  const emBranco    = campos.length - preenchidos;

  const definir = useCallback((chave: string, v: string) => {
    setValores(prev => ({ ...prev, [chave]: v }));
  }, []);

  /** Erro de ação nasce no fim do formulário e pode cair fora da dobra (§6). */
  const mostrarErro = useCallback((msg: string) => {
    setErroAcao(msg);
    requestAnimationFrame(() => erroAcaoRef.current?.scrollIntoView({ block: 'nearest' }));
  }, []);

  // ── Ações ─────────────────────────────────────────────────────────────────

  /** Limpa o formulário; o paciente FICA (trocá-lo é decisão própria, no seletor). */
  const limparFormulario = useCallback(() => {
    setTemplateId('');
    // O texto do combobox anda junto com a seleção: sem isto, limpar o formulário
    // deixaria o nome do documento anterior escrito no campo, como se ele ainda
    // estivesse escolhido.
    setBuscaDoc('');
    setCampos([]);
    setValores({});
    setListas([]);
    setValListas({});
    setErroAcao(null);
  }, []);

  /**
   * Cadastra a vacina digitada no catálogo da EMPRESA e devolve a opção pronta.
   *
   * É o mesmo `POST /medicamentos/garantir` da tela de Vacina (`criarVacinaLivre`):
   * cria de verdade, com a espécie do paciente, e dali em diante ela é só mais um
   * item do catálogo — aparece na Vacina, no Orçamento e nos próximos documentos.
   * ⚠️ Nasce sem lote: fabricante, partida e validade ficam para digitar, que é o
   * correto — o sistema não sabe nada de um frasco que nunca entrou no estoque.
   */
  const criarVacinaDoCatalogo = useCallback(async (nome: string) => {
    if (animalId == null || !nome.trim()) return null;
    try {
      const res = await api.post('/medicamentos/garantir', { nome, tipo: 'vacina', animalId });
      const criado = res.data?.dados;
      if (!criado?.nome) return null;
      return { rotulo: criado.nome, valores: { 'Nome comercial da vacina': criado.nome } };
    } catch {
      mostrarErro(`Não foi possível cadastrar "${nome}" como nova vacina.`);
      return null;
    }
  }, [animalId, mostrarErro]);

  const handleCancelar = useCallback(() => {
    limparFormulario();
    setPendentes([]);
  }, [limparFormulario]);

  const handleInserir = useCallback(() => {
    if (!podeEmitir)  { mostrarErro('Sem permissão para emitir documentos.'); return; }
    if (animalId == null) { mostrarErro('Selecione o paciente.'); return; }
    if (!template)    { mostrarErro('Selecione o documento.'); return; }
    setPendentes(prev => [...prev, {
      localId:      `${template.id}-${Date.now()}`,
      templateId:   template.id,
      templateNome: template.nome,
      blocos:       template.blocos,
      valores,
      listas:       valListas,
      emBranco,
    }]);
    limparFormulario();
  }, [podeEmitir, animalId, template, valores, valListas, emBranco, limparFormulario, mostrarErro]);

  /**
   * Emite tudo: a fila do Inserir mais o que estiver no formulário agora.
   *
   * Incluir o formulário atual é deliberado — o caso comum é UM documento, e obrigar
   * a clicar em Inserir antes do Salvar faria o Salvar sozinho não fazer nada, que é
   * o pior tipo de botão.
   */
  const handleSalvar = useCallback(async () => {
    if (!podeEmitir)      { mostrarErro('Sem permissão para emitir documentos.'); return; }
    if (animalId == null) { mostrarErro('Selecione o paciente antes de salvar.'); return; }

    const fila: DocumentoPendente[] = [...pendentes];
    if (template) {
      fila.push({
        // Id único, não um `'atual'` fixo: se a emissão falhar, este item VOLTA para a
        // fila, e um segundo Salvar com outro documento no formulário produziria duas
        // linhas com a mesma chave de lista.
        localId: `atual-${Date.now()}`,
        templateId: template.id, templateNome: template.nome,
        blocos: template.blocos, valores, listas: valListas, emBranco,
      });
    }
    if (fila.length === 0) { mostrarErro('Selecione um documento para emitir.'); return; }

    // O que está no formulário passa a viver na FILA antes de começar a emitir, e o
    // formulário é esvaziado. Sem isso, uma falha no meio devolveria o mesmo documento
    // aos dois lugares — de volta à fila E ainda selecionado na tela — e o Salvar
    // seguinte o emitiria duas vezes.
    setPendentes(fila);
    limparFormulario();

    setSalvando(true);
    setErroAcao(null);
    const emitidosAgora: DocumentoEmitido[] = [];
    try {
      // Sequencial, não `Promise.all`: a numeração `DOC-0001` é uma sequência POR
      // EMPRESA sorteada dentro da transaction da emissão — disparar em paralelo põe
      // duas transações competindo pelo mesmo número.
      for (const p of fila) {
        emitidosAgora.push(await emitirDocumento({
          animalId,
          templateId:    p.templateId,
          templateNome:  p.templateNome,
          blocos:        p.blocos,
          evolucaoId:    contexto?.evolucaoId ?? null,
          preenchimento: p.valores,
          listas:        p.listas,
        }));
      }
      setPendentes([]);
      await recarregarHistorico(animalId);
      toast.success(emitidosAgora.length === 1
        ? `${emitidosAgora[0].numeroFmt ?? 'Documento'} emitido para ${emitidosAgora[0].animalNome}`
        : `${emitidosAgora.length} documentos emitidos`);
    } catch {
      // Emissão é uma por uma: o que já saiu ESTÁ emitido e tem número. Dizer isso é
      // o que evita o vet reemitir tudo e duplicar os documentos que deram certo.
      const jaEmitidos = emitidosAgora.length;
      setPendentes(fila.slice(jaEmitidos));
      await recarregarHistorico(animalId);
      mostrarErro(jaEmitidos > 0
        ? `${jaEmitidos} documento(s) foram emitidos; o seguinte falhou. Os que faltam continuam na lista abaixo.`
        : 'Não foi possível emitir o documento.');
    } finally {
      setSalvando(false);
    }
  }, [podeEmitir, animalId, pendentes, template, valores, valListas, emBranco, contexto?.evolucaoId,
      limparFormulario, recarregarHistorico, mostrarErro]);

  /** Abre o envio já com o nome que a pessoa digitou e não encontrou. */
  const abrirEnvio = useCallback(() => {
    setEnvioNome(termoDoc);
    setEnvioArquivo(null);
    setEnvioIdentificar(true);
    setEnvioPasso('');
    setErroEnvio(null);
    setComboAberto(false);
    setEnvioAberto(true);
  }, [termoDoc]);

  /**
   * Envia o documento e o deixa PRONTO PARA USO — selecionado na tela, com os campos
   * já carregados.
   *
   * DOIS CAMINHOS, escolhidos pelo "Identificar os campos automaticamente":
   *   COM  → as páginas vão para a IA, que devolve BLOCOS de verdade — `{{variáveis}}`
   *          no que o sistema já sabe e `[[lacunas]]` no que ele não sabe. O documento
   *          nasce sabendo se preencher e sabendo o que perguntar.
   *   SEM  → o arquivo vira blocos `imagem`, uma por página. É a reserva, e é para
   *          onde a falha da IA cai: perder o envio por causa de um erro do modelo
   *          seria trocar um documento sem campos por documento nenhum.
   *
   * "Seguir as mesmas regras de todos os documentos" continua literal nos dois: a
   * partir daqui ele é um modelo como qualquer outro, e nenhum caminho a jusante
   * (preview, emissão, snapshot, impressão, WhatsApp/e-mail, histórico) tem uma linha
   * de exceção para ele.
   *
   * MULTI-TENANT/RLS: nada de `empresaId` sai daqui. O modelo é criado por
   * `POST /documentos/templates`, que carimba `req.empresaId` do CONTEXTO e ignora o
   * corpo; as imagens sobem com o mesmo contexto de dono, e é ele que faz
   * `GET /api/midia/:chave` recusar o byte para outra clínica.
   */
  const confirmarEnvio = useCallback(async () => {
    const nome = envioNome.trim();
    if (!nome)         { setErroEnvio('Informe o nome do documento.'); return; }
    if (!envioArquivo) { setErroEnvio('Escolha o arquivo do documento.'); return; }

    setEnviando(true);
    setErroEnvio(null);
    try {
      setEnvioPasso(ehPdf(envioArquivo) ? 'Lendo as páginas…' : 'Preparando a imagem…');
      const { paginas, texto } = await paginasDoArquivo(envioArquivo);

      let blocos: Bloco[] | null = null;
      if (envioIdentificar) {
        setEnvioPasso('Identificando os campos…');
        // Falha da IA NÃO interrompe o envio: cai no caminho da imagem, que é o
        // comportamento de sempre. Perder o arquivo por causa de um 500 do modelo
        // seria trocar um documento sem campos por documento nenhum.
        const r = await converterArquivoTemplate({ paginas, texto, nome });
        if (r.ehDocumento && r.blocos.length > 0) blocos = r.blocos;
        if (!blocos) {
          // ⚠️ O MOTIVO É PARTE DA MENSAGEM. Sem ele, "sem permissão", "rota ausente
          // no servidor", "IA fora do ar" e "isto não é um documento" viram a mesma
          // frase, e quem está usando não tem o que fazer com ela — nem quem for
          // depurar depois.
          toast(
            r.motivo
              ? `Não deu para identificar os campos: ${r.motivo} O documento foi enviado como imagem.`
              : 'Não deu para identificar os campos — o documento foi enviado como imagem.',
            { duration: 8000 },
          );
        }
      }

      if (!blocos) {
        setEnvioPasso('Enviando…');
        blocos = await blocosDeImagens(paginas, envioArquivo.name, (feito, total) => {
          setEnvioPasso(total > 1 ? `Enviando página ${feito} de ${total}…` : 'Enviando…');
        });
      }

      setEnvioPasso('Criando o documento…');
      const t = await criarTemplate({
        // Sem `categoria`: o campo saiu da tela (2026-09-03) e o backend NÃO exige o
        // campo — ausente, a coluna cai no default `personalizados`. Mandar string
        // vazia não serviria: `saneia` ignora vazio de propósito, para um corpo em
        // branco não apagar a categoria de um modelo que já tem uma.
        nome, blocos,
        descricao: '', especie: 'AMBOS',
        // PUBLICADO, não RASCUNHO: ele já está pronto para emitir — o conteúdo é o
        // arquivo enviado, não há nada a montar depois.
        status: 'PUBLICADO',
      });

      setTemplates(prev => [t, ...prev]);
      escolherTemplate(t);          // já deixa selecionado: o próximo passo é emitir
      setEnvioAberto(false);
      toast.success(`"${t.nome}" adicionado aos documentos.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setErroEnvio(msg || 'Não foi possível enviar o documento.');
    } finally {
      setEnviando(false);
      setEnvioPasso('');
    }
  }, [envioNome, envioArquivo, envioIdentificar, escolherTemplate]);

  const confirmarCancelamento = useCallback(async (motivo: string) => {
    if (!cancelando) return;
    try {
      await cancelarEmitido(cancelando.id, motivo);
      await recarregarHistorico(animalId);
      toast.success('Documento cancelado');
    } catch {
      toast.error('Não foi possível cancelar o documento.');
    } finally {
      setCancelando(null);
    }
  }, [cancelando, animalId, recarregarHistorico]);

  /** A folha como ela vai sair, montada a partir do que está preenchido AGORA. */
  const documentoDaPrevia = useMemo((): DocumentoEmitido | null => {
    if (!template || !contexto) return null;
    return {
      id: 'previa', templateId: template.id, templateNome: template.nome,
      numero: null, numeroFmt: null, titulo: template.nome,
      animalId: animalId ?? 0, animalNome: animal?.nome ?? '',
      clienteNome: animal?.user?.fullName ?? '',
      evolucaoId: contexto.evolucaoId, emitidoEm: '', emitidoPor: '',
      ativo: true, canceladoMotivo: null,
      blocos: template.blocos, contexto: contexto.variaveis, marca: contexto.marca,
    };
  }, [template, contexto, animalId, animal]);

  // ── Guard de acesso ───────────────────────────────────────────────────────
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

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-6" />

      <InlineError message={erroCarga} className="mb-4" />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <FileText size={20} className="text-emerald-700" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Central de Documentos</h1>
          <p className="text-sm text-gray-500">
            Modelos oficiais do CFMV · emissão e histórico por paciente
          </p>
        </div>
      </div>

      {/* ── 1. Paciente · Documento · Tipo, numa linha ─────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Paciente</label>
            <div className="relative">
              <select
                value={animalId ?? ''}
                onChange={e => setAnimalId(e.target.value ? Number(e.target.value) : null)}
                disabled={carregandoLista}
                className={CLASSE_SELECT}
              >
                <option value="">
                  {carregandoLista ? 'Carregando…' : 'Selecione o paciente'}
                </option>
                {animais.map(a => (
                  // Só o NOME do paciente (a pedido, 2026-09-01): o `<option>`
                  // concatenava o proprietário e a linha ficava longa demais para o
                  // campo. O proprietário segue visível no cabeçalho da folha e no
                  // histórico logo abaixo.
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* NOME DO DOCUMENTO: é ele que a pessoa procura — não a gaveta em que o
              papel foi arquivado.
              É COMBOBOX, não `<select>`: dá para DIGITAR, e o que não existe no acervo
              vira o atalho de enviar o documento. */}
          <div className="flex flex-col gap-1" ref={comboRef}>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Nome do Documento</label>
            <div className="relative">
              <input
                type="text"
                value={buscaDoc}
                onChange={e => { setBuscaDoc(e.target.value); setComboAberto(true); }}
                onFocus={e => { setComboAberto(true); e.target.select(); }}
                // Combobox com seleção por `onMouseDown` NUNCA perde o foco, e `focus`
                // não dispara de novo num campo já focado — sem o `onClick` a lista
                // não reabriria depois da primeira escolha (armadilha do combo da
                // Agenda, §12 de 2026-08-04).
                onClick={() => setComboAberto(true)}
                disabled={carregandoLista}
                // Sem texto de dica (a pedido, 2026-09-01): o campo nasce EM BRANCO,
                // para ser selecionado. Só o estado de carga escreve algo — ali o
                // campo está desabilitado e o vazio pareceria acervo vazio.
                placeholder={carregandoLista ? 'Carregando…' : ''}
                className="w-full text-sm border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 bg-gray-50 text-gray-800 font-medium outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              <ChevronDown size={13} className="absolute right-3 top-3.5 text-gray-400 pointer-events-none" />

              {comboAberto && !carregandoLista && (
                <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
                  {gruposFiltrados.map(g => (
                    <div key={String(g.id)}>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {g.rotulo}
                      </p>
                      {g.modelos.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          // `onMouseDown` + `preventDefault`: com `onClick`, o blur do
                          // input fecharia a lista antes de o clique chegar.
                          onMouseDown={e => { e.preventDefault(); escolherTemplate(t); }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            t.id === templateId ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {t.favorito ? '★ ' : ''}{t.nome}
                          {t.global && <span className="ml-1 text-[10px] text-gray-400">(CFMV)</span>}
                        </button>
                      ))}
                    </div>
                  ))}

                  {/* 🔴 O DOCUMENTO QUE NÃO EXISTE vira o atalho de enviá-lo. É o que
                      transforma "não achei" em "cadastre agora", em vez de deixar a
                      pessoa sem saída no meio do atendimento. */}
                  {termoDoc !== '' && semResultado && (
                    podeCriarModelo ? (
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); abrirEnvio(); }}
                        className="w-full flex items-start gap-2 px-3 py-2.5 text-left border-t border-gray-100 hover:bg-emerald-50 transition-colors"
                      >
                        <Upload size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-emerald-800 truncate">
                            Enviar “{termoDoc}”
                          </span>
                          <span className="block text-[11px] text-gray-500">
                            Nenhum documento com esse nome — envie o arquivo para cadastrá-lo
                          </span>
                        </span>
                      </button>
                    ) : (
                      <p className="px-3 py-2.5 text-xs text-gray-400 border-t border-gray-100">
                        Nenhum documento com esse nome.
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ⚠️ NÃO reintroduzir o campo "Tipo de Documento" — REMOVIDO a pedido em
              2026-09-03. Ele era de LEITURA (a escolha do documento é que o
              preenchia), então não decidia nada na emissão: repetia, num campo
              próprio, a gaveta em que o modelo foi arquivado. A classificação do
              modelo continua existindo e é editada em /documentos/modelos. */}
        </div>

      </div>

      {/* ⚠️ NÃO reintroduzir aqui o `SeletorAnimalInteligente` nem o `AnimalCard`
          (removidos a pedido, 2026-08-30): o paciente já é escolhido no campo acima, e
          o segundo seletor + o card empurravam para baixo o formulário, que é o que a
          tela veio resolver. */}

      {/* ── 2. Campos a preencher, em largura cheia ────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {template ? template.nome : 'Preenchimento do documento'}
          </p>
          {campos.length > 0 && (
            <span className="text-[11px] font-semibold text-gray-500 tabular-nums">
              {preenchidos} de {campos.length}
            </span>
          )}
          {template && contexto && (
            <button
              onClick={() => setPrevia(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              <Eye size={13} /> Pré-visualizar
            </button>
          )}
        </div>

        <div className="p-4">
          {animalId == null || !template ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText size={30} className="text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">
                {animalId == null
                  ? 'Selecione o paciente e o documento acima.'
                  : 'Selecione o documento acima para ver o que precisa ser preenchido.'}
              </p>
            </div>
          ) : carregandoCampos ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-emerald-600" />
            </div>
          ) : campos.length === 0 && listas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 size={26} className="text-emerald-400 mb-3" />
              <p className="text-sm font-semibold text-gray-700">Nada a preencher</p>
              <p className="text-xs text-gray-400 mt-1">
                O cadastro de {animal?.nome} já cobre todos os campos deste documento.
              </p>
            </div>
          ) : (
            grupos.map(g => (
              <div key={g.secao} className="mb-5 last:mb-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  {g.secao}
                </p>
                {/* Largura cheia: os campos ocupam a tela inteira em colunas, em vez do
                    painel estreito que a versão em modal tinha. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.campos.map(campo => (
                    <div key={campo.chave} className={campo.multilinha ? 'sm:col-span-2 lg:col-span-3' : ''}>
                      <CampoInput
                        campo={campo}
                        valor={valores[campo.chave] ?? ''}
                        onChange={v => definir(campo.chave, v)}
                        // Digitou o CEP, o endereço vem junto — a mesma conveniência
                        // da tela de Proprietário. Quem decide QUAIS campos o CEP
                        // preenche é `preenchimentoPorCep`, pelos rótulos que ESTE
                        // documento pede.
                        onEnderecoDoCep={dados =>
                          setValores(prev => ({ ...prev, ...preenchimentoPorCep(campos, dados) }))}
                      />
                    </div>
                  ))}
                  {/* Grupos REPETÍVEIS (medicamento, vacina, exame…): ocupam a linha
                      inteira do grid — uma tabela espremida em 1/3 da largura não
                      serve para conferir posologia. */}
                  {g.listas.map(lista => (
                    <ListaCamposInput
                      key={lista.chave}
                      lista={lista}
                      linhas={valListas[lista.chave] ?? []}
                      onChange={linhas => setValListas(prev => ({ ...prev, [lista.chave]: linhas }))}
                      // Vacina que não existe no catálogo é CADASTRADA aqui mesmo,
                      // igual à tela de Vacina — ver `criarVacinaDoCatalogo`.
                      onCriarOpcao={lista.fonteOpcoes === 'empresa.vacinas' ? criarVacinaDoCatalogo : undefined}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Fila do Inserir */}
        {pendentes.length > 0 && (
          <div className="px-4 py-3 border-t border-amber-100 bg-amber-50/40">
            <div className="flex items-center justify-between mb-2">
              <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                {pendentes.length} documento{pendentes.length !== 1 ? 's' : ''} inserido{pendentes.length !== 1 ? 's' : ''} — clique em Salvar para emitir
              </span>
              <button
                onClick={() => setPendentes([])}
                className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors"
              >
                Limpar
              </button>
            </div>
            <div className="space-y-2">
              {pendentes.map(p => (
                <div key={p.localId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-amber-100">
                  <FileText size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-gray-800 font-medium truncate flex-1">{p.templateNome}</span>
                  {p.emBranco > 0 && (
                    <span className="text-[10px] text-amber-700 flex-shrink-0">
                      {p.emBranco} em branco
                    </span>
                  )}
                  <button
                    onClick={() => setPendentes(prev => prev.filter(x => x.localId !== p.localId))}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                    aria-label={`Remover ${p.templateNome}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rodapé: Cancelar · Inserir · Salvar — o mesmo par de `/clinica/exames/:id` */}
        <div className="px-4 py-3 border-t border-gray-100">
          {/* Erro da AÇÃO fica ABAIXO do formulário e ACIMA dos botões que o dispararam. */}
          <div ref={erroAcaoRef}>
            <ErroAcao erro={erroAcao ? { mensagem: erroAcao } : null} className="mb-3" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Aviso, nunca bloqueio: o papel sempre teve linha para preencher à mão. */}
            {emBranco > 0 && campos.length > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700 min-w-0">
                <AlertTriangle size={13} className="flex-shrink-0" />
                <span className="truncate">
                  {emBranco} {emBranco === 1 ? 'campo sairá em branco' : 'campos sairão em branco'} no documento
                </span>
              </p>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={handleCancelar}
                disabled={salvando}
                className="px-5 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleInserir}
                disabled={salvando || !podeEmitir || animalId == null || !template}
                className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Inserir
              </button>
              <button
                onClick={() => void handleSalvar()}
                disabled={salvando || !podeEmitir || animalId == null || (pendentes.length === 0 && !template)}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {salvando ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Histórico ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Histórico de Documentos{animal ? ` — ${animal.nome}` : ''}
          </p>
          <span className="text-xs text-gray-400">
            {emitidos.length} documento{emitidos.length !== 1 ? 's' : ''}
          </span>
        </div>
        <ListaDocumentosEmitidos
          documentos={emitidos}
          carregando={carregandoHist}
          podeCancelar={podeEmitir}
          onCancelar={setCancelando}
          vazio={animalId == null
            ? 'Selecione o paciente para ver os documentos já emitidos'
            : 'Nenhum documento emitido para este paciente'}
        />
      </div>

      {/* Pré-visualização: os blocos ainda são os do MODELO, então o contexto do
          paciente e o que está digitado são resolvidos NA TELA. Quem resolve o que
          fica GRAVADO continua sendo o backend, na emissão. */}
      {previa && documentoDaPrevia && (
        <VisualizarDocumentoModal
          doc={documentoDaPrevia}
          contexto={contexto?.variaveis ?? null}
          preenchimento={valores}
          listas={valListas}
          titulo={`Pré-visualização · ${animal?.nome ?? ''}`}
          onFechar={() => setPrevia(false)}
        />
      )}

      {/* ── Enviar um documento que ainda não existe ─────────────────────────
          O arquivo vira os BLOCOS do modelo: com a identificação ligada, blocos de
          texto/tabela com variáveis e campos; sem ela, uma imagem por página (PDF é
          convertido no navegador — ver modules/documentos/upload.ts). A partir daí ele
          é um documento como qualquer outro: mesma emissão, mesmo snapshot, mesma
          impressão, mesmo envio por WhatsApp/e-mail e mesmo histórico. */}
      {envioAberto && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <header className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Upload size={17} className="text-emerald-700" />
              </div>
              <h2 className="font-bold text-gray-900 text-base flex-1">Enviar documento</h2>
              <button onClick={() => setEnvioAberto(false)} disabled={enviando}
                className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label="Fechar">
                <X size={18} />
              </button>
            </header>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome do documento</label>
                <input
                  value={envioNome}
                  onChange={e => setEnvioNome(e.target.value)}
                  placeholder="Ex.: Termo de responsabilidade"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Arquivo</label>
                <input
                  type="file"
                  accept={TIPOS_ACEITOS}
                  onChange={e => { setEnvioArquivo(e.target.files?.[0] ?? null); setErroEnvio(null); }}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                  PDF ou imagem (JPG, PNG, WEBP), até 15 MB.
                  {envioArquivo && ehPdf(envioArquivo) && !envioIdentificar
                    && ' Cada página do PDF vira uma página do documento.'}
                </p>
              </div>

              {/* A opção que separa "modelo de verdade" de "fotografia do papel".
                  Ligada, a IA lê o arquivo e marca o que é dado do paciente (preenchido
                  sozinho na emissão) e o que é campo em branco (vira formulário).
                  Desligada — ou quando a leitura falha — o documento entra como imagem,
                  que é o comportamento que sempre existiu. */}
              <label className="flex gap-2.5 items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={envioIdentificar}
                  onChange={e => setEnvioIdentificar(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-gray-700">
                    Identificar os campos automaticamente
                  </span>
                  <span className="block text-[11px] text-gray-400 leading-relaxed mt-0.5">
                    Os dados do paciente, do proprietário e do veterinário passam a ser
                    preenchidos pelo sistema; o que ele não tem vira campo para preencher
                    na hora de emitir. Sem isso, o arquivo entra como imagem.
                  </span>
                </span>
              </label>
            </div>

            <footer className="px-5 py-3 border-t border-gray-100">
              <ErroAcao erro={erroEnvio ? { mensagem: erroEnvio } : null} className="mb-3" />
              <div className="flex items-center gap-3">
                {/* Converter e subir um PDF de várias páginas leva segundos; sem sinal
                    de vida a pessoa clica de novo e sobe tudo duas vezes. */}
                {enviando && envioPasso && (
                  <p className="text-[11px] text-gray-500 truncate">{envioPasso}</p>
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => setEnvioAberto(false)}
                    disabled={enviando}
                    className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void confirmarEnvio()}
                    disabled={enviando}
                    className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {enviando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    Enviar
                  </button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      )}

      <ModalJustificativa
        aberto={!!cancelando}
        titulo="Cancelar documento"
        descricao={cancelando
          ? `O documento ${cancelando.numeroFmt ?? ''} ficará marcado como cancelado no prontuário do paciente.`
          : ''}
        acaoLabel="Cancelar documento"
        onConfirmar={(motivo) => { void confirmarCancelamento(motivo); }}
        onFechar={() => setCancelando(null)}
      />
    </PageContainer>
  );
}
