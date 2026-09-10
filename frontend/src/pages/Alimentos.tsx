// frontend/src/pages/Alimentos.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, Search, Wheat, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import { type ErroAcaoDados } from '../components/ErroAcao';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import ModalJustificativa from '../components/ModalJustificativa';
import SeloOrigemCatalogo from '../components/SeloOrigemCatalogo';
import { useCatalogoNutricional } from '../hooks/useCatalogoNutricional';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Alimento {
  id:         number;
  nome:       string;
  categoria:  string | null;
  fabricante: string | null;
  forma:      string | null;
  unidade:    string | null;
  ativo:      boolean;
  /** true = catálogo do sistema (só o ADMIN da plataforma altera). */
  doSistema?: boolean;
}

const CATEGORIAS = ['Concentrado', 'Óleo / Gordura', 'Suplemento', 'Volumoso'];

// ─── Componente ───────────────────────────────────────────────────────────────

const Alimentos = () => {
  const navigate = useNavigate();
  const { podeCriar, podeAlterar, podeExcluir, loading: loadingPerms } = useCatalogoNutricional();

  const [alimentos,       setAlimentos]       = useState<Alimento[]>([]);
  const [search,          setSearch]          = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [erroInline,      setErroInline]      = useState<string | null>(null);
  const [erroAcao,        setErroAcao]        = useState<ErroAcaoDados | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [itemToDelete,    setItemToDelete]    = useState<Alimento | null>(null);
  const [excluindo,       setExcluindo]       = useState(false);

  const loadAlimentos = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/alimentos');
      setAlimentos(res.data?.dados ?? res.data ?? []);
    } catch (error) {
      console.error('Erro ao carregar alimentos:', error);
      setErroInline('Erro ao carregar alimentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAlimentos(); }, [loadAlimentos]);

  const filtrados = alimentos.filter((a) => {
    const termo = search.toLowerCase();
    const matchTexto = a.nome.toLowerCase().includes(termo)
      || (a.fabricante ?? '').toLowerCase().includes(termo);
    const matchCategoria = !categoriaFiltro || a.categoria === categoriaFiltro;
    return matchTexto && matchCategoria;
  });

  // 🔴 A exclusão APAGA DO BANCO (não é mais `ativo = false`), então o motivo é
  // obrigatório e vai para a Auditoria — §33. Alimento em uso numa dieta volta 409
  // com a explicação, que é exibida no lugar de um "erro ao excluir" genérico.
  const confirmDelete = async (motivo: string) => {
    if (!itemToDelete) return;
    setExcluindo(true);
    try {
      const res = await api.delete(`/alimentos/${itemToDelete.id}`, { data: { motivo } });
      toast.success(res.data?.mensagem ?? 'Alimento excluído.');
      setItemToDelete(null);
      setErroAcao(null);
      loadAlimentos();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { mensagem?: string; error?: string } } };
      setErroAcao({
        mensagem: err.response?.data?.mensagem ?? err.response?.data?.error ?? 'Erro ao excluir alimento',
      });
    } finally {
      setExcluindo(false);
    }
  };

  const acoesDaLinha = (a: Alimento) => (
    <AcoesRegistro>
      <AcaoRegistro
        tom="alterar" icone={Pencil} rotulo="Alterar"
        visivel={podeAlterar(a.doSistema)}
        onClick={() => navigate(`/alimentos/${a.id}`)}
      />
      <AcaoRegistro
        tom="cancelar" icone={Trash2} rotulo="Excluir"
        visivel={podeExcluir(a.doSistema)}
        onClick={() => { setErroAcao(null); setItemToDelete(a); }}
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
            <Wheat size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Alimentos</h1>
            <p className="text-sm text-gray-500">Catálogo do sistema + os alimentos desta clínica</p>
          </div>
        </div>
        {podeCriar && (
          <button
            onClick={() => navigate('/alimentos/novo')}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
            Novo Alimento
          </button>
        )}
      </div>

      {/* Filtros + tabela */}
      <div className="bg-white border border-gray-100 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
          <select
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-emerald-600">
            <option value="">Todas as categorias</option>
            {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nome ou fabricante..."
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
            {filtrados.length} {filtrados.length === 1 ? 'alimento' : 'alimentos'}
          </span>
        </div>

        {loading || loadingPerms ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-emerald-600" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <Wheat size={38} className="mb-3" />
            <p className="text-sm text-gray-400">Nenhum alimento encontrado</p>
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Categoria</th>
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Fabricante</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Forma</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidade</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Origem</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtrados.map((a) => (
                    <tr key={a.id} className={`hover:bg-gray-50 transition-colors ${!a.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3"><p className="text-sm font-medium text-gray-900">{a.nome}</p></td>
                      <td className="px-4 py-3"><p className="text-xs text-gray-700">{a.categoria ?? '—'}</p></td>
                      <td className="px-4 py-3"><p className="text-xs text-gray-500">{a.fabricante ?? <span className="text-gray-300">—</span>}</p></td>
                      <td className="px-4 py-3 text-center"><p className="text-xs text-gray-700">{a.forma ?? '—'}</p></td>
                      <td className="px-4 py-3 text-center"><p className="text-xs text-gray-700">{a.unidade ?? '—'}</p></td>
                      <td className="px-4 py-3 text-center"><SeloOrigemCatalogo doSistema={a.doSistema} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">{acoesDaLinha(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-gray-50">
              {filtrados.map((a) => (
                <div key={a.id} className={`px-4 py-3 ${!a.ativo ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.nome}</p>
                      <p className="text-xs text-gray-500">
                        {[a.categoria, a.fabricante, a.forma, a.unidade].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <SeloOrigemCatalogo doSistema={a.doSistema} />
                  </div>
                  <div className="flex justify-end">{acoesDaLinha(a)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ModalJustificativa
        aberto={itemToDelete !== null}
        titulo="Excluir alimento"
        descricao={itemToDelete
          ? `"${itemToDelete.nome}" será APAGADO do catálogo, junto com as composições dele. Alimento usado em alguma dieta não pode ser excluído.`
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

export default Alimentos;
