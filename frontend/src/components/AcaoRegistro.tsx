// src/components/AcaoRegistro.tsx
// Ação de um registro clínico (Alterar, Visualizar, Imprimir, WhatsApp, E-mail,
// Executar, Cancelar…) declarada UMA vez e apresentada de DUAS formas, decididas
// por CSS — sem media query em JS, sem duplicar o bloco de ações:
//
//   ≥ md (desktop) → só o ÍCONE, pintado, como na tabela do Atendimento
//   < md (mobile)  → BOTÃO com rótulo (pílula com borda), como no card do Atendimento
//
// POR QUÊ: o padrão "ícone no desktop / pílula com rótulo no mobile" estava COPIADO
// em Evolução, Prescrição, Vacina, Exames e Encaminhamento — duas vezes em cada tela
// (uma na tabela, outra no card). Dez cópias da mesma ação divergem na primeira
// correção: foi assim que ícone ficou sem rótulo no mobile, cor trocada e ação
// faltando em uma tela só. Aqui a ação é declarada uma vez e as duas formas nascem
// juntas, por construção.
//
// ⚠️ O componente funciona nos DOIS lugares sem prop nenhuma: dentro do bloco
// `hidden md:block` (tabela) a pílula já está escondida pelo pai; dentro do
// `md:hidden` (card) quem some é o ícone. Em tela nova, que não duplica a lista,
// basta declarar a ação uma vez — ela se adapta sozinha.
//
// ⚠️ Sem rótulo visível no desktop, quem dá nome ao botão é `aria-label` + `title`
// (leitor de tela e hover) — por isso `rotulo` é obrigatório e nunca opcional.
//
// ⚠️ Ação SEM permissão não se renderiza (`visivel={false}` → null), nunca aparece
// cinza ou desabilitada: cinza é reservado ao INDISPONÍVEL, e botão que só falha
// depois do clique é o antipadrão da armadilha 28-d do CLAUDE.md.
//
// ORDEM CANÔNICA na linha (CLAUDE.md §6) — a ação que some por falta de permissão
// NÃO reordena as outras:
//   Alterar → Visualizar → Finalizar/Executar → Imprimir → WhatsApp → E-mail → Cancelar
//
// USO
//   <AcoesRegistro>
//     <AcaoRegistro tom="alterar"  icone={Pencil}       rotulo="Alterar"    visivel={podeEditar} onClick={...} />
//     <AcaoRegistro tom="ver"      icone={Eye}          rotulo="Visualizar" onClick={...} />
//     <AcaoRegistro tom="imprimir" icone={Printer}      rotulo="Imprimir"   visivel={podeImprimir} carregando={imprimindo} onClick={...} />
//     <AcaoRegistro tom="cancelar" icone={Ban}          rotulo="Cancelar"   visivel={cancelavel} onClick={...} />
//   </AcoesRegistro>

import type { ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

/** Significado da ação — é ele que escolhe a cor (CLAUDE.md §6: cinza = indisponível,
 *  então toda ação disponível nasce PINTADA). Alterar tem cor própria (laranja) e não
 *  divide o emerald com "ver": são as duas ações mais clicadas da linha e, com a mesma
 *  cor, a pessoa erra qual está apertando. */
export type TomAcao =
  | 'alterar' | 'ver' | 'finalizar' | 'executar' | 'assumir' | 'aprovar'
  | 'imprimir' | 'whatsapp' | 'email' | 'ativar' | 'cancelar' | 'neutro';

// Classes LITERAIS (o Tailwind varre o texto do arquivo — cor montada por
// interpolação não entra no CSS gerado). A borda só aparece no mobile: no desktop
// ela vira transparente, o que remove o traço sem mudar a caixa do botão.
const TONS: Record<TomAcao, string> = {
  alterar:   'text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200',
  ver:       'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200',
  finalizar: 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200',
  executar:  'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200',
  assumir:   'text-teal-600 hover:text-teal-700 hover:bg-teal-50 border-teal-200',
  aprovar:   'text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200',
  imprimir:  'text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200',
  whatsapp:  'text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200',
  email:     'text-blue-500 hover:text-blue-600 hover:bg-blue-50 border-blue-200',
  // Ativar/inativar é uma CHAVE, não uma ação destrutiva — azul, e o ícone
  // (ToggleRight/ToggleLeft) é que diz em que posição ela está.
  ativar:    'text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-gray-200',
  cancelar:  'text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200',
  neutro:    'text-gray-600 hover:text-gray-800 hover:bg-gray-100 border-gray-200',
};

interface Props {
  /** Nome da ação. Vira o texto da pílula no mobile e o nome acessível no desktop. */
  rotulo:        string;
  /** O componente do ícone (`Pencil`), NÃO um elemento (`<Pencil />`) — o tamanho é
   *  resolvido aqui para acompanhar o breakpoint. */
  icone:         LucideIcon;
  onClick:       () => void;
  tom?:          TomAcao;
  /** `false` NÃO renderiza (regra: ação sem permissão não existe na tela). */
  visivel?:      boolean;
  desabilitado?: boolean;
  /** Troca o ícone pelo spinner e bloqueia o clique. */
  carregando?:   boolean;
  /** Tooltip, quando precisa dizer mais que o rótulo ("Assumir a evolução de X"). */
  titulo?:       string;
  className?:    string;
}

export default function AcaoRegistro({
  rotulo, icone: Icone, onClick, tom = 'neutro',
  visivel = true, desabilitado = false, carregando = false, titulo, className = '',
}: Props) {
  if (!visivel) return null;
  const Icon = carregando ? Loader2 : Icone;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado || carregando}
      title={titulo ?? rotulo}
      aria-label={rotulo}
      className={
        'inline-flex items-center gap-1 rounded-lg border transition-colors ' +
        'px-2.5 py-1 text-xs font-medium ' +                       // mobile: pílula
        'md:gap-0 md:px-1.5 md:py-1.5 md:border-transparent ' +    // desktop: só o ícone
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        `${TONS[tom]} ${className}`
      }
    >
      {/* w/h em classe vencem o width/height que o lucide escreve no <svg>, então o
          ícone acompanha o breakpoint sem precisar de dois elementos. */}
      <Icon
        className={`flex-shrink-0 w-3 h-3 md:w-[15px] md:h-[15px] ${carregando ? 'animate-spin' : ''}`}
      />
      <span className="md:hidden">{rotulo}</span>
    </button>
  );
}

/** Linha de ações: pílulas que QUEBRAM em várias linhas no mobile, ícones lado a lado
 *  e SEMPRE NA MESMA LINHA no desktop (`md:flex-nowrap`).
 *
 *  ⚠️ O `md:flex-nowrap` NÃO é cosmético — é o que faz a coluna "Ações" existir na
 *  tabela. Com `flex-wrap`, a largura MÍNIMA do contêiner é a de UM ícone; a `<table
 *  className="w-full">` então espreme a coluna até isso e as 8 ações da evolução saem
 *  empilhadas, uma por linha. Não adianta `whitespace-nowrap` no `<td>`: aquilo governa
 *  quebra de TEXTO, não de item flex. Quem precisa de largura é o contêiner flex.
 *
 *  ⚠️ A quebra continua valendo abaixo de `md`, que é onde ela serve para alguma coisa:
 *  ali a ação é uma PÍLULA COM RÓTULO e várias não cabem lado a lado. De `md` para cima
 *  o rótulo já está escondido (`md:hidden` no `<span>`), então cada ação ocupa ~27px —
 *  as 8 juntas cabem em ~230px, inclusive no card de um celular DEITADO (≥768px), que
 *  era a preocupação registrada aqui antes de o rótulo passar a sumir no `md`. */
export function AcoesRegistro({ children, className = '' }: {
  children:   ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-1 md:justify-center ${className}`}>
      {children}
    </div>
  );
}
