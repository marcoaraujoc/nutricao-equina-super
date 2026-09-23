---
paths:
  - "**/*Fatura*"
  - "**/*Orcamento*"
  - "**/*ContaPagar*"
  - "**/*Recibo*"
  - "**/*Pagamento*"
  - "**/*Plano*"
  - "**/faturaUtils.js"
  - "**/faturaFechamentoAnimal.js"
  - "**/faturaItemOrigens.js"
  - "**/faturaLinkPublico.js"
  - "**/contasPagar.js"
  - "**/orcamento*.js"
  - "**/dadosRecebimento.js"
  - "**/formaCobrancaEstoque.js"
  - "**/*Relatorio*Financeir*"
  - "**/RelatoriosController.js"
  - "**/RelatorioGerencialController.js"
  - "**/validadeOrcamento.js"
  - "**/procedimentoPrestador.js"
---

# Histórico de decisões — Financeiro (fatura, orcamento, contas a pagar)

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-22 (parte 4) (🔴 **O QUE A CLÍNICA PAGA GANHOU VENCIMENTO E O
#   CICLO DA FATURA** — a pedido. Migration `20261020000000_vencimento_credor`,
#   **APLICADA**.
#   1. 🔴 **O CADASTRO DE FORNECEDOR E DE PRESTADOR PASSOU A DECLARAR QUANDO A CONTA
#      VENCE**, na MESMA forma do "Fechamento da Fatura" do cadastro da empresa: uma
#      FORMA (Último dia / Primeiro dia / Dia específico / Dia útil) e o NÚMERO que só
#      tem sentido dentro dela. Duas colunas, e não uma data cheia, porque o vencimento
#      é uma REGRA mensal — gravar "05/10/2026" obrigaria a reescrever o cadastro todo
#      mês.
#      ⚠️ **Mora no CADASTRO do credor, não na conta**: o acordo é com a pessoa ("a
#      Agrovet vence todo dia 10"), vale para todas as contas dela e muda de uma vez
#      quando é renegociado. A conta DERIVA o vencimento daqui na leitura, como a fatura
#      deriva o dela de `tb_proprietario_perfis.dia_vencimento_fatura`.
#      ⚠️ **NULL = não declarado, e SEM BACKFILL**: nenhum credor já cadastrado combinou
#      data nenhuma, e escrever uma agora faria a conta dele nascer ATRASADA numa data
#      inventada. Sem declaração, a tela mostra "—" e a conta nunca atrasa — exatamente
#      o comportamento de hoje.
#      ⚠️ **UM componente para os dois cadastros** (`SeletorVencimentoCredor.tsx`): duas
#      cópias divergiriam na primeira correção, e o que divergiria é a data em que a
#      clínica acha que precisa pagar.
#   2. 🔴 **ATRASADA É DERIVADA, NUNCA GRAVADA** (`lib/vencimentoCredor.js#statusExibicao`)
#      — e aqui a decisão é DIFERENTE da fatura, de propósito. A fatura PERSISTE o dela
#      porque ~20 leitores dependem da coluna e um cron é o único jeito de servi-los de
#      uma vez; a conta a pagar tem **UM leitor** (a tela de Pagamentos), então derivar é
#      mais simples e sempre atual — não existe a janela entre o vencimento e a próxima
#      passada do cron. **Nenhum cron novo foi criado.**
#      ⚠️ `STATUS_VALIDOS` (graváveis) NÃO contém ATRASADA; `STATUS_FILTRAVEIS` contém.
#      Aceitá-la na escrita criaria um segundo dono da verdade: a coluna diria ATRASADA
#      e o cadastro do credor diria outra coisa, sem como saber em qual acreditar.
#      ⚠️ Só a **FECHADA** atrasa. ABERTA/REABERTA ainda recebem lançamento, PAGA já foi
#      quitada, CANCELADA deixou de valer.
#      ⚠️ O filtro da tela incide sobre `statusExibicao`, NUNCA sobre `status`: pelo
#      gravado, o chip "Atrasada" viria sempre vazio e o "Fechada" mostraria contas
#      vencidas.
#   3. **REABERTA entrou no ciclo da conta**, com a MESMA distinção da fatura: as duas
#      são editáveis, mas só a **ABERTA** é a conta CORRENTE — é ela que
#      `contaAbertaDoCredor` acha (índice único PARCIAL `WHERE status = 'ABERTA'`) para
#      receber o lançamento automático de hoje. Sem a distinção, reabrir a conta de
#      agosto para corrigir um valor faria a compra de setembro cair dentro dela.
#   4. 🔴 **"MARCAR COMO PAGO" PERGUNTA A DATA DE PAGAMENTO.** O pagamento é registrado
#      no sistema DEPOIS de acontecer no banco, e carimbar o relógio faria toda quitação
#      dizer a data da digitação. Sem data informada, `NOW()` continua valendo — o que
#      não pode é ser o único caminho.
#      🔴 **DEFEITO ACHADO RODANDO O CÓDIGO REAL CONTRA A BASE**: `pago_em` é `timestamp
#      WITHOUT time zone` e um objeto `Date` como parâmetro é tratado como `timestamptz`,
#      convertido para o fuso da SESSÃO — o dia **01/09** escolhido na tela era gravado
#      31/08 21:00 e voltava **31/08** no comprovante, sem erro e sem log. É a armadilha
#      do `NOW()` puro (§6) pelo outro lado. A data passou a ir como **TEXTO**
#      (`timestampNaive`), e "YYYY-MM-DD" vira meia-noite daquele dia, sem conversão.
#      🔴 **SEGUNDO DEFEITO, do mesmo teste ao vivo**: `pago_por_id` nulo sem `::int` é
#      inferido como TEXT e o Postgres recusa com **42804**. Os dois parâmetros agora são
#      castados.
#   5. 🔴 **NA ABA DE PRESTADORES A FOLHA VIROU O RECIBO** (`ReciboPrestadorPrint`), o
#      mesmo documento de `/recibos-prestador` — com quitação, valor por extenso e
#      assinatura de QUEM RECEBE. O **demonstrativo** (`ContaPagarPrint`) FICA na aba de
#      fornecedor: ali o papel é conferência de compra, não comprovante de quitação, e
#      imprimir uma dívida em papel de recibo entregaria ao fornecedor um documento
#      dizendo que a clínica pagou o que não pagou.
#      ⚠️ `valorCliente`/`totalCliente` vão **null** e a COLUNA some da folha: a conta a
#      pagar registra só o que se DEVE, e "R$ 0,00" ali afirmaria ao prestador que o
#      cliente não pagou nada pelo serviço dele.
#      ⚠️ O TIMBRE sai por `GET /financeiro/contas-pagar/emitente`, sob
#      `financeiro.pagamentos.ler` — e NÃO consumindo `/recibos-prestador/emitente`, que
#      exige `financeiro.recibos.ler`: quem opera pagamentos pode não ter aquele slug, e
#      a folha sairia sem emitente em silêncio. O controller é REAPROVEITADO, não copiado.
#   6. **A coluna "Data" virou "Data do Pedido"**, e passou a ser explicitamente a data
#      da ENTRADA NO ESTOQUE na compra (`movimento.createdAt`). Hoje coincide com o
#      default, mas o lançamento é best-effort e roda FORA da transaction: reprocessado,
#      o default carimbaria o instante do reprocessamento e a compra apareceria no
#      período errado — a conta pela qual o mês fecha.
#   7. **A barra de ações é a da FATURA** (Fechar Pagamento · Marcar como Pago · E-mail ·
#      WhatsApp · Imprimir · Exportar, mais Reabrir e Cancelar). Os tokens saíram de
#      dentro de `Faturamento.tsx` para **`utils/tomAcao.ts`**, fonte única das duas
#      telas — duas cópias dariam ao mesmo ato uma cor de cada lado do balcão.
#      ⚠️ **Não substitui `AcaoRegistro`**, que continua sendo a fonte única da ação de
#      um registro de LISTA. Aqui a ação é de um DOCUMENTO inteiro, em barra própria.
#   8. ⚠️ **O vencimento fica no CABEÇALHO da conta, não como coluna da tabela de itens.**
#      Ele é da CONTA (vem do cadastro do credor) e repeti-lo em cada linha diria o mesmo
#      número dezenas de vezes sem nunca variar. A "Data de Pagamento" aparece ao lado
#      dele assim que a conta é quitada.
#   ⚠️ **Toda coluna nova é lida/gravada por SQL CRU** (`lib/vencimentoCredor.js`, com
#   guarda de existência de coluna): no Windows o `prisma generate` falha com o backend
#   rodando (§11), e passar o campo ao `update` TIPADO nesse estado derrubaria o CADASTRO
#   INTEIRO, não só o campo novo. A gravação é um `UPDATE`, então vai SEMPRE **depois** do
#   `create` — antes dele acertaria zero linhas, em silêncio.
#   ⚠️ **A listagem TEM de devolver o campo**: sem ele a edição abriria com o vencimento
#   em branco e o salvar o APAGARIA em silêncio (a lição do `temposConsulta`, 2026-07-28).
#   ✅ **MIGRATION APLICADA** (autorizada) — ADITIVA e **SEM BACKFILL**. Conferido contra
#   o retrato de ANTES: **6 fornecedores / 4 prestadores, 0 com vencimento; 6 contas,
#   R$ 10.590,00 — idênticos**. As 4 colunas nascem NULÁVEIS (VARCHAR(20) e INTEGER).
#   RLS: **nada a fazer** — as duas tabelas já têm policy, e por isso o vencimento virou
#   COLUNA e não tabela nova.
#   ⚠️ `prisma generate` FALHOU com **EPERM** (§11, backend rodando) e **não bloqueia**:
#   nada aqui passa pelo client tipado. Rodar na próxima parada do backend.
#   ✅ **CONFERIDO AO VIVO** com o CÓDIGO REAL contra a base, em transações REVERTIDAS:
#   vencimento gravado e devolvido (ref 2026-09 → **10/10/2026**); conta de ref 2026-06
#   sai **gravada FECHADA / exibida ATRASADA**, o filtro "Atrasada" a acha e o "Fechada"
#   não; vencida mas **PAGA** e vencida mas **REABERTA** NÃO atrasam; sem vencimento
#   declarado nunca atrasa; `alterarStatus('ATRASADA')` é **recusado**; e a data informada
#   volta **01/09**, não 31/08. Ao fim: 0 credores com vencimento, 6 contas, R$ 10.590,00.
#   ✅ **RLS CONFERIDO AO VIVO** com o JOIN novo do credor: a dona lê as 4 contas dela, a
#   vizinha lê **0**.
#   Gate novo `__tests__/vencimentoCredor.test.js` (36 casos). ✅ **Verificado que
#   REPROVA**: sabotados o `statusExibicao` (atrasando qualquer status), a data do pedido
#   da compra e o filtro da tela (pelo status gravado), **3 casos falharam**.
#   Suíte: **1399**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)

---

# Atualizado em: 2026-09-22 (🔴 **O EXAME PASSOU A SER LANÇADO NO PAGAMENTO AO
#   PRESTADOR**, como o procedimento já era — a pedido.
#   1. 🔴 **O EXAME FEITO POR PRESTADOR EXTERNO ERA COBRADO DO CLIENTE E NÃO APARECIA EM
#      PAGAMENTOS.** O procedimento escreve as DUAS metades desde 2026-09-10
#      (`PrescricaoGrupoController.executar`: ledger do recibo + `contasPagar.lancarItem`).
#      O exame só tinha a primeira metade ESCRITA — e, na prática, nem essa:
#      `registrarReciboDoExame` só rodava em `PATCH /clinica/exames/:id/finalizar`, rota
#      que **NENHUMA tela chama**. Quem conclui o exame de verdade é `salvarResultado`
#      (status REALIZADO), e ali não havia nada. Resultado: código de recibo existindo e
#      nunca executando.
#      Agora há UM helper — `registrarPagamentoPrestadorDoExame` — chamado por
#      `salvarResultado` (os DOIS ramos: Imagem e Laboratorial/Bioquímico),
#      `criarNaoPedido` e `finalizar`. Ele grava o ledger E a conta a pagar, na MESMA
#      transaction do status.
#      ⚠️ O valor das duas sai do MESMO `calcularValorAPagar`: apurar cada uma por sua
#      conta daria dois números para a mesma dívida, com recibo e conta discordando.
#   2. 🔴 **VALE PARA TODO TIPO DE EXAME** (a pedido), não só Imagem. Laboratorial e
#      Bioquímico não têm preço no catálogo de procedimentos, então caem no
#      `permitirSemValor` de 2026-09-18: a dívida nasce ZERADA e visível em Pagamentos,
#      e o financeiro informa o valor ali. Recortar por Imagem deixaria de fora
#      justamente o LABORATÓRIO EXTERNO, que é o prestador mais comum dos outros dois.
#   3. 🔴 **IDEMPOTÊNCIA É OBRIGATÓRIA AQUI, e não era no procedimento.** `executar` roda
#      uma vez por dose; `salvarResultado` é **REENVIÁVEL** (recarregar o laudo porque a
#      IA falhou, corrigir a tabela digitada). Sem trava, cada reenvio somaria outra
#      dívida ao prestador, em silêncio. Duas travas: índice único parcial
#      `tb_execucoes_proc_prestador_exame_unico` sobre a coluna NOVA
#      `tb_execucoes_procedimento_prestador.exame_clinico_id` (migration
#      `20261019000000`, APLICADA) + o par (`EXAME_PRESTADOR`, id do exame) em
#      `tb_conta_pagar_itens`.
#      ⚠️ `EXAME_PRESTADOR` é origem PRÓPRIA, nunca o reuso de `EXECUCAO_PRESTADOR`: o
#      par (origem, id) é a chave de idempotência, e o exame 47 colidiria com o item de
#      prescrição 47 — a segunda dívida sumiria no `ON CONFLICT DO NOTHING`.
#      ⚠️ `exame_clinico_id` é coluna NOVA e não o reuso de `prescricao_id`, pela mesma
#      razão: guardar as duas origens no mesmo campo torna impossível dizer se o id 47 é
#      a prescrição ou o exame, e o recibo apontaria para o registro errado.
#      ⚠️ Trocar o prestador DEPOIS de o pagamento registrado **não reescreve** o
#      registro (ledger e conta são append-only). Corrige-se em Pagamentos, que é onde o
#      financeiro decide — não em silêncio, por um reenvio de laudo.
#   4. **QUEM EXECUTOU é escolhido na CONCLUSÃO, não no pedido.** O passo de prestador
#      tinha saído da tela de PEDIDO em 2026-09-11 ("o exame é do catálogo da clínica e
#      sai pelo valor padrão dela") — e continua fora de lá. Ele volta no modal de
#      resultado, que é o instante equivalente ao da tela de Execução de Prescrição:
#      quem PEDE o exame ainda não sabe quem vai executá-lo.
#      Campo em `components/SeletorPrestadorExecutante.tsx`, extraído de
#      `ExecucaoPrescricao.tsx` (que passou a consumi-lo) — a metade que mais importa é
#      o AVISO de prestador sem forma de pagamento, e duas cópias dele divergiriam.
#      ⚠️ A lista de prestadores é passada PRONTA na tela de execução: o componente a
#      buscaria sozinho e seriam N requisições iguais, uma por item do plantão.
#      ⚠️ `prestadorId` AUSENTE no body preserva o gravado; string VAZIA é "Não
#      informar" e LIMPA. Reenvio parcial de formulário não pode apagar o prestador.
#   5. **`criarNaoPedido` passou a resolver preço e prestador**, como `criar` já fazia —
#      antes o exame avulso ia SEMPRE zerado para a fatura, mesmo tendo preço no catálogo.
#   6. `lancarExameNaFatura` e `valor_cobrado` NÃO mudaram: o preço do cliente continua
#      sendo o snapshot do dia do PEDIDO. Por isso existe `exameValor.gravarPrestador`
#      (só o prestador) — passar por `gravarPrestadorEValor` na conclusão gravaria NULL
#      por cima do valor e a linha da fatura passaria a divergir do que o cliente viu.
#   Gate: `__tests__/exameImagemProcedimento.test.js` (2 casos novos, verificado que
#   reprovam).

---

# Atualizado em: 2026-09-22 (parte 3) (🔴 **FECHAR A FATURA POR ANIMAL** — o bloco de UM
#   paciente fecha sozinho, dentro da própria fatura, e o que ele cobra SAI do total.
#   Migration `20261018000000_fatura_fechamento_por_animal`, **APLICADA**.)
#   1. 🔴 **O PROBLEMA:** a fatura é do PROPRIETÁRIO e junta TODOS os pacientes dele
#      (seção "Informação do Cavalo" por animal). Quando um cavalo é vendido, muda de
#      responsável ou é acertado à parte no meio do ciclo, não havia como encerrar SÓ a
#      parte dele: ou se fechava a fatura inteira — cobrando junto o que ainda está
#      aberto dos outros pacientes — ou se removia item por item, e **remover APAGA a
#      cobrança**. Fechar a PRESERVA e só a tira desta conta.
#   2. 🔴 **A MARCA É DO ITEM (`fechado_em`), NUNCA DO PAR (fatura, animal).** É isso
#      que faz a cobrança que chega DEPOIS do fechamento nascer ABERTA e voltar a contar
#      no total — com a marca no par, toda dose aplicada depois cairia calada dentro de
#      um bloco já encerrado e o cliente deixaria de ser cobrado por ela. O mesmo animal
#      pode ser fechado de novo quantas vezes o ciclo pedir.
#      ⚠️ `fechado_em IS NULL` no WHERE do fechamento **não é otimização**: é o que
#      preserva a DATA do fechamento anterior na segunda rodada.
#      ⚠️ `NOW() AT TIME ZONE UTC`, nunca `NOW()` puro (§6 — a coluna é `timestamp
#      WITHOUT time zone` e a tela mostraria 3h a menos).
#   3. 🔴 **`Fatura.total` MUDOU DE SENTIDO: é o que a fatura AINDA cobra.** O que sai
#      vai para **`total_fechado`** — o bloco fechado NÃO é "pago" nem "cancelado",
#      continua DEVIDO, só é acertado à parte. Por isso os indicadores de dinheiro a
#      receber passaram a somar **`total + totalFechado`**: `DashboardController`
#      (contas a receber vencidas), `RelatoriosController` (contas a receber/vencidas) e
#      `RelatorioGerencialController` (devedores **e** melhores pagadores). Somar só
#      `total` faria o indicador ENCOLHER a cada fechamento, sem erro e sem log, e
#      ninguém ligaria a queda a um ato feito semanas antes.
#      ⚠️ **O FATURAMENTO do período NÃO muda** — ele soma ITENS, e o item fechado à
#      parte continua sendo receita reconhecida. As duas contas olham coisas diferentes
#      e é correto que não andem juntas. Há teste travando isso nos dois sentidos.
#      ⚠️ `blocoMelhoresPagadores` deixou de ser `groupBy`: o `take: 15` saiu do BANCO e
#      virou `slice` DEPOIS da soma — ordenado por `total` no SQL, o cliente cujo
#      pagamento inteiro estivesse no bloco fechado (total 0) ficaria fora do top 15.
#   4. 🔴 **FONTE ÚNICA `lib/faturaFechamentoAnimal.js`**, e `recalcularTotal`
#      (lib/faturaUtils.js) continua sendo o ÚNICO lugar que grava os totais — é por
#      isso que o fechamento por animal não precisou tocar em nenhum dos ~10 pontos que
#      lançam cobrança.
#      ⚠️ **SQL CRU com guarda de coluna**, padrão de `lib/formasRecebimentoFatura.js`:
#      no Windows o `prisma generate` falha com o backend rodando (§11), e passar
#      `totalFechado` ao `fatura.update` TIPADO nesse estado derrubaria o RECÁLCULO DO
#      TOTAL — a fatura inteira, não só o campo novo. Pelo mesmo motivo `fechadoEm` é
#      anexado à leitura por fora (`anexarFechamento`): o `include` tipado não traz
#      coluna que o client não conhece, e sem ela a TELA mostraria como ABERTO um bloco
#      já fechado, com o botão "Fechar" de volta e o valor contando duas vezes.
#      ⚠️ **`require('./prisma')` é LAZY** (`prismaGlobal()`): no topo do módulo ele
#      derrubaria todo teste que só exercita a aritmética da fatura — `lib/prisma` é
#      TypeScript e o jest não o transpila. Mesma razão de `lib/faturaItemOrigens.js`
#      receber o client por parâmetro.
#      ⚠️ 🔴 **FALHA NA CONSULTA DA GUARDA NÃO É "a coluna não existe"**, e aqui a
#      diferença é DINHEIRO: cravar `false` num soluço do banco faria `recalcularTotal`
#      voltar a somar o bloco FECHADO dentro do total — cobrando de novo o que já foi
#      acertado. Havendo resposta anterior, ela vale; sem nenhuma, devolve `false` SEM
#      cachear, para a próxima chamada perguntar de novo.
#   5. **O bloco fechado NÃO fica somente leitura**, de propósito: fatura FECHADA no
#      S2Vet segue aceitando correção de item (CLAUDE.md, "Fatura fechada vs paga"), e
#      travar só aqui criaria uma regra que o resto do financeiro não tem. Quem congela
#      é o status **PAGA** — e ele é conferido, junto de CANCELADA (400).
#   6. **Rotas** `PATCH /clinica/faturas/:id/animais/:animalId/{fechar,reabrir}`, com o
#      **MESMO slug e nível** de `PATCH /:faturaId/fechar` (`financeiro.faturas.fechar`,
#      PROPRIO): fechar a parte de um paciente é a MESMA decisão, só mais estreita —
#      slug novo faria o gestor configurar duas permissões para um par que é um.
#      ⚠️ **SEM `exigirAcessoAnimal`**: o `:animalId` aqui é a CHAVE DE AGRUPAMENTO das
#      linhas dentro de uma fatura que o escopo da empresa já autorizou
#      (`faturaForaDoEscopo`), não um prontuário sendo aberto. Exigir acesso clínico
#      deixaria o financeiro sem fechar o bloco do paciente atendido por OUTRA equipe —
#      que é justamente o que aparece em `animaisForaDoEscopo` na tela.
#      Marcar + recalcular + auditar (`ALTERACAO`/`FATURA`, com o `animalId`) acontecem
#      na MESMA transaction.
#   7. **Tela** (`Faturamento.tsx`): botão **Fechar paciente** / **Reabrir paciente** no
#      cabeçalho do bloco, subtotal separado, seção âmbar "Fechado à parte — não entra
#      no total da fatura" e, no rodapé, a linha "Fechado à parte (cobrado
#      separadamente, fora do total acima)". Sem essa linha o total simplesmente
#      DIMINUI e não há nada na tela explicando por quê.
#      ⚠️ `ResumoDoBloco` fica FORA de `PainelFatura`: declarado lá dentro seria um tipo
#      de componente NOVO a cada render, e o React remontaria o botão a cada tecla.
#      ⚠️ O total fechado do rodapé é calculado dos ITENS, não lido de
#      `fatura.totalFechado` — é a MESMA fonte que desenha cada bloco, e dois caminhos
#      para o mesmo número divergiriam.
#   8. 🔴 **A FOLHA IMPRESSA/PDF LEVA O BLOCO FECHADO**, separado e fora do total
#      (`FaturaExport.ts`). Omiti-lo entregaria ao cliente uma fatura cujo detalhe não
#      explica o que ele já foi cobrado; somá-lo ao total desfaria o fechamento no
#      papel. No **CSV** virou COLUNA "Situação" + linha "FECHADO À PARTE", nunca linha
#      a menos: tirar o item do arquivo mudaria o número de linhas que o financeiro usa
#      como base de conferência.
#   ✅ **MIGRATION APLICADA** (autorizada) — ADITIVA e **SEM BACKFILL**: item existente
#   nasce com `fechado_em` NULO (= aberto) e `total_fechado` começa em 0 em toda fatura.
#   **Nenhuma fatura muda de valor ao aplicá-la.** Conferido depois: 136 itens, **0
#   fechados**, 38 faturas, soma de `total_fechado` **0**. `migrate status`: 206
#   migrations, banco em dia. RLS: **nada a fazer** — as duas tabelas já têm policy, e é
#   por isso que o fechamento virou COLUNA e não tabela nova (tabela exigiria policy,
#   entrada no `tenancyMap` e inventário de órfãs).
#   ⚠️ `prisma generate` FALHOU com **EPERM** (§11, backend rodando) e **não bloqueia**:
#   tudo aqui é SQL cru, e as verificações ao vivo rodaram com o client NÃO regenerado.
#   Rodar na próxima parada do backend.
#   ✅ **CONFERIDO AO VIVO** com o CÓDIGO REAL contra a base, em transação REVERTIDA
#   (fatura #93, 2 pacientes, 10 itens, R$ 320,00): fechar o bloco do paciente 93 marcou
#   7 itens e deixou **total R$ 300,00 + totalFechado R$ 20,00**, somando os mesmos
#   R$ 320,00; fechar de novo marcou **0** (idempotente); reabrir devolveu os 7 e o total
#   voltou a R$ 320,00 com `totalFechado` zerado.
#   ✅ **RLS CONFERIDO AO VIVO** com o usuário da APLICAÇÃO, em transação revertida: a
#   empresa 59 fechando o bloco da fatura #85 (empresa 58) afeta **0 linhas**; a dona
#   afeta 5.
#   Gate novo `__tests__/faturaFechamentoPorAnimal.test.js` (29 casos). ✅ **Verificado
#   que REPROVA**: devolvido o `recalcularTotal` a somar tudo e removido o
#   `fechado_em IS NULL`, **6 casos falharam**. Suíte: **1362**; `tsc --noEmit`
#   (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.

---

# Atualizado em: 2026-09-22 (🔴 **A FATURA PASSOU A SAIR SÓ PELOS CANAIS QUE O
#   CLIENTE ESCOLHEU** — e-mail, WhatsApp e/ou impresso, marcados no cadastro do
#   proprietário. Coluna `formas_recebimento_fatura` em `tb_proprietario_perfis`,
#   migration `20261017000000`.)
#   1. 🔴 **A ESCOLHA É POR EMPRESA, e por isso mora no cadastro do CLIENTE naquela
#      clínica** (`tb_proprietario_perfis`, §36) — quem pede impresso no haras pode
#      querer WhatsApp na outra. Guardá-la em `users` (que é só IDENTIDADE, global)
#      faria a preferência combinada aqui reescrever a da clínica vizinha. É a MESMA
#      casa de `dia_vencimento_fatura`, o outro campo de COBRANÇA do cliente, lido
#      dali por `FaturaController.diaVencimentoDoProprietario`.
#   2. 🔴 **NULL / VAZIO = TODAS AS FORMAS, e é isso que a migration preserva.** Não há
#      backfill de propósito: nenhum cliente já cadastrado declarou preferência, e
#      qualquer escolha diferente de "todas" TIRARIA um botão de envio que a clínica
#      usa hoje — em silêncio, na base inteira, sem erro e sem log. O default vive em
#      DOIS lugares que precisam concordar: `formasDoTexto`/`anexarFormas` no backend
#      e `formaLiberada` no front (`utils/formasRecebimentoFatura.ts`).
#      ⚠️ **Lista VAZIA no payload NÃO é a mesma coisa que ausência**: é escolha
#      inválida (o cliente não receberia a fatura por meio nenhum) e dá **400**. Quem
#      nunca declarou fica com NULL, que é outra coisa.
#   3. ⚠️ **DESABILITA, não esconde.** Na tela de Faturamento o canal recusado fica
#      CINZA (§6 — cinza é o indisponível), com o motivo e o caminho da correção no
#      `title`, e o card do cliente escreve "Recebe a fatura por: …". NÃO é a
#      armadilha 28-d (botão que só falha DEPOIS do clique): ali ele nem aceita o
#      clique, e a pessoa TEM a permissão — quem não quer o canal é o cliente. Sumindo,
#      o financeiro lê como perda de permissão e ninguém descobre que a decisão está
#      no cadastro.
#   4. ⚠️ **O guard também mora no HANDLER, não só no `disabled`** (`handleEmail`,
#      `handleShare`, `handlePDF` → `setErroInline`): atributo desabilitado não é
#      regra, é aparência — teclado e leitor de tela passam por cima.
#   5. ⚠️ **O FECHAMENTO EM LOTE entrou junto**, senão viraria a porta dos fundos para
#      o canal recusado. `CompartilharPdfBotoes` ganhou `whatsappIndisponivel` /
#      `emailIndisponivel` (texto não vazio = desabilita + vira o tooltip), e a
#      preferência sai da MESMA lista que a tela já carregou.
#   6. ⚠️ **Exportar CSV FICA DE FORA, de propósito**: baixa arquivo para a clínica,
#      não entrega nada ao cliente — a mesma distinção que dá cor própria ao
#      "exportar" na §6. Nunca bloquear aquele botão por preferência de cliente.
#   7. ⚠️ **LEITURA/ESCRITA SEMPRE por `lib/formasRecebimentoFatura.js`** (SQL cru com
#      guarda de existência da coluna, padrão de `lib/animalFei.js`). A coluna **NÃO**
#      entra em `CAMPOS_PERFIL` de `lib/proprietarioPerfil.js`: aquele monta o `select`
#      TIPADO e, no Windows, o `prisma generate` falha com o backend no ar — um client
#      defasado derrubaria o CADASTRO DE CLIENTE inteiro, não só o campo (§11).
#   8. ⚠️ **A gravação é um `UPDATE` e vai DEPOIS do `salvarPerfil`** (os 3 pontos:
#      criar-com-login-existente, criar-cliente-novo e atualizar, mais a transferência
#      de propriedade do paciente). Antes do upsert do perfil ela acertaria ZERO
#      linhas, em silêncio — a escolha some e ninguém percebe até o financeiro
#      reclamar.
#   9. ⚠️ **A ordem gravada é a canônica** (`EMAIL,WHATSAPP,IMPRESSO`), reordenada no
#      front e no back: a mesma escolha em ordem de clique diferente geraria CSVs
#      diferentes e a auditoria acusaria alteração onde não houve.
#  10. **Gate estrutural**: `__tests__/formasRecebimentoFatura.test.js` (18 casos) trava
#      os dois lados juntos — o cadastro que GRAVA e a tela que OBEDECE —, o default
#      "ausente = todas" nos dois lados, a ordem da gravação e o CSV fora da regra.
#      Verificado que REPROVA: desfeitos o default do front, o `disabled` do e-mail e o
#      fallback do `formasDoTexto`, 3 casos falham.
#
#  ONDE MEXEU: migration `20261017000000_proprietario_formas_recebimento_fatura`,
#  `lib/formasRecebimentoFatura.js` (novo), `ProprietarioController` (criar/atualizar/
#  listar/obterPorId/buscarPorEmail + diff da auditoria), `FaturaController.
#  listarProprietarios` (os dois ramos), `lib/transferenciaPropriedadeAnimal.js`,
#  `utils/formasRecebimentoFatura.ts` (novo), `ProprietarioFormModal`,
#  `CadastroProprietario`, `Faturamento.tsx` e `CompartilharPdfBotoes`.

---

# Atualizado em: 2026-09-19 (parte 2) (🔴 **A COMPRA DO ESTOQUE CHEGAVA A TELA DE
#   PAGAMENTOS COM O VALOR AO QUADRADO** + a compra de VACINA passou a virar divida.
#   1. 🔴 **O DEFEITO, MEDIDO NA BASE: `valor` da linha e UNITARIO, e a farmacia
#      mandava o TOTAL.** `recalcularTotal` faz `SUM(i.valor * i.quantidade)` e a tela
#      de Pagamentos exibe `it.valor * it.quantidade` — o contrato dos outros TRES
#      chamadores de `lancarItem` (execucao de prescricao, vacina e prestador), que
#      sempre passaram o unitario. `lancarCompraDoFornecedor` passava
#      `valor = valorEmbalagem x embalagens` **e** `quantidade = embalagens`:
#      ```
#      gravado na base : qtd 10 x R$ 1.000,00  ->  a tela mostrava R$ 10.000,00
#      a compra real   : 10 embalagens de R$ 100,00  =  R$ 1.000,00
#      ```
#      As duas linhas `ESTOQUE_ENTRADA` da base somavam **R$ 22.000** onde a clinica
#      devia R$ 2.200. Nada acusa: o numero e plausivel e a conta fecha "certa".
#      ⚠️ **AS DUAS LINHAS JA GRAVADAS CONTINUAM ERRADAS** — a correcao vale daqui em
#      diante. Corrigir e pelo "Editar valor" do item, na propria tela de Pagamentos
#      (o valor de cada uma passa a ser o da EMBALAGEM: 1000->100 e 1200->120).
#   2. ⚠️ **A QUANTIDADE E DE EMBALAGENS, NUNCA O SALDO — o "independente de doses"
#      do pedido.** Sem `qtdEmbalagens` (entrada avulsa, cliente antigo), o fallback
#      caia em `qtdEstoque`; num multidose o saldo esta no CONTEUDO (3 frascos de
#      20 mL = 60), e ele cobraria **60 frascos de quem entregou 3**. Novo
#      `embalagensCompradas` divide o saldo pelo conteudo que o produto declara, e so
#      cai no saldo cru quando nao ha conteudo (nao-multidose, em que a embalagem e a
#      propria unidade). Exportada para teste — o modo de errar e silencioso.
#   3. 🔴 **A ENTRADA DE ESTOQUE DE VACINA PASSOU A LANCAR A COMPRA** (nao lancava
#      nada): `lancarCompraDaVacina`, espelho do da farmacia, com
#      **`valorUnitario` (POR FRASCO) x `qtdFrascos`**. `qtdTotal`/`dosesPorFrasco`
#      ficam FORA da conta — sao DOSES, e ha gate reprovando a mencao a eles.
#      ⚠️ **IDEMPOTENCIA ASSIMETRICA, de proposito.** A farmacia ancora a origem no
#      `MovimentoEstoque` (um por COMPRA); **a vacina nao tem tabela de movimento**
#      (decisao registrada em `ajustar`: o motivo vive no AuditLog). Entao: entrada
#      NOVA -> `origemId` = id do LOTE (idempotente); **CONSOLIDACAO -> `origemId`
#      NULO**. Com o id do lote repetido, o indice unico parcial casaria no
#      `ON CONFLICT` e a SEGUNDA compra do mesmo lote seria **descartada em
#      silencio** — a clinica pagaria uma e deveria zero pela outra. `origemTipo`
#      (`ESTOQUE_VACINA_ENTRADA`) fica preenchido: perde-se a idempotencia, nunca a
#      rastreabilidade.
#      ⚠️ Best-effort e FORA da transaction, como na farmacia: a entrada e ato de
#      ESTOQUE e nao se desfaz porque a conta a pagar falhou.
#   4. **FORNECEDOR + NOTA FISCAL na Entrada de Vacina** (a pedido). As colunas
#      existiam desde a migration `20261006000000` e **so a tela de Produtos as
#      gravava** — a entrada nao sabia dizer de quem veio o frasco, entao nao havia a
#      quem dever. Gravadas por SQL cru (`produtoFornecedor.gravarFornecedorNoLote`,
#      Secao 11) e LIDAS em bloco na listagem (`fornecedoresDeLotes`).
#      ⚠️ **A LISTAGEM TEM DE DEVOLVER O CAMPO**: sem isso a edicao abriria com o
#      fornecedor em branco e o salvar o APAGARIA em silencio — a licao do
#      `temposConsulta` (2026-07-28 parte 4).
#      ⚠️ O fornecedor e **OPCIONAL**: sem ele a entrada acontece (so nao vira
#      divida). Exigi-lo travaria o estoque por causa de um cadastro, com o frasco ja
#      na clinica. ⚠️ Na CONSOLIDACAO so preenche o que esta VAZIO — o lote ja
#      registrou de quem veio a 1a compra —, mas a DIVIDA e de quem entregou AGORA.
#      ⚠️ **Editar o lote NAO lanca conta a pagar**: corrigir cadastro nao e comprar
#      (mesma regra do `atualizar` da farmacia). `undefined` PRESERVA o gravado.
#   5. **"Ler documento de compra" -> "Carregar Nota Fiscal"** (a pedido), no titulo do
#      modal e no botao da Farmacia.
#      ⚠️ **ISSO REVERTE O NOME AMPLIADO DE 2026-09-10, e a razao dele CONTINUA DE
#      PE**: enquanto o rotulo dizia so "nota fiscal", quem tinha um ORCAMENTO DE
#      BALCAO na mao nao tentava — e o balcao veterinario entrega o tempo todo papel
#      com "SEM VALOR FISCAL" impresso. Por isso o texto de apoio do modal e o
#      `title` do botao seguem dizendo, com todas as letras, que cupom, orcamento e
#      recibo sao aceitos. **Nao apagar essas frases junto com o titulo.** O backend
#      (`ai/prompts/lerNotaFiscal.js`) nao mudou: o criterio continua sendo COMPRA,
#      nao documento fiscal.
#   6. **O MESMO botao no ESTOQUE DE VACINAS** (a pedido) — rota nova
#      `POST /vacinas/estoque/documento-compra`, com o **MESMO** controller da
#      farmacia (`NotaFiscalController.ler`) e o gate `vacina.estoque.criar`. O
#      componente foi PARAMETRIZADO (`rota`, `tipoItem`), nao copiado: duas leituras
#      divergiriam na primeira correcao (28-g).
#      ⚠️ `tipoItem` faz os itens do tipo da tela nascerem MARCADOS; os do outro tipo
#      aparecem DESMARCADOS, com aviso — **nao sao escondidos**: a nota do balcao
#      mistura vacina e medicamento, sumir com metade dela faria a pessoa concluir que
#      a leitura falhou, e a classificacao e da IA e pode errar.
#      ⚠️ `/documento-compra` LITERAL antes de `/:id` (armadilha 1) e `tenantRls`
#      REENTRA apos o multer. Extensao E mimetype validados (SVG e HTML executavel).
#      ⚠️ Usar a nota **LIMPA o filtro de laboratorio**: a lista de vacinas e recortada
#      por ele e o casamento por nome procura NELA — com um laboratorio escolhido, a
#      vacina da nota cairia em "nao achei".
#   7. **`utils/fornecedorProduto.ts`** — o recorte "quem entrega PRODUTO" (Farmacia .
#      Laboratorio . Loja) saiu de dentro de `Farmacia.tsx` e virou fonte unica das
#      duas telas. Duas listas divergiriam, e o que divergiria e **para quem a conta a
#      pagar vai**.
#   **NENHUMA MIGRATION** — as colunas ja existiam. Gate novo
#   `__tests__/compraEstoqueContasPagar.test.js` (23 casos).
#   ✅ **Verificado que REPROVA**: devolvido o total pre-multiplicado a farmacia e
#   postas as doses na quantidade da vacina + o id do lote na consolidacao,
#   **2 casos falharam**.
#   ✅ **CONFERIDO AO VIVO** com o CODIGO REAL contra a base, em transacao REVERTIDA
#   (0 linhas ao fim): 10 embalagens x R$ 100 gravam **qtd 10 x R$ 100 = R$ 1.000**
#   (eram R$ 10.000); 3 frascos x R$ 80 = R$ 240; o total do banco fecha em R$ 1.240;
#   o REENVIO da mesma origem e descartado; e a 2a compra do mesmo lote (origem nula)
#   entra, levando o total a R$ 1.400.
#   Suite: **1184**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NAO verificado em navegador — sem ferramenta de browser nesta sessao.)
---

### Sessão 2026-09-19 (parte 2) — A compra do estoque na conta a pagar

> **SEM MIGRATION** — `tb_lotes_vacina.fornecedor_id`/`nota_fiscal` são da
> `20261006000000` e só não eram gravadas por esta tela. Suíte: **1184**;
> `tsc --noEmit`, `tsc -b` e `vite build` limpos. NÃO verificado em navegador.

- [x] 🔴 **O valor chegava AO QUADRADO na tela de Pagamentos** — ver o item 1 no topo
      deste arquivo. O contrato de `lancarItem` é `valor` UNITÁRIO; a farmácia mandava
      o total já multiplicado E a quantidade ao lado. Medido na base: R$ 22.000 onde a
      clínica devia R$ 2.200.
- [x] **`embalagensCompradas`** (exportada para teste) — a quantidade é de EMBALAGENS,
      nunca o saldo em doses.
- [x] **Vacina: `lancarCompraDaVacina`** (`valorUnitario × qtdFrascos`) + fornecedor e
      nota fiscal na entrada, com a idempotência assimétrica explicada no topo.
- [x] **"Carregar Nota Fiscal"** nas duas telas, com o leitor PARAMETRIZADO (`rota`,
      `tipoItem`) em vez de copiado.
- [ ] As DUAS linhas `ESTOQUE_ENTRADA` já gravadas seguem com o valor antigo (R$ 1.000
      e R$ 1.200 por unidade, totalizando R$ 22.000). O "Editar valor" da tela de
      Pagamentos corrige item a item; um UPDATE em massa seria escrita em dado gravado
      e precisa de autorização.
- [ ] O estoque de vacinas continua **sem tabela de movimento**. É ela que daria à
      consolidação uma origem própria (e idempotência); hoje a 2ª compra do mesmo lote
      entra sem chave de origem.
- [ ] A tela de Pagamentos não distingue, na linha, compra de ESTOQUE de item de
      execução — as duas aparecem como item do fornecedor. O `origem_tipo` está
      gravado, então é só exibição, se um dia fizer falta.

---

# Atualizado em: 2026-09-18 (LEVA DE 12 PEDIDOS. O que mais importa saber ao voltar:
#   1. 🔴 **A ROTINA DE FINALIZAR EVOLUÇÃO COM +48h NUNCA EXISTIU** — foi relatada como
#      "existe e não está executando". O que existe é
#      `cancelarAgendamentosNaoRealizados`, que encerra o AGENDAMENTO e deixava a
#      EVOLUÇÃO de fora DE PROPÓSITO ("fechá-la sozinha é uma decisão maior do que a
#      desta rotina" — CLAUDE.md 2026-08-18 parte 2). Essa decisão foi REVERTIDA a
#      pedido, e a cautela que a motivou virou a janela de 48h. Novo
#      `services/evolucaoCronService.js` + job `finalizar_evolucoes_abandonadas`
#      (**23:50**, DEPOIS dos crons de 23:30/23:40 — antes deles a rotina mandaria a
#      prescrição ao plantão no mesmo minuto em que o outro cron a cancelaria por fim
#      de janela). Justificativa gravada: **"Finalizada pelo Sistema"**, em
#      `justificativaExclusao` — a coluna que alimenta a coluna "Justificativa" das
#      listas do módulo Atendimento.
#      ⚠️ **`veterinarioId` NÃO é reescrito** — mesma regra da finalização por
#      inativação do paciente (2026-09-06): ninguém conduziu esta finalização, é
#      consequência administrativa, e carimbar um nome no prontuário alheio falsearia a
#      autoria clínica. `porUsuarioId` vai `null` na cascata pelo mesmo motivo.
#      ⚠️ Usa a `cascataDaFinalizacao` COMPARTILHADA (agendamento → FINALIZADO,
#      prescrição/vacina SALVAS → plantão) e invalida a `versao` EM LOTE — quem tiver a
#      evolução aberta leva 409 em vez de gravar sobre um atendimento já fechado.
#      ⚠️ NÃO lança exame na fatura: `paraCadaEmpresa` abre UMA transação por empresa e
#      `lancarExameNaFatura` lança `FaturaPagaError` — derrubaria o fechamento de TODAS
#      as evoluções da clínica por causa de uma fatura paga. O exame continua sendo
#      lançado quando alguém o conclui (`ExameClinicoController.finalizar`).
#      Gate `__tests__/evolucaoAbandonada.test.js` (13 casos). ✅ Verificado que REPROVA:
#      removida a cascata, reescrito o responsável e renomeado o job, **5 falharam**.
#   2. 🔴 **O MAPA DE ATENDIMENTO NÃO COMPUTAVA PRESCRIÇÃO.** O `where` trazia só
#      `['FINALIZADO','CANCELADO_PARCIALMENTE']` enquanto a classificação logo abaixo
#      decide entre **EXECUTADO / CANCELADO / ATRASADA / AGENDADO**: os dois status de
#      que ela precisa NUNCA chegavam nela, então os cartões "Executadas" e "Não
#      executadas / Atrasadas" ficavam em ZERO — o grupo some do resultado no instante
#      em que vira EXECUTADO. O ramo `jaExecutadoHoje` disfarçava no modo Diário e só
#      nele. Agora é a MESMA lista de `listarParaExecucao` (o Histórico do plantão), que
#      é a fonte com que este painel precisa concordar.
#   3. 🔴 **A ENTRADA DE ESTOQUE PASSOU A LANÇAR A COMPRA EM CONTAS A PAGAR.** Ela
#      gravava `fornecedorId` e parava aí — o campo era etiqueta na linha do estoque.
#      `tb_contas_pagar` (2026-09-10) nasceu alimentada pela EXECUÇÃO (o produto que a
#      clínica não estoca); a compra que ENTRA no estoque nunca teve quem a lançasse: a
#      clínica comprava, o saldo subia e a dívida não existia em lugar nenhum.
#      ⚠️ **A ORIGEM É O MOVIMENTO, não a linha de estoque.** A entrada CONSOLIDADA
#      (mesmo lote, validade e valor) reusa a `EstoqueClinica`, e com o id dela no
#      `ON CONFLICT (origem_tipo, origem_id)` a SEGUNDA compra do mesmo lote seria
#      descartada em silêncio — a clínica pagaria uma e deveria zero pela outra.
#      ⚠️ Valor = **valor da EMBALAGEM × qtd de embalagens** (desde 2026-09-17 parte 2
#      `valor` é por embalagem; usá-lo cru lançaria o preço de UMA caixa por dez).
#      ⚠️ FORA da transaction do estoque e best-effort: a entrada é ato de estoque e não
#      se desfaz porque a conta a pagar falhou.
#   4. 🔴 **"LER DOCUMENTO DE COMPRA" DE VOLTA — agora na FARMÁCIA.** Foi desmontada em
#      2026-09-15 e o controller/serviço ficaram inteiros com o bilhete "provavelmente
#      na Farmácia, que é quem trata de compra". É exatamente lá. Rota nova
#      `POST /farmacia/estoque/documento-compra` (gate `farmacia.estoque.criar`, multer
#      + `tenantRls` APÓS o multer, LITERAL antes de `/estoque/:id`) e
#      `components/farmacia/LeitorDocumentoCompra.tsx`.
#      🔴 **UMA NOTA TRAZ VÁRIOS PRODUTOS** (o pedido): os marcados entram numa FILA e o
#      formulário de entrada abre preenchido um por vez — salvou, abre o próximo. O
#      serviço já devolvia `itens[]`; o que faltava era a porta de entrada.
#      ⚠️ O item traz NOME, não id de catálogo: o casamento é por nome sem acento/caixa
#      e **"não achei" NÃO é erro** — o campo de busca abre com o nome lido para a
#      pessoa escolher. Inventar um `medicamentoId` daria entrada no produto errado.
#      ⚠️ A fila só avança no SUCESSO do salvar: falhou, o item fica na tela para ser
#      corrigido, nunca é pulado em silêncio.
#   5. 🔴 **PAGAMENTOS: procedimento SEM VALOR passou a ser LANÇADO, zerado e editável.**
#      ⚠️ **INVERTE** a regra de 2026-09-10 ("dívida de valor inventado é pior que
#      dívida ausente") — e o caso de teste que a travava foi INVERTIDO junto, como o de
#      `faturaConsolidacao` em 17/09. A parte certa dela continua valendo: o valor vai
#      **ZERO**, nunca um palpite. O que mudou é que o silêncio ESCONDIA a pendência em
#      vez de evitá-la — o serviço era prestado, a clínica devia, e a tela não mostrava
#      nada. `lancarItem` só aceita zero com `permitirSemValor: true`: quem lança
#      DECLARA que aquele zero é pendência, não um item de graça.
#      Na tela o item zerado sai como **"a definir"** em âmbar, nunca "R$ 0,00" (que se
#      leria como "é de graça" e sumiria entre os outros números).
#      Edição por `PATCH /financeiro/contas-pagar/itens/:itemId`, **só em conta ABERTA**
#      — e quem garante isso é o `WHERE` do UPDATE, não a tela.
#   6. **A tela de Pagamentos ganhou Imprimir e WhatsApp (na CONTA) e Editar valor (no
#      ITEM).** Folha nova `utils/ContaPagarPrint.ts`.
#      ⚠️ **NÃO é um recibo**: o recibo (`ReciboPrestadorPrint`) é o comprovante de
#      QUITAÇÃO, assinado por quem RECEBE; esta folha lista o que ainda se DEVE, para
#      conferência antes de pagar. Imprimir uma dívida em papel de recibo entregaria ao
#      fornecedor um documento dizendo que a clínica pagou o que não pagou.
#      ⚠️ Sem PIX/dados bancários, pela mesma razão do recibo do prestador: aqueles
#      campos existem para o CLIENTE pagar a clínica.
#      ⚠️ Imprimir e WhatsApp valem em QUALQUER status (são saída de conteúdo) — é
#      justamente a conta encerrada que alguém reimprime para conferir.
#   7. **PROCEDIMENTOS: o campo de busca virou a porta do cadastro.** Digitar um nome
#      que não existe oferece **Cadastrar "X"** → `POST /procedimentos/cadastro/proprio`
#      (`garantirProcedimentoDaEmpresa`, o MESMO helper que a Prescrição e o Orçamento
#      já usavam).
#      ⚠️ Gate `cadastro.procedimento.criar`, **NÃO `requireAdmin`**: o que nasce aqui é
#      a linha DA EMPRESA. O `POST /procedimentos` continua ADMIN-only porque escreve o
#      catálogo GLOBAL, que vale para todas as clínicas.
#      ⚠️ O teste de "já existe" é casamento EXATO (sem caixa/acento): com `includes`,
#      "Ferrageamento corretivo" nunca seria oferecido só porque "Ferrageamento" aparece
#      no filtro. A criação é idempotente por (nome, empresa).
#   8. **O PROPRIETÁRIO GANHOU "Terá acesso ao Sistema"**, com a MESMA lógica e o MESMO
#      caminho do Incluir Membro: `tb_usuario_empresa.acesso_sistema`, que é quem
#      `podeAcessarSistema` consulta no login, no 2FA, no Google OAuth e no refresh —
#      não existe uma segunda chave de acesso para cliente. Aplicado nos TRÊS caminhos
#      (usuário novo, usuário que já existe e ALTERAÇÃO): "independente do momento" era
#      o pedido. Liberar numa ALTERAÇÃO dispara o e-mail com os dados de acesso.
#      ⚠️ A senha é DERIVADA (`lib/senhaInicial.js`) e sai SÓ por e-mail — quem preenche
#      o formulário é um TERCEIRO (regra de 2026-09-08). Determinística de propósito:
#      reenviar o acesso não redefine a senha de quem já entrou.
#      ⚠️ `undefined` NÃO MEXE em nada: cliente legado (ou tela que não manda o campo)
#      mantém o acesso que tem — assumir `false` revogaria o login de todo mundo no
#      primeiro salvar, em silêncio.
#      **Valor da Assistência e Dia de Vencimento só são editáveis no MENSALISTA**, e
#      ficam DESABILITADOS, não escondidos: sumindo, quem marca "Mensalista" não
#      descobre que precisa preenchê-los. A validação do dia passou a valer só no
#      mensalista — validar o que não se pode editar trava o salvar sem dar como
#      corrigir (o cliente legado com valor fora da faixa ficaria impossível de salvar).
#   9. 🔴 **PROCEDIMENTO NA EXECUÇÃO: o histórico mostra QUEM EXECUTOU, não quem
#      clicou.** `executadoPorDose`/`g.executadoPor` guardam o USUÁRIO LOGADO — certo
#      para medicamento (quem aplicou a dose estava no plantão), errado para
#      procedimento, que tem campo PRÓPRIO para dizer quem o realizou (o prestador
#      escolhido no modal, que já governa recibo e conta a pagar). O ferrador executava
#      e ficava registrado o nome da secretária que deu o clique.
#      ⚠️ Sem prestador informado o procedimento É da própria equipe — aí o executor é
#      mesmo quem clicou, e a regra de sempre continua valendo.
#  10. **PRODUTOS: rótulos sem negrito** (`rotuloCls` com `font-normal`); só "Produto
#      multidose" segue destacado — ele não é um campo a preencher, é a CHAVE que muda o
#      significado do cadastro (a embalagem passa a ser medida por dentro).
#      **Unidade: saíram "%" e "Seringa"** — concentração e apresentação, não medida da
#      embalagem (a Pasta 10% é medida em g; "Seringa" tem campo próprio logo acima).
#      ⚠️ **"Unidade" por extenso saiu do seletor, mas 'Un.' FICA e é GARANTIDA.**
#      Produto sem multidose é medido em 'Un.' por regra (`lib/formaCalculo.
#      unidadeOperativa`), e o backend só ACRESCENTA 'Un.' ao catálogo quando nenhuma
#      das existentes já significa isso (`garantirUnidadeAvulsa` reconhece un / Un. /
#      unid / unidade). Numa base cujo catálogo tenha só "unidade" por extenso, remover
#      a palavra deixaria o não-multidose SEM unidade nenhuma para escolher. As grafias
#      por extenso são colapsadas em 'Un.', a canônica.
#  11. **PAINEL PRINCIPAL ESCONDIDO DO MENU** (`MOSTRAR_PAINEL_PRINCIPAL = false`) — a
#      tela NÃO foi removida: rota `/painel-principal`, `pages/PainelPrincipal.tsx` e o
#      gate `dashboard.geral.ler` seguem montados e funcionais. Mesmo padrão (e mesma
#      lição) do `MOSTRAR_MAPA_ATENDIMENTO` de 2026-09-05, que fez a volta dele custar
#      UMA LINHA em 09/09. ⚠️ Para trazer de volta, troque para `true` e REMOVA o flag
#      junto — um `if (true)` não configura nada.
#   **NENHUMA MIGRATION NESTA LEVA** — nada de schema mudou. Suíte: **1113**;
#   `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

# Atualizado em: 2026-09-17 (parte 3) (🔴 **A LINHA DA FATURA PASSOU A JUNTAR
#   ATENDIMENTOS, e o número deles virou OBSERVAÇÃO** — a pedido.
#   1. 🔴 **O DEFEITO RELATADO:** "a cada execução de prescrição está sendo lançado um
#      item". Doses do MESMO item de prescrição já consolidavam desde 2026-08-25; o que
#      NÃO consolidava era o resto — porque a chave incluía a **FK DE ORIGEM** e a
#      descrição começava com o **número do atendimento** (`[AG-0012] Amoxicilina — …`).
#      O mesmo medicamento, na mesma dose e pelo mesmo preço, aplicado em dois
#      atendimentos do mês, virava DUAS linhas idênticas fora o número:
#      ```
#      antes : [AG-0012] Amoxicilina — 10mL × 12/12h   Quant.: 3   R$  60,00
#              [AG-0031] Amoxicilina — 10mL × 12/12h   Quant.: 2   R$  40,00
#      agora : Amoxicilina — 10mL × 12/12h             Quant.: 5   R$ 100,00
#              ↳ AG-0012 · 15/09 · Quant.: 3
#              ↳ AG-0031 · 17/09 · Quant.: 2
#      ```
#   2. **A CHAVE VIROU (tipo, descrição, animal, valor unitário)** — sem a origem. A
#      "forma de cobrança" do pedido já estava coberta: ela se manifesta no VALOR
#      UNITÁRIO, que a chave sempre comparou (com tolerância de centavo).
#      ⚠️ **A POSOLOGIA FICA na descrição** (decisão desta sessão): duas prescrições do
#      mesmo remédio com frequências diferentes seguem em linhas separadas — fundi-las
#      faria a linha AFIRMAR uma posologia que metade das doses não teve.
#   3. 🔴 **TABELA NOVA `tb_fatura_item_origens` — é ela que mantém o ESTORNO certo.**
#      Era a FK na chave que impedia "cancelar uma prescrição levar embora a cobrança da
#      outra"; com a linha compartilhada, apagá-la inteira faria exatamente isso. Uma
#      linha por CONTRIBUIÇÃO (origem, data, quantidade), e `removerFaturaItensDaOrigem`
#      passou a **SUBTRAIR**: sai só o que era daquela origem, a linha sobrevive com o
#      resto, e a FK de origem principal é **REAPONTADA** para quem ficou. Sem nenhuma
#      contribuição sobrando, aí sim a linha é apagada.
#      ⚠️ **INVARIANTE: `FaturaItem.quantidade` = soma das contribuições.** Por isso
#      `adicionarFaturaItem` TAMBÉM grava a 1ª contribuição — sem ela a linha teria
#      quantidade 3 com 2 contribuições, e o estorno subtrairia menos do que devia.
#      ⚠️ **As duas coisas andam juntas**: não reintroduza a origem na chave sem desfazer
#      a subtração, nem remova as contribuições sem devolver a origem à chave.
#   4. 🔴 **"JÁ FOI FATURADO?" DEIXOU DE PODER SAIR DA FK** (`origemJaFaturada`). A FK da
#      linha guarda só a origem PRINCIPAL: a SEGUNDA vacina a cair nela foi cobrada e a
#      FK não a menciona. E é esse "sim" que, no CANCELAMENTO da vacina, prova que o lote
#      foi debitado e autoriza devolver as doses ao estoque — um falso "não" ali deixaria
#      o **estoque encolhido em silêncio** (o bug de 2026-08-18 de volta por outro
#      caminho). Trocado nos 3 pontos da vacina, no `finalizar` da prescrição e no
#      lançamento de exame.
#   5. **A DESCRIÇÃO PERDEU O NÚMERO nos dois lados** — `[AG-0012]` da prescrição e do
#      insumo, `[VC-0004] [AG-0012]` da vacina. Enquanto ele estava lá, a chave nunca
#      casava entre atendimentos: a consolidação existiria no código e não aconteceria na
#      prática. ⚠️ Exame e encaminhamento MANTÊM o prefixo (`[EX-0004]`) de propósito: são
#      lançamento único, nunca consolidam, e mexer neles não tinha o que ganhar.
#   6. ⚠️ **A REUTILIZAÇÃO DA LINHA ZERADA DA FINALIZAÇÃO GANHOU GUARDA.** `executar`
#      reaproveita, na 1ª execução, a linha que a finalização criou (`findFirst` pela FK)
#      e sobrescreve `descricao`+`valor`. Com a linha compartilhada esse `findFirst` pode
#      devolver uma linha que JÁ tem doses de outra prescrição — e reprecificá-la
#      reescreveria o que a outra cobrou. `temOutraOrigem` bloqueia; `null` ("não sei",
#      base sem a tabela) NÃO bloqueia, porque lá nada é compartilhado. Mesma razão em
#      `atualizarFaturaItensDaOrigem`: linha compartilhada não é renomeada.
#   7. **A FINALIZAÇÃO TAMBÉM CONSOLIDA** (o item que o proprietário aplica em casa, que
#      nunca chega ao plantão): deixá-la abrindo linha nova daria à MESMA fatura duas
#      regras para a mesma pergunta. Não sobrou nenhum `adicionarFaturaItem` na prescrição.
#   8. **A OBSERVAÇÃO NA TELA** (`Faturamento.tsx`): `↳ AG-0012 · 15/09 · Quant.: 3`, uma
#      por execução, com o número CLICÁVEL. ⚠️ O destino é o REGISTRO DE ORIGEM e muda por
#      tipo — **VACINA abre a tela de Vacina** (`/clinica/vacina/:animalId?item=`), o resto
#      abre o atendimento; quem resolve é o BACKEND, a tela só usa o que veio.
#      ⚠️ **Só aparece com 2+ contribuições**: com uma só, o badge do número + a data +
#      "Quant.: 1" já dizem tudo, e uma lista de um item seria ruído em toda fatura. Com
#      duas ou mais o badge SAI (ele é o número da PRIMEIRA execução, e no cabeçalho
#      pareceria valer pela linha inteira) e a data da linha some junto.
#      ⚠️ INSUMO (seringa/agulha) não mostra nem um nem outro — é linha FILHA.
#      ⚠️ Contribuição sem destino resolvido ainda APARECE, só não vira link: sumir com
#      ela faria a soma da observação não bater com a quantidade da linha.
#   9. 🔴 **A OBSERVAÇÃO VAI TAMBÉM PARA A FATURA IMPRESSA** (`FaturaExport.ts`), e não é
#      enfeite: ANTES da consolidação cada aplicação era uma LINHA no papel, com número e
#      data. Consolidar sem levar o detalhe junto entregaria ao cliente um "Quant.: 5"
#      que ele não tem como conferir — **menos** informação do que ele recebia, não mais.
#      Vale para impressão, PDF, WhatsApp e e-mail (todos saem do MESMO HTML).
#  10. ✅ **MIGRATION APLICADA** (autorizada) — `20261015000000_fatura_item_origens`, com
#      o DONO (`nutriadmin`): `CREATE TABLE` e `CREATE POLICY` pedem OWNERSHIP, não GRANT.
#      `migrate status`: **203 migrations, banco em dia**. ADITIVA e **SEM BACKFILL**:
#      linha já lançada fica como está — sem contribuição ela cai no comportamento
#      anterior (o estorno apaga a linha inteira) e a tela não mostra observação.
#      Conferido DEPOIS, contra o retrato de ANTES: **110 itens de fatura, soma de
#      quantidade 248, 35 faturas, R$ 12.307,86 — IDÊNTICOS**, e 0 linhas em
#      `tb_fatura_item_origens`. RLS **TENANT VIA PAI** com DOIS saltos
#      (`tb_fatura_itens` → `tb_faturas`), ENABLE + FORCE, 1 policy com USING e WITH
#      CHECK, 6 índices e **1 FK só** (o pai, CASCADE).
#      ⚠️ Colunas de origem **SEM FK**, como `tb_prescricoes.prestador_id`: a contribuição
#      é o registro histórico de uma cobrança e não pode sumir porque o registro clínico
#      foi excluído.
#      ⚠️ `prisma generate` falhou com **EPERM** (§11, backend rodando) e **NÃO bloqueia**:
#      tudo aqui é SQL cru, e a verificação ao vivo abaixo rodou com o client NÃO
#      regenerado. Rodar na próxima parada do backend.
#      ✅ `tb_fatura_item_origens` JÁ ENTROU em `TENANT_PLANE` (tenant plane: 22/86).
#   ✅ **RLS CONFERIDO AO VIVO**, com o usuário da APLICAÇÃO, em transação REVERTIDA:
#   a empresa 58 grava a contribuição no PRÓPRIO item e lê de volta (é este passo que
#   prova que o teste tem valor — sem ele tudo "passaria" por fail-closed); gravar no
#   item da empresa 59 é **RECUSADO pelo banco (42501)**; a 59 enxerga **0**; 0 linhas ao fim.
#   ✅ **CÓDIGO REAL × BANCO REAL**, em transação REVERTIDA (fatura 102, empresa 59):
#   3 doses de 2 prescrições consolidaram em **1 linha, Quant.: 3**, com 3 contribuições
#   datadas e a soma batendo com a quantidade; `origemJaFaturada` respondeu **SIM** para a
#   2ª origem (pela FK responderia NÃO); estornar a 1ª deixou a linha **viva com Quant.: 1**
#   e a FK **reapontada**; estornar a última apagou a linha. Banco ao fim: os mesmos
#   110/248/35/R$ 12.307,86.
#   Gate novo `__tests__/faturaOrigensConsolidadas.test.js` (25 casos), com um `tx` falso
#   que implementa a tabela de contribuições em memória e ROTEIA o SQL cru da lib.
#   ✅ **Verificado que REPROVA**: devolvida a origem à chave + o estorno apagando a linha
#   inteira, **7 casos falharam**; devolvido o "já faturado" pela FK crua e o `[VC-]` na
#   descrição, **2**; devolvido o `[AG-]` na prescrição, **1**.
#   ⚠️ `faturaConsolidacao.test.js` teve o caso "origem DIFERENTE abre linha própria"
#   **INVERTIDO** — ele travava a regra antiga. Suíte: **1098**; `tsc --noEmit`, `tsc -b`
#   e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão. Ver §12.)
---

### Sessão 2026-09-17 (parte 3) — A linha da fatura junta atendimentos; o número vira observação

> ✅ **MIGRATION APLICADA** (autorizada nesta sessão) —
> `20261015000000_fatura_item_origens`, rodada com o DONO (`DATABASE_URL_MIGRATIONS`,
> `nutriadmin`): `CREATE TABLE` e `CREATE POLICY` exigem OWNERSHIP, não GRANT. Cria
> `tb_fatura_item_origens` (ADITIVA, **sem backfill**) com ENABLE + FORCE e policy
> **TENANT VIA PAI** de dois saltos (`tb_fatura_itens` → `tb_faturas`).
> `migrate status` depois: **203 migrations, "Database schema is up to date!"**.
>
> ✅ **CONFERIDO DEPOIS, contra o retrato de ANTES** — 9 colunas, RLS enable+force,
> 1 policy (USING e WITH CHECK), 6 índices, **1 FK só** (o pai, CASCADE); e o dado
> INTACTO: **110 itens de fatura / soma de quantidade 248 / 35 faturas / R$ 12.307,86**,
> idênticos, com 0 linhas na tabela nova (o "sem backfill" conferido, não suposto).
>
> ⚠️ `prisma generate` falhou com **EPERM** (§11 — o backend em execução segura o
> `query_engine-windows.dll`) e **NÃO bloqueia**: tudo aqui é SQL cru, e as duas
> verificações ao vivo abaixo rodaram com o client NÃO regenerado. Rodar na próxima
> parada do backend.
>
> ✅ `tb_fatura_item_origens` já entrou em `TENANT_PLANE` (`__tests__/tenancyRls.test.js`)
> — o que só se faz DEPOIS de aplicar: listá-la antes reprova o teste 3 ("as listas não
> citam tabela inexistente"), a rede contra prometer proteção para tabela que não existe.
> Tenant plane: **22/86**.

- [x] ✅ **RLS CONFERIDO AO VIVO**, com o usuário da APLICAÇÃO (`zls2vetp1`, que é quem
      sofre a policy em produção), em transação REVERTIDA:
      ```
      empresa 58 grava a contribuição no PRÓPRIO item   → ACEITO   (é este passo que
      empresa 58 lê de volta                            → 1 linha   prova que o teste
      empresa 58 grava no item da empresa 59            → RECUSADO  tem valor: sem ele
      empresa 59 enxerga                                → 0 linhas  tudo "passaria" por
      linhas ao fim                                     → 0         fail-closed)
      ```
      O 42501 do terceiro caso é o banco recusando, não o código — é a policy funcionando.
- [x] ✅ **CÓDIGO REAL × BANCO REAL**, em transação REVERTIDA (empresa 59, fatura 102,
      animal 84, prescrições 142 e 143): `adicionarOuSomarFaturaItem` chamado 3× (2 doses
      de uma prescrição + 1 de outra) consolidou em **1 linha, Quant.: 3**, com **3
      contribuições datadas** e a soma delas batendo com a quantidade da linha;
      `origemJaFaturada` respondeu **SIM** para a 2ª origem (pela FK responderia NÃO — é
      o falso "não" que encolheria o estoque); `removerFaturaItensDaOrigem` da 1ª deixou a
      linha **viva com Quant.: 1** e a FK **reapontada** para a 2ª; o estorno da última
      apagou a linha. Banco ao fim: os mesmos 110 / 248 / 35 / R$ 12.307,86.
      ⚠️ Nesse cenário as duas prescrições eram do MESMO atendimento (EV-0001), então as
      três contribuições saíram com o mesmo número — a base não tinha o caso de dois
      atendimentos distintos à mão. O mecanismo é o mesmo; confirmar o visual no uso.

- [x] 🔴 **O DEFEITO: só as doses do MESMO item de prescrição consolidavam.** A chave de
      `adicionarOuSomarFaturaItem` incluía a FK de origem, e a descrição começava com o
      número do atendimento — então nada casava entre documentos. Agora a chave é
      **(tipo, descrição, animal, valor unitário)** e o número virou OBSERVAÇÃO.
      A "forma de cobrança" do pedido já estava na chave: ela se manifesta no VALOR
      UNITÁRIO (`lib/formaCobrancaEstoque.js` resolve o preço antes do lançamento), e é
      ele que a comparação por tolerância de centavo já olhava.
- [x] **Decisões tomadas com o usuário nesta sessão:**
      **(a) a POSOLOGIA fica na descrição** — mesmo remédio com frequências diferentes
      segue em linhas separadas, porque uma linha só teria de escolher uma frequência e
      mentiria sobre metade das doses; **(b) SEM BACKFILL** — faturas já lançadas ficam
      como estão; fundir linhas de fatura ABERTA mudaria um documento que o cliente pode
      já ter visto.
- [x] 🔴 **`tb_fatura_item_origens` — a contribuição é o que substitui a FK na chave.**
      Uma linha por execução: origem, `ocorrido_em` e `quantidade`.
      ⚠️ **INVARIANTE**: `FaturaItem.quantidade` = soma das contribuições. É ele que faz
      o estorno subtrair o número certo, e é por isso que `adicionarFaturaItem` (que NÃO
      consolida) também grava a primeira contribuição.
      ⚠️ `ocorrido_em` é a data da EXECUÇÃO, não `criado_em`: o lançamento pode ser
      reprocessado, a aplicação não.
      ⚠️ **Colunas de origem SEM FK**, mesmo precedente de `tb_prescricoes.prestador_id`
      e de `tb_execucoes_procedimento_prestador.credor_id`: a contribuição é registro
      histórico de uma cobrança e não pode mudar (nem sumir) porque o registro clínico
      foi excluído. `SET NULL` a deixaria sem origem nenhuma; `CASCADE` apagaria a
      explicação da cobrança em silêncio. Só o pai (`fatura_item_id`) tem FK, com CASCADE.
- [x] 🔴 **`removerFaturaItensDaOrigem` SUBTRAI em vez de apagar.** Era a FK na chave que
      impedia "cancelar uma prescrição levar embora a cobrança da outra"; com a linha
      compartilhada, apagá-la inteira faria exatamente isso — e a fatura fecharia "certa"
      na soma das linhas, sem erro nenhum.
      ```
      contribuições da origem  → descontam da quantidade da linha
      linha ficou sem nenhuma  → aí sim é apagada
      linha sobreviveu         → a FK de origem principal é REAPONTADA para quem ficou
      ```
      ⚠️ A linha é procurada pelas CONTRIBUIÇÕES **e** pela FK: linha LEGADA (anterior à
      migration) não tem contribuição, e sem o segundo caminho ela deixaria de ser
      estornada — o cancelamento pararia de devolver dinheiro, em silêncio.
      ⚠️ `resumoDaLinha` devolve `null` para "não sei" (tabela ausente), e **"não sei"
      nunca autoriza manter a cobrança**: cai no comportamento antigo e apaga a linha.
      Colapsar `null` com zero apagaria linha compartilhada em base sem a tabela.
      ⚠️ A quantidade nova é a **SOMA do que sobrou**, não `quantidade − descontado`: a
      soma é a verdade da linha e se autocorrige; subtrair propagaria divergência.
- [x] 🔴 **`origemJaFaturada` — "já foi cobrado?" deixou de poder sair da FK.** A FK
      guarda só a origem PRINCIPAL, então a segunda vacina a cair na linha responderia
      "não faturada". Não é detalhe de leitura: é esse "sim" que, no CANCELAMENTO da
      vacina, prova que o lote foi debitado e autoriza devolver as doses ao estoque — um
      falso "não" deixa o **estoque encolhido em silêncio**, que é o bug de 2026-08-18 de
      volta por outro caminho. Aplicado nos 3 `jaFaturada` da vacina (finalizar, executar,
      cancelar), no `jaLancado` do `finalizar` da prescrição e no `jaFaturado` do exame.
- [x] ⚠️ **Duas reescritas de linha ganharam guarda contra a linha COMPARTILHADA:**
      (a) a reutilização da linha zerada da finalização em `executar` — `findFirst` pela
      FK pode devolver uma linha que já tem doses de outra prescrição, e sobrescrever
      `valor` ali reprecificaria retroativamente o que a outra cobrou;
      (b) `atualizarFaturaItensDaOrigem` — descrição e valor da linha são de TODAS as
      origens dela. `temOutraOrigem` devolve `null` para "não sei" e isso NÃO bloqueia:
      sem a tabela, nada é compartilhado.
- [x] **A descrição perdeu o número** em prescrição (`descricaoItemFatura`), no INSUMO da
      via injetável e na vacina. ⚠️ Exame e encaminhamento mantêm o `[EX-0004]`: são
      lançamento único, nunca consolidam.
- [x] **A finalização também consolida** (item que o proprietário aplica em casa, que
      nunca chega ao plantão) — não sobrou `adicionarFaturaItem` na prescrição. Duas
      regras na mesma fatura para a mesma pergunta seria o pior dos dois mundos.
- [x] **Leitura: `origensPorItem` anexa as contribuições a cada item** em
      `FaturaController.comPerfilDaEmpresa` — o funil único de toda leitura de fatura
      completa. ⚠️ **UMA consulta para a fatura inteira**, nunca uma por item: a fatura
      de um mês tem dezenas de linhas. O número e o destino do clique saem do registro de
      origem (vacina → VC-0004 + tela de Vacina; o resto → nº do atendimento + evolução),
      montados por `formatAtendimentoNum`, nunca à mão.
- [x] **Tela e papel**: `ObservacaoOrigens` (`Faturamento.tsx`) e `observacaoOrigens`
      (`FaturaExport.ts`), as duas só com **2+ contribuições**. No papel a razão é mais
      forte que estética: antes da consolidação cada aplicação era uma LINHA na fatura do
      cliente, com número e data — consolidar sem o detalhe entregaria um "Quant.: 5" que
      ele não tem como conferir.
- [x] Testes: `__tests__/faturaOrigensConsolidadas.test.js` (25 casos) com `tx` falso que
      implementa a tabela de contribuições e ROTEIA o SQL cru da lib — um mock que só
      devolvesse objetos não exercitaria o caminho real dela.
      ✅ **Verificado que REPROVA** em três sabotagens distintas (7, 2 e 1 casos).
      Suíte: **1098**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [x] ✅ `origensPorItem` (o JOIN que resolve número/evolução de cada contribuição) foi
      conferido AO VIVO junto do resto — devolveu as 3 contribuições com número, data e
      quantidade. Ele não tem teste unitário, e não tem como ter: é SQL puro.
- [ ] A exportação **CSV** da fatura (`FaturaExport.ts`) não leva a observação — só a
      impressão/PDF. Uma linha por contribuição no CSV mudaria o número de linhas do
      arquivo, que o financeiro pode usar como base de conferência; decidir antes de mexer.
- [ ] Linhas já lançadas (sem contribuição) continuam com o `[AG-0012]` no texto e sem
      observação, convivendo com as novas na MESMA fatura enquanto o mês corrente não
      fechar. É consequência aceita do "sem backfill"; `descricaoSemNumero` no front já
      trata o prefixo legado.

---

# Atualizado em: 2026-09-10 (parte 4) (🔴 **FORMA DE COBRANÇA DE MEDICAMENTO/VACINA.**
#   Campo novo no Cadastro da Empresa decide o PREÇO do item que sai do ESTOQUE:
#   **Valor Repassado** (o do lote — o que sempre foi), **Percentual** (o do lote + N%,
#   com o campo do % só nessa forma), **Maior valor** (o maior repassado em estoque) e
#   **Custo médio** (Σ(preço×qtd)/Σ(qtd), ponderado pelo saldo).
#   🔴 A forma muda o NÚMERO DE LINHAS da fatura: as duas primeiras precificam POR LOTE
#   (saída de dois lotes = duas linhas), as duas últimas dão preço único (uma linha com
#   a quantidade somada) — e isso saiu de graça, sem tocar no lançamento, porque
#   `adicionarOuSomarFaturaItem` já consolida linha de mesmo valor unitário.
#   🔴 FONTE ÚNICA `lib/formaCobrancaEstoque.js`, com o cálculo numa função PURA:
#   medicamento e vacina resolvem preço por caminhos diferentes, e duas cópias da regra
#   divergiriam no valor cobrado do cliente. ⚠️ O retrato do estoque é tirado ANTES da
#   baixa; lote sem saldo fica fora; sem saldo nenhum cai no preço do lote, nunca em
#   zero; valor digitado à mão continua vencendo. ✅ **MIGRATION APLICADA** (autorizada,
#   `20261007000000`): aditiva e sem backfill — as 6 linhas de configuração existentes
#   ficaram INTACTAS, então toda clínica segue em Valor Repassado. ⚠️ `prisma generate`
#   falhou com EPERM (§11) e não faz falta: tudo por SQL cru. Suíte: 872. Ver §12.)
---

### Sessão 2026-09-10 (parte 4) — Forma de cobrança de medicamento/vacina

> ✅ **MIGRATION APLICADA** (autorizada) — `20261007000000_forma_cobranca_estoque`:
> `forma_cobranca_estoque VARCHAR(20)` + `percentual_cobranca_estoque DOUBLE PRECISION`
> em `tb_empresa_configuracoes`. **ADITIVA e SEM BACKFILL**: `null` = VALOR_REPASSADO,
> que é o comportamento que toda clínica tem hoje — ninguém muda de preço ao aplicá-la.
> Sem RLS novo (a tabela já é escopada).
> Conferido no `information_schema`: as duas colunas NULÁVEIS, `VARCHAR(20)` e
> `DOUBLE PRECISION`; e as **6 linhas de configuração existentes ficaram INTACTAS**
> (0 com forma, 0 com percentual) — ou seja, toda clínica segue em Valor Repassado.
> ⚠️ A contagem exigiu `set_config('app.plataforma','on',true)` **na leitura**, senão
> o FORCE RLS devolve 0 e parece que a migration não gravou nada (armadilha 42).
>
> ✅ **VERIFICADO AO VIVO**, em transaction revertida contra a base real: gravou
> `PERCENTUAL 10` no escopo de uma empresa PESSOAL (empresa 42 / equipe 39), releu pelo
> escopo exato E pelo fallback de `lerForma`, e o preço saiu **132** sobre um lote de
> 120 — depois revertida, com 0 linhas configuradas ao fim.
>
> ⚠️ **`npx prisma generate` FALHOU com `EPERM`** (o backend em execução segura o
> `query_engine-windows.dll`, §11) e ficou PENDENTE. **Não faz falta aqui**: as duas
> colunas são lidas/gravadas por SQL cru (`lib/formaCobrancaEstoque.js`) e nenhum
> caminho passa pelo client tipado. Rodar na próxima parada do backend, só para o
> schema tipado acompanhar.

- [x] **Campo novo "Forma Cobrança Medicamentos/Vacina"** no Cadastro da Empresa
      (`/cadastro/empresa`), ao lado de Fechamento/Tempo de Consulta/Validade. Quatro
      formas, e o que elas decidem é o PREÇO do item que SAI DO ESTOQUE na fatura:
      ```
      VALOR_REPASSADO  preço repassado DAQUELE lote            (o que sempre foi)
      PERCENTUAL       o do lote + N% (campo do % só aparece nesta forma)
      MAIOR_VALOR      o MAIOR repassado entre os lotes EM ESTOQUE
      CUSTO_MEDIO      Σ(preço_i × qtd_i) / Σ(qtd_i), ponderado pelo saldo
      ```
- [x] 🔴 **A FORMA MUDA O NÚMERO DE LINHAS DA FATURA, e isso não é cosmético.**
      VALOR_REPASSADO e PERCENTUAL dão preço POR LOTE, então uma saída tirada de dois
      lotes com preços diferentes sai em DUAS linhas; MAIOR_VALOR e CUSTO_MEDIO dão o
      MESMO preço a todo lote e a saída vira UMA linha com a quantidade somada.
      ⚠️ **Nenhuma mudança foi necessária no lançamento da fatura para isso** — quem já
      consolida linha de mesmo valor unitário é `adicionarOuSomarFaturaItem`. Mexer na
      estrutura da linha para "forçar" o agrupamento teria quebrado a consolidação de
      doses de um curso de 7 dias, que é outra regra.
      Conferido com o exemplo do pedido (estoque 2 un a 120 + 6 un a 150; saída de 1 un
      de cada): 120+150 · 132+165 · 2×150=300 · 2×142,50=285.
- [x] 🔴 **FONTE ÚNICA `lib/formaCobrancaEstoque.js`**, com o cálculo numa função PURA
      (`precoDeVenda(cfg, precoDoLote, entradas)`). Medicamento e vacina resolvem preço
      em arquivos distintos e por caminhos distintos (unidade base × dose de frasco) —
      duas cópias da regra divergiriam na primeira correção, e o que divergiria seria o
      valor cobrado do cliente.
      ⚠️ **Entrada SEM SALDO fica fora de MAIOR_VALOR e de CUSTO_MEDIO**: ela não está
      "dentro do estoque", e um lote zerado e caro puxaria o preço de todo mundo.
      ⚠️ **Sem nenhuma entrada com saldo** (execução forçada) cai no preço do lote,
      NUNCA em zero — zero afirmaria que o item é gratuito.
      ⚠️ O percentual é gravado como `null` fora da forma PERCENTUAL: um número
      esquecido ali voltaria a valer sozinho ao trocar a forma de volta.
      ⚠️ Base ainda não migrada devolve o PADRÃO (`catch`), não erro: o pior caso é
      cobrar como sempre cobrou, nunca derrubar a execução clínica.
- [x] 🔴 **O RETRATO DO ESTOQUE É TIRADO ANTES DA BAIXA.** MAIOR_VALOR e CUSTO_MEDIO
      olham o que a clínica TEM no momento em que cobra; calculado depois, cada lote
      debitado mudaria o preço dos seguintes DENTRO da mesma execução. Vale nos dois
      lados — `debitarEstoqueDia` (antes do laço) e `darBaixaEFaturar` (antes de
      `consumirReservaVacina`, que já dá baixa). Há gate estrutural travando a ORDEM.
- [x] **Extraído `precoUnitarioDoEstoque`** (`PrescricaoGrupoController`): a dupla
      "`precoUnitarioBase` fixo da entrada × cálculo dinâmico legado" estava escrita
      duas vezes no arquivo. Comportamento idêntico — o legado continua existindo,
      com o defeito conhecido de subir o preço conforme o estoque baixa.
- [x] ⚠️ **Valor digitado à mão VENCE a forma de cobrança**, nos dois fluxos: o
      `valorOrcado` do item (medicamento) e o `valor` informado no registro (vacina)
      têm precedência, como já tinham. A forma decide o preço que o sistema DEDUZ do
      estoque, não a decisão de quem digitou um valor.
- [x] Multi-tenant/RLS preservados: a configuração é lida pelo escopo (empresa CNPJ →
      `equipeId` null; pessoal → por equipe, com o mesmo fallback de `fusoDaEmpresa`) e
      o retrato do estoque sai das MESMAS consultas já escopadas por `empresaId`. A
      leitura roda com o `tx` da transação — o `prisma` global ali não enxergaria nada
      (armadilha de 2026-08-23, parte 4).
- [x] Testes: `__tests__/formaCobrancaEstoque.test.js` (23 casos) — a matriz das quatro
      formas com os números do pedido, o lote zerado, a base não migrada, as aspas de
      `"empresaId"` (armadilha 41) e um GATE ESTRUTURAL nos três elos que somem em
      silêncio (medicamento, vacina, tela de configuração).
      ✅ **Verificado que REPROVA**: removida a chamada na vacina e quebrado o peso do
      custo médio, **3 casos falharam**; restaurado, os 23 voltaram. Suíte: **872**;
      `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] O ORÇAMENTO não passa pela forma de cobrança: ele é cotado antes de existir lote
      debitado, e o valor orçado tem precedência na execução (é o que impede o cliente
      receber um preço e ser cobrado outro). Se a clínica quiser orçar já pela forma
      configurada, é decisão de produto — e o lugar é `OrcamentoController`.
- [ ] "Maior valor do mês" foi implementado como **maior valor EM ESTOQUE** (o que o
      pedido descreve na linha seguinte ao título). Se a intenção for a janela de tempo
      literal — o maior repassado das ENTRADAS do mês corrente, inclusive de lote já
      consumido —, muda o retrato (`MovimentoEstoque`/`createdAt`), não o cálculo.

---

# Atualizado em: 2026-09-10 (parte 3) (🔴 **PRODUTOS DE FORNECEDOR + CONTAS A PAGAR.**
#   A clinica so sabia falar de item que ELA GUARDA: o que ela nao estoca e pede ao
#   fornecedor aparecia como "Sem estoque", cinza, igual ao que ninguem fornece. E nao
#   existia o outro lado do balcao da compra - `tb_faturas` e o que se COBRA do cliente.
#   1. **Tela `/cadastro/produtos`** (Cadastro): medicamento e vacina num lugar so, com
#      o FORNECEDOR de cada um e um checkbox "dar entrada no estoque" - e ele que separa
#      PRODUTO (tenho de quem comprar) de ESTOQUE (tenho o frasco). ⚠️ NAO substitui
#      `/medicamentos` (catalogo global do ADMIN) nem `/cadastro-vacina`.
#   2. **Leitura do DOCUMENTO DE COMPRA** por IA (`ler_nota_fiscal@v2`, multimodal):
#      traz itens, valores e o emitente. ⚠️ NADA e inventado e NADA e gravado - e
#      proposta. Fornecedor que nao existe abre o cadastro JA preenchido e volta com
#      ele escolhido. 🔴 O criterio e COMPRA, nao FISCAL (ampliado no mesmo dia): vale
#      nota fiscal, cupom, ORCAMENTO DE BALCAO e recibo - o balcao veterinario entrega
#      papel com "SEM VALOR FISCAL" impresso, e ele traz tudo o que a tela precisa.
#   3. **Na prescricao e na vacina**: ordem EM ESTOQUE -> PRODUTO -> o resto, com o
#      produto em VERDE trazendo o nome do fornecedor. ⚠️ `ehProduto` so quando NAO
#      ha estoque.
#   4. **`/financeiro/pagamentos`** - o que a clinica DEVE, no molde da fatura
#      (abrir -> fechar -> pagar), com FORNECEDOR e PRESTADOR na mesma tela. Lancado na
#      EXECUCAO, na MESMA transaction que cobra o cliente. ⚠️ Sem preco de compra
#      cadastrado NAO lanca - divida de valor inventado e pior que divida ausente.
#   ✅ A "fatura do prestador" do pedido JA EXISTIA (`/recibos-prestador` + o ledger da
#   execucao) e foi REAPROVEITADA como fonte - nada recalculado.
#   ✅ **MIGRATION APLICADA e SEED RODADO** (autorizados): as 3 tabelas com ENABLE +
#   FORCE + policy, 7 slugs novos em 54 linhas de matriz cada, e o fluxo verificado ao
#   vivo em transaction revertida — idempotencia, valor zero que nao vira divida, total
#   recalculado e RLS isolando a clinica vizinha. Suite: 827. Detalhes na §12.)
---

### Sessão 2026-09-10 (parte 3) — Produtos de fornecedor e Contas a Pagar

> ✅ **MIGRATION APLICADA** (autorizada) — `20261006000000_produtos_contas_pagar`.
> ADITIVA e sem backfill: três tabelas novas (`tb_produtos_fornecedor`,
> `tb_contas_pagar`, `tb_conta_pagar_itens`) e duas colunas em `tb_lotes_vacina`
> (`fornecedor_id`, `nota_fiscal`). Conferido no banco: as três com **ENABLE + FORCE**
> e policy `tenant_*`, os três índices no lugar (dois PARCIAIS) e **0 linhas** nas três
> — nada de dado existente foi tocado. `migrate status`: schema em dia, 194 migrations.
> **Funciona sem `prisma generate`**: tudo é lido/gravado por SQL cru
> (`lib/produtoFornecedor.js`, `lib/contasPagar.js`) — §11.
>
> ✅ **SEED RODADO** (`node backend/seed.js`, autorizado): os 7 slugs novos entraram no
> catálogo e **54 linhas de matriz por slug** (6 equipes × 9 perfis). Conferido: GESTOR
> FULL nos dois; FINANCEIRO com `pagamentos` EQUIPE e `produto` NENHUM; VET/ESTAGIÁRIO/
> SECRETARIA com `produto` EQUIPE e `pagamentos` NENHUM; PROPRIETARIO NENHUM em tudo.
>
> ✅ **As três já entraram em `TENANT_PLANE`** (`__tests__/tenancyRls.test.js`) — só
> depois de existirem, porque o teste 3 recusa tabela inexistente.
>
> ✅ **VERIFICADO AO VIVO**, em transaction revertida contra a base real (Patyvet):
> produto salvo → `fornecedorDoItem` devolveu o fornecedor e o valor de compra →
> lançamento criou a conta → **o segundo lançamento da MESMA origem NÃO duplicou**
> (1 item, idempotência do índice parcial) → **valor zero devolveu `null`** (não virou
> dívida) → **total recalculado em 24,68** (12,34 × 2) → `contaAbertaDoCredor` chamada
> de novo devolveu a MESMA conta, o que prova que o `ON CONFLICT ... WHERE status =
> 'ABERTA'` casou com o índice parcial (a armadilha 42P10 NÃO ocorreu) → e a empresa
> vizinha enxergou **0 contas**, com o RLS isolando.

- [x] 🔴 **O PROBLEMA: a clínica só sabia falar de item que ELA GUARDA.**
      `tb_estoque_clinica` e `tb_lotes_vacina` são ESTOQUE FÍSICO (quantidade, lote,
      validade). O item que a clínica NÃO estoca — pede ao fornecedor quando o vet
      prescreve — não tinha onde existir: aparecia como "Sem estoque", cinza,
      indistinguível do que ninguém fornece. E não existia o outro lado do balcão da
      compra: `tb_faturas` é o que se COBRA do cliente; o que a clínica DEVE não era
      apurado em lugar nenhum.
- [x] **`tb_produtos_fornecedor` — "de quem eu compro este item, e por quanto".**
      🔴 **NÃO é estoque**: não tem quantidade, lote nem validade, porque o item não
      está na clínica.
      ⚠️ Por (empresa, medicamento, fornecedor) e não por (empresa, medicamento): o
      mesmo item costuma ter mais de um fornecedor com preços diferentes, e guardar um
      só obrigaria a apagar a cotação anterior para registrar a nova.
      ⚠️ `medicamento_id` aponta para `tb_medicamentos`, o catálogo dos DOIS tipos (a
      vacina é a linha cuja `classificacao` contém "vacin") — uma tabela por tipo
      duplicaria a mesma regra de compra em dois lugares.
      ⚠️ `valor_unitario` NULO = "compro dele, mas o preço não foi cadastrado", NUNCA
      zero. É a diferença entre "não sei quanto pago" e "recebo de graça", e é ela que
      decide se a conta a pagar é lançada.
- [x] 🔴 **PRODUTO × ESTOQUE — a distinção que a tela nova existe para registrar**
      (decidido com o usuário):
      ```
      EM ESTOQUE → a clínica tem o frasco.         selo EMERALD, com o saldo
      PRODUTO    → tem de quem comprar, sem saldo.  selo VERDE, com o FORNECEDOR
      NENHUM     → ninguém fornece.                 selo CINZA
      ```
      ⚠️ `ehProduto` é `true` **só quando NÃO está em estoque**. Marcar os dois faria a
      cor deixar de distinguir "tenho" de "preciso pedir" — que é para o que ela serve.
      ⚠️ Quem decide é o BACKEND (`MedicamentoController.paraAtendimento`), que também
      ORDENA: **em estoque → produto → o resto**, alfabético dentro de cada grupo.
      Antes só a vacina era ordenada; o medicamento saía em ordem alfabética pura, e o
      que a clínica tem em mãos ficava perdido numa lista de milhares de itens.
      Mandar as flags e deixar cada tela ordenar seria a mesma regra escrita três vezes
      (prescrição, vacina, orçamento) — e a terceira divergiria.
- [x] **Tela `/cadastro/produtos`** — abas Medicamentos × Vacinas (o padrão do cadastro
      de procedimentos), o item do catálogo, o fornecedor, os dois preços e o
      **checkbox "dar entrada no estoque"**, que é o que separa produto de estoque.
      ⚠️ **NÃO substitui `/medicamentos` nem `/cadastro-vacina`** (decidido com o
      usuário): a primeira é o catálogo GLOBAL do ADMIN, com 4.878 itens que valem para
      todas as clínicas. Aqui nasce o item PRÓPRIO da empresa, que só ela vê —
      reaproveitando `garantirMedicamentoDaEmpresa`, que já é idempotente por
      (nome, empresa, tipo).
      ⚠️ Tudo numa transaction: catálogo + vínculo + entrada de estoque nascem juntos
      ou não nascem. Uma falha no meio deixaria o item sem fornecedor (invisível como
      produto) ou o estoque apontando para um vínculo que não existe.
      ⚠️ A entrada de medicamento cria o `MovimentoEstoque` de ENTRADA — sem ele o item
      nasce com saldo que não veio de lugar nenhum e o relatório não fecha.
- [x] 🔴 **LEITURA DO DOCUMENTO DE COMPRA** — `ler_nota_fiscal@v2` (multimodal) +
      `services/notaFiscalService.js`. Lê nome, quantidade, valor, data e o emitente.
      🔴 **O CRITÉRIO É "DOCUMENTO DE COMPRA", NÃO "DOCUMENTO FISCAL"** (a v1 exigia
      NOTA FISCAL; ampliado no MESMO dia, depois de um caso real). O balcão do
      fornecedor veterinário entrega o tempo todo papel com **"ORÇAMENTO - SEM VALOR
      FISCAL"** impresso, trazendo emitente, data, itens, quantidade e preço — ou seja,
      TUDO o que a tela precisa. A IA lia certo e recusava certo: o critério é que
      estava errado, e o resultado era o cadastro manual que esta função veio evitar.
      Passam nota fiscal, DANFE, cupom, **orçamento/pedido de balcão** e recibo.
      ⚠️ **Validade FISCAL nunca foi requisito aqui**: daqui sai catálogo de produto,
      preço de compra e (quando a clínica manda) entrada de estoque — nada disso é
      escrituração contábil, e `tb_lotes_vacina.nota_fiscal` é texto de REFERÊNCIA.
      ⚠️ **Não afrouxar mais que isto**: papel que não registra COMPRA (receita, laudo,
      exame, foto) continua recusado — dali não sai item nem preço, e aceitar encheria
      o formulário com o que não é produto.
      ⚠️ **A chave da saída continua `ehNotaFiscal`**, de propósito: renomeá-la para
      `ehDocumentoCompra` obrigaria a tocar serviço, controller, front e gate sem mudar
      comportamento nenhum — a mesma decisão de `tb_procedimento_combos.valor`.
      ⚠️ **A RECUSA DIZ O QUE É ACEITO.** "Não parece ser uma nota fiscal" não dava a
      quem tinha o orçamento na mão como saber se o problema era o papel, a foto ou o
      sistema — o texto agora nomeia nota/cupom/orçamento/recibo.
      ⚠️ **O RÓTULO DA TELA acompanha o critério**: enquanto o botão dizia só "Ler nota
      fiscal", quem tinha um orçamento não tentava, e a recusa acontecia ANTES do
      upload. Virou **"Ler documento de compra"**, e o texto de ajuda lista os quatro.
      🔴 **NADA É INVENTADO**: campo que a nota não traz volta `null`. Quantidade
      adivinhada vira estoque que não existe; preço adivinhado vira dívida que ninguém
      contraiu. Rede de segurança depois do modelo: item sem nome é descartado,
      quantidade/valor negativos viram `null` (são linha de desconto/devolução).
      🔴 **O RESULTADO É PROPOSTA, NUNCA CADASTRO** — o controller não grava nada. A
      pessoa confere na tela e só então salva; assim um erro de leitura custa uma
      correção de campo, não um produto errado no catálogo.
      ⚠️ **Fornecedor que não existe abre o cadastro JÁ PREENCHIDO** com o que a nota
      trouxe, e a volta traz o fornecedor novo selecionado — sem isso o gestor teria de
      reencontrar a nota e recomeçar. Os dados vão no `state` do router, não na query:
      são ~10 campos e uma URL com tudo isso ficaria ilegível.
      ⚠️ **O que sobe é sempre IMAGEM** — PDF é convertido no navegador, reusando
      `modules/documentos/upload.ts`. Uma segunda conversão divergiria da primeira, e o
      que divergiria é a legibilidade do que a IA lê.
      ⚠️ Falha NÃO é erro de tela: responde **200** com `ehNotaFiscal: false` e o
      MOTIVO, e o cadastro segue manual. O único erro propagado é o **429 de QUOTA**.
      ⚠️ Multimodal não passa por `callAI`, então o **gate de quota** e o log de uso são
      feitos à mão — esquecê-los deixaria este caminho fora do teto do plano (§7).
      Módulo de IA novo `MODULOS_IA.PRODUTOS`: somá-lo ao FINANCEIRO esconderia o custo
      de uma função nova dentro de um número que já existia.
- [x] 🔴 **CONTAS A PAGAR — `tb_contas_pagar` + `tb_conta_pagar_itens`**, no molde da
      fatura (abrir → fechar → pagar).
      🔴 **UMA tabela para FORNECEDOR e PRESTADOR**, separados por `tipo`. São o mesmo
      documento com o mesmo ciclo; duas tabelas dariam duas telas, dois totalizadores e
      duas regras de fechamento, que divergiriam na primeira correção — a `Fatura`
      também é uma só para todo tipo de item cobrado.
      ⚠️ `credor_id` é id de `tb_fornecedores` OU de `tb_prestadores` conforme o tipo:
      as duas são independentes desde 2026-08-21 e não compartilham id. SEM FK, pelo
      motivo de `tb_prescricoes.prestador_id` — registro financeiro não muda de dono
      nem some porque um cadastro foi excluído. `credor_nome` é SNAPSHOT.
      ⚠️ O item grava **ANIMAL, valor, DATA e QUEM SOLICITOU** — o que o pedido exige
      que apareça. Nome do animal e do solicitante são gravados junto do id, pela mesma
      razão do ledger do prestador.
      ⚠️ **UMA conta ABERTA por (empresa, tipo, credor, mês)** — índice único PARCIAL.
      Sem ele, duas contas correntes do mesmo fornecedor partem o mês em duas e metade
      dos lançamentos some da vista (a mesma guarda de `abrirProximaFatura`).
- [x] 🔴 **O LANÇAMENTO É NA EXECUÇÃO, na MESMA transaction da fatura do cliente**
      (decidido com o usuário). Ou o cliente é cobrado e o terceiro entra na conta, ou
      nada acontece: fora da transaction existiria a janela em que a clínica cobrou e
      não deve a ninguém.
      ⚠️ **Só o que é PRODUTO**: item de estoque próprio já foi comprado antes, na
      entrada da nota — cobrá-lo de novo contaria a mesma compra duas vezes. Na vacina,
      o critério equivalente é `!loteIdFinal` (não houve lote debitado).
      ⚠️ **Sem preço de compra cadastrado, NÃO lança** — dívida de valor inventado é
      pior que dívida ausente, e a tela de Produtos avisa onde isso se resolve.
      ⚠️ O valor é o de COMPRA, nunca o cobrado do cliente: usar o segundo afirmaria
      que a clínica paga o que cobra, e zeraria a margem dela no relatório.
      ⚠️ **Quem SOLICITOU é quem PRESCREVEU**, não quem executou: a compra foi
      provocada pela prescrição, e o plantonista que aplica a dose não decidiu comprar
      nada. Resolvido UMA vez, fora do laço — dentro seria uma consulta por item.
      ⚠️ O valor do PRESTADOR sai de `calcularValorAPagar`, a MESMA fonte do recibo —
      recalcular daria dois números para a mesma dívida, com recibo e conta a pagar
      discordando entre si.
- [x] 🔴 **IDEMPOTÊNCIA por (origem_tipo, origem_id)**, com índice único PARCIAL: a
      mesma execução não vira duas linhas, e é isso que permite chamar o lançamento sem
      contar quantas vezes rodou. Parcial porque o lançamento MANUAL não tem origem, e
      vários deles na mesma conta são legítimos.
      🔴 **`ON CONFLICT` sobre índice PARCIAL exige o predicado REPETIDO** na cláusula
      — a armadilha 42P10 que já mordeu no seed 005 (2026-09-09). Erro de EXECUÇÃO:
      `node --check` passa e só o banco reprova. Há gate para os dois `ON CONFLICT`.
- [x] **Tela `/financeiro/pagamentos`** — abas Fornecedores × Prestadores, o
      `PeriodoSelector` de sempre, total do período e "a pagar", e uma linha por
      lançamento com animal, item, solicitante, data e valor. Ações: **Fechar**,
      **Marcar como paga** e **Cancelar** (com justificativa, §33).
      ⚠️ **CANCELADA fica fora do total**: ela é registro do que deixou de valer, e
      somá-la afirmaria uma dívida que a clínica já desfez.
      ⚠️ Conta **PAGA é somente leitura** — remover item de um pagamento já quitado
      mudaria um documento que o credor recebeu.
      ⚠️ `pagar` é slug SEPARADO de `lancar`: lançar é registrar a dívida; PAGAR é dar
      por quitada, e nem todo mundo que lança decide isso.
- [x] **Slugs novos em TODOS os 9 perfis** — `cadastro.produto.*` espelha o nível de
      `cadastro.fornecedor.*` (é o mesmo ato de cadastro de compra) e
      `financeiro.pagamentos.*` espelha `financeiro.recibos.*`.
      ⚠️ **NÃO espelha `financeiro.faturas`**: a fatura é o que se COBRA do cliente;
      pagamentos é o que se PAGA a terceiros, inclusive remuneração — reaproveitar
      aquele nível daria a folha de pagamento de terceiros a todo mundo que fatura.
      Há teste travando isso.
- [x] ✅ **A "fatura do prestador" do pedido JÁ EXISTIA e foi REAPROVEITADA.**
      `/recibos-prestador` e o ledger `tb_execucoes_procedimento_prestador` (gravado na
      execução, com o valor do cadastro prestador × procedimento) continuam sendo a
      fonte — nada foi recalculado e nenhuma migration tocou neles. O que nasceu foi a
      conta a pagar do prestador, alimentada do MESMO ponto, para ele ter o ciclo de
      abrir/fechar/pagar que o recibo não tem. O recibo segue como o comprovante
      impresso.
- [x] Testes: `__tests__/produtosContasPagar.test.js` (29 casos) — RLS das três tabelas
      (ENABLE + FORCE + USING **e** WITH CHECK), a migration ser aditiva, os dois
      índices parciais, o `null ≠ 0`, o total recalculado (nunca incrementado), o
      `NULLS LAST` da escolha do fornecedor, a leitura de nota que não grava nada, e um
      GATE ESTRUTURAL nos elos que somem em silêncio (o lançamento na execução da
      prescrição, da vacina e do procedimento, a origem em todo lançamento automático,
      e a ordenação em três grupos).
      ✅ **Verificado que REPROVA**: removidos o predicado do `ON CONFLICT`, o
      lançamento do fornecedor e a ordenação em três grupos, **3 casos falharam**;
      restaurado, os 29 voltaram. Suíte: **827** (+4 do critério de compra);
      `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] O lançamento do fornecedor usa o valor de compra **por unidade × a quantidade da
      dose**. Item vendido em embalagem (frasco de 100 mL usado 10 mL por vez) fica com
      a conta proporcional, não pelo frasco inteiro — o que é correto para consumo, mas
      não para reposição. Se a clínica quiser a conta por EMBALAGEM comprada, é outra
      regra e precisa ser dita.
- [ ] A conta a pagar não tem **fechamento automático** (o da fatura tem cron). Hoje o
      financeiro fecha à mão na tela; se isso incomodar, o lugar é um job espelhando
      `fecharFaturasDoMes`.
- [ ] `tb_lotes_vacina.fornecedor_id` é gravado na entrada por Produtos, mas as telas
      de `/estoque-vacina` e `/farmacia` ainda não exibem nem editam o fornecedor do
      lote — só a de Produtos o preenche.

---

# Atualizado em: 2026-09-10 (🔴 **O PROCEDIMENTO PASSOU A TER PRESTADOR, DOIS PREÇOS E
#   RECIBO.** Três coisas que não existiam:
#   1. 🔴 **O MESMO PROCEDIMENTO COM VÁRIOS PRESTADORES, CADA UM COM SEU PREÇO.**
#      `ProcedimentoValorEmpresa` comporta UM valor por procedimento, então a clínica com
#      dois ferradores cobrando (e recebendo) diferente pelo mesmo ferrageamento não
#      tinha onde gravar isso — o segundo sobrescrevia o primeiro. Tabela nova
#      `tb_procedimento_prestadores`, com os DOIS valores: **Valor Cobrado para o
#      Cliente** (o antigo "Valor", renomeado) e **Valor Cobrado pelo Prestador**.
#      ⚠️ `ProcedimentoValorEmpresa` CONTINUA existindo e continua sendo o valor PADRÃO
#      da empresa — o que vale quando quem executa é a própria equipe. O vínculo só
#      ESTREITA para o par (procedimento, prestador); trocar um pelo outro faria todo
#      procedimento sem prestador nascer sem preço na fatura.
#      ⚠️ `valorCliente` NULO = "usa o padrão da empresa", NÃO zero. A tela exibe o
#      padrão com a nota de herança — "R$ 0,00" faria o gestor concluir que o
#      procedimento é gratuito com aquele prestador.
#   2. 🔴 **`tb_prescricoes.prestador_id` — quem executa ESTE item.** Fica no ITEM, não
#      no grupo: a mesma prescrição tem o bloqueio do vet da casa e o ferrageamento do
#      ferrador externo (mesma razão de `medicamentoCliente`/`aplicadaPeloProprietario`).
#      Na tela de prescrição o campo aparece ao escolher o PROCEDIMENTO, é OPCIONAL (sem
#      prestador = valor padrão, exatamente como era antes) e oferece **+ Cadastrar novo
#      prestador**, que leva a `/cadastro/prestadores?novo=1&depois=…` e, ao salvar,
#      segue para `/cadastro/procedimentos?especialidade=&busca=&vincular=` — o valor é
#      definido lá, senão o procedimento sairia na fatura por R$ 0,00.
#      ⚠️ Prestador escolhido SEM vínculo naquele procedimento ganha faixa âmbar com
#      atalho "Definir valor". É esse aviso que evita a fatura zerada.
#   3. 🔴 **RECIBO DE PAGAMENTO AO PRESTADOR** (`/recibos-prestador`, dia/semana/mês/ano):
#      é o OUTRO LADO DO BALCÃO DA FATURA — ela é o que a clínica COBRA do cliente, o
#      recibo é o que ela DEVE a quem executou. Traz **nome do animal, procedimento
#      executado, valor e data da execução**, com quitação e valor por extenso na folha.
#      🔴 A base é o LEDGER `tb_execucoes_procedimento_prestador`, gravado NA EXECUÇÃO,
#      dentro da MESMA transaction do lançamento na fatura. É SNAPSHOT (valores + forma
#      de pagamento do prestador congelados): recalcular na leitura faria o recibo de
#      março sair com o percentual renegociado em setembro, sem como provar o contrário.
#      **Tipo de pagamento novo `POR_PROCEDIMENTO`** no cadastro do prestador → vai ao
#      recibo o "Valor Cobrado pelo Prestador" do vínculo. `PERCENTUAL` incide sobre o
#      Valor Cobrado para o Cliente; `VALOR` é comissão fixa por procedimento; `SALARIO`
#      não se apura por procedimento (a execução é listada com valor 0 e a explicação).
#      ⚠️ `POR_PROCEDIMENTO` **não** entra em `TIPOS_PAGAMENTO` de `lib/usuarioEmpresa.js`
#      — aquela lista é do INCLUIR MEMBRO, e o valor lá ficaria aceito no backend sem
#      nenhuma tela oferecê-lo. Há teste travando isso.
#   **A REGRA DE COBRANÇA NÃO MUDOU**: procedimento só entra na fatura — e só entra no
#   recibo — DEPOIS de executado, pelo Valor Cobrado para o Cliente.
#   ✅ **JÁ FUNCIONAVA e não precisou de nada**: procedimento digitado à mão na
#   prescrição já entra no catálogo da empresa (`resolverCatalogoDoItem` →
#   `garantirProcedimentoDaEmpresa`, `lib/catalogoManual.js`).
#   🔴 **MIGRATION GERADA, NÃO APLICADA** — `20261001000000_procedimento_prestador`:
#   ADITIVA (nenhum UPDATE/DELETE), 2 tabelas com RLS de TENANT DIRETO + a coluna do
#   item. Sem backfill: execução anterior não tem prestador e não pode ganhar um por
#   dedução (`FaturaItem.veterinarioId` é quem LANÇOU, não quem executou).
#   ⚠️ Tudo por **SQL CRU** em `lib/procedimentoPrestador.js` — fonte única do vínculo,
#   da resolução de preço e do cálculo do recibo. Suíte: **735**. Detalhes na §12.)
---

### Sessão 2026-09-10 — Prestador no procedimento, dois preços e recibo de pagamento

> 🔴 **MIGRATION GERADA, NÃO APLICADA** — `20261001000000_procedimento_prestador`.
> **ADITIVA e sem backfill** (nenhum UPDATE/DELETE de dado gravado): duas tabelas novas
> (`tb_procedimento_prestadores`, `tb_execucoes_procedimento_prestador`), as duas com
> ENABLE + FORCE + policy de **TENANT DIRETO**, e a coluna `tb_prescricoes.prestador_id`.
> Aplicar com `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy`.
> **SEM `prisma generate` obrigatório**: tudo é lido/gravado por SQL cru
> (`lib/procedimentoPrestador.js`) — no Windows o generate falha com o backend rodando (§11).
> ⚠️ **DEPOIS de aplicar**, acrescentar as duas tabelas a `TENANT_PLANE` em
> `__tests__/tenancyRls.test.js` — o teste 2 reprova por falta de classificação, e o
> teste 3 reprovaria se fossem listadas ANTES de existirem. Há comentário no arquivo.
> ⚠️ Rodar **`node backend/seed.js`** para os slugs novos `financeiro.recibos.ler` e
> `financeiro.recibos.imprimir` entrarem no catálogo de módulos e nas matrizes.

- [x] 🔴 **O PROBLEMA: um preço por procedimento, e ninguém sabia QUEM executou.**
      `ProcedimentoValorEmpresa` é `@@unique([empresaId, procedimentoId])` — UM valor por
      procedimento na empresa. A clínica com dois ferradores que cobram (e recebem)
      valores diferentes pelo MESMO ferrageamento não tinha onde gravar isso: o segundo
      sobrescrevia o primeiro. E não havia como apurar o que a clínica DEVE a cada
      prestador — `FaturaItem` registra o que se COBRA do cliente, e o outro lado do
      balcão simplesmente não existia.
- [x] **`tb_procedimento_prestadores` — o VÍNCULO (empresa, procedimento, prestador)**,
      com os DOIS valores: `valor_cliente` (o que se cobra do cliente quando é ESTE
      prestador que executa) e `valor_prestador` (o que ELE cobra da clínica).
      ⚠️ **`ProcedimentoValorEmpresa` CONTINUA existindo** e continua sendo o valor
      PADRÃO da empresa — o que vale quando quem executa é a própria equipe, sem
      prestador externo. O vínculo só ESTREITA para o par; trocar um pelo outro faria
      TODO procedimento sem prestador nascer sem preço na fatura.
      ⚠️ **`valorCliente` NULO = "usa o valor padrão da empresa"**, e não zero — é o que
      permite vincular o prestador sem repetir um preço que já existe. A tela mostra o
      padrão com a nota de herança; exibir "R$ 0,00" faria o gestor concluir que o
      procedimento é gratuito com aquele prestador.
      ⚠️ Unique por (empresa, procedimento, prestador): vários prestadores no MESMO
      procedimento é o caso de uso; o que não pode existir é a mesma dupla duas vezes,
      com dois preços, sem ninguém saber qual vale.
- [x] **Tela de Procedimentos: "Valor" virou "Valor Cobrado para o Cliente"** e ganhou
      **Prestador** + **Valor Cobrado pelo Prestador**. A linha do procedimento é o
      PADRÃO da empresa ("Padrão da empresa" na coluna do prestador) e cada prestador
      vinculado é uma LINHA FILHA, editável e removível, com "+ Prestador" para incluir.
      ⚠️ O botão "+ Prestador" só aparece havendo prestador AINDA NÃO vinculado: o unique
      recusaria o repetido, e o clique só falharia depois (28-d).
      ⚠️ Sob cada prestador vai o rótulo de COMO ele é pago ("Comissão de 30% do valor do
      cliente", "Paga o valor do procedimento"…). Sem isso o gestor vê dois números na
      tela e não sabe qual a clínica vai efetivamente pagar.
      ⚠️ Os vínculos vêm em BLOCO (uma consulta para a página inteira) —
      `vinculosPorProcedimento`. A lista tem centenas de linhas e uma ida ao banco por
      linha derrubaria a tela.
      ⚠️ Salvar ATUALIZA a linha com o que o backend devolveu, em vez de recarregar:
      recarregar perderia a especialidade/busca em curso num fluxo que é de repetição.
      O backend devolve a lista COMPLETA de vínculos do procedimento justamente para
      isso — nunca deduzir o novo estado no front.
- [x] 🔴 **`tb_prescricoes.prestador_id` — quem executa ESTE item.** Fica no ITEM, não no
      grupo: a mesma prescrição tem o bloqueio feito pelo veterinário da casa e o
      ferrageamento pelo ferrador externo, e uma marca por documento obrigaria a abrir
      duas prescrições para o mesmo atendimento — a MESMA razão de `medicamentoCliente` e
      `aplicadaPeloProprietario` serem por item.
      ⚠️ **Sem FK**, por duas razões: prontuário não muda porque um cadastro de prestador
      foi excluído, e `ON DELETE SET NULL` apagaria de quem era o procedimento — o ledger
      do recibo já guarda o vínculo de forma imutável.
      ⚠️ Gravado nos TRÊS pontos onde um item nasce ou muda (`criar`, `adicionarItem`,
      `atualizarItem`). Esquecer um deixa o campo no limbo — foi exatamente o defeito de
      `resolverCatalogoDoItem`, documentado no próprio arquivo.
      ⚠️ `gravarPrestadorDoItem` IGNORA item de MEDICAMENTO por construção: remédio não
      tem prestador, e aceitar o campo ali criaria linha de recibo por dose de remédio.
      ⚠️ Na EDIÇÃO o tipo vem do item ATUALIZADO: trocar procedimento→medicamento tem de
      limpar o prestador, senão o remédio herdaria o do procedimento anterior.
- [x] 🔴 **O PREÇO PASSOU A TER UM DEGRAU A MAIS** —
      `resolverValorProcedimento(tx, empresaId, nome, prestadorId)`:
      **vínculo do prestador > combo da empresa > valor padrão da empresa >
      `valorVenda` do catálogo > 0**. O vínculo vem PRIMEIRO porque é o mais específico
      que existe: é o preço daquele procedimento QUANDO É AQUELE PRESTADOR que executa.
      ⚠️ **Sem prestador no item a cadeia é a de sempre** — NENHUMA prescrição existente
      muda de preço por causa desta mudança.
      ⚠️ Continua NÃO filtrando por `ativo`: isto precifica algo que a pessoa JÁ ESCOLHEU
      ao prescrever, e inativar o vínculo entre a prescrição e a execução não pode fazer
      a linha nascer com valor 0.
- [x] **Campo PRESTADOR na tela de prescrição**, ao escolher o PROCEDIMENTO. Lista os
      prestadores COM valor cadastrado naquele procedimento num `<optgroup>` e os demais
      em outro, marcados como "sem valor cadastrado".
      ⚠️ **É OPCIONAL.** Procedimento executado pela própria equipe não tem prestador, e
      exigi-lo pararia o atendimento por causa de um cadastro que talvez nem exista.
      ⚠️ Os DOIS grupos vêm juntos de propósito: o vínculo é configuração do GESTOR e
      pode não existir ainda; travar a prescrição por causa disso pararia o atendimento.
      🔴 Prestador escolhido SEM vínculo ganha **faixa âmbar com o atalho "Definir
      valor"** — é esse aviso que evita o procedimento sair na fatura por R$ 0,00.
      ⚠️ Trocar o PROCEDIMENTO zera o prestador (o vínculo é por par): deixá-lo colado
      faria o item novo nascer com o prestador do anterior, que talvez nem o execute.
      ⚠️ A busca de prestadores só dispara em PROCEDIMENTO e com nome preenchido — no
      combobox de medicamento seria uma requisição por caractere digitado.
- [x] **FLUXO GUIADO de cadastro** (o pedido: "esse campo poderá incluir um novo
      prestador… chame a tela de prestadores e abra a de procedimentos para cadastrar o
      valor e atrelar"). A opção **+ Cadastrar novo prestador** navega para
      `/cadastro/prestadores?novo=1&depois=/cadastro/procedimentos?especialidade=&busca=`;
      ao SALVAR, o cadastro segue para lá, que abre já na especialidade certa, filtrado
      pelo procedimento, com o formulário de vínculo aberto (`?vincular=<prestadorId>`
      quando o prestador já existe e só falta o preço).
      ⚠️ `depois` só é aceito como rota INTERNA (começa com "/" e não "//"): valor
      absoluto transformaria a query em redirecionamento aberto.
      ⚠️ Os dois efeitos CONSOMEM a query (`setParams`, replace) — sem isso o modal e o
      formulário de vínculo reabririam a cada recarga da lista, por cima do que estivesse
      sendo digitado.
      ⚠️ A especialidade da URL só é imposta quando a empresa realmente a atende: vinda
      de outra clínica, ela não estaria na lista e o seletor ficaria com valor sem opção.
- [x] ✅ **Procedimento novo criado NA PRESCRIÇÃO já entra na tabela de procedimentos —
      isso JÁ FUNCIONAVA e não precisou de nada.** `resolverCatalogoDoItem`
      (PrescricaoGrupoController) chama `garantirProcedimentoDaEmpresa`
      (`lib/catalogoManual.js`) em `criar`, `adicionarItem` e `atualizarItem`: o item
      nasce com `empresaId` da clínica (nunca global — o RLS recusaria) e a espécie do
      paciente, idempotente por (nome + empresa). Conferido ponta a ponta.
- [x] 🔴 **RECIBO DE PAGAMENTO AO PRESTADOR** — `tb_execucoes_procedimento_prestador`,
      gravado em `PrescricaoGrupoController.executar` **dentro da MESMA transaction** do
      lançamento na fatura: ou o cliente é cobrado e o prestador entra no recibo, ou nada
      acontece. Fora dela existiria a janela em que a clínica cobrou e não deve a ninguém.
      🔴 **É SNAPSHOT, e por isso é TABELA e não uma consulta sobre `Prescricao`**: o
      valor cobrado do cliente, o valor do prestador e a FORMA DE PAGAMENTO dele mudam
      com o tempo. Um recibo de março recalculado com o percentual de setembro pagaria
      valor diferente do acordado, e não haveria como provar o contrário — mesma premissa
      de `FaturaItem.descricao` e do snapshot do documento emitido.
      ⚠️ `animal_nome` e `procedimento_nome` são GRAVADOS: o recibo precisa dizer o que
      foi feito mesmo que o paciente seja renomeado ou o procedimento saia do catálogo.
      ⚠️ `registrarExecucao` **NUNCA lança**: falha ali não pode derrubar a execução
      clínica. Base não migrada devolve `null` e a fatura sai como sempre saiu.
      ⚠️ Registra TAMBÉM com `medicamentoCliente` (item fornecido pelo cliente, que não é
      cobrado): o serviço foi prestado e o prestador tem de ser pago. Nesse caso
      `valorCliente` é 0, então a comissão PERCENTUAL sai 0 — consequência correta de não
      haver receita, não erro de cálculo.
      ⚠️ `fatura_item_id` NÃO é rastreado: `adicionarOuSomarFaturaItem` CONSOLIDA doses
      na mesma linha, então não existe um FaturaItem por execução para apontar. O recibo
      se sustenta sozinho — é o documento do outro lado, não um espelho da fatura.
- [x] **Tipo de pagamento novo `POR_PROCEDIMENTO`** no cadastro do prestador. A conta do
      recibo (`calcularValorAPagar`, função PURA):
      ```
      POR_PROCEDIMENTO          → valor_prestador do VÍNCULO × quantidade
      COMISSAO + PERCENTUAL     → % sobre o Valor Cobrado para o Cliente
      COMISSAO + VALOR          → comissão fixa × quantidade
      SALARIO                   → 0 (remuneração fixa; não se apura por procedimento)
      sem cadastro              → 0 + base SEM_CONFIG (pendência à vista)
      ```
      ⚠️ **`POR_PROCEDIMENTO` NÃO entra em `TIPOS_PAGAMENTO` de `lib/usuarioEmpresa.js`**
      — aquela lista é compartilhada com o INCLUIR MEMBRO (`tb_usuario_empresa`), e o
      valor lá ficaria aceito no backend do MEMBRO sem que nenhuma tela o ofereça: um
      estado alcançável só por chamada direta à API, que ninguém consegue configurar nem
      corrigir depois. Mora em `lib/procedimentoPrestador.js` e há **teste travando** a
      separação. Mesma decisão no front (`TIPOS_PAGAMENTO_PRESTADOR` é local da tela).
      ⚠️ No cadastro, `POR_PROCEDIMENTO` **substitui** o campo de valor pela explicação,
      e grava forma/valor como NULL — um valor ali daria DUAS fontes possíveis para o
      mesmo pagamento, e o recibo teria de escolher uma sem ninguém saber qual.
      ⚠️ **PERCENTUAL não multiplica por quantidade**: `valorCliente` já é o total da
      execução (o mesmo que foi para a fatura) — multiplicar de novo pagaria em dobro.
      `VALOR_FIXO` e `VALOR_PROCEDIMENTO` são preços UNITÁRIOS e esses sim acompanham.
      ⚠️ **SALARIO é 0 mas a execução É REGISTRADA**: apagá-la faria o assalariado
      desaparecer do relatório e ninguém conferiria o que ele produziu. A base
      `SALARIO` é distinta de `SEM_CONFIG` de propósito — a primeira é uma DECISÃO, a
      segunda uma PENDÊNCIA que a tela cobra; confundi-las mandaria o gestor cadastrar
      algo que já está cadastrado.
      ⚠️ Dinheiro é arredondado ao CENTAVO **na gravação**: 183,33 × 30% dá
      55,000000000000004, e 30 linhas dessas fecham o recibo com um centavo que ninguém
      consegue explicar.
      🔴 **DEFEITO ACHADO PELO TESTE**: `num()` usava `Number.isFinite` cru, e
      `Number(null)` é 0 — coluna VAZIA voltava como 0. Isso derrubava DUAS regras de
      uma vez: `valorCliente` nulo (herança do padrão) virava "R$ 0,00" na tela, e
      prestador POR_PROCEDIMENTO sem valor no vínculo caía em `VALOR_PROCEDIMENTO` com 0
      em vez de `SEM_CONFIG` — a pendência desaparecia do recibo.
- [x] **Tela `/recibos-prestador`** (Sidebar › Financeiro), com o `PeriodoSelector` de
      sempre: **Dia · Semana · Mês · Ano**. Um card por prestador com nome, documento,
      forma de pagamento e total, e a lista de itens — **Animal · Procedimento executado
      · Data da execução · Cobrado do cliente · Valor** —, em `JanelaLista` de 3.
      Botão Imprimir por prestador e para o período inteiro.
      ⚠️ Prestador SEM execução no período não aparece: recibo de valor zero para quem
      não trabalhou é ruído, e a lista existe para dizer A QUEM PAGAR.
      ⚠️ O aviso de PENDÊNCIA fica no TOPO, não escondido em cada recibo: prestador sem
      forma de pagamento faz o total do período sair MENOR do que a clínica deve, e quem
      paga precisa saber disso antes de fechar o mês.
      ⚠️ Janela `[inicio, fim)` com `fim` EXCLUSIVO (+1ms sobre o `fim` inclusivo de
      `resolverPeriodo`): com `<=` numa data sem hora, a execução do último milissegundo
      do período ficaria de fora.
      ⚠️ Base sem a migration devolve `indisponivel: true` e a tela EXPLICA — em vez de
      "nada a pagar", que é uma afirmação diferente (e errada).
      ⚠️ UMA `JanelaLista` por breakpoint, com a classe do breakpoint NELA: o seletor
      padrão casa linha de tabela E card, e uma janela só em volta dos dois blocos
      contaria os itens em dobro.
- [x] **A folha** (`utils/ReciboPrestadorPrint.ts`) é um RECIBO, não uma fatura: traz a
      frase de **quitação** com o valor **por extenso**, o discriminativo do serviço e a
      assinatura **de quem RECEBE**. Uma folha por prestador — juntar dois no mesmo papel
      produziria um comprovante que nenhum dos dois pode levar.
      ⚠️ `GET /recibos-prestador/emitente` devolve só a IDENTIFICAÇÃO da clínica.
      **Chave PIX e conta bancária ficam FORA de propósito**: aqueles campos existem para
      o cliente PAGAR a clínica, e imprimi-los num documento que vai ao prestador
      publicaria os dados de recebimento dela para terceiros.
      ⚠️ Valor por extenso escrito à mão (sem dependência nova): a folha é HTML puro num
      iframe, e uma biblioteca não se paga por 40 linhas.
- [x] **Slugs novos `financeiro.recibos.ler` / `.imprimir`** — submódulo PRÓPRIO, não uma
      ação de `faturas`. A fatura é o que a clínica COBRA do cliente; o recibo é o que ela
      PAGA a terceiros, e são decisões separadas na prática: reaproveitar o slug daria
      acesso à folha de pagamento de terceiros a todo mundo que fatura. Defaults: GESTOR
      FULL, FINANCEIRO EQUIPE, **todos os demais NENHUM**.
- [x] Testes: `__tests__/procedimentoPrestador.test.js` (26 casos) — a matriz do cálculo
      inteira, o arredondamento, a separação em relação a `TIPOS_PAGAMENTO`, e um GATE
      ESTRUTURAL que varre o código e reprova a execução sem `registrarExecucao`, o preço
      sem o prestador do item e o vínculo sem a conferência de empresa.
      ✅ **Verificado que REPROVA**: removidos o registro do ledger e o prestador da
      resolução de preço, **3 casos falharam**. Suíte: **735**; `tsc --noEmit` (backend),
      `tsc -b` e `vite build` limpos.
- [ ] **O PRESTADOR não vê o próprio recibo.** `financeiro.recibos.ler` nasce NENHUM para
      o cargo FORNECEDOR/PRESTADOR, e a rota não filtra por "sou eu". Dar isso exige
      decidir o recorte (só as próprias execuções) e um gate por identidade, não só por
      slug — não foi pedido.
- [ ] **Execução ANTERIOR à migration não entra em recibo nenhum**, e não há backfill
      possível: `FaturaItem.veterinarioId` guarda quem LANÇOU a cobrança, não quem
      executou o procedimento. Deduzir produziria um recibo que a clínica pagaria sobre
      uma atribuição que ninguém fez.
- [ ] **VACINA e EXAME não têm prestador.** A regra vale só para PROCEDIMENTO, que foi o
      pedido. O caminho é o mesmo (coluna no item + a chamada no `executar` daquele
      controller), mas cada um tem o seu ciclo de execução.
- [ ] O vínculo tem coluna `ativo` e ela é gravada, mas a tela não oferece
      inativar/reativar — só remover. Vínculo é configuração de preço (não registro
      clínico), então o hard delete é adequado; se um dia fizer falta um histórico de
      preços, a coluna já está lá.

---

### Sessão 2026-09-08 (parte 5) — Avisos de orçamento, PIX na fatura e a senha que ninguém vê

> ✅ **MIGRATIONS APLICADAS** (autorizadas): `20260928000000_empresa_dados_recebimento`
> (PIX/banco) e `20260929000000_prestador_restringir_por_local`. `prisma generate`
> segue falhando com `EPERM` (§11), então TODAS as colunas novas desta leva são lidas
> e gravadas por SQL cru com `catch` — `lib/dadosRecebimento.js`,
> `PrestadorController#gravarRestricaoPorLocal` e `lib/animalScope.js`.

- [x] 🔴 **O CANCELAMENTO DE ORÇAMENTO VENCIDO SEMPRE FUNCIONOU — o job é que nunca
      rodou.** Diagnóstico do caso relatado (MarcoVet, orçamento de 10/08 ainda em
      aberto): `tb_cron_execucoes` não tinha NENHUMA execução do
      `cancelar_orcamentos_vencidos`. Ele está agendado para 23:50 e o backend de
      desenvolvimento não fica no ar nesse horário; `node-cron` não recupera disparo
      perdido (limitação já registrada em 2026-08-23 parte 4). Rodado à mão
      (`npm run job -- cancelar_orcamentos_vencidos`): cancelou na hora, com o motivo
      gravado na observação. **Nenhuma linha de código precisou mudar.**
      ⚠️ Diagnosticar isso exige `set_config` de plataforma na consulta:
      `tb_empresa_configuracoes` está sob RLS e volta VAZIA sem o carimbo — foi
      exatamente o que fez a primeira leitura parecer "nenhuma clínica configurou
      validade" (armadilha 42).
- [x] **DOIS AVISOS NOVOS por WhatsApp ao(s) GESTOR(es)** — `orcamentoAvisoService.js`:
      **semanal** ("existe orçamento esperando decisão", segundas 09:00) e **véspera**
      ("estes SERÃO CANCELADOS AMANHÃ", diário 08:00, marcado com 🔴).
      🔴 **A VÉSPERA É UM DIA EXATO** (`dias === validade - 1`), não "faltam <= 1 dia":
      o job roda todo dia, e com `<=` o mesmo orçamento dispararia o alerta vermelho
      todos os dias até o cancelamento — alerta que chega todo dia deixa de ser lido,
      justamente no dia em que importava.
      ⚠️ "Em vermelho" no WhatsApp é 🔴 + caixa alta no verbo: o app não tem cor de
      texto, e prometer uma que não existe deixaria os dois avisos idênticos.
      ⚠️ O aviso de véspera roda ANTES do cancelamento (08:00 × 23:50): quem decidir no
      dia ainda mantém o orçamento.
      ⚠️ `0 9 * * 1` (segundas), e NÃO `*/7` no dia do mês: `*/7` reinicia todo mês
      (1, 8, 15, 22, 29, e então 1 de novo — dois dias depois), que não é "a cada 7 dias".
      ⚠️ Teto de 5 orçamentos nomeados + "e mais N": a contagem REAL não se perde, e a
      mensagem continua legível no celular.
      ⚠️ Gestor sem telefone não é erro — o job segue com os outros.
- [x] 🔴 **DADOS PARA RECEBIMENTO NA FATURA** (chave PIX, recebedor, banco, agência,
      conta). Até aqui o cliente recebia a fatura e não tinha para onde pagar.
      Ficam em `tb_empresas`, não em `EmpresaConfiguracao`: quem recebe é o CNPJ/CPF
      que EMITE a cobrança, não a equipe que atendeu.
      ⚠️ `pixRecebedor` é campo PRÓPRIO, separado da razão social: a conta pode estar
      no nome do sócio, e imprimir outro nome faria o cliente desconfiar do PIX.
      ⚠️ Sem máscara na chave: ela pode ser CPF, CNPJ, e-mail, telefone ou aleatória —
      normalizar quebraria as duas últimas.
      ⚠️ Campo em branco não vira linha, e sem NENHUM dos cinco a folha não ganha faixa
      vazia (regra do campo vazio). Faixa vazia em documento de cobrança é pior que a
      ausência dela: sugere que falta um dado que deveria estar ali.
      ⚠️ Os dados saem pela MESMA rota da logo — as duas são identidade da clínica na
      folha, e uma rota nova custaria uma ida a mais por abertura da tela. Chegam
      também ao envio em LOTE.
      ⚠️ `FaturaExport.ts` ganhou `esc()`: a chave e o recebedor são digitados pelo
      gestor e viram markup — sem escapar, um sinal de menor quebra a folha e o pior
      caso é script no PDF que vai ao cliente.
- [x] **Pelagem OBRIGATÓRIA no cadastro do paciente** — é a identificação do animal nos
      documentos do CFMV, onde o campo em branco deixa o papel sem identificar ninguém.
      ⚠️ Campo obrigatório precisa dos QUATRO (asterisco, `data-campo`, classe de erro,
      mensagem embaixo) MAIS a entrada em `CAMPOS_ANIMAL` e em `erroDoCampo` — faltando
      um, o submit acusa e o usuário não descobre onde.
- [x] **"Fornecedor" virou "Prestador"** no Perfil de acesso, na Equipe e no Controle
      de Acesso. ⚠️ Só o RÓTULO: o valor gravado continua `FORNECEDOR`, que é o cargo
      em `MembroEquipe.cargo`, o `userType` correspondente e a chave dos gates de
      escopo do prestador. Trocar o valor exigiria migrar todo membro já cadastrado, o
      seed de permissões e as matrizes de perfil de cada equipe.
- [x] **Novo Prestador**: "Secretária" saiu do Tipo de Serviço (é função INTERNA — quem
      a cadastra usa Incluir Membro), e entrou **"Atender somente no local de
      trabalho"**. "Terá acesso ao sistema" já existia.
      🔴 **O CHECKBOX TEM EFEITO REAL**, e isso exigiu duas coisas: coluna
      `tb_prestadores.restringir_por_local` (o Prestador NÃO cria `MembroEquipe`, então
      não havia onde persistir) e um ramo novo em `lib/animalScope.js`.
      ⚠️ Para o prestador a restrição **ESTREITA a DESIGNAÇÃO (AND), nunca a
      substitui**: trocar uma pela outra daria acesso a paciente que ninguém designou.
      ⚠️ O flag é lido à parte na listagem, não pelo `include`: o client Prisma só
      seleciona colunas que conhece, e sem isso o checkbox abriria sempre desmarcado na
      edição — apagando em silêncio o que o gestor tinha configurado.
- [x] **Nova Localização**: saiu a frase sobre "cadastrada como CLIENTE" (detalhe
      interno de tenancy que ninguém precisa decidir), saíram CANIL, GATIL, PETSHOP e
      PROPRIETARIO da lista oferecida, e o select virou o **combobox criável com
      busca** — o MESMO `TipoServicoSelect` do Prestador.
      🔴 **O tipo criado pela clínica reusa `tb_catalogo_tipo_servico`** (categoria
      LOCALIZACAO): traz de graça o tenant, a policy de RLS e o gate de permissão que a
      tabela já tem. Um catálogo novo exigiria repetir os três.
      ⚠️ **`TIPOS_LEGADOS`**: os quatro removidos continuam ACEITOS no backend.
      Localização já cadastrada com um deles não pode virar inválida — ela seguiria no
      banco e passaria a recusar qualquer edição, inclusive corrigir o nome. E entram
      no filtro por espécie, senão o local onde o animal está sumiria da tela.
- [x] 🔴 **A SENHA INICIAL NÃO É MAIS MOSTRADA, e não é mais a mesma para todos.**
      Era a constante `Inicial_001`, impressa na tela de quem cadastra — um TERCEIRO,
      não o dono da conta — e igual para todo mundo: quem tivesse lido a tela uma vez
      sabia a senha de toda conta nova do sistema, inclusive as que ainda não existiam.
      Agora é derivada do cadastro (`lib/senhaInicial.js`, a composição pedida) e sai
      **só pelo e-mail de boas-vindas** — conferido: os 11 pontos de uso passam por
      `emailService`, nenhum por `res.json`.
      🔴 **DEFEITO ENCONTRADO NO CAMINHO**: `AnimalController` anunciava por e-mail
      `Inicial#001` (com cerquilha) enquanto o hash gravado era de `Inicial_001` (com
      sublinhado). O proprietário recebia uma senha que **nunca existiu** e não
      conseguia entrar — sem erro em lugar nenhum, porque as duas pontas nunca se
      comparavam. É o tipo de divergência que só uma fonte única elimina.
      ⚠️ **Determinística de propósito** (mesmo cadastro, mesma senha): é o que permite
      reenviar o e-mail de boas-vindas sem redefinir a senha de quem ainda não entrou. A
      proteção não vem de ser imprevisível — vem de ser de USO ÚNICO
      (`mustChangePassword`) e de nunca aparecer em tela.
      ⚠️ Cadastro incompleto NÃO gera senha curta: o que falta é dado do cliente, e
      encolher a senha entregaria a conta mais frágil a quem tem o cadastro pela metade.
      ⚠️ O resto do fluxo não mudou: troca obrigatória no primeiro acesso, mesmos
      e-mails, mesmas rotas.
- [x] **Agenda: profissional sem local mostra o NOME DA EMPRESA**, não um traço. O
      traço não dizia se o dado faltava ou se o atendimento é na sede — é na sede.
      ⚠️ Só o rótulo muda; `localId` continua `null`, que é o que o backend usa.
- [x] 🔴 **O CARD DE PACIENTE PASSOU A ACEITAR DIGITAÇÃO EM TODAS AS TELAS.**
      `SeletorAnimal` era um select puro, e as telas que o usam (Dieta, Resultado de
      Exame, Relatório Nutricional) obrigavam a rolar centenas de pacientes até "Zeus"
      — enquanto o Atendimento já resolvia em três letras. Ele passou a renderizar o
      `SeletorAnimalInteligente` por dentro.
      ⚠️ A troca é NO COMPONENTE, não em cada tela: é o que faz as três ganharem a busca
      de uma vez e o que impede a próxima tela de nascer com o seletor antigo.
      ⚠️ O que `SeletorAnimal` acrescenta ao combobox é a NAVEGAÇÃO (leva para
      `rotaBase/:id` preservando a query) e o `SelectedAnimalContext`. O combobox não
      sabe disso e não deve saber: ele é a escolha, não o destino.
- [x] Testes: `orcamentoAviso.test.js` (11) e `senhaInicial.test.js` (12). Suíte: **657**.
- [ ] O `cancelar_orcamentos_vencidos` (e os dois avisos novos) só disparam com o
      backend no ar no horário agendado. Enquanto não houver varredura de recuperação
      ("processe o que já devia ter rodado"), uma queda no horário do job empurra o
      trabalho para o dia seguinte — ou para nunca, no ambiente de dev.
- [ ] O e-mail de boas-vindas passou a anunciar uma senha DERIVADA. Vale um envio real
      de conferência antes de anunciar ao cliente: os testes cobrem a composição, não a
      renderização do template.

> ✅ **MIGRATIONS APLICADAS** (autorizadas): `20260926000000_empresa_crmv` e
> `20260927000000_orcamento_motivo_recusa`. `npx prisma generate` FALHOU com `EPERM`
> (§11 — o backend segurava o query engine), então as três colunas novas são lidas e
> gravadas por **SQL cru com `catch`**: `lib/documentoVariaveis.js#crmvDaEmpresa` e
> `lib/orcamentoRecusa.js`. Rodar o generate na próxima parada do backend.

- [x] 🔴 **O NÚMERO DO CARD ABRE A LISTA, no lugar de trocar de tela.** Cada indicador
      era um LINK (`/agendamentos?status=…`, `/animais-vet`, `/orcamento?status=…`), e
      isso PERDIA o período do relatório: clicar em "Consultas canceladas" de julho
      caía na agenda de hoje. Pior nos casos em que a tela de destino sequer sabe fazer
      aquele recorte. Agora o card abre a lista logo abaixo, com o mesmo recorte que
      ele conta — o padrão que o card "Histórico" do Atendimento já usava.
      Componente único **`components/relatorios/DetalheDoCard.tsx`** (três telas, três
      cópias divergiriam na primeira correção). As COLUNAS são declaradas por quem usa;
      o que ele fixa é o COMPORTAMENTO: um card por vez, o título dizendo qual, a
      janela de 3 itens e o vazio explicado.
      `StatTiles` ganhou `onSelect`/`ativo` — e o tile virou `<button>` de verdade, com
      `aria-pressed`, não `<div onClick>`.
      ⚠️ Trocar o período FECHA o card aberto: os números mudam, e a lista de julho
      embaixo dos cards de agosto seria mentira silenciosa.
- [x] 🔴 **A CONTAGEM E A LISTA SAEM DO MESMO `where`.** As quatro consultas trocaram
      `count()` por `findMany()`, e o número passou a ser o TAMANHO da lista. Contar de
      um jeito e listar de outro é como um card passa a exibir 7 e abrir 6 — e ninguém
      nota. Pelo mesmo motivo as linhas viajam JUNTO do relatório, não numa rota por
      card: uma segunda ida ao banco pagaria o mesmo `where` de novo e poderia divergir.
- [x] **Indicadores de Atendimento: 3 cards novos** — sem atendimento no dia, há mais
      de 3 e há mais de 7 dias (vieram do Mapa, que só tinha o "no dia").
      ⚠️ "Atendido" é EVOLUÇÃO FINALIZADA, o mesmo critério do resto da tela: consulta
      marcada ou em andamento não conta, senão agenda cheia viraria paciente atendido.
      ⚠️ A contagem parte da data de REFERÊNCIA do período, não do relógio de agora —
      um relatório de julho tem de responder sobre julho.
      ⚠️ Paciente NUNCA atendido entra em todas as faixas (é o que ninguém quer perder
      de vista) e a lista o marca como "nunca atendido", não com uma data inventada.
- [x] **Relatórios de Cadastro: 4 cards novos** — pacientes e proprietários inativados
      e reativados no período.
      🔴 **A FONTE É O AUDITLOG**, não uma coluna do cadastro: `Animal.inativo_em`
      guarda só a ÚLTIMA vez (um paciente inativado em julho e de novo em agosto
      sumiria de julho), e o cadastro do cliente não tem data de inativação nenhuma. O
      AuditLog é o ledger — uma linha por ato, com quando, por que e por quem.
      🔴 **O CLIENTE GRAVAVA `ALTERACAO`/`EXCLUSAO`**, enquanto paciente, fornecedor,
      prestador e tratador sempre gravaram `INATIVACAO`/`ATIVACAO`. Por isso ele não
      aparecia em nenhum recorte de "quem foi inativado". Alinhado — e `removerDaEmpresa`
      passou de `EXCLUSAO` para `INATIVACAO`, que é o que o ato faz: não apaga nada,
      inativa o cadastro nesta clínica.
      ⚠️ Linha JÁ GRAVADA continua com a categoria antiga — o AuditLog é imutável, e
      reescrevê-lo seria adulterar a auditoria. O recorte enxerga daqui em diante.
- [x] **Relatório de Orçamentos**: cards de **Valor rejeitado** e **Cancelados** (novos)
      e a lista com proprietário, animal, data, valor e **MOTIVO**.
      ⚠️ `ativo: true` saiu do `where`: o CANCELADO é justamente um dos recortes
      pedidos, e o filtro escondia o card inteiro.
      ⚠️ O "valor rejeitado" soma item `REJEITADO`, nunca `PENDENTE` — contar o
      pendente como recusa inventaria uma decisão que ninguém tomou.
      ⚠️ O motivo vem de três lugares, nesta ordem: recusa do orçamento inteiro →
      cancelamento (que o sistema acrescenta à `observacao`) → nada.
- [x] 🔴 **O QUE NÃO FOI APROVADO DIZ POR QUÊ** — colunas novas `motivo_recusa` em
      `tb_orcamentos` e `tb_orcamento_itens`. Sem elas, a clínica sabia que "3 de 7
      caíram" e não sabia se foi preço, prazo ou o cliente ter resolvido tratar em
      outro lugar — que é o que permitiria renegociar.
      ⚠️ **As duas metades da regra têm razões OPOSTAS** (`faltaMotivoDeRecusa`, função
      pura em `lib/orcamentoRecusa.js`): recusa TOTAL pede UM motivo — o cliente
      recusou o documento, não sete linhas, e exigir sete justificativas idênticas vira
      obstáculo, que se contorna digitando "x" sete vezes; recusa PARCIAL pede POR
      ITEM, porque cada linha pode ter caído por uma razão diferente, e o motivo geral
      serve de padrão para quem tem uma razão só.
      ⚠️ Item ACEITO tem o motivo LIMPO na gravação: manter o texto de uma recusa
      anterior faria o relatório contradizer o status.
      ⚠️ O input do motivo fica FORA do `<button>` da linha do item — input dentro de
      botão é HTML inválido, e cada tecla digitada alternaria a seleção do item.
- [x] Testes: `__tests__/orcamentoMotivoRecusa.test.js` (9 casos) — as duas metades da
      regra, o motivo só com espaços, a chave em string como chega do JSON. Suíte: 634.
- [x] 🔴 **"APROVADO PARCIALMENTE" ABRE A QUEBRA POR ITEM** (esclarecido em 2026-09-08:
      o pedido não era um card novo, era PROFUNDIDADE). "Rejeitados parcialmente" seria
      o MESMO conjunto de "Aprovados parcial." com outro nome — o que faltava não era
      contar de novo, era dizer **quais** itens caíram, **quantos**, e **por quê**.
      A linha do relatório ganhou a coluna "Itens" (`3/7 · 4 reprov.`) e uma SETA que
      abre, dentro dela, a lista item a item: selo Aprovado/Reprovado/Sem decisão,
      descrição, animal, valor e o MOTIVO de cada recusa.
      ⚠️ `PENDENTE` é uma terceira coluna, não meio-a-meio: somá-lo a aprovados ou a
      recusados afirmaria uma decisão que ninguém tomou (é o rascunho).
      ⚠️ Item recusado SEM motivo próprio herda o do orçamento — é assim que a decisão
      é gravada (um motivo só quando a razão é uma só), e a tela tem de mostrar o que
      foi decidido, não uma lacuna.
      ⚠️ Linha SEM item não ganha seta (`detalheDaLinha` devolve `null`): expansão
      vazia é botão que promete e não entrega (28-d).
      ⚠️ A linha do painel NÃO entra na conta da `JanelaLista`
      (`seletor="tbody > tr:not([data-detalhe-linha])"`) — contada, a janela encolheria
      de 3 registros para 2 assim que alguém expandisse um.
- [ ] O relatório de cadastro lista "Pacientes ativos" inteiro, sem paginação. Base
      grande deixa a resposta pesada — a janela de 3 itens resolve a TELA, não o
      tráfego. Paginar quando incomodar.

---

# Atualizado em: 2026-09-08 (partes 3 a 5) (LEVA GRANDE — seis frentes. O que mais
#   importa saber ao voltar aqui:
#   1. 🔴 **SENHA INICIAL DERIVADA E NUNCA EXIBIDA** (`lib/senhaInicial.js`). Era a
#      constante `Inicial_001`, impressa na tela de QUEM CADASTRA e igual para todo
#      mundo. E `AnimalController` anunciava por e-mail `Inicial#001` — senha que
#      NUNCA existiu, sem erro em lugar nenhum. Agora sai só pelo e-mail.
#   2. 🔴 **MODAL ARRASTÁVEL COMIA A SELEÇÃO DE TEXTO EM 19 MODAIS** — `.rounded-t-2xl`
#      está no PAINEL, não no cabeçalho, e o corpo inteiro virava alça. O painel nunca
#      é a própria alça (`useDraggableModals`).
#   3. 🔴 **MEMÓRIA CLÍNICA v5**: destaque não leva id de tópico no texto, traz TODAS as
#      datas e encadeia o que foi prescrito/executado no mesmo atendimento. Com rede
#      atrás do prompt (`semIdsDeTopico` + deduplicação).
#   4. 🔴 **RELATÓRIOS ABREM O NÚMERO** (`DetalheDoCard`, três telas): o card deixou de
#      ser link e passou a listar embaixo, com a contagem e a lista saindo do MESMO
#      `where`. "Aprovado parcialmente" abre item a item, com o motivo de cada recusa.
#   5. 🔴 **O CRON DE ORÇAMENTO SEMPRE FUNCIONOU — nunca havia rodado** (backend fora
#      do ar às 23:50). Dois avisos novos por WhatsApp ao gestor: semanal e véspera.
#   6. **PIX/banco na fatura**, pelagem obrigatória, Fornecedor→Prestador (só o
#      rótulo), restrição por local do prestador COM efeito real, tipo de localização
#      criável por empresa, e o card de paciente aceitando digitação em todas as telas.
#   ✅ 4 MIGRATIONS APLICADAS. ⚠️ `prisma generate` segue falhando com EPERM (§11) —
#   toda coluna nova é lida/gravada por SQL cru com `catch`. Suíte: 657.
#   Detalhes nas sessões 2026-09-08 (partes 3, 4 e 5) da §12.)
---

# Atualizado em: 2026-09-08 (🔴 FECHAR UMA FATURA ABRE A SEGUINTE + status novo
#   **REABERTA**. Duas regras que quebram em SILÊNCIO, e por isso têm gate próprio.
#   1. 🔴 **O CICLO SEGUINTE SÓ NASCIA SE ALGUÉM TOCASSE NO CLIENTE.** A fatura nova
#      vinha de `obterFaturaProprietario` (abrir a tela) ou de `getOrCreateFatura`
#      (primeiro lançamento clínico) — nunca do FECHAMENTO. No fechamento automático
#      da madrugada ninguém está na tela: o cliente ficava sem fatura corrente até o
#      próximo atendimento, e a **Assistência Veterinária Mensal**, que é cobrança
#      RECORRENTE e não depende de atendimento nenhum, só entrava quando alguém
#      abrisse a tela. Mensalista sem consulta no mês simplesmente não era cobrado.
#      Novo `FaturaController.abrirProximaFatura`, ligado aos QUATRO caminhos de
#      fechamento: `fecharFatura`, `fecharFaturasLote`, `atualizarStatus` e o cron
#      `fechamento_faturas`. A nova nasce com os itens PADRÃO pela MESMA
#      `adicionarAssistenciaMensal` do fechamento — item padrão novo entra LÁ e vale
#      para os dois lados.
#      ⚠️ **NÃO cria se o cliente já tem outra em aberto NESTA empresa** (ABERTA ou
#      REABERTA, fora a que fechou). Duas correntes partem o mês em duas:
#      `getOrCreateFatura` pega a primeira que achar e metade dos lançamentos some da
#      vista. É essa guarda que a torna IDEMPOTENTE — e o que permite chamá-la do
#      lote e do cron sem contar quantas vezes rodou.
#      ⚠️ `mesReferencia` é o do mês SEGUINTE (`proximoMesReferencia`), não o atual:
#      quem fecha no dia 23 abre um ciclo cobrado no mês que vem, e repetir o rótulo
#      deixaria duas linhas idênticas no seletor de mês.
#      ⚠️ No CRON, `db` é o `tx` da empresa da vez — com o `prisma` global o RLS
#      recusa a criação em silêncio (a mesma armadilha de 2026-08-23 parte 4).
#      ⚠️ Nas rotas HTTP a chamada passa por `abrirProximaFaturaSemQuebrar`: falhar em
#      ABRIR a seguinte não pode virar "erro ao fechar" sobre uma fatura que fechou.
#   2. 🔴 **REABRIR NÃO DEVOLVE A FATURA A "ABERTA".** Fatura FECHADA/ATRASADA/PAGA que
#      volta a ser editável grava **REABERTA**. As duas são editáveis; só a ABERTA é a
#      CORRENTE, a que `getOrCreateFatura` acha para receber o lançamento de hoje. Sem
#      a distinção, reabrir agosto para corrigir uma linha fazia a cobrança de setembro
#      cair dentro de um documento que o cliente já recebeu.
#      ⚠️ A conversão é do BACKEND (`statusAoReabrir`), não da tela: o botão "Reabrir"
#      continua mandando `ABERTA`. Cliente antigo não muda de comportamento.
#      ⚠️ **REABERTA reaberta continua REABERTA** — fatura que já passou por um
#      fechamento não volta a ser "aberta" nunca mais. (Foi o teste que pegou este
#      buraco: a primeira versão a rebaixava para ABERTA.)
#      ⚠️ CANCELADA fica FORA da conversão: desfazer um cancelamento é UNDO, não
#      reabertura.
#      ⚠️ O cron de ATRASADAS só olha `FECHADA` — reabrir PAUSA a marcação de atraso,
#      de propósito; fechada de novo, ela volta a ser marcada.
#      ⚠️ O cron de FECHAMENTO só varre `ABERTA`: a REABERTA está sob correção humana,
#      e fechá-la sozinha desfaria um ato deliberado. CONSEQUÊNCIA ACEITA: reaberta
#      esquecida fica em aberto até alguém fechá-la à mão.
#      **SEM MIGRATION** — `tb_faturas.status` é TEXT, sem limite; status novo só
#      precisa entrar nas listas de `lib/faturaUtils.js`.
#      REABERTA entra em `['ABERTA','FECHADA']` dos três relatórios (Dashboard,
#      Relatórios Financeiros e devedores do Gerencial): é fatura NÃO PAGA, e sair do
#      indicador porque alguém a destravou esconderia dinheiro a receber.
#      Front: aba/pílula/bolinha **Reaberta** (laranja) ao lado de Aberta, `canEdit`
#      cobrindo as duas, e `faturaReaberta` como campo PRÓPRIO — na mesma aba da
#      ABERTA uma esconderia a outra.
#   Gate novo `__tests__/faturaCicloFechamento.test.js` (26 casos) — verificado que
#   REPROVA: sabotados os elos de `fecharFatura`, do cron e do `statusAoReabrir`, três
#   casos falharam. Suíte: **610**. Detalhes na §12, sessão 2026-09-08.)
---

### Sessão 2026-09-08 — Fechar abre a seguinte; reabrir grava REABERTA

- [x] 🔴 **O DEFEITO: o ciclo seguinte não nascia do FECHAMENTO.** A fatura nova só
      aparecia quando alguém tocava naquele cliente — abrindo a tela dele
      (`obterFaturaProprietario` cria a ABERTA do mês) ou lançando o primeiro item
      clínico (`getOrCreateFatura`). No cron da madrugada não há ninguém na tela: o
      cliente ficava sem fatura corrente até o próximo atendimento e a **Assistência
      Veterinária Mensal** — cobrança RECORRENTE, que não depende de atendimento
      nenhum — só entrava quando alguém abrisse a tela. **Mensalista sem consulta no
      mês não era cobrado**, e nada acusava: percebe-se no fim do mês, no faturamento
      a menos.
      Novo `FaturaController.abrirProximaFatura(fechada, { veterinarioId, db })`,
      ligado aos QUATRO caminhos: `fecharFatura` (botão), `fecharFaturasLote`,
      `atualizarStatus` (a outra porta para FECHADA) e o cron `fechamento_faturas`.
- [x] **A nova nasce com os ITENS PADRÃO pela mesma `adicionarAssistenciaMensal`** do
      fechamento — uma segunda cópia da regra do valor divergiria na primeira
      correção, e item padrão novo passa a valer para os dois lados de graça.
- [x] ⚠️ **NÃO cria se o cliente já tem outra em aberto NESTA empresa** (ABERTA ou
      REABERTA, fora a que acabou de fechar). Duas correntes ao mesmo tempo partem o
      mês em duas: `getOrCreateFatura` pega a primeira que achar e metade dos
      lançamentos some da vista. É essa guarda que torna a chamada IDEMPOTENTE — e o
      que permite chamá-la do LOTE e do cron sem contar quantas vezes rodou.
      ⚠️ Fatura em aberto de OUTRA empresa não impede: o ciclo é por clínica.
      ⚠️ Fatura LEGADA por animal (sem `proprietarioId`) não tem ciclo mensal a abrir;
      sem `empresaId` também não — a nova nasceria sem tenant.
- [x] ⚠️ **`mesReferencia` é o do mês SEGUINTE** (`proximoMesReferencia`), não o atual:
      quem fecha no dia 23 abre um ciclo que será cobrado no mês que vem, e repetir o
      rótulo deixaria duas linhas idênticas no seletor de mês da tela — com `?mes=`
      devolvendo sempre a mais recente e a fechada ficando inalcançável.
- [x] ⚠️ **No CRON, `db` é o `tx` da empresa da vez.** Com o `prisma` global o RLS
      recusa a criação em silêncio — a MESMA armadilha que fazia o fechamento nunca
      acontecer no dia configurado (2026-08-23 parte 4). Há gate estrutural exigindo
      `abrirProximaFatura(fatura, { db: tx })` no corpo do job.
- [x] ⚠️ **Nas rotas HTTP a chamada passa por `abrirProximaFaturaSemQuebrar`**: falhar
      em ABRIR a seguinte não pode transformar um fechamento BEM-SUCEDIDO em "erro ao
      fechar" na tela. A fatura já fechou, e o ciclo novo ainda nasce sozinho no
      primeiro lançamento. No cron o atalho NÃO é usado — lá a falha tem de aparecer
      no diário da execução, que é onde se investiga.
- [x] 🔴 **REABRIR NÃO DEVOLVE A FATURA A "ABERTA" — status novo `REABERTA`.** Fatura
      FECHADA/ATRASADA/PAGA que volta a ser editável grava REABERTA. As duas são
      editáveis; só a ABERTA é a fatura CORRENTE, a que `getOrCreateFatura` acha para
      receber o lançamento clínico de hoje. Sem a distinção, reabrir agosto para
      corrigir uma linha fazia a cobrança de setembro cair dentro de um documento que
      o cliente já tinha recebido — e ninguém na tela tinha como saber disso.
      ⚠️ **A conversão é do BACKEND** (`statusAoReabrir`, em `lib/faturaUtils.js`), não
      da tela: o botão "Reabrir" continua mandando `ABERTA`, então cliente antigo não
      muda de comportamento. Pôr a decisão no front daria a cada chamador uma regra
      própria.
      ⚠️ **REABERTA reaberta continua REABERTA** — fatura que já passou por um
      fechamento não volta a ser "aberta" nunca mais. Foi o TESTE que pegou este
      buraco: a primeira versão a rebaixava para ABERTA, apagando em silêncio o fato
      de o cliente já ter recebido aquele documento.
      ⚠️ **CANCELADA fica FORA da conversão**: desfazer um cancelamento é UNDO (a
      fatura nunca chegou a fechar), não uma reabertura.
      ⚠️ `fecharFatura` passou a aceitar **ABERTA ou REABERTA** — sem isso a reaberta
      ficaria presa em aberto para sempre.
      **SEM MIGRATION**: `tb_faturas.status` é TEXT, sem limite de comprimento; status
      novo só precisa entrar nas listas de `lib/faturaUtils.js`
      (`STATUS_FATURA_ABERTOS` / `STATUS_FATURA_FECHADOS`).
- [x] **REABERTA entra nos relatórios** — `['ABERTA','FECHADA']` virou
      `['ABERTA','REABERTA','FECHADA']` em `DashboardController` (contas a receber
      vencidas), `RelatoriosController` (faturamento do período) e
      `RelatorioGerencialController.blocoDevedores`. É fatura NÃO PAGA como qualquer
      outra: quem reabriu para corrigir não deixou de dever, e tirá-la do indicador
      esconderia dinheiro a receber.
- [x] ⚠️ **O cron de ATRASADAS não foi tocado** — ele só varre `FECHADA`. Consequência
      deliberada: reabrir PAUSA a marcação de atraso; fechada de novo, ela volta a ser
      marcada na noite seguinte.
- [x] ⚠️ **O cron de FECHAMENTO também só varre `ABERTA`**. A REABERTA está sob
      correção de uma PESSOA, e fechá-la sozinha desfaria um ato deliberado no meio.
      CONSEQUÊNCIA ACEITA: reaberta esquecida fica em aberto até alguém fechá-la à
      mão. Se isso incomodar, o lugar é o `where` de `fecharFaturasDoMes` — e a
      guarda de "já tem uma em aberto" já protege contra duplicar o ciclo.
- [x] **Front** (`Faturamento.tsx`): `FaturaStatus` ganhou REABERTA; `canEdit` cobre
      ABERTA **e** REABERTA (é justamente para editar que se reabre); aba, pílula da
      lista e bolinha do card **Reaberta** em LARANJA, ao lado de Aberta.
      ⚠️ `faturaReaberta` é campo PRÓPRIO da resposta, não entra em `faturaAtiva`: as
      duas podem existir ao mesmo tempo e, na mesma aba, uma esconderia a outra.
      ⚠️ O `take` das faturas por cliente subiu de 6 para 10 — com cinco estados
      possíveis, um corte curto podia devolver seis fechadas e nenhuma das outras, e a
      aba sumiria da tela por causa do corte, não por não existir.
      ⚠️ Fechar recarrega o painel quando a aba é a da CORRENTE (sem `faturaId`/`mes`
      fixos): a corrente passou a ser a que nasceu, e sem recarregar a tela exibiria a
      fatura FECHADA debaixo do rótulo "Aberta", com Reabrir no lugar de Fechar.
      O toast diz qual fatura foi criada — é a única pista de que a próxima já existe
      antes do primeiro atendimento.
- [x] Testes: `__tests__/faturaCicloFechamento.test.js` (26 casos) — o mês da fatura
      que nasce (virada de ano, formato inválido), a conversão de reabertura nos dois
      sentidos, `getOrCreateFatura` IGNORANDO a REABERTA, a assistência dentro da
      fatura nova com o total recalculado, e a idempotência nos dois estados.
      ✅ **Verificado que REPROVA**: sabotados os elos de `fecharFatura`, do cron e do
      `statusAoReabrir`, três casos falharam. Suíte: **610**; `tsc -b` e `vite build`
      limpos.
      ⚠️ Os `jest.mock` deste arquivo levam `{ virtual: true }` (mesmo padrão de
      `documentosCentral.test.js`): sem ele o jest RESOLVE o módulo antes de trocá-lo,
      e `lib/prisma.ts` / `storage/index.ts` vão parar no babel — que não tem preset
      de TypeScript. Falha só no run COMPLETO, nunca no arquivo isolado.
- [ ] O fechamento em LOTE já abre as seguintes, mas a tela não diz quantas foram
      criadas: o retorno de `fecharFaturasLote` só conta as fechadas.
- [ ] `adicionarItem`/`atualizarItem`/`removerItem` continuam bloqueando só `PAGA`.
      FECHADA e REABERTA seguem editáveis (decisão anterior, preservada) — se um dia
      FECHADA tiver de travar, o lugar é `faturaEditavel` em `lib/faturaUtils.js`,
      que já existe como fonte única e hoje só é consumida pelo front.

---

### Sessão 2026-08-01 — Configurações da empresa: obrigatoriedades + validade do orçamento
- [x] **Validade do orçamento em dias** (migration `20260813000000`) —
      `EmpresaConfiguracao.validadeOrcamentoDias`, campo em `/configuracoes`, lib
      `lib/validadeOrcamento.js` (SQL cru — ver armadilha 41) e job
      `cancelar_orcamentos_vencidos` (`services/orcamentoCronService.js`, padrão 23:50).
      Passado o prazo contado de `Orcamento.createdAt`, o orçamento vira **CANCELADO**
      com o motivo ACRESCENTADO à `observacao` (nunca sobrescrita — o texto é do usuário).
      `STATUS_PRESERVADOS = APROVADO | APROVADO_PARCIALMENTE | CANCELADO`: aprovado já é
      compromisso (vai para prescrição/fatura) e não pode sumir por prazo.
      ⚠️ **REJEITADO expira junto** — é a regra como foi pedida ("cancelar se não for
      Aprovado ou Aprovado Parcialmente"), mas tem efeito colateral: a decisão do cliente
      vira CANCELADO e o relatório gerencial perde a contagem de rejeitados. Para preservá-la,
      basta acrescentar `'REJEITADO'` a `STATUS_PRESERVADOS`.
      `null` = sem validade é o default de propósito: prazo na migration cancelaria em massa,
      na 1ª execução do cron, orçamento que a clínica ainda considera vivo.
- [x] **Espécies atendidas e expediente viraram OBRIGATÓRIOS** — validação na tela E no
      `salvarConfiguracao` (400). A tela passou a oferecer só **Equino e Bovino**
      (`ESPECIES_PERMITIDAS`, casado por NOME e não por id — o id de `Especie` varia por base);
      espécie fora da lista numa config antiga é descartada na carga e no salvar.
- [x] **`<ErroAcao>` passou a ser RENDERIZADO em Configurações** — o componente era importado
      e o estado preenchido em 5 pontos, mas nunca aparecia: toda validação da tela (WhatsApp,
      dia útil…) falhava em SILÊNCIO, e as novas cairiam no mesmo buraco.
- [x] Rodapé de Configurações no padrão da aplicação (mesmas classes da tela de prescrição),
      alinhado à direita; textos auxiliares de espécies/expediente/tempo de consulta removidos.
- [x] `"Aprovado parcialmente"` → **`"Aprovado Parcialmente"`** (Orcamento.tsx, OrcamentoPrint.ts,
      RelatoriosController). O ENUM `APROVADO_PARCIALMENTE` não mudou — só o rótulo.
- [ ] A tela do Orçamento não mostra a validade nem quanto falta para expirar; o cliente só
      descobre quando o status já virou CANCELADO. Avaliar um selo "vence em N dias".

---

# Atualizado em: 2026-07-23 (Orçamento: posologia do medicamento (dias+frequência), doses da vacina e item OUTROS lançado direto na fatura; desconto por item na fatura)
---

### Sessão 2026-07-23 — Orçamento (posologia, doses, OUTROS) + desconto na fatura
- [x] **Medicamento no orçamento com dias + frequência** — `OrcamentoItem.dias` / `.frequencia`
      (migration `20260725000000`). A aba Medicamentos do builder tem um painel de posologia
      (Qtd. de dias + Frequência, mesmas opções da Prescrição) que vale para os itens adicionados
      em seguida; a **quantidade cobrada é derivada** (`aplicacoesNoPeriodo` = dias × aplicações/dia,
      espelha `INTERVALOS_H` do `PrescricaoController`; "agora" = dose única; posologia sem intervalo
      fixo = 1/dia) e continua editável na lista. Na importação para a Prescrição, `dias`/`frequencia`
      preenchem `duracaoDias`/`frequencia` do formulário (`SubModuloPrescricao.importarDoOrcamento`).
- [x] **Vacina no orçamento com Qtd. de doses** — campo "Qtd. de doses" na aba Vacinas define a
      `quantidade` do item (unidade 'dose'); `SubModuloVacina` já usava `quantidade` como nº de doses.
      Impressão (OrcamentoPrint.ts) e PDF do cliente (templates/orcamentoHtml.js) mostram o detalhe
      (dias · frequência / N doses) sob a descrição; a chave de consolidação passou a incluir
      dias+frequência para não fundir posologias diferentes do mesmo medicamento.
- [x] **Item OUTROS no orçamento → lançado direto na fatura** — aba **Outros** ao lado de Vacinas,
      com 3 campos (Nome, Qtd. de vezes, Valor). Não é rateado por animal (`animalId` null) e NÃO
      aparece na importação clínica. Depois de ACEITO, é lançado em **Financeiro > Faturamento** pelo
      botão "Importar do orçamento" (`ModalImportarOrcamento`), que só libera o orçamento quando
      todos os seus itens aceitos clínicos já têm `importadoEm` (importados numa evolução) —
      orçamentos com pendência aparecem bloqueados com a contagem. Backend:
      `OrcamentoController.listarOutrosParaFatura` / `lancarNaFatura` (cria FaturaItem tipo `OUTROS`,
      descrição `[ORC-0000] …`, `orcamentoItemId` para rastreio, marca `importadoEm`, recalcula o total).
- [x] **Desconto por item na fatura** — `FaturaItem.descontoTipo` (PERCENTUAL|VALOR) + `descontoValor`.
      Disponível na edição do item e no formulário de lançamento (Faturamento.tsx), com prévia do
      abatimento e do total líquido; a linha exibe o bruto riscado quando há desconto. O total da
      fatura, subtotais por animal, impressão/PDF/CSV e os relatórios financeiros passaram a somar o
      **líquido** (`valorLiquidoItem`). `PrescricaoController` deixou de recalcular o total à mão
      (usava `valor*qtd`, o que apagaria descontos) e agora chama `recalcularTotal`.
