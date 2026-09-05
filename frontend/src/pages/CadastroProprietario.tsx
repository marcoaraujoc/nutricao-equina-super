// frontend/src/pages/CadastroProprietario.tsx

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Search, Loader2, X, Users,
  Phone, MapPin, Info,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import ProprietarioFormModal, {
  type Proprietario, type FormProp, type LocalidadeProp,
  FORM_INICIAL, resumoLocalidade, validarDiaVencimento,
  validarCPF, validarCNPJ, mascaraCPF, mascaraCNPJ, mascaraTelefone, mascaraCEP,
  formatarMoeda, parseMoeda,
} from '../components/ProprietarioFormModal';
import { usePermissoes } from '../hooks/usePermissoes';
import ModalJustificativa from '../components/ModalJustificativa';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import { type ErroAcaoDados } from '../components/ErroAcao';
import { formatDate } from '../utils/dateUtils';

export type { LocalidadeProp };

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CadastroProprietario() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar   = isGestor || podeExecutar('cadastro.proprietario.criar');
  const podeEditar  = isGestor || podeExecutar('cadastro.proprietario.editar');
  const podeRemover = isGestor || podeExecutar('cadastro.proprietario.deletar');
  const podeAtivar  = isGestor || podeExecutar('cadastro.proprietario.ativar');

  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [proprietarios, setProprietarios] = useState<Proprietario[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro do SALVAR do modal — vive separado do erroInline (que é erro de CARGA da
  // página e continua no topo). Sem essa separação a mensagem cai atrás do overlay.
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [showModal,     setShowModal]     = useState(false);
  const [editando,      setEditando]      = useState<Proprietario | null>(null);
  const [form,          setForm]          = useState<FormProp>(FORM_INICIAL);
  const [saving,        setSaving]        = useState(false);
  const [confirmRemov,  setConfirmRemov]  = useState<Proprietario | null>(null);
  const [confirmReativ, setConfirmReativ] = useState<Proprietario | null>(null);
  const [filtroAtivo,   setFiltroAtivo]   = useState<'ativo' | 'inativo' | 'all'>('ativo');
  const [showInfo,      setShowInfo]      = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/cadastro/proprietarios', {
        params: {
          busca: busca || undefined,
          ativo: filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false',
        },
      });
      if (!res.data) return;
      setProprietarios(res.data.dados ?? []);
    } catch { setErroInline('Erro ao carregar proprietários'); }
    finally { setLoading(false); }
  }, [busca, filtroAtivo]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setShowModal(true);
  };

  const abrirEdicao = async (p: Proprietario) => {
    // Busca fresca (não a linha da lista, que não traz sugestões): a localização já
    // usada por algum animal ATIVO do cliente que ainda não virou "localidade
    // atendida" confirmada entra pronta no repetidor, com frequência padrão 1x —
    // o gestor só ajusta ou remove, em vez de buscar de novo um local que o
    // cadastro do animal já sabe. Falha na busca cai para os dados da lista mesmo.
    let localidadesIniciais = p.localidades ?? [];
    try {
      const res = await api.get(`/cadastro/proprietarios/${p.id}`);
      const fresco: (Proprietario & { localidadesSugeridas?: LocalidadeProp[] }) | null = res.data?.dados ?? null;
      if (fresco) {
        p = fresco;
        const jaTem = new Set((fresco.localidades ?? []).map(l => l.localizacaoId));
        const sugeridas = (fresco.localidadesSugeridas ?? [])
          .filter(s => !jaTem.has(s.localizacaoId))
          .map(s => ({ ...s, frequenciaVisitas: 1 }));
        localidadesIniciais = [...(fresco.localidades ?? []), ...sugeridas];
      }
    } catch { /* mantém os dados da lista */ }

    setEditando(p);
    setForm({
      fullName:          p.fullName,
      email:             p.email,
      phone:             p.phone ? mascaraTelefone(p.phone.replace(/\D/g, '')) : '',
      tipoDoc:           p.cnpj ? 'cnpj' : 'cpf',
      cpf:               p.cpf  ? mascaraCPF(p.cpf.replace(/\D/g, ''))   : '',
      cnpj:              p.cnpj ? mascaraCNPJ(p.cnpj.replace(/\D/g, '')) : '',
      mensalista:        p.mensalista,
      valorAssistencia:  p.valorAssistencia
        ? formatarMoeda(String(Math.round(p.valorAssistencia * 100)))
        : '',
      localidades:       localidadesIniciais,
      diaVencimentoFatura: p.diaVencimentoFatura ? String(p.diaVencimentoFatura) : '5',
      cep:               p.cep         ? mascaraCEP(p.cep.replace(/\D/g, ''))  : '',
      endereco:          p.endereco    ?? '',
      complemento:       p.complemento ?? '',
      bairro:            p.bairro      ?? '',
      cidade:            p.cidade      ?? '',
      estado:            p.estado      ?? '',
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); };

  const handleFormChange = (updates: Partial<FormProp>) =>
    setForm(prev => ({ ...prev, ...updates }));

  const handleSalvar = async () => {
    setErroAcao(null);
    if (editando && !podeEditar) { semPermissao('alterar proprietário'); return; }
    if (!editando && !podeCriar) { semPermissao('criar proprietário'); return; }
    if (!form.fullName.trim())      { setErroAcao({ mensagem: 'Nome é obrigatório', campos: ['fullName'] }); return; }
    if (!form.email.trim())         { setErroAcao({ mensagem: 'E-mail é obrigatório', campos: ['email'] }); return; }
    if (!form.phone.trim())         { setErroAcao({ mensagem: 'Telefone é obrigatório', campos: ['phone'] }); return; }
    // Pelo menos uma localidade com frequência — é o que o campo único exigia antes,
    // agora por lugar (o cliente pode ser visitado 2x na Hípica e 3x no Haras).
    if (form.localidades.length === 0) {
      setErroAcao({ mensagem: 'Informe ao menos uma localidade com a frequência de visitas', campos: ['localidades'] }); return;
    }
    if (validarDiaVencimento(form.diaVencimentoFatura)) return; // erro já exibido inline no campo

    // Documento é opcional, mas se preenchido precisa ser válido
    if (form.tipoDoc === 'cpf'  && form.cpf.trim()  && !validarCPF(form.cpf))   { setErroAcao({ mensagem: 'CPF inválido', campos: ['cpf'] }); return; }
    if (form.tipoDoc === 'cnpj' && form.cnpj.trim() && !validarCNPJ(form.cnpj)) { setErroAcao({ mensagem: 'CNPJ inválido', campos: ['cnpj'] }); return; }
    if (form.mensalista && !form.valorAssistencia) {
      setErroAcao({ mensagem: 'Informe o valor da assistência veterinária', campos: ['valorAssistencia'] }); return;
    }

    setSaving(true);
    const payload = {
      fullName:          form.fullName,
      email:             form.email,
      phone:             form.phone  || null,
      cpf:               form.tipoDoc === 'cpf'  && form.cpf.trim()  ? form.cpf  : null,
      cnpj:              form.tipoDoc === 'cnpj' && form.cnpj.trim() ? form.cnpj : null,
      mensalista:        form.mensalista,
      valorAssistencia:  form.mensalista && form.valorAssistencia ? parseMoeda(form.valorAssistencia) : null,
      // O campo único `frequenciaVisitas` é derivado no backend (a maior entre as
      // localidades) — a tela manda só o combinado por lugar.
      localidades:       form.localidades.map(l => ({
        localizacaoId:     l.localizacaoId,
        frequenciaVisitas: l.frequenciaVisitas,
      })),
      diaVencimentoFatura: Number(form.diaVencimentoFatura),
      cep:               form.cep         || null,
      endereco:          form.endereco    || null,
      complemento:       form.complemento || null,
      bairro:            form.bairro      || null,
      cidade:            form.cidade      || null,
      estado:            form.estado      || null,
    };

    try {
      if (editando) {
        await api.put(`/cadastro/proprietarios/${editando.id}`, payload);
        toast.success('Proprietário atualizado');
      } else {
        const res = await api.post('/cadastro/proprietarios', payload);
        // Cliente que já tinha acesso ao sistema (atendido por outra clínica):
        // o backend cria só o cadastro DESTA empresa e avisa pela mensagem.
        toast.success(res.data?.mensagem ?? 'Proprietário cadastrado — e-mail de boas-vindas enviado');
      }
      fecharModal();
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroAcao({ mensagem: msg ?? 'Erro ao salvar' });
    } finally { setSaving(false); }
  };

  // Inativar junto os animais do cliente — pergunta feita NO MESMO gesto da
  // inativação (2026-09-04). Antes era automático e ninguém era consultado.
  const [inativarAnimais, setInativarAnimais] = useState(true);

  const handleRemoverDaEmpresa = (p: Proprietario) => {
    if (!podeRemover) { semPermissao('inativar proprietário'); return; }
    // Volta ao padrão (marcado) a cada abertura: a escolha é DESTE cliente, e herdar
    // a da inativação anterior é o caminho curto para inativar animais sem querer.
    setInativarAnimais(true);
    setConfirmRemov(p);
  };

  const handleRemoverConfirmado = async (motivo: string) => {
    if (!confirmRemov) return;
    const p = confirmRemov;
    setConfirmRemov(null);
    try {
      // Inativação exige justificativa (registrada na Auditoria)
      await api.delete(`/cadastro/proprietarios/${p.id}`, { data: { motivo, inativarAnimais } });
      toast.success('Proprietário inativado');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao remover proprietário');
    }
  };

  // ─── Ações do cliente — UMA declaração p/ a tabela E p/ o card ─────────────
  // `AcaoRegistro` decide a forma por CSS: ícone no desktop, botão com rótulo no
  // mobile (onde antes eram ícones soltos, sem rótulo). Inativar/Reativar é a MESMA
  // chave, e é o ícone (ToggleRight/ToggleLeft) que diz em que posição ela está.
  const acoesDoProprietario = (p: Proprietario) => {
    const semAcao = !podeEditar && !podeRemover && !podeAtivar;
    if (semAcao) return <span className="text-xs text-gray-400 italic">Somente leitura</span>;
    return (
      <AcoesRegistro>
        <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
          visivel={podeEditar} onClick={() => abrirEdicao(p)} />
        <AcaoRegistro tom="ativar" icone={ToggleRight} rotulo="Inativar"
          titulo="Inativar proprietário"
          visivel={p.ativo && podeRemover} onClick={() => handleRemoverDaEmpresa(p)} />
        <AcaoRegistro tom="ativar" icone={ToggleLeft} rotulo="Reativar"
          visivel={!p.ativo && podeAtivar} onClick={() => handleReativar(p)} />
      </AcoesRegistro>
    );
  };

  const handleReativar = (p: Proprietario) => {
    if (!podeAtivar) { semPermissao('reativar proprietário'); return; }
    setConfirmReativ(p);
  };

  const handleReativarConfirmado = async (motivo: string) => {
    if (!confirmReativ) return;
    const p = confirmReativ;
    setConfirmReativ(null);
    try {
      await api.patch(`/cadastro/proprietarios/${p.id}/reativar`, { motivo });
      toast.success('Proprietário reativado');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao reativar proprietário');
    }
  };

  const labelDoc = (p: Proprietario) => {
    if (p.cnpj) return p.cnpj;
    if (p.cpf)  return p.cpf;
    return <span className="text-gray-300">—</span>;
  };

  if (loadingPerms) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('cadastro.proprietario.ler')) return (
    <PageContainer maxWidth="7xl">
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar proprietários.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
      <InlineError message={erroInline} className="mb-4" />

      <BotaoVoltar />
      <div className="flex items-center justify-between gap-3 mt-2 mb-6 flex-wrap">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <Users size={22} className="text-emerald-600" /> Proprietários
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(v => !v)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"
            title="Informações sobre este cadastro">
            <Info size={18} />
          </button>
          {podeCriar && (
            <button onClick={abrirNovo}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-2xl text-sm font-semibold hover:bg-emerald-700 transition-colors">
              Novo Proprietário
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-sm text-blue-800">
          <strong>Regras deste cadastro:</strong>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>Proprietários criados aqui recebem e-mail de boas-vindas com senha inicial.</li>
            <li>A senha padrão é <strong>Inicial_001</strong> — troca obrigatória no primeiro acesso.</li>
            <li>Proprietários são associados à empresa/equipe ativa no momento do cadastro.</li>
            <li>A remoção da empresa não exclui o proprietário do sistema.</li>
          </ul>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF, CNPJ ou cidade…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
          {(['all', 'ativo', 'inativo'] as const).map(v => (
            <button key={v} onClick={() => setFiltroAtivo(v)}
              className={`px-4 py-2.5 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                filtroAtivo === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}>
              {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabela desktop ────────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : proprietarios.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={48} className="mx-auto mb-3 opacity-30" />
            <p>Nenhum proprietário encontrado.</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto rounded-3xl">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Nome</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Telefone</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Cidade</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Contrato</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  {filtroAtivo === 'ativo' && (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Criado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado por</th>
                    </>
                  )}
                  {filtroAtivo === 'inativo' && (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado por</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proprietarios.map(p => (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${!p.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{p.fullName}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[200px]">{p.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {p.phone ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.cidade ? `${p.cidade}${p.estado ? `/${p.estado}` : ''}` : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {p.mensalista && (
                          <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium w-fit">Mensalista</span>
                        )}
                        {/* Uma linha por localidade — a frequência é de cada lugar */}
                        {(p.localidades ?? []).map(loc => (
                          <span key={loc.localizacaoId}
                            className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium w-fit max-w-[220px] truncate"
                            title={resumoLocalidade(loc)}>
                            {resumoLocalidade(loc)}
                          </span>
                        ))}
                        {/* Legado: cadastro anterior às localidades, só com o campo único */}
                        {(p.localidades ?? []).length === 0 && p.frequenciaVisitas && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium w-fit">
                            {p.frequenciaVisitas}x/semana
                          </span>
                        )}
                        {!p.mensalista && (p.localidades ?? []).length === 0 && !p.frequenciaVisitas && (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {filtroAtivo === 'ativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.ativoEm ?? p.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{p.ativoPorNome ?? '—'}</td>
                      </>
                    )}
                    {filtroAtivo === 'inativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.inativoEm)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{p.inativoPorNome ?? '—'}</td>
                        <td className="px-4 py-3"><JustificativaCancelamento texto={p.inativoMotivo} /></td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      {acoesDoProprietario(p)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Cards mobile ──────────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : proprietarios.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum proprietário encontrado.</p>
          </div>
        ) : proprietarios.map(p => (
          <div key={p.id} className={`bg-white rounded-3xl border border-gray-200 p-4 ${!p.ativo ? 'opacity-50' : ''}`}>
            <div className="flex justify-between items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 truncate">{p.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{p.email}</p>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {p.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            {p.phone && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Phone size={12} /> {p.phone}
              </div>
            )}
            {p.cidade && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <MapPin size={12} /> {p.cidade}{p.estado ? ` — ${p.estado}` : ''}
              </div>
            )}

            <div className="flex flex-wrap gap-1 mb-3">
              {p.mensalista && (
                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Mensalista</span>
              )}
              {/* Uma tag por localidade — a frequência é de cada lugar */}
              {(p.localidades ?? []).map(loc => (
                <span key={loc.localizacaoId}
                  className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {resumoLocalidade(loc)}
                </span>
              ))}
              {/* Legado: cadastro anterior às localidades, só com o campo único */}
              {(p.localidades ?? []).length === 0 && p.frequenciaVisitas && (
                <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {p.frequenciaVisitas}x/sem
                </span>
              )}
            </div>

            {filtroAtivo === 'ativo' && (
              <p className="text-[11px] text-gray-400 mb-2">
                Criado em {formatDate(p.createdAt)}
                {p.ativoPorNome ? ` · Ativado em ${formatDate(p.ativoEm ?? p.createdAt)} por ${p.ativoPorNome}` : ''}
              </p>
            )}
            {filtroAtivo === 'inativo' && (
              <p className="text-[11px] text-gray-400 mb-2">
                Inativado em {formatDate(p.inativoEm)}
                {p.inativoPorNome ? ` por ${p.inativoPorNome}` : ''}
                {p.inativoMotivo ? <> — <JustificativaCancelamento texto={p.inativoMotivo} className="inline" /></> : ''}
              </p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">{labelDoc(p)}</span>
              {acoesDoProprietario(p)}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <ProprietarioFormModal
          editando={editando}
          form={form}
          saving={saving}
          onFormChange={handleFormChange}
          erroAcao={erroAcao}
          onSalvar={handleSalvar}
          onClose={fecharModal}
        />
      )}

      {/* Inativação exige justificativa (registrada na Auditoria) */}
      <ModalJustificativa
        aberto={confirmRemov != null}
        titulo="Inativar proprietário"
        descricao={confirmRemov
          ? `${confirmRemov.fullName} não aparecerá mais nesta lista. Ele continuará existindo no sistema e poderá ser re-associado via novos cadastros de animais.`
          : undefined}
        extra={
          <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={inativarAnimais}
              onChange={e => setInativarAnimais(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-red-600"
            />
            <span className="text-xs text-gray-700">
              <span className="font-semibold">Inativar também os animais deste proprietário</span>
              <span className="block text-gray-500 mt-0.5">
                Marcado, todos os pacientes dele nesta empresa são inativados e as
                pendências em aberto (agendamento, prescrição, vacina, exame e
                encaminhamento) são canceladas. Desmarcado, os animais continuam
                ativos e nada do prontuário é tocado.
              </span>
            </span>
          </label>
        }
        acaoLabel="Inativar"
        onConfirmar={handleRemoverConfirmado}
        onFechar={() => setConfirmRemov(null)}
      />

      <ModalJustificativa
        aberto={confirmReativ != null}
        titulo="Reativar proprietário"
        descricao={confirmReativ
          ? `${confirmReativ.fullName} volta a aparecer normalmente na empresa. Os animais dele que foram inativados junto na remoção NÃO são reativados automaticamente — cada um se reativa separadamente, em Pacientes.`
          : undefined}
        acaoLabel="Reativar"
        tom="neutro"
        onConfirmar={handleReativarConfirmado}
        onFechar={() => setConfirmReativ(null)}
      />
    </PageContainer>
  );
}
