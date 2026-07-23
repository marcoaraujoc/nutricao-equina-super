// src/components/PermissoesModal.tsx
// Modal de controle de acesso por membro — usado pelo Veterinário Gestor

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import InlineError from './InlineError';
import { X, Loader2, ShieldCheck } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL';

interface AcaoPermissao {
  slug:  string;
  acao:  string;
  label: string;
  nivel: Nivel;
}

type MatrizPermissoes = Record<string, Record<string, AcaoPermissao[]>>;

interface Props {
  equipeId:   number;
  membroId:   number;  // userId do membro
  membroNome: string;
  onClose:    () => void;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const NIVEL_LABEL: Record<Nivel, string> = {
  NENHUM:  'Sem acesso',
  LEITURA: 'Leitura',
  PROPRIO: 'Próprio',
  EQUIPE:  'Equipe',
  FULL:    'Total',
};

const NIVEL_COLOR: Record<Nivel, string> = {
  NENHUM:  'bg-gray-100 text-gray-500',
  LEITURA: 'bg-blue-100 text-blue-700',
  PROPRIO: 'bg-amber-100 text-amber-700',
  EQUIPE:  'bg-emerald-100 text-emerald-700',
  FULL:    'bg-purple-100 text-purple-700',
};

const NIVEIS: Nivel[] = ['NENHUM', 'LEITURA', 'PROPRIO', 'EQUIPE', 'FULL'];

const MODULO_LABEL: Record<string, string> = {
  animais:     'Animais',
  atendimento: 'Atendimento Clínico',
  nutricao:    'Nutrição',
  financeiro:  'Financeiro',
  equipe:      'Equipe',
};

const SUBMODULO_LABEL: Record<string, string> = {
  animais:    'Animais',
  evolucoes:  'Prontuário / Evoluções',
  exames:     'Exames',
  dietas:     'Dietas',
  relatorios: 'Relatórios',
  faturas:    'Faturas',
  membros:    'Membros',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PermissoesModal({ equipeId, membroId, membroNome, onClose }: Props) {
  const [matriz,   setMatriz]   = useState<MatrizPermissoes>({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [dirty,    setDirty]    = useState<Record<string, Nivel>>({});
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/permissoes/${membroId}`);
      setMatriz(res.data.dados ?? {});
    } catch {
      setErroInline('Erro ao carregar permissões');
    } finally {
      setLoading(false);
    }
  }, [equipeId, membroId]);

  useEffect(() => { carregar(); }, [carregar]);

  const handleChange = (slug: string, nivel: Nivel) => {
    setDirty(prev => ({ ...prev, [slug]: nivel }));
    setMatriz(prev => {
      const next = { ...prev };
      for (const mod of Object.keys(next)) {
        for (const sub of Object.keys(next[mod])) {
          next[mod][sub] = next[mod][sub].map(a =>
            a.slug === slug ? { ...a, nivel } : a
          );
        }
      }
      return next;
    });
  };

  const handleSalvar = async () => {
    if (Object.keys(dirty).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      await api.put(`/equipes/${equipeId}/permissoes/${membroId}`, { alteracoes: dirty });
      toast.success('Permissões atualizadas');
      setDirty({});
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao salvar';
      setErroInline(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
              <ShieldCheck size={15} className="text-purple-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">Controle de Acesso</p>
              <p className="text-xs text-gray-400">{membroNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Legenda */}
        <div className="px-5 py-2 border-b border-gray-50 flex-shrink-0 flex flex-wrap gap-2">
          {NIVEIS.map(n => (
            <span key={n} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${NIVEL_COLOR[n]}`}>
              {NIVEL_LABEL[n]}
            </span>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-purple-500" />
            </div>
          ) : Object.keys(matriz).length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Nenhuma permissão configurada.</p>
          ) : (
            Object.entries(matriz).map(([modulo, submodulos]) => (
              <div key={modulo}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  {MODULO_LABEL[modulo] ?? modulo}
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                  {Object.entries(submodulos).map(([sub, acoes], si) => (
                    <div key={sub}>
                      {si > 0 && <div className="border-t border-gray-100" />}
                      <div className="px-4 py-2 bg-white/60">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                          {SUBMODULO_LABEL[sub] ?? sub}
                        </p>
                        <div className="space-y-1.5">
                          {acoes.map(acao => (
                            <div key={acao.slug} className="flex items-center justify-between gap-3">
                              <span className="text-xs text-gray-700">{acao.label}</span>
                              <div className="flex gap-1">
                                {NIVEIS.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => handleChange(acao.slug, n)}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all border ${
                                      acao.nivel === n
                                        ? `${NIVEL_COLOR[n]} border-transparent`
                                        : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                                    }`}
                                  >
                                    {NIVEL_LABEL[n]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {Object.keys(dirty).length > 0
              ? `${Object.keys(dirty).length} alteração(ões) pendente(s)`
              : 'Sem alterações'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-xl text-gray-600 text-sm font-medium hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={handleSalvar}
              disabled={saving}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}