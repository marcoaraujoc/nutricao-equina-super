---
paths:
  - "**/*Documento*"
  - "**/documento*.js"
  - "**/*Print*"
  - "**/modules/documentos/**"
  - "**/*Emitido*"
  - "**/*Template*"
  - "**/*Compartilhar*"
  - "**/*Midia*"
  - "**/*Export*"
---

# Histórico de decisões — Central de Documentos, folha e impressao

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-08 (parte 2) (DOCUMENTOS: e-mail do veterinário, TIMBRE do
#   estabelecimento e a redação da norma nos termos de consentimento.
#   1. **E-mail do responsável nos 12 modelos** — `{{veterinario.email}}`, novo, no
#      bloco de identificação profissional. Vem de `users` (a identidade do login), o
#      único campo do profissional que NÃO é por empresa (§36-f).
#   2. 🔴 **TIMBRE DO ESTABELECIMENTO NO CABEÇALHO** — razão social, endereço completo,
#      CNPJ, Inscrição Estadual e registro no CRMV, **só quando a clínica é PESSOA
#      JURÍDICA**. Fica no CABEÇALHO, e não no corpo dos modelos, porque precisa
#      alcançar TODO documento — inclusive o que a clínica ENVIOU (que não tem bloco de
#      identificação nenhum) e o que ela redigiu do zero. Mesma razão pela qual a logo
#      mora ali.
#      ⚠️ **Pessoa FÍSICA não ganha timbre**: o S2Vet atende o veterinário autônomo,
#      cuja empresa tem CPF (§5). Imprimir "CNPJ:" e "Inscrição Estadual:" no papel
#      dele afirmaria registro que não existe, num documento com valor legal. Quem
#      decide é o BACKEND (`marca.empresa` é `null`), nunca a tela.
#      ⚠️ O teste de PJ olha o DOCUMENTO, não o `tipoDocumento` sozinho: `cnpj`
#      (legada) e `documento` (cadastro fiscal) convivem, e a base tem linha com uma
#      preenchida e a outra não.
#      ⚠️ Cada linha some sozinha em branco (`linhasDoEstabelecimento`) — nada de
#      "CNPJ: —". É a regra do campo vazio aplicada ao timbre.
#      ⚠️ A razão social só é escrita quando NÃO há logo: com logo ela já apareceu.
#      ⚠️ Viaja na `marca`, logo entra no SNAPSHOT do emitido — reimprimir daqui a dois
#      anos sai com o CNPJ e o endereço DAQUELE dia, não os de hoje.
#   3. 🔴 **COLUNA NOVA `tb_empresas.crmv`** (registro do ESTABELECIMENTO no CRMV) —
#      **MIGRATION GERADA, NÃO APLICADA**: `20260926000000_empresa_crmv`.
#      ⚠️ NÃO é o CRMV de quem assina (`UsuarioEmpresa.crmv`, por profissional e por
#      empresa): a Res. 1.321/2020 pede os DOIS no papel.
#      ⚠️ Lida e gravada por SQL CRU com `catch` (`crmvDaEmpresa` / `$executeRaw`):
#      pelo client tipado, uma base ainda não migrada derrubaria a EMISSÃO de documento
#      e o SALVAR do cadastro da empresa inteiros. Assim o pior caso é a linha não sair
#      no papel. Campo novo em `/configuracoes` (só aparece para CNPJ), opcional.
#   4. **Os 7 termos ganharam o nome completo da norma** ("TERMO DE CONSENTIMENTO LIVRE
#      E ESCLARECIDO PARA…"), e os rótulos de observação passaram à redação da
#      resolução ("Observações de interesse a serem fornecidas pelo(a)…").
#      ⚠️ Os rótulos mudaram nos **12 de uma vez**: eles nascem em UM lugar
#      (`montarBlocos`), e trocar só nos cinco que o pedido nomeou daria DOIS textos
#      para o MESMO campo — o que se lê como defeito, não como escolha.
#      ⚠️ "Realização de Exames" veio SEM o nome de destino no pedido; foi aplicado o
#      padrão dos outros seis. Confirmar.
#   5. **TCLE anestésico** ganhou "Tipo de procedimento Anestésico indicado" como
#      LACUNA — o S2Vet não guarda protocolo anestésico, e apontar para dado "parecido"
#      escreveria no papel uma técnica que ninguém indicou.
#   6. **2 VIAS já funcionavam** e agora têm gate: `viasDoDocumento` lê o rodapé do
#      próprio papel, e os 12 modelos já traziam a frase da norma. O teste trava a
#      frase no seed — some ela, some a segunda via, e nada acusa.
#   🔴 **RE-SEED NECESSÁRIO** (`node backend/seed.js`) para os modelos GLOBAIS ganharem
#   o e-mail, os nomes novos e os rótulos — o upsert por `chave` sobrescreve o global e
#   NÃO toca a cópia personalizada de cada clínica. Suíte: 615. Detalhes na §12.)
---

### Sessão 2026-09-08 (parte 2) — Documentos: e-mail do vet, timbre do estabelecimento e a redação da norma

- [x] **E-mail do veterinário responsável nos 12 modelos** — variável nova
      `{{veterinario.email}}`, no bloco de identificação profissional. O dado já era
      lido por `profissionalDaEmpresa`; faltava expô-lo. Vem de `users` (identidade do
      login), o único campo do profissional que NÃO é por empresa (§36-f).
      ⚠️ Variável nova entra em TRÊS lugares (§12, 03/09): o contexto do backend, o
      `catalogo.ts` do editor e o `VARIAVEIS_VALIDAS` do `documentoLLMService` — sem o
      terceiro a IA não pode usá-la e o teste de resolvibilidade reprova.
- [x] 🔴 **TIMBRE DO ESTABELECIMENTO NO CABEÇALHO, só para PESSOA JURÍDICA.** Razão
      social, endereço completo, CNPJ, Inscrição Estadual e registro no CRMV.
      **Por que no cabeçalho e não no corpo dos modelos:** precisa alcançar TODO
      documento, e o que a clínica ENVIA (PDF/foto convertidos em imagem) não tem bloco
      de identificação nenhum — nem o que ela redige do zero. O cabeçalho é o único
      ponto por onde passam os quatro renderizadores. É a mesma razão da logo.
      ⚠️ **Pessoa FÍSICA não ganha timbre.** O S2Vet atende o veterinário autônomo,
      cuja empresa tem CPF (§5): imprimir "CNPJ:" e "Inscrição Estadual:" no papel dele
      seria afirmar registro inexistente em documento com valor legal. `marca.empresa`
      vem `null` do BACKEND — a decisão nunca é da tela.
      ⚠️ O teste de PJ olha o DOCUMENTO (14 dígitos), não o `tipoDocumento` sozinho:
      `cnpj` (legada) e `documento` (cadastro fiscal) convivem desde 2026-08-16, e a
      base tem linha com uma preenchida e a outra não.
      ⚠️ Cada linha some sozinha quando o cadastro está em branco
      (`linhasDoEstabelecimento`) — nada de "CNPJ: —". Regra do campo vazio (§12,
      26/08) aplicada ao timbre; `cabecalhoVazio` conta as linhas do timbre também.
      ⚠️ A razão social só é escrita quando NÃO há logo: com logo ela já apareceu no
      alto, e repeti-la duplicaria a identificação.
      ⚠️ Viaja na `marca` e portanto entra no SNAPSHOT do emitido — reimprimir daqui a
      dois anos sai com o CNPJ e o endereço DAQUELE dia. Emitido ANTERIOR sai sem
      timbre, que é o correto e não defeito.
      Desenho nos DOIS espelhos de sempre (`CabecalhoFolha.tsx` e
      `DocumentoPrint.ts#cabecalhoHtml`); a REGRA (o que entra, em que ordem, o que
      some vazio) em `cabecalho.ts`.
- [x] 🔴 **COLUNA NOVA `tb_empresas.crmv`** — registro do ESTABELECIMENTO no CRMV.
      **MIGRATION GERADA, NÃO APLICADA**: `20260926000000_empresa_crmv`.
      ⚠️ NÃO é o CRMV de quem assina (`UsuarioEmpresa.crmv`, por profissional e por
      empresa). A Res. 1.321/2020 pede os DOIS registros no papel, e confundi-los faria
      o documento atribuir à clínica o registro de uma pessoa.
      ⚠️ **Lida e gravada por SQL CRU com `catch`** (`crmvDaEmpresa` e um `$executeRaw`
      à parte no `salvar`): pelo `select`/`data` tipado, uma base ainda não migrada
      derrubaria a EMISSÃO de documento e o SALVAR do cadastro da empresa INTEIROS —
      §11, o `generate` falha no Windows com o backend rodando. Assim o pior caso é a
      linha do CRMV não sair no papel.
      ⚠️ String vazia grava NULL: é o que permite APAGAR um registro digitado errado.
      Campo em `/configuracoes`, só visível para CNPJ, opcional.
- [x] **Os 7 termos ganharam o nome completo da norma** ("TERMO DE CONSENTIMENTO LIVRE
      E ESCLARECIDO PARA REALIZAÇÃO DE…"). O título impresso sai do `nome` em caixa
      alta, então biblioteca e papel não podem divergir — há teste para os dois.
      ⚠️ **"Realização de Exames" veio SEM o nome de destino no pedido** (a linha
      terminou no meio). Foi aplicado o padrão dos outros seis — "TERMO DE
      CONSENTIMENTO LIVRE E ESCLARECIDO PARA REALIZAÇÃO DE EXAMES". Confirmar.
- [x] **Rótulos de observação na redação da resolução** — "Observações de interesse a
      serem fornecidas pelo(a) Médico(a) Veterinário(a):" e "…pelo(a)
      tutor(a)/proprietário(a)/responsável:".
      ⚠️ **Mudaram nos 12 de uma vez.** O pedido nomeou cinco documentos, mas o rótulo
      nasce em UM lugar (`montarBlocos`): trocá-lo em cinco e deixar os outros com a
      redação antiga daria DOIS textos para o MESMO campo — o que se lê como defeito,
      não como escolha.
- [x] **TCLE anestésico: "Tipo de procedimento Anestésico indicado"** — como LACUNA
      (`[[...]]`), não variável. O S2Vet não guarda protocolo anestésico em lugar
      nenhum, e apontar para um dado "parecido" escreveria no papel uma técnica que
      ninguém indicou. Como lacuna, a tela de emissão o pede; em branco, não é impresso.
- [x] **2 VIAS já funcionavam** — `viasDoDocumento` lê do PRÓPRIO papel ("Emitir em 2
      vias: 1ª via…"), e os 12 modelos já traziam a frase desde 2026-08-26. O que
      faltava era o GATE: o teste agora trava a frase no seed com o mesmo casamento que
      o front faz. Some a frase, some a segunda via — e nada acusa, o documento só
      passa a sair com uma folha.
- [x] **CAMPO VAZIO fora do papel, do envio e da tela já valia** desde 2026-09-03
      (`removerVazios` no snapshot + `vazios.ts#semBlocosVazios` na visualização, na
      impressão e no PDF). Os campos NOVOS entram na mesma regra por construção: o
      e-mail é `campoAuto` (cai em `removerVazios`) e as linhas do timbre são filtradas
      em `linhasDoEstabelecimento`.
- [x] Testes: +6 casos em `documentosCentral.test.js` (74 no arquivo, **615** na
      suíte) — os nomes novos casando com o título impresso, os rótulos da norma nos
      12 sem resquício da redação antiga, o e-mail do vet nos 12, a lacuna anestésica e
      a frase das 2 vias. O caso antigo dos rótulos foi reescrito para travar a REGRA
      (quem tem o campo), não a redação — que é da norma e muda.
      `tsc -b` e `vite build` limpos.
- [ ] 🔴 **RE-SEED NECESSÁRIO**: `node backend/seed.js` para os modelos GLOBAIS ganharem
      o e-mail, os nomes novos e os rótulos. O upsert por `chave` sobrescreve o global
      e NÃO toca a cópia personalizada de cada clínica (que é a outra metade da mesma
      decisão — ninguém reescreve o documento que a clínica ajustou).
      ⚠️ Precisa do client de tenant DENTRO de `comEscopoPlataforma` — `node
      backend/seed.js` já faz isso; um `new PrismaClient()` puro morre no RLS.
- [ ] Documento EMITIDO antes desta sessão continua com o snapshot antigo (sem e-mail,
      sem timbre, com os nomes antigos). É o correto: o emitido é imutável.
- [ ] O timbre repete o nome da clínica que o corpo dos 12 já traz em "Estabelecimento"
      (`{{veterinario.clinica}}`). Não incomodou até aqui; se incomodar, o lugar de
      decidir é o seed — não o cabeçalho, que é o que dá uniformidade a todo o resto.

---

# Atualizado em: 2026-09-05 (WhatsApp/E-mail passaram a mandar o PDF em Prescrição,
#   Vacina, Pedido e Resultado de Exames — mesma folha do Imprimir, anexada de verdade
#   (Puppeteer). 🔴 A logo e a foto nasciam QUEBRADAS no PDF do servidor: o Puppeteer só
#   aceita `data:`, e agora `print/PrintShell.ts#prepararImagensImpressao` +
#   `srcImpressao` resolvem isso para TODOS os documentos. 🔴 A ASSINATURA DO VETERINÁRIO
#   nunca saía na prescrição (a folha só tinha a linha): rota nova
#   `GET /users/:id/assinatura-profissional` (vínculo da EMPRESA DO CONTEXTO, §36-f) +
#   `renderAssinaturas` — a imagem entra SÓ na linha do veterinário, a do executor fica
#   em branco. Card "Informações da Prescrição" removido da folha. Exame de IMAGEM passou
#   a dizer "Qtd. de Imagens". 🔴 PACIENTE INATIVO SAIU DA FILA de
#   `/execucao-prescricao` e desce para o Histórico, na aba nova "Paciente inativo" —
#   reverte a posição decidida em 02/09 (mas NÃO some do plantão, e o backend continua
#   devolvendo a linha). 🔴 E-MAIL: `EMAIL_USER` era usado como REMETENTE em 19 pontos —
#   com Gmail coincide, com Brevo/SES/Resend NÃO (o login não é caixa de e-mail). Novo
#   `EMAIL_FROM` + `remetente()`; `AuthController` tinha transporte próprio preso ao
#   Gmail (`service:'gmail'` ignora EMAIL_HOST) e foi para o provider único;
#   `ResendEmailProvider` implementado (era comentado), com require LAZY;
#   `npm run email:testar` envia de verdade com anexo. Ausência de `EMAIL_FROM` cai em
#   `EMAIL_USER` — instalação Gmail existente NÃO muda. 🔴 WHATSAPP: a tela dizia
#   "conectado" com a Evolution FORA DO AR (o `catch` de `obterStatus` caía no status
#   PERSISTIDO, que era CONECTADO) — e o envio chegava a gerar o PDF antes de falhar.
#   Estado novo `SERVIDOR_INDISPONIVEL`, que não é persistido e não vira DESCONECTADO.
#   Detalhes e armadilhas na §12, sessão 2026-09-05. Suíte: 456.)
---

### Sessão 2026-09-05 — PDF no WhatsApp/e-mail, assinatura na prescrição e paciente inativo fora da fila

- [x] 🔴 **WhatsApp e E-mail passaram a mandar o PDF, anexado de verdade**, em
      Prescrição, Vacina, Pedido de Exames e Resultado de Exames. Até aqui essas quatro
      telas mandavam TEXTO puro (`abrirWhatsApp`/`abrirEmail`), enquanto o Exame de
      Compra e os Documentos Emitidos já mandavam o documento. Nada de infraestrutura
      nova: é o mesmo `utils/compartilharPdf.ts` → `POST /documentos/{whatsapp,email}`
      → Puppeteer, com o MESMO HTML do botão Imprimir de cada tela.
      Destino = telefone/e-mail do proprietário; o texto que ANTES era o conteúdo virou
      a LEGENDA da mensagem. Sem destino ou sem provider, cai no fallback de sempre
      (baixa o PDF + abre o app).
      ⚠️ **Toasts de resultado saíram de `CompartilharPdfBotoes` para
      `compartilharPdf.ts`** (`enviarPdfWhatsAppComAviso`/`enviarPdfEmailComAviso`): a
      Prescrição não podia usar o componente porque passa antes pelo recorte do
      receituário de controle especial, e duas cópias das mensagens divergiriam.
      ⚠️ FICAM DE FORA: Evolução (imprime por um relatório comparativo gerado por IA
      num modal, não por um `gerarHtml`) e Encaminhamento (não tem gerador de folha).
- [x] 🔴 **A LOGO E A FOTO NASCIAM QUEBRADAS NO PDF DO SERVIDOR.** O Puppeteer bloqueia
      toda requisição que não seja `data:` (anti-SSRF, ver `printUrl.ts`), então
      `<img src="/api/midia/…">` imprime bem no NAVEGADOR e some no PDF que chega ao
      cliente — defeito que o Exame de Compra já tinha desde 08/02 sem ninguém notar.
      Novo par em `print/PrintShell.ts`: **`prepararImagensImpressao(urls)`** (async,
      resolve para `data:` e guarda em cache de módulo) + **`srcImpressao(url)`**
      (síncrono, usa o `data:` quando existe e cai na URL absoluta quando não).
      ⚠️ Os geradores continuam SÍNCRONOS de propósito — o `gerarHtml` de
      `compartilharPdf.ts` é síncrono, e é ele que roda dentro da janela de "user
      activation" do navegador. Quem vai gerar PDF chama `prepararImagensImpressao`
      ANTES; a impressão em tela não precisa de nada.
      `renderCabecalho` passou a usar `srcImpressao`, então a logo se conserta em TODOS
      os documentos de uma vez.
- [x] 🔴 **A ASSINATURA DO VETERINÁRIO NUNCA SAÍA NA PRESCRIÇÃO** — a folha só desenhava
      a LINHA com o nome. A prescrição não carrega assinatura nem CRMV (`include` do
      `PrescricaoGrupoController` traz só `id`/`fullName`), e o `marca` de
      `GET /documentos/contexto/:animalId` é do USUÁRIO LOGADO, não de quem prescreveu.
      Rota nova **`GET /users/:id/assinatura-profissional`** → nome, CRMV e
      `assinaturaUrl` do vínculo com a **empresa do contexto** (§36-f); sem vínculo
      nela, 404 — carimbar num papel a assinatura cadastrada em OUTRA clínica é
      falsificação. Sem `authorize('ADMIN')` de propósito: quem imprime a prescrição de
      um colega é a equipe, e o isolamento é o `req.empresaId`.
      Front: `utils/print/assinaturaProfissional.ts` (cache por usuário, guarda a
      PROMESSA para dois cliques no mesmo tick não virarem duas requisições) +
      `PrintShell.renderAssinaturas`, que põe a imagem SOBRE a linha, com nome e CRMV.
      ⚠️ A imagem entra **só na linha do VETERINÁRIO**. A do executor sai em branco —
      é a mesma regra do bloco `assinatura` da Central (02/09): carimbar a assinatura
      escaneada do vet na linha de outro produz documento falso.
      ⚠️ Sem assinatura cadastrada em `/cadastro-pessoal`, a linha sai em branco para
      assinar à mão. É o correto, não defeito.
      ⚠️ `imprimirPrescricao` virou **async** (busca a assinatura antes de montar a
      folha). Não custa o clique: a impressão sai por iframe, que não depende da janela
      de user activation — ao contrário do `window.open` do WhatsApp.
      ⚠️ `rotuloCrmv` não prefixa quando o valor já começa com "CRMV" — o campo é
      cadastrado como "CRMV-SP 12345" na maioria das bases, e prefixar sempre daria
      "CRMV CRMV-SP 12345".
- [x] **Card "Informações da Prescrição" REMOVIDO da folha** (a pedido) — Veterinário
      Responsável / Executor / Finalizado por / Finalizado em. O CSS `.assinatura*` e o
      `fmt()` que só ele usava saíram junto (o `tsc -b` reprova variável não lida).
      ⚠️ `finalizadoEm`/`finalizadoPor` continuam no TIPO: os callers os preenchem.
- [x] **Exame de IMAGEM: "Qtd. de Imagens" no lugar de "Qtd. de Amostras"**
      (`ExamePrint.ts`). A coluna `qtdAmostra` guarda os dois — é o mesmo campo que a
      tela já chaveia por `tipo === 'Imagem'`; rotular "amostras" num raio-x é dizer o
      que não foi coletado. De passagem, o plural na TELA dizia "2 imagems".
- [x] 🔴 **PACIENTE INATIVO SAIU DA FILA "A EXECUTAR"** em `/execucao-prescricao` (a
      pedido) — medicamento, procedimento E vacina. Ele desce para o **HISTÓRICO**, na
      aba nova **"Paciente inativo"**. REVERTE a decisão de 2026-09-02 ("continua na
      fila, só sem ação"), que deixava a linha no alto da tela oferecendo um trabalho
      que ninguém pode fazer, competindo com as doses do dia.
      ⚠️ **Ele NÃO some do plantão — muda de lugar.** O motivo de 02/09 (a equipe
      precisa ver que o tratamento existe e ficou parado) continua valendo, e é por
      isso que a saída foi uma aba, não um filtro.
      ⚠️ **Aba PRÓPRIA, não "Executado" nem "Cancelado"**: o tratamento não foi
      executado (mentiria sobre a dose) nem cancelado (mentiria sobre a prescrição, que
      volta a andar quando o gestor reativar).
      ⚠️ A aba só é RENDERIZADA quando tem conteúdo (aba vazia é ruído no plantão —
      mesma regra da Vacina e do histórico de Documentos), e um `useEffect` devolve o
      filtro a "Executado" quando ela zera com ela selecionada; sem isso o card ficaria
      preso num filtro cujo botão não existe mais.
      ⚠️ **O BACKEND NÃO MUDOU** — as duas `listarParaExecucao` continuam devolvendo a
      linha com `animalInativo`. Filtrar lá faria a aba nova nascer vazia.
      ⚠️ Prescrição de paciente inativo JÁ concluída continua em "Executado": a dose foi
      dada de verdade, antes da inativação.
      ⚠️ `tipoPendenteBruto` (sem olhar o paciente) × `tipoPendenteEm` (= bruto &&
      !animalInativo) — a aba nova usa o BRUTO, porque é justamente a pendência que
      essas linhas têm; o que muda é que ninguém pode executá-la.
      ⚠️ O **Painel Principal** NÃO foi tocado: lá o paciente inativo segue na fila,
      sem ação. Se a regra tiver de valer nas duas telas, o lugar é o mesmo par de
      predicados.
- [ ] `renderRodapeAssinatura` (rodapé fixo de Exame, Evolução, Dieta e Encaminhamento)
      continua desenhando só a LINHA com o nome — a imagem da assinatura entrou apenas
      na prescrição, que foi o pedido. `renderAssinaturas` já está pronto para os
      outros.
- [x] **E-MAIL: provedor trocável por variável, e Brevo como padrão recomendado.**
      O S2Vet é CLIENTE de SMTP, não servidor — não há nada a instalar na VPS. O que
      faltava era o caminho estar realmente aberto:
      🔴 **`EMAIL_USER` É CREDENCIAL, NÃO REMETENTE.** 19 pontos escreviam
      `from: "S2Vet" <${process.env.EMAIL_USER}>`. Com o Gmail os dois coincidem (o
      login É o endereço) e ninguém notava; no Brevo/SES/Mailgun o login é gerado pelo
      provedor (`9a1b2c001@smtp-brevo.com`) e NÃO é caixa de e-mail — o e-mail sairia
      com um "De:" inexistente, recusado ou direto no spam. Novo **`EMAIL_FROM`**
      (+ `EMAIL_FROM_NAME`), com `remetente()` como fonte única em
      `messaging/emailProvider.js`. Ausente, cai em `EMAIL_USER`: **nenhuma instalação
      Gmail existente muda de comportamento.**
      🔴 **`AuthController` tinha transporte PRÓPRIO**, o único ponto fora do provider:
      `nodemailer.createTransport({ service: 'gmail' })` — e `service:'gmail'` IGNORA
      `EMAIL_HOST`. Depois de migrar para o Brevo, TUDO enviaria normal e só o
      "esqueci minha senha" falharia com "Invalid login" — no fluxo em que a pessoa já
      está trancada para fora. Agora usa `getEmailProvider()`.
      ⚠️ Efeito colateral aceito: o e-mail de reset deixou de assinar "Equipe Equine
      Nutrition" e passou a assinar "S2Vet", como os outros 18.
      **`ResendEmailProvider` IMPLEMENTADO** (era classe comentada). Ativar = `npm
      install resend` + `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`.
      ⚠️ O `require('resend')` é LAZY, dentro do construtor: no topo do arquivo, quem
      não instalou a dependência não conseguiria nem CARREGAR o módulo — e ele sustenta
      2FA, boas-vindas e reset de senha. E se a env pedir resend sem a lib, cai no SMTP
      com log de erro em vez de derrubar o boot.
      ⚠️ `host` explícito no nodemailer, NUNCA `service:`, senão `EMAIL_HOST` vira
      enfeite. ⚠️ `EMAIL_SECURE=true` só na porta 465; na 587 (STARTTLS) trava a
      conexão até o timeout, sem erro que explique.
      **`npm run email:testar destino@x.com`** (`scripts/testarEmail.js`) envia DE
      VERDADE, com anexo em PDF, e traduz os três erros que respondem por quase toda
      falha em VPS: porta bloqueada (25/465/587 saem fechadas por padrão em
      DigitalOcean/Vultr/Oracle/Azure), credencial e remetente não verificado.
      Gate estrutural em `__tests__/emailProvider.test.js` (12 casos): reprova
      transporte SMTP criado fora do provider e `from:` montado com `EMAIL_USER`.
      ⚠️ A varredura IGNORA COMENTÁRIOS — sem isso ela acusa os próprios comentários
      que explicam a regra, e o teste vira ruído que se aprende a ignorar.
      Verificado que reprova de verdade (arquivo-isca temporário). Suíte: 446.
- [x] 🔴 **O PDF SAÍA COMO TEXTO com o WhatsApp CONECTADO** (relatado 2026-09-05, parte 2).
      Três defeitos independentes, todos terminando no MESMO fallback manual e todos
      SILENCIOSOS — a tela de Configurações mostrava a luz verde e nada explicava por quê:
      1. 🔴 **`webhookBase64: true` na instância** (gravado por `createInstance` desde
         2026-07-18). Ele cobra dois preços que NADA aqui aproveita — `routes/webhooks.js`
         só LOGA `messages.upsert`, nenhum byte de mídia é usado:
         (a) no ENVIO, a Evolution **BAIXA a mídia de volta** do WhatsApp antes de
             responder (`downloadMediaMessage`, `whatsapp.baileys.service.ts`), somando
             segundos a cada PDF — era isso que estourava o timeout do nosso lado;
         (b) o corpo do webhook passa de 15 MB, o `express.json` responde **413**, e a
             Evolution repete o POST **10 vezes com backoff exponencial** (413 não está
             entre os status que ela trata como definitivos) — com CONNECTION_UPDATE e
             QRCODE_UPDATED na fila atrás do evento que não coube.
         Agora `EvolutionService.WEBHOOK_BASE64 = false`. ⚠️ **NUNCA religar.**
         ⚠️ `createInstance` roda UMA vez na vida da clínica, então instância antiga
         ficaria com `base64: true` para sempre: novo `EvolutionService.setWebhook`,
         chamado por `garantirInstancia` (best-effort) a cada conectar/provisionar.
      2. 🔴 **Timeout de ENVIO era o das CONSULTAS (15s), e ainda REPETIA.**
         `/message/sendMedia` não devolve quando o WhatsApp aceita a mídia — a Evolution
         ainda grava a mensagem e (item 1) rebaixa o arquivo. Estourado o teto, `chamar()`
         classificava como transitório e **reenviava o mesmo PDF até 3x** antes de
         desistir com `EVOLUTION_INDISPONIVEL`. Agora rota de envio tem
         `SEND_TIMEOUT_MS` (45s, `EVOLUTION_SEND_TIMEOUT_MS`) e **`repetir: false`**.
         ⚠️ Timeout de POST de envio é do NOSSO lado: a mensagem pode ter saído. Repetir
         entrega o documento duas vezes ao cliente — nunca re-tentar envio.
      3. 🔴 **`estaProntoParaEnviar` NÃO resolvia o escopo da clínica.** A configuração
         mora em (empresaId, equipeId) com regra própria — CNPJ grava `equipeId: null`,
         empresa pessoal grava a equipe — e `req.equipeId` (header `x-equipe-id`) NÃO é
         essa chave: falta em caminhos legítimos (asset sem XHR, primeiro request antes
         de o EmpresaContext resolver, ADMIN) e SOBRA em empresa com CNPJ. Sem resolver,
         `buscarConfigDoEscopo` não achava a linha e devolvia `NAO_PROVISIONADO` — a tela
         de Configurações (que resolve por conta própria, via `resolverEscopoConfiguracao`)
         dizia CONECTADO enquanto o envio respondia NÃO. `resolverEscopoClinica` passou
         para dentro de `obterStatus`: agora as três leituras (tela, pré-checagem e
         `prepararEnvio`) concordam por construção. Medido na base: empresa 58 com
         `equipeId=null` ia de `NAO_PROVISIONADO/pronto=false` para `CONECTADO/pronto=true`.
- [x] 🔴 **E O QUARTO DEFEITO, QUE SÓ APARECEU DEPOIS DE A FALHA FALAR: o PDF nunca
      era base64.** A partir do **Puppeteer 23**, `page.pdf()` devolve **`Uint8Array`,
      não `Buffer`** (o projeto está no 25), e `Uint8Array.prototype.toString('base64')`
      **IGNORA o argumento** e devolve os bytes separados por vírgula —
      `"37,80,68,70,45,49,..."`. Não lança nada: cada consumidor recebia uma string
      plausível que não é base64 de coisa nenhuma. A Evolution recusava com
      **400 `Owned media must be a url or base64`** (`isBase64` do class-validator, em
      `sendMessage.controller.ts`), e o e-mail seguia com o anexo corrompido.
      Corrigido NA FONTE — `htmlParaPdf` devolve `Buffer.from(pdf)` —, o que conserta de
      uma vez os quatro consumidores (WhatsApp, e-mail, `POST /documentos/pdf` e o link
      público da fatura em `FaturaController.gerarLinkPublicoDaFatura`, que passava o
      `Uint8Array` como `buffer` para o `storage.upload`).
      ⚠️ `Buffer.from(uint8)` COPIA os bytes; `Buffer.from(u8.buffer)` compartilha o
      ArrayBuffer e pode carregar bytes de fora da view.
      ⚠️ **Este era o defeito que impedia o envio de verdade** — os três acima eram
      reais, mas o que fazia o WhatsApp recusar todo PDF era este. E ele estava
      INVISÍVEL: só apareceu porque o item seguinte fez a falha dizer o motivo.
      ⚠️ Ao subir o Puppeteer, conferir o tipo de retorno de `page.pdf()`/`page.screenshot()`
      antes de confiar em método de `Buffer`.
      ✅ Verificado com envio REAL: `{sucesso:true, id:'3EB03A6B9E90B795174183'}` em 6,8s,
      com `equipeId: null` (o caso que antes nem chegava a gerar o PDF).
      Gate novo `__tests__/documentoPdf.test.js` (3 casos, sem Chromium — `puppeteer`
      é mockado): trava o contrato "sai daqui como Buffer" e o `finally` que fecha o
      navegador. Verificado que REPROVA de verdade (a normalização foi removida de
      propósito e o caso do base64 falhou). Suíte: 459.
- [x] **A FALHA PASSOU A DIZER O MOTIVO — em toda a corrente.** Era o que impedia
      diagnosticar: `prontidaoParaEnviar` (era `estaProntoParaEnviar`) devolve
      `{ pronto, motivo }` em vez de um booleano pelado; `documentoWhatsappService` LOGA
      e propaga o motivo em vez de colapsar tudo em `PROVIDER_INDISPONIVEL`;
      `DocumentoCompartilharController` acrescenta um `motivo` LEGÍVEL à resposta (mapa
      `MOTIVO_WHATSAPP`) e um `logger.warn`; e o `catch {}` mudo de
      `utils/compartilharPdf.ts` virou `motivoDaFalha(err)`, que aparece no toast do
      fallback. "A clínica nunca conectou", "a sessão caiu", "o servidor está fora" e "o
      cliente não tem telefone" eram a MESMA frase — e não deixavam rastro nem no log.
      ⚠️ Fallback silencioso é armadilha: cair no manual é aceitável; cair sem saber por
      quê, não. (Mesma lição de 2026-09-01, item da conversão de documento.)
- [x] **Teto de corpo PRÓPRIO no webhook (60 MB), com o token ANTES do parser.**
      É o único endpoint cujo tamanho do corpo quem decide é um serviço EXTERNO, e o 413
      ali não é uma requisição perdida (ver item 1b). `routes/webhooks.js` aplica
      `confereToken` e só então `express.json({ limit: '60mb' })` — o token vem na QUERY,
      então corpo grande só é lido de quem provou conhecer o segredo; e a rota é montada
      em `server.ts` ANTES do `express.json` global de 15 MB.
      ⚠️ Consequência aceita: por entrar antes, o webhook não passa pelo rate limit geral
      (que é definido depois). Quem o protege é o token, conferido em tempo constante.
      Verificado ao vivo: 20 MB sem token → 401 (corpo nem lido); com token → 200.
- [x] **6 instâncias ÓRFÃS no servidor Evolution — APAGADAS (autorizado nesta sessão)** — `s2vet_e41`, `s2vet_e33_q30`,
      `s2vet_e37_q34`, `s2vet_e40_q37`, `s2vet_e52_q51`, `s2vet_e53_q52`: existem na
      Evolution mas NÃO em `tb_empresa_configuracoes` desta base (resquício de bases
      anteriores). Ficam em `connecting`, seguem disparando webhook para a nossa URL e
      continuam com `base64: true` — nenhuma correção do código as alcança, porque
      `garantirInstancia` só reconfigura instância que o BANCO conhece. Removidas por
      `DELETE /instance/delete/{nome}`; sobraram no servidor apenas as duas que o banco
      conhece (`s2vet_e58_q57` e `s2vet_e59_q58`).
- [x] 🔴 **A FOLHA "PARECIA UM A5 DEITADO"** (relatado 2026-09-05, parte 3). O papel
      SEMPRE foi A4 e o Puppeteer sempre respeitou o `@page` — medido: folha
      210x297mm nas duas saídas. O problema era a MANCHA: `@page { margin: 5mm 5mm
      15mm }` no `PrintShell` somado ao `padding` lateral do body de cada gerador
      (mais 5mm) dava **190mm de texto numa folha de 210mm**, e o corpo estava em
      **7,5pt** — ~140 caracteres por linha, o dobro do confortável (65-75). Texto
      miúdo de borda a borda lê como meia folha deitada.
      ```
      antes:  mancha 190mm | margens esq 10,0 dir 10,2 topo 13,8 | fonte 7,5pt
      agora:  mancha 175mm | margens esq 18,7 dir 16,4 topo 20,0 | fonte 9,1pt
      ```
      Duas mudanças: `@page { size: A4; margin: 12mm 14mm 20mm }` e a tipografia dos
      5 geradores que ainda usavam **px** (9-11px = 6,75-8,25pt) escalada ×1,30 —
      `EvolucaoPrint`, `ExameCompraPrint`, `ExamePrint`, `PrescricaoPrint`,
      `ResultadoExamePrint`. Os que já usam **pt** (`AtendimentoPrint`, `Dietaprint`,
      `VetPrint`) ficaram como estavam: 8-10pt é legível, e inflá-los mudaria a
      paginação de documentos que ninguém reclamou.
      ⚠️ **A base de 20mm não é estética**: `.ps-signature` é `position: fixed;
      bottom: 0` e ocupa o pé de TODA página; quem reserva o espaço para ela é o
      `padding-bottom` do body de cada gerador. Encurtar um sem o outro faz o texto
      passar por baixo da assinatura.
      ⚠️ A prescrição de 6 itens passou de 1 para 2 páginas. Medido: **é a área útil,
      não a fonte** — os fatores 1,15 / 1,20 / 1,25 / 1,30 quebram todos igual, então
      o 1,30 entrega a melhor legibilidade pelo mesmo custo. Documento bem diagramado
      não se espreme para caber.
      ⚠️ Ao mexer nas margens, MEÇA em vez de olhar: `pdfjs-dist` (já no frontend) dá
      a bounding box do texto e o tamanho de fonte por página a partir do PDF gerado.
- [x] **BARRA DE PROGRESSO COM PERCENTUAL REAL no envio** (a pedido). O envio é uma
      requisição só de ~7s (Puppeteer + upload da mídia pela Evolution) e o cliente
      não tinha sinal nenhum no meio. As rotas `POST /documentos/{whatsapp,email}`
      passaram a responder **NDJSON, uma linha por marco**, quando o cliente manda
      `Accept: application/x-ndjson`: `{tipo:'progresso', pct, etapa}` … e fecha com
      `{tipo:'fim', sucesso, motivo?}`. Marcos: 5 preparando · 15 verificando o
      WhatsApp · 25 gerando o PDF · 70 PDF pronto (com o tamanho MEDIDO do buffer) ·
      85 enviando · 100 enviado.
      🔴 **Cada pct é um fato, não relógio.** Entre marcos a barra não anda — a opção
      "preencher por estimativa de tempo" foi apresentada e RECUSADA: o número
      ficaria bonito e mentiria, e é a mesma regra do "nada de inventar valor" (§12,
      26/08). A transição de 300ms suaviza o salto sem forjar valor intermediário.
      ⚠️ **Sem o header, a resposta continua sendo o JSON único** — contrato antigo
      preservado, e há teste travando isso.
      ⚠️ **Em streaming o HTTP é SEMPRE 200**: o status vai junto do primeiro chunk e
      não pode ser trocado depois. Quem ler o código HTTP em vez da linha `fim`
      conclui "deu certo" numa falha.
      ⚠️ `res.flushHeaders()` + `X-Accel-Buffering: no` são obrigatórios: sem eles o
      Node/proxy segura os bytes e todos os marcos chegam juntos no fim — uma barra
      que salta de 0 a 100 é pior que barra nenhuma, porque promete acompanhamento
      que não existe.
      ⚠️ **O front lê o stream pelo `onDownloadProgress` do axios, NÃO por `fetch`
      cru**: é o que mantém o envio dentro da instância `api` — cookie de sessão,
      renovação automática no 401 e os headers `x-empresa-id`/`x-equipe-id`. Com
      `fetch` seria preciso reproduzir os quatro, e o primeiro que divergisse
      quebraria o envio de um jeito difícil de achar. Exige `responseType: 'text'`
      (com `'json'` o axios só entrega o corpo no fim) e um cursor sobre
      `responseText`, que é ACUMULADO — sem ele cada marco seria reprocessado. A
      última linha pode vir partida ao meio: só se processa até o último `
`.
      UI em `components/ProgressoEnvio.tsx` — um toast que se ATUALIZA (id fixo,
      `duration: Infinity`, fechado no `finally`), na cor da ação (§6): WhatsApp
      verde, e-mail azul. Como mora dentro de `enviarPdf*ComAviso`, as 5 telas que
      compartilham PDF ganharam a barra sem nenhuma alteração.
      🔴 **A BARRA FICA NO CENTRO DA TELA, e por isso NÃO usa `react-hot-toast`**
      (a pedido). O toast é renderizado dentro de um wrapper com `transform` (a
      animação de entrada), e `position: fixed` dentro de um elemento transformado
      passa a ser relativo a ELE, não à viewport — não existe CSS que centralize o
      card a partir de lá. O componente monta o próprio portal no `<body>`
      (`createRoot`, um host reaproveitado entre envios). Os toasts de RESULTADO
      continuam saindo pelo react-hot-toast.
      ⚠️ O overlay é `pointer-events-none` (só o card recebe clique): um overlay que
      captura clique vira armadilha se algum caminho de erro deixar de fechá-lo — a
      tela inteira ficaria travada. Não há clique duplo a impedir, os botões de envio
      já se desabilitam sozinhos.
      ⚠️ `unmount` adiado em `setTimeout(0)`: chamá-lo dentro do ciclo de render do
      React 18 dispara aviso e pode perder a atualização final (o 100%).
- [x] **BOTÃO CANCELAR na barra — e o cancelamento é REAL** (a pedido). São duas
      metades: o front aborta a requisição (`AbortController`) e o BACKEND percebe o
      cliente sair (`req.on('close')` + `res.writableEnded`) e consulta isso nos dois
      pontos irreversíveis — antes de subir o Chromium e, principalmente, antes de
      entregar a mensagem. Só a primeira metade seria cancelamento de FACHADA: o
      front pararia de esperar, o PDF continuaria sendo gerado e o documento chegaria
      ao cliente com a tela dizendo "cancelado".
      🔴 **O botão SOME no marco 85** (`PCT_SEM_VOLTA`), que é "Enviando ao
      WhatsApp": dali em diante a mensagem está a caminho e mensagem entregue não se
      desfaz. Oferecer o botão ali produziria o pior resultado possível — a tela
      afirmando "cancelado" enquanto o cliente recebe o documento. No lugar dele
      entra a frase "Não é mais possível cancelar"; botão DESABILITADO seria pior,
      porque convida ao clique e depois não explica nada.
      ⚠️ `close` no request dispara TAMBÉM no fim normal da resposta — quem separa
      "acabou" de "abortou" é `res.writableEnded`. Sem essa checagem, TODO envio
      bem-sucedido seria marcado como cancelado. Há teste para os dois lados.
      ⚠️ Cancelado NÃO cai no fallback manual: baixar o PDF e abrir o WhatsApp seria
      exatamente a continuação que o usuário acabou de recusar. Resultado próprio
      (`cancelado: true`) e toast neutro, nunca "PDF baixado, anexe na conversa".
      ⚠️ Cancelado o envio, o servidor NÃO escreve o veredito: o cliente já foi
      embora e escrever num socket fechado só produz ruído de erro no log.
      Gate: `__tests__/documentoProgresso.test.js` (7 casos) — ordem dos marcos,
      pct nunca recuando, veredito na linha `fim`, contrato antigo intacto, a
      mensagem NÃO sendo entregue após desistência, e o fim normal não sendo
      confundido com desistência. Suíte: 466.
- [x] **O RESULTADO DO ENVIO FOI PARA O CENTRO, e nomeia o DOCUMENTO** (a pedido).
      Ele saía como toast no TOPO: a pessoa acompanhava o progresso no meio da tela e
      a resposta nascia no canto oposto, fora de onde ela estava olhando. Agora usa o
      mesmo card central (`ProgressoEnvio.mostrarResultado`), e a frase é
      **"Prescrição enviada por WhatsApp com Sucesso"** — `fraseEnvio(documento,
      canal)`. Campo novo `CompartilharPdfOpcoes.documento`, preenchido por cada tela
      (Prescrição · Vacina · Pedido de Exames · Resultado de Exame · Encaminhamento ·
      Evolução · Laudo de Exame de Compra · Fatura · o nome do documento emitido).
      ⚠️ Ausente, cai em "Documento" — nunca em "PDF": quem clicou sabe o que mandou,
      e a confirmação genérica não diz QUAL dos registros da tela acabou de sair.
      ⚠️ Fecha sozinho em 4s: é confirmação, não decisão. Card que exige clique
      interrompe quem está no meio de um atendimento; o botão Fechar existe para quem
      quiser tirá-lo antes.
- [x] 🔴 **O ENVIO POR PDF CHEGOU ÀS DUAS ÚLTIMAS TELAS QUE MANDAVAM TEXTO PURO**
      (a pedido): **Evolução** e **Encaminhamento**. Eram as duas exceções registradas
      em 05/09 ("ficam de fora"), e agora não são mais.
      - **Evolução**: `gerarHtmlEvolucao` já existia (o que não existia era o uso —
        o botão Imprimir dela abre o relatório comparativo de IA, que é outro
        caminho). 🔴 Mas o gerador montava `<img src="${animal.photoUrl}">` CRU:
        no PDF do servidor a foto e as mídias nasceriam quebradas (o Puppeteer só
        aceita `data:`). Passou por `srcImpressao`, e nasceu `prepararEvolucao`.
      - **Encaminhamento**: não tinha folha nenhuma — nasceu `EncaminhamentoPrint.ts`
        no padrão do `PrintShell` (cabeçalho, cards de conteúdo, rodapé com
        assinatura). A tela passou a receber `animal` do shell, como Vacina e
        Prescrição já recebiam: encaminhamento que não identifica o paciente é
        documento fraco. Sem `animal`, a folha sai sem o card do paciente.
      ⚠️ Prop nova `CompartilharPdfBotoes.aoPreparar`: **`gerarHtml` continua
      SÍNCRONO** porque é ele que roda dentro da janela de "user activation" do
      navegador, de que o fallback manual depende para abrir o app. Todo preparo
      assíncrono (assinatura, imagens em `data:`) mora nessa prop, separado.
      ⚠️ FICA de fora, de propósito: o envio EM LOTE do fechamento de faturas
      (`Faturamento.tsx`, lista de faturas fechadas) — ali é uma linha por fatura e
      migrar exigiria gerar N PDFs; o envio da fatura INDIVIDUAL já usa o pipeline.
- [x] **HISTÓRICO MOSTRA 5 ITENS, COM ROLAGEM NOS DOIS EIXOS** (a pedido) —
      `components/JanelaLista.tsx`, aplicado em **10 telas**: Prescrição, Vacina,
      Exames, Encaminhamento, Evolução, Exame de Compra, Documentos Emitidos,
      Histórico do Paciente (`AnimalDetail`), Histórico do shell de Atendimento e o
      Histórico do plantão (`ExecucaoPrescricao`).
      🔴 **A ALTURA É MEDIDA, não estimada.** Um `max-h` fixo em `rem` erraria em
      quase todo lugar: a linha de tabela do desktop tem ~40px, o card do mobile
      passa de 120px, e o MESMO card cresce quando o registro tem justificativa de
      cancelamento. O componente soma a altura real dos N primeiros itens (mais o
      `thead`, que é `sticky` e não conta como item) — é isso que faz "5 primeiros"
      significar cinco itens em qualquer uma dessas situações.
      ⚠️ `ResizeObserver` + `MutationObserver`: a altura de um item muda com o
      conteúdo e a lista muda com filtro/paginação. Sem remedir, a janela congela na
      medida da primeira renderização.
      ⚠️ **Lista com menos itens que o teto não vira janela** — um `max-height` ali
      só criaria espaço vazio embaixo de uma lista que já cabia inteira.
      ⚠️ O cabeçalho da tabela é preso no topo por `[&_thead_th]:sticky` **dentro do
      componente**: nenhuma das tabelas precisou ser alterada para isso.
      ⚠️ O seletor padrão cobre linha de tabela e card marcado com `data-item-lista`;
      **sem nenhum casamento, cai nos filhos DIRETOS** — o histórico do shell de
      Atendimento alterna `<button>` (item avulso) e `<div>` (grupo com evolução), e
      exigir marcador em cada forma espalharia detalhe da janela por dentro das telas.
      ⚠️ `overscroll-contain` para a rolagem da janela não encadear na página.
      ⚠️ `AnimalDetail` já mostrava 3 com "Ver todos": o padrão subiu para 5, para a
      lista fechada não nascer já com barra de rolagem. O `ExecucaoPrescricao` tinha
      janela PRÓPRIA (`max-h-[50vh]`) que cobria cabeçalho e filtros junto — agora a
      janela vale só para as listas.
- [x] **Janela do histórico: 5 → 3 itens** (a pedido), e estendida a **14 telas** —
      entraram Orçamento, Fatura (o extrato, por seção de itens), Resultado de Exame
      (`Exames` e `ExamesSolicitadosPanel`). Documento (`Emitidos`) já tinha.
      ⚠️ `AnimalDetail.HISTORICO_VISIVEL_PADRAO` acompanha o número (3): os dois
      fora de sincronia fazem a lista fechada já nascer com barra de rolagem.
      ⚠️ Na FATURA a janela vale por SEÇÃO de itens (assistência, cada animal, os
      fora do escopo) — não sobre o corpo inteiro, que já é `lg:overflow-y-auto` e é
      a rolagem da coluna.
- [x] 🔴 **PACIENTE INATIVO NÃO APARECE NO SELETOR DO AGENDAMENTO** (a pedido). O
      prontuário dele está congelado (somente leitura até o gestor reativar), então
      marcar atendimento novo criava um compromisso que o backend recusa depois, na
      hora de abrir a evolução — o erro aparecia só ali, com o horário já ocupado na
      grade. `GET /animais` já devolvia `inativo` (`anexarInativoEmLista`); o que
      faltava era o front filtrar.
      ⚠️ Filtra `animaisAgendaveis`, **NÃO** `animaisDisponiveis`: é desta última que
      sai o rótulo do paciente JÁ escolhido (`animalSelecionadoCombo`). Um
      agendamento marcado ANTES da inativação continua existindo, e sem a lista
      completa a linha dele ficaria sem nome ao ser reaberta.
      ⚠️ A barra superior de filtro da tela (Animal ↔ Proprietário) NÃO foi filtrada:
      ali esconder o paciente sumiria com os agendamentos que ele já tem na agenda.
- [x] **Dieta: o botão "Compartilhar" virou WhatsApp + E-mail** (a pedido). Ele abria
      um modal que mandava a dieta só por E-MAIL, com o PDF gerado no NAVEGADOR
      (`html2canvas` — captura de tela, texto não selecionável). Agora é o mesmo par
      do resto do sistema (`CompartilharPdfBotoes`): PDF do Puppeteer anexado, barra
      de progresso e resultado no centro. O `CompartilharModal` e o `blobParaBase64`
      foram REMOVIDOS (sem outro call site, ficariam mortos e o `tsc -b` reprova).
      🔴 `Dietaprint.gerarHtmlDieta` usava `resolverUrlAbsoluta` na foto do paciente —
      o MESMO defeito de `EvolucaoPrint`: no PDF do servidor a imagem nasce quebrada
      (o Puppeteer só aceita `data:`). Passou por `srcImpressao` + `prepararDieta`.
      ⚠️ `gerarPdfBlob` (client-side) FICA: é o "Exportar PDF", que baixa o arquivo no
      navegador e não passa pelo servidor.
      ⚠️ `PrintAnimal` da dieta ganhou `user.phone` — sem ele não há destino para o
      WhatsApp; a rota `POST /dietas/compartilhar` continua no backend, agora sem
      chamador no front.
- [ ] O envio real depende do WhatsApp da clínica provisionado/conectado na Evolution
      API e de SMTP configurado. Sem isso TODO clique cai no fallback (baixa o PDF) —
      e o toast diz isso, mas vale confirmar num envio de verdade antes de anunciar a
      função ao cliente (`npm run email:testar` cobre o lado do e-mail).
- [x] 🔴 **A TELA DIZIA "WHATSAPP CONECTADO" COM A EVOLUTION FORA DO AR.**
      `whatsappService.obterStatus` tinha um `catch` que, ao falhar a consulta AO
      VIVO, devolvia o status PERSISTIDO — e o último valor gravado é justamente
      `CONECTADO`. A luz ficava verde e nenhuma mensagem saía.
      ⚠️ **Não era só cosmético**: `provider.estaProntoParaEnviar` compara com
      'CONECTADO' e respondia SIM, então `enviarDocumentoWhatsApp` subia um Chromium
      e gerava o PDF INTEIRO (segundos) só para falhar no envio depois — queimando a
      janela de "user activation" do navegador de que o fallback manual precisa
      (`frontend/src/utils/compartilharPdf.ts`). Sintoma para o usuário: o botão de
      WhatsApp "não faz nada". E `prepararEnvio` liberava cada mensagem para morrer
      no timeout.
      Estado NOVO **`SERVIDOR_INDISPONIVEL`**: "não sei" nunca mais se disfarça de
      "sim". Devolvido quando a Evolution não responde OU responde sem estado
      (instância removida do servidor).
      ⚠️ **NÃO persiste** o estado degradado — a Evolution cair por 30s não pode
      apagar do banco o fato de a clínica ter uma sessão pareada. O valor conhecido
      volta em `statusPersistido`, como contexto.
      ⚠️ **NÃO existe fallback para o persistido em estado nenhum**, nem
      DESCONECTADO: sem alcançar a Evolution não há envio possível, e "o servidor
      está fora" é problema DIFERENTE de "a sessão caiu" (que se resolve com QR).
      Devolver DESCONECTADO mandaria o gestor ler um QR Code que ninguém pode gerar.
      Pelo mesmo motivo, `prepararEnvio` responde com o código PRÓPRIO
      `WHATSAPP_SERVIDOR_INDISPONIVEL`, não `WHATSAPP_DESCONECTADO`.
      Front: o novo estado conta como FALHA (luz vermelha) e ganhou texto VISÍVEL na
      tela — o `title` do ponto só aparece no hover, e some no celular; como o
      sintoma relatado foi "a tela diz que está conectado", o estado precisa estar
      escrito.
      `__tests__/whatsappStatus.test.js` (10 casos) trava a regra; verificado que
      REPROVA de verdade — o `catch` antigo foi reintroduzido de propósito e 2 casos
      falharam. Suíte: 456.
- [ ] **Nada de Postfix próprio na VPS**: IP novo não tem reputação e Gmail/Outlook
      mandam direto para spam. O caminho é sempre um relay (Brevo, SES, Resend…).
- [ ] O domínio de `EMAIL_FROM` precisa de **SPF + DKIM** publicados para não cair em
      spam. Isso é DNS, fora do código — mas sem isso o PDF que a clínica manda ao
      cliente não chega na caixa de entrada.

---

# Atualizado em: 2026-09-03 (🔴 O EMITIDO EXIBIA DADO DE EXEMPLO + a folha e o
#   Atestado de Vacinacao remodelados. OK SEED APLICADO (autorizado): os 12 modelos
#   globais do CFMV foram reescritos; nenhuma clinica tinha copia propria, entao nada
#   personalizado foi tocado. Backup dos 12 anteriores no scratchpad da sessao.
#   1. 🔴 **O DOCUMENTO EMITIDO MOSTRAVA "Thor" E "Haras Boa Vista"** - os exemplos do
#      catalogo - POR CIMA do dado correto do snapshot. `resolverVariaveis` cai no modo
#      EXEMPLO quando o contexto e nulo, e dois pontos levavam a folha do EMITIDO ate
#      la: (a) `BlocoView` no `campoAuto` IGNORAVA `conteudo.texto` (o valor que o
#      backend resolveu e gravou) e reprocessava `conteudo.variavel`; (b) o corpo em
#      `Emitidos.tsx` recebia `contexto={contexto ?? undefined}`. O cabecalho ja estava
#      protegido desde 01/09; o corpo, nao. REGRA: **no `campoAuto` o valor GRAVADO
#      vence** (e o que `utils/DocumentoPrint.ts` sempre fez - a impressao saia certa e
#      so a TELA mentia), e a folha do emitido recebe `ctxFolha = contexto ??
#      doc.contexto ?? {}`, NUNCA `undefined`.
#   2. **O CABECALHO PERDEU AS TRES SECOES** (Veterinario / Proprietario / Paciente),
#      em TODOS os documentos, e o TITULO passou a ser CENTRALIZADO. Elas nasceram em
#      01/09 e repetiam no alto da folha o que os 12 modelos do CFMV trazem no corpo
#      por exigencia da norma. ⚠ CONSEQUENCIA ACEITA: modelo que NAO repete esses
#      dados no corpo sai sem identificar ninguem - quem monta precisa por os campos.
#      `SECOES`/`valorDe`/`comPrefixoCrmv` sairam de `cabecalho.ts` (estao no git).
#   3. 🔴 **O QUE NAO FOI PREENCHIDO NAO VAI PARA O PAPEL** -
#      `documentoVariaveis.js#removerVazios`, aplicado ao SNAPSHOT na emissao (nunca ao
#      modelo: no modelo o campo em branco e o espaco a preencher). Descarta `campoAuto`
#      sem valor, `observacoes` em branco, `tabela` sem linha e SUBTITULO cuja secao
#      ficou vazia. ⚠ Bloco `texto` so cai quando sobrou "Rotulo:" e nada mais - ele
#      carrega a declaracao normativa, e descarte generoso apagaria o que da validade ao
#      documento. `limparPontuacaoOrfa` tira o resto que a variavel vazia deixa ("Local
#      e data: , 03/09/2026." -> "Local e data: 03/09/2026."). ⚠ Some tambem a linha em
#      branco que existia para preencher A MAO depois de impressa - decisao do usuario.
#   4. **ATESTADO DE VACINACAO (Anexo XI) remodelado**: fora Tatuagem, Brinco, Registro
#      Genealogico e o bloco "Observacoes do(a) Medico(a) Veterinario(a)". "Proxima dose
#      prevista" saiu; **Vacinacao contra** ficou, DIGITAVEL - a unica variavel
#      disponivel (`vacinas.ultima`) devolve o NOME COMERCIAL com a data, e escreve-la
#      nesse rotulo e afirmacao errada num documento com valor legal.
#   5. **TUDO DA VACINA MORA NA LINHA DELA** - os dados do frasco viraram GRUPO
#      REPETIVEL (`listaCampos`), e **"Vacinacao contra" e "Observacao" sao COLUNAS**,
#      nao campos soltos na secao (a pedido, 2026-09-03): num atestado com duas vacinas,
#      uma protege contra influenza e a outra contra tetano, e um campo unico obrigaria
#      a escrever as duas coisas numa frase so - sem dizer qual e de qual. Colunas: Nome
#      comercial / Vacinacao contra / Numero da partida / Fabricante / **Data de
#      fabricacao** / **Data de validade** (eram um campo so) / Observacao.
#      ⚠ A CELULA passou a aceitar 800 caracteres (era 500, corte silencioso no
#      `DocumentoEmitidoController`) - o mesmo teto do campo de observacao
#      (`CamposForm.MAX_MULTILINHA`), que agora e uma celula desta tabela.
#      ⚠ SETE colunas numa A4 retrato ficam densas; se apertar, o caminho e a
#      observacao virar uma segunda linha da tabela, nao encolher as outras.
#      Novo `conteudo.fonteOpcoes` ('empresa.vacinas',
#      `lib/documentoListas.js#OPCOES`): a PRIMEIRA coluna vira `<select>` do catalogo da
#      empresa e o item escolhido traz Fabricante (catalogo) + Partida e Validade (lote
#      FEFO), tudo editavel. ⚠ NAO confundir com `fonteDados`, que PREENCHE linhas com o
#      que o PACIENTE tem; esta so OFERECE o que existe no cadastro da EMPRESA.
#      ⚠ `preenche` e chaveado pelo NOME da coluna, nunca pelo indice - o modelo pode
#      reordenar as colunas e a validade cairia na do fabricante. ⚠ Deduplica por nome:
#      o catalogo e MISTO (global + empresa) e o mesmo produto saia duas vezes (426 -> 231).
#      ⚠ Data de FABRICACAO fica vazia: o S2Vet nao guarda esse dado (`LoteVacina` tem
#      lote e validade).
#   6. **`estilo.colunas: 2`** - campo automatico em DUAS COLUNAS na folha, nos DOIS
#      renderizadores. Aplicado aos 12 modelos (a identificacao e a mesma nos doze);
#      Endereco fica em largura inteira, senao quebra em tres linhas.
#   7. **O PACIENTE NASCE VAZIO** em `/documentos` e em `/clinica/vacina` (a pedido): o
#      id vem SO da URL, e o `selectedAnimal` (global, persistido em localStorage) nao e
#      mais adotado - abrir a tela trazia pre-escolhido um paciente que ninguem escolheu
#      para AQUELE documento. ⚠ O efeito que le `?animalId=` **so IMPOE, nunca ZERA**:
#      um `else setAnimalId(null)` transforma qualquer reexecucao dele (remontagem da
#      rota, hot-reload) em "o paciente sumiu no meio do preenchimento". Sem paciente, a
#      tela de Vacina NAO monta o `SubModuloVacina` (ele bateria em `/animal/0`), e o
#      `SeletorAnimalInteligente` ganhou a `<option>` vazia - sem ela o `<select>` exibe
#      a PRIMEIRA opcao e o campo parece preenchido.
#   8. **Sairam da tela de emissao** o campo "Tipo de Documento" (era leitura: repetia a
#      gaveta em que o modelo foi arquivado) e o campo "Categoria" do dialogo de envio.
#      A categoria continua existindo no modelo (agrupa o combobox); o que saiu foi
#      PEDI-LA e EXIBI-LA. Documento enviado nasce em `personalizados` (default da
#      coluna) - o front nao manda `categoria`, e `saneia` ignora campo ausente.
#   9. 🔴 **CAMPO VAZIO TAMBEM NAO E IMPRESSO, COMPARTILHADO NEM VISUALIZADO**
#      (a pedido). O `removerVazios` do backend so limpa o que NASCE dali em diante;
#      documento emitido ANTES continua com os blocos vazios no snapshot. Espelho novo
#      no front - `modules/documentos/vazios.ts#semBlocosVazios` -, aplicado na
#      VISUALIZACAO do emitido (`Emitidos.tsx`) e em `utils/DocumentoPrint.ts` (que
#      atende impressao, download e o PDF do WhatsApp/e-mail).
#      ⚠ Filtra o que se DESENHA, NUNCA o snapshot: o documento entregue e imutavel.
#      ⚠ NAO vale para a PRE-VISUALIZACAO: `Emitidos` so filtra quando NAO recebe
#      `contexto` (a prop que so a tela de emissao passa). Ali o traco em branco e o que
#      liga a folha ao formulario - clicar nele foca o campo.
#   10. **MUNICIPIO DEDUZIDO DO ENDERECO** (`documentoVariaveis.js#municipioDoEndereco`).
#      `LocalizacaoAnimal` nao tem cidade/estado, e o municipio saia do cadastro do
#      CLIENTE - vazio na maioria das bases e, quando preenchido, a cidade DELE. Agora
#      **endereco e municipio saem da MESMA string**, a que vai impressa: le-se
#      "... - CIDADE/UF" (endereco importado) ou "..., Cidade, UF" (o que o ViaCEP monta
#      no cadastro), e so entao cai no cadastro do cliente.
#      ⚠ Nao reconheceu o formato, devolve VAZIO - nunca um palpite: municipio errado
#      num atestado sanitario e declaracao falsa sobre a origem do animal.
#   11. **`DateInput` nos campos de data do documento** (§6: nunca `<input type="date">`,
#      que segue o locale do NAVEGADOR e pedia MM/DD/AAAA). Vale para a lacuna solta e
#      para as COLUNAS de data da lista (`ehColunaDeData`). ⚠ O valor GRAVADO e o texto
#      BRASILEIRO, porque ele vai direto para o papel - com o ISO do input nativo a
#      folha saia com "2027-08-16". Conversao na borda por `dateUtils.isoParaBR` /
#      `brParaISO` (existem porque `formatDate` devolve "—" no vazio, o que iria para
#      dentro do valor). `DateInput` ganhou `onFocus` e `inputRef` para o campo de data
#      participar da ligacao folha <-> formulario. ⚠ Na CELULA da tabela ele vai
#      `compacto`: a mensagem de erro abaixo empurraria a linha inteira e desalinharia
#      as outras colunas.
#   12. **Responsavel / CPF-CNPJ / Telefone lado a lado** (`colunas: 3`, a pedido);
#      Endereco em largura inteira. E a folha do emitido abre no maior zoom que CABE na
#      largura da tela - os 62% do padrao sao medida de desktop (794px x 0,62 = 492px,
#      mais que qualquer celular) e o documento abria cortado. ⚠ O ajuste roda UMA VEZ,
#      na abertura: reajustar a cada mudanca de tamanho tiraria da mao de quem ampliou
#      de proposito para conferir uma linha.
#   13. 🔴 **O CADASTRO DO CLIENTE ERA LIDO SÓ DA TABELA LEGADA.** O cadastro do
#      proprietario por empresa mora em DUAS tabelas que convivem - `tb_proprietario_perfis`
#      (§36) e `tb_usuario_empresa` (§36-f), gravadas em paralelo desde 08/08 enquanto os
#      leitores migram -, e `documentoVariaveis` era um dos leitores que ficaram na
#      legada. Medido numa base real: cliente com endereco completo em
#      `tb_usuario_empresa` e nada na legada saia com o endereco VAZIO no atestado,
#      enquanto a tela do cadastro dele mostrava tudo. Novo `cadastroDoCliente`:
#      ⚠ a LEGADA continua sendo a AUTORIDADE campo a campo (e ela que a tela de
#      Proprietarios exibe - trocar a ordem faria o papel discordar da tela no NOME do
#      cliente); o vinculo so PREENCHE O QUE ESTA VAZIO.
#   14. **A secao "Responsavel pelo animal" usa o cadastro do PROPRIETARIO** (a pedido):
#      `cliente.endereco` / `cliente.municipio` / `cliente.cep`, variaveis NOVAS. Antes o
#      endereco daquela secao vinha de `propriedade.*` - que e onde o ANIMAL esta e pode
#      ser de terceiro (o haras que hospeda). As duas familias continuam existindo, e e o
#      Atestado Sanitario que usa a da propriedade, na secao propria dele.
#      ⚠ Variavel nova precisa entrar em TRES lugares: o contexto do backend, o
#      `catalogo.ts` do editor e o `VARIAVEIS_VALIDAS` do `documentoLLMService` (senao a
#      IA nao pode usa-la e o teste de resolvibilidade reprova).
#   15. **IMPRESSAO EM 2 VIAS** (`DocumentoPrint.viasDoDocumento`) - a pedido. Cada via e
#      uma folha completa (cabecalho, corpo e rodape), separada por quebra de pagina,
#      com um SELO no alto a direita dizendo de quem ela e.
#      🔴 A REGRA SAI DO PROPRIO PAPEL: le-se "Emitir em N vias: 1a via X; 2a via Y" do
#      texto dos blocos - que os 12 modelos do CFMV ja trazem porque a Res. 1.321/2020
#      exige. Assim um modelo da clinica que escreva o mesmo ganha as duas vias sozinho,
#      e um documento que NAO pede duas nao sai duplicado.
#      ⚠ Teto de 4 vias: o numero vem de texto livre, e um "em 20 vias" mandaria 20
#      paginas para a impressora. ⚠ Sem o padrao, UMA via - nunca duas "por precaucao".
#      ⚠ Vale para impressao, download e o PDF do WhatsApp/e-mail (todos saem do MESMO
#      HTML); a VISUALIZACAO em tela mostra uma folha so.
#   16. **Assinatura do veterinario**: ja funcionava e nao precisou de mudanca - conferido
#      ponta a ponta. Ela e de QUEM EMITE (`profissionalDaEmpresa(req.user.id)`), nao do
#      veterinario da evolucao: quem assina responde pelo que declara, e foi justamente
#      "assinatura de um saindo na linha de outro" o que a sessao de 02/09 corrigiu.
#      ⚠ Sem assinatura no vinculo DAQUELA empresa, a linha sai em branco para assinar
#      a mao - e correto, nao defeito. Cadastra-se em `/cadastro-pessoal`.
#   17. **O ENDERECO DO RESPONSAVEL SAI CAMPO A CAMPO** - CEP / Endereco / Complemento
#      / Bairro / Cidade / Estado, os MESMOS da tela de Proprietario (a pedido). Seis
#      variaveis novas `cliente.*`; `cliente.municipio` fica como conveniencia de quem
#      quer "Cidade / UF" numa linha so. ⚠ Cidade e estado caem no que o ENDERECO
#      revelar quando as colunas estao vazias - e o que faz o cliente cadastrado com
#      tudo numa string ("... - CAMBORIU/SC") nao ficar sem municipio no papel.
#   18. 🔴 **LISTA COM `formato: 'campos'`** - o grupo repetivel sai como os demais
#      CARDS do documento ("Rotulo: valor", tres por linha) em vez de tabela. A vacina
#      tem SETE dados, e sete colunas numa A4 retrato dao ~25mm cada: o nome comercial
#      quebrava em tres linhas e a observacao ficava ilegivel.
#      A conversao e do BACKEND (`documentoListas.js#linhaEmCampos`): cada celula vira
#      um `campoAuto` SEM `variavel` (o valor ja esta resolvido, mora em `texto`), com
#      `linha` separando um item do outro. Assim `removerVazios` limpa os brancos e os
#      dois renderizadores desenham sem saber que aquilo veio de uma lista - vale de
#      graca para tela, impressao e PDF do WhatsApp/e-mail.
#      ⚠ A ULTIMA coluna ocupa a linha inteira: e onde cai a observacao, e em um terco
#      de linha ela nao serve para escrever.
#      ⚠ `BlocoView` espelha o formato para a PRE-VISUALIZACAO mostrar o que vai sair.
#      ⚠ A ORDEM das colunas e a do PAPEL: Nome comercial / Vacinacao contra /
#      Fabricante, depois Numero da partida / Data de fabricacao / Data de validade, e
#      Observacao na linha inteira.
#   19. **CEP AUTOPREENCHE O ENDERECO na emissao** (a pedido), como na tela de
#      Proprietario: digitados os 8 digitos, `utils/viaCep.ts` busca e
#      `CamposForm.preenchimentoPorCep` espalha nos campos de endereco que AQUELE
#      documento pede - a decisao e por PISTA no rotulo (endereco/complemento/bairro/
#      cidade/estado/municipio), nunca por uma lista fixa de nomes: o mesmo CEP serve a
#      modelos escritos por gente diferente.
#      ⚠ Busca ao completar os 8 digitos, NAO no `blur`: quem digita o CEP e vai direto
#      ao campo seguinte veria o endereco aparecer por baixo do que esta escrevendo.
#      ⚠ Falha do ViaCEP e SILENCIOSA e o campo que ele nao soube preencher NAO entra no
#      mapa - apagar o que a pessoa digitou porque o servico devolveu vazio e pior do
#      que nao preencher.
#      ⚠ `utils/viaCep.ts` nasceu aqui; existem ~9 copias daquele `fetch` nas telas de
#      cadastro. Ao tocar numa delas, troque a copia local pelo util - nao faca a decima.
#   20. **A vacina sai UM CAMPO POR LINHA** (a pedido). Tres por linha foi tentado e
#      recusado: os rotulos sao longos ("Nome comercial da vacina", "Data de
#      fabricacao") e, em um terco de linha, rotulo e valor disputavam o espaco.
#      **"Local e data" foi para a DIREITA**, que e onde ele fica no oficio brasileiro,
#      logo acima da assinatura.
#   21. 🔴 **A REGRA DO CAMPO VAZIO VALE TAMBEM NA PRE-VISUALIZACAO** (a pedido,
#      reforcado): "campo sem preenchimento nao aparece na visualizacao, impressao ou
#      encaminhamento" e regra de TODO documento. `vazios.ts#semBlocosVazios` passou a
#      receber `{ contexto, preenchimento, listas }`: no MODELO o valor ainda mora em
#      `{{variavel}}` e nao em `texto`, e filtrar por `texto` cru apagaria os campos
#      PREENCHIDOS junto com os vazios.
#      ⚠ O `ModalPreencher` do EDITOR fica de fora: la a folha esta ao lado do
#      formulario e o traco em branco e CLICAVEL - e a unica pista de ONDE cada campo
#      cai no papel. Na pre-visualizacao nao ha formulario ao lado, entao o traco nao
#      levava a lugar nenhum.
#   22. **HISTORICO MOSTRA OS CANCELADOS + FILTRO POR STATUS** (a pedido). O
#      `GET /documentos/emitidos` nao filtra mais `ativo: true` - o historico e o
#      registro do que a clinica emitiu, e o documento cancelado e justamente o que
#      alguem vai querer conferir depois. Abas "Todos / Emitidos / Cancelados" com a
#      contagem, e SO os status que existem na lista (aba vazia e ruido; mesma regra
#      das abas da Prescricao e da Vacina). O filtro e da TELA: a lista ja vem inteira,
#      e assim a contagem e exata sem uma ida a mais ao backend por clique.
#      🔴 **CANCELADO NAO SE IMPRIME NEM SE ENVIA** - passou a importar agora que ele
#      aparece na lista: reimprimir poe em circulacao um papel que a clinica revogou, e
#      nada nele diria isso. VISUALIZAR fica (e assim que se confere o cancelamento e a
#      justificativa); Imprimir, WhatsApp e E-mail nao sao renderizados (§6).
#   23. **VACINA QUE NAO EXISTE E CADASTRADA NA HORA**, como na tela de Vacina: a coluna
#      do catalogo virou COMBOBOX (digita para filtrar) e, sem correspondencia exata,
#      oferece "Cadastrar X" - o MESMO `POST /medicamentos/garantir` de
#      `SubModuloVacina.criarVacinaLivre`, que cria a vacina PRIVADA da empresa com a
#      especie do paciente. Dali em diante ela e so mais um item do catalogo.
#      ⚠ Nasce SEM lote: fabricante, partida e validade ficam para digitar - o sistema
#      nao sabe nada de um frasco que nunca entrou no estoque.
#      ⚠ So aparece sem correspondencia EXATA (mesmo criterio da tela de Vacina), senao
#      convida a criar a duplicata de uma vacina que ja esta na lista.
#      ⚠ `onCriarOpcao` ausente = a coluna aceita texto livre mas nao cadastra nada: e o
#      caso do editor, onde nao ha paciente e o backend nao teria a especie para vincular.
#   🔴 **PARA RE-SEMEAR O CATALOGO GLOBAL**: o client PRECISA ser o estendido de tenant
#   E rodar DENTRO de `comEscopoPlataforma` - a extensao so carimba `app.plataforma`
#   quando ha contexto no AsyncLocalStorage, e sem esse carimbo o RLS recusa a escrita em
#   linha global (`empresa_id IS NULL`). Nem o dono do schema escapa: a tabela esta com
#   FORCE ROW LEVEL SECURITY. `node backend/seed.js` ja faz isso (`comEscopoPlataforma(main)`);
#   um `new PrismaClient()` puro morre com "new row violates row-level security policy".
#   Suite: 428.)
---

### Sessao 2026-09-03 - Folha sem cabecalho, campo vazio fora do papel e Anexo XI remodelado

- [x] 🔴 **O emitido exibia o EXEMPLO do catalogo por cima do dado real** - ver o item 1
      do topo. O dado gravado estava CERTO nos dois documentos ja emitidos; era so
      exibicao, e a impressao nunca errou (usa `conteudo.texto`).
      ⚠ Padrao a nao repetir: renderizar um snapshot RESOLVENDO de novo o que ja foi
      resolvido. Se o valor esta gravado, ele vence; e nenhuma folha real pode chegar ao
      resolvedor sem contexto - `{}` mantem o modo real, `undefined` cai no exemplo.
- [x] **Cabecalho sem as tres secoes, titulo centralizado**, em todos os documentos.
- [x] 🔴 **`removerVazios` no snapshot da emissao** - o que nao foi preenchido nao vai
      para o papel, em todos os documentos. 5 casos novos em `documentosCentral.test.js`
      travam o LIMITE da regra (texto normativo fica; "Rotulo:" sai; assinatura e
      linha ficam mesmo sem texto).
- [x] **Anexo XI**: campos removidos, "Vacinacao contra" digitavel e o frasco em grupo
      repetivel com seletor do catalogo. **"Vacinacao contra" e "Observacao" sao COLUNAS
      da lista** (a pedido): pertencem a VACINA, nao a secao. Nao ha mais bloco
      `observacoes` solto no modelo.
- [x] **Duas colunas** (`estilo.colunas`) nos 12 modelos.
- [x] **Paciente vazio** em `/documentos` e `/clinica/vacina`; "Tipo de Documento" e
      "Categoria" fora da tela de emissao.
- [x] **Campo vazio fora tambem da IMPRESSAO, do COMPARTILHAMENTO e da VISUALIZACAO**
      (`modules/documentos/vazios.ts`) - inclusive nos documentos emitidos ANTES da
      regra, cujo snapshot ainda tem os blocos vazios dentro.
- [x] **Municipio deduzido do endereco** da propriedade (item 10 do topo).
- [x] **`DateInput`** nas datas do documento; **tres colunas** no responsavel; **zoom
      inicial que cabe** na tela do celular/tablet.
- [x] **Cadastro do responsavel lido tambem de `tb_usuario_empresa`** e a secao dele
      passou a usar `cliente.endereco`/`cliente.municipio` (itens 13 e 14 do topo).
- [x] **Impressao em 2 vias**, com a contagem e os donos lidos do rodape do proprio
      documento (item 15).
- [x] **Endereco do responsavel campo a campo** e **lista de vacinas em CARDS**, nao em
      tabela (itens 17 e 18) - com o que esta em branco fora da tela, do papel e do PDF.
- [x] **CEP autopreenche o endereco** na tela de emissao (item 19); vacina **um campo
      por linha** e "Local e data" a direita (item 20).
- [x] **Campo vazio fora tambem da PRE-VISUALIZACAO** (item 21).
- [x] **Historico com os cancelados e filtro por status**, e o cancelado deixou de ser
      impresso/enviado (item 22).
- [x] **Vacina inexistente cadastrada na hora**, como na tela de Vacina (item 23).
- [ ] A visualizacao em TELA mostra uma folha so, mesmo quando o documento manda duas
      vias. Duplicar ali dobraria a rolagem para conferir o mesmo conteudo; se um dia
      fizer falta, `viasDoDocumento` ja e exportada.
- [ ] A **pre-visualizacao** continua mostrando o campo vazio como lacuna clicavel (e a
      ferramenta de preenchimento - e ela que liga a folha ao formulario), enquanto o
      EMITIDO ja nao o traz. E deliberado; se incomodar, o lugar e a mesma chave que
      `Emitidos.tsx` ja usa (a presenca de `contexto`).
- [ ] `OPCOES` tem UMA fonte (`empresa.vacinas`). Medicamento, procedimento e exame
      seguiriam o mesmo molde - falta so a consulta de cada um.
- [ ] O catalogo de vacinas vem INTEIRO para a tela (231 nesta base) num `<select>`
      simples. Passando de uns poucos milhares, o caminho e o combobox com busca que o
      seletor de documento ja usa.
- [ ] `exameParserService.chamarGeminiComLog` continua com o defeito latente de `modelo`
      indefinido no log de FALHA (item aberto desde 01/09).

---

# Atualizado em: 2026-09-02 (🔴 A ASSINATURA DO VETERINÁRIO SAÍA NA LINHA DE TODO
#   MUNDO + RECEITUÁRIO DE CONTROLE ESPECIAL na Prescrição + lupa na visualização.
#   1. 🔴 **O BLOCO `assinatura` CARIMBAVA A ASSINATURA ESCANEADA DO VETERINÁRIO EM
#      QUALQUER LINHA**, fosse qual fosse o papel escrito embaixo. No receituário de
#      controle especial o FARMACÊUTICO aparecia assinando com a assinatura do vet; nos
#      8 TCLEs o tutor "consentia" com o NOME DO VETERINÁRIO sobre a linha. Documento
#      falso, e nada no sistema acusaria. Campo novo `conteudo.assinante`
#      ('VETERINARIO' | 'OUTRO'): só na linha do veterinário entram a imagem, o nome e
#      o CRMV da MARCA; nas demais a linha sai VAZIA (o espaço de 42px FICA — é onde a
#      pessoa assina). Regra em `catalogo.ts#assinaturaDoVeterinario`, FONTE ÚNICA dos
#      dois espelhos (`BlocoView.tsx` e `utils/DocumentoPrint.ts`).
#      ⚠️ **SEM MIGRATION E SEM RE-SEED**: bloco já gravado não tem `assinante`, e aí a
#      regra cai em `mostrarCrmv` — que é `true` exatamente na linha do veterinário nos
#      12 modelos do CFMV e na regra que o prompt de conversão sempre seguiu. O seed e o
#      catálogo passaram a gravar o campo explícito para o que nascer daqui em diante.
#      ⚠️ `assinante` entrou no WHITELIST de `documentoLLMService.normalizarBlocos` —
#      fora dele o campo seria apagado em silêncio e a linha do farmacêutico voltaria a
#      sair assinada pelo vet. O prompt `converter_documento` passou a exigi-lo.
#      Editor ganhou o seletor "Quem assina"; "Exibir CRMV" só aparece no veterinário.
#   2. **RECEITUÁRIO DE CONTROLE ESPECIAL — Imprimir/WhatsApp/E-mail da Prescrição.**
#      Havendo medicamento CONTROLADO no documento, os três botões passam a produzir
#      DOIS papéis: os itens comuns saem na receita de sempre e os controlados vão para
#      o modelo **"Receita Controlada"** da Central, na tela de emissão, já apontada
#      para o paciente e para AQUELA prescrição. Um papel só faria o remédio corriqueiro
#      nascer num receituário especial; tudo no comum deixaria o controlado sem a via
#      numerada que a norma exige.
#      🔴 Quem classifica é o CATÁLOGO (`medicamentoCat.controlado`), NUNCA o texto de
#      `medicamento` — o campo é livre. Item fora do catálogo conta como comum.
#      ⚠️ **A ordem é imprimir → navegar**: sair da tela antes dispara e cancela o
#      diálogo do navegador. ⚠️ Prescrição só de controlados NÃO imprime o papel comum
#      (seria folha em branco).
#      ⚠️ **SEM o modelo no acervo (ou sem permissão para ler a Central) NADA é
#      recortado**: a ação faz o que fazia antes, com o grupo INTEIRO, e um toast diz o
#      motivo. Recortar em silêncio faria o vet imprimir uma receita de onde o
#      controlado sumiu sem ele perceber. O modelo é procurado PELO NOME
#      (`receitaControlada.ts`), não por id: ele é criado por cada clínica.
#      Fonte nova **`prescricao.controlados`** (`lib/documentoListas.js` + espelho em
#      `listas.ts`): mesmos campos de `prescricao.medicamentos`, só os controlados —
#      colunas IDÊNTICAS de propósito, senão a dose cairia na coluna errada ao trocar a
#      fonte de um modelo já montado. `POST /documentos/campos` aceita
#      `prescricaoGrupoId` e `/documentos` aceita `?templateId=` + `?prescricaoGrupoId=`
#      — sem o id do grupo, o receituário de uma receita antiga nasceria com os
#      medicamentos da mais recente.
#   3. **Lupa na visualização do documento** (`Emitidos.tsx#VisualizarDocumentoModal`,
#      que serve ao emitido E à pré-visualização): ZoomOut · % · ZoomIn no cabeçalho,
#      passos discretos de 40% a 200%, abrindo nos 62% de sempre; o % clicado volta ao
#      padrão. É CROMO, não ação de registro — paleta cinza do X (§6), não `AcaoRegistro`.
#      ⚠️ A margem de compensação virou `297 * (zoom - 1)mm`: `transform` não muda a
#      caixa do layout, então reduzindo sobra vão embaixo e ampliando o fim da folha
#      fica fora do scroll. ⚠️ A centralização passou de `justify-center` para
#      `margin: auto` no filho: em caixa que ROLA, `justify-content: center` corta o
#      COMEÇO do conteúdo, e a folha ampliada ficaria com a margem esquerda
#      inalcançável.
#   3b. 🔴 **O CADASTRO PESSOAL ESCONDIA O CRMV E A ASSINATURA QUE ESTAVAM
#      GRAVADOS.** O bloco "Dados Profissionais" era gateado só por `precisaCrmv`
#      (= atua como vet OU declarou especialidade), e `especialidadesEscolhidas`, para
#      quem tem equipe, sai dos LOCAIS DE TRABALHO do vínculo da empresa ATIVA. Vínculo
#      cujos locais estão sem especialidade — o caso comum logo depois que o gestor
#      inclui o membro — zerava a conta, e a tela abria SEM o CRMV e SEM a assinatura
#      que existem no banco. Com outro contexto resolvido a mesma rota mostrava tudo, e
#      parecia haver DUAS telas de cadastro (foi assim que o defeito foi relatado).
#      Regra nova: **tendo dado profissional, a tela MOSTRA**
#      (`mostrarDadosProfissionais` = `precisaCrmv` OU tem CRMV/assinatura/espécies/
#      especialidade gravados). A OBRIGATORIEDADE não mudou de lugar: `precisaCrmv`
#      continua governando a validação e o asterisco do CRMV (`required={precisaCrmv}`),
#      senão quem tem só a assinatura passaria a ser barrado por um CRMV que ninguém
#      pediu. ⚠️ A visibilidade tem de ser SUPERCONJUNTO da validação, nunca o
#      contrário: campo exigido e não exibido é formulário que recusa salvar sem dizer
#      onde. ⚠️ Só há UMA tela de cadastro pessoal (`/cadastro-pessoal`); o que
#      variava era o BLOCO condicional dentro dela.
#   4. Tela de emissão (`/documentos`): o `<option>` do paciente mostra só o NOME (não
#      concatena mais o proprietário) e os campos Nome do Documento / Tipo de Documento
#      abrem SEM texto de dica. ⚠️ Com isso o desempate de XARÁS que o `<option>` fazia
#      deixou de existir — ver a pendência na §12. Suíte: 297.)
---

# Atualizado em: 2026-09-02 (Orçamento de VACINA passou a capturar TIPO DOSE
#   e VIA APLICAÇÃO — mesmos dois campos obrigatórios da tela de Vacina
#   (SubModuloVacina). Antes o orçamento só guardava vacina+quantidade(doses);
#   ao importar, Dose/Via chegavam em branco e tinham que ser preenchidas de
#   novo na Vacina, mesmo já tendo sido orçadas. Colunas novas
#   `OrcamentoItem.tipoDose`/`.via` (migration `20260902000000`, 🔴 gerada, NÃO
#   aplicada); aba Vacinas do Orçamento ganhou os dois selects (mesmas opções de
#   `DOSES`/`VIAS_PADRAO`, extraídas para `utils/vacina.ts` — fonte única,
#   reusada pela tela de Vacina) e passaram a ser OBRIGATÓRIOS para adicionar
#   qualquer vacina ao orçamento (`OrcamentoController.validarVacina`, mesmo
#   padrão de `validarEspecialidade` para Procedimento/Combo). Import na Vacina
#   (`SubModuloVacina.importarDoOrcamento`) usa `tipoDose`/`via` do item quando
#   presentes; item de orçamento ANTERIOR à mudança (sem os dois campos) cai no
#   comportamento antigo — Via pelo heurístico do catálogo, Dose em branco.)
---

### Sessão 2026-09-02 — Assinatura por PAPEL, receituário de controle especial e lupa

- [x] 🔴 **A assinatura escaneada do veterinário saía na linha de TODO mundo.** O bloco
      `assinatura` lia a MARCA e desenhava imagem + nome + CRMV sem olhar o `rotulo`:
      "Farmacêutico", "Comprador" e "Responsável pelo animal" saíam todos assinados
      pelo veterinário que emitiu. Nos 8 TCLEs do CFMV isso já acontecia desde 26/08 —
      o termo de consentimento saía com o vet no lugar do tutor.
      Campo novo `conteudo.assinante` ('VETERINARIO' | 'OUTRO'), com a regra em
      **`catalogo.ts#assinaturaDoVeterinario`** — fonte única de `BlocoView.tsx` e de
      `utils/DocumentoPrint.ts` (duas cópias divergiriam, e divergir aqui volta a
      falsificar papel).
      ⚠️ **Sem migration e sem re-seed**: bloco gravado sem `assinante` cai em
      `mostrarCrmv`, que é `true` exatamente na linha do veterinário nos 12 modelos e na
      regra que o prompt sempre seguiu. O seed e o catálogo passaram a gravar o campo.
      ⚠️ O espaço de 42px acima da linha FICA na linha de outra pessoa: é onde ela
      assina. O que some é a identidade, não o lugar de assinar.
      ⚠️ `assinante` entrou no whitelist de `normalizarBlocos` (`documentoLLMService`),
      senão o campo seria descartado em silêncio nos blocos vindos da IA.
      Editor: seletor "Quem assina" + "Exibir CRMV" só no veterinário (28-d).
- [x] **Receituário de controle especial na Prescrição** — ver o item 2 do topo.
      `receitaControlada.ts` (busca do modelo por NOME + rota da emissão) e
      `receituarioControladoOuComum` em `SubModuloPrescricao`, função de MÓDULO usada
      pela lista E pelo modal de visualização (28-g: os dois têm o mesmo Imprimir).
- [x] **Lupa na visualização do documento** — ver o item 3 do topo.
- [x] 🔴 **Cadastro Pessoal escondia CRMV e assinatura já gravados** — ver o item 3b
      do topo. `mostrarDadosProfissionais` (VISIBILIDADE) passou a ser superconjunto de
      `precisaCrmv` (OBRIGATORIEDADE), e o asterisco do CRMV acompanha a segunda.
- [ ] O cadastro PESSOAL (nome, telefone, endereço) continua sendo POR EMPRESA
      (`tb_usuario_empresa`, §36): vínculo com os campos nulos abre a tela em branco
      NAQUELA empresa, de propósito — não é o mesmo defeito do bloco profissional, e
      cair no cadastro de outra clínica violaria a regra 36-b. Se o relato de "abre
      vazio" reaparecer com os campos pessoais, o lugar de olhar é a linha de
      `tb_usuario_empresa` da empresa que o seletor resolveu.
- [ ] O `ModalPreencher` do editor e o `Mobile.tsx` renderizam a folha com escala FIXA
      e não ganharam a lupa. São a pré-visualização de quem MONTA o modelo, não a de
      quem confere o papel emitido; se incomodar, o controle é o mesmo de `Emitidos`.
- [ ] O `<option>` do paciente em `/documentos` perdeu o nome do proprietário (a
      pedido), e com ele o desempate de XARÁS — dois pacientes homônimos de donos
      diferentes viram duas linhas idênticas. O `SeletorAnimalInteligente` foi removido
      da tela em 30/08 e não há outro distintivo. Se aparecer no uso, o caminho é pôr
      baia/local no `<option>` ou trazer o seletor de volta.
- [ ] `linhasDaFonte` para `prescricao.controlados` lê UM grupo (o pedido, o do
      atendimento ou o último). Receituário que precise juntar os controlados de várias
      prescrições não tem como pedir isso.

---

# Atualizado em: 2026-09-01 (parte 2) (LISTAS REPETÍVEIS — medicamento, vacina, exame e
#   procedimento deixaram de ser texto e viraram GRUPOS DE CAMPOS que se repetem.
#   🔴 O QUE SE REPETE NÃO É LACUNA: uma lacuna é um campo e um valor, e o número de
#   medicamentos de uma receita não é propriedade do MODELO, é de cada EMISSÃO — com
#   lacunas, o quinto medicamento não teria onde entrar. Na tela vira um repetidor com
#   "+ Adicionar"; no papel, uma tabela. Fonte única em `lib/documentoListas.js`,
#   espelhada em `modules/documentos/listas.ts`.
#   🔴 E A LISTA JÁ NASCE PREENCHIDA com o que o PACIENTE tem registrado (a prescrição
#   do atendimento em curso, as vacinas aplicadas, os exames pedidos) — é o
#   "autopreenchido" pedido em 01/09. ⚠️ As COLUNAS da fonte são CANÔNICAS, não as que o
#   modelo declarou: é o que faz o dado alinhar em vez de a dose cair na coluna da
#   quantidade. Lista sem fonte (`listaCampos`) usa as colunas do modelo e nasce vazia.
#   ⚠️ Os quatro blocos clínicos que já existiam mostravam linha de EXEMPLO com a
#   legenda "Preenchido na emissão" e no papel saíam VAZIOS — promessa que nada cumpria.
#   Agora é verdade. ⚠️ No emitido a lista vira `tabela` LITERAL e o `fonteDados` é
#   APAGADO: reimprimir daqui a dois anos não pode voltar ao banco e trazer a prescrição
#   de hoje. Suíte: 293. Ver a sessão 2026-09-01 (parte 2) na §12.)
---

# Atualizado em: 2026-09-01 (parte 2) (Mesma justificativa OBRIGATÓRIA na
#   INATIVAÇÃO, estendida a Estoque de Vacinas e Estoque de Farmácia
#   (`EstoqueVacinaController.toggle`/`EstoqueController.toggle`) — a lib
#   `lib/cadastroAtivacao.js` já suportava as tabelas 'lote_vacina'/
#   'estoque_farmacia' de propósito, então foi só ligar o mesmo fio: coluna
#   `inativo_motivo` nas duas tabelas, `ModalJustificativa` antes do toggle (só
#   ao inativar) e coluna "Justificativa" na aba Inativos de `EstoqueVacina.tsx`/
#   `Farmacia.tsx`. 🔴 Migration GERADA
#   (`20260901000001_justificativa_inativacao_estoque`), NÃO aplicada.)
---

### Sessão 2026-09-01 (parte 2) — Listas REPETÍVEIS: medicamento, vacina, exame e procedimento

- [x] 🔴 **O QUE SE REPETE NÃO É LACUNA.** Uma lacuna (`[[Rótulo]]`) é um campo e um
      valor — serve para "Nome do comprador", não para "os medicamentos da receita".
      Uma receita pode sair com um medicamento ou com seis, e **isso não é propriedade
      do MODELO, é de cada EMISSÃO**: com lacunas, o modelo teria de trazer escrito o
      número máximo de itens, e o quinto medicamento não teria onde entrar.
      Nasce a LISTA: um grupo de sub-campos (as colunas) repetido N vezes (as linhas),
      com o N escolhido na hora de emitir. Na tela vira um repetidor com
      **"+ Adicionar"**; no papel, uma tabela.
      Fonte única: **`backend/src/lib/documentoListas.js`**, espelhada em
      `frontend/src/modules/documentos/listas.ts` (a tela precisa saber a que grupo cada
      bloco pertence para a pré-visualização ao vivo — mesma divisão de `campos.ts`,
      onde o COLETOR é do servidor e só o APLICADOR é local).
- [x] 🔴 **E A LISTA JÁ NASCE PREENCHIDA — é o "autopreenchido" do pedido.** Quando o
      grupo aponta para uma FONTE clínica, as linhas vêm do que o paciente REALMENTE
      tem no S2Vet: a última prescrição (a DO ATENDIMENTO em curso quando há
      `evolucaoId`), as vacinas aplicadas, os exames pedidos. O vet confere, corrige e
      acrescenta — não redigita o que o sistema já sabe.
      ```
      prescricao.medicamentos  → Medicamento · Dose · Via · Frequência · Duração
      prescricao.procedimentos → Procedimento · Quantidade · Observação
      vacinas.aplicadas        → Vacina · Lote · Aplicação · Próxima dose
      exames.resultados        → Exame · Solicitado em · Resultado
      ```
      ⚠️ **AS COLUNAS DA FONTE SÃO CANÔNICAS**, não as que o modelo declarou. É isso que
      faz o preenchimento ALINHAR: se o modelo pedisse ["Remédio", "Qtd"] e a consulta
      devolvesse cinco campos, a dose cairia na coluna da quantidade. Há teste travando.
      ⚠️ Lista SEM fonte (grupo genérico, `listaCampos`) usa as colunas do modelo e
      nasce VAZIA — ali não há dado a alinhar.
      ⚠️ "NADA DE INVENTAR VALOR" continua valendo: paciente sem prescrição abre uma
      linha em branco, nunca um medicamento plausível.
- [x] **Os quatro blocos clínicos que já existiam viraram listas de verdade.**
      `medicamentos`, `vacinas`, `procedimentos` e `exames` mostravam linhas de EXEMPLO
      no editor com a legenda *"Preenchido na emissão a partir de X"* — **promessa que
      nada cumpria**: `aplicarEmBlocos` nunca os tocava e no papel eles saíam VAZIOS.
      Agora a legenda é verdade. `tabelaDinamica` entrou junto, pelo mesmo motivo.
- [x] **Bloco novo `listaCampos`** para o grupo repetível que o sistema NÃO tem (dados
      do comprador, itens de um lote, produtos de uma nota): `conteudo.rotulo` nomeia o
      grupo e `conteudo.colunas` são os campos de cada item.
- [x] **O valor de uma lista é uma TABELA, não um texto** — por isso ele viaja num mapa
      PRÓPRIO (`listas: Record<chave, string[][]>`), ao lado de `preenchimento`, e não
      dentro dele. Encaixar linhas num `Record<string,string>` obrigaria a serializá-las
      dentro de string, e a primeira vírgula digitada quebraria a leitura.
      `POST /documentos/campos` devolve `listas[]` com `sugestao` já pronta;
      `POST /documentos/emitidos` recebe `listas` e as aplica no snapshot.
- [x] ⚠️ **As listas entram ANTES da resolução de variáveis** (`aplicarEmBlocos` ganhou
      um 4º parâmetro). É o que faz "aplicar em {{animal.nome}}" digitado numa CÉLULA
      sair com o nome do paciente, como qualquer outro texto da folha.
- [x] ⚠️ **No emitido, a lista vira `tabela` LITERAL e o `fonteDados` é APAGADO.** O
      documento é um snapshot: reimprimir daqui a dois anos não pode voltar ao banco e
      trazer a prescrição de hoje. Linha totalmente em branco é descartada — tabela com
      buraco impressa é pior que tabela curta.
- [x] **Repetidor único** (`CamposForm.tsx#ListaCamposInput`), usado pela tela de
      emissão (`pages/Documentos.tsx`) E pelo `ModalPreencher` do editor — duas cópias
      divergiriam na primeira correção (28-g). Selo "do cadastro do paciente" quando a
      linha veio sugerida: sem ele, a linha que apareceu sozinha parece dado inventado
      pelo sistema. Campos e listas são agrupados na MESMA seção do formulário — para
      quem emite, os dois são "o que falta preencher".
- [x] **O prompt aprendeu a regra** (`converter_documento`): medicamento, vacina,
      exame, procedimento e posologia NUNCA viram texto com o valor do exemplo nem par
      de lacunas fixo — viram lista. Verificado numa conversão real da receita de
      controle especial: o bloco "Gabapentina … 150 mg / Dose q.s.p … 120 un / Dar 1
      dose a cada 12 hrs" saiu como UM bloco `medicamentos` (auto-preenchido), e a caixa
      "Identificação do Comprador" como um `listaCampos` de Nome · RG · Endereço ·
      Cidade e UF · Telefone.
- [x] **Retentativa única para falha TRANSITÓRIA do provedor** (503 "high demand", 429,
      5xx, UNAVAILABLE). O Gemini devolve 503 de vez em quando e a falha é do MINUTO,
      não do documento: sem isto, um pico de demanda do Google empurra o envio para o
      caminho da imagem e o vet perde os campos por um motivo que não tem nada a ver com
      o arquivo dele. ⚠️ UMA só, e só transitória: erro de conteúdo não melhora
      repetindo, e insistir dobraria a espera antes de cair no mesmo lugar.
- [x] 🔴 **Bug encontrado no próprio log de IA**: quando a chamada multimodal FALHA,
      `modelo` ficava `undefined` e `logAiUsage` morria com *"Argument `modelo` is
      missing"* — perdendo justamente o registro da falha que se quer investigar. Agora
      começa em `MODELO_PADRAO`. ⚠️ `exameParserService.chamarGeminiComLog` tem a MESMA
      forma e o mesmo defeito latente; aplicar quando for tocado.
      Testes: 5 casos novos (53 no arquivo, **293 na suíte**); `tsc -b` e `vite build`
      limpos.
- [ ] `linhasDaFonte` lê a ÚLTIMA prescrição/vacina/exame do paciente. Documento que
      precise de uma janela ("as vacinas dos últimos 12 meses") não tem como pedir isso
      — o gancho seria um parâmetro no `fonteDados`, e não foi pedido.
- [ ] O `Mobile.tsx` renderiza a folha sem `listas` (é a pré-visualização do EDITOR, que
      mostra os exemplos). Se o fluxo mobile passar a emitir, precisa receber os valores
      como a tela de emissão recebe.

---

# Atualizado em: 2026-09-01 (CABEÇALHO PADRÃO EM TODA FOLHA + DOCUMENTO ENVIADO VIRA
#   MODELO DE VERDADE, com os campos identificados por IA.
#   1. **TODO documento passa a abrir com o MESMO cabeçalho**: logomarca no canto
#      superior esquerdo, TÍTULO abaixo dela, e então **Veterinário · Proprietário ·
#      Paciente**, uma linha cada. Substitui o "timbre" anterior, que era só a logo.
#      🔴 FONTE ÚNICA da REGRA em `modules/documentos/cabecalho.ts#prepararFolha` — o
#      que entra, em que ordem e o que some vazio. O DESENHO continua duplicado nos
#      dois espelhos de sempre: `CabecalhoFolha.tsx` (preview A4, emissão, mobile,
#      visualização do emitido) e `utils/DocumentoPrint.ts#cabecalhoHtml` (impressão e
#      PDF do Puppeteer, que recebem STRING). Ao mexer no visual, mexa nos dois.
#      ⚠️ O PRIMEIRO bloco `titulo` visível é **ABSORVIDO** pelo cabeçalho, em vez de
#      ele acrescentar um título próprio acima. Sem isso os 12 modelos do CFMV (que
#      começam com "ATESTADO SANITÁRIO", como a norma exige) sairiam com o título
#      IMPRESSO DUAS VEZES, e a ordem pedida — título antes dos dados — se inverteria.
#      Por isso todo renderizador consome `corpo`, nunca `blocos` cru.
#      ⚠️ Campo sem dado NÃO vira "—": ele some, e a seção some inteira quando nenhum
#      dos seus campos resolveu (§12, 26/08 — "nada de inventar valor").
#      ⚠️ No EMITIDO o cabeçalho sai do SNAPSHOT (`doc.contexto` + `doc.marca`), e o
#      contexto é `?? {}` e **NUNCA `?? null`**: sem contexto, `resolverVariaveis` cai
#      no modo EXEMPLO do catálogo e o papel REAL sairia com "Thor" no cabeçalho.
#   2. 🔴 **O DOCUMENTO ENVIADO PELA CLÍNICA DEIXOU DE SER UMA FOTOGRAFIA.** Até aqui
#      o arquivo virava blocos `imagem`, uma por página: imprimia, ia por WhatsApp e
#      entrava no histórico como qualquer outro — mas era papel morto, sem UM campo e
#      sem preencher nada sozinho. Agora o diálogo de envio traz **"Identificar os
#      campos automaticamente"** (ligada por padrão): as páginas vão para a IA
#      (`converter_documento@v1` + `services/documentoConversaoService.js`, MULTIMODAL
#      — imagens + o texto embutido do PDF) e voltam como BLOCOS de verdade, com
#      `{{variáveis}}` no que o S2Vet já sabe e `[[lacunas]]` no que ele não sabe. Daí
#      em diante o resto do módulo já funcionava: `coletarCampos` monta o formulário e
#      a emissão resolve as variáveis.
#      ⚠️ **NENHUM DADO DO ARQUIVO DE EXEMPLO SOBREVIVE.** O que a clínica envia é uma
#      via JÁ EMITIDA de outro paciente ("Billy", "Cláudia Gama", "CRMV 6263",
#      "Gabapentina 150 mg"). Copiar qualquer valor para o modelo produziria documento
#      FALSO EM SÉRIE, e nada acusaria. Regra no prompt, em caixa alta e repetida.
#      ⚠️ REDE DE SEGURANÇA depois do modelo: chave de variável ALUCINADA vira
#      `[[Rótulo]]` (`variaveisDesconhecidas`), nunca é apagada — chave desconhecida
#      resolve VAZIO na emissão, então o campo sumiria do papel calado; virando lacuna,
#      ele aparece no formulário e alguém decide o que escrever. Só UM bloco `titulo`
#      sobrevive (`umTituloSo`), pelo motivo do item 1.
#      ⚠️ A IA descreve CONTEÚDO, não aparência: o estilo padrão de cada tipo é
#      aplicado na borda do front (`catalogo.ts#comEstiloPadrao`), senão um título
#      viria com corpo de texto e uma tabela sem borda.
#      ⚠️ **FALHA NÃO É ERRO DE TELA**: arquivo que não é documento, JSON inválido ou
#      IA fora do ar respondem 200 com `ehDocumento: false`, e o envio CAI NO CAMINHO
#      DA IMAGEM — que é o comportamento de sempre e nunca falha. Perder o envio por
#      um 500 do modelo seria trocar documento sem campos por documento nenhum. O
#      único erro propagado é o 429 de QUOTA, que é decisão do plano do cliente.
#      Rota nova `POST /documentos/templates/converter` (multipart `paginas[]` + campo
#      `texto`, gate `documentos.templates.criar`, `/converter` ANTES de `/:id`,
#      `tenantRls` após o multer). NÃO grava nada: devolve a proposta, e quem cria o
#      modelo é o `POST /templates` de sempre.
#      ⚠️ MULTIMODAL não passa por `callAI` (que só aceita texto) — vai por
#      `gerarConteudo`, então o log de uso E o **gate de quota** são feitos à mão no
#      serviço. Esquecer o gate deixaria este caminho fora do teto do plano (§7).
#      Teto de 4 páginas, espelhado no front (`api.ts#MAX_PAGINAS_IA`).
#   3. `upload.ts` foi partido em `paginasDoArquivo` (arquivo → imagens + texto do PDF,
#      o passo comum aos dois caminhos) e `blocosDeImagens` (o caminho reserva).
#      `arquivoParaBlocos` continua existindo como atalho do reserva.
#      ⚠️ O texto embutido viaja JUNTO das imagens para a IA, não no lugar delas: o
#      texto dá a redação exata (nenhum OCR erra vírgula que já está lá) e a imagem dá
#      a ESTRUTURA (o que é caixa, tabela, linha de assinatura). Um só perde metade.
#      Suíte: 288 backend passando; `tsc -b` + `vite build` limpos.)
---

# Atualizado em: 2026-09-01 (Justificativa OBRIGATÓRIA na INATIVAÇÃO de Equipe,
#   Fornecedor, Prestador, Tratador e Proprietário — mesmo padrão que Paciente
#   (Animal) já tinha. Coluna nova `inativo_motivo` (Animal: `desativado_motivo`,
#   nome diferente por já existir `inativo_motivo` de OUTRO recurso naquela tabela)
#   nas 6 tabelas, exibida como coluna "Justificativa" na aba Inativos de cada tela
#   (`components/JustificativaCancelamento.tsx`, truncado+tooltip). Toggle de
#   Equipe/Fornecedor/Prestador/Tratador passou a exigir motivo via
#   `ModalJustificativa` só ao INATIVAR — ativar continua direto. 🔴 Migration
#   GERADA (`20260901000000_justificativa_inativacao`), NÃO aplicada — confirmar
#   antes de `npx prisma migrate deploy`. Faturamento: proprietário inativado
#   (`removerDaEmpresa`) não some mais da lista enquanto tiver fatura
#   ABERTA/FECHADA/ATRASADA (`FaturaController.listarProprietarios`), com selo
#   "Inativo" no card. `removerDaEmpresa` passou a cancelar automaticamente todo
#   orçamento APROVADO/APROVADO_PARCIALMENTE do proprietário — motivo "Cancelado
#   pelo sistema — proprietário inativado." acrescentado a `Orcamento.observacao`
#   (mesmo padrão do `orcamentoCronService.js`); `OrcamentoController.excluir`
#   (cancelamento manual) passou a fazer o mesmo, e a tela de Orçamento ganhou a
#   coluna "Motivo do Cancelamento" — só quando o filtro é Cancelado.)
---

### Sessão 2026-09-01 — Cabeçalho padrão da folha + documento enviado vira modelo com campos

- [x] **Cabeçalho igual em TODO documento** — logo (canto superior esquerdo) → TÍTULO →
      **Veterinário** → **Proprietário** → **Paciente**, uma linha cada, com os campos
      separados por `·`. Substitui o "timbre", que mostrava só a logomarca.
      🔴 A REGRA mora em `modules/documentos/cabecalho.ts#prepararFolha`: quais campos
      entram, em que ordem, e o que acontece quando estão vazios. Os DESENHOS continuam
      sendo dois, como toda a Central — `CabecalhoFolha.tsx` (JSX) e
      `utils/DocumentoPrint.ts#cabecalhoHtml` (STRING, para a impressão por iframe e o
      PDF do Puppeteer). O que não podia divergir era o CONTEÚDO, e é ele que está
      centralizado.
      Aplicado nos QUATRO renderizadores de folha, sem exceção: `PreviewA4` (editor),
      `ModalPreencher` (emissão), `VisualizarDocumentoModal` (emitido e
      pré-visualização) e `CentralMobile`.
- [x] ⚠️ **O primeiro bloco `titulo` visível é ABSORVIDO pelo cabeçalho.** Sem isso, os
      12 modelos do CFMV — que começam com "ATESTADO SANITÁRIO" e amigos, porque a
      norma exige — sairiam com o título impresso DUAS VEZES, e a ordem pedida (título
      antes dos dados) se inverteria. Por isso `prepararFolha` devolve `{ cabecalho,
      corpo }` e **todo renderizador consome `corpo`, nunca `blocos` cru**.
      Só o PRIMEIRO e só antes de qualquer conteúdo: `titulo` no meio da folha é
      subtítulo de seção e continua onde está.
- [x] ⚠️ **Campo sem dado SOME** — não vira "—" nem "N/A", e a seção inteira desaparece
      quando nenhum dos seus campos resolveu. É a regra de 26/08 ("nada de inventar
      valor") aplicada ao cabeçalho: um cabeçalho afirmando "Peso: 480 kg" porque o
      cadastro está em branco é documento falso.
- [x] ⚠️ **No EMITIDO, o cabeçalho sai do SNAPSHOT** (`doc.contexto` + `doc.marca`),
      nunca do cadastro de hoje — reimprimir daqui a dois anos tem de devolver o
      proprietário e o paciente COMO ESTAVAM.
      🔴 E o contexto é `?? {}`, **NUNCA `?? null`**: sem contexto, `resolverVariaveis`
      cai no modo EXEMPLO do catálogo e o papel REAL sairia com "Thor" e "Haras Boa
      Vista" no cabeçalho. Objeto vazio mantém o modo real, com o que falta saindo
      vazio. Vale nos dois espelhos.
- [x] 🔴 **O DOCUMENTO ENVIADO PELA CLÍNICA DEIXOU DE SER UMA FOTOGRAFIA.** Desde
      30/08 o arquivo virava blocos `imagem`, uma por página: imprimia, ia por
      WhatsApp e entrava no histórico como qualquer documento — mas era papel morto,
      sem UM campo para digitar e sem preencher nada sozinho.
      O diálogo de envio ganhou **"Identificar os campos automaticamente"**, LIGADA por
      padrão: as páginas vão para a IA e voltam como BLOCOS de verdade, com
      `{{variáveis}}` no que o S2Vet já sabe (paciente, proprietário, veterinário,
      datas) e `[[lacunas]]` no que ele não sabe (nome do comprador, RG, nº da partida,
      tatuagem). **Daqui para a frente nada é novo**: `coletarCampos` já monta o
      formulário da emissão e `aplicarEmBlocos` já resolve as variáveis — era só
      produzir um modelo que os alimentasse.
      Desligar existe para o papel que não tem nada a preencher (informativo, tabela de
      referência) e para quem prefere a via digitalizada intacta.
- [x] **`converter_documento@v1`** (`ai/prompts/converterDocumento.js`, arquivo próprio
      como `assistenteDocumento`) + **`services/documentoConversaoService.js`**.
      MULTIMODAL: as páginas vão anexadas (`inlineData`) junto do texto que o PDF
      trazia embutido.
      ⚠️ **NENHUM DADO DO ARQUIVO DE EXEMPLO SOBREVIVE.** O que a clínica envia é uma
      via JÁ EMITIDA de outro paciente — traz "Billy", "Cláudia Gama", "CRMV 6263",
      "Gabapentina 150 mg". Copiar qualquer um desses valores para o modelo produziria
      documento FALSO EM SÉRIE: toda emissão futura sairia com o nome do animal de
      outra pessoa, e nada no sistema acusaria. É a primeira regra do prompt.
      ⚠️ O prompt **PROÍBE recriar o cabeçalho** (logo, endereço da clínica, caixas de
      "Identificação do Emitente", "Animal" e "Tutor"): a folha já os desenha sozinha,
      e recriá-los como blocos os imprimiria duas vezes.
      ⚠️ Texto normativo (declaração, aviso legal, identificação da via) é VERBATIM.
- [x] **REDE DE SEGURANÇA depois do modelo**, no serviço:
      - `variaveisDesconhecidas` — chave de variável ALUCINADA vira `[[Rótulo]]`, nunca
        é apagada. Chave desconhecida resolve VAZIO na emissão (regra de "nada de
        inventar valor"), o que é correto no modelo feito à mão, onde alguém escolheu a
        variável de uma lista; escrita pelo LLM, ela viraria um buraco SILENCIOSO no
        papel. Virando lacuna, aparece no formulário e uma pessoa decide o que escrever.
        ⚠️ `campoAuto` fica de fora: variável que não resolve ali já vira campo sozinha
        (`coletarCampos`, origem CADASTRO, chaveada pelo rótulo).
      - `umTituloSo` — só o primeiro bloco `titulo`, pelo motivo do item do cabeçalho.
      - `normalizarBlocos` (reusado de `documentoLLMService`) — tipo desconhecido é
        DESCARTADO, nunca convertido em `texto`.
      - `catalogo.ts#comEstiloPadrao` (front, na borda) — a IA descreve CONTEÚDO e quase
        nunca estilo (devolve `estilo: {}`); sem esta passada, o título viria com corpo
        de texto e a tabela sem borda. O que ela mandar continua valendo por cima.
- [x] ⚠️ **FALHA NÃO É ERRO DE TELA.** Arquivo que não é documento, JSON inválido, IA
      fora do ar → 200 com `ehDocumento: false`, e o envio CAI NO CAMINHO DA IMAGEM,
      que é o comportamento de sempre e nunca falha (com um `toast` dizendo o que
      houve). Perder o envio por causa de um 500 do modelo seria trocar um documento
      sem campos por documento nenhum. O ÚNICO erro propagado é o **429 de QUOTA**, que
      é decisão do plano do cliente e precisa ser dita (`next(err)`, §7).
- [x] 🔴 **MAS A FALHA SEMPRE DIZ O MOTIVO** (corrigido no mesmo dia, depois do primeiro
      envio real). A primeira versão devolvia `ehDocumento: false` PELADO e o front
      fazia `.catch(() => null)`: "sem empresa no contexto", "sem permissão", "a rota
      não existe no servidor em execução", "as páginas não chegaram", "a IA está fora
      do ar" e "isto não é um documento" viravam A MESMA frase na tela — e não sobrava
      nada para depurar, nem no cliente nem no servidor (o `console.error` do
      controller some no Winston de quem não está olhando o terminal).
      Agora o backend devolve `motivo` em TODOS esses caminhos e loga com `logger.error`
      (com stack); `api.ts#motivoDoErro` traduz 403/404/413/429/timeout em uma frase que
      diz o que fazer; a tela mostra o motivo dentro do toast, por 8s.
      ⚠️ **Fallback silencioso é armadilha**: cair no caminho da imagem é aceitável;
      cair sem saber por quê, não. Vale para todo fallback novo.
      Timeout EXPLÍCITO de 180s na chamada de conversão — ela carrega imagens e espera o
      modelo ler a folha; sem timeout, um travamento de rede fica pendurado para sempre
      e a tela nunca sai de "Identificando os campos…".
- [x] **Rota `POST /api/documentos/templates/converter`** — multipart (`paginas[]` +
      campo `texto` + `nome`), gate `documentos.templates.criar` (é um modelo da clínica
      que vai nascer disto). **NÃO grava nada**: devolve a proposta, e quem cria o
      modelo é o `POST /templates` de sempre — é o que permite mostrar o resultado antes
      de comprometer o acervo, e o que faz a falha não deixar modelo pela metade.
      ⚠️ `/templates/converter` ANTES de `/templates/:id` (armadilha 1) e `tenantRls`
      REENTRA logo após o multer — as duas ordens do `/templates/upload`.
      ⚠️ MULTIMODAL não passa por `callAI` (que só aceita texto): vai por
      `gerarConteudo`, então o log de uso E o **gate de quota** são feitos à mão no
      serviço. Esquecer o gate deixaria este caminho inteiro fora do teto do plano.
      Teto de **4 páginas**, espelhado no front (`api.ts#MAX_PAGINAS_IA`) para não subir
      megabytes de imagem que ninguém vai ler.
- [x] **`upload.ts` partido em dois passos**: `paginasDoArquivo` (arquivo → imagens +
      texto embutido do PDF) e `blocosDeImagens` (o caminho reserva). Converter uma vez
      só serve aos DOIS caminhos e evita repetir a renderização, que é a parte cara.
      `arquivoParaBlocos` continua existindo como atalho do reserva.
      ⚠️ O texto do PDF viaja JUNTO das imagens, não no lugar delas: o texto dá a
      redação EXATA (nenhum OCR erra uma vírgula que já está lá) e a imagem dá a
      ESTRUTURA (o que é caixa, o que é tabela, onde está a linha de assinatura). Um
      sozinho perde metade do documento. PDF escaneado devolve texto vazio e a IA lê só
      as imagens — por isso a extração tem `catch` silencioso por página.
      Testes: 5 casos novos em `documentosCentral.test.js` (48 no arquivo), incluindo o
      elo que fecha a regra — a lacuna criada a partir de uma chave alucinada TEM de ser
      coletada por `coletarCampos` como campo do formulário. Suíte: **288 passando**;
      `tsc -b` + `vite build` limpos.
- [ ] **Os 12 modelos do CFMV repetem a identificação do animal no CORPO** (blocos
      `campoAuto` de nome, espécie, raça, pelagem…), e isso agora convive com as mesmas
      informações no cabeçalho. **Não é defeito**: a Res. 1.321/2020 exige a
      identificação DENTRO do documento, e o cabeçalho é identidade da folha, não
      conteúdo normativo. Se um dia incomodar, o lugar de decidir é o seed — não o
      cabeçalho, que é o que dá uniformidade a todos os outros documentos.
- [ ] No EDITOR sem paciente escolhido o cabeçalho mostra os EXEMPLOS do catálogo
      ("Thor", "Haras Boa Vista"), como o resto do preview já fazia — é o modo 2 de
      `resolverVariaveis`, e serve para o vet ver a CARA da folha. Nada disso alcança
      papel emitido: lá o contexto é sempre o snapshot.
- [ ] A conversão só produz blocos ESTÁTICOS (`texto`, `tabela`, `checklist`,
      `campoAuto`…). A tabela de medicamentos de um receituário vira `tabela` com
      lacunas, não o bloco `medicamentos` (que puxaria a prescrição do atendimento).
      Mapear os dois é possível — o vocabulário já existe —, mas exige decidir quando o
      documento deve puxar dado clínico sozinho, e isso não foi pedido.
- [ ] O modelo convertido nasce PUBLICADO e já fica selecionado na tela, pronto para
      emitir. Revisá-lo bloco a bloco é no editor, por `/documentos/modelos?templateId=`
      — que continua sem porta de entrada na interface (item conhecido de 30/08).

---

# Atualizado em: 2026-08-30 (🔴 REGRESSÃO CORRIGIDA + `/documentos` REMODELADA.
#   1. **AS AÇÕES VOLTARAM PARA UMA LINHA SÓ NO DESKTOP.** No módulo de Atendimento os
#      ícones de ação saíam EMPILHADOS, um por linha. Causa: `AcoesRegistro` era
#      `flex-wrap` também no `md:` — e com `flex-wrap` a largura MÍNIMA do contêiner é a
#      de UM ícone, então a `<table className="w-full">` espremia a coluna "Ações" até
#      isso (a Evolução tem 8 ações). Agora é `flex-wrap md:flex-nowrap`, no COMPONENTE
#      (uma correção, todas as telas). ⚠️ `whitespace-nowrap` no `<td>` NÃO resolve:
#      governa quebra de TEXTO, não de item flex. NÃO reintroduzir a quebra no desktop —
#      a justificativa antiga ("celular deitado passa de 768px") caducou quando o rótulo
#      passou a sumir no `md:`: de 768px para cima cada ação ocupa ~27px. Ver §6.
#   2. **`/documentos` DEIXOU DE SER O EDITOR DE BLOCOS e virou a tela de EMISSÃO**
#      (`pages/Documentos.tsx`, layout de `/agendamentos`): UMA LINHA com
#      *Paciente · Tipo de Documento · Nome do Documento*, o card do paciente (o MESMO
#      `AnimalCard` do Atendimento), os campos a preencher em LARGURA CHEIA (grid de até
#      3 colunas) e o rodapé **Cancelar · Inserir · Salvar**. Montar modelo é
#      configuração feita uma vez; EMITIR acontece a cada atendimento, e estava enterrado
#      atrás de abrir um card, entrar no editor e achar o botão "Gerar".
#      🔴 O EDITOR NÃO FOI REMOVIDO — mudou para **`/documentos/modelos`**
#      (`CentralDocumentos.tsx`, intacta), alcançável pelo botão "Modelos" do cabeçalho.
#      **INSERIR × SALVAR é o par de `SubModuloExames`** (a tela `/clinica/exames/:id`
#      que serviu de referência): Inserir guarda o documento preenchido numa fila LOCAL
#      (atestado + TCLE no mesmo atendimento é o caso comum), Salvar emite a fila
#      inteira. Nada da fila existe no banco antes do Salvar. ⚠️ A emissão é SEQUENCIAL,
#      nunca `Promise.all`: o `DOC-0001` é sequência POR EMPRESA sorteada dentro da
#      transaction, e em paralelo duas transações disputam o mesmo número. ⚠️ O Salvar
#      inclui o que está no FORMULÁRIO, sem exigir Inserir antes — o caso comum é um
#      documento só, e um Salvar que não salva nada é o pior tipo de botão; ao começar a
#      emitir, o formulário é MOVIDO para a fila (senão uma falha no meio devolveria o
#      mesmo documento à fila E à tela, e o Salvar seguinte o emitiria duas vezes).
#   3. **HISTÓRICO DE DOCUMENTOS com Visualizar · Imprimir · WhatsApp · E-mail**
#      (+ Cancelar com justificativa, §33). Fonte ÚNICA em `modules/documentos/Emitidos.tsx`
#      (`ListaDocumentosEmitidos`), reusada pelo **card "Documentos" da tela do paciente**
#      (`/animal/:id`) — duas listas divergiriam na primeira correção (armadilha 28-g).
#      O card responde a pergunta do balcão ("quais documentos este paciente tem, e me dá
#      uma via"), que o Histórico, sendo linha do tempo, não responde.
#      WhatsApp/E-mail saem por `CompartilharPdfBotoes`, e o DESTINO é o contato do
#      cliente GRAVADO NO SNAPSHOT (`contexto['cliente.telefone'|'cliente.email']`), não o
#      cadastro de hoje: é para quem o documento foi emitido.
#   4. **NOVO `utils/DocumentoPrint.ts`** — HTML do emitido para impressão e PDF. É o
#      espelho em string de `BlocoView.tsx` (o PDF do Puppeteer e a impressão por iframe
#      recebem STRING, não DOM montado): ao mexer no visual de um bloco, mexa nos dois.
#      NÃO resolve variável nenhuma — os blocos do emitido já vêm resolvidos; o que
#      sobrar de `{{` ou `[[` é APAGADO, porque chave crua no papel é pior que vazio.
#      ⚠️ Logo e assinatura passam por `carregarComoDataUri` (`useImagensDocumento`):
#      o Puppeteer BLOQUEIA requisição que não seja `data:`, então `<img src="/api/midia/…">`
#      imprime bem no navegador e nasce QUEBRADA no PDF do servidor.
#   5. **O TIMBRE VIROU PARTE DO SNAPSHOT** — `DocumentoEmitido.marca` (logo, assinatura,
#      nome e CRMV de quem assinou), gravado em `contexto._marca` (JSONB, SEM migration).
#      Reimprimir daqui a dois anos tem de sair com a logo e a assinatura DAQUELE dia;
#      buscar a marca de HOJE carimbaria no papel antigo a assinatura de quem estiver
#      logado agora. `null` nos emitidos ANTERIORES: saem sem logo e com a linha de
#      assinatura em branco — que é o correto, não um defeito.
#   6. Extraído `modules/documentos/CamposForm.tsx` (`CampoInput` + `tipoDoCampo`), fonte
#      única do campo a preencher, usada pela tela nova E pelo `ModalPreencher` do editor.
#   7. **O SELETOR DE DOCUMENTO MOSTRA O ACERVO INTEIRO E DEFINE O TIPO** — o campo
#      "Tipo de Documento" deixou de FILTRAR a lista (acertar a gaveta antes de achar o
#      papel) e virou campo de LEITURA, preenchido pelo documento escolhido. O seletor
#      de documento lista tudo, agrupado por `<optgroup>`.
#   8. 🔴 **CATEGORIA DEIXOU DE SER LISTA FECHADA** — o `Set` de 11 slugs do
#      `DocumentoTemplateController` (que DESCARTAVA em silêncio qualquer outro valor)
#      virou `CATEGORIAS_PADRAO` + `normalizarCategoria`. SEM MIGRATION: a coluna já é
#      `VARCHAR(30)` livre. ⚠️ **NÃO EXISTE TABELA DE CATEGORIAS** — a categoria é uma
#      coluna de texto do modelo, logo **existe enquanto houver um documento nela**, e
#      "criar categoria" É criar o primeiro documento dela (o modal diz isso). A tela
#      reúne as categorias varrendo os modelos (`categoriasDisponiveis`). Criar
#      documento/categoria é gateado por `documentos.templates.criar` e leva ao editor
#      por `/documentos/modelos?templateId=`.
#   9. Segundo seletor de paciente e `AnimalCard` REMOVIDOS da tela de emissão (o
#      paciente já é escolhido na linha de cima, e os dois empurravam o formulário para
#      baixo). O `<option>` mostra `Nome — Proprietário`, que cobre o desempate de xarás.
#  10. Os botões "Modelos", "Novo documento" e "Nova categoria" foram REMOVIDOS a pedido.
#      ⚠️ Consequência: `/documentos/modelos` (o editor) continua montada e funcional,
#      mas HOJE NÃO TEM PORTA DE ENTRADA na interface — o Sidebar aponta para
#      `/documentos`. Chega-se a ela pela URL. Para dar acesso, o lugar é o Sidebar.
#  11. 🔴 **DOCUMENTO ENVIADO PELA CLÍNICA.** "Nome do Documento" virou COMBOBOX com
#      digitação livre: nome que não existe no acervo oferece **Enviar "X"** → arquivo +
#      nome + categoria. **O que sobe é sempre IMAGEM — PDF é convertido no NAVEGADOR,
#      uma imagem por página** (`modules/documentos/upload.ts`, `pdfjs-dist` por
#      `import()` dinâmico). POR QUÊ: a folha percorre quatro caminhos (preview A4,
#      impressão, PDF do Puppeteer, snapshot) e PDF não se desenha em nenhum — cada um
#      precisaria de um desvio, e o documento enviado viraria cidadão de segunda classe.
#      Como imagem, ele segue as MESMAS regras, sem exceção em lugar nenhum.
#      Rota nova `POST /documentos/templates/upload` (gate `documentos.templates.criar`,
#      extensão E mimetype, 15 MB, `tenantRls` após o multer, `/upload` antes de `/:id`).
#      MULTI-TENANT/RLS: contexto de dono no `storage.upload` e `empresaId` do CONTEXTO
#      no `criar` — o documento é DA CLÍNICA (decisão de 30/08) e não vaza para outra.
#      ⚠️ `estilo.altura === 0` = altura AUTOMÁTICA no bloco `imagem` (a imagem É a
#      folha); `?? 160` não serve porque `0` não é nullish.
#      Suíte: 283 backend passando; `tsc -b` + `vite build` limpos.)
---

### Sessão 2026-08-30 — Ações numa linha só + `/documentos` remodelada para EMISSÃO

- [x] 🔴 **REGRESSÃO: as ações do Atendimento saíam UMA POR LINHA.** `AcoesRegistro`
      era `flex-wrap` também no desktop; com `flex-wrap` a largura MÍNIMA do contêiner
      flex é a de UM item, então a `<table className="w-full">` espremia a coluna
      "Ações" até isso e as 8 ações da Evolução empilhavam. Corrigido no COMPONENTE
      (`flex-wrap md:flex-nowrap`) — uma correção que vale para toda lista do sistema,
      em vez de largura fixa em cada `<td>`.
      ⚠️ `whitespace-nowrap` no `<td>` NÃO resolve: governa quebra de TEXTO, não de
      item flex. ⚠️ Não reintroduzir a quebra no desktop — ver §6 para a justificativa
      antiga e por que ela caducou.
- [x] **`/documentos` virou a tela de EMISSÃO** (`pages/Documentos.tsx`), no layout de
      `/agendamentos`: `PageContainer` + `BotaoVoltar` + cabeçalho com ícone + cards
      brancos `rounded-2xl`. Ordem da tela: (1) UMA LINHA com *Paciente · Tipo de
      Documento · Nome do Documento*; (2) o `AnimalCard` do paciente; (3) os campos a
      preencher em LARGURA CHEIA, com **Cancelar · Inserir · Salvar**; (4) o
      **Histórico de Documentos** do paciente.
      O `SeletorAnimalInteligente` continua abaixo da linha, e só aparece com mais de
      um paciente — é ele que desempata XARÁS pelo proprietário, que o `<select>`
      simples não faz.
      Campo multilinha ocupa a linha inteira do grid (`sm:col-span-2 lg:col-span-3`):
      uma área de observações espremida em 1/3 da largura não serve para escrever.
- [x] 🔴 **O EDITOR DE BLOCOS NÃO FOI REMOVIDO — mudou para `/documentos/modelos`**
      (`CentralDocumentos.tsx`, sem alteração), com o botão "Modelos" no cabeçalho da
      tela nova, gateado por `documentos.templates.editar`. Montar modelo é
      CONFIGURAÇÃO, feita uma vez; emitir acontece a cada atendimento — e estava
      enterrado atrás de abrir um card, entrar no editor e achar o "Gerar".
- [x] **Inserir × Salvar**, o par de `SubModuloExames`: Inserir guarda o documento
      preenchido numa fila LOCAL (atestado + TCLE no mesmo atendimento é o caso comum),
      Salvar emite a fila inteira. Nada da fila existe no banco antes do Salvar.
      ⚠️ **Emissão SEQUENCIAL, nunca `Promise.all`**: `DOC-0001` é sequência POR
      EMPRESA sorteada dentro da transaction — em paralelo, duas transações disputam o
      mesmo número.
      ⚠️ **O Salvar inclui o formulário atual**, sem exigir Inserir antes: o caso comum
      é UM documento, e um Salvar que não salva nada é o pior tipo de botão. Ao começar
      a emitir, o formulário é MOVIDO para a fila — sem isso, uma falha no meio o
      devolveria à fila E o deixaria selecionado na tela, e o Salvar seguinte o
      emitiria duas vezes.
      ⚠️ Falha parcial diz QUANTOS já saíram e mantém na fila só os que faltam: o que
      já foi emitido TEM número e reemitir duplicaria o documento.
- [x] **Histórico com Visualizar · Imprimir · WhatsApp · E-mail** (+ Cancelar com
      justificativa, §33 — a via errada precisa ser revogável, e a rota já existia).
      FONTE ÚNICA em `modules/documentos/Emitidos.tsx` (`ListaDocumentosEmitidos`,
      `VisualizarDocumentoModal`, `AcoesDocumento`), reusada pelo **card "Documentos"
      da tela do paciente** — duas listas divergiriam na primeira correção (28-g).
      A prop `compacto` existe para a coluna estreita; para variar a forma, prop —
      nunca uma segunda lista.
      ⚠️ O destino do envio é o contato do cliente GRAVADO NO SNAPSHOT
      (`contexto['cliente.telefone']` / `['cliente.email']`), não o cadastro de hoje: é
      para quem o documento foi emitido.
      ⚠️ `VisualizarDocumentoModal` só recebe `contexto`/`preenchimento` na
      PRÉ-VISUALIZAÇÃO (blocos ainda do MODELO, com `{{}}`/`[[]]` crus). No emitido
      fica ausente de propósito: aplicar o contexto de hoje reabriria a porta para o
      papel antigo mudar sozinho.
- [x] **Card "Documentos" em `/animal/:id`.** O documento já aparecia no Histórico como
      EVENTO ("foi emitido tal dia"); o card responde outra pergunta, a do balcão —
      "quais documentos este paciente tem, e me dá uma via" —, por isso ele traz
      reimpressão e envio, que a linha do tempo não tem. "Emitir documento" leva a
      `/documentos?animalId=<id>`.
      ⚠️ A query é lida por `useSearchParams` (o ROUTER), nunca por
      `window.location.search`: o app usa `HashRouter` e a query mora no FRAGMENTO —
      `location.search` é sempre vazio (§14).
      ⚠️ A carga tem `catch` que só esvazia a lista: tabela não migrada ou 403 não pode
      derrubar a tela do paciente.
- [x] **Novo `utils/DocumentoPrint.ts`** — `gerarHtmlDocumento` / `imprimirDocumento` /
      `nomeArquivoDocumento`. Espelho em STRING de `BlocoView.tsx` (o PDF do Puppeteer e
      a impressão por iframe recebem string, não DOM montado): **ao mexer no visual de
      um bloco, mexa nos dois.** Não resolve variável — os blocos do emitido já vêm
      resolvidos; o que sobrar de `{{`/`[[` é APAGADO, porque chave crua no papel é pior
      que vazio. `qrcode` e `linhaTempo` não imprimem nada: são placeholders gráficos do
      editor, e um QR decorativo finge ser código verificável.
      ⚠️ Logo e assinatura passam por `carregarComoDataUri` (hook `useImagensDocumento`,
      que resolve as URLs DISTINTAS da lista de uma vez): o Puppeteer BLOQUEIA
      requisição que não seja `data:` — `<img src="/api/midia/…">` imprime bem no
      navegador e nasce QUEBRADA no PDF do servidor.
- [x] 🔴 **O TIMBRE VIROU PARTE DO SNAPSHOT** — `DocumentoEmitido.marca` (logo da
      clínica, imagem da assinatura, nome e CRMV de quem assinou), gravado em
      `contexto._marca`. **SEM MIGRATION**: `contexto` já é JSONB. Reimprimir daqui a
      dois anos tem de sair com a logo e a assinatura DAQUELE dia — buscar a marca de
      hoje carimbaria no papel antigo a assinatura de quem estiver logado agora.
      `null` nos emitidos ANTERIORES: saem sem logo e com a linha de assinatura em
      branco, que é o correto e não um defeito a "consertar" com a marca atual.
- [x] Extraído `modules/documentos/CamposForm.tsx` (`CampoInput`, `tipoDoCampo`,
      `AJUDA_ORIGEM`) — fonte única do campo a preencher, usada pela tela nova E pelo
      `ModalPreencher` do editor. Sem isso seriam dois inputs iguais, e a primeira
      correção de tipo (`date` × `time`) valeria para um só.
      Suíte: 278 backend passando; `tsc -b` + `vite build` limpos.
- [x] **O SELETOR DE DOCUMENTO MOSTRA O ACERVO INTEIRO, e é ele que define o TIPO**
      (pedido de 2026-08-30). Antes o "Tipo de Documento" FILTRAVA a lista, o que
      obrigava a acertar a gaveta antes de achar o papel — e quem procura "atestado de
      vacinação" sabe o nome do documento, não em qual das 11 categorias ele foi
      arquivado. Agora: **Nome do Documento** vem primeiro e lista TODOS os modelos,
      agrupados por `<optgroup>` (o agrupamento preserva a organização que o filtro
      dava, sem esconder nada); escolher o documento PREENCHE o **Tipo**, que virou
      campo de LEITURA.
      ⚠️ O Tipo não é editável ali de propósito: mudá-lo reclassificaria o MODELO da
      clínica, e isso é edição de modelo — mora em `/documentos/modelos`.
- [x] 🔴 **CATEGORIA DEIXOU DE SER LISTA FECHADA — a clínica cria as suas.** O
      `CATEGORIAS` do `DocumentoTemplateController` era um `Set` de 11 slugs que
      DESCARTAVA em silêncio qualquer outro valor; virou `CATEGORIAS_PADRAO` +
      `normalizarCategoria(valor)`, que aceita texto livre.
      **SEM MIGRATION**: `tb_documento_templates.categoria` já é `VARCHAR(30)` livre.
      ⚠️ **NÃO EXISTE TABELA DE CATEGORIAS**, e por isso **a categoria existe enquanto
      houver um documento nela**: ela é uma coluna de texto do próprio modelo. A tela
      reúne as categorias varrendo os modelos (`categoriasDisponiveis`, em
      `catalogo.ts`) — padrão + as em uso. Consequência aceita: "criar categoria" É
      criar o primeiro documento dela, e o modal diz isso em vez de fingir que são duas
      coisas. Categoria vazia não teria onde ser gravada e sumiria no refresh.
      ⚠️ `normalizarCategoria` colapsa espaços ("Exames   de  compra" e "Exames de
      compra" são a MESMA gaveta, senão viram duas idênticas na tela), corta em 30
      (a coluna recusaria e daria 500 numa digitação longa) e devolve a PADRÃO no slug
      canônico minúsculo — "Laudos" digitado à mão tem de cair em `laudos`, não criar
      uma gaveta paralela. String vazia devolve `null` e **não apaga** a categoria que
      o modelo já tem.
      ⚠️ No front, `CategoriaId` virou `CategoriaPadrao | (string & {})` — o `& {}`
      preserva o autocomplete das padrão; com `string` puro o editor pararia de sugerir
      'laudos' e amigas. `rotuloCategoria` devolve o próprio valor quando não é padrão,
      porque a criada pela clínica é gravada já com o nome que ela digitou.
      Testes: 5 casos novos em `documentosCentral.test.js` (43 no arquivo, 283 na
      suíte) — afrouxar validação pede teste, e o que eles travam é que "livre" não
      vire "qualquer coisa".
- [x] **Criar documento / categoria na própria tela de emissão**, gateado por
      `documentos.templates.criar`. O que nasce ali é o CADASTRO (nome + tipo); o
      CONTEÚDO é montado no editor, para onde a tela navega com
      **`/documentos/modelos?templateId=<id>`** — sem esse parâmetro a pessoa cairia no
      editor e teria de procurar na biblioteca o modelo que acabou de criar.
      ⚠️ O modelo nasce com os blocos de **título e assinatura**, nunca com zero:
      documento vazio é recusado na emissão (`SEM_BLOCOS`), então ele apareceria no
      seletor e falharia só no Salvar.
      ⚠️ O efeito do `?templateId=` depende da CONTAGEM de modelos, não do array:
      `bib.templates` é objeto novo a cada recarga da biblioteca, e o efeito reimporia
      o id da URL a cada uma — puxando o vet de volta àquele modelo toda vez que ele
      abrisse outro.
- [x] **Segundo seletor de paciente e card do animal REMOVIDOS da tela** (pedido de
      2026-08-30). O paciente já é escolhido no campo da linha superior, e os dois
      empurravam o formulário para baixo — que é o que a tela veio resolver. O
      desempate de XARÁS que o `SeletorAnimalInteligente` fazia segue coberto: o
      `<option>` mostra `Nome — Proprietário`. ⚠️ Não reintroduzir; o dado clínico do
      paciente tem casa própria em `/animal/:id`.
- [x] 🔴 **DOCUMENTO ENVIADO PELA CLÍNICA — "não achei" virou "cadastre agora".** O
      campo **Nome do Documento** deixou de ser `<select>` e virou COMBOBOX com
      digitação livre; nome que não existe no acervo oferece **Enviar “X”**, que abre o
      diálogo de arquivo + nome + categoria. Gate: `documentos.templates.criar` (é um
      MODELO da clínica que nasce ali, não uma emissão) — sem a permissão, o combo diz
      "nenhum documento com esse nome" e não oferece botão que iria 403 (28-d).
      ⚠️ Enquanto o texto for o NOME do já selecionado ele NÃO conta como busca: sem
      isso, reabrir o combo depois de escolher mostraria "nenhum documento com esse
      nome" para o PRÓPRIO item escolhido, e ofereceria enviá-lo de novo — a armadilha
      do combo de animal da Agenda (§12, 2026-08-04).
      ⚠️ O combo abre por `onClick` ALÉM de `onFocus`, e a opção é escolhida em
      `onMouseDown` com `preventDefault`: o foco nunca sai do input, e `focus` não
      dispara de novo num campo já focado — só com `onFocus` a lista não reabriria
      depois da primeira escolha.
- [x] 🔴 **O QUE SOBE É SEMPRE IMAGEM — PDF é convertido no NAVEGADOR, uma imagem por
      página** (`modules/documentos/upload.ts`). POR QUÊ, já que guardar o PDF cru seria
      mais simples: a folha percorre QUATRO caminhos — preview A4 (`BlocoView`),
      impressão por iframe, PDF do Puppeteer para WhatsApp/e-mail (`DocumentoPrint`) e o
      snapshot do emitido. PDF não se desenha em nenhum deles: cada um precisaria de um
      desvio próprio (pdf.js no preview, abrir noutra aba na impressão, mandar o arquivo
      em vez do HTML no envio) e o documento enviado viraria cidadão de segunda classe —
      o oposto de "seguir as mesmas regras de todos os documentos". Convertido em
      imagem, ele É um documento como qualquer outro, **sem uma linha de exceção em
      nenhum dos quatro caminhos**.
      Dependência nova: `pdfjs-dist`, por `import()` DINÂMICO (como `jspdf`/`html2canvas`
      já são em `CentralDocumentos.exportarPdf`) — o bundle principal cresceu ~9 kB; o
      pdf.js (483 kB) e o worker (1,2 MB) só descem para quem envia um PDF.
      ⚠️ O worker precisa de `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url)` — é a forma que o Vite entende para empacotá-lo; sem isso o
      pdf.js busca um caminho que não existe no build e falha SÓ em produção.
      ⚠️ Canvas pintado de BRANCO antes de desenhar, nos dois caminhos: JPEG não tem
      alfa, e PDF/PNG transparente sai com o fundo PRETO no papel.
      ⚠️ `destroy()` é da TAREFA de carregamento (`getDocument(...)`), não do documento.
- [x] **`estilo.altura === 0` = ALTURA AUTOMÁTICA no bloco `imagem`** — convenção do
      documento enviado, em que a imagem É a folha. O padrão de 160px é pensado para
      uma foto de exame no meio do texto e entregaria uma TIRA do documento.
      ⚠️ `?? 160` não serve: `0` não é nullish e viraria `height: 0`. Usar `|| 'auto'`.
      Aplicado nos DOIS renderizadores (`BlocoView` e `DocumentoPrint`), que são
      espelhos um do outro.
- [x] **Rota nova `POST /api/documentos/templates/upload`** (multipart, campo
      `arquivo`), gate `documentos.templates.criar`. Aceita só imagem, validando
      **extensão E mimetype** (validar só o mimetype aceita um `.svg` renomeado, e SVG é
      HTML executável — o XSS armazenado da varredura de 2026-06-11). Teto de 15 MB,
      barrado também no cliente para não subir e receber 413.
      **MULTI-TENANT/RLS**: o `storage.upload` leva o contexto de dono (§8) —
      `empresaId` do CONTEXTO (nunca do corpo) e o autor. É ele que faz
      `GET /api/midia/:chave` recusar o byte para outra clínica. O modelo é criado por
      `POST /documentos/templates`, que carimba `req.empresaId` e ignora o corpo.
      ⚠️ **`/templates/upload` ANTES de `/templates/:id`** (armadilha 1) e **`tenantRls`
      REENTRA logo após o multer**: o parsing do busboy se intercala entre o
      `authenticate` (que carimba o tenant) e o controller, e pode fazer o
      `AsyncLocalStorage` não sobreviver até lá — mesma ordem de `routes/animais.js`.
      ⚠️ O teste `documentosCentral` passou a precisar de `jest.mock('../storage')`: o
      controller agora importa `storage/index.ts`, que o babel-jest não transpila (mesmo
      motivo dos mocks de `lib/prisma` e `ai`).
- [x] **Depois de enviado, ele é um documento como os outros**: nasce `PUBLICADO` (o
      conteúdo é o arquivo, não há nada a montar depois), entra no seletor, já fica
      SELECIONADO na tela (o passo seguinte é emitir), e daí em diante passa por
      emissão numerada, snapshot, histórico, card do paciente, impressão e envio sem
      nenhum caminho especial.
      ⚠️ **Visibilidade decidida em 2026-08-30: o documento é DA CLÍNICA**, protegido
      pelo RLS (não vaza para outra empresa) e visível a toda a equipe — foi a opção
      escolhida entre "visível só para o autor" (que exigiria coluna nova) e esta. Se um
      dia virar "só do autor", o gancho é `autorId`, já gravado.
- [ ] O PDF convertido vira N imagens SEQUENCIAIS; a impressão flui as páginas em vez
      de forçar uma quebra por página. Uma imagem A4 inteira já ocupa quase a folha, mas
      documento com margem estreita pode escorregar para a página seguinte. Se
      incomodar, o caminho é um `page-break-after` no bloco `imagem` de altura
      automática — não em todo bloco `imagem`, que quebraria a foto no meio do laudo.
- [ ] O botão "Pré-visualizar" exige `contexto` carregado (paciente selecionado). Sem
      paciente não há o que pré-visualizar de verdade — a folha sairia com os exemplos
      do catálogo, que é justamente o que a §12 de 26/08 proíbe mostrar como se fosse
      dado do paciente.
- [ ] O histórico da tela lista SÓ o paciente selecionado (`?animalId=`). Uma visão por
      empresa (todos os documentos do mês) usaria o mesmo `GET /documentos/emitidos` sem
      o filtro — falta decidir o recorte e a paginação.
- [ ] `POST /documentos/{whatsapp,email}` continua recebendo o HTML montado na tela.
      Agora que `DocumentoPrint` gera esse HTML a partir do emitido, ligar o envio ao
      `DocumentoEmitido` pelo id (em vez de mandar o HTML do cliente) é o próximo passo.

---

# Atualizado em: 2026-08-26 (CENTRAL DE DOCUMENTOS DEIXOU DE SER PROTÓTIPO. A tela
#   `/documentos` guardava tudo em `localStorage` (`s2vet_docs_templates`), com
#   templates SEMEADOS NO BUNDLE, variáveis resolvidas pelo campo `exemplo` do catálogo
#   ({{animal.nome}} virava sempre "Thor") e emissão gravando `animalNome: 'Thor'`
#   cravado no código. Nada sobrevivia a trocar de navegador e nada era multi-tenant.
#   ✅ MIGRATION APLICADA (autorizada nesta sessão) — `20260918000000_central_documentos`:
#   `tb_documento_templates` (CATÁLOGO MISTO, `empresa_id` NULÁVEL),
#   `tb_documentos_emitidos` (TENANT DIRETO) e `tb_usuario_empresa.assinatura_url`,
#   com as duas policies de RLS. `prisma generate` refeito (exigiu PARAR o backend —
#   o `ts-node-dev` segurava o `query_engine-windows.dll`, §11) e `node backend/seed.js`
#   rodado: 12 modelos globais criados. RLS conferido AO VIVO contra a base: a clínica
#   LÊ os 12 globais, ESCREVE o próprio modelo, e é RECUSADA ao tentar criar linha
#   global ou alterar o atestado do CFMV; empresa 58 não enxerga modelo da 42; e
#   `tb_documentos_emitidos` recusa gravar com `empresa_id` de outra empresa.
#   **OS 12 ANEXOS DA RES. CFMV Nº 1.321/2020 VIRARAM O CATÁLOGO GLOBAL** — atestado
#   sanitário, atestado de óbito, atestado de vacinação, os 8 TCLEs e o termo de
#   retirada sem alta. Transcritos dos PDFs oficiais de `docs/modelos-documentos/`
#   (`seeds/006_documentos_cfmv.seed.js`, idempotente por `chave`); a linha pontilhada
#   do papel virou `{{variável}}` onde o S2Vet TEM o dado, e continua linha pontilhada
#   onde não tem (tatuagem e brinco não existem no cadastro — nunca virar variável de
#   outra coisa).
#   🔴 **COPY-ON-WRITE É A REGRA DA TABELA DE TEMPLATES.** `empresa_id` nulo = modelo
#   GLOBAL, que toda clínica LÊ e nenhuma ESCREVE (policy `USING` global+próprio,
#   `WITH CHECK` só o próprio — a MESMA assimetria de `tb_medicamentos`). Salvar ou
#   favoritar um global NÃO altera o global: `garantirCopiaDaEmpresa` cria a cópia da
#   clínica (com `origem_id`) e a alteração vai para ela; a resposta traz `copiado:
#   true` e o front ADOTA o id devolvido — sem isso o salvar seguinte criaria outra
#   cópia. Excluir global responde 400 `MODELO_DO_SISTEMA` (é catálogo normativo
#   compartilhado). ⚠️ Por isso NÃO HÁ AUTOSAVE em modelo global: um autosave ali
#   criaria uma cópia da clínica a cada pausa de digitação.
#   **SELETOR DE PACIENTE + PREENCHIMENTO AUTOMÁTICO.** A tela usa o MESMO par da tela
#   de Atendimento — `SeletorAnimalInteligente` + `AnimalCard` (pedido explícito: "use
#   o mesmo card que está sendo usado na tela de atendimento"); card próprio faria o
#   vet reaprender onde ficam baia/local/proprietário a cada tela. Escolhido o animal,
#   `GET /documentos/contexto/:animalId` devolve as variáveis JÁ RESOLVIDAS
#   (`lib/documentoVariaveis.js`) + a MARCA (logo da clínica, assinatura, CRMV, nome de
#   quem assina), e o preview troca os exemplos do catálogo pelo dado real.
#   🔴 **NADA DE INVENTAR VALOR: variável sem dado sai VAZIA**, nunca com o exemplo do
#   catálogo — um atestado dizendo "Pelagem: Castanho" porque o cadastro está em branco
#   é documento falso, e nada no sistema acusaria. `resolverVariaveis(texto, contexto?)`
#   (front) tem DOIS modos por isso: com contexto = valor real ou vazio; sem contexto
#   (montando o modelo, sem paciente) = o exemplo, só para o vet ver a cara da folha.
#   🔴 **QUEM RESOLVE O QUE FICA GRAVADO É O BACKEND, NUNCA O NAVEGADOR** — o documento
#   tem valor legal e confiar no cliente para dizer qual é o CRMV de quem assina seria
#   entregar a caneta. `aplicarEmBlocos` cobre TODO campo textual: `texto`, `rotulo`,
#   `url`, `itens[]`, `colunas[]` e as CÉLULAS de `linhas[][]` — resolver só
#   `conteudo.texto` deixaria `{{animal.nome}}` cru dentro da tabela impressa.
#   `campoAuto` grava o valor em `texto` e PRESERVA a chave em `variavel`, que é o que
#   permite auditar depois de qual variável saiu cada valor do papel.
#   **O EMITIDO É SNAPSHOT** (`tb_documentos_emitidos.blocos`): editar o modelo depois
#   não reescreve o papel que o cliente já recebeu. Numeração `DOC-0001` por EMPRESA,
#   sorteada dentro da transaction (é só ali que `{{sistema.numeroDocumento}}` resolve).
#   **CORRELAÇÃO COM O PRONTUÁRIO**: o documento emitido entra no Histórico do paciente
#   (`HistoricoController`, origem `DOCUMENTO`, ref `documento-<id>`) e na MEMÓRIA
#   CLÍNICA (`resumoAtendimentoService.coletarEventos`) — o tópico da IA fica clicável
#   até o registro, e `AnimalDetail` ganhou badge, ícone, endpoint e o
#   `DetalheModalDocumento`. ⚠️ O recorte é por EMPRESA e não por
#   `escopoFilhoEvolucaoWhere`: `DocumentoEmitido` tem `empresaId` próprio e a evolução
#   é OPCIONAL nele (atestado e TCLE existem sem atendimento aberto).
#   **CHAT DE IA MULTI-TURNO, ANCORADO NO ACERVO** (`assistente_documento@v1` +
#   `services/documentoLLMService.js`, módulo `MODULOS_IA.DOCUMENTOS`). Decisão de
#   produto: "multi-turno, mas baseado SOMENTE nos templates que temos e forem sendo
#   criados" — o assistente escolhe um modelo do acervo (globais + os da clínica) ou
#   AJUSTA o que está aberto; NÃO redige documento do zero, porque o conteúdo mínimo é
#   definido por norma e um modelo inventado sai plausível e incompleto. A resposta é
#   VALIDADA contra o acervo: `templateId` fora da lista enviada é descartado (id
#   alucinado viraria consulta que o RLS recusa) e bloco de tipo desconhecido é jogado
#   fora (não convertido em `texto` — isso mentiria sobre o que foi proposto). Substitui
#   o `ModalCriarIA`, que não chamava modelo nenhum: era `montarPorHeuristica`, uma
#   tabela de palavras-chave rodando no bundle.
#   **ASSINATURA DO VETERINÁRIO** — `UsuarioEmpresa.assinatura_url`, POR EMPRESA (mesma
#   razão de `foto_url`), enviada pelo PRÓPRIO profissional em `/cadastro-pessoal` (`PUT/
#   DELETE /users/me/assinatura`, multipart, espelho de `/me/foto`). O bloco `assinatura`
#   renderiza a imagem SOBRE a linha, com nome e CRMV do vínculo. Sem assinatura
#   cadastrada sobra o espaço em branco — nunca se desenha uma assinatura que não existe.
#   ⚠️ NÃO passa pelo `FotoEditorModal`: aquele editor recorta em QUADRADO e cortaria o
#   traço.
#   Removidos: `modules/documentos/seeds.ts` (TEMPLATES_INICIAIS, órfão) e o
#   `ModalCriarIA`. Testes: `__tests__/documentosCentral.test.js` (23 casos). Suíte: 235.
#   As duas tabelas já entraram em `TENANT_PLANE` (`__tests__/tenancyRls.test.js`) —
#   tenant plane em 15/76 tabelas. Suíte: 235.)
#   paciente pode ter várias evoluções EM ANDAMENTO (consultas distintas, 2026-08-18
#   parte 3) e o shell ADIVINHAVA qual era a de agora; errada a adivinhação,
#   prescrição/exame/encaminhamento/vacina iam para o atendimento errado e nada na
#   tela explicava por quê. Agora QUEM TROCA É O Nº no card "Histórico de Evolução
#   Clínica": em evolução EM ANDAMENTO o AG-0013/EV-0007 vira BOTÃO
#   (`NumeroAtendimento`, um componente para mobile e desktop) que carrega aquele
#   atendimento na tela. ⚠️ O BANNER CONTINUA SENDO UM SÓ — a versão em lista, com uma
#   faixa por atendimento aberto, foi RECUSADA a pedido ("não quero as duas visíveis ao
#   mesmo tempo"); não reintroduzir. Rótulo novo do banner: "Atendimento AG-0013 de
#   25/08/2026 17:11 - Consulta clínica geral - Em andamento" (⚠️ `titulo` só nasce na
#   FINALIZAÇÃO, via IA — durante o atendimento o rótulo cai na `especialidade`).
#   NOVO `utils/evolucaoAtiva.ts`, fonte ÚNICA da regra que estava copiada em 3 telas:
#   escolha explícita → a minha do `agendamentoId` do contexto → a primeira minha → a
#   primeira de qualquer um. `evolucaoAtiva` deixou de ser estado e virou DERIVAÇÃO.
#   Contrato do `SubModuloEvolucao` mudou: `onEvolucaoChange` (mandava a JÁ ESCOLHIDA)
#   saiu; entram `onEvolucoesAbertasChange` (a LISTA), `onEvolucaoCriada`,
#   `evolucaoAtivaId` e `onSelecionarEvolucao`. ⚠️ A lista da aba é FILTRADA/PAGINADA e
#   só é reportada quando nenhum filtro pode esconder um atendimento aberto — ver §12.
#   Escolha persistida em `s2vet_ev_sel_<animalId>`, lida também por `Vacina.tsx`;
#   `?agendamentoId=` na URL a limpa. Sem backend.)
---

### Sessão 2026-08-26 — Central de Documentos: de protótipo a módulo
> ✅ **MIGRATION APLICADA** (autorizada nesta sessão) —
> `prisma/migrations/20260918000000_central_documentos/`. Criou
> `tb_documento_templates`, `tb_documentos_emitidos` e a coluna
> `tb_usuario_empresa.assinatura_url`, com as duas policies de RLS (`ENABLE` + `FORCE`
> conferidos no `pg_class`). `npx prisma generate` refeito e `node backend/seed.js`
> rodado — **12 modelos globais criados**. Sem backfill: nenhuma outra linha existia.
>
> ⚠️ O `generate` exigiu **PARAR o backend**: o `ts-node-dev --respawn` segurava o
> `query_engine-windows.dll` e o comando morria com `EPERM` (§11). Ao contrário da
> migration `20260914000000` (que só mudava um `VarChar` e dispensava o generate), aqui
> ele é OBRIGATÓRIO — os controllers usam `prisma.documentoTemplate` /
> `prisma.documentoEmitido`, models que o client antigo não conhece. Matar só o PID
> filho não basta: o `--respawn` o levanta de novo e relocka o arquivo.

- [x] **O módulo era 100% front.** `store.ts` guardava templates em
      `localStorage` (`s2vet_docs_templates`), o acervo vinha de `seeds.ts` compilado no
      bundle, `resolverVariaveis` trocava a chave pelo campo `exemplo` do catálogo
      (`{{animal.nome}}` → sempre "Thor") e `emitir()` gravava
      `animalNome: 'Thor', clienteNome: 'Haras Boa Vista'` no código. Servia para
      demonstrar a tela; não emitia documento nenhum. Agora tudo passa por `./api` →
      rotas sob RLS.
- [x] **`tb_documento_templates` é CATÁLOGO MISTO e o COPY-ON-WRITE é a regra.**
      `empresa_id` NULO = modelo GLOBAL do sistema; preenchido = modelo da clínica.
      Policy igual à de `tb_medicamentos`: `USING` lê global+próprio, `WITH CHECK` só
      escreve o próprio.
      Salvar/favoritar um GLOBAL **não altera o global** — `garantirCopiaDaEmpresa`
      cria a cópia da clínica (`origem_id` aponta para a origem) e a alteração vai para
      ela. A resposta traz `copiado: true`, e **o front ADOTA o id devolvido**: sem
      isso o salvar seguinte criaria outra cópia e a tela ficaria editando um registro
      que não é o que está sendo gravado.
      Excluir global → 400 `MODELO_DO_SISTEMA` (catálogo normativo, compartilhado); no
      card a opção Excluir nem é renderizada (armadilha 28-d), e o lápis diz
      "Personalizar" em vez de "Editar".
      ⚠️ **NÃO HÁ AUTOSAVE em modelo global** (`aoAutosave` sai cedo em `ativo.global`):
      um autosave ali criaria uma cópia da clínica a cada pausa de digitação, sem
      ninguém ter pedido. Em modelo próprio o autosave continua (é o que protege o
      trabalho do vet).
      Selo **CFMV** no card, para o vet saber ANTES de clicar que ali é só leitura.
- [x] **Os 12 anexos da Res. CFMV nº 1.321/2020 viraram o catálogo global** —
      `seeds/006_documentos_cfmv.seed.js`, transcritos dos PDFs oficiais em
      `docs/modelos-documentos/cfmv-res-1321/` (baixados em 2026-08-26 do CRMV-RJ):
      atestado sanitário, atestado de óbito, atestado de vacinação, os 8 TCLEs
      (exames, procedimento de risco, retirada do corpo, cirurgia, internação,
      anestesia, eutanásia, doação do corpo) e o termo de retirada sem alta médica.
      O texto das declarações é VERBATIM da norma; o que mudou é a FORMA — a linha
      pontilhada virou `{{variável}}` **onde o S2Vet tem o dado**, e continua linha
      pontilhada onde não tem. ⚠️ Tatuagem e Brinco não existem no cadastro (o equino
      se identifica por resenha, chip e passaporte): ficam em branco. **Nunca**
      transformá-los em variável "parecida" — escrever a pelagem no lugar do brinco
      produz documento errado com cara de documento certo.
      O seed é montado por um construtor comum (`montarBlocos`), não 12 arrays à mão:
      é o que garante que o bloco de identificação do animal seja IDÊNTICO nos 12, como
      a norma repete. **Atestado é assinado pelo VETERINÁRIO; TCLE, pelo RESPONSÁVEL**
      — inverter descaracteriza o documento. Só o TCLE tem campo de observação DO
      RESPONSÁVEL.
      Espécie = `AMBOS` nos 12: a norma é geral, e marcar EQUINO esconderia o atestado
      sanitário da clínica de bovinos.
      ⚠️ O upsert por `chave` **sobrescreve** o modelo global — é assim que uma revisão
      de norma chega às clínicas. A cópia personalizada de cada empresa não é tocada.
      ⚠️ O resto de `docs/modelos-documentos/` (AIE, mormo, GTA, resenha, brucelose)
      NÃO virou template: são manuais/guias e formulários ESTADUAIS, que variam por UF
      — o README daquela pasta avisa. Ficam como referência.
- [x] **Seletor de paciente + preenchimento automático.** A tela usa o **MESMO par da
      tela de Atendimento**: `SeletorAnimalInteligente` + `AnimalCard`, na mesma ordem
      e sem invólucro próprio (pedido explícito: "use o mesmo card que está sendo usado
      na tela de atendimento"). Card próprio faria o vet reaprender onde ficam baia,
      local e proprietário a cada tela, e as duas versões divergiriam na primeira
      correção — a lição do `SubModuloMinhaAgenda` (28-g).
      Escolhido o animal, `GET /documentos/contexto/:animalId` devolve as variáveis JÁ
      RESOLVIDAS + a MARCA (logo da clínica, assinatura, CRMV, nome de quem assina), e
      `BlocoView`/`PreviewA4` trocam os exemplos do catálogo pelo dado real.
      ⚠️ O fetch da lista espera `empresaLoading` terminar — nenhuma chamada escopada
      por empresa antes de o contexto estar resolvido (armadilha de 2026-07-28).
- [x] 🔴 **`lib/documentoVariaveis.js` — NADA DE INVENTAR VALOR.** Variável sem dado
      devolve string VAZIA. Um atestado dizendo "Pelagem: Castanho" porque o cadastro
      estava em branco é documento falso, e nada no sistema acusaria.
      `resolverVariaveis(texto, contexto?)` (front) tem DOIS modos por isso: **com**
      contexto = valor real ou vazio; **sem** contexto (montando o modelo, sem
      paciente) = o `exemplo` do catálogo, só para o vet ver a cara da folha.
      Internação, reprodução e financeiro não têm módulo no S2Vet: as variáveis existem
      no editor mas resolvem VAZIO, e **não são oferecidas ao chat da IA** — prometer
      uma chave que não preenche faz a IA usá-la e o papel sair com um buraco.
      ⚠️ Cadastro do CLIENTE por `aplicarPerfil` (`ProprietarioPerfil` da empresa do
      contexto, §36) e do PROFISSIONAL por `UsuarioEmpresa` (§36-f) — nunca de `users`.
      ⚠️ `LocalizacaoAnimal` **não tem cidade/estado** (só `endereco` e `cep`): o
      município da propriedade sai do cadastro do cliente.
- [x] 🔴 **Quem resolve o que fica GRAVADO é o backend, nunca o navegador.** O
      documento tem valor legal; confiar no cliente para dizer qual é o CRMV de quem
      assina seria entregar a caneta. O front resolve só para EXIBIR.
      `aplicarEmBlocos` cobre TODO campo textual — `texto`, `rotulo`, `url`, `itens[]`,
      `colunas[]` e as **CÉLULAS** de `linhas[][]`: resolver só `conteudo.texto`
      deixaria `{{animal.nome}}` cru dentro da tabela impressa.
      `campoAuto` grava o valor em `texto` e **PRESERVA a chave** em `variavel` — é o
      que permite auditar, no documento já emitido, de qual variável saiu cada valor.
- [x] **O EMITIDO É SNAPSHOT** (`tb_documentos_emitidos.blocos`, com as variáveis já
      resolvidas). Editar o modelo depois NÃO reescreve o papel que o cliente já
      recebeu — mesma premissa da `FaturaItem.descricao` gravada. Numeração `DOC-0001`
      **por empresa**, sorteada dentro da transaction: é só ali que
      `{{sistema.numeroDocumento}}` tem valor, e por isso ela não entra em
      `montarContexto` (que também serve à pré-visualização, onde o documento ainda não
      tem número). Cancelar exige justificativa + auditoria (§33) e é soft delete.
- [x] **Correlação com o prontuário.** O documento emitido entra no **Histórico do
      paciente** (`HistoricoController`, origem `DOCUMENTO`, ref `documento-<id>`) e na
      **Memória Clínica** (`resumoAtendimentoService.coletarEventos`) — o tópico da IA
      fica clicável até o registro, porque `refsAbriveis` (AnimalDetail) sai justamente
      dos ids do Histórico. `AnimalDetail` ganhou `OrigemEvento` `DOCUMENTO`, badge,
      ícone, `ENDPOINT` e o `DetalheModalDocumento`; `MemoriaClinicaPanel` ganhou o
      rótulo.
      ⚠️ O recorte é por **EMPRESA**, não por `escopoFilhoEvolucaoWhere`:
      `DocumentoEmitido` tem `empresaId` próprio e a evolução é OPCIONAL nele —
      atestado e termo de consentimento existem sem atendimento aberto.
      ⚠️ As duas consultas têm `.catch(() => [])`: tabela ainda não migrada não pode
      derrubar o Histórico nem a Memória Clínica inteiros.
- [x] **Chat de IA multi-turno, ancorado NO ACERVO** — `assistente_documento@v1`
      (`ai/prompts/assistenteDocumento.js`, em arquivo próprio por tamanho) +
      `services/documentoLLMService.js`, módulo novo `MODULOS_IA.DOCUMENTOS`.
      Decisão de produto desta sessão: *"multi-turno, mas baseado somente nos templates
      que temos e forem sendo criados"*. O assistente escolhe um modelo do acervo
      (globais + os da clínica) ou AJUSTA o que está aberto no editor; **não redige
      documento do zero** — o conteúdo mínimo é definido por norma, e um modelo
      inventado sai plausível e incompleto (falta a declaração que dá validade ao
      atestado, falta a identificação do responsável técnico).
      A resposta é VALIDADA contra o acervo que acabou de ser enviado: `templateId`
      fora da lista é descartado (id alucinado viraria `findUnique` que o RLS recusa, e
      o vet veria erro de banco em vez de resposta) e **bloco de tipo desconhecido é
      jogado fora**, nunca convertido em `texto` (converter mentiria sobre o que o
      assistente propôs; manter quebraria o editor).
      `acao: 'AJUSTAR'` sem nenhum bloco aproveitável vira `RESPONDER` — senão a tela
      limparia o documento do vet achando que recebeu algo.
      Aplicar o ajuste passa por `editor.substituirTudo`, que **preserva o histórico**:
      `Ctrl+Z` desfaz a sugestão. Com `trocarBase` (que reinicia o histórico), aceitar
      uma sugestão ruim custaria o trabalho todo.
      Os blocos enviados são os **do editor**, não os do banco: o vet pode ter alterado
      sem salvar, e é sobre o que ele está vendo que o pedido de ajuste incide.
      ⚠️ Substitui o `ModalCriarIA`, que **não chamava modelo nenhum** — era
      `montarPorHeuristica`, uma tabela de palavras-chave rodando no bundle do
      navegador. Removido.
      ⚠️ 429 (`IA_QUOTA_EXCEDIDA`) é REPASSADO com `next(err)` — o controller tem
      try/catch próprio e engolir ali devolveria 500 genérico (§7).
- [x] **Assinatura do veterinário** — `UsuarioEmpresa.assinatura_url`, POR EMPRESA
      (mesma razão de `foto_url`: o cadastro é da clínica). Enviada pelo PRÓPRIO
      profissional em `/cadastro-pessoal`, ao lado do CRMV — é a outra metade da mesma
      coisa, o que identifica o responsável técnico no papel. Rota
      `PUT/DELETE /users/me/assinatura` (multipart), espelho exato de `/me/foto`,
      inclusive na ordem "grava no banco → só então apaga o arquivo velho".
      O bloco `assinatura` renderiza a imagem SOBRE a linha, com nome e CRMV do
      vínculo. **Sem assinatura cadastrada sobra o espaço em branco** para assinar à
      mão — nunca se desenha uma assinatura que não existe.
      ⚠️ NÃO passa pelo `FotoEditorModal`: aquele editor recorta em QUADRADO e cortaria
      o traço. Vai comprimida e inteira.
      ⚠️ Somente leitura no `getMe` para conferência; `updateMe` não grava o campo.
- [x] **Logomarca da clínica no timbre da folha** (`PreviewA4`), FORA dos blocos de
      propósito: é identidade da empresa, não conteúdo do modelo — o vet não deve poder
      apagá-la sem querer ao editar, e ela precisa sair igual em todos os documentos.
      Sem logo, cai no nome da empresa; sem nem isso, não renderiza faixa nenhuma
      (melhor sem timbre que com um vazio).
- [x] **Permissões**: os slugs `documentos.templates.*` e `documentos.emitidos.*` já
      existiam no seed 002 desde antes de haver backend — agora gateiam as rotas. São
      separados de propósito: quem emite atestado no campo não precisa poder reescrever
      o modelo da clínica. O chat usa `templates.criar` (ele monta modelo); o
      `/contexto` usa `templates.ler`, e o acesso ao PACIENTE é verificado à parte com
      `verificarAcessoAnimal` — permissão de módulo não substitui escopo de animal.
      Cancelar emitido usa `emitidos.criar`: não existe slug de exclusão para emitidos
      no catálogo, e criar um agora nasceria sem ninguém configurado.
- [x] Removidos: `modules/documentos/seeds.ts` (`TEMPLATES_INICIAIS`, órfão depois que
      o acervo passou a vir do banco) e `ModalCriarIA.tsx`.
      Testes: `__tests__/documentosCentral.test.js` — 23 casos cobrindo o que quebra em
      SILÊNCIO (variável vazia × exemplo, resolução dentro de célula de tabela,
      validação da resposta do modelo, conteúdo mínimo dos 12 anexos, e um teste que
      reprova qualquer `{{chave}}` usada nos modelos que não seja resolvível).
      Suíte: **235 passando**. `tsc -b --noEmit` e `vite build` limpos.
- [x] **`tb_documento_templates` e `tb_documentos_emitidos` entraram em `TENANT_PLANE`**
      (`__tests__/tenancyRls.test.js`), agora que existem no banco — tenant plane em
      15/76 tabelas. O gate só enxerga tabela que existe DE VERDADE, por isso a ordem é
      sempre migration → gate, nunca o contrário.
- [x] **RLS conferido AO VIVO contra a base**, não só pela presença da policy: a clínica
      LÊ os 12 modelos globais; CRIA o próprio modelo (é este passo que prova que o
      teste tem valor — sem ele, tudo "passaria" por fail-closed); é RECUSADA ao criar
      linha global (`WITH CHECK`) e ao alterar o atestado do CFMV (`updateMany` devolve
      count 0, o global fica intacto); a empresa 58 não enxerga modelo da 42; e
      `tb_documentos_emitidos` recusa gravação carimbada para outra empresa.
      🔴 **ARMADILHA DE VERIFICAÇÃO, aprendida aqui:** `comEmpresa` tem de ENVOLVER o
      `$transaction`, nunca ficar DENTRO dele. O interceptador de `prismaTenant` lê o
      contexto no MOMENTO em que `$transaction` é chamado e carimba o tenant uma vez, no
      início; chamar `$transaction` fora do contexto deixa a transação SEM tenant, e aí
      toda escrita é recusada — o que se parece exatamente com "a policy funcionou"
      quando, na verdade, nada foi testado. Foi assim que a primeira rodada desta
      verificação passou pelo motivo errado. Em produção não ocorre: o `authenticate`
      abre o `comEmpresa` em volta do request inteiro, então o `$transaction` dos
      controllers já nasce dentro do contexto.
- [ ] O bloco `qrcode` continua um placeholder gráfico. Agora que o documento emitido
      tem número e id, dá para gerar o QR de validação de verdade — falta decidir a
      rota pública de validação (`{{sistema.urlValidacao}}` resolve vazio hoje).
- [ ] `POST /documentos/{whatsapp,email,pdf}` (`DocumentoCompartilharController`)
      continua recebendo o HTML montado na tela de origem e não conhece
      `DocumentoEmitido`. Enviar um emitido ao cliente hoje passa por exportar o PDF na
      mão. Ligar os dois é o próximo passo natural.
- [ ] `resumirPorAnimal` (o resumo de uma linha por LLM, `HistoricoController`) NÃO
      recebeu a origem `DOCUMENTO` — só `listarPorAnimal` recebeu. São consultas
      distintas; aplicar quando aquela rota for tocada.
- [ ] A lista "Emitidos para <paciente>" aparece só no estado vazio do editor. Uma aba
      própria de emitidos (com reimpressão e cancelamento) é o passo seguinte — o
      backend já tem `GET /documentos/emitidos` e `DELETE /documentos/emitidos/:id`.
