---
paths:
  - "**/*Estoque*"
  - "**/*Medicamento*"
  - "**/*Produto*"
  - "**/*Farmacia*"
  - "**/produtoFornecedor.js"
  - "**/formaCalculo.*"
  - "**/unidadeMedicamento.js"
  - "**/catalogoEmpresa.js"
  - "**/formaCobrancaEstoque.js"
  - "**/*Lote*"
  - "**/*NotaFiscal*"
  - "**/*Multidose*"
  - "**/faturaUtils.js"
---

# Histórico de decisões — Estoque, produtos e unidades

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---
# Atualizado em: 2026-09-23 (parte 2) (🔴 **A FATURA MOSTRAVA "QTD. 1 · R$ 200,00" PARA
#   DUAS AMPOLAS DE R$ 100,00** — defeito relatado. O valor fechava, a QUANTIDADE mentia.
#
#   CAUSA: `debitarEstoqueDia` devolve em `precos` o **TOTAL** do que foi debitado na
#   execução, e a linha da fatura saía com `quantidade: 1` sempre que o item não fosse
#   entrega por embalagem (`embalagensEntregues` só é preenchido nesse caso). Numa receita
#   de "2 Un." o estoque baixava 2, o valor da dose vinha 200 e a linha dizia
#   "Quant.: 1 · R$ 200,00" — sem nenhum jeito de conferir o unitário contra a nota.
#
#   AGORA a quantidade da linha é **`qtdFaturada`**, em três casos, nesta ordem:
#     1. entrega por EMBALAGEM → as que ESTA execução abriu (como já era desde 2026-09-19);
#     2. unidade AVULSA ('Un.', ampola, comprimido) → as unidades debitadas  ← o defeito;
#     3. multidose (mL/g) ou sem estoque cadastrado → **1**, que é "uma dose", como sempre.
#   E `valor` é SEMPRE `valorDaDose / qtdFaturada`: com a quantidade certa e o TOTAL no
#   `valor`, a fatura multiplicaria de novo o que já saiu multiplicado.
#
#   ⚠️ **O MULTIDOSE FICA DE FORA DE PROPÓSITO.** Lá a linha conta DOSES — a descrição é
#   literalmente "5 mL × 3x ao dia (1 dose)" e a consolidação soma uma por aplicação.
#   Trocar a quantidade para 5 passaria a exibir um R$/mL onde a tela sempre mostrou o
#   preço da DOSE, e mudaria o sentido de toda linha de prescrição já faturada. O sinal
#   que separa os dois casos é `ehAvulsa(unidadeEstoque)`, resolvido dentro de
#   `debitarEstoqueDia` (que é quem sabe o que de fato saiu do estoque) e devolvido no mapa
#   novo **`unidadesFaturadas`**, chaveado por `item.id`.
#
#   ⚠️ A mesma correção vale na **FINALIZAÇÃO** — o item que a clínica FORNECE e o
#   proprietário APLICA em casa (`incluirDoProprietario`), que nunca chega ao plantão e é
#   cobrado ali. O cliente leva as 14 ampolas do curso, e "Quant.: 1" ao lado do valor de
#   14 não é conferível. Ali a ordem é `entregas ?? unidadesFaturadas ?? 1`.
#
#   ⚠️ A **conta a pagar do fornecedor** já estava certa: ela usa
#   `resolverQtdExecucao(item)` fora da entrega por embalagem, isto é, a quantidade da
#   dose. Nada mudou nela.
#
#   Gate: `__tests__/produtoMultidose.test.js` (o bloco de `qtdFaturada`) e
#   `__tests__/cicloPagamentoEFatura.test.js`. O resto desta leva é do FINANCEIRO — o
#   ciclo da fatura e o "fechado é somente leitura" estão em
#   `.claude/rules/hist-financeiro.md`, mesma data.)

---


# Atualizado em: 2026-09-23 (parte 2) (🔴 **CADASTRO > PRODUTOS GANHOU PAGINAÇÃO** —
#   medicamentos e vacinas. O que havia era só um TETO (`take: 300`): o que passasse
#   dele não tinha caminho de tela NENHUM, e o único recurso oferecido era o aviso
#   "refine a busca" — que não serve a quem quer justamente PERCORRER o catálogo.
#   `GET /cadastro/produtos` passou a aceitar `pagina`/`porPagina` (padrão 20, teto
#   100) e a devolver `pagina`, `porPagina` e `totalPaginas` junto do `total`.
#   ⚠️ **O teto por página CONTINUA existindo, e não é cosmético**: o catálogo GLOBAL
#   tem milhares de linhas e baixá-lo inteiro a cada abertura é uma tela que demora a
#   aparecer. O que mudou é que o resto passou a ter para onde ir.
#   ⚠️ **Quem CLAMPA a página é o BACKEND**, contra o total — e por isso o `count` roda
#   ANTES do `findMany`, em vez de em paralelo. Inativar o último item da última página
#   deixaria a tela pedindo uma página que não existe mais e recebendo lista vazia, sem
#   erro e sem log. O estado da tela é ESPELHO do que voltou, nunca a autoridade.
#   ⚠️ **Trocar de tipo, buscar ou mudar o filtro volta para a página 1** — sem isso,
#   digitar uma busca estando na página 4 devolve lista vazia e parece "não encontrou
#   nada". O `setPagina(1)` é declarado ANTES do efeito de carga, para chegar a tempo
#   de cancelar o debounce de 300ms.
#   ⚠️ A ordenação segue sendo do BANCO (`empresaId asc, nome asc` — o da clínica antes
#   do global): ordenar só a página recebida deixaria o item da clínica fora dela.
#   ⚠️ A contagem ("Mostrando 21–40 de 137") fica VISÍVEL mesmo com uma página só — é
#   ela que diz que a lista acabou de verdade. Os botões são CROMO de navegação, não
#   ação de registro, e por isso não passam por `AcaoRegistro` (§6).
#   Gate: `__tests__/produtoMultidose.test.js` (o teste do corte trocou `take: LIMITE`
#   por `take: porPagina` e ganhou o par `skip`/clamp).)

# Atualizado em: 2026-09-23 (Entrada de estoque de VACINA: **Fornecedor e Nota Fiscal
#   subiram para logo abaixo do campo "Vacina *"**, a pedido.
#   Os dois campos ja existiam (migration `20261006000000`, gravados pela tela desde
#   2026-09-19), mas ficavam no FIM do formulario — depois de validade, quantidades,
#   unidade, minimo e alarmante. Quem lanca a entrada le a NOTA de cima para baixo: de
#   quem veio e qual NF vem primeiro, os dados do frasco depois.
#   ⚠️ Nada mudou no comportamento: o fornecedor segue OPCIONAL (sem ele a entrada
#   acontece, so nao gera CONTA A PAGAR) e a gravacao e a mesma.
#   ⚠️ Ver tambem a parte 3 de `hist-atendimento.md` desta data: o 400 `Lote sem saldo
#   disponivel` saiu de `registrar`/`atualizar` da vacina clinica — a trava de VALIDADE
#   ficou.)

---

# Atualizado em: 2026-09-22 (parte 2) (🔴 **A REGRA DAS N EMBALAGENS ESTAVA INTEIRA E
#   DORMENTE** — e o histórico da prescrição passou a dizer O QUE foi prescrito.
#   O pedido chegou repetido ("frasco de 100 mL, 5 doses de 25 mL: informar dois
#   frascos e lançar dois na fatura"), e a apuração mostrou por quê: o CÓDIGO de
#   2026-09-19 (parte 4) está certo, testado e passando — o que faltava era o DADO.
#   1. 🔴 **MEDIDO NA BASE: 8.277 itens de catálogo, ZERO sem multidose com
#      `doses_por_embalagem` preenchido.** `embalagensPara` devolve 1 quando o conteúdo
#      é nulo — comportamento correto para quem não declara nada, e falha SILENCIOSA
#      quando a receita está escrita em unidade de CONTEÚDO ("25 mL") contra um estoque
#      contado em EMBALAGENS. Itens reais da base nesse estado: "Banamine® - frasco
#      50 mL" (un=mL, saldo 2), "Imizol® Injetável - frasco 15 mL", "NGF-5 - bisnaga
#      20 g". Todos debitavam e faturavam o curso inteiro como UMA embalagem.
#      ⚠️ **NÃO HÁ DE ONDE DERIVAR O NÚMERO**: `tb_estoque_clinica.peso_por_embalagem`
#      também está nulo em todos eles (só os 11 multidose o têm), e o conteúdo no NOME
#      do produto é texto livre. Quem declara é o cadastro, e ponto.
#      🔴 Por isso a tela passou a PEDIR o dado: faixa ÂMBAR no formulário da prescrição
#      (`faltaConteudoDaEmbalagem`) dizendo que o curso sairá como 1 embalagem e
#      apontando o campo "Conteúdo da embalagem" em Cadastro › Produtos.
#      ⚠️ É o NEGATIVO de `embalagensDoCurso`, com as MESMAS guardas — os dois nunca
#      aparecem juntos. Relaxar uma delas faz o aviso surgir no multidose (cobrança
#      proporcional, sem embalagem inteira a contar) ou na receita já escrita em "2 Un.".
#      ⚠️ **AVISO, nunca bloqueio**: prescrever não pode depender de alguém arrumar o
#      cadastro do produto. Item digitado à mão (sem produto) segue fora — ali não há
#      cadastro a consultar.
#   2. 🔴 **O NÚMERO DE EMBALAGENS SAIU DO FORMULÁRIO E FOI PARA O ITEM.** A faixa azul
#      de 19/09 só existia enquanto se digitava: inserido o item, o número sumia, e o
#      documento SALVO, o FINALIZADO e a visualização em somente-leitura não o diziam em
#      lugar nenhum — justamente onde o vet confere antes de finalizar e onde alguém
#      pergunta "por que a fatura cobrou dois frascos?". Agora cada `ItemRow` de
#      MEDICAMENTO traz o selo `<Package> 2 embalagens`, com a conta inteira no `title`.
#      🔴 **FONTE ÚNICA**: a conta virou a função de módulo `embalagensDoCurso`, que o
#      formulário CHAMA (`embalagensForm`) e cada item também. Duas contas divergem na
#      primeira correção, e a divergência aparece como a tela prometendo um número que a
#      fatura não cobra. Gate travando **uma única** chamada de `embalagensParaQtd`.
#      ⚠️ A `unidade` entra por PARÂMETRO: no formulário é a travada pelo catálogo, no
#      item é o SNAPSHOT dele. Ler sempre a do catálogo faria um item antigo ser medido
#      pela unidade de hoje.
#      ⚠️ O produto do item vem de `allMeds` (catálogo COMPLETO) antes de `medicamentos`
#      (a lista FILTRADA pela busca) — só esta última faria o selo piscar a cada tecla.
#      O catálogo é carregado no mount SEM depender de `canEdit`, então a visualização
#      em somente-leitura também encontra o produto.
#   3. **O HISTÓRICO DE PRESCRIÇÕES DIZ O NOME DO QUE FOI PRESCRITO** (a pedido, "no
#      mobile e tablet"). A lista mostrava "#001 · 2 itens · 1M 1P" e nada mais.
#      ⚠️ **O TABLET É A RAZÃO DE A TABELA ENTRAR JUNTO**: o card só vale abaixo de
#      `md` (768px) e daí para cima — iPad inclusive — quem responde é a TABELA. Mexer
#      só no card deixaria o tablet como estava. Card: o nome virou a linha principal,
#      acima do responsável e da data. Tabela: sob a contagem da célula "Tipo / Itens",
#      com `max-w-[220px]` + `break-words` para nome comprido não esticar a coluna e
#      espremer as Ações. `nomesDosItens` é UMA função para as duas.
#   **NENHUMA MIGRATION** — nada de schema mudou; `prisma migrate status` confirma
#   "Database schema is up to date" (205 migrations).
#   Suíte: **1322** (+3 describes, 9 casos em `__tests__/produtoMultidose.test.js`);
#   `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ✅ **Verificado que REPROVA**: removidos o selo de um dos dois `ItemRow` e o nome do
#   card mobile, **3 casos falharam**.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-22 (parte 2) — o dado que faltava, e o histórico que não dizia o quê

> **NENHUMA MIGRATION.** Suíte: **1322**; `tsc --noEmit` (backend), `tsc -b` e
> `vite build` limpos. NÃO verificado em navegador.

- [x] 🔴 **Apurado que a regra estava dormente por falta de DADO, não de código** — item
      1 do topo. A consulta foi feita DENTRO de `prisma.$transaction` com
      `set_config('app.plataforma','on',true)`: fora dela o FORCE RLS devolveria 0
      linhas com sucesso (armadilha 42), e a conclusão seria o oposto da verdade.
- [x] 🔴 **Faixa âmbar pedindo o "Conteúdo da embalagem"** quando o produto não o
      declara e a receita está em unidade de conteúdo (item 1).
- [x] 🔴 **Selo de embalagens em cada item do documento**, com a conta virando função
      única de módulo (item 2).
- [x] **Nome do medicamento/procedimento no histórico**, no card e na tabela (item 3).
- [ ] **A folha IMPRESSA da prescrição não traz o número de embalagens.** Ela é o
      documento que vai ao cliente e a decisão de colocá-lo ali não foi pedida — o
      número é informação de estoque/fatura, não de posologia.
- [ ] **O aviso âmbar não aparece para item DIGITADO À MÃO** (fora do catálogo): sem
      produto não há conteúdo a declarar nem estoque a debitar. Mesmo limite da unidade
      travada, registrado em 19/09.
- [ ] **Os itens da base seguem sem conteúdo declarado.** Nada foi preenchido por
      conta própria: o número é afirmação do cadastro da clínica, e chutá-lo a partir do
      NOME do produto ("frasco 50 mL") mudaria a cobrança de 8.277 linhas sem ninguém
      ter decidido isso. O aviso é o caminho para a clínica preencher item a item.

---

# Atualizado em: 2026-09-19 (parte 4) (🔴 **O CURSO QUE NÃO CABE NUM FRASCO PASSOU A
#   CONSUMIR (E COBRAR) OS FRASCOS QUE PRECISA** + a fatura ficou legível. Leva de 5
#   pedidos; o que mais importa saber ao voltar:
#   1. 🔴 **A POSOLOGIA SAIU DA DESCRIÇÃO DO ITEM DE FATURA** (a pedido) —
#      `descricaoItemFatura` devolve só `item.medicamento`. ⚠️ **ISTO INVERTE a decisão
#      de 2026-09-17**, e o efeito NÃO é cosmético: a posologia fazia parte da CHAVE de
#      consolidação (tipo, descrição, animal, valor unitário), então o mesmo remédio
#      12/12h num atendimento e 8/8h em outro virava DUAS linhas — agora vira UMA:
#      ```
#      antes : Amoxicilina — 10mL × 12/12h   Quant.: 3
#              Amoxicilina — 10mL × 8/8h     Quant.: 2
#      agora : Amoxicilina                   Quant.: 5
#      ```
#      A razão da regra antiga ("a linha afirmaria uma posologia que metade das doses
#      não teve") CAI justamente porque a linha não afirma mais posologia nenhuma. O
#      detalhe de cada aplicação continua inteiro na OBSERVAÇÃO (`faturaItemOrigens`):
#      número, data e quantidade, uma linha por execução.
#      ⚠️ O VALOR UNITÁRIO continua na chave e é ele que separa o que precisa ser
#      separado — doses de tamanhos diferentes têm preços diferentes.
#      ⚠️ A interpolação de `debitarEstoqueDia` (o MOTIVO do movimento de estoque) segue
#      com a posologia e deve seguir: ali ela descreve o que saiu da prateleira.
#      Caso de teste INVERTIDO em `faturaOrigensConsolidadas` + gate por STRING LITERAL.
#   2. **O ITEM DA FATURA NASCE CONTRAÍDO** (a pedido), com chevron. Contraído: tipo,
#      descrição e total. Expandido: data, Quant., unitário, desconto, o Nº do
#      atendimento e a observação das origens.
#      ⚠️ O estado vive na LINHA, nunca na fatura: um controle único no cabeçalho jogaria
#      fora o que a pessoa expandiu para conferir.
#      ⚠️ O chevron é CROMO (cinza, fora do `AcaoRegistro`) — ele não altera registro
#      nenhum. Sem rótulo visível, `aria-expanded` + `title` são obrigatórios.
#   3. **PAGAMENTOS: a coluna Animal virou Qtd.** ⚠️ O animal SÓ saiu da aba FORNECEDOR
#      (foi o pedido): a conta do fornecedor é uma COMPRA, e o paciente não tem papel
#      nela. Na aba PRESTADOR ele FICA — lá o animal é o serviço em si ("o ferrageamento
#      do Thor") e tirá-lo deixaria a linha sem dizer sobre quem ele trabalhou. A Qtd
#      entra nas DUAS. ⚠️ A folha IMPRESSA não foi tocada (ela já trazia as duas colunas
#      e é documento que vai ao credor).
#   4. **ESTOQUE (Farmácia): coluna Qtd Produto** = `qtdEmbalagens`, o MESMO campo que o
#      formulário de entrada chama assim. ⚠️ É o que foi COMPRADO, não o saldo: não desce
#      com o consumo. Quem responde "quanto ainda tenho" é a coluna Estoque ao lado, na
#      unidade OPERATIVA — num multidose as duas dizem coisas diferentes de propósito
#      (3 frascos comprados × 55 mL restantes).
#   5. 🔴 **O CURSO PASSOU A CONSUMIR N EMBALAGENS, NÃO UMA** — o pedido: "foi comprado
#      um frasco de 100 mL mas foi receitado 5 doses de 25 mL: é preciso na prescrição
#      informar que serão usados dois frascos e lançar na fatura os dois frascos".
#      ⚠️ **VALE SÓ PARA O PRODUTO SEM MULTIDOSE** (decisão do usuário). No multidose a
#      sobra do frasco volta para a prateleira e a cobrança segue PROPORCIONAL —
#      arredondar ali cobraria um frasco inteiro de cada paciente que recebesse uma dose.
#      a. 🔴 **O CADASTRO PASSOU A DECLARAR O CONTEÚDO SEM MULTIDOSE.** Era o dado que
#         faltava: `qtdPorEmbalagemDe` exige `multidose === true`, e o formulário LIMPAVA
#         os campos ao desmarcar — o sistema não tinha como saber os 100 mL. Campo novo
#         **"Conteúdo da embalagem"** (em `FormProduto`), na UNIDADE do produto.
#         🔴 **SEM MIGRATION**: reusa `tb_medicamentos.doses_por_embalagem`, que já existe
#         e é nulável. O número passou a ter significado nos DOIS estados —
#         multidose ON: conteúdo na FORMA DE CÁLCULO (muda a unidade operativa);
#         multidose OFF: conteúdo na UNIDADE do produto (não muda unidade nenhuma).
#         ⚠️ `conteudoDaEmbalagem` é DELIBERADAMENTE separada de `qtdPorEmbalagemDe`, e as
#         duas nunca respondem juntas: se a nova entrasse em `unidadeOperativa`, todo
#         produto que declarasse o conteúdo viraria multidose por acidente e a cobrança
#         voltaria a ser proporcional. Há teste travando que a unidade segue 'Un.'.
#         ⚠️ `gravarMultidose` parou de zerar o número ao desmarcar (só a FORMA é
#         limpa) — zerá-lo apagaria o cadastro no primeiro salvar. A razão original de
#         limpar ("o item voltar a ser multidose sozinho") continua coberta por
#         `qtdPorEmbalagemDe`, que exige a flag. MESMA mudança em `MedicamentoController`
#         (o cadastro rápido do atendimento), senão os dois caminhos divergiriam.
#         ⚠️ Trocar o checkbox LIMPA o número NA TELA: ele muda de UNIDADE junto, e
#         reaproveitá-lo afirmaria um conteúdo que ninguém declarou.
#      b. 🔴 **A BAIXA É ACUMULADA, NÃO POR DOSE** (`embalagensDaExecucao`, função PURA
#         e exportada). Compara quantas embalagens o curso já tinha abertas com quantas
#         passa a ter, e entrega a diferença:
#         ```
#         frasco 100 mL · 5 doses de 25 mL
#           dose 1  acum  25 -> 1 aberta (antes 0)  entrega 1
#           doses 2-4                               entrega 0
#           dose 5  acum 125 -> 2 abertas (antes 1) entrega 1   CURSO: 2 frascos
#         ```
#         ⚠️ É isto que faz o curso INTERROMPIDO não cobrar frasco que ninguém abriu. A
#         alternativa (cobrar `ceil(curso inteiro)` na 1ª dose) deixaria dois frascos
#         cobrados numa prescrição cancelada na segunda aplicação — há caso de teste
#         guardando exatamente isso.
#         ⚠️ **O LEGADO NÃO TEM CONTADOR**: `dosesExecutadas` só é incrementado no fluxo
#         POR DOSE (`elegivelParaFluxoNovo`). Sem a perna `item.executadoEm && doses === 0`,
#         um item legado já executado cai na conta com "nada consumido" e volta a debitar
#         e cobrar uma embalagem A CADA execução — o defeito de 2026-09-17 de volta.
#         ⚠️ `embalagensPara` tem piso 1 (é a entrega única de quem não declara conteúdo),
#         então o "antes" da 1ª dose é 0 EXPLÍCITO — senão a primeira entrega sairia
#         1 − 1 = 0 e o item nunca seria debitado nem cobrado.
#      c. ⚠️ **QUANTIDADE E VALOR UNITÁRIO ANDAM JUNTOS na linha da fatura**, nas DUAS
#         pontas (execução e finalização): `quantidade` = embalagens entregues e `valor`
#         = o TOTAL debitado ÷ elas. Mexer num sem o outro DOBRA (ou divide) a cobrança,
#         e nada acusa. Gate travando o par nos dois lugares.
#      d. **Reserva e as TRÊS verificações passaram a dimensionar o CURSO em embalagens**
#         (`qtdNaUnidadeEstoque(item, unidade, conteudo)`): reservar 1 deixaria o segundo
#         frasco livre para outra prescrição e a última dose bateria num saldo que alguém
#         já levou. A conta a pagar do fornecedor conta as mesmas embalagens.
#      e. **A PRESCRIÇÃO INFORMA** (faixa azul sob a linha de frequência/duração): "o
#         curso inteiro usa 125 mL — com 100 mL por embalagem, serão necessárias 2
#         embalagens". ⚠️ É ESPELHO do backend (`embalagensParaQtd` × `embalagensPara`),
#         não uma segunda regra — divergir faria a tela prometer um número que a fatura
#         não cobra. Some quando a receita está na própria unidade da embalagem ("2 Un."),
#         onde o número já É a quantidade de embalagens.
#      f. ⚠️ **A VACINA NÃO ENTRA e não precisou entrar**: ela conta DOSES por lote
#         (`tb_lotes_vacina.doses_por_frasco`), e o frasco de dose única nasce com 1 — a
#         aplicação já consome e cobra o frasco inteiro. 🔴 MAS `dosesDoCatalogo` usa
#         `doses_por_embalagem` como padrão do lote: sem o filtro `multidose = true` que
#         ela JÁ tem, um frasco de vacina nasceria com "100 doses" e cada aplicação
#         custaria um centésimo dele. Gate novo travando o filtro.
#   **NENHUMA MIGRATION** — a coluna do conteúdo já existia e é nulável; conteúdo em
#   branco mantém o comportamento de toda base atual (1 embalagem por curso).
#   Gate ampliado `__tests__/produtoMultidose.test.js` (**65 casos**, +14, com a
#   sequência do caso relatado EXECUTANDO a função pura).
#   ✅ **Verificado que REPROVA**: devolvidas a entrega única e a cobrança do curso
#   inteiro na 1ª dose, **5 casos falharam**; devolvido `quantidade: 1` nas duas pontas
#   da fatura, **2**. Suíte: **1208**; `tsc --noEmit` (backend), `tsc -b` e `vite build`
#   limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-19 (parte 4) — O curso que não cabe num frasco; a fatura legível

> **NENHUMA MIGRATION.** O conteúdo da embalagem reusa `tb_medicamentos.doses_por_embalagem`,
> que já existe, é nulável e estava vazia para todo produto sem multidose. Suíte: **1208**;
> `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos. NÃO verificado em navegador.

- [x] 🔴 **A posologia saiu da descrição do item de fatura** — ver o item 1 no topo. O
      que ela guardava (frequências diferentes em linhas diferentes) some junto, e é
      consequência aceita: a linha passou a ser o PRODUTO, e a observação das origens
      continua dizendo número, data e quantidade de cada aplicação.
      ⚠️ O caso de teste de 2026-09-17 foi **INVERTIDO** (com o motivo no comentário) e
      ganhou um gate por STRING LITERAL — regex sobre o corpo da função passaria por
      causa de um comentário que citasse `item.frequencia`.
- [x] **O item da fatura nasce contraído**, com chevron — itens 2 do topo.
- [x] **Pagamentos: Animal → Qtd.**, com o Animal preservado na aba PRESTADOR (item 3).
- [x] **Estoque: coluna Qtd Produto** (item 4), no desktop e no card mobile.
- [x] 🔴 **O curso passou a consumir N embalagens** (item 5 do topo, com as seis
      armadilhas). O desenho, em uma linha: o cadastro declara o conteúdo → a prescrição
      informa quantas embalagens o curso gasta → a baixa entrega uma de cada vez,
      conforme o frasco aberto acaba → a fatura e a conta a pagar contam as mesmas.
- [ ] **O aviso da prescrição não aparece para item DIGITADO À MÃO** (fora do catálogo):
      ali não há produto, logo não há conteúdo declarado. É o mesmo limite da unidade
      travada — sem cadastro, não há estoque nem preço a casar.
- [ ] **Prescrição já FINALIZADA antes desta leva** mantém a reserva de UMA embalagem: a
      reserva é criada em `finalizar` e não é recalculada por esta mudança. Na execução a
      baixa já conta certo (ela lê o conteúdo na hora), então o efeito é só a reserva
      ficar menor que o consumo real até o curso terminar. Reabrir e refinalizar o grupo
      recria a reserva pelo número novo (`recalcularReservasDoGrupo`).
- [ ] **A ordem por Qtd Produto** (Farmácia) trata entrada avulsa como ZERO, não como
      vazio: o comparador manda o vazio para o fim nos dois sentidos, e a linha sem
      embalagem declarada ficaria separada do resto sem motivo. Se incomodar, o lugar é
      o `case 'qtdProduto'` do extrator.
- [ ] **A folha impressa da conta a pagar** (`ContaPagarPrint`) continua com a coluna
      Animal nas duas abas. É documento que vai ao credor, e removê-la de lá é decisão
      à parte da tela.

---

# Atualizado em: 2026-09-18 (parte 3) (🔴 **A RECEITA VOLTOU A SER ESCRITA NA UNIDADE
#   DO PRODUTO — e a EMBALAGEM passou a ser entregue UMA VEZ** (a pedido).
#   1. 🔴 **O CAMPO DOSAGEM DEIXOU DE SAIR EM 'Un.'.** Desde 2026-09-17 o produto SEM
#      multidose era prescrito em 'Un.' — o veterinário escrevia "0,1 frasco" onde
#      queria escrever "5 mL". Agora:
#      **multidose → a Forma de Cálculo; sem multidose → a Unidade do cadastro do
#      Produto** (`lib/formaCalculo.unidadePrescricao` + espelho
#      `utils/formaCalculo.unidadePrescricaoProduto`).
#      ⚠️ **A unidade da RECEITA e a do ESTOQUE passaram a DIVERGIR de propósito** no
#      não-multidose (receita 'mL' × estoque 'Un.'). A regra de 17/09 exigia que as
#      três respostas fossem a MESMA, e resolvia no lugar errado um defeito real (o
#      frasco "1 Un." em que 5 mL debitavam CINCO frascos). Quem responde pela baixa
#      agora é a PONTE do item 2 — sem ela isto seria o defeito de volta.
#      ⚠️ A Farmácia continua rotulando o SALDO por `unidadeOperativaProduto` ('Un.'):
#      é em embalagens que ele é contado, e trocar uma pela outra faz a tela afirmar
#      um saldo que o sistema não tem.
#   2. 🔴 **A PONTE: prescrição em CONTEÚDO contra estoque em EMBALAGENS consome UMA
#      embalagem, no CURSO INTEIRO** (`entregaPorEmbalagem`). Sem multidose o produto
#      não declara quanto cabe no frasco — é o que "não é multidose" significa —, e não
#      existe conversão possível. O que existe é o fato: a clínica ENTREGA o frasco,
#      uma vez.
#      ```
#      Xarope 50 mL, R$ 60,00 o frasco · receita 5 mL 1x/dia por 10 dias
#        estoque : −1 frasco (na 1ª execução)      fatura : 1 × R$ 60,00
#      ```
#      ⚠️ **DUAS INVERSÕES em dois dias — não voltar a nenhuma das anteriores:**
#      até 17/09 valor BRUTO (20 mL tiravam 20 frascos de um saldo de 2); em 17/09
#      1 por APLICAÇÃO (o exemplo acima cobrava DEZ frascos); agora 1 por CURSO.
#      ⚠️ Quem garante o "uma vez" é a guarda de `item.executadoEm` em
#      `debitarEstoqueDia`, que devolve `jaEntregues`/`porEmbalagem`; `executar` PULA
#      a linha da fatura e a conta a pagar do fornecedor desses itens — mas a dose
#      continua sendo marcada como executada, e a seringa/agulha continuam sendo
#      lançadas (cada aplicação usa um insumo novo).
#      ⚠️ **Receita em 'Un.' NÃO entra na regra**: ali o vet prescreveu EMBALAGENS, e
#      2 por dia por 5 dias são 10 de verdade. É a diferença entre a ampola prescrita
#      por unidade e o frasco prescrito pelo conteúdo — e é por isso que o produto
#      aplicado dose a dose pela clínica deve ser MULTIDOSE (declarando o conteúdo) ou
#      prescrito em 'Un.'. CONSEQUÊNCIA ACEITA: ampola cadastrada em 'mL' e aplicada
#      10 dias seguidos cobra UMA ampola.
#      ⚠️ A dosagem SAIU da assinatura de `qtdDoEstoque` — ela só servia para contar
#      aplicações, e a regra deixou de contar aplicações.
#   3. **MULTIDOSE não mudou**: estoque e fatura seguem PROPORCIONAIS ao prescrito, a
#      cada execução (5 doses de R$ 33,33 = R$ 166,67, conferido ao vivo).
#   4. 🔴 **A ENTREGA AO PROPRIETÁRIO PASSOU A TER PREÇO — e a debitar estoque.** O
#      item que a clínica FORNECE e o proprietário APLICA ia à fatura com valor
#      **ZERO** (a "LACUNA CONHECIDA" registrada aqui desde 2026-08-01): o preço nasce
#      do LOTE debitado e ele nunca era executado, então não havia lote. Debitar não é
#      efeito colateral do preço, é o fato — o frasco saiu da prateleira quando o
#      cliente o levou. `debitarEstoqueDia` ganhou `incluirDoProprietario` (OPT-IN, só
#      a finalização usa) e a quantidade é a do **CURSO INTEIRO**: 1 embalagem no
#      não-multidose, o proporcional no multidose.
#      ⚠️ `criarReservas` CONTINUA pulando esse item: ele é debitado no mesmo instante,
#      e reservar + debitar o mesmo frasco o contaria duas vezes.
#      ⚠️ `verificarDisponibilidade` passou a CONSIDERÁ-LO — finalizar sem o frasco na
#      prateleira agora alerta (409 com "forçar"), em vez de debitar em silêncio.
#   5. **EXECUÇÃO DE PRESCRIÇÃO MOSTRA O PRESCRITO** (a pedido): "5 mL", e não mais
#      "20 mL · 1 Un. por aplicação". A quantidade de EMBALAGENS virou assunto da
#      SEPARAÇÃO — e no checklist de farmácia do Painel Principal o item cuja embalagem
#      JÁ foi entregue **sai da lista** (`jaEntregue`), senão ela pediria um frasco por
#      dia durante dez dias.
#   **NENHUMA MIGRATION** — nada de schema mudou (`migrate status`: 203, banco em dia).
#   Gate ampliado `__tests__/produtoMultidose.test.js` (51 casos, +5; os da regra
#   anterior foram INVERTIDOS, como o de `faturaConsolidacao` em 17/09).
#   ✅ **Verificado que REPROVA**: devolvida a divisão por aplicação, removida a guarda
#   da fatura e revertida a unidade da receita, **4 casos falharam**; e, numa segunda
#   sabotagem (front voltando à unidade do estoque + entrega do proprietário em zero),
#   **2**. Suíte: **1140**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
#   ✅ **CONFERIDO AO VIVO** com o CÓDIGO REAL contra a base, em transação REVERTIDA:
#   os 13 produtos com estoque devolvem receita = unidade do catálogo e estoque = 'Un.'
#   (multidose: as duas na forma); e `debitarEstoqueDia` no frasco de 250 mL tirou
#   **1 embalagem e cobrou R$ 10,00** na 1ª execução, **nada** na 2ª — e o mesmo item
#   como entrega ao proprietário, que antes ia a zero, saiu por R$ 10,00.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-18 (parte 3) — A receita na unidade do produto; a embalagem entregue uma vez

> **SEM MIGRATION.** Nenhuma coluna nova: a mudança é de REGRA, sobre colunas que já
> existem (`tb_medicamentos.unidade`, `multidose`, `forma_calculo`).
> `migrate status` conferido: **203 migrations, "Database schema is up to date!"**.

- [x] 🔴 **O PEDIDO, e por que ele contraria a regra de 2026-09-17.** Aquela sessão fez
      o produto SEM multidose ser medido em `'Un.'` nos TRÊS lugares (receita, estoque,
      fatura) para matar um defeito real — o frasco cadastrado como "1 Un." em que uma
      dose de 5 mL debitava CINCO frascos. O preço foi o veterinário passar a escrever a
      receita em embalagens: "0,1 frasco de xarope", que não é como ninguém prescreve.
      Agora a receita volta à unidade do PRODUTO e a baixa ganha regra própria.
- [x] **Duas unidades, com nomes distintos e uma função para cada** — back
      `lib/formaCalculo.js` (`unidadeOperativa` = ESTOQUE, `unidadePrescricao` = RECEITA)
      e front `utils/formaCalculo.ts` (`unidadeOperativaProduto` × `unidadePrescricaoProduto`):
      ```
                         RECEITA (campo Dosagem)      ESTOQUE (saldo, baixa)
      multidose          forma de cálculo             forma de cálculo      (coincidem)
      não-multidose      Unidade do cadastro          'Un.'                 (DIVERGEM)
      legado sem forma   unidade do catálogo          unidade do catálogo   (coincidem)
      ```
      ⚠️ A divergência é o ponto da mudança, não um descuido. Quem trocar uma pela outra
      não quebra nada visível: a tela só passa a mostrar a unidade errada — e ela vira o
      SNAPSHOT da receita. Há gate travando cada tela na sua (`SubModuloPrescricao` na da
      receita, `Farmacia` na do estoque).
- [x] 🔴 **A PONTE — `entregaPorEmbalagem(unidadePrescrita, unidadeEstoque)`.** Verdadeira
      quando o estoque é avulso e a receita está em outra unidade (mL, g, %, UI…). Nesse
      caso `qtdDoEstoque` devolve **1**: a embalagem inteira, uma vez no curso.
      ⚠️ **Histórico das inversões, para não voltar a nenhuma:**
      ```
      até 2026-09-17 : valor BRUTO      20 mL tiravam 20 frascos de um saldo de 2
      2026-09-17     : 1 por APLICAÇÃO  10 dias de 5 mL cobravam DEZ frascos
      2026-09-18     : 1 por CURSO      um frasco, entregue na 1ª execução
      ```
      ⚠️ **Receita em 'Un.' fica FORA** (e as grafias 'un'/'unidade' também): ali o vet
      prescreveu EMBALAGENS, e 2 por dia por 5 dias são 10. Unidade VAZIA idem — sem
      rótulo, "2" já se lê como 2 unidades.
      ⚠️ **A dosagem SAIU da assinatura** de `qtdDoEstoque`. Ela existia para contar
      aplicações (`qtdPrescrita / dose`), e a regra deixou de contar aplicações; um 4º
      argumento reaparecendo ali é sinal de que alguém reintroduziu a divisão. Gate
      explícito.
- [x] 🔴 **O "uma vez" é garantido em `debitarEstoqueDia`, não no cálculo.** A quantidade
      é sempre 1; quem impede a repetição é a guarda de `item.executadoEm` — que reflete
      o estado ANTES desta execução, porque a marcação acontece depois, em `executar`.
      A função passou a devolver `{ precos, unidades, jaEntregues, porEmbalagem }`.
      ⚠️ A guarda roda **ANTES de buscar o estoque**: item sem estoque cadastrado é
      lançado com valor 0 "para o financeiro saber", e sem isso ele voltaria a somar
      quantidade na linha a cada dose de um frasco já entregue.
      ⚠️ Em `executar`, `jaEntregues` pula **a linha da fatura e a conta a pagar do
      fornecedor** — e só isso. A dose continua sendo marcada como executada (a aplicação
      aconteceu) e a seringa/agulha continuam sendo lançadas: cada aplicação usa um
      insumo novo. Receber os conjuntos e ignorá-los é o modo silencioso de a regra
      deixar de existir, então há gate para o uso deles.
      ⚠️ A RESERVA acompanha de graça: `qtdNaUnidadeEstoque` passa pelo mesmo
      `qtdDoEstoque` e reserva 1 embalagem — um frasco basta para o curso.
- [x] **CONSEQUÊNCIA ACEITA, registrada porque é o custo da escolha:** ampola cadastrada
      em 'mL' (sem multidose) e aplicada pela clínica dez dias seguidos passa a cobrar
      UMA ampola. Para esse caso o produto tem de ser MULTIDOSE (declarando o conteúdo)
      ou a receita tem de ser escrita em 'Un.'. As duas saídas existem no cadastro.
- [x] 🔴 **A ENTREGA AO PROPRIETÁRIO DEIXOU DE IR A ZERO** — fecha a "LACUNA CONHECIDA"
      documentada aqui desde 2026-08-01. O item que a clínica FORNECE e o proprietário
      APLICA nunca chega ao plantão, e a finalização é a única chance de cobrá-lo; até
      aqui ele ia com `valor: 0` porque o preço nasce do LOTE debitado e não havia lote.
      `debitarEstoqueDia` ganhou **`incluirDoProprietario`** (OPT-IN — na execução o item
      continua fora, porque lá nem chega) e é chamada no `finalizar` com
      `calcularQuantidadeTotal`: o cliente leva o CURSO INTEIRO.
      ⚠️ `criarReservas` CONTINUA pulando esse item, e tem de continuar: ele é debitado no
      mesmo instante, e reservar + debitar o mesmo frasco o contaria duas vezes.
      ⚠️ `verificarDisponibilidade` passou a incluí-lo — finalizar sem o frasco na
      prateleira alerta (409, com "forçar"), em vez de debitar em silêncio.
      ⚠️ Continua caindo em 0 quando o medicamento não tem estoque cadastrado: zero ali é
      "ninguém disse quanto vale", nunca um palpite.
- [x] **Execução mostra o PRESCRITO** (a pedido) — `dosagemNaTela` devolve "5 mL", e o
      "· 1 Un. por aplicação" de 17/09 saiu. A contagem de embalagens virou assunto da
      SEPARAÇÃO: `doseDoEstoque` ganhou `jaEntregue`, e o checklist de farmácia do Painel
      Principal PULA o item já entregue — senão pediria um frasco por dia durante dez.
      ⚠️ Item legado SEM unidade na receita ainda cai na do estoque: número solto não diz
      o que significa.
- [x] Gate `__tests__/produtoMultidose.test.js` em **51 casos** (+5). Os da regra anterior
      foram **INVERTIDOS** (mesmo precedente de `faturaConsolidacao` em 17/09) e a seção 7
      foi reescrita com o histórico das duas inversões no cabeçalho.
      ⚠️ A varredura das telas usa `semComentarios`: sem isso ela reprova os PRÓPRIOS
      comentários que documentam a regra citando o texto antigo — foi o que aconteceu na
      primeira escrita deste gate.
      ✅ **Verificado que REPROVA**: devolvida a divisão por aplicação, removida a guarda
      da fatura e revertida a unidade da receita → **4 casos falharam**; front voltando à
      unidade do estoque + entrega do proprietário em zero → **2**. Suíte: **1140**;
      `tsc --noEmit`, `tsc -b` e `vite build` limpos.
- [x] ✅ **CONFERIDO AO VIVO** com o CÓDIGO REAL, em transação REVERTIDA: os 13 produtos
      com estoque devolvem receita = unidade do catálogo e estoque = 'Un.' (no multidose
      as duas caem na forma); `debitarEstoqueDia` no frasco de 250 mL tirou **1 embalagem
      e cobrou R$ 10,00** na 1ª execução e **nada** na 2ª; o multidose tirou **5 doses e
      cobrou R$ 166,67** a cada execução (proporcional); e o mesmo item como ENTREGA AO
      PROPRIETÁRIO, que antes ia a zero, saiu por **R$ 10,00** — sem a flag, o item nem é
      olhado.
      ⚠️ `debitarEstoqueDia` passou a ser EXPORTADA para poder ser exercitada de verdade:
      é ela que decide, de uma vez, quanto sai do estoque e quanto vai à fatura.
- [ ] A descrição da linha da fatura continua sendo a POSOLOGIA (`Xarope — 5 mL × 1xDia`)
      enquanto a quantidade cobrada é 1 embalagem. Não é erro — a posologia é o que
      identifica o item —, mas quem lê a fatura vê "5 mL" ao lado de "Quant.: 1". Se
      incomodar, o lugar é `descricaoItemFatura`.
- [ ] Item LEGADO cujo produto virou multidose depois (receita em 'mL' contra estoque em
      'doses') continua caindo no valor BRUTO: 'doses' não é a unidade avulsa, então a
      ponte não se aplica. Medido na base (item #241: 26 mL × 3 dias → 78 doses). É
      pré-existente e não foi tocado; item NOVO daquele produto já nasce em 'doses'.

---

# Atualizado em: 2026-09-17 (parte 2) (🔴 **VALOR COMPRADO E VALOR REPASSADO PASSARAM A
#   SER POR EMBALAGEM** — a tela de estoque deixou de multiplicá-los pela quantidade,
#   a pedido.
#   1. 🔴 **O DEFEITO ERA MUDO, e é por isso que ele durou:** a Farmácia multiplicava os
#      dois valores pela Qtd Produto antes de gravar e `calcPrecoUnitarioBase` dividia
#      pelo SALDO. As duas contas **se cancelavam**, então o preço da dose saía CERTO e
#      nenhuma tela acusava — mas o BANCO guardava o total da compra em colunas
#      rotuladas "Valor Unitário". Quem lia a coluna CRUA cobrava a compra inteira numa
#      linha só:
#      ```
#      antes : caixa de 100 seringas por R$ 100  ->  valor_repassado = 100 (o total)
#              debitarInsumoUnidade lança `valorRepassado` por UMA seringa -> R$ 100
#      agora : valor_repassado = 1,00 (a embalagem) e o preço vem de precoUnitarioBase
#      ```
#   2. **A CONTA MUDOU DE DIVISOR, não de resultado.** `calcPrecoUnitarioBase` recebia
#      (valor TOTAL, saldo inteiro) e passou a receber **(valor de UMA embalagem, o que
#      ela CONTÉM)** — o mesmo modelo que a vacina já usa
#      (`valorUnitarioRepassado ÷ dosesPorFrasco`):
#      ```
#      frasco de 20 mL por R$ 100   -> 100 ÷ 20      = R$ 5,00/mL
#      embalagem avulsa por R$ 30   -> 30  ÷ 1       = R$ 30,00/Un.
#      embalagem de 1 kg por R$ 100 -> 100 ÷ 1.000 g = R$ 0,10/g
#      ```
#      ⚠️ Conteúdo `null`/0 vale **1** (a embalagem é a própria unidade), nunca "sem
#      dado". ⚠️ **O SALDO SAIU DA CONTA**: dar baixa ou ajustar o estoque não mexe mais
#      no preço — era esse acoplamento que fazia o caminho legado subir o preço a cada
#      dose aplicada.
#   3. 🔴 **TRÊS LEITORES DA COLUNA CRUA FORAM CORRIGIDOS**, porque com o valor unitário
#      eles mudavam de significado: `debitarInsumoUnidade` (agora usa
#      `precoUnitarioBase` — é o preço de UMA unidade, não o da caixa),
#      `precoUnitarioDoEstoque` (o fallback legado divide pelo CONTEÚDO, não pelo saldo)
#      e `valorItemEstoque` do relatório (multiplica pelo saldo). E a conta do preço que
#      estava ESCRITA DUAS VEZES em `PrescricaoGrupoController` virou chamada única a
#      `precoUnitarioDoEstoque` — o que divergiria ali é o valor cobrado do cliente.
#   4. ⚠️ **A CONSOLIDAÇÃO DEIXOU DE SOMAR OS VALORES.** Entrada idêntica (mesmo lote,
#      validade e valor por embalagem) só SOMA a quantidade: somar valores dobraria o
#      preço da embalagem a cada reentrada do mesmo lote.
#   5. **O RÓTULO FICOU ÚNICO** — "Valor Unitário" / "Valor Unitário Cobrado" na criação
#      E na edição. Enquanto a edição dizia "Valor Total", ela trazia o total para um
#      campo unitário e salvar de novo o multiplicava **outra vez**.
#   6. OK **MIGRATION APLICADA** (autorizada) —
#      `20261014000000_estoque_valor_por_embalagem`: `valor` e `valor_repassado` ÷
#      `qtd_embalagens` (só onde há mais de uma). **NÃO toca `preco_unitario_base`** (é
#      ele que a fatura cobra e ele já está certo), nem o saldo, nem os movimentos.
#      Conferido DEPOIS: as 8 linhas com mais de uma embalagem reexpressas (id 43:
#      R$ 500 -> R$ 83,33, com a fração preservada), a de 1 embalagem intocada, e os
#      **9 preços IDÊNTICOS** ao retrato de antes. `migrate status`: 202, banco em dia.
#      **Sem mudança de schema, logo sem `prisma generate`.**
#      ⚠️ As INATIVAS ENTRAM, ao contrário do backfill de `20261013000000`: lá mudava o
#      SALDO (histórico na unidade em que aconteceu); aqui muda o SIGNIFICADO da coluna.
#      ⚠️ `set_config('app.plataforma','on',true)` obrigatório (armadilha 42).
#   OK **CONFERIDO AO VIVO** com o código REAL contra as 9 entradas da base: `valor
#   repassado ÷ qtd_embalagens` reproduz o `preco_unitario_base` gravado em **9 de 9**,
#   inclusive na multidose (R$ 100 o frasco ÷ 20 mL = R$ 5,00/mL) e nas inativas — ou
#   seja, **nenhuma cobrança muda**.
#   Gate novo `__tests__/estoqueValorPorEmbalagem.test.js` (21 casos).
#   OK **Verificado que REPROVA**: devolvidas a multiplicação da tela e a divisão pelo
#   saldo, **2 casos falharam**. Suíte: **1073**; `tsc --noEmit`, `tsc -b` e `vite build`
#   limpos.
#   **SIDEBAR:** Estoque subiu para logo abaixo de Execução de Prescrição e acima de
#   Documentos (a pedido) — quem aplica a dose é quem vê o saldo acabar.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão. Ver §12.)
---

### Sessão 2026-09-17 (parte 2) — Valor Comprado e Valor Repassado passam a ser POR EMBALAGEM

> ✅ **MIGRATION APLICADA** (autorizada nesta sessão) —
> `20261014000000_estoque_valor_por_embalagem`. É backfill de DADOS, não de schema:
> reexpressa `valor` e `valor_repassado` de TOTAL DA COMPRA para VALOR DE UMA EMBALAGEM
> (`÷ qtd_embalagens`, só onde há mais de uma). Rodada com o DONO
> (`DATABASE_URL_MIGRATIONS`). `migrate status` depois: **202 migrations, banco em dia**.
> **Sem mudança de schema, logo sem `prisma generate`.**
>
> ✅ **MEDIDO ANTES E DEPOIS, linha a linha** (as 9 entradas desta base):
> ```
>        valor        valor_repassado      preco_unitario_base
> id 30  200 -> 100    200 ->  100          100  (intacto)
> id 34  200 -> 100    200 ->  100            2  (intacto, conteúdo 50)
> id 35  300 ->  30    300 ->   30           30  (intacto)
> id 36  300 ->  30    480 ->   48           48  (intacto)
> id 37  600 ->  30   1080 ->   54           54  (intacto)
> id 38  200 ->  20    540 ->   54           54  (intacto)
> id 39  100 -> 100    100 ->  100            5  (INTOCADO: 1 embalagem)
> id 42  350 ->  50    420 ->   60           60  (intacto)
> id 43  500 -> 83,33  750 ->  125          125  (intacto — a fração é preservada)
> ```
> **Os 9 preços ficaram IDÊNTICOS** — nenhuma cobrança mudou, que era a garantia. E o
> código REAL (`calcPrecoUnitarioBase`) recalculado a partir do que ficou gravado
> reproduz os 9 preços: reeditar qualquer entrada hoje não altera a fatura de ninguém.

- [x] 🔴 **O DEFEITO ERA MUDO — as duas contas se cancelavam.** A tela de Farmácia
      multiplicava `valor` e `valorRepassado` pela Qtd Produto antes de gravar
      (`nPacotes`), e `calcPrecoUnitarioBase` dividia pelo SALDO inteiro. Resultado: o
      preço da dose saía CERTO, nada acusava na tela, e o BANCO ficava com o total da
      compra em colunas rotuladas "Valor Unitário". O erro só aparecia em quem lia a
      coluna CRUA:
      ```
      caixa de 100 seringas por R$ 100  ->  valor_repassado = 100 (o total)
      debitarInsumoUnidade lança `valorRepassado` como preço de UMA seringa -> R$ 100
      ```
      A clínica cobrava a caixa inteira do cliente por uma seringa, e a fatura não tinha
      como denunciar isso — o número era plausível.
- [x] **A CONTA MUDOU DE DIVISOR, NÃO DE RESULTADO.** `calcPrecoUnitarioBase` recebia
      `(valor TOTAL, quantidade em estoque, unidade)` e passou a receber
      **`(valor de UMA embalagem, o CONTEÚDO dela, unidade)`**:
      ```
      frasco de 20 mL por R$ 100    -> 100 ÷ 20      = R$ 5,00/mL
      embalagem avulsa por R$ 30    -> 30  ÷ 1       = R$ 30,00/Un.
      embalagem de 1 kg por R$ 100  -> 100 ÷ 1.000 g = R$ 0,10/g
      ```
      É o MESMO modelo que a vacina já usa desde sempre
      (`LoteVacina.valorUnitarioRepassado ÷ dosesPorFrasco`) — a Farmácia era a exceção.
      ⚠️ **Conteúdo `null`/0 vale 1**, e isso não é "campo vazio": é o não-multidose, em
      que a embalagem É a própria unidade. Devolver `null` ali jogaria a cobrança no
      caminho legado (`precoUnitarioDoEstoque`), que é justamente o que sobe o preço a
      cada dose aplicada.
      ⚠️ 🔴 **O SALDO SAIU DA CONTA E DO GATILHO DE RECÁLCULO.** Dar baixa ou corrigir o
      estoque não mexe mais no preço — antes, `atualizar` recalculava quando
      `data.qtdEstoque` mudava, então acertar uma contagem alterava o valor que já tinha
      sido cobrado do cliente.
- [x] 🔴 **TRÊS LEITORES DA COLUNA CRUA MUDAVAM DE SIGNIFICADO E FORAM CORRIGIDOS:**
      - **`debitarInsumoUnidade`** (seringa/agulha na execução) usava `valorRepassado`
        direto como preço de UMA unidade. Passou a preferir `precoUnitarioBase`, que já
        nasce dividido pelo conteúdo; `valorRepassado` fica só como reserva para a
        entrada legada sem preço calculado.
      - **`precoUnitarioDoEstoque`** (fallback legado) dividia por `paraBase(qtdEstoque)`.
        Passou a dividir pelo CONTEÚDO da embalagem — com o valor unitário e o divisor
        antigo, o preço sairia dividido pela quantidade comprada e a clínica cobraria
        centavos.
      - **`valorItemEstoque`** (relatório de Farmácia) devolvia `valorRepassado` cru
        quando não havia `precoUnitarioBase` — isto é, o preço de UMA embalagem como se
        fosse o valor do estoque inteiro. Passou a multiplicar pelo saldo.
- [x] **A CONTA DO PREÇO ESTAVA ESCRITA DUAS VEZES em `PrescricaoGrupoController`** — em
      `precoUnitarioDoEstoque` e, à mão, dentro de `debitarEstoqueDia`. A segunda virou
      chamada da primeira: duas cópias divergiriam na primeira correção, e **o que
      divergiria é o valor cobrado do cliente**.
- [x] ⚠️ **A CONSOLIDAÇÃO DEIXOU DE SOMAR OS VALORES.** Entrada que casa com uma
      existente (mesmo lote, mesma validade, mesmo valor por embalagem dentro de 1%) só
      SOMA `qtdEstoque` e `qtdEmbalagens`. Somar `valor`/`valorRepassado` — que agora são
      POR EMBALAGEM — dobraria o preço da embalagem a cada reentrada do mesmo lote, e com
      ele a linha da fatura.
      ⚠️ O match também parou de dividir por `qtdEmbalagens`: aquela divisão existia só
      para desfazer a multiplicação da tela.
- [x] **RÓTULO ÚNICO nos dois modos** — "Valor Unitário (R$)" e "Valor Unitário Cobrado
      (R$)" na criação E na edição. Enquanto a edição dizia "Valor Total Comprado", ela
      carregava o total num campo unitário e salvar de novo o multiplicava OUTRA VEZ,
      dobrando o valor a cada passagem. A nota "Total: R$ X" continua, agora como
      conferência da nota (cinza, "Total da compra") e valendo também na edição — ela não
      é gravada em lugar nenhum.
- [x] 🔴 **O BACKFILL NÃO MUDA COBRANÇA NENHUMA, e isso foi MEDIDO.**
      `preco_unitario_base` — o número que vira linha de fatura — **não é tocado**: ele
      já é R$/unidade base e continua idêntico. O que se reexpressa é só a unidade em que
      `valor`/`valor_repassado` estão escritos.
      ✅ **CONFERIDO AO VIVO** com o código REAL (`calcPrecoUnitarioBase`) contra as 9
      entradas desta base: `valor_repassado ÷ qtd_embalagens` reproduz o
      `preco_unitario_base` gravado em **9 de 9**, incluindo a MULTIDOSE (id 39: R$ 100 o
      frasco ÷ 20 mL = R$ 5,00/mL) e as INATIVAS (id 34: R$ 100 ÷ 50 = R$ 2,00).
      ⚠️ `qtd_embalagens` NULO ou 1 fica INTOCADO: ali a tela já gravava `nPacotes = 1`,
      então o valor JÁ é o de uma embalagem. Dividir de novo o deixaria menor que o preço
      que a fatura cobra.
      ⚠️ **AS INATIVAS ENTRAM**, ao contrário do backfill de `20261013000000`. Lá o que
      mudava era o SALDO, e o histórico da entrada encerrada tinha de ficar na unidade em
      que aconteceu; aqui muda o SIGNIFICADO de uma coluna — deixar a inativa com o total
      faria a tela exibir o valor errado e, ao reativá-la e salvar, recalcular o preço
      errado.
      ⚠️ `tb_movimentos_estoque` não é tocado: ele registra quantidades, não valores.
- [x] **SIDEBAR: Estoque subiu para logo abaixo de Execução de Prescrição e acima de
      Documentos** (a pedido). Quem aplica a dose é quem vê o saldo acabar, e lá embaixo —
      depois de Exames, Agenda e Financeiro — o caminho do plantão até a reposição
      atravessava o menu inteiro. Só a posição do bloco mudou; permissões, rotas e o
      `activeSection` continuam os mesmos.
- [x] Gate novo `__tests__/estoqueValorPorEmbalagem.test.js` (21 casos): a conta nos três
      formatos de embalagem, o conteúdo nulo que vale 1, e a VARREDURA dos dois lados —
      a tela que não multiplica, a criação que passa o conteúdo, a consolidação que não
      soma valores, a edição que não recalcula por quantidade, o insumo cobrado por
      unidade, o fallback legado, a fonte única do preço na baixa e o que a migration NÃO
      pode tocar.
      ⚠️ O gate da migration IGNORA os comentários `--` do SQL: o cabeçalho explica a
      regra CITANDO as tabelas e colunas que o UPDATE não toca, e sem o filtro ele
      reprovava a própria documentação dele (a mesma lição do gate de e-mail).
      ✅ **Verificado que REPROVA**: devolvidas a multiplicação da tela e a divisão pelo
      saldo, **2 casos falharam**; restaurado, os 21 voltaram.
      Suíte: **1073**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] O **Ajuste de Estoque** e a **entrada em lote** não reinformam o valor da
      embalagem — o que é correto agora (o preço não depende mais do saldo), mas
      significa que corrigir um valor digitado errado continua sendo pela EDIÇÃO da
      entrada, e ela é recusada em item já movimentado. Para esse caso o caminho segue
      sendo inativar a entrada e cadastrar outra.
- [ ] O **Estoque de Vacinas** não foi tocado: ele já gravava `valorUnitario` /
      `valorUnitarioRepassado` por FRASCO, sem multiplicar. Esta leva alinhou a Farmácia
      ao que a vacina já fazia — se um dia a regra mudar, os dois lugares mudam juntos.
- [ ] Entrada LEGADA sem `precoUnitarioBase` (valor zerado na origem) continua caindo no
      `precoUnitarioDoEstoque`. Ele agora divide pelo conteúdo, mas se a linha também não
      tiver `pesoPorEmbalagem` o valor da embalagem é usado como preço unitário — que é o
      correto para o não-multidose e é o único dado que aquela linha tem.

---

# Atualizado em: 2026-09-17 (🔴 **PRODUTO SEM MULTIDOSE E MEDIDO EM 'Un.'** — a
#   embalagem e a propria unidade, a pedido. + a tela de Produtos passou a listar o
#   cadastro DA CLINICA antes do global.
#   1. 🔴 **O DEFEITO, medido:** sem multidose a unidade caia na do CATALOGO, que e a da
#      EMBALAGEM ('g', 'mL', 'kg'), enquanto a entrada de estoque conta EMBALAGENS
#      (Qtd Total = Qtd Produto). Os dois lados usavam o mesmo rotulo para coisas
#      diferentes: uma receita de "20 g" debitava 20 de um saldo de 10 bisnagas e cobrava
#      20 x R$/g. Agora:
#      ```
#      produto : sem multidose        -> Forma de Calculo 'Un.'
#      estoque : Qtd Produto 10       -> Qtd Total 10 Un.   (VR 300 -> R$ 30/Un.)
#      receita : 1 Un.                -> estoque 9 Un.
#      fatura  : 1 x 300 / 10 = R$ 30,00   (valorRepassado / Qtd Produto)
#      ```
#   2. **A regra vale nos CINCO pontos**, como a forma de calculo ja valia:
#      `lib/formaCalculo.unidadeOperativa` (backend) e `utils/formaCalculo.
#      unidadeOperativaProduto` (front) sao a FONTE UNICA; `unidadeDoEstoque` (prescricao)
#      e `unidadeOperativaDoItem` (estoque) caem em **'Un.'** em vez da unidade do
#      catalogo. ⚠️ `UNIDADE_AVULSA` nasce em `lib/unidadeMedicamento.js` e e IMPORTADA,
#      nunca recopiada — 'Un' x 'Un.' descasaria receita e estoque. Gate trava a grafia
#      nos dois lados.
#   3. ⚠️ **A UNIDADE DEIXOU DE SER ENVIADA pela Entrada de Estoque.** O campo e LEITURA e
#      mostra a unidade OPERATIVA; com 'Un.' chegando ao `definirUnidadeDoMedicamento` o
#      copy-on-write trocaria "Frasco"/"g" por "Un." NO CATALOGO. `unidadeParaResolver`
#      devolve `undefined` sempre; quem troca a unidade do produto e /cadastro/produtos.
#   4. 🔴 **SAIU A HEURISTICA `extrairVolume`** da Farmacia: ela lia "frasco 20 mL" do NOME
#      e multiplicava a Qtd Total por um numero que ninguem declarou — e era esse numero
#      que dividia o preco da dose na fatura. Sem multidose, Qtd Total = Qtd Produto.
#   5. ⚠️ **PRESCRICAO: sem subunidade e sem `<select>`** para item do catalogo (a unidade
#      fica travada). `getConversaoUnidade` (mL <-> L, g <-> kg) SAIU — oferecer a troca
#      reintroduz a divergencia que a regra elimina. Item digitado A MAO (fora do
#      catalogo) mantem o seletor: ali nao ha estoque nem preco.
#   6. OK **MIGRATION APLICADA** (autorizada) — `20261013000000_estoque_nao_multidose_em_unidades`:
#      backfill das entradas ATIVAS gravadas no CONTEUDO (as que tinham
#      `peso_por_embalagem`, vindas da heuristica). **3 das 6** linhas ativas estavam
#      assim. Conferido DEPOIS: as 6 com `preco = valorRepassado / Qtd Produto`, saldo em
#      embalagens e `ppe` nulo; a linha MULTIDOSE e as INATIVAS intactas.
#      ⚠️ `set_config('app.plataforma','on',true)` e OBRIGATORIO no backfill: sem ele o
#      UPDATE afeta ZERO linhas, com sucesso e sem aviso (armadilha 42).
#      ⚠️ `tb_movimentos_estoque` NAO e reescrito — registra o que aconteceu, na unidade
#      em que aconteceu. ⚠️ Sem mudanca de schema, logo **sem `prisma generate`**.
#   7. **TELA DE PRODUTOS: o da clinica antes do global** (`orderBy: [{ empresaId: 'asc' },
#      { nome: 'asc' }]`). ⚠️ `asc` e NULLS LAST no Postgres — `desc` inverteria. ⚠️ A
#      ordenacao e do BANCO: o `take` corta em 60/100 sobre milhares de linhas globais, e
#      ordenar so a pagina recebida deixaria o item da clinica FORA dela.
#   8. **VACINA ficou de fora** de proposito (o pedido e da prescricao): ela conta doses
#      por lote (`dosesPorFrasco`) e tem cadeia propria; sem forma declarada segue em
#      "dose(s)".
#   9. 🔴 **A EXECUCAO DA PRESCRICAO TAMBEM FALA EM 'Un.'** (complemento do mesmo dia): a
#      fila exibia `item.unidade` (o SNAPSHOT da receita) e — pior — a baixa lia o numero
#      BRUTO contra o estoque em embalagens. Medido no item 172 real: "20 mL" debitava
#      **20 EMBALAGENS** de um saldo de 2 e cobrava **R$ 2.000** numa dose de R$ 100.
#      `qtdDoEstoque` ganhou a `dosagem` e devolve **1 embalagem por APLICACAO** quando a
#      receita esta em outra unidade; a fila devolve `unidadeEstoque` por item e a tela
#      mostra "20 mL · 1 Un. por aplicacao" (a prescrita e o que quem aplica le; a do
#      estoque e o que sai e e cobrado). ⚠️ Vale para QUALQUER unidade nao-avulsa, nao so
#      mL/g — '%' nao tem grupo e debitava 10 embalagens. ⚠️ A unidade NAO e forcada na
#      gravacao: isso apagaria o sinal de que a receita veio em outra unidade, e um cliente
#      desatualizado passaria a gravar "20 Un.". Painel Principal e importacao de orcamento
#      na mesma regra.
#  10. 🔴 **A FARMACIA ROTULA O SALDO PELA UNIDADE OPERATIVA** (complemento 2, a pedido:
#      "Qtd em Estoque esta aparecendo 5 g e precisa ser a Forma de Calculo"). Vale para o
#      saldo, minimo/alarmante, historico de movimentos e Ajuste de Estoque — uma unidade
#      diferente em qualquer um deles e uma segunda versao da verdade na MESMA tela.
#      🔴 E a verificacao ao vivo achou uma REGRESSAO minha: o **multidose LEGADO** (com
#      quantidade e SEM forma, cadastrado antes da `20261012000000`) tem o estoque contado
#      no CONTEUDO, e 'Un.' fazia 19,9 mL virarem "19,9 unidades" — dose de 5 mL debitaria
#      1 e cobraria R$ 5 no lugar de R$ 25. `unidadeOperativa` passou a conhecer os QUATRO
#      estados do cadastro (forma+qtd -> forma; qtd SEM forma -> unidade da EMBALAGEM;
#      forma SEM qtd -> 'Un.'; nao-multidose -> 'Un.') e virou a FONTE UNICA: prescricao e
#      estoque nao repetem mais a condicao.
#   Gate ampliado `__tests__/produtoMultidose.test.js` (45 casos, +21).
#   OK **Verificado que REPROVA**: revertidas a unidade operativa, a do estoque e a ordem,
#   **4 casos falharam**; e, no complemento, removidas a divisao pela dosagem e a
#   `unidadeEstoque` da fila, **2 casos falharam**; e, no complemento 2, trocado um rotulo
#   do saldo e removido o ramo do legado, **3 casos falharam**. Suite: **1049**;
#   `tsc --noEmit`, `tsc -b` e `vite build` limpos.
#   OK **VERIFICADO AO VIVO** com o codigo REAL: a empresa 58 lista os 4 produtos dela nas
#   posicoes 0-3 e os globais a partir da 4; e as 6 entradas de nao-multidose devolvem
#   'Un.' nos dois lados, baixa de 1 por Un. e fatura = VR / Qtd Produto.
#   ⚠️ NAO verificado em navegador — sem ferramenta de browser nesta sessao. Ver §12.)
---

### Sessao 2026-09-17 - Produto sem multidose e medido em 'Un.' + ordem da tela de Produtos

> OK **MIGRATION APLICADA** (autorizada nesta sessao) —
> `20261013000000_estoque_nao_multidose_em_unidades`. E **backfill de DADOS**, nao de
> schema: reexpressa em EMBALAGENS as entradas ATIVAS de produto nao-multidose que
> estavam gravadas no CONTEUDO. `migrate status`: **201 migrations, banco em dia**.
> **Sem `prisma generate`** — nenhuma coluna mudou.
> ⚠️ Rodada com o DONO (`DATABASE_URL_MIGRATIONS`), e o UPDATE comeca com
> `set_config('app.plataforma','on',true)`: `tb_estoque_clinica` esta com RLS
> ENABLE + FORCE e a policy vale ate para o dono do schema — sem o carimbo o backfill
> afeta ZERO linhas, **com sucesso e sem aviso** (armadilha 42).
> OK **PROVADA ANTES** em transacao REVERTIDA (o antes/depois das 6 linhas, com o
> rollback conferido) e **CONFERIDA DEPOIS** contra a base.

- [x] 🔴 **O DEFEITO: dois rotulos para coisas diferentes.** Sem multidose a unidade caia
      na do CATALOGO — que e a da EMBALAGEM ('g', 'mL', 'kg', 'Frasco') — enquanto a
      entrada de estoque conta EMBALAGENS (Qtd Total = Qtd Produto). A receita era escrita
      no CONTEUDO e a baixa acontecia sobre um saldo de embalagens: "20 g" debitava 20 de
      um saldo de 10 bisnagas e cobrava 20 x R$/g. Nenhum erro na tela — so o saldo e a
      fatura errados. Agora, **sem multidose a Forma de Calculo e 'Un.'**: a embalagem
      entra inteira, e prescrita inteira e e cobrada inteira, por
      `valorRepassado / Qtd Produto`.
- [x] **FONTE UNICA nos dois lados**: `lib/formaCalculo.unidadeOperativa` (backend) e
      `utils/formaCalculo.unidadeOperativaProduto` (front), consumida pela Farmacia e pela
      Prescricao — duas copias divergiriam na primeira correcao, e o que divergiria e a
      unidade em que o estoque e contado.
      ⚠️ `UNIDADE_AVULSA` e IMPORTADA de `lib/unidadeMedicamento.js` (onde nasceu como a
      opcao garantida do seletor do catalogo), nunca recopiada: 'Un' x 'Un.' faz
      `mesmaUnidade` divergir do que a receita escreve. Gate trava a grafia nos dois lados.
      ⚠️ `unidadeOperativaProduto` devolve **`null` para produto AUSENTE** (item digitado
      a mao): ali nao ha estoque nem preco, e a unidade continua sendo escolhida no
      `<select>`. Devolver 'Un.' travaria o campo de um item que nao tem cadastro.
- [x] **`unidadeDoEstoque` (prescricao) perdeu o 3o argumento.** Ele recebia
      `estoques[0].medicamento?.unidade` e caia nela; agora e `forma ?? UNIDADE_AVULSA`.
      ⚠️ `item.unidade` (a unidade GRAVADA na receita) tambem NAO entra: quem decide em
      que o estoque e contado e o PRODUTO, nunca o que foi digitado na prescricao — foi
      essa inversao que deixou receita e estoque falando linguas diferentes. Ha gate
      exigindo `UNIDADE_AVULSA` e reprovando `unidadeCatalogo|item.unidade` no corpo.
- [x] **`calcPrecoUnitarioBase` sai certo sozinho**: 'Un.' nao esta em
      `FATOR_BASE_ESTOQUE`, entao o fator e 1 e o preco e exatamente
      `valorRepassado / qtdEstoque` — que, para o nao-multidose, e a Qtd Produto.
      🔴 Em 'kg'/'L' o fator era 1000: 3 embalagens por R$ 300 gravavam R$ 0,10/g e a
      receita de 1 unidade cobrava dez centavos. Ha caso de teste para esse par.
- [x] 🔴 **A ENTRADA DE ESTOQUE NAO MANDA MAIS A UNIDADE.** O campo virou LEITURA e mostra
      a unidade OPERATIVA; com 'Un.' chegando ao `definirUnidadeDoMedicamento`, o
      copy-on-write trocaria "Frasco"/"g" por "Un." NO CATALOGO e apagaria a distincao
      entre a embalagem e o que esta dentro dela. `unidadeParaResolver` devolve
      `undefined` sempre e `unidade` saiu do destructuring dos dois handlers.
- [x] 🔴 **SAIU A HEURISTICA `extrairVolume`** (Farmacia): ela lia "frasco 20 mL" do NOME
      do produto e preenchia `pesoPorEmbalagem`, multiplicando a Qtd Total por um numero
      que ninguem declarou — e e esse numero que divide o preco da dose na fatura. Era o
      que produzia as linhas legadas que o backfill veio corrigir. O conteudo passa a vir
      SO do cadastro do produto.
      ⚠️ `conteudoEmbalagem` tambem parou de cair no `pesoPorEmbalagem` DA LINHA: na
      edicao de uma entrada legada ele voltava a multiplicar, e a Qtd Total dizia "30 Un."
      para 2 frascos de 15 mL.
- [x] **PRESCRICAO: unidade travada e sem subunidade.** `getConversaoUnidade` (mL <-> L,
      g <-> kg) SAIU: com a unidade decidida pelo produto, oferecer a troca reintroduz
      exatamente a divergencia que a regra elimina. Item FORA do catalogo mantem o
      `<select>` com `UNIDADES` — ali nao ha estoque nem preco a casar.
- [x] **O BACKFILL, linha a linha** (medido antes e conferido depois):

      id 30 Imizol 15 mL    saldo 30 -> 2      preco 6,67 -> 100
      id 36 NGF-5 20 g      saldo 98 -> 4,9    preco 2,40 -> 48    (minimo 3 -> 0,15)
      id 43 Equimax 30 g    saldo 150 -> 5     preco 5,00 -> 150
      ids 35, 38, 42        INTOCADOS (ja contavam embalagens)

      ⚠️ A divisao **preserva a FRACAO**: 98 g de bisnagas de 20 g sao 4,9 bisnagas, e
      arredondar inventaria (ou apagaria) meia embalagem no saldo da clinica.
      ⚠️ O preco sai de `valor_repassado / qtd_embalagens` (o total COMPRADO), nunca do
      saldo restante — dividir pelo que sobrou faz o preco unitario SUBIR a cada dose, que
      e o defeito conhecido do caminho legado de `precoUnitarioDoEstoque`.
      ⚠️ `peso_por_embalagem` vai a NULL: e ele que marca a linha como "contada por
      dentro", e deixa-lo faria a calculadora da tela multiplicar de novo na proxima edicao.
      ⚠️ **So as ATIVAS.** A inativa e historico na unidade antiga — mesma decisao de
      `reapontarParaCopia`. CONSEQUENCIA CONHECIDA: reativar uma delas (ha 2 nesta base)
      exige reinformar a Qtd Produto na tela.
      ⚠️ `tb_movimentos_estoque` NAO e reescrito: ele registra o que aconteceu, na unidade
      em que aconteceu. Adultera-lo trocaria um saldo errado por um historico falso.
- [x] **TELA DE PRODUTOS: o cadastro da CLINICA antes do GLOBAL** —
      `orderBy: [{ empresaId: 'asc' }, { nome: 'asc' }]` em `ProdutoController.listar`.
      ⚠️ `asc` e NULLS LAST no Postgres (o nao-nulo vem primeiro); `desc` inverteria tudo.
      Mesma precedencia de `ordemEmpresaPrimeiro`.
      ⚠️ A ordenacao e do BANCO, nao da pagina recebida: o `take` corta em 60/100 sobre um
      catalogo global de milhares de linhas, e ordenando so o que chegou o item da clinica
      nem entraria na lista quando o nome fosse alfabeticamente tarde.
      ⚠️ Nao precisa do bypass de ADMIN que `ordemEmpresaPrimeiro` tem: aqui
      `escopoDaEmpresa` ja recorta a global + a propria, entao nunca ha varias empresas.
- [x] Gate ampliado `__tests__/produtoMultidose.test.js` (34 casos, +10) — a conta da
      fatura, o par kg x Un., a unidade que nao volta ao catalogo, a entrada que nao
      reescreve a unidade do produto, a grafia unica de 'Un.' e a ordem da tela.
      OK **Verificado que REPROVA**: revertidas a unidade operativa, a do estoque e a
      ordenacao, **4 casos falharam**; restaurado, os 34 voltaram.
      Suite: **1038**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
      OK **VERIFICADO AO VIVO** com o codigo REAL (`ProdutoController.listar`,
      `unidadeDoEstoque`, `calcPrecoUnitarioBase`): a empresa 58 lista os 4 produtos dela
      nas posicoes 0-3 e os globais a partir da 4; e as 6 entradas de nao-multidose
      devolvem 'Un.' nos dois lados, baixa de 1 por Un. e fatura = VR / Qtd Produto.
      ⚠️ NAO verificado em navegador — sem ferramenta de browser nesta sessao.
- [ ] A **VACINA** ficou de fora de proposito (o pedido e da prescricao): ela conta doses
      por LOTE (`LoteVacina.dosesPorFrasco`) e tem cadeia propria de baixa e cobranca; sem
      forma declarada o rotulo segue "dose(s)". Se a mesma regra tiver de valer la, o
      lugar e `VacinaClinicaController.darBaixaEFaturar` + `formaVacina` na tela.
- [ ] Entrada de estoque **INATIVA** de produto nao-multidose continua contada no conteudo
      (2 nesta base). Reativa-la sem reinformar a Qtd Produto devolve o saldo na unidade
      antiga.
- [ ] O modal de **Ajuste de Estoque** ainda oferece a conversao por `pesoPorEmbalagem`
      quando a linha o tem. Depois do backfill nenhuma linha ATIVA de nao-multidose o tem,
      entao ele so aparece para produto multidose — que e onde faz sentido.

#### Complemento (mesma data) — a EXECUCAO tambem fala em 'Un.', e a receita legada parou de cobrar 20 frascos

- [x] 🔴 **O QUE O PEDIDO "a tela de execucao ainda marca a unidade" REVELOU.** A fila do
      plantao exibia `item.unidade` — o SNAPSHOT do que foi escrito na receita. Para item
      gravado ANTES desta leva isso e 'mL'/'g'/'%', enquanto o estoque passou a contar
      'Un.'. **Nao era so exibicao**: `mesmoGrupo('mL','Un.')` e falso, entao a baixa caia
      no valor BRUTO. Medido com o item 172 real da base:
      ```
      receita "20 mL"  ->  debita 20 EMBALAGENS de um saldo de 2
                       ->  fatura R$ 2.000 numa dose cujo frasco custa R$ 100
      ```
      A tela mostrava "20 mL", nada acusava, e o defeito so apareceria na fatura do cliente.
- [x] **A dose vale UMA embalagem por aplicacao** — `qtdDoEstoque` ganhou a `dosagem` como
      4o argumento. Nao ha conversao possivel (o produto nao declara quanto cabe na
      embalagem — e isso que "nao e multidose" significa), mas tambem nao precisa de
      palpite: `qtdPrescrita` ja e dosagem x aplicacoes, entao dividir pela dosagem devolve
      as APLICACOES, e a regra do produto diz que cada uma consome a embalagem inteira.
      20 mL 2x/dia -> 40/20 = 2 embalagens no dia.
      ⚠️ Vale para **QUALQUER unidade que nao seja a avulsa**, nao so mL/g: o item 179 desta
      base esta em **'%'** ("Pasta 10%"), que nao tem grupo de conversao — restringir as
      unidades de conteudo deixava 10 % debitando DEZ embalagens. Ha caso de teste para '%'
      e para 'UI'.
      ⚠️ Unidade VAZIA continua no bruto: sem rotulo, "2" ja se le como 2 unidades.
      ⚠️ Dosagem ausente ou zero tambem: dividir por ela daria Infinity, e um chute ali vira
      quantidade debitada e valor cobrado.
      ⚠️ Item NOVO nao passa por aqui — nasce em 'Un.', que e a propria unidade do estoque.
- [x] **As TRES verificacoes de estoque passaram a comparar na unidade do ESTOQUE.** Elas
      tinham um par `paraBase` + `comparavel` que repetia a regra pela metade: no ramo
      incomparavel comparavam a quantidade CRUA da receita ("20 mL") com o saldo em
      embalagens (2) e acusavam falta do que cabe. Agora e `totalEstoque <
      necessarioEstoque`, com o necessario saindo das MESMAS funcoes da baixa.
- [x] **A fila do plantao devolve `unidadeEstoque` por item**, resolvido pelas mesmas
      `mapaFormaCalculo` + `unidadeDoEstoque` da baixa — recalcular na tela criaria uma
      segunda regra, e e a divergencia entre as duas que o campo existe para eliminar.
- [x] **A tela mostra a unidade que o sistema usa** (`dosagemNaTela`):
      ```
      item novo      ->  "1 Un."
      receita legada ->  "20 mL · 1 Un. por aplicacao"
      ```
      ⚠️ A dosagem PRESCRITA nao e apagada: "20 mL" e o que o veterinario indicou e o que
      quem aplica precisa ler; "1 Un." e o que sai da prateleira e entra na fatura. Trocar
      uma pela outra esconderia metade da verdade — e repetir o numero prescrito ao lado de
      'Un.' ("20 Un.") afirmaria vinte embalagens.
- [x] **O PAINEL PRINCIPAL le a MESMA regra** (`doseDoEstoque`, exportada): a lista de
      separacao de farmacia diz o que TIRAR DA PRATELEIRA, entao precisa falar em
      embalagens quando e assim que o produto e contado.
- [x] 🔴 **A IMPORTACAO DE ORCAMENTO trazia a unidade da EMBALAGEM** e fazia nascer um item
      **NOVO** ja divergente do estoque (o item do orcamento guarda a unidade do catalogo).
      Passou a usar a unidade do PRODUTO. ⚠️ A dosagem continua vazia — quem a digita e o
      vet, ja vendo a unidade travada ao lado. ⚠️ Produto ainda nao carregado na lista (a
      busca e paginada) mantem a unidade do orcamento; o backend protege a conta nesse caso.
- [x] ⚠️ **A unidade NAO e forcada no backend**, de proposito. Carimbar a unidade do produto
      na gravacao destruiria justamente o sinal de que a receita foi escrita em outra — e um
      cliente desatualizado mandando "20" + 'mL' passaria a gravar "20 Un.", isto e, vinte
      embalagens. O front decide (campo travado) e o backend PROTEGE a conta.
- [x] Gate ampliado para **41 casos** (+7). OK **Verificado que REPROVA**: removidas a
      divisao pela dosagem e a `unidadeEstoque` da fila, **2 casos falharam**.
      Suite: **1045**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
      OK **CONFERIDO AO VIVO** com os 5 itens pendentes REAIS da base: todos passaram a
      debitar **1 Un. por aplicacao** e a cobrar o preco da embalagem (R$ 125,00 no unico com
      estoque), contra os 20 Un. / R$ 2.000 de antes.
- [ ] A **VACINA** na mesma tela segue com o rotulo proprio (`rotuloDosagemVacina`, "2
      doses") — ela conta doses por LOTE e ficou fora desta leva, como registrado acima.

#### Complemento 2 (mesma data) — a FARMACIA rotula o saldo pela unidade operativa

- [x] 🔴 **"Qtd em Estoque" mostrava `5 g`** (a pedido) — quantidade + unidade da
      EMBALAGEM. `medicamento.unidade` nao diz em que o saldo esta CONTADO: a entrada de um
      produto sem multidose grava EMBALAGENS, entao "5 g" para 5 bisnagas e o mesmo
      descasamento que a receita e a fatura ja tinham — a tela dizia grama e o sistema
      debitava embalagem. Agora todo numero da tela sai por `unidadeOperativaMed`.
      ⚠️ Vale para o SALDO, os dois alertas (minimo/alarmante), o aviso de estoque ja
      existente no formulario, o HISTORICO de movimentos e o AJUSTE de estoque (rotulo do
      campo, resumo e delta): uma unidade diferente em qualquer um deles e uma segunda
      versao da verdade na MESMA tela. Gate reprova `medicamento.unidade` no arquivo
      inteiro — ignorando comentarios, senao ele acusaria a propria documentacao da regra.
      ⚠️ CONSEQUENCIA CONHECIDA no HISTORICO: movimento gravado ANTES da normalizacao
      (migration `20261013000000`) esta na unidade antiga e aparece sob o rotulo novo.
      `tb_movimentos_estoque` nao e reescrito de proposito — ele registra o que aconteceu —,
      e rotula-lo com a unidade da embalagem estaria igualmente errado e ainda contradiria
      o saldo logo acima.
- [x] 🔴 **REGRESSAO MINHA, ACHADA NA VERIFICACAO AO VIVO: o multidose LEGADO sem forma.**
      Ha cadastro feito entre as migrations `20261009000000` e `20261012000000`, quando
      `doses_por_embalagem` ja existia e `forma_calculo` ainda nao — ele e `multidose` com
      quantidade e SEM forma. O estoque dele foi gravado MULTIPLICANDO pela quantidade, ou
      seja, esta contado no CONTEUDO. Minha regra o jogava em 'Un.', e ai 19,9 mL de frasco
      viravam "19,9 unidades": uma dose de 5 mL debitaria **1** em vez de 5 e cobraria
      **R$ 5** no lugar de R$ 25. Medido: o "17 Beta - 0%, frasco-ampola" desta base esta
      exatamente assim.
      `unidadeOperativa` passou a conhecer os QUATRO estados do cadastro:
      ```
      forma + quantidade        -> a forma declarada        (item medido por dentro)
      quantidade SEM forma      -> a unidade da EMBALAGEM   (LEGADO: contado no conteudo)
      forma SEM quantidade      -> 'Un.'                    (pendencia: nao declara conteudo)
      nao-multidose             -> 'Un.'                    (a embalagem e a unidade)
      ```
      ⚠️ NAO e exceção a regra nova: ela vale para quem NAO e multidose. No legado o produto
      DECLARA conteudo — so nao declara em que, e a unidade da embalagem e a resposta que o
      proprio cadastro deu antes de o campo existir.
- [x] **A regra virou FONTE UNICA de verdade, sem copias.** `mapaFormaCalculo` (prescricao)
      e `formaDeclaradaDoItem` (estoque) repetiam a condicao `multidose && formaCalculo &&
      doses > 0` cada um por si; os dois passaram a chamar `unidadeOperativa`. Para isso
      `catalogoEmpresa.multidosePorItem` passou a trazer tambem a `unidade` do catalogo (e o
      legado precisa dela). O front espelha em `unidadeOperativaProduto`, e ha gate exigindo
      que os quatro estados respondam igual dos dois lados — divergir faz a tela rotular o
      saldo de um jeito e a baixa contar de outro.
- [x] **SEM MIGRATION NOVA**: e exibicao + resolucao de unidade. `migrate status`: 201
      migrations, banco em dia (a normalizacao das entradas legadas ja foi aplicada acima).
- [x] Gate em **45 casos** (+4). OK **Verificado que REPROVA**: trocado UM rotulo do saldo
      pela unidade da embalagem, 2 casos falharam; removido o ramo do legado, 1 falhou.
      Suite: **1049**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
      OK **CONFERIDO AO VIVO** com o `EstoqueController.listar` REAL nas duas empresas:
      o multidose legado segue em **19,9 mL** e os nao-multidose saem em **Un.** (o Imizol
      da empresa 42 em "2 Un.", ja normalizado).
- [ ] A entrada de estoque **INATIVA** do "17 Beta" (id 34, nao-multidose, 100 = 2 × 50 mL)
      aparece na aba Inativos como "100 Un.". E a consequencia ja registrada do backfill so
      alcancar as ATIVAS — reativa-la exige reinformar a Qtd Produto.
- [ ] O selo "Em estoque: N" da busca de medicamento da Prescricao continua SEM unidade.
      Nao afirma nada errado; se um dia precisar do rotulo, a regra e a mesma
      (`unidadeOperativaProduto`).

---

# Atualizado em: 2026-09-16 (parte 2) (🔴 **A EMBALAGEM DEIXOU DE SER A PROPRIA UNIDADE** —
#   o produto passou a declarar QUANTO cabe nela e EM QUE (**Forma de Calculo**).
#   1. 🔴 **O DEFEITO QUE ISSO RESOLVE:** o frasco de 20 mL era cadastrado como "1 Un.".
#      A receita saia em mL, `mesmoGrupo('mL','Un.')` e FALSO e a baixa caia no valor
#      BRUTO: **uma dose de 5 mL debitava 5 FRASCOS e cobrava 5 frascos na fatura**, sem
#      erro nenhum na tela. Agora:
#      ```
#      produto : Forma de Calculo mL, Qtd 20     estoque : Qtd Produto 3 -> Qtd Total 60 mL
#      receita : 5 mL  -> estoque 55 mL          fatura  : 5 x 100 / 20 = R$ 25,00
#      ```
#      OK **VERIFICADO AO VIVO**, em transacao REVERTIDA (0 linhas ao fim): os 14 passos do
#      exemplo acima batem, inclusive a fracao (2,5 mL -> saldo 57,5) no estoque e no lote.
#   2. OK **MIGRATION APLICADA** (autorizada) — `20261012000000_forma_calculo_produto`:
#      `forma_calculo` em `tb_medicamentos` e em `tb_vacinas_clinicas`, e as quantidades
#      de `tb_lotes_vacina`/`tb_reservas_estoque_vacina`/`tb_vacinas_clinicas.quantidade`/
#      `tb_medicamentos.doses_por_embalagem` de INTEGER para **DOUBLE PRECISION**.
#      ⚠️ **`doses_por_embalagem` MUDOU DE SIGNIFICADO**, nao so de tipo: era "N aplicacoes
#      por frasco, desconta 1/N" e passou a ser "a embalagem contem N da forma de calculo".
#      E seguro porque a coluna estava VAZIA — medido: 8.255 medicamentos, ZERO com
#      `multidose` e ZERO com o numero; `tb_estoque_clinica`, `tb_lotes_vacina` e
#      `tb_prescricoes` tambem com 0 linhas. O NOME da coluna ficou (mesmo precedente de
#      `tb_procedimento_combos.valor`) — leia-o sempre por `lib/formaCalculo.js`.
#      ⚠️ INTEGER truncaria 2,5 mL em SILENCIO, e o saldo fecharia errado sem nada acusar.
#      ⚠️ `prisma generate` falhou com EPERM (§11, backend rodando) e **NAO bloqueia**:
#      conferido que o client desatualizado ACEITA a fracao (quem valida escala e o banco).
#   3. 🔴 **A DIVISAO POR DOSES SAIU de `qtdDoEstoque`, e isso e SIMPLIFICACAO.** Com a
#      forma declarada, estoque e receita falam a MESMA unidade: nao ha o que converter nem
#      o que dividir. A fatura sai certa sozinha, porque o valor da linha sempre foi
#      `qtd debitada x preco unitario` e o preco unitario e `embalagem / conteudo`.
#      ⚠️ **`unidadeDoEstoque` tem de valer nos CINCO pontos** (reserva, consumo, baixa e as
#      tres verificacoes): estoque contando numa unidade e receita escrita em outra devolve
#      o mesmo defeito por outro caminho. Ha gate por FUNCAO para cada um — procurar a
#      chamada no arquivo INTEIRO passava com a reserva sabotada (gate frouxo, corrigido).
#      ⚠️ `produtoFornecedor.dosesPorEmbalagemDeMedicamentos` ficou **LEGADA E SEM CHAMADOR**,
#      com a semantica ANTIGA. Religada como esta, dividiria de novo uma dose que ja esta
#      na unidade do estoque — e a linha sairia N vezes menor, em silencio.
#   4. **CADASTRO DE PRODUTO:** saiu a faixa "Este item vem do catalogo do sistema..." (a
#      REGRA do copy-on-write nao mudou — saiu o texto; o selo "do sistema" da LISTA fica);
#      **Unidade . Via . Controlado na MESMA linha**; e o **checkbox "Produto multidose"**
#      voltou a ser explicito, abrindo **Forma de Calculo** (mL, L, g, kg, mcg, mg, doses)
#      + **Qtd**. ⚠️ O numero sozinho deixou de ser a marcacao: sem a unidade ele nao
#      divide preco nenhum. ⚠️ A Qtd e **SEMPRE EDITAVEL**; o que a forma muda e o que ela
#      traz PREENCHIDO — `doses` nunca preenche (rotulo nao traz contagem de aplicacao) e
#      o nome so casa com a medida ESCOLHIDA ("Dipirona 500 mg/mL" + mL -> vazio, porque o
#      500 e massa e oferece-lo como volume poe na embalagem um numero que nao e dela).
#   5. **ESTOQUE (Farmacia):** "N de Embalagens" -> **Qtd Produto**; "Qtd por Embalagem" ->
#      **Qtd Total**, agora **DERIVADA** (Qtd Produto x o conteudo que o produto declara) e
#      a **Unidade virou LEITURA**, herdada do produto. ⚠️ Enquanto ela era escolhida ali,
#      dava para gravar em 'Un.' o estoque de um produto medido em 'mL'. ⚠️ E a entrada
#      **nao reescreve mais a unidade do produto**: com forma declarada, `unidade` nao e
#      enviada ao `definirUnidadeDoMedicamento` — senao o copy-on-write trocaria "Frasco"
#      por "mL" no catalogo e apagaria a distincao entre embalagem e conteudo.
#   6. **PRESCRICAO:** a dosagem e **Valor + Forma de Calculo** (era Valor + Unidade).
#      ⚠️ Com forma declarada NAO ha subunidade a oferecer (mL <-> L): trocar ali
#      reintroduziria a divergencia que a forma veio eliminar.
#   7. 🔴 **VACINA: "QTD DOSES" VIROU "DOSAGEM" (Valor + Forma de Calculo)**, a pedido.
#      ⚠️ **CONSEQUENCIA CLINICA REGISTRADA:** aquele campo declarava o tamanho da SERIE, e
#      `agendarReforcos` criava `qtd - 1` agendamentos de uma vez. Sem ele, o reforco passa
#      a agendar **so a PROXIMA dose** — deduzir a serie de um volume em mL afirmaria um
#      esquema que ninguem prescreveu. Executada a proxima, ela agenda a seguinte.
#      ⚠️ `Math.max(1, ...)` saiu: travava 0,5 mL em 1 mL, dobrando a baixa e a fatura.
#      ⚠️ `forma_calculo` da vacina e **SNAPSHOT** resolvido no SERVIDOR pelo
#      `medicamentoCatId` — mexer no produto nao pode reescrever o que ja foi aplicado.
#   8. Produto **sem** forma de calculo segue no comportamento de sempre (a unidade da
#      embalagem governa) — nenhum cadastro existente muda de cobranca.
#   Gate reescrito `__tests__/produtoMultidose.test.js` (24 casos, semantica NOVA).
#   OK **Verificado que REPROVA**: revertida a divisao por doses e a unidade da reserva,
#   2 casos falharam. Suite: **1028**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
#   ⚠️ NAO verificado em navegador — sem ferramenta de browser nesta sessao. Ver §12.)
---

### Sessao 2026-09-16 (parte 2) - Forma de Calculo: a embalagem e o conteudo dela

> OK **MIGRATION APLICADA** (autorizada nesta sessao) -
> `20261012000000_forma_calculo_produto`, com o DONO (`nutriadmin`): `ALTER TABLE` pede
> OWNERSHIP, nao GRANT. `migrate status`: **200 migrations, banco em dia**. As 10 colunas
> conferidas no `information_schema` depois de aplicar.
> ⚠️ `prisma generate` falhou com **EPERM** (§11 - o backend segurava o query engine) e
> ficou PENDENTE. **NAO bloqueia**: conferido ao vivo que o client desatualizado ACEITA a
> fracao nas colunas alargadas (quem valida escala numerica e o Postgres, nao o Client) -
> mesmo precedente da `20260914000000`. Rodar na proxima parada do backend.

- [x] 🔴 **O DEFEITO, medido:** embalagem e conteudo eram a mesma coisa. Frasco de 20 mL
      cadastrado como "1 Un.", receita em mL -> `mesmoGrupo('mL','Un.')` FALSO -> a baixa
      caia no valor BRUTO: **5 mL debitavam 5 FRASCOS e cobravam 5 frascos**. Sem erro em tela.
- [x] **`lib/formaCalculo.js` + `utils/formaCalculo.ts`** (espelhos) - a lista de formas
      (mL, L, g, kg, mcg, mg, doses), `qtdPorEmbalagemDe` e `unidadeOperativa`.
      ⚠️ Ha gate travando que as **duas listas sejam iguais**: forma aceita so de um lado
      vira cadastro que a tela grava e o servidor descarta em silencio.
      ⚠️ **`qtdPorEmbalagem` NULO NAO E 1**: `null` = "nao declara conteudo" (a embalagem e
      a propria unidade); 1 seria uma AFIRMACAO do cadastro.
- [x] 🔴 **`qtdDoEstoque` perdeu a divisao por doses** - com a forma declarada, receita e
      estoque falam a MESMA unidade e nao ha o que converter. A fatura sai certa sozinha:
      `qtd x preco unitario`, e o preco unitario e `embalagem / conteudo`.
      ⚠️ **`unidadeDoEstoque(formas, item, unidadeCatalogo)` nos CINCO pontos**: reserva,
      consumo, baixa e as tres verificacoes. Faltando num deles, a reserva nasce numa
      unidade que o debito nunca consome e o saldo trava para a clinica inteira.
      ⚠️ `mapaFormaCalculo` vai com o **`tx` da transacao** - o `prisma` global chega sem o
      carimbo de tenant e o RLS devolve ZERO linha em silencio (armadilha de 23/08, parte 4).
- [x] **`EstoqueController`**: o preco base passa pela **unidade OPERATIVA**
      (`unidadeOperativaDoItem`). Com o estoque em litros e o catalogo dizendo "mL", o
      preco sairia mil vezes errado e 2 L virariam 2.000 mL contra um saldo de 6.
      ⚠️ `unidadeParaResolver` impede a entrada de estoque de **reescrever a unidade do
      produto** via copy-on-write quando ele declara forma de calculo.
      ⚠️ `listar` anexa a forma por SQL cru: sem isso, a EDICAO de uma entrada abriria
      dizendo "Frasco" sobre um saldo em mL.
- [x] **Telas**: faixa do catalogo global REMOVIDA do cadastro de produto (a regra fica);
      Unidade/Via/Controlado na mesma linha; checkbox de multidose + Forma de Calculo +
      Qtd; **Qtd Produto** / **Qtd Total** (derivada) / Unidade em leitura na Farmacia;
      dosagem da Prescricao e da Vacina como **Valor + Forma de Calculo**.
      ⚠️ O **modal de cadastro rapido** (`CadastroCatalogoModal`, usado por Prescricao,
      Vacina e Entrada de Estoque) ganhou o MESMO par: sem a forma o backend nao marca o
      item, e o campo de la ficaria inerte - o item nasceria diferente conforme a tela.
- [x] 🔴 **VACINA - a consequencia clinica que precisa ficar registrada:** "Qtd Doses"
      declarava o tamanho da SERIE e `agendarReforcos` criava `quantidade - 1` agendamentos
      de uma vez. Com o campo virando DOSAGEM, ele passa a agendar **so a proxima dose**.
      ⚠️ Nao e regressao disfarcada: deduzir a serie de um volume em mL afirmaria um
      esquema de reforco que ninguem prescreveu. Executada a proxima, ela agenda a seguinte.
      ⚠️ `dosagemDaVacina` substituiu `Math.max(1, ...)`, que travava 0,5 mL em 1 mL.
- [x] OK **VERIFICADO AO VIVO** contra a base, em transacao REVERTIDA (0 linhas ao fim): o
      codigo REAL (`salvarItemDoCatalogo`, `calcPrecoUnitarioBase`, `qtdDoEstoque`) reproduz
      o exemplo inteiro - 60 mL em estoque, R$ 5/mL, baixa de 5 mL -> 55 mL, fatura R$ 25,00 -
      e o banco guarda a fracao (57,5) no estoque e no lote de vacina.
- [x] Gate `__tests__/produtoMultidose.test.js` REESCRITO (24 casos) para a semantica nova.
      OK **Verificado que REPROVA**: 2 casos falharam com a divisao por doses e a unidade da
      reserva revertidas. ⚠️ O gate da reserva nasceu **FROUXO** (procurava a chamada no
      arquivo inteiro, e ela existe em outros tres pontos) e passou com o codigo sabotado -
      foi recortado por FUNCAO. Licao repetida: "a funcao aparece" nao e assercao.
      Suite: **1028**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
      ⚠️ NAO verificado em navegador - sem ferramenta de browser nesta sessao.
- [ ] O **Estoque de Vacinas** (`/estoque-vacina`) ainda pede "doses por frasco" com o
      rotulo antigo; o numero ja vem do catalogo (`dosesDoCatalogo`), mas a tela nao exibe a
      Forma de Calculo ao lado, como a Farmacia passou a fazer.
- [ ] Prescricao/vacina **anteriores** a esta leva nao tem `forma_calculo` e continuam sendo
      exibidas em "dose(s)" - e o correto (o registro e SNAPSHOT), mas convive com os novos.

---

# Atualizado em: 2026-09-12 (parte 2) (🔴 **PRODUTO MULTIDOSE — e a tela de Produtos
#   de volta ao menu.** Três coisas ligadas:
#   1. **A TELA EXISTIA E NINGUÉM A ALCANÇAVA.** `/cadastro/produtos` está montada em
#      `App.tsx` desde 2026-09-10, com controller, rotas e permissões — o que nunca
#      nasceu foi o ITEM DO SIDEBAR: só se chegava nela pela URL. Voltou em
#      **Cadastro › Produtos**, logo abaixo de Fornecedores (é de quem se compra).
#   2. 🔴 **CHECKBOX "PRODUTO MULTIDOSE" + doses por embalagem.** O frasco rende N
#      aplicações. Não é rótulo: é o dado que faltava desde que a UNIDADE virou da
#      clínica (parte 1 desta data). Com o estoque contado em EMBALAGENS ("Un.") e a
#      prescrição em mL, `mesmoGrupo('mL','Un.')` é FALSO — a baixa caía no valor
#      BRUTO e **uma dose de 10 mL debitava 10 FRASCOS e cobrava 10 frascos na
#      fatura**, sem erro nenhum. Agora cada aplicação tira **1/N da embalagem**, e a
#      linha sai pelo **preço do frasco ÷ N** — a cobrança POR DOSE que foi pedida.
#      ⚠️ O preço NÃO precisou mudar: o valor já é `qtdDebitada × preço unitário`; o
#      que estava errado era a QUANTIDADE. `qtdDoEstoque` é a fonte única dessa conta.
#      ⚠️ Vale na RESERVA também — reservar o frasco inteiro por aplicação faria o
#      estoque "acabar" na primeira receita — e nas TRÊS verificações de estoque,
#      senão o alerta barraria uma prescrição que cabe.
#      ⚠️ **Item sem a marca não muda de comportamento**, e base sem a migration
#      também não: o mapa sai vazio e tudo cai na conversão de sempre.
#      ⚠️ "Doses/frasco" SAIU da seção de estoque: quem informa o número é o checkbox,
#      e é dele que o lote de vacina o recebe. Dois campos para o mesmo dado
#      divergiriam — e o que divergiria é o número que desconta a dose do frasco.
#   3. **ESCOLHER O ITEM CARREGA O QUE JÁ ESTÁ CADASTRADO** (`GET
#      /cadastro/produtos/detalhe`): unidade do catálogo + o vínculo do fornecedor
#      (preços, nota, multidose), tudo EDITÁVEL, com faixa dizendo que o produto já
#      existe. Antes o formulário abria em branco e salvar sobrescrevia um cadastro
#      que a pessoa nunca viu. Refaz ao TROCAR DE FORNECEDOR (o preço é por par) e, no
#      fluxo do DOCUMENTO DE COMPRA, o que a nota trouxe VENCE o cadastro antigo.
#      A lista ganhou **Alterar** (laranja, §6) e o selo "N doses/emb.".
#   ✅ **MIGRATION APLICADA** (autorizada) — `20261008000000_produto_multidose`:
#   `multidose` + `doses_por_embalagem` em **`tb_produtos_fornecedor`**, que já é da
#   EMPRESA e já tem RLS de tenant direto (ENABLE+FORCE conferidos, intactos).
#   🔴 **ARMADILHA NOVA: ela falhou na primeira tentativa com `42501 must be owner
#   of table`** — foi rodada com o usuário da APLICAÇÃO (`zls2vetp1`), e `ALTER TABLE`
#   exige OWNERSHIP. O dono é `nutriadmin`, que é quem `DATABASE_URL_MIGRATIONS` usa;
#   com ele passou de primeira. ⚠️ Migration falha BLOQUEIA a fila inteira: o conserto
#   é `migrate resolve --rolled-back` (seguro aqui — `steps=0`, nada aplicado) e
#   então `migrate deploy` com a URL certa. **Nunca `--applied`**: marcaria como feito
#   o que o banco não tem. ⚠️ **NUNCA em `tb_medicamentos`**: a linha
#   é GLOBAL e marcá-la mudaria a cobrança de TODAS as clínicas — a mesma armadilha
#   que obrigou a unidade a nascer com copy-on-write. ADITIVA, sem backfill, default
#   `false`. Suíte: **936**. Detalhes na §12.)
---

### Sessão 2026-09-12 (parte 2) — Produto multidose e a tela de Produtos no menu

> ✅ **MIGRATION APLICADA** (autorizada) — `20261008000000_produto_multidose`:
> `multidose BOOLEAN NOT NULL DEFAULT false` + `doses_por_embalagem INTEGER` em
> `tb_produtos_fornecedor`. **ADITIVA e sem backfill** — nenhum item passou a ser
> cobrado de forma diferente. Sem RLS novo: a tabela já é da EMPRESA, com policy de
> tenant direto criada em `20261006000000` (ENABLE+FORCE conferidos, intactos).
> Conferido no `information_schema`: `multidose` NOT NULL DEFAULT false,
> `doses_por_embalagem` INTEGER nulável. E **a tabela estava VAZIA** (0 produtos,
> conferido COM o carimbo `app.plataforma` — sem ele o FORCE RLS devolve 0 e parece
> tabela vazia, armadilha 42): zero linha a migrar, coerente com a tela nunca ter
> tido entrada no menu.
> `prisma generate` refeito sem EPERM nesta sessão. Não era obrigatório — as colunas
> são lidas e gravadas por SQL cru (`lib/produtoFornecedor.js`), e a leitura DETECTA
> a ausência delas e devolve o comportamento antigo (§11).
>
> 🔴 **ELA FALHOU NA PRIMEIRA TENTATIVA — `42501: must be owner of table
> tb_produtos_fornecedor`.** Não era o SQL: a migration foi rodada com o usuário da
> APLICAÇÃO (`zls2vetp1`), e `ALTER TABLE ... ADD COLUMN` exige **OWNERSHIP**, não
> `GRANT`. O dono de toda tabela do schema é `nutriadmin` — exatamente quem
> `DATABASE_URL_MIGRATIONS` usa; com ele passou de primeira.
> ⚠️ **Migration FALHA BLOQUEIA TODA A FILA** (mesma lição de 2026-09-10 parte 2). O
> conserto é `migrate resolve --rolled-back` e então `migrate deploy` com a URL certa.
> Aqui foi seguro porque o registro tinha **`steps=0`** e as colunas NÃO existiam —
> o Prisma roda cada migration em transaction, então não sobra estado parcial.
> ⚠️ **NUNCA `--applied` nesse caso**: marcaria como feito o que o banco não tem, e a
> próxima leitura do detector diria "a coluna existe" sobre uma coluna inexistente.
> ⚠️ `migrate status` diz **"Database schema is up to date!"** logo após o
> `--rolled-back` — não confie nessa linha para saber se falta aplicar; confira as
> COLUNAS.
>
> ✅ **VERIFICADO AO VIVO**, em transaction REVERTIDA contra a base real (empresa 58,
> 0 produtos ao fim): gravou o produto com `multidose=true, doses=5`; o lookup
> devolveu 5; a **empresa 42 enxergou 0** (RLS isolando); a lista trouxe a marca e o
> número; **desmarcar** tirou o item do lookup (o número é zerado junto); e salvar
> SEM mencionar multidose **preservou** a marca — o PATCH parcial que evita um
> salvamento de preço desfazer o cadastro de dose.
> ⚠️ O reconhecimento do script precisou de `comEscopoPlataforma`: sem o carimbo ele
> concluiu "sem fornecedor cadastrado" sobre uma base cheia (armadilha 42 de novo).

- [x] 🔴 **A TELA DE PRODUTOS NUNCA TEVE PORTA DE ENTRADA.** `/cadastro/produtos`
      está em `App.tsx` desde 2026-09-10, com `ProdutoController`, rotas, os 4 slugs
      `cadastro.produto.*` semeados e a tela inteira escrita — o que faltou foi o item
      do Sidebar. Na prática a função existia e só era alcançável digitando a URL.
      Entrou em **Cadastro › Produtos**, logo abaixo de Fornecedores (é de quem se
      compra o produto, e o cadastro de um leva ao do outro), gateado por
      `cadastro.produto.ler` no mesmo molde dos vizinhos.
      ⚠️ `/cadastro/produtos` já casava com o `p.startsWith('/cadastro/')` que abre o
      grupo — não foi preciso tocar em `detectSection` nem em `openGroup`.
      ⚠️ Há teste travando a presença do item: a tela some do alcance do usuário sem
      que nada quebre, que é o modo de falhar mais silencioso possível.
- [x] 🔴 **O DEFEITO QUE O CHECKBOX RESOLVE — e ele não é de interface.** Desde que a
      UNIDADE passou a ser da clínica (parte 1 desta data), o estoque é contado em
      EMBALAGENS: 10 frascos, unidade "Un.". A prescrição continua em mL/mg, e
      `mesmoGrupo('mL', 'Un.')` é **FALSO** — sem conversão possível,
      `debitarEstoqueDia` caía no valor BRUTO:
      ```
      dose de 10 mL  ->  restante = 10  ->  debita 10 "Un." (dez frascos)
                     ->  valorDaDose = 10 x R$/frasco  ->  a fatura cobra dez frascos
      ```
      Nenhum erro, nenhuma tela acusando. O dado que faltava é "quantas aplicações
      saem de um frasco".
- [x] **`multidose` + `dosesPorEmbalagem` em `tb_produtos_fornecedor`.**
      ⚠️ **NUNCA em `tb_medicamentos`**: a linha do catálogo é GLOBAL na imensa
      maioria dos casos, e marcá-la mudaria a cobrança de TODAS as clínicas do SaaS —
      exatamente a armadilha que obrigou a unidade a nascer com copy-on-write. Aqui a
      tabela já é da empresa: nada de policy nova, nada de cópia de catálogo.
      ⚠️ **Booleano PRÓPRIO, não deduzido de `doses > 1`**: "não é multidose" e "é
      multidose e ainda não informei quantas" são estados diferentes, e o segundo
      precisa aparecer como PENDÊNCIA em vez de voltar a cobrar o frasco em silêncio.
      ⚠️ `null` em `doses_por_embalagem` **não é 1**: com null a regra não entra em
      vigor. Tratá-lo como 1 afirmaria "o frasco é dose única", o oposto do que a
      clínica marcou.
- [x] 🔴 **A REGRA MORA NA QUANTIDADE, NÃO NO PREÇO** — `qtdDoEstoque(qtdPrescrita,
      unidadePrescrita, unidadeEstoque, doses, dosesPorEmbalagem)`, fonte única:
      ```
      multidose             -> doses / N   (frações de embalagem)
      unidades compatíveis  -> conversão de base (500 g -> 0,5 kg), como sempre foi
      incompatíveis         -> valor bruto, como sempre foi
      ```
      O valor da linha já é `qtdDebitada × preço unitário`, e a unidade contável tem
      fator 1 — então 1/5 de frasco × R$/frasco **é** o preço do frasco ÷ 5. Nenhuma
      linha do cálculo de PREÇO precisou mudar, e é isso que torna a mudança segura.
      ⚠️ **Multidose VENCE a conversão de unidade**, inclusive em mL × mL: a clínica
      declarou que conta em embalagens, e deixar a conversão numérica prevalecer
      reintroduziria a cobrança por volume pelas costas.
- [x] **A CONTAGEM de aplicações é o par da DOSAGEM** — `dosesDoDia`/`dosesDoCurso`,
      e o parâmetro `resolverDoses` de `debitarEstoqueDia` (o par de `resolverQtd`).
      Na execução, `resolverDosesExecucao` devolve **1** no fluxo por dose e o dia
      inteiro no legado, espelhando `resolverQtdExecucao`.
      ⚠️ Esquecer de passá-lo faz a dose voltar a ser cobrada pela DOSAGEM — o defeito
      original, de volta sem aviso. Há gate estrutural travando a chamada.
- [x] **Vale na RESERVA e nas TRÊS verificações de estoque**, não só na baixa:
      reservar o frasco inteiro por aplicação faria o estoque da clínica "acabar" na
      primeira receita, e a verificação compararia o frasco contra a dose e barraria
      uma prescrição que cabe. `verificarEstoqueParaDia`, `verificarEstoqueParaExecucao`
      e `verificarDisponibilidade` comparam **na unidade do estoque** quando há
      multidose — não existe base comum entre "mL" e "frasco".
- [x] ⚠️ **O lookup é EM BLOCO e com o client da TRANSAÇÃO** (`mapaMultidose(tx, …)`).
      Um item por consulta multiplicaria as idas ao banco pelo número de medicamentos
      do documento; e com o `prisma` global dentro da transaction o RLS devolveria
      ZERO linha em silêncio — a armadilha de 2026-08-23 (parte 4), que aqui
      apareceria como "o multidose não faz efeito".
      ⚠️ Divergência entre fornecedores do mesmo item (o vínculo é por par) resolve
      pelo **mais antigo** (`DISTINCT ON … ORDER BY id ASC`): o maior baratearia a
      dose abaixo do que a clínica paga, o menor cobraria a mais.
- [x] 🔴 **ESCOLHER O ITEM CARREGA O QUE JÁ ESTÁ CADASTRADO** — `GET
      /cadastro/produtos/detalhe?medicamentoId=`. Antes, escolher um medicamento que a
      clínica já compra abria o formulário EM BRANCO: a pessoa redigitava preço,
      unidade e fornecedor que estavam no banco e, ao salvar, sobrescrevia um cadastro
      que nunca viu. Agora vêm o item do catálogo e o VÍNCULO do fornecedor, tudo
      editável, com faixa dizendo que o produto já existe.
      ⚠️ **MULTI-TENANT**: só devolve linha GLOBAL ou da PRÓPRIA empresa — item de
      outra clínica responde **404**, nunca os dados. Os vínculos saem de
      `listarDaEmpresa`, escopado por `empresa_id`.
      ⚠️ **Refaz ao trocar de FORNECEDOR**: o preço é por (item, fornecedor), e manter
      o do anterior gravaria o cadastro de um no outro.
      ⚠️ Vindo do DOCUMENTO DE COMPRA (`origemNota`), o que a nota trouxe **vence** o
      cadastro antigo e o detalhe só preenche o que está vazio — o preço da nota é
      mais recente, e sobrescrevê-lo desfaria a leitura que a pessoa acabou de
      conferir.
      ⚠️ `ultimoDetalhe` (ref com a chave item|fornecedor) impede o efeito de rebuscar
      a cada render — e `editarProduto` a carimba ANTES de preencher, senão a carga
      sobrescreveria o que acabou de ser posto na tela.
- [x] **O salvar continua sendo o POST** — `salvarProduto` é idempotente pelo unique
      (empresa, item, fornecedor), então re-salvar ATUALIZA o vínculo. Um PUT separado
      deixaria a alteração sem o passo de entrada no estoque, que só o POST faz.
      ⚠️ O gate acompanha o caso: `cadastro.produto.editar` quando há vínculo,
      `cadastro.produto.criar` quando não — são permissões distintas na matriz, e o
      botão que só falha depois do clique é a armadilha 28-d.
- [x] **"Doses/frasco" SAIU da seção de estoque.** Quem informa o número é o checkbox
      de multidose, e é dele que `dosesPorFrasco` do lote de vacina passa a vir. Dois
      campos para o mesmo dado divergiriam — e o que divergiria é justamente o número
      que desconta a dose do frasco. Na vacina, aquele campo virou "Estoque mínimo".
- [x] Testes: `__tests__/produtoMultidose.test.js` (28 casos) — a conta da dose nos
      dois sentidos (com e sem a marca), o frasco inteiro cobrado ao longo das N doses
      e nunca N vezes, `null ≠ 1`, a contagem por frequência (inclusive a família
      multi-dia), a migration ser aditiva e não tocar no catálogo global, o escopo por
      `empresa_id`, o 404 do item de outra clínica, e um GATE ESTRUTURAL nos elos que
      somem em silêncio (baixa, reserva, execução, client da transação, item do menu).
      ✅ **Verificado que REPROVA**: removida a contagem da execução, a conversão
      reescrita à mão na baixa e a multidose da reserva, **3 casos falharam**;
      restaurado, os 28 voltaram. Suíte: **936**; `tsc --noEmit` (backend), `tsc -b` e
      `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] A VACINA não passa pela regra: ela tem contagem própria em doses
      (`LoteVacina.dosesPorFrasco`, debitado por `consumirReservaVacina`), e o
      checkbox só alimenta esse campo na entrada. Se a vacina precisar da mesma
      cobrança fracionada, o lugar é `VacinaClinicaController.darBaixaEFaturar`.
- [ ] A FARMÁCIA (entrada de estoque por `/farmacia`) não oferece o checkbox — quem
      declara multidose é o cadastro de Produtos. Item que só existe no estoque, sem
      produto de fornecedor cadastrado, continua sem a regra.
- [ ] A descrição da linha na fatura não diz "1 dose de N do frasco" — continua sendo
      a do item. Quem quiser auditar o rateio precisa abrir o cadastro do produto.

---

# Atualizado em: 2026-09-12 (🔴 **A UNIDADE DO MEDICAMENTO PASSOU A SER DA CLÍNICA.**
#   O estoque e a fatura saíam "em gramas" onde a clínica conta EMBALAGENS: a unidade
#   vinha do CATÁLOGO GLOBAL (mantido pelo ADMIN), quase sempre peso/volume, e era ela
#   que governava `EstoqueClinica.qtdEstoque` (10 frascos × 500 = 5.000 g) e o
#   `precoUnitarioBase` (R$/g), que é o preço que vira linha de fatura.
#   1. **Seletor de UNIDADE na Entrada de Estoque** (`/farmacia`), terceira coluna da
#      calculadora de embalagens, na criação E na edição. As opções saem do CATÁLOGO
#      (`/medicamentos/opcoes-catalogo`), nunca de lista fixa; o backend GARANTE a opção
#      **"Un."** quando nenhuma das existentes significa isso. ⚠️ Com 'un' no catálogo
#      NÃO acrescenta 'Un.' — seriam duas opções para a mesma unidade, a duplicata que
#      `dedupPorCaixa` existe para resolver.
#   2. 🔴 **COPY-ON-WRITE, a mesma regra de `DocumentoTemplate`**: trocar a unidade de um
#      medicamento GLOBAL cria a **CÓPIA DA EMPRESA** (com vias e espécies) e reaponta
#      para ela o estoque ATIVO da clínica, as PRESCRIÇÕES PENDENTES e os produtos de
#      fornecedor. Medicamento que já é da empresa é alterado no lugar. A linha global
#      NUNCA é tocada — alterar a unidade dela mudaria o preço de TODAS as clínicas.
#      ⚠️ **Reapontar a prescrição pendente não é cosmético**: `consumirReservas`/
#      `debitarEstoqueDia` acham o estoque por `medicamentoId: item.medicamentoCatId` —
#      com o item no medicamento antigo e o estoque na cópia, o `findFirst` devolve null,
#      o `if (!estoque) continue` engole o caso e a dose é executada SEM baixa e SEM
#      linha na fatura. Silêncio total. Grupo EXECUTADO/CANCELADO fica intocado.
#      ⚠️ Entrada de estoque INATIVA não é reapontada: é histórico na unidade antiga.
#   3. **DOIS GUARDS, porque a unidade vale para TODO o estoque do medicamento**: recusa
#      quando há OUTRA entrada ativa (a quantidade dela está na unidade antiga) e quando
#      já houve SAÍDA (consumo, e às vezes fatura, na unidade antiga). Quem reexpressa a
#      quantidade é a calculadora de embalagens, e ela só alcança a entrada aberta.
#   4. 🔴 **`calcPrecoUnitarioBase` deixou de devolver `null` para unidade CONTÁVEL** —
#      era isso que jogava a cobrança no caminho LEGADO (`precoUnitarioDoEstoque`), que
#      divide o valor pelo estoque RESTANTE: o preço unitário SUBIA a cada dose aplicada.
#      Agora 'Un.'/'Comprimido' usam fator 1 e o preço fica congelado na entrada.
#   5. **`preferirCopiaDaEmpresa`** (novo, `lib/catalogoManual.js`) esconde o global
#      homônimo nas listagens: sem ele a busca da Prescrição e a lista da Farmácia
#      mostrariam "Dipirona" duas vezes (a cópia com estoque e a global sem).
#   ✅ **MULTI-TENANT/RLS VERIFICADO AO VIVO** (transactions revertidas): a policy de
#   `tb_medicamentos` é ENABLE+FORCE e assimétrica (USING global+próprio, WITH CHECK só
#   próprio); o UPDATE da unidade na linha GLOBAL é **RECUSADO pelo banco (42501)**; o
#   INSERT da cópia é aceito; e a empresa 58 enxerga 0 linhas da cópia da 42.
#   ⚠️ E o WITH CHECK **ACEITA** um UPDATE que setasse `empresa_id` NA LINHA GLOBAL
#   (roubar o global para uma clínica) — quem impede isso é o CÓDIGO, e há gate
#   estrutural travando. **SEM MIGRATION** (nenhuma coluna nova). Suíte: **908**.
#   Detalhes na §12.)
---

### Sessão 2026-09-12 — A unidade do medicamento é da clínica (estoque e fatura em embalagens)

> **SEM MIGRATION.** Nenhuma coluna nova: `Medicamento.unidade` já existe e é
> `VarChar(100)`. O que mudou é QUEM a define e o que acontece quando ela muda.

- [x] 🔴 **O DEFEITO, como foi relatado:** "o estoque e a fatura estão vindo errado
      porque está sendo levado em consideração a qtd em gramas e não a quantidade de
      embalagens". Causa: `Medicamento.unidade` vem do CATÁLOGO GLOBAL (ADMIN) e quase
      sempre é peso/volume. Ela governa duas coisas a jusante:
      `EstoqueClinica.qtdEstoque` (a calculadora da tela faz `nº embalagens × peso por
      embalagem` → 10 frascos × 500 = **5.000 g**) e `precoUnitarioBase` (**R$/g**), que
      é o preço que vira linha de fatura. A clínica compra, conta e cobra em EMBALAGENS.
- [x] **Seletor de UNIDADE na Entrada de Estoque** (`Farmacia.tsx`), terceira coluna da
      calculadora de embalagens — é ela que dá sentido às outras duas ("10 × 1 Un." ×
      "10 × 500 g"). Vale na CRIAÇÃO e na EDIÇÃO (o pedido "isso mesmo para os
      medicamentos já cadastrados").
      ⚠️ A linha "Unidade:" SAIU do bloco de leitura "Do Catálogo": dois lugares para o
      mesmo dado na mesma tela é o que faz um contradizer o outro.
      ⚠️ A unidade da EDIÇÃO sai de `item.medicamento.unidade`, não da lista
      `medicamentos` — ela é recortada por espécie e pode não conter o medicamento da
      linha; aí o seletor abriria em branco e o salvar mandaria unidade vazia.
      ⚠️ O "Total em estoque" passou a aparecer TAMBÉM na edição sem embalagens
      reinformadas: trocar 'g' por 'Un.' não mexe no número, então 5.000 g passariam a
      ser lidos como "5.000 Un." — mostrar o total na unidade escolhida é o que dá para
      perceber isso ANTES de salvar. Quem corrige é o nº de embalagens ao lado.
- [x] **As opções vêm do CATÁLOGO, com a garantia do "Un."** — `garantirUnidadeAvulsa`
      (`lib/unidadeMedicamento.js`), aplicada em `MedicamentoController.opcoesCatalogo`.
      ⚠️ **Só ACRESCENTA quando falta**: com 'un' no catálogo, somar 'Un.' criaria DUAS
      opções para a mesma unidade — exatamente a duplicata que `dedupPorCaixa` existe
      para resolver, e cada cadastro passaria a escolher uma grafia ao acaso. Reconhece
      un / Un. / unid / unidade.
      ⚠️ Lista fixa no código divergiria do banco no primeiro item novo — é a mesma
      razão pela qual `opcoesCatalogo` nasceu lendo o catálogo.
- [x] 🔴 **COPY-ON-WRITE — `lib/unidadeMedicamento.js#definirUnidadeDoMedicamento`.**
      `tb_medicamentos` é CATÁLOGO MISTO: `empresa_id` NULO = linha GLOBAL que toda
      clínica LÊ e nenhuma ESCREVE. Alterar a unidade de uma linha global mudaria a
      unidade — e o PREÇO — do medicamento de todas as clínicas do SaaS. Então:
      ```
      medicamento GLOBAL      → nasce a CÓPIA da empresa com a unidade nova
      medicamento da EMPRESA  → alterado no lugar
      de OUTRA empresa        → 404 (o RLS já o esconderia; o guard é para o ADMIN)
      sem empresa no contexto → 400 (não há de quem a cópia seria)
      ```
      ⚠️ A cópia leva **vias e espécies**: sem o vínculo de ESPÉCIE o item nasce
      INVISÍVEL na busca do atendimento (`paraAtendimento` filtra por `especies.some`) e
      no filtro `especieDaEmpresa` da Farmácia — a clínica trocaria a unidade e o item
      desapareceria das telas, sem erro nenhum.
      ⚠️ `classificacao` é copiada porque carrega o recorte "é vacina?"
      (`contains 'vacin'`), que separa a Farmácia do Estoque de Vacinas.
      ⚠️ **Idempotente**: cópia anterior da mesma empresa (trocou, voltou, trocou) é
      REAPROVEITADA e reativada, nunca empilhada — mesma chave de
      `garantirMedicamentoDaEmpresa` (nome + empresa, sem caixa).
      ⚠️ **Grafia não é troca** (`mesmaUnidade`): 'un' × 'Un.' e 'kg' × 'Kg' são a mesma
      unidade. Sem isso, abrir e salvar a tela sem mexer em nada criaria uma cópia a
      cada gravação, porque o `<select>` devolve a grafia da opção.
- [x] 🔴 **O REAPONTAMENTO é obrigatório, não arrumação.** `reapontarParaCopia` move, na
      MESMA transaction: o estoque ATIVO da empresa, os itens de prescrição de grupo
      **SALVO/FINALIZADO** e os produtos de fornecedor.
      🔴 **Prescrição pendente**: `consumirReservas`/`debitarEstoqueDia` acham o estoque
      por `medicamentoId: item.medicamentoCatId`. Com o item apontando para o medicamento
      antigo e o estoque na cópia, o `findFirst` devolve null, o `if (!estoque) continue`
      engole o caso, e a dose é executada **sem baixa de estoque e sem linha na fatura** —
      falha silenciosa, o pior resultado possível.
      ⚠️ Grupo **EXECUTADO/CANCELADO** fica intocado: é histórico.
      ⚠️ Entrada de estoque **INATIVA** não é reapontada — é histórico com a quantidade na
      unidade ANTIGA (5.000 g); arrastá-la reescreveria o que ela afirma. Por isso
      `atualizar` carimba `data.medicamentoId` à parte, cobrindo a inativa em edição.
      ⚠️ Todo `updateMany` leva `empresaId` no `where` — o RLS recusaria linha de outra
      clínica, mas depender só dele deixaria a intenção implícita.
      ⚠️ `tb_produtos_fornecedor` vai por SQL cru com `catch`: a tabela é da migration
      20261006000000 e o client pode não conhecê-la (§11).
- [x] 🔴 **DOIS GUARDS — a unidade é do MEDICAMENTO, logo vale para TODO o estoque dele.**
      `qtdEstoque` está expresso na unidade ANTIGA, e quem o reexpressa é a calculadora de
      embalagens, que só alcança a entrada aberta. Recusa (400) quando:
      **(a) `OUTRAS_ENTRADAS_DE_ESTOQUE`** — a empresa tem outra entrada ATIVA daquele
      medicamento (a que está sendo salva não conta, via `ignorarEstoqueId`);
      **(b) `ESTOQUE_JA_MOVIMENTADO`** — já houve SAÍDA na unidade antiga, isto é, consumo
      e (quando houve cobrança) fatura emitida; trocar a unidade aí reescreveria o
      significado do que já foi entregue ao cliente. A mensagem diz o caminho: cadastrar a
      unidade correta numa entrada nova.
      ⚠️ Os guards rodam DEPOIS do `mesmaUnidade`: salvar a tela sem mexer na unidade não
      pode ser recusado por uma regra que só existe para a TROCA.
- [x] 🔴 **`calcPrecoUnitarioBase` deixou de devolver `null` para unidade CONTÁVEL.**
      Ele computa R$/g e R$/mL e, para unidade sem fator conhecido ('Un.', 'Comprimido',
      'Frasco'), devolvia `null` com o comentário "unidade incompatível — não calcula".
      Com o campo vazio, a execução da prescrição cai no CAMINHO LEGADO
      (`precoUnitarioDoEstoque`), que divide o valor pelo estoque **RESTANTE**: o preço
      unitário SUBIA a cada dose aplicada, e era esse preço que ia para a fatura. Agora o
      fator é 1 (R$ por unidade), congelado na entrada. Exportado para teste, porque
      quebra em silêncio.
      ⚠️ `atualizar` recalcula o preço TAMBÉM quando só a unidade muda: sem isso, trocar
      'g' por 'Un.' deixaria o R$/g gravado valendo como R$/unidade na fatura.
- [x] 🔴 **A gravação é ATÔMICA com a troca.** Em `atualizar`, a resolução da unidade
      acontece DENTRO da `$transaction` do `update` — resolvê-la antes deixaria a unidade
      alterada (com cópia criada e reapontamento feito) mesmo quando o salvar é recusado
      por uma validação seguinte. Em `criar`, ela roda depois de TODAS as validações de
      entrada.
- [x] **`preferirCopiaDaEmpresa`** (`lib/catalogoManual.js`) — o global homônimo sai das
      listagens quando a empresa tem a própria cópia. Até aqui nada criava duas linhas de
      mesmo nome no escopo visível (`garantirMedicamentoDaEmpresa` REAPROVEITA o global em
      vez de copiar); o copy-on-write cria a cópia de propósito, e sem o recorte a busca
      da Prescrição e a lista da Farmácia mostrariam **"Dipirona" duas vezes** — a cópia
      (com estoque e a unidade certa) e a global (sem estoque), indistinguíveis pelo nome.
      Aplicado em `listar` e `paraAtendimento`.
      ⚠️ Filtra o que se EXIBE, nunca o que existe.
      ⚠️ `garantirMedicamentoDaEmpresa` ganhou `orderBy: { empresaId: 'asc' }` — o PRÓPRIO
      da empresa vence o global de mesmo nome. `asc` e não `desc`: no Postgres ASC é NULLS
      LAST, então o não-nulo vem primeiro; `desc` é NULLS FIRST e faria o global ganhar.
- [x] **Tenancy endurecida em `EstoqueController.criar`**: `empresaId` do CORPO só é aceito
      do ADMIN da plataforma; para os demais vale o CONTEXTO. Antes o corpo vencia para
      qualquer perfil — o RLS recusaria a escrita, mas como 500 sem explicação.
- [x] ✅ **MULTI-TENANT/RLS CONFERIDO AO VIVO** contra a base, em transactions REVERTIDAS
      (nada gravado): a policy de `tb_medicamentos` é **ENABLE + FORCE** e assimétrica —
      `USING (app_plataforma() OR empresa_id = app_empresa_id() OR empresa_id IS NULL)`,
      `WITH CHECK (app_plataforma() OR empresa_id = app_empresa_id())`; o UPDATE da unidade
      na linha GLOBAL sob o tenant 42 é **RECUSADO pelo banco** (`42501 new row violates
      row-level security policy`); o INSERT da cópia com `empresa_id = 42` é aceito e o
      UPDATE da unidade NELA também; e a empresa 58 enxerga **0 linhas** da cópia da 42.
      🔴 **O que o RLS NÃO impede**: um UPDATE que setasse `empresa_id = <minha empresa>`
      na linha GLOBAL passa pelo `WITH CHECK` (medido: 1 linha afetada) e ROUBARIA para uma
      clínica o medicamento que é de todas. **Quem impede é o CÓDIGO** — a lib só faz
      `create` da cópia —, e há GATE ESTRUTURAL travando: os únicos `medicamento.update` da
      lib são os de unidade, e nenhum menciona `empresaId`.
- [x] Testes: `__tests__/unidadeMedicamento.test.js` (36 casos) — grafia × troca, a
      garantia do 'Un.' sem duplicata, a cópia com vias/espécies, o reapontamento de
      estoque e de prescrição pendente (com o `empresaId` em todo `where`), os dois guards,
      o preço da unidade contável, o dedup global × cópia, e os gates estruturais.
      ✅ **Verificado que REPROVA**: removido o reapontamento do estoque e a cópia
      "simplificada" para um UPDATE na linha global, **7 casos falharam** (inclusive o gate
      do `empresaId`); restaurado, os 36 voltaram. Suíte: **908**; `tsc --noEmit` (backend),
      `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] `ProdutoController.criar` (tela `/cadastro/produtos`, checkbox "dar entrada no
      estoque") também cria `EstoqueClinica` e continua usando a unidade do CATÁLOGO, sem
      seletor. O pedido foi sobre a tela de estoque de medicamentos; ligar lá é chamar a
      MESMA lib no mesmo ponto da transaction.
- [ ] A VACINA (`tb_lotes_vacina`, `dosesPorFrasco`) tem contagem própria em doses e ficou
      fora — a Farmácia exclui vacinas (`excluirVacinas=true`), então a troca de unidade
      nunca alcança um lote de vacina.
- [ ] Prescrição cuja unidade do ITEM não converte para a do estoque ('mg' prescrito ×
      'Un.' no estoque) continua subtraindo direto (1 mg → 1 Un.) — comportamento legado de
      `mesmoGrupo`, que não conhece unidade contável. Hoje o caminho é a clínica escolher
      unidades compatíveis; converter exigiria saber quantos mg tem cada unidade, dado que
      o sistema não guarda.

---

### Sessão 2026-08-18 (parte 5) — Vacina ganhou RESERVA de estoque — mesma lógica do medicamento
> 🔴 **MIGRATION GERADA, NÃO APLICADA** — `prisma/migrations/20260830000000_reserva_estoque_vacina/`.
> Antes de usar: `npx prisma migrate deploy` (aplica no banco) + `npx prisma generate`
> (o client tipado; sem isto o Windows não reconhece `ReservaEstoqueVacina` — o
> controller usa SQL cru de propósito, então FUNCIONA sem o generate, mas o
> autocomplete/typecheck do Prisma só resolve depois). Depois de aplicada, adicionar
> `tb_reservas_estoque_vacina` a `TENANT_PLANE` em
> `backend/src/__tests__/tenancyRls.test.js` — a migration já ativa RLS nela (mesmo
> padrão de `tb_reservas_estoque`), mas o gate só enxerga tabelas que existem de
> verdade no banco, então listá-la ANTES da migration rodar reprovaria o teste 3
> ("cita tabela inexistente"). É por isso que não fiz essa edição agora.

- [x] **Pedido explícito: "use a mesma lógica que é empregada no estoque de
      medicamentos para as vacinas"** — até aqui, vacina não tinha reserva NENHUMA
      (diferente da prescrição, que usa `ReservaEstoque` desde sempre): `registrar()`
      só fixava `loteId` como referência de preço; `qtdDisponivel` só era tocado no
      momento do débito de verdade (`executar`, ou `finalizar` no quadrante
      aplicadaPeloProprietário×!cliente). Sem reserva, duas vacinas concorrentes podiam
      disputar o mesmo lote sem que nenhuma soubesse da outra — só na hora de executar
      é que uma delas descobriria o saldo insuficiente.
      Criado o espelho exato do sistema de `PrescricaoGrupoController`:
      - **Model novo `ReservaEstoqueVacina`** (`tb_reservas_estoque_vacina`) — mesmas
        colunas/formato de `ReservaEstoque`, trocando `estoqueId`→`loteVacinaId` e
        `prescricaoGrupoId`→`vacinaClinicaId`. RLS "TENANT VIA PAI" (`tb_lotes_vacina`,
        que tem `empresa_id` DIRETO — ao contrário de `tb_vacinas_clinicas`, que segue
        `animalId` porque `lote_id` é opcional, ver `lib/tenancyMap.js`).
      - **`criarReservaVacina`** (espelha `criarReservas`) — chamada por `finalizar()`
        no quadrante que VAI para o plantão (`!isCliente && !aplicadaPeloProprietario`):
        distribui a quantidade em FEFO entre os lotes do medicamento, respeitando o que
        JÁ está reservado por outras vacinas; se faltar, força o restante na última
        entrada (mesma "finalização forçada" da prescrição — nunca bloqueia o registro
        clínico). Os OUTROS dois quadrantes não reservam: `cliente:true` nunca debita
        (nada a reservar); aplicadaPeloProprietário×!cliente debita direto na
        FINALIZAÇÃO via `darBaixaEFaturar` (nunca passa pelo plantão, não há intervalo
        "reservado, aguardando execução").
      - **`consumirReservaVacina`** (espelha `debitarEstoqueDia`/`consumirReservas`) —
        chamada de DENTRO de `darBaixaEFaturar` (que agora é chamada tanto por
        `finalizar` quanto por `executar`): consome a reserva PRIMEIRO — decrementa
        `qtd_disponivel` de verdade em cada lote reservado (pode ser mais de um) e apaga
        as linhas. Sem reserva (aplicadaPeloProprietário, ou registro legado anterior à
        migration), cai no lookup direto de sempre (comportamento antigo preservado
        intacto como fallback).
      - **`excluir` (cancelar) libera a reserva pendente** — `DELETE` das linhas de
        `tb_reservas_estoque_vacina` desta vacina, SEM tocar `qtd_disponivel` (a reserva
        nunca decrementou o lote). Continua também restaurando estoque quando havia
        débito de VERDADE (via a checagem por `FaturaItem` da sessão anterior — ver
        abaixo) — as duas coisas são independentes e cobrem os três momentos possíveis
        do cancelamento: SALVA (nada a fazer), FINALIZADA com reserva (libera a
        reserva), EXECUTADA (restaura o débito real).
      - **Deliberadamente NÃO fiz**: tabela de `MovimentoEstoque`-equivalente para
        vacina. `EstoqueVacinaController.ajustar` já documenta, de propósito, que
        "vacinas não têm tabela de movimento — o motivo é persistido no AuditLog"
        (decisão existente, não uma lacuna desta sessão) — e a Farmácia (medicamento)
        TAMBÉM não faz o CRUD de estoque (entrada/ajuste/exclusão de lote) reagir a
        reservas, então replicar isso para vacina não seria "a mesma lógica", seria
        além dela.
- [x] 🔴 **Bug de estoque da sessão anterior, agora coberto pela reserva também** —
      "cancelar vacina SALVA/FINALIZADA (nunca executada) inflava o lote" continua
      corrigido pela checagem de `FaturaItem` (não mudou), e agora ganha uma segunda
      camada: se a vacina JÁ tinha uma reserva (FINALIZADA, plantão), cancelar a
      libera — sem isso, a reserva ficaria viva pra sempre, contando contra a
      disponibilidade de qualquer vacina/registro futuro do mesmo lote (o MESMO bug de
      "estoque inflado", só que ao contrário: estoque encolhido artificialmente).
