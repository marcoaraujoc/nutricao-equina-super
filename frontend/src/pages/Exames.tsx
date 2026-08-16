import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import InlineError from '../components/InlineError';
import {
  Eye, Calendar, Edit, Trash2, Microscope, ClipboardList, Scan, X, ChevronLeft, ChevronRight, ExternalLink,
  Loader2, Printer, MessageCircle, Mail, Maximize2, Minimize2, ChevronDown, Check, FileX,
} from 'lucide-react';
import AnimalCard from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import SeletorAnimal from '../components/SeletorAnimal';
import PageContainer from '../components/PageContainer';
import { formatDate } from '../utils/dateUtils';
import DateInputBR from '../components/DateInputBR';
import ModalJustificativa from '../components/ModalJustificativa';
import ConfirmModal from '../components/ConfirmModal';
import ExamesSolicitadosPanel, { ResultadoModal, type ExameSolicitado, type ItemManual } from '../components/ExamesSolicitadosPanel';
import LaudoTexto from '../components/LaudoTexto';
import { temResultadoExame } from '../utils/exameClinico';
import { imprimirResultadoExame, textoResultadoExame } from '../utils/ResultadoExamePrint';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';

interface ArquivoNavegavel { nome: string; arquivoUrl: string }

/** Lista navegável dos arquivos de um exame CLÍNICO — `imagens` já traz TODOS os
 *  arquivos anexados (inclusive o "principal", ver CLAUDE.md). `arquivoUrl` sozinho
 *  só sobra em exame REALIZADO antes deste recurso existir (sem anexo próprio). */
function arquivosDoExameClinico(ex: ExameSolicitado): ArquivoNavegavel[] {
  if (ex.imagens && ex.imagens.length > 0) {
    return ex.imagens.map(img => ({ nome: img.nome ?? 'Arquivo', arquivoUrl: img.arquivoUrl }));
  }
  if (ex.arquivoUrl) return [{ nome: 'Laudo', arquivoUrl: ex.arquivoUrl }];
  return [];
}

// ─── Visualizador de arquivos — navega entre TODOS os arquivos do mesmo exame ──
// sem fechar/reabrir aba a aba. PDF entra num iframe; foto do exame numa <img>.
// Qualquer outro formato (DOCX, DOC, TXT...) não tem pré-visualização no navegador
// — antes disso era tratado como imagem por padrão (`else` do ternário), e o
// <img> ficava para sempre "carregando": um DOCX não é uma imagem válida, o
// navegador nunca dispara `onLoad`, e a tela parecia travada/lenta (na prática
// nunca terminava). Setas do teclado e clique navegam igual.
function ehArquivoPdf(a: ArquivoNavegavel): boolean {
  return /\.pdf(\?|$)/i.test(a.nome || a.arquivoUrl);
}
function ehArquivoImagem(a: ArquivoNavegavel): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg|avif)(\?|$)/i.test(a.nome || a.arquivoUrl);
}
// DOCX tem pré-visualização própria: o backend converte para HTML sob demanda
// (GET /api/midia/:chave/preview, via mammoth — mesma lib já usada para extrair
// texto do laudo) e o front renderiza esse HTML num <iframe sandbox>, sem baixar
// o arquivo nem sair da aplicação.
function ehArquivoDocx(a: ArquivoNavegavel): boolean {
  return /\.docx(\?|$)/i.test(a.nome || a.arquivoUrl);
}
function htmlDocxPreview(corpo: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #111827; line-height: 1.6; padding: 28px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    td, th { border: 1px solid #d1d5db; padding: 6px 10px; }
    img { max-width: 100%; }
    p { margin: 0 0 8px; }
  </style></head><body>${corpo}</body></html>`;
}

function VisualizadorArquivos({ arquivos, indice, onNavegar, onFechar }: {
  arquivos:  ArquivoNavegavel[];
  indice:    number;
  onNavegar: (novoIndice: number) => void;
  onFechar:  () => void;
}) {
  const atual = arquivos[indice];
  const temAnterior = indice > 0;
  const temProximo   = indice < arquivos.length - 1;
  // Enquanto a imagem NOVA carrega, o <img> antigo continua renderizado por padrão do
  // navegador — parecia "travado na primeira imagem". Um spinner por cima deixa claro
  // que está carregando, e o pré-carregamento do vizinho evita a espera na próxima vez.
  const [carregando, setCarregando] = useState(true);
  // Existe / está autorizado? Checado ANTES de sequer apontar o <iframe>/<img>
  // pra URL — sem isto, arquivo ausente aparecia como "localhost recusou a
  // conexão" (a tela nativa de erro do navegador, dentro da caixa do
  // visualizador): o <iframe> não tem evento de erro HTTP utilizável, então um
  // PDF quebrado ficava mudo sobre o motivo. O HEAD passa pela MESMA rota
  // autorizada (`/api/midia/:chave`) e pelo interceptor do axios — 404/403 vira
  // mensagem da aplicação, não página de erro do navegador.
  const [verificando, setVerificando] = useState(true);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  // Pré-visualização de DOCX (HTML gerado pelo backend) — carregada à parte da
  // checagem de existência acima, só depois dela confirmar que o arquivo existe.
  const [carregandoDocx, setCarregandoDocx] = useState(false);
  const [docxHtml,       setDocxHtml]       = useState<string | null>(null);
  const [erroDocx,       setErroDocx]       = useState<string | null>(null);

  useEffect(() => {
    setVerificando(true);
    setCarregando(true);
    setErroArquivo(null);
    let cancelado = false;
    // `api` já tem baseURL '/api' — `arquivoUrl` vem do backend como
    // '/api/midia/<chave>' (ver DbStorageProvider), então passá-lo direto
    // duplicava o prefixo ('/api/api/midia/...') e o HEAD sempre voltava 404,
    // mesmo com o arquivo existindo (a <img>/<iframe> abaixo, que usa a URL
    // direto sem passar pelo axios, sempre funcionou).
    api.head(atual.arquivoUrl.replace(/^\/api(?=\/)/, ''))
      .catch((err: unknown) => {
        if (cancelado) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        setErroArquivo(
          status === 404 ? 'Arquivo não encontrado — pode ter sido removido.'
            : status === 403 ? 'Sem permissão para ver este arquivo.'
            : 'Não foi possível carregar o arquivo.'
        );
      })
      .finally(() => { if (!cancelado) setVerificando(false); });
    return () => { cancelado = true; };
  }, [indice, atual?.arquivoUrl]);

  useEffect(() => {
    setDocxHtml(null);
    setErroDocx(null);
    if (verificando || erroArquivo || !ehArquivoDocx(atual)) return;
    let cancelado = false;
    setCarregandoDocx(true);
    api.get(`${atual.arquivoUrl.replace(/^\/api(?=\/)/, '')}/preview`)
      .then(res => { if (!cancelado) setDocxHtml(res.data?.dados?.html ?? ''); })
      .catch(() => { if (!cancelado) setErroDocx('Não foi possível gerar a pré-visualização deste arquivo.'); })
      .finally(() => { if (!cancelado) setCarregandoDocx(false); });
    return () => { cancelado = true; };
  }, [indice, atual?.arquivoUrl, verificando, erroArquivo]);

  useEffect(() => {
    [indice - 1, indice + 1].forEach(i => {
      const viz = arquivos[i];
      if (viz && ehArquivoImagem(viz)) {
        const preload = new Image();
        preload.src = viz.arquivoUrl;
      }
    });
  }, [indice, arquivos]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowLeft'  && indice > 0) onNavegar(indice - 1);
      if (e.key === 'ArrowRight' && indice < arquivos.length - 1) onNavegar(indice + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [indice, arquivos.length, onNavegar, onFechar]);

  if (!atual) return null;
  const ehPdf    = ehArquivoPdf(atual);
  const ehImagem = ehArquivoImagem(atual);

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">{atual.nome}</span>
          {arquivos.length > 1 && (
            <span className="text-xs text-white/60 flex-shrink-0">{indice + 1} / {arquivos.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!erroArquivo && (
            <a href={atual.arquivoUrl} target="_blank" rel="noreferrer" title="Abrir em nova aba" aria-label="Abrir em nova aba"
              className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
              <ExternalLink size={18} />
            </a>
          )}
          <button onClick={onFechar} title="Fechar" aria-label="Fechar"
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center px-4 pb-4">
        {temAnterior && (
          <button onClick={() => onNavegar(indice - 1)} title="Arquivo anterior" aria-label="Arquivo anterior"
            className="absolute left-2 md:left-4 z-10 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors">
            <ChevronLeft size={24} />
          </button>
        )}
        {verificando ? (
          <div className="flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white/80" />
          </div>
        ) : erroArquivo ? (
          <div className="flex flex-col items-center gap-2 text-white/80 text-sm text-center max-w-xs">
            <FileX size={40} className="text-white/40" />
            {erroArquivo}
          </div>
        ) : ehPdf ? (
          <iframe src={atual.arquivoUrl} title={atual.nome} className="w-full h-full bg-white rounded-lg border-0" />
        ) : ehImagem ? (
          <>
            {carregando && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Loader2 size={32} className="animate-spin text-white/80" />
              </div>
            )}
            <img key={atual.arquivoUrl} src={atual.arquivoUrl} alt={atual.nome} onLoad={() => setCarregando(false)}
              onError={() => { setCarregando(false); setErroArquivo('Não foi possível exibir este arquivo.'); }}
              className={`max-w-full max-h-full object-contain rounded-lg transition-opacity ${carregando ? 'opacity-0' : 'opacity-100'}`} />
          </>
        ) : ehArquivoDocx(atual) ? (
          carregandoDocx ? (
            <div className="flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white/80" />
            </div>
          ) : erroDocx || docxHtml == null ? (
            <div className="flex flex-col items-center gap-3 text-white/80 text-sm text-center max-w-xs">
              <FileX size={40} className="text-white/40" />
              <span>{erroDocx ?? 'Não foi possível gerar a pré-visualização deste arquivo.'}</span>
              <a href={atual.arquivoUrl} target="_blank" rel="noreferrer"
                className="px-3 py-1.5 border border-white/30 rounded-lg text-white hover:bg-white/10 transition-colors">
                Abrir arquivo
              </a>
            </div>
          ) : (
            // sandbox SEM `allow-scripts`: o HTML é do documento do usuário — não
            // roda nenhum script, mesmo que o DOCX tenha algo malicioso embutido.
            <iframe sandbox="" title={atual.nome} srcDoc={htmlDocxPreview(docxHtml)}
              className="w-full h-full bg-white rounded-lg border-0" />
          )
        ) : (
          // DOC, TXT... — sem pré-visualização no navegador. O arquivo continua
          // acessível pelo "Abrir em nova aba" no cabeçalho, que faz o download/
          // abre com o app associado do usuário.
          <div className="flex flex-col items-center gap-3 text-white/80 text-sm text-center max-w-xs">
            <FileX size={40} className="text-white/40" />
            <span>Pré-visualização não disponível para este tipo de arquivo.</span>
            <a href={atual.arquivoUrl} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 border border-white/30 rounded-lg text-white hover:bg-white/10 transition-colors">
              Abrir arquivo
            </a>
          </div>
        )}
        {temProximo && (
          <button onClick={() => onNavegar(indice + 1)} title="Próximo arquivo" aria-label="Próximo arquivo"
            className="absolute right-2 md:right-4 z-10 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors">
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {arquivos.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-4 flex-shrink-0">
          {arquivos.map((a, i) => (
            <button key={i} onClick={() => onNavegar(i)} title={a.nome}
              className={`w-2 h-2 rounded-full transition-colors ${i === indice ? 'bg-white' : 'bg-white/30 hover:bg-white/50'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Combobox de busca de exame — MESMA lógica do combobox "Buscar em <grupo>" do
// Pedido de Exames (/clinica/exames/:animalId): campo que vira input ao clicar, lista
// filtrada em tempo real, X para limpar, chevron indicando aberto/fechado. Diferença:
// aqui é SELEÇÃO ÚNICA (filtro), não múltipla, e a lista é dinâmica — os nomes vêm do
// que está POPULADO no card "Resultados do Exame" (nutricional + clínico), não de um
// catálogo fixo.
function ExameBuscaCombo({ value, onChange, opcoes }: {
  value:   string;
  onChange: (v: string) => void;
  opcoes:  string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [busca,  setBusca]  = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClickFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  const abrir = () => { setBusca(''); setAberto(true); setTimeout(() => inputRef.current?.focus(), 0); };

  const visiveis = busca.trim()
    ? opcoes.filter(o => o.toLowerCase().includes(busca.toLowerCase()))
    : opcoes;

  const selecionar = (nome: string) => { onChange(nome); setAberto(false); };

  return (
    <div className="relative w-56" ref={ref}>
      {aberto ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border border-emerald-400 rounded-xl bg-white">
          <input ref={inputRef} type="text" value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar exame..."
            className="flex-1 min-w-0 text-sm text-gray-900 outline-none placeholder:text-gray-400" />
          {busca && (
            <button type="button" onMouseDown={e => { e.preventDefault(); setBusca(''); inputRef.current?.focus(); }}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X size={12} />
            </button>
          )}
          <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
        </div>
      ) : (
        <button type="button" onClick={abrir}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-emerald-400 transition-colors">
          <span className={`truncate text-left ${value ? 'text-gray-900' : 'text-gray-400'}`}>
            {value || 'Buscar ou selecionar exame...'}
          </span>
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        </button>
      )}

      {aberto && (
        <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
          {value && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => selecionar('')}
              className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 border-b border-gray-50">
              <X size={11} /> Limpar seleção
            </button>
          )}
          {visiveis.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-4 py-3">Nenhum exame encontrado</p>
          ) : visiveis.map(nome => {
            const selecionado = nome === value;
            return (
              <button key={nome} type="button" onMouseDown={e => e.preventDefault()} onClick={() => selecionar(nome)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${selecionado ? 'bg-emerald-50/60 text-emerald-800 font-medium' : 'text-gray-700'}`}>
                {selecionado && <Check size={12} className="text-emerald-600 flex-shrink-0" />}
                <span className="truncate">{nome}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const Exames = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();
  const [searchParams] = useSearchParams();
  // Submenu do Sidebar (Resultado de Exame > Laboratorial | Imagem) — o título acompanha
  const tipoExame = (searchParams.get('tipo') ?? '').toLowerCase();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('atendimento.exames.editar');
  const podeDeletar = isGestor || podeExecutar('atendimento.exames.deletar');
  // Gate do RESULTADO do exame CLÍNICO (distinto do slug acima, que é do PEDIDO —
  // armadilha 29 do CLAUDE.md) — mesmos slugs que ExamesSolicitadosPanel usa para
  // decidir quem pode "Carregar resultado"/"Preencher manualmente".
  const podeResultadoLab = isGestor || podeExecutar('exames.laboratorial.editar');
  const podeResultadoImg = isGestor || podeExecutar('exames.imagem.editar');
  const podeEditarResultadoClinico = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeResultadoImg : podeResultadoLab);
  // Excluir UMA imagem do resultado — mesmos slugs `.deletar` de exames.laboratorial/
  // exames.imagem (existiam no seed sem proteger rota nenhuma, ver armadilha 27 do
  // CLAUDE.md; a nova rota `/imagens/:imagemId` é a primeira a usá-los).
  const podeExcluirResultadoLab = isGestor || podeExecutar('exames.laboratorial.deletar');
  const podeExcluirResultadoImg = isGestor || podeExecutar('exames.imagem.deletar');
  const podeExcluirImagemClinico = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeExcluirResultadoImg : podeExcluirResultadoLab);
  // Imprimir/compartilhar o RESULTADO — mesmo slug que a tela de Pedido de Exames usa
  // para imprimir/WhatsApp/e-mail da requisição.
  const podeImprimirResultado = isGestor || podeExecutar('atendimento.exames.imprimir');
  const [erroInline, setErroInline] = useState<string | null>(null);
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [exames, setExames] = useState<any[]>([]);
  const [currentAnimal, setCurrentAnimal] = useState<any>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [confirmId,  setConfirmId]  = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [nutrientes, setNutrientes] = useState<any[]>([]);
  const [filtroData,      setFiltroData]      = useState('');
  const [filtroExame,     setFiltroExame]     = useState('');
  // Exames CLÍNICOS (Laboratorial/Bioquímico/Imagem) já REALIZADOS/CONCLUIDOS desta
  // aba — vêm do ExamesSolicitadosPanel (sistema separado do exame nutricional
  // abaixo) e são exibidos dentro do MESMO card "Resultados do Exame": é onde o
  // usuário espera ver o que acabou de salvar, não numa seção à parte.
  const [resultadosClinicos, setResultadosClinicos] = useState<ExameSolicitado[]>([]);
  // Editar/excluir um exame CLÍNICO já REALIZADO — a lista acima é só leitura (vem do
  // ExamesSolicitadosPanel via onRealizadosChange); a ação bypassa o painel e chama a
  // API direto, então precisa forçar o painel a recarregar depois — `panelKey` remonta
  // o componente (ele refaz o fetch no mount), sem precisar expor um método imperativo.
  const [panelKey,          setPanelKey]          = useState(0);
  const [editandoClinico,   setEditandoClinico]   = useState<ExameSolicitado | null>(null);
  // "Visualizar" (olho) — MESMA tela de "Carregar Resultados", só que travada
  // (ResultadoModal com `somenteLeitura`): mostra descrição/laboratório/tabela/
  // laudo já salvos, sem deixar editar nada. Distinto de `editandoClinico`, que
  // abre a MESMA tela liberada para alterar.
  const [visualizandoResultado, setVisualizandoResultado] = useState<ExameSolicitado | null>(null);
  const [salvandoClinico,   setSalvandoClinico]   = useState(false);
  const [erroClinico,       setErroClinico]       = useState<string | null>(null);
  const [excluindoClinico,  setExcluindoClinico]  = useState<ExameSolicitado | null>(null);
  const [deletandoClinico,  setDeletandoClinico]  = useState(false);
  const [erroExcluirClinico, setErroExcluirClinico] = useState<string | null>(null);
  // Excluir UMA imagem do resultado (soft delete, SEM justificativa) — distinto de
  // excluir o exame inteiro acima, que continua exigindo motivo.
  const [excluindoImagem,   setExcluindoImagem]   = useState<{ ex: ExameSolicitado; imagem: { id: number; nome: string | null } } | null>(null);
  // Expandir/contrair o corpo de cada resultado (laudo/tabela/imagens) — a linha nasce
  // CONTRAÍDA (só nome + selos + ações); expandir é opt-in por exame.
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const alternarExpandido = (id: number) =>
    setExpandidos(prev => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  // Visualizador de arquivos do exame CLÍNICO — abre no arquivo clicado e navega por
  // TODOS os arquivos daquele resultado (setas/teclado), sem fechar e reabrir cada um
  // numa aba nova.
  const [visualizando, setVisualizando] = useState<{ arquivos: ArquivoNavegavel[]; indice: number } | null>(null);
  const abrirVisualizador = (arquivos: ArquivoNavegavel[], indiceInicial: number) => {
    if (arquivos.length === 0) return;
    setVisualizando({ arquivos, indice: indiceInicial });
  };

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  useEffect(() => {
    const loadNutrientes = async () => {
      try {
        const res = await api.get('/nutrientes');
        setNutrientes(res.data);
      } catch (err) {
        console.error('Erro ao carregar nutrientes:', err);
      }
    };
    loadNutrientes();
  }, []);

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data?.dados ?? res.data ?? [];
      setAnimaisDoProprietario(lista);
      // Auto-seleciona um animal quando não há seleção (evita o falso "sem animais"
      // para gestor/vet com vários pacientes)
      if (lista.length > 0 && !selectedAnimal) {
        const alvo = (animalId && lista.find((a: { id: number }) => String(a.id) === animalId)) || lista[0];
        setSelectedAnimal({
          ...alvo,
          photoUrl:       alvo.photoUrl       ?? undefined,
          dataNascimento: alvo.dataNascimento ?? undefined,
        });
        if (!animalId) {
          const qs = searchParams.toString();
          navigate(`/exames/${alvo.id}${qs ? `?${qs}` : ''}`, { replace: true });
        }
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  };

  const loadExamesAndAnimal = async () => {
    if (!effectiveAnimalId) return;
    try {
      const resExames = await api.get(`/exames/animal/${effectiveAnimalId}`);
      setExames(resExames.data?.dados ?? resExames.data ?? []);
      const resAnimal = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(resAnimal.data?.dados ?? resAnimal.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

  useEffect(() => {
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([loadAnimais(), loadExamesAndAnimal()]).finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id, loadingPerms]);

  // Os botões "Carregar Resultado" e "Preencher Manualmente" que ficavam FORA do card
  // foram retirados a pedido — os dois caminhos agora vivem em cada linha do card de
  // exames solicitados (ExamesSolicitadosPanel), junto do exame a que se referem.
  // ⚠️ Com eles saiu a única entrada para `/exames/:animalId/novo`
  // (CriaExameNutricional — criação de EXAME NUTRICIONAL, outro módulo; ver armadilha
  // 27 do CLAUDE.md). A rota continua montada; se aquele fluxo voltar a ser necessário,
  // precisa de um ponto de entrada novo.

  const startEdit = (ex: any) => { setEditingId(ex.id); setEditValues({ ...ex }); };
  const cancelEdit = () => { setEditingId(null); setEditValues({}); };

  const saveEdit = async (id: number) => {
    if (!podeEditar) { semPermissao('editar exame'); return; }
    try {
      await api.put(`/exames/${id}`, editValues);
      setExames(exames.map(ex => ex.id === id ? { ...ex, ...editValues } : ex));
      setEditingId(null);
      setEditValues({});
      setErroInline(null);
    } catch {
      setErroInline('Erro ao salvar edição');
    }
  };

  const handleDelete = (id: number) => {
    if (!podeDeletar) { semPermissao('excluir exame'); return; }
    setConfirmId(id);
  };

  const handleDeleteConfirmado = async (motivo: string) => {
    if (confirmId == null) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await api.delete(`/exames/${id}`, { data: { motivo } });
      setExames(exames.filter(ex => ex.id !== id));
      setErroInline(null);
    } catch (error) {
      setErroInline('Erro ao excluir o exame');
      console.error(error);
    }
  };

  // ── Exame CLÍNICO (Laboratorial/Bioquímico/Imagem) já REALIZADO — editar o
  // resultado (mesmo modal/endpoint da lista de pendentes, tela "Carregar Resultados")
  // e excluir (mesmo padrão de justificativa obrigatória das demais exclusões da aplicação).
  const abrirEdicaoClinico = (ex: ExameSolicitado) => {
    if (!podeEditarResultadoClinico(ex)) { semPermissao('editar o resultado deste exame'); return; }
    setErroClinico(null);
    setEditandoClinico(ex);
  };

  const salvarResultadoClinico = async ({ laudo, laboratorio, itens, arquivos }: { laudo: string; laboratorio: string; itens: ItemManual[]; arquivos: File[] }) => {
    if (!editandoClinico) return;
    setSalvandoClinico(true);
    setErroClinico(null);
    try {
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      fd.append('laboratorio', laboratorio);
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      arquivos.forEach(a => fd.append('arquivos', a));
      await api.patch(`/clinica/exames/${editandoClinico.id}/resultado`, fd);
      setEditandoClinico(null);
      setPanelKey(k => k + 1);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroClinico(msg ?? 'Erro ao salvar o resultado');
    } finally {
      setSalvandoClinico(false);
    }
  };

  const excluirClinico = (ex: ExameSolicitado) => {
    if (!podeDeletar) { semPermissao('excluir exame'); return; }
    setErroExcluirClinico(null);
    setExcluindoClinico(ex);
  };

  const confirmarExclusaoClinico = async (motivo: string) => {
    if (!excluindoClinico) return;
    setDeletandoClinico(true);
    try {
      await api.delete(`/clinica/exames/${excluindoClinico.id}`, { data: { motivo } });
      setExcluindoClinico(null);
      setPanelKey(k => k + 1);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroExcluirClinico(msg ?? 'Erro ao excluir o exame');
    } finally {
      setDeletandoClinico(false);
    }
  };

  // Excluir UMA imagem do resultado (não o exame inteiro) — SEM justificativa: a
  // imagem some, mas o resultado/exame continua existindo (diferente da exclusão do
  // exame/registro clínico em si, que segue exigindo motivo).
  const excluirImagem = (ex: ExameSolicitado, imagem: { id: number; nome: string | null }) => {
    if (!podeExcluirImagemClinico(ex)) { semPermissao('excluir imagem do resultado'); return; }
    setErroClinico(null);
    setExcluindoImagem({ ex, imagem });
  };

  const confirmarExclusaoImagem = async () => {
    if (!excluindoImagem) return;
    const alvo = excluindoImagem;
    setExcluindoImagem(null);
    try {
      await api.delete(`/clinica/exames/${alvo.ex.id}/imagens/${alvo.imagem.id}`);
      setPanelKey(k => k + 1);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroClinico(msg ?? 'Erro ao excluir a imagem');
    }
  };

  // Imprimir/compartilhar o RESULTADO (laudo/tabela/imagens) — distinto do imprimir da
  // REQUISIÇÃO (tela de Pedido de Exames, utils/ExamePrint.ts).
  const imprimirResultado = (ex: ExameSolicitado) => {
    if (!podeImprimirResultado) { semPermissao('imprimir resultado'); return; }
    imprimirResultadoExame(ex, currentAnimal);
  };

  const compartilharResultadoWhatsApp = (ex: ExameSolicitado) => {
    if (!podeImprimirResultado) { semPermissao('compartilhar resultado'); return; }
    abrirWhatsApp(textoResultadoExame(ex));
  };

  const compartilharResultadoEmail = (ex: ExameSolicitado) => {
    if (!podeImprimirResultado) { semPermissao('compartilhar resultado'); return; }
    abrirEmail(`Resultado de Exame - ${ex.tipo} - ${ex.descricao}`, textoResultadoExame(ex));
  };

  const getStatus = (ex: any) => {
    const valor = parseFloat(ex.valorEncontrado);
    const min   = parseFloat(ex.valorMinRef);
    const max   = parseFloat(ex.valorMaxRef);
    if ((min === 0 && max === 0) || (isNaN(min) && isNaN(max))) return 'naoCalculado';
    if (isNaN(valor) || isNaN(min) || isNaN(max)) return 'normal';
    if (valor < min) return 'baixo';
    if (valor > max) return 'alto';
    return 'normal';
  };

  const examesFiltrados = useMemo(() => exames.filter(ex => {
    if (filtroData && ex.dataExame?.split('T')[0] !== filtroData) return false;
    if (filtroExame && !(ex.nutriente?.nome ?? '').toLowerCase().includes(filtroExame.toLowerCase())) return false;
    return true;
  }), [exames, filtroData, filtroExame]);

  // Mesmos filtros (Data/Exame) aplicados aos exames CLÍNICOS já com resultado —
  // sem isto o contador de registros do card só via os nutricionais e ficava
  // zerado nas abas Laboratorial/Imagem, que vivem quase inteiramente aqui.
  const resultadosClinicosFiltrados = useMemo(() => resultadosClinicos.filter(ex => {
    if (filtroData && (ex.dataResultado ?? ex.dataSolicitacao)?.split('T')[0] !== filtroData) return false;
    if (filtroExame && !ex.descricao.toLowerCase().includes(filtroExame.toLowerCase())) return false;
    return true;
  }), [resultadosClinicos, filtroData, filtroExame]);

  const totalRegistros = examesFiltrados.length + resultadosClinicosFiltrados.length;

  // Nomes distintos dos exames já feitos pelo paciente (nutricionais + clínicos) —
  // alimenta o datalist do filtro "Exame": seleciona da lista OU digita livre, com
  // autopreenchimento pelo próprio navegador.
  const nomesExamesRealizados = useMemo(() => {
    const nomes = new Set<string>();
    exames.forEach(ex => { if (ex.nutriente?.nome) nomes.add(ex.nutriente.nome); });
    resultadosClinicos.forEach(ex => { if (ex.descricao) nomes.add(ex.descricao); });
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [exames, resultadosClinicos]);

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.ler')) return (
    <PageContainer>
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar exames.</p>
      </div>
    </PageContainer>
  );

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!effectiveAnimalId) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">Você ainda não possui animais sob sua responsabilidade.</p>
        <p className="text-gray-400 text-xs mt-1">Solicite o vínculo com um animal para começar.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div className="space-y-5">

        <BotaoVoltar />

        <InlineError message={erroInline} />

        {/* Cabeçalho de página (mesmo padrão de Agendamentos): ícone em box + título por submenu */}
        <div className="mt-2 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            {tipoExame === 'laboratorial' ? <ClipboardList size={20} className="text-emerald-700" />
              : tipoExame === 'imagem'    ? <Scan          size={20} className="text-emerald-700" />
              :                             <Microscope    size={20} className="text-emerald-700" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {tipoExame === 'laboratorial' ? 'Resultado de Exame · Laboratorial'
                : tipoExame === 'imagem'    ? 'Resultado de Exame · Imagem'
                :                             'Resultado de Exame'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {tipoExame === 'imagem'
                ? 'Resultados de exames do paciente'
                : 'Resultados de exames do paciente e comparação com os valores de referência.'}
            </p>
          </div>
        </div>

        <SeletorAnimal
          animais={animaisDoProprietario}
          animalIdAtual={effectiveAnimalId}
          rotaBase="/exames"
        />

        {currentAnimal && <AnimalCard animal={currentAnimal} />}

        {/* Exames PEDIDOS no Atendimento que ainda aguardam resultado. Cada um traz os
            dois caminhos (carregar o laudo ou digitar), e o resultado fica amarrado ao
            pedido de origem — sem esta lista, quem chega com o laudo não sabe o que foi
            pedido e acaba lançando resultado solto. */}
        {effectiveAnimalId && (
          <ExamesSolicitadosPanel
            key={panelKey}
            animalId={effectiveAnimalId}
            tipo={tipoExame}
            onSalvo={() => { loadExamesAndAnimal(); }}
            onRealizadosChange={setResultadosClinicos}
          />
        )}

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100">
          {/* Título + busca (Data/Exame), tudo na mesma linha do card — compacto e
              alinhado à direita. FORA do wrapper `overflow-hidden` abaixo: o dropdown
              do ExameBuscaCombo é `absolute` e um ancestral com overflow-hidden o
              cortava nas bordas do card em vez de flutuar por cima do conteúdo. */}
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">Resultados do Exame</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-gray-500 flex-shrink-0">Data</label>
                <DateInputBR
                  value={filtroData}
                  onChange={setFiltroData}
                  showIcon={false}
                  className="w-28 border border-gray-200 rounded-xl px-2 py-1.5 text-sm focus-within:border-emerald-500"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-gray-500 flex-shrink-0">Exame</label>
                <ExameBuscaCombo value={filtroExame} onChange={setFiltroExame} opcoes={nomesExamesRealizados} />
              </div>
              {(filtroData || filtroExame) && (
                <button
                  onClick={() => { setFiltroData(''); setFiltroExame(''); }}
                  className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                >
                  Limpar
                </button>
              )}
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {totalRegistros} registro{totalRegistros !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Corpo do card, clipado às bordas arredondadas de baixo — o cabeçalho
              acima (onde mora a busca) fica FORA para o dropdown não ser cortado. */}
          <div className="overflow-hidden rounded-b-3xl">

          <InlineError message={erroClinico} className="mx-4 mt-3" />

          {/* Exames CLÍNICOS (Laboratorial/Bioquímico/Imagem) já com resultado — vêm
              do ExamesSolicitadosPanel acima. Ficam DENTRO deste card porque é aqui
              que o usuário olha depois de salvar; o exame nutricional (tabela logo
              abaixo) é outro sistema, com seus próprios filtros/edição/exclusão. */}
          {resultadosClinicosFiltrados.length > 0 && (
            <div className="divide-y divide-gray-50 border-b border-gray-100">
              {resultadosClinicosFiltrados.map(ex => (
                <div key={ex.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => alternarExpandido(ex.id)}
                      title={expandidos.has(ex.id) ? 'Contrair' : 'Expandir'} aria-label={expandidos.has(ex.id) ? 'Contrair' : 'Expandir'}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0">
                      {expandidos.has(ex.id) ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                    <button type="button" onClick={() => alternarExpandido(ex.id)}
                      title={expandidos.has(ex.id) ? 'Contrair' : 'Expandir'}
                      className="text-sm font-semibold text-gray-900 hover:text-emerald-700 transition-colors text-left">
                      {ex.descricao}
                    </button>
                    {temResultadoExame(ex) ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                        {ex.status === 'REALIZADO' ? 'Realizado' : 'Finalizado'}
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                        Finalizado sem Resultado
                      </span>
                    )}
                    {ex.laboratorio && (
                      <span className="text-[11px] text-gray-500">{ex.laboratorio}</span>
                    )}
                    {/* Visualizar/editar/excluir o exame já REALIZADO — visualizar abre a
                        MESMA tela de "Carregar Resultados" travada (ResultadoModal com
                        `somenteLeitura`; os arquivos salvos abrem o VisualizadorArquivos
                        de lá dentro); editar reabre a mesma tela liberada + exclusão com
                        motivo obrigatório, igual ao restante da aplicação. Imprimir/
                        WhatsApp/e-mail compartilham o slug de imprimir do Pedido de Exames. */}
                    <div className="ml-auto flex items-center gap-1 flex-nowrap">
                      {temResultadoExame(ex) && (
                        <button onClick={() => setVisualizandoResultado(ex)}
                          title="Visualizar resultado" aria-label="Visualizar resultado"
                          className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                      )}
                      {podeEditarResultadoClinico(ex) && (
                        <button onClick={() => abrirEdicaoClinico(ex)}
                          title="Editar" aria-label="Editar"
                          className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
                          <Edit size={14} />
                        </button>
                      )}
                      {podeImprimirResultado && (
                        <button onClick={() => imprimirResultado(ex)}
                          title="Imprimir" aria-label="Imprimir"
                          className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                          <Printer size={14} />
                        </button>
                      )}
                      {podeImprimirResultado && (
                        <button onClick={() => compartilharResultadoWhatsApp(ex)}
                          title="Enviar por WhatsApp" aria-label="Enviar por WhatsApp"
                          className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors">
                          <MessageCircle size={14} />
                        </button>
                      )}
                      {podeImprimirResultado && (
                        <button onClick={() => compartilharResultadoEmail(ex)}
                          title="Enviar por e-mail" aria-label="Enviar por e-mail"
                          className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                          <Mail size={14} />
                        </button>
                      )}
                      {podeDeletar && (
                        <button onClick={() => excluirClinico(ex)}
                          title="Excluir exame" aria-label="Excluir exame"
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {expandidos.has(ex.id) && (
                    <>
                      {ex.dataResultado && (
                        <p className="text-[11px] text-gray-400 mt-0.5">resultado em {formatDate(ex.dataResultado)}</p>
                      )}
                      {ex.resultado && (
                        <LaudoTexto texto={ex.resultado} className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap" />
                      )}
                      {ex.resultadoItens?.length > 0 && (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="py-1 pr-3 font-semibold">Parâmetro</th>
                                <th className="py-1 pr-3 font-semibold">Valor</th>
                                <th className="py-1 pr-3 font-semibold">Unidade</th>
                                <th className="py-1 font-semibold">Referência</th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-700">
                              {ex.resultadoItens.map(it => (
                                <tr key={it.id} className="border-t border-gray-50">
                                  <td className="py-1 pr-3">{it.parametro}</td>
                                  <td className="py-1 pr-3 font-medium">{it.valor ?? '—'}</td>
                                  <td className="py-1 pr-3 text-gray-500">{it.unidade ?? '—'}</td>
                                  <td className="py-1 text-gray-500">{it.referencia ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ex.imagens?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {ex.imagens.map((img, idx) => (
                            <div key={img.id} className="flex items-center gap-1 pl-2 pr-1 py-1 border border-gray-200 rounded-lg">
                              <button onClick={() => abrirVisualizador(arquivosDoExameClinico(ex), idx)}
                                className="text-[11px] text-gray-600 hover:text-gray-900 transition-colors">
                                {img.nome ?? `arquivo ${idx + 1}`}
                              </button>
                              {podeExcluirImagemClinico(ex) && (
                                <button onClick={() => excluirImagem(ex, img)}
                                  title="Excluir imagem" aria-label="Excluir imagem"
                                  className="p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <datalist id="exames-list">
            {nutrientes.map(n => <option key={n.id} value={n.nome} />)}
          </datalist>

          {examesFiltrados.length > 0 && (
          <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <span className="flex items-center gap-1"><Calendar size={11} /> Data</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exame</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {examesFiltrados.map((ex: any) => {
                  const isEditing = editingId === ex.id;
                  const status    = getStatus(ex);
                  return (
                    <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <DateInputBR
                            value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                            onChange={v => setEditValues({ ...editValues, dataExame: v })}
                            className="border rounded p-1 text-sm"
                          />
                        ) : formatDate(ex.dataExame)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {isEditing ? (
                          <input
                            list="exames-list"
                            value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                            onChange={e => {
                              const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                              setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                            }}
                            className="border rounded p-1 text-sm w-full"
                            placeholder="Digite o exame..."
                          />
                        ) : ex.nutriente?.nome || '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-700 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number" step="0.01"
                            value={editValues.valorEncontrado || ex.valorEncontrado}
                            onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                            className="border rounded p-1 text-sm w-20 text-center"
                          />
                        ) : `${ex.valorEncontrado} ${ex.unidade}`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(ex.id)} className="px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50">Salvar</button>
                              <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                            </>
                          ) : (
                            <>
                              {ex.arquivoUrl && (
                                <button onClick={() => window.open(ex.arquivoUrl, '_blank')} title="Ver laudo"
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                  <Eye size={15} />
                                </button>
                              )}
                              <button onClick={() => startEdit(ex)} title="Editar"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Edit size={15} />
                              </button>
                              <button onClick={() => handleDelete(ex.id)} title="Excluir"
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {examesFiltrados.map((ex: any) => {
              const isEditing = editingId === ex.id;
              const status    = getStatus(ex);
              return (
                <div key={ex.id} className="px-4 py-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <DateInputBR
                        value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                        onChange={v => setEditValues({ ...editValues, dataExame: v })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                      />
                      <input
                        list="exames-list"
                        value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                        onChange={e => {
                          const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                          setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                        }}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Digite o exame..."
                      />
                      <input
                        type="number" step="0.01"
                        value={editValues.valorEncontrado || ex.valorEncontrado}
                        onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Valor"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(ex.id)} className="flex-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Salvar</button>
                        <button onClick={cancelEdit} className="flex-1 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-sm truncate">{ex.nutriente?.nome || '—'}</span>
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Calendar size={11} /> {formatDate(ex.dataExame)}
                        {' · '}<span className="font-semibold text-emerald-700">{ex.valorEncontrado} {ex.unidade}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ex.arquivoUrl && (
                          <button onClick={() => window.open(ex.arquivoUrl, '_blank')}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                            <Eye size={11} /> Laudo
                          </button>
                        )}
                        <button onClick={() => startEdit(ex)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                          <Edit size={11} /> Editar
                        </button>
                        <button onClick={() => handleDelete(ex.id)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                          <Trash2 size={11} /> Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </>
          )}
          </div>
        </div>
      </div>
      <ModalJustificativa
        aberto={confirmId != null}
        titulo="Excluir exame"
        descricao="Deseja realmente excluir este exame? Esta ação não pode ser desfeita."
        acaoLabel="Excluir"
        onConfirmar={handleDeleteConfirmado}
        onFechar={() => setConfirmId(null)}
      />

      {editandoClinico && (
        <ResultadoModal
          ex={editandoClinico}
          animalId={effectiveAnimalId ?? ''}
          saving={salvandoClinico}
          onClose={() => setEditandoClinico(null)}
          onSalvar={salvarResultadoClinico}
        />
      )}

      {visualizandoResultado && (
        <ResultadoModal
          ex={visualizandoResultado}
          animalId={effectiveAnimalId ?? ''}
          saving={false}
          somenteLeitura
          arquivosSalvos={arquivosDoExameClinico(visualizandoResultado)}
          onVerArquivo={(idx) => abrirVisualizador(arquivosDoExameClinico(visualizandoResultado), idx)}
          onClose={() => setVisualizandoResultado(null)}
          onSalvar={() => {}}
        />
      )}

      <ModalJustificativa
        aberto={excluindoClinico != null}
        titulo="Excluir exame"
        descricao={excluindoClinico ? `${excluindoClinico.tipo}: ${excluindoClinico.descricao}` : undefined}
        acaoLabel="Excluir"
        processando={deletandoClinico}
        erro={erroExcluirClinico}
        onConfirmar={confirmarExclusaoClinico}
        onFechar={() => setExcluindoClinico(null)}
      />

      <ConfirmModal
        open={excluindoImagem != null}
        titulo="Excluir imagem"
        mensagem={`Excluir "${excluindoImagem?.imagem.nome ?? 'Imagem do resultado'}"? Esta ação não pode ser desfeita.`}
        labelConfirmar="Excluir"
        variante="perigo"
        onConfirmar={confirmarExclusaoImagem}
        onCancelar={() => setExcluindoImagem(null)}
      />

      {visualizando && (
        <VisualizadorArquivos
          arquivos={visualizando.arquivos}
          indice={visualizando.indice}
          onNavegar={novoIndice => setVisualizando(v => (v ? { ...v, indice: novoIndice } : v))}
          onFechar={() => setVisualizando(null)}
        />
      )}
    </PageContainer>
  );
};

export default Exames;