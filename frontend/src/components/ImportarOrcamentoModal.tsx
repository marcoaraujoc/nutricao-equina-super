// frontend/src/components/ImportarOrcamentoModal.tsx
// Modal reutilizável para importar itens ACEITO de orçamentos aprovados/parciais.
// Usado na Prescrição (med+proc) e na Vacina. Traz SOMENTE itens aprovados e ainda
// não importados.
//
// IMPORTANTE — o "Inserir" apenas ADICIONA os itens à lista de edição do chamador; a
// marcação como importado (POST /orcamentos/importar) acontece só DEPOIS que a
// prescrição/vacina é efetivamente SALVA (ver marcarOrcamentoImportado). Assim, se o
// usuário fechar sem salvar, os itens continuam disponíveis para importar de novo.
//
// Regra de negócio: só é possível selecionar itens de UM MESMO orçamento por vez —
// escolher um item do #4 trava a seleção nesse orçamento.
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import InlineError from './InlineError';
import { Loader2, X, Check, Receipt } from 'lucide-react';
import { getOrcamentoLock, setOrcamentoLock, clearOrcamentoLock } from '../utils/orcamentoImportLock';

// Marca itens de orçamento como importados. Chamar APÓS o salvamento real da
// prescrição/vacina, passando os ids de item de orçamento que foram persistidos.
export async function marcarOrcamentoImportado(orcamentoItemIds: number[]): Promise<void> {
  const ids = orcamentoItemIds.filter((n): n is number => Number.isInteger(n));
  if (ids.length === 0) return;
  try {
    await api.post('/orcamentos/importar', { itemIds: ids });
  } catch { /* silencioso — não impede o fluxo de salvar */ }
}

export interface OrcamentoItemImport {
  id: number;
  tipo: 'PROCEDIMENTO' | 'COMBO' | 'MEDICAMENTO' | 'VACINA';
  refId: number | null;
  descricao: string;
  especialidade: string | null;
  quantidade: number;
  unidade: string | null;
  /** MEDICAMENTO — posologia orçada; preenche duração/frequência na prescrição */
  dias: number | null;
  frequencia: string | null;
  valorUnitario: number;
  valorTotal: number;
  animalId: number | null;
}
interface OrcamentoImport {
  id: number; numeroFormatado: string;
  proprietario: { id: number; fullName: string };
  itens: OrcamentoItemImport[];
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ImportarOrcamentoModal({ animalId, tipos, onFechar, onImportar }: {
  animalId: number;
  /** Tipos aceitos: prescrição = ['MEDICAMENTO','PROCEDIMENTO','COMBO']; vacina = ['VACINA'] */
  tipos: OrcamentoItemImport['tipo'][];
  onFechar: () => void;
  onImportar: (itens: OrcamentoItemImport[]) => void;
}) {
  const [orcamentos, setOrcamentos] = useState<OrcamentoImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erroInline, setErroInline] = useState<string | null>(null);

  // Quando um orçamento já está em andamento (import iniciado nesta sessão), a lista
  // fica travada nele. `verOutros` libera o lock para escolher outro (escape p/ engano).
  const [travadoEm, setTravadoEm] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/orcamentos/para-importar', { params: { animalId, tipos: tipos.join(',') } });
      let lista: OrcamentoImport[] = r.data?.dados ?? [];

      const lock = getOrcamentoLock(animalId);
      if (lock != null) {
        const soLock = lista.filter(o => o.id === lock);
        if (soLock.length > 0) { lista = soLock; setTravadoEm(lock); }
        else { clearOrcamentoLock(animalId); setTravadoEm(null); } // concluído/sumiu → libera
      } else {
        setTravadoEm(null);
      }
      setOrcamentos(lista);
    } catch { setOrcamentos([]); }
    finally { setLoading(false); }
  }, [animalId, tipos]);

  const verOutros = () => { clearOrcamentoLock(animalId); setSel(new Set()); carregar(); };

  useEffect(() => { carregar(); }, [carregar]);

  const toggle = (id: number) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const todosItens = orcamentos.flatMap(o => o.itens);
  const selecionados = todosItens.filter(i => sel.has(i.id));

  // Orçamento "travado" pela seleção atual: só ele pode ter itens marcados por vez.
  const orcTravadoId = orcamentos.find(o => o.itens.some(i => sel.has(i.id)))?.id ?? null;

  // Inserir NÃO marca como importado — só entrega os itens ao chamador (a marcação
  // definitiva é feita ao salvar). Mas TRAVA o orçamento em andamento p/ o animal:
  // a partir daqui, todas as categorias mostram só este orçamento até ser concluído.
  const inserir = () => {
    setErroInline(null);
    if (selecionados.length === 0) { setErroInline('Selecione ao menos um item'); return; }
    if (orcTravadoId != null) setOrcamentoLock(animalId, orcTravadoId);
    setSalvando(true);
    onImportar(selecionados);
    onFechar();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[90vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-emerald-600" />
            <div>
              <h3 className="font-bold text-gray-900">Importar do orçamento</h3>
              {travadoEm != null && (
                <button onClick={verOutros} className="text-[11px] text-emerald-600 hover:underline">
                  Importação em andamento neste orçamento — ver outros
                </button>
              )}
            </div>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : orcamentos.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm px-6">
              Nenhum item aprovado disponível para importar deste paciente.
            </div>
          ) : (
            orcamentos.map(o => {
              // Só o orçamento travado pela seleção fica ativo (quando há seleção)
              const bloqueado = orcTravadoId !== null && orcTravadoId !== o.id;
              return (
              <div key={o.id} className={`border-b border-gray-100 ${bloqueado ? 'opacity-50' : ''}`}>
                <div className="px-5 py-2 bg-gray-50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Orçamento #{o.numeroFormatado}</span>
                  <span className="text-[11px] text-gray-400">
                    {bloqueado ? 'outro orçamento selecionado' : o.proprietario.fullName}
                  </span>
                </div>
                {o.itens.map(i => {
                  const checked = sel.has(i.id);
                  return (
                    <button key={i.id} onClick={() => toggle(i.id)} disabled={bloqueado}
                      title={bloqueado ? 'Só é possível importar itens de um orçamento por vez' : undefined}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${checked ? 'bg-emerald-50/60' : 'hover:bg-gray-50'} ${bloqueado ? 'cursor-not-allowed hover:bg-transparent' : ''}`}>
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                        {checked && <Check size={13} className="text-white" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{i.descricao}</p>
                        <p className="text-[11px] text-gray-400">
                          {i.tipo === 'COMBO' ? 'Combo' : i.tipo.charAt(0) + i.tipo.slice(1).toLowerCase()}
                          {' · '}{i.quantidade} × {brl(i.valorUnitario)}
                          {i.tipo === 'MEDICAMENTO' && i.dias ? ` · ${i.dias} dia${i.dias > 1 ? 's' : ''}` : ''}
                          {i.tipo === 'VACINA' ? ` · ${i.quantidade} dose${i.quantidade > 1 ? 's' : ''}` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{brl(i.valorTotal)}</span>
                    </button>
                  );
                })}
              </div>
              );
            })
          )}
        </div>

        <InlineError message={erroInline} className="mx-5 mt-3" />

        <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onFechar} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">Cancelar</button>
          <div className="flex-1" />
          <button onClick={inserir} disabled={salvando || selecionados.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Inserir {selecionados.length > 0 ? `(${selecionados.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
