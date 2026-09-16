// frontend/src/components/NovaLocalizacaoModal.tsx
//
// 🔴 CRIAR O LOCAL SEM SAIR DA TELA (2026-09-15).
//
// POR QUE EXISTE: no cadastro do Paciente e na troca de proprietário, o local é
// OBRIGATÓRIO. Não existindo ainda, a pessoa tinha de abandonar o formulário
// preenchido, ir a Cadastro › Localizações, criar o local e recomeçar — ou desistir.
// É o mesmo "cadastrar «X» na hora" que a Prescrição e a Vacina já oferecem.
//
// ⚠️ MULTI-TENANT: quem cria é `POST /cadastro/localizacoes`, e é o BACKEND que decide
// o escopo — não-ADMIN cria com `tipoEntrada: 'CLIENTE'` carimbado com a empresa/equipe
// do CONTEXTO (`req.empresaId`/`req.equipeId`), nunca com o que o cliente mandar. O
// local nasce visível só para esta clínica.
// ⚠️ Pede o MÍNIMO — nome e tipo — porque é o mínimo que o backend exige. Endereço,
// CNPJ e responsável se completam depois em Cadastro › Localizações; exigi-los aqui
// transformaria um atalho num segundo formulário.
import { useEffect, useState } from 'react';
import { X, MapPin, Loader2 } from 'lucide-react';
import api from '../services/api';
import ErroAcao, { type ErroAcaoDados } from './ErroAcao';

export interface LocalCriado { id: number; nome: string; tipoLocalizacao: string }

interface TipoOpcao { value: string; label: string; especies?: string[] }

interface Props {
  aberto: boolean;
  /** Nome digitado na busca — o formulário abre com ele. */
  nomeInicial?: string;
  /**
   * Espécie do animal, quando a tela a conhece. Recorta os tipos oferecidos pelo
   * MESMO mapa que a listagem usa — sem isso o local nasceria num tipo que a própria
   * busca da tela filtra fora, e ele sumiria logo depois de criado.
   */
  especieNome?: string | null;
  onCriado: (local: LocalCriado) => void;
  onFechar: () => void;
}

export default function NovaLocalizacaoModal({
  aberto, nomeInicial = '', especieNome = null, onCriado, onFechar,
}: Props) {
  const [nome, setNome]   = useState('');
  const [tipo, setTipo]   = useState('');
  const [tipos, setTipos] = useState<TipoOpcao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<ErroAcaoDados | null>(null);

  // Reabrir com o preenchimento anterior é o caminho mais curto para criar o local
  // errado — o formulário nasce zerado, só com o nome que a pessoa digitou na busca.
  useEffect(() => {
    if (!aberto) return;
    setNome(nomeInicial);
    setTipo('');
    setErro(null);
  }, [aberto, nomeInicial]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    api.get('/cadastro/localizacoes/tipos')
      .then(res => {
        if (!vivo || !res.data) return;
        const lista: TipoOpcao[] = res.data.dados ?? [];
        // Recorte por espécie: 'TODOS' serve a qualquer uma, e o tipo criado pela
        // própria clínica vem sempre como 'TODOS' (o sistema não sabe que espécies
        // ele atende).
        const filtrados = especieNome
          ? lista.filter(t => !t.especies || t.especies.includes('TODOS') || t.especies.includes(especieNome))
          : lista;
        setTipos(filtrados.length > 0 ? filtrados : lista);
      })
      .catch(() => { /* silencioso: o seletor fica vazio e o salvar avisa */ });
    return () => { vivo = false; };
  }, [aberto, especieNome]);

  if (!aberto) return null;

  const salvar = async () => {
    const n = nome.trim();
    if (!n)   { setErro({ mensagem: 'Informe o nome do local.', campos: ['nome'] }); return; }
    if (!tipo) { setErro({ mensagem: 'Selecione o tipo do local.', campos: ['tipo'] }); return; }
    setSalvando(true);
    setErro(null);
    try {
      const res = await api.post('/cadastro/localizacoes', { nome: n, tipoLocalizacao: tipo });
      const criado = res.data?.dados;
      if (!criado?.id) throw new Error('sem dados');
      onCriado({ id: criado.id, nome: criado.nome, tipoLocalizacao: criado.tipoLocalizacao });
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { mensagem?: string; error?: string } } };
      setErro({
        mensagem: e.isPermissionError
          ? 'Sem permissão para cadastrar localizações.'
          : (e.response?.data?.mensagem ?? e.response?.data?.error ?? 'Erro ao cadastrar o local.'),
      });
    } finally { setSalvando(false); }
  };

  const inputCls = (campo: string) =>
    `w-full border ${erro?.campos?.includes(campo) ? 'border-red-400' : 'border-gray-300'} rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500`;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="bg-emerald-700 px-5 py-3.5 flex items-center justify-between flex-shrink-0">
          <p className="font-bold text-sm text-white flex items-center gap-1.5">
            <MapPin size={15} /> Cadastrar local
          </p>
          <button onClick={onFechar} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Nome do local <span className="text-red-500">*</span>
            </label>
            <input value={nome} onChange={e => setNome(e.target.value)} maxLength={120}
              placeholder="Ex.: Haras Boa Vista" className={inputCls('nome')} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Tipo <span className="text-red-500">*</span>
            </label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} className={`${inputCls('tipo')} bg-white`}>
              <option value="">Selecione…</option>
              {tipos.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-gray-400">
            O local nasce disponível <strong>somente para esta clínica</strong>. Endereço,
            responsável e contato podem ser completados depois em Cadastro › Localizações.
          </p>
        </div>

        <div className="px-5 py-3.5 border-t border-gray-100">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onFechar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1.5">
              {salvando && <Loader2 size={13} className="animate-spin" />}
              Cadastrar
            </button>
          </div>
          {/* Erro da AÇÃO fica ABAIXO do botão que a disparou, dentro do modal (§6). */}
          <ErroAcao erro={erro} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
