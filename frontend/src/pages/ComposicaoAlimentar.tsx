// frontend/src/pages/ComposicaoAlimentar.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, Check, X, Search, Layers, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import ModalJustificativa from '../components/ModalJustificativa';
import SeloOrigemCatalogo from '../components/SeloOrigemCatalogo';
import { useEspeciesDaEmpresa } from '../hooks/useEspeciesDaEmpresa';
import { useCatalogoNutricional } from '../hooks/useCatalogoNutricional';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Especie   { id: number; nome: string }
interface Alimento  { id: number; nome: string }
interface Nutriente { id: number; nome: string; unidadePadrao: string }

interface ComposicaoItem {
  id:          number;
  alimentoId:  number;
  nutrienteId: number;
  especieId?:  number | null;
  valorPorKg:  number;
  base:        string;
  alimento?:   Alimento | null;
  nutriente?:  Nutriente | null;
  especie?:    Especie | null;
  /** true = catálogo do sistema (só o ADMIN da plataforma altera). */
  doSistema?:  boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

const ComposicaoAlimentar = () => {
  const navigate = useNavigate();

  // Espécies oferecidas = permitidas (Equino/Bovino) ∩ atendidas pela empresa.
  // Sobrando UMA, o campo não é exibido e ela vira o filtro — não há escolha a fazer.
  const { especies, loading: loadingEspecies, unica: especieUnica } = useEspeciesDaEmpresa();
  // Composição do SISTEMA é somente leitura; a da clínica ela edita e exclui.
  const { podeCriar, podeAlterar, podeExcluir } = useCatalogoNutricional();

  const [composicoes, setComposicoes] = useState<ComposicaoItem[]>([]);
  const [erroInline,  setErroInline]  = useState<string | null>(null);
  const [erroAcao,    setErroAcao]    = useState<ErroAcaoDados | null>(null);

  const [search,        setSearch]        = useState('');
  const [especieFiltro, setEspecieFiltro] = useState('');
  const [loading,       setLoading]       = useState(true);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValor, setEditValor] = useState('');

  const [itemToDelete, setItemToDelete] = useState<ComposicaoItem | null>(null);
  const [excluindo,    setExcluindo]    = useState(false);

  // Espécie única resolvida ⇒ ela É o filtro (o campo some da tela).
  useEffect(() => {
    if (especieUnica) setEspecieFiltro(String(especieUnica.id));
  }, [especieUnica]);

  const loadComposicoes = useCallback(async () => {
    try {
      setLoading(true);
      const params = especieFiltro ? { especieId: especieFiltro } : {};
      const res = await api.get('/composicoes-alimentares', { params });
      setComposicoes(res.data?.dados ?? []);
    } catch (error) {
      console.error('Erro ao carregar composições:', error);
      setErroInline('Erro ao carregar composições');
    } finally {
      setLoading(false);
    }
  }, [especieFiltro]);

  // Espera a resolução das espécies: sem isso a primeira carga sairia SEM o filtro
  // da espécie única e a lista piscaria com o catálogo inteiro.
  useEffect(() => {
    if (loadingEspecies) return;
    loadComposicoes();
  }, [loadComposicoes, loadingEspecies]);

  // ─── Edição inline (só o valor) ─────────────────────────────────────────────

  const startEdit = (item: ComposicaoItem) => {
    setEditingId(item.id);
    setEditValor(String(item.valorPorKg));
    setErroAcao(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValor('');
  };

  const saveEdit = async (id: number) => {
    const valor = parseFloat(editValor);
    if (!editValor || isNaN(valor) || valor < 0) {
      setErroAcao({ mensagem: 'Informe um valor numérico válido', campos: ['valor'] });
      return;
    }
    try {
      await api.put(`/composicoes-alimentares/${id}`, { valorPorKg: valor });
      toast.success('Composição atualizada!');
      cancelEdit();
      loadComposicoes();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { mensagem?: string } } };
      setErroAcao({ mensagem: err.response?.data?.mensagem ?? 'Erro ao salvar edição' });
    }
  };

  // 🔴 Apaga do banco (§33: motivo obrigatório + Auditoria).
  const confirmDelete = async (motivo: string) => {
    if (!itemToDelete) return;
    setExcluindo(true);
    try {
      await api.delete(`/composicoes-alimentares/${itemToDelete.id}`, { data: { motivo } });
      toast.success('Composição excluída com sucesso!');
      setItemToDelete(null);
      setErroAcao(null);
      loadComposicoes();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { mensagem?: string } } };
      setErroAcao({ mensagem: err.response?.data?.mensagem ?? 'Erro ao excluir composição' });
    } finally {
      setExcluindo(false);
    }
  };

  const filtradas = composicoes.filter((c) =>
    `${c.alimento?.nome ?? ''} ${c.nutriente?.nome ?? ''} ${c.especie?.nome ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const acoesDaLinha = (item: ComposicaoItem) =>
    editingId === item.id ? (
      <AcoesRegistro>
        <AcaoRegistro tom="finalizar" icone={Check} rotulo="Salvar"   onClick={() => saveEdit(item.id)} />
        <AcaoRegistro tom="neutro"    icone={X}     rotulo="Cancelar" onClick={cancelEdit} />
      </AcoesRegistro>
    ) : (
      <AcoesRegistro>
        <AcaoRegistro
          tom="alterar" icone={Pencil} rotulo="Alterar" titulo="Editar valor"
          visivel={podeAlterar(item.doSistema)}
          onClick={() => startEdit(item)}
        />
        <AcaoRegistro
          tom="cancelar" icone={Trash2} rotulo="Excluir"
          visivel={podeExcluir(item.doSistema)}
          onClick={() => { setErroAcao(null); setItemToDelete(item); }}
        />
      </AcoesRegistro>
    );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="7xl">

      <BotaoVoltar className="mb-6" />

      <InlineError message={erroInline} className="mb-4" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Layers size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Composição Alimentar</h1>
            <p className="text-sm text-gray-500">Catálogo do sistema + as composições desta clínica</p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {podeCriar && (
          <button
            onClick={() => navigate('/composicao-alimentar/nutriente/novo')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-emerald-700 border border-emerald-700 text-sm font-semibold rounded-2xl transition-colors">
            Novo Nutriente
          </button>
          )}
          {podeCriar && (
          <button
            onClick={() => navigate('/composicao-alimentar/novo')}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
            Nova Composição
          </button>
          )}
        </div>
      </div>

      {/* Filtros + tabela */}
      <div className="bg-white border border-gray-100 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">

          {/* Espécie — só aparece quando há mais de uma para escolher */}
          {especies.length > 1 && (
            <select
              value={especieFiltro}
              onChange={(e) => setEspecieFiltro(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-emerald-600">
              <option value="">Todas as espécies</option>
              {especies.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          )}

          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por alimento ou nutriente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-emerald-600"
            />
          </div>

          {search && (
            <button onClick={() => setSearch('')}
              className="px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl bg-white">
              Limpar ×
            </button>
          )}

          <span className="ml-auto text-xs text-gray-400">
            {filtradas.length} {filtradas.length === 1 ? 'composição' : 'composições'}
          </span>
        </div>

        <ErroAcao erro={erroAcao} className="mx-4 mt-3" />

        {loading || loadingEspecies ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-emerald-600" />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <Layers size={38} className="mb-3" />
            <p className="text-sm text-gray-400">Nenhuma composição encontrada</p>
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Alimento</th>
                    {especies.length > 1 && (
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Espécie</th>
                    )}
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Nutriente</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor (/kg)</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Base</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Origem</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtradas.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{item.alimento?.nome ?? '—'}</p>
                      </td>
                      {especies.length > 1 && (
                        <td className="px-4 py-3 text-center">
                          <p className="text-xs text-gray-500">
                            {item.especie?.nome ?? <span className="text-gray-300">—</span>}
                          </p>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700">{item.nutriente?.nome ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === item.id ? (
                          <input
                            type="number" step="0.0001" min="0" autoFocus
                            value={editValor}
                            onChange={(e) => setEditValor(e.target.value)}
                            className="w-28 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                          />
                        ) : (
                          <span className="text-sm font-semibold text-emerald-700">{item.valorPorKg}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="text-xs text-gray-700">{item.base}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <SeloOrigemCatalogo doSistema={item.doSistema} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {acoesDaLinha(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-gray-50">
              {filtradas.map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.alimento?.nome ?? '—'}</p>
                      <p className="text-xs text-gray-500">
                        {item.nutriente?.nome ?? '—'}
                        {especies.length > 1 && item.especie?.nome ? ` · ${item.especie.nome}` : ''}
                        {` · base ${item.base}`}
                      </p>
                    </div>
                    {editingId === item.id ? (
                      <input
                        type="number" step="0.0001" min="0" autoFocus
                        value={editValor}
                        onChange={(e) => setEditValor(e.target.value)}
                        className="w-24 border border-gray-200 rounded-xl px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 flex-shrink-0"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-emerald-700 flex-shrink-0">{item.valorPorKg}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <SeloOrigemCatalogo doSistema={item.doSistema} />
                    {acoesDaLinha(item)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ModalJustificativa
        aberto={itemToDelete !== null}
        titulo="Excluir composição"
        descricao={itemToDelete
          ? `${itemToDelete.alimento?.nome ?? '?'} × ${itemToDelete.nutriente?.nome ?? '?'} será APAGADO do catálogo.`
          : ''}
        acaoLabel="Excluir"
        processando={excluindo}
        erro={erroAcao}
        onConfirmar={confirmDelete}
        onFechar={() => { setItemToDelete(null); setErroAcao(null); }}
      />

    </PageContainer>
  );
};

export default ComposicaoAlimentar;
