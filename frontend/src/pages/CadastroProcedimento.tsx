// frontend/src/pages/CadastroProcedimento.tsx
// Cadastro > Procedimentos — catálogo por especialidade + preços/combos da empresa.
//   - Seletor de especialidades: vet vê SÓ as suas; GESTOR/ADMIN veem todas.
//   - Incluir procedimento no catálogo: exclusivo do ADMIN.
//   - Empresa (GESTOR): define valor por procedimento e monta combos com valor.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ModalJustificativa from '../components/ModalJustificativa';
import DropdownSelect from '../components/DropdownSelect';
import {
  ListChecks, Search, Pencil, X, Loader2, Check, Layers, PackagePlus, ToggleRight, ToggleLeft,
  Trash2, CornerDownRight, Plus, ChevronDown,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Vínculo PRESTADOR × PROCEDIMENTO (2026-09-08). O MESMO procedimento pode ter vários
 * prestadores, cada um com o seu preço para o cliente e o seu próprio custo.
 *
 * ⚠️ `valorCliente` NULO significa "usa o valor padrão da empresa" — não é zero. A
 * tela mostra o padrão com a nota de herança, senão o gestor leria "R$ 0,00" e
 * concluiria que aquele prestador trabalha de graça.
 */
interface VinculoPrestador {
  id:             number;
  prestadorId:    number;
  prestadorNome:  string;
  tipoServico:    string | null;
  prestadorAtivo: boolean;
  valorCliente:   number | null;
  valorPrestador: number | null;
  ativo:          boolean;
  tipoPagamento:  string | null;
  formaPagamento: string | null;
  valorPagamento: number | null;
}

interface PrestadorOpcao {
  id:             number;
  nome:           string;
  tipoServico:    string | null;
  tipoPagamento:  string | null;
  formaPagamento: string | null;
  valorPagamento: number | null;
}

interface Procedimento {
  id:            number;
  nome:          string;
  nomeAbreviado: string | null;
  categoria:     string;
  subcategoria:  string | null;
  especialidade: string | null;
  tipoProcedimento: string | null;
  duracao:       number | null;
  valorVenda:    number | null;
  descricao:     string | null;
  valorEmpresa:  number | null;
  /** Opcional: base ainda sem a migration `20261001000000` não devolve o campo. */
  prestadores?:  VinculoPrestador[];
}

interface ComboItem {
  id: number;
  procedimento: { id: number; nome: string; categoria: string; especialidade: string | null; valorVenda: number | null };
}

interface Combo {
  id:            number;
  nome:          string;
  descricao:     string | null;
  especialidade: string | null;
  /** VALOR CLIENTE do pacote — o nome do campo é histórico (ver o schema). */
  valor:         number;
  itens:         ComboItem[];
  ativo:         boolean;
  /** Prestador do pacote (migration 20261002000000). `null` = executado pela equipe. */
  prestadorId?:    number | null;
  prestadorNome?:  string | null;
  valorPrestador?: number | null;
}

interface FormNovoProc {
  nome: string; categoria: string; especialidade: string; valorVenda: string; descricao: string;
}

const FORM_PROC_INICIAL: FormNovoProc = { nome: '', categoria: '', especialidade: '', valorVenda: '', descricao: '' };

/**
 * Como o prestador é pago, em uma linha — é o que explica de onde sai o valor do
 * recibo. Sem isso o gestor vê dois números na tela e não sabe qual deles a clínica
 * vai efetivamente pagar.
 */
const rotuloPagamentoPrestador = (v: {
  tipoPagamento: string | null; formaPagamento: string | null; valorPagamento: number | null;
}): string => {
  if (v.tipoPagamento === 'POR_PROCEDIMENTO') return 'Paga o valor do procedimento';
  if (v.tipoPagamento === 'SALARIO')          return 'Salário (não apurado por procedimento)';
  if (v.tipoPagamento === 'COMISSAO') {
    if (v.valorPagamento == null)             return 'Comissão sem valor cadastrado';
    return v.formaPagamento === 'PERCENTUAL'
      ? `Comissão de ${String(v.valorPagamento).replace('.', ',')}% do valor do cliente`
      : `Comissão fixa de ${v.valorPagamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  }
  return 'Sem forma de pagamento cadastrada';
};

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Máscara monetária de digitação: "R$ 000.000,00" (mesmo padrão do CadastroProprietario)
const maskBRL = (v: string): string => {
  const nums = v.replace(/\D/g, '');
  if (!nums) return '';
  const n = parseInt(nums, 10) / 100;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const parseBRL = (v: string): number =>
  parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
const numToMask = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : maskBRL(String(Math.round(v * 100)));

/**
 * Especialidades REAIS do combo: as dos procedimentos que o compõem, sem repetir.
 *
 * `Combo.especialidade` é só a CLASSIFICAÇÃO gravada no cadastro — a que estava no
 * seletor na hora de salvar. Num combo montado com três áreas, exibi-lo sozinho
 * mostrava apenas a última usada e escondia as outras duas. O campo continua servindo
 * ao filtro do Orçamento; quem descreve o conteúdo do pacote são os itens.
 * Combo cujos procedimentos não têm especialidade cai na classificação (não fica sem
 * nenhum selo).
 */
const especialidadesDoCombo = (c: Combo): string[] => {
  const dosItens = [...new Set(
    c.itens.map(i => i.procedimento.especialidade).filter((e): e is string => !!e?.trim()),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (dosItens.length > 0) return dosItens;
  return c.especialidade ? [c.especialidade] : [];
};

// ─── Campo de dinheiro SEMPRE editável ───────────────────────────────────────
/**
 * Valor que se digita direto na grade, sem passar por um lápis (pedido de 2026-09-10).
 *
 * 🔴 NÃO SALVA SOZINHO (pedido de 2026-09-11). Ele é um campo CONTROLADO: quem guarda
 * o texto, compara com o gravado e decide quando gravar é a LINHA (`LinhaProcedimento`
 * / `LinhaPrestador`), que mostra Salvar/Cancelar assim que algo difere.
 *
 * ⚠️ REVERTE o auto-save no blur de 10/09. O motivo daquela decisão continua válido —
 * não se dispara um PUT por célula visitada com Tab —, e é justamente por isso que a
 * confirmação virou EXPLÍCITA em vez de voltar a ser automática em outro evento.
 *
 * ⚠️ Na linha do PRESTADOR os dois valores gravam JUNTOS, numa chamada só: eles moram
 * no mesmo vínculo, e salvá-los em duas requisições deixaria a linha meio gravada se a
 * segunda falhasse.
 */
function ValorInline({
  texto, onTexto, onEnter, onEsc, placeholder, titulo, className = '', desabilitado,
}: {
  texto: string;
  onTexto: (v: string) => void;
  /** Enter salva a linha — o atalho de quem digita sem tirar a mão do teclado. */
  onEnter?: () => void;
  /** Esc desfaz: sem a volta, quem começou a digitar por engano não tem como cancelar. */
  onEsc?: () => void;
  placeholder?: string;
  titulo?: string;
  className?: string;
  desabilitado?: boolean;
}) {
  return (
    <input
      type="text" inputMode="numeric" title={titulo}
      value={texto} placeholder={placeholder} disabled={desabilitado}
      onChange={e => onTexto(maskBRL(e.target.value))}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); }
        if (e.key === 'Escape') { e.preventDefault(); onEsc?.(); }
      }}
      className={`w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right bg-white
        focus:outline-none focus:border-emerald-500 hover:border-gray-300
        disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
    />
  );
}

// ─── Salvar / Cancelar da linha ──────────────────────────────────────────────
/**
 * Os dois controles que confirmam ou desfazem a edição de uma linha (2026-09-11).
 *
 * 🔴 SAI PELO `AcaoRegistro`, a fonte única da §6: **ícone pintado no desktop, pílula
 * com rótulo no mobile**. Uma versão própria daria dois botões que divergiriam do
 * resto da aplicação na primeira correção — e no celular, sem rótulo, ✓ e ✕ pequenos
 * ao lado de um campo de dinheiro são alvo difícil e ambíguo.
 *
 * ⚠️ Só são RENDERIZADOS quando há alteração pendente (quem decide é a linha). Botão
 * que na maior parte do tempo não faz nada é ruído — e, desabilitado, cairia no cinza
 * que a §6 reserva ao indisponível.
 *
 * ⚠️ NÃO existe "Alterar": os campos já são sempre editáveis, então ele não teria o
 * que destravar (decidido com o usuário em 2026-09-11).
 */
function AcoesEdicao({ onSalvar, onCancelar, salvando }: {
  onSalvar: () => void;
  onCancelar: () => void;
  salvando: boolean;
}) {
  return (
    <AcoesRegistro>
      <AcaoRegistro
        rotulo="Salvar" icone={Check} tom="finalizar"
        titulo="Salvar alterações desta linha"
        onClick={onSalvar} carregando={salvando}
      />
      <AcaoRegistro
        rotulo="Cancelar" icone={X} tom="cancelar"
        titulo="Cancelar — volta ao valor gravado"
        onClick={onCancelar} desabilitado={salvando}
      />
    </AcoesRegistro>
  );
}

// ─── Combobox de prestador ───────────────────────────────────────────────────
/**
 * Escolhe o prestador DIGITANDO até marcar um que exista, com a opção de cadastrar um
 * novo (pedido de 2026-09-10: "não precisa de um ícone para isso").
 *
 * ⚠️ A escolha é por `onMouseDown` com `preventDefault`: o foco não sai do input, então
 * o blur não fecha a lista antes de o clique registrar — mesma armadilha do combo da
 * Agenda e do seletor de vacinas do documento.
 *
 * ⚠️ "Cadastrar" só aparece SEM correspondência exata, e NÃO cria nada aqui: o cadastro
 * de prestador exige nome e telefone (`PrestadorController.criar`), então criar pelo
 * nome produziria um cadastro incompleto. Quem cria é a tela de Prestadores, e este
 * botão leva até lá já com o nome digitado.
 */
function PrestadorCombo({
  opcoes, onEscolher, onCadastrar, placeholder = 'Buscar prestador…',
}: {
  opcoes: PrestadorOpcao[];
  onEscolher: (id: number) => void;
  onCadastrar?: (nome: string) => void;
  placeholder?: string;
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return opcoes;
    return opcoes.filter(o =>
      o.nome.toLowerCase().includes(q) || (o.tipoServico ?? '').toLowerCase().includes(q));
  }, [opcoes, busca]);

  const podeCadastrar = Boolean(onCadastrar)
    && busca.trim() !== ''
    && !opcoes.some(o => o.nome.trim().toLowerCase() === busca.trim().toLowerCase());

  return (
    <div className="relative">
      <input
        type="text" value={busca} placeholder={placeholder}
        onChange={e => { setBusca(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white
          focus:outline-none focus:border-emerald-500 hover:border-gray-300"
      />
      {!busca && (
        <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
      )}
      {aberto && (
        <div className="absolute z-40 top-full left-0 right-0 mt-1 min-w-[13rem] bg-white border border-gray-200
                        rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtradas.slice(0, 60).map(o => (
            <button key={o.id} type="button"
              onMouseDown={e => { e.preventDefault(); onEscolher(o.id); setBusca(''); setAberto(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-emerald-50">
              {o.nome}
              {o.tipoServico && <span className="block text-[10px] text-gray-400">{o.tipoServico}</span>}
            </button>
          ))}
          {podeCadastrar && (
            <button type="button"
              onMouseDown={e => { e.preventDefault(); onCadastrar?.(busca.trim()); }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-emerald-700
                         border-t border-gray-100 hover:bg-emerald-50">
              <Plus size={13} /> Cadastrar “{busca.trim()}”
            </button>
          )}
          {filtradas.length === 0 && !podeCadastrar && (
            <p className="px-3 py-2 text-xs text-gray-400">
              {opcoes.length === 0 ? 'Nenhum prestador disponível.' : 'Nenhum prestador encontrado.'}
            </p>
          )}
          {filtradas.length > 60 && (
            <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100 bg-gray-50">
              Mostrando 60 de {filtradas.length} — digite para filtrar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

// ─── Linhas da grade (desktop) ───────────────────────────────────────────────
/**
 * A LINHA é quem guarda o texto em edição, compara com o gravado e decide quando
 * gravar (pedido de 2026-09-11). Por isso as duas viraram componentes: dentro de um
 * `.map` não há como ter estado por linha.
 *
 * ⚠️ Cada uma ressincroniza quando o valor vem DE FORA (recarga da lista, salvamento
 * de outra linha) — mas só enquanto NÃO há edição pendente: sobrescrever o que a
 * pessoa está digitando porque a lista recarregou é perder trabalho em silêncio.
 */
function LinhaProcedimento({
  p, podeEditar, vincs, disponiveis, onSalvarValor, onVincular, onCadastrarPrestador,
}: {
  p: Procedimento;
  podeEditar: boolean;
  vincs: VinculoPrestador[];
  disponiveis: PrestadorOpcao[];
  onSalvarValor: (p: Procedimento, texto: string) => Promise<boolean>;
  onVincular: (p: Procedimento, prestadorId: number) => void;
  onCadastrarPrestador: (p: Procedimento, nome: string) => void;
}) {
  const gravado = numToMask(p.valorEmpresa);
  const [texto, setTexto] = useState(gravado);
  const [salvando, setSalvando] = useState(false);
  const mudou = texto !== gravado;

  useEffect(() => { if (!salvando) setTexto(numToMask(p.valorEmpresa)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.valorEmpresa]);

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    const ok = await onSalvarValor(p, texto);
    setSalvando(false);
    // Falhou: a tela volta a dizer a verdade — nunca fica exibindo número que não gravou.
    if (!ok) setTexto(gravado);
  };

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/60">
      <td className="px-5 py-3">
        <p className="font-medium text-gray-900">{p.nome}</p>
        {p.descricao && <p className="text-[11px] text-gray-400 truncate max-w-md">{p.descricao}</p>}
      </td>
      <td className="px-5 py-3 text-gray-500">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</td>
      <td className="px-5 py-3">
        {/* 🔴 O SELETOR — digita para filtrar, marca um que exista, ou cadastra um
            novo. Escolher JÁ CRIA a linha do prestador abaixo. */}
        {podeEditar ? (
          <PrestadorCombo
            opcoes={disponiveis}
            placeholder={vincs.length ? 'Outro prestador…' : 'Escolher prestador…'}
            onEscolher={id => onVincular(p, id)}
            onCadastrar={nome => onCadastrarPrestador(p, nome)}
          />
        ) : (
          <span className="text-xs text-gray-400 italic">Padrão da empresa</span>
        )}
      </td>
      {/* Sem prestador não há o que ele cobre da clínica. */}
      <td className="px-5 py-3 text-right text-gray-300">—</td>
      {/* 🔴 UM Valor Cliente por procedimento na tela (2026-09-10): com prestador
          vinculado o valor passa a ser o DELE, e o campo do padrão SOME daqui — dois
          campos com o mesmo rótulo na mesma coluna não deixavam claro qual a fatura
          usa. Para editar o padrão de novo, remova os prestadores. */}
      <td className="px-5 py-3 text-right">
        {vincs.length > 0 ? (
          <span className="text-gray-300" title="Definido por prestador — remova os prestadores para editar o valor padrão da empresa">—</span>
        ) : podeEditar ? (
          <ValorInline
            texto={texto}
            onTexto={setTexto}
            onEnter={salvar}
            onEsc={() => setTexto(gravado)}
            placeholder="R$ 0,00"
            titulo="Valor cobrado do cliente quando a própria equipe executa"
            desabilitado={salvando}
          />
        ) : (
          <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
            {brl(p.valorEmpresa)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {mudou && vincs.length === 0 && (
          <AcoesEdicao onSalvar={salvar} onCancelar={() => setTexto(gravado)} salvando={salvando} />
        )}
      </td>
    </tr>
  );
}

/**
 * Linha do PRESTADOR — os dois valores gravam JUNTOS, numa chamada só: eles moram no
 * mesmo vínculo, e salvá-los em duas requisições deixaria a linha meio gravada se a
 * segunda falhasse.
 */
function LinhaPrestador({
  p, v, podeEditar, podeExcluir, onSalvarVinculo, onRemover,
}: {
  p: Procedimento;
  v: VinculoPrestador;
  podeEditar: boolean;
  podeExcluir: boolean;
  onSalvarVinculo: (
    procedimentoId: number, prestadorId: number,
    valores: { valorCliente?: string; valorPrestador?: string },
  ) => Promise<boolean>;
  onRemover: (procedimentoId: number, vinculoId: number) => void;
}) {
  const gravadoCli   = numToMask(v.valorCliente);
  const gravadoPrest = numToMask(v.valorPrestador);
  const [cli,   setCli]   = useState(gravadoCli);
  const [prest, setPrest] = useState(gravadoPrest);
  const [salvando, setSalvando] = useState(false);
  const mudou = cli !== gravadoCli || prest !== gravadoPrest;

  useEffect(() => {
    if (salvando) return;
    setCli(numToMask(v.valorCliente));
    setPrest(numToMask(v.valorPrestador));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.valorCliente, v.valorPrestador]);

  const desfazer = () => { setCli(gravadoCli); setPrest(gravadoPrest); };

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    // Manda SÓ o que mudou: `undefined` não toca no valor gravado (PATCH parcial),
    // enquanto vazio APAGA — mandar os dois sempre transformaria "não mexi" em
    // "apague", que é como o valor do prestador sumiria ao editar só o do cliente.
    const ok = await onSalvarVinculo(p.id, v.prestadorId, {
      ...(cli   !== gravadoCli   ? { valorCliente:   cli }   : {}),
      ...(prest !== gravadoPrest ? { valorPrestador: prest } : {}),
    });
    setSalvando(false);
    if (!ok) desfazer();
  };

  return (
    <tr className="border-b border-gray-50 bg-emerald-50/20">
      <td className="px-5 py-2 pl-9 text-gray-300"><CornerDownRight size={13} /></td>
      <td className="px-5 py-2" />
      <td className="px-5 py-2">
        <p className="text-gray-900 font-medium flex items-center gap-1.5">
          {v.prestadorNome}
          {!v.prestadorAtivo && (
            <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">INATIVO</span>
          )}
        </p>
        {/* De onde sai o valor do RECIBO deste prestador. Sem esta linha, o gestor vê
            dois números e não sabe qual a clínica vai pagar. */}
        <p className="text-[11px] text-gray-400">{rotuloPagamentoPrestador(v)}</p>
      </td>
      <td className="px-5 py-2 text-right">
        {podeEditar ? (
          <ValorInline
            texto={prest} onTexto={setPrest} onEnter={salvar} onEsc={desfazer}
            placeholder="R$ 0,00" desabilitado={salvando}
            titulo="Valor que este prestador cobra da clínica por este procedimento"
          />
        ) : (
          <span className={v.valorPrestador !== null ? 'font-semibold text-gray-700' : 'text-gray-400'}>
            {brl(v.valorPrestador)}
          </span>
        )}
      </td>
      <td className="px-5 py-2 text-right">
        {/* ⚠️ `placeholder="Padrão"` e não "R$ 0,00": vazio aqui significa "usa o valor
            padrão da empresa", não zero. */}
        {podeEditar ? (
          <ValorInline
            texto={cli} onTexto={setCli} onEnter={salvar} onEsc={desfazer}
            placeholder="Padrão" desabilitado={salvando}
            titulo="Valor cobrado do cliente quando é este prestador que executa (vazio = padrão da empresa)"
          />
        ) : v.valorCliente !== null ? (
          <span className="font-semibold text-emerald-700">{brl(v.valorCliente)}</span>
        ) : (
          <span className="text-gray-400 text-xs">
            {brl(p.valorEmpresa)} <span className="italic">(padrão)</span>
          </span>
        )}
        {podeEditar && v.valorCliente === null && !mudou && (
          p.valorEmpresa !== null ? (
            <span className="block text-[10px] text-gray-400 italic">usa {brl(p.valorEmpresa)}</span>
          ) : (
            /* Com o campo do padrão escondido, este é o único aviso de que o
               procedimento sairia na fatura por R$ 0,00. */
            <span className="block text-[10px] text-amber-600 italic">sem valor definido</span>
          )
        )}
      </td>
      <td className="px-5 py-2 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {mudou && (
            <AcoesEdicao onSalvar={salvar} onCancelar={desfazer} salvando={salvando} />
          )}
          {podeExcluir && !mudou && (
            <button onClick={() => onRemover(p.id, v.id)} className="p-1 text-red-500 hover:bg-red-50 rounded"
              title="Remover este prestador do procedimento">
              <Trash2 size={13} />
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

// ─── Card do procedimento (mobile) ───────────────────────────────────────────
/**
 * Espelho do desktop: os mesmos campos, o mesmo par Salvar/Cancelar e a mesma regra de
 * "só aparece quando há alteração pendente".
 *
 * ⚠️ Aqui os ícones ficam JUNTO do bloco de valores, e não numa coluna de ações que o
 * card não tem — mas continuam sendo os mesmos `AcoesEdicao`, para as duas telas não
 * divergirem na primeira correção (armadilha 28-g).
 */
function CardProcedimento({
  p, podeEditar, podeExcluir, disponiveis,
  onSalvarValor, onSalvarVinculo, onVincular, onRemover, onCadastrarPrestador,
}: {
  p: Procedimento;
  podeEditar: boolean;
  podeExcluir: boolean;
  disponiveis: PrestadorOpcao[];
  onSalvarValor: (p: Procedimento, texto: string) => Promise<boolean>;
  onSalvarVinculo: (
    procedimentoId: number, prestadorId: number,
    valores: { valorCliente?: string; valorPrestador?: string },
  ) => Promise<boolean>;
  onVincular: (p: Procedimento, prestadorId: number) => void;
  onRemover: (procedimentoId: number, vinculoId: number) => void;
  onCadastrarPrestador: (p: Procedimento, nome: string) => void;
}) {
  const vincs = p.prestadores ?? [];
  const gravado = numToMask(p.valorEmpresa);
  const [texto, setTexto] = useState(gravado);
  const [salvando, setSalvando] = useState(false);
  const mudou = texto !== gravado;

  useEffect(() => { if (!salvando) setTexto(numToMask(p.valorEmpresa)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.valorEmpresa]);

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    const ok = await onSalvarValor(p, texto);
    setSalvando(false);
    if (!ok) setTexto(gravado);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="font-semibold text-gray-900 text-sm">{p.nome}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</p>

      {/* Com prestador vinculado o Valor Cliente é o DELE, e este campo some —
          um rótulo, um campo. */}
      {vincs.length === 0 && (
        <>
          <div className="flex items-center justify-between gap-2 mt-2 text-xs">
            <span className="text-gray-500">Valor Cliente</span>
            {podeEditar ? (
              <ValorInline
                texto={texto} onTexto={setTexto} onEnter={salvar} onEsc={() => setTexto(gravado)}
                placeholder="R$ 0,00" className="w-24 text-xs" desabilitado={salvando}
              />
            ) : (
              <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
                {brl(p.valorEmpresa)}
              </span>
            )}
          </div>
          {/* ⚠️ As ações do card vão no RODAPÉ, nunca ao lado do campo (§6): com
              rótulo elas espremeriam o valor até ele quebrar de linha. */}
          {mudou && (
            <div className="mt-3 pt-3 border-t border-gray-50">
              <AcoesEdicao onSalvar={salvar} onCancelar={() => setTexto(gravado)} salvando={salvando} />
            </div>
          )}
        </>
      )}

      {vincs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50 space-y-2">
          {vincs.map(v => (
            <CardPrestador
              key={v.id}
              p={p} v={v}
              podeEditar={podeEditar}
              podeExcluir={podeExcluir}
              onSalvarVinculo={onSalvarVinculo}
              onRemover={onRemover}
            />
          ))}
        </div>
      )}

      {podeEditar && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          <label className="block text-[10px] text-gray-500 mb-1">Prestador</label>
          <PrestadorCombo
            opcoes={disponiveis}
            placeholder={vincs.length ? 'Outro prestador…' : 'Escolher prestador…'}
            onEscolher={id => onVincular(p, id)}
            onCadastrar={nome => onCadastrarPrestador(p, nome)}
          />
        </div>
      )}
    </div>
  );
}

/** Bloco de um prestador dentro do card — os dois valores gravam JUNTOS, como no desktop. */
function CardPrestador({
  p, v, podeEditar, podeExcluir, onSalvarVinculo, onRemover,
}: {
  p: Procedimento;
  v: VinculoPrestador;
  podeEditar: boolean;
  podeExcluir: boolean;
  onSalvarVinculo: (
    procedimentoId: number, prestadorId: number,
    valores: { valorCliente?: string; valorPrestador?: string },
  ) => Promise<boolean>;
  onRemover: (procedimentoId: number, vinculoId: number) => void;
}) {
  const gravadoCli   = numToMask(v.valorCliente);
  const gravadoPrest = numToMask(v.valorPrestador);
  const [cli,   setCli]   = useState(gravadoCli);
  const [prest, setPrest] = useState(gravadoPrest);
  const [salvando, setSalvando] = useState(false);
  const mudou = cli !== gravadoCli || prest !== gravadoPrest;

  useEffect(() => {
    if (salvando) return;
    setCli(numToMask(v.valorCliente));
    setPrest(numToMask(v.valorPrestador));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.valorCliente, v.valorPrestador]);

  const desfazer = () => { setCli(gravadoCli); setPrest(gravadoPrest); };

  const salvar = async () => {
    if (!mudou) return;
    setSalvando(true);
    const ok = await onSalvarVinculo(p.id, v.prestadorId, {
      ...(cli   !== gravadoCli   ? { valorCliente:   cli }   : {}),
      ...(prest !== gravadoPrest ? { valorPrestador: prest } : {}),
    });
    setSalvando(false);
    if (!ok) desfazer();
  };

  return (
    <div className="rounded-xl bg-emerald-50/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
          {v.prestadorNome}
          {!v.prestadorAtivo && (
            <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">INATIVO</span>
          )}
        </p>
        <p className="text-[10px] text-gray-400">{rotuloPagamentoPrestador(v)}</p>
      </div>
      <div className="mt-1.5 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Valor Prestador</span>
          {podeEditar ? (
            <ValorInline texto={prest} onTexto={setPrest} onEnter={salvar} onEsc={desfazer}
              placeholder="R$ 0,00" className="w-24 text-xs" desabilitado={salvando} />
          ) : (
            <span className={v.valorPrestador !== null ? 'font-semibold text-gray-700' : 'text-gray-400'}>{brl(v.valorPrestador)}</span>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Valor Cliente</span>
          {podeEditar ? (
            <ValorInline texto={cli} onTexto={setCli} onEnter={salvar} onEsc={desfazer}
              placeholder="Padrão" className="w-24 text-xs" desabilitado={salvando} />
          ) : v.valorCliente !== null ? (
            <span className="font-semibold text-emerald-700">{brl(v.valorCliente)}</span>
          ) : (
            <span className="text-gray-400">{brl(p.valorEmpresa)} <span className="italic">(padrão)</span></span>
          )}
        </div>
      </div>
      {/* ⚠️ Ações no RODAPÉ do bloco (§6): no cabeçalho, com rótulo, elas espremeriam
          o nome do prestador. Salvar/Cancelar e Remover se ALTERNAM — remover a linha
          que está sendo editada descartaria o que foi digitado sem dizer nada. */}
      {(mudou || podeExcluir) && (
        <div className="mt-2 pt-2 border-t border-emerald-100">
          {mudou ? (
            <AcoesEdicao onSalvar={salvar} onCancelar={desfazer} salvando={salvando} />
          ) : (
            <AcoesRegistro>
              <AcaoRegistro
                rotulo="Remover" icone={Trash2} tom="cancelar"
                titulo="Remover este prestador do procedimento"
                onClick={() => onRemover(p.id, v.id)}
              />
            </AcoesRegistro>
          )}
        </div>
      )}
    </div>
  );
}

export default function CadastroProcedimento() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms, podeExecutar } = usePermissoes();
  const isAdmin = (user?.userType ?? '').toUpperCase() === 'ADMIN';

  const [especialidades, setEspecialidades] = useState<string[]>([]);
  /**
   * 🔴 CATEGORIAS DE EXAME DE IMAGEM (2026-09-09) — Radiografia, Ultrassonografia,
   * Endoscopia, Termografia, Tomografia e Ressonância, Laparoscopia.
   * Vieram no lugar da especialidade 'Diagnóstico por Imagem', que SAIU do seletor: os
   * 119 exames de imagem passaram a ser procedimentos do catálogo e se organizam por
   * categoria, não por especialidade. Quem manda a lista (e a ORDEM clínica dela) é o
   * backend — deduzi-la aqui daria ordem alfabética e mudaria sozinha.
   */
  const [imagemCategorias, setImagemCategorias] = useState<string[]>([]);
  const [gestorBackend,  setGestorBackend]  = useState(false);
  const [espSel,         setEspSel]         = useState('');
  const [procedimentos,  setProcedimentos]  = useState<Procedimento[]>([]);
  const [combos,         setCombos]         = useState<Combo[]>([]);
  const [buscaCombos,    setBuscaCombos]    = useState('');
  const [filtroAtivoCombos, setFiltroAtivoCombos] = useState<'ativo' | 'inativo' | 'all'>('ativo');
  const [busca,          setBusca]          = useState('');
  // Buscadores POR PRESTADOR (pedido de 2026-09-10) — um em cada aba. São separados da
  // busca por nome/categoria de propósito: procurar "quais procedimentos o Fulano faz"
  // é outra pergunta, e misturar as duas num campo só daria resultado que ninguém
  // consegue prever.
  const [buscaPrestProc,  setBuscaPrestProc]  = useState('');
  const [buscaPrestCombo, setBuscaPrestCombo] = useState('');
  const [aba,            setAba]            = useState<'procedimentos' | 'combos'>('procedimentos');
  const [loading,        setLoading]        = useState(true);
  const [loadingProcs,   setLoadingProcs]   = useState(false);

  // 🔴 O LÁPIS SAIU (pedido de 2026-09-10): os dois valores são campos SEMPRE
  // editáveis na grade (`ValorInline`), que gravam ao sair do campo. Com isso saíram
  // `editandoValorId`/`valorEdit`/`salvandoValor` e o par de botões ✓/✕ de cada célula
  // — quem confirma é o blur, e quem desfaz é o Esc.

  // Prestador × procedimento (gestor) — vários prestadores por procedimento, cada um
  // com o seu "Valor Cobrado para o Cliente" e o seu "Valor Cobrado pelo Prestador".
  const [prestadoresEmpresa, setPrestadoresEmpresa] = useState<PrestadorOpcao[]>([]);
  // Só o "salvando" sobrou: com o combobox criando a linha e os valores gravando no
  // blur, não há mais formulário de vínculo nem modo de edição para guardar em estado.
  const [, setSalvandoVinc] = useState(false);

  /**
   * CHEGADA GUIADA da PRESCRIÇÃO (2026-09-08) —
   * `?especialidade=&busca=<procedimento>&vincular=<prestadorId>`.
   *
   * É a segunda metade do fluxo "prescrevi um procedimento e o prestador não tinha
   * valor": a tela abre JÁ na especialidade certa, filtrada pelo procedimento, com o
   * formulário de vínculo aberto e o prestador escolhido. Sem isso o gestor cairia
   * numa lista de centenas de linhas para achar o que acabou de ser prescrito.
   *
   * ⚠️ O efeito roda UMA vez por chegada e CONSOME a query (`setParams`): sem isso ele
   * reabriria o formulário a cada recarga da lista, por cima do que estivesse sendo
   * digitado.
   */
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const espDaUrl      = params.get('especialidade') ?? '';
  const buscaDaUrl    = params.get('busca') ?? '';
  const vincularDaUrl = params.get('vincular') ?? '';
  /** Volta do cadastro de prestador: casa pelo NOME (o id ainda não era conhecido). */
  const vincularNomeUrl = params.get('vincularNome') ?? '';
  /**
   * 🔴 CHEGADA VINDA DO PEDIDO DE EXAME (2026-09-11) — `?codigos=PR-0302,PR-0310` abre
   * a lista SÓ com esses exames e `?vincularPrestador=<id>` já cria o vínculo em cada
   * um, para os campos de valor aparecerem prontos para digitar.
   *
   * É o caminho de quem escolheu um prestador na aba Imagem e descobriu que ele ainda
   * não tem valor naqueles exames: sem o recorte, cairia numa categoria de 56
   * radiografias para achar as 3 que faltam.
   */
  const codigosDaUrl    = params.get('codigos') ?? '';
  const vincPrestUrl    = params.get('vincularPrestador') ?? '';

  // Modal novo procedimento (ADMIN)
  const [showNovoProc, setShowNovoProc] = useState(false);
  const [formProc,     setFormProc]     = useState<FormNovoProc>(FORM_PROC_INICIAL);
  const [salvandoProc, setSalvandoProc] = useState(false);

  // Modal combo (gestor)
  const [showCombo,     setShowCombo]     = useState(false);
  const [comboEditando, setComboEditando] = useState<Combo | null>(null);
  const [comboNome,     setComboNome]     = useState('');
  const [comboEsp,      setComboEsp]      = useState('');
  const [comboValor,    setComboValor]    = useState('');
  const [comboDesc,     setComboDesc]     = useState('');
  const [comboIds,      setComboIds]      = useState<number[]>([]);
  const [comboPrestId, setComboPrestId] = useState<number | null>(null);
  /**
   * As colunas de prestador do COMBO existem nesta base?
   *
   * 🔴 Sem esta bandeira a tela ofereceria o seletor e a escolha DESAPARECERIA no salvar
   * — falha silenciosa, o pior resultado possível. Com ela, os campos são substituídos
   * por um aviso que diz o que falta (aplicar a migration `20261002000000`).
   * Nasce `true` para não piscar o aviso durante a primeira carga.
   */
  const [comboPrestOk, setComboPrestOk] = useState(true);
  const [comboValorPrest, setComboValorPrest] = useState('');
  const [comboBusca,    setComboBusca]    = useState('');
  const [todosProcs,    setTodosProcs]    = useState<Procedimento[]>([]);
  const [salvandoCombo, setSalvandoCombo] = useState(false);
  // Erros inline: página (lista/valor), modal de novo procedimento e modal de combo
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  const [erroProc,      setErroProc]      = useState<string | null>(null);
  const [erroCombo,     setErroCombo]     = useState<string | null>(null);
  const [comboToggle,   setComboToggle]   = useState<Combo | null>(null);

  // Controle de acesso — slug cadastro.procedimento.* (GESTOR/ADMIN têm bypass via podeExecutar)
  const podeVer    = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.ler');
  const podeEditar = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.editar');
  const podeCriar  = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.criar');
  const podeExcluir = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.deletar');
  // "Gerir" = tem alguma ação de escrita (mostra textos/afford. de gestão)
  const podeGerirEmpresa = podeEditar || podeCriar || podeExcluir;

  // ── Loaders ───────────────────────────────────────────────────────────────

  const carregarEspecialidades = useCallback(async () => {
    try {
      const res = await api.get('/procedimentos/especialidades-minhas');
      if (!res.data) return;
      setEspecialidades(res.data?.dados ?? []);
      setImagemCategorias(res.data?.imagemCategorias ?? []);
      setGestorBackend(Boolean(res.data?.gestor));
    } catch { /* silencioso */ }
  }, []);

  /**
   * A MESMA lista serve às duas naturezas: `sel` é uma especialidade clínica OU uma
   * categoria de exame de imagem, e o parâmetro enviado muda conforme o caso — o
   * backend recorta por `especialidade` ou por `imagemCategoria`, nunca pelos dois.
   * ⚠️ `ehImagem` entra nas dependências: sem isso, escolher uma categoria antes de a
   * lista de categorias chegar mandaria `especialidade=Radiografia` e voltaria vazio.
   */
  const carregarProcedimentos = useCallback(async (sel: string, ehImagem: boolean, codigos = '') => {
    if (!sel) { setProcedimentos([]); return; }
    setLoadingProcs(true);
    try {
      const params = {
        ...(ehImagem ? { imagemCategoria: sel } : { especialidade: sel }),
        ...(codigos ? { codigos } : {}),
      };
      const res = await api.get('/procedimentos/cadastro/lista', { params });
      if (!res.data) { setProcedimentos([]); return; }
      setProcedimentos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingProcs(false); }
  }, []);

  const carregarPrestadores = useCallback(async () => {
    try {
      const res = await api.get('/procedimentos/cadastro/prestadores');
      if (!res.data) return;
      setPrestadoresEmpresa(res.data?.dados ?? []);
    } catch { /* silencioso */ }
  }, []);

  const carregarCombos = useCallback(async (ativo: 'ativo' | 'inativo' | 'all') => {
    try {
      const params = ativo === 'all' ? { ativo: 'all' } : { ativo: ativo === 'ativo' ? 'true' : 'false' };
      const res = await api.get('/procedimentos/cadastro/combos', { params });
      if (!res.data) return;
      setCombos(res.data?.dados ?? []);
      if (res.data?.recursos) setComboPrestOk(res.data.recursos.comboPrestador !== false);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([
      carregarEspecialidades(), carregarCombos(filtroAtivoCombos), carregarPrestadores(),
    ]).finally(() => setLoading(false));
  }, [loadingPerms, carregarEspecialidades, carregarCombos, carregarPrestadores, filtroAtivoCombos]);

  /** O que está escolhido no seletor é categoria de imagem (e não especialidade)? */
  const selEhImagem = imagemCategorias.includes(espSel);

  useEffect(() => {
    if (loadingPerms) return;
    carregarProcedimentos(espSel, selEhImagem, codigosDaUrl);
  }, [espSel, selEhImagem, codigosDaUrl, loadingPerms, carregarProcedimentos]);

  // Auto-seleciona quando há UMA opção só no seletor inteiro — contando as categorias
  // de imagem junto. Com uma especialidade e seis categorias não há o que adivinhar.
  useEffect(() => {
    if (espSel) return;
    const todas = [...especialidades, ...imagemCategorias];
    if (todas.length === 1) setEspSel(todas[0]);
  }, [especialidades, imagemCategorias, espSel]);

  // Chegada guiada: posiciona a tela (especialidade + busca) ANTES de abrir o vínculo.
  // A especialidade só é imposta quando a empresa realmente a atende — vinda de outra
  // clínica, ela não estaria na lista e o seletor ficaria com um valor sem opção.
  useEffect(() => {
    if (!espDaUrl) return;
    // Vale para os dois tipos de opção: a volta do cadastro de prestador pode ter
    // partido de uma categoria de imagem, e sem isto o seletor voltaria vazio.
    const conhecidas = [...especialidades, ...imagemCategorias];
    if (conhecidas.length > 0 && !conhecidas.includes(espDaUrl)) return;
    setEspSel(espDaUrl);
  }, [espDaUrl, especialidades, imagemCategorias]);

  useEffect(() => { if (buscaDaUrl) setBusca(buscaDaUrl); }, [buscaDaUrl]);

  // Abre o formulário de vínculo no procedimento que a prescrição indicou, já com o
  // prestador escolhido. Depende de `procedimentos`: só há o que abrir depois que a
  // lista da especialidade chegou.
  useEffect(() => {
    const porId   = vincularDaUrl.trim();
    const porNome = vincularNomeUrl.trim();
    if ((!porId && !porNome) || !buscaDaUrl || procedimentos.length === 0) return;
    const alvo = procedimentos.find(
      x => x.nome.trim().toLowerCase() === buscaDaUrl.trim().toLowerCase(),
    );
    if (!alvo) return;
    // Vindo do cadastro de prestador, o id só existe depois de ele ser criado: casa-se
    // pelo NOME contra a lista já recarregada. Ainda sem o prestador na lista (a carga
    // pode não ter chegado), sai sem consumir a query e tenta no próximo render.
    const id = porId
      ? Number(porId)
      : prestadoresEmpresa.find(x => x.nome.trim().toLowerCase() === porNome.toLowerCase())?.id;
    if (!Number.isInteger(id)) return;
    void vincularPrestador(alvo, Number(id));
    const limpo = new URLSearchParams(params);
    limpo.delete('vincular');
    limpo.delete('vincularNome');
    setParams(limpo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vincularDaUrl, vincularNomeUrl, buscaDaUrl, procedimentos, prestadoresEmpresa]);

  /**
   * Vindo do pedido de exame: cria o vínculo do prestador em TODOS os exames que a URL
   * recortou e que ainda não o têm, para o gestor só digitar os valores.
   *
   * ⚠️ Em SEQUÊNCIA, nunca `Promise.all`: são até algumas dezenas de exames, e disparar
   * tudo de uma vez transformaria um clique em uma rajada de requisições.
   * ⚠️ A query é consumida ANTES das chamadas (`setParams` replace) — sem isso o efeito
   * reexecutaria a cada atualização da lista, que é o que ele mesmo provoca.
   * ⚠️ Idempotente do lado do servidor: o vínculo é unique por (empresa, procedimento,
   * prestador), então uma execução repetida não duplica nada.
   */
  useEffect(() => {
    const prestId = Number(vincPrestUrl);
    if (!Number.isInteger(prestId) || prestId <= 0) return;
    if (procedimentos.length === 0) return;

    const faltando = procedimentos.filter(
      x => !(x.prestadores ?? []).some(v => v.prestadorId === prestId),
    );

    const limpo = new URLSearchParams(params);
    limpo.delete('vincularPrestador');
    setParams(limpo, { replace: true });

    if (faltando.length === 0) return;
    void (async () => {
      for (const x of faltando) await salvarVinculo(x.id, prestId, {});
      toast.success(
        faltando.length === 1
          ? 'Prestador vinculado — informe os valores.'
          : `${faltando.length} exames vinculados — informe os valores.`,
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vincPrestUrl, procedimentos]);

  const procsFiltrados = useMemo(() => {
    const q  = busca.trim().toLowerCase();
    const qp = buscaPrestProc.trim().toLowerCase();
    return procedimentos.filter(p => {
      if (q && !(p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))) return false;
      // Busca por PRESTADOR: só passa o procedimento que tem vínculo com alguém cujo
      // nome (ou tipo de serviço) casa. Procedimento SEM prestador some — é o ponto do
      // filtro: "o que o Fulano executa?".
      if (qp) {
        const tem = (p.prestadores ?? []).some(v =>
          v.prestadorNome.toLowerCase().includes(qp) || (v.tipoServico ?? '').toLowerCase().includes(qp));
        if (!tem) return false;
      }
      return true;
    });
  }, [procedimentos, busca, buscaPrestProc]);

  // Busca pelo NOME do combo OU pelo seu CONTEÚDO (nome de qualquer procedimento
  // que o compõe) — sem isso, procurar por um procedimento que só existe dentro
  // de um combo (nunca no nome dele) não achava o combo nenhum.
  const combosFiltrados = useMemo(() => {
    const q  = buscaCombos.trim().toLowerCase();
    const qp = buscaPrestCombo.trim().toLowerCase();
    return combos.filter(c => {
      if (q && !(c.nome.toLowerCase().includes(q)
        || c.itens.some(i => i.procedimento.nome.toLowerCase().includes(q)))) return false;
      if (qp && !(c.prestadorNome ?? '').toLowerCase().includes(qp)) return false;
      return true;
    });
  }, [combos, buscaCombos, buscaPrestCombo]);

  // ── Valor da empresa (gestor) ─────────────────────────────────────────────

  /**
   * Valor CLIENTE padrão da empresa. Devolve `true`/`false` para o `ValorInline` saber
   * se pode dar o valor por salvo — falhando, a célula volta ao que o banco tem, em vez
   * de deixar na tela um número que não foi gravado.
   */
  const salvarValorEmpresa = async (p: Procedimento, texto: string): Promise<boolean> => {
    setErroInline(null);
    try {
      const res = await api.put(`/procedimentos/cadastro/valor/${p.id}`, {
        valor: texto.trim() === '' ? null : parseBRL(texto),
      });
      const novo = res.data?.dados?.valorEmpresa ?? null;
      setProcedimentos(prev => prev.map(x => x.id === p.id ? { ...x, valorEmpresa: novo } : x));
      return true;
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao salvar o Valor Cliente');
      return false;
    }
  };

  // ── Prestador × procedimento (gestor) ─────────────────────────────────────

  /**
   * Grava o vínculo e ATUALIZA A LINHA com o que o backend devolveu, em vez de
   * recarregar a lista inteira.
   *
   * ⚠️ Recarregar perderia a especialidade/busca em curso e faria a tela piscar num
   * fluxo que é de repetição (o gestor cadastra vários prestadores em sequência). O
   * backend devolve a lista COMPLETA de vínculos do procedimento justamente para isso
   * — nunca deduzir o novo estado no front, que é como as duas versões divergem.
   */
  const aplicarVinculos = (procedimentoId: number, prestadores: VinculoPrestador[]) => {
    setProcedimentos(prev => prev.map(x => x.id === procedimentoId ? { ...x, prestadores } : x));
  };

  /**
   * Grava o vínculo. `undefined` num valor = "não mexi nele" (o backend mantém o
   * gravado); string vazia = APAGAR, o que devolve o procedimento ao valor padrão da
   * empresa — e é diferente de zero.
   *
   * Devolve bool para o `ValorInline` saber se pode dar o valor por salvo.
   */
  const salvarVinculo = async (
    procedimentoId: number,
    prestadorId: number,
    valores: { valorCliente?: string; valorPrestador?: string },
  ): Promise<boolean> => {
    setSalvandoVinc(true);
    setErroInline(null);
    const paraApi = (t?: string) =>
      t === undefined ? undefined : (t.trim() === '' ? null : parseBRL(t));
    try {
      const res = await api.put(`/procedimentos/cadastro/prestador/${procedimentoId}`, {
        prestadorId,
        valorCliente:   paraApi(valores.valorCliente),
        valorPrestador: paraApi(valores.valorPrestador),
      });
      if (res.data?.dados) aplicarVinculos(procedimentoId, res.data.dados.prestadores ?? []);
      return true;
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao salvar o prestador');
      return false;
    } finally { setSalvandoVinc(false); }
  };

  /**
   * Escolher alguém no combobox JÁ CRIA o vínculo, sem valores — os dois campos nascem
   * editáveis na linha nova, que é onde o gestor os digita.
   *
   * ⚠️ Criar na hora (em vez de abrir um formulário) é o que faz o combobox ser "o
   * seletor" que o pedido descreve: sem isso haveria um passo de confirmação para uma
   * escolha que já foi feita.
   */
  const vincularPrestador = async (p: Procedimento, prestadorId: number) => {
    const ok = await salvarVinculo(p.id, prestadorId, {});
    if (ok) toast.success('Prestador vinculado — informe os valores na linha.');
  };

  /**
   * Prestador que ainda não existe: leva ao cadastro dele já com o nome digitado e, ao
   * salvar, VOLTA para cá filtrado por este procedimento (`vincularNome` casa pelo nome
   * e abre o vínculo sozinho). Sem esse retorno, o gestor teria de reencontrar o
   * procedimento na lista para completar o que começou.
   *
   * ⚠️ O cadastro de prestador exige nome E telefone (`PrestadorController.criar`), então
   * criar por aqui, só com o nome, produziria um cadastro incompleto.
   */
  const irCadastrarPrestador = (p: Procedimento, nome: string) => {
    const volta = `/cadastro/procedimentos?${new URLSearchParams({
      ...(espSel ? { especialidade: espSel } : {}),
      busca:        p.nome,
      vincularNome: nome,
    })}`;
    navigate(`/cadastro/prestadores?${new URLSearchParams({ novo: '1', nome, depois: volta })}`);
  };

  const removerVinculo = async (procedimentoId: number, vinculoId: number) => {
    setErroInline(null);
    try {
      const res = await api.delete(`/procedimentos/cadastro/prestador/${procedimentoId}/${vinculoId}`);
      if (res.data?.dados) aplicarVinculos(procedimentoId, res.data.dados.prestadores ?? []);
      toast.success('Prestador removido do procedimento');
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao remover o prestador');
    }
  };

  // `abrirNovoVinculo` e `iniciarEdicaoVinculo` saíram: não há mais formulário de
  // vínculo nem modo de edição. Escolher no combobox cria a linha, e os valores dela são
  // editáveis direto (mesma regra do valor padrão da empresa).

  /** Prestadores ainda NÃO vinculados a este procedimento — não faz sentido oferecer
   *  quem já está na lista: o unique da tabela recusaria e o clique só falharia. */
  const prestadoresDisponiveis = (p: Procedimento) => {
    const jaTem = new Set((p.prestadores ?? []).map(v => v.prestadorId));
    return prestadoresEmpresa.filter(x => !jaTem.has(x.id));
  };

  // ── Novo procedimento (ADMIN) ─────────────────────────────────────────────

  const salvarNovoProc = async () => {
    setErroProc(null);
    if (!formProc.nome.trim())      { setErroProc('Nome é obrigatório'); return; }
    if (!formProc.categoria.trim()) { setErroProc('Categoria é obrigatória'); return; }
    setSalvandoProc(true);
    try {
      await api.post('/procedimentos', {
        nome:          formProc.nome.trim(),
        categoria:     formProc.categoria.trim(),
        especialidade: formProc.especialidade.trim() || null,
        valorVenda:    formProc.valorVenda ? parseBRL(formProc.valorVenda) : null,
        descricao:     formProc.descricao.trim() || null,
      });
      toast.success('Procedimento incluído no catálogo');
      setShowNovoProc(false);
      setFormProc(FORM_PROC_INICIAL);
      if (espSel) carregarProcedimentos(espSel, selEhImagem, codigosDaUrl);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroProc(e.response?.data?.error ?? 'Erro ao incluir procedimento');
    } finally { setSalvandoProc(false); }
  };

  // ── Combos (gestor) ───────────────────────────────────────────────────────

  const abrirNovoCombo = async () => {
    setErroCombo(null);
    setComboEditando(null);
    setComboNome(''); setComboEsp(''); setComboValor(''); setComboDesc(''); setComboIds([]); setComboBusca('');
    setComboPrestId(null); setComboValorPrest('');
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const abrirEdicaoCombo = async (c: Combo) => {
    setErroCombo(null);
    setComboEditando(c);
    setComboNome(c.nome);
    setComboEsp(c.especialidade ?? '');
    setComboValor(numToMask(c.valor));
    setComboDesc(c.descricao ?? '');
    setComboIds(c.itens.map(i => i.procedimento.id));
    setComboBusca('');
    setComboPrestId(c.prestadorId ?? null);
    setComboValorPrest(numToMask(c.valorPrestador ?? null));
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const salvarCombo = async () => {
    setErroCombo(null);
    if (!comboNome.trim())            { setErroCombo('Nome do combo é obrigatório'); return; }
    if (!comboEsp.trim())             { setErroCombo('Selecione a especialidade do combo'); return; }
    const valorNum = parseBRL(comboValor);
    if (!valorNum || valorNum <= 0)   { setErroCombo('Informe o Valor Cliente do combo'); return; }
    if (comboIds.length < 2)          { setErroCombo('Selecione pelo menos 2 procedimentos'); return; }
    setSalvandoCombo(true);
    try {
      const payload = {
        nome: comboNome.trim(), especialidade: comboEsp.trim(),
        // `valor` é o VALOR CLIENTE do pacote — o nome do campo é histórico (ver o
        // schema); o que mudou foi só o rótulo na tela.
        valor: valorNum,
        descricao: comboDesc.trim() || undefined,
        procedimentoIds: comboIds,
        // Prestador do pacote: OPCIONAL. `null` = executado pela própria equipe. Vazio no
        // Valor Prestador APAGA (não é zero) — mesma semântica do vínculo avulso.
        prestadorId:    comboPrestId,
        valorPrestador: comboValorPrest.trim() === '' ? null : parseBRL(comboValorPrest),
      };
      if (comboEditando) await api.put(`/procedimentos/cadastro/combos/${comboEditando.id}`, payload);
      else               await api.post('/procedimentos/cadastro/combos', payload);
      toast.success(comboEditando ? 'Combo atualizado' : 'Combo criado');
      setShowCombo(false);
      carregarCombos(filtroAtivoCombos);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroCombo(e.response?.data?.error ?? 'Erro ao salvar combo');
    } finally { setSalvandoCombo(false); }
  };

  const toggleCombo = async (motivo: string) => {
    if (!comboToggle) return;
    try {
      await api.patch(`/procedimentos/cadastro/combos/${comboToggle.id}/toggle`, { motivo });
      toast.success(comboToggle.ativo ? 'Combo inativado' : 'Combo ativado');
      setComboToggle(null);
      carregarCombos(filtroAtivoCombos);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao alterar status do combo');
    }
  };

  const somaItensCombo = useMemo(() =>
    todosProcs.filter(p => comboIds.includes(p.id))
      .reduce((acc, p) => acc + (p.valorEmpresa ?? p.valorVenda ?? 0), 0),
  [todosProcs, comboIds]);

  /**
   * Procedimentos LISTADOS na montagem do combo: os da especialidade escolhida no
   * seletor, filtrados pela busca.
   *
   * O seletor de especialidade tem DOIS papéis: classifica o combo (badge do card,
   * filtro do Orçamento) e escolhe o que aparece nesta lista. Trocar a especialidade
   * troca a lista — e **NÃO limpa o que já foi marcado**: é assim que o combo reúne
   * áreas diferentes (marca em Clínica Médica, troca para Anestesiologia, marca mais).
   * O que está selecionado fora da especialidade atual continua visível e removível
   * nos chips de "Selecionados", logo acima da lista; sem eles, item de outra área
   * ficaria preso no combo sem nenhuma forma de tirar.
   */
  const procsCombo = useMemo(() => {
    if (!comboEsp) return [];
    const q = comboBusca.trim().toLowerCase();
    const daEsp = todosProcs.filter(p => (p.especialidade ?? '') === comboEsp);
    const base = q
      ? daEsp.filter(p => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
      : daEsp;
    return base.slice(0, 60);
  }, [todosProcs, comboBusca, comboEsp]);

  // Tudo que está no combo, de QUALQUER especialidade — a memória da montagem.
  const procsSelecionados = useMemo(
    () => todosProcs.filter(p => comboIds.includes(p.id)),
    [todosProcs, comboIds]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!podeVer) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-16">
        <h2 className="text-lg font-bold text-gray-900">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
      </div>
    </PageContainer>
  );

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500';

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />

      <InlineError message={erroInline} className="mb-4" />

      {/* Cabeçalho (mesmo padrão de Agendamentos): ícone em box + título + descritivo */}
      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <ListChecks size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procedimentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Catálogo por especialidade{podeGerirEmpresa ? ', valores da empresa e combos' : ' e combos da empresa'}.
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {([
          { key: 'procedimentos', label: 'Procedimentos', icon: <ListChecks size={14} /> },
          { key: 'combos',        label: 'Combos',        icon: <Layers size={14} /> },
        ] as { key: 'procedimentos' | 'combos'; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.key} onClick={() => { setAba(t.key); setBusca(''); setBuscaCombos(''); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              aba === t.key ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-emerald-300'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {aba === 'procedimentos' && (
        <div className="space-y-4">
          {/* Seletor de especialidade + busca + novo (ADMIN) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Especialidade / Exame de imagem</label>
                {/* DOIS blocos com cabeçalho: sem eles "Radiografia" apareceria no meio
                    das especialidades clínicas e leria como se fosse uma delas. */}
                <DropdownSelect
                  value={espSel}
                  onChange={setEspSel}
                  grupos={[
                    { label: 'Especialidades',    options: especialidades },
                    { label: 'Exames de imagem',  options: imagemCategorias },
                  ]}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Nome ou categoria..." className={`${inputCls} pl-8`} />
                </div>
              </div>
              {/* Buscador POR PRESTADOR — responde "o que o Fulano executa?", que a busca
                  por nome/categoria não responde. Campo separado de propósito: num só, o
                  resultado de "Silva" seria imprevisível (nome de procedimento OU de
                  prestador). */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar prestador</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={buscaPrestProc} onChange={e => setBuscaPrestProc(e.target.value)}
                    placeholder="Nome do prestador..." className={`${inputCls} pl-8`} />
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => { setFormProc({ ...FORM_PROC_INICIAL, especialidade: espSel }); setShowNovoProc(true); }}
                  className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                  Novo Procedimento
                </button>
              )}
            </div>
            {/* 🔴 A LISTA ESTÁ RECORTADA — e a tela precisa DIZER isso. Sem o aviso, o
                gestor veria 3 radiografias onde existem 56 e concluiria que o catálogo
                sumiu. O botão devolve a categoria inteira sem sair da tela. */}
            {codigosDaUrl && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-xs text-emerald-900 leading-snug">
                  Mostrando apenas <strong>{codigosDaUrl.split(',').filter(Boolean).length} exame(s)</strong> vindos
                  do pedido de exames — informe o valor de cada um e salve.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const limpo = new URLSearchParams(params);
                    limpo.delete('codigos');
                    setParams(limpo, { replace: true });
                  }}
                  className="text-xs font-semibold text-emerald-700 hover:underline flex-shrink-0"
                >
                  Ver todos de {espSel}
                </button>
              </div>
            )}
            {especialidades.length === 0 && imagemCategorias.length === 0 && (
              <p className="text-xs text-amber-600 mt-3">
                Nenhuma especialidade vinculada ao seu cadastro. Atualize suas especialidades no Cadastro Pessoal.
              </p>
            )}
          </div>

          {/* Lista */}
          {!espSel ? (
            <div className="text-center py-14 text-gray-400 text-sm">Selecione uma especialidade para ver os procedimentos.</div>
          ) : loadingProcs ? (
            <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : procsFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              {buscaPrestProc.trim()
                ? `Nenhum procedimento de ${espSel} está vinculado a um prestador com esse nome.`
                : `Nenhum procedimento encontrado para ${espSel}.`}
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto rounded-2xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-3 font-semibold">Procedimento</th>
                      <th className="px-5 py-3 font-semibold">Categoria</th>
                      {/* Rótulos curtos (pedido de 2026-09-10): "Valor Cobrado pelo
                          Prestador"/"…para o Cliente" ocupavam duas linhas no cabeçalho e
                          empurravam a coluna do procedimento. O que eles significam está
                          na linha em que aparecem. */}
                      <th className="px-5 py-3 font-semibold w-56">Prestador</th>
                      <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor Prestador</th>
                      <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor Cliente</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {procsFiltrados.map(p => (
                      <Fragment key={p.id}>
                        <LinhaProcedimento
                          p={p}
                          podeEditar={podeEditar}
                          vincs={p.prestadores ?? []}
                          disponiveis={prestadoresDisponiveis(p)}
                          onSalvarValor={salvarValorEmpresa}
                          onVincular={vincularPrestador}
                          onCadastrarPrestador={irCadastrarPrestador}
                        />
                        {(p.prestadores ?? []).map(v => (
                          <LinhaPrestador
                            key={v.id}
                            p={p}
                            v={v}
                            podeEditar={podeEditar}
                            podeExcluir={podeExcluir}
                            onSalvarVinculo={salvarVinculo}
                            onRemover={removerVinculo}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {procsFiltrados.map(p => (
                  <CardProcedimento
                    key={p.id}
                    p={p}
                    podeEditar={podeEditar}
                    podeExcluir={podeExcluir}
                    disponiveis={prestadoresDisponiveis(p)}
                    onSalvarValor={salvarValorEmpresa}
                    onSalvarVinculo={salvarVinculo}
                    onVincular={vincularPrestador}
                    onRemover={removerVinculo}
                    onCadastrarPrestador={irCadastrarPrestador}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'combos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {podeCriar && (
              <button onClick={abrirNovoCombo}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
                <PackagePlus size={15} /> Novo Combo
              </button>
            )}
            {/* Buscador POR PRESTADOR também aqui — o pacote tem prestador desde
                2026-09-10, e "quais combos o Fulano executa?" é a mesma pergunta da
                outra aba. */}
            <div className="relative flex-shrink-0 w-full sm:w-52">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input type="text" value={buscaPrestCombo} onChange={e => setBuscaPrestCombo(e.target.value)}
                placeholder="Buscar prestador..." className={`${inputCls} pl-8`} />
            </div>
            {podeGerirEmpresa && (
              <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
                {(['all', 'ativo', 'inativo'] as const).map(v => (
                  <button key={v} onClick={() => setFiltroAtivoCombos(v)}
                    className={`px-3 py-2 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                      filtroAtivoCombos === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}>
                    {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
                  </button>
                ))}
              </div>
            )}
            {combos.length > 0 && (
              <div className="relative sm:max-w-xs w-full">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input type="text" value={buscaCombos} onChange={e => setBuscaCombos(e.target.value)}
                  placeholder="Buscar combo por nome..." className={`${inputCls} pl-8`} />
              </div>
            )}
          </div>
          {combos.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo cadastrado{podeGerirEmpresa ? ' — crie o primeiro combo de procedimentos da empresa.' : '.'}
            </div>
          ) : combosFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo encontrado para &ldquo;{buscaCombos}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
              {combosFiltrados.map(c => (
                <div key={c.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col ${c.ativo ? 'border-gray-100' : 'border-red-100 opacity-70'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-gray-900 text-sm truncate">{c.nome}</p>
                        {!c.ativo && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 flex-shrink-0">Inativo</span>
                        )}
                      </div>
                      {/* TODAS as especialidades do combo, uma por selo — ver
                          `especialidadesDoCombo`. */}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {especialidadesDoCombo(c).map(esp => (
                          <span key={esp} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            {esp}
                          </span>
                        ))}
                      </div>
                      {c.descricao && <p className="text-[11px] text-gray-400 mt-0.5">{c.descricao}</p>}
                      {/* Quem executa o pacote. Sem prestador é a própria equipe — e o
                          card não escreve isso para não repetir o caso comum em toda linha. */}
                      {c.prestadorNome && (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Prestador: <span className="font-semibold text-gray-700">{c.prestadorNome}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className="block text-sm font-bold text-emerald-700">{brl(c.valor)}</span>
                      <span className="block text-[10px] text-gray-400">Valor Cliente</span>
                      {c.valorPrestador != null && (
                        <>
                          <span className="block text-xs font-semibold text-gray-600 mt-1">{brl(c.valorPrestador)}</span>
                          <span className="block text-[10px] text-gray-400">Valor Prestador</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 flex-1">
                    {c.itens.map(i => (
                      <li key={i.id} className="text-xs text-gray-600 flex items-center gap-1.5">
                        <Check size={11} className="text-emerald-500 flex-shrink-0" />
                        <span className="truncate">{i.procedimento.nome}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Ícone no desktop, botão com rótulo no mobile — `AcaoRegistro`. */}
                  {(podeEditar || podeExcluir) && (
                    <AcoesRegistro className="mt-3 pt-2 border-t border-gray-50 md:justify-end">
                      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
                        visivel={podeEditar && c.ativo} onClick={() => abrirEdicaoCombo(c)} />
                      <AcaoRegistro tom="ativar" icone={c.ativo ? ToggleRight : ToggleLeft}
                        rotulo={c.ativo ? 'Inativar' : 'Ativar'}
                        visivel={podeExcluir} onClick={() => setComboToggle(c)} />
                    </AcoesRegistro>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: novo procedimento (ADMIN) ── */}
      {showNovoProc && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">Novo Procedimento (catálogo)</h3>
              <button onClick={() => setShowNovoProc(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome *</label>
                <input value={formProc.nome} onChange={e => setFormProc(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Categoria *</label>
                  <input value={formProc.categoria} onChange={e => setFormProc(f => ({ ...f, categoria: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor padrão</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={formProc.valorVenda}
                    onChange={e => setFormProc(f => ({ ...f, valorVenda: maskBRL(e.target.value) }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Especialidade</label>
                <DropdownSelect
                  value={formProc.especialidade}
                  onChange={especialidade => setFormProc(f => ({ ...f, especialidade }))}
                  options={especialidades}
                  placeholder="— Sem especialidade —"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                <textarea value={formProc.descricao} onChange={e => setFormProc(f => ({ ...f, descricao: e.target.value }))}
                  rows={3} className={inputCls} />
              </div>
            </div>
            <InlineError message={erroProc} className="mx-5 mt-3" />

            <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowNovoProc(false)} disabled={salvandoProc}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarNovoProc} disabled={salvandoProc}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                {salvandoProc && <Loader2 size={13} className="animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: combo (gestor) ── */}
      {showCombo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">{comboEditando ? 'Editar Combo' : 'Novo Combo de Procedimentos'}</h3>
              <button onClick={() => setShowCombo(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nome do combo *</label>
                  <input value={comboNome} onChange={e => setComboNome(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Especialidade *</label>
                  {/* DOIS papéis: classifica o combo (badge do card, filtro do Orçamento)
                      e escolhe o que a lista de procedimentos mostra. Trocá-la troca a
                      lista, mas NÃO limpa o que já foi marcado — é assim que se reúnem
                      áreas diferentes no mesmo pacote. */}
                  <DropdownSelect
                    value={comboEsp}
                    onChange={v => { setComboEsp(v); setComboBusca(''); }}
                    options={especialidades}
                    className={inputCls}
                  />
                </div>
              </div>
              {/* PRESTADOR do pacote + os DOIS valores, na mesma forma da tela de
                  procedimentos (pedido de 2026-09-10). "Valor do combo" era o valor
                  CLIENTE desde sempre — só o rótulo ficou explícito. */}
              {!comboPrestOk ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs text-amber-800 leading-snug">
                    <strong>Prestador no combo ainda não disponível nesta base.</strong> Falta aplicar a
                    migration <code className="font-mono">20261002000000_combo_prestador</code>. Até então o
                    combo tem apenas o Valor Cliente.
                  </p>
                </div>
              ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Prestador <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                {comboPrestId ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-gray-50">
                      {prestadoresEmpresa.find(x => x.id === comboPrestId)?.nome
                        ?? comboEditando?.prestadorNome
                        ?? `Prestador #${comboPrestId}`}
                    </span>
                    {/* Tirar o prestador devolve o combo à própria equipe — não é o mesmo
                        que deixar o campo em branco por não ter escolhido ainda. */}
                    <button type="button" onClick={() => { setComboPrestId(null); setComboValorPrest(''); }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                      title="Sem prestador (executado pela equipe)">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <PrestadorCombo
                    opcoes={prestadoresEmpresa}
                    placeholder="Escolher prestador…"
                    onEscolher={id => setComboPrestId(id)}
                    onCadastrar={nome => navigate(`/cadastro/prestadores?${new URLSearchParams({
                      novo: '1', nome, depois: '/cadastro/procedimentos',
                    })}`)}
                  />
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  Sem prestador, o pacote é executado pela própria equipe.
                </p>
              </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {comboPrestOk && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor Prestador</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={comboValorPrest}
                    onChange={e => setComboValorPrest(maskBRL(e.target.value))}
                    disabled={!comboPrestId}
                    title={comboPrestId ? 'Valor que o prestador cobra da clínica pelo pacote' : 'Escolha um prestador primeiro'}
                    className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`} />
                </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor Cliente *</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={comboValor}
                    onChange={e => setComboValor(maskBRL(e.target.value))} className={inputCls} />
                  {comboIds.length > 0 && somaItensCombo > 0 && (
                    <p className="text-[10px] text-gray-400 mt-1">Soma dos itens avulsos: {brl(somaItensCombo)}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                <input value={comboDesc} onChange={e => setComboDesc(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Procedimentos do combo * <span className="text-gray-400">({comboIds.length} selecionado{comboIds.length !== 1 ? 's' : ''} — mínimo 2)</span>
                </label>
                {/* Selecionados de QUALQUER especialidade. A lista abaixo só mostra a
                    especialidade escolhida no seletor, então sem estes chips o item de
                    outra área ficaria no combo sem forma de conferir nem de remover. */}
                {procsSelecionados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {procsSelecionados.map(p => (
                      <span key={p.id}
                        className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg pl-2 pr-1 py-0.5 text-[11px] max-w-full">
                        <span className="truncate">{p.nome}</span>
                        {p.especialidade && p.especialidade !== comboEsp && (
                          <span className="text-emerald-600/70 whitespace-nowrap">· {p.especialidade}</span>
                        )}
                        <button type="button" title="Remover do combo"
                          onClick={() => setComboIds(prev => prev.filter(i => i !== p.id))}
                          className="p-0.5 text-emerald-600 hover:text-red-600 rounded">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={comboBusca} onChange={e => setComboBusca(e.target.value)}
                    disabled={!comboEsp}
                    placeholder={comboEsp ? 'Buscar procedimento...' : 'Selecione a especialidade primeiro'}
                    className={`${inputCls} pl-8 ${!comboEsp ? 'bg-gray-50 cursor-not-allowed' : ''}`} />
                </div>
                <div className="border border-gray-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-gray-50">
                  {!comboEsp ? (
                    <p className="text-xs text-gray-400 p-3">Selecione a especialidade para listar os procedimentos.</p>
                  ) : procsCombo.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">
                      {comboBusca.trim() ? 'Nenhum procedimento encontrado para a busca.' : `Nenhum procedimento em ${comboEsp}.`}
                    </p>
                  ) : procsCombo.map(p => {
                    const sel = comboIds.includes(p.id);
                    return (
                      <button key={p.id} type="button"
                        onClick={() => setComboIds(prev => sel ? prev.filter(i => i !== p.id) : [...prev, p.id])}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${sel ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${sel ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                          {sel && <Check size={11} className="text-white" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-gray-900 truncate">{p.nome}</span>
                          <span className="block text-[10px] text-gray-400 truncate">
                            {p.categoria} · {brl(p.valorEmpresa ?? p.valorVenda)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Rodapé no padrão da aplicação: ações à DIREITA, tamanho padrão, Cancelar
                ao lado do Salvar. Eram dois botões `flex-1` de largura total — o
                Cancelar com o mesmo peso visual do Salvar. O rótulo é só "Salvar" nos
                dois modos: o que muda é o estado do formulário, não a ação (o título
                do modal já diz se é novo ou edição). */}
            <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowCombo(false)} disabled={salvandoCombo}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
                Cancelar
              </button>
              <button onClick={salvarCombo} disabled={salvandoCombo}
                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
                {salvandoCombo && <Loader2 size={13} className="animate-spin" />}
                {salvandoCombo ? 'Salvando…' : 'Salvar'}
              </button>
            </div>

            {/* Erro ABAIXO do botão que o disparou (CLAUDE.md §6) — estava ACIMA do
                rodapé, e num modal que rola o usuário clicava em Salvar sem ver nada. */}
            {erroCombo && (
              <div className="px-5 pb-5">
                <InlineError message={erroCombo} />
              </div>
            )}
          </div>
        </div>
      )}

      <ModalJustificativa
        aberto={comboToggle !== null}
        titulo={comboToggle?.ativo ? 'Inativar combo' : 'Ativar combo'}
        descricao={comboToggle
          ? comboToggle.ativo
            ? `O combo "${comboToggle.nome}" deixa de aparecer no Orçamento e na Prescrição. Orçamentos e faturas que já usaram este combo não são alterados. Esta ação será registrada na auditoria.`
            : `O combo "${comboToggle.nome}" volta a aparecer no Orçamento e na Prescrição.`
          : undefined}
        acaoLabel={comboToggle?.ativo ? 'Inativar' : 'Ativar'}
        onConfirmar={toggleCombo}
        onFechar={() => setComboToggle(null)}
      />
    </PageContainer>
  );
}
