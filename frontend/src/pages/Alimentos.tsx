// src/pages/Alimentos.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Alimento {
  id: number;
  nome: string;
  categoria: string | null;
  fabricante: string | null;
  forma: string | null;
  unidade: string | null;
  ativo: boolean;
}

const CATEGORIAS = ['Concentrado', 'Óleo / Gordura', 'Suplemento', 'Volumoso'];

// ─── Componente ───────────────────────────────────────────────────────────────

const Alimentos = () => {
  const navigate = useNavigate();

  const [alimentos,       setAlimentos]       = useState<Alimento[]>([]);
  const [search,          setSearch]          = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [itemToDelete,    setItemToDelete]     = useState<Alimento | null>(null);

  // ── Carregamento ──────────────────────────────────────────────────────────

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

  // ── Filtro local ──────────────────────────────────────────────────────────

  const filtrados = alimentos.filter(a => {
    const termo = search.toLowerCase();
    const matchTexto = a.nome.toLowerCase().includes(termo)
      || (a.fabricante ?? '').toLowerCase().includes(termo);
    const matchCategoria = !categoriaFiltro || a.categoria === categoriaFiltro;
    return matchTexto && matchCategoria;
  });

  // ── Exclusão ──────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await api.delete(`/alimentos/${itemToDelete.id}`);
      toast.success('Alimento desativado com sucesso!');
      setItemToDelete(null);
      loadAlimentos();
    } catch (error) {
      console.error(error);
      setErroInline('Erro ao excluir alimento');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-6xl mx-auto px-4">

        {/* Voltar */}
        <BotaoVoltar className="mb-4 mt-6" />

        <InlineError message={erroInline} className="mb-4" />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Alimentos</h1>
          <button
            onClick={() => navigate('/alimentos/novo')}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold transition-colors text-sm w-full sm:w-auto">
            Novo Alimento
          </button>
        </div>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="w-full sm:w-52">
            <select
              value={categoriaFiltro}
              onChange={e => setCategoriaFiltro(e.target.value)}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 bg-white text-gray-900 focus:outline-none focus:border-emerald-600 text-sm">
              <option value="">Todas as categorias</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <input
              type="text"
              placeholder="Buscar por nome ou fabricante..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-2xl px-5 py-3 text-gray-900 bg-white focus:outline-none focus:border-emerald-600 text-sm" />
          </div>
        </div>

        {/* Tabela */}
        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando alimentos...</p>
        ) : (
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nome</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Categoria</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Fabricante</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Forma</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Unidade</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                      Nenhum alimento encontrado.
                    </td>
                  </tr>
                ) : filtrados.map(alimento => (
                  <tr key={alimento.id} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{alimento.nome}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{alimento.categoria ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{alimento.fabricante ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{alimento.forma ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{alimento.unidade ?? '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => navigate(`/alimentos/${alimento.id}`)}
                          className="text-emerald-600 hover:text-emerald-700"
                          title="Editar">
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => setItemToDelete(alimento)}
                          className="text-red-500 hover:text-red-700"
                          title="Excluir">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Contagem */}
        {!loading && filtrados.length > 0 && (
          <p className="text-center text-sm text-gray-400 mt-4">
            {filtrados.length} {filtrados.length === 1 ? 'alimento encontrado' : 'alimentos encontrados'}
          </p>
        )}

        {/* Modal de exclusão */}
        {itemToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
              <div className="bg-emerald-700 text-white p-6 text-center">
                <h2 className="text-xl font-bold">Excluir alimento?</h2>
                <p className="text-emerald-100 mt-2 text-sm">
                  Tem certeza que deseja desativar <strong>{itemToDelete.nome}</strong>?
                  O alimento não aparecerá mais nas listagens, mas o histórico de dietas é preservado.
                </p>
              </div>
              <div className="p-6 flex gap-3">
                <button
                  onClick={() => setItemToDelete(null)}
                  className="flex-1 py-3 text-gray-700 font-semibold border border-gray-300 rounded-2xl hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-3 bg-red-600 text-white font-semibold rounded-2xl hover:bg-red-700 transition-colors">
                  Sim, Excluir
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Alimentos;