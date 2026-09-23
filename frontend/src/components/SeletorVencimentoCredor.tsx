// frontend/src/components/SeletorVencimentoCredor.tsx
//
// DATA DE VENCIMENTO DO CREDOR — fornecedor e prestador (2026-09-22, a pedido).
//
// 🔴 É A MESMA FORMA DO "FECHAMENTO DA FATURA" do cadastro da empresa
// (`CadastroEmpresa.tsx` + `useConfiguracaoOperacional`): um SELECT com as quatro
// opções e, ao lado, o campo do DIA — que muda de natureza conforme a opção e fica
// desabilitado dizendo o que vale quando não há dia a escolher. Foi assim que o pedido
// veio, e é o que faz as duas telas se parecerem para quem já conhece uma.
//
// 🔴 UM componente para os DOIS cadastros. Duas cópias divergiriam na primeira
// correção (28-g) — e o que divergiria é a data em que a clínica acha que precisa pagar.
//
// ⚠️ "Primeiro dia do mês" é ATALHO DE UX para DIA_FIXO com dia 1 — o backend não
// distingue os dois, exatamente como no fechamento da fatura.
//
// ⚠️ O campo do dia fica em lugar FIXO da grade em vez de nascer embaixo do seletor:
// assim a linha não se reorganiza quando a pessoa troca a forma, e o campo aparece
// onde ela está olhando.
import { useMemo } from 'react';

/** O que o BACKEND grava (`tb_fornecedores`/`tb_prestadores.tipo_vencimento`). */
export type TipoVencimento = 'DIA_FIXO' | 'DIA_UTIL' | 'ULTIMO_DIA_MES';

/** O que a TELA oferece — inclui o atalho do primeiro dia. */
type TipoSelecao = 'SEM_VENCIMENTO' | 'ULTIMO_DIA_MES' | 'PRIMEIRO_DIA_MES' | 'DIA_ESPECIFICO' | 'DIA_UTIL';

export interface ValorVencimento {
  tipoVencimento: TipoVencimento | null;
  diaVencimento:  number | null;
}

const ORDINAIS = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º'];

/** Estado gravado → opção da tela. */
function selecaoDe(v: ValorVencimento): TipoSelecao {
  if (!v.tipoVencimento)                     return 'SEM_VENCIMENTO';
  if (v.tipoVencimento === 'DIA_UTIL')       return 'DIA_UTIL';
  if (v.tipoVencimento === 'ULTIMO_DIA_MES') return 'ULTIMO_DIA_MES';
  return v.diaVencimento === 1 ? 'PRIMEIRO_DIA_MES' : 'DIA_ESPECIFICO';
}

/** Rótulo de uma linha de listagem — "Dia 10", "3º dia útil", "Último dia do mês". */
export function rotuloVencimento(v: ValorVencimento): string {
  if (!v.tipoVencimento) return '—';
  if (v.tipoVencimento === 'ULTIMO_DIA_MES') return 'Último dia do mês';
  if (v.tipoVencimento === 'DIA_UTIL') return `${ORDINAIS[(v.diaVencimento ?? 1) - 1] ?? `${v.diaVencimento}º`} dia útil`;
  return v.diaVencimento === 1 ? 'Primeiro dia do mês' : `Dia ${v.diaVencimento}`;
}

interface Props {
  valor:      ValorVencimento;
  onChange:   (v: ValorVencimento) => void;
  /** As classes de input da tela hospedeira — o campo tem de parecer com os vizinhos. */
  inputCls:   string;
  disabled?:  boolean;
  /** Mensagem de erro do dia, exibida sob o campo (o padrão de erro da §6). */
  erro?:      string | null;
}

export default function SeletorVencimentoCredor({ valor, onChange, inputCls, disabled, erro }: Props) {
  const selecao = useMemo(() => selecaoDe(valor), [valor]);

  const trocarForma = (s: TipoSelecao) => {
    if (s === 'SEM_VENCIMENTO')   return onChange({ tipoVencimento: null, diaVencimento: null });
    if (s === 'ULTIMO_DIA_MES')   return onChange({ tipoVencimento: 'ULTIMO_DIA_MES', diaVencimento: null });
    if (s === 'PRIMEIRO_DIA_MES') return onChange({ tipoVencimento: 'DIA_FIXO', diaVencimento: 1 });
    if (s === 'DIA_UTIL') {
      // Troca de forma preserva o número SÓ quando ele ainda é válido na nova: o dia 20
      // do mês não existe como 20º dia útil, e carregá-lo faria o salvar recusar um
      // valor que a pessoa nunca escolheu.
      const d = valor.diaVencimento;
      return onChange({ tipoVencimento: 'DIA_UTIL', diaVencimento: d && d >= 1 && d <= 10 ? d : 5 });
    }
    const d = valor.diaVencimento;
    return onChange({ tipoVencimento: 'DIA_FIXO', diaVencimento: d && d >= 1 && d <= 28 ? d : 5 });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Data de Vencimento</label>
        <select
          value={selecao}
          disabled={disabled}
          onChange={e => trocarForma(e.target.value as TipoSelecao)}
          className={`${inputCls} bg-white`}
        >
          {/* ⚠️ "Não informar" é a PRIMEIRA opção e o padrão: nenhum credor já cadastrado
              combinou data nenhuma, e nascer com uma faria a conta dele vencer — e
              atrasar — numa data que ninguém acordou. */}
          <option value="SEM_VENCIMENTO">Não informar</option>
          <option value="ULTIMO_DIA_MES">Último dia do mês</option>
          <option value="PRIMEIRO_DIA_MES">Primeiro dia do mês</option>
          <option value="DIA_ESPECIFICO">Dia específico do mês</option>
          <option value="DIA_UTIL">Dia útil do mês</option>
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          {selecao === 'SEM_VENCIMENTO'
            ? 'Sem vencimento, a conta deste credor nunca é marcada como atrasada.'
            : selecao === 'DIA_UTIL'
            ? 'Dia útil considera fins de semana e feriados nacionais.'
            : selecao === 'DIA_ESPECIFICO'
            ? 'O dia específico vai de 1 a 28 para existir em todos os meses do ano.'
            : 'A conta do mês vence nesta data do mês seguinte.'}
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Dia do Vencimento</label>
        {selecao === 'DIA_ESPECIFICO' ? (
          <>
            <input
              type="number" min={1} max={28} disabled={disabled}
              value={valor.diaVencimento ?? ''}
              onChange={e => onChange({
                tipoVencimento: 'DIA_FIXO',
                diaVencimento:  e.target.value === '' ? null : Number(e.target.value),
              })}
              placeholder="Ex: 10 (1 a 28)"
              className={`${inputCls} ${erro ? 'border-red-400 ring-1 ring-red-300' : ''}`}
            />
            {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
          </>
        ) : selecao === 'DIA_UTIL' ? (
          <select
            value={valor.diaVencimento ?? 5} disabled={disabled}
            onChange={e => onChange({ tipoVencimento: 'DIA_UTIL', diaVencimento: Number(e.target.value) })}
            className={`${inputCls} bg-white`}
          >
            {ORDINAIS.map((label, i) => (
              <option key={label} value={i + 1}>{label} dia útil</option>
            ))}
          </select>
        ) : (
          /* Forma sem data a escolher: o campo fica desabilitado dizendo o que vale, em
             vez de sumir e reorganizar a linha inteira. */
          <input
            disabled
            value={selecao === 'PRIMEIRO_DIA_MES' ? 'Primeiro dia do mês'
                 : selecao === 'ULTIMO_DIA_MES'   ? 'Último dia do mês'
                 : 'Não informado'}
            className={`${inputCls} bg-gray-50 text-gray-500`}
          />
        )}
      </div>
    </div>
  );
}
