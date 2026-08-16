// src/components/TipoServicoSelect.tsx
//
// Combobox "criável" do tipo de fornecedor / tipo de serviço do prestador —
// opções fixas (`defaults`) + o catálogo tenant-scoped (GET/POST
// /api/cadastro/tipos-servico?categoria=FORNECEDOR|PRESTADOR, ver
// CatalogoTipoServicoController no backend). Multi-tenant/RLS: o catálogo é
// TENANT DIRETO (mesma policy de tb_fornecedores/tb_prestadores) — cada
// empresa só vê/cria os PRÓPRIOS tipos personalizados, nunca os de outra.
//
// Selecionar "+ Adicionar novo tipo..." troca o <select> por um campo de texto;
// confirmar grava no catálogo (idempotente — tipo repetido reaproveita o
// existente) e volta ao modo select com o novo tipo já escolhido.

import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import api from '../services/api';

const OPCAO_NOVO = '__novo__';

interface Props {
  categoria: 'FORNECEDOR' | 'PRESTADOR';
  value: string;
  onChange: (nome: string) => void;
  /** Opções que sempre aparecem, mesmo sem nada no catálogo ainda. */
  defaults: readonly string[];
  className: string;
  placeholder?: string;
}

export default function TipoServicoSelect({ categoria, value, onChange, defaults, className, placeholder }: Props) {
  const [opcoes,     setOpcoes]     = useState<string[]>([...defaults]);
  const [adicionando, setAdicionando] = useState(false);
  const [novoNome,   setNovoNome]   = useState('');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  useEffect(() => {
    let cancelado = false;
    api.get(`/cadastro/tipos-servico?categoria=${categoria}`)
      .then(res => {
        if (cancelado || !res.data) return;
        const doCatalogo = ((res.data.dados ?? []) as Array<{ nome: string }>).map(t => t.nome);
        const unificado = [...new Set([...defaults, ...doCatalogo])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        setOpcoes(unificado);
      })
      .catch(() => { /* mantém só os defaults */ });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria]);

  // Valor já salvo mas que não está (ainda) na lista de opções — ex.: registro
  // antigo com um tipo digitado que não veio no catálogo desta sessão. Sem isto,
  // o <select> "perderia" o valor selecionado (cairia na 1ª opção da lista).
  const opcoesComValorAtual = value && !opcoes.includes(value) ? [value, ...opcoes] : opcoes;

  const confirmarNovo = async () => {
    const nome = novoNome.trim();
    if (!nome) { setErro('Informe o nome do tipo'); return; }
    setSalvando(true);
    setErro('');
    try {
      const res = await api.post('/cadastro/tipos-servico', { categoria, nome });
      const criado = res.data?.dados?.nome ?? nome;
      setOpcoes(prev => [...new Set([...prev, criado])].sort((a, b) => a.localeCompare(b, 'pt-BR')));
      onChange(criado);
      setAdicionando(false);
      setNovoNome('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErro(msg ?? 'Erro ao adicionar o tipo');
    } finally {
      setSalvando(false);
    }
  };

  if (adicionando) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <input autoFocus value={novoNome} onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmarNovo(); if (e.key === 'Escape') { setAdicionando(false); setErro(''); } }}
            placeholder="Nome do novo tipo" className={className} />
          <button type="button" onClick={confirmarNovo} disabled={salvando}
            title="Adicionar" aria-label="Adicionar"
            className="flex-shrink-0 p-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl transition-colors">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button type="button" onClick={() => { setAdicionando(false); setErro(''); }} disabled={salvando}
            title="Cancelar" aria-label="Cancelar"
            className="flex-shrink-0 p-2.5 border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-xl transition-colors">
            <X size={14} />
          </button>
        </div>
        {erro && <p className="text-xs text-red-500 mt-1">{erro}</p>}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === OPCAO_NOVO) { setAdicionando(true); setNovoNome(''); setErro(''); return; }
        onChange(e.target.value);
      }}
      className={className}
    >
      {!value && <option value="">{placeholder ?? '— selecione —'}</option>}
      {opcoesComValorAtual.map(t => <option key={t} value={t}>{t}</option>)}
      <option value={OPCAO_NOVO}>+ Adicionar novo tipo...</option>
    </select>
  );
}
