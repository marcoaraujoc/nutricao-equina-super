// frontend/src/components/ResponsavelTrocado.tsx
// QUEM RESPONDE PELO REGISTRO — e todos que já responderam antes.
//
// POR QUÊ: assumir (ou transferir) só troca o responsável. Da tela, o atendimento
// simplesmente aparece com outro nome — sem dizer que houve troca nem por quantas
// mãos passou. Quem procura "o atendimento da Marina" não o encontra mais, e nada
// explica.
//
// FORMA (a pedido): TODOS os anteriores riscados, em ordem cronológica, um do lado do
// outro preenchendo a largura da célula; o responsável atual embaixo, inteiro.
//
//   Marco criou → Cláudio assumiu → Marina assumiu → Cláudio assumiu de novo
//   M̶a̶r̶c̶o̶ ̶A̶r̶a̶ú̶j̶o̶  C̶l̶á̶u̶d̶i̶o̶ ̶A̶r̶a̶u̶j̶o̶c̶  m̶a̶r̶i̶n̶a̶
//   Claudio Araujoc
//
// 🔴 QUEM JÁ RESPONDEU E VOLTOU APARECE DE NOVO, inclusive quando é o responsável
// ATUAL. A cadeia guarda PASSAGENS, não pessoas distintas: no exemplo acima o Cláudio
// ocupa duas — a que ele perdeu para a Marina (riscada) e a de agora (em pé). Filtrar
// os elos iguais ao atual apagava a primeira e fazia a lista contar uma história que
// não aconteceu (era o defeito relatado em 2026-09-06).
//
// ⚠️ Sem nome (profissional removido do sistema) o elo é DESCARTADO: riscar um espaço
// em branco não informa nada e sugere um dado que o sistema não tem.
// ⚠️ Repetido em SEQUÊNCIA é colapsado — isso NÃO é uma passagem a mais, é a mesma
// troca carimbada por dois caminhos. `lib/cadeiaResponsaveis.js` já evita gravar
// assim; aqui é a rede de segurança para o que foi gravado antes dela.
// ⚠️ O colapso compara por ID quando ele existe: dois profissionais HOMÔNIMOS na
// mesma clínica são duas pessoas, e comparar por nome faria a passagem de um sumir.

export interface EloResponsavel {
  id?:       number | null;
  fullName:  string | null;
}

interface Props {
  /** Nome de quem responde AGORA. */
  atual?:      string | null;
  /** Todos os anteriores, do mais antigo ao mais recente. */
  anteriores?: EloResponsavel[];
  /** Classe do nome ATUAL — cada tela tem o seu tamanho de fonte. */
  className?:  string;
  /** O que dizer quando não há responsável nenhum. */
  vazio?:      string;
}

export default function ResponsavelTrocado({
  atual, anteriores = [], className = 'text-xs font-medium text-gray-800', vazio = '—',
}: Props) {
  const nomeAtual = atual?.trim() || null;

  const cadeia = anteriores
    .map(e => ({ id: e.id ?? null, nome: e.fullName?.trim() || null }))
    .filter((e): e is { id: number | null; nome: string } => !!e.nome)
    .filter((e, i, todos) => {
      const anterior = todos[i - 1];
      if (!anterior) return true;
      // Mesmo id = mesma pessoa; sem id dos dois lados, o nome é o que resta.
      return e.id != null && anterior.id != null ? e.id !== anterior.id : e.nome !== anterior.nome;
    });

  if (cadeia.length === 0) return <span className={className}>{nomeAtual ?? vazio}</span>;

  return (
    // `inline-block`: a célula pode ter um rótulo antes ("Vet: ") e um `block` o
    // empurraria para a linha de cima, sozinho.
    <span className="inline-block align-top"
      title={`Passou por ${cadeia.map(e => e.nome).join(' → ')} — agora com ${nomeAtual ?? 'ninguém'}`}>
      {/* `flex-wrap`: a cadeia cresce a cada troca e precisa poder ocupar a largura
          toda da célula, quebrando em mais linhas — cortar com "…" esconderia
          justamente os nomes mais antigos, que é o que a pessoa veio procurar. */}
      <span className="flex flex-wrap gap-x-1.5 gap-y-0 leading-tight">
        {cadeia.map((e, i) => (
          <span key={`${e.id ?? e.nome}-${i}`} className="text-[10px] text-gray-400 line-through">{e.nome}</span>
        ))}
      </span>
      <span className={`block ${className}`}>{nomeAtual ?? vazio}</span>
    </span>
  );
}
