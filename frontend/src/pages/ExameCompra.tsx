// frontend/src/pages/ExameCompra.tsx — Exame de Compra

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Activity, Loader2, CheckCircle2, PlusCircle, Paperclip, X, Printer, Pencil, Eye } from 'lucide-react';
import api from '../services/api';
import { hojeISO } from '../utils/dateUtils';
import toast from 'react-hot-toast';
import { usePermissoes } from '../hooks/usePermissoes';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import PageContainer from '../components/PageContainer';
import AnimalCard from '../components/AnimalCard';
import CompartilharPdfBotoes from '../components/CompartilharPdfBotoes';
import JanelaLista from '../components/JanelaLista';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import { imprimirExameCompra, gerarHtmlExameCompra } from '../utils/ExameCompraPrint';
import InlineError from '../components/InlineError';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'clinico-geral' | 'fisiologia' | 'musculo' | 'imagem';

type Pata = 'AE' | 'AD' | 'PE' | 'PD';
type Grau = '-' | '±' | '+' | '++' | '+++';
type FieldDef = [string, string, string, string]; // [key, label, opt1, opt2]

interface AnimalSimples {
  id: number; nome: string; photoUrl?: string | null;
  dataNascimento?: string | null; idadeAnos?: number | null;
  raca?: { nome: string } | null; especie?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
}

// ─── Field definitions ────────────────────────────────────────────────────────

const F_CLINICO: FieldDef[] = [
  ['conformacao',    'Conformação / Atitude',            'Boa',    'Anormal'],
  ['nutricional',    'Estado Nutricional',               'Normal', 'Anormal'],
  ['pele',           'Pele/Pêlos',                       'Normal', 'Anormal'],
  ['mucosas',        'Mucosas',                          'Normal', 'Anormal'],
  ['olhos_aparencia','Olhos – Aparência externa (Dto)',  'Normal', 'Anormal'],
  ['olhos_reflexos', 'Olhos – Reflexos',                'Normal', 'Anormal'],
  ['linfonodos',     'Linfonodos',                       'Normal', 'Anormal'],
  ['vicios',         'Vícios',                           'Ausente','Presente'],
  ['cicatrizes',     'Cicatrizes (cirúrgica ou não)',    'Ausente','Presente'],
];

const F_CARDIO: FieldDef[] = [
  ['auscultacao', 'Auscultação Cardíaca', 'Normal', 'Anormal'],
];

const F_RESP: FieldDef[] = [
  ['padrao',   'Padrão respiratório',                    'Normal', 'Anormal'],
  ['repouso',  'Respiração em repouso',                  'Normal', 'Anormal'],
  ['exercicio','Respiração após exercício',              'Normal', 'Anormal'],
  ['ruido',    'Ruído respiratório durante o trabalho',  'Ausente','Presente'],
];

const F_DIGEST: FieldDef[] = [
  ['boca',      'Boca / Dentes',                'Normal', 'Anormal'],
  ['abre_boca', 'Exame realizado c/ "abre boca"?', 'Não',  'Sim'],
];

const F_UROGEN: FieldDef[] = [
  ['externo',    'Exame externo',        'Normal', 'Anormal'],
  ['testiculos', 'Testículos / Prepúcio','Normal', 'Anormal'],
  ['vulva',      'Vulva / Úbere',        'Normal', 'Anormal'],
];

const F_NERVOSO: FieldDef[] = [
  ['tail_tone',  'Teste "Tail tone"', 'Normal', 'Anormal'],
  ['spin_left',  'Teste "Spin left"', 'Normal', 'Anormal'],
  ['spin_right', 'Teste "Spin right"','Normal', 'Anormal'],
  ['recuo',      'Recuo',             'Normal', 'Anormal'],
  ['coordenacao','Coordenação',       'Normal', 'Anormal'],
];

const F_INSPECAO: FieldDef[] = [
  ['atrofia','Atrofia muscular',          'Ausente','Presente'],
  ['cabeca', 'Cabeça',                    'Normal', 'Anormal'],
  ['pescoco','Pescoço',                   'Normal', 'Anormal'],
  ['cernelha','Cernelha',                 'Normal', 'Anormal'],
  ['dorso',  'Dorso',                     'Normal', 'Anormal'],
  ['garupa', 'Garupa',                    'Normal', 'Anormal'],
  ['mae',    'Membro anterior esquerdo',  'Normal', 'Anormal'],
  ['mad',    'Membro anterior direito',   'Normal', 'Anormal'],
  ['mpe',    'Membro posterior esquerdo', 'Normal', 'Anormal'],
  ['mpd',    'Membro posterior direito',  'Normal', 'Anormal'],
];

const F_CASCOS: FieldDef[] = [
  ['qualidade',  'Qualidade córnea',   'Normal', 'Anormal'],
  ['largura',    'Largura dos talões', 'Normal', 'Anormal'],
  ['ranilha',    'Ranilha',            'Normal', 'Anormal'],
  ['percussao',  'Percussão',          'Normal', 'Anormal'],
  ['tamanho',    'Tamanho / Formato',  'Normal', 'Anormal'],
];

const LOCOMOCAO_GROUPS = [
  { titulo: 'Passo em piso duro', items: [
    ['passo_reta','Em linha reta'],
    ['passo_esq', 'Pequeno círculo à esquerda'],
    ['passo_dir', 'Pequeno círculo à direita'],
  ] as [string,string][] },
  { titulo: 'Trote em piso duro', items: [
    ['trote_duro_reta','Em linha reta'],
    ['trote_duro_esq', 'Círculo à esquerda'],
    ['trote_duro_dir', 'Círculo à direita'],
  ] as [string,string][] },
  { titulo: 'Trote em piso macio', items: [
    ['trote_macio_esq','Círculo à esquerda'],
    ['trote_macio_dir','Círculo à direita'],
  ] as [string,string][] },
  { titulo: 'Galope em piso macio', items: [
    ['galope_esq','Círculo à esquerda'],
    ['galope_dir','Círculo à direita'],
  ] as [string,string][] },
];

const FLEXAO_JOINTS: [string,string][] = [
  ['boleto_ae',    'Boleto ant. esquerdo / Interfalangeana distal'],
  ['boleto_ad',    'Boleto ant. direito / Interfalangeana distal'],
  ['carpo_e',      'Carpo esquerdo'],
  ['carpo_d',      'Carpo direito'],
  ['boleto_pe',    'Boleto post. esquerdo'],
  ['boleto_pd',    'Boleto post. direito'],
  ['curvilhao_e',  'Curvilhão esquerdo'],
  ['curvilhao_d',  'Curvilhão direito'],
  ['patela_e',     'Patela esquerda'],
  ['patela_d',     'Patela direita'],
];

const GRAUS: Grau[]  = ['-', '±', '+', '++', '+++'];
const PATAS: Pata[]  = ['AE', 'AD', 'PE', 'PD'];

const RADIO_PARTES = [
  { key: 'casco_ae',    label: 'Casco AE' },
  { key: 'casco_ad',    label: 'Casco AD' },
  { key: 'boleto_ae',   label: 'Boleto AE' },
  { key: 'boleto_ad',   label: 'Boleto AD' },
  { key: 'boleto_pe',   label: 'Boleto PE' },
  { key: 'boleto_pd',   label: 'Boleto PD' },
  { key: 'curvilhao_e', label: 'Curvilhão E' },
  { key: 'curvilhao_d', label: 'Curvilhão D' },
  { key: 'patela_e',    label: 'Patela E' },
  { key: 'patela_d',    label: 'Patela D' },
];

const TABS: { id: Tab; label: string }[] = [
  { id: 'clinico-geral', label: 'Clínico Geral' },
  { id: 'fisiologia',    label: 'Fisiologia' },
  { id: 'musculo',       label: 'Músculo Esquelético' },
  { id: 'imagem',        label: 'Imagem' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const initB = (fields: FieldDef[]): Record<string,string> =>
  Object.fromEntries(fields.map(([k,,o1]) => [k, o1]));

const initPatas = (v: string): Record<Pata,string> =>
  ({ AE: v, AD: v, PE: v, PD: v });

const initFlexao = (): Record<string,{ sensivel: boolean; grau: Grau }> =>
  Object.fromEntries(FLEXAO_JOINTS.map(([k]) => [k, { sensivel: false, grau: '-' as Grau }]));

const initRadio = (): Record<string,number|null> =>
  Object.fromEntries(RADIO_PARTES.map(p => [p.key, null]));

// `hojeISO()` (utils/dateUtils) e nao `toISOString().slice(0,10)`: este ultimo
// devolve o dia em UTC, que a noite ja e AMANHA em qualquer fuso do Brasil.
const hoje = () => hojeISO();

// ─── Types (histórico) ────────────────────────────────────────────────────────

interface ExameCompraItem {
  id:              number;
  numero:          number | null;
  tipo:            string;
  dataSolicitacao: string;
  status:          string;
  observacao:      string | null;
  veterinario:     { id: number; fullName: string } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLaudo(obs: string | null): any {
  if (!obs) return null;
  try { return JSON.parse(obs); }
  catch { return null; }
}

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

const fmtNumero = (n: number | null | undefined) =>
  n != null ? `#${String(n).padStart(3, '0')}` : '—';

// ─── BinaryField ──────────────────────────────────────────────────────────────

function BinaryField({ label, opt1, opt2, value, obs, onChange, onObsChange }: {
  label: string; opt1: string; opt2: string;
  value: string; obs: string;
  onChange: (v: string) => void;
  onObsChange: (v: string) => void;
}) {
  return (
    <div className="py-1 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-700 flex-1 leading-snug">{label}</span>
        <div className="flex gap-1 shrink-0">
          {([opt1, opt2] as string[]).map((opt, i) => (
            <button key={opt} type="button" onClick={() => onChange(opt)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                value === opt
                  ? i === 0
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                    : 'bg-amber-100 text-amber-700 border-amber-300'
                  : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
              }`}
            >{opt}</button>
          ))}
        </div>
      </div>
      {value !== opt1 && (
        <input type="text" placeholder="Descrever alteração..."
          value={obs} onChange={e => onObsChange(e.target.value)}
          className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-amber-400"
        />
      )}
    </div>
  );
}

function BinarySection({ titulo, fields, values, obs, onChange, onObsChange }: {
  titulo?: string; fields: FieldDef[];
  values: Record<string,string>; obs: Record<string,string>;
  onChange: (k: string, v: string) => void;
  onObsChange: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-1">
      {titulo && <p className="text-xs font-bold text-gray-400 uppercase tracking-widest pb-1 text-center">{titulo}</p>}
      <div>
        {fields.map(([k, label, o1, o2]) => (
          <BinaryField key={k} label={label} opt1={o1} opt2={o2}
            value={values[k] ?? o1} obs={obs[k] ?? ''}
            onChange={v => onChange(k, v)} onObsChange={v => onObsChange(k, v)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── UploadArea ───────────────────────────────────────────────────────────────

function UploadArea({ files, onAdd, onRemove }: {
  files: File[];
  onAdd: (f: File[]) => void;
  onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const fmt = (b: number) => b < 1024 * 1024
    ? `${(b / 1024).toFixed(0)} KB`
    : `${(b / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="space-y-1.5">
      <input ref={ref} type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden"
        onChange={e => { if (e.target.files) { onAdd(Array.from(e.target.files)); e.target.value = ''; } }}
      />
      <button type="button" onClick={() => ref.current?.click()}
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2 border border-dashed border-emerald-400 rounded-lg text-xs text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
      >
        <Paperclip size={12} /> Anexar imagem ou documento
      </button>
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-700">
          <Paperclip size={11} className="text-gray-400 shrink-0" />
          <span className="flex-1 truncate">{f.name}</span>
          <span className="text-gray-400 shrink-0">{fmt(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)}
            className="text-gray-400 hover:text-red-500 transition-colors shrink-0 ml-1">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── ExameCompra ──────────────────────────────────────────────────────────────

export default function ExameCompra() {
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId?: string }>();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  // setSelectedAnimal (contexto) não aceita forma funcional como o setState do React —
  // esta ref evita closure velha ao checar o animal mais atual dentro do .then() abaixo.
  const selectedAnimalRef = useRef(selectedAnimal);
  useEffect(() => { selectedAnimalRef.current = selectedAnimal; }, [selectedAnimal]);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const [animais,        setAnimais]        = useState<AnimalSimples[]>([]);
  const [loadingAnimais, setLoadingAnimais] = useState(true);
  // Erro de ação exibido inline (substitui o toast de erro)
  // Erro fica na SUPERFÍCIE da ação que o disparou (padrão da aplicação):
  //  erroInline → carga da tela / abrir um exame do histórico (topo)
  //  erroSalvar → validação e falha do SALVAR, renderizado ABAIXO do rodapé
  // O formulário é longo: erro de salvar no topo aparece fora da tela e o usuário
  // clica em Salvar sem ver nada acontecer.
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const erroSalvarRef = useRef<HTMLDivElement>(null);
  const [abaAtiva,       setAbaAtiva]       = useState<Tab>('clinico-geral');
  const [dataSolicitacao,setDataSolicitacao]= useState(hoje());
  const [saving,         setSaving]         = useState(false);

  // Section states
  const [clinicoGeral,    setClinicoGeral]    = useState(initB(F_CLINICO));
  const [clinicoGeralObs, setClinicoGeralObs] = useState<Record<string,string>>({});
  const [cardio,    setCardio]    = useState(initB(F_CARDIO));
  const [cardioObs, setCardioObs] = useState<Record<string,string>>({});
  const [resp,    setResp]    = useState(initB(F_RESP));
  const [respObs, setRespObs] = useState<Record<string,string>>({});
  const [digest,    setDigest]    = useState(initB(F_DIGEST));
  const [digestObs, setDigestObs] = useState<Record<string,string>>({});
  const [urogen,    setUrogen]    = useState(initB(F_UROGEN));
  const [urogenObs, setUrogenObs] = useState<Record<string,string>>({});
  const [nervoso,    setNervoso]    = useState(initB(F_NERVOSO));
  const [nervosoObs, setNervosoObs] = useState<Record<string,string>>({});
  const [inspecao,    setInspecao]    = useState(initB(F_INSPECAO));
  const [inspecaoObs, setInspecaoObs] = useState<Record<string,string>>({});
  const [cascos,    setCascos]    = useState(initB(F_CASCOS));
  const [cascosObs, setCascosObs] = useState<Record<string,string>>({});
  const [pincamento,    setPincamento]    = useState(initPatas('Normal'));
  const [pincamentoObs, setPincamentoObs] = useState(initPatas(''));
  const [ferrageamento, setFerrageamento] = useState('Normal');
  const [ferrPatas,     setFerrPatas]     = useState(initPatas(''));
  const [locomocao, setLocomocao] = useState<Record<string,string>>(
    Object.fromEntries(LOCOMOCAO_GROUPS.flatMap(g => g.items.map(([k]) => [k, 'Normal'])))
  );
  const [locomocaoObs, setLocomocaoObs] = useState<Record<string,string>>({});
  const [flexao, setFlexao] = useState(initFlexao());
  const [raioX,           setRaioX]           = useState('LAUDO EM ANEXO');
  const [radioAval,       setRadioAval]       = useState(initRadio());
  const [raioXArquivos,   setRaioXArquivos]   = useState<File[]>([]);
  const [raioXLaudo,      setRaioXLaudo]      = useState('');
  const [ultrassom,       setUltrassom]       = useState('IMAGENS MAD E MAE – LAUDO EM ANEXO');
  const [ultrassomArquivos, setUltrassomArquivos] = useState<File[]>([]);
  const [ultrassomLaudo,  setUltrassomLaudo]  = useState('');
  const [endoscopia, setEndoscopia] = useState('');
  const [imgOutros,  setImgOutros]  = useState('');
  const [comportSuspeito, setComportSuspeito] = useState<boolean|null>(null);
  const [antiDopping,     setAntiDopping]     = useState<boolean|null>(null);
  const [antiDoppResult,  setAntiDoppResult]  = useState('');
  const [conclusao,      setConclusao]      = useState('');
  const [justificativa,  setJustificativa]  = useState('');

  const podeCriar = isGestor || podeExecutar('atendimento.exames.criar');

  // ── Estado do histórico ───────────────────────────────────────────────────
  const [historicoCompra,   setHistoricoCompra]   = useState<ExameCompraItem[]>([]);
  const [loadingHistorico,  setLoadingHistorico]  = useState(false);
  const [editingId,         setEditingId]         = useState<number | null>(null);

  /**
   * Camada de VISUALIZAÇÃO × formulário (a lógica de gravação não mudou).
   * A tela ABRE em leitura, mostrando o último laudo do paciente com as abas
   * desabilitadas; o formulário só entra por "Novo Exame" (cadastro) ou pelo lápis do
   * histórico (edição), e é só nele que existem Cancelar/Salvar.
   * `editingId` continua sendo "qual laudo está carregado nos campos" — em leitura é o
   * que está sendo EXIBIDO. Quem separa exibir de editar é `modoForm`: sem ele, o
   * `editingId` do laudo apenas visualizado faria o Salvar virar um PUT silencioso.
   */
  const [modoForm, setModoForm] = useState(false);

  // Registro que está na tela (cabeçalho da visualização e selo no histórico).
  const exameEmTela = historicoCompra.find(ex => ex.id === editingId) ?? null;

  const carregarHistoricoCompra = useCallback(async (animalIdParam: number): Promise<ExameCompraItem[]> => {
    setLoadingHistorico(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalIdParam}?limit=50`);
      if (!res.data) return [];
      const todos: ExameCompraItem[] = res.data?.dados ?? res.data ?? [];
      const compras = todos.filter(e => e.tipo === 'Compra');
      setHistoricoCompra(compras);
      return compras;
    } catch { return []; }
    finally { setLoadingHistorico(false); }
  }, []);

  const carregarAnimais = useCallback(async () => {
    setLoadingAnimais(true);
    try {
      const res = await api.get('/animais');
      if (!res.data) return;
      const lista: AnimalSimples[] = res.data?.dados ?? res.data ?? [];
      setAnimais(lista);
      if (!effectiveAnimalId && lista.length === 1)
        setSelectedAnimal(lista[0] as Parameters<typeof setSelectedAnimal>[0]);
    } catch { /* silencioso */ }
    finally { setLoadingAnimais(false); }
  }, []);

  const carregarAnimalPorId = useCallback(async (id: string) => {
    try {
      const res = await api.get(`/animais/${id}`);
      if (!res.data) return;
      setSelectedAnimal(res.data?.dados ?? res.data);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { if (!loadingPerms) carregarAnimais(); }, [loadingPerms]);
  useEffect(() => { if (animalId) carregarAnimalPorId(animalId); }, [animalId]);
  useEffect(() => {
    if (!selectedAnimal?.id) return;
    // Tela abre em VISUALIZAÇÃO com o laudo mais recente do paciente (a listagem vem
    // `orderBy dataSolicitacao desc` do backend, então é o primeiro). Sem exame
    // nenhum, cai no estado vazio e a única saída é o botão "Novo Exame".
    resetForm();
    setModoForm(false);
    carregarHistoricoCompra(selectedAnimal.id).then(compras => {
      if (compras[0]) handleEditar(compras[0], true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAnimal?.id]);

  // Logo da empresa/equipe para o laudo — busca best-effort, nunca bloqueia a tela.
  useEffect(() => {
    if (!selectedAnimal?.id || selectedAnimal.logoUrl !== undefined) return;
    const id = selectedAnimal.id;
    api.get(`/animais/${id}/logo-empresa`)
      .then(res => {
        const logoUrl = res.data?.dados?.logoUrl ?? null;
        const atual = selectedAnimalRef.current;
        if (atual && atual.id === id) setSelectedAnimal({ ...atual, logoUrl });
      })
      .catch(() => {});
  }, [selectedAnimal?.id, selectedAnimal?.logoUrl, setSelectedAnimal]);

  // ── Editar ────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditar = (ex: ExameCompraItem, silent = false) => {
    let laudo = parseLaudo(ex.observacao);
    if (!laudo) { setErroInline('Não foi possível carregar os dados do exame.'); return; }

    // Fallback para exames salvos no formato antigo (antes da correção do controller):
    // - formato create: laudo estava em grupos[0].laudoCompra
    // - formato update: laudo estava em laudo.obs (como JSON string aninhado)
    if (!laudo.clinicoGeral) {
      if (laudo.grupos?.[0]?.laudoCompra) {
        laudo = laudo.grupos[0].laudoCompra;
      } else if (typeof laudo.obs === 'string') {
        try { laudo = JSON.parse(laudo.obs); } catch { /* mantém laudo atual */ }
      }
    }

    const me = laudo.musculoEsqueletico ?? {};
    const img = laudo.imagem ?? {};
    setClinicoGeral(laudo.clinicoGeral?.valores ?? initB(F_CLINICO));
    setClinicoGeralObs(laudo.clinicoGeral?.obs ?? {});
    setCardio(laudo.cardiovascular?.valores ?? initB(F_CARDIO));
    setCardioObs(laudo.cardiovascular?.obs ?? {});
    setResp(laudo.respiratorio?.valores ?? initB(F_RESP));
    setRespObs(laudo.respiratorio?.obs ?? {});
    setDigest(laudo.digestivo?.valores ?? initB(F_DIGEST));
    setDigestObs(laudo.digestivo?.obs ?? {});
    setUrogen(laudo.urogenital?.valores ?? initB(F_UROGEN));
    setUrogenObs(laudo.urogenital?.obs ?? {});
    setNervoso(laudo.nervoso?.valores ?? initB(F_NERVOSO));
    setNervosoObs(laudo.nervoso?.obs ?? {});
    setInspecao(me.inspecao?.valores ?? initB(F_INSPECAO));
    setInspecaoObs(me.inspecao?.obs ?? {});
    setCascos(me.cascos?.valores ?? initB(F_CASCOS));
    setCascosObs(me.cascos?.obs ?? {});
    setPincamento(me.cascos?.pincamento ?? initPatas('Normal'));
    setPincamentoObs(me.cascos?.pincamentoObs ?? initPatas(''));
    setFerrageamento(me.ferrageamento?.tipo ?? 'Normal');
    setFerrPatas(me.ferrageamento?.patas ?? initPatas(''));
    setLocomocao(me.locomocao?.valores ?? Object.fromEntries(
      LOCOMOCAO_GROUPS.flatMap(g => g.items.map(([k]) => [k, 'Normal']))
    ));
    setLocomocaoObs(me.locomocao?.obs ?? {});
    setFlexao(me.flexao ?? initFlexao());
    setRaioX(img.raioX ?? 'LAUDO EM ANEXO');
    setRadioAval(img.radioAval ?? initRadio());
    setRaioXLaudo(img.raioXLaudo ?? '');
    setUltrassom(img.ultrassom ?? 'IMAGENS MAD E MAE – LAUDO EM ANEXO');
    setUltrassomLaudo(img.ultrassomLaudo ?? '');
    setEndoscopia(img.endoscopia ?? '');
    setImgOutros(img.outros ?? '');
    setComportSuspeito(img.comportamentoSuspeito ?? null);
    setAntiDopping(img.antiDopping ?? null);
    setAntiDoppResult(img.antiDoppingResultado ?? '');
    setConclusao(laudo.conclusao ?? '');
    setJustificativa('');
    setDataSolicitacao(ex.dataSolicitacao.slice(0, 10));
    setEditingId(ex.id);
    setAbaAtiva('clinico-geral');
    if (!silent) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Carrega o laudo nos campos SEM abrir o formulário — é a camada de leitura.
  const visualizarExame = (ex: ExameCompraItem) => {
    setErroSalvar(null);
    setModoForm(false);
    handleEditar(ex, true);
  };

  // Lápis do histórico: mesmo carregamento, mas com os campos liberados.
  const abrirEdicao = (ex: ExameCompraItem) => {
    setErroSalvar(null);
    setModoForm(true);
    handleEditar(ex);
  };

  /**
   * "Novo Exame" — zera os campos e entra no formulário. É o único caminho de cadastro:
   * a tela não abre mais em branco, então sem este botão não há como registrar um laudo.
   */
  const handleNovoExame = () => {
    setErroSalvar(null);
    resetForm();
    setModoForm(true);
  };

  const resetForm = () => {
    setClinicoGeral(initB(F_CLINICO));
    setClinicoGeralObs({});
    setCardio(initB(F_CARDIO));
    setCardioObs({});
    setResp(initB(F_RESP));
    setRespObs({});
    setDigest(initB(F_DIGEST));
    setDigestObs({});
    setUrogen(initB(F_UROGEN));
    setUrogenObs({});
    setNervoso(initB(F_NERVOSO));
    setNervosoObs({});
    setInspecao(initB(F_INSPECAO));
    setInspecaoObs({});
    setCascos(initB(F_CASCOS));
    setCascosObs({});
    setPincamento(initPatas('Normal'));
    setPincamentoObs(initPatas(''));
    setFerrageamento('Normal');
    setFerrPatas(initPatas(''));
    setLocomocao(Object.fromEntries(LOCOMOCAO_GROUPS.flatMap(g => g.items.map(([k]) => [k, 'Normal']))));
    setLocomocaoObs({});
    setFlexao(initFlexao());
    setRaioX('LAUDO EM ANEXO');
    setRadioAval(initRadio());
    setRaioXArquivos([]);
    setRaioXLaudo('');
    setUltrassom('IMAGENS MAD E MAE – LAUDO EM ANEXO');
    setUltrassomArquivos([]);
    setUltrassomLaudo('');
    setEndoscopia('');
    setImgOutros('');
    setComportSuspeito(null);
    setAntiDopping(null);
    setAntiDoppResult('');
    setConclusao('');
    setJustificativa('');
    setDataSolicitacao(hoje());
    setAbaAtiva('clinico-geral');
    setEditingId(null);
  };

  // Traz o erro do Salvar para a vista. `block: 'nearest'` não mexe na tela quando ele
  // já está visível — só corrige o caso de nascer logo abaixo da dobra.
  useEffect(() => {
    if (!erroSalvar) return;
    erroSalvarRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [erroSalvar]);

  /**
   * Cancelar do rodapé: sai sem salvar e VOLTA À VISUALIZAÇÃO do último laudo (o
   * registro do histórico fica intacto). Antes ele apenas zerava os campos e deixava o
   * formulário aberto e vazio — com a camada de leitura, "cancelar" tem para onde
   * voltar. Sem nenhum laudo registrado, cai no estado vazio.
   */
  const handleCancelarForm = () => {
    setErroSalvar(null);
    resetForm();
    setModoForm(false);
    if (historicoCompra[0]) handleEditar(historicoCompra[0], true);
  };

  // ── Imprimir ──────────────────────────────────────────────────────────────
  const imprimirLaudo = (ex: ExameCompraItem) => {
    imprimirExameCompra(ex, selectedAnimal ?? undefined);
  };

  // ── Compartilhar (WhatsApp/E-mail) ────────────────────────────────────────
  // Gera o PDF do laudo e abre o app escolhido — ver CompartilharPdfBotoes.
  const nomeArquivoLaudo = (ex: ExameCompraItem) =>
    `exame-compra${ex.numero != null ? `-${String(ex.numero).padStart(3, '0')}` : ''}`
    + `${selectedAnimal ? `-${selectedAnimal.nome.replace(/\s+/g, '-').toLowerCase()}` : ''}.pdf`;
  const textoCompartilhar = (ex: ExameCompraItem) =>
    `Segue o Laudo de Exame de Compra${selectedAnimal ? ` do ${selectedAnimal.nome}` : ''}`
    + `${ex.numero != null ? ` (nº ${String(ex.numero).padStart(3, '0')})` : ''}.`;

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
        </div>
      </PageContainer>
    );
  }

  const handleSalvar = async () => {
    setErroSalvar(null);
    if (!podeCriar) { setErroSalvar('Sem permissão para registrar exames.'); return; }
    if (!selectedAnimal) { setErroSalvar('Selecione um paciente.'); return; }
    if (!dataSolicitacao) { setErroSalvar('Informe a data do exame.'); return; }
    const isEditing = editingId !== null;

    if (isEditing && !justificativa.trim()) {
      setErroSalvar('Preencha a justificativa da alteração antes de salvar.');
      return;
    }
    setSaving(true);
    try {
      const laudo = {
        clinicoGeral:   { valores: clinicoGeral,  obs: clinicoGeralObs },
        cardiovascular: { valores: cardio,         obs: cardioObs },
        respiratorio:   { valores: resp,           obs: respObs },
        digestivo:      { valores: digest,         obs: digestObs },
        urogenital:     { valores: urogen,         obs: urogenObs },
        nervoso:        { valores: nervoso,        obs: nervosoObs },
        musculoEsqueletico: {
          inspecao:     { valores: inspecao,       obs: inspecaoObs },
          cascos:       { valores: cascos,         obs: cascosObs, pincamento, pincamentoObs },
          ferrageamento:{ tipo: ferrageamento,     patas: ferrPatas },
          locomocao:    { valores: locomocao,      obs: locomocaoObs },
          flexao,
        },
        imagem: {
          raioX, radioAval, raioXLaudo, ultrassom, ultrassomLaudo, endoscopia, outros: imgOutros,
          comportamentoSuspeito: comportSuspeito,
          antiDopping, antiDoppingResultado: antiDoppResult,
        },
        conclusao,
        ...(isEditing && justificativa.trim() && { justificativa: justificativa.trim() }),
      };
      const payload = {
        animalId: selectedAnimal.id, tipo: 'Compra',
        descricao: 'Laudo de Exame de Compra', dataSolicitacao,
        tipoAmostra: 'Exame Físico', observacao: JSON.stringify(laudo),
        grupos: [{ tipo: 'Compra', exames: ['Laudo de Compra Equino'], tipoAmostra: 'Exame Físico', laudoCompra: laudo }],
      };
      if (isEditing) {
        await api.put(`/clinica/exames/${editingId}`, payload);
      } else {
        await api.post('/clinica/exames', payload);
      }
      toast.success(isEditing ? 'Exame de Compra atualizado com sucesso' : 'Exame de Compra registrado com sucesso');
      // Salvou (novo ou atualização) → fecha o formulário e volta à VISUALIZAÇÃO já
      // mostrando o laudo gravado. `idSalvo` é lido antes do reset: editando um laudo
      // ANTIGO, o mais recente da lista não é o que a pessoa acabou de salvar, e cair
      // em outro registro daria a impressão de que a alteração não pegou.
      const idSalvo = editingId;
      resetForm();
      setModoForm(false);
      if (selectedAnimal?.id) {
        const compras = await carregarHistoricoCompra(selectedAnimal.id);
        const alvo = compras.find(c => c.id === idSalvo) ?? compras[0];
        if (alvo) handleEditar(alvo, true);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroSalvar(msg ?? 'Erro ao registrar exame');
    } finally { setSaving(false); }
  };

  // ── Tab renders ───────────────────────────────────────────────────────────

  const renderMusculo = () => (
    <div className="space-y-4">
      <BinarySection titulo="Inspeção, Palpação e/ou Percussão"
        fields={F_INSPECAO} values={inspecao} obs={inspecaoObs}
        onChange={(k,v) => setInspecao(p => ({ ...p, [k]: v }))}
        onObsChange={(k,v) => setInspecaoObs(p => ({ ...p, [k]: v }))}
      />

      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest pt-1 text-center">Cascos</p>
        <BinarySection fields={F_CASCOS} values={cascos} obs={cascosObs}
          onChange={(k,v) => setCascos(p => ({ ...p, [k]: v }))}
          onObsChange={(k,v) => setCascosObs(p => ({ ...p, [k]: v }))}
        />

        {/* Pinçamento */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium text-gray-700">Pinçamento</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PATAS.map(pata => (
              <div key={pata} className="space-y-1">
                <p className="text-xs font-bold text-gray-500 text-center">{pata}</p>
                <div className="flex gap-1">
                  {(['Normal','Anormal'] as string[]).map((opt, i) => (
                    <button key={opt} type="button"
                      onClick={() => setPincamento(p => ({ ...p, [pata]: opt }))}
                      className={`flex-1 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        pincamento[pata] === opt
                          ? i === 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                    : 'bg-amber-100 text-amber-700 border-amber-300'
                          : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                      }`}
                    >{opt}</button>
                  ))}
                </div>
                {pincamento[pata] === 'Anormal' && (
                  <input type="text" placeholder="Obs..."
                    value={pincamentoObs[pata]}
                    onChange={e => setPincamentoObs(p => ({ ...p, [pata]: e.target.value }))}
                    className="w-full border border-amber-200 bg-amber-50 rounded-lg px-2 py-1 text-xs focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Ferrageamento */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-700">Ferrageamento</span>
            <div className="flex gap-1">
              {(['Normal','Especial'] as string[]).map((opt, i) => (
                <button key={opt} type="button" onClick={() => setFerrageamento(opt)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    ferrageamento === opt
                      ? i === 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                : 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                  }`}
                >{opt}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PATAS.map(pata => (
              <div key={pata} className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 w-7 shrink-0">{pata}:</span>
                <input type="text" placeholder={`Ferradura ${pata}...`}
                  value={ferrPatas[pata]}
                  onChange={e => setFerrPatas(p => ({ ...p, [pata]: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-400"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Locomoção */}
      <div className="space-y-1">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest pb-1 text-center">Locomoção</p>
        <div className="">
          {LOCOMOCAO_GROUPS.map(group => (
            <div key={group.titulo}>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest pt-2 pb-0.5 text-center">{group.titulo}</p>
              <div className="">
                {group.items.map(([k, label]) => (
                  <div key={k} className="py-1 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-700 flex-1">{label}</span>
                      <div className="flex gap-1 shrink-0">
                        {(['Normal','Anormal'] as string[]).map((opt, i) => (
                          <button key={opt} type="button"
                            onClick={() => setLocomocao(p => ({ ...p, [k]: opt }))}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                              locomocao[k] === opt
                                ? i === 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                          : 'bg-amber-100 text-amber-700 border-amber-300'
                                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                            }`}
                          >{opt}</button>
                        ))}
                      </div>
                    </div>
                    {locomocao[k] === 'Anormal' && (
                      <input type="text" placeholder="Descrever..."
                        value={locomocaoObs[k] ?? ''}
                        onChange={e => setLocomocaoObs(p => ({ ...p, [k]: e.target.value }))}
                        className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Testes de Flexão */}
      <div className="space-y-1">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest pb-1 text-center">Testes de Flexão</p>
        <div className="">
          {FLEXAO_JOINTS.map(([k, label]) => {
            const item = flexao[k];
            return (
              <div key={k} className="py-1 space-y-1">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm text-gray-700 flex-1">{label}</span>
                  <div className="flex gap-1 shrink-0">
                    {(['Não sensível','Sensível'] as const).map((opt, i) => {
                      const active = i === 1 ? item.sensivel : !item.sensivel;
                      return (
                        <button key={opt} type="button"
                          onClick={() => setFlexao(p => ({ ...p, [k]: { ...p[k], sensivel: i === 1 } }))}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                            active
                              ? i === 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                        : 'bg-amber-100 text-amber-700 border-amber-300'
                              : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                          }`}
                        >{opt}</button>
                      );
                    })}
                  </div>
                </div>
                {item.sensivel && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-gray-500 mr-1">Grau:</span>
                    {GRAUS.map(g => (
                      <button key={g} type="button"
                        onClick={() => setFlexao(p => ({ ...p, [k]: { ...p[k], grau: g } }))}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          item.grau === g
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                        }`}
                      >{g}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderImagem = () => (
    <div className="space-y-4">
      {/* Raio-X */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Raio-X</p>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">
            Avaliação do Exame Radiológico
            <span className="font-normal text-gray-400 ml-1">
              (1=Bom · 2=Satisfatório · 3=Moderado · 4=Ruim · 5=Muito Ruim)
            </span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {RADIO_PARTES.map(p => (
              <div key={p.key} className="bg-gray-50 rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-xs text-gray-600 font-medium mb-1.5">{p.label}</p>
                <div className="flex gap-1">
                  {([null, 1, 2, 3, 4, 5] as (number|null)[]).map(v => (
                    <button key={String(v)} type="button"
                      onClick={() => setRadioAval(prev => ({ ...prev, [p.key]: v }))}
                      className={`w-7 h-7 rounded text-xs font-semibold border transition-colors ${
                        radioAval[p.key] === v
                          ? v === null
                            ? 'bg-gray-200 text-gray-600 border-gray-300'
                            : v <= 2
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                              : v === 3
                                ? 'bg-amber-100 text-amber-700 border-amber-300'
                                : 'bg-red-100 text-red-700 border-red-300'
                          : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-100'
                      }`}
                    >{v === null ? '–' : v}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <textarea rows={3} value={raioXLaudo} onChange={e => setRaioXLaudo(e.target.value)}
          placeholder="Laudo / observações do Raio-X..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 resize-none"
        />
        <UploadArea files={raioXArquivos}
          onAdd={f => setRaioXArquivos(p => [...p, ...f])}
          onRemove={i => setRaioXArquivos(p => p.filter((_, idx) => idx !== i))}
        />
      </div>

      {/* U.S. */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">U.S. (Ultrassonografia)</p>
        <input type="text" value={ultrassom} onChange={e => setUltrassom(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
        />
        <textarea rows={3} value={ultrassomLaudo} onChange={e => setUltrassomLaudo(e.target.value)}
          placeholder="Laudo / observações da Ultrassonografia..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 resize-none"
        />
        <UploadArea files={ultrassomArquivos}
          onAdd={f => setUltrassomArquivos(p => [...p, ...f])}
          onRemove={i => setUltrassomArquivos(p => p.filter((_, idx) => idx !== i))}
        />
      </div>

      {/* Endoscopia + Outros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Endoscopia</p>
          <input type="text" value={endoscopia} onChange={e => setEndoscopia(e.target.value)}
            placeholder="Resultado / observações..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
          />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Outros</p>
          <input type="text" value={imgOutros} onChange={e => setImgOutros(e.target.value)}
            placeholder="Outros exames complementares..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      {/* Comportamento suspeito + Anti-dopping */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
        {[
          { label: 'Indício de prática ou comportamento suspeito?', value: comportSuspeito, set: setComportSuspeito },
          { label: 'Após o exame foi coletado sangue para exame anti-dopping?', value: antiDopping, set: setAntiDopping },
        ].map(({ label, value, set }) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700 flex-1">{label}</span>
            <div className="flex gap-1 shrink-0">
              {([true, false] as boolean[]).map(v => (
                <button key={String(v)} type="button" onClick={() => set(v)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    value === v
                      ? v ? 'bg-amber-100 text-amber-700 border-amber-300'
                          : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                      : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                  }`}
                >{v ? 'Sim' : 'Não'}</button>
              ))}
            </div>
          </div>
        ))}
        {antiDopping === true && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 font-medium shrink-0">Resultado:</span>
            <input type="text" value={antiDoppResult} onChange={e => setAntiDoppResult(e.target.value)}
              placeholder="Resultado do anti-dopping..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-400"
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (abaAtiva) {
      case 'clinico-geral':
        return <BinarySection fields={F_CLINICO} values={clinicoGeral} obs={clinicoGeralObs}
          onChange={(k,v) => setClinicoGeral(p => ({ ...p, [k]: v }))}
          onObsChange={(k,v) => setClinicoGeralObs(p => ({ ...p, [k]: v }))} />;
      case 'fisiologia':
        return (
          <div className="space-y-5">
            <BinarySection titulo="Cardiovascular"
              fields={F_CARDIO} values={cardio} obs={cardioObs}
              onChange={(k,v) => setCardio(p => ({ ...p, [k]: v }))}
              onObsChange={(k,v) => setCardioObs(p => ({ ...p, [k]: v }))} />
            <BinarySection titulo="Respiratório"
              fields={F_RESP} values={resp} obs={respObs}
              onChange={(k,v) => setResp(p => ({ ...p, [k]: v }))}
              onObsChange={(k,v) => setRespObs(p => ({ ...p, [k]: v }))} />
            <BinarySection titulo="Digestório"
              fields={F_DIGEST} values={digest} obs={digestObs}
              onChange={(k,v) => setDigest(p => ({ ...p, [k]: v }))}
              onObsChange={(k,v) => setDigestObs(p => ({ ...p, [k]: v }))} />
            <BinarySection titulo="Urogenital"
              fields={F_UROGEN} values={urogen} obs={urogenObs}
              onChange={(k,v) => setUrogen(p => ({ ...p, [k]: v }))}
              onObsChange={(k,v) => setUrogenObs(p => ({ ...p, [k]: v }))} />
            <BinarySection titulo="Sistema Nervoso"
              fields={F_NERVOSO} values={nervoso} obs={nervosoObs}
              onChange={(k,v) => setNervoso(p => ({ ...p, [k]: v }))}
              onObsChange={(k,v) => setNervosoObs(p => ({ ...p, [k]: v }))} />
          </div>
        );
      case 'musculo': return renderMusculo();
      case 'imagem':  return renderImagem();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="5xl">
      <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium w-fit">
            <ArrowLeft size={16} /> Voltar
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity size={20} className="text-amber-600" />
            Exame de Compra
          </h1>
        </div>

        {/* Paciente — seletor logo após o título (padrão da aplicação).
            A DATA não é mais campo de tela: exame novo nasce com a data de hoje e a
            edição preserva a data com que o laudo foi registrado (ver `hoje()` no
            estado inicial e `handleEditar`). */}
        {animais.length > 0 && (
          <div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Paciente</label>
              <select value={effectiveAnimalId ?? ''}
                onChange={e => {
                  if (e.target.value === '__novo__') { navigate('/animais', { state: { returnTo: '/exame-compra' } }); return; }
                  const a = animais.find(x => x.id === Number(e.target.value));
                  if (!a) return;
                  setSelectedAnimal(a as Parameters<typeof setSelectedAnimal>[0]);
                  navigate(`/exame-compra/${a.id}`);
                }}
                className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:border-emerald-600 shadow-sm"
              >
                <option value="__novo__">+ Cadastrar novo paciente</option>
                <option disabled>──────────────</option>
                {animais.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>
          </div>
        )}

        {selectedAnimal && <AnimalCard animal={selectedAnimal} />}

        {!loadingAnimais && animais.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
            <Activity size={26} className="text-amber-400 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-800 mb-1">Nenhum paciente cadastrado</h3>
            <button onClick={() => navigate('/animais', { state: { returnTo: '/exame-compra' } })}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl">
              <PlusCircle size={16} /> Cadastrar novo paciente
            </button>
          </div>
        )}

        {!loadingAnimais && animais.length > 0 && !selectedAnimal && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 text-sm">
            <Activity size={16} className="shrink-0" />
            Selecione um paciente no seletor acima para preencher o exame.
          </div>
        )}

        {/* Nada registrado ainda: sem isso a tela ficaria só com o card do paciente,
            sem dizer que o histórico está vazio. Aqui o "Novo Exame" vem DENTRO do
            card — a barra de abas (onde ele mora normalmente) não é renderizada quando
            não há laudo a exibir, e sem esta cópia o cadastro ficaria sem porta.
            O gate é o histórico VAZIO, não `!exameEmTela`: laudo com JSON corrompido
            não carrega nos campos e diria "nenhum exame registrado" com o histórico
            cheio logo abaixo — ali quem fala é o erro do topo. */}
        {selectedAnimal && !modoForm && !loadingHistorico && historicoCompra.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <Activity size={22} className="text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium">Nenhum exame de compra registrado para este paciente</p>
            {podeCriar && (
              <button type="button" onClick={handleNovoExame}
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors">
                <PlusCircle size={16} /> Novo Exame
              </button>
            )}
          </div>
        )}

        {selectedAnimal && (modoForm || exameEmTela) && (
          <>
            {/* Cabeçalho do laudo em exibição — identifica QUAL registro está nas abas.
                No formulário ele não aparece: ali o contexto é o rodapé (Salvar). */}
            {!modoForm && exameEmTela && (
              <div className="flex items-center gap-2 flex-wrap px-1">
                <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200">
                  {fmtNumero(exameEmTela.numero)}
                </span>
                <span className="text-xs text-gray-500">{fmtData(exameEmTela.dataSolicitacao)}</span>
                {exameEmTela.veterinario && (
                  <span className="text-xs text-gray-400">· {exameEmTela.veterinario.fullName}</span>
                )}
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full uppercase">
                  Somente leitura
                </span>
              </div>
            )}

            {/* Barra de abas + "Novo Exame" na MESMA linha. As abas rolam no mobile
                (`overflow-x-auto`), o botão fica fora desse container e por isso não
                sai da tela junto com elas.
                FORA do fieldset de propósito: trocar de aba é navegação, não edição, e
                em leitura elas continuam clicáveis.
                CORES — em LEITURA a barra é cinza (clara; ativa em cinza escuro) e em
                EDIÇÃO segue emerald. ⚠️ É exceção deliberada à regra "cinza = ação
                indisponível" (CLAUDE.md §6): aqui não há ação sobre o registro, é
                navegação entre as seções de um laudo fechado — e o cinza é justamente o
                que diferencia, à primeira vista, a tela que só lê da que edita. */}
            <div className="flex items-start gap-2">
              <div className="overflow-x-auto -mx-1 px-1 pb-1 flex-1 min-w-0">
                <div className="flex gap-2 min-w-max">
                  {TABS.map(tab => (
                    <button key={tab.id} type="button" onClick={() => setAbaAtiva(tab.id)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors whitespace-nowrap ${
                        abaAtiva === tab.id
                          ? modoForm
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-gray-600 text-white border-gray-600 shadow-sm'
                          : modoForm
                            ? 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                      }`}
                    >{tab.label}</button>
                  ))}
                </div>
              </div>
              {!modoForm && podeCriar && (
                <button type="button" onClick={handleNovoExame}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors whitespace-nowrap">
                  <PlusCircle size={16} /> Novo Exame
                </button>
              )}
            </div>

            {/* `<fieldset disabled>` desabilita TODO controle descendente pelo próprio
                DOM — os ~320 linhas de campos das abas não precisaram de uma prop
                `somenteLeitura` cada. Também cobre o teclado (nada recebe foco), o que
                um `pointer-events-none` não faria. `min-w-0` neutraliza o
                `min-inline-size: min-content` que o UA aplica a fieldset e que
                estouraria o grid das abas. */}
            <fieldset disabled={!modoForm} className="space-y-5 min-w-0">
              {/* Tab content */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
                {renderTabContent()}
              </div>

              {/* Conclusão */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Conclusão / Parecer Final
                </label>
                <textarea rows={4} value={conclusao} onChange={e => setConclusao(e.target.value)}
                  placeholder={modoForm ? 'Impressões clínicas, recomendações, parecer para a compra...' : 'Sem conclusão registrada'}
                  className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-amber-500 resize-none shadow-sm disabled:bg-gray-50"
                />
              </div>
            </fieldset>

            {/* Justificativa de alteração — obrigatória ao editar exame existente */}
            {modoForm && editingId !== null && (
              <div>
                <label className="block text-xs font-bold text-amber-600 uppercase tracking-widest mb-1.5">
                  Justificativa da Alteração *
                </label>
                <textarea rows={2} value={justificativa} onChange={e => setJustificativa(e.target.value)}
                  placeholder="Informe o motivo da alteração neste exame de compra..."
                  className={`w-full border rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none resize-none shadow-sm ${
                    justificativa.trim() ? 'border-gray-200 focus:border-amber-500' : 'border-amber-300 bg-amber-50/40 focus:border-amber-500'
                  }`}
                />
              </div>
            )}

            {/* Rodapé no padrão da aplicação: ações à direita, Cancelar ao lado do
                Salvar. O rótulo é só "Salvar" — o nome do módulo já está no cabeçalho
                da tela, e repeti-lo no botão não informa nada. Vale para o cadastro E
                para a edição: o que muda é o estado do formulário, não a ação.
                SÓ no formulário: em leitura não há o que salvar nem o que cancelar. */}
            {modoForm && (
              <>
                <div className="flex items-center justify-end gap-3 pb-6">
                  <button type="button" onClick={handleCancelarForm} disabled={saving}
                    className="px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleSalvar} disabled={saving || !dataSolicitacao}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>

                {/* Erro ABAIXO do botão que o disparou. No topo da página ele ficava a
                    uma tela inteira de distância do Salvar — o usuário clicava e nada
                    parecia acontecer. `scrollIntoView` cobre o caso de nascer fora da dobra. */}
                <div ref={erroSalvarRef} className="pb-6">
                  <InlineError message={erroSalvar} />
                </div>
              </>
            )}
          </>
        )}

        {/* ── Histórico — SEMPRE lista todos os exames de compra do animal ── */}
        {selectedAnimal && (
          <div className="pb-8">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Exames de Compra</p>
              <span className="text-xs text-gray-400">
                {historicoCompra.length} registro{historicoCompra.length !== 1 ? 's' : ''}
              </span>
            </div>
            {loadingHistorico ? (
              <div className="flex justify-center py-8">
                <Loader2 size={18} className="animate-spin text-emerald-600" />
              </div>
            ) : historicoCompra.length === 0 ? (
              <p className="text-center text-sm text-gray-300 py-6">Nenhum exame de compra registrado</p>
            ) : (
              <JanelaLista className="space-y-2 pr-1">
                {historicoCompra.map(ex => {
                  const laudo = parseLaudo(ex.observacao);
                  // `editingId` é "o laudo carregado nos campos" — `modoForm` diz se ele
                  // está aberto para edição ou apenas sendo exibido acima.
                  const emEdicao   = modoForm  && editingId === ex.id;
                  const emExibicao = !modoForm && editingId === ex.id;
                  return (
                    <div key={ex.id} data-item-lista
                      className={`bg-white rounded-2xl border shadow-sm px-4 py-3 flex items-start gap-3 ${
                        emEdicao   ? 'border-amber-300 bg-amber-50/40'
                        : emExibicao ? 'border-emerald-300 bg-emerald-50/30'
                        : 'border-gray-200'
                      }`}>
                      <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Activity size={15} className="text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200">
                            {fmtNumero(ex.numero)}
                          </span>
                          <span className="text-xs text-gray-500">{fmtData(ex.dataSolicitacao)}</span>
                          {ex.veterinario && (
                            <span className="text-xs text-gray-400">· {ex.veterinario.fullName}</span>
                          )}
                          {emEdicao && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full uppercase">
                              Em edição
                            </span>
                          )}
                          {emExibicao && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full uppercase">
                              Em exibição
                            </span>
                          )}
                          {laudo?.justificativa && (
                            <span className="text-xs text-amber-600 italic">· Alt: {laudo.justificativa}</span>
                          )}
                        </div>
                        {laudo?.conclusao ? (
                          <p className="text-xs text-gray-600 line-clamp-2 mt-1 italic">{laudo.conclusao}</p>
                        ) : (
                          <p className="text-xs text-gray-300 italic mt-1">Sem conclusão registrada</p>
                        )}
                      </div>
                      {/* Paleta do módulo de Atendimento (CLAUDE.md §6): ação disponível
                          nasce PINTADA — ver emerald, alterar laranja, imprimir e e-mail
                          azuis, WhatsApp verde. Cinza é reservado ao indisponível. */}
                      <AcoesRegistro className="flex-shrink-0">
                        <AcaoRegistro tom="ver" icone={Eye} rotulo="Visualizar"
                          visivel={!emExibicao} onClick={() => visualizarExame(ex)} />
                        <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
                          visivel={podeCriar && !emEdicao} onClick={() => abrirEdicao(ex)} />
                        <AcaoRegistro tom="imprimir" icone={Printer} rotulo="Imprimir"
                          onClick={() => imprimirLaudo(ex)} />
                        <CompartilharPdfBotoes
                          gerarHtml={() => gerarHtmlExameCompra(ex, selectedAnimal ?? undefined)}
                          nomeArquivo={nomeArquivoLaudo(ex)}
                          texto={textoCompartilhar(ex)}
                          documento="Laudo de Exame de Compra"
                          titulo={`Laudo de Exame de Compra${selectedAnimal ? ` — ${selectedAnimal.nome}` : ''}`}
                          telefone={selectedAnimal?.user?.phone}
                          emailPara={selectedAnimal?.user?.email}
                        />
                      </AcoesRegistro>
                    </div>
                  );
                })}
              </JanelaLista>
            )}
          </div>
        )}

      </div>
    </PageContainer>
  );
}
