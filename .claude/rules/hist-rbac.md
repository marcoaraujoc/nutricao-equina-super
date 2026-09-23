---
paths:
  - "**/permissao*"
  - "**/Permissao*"
  - "**/animalScope.js"
  - "**/animalAccess.js"
  - "**/acessoExterno.js"
  - "**/cargosPrestador.js"
  - "**/ControleAcesso.tsx"
  - "**/usePermissoes.ts"
  - "**/auditoria.js"
  - "**/*Audit*"
  - "**/transferenciaAtendimento.js"
  - "**/tipoContexto.js"
  - "**/vetUtils.js"
  - "**/*Designacao*"
  - "**/middlewares/**"
  - "**/middleware/**"
---

# Histórico de decisões — Permissoes, autoria e escopo de acesso

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-09 (**CARGO PRESTADOR** — agora de verdade — e o cron que
#   RECUPERA o dia perdido. Duas frentes:
#   1. 🔴 **`PRESTADOR` VIROU CARGO PRÓPRIO, ao lado de `FORNECEDOR`.** Em 08/09 o
#      pedido foi só RENOMEAR (rótulo); agora foi o oposto — CRIAR o cargo **sem
#      migrar nada**. Quem está gravado segue FORNECEDOR (e volta a se chamar
#      "Fornecedor"); PRESTADOR é o que se escolhe daqui em diante.
#      🔴 FONTE ÚNICA `lib/cargosPrestador.js` — **nenhum `cargo === 'FORNECEDOR'`
#      novo no código**. Cargo novo que a tela oferece e que os gates não conhecem é
#      PIOR que não ter o cargo: o PRESTADOR nasceria com a base de pacientes INTEIRA,
#      sem erro nenhum na tela. ⚠️ `userType === 'FORNECEDOR'` CONTINUA valendo — é o
#      userType dos DOIS (`CARGO_PARA_TIPO`), e é o que faz todo gate por userType
#      funcionar sem alteração.
#      ⚠️ O que distingue os dois é só o CADASTRO do login: FORNECEDOR →
#      `tb_fornecedores`, PRESTADOR → `tb_prestadores` (as duas já tinham `userId
#      @unique` para isso). A matriz de permissões nasce COPIADA da do FORNECEDOR
#      daquela equipe, com o `locked` junto.
#      🔴 **MIGRATION GERADA, NÃO APLICADA** — `20260930000000_cargo_prestador`,
#      ADITIVA e IDEMPOTENTE (sem UPDATE/DELETE). SEM mudança de schema, logo **sem
#      `prisma generate`**.
#   2. 🔴 **O CANCELAMENTO DE ORÇAMENTO RECUPERA O DIA PERDIDO.** A busca sempre foi
#      por DATA do orçamento (idempotente); o que faltava era o job VOLTAR A RODAR —
#      `node-cron` não recupera disparo perdido, e com o backend fora do ar às 23:50
#      aquele dia nunca acontecia. Novo `cronManager.recuperarJobsPerdidos()` na
#      subida: 26h sem execução BEM-SUCEDIDA (erro não conta) → roda na hora, com
#      origem nova **RECUPERACAO** no log. ⚠️ OPT-IN: nunca ligar em job que MANDA
#      MENSAGEM. ⚠️ Agenda desligada pelo ADMIN não é ressuscitada.
#   Suíte: 694. Detalhes na sessão 2026-09-09 da §12.)
---

### Sessão 2026-09-09 — Cargo PRESTADOR (novo) e o cron que recupera o dia perdido

> 🔴 **MIGRATION GERADA, NÃO APLICADA** — `20260930000000_cargo_prestador`. É
> **ADITIVA e IDEMPOTENTE**: só cria o perfil `PRESTADOR` em cada equipe e COPIA para
> ele a matriz do `FORNECEDOR` daquela equipe. **Não há UPDATE nem DELETE** — foi o
> pedido, textualmente ("nenhum dado precisa ser alterado, deixe para as futuras
> inclusões"). Aplicar com
> `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy`.
> **SEM mudança de schema**: `MembroEquipe.cargo` é TEXT e `UsuarioEmpresa.perfil` é
> VARCHAR(20) — 'PRESTADOR' tem 9 caracteres. Logo, **`prisma generate` não é
> necessário** para esta leva.

- [x] 🔴 **`PRESTADOR` VIROU CARGO DE VERDADE, ao lado de `FORNECEDOR`.** Em 2026-09-08
      o pedido foi RENOMEAR (só o rótulo) porque separar exigiria migrar todo membro
      cadastrado; agora o pedido foi o oposto — **criar o cargo, sem migrar nada**. Os
      dois convivem: quem está gravado segue `FORNECEDOR` (e volta a se chamar
      "Fornecedor" na tela — com PRESTADOR na lista, manter o rótulo antigo deixaria
      DUAS opções com o mesmo nome), e `PRESTADOR` é o que se escolhe daqui em diante.
- [x] 🔴 **FONTE ÚNICA `lib/cargosPrestador.js`** — `CARGOS_PRESTADOR`,
      `ehCargoPrestador`, `membroEhPrestador`, `OR_CARGO_PRESTADOR`.
      **POR QUE ELA EXISTE:** toda a regra do profissional externo estava escrita como
      `cargo === 'FORNECEDOR'` espalhada em 5 arquivos — escopo por designação, agenda
      própria, permissão por membro, destino do encaminhamento. **Um cargo novo que
      alguém pode escolher mas que os gates não conhecem é PIOR que não ter o cargo:**
      esquecer uma dessas comparações faz o PRESTADOR nascer com a base de pacientes
      INTEIRA da clínica (o oposto do deny-by-default do `DesignacaoPrestador`), e não
      há erro nenhum na tela. Convertidos: `lib/animalScope.js`, `lib/animalAccess.js`,
      `AgendamentoController`, `EncaminhamentoController` e `permissao.middleware.js`.
      ⚠️ **`userType === 'FORNECEDOR'` CONTINUA e é intencional**: `CARGO_PARA_TIPO`
      já mapeava `PRESTADOR → 'FORNECEDOR'`, então todo gate escrito contra `userType`
      vale para os dois sem uma linha de alteração. O que não pode sobrar é a
      comparação de **CARGO**. Dar userType próprio ao PRESTADOR quebraria de uma vez
      `animalAccess`, `animalScope` e os controllers clínicos.
      ⚠️ `membroEhPrestador` olha `cargo` **e** `cargos[]`: restrição não se dilui por
      acúmulo de papel.
- [x] 🔴 **CADA CARGO AMARRA O LOGIN AO SEU CADASTRO** — é o ÚNICO ponto em que os dois
      diferem: `FORNECEDOR → tb_fornecedores`, `PRESTADOR → tb_prestadores`. As duas
      tabelas já tinham `userId @unique` exatamente para isso (o comentário do schema
      em `Prestador.userId` mandava "quem precisa de tela de verdade vai por Equipe >
      Incluir Membro, cargo Fornecedor" — é esse desvio que acabou).
      `incluirMembroDireto` aceita `prestadorId` ao lado de `fornecedorId`, recusa com
      409 o cadastro/login já vinculado (senão o `@unique` estoura como erro de banco
      cru na tela) e `atualizarMembro` sincroniza os DOIS cadastros.
      ⚠️ A sincronização da edição decide pelo VÍNCULO (`userId`), não pelo cargo: o
      membro pode ter sido incluído como FORNECEDOR antes de o cargo novo existir.
      ⚠️ O fallback por e-mail do Prestador exige `userId: null` — adotar cadastro que
      já pertence a outra conta violaria o `@unique`.
- [x] **A matriz do PRESTADOR é CÓPIA da do FORNECEDOR, não transcrição.** No seed,
      `PERMISSOES_PADRAO.PRESTADOR = { ...PERMISSOES_PADRAO.FORNECEDOR }` (136 slugs);
      na migration, `INSERT ... SELECT` da matriz daquela EQUIPE, com o `locked` junto.
      ⚠️ Copiar da equipe (e não semear os defaults) porque a clínica que já configurou
      "o que o meu prestador pode fazer" configurou isso no perfil FORNECEDOR — era o
      único que existia. Nascer com quase tudo NENHUM obrigaria o gestor a refazer à
      mão o que ele já fez. `locked` é bloqueio do ADMIN da plataforma e não pode se
      perder na cópia. Depois de criadas, as duas matrizes são editadas de forma
      INDEPENDENTE.
      ⚠️ `PermissaoService.PERFIS_PADRAO` ganhou o perfil, então equipe NOVA (e equipe
      que abrir a tela antes da migration) o recebe sozinha por `garantirPerfisPadrao`.
      Sem a linha em `tb_perfis_equipe` o cargo é inutilizável: a FK de
      `tb_matriz_perfis` aponta para ela.
- [x] **`prestadorPerfil` entrou nos 3 selects de membro** (`EquipeController`) e a
      Agenda passou a ler dele o tipo de serviço do cargo novo — sem isso o membro
      PRESTADOR apareceria na grade sem especialidade nenhuma. Mesmo cuidado no
      `EncaminhamentoController`: o `tipoServico` por usuário e a lista de serviços
      disponíveis passaram a somar `tb_prestadores` a `tb_fornecedores`.
- [x] **Front**: `PERFIS_ACESSO` com os dois; o seletor de cadastro do modal virou
      genérico (`perfilCadastro` escolhe a rota `/cadastro/fornecedores` ×
      `/cadastro/prestadores` e o campo enviado). ⚠️ A dependência do efeito é o CARGO,
      não um booleano — trocar Fornecedor ↔ Prestador troca a ROTA, e sem refazer a
      busca o seletor listaria o cadastro do outro; a escolha anterior é zerada junto.
      ⚠️ Só cadastro ATIVO e **sem login** é oferecido (`userId` é @unique nas duas
      tabelas: oferecer um já vinculado só produziria 409 depois do clique).
      ⚠️ O modal "Incluir novo fornecedor" NÃO foi replicado para o prestador: deixando
      o seletor em branco o backend já cria o cadastro com o que está sendo digitado, e
      um botão que abrisse o formulário do fornecedor gravaria na tabela errada.
      `ControleAcesso` inclui os DOIS por inclusão direta (sem convite) e a coluna
      "Gerenciar Acesso" vale para ambos.
- [x] 🔴 **O CANCELAMENTO DE ORÇAMENTO PASSOU A RECUPERAR O DIA PERDIDO.** A busca
      SEMPRE foi por DATA (`createdAt < agora − validade`), nunca por "o que venceu
      desde a última execução" — é isso que a torna idempotente e auto-corretiva. O que
      faltava era o job VOLTAR A RODAR: **`node-cron` não recupera disparo perdido**, e
      com o backend fora do ar às 23:50 aquele dia simplesmente não acontece (caso real
      de 08/09: orçamento de 10/08 ainda aberto, job correto e ZERO execuções no log).
      Novo `cronManager.recuperarJobsPerdidos()`, chamado na SUBIDA logo depois de
      `iniciarJobs()`: passadas **26h** sem execução **BEM-SUCEDIDA**, o job roda na
      hora. Cobre os dois casos do pedido — servidor indisponível E execução com erro
      (a que falhou não conta como feita: a consulta filtra `ok = true`).
      ⚠️ **OPT-IN (`recuperarSePerdido`), e tem de continuar sendo.** Só serve a job
      DECIDIDO POR DATA. Ligar num job de MENSAGEM (lembrete de dose, aviso de véspera,
      lembrete de agendamento, reenvio de link) mandaria ao cliente um aviso sobre um
      prazo que já passou — pior que não mandar. Há gate travando isso.
      ⚠️ **Agenda desligada não é ressuscitada**: `ativo: false` é decisão do ADMIN, e
      a recuperação roda DEPOIS de `iniciarJobs` justamente para ler esse estado.
      ⚠️ **Sem nenhuma execução no log, roda** (base nova, log expurgado aos 15 dias) —
      o trabalho é idempotente, e rodar é sempre mais seguro que supor que já foi feito.
      ⚠️ Isolada em try/catch por job e sem `await` no boot: nunca derruba a subida.
- [x] **Origem nova `RECUPERACAO`** em `tb_cron_execucoes` (`cronTrace.comOrigem` /
      `origemAtual`, e `comAlerta` passou a usar o segundo). Sem valor PRÓPRIO, a
      execução atrasada ficaria indistinguível da que aconteceu no horário — e a
      próxima investigação de "por que só rodou hoje?" começaria de um log que mente.
      **SEM migration**: `origem` é VARCHAR(12) e o valor tem 11. Selo laranja
      "recuperação" em `LogExecucaoJobs.tsx`.
- [x] Testes: `__tests__/cargoPrestador.test.js` (25) e `__tests__/cronRecuperacao.test.js`
      (12). ✅ **Verificado que REPROVAM**: revertido `ehCargoPrestador` no
      `AgendamentoController` e removido o `recuperarSePerdido` do job, um caso falhou
      em cada. Suíte: **694**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] `EquipeService.CARGOS_VALIDOS` (`['GESTOR','VETERINARIO','ESPECIALISTA','ESTAGIARIO']`)
      é legado e não conhece FORNECEDOR nem PRESTADOR — nem o cargo antigo estava lá.
      Não bloqueia nada hoje (a inclusão de membro não passa por ele); revisar quando
      aquele service for tocado.
- [ ] O cargo PRESTADOR não tem `FornecedorEspecialidade` equivalente: as especialidades
      dele vivem só em `UsuarioEspecialidade` (por empresa). Basta para a Agenda e para
      o encaminhamento; se um dia o cadastro de Prestadores precisar de especialidade
      própria, é uma tabela nova.
- [ ] A recuperação roda só na SUBIDA do backend. Processo que fica semanas no ar sem
      reiniciar e cujo job falha todo dia não é recuperado até o próximo boot — o alerta
      de erro do `comAlerta` é quem cobre esse caso.

---

# Atualizado em: 2026-08-31 (Execução de Prescrição: card do item mostra o
#   HISTÓRICO de aplicações dentro da própria execução — Periodicidade+Dose em
#   vermelho, uma linha "Aplicação (DD/MM) — Executada" por dose já dada e a linha
#   de AGORA com "Em Execução" + botão; datas via `gerarResumoDoses`+`dataDoDiaISO`,
#   sem chamada nova ao backend. "1x na semana" ganhou rótulo "Qtd. Semanas" no
#   formulário de prescrição; Hora Início perdeu o ícone e os 4 campos da linha
#   Frequência/Hora/Qtd/Data ganharam `whitespace-nowrap` para não desalinhar.
#   Ação Finalizar REMOVIDA dos ícones de ação da Evolução — junto com todo o
#   código que só existia para ela, ver §12)
---

# Atualizado em: 2026-08-31 (Prescrição: frequências "1x a cada N dias" — o campo
#   Duração (dias) virou "Qtd. de Vezes" no formulário; internamente segue gravando
#   duracaoDias em DIAS (vezes × intervalo) para o backend continuar contando as
#   doses certas. Hora Início passou a ser OBRIGATÓRIA nessas frequências — sem ela
#   o item cai no fluxo antigo, sem o rolling schedule, e fica "pendente" todo dia
#   da janela em vez de só nas datas certas)
---

# Atualizado em: 2026-08-31 (Prescrição/Exames/Vacina: colunas Nº|Data Início|Data Fim
#   no lugar do "Nº X" + "Data" único; Vacina reordenada p/ Nº|Aplicação|Vacina|...;
#   ordem/cor de ícone virou regra ÚNICA nestas 3 telas — Alterar(laranja) primeiro,
#   Visualizar(verde), Imprimir(azul), WhatsApp(verde)/E-mail(azul) quando existirem,
#   Cancelar(vermelho) por último; WhatsApp/E-mail que só existiam no card mobile
#   entraram também na tabela desktop de Prescrição e Vacina)
---

# Atualizado em: 2026-08-31 (Incluir/Editar Membro: checkbox "Atender somente no local
#   de trabalho" — MembroEquipe.restringirPorLocal. Desligada = atende em qualquer
#   local, nada muda. Ligada = lib/animalScope.js restringe a lista de pacientes do
#   profissional aos animais cujo local bate com um dos locais de trabalho DELE
#   configurados para hoje. 🔴 Migration GERADA, confirmar aplicação antes de usar)
---

### Sessão 2026-08-31 — Checkbox "Atender somente no local de trabalho"
> 🔴 **MIGRATION GERADA — confirmar aplicação com o usuário antes.**
> `prisma/migrations/20260831000000_membro_restringir_por_local/` (só `ALTER TABLE
> ADD COLUMN restringir_por_local BOOLEAN NOT NULL DEFAULT false` em
> `tb_membros_equipe` — sem RLS novo, a tabela já está classificada em
> `AGUARDANDO_RLS`). Aplicar com `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma
> migrate deploy` (o usuário padrão do app não tem `CREATE`/`ALTER` no schema) +
> `npx prisma generate`.

- [x] **Novo campo `MembroEquipe.restringirPorLocal`** (Boolean, default `false`) — o
      checkbox fica na seção "Locais de trabalho" do Incluir/Editar Membro
      (`UsuarioFormModal.tsx`, `comExpediente`), logo abaixo do título: **desmarcado
      (padrão) = atende em qualquer local, nada muda**; **marcado = a lista de
      pacientes deste profissional fica restrita aos animais cuja `localizacaoId` bate
      com um dos `MembroLocalTrabalho` DELE, NESTA equipe, cujo `diasTrabalho` inclui o
      dia da semana de HOJE**.
      Persistência: `EquipeController.incluirMembroDireto` (cria) e `atualizarMembro`
      (atualiza — só quando a tela envia o campo, mesmo cuidado de PATCH parcial que
      `cargo` já tinha). `Equipe.tsx` é o ÚNICO caller que expõe a seção (`comExpediente`
      passado sem exceção de cargo, tanto no Incluir quanto no Editar) — `ControleAcesso.
      TabEquipe` inclui membro sem `comExpediente` (fluxo de convite/Fornecedor), então
      o checkbox não aparece lá; nada a mudar naquele payload.
- [x] **Aplicação real do filtro: `lib/animalScope.js` (`buildAnimalScopeWhere`) —
      FONTE ÚNICA reusada por `AnimalController.listar`, agendamento, execução de
      prescrição e Painel Principal (CLAUDE.md §5/§16)** — mexer AQUI propaga a
      restrição para toda tela que lista paciente por este caminho, de propósito: um
      profissional restrito não deveria ver o paciente na lista, mas continuar vendo-o
      na agenda ou na fila do plantão. Novo `localizacoesRestritasDeHoje(userId,
      equipeId)`: com a flag desligada (ou sem `req.equipeId` resolvido) devolve `null`
      → `scopeOREfetivo` = `scopeOR` de sempre (comportamento idêntico ao de antes).
      Ligada → devolve os IDs de `LocalizacaoAnimal` válidos hoje (pode ser `[]` —
      "não atende hoje", não "sem restrição" — e `localizacaoId: { in: [] }` já não bate
      com animal nenhum, sem precisar de um caso especial). O resultado é injetado como
      campo extra em CADA cláusula do `scopeOR` (`{ ...clausula, localizacaoId: {in:...} }`),
      então continua valendo tanto para "meus equipes" quanto para "empresa toda, sem
      equipe" — as duas pernas do `OR`.
      ⚠️ **Escopo deliberado: só avalia com uma equipe ATIVA resolvida
      (`req.equipeId`)** — sem ela não há "o local de trabalho dele NESTA equipe" para
      consultar (o mesmo profissional pode ter configurações diferentes em cada
      equipe/empresa), e a escolha em caso de ambiguidade é NÃO restringir (permissivo),
      nunca adivinhar. Na prática cobre o caso comum, onde o seletor de contexto sempre
      resolve `req.equipeId`.
      ⚠️ **Só aplica ao "meu equipe" (`isMembroEquipe`)** — PROPRIETARIO (vê os
      PRÓPRIOS animais) e FORNECEDOR/prestador puro (`designacoesWhere`, escopo por
      designação — regra própria, D1) não passam por `scopeOREfetivo`; a flag marcada
      num membro FORNECEDOR não tem efeito nenhum (herdaria sentido só se ele também
      atuar como gestor no contexto — `isFornecedorGestorContexto` — caso em que já usa
      o mesmo `scopeOREfetivo`, por consistência).
      ⚠️ **NÃO estendido ao Cadastro Pessoal (auto-edição)** — `CadastroPessoal.tsx`
      renderiza a própria seção "Locais de trabalho" (`LocalTrabalhoFields` direto, fora
      do `UsuarioFormModal`), separada do fluxo de Incluir/Editar Membro. Decisão de
      escopo: o pedido foi "na hora de incluir o membro" (ação do GESTOR sobre outra
      pessoa); deixar o profissional se autorrestringir sem o gestor decidir é
      comportamento diferente, não pedido. Se um dia for necessário, o gancho é o mesmo
      campo (`restringirPorLocal`) — só falta o checkbox lá e o campo no payload de
      `PUT /users/me`.

---

# Atualizado em: 2026-08-22 (Auditoria ganhou a categoria ACESSO_NEGADO — tentativa
#   BLOQUEADA de acesso, não só ação bem-sucedida. Pedido do usuário: "tentativas de
#   acesso não autorizados (aplicação, funcionalidades, animais) não estão aparecendo
#   na auditoria do ADMIN" — e de fato não apareciam: `registrarAuditoria`
#   (lib/auditoria.js) só era chamado por controllers em EXCLUSAO/CANCELAMENTO/etc,
#   nunca nos `res.status(403)` de `checkPermission`/`verificarAcessoAnimal`/login, e
#   um 403 nunca deixava rastro. Novo helper `registrarAcessoNegado(req, {motivo,
#   entidade, entidadeId?, animalId?, emailTentativa?})` — fire-and-forget (nunca
#   lança, não atrasa a resposta 401/403) e roda em ESCOPO DE PLATAFORMA
#   (`comEscopoPlataforma`, mesmo motivo do `registrarAcesso` de LOGIN/LOGOUT): a
#   tentativa pode acontecer ANTES do tenant resolvido (login) ou ser justamente FORA
#   do tenant do usuário — escrever com o escopo dele mesmo esconderia a tentativa da
#   auditoria da empresa visada. `empresaId` é gravado como DADO, não como escopo.
#   Instrumentado em 3 chokepoints (cobre "aplicação/funcionalidades/animais" sem
#   tocar dezenas de controllers):
#   1. `permissao.middleware.js#checkPermission`/`verificarComoProprietario`/
#      `checkPermissaoProprietario` — NEGADO explícito, nível insuficiente, sem
#      equipe ativa, funcionalidade de proprietário não habilitada (entidade MODULO).
#   2. `animalAcesso.middleware.js#exigirAcessoAnimal`/`garantirAcessoAnimal` — 403 de
#      paciente fora do escopo (entidade ANIMAL, com animalId).
#   3. `auth/UserController.js#login`/`verificar2fa` — e-mail inexistente, senha
#      incorreta, conta desativada, acesso ao sistema revogado pelo gestor, código 2FA
#      inválido/expirado (entidade LOGIN, com `emailTentativa` quando ainda não há
#      usuário resolvido).
#   `podeOperarRegistro` (mesmo arquivo) também loga sozinho quando devolve `false` —
#   é usado como guard SÍNCRONO em ~19 call sites (`if (!podeOperarRegistro(req, x))
#   return res.status(403)...`), então centralizar ali (chamada fire-and-forget, sem
#   `await`) evita instrumentar cada controller (entidade REGISTRO_CLINICO).
#   Sem migration: `AuditLog.categoria`/`.entidade` já são `String?` livres — só
#   precisou entrar na lista `CATEGORIAS` de `lib/auditoria.js`. Front
#   (`AuditoriaGeral.tsx`): badge próprio (rose, ícone `ShieldAlert`), aba de filtro
#   "Acesso negado" e `ENTIDADE_LABEL` para LOGIN/MODULO/REGISTRO_CLINICO (ANIMAL já
#   existia). PENDENTE: falhas de reenvio de 2FA (`mfa.reenviarCodigo`) e o
#   Google OAuth (`GoogleController`) ainda não passam por `registrarAcessoNegado` —
#   mesmo padrão de `login`, aplicar quando forem tocados.
---

# Atualizado em: 2026-08-04 (Senha: FormularioNovaSenha compartilhado entre a tela da app e o link do e-mail; "esqueci minha senha" volta sozinho ao login com aviso genérico)
---

# Atualizado em: 2026-08-04 (STORAGE: arquivo no BANCO (bytea) — /uploads e express.static REMOVIDOS; download por /api/midia/:chave autorizado; teto 150 MB; caminho de escala = S3StorageProvider trocando só STORAGE_DRIVER — ver §8)
---

# Atualizado em: 2026-08-04 (PREMISSA DE AUTORIA: a ação vale sobre o que a pessoa criou ou assumiu, só o gestor opera o de outro; assumir/transferir ARRASTA o atendimento inteiro; auditoria de TRANSFERENCIA e ALTERACAO)
---

### Sessão 2026-08-04 — Premissa de AUTORIA, arrasto do atendimento e auditoria da troca de dono
> As três regras são uma só decisão de produto: **o atendimento pertence a quem o conduz.**
> Detalhes técnicos e o "por quê" completo estão nas armadilhas **28, 28-b, 28-c, 28-e e 28-f-bis**.

- [x] **A ação concedida vale sobre O QUE É DE QUEM A EXECUTA** — `podeOperarRegistro(req,
      autorId)` (assinatura nova; os 19 call sites foram convertidos e nenhum ficou na
      forma antiga). Registro criado OU ASSUMIDO pela pessoa: ela opera. Registro de
      outro: **só o GESTOR** (e o ADMIN). Reverte a regra de 2026-07-30 — ver 28-c, que
      guarda o motivo de NÃO voltar atrás.
      Novo `ehGestorNoContexto(req)` é a checagem canônica de gestor; `req.permissaoNivel
      === 'FULL'` deixou de valer como sinônimo (saiu de `podeAgendarParaOutro` e do
      "editar evolução finalizada").
- [x] **Fechados 3 endpoints de prescrição que não tinham guard NENHUM** —
      `adicionarItem`, `atualizarItem` e `removerItem` do `PrescricaoGrupoController`:
      qualquer um com "alterar prescrição" incluía, reescrevia e cancelava item na
      prescrição de outro profissional. Pior: `atualizarItem` fazia
      `data.veterinarioId = <quem editou>` e o documento MUDAVA DE DONO em silêncio.
      Editar não transfere mais autoria — a troca de dono tem caminho próprio.
- [x] **Assumir/transferir ARRASTA tudo que está embaixo** —
      `lib/transferenciaAtendimento.js`: `AGENDAMENTO → EVOLUÇÃO (EM_ANDAMENTO) →
      { PRESCRIÇÃO (grupo + itens), EXAME, ENCAMINHAMENTO, VACINA }`. Sem isso a premissa
      de autoria TRANCA quem assumiu (conduz o atendimento, mas não pode operar os filhos
      que ficaram com o outro). Aplicado no assumir da evolução, no assumir da agenda, na
      troca de profissional (`atualizar`) e no `transferirDia`. **Vacina entrou junto** —
      o pedido citava evolução/prescrição/exames/encaminhamento, mas ela é filha da mesma
      evolução e ficaria órfã. `FaturaItem` NÃO é arrastado (atribuição financeira).
- [x] **Auditoria de TRANSFERENCIA e ALTERACAO** — categorias e helpers novos em
      `lib/auditoria.js` (`registrarTransferencia`, `registrarAlteracao`, `resumoTexto`),
      sempre na MESMA transaction da operação. Transferência grava o dono anterior, o novo
      e a origem da cascata; alteração grava o antes → depois por campo com o responsável
      de cada lado. `AuditoriaGeral.tsx` ganhou os dois badges e os dois filtros, mais o
      botão **Visualizar** por linha (`ModalLog`) — a tabela corta `detalhes` e `motivo`
      em duas linhas, e é justamente ali que mora o antes → depois. No modal, `detalhes`
      é quebrado pelos separadores que a lib grava (`" | "` entre blocos, `" ; "` entre
      mudanças de campo), então cada alteração aparece em uma linha própria.
- [x] **Auditoria mostra o NOME do paciente, e a busca acha por ele** —
      `AuditController.listar` devolve `animalNome` (uma consulta pelos ids DA PÁGINA;
      `AuditLog.animalId` é solto, sem FK, então não há include a fazer) e o filtro
      `?busca=` resolve antes os ids dos animais cujo nome casa, escopados à empresa,
      acrescentando `{ animalId: { in: [...] } }` ao OR. Coluna **Paciente** na tabela e
      linha no card mobile. Animal já excluído aparece como "Paciente excluído".
- [x] **Nenhuma referência NUMÉRICA na tela de auditoria** (decisão de 2026-08-04) —
      saíram os `#65` do modal, da tabela e dos cards, e também dos TEXTOS gravados:
      `action` virou `"CATEGORIA ENTIDADE"` (o id já é a coluna `entidadeId`), `origem`
      virou `"evolução assumida"` / `"agendamento transferido"`, e as chaves de campo do
      item de prescrição viraram `item.dosagem` em vez de `item#12.dosagem`.
      ⚠️ `nomeDoUsuario` passou a devolver SÓ o nome. Efeito colateral aceito: dois
      profissionais homônimos ficam indistinguíveis DENTRO de `detalhes` (quem executou
      a ação segue identificado pelas colunas `userId`/`email` da linha; o que se perde é
      o id do "de quem → para quem"). As colunas `entidadeId`/`animalId` continuam
      gravadas — o que mudou é só o que a tela e o texto exibem.
      Linhas ANTIGAS mantêm o texto com `#` NO BANCO — o AuditLog é imutável e reescrevê-lo
      seria adulterar a auditoria. Quem resolve isso na tela é `semReferencias()`
      (`AuditoriaGeral.tsx`), uma limpeza de APRESENTAÇÃO aplicada a `action` e `detalhes`,
      que cobre o histórico inteiro. NÃO se aplica a `motivo`: ali é o texto que o usuário
      digitou, e mexer nas palavras dele numa tela de auditoria é pior do que exibir um "#".
      ⚠️ O `;` ficou FORA da regra de pontuação do saneador de propósito — `" ; "` é o
      separador entre mudanças de campo, e colá-lo na palavra anterior quebraria o split
      de `DetalhesFormatados` (o modal voltaria a mostrar tudo numa linha só).
- [x] **Colunas "Registro" e "Justificativa" saíram da grade** (tabela e cards): eram
      textos longos cortados em duas linhas, ilegíveis nos dois formatos. Continuam
      INTEIROS no modal Visualizar e continuam alcançáveis pela busca — o `?busca=` do
      backend não mudou, segue varrendo `motivo` e `detalhes`.
- [x] **Erro do modal vai ABAIXO do botão que o disparou** (Agenda) — refina a regra de
      2026-07-28 ("erro na superfície da ação"): não basta estar NO modal, tem de estar
      onde o clique aconteceu. No **Reagendamento** o `InlineError` ficava no topo do
      formulário, atrás do calendário e da grade de horários; como o modal ROLA, quem
      clicava em "Confirmar" no rodapé não via nada acontecer. Passou para depois dos
      botões, com `erroReagRef` + `scrollIntoView({ block: 'nearest' })` — só posicionar
      não bastava, porque o erro nasce no fim do formulário e pode cair fora da dobra.
      Mesmo tratamento em **Trocar profissional** e **Transferir agenda do dia**, que
      compartilham o `erroModal`. Padrão para modal novo: erro depois do rodapé; se o
      corpo rolar, traga-o para a vista.
- [x] **Status `TRANSFERIDO` virou `REAGENDADO`** — é o que a ação faz: o atendimento foi
      remarcado, não transferido para outro profissional (isso é a troca de vet, outra
      coisa). `AgendamentoController`: `REAGENDADO` entrou em `STATUS_VALIDOS` e em
      `STATUS_LIVRES`; `handleReagendar` grava o nome novo.
      ⚠️ **`TRANSFERIDO` continua aceito e continua em `STATUS_LIVRES`** — é LEGADO puro.
      Tirá-lo faria todo agendamento já reagendado voltar a OCUPAR a grade e a bloquear o
      horário que ele mesmo liberou. Nada novo nasce com ele.
      No front, `foiReagendado(status)` cobre os dois nomes e o rótulo do legado exibe
      "REAGENDADO" — o usuário não deve ver dois nomes para o mesmo estado.
      Propagado para as OUTRAS 3 telas que tratam esse status e que quebrariam calado
      (`STATUS_CLS[status]` undefined → badge sem estilo): `SubModuloMinhaAgenda`,
      `AnimalDetail` e `MapaAtendimento`.
- [x] **Lista do dia mostra só o que está em aberto** — `STATUS_ABERTOS = ['AGENDADO',
      'EM_ANDAMENTO', 'ATRASADA']` é o padrão, com o seletor de status no cabeçalho da
      lista (não no bloco "Filtros" acima, que governa a grade do Expediente Ativo):
      **Em aberto** · **Todos os status** · grupo "Somente" com `STATUS_FILTRAVEIS`
      (Concluído, Finalizado, Cancelado, Reagendado). Quem decide é `statusCasaFiltro()`.
      ⚠️ A opção **Reagendado casa TAMBÉM com o legado TRANSFERIDO** — é o mesmo estado,
      e sem isso os registros antigos ficariam inalcançáveis por qualquer filtro.
      `TRANSFERIDO` não aparece como opção própria: seriam dois nomes para uma coisa só.
      ⚠️ **ATRASADA ENTRA em `STATUS_ABERTOS`** — tentei deixá-la fora (o pedido dizia
      "somente AGENDADO e EM ANDAMENTO") e quebrou na hora: para esta tela ATRASADA **é**
      um agendado — `isAgendado` (nas duas listagens) vale para `AGENDADO || ATRASADA`, e
      é ele que libera Iniciar, Reagendar, **Transferir** e Cancelar. Escondê-la sumia com
      a LINHA INTEIRA e com todos esses botões, no atendimento que passou da hora e é
      justamente o que precisa de ação — bastava o cron rodar para o registro
      desaparecer da agenda sem ninguém ter feito nada. Filtro novo nesta tela: confira
      antes o que `isAgendado` inclui.
      O vazio da lista distingue os dois casos: "nenhum agendamento para esta data" ×
      "nenhum em aberto" + atalho "Ver todos os status (N)". Sem isso, um dia inteiro de
      atendimentos concluídos apareceria como dia vazio, sem pista do filtro ativo.
- [x] **Combo de animal do agendamento deixava trocar a escolha errada** — ao escolher, o
      campo passa a conter o RÓTULO (`"Mel (Haras H.P.)"`), e `animaisCombo` filtrava
      `a.nome.includes(comboQuery)`: `"mel".includes("mel (haras h.p.)")` é FALSE, então
      reabrir o combo mostrava "Nenhum animal encontrado" e o paciente ficava travado na
      primeira escolha. Agora o rótulo sai de `rotuloAnimalCombo()` (fonte única, usada
      na escrita E no reconhecimento) e, enquanto o texto for o rótulo do já selecionado,
      ele não conta como busca — a lista inteira segue disponível. `onFocus` também
      seleciona o texto, para digitar por cima trocar direto.
      Regra para combobox novo: se o campo exibe um RÓTULO diferente do que o filtro
      compara, o filtro precisa saber disso — senão a seleção vira uma armadilha.
      ⚠️ E o combo abre por **`onClick` ALÉM de `onFocus`**: a opção é escolhida num
      `onMouseDown` com `preventDefault()`, então o foco NUNCA sai do input — e `focus`
      não dispara de novo num campo já focado. Só com `onFocus`, clicar no campo depois
      de escolher não reabria a lista. Combobox novo com seleção por mousedown precisa
      dos dois.
- [x] **"Transferir" sumia da linha enquanto as outras ações apareciam** — `podeTransferir`
      exigia `ag.veterinario?.id === meuUserId`, mais estreito que o `ehMinhaAgenda` que
      governa Iniciar/Reagendar/Cancelar (este cobre também o agendamento SEM profissional
      e o que a pessoa criou). No agendamento "Não atribuído" a linha oferecia tudo, menos
      justamente o Transferir. Agora as ações da linha compartilham a MESMA base.
      No backend, `atualizar` recusava o mesmo caso porque `Number(null)` é `0` e nunca
      bate com o id do usuário: atribuir profissional a um agendamento SEM responsável não
      é transferir a agenda de ninguém, então `semResponsavel` sai do bloqueio.
      Regra: ação da linha que use base de autoria diferente das vizinhas vira "botão que
      falta" — confira `ehMinhaAgenda` antes de inventar outro predicado.
- [x] **Assumir agendamento vale para EM_ANDAMENTO**, igual ao assumir da EVOLUÇÃO.
      `AgendamentoController.assumir` aceitava só `['AGENDADO','ATRASADA']` e o front
      prendia o botão a `isAgendado` — bastava o outro profissional clicar em "Iniciar"
      para o atendimento ficar preso a ele na agenda, justamente o caso em que assumir
      importa (o colega começou e precisou sair). Janela final: AGENDADO, ATRASADA,
      EM_ANDAMENTO. O status entrou PARA DENTRO de `podeAssumir` para não haver duas
      regras entre a listagem mobile e a desktop.
      ⚠️ A linha EM_ANDAMENTO tem `onClick` próprio (continuar o atendimento): o wrapper
      das ações ganhou `stopPropagation`, senão clicar em Assumir também navegaria para a
      evolução e tiraria o usuário da agenda no meio da ação.
      ⚠️ **Agendamento SEM profissional também se assume.** `podeAssumir` exigia
      `!!ag.veterinario?.id` e escondia o botão no "Não atribuído" — justamente onde
      assumir faz mais sentido (não há de quem tomar; a pessoa só passa a responder por
      ele). O backend já aceitava: `Number(null)` nunca bate com o id de ninguém, então
      não cai no "já é seu". A única exclusão é o que JÁ É MEU.
- [x] **Ações da agenda: um gate só (`podeOperarLinha` = `podeGerenciar && ehMinhaAgenda`)**
      — Iniciar, Reagendar, Transferir, Cancelar (+ "Transferir dia inteiro") e, sem a
      parte de autoria, Assumir. Antes havia DUAS regras na mesma linha: Iniciar/
      Reagendar/Cancelar só olhavam `podeGerenciar` (criar OU alterar OU excluir),
      enquanto Assumir/Transferir exigiam `atendimento.agendamentos.editar` isolado — por
      isso sumiam sozinhos e a linha oferecia tudo, menos esses dois.
      ⚠️ **NÃO fechar o gate em `podeEditarAgendamento`.** Foi tentado em 2026-08-04 (a
      justificativa era boa: as rotas `PATCH /:id`, `/:id/status` e `/:id/assumir` exigem
      TODAS o slug `editar`) e o resultado foi sumir com TODAS as ações da tela em base
      real — o mapa de permissões não entrega `editar` para o perfil em uso. Apertar o
      front antes de a matriz estar coerente deixa o usuário sem saída E sem mensagem.
      Quem barra é o BACKEND, e o 403 agora chega com o texto certo (o interceptor de
      `api.ts` preserva a mensagem do servidor), dizendo qual permissão falta.
      ⚠️ PENDENTE: descobrir por que `podeExecutar('atendimento.agendamentos.editar')` é
      falso onde `criar`/`deletar` são verdadeiros — o seed dá PROPRIO para VET e
      ESTAGIARIO. Suspeitos: o módulo virtual `agenda` do ControleAcesso (extrai
      `agendamentos` de `atendimento`) e o que `minhas-permissoes` devolve para esses
      slugs. Enquanto isso, o gate permissivo mantém a tela utilizável.
- [x] **Auditoria em TODA mudança de status do agendamento** — `atualizarStatus` só
      registrava quando o status caía em `STATUS_LIVRES` (como CANCELAMENTO): iniciar,
      concluir e finalizar passavam sem rastro. Agora a escrita e o registro estão na
      MESMA transaction, e a categoria segue o significado: `CANCELADO` → CANCELAMENTO
      (com justificativa); qualquer outro → ALTERACAO com o antes → depois.
      ⚠️ REAGENDADO **não** entra como CANCELAMENTO, embora esteja em `STATUS_LIVRES`:
      libera o horário mas não é desistência, e contá-lo como cancelamento distorceria
      o relatório gerencial.
- [x] **Categoria `CRIACAO`** (`lib/auditoria.js`) + registro em
      `AgendamentoController.criar`. Sem ela a trilha tinha buraco: dava para ver o
      cancelamento de um agendamento que, para a auditoria, nunca existiu. Badge e filtro
      próprios em `AuditoriaGeral.tsx`.
      ⚠️ PENDENTE: só o AGENDAMENTO registra CRIACAO. Evolução, prescrição, exame,
      encaminhamento e vacina continuam sem rastro de criação — aplicar o mesmo padrão
      quando cada um for tocado.
- [x] Caixa do modal de auditoria em **emerald-700** (era `gray-800`).
- [x] **Front espelha a autoria** em Evolução (`ehMinhaEvolucao`, fonte única da tela),
      Prescrição, Exames e Vacina — Encaminhamento já tinha. `abrirEdicao` da evolução
      abre em SOMENTE LEITURA no registro de outro (o `editItemId` do Histórico era a
      porta dos fundos). O botão **assumir** usa o nível cru, não a autoria.
- [x] **"Finalizar Atendimento" do banner do shell** (`Atendimento.tsx`) — o gate era só
      `podeFinalizarEvolucao`, sem autoria, e o botão aparecia no atendimento de outro.
      Duas correções na mesma raiz:
      1. `EvolucaoAtiva` passou a carregar **`veterinarioId`** (em `Atendimento.tsx` E em
         `SubModuloEvolucao.tsx`, que alimenta o shell por `onEvolucaoChange`) — sem esse
         campo o shell não tinha como decidir. Gate: `podeFinalizarEvolucao &&
         evolucaoAtivaEhMinha(evolucaoAtiva)`.
      2. ⚠️ `carregarEvolucaoAtiva` buscava `status=EM_ANDAMENTO&limit=1` e adotava
         `dados[0]`. Com atendimento em PARALELO o animal tem mais de uma evolução
         aberta, e "a primeira" podia ser a de OUTRO — o shell então vinculava a ela a
         prescrição/vacina/exame lançados ali e oferecia o Finalizar alheio. Agora
         `limit=20` + **a MINHA vence**, mesma regra que `carregarEvolucoes` já aplicava
         no `onEvolucaoChange` (CLAUDE.md, sessão 2026-07-29).
      O guard de `handleFinalizarAtendimento` deixou de ser `isFornecedor && …` (resquício
      da regra por userType) e passou a valer para todo perfil não-gestor, relendo o dono
      do servidor — entre abrir o banner e clicar, outra pessoa pode ter assumido.
- [x] **Ações do AGENDAMENTO seguiam sem autoria** (`Agendamentos.tsx`): Iniciar,
      Reagendar e Cancelar apareciam para qualquer um com `podeGerenciar` — só
      "Transferir" checava. Novo `ehMinhaAgenda(ag)` (espelho do `podeOperarAgendamento`
      do backend: responsável OU criador, mais o gestor) gateia os três, nos dois blocos
      (cards mobile + tabela desktop), e `handleIniciarAtendimento` ganhou o mesmo guard —
      iniciar o agendamento de outro abriria uma evolução na agenda dele.
      Agendamento SEM profissional definido continua operável: não é de ninguém, e
      travá-lo deixaria a linha sem nenhuma ação fora do gestor.
      `MinhaAgenda` segue sem gate porque o não-gestor só enxerga os próprios (ver
      pendência abaixo).
- [x] **Seletor de "Status" REMOVIDO do formulário da evolução** — ele aparecia ao editar
      (`{editingId && …}`) e deixava escolher FINALIZADA/CANCELADA na mão. Era um desvio
      dos botões: marcar "Cancelada" + Salvar cancelava o atendimento **sem a
      justificativa obrigatória** que o `ModalJustificativa` e a auditoria exigem, e sem
      passar pelo gate de `*.deletar`/`*.finalizar`. O `PUT` do Salvar passou a enviar
      `editingEv.status` (preserva o que a evolução já tem) em vez de `form.status`.
      ⚠️ Não reintroduzir: o status é CONSEQUÊNCIA da ação (Salvar / Finalizar / Cancelar),
      cada uma com o seu gate. `STATUS_OPTIONS` segue existindo — é o filtro da lista.
- [x] **Assumir não abre mais o formulário de edição** — `handleAssumirEvolucao` chamava
      `abrirEvolucaoPorId` (removida junto, era o único uso) e jogava o usuário direto no
      editor. Assumir é passar a RESPONDER pelo atendimento, não necessariamente escrever
      nele agora: a lista recarrega, a evolução já aparece como sua com as ações
      liberadas, e quem quiser escrever clica em Alterar. O `assumir` da agenda
      (`Agendamentos.handleAssumir`) nunca abriu nada — só recarrega a lista.
- [x] Testes: `backend/src/__tests__/autoriaAtendimento.test.js` — 14 casos cobrindo a
      matriz de autoria (incl. "FULL da matriz NÃO é gestor") e o arrasto (órfão arrastado,
      inativo ignorado, evolução finalizada preservada). Suíte completa: 70 testes passando.
- [ ] `MinhaAgenda` não precisou de gate por autoria porque o não-gestor só enxerga os
      próprios agendamentos (`agendamentosFiltrados`). Se um dia essa lista passar a
      mostrar a equipe inteira, os botões de ação precisam do `meuRegistro` junto.
- [ ] `PrescricaoController` (itens LEGADOS, sem grupo) recebeu a assinatura nova mas não
      foi revisado quanto ao arrasto — item legado não tem `evolucaoId`, então não é
      alcançado por `transferirFilhosDasEvolucoes`. Avaliar se ainda há base com esses itens.
- [ ] Rever se `Prescricao.veterinarioId` do ITEM deveria seguir o dono do GRUPO também no
      `adicionarItem` (hoje o item novo nasce com quem o incluiu; o `finalizar` uniformiza
      tudo depois, então não há efeito prático — mas é uma inconsistência latente).

#### Exame de Compra: camada de VISUALIZAÇÃO (mesma sessão)
- [x] **A tela abre em LEITURA, não em formulário** (`ExameCompra.tsx`). Ordem:
      card do paciente → barra com as 4 abas (Clínico Geral · Fisiologia · Músculo
      Esquelético · Imagem) **desabilitadas** e o botão **Novo Exame** à direita, na
      MESMA linha → **Histórico de Exames de Compra**. Cancelar/Salvar só existem no
      formulário, que entra por "Novo Exame" (cadastro) ou pelo lápis do histórico
      (edição). **A lógica de gravação não mudou** — é camada de apresentação.
      ⚠️ O botão fica FORA do container `overflow-x-auto` das abas (que rolam no
      mobile), senão sairia da tela junto com elas. E há uma SEGUNDA cópia dele dentro
      do card de estado vazio: sem laudo nenhum a barra de abas não é renderizada, e o
      cadastro ficaria sem porta de entrada.
- [x] **Em leitura a barra de abas é CINZA** (inativa `bg-gray-100`, ativa
      `bg-gray-600`); em edição continua emerald. É exceção deliberada à regra "cinza =
      indisponível" da §6: ali não há ação sobre o registro, é navegação entre seções de
      um laudo fechado — e o cinza é o que diferencia, à primeira vista, a tela que só
      lê da que edita. O "Novo Exame" segue emerald: ele É uma ação disponível.
- [x] **O read-only é um `<fieldset disabled>` em volta do conteúdo das abas**, não uma
      prop `somenteLeitura` em cada campo: são ~320 linhas de inputs/botões, e o
      `disabled` do fieldset propaga pelo DOM para todo controle descendente — inclusive
      para o TECLADO, que um `pointer-events-none` deixaria passar. Duas armadilhas:
      as ABAS ficam FORA dele (trocar de aba é navegação, e em leitura elas seguem
      clicáveis), e o fieldset leva `min-w-0` (o UA aplica `min-inline-size: min-content`
      e o grid das abas estoura sem isso).
      ⚠️ NÃO usar `className="contents"` no fieldset: `space-y-*` é um seletor de FILHO
      DIRETO no DOM (`> * + *`), e `display: contents` some com a caixa no layout mas não
      na árvore — o espaçamento interno sumiria (mesma raiz da armadilha 39).
- [x] `editingId` continua sendo "qual laudo está carregado nos campos"; quem separa
      EXIBIR de EDITAR é o `modoForm`. Sem ele, o `editingId` de um laudo apenas
      visualizado faria o Salvar virar um PUT silencioso sobre ele.
- [x] Cancelar **volta à visualização** do último laudo (antes só zerava os campos e
      deixava o formulário aberto e vazio). Salvar volta ao laudo GRAVADO — `idSalvo` é
      lido antes do `resetForm`, senão editar um laudo antigo cairia no mais recente da
      lista e pareceria que a alteração não pegou.
- [x] Histórico ganhou o **olho** (visualizar, emerald) ao lado do lápis, e os selos
      "Em exibição" (emerald) / "Em edição" (âmbar) — com o viewer abrindo no laudo mais
      recente, sem isso não havia como saber QUAL registro está nas abas nem alcançar um
      antigo sem abrir o formulário.
- [x] **Campo "Data do Exame" REMOVIDO da tela.** A data continua existindo (é a chave
      da regra de duplicidade, armadilha 29-b): laudo novo nasce com HOJE e a edição
      preserva a data de origem.
      ⚠️ Consequência: não há mais como lançar laudo RETROATIVO pela tela (exame feito
      ontem, digitado hoje). Se isso voltar a ser necessário, o caminho é um "ajustar
      data" na edição — o backend já aceita `dataSolicitacao` no PUT.

#### Tela do Animal: telefone do proprietário e rodapé (mesma sessão)
- [x] **`GET /users/buscar-proprietario` lia nome e telefone do `users`** — violação
      direta da regra do §36 ("NUNCA leia nome/telefone/endereço/documento de `users`
      numa tela de empresa"). O `users` só recebe uma CÓPIA na criação do cliente:
      editar o telefone depois grava no perfil, e cliente que já existia e foi cadastrado
      por esta clínica nem toca o `users`. Resultado: ao digitar o e-mail de um cliente
      já cadastrado, o formulário do animal trazia o telefone VAZIO — ou o número que
      OUTRA clínica cadastrou. Agora passa por `aplicarPerfilProprietario(user,
      req.empresaId)` e devolve `phone2` junto.
- [x] **Telefone 1 e 2 passaram a ser EDITÁVEIS** no formulário do animal, inclusive com
      proprietário já cadastrado e na edição (`/animais/:id`) — antes era
      `disabled={isEditMode || proprietarioExistente === true}`. Nome e e-mail continuam
      travados: identidade do cliente é assunto do Cadastro de Cliente; o contato muda o
      tempo todo e é o que a clínica corrige na hora.
      Persistência no **perfil DESTA empresa**, nunca no `users`: em `criar`,
      `garantirPerfil` PRESERVA o perfil existente, então o telefone digitado era
      descartado em silêncio — passou a haver um `salvarPerfil` só com o contato logo
      depois; em `atualizar`, que nem lia `req.body.proprietario`, foi adicionado o mesmo
      bloco (o front agora envia `proprietario: { phone, phone2 }` na edição).
      ⚠️ Campo VAZIO é ignorado nos dois: salvar o animal com o telefone em branco não
      pode apagar o número que a clínica já tem. Para limpar, o caminho é o Cadastro de
      Cliente.
      ⚠️ `garantirPerfil` ANTES do `salvarPerfil` em `atualizar`: cliente LEGADO pode não
      ter perfil na empresa, e um upsert só com o telefone criaria a linha com
      `fullName` nulo — que, pela regra do §36 (null = vazio NAQUELA empresa), APAGARIA
      o nome do cliente na clínica.
- [x] `ANIMAL_INCLUDE` passou a trazer `user.phone2` — sem ele o Telefone 2 abria vazio
      na edição e o segundo número se perdia ao salvar. `propTelefone` entrou na
      validação de submit também no modo edição, já que a tela agora grava o campo.
- [x] **Rodapé no padrão da aplicação** (`Animal.tsx`): **Cancelar** + **Salvar** à
      direita, tamanho padrão. Sai o botão de largura total (`w-full py-3.5`, texto
      `md:text-lg`) que destoava das demais telas. O rótulo é **Salvar** no cadastro e na
      edição — "Salvar e Continuar", "Atualizar Animal" e "Cadastrar Animal" diziam de
      novo o que o cabeçalho já diz. O texto do estado BLOQUEADO ("Animal já com sua
      equipe") FICA: ali o botão está desabilitado e a frase é a única explicação.

#### Profissional que TAMBÉM é cliente da própria clínica (mesma sessão)
- [x] **A tela de Proprietários filtrava por `users.userType === 'PROPRIETARIO'`** — o
      tipo GLOBAL, que vale para todas as empresas (armadilha 36-e). Quem era cliente e
      virou GESTORA da mesma empresa desaparecia da lista: `incluirMembroDireto` troca o
      `userType` global para VETERINARIO, e o cadastro de cliente + o animal ativo na
      empresa deixavam de contar. Novo `whereEhClienteDaEmpresa(empresaId)`
      (`ProprietarioController`): é cliente aqui quem tem `userType` PROPRIETARIO **OU**
      `ProprietarioPerfil` nesta empresa **OU** vínculo `UsuarioEmpresa` com perfil
      PROPRIETARIO **OU** animal ATIVO aos cuidados da empresa. Sempre em AND com
      `whereProprietarioNoEscopo` (um diz "é cliente", o outro "é cliente DAQUI").
      Aplicado em `listar`, `obterPorId`, `atualizar`, `toggle` e `removerDaEmpresa` —
      sem os quatro últimos a pessoa apareceria na lista e daria 404 ao abrir.
      ⚠️ Sem empresa no contexto (ADMIN de plataforma) continua valendo o `userType`
      global: não há empresa para resolver.
- [x] **`criar` recusava com 409 "E-mail já cadastrado"** quem já existia com outro
      `userType` — ou seja, não dava para cadastrar como cliente a pessoa que trabalha
      na clínica. O bloqueio saiu.
      ⚠️ `UsuarioEmpresa` é UMA linha por (usuário, empresa) e guarda UM `perfil`: gravar
      `perfil: 'PROPRIETARIO'` ali REBAIXARIA a gestora a cliente na própria clínica.
      Agora o perfil profissional VENCE (só se grava PROPRIETARIO quando não há vínculo
      profissional); quem registra o lado cliente é o `ProprietarioPerfil`, tabela à
      parte. Regra geral: **o vínculo carrega o papel PROFISSIONAL; ser cliente é um
      cadastro paralelo, não um cargo.**
- [ ] `FaturaController.listarProprietarios` e o `OrcamentoController` já derivam os
      clientes dos ANIMAIS (não do `userType`), então a pessoa aparece lá sem mudança.
      `VeterinarioController.listarProprietarios` e `DashboardController` ainda contam
      por `userType` global — revisar quando forem tocados.

#### `/execucao-prescricao` vazava paciente de OUTRA empresa (mesma sessão)
- [x] **A prescrição do plantão nunca era filtrada por empresa.** `listarParaExecucao`
      só aplicava `empresaId` quando ele vinha na QUERY — e o front nunca o manda. O
      escopo por ANIMAL (`buildAnimalScopeWhere`) não cobre isso por DOIS motivos:
      1. para dono/gestor ele inclui os vínculos do vet em **qualquer** empresa (regra
         "base própria vê o co-tratado de outra empresa", §5) — correto na tela de
         Pacientes, vazamento no plantão;
      2. mesmo com o animal certo, o MESMO paciente pode ser tratado por duas clínicas:
         sem filtro no DOCUMENTO, o plantão de uma exibia (e deixava executar) a
         prescrição da outra.
      Agora `whereGrupo.empresaId = req.empresaId`. `empresaId` da query só ESTREITA
      dentro da empresa ativa — tenant vindo do cliente jamais define escopo (mesma
      decisão da busca global, §16). Seguro para o legado: 100% dos `PrescricaoGrupo`
      da base têm `empresaId` gravado.
- [x] **A VACINA do mesmo plantão vazava pelo bypass do GESTOR.**
      `escopoFilhoEvolucaoWhere` devolve `{}` quando `semEscopoClinico(req)` é true — e
      `req.membroCargo === 'GESTOR'` é um dos casos (§35). Sem filtro NENHUM, a fila de
      aplicação listava vacina de todas as clínicas. O bypass continua (ele existe para
      o gestor ver o que a equipe registrou sem depender da resolução de `empresaId`),
      mas agora com um limite de empresa por cima. `VacinaClinica` não tem `empresaId`
      próprio: a tenancy vem da EVOLUÇÃO e, no avulso, da empresa do autor.
      ⚠️ **Regra geral:** `semEscopoClinico` libera AUTORIA, não TENANT. Toda listagem
      que ele atender precisa do seu próprio limite de empresa — vale reauditar os
      outros consumidores (evoluções, exames, encaminhamentos) quando forem tocados.

#### Vacina alinhada à PRESCRIÇÃO — layout e lógica de tela (mesma sessão)
- [x] **O formulário passou a ter 2 linhas** (`SubModuloVacina`): **VACINA · LOTE · VIA
      APLICAÇÃO** (grid 7 = 3+2+2, a mesma proporção de "Medicamento · Dosagem · Via" da
      prescrição) e **TIPO DOSE · QTD DOSES · DATA APLICAÇÃO** (grid 3). Eram três linhas
      com dois campos cada, e a Via ficava longe da vacina a que pertence.
- [x] **Inserir + Finalizar saíram do rodapé e foram para a LINHA DOS CHECKBOXES**,
      encostados à direita (`ml-auto`) — é onde a prescrição os coloca. Com isso o rodapé
      do formulário deixou de existir (não sobra faixa vazia com borda). Editando um item
      da lista, o par vira **Cancelar + Atualizar item**. O container é `items-center`
      pelo mesmo motivo da prescrição: os botões são mais altos que o texto do checkbox.
- [x] **Selo de status virou mapa `STATUS_VACINA` = { label, cls }** (espelho do
      `STATUS_GRUPO`), fonte ÚNICA do selo E das abas de filtro — antes rótulo e cor
      estavam escritos duas vezes e divergiriam na primeira correção. Cores por
      significado: rascunho âmbar, em execução emerald, executado azul, cancelado
      vermelho. Saíram os ícones de dentro do selo e o CAIXA ALTA.
- [x] **Abas de filtro como as da prescrição**: um só realce (emerald), contagem entre
      parênteses e **só os status que existem no histórico** (antes havia 5 abas fixas,
      com realce de cor diferente por aba e badges contadores só em duas delas).
- [x] **Cores das AÇÕES pela regra da §6** — o "Visualizar" do desktop era `text-teal-600`
      e virou emerald; finalizar emerald, imprimir azul, cancelar vermelho, WhatsApp
      verde, e-mail azul. O **número (VC-0000) virou botão** que abre a visualização,
      no desktop e no card mobile — igual ao `#Nº` da prescrição.
- [x] **Erro na superfície da AÇÃO** — o `erroInline` do topo cobria tudo. Agora:
      `InlineError` (topo) só para falha de CARGA; **`ErroAcao` abaixo de
      Inserir/Finalizar** para o formulário (com `classeErro` destacando vacina/dose/via);
      **`ErroAcao` na LINHA** (`erroLinha`/`erroDaLinha`, mesma mecânica da prescrição)
      para finalizar/cancelar do histórico, na tabela e no card.
- [x] Paleta **teal → emerald** em toda a tela e chips do item no markup do `InfoChip`;
      o badge "Proprietário aplica" (violeta) virou **"Proprietário"** em âmbar, como o da
      prescrição.
- [ ] A vacina **não tem ação de ALTERAR** no histórico (a prescrição tem): não existe
      rota de atualização — `routes/vacinaClinica.js` só expõe criar/finalizar/executar/
      excluir. Enquanto não houver `PUT /clinica/vacinas/:id`, o lápis não pode aparecer
      ali (seria botão que só falha depois do clique — antipadrão da armadilha 28-d).

#### Execução de Prescrição: EXECUTAR virou ícone e o Histórico é o último card (mesma sessão)
- [x] **O Nº DA VACINA passou a ter a formatação e a lógica do Nº da PRESCRIÇÃO** —
      `#074`: 3 dígitos com zero à esquerda, `font-mono font-bold text-emerald-700`,
      clicável para o registro de origem. Fonte única no front:
      **`utils/numeroClinico.ts`** (`formatNumeroClinico` / `numeroClinicoComHash`).
      ⚠️ NUNCA montar o número à mão numa tela. O que havia era `VC-0001` — 4 dígitos com
      o `tipoAtendimento` de prefixo, que é o molde do número de ATENDIMENTO
      (`formatAtendimentoNum` → AG-0012, EV-0007): a vacina se disfarçava de atendimento
      e o MESMO registro aparecia como "VC-0004" na lista e "Vacina nº 004" no histórico.
      A coluna `tipo_atendimento = 'VC'` CONTINUA — é ela que separa a sequência da vacina
      em `registrar`; o que mudou é só a exibição.
      Trocado em TODOS os pontos: lista de vacinas (tabela + card), modal de detalhes,
      WhatsApp/e-mail (`*Vacina #074*`, no molde do `montarTextoPrescricao`), impressão,
      fila do plantão (linha + modal de execução) e **Histórico do Paciente**, onde a
      linha ainda dizia **"Nº Atendimento: VC-0004" em teal** — rótulo de outro número.
      Virou "Nº Vacina: #004" em emerald, igual à linha "Nº Prescrição" logo abaixo dela.
      Registro sem número (legado) devolve `null` → a tela mostra "—" e o número deixa de
      ser clicável. **Não se fabrica número a partir do `id`**: id 812 viraria "#812" e
      seria lido como a vacina nº 812 daquele paciente.
      No backend, só o separador do título do histórico mudou (`Vacina nº 004 - Nome` →
      `— Nome`, igual ao da prescrição); a numeração já era `padStart(3)` lá.
- [ ] A descrição do item de VACINA na FATURA segue `[VC-0004] [AG-0012] …`
      (`VacinaClinicaController`, no `darBaixaEFaturar`). Não foi tocada de propósito: é
      texto GRAVADO na linha da fatura, e mudar o formato agora deixaria a base com dois
      padrões sem que ninguém tenha pedido. A prescrição, no lugar equivalente, escreve só
      `[AG-0012]` — a rastreabilidade real é o `FaturaItem.vacinaClinicaId`. Decidir se
      uniformiza (e se vale reescrever as linhas antigas) antes de mexer.
- [ ] `EX-0004` (Nº do EXAME, em `ExamesSolicitadosPanel`) continua no molde de 4 dígitos
      com prefixo, e no Histórico do Paciente o mesmo exame aparece como "Exame nº 003" —
      exatamente a divergência que a vacina tinha. Aplicar `formatNumeroClinico` quando a
      tela de exames for tocada.
- [x] **A linha da fila é UMA SÓ: `LinhaExecucao`** — prescrição e vacina passaram a
      renderizar o MESMO componente (avatar · paciente · **Nº** · **Veterinário
      Responsável** · ações). A vacina tinha um card próprio, sem as duas colunas do
      grid, e as duas listas divergiam a cada ajuste — mesma lição do
      `SubModuloMinhaAgenda` (armadilha 28-g): **para variar o comportamento, passe uma
      prop; não copie a linha.** O que difere vem por prop: `numeroLabel`
      ("Nº Prescrição" × "Nº Vacina"), o destino do número (`/clinica/prescricao/:animalId`
      × `/clinica/vacina/:animalId?item=:id`) e `detalhe` — a linha extra que diz QUAL
      vacina é (a prescrição tem N itens, então não passa nada). As ações vêm por
      `children`. `vcNumDe(v)` é a fonte única do `VC-0000` (linha, modal e impressão).
- [x] **CANCELAR a vacina pelo plantão** — a linha de "Vacinas a aplicar" tinha ver,
      executar e imprimir, mas não o cancelar que a prescrição já tinha ao lado.
      Rota nova `DELETE /clinica/vacinas/:id/cancelar-plantao` → **MESMO controller**
      (`VacinaClinicaController.excluir`) do cancelar da tela de Vacina, logo mesma regra:
      justificativa obrigatória, estorno do `FaturaItem` e das doses ao lote, auditoria
      `CANCELAMENTO` e a checagem de autoria do `podeOperarRegistro`.
      ⚠️ Só o SLUG muda — `enfermagem.prescricao.deletar` em vez de
      `atendimento.vacinas.deletar` — pelo MESMO motivo do `cancelar-plantao` da
      prescrição: quem opera o plantão não tem, nem deveria ter, a permissão de quem
      prescreve. Sem a rota própria o ícone existiria e responderia 403 para o enfermeiro
      (o botão que só falha depois do clique). Front: `ModalJustificativa`, igual ao da
      prescrição.
- [x] **A linha do paciente na fila é "LOCAL • PESO • IDADE"** (`utils/animalInfo.ts` →
      `linhaInfoAnimal`), nas duas listas. Era "Equino • Brasileiro de Hipismo, 600kg" —
      espécie e raça não informam nada numa fila de plantão de equinos, e quem vai aplicar
      precisa saber PARA ONDE ir e o peso da dose. Campo ausente é omitido junto com o
      separador (nunca "• •"). A espécie continua servindo ao rótulo da baia (Baia × Leito).
      O util também recolhe as cópias de `localDoAnimal` (Agendamentos) e `calcularIdade`
      (AnimalCard, AnimaisVet, Animal) — tela nova usa ele, não uma 4ª cópia.
      Backend: `local`, `localizacao`, `dataNascimento` e `idadeAnos` entraram nos selects
      de animal de `PrescricaoGrupoController.listarParaExecucao` **e** de
      `VacinaClinicaController.listarParaExecucao` — os dois alimentam o MESMO componente.
      ⚠️ E `baia: true` foi REABILITADO na prescrição: estava comentado com um
      "reabilitar após prisma generate" antigo, então o selo de baia da linha **nunca
      aparecia** — o componente tinha o selo e o dado nunca chegava. `BuscaGlobalController`
      já seleciona `baia` sem problema, ou seja, o client conhece o campo.
- [ ] `calcularIdade`/`localDoAnimal` seguem duplicados nas 4 telas antigas; migrar para
      `utils/animalInfo.ts` quando cada uma for tocada.
- [x] **Rodapé dos modais: FECHAR e depois EXECUTAR TODOS** (a ação principal por último,
      à direita, que é onde a mão vai) — a ordem estava invertida no do medicamento. O da
      VACINA passou a ter o mesmo par, e o **spinner do "Executar Todos" só gira quando é
      ele** (`salvando && execItemId == null`), senão girava junto com o de um item.
- [x] **A VISUALIZAÇÃO (olho) da vacina é a mesma do medicamento**: item com a tarja
      "Somente leitura" e rodapé com a tarja âmbar "Execução disponível apenas para hoje",
      sem botões (o X do cabeçalho fecha). O Imprimir saiu do rodapé do modal da vacina —
      o medicamento não tem, e a impressão continua na linha da fila.
- [x] **Duas ações por ITEM nos dois modais: EXECUTAR e CANCELAR.** O do medicamento já
      tinha; a vacina ganhou o cancelar (mesma rota `cancelar-plantao`, mesmo
      `ModalJustificativa`, agora DENTRO do modal).
- [x] **Dentro dos DOIS modais, EXECUTAR deixou de ser botão e virou a ação-ícone da
      lista** (emerald `CheckCircle2`, do lado do item) — dentro e fora do modal a mesma
      ação tem a mesma cara. No do medicamento o rótulo carregava o ESTADO
      ("Executado"/"Aguardando"/"Executando…"); ele agora vem de três lugares: a COR do
      ícone (cinza = ainda não deu o horário — o "indisponível" da §6), o `title` e o
      fundo emerald que o card do item ganha quando executado.
      No da vacina o Executar saiu do RODAPÉ e foi para o lado do item, como no
      medicamento; o rodapé ficou só com Imprimir + Fechar.
      ⚠️ Novo estado `execItemId`: o spinner tem de ser do item CLICADO. `salvando` é do
      modal inteiro e faria todos os ícones girarem — era o defeito do antigo
      "Executando…", que aparecia em todos os botões habilitados.
      ⚠️ **"Executar Todos" (rodapé do modal do medicamento) CONTINUA botão**: é ação em
      LOTE, e como ícone ficaria indistinguível do executar-item ao lado. Se um dia virar
      ícone, precisa de outra pista visual para não se confundir com ele.
- [x] **Executar vacina ABRE UMA TELA** (`ModalExecucaoVacina`), como no medicamento — o
      ícone aplicava direto, e a dose sai do estoque e entra na fatura no mesmo clique,
      sem nenhuma conferência. O modal espelha o do medicamento: cabeçalho do paciente,
      faixa de contexto, corpo com o item e rodapé **Executar + Fechar**, com o erro
      dentro dele. Olho e Executar abrem o MESMO modal; só o olho usa `soVisualizacao` —
      o par `vacModal`/`vacModoVer` é o mesmo `modal`/`modalVer` da prescrição.
      Com isso saiu o `VacinaExecViewModal` (a antiga tela só-detalhes) e o estado
      `erroVacina` — o erro da execução agora mora no modal que a disparou.
- [x] **ORDEM DAS AÇÕES: VISUALIZAR · EXECUTAR · IMPRIMIR · CANCELAR**, nesta sequência,
      na linha da prescrição e no card da vacina (a vacina não tem cancelar ali — o
      cancelamento é na tela de Vacina). ⚠️ A ação que some por falta de permissão **não
      reordena as demais**: a posição de cada ícone é fixa, para a mão do plantonista não
      reaprender a linha a cada perfil. Antes a ordem era executar → cancelar → ver →
      imprimir, com o destrutivo no meio.
- [x] **O botão "Executar" virou ÍCONE** (`CheckCircle2` emerald) na linha da prescrição e
      no card da vacina de `/execucao-prescricao`, ao lado de ver/imprimir/cancelar. O
      gate NÃO mudou: segue `enfermagem.prescricao.executar` (`podeExecutarAcao`), então
      quem não tem a permissão não vê o ícone — nada de botão que só falha depois do
      clique (armadilha 28-d). Sem rótulo visível, `title` + `aria-label` são obrigatórios.
- [x] **Ícone cinza é ação que parece morta** — o olho e a impressora do card da VACINA
      eram `text-gray-400 hover:text-…`; agora nascem pintados (emerald/azul), como na
      linha da prescrição. É a regra da §6, que a seção de vacinas ainda não seguia.
- [x] **`itemPendenteHoje` comparava a data em UTC** (`String(executadoEm).slice(0,10)`).
      Das 21h em diante (BRT = UTC-3) isso já é o DIA SEGUINTE: o item executado à noite
      não contava como feito hoje, a prescrição ficava presa em "a aplicar" e **não descia
      para o Histórico**. Agora a data sai de `dataLocalDe(iso)` (exportada, fuso local) —
      mesma armadilha que `hojeLocalStr` resolve na tela de prescrição.
      ⚠️ Em toda comparação de dia, `executadoEm`/`createdAt` passam por `dataLocalDe`,
      NUNCA por `slice(0, 10)`.
- [x] **O Histórico é SEMPRE o último card da tela** — ordem fixa da coluna:
      *Medicamentos a aplicar → Vacinas a aplicar → Histórico (executadas hoje)*. Seção
      nova entra ACIMA do Histórico; nada é renderizado depois dele.
      O medicamento executado SAI da fila e desce para o Histórico; a **vacina executada
      SOME da tela** — vira `EXECUTADA` e `listarParaExecucao` só devolve `FINALIZADA`
      (comportamento do backend, não mexido).
- [x] Chip do horário no modal: o horário DA VEZ virou **âmbar** (pendente). Ele era
      `teal-600` ao lado do feito em `emerald-500` — com a paleta unificada em emerald os
      dois virariam verdes vizinhos, indistinguíveis a um relance.
- [ ] O botão **por item DENTRO do modal** de execução continua textual
      (`Executar`/`Executado`/`Aguardando`/`Executando…`): ali o rótulo carrega o ESTADO,
      que um ícone sozinho não comunica. Se for para virar ícone também, o "Aguardando"
      precisa de outra pista visual antes.

#### Painel Principal: a execução do dia INTEIRA, com os popups do plantão (mesma sessão)
- [x] **A "Fila de execução por localidade" traz TUDO que se aplica hoje** — prescrições
      (só o que ainda falta, por `itemPendenteEm`) **e vacinas** (`/clinica/vacinas/para-execucao`,
      o mesmo endpoint do plantão). Cada parada tem selo Med/Vacina e as MESMAS ações, na
      mesma ordem e cores: **executar** (emerald) e **cancelar** (vermelho, com
      justificativa pelas rotas `cancelar-plantao`).
- [x] **Executar abre o POPUP de execução** — `ModalExecucao` / `ModalExecucaoVacina`
      **importados de `ExecucaoPrescricao`**, não reimplementados. O painel antes só
      NAVEGAVA para `/execucao-prescricao`.
      ⚠️ **A tela de retorno é sempre a CHAMADORA**, e é assim porque o popup abre SOBRE a
      tela e é ela que recarrega no `onClose`: executou pelo painel, volta ao painel;
      executou pelo plantão, volta ao plantão. **Nunca navegar para outra tela para
      executar** — isso troca a tela de retorno e é justamente o que foi corrigido.
- [x] `itemPendenteEm(item, data)` foi EXPORTADO de `ExecucaoPrescricao` e é a fonte única
      de "o que falta hoje". O painel tinha a sua própria versão, com o bug de UTC que já
      havia sido corrigido do outro lado (`toISOString().slice(0,10)`); duas definições
      divergiriam de novo na correção seguinte. `hojeISO()` do painel agora é `localToday`.
- [x] **Resumo de farmácia virou CHECKLIST DE SEPARAÇÃO**: uma linha por item, no formato
      **[checkbox] [qtd] [medicamento ou vacina]**, cobrindo medicamentos E vacinas do dia.
      Itens iguais em prescrições distintas viram UMA linha somada (duas amoxicilinas →
      qtd 2) — é lista de separação, não extrato de prescrição. Procedimento não entra
      (não se carrega no carro).
      O checkbox é só CONFERÊNCIA — não executa nada e não toca no estoque; quem faz isso
      é a execução, na fila ao lado. Estado em `localStorage` **por dia**
      (`s2vet_farmacia_separados_<AAAA-MM-DD>`): o painel recarrega o tempo todo e perder o
      que já foi conferido tornaria o checklist inútil; a chave do dia também é a faxina.
      A soma da DOSAGEM aparece à parte e só quando todas as linhas somadas são numéricas —
      "1 ampola" não soma com "2 mL", e total errado em lista de separação é pior que
      nenhum.
- [x] O local de cada parada sai do PRÓPRIO animal dos endpoints da fila, com `/animais`
      como reserva. ⚠️ A combinação é campo a campo com `??` — `{ ...reserva, ...daFila }`
      APAGARIA o valor da reserva, porque a chave existe com `null` na fila.
- [x] Linha do resumo de farmácia é UMA SÓ, com o mesmo separador:
      **`1x • Acetilcisteína - xarope • 10 mL no total`** — quantidade na frente, no mesmo
      tamanho de fonte do item e sem negrito.
- [x] **Recarga automática a cada 2 min** e o botão **Atualizar REMOVIDO** — o painel fica
      aberto o dia todo e precisa refletir o que a equipe executou. Fica só a hora da
      última carga no cabeçalho, que é como se sabe que ele está vivo.
      ⚠️ O tique NÃO recarrega com POPUP ABERTO: `carregar()` troca `grupos`/`vacinas`, e
      puxar o dado debaixo de um diálogo em uso é receita de execução no registro errado.
      Ao fechar o popup a tela já recarrega (é o `onClose`), então nada se perde.
- [x] Atalho **Mapa de atendimento** e botão **Cadastrar nova ocorrência** removidos (a pedido).

#### Painel Principal no padrão da aplicação (mesma sessão)
- [x] `/painel-principal` foi alinhada à tela de referência **`/equipe`**: **`BotaoVoltar`**
      (não tinha), `InlineError` logo abaixo, cabeçalho `h1` com ícone emerald + subtítulo
      (data por extenso · CRMV · selo de pendências) e a ação da tela — **Atualizar** — à
      direita, no botão padrão. Conteúdo em cards brancos direto na página.
- [x] **Saíram a barra escura do topo e a do rodapé** (`bg-emerald-900`) e a moldura
      `rounded-3xl` cinza que embrulhava tudo. A barra do topo repetia NOME e PERFIL do
      usuário, que são do `AppHeader`; a do rodapé competia com o `AppFooter` — os dois são
      do SHELL (§16) e a tela não repete o que ele já mostra. Os 3 atalhos daquela barra
      viraram botões secundários no fim do conteúdo.
- [x] **Loading no padrão**: o spinner ocupa a área do conteúdo e o cabeçalho continua na
      tela (antes a página inteira era substituída pelo spinner, e o usuário perdia até o
      botão Voltar durante a carga).
- [x] Avatar do paciente na fila passou a ser o **`FotoAnimal`** — a inicial do nome era
      exatamente o vazio que aquele componente veio unificar.
- [x] O relógio de 30s virou 60s e só mantém a DATA correta na virada da meia-noite: a
      HORA saiu do cabeçalho junto com a barra escura.

#### Ajustes de UI e mensagem (mesma sessão)
- [x] **Máscara no valor de pagamento** (`UsuarioFormModal`): salário/valor fixo →
      `000.000,00`, percentual → `00,00` (teto 100). Digitação da DIREITA para a esquerda,
      como caixa/ERP. Trocar R$ ↔ % **remascara** o que já está digitado — senão
      "3.500,00" sobrevivia como percentual. Helpers: `mascaraMoeda`,
      `mascaraPercentual`, `mascaraValorPagamento`, `valorPagamentoNumero`,
      `formatarValorSalvo`.
      ⚠️ O submit já não podia usar `String(v).replace(',', '.')`: com separador de milhar
      isso vira `"3.500.00"` → `NaN`. O modal agora emite número puro
      (`String(valorPagamentoNumero(...))`), que é o que `Equipe`/`ControleAcesso`
      consomem com `Number(...)`.
      ⚠️ E a hidratação da EDIÇÃO passa pelo `formatarValorSalvo`: o valor salvo chega como
      número cru ("3500") e a máscara o leria como 35,00 — o salário do membro cairia
      sozinho no salvar seguinte.
      Escolha registrada: o pedido escreveu o percentual como `00.00`, mas as duas
      máscaras dividem o MESMO input (ele troca de formato conforme R$/%); com
      separadores decimais diferentes o campo mudaria de idioma ao trocar o seletor ao
      lado. Ficou vírgula nos dois.
- [x] **Login: "Usuário ou Senha Inválidos"** — `auth/UserController.login`, nos DOIS
      caminhos (e-mail inexistente e senha errada). Continuam com a MESMA mensagem de
      propósito: separá-las transforma o login num verificador de cadastro (enumeração
      de usuário). O front já tinha esse texto como fallback; o backend é que mandava
      "Credenciais inválidas" e vencia.
- [x] **Botão Sair FORA do dropdown** (`AppHeader`), ao lado do menu do usuário — ícone
      só no mobile, ícone + rótulo no desktop, com `title`/`aria-label`. Continua também
      dentro do menu? **Não**: ficaria duplicado. Sair é a ação mais frequente do header
      e não deve custar dois cliques.

---

# Atualizado em: 2026-07-16 (Listagem de animais base × convidado: base própria vê todos os vínculos incl. co-tratados de outra empresa; convidada = isolamento estrito por empresa; designação de prestador escopada ao contexto)
