// src/pages/CadastroEmpresa.tsx
//
// CADASTRO DO ASSINANTE — fase 2 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md §5.1).
//
// ⚠️ NÃO é a tela de Configurações (`/configuracoes`). Lá ficam as PREFERÊNCIAS
// OPERACIONAIS da clínica (logo, fechamento de fatura, expediente, espécies). Aqui fica a
// IDENTIDADE de quem assina o SaaS: razão social, documento, endereço fiscal, contato — e
// o plano contratado, em leitura.

import { useState, useEffect, useCallback } from 'react';
import { Building2, Loader2, Save, Users2, AlertTriangle, Lock } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { soDigitos, mascaraDocumento, mascaraTelefone, mascaraCep } from '../utils/mascaras';
import Campo, { INPUT_CLS } from '../components/CampoForm';

interface UsoAssentos {
  limite:      number | null;
  ocupados:    number;
  ilimitado:   boolean;
  disponiveis: number | null;
}

interface PlanoContratado {
  slug:           string;
  nome:           string;
  valor:          number | null;
  validadeDias:   number | null;
  limiteUsuarios: number | null;
  status:         string;
  fimEm:          string | null;
  limiteOverride: number | null;
}

const moedaBR = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface CadastroEmpresaDados {
  id:                number;
  nome:              string;
  razaoSocial:       string | null;
  nomeFantasia:      string | null;
  documento:         string | null;
  tipoDocumento:     string | null;
  inscricaoEstadual: string | null;
  emailContato:      string | null;
  telefone:          string | null;
  whatsapp:          string | null;
  cep:               string | null;
  endereco:          string | null;
  numero:            string | null;
  complemento:       string | null;
  bairro:            string | null;
  cidade:            string | null;
  estado:            string | null;
  status:            string;
  plano:             PlanoContratado | null;
  uso:               UsoAssentos;
}

/**
 * Campos editáveis, SEMPRE string. Derivar de `CadastroEmpresaDados` com `Omit` traria
 * `string | null` do DTO, e input controlado com `null` é `undefined` na prática — React
 * troca para não-controlado e o campo para de responder. Ausência aqui é string vazia; a
 * conversão para `null` acontece na borda, ao salvar.
 */
type Form = Record<
  'razaoSocial' | 'nomeFantasia' | 'documento' | 'inscricaoEstadual' | 'emailContato' |
  'telefone' | 'whatsapp' | 'cep' | 'endereco' | 'numero' | 'complemento' | 'bairro' |
  'cidade' | 'estado',
  string
>;

const FORM_VAZIO: Form = {
  razaoSocial: '', nomeFantasia: '', documento: '', inscricaoEstadual: '',
  emailContato: '', telefone: '', whatsapp: '', cep: '', endereco: '',
  numero: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const STATUS_LABEL: Record<string, { texto: string; cls: string }> = {
  ATIVA:     { texto: 'Ativa',     cls: 'bg-emerald-100 text-emerald-700' },
  SUSPENSA:  { texto: 'Suspensa',  cls: 'bg-red-100 text-red-700'         },
  CANCELADA: { texto: 'Cancelada', cls: 'bg-gray-200 text-gray-600'       },
};

// `Campo` e a classe do input são compartilhados com EquipeManager (a outra tela de
// empresa) — as duas têm de parecer a mesma tela. Ver components/CampoForm.tsx.
// `disabled:*` cobre o modo SOMENTE LEITURA do gestor — sem isso o campo travado
// pareceria idêntico a um campo editável vazio.
const INPUT = `${INPUT_CLS} disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`;

export default function CadastroEmpresa() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();

  // ⚠️ SOMENTE ADMIN DA PLATAFORMA EDITA (2026-08-16) — mesmo critério de
  // `ConfiguracaoAlerta.tsx`. O gestor CONTINUA vendo o cadastro fiscal (razão social,
  // documento, endereço, contato), mas em modo leitura: quem administra a identidade do
  // assinante é o ADMIN, o mesmo que cria a empresa e associa plano/gestores em
  // `/admin/empresas`. `usePermissoes().isGestor` é FALSE para ADMIN (armadilha
  // conhecida — o hook nem chama o backend pra ele), então o gate certo é o `role`/
  // `userType` do login, não `isGestor`.
  const isAdminPlataforma =
    user?.userType?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'ADMIN';
  const somenteLeitura = !isAdminPlataforma;

  const [dados,      setDados]      = useState<CadastroEmpresaDados | null>(null);
  const [form,       setForm]       = useState<Form>(FORM_VAZIO);
  const [loading,    setLoading]    = useState(true);
  const [salvando,   setSalvando]   = useState(false);
  const [semAcesso,  setSemAcesso]  = useState(false);
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<ErroAcaoDados | null>(null);

  const set = (campo: keyof Form, valor: string) => setForm(f => ({ ...f, [campo]: valor }));

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/empresas/cadastro');
      if (!res.data) { setSemAcesso(true); return; }   // GET 403 → data null
      const d = res.data.dados as CadastroEmpresaDados;
      setDados(d);
      setForm({
        razaoSocial:       d.razaoSocial       ?? '',
        nomeFantasia:      d.nomeFantasia      ?? '',
        documento:         d.documento ? mascaraDocumento(d.documento) : '',
        inscricaoEstadual: d.inscricaoEstadual ?? '',
        emailContato:      d.emailContato      ?? '',
        telefone:          d.telefone ? mascaraTelefone(d.telefone) : '',
        whatsapp:          d.whatsapp ? mascaraTelefone(d.whatsapp) : '',
        cep:               d.cep ? mascaraCep(d.cep) : '',
        endereco:          d.endereco    ?? '',
        numero:            d.numero      ?? '',
        complemento:       d.complemento ?? '',
        bairro:            d.bairro      ?? '',
        cidade:            d.cidade      ?? '',
        estado:            d.estado      ?? '',
      });
      setSemAcesso(false);
      setErroInline(null);
    } catch {
      setErroInline('Erro ao carregar o cadastro da empresa.');
    } finally { setLoading(false); }
  }, []);

  // Nenhum fetch escopado por empresa antes de o contexto ativo resolver — senão volta
  // o cadastro da empresa errada (armadilha documentada no CLAUDE.md).
  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    carregar();
  }, [loadingPerms, empresaLoading, contextoAtivo?.empresaId, carregar]);

  const salvar = async () => {
    // Defensivo: o botão nem aparece para quem não é ADMIN — isto só cobre um clique
    // que não deveria ter sido possível. Quem barra de verdade é o backend (403).
    if (somenteLeitura) return;
    setErroSalvar(null);
    const doc = soDigitos(form.documento);
    // Documento identifica o assinante: obrigatório e único entre empresas. Empresa
    // antiga sem documento precisa informá-lo aqui antes de salvar o resto do cadastro.
    if (!doc) {
      setErroSalvar({ mensagem: 'CNPJ / CPF é obrigatório.', campos: ['documento'] });
      return;
    }
    if (doc.length !== 11 && doc.length !== 14) {
      setErroSalvar({ mensagem: 'Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ).', campos: ['documento'] });
      return;
    }
    if (!form.telefone.trim()) {
      setErroSalvar({ mensagem: 'Telefone é obrigatório.', campos: ['telefone'] });
      return;
    }
    if (form.estado && form.estado.trim().length !== 2) {
      setErroSalvar({ mensagem: 'Estado deve ter 2 letras (UF).', campos: ['estado'] });
      return;
    }
    setSalvando(true);
    try {
      await api.put('/empresas/cadastro', {
        ...form,
        documento: doc,
        whatsapp:  soDigitos(form.whatsapp),
        telefone:  form.telefone.trim(),
        cep:       soDigitos(form.cep),
        estado:    form.estado.trim().toUpperCase(),
      });
      toast.success('Cadastro da empresa atualizado');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroSalvar({ mensagem: msg ?? 'Erro ao salvar o cadastro.' });
    } finally { setSalvando(false); }
  };

  if (!loadingPerms && !isGestor && semAcesso) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Apenas o gestor da empresa ativa pode ver este cadastro.</p>
        </div>
      </PageContainer>
    );
  }

  const st = STATUS_LABEL[dados?.status ?? 'ATIVA'] ?? STATUS_LABEL.ATIVA;
  const uso = dados?.uso;

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={24} className="text-emerald-600 flex-shrink-0" />
            Cadastro da Empresa
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dados?.nome ?? '—'}
            <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.texto}</span>
          </p>
        </div>
        {/* Quem não é ADMIN só VÊ este cadastro — quem edita é a plataforma. */}
        {somenteLeitura && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full flex-shrink-0">
            <Lock size={12} /> Somente leitura — gerenciado pelo administrador da plataforma
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          {/* Empresa suspensa: o gestor precisa saber POR QUE ninguém entra (D3) */}
          {dados?.status === 'SUSPENSA' && (
            <div className="flex items-start gap-2 px-4 py-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                <b>Empresa suspensa.</b> Ninguém consegue entrar no sistema por esta empresa
                enquanto a situação não for regularizada. Quem também trabalha em outra clínica
                continua acessando aquela normalmente.
              </span>
            </div>
          )}

          {/* ── Plano contratado — LEITURA. Trocar de plano é ato comercial, do ADMIN ── */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Users2 size={16} className="text-emerald-600" />
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Plano e usuários</h2>
            </div>

            {dados?.plano ? (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Plano</p>
                  <p className="text-sm font-semibold text-gray-900">{dados.plano.nome}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Valor</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {moedaBR(dados.plano.valor)}{dados.plano.valor != null && <span className="text-gray-400 font-normal"> /mês</span>}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Situação</p>
                  <p className="text-sm font-semibold text-gray-900">{dados.plano.status}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Usuários com acesso</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {uso?.ocupados ?? 0}
                    {uso?.ilimitado ? ' (sem limite)' : ` de ${uso?.limite}`}
                  </p>
                </div>
                {!uso?.ilimitado && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Disponíveis</p>
                    <p className={`text-sm font-semibold ${uso?.disponiveis === 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {uso?.disponiveis}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Empresa sem assinatura é ILIMITADA por decisão (lib/planoEmpresa.js) —
                 e o gestor precisa ver isso, não um espaço em branco. */
              <p className="text-sm text-gray-500">
                Nenhum plano atribuído — sem limite de usuários.
                <span className="text-gray-400"> {uso?.ocupados ?? 0} com acesso hoje.</span>
              </p>
            )}
          </section>

          {/* ── Identificação ──────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">Identificação</h2>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <Campo label="RAZÃO SOCIAL" className="sm:col-span-3">
                <input className={INPUT} disabled={somenteLeitura} value={form.razaoSocial} onChange={e => set('razaoSocial', e.target.value)} />
              </Campo>
              <Campo label="NOME FANTASIA" className="sm:col-span-3">
                <input className={INPUT} disabled={somenteLeitura} value={form.nomeFantasia} onChange={e => set('nomeFantasia', e.target.value)} />
              </Campo>
              <Campo label="CNPJ / CPF *" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} value={form.documento} placeholder="00.000.000/0000-00"
                  onChange={e => set('documento', mascaraDocumento(e.target.value))} />
              </Campo>
              <Campo label="INSCRIÇÃO ESTADUAL" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} value={form.inscricaoEstadual} onChange={e => set('inscricaoEstadual', e.target.value)} />
              </Campo>
              <Campo label="E-MAIL DE CONTATO" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} type="email" value={form.emailContato} onChange={e => set('emailContato', e.target.value)} />
              </Campo>
              <Campo label="TELEFONE *" className="sm:col-span-3">
                <input className={INPUT} disabled={somenteLeitura} value={form.telefone} placeholder="(11) 3333-4444"
                  onChange={e => set('telefone', mascaraTelefone(e.target.value))} />
              </Campo>
              <Campo label="WHATSAPP" className="sm:col-span-3">
                <input className={INPUT} disabled={somenteLeitura} value={form.whatsapp} placeholder="(11) 98765-4321"
                  onChange={e => set('whatsapp', mascaraTelefone(e.target.value))} />
              </Campo>
            </div>
          </section>

          {/* ── Endereço ───────────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">Endereço</h2>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <Campo label="CEP" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} value={form.cep} placeholder="00000-000"
                  onChange={e => set('cep', mascaraCep(e.target.value))} />
              </Campo>
              <Campo label="LOGRADOURO" className="sm:col-span-3">
                <input className={INPUT} disabled={somenteLeitura} value={form.endereco} onChange={e => set('endereco', e.target.value)} />
              </Campo>
              <Campo label="NÚMERO" className="sm:col-span-1">
                <input className={INPUT} disabled={somenteLeitura} value={form.numero} onChange={e => set('numero', e.target.value)} />
              </Campo>
              <Campo label="COMPLEMENTO" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} value={form.complemento} onChange={e => set('complemento', e.target.value)} />
              </Campo>
              <Campo label="BAIRRO" className="sm:col-span-2">
                <input className={INPUT} disabled={somenteLeitura} value={form.bairro} onChange={e => set('bairro', e.target.value)} />
              </Campo>
              <Campo label="CIDADE" className="sm:col-span-1">
                <input className={INPUT} disabled={somenteLeitura} value={form.cidade} onChange={e => set('cidade', e.target.value)} />
              </Campo>
              <Campo label="UF" className="sm:col-span-1">
                <input className={INPUT} disabled={somenteLeitura} maxLength={2} value={form.estado}
                  onChange={e => set('estado', e.target.value.toUpperCase())} />
              </Campo>
            </div>
          </section>

          {/* Somente ADMIN salva — para o gestor não há botão nenhum aqui (§6 do
              CLAUDE.md: ação que a pessoa não pode executar não é renderizada). */}
          {!somenteLeitura && (
            <>
              {/* Erro da AÇÃO logo abaixo do botão que a disparou (§6 do CLAUDE.md) */}
              <div className="flex items-center justify-end gap-2 mt-5">
                <button onClick={salvar} disabled={salvando}
                  className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
                  {salvando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar
                </button>
              </div>
              <ErroAcao erro={erroSalvar} className="mt-3" />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
