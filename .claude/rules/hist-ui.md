---
paths:
  - "frontend/src/components/**"
  - "frontend/src/App.tsx"
  - "frontend/src/main.tsx"
  - "**/Sidebar.tsx"
  - "**/PageContainer.tsx"
  - "**/AcaoRegistro.tsx"
  - "**/AppHeader.tsx"
  - "**/AppFooter.tsx"
  - "**/dateUtils.ts"
  - "**/DateInput*"
  - "**/*Dashboard*"
  - "**/*Painel*"
  - "**/*Mapa*"
  - "**/JanelaLista.tsx"
  - "**/OrdenacaoLista.tsx"
  - "**/RelatorioUI*"
---

# Histórico de decisões — Padroes de tela, shell e componentes

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-25 (🔴 **PACIENTE POR MÓDULO** — a pedido: "a regra do modo
#   busca vale ENTRE módulos; DENTRO de cada módulo o paciente continua selecionado".
#   Até aqui só a URL escolhia o paciente, e a aba Agenda do Atendimento, os sub-itens do
#   menu (Laboratorial/Imagem, Plano de Dieta/Relatório) e o próprio item do menu navegam
#   SEM id — então o paciente escolhido se perdia ao trocar de aba DENTRO do módulo.
#   `hooks/usePacienteDoModulo.ts`: um paciente lembrado POR MÓDULO, em sessionStorage —
#   `atendimento` · `vacina` · `exames` · `nutricional` (Dieta + Relatório COMPARTILHAM).
#   URL vence (escolha explícita) e passa a ser o lembrado; sem id, usa o lembrado.
#   ⚠️ Nenhuma tela lê a memória de outro módulo nem o `selectedAnimal` global — é isso
#   que mantém o Nutricional em branco depois de escolher no Atendimento.
#   ⚠️ Paciente clicado na aba Agenda (rota sem id) chama `lembrar`, senão trocar de aba
#   traria de volta o anterior. ⚠️ GET 403 no lembrado → `esquecer` (paciente de outra
#   empresa). Login, logout e `trocarContexto` limpam tudo (`esquecerPacientesDosModulos`).
#   ⚠️ sessionStorage e não localStorage: a memória é da ABA; fechar a aba volta à busca.
#   Gate: `__tests__/pacientePorModulo.test.js` (verificado que reprova). `tsc -b` limpo.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)

---

# Atualizado em: 2026-09-23 (🔴 **O MENU LATERAL DEIXOU DE CARREGAR PACIENTE NA URL.**
#
#   A §6 manda, desde 2026-09-22, que Atendimento · Vacina · Resultado de Exame · Plano
#   de Dieta · Relatorio Nutricional abram em MODO BUSCA, sem paciente herdado — e as
#   cinco telas cumprem a regra (`animalIdParam ?? ''`, sem auto-selecao).
#   Quem a contrariava era o **Sidebar**: ele montava o destino como
#   `animalId ? '/dieta/<id>' : '/dieta'`, com `animalId = selectedAnimal?.id`. A tela
#   entao recebia PELA URL exatamente o paciente que a regra mandava nao herdar — ou
#   seja, a regra estava escrita, implementada nas telas, e desfeita no menu.
#   Relatado como "a tela nutricional esta vindo com um paciente previamente
#   selecionado; precisa ser feito igual a do atendimento" — e o Atendimento estava
#   certo justamente porque o item dele aponta para `/clinica/agenda`, sem id.
#   🔴 **QUEBRA EM SILENCIO**: nada falha, nada e registrado, a tela so abre preenchida
#   com cara de conveniencia. O defeito aparece quando alguem escreve no paciente
#   errado, que e o custo que a regra existe para evitar numa tela de escrita clinica.
#   ⚠️ Foram os QUATRO itens que faziam isso, nao so os dois nutricionais: Vacina e
#   Resultado de Exame estao na mesma lista da §6 e tinham o mesmo defeito.
#   ⚠️ `selectedAnimal` saiu da desestruturacao do `useSelectedAnimal()` no Sidebar —
#   era usado so para isso. **Nao reintroduzir `selectedAnimal?.id` nos destinos do
#   menu**: para ir a um paciente, o caminho e o SELETOR da propria tela, que navega e
#   escreve no `SelectedAnimalContext`.
#   Gate: `__tests__/menuSemPacienteHerdado.test.js` (verificado que reprova).)

---

# Atualizado em: 2026-09-22 (parte 2) (🔴 **AS TELAS CLÍNICAS E NUTRICIONAIS ABREM EM
#   MODO BUSCA, SEM PACIENTE ESCOLHIDO** + a palavra "Paciente" que saía DUAS VEZES no
#   módulo nutricional — os dois a pedido.
#   1. 🔴 **ACABOU A AUTO-SELEÇÃO DE PACIENTE.** Atendimento, Resultado de Exame,
#      Dieta e Relatório Nutricional abriam com um paciente já na tela: `effectiveAnimalId`
#      caía em `selectedAnimal` (o último escolhido em QUALQUER outra tela) e, faltando
#      isso, um efeito escolhia o primeiro da lista — dois deles NAVEGANDO com
#      `replace: true`, o que ainda apagava a rota de origem. Agora só a URL escolhe:
#      `animalIdParam ?? ''`. Quem chega pelo menu busca no seletor, cujo placeholder
#      passou a ser **"Buscar animal…"**; o "Iniciar" da agenda e os links do paciente
#      seguem intactos, porque trazem o id na rota.
#      POR QUÊ: numa tela de ESCRITA CLÍNICA, o paciente errado na tela é o começo do
#      registro no paciente errado. A tela de Vacina já abria vazia desde 2026-09-03; as
#      outras quatro estavam em desacordo com ela sem motivo.
#   2. 🔴 **O ESTADO VAZIO MENTIA — e era um beco sem saída.** As três telas nutricionais
#      davam `return` ANTES do seletor com "Você ainda não possui animais sob sua
#      responsabilidade". Com a auto-seleção fora, essa frase passou a aparecer com a base
#      CHEIA (a pessoa só não escolheu ninguém) — e, sem o seletor renderizado, não havia
#      como escolher. Agora o cabeçalho e o seletor VÊM JUNTOS, e abaixo deles entra
#      `components/PainelSemPaciente.tsx`.
#      ⚠️ O painel separa TRÊS estados que não podem ser colapsados: *carregando* ·
#      *a base não tem paciente* · *há pacientes, falta escolher*. Colapsar o terceiro no
#      segundo é exatamente o bug acima.
#      ⚠️ Ele é FONTE ÚNICA: o bloco escrito à mão em `Vacina.tsx` foi convertido junto —
#      cinco cópias do mesmo painel divergiriam na primeira correção.
#   3. 🔴 **"Paciente" aparecia DUAS VEZES no módulo nutricional.** `SeletorAnimal` (o
#      invólucro que navega e escreve no `SelectedAnimalContext`) escrevia um
#      `<label>Paciente</label>` e o `SeletorAnimalInteligente` dentro dele escrevia
#      outro — um sobre o outro em Dieta, Resultado de Exame e Relatório Nutricional. O
#      rótulo é do CAMPO, e o campo é o de dentro: o de fora saiu.
#   4. ⚠️ **`SeletorAnimal` não esconde mais o seletor por `animais.length <= 1`.** Com a
#      tela abrindo vazia, a clínica de um paciente só ficava sem NENHUMA forma de
#      escolher. Quem decide "não há o que escolher" é o `semEscolha` do combobox, que já
#      pesa o par lista-vazia × já-escolhido.
#   5. **`SeletorPrestadorExecutante`** (componente novo) — ver `hist-financeiro.md`,
#      mesma data: o campo "quem executou" saiu de dentro de `ExecucaoPrescricao.tsx`
#      para ser usado também pelos modais de resultado de exame.

---

# Atualizado em: 2026-09-22 (**CABEÇALHO DE LISTA FIXO E OPACO** + **TODO SELETOR ABRE
#   PARA BAIXO** + **locais de trabalho deixaram de sair truncados no mobile** — os
#   três a pedido.
#   1. 🔴 **O CABEÇALHO STICKY ERA TRANSPARENTE — e por isso parecia rolar junto.**
#      `JanelaLista` prendia o `thead th` com `sticky top-0` desde que existe, mas SEM
#      `background`: as linhas rolavam POR TRÁS dos rótulos e o cabeçalho aparecia
#      embaralhado com os dados. O pedido — "o label fixo FORA do card dos dados,
#      rolando as informações para baixo" — é exatamente isso. Agora o `th` recebe
#      `bg-gray-50` + `shadow-[inset_0_-1px_0_…]`.
#      ⚠️ A borda vai por `shadow` inset, não por `border`: `border` em célula
#      `sticky` NÃO acompanha a célula quando ela descola do resto da tabela.
#   2. **TIPOGRAFIA DO RÓTULO padronizada no próprio `JanelaLista`**: negrito,
#      "Primeira maiúscula" (`normal-case`), `tracking-normal`, `text-gray-700`,
#      `text-xs`. Havia TRÊS estilos convivendo — `uppercase text-gray-400` (Produtos,
#      Procedimento), `uppercase text-gray-500` (Fornecedor, Prestador) e
#      `font-semibold text-gray-600` (Proprietário, Localização, Tratador).
#      ⚠️ **Nenhuma tela precisou perder a classe antiga**: `[&_thead_th]:normal-case`
#      gera um seletor DESCENDENTE (`.classe thead th`), de especificidade maior que a
#      `.uppercase` aplicada na própria célula — e, no `<tr>`, `uppercase` é só herança,
#      que declaração direta sempre vence.
#   3. **A JANELA CHEGOU ÀS 6 TELAS DE CADASTRO** que ainda não a tinham (o wrapper
#      `overflow-x-auto` que já existia virou `<JanelaLista maxItens={8}>`).
#      ⚠️ **Não dava para resolver com `sticky` na página**: o card é
#      `overflow-hidden`, e ancestral com overflow vira o contexto de rolagem — o
#      elemento nunca gruda. A janela cria o próprio scroll, que é o que faz o
#      cabeçalho ter onde grudar. `maxItens={8}` (Produtos segue em 5, como foi pedido
#      em 2026-09-17) — é um número, fácil de ajustar se a altura incomodar.
#   4. 🔴 **TODO SELETOR ABRE PARA BAIXO — o flip acabou.** Três combos decidiam a
#      direção medindo o espaço na tela, e os três foram convertidos:
#      · `components/catalogo/SeletoresCatalogo.tsx` (Forma/Unidade/Apresentação/Via);
#      · `modules/documentos/CamposForm.tsx` (campos do documento);
#      · `Faturamento.tsx` → `DropdownAbaixo`, que apesar do nome era o ÚNICO ancorado
#        por `bottom` DE PROPÓSITO (2026-09-08), para não nascer fora da janela na
#        última linha da fatura. **Isso foi REVERTIDO**: o preço era a lista cobrir o
#        campo que se estava preenchendo, e a direção mudar conforme a rolagem.
#      ⚠️ **O que se ajusta agora é a ALTURA, nunca a direção**: `maxHeight` pelo
#      espaço disponível, com piso de 120px para a lista não virar uma fresta ilegível
#      junto ao rodapé (abaixo disso ela ultrapassa a dobra e a página rola).
#      ⚠️ `PosicaoFlutuante` perdeu o campo `bottom` — é o que impede o flip voltar
#      por descuido: sem ele não há como ancorar pela borda de baixo.
#      ⚠️ **`<select>` NATIVO fica de fora, e não há como incluí-lo**: quem decide a
#      direção dele é o navegador/SO. Tela que precise garantir a direção usa um
#      desses combos, não o `<select>`.
#   5. **`CadastroPessoal` — locais de trabalho paravam de caber no celular.** Nome do
#      local e resumo eram `truncate` numa linha só, com "Alterar" e "Excluir" (botões
#      COM RÓTULO) ao lado: sobrava menos de um terço da largura e o nome do local — o
#      dado que identifica a linha — saía cortado. Agora abaixo de `lg` a linha é
#      `flex-col`, o nome QUEBRA (`break-words`, não `truncate`), o resumo desce para a
#      própria linha e as ações vão para o RODAPÉ, com borda separando. De `lg` para
#      cima volta a ser em linha, que é onde há largura para isso.
#      ⚠️ O corte é `lg` (1024px), e não o `md` de sempre: o pedido foi "mobile E
#      TABLET", e tablet em retrato passa de 768px.
#      É a mesma regra do card de cadastro na §6 do CLAUDE.md — ação com rótulo mora no
#      rodapé do card, nunca numa coluna lateral.)

---

# Atualizado em: 2026-09-19 (**O LOGIN PASSOU A POUSAR NO MAPA DE ATENDIMENTO** e
#   **RECIBOS DE PRESTADOR SAIU DO MENU** — os dois a pedido.
#   1. **Destino pós-login: `/painel-principal` → `/mapa-atendimento`.** Trocado nos
#      QUATRO pontos que são a MESMA entrada no sistema, para não haver dois pousos
#      diferentes conforme o caminho: `Login.tsx` (o redirect pós-senha),
#      `Dashboard.tsx` (quem restaura a sessão e cai em `/`), `CadastroPessoal.tsx`
#      (primeira entrada depois de confirmar o cadastro — §36-h) e `CadastroEmpresa.tsx`
#      (gestor completando o primeiro acesso). O **PROPRIETÁRIO não muda**: segue em `/`,
#      que é o portal do cliente.
#      🔴 **Isto DESFAZ a troca de 2026-09-05, e a razão dela se INVERTEU.** Naquela data
#      o destino deixou de ser o Mapa porque ele tinha saído do menu e a pessoa caía numa
#      tela sem item correspondente no Sidebar. Hoje é o **PAINEL** que está escondido
#      (`MOSTRAR_PAINEL_PRINCIPAL = false`, 2026-09-18) e o Mapa é que está lá — ou seja,
#      o argumento passou a valer para o outro lado.
#      ⚠️ **OS GATES DAS DUAS TELAS SÃO DIFERENTES, e isso muda QUEM é barrado.** O Painel
#      exige ser **VETERINÁRIO** (`ehVeterinario`); o Mapa exige **`dashboard.geral.ler`**.
#      Quem não tem o slug cai em "Acesso não autorizado" logo no login — como já caía no
#      Painel por não ser vet. Não é regressão (o Mapa é o gate mais AMPLO: VET EQUIPE e
#      ESTAGIÁRIO LEITURA por padrão do seed), mas o conjunto de barrados MUDA: clínica que
#      tenha NEGADO `dashboard.geral.ler` para enfermeiro/secretaria precisa revisar a
#      matriz, senão esses perfis entram numa tela de acesso negado.
#      ⚠️ **`EmpresaContext.trocarContexto` NÃO foi tocado** — ele continua pousando em
#      `#/painel-principal` ao trocar de empresa. É outro fluxo (não é login) e não foi
#      pedido; a consequência conhecida é que a troca de contexto pousa numa tela que não
#      está no menu. Se for para alinhar, é UMA linha ali.
#      ⚠️ A rota `/painel-principal`, `pages/PainelPrincipal.tsx` e o gate dela seguem
#      montados e funcionais — nada foi removido; só deixou de ser o destino.
#   2. **Recibos de Prestador escondido do Sidebar** (`MOSTRAR_RECIBOS_PRESTADOR = false`).
#      A tela NÃO foi removida: `/recibos-prestador`, `pages/RecibosPrestador.tsx`, a rota
#      `/api/recibos-prestador` e o gate `financeiro.recibos.ler` seguem montados — chega-se
#      a ela pela URL. Mesmo padrão (e mesma lição) do `MOSTRAR_MAPA_ATENDIMENTO` de
#      2026-09-05 e do Painel Principal de 2026-09-18: esconder o ITEM fez a volta custar
#      UMA LINHA, em vez de uma reconstrução.
#      ⚠️ **O flag entra na DEFINIÇÃO de `podeVerRecibos`, não no JSX do sub-item** — é ela
#      que decide o sub-link E o gate do grupo "Financeiro". Escondendo só o sub-item, quem
#      tivesse APENAS `financeiro.recibos.ler` continuaria vendo o grupo **abrir VAZIO**. E
#      deixar a variável sem nenhum leitor faria o `tsc -b` reprovar (TS6133).
#      ⚠️ `detectSection` e a classe de "ativo" do grupo continuam reconhecendo
#      `/recibos-prestador`: a rota segue alcançável, e quem chegar lá pela URL tem o grupo
#      Financeiro aceso, em vez de um menu que não corresponde à tela aberta.
#      ⚠️ Para trazer de volta, troque para `true` e **REMOVA o flag junto** — um `if (true)`
#      não configura nada.
#   **NENHUMA MIGRATION** — é 100% de TELA (front). `tsc -b --noEmit` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
---

### Sessão 2026-09-19 — Login pousa no Mapa de Atendimento; Recibos sai do menu

> **SEM MIGRATION.** As duas mudanças são de TELA (front). `tsc -b --noEmit` e
> `vite build` limpos. NÃO verificado em navegador — sem ferramenta de browser nesta sessão.

- [x] **Destino pós-login trocado para `/mapa-atendimento` nos QUATRO pontos de entrada**
      — `Login.tsx` (redirect pós-senha), `Dashboard.tsx` (sessão restaurada caindo em `/`),
      `CadastroPessoal.tsx` (primeira entrada após confirmar o cadastro, §36-h) e
      `CadastroEmpresa.tsx` (gestor completando o primeiro acesso). Trocar só o `Login.tsx`
      deixaria dois pousos diferentes para a MESMA entrada, conforme o caminho.
      PROPRIETÁRIO continua em `/` (portal do cliente).
      ⚠️ Ver no topo deste arquivo a diferença de GATE entre as duas telas (vet × slug
      `dashboard.geral.ler`) e o `EmpresaContext` que ficou de fora de propósito.
- [x] **`MOSTRAR_RECIBOS_PRESTADOR = false`** no Sidebar, no molde dos dois flags que já
      existem ali. O flag governa a DEFINIÇÃO de `podeVerRecibos` — ponto único que cobre o
      sub-link e o gate do grupo Financeiro (senão o grupo abriria vazio para quem só tem
      aquele slug). Rota, tela, endpoint e permissão intactos.
- [ ] `EmpresaContext.trocarContexto` ainda pousa em `#/painel-principal` na troca de
      empresa — fluxo diferente, não pedido aqui. Alinhar é uma linha, se for o caso.

---

### Sessão 2026-08-31 (parte 2) — Prescrição/Exames/Vacina: colunas e ordem/cor de ícone
- [x] **Nº | Data Início | Data Fim substituem o "Nº X" + "Data" único**, em Prescrição
      e Exames. Nenhum campo novo no banco — os dois modelos já carregavam o suficiente
      via `include` (padrão "top-level include devolve todos os escalares" — ver §13):
      - **Prescrição** (`PrescricaoGrupo`): Data Início = `createdAt` (igual à coluna
        "Data" antiga); Data Fim = `dataFimGrupo(g)` → `executadoEm ?? finalizadoEm`
        (a EXECUÇÃO é o fim de verdade — dose aplicada; sem ela, a FINALIZAÇÃO é o
        melhor "fim" disponível). Rascunho (SALVO) mostra "—" nas duas colunas de fim.
      - **Exames** (`ExameClinico`): Data Início = `dataSolicitacao`; Data Fim =
        `dataResultado` (`null` até o resultado ser carregado/finalizado → "—").
      Cabeçalho de Prescrição também: "Nº Prescrição"→"Nº", "Veterinário"→"Responsável",
      e Status/Justificativa migraram para o fim da tabela (antes ficavam logo após o
      Nº). Exames: "Nº Exame"→"Nº", "Solicitante" subiu para antes de Status/
      Justificativa, e o `<th>` de Ações (antes vazio) ganhou rótulo.
- [x] **Vacina**: cabeçalho passou de `ID|Vacina|Dose|Qtd|Lote|Via|Aplicação|Status|
      Justificativa|Executor` para `Nº|Aplicação|Vacina|Dose|Qtd|Lote|Via|Status|
      Justificativa|Executor|Ações` — a data de aplicação (com o selo de reforço
      vencido) passou a ficar logo após o Nº, antes do nome da vacina; nenhum dado
      novo, só reordenação de colunas já existentes.
- [x] **Ordem e cor do ícone de ação viraram regra ÚNICA nestas 3 telas** (desktop
      ícone-only E card mobile com rótulo), substituindo a ordem ad-hoc que cada tela
      tinha: **Alterar (laranja) → Visualizar (verde/emerald) → Imprimir (azul) →
      WhatsApp (verde, quando existir) → E-mail (azul, quando existir) → Cancelar
      (vermelho, sempre por último)**. Ações que não fazem parte deste conjunto
      (Finalizar, no caso de Prescrição/Exames) mantiveram a posição relativa que já
      tinham entre Visualizar e Imprimir — o pedido não as mencionou.
      - **Exames**: só reordenou/recoloriu o que já existia — o Visualizar (`Eye`) era
        `text-blue-600` e virou `text-emerald-600` (verde, igual às outras duas telas);
        não tem Alterar (nunca teve rota de edição do pedido) nem foi criado um agora.
      - **Prescrição**: já tinha Alterar (laranja) e Visualizar (emerald) no desktop,
        mas SEM WhatsApp/E-mail — esses dois só existiam no card mobile. Entraram
        também na tabela desktop, reaproveitando `abrirWhatsApp`/`abrirEmail`/
        `montarTextoPrescricao` que o card mobile já usava.
      - **Vacina**: mesma lacuna — Alterar (laranja) e Visualizar (emerald) já existiam
        no desktop (reaproveitando `editarHistoricoNoForm`/`podeEditarVac`, os mesmos
        que o card mobile usa para carregar a vacina de volta no formulário de
        criação), mas WhatsApp/E-mail só estavam no mobile. Entraram na tabela
        desktop com `abrirWhatsApp`/`abrirEmail`/`montarTextoVacina`.
      ⚠️ Nenhum endpoint novo foi necessário — carregar a vacina no formulário
      (`PUT /clinica/vacinas/:id`) já existia desde que o "Alterar" foi implementado
      no card mobile; esta sessão só levou a MESMA ação para o ícone da tabela.

---

# Atualizado em: 2026-08-21 (Nova rota PÚBLICA "/" — página institucional, para
#   quem NÃO está logado (pedido explícito do usuário). Antes não existia
#   nenhuma página pública: qualquer acesso, inclusive "/", caía direto em
#   `/login` via `ProtectedRoute`. Origem do conteúdo: um rascunho visual feito
#   à parte no Lovable, na pasta `Página Principal/` do repositório — MAS aquele
#   projeto usa um stack incompatível com o resto do sistema (TanStack Start,
#   Tailwind v4, build próprio) e nunca esteve "ligado" ao `frontend/`. Decisão:
#   reconstruir o MESMO visual (textos, fotos, animações) com o stack que o
#   `frontend/` já usa (React 18 + react-router-dom + Tailwind v3), em vez de
#   tentar aproveitar aquela pasta como está — mesma lógica de não deixar
#   projeto duplicado/órfão no repositório (§3). `Página Principal/` fica
#   pendente de remoção após validação visual do usuário — NÃO apagar sem
#   confirmação, já está versionada no histórico do Git.
#   `App.tsx`: o bloco protegido de sempre (ProtectedRoute + shell + Routes
#   internas) foi extraído para `ProtectedApp()`; novo `RootGate()` decide, só
#   para o path exato "/", entre a página institucional (`pages/Home.tsx`, sem
#   usuário) e `ProtectedApp` (com usuário — mesmo comportamento de hoje, "/"
#   interna continua sendo o Dashboard). React Router prioriza rota exata
#   ("/") sobre curinga ("/*"), então nenhuma rota interna existente foi
#   tocada. `Home.tsx` é composta por componentes pequenos em
#   `components/home/` (Nav/Hero/Marquee/Features/Workflow/Differentiators/
#   ClosingCTA/Footer/Reveal) — mesma divisão de seções do rascunho, só
#   quebrada em arquivos por causa da regra de não escrever componente com
#   +300 linhas (§10). Nav/Footer usam `<BrandS2Vet />` (a logomarca oficial
#   já servida por `/api/marca`) em vez do logo provisório "VetMind" do
#   rascunho — link "Entrar" leva para `/login` sem nenhuma mudança nele.
#   Como o app usa `HashRouter` (rotas em `/#/caminho`), as âncoras internas do
#   rascunho (`href="#recursos"`) foram trocadas por um clique com
#   `scrollIntoView` (`components/home/scrollToSection.ts`) — âncora comum
#   entraria em conflito com o roteamento por hash. Cores da página
#   (`cream`/`forest`/`ink`/`sage`/`hairline`, valores oklch) e a fonte de
#   título ("Instrument Serif", via Google Fonts em `index.html`) foram
#   adicionadas como tokens NOVOS em `tailwind.config.js` — não tocam em
#   nenhuma cor/fonte já usada no resto do sistema. Nova dependência:
#   `motion` (mesma biblioteca que o rascunho já importava). Fotos do rascunho
#   copiadas para `frontend/src/assets/home/` tal como estão (decisão do
#   usuário: reaproveitar o banco de imagens agora, trocar por fotos reais da
#   S2Vet depois — é só substituir esses 4 arquivos). E-mail de contato do
#   `ClosingCTA` é um placeholder (`contato@s2vet.com.br`) até ter o endereço
#   real. Build (`tsc -b` + `vite build`) validado sem erros; verificação
#   visual em navegador ainda PENDENTE — sem ferramenta de browser disponível
#   nesta sessão para confirmar.
---

# Atualizado em: 2026-07-31 (Shell: header e rodapé globais, busca global por empresa (/api/busca), marca no EmpresaContext, sidebar só com o logo da clínica)
---

### Sessão 2026-07-31 — Shell: header e rodapé globais + busca global
- [x] **Shell virou COLUNA** (`App.tsx`): `AppHeader` / corpo (`Sidebar` + `<main>`) /
      `AppFooter`. Header e rodapé são irmãos flex de ALTURA FIXA (`flex-shrink-0`), o
      corpo é `flex flex-1 min-h-0` (sem o `min-h-0` o `<main>` não rola) e só o
      `<main>` tem scroll. NADA de `position: fixed` — no iOS Safari o elemento fixo se
      desloca dentro de um shell com scroll interno. A `MobileTopBar` foi REMOVIDA: o
      gatilho do menu mobile mora no `AppHeader`.
- [x] **Busca global do header** — `GET /api/busca?q=` (`BuscaGlobalController` +
      `routes/busca.js`), devolvendo pacientes, atendimentos (evoluções) e agendamentos,
      cada item já com a `rota` de destino resolvida pelo backend (o front só navega).
      Front: `components/BuscaGlobal.tsx` (debounce 350ms, mínimo 2 caracteres, navegação
      por setas/Enter/Esc, resultado agrupado). Ver as duas regras na seção 16.
- [x] **`resolverContextoPermissao(req)`** (`permissao.middleware.js`) — resolve
      `req.equipeId`/`req.membroCargo` com a MESMA ordem do `checkPermission`, mas sem
      nunca responder 403. Criado para a busca, que atravessa três módulos e por isso não
      pode ser gateada por um slug único. Reuse em toda rota multi-módulo futura.
- [x] **Menu do usuário saiu da Sidebar e foi para o header** — identidade, selo de
      perfil, Cadastro Pessoal, Configurações (gestor) e **Sair** agora só existem no
      dropdown do `AppHeader`. A Sidebar não tem mais rodapé de usuário (fonte única).
- [x] **`EmpresaContext.marca`** — `{ logoUrl, empresaNome }` de `/equipes/logo` passou a
      viver no contexto, não na Sidebar. Header, Sidebar e rodapé mostram a MESMA marca;
      três cópias do fetch dariam três requisições e três estados divergindo na troca de
      contexto. Recarrega no evento `s2vet:config-atualizada` e ao trocar empresa/equipe.
- [x] **`useVetPendentes` virou STORE ÚNICO de módulo** — o hook é consumido em DOIS
      lugares (sino do header e badge de Pacientes na Sidebar). Um estado por componente
      significaria polling dobrado a cada 30s e **DOIS toasts** para a mesma solicitação.
      Agora há um só `setInterval`, compartilhado por assinantes e encerrado quando o
      último sai. Regra: hook de polling consumido em mais de um lugar precisa de store.
- [x] **Card da empresa na Sidebar: SÓ o logo**, centralizado no eixo do sidebar. Sem
      nome, sem cargo e sem o rótulo "Empresa ativa"/"Equipe ativa" do seletor de
      contexto. EXCEÇÃO deliberada: empresa SEM logo cadastrado cai no nome — senão o
      card viraria um quadrado com uma letra e ninguém saberia em que clínica está.
      A caixa fixa só os limites (`max-h-20 max-w-[13rem] w-auto object-contain`): a logo
      do cliente pode ser deitada (1200x551) ou em pé (750x1334) e não pode distorcer.
- [x] **Espaçamento do menu uniformizado** — ver armadilha 39.
- [x] **Marca do produto**: `backend/uploads/empresas/s2vet-logo.png` (mesmo diretório das
      logos das clínicas, por decisão). Ver armadilha 40.
- [x] **`podeVerMedicamentos` / `podeVerProcedimentos` — RESOLVIDO em 2026-09-02: assumido
      ADMIN-only, variáveis removidas da Sidebar.** Os links de Medicamentos e
      Procedimentos continuam gateados só por `isAdmin` (coerente com `requireAdmin`
      em `routes/medicamentos.js` — o catálogo GLOBAL só o ADMIN cria/edita/exclui; o
      que a empresa cadastra à mão em Orçamento/Prescrição entra por
      `lib/catalogoManual.js`, com `empresaId` próprio, sem precisar desta tela). Os
      slugs `medicamentos.catalogo.*`/`procedimentos.catalogo.*` ficam órfãos na
      matriz (mesmo status de `exames.laboratorial.*`) — decisão aceita, não gateiam
      nada de fato.
- [ ] Busca global cobre paciente/atendimento/agenda. Proprietário, fatura e orçamento
      ficaram de fora — avaliar quando houver demanda (cada um exige o seu `*.ler`).

#### ⏸️ PONTO DE RETOMADA — documentação funcional (parado em 2026-07-31)
O **CLAUDE.md está COMPLETO** para esta sessão (topo, seção 12, seção 16 nova, armadilhas
39/40, mapa de controllers/rotas/middlewares/componentes/contextos/hooks). Falta propagar
as MESMAS mudanças para a documentação funcional em `docs/`:

- [ ] `docs/ESPECIFICACAO_FUNCIONAL.md`
      - §17 — o parágrafo **"Sidebar:"** ainda descreve os accordions "Geral/Clínica/
        Enfermagem" e diz que há "badge do perfil ao lado do usuário": está desatualizado
        desde 2026-07-30 (cabeçalhos removidos) e agora também porque o bloco de usuário
        migrou para o header. Reescrever + descrever o shell (header/rodapé).
      - §18 — a linha de `useVetPendentes` diz "Badge no Sidebar"; hoje alimenta TAMBÉM o
        sino do header e virou store único.
      - Seção NOVA de busca global (ou subseção do shell), com as 2 regras da seção 16
        do CLAUDE.md: escopo por empresa ativa e permissão por grupo.
      - Anexo A (mapa de rotas) — incluir `GET /api/busca`.
      - ⚠️ §19 diz "interface AIProvider (implementação **Groq**)" — DESATUALIZADO desde
        2026-07-28 (provider único é Gemini). Corrigir de passagem.
- [ ] `docs/efa/EFA-00-TRANSVERSAL.md`
      - §6 (fluxo geral) — citar header/rodapé globais e a busca do header.
      - §8 (padrões de telas) — nova linha "Shell"; a linha **Mobile-first** ainda diz
        "Sidebar vira menu hambúrguer (fixed top-6 left-6)", que deixou de ser verdade
        (o gatilho está no `AppHeader`, sem `position: fixed`).
      - §10 — avaliar `RN-G` nova para o escopo por empresa da busca global.
- [ ] `docs/efa/00-INDICE.md` — a busca é transversal (EFA-00), então provavelmente NÃO
      exige documento novo; confirmar antes de criar EFA-16.
- [ ] `docs/efa/EFA-02-CONTROLE-DE-ACESSO.md` — registrar `resolverContextoPermissao` como
      variante sem enforcement do `checkPermission` (rotas multi-módulo).

---

# Atualizado em: 2026-07-14 (Relatórios com período + Tabela responsiva; expediente de atendimento; autosave de evolução; lembretes WhatsApp; alertas/Monitoração de cron com agenda dinâmica; cookie-dica de sessão)
---

### Sessão 2026-07-14 — Relatórios/UX, expediente, mensageria e agendador
- [x] **Relatórios por período (Dia/Semana/Mês/Ano)** — `PeriodoContext` (localStorage `s2vet_rel_gran`/`s2vet_rel_data`, sem reload) + `PeriodoSelector` (Dia|Semana|Mês|Ano + ◀▶ + data + Hoje) no topo dos 5 submódulos (Gestão/Financeiro/Atendimento/Cadastro/Farmácia). Backend `resolverPeriodo(req)` (query `granularidade`+`data`) em `RelatorioGerencialController` (exportado) → janela `[inicio,fim]`+`mesRef`+`refDate`; `RelatoriosController` usa a janela (métricas de janela filtram por `[inicio,fim]`; snapshots as-of `refDate`). Semana = domingo a sábado. **Bug do original corrigido**: Animal usa `dataCadastro` (não `createdAt`) no relatório de cadastro.
- [x] **Atribuição de animal no lançamento manual de fatura** — `Faturamento.tsx` `handleLancar` agora envia `animalId` (seletor no form); antes o "Atd. Emergencial" caía em "Sem animal/localização" no relatório emergencial. `FaturaController.adicionarItem` já aceitava `animalId`.
- [x] **Tabela de relatório responsiva** — `RelatorioUI.Tabela` clona as linhas injetando `data-label` por coluna + CSS `table.rel-table` (index.css) → no mobile vira cards empilhados (rótulo:valor). `Card` ganhou `min-w-0` (evita overflow do grid 2-col). `<main>` (App.tsx): `overflow-y-scroll overflow-x-hidden [scrollbar-gutter:stable]` — elimina o "dançar lateral" (Safari: barra overlay → causa era overflow horizontal).
- [x] **Layout do histórico de prescrição** replicado (tabela desktop + cards mobile) em: Farmácia, Estoque de Vacinas, Exames (resultado), e Agendamentos "Expediente Ativo" (mobile: contagem de livres + popover ao toque).
- [x] **Expediente de atendimento (dias + horário)** — `EmpresaConfiguracao.diasAtendimento` (CSV 0-6), `horaInicioAtendimento`/`horaFimAtendimento` (HH:MM) [migration `20260713020000`]. Config em `Configuracoes.tsx` (toggles de dias + horas). `Agendamentos.tsx` libera horários só nos dias/faixa (via `GET /equipes/horario-atendimento` — legível por QUALQUER membro, não só gestor; `resolverEscopoConfiguracaoMembro` em EquipeController). Ao salvar Configurações → redireciona p/ `/mapa-atendimento`.
- [x] **Ajuste de Estoque de Vacinas** (igual medicamentos) — `PATCH /vacinas/estoque/:id/ajuste` (`EstoqueVacinaController.ajustar`: ajusta `qtdDisponivel`, eleva `qtdTotal` se recontagem maior, motivo obrigatório → AuditLog categoria `AJUSTE`). Slug novo `vacina.estoque.ajustar` (seed + coluna AJUSTAR no ControleAcesso). `lib/auditoria.js` CATEGORIAS += `AJUSTE`.
- [x] **Autosave da evolução no celular** — `SubModuloEvolucao` grava rascunho da evolução NOVA em localStorage (`s2vet_ev_draft_<animalId>`) a cada alteração (inclui ditado); restaura no refresh (sem toast); limpa ao salvar/finalizar.
- [x] **Lembretes de agendamento por WhatsApp (D-1 e 2h antes)** — base pronta: `messaging/whatsappProvider.js` (abstração + `NoopWhatsAppProvider` que só loga; env `WHATSAPP_PROVIDER`), `services/lembreteAgendamentoService.js` (FEFO de tiers, idempotência via `AgendamentoClinico.lembreteWa1DiaEnviadoEm`/`lembreteWa2hEnviadoEm` — migration `20260713010000`). Envio real pluga no provider quando houver credenciais.
- [x] **Alertas + Monitoração das tarefas agendadas (cron)** — `lib/cronAlert.js` (`reportarCron`: e-mail ao ADMIN + registro em `CronExecucao`; erro sempre, sucesso só quando há trabalho); `emailService.enviarAlertaCron`. Config em `CronAlertaConfig` (destinatários/`notificarSucesso`/`ativo`), lida ao vivo. Tela **Monitoração** (`/monitoracao`, ADMIN): dia/semana/mês. Tela **Configuração** (`/configuracao-alertas`, ADMIN): alertas + agenda. Controller `MonitoracaoController` + rotas `/api/monitoracao/{config,execucoes,agendas}`. Migration `20260714000000`.
- [x] **Reagendamento dinâmico do node-cron a partir do banco** — `lib/cronManager.js` (`registrarJob`/`iniciarJobs`/`reagendar`/`listarJobs`): cada job tem `chave`+expr padrão; `CronAgenda` (migration `20260714010000`) guarda a expressão/`ativo` editável; `PUT /api/monitoracao/agendas/:chave` para/recria o task do node-cron AO VIVO (sem restart). server.ts registra os 7 jobs (`crmv_sync`, `auto_aceite`, `vinculos_provisorios`, `lembrete_d1_email`, `lembrete_whatsapp`, `fechamento_faturas`, `cancelar_agendamentos_nao_realizados`) e chama `iniciarJobs()` no listen. **Não usar `cron.schedule` direto** — sempre via `registrarJob`.
- [x] **Cookie-dica de sessão** — `authCookies.js` seta `s2vet_auth=1` (NÃO-HttpOnly, sem token) no login/refresh e limpa no logout; `AuthContext` só sonda `/me`+`/refresh` se a dica existir → some o 401 no console da tela de login. Sessões antigas precisam de 1 novo login para ganhar a dica.
- [x] **Job — cancelamento de agendamentos não realizados (2026-07-16)** — `services/agendamentoCronService.js` (`cancelarAgendamentosNaoRealizados`): job corporativo (todas as empresas) registrado como `cancelar_agendamentos_nao_realizados`, padrão **23:30** (`30 23 * * *`). Cancela todo `AgendamentoClinico` ainda `AGENDADO` (ativo) com `dataHora < now` → `CANCELADO` + `observacao` com o motivo (preserva EM_ANDAMENTO e futuros). Liga/desliga e horário sob controle do ADMIN na tela **Configuração** (CronAgenda, via `listarJobs`/`reagendar`). Reporta pela Monitoração via `comAlerta`/`reportarCron`.
- [ ] Lembretes WhatsApp: implementar um provider real (Cloud API/Twilio/Z-API) e credenciais.
- [ ] Configuração do ADMIN: se quiser digest diário dos alertas em vez de e-mail por evento.
