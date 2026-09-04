// src/components/ExamesSolicitadosPanel.tsx
//
// Exames PEDIDOS na tela de Atendimento > Pedido de Exames (/clinica/exames/:animalId)
// que ainda aguardam resultado, listados aqui na tela de RESULTADO DE EXAME
// (/exames/:animalId?tipo=laboratorial|imagem).
//
// POR QUE EXISTE: quem pede o exame e quem lança o resultado costumam ser pessoas (e
// momentos) diferentes. Sem esta lista, quem chegava com o laudo na mão não tinha como
// saber o que havia sido pedido, e o resultado acabava lançado solto — sem vínculo com
// o pedido, com a evolução e com a fatura que nasceram dele.
//
// Cada pedido oferece "Carregar Resultados": anexa o laudo; a IA lê o arquivo e vira
// TABELA (Lab) ou TEXTO TRANSCRITO literal, nunca interpretado (Imagem). O laudo digitado
// à mão continua disponível como campo dentro dessa mesma tela (Imagem). Na aba
// Laboratorial existe AINDA um segundo caminho, "Preencher manualmente" — digita a
// tabela direto, sem arquivo (nem todo laboratório entrega laudo em PDF/foto).
//
// Cai no endpoint (PATCH /clinica/exames/:id/resultado), que transita o
// exame para REALIZADO. O gate é o slug de RESULTADO (exames.laboratorial.editar /
// exames.imagem.editar), distinto do slug do PEDIDO — ver CLAUDE.md, armadilha 29.
//
// Exame NÃO PEDIDO (mesmo componente ResultadoModal, mais abaixo, com `ex={null}`):
// achado antigo, laudo externo, ou resultado que chegou sem passar pelo Pedido de
// Exames. Não exige evolução — é um registro AVULSO, como o exame de Compra — e
// cria + já REALIZA num único passo (POST /clinica/exames/nao-pedido), com todos
// os campos revisáveis antes de salvar.
//
// Cancelar (Ban): soft delete do PEDIDO (DELETE, motivo obrigatório) — mesmo endpoint
// do "Cancelar exame" da tela de Pedido de Exames, então reflete lá como CANCELADA.

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, Scan, Upload, Table2, Loader2, X, Plus, Trash2, CheckCircle2, FilePlus2, Camera, Ban, Eye, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import InlineError from './InlineError';
import ModalJustificativa from './ModalJustificativa';
import DateInput from './DateInput';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import { isMobile } from '../services/whisperService';
import { comprimirImagensAteLimite } from '../utils/imageCompress';
import { temResultadoExame } from '../utils/exameClinico';
import { conferirExame } from '../utils/exameConferencia';
import AcaoRegistro, { AcoesRegistro } from './AcaoRegistro';

type TipoExame = 'Laboratorial' | 'Bioquímico' | 'Imagem' | 'Compra';

interface ResultadoItem {
  id:         number;
  parametro:  string;
  valor:      string | null;
  unidade:    string | null;
  referencia: string | null;
}

export interface ExameSolicitado {
  id:              number;
  numero:          number | null;
  tipo:            TipoExame;
  descricao:       string;
  status:          string;
  ativo:           boolean;
  dataSolicitacao: string;
  /** DATA DO EXAME — a data IMPRESSA no laudo (lida pela IA, revisável na tela);
   *  em branco no lançamento, vale o instante em que o resultado foi gravado. */
  dataResultado:   string | null;
  /** Evolução do atendimento em que o exame foi PEDIDO. `null` = exame lançado sem
   *  pedido ("Carregar Exames sem Pedido") — aí não existe solicitante a exibir:
   *  `veterinario` é quem LANÇOU o resultado, não quem pediu o exame. */
  evolucaoId?:     number | null;
  resultado:       string | null;
  arquivoUrl:      string | null;
  /** Extraído de `observacao` pelo backend (JSON) — null quando o laudo não tem
   *  laboratório identificado (ou é do tipo Imagem, que não usa esse campo). */
  laboratorio?:    string | null;
  resultadoItens:  ResultadoItem[];
  imagens:         { id: number; nome: string | null; arquivoUrl: string }[];
  veterinario:     { id: number; fullName: string } | null;
}

export interface ItemManual {
  parametro:  string;
  valor:      string;
  unidade:    string;
  referencia: string;
}

interface Props {
  animalId: string;
  /** Aba da tela de resultado: 'laboratorial' | 'imagem' (vazio = todas) */
  tipo:     string;
  /** Chamado após salvar um resultado — a tela recarrega o que exibe */
  onSalvo?: () => void;
  /** Exames REALIZADOS/CONCLUIDOS desta aba, a cada recarga — a tela-mãe (Exames.tsx)
   *  os exibe dentro do card "Resultados do Exame", que é onde o usuário espera ver
   *  o que acabou de salvar (não é reexibido aqui, para não duplicar a mesma lista
   *  em dois lugares da página). */
  onRealizadosChange?: (lista: ExameSolicitado[]) => void;
}

const LINHA_VAZIA: ItemManual = { parametro: '', valor: '', unidade: '', referencia: '' };

const formatData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const numeroExame = (ex: ExameSolicitado) =>
  ex.numero != null ? `EX-${String(ex.numero).padStart(4, '0')}` : `#${ex.id}`;

/** Tipos que a aba atual mostra. A aba Laboratorial cobre Bioquímico — é o mesmo
 *  laudo de bancada e o mesmo slug de permissão (exames.laboratorial.*). */
function tiposDaAba(tipo: string): TipoExame[] {
  if (tipo === 'imagem')       return ['Imagem'];
  if (tipo === 'laboratorial') return ['Laboratorial', 'Bioquímico'];
  return ['Laboratorial', 'Bioquímico', 'Imagem'];
}

// ─── Tabela de resultado (editável) ────────────────────────────────────────────
// Usada pelo exame NÃO PEDIDO (Carregar Exames sem Pedido) para digitar a tabela
// à mão — mesma grade, mesmo comportamento de adicionar/remover linha.

function TabelaResultadoEditavel({ itens, setItens }: {
  itens:    ItemManual[];
  setItens: (fn: (prev: ItemManual[]) => ItemManual[]) => void;
}) {
  const setItem = (idx: number, campo: keyof ItemManual, valor: string) =>
    setItens(prev => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));

  const remover = (idx: number) =>
    setItens(prev => (prev.length === 1 ? [{ ...LINHA_VAZIA }] : prev.filter((_, i) => i !== idx)));

  const inputClass = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500';

  return (
    <div>
      {/* Cabeçalho só no desktop: no mobile cada linha vira um bloco com rótulos
          próprios (regra mobile-first da aplicação). */}
      <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 mb-1 px-1">
        {['Parâmetro', 'Valor', 'Unidade', 'Referência'].map(h => (
          <span key={h} className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{h}</span>
        ))}
        <span />
      </div>
      <div className="space-y-2">
        {itens.map((linha, idx) => (
          <div key={idx}>
            {/* Mobile — Parâmetro sozinho, Valor+Unidade lado a lado, Referência e o
                botão de remover na MESMA linha via flex (não uma 3ª coluna de grid —
                era isso que deixava uma caixa vazia ao lado da Referência). */}
            <div className="md:hidden space-y-2 border border-gray-200 rounded-xl p-3">
              <input value={linha.parametro} onChange={e => setItem(idx, 'parametro', e.target.value)}
                placeholder="Hemoglobina" aria-label="Parâmetro" className={inputClass} />
              <div className="grid grid-cols-2 gap-2">
                <input value={linha.valor} onChange={e => setItem(idx, 'valor', e.target.value)}
                  placeholder="12,4" aria-label="Valor" className={inputClass} />
                <input value={linha.unidade} onChange={e => setItem(idx, 'unidade', e.target.value)}
                  placeholder="g/dL" aria-label="Unidade" className={inputClass} />
              </div>
              <div className="flex items-center gap-2">
                <input value={linha.referencia} onChange={e => setItem(idx, 'referencia', e.target.value)}
                  placeholder="11 – 17" aria-label="Referência" className={`flex-1 min-w-0 ${inputClass}`} />
                <button type="button" title="Remover linha" onClick={() => remover(idx)}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Desktop — grid proporcional de 5 colunas (Parâmetro maior, Unidade
                menor, botão só do tamanho do ícone). */}
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 items-center">
              <input value={linha.parametro} onChange={e => setItem(idx, 'parametro', e.target.value)}
                placeholder="Hemoglobina" aria-label="Parâmetro" className={inputClass} />
              <input value={linha.valor} onChange={e => setItem(idx, 'valor', e.target.value)}
                placeholder="12,4" aria-label="Valor" className={inputClass} />
              <input value={linha.unidade} onChange={e => setItem(idx, 'unidade', e.target.value)}
                placeholder="g/dL" aria-label="Unidade" className={inputClass} />
              <input value={linha.referencia} onChange={e => setItem(idx, 'referencia', e.target.value)}
                placeholder="11 – 17" aria-label="Referência" className={inputClass} />
              <button type="button" title="Remover linha" onClick={() => remover(idx)}
                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors justify-self-end">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setItens(prev => [...prev, { ...LINHA_VAZIA }])}
        className="mt-2 flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
        <Plus size={13} /> Adicionar parâmetro
      </button>
    </div>
  );
}

/**
 * Como um novo lote de arquivos entra no formulário.
 *   substituir → o lote novo é o resultado (o de antes é descartado). É o que sempre
 *                aconteceu, e continua sendo o caminho de quem anexou o arquivo errado.
 *   adicionar  → MESCLA com o que já está na tela: linhas novas entram na tabela, o
 *                laudo é acrescentado ao final e os arquivos se somam. É o exame que
 *                veio em várias páginas, anexadas uma a uma.
 * A escolha nunca é adivinhada: quando há resultado na tela, a pergunta é feita.
 */
type ModoCarga = 'substituir' | 'adicionar';

// ─── Seletor de arquivo, com opção de câmera em mobile/tablet ─────────────────
// `isMobile()` (whisperService — mesmo detector já usado no reconhecimento de voz)
// cobre Android/iPhone/iPad + touch: em desktop some o botão de câmera, já que não
// há câmera para acionar. "Tirar foto" e "Escolher arquivo" são inputs SEPARADOS —
// um `<input capture>` só tira UMA foto por vez, então quem chama decide se ela
// substitui a seleção (Laboratorial/Bioquímico, 1 arquivo) ou se acrescenta
// (Imagem, várias fotos de exame).
function SeletorArquivo({ multiple, onEscolher, onFoto, abrirRef }: {
  multiple:   boolean;
  onEscolher: (arquivos: File[]) => void;
  onFoto:     (foto: File) => void;
  // Gatilho imperativo do MESMO seletor do botao "Carregar Arquivos": a tela de
  // divergencia fica por cima do formulario, e o "Anexar outro arquivo" de la
  // precisa abrir o seletor sem obrigar a pessoa a achar o botao atras do overlay.
  abrirRef?:  React.MutableRefObject<(() => void) | null>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  // Input nativo fica OCULTO — o texto do botão/"nenhum arquivo escolhido" é do
  // navegador (idioma do SO, não controlável por CSS) e ficava em inglês mesmo com o
  // resto da tela em português. O gatilho é um botão nosso, com o texto que queremos.
  //
  // SEM `accept` no input principal: com o filtro, o seletor de arquivo do Windows
  // acusava "Nenhum dos arquivos desta pasta é compatível" sempre que a pasta tinha
  // algo fora de imagem/PDF — mensagem do próprio SO, incontrolável por aqui. O
  // formato ainda é validado no servidor (`fileFilter` de `routes/clinica-exames.js`).
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [comprimindo, setComprimindo] = useState(false);

  useEffect(() => {
    if (!abrirRef) return;
    abrirRef.current = () => arquivoRef.current?.click();
    return () => { abrirRef.current = null; };
  }, [abrirRef]);

  const processarSelecao = async (files: File[]): Promise<File[]> => {
    if (files.length === 0) return files;
    setComprimindo(true);
    try {
      return await comprimirImagensAteLimite(files);
    } finally {
      setComprimindo(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input type="file" multiple={multiple} ref={arquivoRef}
        onChange={async e => {
          const lista = Array.from(e.target.files ?? []);
          e.target.value = '';
          onEscolher(await processarSelecao(lista));
        }}
        className="hidden" />
      <button type="button" onClick={() => arquivoRef.current?.click()} disabled={comprimindo}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-60 transition-colors">
        {comprimindo && <Loader2 size={12} className="animate-spin" />}
        {comprimindo ? 'Otimizando imagens...' : 'Carregar Arquivos'}
      </button>
      {isMobile() && (
        <>
          <input type="file" accept="image/*" capture="environment" ref={cameraRef}
            onChange={async e => {
              const foto = e.target.files?.[0];
              e.target.value = '';
              if (foto) {
                const [comprimida] = await processarSelecao([foto]);
                onFoto(comprimida);
              }
            }}
            className="hidden" />
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={comprimindo}
            title="Tirar foto" aria-label="Tirar foto"
            className="flex-shrink-0 p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors">
            <Camera size={16} />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Modal do resultado — PEDIDO existente e NÃO PEDIDO, tela ÚNICA ────────────
// Mesmo formulário, sempre, nas DUAS situações — `ex` só muda o TÍTULO/subtítulo,
// o endpoint (PATCH .../resultado × POST /nao-pedido, decidido por quem chama), o
// `exameId` mandado à IA (evita falso "já carregado" contra o próprio pedido) e
// SE os campos vêm pré-preenchidos:
//   descrição/laboratório → sempre que `ex` existe, mesmo PENDENTE — são dados do
//     PEDIDO (capturados na Evolução/Pedido de Exames, antes de existir qualquer
//     resultado), não do resultado; reaproveitá-los evita reescrever o que já foi
//     informado e é por isso que o campo não carrega mais um exemplo genérico
//     (Hemograma/Raio-X de tórax) — o valor real já chega pronto.
//   laudo/tabela → só quando `ex` JÁ TEM um resultado salvo (edição, via "Editar"
//     em Exames.tsx); a fila de pendentes nunca tem, então começa em branco por
//     definição (ver `jaTemResultado` no corpo) — é o RESULTADO em si, que ainda
//     não existe.
// Data do exame fica sem uso quando `ex` existe — é a data IMPRESSA no laudo
// (que a IA extrai do arquivo), não a data em que o pedido foi feito. SEM
// seletor de "Tipo do exame" — o tipo é sempre conhecido (o do pedido) ou
// detectado pela IA, nunca escolhido.
export function ResultadoModal({ ex, tipoAba, animalId, saving, erroSalvar, somenteLeitura, arquivosSalvos, onVerArquivo, onExcluirArquivo, onClose, onSalvar }: {
  /** Exame PEDIDO — presente quando é "Carregar/Editar Resultados"; `null` no
   *  fluxo avulso "Carregar Exames sem Pedido". Decide texto do cabeçalho,
   *  endpoint (via quem chama), o `exameId` da análise, e pré-preenche
   *  descrição/laboratório (dados do PEDIDO, disponíveis mesmo pendente) — o
   *  laudo/tabela só vêm quando já existe um resultado salvo (ver
   *  `jaTemResultado` no corpo). */
  ex:       ExameSolicitado | null;
  /** Aba atual ('laboratorial' | 'imagem') — só usada quando `ex` é `null`, para
   *  decidir o tipo padrão (a IA pode corrigir para Bioquímico depois). */
  tipoAba?: string;
  animalId: string;
  saving:   boolean;
  /** Erro do POST de criação no fluxo avulso (ex.: "Este exame já foi
   *  carregado"), vindo de fora — precisa aparecer AQUI dentro, não atrás do
   *  overlay (regra de erro em modal). */
  erroSalvar?: string | null;
  /** Visualizar (não editar) — usado pelo "olho" de um resultado já salvo em
   *  Exames.tsx. `<fieldset disabled>` trava todo campo; a seção de anexar
   *  arquivo some, no lugar entra a lista de `arquivosSalvos` (cada um abre o
   *  visualizador de verdade via `onVerArquivo`). Rodapé vira só "Fechar". */
  somenteLeitura?: boolean;
  arquivosSalvos?: { nome: string }[];
  onVerArquivo?:   (indice: number) => void;
  /** Remove um arquivo JÁ SALVO (índice de `arquivosSalvos`). Só quando informado o
   *  X aparece na edição — quem sabe se aquele anexo é apagável (e se a pessoa tem
   *  permissão) é o pai; botão que só falha depois do clique é o antipadrão 28-d. */
  onExcluirArquivo?: (indice: number) => void;
  onClose:  () => void;
  onSalvar: (data: {
    tipo: TipoExame; descricao: string; laboratorio: string; dataExame: string;
    laudo: string; itens: ItemManual[]; arquivos: File[];
  }) => void;
}) {
  // `ex` PENDENTE (fila de "aguardando resultado") já tem descrição/laboratório
  // (do pedido), mas nunca tem laudo/tabela salvos ainda — esses começam em
  // branco por definição. `ex` JÁ REALIZADO (aberto pelo "Editar" em Exames.tsx)
  // tem os dois, e é isso que esta tela edita: tem de vir com o que já foi
  // salvo, senão "editar" apaga o resultado por engano. `temResultadoExame`
  // (mesmo critério do badge "Realizado"/"Finalizado sem Resultado") é o que
  // distingue os dois — não dá para usar só `!!ex`.
  const jaTemResultado = !!ex && temResultadoExame(ex);

  const [tipo,        setTipo]        = useState<TipoExame>(ex ? ex.tipo : (tipoAba === 'imagem' ? 'Imagem' : 'Laboratorial'));
  // Descrição/laboratório vêm do PEDIDO (já existem antes do resultado) — ver
  // comentário do componente. `ex` cobre pendente E já realizado.
  const [descricao,   setDescricao]   = useState(ex?.descricao ?? '');
  /**
   * A descrição atual veio da IA (do arquivo) ou de uma PESSOA (o pedido / digitada)?
   *
   * 🔴 É o que separa os dois casos da regra: descrição que uma pessoa colocou é
   * PRESERVADA ao anexar o laudo; a que a IA leu de um arquivo ANTERIOR é substituída
   * quando esse arquivo é trocado — senão anexar o laudo errado e corrigir deixaria o
   * nome do exame errado para sempre, num campo obrigatório.
   * `useRef` e não estado: ninguém re-renderiza por causa disto, e ele precisa estar
   * atualizado DENTRO da mesma passagem em que a análise roda.
   */
  const descricaoVeioDoArquivo = useRef(false);
  const [dataExame,   setDataExame]   = useState('');
  const [laudo,       setLaudo]       = useState(jaTemResultado ? (ex?.resultado ?? '') : '');
  const [laboratorio, setLaboratorio] = useState(ex?.laboratorio ?? '');
  const [itens,       setItens]       = useState<ItemManual[]>(
    jaTemResultado && ex && ex.resultadoItens.length > 0
      ? ex.resultadoItens.map(i => ({ parametro: i.parametro, valor: i.valor ?? '', unidade: i.unidade ?? '', referencia: i.referencia ?? '' }))
      : [{ ...LINHA_VAZIA }]
  );
  const [arquivos,    setArquivos]    = useState<File[]>([]);
  // Lote escolhido esperando a resposta de "adicionar ou substituir". Enquanto está
  // aqui, NADA foi tocado no formulário — a pergunta acontece ANTES de qualquer reset,
  // que é o que torna o "adicionar" possível.
  const [loteEmEspera, setLoteEmEspera] = useState<File[] | null>(null);
  const [analisando,  setAnalisando]  = useState(false);
  // Progresso SIMULADO (a chamada de IA não emite eventos de progresso real) — mesmo
  // padrão de CriaComposicaoAlimentar.tsx/CriaExameNutricional.tsx.
  const [progresso,   setProgresso]   = useState(0);
  const [erro,        setErro]        = useState<string | null>(null);
  // Nomes dos arquivos aceitos no upload mas sem transcrição automática (.doc) —
  // aviso, não erro: o arquivo é anexado normalmente ao salvar (mesmo loop de
  // upload de qualquer outro), só não teve prévia da IA.
  const [naoTranscritos, setNaoTranscritos] = useState<string[]>([]);
  // Divergência entre o exame PEDIDO e o que a IA leu no arquivo anexado. Guarda a
  // frase pronta (`conferirExame`) e vira a tela de confirmação abaixo — nunca um
  // bloqueio: o nome do exame é texto livre no laudo, e recusar trancaria o
  // lançamento legítimo de uma nomenclatura diferente da que o vet digitou.
  const { user } = useAuth();
  /** PROFISSIONAL do exame, só leitura. O próprio registro já guarda a pessoa certa
   *  nos DOIS casos: no exame que veio de PEDIDO, `veterinario` é quem SOLICITOU; no
   *  lançado sem pedido, é quem LANÇOU o resultado (é assim que a rota /nao-pedido
   *  grava). Só sobra o caso em que o registro ainda NÃO EXISTE (`ex` null, "Carregar
   *  Exames sem Pedido"): aí quem está carregando é o usuário da sessão. */
  const profissionalNome = ex?.veterinario?.fullName ?? user?.fullName ?? '';
  const abrirSeletorRef = useRef<(() => void) | null>(null);
  const [divergencia, setDivergencia] = useState<string | null>(null);
  // Divergência que o usuário JÁ decidiu prosseguir — vira faixa âmbar fixa no
  // formulário. Sem isto, quem confirma no susto perde a informação de vista e salva
  // o laudo divergente sem lembrar do aviso.
  const [divergenciaAceita, setDivergenciaAceita] = useState<string | null>(null);

  const isImagem = tipo === 'Imagem';
  const preenchidos = itens.filter(i => i.parametro.trim());

  // Lê os arquivos com a IA e pré-preenche laboratório + tabela (ou o laudo
  // transcrito, em Imagem) — tudo continua editável logo abaixo. `exameId`
  // (só quando `ex` existe) exclui o PRÓPRIO pedido da checagem de duplicidade lá
  // dentro: sem ele, todo upload bateria com o pedido que está recebendo o
  // resultado e devolveria 409.
  const analisarArquivo = async (files: File[], modo: ModoCarga = 'substituir') => {
    if (files.length === 0) return;
    const adicionando = modo === 'adicionar';
    // SUBSTITUIR reseta: cada novo lote parte do zero, senão um campo que a IA não
    // detectasse desta vez continuaria mostrando o valor do lote ANTERIOR — parecendo
    // (errado) que veio do arquivo recém-anexado.
    // ADICIONAR preserva tudo e MESCLA o que vier: é o caminho de quem recebeu o exame
    // em várias páginas/arquivos e anexa um a um. Aqui o reset seria destrutivo — cada
    // arquivo apagaria o resultado do anterior, que é o defeito que este modo corrige.
    if (!adicionando) {
      // 🔴 A DESCRIÇÃO só é zerada quando foi a IA que a preencheu, de um arquivo
      // anterior. A que veio do PEDIDO (ou que alguém digitou) é PRESERVADA: zerá-la
      // fazia o nome do exame sumir da tela ao anexar o laudo, num campo obrigatório.
      if (descricaoVeioDoArquivo.current) setDescricao('');
      setLaboratorio('');
      setDataExame('');
      setLaudo('');
      setItens([{ ...LINHA_VAZIA }]);
    }
    setNaoTranscritos([]);
    setDivergencia(null);
    setDivergenciaAceita(null);
    setAnalisando(true);
    setProgresso(0);
    setErro(null);
    const interval = setInterval(() => setProgresso(p => (p >= 90 ? 90 : p + 10)), 300);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('arquivos', f));
      fd.append('animalId', animalId);
      if (isImagem) fd.append('tipo', 'Imagem');
      if (ex) fd.append('exameId', String(ex.id));
      const res = await api.post('/clinica/exames/analisar', fd);
      setProgresso(100);
      const d = res.data?.dados;
      if (d) {
        if (Array.isArray(d.naoTranscritos) && d.naoTranscritos.length > 0) setNaoTranscritos(d.naoTranscritos);
        // CONFERÊNCIA PEDIDO × ARQUIVO — só quando existe pedido (`ex`): no fluxo
        // avulso não há o que conferir, o exame É o que o arquivo diz. Roda sobre o
        // que a IA acabou de ler, ANTES de o usuário revisar a tela, para ele não
        // preencher tudo e só então descobrir que anexou o laudo errado.
        if (ex) {
          const conf = conferirExame(
            { tipo: ex.tipo, descricao: ex.descricao },
            { tipo: isImagem ? 'Imagem' : (d.tipoSugerido ?? null) },
            // CONTEÚDO carregado = onde se procura o exame pedido. Laboratorial: as
            // LINHAS do resultado (parâmetros). Imagem: o TEXTO do laudo transcrito
            // (não há tabela) — o título do arquivo deixou de ser usado para casar.
            isImagem
              ? String(d.laudo ?? '').split(/\s+/)
              : (Array.isArray(d.itens) ? d.itens.map((i: { parametro?: string }) => i.parametro ?? '') : []),
          );
          if (!conf.combina) setDivergencia(conf.motivo);
        }
        // 🔴 O QUE JÁ ESTÁ ESCRITO NÃO É SOBRESCRITO. Descrição, laboratório e data
        // vêm do PEDIDO (ou foram digitados/corrigidos à mão) e valem mais que a
        // leitura da IA: quem preencheu sabe o que pediu, e ver o próprio texto ser
        // trocado por outro ao anexar o arquivo é perder trabalho sem aviso.
        // `manterSePreenchido` é a regra: a IA só preenche campo VAZIO.
        const manterSePreenchido = (atual: string, doArquivo: unknown, set: (v: string) => void) => {
          const novo = String(doArquivo ?? '').trim();
          if (novo && !atual.trim()) set(novo);
        };

        // 🔴 ARMADILHA DO RESET + CLOSURE, que fazia o campo terminar VAZIO nos dois
        // sentidos: no modo SUBSTITUIR os `setX('')` acima zeram o formulário, mas as
        // variáveis desta função ainda guardam o valor ANTERIOR (estado do render em
        // que ela foi criada). `manterSePreenchido` então concluía "já está
        // preenchido", não gravava o que a IA leu — e o campo ficava com o vazio do
        // reset. Perdia-se o valor velho E o novo.
        // Quem foi zerado tem de ser comparado com o VAZIO; a descrição, que não é mais
        // zerada, continua sendo comparada com ela mesma.
        const aposReset = (valor: string) => (adicionando ? valor : '');
        // A descrição segue a mesma conta, com a ressalva do dono: no SUBSTITUIR ela
        // só foi zerada se tinha vindo de um arquivo.
        const descricaoBase = adicionando || !descricaoVeioDoArquivo.current ? descricao : '';
        /** Preenche a descrição a partir do arquivo e ANOTA que a origem é ele. */
        const descricaoDoArquivo = (doArquivo: unknown) => {
          const novo = String(doArquivo ?? '').trim();
          if (!novo || descricaoBase.trim()) return;
          descricaoVeioDoArquivo.current = true;
          setDescricao(novo);
        };

        if (isImagem) {
          // Laudo de imagem é TEXTO corrido: adicionando, o novo entra depois do que já
          // havia (separado por linha em branco), em vez de substituir a transcrição
          // anterior — é assim que o exame que veio em 3 páginas fica inteiro.
          if (d.laudo) setLaudo(prev => (adicionando && prev.trim() ? `${prev.trim()}\n\n${d.laudo}` : d.laudo));
          descricaoDoArquivo(d.descricao);
          manterSePreenchido(aposReset(dataExame), d.dataExame, setDataExame);
        } else {
          if (d.tipoSugerido === 'Bioquímico' || d.tipoSugerido === 'Laboratorial') setTipo(d.tipoSugerido);
          descricaoDoArquivo(d.descricao);
          manterSePreenchido(aposReset(laboratorio), d.laboratorio, setLaboratorio);
          manterSePreenchido(aposReset(dataExame),   d.dataExame,   setDataExame);
          if (Array.isArray(d.itens) && d.itens.length > 0) {
            const lidos = d.itens.map((i: { parametro: string; valor: string | null; unidade: string | null; referencia: string | null }) => ({
              parametro: i.parametro ?? '', valor: i.valor ?? '', unidade: i.unidade ?? '', referencia: i.referencia ?? '',
            }));
            setItens(prev => {
              if (!adicionando) return lidos;
              // Acrescenta ao que já existe, descartando a linha em branco do rodapé
              // (`LINHA_VAZIA`) e o parâmetro repetido — o mesmo hemograma anexado duas
              // vezes viraria a tabela em duplicidade, e ninguém revisa 40 linhas.
              const uteis = prev.filter(l => l.parametro.trim() || l.valor.trim());
              const jaTem = new Set(uteis.map(l => l.parametro.trim().toLowerCase()));
              const novos = lidos.filter((l: ItemManual) => !jaTem.has(l.parametro.trim().toLowerCase()));
              return [...uteis, ...novos];
            });
          }
        }
        // A IA não achou nome no laudo: volta o que o PEDIDO já dizia. O reset do modo
        // SUBSTITUIR limpa tudo para não misturar lotes, e deixar a descrição vazia
        // obrigaria a redigitar o que já estava informado — o campo é obrigatório no
        // salvar. ⚠️ `setDescricao(prev => ...)`: no modo ADICIONAR o campo pode já ter
        // sido preenchido pelo lote anterior, e sobrescrever aqui desfaria justamente o
        // que a regra acima protege.
        if (!d.descricao && ex) {
          descricaoVeioDoArquivo.current = false;
          setDescricao(prev => (prev.trim() ? prev : ex.descricao));
        }
      }
    } catch (err: unknown) {
      // best-effort para falha/indisponibilidade da IA — mas "nenhum arquivo é um
      // exame", "esse exame já foi carregado" e "formato não suportado" são
      // diagnóstico, não indisponibilidade, e precisam aparecer: sem isto, o
      // usuário confirmaria uma tabela vazia (ou duplicada) sem entender por quê.
      const resp = (err as { response?: { data?: { code?: string; error?: string } } })?.response;
      if (['ARQUIVO_NAO_E_EXAME', 'EXAME_JA_CARREGADO', 'FORMATO_ARQUIVO_NAO_SUPORTADO'].includes(resp?.data?.code ?? '')) {
        setErro(resp?.data?.error ?? 'Não foi possível analisar o(s) arquivo(s).');
      }
    } finally {
      clearInterval(interval);
      setAnalisando(false);
    }
  };

  /**
   * Há resultado na tela que um lote novo pode atropelar?
   *
   * Vale para a EDIÇÃO (o exame já tem laudo/tabela salvos — é sempre perguntado,
   * porque ali o risco é apagar resultado já gravado) e para a carga em duas etapas
   * (já existe arquivo anexado ou linha preenchida nesta sessão).
   * ⚠️ Descrição e laboratório NÃO entram: eles vêm preenchidos do PEDIDO, e contá-los
   * faria a pergunta aparecer no primeiro anexo de todo exame pendente — pergunta que
   * sempre aparece deixa de ser lida.
   */
  const temResultadoNaTela = () =>
    jaTemResultado
    || arquivos.length > 0
    || laudo.trim().length > 0
    || itens.some(i => i.parametro.trim() || i.valor.trim());

  /** Recebe o lote do seletor: pergunta quando há o que preservar, senão segue direto. */
  const receberLote = (lista: File[], anexarAoQueTem: boolean) => {
    if (lista.length === 0) return;
    if (temResultadoNaTela()) { setLoteEmEspera(lista); return; }
    const novos = anexarAoQueTem ? [...arquivos, ...lista] : lista;
    setArquivos(novos);
    analisarArquivo(anexarAoQueTem ? lista : novos, 'substituir');
  };

  /** Resposta da pergunta. `adicionar` mescla; `substituir` recomeça do lote novo. */
  const resolverLote = (modo: ModoCarga) => {
    const lista = loteEmEspera ?? [];
    setLoteEmEspera(null);
    if (lista.length === 0) return;
    if (modo === 'adicionar') {
      setArquivos(prev => [...prev, ...lista]);
      analisarArquivo(lista, 'adicionar');   // só o lote novo é lido: o anterior já está na tela
    } else {
      setArquivos(lista);
      analisarArquivo(lista, 'substituir');
    }
  };


  /** "Não é este" na tela de divergência: devolve o formulário ao estado anterior ao
   *  anexo — arquivos fora e campos do PEDIDO de volta —, para o usuário anexar o
   *  laudo certo. Não fecha o modal: fechar faria perder também o que ele já tinha
   *  revisado à mão. */
  const descartarLoteDivergente = () => {
    setArquivos([]);
    setDivergencia(null);
    setDivergenciaAceita(null);
    setNaoTranscritos([]);
    setLaudo(jaTemResultado ? (ex?.resultado ?? '') : '');
    setItens([{ ...LINHA_VAZIA }]);
    descricaoVeioDoArquivo.current = false;
    setDescricao(ex?.descricao ?? '');
    setLaboratorio(ex?.laboratorio ?? '');
    setDataExame('');
    if (ex) setTipo(ex.tipo);
  };

  const confirmar = () => {
    if (!descricao.trim()) { setErro('Informe a descrição do exame'); return; }
    if (isImagem) {
      if (arquivos.length === 0 && !laudo.trim()) { setErro('Anexe as imagens ou escreva o laudo'); return; }
    } else if (preenchidos.length === 0) {
      setErro('Informe ao menos um parâmetro do resultado');
      return;
    }
    setErro(null);
    onSalvar({
      tipo, descricao: descricao.trim(), laboratorio: laboratorio.trim(), dataExame,
      laudo: laudo.trim(), itens: preenchidos, arquivos,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isImagem ? <Scan size={16} className="text-emerald-700 flex-shrink-0" />
                      : ex ? <ClipboardList size={16} className="text-emerald-700 flex-shrink-0" />
                           : <FilePlus2 size={16} className="text-emerald-700 flex-shrink-0" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900">{ex ? 'Carregar Resultados' : 'Carregar Exames sem Pedido'}</h3>
                {somenteLeitura && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 flex-shrink-0">
                    Somente leitura
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 truncate">
                {ex ? `${numeroExame(ex)} · ${ex.tipo} · ${ex.descricao}` : 'Achado antigo ou laudo externo — sem passar pelo Pedido de Exames'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* `somenteLeitura`: dois <fieldset disabled> em volta dos campos — a
              lista de arquivos SALVOS, entre eles, fica DE FORA de propósito
              (senão o "ver arquivo" também travaria; fieldset desabilita todo
              controle de formulário descendente, `<button>` incluso). Nunca usar
              `className="contents"` no fieldset — quebra o `space-y-*`, que
              seleciona só filho direto (mesma armadilha da tela de Exame de
              Compra, CLAUDE.md). */}
          <fieldset disabled={somenteLeitura} className="min-w-0 space-y-4 border-0 p-0 m-0">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Descrição do exame *
              </label>
              <input type="text" value={descricao}
                onChange={e => { descricaoVeioDoArquivo.current = false; setDescricao(e.target.value); }}
                placeholder="Nome do exame"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
            </div>

            {/* DATA DO EXAME vale para TODO tipo, Imagem inclusive — é a data impressa
                no laudo (o dia em que o exame foi feito), lida automaticamente pela
                IA em qualquer um deles (`dataExame` da rota /analisar). Ela só não
                aparecia em Imagem, então o valor lido era descartado em silêncio e o
                exame sem pedido nascia com a data de HOJE, que é a do upload.
                LABORATÓRIO segue exclusivo de Laboratorial/Bioquímico: exame de
                imagem é feito por clínica/serviço de diagnóstico, não por laboratório
                — o campo não tem o que receber ali. */}
            <div className="grid grid-cols-2 gap-3">
              {!isImagem && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Laboratório</label>
                  <input type="text" value={laboratorio} onChange={e => setLaboratorio(e.target.value)}
                    placeholder="Identificado ao anexar o laudo"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Data do exame</label>
                {/* `DateInput` e não `<input type="date">`: o nativo segue o locale do
                    BROWSER e no Chrome ignora o `lang` da página, então a data do laudo
                    aparecia como MM/DD/AAAA. É o mesmo componente do campo "Data Início"
                    da tela de Prescrição — o valor continua ISO ('YYYY-MM-DD'), só a
                    exibição muda. */}
                <DateInput
                  value={dataExame}
                  onChange={setDataExame}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-emerald-500"
                  aria-label="Data do exame"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Preenchida ao anexar o laudo. Em branco, vale o dia de hoje.
                </p>
              </div>
              {/* PROFISSIONAL — só leitura, ao lado da Data do exame. Só no exame de
                  IMAGEM: em Laboratorial/Bioquímico a linha já está ocupada por
                  Laboratório + Data, e uma terceira coluna espremeria as três.
                  `readOnly` (não `disabled`): o campo é informativo, e desabilitado
                  ficaria indistinguível do bloqueio de `somenteLeitura`. */}
              {isImagem && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Profissional</label>
                  <input type="text" value={profissionalNome} readOnly tabIndex={-1}
                    placeholder="Não identificado"
                    className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-600 cursor-default focus:outline-none" />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {ex?.evolucaoId ? 'Solicitante do exame.' : 'Quem está lançando o resultado.'}
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          {/* ARQUIVOS JÁ SALVOS — aparecem também na EDIÇÃO, não só na visualização.
              Sem isto, quem reabria um exame de Imagem para corrigir não via os anexos
              que já estavam lá: não dava para apagar o laudo/foto anexado por engano
              sem fechar o modal e ir até o card expandido de "Resultados do Exame",
              o ÚNICO lugar onde o X existia. Na edição o bloco só aparece quando HÁ
              anexo (na visualização continua mostrando o "Nenhum arquivo anexado",
              que ali é a resposta à pergunta que a tela existe para responder).
              ⚠️ O X exige `onExcluirArquivo`: anexo legado sem linha própria
              (`arquivoUrl` solto, sem `ExameImagemAnexo`) não tem o que apagar. */}
          {(somenteLeitura || (arquivosSalvos?.length ?? 0) > 0) && (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Arquivos anexados
              </label>
              {arquivosSalvos && arquivosSalvos.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {arquivosSalvos.map((a, idx) => (
                    <div key={idx} className="flex items-center gap-1 border border-gray-200 rounded-xl pl-3 pr-1 py-1 hover:border-emerald-300 transition-colors">
                      <button type="button" onClick={() => onVerArquivo?.(idx)}
                        className="flex items-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-900 transition-colors">
                        <Eye size={12} /> {a.nome}
                      </button>
                      {!somenteLeitura && onExcluirArquivo && (
                        <button type="button" onClick={() => onExcluirArquivo(idx)}
                          title="Excluir arquivo" aria-label="Excluir arquivo"
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Nenhum arquivo anexado.</p>
              )}
            </div>
          )}

          {!somenteLeitura && (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                {isImagem ? 'Imagens / laudo (PDF ou imagem)' : 'Anexar laudo(s) (opcional)'}
              </label>
              {/* Seleção MÚLTIPLA de uma vez continua sendo um lote só. Selecionar um a
                  um, ou anexar sobre um resultado que já está na tela, cai na pergunta
                  "adicionar ou substituir" — antes, o segundo arquivo apagava o
                  resultado do primeiro sem avisar. */}
              <SeletorArquivo multiple abrirRef={abrirSeletorRef}
                onEscolher={lista => receberLote(lista, false)}
                onFoto={foto => receberLote([foto], true)} />
              {arquivos.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  {arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivo(s) selecionado(s)`}
                </p>
              )}
              {/* Pergunta ANTES de tocar no formulário — é o que permite o "adicionar"
                  existir. Sem rota de saída ela viraria uma armadilha: "Cancelar"
                  descarta o lote e não muda nada. */}
              {loteEmEspera && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-900 font-medium">
                    {loteEmEspera.length === 1
                      ? `"${loteEmEspera[0].name}" — este exame já tem resultado na tela.`
                      : `${loteEmEspera.length} arquivos — este exame já tem resultado na tela.`}
                  </p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Adicionar mantém o que já está aqui e acrescenta o que vier do arquivo.
                    Substituir descarta o resultado atual.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button type="button" onClick={() => resolverLote('adicionar')}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl transition-colors">
                      Adicionar ao resultado
                    </button>
                    <button type="button" onClick={() => resolverLote('substituir')}
                      className="px-3 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors">
                      Substituir o resultado
                    </button>
                    <button type="button" onClick={() => setLoteEmEspera(null)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-xl transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {analisando && (
                <div className="mt-2">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${progresso}%` }} />
                  </div>
                  <p className="text-center text-[11px] text-gray-500 mt-1">
                    {isImagem
                      ? `Lendo o laudo com IA — transcrevendo o texto… ${progresso}%`
                      : `Lendo o laudo com IA — identificando laboratório e resultado… ${progresso}%`}
                  </p>
                </div>
              )}
              {divergenciaAceita && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                  <strong>Exame diferente do pedido.</strong> {divergenciaAceita} Você optou por prosseguir —
                  confira a descrição e o resultado antes de salvar.
                </p>
              )}
              {naoTranscritos.length > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                  {naoTranscritos.length === 1
                    ? `O arquivo "${naoTranscritos[0]}" não é suportado para ser interpretado, ele será somente salvo no resultado. Os formatos suportados para leitura automática são ${isImagem ? 'PDF, DOCX ou TXT' : 'PDF, DOCX, TXT ou imagem'}.`
                    : `Os arquivos ${naoTranscritos.map(n => `"${n}"`).join(', ')} não são suportados para serem interpretados, eles serão somente salvos no resultado. Os formatos suportados para leitura automática são ${isImagem ? 'PDF, DOCX ou TXT' : 'PDF, DOCX, TXT ou imagem'}.`}
                </p>
              )}
            </div>
          )}

          <fieldset disabled={somenteLeitura} className="min-w-0 space-y-4 border-0 p-0 m-0">
            {isImagem ? (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Laudo {arquivos.length === 0 ? '*' : ''}
                </label>
                <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={6}
                  placeholder="Digite o laudo do exame de imagem — salvo literalmente, sem interpretação da IA."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                    Resultado *
                  </label>
                  <TabelaResultadoEditavel itens={itens} setItens={setItens} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Observação (opcional)</label>
                  <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={2}
                    placeholder="Notas adicionais sobre o resultado..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
                </div>
              </>
            )}
          </fieldset>

          <InlineError message={erro ?? erroSalvar} />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          {somenteLeitura ? (
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Fechar
            </button>
          ) : (
            <>
              <button onClick={onClose} disabled={saving}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {ex ? 'Salvar resultado' : 'Salvar exame'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* CONFERÊNCIA PEDIDO × ARQUIVO — o laudo anexado não parece ser o exame pedido.
          Sobrepõe o formulário porque a decisão precede tudo o que vem depois: seguir
          revisando uma tabela que talvez nem seja deste pedido é trabalho perdido.
          ⚠️ NUNCA bloqueia. O nome do exame é texto livre no laudo, e recusar trancaria
          o lançamento legítimo de uma nomenclatura diferente da que o vet digitou — sem
          nenhuma saída pela tela. Quem decide é quem está olhando o documento. */}
      {divergencia && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
              <h3 className="font-bold text-gray-900">O exame não parece ser o que foi pedido</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">{divergencia}</p>
              {ex && (
                <div className="text-xs bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 space-y-1">
                  <p><span className="text-gray-400">Pedido:</span>{' '}
                    <span className="font-semibold text-gray-800">{ex.tipo} · {ex.descricao}</span></p>
                  <p><span className="text-gray-400">Arquivo anexado:</span>{' '}
                    <span className="font-semibold text-gray-800">{descricao || 'não identificado'}</span></p>
                </div>
              )}
              <p className="text-xs text-gray-500">
                Exame divergente do solicitado, deseja continuar?
              </p>
            </div>
            {/* CANCELAR fecha o lançamento inteiro; ANEXAR OUTRO ARQUIVO devolve o
                formulário ao estado anterior ao anexo E já abre o seletor de arquivo
                (o botão "Carregar Arquivos" fica atrás deste overlay); CONTINUAR grava
                neste pedido do jeito que está na tela.
                ⚠️ O `click()` do input roda no MESMO gesto do usuário, síncrono: adiado
                (setTimeout/efeito) o navegador perde a ativação e ignora a abertura. */}
            <div className="flex justify-end gap-2 px-5 pb-5 pt-1">
              <button onClick={onClose}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={() => { descartarLoteDivergente(); abrirSeletorRef.current?.(); }}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Anexar outro arquivo
              </button>
              <button onClick={() => { setDivergenciaAceita(divergencia); setDivergencia(null); }}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal de preenchimento MANUAL do resultado (só Laboratorial/Bioquímico) ──
// Nem todo laboratório entrega arquivo — às vezes só dita os valores por telefone.
// Digita a tabela direto, sem anexar nada. Some do fluxo de Imagem: lá o laudo
// digitado já cabe dentro do "Carregar Resultados" (campo Laudo), sem precisar de
// uma tabela estruturada.

export function ResultadoManualModal({ ex, saving, onClose, onSalvar }: {
  ex:       ExameSolicitado;
  saving:   boolean;
  onClose:  () => void;
  onSalvar: (data: { laudo: string; itens: ItemManual[] }) => void;
}) {
  const [itens, setItens] = useState<ItemManual[]>([{ ...LINHA_VAZIA }]);
  const [laudo, setLaudo] = useState(ex.resultado ?? '');
  const [erro,  setErro]  = useState<string | null>(null);

  const confirmar = () => {
    const preenchidos = itens.filter(i => i.parametro.trim());
    if (preenchidos.length === 0) { setErro('Informe ao menos um parâmetro do resultado'); return; }
    setErro(null);
    onSalvar({ laudo: laudo.trim(), itens: preenchidos });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList size={16} className="text-emerald-700 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">Preencher manualmente</h3>
              <p className="text-[11px] text-gray-500 truncate">
                {numeroExame(ex)} · {ex.tipo} · {ex.descricao}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Resultado *
            </label>
            <TabelaResultadoEditavel itens={itens} setItens={setItens} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Observação (opcional)</label>
            <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={2}
              placeholder="Notas adicionais sobre o resultado..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
          </div>

          <InlineError message={erro} />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Salvar resultado
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel ───────────────────────────────────────────────────────────────────

export default function ExamesSolicitadosPanel({ animalId, tipo, onSalvo, onRealizadosChange }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  // Gate do RESULTADO — distinto do gate do PEDIDO (armadilha 29 do CLAUDE.md)
  const podeResultadoLab = isGestor || podeExecutar('exames.laboratorial.editar');
  const podeResultadoImg = isGestor || podeExecutar('exames.imagem.editar');
  const podeLancar = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeResultadoImg : podeResultadoLab);
  // Cancelar o PEDIDO (soft delete, ativo:false) é ação do pedido, não do resultado:
  // usa o mesmo slug/endpoint do "Cancelar" da tela de Pedido de Exames — é o que faz
  // o cancelamento aparecer como CANCELADA no Histórico de Exames de lá também.
  // Sem filtro por autoria — quem tem a ação concedida opera o registro (CLAUDE.md 28-c).
  const podeCancelar = isGestor || podeExecutar('atendimento.exames.deletar');
  // "Preencher manualmente" (tabela sem arquivo) só na aba Laboratorial — na aba
  // Imagem o laudo digitado já cabe dentro do "Carregar Resultados" (upload).
  const permiteManual = tipo === 'laboratorial';

  // ─── Ações do exame PENDENTE — UMA declaração p/ a tabela E p/ o card ──────
  // `AcaoRegistro` decide a forma por CSS: ícone no desktop, botão com rótulo no
  // mobile — que é onde três ícones sem rótulo numa linha `flex-nowrap` não cabiam.
  const acoesDoPendente = (ex: ExameSolicitado) => (
    <AcoesRegistro>
      <AcaoRegistro tom="finalizar" icone={Upload} rotulo="Carregar"
        titulo="Carregar Resultados" visivel={podeLancar(ex)} onClick={() => setAlvo(ex)} />
      <AcaoRegistro tom="neutro" icone={Table2} rotulo="Preencher"
        titulo="Preencher manualmente" visivel={permiteManual && podeLancar(ex)}
        onClick={() => setAlvoManual(ex)} />
      <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar"
        visivel={podeCancelar}
        onClick={() => { setErroCancelamento(null); setCancelando(ex); }} />
    </AcoesRegistro>
  );

  const [pendentes,  setPendentes]  = useState<ExameSolicitado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro,       setErro]       = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [alvo,       setAlvo]       = useState<ExameSolicitado | null>(null);
  const [alvoManual, setAlvoManual] = useState<ExameSolicitado | null>(null);
  const [naoPedidoAberto, setNaoPedidoAberto] = useState(false);
  // Erro do POST de criação do "não pedido" — separado do `erro` do painel (topo da
  // página) porque precisa aparecer DENTRO do modal, que cobre a tela toda.
  const [erroNaoPedido, setErroNaoPedido] = useState<string | null>(null);
  // Confirmação do "Cancelar": é uma exclusão (soft delete) e exige motivo, como toda
  // exclusão/cancelamento da aplicação (ModalJustificativa).
  const [cancelando,        setCancelando]        = useState<ExameSolicitado | null>(null);
  const [salvandoCancelamento, setSalvandoCancelamento] = useState(false);
  const [erroCancelamento,  setErroCancelamento]  = useState<string | null>(null);

  // Guarda a chamada MAIS RECENTE — trocar de aba (Laboratorial ↔ Imagem no submenu
  // do Sidebar) refaz o fetch com o `tipo` novo, mas a resposta da aba ANTERIOR pode
  // chegar DEPOIS (rede fora de ordem). Sem este guard, a resposta atrasada
  // sobrescrevia a lista com o `tipo` errado — era assim que um pedido de Imagem
  // aparecia na tela de resultado Laboratorial (ou vice-versa) depois de trocar de
  // aba rápido. Só a chamada cujo id ainda é o mais recente pode gravar estado.
  const requestIdRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!animalId) return;
    const meuRequestId = ++requestIdRef.current;
    setCarregando(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalId}`);
      if (requestIdRef.current !== meuRequestId) return; // resposta desatualizada
      // GET 403 resolve com data null (interceptor) — sem guard, estoura TypeError
      if (!res.data) { setPendentes([]); onRealizadosChange?.([]); return; }
      const permitidos = tiposDaAba(tipo);
      const lista = ((res.data.dados ?? []) as ExameSolicitado[])
        .filter(ex => ex.ativo && permitidos.includes(ex.tipo));
      // Encerrado (REALIZADO/CONCLUIDO) sai da fila de espera — senão o pedido
      // finalizado continuaria pedindo resultado para sempre. Não é reexibido AQUI:
      // sobe para a tela-mãe via onRealizadosChange, que o mostra dentro do card
      // "Resultados do Exame" — é lá que o usuário espera ver o que acabou de salvar.
      const encerrado = (ex: ExameSolicitado) => ex.status === 'REALIZADO' || ex.status === 'CONCLUIDO';
      setPendentes(lista.filter(ex => !encerrado(ex)));
      onRealizadosChange?.(lista.filter(encerrado));
    } catch {
      if (requestIdRef.current !== meuRequestId) return;
      setErro('Erro ao carregar os exames solicitados');
    } finally {
      if (requestIdRef.current === meuRequestId) setCarregando(false);
    }
  }, [animalId, tipo, onRealizadosChange]);

  useEffect(() => {
    if (loadingPerms) return;   // evita 403 antes de as permissões carregarem
    carregar();
  }, [carregar, loadingPerms]);

  const salvarResultado = async ({ laudo, laboratorio, dataExame, itens, arquivos }: { laudo: string; laboratorio: string; dataExame: string; itens: ItemManual[]; arquivos: File[] }) => {
    if (!alvo) return;
    setSaving(true);
    setErro(null);
    try {
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      fd.append('laboratorio', laboratorio);
      // Data IMPRESSA no laudo (lida pela IA ou corrigida na tela). O campo já era
      // exibido e preenchido, mas nunca era enviado: o exame ficava com a data do
      // UPLOAD como data de resultado, e a coluna "Data Fim" da lista de exames
      // mostrava o dia em que alguém digitou, não o dia em que o exame foi feito.
      if (dataExame) fd.append('dataExame', dataExame);
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      arquivos.forEach(a => fd.append('arquivos', a));
      await api.patch(`/clinica/exames/${alvo.id}/resultado`, fd);
      setAlvo(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErro(msg ?? 'Erro ao salvar o resultado');
    } finally {
      setSaving(false);
    }
  };

  // Preenchimento MANUAL (só Laboratorial) — mesmo endpoint, só a tabela em JSON,
  // sem arquivo nenhum.
  const salvarResultadoManual = async ({ laudo, itens }: { laudo: string; itens: ItemManual[] }) => {
    if (!alvoManual) return;
    setSaving(true);
    setErro(null);
    try {
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      fd.append('itens', JSON.stringify(itens));
      await api.patch(`/clinica/exames/${alvoManual.id}/resultado`, fd);
      setAlvoManual(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErro(msg ?? 'Erro ao salvar o resultado');
    } finally {
      setSaving(false);
    }
  };

  // Exame NÃO PEDIDO: cria e já REALIZA num único POST — sem evolução (registro
  // avulso, mesma categoria do exame de Compra). Nenhuma segunda chamada de IA: a
  // tabela já veio revisada pelo modal.
  const salvarNaoPedido = async (
    { tipo: tipoNovo, descricao, laboratorio, dataExame, laudo, itens, arquivos }:
    { tipo: TipoExame; descricao: string; laboratorio: string; dataExame: string; laudo: string; itens: ItemManual[]; arquivos: File[] }
  ) => {
    setSaving(true);
    setErroNaoPedido(null);
    try {
      const fd = new FormData();
      fd.append('animalId', animalId);
      fd.append('tipo', tipoNovo);
      fd.append('descricao', descricao);
      if (laboratorio) fd.append('laboratorio', laboratorio);
      if (dataExame)   fd.append('dataExame', dataExame);
      if (laudo)       fd.append('resultado', laudo);
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      arquivos.forEach(a => fd.append('arquivos', a));
      await api.post('/clinica/exames/nao-pedido', fd);
      setNaoPedidoAberto(false);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroNaoPedido(msg ?? 'Erro ao criar o exame');
    } finally {
      setSaving(false);
    }
  };

  // Cancela o PEDIDO (soft delete, ativo:false) — mesmo endpoint/comportamento do
  // "Cancelar exame" da tela de Pedido de Exames: sai da fila de espera aqui E passa
  // a constar CANCELADA no Histórico de Exames de lá (getStatusExame usa !ativo).
  const cancelarExame = async (motivo: string) => {
    if (!cancelando) return;
    setSalvandoCancelamento(true);
    setErroCancelamento(null);
    try {
      await api.delete(`/clinica/exames/${cancelando.id}`, { data: { motivo } });
      setCancelando(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroCancelamento(msg ?? 'Erro ao cancelar o exame');
    } finally {
      setSalvandoCancelamento(false);
    }
  };

  if (loadingPerms) return null;
  // O painel some só para quem não pode NEM lançar resultado NEM cancelar o pedido.
  // Quem tem apenas `atendimento.exames.deletar` continua vendo a fila — é dele a
  // decisão de cancelar o pedido que nunca vai receber laudo.
  const podeLancarNaAba = tipo === 'imagem' ? podeResultadoImg : podeResultadoLab;
  if (!podeLancarNaAba && !podeCancelar) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Exames solicitados aguardando resultado{pendentes.length > 0 ? ` (${pendentes.length})` : ''}
        </p>
        <div className="flex items-center gap-2">
          {/* Exame NÃO PEDIDO — abre a tela de cadastro completa (tipo, descrição,
              laboratório, data, tabela), tudo editável antes de salvar. */}
          {podeLancarNaAba && (
            <button onClick={() => { setErroNaoPedido(null); setNaoPedidoAberto(true); }}
              title="Incluir exame não pedido" aria-label="Incluir exame não pedido"
              className="flex items-center gap-1 px-2 py-1 text-emerald-700 hover:bg-emerald-50 rounded-lg text-[11px] font-semibold transition-colors">
              <FilePlus2 size={13} /> Carregar Exames sem Pedido
            </button>
          )}
          {carregando && <Loader2 size={14} className="animate-spin text-emerald-600" />}
        </div>
      </div>

      <InlineError message={erro} className="mx-4 mt-3" />

      {pendentes.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">
          Nenhum exame pedido aguardando resultado. Os pedidos feitos no Atendimento aparecem aqui.
        </p>
      ) : (
        <>
          {/* Mobile — cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {pendentes.map(ex => (
              <div key={ex.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{ex.descricao}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {numeroExame(ex)} · {formatData(ex.dataSolicitacao)}
                  {ex.veterinario ? ` · ${ex.veterinario.fullName}` : ''}
                </p>
                <div className="mt-2">{acoesDoPendente(ex)}</div>
              </div>
            ))}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Pedido</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exame</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Solicitado em</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pendentes.map(ex => (
                  <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-500">{numeroExame(ex)}</td>
                    <td className="px-4 py-3">
                      {/* Só o NOME do exame. O tipo (Laboratorial/Bioquímico/Imagem)
                          saiu a pedido — e é redundante: a própria aba da tela já diz
                          qual é (?tipo=laboratorial | imagem). */}
                      <p className="text-sm text-gray-800">{ex.descricao}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatData(ex.dataSolicitacao)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{ex.veterinario?.fullName ?? '—'}</td>
                    <td className="px-4 py-3">
                      {acoesDoPendente(ex)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* "Exames encerrados" foi removido a pedido (2026-08) — duplicava a leitura
          de "Resultados do Exame" (mesma página) e confundia sobre qual seção era a
          fonte de verdade. O exame REALIZADO por aqui continua consultável no
          Histórico do paciente (AnimalDetail). */}

      {alvo && (
        <ResultadoModal
          ex={alvo}
          animalId={animalId}
          saving={saving}
          onClose={() => setAlvo(null)}
          onSalvar={salvarResultado}
        />
      )}

      {alvoManual && (
        <ResultadoManualModal
          ex={alvoManual}
          saving={saving}
          onClose={() => setAlvoManual(null)}
          onSalvar={salvarResultadoManual}
        />
      )}

      {naoPedidoAberto && (
        <ResultadoModal
          ex={null}
          tipoAba={tipo}
          animalId={animalId}
          saving={saving}
          erroSalvar={erroNaoPedido}
          onClose={() => setNaoPedidoAberto(false)}
          onSalvar={salvarNaoPedido}
        />
      )}

      <ModalJustificativa
        aberto={cancelando != null}
        titulo="Cancelar exame"
        descricao={cancelando ? `${cancelando.tipo}: ${cancelando.descricao}` : undefined}
        acaoLabel="Cancelar exame"
        processando={salvandoCancelamento}
        erro={erroCancelamento}
        onConfirmar={cancelarExame}
        onFechar={() => setCancelando(null)}
      />
    </div>
  );
}
