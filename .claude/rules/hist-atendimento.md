---
paths:
  - "**/*Evolucao*"
  - "**/*Prescricao*"
  - "**/*Vacina*"
  - "**/*Exame*"
  - "**/*Encaminhamento*"
  - "**/*Agendamento*"
  - "**/*Agenda*"
  - "**/agendaDoses.js"
  - "**/finalizacaoEvolucao.js"
  - "**/clinicalScope.js"
  - "**/prescricaoProprietario.js"
  - "**/*Atendimento*"
  - "**/*Historico*"
  - "**/SubModulo*"
  - "**/posologia.ts"
  - "**/*Consulta*"
---

# Histórico de decisões — Atendimento clinico

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-22 (parte 2) (**exames dentro do Atendimento passaram a gerar
#   PAGAMENTO AO PRESTADOR** e a tela abre em modo BUSCA — os dois a pedido.
#   1. O modal de resultado do exame (pedido, avulso e edição) ganhou o campo **"Prestador
#      que executou"**, e a CONCLUSÃO do exame passou a gravar recibo + conta a pagar.
#      🔴 A conclusão de verdade é **`salvarResultado`** (status REALIZADO), não
#      `finalizar`: `PATCH /clinica/exames/:id/finalizar` **não é chamada por tela
#      nenhuma**, e enquanto o registro vivia só lá ele era código morto. Regra completa,
#      idempotência e migration em `hist-financeiro.md`, mesma data.
#   2. `GET /clinica/exames/animal/:id` passou a devolver `prestadorId`/`valorCobrado`
#      (por SQL cru — colunas da migration 20261005000000, §11), para o modal reabrir com
#      o prestador já escolhido.
#   3. O shell de Atendimento deixou de AUTO-SELECIONAR paciente e abre no seletor em modo
#      busca — ver `hist-ui.md`, mesma data.

---

# Atualizado em: 2026-09-22 (parte 2) (🔴 **A EXECUÇÃO DE PRESCRIÇÃO DEIXOU DE
#   SEGUIR O EXPEDIENTE DA EMPRESA.** Relatado assim: clínica que funciona de segunda a
#   sexta ficava com o plantão do FIM DE SEMANA vazio. **NENHUMA MIGRATION** —
#   `prisma migrate deploy` conferido: 205 aplicadas, nada pendente; o defeito é de
#   ESCOPO DE LISTAGEM, não de schema.
#   **A cadeia que produzia isso, e por que ninguém via erro:**
#   1. A fila do plantão (`listarParaExecucao`) recorta os pacientes por
#      `buildAnimalScopeWhere`, e a opção **"Atender somente no local de trabalho"**
#      (`MembroEquipe.restringirPorLocal`) estreitava esse recorte pelos locais em que o
#      profissional trabalha **HOJE** (`diasTrabalho`, CSV 0-6).
#   2. Os dias do local são VALIDADOS contra o expediente da empresa
#      (`EquipeController.validarLocaisContraExpedienteEmpresa`: *"Todo membro fica
#      RESTRITO ao dia/horário da empresa"*). Numa clínica seg–sex **ninguém consegue
#      sequer ser cadastrado para sábado** — logo, no sábado a lista de locais liberados
#      era `[]`, o `where` virava `localizacaoId: { in: [] }` e a fila nascia VAZIA.
#   3. As doses daqueles dias eram depois canceladas pelo cron
#      `cancelar_doses_prescricao_perdidas`, em silêncio — sem erro na tela, sem log:
#      quem estava de plantão concluiu que não havia o que aplicar.
#   **O que passou a valer:** `buildAnimalScopeWhere(req, { ignorarDiaDeTrabalho: true })`
#   na fila do plantão. A restrição continua valendo pelo **LOCAL** e deixa de olhar o
#   **DIA DA SEMANA**.
#   ⚠️ **O LOCAL NÃO foi afrouxado**: quem atende só no Haras A segue sem enxergar o
#   paciente do Haras B. A restrição é de ONDE; o DIA é que não pode decidir se uma dose
#   JÁ PRESCRITA pode ser aplicada — tratamento corre 24/7 e um "8 em 8h por 5 dias"
#   atravessa o fim de semana.
#   ⚠️ **A opção mora no ESCOPO, não em cada controller**: `localizacoesRestritasDeHoje`
#   (membro) e `localizacoesRestritasDoPrestador` (prestador — o flag dele mora em
#   `tb_prestadores`) a recebem juntas. Aplicar só numa delas deixaria o PRESTADOR de
#   plantão sem fila, que é exatamente o mesmo defeito por outra porta.
#   ⚠️ **Lista vazia continua significando "restrição ligada e NENHUM local cadastrado"**
#   → nenhum paciente. É o comportamento anterior e é o correto: colapsá-lo em "sem
#   restrição" daria a base inteira a quem o gestor quis limitar.
#   ⚠️ **A tela de Pacientes NÃO muda** — lá o recorte por dia é o próprio sentido da
#   opção ("hoje eu atendo aqui"). Há gate reprovando `ignorarDiaDeTrabalho` em
#   `AnimalController`.
#   ⚠️ **A VACINA não precisou de nada**: `VacinaClinicaController.listarParaExecucao`
#   nunca usou `buildAnimalScopeWhere` (escopo por evolução/empresa) — era por isso que,
#   no sábado, a fila de vacinas aparecia e a de prescrições não.
#   ⚠️ **Executar já funcionava**: `verificarAcessoAnimal` nunca aplicou a restrição por
#   local/dia. O que faltava era o item CHEGAR à tela.
#   Gate: `__tests__/plantaoSemExpediente.test.js` (11 casos, metade EXECUTÁVEL sobre
#   `locaisPermitidos` com o relógio fixado em cada dia da semana, metade estrutural nos
#   elos que somem sem aviso). ✅ **Verificado que REPROVA**: removida a opção do plantão
#   e o desvio de `locaisPermitidos`, **3 casos falharam**; restaurado, 11 verdes.
#   Suíte: **1333** passando; `tsc --noEmit` (backend) limpo.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
#   Regra permanente promovida para a armadilha **44** do CLAUDE.md.)

---

# Atualizado em: 2026-09-22 (🔴 **O MAPA DE ATENDIMENTO PASSOU A CONTAR DOSES** —
#   o card "Prescrições / Dosagens" estava em ZERO com dose atrasada na base — e o
#   **filtro Status saiu da tela**, a pedido. NENHUMA MIGRATION: tudo já existia no
#   banco desde `20260820_prescricao_execucao_dose`; o painel é que não lia.
#   **Três defeitos somados, cada um bastando sozinho para zerar o card:**
#   1. 🔴 **EXIGIA `evolucao.status = 'FINALIZADA'`.** A premissa mudou em
#      2026-07-16 (a prescrição vai ao plantão quando o GRUPO é FINALIZADO) e
#      `listarParaExecucao` já era assim; o Mapa ficou com o resto da regra antiga.
#      Como atendimento em curso fica EM_ANDAMENTO, isso escondia do painel toda
#      prescrição de quem está atendendo AGORA. Medido nesta base: a empresa 59
#      tinha 20 grupos e o card mostrava zero — nenhuma das evoluções dela estava
#      finalizada. O painel e o plantão precisam concordar; agora concordam.
#   2. 🔴 **CONTAVA GRUPOS, NÃO DOSES.** Um curso de "8 em 8h por 5 dias" (15
#      aplicações) valia 1, igual a uma dose única — e "executado" saía de
#      `Prescricao.executadoEm`, que desde a migration de dose guarda a ÚLTIMA dose,
#      não "o item acabou". Executar 1 das 2 doses do dia encerrava o documento
#      inteiro na tela. O log append-only `tb_prescricao_execucoes_dose` — a única
#      fonte de "esta dose aconteceu" — não era lido em lugar nenhum do painel.
#   3. 🔴 **"ATRASADA" DEPENDIA DE `horaInicio`.** O campo deixou de ser obrigatório
#      em 2026-08-23 e nesta base está VAZIO em TODO item, então `dataHora` da linha
#      era sempre `null`, a coluna "Horário" saía "—" e NENHUMA dose jamais foi
#      classificada como atrasada. Quem responde isso é `horarioPrevistoDoItem`
#      (rolling schedule), não a hora prescrita.
#   **O que passou a valer** — `lib/dosesDoPeriodo.js`, lib NOVA e pura, que só faz
#   aritmética de `lib/agendaDoses.js` (fonte única com o plantão e com o cron de
#   WhatsApp — nada recalculado ali):
#   · **Executadas** = linhas de `tb_prescricao_execucoes_dose` no período. Só o
#     legado (frequência `agora`, que não grava dose) cai em `executadoEm`.
#   · **Não executadas / Atrasadas** = dose prevista no período cujo horário já
#     venceu (tolerância de 30min, a mesma do ATRASADA de AgendamentoClinico).
#   · **Previstas** = o que ainda vai acontecer dentro do período. Fatia NOVA no
#     donut, e ela não é enfeite: sem ela o gráfico pintava 3 doses com o número 12
#     no centro. O centro passou a ser "doses"; o subtítulo do card diz quantas
#     PRESCRIÇÕES produziram aquilo (`prescricoes.documentos`).
#   ⚠️ **`prescricoes.executadas`/`pendentesOuAtrasadas` MUDARAM DE UNIDADE** —
#   eram documentos, são doses. O Mapa é o único consumidor (conferido), mas quem
#   for reusar o endpoint precisa saber.
#   ⚠️ **O recorte do período virou a DOSE, não a janela do curso.** Bastava
#   `[dataInicio, dataInicio+duracaoDias)` tocar o período, o que trazia "1x por
#   semana durante 28 dias" TODO santo dia — e ainda assim não dizia quantas doses
#   havia ali. Agora o grupo entra se tiver alguma dose no período, e são 4, não 28.
#   ⚠️ **Fora da conta, de propósito:** item `aplicadaPeloProprietario` (nunca chega
#   ao plantão) e frequência `seNecessario`/`SOS` (não têm agenda) — mesmas exclusões
#   de `listarParaExecucao`. Contá-los cobraria trabalho que ninguém deixou de fazer.
#   ⚠️ **Curso CANCELADO não projeta dose para o futuro**: o que venceu antes do
#   cancelamento segue contando como não executado, mas prometer as doses seguintes
#   de um tratamento interrompido encheria o painel de trabalho que não vai acontecer.
#   ⚠️ **Item sem hora e sem nenhuma dose dada é classificado por DIA, não por
#   horário** (`temHorario: false`). Tratar a meia-noite dele como previsto faria a
#   dose nascer atrasada às 00:01 de todo dia da janela — é a armadilha que
#   `semAncoraDeHorario` existe para evitar. A coluna "Horário" continua "—" nesse
#   caso: ali só se sabe o dia, e exibir 00:00 seria inventar um horário.
#   ⚠️ **O modo Diário deixou de abrir no amanhã depois das 21:00.** Sem o param
#   `data`, o dia saía de `dataRef.toISOString()` — UTC, que em Brasília já é o dia
#   seguinte à noite. Trocado por `dataLocalDe` (§6 do CLAUDE.md).
#   **Na linha do cronograma**: status derivado das doses (atrasada > ainda há dose a
#   fazer > o que havia foi executado > cancelado), chip "N/M doses · X atrasadas ·
#   Y a fazer", horário vindo da próxima dose prevista (ou da última executada), e
#   "Executar" escondido também na CANCELADA — o backend recusa as duas, e botão que
#   só falha depois do clique é a armadilha 28-d.
#   ⚠️ **"Com atendimento" passou a bastar UMA dose aplicada** no período; antes
#   exigia o documento inteiro EXECUTADO, então o paciente que recebeu a dose da
#   manhã de um curso de 5 dias contava como "sem atendimento".
#   **FILTRO STATUS**: o seletor saiu da barra de filtros (a grade foi de 4 para 3
#   colunas no gestor, de 3 para 2 nos demais).
#   ⚠️ **O estado `activeStatus` FICOU** — é ele que as fatias dos donuts (Consultas
#   Clínicas e Animais sem Atendimento) ligam e desligam, e a faixa "Filtrado por …
#   — limpar" continua mostrando e limpando o recorte. Removê-lo junto quebraria a
#   navegação por clique no gráfico, que é como esta tela foi desenhada.
#   ⚠️ `statusUnicos`/`statusOpcoes` foram removidos junto: sem leitor, `tsc -b`
#   reprova (TS6133). `STATUS_LABELS` permanece — nomeia o recorte na faixa.
#   Gate: `__tests__/dosesDoPeriodo.test.js` (24 casos, verificado que reprova —
#   retirando a leitura do log de dose, 2 casos falham). Regra permanente promovida
#   para a armadilha **43** do CLAUDE.md. Suíte: 1313 testes verdes; `tsc -b` e
#   `vite build` limpos. Migrations: `prisma migrate status` = 205 aplicadas, nada
#   pendente — esta sessão não criou nenhuma.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão; a
#   validação foi feita chamando o controller de verdade contra o banco, por empresa.)

---

# Atualizado em: 2026-09-18 (parte 4) (🔴 **ANTECIPAR DOSE DEIXOU DE SER BLOQUEIO E
#   VIROU PERGUNTA** (a pedido). A execução da prescrição não trava mais esperando a
#   data/hora prevista: a tela INFORMA para quando a dose estava marcada, pergunta se
#   deseja antecipar, e o "sim" executa pelo caminho de sempre.
#   1. 🔴 **INVERTE a regra de 2026-08-23 (item 3)**, que exigia JUSTIFICATIVA escrita
#      (mín. 3 chars) para toda dose FUTURA. O texto obrigatório não impedia nada —
#      quem decidia antecipar digitava qualquer coisa e seguia — e cobrava um
#      formulário no meio do plantão. Agora é o MESMO molde da dose ATRASADA:
#      `ConfirmModal` com "A próxima dose (03/05) estava prevista para **24/08 às
#      07:44**. Executar agora antecipa a aplicação. Deseja continuar?" + os botões
#      **Antecipar e executar** / **Cancelar**.
#      ⚠️ A parte CERTA daquela regra CONTINUA valendo e não pode ser afrouxada: o
#      gate roda para TODO item de `itensHoje`, venha a chamada do ícone "Executar"
#      (item a item) ou do "Executar Todos" — os dois caminhos passam pela MESMA
#      pergunta. Era essa divergência o furo original.
#   2. 🔴 **FLAG PRÓPRIA `confirmarAntecipacao` — NUNCA reusar `confirmarHorario`.**
#      Esta é a armadilha da leva: o "Executar Todos" manda `confirmarHorario: true`
#      FIXO (o clique em lote vale como confirmação de dose ATRASADA, que já era
#      devida). Liberar a antecipação por aquela mesma flag faria UM clique antecipar
#      o **curso inteiro** sem ninguém ser perguntado — exatamente o furo de
#      2026-08-23, de volta por outro caminho. Há gate travando: o ramo `ANTECIPADA`
#      não pode conter a string `confirmarHorario`.
#   3. 🔴 **AS DOSES SEGUINTES JÁ ERAM RECALCULADAS — e agora isso está travado por
#      teste.** `proximaDoseEm: calcularProximaDose(agora, item.frequencia)` parte do
#      horário REAL da execução, nunca da grade original (rolling schedule, desde
#      2026-08-23). É isso que dá sentido a antecipar: adiantou a dose das 20:00 para
#      as 14:00 num 12/12h, a próxima passa a ser **02:00**, não 08:00. Trocar `agora`
#      por `previsto` ali devolveria a grade fixa — e nada acusaria. A tela diz isso
#      em uma linha ("As doses seguintes serão recalculadas a partir deste horário"),
#      e o front aplica o `proximaDoseEm` fresco na MESMA tela (overlay `itensLive`).
#   4. ⚠️ **A JUSTIFICATIVA continua ACEITA, agora OPCIONAL**: vindo no corpo, vai
#      para o `motivo` da auditoria como sempre foi. Cliente antigo que ainda a envie
#      não muda de comportamento. O que NUNCA se faz é preencher `motivo` com frase do
#      sistema — ali é texto de PESSOA; o fato de ter havido confirmação explícita vai
#      em `detalhes` ("antecipada 120min, confirmada na execução").
#   5. ⚠️ **A ARROW do botão "Executar Todos" ficou MAIS perigosa.** O 1º parâmetro do
#      handler virou `confirmarAntecipacao`: com `onClick={handleExecutarTodos}` o
#      MouseEvent chega no lugar dele, é TRUTHY, e todo clique passaria a antecipar o
#      curso inteiro **em silêncio** (a tela não erra — ela executa). `onClick={() =>
#      handleExecutarTodos()}` é obrigatório, e há gate para a linha.
#   **NENHUMA MIGRATION** — nada de schema mudou; `confirmarAntecipacao` é campo de
#   REQUISIÇÃO. `migrate status`: 203, banco em dia.
#   Gate novo `__tests__/execucaoAntecipada.test.js` (16 casos) — a classificação e o
#   recálculo EXECUTAM o código real de `lib/agendaDoses`; o resto é gate estrutural
#   dos elos que somem sem erro (a flag do ramo, o `agora` do rolling schedule, o
#   reenvio do front e a arrow do botão).
#   ✅ **Verificado que REPROVA**: devolvido o `confirmarHorario` ao ramo da
#   antecipada, trocado `agora` por `previsto` e devolvida a justificativa ao front,
#   **3 casos falharam**; e, à parte, trocada a arrow por referência, **1**.
#   Suíte: **1156**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
#   🔴 **COMPLEMENTO (mesma data) — O BOTÃO NÃO EXISTIA: eram TRÊS gates de TELA.**
#   Relatado na prescrição **#006 da Empresa de Gestorvet** (Glicol Turbo 4/4h, dose
#   dada 18/09 21:07, próxima 19/09 01:07): "não está deixando antecipar a do dia
#   seguinte, está sem o ícone de execução". A pergunta do backend NUNCA chegava a
#   acontecer — nada chamava o endpoint, porque a tela não oferecia por onde clicar.
#   Os três escondiam a ação e **nenhum deles dá erro**:
#     a. `temAtual` exigia `proximaDoseRealHoje` → a dose da vez só ganhava botão no
#        dia em que vencia. **`proximaDoseRealHoje` saiu da conta** e passou a decidir
#        só o RÓTULO ("Em Execução" × "Prevista para 19/09 às 01:07"), que era a razão
#        legítima dele existir (executar a dose 1 de "1x/semana" não pode fazer a
#        dose 2 anunciar-se "Em Execução").
#     b. O MODAL inteiro abria em leitura: `soVisualizacao` usava `tipoConcluidoEm`
#        (o **DIA** cumprido). Passou a usar `tipoTemDosePorVir` (o **CURSO** em
#        aberto). São perguntas diferentes: o dia cumprido manda o card ao Histórico
#        — e isso continua certo —, o curso é que diz se ainda há o que executar.
#     c. A linha no HISTÓRICO vinha com `podeExecutarAcao={false}` e o ícone ainda
#        dependia de `executada`. Agora, havendo dose por vir, ela mantém o Executar
#        com o título **"Antecipar a próxima dose"** e abre o modal em modo execução.
#   ⚠️ `itemTemDosePorVir` EXCLUI o item LEGADO ('agora'/'SOS'/'seNecessario'): ali
#   não há grade futura, e o backend recusa executar o que já saiu hoje — sem essa
#   perna a dose única aplicada voltaria a exibir um botão que só falha no clique (28-d).
#   ✅ **CONFERIDO com o CÓDIGO REAL contra o DADO REAL** (item 247, leitura pura):
#   elegível, **1 de 30 doses**, previsto 19/09 01:07 → `ANTECIPADA`; a tela pergunta
#   "A próxima dose (02/30) estava prevista para 19/09 às 01:07…" e, confirmada às
#   21:50, a próxima passa a **19/09 01:50** (na grade antiga seria 05:07).
#   Gate ampliado para **21 casos**; ✅ verificado que REPROVA: revertidos os três
#   gates de tela + o `podeExecutarAcao` do histórico, **4 casos falharam**.
#   Suíte: **1161**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
#   🔴 **ARMADILHA CONFIRMADA NA PRÓPRIA INVESTIGAÇÃO (ver §12, armadilha 42):** a
#   primeira varredura desta sessão concluiu "a base não tem nenhum item pendente" —
#   e era FALSO. O script rodava `set_config('app.plataforma','on',true)` FORA de
#   transação: `true` é LOCAL à transação, e cada query pega outra conexão do pool,
#   então o FORCE RLS devolvia **0 linhas com sucesso e sem aviso**. Script de
#   diagnóstico em tabela do tenant plane roda DENTRO de `$transaction`.)
---

### Sessão 2026-09-18 (parte 4) — Antecipar dose virou PERGUNTA, não bloqueio

> **SEM MIGRATION.** `confirmarAntecipacao` é campo de REQUISIÇÃO, não coluna.
> `migrate status` conferido: **203 migrations, "Database schema is up to date!"**.

- [x] 🔴 **O PEDIDO, e o que ele inverte.** "A execução da prescrição não pode ser
      travada aguardando a data seguinte." Até aqui a dose FUTURA era BLOQUEADA e só
      saía com JUSTIFICATIVA escrita (regra de 2026-08-23, item 3). O texto
      obrigatório **não impedia decisão nenhuma** — quem já tinha decidido antecipar
      digitava qualquer coisa e seguia — e cobrava um formulário no meio do plantão,
      onde o tempo é o que falta. Virou o MESMO molde da dose ATRASADA: avisa,
      pergunta, executa.
      ```
      antes : [Antecipar dose] "Por que a dose está sendo antecipada? (obrigatório)"
              → textarea, mín. 3 caracteres, só então executa
      agora : "A próxima dose (03/05) estava prevista para 24/08 às 07:44.
               Executar agora antecipa a aplicação. Deseja continuar?"
              → Antecipar e executar | Cancelar
      ```
- [x] 🔴 **FLAG PRÓPRIA `confirmarAntecipacao`, NUNCA `confirmarHorario`** — é a
      armadilha desta leva, e ela é silenciosa. O "Executar Todos" manda
      `confirmarHorario: true` **FIXO** (o clique em lote vale como confirmação de
      dose ATRASADA, que já era devida e não inventa dose nova). Liberar a antecipação
      por aquela mesma flag faria UM clique aplicar o **curso inteiro** de uma vez,
      sem ninguém ser perguntado — que é exatamente o furo corrigido em 2026-08-23,
      voltando por outro caminho. Com flag própria os dois caminhos (ícone e lote)
      passam pela MESMA pergunta, que era a parte CERTA daquela regra.
      ⚠️ Gate explícito: o ramo `ANTECIPADA` não pode conter a string
      `confirmarHorario`.
- [x] **A recusa continua carregando o CONTEXTO** (`previsto`, `numeroDose`,
      `totalDoses`, `medicamento`): é com ele que a tela monta a frase. O
      `numeroDose/totalDoses` vem do BACKEND e não do contador do front porque o
      "Executar Todos" não sabe QUAL item do lote foi o barrado — a resposta diz.
      ⚠️ O "(NN/TT)" só entra quando as duas contagens vêm; item legado (sem rastreio
      por dose) cai na frase sem o número, em vez de um "(undefined/undefined)".
      ⚠️ A data vai SEMPRE junto da hora (`formatDiaMesHora` → "24/08 às 07:44"),
      inclusive quando é hoje: a pergunta é justamente sobre QUANDO a dose era devida,
      e "estava prevista para 07:44" deixa a ambiguidade do dia.
- [x] 🔴 **"As demais deverão ser recalculadas" JÁ ACONTECIA — e agora está travado.**
      `proximaDoseEm: calcularProximaDose(agora, item.frequencia)` parte do horário
      REAL da execução, nunca da grade original (rolling schedule, desde 2026-08-23).
      É isso que dá sentido a antecipar:
      ```
      12/12h, dose prevista 20:00, antecipada para 14:00
        próxima  → 02:00 do dia seguinte   (a partir do REAL)
        seria    → 08:00                   (grade fixa, se partisse do previsto)
      ```
      ⚠️ Trocar `agora` por `previsto` ali devolve a grade fixa e a dose seguinte
      nasce fora de hora, **sem nada acusar** — por isso há caso de teste EXECUTANDO
      `calcularProximaDose` nos dois sentidos, além do gate da linha.
      ⚠️ Na tela, o `proximaDoseEm` fresco é aplicado na MESMA sessão (overlay
      `itensLive` em `handleExecutarItem`), então a previsão das doses seguintes se
      corrige à vista, sem fechar e reabrir o modal. E a frase "As doses seguintes
      serão recalculadas a partir deste horário" avisa ANTES de confirmar.
- [x] ⚠️ **A JUSTIFICATIVA continua ACEITA, agora OPCIONAL.** Vindo no corpo, segue
      para o `motivo` da auditoria como sempre; cliente antigo que ainda a envie não
      muda de comportamento. O que NUNCA se faz é preencher `motivo` com frase do
      sistema — ali é texto de PESSOA, e atribuir a alguém um texto que ela não
      escreveu corrompe a trilha. O fato de ter havido confirmação explícita vai em
      `detalhes`: "antecipada 120min, **confirmada na execução**" — é o que separa, na
      auditoria, a dose antecipada com aval de quem executou.
- [x] ⚠️ **A ARROW do "Executar Todos" ficou MAIS perigosa que antes.** O 1º parâmetro
      do handler deixou de ser `justificativa?: string` e virou
      `confirmarAntecipacao = false`: com `onClick={handleExecutarTodos}` o MouseEvent
      chega no lugar dele, é **truthy**, e todo clique passaria a antecipar o curso
      inteiro em silêncio — a tela não erra, ela executa. Mesmo tropeço do
      `handleSalvar` de `ModalNovoFornecedor`. `onClick={() => handleExecutarTodos()}`
      é obrigatório e tem gate próprio.
- [x] **Vale nas TRÊS telas de uma vez**: `ModalExecucao` é importado de
      `ExecucaoPrescricao` pelo **Painel Principal** e pelo **Mapa de Atendimento** —
      não há segunda implementação a sincronizar.
- [x] Gate novo `__tests__/execucaoAntecipada.test.js` (16 casos). A classificação
      (`classificarExecucao`) e o recálculo (`calcularProximaDose`) EXECUTAM o código
      real de `lib/agendaDoses`; o resto é gate estrutural, com recorte por FUNÇÃO e
      **ignorando comentários** (sem isso o teste se satisfaria com a própria
      documentação da regra).
      ✅ **Verificado que REPROVA**: devolvido o `confirmarHorario` ao ramo da
      antecipada, trocado `agora` por `previsto` no rolling schedule e devolvida a
      justificativa ao reenvio do front → **3 casos falharam**; à parte, trocada a
      arrow por referência → **1**. Suíte: **1156**; `tsc --noEmit` (backend),
      `tsc -b` e `vite build` limpos.
#### Complemento (mesma data) — o botão não existia: TRÊS gates de tela

- [x] 🔴 **A correção acima não bastava, e o relato provou: "a #006 não está deixando
      antecipar a do dia seguinte, está sem o ícone de execução"** (Empresa de
      Gestorvet, Glicol Turbo 4/4h — dose dada 18/09 21:07, próxima 19/09 01:07). A
      pergunta do backend nunca chegava a ser feita porque **nada chamava o endpoint**:
      a tela escondia a ação em três lugares, e nenhum deles dá erro — a prescrição
      simplesmente fica fora de alcance.
      ```
      1. modal, linha da dose  temAtual exigia proximaDoseRealHoje  → sem botão
      2. modal, documento      soVisualizacao usava tipoConcluidoEm → tudo em leitura
      3. linha do Histórico    podeExecutarAcao={false} + !executada → sem ícone
      ```
- [x] **(1) `proximaDoseRealHoje` SAIU de `temAtual` e passou a decidir só o RÓTULO.**
      A razão de ele existir continua válida — executar a dose 1 de "1x/semana" hoje
      não pode fazer a dose 2 anunciar-se "Em Execução", porque ela só vence em 7 dias
      — mas ela é sobre o TEXTO, não sobre a existência do botão. Agora a dose da vez
      diz **"Prevista para 19/09 às 01:07"** *com o Executar ao lado*: quem pergunta é
      o `ConfirmModal` depois do clique (`atualVenceHoje` guarda o "Em Execução").
- [x] 🔴 **(2) O que trava o modal é o CURSO TERMINADO, não o DIA CUMPRIDO.** São
      perguntas diferentes e estavam coladas na mesma função:
      ```
      tipoConcluidoEm    "o DIA está cumprido?"  → manda o card ao Histórico   ✔ certo
      tipoTemDosePorVir  "o CURSO tem dose?"     → decide se ainda há o que executar
      ```
      Enquanto a primeira governava `soVisualizacao`, executar a dose de hoje punha o
      documento inteiro em leitura — e a dose seguinte, visível na lista com data e
      hora, não tinha como ser acionada. Continuam travando, como antes: o olho
      (`modalVer`), outro dia que não hoje, prescrição cancelada e paciente inativo.
- [x] **(3) No HISTÓRICO a linha mantém o Executar quando há dose por vir**, com o
      título **"Antecipar a próxima dose"** (dizer "Executar prescrição" ali faria o
      botão parecer repetir o que já foi feito hoje) e abrindo o modal em modo
      execução (`setModalVer(false)`). O card **continua no Histórico** — o dia está
      cumprido, e essa informação é correta; o que volta é a ação.
      ⚠️ `executada` saiu da condição de visibilidade do ícone em `LinhaGrupo`: ela diz
      que o DIA foi cumprido, não que o curso acabou. Quem decide passou a ser o
      CHAMADOR (`podeExecutarAcao`/`soVisualizacao`), que é quem sabe.
- [x] ⚠️ **`itemTemDosePorVir` EXCLUI o item LEGADO** ('agora', 'SOS', 'seNecessario'):
      ali não existe grade futura a antecipar, e o backend recusa executar o que já
      saiu hoje ("Nenhum item da prescrição para executar agora"). Sem essa perna, a
      prescrição de dose única já aplicada voltaria a exibir um botão que só falha
      depois do clique — a armadilha 28-d. Para o legado vale o que falta HOJE
      (`itemAindaPrecisaAcaoHoje`).
- [x] **Saíram `foiExecutadoHoje` e `itemPendenteHoje`** — ficaram sem chamador quando
      o modo do modal deixou de ser decidido pelo dia (o `tsc -b` reprova código
      morto). `itemPendenteEm` segue exportada: é fonte única com o Painel Principal.
- [x] ✅ **CONFERIDO com o CÓDIGO REAL da lib contra o DADO REAL** (item 247, leitura
      pura, sem escrever nada): elegível, **1 de 30 doses**, previsto 19/09 01:07 →
      `ANTECIPADA`; a tela pergunta *"A próxima dose (02/30) estava prevista para 19/09
      às 01:07…"* e, confirmada às 21:50, a próxima passa a **19/09 01:50** — contra
      05:07 da grade antiga. O curso inteiro desliza junto.
      Gate ampliado para **21 casos**; ✅ **verificado que REPROVA**: revertidos os três
      gates de tela + o `podeExecutarAcao` do histórico, **4 falharam**.
      Suíte: **1161**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
- [ ] ⚠️ **Escopo do que foi corrigido**: a prescrição precisa estar VISÍVEL no dia
      para ser antecipada — ou seja, ter dose executada hoje (fica no Histórico do
      dia) ou dose devida hoje. Curso de cadência longa (1x/semana executado na
      segunda, próxima na segunda seguinte) **continua fora da fila nos dias do meio**:
      é a regra de produto de 2026-08-18 ("devido SÓ quando a data exibida é
      exatamente `proximaDoseEm`"), e mudá-la faria a fila do dia listar o que não é de
      hoje. Se precisar antecipar nesse caso, é decisão de produto à parte.
- [ ] ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] A **VACINA** não entra: ela não tem agenda por dose (SALVA → FINALIZADA →
      EXECUTADA, aplicação única), logo não existe "antecipar" a apurar ali.
- [ ] O cron `cancelar_doses_prescricao_perdidas` não foi tocado. Ele cancela a dose
      cuja janela passou — antecipar não o alcança (a dose vira executada), mas vale
      lembrar que o curso ANTECIPADO termina mais cedo: a última dose sai antes do fim
      da janela do calendário, e é o `dosesTotaisEsperadas` (não a data) que fecha o
      documento.

---

# Atualizado em: 2026-09-15 (parte 5) (🔴 **A POSTERGAÇÃO DA DOSE ATRASADA ESTAVA
#   INERTE JUSTAMENTE ANTES DA 1ª EXECUÇÃO** — o defeito relatado como "essa parte não
#   foi feita". `agendaDaDose` (parte 3 desta data) EXISTIA e era CHAMADA, mas derivava
#   a data devida de `previsaoDaDose(item, 0)`, que devolve `null` sem ÂNCORA
#   (`proximaDoseEm`) — e âncora só existe depois da 1ª dose dada ou com Hora Início
#   prescrita. Resultado: `atrasoDias` saía SEMPRE 0 no único caso que ela veio
#   corrigir, e nada quebrava. Medido no item 233 da base (acupuntura 1x/dia por 3
#   dias, `dataInicio` 15/09, `horaInicio` **VAZIO**, 0 doses): no dia 16, com nada
#   executado, a tela seguia anunciando 15/09 · 16/09 · 17/09.
#   Agora a data devida sai de **`previsaoPendenteISO`** — a MESMA fonte do selo
#   "Atrasada" da fila —, então selo e agenda contam a mesma história. Sem âncora, a
#   data ORIGINAL de cada linha é o **dia TEÓRICO do curso** (`diaDaDose` = o
#   `linha.dia` de `gerarResumoDoses`), 4º argumento novo: é ele que distribui certo a
#   frequência com mais de uma dose por dia (`12em12h` → dias 1,1,2,2), coisa que um
#   múltiplo do intervalo não faria.
#   🔴 **E A HORA "às 09:00" NUNCA FOI PRESCRITA — era o meio-dia UTC.** O selo da fila
#   (`atrasoDoTipo`) formatava com `formatDiaMesHora` o ISO de `previsaoPendenteISO`,
#   que sem âncora é **DATA PURA** (meio-dia UTC, `dataDoDiaISO`). Em Brasília isso vira
#   "às 09:00"; em Cuiabá, "às 08:00"; no Acre, "às 07:00" — um compromisso de horário
#   que ninguém marcou, e que mudava com o fuso da clínica. O comentário acima da linha
#   já dizia "sem âncora não existe hora a mostrar"; o código fazia o contrário.
#   `agendaDaDose` passou a devolver **`temHorario`**, e é ele que libera
#   `formatDiaMesHora` nos dois chamadores. ⚠️ Hora só na dose de AGORA e só com âncora.
#   Resultado (simulado com o item real): dia 15 → "Dose 01/03 - Em Execução (15/09)";
#   dia 16 → "Dose 01/03 - Prevista para 16/09 — prescrição em atraso desde 15/09",
#   "Dose 02/03 - … 17/09 — … desde 16/09", "Dose 03/03 - … 18/09 — … desde 17/09".
#   ⚠️ **SÓ EXIBIÇÃO**, como antes: o backend continua sendo quem grava a agenda na
#   execução. CONSEQUÊNCIA CONHECIDA: a fila do backend mantém o item sem âncora apenas
#   dentro de `dentroDaJanelaDoCurso` ([dataInicio, +duracaoDias-1]), então a dose 3
#   exibida em 18/09 está fora dessa janela — o item some da fila e o cron
#   `cancelar_doses_prescricao_perdidas` o cancela. Estender a janela mexeria na regra
#   de produto de 2026-08-18 e no cron de cancelamento; não foi pedido. Ver §12.
#   **NENHUMA MIGRATION** — correção é 100% de tela (`ExecucaoPrescricao.tsx`).
#   `migrate status` conferido: 198 migrations, banco em dia, nada pendente.
#   Gate novo `__tests__/agendaDosePostergada.test.js` (14 casos) que **EXECUTA** o
#   código real do front (extraído por AST + `ts.transpileModule`) — varredura de texto
#   não pegaria este defeito, porque a função aparecia, era chamada e o comentário em
#   cima dela já descrevia o comportamento certo. ✅ Verificado que REPROVA: revertida a
#   derivação para a âncora, **8 dos 14 falharam**; removido o 4º argumento, 1 falhou.
#   Suíte: **1023**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-15 (parte 5) — A postergação da dose atrasada estava inerte antes da 1ª execução

> **NENHUMA MIGRATION.** A correção é 100% de TELA (`ExecucaoPrescricao.tsx`).
> `migrate status` conferido: **198 migrations, "Database schema is up to date!"**, nada
> pendente. As 29 linhas com `rolled_back_at` em `_prisma_migrations` são marcas
> HISTÓRICAS do fluxo de recuperação (todas com `applied_steps_count = 0`, cada uma
> seguida da reaplicação bem-sucedida) — não são migrations por aplicar.

- [x] 🔴 **O DEFEITO: a função existia, era chamada, e não fazia nada.** `agendaDaDose`
      (parte 3 desta mesma data) derivava a data devida de `previsaoDaDose(item, 0)`, e
      essa devolve `null` quando o item não tem ÂNCORA (`proximaDoseEm`). Âncora só
      existe depois da 1ª dose dada, ou quando há Hora Início prescrita — ou seja, a
      postergação ficava INERTE exatamente no caso que ela veio corrigir: procedimento
      sem hora, nenhuma dose executada. `atrasoDias` saía sempre 0, o `tsc` passava, a
      suíte passava e o defeito seguia na tela.
      **Medido na base** (item 233): "Acupuntura a laser", `1xDia`, `duracaoDias` 3,
      `dataInicio` 2026-09-15, `horaInicio` **string vazia**, `doses_executadas` 0 →
      `proxima_dose_em` **NULL** no banco (o backend devolve `horarioPrevistoDoItem`,
      que é null sob `semAncoraDeHorario`). No dia 16, com nada executado, a tela seguia
      anunciando 15/09 · 16/09 · 17/09 — duas doses disputando o mesmo dia.
      ⚠️ Foi isto que fez o relato dizer "depois que a primeira foi executada ficou tudo
      certo": executada a 1ª, nasce a âncora e o caminho ANTIGO já funcionava.
- [x] 🔴 **A data devida passou a sair de `previsaoPendenteISO`** — a MESMA fonte que
      `itemAtrasadoEm` (o selo "Atrasada" da fila) já usava: com âncora é o rolling
      schedule; sem âncora é o 1º dia do curso. Unificar não é elegância: com duas
      fontes, o selo diria "atrasada" enquanto a agenda mostra o curso em dia — ou o
      contrário —, e era metade do que o usuário via.
- [x] **4º argumento `diaDaDose`** (o `linha.dia` de `gerarResumoDoses`): sem âncora, a
      data ORIGINAL de cada linha é o **dia TEÓRICO do curso**, nunca um múltiplo do
      intervalo. É ele que distribui certo a frequência com mais de uma dose por dia —
      `12em12h` dá dias 1,1,2,2, e a conta por intervalo espalharia as quatro doses em
      quatro dias. ⚠️ **Com âncora ele é IGNORADO**: ali quem manda é a cadência real, e
      deixar o dia teórico vencer desfaria o rolling schedule.
- [x] 🔴 **A HORA "às 09:00" NUNCA FOI PRESCRITA — era o meio-dia UTC.** O selo da fila
      (`atrasoDoTipo`) formatava com `formatDiaMesHora` o ISO de `previsaoPendenteISO`,
      que sem âncora é **DATA PURA** (meio-dia UTC, `dataDoDiaISO`). Convertida ao fuso
      da clínica, ela vira "às 09:00" em Brasília, "às 08:00" em Cuiabá e "às 07:00" no
      Acre: um compromisso de horário que ninguém marcou e que muda de valor conforme
      quem olha. É a §6 ao contrário — lá a proibição é passar INSTANTE para
      `formatDate`; aqui era passar DATA PURA para um formatador de instante.
      ⚠️ O comentário logo acima da linha já dizia *"sem âncora de horário não existe
      hora a mostrar"*. O código fazia o oposto — e foi por isso que o gate novo tem de
      **ignorar comentários**: casar com a prosa faria o teste aprovar o código errado.
- [x] **`temHorario` no retorno de `agendaDaDose`**, e é ele que libera
      `formatDiaMesHora` nos DOIS chamadores (o selo da fila e a linha da dose no modal).
      ⚠️ Hora só na dose de **AGORA** e só com âncora; dose futura continua sem hora,
      pela razão de sempre — quem a fixa é a execução da anterior.
- [x] **O deslocamento continua em DIAS INTEIROS** sobre o instante, nunca remontando a
      data com a hora "na mão": isso preserva as duas naturezas de uma vez — o instante
      ancorado mantém 14:05, e a data pura de meio-dia UTC continua meio-dia UTC (logo,
      continua data pura em todos os 4 fusos do Brasil).
- [x] ✅ **Resultado simulado com o item REAL da base**, nada executado:
      ```
      dia 15/09  (sem selo)              Dose 01/03 - Em Execução (15/09)
                                         Dose 02/03 - Prevista para 16/09
                                         Dose 03/03 - Prevista para 17/09
      dia 16/09  Atrasada — era 15/09    Dose 01/03 - Prevista para 16/09 — prescrição em atraso desde 15/09
                                         Dose 02/03 - Prevista para 17/09 — prescrição em atraso desde 16/09
                                         Dose 03/03 - Prevista para 18/09 — prescrição em atraso desde 17/09
      ```
      Sem "às 09:00" em lugar nenhum, e a cascata exatamente como pedida.

- [x] **Gate novo `__tests__/agendaDosePostergada.test.js` (14 casos) que EXECUTA o
      código real do front**, e não varre texto. O arquivo é extraído por **AST**
      (`ts.createSourceFile` + `ts.ScriptKind.TSX`), as 6 funções necessárias são
      transpiladas com `ts.transpileModule` e rodadas com `DOSES_POR_DIA` (da lib do
      BACKEND, a fonte única da cadência) e `diaISO` injetados no escopo.
      ⚠️ **Por AST e não por recorte de texto**: a assinatura de `agendaDaDose` tem
      chaves no TIPO DE RETORNO (`): { iso: …; temHorario: boolean } {`), então contar
      chaves a partir do primeiro `{` recortaria o tipo em vez do corpo.
      ⚠️ **Varredura de texto NÃO teria pegado este defeito** — a função aparecia no
      arquivo, era chamada com os argumentos certos e vinha precedida de um comentário
      que descrevia o comportamento correto. Só executando se descobre que ela devolvia
      `atrasoDias: 0`.
      Um dos casos formata de propósito o ISO sem âncora COM hora e afirma `'09:00'`:
      é a prova de que `temHorario` não é decorativo — é ele que separa "sei o dia" de
      "sei a hora".
      ✅ **Verificado que REPROVA**: revertida a derivação para `previsaoDaDose(item, 0)`
      e devolvido o `formatDiaMesHora` incondicional ao selo, **8 dos 14 falharam**;
      removido só o 4º argumento da chamada do modal, **1 falhou**.
      Suíte: **1023**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] 🔴 **A POSTERGAÇÃO É DE EXIBIÇÃO; A FILA DO BACKEND NÃO ACOMPANHA.** Item sem
      âncora só entra na fila enquanto `dentroDaJanelaDoCurso` (`[dataInicio,
      dataInicio + duracaoDias - 1]`), então o curso de 3 dias iniciado em 15/09 sai da
      fila em 18/09 — justamente o dia em que a tela passa a prever a 3ª dose. Na
      prática o cron `cancelar_doses_prescricao_perdidas` cancela o que ficou para trás.
      Alinhar os dois exigiria estender a janela pelo atraso acumulado, o que mexe na
      regra de produto de 2026-08-18 ("dose perdida não fica pendente em outros dias") e
      no cron de cancelamento — decisão de produto, não foi pedida aqui.
- [ ] O **Painel Principal** monta a mesma fila e já não tinha o defeito da hora (usa
      `formatDiaMes`), mas também **não mostra a agenda por dose** — a postergação só
      aparece no modal de `/execucao-prescricao`. Se a cascata precisar ser visível lá,
      o gancho é o mesmo `agendaDaDose`.
- [ ] A **VACINA** não tem agenda por dose (`SALVA → FINALIZADA → EXECUTADA`, aplicação
      única), então nada a postergar; o selo dela usa `vacinaAtrasadaEm`, que compara
      DATA PURA por `split('T')` e nunca inventou hora.

---

# Atualizado em: 2026-09-09 (parte 3) (🔴 **O EXAME DE IMAGEM VIROU PROCEDIMENTO** —
#   com categoria, prestador e valor. Havia DOIS catálogos paralelos para a mesma coisa
#   (`tb_imagem_exame_*` com 12 grupos e 119 itens × `tb_procedimentos_vet`), e era essa
#   duplicidade que deixava o exame de imagem sem preço, sem prestador e fora de
#   combo/orçamento. Os 119 passaram a ser procedimentos GLOBAIS (seed 005) e herdaram
#   tudo isso de graça.
#   1. **'Diagnóstico por Imagem' SAIU do seletor** do cadastro de procedimentos; no
#      lugar entram 6 CATEGORIAS — Radiografia, Ultrassonografia, Endoscopia,
#      Termografia, Tomografia e Ressonância, Laparoscopia. ⚠️ Elas NÃO viram
#      especialidade (não afetam Agenda nem cadastro de membro), e a especialidade
#      continua no DADO do procedimento.
#   2. **Aba Imagem do pedido: CATEGORIA → PRESTADOR → EXAME**, com cadastro rápido nos
#      dois (tela de Prestadores / de Procedimentos) e o VALOR na linha de cada exame.
#      O prestador é OPCIONAL; sem vínculo, faixa âmbar avisa antes de sair R$ 0,00.
#   3. 🔴 **O EXAME PASSOU A SER COBRADO**: `lancarExameNaFatura` lançava valor ZERO
#      sempre. Agora o preço é resolvido na CRIAÇÃO (vínculo do prestador → padrão da
#      empresa → catálogo) e congelado em `valor_cobrado`. ⚠️ `null` NÃO é 0 — sem
#      preço a linha nasce zerada como antes. E a CONCLUSÃO do exame alimenta o recibo
#      do prestador, no mesmo ledger do procedimento.
#   ✅ **MIGRATION APLICADA e SEED RODADO** (autorizados): 119 exames inseridos, 34
#   genéricos inativados, todos globais; a bandeira `recursos.porProcedimento` já
#   responde `true`. 🔴 **ARMADILHA**: o unique de `tb_procedimentos_vet.codigo` é
#   PARCIAL (`WHERE codigo IS NOT NULL`), e `ON CONFLICT (codigo)` sozinho morre com
#   42P10 — o predicado tem de ser repetido na cláusula. Suíte: 794. Detalhes na §12.)
---

### Sessão 2026-09-09 (parte 3) — Exame de imagem virou PROCEDIMENTO: categoria, prestador e valor

> ✅ **MIGRATION APLICADA** (autorizada) — `20261005000000_exame_prestador_valor`:
> `prestador_id` e `valor_cobrado` em `tb_exames_clinicos`, mais o índice. ADITIVA e
> sem backfill — exame existente ficou com as duas nulas e continua cobrado como
> sempre (valor 0). Conferido no `information_schema`: as duas nuláveis, índice no lugar.
> **Funciona ANTES do `prisma generate`**: as colunas são lidas/gravadas por SQL cru
> (`lib/exameImagemValor.js`), como `animalInativo` e `agendamentoAssumido`.
>
> ✅ **SEED RODADO** (`node backend/seed.js`, autorizado): **119 exames inseridos e 34
> genéricos inativados**. Conferido no banco — Radiografia 56 · Ultrassonografia 46 ·
> Endoscopia 7 · Termografia 4 · Tomografia e Ressonância 4 · Laparoscopia 2; TODOS com
> `empresa_id IS NULL`; 0 genéricos ativos; os 4 procedimentos PRÓPRIOS de empresa
> intactos. Verificado ao vivo que `recursos.porProcedimento` já responde `true` e que
> a cascata categoria → prestador → exame devolve dado real.
>
> 🔴 **ARMADILHA ACHADA NA APLICAÇÃO — `ON CONFLICT` com índice PARCIAL.** A primeira
> execução do seed morreu com `42P10 there is no unique or exclusion constraint
> matching the ON CONFLICT specification`: o unique de `tb_procedimentos_vet.codigo`
> nesta base é **PARCIAL** (`UNIQUE (codigo) WHERE codigo IS NOT NULL` — há 641
> procedimentos sem código), e `ON CONFLICT (codigo)` sozinho NÃO casa com ele. O
> predicado tem de ser REPETIDO: `ON CONFLICT (codigo) WHERE codigo IS NOT NULL`.
> ⚠️ Vale para todo upsert por SQL cru nessa coluna. E o erro é de execução, não de
> sintaxe: `node --check` passa e só o banco reprova.

- [x] 🔴 **O PROBLEMA: dois catálogos paralelos para a mesma coisa.** O exame de
      imagem vivia em `tb_imagem_exame_grupos`/`_itens` (12 grupos, 119 itens, só
      usado pela aba Imagem do pedido), enquanto procedimento vivia em
      `tb_procedimentos_vet`. Era essa duplicidade que deixava o exame de imagem **sem
      preço, sem prestador e fora de combo/orçamento** — tudo isso já existe para
      procedimento e teria de ser reescrito no outro catálogo.
      Decisão (autorizada): **UNIFICAR**. Os 119 exames viram procedimentos GLOBAIS
      (`empresa_id IS NULL`, catálogo misto) e herdam de graça o valor por empresa, o
      vínculo com prestador (com os dois valores), o combo e o orçamento.
- [x] **Seed 005 `005_procedimentos_imagem.seed.js`** — importa `GRUPOS`/`ITENS` do
      seed 004 (que passou a exportá-los): **uma cópia dos 119 exames, não duas**, que
      divergiriam na primeira correção.
      ⚠️ **A faixa PR-0302..PR-0420 foi conferida no banco ANTES**: estava livre em
      `tb_procedimentos_vet` (maior código: PR-0301). `codigo` é @unique e é ele que
      torna o upsert idempotente.
      ⚠️ **Mapa EXPLÍCITO grupo → categoria**, não `split(' - ')`: "Laparoscopia
      Diagnóstica" e "Tomografia e Ressonância (Encaminhamento)" não têm o hífen e um
      deles viraria categoria com nome errado, sem ninguém notar. Grupo novo sem mapa é
      avisado no console em vez de entrar calado numa categoria inventada.
      ⚠️ Os 34 genéricos de 'Diagnóstico por Imagem' ("Radiografia digital",
      "Ultrassonografia abdominal"…) são **INATIVADOS, nunca apagados** — podem estar
      em orçamento/prescrição já fechados. E só os GLOBAIS: procedimento que a própria
      clínica cadastrou é DELA e não se toca daqui.
      ⚠️ `especialidade` continua **'Diagnóstico por Imagem' no DADO**, embora ela
      tenha saído do SELETOR: no dado é a verdade clínica e o que mantém o exame
      compatível com quem lê especialidade; na tela quem organiza é a CATEGORIA.
- [x] **6 categorias no lugar da especialidade** (a pedido): Radiografia,
      Ultrassonografia, Endoscopia, Termografia, Tomografia e Ressonância,
      Laparoscopia. `CATEGORIAS_IMAGEM` é exportada do seed e é a **fonte única** da
      lista e da ORDEM — um `SELECT DISTINCT categoria` daria ordem alfabética (que não
      é a clínica) e mudaria sozinho quando a clínica criasse a primeira categoria própria.
      ⚠️ Elas **NÃO entram em `tb_especialidades`** (decisão autorizada): não aparecem
      na Agenda, no cadastro de membro nem no tempo de consulta. 'Diagnóstico por
      Imagem' continua no catálogo de especialidades — removê-la quebraria a Agenda de
      quem já a tem vinculada; o que mudou é só o que a TELA oferece.
      ⚠️ Conferido no banco que **nenhuma categoria colide com nome de especialidade**
      (26 no catálogo) — é o que permite o valor do seletor ser o nome puro, sem prefixo.
- [x] **Cadastro de Procedimentos**: o seletor virou **"Especialidade / Exame de
      imagem"**, com DOIS blocos e cabeçalho. `DropdownSelect` ganhou a prop `grupos`
      (o `<optgroup>` que o dropdown próprio não tinha) — sem os cabeçalhos,
      "Radiografia" apareceria no meio das especialidades clínicas e leria como se
      fosse uma delas.
      `listarComValores` aceita `?imagemCategoria=`; os dois filtros são **excludentes**
      (quem escolheu categoria de imagem não quer procedimento clínico junto).
      ⚠️ Exame de imagem é **isento do filtro de especialidades atendidas**: quem o
      governa é a categoria, e a especialidade dele pode não estar entre as da empresa —
      o que esconderia os 119 exames sem explicação. O filtro por ESPÉCIE continua valendo.
- [x] **Aba Imagem do pedido de exames: CATEGORIA → PRESTADOR → EXAME**
      (`components/ImagemSeletorUnificado.tsx`).
      🔴 **A ordem não é estética**: o PRESTADOR define o Valor Cliente do exame (o
      vínculo é por par exame×prestador), então escolhê-lo DEPOIS mostraria um preço que
      muda debaixo do que já foi marcado.
      ⚠️ Prestador é **OPCIONAL** — sem ele o exame é da própria equipe, pelo valor
      padrão. Exigi-lo pararia o atendimento por causa de um cadastro que talvez não exista.
      ⚠️ Prestador **sem vínculo** ganha faixa âmbar e NUNCA some da lista: é esse aviso
      que evita o exame sair na fatura por R$ 0,00. Mesma decisão do campo de prestador
      da prescrição.
      ⚠️ O **VALOR aparece na linha de cada exame** — é o que se cobra do cliente com
      AQUELE prestador. "—" quando não há valor cadastrado (nunca "R$ 0,00").
      **Cadastro rápido**: sem prestador → `/cadastro/prestadores`; exame inexistente →
      `/cadastro/procedimentos` já na categoria. A volta sai do ROUTER (`useLocation`),
      **nunca de `window.location`** — o app usa HashRouter e o retorno cairia na home (§14).
- [x] 🔴 **BANDEIRA `recursos.porProcedimento`** (`GET /clinica/imagem-exames/categorias`):
      diz qual catálogo vale. Base que ainda não rodou o seed 005 continua no catálogo
      ANTIGO (grupos), que **não foi removido**. Sem esse desvio a aba abriria VAZIA e
      leria como defeito, não como seed pendente. Mesmo padrão do `comboPrestador`.
      ⚠️ Sem cache de propósito: um cache de processo faria a tela seguir no catálogo
      antigo até alguém reiniciar o backend depois de rodar o seed — exatamente o
      momento em que a resposta precisa mudar.
- [x] 🔴 **O EXAME PASSOU A SER COBRADO PELO VALOR DO PROCEDIMENTO** (autorizado).
      Até aqui `lancarExameNaFatura` lançava a linha com **valor ZERO, sempre**.
      `lib/exameImagemValor.js` resolve o preço na CRIAÇÃO do pedido e o congela em
      `tb_exames_clinicos.valor_cobrado`.
      Cadeia: **vínculo do prestador → valor padrão da empresa → `valorVenda` do
      catálogo → null** — a mesma de `resolverValorProcedimento`, porque o exame É um
      procedimento agora.
      🔴 **`null` NÃO É ZERO**: "não sei o preço" e "é de graça" continuam distintos.
      `precoDoPedido` devolve `null` quando NENHUM nome resolve, e a linha nasce zerada
      como antes — que é o que vale para todo exame laboratorial e para todo exame
      anterior a esta leva. Colapsar os dois faria a fatura AFIRMAR que a clínica não
      cobra pelo exame.
      ⚠️ **SNAPSHOT do dia do pedido**: recalcular na leitura faria o exame de março ser
      cobrado pelo preço renegociado em setembro.
      ⚠️ `lancarExameNaFatura` **busca o valor quando o chamador não o traz**: são
      quatro gatilhos (criação, finalização da evolução, conclusão do exame) e sem isso
      três deles lançariam zerado. `require` LOCAL, para não criar ciclo entre as libs.
      ⚠️ Dinheiro **arredondado ao centavo** na soma: percentual fecha em
      55.000000000000004 e o pedido sairia com um centavo que ninguém explica.
- [x] **RECIBO DO PRESTADOR** — a **conclusão** do exame é, aqui, o equivalente à
      EXECUÇÃO do procedimento: é quando o serviço se completa e a clínica passa a dever
      a quem executou. `registrarReciboDoExame` grava no MESMO ledger
      (`tb_execucoes_procedimento_prestador`) que o recibo já lê.
      ⚠️ Só com prestador — exame da própria equipe não gera recibo.
      ⚠️ Best-effort e nunca lança: conclusão de exame é ato clínico e não pode cair
      porque o recibo não registrou.
      ⚠️ Idempotente por construção: `finalizar` recusa exame já CONCLUIDO.
- [x] **`prestador_id` SEM FK**, como `tb_prescricoes.prestador_id`: prontuário não muda
      porque um cadastro de prestador foi excluído, e `ON DELETE SET NULL` apagaria de
      quem era o exame. Quem guarda o vínculo de forma imutável é o ledger do recibo.
- [x] **Multi-tenant**: o catálogo é MISTO — os 119 são globais (todos leem, ninguém
      escreve) e **o que a clínica cadastra é dela** (`empresa_id` setado). Prestadores
      vêm de `tb_prestadores` da empresa (tenant direto sob RLS) e os vínculos/valores
      são por `empresa_id`. O endpoint de exames lê `empresa_id IS NULL OR = <empresa>`:
      só global ou próprio — nunca de outra clínica.
- [x] Testes: `__tests__/exameImagemProcedimento.test.js` (24 casos) — o mapa completo
      grupo→categoria, código único, o seed que não toca em procedimento da empresa, o
      `null ≠ 0` do preço, e um GATE ESTRUTURAL nos três elos que somem em silêncio (o
      valor na fatura, a gravação do preço na criação, o recibo na conclusão).
      ✅ **Verificado que REPROVA**: devolvido o `valor: 0` fixo e removida a chamada do
      recibo, **2 casos falharam**; restaurado, os 24 voltaram a passar.
      Suíte: **794**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] O pedido de exame não guarda os itens de forma estruturada (`descricao` é a lista
      concatenada), então o preço é a SOMA dos exames do pedido, resolvida por NOME.
      Exame cujo nome contenha vírgula quebra o fallback — por isso o front manda
      `examesNomes` explícito. Um `ExameClinicoItem` resolveria de vez.
- [ ] A tela não filtra os exames pela espécie do paciente: `AnimalInfo` (a prop que
      `SubModuloExames` recebe) não carrega a espécie. O endpoint já aceita `especie` e
      está pronto para quando ela chegar lá.
- [ ] O catálogo antigo `tb_imagem_exame_*` continua existindo e sendo semeado (é a
      FONTE do seed 005 e o que atende a base não migrada). Só pode ser aposentado
      depois que toda base tiver rodado o seed — e aí some junto o desvio da bandeira.

---

### Sessão 2026-09-06 (parte 2) — Cadeia de responsáveis, ordenação nos históricos e filtros da Evolução

> ✅ **MIGRATIONS APLICADAS** (autorizadas nesta sessão) — `20260924000000_cadeia_responsaveis`
> (colunas + backfill) e `20260924000001_cadeia_responsaveis_backfill` (o backfill de
> verdade — ver armadilha 42). `npx prisma generate` FALHOU com `EPERM` (lock do query
> engine, §11) e ficou PENDENTE: não faz falta hoje (a cadeia é lida e escrita por SQL
> cru), mas rodar na próxima parada do backend.

- [x] 🔴 **CADEIA DE RESPONSÁVEIS — a coluna "Responsável" passou a contar a história
      inteira.** `Marco Araújo → Marina → Cláudio → Laura` sai com os três primeiros
      RISCADOS, lado a lado (quebrando linha quando não cabem), e Laura em pé embaixo.
      ⚠️ **O registro só sabia UM nome antes disto**: `autorId` (o primeiro) na evolução
      e `assumido_de_id` (o imediato) no agendamento. Depois da segunda assunção,
      nenhum dos dois conta a história. A trilha completa existia só como TEXTO LIVRE
      no AuditLog ("responsável anterior: X → novo responsável: Y") — boa para auditar,
      inútil para desenhar uma coluna: exigiria varrer o log por linha da lista e
      depender do formato de uma frase.
      Coluna `responsaveis_anteriores INTEGER[]` nas duas tabelas + fonte única
      `lib/cadeiaResponsaveis.js` (SQL cru, `array_append`).
      ⚠️ **INTEGER[] e não tabela de histórico**: o dado é uma lista ORDENADA lida
      sempre inteira, junto da linha, e nunca consultada por si ("em que registros o
      Fulano já foi responsável" é pergunta do AuditLog). Uma tabela custaria um JOIN em
      toda listagem para devolver exatamente o mesmo array.
      ⚠️ **A escrita mora no FUNIL, não nos controllers**: `marcarAssumido` já era o
      ponto por onde passam as QUATRO trocas do agendamento (assumir na agenda, assumir
      pela evolução, trocar profissional, transferir o dia). Empilhar em cada caminho
      faria o próximo nascer sem cadeia. Na evolução são dois pontos: `assumir` e o
      ARRASTO (`transferirEvolucoesDoAgendamento`), onde cada evolução empilha O SEU
      dono anterior — um agendamento pode ter evoluções de profissionais diferentes.
      ⚠️ **Não empilha `null`** (agendamento sem responsável não deixa um vão riscado) e
      **não repete o último** (dois caminhos podem carimbar a mesma troca). A mesma
      pessoa REAPARECE quando a passagem é outra (A → B → A), que é história de verdade.
      🔴 **A CADEIA GUARDA PASSAGENS, NÃO PESSOAS DISTINTAS** — corrigido no mesmo dia,
      depois de relatado: `ResponsavelTrocado` descartava todo elo com o nome do
      responsável ATUAL, e com isso apagava a passagem anterior de quem voltou a
      assumir. Medido na base: a evolução 132 tem
      `Marco Araújo → Claudio Araujoc → marina → Claudio Araujoc` gravado, e a tela
      mostrava só `Marco Araújo / marina` — uma história que não aconteceu. O filtro
      saiu; fica só o colapso de repetição CONSECUTIVA (que é a mesma troca carimbada
      duas vezes), e ele compara por **id**, não por nome: homônimos na mesma clínica
      são duas pessoas.
      ⚠️ **`WITH ORDINALITY` + `ORDER BY` na leitura**: sem eles o banco não promete
      ordem nenhuma, e a cadeia sairia contada de trás para frente.
      ⚠️ **Tolera a coluna ausente** (`.catch`), o que permitiu subir o código antes do
      banco: sem a migration, a tela caía no comportamento anterior (um nome riscado).
      Front: `components/ResponsavelTrocado.tsx`, usado pela Evolução e pela Agenda.
      🔴 Na AGENDA o rastro existia no backend desde 2026-08-02 e **nenhuma tela o
      exibia** — o selo "Assumida de" se perdeu quando `SubModuloMinhaAgenda` foi
      removido (28-g).
- [x] **ORDENAÇÃO POR COLUNA nos históricos** — `components/OrdenacaoLista.tsx`, fonte
      única. Ciclo: 1º crescente · 2º decrescente · **3º volta à ordem natural** (sem o
      terceiro estado, quem clica sem querer não tem como devolver a lista ao padrão).
      Registro SEM VALOR vai para o fim nos DOIS sentidos — trocar os "—" de ponta faz a
      lista parecer embaralhada. Texto por `localeCompare` pt-BR; data como TIMESTAMP
      (como texto, "10/02" viria antes de "9/02").
      Aplicada em 10 históricos: Evolução, Prescrição, Vacina, Exames, Encaminhamento,
      Documentos Emitidos, Orçamento, Farmácia, Estoque de Vacinas e Exames Nutricionais.
      ⚠️ **Onde a paginação é do SERVIDOR (Evolução e Prescrição), a ordem é pedida ao
      backend** — ordenar no navegador reorganizaria as 10 linhas da página e mentiria
      sobre as outras 200. `lib/ordenacaoLista.js` + **whitelist obrigatória** por
      controller: o campo vem do cliente e vira caminho de `orderBy` do Prisma.
      ⚠️ As chaves do front e da whitelist do backend são AS MESMAS — divergir faz a
      coluna clicar e não ordenar nada, porque o servidor descarta a chave que não
      conhece.
      ⚠️ FICAM DE FORA os históricos SEM cabeçalho de coluna (Fatura, Execução de
      Prescrição, Histórico do Paciente, Exame de Compra): são listas de cards/linhas, e
      ordenar ali exige um controle novo ("Ordenar por: …"), que é outra interface.
- [x] **Filtros de data, responsável e "N por página" REMOVIDOS da Evolução** (a pedido).
      O recorte do histórico ficou só nas pílulas de status, no mesmo lugar de
      Prescrição, Vacina e Exames. Saiu junto o `GET /clinica/evolucoes/responsaveis/
      :animalId` (só alimentava aquele select) e o `DateInput` da tela; `limit` virou
      `LIMIT_HISTORICO = 10`.
      ⚠️ A barra só é renderizada quando o botão "Nova Evolução" existe — sem isso ela
      virava uma faixa com borda e nada dentro.
      ⚠️ `retratoConfiavel` (o que o submódulo reporta ao shell) NÃO passou a olhar a
      ordenação: ela REORDENA a mesma lista, não a recorta. Só o RECORTE (página,
      status) ameaça o retrato das evoluções abertas.
- [x] **O banner do atendimento nomeia quem assumiu** — "Atendimento EV-0004 de
      05/09/2026 22:54 - **Evolução assumida por Marina** - Em andamento", no lugar do
      título. Regra em `utils/evolucaoAtiva.ts#descricaoAtendimento`, consumida pelos
      DOIS pontos que montam o rótulo (o `title` da faixa e o JSX).
      ⚠️ Sem o NOME de quem assumiu, cai no rótulo de sempre: "assumida por" sem nome
      não informa nada que o banner já não diga.
- [x] Testes: `__tests__/cadeiaResponsaveis.test.js` (13 casos) — ordem cronológica,
      `null` que não vira nome riscado, o "não repete o último", A → B → A, coluna não
      migrada que não derruba a operação clínica, e um gate estrutural que reprova
      `marcarAssumido`/arrasto/`assumir` sem a empilhagem.
      ✅ **Verificado que REPROVA**: o banco falso do teste deriva as garantias DO
      PRÓPRIO SQL (`<> $2::int` e `ORDER BY ... e.ord`) — removidas as duas cláusulas da
      lib, dois casos falharam. Suíte: **539**.
- [ ] Os FILHOS do atendimento (prescrição, exame, encaminhamento, vacina) não têm
      cadeia — são arrastados normalmente, mas a coluna "Responsável" deles mostra só o
      atual. O caminho é o mesmo: entrada em `TABELAS` de `lib/cadeiaResponsaveis.js` e
      a empilhagem dentro de `transferirFilhosDasEvolucoes`, que já conhece o `deVetId`
      de cada movido.
- [ ] Mãos INTERMEDIÁRIAS anteriores à migration não são reconstruídas: o backfill
      semeia o AUTOR (evolução) e o ANTERIOR IMEDIATO (agendamento), que é o que as
      colunas antigas sabiam. A sequência completa do passado só existe como texto no
      AuditLog, e derivá-la de uma frase faria o sistema AFIRMAR uma cadeia deduzida.
- [ ] O card MOBILE acompanha a ordem escolhida no desktop, mas não tem controle
      próprio (não há cabeçalho de coluna para clicar).

---

# Atualizado em: 2026-09-06 (🔴 INATIVAR O PACIENTE FECHA O ATENDIMENTO ABERTO +
#   dois vãos no congelamento do prontuário + reset ao trocar de paciente.
#   1. 🔴 **A EVOLUÇÃO ABERTA FICAVA ABERTA PARA SEMPRE.** Inativado o paciente, o
#      guard passa a recusar TODA escrita — inclusive a própria finalização. Nem o
#      gestor conseguia fechar aquele atendimento, e ele ficava pendurado na tela e
#      nas listas. Congelar um atendimento no meio não é deixá-lo em aberto: é
#      FECHÁ-LO. Agora `AnimalController.inativar` finaliza as evoluções
#      EM_ANDAMENTO na MESMA transaction da inativação.
#      ⚠️ Pela MESMA cascata do Finalizar normal — `lib/finalizacaoEvolucao.js`,
#      extraída de `EvolucaoController.atualizar`: prescrição e vacina SALVAS vão
#      ao plantão, o agendamento sai de EM_ANDAMENTO, os exames vão à fatura. Uma
#      cópia própria divergiria em silêncio.
#      ⚠️ **`veterinarioId` NÃO é reescrito.** No Finalizar normal quem finaliza
#      vira o responsável porque ESCOLHEU fechar e responde pelo que declara; aqui
#      ninguém conduziu nada — é consequência administrativa. Quem inativou fica em
#      `modificadoPorId` e o motivo, na auditoria.
#   2. 🔴 **DOIS VÃOS NO CONGELAMENTO, achados em uso:** (a) `SubModuloEvolucao`
#      RECALCULA os níveis por LINHA a partir de `permissoes[...]` cru, contornando
#      as variáveis onde o `!pacienteInativo` mora — Alterar, Cancelar e Assumir
#      seguiam visíveis; (b) o banner "Finalizar Atendimento" resolvia a permissão
#      no TOPO do componente, antes de `animal` existir. Nos dois casos o backend
#      recusava com 400 e o clique só falhava (armadilha 28-d).
#      O gate agora zera o NÍVEL na origem, não cada predicado.
#   3. **TROCAR DE PACIENTE = TELA NOVA.** Nenhum submódulo era remontado: o texto
#      da evolução em digitação, o item em edição e o formulário aberto
#      atravessavam a troca — o rascunho de um paciente aparecia no prontuário de
#      outro. `key` com o `effectiveAnimalId` nos quatro + `setAnimal(null)` no
#      reset (sem ele, `pacienteInativo` é o do paciente ANTERIOR até o fetch voltar).
#   Gate novo `__tests__/pacienteInativoFront.test.js` — o anterior só cobria o
#   BACKEND, e o sintoma nasce na TELA. Suíte: 526. Detalhes na §12, 2026-09-06.)
---

### Sessão 2026-09-06 — Inativar fecha o atendimento; os vãos do congelamento; reset por paciente

- [x] 🔴 **A EVOLUÇÃO ABERTA DE UM PACIENTE INATIVADO FICAVA ABERTA PARA SEMPRE.**
      O guard (`bloquearSeAnimalInativo`) recusa toda escrita — inclusive a
      finalização. Resultado: ninguém, nem o gestor, conseguia mais fechar aquele
      atendimento; ele seguia pendurado na tela, no banner e nas listas.
      **Congelar um atendimento no meio não é deixá-lo em aberto — é fechá-lo.**
      `AnimalController.inativar` passou a finalizar as evoluções EM_ANDAMENTO do
      paciente na MESMA transaction da inativação.
      ⚠️ **NÃO precisou de exceção no guard**: a finalização acontece ANTES de o
      estado congelado valer para o mundo, dentro da transaction. Abrir um furo em
      `bloquearSeAnimalInativo` seria o caminho errado — o furo serviria a qualquer
      escrita, não só a esta.
- [x] **`lib/finalizacaoEvolucao.js` — a cascata virou FONTE ÚNICA.** Ela nasceu
      inline em `EvolucaoController.atualizar` e ganhou um segundo chamador; duas
      cópias divergiriam em silêncio (a prescrição iria ao plantão por um caminho e
      não pelo outro, sem nada acusar).
      `cascataDaFinalizacao(tx, evolucaoId, { agendamentoId, porUsuarioId })`:
      agendamento EM_ANDAMENTO → FINALIZADO · prescrição SALVO → FINALIZADO (+ itens
      ATIVA) · vacina SALVA → FINALIZADA. Idempotente (todo update filtra pelo status
      de origem). `lancarExamesDaEvolucao` é a parte de FATURA, e mora à parte porque
      roda DEPOIS do commit.
      ⚠️ **Só transição de status.** Fatura e baixa de estoque continuam na EXECUÇÃO,
      no plantão (regra de 2026-07-25). A exceção é o EXAME, lançado com valor ZERADO
      — e fora da transaction: fatura de destino PAGA faz o helper lançar, e isso
      reverteria a inativação, prendendo o paciente num estado pela metade.
      ⚠️ A prescrição promovida tem a `versao` invalidada: quem a tiver aberta leva
      409 em vez de gravar sobre um documento que já foi para o plantão.
- [x] 🔴 **`veterinarioId` NÃO É REESCRITO na finalização automática.** No Finalizar
      normal quem finaliza vira o responsável, porque ESCOLHEU fechar o atendimento e
      responde pelo que ele declara. Aqui ninguém conduziu nada — é consequência
      administrativa da inativação. Carimbar quem inativou como autor do prontuário
      alheio seria falsear a autoria clínica, a mesma razão pela qual a assinatura do
      vet não sai na linha de outro (§12, 02/09). Quem inativou fica em
      `modificadoPorId`; o motivo e o antes → depois vão para a auditoria.
- [x] 🔴 **VÃO 1 — a Evolução RECALCULAVA os níveis por LINHA.** Dentro de
      `acoesDaEvolucao`, `nivelEditar`/`nivelDeletar` saíam de `permissoes[...]` CRU,
      contornando `podeEditar`/`podeDeletar` — que são justamente onde o
      `!pacienteInativo` mora. Alterar, Cancelar e Assumir seguiam visíveis no
      prontuário congelado; o backend recusava com 400 e o clique só falhava.
      Corrigido **na origem**: `const nivelEditar = pacienteInativo ? 'NENHUM' : …`.
      ⚠️ Gatear cada predicado derivado (`podeEditarEsta`, `podeCancelarPropria`…)
      resolveria o sintoma e deixaria o buraco: o PRÓXIMO predicado escrito ali
      nasceria desprotegido. Zerando o nível, todos somem de uma vez.
      ⚠️ Havia um segundo escape no mesmo bloco: o ramo `isGestor && FINALIZADA` do
      Alterar (reabrir evolução finalizada), que não passa por `podeEditarEsta`.
      **`isGestor` não é passe livre aqui** — o backend barra o gestor igual.
- [x] 🔴 **VÃO 2 — o banner "Finalizar Atendimento".** `podeFinalizarEvolucao` era
      resolvido no TOPO do componente, antes de `animal` existir, então não tinha como
      olhar `pacienteInativo`. Movido para junto dele.
      ⚠️ `podeImprimirEvolucao` FICA no topo: imprimir não depende do estado do
      paciente — saída de conteúdo é liberada no prontuário congelado, e é isso que
      "fica para visualização" quer dizer. Há teste guardando esse sentido.
- [x] 🔴 **TROCAR DE PACIENTE = TELA NOVA.** Nenhum submódulo era remontado na troca:
      só a Evolução tinha `key`, e era o contador de finalização, não o animal. O
      estado interno atravessava a troca — texto da evolução em digitação, item em
      edição, formulário aberto. O rascunho de um paciente aparecia no prontuário de
      outro, e um Salvar distraído o gravaria lá.
      `key` com `effectiveAnimalId` nos QUATRO submódulos.
      ⚠️ O rascunho de verdade não se perde: `SubModuloEvolucao` o guarda em
      localStorage POR animalId, então remontar restaura o do paciente certo.
      ⚠️ **`setAnimal(null)` no reset**: sem ele a tela segue exibindo o paciente
      ANTERIOR até o fetch responder — e nessa janela `pacienteInativo` é o estado do
      OUTRO. Trocar de um ativo para um inativo deixava os botões ligados por um
      instante, com o dado errado na tela.
- [x] **Gate novo `__tests__/pacienteInativoFront.test.js` (11 casos).** O
      `pacienteInativo.test.js` cobre o BACKEND (o guard em toda escrita); este cobre
      a TELA, que é onde o sintoma nasce e onde ele é INVISÍVEL — o botão aparece, o
      backend recusa, e a pessoa conclui que "o sistema está com erro".
      ✅ **Verificado que reprova**: revertido o arquivo ao código com o defeito, os
      dois casos relevantes falharam.
      ⚠️ A varredura IGNORA COMENTÁRIOS (`semComentarios`) — sem isso ela acusa o
      PRÓPRIO comentário que explica a regra, e um gate que reprova a documentação da
      regra é um gate que se aprende a ignorar. Mesma lição do gate de e-mail.
      Mais `__tests__/inativacaoFinalizaAtendimento.test.js` (11 casos) para a
      cascata e para a regra de autoria. Suíte: **526**.
- [ ] **Paciente inativado ANTES desta mudança continua com o atendimento aberto** —
      a finalização automática só vale daqui em diante. O gate do banner e o dos
      ícones cobrem a tela desses casos, mas a evolução deles segue EM_ANDAMENTO e só
      fecha reativando o paciente e finalizando à mão. Um backfill resolveria; não foi
      feito porque fechar atendimento em massa é decisão de produto, não de código.
- [ ] A inativação NÃO gera título por IA para a evolução que fecha (o Finalizar
      normal gera). É consumo de IA medido por empresa, e o título é documentado como
      conveniência — evolução fechada por inativação pode ficar sem ele.

---

# Atualizado em: 2026-09-05 (parte 5) (🔴 CONCORRÊNCIA CHEGOU À PRESCRIÇÃO E AO
#   EXAME, e o ARRASTO passou a TRAVAR o profissional anterior de verdade.
#   1. 🔴 **A AUTORIA NÃO BARRAVA O GESTOR ANTERIOR.** Quem assume a evolução
#      arrasta prescrição/exame/encaminhamento/vacina junto (isso já existia), e a
#      autoria bloqueia o profissional comum. Mas `podeOperarRegistro` tem BYPASS
#      DE GESTOR — um gestor que perdeu o atendimento continuava gravando por cima
#      de quem assumiu, em silêncio. Agora `transferirFilhosDasEvolucoes` também
#      INVALIDA A VERSÃO de cada registro movido (`invalidarVersoes`): a tela do
#      anterior segura a versão velha e leva 409 no próximo salvar, SEJA QUAL FOR
#      O CARGO. É o que torna o bloqueio automático em vez de depender de quem a
#      pessoa é — e vale para TODO caller do arrasto (assumir evolução, assumir
#      agendamento, trocar profissional, transferir o dia).
#   2. **`versao` em `tb_prescricao_grupos` e `tb_exames_clinicos`.** A da
#      prescrição fica no GRUPO, não no item: o que se disputa é o DOCUMENTO —
#      incluir/remover item muda o conjunto, e versão por item deixaria passar
#      "A removeu o item 3 enquanto B adicionava o item 4".
#      ⚠️ `veterinarioId` NÃO tem `@map` nessas duas tabelas (camelCase, exige
#      aspas), ao contrário do agendamento (`veterinario_id`) — armadilha 41.
#   3. 🔴 **A RESERVA DE ESTOQUE PASSOU A ACOMPANHAR A EDIÇÃO DO ITEM.**
#      `finalizar` reserva pela quantidade do item; editar DEPOIS (grupo
#      FINALIZADO, zero doses — a prescrição parada na fila do plantão) deixava a
#      reserva na quantidade ANTIGA, e trocar o medicamento deixava a do anterior
#      ÓRFÃ, segurando estoque que ninguém mais consome. Novo
#      `recalcularReservasDoGrupo`: apaga e refaz do zero.
#      ⚠️ Só é seguro porque o guard `EXECUTADO` garante ZERO doses dadas —
#      depois da primeira, as reservas já foram abatidas proporcionalmente e
#      recriá-las pela quantidade CHEIA reservaria o que já saiu do estoque.
#   🔴 **MIGRATION GERADA, NÃO APLICADA** — `20260923000000_concorrencia_prescricao_exame`.
#   Suíte: 504 (+11). Detalhes na §12, sessão 2026-09-05 (parte 5).)
---

### Sessão 2026-09-05 (parte 5) — Concorrência na prescrição e no exame + o arrasto que trava de verdade

> 🔴 **MIGRATION GERADA, NÃO APLICADA** —
> `prisma/migrations/20260923000000_concorrencia_prescricao_exame/`: `versao INT NOT
> NULL DEFAULT 1` em `tb_prescricao_grupos` e `tb_exames_clinicos`. Sem RLS novo, sem
> backfill (o default cobre a linha existente). Some com a de `20260922000000` no
> mesmo `migrate deploy`.

- [x] 🔴 **O QUE FALTAVA NO ARRASTO: ele não travava o GESTOR anterior.**
      `transferirFilhosDasEvolucoes` já movia prescrição, exame, encaminhamento e
      vacina quando alguém assume a evolução — isso existe desde 2026-08-04 e está
      correto. O que não existia era o bloqueio ser AUTOMÁTICO: quem barrava o
      profissional anterior era a AUTORIA, e `podeOperarRegistro` tem **bypass de
      GESTOR**. Na prática, um gestor que perdeu o atendimento continuava podendo
      gravar por cima de quem assumiu, e nada acusava.
      Agora cada registro arrastado tem a `versao` INCREMENTADA (`invalidarVersoes`,
      em `lib/concorrenciaRegistro.js`): a tela do anterior segura a versão velha e
      leva **409** no próximo salvar, seja qual for o cargo.
      ⚠️ **Fica DENTRO de `transferirFilhosDasEvolucoes`, não nos controllers** — é o
      que faz valer para TODOS os callers de uma vez: assumir evolução, assumir
      agendamento, trocar o profissional e transferir o dia inteiro. Pôr nos
      controllers deixaria o caminho novo nascer desprotegido.
      ⚠️ **Na MESMA transaction do arrasto**: revertida a transferência, a versão não
      pode ter avançado — senão a tela de quem NÃO perdeu nada passaria a levar 409.
      ⚠️ **Sem condição de versão** ali, de propósito: não há disputa a resolver, a
      transferência JÁ foi decidida. Condicionar criaria uma corrida onde não há.
      ⚠️ O 4º campo de `FILHOS_DA_EVOLUCAO` diz qual recurso invalidar; `null` em
      ENCAMINHAMENTO e VACINA (sem a coluna) — são formulários curtos, sem o risco de
      texto longo em digitação. Ganhando `versao` um dia, é só preencher o campo.
- [x] **`versao` na PRESCRIÇÃO (no GRUPO) e no EXAME.**
      ⚠️ **No GRUPO, não no item**: o que se disputa é o DOCUMENTO. Incluir e remover
      item mudam o conjunto, e uma versão por item deixaria passar "A removeu o item
      3 enquanto B adicionava o item 4" — cada item com a versão intacta e o
      documento resultante sendo o de ninguém. `atualizarItem`, `adicionarItem` e
      `removerItem` reservam a versão do grupo como PRIMEIRO passo da transaction.
      ⚠️ **`veterinarioId` NÃO tem `@map`** em `PrescricaoGrupo` nem em `ExameClinico`
      (coluna camelCase, exige aspas), ao contrário de `AgendamentoClinico`
      (`veterinario_id`). Errar isso só aparece em runtime, com o banco na frente —
      armadilha 41. Há teste travando as quatro strings.
      ⚠️ No EXAME o `salvarResultado` também entrou, nos DOIS ramos: o de Imagem
      gravava por um `update` solto e ganhou transaction por causa da trava. Dois
      carregamentos concorrentes faziam o segundo APAGAR a tabela de resultado do
      primeiro (`deleteMany` + recriação) sem nenhum aviso.
- [x] 🔴 **A RESERVA DE ESTOQUE ACOMPANHA A EDIÇÃO DO ITEM** —
      `recalcularReservasDoGrupo`. `finalizar` reserva estoque pela quantidade de
      cada item; editar DEPOIS disso (grupo FINALIZADO e ainda sem nenhuma dose — ou
      seja, a prescrição parada na fila do plantão) deixava a reserva presa no valor
      ANTIGO: dobrar a duração de 5 para 10 dias seguia reservando 5, e trocar o
      medicamento deixava a reserva do anterior ÓRFÃ, segurando estoque que ninguém
      mais vai consumir — o próximo a prescrever aquele medicamento via saldo a menos.
      ⚠️ **APAGA TUDO E RECRIA**, em vez do ajuste por medicamento: é o único jeito de
      limpar a reserva do medicamento que SAIU do documento — `criarReservas` percorre
      os itens NOVOS e nunca chega ao que foi trocado.
      ⚠️ **SÓ VALE PARA GRUPO SEM NENHUMA EXECUÇÃO.** Depois da primeira dose as
      reservas já foram abatidas proporcionalmente por `debitarEstoqueDia`, e
      recriá-las pela quantidade CHEIA reservaria de novo o que já saiu do estoque.
      Quem garante isso é o guard `EXECUTADO` do `atualizarItem`, que roda antes — se
      ele for afrouxado, este helper precisa ser revisto junto.
      ⚠️ Sai cedo em `SALVO`: rascunho não tem reserva a refazer.
      ⚠️ `removerItem` NÃO foi tocado — ele já tinha o próprio recálculo, com o
      cuidado extra do caso PARCIALMENTE executado, que este helper não cobre.
- [x] **Testes**: 38 em `concorrenciaEdicao.test.js` (+11) e a asserção nova em
      `autoriaAtendimento.test.js`, que agora prova que o arrasto invalida as versões
      dos movidos — é lá que a regra pertence.
      ✅ **Verificado que REPROVAM**: removi a invalidação do arrasto e o recálculo da
      reserva, um de cada vez, e cada gate falhou.
      ⚠️ **O gate da reserva nasceu FROUXO e passou na sabotagem**: ele só checava que
      `recalcularReservasDoGrupo` APARECIA no handler, e o handler chama o helper duas
      vezes (origem e destino do roteamento). Foi apertado para exigir a chamada da
      ORIGEM (`recalcularReservasDoGrupo(tx, item.grupo)`). Lição para gate novo:
      "a função aparece" não é asserção — sabote e confira.
      Suíte: **504 passando**; `tsc -b` + `vite build` limpos.
- [ ] **ENCAMINHAMENTO e VACINA seguem sem `versao`.** São arrastados normalmente e
      protegidos pela autoria, mas o gestor anterior ainda os alcança. O caminho é o
      mesmo: coluna + entrada em `TABELAS` + preencher o 4º campo de
      `FILHOS_DA_EVOLUCAO` (que já está lá, com `null`).
- [ ] **A tela da prescrição e a do exame não assinam o canal SSE** — recebem o 409 ao
      salvar, com a mensagem certa, mas não entram em somente leitura na hora como a
      Evolução. Não é lacuna de integridade; é o aviso imediato que falta.

---

# Atualizado em: 2026-09-02 (parte 3) (🔴 A DESCRIÇÃO DO EXAME SUMIA AO ANEXAR O
#   LAUDO + cliente sem paciente saiu do Faturamento.
#   1. 🔴 **RESET + CLOSURE: o campo terminava VAZIO nos dois sentidos.** Na tela de
#      Resultado de Exame (`ExamesSolicitadosPanel`, Laboratorial e Imagem), o modo
#      SUBSTITUIR zerava o formulário ANTES de chamar a IA (`setDescricao('')`,
#      `setLaboratorio('')`, `setDataExame('')`) — mas `manterSePreenchido` comparava
#      com as variáveis da CLOSURE, que ainda guardavam o valor ANTERIOR. Ele concluía
#      "já está preenchido", não gravava o que a IA leu, e o campo ficava com o vazio do
#      reset: **perdia-se o valor velho E o novo**. Como Descrição é obrigatória, o vet
#      anexava o laudo e via o nome do exame — que veio do PEDIDO — desaparecer.
#      REGRA (a pedido): **descrição que veio de PESSOA é preservada; a que a IA leu de
#      um arquivo ANTERIOR é substituída quando o arquivo é trocado.** Sem essa
#      distinção, anexar o laudo errado e corrigir deixaria o nome errado para sempre.
#      Quem separa os dois é `descricaoVeioDoArquivo` (useRef): digitar à mão e o
#      "Não é este" da divergência devolvem a autoria à pessoa.
#      ⚠️ `laboratorio`/`dataExame` continuam sendo zerados por lote (são dados LIDOS
#      do arquivo), mas passaram a ser comparados com `aposReset(...)` — o vazio de
#      depois do reset, não o valor de antes. Era o mesmo defeito neles.
#      ⚠️ Descrição em branco só é preenchida com o que a IA achou NO ARQUIVO
#      (`extracao.tipoExame` na Imagem, `nomeExame` no Laboratorial). Não achando nada,
#      o campo fica vazio para digitar — o nome do ARQUIVO não vira nome de exame.
#   2. **Cliente SEM PACIENTE não aparece mais no Faturamento** (`listarProprietarios`).
#      A tela é por PACIENTE — lançamento, rateio e a seção "Informação do Cavalo" da
#      fatura partem dele —, então cliente sem nenhum animal no escopo é linha em que
#      não há o que cobrar. ⚠️ QUEM ISTO REMOVE é o cliente retido pela regra da FATURA
#      PENDENTE (o desligado da empresa, ou aquele cujos pacientes foram todos
#      excluídos): sem paciente e sem fatura pendente ele já não aparecia.
#      CONSEQUÊNCIA ACEITA: fatura ABERTA/FECHADA/ATRASADA desse cliente deixa de ser
#      alcançável por esta tela — para trazê-lo de volta, reative um paciente dele, ou
#      troque o filtro por "sem paciente E sem fatura pendente".
#      ⚠️ NÃO se aplica ao PROPRIETÁRIO vendo a própria fatura (o outro ramo do mesmo
#      handler): ali o filtro esconderia a fatura dele dele mesmo. Suíte: 355.)
---

### Sessão 2026-09-02 (parte 3) — Descrição do exame e cliente sem paciente

- [x] 🔴 **A descrição do exame sumia ao anexar o laudo** — reset + closure, ver o item
      1 do topo. O mesmo defeito atingia `laboratorio` e `dataExame`.
      ⚠️ Padrão a não repetir: função que zera estado e, na MESMA passagem, decide algo
      lendo aquele estado. O `setX('')` não muda a variável da closure — compare com o
      valor de DEPOIS do reset (aqui, `aposReset(...)`), ou não zere.
- [x] **Cliente sem paciente saiu da lista do Faturamento** — ver o item 2 do topo.
- [ ] `descartarLoteDivergente` ("Não é este") devolve descrição/laboratório do PEDIDO,
      e agora também zera `descricaoVeioDoArquivo`. Para o exame AVULSO (sem pedido) ele
      devolve string vazia, que é o correto — não havia nada antes do arquivo.

---

### Sessão 2026-08-31 (parte 4) — Execução de Prescrição: histórico dentro da execução
- [x] **Card do item, dentro do `ModalExecucao`, redesenhado** para os itens com
      regime multi-dose/multi-dia (`regimeExigeResumo` — já existia, agora reusado
      para mais que a "linha atual"): substituiu a linha "dosagem • via • frequência
      • duração" + a linha vermelha única + os pills de horário + "Dia XX/YY" por:
      - **Periodicidade + Dose em vermelho**, sempre no topo: `"1x ao dia por 7
        dias - 10mL"`.
      - **Uma linha por aplicação JÁ COBERTA**, em cinza: `"Aplicação (01/07) —
        Executada"` — da 1ª dose até a de HOJE, nunca as futuras (que ainda não
        chegaram e nem têm data garantida, dado o rolling schedule).
      - **A linha da dose ATUAL** troca "Executada" por **"Em Execução"** e é a
        ÚNICA com o botão de executar (antes ficava solto na lateral do card,
        agora mora na própria linha — CLAUDE.md pedia "Botão de execução" ali).
      - **Nome do medicamento/procedimento por último**, com o selo Med/Proc.
      Item SEM regime (dose única, SOS, se necessário) mantém o layout simples de
      sempre (periodicidade+dose em vermelho, sem histórico) — não há curso para
      listar.
      **Nenhuma chamada nova ao backend**: as datas de cada linha vêm de
      `dataDoDiaISO(item.dataInicio, linha.dia)` sobre o que `gerarResumoDoses`
      (`utils/posologia.ts`) já calculava — a PRÉVIA teórica do regime (frequência
      × duração), a mesma que a tela de criar prescrição usa. Isso é uma projeção,
      não o horário REAL de cada dose (que é rolling e pode atrasar/adiantar) —
      compatível com o que a função já documentava de si mesma ("sem depender de
      horário real"); exato o bastante para "qual dia é esta aplicação", que é o
      que a tela precisa mostrar.
      ⚠️ **`idxAtual` (qual linha é "a de agora") usa `dosesFeitas(item)`, NUNCA
      `item.dosesExecutadas` cru** — o prop só atualiza quando o modal fecha e o
      pai recarrega a lista; `dosesFeitas` soma o `doseOverride` desta SESSÃO do
      modal. Usar o valor cru faria a linha "Em Execução" ficar PRESA na mesma
      aplicação depois de executá-la, sem revelar a próxima, até o modal reabrir.
- [x] **Evolução: ação Finalizar REMOVIDA dos ícones de ação** (desktop e mobile) —
      pedido explícito, o atendimento se finaliza pelo banner "Finalizar
      Atendimento" do shell (`Atendimento.tsx`), não mais pelo ícone da linha.
      Removido por inteiro, não só escondido: `handleFinalizarDireto`,
      `handleFinalizarConfirmado`, o estado `confirmFinalizar`, o `ConfirmModal`
      que ele abria e as duas cópias de `podeFinalizarEsta`/`nivelFinalizar`
      (mobile e desktop) — sem outro call site, ficariam mortos e o `tsc -b`
      já reprova variável/import não lido.

---

### Sessão 2026-08-31 (parte 3) — Prescrição: "1x a cada N dias" agenda por Qtd. de Vezes
- [x] **Pedido**: nas frequências "1x a cada N dias" (2/3/21/30/90 e "1x por semana"),
      o vet pensa em QUANTAS VEZES aplicar, não em quantos DIAS o tratamento dura.
      Ex.: 1x/semana, 5 vezes, começando hoje (18/08) → doses em 18/08, 25/08, 01/09,
      08/09, 15/09.
      **Não precisou de NENHUMA mudança de agendamento no backend** — o rolling
      schedule já existia (`lib/agendaDoses.js#calcularProximaDose`: a PRÓXIMA dose
      prevista é sempre a ÚLTIMA EXECUTADA + o intervalo da frequência, nunca uma
      grade fixa recontada) e já produz exatamente essas datas. O único papel de
      `Prescricao.duracaoDias` (`Int NOT NULL`) nesse fluxo é alimentar
      `dosesTotaisEsperadas = round(duracaoDias / dosesPorDia)`, que decide QUANDO o
      curso está completo (`dosesExecutadas >= dosesTotaisEsperadas`) — a data de
      cada dose não vem daí.
      A mudança inteira é de FORMULÁRIO (`SubModuloPrescricao.tsx`): `INTERVALO_DIAS`
      mapeia cada frequência ao intervalo em dias (2/3/7/21/30/90). Com uma
      frequência dessas selecionada, o campo (ainda o mesmo `form.duracaoDias`
      internamente) passa a **exibir e receber "vezes"**, convertendo na hora:
      mostra `duracaoDias ÷ intervalo` arredondado; ao digitar, grava
      `vezes × intervalo`. Nada no envio ao backend muda — `duracaoDias` chega em
      DIAS como sempre chegou, só que agora calculado para bater exatamente com o
      nº de vezes pedido (`vezes × intervalo` sempre arredonda para `vezes`, sem
      erro de precisão).
      `ItemRow` (chip da lista) segue a mesma lógica: mostra **"Qtd: 5x"** em vez de
      **"Dur: 35d"**, e o chip **"Fim:"** passa a ser a data da ÚLTIMA dose
      (`início + (vezes-1)×intervalo`) — usar `duracaoDias` bruto ali (35 dias)
      sobraria além do curso real, que termina na 5ª aplicação (dia 28), não no dia 34.
- [x] **Hora Início virou OBRIGATÓRIA nessas frequências** (asterisco condicional +
      validação nova). Motivo: o rolling schedule só entra em ação quando o item é
      "elegível" (`elegivelParaFluxoNovo` exige `horaInicio` preenchido) — sem hora,
      o item cai no fluxo LEGADO (`janelaDoItem`), que trata qualquer dia dentro da
      janela `dataInicio..dataInicio+duracaoDias` como pendente. Sem essa trava, uma
      prescrição "1x/semana" sem Hora Início apareceria "a executar" TODO santo dia
      do curso, não só nas datas certas — o oposto do que foi pedido.
- [x] **Ajustes finos do mesmo formulário** (pedido em seguida, mesma sessão):
      "1x por semana" ganhou rótulo PRÓPRIO — **"QTD. SEMANAS"** em vez do genérico
      "QTD. DE VEZES" (`QTD_LABEL`, só essa frequência; as demais seguem no
      genérico — 1 dose/semana faz "nº de semanas" e "nº de vezes" serem o MESMO
      número, então é só um rótulo mais natural, sem mudar a conta). O ícone
      `<Clock>` saiu do rótulo "HORA INÍCIO" (era o único campo da linha com
      ícone). Os 4 campos da linha Frequência/Hora Início/Qtd·Duração/Data Início
      ganharam `whitespace-nowrap` no `<label>` — sem isso, o rótulo mais longo
      ("QTD. DE VEZES *") podia quebrar em 2 linhas num viewport estreito e
      descia o campo dele sozinho, desalinhando da Hora Início ao lado.

---

### Sessão 2026-08-25 — Atendimento ativo passou a ser ESCOLHIDO, não adivinhado
- [x] **O Nº do atendimento no card "Histórico de Evolução Clínica" virou o SELETOR do
      atendimento ativo.** O mesmo paciente pode ter mais de uma evolução EM ANDAMENTO
      (consultas distintas — regra de 2026-08-18 parte 3), e até então o shell
      **adivinhava** qual era a de agora ("a minha" → desempate pelo `agendamentoId` da
      URL → a mais recente). Sem forma de corrigir a adivinhação,
      prescrição/exame/encaminhamento/vacina lançados nas abas se vinculavam ao
      atendimento ERRADO e não havia nada na tela que explicasse por quê. Agora, em
      evolução EM ANDAMENTO, o `AG-0013`/`EV-0007` é um BOTÃO que CARREGA aquele
      atendimento na tela: o banner passa a descrevê-lo e todo registro clínico lançado
      no shell passa a se vincular a ele.
      Componente `NumeroAtendimento` — UM só para o card mobile e a tabela desktop
      (duas cópias divergem na primeira correção — armadilha 28-g). Ele faz
      `stopPropagation`: a `<tr>` inteira já tem `onClick` que abre a visualização, e
      sem isso selecionar abriria o modal junto.
      ⚠️ Fora de EM ANDAMENTO o Nº continua sendo TEXTO: atendimento fechado não é "o de
      agora", e botão que não faz nada é pior que nenhum (armadilha 28-d).
- [x] **O BANNER É UM SÓ e mostra o atendimento CARREGADO** —
      **`Atendimento AG-0013 de 25/08/2026 17:11 - Consulta clínica geral - Em
      andamento`** (`formatDataHora` — INSTANTE, nunca `formatDate`, §6).
      ⚠️ Uma versão com UMA FAIXA POR ATENDIMENTO ABERTO chegou a ser feita e foi
      **RECUSADA a pedido** ("não quero que as duas estejam visíveis ao mesmo tempo").
      Não reintroduzir: quem lista os atendimentos abertos é o histórico, que já os tem
      com data, responsável e status; o banner responde uma pergunta só — "em qual eu
      estou agora?".
      ⚠️ O TÍTULO só existe depois que a IA o gera na FINALIZAÇÃO — durante o
      atendimento o rótulo cai na `especialidade`. Sem esse fallback, a faixa mais
      importante da tela ficaria sem nome justamente enquanto está em curso.
      **Sem mudança no backend**: `listarPorAnimal` usa `include` sem `select`, então
      `dataInicio`/`titulo`/`especialidade`/`agendamentoId` já vinham.
- [ ] Selecionar NÃO abre a evolução no formulário — só carrega o atendimento. Quem
      quer escrever nela usa o "Alterar" (lápis) que já existe na mesma linha; abrir o
      editor no mesmo clique descartaria o rascunho em digitação do outro atendimento.
      Reavaliar se o uso mostrar que os dois passos são sempre o mesmo gesto.
- [ ] A troca só existe na aba **Evolução** (é lá que o histórico mora). Nas abas de
      Prescrição/Exames/Encaminhamento o banner informa qual está ativo, mas para trocar
      é preciso voltar à Evolução. Se incomodar, o gancho é `onSelecionarEvolucao` — o
      "Histórico do Paciente" do shell pode oferecer o mesmo clique.
- [x] **`utils/evolucaoAtiva.ts` — FONTE ÚNICA de "qual evolução aberta é a de agora".**
      A regra estava COPIADA em `Atendimento.tsx`, `SubModuloEvolucao.tsx` e
      `Vacina.tsx`, e as três já divergiam. Ordem: **escolha explícita → a minha cujo
      `agendamentoId` bate com o contexto → a primeira minha → a primeira de qualquer
      um**. A escolha vale só enquanto a evolução continuar ABERTA: finalizada, ela sai
      da lista e a decisão volta ao automático (senão o shell ficaria preso a um id que
      não existe mais e nada seria vinculado).
- [x] **`evolucaoAtiva` deixou de ser estado e virou DERIVAÇÃO** (`useMemo` sobre
      `evolucoesAbertas` + `evolucaoSelecionadaId`). Guardar lista e ativa em dois
      estados deixaria a ativa apontando para uma evolução já finalizada por outra aba.
- [x] **Contrato do `SubModuloEvolucao` mudou** — `onEvolucaoChange(ev|null)` (que
      mandava a evolução JÁ ESCOLHIDA por ele) deu lugar a:
      `onEvolucoesAbertasChange(abertas[])` (a LISTA, fonte da verdade a cada recarga) e
      `onEvolucaoCriada(ev)` (só na criação — o shell a seleciona na hora, sem esperar a
      recarga: quem acabou de abrir o atendimento é quem o conduz).
      ⚠️ **A submódulo NÃO decide mais qual é a ativa.** Dois lugares decidindo era o que
      fazia as telas discordarem sobre qual atendimento estava em curso.
      ⚠️ **A lista da aba é FILTRADA e PAGINADA** — só é reportada ao shell quando
      nenhum filtro pode estar escondendo um atendimento aberto (`retratoConfiavel`:
      página 1, sem filtro de data/responsável, status vazio ou EM_ANDAMENTO). Reportar
      um recorte APAGARIA do banner o atendimento em paralelo e desvincularia a
      prescrição seguinte. Filtrou? O shell segue com a consulta própria dele
      (`carregarEvolucoesAbertas`, `status=EM_ANDAMENTO&limit=20`), que `onSalvo`
      re-executa depois de assumir/finalizar/cancelar.
      ⚠️ As duas props precisam ser `useCallback` ESTÁVEL: entram nas dependências do
      `carregarEvolucoes` do submódulo, e identidade nova a cada render fecha o laço de
      requisições que já causou 429 (sessão 2026-08-02).
- [x] **A escolha é persistida por paciente** (`s2vet_ev_sel_<animalId>`): o shell é
      DESMONTADO ao ir para as telas apartadas (Vacina, Execução de Prescrição), e sem
      isso voltar de lá reabria em outro atendimento. `Vacina.tsx` lê a mesma chave —
      senão a vacina nasceria vinculada a um atendimento diferente daquele em que a
      prescrição do mesmo paciente acabou de ser lançada.
      ⚠️ **Chegar com `?agendamentoId=` na URL LIMPA a escolha anterior**: é o "Iniciar"
      da agenda, ato explícito e mais recente que o clique no Nº. Sem isso, iniciar a
      segunda consulta do dia deixaria o shell preso na primeira.
      ⚠️ Atendimento escolhido que FECHA (finalizado/cancelado, aqui ou por outro
      profissional) some da lista: `escolherEvolucaoAtiva` ignora o id órfão e a decisão
      volta ao automático — a escolha nunca prende o shell num id que não existe mais.
- [ ] `ExecucaoPrescricao.tsx` não participa da escolha — ele lista o que já foi
      prescrito, não vincula registro novo a evolução. Se um dia passar a criar registro
      clínico, precisa ler `escolherEvolucaoAtiva` como as outras três telas.

---

# Atualizado em: 2026-08-23 (AGENDA DE DOSES — 4 mudanças ligadas, todas em
#   `lib/agendaDoses.js` + `PrescricaoGrupoController.executar` + `ExecucaoPrescricao.tsx`:
#   1. 🔴 FUSO: `primeiraDoseEsperada` montava o horário com `setUTCHours(h)` — "20:00"
#      virava 20:00 UTC = 17:00 em Brasília. Era a origem do "sistema 3 horas atrás"
#      relatado, e contaminava tudo a jusante (chip do horário, `proximaDoseEm`,
#      antecipada×atrasada, lembrete de WhatsApp). Agora o instante é montado com o
#      construtor LOCAL (`new Date(ano, mes, dia, h, m)`) — o processo roda com
#      `process.env.TZ='America/Sao_Paulo'` (server.ts). ⚠️ A DATA continua saindo dos
#      getters UTC: `dataInicio` é gravada como meia-noite UTC e só `getUTCDate()`
#      devolve o dia do calendário. Regra: DATA por getter UTC, HORA por construtor LOCAL.
#   2. 🔴 HORA INÍCIO deixou de ser OBRIGATÓRIA em toda frequência (saíram as 3
#      validações `HORA_INICIO_OBRIGATORIA` do backend e a do front; `precisaHoraInicio`
#      foi REMOVIDA dos dois lados). Quem fixa a grade é a PRIMEIRA EXECUÇÃO: ivermectina
#      "12/12h" executada às 20:00 tem a próxima às 08:00 — o rolling schedule
#      (`calcularProximaDose(agora, frequencia)`) já fazia isso; faltava deixar o item
#      ENTRAR nesse fluxo sem hora (`elegivelParaFluxoNovo` não exige mais `horaInicio`).
#      Novo `semAncoraDeHorario(item)` = sem hora E sem dose dada: nesse estado NÃO
#      EXISTE horário previsto — `horarioPrevistoDoItem` devolve `null` e o item fica
#      disponível em toda a JANELA DO CURSO (`dentroDaJanelaDoCurso`), como o fluxo
#      legado. TODO caller que compara `agora` com o previsto precisa checá-lo antes,
#      senão a 1ª dose nasce "atrasada" contra uma meia-noite que ninguém escolheu.
#      Propagado a: `itemPendenteNoDia`, `itemPendenteEm`/`itemPrevistoParaDataFutura`/
#      `itemDevidoHoje`/`proximaDoseRealHoje` (front — sem as duas últimas o item
#      aparecia SEM botão de executar, ou nem aparecia), ao cron de dose perdida
#      (`prescricaoCronService` — só cancela depois que a JANELA acaba, não no dia
#      seguinte a `dataInicio`) e ao lembrete de WhatsApp (o filtro `horaInicio: {not:
#      null}` saiu: quem prova que há horário agendado é `proximaDoseEm`).
#   3. 🔴 EXECUÇÃO FUTURA (ANTECIPADA) É BLOQUEADA — só passa com JUSTIFICATIVA
#      ⚠️⚠️ **INVERTIDO em 2026-09-18 (parte 4): a justificativa saiu e virou uma
#      CONFIRMAÇÃO (`confirmarAntecipacao`).** Leia este item como histórico. O que
#      dele CONTINUA valendo é o gate rodar para TODO item, nos dois caminhos — e a
#      flag da antecipação ser PRÓPRIA, nunca `confirmarHorario`, pelo motivo que o
#      próprio parágrafo abaixo explica.
#      (`ModalJustificativa`, mín. 3 chars), gravada no AuditLog em `motivo` junto do
#      previsto/executado. `confirmarHorario` NÃO a libera mais: era esse o furo
#      relatado — "Executar Todos" mandava a flag fixa em `true` e aplicava o curso
#      inteiro de uma vez, enquanto o ícone "Executar" checava o horário; o MESMO
#      documento tinha duas regras. Agora o gate roda para TODO item de `itensHoje`,
#      venha a chamada de um caminho ou do outro. ATRASADA segue com o aviso simples
#      (`CONFIRMACAO_NECESSARIA` + `confirmarHorario`) — a dose já era devida, atrasar
#      não inventa dose nova; o clique em lote vale como essa confirmação.
#      ⚠️ `onClick={() => handleExecutarTodos()}` com ARROW: `onClick={handleExecutarTodos}`
#      passaria o MouseEvent como `justificativa` e todo clique viraria antecipação
#      "justificada" (mesmo bypass silencioso do `handleSalvar` de ModalNovoFornecedor).
#   4. Card da execução mostra o HORÁRIO REAL por dose: "Dose 01/02 - Executado às
#      18:00" / "Dose 02/02 - Prevista para 06:00 de 24/08". `listarParaExecucao` passou
#      a devolver o histórico COMPLETO (`item.doses[]`, era `take: 1`) —
#      `item.executadoEm` guarda só a ÚLTIMA execução e faria todas as linhas exibirem a
#      mesma hora. A previsão das doses seguintes encadeia o intervalo a partir de
#      `proximaDoseEm` (`previsaoDaDose`), mesma conta do backend; sem âncora não há
#      hora e a linha cai na data teórica do calendário. `doseOverride` (contador) virou
#      `dosesLocais` (horários ISO), senão a dose recém-executada ficava "Executado" sem
#      hora até o pai recarregar. Formato 24h pt-BR, como o resto do sistema.
#   Testes: `src/__tests__/agendaDoses.test.js` (16 casos — fuso, hora opcional, rolling
#   20:00→08:00, antecipada×atrasada). Suíte: 150 passando. VACINA não foi tocada: não
#   tem agenda por dose (SALVA→FINALIZADA→EXECUTADA, aplicação única).)
---

### Sessão 2026-08-18 (parte 4) — Vacina: validação de obrigatórios, bug de estoque e coluna Justificativa
- [x] **Tipo de dose/Via deixaram de ser "opcionais até o Finalizar dar erro"** —
      `SubModuloVacina.tsx`: `handleInserir` ("Inserir" do formulário) e `salvarEdicaoForm`
      ("Atualizar item") só validavam a VACINA (`medicamentoId`); Dose e Via só eram
      cobradas depois, em `salvarItens` (o "Finalizar"), quando o item já estava preso na
      lista. Agora as duas funções recusam ANTES de entrar/voltar para a lista, com o
      mesmo texto de erro e o mesmo `campos: ['dose'|'via']` (destaca o campo via
      `classeErro`) que `salvarItens` já usava. Rótulos **TIPO DOSE \*** e **VIA
      APLICAÇÃO \*** ganharam o asterisco — **VACINA \*** já tinha.
- [x] **🔴 Bug de estoque confirmado e corrigido: cancelar vacina SALVA/FINALIZADA (nunca
      executada) inflava o lote.** Pergunta que motivou a investigação — "o estoque só
      debita na execução, mas RESERVA ao finalizar e libera se cancelada?" — resposta:
      **não existe reserva nenhuma para vacina** (ao contrário da prescrição, que tem
      `ReservaEstoque` de verdade). `registrar()` grava `loteId` na vacina só como
      REFERÊNCIA de preço/lote sugerido (comentário already no código: "o débito do lote
      acontece na EXECUÇÃO, não aqui no registro") — `qtdDisponivel` não é tocado.
      `VacinaClinicaController.excluir` (cancelar), no entanto, **restaurava estoque a
      partir da mera presença de `vacina.loteId`** — sem checar se aquele lote tinha
      sido de fato debitado. Resultado real: registrar uma vacina (o `loteId` já é
      fixado, seja escolhido ou por FEFO automático) e cancelá-la ANTES de executar
      devolvia ao lote doses que nunca tinham saído dele — cada ciclo "registra e
      cancela" inflava `qtdDisponivel`. Corrigido: `excluir` agora só restaura quando
      existe `FaturaItem` vinculado (`vacinaClinicaId`) — a prova de que
      `darBaixaEFaturar` rodou (chamada só por `finalizar`, no quadrante
      aplicadaPeloProprietário×!cliente, ou por `executar`, no plantão; nunca por
      `registrar`). Mesmo sinal que o resto do controller já usa como "foi cobrado".
      ⚠️ Vacina **`cliente: true`** nunca é debitada mesmo passando por `executar`
      (`if (!isCliente && ...)` guarda a chamada de `darBaixaEFaturar`) — por isso o
      cheque é por FaturaItem, não por status (`EXECUTADA` sozinho mentiria para esse caso).
- [x] **Coluna "Justificativa" nas listas de registros CANCELADOS/inativos do módulo
      Atendimento** — texto truncado por CSS (`truncate`, acompanha a largura real da
      coluna) + texto INTEIRO no tooltip nativo (`title`) ao passar o mouse. Componente
      novo `components/JustificativaCancelamento.tsx` (reusado nos 5 lugares; `className`
      controla display+largura — nunca fixo no componente, para não brigar entre o uso em
      célula de tabela `block` e o uso inline dentro de frase do card mobile
      `inline-block`). Aplicado em tabela desktop E card mobile de:
      - **Evolução** (`justificativaExclusao`) e **Prescrição** (`motivoCancelamento`,
        cobre `CANCELADO` E `CANCELADO_PARCIALMENTE`) — o campo já vinha de graça na
        listagem (Prisma devolve todo escalar do model quando o `include` não usa
        `select`); só faltava declarar no `interface` do front e renderizar.
      - **Vacina** (`motivoInativacao`) — dado e tipo já existiam ponta a ponta; só
        faltava a coluna/linha (só aparecia dentro do modal de detalhe).
      - **Exame** e **Encaminhamento** — ⚠️ estes DOIS não tinham (e não têm, de
        propósito, ver abaixo) coluna própria de justificativa de cancelamento no banco:
        o motivo era gravado SÓ no `AuditLog` (`registrarAuditoria`), nunca no próprio
        registro. Em vez de migration, o backend passou a ENRIQUECER a listagem com um
        SELECT pontual no AuditLog (`categoria:'CANCELAMENTO'`, `entidade:'EXAME_CLINICO'`
        ou `'ENCAMINHAMENTO'`, `entidadeId: {in: idsInativos/idsCancelados da página}`),
        anexando `justificativa` (exame) / `justificativaCancelamento` (encaminhamento —
        nome diferente de propósito: `motivo` já existe no encaminhamento e é o motivo do
        ENCAMINHAMENTO em si, não o do cancelamento). **Decisão de escopo**: não criar
        coluna nova no banco para isto — mudança de schema não se aplica sem autorização
        explícita (ver `feedback_nada_no_banco_sem_autorizacao` na memória), e o dado já
        existe de forma confiável no AuditLog; a query pontual resolve sem migration.
      - Encaminhamento: a coluna Justificativa É exibida (só populada quando
        `status === 'CANCELADO'`), mas isso não reabre a remoção deliberada do BADGE de
        status (`SubModuloEncaminhamento.tsx`, comentário "Não reintroduzir a exibição
        sem pedido") — não há pill/cor de status, só o texto da justificativa quando
        existe. Drive-by: o `motivo` do encaminhamento (campo que JÁ era truncado por
        `line-clamp-1` na linha/card) ganhou `title={enc.motivo}` — não tinha tooltip
        nenhum, mesma lacuna que motivou o pedido original.

---

### Sessão 2026-08-18 (parte 3) — Duas consultas do MESMO animal no MESMO dia são atendimentos DISTINTOS
- [x] **Bug relatado: a 2ª consulta assumida "iniciava" na agenda mas nunca virava
      evolução.** Repro: agendada a Corbela para a Marina como Clínica e, no mesmo dia,
      de novo como Dermatologia (duas linhas na agenda, dois `AgendamentoClinico`).
      Patrícia assumiu e iniciou a Clínica — ok, evolução criada. Assumiu e iniciou a
      Dermatologia — o agendamento virou `EM_ANDAMENTO` (o "Iniciar" já marca isso
      ANTES de existir evolução), mas nenhuma evolução nascia: o formulário nem abria.
      Causa, nos dois lados:
      - **Backend** (`EvolucaoController.criar`) — o bloqueio de "evolução própria já
        aberta" (`minhaAberta`, regra de 2026-07-29) olhava só `veterinarioId`, pelo
        ANIMAL inteiro, ignorando o `agendamentoId`. A evolução da Clínica (dela,
        `EM_ANDAMENTO`) contava como "já tenho uma aberta para este animal" e bloquearia
        (400) qualquer tentativa de abrir a da Dermatologia — se a chamada chegasse a
        acontecer.
      - **Frontend** (`SubModuloEvolucao.tsx`, useEffect do "Iniciar") — nem chegava a
        chamar o backend: via `temEvolucaoAberta=true` (a evolução da Clínica) e
        `evolucaoAbertaDeOutro` vazio (é dela mesma) → caía num `return` mudo, sem abrir
        o formulário nem mostrar erro nenhum. Por isso "criou o registro na agenda [o
        PATCH que marca EM_ANDAMENTO] porém não criou o atendimento na evolução".
- [x] **Regra nova, nos dois lados: a evolução própria só bloqueia quando é a MESMA
      CONSULTA** — sem agendamento (avulsa, ambígua por natureza: duas avulsas do mesmo
      animal são indistinguíveis) ou vinculada ao MESMO `agendamentoId` que já está
      aberto (reenvio/duplo clique). Vinculada a um agendamento DIFERENTE é uma consulta
      DISTINTA — a mesma pessoa pode conduzir a Clínica e a Dermatologia do mesmo animal
      no mesmo dia, em paralelo, como dois atendimentos de verdade. `agendamentoId` é o
      que PROVA a distinção; é por isso que a regra não se aplica ao clique manual de
      "Nova Evolução" sem ter passado por um agendamento — ver PENDENTE.
      `EvolucaoController.criar`: `minhaAberta` agora casa por `agendamentoId` (não só
      por animal); `evolucaoAberta` (o 409 de "outro profissional", que oferece
      assumir/criar-nova) passou a EXCLUIR explicitamente as MINHAS — antes pegava
      `abertas[0]` cru, e uma evolução minha (de agendamento diferente, já sem bloquear)
      podia acabar ali, oferecendo "assumir" a mim mesma.
      `SubModuloEvolucao.tsx`: o useEffect do "Iniciar" ganhou um terceiro caminho —
      minha aberta de OUTRO agendamento não bloqueia mais nem pergunta nada (o clique em
      "Iniciar" já É a decisão): liga `criandoConcorrente` e segue preparando o
      formulário da consulta nova, com o "Agendamento vinculado" pré-selecionado nela.
      O banner amarelo (antes só falava de "outro profissional") ganhou o texto para
      este caso: nomeia a especialidade/atendimento que já está em andamento.
- [x] **"Qual das minhas evoluções abertas é a ativa agora" passou a usar o
      AGENDAMENTO como desempate — a resposta ao "pensei em um seletor" — em vez de
      inventar um componente de escolha novo.** Com duas evoluções MINHAS abertas ao
      mesmo tempo para o mesmo animal, o `agendamentoId` que veio na URL (o mesmo que o
      "Iniciar" da agenda sempre propaga, via `agendamentoIdFromUrl`/localStorage
      `s2vet_ag_<animalId>`) já identifica sem ambiguidade qual delas é "a de agora" —
      não sobrava nada para um seletor decidir na prática. Aplicado nos DOIS lugares que
      resolviam "a minha vence" arbitrariamente (`abertas.find(mine) ?? abertas[0]`):
      `SubModuloEvolucao.carregarEvolucoes` (a quem prescrição/vacina/exame lançados
      agora se vinculam) e `Atendimento.carregarEvolucaoAtiva` (o banner "Finalizar
      Atendimento" do shell, quando a aba Evolução ainda não carregou). Este último
      ganhou um `useEffect` PRÓPRIO — antes disparava junto do reset de animal
      (`setEvolucaoAtiva(null); ...; carregarAnimal()`), que não pode rodar de novo só
      porque o agendamento da URL mudou (limparia `viewPrescricaoId`/`viewExameId` à toa).
- [ ] **PENDENTE:** o botão manual "Nova Evolução" (fora do fluxo "Iniciar" da agenda)
      continua bloqueando sempre que há QUALQUER evolução minha aberta para o animal,
      mesmo que exista um agendamento distinto disponível para escolher no seletor
      "Agendamento vinculado" do formulário — porque o botão decide ANTES de a lista de
      agendamentos ser buscada (só acontece quando o formulário abre). Not blocking o
      "Iniciar" (o caminho real do bug relatado) resolve o caso concreto; deixar o botão
      manual igualmente inteligente exigiria buscar os agendamentos ANTES do clique (ou
      sempre abrir o formulário e deixar o back recusar no Salvar, como já acontece pelo
      "Iniciar") — não fiz essa mudança para não alterar o comportamento hoje estável do
      clique manual sem um pedido concreto.
- [ ] **PENDENTE, de propósito, se algum dia a resolução por `agendamentoId` não bastar:**
      um seletor explícito ("qual atendimento você está conduzindo agora?") só faria
      diferença quando o usuário chega à aba Evolução SEM nenhum `agendamentoId` no
      contexto (URL nem localStorage) E tem 2+ evoluções próprias abertas para o mesmo
      animal — hoje isso cai no fallback antigo (mais recente). Não implementado por não
      haver caso relatado; o gancho é o mesmo par de `find(mine)` citado acima.

---

### Sessão 2026-08-18 (parte 2) — Agendamento: status `CANCELADO_AUTOMATICAMENTE`
- [x] **Agendamento `EM_ANDAMENTO` ficava travado para sempre quando o atendimento nunca
      era concluído** — `cancelarAgendamentosNaoRealizados` (`agendamentoCronService.js`,
      job noturno `cancelar_agendamentos_nao_realizados`, 23:30) só cancelava
      `AGENDADO`/`ATRASADA` com `dataHora` no passado; `EM_ANDAMENTO` (o "Iniciar" da
      agenda já marca o agendamento assim ao abrir a evolução) era explicitamente
      preservado, na premissa de que o atendimento ainda em curso não devia ser mexido.
      Só que, sem ninguém finalizar a evolução, o agendamento ficava `EM_ANDAMENTO`
      indefinidamente — dias, semanas — bloqueando a grade e sem nenhum caminho automático
      de saída. Agora o cron também varre `EM_ANDAMENTO` com `dataHora` no passado.
- [x] **Status novo `CANCELADO_AUTOMATICAMENTE`, EXCLUSIVO da rotina** — pedido explícito:
      o cancelamento feito pelo sistema precisa ser DISTINGUÍVEL do cancelamento feito por
      alguém (botão Cancelar + justificativa). Antes os dois caíam no mesmo `CANCELADO` e
      a distinção se perdia. `AgendamentoController.STATUS_VALIDOS` ganhou o valor;
      `STATUS_SOMENTE_SISTEMA = ['CANCELADO_AUTOMATICAMENTE']` é checado no INÍCIO de
      `atualizarStatus` (antes até do gate de motivo) — um PATCH manual tentando setar
      esse status responde 400. Nenhuma migration: `AgendamentoClinico.status` é
      `VarChar`, não enum do Postgres.
      Mesmo padrão de `CANCELADO_PARCIALMENTE` (prescrição) — status que só a rotina
      grava já é precedente no código, não é ideia nova.
      `STATUS_LIVRES` (não ocupa mais a grade) ganhou o valor: `ocupacaoDoDia`,
      conflito de horário, listagem "futuros" do `AnimalDetail` — tudo que já lia
      `STATUS_LIVRES` passou a tratar o cancelamento automático como o manual.
      Motivo gravado em `observacao` é DIFERENTE por origem (`MOTIVO_NAO_INICIADO` ×
      `MOTIVO_EM_ANDAMENTO`, `agendamentoCronService.js`) — quem abre o card entende se
      ninguém nunca apareceu ou se o atendimento começou e ficou pendurado.
      ⚠️ **PENDENTE, de propósito:** o ramo `EM_ANDAMENTO` só encerra o AGENDAMENTO — a
      evolução clínica que ele abriu (se ainda `EM_ANDAMENTO`) NÃO é tocada. Fechá-la
      sozinha apagaria/encerraria um registro clínico com conteúdo potencialmente já
      escrito pelo profissional — decisão maior do que a desta rotina, e não foi pedida.
      Mesmo padrão de `cancelarPrescricoesNaoExecutadas` (não cascateia para fora do
      próprio grupo). Quem abrir o paciente ainda vê e pode finalizar/cancelar
      manualmente a evolução aberta — os dois ciclos de vida (agendamento × evolução)
      seguem independentes.
- [x] **Front, backend e relatórios propagados** (mesma lição da armadilha do
      `STATUS_CLS[status] undefined` quando REAGENDADO nasceu — ver §12, sessão
      2026-07-28 parte 4): `Agendamentos.tsx` (`StatusAgendamento`, `STATUS_LIVRES`,
      `STATUS_FILTRAVEIS` — aparece como opção no seletor "Somente" —, `STATUS_COR`/
      `STATUS_LABEL`, tom **mais claro** que o `CANCELADO` manual — mesma família, cor
      distinta), `AnimalDetail.tsx` (card do painel Agendamentos, badge "Cancelado
      automaticamente"), `MapaAtendimento.tsx` (front: `StatusBadge` teria caído no
      `else` — "Agendado", âmbar, a MESMA cor de pendente — se eu não tivesse adicionado
      o branch explícito; back: `porStatus`/`totalAgend`/o KPI `cancelado` somam as duas
      origens, é um agregado gerencial). `RelatoriosController.atendimento` (`canceladas`)
      e `PainelPrincipal.tsx` (`agendaOrdenada`, senão o item cancelado pela rotina
      continuava aparecendo como se fosse um agendamento do dia ainda por vir).

---

# Atualizado em: 2026-08-18 (Vacina ganhou RESERVA de estoque — model novo
#   ReservaEstoqueVacina, espelho de ReservaEstoque/PrescricaoGrupoController: reserva
#   ao finalizar (FEFO), consome ao executar, libera ao cancelar. 🔴 Migration GERADA
#   em prisma/migrations/20260830000000_reserva_estoque_vacina — NÃO aplicada, precisa
#   de `npx prisma migrate deploy` + `npx prisma generate` antes de usar)
---

# Atualizado em: 2026-08-18 (Vacina: Tipo Dose/Via passaram a ser exigidos ANTES de
#   entrar na lista (não só no Finalizar); corrigido bug real de estoque — cancelar
#   vacina nunca executada inflava o lote; coluna "Justificativa" nas listas de
#   registros cancelados/inativos de todo o módulo Atendimento, com tooltip do texto
#   inteiro — Exame e Encaminhamento resolvidos via AuditLog, sem migration)
---

# Atualizado em: 2026-08-18 (Evolução: duas consultas do MESMO animal no MESMO dia —
#   ex. Clínica + Dermatologia — voltaram a ser tratadas como atendimentos DISTINTOS
#   mesmo quando o mesmo profissional assume as duas; o bloqueio de "evolução própria
#   já aberta" agora casa por agendamentoId, não pelo animal inteiro)
---

# Atualizado em: 2026-08-18 (Agendamento: novo status CANCELADO_AUTOMATICAMENTE — a
#   rotina noturna cancela AGENDADO/ATRASADA e agora também EM_ANDAMENTO com dataHora no
#   passado, e é a ÚNICA que grava esse status; o backend recusa como input manual)
---

# Atualizado em: 2026-08-18 (Execução de Prescrição: Histórico navega por dia (não só
#   "hoje") e a fila Medicamentos×Procedimentos passou a decidir "a executar"×"Histórico"
#   POR TIPO de item, não pelo documento inteiro — corrige item já executado ficando
#   preso/sem ação na fila até o outro tipo também terminar)
---

### Sessão 2026-08-18 — Execução de Prescrição: Histórico por dia + fila por TIPO de item
- [x] **Histórico deixou de ficar travado em "hoje"** — `ExecucaoPrescricao.tsx` sempre
      teve um `CalendarioInterativo` para navegar dias anteriores (`dataSel`), mas a
      faixa "Histórico" (prescrições/vacinas já executadas) só era montada quando
      `dataSel === localToday()`: `carregar()` só chamava
      `GET /clinica/vacinas/executadas-hoje` quando `isHoje`, e o cálculo de
      `executadasHoje` (grupos) zerava fora do dia de hoje. Clicar num dia anterior no
      calendário mostrava a fila "a executar" daquele dia (o backend já respeitava
      `?data=`), mas o que já tinha sido executado NAQUELE dia simplesmente não
      aparecia em lugar nenhum. Corrigido: `carregar()` sempre busca
      `/clinica/vacinas/executadas-hoje?data=<dataSel>` e a categorização por tipo
      (abaixo) não depende mais de `isHoje`. `VacinaClinicaController.listarExecutadasHoje`
      ganhou o mesmo `?data=` que `PrescricaoGrupoController.listarParaExecucao` já
      tinha — antes calculava sempre a partir de `new Date()` do servidor, ignorando
      qualquer data pedida. O rótulo do card também virou "Histórico — executadas em
      dd/mm" fora do dia de hoje (`rotuloHistorico`), em vez de sempre "hoje".
- [x] **"a executar" × "Histórico" passou a ser decidido POR TIPO de item, não pelo
      documento inteiro** — bug relatado assim: prescrição com medicamento E
      procedimento; executado o medicamento, o item "sumia" (não aparecia no
      Histórico) e ao abrir o procedimento a tela parecia travada ("nenhum botão
      funciona"); só depois de executar TAMBÉM o procedimento (e a 2ª dose do
      medicamento, no caso relatado) é que os dois desciam JUNTOS para o Histórico.
      Causa: `foiExecutadoHoje(g)` avaliava o GRUPO inteiro (`!g.itens.some(itemPendenteHoje)`
      — TODOS os itens, dos dois tipos) para decidir se ele saía da fila "a executar" e
      ia para o Histórico. Com o medicamento pronto e o procedimento pendente, o grupo
      inteiro continuava "a executar": a linha no card de Medicamentos continuava
      oferecendo "Executar", mas abrir o modal (`tipoFiltro='MEDICAMENTO'`) só mostrava
      o item já executado, com o ícone desabilitado e "Executar Todos" sempre inativo —
      nada realmente quebrado, mas TODOS os botões daquele modal legitimamente sem
      função nenhuma, o que lê como tela travada. E como o grupo nunca migrava (por tipo)
      para o Histórico, o medicamento executado não deixava rastro visível em lugar
      nenhum até o procedimento também ser concluído.
      Novo `tipoConcluidoEm(g, tipo)`: cada CARD (Medicamentos, Procedimentos) decide
      sozinho, olhando só os itens do seu próprio tipo — `gruposMedicamentos`/
      `gruposProcedimentos` (a executar) e `historicoMedicamentos`/
      `historicoProcedimentos` (no Histórico) são recomputados a partir de `grupos` com
      esse critério, e um grupo com os dois tipos pode estar em "a executar" num card e
      no "Histórico" no outro, ao mesmo tempo. `horaExecucaoDeTipo` (era `horaExecucaoDe`)
      também passou a olhar só os itens do tipo do card, para o horário do medicamento
      não vazar pro badge do procedimento. Cancelada nunca migra para o Histórico
      (continua na fila "a executar" com o badge "Cancelada" — comportamento preservado).
      Espelha o pedido explícito do usuário: **"os itens executados não deveriam sumir,
      só mudar de status"** — mesmo padrão das demais abas (Evolução, Prescrição), onde
      o item concluído ganha um badge e migra de seção, nunca desaparece sem deixar
      rastro. `foiExecutadoHoje(g)` (documento inteiro) foi mantida só como fallback do
      `soVisualizacao` do modal quando `modalTipo` é null.

---

### Sessão 2026-07-30 — Agenda: local no lugar da espécie + adiantar × passado
- [x] **A agenda mostra o LOCAL do animal, não a espécie** — quem vai atender precisa saber
      para ONDE ir, e "Equino" não informa nada numa clínica de equinos.
      `AgendamentoController.INCLUDE_GLOBAL` passou a trazer `animal.local` (texto legado) e
      `animal.localizacao { id, nome }`; no front, `localDoAnimal()` (duplicado em
      `Agendamentos.tsx` e `SubModuloMinhaAgenda.tsx`) resolve catálogo → legado → null.
      Trocado na lista do dia (cards + tabela) das duas telas e nos dois seletores de animal
      da tela de agendamento (o `<select>` simples e o combobox de busca), onde o rótulo
      "(Equino)" virou "(SOCIEDADE HIPICA BRASILEIRA)".
- [x] **Adiantar PODE; reagendar para o passado NÃO.** As duas metades da regra:
      - `AGENDAMENTO_ANTECIPADO` foi REMOVIDO de `EvolucaoController.criar` (e com ele a
        constante `TOLERANCIA_INICIO_MS` do controller). No front saíram os `disabled` do
        botão "Iniciar" (`Agendamentos.tsx`, `SubModuloMinhaAgenda.tsx`) e o `disabled` da
        opção do seletor "Agendamento vinculado" (`SubModuloEvolucao.tsx`) — o rótulo agora
        só INFORMA ("— adiantando" / "iniciar agora adianta o atendimento").
      - `AgendamentoController.atualizar` ganhou o mesmo `DATA_PASSADA` que o `criar` já
        tinha: era o furo por onde o "Editar" da Minha Agenda movia um agendamento para
        trás do relógio. Só dispara quando a data MUDA — o formulário reenvia a data
        original ao corrigir só o título, e bloquear ali travaria a correção, não o
        reagendamento.
      ⚠️ `agendamentoAntecipado()` (`utils/dateUtils.ts`) NÃO bloqueia mais nada: usar só
      para informar. Para "já passou?" existe `dataHoraNoPassado()`, com a mesma tolerância
      de 1 min do backend.

---

# Atualizado em: 2026-07-29 (Evolução: assumir SÓ a de outro profissional c/ e-mail+WhatsApp, própria aberta continua bloqueando, paralelo por decisão (409) e proibição de antecipar agendamento)
---

### Sessão 2026-07-29 — Evolução: assumir, atendimento em paralelo e fim da antecipação
- [x] **Assumir evolução (mesma lógica da agenda)** — `PATCH /clinica/evolucoes/:id/assumir`
      (`EvolucaoController.assumir`): qualquer profissional com `atendimento.evolucoes.editar`
      (QUALQUER nível) + acesso ao animal + escopo clínico puxa para si uma evolução
      EM_ANDAMENTO de outro. NÃO passa por `podeOperarRegistro` — é um "puxar para si", não
      a edição do registro alheio (idêntico ao `AgendamentoController.assumir`). Grava
      `veterinarioId`/`modificadoPorId`/`dataModificacao` + AuditLog `EVOLUCAO_ASSUMIDA`.
      **Só evolução de OUTRO profissional, independentemente do paciente** — a própria não
      se assume (400 `EVOLUCAO_JA_MINHA`; o caminho dela é editar/finalizar/cancelar).
- [x] **Comunicação entre profissionais** — `notificarEvolucao()` (espelho de
      `notificarTransferencia` da agenda): e-mail (`emailService.enviarTransferenciaEvolucao`)
      + WhatsApp pela instância da clínica com fallback no provider legado. Dois modos:
      `ASSUMIDA` (perdeu a evolução) e `PARALELA` (outro abriu evolução para o mesmo
      paciente; a dele continua com ele). Fire-and-forget — falha de notificação nunca
      derruba a operação clínica.
- [x] **Evolução em andamento: bloqueia se for MINHA, decide se for de OUTRO** — regra por
      AUTOR, não por animal:
      - **própria** aberta → `criar` responde **400** `EVOLUCAO_EM_ANDAMENTO` como sempre
        respondeu (finalize/cancele antes) e `confirmarConcorrente` NÃO derruba o bloqueio;
        no front o botão "Nova Evolução" volta a ficar `disabled` com ícone `Lock`.
      - **de outro profissional** → **409** `EVOLUCAO_EM_ANDAMENTO` com `evolucaoAberta
        { id, atendimentoNumero, dataInicio, especialidade, titulo, veterinarioId,
        veterinarioNome }`; o usuário decide no `EvolucaoAbertaModal` (SubModuloEvolucao):
        **assumir** ou **criar uma nova** — que reenvia o POST com
        `confirmarConcorrente: true`.
      `criar` lê TODAS as abertas do animal (`findMany`) porque pode haver mais de uma:
      acha a minha → 400; senão usa a mais recente de outro → 409. O 409 também é tratado
      no salvar/finalizar (corrida ou lista filtrada), preservando o texto digitado.
      `formularioVisivel` passou a governar formulário × botão (antes, com evolução aberta,
      a tela ficava SEM os dois).
- [x] **Atendimento ativo do shell = o MEU** — com duas evoluções abertas, `carregarEvolucoes`
      prefere a do próprio usuário no `onEvolucaoChange`. É a ela que prescrição, vacina e
      exames do shell se vinculam — sem isso o item clínico cairia na evolução do outro.
- [x] ~~**Agendamento não se antecipa**~~ — **REVERTIDO em 2026-07-30, ver abaixo.** A regra
      era: `EvolucaoController.criar` recusava 400 `AGENDAMENTO_ANTECIPADO` quando
      `agendamento.dataHora` ainda não tinha chegado, e atender antes exigia REAGENDAR.
      Exigir um reagendamento para atender 20 min mais cedo era atrito puro — o paciente
      chega antes, o profissional vaga, e a agenda não deve atrapalhar isso.
- [ ] Prescrição/vacina/exame criados numa evolução assumida seguem com o `veterinarioId`
      de quem os lançou (correto), mas a tela não sinaliza que o condutor da evolução mudou —
      avaliar um marcador de "assumida por" no histórico.

---

### Sessão 2026-07-28 (parte 6) — Agenda: reagendar, transferir e assumir
- [x] **Reagendar virou agenda de verdade** — o `datetime-local` do modal saiu; agora é o
      mesmo `CalendarioInterativo` da tela + grade de horários livres do profissional
      naquele dia. `CalendarioInterativo` ganhou `minDate` (dias passados riscados e
      desabilitados) e a grade descarta horário que já passou quando o dia é hoje.
      A ocupação é buscada para o DIA ESCOLHIDO (não o da tela) e o próprio agendamento
      que está sendo movido é descontado — por isso `ocupacaoDoDia` passou a devolver `id`.
- [x] **Nada de agendar no passado** — `AgendamentoController.criar` responde 400
      `DATA_PASSADA` (tolerância de 1 min). Vale para agendamento novo E reagendamento.
- [x] **Status `TRANSFERIDO`** — reagendar não "cancela" mais: o registro antigo fica
      TRANSFERIDO com a observação `Reagendado para dd/mm/aaaa às HH:MM`. `STATUS_LIVRES`
      (`CANCELADO` + `TRANSFERIDO`) é quem define "não ocupa mais a grade" — existe no
      controller e espelhado no front; TODA query de ocupação usa `notIn: STATUS_LIVRES`.
      Se `handleReagendar` falhar depois de liberar o horário, o status original é
      restaurado (senão o paciente ficava sem agendamento nenhum).
- [x] **Transferir deixou de ser exclusivo do gestor** — o profissional transfere a
      agenda DELE (`transferirDia` com `deVetId` = ele) e os atendimentos DELE
      (`atualizar` com troca de `veterinarioId`); o gestor segue movendo os de qualquer um.
- [x] **Assumir atendimento** — `PATCH /clinica/agendamentos/:id/assumir`: qualquer
      VETERINÁRIO puxa para si o atendimento de outro vet da equipe (não passa por
      `podeOperarAgendamento` de propósito — é um "puxar", não editar o alheio). Valida
      acesso ao animal, conflito de horário e expediente de quem assume.
- [x] **Notificação de e-mail + WhatsApp** — `notificarTransferencia()` avisa quem
      RECEBEU a transferência (modo `RECEBIDO`) e, no assumir, quem PERDEU o atendimento
      (modo `ASSUMIDO`, texto próprio). Template `emailService.enviarTransferenciaAgenda`
      + WhatsApp pela instância da clínica (`whatsappService.sendMessage`), com fallback
      no provider legado. Fire-and-forget: falha de notificação nunca derruba a operação.
- [x] **Lista de pacientes carregava ANTES do contexto (1º login)** — `SelectedAnimalContext`
      disparava `/animais` junto com a resolução do contexto ativo. No primeiro login
      (localStorage vazio) a chamada saía SEM `x-empresa-id`, o backend caía no vínculo
      mais recente — a OUTRA empresa — e o paciente selecionado nascia de lá; quando o
      contexto resolvia para a empresa do gestor, esse paciente respondia 403 e o card do
      animal sumia no Atendimento. Agora o `loadAnimais` espera `useEmpresa().loading`
      terminar (MESMO gate que o `usePermissoes` já tinha, e pelo mesmo motivo) e
      recarrega quando o contexto muda. `Atendimento` ainda refaz a seleção
      (`refreshSelectedAnimal`) se o paciente selecionado vier 403 — auto-cura em vez de
      card vazio. REGRA: nenhum fetch escopado por empresa antes de `empresaLoading=false`.
- [x] **URL com id de animal de outra empresa** — o id do paciente vive TAMBÉM na rota
      (`/clinica/evolucao/:animalId`, `/dieta/:animalId`, `/exames/:animalId`…), e o
      `animalIdParam` VENCE o `selectedAnimal`. Resultado: a tela mostrava o paciente do
      contexto ativo mas TODAS as chamadas iam para o id antigo (403 em cascata).
      `ROTA_COM_ANIMAL` (EmpresaContext) cobre todas essas rotas na troca de contexto, e
      `Atendimento.carregarAnimal` larga o id da URL quando ele responde 403 — cai na
      rota sem id, que usa o paciente do contexto ativo. Cobre também o caso que a troca
      de contexto não pega: sessão restaurada com a URL antiga.
- [x] **"Erro ao carregar evoluções" era a armadilha #23** — `res.data.dados` sem guard
      num GET que pode voltar 403 (`data` null) estourava TypeError e caía no catch,
      exibindo erro de carga para um caso de permissão. Corrigido em `SubModuloEvolucao`.
- [x] **Paciente selecionado é POR EMPRESA** — `trocarContexto` mantinha
      `lastSelectedAnimalId` (e a rota `/animal/:id`) ao trocar de empresa: a empresa
      nova abria as telas com um paciente a que não tem acesso e TUDO respondia 403
      (animais, evoluções, histórico, logo). O backend estava certo — era isolamento
      multi-tenant funcionando. Agora `trocarContexto` limpa a seleção e sai da rota
      presa a um animal; `SelectedAnimalContext` descarta a chave quando o animal não
      está na lista do contexto; e `AnimalDetail` mostra "Paciente de outra empresa"
      (GET 403 → `res.data` null) em vez de tela vazia com o console cheio de 403.
- [x] **Erro na superfície da ação (Agenda)** — o `InlineError` único no topo (colado no
      botão Voltar) foi quebrado em quatro escopos: `erroInline` (carga da página),
      `erroGrade` (clique no slot / modal de novo agendamento), `erroLista` (ações da
      lista do dia: assumir, iniciar, status) e `erroModal` (reagendar, trocar
      profissional, transferir dia, voz/IA). Cada um é limpo ao iniciar a ação e ao
      fechar o modal. Padrão para telas novas: erro de ação pertence à superfície que
      a disparou — no topo o usuário não vê o retorno do que acabou de clicar.
- [x] **`LocalTrabalhoFields`** — o formulário de local de trabalho virou componente
      único exportado por `UsuarioFormModal`, usado pelo Incluir/Editar Membro E pelo
      Cadastro Pessoal. Antes eram duas cópias com larguras e classes diferentes; agora
      layout, fontes e textos são os mesmos por construção.

---

### Sessão 2026-07-28 (parte 3) — Tempo de consulta por especialidade na grade
- [x] **Tempo de consulta por especialidade** (migration `20260804000000`) —
      `MembroLocalTrabalho.temposConsulta` (JSONB `{ especialidadeId: minutos }`),
      `AgendamentoClinico.especialidadeId` + `duracaoMin`. Campo no card
      "Locais de trabalho" (`UsuarioFormModal`), obrigatório por especialidade.
      A grade da Agenda passou a ser gerada pelo tempo da especialidade
      selecionada, e a ocupação virou INTERVALO. Ver seção 15.
- [x] **Backfill dos tempos** (migration `20260805000000`) — a migration anterior deixou
      `tempos_consulta` vazia, então TODO local cadastrado antes dela ficou com
      especialidade e sem tempo: a Agenda não montava a grade por especialidade nem
      exibia os chips, e só voltaria a funcionar se alguém reabrisse cada membro à mão.
      Preenche 60 min (o passo que a Agenda já usava — zero mudança de comportamento).
      LIÇÃO: coluna nova que a UI passa a exigir precisa de backfill na mesma leva.
- [x] **Filtro por especialidade na Agenda** — restringe os profissionais listados E
      fixa a especialidade de todos (o filtro vence a escolha por linha), então as
      grades saem no tempo daquela especialidade. Desabilitado quando nenhuma está
      configurada. O catálogo `/especialidades` é buscado junto de `/equipes/membros`
      para o nome nunca cair em "Especialidade #id".
- [x] **Expediente Ativo por linha** — tabela reformulada (profissional × local ×
      especialidade), função por extenso, dias+horário numa coluna só, coluna de
      local, e filtros de local/turno/faixa de horário. Ver seção 15.
- [x] ⚠️ `frontend/tsconfig.json` tem `"files": []` + project references: rodar
      `npx tsc --noEmit` na raiz do frontend **não checa nada** (sai 0 sempre).
      O typecheck real é `npx tsc -b --noEmit` (ou `npm run build`, que faz `tsc &&
      vite build`) — é por isso que o dev roda `vite build` direto, sem o `tsc` na
      frente. Os ~64 erros TS6133/TS6196 de código morto (import/variável/função/
      componente nunca lidos) catalogados em `~27` arquivos foram **limpos em
      2026-08-17/18** — imports órfãos removidos, `useState` sem leitor reduzido a
      `const [, setX]`, e os componentes inteiros sem nenhum call site
      (`ModalNovoAgendamento` em `AnimalDetail.tsx`, `ExamCheckList` e
      `sugerirTipoAmostra` em `SubModuloExames.tsx`, `ViewPrescricaoModal` em
      `SubModuloPrescricao.tsx`, `TabProprietarios` e `handleAlterarCargo`(x2) em
      `ControleAcesso.tsx`, `navLinkBadge`/`isGeralActive` em `Sidebar.tsx`)
      apagados por inteiro. `npx tsc -b --noEmit` ficou limpo NESSA categoria.
      A EXCEÇÃO que existia aqui (`podeVerMedicamentos`/`podeVerProcedimentos`,
      código morto ligado a uma decisão de produto em aberto) foi resolvida na
      Sessão 2026-09-02 — ver o item correspondente na sessão 2026-07-31, marcado
      concluído.
- [x] 🏷️ **`grupo2corrigir` — FECHADO em 2026-08-11.** Eram erros de TIPO que sobraram
      após a limpeza de código morto; a investigação, item a item, achou UM bug real
      e cinco casos de dívida de tipo pura (comportamento já correto, tipo é que
      mentia). `npx tsc -b --noEmit` limpo nesses 6 pontos (só sobra a exceção
      deliberada de `Sidebar.tsx` já registrada acima).
      - `components/ModalNovoFornecedor.tsx` — o `onClick={handleSalvar}` do botão
        Salvar passava o `MouseEvent` no lugar de `force`, então TODO clique já ia
        com `force: true` e o aviso de "cadastro inativo duplicado" nunca aparecia
        (bypass silencioso). Corrigido para `onClick={() => handleSalvar()}` **e**
        o modal de duplicata ganhou uma opção que não existia: **"Ativar cadastro
        existente"** (`PATCH /cadastro/fornecedores/:id/toggle`, só reaparece se o
        perfil tiver `cadastro.fornecedor.ativar` — padrão de nunca oferecer botão
        que vai 403) ao lado do "Criar novo mesmo assim" que já havia.
      - `pages/Atendimento.tsx` — `peso` era só o primeiro de CINCO campos opcionais
        (`peso`, `baia`, `especie`, `raca`, além do `photoUrl` que já era tratado)
        que o objeto passado a `SubModuloPrescricao` deixava `undefined` onde
        `PrintAnimalPrescricao` exige `null` explícito. Normalizados todos com
        `?? null` de uma vez. Comportamento não mudou — a impressão já tratava os
        dois como "sem valor" — mas corrigir só `peso` teria revelado `baia` a
        seguir, e depois `especie`/`raca`, um de cada vez.
      - `pages/ExameCompra.tsx` — **bug real, não só de tipo.** `setSelectedAnimal`
        (do `SelectedAnimalContext`) NÃO é o setter nativo do `useState`, é um
        wrapper que também grava `lastSelectedAnimalId` no `localStorage`; só
        aceita um valor direto, nunca uma função. O código chamava
        `setSelectedAnimal(prev => ...)` copiando o padrão (correto) de
        `Atendimento.tsx`/`Dieta.tsx`, que usam `setAnimal` — um `useState` de
        verdade. Na prática, a função virava o argumento `animal` do wrapper;
        `animal.id.toString()` estourava (`animal` era uma função, não um objeto)
        toda vez que a tela buscava a logo da empresa para o laudo de compra —
        engolido em silêncio pelo `.catch(() => {})` seguinte. Corrigido com uma
        `selectedAnimalRef` (sincronizada por `useEffect`) que preserva a proteção
        original contra corrida (usuário troca de animal com a busca em voo) sem
        depender da forma funcional que o contexto não suporta.
      - `pages/MapaAtendimento.tsx` — tipo desatualizado, não bug: `executadas` e
        `pendentesOuAtrasadas` já existiam de verdade em
        `MapaAtendimentoController.resumo` (só ficam de fora no ramo de "nenhum
        animal no escopo do filtro", que zera tudo mesmo). A interface `ResumoData`
        só não sabia disso. Os dois campos entraram como opcionais no tipo do front.
      - `pages/SubModuloExames.tsx` — duas condições mortas (sempre `true`), sobra
        da extração da aba Compra para `pages/ExameCompra.tsx` (sessão 2026-08-02):
        `mainTab !== 'compra'` — `MainTab` nunca teve esse valor — e, dentro de
        `mainTab === 'laboratorial'`, um `mainTab !== 'imagem'` redundante (o
        TypeScript já sabia, ali dentro, que só podia ser `'laboratorial'`).
        Wrappers removidos, conteúdo interno intacto.
      - `services/relatorioNutricional.service.ts` (FRONTEND, não o do backend) —
        **removido, não corrigido.** `git log --follow` mostrava um único commit
        (`MYSQL_Relatorio`); usava `require('@prisma/client')` + `new
        PrismaClient()` dentro do bundle do navegador (Prisma Client não roda em
        browser) com SQL em sintaxe MySQL (`?`, `JSON_OBJECTAGG`) num projeto
        Postgres. Busca no repositório inteiro não achou NENHUM import dele, no
        front ou no back. A versão real, em uso, é
        `backend/src/services/relatorioNutricional.service.js`, chamada por
        `backend/src/controllers/relatorio.controller.js` — essa não mudou.
        Anotar o tipo do `animalId` teria legitimado código morto do banco errado.
- [ ] `HORARIOS` (24 slots de 1h) ainda é usado no heatmap do mês
      (`PARCIAL` quando `count < HORARIOS.length`) — a densidade do calendário
      não considera o passo real da grade. Revisar quando o mês virar por passo.

---

# Atualizado em: 2026-07-25 (Vacina com a lógica da Prescrição: SALVA→FINALIZADA→EXECUTADA — fatura e estoque só na Execução de Prescrição/plantão)
---

# Atualizado em: 2026-07-25 (Vacina no Atendimento com ciclo SALVA→FINALIZADA, igual a Exames/Encaminhamento — migration 20260729000000)
