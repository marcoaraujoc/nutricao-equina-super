// frontend/src/pages/Nutrientes.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, Search, FlaskConical, Loader2 } from 'lucide-react';
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

interface Nutriente {
  id:            number;
  nome:          string;
  categoria:     string;
  unidadePadrao: string;
  /** true = catálogo do sistema (só o ADMIN da plataforma altera). */
  doSistema?:    boolean;
}

const Nutrientes = () => {
  const navigate = useNavigate();
  const { podeCriar, podeAlterar, podeExcluir, loading: loadingPerms } = useCatalogoNutricional();

  const [nutrientes, setNutrientes] = useState<Nutriente[]>([]);
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroAcao,   setErroAcao]   = useState<ErroAcaoDados | null>(null);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [aExcluir,   setAExcluir]   = useState<Nutriente | null>(null);
  const [excluindo,  setExcluindo]  = useState(false);

  const loadNutrientes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/nutrientes');
      setNutrientes(res.data ?? []);
    } catch (error) {
      console.error(error);
      setErroInline('Erro ao carregar nutrientes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNutrientes(); }, [loadNutrientes]);

  const filtrados = nutrientes.filter((n) =>
    n.nome.toLowerCase().includes(search.toLowerCase()),
  );

  // 🔴 Apaga do banco (§33: motivo obrigatório + Auditoria). Nutriente usado em
  // composição, exame ou exigência NRC volta 409 dizendo o que impede — a mensagem do
  // backend é exibida como está, porque é ela que diz QUANTOS registros seguram o item.
  const confirmDelete = async (motivo: string) => {
    if (!aExcluir) return;
    setExcluindo(true);
    try {
      await api.delete(`/nutrientes/${aExcluir.id}`, { data: { motivo } });
      toast.success('Nutriente excluído com sucesso!');
      setAExcluir(null);
      setErroAcao(null);
      loadNutrientes();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; mensagem?: string } } };
      setErroAcao({
        mensagem: err.response?.data?.error ?? err.response?.data?.mensagem ?? 'Erro ao excluir nutriente',
      });
    } finally {
      setExcluindo(false);
    }
  };

  const acoesDaLinha = (n: Nutriente) => (
    <AcoesRegistro>
      <AcaoRegistro
        tom="alterar" icone={Pencil} rotulo="Alterar"
        visivel={podeAlterar(n.doSistema)}
        onClick={() => navigate(`/nutrientes/${n.id}`)}
      />
      <AcaoRegistro
        tom="cancelar" icone={Trash2} rotulo="Excluir"
        visivel={podeExcluir(n.doSistema)}
        onClick={() => { setErroAcao(null); setAExcluir(n); }}
      />
    </AcoesRegistro>
  );

  return (
    <PageContainer maxWidth="7xl">

      <BotaoVoltar className="mb-6" />

      <InlineError message={erroInline} className="mb-4" />

      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <FlaskConical size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nutrientes</h1>
            <p className="text-sm text-gray-500">Catálogo do sistema + os nutrientes desta clínica</p>
          </div>
        </div>
        {podeCriar && (
          <button
            onClick={() => navigate('/nutrientes/novo')}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
            Novo Nutriente
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nome..."
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
            {filtrados.length} {filtrados.length === 1 ? 'nutriente' : 'nutrientes'}
          </span>
        </div>

        {loading || loadingPerms ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-emerald-600" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <FlaskConical size={38} className="mb-3" />
            <p className="text-sm text-gray-400">Nenhum nutriente encontrado</p>
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
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidade</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Origem</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtrados.map((n) => (
                    <tr key={n.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3"><p className="text-sm font-medium text-gray-900">{n.nome}</p></td>
                      <td className="px-4 py-3"><p className="text-xs text-gray-700">{n.categoria}</p></td>
                      <td className="px-4 py-3 text-center"><span className="text-sm font-semibold text-emerald-700">{n.unidadePadrao}</span></td>
                      <td className="px-4 py-3 text-center"><SeloOrigemCatalogo doSistema={n.doSistema} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">{acoesDaLinha(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-gray-50">
              {filtrados.map((n) => (
                <div key={n.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{n.nome}</p>
                      <p className="text-xs text-gray-500">{n.categoria} · {n.unidadePadrao}</p>
                    </div>
                    <SeloOrigemCatalogo doSistema={n.doSistema} />
                  </div>
                  <div className="flex justify-end">{acoesDaLinha(n)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ModalJustificativa
        aberto={aExcluir !== null}
        titulo="Excluir nutriente"
        descricao={aExcluir
          ? `"${aExcluir.nome}" será APAGADO do catálogo. Nutriente usado em composição, exame ou exigência NRC não pode ser excluído.`
          : ''}
        acaoLabel="Excluir"
        processando={excluindo}
        erro={erroAcao}
        onConfirmar={confirmDelete}
        onFechar={() => { setAExcluir(null); setErroAcao(null); }}
      />

    </PageContainer>
  );
};

export default Nutrientes;
