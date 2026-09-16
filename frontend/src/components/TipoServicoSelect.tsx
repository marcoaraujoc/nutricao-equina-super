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
//
// DUAS FORMAS, UM CATÁLOGO (2026-09-15):
//   TipoServicoSelect      → escolhe UM   (Fornecedor, Localização)
//   TipoServicoMultiSelect → escolhe VÁRIOS (Prestador), no molde do campo
//                            "Especialidades" do Cadastro Pessoal
//                            (`EspecialidadeSelector variant="dropdown"`):
//                            um <select> que só ACRESCENTA + chips com X.
// ⚠️ A carga do catálogo e a criação de tipo novo moram em `useCatalogoTipoServico`
// e são compartilhadas pelas duas — duas cópias divergiriam na primeira correção,
// e o que divergiria é O QUE ENTRA no catálogo da clínica (CLAUDE.md, armadilha 28-g).

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import api from '../services/api';

const OPCAO_NOVO = '__novo__';

// LABORATORIO (2026-09-15) é o laboratório da vacina, cadastrável no Estoque de Vacinas.
// Mesma tabela, mesmo endpoint — ver CatalogoTipoServicoController.
export type CategoriaCatalogo = 'FORNECEDOR' | 'PRESTADOR' | 'LOCALIZACAO' | 'LABORATORIO';
type Categoria = CategoriaCatalogo;

/**
 * Grava um nome novo no catálogo da empresa e devolve o que foi criado/reaproveitado
 * (o POST é idempotente). FONTE ÚNICA da escrita: o Estoque de Vacinas também cadastra
 * laboratório por aqui, e duas chamadas divergiriam justamente no QUE ENTRA no
 * catálogo da clínica (CLAUDE.md, armadilha 28-g).
 */
export async function criarTipoCatalogo(categoria: CategoriaCatalogo, nome: string): Promise<string> {
  const res = await api.post('/cadastro/tipos-servico', { categoria, nome });
  return res.data?.dados?.nome ?? nome;
}

interface Props {
  categoria: Categoria;
  value: string;
  onChange: (nome: string) => void;
  /** Opções que sempre aparecem, mesmo sem nada no catálogo ainda. */
  defaults: readonly string[];
  className: string;
  placeholder?: string;
}

/** Catálogo (defaults + tenant) e a criação de tipo novo — fonte única das duas formas. */
function useCatalogoTipoServico(categoria: Categoria, defaults: readonly string[]) {
  const [opcoes, setOpcoes] = useState<string[]>([...defaults]);

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

  /** Grava no catálogo da empresa e devolve o nome efetivamente criado/reaproveitado. */
  const criar = async (nome: string): Promise<string> => {
    const criado = await criarTipoCatalogo(categoria, nome);
    setOpcoes(prev => [...new Set([...prev, criado])].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    return criado;
  };

  return { opcoes, criar };
}

/**
 * Campo de texto + confirmar/cancelar do "+ Adicionar novo...".
 * Exportado porque o Estoque de Vacinas usa o MESMO campo para cadastrar laboratório —
 * uma segunda versão divergiria no visual e no tratamento de erro.
 * `rotulo` só troca as PALAVRAS (placeholder e mensagem); o comportamento é o mesmo.
 */
export function NovoTipoInput({
  className, onConfirmar, onCancelar, rotulo = 'tipo',
}: { className: string; onConfirmar: (nome: string) => Promise<void>; onCancelar: () => void; rotulo?: string }) {
  const [nome,     setNome]     = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  const confirmar = async () => {
    const limpo = nome.trim();
    if (!limpo) { setErro(`Informe o nome do ${rotulo}`); return; }
    setSalvando(true);
    setErro('');
    try {
      await onConfirmar(limpo);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErro(msg ?? `Erro ao adicionar o ${rotulo}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input autoFocus value={nome} onChange={e => setNome(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') onCancelar(); }}
          placeholder={`Nome do novo ${rotulo}`} className={className} />
        <button type="button" onClick={confirmar} disabled={salvando}
          title="Adicionar" aria-label="Adicionar"
          className="flex-shrink-0 p-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl transition-colors">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button type="button" onClick={onCancelar} disabled={salvando}
          title="Cancelar" aria-label="Cancelar"
          className="flex-shrink-0 p-2.5 border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-xl transition-colors">
          <X size={14} />
        </button>
      </div>
      {erro && <p className="text-xs text-red-500 mt-1">{erro}</p>}
    </div>
  );
}

export default function TipoServicoSelect({ categoria, value, onChange, defaults, className, placeholder }: Props) {
  const { opcoes, criar } = useCatalogoTipoServico(categoria, defaults);
  const [adicionando, setAdicionando] = useState(false);

  // Valor já salvo mas que não está (ainda) na lista de opções — ex.: registro
  // antigo com um tipo digitado que não veio no catálogo desta sessão. Sem isto,
  // o <select> "perderia" o valor selecionado (cairia na 1ª opção da lista).
  const opcoesComValorAtual = value && !opcoes.includes(value) ? [value, ...opcoes] : opcoes;

  if (adicionando) {
    return (
      <NovoTipoInput
        className={className}
        onCancelar={() => setAdicionando(false)}
        onConfirmar={async nome => {
          const criado = await criar(nome);
          onChange(criado);
          setAdicionando(false);
        }}
      />
    );
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === OPCAO_NOVO) { setAdicionando(true); return; }
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

interface MultiProps {
  categoria: Categoria;
  /** Tipos escolhidos, na ordem em que foram acrescentados. */
  value: string[];
  onChange: (nomes: string[]) => void;
  defaults: readonly string[];
  className: string;
  placeholder?: string;
  /** Texto auxiliar abaixo do campo. */
  ajuda?: ReactNode;
}

/**
 * Mesma forma do campo "Especialidades" do Cadastro Pessoal: um <select> que só
 * ACRESCENTA e uma faixa de chips com X para remover.
 * ⚠️ O <select> nunca fica "selecionado" (`value=""`) — ele volta ao placeholder a
 * cada escolha. Deixá-lo com o último escolhido faria o campo parecer ter UM valor,
 * que é justamente o que este componente existe para desfazer.
 */
export function TipoServicoMultiSelect({
  categoria, value, onChange, defaults, className, placeholder, ajuda,
}: MultiProps) {
  const { opcoes, criar } = useCatalogoTipoServico(categoria, defaults);
  const [adicionando, setAdicionando] = useState(false);

  // Tipo já gravado que não veio no catálogo desta sessão continua aparecendo como
  // chip (o chip sai de `value`, não das opções) — o que ele não pode é reaparecer
  // na lista de "adicionar", oferecendo o que já está escolhido.
  const disponiveis = opcoes.filter(t => !value.includes(t));

  const acrescentar = (nome: string) => {
    if (!nome || value.includes(nome)) return;
    onChange([...value, nome]);
  };

  return (
    <div className="space-y-2">
      {adicionando ? (
        <NovoTipoInput
          className={className}
          onCancelar={() => setAdicionando(false)}
          onConfirmar={async nome => {
            const criado = await criar(nome);
            acrescentar(criado);
            setAdicionando(false);
          }}
        />
      ) : (
        <select
          value=""
          onChange={e => {
            if (e.target.value === OPCAO_NOVO) { setAdicionando(true); return; }
            acrescentar(e.target.value);
          }}
          className={className}
        >
          <option value="">{placeholder ?? 'Adicionar tipo de serviço…'}</option>
          {disponiveis.map(t => <option key={t} value={t}>{t}</option>)}
          <option value={OPCAO_NOVO}>+ Adicionar novo tipo...</option>
        </select>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(nome => (
            <span key={nome}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
              {nome}
              <button type="button" onClick={() => onChange(value.filter(v => v !== nome))}
                title={`Remover ${nome}`} aria-label={`Remover ${nome}`}
                className="ml-0.5 hover:text-emerald-900 transition-colors">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {ajuda && <p className="text-xs text-gray-400">{ajuda}</p>}
    </div>
  );
}

/**
 * CSV gravado em `tipo_servico` → lista, sem vazio e sem repetição.
 * ⚠️ A separação por vírgula NÃO é convenção nova: `EncaminhamentoController`
 * já lê `tipoServico.split(',')` para montar o filtro de serviços, e
 * `PrestadorController.normalizarTipos` já compara a lista na checagem de
 * duplicidade. Este par de helpers só põe as duas pontas no mesmo formato.
 */
export function tiposServicoDaString(csv: string | null | undefined): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const parte of (csv ?? '').split(',')) {
    const nome = parte.trim();
    if (!nome) continue;
    const chave = nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push(nome);
  }
  return lista;
}

/** Lista → CSV, no formato que os leitores já esperam (`split(',')` + trim). */
export function tiposServicoParaString(lista: string[]): string {
  return tiposServicoDaString(lista.join(',')).join(', ');
}
