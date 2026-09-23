---
paths:
  - "backend/src/ai/**"
  - "**/*LLM*"
  - "**/aiLogger*"
  - "**/iaQuota*"
  - "**/notaFiscalService.js"
  - "**/exameParserService.js"
  - "**/resumoAtendimentoService.js"
  - "**/composicaoParserService.js"
  - "**/*Audio*"
  - "**/*AiUsage*"
  - "**/laudoEquinoExtracao*"
  - "**/retentativa.js"
  - "**/geminiClient.ts"
  - "**/crmvScraperService.js"
---

# Histórico de decisões — IA (prompts, memoria clinica, quota)

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-22 (parte 3) (🔴 **O PRÓPRIO `ehNotaFiscal` MENTIA — O
#   MODELO LIA O CUPOM CERTO E RECUSAVA MESMO ASSIM.** Relatado como "não foi
#   possível identificar uma compra" num cupom de balcão real (o MESMO documento já
#   verificado ao vivo em 2026-09-19, parte 3 — mesma loja, mesmo número 29477).
#   1. 🔴 **REPRODUZIDO AO VIVO, não suposto**: recriei o cupom (mesmo texto/layout,
#      via Puppeteer) e rodei `notaFiscalService.ler` de verdade contra o Gemini
#      **4 vezes**. Em **2 das 4**, a resposta trazia `ehNotaFiscal: false` mas
#      COM fornecedor (nome, endereço, bairro, cidade) e os DOIS itens certos
#      (nome, quantidade, valor unitário e total) — o modelo leu o documento
#      inteiro e ainda assim marcou a recusa. Não é falha transitória (503/timeout,
#      resolvida em 19/09): é o modelo ACERTANDO a extração e ERRANDO o comentário
#      sobre ela.
#   2. 🔴 **`normalizar()` confiava cegamente no booleano** e descartava a extração
#      certa junto com o veredito errado — a pessoa via "não identifiquei" sobre um
#      cupom que, na prática, tinha sido lido linha por linha.
#      **REDE DE SEGURANÇA nova**: `ehNotaFiscal: false` só é aceito quando NÃO há
#      `fornecedor.nome` OU nenhum item tem `valorUnitario`/`valorTotal`. Havendo os
#      dois, a extração vence o sinalizador do modelo — `ehNotaFiscal` é comentário
#      do modelo sobre o que ele fez, não parte do que ele extraiu, e é exatamente
#      o tipo de coisa que um modelo erra sem que o dado ao lado esteja errado.
#      ⚠️ NÃO fere "nada é inventado" (§ do arquivo, e §12 geral): a promoção usa
#      SÓ dado que o próprio modelo já tinha devolvido, nunca um valor novo.
#      ⚠️ Exige os DOIS (nome do fornecedor E item com valor) — fornecedor sozinho
#      ou item sozinho continua recusado; ver os dois casos negativos no teste.
#   3. **Nenhuma migration, nenhuma mudança de prompt.** O `ler_nota_fiscal@v2`
#      (critério "documento de compra", cupom/orçamento aceitos) segue correto —
#      trocá-lo teria reescrito o que já funciona sem tocar no defeito real, a
#      mesma lição de 19/09.
#   Gate novo `__tests__/notaFiscalNormalizar.test.js` (6 casos), com o CASO REAL
#   medido (fornecedor + itens do cupom, `ehNotaFiscal: false` do modelo) travado
#   literalmente. ✅ **Verificado que REPROVA**: removida a rede de segurança, o
#   caso real volta a `ehNotaFiscal: false` e o teste falha.
#   ✅ **RECONFIRMADO AO VIVO** depois da correção: rodei o mesmo cupom mais 4 vezes
#   contra o Gemini real — 3 sucessos (`ehNotaFiscal: true`, dados corretos) e 1
#   timeout de rede (60s, já coberto pela retentativa/timeout existentes — não é
#   este defeito). Suíte: 1405; `tsc --noEmit` limpo.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-22 (parte 3) — A recusa do próprio modelo não podia apagar a extração certa

> **NENHUMA MIGRATION.** É regra de código sobre a resposta da IA, sem schema
> envolvido. Suíte: 1405; `tsc --noEmit` (backend) limpo. NÃO verificado em navegador.

- [x] 🔴 **Reproduzido ao vivo contra o Gemini real, 4 vezes, com o cupom idêntico ao
      já verificado em 19/09** (mesma loja "GAMA BEZERRA PROD.VETERINARIOS", mesmo
      número 29477): em 2 das 4 chamadas o modelo devolveu `ehNotaFiscal: false`
      JUNTO com o fornecedor e os dois itens (nome, quantidade, valor) extraídos
      corretamente — ele leu certo e recusou por conta própria.
- [x] 🔴 **`normalizar()` ganhou rede de segurança contra o próprio sinalizador do
      modelo**: `ehNotaFiscal: false` só é aceito sem `fornecedor.nome` E sem item
      com valor. Havendo os dois, a extração (que já veio do modelo, nada
      inventado) promove o resultado para `ehNotaFiscal: true`.
- [x] Gate `__tests__/notaFiscalNormalizar.test.js` (6 casos) — o caso real medido,
      os dois negativos (fornecedor sem item com valor; item com valor sem nome de
      fornecedor), o caminho `true` de sempre intacto, e a resposta fora do formato.
      Verificado que reprova sem a correção.
- [x] ✅ Reconfirmado ao vivo depois da correção: 3 sucessos em 4 novas chamadas
      reais ao Gemini (a 4ª foi timeout de rede, comportamento já esperado e cabe na
      lógica de retentativa existente de 19/09 — não é este defeito).
- [ ] A inconsistência é do MODELO (`gemini-3.1-flash-lite`), não do prompt — pode
      reaparecer de outra forma (por exemplo, recusar com fornecedor mas SEM
      nenhum item, que ainda cai no "recusa de verdade" desta regra). Se isso for
      relatado, a pista é a mesma: reproduzir ao vivo antes de mexer no prompt.

---

# Atualizado em: 2026-09-19 (parte 3) (🔴 **A LEITURA DO DOCUMENTO DE COMPRA MANDAVA
#   CULPAR A FOTO QUANDO QUEM ESTAVA FORA DO AR ERA O GEMINI.** Relatado como "está
#   dando erro ao ler esta imagem", com a sugestão de trocar o prompt.
#   1. 🔴 **O PROMPT NÃO ERA O PROBLEMA — MEDIDO, não suposto.** O log de IA (id 517)
#      guardava a falha real: `Gemini API error 503: "This model is currently
#      experiencing high demand"`, com **91,8 s de latência** (duas chamadas de ~45 s
#      esperando pelo erro). E o id **516, SETE MINUTOS ANTES, teve SUCESSO** com o
#      MESMO documento (12,4 s, 2232 tokens de entrada / 344 de saída). ✅ Conferido
#      ainda contra o Gemini REAL com o `ler_nota_fiscal@v2` atual: o cupom
#      "ORÇAMENTO — SEM VALOR FISCAL" volta com fornecedor, endereço, número, data e
#      os 2 itens com unitário e total certos, ignorando cliente, total e troco — em
#      1,7 s. **Trocar o prompt teria reescrito o que funciona e deixado o 503 de pé.**
#      ⚠️ O formato sugerido (`tipo_documento`/`estabelecimento`/`cabecalho`/
#      `pagamento`) quebraria o contrato `ehNotaFiscal` inteiro — serviço, controller,
#      front e gate —, que o CLAUDE.md preserva DE PROPÓSITO desde 2026-09-10.
#   2. 🔴 **A MENSAGEM ÚNICA MENTIA SOBRE A CAUSA** — `motivoDaFalha` no
#      `NotaFiscalController`. Toda falha saía como "confira se a foto/PDF está
#      legível": a pessoa refotografa, recorta e troca o arquivo — tudo sobre o que
#      estava CERTO — enquanto a ação útil era esperar um minuto. Agora a falha
#      TRANSITÓRIA (`ehFalhaTransitoria`, já exportada) diz "o serviço está
#      sobrecarregado, não é problema do seu documento".
#      ⚠️ **Mensagem que aponta a causa errada é PIOR que mensagem genérica**: ela não
#      só deixa de ajudar, MANDA trabalhar no lugar errado. Mesmo tratamento no front
#      para o `timeout of 180000ms exceeded` do axios.
#   3. **Retentativa: de 1 para 2, com espera CRESCENTE e jitter.** Com 1,5 s FIXOS a
#      2ª tentativa cai no mesmo pico que derrubou a 1ª — foi o que os 91,8 s mostram.
#      ⚠️ **ORÇAMENTO DE TEMPO (`ORCAMENTO_INICIO_MS`, 60 s)**: tentativa nova só
#      COMEÇA enquanto o decorrido couber. Com 503 imediato cabem as três em segundos;
#      com o provedor lento (o caso medido) ele para na 2ª, como parava antes — é isso
#      que impede a correção estourar os 180 s de paciência do front.
#      ⚠️ O JITTER não é enfeite: sem ele todos os clientes que tomaram 503 no mesmo
#      segundo voltam juntos e reforçam a sobrecarga que estão esperando passar.
#   4. 🔴 **O `fetch` DO `geminiClient` NÃO TINHA TETO NENHUM** — `TIMEOUT_MS` (60 s,
#      `GEMINI_TIMEOUT_MS`) via `AbortSignal.timeout`. Sem ele não existe pior caso: o
#      503 lento prendia a requisição por 45 s sem nada poder interrompê-la. O estouro
#      vira `TimeoutError` com modelo e teto na mensagem e é FALHA TRANSITÓRIA (é o
#      mesmo evento do 503, visto do nosso lado do fio), logo entra na retentativa.
#      ⚠️ Folgado de propósito: a leitura de 4 páginas roda em ~12 s. O teto contém o
#      provedor travado, não corta trabalho legítimo.
#   5. `notaFiscalService` ENTROU nos gates de IA (`modelo = MODELO_PADRAO`, retentativa
#      na chamada multimodal) — ele já seguia as duas regras e estava FORA da lista,
#      justamente o serviço em que o 503 apareceu para o usuário.
#   **NENHUMA MIGRATION.** Gate `__tests__/iaFalhaTransitoria.test.js` em **23 casos**;
#   os de "repete UMA vez" foram INVERTIDOS, com o motivo no cabeçalho do arquivo.
#   ✅ **Verificado que REPROVA**: devolvidas a mensagem fixa, a espera fixa e as 2
#   tentativas, **3 casos falharam**.
#   ⚠️ **O teste nasceu FRÁGIL e a 1ª sabotagem deu falso verde parcial**: com a espera
#   real (1,5 s + 3 s + jitter) dois casos estouravam os 5 s de teto do jest. O `spy`
#   de `setTimeout` no `beforeEach` registra QUANTO seria esperado e dorme 0 — sem ele
#   o teste não fica lento, fica VERMELHO. Suíte: **1193**; `tsc --noEmit`, `tsc -b` e
#   `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-19 (parte 3) — A leitura falhava por 503, e a tela mandava culpar a foto

> **NENHUMA MIGRATION** — nada de schema. Suíte: **1193**; `tsc --noEmit` (backend),
> `tsc -b` e `vite build` limpos. NÃO verificado em navegador.

- [x] 🔴 **O DIAGNÓSTICO VEIO DO LOG DE IA, e ele desmentiu a hipótese do pedido.** O
      relato foi "está dando erro ao ler esta imagem", com um prompt de outra LLM para
      substituir o nosso. `tb_ai_usage_logs` (consultado DENTRO de `$transaction` com
      `set_config('app.plataforma','on',true)` — armadilha 42) tinha as duas pontas:
      ```
      id 516  15:16  sucesso  12,4 s   2232 in / 344 out   ← o MESMO documento
      id 517  15:23  FALHA    91,8 s   Gemini API error 503: "high demand"
      ```
      Sete minutos separam uma leitura bem-sucedida de uma falha; o arquivo não mudou
      nesse intervalo. Os 91,8 s são duas chamadas de ~45 s esperando pelo erro.
- [x] ✅ **O PROMPT ATUAL LÊ O CUPOM — conferido contra o Gemini REAL**, não por
      inspeção: `ler_nota_fiscal@v2` com o conteúdo do "ORÇAMENTO — SEM VALOR FISCAL"
      devolveu, em 1,7 s, fornecedor + endereço + bairro + cidade, número `29477`,
      data `2026-08-05` e os 2 itens com unitário e total corretos — ignorando o
      CLIENTE ("PATRICIA"), o total, a forma de pagamento e o troco, exatamente como o
      prompt manda. **Trocar o prompt teria reescrito o que funciona e deixado o 503
      de pé.**
      ⚠️ O formato sugerido (`tipo_documento` / `estabelecimento` / `cabecalho` /
      `cliente` / `pagamento`) NÃO é uma melhoria latente: ele quebraria o contrato
      `ehNotaFiscal` no serviço, no controller, na interface do front e no gate — e o
      CLAUDE.md registra desde 2026-09-10 que a chave é preservada DE PROPÓSITO,
      porque renomeá-la custa quatro arquivos para não mudar comportamento nenhum.
      O que ele traz de diferente (dados do cliente, forma de pagamento, troco) é
      justamente o que o nosso manda IGNORAR — daqui sai cadastro de PRODUTO e conta
      a pagar ao FORNECEDOR; o comprador e o troco não têm onde entrar.
- [x] 🔴 **`motivoDaFalha` — a mensagem deixou de mentir sobre a causa.** Toda falha
      saía como *"confira se a foto/PDF está legível"*, inclusive o 503. A pessoa tinha
      um cupom nítido, já lido com sucesso minutos antes, e a tela a mandava
      refotografar, recortar e trocar o arquivo — trabalho sobre o que estava CERTO,
      enquanto a ação útil era esperar um minuto.
      ⚠️ **Mensagem que aponta a causa errada é PIOR que mensagem genérica**: ela não
      só deixa de ajudar, ela manda trabalhar no lugar errado.
      ⚠️ Quem classifica é `ehFalhaTransitoria`, que JÁ existia e JÁ era exportada —
      não nasceu uma segunda regra de "o provedor caiu?".
      ⚠️ O texto cru do provedor continua fora da tela (dump de JSON não diz o que
      fazer); ele fica no `console.error`, que é onde se investiga.
      Espelho no front: `timeout of 180000ms exceeded` (texto do axios) virou "a
      leitura demorou mais que o esperado… o serviço pode estar sobrecarregado".
- [x] **Retentativa: 1 → 2, com espera CRESCENTE e JITTER** (`ai/retentativa.js`).
      Com 1,5 s FIXOS a segunda tentativa cai no mesmo pico que derrubou a primeira —
      é o que os 91,8 s medidos mostram. Agora 1,5 s → 3 s, com jitter de até 30%.
      ⚠️ **O JITTER não é enfeite**: sem ele, todos os clientes que tomaram 503 no
      mesmo segundo voltam juntos e reforçam a sobrecarga que estão esperando passar.
      ⚠️ 🔴 **ORÇAMENTO DE TEMPO (`ORCAMENTO_INICIO_MS`, 60 s)** — é ele que impede a
      correção virar um problema maior que o defeito. Quem espera é uma PESSOA com o
      documento na mão, e o front desiste em 180 s. Uma tentativa nova só COMEÇA
      enquanto o decorrido couber: com 503 imediato (o caso comum) cabem as três em
      segundos; com o provedor LENTO (45 s por chamada, o caso medido) ele para na 2ª,
      exatamente como parava antes. Sem o orçamento, três chamadas de 45 s dariam
      ~140 s de espera para entregar a mesma falha.
      ⚠️ A lib é FONTE ÚNICA de três serviços (`notaFiscalService`,
      `documentoConversaoService`, `exameParserService`) — os três ganham a mesma
      resistência, e é por isso que ela foi extraída em primeiro lugar.
- [x] 🔴 **O `fetch` do `geminiClient` NÃO TINHA TETO** — `TIMEOUT_MS` (60 s,
      sobrescrevível por `GEMINI_TIMEOUT_MS`) via `AbortSignal.timeout`. Sem teto não
      existe pior caso: o 503 lento prendia a requisição por 45 s e nada podia
      interrompê-la. ✅ Conferido AO VIVO contra o Gemini real — a chamada normal
      segue passando (2,6 s) e um `timeoutMs: 1` produz `TimeoutError` com o modelo e
      o teto na mensagem.
      ⚠️ A mensagem do abort (*"The operation was aborted due to timeout"*) não diz
      quem demorou nem quanto; quem lê o log precisa dos dois.
      ⚠️ Estourar o teto é FALHA TRANSITÓRIA — é o mesmo evento do 503, visto do nosso
      lado do fio —, então entra na retentativa. Sem isso, a chamada que estourou não
      seria repetida e a pessoa levaria a falha na primeira demora.
      ⚠️ Folgado de propósito: a leitura de 4 páginas é o caminho mais caro do sistema
      e roda em ~12 s. Apertar o teto transformaria documento grande em falha.
- [x] **`notaFiscalService` entrou nos gates de IA** (`let modelo = MODELO_PADRAO`,
      `comRetentativa(() => gerarConteudo(`). Ele já seguia as duas regras e estava
      FORA da lista — e era justamente o serviço em que o 503 apareceu para o usuário.
- [x] Gate `__tests__/iaFalhaTransitoria.test.js` em **23 casos** (+9): a 3ª chance, a
      espera crescente, o orçamento, o `TimeoutError` como transitório, o teto no
      cliente e a mensagem que não manda conferir a foto quando o provedor caiu.
      ⚠️ Os casos de "repete UMA vez" foram **INVERTIDOS**, com o motivo registrado no
      cabeçalho do arquivo (mesmo precedente de `faturaConsolidacao` em 17/09). A
      regra que CONTINUA valendo, e que os testes travam, é que erro de CONTEÚDO nunca
      é repetido.
      ✅ **Verificado que REPROVA**: devolvidas a mensagem fixa, a espera fixa e as 2
      tentativas, **3 casos falharam**.
      ⚠️ 🔴 **O TESTE NASCEU FRÁGIL E A PRIMEIRA SABOTAGEM DEU FALSO VERDE PARCIAL.**
      Com a espera REAL (1,5 s + 3 s + jitter) dois casos passavam dos 5 s de teto do
      jest e falhavam — mas na sabotagem, com espera FIXA (1,5 s + 1,5 s), eles
      passavam. Ou seja: o mesmo teste ficava verde no código errado e vermelho no
      certo. O `spy` de `setTimeout` no `beforeEach` registra QUANTO seria esperado e
      dorme 0 (13 s → 0,7 s). **Lição: teste que depende de espera real não mede o
      que promete — mede o relógio.**
- [ ] **Não foi implementado FALLBACK DE MODELO** (tentar outro modelo quando o
      `gemini-3.1-flash-lite` satura). Resolveria o 503 de vez, mas troca custo e
      qualidade sem ninguém decidir — e o CLAUDE.md (§7) exige registrar o preço do
      modelo novo em `aiLogger.service#PRECOS`, senão o custo cai no fallback
      `default`. É decisão de produto; o gancho é `opts.modelo` do `gerarConteudo`.
- [ ] O `exameParserService` não tem timeout de cliente no front (o axios fica sem
      teto). Não é problema novo — e agora o BACKEND tem teto por chamada —, mas se
      aquela tela ficar pendurada, é ali que o `timeout` entra.

---

### Sessão 2026-09-08 (parte 3) — Envio único, e a memória clínica que parou de inventar

- [x] **A VARREDURA DE ENVIO ACHOU UMA TELA SÓ.** `abrirWhatsApp`/`abrirEmail` (o envio
      por TEXTO puro) sobrevivia em UM lugar: o **fechamento de faturas EM LOTE**. Todo
      o resto do sistema já passava por `utils/compartilharPdf.ts` — direto (Fatura,
      Prescrição) ou pelo `CompartilharPdfBotoes` (Vacina, Exames, Encaminhamento,
      Evolução, Dieta, Documentos, Exame de Compra). O cliente daquele lote recebia
      "Total: R$ 1.234,00" numa mensagem e nenhuma fatura.
- [x] 🔴 **O LOTE PRÉ-CARREGA AS FATURAS, não busca no clique.** A resposta do
      fechamento traz só id, total, mês e o contato — sem itens, animais e logo não há
      folha a montar. A tentação é `aoPreparar` (busca no clique), e ela tem um furo:
      falhando a busca, `gerarHtml` — SÍNCRONO por contrato, porque roda dentro da
      janela de "user activation" de que o fallback manual depende — não teria o que
      devolver e o envio seguiria com uma folha VAZIA. **Um PDF em branco chegando ao
      cliente é pior que um botão que não aparece.** Carregando ao abrir a lista de
      resultado, a falha é visível na linha ANTES de qualquer clique.
      ⚠️ A logo é convertida para `data:` (`carregarComoDataUri`): o Puppeteer bloqueia
      requisição que não seja `data:` — armadilha de todo gerador novo.
      ⚠️ `foneIntl` SAIU da tela: quem normaliza o DDI agora é `compartilharPdf.ts`,
      um lugar só. Não reintroduzir a cópia local.
- [x] 🔴 **MODAL ARRASTÁVEL COMIA A SELEÇÃO DE TEXTO** (relatado na memória clínica,
      mas valia para **19 modais**). `useDraggableModals` usa `.rounded-t-2xl` como
      alça, pensando no CABEÇALHO — só que na maioria dos modais essa classe está no
      PAINEL (`bg-white rounded-t-2xl sm:rounded-2xl …`). `closest()` casava a partir
      de QUALQUER ponto do corpo: o modal inteiro virava alça, e o `preventDefault` +
      `userSelect: none` matavam a seleção — tentar copiar uma informação ARRASTAVA a
      janela.
      Guarda nova: **o painel nunca é a própria alça** (`handle === p ||
      handle.contains(p)`). O arraste segue pelo TÍTULO (h2/h3, que todo modal tem) e
      por `[data-drag-handle]`. ⚠️ Não reintroduzir `.rounded-t-*` como alça sem ela.
- [x] 🔴 **MEMÓRIA CLÍNICA — `memoria_clinica@v5`.** O destaque saía com os IDS DOS
      TÓPICOS dentro do texto ("Recorrência de dor lombar em 06/09/2026: t3, t6, t7,
      t9, t11."), com UMA data quando havia várias, e sem dizer o que foi
      prescrito/executado naquele atendimento. O prompt agora exige: nenhum id no
      texto, TODAS as datas, o que a evolução diz encadeado com o que foi
      prescrito/aplicado na MESMA consulta, e o ESTADO DE EXECUÇÃO com as palavras que
      o distinguem ("aplicada" × "aguardando a execução de"). Teto de 120 → 220
      caracteres: a frase pedida não cabia em 120.
      ⚠️ **Bump de versão FORÇA a reconsolidação** de todos os pacientes — é o que
      corrige a memória já gravada com o defeito. Mudou o prompt, suba a versão.
      ⚠️ **REDE ATRÁS DO PROMPT** (`semIdsDeTopico` + deduplicação em
      `normalizarHighlights`): prompt é instrução, não garantia, e o defeito volta
      calado na próxima variação do modelo. Só a ENUMERAÇÃO no fim/entre parênteses é
      removida — "Sensibilidade em T4" (vértebra) fica intacto, e há teste para isso.
- [x] **Painel da memória reordenado** (a pedido): **1. Destaques · 2. O que mudou ·
      3. Registros · 4. Atendimentos**. O antigo "Resumo das atividades" virou
      **Registros**, mostrando as **3 mais recentes** com o resto atrás de "Ver todos".
      ⚠️ As linhas vêm do mais recente para o mais antigo (ordem do prompt), então "os
      3 últimos registros" são as 3 PRIMEIRAS do array.
      ⚠️ A lista evento a evento passou a se chamar **Atendimentos**: dois blocos
      chamados "Registros" na mesma tela não dizem a ninguém qual é qual.
- [x] Testes: `__tests__/memoriaClinicaHighlights.test.js` (10 casos) — o caso relatado,
      o "T4 vértebra" que NÃO pode ser mutilado, a deduplicação sem acento/pontuação e
      o destaque que fica vazio depois da limpeza. Suíte: **625**.
- [ ] O envio em LOTE não diz quantas faturas foram efetivamente enviadas — cada linha
      dá o seu veredito no card central, mas não há um resumo do lote.

---

### Sessão 2026-07-28 (parte 2) — Metering de IA por cliente + 2FA por e-mail
- [x] **Metering por cliente** (migration `20260801000000`) — `AiUsageLog.empresaId`,
      model `IaPlanoEmpresa`, `services/iaQuotaService.js`, gate dentro de `callAI`,
      429 `IA_QUOTA_EXCEDIDA` no error handler global, endpoints
      `/ai-usage/por-empresa` e `/ai-usage/planos/:empresaId`, painel
      `components/ConsumoPorClienteIA.tsx`. `empresaId` propagado a TODOS os call
      sites de IA. Ver seção 7.
- [x] **2FA por e-mail** (migration `20260802000000`) — `users.mfa_ativo`,
      `tb_mfa_desafios`, `services/mfaService.js`, `emailService.enviarCodigoMfa`,
      rotas `/auth/2fa/verificar` e `/auth/2fa/reenviar` com rate limit próprio,
      `emitirSessao()` como ponto único de sessão, `components/Verificacao2FA.tsx`,
      cron de limpeza dos desafios. Ver seção 14.
- [x] **Seletor de 2FA para o ADMIN** (migration `20260803000000`) — `ConfiguracaoSeguranca`
      (linha única), `GET/PUT /api/seguranca/config`, `components/CardSegurancaAdmin.tsx`
      na tela **Configuração** (`/configuracao-alertas`, ADMIN). `exigeMfa()` virou
      **async**. Entregue DESATIVADO. Alteração auditada (categoria `CONFIGURACAO`).
      Armadilha descoberta aqui: `usePermissoes().isGestor` é FALSE para ADMIN — ver seção 14.
- [ ] Vender o plano em UNIDADES DE NEGÓCIO (nº de resumos/laudos/transcrições) e não
      em tokens — o token é a unidade de medida interna, não a de venda para a clínica.

---

### Sessão 2026-07-28 — IA: provider único, Memória Clínica, IA Financeira, consumo por módulo
- [x] **Gemini como provider ÚNICO** (migration `20260731000000`) — `AnthropicProvider`,
      `OpenAIProvider` e `GroqProvider` DELETADOS; chain reduzida a Gemini. Novo
      `src/ai/geminiClient.ts` centraliza texto, visão e áudio. Transcrição saiu do
      Whisper/Groq para o Gemini (`EvolucaoController.transcrever` e `AudioController`) —
      WebM/Ogg passam por `transcodeParaMp3` antes, pois o Gemini não aceita Opus.
      `composicaoParserService` deixou de fixar `gemini-2.5-flash`. `chamarGroqComLog`
      removido do `aiLogger.service`. `.env`: só `GEMINI_API_KEY` + `GEMINI_MODEL`.
      ⚠️ `gemini-1.5-flash` (pedido original) foi retirado da API do Google — ver seção 7.
- [x] **Memória Clínica do Paciente** — `memoria_clinica@v1` substitui `resumo_atendimentos`.
      Highlights clicáveis ancorados nos tópicos + resumo por tópicos ancorados na evolução
      de origem; incremental e persistido (colunas novas `dados` JSONB e `versao_prompt`).
      A IA não sugere conduta nem diagnostica. Ver seção 7 para o contrato completo.
- [x] **IA Financeira gerencial** — `analise_financeira@v1`,
      `services/financeiroLLMService.js`, `controllers/AnaliseFinanceiraController.js`,
      rota `GET /api/relatorios/financeiro/analise-ia`, painel
      `components/relatorios/AnaliseFinanceiraIA.tsx` (sob demanda).
      `RelatoriosController.financeiro` foi refatorado: a apuração virou
      `computarFinanceiro(req)` (exportada) e o handler só a serializa — fonte única
      de cálculo entre o relatório e a IA.
- [x] **Revisão de TODOS os prompts** — voz imperativa, sem explicações na saída.
      Versões: parse_laudo v5, interpretacao_clinica v3, resumo_historico v2,
      parse_composicao_visao/texto v2, extrair_resultado_sessao_equino v7.
      Prompts inline de `agendamentoLLMService` e `AudioController` migrados para o
      catálogo (`interpretacao_agendamento@v2`, `analise_nota_clinica@v1`).
- [x] **Relatório de consumo de IA por módulo** — `AiUsageLog.modulo`;
      `AiUsageController.resumo` ganhou `porModulo` (chamadas, tokens entrada/saída,
      média por chamada, custo) e `logRecente` aceita filtro `modulo`/`periodo` e
      devolve `tokensEntrada`/`tokensSaida` por chamada. `AiUsageDashboard.tsx`:
      card "Consumo por módulo" (cards no mobile / tabela no desktop), coluna Módulo
      e colunas Entrada/Saída/Total no log ADMIN; `min-h-screen` trocado por
      `PageContainer` (violava a regra de layout da seção 6).
- [ ] Confirmar o preço real do modelo em `aiLogger.service.js#PRECOS` — a coluna de
      custo do dashboard usa estimativa do tier flash-lite (chamadas e tokens são exatos).
- [ ] Montar `/api/clinica/audio` em `server.ts` — `AudioController` está funcional e
      migrado, mas a rota nunca foi registrada (o front já chama em `audioOrchestrator`).
