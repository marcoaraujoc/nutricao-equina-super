// src/pages/EquipeManager.tsx
//
// CRIAÇÃO DE EMPRESA — tela do ADMIN da plataforma (`/admin/empresas`).
//
// ⚠️ NÃO confundir com `/cadastro/empresa` (CadastroEmpresa.tsx): lá o GESTOR edita o
// cadastro da PRÓPRIA empresa; aqui o ADMIN cria as empresas dos clientes, com plano e
// gestor(es), e administra as equipes de cada uma.
//
// O layout segue `CadastroEmpresa` de propósito — são as duas telas de empresa e a
// comparação entre elas é imediata. O que as mantém iguais não é disciplina, é código:
// `PageContainer` + `BotaoVoltar` + cabeçalho com ícone emerald, e os campos pelo
// `Campo`/`INPUT_CLS` compartilhados (components/CampoForm.tsx).

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Building2, Power, Pencil,
  Users, Check, X, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { classeErro, type ErroAcaoDados } from '../components/ErroAcao';
import Campo, { INPUT_CLS } from '../components/CampoForm';
import { isValidEmail } from '../utils/validators';
import { mascaraDocumento, mascaraTelefone, soDigitos } from '../utils/mascaras';

// Espécies que a empresa pode declarar como atendidas — a MESMA lista da tela de
// Configurações. Presa a NOMES, não a IDs: o id de Especie varia por base.
const ESPECIES_PERMITIDAS = ['EQUINO', 'BOVINO'];
const normalizarNome = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

// ─── Types ────────────────────────────────────────────────────────────────────

// ⚠️ Formato ANINHADO — é o que `GET /equipes/:id/membros` (EquipeController.
// listarMembrosPorEquipe) sempre devolveu, o mesmo que `ControleAcesso.tsx` já
// consome (`membro.user.fullName`/`.email`/`.id`). NÃO tem `cargoLabel` pronto —
// o rótulo é derivado aqui via CARGO_LABEL.
interface Membro {
  id: number; cargo: string; userId: number;
  user: { fullName: string; email: string; phone?: string | null; crmv?: string | null };
}

// Mesmos rótulos de Usuarios.tsx (CARGO_LABEL) — cargo é enum cru no banco.
const CARGO_LABEL: Record<string, string> = {
  GESTOR: 'Gestor', VETERINARIO: 'Veterinário', ESTAGIARIO: 'Estagiário',
  FORNECEDOR: 'Fornecedor', PROPRIETARIO: 'Proprietário', SECRETARIA: 'Secretária',
  FINANCEIRO: 'Financeiro', ENFERMEIRO: 'Enfermeiro(a)', ADMIN: 'Administrador',
};

interface ConvitePendente {
  id: number; email: string; cargo: string; createdAt: string;
}

interface Equipe {
  id: number; nome: string;
  membros?: Membro[]; convitesPendentes?: ConvitePendente[];
}

interface Empresa {
  id: number; nome: string; cnpj?: string | null; telefone?: string | null;
  // `documento` é a AUTORIDADE do CPF/CNPJ; `cnpj` só existe quando é um CNPJ (ele
  // também SINALIZA "empresa pessoal" para o escopo da configuração — ver o backend).
  documento?: string | null; endereco?: string | null;
  status?: string;
  equipes: Equipe[];
  configuracoes?: { equipeId: number | null; especiesAtendidas: string | null }[];
  // Plano atual, para o formulário de edição pré-selecionar o mesmo que a criação usa.
  // Ausente (legado sem assinatura) → o seletor abre em "Selecione o plano".
  assinatura?: { planoId: number } | null;
}

// ⚠️ `CARGOS` (cargos do convite) foi REMOVIDA (2026-08-16) junto com o convite — era
// usada só pelo formulário que o EquipePanel não tem mais.

const BTN_PRIMARIO =
  'flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 ' +
  'disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors';
const BTN_SECUNDARIO =
  'flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-600 ' +
  'text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors';
const TITULO_SECAO = 'text-[11px] font-bold text-gray-500 uppercase tracking-widest';

// ─── Sub-componente: linha editável do GESTOR ──────────────────────────────────

// ⚠️ EXCEÇÃO à regra "este painel é só leitura" (comentário abaixo): o gestor da
// empresa é o ÚNICO membro que o ADMIN da plataforma pode editar por aqui — os
// demais são administração da EQUIPE, do gestor. Reusa o MESMO endpoint que
// `Equipe.tsx` já usa para editar qualquer membro (`PUT /equipes/membros/:id`,
// EquipeController.atualizarMembro): ali o bloqueio "gestor não edita gestor"
// só vale para quem NÃO é ADMIN da plataforma — o ADMIN sempre passa.
// Nome e telefone gravam no perfil DESTA empresa (ProfissionalPerfil/
// UsuarioEmpresa, via o próprio controller) — nunca direto no `User` global, ou
// a edição vazaria para as outras clínicas do mesmo gestor (armadilha 36-e).
function GestorEditRow({ gestor }: { gestor: Membro }) {
  const [fullName, setFullName] = useState(gestor.user.fullName);
  const [email,    setEmail]    = useState(gestor.user.email);
  const [phone,    setPhone]    = useState(gestor.user.phone ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState<string | null>(null);

  // Troca de gestor (empresa diferente) ou dado que chegou depois do fetch inicial
  // do EquipePanel — ressincroniza os campos com o que veio do servidor.
  useEffect(() => {
    setFullName(gestor.user.fullName);
    setEmail(gestor.user.email);
    setPhone(gestor.user.phone ?? '');
    setErro(null);
  }, [gestor.id, gestor.user.fullName, gestor.user.email, gestor.user.phone]);

  const handleSalvar = async () => {
    setErro(null);
    if (!fullName.trim())       { setErro('Nome é obrigatório.'); return; }
    if (!isValidEmail(email.trim())) { setErro('E-mail inválido.'); return; }
    setSalvando(true);
    try {
      await api.put(`/equipes/membros/${gestor.id}`, {
        fullName: fullName.trim(),
        email:    email.trim().toLowerCase(),
        phone:    phone.trim() || null,
      });
      toast.success('Gestor atualizado!');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem;
      setErro(msg ?? 'Erro ao salvar o gestor.');
    } finally { setSalvando(false); }
  };

  return (
    <div className="p-3 bg-purple-50 rounded-xl space-y-2 w-full">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={fullName} onChange={e => setFullName(e.target.value)}
          placeholder="Nome" className={`${INPUT_CLS} bg-white`} />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="E-mail" className={`${INPUT_CLS} bg-white`} />
        <input value={phone} onChange={e => setPhone(mascaraTelefone(e.target.value))}
          placeholder="(11) 98765-4321" className={`${INPUT_CLS} bg-white`} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex-shrink-0">
          GESTOR
        </span>
        <button type="button" onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-xs font-semibold rounded-lg transition-colors">
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Salvar
        </button>
      </div>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}

// ─── Sub-componente: Painel de equipe expandida ───────────────────────────────

// A ÚNICA função do ADMIN aqui é CRIAR a empresa e VER os membros que o GESTOR
// montou (2026-08-16) — nada de convidar nem remover: isso é administração da
// EQUIPE, e quem administra a equipe é o gestor, no Controle de Acesso dele. Este
// painel é puramente de LEITURA — a edição do gestor mora no topo do formulário
// (GestorEditRow), não aqui.
function EquipePanel({ equipe, mostrarNome = true, onGestores }: {
  equipe: Equipe; mostrarNome?: boolean; onGestores?: (gestores: Membro[]) => void;
}) {
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  // Um ou mais — "Outros gestores" na criação vira mais de um membro cargo GESTOR
  // na MESMA equipe.
  const [gestores,  setGestores]  = useState<Membro[]>([]);
  const [membros,   setMembros]   = useState<Membro[]>([]);
  const [loadingM,  setLoadingM]  = useState(true);
  // Painel nasce CONTRAÍDO — é lista informativa, não o dado principal da tela
  // (o gestor em si é exibido logo no topo do formulário de edição, à parte).
  const [expandido, setExpandido] = useState(false);

  const carregarMembros = async () => {
    setLoadingM(true);
    try {
      const res = await api.get(`/equipes/${equipe.id}/membros`);
      if (!res.data) return;                       // GET 403 → data null (armadilha 23)
      // ⚠️ `dados` É o array de membros, no formato ANINHADO de `membro.user.*`
      // (mesmo que `ControleAcesso.tsx` consome) — não um objeto achatado.
      const lista: Membro[] = Array.isArray(res.data.dados) ? res.data.dados : [];
      // O(s) GESTOR(es) aparecem como membros da própria equipe (cargo GESTOR), mas
      // não foram "adicionados" por ninguém — são os donos. Exibidos À PARTE, no
      // topo do painel; a lista abaixo é só quem eles trouxeram.
      const gestoresDaEquipe = lista.filter(m => m.cargo === 'GESTOR');
      setGestores(gestoresDaEquipe);
      setMembros(lista.filter(m => m.cargo !== 'GESTOR'));
      setErroCarga(null);
      onGestores?.(gestoresDaEquipe);
    } catch { setErroCarga('Erro ao carregar membros'); }
    finally  { setLoadingM(false); }
  };

  useEffect(() => { carregarMembros(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = gestores.length + membros.length;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <InlineError message={erroCarga} className="m-3" />

      {/* Cabeçalho SEMPRE visível — é o que abre/fecha o painel. Nome da equipe só
          aparece quando há mais de uma (é o que distingue uma da outra); com uma
          só, ele nem costuma dizer nada — herdou o da própria empresa. */}
      <button type="button" onClick={() => setExpandido(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <Users size={15} className="text-emerald-600 flex-shrink-0" />
          <span className="font-semibold text-gray-800 text-sm truncate">
            {mostrarNome ? equipe.nome : 'Membros da equipe'}
          </span>
          {!loadingM && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 flex-shrink-0">
              {total}
            </span>
          )}
        </span>
        {expandido
          ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
          : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
      </button>

      {expandido && (
        <div className="p-4">
          {loadingM ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-emerald-600" />
            </div>
          ) : (
            <div className="space-y-3">
              {gestores.map(g => (
                <div key={g.id} className="flex items-center justify-between py-2 px-3 bg-purple-50 rounded-xl">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{g.user.fullName}</p>
                    <p className="text-xs text-gray-400 truncate">{g.user.email}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex-shrink-0">
                    GESTOR
                  </span>
                </div>
              ))}
              {membros.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Nenhum membro cadastrado pelo gestor ainda.</p>
              ) : (
                <div className="space-y-2">
                  {membros.map(m => (
                    <div key={m.id} className="py-2 border-b border-gray-50 last:border-0">
                      <p className="text-sm font-medium text-gray-800">{m.user.fullName}</p>
                      <p className="text-xs text-gray-400">
                        {m.user.email} · {CARGO_LABEL[m.cargo] ?? m.cargo}
                        {m.user.crmv ? ` · CRMV ${m.user.crmv}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EquipeManager() {
  const [empresas,      setEmpresas]      = useState<Empresa[]>([]);
  const [loading,       setLoading]       = useState(true);

  // Form empresa — o MESMO formulário cria e edita. `empEditId` diz qual dos dois:
  // null = criação. Duas telas separadas para os mesmos campos divergiriam no primeiro
  // ajuste, e plano/gestores (que só existem na criação) já são o que as diferencia.
  const [showEmpForm,   setShowEmpForm]   = useState(false);
  const [empEditId,     setEmpEditId]     = useState<number | null>(null);
  // Equipes da empresa sendo editada — para exibir os membros no formulário
  const [empEquipesEdit, setEmpEquipesEdit] = useState<Equipe[]>([]);
  // Gestor(es) resolvido(s) pelos EquipePanel abaixo (por equipeId) — exibidos
  // também aqui em cima, no corpo do formulário de edição, para não depender de o
  // usuário abrir/achar o painel "Membros da equipe" mais embaixo.
  const [gestoresEdit, setGestoresEdit] = useState<Record<number, Membro[]>>({});
  const [empNome,       setEmpNome]       = useState('');
  const [empCnpj,       setEmpCnpj]       = useState('');
  const [empTel,        setEmpTel]        = useState('');
  // Nome da equipe que nasce com a empresa — OPCIONAL (em branco = nome da empresa)
  const [empEqNome,     setEmpEqNome]     = useState('');
  const [savingEmp,     setSavingEmp]     = useState(false);
  // A empresa nasce com um PLANO e com um ou mais GESTORES.
  const [empPlanoId,       setEmpPlanoId]       = useState('');
  const [empGestorEmail,   setEmpGestorEmail]   = useState('');
  const [empGestorNome,    setEmpGestorNome]    = useState('');
  const [empGestoresExtras, setEmpGestoresExtras] = useState(''); // e-mails separados por vírgula
  const [planos, setPlanos] = useState<{ id: number; nome: string; precoMensal: number | null }[]>([]);
  // Espécies que a clínica atende — obrigatórias já na criação, porque são elas que
  // filtram o catálogo de especialidades (§15). Vão para EmpresaConfiguracao, o MESMO
  // lugar que a tela de Configurações edita depois.
  const [especies, setEspecies] = useState<{ id: number; nome: string }[]>([]);
  const [empEspecies, setEmpEspecies] = useState<number[]>([]);

  // Erro de CARGA no topo; erro de AÇÃO na superfície que o disparou (§6 CLAUDE.md).
  const [erroInline,  setErroInline]  = useState<string | null>(null);
  const [erroEmpresa, setErroEmpresa] = useState<ErroAcaoDados | null>(null);
  const [erroLista,   setErroLista]   = useState<ErroAcaoDados | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/empresas');
      if (!res.data) { setErroInline('Sem permissão para listar empresas.'); return; }
      setEmpresas(res.data.dados ?? []);
      setErroInline(null);
    } catch { setErroInline('Erro ao carregar empresas'); }
    finally  { setLoading(false); }
  };

  useEffect(() => { carregar(); }, []);

  // Planos ativos para o seletor da nova empresa (só o ADMIN alcança; GET 403 → data null).
  useEffect(() => {
    api.get('/planos?ativos=1')
      .then(res => { if (res.data) setPlanos(res.data.dados ?? []); })
      .catch(() => { /* silencioso: não-admin não vê planos */ });
  }, []);

  // Espécies oferecidas: leitura DIRETA de `tb_especies` (GET /especies).
  // ⚠️ NÃO usar /especialidades/especies aqui: aquele endpoint deriva a lista de
  // `tb_especialidades` (distinct por especie_id) e só devolve espécie que JÁ tenha
  // especialidade cadastrada — espécie nova, ou base sem o seed de especialidades,
  // simplesmente não apareceria. Quem responde "que espécie a clínica atende" é o
  // catálogo de espécies, não o de especialidades.
  // Filtro por NOME e não por id: o id de Especie varia por base.
  useEffect(() => {
    api.get('/especies')
      .then(res => {
        const lista = res.data?.dados ?? res.data ?? [];
        setEspecies(Array.isArray(lista)
          ? lista.filter((e: { nome: string }) => ESPECIES_PERMITIDAS.includes(normalizarNome(e.nome)))
          : []);
      })
      .catch(() => setEspecies([]));
  }, []);

  const limparFormEmpresa = () => {
    setEmpEditId(null);
    setEmpNome(''); setEmpCnpj(''); setEmpTel(''); setEmpEqNome(''); setEmpEspecies([]);
    setEmpPlanoId(''); setEmpGestorEmail(''); setEmpGestorNome(''); setEmpGestoresExtras('');
    setEmpEquipesEdit([]);
    setGestoresEdit({});
  };

  const abrirEdicaoEmpresa = (emp: Empresa) => {
    setErroEmpresa(null);
    setGestoresEdit({});
    setEmpEditId(emp.id);
    setEmpNome(emp.nome);
    // O documento pode estar em `documento` (autoridade) ou só no `cnpj` legado, na
    // empresa que ainda não passou pelo cadastro fiscal.
    setEmpCnpj(mascaraDocumento(emp.documento || emp.cnpj || ''));
    setEmpTel(emp.telefone ? mascaraTelefone(emp.telefone) : '');
    setEmpEqNome('');
    // ⚠️ `n > 0` não é zelo: `''.split(',')` é `['']` e `Number('')` é **0**, que passa
    // por `Number.isInteger`. Sem este corte, empresa SEM configuração abria o formulário
    // já com `[0]` — a tela não mostrava nada marcado (não existe espécie 0), mas o
    // salvar enviava o 0 junto e o backend recusava com "Espécie inválida".
    const csv = emp.configuracoes?.find(c => c.especiesAtendidas)?.especiesAtendidas ?? '';
    setEmpEspecies(csv.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0));
    // Mesmo formulário da criação, editável: o plano atual vem pré-selecionado.
    setEmpPlanoId(emp.assinatura?.planoId ? String(emp.assinatura.planoId) : '');
    // Armazenar as equipes da empresa para exibir os membros no formulário
    setEmpEquipesEdit(emp.equipes ?? []);
    setShowEmpForm(true);
  };

  const handleCriarEmpresa = async () => {
    setErroEmpresa(null);
    // ⚠️ Nome da EQUIPE saiu da validação (2026-08-06): em branco, o backend usa o nome
    // da EMPRESA. Manter a exigência aqui só devolveria um 400 que o servidor não dá mais.
    if (!empNome.trim())        { setErroEmpresa({ mensagem: 'Nome da empresa é obrigatório.', campos: ['nome'] }); return; }
    // Documento identifica o assinante: obrigatório e único entre empresas. O tamanho
    // é conferido aqui só para não gastar um POST; quem decide a unicidade é o backend.
    const empDoc = soDigitos(empCnpj);
    if (!empDoc) {
      setErroEmpresa({ mensagem: 'CNPJ / CPF é obrigatório.', campos: ['cnpj'] }); return;
    }
    if (empDoc.length !== 11 && empDoc.length !== 14) {
      setErroEmpresa({ mensagem: 'Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ).', campos: ['cnpj'] }); return;
    }
    if (!empTel.trim())         { setErroEmpresa({ mensagem: 'Telefone é obrigatório.', campos: ['telefone'] }); return; }
    // Espécies definem o catálogo de especialidades da clínica (§15) — sem elas a
    // agenda nasce sem nada para escolher.
    if (empEspecies.length === 0) {
      setErroEmpresa({ mensagem: 'Selecione ao menos uma espécie atendida.', campos: ['especies'] }); return;
    }

    // Plano é o MESMO formulário da criação, editável — o ADMIN pode trocar o plano
    // daqui, sem tela à parte. Obrigatório nos dois modos.
    if (!empPlanoId) { setErroEmpresa({ mensagem: 'Selecione um plano para a empresa.', campos: ['plano'] }); return; }

    // Gestor é só da CRIAÇÃO: a empresa já existente já tem equipe e vínculo de
    // gestor, com ciclo próprio (entra/sai pelo Controle de Acesso, não por aqui).
    if (!empEditId) {
      if (!empGestorEmail.trim()) { setErroEmpresa({ mensagem: 'Informe o e-mail do gestor responsável.', campos: ['gestorEmail'] }); return; }
      if (!isValidEmail(empGestorEmail.trim())) {
        setErroEmpresa({ mensagem: 'E-mail do gestor inválido.', campos: ['gestorEmail'] }); return;
      }
    }

    // 1 ou mais gestores: o principal (vira dono) + extras por e-mail.
    const gestores = [
      { email: empGestorEmail.trim(), fullName: empGestorNome.trim() || undefined },
      ...empGestoresExtras.split(',').map(e => e.trim()).filter(Boolean).map(email => ({ email })),
    ];

    setSavingEmp(true);
    try {
      if (empEditId) {
        await api.put(`/equipes/empresas/${empEditId}`, {
          nome: empNome.trim(), cnpj: empDoc, telefone: empTel.trim(),
          especiesAtendidas: empEspecies, planoId: Number(empPlanoId),
        });
        toast.success('Empresa atualizada!');
      } else {
        await api.post('/equipes/empresas', {
          nome: empNome.trim(), cnpj: empDoc, telefone: empTel.trim(),
          // Em branco não vai como string vazia: o backend distingue "não informado"
          // (herda o nome da empresa) de um valor que ele teria de validar.
          equipeNome: empEqNome.trim() || undefined,
          planoId: Number(empPlanoId), gestores,
          especiesAtendidas: empEspecies,
        });
        toast.success('Empresa criada!');
      }
      limparFormEmpresa();
      setShowEmpForm(false);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem;
      setErroEmpresa({ mensagem: msg ?? (empEditId ? 'Erro ao atualizar empresa' : 'Erro ao criar empresa') });
    } finally { setSavingEmp(false); }
  };

  const handleAlterarStatus = async (empresaId: number, statusAtual: string) => {
    const novo = statusAtual === 'ATIVA' ? 'SUSPENSA' : 'ATIVA';
    const acao = novo === 'SUSPENSA' ? 'inativar' : 'reativar';
    if (!window.confirm(`Deseja ${acao} esta empresa? ${novo === 'SUSPENSA' ? 'Ninguém conseguirá acessá-la enquanto estiver inativa.' : ''}`)) return;
    setErroLista(null);
    try {
      await api.patch(`/equipes/empresas/${empresaId}/status`, { status: novo });
      toast.success(novo === 'SUSPENSA' ? 'Empresa inativada' : 'Empresa reativada');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem;
      setErroLista({ mensagem: msg ?? 'Erro ao alterar o status' });
    }
  };

  // ⚠️ `handleCriarEquipe`, `handleConvidar` e `handleRemoverMembro` foram REMOVIDAS
  // (2026-08-16): criar equipe, convidar e remover membro são decisão do GESTOR da
  // empresa, não do ADMIN da plataforma — ele administra a CARTEIRA de clientes e só
  // VÊ quem o gestor colocou em cada equipe (ver EquipePanel).

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={24} className="text-emerald-600 flex-shrink-0" />
            Criação de Empresa
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading
              ? 'Carregando…'
              : `${empresas.length} ${empresas.length === 1 ? 'empresa cadastrada' : 'empresas cadastradas'}`}
          </p>
        </div>
        <button onClick={() => { limparFormEmpresa(); setShowEmpForm(f => !f); setErroEmpresa(null); }}
          className={`${BTN_PRIMARIO} flex-shrink-0`}>
          Nova empresa
        </button>
      </div>

      {/* ── Nova empresa / edição ────────────────────────────────────────── */}
      {showEmpForm && (
        <section className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 mb-4">
          <h2 className={`${TITULO_SECAO} mb-4`}>{empEditId ? 'Editar empresa' : 'Nova empresa'}</h2>

          {/* Gestor é só CAMPO na criação (abaixo). Na edição, aqueles campos somem
              — o VÍNCULO (quem é gestor) se administra no Controle de Acesso —,
              mas os DADOS do gestor (nome/e-mail/telefone) são editáveis aqui: é
              a mesma ação de "editar membro" que o gestor de equipe já tem em
              `/equipe`, só que o ADMIN da plataforma também pode fazer nela
              mesmo (ver GestorEditRow). Vem do(s) EquipePanel via onGestores. */}
          {empEditId && (
            <div className="mb-4">
              <p className={`${TITULO_SECAO} mb-2`}>Gestor responsável</p>
              {Object.values(gestoresEdit).flat().length === 0 ? (
                <p className="text-xs text-gray-400">Carregando…</p>
              ) : (
                <div className="space-y-2">
                  {Object.values(gestoresEdit).flat().map(g => (
                    <GestorEditRow key={g.id} gestor={g} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <Campo label="NOME DA EMPRESA *" className="sm:col-span-3">
              <input value={empNome} onChange={e => setEmpNome(e.target.value)}
                className={classeErro(erroEmpresa, 'nome', INPUT_CLS)} />
            </Campo>
            {/* Um campo só para os dois documentos: a clínica pessoa física assina com
                CPF. A máscara troca de formato pelo comprimento (utils/mascaras.ts). */}
            <Campo label="CNPJ / CPF *" className="sm:col-span-3">
              <input value={empCnpj} placeholder="00.000.000/0000-00"
                onChange={e => setEmpCnpj(mascaraDocumento(e.target.value))}
                className={classeErro(erroEmpresa, 'cnpj', INPUT_CLS)} />
            </Campo>

            <Campo label="TELEFONE *" className="sm:col-span-3">
              <input value={empTel} placeholder="(11) 3333-4444"
                onChange={e => setEmpTel(mascaraTelefone(e.target.value))}
                className={classeErro(erroEmpresa, 'telefone', INPUT_CLS)} />
            </Campo>
            {/* A empresa nasce com uma equipe (o gestor precisa de vínculo GESTOR nela),
                mas nomeá-la é opcional — em branco ela recebe o nome da empresa.
                Só na criação: a empresa existente já tem as equipes dela. */}
            {!empEditId && (
              <Campo label="NOME DA EQUIPE" className="sm:col-span-3"
                ajuda="Em branco, a equipe recebe o nome da empresa.">
                <input value={empEqNome} onChange={e => setEmpEqNome(e.target.value)}
                  className={INPUT_CLS} />
              </Campo>
            )}

            {/* ESPÉCIES ATENDIDAS — é o que filtra o catálogo de especialidades da
                clínica (§15). Guardadas na EmpresaConfiguracao, o mesmo lugar que a
                tela de Configurações edita depois. */}
            <Campo label="ESPÉCIES ATENDIDAS *" className="sm:col-span-6">
              <div className="flex flex-wrap gap-2">
                {especies.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma espécie disponível no catálogo.</p>
                ) : especies.map(e => {
                  const marcada = empEspecies.includes(e.id);
                  return (
                    <button key={e.id} type="button"
                      onClick={() => setEmpEspecies(prev =>
                        marcada ? prev.filter(i => i !== e.id) : [...prev, e.id])}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                        marcada
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-400'
                      }`}>
                      {e.nome}
                    </button>
                  );
                })}
              </div>
            </Campo>

            {/* PLANO — define valor, limite de acessos e validade. Mesmo formulário da
                criação, editável: trocar o plano aqui atualiza a assinatura (o
                vencimento só é recalculado quando o plano MUDA de verdade — salvar
                outro campo sem trocar o plano não reinicia o prazo). */}
            <Campo label="PLANO *" className="sm:col-span-6">
              <select value={empPlanoId} onChange={e => setEmpPlanoId(e.target.value)}
                className={`${classeErro(erroEmpresa, 'plano', INPUT_CLS)} bg-white`}>
                <option value="">Selecione o plano</option>
                {planos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nome}{p.precoMensal != null ? ` — ${p.precoMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês` : ''}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          {/* Gestor é só da CRIAÇÃO. Na edição ele some: o vínculo se administra no
              Controle de Acesso (incluir/remover membro), não por aqui. */}
          {!empEditId && (
            <>
              <h2 className={`${TITULO_SECAO} mt-5 mb-4`}>Gestor responsável</h2>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                {/* O 1º gestor vira DONO da empresa. Usuário novo nasce com senha padrão. */}
                <Campo label="E-MAIL DO GESTOR *" className="sm:col-span-3">
                  <input type="email" value={empGestorEmail} onChange={e => setEmpGestorEmail(e.target.value)}
                    className={classeErro(erroEmpresa, 'gestorEmail', INPUT_CLS)} />
                </Campo>
                <Campo label="NOME DO GESTOR" className="sm:col-span-3">
                  <input value={empGestorNome} onChange={e => setEmpGestorNome(e.target.value)}
                    className={INPUT_CLS} />
                </Campo>
                <Campo label="OUTROS GESTORES" className="sm:col-span-6"
                  ajuda="E-mails separados por vírgula.">
                  <input value={empGestoresExtras} onChange={e => setEmpGestoresExtras(e.target.value)}
                    className={INPUT_CLS} />
                </Campo>
              </div>
            </>
          )}

          {/* Rodapé no padrão: ação principal à direita, erro logo ABAIXO dela. */}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setShowEmpForm(false); limparFormEmpresa(); setErroEmpresa(null); }} className={BTN_SECUNDARIO}>
              <X size={14} /> Cancelar
            </button>
            <button onClick={handleCriarEmpresa} disabled={savingEmp} className={BTN_PRIMARIO}>
              {savingEmp
                ? <><Loader2 size={14} className="animate-spin" /> Salvando…</>
                : <><Check size={14} /> {empEditId ? 'Salvar' : 'Criar empresa'}</>}
            </button>
          </div>
          <ErroAcao erro={erroEmpresa} className="mt-3" />
        </section>
      )}

      {/* ── Membros da equipe na edição ───────────────────────────────────── */}
      {showEmpForm && empEditId && empEquipesEdit.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <h2 className={`${TITULO_SECAO} mb-4`}>Membros da equipe</h2>
          <div className="space-y-3">
            {empEquipesEdit.map(eq => (
              <EquipePanel key={eq.id} equipe={eq} mostrarNome={empEquipesEdit.length > 1}
                onGestores={gs => setGestoresEdit(prev => ({ ...prev, [eq.id]: gs }))} />
            ))}
          </div>
        </section>
      )}

      {/* ── Empresas cadastradas ─────────────────────────────────────────── */}
      <ErroAcao erro={erroLista} className="mb-3" />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : empresas.length === 0 ? (
        <div className="text-center py-16">
          <Building2 size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Nenhuma empresa cadastrada ainda.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {empresas.map(emp => (
            <section key={emp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Header empresa */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 flex items-center gap-2">
                      {emp.nome}
                      {emp.status && emp.status !== 'ATIVA' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                          {emp.status === 'SUSPENSA' ? 'Inativa' : 'Cancelada'}
                        </span>
                      )}
                    </p>
                    {/* `documento` primeiro: é a autoridade. `cnpj` só tem valor quando
                        é um CNPJ, então a clínica de CPF não exibiria documento nenhum. */}
                    {(emp.documento || emp.cnpj) && (
                      <p className="text-xs text-gray-400">CNPJ / CPF: {mascaraDocumento(emp.documento || emp.cnpj || '')}</p>
                    )}
                    {emp.telefone && <p className="text-xs text-gray-400">{emp.telefone}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Editar os dados da empresa — abre o mesmo formulário do topo. */}
                  <button onClick={() => abrirEdicaoEmpresa(emp)}
                    title="Editar empresa"
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-orange-600 text-xs font-semibold rounded-xl hover:border-orange-300 hover:bg-orange-50 transition-colors">
                    <Pencil size={13} /> Editar
                  </button>
                  {/* ADMIN inativa/reativa a empresa (Empresa.status governa o acesso). */}
                  <button onClick={() => handleAlterarStatus(emp.id, emp.status ?? 'ATIVA')}
                    title={(emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar empresa' : 'Reativar empresa'}
                    className={`flex items-center gap-1 px-3 py-1.5 border text-xs font-semibold rounded-xl transition-colors ${
                      (emp.status ?? 'ATIVA') === 'ATIVA'
                        ? 'border-gray-200 text-red-600 hover:border-red-300 hover:bg-red-50'
                        : 'border-gray-200 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50'
                    }`}>
                    <Power size={13} /> {(emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar' : 'Reativar'}
                  </button>
                </div>
              </div>

              {/* Equipes — sempre expandidas: uma clínica quase sempre tem UMA equipe só,
                  e nesse caso o nome não diz nada (herdou o da própria empresa); o que
                  importa é QUEM está nela. Com várias, o nome de cada uma passa a
                  distinguir — e por isso o cabeçalho de cada painel mostra `equipe.nome`
                  de qualquer forma. Nenhum clique extra para chegar lá. */}
              <div className="p-4 space-y-3">
                {emp.equipes.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">Nenhuma equipe cadastrada.</p>
                ) : emp.equipes.map(eq => (
                  <EquipePanel key={eq.id} equipe={eq} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
