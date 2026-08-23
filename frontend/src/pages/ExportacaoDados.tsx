// frontend/src/pages/ExportacaoDados.tsx
// Administração > Exportação — exporta o prontuário COMPLETO de um paciente, ou de
// todos os pacientes de um proprietário, num ZIP (relatório + mídias reais).
//
// Multi-tenant/RLS: a lista que esta tela mostra já vem do backend filtrada pelo
// escopo do usuário (mesma fonte que a tela de Pacientes usa — `buildAnimalScopeWhere`)
// — aqui não há filtro extra a aplicar, só selecionar dentro do que já veio.
import { useState, useEffect, useMemo } from 'react';
import { Download, Loader2, Search, ChevronDown, ChevronRight, FileDown, Users, PawPrint, History } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';

interface DonoAnterior {
  proprietarioId: number;
  nome: string;
  dataInicio: string;
  dataFim: string;
}

interface AnimalExportavel {
  id: number;
  nome: string;
  especie: string | null;
  proprietario: { id: number; nome: string; email: string | null } | null;
  // Janelas FECHADAS de posse (Transferência de Propriedade) — cada uma vira uma
  // opção própria de exportação, restrita àquele período exato.
  donosAnteriores?: DonoAnterior[];
}

function formatarPeriodo(d: DonoAnterior): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
  return `${fmt(d.dataInicio)} a ${fmt(d.dataFim)}`;
}
interface GrupoProprietario {
  id: number | null; // null = "sem proprietário" (não deveria existir, mas não trava a tela)
  nome: string;
  animais: AnimalExportavel[];
}

// Extrai a mensagem de erro de uma resposta que veio como Blob (a exportação pede
// `responseType: 'blob'` para o caminho de sucesso — em erro, o axios devolve o corpo
// de erro NO MESMO formato, então `err.response.data` é um Blob de JSON, não o objeto
// já parseado. Sem isto, todo erro de negócio (ex.: "selecione ao menos um paciente")
// cairia no fallback genérico.
async function mensagemDeErroBlob(err: unknown, fallback: string): Promise<string> {
  const resp = (err as { response?: { data?: unknown } })?.response;
  const data = resp?.data;
  if (data instanceof Blob) {
    try {
      const texto = await data.text();
      const json = JSON.parse(texto) as { error?: string };
      if (json.error) return json.error;
    } catch { /* corpo não era JSON — usa o fallback */ }
  }
  const msg = (data as { error?: string } | undefined)?.error;
  return msg || fallback;
}

export default function ExportacaoDados() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms } = usePermissoes();
  const podeAcessar = isGestor || user?.userType === 'ADMIN';

  const [animais, setAnimais] = useState<AnimalExportavel[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [gruposAbertos, setGruposAbertos] = useState<Set<number | null>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);

  useEffect(() => {
    if (loadingPerms || !podeAcessar) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const res = await api.get('/admin/exportacao/animais');
        if (!res.data) return; // GET 403 → data null (permissão)
        setAnimais(res.data?.dados ?? []);
        setErroInline(null);
      } catch {
        setErroInline('Erro ao carregar a lista de pacientes.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadingPerms, podeAcessar]);

  // Agrupa por proprietário — é o que a tela usa para "todos os pacientes dele".
  const grupos = useMemo<GrupoProprietario[]>(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = termo
      ? animais.filter(a =>
          a.nome.toLowerCase().includes(termo) ||
          (a.proprietario?.nome ?? '').toLowerCase().includes(termo))
      : animais;

    const mapa = new Map<number | null, GrupoProprietario>();
    for (const a of filtrados) {
      const chave = a.proprietario?.id ?? null;
      if (!mapa.has(chave)) {
        mapa.set(chave, { id: chave, nome: a.proprietario?.nome ?? 'Sem proprietário', animais: [] });
      }
      mapa.get(chave)!.animais.push(a);
    }
    return [...mapa.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }, [animais, busca]);

  const toggleGrupo = (id: number | null) => {
    setGruposAbertos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAnimal = (id: number) => {
    setSelecionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleProprietarioInteiro = (grupo: GrupoProprietario) => {
    const todosMarcados = grupo.animais.every(a => selecionados.has(a.id));
    setSelecionados(prev => {
      const next = new Set(prev);
      for (const a of grupo.animais) {
        if (todosMarcados) next.delete(a.id); else next.add(a.id);
      }
      return next;
    });
  };

  const limparSelecao = () => setSelecionados(new Set());

  // Compartilhado entre a exportação em lote (dono atual) e a de um período de
  // dono ANTERIOR (uma linha de "Donos anteriores") — mesmo download, mesmo erro.
  const baixarZip = async (animalIds: number[], proprietarioId: number | undefined, mensagemSucesso: string) => {
    const res = await api.post(
      '/admin/exportacao/gerar',
      { animalIds, ...(proprietarioId != null ? { proprietarioId } : {}) },
      { responseType: 'blob' },
    );
    const blob = res.data as Blob;
    const nomeArquivo = (() => {
      const cd = (res.headers?.['content-disposition'] ?? '') as string;
      const m = /filename="([^"]+)"/.exec(cd);
      return m?.[1] ?? 'exportacao-pacientes.zip';
    })();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    toast.success(mensagemSucesso);
  };

  const exportar = async () => {
    if (selecionados.size === 0) { setErroExportar('Selecione ao menos um paciente.'); return; }
    setExportando(true);
    setErroExportar(null);
    try {
      await baixarZip([...selecionados], undefined, `Exportação de ${selecionados.size} paciente(s) concluída`);
    } catch (err) {
      setErroExportar(await mensagemDeErroBlob(err, 'Erro ao gerar a exportação.'));
    } finally {
      setExportando(false);
    }
  };

  // Exportação de UM animal, restrita ao período de um dono ANTERIOR — ação própria
  // por linha (não entra na seleção em lote, que é sempre "dono atual").
  const [exportandoPeriodo, setExportandoPeriodo] = useState<string | null>(null);
  const [erroPeriodo,       setErroPeriodo]       = useState<string | null>(null);

  const exportarPeriodoAnterior = async (animal: AnimalExportavel, dono: DonoAnterior) => {
    const chave = `${animal.id}:${dono.proprietarioId}`;
    setExportandoPeriodo(chave);
    setErroPeriodo(null);
    try {
      await baixarZip([animal.id], dono.proprietarioId, `Exportação do período de ${dono.nome} concluída`);
    } catch (err) {
      setErroPeriodo(await mensagemDeErroBlob(err, 'Erro ao gerar a exportação do período.'));
    } finally {
      setExportandoPeriodo(null);
    }
  };

  if (!loadingPerms && !podeAcessar) return (
    <PageContainer>
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Apenas gestores e administradores podem exportar dados de pacientes.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <InlineError message={erroInline} className="mb-3" />

      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <FileDown size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exportação de Dados</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Exporte o prontuário completo (evolução, prescrição, vacina, exames, imagens e histórico) de um ou mais pacientes, em um arquivo .zip.
          </p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por paciente ou proprietário..."
          className="w-full pl-9 pr-3 py-2.5 text-sm text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:border-emerald-500 bg-white shadow-sm" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : grupos.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-16">Nenhum paciente encontrado.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 mb-28">
          {grupos.map(grupo => {
            const aberto = gruposAbertos.has(grupo.id);
            const todosMarcados = grupo.animais.every(a => selecionados.has(a.id));
            const algunsMarcados = !todosMarcados && grupo.animais.some(a => selecionados.has(a.id));
            return (
              <div key={grupo.id ?? 'sem-proprietario'}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button onClick={() => toggleGrupo(grupo.id)} className="p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0">
                    {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <input type="checkbox" checked={todosMarcados}
                    ref={el => { if (el) el.indeterminate = algunsMarcados; }}
                    onChange={() => toggleProprietarioInteiro(grupo)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0" />
                  <button onClick={() => toggleGrupo(grupo.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    <Users size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-gray-900 truncate">{grupo.nome}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {grupo.animais.length} paciente{grupo.animais.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                </div>
                {aberto && (
                  <div className="pl-11 pb-2 space-y-0.5">
                    {grupo.animais.map(a => (
                      <div key={a.id}>
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={selecionados.has(a.id)} onChange={() => toggleAnimal(a.id)}
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                          <PawPrint size={12} className="text-gray-300 flex-shrink-0" />
                          <span className="text-sm text-gray-800">{a.nome}</span>
                          {a.especie && <span className="text-xs text-gray-400">· {a.especie}</span>}
                        </label>
                        {/* Donos ANTERIORES (Transferência de Propriedade) — cada janela
                            fechada é exportável isoladamente, restrita àquele período. */}
                        {(a.donosAnteriores?.length ?? 0) > 0 && (
                          <div className="pl-8 pb-1 space-y-0.5">
                            {a.donosAnteriores!.map(dono => {
                              const chave = `${a.id}:${dono.proprietarioId}`;
                              const carregando = exportandoPeriodo === chave;
                              return (
                                <div key={chave} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-500">
                                  <History size={11} className="text-gray-300 flex-shrink-0" />
                                  <span className="flex-1 min-w-0 truncate">
                                    Dono anterior: <span className="font-medium text-gray-700">{dono.nome}</span> — {formatarPeriodo(dono)}
                                  </span>
                                  <button
                                    onClick={() => exportarPeriodoAnterior(a, dono)}
                                    disabled={carregando}
                                    className="flex items-center gap-1 px-2 py-0.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 flex-shrink-0">
                                    {carregando ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                                    Exportar este período
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {erroPeriodo && (
                  <div className="pl-11 pb-2">
                    <InlineError message={erroPeriodo} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Barra fixa inferior — resumo da seleção + ação de exportar */}
      {selecionados.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-72 bg-white border-t border-gray-200 shadow-lg px-4 py-3 z-30">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {selecionados.size} paciente{selecionados.size !== 1 ? 's' : ''} selecionado{selecionados.size !== 1 ? 's' : ''}
              </p>
              <InlineError message={erroExportar} className="mt-1" />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={limparSelecao} disabled={exportando}
                className="px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50">
                Limpar
              </button>
              <button onClick={exportar} disabled={exportando}
                className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60">
                {exportando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {exportando ? 'Gerando exportação...' : 'Exportar (.zip)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
