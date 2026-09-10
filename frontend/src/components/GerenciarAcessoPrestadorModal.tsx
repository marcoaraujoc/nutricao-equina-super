// src/components/GerenciarAcessoPrestadorModal.tsx
//
// DESIGNAÇÃO DE PACIENTES AO PROFISSIONAL EXTERNO (Fornecedor / Prestador).
//
// 🔴 POR QUE ELE MORA AQUI, e não mais dentro de `ControleAcesso.tsx`: a partir de
// 2026-09-09 **Fornecedor e Prestador não fazem parte da equipe** — eles saíram da
// tela Equipe, do Controle de Acesso e da grade da Agenda, e passaram a ser geridos
// pelos PRÓPRIOS cadastros. A designação foi junto: ela é o que define o acesso deles
// a paciente (`DesignacaoPrestador`, deny-by-default), então precisa estar onde a
// pessoa é gerenciada — senão o cadastro concede login e não há por onde dizer QUEM
// ele pode atender.
//
// Usado por `/cadastro/fornecedores` e `/cadastro/prestadores`. Um componente só, pelo
// motivo de sempre: duas cópias divergiriam na primeira correção, e o que divergiria
// seria justamente o alcance de um profissional externo aos prontuários.
//
// ⚠️ O `prestadorUserId` é o **login** (`Fornecedor.userId` / `Prestador.userId`), não
// o id do cadastro: a designação é por USUÁRIO, porque é o usuário que abre a tela.
// Cadastro sem login não tem o que designar — quem chama não deve oferecer o botão.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, Check, ChevronDown, MapPin, PawPrint, Trash2, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import ConfirmModal from './ConfirmModal';
import InlineError from './InlineError';
import FotoAnimal from './FotoAnimal';


interface AnimalDesignacao {
  id:            number;
  nome:          string;
  photoUrl:      string | null;
  especie:       { nome: string } | null;
  /** Localização cadastrada; `local` é o texto legado usado como fallback */
  localizacaoId: number | null;
  localizacao:   { id: number; nome: string } | null;
  local:         string | null;
}

interface AnimalDesignado {
  id:          number;
  ativo:       boolean;
  dataInicio:  string;
  dataFim:     string | null;
  motivo:      string | null;
  animal:      AnimalDesignacao;
}

type AnimalDisponivel = AnimalDesignacao;

// Chave e rótulo do local de um animal. Animal sem localização cadastrada cai no
// texto legado `local`; sem nenhum dos dois vira o grupo "Sem local".
const SEM_LOCAL = '__sem_local__';

function chaveLocal(a: AnimalDesignacao): string {
  if (a.localizacaoId) return `id:${a.localizacaoId}`;
  const texto = a.local?.trim();
  return texto ? `txt:${texto.toLocaleLowerCase('pt-BR')}` : SEM_LOCAL;
}

function rotuloLocal(a: AnimalDesignacao): string {
  return a.localizacao?.nome ?? a.local?.trim() ?? 'Sem local';
}

// Busca por nome sem depender de acento/caixa ("cafe" acha "Cafe" e "Café").
// Mesma normalização usada em RelatorioNutricional.tsx.
function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export default function GerenciarAcessoPrestadorModal({
  equipeId, prestadorUserId, prestadorNome, onClose,
}: {
  equipeId:        number;
  prestadorUserId: number;
  prestadorNome:   string;
  onClose:         () => void;
}) {
  const [loading,  setLoading]  = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [designacoes,        setDesignacoes]        = useState<AnimalDesignado[]>([]);
  const [animaisDisponiveis, setAnimaisDisponiveis] = useState<AnimalDisponivel[]>([]);
  const [motivo,             setMotivo]             = useState('');

  // Seleção MÚLTIPLA no padrão do "inserir exames" (SubModuloExames): botão abre um
  // dropdown com busca e checkbox por item, e os marcados viram chips numerados.
  const [animaisSel,     setAnimaisSel]     = useState<number[]>([]);
  const [showAnimalDrop, setShowAnimalDrop] = useState(false);
  const [animalSearch,   setAnimalSearch]   = useState('');
  const animalDropdownRef = useRef<HTMLDivElement>(null);

  // Filtro por local (haras/localização cadastrada): recorta o dropdown e o alcance
  // do "Marcar todos" — sem filtro, é a base inteira.
  const [filtroLocal, setFiltroLocal] = useState('');

  const [confirmRemover,      setConfirmRemover]      = useState<{ animalId: number; nomeAnimal: string } | null>(null);
  const [confirmRemoverTodos, setConfirmRemoverTodos] = useState(false);
  const [removendoTodos,      setRemovendoTodos]      = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes`);
      setDesignacoes(res.data?.dados?.designacoes ?? []);
      setAnimaisDisponiveis(res.data?.dados?.animaisDisponiveis ?? []);
    } catch { setErroInline('Erro ao carregar designações'); }
    finally  { setLoading(false); }
  }, [equipeId, prestadorUserId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Click-outside fecha o dropdown e limpa a busca (mesmo padrão de SubModuloExames).
  useEffect(() => {
    if (!showAnimalDrop) { setAnimalSearch(''); return; }
    const handler = (e: MouseEvent) => {
      if (!animalDropdownRef.current?.contains(e.target as Node)) setShowAnimalDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAnimalDrop]);

  const toggleAnimal = (animalId: number) =>
    setAnimaisSel(prev => prev.includes(animalId) ? prev.filter(id => id !== animalId) : [...prev, animalId]);

  // Locais presentes na lista de disponíveis, para popular o filtro. Só aparecem
  // locais que têm animal a designar — filtro que não filtra nada é ruído.
  const locaisDisponiveis = useMemo(() => {
    const mapa = new Map<string, { chave: string; label: string; total: number }>();
    animaisDisponiveis.forEach(a => {
      const chave = chaveLocal(a);
      const item  = mapa.get(chave);
      if (item) item.total += 1;
      else mapa.set(chave, { chave, label: rotuloLocal(a), total: 1 });
    });
    return [...mapa.values()].sort((x, y) => x.label.localeCompare(y.label, 'pt-BR'));
  }, [animaisDisponiveis]);

  // Escopo do local: o que o dropdown lista E o que o "Inserir todos" concede.
  const disponiveisNoLocal = useMemo(
    () => (filtroLocal ? animaisDisponiveis.filter(a => chaveLocal(a) === filtroLocal) : animaisDisponiveis),
    [animaisDisponiveis, filtroLocal],
  );

  // A busca do dropdown é digitada DENTRO dele (não é filtro de tela) — por isso não
  // entra no alcance do "Inserir todos", igual ao dropdown de exames.
  const visiveisNoDropdown = useMemo(() => {
    const termo = normalizarBusca(animalSearch.trim());
    return termo ? disponiveisNoLocal.filter(a => normalizarBusca(a.nome).includes(termo)) : disponiveisNoLocal;
  }, [disponiveisNoLocal, animalSearch]);

  // Trocar o local descarta os marcados que saíram do escopo — não se insere quem
  // não está mais visível.
  useEffect(() => {
    setAnimaisSel(prev => prev.filter(id => disponiveisNoLocal.some(a => a.id === id)));
  }, [disponiveisNoLocal]);

  const nomePorId = useMemo(
    () => new Map(animaisDisponiveis.map(a => [a.id, a.nome])),
    [animaisDisponiveis],
  );

  // Um único caminho de inserção: os animais MARCADOS no dropdown (o "Marcar todos"
  // de lá cobre o caso de conceder o local inteiro). Sempre pela rota de lote —
  // marcar 1 ou 20 é a mesma chamada, numa transaction só.
  const handleInserirMarcados = async () => {
    if (animaisSel.length === 0) { setErroInline('Marque ao menos um animal'); return; }
    setSalvando(true);
    try {
      const res = await api.post(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes/lote`, {
        animalIds: animaisSel, motivo,
      });
      const n = res.data?.dados?.concedidos ?? animaisSel.length;
      toast.success(`Acesso concedido a ${n} animal${n === 1 ? '' : 'is'}`);
      setAnimaisSel([]); setMotivo(''); setAnimalSearch(''); setShowAnimalDrop(false);
      carregar();
    } catch { setErroInline('Erro ao conceder acesso'); }
    finally  { setSalvando(false); }
  };

  const handleRemover = (animalId: number, nomeAnimal: string) => {
    setConfirmRemover({ animalId, nomeAnimal });
  };

  const handleRemoverConfirmado = async () => {
    if (!confirmRemover) return;
    const { animalId } = confirmRemover;
    setConfirmRemover(null);
    try {
      await api.delete(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes/${animalId}`);
      toast.success('Acesso removido');
      carregar();
    } catch { setErroInline('Erro ao remover acesso'); }
  };

  // Revoga de uma vez todo o acesso vigente (DELETE sem :animalId). Uma chamada só —
  // um DELETE por animal poderia parar no meio e deixar acesso revogado pela metade.
  const handleRemoverTodos = async () => {
    setConfirmRemoverTodos(false);
    setErroInline(null);
    setRemovendoTodos(true);
    try {
      const res = await api.delete(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes`);
      const n = res.data?.dados?.removidos ?? ativas.length;
      toast.success(`Acesso removido de ${n} animal${n === 1 ? '' : 'is'}`);
      carregar();
    } catch { setErroInline('Erro ao remover os acessos'); }
    finally  { setRemovendoTodos(false); }
  };

  // Só o acesso VIGENTE aparece na tela. As designações inativas seguem no banco
  // (histórico/auditoria) e continuam vindo no GET — apenas não são exibidas.
  const ativas = designacoes.filter(d => d.ativo);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <InlineError message={erroInline} className="mx-6 mt-4 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
              <Wrench size={16} className="text-teal-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Gerenciar Acesso</h2>
              <p className="text-xs text-gray-400">{prestadorNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-teal-500" /></div>
          ) : (
            <div className="space-y-5">

              {/* Conceder acesso */}
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-3">Concessão de Acesso aos Pacientes</p>
                <div className="space-y-2">

                  {/* Filtro por local — recorta o dropdown e o "Marcar todos" */}
                  <div className="relative">
                    <MapPin size={12} className="absolute left-2.5 top-3 text-gray-400 pointer-events-none" />
                    <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:border-teal-500">
                      <option value="">Todos os locais ({animaisDisponiveis.length})</option>
                      {locaisDisponiveis.map(l => (
                        <option key={l.chave} value={l.chave}>{l.label} ({l.total})</option>
                      ))}
                    </select>
                  </div>

                  {/* Seleção múltipla no padrão do "inserir exames": botão → dropdown
                      com busca e checkbox por animal. Só o NOME do animal na linha. */}
                  <div className="relative" ref={animalDropdownRef}>
                    {showAnimalDrop ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 border border-teal-400 rounded-xl bg-white">
                        <PawPrint size={14} className="text-teal-400 flex-shrink-0" />
                        <input autoFocus type="text" value={animalSearch}
                          onChange={e => setAnimalSearch(e.target.value)}
                          placeholder="Buscar animal..."
                          name="busca-animal-designacao" autoComplete="off"
                          className="flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 placeholder:italic" />
                        {animalSearch && (
                          <button type="button"
                            onMouseDown={e => { e.preventDefault(); setAnimalSearch(''); }}
                            className="text-gray-400 hover:text-gray-600">
                            <X size={12} />
                          </button>
                        )}
                        <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setShowAnimalDrop(true)}
                        className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-teal-400 transition-colors">
                        <div className="flex items-center gap-2 text-gray-400 italic">
                          <PawPrint size={14} className="text-gray-300 flex-shrink-0" />
                          <span className="text-left truncate">
                            {animaisSel.length === 0
                              ? 'Clique e digite para buscar o animal...'
                              : `${animaisSel.length} de ${disponiveisNoLocal.length} animal(is) marcado(s)`}
                          </span>
                        </div>
                        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                      </button>
                    )}

                    {showAnimalDrop && (
                      <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                        {/* Marcar todos do escopo atual (todos os locais ou só o filtrado) —
                            é o que substitui um segundo botão "inserir todos". */}
                        {visiveisNoDropdown.length > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/70 sticky top-0">
                            {/* Marcar todos encerra a escolha: fecha o dropdown para os
                                chips e o botão Inserir ficarem visíveis na hora. */}
                            <button type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setAnimaisSel(disponiveisNoLocal.map(a => a.id));
                                setShowAnimalDrop(false);
                              }}
                              className="text-[11px] font-semibold text-teal-700 hover:text-teal-900">
                              Marcar todos ({disponiveisNoLocal.length})
                            </button>
                            {animaisSel.length > 0 && (
                              <button type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => setAnimaisSel([])}
                                className="text-[11px] font-medium text-gray-400 hover:text-gray-600">
                                Limpar
                              </button>
                            )}
                          </div>
                        )}
                        {visiveisNoDropdown.length === 0 ? (
                          <p className="text-xs text-gray-400 italic px-4 py-3">
                            {animalSearch.trim()
                              ? `Nenhum resultado para “${animalSearch.trim()}”`
                              : 'Nenhum animal disponível nesta seleção'}
                          </p>
                        ) : visiveisNoDropdown.map(a => {
                          const checked = animaisSel.includes(a.id);
                          return (
                            <label key={a.id}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => toggleAnimal(a.id)}
                              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-teal-50/60' : ''}`}>
                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                checked ? 'bg-teal-600 border-teal-600' : 'border-gray-300'
                              }`}>
                                {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className={`text-sm ${checked ? 'text-teal-800 font-medium' : 'text-gray-700'}`}>{a.nome}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Animais marcados como chips numerados */}
                  {animaisSel.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          Animais selecionados ({animaisSel.length})
                        </p>
                        <button type="button" onClick={() => setAnimaisSel([])}
                          className="text-[11px] text-teal-600 hover:text-teal-800 font-medium">
                          Limpar tudo
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {animaisSel.map(id => (
                          <span key={id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-xs font-medium">
                            {nomePorId.get(id) ?? `#${id}`}
                            <button type="button" onClick={() => toggleAnimal(id)}
                              className="text-teal-400 hover:text-teal-700 transition-colors flex-shrink-0">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <input value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Motivo (opcional)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />

                  {/* Um único botão, no padrão do "Incluir Membro" da tela */}
                  <div className="flex justify-end pt-1">
                    <button onClick={handleInserirMarcados} disabled={salvando || animaisSel.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                      {salvando && <Loader2 size={14} className="animate-spin" />}
                      Inserir{animaisSel.length > 1 ? ` (${animaisSel.length})` : ''}
                    </button>
                  </div>
                </div>
              </div>

              {/* Animais com acesso ativo */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Com acesso ativo ({ativas.length})
                  </p>
                  {ativas.length > 0 && (
                    <button onClick={() => setConfirmRemoverTodos(true)} disabled={removendoTodos}
                      title="Revogar o acesso do prestador a todos os animais"
                      className="flex items-center gap-1.5 px-2.5 py-1 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-lg text-[11px] font-semibold transition-colors">
                      {removendoTodos ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Remover todos
                    </button>
                  )}
                </div>
                {ativas.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Nenhum animal designado.</p>
                ) : (
                  <div className="space-y-2">
                    {ativas.map(d => (
                      <div key={d.id} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl">
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                          <FotoAnimal url={d.animal.photoUrl} nome={d.animal.nome} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{d.animal.nome}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {d.animal.especie?.nome ?? '—'}
                            <span className="text-gray-300"> · </span>
                            {rotuloLocal(d.animal)}
                            {d.motivo && ` · ${d.motivo}`}
                          </p>
                        </div>
                        <button onClick={() => handleRemover(d.animal.id, d.animal.nome)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar Janela
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmRemoverTodos}
        titulo="Remover todos os acessos"
        mensagem={
          <>
            Remover o acesso de <strong>{prestadorNome}</strong> a{' '}
            <strong>todos os {ativas.length} animal{ativas.length === 1 ? '' : 'is'}</strong> designado{ativas.length === 1 ? '' : 's'}?
            {' '}Ele deixa de ver esses pacientes até ser designado novamente.
          </>
        }
        variante="perigo"
        labelConfirmar="Remover todos"
        onConfirmar={handleRemoverTodos}
        onCancelar={() => setConfirmRemoverTodos(false)}
      />

      <ConfirmModal
        open={confirmRemover != null}
        titulo="Remover acesso ao animal"
        mensagem={
          confirmRemover
            ? <>Tem certeza que deseja remover o acesso de <strong>{prestadorNome}</strong> ao animal <strong>"{confirmRemover.nomeAnimal}"</strong>?</>
            : ''
        }
        variante="aviso"
        labelConfirmar="Remover acesso"
        onConfirmar={handleRemoverConfirmado}
        onCancelar={() => setConfirmRemover(null)}
      />
    </div>
  );
}
