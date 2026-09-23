---
paths:
  - "**/prisma*"
  - "backend/prisma/**"
  - "**/tenanc*"
  - "**/tenantDb.js"
  - "**/cron*"
  - "**/Cron*"
  - "**/auth*"
  - "**/Auth*"
  - "**/sessionTokens.js"
  - "**/mfaService.js"
  - "**/fusoEmpresa.js"
  - "backend/src/storage/**"
  - "backend/src/server.ts"
  - "**/concorrenciaRegistro.js"
  - "**/eventosTempoReal.js"
  - "**/crmv*"
  - "**/emailService.js"
  - "**/email.js"
  - "**/whatsapp*"
  - "**/Whatsapp*"
  - "**/Evolution*"
  - "**/*Monitoracao*"
  - "**/*Seguranca*"
  - "**/dateUtils.ts"
---

# Histórico de decisões — Plataforma (RLS, crons, sessao, fuso, concorrencia)

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-18 (parte 2) (🔴 **O JOB DO CRMV SÓ TRAZIA NÚMERO DE 5 DÍGITOS —
#   e, desde alguma mudança do SISCAD, não trazia mais NADA.** Mais 4 pedidos de tela.
#   1. 🔴 **CRMV, defeito 1 — A INSCRIÇÃO IA SEM ZERO-PADDING.** A busca do SISCAD é
#      "Idêntico" e compara contra o número gravado com **5 dígitos**: `1000` NÃO casa
#      com `01000`. O próprio site faz esse padding antes de consultar
#      (`searchMethodMask` em /paginas/busca: `("00000"+val).slice(-5)`), e o scraper
#      mandava o decimal cru. Resultado: 1..9999 devolvia "Sua pesquisa não retornou
#      nenhum resultado" e o índice só se enchia de 10000 em diante — quando o número
#      cru já tem 5 dígitos e casa POR ACIDENTE.
#      **MEDIDO no banco**: 11.750 linhas, **TODAS de 5 dígitos**, menor 10000 e maior
#      23768, numa varredura que percorre 1..25000. Zero abaixo de 10000 com 85% de
#      densidade acima é assinatura de problema de FORMATO, não de realidade.
#      ✅ **PROVADO AO VIVO** contra o SISCAD, com o CÓDIGO REAL corrigido: `00001` →
#      ALUISIO PEREIRA DE FIGUEIREDO, `01000` → DIANA ASSIS DE OLIVEIRA, `02000` →
#      LUIZ CARLOS REBELLO GOMES, `07500` → DANYELLE MARCHIORI MOREIRA, `09999` →
#      FLAVIA BORGES TAVARES — **todos ATIVOS e todos fora do índice**; e os mesmos
#      números SEM padding voltam "nenhum resultado". Era ~40% da faixa saindo em silêncio.
#   2. 🔴 **CRMV, defeito 2 — O SISCAD PASSOU A EXIGIR TOKEN DE SESSÃO.** Toda chamada
#      responde `{"type":"error","message":"Sessão de consulta inválida. Recarregue a
#      página...","challengeToken":"..."}`. O job, então, trazia **ZERO** — e terminava
#      "com sucesso e sem trabalho", porque `extrairRegistroAtivo` lê erro como "não
#      existe esse número". O único freio era a guarda de "voltou vazio" do diff.
#      A consulta agora leva `?consulta_challenge=<token>&website_url=` — o token nasce
#      no DOM (`#consulta_challenge`) e é **RENOVADO a cada resposta** (o
#      `challengeToken` devolvido vale para a chamada SEGUINTE, inclusive quando a
#      resposta é erro). `website_url` é o HONEYPOT do formulário e vai VAZIO.
#      ⚠️ Sessão que expira no meio → reabre a página e tenta UMA vez; persistindo, a
#      consulta é marcada como **FALHA**, não como "número inexistente".
#   3. ⚠️ **VARREDURA COM FALHA NÃO REMOVE NADA** (`varrerUF` devolve `confiavel`).
#      O número que não pôde ser consultado é, no resultado, IDÊNTICO ao que não existe
#      — e a remoção é a única parte do diff que destrói dado. Sem essa guarda, uma
#      varredura 90% quebrada apagaria 90% do índice, em silêncio. A guarda antiga só
#      cobria o "voltou TOTALMENTE vazio". E `extrairRegistroAtivo` passou a conferir
#      que a inscrição DEVOLVIDA é a PEDIDA: sem isso, um dia em que o filtro deixasse
#      de ser exato gravaria o NOME de um veterinário sob o NÚMERO de outro.
#      **SEM MIGRATION** — `numero` continua `Int` sem padding no banco (o padding é só
#      da CONSULTA), e `crmvService.validarCRMV` faz `Number(numeroStr)`, então
#      "CRMV-RJ 1000" casa com a linha 1000. `migrate status`: **203, banco em dia**.
#      Gate novo `__tests__/crmvScraperInscricao.test.js` (22 casos) que EXECUTA o
#      código com um `page` falso e confere a URL — varredura de texto aprovaria um
#      `padStart` que existe e não é usado. ✅ **Verificado que REPROVA**: removidos o
#      padding e o challenge, **10 dos 22 falharam**.
#   4. **RAÇA E PELAGEM PASSARAM A ACEITAR DIGITAÇÃO** (a pedido) — `DropdownSelect`
#      ganhou `buscavel`, que troca o gatilho por um `<input>` e FILTRA ao digitar (sem
#      acento/caixa), com setas/Enter/Esc. Sem a prop, o componente é o de sempre —
#      nenhum dos outros 3 chamadores muda de comportamento.
#      ⚠️ **Texto livre é DESCARTADO no blur**: o valor sai sempre de uma opção da
#      lista. Aceitar o digitado gravaria raça fora do catálogo — e, na raça, o
#      chamador converte nome → id casando pelo nome EXATO, então viraria id nulo em
#      silêncio. ⚠️ Enquanto o texto for o RÓTULO do já escolhido ele NÃO conta como
#      busca (senão reabrir depois de escolher diria "nenhum resultado" para o próprio
#      item — a armadilha do combo de animal da Agenda). ⚠️ `onMouseDown` +
#      `preventDefault` no painel (o blur fecharia a lista antes do clique) e abertura
#      por `onClick` ALÉM de `onFocus` (focus não dispara em campo já focado).
#      ⚠️ `Enter` faz `preventDefault` SEMPRE: o campo vive dentro de um `<form>` e o
#      Enter solto submeteria o cadastro no meio da escolha.
#   5. **SAIU a faixa "Proprietário não encontrado, encaminhado e-mail com as
#      informações de acesso."** (a pedido). Só o AVISO — o comportamento não mudou:
#      cliente novo segue nascendo com login e recebendo o e-mail de boas-vindas. A
#      faixa do `proprietarioExistente === null` FICA (ali ainda não se sabe se o
#      e-mail existe, e é ela que explica as duas saídas).
#   6. 🔴 **RESET DE SENHA PELO E-MAIL DEIXOU DE CAIR NA TELA DE TROCA OBRIGATÓRIA**
#      (a pedido). `AuthController.resetPassword` não limpava `mustChangePassword`:
#      quem tinha senha TEMPORÁRIA (toda conta nasce assim) escolhia a própria senha
#      pelo link e, no login seguinte, o `ProtectedRoute` ainda o mandava para
#      /alterar-senha-obrigatoria — pedindo que trocasse a senha que acabara de
#      definir. E lá `alterarSenha` recusa senha REUTILIZADA: a recém-escolhida era
#      justamente a barrada, e a pessoa ficava PRESA. A troca obrigatória existe para a
#      senha deixar de ser a que um TERCEIRO conhece; definir senha por link enviado ao
#      próprio e-mail já é isso.
#   7. **"Esqueci minha senha": enviado o pedido, o formulário SAI de cena** e ficam a
#      mensagem "Se o e-mail existir, será enviado um link de recuperação." + **dois
#      botões, Cancelar e Voltar à Tela de Login** (a pedido).
#      ⚠️ O "Enviar e-mail" continuar ali convidava a REENVIAR, e cada reenvio gera um
#      token novo que INVALIDA o link recém-mandado (`resetPasswordToken` guarda um só).
#      ⚠️ "Voltar à Tela de Login" **NÃO navega para '/login'**: a URL pode carregar
#      `returnUrl` (o deep link de aprovação de vínculo), e trocá-la faria a pessoa
#      perder o destino sem nada explicando. Ele fecha o modal e limpa o formulário.
#      ⚠️ A mensagem é a MESMA exista ou não o e-mail (o backend responde 200 genérico)
#      — confirmar "não há conta" faria da tela um verificador de cadastro.
#      ⚠️ `pages/ForgotPassword.tsx` (a TELA de recuperação) continua **ÓRFÃ**: não está
#      roteada em `App.tsx` e o único caminho é este modal. Não foi removida aqui.
#   **NENHUMA MIGRATION NESTA LEVA.** Suíte: **1135**; `tsc --noEmit` (backend),
#   `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

# Atualizado em: 2026-09-05 (parte 4) (🔴 CONTROLE DE CONCORRÊNCIA DE EDIÇÃO —
#   "quem salva por último vence" DEIXOU DE EXISTIR em evolução e agendamento.
#   Dois profissionais com o MESMO registro aberto se sobrescreviam em silêncio: o
#   texto do primeiro simplesmente deixava de existir, e nada no sistema acusava.
#   ⚠️ A AUTORIA (`podeOperarRegistro`) NUNCA cobriu isso — ela responde "posso
#   operar o registro DESTA pessoa?", e é VERDADEIRA para os dois gestores da mesma
#   clínica editando a mesma evolução. Autoria é AUTORIZAÇÃO; concorrência é
#   INTEGRIDADE, e são camadas diferentes.
#   1. 🔴 **TRAVA OTIMISTA** — coluna `versao` (evolução e agendamento). A tela
#      devolve a versão que LEU e o UPDATE é condicionado a ela
#      (`WHERE id = $1 AND versao = $2`): gravação sobre dado velho afeta 0 linhas
#      e vira **409**, nunca overwrite calado. Fonte única em
#      `lib/concorrenciaRegistro.js`.
#      ⚠️ **A GARANTIA É DO BANCO, NUNCA DA TELA.** Navegador offline, aba
#      congelada, evento perdido ou front desatualizado batem todos na mesma
#      cláusula WHERE. Nunca mover esta decisão para o cliente.
#      ⚠️ Versão AUSENTE no corpo NÃO é conflito: cliente antigo segue funcionando,
#      só sem a proteção. Endurecer quebraria toda chamada existente de uma vez.
#   2. 🔴 **ASSUMIR VIROU ATÔMICO.** Era `SELECT` + `UPDATE` cego: B e C liam o
#      mesmo `veterinarioId` e os DOIS gravavam com 200 — o último vencia e o outro
#      achava que tinha assumido. Agora a cláusula exige a versão E o editor
#      anterior; um vence, o outro leva 409. Vale para evolução E agendamento.
#   3. **AUTOR × EDITOR separados** — `EvolucaoClinica.autorId` (novo, imutável).
#      `veterinarioId` continua sendo o RESPONSÁVEL ATUAL (é ele que `assumir`
#      transfere) e os ~47 pontos que o leem não mudaram; sem a coluna nova,
#      assumir APAGAVA quem criou o atendimento.
#   4. **TEMPO REAL por SSE** (`GET /api/eventos/stream`, `lib/eventosTempoReal.js`).
#      Quem perde o registro entra em somente leitura NA HORA, com o texto
#      digitado preservado na tela. SSE e não WebSocket: a auth já é por cookie
#      HttpOnly (o `EventSource` mesma-origem o manda sozinho), o fluxo é de mão
#      única e não entra dependência nova. ⚠️ O evento é CONVENIÊNCIA — a
#      integridade não depende dele.
#   5. **CONFLITO VAI PARA A AUDITORIA** — categoria nova `CONFLITO_EDICAO`: a
#      TENTATIVA recusada fica registrada. Sem ela, o único rastro da quase-perda
#      seria o 409 na tela de quem o levou.
#   🔴 **MIGRATION GERADA, NÃO APLICADA** — `20260922000000_concorrencia_edicao`.
#   Suíte: 493 (+27). Detalhes e armadilhas na §12, sessão 2026-09-05 (parte 4).)
---

### Sessão 2026-09-05 (parte 4) — Concorrência de edição: fim do "último a salvar vence"

> 🔴 **MIGRATION GERADA, NÃO APLICADA** —
> `prisma/migrations/20260922000000_concorrencia_edicao/`: `versao INT NOT NULL
> DEFAULT 1` em `tb_evolucoes_clinicas` e `tb_agendamentos_clinicos`, `autor_id INT`
> (sem FK) na primeira, backfill `autor_id = "veterinarioId"` e índice. Sem RLS novo
> — as duas tabelas já estão no tenant plane. Aplicar com
> `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy` + `npx prisma
> generate`.
> ⚠️ **FUNCIONA ANTES DO `generate`**: `versao`/`autor_id` são lidas e gravadas por
> SQL CRU (`lib/concorrenciaRegistro.js`), como `animalInativo` e
> `agendamentoAssumido` — no Windows o generate falha com o backend rodando (§11).
> O que NÃO funciona antes da MIGRATION é a proteção: `anexarControle` cai em
> `versao: 1` e a tela grava como gravava (sem trava, não quebrada).

- [x] 🔴 **O DEFEITO: dois profissionais no mesmo registro se sobrescreviam em
      silêncio.** Médico A abre a evolução, B abre a mesma e salva, A salva depois —
      o texto de B desaparecia e nada acusava. Em prontuário isso é perda de dado
      clínico, não um detalhe de UX.
      ⚠️ **A AUTORIA NÃO COBRIA ISSO, e é importante entender por quê**:
      `podeOperarRegistro` responde "posso operar o registro DESTA pessoa?" e é
      VERDADEIRA para os dois gestores da mesma clínica, ou para quem tem nível
      EQUIPE/FULL. **Autoria é AUTORIZAÇÃO; concorrência é INTEGRIDADE.** São
      camadas distintas e a segunda não existia.
- [x] 🔴 **TRAVA OTIMISTA (`versao`) — fonte única `lib/concorrenciaRegistro.js`.**
      A tela devolve a versão que LEU; o UPDATE é condicionado a ela
      (`WHERE id = $1 AND versao = $2`) e incrementa no MESMO comando. Concorrente
      partindo da mesma versão não acha linha para atualizar → 409.
      ⚠️ **O incremento é parte do MESMO UPDATE.** Gravar a versão num comando
      separado abre uma janela em que a linha já mudou e a versão ainda não — e
      nessa janela um terceiro passa pela checagem com a versão velha.
      ⚠️ **`reservarVersao` é o PRIMEIRO passo da transaction**, antes do `update`
      tipado do Prisma (que existe só para montar a resposta com o `include`).
      Rodando depois, a escrita já aconteceu e o rollback vira a única defesa.
      ⚠️ **Versão ausente no corpo NÃO é conflito** — cliente antigo continua
      funcionando, só sem proteção. Mas ela INCREMENTA mesmo assim, para que quem
      declarou versão veja o conflito. Endurecer isso quebraria toda chamada
      existente de uma vez, sem aviso nenhum ao usuário.
- [x] 🔴 **ASSUMIR DEIXOU DE SER `SELECT` + `UPDATE` CEGO.** Era a corrida clássica:
      B e C liam o mesmo `veterinarioId` e os DOIS gravavam com 200 — o último a
      commitar ficava com o registro e o outro recebia sucesso sobre uma assunção
      que não aconteceu. `assumirComLock` condiciona a versão E o editor anterior.
      ⚠️ **`IS NOT DISTINCT FROM`, nunca `=`**, na comparação do editor anterior:
      `NULL = NULL` é NULL no Postgres, e com `=` assumir um agendamento "Não
      atribuído" falharia SEMPRE. Há teste para esse caso.
      ⚠️ Aplicado nos DOIS: `EvolucaoController.assumir` e
      `AgendamentoController.assumir`.
- [x] **AUTOR × EDITOR: `EvolucaoClinica.autorId`.** `veterinarioId` era as duas
      coisas ao mesmo tempo, e `assumir` o sobrescrevia — ou seja, assumir APAGAVA
      quem criou o atendimento.
      ⚠️ **`veterinarioId` NÃO mudou de significado**: continua sendo o EDITOR/
      RESPONSÁVEL atual, que é o que escopo, autoria e agenda já esperam. A coluna
      nova só acrescenta o que se perdia — nenhum dos ~47 leitores foi tocado.
      ⚠️ Sem FK (como `assumido_de_id`): com `SetNull`, excluir a conta do
      profissional APAGARIA a autoria do prontuário dele.
      ⚠️ O backfill NÃO reconstrói autoria de evolução já assumida a partir do
      AuditLog: a trilha existe e é consultável, mas virar coluna faria o sistema
      AFIRMAR uma autoria derivada por heurística.
- [x] **TEMPO REAL POR SSE** — `lib/eventosTempoReal.js` + `GET /api/eventos/stream`.
      Quem perde o registro recebe o evento e a tela entra em somente leitura na
      hora, em vez de aceitar mais digitação de um texto que o backend já recusa.
      🔴 **POR QUE SSE E NÃO WEBSOCKET**: (1) a auth já é por COOKIE HttpOnly (§14) e
      o `EventSource` mesma-origem o manda sozinho — WebSocket exigiria handshake de
      auth próprio (token na query, justamente o que a §8 evita) e um segundo caminho
      de sessão a manter em sincronia; (2) o fluxo é de mão ÚNICA, e toda escrita
      continua sendo HTTP autenticado e auditado; (3) sem dependência nova e sem
      infra paralela — mesmo Express, mesmo proxy do Vite, mesmo túnel.
      ⚠️ **O EVENTO NUNCA É A FONTE DA VERDADE.** Ele é conveniência; a integridade
      é do banco. Há teste dedicado ao cenário "SSE caído": B assume, A não é
      avisado, A tenta salvar → 409 igual.
      ⚠️ **Publicar SEMPRE depois do commit e FORA da transaction** — antes dela, um
      rollback avisaria a tela de algo que não aconteceu; dentro, uma falha de
      entrega reverteria a operação clínica. Há gate estrutural para isso.
      ⚠️ `X-Accel-Buffering: no` + `res.flushHeaders()` são obrigatórios: sem eles o
      proxy segura os bytes e o aviso chega tarde demais para servir de aviso.
      ⚠️ **A rota é ISENTA do rate limit geral** (`limiter.skip`): a conexão fica
      aberta por minutos e o `EventSource` RECONECTA sozinho ao cair. Contada como
      requisição comum, um dia ruim de rede consumiria a cota e a tela levaria 429 no
      meio do atendimento. O que ela protege continua atrás do limite: toda ESCRITA
      passa pelas rotas normais.
      ⚠️ **STORE ÚNICO no front** (`useEventosTempoReal`), como `usePermissoes`: um
      `EventSource` por componente abriria N conexões por pessoa, e o teto de 5 abas
      do backend derrubaria as mais antigas — a própria tela ficaria surda.
- [x] 🔴 **VAZAMENTO DE TIMER encontrado pelo próprio teste** (jest acusou "open
      handle"): `encerrarTudo` chamava `res.end()` e deixava o `setInterval` do
      heartbeat VIVO, tentando escrever numa resposta morta a cada 25s para sempre.
      Corrigido com um `WeakMap` de encerradores + `unref()` no timer. Regressão
      travada por teste com timers falsos.
- [x] **A TELA NÃO FECHA E O TEXTO NÃO SOME** (`components/AvisoRegistroAssumido.tsx`).
      O conteúdo digitado fica visível para a pessoa copiar o que importa; o que sai
      é o Salvar (botão que só falha depois do clique é a armadilha 28-d). Saídas:
      **Atualizar** (recarrega o gravado) e **Descartar minhas alterações**.
      ⚠️ **NÃO existe merge automático de texto clínico.** Juntar dois textos sem
      regra de negócio explícita produz um prontuário que ninguém escreveu — e que
      leva a assinatura de alguém.
      ⚠️ O aviso é renderizado FORA do `<fieldset disabled>`: os botões dele
      precisam funcionar justamente quando o formulário está travado.
- [x] **PERDEU O REGISTRO × NUNCA TEVE PERMISSÃO são respostas DIFERENTES.** Quem
      DECLAROU uma versão tinha a evolução aberta e a perdeu no meio do trabalho:
      isso é concorrência (**409**, com quem assumiu e quando). Quem não declarou
      versão nunca teve o registro carregado: é permissão (**403**, texto de sempre
      — o cliente antigo não muda de comportamento).
- [x] **Auditoria: categoria nova `CONFLITO_EDICAO`** (`registrarConflitoEdicao`).
      ⚠️ **NÃO é `ACESSO_NEGADO`**: não faltou permissão, faltou atualidade do dado.
      Misturar os dois poluiria a tela de tentativas de invasão com casos de duas
      pessoas trabalhando juntas. Badge âmbar (aviso), não o rose de segurança.
      ⚠️ **Não grava o texto recusado.** Ele continua na TELA de quem o escreveu;
      duplicá-lo na trilha faria o AuditLog acumular versões de prontuário que
      ninguém assinou — e ele é um ledger, não um versionador.
      ⚠️ Fire-and-forget: falhar em REGISTRAR a recusa não pode alterá-la.
- [x] **ASSUMIR e ALTERAR já estavam auditados** por `TRANSFERENCIA` e `ALTERACAO`
      (com antes → depois e o dono de cada lado) — não foi preciso categoria nova
      para eles. O que faltava na trilha era só a TENTATIVA recusada.
- [x] **Testes**: `__tests__/concorrenciaEdicao.test.js` (28 casos) — trava otimista,
      corrida de assunção, autoria preservada, leitura, resposta 409, tempo real e
      o cenário completo com o SSE caído. Mais um GATE ESTRUTURAL que varre o código
      e reprova `assumir` sem `assumirComLock`, `atualizar` sem `reservarVersao` e
      `publicar` dentro de `$transaction`.
      ✅ **Verificado que REPROVA de verdade**: a cláusula de versão foi removida de
      propósito e 5 casos falharam. Suíte: **493 passando** (era 466); `tsc -b` +
      `vite build` limpos; smoke test do wire SSE (16 checagens, servidor HTTP real).
- [ ] **NÃO existe lock com TIMEOUT, e é decisão de produto.** Lock que expira exige
      heartbeat, e heartbeat que falha por rede instável libera o registro de quem
      AINDA está digitando — troca um problema raro (dois editando) por um pior (o
      lock some sozinho no meio do atendimento). Quem dá exclusividade é o par
      AUTORIZAÇÃO + INTEGRIDADE, e "assumir" é a transferência explícita, feita por
      uma pessoa. Se um dia for necessário, é aqui que a decisão precisa ser revista
      — junto de heartbeat, renovação e comportamento na reconexão.
- [ ] **PRESCRIÇÃO ainda não tem `versao`.** O caso é menos exposto (o gate de status
      `SALVO` já impede editar item de documento finalizado), mas dois profissionais
      no MESMO grupo em rascunho continuam podendo se sobrescrever. O caminho é o
      mesmo: coluna + entrada em `TABELAS` de `lib/concorrenciaRegistro.js`.
- [ ] **SSE é POR PROCESSO.** Em várias instâncias, cada uma só alcança as telas
      conectadas nela — e nesse dia o caminho é publicar por Redis pub/sub mantendo a
      MESMA interface (`publicar`), sem tocar nos controllers. Hoje o projeto roda em
      processo único (o `cronManager` depende disso).
- [ ] A tela do paciente (`AnimalDetail`) e as demais listas clínicas não assinam o
      canal — só Evolução e Agenda. Não é lacuna de integridade (o 409 continua
      valendo em todas), é ausência do aviso imediato.

---

# Atualizado em: 2026-08-23 (parte 4) (🔴 CRONS QUEBRADOS PELO RLS — o fechamento
#   automático de faturas NUNCA fechava no dia configurado, e mais 3 jobs falhavam em
#   silêncio pela MESMA causa. REGRA NOVA, a mais importante desta sessão: **dentro de
#   `paraCadaEmpresa`/`comTenant`, TUDO passa pelo `tx`.** O `prisma` global ali dentro
#   não é "o mesmo banco sem filtro" — é uma consulta que ENXERGA NADA, porque o cron
#   não roda sob `comEmpresa` (ele carimba o tenant à mão) e o RLS é fail-closed desde
#   a fase 7c. E o modo de falhar é o pior possível: zero linha, sem erro.
#   Cadeia real medida na Patyvet (dia de fechamento = 23, hoje é 23, 5 faturas ABERTAS):
#   `resolverConfigsFechamento` → `getEquipeIdsDoProprietario` via 0 animais → 0 equipes
#   → `[]` → o job caía no FALLBACK "último dia do mês" e não fechava nada. A
#   configuração estava no banco o tempo todo; ela é que estava invisível para quem
#   precisava lê-la. Mesmo se fechasse, `adicionarAssistenciaMensal` não achava o
#   `ProprietarioPerfil` (mensalista deixava de ser cobrado) e `recalcularTotal` somava
#   ZERO item e morria no UPDATE ("Record to update not found"). Os 3 pontos ganharam
#   parâmetro `db`/`tx` (default `prisma`, então a rota HTTP não muda).
#   Mesmo defeito corrigido em: `marcar_faturas_atrasadas` (`diaVencimentoDoProprietario`
#   voltava null → `continue` → NENHUMA fatura vencida era marcada),
#   `cancelar_orcamentos_vencidos` (`listarEscoposComValidade()` sem client → 0 escopos
#   → saía na 1ª linha; agora varre `empresasAtivas()` e lê a config sob `comTenant`) e
#   `cancelarDosesPrescricaoPerdidas` (`anexarAplicadaProprietario(prisma…)` devolvia
#   `false` para todos — o remédio aplicado em casa voltava a ocupar reserva de estoque).
#   🔴 SEGUNDO BUG, INDEPENDENTE E SEM RELAÇÃO COM RLS: `cancelar_agendamentos_nao_realizados`
#   falha TODA NOITE desde 2026-08-18 — `CANCELADO_AUTOMATICAMENTE` tem 25 caracteres e
#   `tb_agendamentos_clinicos.status` é VARCHAR(20) ("value too long"). Como o cron roda
#   em transação por empresa, o erro derruba o LOTE INTEIRO ("LOTE REVERTIDO (rollback)"
#   na Monitoração, visível nas execuções 88/94/96) e nenhum agendamento é encerrado —
#   ficam presos em AGENDADO/EM_ANDAMENTO ocupando a grade. ✅ MIGRATION APLICADA nesta
#   sessão (autorizada pelo usuário): `20260914000000_agendamento_status_30`
#   (VARCHAR(20)→(30); schema.prisma junto). Status novo: confira o comprimento antes.
#   ⚠️ `npx prisma generate` FALHOU com `EPERM` (lock do query engine no Windows, §11) e
#   NÃO foi refeito — não faz falta aqui: `@db.VarChar` é metadado de schema, o Client
#   não valida comprimento, quem recusava era o Postgres. Confirmado por UPDATE real
#   (revertido) com o client antigo. Rodar o generate na próxima parada do backend.
#   EXECUÇÃO MANUAL COM RASTRO ("set -x"), o que faltava para tudo isso ser visível:
#   `lib/cronTrace.js` (AsyncLocalStorage; `passo`/`grupo`/`comTrace`, inerte quando
#   ninguém liga), `cronManager.executarAgora(chave)` (uma execução por vez),
#   `npm run job -- <chave>` (`scripts/rodarJob.js`, `--list` mostra a agenda REAL do
#   banco) e `POST /api/monitoracao/agendas/:chave/executar` → botão "Executar agora" na
#   tela Configuração (`ModalExecucaoJob.tsx`). ⚠️ Gate ADMIN DA PLATAFORMA, mais estreito
#   que o resto daquela tela (que aceita GESTOR): o job varre TODAS as empresas ativas.
#   ⚠️ Roda a tarefa DE VERDADE — grava e dispara envio; não há simulação.
#   POR QUE O DIÁRIO NÃO BASTAVA: `reportarCron` só grava execução com TRABALHO ou ERRO,
#   então "hoje não é dia de fechar" não deixa rastro nenhum e fica idêntico a "o
#   servidor estava fora do ar". O trace registra a DECISÃO, não só o resultado.
#   `CRON_CLI=1` (guarda no fim de `server.ts`) carrega o módulo sem `app.listen` nem
#   `iniciarJobs` — é o que permite ao CLI disparar UM job sem tomar a porta 3001.
#   Suíte: 172 passando. Lixo conhecido: `auto_aceite`/`vinculos_provisorios` continuam
#   como linha em `CronAgenda` embora os jobs tenham sido removidos do código — não
#   aparecem na tela (ela lista `cronManager.listarJobs()`), só ocupam banco.
#   NA MESMA SESSÃO, pedido à parte: o campo **Fuso Horário SAIU da tela de
#   Configurações** (`CadastroEmpresa.tsx`) — era só leitura e não havia o que fazer
#   com ele ali. O `fusoLabel` saiu junto do `useConfiguracaoOperacional` (estado sem
#   consumidor), mas o backend segue devolvendo `fusoLabel` nas configurações: contrato
#   inalterado. O fuso continua valendo em tudo — ver §6.)
---

### Sessão 2026-08-23 (parte 4) — Crons: 4 jobs quebrados pelo RLS + execução manual com rastro
> ✅ **MIGRATION APLICADA** (autorizada nesta sessão) — `20260914000000_agendamento_status_30`
> (`ALTER COLUMN status TYPE VARCHAR(30)` em `tb_agendamentos_clinicos`). Era a única
> pendente: `prisma migrate status` acusava 171 migrations, 170 já aplicadas.
> ⚠️ `npx prisma generate` falhou com `EPERM` (lock do query engine — o problema de
> Windows da §11) e ficou por fazer. NÃO é bloqueio para esta mudança: `@db.VarChar` é
> metadado do schema, o Client não valida comprimento e quem recusava o valor era o
> Postgres. Verificado com um UPDATE real (em transação revertida) gravando
> `CANCELADO_AUTOMATICAMENTE` pelo client NÃO regenerado — aceito. Rodar o generate na
> próxima parada do backend, para o schema tipado acompanhar.

- [x] 🔴 **REGRA QUE ORIGINOU TODOS OS DEFEITOS DESTA SESSÃO — dentro de
      `paraCadaEmpresa`/`comTenant`, TUDO passa pelo `tx`.** O cron não roda sob
      `comEmpresa` (a extensão da fase 7b, que carimba o tenant sozinha nas requisições
      HTTP): ele carimba à mão, dentro da transação. Então toda função auxiliar chamada
      lá dentro que use o `prisma` GLOBAL chega ao banco **sem `app.empresa_id`** — e,
      com o RLS fail-closed da fase 7c, o resultado não é erro: é **ZERO LINHA**.
      Isso é pior que uma exceção. "Nenhuma equipe", "cliente sem perfil", "fatura sem
      item" e "o RLS escondeu tudo" produzem exatamente o mesmo valor de retorno, e o
      job segue adiante tomando a decisão errada em silêncio.
      Todos os pontos corrigidos ganharam parâmetro `db`/`tx` com **default `prisma`** —
      a rota HTTP não muda de comportamento; quem tem de passar o cliente é o cron.
- [x] **`fechamento_faturas` — nunca fechou no dia configurado.** Medido na Patyvet
      (empresa 59, `DIA_FIXO(23)`, 5 faturas ABERTA, no próprio dia 23): a cadeia era
      `resolverConfigsFechamento` → `getEquipeIdsDoProprietario` → **0 animais** → 0
      equipes → `[]` → o job caía no FALLBACK "último dia do mês" e não fechava nada.
      A `EmpresaConfiguracao` estava no banco o tempo todo; ela é que estava invisível.
      Mais dois pontos na mesma função, que só apareceriam DEPOIS de o primeiro ser
      corrigido: `adicionarAssistenciaMensal` não achava o `ProprietarioPerfil` (o
      mensalista deixava de ser cobrado no fechamento, sem erro nenhum — "não achei
      perfil" e "não é mensalista" dão o mesmo `return false`) e `recalcularTotal`
      somava ZERO item e morria no UPDATE (`P2025 Record to update not found`, porque o
      RLS também esconde a linha do UPDATE), derrubando o fechamento daquela fatura.
      Assinaturas novas: `resolverConfigsFechamento(db, proprietarioId)`,
      `getEquipeIdsDoProprietario(userId, empresaId, db)`,
      `adicionarAssistenciaMensal(faturaId, prop, vetId, empresaId, db)`,
      `resolverAssistencia(propId, empresaId, db)`, `recalcularTotal(faturaId, db)`,
      `diaVencimentoDoProprietario(propId, empresaId, db)`.
      Ganhou também um cache por proprietário no laço: a configuração é da EMPRESA, e
      resolvê-la uma vez por FATURA era o que o comentário do job já prometia não fazer.
- [x] **`marcar_faturas_atrasadas`** — `diaVencimentoDoProprietario` com o `prisma`
      global devolvia `null` para todo mundo, e o `if (!dia) continue` fazia TODA fatura
      ser pulada: nenhuma fatura vencida virava ATRASADA, e o job terminava "sem
      trabalho" (logo, sem nem aparecer na Monitoração).
- [x] **`cancelar_orcamentos_vencidos`** — `listarEscoposComValidade()` era chamada SEM
      cliente, antes de qualquer `comTenant`. `tb_empresa_configuracoes` está sob RLS →
      lista vazia → o job saía no `if (escopos.length === 0)` da PRIMEIRA linha e nenhum
      orçamento jamais expirava. Agora varre `empresasAtivas()` (control plane, sem RLS —
      é o ponto de partida legítimo, o mesmo de `paraCadaEmpresa`) e lê a configuração
      de cada uma dentro de `comTenant`.
- [x] **`cancelar_doses_prescricao_perdidas`** — dois defeitos:
      `anexarAplicadaProprietario(prisma, …)` (comentado como "lido por fora de
      propósito") consulta `tb_prescricoes` por SQL cru e **engole o erro no `catch`
      interno**: sem tenant, todo item voltava `aplicadaPeloProprietario: false` e o
      medicamento que o proprietário aplica em casa voltava a ocupar reserva de estoque
      na clínica. E `previstoStr` era lido FORA do bloco `else` que o declara —
      `ReferenceError` latente que só não estourava porque, até hoje, todo item
      cancelado veio pelo ramo COM âncora de horário. Virou `porQue`, declarado no topo
      do laço, com texto próprio para cada ramo.
- [x] 🔴 **`cancelar_agendamentos_nao_realizados` — bug INDEPENDENTE, sem relação com
      RLS: a coluna é curta demais.** `CANCELADO_AUTOMATICAMENTE` tem 25 caracteres e
      `tb_agendamentos_clinicos.status` é `VARCHAR(20)`; como esse é o ÚNICO valor que a
      rotina grava, ela falha desde que o status nasceu (2026-08-18):
      `The provided value for the column is too long for the column's type`.
      E, por rodar em transação por empresa, o erro derruba o **LOTE INTEIRO** daquela
      clínica ("LOTE REVERTIDO (rollback)" — visível nas execuções 88/94/96 da
      Monitoração), então NENHUM agendamento é encerrado, nem os do ramo que teria
      funcionado. Efeito visível: agendamento preso em AGENDADO/EM_ANDAMENTO para
      sempre, ocupando a grade. Migration acima; `schema.prisma` já em `VarChar(30)`.
      ⚠️ Status novo nessa tabela: **confira o comprimento antes**.
- [x] **Execução MANUAL com rastro passo a passo — o "set -x" dos crons.** Sem isto,
      nada acima era observável: `reportarCron` só grava execução quando houve TRABALHO
      ou ERRO, então um job que roda, decide "hoje não é dia" e termina não deixa rastro
      NENHUM — e fica idêntico a um job que nunca rodou porque o servidor estava fora do
      ar. O diário (`lib/cronTenant.js`) responde "o que foi feito"; faltava responder
      **"por que nada foi feito"**.
      - `lib/cronTrace.js` — `AsyncLocalStorage` com `passo`/`grupo`/`comTrace`. Fora de
        `comTrace` (isto é, no cron agendado) `passo()` retorna na primeira instrução:
        o custo em produção é uma chamada de função vazia.
      - `cronManager.executarAgora(chave)` — roda o job REAL, uma execução por vez por
        chave (`emExecucao`: dois cliques processariam as mesmas faturas em paralelo).
        Job com agenda DESLIGADA roda mesmo assim — é justamente com ele desligado que
        se quer testar antes de religar; o estado vai no retorno.
      - **`npm run job -- <chave>`** (`scripts/rodarJob.js`); `--list` mostra a agenda
        REAL, lida de `CronAgenda` via `iniciarJobs({ agendar: false })` — exibir o
        `exprPadrao` do código faria alguém procurar o problema no horário errado
        (o padrão do fechamento é `45 23`, mas neste ambiente ele está em `00 18`).
        ⚠️ O script escreve com `process.stdout.write`, não `console.log`: `server.ts`
        redireciona o console para o Winston e o rastro sairia picado entre as linhas
        de log.
      - **`POST /api/monitoracao/agendas/:chave/executar`** → botão "Executar agora" na
        tela Configuração (`components/ModalExecucaoJob.tsx`).
        ⚠️ **Gate ADMIN DA PLATAFORMA**, mais estreito que o resto daquela tela (que
        aceita GESTOR por `podeGerenciar`): o job varre TODAS as empresas ativas — fecha
        fatura e manda WhatsApp em nome de clínicas que não são a de quem clicou.
        ⚠️ Responde **200 mesmo com exceção**: a execução aconteceu e o rastro é o
        produto da chamada; um 500 faria o interceptor do axios descartar justamente o
        trace que explica a falha.
      - **`CRON_CLI=1`** (guarda no fim de `server.ts`) carrega o módulo sem `app.listen`
        e sem `iniciarJobs`. Os `registrarJob(...)` só existem lá, então o CLI precisa
        importar o arquivo — e, sem a guarda, importar significaria tomar a porta 3001 do
        backend em execução e ligar TODAS as tarefas em segundo plano.
      ⚠️ **Roda a tarefa DE VERDADE** — grava no banco e dispara e-mail/WhatsApp. Não há
      modo simulação, de propósito: um "faz de conta" seria outro código, testando outra
      coisa. Nesta base `WHATSAPP_PROVIDER`/`EVOLUTION_*` e `EMAIL_*` estão configurados
      com provedor REAL — disparar `lembrete_*` ou `reenviar_links_fatura` manualmente
      envia mensagem a cliente.
- [x] **Campo "Fuso Horário" REMOVIDO da tela de Configurações** (`CadastroEmpresa.tsx`,
      pedido à parte na mesma sessão): era só leitura e não havia o que fazer com ele
      ali. `fusoLabel` saiu junto do `useConfiguracaoOperacional` — estado sem consumidor
      é estado morto. O backend CONTINUA devolvendo `fusoLabel` em `GET/PUT
      /equipes/configuracoes` (contrato inalterado, basta voltar a ler). O fuso em si não
      mudou em nada — ver §6.
- [ ] **`auto_aceite` e `vinculos_provisorios` são lixo em `CronAgenda`**: os jobs foram
      removidos do código quando os vínculos vet↔animal deixaram de existir, mas as
      linhas ficaram no banco. Não aparecem na tela (ela lista `cronManager.listarJobs()`,
      que só conhece os registrados) — só ocupam espaço. Apagar quando alguém tocar na
      tabela; não vale uma migration só para isso.
- [ ] **O job de fatura só roda se o backend estiver no ar naquele minuto.** No dia da
      investigação o processo estava parado desde ~11:30 e as 18:00 passaram em branco —
      `node-cron` não recupera disparo perdido. Enquanto não houver uma varredura de
      recuperação ("fechou tudo que já devia ter fechado"), uma queda no horário do job
      empurra o fechamento para o mês seguinte. O `deveFecharHoje` compara com HOJE, não
      com "já passou do dia" — mudar isso é decisão de produto.
- [ ] **Auditar o resto do código chamado por cron.** Foram corrigidos os pontos
      alcançados pelos 10 jobs registrados, mas a busca foi por inspeção. Qualquer helper
      novo usado dentro de `paraCadaEmpresa` precisa aceitar o cliente — e o modo de
      falhar continua sendo zero linha em silêncio. Suspeito conhecido e de baixo
      impacto: `fusoDaEmpresa(empresaId)` sem cliente não enxerga o override
      `EmpresaConfiguracao.fuso_horario` no cron (cai na dedução por endereço, que lê
      `tb_empresas`, control plane).

---

# Atualizado em: 2026-08-23 (parte 3) (FUSO DEDUZIDO DO ENDEREÇO — o campo de escolha
#   de fuso saiu da tela: "nem todos sabem o que é isso" (pedido do usuário). O valor
#   passa a sair do CEP/UF que o cadastro da empresa já coleta — `fusoPorEndereco` /
#   `fusoPorCep` / `fusoPorUf` em `lib/fusoEmpresa.js`, com mapa UF→IANA dos 27
#   estados e tabela de faixas de CEP. A tela de Configurações EXIBIA o detectado
#   ("Manaus (UTC−4)", via `rotuloFuso`, cujo deslocamento vem do `Intl` e não escrito
#   à mão) — esse campo saiu da tela em 2026-08-24, ver a parte 4 no topo; o `rotuloFuso`
#   e o `fusoLabel` da API continuam existindo. ⚠️ O CEP vence a UF: é o único jeito de separar Fernando de Noronha
#   (UTC−2) do resto de PE (UTC−3). ⚠️ As faixas de CEP são por INTERVALO, nunca por
#   prefixo — o mesmo "69" cobre AM, RR e AC, e DF/GO se intercalam no 7xxxx.
#   A coluna `fusoHorario` CONTINUA existindo como override fora da UI (extremo oeste
#   do AM é UTC−5 embora a UF seja AM) — ordem: coluna → endereço → padrão. Cache de
#   60s invalidado por `EmpresaCadastroController.salvar` quando o endereço muda.
#   Convertidos nesta parte (nada mais formata em Brasília fixo): `AgendamentoController`
#   — inclusive `diaEHoraNaEmpresa`, que decide se o horário cabe no EXPEDIENTE (era o
#   pior caso: em Manaus a janela saía 1h deslocada e sábado 23:00 no Acre virava
#   domingo, recusado por "não é dia de atendimento") —, `lembreteAgendamentoService`,
#   `DashboardController` (o `AT TIME ZONE` do gráfico, como BIND) e 5 templates de
#   `emailService` (`fuso = FUSO_PADRAO` opcional: quem não passa mantém o
#   comportamento antigo). FICAM em Brasília de propósito: o alerta de cron do
#   `emailService` (plataforma → ADMIN) e o `cronManager` (fuso do AGENDAMENTO do job,
#   que varre todas as empresas). Testes: 22 casos em `fusoEmpresa.test.js`
#   (4 fusos, faixas intercaladas de CEP, Noronha, rótulo). Suíte: 172.)
---

# Atualizado em: 2026-08-23 (parte 2) (FUSO HORÁRIO POR EMPRESA — a aplicação roda em
#   TODO O BRASIL, que tem QUATRO fusos (UTC−2 Noronha · UTC−3 Brasília/SP/Sul/NE ·
#   UTC−4 Manaus/Cuiabá/Campo Grande/Porto Velho/Boa Vista · UTC−5 Rio Branco/
#   Eirunepé). Até aqui o servidor assumia `America/Sao_Paulo` fixo
#   (`process.env.TZ`, server.ts) e o front lia o relógio do dispositivo — então para
#   uma clínica em UTC−4/−5 o "hoje" da fila do plantão virava 1-2h antes da
#   meia-noite local (dose das 22h no Acre contabilizada no dia seguinte) e o horário
#   no WhatsApp/auditoria saía adiantado.
#   🔴 MIGRATION GERADA, NÃO APLICADA — `20260823000000_empresa_fuso_horario`
#   (só `ALTER TABLE ... ADD COLUMN IF NOT EXISTS fuso_horario VARCHAR(60)` em
#   `tb_empresa_configuracoes`; sem RLS novo, a tabela já é escopada). Aplicar com
#   `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy` + `npx prisma
#   generate`. SEM BACKFILL de propósito: `null` = comportamento anterior
#   (America/Sao_Paulo no servidor, fuso do dispositivo na tela), então nenhuma
#   empresa muda de comportamento ao aplicar — preencher todo mundo com São Paulo
#   transformaria uma suposição implícita em dado afirmado e deixaria a clínica de
#   Manaus com o fuso errado gravado sem nunca ter escolhido.
#   NOVO `lib/fusoEmpresa.js` (fonte única do backend): `fusoDaEmpresa(empresaId)`
#   com cache de 60s, `hojeNaEmpresa`/`diaNaEmpresa`/`formatarNaEmpresa` e
#   `instanteNoFuso` (caminho INVERSO — "08:00 na clínica" → instante UTC, duas
#   passadas). Tudo por `Intl` com `timeZone` EXPLÍCITO: trocar `process.env.TZ` em
#   runtime corromperia as outras clínicas atendidas pelo mesmo processo.
#   Ligado em: `PrescricaoGrupoController` (o `hojeLocalStr()` que lia o relógio do
#   servidor foi REMOVIDO; `executadoHojeItem`/`dataLocalStr`/`itemPendenteNoDia`/
#   `fmtDataHora` passaram a receber `fuso`), `lembreteDosePrescricaoService`
#   (WhatsApp), `EquipeController` (obter/salvar + `GET /equipes/logo`, que é a ÚNICA
#   rota de config legível por qualquer membro — o fuso precisa chegar à enfermeira,
#   não só ao gestor). Front: `definirFusoDaEmpresa` em `utils/dateUtils.ts`,
#   alimentado pelo `EmpresaContext` (e zerado na troca de empresa), com toda a
#   família de INSTANTE passando a formatar por `Intl` no fuso resolvido em vez dos
#   getters locais; campo "Fuso Horário" em `CadastroEmpresa.tsx` (a tela de
#   Configurações, que mudou de nome). Testes: `__tests__/fusoEmpresa.test.js`
#   (11 casos — os 4 fusos, virada do dia, ida-e-volta de `instanteNoFuso`). Suíte: 161.
#   ⚠️ PENDENTE: `emailService.js` e `AgendamentoController.js` ainda têm
#   `timeZone: 'America/Sao_Paulo'` fixo (~12 pontos) — ver §6.)
---

# Atualizado em: 2026-08-20 (CRMV: a sincronização diária TROCOU de estratégia —
#   era busca recursiva por PREFIXO DE NOME (teto real do servidor de 20
#   resultados/resposta, profundidade de refino limitada, nomes comuns em
#   português ficavam fora do índice mesmo com sync "bem-sucedido"); agora é
#   VARREDURA SEQUENCIAL POR NÚMERO de inscrição (1..25000 por UF — hoje só RJ,
#   `MAX_POR_UF` em `crmvScraperService.js`), confirmado ao vivo contra o SISCAD:
#   `filtro_procurar=2` (Inscrição) + `filtro_tp_texto=1` (Idêntico) = busca EXATA,
#   sempre 0 ou 1 resultado, sem truncamento. Só entra no índice quem está
#   `atuante` (ativo) — "traga todos os veterinários ativos" era o pedido. Número
#   de inscrição é sequencial e pode ser REAPROVEITADO (decisão do usuário), por
#   isso a varredura é EXAUSTIVA todo dia, não incremental por delta de números.
#   🔴 REVERTE a política de privacidade anterior: `CrmvValido` guardava só
#   SHA-256(número+UF) ("nunca em claro"); agora guarda NOME + NÚMERO EM CLARO —
#   sem isso não dá pra reportar QUEM mudou no diff diário, que é o pedido
#   explícito do job. Confirmado explicitamente com o usuário antes de mudar.
#   `diffECommitUF` continua incremental por UF (insere o que é novo, remove o
#   que sumiu/inativou, atualiza nome/classe de quem mudou) — só que agora o
#   e-mail de monitoração (`comAlerta`/`reportarCron`) LISTA os nomes (capado em
#   30 por seção, `LIMITE_LISTA_EMAIL`), não só a contagem. Cron `crmv_sync`
#   passou de `0 23 * * *` para `0 7 * * *` (a varredura por número é bem mais
#   lenta que por nome — RJ sozinho ≈ 2h45 a 400ms/chamada — cedo pra terminar
#   antes do expediente); o valor já estava `0 07 * * *` no `CronAgenda` deste
#   ambiente (alguém já tinha ajustado por fora), só o `exprPadrao` do código
#   (usado só pra semear ambiente novo) estava desatualizado.
#   🔴 Migration GERADA (`20260904000000_crmv_indice_por_numero` — TRUNCATE +
#   troca de `hash` por `numero`/`nome`/`classe`/`dataInscricao`/`updatedAt` +
#   `@@unique([numero, uf])`), NÃO aplicada — as linhas antigas (só hash) são
#   IRREVERSÍVEIS pro formato novo, então a migration esvazia a tabela; é
#   índice/cache do SISCAD, nunca fonte de verdade, o próximo scraping repovoa.
#   Confirmar `npx prisma migrate deploy` + `npx prisma generate` antes de usar.
#   `crmvService.validarCRMV` trocou o lookup por hash por
#   `findUnique({ numero_uf: { numero, uf } })` — mesmo contrato de saída
#   (`{valido, uf}` / `{valido:null, motivo:'estado_nao_sincronizado'}` / etc.),
#   nenhum consumidor (`UserController`, `routes/crmv.js`) mudou.)
---

# Atualizado em: 2026-08-11 (grupo2corrigir FECHADO: bug real em ExameCompra.tsx (setSelectedAnimal
#   não aceita forma funcional), duplicata inativa de fornecedor ganhou fluxo de "Ativar existente",
#   relatorioNutricional.service.ts do FRONTEND removido — órfão MySQL, nunca importado)
---

# Atualizado em: 2026-08-02 (Sessão por INATIVIDADE de 2h (lib/sessionTokens.js), rastro de "assumido de quem" na agenda, vacina aplicada pelo proprietário, resultado de exame manual)
---

### Sessão 2026-08-02 — Sessão de 2h, agenda assumida, vacina do proprietário, resultado de exame
- [x] **Sessão expira por INATIVIDADE de 2h** — `lib/sessionTokens.js` virou a fonte ÚNICA da
      duração e da assinatura dos tokens (o access era assinado em 4 lugares e o refresh em 3,
      todos com literais `'24h'`/`'30d'`). O refresh de **30 DIAS** era o que deixava o usuário
      entrar no dia seguinte: o access até expirava, mas o interceptor do axios renovava tudo em
      silêncio pelo cookie que sobreviveu à noite. Agora **access 30 min** (`SESSION_ACCESS_MINUTES`)
      dentro de uma **janela de inatividade de 120 min** (`SESSION_IDLE_MINUTES`), rotacionada a cada
      refresh — quem está trabalhando nunca é interrompido; parado além da janela, precisa logar.
      ⚠️ O access PRECISA ser menor que a janela: iguais, expirariam no mesmo instante e o refresh
      nunca teria como renovar nada (logout duro a cada 2h, no meio do atendimento).
      `setAuthCookies` usa os `maxAge` da lib, e o **cookie-dica passou a ter a vida do refresh**
      (antes 30d: sobrevivia ao token e fazia o front sondar /me e /refresh de sessão morta — 401 no
      console, justo o que ele evita). O timer de inatividade do `AuthContext` foi de 1h para 2h,
      espelhando a janela do servidor.
- [x] **Cadastro Pessoal: o profissional edita os próprios dias e horários** — a trava era o
      `validarDentroDaBase` (front), que exigia que o dia/horário coubesse no snapshot do que o
      GESTOR lançou na inclusão do membro. O backend nunca teve essa regra (só valida contra o
      expediente da EMPRESA, em `validarLocaisContraExpedienteEmpresa`). O que o gestor lança na
      inclusão é ponto de partida, não teto. NÃO reintroduzir.
- [x] Rodapé do Cadastro Pessoal no padrão da aplicação (mesmas classes de Configurações/prescrição),
      à direita, com **Fechar** ao lado do Salvar — o botão largo de página inteira saiu.
- [x] **Rastro de "assumido de quem" na agenda** (migration `20260815000000`) —
      `AgendamentoClinico.assumidoDeId` + `assumidoEm`, gravados por `marcarAssumido` tanto no
      `AgendamentoController.assumir` quanto no `EvolucaoController.assumir` (que arrasta o
      agendamento junto). POR QUÊ: assumir só trocava o `veterinarioId`, então o atendimento sumia
      da agenda de um e aparecia na do outro **sem explicação** — o AuditLog registra o evento, mas
      é texto livre e não serve para pintar a linha. Em **Atendimento > Agenda**
      (`SubModuloMinhaAgenda`) sai o selo `Assumida de <Fulano>` (ou `Assumida por <Fulano>` para
      quem perdeu). Leitura/escrita por SQL cru em `lib/agendamentoAssumido.js` (client Prisma pode
      não conhecer as colunas — CLAUDE.md §11).
- [x] **Vacina "Será aplicada pelo Proprietário"** (migration `20260815000001`) —
      `VacinaClinica.aplicadaPeloProprietario`, irmã de `cliente` (quem FORNECE), com a MESMA matriz
      da prescrição. A dose que o dono aplica em casa **não vai à Execução de Prescrição**
      (`listarParaExecucao` a filtra) e é cobrada na **FINALIZAÇÃO** — única oportunidade, já que
      nunca chega ao plantão. O bloco "debita lote (FEFO) + lança FaturaItem" saiu de `executar`
      para o helper `darBaixaEFaturar`, reusado pelo `finalizar`; os reforços periódicos também são
      agendados ali, senão nunca seriam. ⚠️ Diferença deliberada em relação à prescrição: aqui o
      lote É debitado, então **a vacina não tem o buraco de "valor 0"** que a prescrição tem no
      mesmo quadrante (lá o item aplicado pelo proprietário não debita lote, e sem lote não há preço).
- [x] **Tela de Resultado de Exame lista o que foi PEDIDO** — `components/ExamesSolicitadosPanel.tsx`
      em `/exames/:animalId?tipo=laboratorial|imagem`: os `ExameClinico` pedidos no Atendimento
      aparecem com DOIS caminhos por linha — **Carregar resultado** (anexa o laudo, tabela lida por
      IA) e **Preencher manualmente** (digita a tabela, ou o laudo no caso de Imagem). Os dois caem
      no mesmo `PATCH /clinica/exames/:id/resultado`; `salvarResultado` passou a aceitar `itens`
      (JSON no multipart) e, havendo itens digitados, eles MANDAM sobre a leitura do arquivo.
      O `deleteMany` da tabela anterior agora só roda quando há tabela NOVA — reenviar o formulário
      só com uma observação apagava o resultado já carregado. Abaixo dos pendentes há o bloco
      **Resultados lançados** (leitura): o resultado pertence ao `ExameClinico`, que NÃO aparece na
      lista de exames NUTRICIONAIS daquela página — sem ele, a linha sumia e nada surgia no lugar.
      Gate pelos slugs de RESULTADO (`exames.laboratorial.editar` / `exames.imagem.editar`),
      distintos do slug do PEDIDO — ver armadilha 29.
      As três ações da linha (carregar / preencher / finalizar) são botões **só de ícone**, numa
      linha só (`flex-nowrap`), com `title` + `aria-label` obrigatórios — sem rótulo visível é o
      que dá nome ao botão no hover e para leitor de tela.
      ⚠️ Os botões "Carregar Resultado" e "Preencher Manualmente" que ficavam FORA do card foram
      REMOVIDOS (2026-08-02). Com eles saiu a ÚNICA entrada para `/exames/:animalId/novo`
      (`CriaExameNutricional` — criação de EXAME NUTRICIONAL, outro módulo; armadilha 27). A rota
      segue montada e funcional; se aquele fluxo voltar a ser necessário, precisa de entrada nova.
- [x] **"Finalizado sem Resultado"** — botão **Finalizar** (com confirmação) na fila de espera do
      painel, chamando o `PATCH /clinica/exames/:id/finalizar` que já existia. O exame sai da fila
      e passa a constar como **FINALIZADO SEM RESULTADO** nas duas telas de resultado E no Pedido
      de Exames. O status no banco continua sendo `CONCLUIDO`: quem separa "finalizado com
      resultado" de "finalizado vazio" é o CONTEÚDO, via `utils/exameClinico.ts#temResultadoExame`
      (laudo, tabela de parâmetros ou imagens) — fonte única consumida pelo `StatusExameBadge`
      (prop `semResultado`) e pelo painel. NÃO virou status novo no banco justamente para não
      duplicar estado: o mesmo pedido pode receber resultado depois e o rótulo se corrige sozinho.
      O gate do Finalizar é `atendimento.exames.finalizar` (ação do PEDIDO), e não o slug de
      resultado — por isso o painel também aparece para quem só tem essa permissão.
- [x] **Prescrição: lixeira → ícone de CANCELAR** (`Ban`, o mesmo do Pedido de Exames), nos 4 pontos
      da tela (item da prescrição, linha da tabela, card mobile e cabeçalho do modal). Nada ali é
      excluído de verdade — o registro clínico fica no histórico como cancelado, e a lixeira
      prometia o contrário.
- [x] **VACINA saiu do shell de Atendimento e virou tela APARTADA** (`pages/Vacina.tsx`, rotas
      `/clinica/vacina[/:animalId]` no App.tsx). A aba sumiu de `SUB_MODULOS`, e `Atendimento` não
      importa mais o `SubModuloVacina` (com ele foram embora `viewVacinaId` e a busca de vacinas em
      `carregarAtendimentoNasPaginas`, que só existiam para alimentar aquela aba).
      `'vacina'` CONTINUA no tipo `SubModulo`: virou destino de NAVEGAÇÃO, não aba — o Histórico do
      Paciente ainda leva para lá. Como sair do shell descarta o `openItemId` (que é estado), o item
      viaja na URL: `irParaSubmodulo()` navega para `/clinica/vacina/:id?item=<id>` e a tela nova lê
      o `?item=`. Sem isso, clicar numa vacina do histórico abriria a tela em branco.
      A tela apartada mantém, porque não é decoração: o SELETOR DE PACIENTE, o card do animal e a
      busca da EVOLUÇÃO EM ANDAMENTO — é o `evolucaoId` que amarra a vacina ao atendimento aberto;
      sem ele toda vacina registrada por ali nasceria solta e sumiria do histórico do AG-XXXX.
      `SeletorAnimalInteligente` foi extraído de `Atendimento.tsx` para `components/` (duas cópias
      divergiriam na primeira correção).
- [x] **Fim dos 429 (Too Many Requests)** — três causas, todas tratadas:
      1. **Laço de requisições** na `Vacina.tsx` recém-criada. `setSelectedAnimal` e
         `refreshSelectedAnimal` do `SelectedAnimalContext` NÃO são `useCallback` — mudam de
         identidade a cada render do provider. Com o loader nas dependências do efeito, fechava o
         ciclo `efeito → GET /animais/:id → setSelectedAnimal → provider re-renderiza → nova
         identidade → efeito`, disparando sem parar. ⚠️ REGRA: efeito que chama
         `setSelectedAnimal`/`refreshSelectedAnimal` depende de VALORES (ids, flags), nunca das
         funções — é o motivo do `eslint-disable` equivalente em `Atendimento.tsx`.
      2. **`usePermissoes` virou STORE ÚNICO de módulo.** São ~46 consumidores e vários ficam
         montados juntos (Sidebar + AppHeader + página + submódulos): cada um disparava o SEU
         `GET /equipes/minhas-permissoes`, 4-6 vezes o mesmo mapa por navegação — a maior fatia do
         rate limit. Agora é uma requisição por chave `userId|empresaId|equipeId`, compartilhada
         (inclusive a em VOO, para o carregamento inicial, quando todos montam no mesmo tick);
         quem monta com o cache quente não toca na rede nem passa por `loading` falso. Troca de
         contexto ZERA o mapa antes de buscar (manter o anterior exibiria as permissões da outra
         empresa por um instante). Mesmo padrão de `useVetPendentes`.
      3. **Rate limit era por IP — cota COLETIVA.** Clínica atrás de NAT (ou de túnel/proxy que não
         repassa o IP real) somava o tráfego de todo mundo num balde só. `keyGenerator` passou a
         usar o USUÁRIO do token, com fallback para o IP. O token é **verificado** (`jwt.verify`,
         não `decode`): forjado não vira chave nova, cai no balde do IP — senão bastaria inventar
         um `id` por requisição para ter cota infinita. Limite geral agora em `RATE_LIMIT_MAX`
         (default 300/min). O limitador de LOGIN (20/15min, anti-força-bruta) não mudou.
         ⚠️ O fallback de IP usa `ipKeyGenerator(req.ip)` do próprio express-rate-limit, NUNCA
         `req.ip` cru: em IPv6 o usuário costuma receber um /64 inteiro, então o endereço
         completo daria um balde novo a cada requisição (bastava trocar o último bloco). O
         helper reduz o IPv6 à sub-rede /56 antes de virar chave e deixa o IPv4 intacto. A
         biblioteca valida isso no boot — sem o helper, ela derruba um
         `ValidationError ERR_ERL_KEY_GEN_IPV6` no startup.
- [x] **Sidebar: Atendimento virou módulo FOLHA** — deixou de ser accordion e é um link direto
      para `/clinica/agenda`. Evolução, Prescrição, Pedido de Exames e Encaminhamento saíram do
      menu porque já são as ABAS de dentro daquela tela (`SubMenuClinico`): tê-los nos dois lugares
      era o mesmo menu duplicado. **Vacina** e **Execução de Prescrição** subiram para o PRIMEIRO
      NÍVEL, ao lado de Agendamento — a Vacina porque virou tela apartada (sem entrada própria não
      haveria como registrar vacina nova), e a Execução porque é a tela onde o ENFERMEIRO trabalha
      (escondê-la dentro de outro módulo a deixava sem porta de entrada para o perfil que mais a
      usa). ⚠️ O ativo do Atendimento recorta `/clinica/vacina` (`p.startsWith('/clinica') &&
      !p.startsWith('/clinica/vacina')`): a rota da Vacina também começa com `/clinica` e, sem
      isso, os dois itens acendem juntos. `openGroup` não abre mais grupo para `/clinica` nem para
      `/execucao-prescricao` — os três são folhas.
- [x] Rótulo **Salvar → Finalizar** no botão principal de Prescrição, Vacina e Pedido de Exames
      (é o que a ação faz: grava e finaliza). As mensagens de destino do item sob os checkboxes da
      prescrição ("Vai à Execução de Prescrição — …") e a função `destinoDoItem()` foram REMOVIDAS
      a pedido; a matriz que elas espelhavam continua valendo no backend.
- [x] **Status saiu da tela de Encaminhamento** (badge do card + coluna da tabela). O campo continua
      governando o comportamento — só PENDENTE pode ser cancelado, e é ele que mantém a designação
      do prestador ativa.
- [ ] O "Salvar" das linhas de `Exames.tsx` (edição inline de um valor) e o "Salvar exames" do
      exame NUTRICIONAL (`CriaExameNutricional`) continuam como estão: são gravação de campo/registro
      nutricional, não a finalização de um documento clínico. Confirmar se deviam entrar no rename.
