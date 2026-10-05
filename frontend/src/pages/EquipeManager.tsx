// src/pages/EquipeManager.tsx
//
// EMPRESAS — tela do ADMIN da plataforma (`/admin/empresas`).
//
// 🔴 SOMENTE VISUALIZAR, INATIVAR/REATIVAR E ALTERAR PLANO (2026-08-17). Criar empresa
// e editar a identidade dela (nome, documento, endereço, espécies) saiu daqui: o Admin
// agora cria só o GESTOR (ver `pages/CriacaoGestor.tsx`, `POST /equipes/gestores`) — é o
// próprio gestor quem completa o cadastro da empresa em `/cadastro/empresa`
// (`CadastroEmpresa.tsx`). Esta tela virou o painel de acompanhamento da carteira.
//
// ⚠️ NÃO confundir com `/cadastro/empresa` (CadastroEmpresa.tsx): lá o GESTOR edita o
// cadastro da PRÓPRIA empresa; aqui o ADMIN só visualiza, inativa/reativa e troca o
// plano de qualquer empresa.

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Building2, Power, Users, Check, X, Loader2, ChevronDown, ChevronUp, Layers, Trash2, UserCog } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import ModalJustificativa from '../components/ModalJustificativa';
import { INPUT_CLS } from '../components/CampoForm';
import { mascaraDocumento } from '../utils/mascaras';

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

interface Equipe {
  id: number; nome: string;
  membros?: Membro[];
}

interface Empresa {
  id: number; nome: string; cnpj?: string | null; telefone?: string | null;
  // `documento` é a AUTORIDADE do CPF/CNPJ; `cnpj` só existe quando é um CNPJ.
  documento?: string | null; endereco?: string | null;
  status?: string;
  equipes: Equipe[];
  // Plano atual, para o seletor de "Alterar plano" pré-selecionar o mesmo.
  assinatura?: { planoId: number } | null;
}

const BTN_SECUNDARIO =
  'flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-600 ' +
  'text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors';

// ─── Sub-componente: Painel de equipe expandida (SOMENTE LEITURA) ────────────
function EquipePanel({ equipe, mostrarNome = true }: { equipe: Equipe; mostrarNome?: boolean }) {
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [gestores,  setGestores]  = useState<Membro[]>([]);
  const [membros,   setMembros]   = useState<Membro[]>([]);
  const [loadingM,  setLoadingM]  = useState(true);
  const [expandido, setExpandido] = useState(false);

  const carregarMembros = async () => {
    setLoadingM(true);
    try {
      const res = await api.get(`/equipes/${equipe.id}/membros`);
      if (!res.data) return;                       // GET 403 → data null (armadilha 23)
      const lista: Membro[] = Array.isArray(res.data.dados) ? res.data.dados : [];
      const gestoresDaEquipe = lista.filter(m => m.cargo === 'GESTOR');
      setGestores(gestoresDaEquipe);
      setMembros(lista.filter(m => m.cargo !== 'GESTOR'));
      setErroCarga(null);
    } catch { setErroCarga('Erro ao carregar membros'); }
    finally  { setLoadingM(false); }
  };

  useEffect(() => { carregarMembros(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = gestores.length + membros.length;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <InlineError message={erroCarga} className="m-3" />

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
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [planos,   setPlanos]   = useState<{ id: number; nome: string; precoMensal: number | null }[]>([]);

  // Qual empresa está com o seletor de "Alterar plano" aberto (null = nenhuma).
  const [alterandoPlanoId, setAlterandoPlanoId] = useState<number | null>(null);
  const [novoPlanoId,      setNovoPlanoId]      = useState('');
  const [salvandoPlano,    setSalvandoPlano]    = useState(false);
  const [erroPlano,        setErroPlano]        = useState<ErroAcaoDados | null>(null);

  const [erroInline, setErroInline] = useState<string | null>(null);

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

  // Planos ativos para o seletor de "Alterar plano" (só o ADMIN alcança; GET 403 → data null).
  useEffect(() => {
    api.get('/planos?ativos=1')
      .then(res => { if (res.data) setPlanos(res.data.dados ?? []); })
      .catch(() => { /* silencioso: não-admin não vê planos */ });
  }, []);

  // Ação pendente de confirmação (inativar/reativar, excluir ou transferir a gestão).
  // Tudo passa por ModalJustificativa — o `window.confirm` nativo abria a janela do
  // navegador, fora do padrão da aplicação e sem coletar o motivo que a auditoria exige.
  const [acao, setAcao] = useState<{ tipo: 'status' | 'excluir' | 'dono'; emp: Empresa } | null>(null);
  const [emailNovoDono, setEmailNovoDono] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erroModal, setErroModal] = useState<ErroAcaoDados | null>(null);

  const abrirAcao = (tipo: 'status' | 'excluir' | 'dono', emp: Empresa) => {
    setErroModal(null);
    setEmailNovoDono('');
    setAcao({ tipo, emp });
  };

  const mensagemDoErro = (err: unknown, padrao: string): ErroAcaoDados => {
    const d = (err as { response?: { data?: { mensagem?: string } } }).response?.data;
    return { mensagem: d?.mensagem ?? padrao };
  };

  const handleConfirmarAcao = async (motivo: string) => {
    if (!acao) return;
    const { tipo, emp } = acao;
    if (tipo === 'dono' && !emailNovoDono.trim()) {
      setErroModal({ mensagem: 'Informe o e-mail do novo gestor.' });
      return;
    }
    setProcessando(true);
    setErroModal(null);
    try {
      if (tipo === 'status') {
        const novo = (emp.status ?? 'ATIVA') === 'ATIVA' ? 'SUSPENSA' : 'ATIVA';
        await api.patch(`/equipes/empresas/${emp.id}/status`, { status: novo, motivo });
        toast.success(novo === 'SUSPENSA' ? 'Empresa inativada' : 'Empresa reativada');
      } else if (tipo === 'excluir') {
        await api.delete(`/equipes/empresas/${emp.id}`, { data: { motivo } });
        toast.success('Empresa excluída');
      } else {
        await api.patch(`/equipes/empresas/${emp.id}/dono`, { email: emailNovoDono.trim(), motivo });
        toast.success('Gestão transferida');
      }
      setAcao(null);
      carregar();
    } catch (err: unknown) {
      setErroModal(mensagemDoErro(err, 'Erro ao executar a ação'));
    } finally { setProcessando(false); }
  };

  const abrirAlterarPlano = (emp: Empresa) => {
    setErroPlano(null);
    setAlterandoPlanoId(emp.id);
    setNovoPlanoId(emp.assinatura?.planoId ? String(emp.assinatura.planoId) : '');
  };

  const handleSalvarPlano = async (empresaId: number) => {
    if (!novoPlanoId) { setErroPlano({ mensagem: 'Selecione um plano.' }); return; }
    setSalvandoPlano(true);
    setErroPlano(null);
    try {
      await api.put(`/empresas/${empresaId}/assinatura`, { planoId: Number(novoPlanoId) });
      toast.success('Plano atualizado!');
      setAlterandoPlanoId(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem;
      setErroPlano({ mensagem: msg ?? 'Erro ao alterar o plano' });
    } finally { setSalvandoPlano(false); }
  };

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={24} className="text-emerald-600 flex-shrink-0" />
            Empresas
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading
              ? 'Carregando…'
              : `${empresas.length} ${empresas.length === 1 ? 'empresa cadastrada' : 'empresas cadastradas'}`}
          </p>
        </div>
      </div>

      {/* ── Empresas cadastradas ─────────────────────────────────────────── */}

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
                    {(emp.documento || emp.cnpj) && (
                      <p className="text-xs text-gray-400">CNPJ / CPF: {mascaraDocumento(emp.documento || emp.cnpj || '')}</p>
                    )}
                    {emp.telefone && <p className="text-xs text-gray-400">{emp.telefone}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => abrirAlterarPlano(emp)}
                    title="Alterar plano"
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-blue-600 text-xs font-semibold rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors">
                    <Layers size={13} /> Alterar plano
                  </button>
                  {/* ADMIN inativa/reativa a empresa (Empresa.status governa o acesso). */}
                  <button onClick={() => abrirAcao('status', emp)}
                    title={(emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar empresa' : 'Reativar empresa'}
                    className={`flex items-center gap-1 px-3 py-1.5 border text-xs font-semibold rounded-xl transition-colors ${
                      (emp.status ?? 'ATIVA') === 'ATIVA'
                        ? 'border-gray-200 text-red-600 hover:border-red-300 hover:bg-red-50'
                        : 'border-gray-200 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50'
                    }`}>
                    <Power size={13} /> {(emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar' : 'Reativar'}
                  </button>
                  <button onClick={() => abrirAcao('dono', emp)}
                    title="Passar a empresa para outro gestor"
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-orange-600 text-xs font-semibold rounded-xl hover:border-orange-300 hover:bg-orange-50 transition-colors">
                    <UserCog size={13} /> Transferir
                  </button>
                  <button onClick={() => abrirAcao('excluir', emp)}
                    title="Excluir empresa (só sem movimento)"
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-red-600 text-xs font-semibold rounded-xl hover:border-red-300 hover:bg-red-50 transition-colors">
                    <Trash2 size={13} /> Excluir
                  </button>
                </div>
              </div>

              {/* Alterar plano — abre inline, logo abaixo do cabeçalho que a disparou */}
              {alterandoPlanoId === emp.id && (
                <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Novo plano</label>
                    <select value={novoPlanoId} onChange={e => setNovoPlanoId(e.target.value)}
                      className={`${INPUT_CLS} bg-white`}>
                      <option value="">Selecione o plano</option>
                      {planos.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.nome}{p.precoMensal != null ? ` — ${p.precoMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês` : ''}
                        </option>
                      ))}
                    </select>
                    <ErroAcao erro={erroPlano} className="mt-2" />
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setAlterandoPlanoId(null); setErroPlano(null); }} className={BTN_SECUNDARIO}>
                      <X size={14} /> Cancelar
                    </button>
                    <button onClick={() => handleSalvarPlano(emp.id)} disabled={salvandoPlano}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors">
                      {salvandoPlano ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
                    </button>
                  </div>
                </div>
              )}

              {/* Equipes — sempre expandidas: uma clínica quase sempre tem UMA equipe só. */}
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

      <ModalJustificativa
        aberto={!!acao}
        tom={acao?.tipo === 'status' && (acao.emp.status ?? 'ATIVA') !== 'ATIVA' ? 'neutro' : acao?.tipo === 'dono' ? 'neutro' : 'perigo'}
        titulo={
          acao?.tipo === 'excluir' ? 'Excluir empresa?'
          : acao?.tipo === 'dono' ? 'Transferir a gestão da empresa?'
          : (acao?.emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar empresa?' : 'Reativar empresa?'
        }
        descricao={
          !acao ? undefined
          : acao.tipo === 'excluir'
            ? `"${acao.emp.nome}" será removida. Só é possível se a empresa nunca teve pacientes nem faturas; do contrário, inative-a.`
          : acao.tipo === 'dono'
            ? `"${acao.emp.nome}" passará a ter outro gestor responsável. Informe o e-mail de um profissional já cadastrado.`
          : (acao.emp.status ?? 'ATIVA') === 'ATIVA'
            ? `Ninguém conseguirá acessar "${acao.emp.nome}" enquanto ela estiver inativa.`
            : `"${acao.emp.nome}" voltará a ficar acessível.`
        }
        acaoLabel={acao?.tipo === 'excluir' ? 'Excluir' : acao?.tipo === 'dono' ? 'Transferir' : (acao?.emp.status ?? 'ATIVA') === 'ATIVA' ? 'Inativar' : 'Reativar'}
        extra={acao?.tipo === 'dono' ? (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              E-mail do novo gestor <span className="text-red-500">*</span>
            </label>
            <input type="email" value={emailNovoDono} onChange={e => setEmailNovoDono(e.target.value)}
              className={INPUT_CLS} placeholder="gestor@exemplo.com" autoComplete="off" />
          </div>
        ) : undefined}
        processando={processando}
        erro={erroModal}
        onConfirmar={handleConfirmarAcao}
        onFechar={() => { if (!processando) setAcao(null); }}
      />
    </PageContainer>
  );
}
