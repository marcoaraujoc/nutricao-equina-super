# S2Vet — CLAUDE.md
# Contexto arquitetural permanente para Claude Code
# Atualizado em: 2026-09-16 (🔴 **A CHAVE ÚNICA DO CATÁLOGO IGNORAVA A EMPRESA — o
#   COPY-ON-WRITE NUNCA FUNCIONOU** + erro cru deixou de chegar à tela.
#   1. 🔴 **O DEFEITO RELATADO:** alterar medicamento/vacina em `/cadastro/produtos`
#      mostrava NA TELA o dump do Prisma — "Invalid `tx.medicamento.create()` invocation
#      in D:\Projetos\...\unidadeMedicamento.js:111 … Unique constraint failed on the
#      (not available)". Causa: `tb_medicamentos` tem a UNIQUE
#      `(nome, formaFarmaceutica, apresentacao)` **sem `empresa_id`**, criada em
#      2026-05-27, quando a tabela era `tb_produtos` e o catálogo era SÓ GLOBAL.
#      Desde 2026-09-12 o catálogo é MISTO e editar item global CRIA A CÓPIA DA EMPRESA
#      — com o MESMO nome, forma e apresentação, que é exatamente o que a chave proibia.
#      ⚠️ **MEDIDO: 8.255 linhas na tabela e ZERO com `empresa_id`.** Nenhuma cópia
#      jamais foi criada: a regra existia no código e o banco a recusava desde o 1º dia —
#      vale para `lib/catalogoEmpresa.js` E para `lib/unidadeMedicamento.js` (a troca de
#      unidade de item global, de 2026-09-12, também nunca funcionou).
#      🔴 E era pior que o erro na tela: sem `empresa_id` na chave, a cópia da clínica A
#      BLOQUEARIA a da clínica B para o mesmo item global — defeito intermitente,
#      dependente do que OUTRA clínica fez antes.
#      ✅ **MIGRATION APLICADA** (autorizada) — `20261011000000_medicamento_unique_por_empresa`:
#      a chave passa a ser **(nome, formaFarmaceutica, apresentacao, unidade, empresa_id)**
#      com **`NULLS NOT DISTINCT`** (PG 15+; esta base é 18.4). `unidade` entra a pedido.
#      ⚠️ `NULLS NOT DISTINCT` NÃO é detalhe: sem ele cada NULL é valor distinto e DUAS
#      linhas GLOBAIS idênticas passariam a ser aceitas — o catálogo do ADMIN perderia a
#      proteção que a chave antiga dava. Com ele, a garantia do lado global fica IDÊNTICA.
#      ⚠️ **"vias" NÃO cabe na chave**: a via mora em `tb_medicamento_vias` (1:N) e índice
#      único só alcança colunas da própria tabela — lá a unicidade já é
#      `@@unique([medicamentoId, via])`.
#      ⚠️ NÃO fica no `schema.prisma`: `@@unique` não expressa `NULLS NOT DISTINCT` — é a
#      mesma situação da chave ANTIGA, que também vivia só no banco.
#      ⚠️ Exige o DONO (`nutriadmin`): `DROP/CREATE INDEX` pedem OWNERSHIP, não GRANT.
#      ✅ **PROVADA ANTES e CONFERIDA DEPOIS**, em transação REVERTIDA (0 linhas ao fim): ANTES a cópia
#      é RECUSADA; DEPOIS a cópia da empresa 58 é ACEITA, a da 42 também, a 2ª cópia
#      idêntica da 58 é RECUSADA, a 2ª linha GLOBAL idêntica é RECUSADA e a global com
#      outra UNIDADE passa a ser aceita. Aplicada, o CÓDIGO REAL
#      (`salvarItemDoCatalogo`) foi exercitado contra a base: trocar SÓ o fabricante, SÓ
#      as vias, SÓ a unidade ou SÓ o "controlado" — em MEDICAMENTO e em VACINA globais —
#      passou nos 5 casos, e duas edições seguidas do mesmo item REAPROVEITAM a mesma
#      cópia (1 linha, não 2). `migrate status`: 199 migrations, banco em dia.
#   2. 🔴 **ERRO CRU NUNCA CHEGA À TELA** — `lib/erroResposta.js` (`responderErro`).
#      O vazamento era `res.status(500).json({ error: err.message || 'Erro ao…' })`: o
#      `||` PARECE rede de segurança e é o oposto — a mensagem do Prisma SEMPRE existe,
#      então o texto amigável nunca entrava e iam para a tela o caminho do arquivo no
#      servidor e o trecho do código. O handler global de `server.ts` já fazia certo
#      (500 → "Erro interno do servidor"); o furo estava nos try/catch PRÓPRIOS dos
#      controllers, que respondem ANTES de o erro chegar lá.
#      ⚠️ **Erro de REGRA DE NEGÓCIO passa INTEIRO** (`UnidadeIndisponivelError`,
#      `FaturaPagaError`): eles têm `status` e texto escrito para ser lido ("inative a
#      outra entrada antes de trocar a unidade"). Engoli-los trocaria instrução útil por
#      "erro interno". P2002→409, P2003→409, P2025→404 e `IA_QUOTA_EXCEDIDA`→429 ganham
#      tradução; o resto é 500 com a frase que o controller escolheu, e o original vai
#      para o LOG com stack.
#      ⚠️ **NUNCA `err.meta.target` na resposta**: são NOMES DE COLUNA do banco — e com o
#      índice fora do schema o próprio Prisma devolve "(not available)".
#      🔴 **O GATE ACHOU MAIS 6 TELAS com o mesmo defeito** (o pedido "se estiver
#      ocorrendo em outras telas tem que ser corrigido"): `PermissaoController` (7
#      handlers), `AudioController`, `ComposicaoAlimentarController`, `EquipeController`,
#      `relatorio.controller`, `RelatorioNutricionalController`, `ExameController` (2) e
#      `NotaFiscalController` (ali o motivo é VISÍVEL na tela e vinha do dump).
#      ⚠️ O FRONT não foi tocado, de propósito: ele já lia `data.error ?? fallback` e
#      exibia fielmente o que o backend mandou. Sanitizar na tela esconderia junto as
#      mensagens de negócio, que são as úteis.
#      Gate novo `__tests__/erroNaoVazaParaTela.test.js` (9 casos) — comportamento +
#      varredura dos controllers, IGNORANDO COMENTÁRIOS (senão acusa a própria
#      documentação da regra). ✅ Verificado que REPROVA: reintroduzido o `||`, 2 casos
#      falharam. Suíte: **1032**; `tsc --noEmit` limpo.
#      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)
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
# Atualizado em: 2026-09-15 (parte 4) (🔴 **O QUE É DA EMPRESA VEM ANTES DO CATÁLOGO
#   GLOBAL** + o **LABORATÓRIO** virou cadastro de verdade no Estoque de Vacinas.
#   1. 🔴 **ORDEM em QUATRO grupos** na busca de medicamento/vacina da Prescrição (e da
#      Vacina e do Orçamento, que usam a MESMA rota) e na lista de medicamentos da
#      Farmácia: **0 EM ESTOQUE → 1 PRODUTO de fornecedor → 2 CADASTRADO pela clínica →
#      3 GLOBAL puro**, alfabético dentro de cada um. Os TRÊS PRIMEIROS são "da empresa".
#      ⚠️ **"Da empresa" NÃO é só `empresa_id != null`** — medicamento GLOBAL que a
#      clínica TEM EM ESTOQUE é dela para todos os efeitos: o frasco está na prateleira.
#      Reduzir o grupo à coluna do catálogo mandaria para baixo justamente o que ela tem
#      em mãos. Medido: o animal 93 (empresa 58) tem 2 em estoque + 3 cadastrados contra
#      4.368 globais.
#      ⚠️ Os três grupos de 2026-09-10 CONTINUAM valendo: o que mudou é que o antigo
#      grupo 2 ("o resto") foi PARTIDO em dois, separando a cópia da clínica do global.
#      🔴 **A PRIMEIRA PÁGINA SAI ORDENADA PELO BANCO** (`ordemEmpresaPrimeiro(req,
#      relacao)`): `listar` PAGINA e a Prescrição abre o dropdown com **`limit=5`**.
#      Ordenar só a página recebida deixaria o item da clínica FORA dela quando o nome
#      fosse alfabeticamente tarde — e o defeito apareceria na primeira tela que a pessoa
#      vê, sem erro nenhum.
#      ⚠️ A contagem de estoque do `orderBy` é escopada pelo **RLS**, não por `where`
#      (`tb_estoque_clinica` e `tb_lotes_vacina` com ENABLE+FORCE) — verificado ao vivo:
#      empresas 58 e 42 devolvem itens diferentes no topo. E a relação muda por tipo
#      (`lotes` na vacina, `estoques` no medicamento): errar faz a contagem sair ZERO.
#      ⚠️ `empresaId: 'asc'` e NUNCA `'desc'` — no Postgres ASC é NULLS LAST.
#      ⚠️ **ADMIN da plataforma fica FORA** (vê o catálogo de todas as clínicas): segue
#      alfabético. ⚠️ A LISTA DE LOTES da Farmácia NÃO foi reordenada — ali todo item
#      está em estoque, logo todos são "da empresa" e agrupar por origem do catálogo seria
#      ruído.
#   2. 🔴 **LABORATÓRIO NO ESTOQUE DE VACINAS.** O campo "Fabricante" virou
#      **Laboratório** e ganhou três coisas: **"Outros (sem laboratório informado)"**,
#      que isola as vacinas cujo cadastro não informou laboratório (**52 nesta base**,
#      antes alcançáveis SOMENTE por "Todos" — escolher qualquer laboratório as escondia);
#      **"+ Cadastrar novo laboratório"**, que grava no catálogo da clínica; e a lista
#      passou a ser a **UNIÃO** do que está nas vacinas com esse catálogo.
#      🔴 **SEM MIGRATION** — o laboratório não tem tabela própria e reusa
#      `tb_catalogo_tipo_servico` na categoria **LABORATORIO**, a MESMA dos tipos de
#      fornecedor/prestador/localização: traz de graça o tenant, a policy de RLS e o gate.
#      `categoria` é VARCHAR(20) SEM CHECK (conferido no banco) e 'LABORATORIO' tem 11.
#      Mesma decisão de 2026-09-08 para os tipos de local. Gate: `vacina.estoque.criar`.
#      ⚠️ A **sentinela** `__SEM_FABRICANTE__` precisa ser IGUAL nos dois lados: string
#      vazia já significa "todos", e divergindo o backend procuraria um laboratório com
#      esse NOME e "Outros" voltaria vazio.
#      ⚠️ O **vazio conta como ausente** (`btrim(...) = ''`), não só o NULL: o campo é
#      opcional e grava string vazia. ⚠️ "Outros" só aparece havendo o que filtrar.
#      ⚠️ Laboratório novo digitado no CADASTRO da vacina já entra no seletor sem
#      recarregar a tela. ⚠️ A escrita passa pelo MESMO `criarTipoCatalogo` dos demais
#      tipos (28-g). ✅ RLS conferido ao vivo, em transação REVERTIDA: a empresa 58 grava
#      e lê; a 42 enxerga 0.
#   **NENHUMA MIGRATION NESTA LEVA** (`migrate status`: 198, banco em dia). Suíte:
#   **1009**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos. Gates novos em
#   `__tests__/laboratorioVacina.test.js` e ampliados em `produtosContasPagar.test.js`,
#   os dois verificados que REPROVAM.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
#   Detalhes na §12.)
# Atualizado em: 2026-09-15 (parte 3) (🔴 **O E-MAIL PASSOU A TRAZER O CADASTRO QUE A
#   CLÍNICA JÁ TEM.** Ao SAIR do campo de e-mail, quatro telas de cadastro de PESSOA —
#   **Prestador, Fornecedor, Proprietário e Incluir Membro** — perguntam ao backend
#   "esta clínica já conhece este e-mail?". Duas respostas úteis:
#   **CADASTRO** (já existe o registro daquele tipo AQUI) → a tela CARREGA e passa a
#   EDITAR, em vez de montar a duplicata que o salvar recusaria no fim com 409;
#   **PESSOA** (é conhecida em OUTRO papel — a prestadora que vira estagiária, a
#   veterinária que vira cliente) → preenche **só os campos VAZIOS**, nunca por cima do
#   que foi digitado. Faixa explicando o que foi trazido (`AvisoCadastroEncontrado`):
#   preencher sozinho sem dizer por quê assusta.
#   🔴 **MULTI-TENANT — as três regras, em `lib/cadastroPorEmail.js`:** (1) o `users` é
#   IDENTIDADE, serve só para achar o `id` (`select: { id: true }`); nome, telefone,
#   documento e endereço saem SEMPRE de `tb_usuario_empresa` DESTA empresa (§36) — ler
#   do `users` devolveria o cadastro que a clínica vizinha digitou; (2) **FAIL-CLOSED**
#   sem `req.empresaId`; (3) **NUNCA `comEscopoPlataforma`** neste caminho — é ele que
#   levanta o filtro de tenant. ⚠️ "Não existe aqui" e "existe em OUTRA clínica" são a
#   MESMA resposta, de propósito: distingui-las faria do campo um verificador de
#   cadastro alheio.
#   ✅ **RLS CONFERIDO AO VIVO**: `tb_prestadores`, `tb_fornecedores`,
#   `tb_proprietario_perfis` e `tb_usuario_empresa` estão com **ENABLE + FORCE** e
#   policy fail-closed `app_plataforma() OR empresa_id = app_empresa_id()`. Medido: uma
#   busca SÓ pelo e-mail, **sem nenhum filtro de empresa**, devolve a linha na sessão da
#   dona e **NADA** na da vizinha (e nada sem contexto). O `where` do controller é
#   defesa em profundidade, não o único gate.
#   ⚠️ O escopo da busca é o MESMO da LISTAGEM (`escopoVisivel`, extraído e
#   compartilhado): o que a tela consegue ABRIR é o que ela carrega aqui — senão a busca
#   traria para edição um cadastro que a lista não mostra.
#   ⚠️ **No Incluir Membro NUNCA se carrega para edição** (quem edita membro é a linha
#   da lista): ali é só preenchimento, com gate de **GESTOR** — a rota devolve CPF e
#   endereço de terceiros.
#   **SEM MIGRATION** — só LEITURA de tabelas que já existem. Suíte: **977**;
#   `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
#   Detalhes na §12.)
# Atualizado em: 2026-09-15 (🔴 **PRODUTOS VIROU O CADASTRO DO ITEM** + prestador na
#   execução + a dose atrasada que empurra as seguintes + 3 defeitos que quebravam em
#   silêncio. Leva grande; o que mais importa saber ao voltar aqui:
#   1. 🔴 **`/cadastro/produtos` DEIXOU DE CADASTRAR A COMPRA.** Saíram Fornecedor,
#      Nota Fiscal, Valor de compra, Valor de venda, "Ler documento de compra" e "Dar
#      entrada no estoque"; entraram Forma Farmacêutica*, Apresentação*, Unidade*, Via*,
#      Controlado* e **Quantidade de Doses** (o número É a marcação de multidose — não
#      há checkbox à parte). A BUSCA traz o que já está cadastrado (global + o da
#      clínica) e **Alterar CARREGA os dados**. ⚠️ Editar item GLOBAL é **COPY-ON-WRITE**
#      (`lib/catalogoEmpresa.js`): nasce a cópia DA EMPRESA, o estoque ativo e a
#      prescrição pendente são REAPONTADOS, e o catálogo das outras clínicas não é
#      tocado. ⚠️ Os seletores são os MESMOS do cadastro rápido da Prescrição/Vacina
#      (`components/catalogo/SeletoresCatalogo`, extraídos de `CadastroCatalogoModal`).
#      🔴 Item NÃO-VACINA nasce com `classificacao = 'Cadastrado na clínica'`, NUNCA
#      nula — ver a armadilha do `NOT` sobre NULL na §12.
#      ✅ **MIGRATION APLICADA** `20261009000000_medicamento_multidose_empresa` —
#      `multidose`/`doses_por_embalagem` em **`tb_medicamentos`**. ⚠️ Só é seguro ali
#      PORQUE toda edição passa pelo copy-on-write; a linha global nunca é marcada.
#      `tb_produtos_fornecedor` **VENCE** quando existe (é o dado mais específico e é o
#      que já está gravado). `prisma generate` falhou com EPERM (§11) — tudo por SQL cru.
#   2. 🔴 **QUEM EXECUTOU O PROCEDIMENTO É INFORMADO NA EXECUÇÃO.** Campo novo no modal
#      de `/execucao-prescricao`, só em PROCEDIMENTO, **OPCIONAL**. O escolhido VENCE o
#      gravado na prescrição, é persistido no item e governa recibo + conta a pagar.
#      "Por procedimento" SAIU do tipo de pagamento do Prestador (fica SALÁRIO ×
#      COMISSÃO); o valor legado continua aceito no cálculo do recibo. A COMISSÃO já
#      incidia sobre o valor do procedimento/combo cadastrado — nada mudou ali. O que
#      mudou é o RELATÓRIO: a linha **Procedimentos** passou a sair LÍQUIDA da comissão
#      (`totalComissaoNoPeriodo`, lida do LEDGER, nunca recalculada). ⚠️ Sai só da
#      CATEGORIA, nunca do FATURAMENTO — este é o que foi cobrado.
#   3. 🔴 **A DOSE ATRASADA EMPURRA AS SEGUINTES** (`agendaDaDose`, ExecucaoPrescricao).
#      Procedimento 1x/dia por 2 dias mostrava a 2ª dose com data E HORA vencendo antes
#      de a 1ª ser executada. Agora a dose pendente é reapresentada HOJE ("prescrição em
#      atraso desde DD/MM") e as seguintes deslizam o mesmo tanto de dias. ⚠️ **Dose
#      futura não tem HORÁRIO**: quem o fixa é a execução da anterior (rolling schedule);
#      mostrar a hora prescrita afirmava um compromisso que ninguém assumiu. ⚠️ Só a
#      dose de AGORA é pintada de atrasada.
#   4. 🔴 **TRÊS DEFEITOS SILENCIOSOS:** (a) `criarGestor` morria com
#      `Cannot access 'emailNorm' before initialization` (TDZ — a senha era derivada
#      ANTES de a variável existir); (b) o cadastro de paciente hasheava o literal
#      `Inicial#001` e o e-mail anunciava `gerarSenhaInicial(...)` — o cliente recebia
#      uma senha que NUNCA existiu ("Usuário ou Senha Inválidos"); (c) a troca de
#      proprietário criava o login e **não mandava senha nenhuma**. Os três agora
#      calculam a senha UMA vez e usam nos dois lados.
#   5. 🔴 **A TELA EM BRANCO ERA O ErrorBoundary NO LUGAR ERRADO.** Ele só existia
#      DENTRO de `ProtectedApp`, abaixo dos providers e do Router — erro de render em
#      qualquer um deles desmontava a árvore e sobrava página branca, sem pista (o
#      console é noop em produção). Subiu para a RAIZ (`main.tsx`), grava o último erro
#      em `sessionStorage` e oferece "limpar dados locais".
#   6. **Vet + prestador na MESMA empresa:** os dois pagamentos já moravam em tabelas
#      distintas (`tb_usuario_empresa` × `tb_prestadores`). O que faltava: o cartão de
#      acesso do prestador SOBRESCREVIA o cadastro de quem já é membro — agora o
#      `cadastro` só preenche quando o vínculo NASCE ali.
#   7. **UI:** status da lista de proprietários em PILÍLULAS, numa barra "Status:" ao
#      LADO da busca (início da coluna do detalhe, mesma faixa da barra "Fatura:", e
#      FORA do `selecionado ?` — sem cliente escolhido o filtro precisa seguir
#      recortando a lista). O `<select>` compacto foi revertido a pedido; na coluna de
#      240px as pílulas quebravam em várias linhas, por isso a barra vive ao lado.
#      🔴 A barra **"Fatura:"** do detalhe (pílulas de status DENTRO do cliente) foi
#      REMOVIDA a pedido: o efeito de `filtroLista` JÁ realinhava o `filtroStatus`,
#      então as duas diziam a mesma coisa em lugares diferentes. ⚠️ O seletor de
#      **Mês** ficou (é o único caminho até a fatura de um mês anterior, e a barra
#      de status é `lg:`). ⚠️ Em "Todas" o painel abre no PRIMEIRO status que o
#      cliente tem — fixar ABERTA deixaria vazio, sem pista, o cliente que só tem
#      fatura fechada (a pílula desabilitada que dizia isso deixou de existir).
#      Cadastro da Empresa em
#      duas linhas de três (Tempo de Consulta · Fechamento · Data de Fechamento /
#      Validade · Forma de Cobrança · Percentual); Sidebar > Cadastro reordenado
#      (Pessoal · Equipe · Pacientes · Proprietários · Localizações · Tratadores ·
#      Prestadores · Fornecedores · Produtos · Procedimentos); Raça e Pelagem viraram
#      `DropdownSelect` (abrem PARA BAIXO — o `<select>` nativo decide sozinho e não há
#      CSS que force); **local criável na hora** no cadastro do Paciente e na troca de
#      proprietário (`NovaLocalizacaoModal`, escopo decidido pelo BACKEND); Farmácia:
#      "Val por Embalagem" → **Valor Unitário**, "Val Repassado por Embalagem" → **Valor
#      Unitário Cobrado**, e o aviso "Unidade alterada (…)" saiu.
#   7b. 🔴 **O NOME DIGITADO NO CADASTRO DE PRODUTO TRAZ O QUE JÁ EXISTE.** Em
#      `/cadastro/produtos`, ao SAIR do campo Nome (nunca por tecla — seria uma consulta
#      por caractere), `GET /cadastro/produtos/por-nome` responde se aquele
#      medicamento/vacina já está no catálogo VISÍVEL (global + o da clínica) e a tela
#      CARREGA forma, apresentação, unidade, vias, controlado, fabricante e doses. Antes
#      a pessoa redigitava um cadastro que o sistema tem, e nascia um item da clínica
#      DIVERGENTE do global de mesmo nome — sem nada acusar.
#      ⚠️ **A CÓPIA DA EMPRESA VENCE o global homônimo** (`empresa_id ASC NULLS LAST`):
#      com a cópia existente, carregar o GLOBAL faria o salvar criar uma SEGUNDA cópia
#      da mesma clínica. Mesma precedência de `garantirMedicamentoDaEmpresa`.
#      ⚠️ Item INATIVO também é reconhecido — `salvarItemDoCatalogo` REAPROVEITA e
#      reativa a cópia de mesmo nome; escondê-lo faria a tela oferecer um cadastro
#      "novo" que o salvar transformaria em edição, em silêncio.
#      ⚠️ `coalesce(classificacao,'')` nos DOIS ramos do recorte: `NOT ILIKE` sobre NULL
#      não é verdadeiro, e o item legado de classificação nula nunca seria reconhecido
#      (a armadilha do `NOT` sobre NULL, a mesma de `catalogoManual`).
#      ⚠️ `translate()`, NUNCA `unaccent()` (a extensão pode não existir na base do
#      cliente) — e as duas cadeias precisam ter o MESMO comprimento.
#      ⚠️ **SÓ no cadastro NOVO**: em edição, trocar o registro debaixo de quem edita
#      seria pior que o erro que isto evita. ⚠️ Carrega SOZINHO só com o formulário
#      vazio fora o nome; com campos digitados a faixa OFERECE o botão e quem decide é a
#      pessoa — sobrescrever seria perder trabalho em silêncio. ⚠️ `setForm` FUNCIONAL
#      (a resposta chega depois). ⚠️ A consulta NUNCA lança: reconhecer o nome é
#      conveniência, e derrubá-la trocaria um atalho por um impedimento.
#      Fonte única da normalização: `normalizarNome` (back) × `normalizarNomeProduto`
#      (front) — os dois precisam concordar. **SEM MIGRATION** (só LEITURA).
#      Gate: `__tests__/produtoPorNome.test.js` (16 casos), verificado que REPROVA.
#   8. **Documentos (MarcoVet):** removidos os 6 modelos de teste e criada a **Receita
#      Controlada** a partir da folha em papel (`seeds/007_receita_controlada.seed.js` +
#      `scripts/receitaControladaMarcoVet.js`, rodado). ⚠️ O nome "Receita Controlada" é
#      o elo com o recorte de controlados da Prescrição — trocá-lo quebra o recurso.
#   Suíte: **936**. `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
#   Detalhes na §12.)
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
# Atualizado em: 2026-09-11 (parte 2) (🔴 **O PRESTADOR SAIU DAS TRÊS TELAS** — a pedido,
#   "voltar como estava antes". Só o FRONT; nenhuma migration, nenhum endpoint removido.
#   1. **`/cadastro/procedimentos`**: saíram as colunas **Prestador** e **Valor
#      Prestador**, as linhas/cards de prestador, o `PrestadorCombo` e os DOIS buscadores
#      por prestador (um em cada aba). A grade voltou a ser
#      *Procedimento · Categoria · Valor Cliente*, com o par Salvar/Cancelar da linha
#      (2026-09-11 parte 1) INTACTO. No modal de COMBO os campos também saíram.
#      ⚠️ O combo **REENVIA `prestadorId`/`valorPrestador` gravados** no salvar: o
#      backend grava `null` quando o campo não vem, e sem isso editar o nome de um combo
#      APAGARIA em silêncio o prestador de quem o cadastrou enquanto o campo existia.
#      É o único resquício deliberado — estado sem UI, comentado no arquivo.
#   2. **`/clinica/exames/:id` (aba Imagem)**: a cadeia virou **CATEGORIA → EXAME**. Saiu
#      o passo do prestador, o aviso âmbar de "sem valor cadastrado" e o atalho
#      "Cadastrar os valores agora" (com ele, o `?codigos=`/`?vincularPrestador=` da
#      chegada guiada, que só ele produzia). O valor na linha do exame FICA — sem
#      prestador o backend já devolve o **valor padrão da empresa** (`ImagemExameController`),
#      e `POST /clinica/exames` sem `prestadorId` resolve o preço por `examesNomes` do
#      mesmo jeito. ⚠️ `laboratorio` do pedido de imagem voltou a sair de `outroLabNome`.
#   3. **`/clinica/prescricao/:id`**: saiu o campo **PRESTADOR QUE VAI EXECUTAR** e os
#      dois atalhos de cadastro/definição de valor. ⚠️ Não enviar `prestadorId` PRESERVA
#      o gravado (`gravarPrestadorDoItem` sai cedo em `undefined`) — nada é apagado.
#   ⚠️ **O BACKEND NÃO FOI TOCADO**: `tb_procedimento_prestadores`, o ledger do recibo,
#   `/recibos-prestador`, `POR_PROCEDIMENTO` e as rotas `…/cadastro/prestador*` seguem
#   existindo e funcionando. O que sumiu é a porta de entrada nessas três telas.
#   🔴 **AS SEÇÕES DE 08 A 11/09 DESCREVEM A UI ANTERIOR** — leia-as como histórico, não
#   como regra vigente, e não reintroduza os campos sem pedido.
#   `tsc -b` e `vite build` limpos. ⚠️ NÃO verificado em navegador — sem ferramenta de
#   browser nesta sessão.)
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
# Atualizado em: 2026-09-11 (🔴 **A GRADE DE PROCEDIMENTOS DEIXOU DE SALVAR SOZINHA** +
#   o atalho "cadastrar os valores agora".
#   1. Os valores seguem SEMPRE editáveis, mas gravar virou ato EXPLÍCITO: alterou,
#      aparecem **✓ Salvar** e **✕ Cancelar** na linha. ⚠️ REVERTE o auto-save no blur
#      de 10/09 — e NÃO tem ícone "Alterar", que não teria o que destravar num campo já
#      editável. Na linha do PRESTADOR os dois valores gravam JUNTOS, numa chamada só.
#      A linha virou componente (`LinhaProcedimento`/`LinhaPrestador` + os cards mobile)
#      porque dentro de um `.map` não há estado por linha.
#   2. Na aba Imagem, exame MARCADO cujo prestador ainda não tem valor vira faixa âmbar
#      com **"Cadastrar os valores agora"**: abre `/cadastro/procedimentos` recortado só
#      naqueles exames (`?codigos=PR-0302,…`) e com o prestador já vinculado em cada um.
#      ⚠️ Não bloqueia o pedido, e a tela AVISA que a lista está recortada. Suíte: 794.
#   Detalhes na §12.)
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
# Atualizado em: 2026-09-10 (parte 2) (✅ **MIGRATIONS APLICADAS** + a grade de
#   Procedimentos sem lápis, o seletor de prestador e dois defeitos de tela.
#   1. ✅ **`20261001000000_procedimento_prestador` APLICADA** (autorizada), e com ela a
#      `20260930000000_cargo_prestador`, que estava pendente desde 09/09.
#      🔴 **A ANTERIOR ESTAVA COM DEFEITO E DERRUBOU A FILA**: o `INSERT` em
#      `tb_perfis_equipe` não informava `updatedAt`, que é `@updatedAt` no Prisma —
#      quem o preenche é o CLIENT, então a coluna é NOT NULL e **sem DEFAULT** no banco.
#      `23502 null value in column "updatedAt"`, migration marcada como FAILED,
#      bloqueando TODAS as seguintes. Resolvido com `migrate resolve --rolled-back` +
#      correção do SQL. ⚠️ **`createdAt` não tem esse problema** (`@default(now())` gera
#      DEFAULT de verdade) — a diferença entre os dois não se vê no schema.prisma a olho
#      nu, e é a armadilha de todo INSERT por SQL cru.
#      Resultado conferido: 6 equipes → 6 perfis PRESTADOR + 847 linhas de matriz
#      copiadas; as 2 tabelas novas com RLS `ENABLE + FORCE` e policy de tenant; a
#      coluna `tb_prescricoes.prestador_id` no lugar. Seed rodado (os 2 slugs de recibo
#      existem). As duas tabelas entraram em `TENANT_PLANE`.
#      ⚠️ **A VERIFICAÇÃO CAIU NA ARMADILHA 42**: o primeiro `SELECT count(*)` devolveu 0
#      para os perfis novos e parecia que a migration não gravara nada — era o FORCE RLS
#      escondendo as linhas de quem não carimbou `app.plataforma`. Conferir tabela do
#      tenant plane exige o carimbo TAMBÉM na leitura.
#   2. 🔴 **A GRADE DE PROCEDIMENTOS PERDEU O LÁPIS** (a pedido): "Valor Cobrado pelo
#      Prestador"→**Valor Prestador** e "Valor Cobrado para o Cliente"→**Valor Cliente**,
#      os dois como campos SEMPRE editáveis (`ValorInline`), que gravam ao SAIR do campo
#      e só **se o texto mudou** — sem essa comparação, percorrer a tabela com Tab
#      dispararia um PUT por célula visitada. `Enter` confirma, `Esc` desfaz para o
#      último valor salvo (sem a volta, quem começa a digitar por engano não tem como
#      cancelar e o blur gravaria o meio da digitação). Falha na gravação DEVOLVE a
#      célula ao que o banco tem — a tela nunca fica mostrando número que não foi salvo.
#   3. 🔴 **O PRESTADOR VIROU SELETOR, sem ícone** (a pedido): `PrestadorCombo` — digita
#      para filtrar, marca um que exista, e **escolher JÁ CRIA a linha** (não há botão
#      intermediário). Sem correspondência exata oferece **Cadastrar “X”**, que leva a
#      `/cadastro/prestadores?novo=1&nome=&depois=…&vincularNome=`; ao salvar, volta para
#      cá, acha o prestador PELO NOME e abre o vínculo sozinho. ⚠️ NÃO cria o prestador
#      aqui: o cadastro exige nome E telefone, e criar só com o nome produziria cadastro
#      incompleto.
#   4. **Buscador POR PRESTADOR nas duas abas** — campo PRÓPRIO, separado da busca por
#      nome/categoria: num campo só, "Silva" daria resultado imprevisível (procedimento
#      OU prestador). O vazio distingue "nenhum procedimento" de "nenhum vinculado a
#      esse prestador".
#   5. **O COMBO ganhou prestador e os dois valores** — `prestador_id` e
#      `valor_prestador` em `tb_procedimento_combos`. ⚠️ `valor` NÃO foi renomeado: ele
#      já era o **Valor Cliente** do pacote; renomear obrigaria a tocar todos os leitores
#      para não ganhar nada — mudou o RÓTULO. ✅ **MIGRATION APLICADA**
#      (`20261002000000_combo_prestador`, autorizada; 6 combos existentes intactos).
#      `recursos.comboPrestador` ficou como GUARDA permanente: numa base sem as colunas
#      a tela TROCA os campos por um aviso — sem a bandeira, o gestor escolheria o
#      prestador e a escolha desapareceria no salvar, em silêncio.
#   6. 🔴 **"Arquivo anexado:" mostrava a descrição DO PEDIDO** no aviso de divergência
#      de exame: a regra "o que já está escrito não é sobrescrito" preserva `descricao`,
#      então as duas linhas do modal saíam com o MESMO texto — comparar uma coisa com ela
#      mesma não ajuda a decidir se o laudo anexado é o errado. Agora mostra o NOME DO
#      ARQUIVO analisado e, à parte, o que a IA leu dentro dele.
#   7. 🔴 **O COMBO DE VACINAS DO ATESTADO CORTAVA EM 60** (`.slice(0, 60)` sem aviso,
#      num catálogo de 231 nomes): tudo depois do 60º alfabético era invisível. O teto
#      subiu para 200 e, quando ainda corta, a última linha diz quantas faltam. Saiu
#      também o `take: 500` da consulta — aplicado ANTES da deduplicação por nome, ele
#      era um corte alfabético silencioso esperando a clínica cadastrar as próprias
#      vacinas. E as **aplicadas neste paciente nos últimos 12 meses vêm no TOPO com
#      ✅**, da mais recente para a mais antiga. ⚠️ Só `EXECUTADA`: `SALVA` é rascunho e
#      `FINALIZADA` aguarda o plantão — marcá-las afirmaria no atestado uma dose que
#      ninguém aplicou. ⚠️ ERGUE, nunca FILTRA (a primeira dose é vacina que o paciente
#      nunca tomou). Suíte: **747**. Detalhes na §12.)
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
# Atualizado em: 2026-09-09 (parte 2) (🔴 **FORNECEDOR E PRESTADOR NÃO SÃO EQUIPE** —
#   são ATUAÇÕES ESTANQUES. Eles saíram da tela Equipe, do Controle de Acesso, da grade
#   da Agenda e dos contadores, e passaram a ser criados e geridos nos PRÓPRIOS cadastros
#   (`/cadastro/fornecedores`, `/cadastro/prestadores`) + Designações.
#   ⚠️ **`MembroEquipe` CONTINUA existindo para eles** — não é contradição, é
#   infraestrutura: TODO o RBAC se resolve por ele, e sem o vínculo o profissional leva
#   403 "Nenhuma equipe ativa" (o `userType FORNECEDOR` não tem bypass). O vínculo virou
#   um **CARTÃO DE ACESSO emitido pelo CADASTRO** (`lib/acessoExterno.js`), não uma
#   cadeira na equipe.
#   🔴 O cadastro passou a ENTREGAR o acesso que prometia: `Prestador.acessoSistema`
#   criava login SEM `MembroEquipe` desde 2026-08-21 — a pessoa entrava e não via nada
#   (o próprio schema documentava). Agora o cartão é emitido na criação e a cada salvar.
#   ⚠️ Desmarcar o acesso NÃO apaga o vínculo (o cascade levaria a `PermissaoMembro`
#   junto); quem corta o login é `acesso_sistema = false`.
#   ⚠️ O filtro da listagem é no ENDPOINT (`SEM_EXTERNOS`), pelo cargo PRIMÁRIO — quem é
#   VETERINARIO e acumula prestador continua na equipe.
#   "Gerenciar Acesso" (designações) mudou de casa: do Controle de Acesso para os dois
#   cadastros, num componente só.
#   **MAPA DE ATENDIMENTO de volta ao menu** (pedido à parte, mesma data): ele estava
#   ESCONDIDO por um flag no Sidebar desde 2026-09-05, com rota, tela e controller
#   intactos — a volta custou uma linha. Não confundir com o ATALHO do Painel
#   Principal, que segue removido.
#   **SEM migration** e sem tocar em dado gravado. Suíte: 709. Detalhes na §12.)
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
# Atualizado em: 2026-09-06 (parte 4) (🔴 O PACIENTE DO CLIENTE INATIVADO DEIXOU DE
#   SUMIR DA APLICAÇÃO — ele vai para a aba **Inativos** da tela de Pacientes.
#   `ProprietarioController.removerDaEmpresa` INATIVA os animais do cliente removido
#   (isso já era assim) e a regra de visibilidade esconde o animal de quem não é
#   cliente ativo da empresa (isso também). Cada uma está certa sozinha; JUNTAS,
#   faziam o paciente desaparecer de TUDO — nem na aba Inativos ele aparecia. Não
#   havia onde conferir o que houve nem botão por onde desfazer, e o único rastro era
#   a justificativa gravada numa linha que ninguém mais enxergava.
#   REGRA NOVA: **na aba de Pacientes o estado do dono deixa de FILTRAR e passa a ser
#   REPORTADO** (`proprietarioInativo`), e a TELA o classifica como inativo.
#   ⚠️ SÓ ali, e só para gestor/admin com `?ativo=` explícito: é a mesma trava que já
#   protegia o `ativo:false`. Nenhuma outra listagem mudou — agenda, plantão,
#   dashboard e relatórios seguem em `animalVisivelNaEmpresa`, isto é, tratando o
#   paciente de cliente inativo como INATIVO, que é o que a tela passa a dizer dele.
#   ⚠️ A marca sai da REGRA POSITIVA (`animalVisivelNaEmpresa`), consultando quem
#   PASSA por ela e marcando o complemento — nunca de uma negação escrita à mão, que
#   seria uma segunda cópia da regra do §36 e divergiria dela na primeira correção.
#   ⚠️ A SAÍDA já existia: "Ativar" na aba Inativos chama `/animais/:id/reativar`, que
#   reativa o CLIENTE junto (`lib/donoAtivoDoPaciente.js`) — a tela agora CONTA isso,
#   e avisa quando o login global do cliente segue desligado por outra clínica.
#   ⚠️ Cobre também a opção "manter os animais" de `removerDaEmpresa`: ali o paciente
#   fica `ativo = true` sem trilha própria, e a justificativa diz onde se desfaz
#   (Cadastro › Proprietários) em vez de sair vazia.
#   Gate novo `__tests__/pacienteDeClienteInativo.test.js` (8 casos, os dois lados) —
#   verificado que REPROVA. Suíte: 584. Detalhes na §12, sessão 2026-09-06 (parte 4).)
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
# Atualizado em: 2026-09-02 (parte 2) (🔴 PACIENTE INATIVO = PRONTUÁRIO CONGELADO,
#   NÃO PACIENTE ESCONDIDO. Decisão de produto desta sessão, e ela vale a distinção:
#   `Animal.ativo` (exclusão lógica) faz o paciente SUMIR de tudo; `Animal.inativo`
#   deixa TUDO visível — evolução, prescrição, exame, encaminhamento, vacina,
#   agendamento, dieta, histórico e os cancelamentos — e CONGELA na data e hora da
#   inativação: nada mais é criado, alterado, finalizado, executado, cancelado ou
#   excluído até o gestor reativar. Reativado, o histórico segue o trâmite normal.
#   🔴 **O ESTADO JÁ EXISTIA; O BLOQUEIO ESTAVA SÓ NOS `criar`.** Era um congelamento
#   que descongelava: a evolução do paciente inativo continuava sendo reaberta e
#   assumida, a prescrição finalizada, executada e cancelada, o agendamento remarcado,
#   o exame finalizado e o encaminhamento concluído — o prontuário "congelado" mudava
#   depois de congelado e nada acusava.
#   GUARD ÚNICO `lib/animalInativo.js#bloquearSeAnimalInativo(res, animalId, opts)`,
#   aplicado a **34 caminhos de escrita** de 8 controllers (Evolução — inclusive
#   mídias e título —, PrescriçãoGrupo — inclusive item, execução, reabertura e o
#   ajuste de hora pós-execução —, Vacina, Exame — inclusive resultado e imagem —,
#   Encaminhamento, Agendamento, Dieta e a EMISSÃO de documento).
#   ⚠️ Entra DEPOIS do gate de acesso ao animal: bloquear antes confirmaria a
#   existência de um paciente de outra clínica. ⚠️ Responde **400**, não 403 — não é
#   falta de permissão (o gestor também é barrado), é o ESTADO do registro. ⚠️ O
#   formato da resposta é opção (`{ error }` × `{ sucesso, mensagem }`): devolver o
#   errado faz a tela mostrar "undefined".
#   ⚠️ FICAM DE FORA, de propósito: LEITURA (é o ponto da regra), `inativar`/`ativar`
#   (trancariam o paciente para sempre) e o FINANCEIRO — fatura e orçamento são
#   dinheiro já lançado, e travar o fechamento porque o paciente foi inativado prenderia
#   a cobrança da clínica sem nenhum ganho clínico.
#   **FRONT**: o estado entra nas MESMAS variáveis de permissão de cada submódulo
#   (`podeCriar`/`podeEditar`/`podeFinalizar`/`podeDeletar` → `!pacienteInativo && (...)`),
#   o que apaga todo botão de escrita de uma vez e cobre o botão que ainda vai nascer.
#   `podeImprimir`/`podeCompartilhar` FICAM: imprimir e enviar são SAÍDA de conteúdo, e
#   "fica para visualização" quer dizer exatamente isso. Faixa âmbar no shell de
#   Atendimento e na tela de Vacina (sem ela os botões só somem e a pessoa conclui que
#   perdeu permissão) e selo "Somente leitura" no card da lista de Pacientes.
#   🔴 **O PACIENTE INATIVO CONTINUA NA FILA DO PLANTÃO — só SEM AÇÃO** (decisão do
#   usuário; a primeira versão o excluía da fila e foi revertida). Sumir com ele
#   esconderia da equipe que aquele tratamento existe e ficou parado. As duas
#   `listarParaExecucao` passaram a devolver **`animalInativo`** em cada linha, e a tela
#   apaga Executar/Aplicar e Cancelar, deixando Ver e Imprimir, com o selo "Somente
#   leitura" (Execução de Prescrição E Painel Principal).
#   ⚠️ **SUPERADO EM PARTE por 2026-09-05**: em `/execucao-prescricao` a linha do
#   paciente inativo saiu da FILA "a executar" e desce para o HISTÓRICO, na aba
#   "Paciente inativo". Ele NÃO some do plantão — muda de lugar. O que continua
#   valendo aqui: o backend devolve a linha (não filtrar lá), Ver e Imprimir ficam, e
#   Executar/Cancelar não são renderizados. O Painel Principal não mudou.
#   ⚠️ Os DOIS modais de execução resolvem `soLeitura`/`soLeituraGrupo` por conta
#   própria (`soVisualizacao || animalInativo`): eles são reusados por outras telas, e
#   fiar-se só no botão da fila deixaria um caminho novo reabrir a ação que o backend
#   recusa com 400.
#   ⚠️ `animalInativo` é lido por SQL cru (`lerInativosEmLote`), não pelo `where` do
#   Prisma: `Animal.inativo` é lida assim em todo o projeto porque o client pode não
#   estar regenerado (§11), e `where` com campo desconhecido derruba a fila inteira.
#   🔴 **FATURA PAGA TAMBÉM É SOMENTE LEITURA** (mesmo pedido). Item de fatura paga já
#   era recusado (`FATURA_PAGA`), mas `atualizarStatus` deixava voltar PAGA → ABERTA, e
#   daí tudo era editável de novo — a porta dos fundos do bloqueio inteiro. Agora sair
#   de PAGA é ato de **GESTOR** e vai para a AUDITORIA (`ALTERACAO`/`FATURA`).
#   ⚠️ Reabrir NÃO foi proibido de todo: sem saída, um clique errado em "Marcar como
#   Pago" congelaria a cobrança para sempre — pior que o problema. É a mesma escolha da
#   reativação do paciente (só o gestor). Faixa verde na tela + "Reabrir" só para o
#   gestor; `ENTIDADE_LABEL` da Auditoria ganhou FATURA e FATURA_ITEM.
#   **SEM MIGRATION** — as colunas são as de `20260818000000_animal_inativo`.
#   GATE ESTRUTURAL novo: `__tests__/pacienteInativo.test.js` varre o CÓDIGO dos
#   controllers e reprova o handler de escrita sem o guard — o modo de quebrar esta
#   regra é ESQUECER o guard num caminho novo, e o sintoma é silencioso. Handler de
#   escrita novo: acrescente-o à lista E ponha o guard nele. Suíte: 352.)
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
# Atualizado em: 2026-09-02 (parte 2) (`podeVerMedicamentos`/`podeVerProcedimentos`
#   da Sidebar — decisão de produto que estava em aberto desde 2026-07-31 —
#   RESOLVIDA: assumido ADMIN-only, as duas variáveis mortas foram removidas.
#   Ver a entrada da sessão 2026-07-31, marcada concluída.)
# Atualizado em: 2026-09-01 (parte 2) (Mesma justificativa OBRIGATÓRIA na
#   INATIVAÇÃO, estendida a Estoque de Vacinas e Estoque de Farmácia
#   (`EstoqueVacinaController.toggle`/`EstoqueController.toggle`) — a lib
#   `lib/cadastroAtivacao.js` já suportava as tabelas 'lote_vacina'/
#   'estoque_farmacia' de propósito, então foi só ligar o mesmo fio: coluna
#   `inativo_motivo` nas duas tabelas, `ModalJustificativa` antes do toggle (só
#   ao inativar) e coluna "Justificativa" na aba Inativos de `EstoqueVacina.tsx`/
#   `Farmacia.tsx`. 🔴 Migration GERADA
#   (`20260901000001_justificativa_inativacao_estoque`), NÃO aplicada.)
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
# Atualizado em: 2026-08-31 (Execução de Prescrição: card do item mostra o
#   HISTÓRICO de aplicações dentro da própria execução — Periodicidade+Dose em
#   vermelho, uma linha "Aplicação (DD/MM) — Executada" por dose já dada e a linha
#   de AGORA com "Em Execução" + botão; datas via `gerarResumoDoses`+`dataDoDiaISO`,
#   sem chamada nova ao backend. "1x na semana" ganhou rótulo "Qtd. Semanas" no
#   formulário de prescrição; Hora Início perdeu o ícone e os 4 campos da linha
#   Frequência/Hora/Qtd/Data ganharam `whitespace-nowrap` para não desalinhar.
#   Ação Finalizar REMOVIDA dos ícones de ação da Evolução — junto com todo o
#   código que só existia para ela, ver §12)
# Atualizado em: 2026-08-31 (Prescrição: frequências "1x a cada N dias" — o campo
#   Duração (dias) virou "Qtd. de Vezes" no formulário; internamente segue gravando
#   duracaoDias em DIAS (vezes × intervalo) para o backend continuar contando as
#   doses certas. Hora Início passou a ser OBRIGATÓRIA nessas frequências — sem ela
#   o item cai no fluxo antigo, sem o rolling schedule, e fica "pendente" todo dia
#   da janela em vez de só nas datas certas)
# Atualizado em: 2026-08-31 (Prescrição/Exames/Vacina: colunas Nº|Data Início|Data Fim
#   no lugar do "Nº X" + "Data" único; Vacina reordenada p/ Nº|Aplicação|Vacina|...;
#   ordem/cor de ícone virou regra ÚNICA nestas 3 telas — Alterar(laranja) primeiro,
#   Visualizar(verde), Imprimir(azul), WhatsApp(verde)/E-mail(azul) quando existirem,
#   Cancelar(vermelho) por último; WhatsApp/E-mail que só existiam no card mobile
#   entraram também na tabela desktop de Prescrição e Vacina)
# Atualizado em: 2026-08-31 (Incluir/Editar Membro: checkbox "Atender somente no local
#   de trabalho" — MembroEquipe.restringirPorLocal. Desligada = atende em qualquer
#   local, nada muda. Ligada = lib/animalScope.js restringe a lista de pacientes do
#   profissional aos animais cujo local bate com um dos locais de trabalho DELE
#   configurados para hoje. 🔴 Migration GERADA, confirmar aplicação antes de usar)
# Atualizado em: 2026-08-18 (Vacina ganhou RESERVA de estoque — model novo
#   ReservaEstoqueVacina, espelho de ReservaEstoque/PrescricaoGrupoController: reserva
#   ao finalizar (FEFO), consome ao executar, libera ao cancelar. 🔴 Migration GERADA
#   em prisma/migrations/20260830000000_reserva_estoque_vacina — NÃO aplicada, precisa
#   de `npx prisma migrate deploy` + `npx prisma generate` antes de usar)
# Atualizado em: 2026-08-18 (Vacina: Tipo Dose/Via passaram a ser exigidos ANTES de
#   entrar na lista (não só no Finalizar); corrigido bug real de estoque — cancelar
#   vacina nunca executada inflava o lote; coluna "Justificativa" nas listas de
#   registros cancelados/inativos de todo o módulo Atendimento, com tooltip do texto
#   inteiro — Exame e Encaminhamento resolvidos via AuditLog, sem migration)
# Atualizado em: 2026-08-18 (Evolução: duas consultas do MESMO animal no MESMO dia —
#   ex. Clínica + Dermatologia — voltaram a ser tratadas como atendimentos DISTINTOS
#   mesmo quando o mesmo profissional assume as duas; o bloqueio de "evolução própria
#   já aberta" agora casa por agendamentoId, não pelo animal inteiro)
# Atualizado em: 2026-08-18 (Agendamento: novo status CANCELADO_AUTOMATICAMENTE — a
#   rotina noturna cancela AGENDADO/ATRASADA e agora também EM_ANDAMENTO com dataHora no
#   passado, e é a ÚNICA que grava esse status; o backend recusa como input manual)
# Atualizado em: 2026-08-18 (Execução de Prescrição: Histórico navega por dia (não só
#   "hoje") e a fila Medicamentos×Procedimentos passou a decidir "a executar"×"Histórico"
#   POR TIPO de item, não pelo documento inteiro — corrige item já executado ficando
#   preso/sem ação na fila até o outro tipo também terminar)
# Atualizado em: 2026-08-21 (Prestador: cadastro NOVO e INDEPENDENTE de Fornecedor —
#   tb_prestadores própria, RLS tenant direto igual tb_fornecedores, rota
#   /cadastro/prestadores; correções de UX/bugs em Agendamentos — voz, animais somem
#   por Set vazio truthy, scroll do "Expediente Ativo" resetando — e padronização de
#   modais de cadastro no estilo Tratador/Localização)
# Atualizado em: 2026-08-11 (grupo2corrigir FECHADO: bug real em ExameCompra.tsx (setSelectedAnimal
#   não aceita forma funcional), duplicata inativa de fornecedor ganhou fluxo de "Ativar existente",
#   relatorioNutricional.service.ts do FRONTEND removido — órfão MySQL, nunca importado)
# Atualizado em: 2026-08-04 (Senha: FormularioNovaSenha compartilhado entre a tela da app e o link do e-mail; "esqueci minha senha" volta sozinho ao login com aviso genérico)
# Atualizado em: 2026-08-04 (STORAGE: arquivo no BANCO (bytea) — /uploads e express.static REMOVIDOS; download por /api/midia/:chave autorizado; teto 150 MB; caminho de escala = S3StorageProvider trocando só STORAGE_DRIVER — ver §8)
# Atualizado em: 2026-08-04 (PREMISSA DE AUTORIA: a ação vale sobre o que a pessoa criou ou assumiu, só o gestor opera o de outro; assumir/transferir ARRASTA o atendimento inteiro; auditoria de TRANSFERENCIA e ALTERACAO)
# Atualizado em: 2026-08-02 (Sessão por INATIVIDADE de 2h (lib/sessionTokens.js), rastro de "assumido de quem" na agenda, vacina aplicada pelo proprietário, resultado de exame manual)
# Atualizado em: 2026-07-31 (Shell: header e rodapé globais, busca global por empresa (/api/busca), marca no EmpresaContext, sidebar só com o logo da clínica)
# Atualizado em: 2026-07-29 (Evolução: assumir SÓ a de outro profissional c/ e-mail+WhatsApp, própria aberta continua bloqueando, paralelo por decisão (409) e proibição de antecipar agendamento)
# Atualizado em: 2026-07-25 (Vacina com a lógica da Prescrição: SALVA→FINALIZADA→EXECUTADA — fatura e estoque só na Execução de Prescrição/plantão)
# Atualizado em: 2026-07-25 (Vacina no Atendimento com ciclo SALVA→FINALIZADA, igual a Exames/Encaminhamento — migration 20260729000000)
# Atualizado em: 2026-07-23 (Orçamento: posologia do medicamento (dias+frequência), doses da vacina e item OUTROS lançado direto na fatura; desconto por item na fatura)
# Atualizado em: 2026-07-16 (Listagem de animais base × convidado: base própria vê todos os vínculos incl. co-tratados de outra empresa; convidada = isolamento estrito por empresa; designação de prestador escopada ao contexto)
# Atualizado em: 2026-07-14 (Relatórios com período + Tabela responsiva; expediente de atendimento; autosave de evolução; lembretes WhatsApp; alertas/Monitoração de cron com agenda dinâmica; cookie-dica de sessão)

---

## 1. VISÃO DO PRODUTO

**S2Vet** é uma plataforma hospitalar veterinária modular, mobile-first e AI-ready.

- Foco atual: **módulo nutricional equino**
- Direção futura: plataforma multi-espécie, multi-tenant, enterprise-grade
- Produto SaaS com múltiplos perfis de usuário e controle granular de permissões

### Módulos existentes
| Módulo | Status |
|---|---|
| Autenticação / RBAC | ✅ Implementado |
| Dashboard | ✅ Implementado |
| Gestão de Animais | ✅ Implementado |
| Prontuário Clínico | ✅ Implementado |
| Nutrição / Dietas | ✅ Implementado (foco principal) |
| Exames Nutricionais | ✅ Implementado |
| Exames Clínicos | ✅ Implementado |
| Relatório Nutricional | ✅ Implementado |
| Financeiro (Faturas) | 🟡 Básico |
| Gestão de Equipes | ✅ Implementado |
| Gestão de Empresas | ✅ Implementado |
| Cadastro / Proprietários | ✅ Implementado |
| Cadastro / Tratadores | ✅ Implementado |
| Cadastro / Localizações | ✅ Implementado |
| IA / LLM Integration | ✅ Implementado (Gemini único — memória clínica + IA financeira) |
| Auditoria | 🟡 Básico |
| Admin | 🔲 Planejado |

---

## 2. STACK TECNOLÓGICA

### Frontend
```
React 18 + TypeScript (strict) + Vite
Tailwind CSS + shadcn/ui + Lucide Icons
TanStack Query (React Query)
React Hook Form + Zod
react-i18next (i18n preparado)
```

### Backend
```
Node.js + Express
Prisma ORM
PostgreSQL (produção) / SQLite (dev)
JWT + Refresh Tokens
Google OAuth (useGoogleLogin — fluxo access_token + credential)
```

### Infra atual
```
Frontend: Cloudflare Tunnel (HTTPS real em dev, domínio *.trycloudflare.com)
Backend: porta 3001
Proxy Vite: /api → http://localhost:3001
Docker: Dockerfile presente no backend
Schema PostgreSQL: schs2vet
```

### IA
```
Provider único: Google Gemini (texto, visão e áudio) — src/ai/geminiClient.ts
Modelo: GEMINI_MODEL (default gemini-3.1-flash-lite)
AiUsageLog: modulo, modelo, provedor, tokensEntrada/Saida/Total, custoUsd, latenciaMs
```

---

## 3. ESTRUTURA DE PASTAS

```
nutricao-equina-super/
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/        # Componentes reutilizáveis globais
│   │   ├── contexts/          # React Contexts (Auth, Theme, etc)
│   │   ├── hooks/             # Custom hooks reutilizáveis
│   │   ├── modules/           # Módulos de domínio (nutrition, clinic, etc)
│   │   ├── pages/             # Páginas roteadas
│   │   ├── services/          # API clients e integrações
│   │   ├── utils/             # Utilitários puros
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── components.json        # shadcn/ui config
│
└── backend/
    ├── src/
    │   ├── config/            # Configurações centralizadas
    │   ├── controllers/       # Request handlers (enxutos)
    │   ├── middlewares/       # Auth, RBAC, error handling, etc
    │   ├── models/            # Tipos e interfaces de domínio
    │   ├── routes/            # Definição de rotas Express
    │   ├── seeds/             # Seeds organizados por domínio
    │   └── services/          # Regras de negócio
    ├── prisma/
    │   └── schema.prisma
    ├── uploads/               # ⚠️ Temporário — abstrair para storage cloud-agnostic
    ├── prismaClient.ts        # ⚠️ Mover para src/lib/prisma.ts
    └── Dockerfile
```

### ⚠️ Itens a normalizar (dívida técnica conhecida)
| Item | Problema | Ação |
|---|---|---|
| `frontend/services/` (raiz) | Pasta vazia fora do src | Remover |
| `backend/prismaClient.ts` (raiz) | Fora do src | Mover para `src/lib/prisma.ts` |
| `backend/uploads/` | Storage local sem abstração | Criar StorageProvider |
| `backend/src/server.js` | JavaScript puro | Migrar para TypeScript |
| `backend/src/test-nutricao.js` | Arquivo de teste solto | Mover para `scripts/` ou remover |
| `frontend/src/App copy.tsx` | Arquivo residual | Remover |
| `backend/seed.js` (raiz) | Fora de scripts/ | Mover para `scripts/` |
| `backend/test-relatorio.js` (raiz) | Fora de scripts/ | Mover para `scripts/` |

---

## 4. AUTENTICAÇÃO E RBAC

### Roles disponíveis
```typescript
type UserType = 'ADMIN' | 'VETERINARIO' | 'PROPRIETARIO' | 'ESTAGIARIO' | 'FORNECEDOR'
// FORNECEDOR: usuário externo (prestador de serviços). Cargo na equipe: PRESTADOR.
```

### Hierarquia de níveis de permissão (MatrizPerfil / PermissaoMembro)
```
NEGADO (-1) < NENHUM (0) < LEITURA (1) < PROPRIO (2) < EQUIPE (3) < FULL (4)
NEGADO: bloqueio explícito — sobrepõe qualquer nível positivo em qualquer equipe (deny-wins)
GESTOR: bypass total — não consulta MatrizPerfil
ADMIN: bypass total — não consulta permissões
```

### Cargos na equipe (PerfilEquipe)
```
GESTOR        → userType VETERINARIO, bypass total
VETERINARIO  → userType VETERINARIO, usa MatrizPerfil padrão VET
ESTAGIARIO   → userType ESTAGIARIO
ENFERMEIRO / SECRETARIA / FINANCEIRO → userType ESTAGIARIO
FORNECEDOR   → userType FORNECEDOR (externo). Login amarrado a `tb_fornecedores`.
PRESTADOR    → userType FORNECEDOR (externo, ex: fisioterapeuta, ferrador).
               Login amarrado a `tb_prestadores`.
PROPRIETARIO → perfil de SISTEMA — não pode ser atribuído a membros de equipe;
               permissões lidas de MatrizPerfil[perfilSlug='PROPRIETARIO'] das equipes
               vinculadas ao proprietário via Animal.empresaId → Equipe
```
🔴 **ELES NÃO FAZEM PARTE DA EQUIPE** (2026-09-09, parte 2). São ATUAÇÕES ESTANQUES:
não aparecem na tela Equipe, no Controle de Acesso nem na grade da Agenda, e são criados
e geridos nos PRÓPRIOS cadastros + Designações. O `MembroEquipe` deles continua
existindo, mas como **CARTÃO DE ACESSO emitido pelo cadastro** (`lib/acessoExterno.js`)
— sem ele não há RBAC nenhum. Filtro da listagem: `SEM_EXTERNOS`.

🔴 **FORNECEDOR e PRESTADOR são DOIS cargos e UM comportamento** (2026-09-09).
`PRESTADOR` nasceu depois e **nada foi migrado**: quem já estava cadastrado segue
`FORNECEDOR`. Para o sistema os dois são o MESMO profissional externo — escopo por
`DesignacaoPrestador`, só a própria agenda, permissão por `PermissaoMembro` e destino
de encaminhamento. O que muda é apenas o CADASTRO a que o login se amarra.
⚠️ **Comparação de cargo que signifique "é prestador externo" passa por
`lib/cargosPrestador.js`** (`ehCargoPrestador` / `membroEhPrestador` /
`OR_CARGO_PRESTADOR`) — nenhum `cargo === 'FORNECEDOR'` novo no código. Um cargo que a
tela oferece e que o gate não conhece devolve ao PRESTADOR a base de pacientes inteira,
em silêncio. Há gate estrutural (`__tests__/cargoPrestador.test.js`).
⚠️ `userType === 'FORNECEDOR'` CONTINUA correto e é intencional: `CARGO_PARA_TIPO`
mapeia os DOIS cargos para esse userType, e é isso que faz todo gate escrito contra
`userType` valer para ambos sem alteração.

### ControleAcesso — abas disponíveis para GESTOR (5 abas)
```
1. Matriz de Perfis  — edita níveis por perfil (VETERINARIO/ESTAGIARIO/PRESTADOR/PROPRIETARIO)
                       itens com locked=true são imutáveis (definidos pelo ADMIN global)
2. Equipe            — lista membros VET/EST/PRESTADOR; inclui via 2 passos:
                       passo 1: tipo (VETERINÁRIO|ESTAGIÁRIO|FORNECEDOR)
                       passo 2: FORNECEDOR → busca lista /equipes/:id/fornecedores
                                outros → formulário email/nome
3. Proprietários     — lista proprietários da empresa (read-only)
4. Convites          — lista convites enviados; cancela PENDENTE não expirado
5. Logs de Auditoria — (desktopOnly: true) — TabMatriz tem desktopOnly: true
```

### Fluxo de Auth
```
Login email/senha → JWT → /api/users/me → enriquece AuthContext
Login Google → useGoogleLogin (prompt: 'select_account') → credential ou access_token
JWT payload: { id, email, fullName, userType, mustChangePassword }
Refresh: via /api/users/me
```

### Regras de permissão relevantes
- Vet pode buscar animal por nome e verificar `vetDaMinhaEquipe`
- Vinculação animal-vet requer aprovação do proprietário via email + `approvalToken`
- `mustChangePassword` bloqueia acesso até troca de senha

### Regras de autoria em registros clínicos (evolução, prescrição, vacina, exame, encaminhamento)

**Regra 1 — Edição (editar/salvar):** ✅ Implementado em 2026-06-24
```
GESTOR     → pode editar qualquer registro da equipe (bypass total via req.membroCargo === 'GESTOR')
Todos os demais (VET, ESTAGIARIO, FORNECEDOR, etc.)
           → só podem editar registros que eles próprios criaram (veterinarioId === req.user.id)
```
**Implementação:** `req.membroCargo` setado como `'GESTOR'` pelo `checkPermission` em todos os
bypass paths (dono de empresa, membro com cargo GESTOR). Controllers verificam:
`if (req.membroCargo !== 'GESTOR' && item.veterinarioId !== req.user.id) → 403`
Aplicado em: `EvolucaoController.atualizar`, `PrescricaoController.atualizar`,
`ExameClinicoController.atualizar`, `EncaminhamentoController.atualizar`.
VacinaClinica: campo `status` (SALVA|FINALIZADA) adicionado (migration `20260729000000`) — ver seção do ciclo de vida da vacina.

**Regra 2 — Finalização (finalizar):** ✅ Implementado em 2026-06-24
```
GESTOR     → pode finalizar qualquer registro da equipe (bypass total via checkPermission)
FORNECEDOR → pode finalizar apenas registros que ele próprio criou (veterinarioId check no controller)
VET / ESTAGIARIO / outros → BLOQUEADOS (nível NENHUM no seed → 403 em checkPermission)
```

**Relação entre as duas regras:**
- Regra 1 (editar) é mais ampla: VET também é bloqueado de editar registros de outros (exceto GESTOR).
- Regra 2 (finalizar) tem restrição adicional sobre quem pode executar a ação: VET não pode finalizar nada,
  só GESTOR e FORNECEDOR (o próprio). A Regra 1 não exclui VET de finalizar — ela não se aplica a finalizar.
- As duas regras se combinam: um FORNECEDOR pode editar e finalizar itens que criou; não pode tocar em itens de outros.

### Fluxo de VÍNCULO vet-animal (VINCULO)
```
Proprietário associa vet → cria VetAnimalSolicitacao {tipo:'VINCULO', status:'PENDENTE'}
Email enviado ao vet com links aceitar/recusar (approvalToken)
Vet responde (dashboard ou email) → status → 'ACEITO' ou 'RECUSADO'
24h sem resposta → cron auto-aceita (status→'ACEITO')
Proprietário notificado via polling (useProprietarioNotificacoes, 15s)
```

### Fluxo de DESVINCULO vet-animal (DESVINCULO)
```
Proprietário remove vet → MESMO registro VetAnimalSolicitacao atualizado:
  {tipo:'DESVINCULO', status:'PENDENTE', approvalToken, expiresAt}
Email enviado ao vet: "Aceitar remoção" / "Manter meu acesso" (24h expiry)
Vet aceita  → status:'ACEITO'  → vet não aparece mais como responsável + veterinarioNome=null
Vet recusa  → registro restaurado: {tipo:'VINCULO', status:'ACEITO', mensagem:null}
24h sem resposta → cron auto-aceita (remoção confirmada) + veterinarioNome=null
Proprietário notificado via useProprietarioNotificacoes (15s polling)
NOTA: unique constraint (animalId, vetUserId) — só existe 1 registro por par, que é reutilizado
```

### Endpoints de solicitações
- `GET   /api/animais/minhas-solicitacoes` — proprietário: polling de status (inclui vetUserId, solicitanteId)
- `PATCH /api/animais/solicitacoes/:id/responder` — proprietário responde convite V→P (body: {status})
- `POST  /api/animais/proprietario/aprovar` — proprietário aprova/recusa via token de email (body: {token, acao})
- `GET   /api/veterinarios/solicitacoes?status=PENDENTE` — vet: lista pendentes (inclui tipo, solicitanteId)
- `PATCH /api/veterinarios/solicitacoes/:id` — vet aceita/recusa (body: {status})
- `GET   /api/veterinarios/solicitacoes/responder-email?token=X&acao=aceitar` — vet responde via email
- `POST  /api/veterinarios/solicitar-vinculo` — vet inicia V→P (body: {animalId})

---

## 5. BANCO DE DADOS

### Schema: `schs2vet` (PostgreSQL)

### Entidades principais
```
User              → usuários (todos os roles)
                    Campos extras de proprietário: cpf?, cnpj?, mensalista (Boolean), valorAssistencia (Float?),
                    frequenciaVisitas (Int? 1-7), isConvidado (Boolean)
Animal            → animais cadastrados
Especie / Raca    → taxonomia
Especialidade     → catálogo de especialidades POR espécie (tb_especialidades) — fonte única
                    (substitui a lista fixa frontend/utils/subespecialidades.ts). unique(nome, especieId).
                    Seed: backend/scripts/seedEspecialidades.js (72 itens: Equino/Canino/Felino/Bovino/Réptil).
                    Rota GET /api/especialidades?especieIds=1,2 (EspecialidadeController). Migration 20260717000000.
UsuarioEspecialidade    → especialidades do usuário (VET/FORNECEDOR c/ login). unique(userId, especialidadeId).
FornecedorEspecialidade → especialidades do cadastro Fornecedor. unique(fornecedorId, especialidadeId).
                    Fornecedor.tipoServico (VARCHAR 50, legado) é DERIVADO do nome da 1ª especialidade.
                    Multi-especialidade em: Cadastro Pessoal (UsuarioEspecialidade — VET e FORNECEDOR),
                    Novo Fornecedor (FornecedorEspecialidade), Novo Membro (UsuarioFormModal → incluir-membro).
                    Filtro por "espécies que a empresa atende" (EmpresaConfiguracao.especiesAtendidas, CSV de
                    IDs, configurado em /configuracoes) via GET /api/equipes/especies-atendidas (qualquer membro).
                    No Cadastro Pessoal do convidado o filtro usa as espécies da empresa; no cadastro direto
                    do vet usa as espécies que ele atende. Componente reutilizável: EspecialidadeSelector.tsx.
                    Agenda (Agendamentos.tsx) lê especialidades do catálogo (fallback p/ VetSubespecialidade legado).
Prestador         → catálogo de PRESTADORES de serviço (tb_prestadores) — cópia da FORMA de
                    Fornecedor (nome, CPF/CNPJ, contato, tiposServico — VÁRIOS, CSV em
                    `tipo_servico` VARCHAR(255) desde 2026-09-15 —, endereço,
                    tipoEntrada SYSTEM|CLIENTE, empresaId/equipeId SEM FK) mas TABELA e RLS PRÓPRIAS
                    (migration 20260821000000, decisão explícita: entidade independente, não view/
                    filtro sobre Fornecedor). RLS tenant direto igual tb_fornecedores (policy
                    `empresa_id = app_empresa_id() OR app_empresa_id() IS NULL`). Sem especialidade
                    por catálogo (FornecedorEspecialidade) nem vínculo a User — é um cadastro mais
                    simples, sem a integração com login/estoque que Fornecedor tem.
                    Controller/rotas: PrestadorController.js + routes/prestadores.js, mesmo padrão
                    de FornecedorController (verificarDuplicidade por CPF ou nome+tipo+telefone,
                    podeAlterarRegistroEscopado de lib/cadastroScopeAccess.js). Slugs
                    `cadastro.prestador.*` (seed 002, mesmos defaults por perfil que `cadastro.
                    fornecedor.*`). Front: CadastroPrestador.tsx (cópia de CadastroFornecedor.tsx,
                    sem EspecialidadeSelector — tipo de serviço é select simples), rota
                    /cadastro/prestadores, entrada própria no Sidebar (não reaproveita a de
                    Fornecedores).
Alimento          → banco de alimentos
Nutriente         → banco de nutrientes
ComposicaoAlimento → composição nutricional por alimento/espécie
ExigenciasNRC     → exigências nutricionais por peso/categoria/exercício
Dieta             → itens de dieta atribuídos a animal
PlanoDieta        → agrupamento de itens de dieta
ExameNutricional  → resultados de exames nutricionais
ExameClinico      → exames clínicos solicitados/resultados
EvolucaoClinica   → prontuário/evolução clínica (campos: titulo VARCHAR255, ativo, status)
                    CONCORRÊNCIA (migration 20260922000000): `versao` (trava otimista —
                    a escrita é condicionada à versão que a tela leu; concorrente vira 409,
                    nunca overwrite silencioso) e `autorId` (quem CRIOU, imutável).
                    ⚠️ `veterinarioId` continua sendo o EDITOR/RESPONSÁVEL ATUAL — é ele
                    que `assumir` transfere, e é o que os ~47 leitores esperam. Sem
                    `autorId`, assumir APAGAVA quem abriu o atendimento.
                    LEITURA/ESCRITA das duas colunas: SEMPRE por `lib/concorrenciaRegistro.js`
                    (SQL cru — funciona antes do `prisma generate`).
EvolucaoMidia     → mídias (imagem/vídeo/áudio) anexadas a evoluções (tipo, url, nome, tamanho)
Prescricao        → prescrições médicas (tipo: MEDICAMENTO|PROCEDIMENTO, status: RASCUNHO|ATIVA,
                    dosagem, unidade, via, frequencia, duracaoDias, horaInicio,
                    horariosGerados: JSONB, diasAplicacaoInicio, diasAplicacaoFim)
VacinaClinica     → registro de vacinas (status: SALVA|FINALIZADA|EXECUTADA — mesma lógica da
                    Prescrição: fatura + débito de estoque só na EXECUÇÃO, ver seção do fluxo da vacina)
EncaminhamentoClinico → encaminhamentos (prestadorId: User FORNECEDOR da equipe, null = destino externo;
                    status PENDENTE|CONCLUIDO|CANCELADO; urgencia NORMAL|ALTA|URGENTE)
AgendamentoClinico → agendamentos do animal (tb_agendamentos_clinicos) — tipo CONSULTA|VACINA|
                    RETORNO|EXAME|PROCEDIMENTO, status AGENDADO|CONCLUIDO|CANCELADO, dataHora,
                    veterinarioId?, criadoPorId?. Gerenciado por ADMIN/VETERINARIO/ESTAGIARIO;
                    PROPRIETARIO/FORNECEDOR só visualizam. Migration 20260611190000.
DesignacaoPrestador → escopo de acesso do prestador por animal (tb_designacoes_prestador)
                    unique(animalId, prestadorId, equipeId); criada/reativada ao encaminhar para
                    prestador da equipe; inativada (ativo=false, dataFim) ao concluir/cancelar/excluir
                    o encaminhamento. FORNECEDOR só acessa animais com designação ativa
                    (animalAccess.js + AnimalController.listar) — NUNCA herda escopo de equipe.
                    Fornecedor.userId (unique, nullable) liga o cadastro Fornecedor ao login —
                    fornece o tipoServico (especialidade) do prestador. Migration 20260611170000.
Fatura / FaturaItem → financeiro básico
                    Fatura: animalId? (legado, nullable desde migration 20260605), proprietarioId?,
                    mesReferencia? VARCHAR(7) ex: "2026-06", status (ABERTA|PAGA|CANCELADA|FECHADA)
                    FaturaItem: animalId? (adicionado migration 20260605), tipo VARCHAR(50), veterinarioId?
                    FaturaItem.descontoTipo (PERCENTUAL|VALOR|null) + descontoValor (Float, default 0)
                    [migration 20260725000000] — desconto POR ITEM. O total da fatura é sempre a soma
                    do LÍQUIDO: usar `valorLiquidoItem(item)` / `descontoDoItem(item)` de lib/faturaUtils.js
                    (e `recalcularTotal`) — NUNCA somar `valor * quantidade` à mão, senão o desconto
                    é ignorado. Espelho no front: `totalItem`/`descontoDoItem` em Faturamento.tsx e
                    FaturaExport.ts. `normalizarDesconto(tipo, valor)` valida a entrada (percentual ≤ 100).
                    FaturaItem.orcamentoItemId? → origem: item de orçamento tipo OUTROS lançado na fatura.
Orcamento /       → orçamento (etapa OPCIONAL) por proprietário — tb_orcamentos / tb_orcamento_itens
OrcamentoItem       (migration 20260723000000). Item tipo PROCEDIMENTO|COMBO|MEDICAMENTO|VACINA|OUTROS.
                    MEDICAMENTO: `dias` + `frequencia` (posologia orçada; quantidade = dias ×
                    aplicações/dia) voltam preenchidos na importação para a Prescrição.
                    VACINA: `quantidade` é o nº de DOSES (unidade 'dose').
                    OUTROS (migration 20260725000000): cobrança avulsa com 3 campos (nome, qtd de vezes,
                    valor). É RATEADO POR ANIMAL como os demais tipos — uma linha por animal
                    selecionado (corrigido em 2026-07-30; antes forçava `animalId: null` no
                    `addItem` do front e ignorava a seleção, impedindo cobrar taxa/transporte por
                    paciente). Para deixá-lo no nível do proprietário, use o checkbox "Não
                    selecionar animais" — que vale para TODOS os tipos, não só OUTROS.
                    O backend nunca impôs a restrição: `criar` e `lancarNaFatura` sempre gravaram o
                    `animalId` recebido, então o FaturaItem já sai atribuído ao animal.
                    NÃO entra na importação
                    clínica (`TIPOS_CLINICOS` exclui OUTROS) — depois de ACEITO vai DIRETO para a fatura
                    em Financeiro > Faturamento, pelo botão "Importar do orçamento".
                    `importadoEm` do OUTROS = lançado na fatura.
                    ⚠️ **A trava "só depois que os demais itens do orçamento forem importados numa
                    evolução" foi REMOVIDA em 2026-08-01** (existia no modal E em `lancarNaFatura`).
                    Ela prendia o OUTROS para SEMPRE: `importadoEm` do item clínico só é gravado
                    quando alguém o importa numa prescrição/vacina, e importar é OPCIONAL — o
                    orçamento inteiro é etapa opcional. Vet que atendeu sem importar, ou que orçou
                    3 animais e atendeu 1, ficava sem NENHUMA saída para cobrar a taxa/transporte.
                    A pendência virou AVISO no modal (`pendentesClinicos`), nunca bloqueio.
                    NUNCA reintroduzir bloqueio sem um caminho de escape na tela.
Tratador          → responsável pelo animal (nome, telefone, localTrabalho, ativo, empresaId)
RelatorioSalvo    → relatórios nutricionais persistidos
DocumentoTemplate → modelo de documento da Central de Documentos (tb_documento_templates,
                    migration 20260918000000). CATÁLOGO MISTO: `empresaId` NULO = modelo
                    GLOBAL do sistema (os 12 anexos da Res. CFMV 1.321/2020, semeados por
                    `seeds/006_documentos_cfmv.seed.js` e idempotentes por `chave`);
                    preenchido = modelo daquela clínica.
                    🔴 COPY-ON-WRITE: a policy lê global+próprio mas só ESCREVE o próprio
                    (mesma assimetria de `tb_medicamentos`). Alterar/favoritar um global
                    NÃO altera o global — cria a cópia da empresa (`origemId` aponta para
                    a origem) e a resposta traz `copiado: true`; quem chama ADOTA o id
                    devolvido. Excluir global → 400 `MODELO_DO_SISTEMA`.
                    `blocos` é JSONB (`Bloco[]` de modules/documentos/types.ts): o bloco
                    nunca é consultado por campo, é lido e gravado inteiro.
DocumentoEmitido  → documento entregue ao cliente (tb_documentos_emitidos). TENANT DIRETO.
                    SNAPSHOT: guarda os blocos com as variáveis JÁ RESOLVIDAS por
                    `lib/documentoVariaveis.js` — editar o modelo depois não reescreve o
                    papel que o cliente recebeu. `numero` é sequência POR EMPRESA
                    (DOC-0001), sorteada na transaction da emissão. `evolucaoId` é
                    OPCIONAL (atestado e TCLE existem sem atendimento aberto), e é por
                    isso que o recorte dele é por `empresaId`, não por escopo clínico.
                    Entra no Histórico do paciente e na Memória Clínica com ref
                    `documento-<id>`.
AuditLog          → log de ações dos usuários
AiUsageLog        → rastreabilidade de uso de IA (inclui `modulo` — quem chamou a LLM)
VetPerfil         → perfil estendido do veterinário (CRMV, bio)
VetEspecie        → especialização do vet por espécie
VetSubespecialidade → subespecialidades do vet
VetAnimalSolicitacao → vínculo/desvinculo vet-animal (tipo: 'VINCULO'|'DESVINCULO', approvalToken, expiresAt)
Empresa           → clínicas/empresas cadastradas
                    Gestor pode ter VÁRIAS empresas. unique(ownerId, nome, cnpj).
                    🔴 **DOCUMENTO (CPF/CNPJ) É OBRIGATÓRIO E ÚNICO ENTRE EMPRESAS** (2026-08-16,
                    migration `20260816100000`): `@@unique([documento])`. A empresa é o TENANT que
                    assina o SaaS e o documento é o que a identifica — duas linhas com o mesmo CNPJ
                    são duplicata, não filial. Isto REVERTE, para o documento, a decisão de
                    2026-06-11 que derrubou o unique global de `cnpj` (aquela existia porque o
                    GESTOR criava as próprias empresas; desde 2026-08-06 só o ADMIN cria, com plano
                    e gestores). unique(ownerId, nome, cnpj) continua, só é mais fraco.
                    ⚠️ O MESMO dado mora em DUAS colunas: `cnpj` (LEGADO, lido por ~60 pontos) e
                    `documento`/`tipoDocumento` (cadastro fiscal). Quem grava preenche AS DUAS com
                    os mesmos dígitos, e a checagem de unicidade olha as duas — preencher só uma
                    deixa a outra livre para receber o mesmo documento de novo.
                    LEITURA/ESCRITA: SEMPRE por `lib/documentoEmpresa.js` (`normalizarDocumento` /
                    `empresaComDocumento` / `resolverDocumento`). Valida o TAMANHO (11=CPF,
                    14=CNPJ), NÃO o dígito verificador — endurecer rejeitaria a base de teste.
                    Aplicado em `EquipeController.criarEmpresa` (+ telefone obrigatório) e em
                    `EmpresaCadastroController.salvar` — fechar só a criação seria garantia falsa:
                    daria para criar com um documento e trocar pelo de outra empresa no cadastro
                    fiscal. NULL fica fora do índice (Postgres), o que preserva a empresa legada.
                    ⚠️ PENDENTE: `setup`, `convidarGestorAdmin`, `EquipeService.criarEmpresaEEquipe`
                    e o bootstrap de `garantirEquipePadrao` ainda criam empresa SEM documento —
                    são caminhos do modelo ANTIGO (gestor criava a própria empresa) e não têm campo
                    onde coletá-lo. Decidir se são aposentados antes de exigir o documento neles.
                    Empresa pessoal (cnpj null): unique do PG não cobre (NULLs distintos) — app
                    bloqueia em criarEmpresa/setup/convidarGestorAdmin/criarEmpresaEEquipe (insensitive)
Equipe            → equipes dentro de uma empresa — unique(empresaId, nome)
MembroEquipe      → membros de cada equipe
ConviteEquipe     → convites para entrar em equipes
ModuloSistema     → catálogo estático de módulos/submodulos/ações (slug único, label, ordemExib)
                    Populado via seed.js (upsert). Ver tabela completa abaixo.
PermissaoMembro   → permissão por membro+módulo dentro de uma equipe
                    nivel: NENHUM|LEITURA|PROPRIO|EQUIPE|FULL
                    unique(equipeId, userId, moduloSlug)
PerfilEquipe      → perfis/cargos por equipe (GESTOR, VETERINARIO, ESTAGIARIO, PRESTADOR, PROPRIETARIO + customizados)
                    PROPRIETARIO é perfil de sistema — não pode ser excluído nem atribuído a membros da equipe
                    PRESTADOR → maps to userType FORNECEDOR (usuário externo da empresa)
MatrizPerfil      → template de permissões por perfil — propagado a membros ao entrar/trocar cargo
                    unique(equipeId, perfilSlug, moduloSlug)
                    locked: Boolean — true = definido pelo ADMIN global, gestor não pode alterar
                    nivel: NENHUM|LEITURA|PROPRIO|EQUIPE|FULL|NEGADO
                    NEGADO = bloqueio explícito; deny-wins sobre outras equipes
AuditoriaPermissao → log imutável de alterações de permissão (quem alterou, nível anterior/novo, motivo, IP)
PermissaoProprietario → legado (mantido, não mais gerenciado pela UI) — substituído por MatrizPerfil PROPRIETARIO
ProfissionalPerfil → cadastro do PROFISSIONAL por EMPRESA (tb_profissional_perfis, migration
                    20260807000000). unique(userId, empresaId). Campos: fullName, phone,
                    cep/endereco/complemento/bairro/cidade/estado, crmv, ativo (na empresa).
                    POR QUÊ: mesma razão do ProprietarioPerfil — `User.email` é único global,
                    então o profissional que atende em 2 clínicas era UMA linha em users:
                    editar telefone/endereço/CRMV na empresa A mudava o cadastro da B, e
                    incluir alguém que já tinha login trazia os dados da outra clínica prontos.
                    REGRA: o mesmo profissional pode ter cadastro em várias empresas e cada um
                    é INDEPENDENTE (nada é pré-carregado ao incluí-lo numa empresa nova). O que
                    permanece compartilhado é só a IDENTIDADE — e-mail, senha, userType e o
                    `ativo` global; no login ele escolhe a empresa no seletor de contexto que
                    já existe.
                    LEITURA/ESCRITA: SEMPRE via `lib/profissionalPerfil.js` (`aplicarPerfil` /
                    `aplicarPerfilEmLista` / `aplicarPerfilEmRelacao`; escrita `salvarPerfil(client,
                    userId, empresaId, dados)` / `garantirPerfil`). Havendo perfil na empresa do
                    contexto ele é AUTORIDADE de todos os seus campos (null = vazio NAQUELA
                    empresa, não cai de volta no User); sem perfil (legado/ADMIN global), lê-se
                    o User. `ativo` efetivo = User.ativo && perfil.ativo.
                    CRMV mora aqui, e não em `VetPerfil.crmv` (que é @unique GLOBAL e não
                    comporta o mesmo profissional cadastrado por duas clínicas); VetPerfil
                    segue existindo para espécies/subespecialidades e para o cron de CRMV.
                    Já aplicado em: EquipeController (incluirMembroDireto/atualizarMembro/
                    listarMembros/listarMembrosPorEquipe) e UserController (getMe/updateMe).
                    ⚠️ PENDENTE: o nome exibido em registros clínicos antigos (evolução,
                    prescrição, histórico, relatórios) ainda vem de `User.fullName` — aplicar
                    `aplicarPerfilEmRelacao` conforme cada tela for tocada.
UsuarioEspecialidade → ganhou `empresaId` (migration 20260807000000; null = vínculo legado) e o
                    unique virou (userId, especialidadeId, empresaId): a especialidade também é
                    POR EMPRESA — o mesmo profissional pode ser ortopedista numa clínica e
                    clínico geral na outra. TODA leitura/escrita filtra por empresa.
ProprietarioPerfil → cadastro do PROPRIETÁRIO por EMPRESA (tb_proprietario_perfis, migration
                    20260724000000). unique(userId, empresaId). Campos: fullName, phone, phone2,
                    cpf, cnpj, cep/endereco/complemento/bairro/cidade/estado, mensalista,
                    valorAssistencia, frequenciaVisitas, diaVencimentoFatura, ativo (na empresa).
                    POR QUÊ: User.email é único global → o mesmo cliente atendido por 2 clínicas é
                    UMA linha em users; sem isto, editar o telefone na empresa A mudava o cadastro
                    da B. O User ficou só como IDENTIDADE (email/senha/ativo global).
                    LEITURA/ESCRITA: SEMPRE via `lib/proprietarioPerfil.js` — havendo perfil na
                    empresa do contexto ele é AUTORIDADE de todos os seus campos (null = vazio
                    naquela empresa, NÃO cai de volta no User); sem perfil (legado/ADMIN global),
                    lê-se o User. `ativo` efetivo = User.ativo && perfil.ativo.
                    Já aplicado em: ProprietarioController (listar/obterPorId/criar/atualizar/
                    removerDaEmpresa), AnimalController (listar/obterPorId/criar), FaturaController
                    (listarProprietarios + FATURA_INCLUDE), OrcamentoController (listar/obter/criar/
                    atualizar/WhatsApp), UserController (getMe/updateMe).
ProprietarioLocalidade → localidades atendidas do CLIENTE, cada uma com a SUA frequência de visitas
                    semanais (tb_proprietario_localidades, migration 20260810000000).
                    unique(userId, empresaId, localizacaoId) — uma frequência por lugar (não há
                    "turno" como no MembroLocalTrabalho do profissional). POR EMPRESA, mesma razão
                    do [[ProprietarioPerfil]]. Ex.: Sociedade Hípica Brasileira 2x/semana + Haras
                    H.P. 3x/semana. O campo único `frequenciaVisitas` (User/ProprietarioPerfil/
                    UsuarioEmpresa) virou AGREGADO — a MAIOR entre as localidades (somar estouraria
                    a escala 1-7 do campo) — e existe só para leituras legadas e para o ADMIN
                    global, que não tem empresa de contexto.
                    LEITURA/ESCRITA: SEMPRE via `lib/proprietarioLocalidades.js`
                    (`normalizarLocalidades`, `anexar`/`anexarEmLista`, `salvarLocalidades`,
                    `frequenciaAgregada`). Acesso por SQL cru parametrizado (mesmo padrão do
                    `isConvidado`/`cadastroConfirmadoEm`): funciona com o client Prisma ainda não
                    regenerado — no Windows o `prisma generate` falha com o backend rodando.
                    Front: repeater em `CadastroProprietario.tsx` reusando o `LocalizacaoCombobox`
                    de `UsuarioFormModal`; ao menos uma localidade é obrigatória (era o que o campo
                    único exigia). Backfill da migration: só o cliente cujos animais ativos estavam
                    num ÚNICO local herdou a frequência antiga — com animais em vários lugares não
                    há como saber a divisão, e chutar produziria um combinado que ninguém acordou.
EmpresaConfiguracao → configuração única por empresa (CNPJ) ou por equipe (empresa pessoal/CPF) —
                    mesmo critério de escopo do EmpresaContext. Campos: logoUrl, tipoFechamento
                    (DIA_FIXO|DIA_UTIL|ULTIMO_DIA_MES|null=compat), diaFechamentoFatura (dia do mês
                    1-31 p/ DIA_FIXO, Nº dia útil 1-10 p/ DIA_UTIL), whatsapp (migration
                    20260710000002 — somente dígitos DDD+número, 10-15, p/ envio/recebimento de
                    mensagens; integração de mensageria ainda não existe). unique(empresaId, equipeId).
                    Gerenciada só por GESTOR/dono via GET/PUT /api/equipes/configuracoes.
                    Expediente de atendimento (migration 20260713020000): diasAtendimento (CSV 0-6),
                    horaInicioAtendimento/horaFimAtendimento (HH:MM) — usados por Agendamentos p/
                    liberar horários; leitura por qualquer membro via GET /api/equipes/horario-atendimento.
                    ⚠️ Expediente e `especiesAtendidas` viraram OBRIGATÓRIOS na tela (2026-08-01):
                    o salvar recusa 400 com dia/hora/espécie vazios. O "vazio = sem restrição"
                    documentado antes só vale para a linha LEGADA que nunca foi salva de novo —
                    os leitores (Agenda, herança de expediente) continuam tratando null como
                    "sem restrição" e NÃO devem passar a exigir o campo.
                    validadeOrcamentoDias (migration 20260813000000): validade do ORÇAMENTO em dias,
                    null = não expira. Lida/gravada SEMPRE por `lib/validadeOrcamento.js` (SQL cru —
                    ver armadilha 41), consumida pelo cron `cancelar_orcamentos_vencidos`.
AgendamentoClinico → (+ migration 20260713010000) lembreteWa1DiaEnviadoEm / lembreteWa2hEnviadoEm
                    (DateTime?) — idempotência dos lembretes de WhatsApp (D-1 e 2h antes).
CronAlertaConfig  → config global dos alertas de cron (linha única): emails (CSV, null=ADMINs),
                    notificarSucesso (Bool), ativo (Bool). Lida ao vivo por lib/cronAlert.js. ADMIN.
CronExecucao      → histórico de execuções relevantes das tarefas (nome, ok, resumo, erro,
                    notificado, executadoEm) p/ a tela de Monitoração. Migration 20260714000000.
CronAgenda        → agenda (horário) editável de cada tarefa: chave (unique), nome, cronExpr, ativo.
                    Reagendamento dinâmico do node-cron (lib/cronManager.js). Migration 20260714010000.
```

### Catálogo de Módulos do Sistema (ModuloSistema)

Gerenciado em `backend/src/seeds/002_permissoes_padrao.seed.js` e sincronizado via `node backend/seed.js`.
Ações disponíveis: `ler`, `criar`, `editar`, `deletar`, `imprimir`, `finalizar`, `executar`, `ativar`, `exportar`, `compartilhar`, `desvincular`, `whatsapp`, `fechar`, `lancar`.
Níveis: NEGADO (-1) < NENHUM (0) < LEITURA (1) < PROPRIO (2) < EQUIPE (3) < FULL (4). GESTOR tem bypass total. NEGADO bloqueia explicitamente e sobrepõe qualquer nível positivo (deny-wins).
ControleAcesso UI mostra colunas: VER, CRIAR, ALTERAR, EXCLUIR, FINALIZAR, IMPRIMIR. Demais ações existem no DB mas não aparecem na UI atual.
ControleAcesso UI suporta nível NEGADO como 3º estado no PermCheck (ciclo NENHUM→EQUIPE→NEGADO→NENHUM, ícone X vermelho).
Perfil PRESTADOR adicionado ao seed (002_permissoes_padrao.seed.js) — todos os módulos com nível NENHUM por padrão.

| Módulo | Submódulo | Slug | Ação | VET padrão | EST padrão |
|---|---|---|---|---|---|
| cadastro | proprietario | `cadastro.proprietario.ler` | ver | EQUIPE | EQUIPE |
| cadastro | proprietario | `cadastro.proprietario.criar` | criar | PROPRIO | NENHUM |
| cadastro | proprietario | `cadastro.proprietario.editar` | alterar | PROPRIO | NENHUM |
| cadastro | proprietario | `cadastro.proprietario.deletar` | excluir | NENHUM | NENHUM |
| cadastro | proprietario | `cadastro.proprietario.ativar` | ativar/inativar | PROPRIO | NENHUM |
| cadastro | tratador | `cadastro.tratador.ler` | ver | EQUIPE | EQUIPE |
| cadastro | tratador | `cadastro.tratador.criar` | criar | PROPRIO | NENHUM |
| cadastro | tratador | `cadastro.tratador.editar` | alterar | PROPRIO | NENHUM |
| cadastro | tratador | `cadastro.tratador.deletar` | excluir | PROPRIO | NENHUM |
| cadastro | tratador | `cadastro.tratador.ativar` | ativar/inativar | PROPRIO | NENHUM |
| cadastro | fornecedor | `cadastro.fornecedor.ler` | ver | EQUIPE | EQUIPE |
| cadastro | fornecedor | `cadastro.fornecedor.criar` | criar | PROPRIO | NENHUM |
| cadastro | fornecedor | `cadastro.fornecedor.editar` | alterar | PROPRIO | NENHUM |
| cadastro | fornecedor | `cadastro.fornecedor.deletar` | excluir | NENHUM | NENHUM |
| cadastro | fornecedor | `cadastro.fornecedor.ativar` | ativar/inativar | PROPRIO | NENHUM |
| cadastro | localizacao | `cadastro.localizacao.ler` | ver | LEITURA | LEITURA |
| cadastro | localizacao | `cadastro.localizacao.criar` | criar | LEITURA (como CLIENTE) | NENHUM |
| dashboard | geral | `dashboard.geral.ler` | ver | EQUIPE | LEITURA |
| dashboard | geral | `dashboard.geral.imprimir` | imprimir | EQUIPE | NENHUM |
| animais | animais | `animais.ler` | ver | EQUIPE | EQUIPE |
| animais | animais | `animais.criar` | criar | EQUIPE | NENHUM |
| animais | animais | `animais.editar` | alterar | EQUIPE | NENHUM |
| animais | animais | `animais.deletar` | excluir | PROPRIO | NENHUM |
| animais | animais | `animais.imprimir` | imprimir | EQUIPE | NENHUM |
| animais | animais | `animais.desvincular` | desvincular vet | PROPRIO | NENHUM |
| atendimento | evolucoes | `atendimento.evolucoes.ler` | ver | EQUIPE | EQUIPE |
| atendimento | evolucoes | `atendimento.evolucoes.criar` | criar | PROPRIO | NENHUM |
| atendimento | evolucoes | `atendimento.evolucoes.editar` | alterar | PROPRIO | NENHUM |
| atendimento | evolucoes | `atendimento.evolucoes.deletar` | excluir | PROPRIO | NENHUM |
| atendimento | evolucoes | `atendimento.evolucoes.imprimir` | imprimir | EQUIPE | NENHUM |
| atendimento | evolucoes | `atendimento.evolucoes.finalizar` | finalizar | PROPRIO | NENHUM |
| atendimento | prescricoes | `atendimento.prescricoes.ler` | ver | EQUIPE | EQUIPE |
| atendimento | prescricoes | `atendimento.prescricoes.criar` | criar | PROPRIO | NENHUM |
| atendimento | prescricoes | `atendimento.prescricoes.editar` | alterar | PROPRIO | NENHUM |
| atendimento | prescricoes | `atendimento.prescricoes.deletar` | excluir | PROPRIO | NENHUM |
| atendimento | prescricoes | `atendimento.prescricoes.imprimir` | imprimir | PROPRIO | NENHUM |
| atendimento | prescricoes | `atendimento.prescricoes.finalizar` | finalizar | PROPRIO | NENHUM |
| atendimento | vacinas | `atendimento.vacinas.ler` | ver | EQUIPE | EQUIPE |
| atendimento | vacinas | `atendimento.vacinas.criar` | criar | PROPRIO | NENHUM |
| atendimento | vacinas | `atendimento.vacinas.editar` | alterar | PROPRIO | NENHUM |
| atendimento | vacinas | `atendimento.vacinas.deletar` | excluir | PROPRIO | NENHUM |
| atendimento | vacinas | `atendimento.vacinas.imprimir` | imprimir | EQUIPE | NENHUM |
| atendimento | vacinas | `atendimento.vacinas.finalizar` | finalizar | PROPRIO | NENHUM |
| atendimento | encaminhamentos | `atendimento.encaminhamentos.ler` | ver | EQUIPE | EQUIPE |
| atendimento | encaminhamentos | `atendimento.encaminhamentos.criar` | criar | PROPRIO | NENHUM |
| atendimento | encaminhamentos | `atendimento.encaminhamentos.editar` | alterar | PROPRIO | NENHUM |
| atendimento | encaminhamentos | `atendimento.encaminhamentos.deletar` | excluir | PROPRIO | NENHUM |
| atendimento | encaminhamentos | `atendimento.encaminhamentos.imprimir` | imprimir | EQUIPE | NENHUM |
| atendimento | exames | `atendimento.exames.ler` | ver | EQUIPE | EQUIPE |
| atendimento | exames | `atendimento.exames.criar` | criar | PROPRIO | NENHUM |
| atendimento | exames | `atendimento.exames.editar` | alterar | PROPRIO | NENHUM |
| atendimento | exames | `atendimento.exames.deletar` | excluir | PROPRIO | NENHUM |
| atendimento | exames | `atendimento.exames.imprimir` | imprimir | EQUIPE | NENHUM |
| atendimento | agendamentos | `atendimento.agendamentos.ler` | ver | EQUIPE | EQUIPE |
| atendimento | agendamentos | `atendimento.agendamentos.criar` | criar | PROPRIO | EQUIPE |
| atendimento | agendamentos | `atendimento.agendamentos.editar` | alterar | PROPRIO | PROPRIO |
| atendimento | agendamentos | `atendimento.agendamentos.deletar` | excluir | PROPRIO | NENHUM |
| enfermagem | prescricao | `enfermagem.prescricao.ler` | ver | EQUIPE | EQUIPE |
| enfermagem | prescricao | `enfermagem.prescricao.executar` | executar | PROPRIO | EQUIPE |
| enfermagem | prescricao | `enfermagem.prescricao.deletar` | cancelar | PROPRIO | NENHUM |
| enfermagem | prescricao | `enfermagem.prescricao.imprimir` | imprimir | EQUIPE | EQUIPE |
| exames | laboratorial | `exames.laboratorial.ler` | ver | EQUIPE | EQUIPE |
| exames | laboratorial | `exames.laboratorial.criar` | criar | PROPRIO | NENHUM |
| exames | laboratorial | `exames.laboratorial.editar` | alterar | PROPRIO | NENHUM |
| exames | laboratorial | `exames.laboratorial.deletar` | excluir | PROPRIO | NENHUM |
| exames | imagem | `exames.imagem.ler` | ver | EQUIPE | EQUIPE |
| exames | imagem | `exames.imagem.criar` | criar | PROPRIO | NENHUM |
| exames | imagem | `exames.imagem.editar` | alterar | PROPRIO | NENHUM |
| exames | imagem | `exames.imagem.deletar` | excluir | PROPRIO | NENHUM |
| nutricao | dietas | `nutricao.dietas.ler` | ver | EQUIPE | EQUIPE |
| nutricao | dietas | `nutricao.dietas.criar` | criar | PROPRIO | NENHUM |
| nutricao | dietas | `nutricao.dietas.editar` | alterar | PROPRIO | NENHUM |
| nutricao | dietas | `nutricao.dietas.imprimir` | imprimir | EQUIPE | NENHUM |
| nutricao | dietas | `nutricao.dietas.compartilhar` | compartilhar | PROPRIO | NENHUM |
| nutricao | dietas | `nutricao.dietas.exportar` | exportar | PROPRIO | NENHUM |
| nutricao | dietas | `nutricao.dietas.ativar` | ativar/inativar | PROPRIO | NENHUM |
| nutricao | relatorios | `nutricao.relatorios.ler` | ver | EQUIPE | EQUIPE |
| nutricao | relatorios | `nutricao.relatorios.criar` | criar | PROPRIO | NENHUM |
| nutricao | relatorios | `nutricao.relatorios.imprimir` | imprimir | EQUIPE | NENHUM |
| nutricao | relatorios | `nutricao.relatorios.exportar` | exportar | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.ler` | ver | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.criar` | criar | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.editar` | alterar | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.imprimir` | imprimir | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.whatsapp` | WhatsApp | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.exportar` | exportar | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.fechar` | fechar fatura | PROPRIO | NENHUM |
| financeiro | faturas | `financeiro.faturas.lancar` | lançar cobrança | PROPRIO | NENHUM |
| equipe | membros | `equipe.membros.ler` | ver | LEITURA | LEITURA |
| equipe | membros | `equipe.membros.editar` | alterar | NENHUM | NENHUM |
| vacina | estoque | `vacina.estoque.ler` | ver | EQUIPE | EQUIPE |
| vacina | estoque | `vacina.estoque.criar` | criar | PROPRIO | NENHUM |
| vacina | estoque | `vacina.estoque.editar` | alterar | PROPRIO | NENHUM |
| vacina | estoque | `vacina.estoque.deletar` | excluir | PROPRIO | NENHUM |
| vacina | estoque | `vacina.estoque.imprimir` | imprimir | EQUIPE | NENHUM |
| farmacia | estoque | `farmacia.estoque.ler` | ver | EQUIPE | EQUIPE |
| farmacia | estoque | `farmacia.estoque.criar` | criar | PROPRIO | NENHUM |
| farmacia | estoque | `farmacia.estoque.editar` | alterar | PROPRIO | NENHUM |
| farmacia | estoque | `farmacia.estoque.ajustar` | ajustar | PROPRIO | NENHUM |
| farmacia | estoque | `farmacia.estoque.deletar` | excluir | PROPRIO | NENHUM |
| farmacia | estoque | `farmacia.estoque.imprimir` | imprimir | EQUIPE | NENHUM |
| farmacia | movimentacoes | `farmacia.movimentacoes.ler` | ver | EQUIPE | EQUIPE |
| farmacia | movimentacoes | `farmacia.movimentacoes.criar` | criar | PROPRIO | NENHUM |
| farmacia | movimentacoes | `farmacia.movimentacoes.imprimir` | imprimir | EQUIPE | NENHUM |
| medicamentos | catalogo | `medicamentos.catalogo.ler` | ver | NENHUM | NENHUM |
| medicamentos | catalogo | `medicamentos.catalogo.criar` | criar | NENHUM | NENHUM |
| medicamentos | catalogo | `medicamentos.catalogo.editar` | alterar | NENHUM | NENHUM |
| medicamentos | catalogo | `medicamentos.catalogo.deletar` | excluir | NENHUM | NENHUM |
| medicamentos | catalogo | `medicamentos.catalogo.imprimir` | imprimir | NENHUM | NENHUM |
| procedimentos | catalogo | `procedimentos.catalogo.ler` | ver | NENHUM | NENHUM |
| procedimentos | catalogo | `procedimentos.catalogo.criar` | criar | NENHUM | NENHUM |
| procedimentos | catalogo | `procedimentos.catalogo.editar` | alterar | NENHUM | NENHUM |
| procedimentos | catalogo | `procedimentos.catalogo.deletar` | excluir | NENHUM | NENHUM |
| procedimentos | catalogo | `procedimentos.catalogo.imprimir` | imprimir | NENHUM | NENHUM |

**Notas:**
- `dietas` não tem `deletar` — soft delete via `ativo` já protegido na camada de service
- `relatorios` não tem `editar`/`deletar` — relatórios são gerados e imutáveis
- `equipe.membros` não tem `criar`/`deletar`/`imprimir` — gerenciado pelo fluxo de convites
- `farmacia.movimentacoes` não tem `editar`/`deletar` — movimentos são imutáveis por auditoria
- `medicamentos` e `procedimentos`: criar/editar/excluir reservados para ADMIN (catálogo global)
- `enfermagem.prescricao.executar`: estagiários têm EQUIPE por padrão (técnicos executam prescrições)
- `enfermagem.prescricao.deletar` (2026-08-01): CANCELAR a prescrição pelo PLANTÃO, em
  `/execucao-prescricao`. Rota `POST /clinica/prescricoes/grupos/:id/cancelar-plantao` — MESMO
  controller (`PrescricaoGrupoController.cancelar`) do cancelar da tela de prescrição, logo mesma
  regra: qualquer execução já feita recusa com 400 `EXECUTADO` (o executado tem FaturaItem e baixa
  de estoque e não pode ficar órfão). Slug PRÓPRIO em vez de reusar
  `atendimento.prescricoes.finalizar` porque quem opera o plantão não tem — nem deveria ter — a
  permissão de quem prescreve. Separado de `executar` de propósito: senão quem aplica o medicamento
  cancelaria o documento do veterinário sem o gestor ter decidido isso. Defaults: GESTOR FULL,
  VETERINARIO e ENFERMEIRO PROPRIO, demais NENHUM (ENFERMEIRO tem porque a tela é a casa dele —
  sem isso a ação nasceria morta para o perfil que vive no plantão). Coluna CANCELAR no
  ControleAcesso via `MODULO_ACAO_COLS_OVERRIDE.enfermagem`, mesmo apelido de `deletar` usado em `agenda`.
  O MESMO slug cobre o cancelamento de UM ITEM no modal de execução (botão ao lado do item):
  `DELETE /grupos/:id/itens/:itemId/cancelar-plantao` → `PrescricaoGrupoController.removerItem`,
  de novo o mesmo controller da tela de prescrição. Cancelar item também é bloqueado quando
  QUALQUER item do documento já foi executado (guard de `removerItem`) — na prática o botão serve
  para corrigir a prescrição ANTES da primeira aplicação do dia.
  ⚠️ O rodapé do modal de execução deixou de cancelar: virou **Sair** (2026-08-01), e
  "Executar todos do dia"/"Executar todos e finalizar" virou **Executar Todos**. Com isso o
  endpoint `cancelar-execucao` (`cancelarNaExecucao` — cancela tratamento com execução PARCIAL
  preservando os itens já executados/faturados) FICOU SEM ENTRADA NA UI. Ele continua montado e
  funcional; se voltar a ser necessário, é ele que atende o caso "parar um tratamento de vários
  dias no meio" — que nenhum dos dois botões atuais resolve, porque ambos recusam grupo com execução.
  ⚠️ Ações disponíveis nesta tela nascem PINTADAS, na paleta da tela de prescrição (emerald = ver/
  executar, azul = imprimir, vermelho = cancelar). Cinza é reservado ao indisponível — botão
  habilitado com cara de desabilitado foi reclamação real do usuário.
  **A regra virou PADRÃO DO MÓDULO DE ATENDIMENTO INTEIRO em 2026-08-04** — ver seção 6.
- `atendimento.agendamentos` não tem `finalizar`/`imprimir` — agendamentos são gerenciados por status (AGENDADO/CONCLUIDO/CANCELADO)
- `vacina.estoque` não tem `finalizar` — estoque de vacinas segue o mesmo padrão de farmácia
- Sidebar usa `podeExecutar('vacina.estoque.ler')` para exibir o módulo Vacina; agenda ainda usa role check (`isVetOuSuperior`) — ver TODO em seção 12
- ControleAcesso.tsx ACAO_COLS: VER, CRIAR, ALTERAR, EXCLUIR, FINALIZAR, IMPRIMIR. `MODULO_ACAO_COLS_OVERRIDE` permite colunas próprias por módulo — usado por `agendamento`, `agenda` e `farmacia` (VER/CRIAR/ALTERAR/**AJUSTAR**/EXCLUIR/IMPRIMIR). Demais ações extras (executar, ativar, exportar, compartilhar, whatsapp, fechar, lancar, desvincular) existem no DB mas não aparecem como colunas na UI
- `farmacia.estoque.ajustar` (2026-07-10): protege `PATCH /farmacia/estoque/:id/ajuste` (Ajuste de Estoque). Seed: GESTOR FULL, VET/ENFERMEIRO PROPRIO, demais NENHUM. Frontend `podeAjustar` em Farmacia.tsx
- ControleAcesso exibe `agenda` como módulo virtual (extrai `agendamentos` de `atendimento`) — slugs são os mesmos; alterar em um lugar altera nos dois
- Sidebar: Alimentos, Nutrientes e Composição Alimentar ficam no accordion **Nutricional** (apenas ADMIN)
- Sidebar: Cadastro Pessoal, Pacientes/Animais, Proprietários e Tratadores ficam no sub-accordion **Cadastro** dentro de **Geral**
- Para re-sincronizar módulos no banco após alterações no seed: `node backend/seed.js`
- ControleAcesso: botão **Incluir Membro** (profissionais) e **Incluir Cliente** (cargo PROPRIETARIO) para convites

### 🔴 EXCLUSÃO LÓGICA — quem SOME e quem fica INATIVO (2026-08-06)

> 🔴 **PREMISSA (2026-09-05): ANIMAL NUNCA É EXCLUÍDO.** Nenhuma tela cria mais
> `Animal.ativo = false`. O que a interface chama de "Inativar paciente" é o
> CONGELAMENTO (`Animal.inativo`, `PATCH /animais/:id/inativar`): o paciente continua
> aparecendo INTEIRO em todo o sistema — inclusive no seletor de paciente, marcado
> "· Inativo" —, em somente leitura, até o gestor reativar.
> A ação de excluir saiu de `AnimaisVet.tsx` (tela de Pacientes) e de `MeusAnimais.tsx`
> (tela do proprietário), que eram os dois únicos `DELETE /animais/:id` do front.
> ⚠️ O estado e a rota CONTINUAM existindo, e a aba **"Inativos"** (`?ativo=false`,
> gestor) também: a base tem pacientes excluídos ANTES da premissa, e sem a aba e sem o
> "Ativar" deles ficariam presos nesse estado para sempre.
> ⚠️ **A palavra "Excluído" não aparece na interface** — nomear o estado assim
> contradiria a premissa. Na tela de Pacientes o selo do `ativo = false` diz "Inativo"
> (vermelho) e o do congelado diz **"Somente leitura"** (âmbar), que é o que distingue
> os dois.
> ⚠️ **Não reintroduzir ação de excluir paciente em tela nenhuma.** O bloco abaixo
> descreve o que a exclusão lógica FAZ — e segue valendo para PROPRIETÁRIO e EMPRESA.

Fonte única: **`backend/src/lib/visibilidade.js`**. Nada é apagado do banco; o que muda é
o que a aplicação MOSTRA, e isso depende de quem foi inativado:

```
ANIMAL · PROPRIETÁRIO · EMPRESA    → SOMEM. Não aparecem nem como "inativo", e tudo que
    pende deles some junto (evolução, prescrição, vacina, exame, agendamento, fatura,
    histórico). São o SUJEITO do atendimento.

PACIENTE INATIVO (`Animal.inativo`) → NÃO É NADA DISSO. É um TERCEIRO estado,
    de 2026-09-02: o paciente aparece INTEIRO, com todas as atividades visíveis, e o
    prontuário fica CONGELADO na data/hora da inativação (somente leitura) até o gestor
    reativar. Guard único em `lib/animalInativo.js#bloquearSeAnimalInativo`; gate
    estrutural em `__tests__/pacienteInativo.test.js`. NÃO confundir com o `ativo`
    acima, que é a exclusão lógica e faz o paciente sumir.

PROFISSIONAL · FORNECEDOR · PRESTADOR → CONTINUAM aparecendo, marcados como INATIVOS.
    São o AUTOR do registro: esconder o autor apagaria a autoria de prontuário que segue
    válido — "quem prescreveu isto?" precisa ter resposta.
```

🔴 **QUEM DECIDE SE O CLIENTE ESTÁ INATIVO É O CADASTRO DA EMPRESA, NÃO O
`users.ativo` (2026-09-06).** O `ativo` do `users` é do LOGIN e é GLOBAL: ele cai quando
a pessoa é inativada como PROFISSIONAL em QUALQUER clínica (`toggleMembro` mexe nele).
Enquanto ele fazia parte de `proprietarioAtivoNaEmpresa`, inativar a veterinária na
clínica A escondia os pacientes em que ela é CLIENTE da clínica B.
CASO REAL: o paciente "Super Simples" foi cadastrado na MarcoVet com a dona ATIVA ali, e
nasceu invisível porque a conta dela tinha sido desativada na Patyvet três semanas antes,
por outra pessoa. Nada acusou — nem no cadastro, nem na lista.
Isso contrariava as duas regras deste bloco: profissional inativo continua aparecendo, e
o cadastro do cliente é POR EMPRESA (§36). **"Pode entrar no sistema?" e "é cliente desta
clínica?" são perguntas diferentes; só a segunda decide se o paciente aparece.**
⚠️ O `users.ativo` CONTINUA valendo para quem NÃO tem cadastro na empresa (legado) e
para `ANIMAL_VISIVEL` (a variante SEM empresa no contexto): ali não existe outro sinal.
⚠️ O sinal é `ProprietarioPerfil`, NUNCA `UsuarioEmpresa` — esta guarda o vínculo de
qualquer papel, o profissional inclusive, e usá-la remisturaria o que a regra separa.
⚠️ `VeterinarioController.listarProprietarios` seguiu junto: mantinha um `ativo: true`
global POR FORA do filtro, e sem isso o paciente apareceria na lista com o dono
inexistente na tela de clientes.

🔴 **E O `ativo` EXIBIDO DO CLIENTE SEGUIU A MESMA REGRA (2026-09-06).**
`proprietarioPerfil.mesclar` calculava `ativo = user.ativo && perfil.ativo` — então a
cliente ATIVA na clínica A aparecia INATIVA lá porque a clínica B desligou o LOGIN dela
(`toggleMembro` mexe no `users.ativo`, que é global). Não havia nada que a clínica A
pudesse fazer: o cadastro dela ali já estava ativo.
Agora, **havendo cadastro na empresa, é ele que decide**; o `users.ativo` só vale para o
cliente LEGADO, que não tem cadastro por empresa (o `mesclar` devolve o user cru nesse
caso). As abas Ativos/Inativos da tela filtram DEPOIS do merge, então acompanham sozinhas.
⚠️ As duas regras — esta e a da visibilidade acima — precisam CONCORDAR: se uma olhar o
login global e a outra não, o paciente aparece na lista e o dono consta como inativo na
tela ao lado. Há teste travando as duas juntas
(`__tests__/clienteAtivoNaEmpresa.test.js`, verificado que reprova).
⚠️ O que isto NÃO faz: religar o login. Quem precisa voltar a ENTRAR no sistema depende
de quem o desligou — é outra dimensão, e continua sendo.

🔴 **E CADASTRAR PACIENTE PARA UM CLIENTE INATIVO NESTA CLÍNICA VIROU PERGUNTA
(2026-09-06).** `AnimalController.criar` REATIVAVA o cadastro sozinho para o animal não
nascer com dono inativo (e sumir das listas — o sintoma "Horse1"). O invariante estava
certo; o **silêncio**, não: alguém tinha inativado aquele cliente de propósito
(`removerDaEmpresa`) e ele voltava sem ninguém decidir nem ficar sabendo.
Agora o cadastro PARA com **409 `{ inativo: true, proprietario: { id, nome } }`**, a tela
pergunta ("Reativar cliente e cadastrar"), e só o reenvio com `reativarProprietario`
autoriza. O invariante continua garantido: ou o cliente é reativado, ou o animal não nasce.
⚠️ **A confirmação NÃO é bypass do Controle de Acesso**: reativar cliente é
`cadastro.proprietario.ativar`, conferido no controller por `getNivelEfetivo` — sem o
slug, 403, e a tela nem oferece o botão (28-d).
⚠️ Cliente NOVO (criado na mesma chamada) não passa pelo guard: não há cadastro anterior
a respeitar. Gate estrutural em `__tests__/proprietarioInativoNoCadastro.test.js` —
verificado que reprova (removido o guard, os 6 casos falham).

⚠️ **NUNCA zerar `empresaId` ao inativar.** `ProprietarioController.removerDaEmpresa`
fazia `{ ativo: false, empresaId: null, equipeId: null }` e transformava cada animal do
cliente removido numa linha SEM DONO — o principal gerador de registro órfão da base.
**Inativar responde "aparece?"; a tenancy responde "de quem é?".** São perguntas
diferentes, e a segunda não muda quando a primeira muda.

⚠️ **Listagem GLOBAL (a que não recebe `animalId`) precisa do filtro explícito.** Use
`ANIMAL_VISIVEL` / `filhoDeAnimalVisivel()` / `animalVisivelNaEmpresa(empresaId)` — não
basta `animal: { ativo: true }`, que deixa passar os animais do CLIENTE inativado. Já
aplicado em `AnimalController.listar`, `AgendamentoController.listarGlobal`, as duas
`listarParaExecucao` (prescrição e vacina) e `BuscaGlobalController`.

⚠️ `MembroEquipe`/`UsuarioEmpresa` **não entram** nesses filtros. `__tests__/visibilidade.test.js`
falha se algum deles for mencionado ali, e falha se aparecer `empresaId: null`.

### Regras de modelagem
- `@@schema("schs2vet")` em todos os modelos
- Soft delete via campo `ativo: Boolean` — ver a regra de EXCLUSÃO LÓGICA acima
- Audit fields: `createdAt`, `updatedAt` onde aplicável
- Indexes explícitos em FKs e campos de busca frequente
- `@@unique` composto onde necessário (ex: [animalId, vetUserId])

### Multi-tenant — status atual (prep concluída, enforcement pendente)
- `Animal.equipeId` (nullable, FK → Equipe, `ON DELETE SET NULL`, indexed) — migration `20260611150000`
  - Equipe responsável pelo animal dentro da empresa. Setado junto com `empresaId` em todos os
    fluxos de vínculo via `getContextoDoVet(vetUserId, reqEmpresaId, reqEquipeId)` (`lib/vetUtils.js`)
  - Usado para SEGREGAR permissões de PROPRIETARIO por equipe (antes a resolução usava todas as
    equipes da empresa — grant em uma equipe vazava para proprietários das outras)
  - Animal legado com `empresaId` mas sem `equipeId` → fallback: todas as equipes da empresa
  - Backfill na migration: equipe do vet responsável (VINCULO ACEITO); vet em várias equipes → a mais antiga
  - LISTAGEM segregada por equipe: `AnimalController.listar` e `VeterinarioController.meusAnimais`
    filtram por `getEquipeScopeDoUsuario(userId, empresaId, reqEquipeId)` (`lib/vetUtils.js`) —
    contexto x-equipe-id > equipes do usuário na empresa > null (dono sem MembroEquipe = empresa toda).
    Animal de OUTRA equipe da mesma empresa fica fora do escopo de equipe.
  - **LISTAGEM base × convidado (2026-07-16):** a exibição de vínculos diretos do vet depende do
    papel no contexto ATIVO (`req.membroCargo`):
    - **Base própria** (`req.membroCargo === 'GESTOR'` — dono/gestor da empresa ativa): vê
      `scopeOR` + `vetSolicitacoesWhere` (TODOS os vínculos, de qualquer empresa) → co-tratados que
      pertencem a OUTRA empresa aparecem na base do vet.
    - **Convidada** (cargo FORNECEDOR = `isVetPrestadorContexto`, ou VET membro não-gestor): isolamento
      ESTRITO — `vetVinculoNaEmpresa` = `{ AND: [vetSolicitacoesWhere, { empresaId: req.empresaId }] }`
      (só vínculos a animais DA empresa ativa) + designações escopadas. Exclusivos de outra empresa NÃO vazam.
    - Flags em `AnimalController.listar`: `isDonoOuGestorContexto` (base) e `isVetPrestadorContexto`.
      Substitui o antigo `vetVinculoForaDaEmpresa` (que mostrava vínculos FORA da empresa ativa e
      vazava os exclusivos). Multi-vet = múltiplos `VetAnimalSolicitacao` (sem "vet principal" no Animal).
    - **Fonte única (`lib/animalScope.js` → `buildAnimalScopeWhere(req)`):** a regra base × convidado
      foi extraída e é reusada por `AnimalController.listar` (listagem/agendamento) e por
      `PrescricaoGrupoController.listarParaExecucao` (tela `/execucao-prescricao` — `whereGrupo.animal =
      { ...scope, ativo:true }`). Novas telas que listam por animal devem usar essa lib, não replicar o where.
  - `verificarAcessoAnimal({ animalId, userId, empresaId, equipeId })` — mesma empresa exige equipe
    do contexto (ou membership na equipe do animal / dono da empresa, quando sem x-equipe-id);
    vínculo direto do vet ainda garante acesso por ID (paciente próprio). Todos os callers
    (Animal/Evolucao/PrescricaoController) passam `req.equipeId`
- `User.equipeId` (nullable, FK → Equipe, `ON DELETE SET NULL`, indexed, `@map("equipe_id")`) — migration `20260611160000`
  - Equipe que cadastrou o PROPRIETÁRIO (complementa `User.empresaId`). Setado em
    `ProprietarioController.criar` e na criação de proprietário pelo vet em `AnimalController.criar`
  - PROPRIETÁRIOS segregados por equipe: `ProprietarioController` (listar/obterPorId/atualizar/
    removerDaEmpresa) e `FaturaController.listarProprietarios` usam `whereProprietarioNoEscopo`:
    animal ativo na(s) equipe(s) do escopo OU cadastro direto na equipe; legados sem equipeId →
    empresa toda. `PermissaoService.getPermissoesProprietarios` filtra animais pela equipe da aba
  - `removerDaEmpresa` inativa apenas os animais do escopo da equipe ativa (limpa empresaId+equipeId)
  - Backfill na migration: proprietário cujos animais ativos estão todos numa única equipe herda essa equipe
- `Animal.empresaId` (nullable, FK → Empresa, `ON DELETE SET NULL`, indexed)
  - Populado automaticamente ao aprovar `VetAnimalSolicitacao` em **ambos** os fluxos
    (proprietário aceita via email: `AnimalController.proprietarioAprovar`;
     veterinário aceita via email: `VeterinarioController`)
  - Lógica: busca `MembroEquipe` do vet → `equipe.empresaId` → setar no animal
- `AuditLog.empresaId` (nullable, **sem FK** — logs sobrevivem à exclusão da empresa)
  - `AuditController.registrar` aceita `empresaId` no body
- `AnimalRepository.findAll(where, { empresaId })` — filtro opcional por empresa
- `AnimalRepository.setEmpresa(animalId, empresaId)` — atualização direta

**Próximos passos do multi-tenant (não implementados):**
- Backfill de `empresaId` nos animais existentes via `VetAnimalSolicitacao`
- Middleware de enforcement: injetar `empresaId` no contexto a partir do JWT/equipe do vet
- Adicionar `empresaId` em `EvolucaoClinica`, `Fatura` quando enforcement estiver pronto
- Row-Level Security no PostgreSQL (fase enterprise)

---

## 6. PADRÕES DE CÓDIGO

### Frontend

#### Componentes
```tsx
// SEMPRE: componentes tipados, sem 'any', sem prop drilling excessivo
// SEMPRE: usar PageContainer como wrapper de páginas internas
// NUNCA: min-h-screen em páginas internas

// Padrão de página interna:
<PageContainer maxWidth="7xl">   // padrão
<PageContainer maxWidth="5xl">   // páginas menores
<PageContainer noPadding>        // controle manual
// Padding padrão: px-6 py-6 md:px-10 md:py-8
```

#### Mobile-first obrigatório
```tsx
// Cards no mobile, tabela no desktop — SEMPRE
<div className="md:hidden">       {/* cards mobile */}
<div className="hidden md:block"> {/* tabela desktop */}

// Sidebar hamburguer: fixed top-6 left-6 z-50
// Font size sidebar: text-sm em todos os itens
```

#### Layout global
```
index.html: height: 100% em html, body, #root
App.tsx: shell h-full overflow-hidden
<main>: overflow-y-auto pt-16 md:pt-0
Páginas públicas: podem rolar livremente (sem overflow: hidden no body)
```

#### Cor das ações — CINZA É "INDISPONÍVEL" (2026-08-04)
```
Ação PERMITIDA pelo Controle de Acesso nasce PINTADA, nunca cinza-esperando-hover.
  ver / visualizar     → emerald   (Eye)
  finalizar / executar → emerald   (CheckSquare)
  alterar / editar     → LARANJA   (Pencil)          ← 2026-08-04
  imprimir             → azul      (Printer)
  e-mail               → azul      (Mail)
  WhatsApp             → verde     (MessageCircle)   ← cor da própria marca
  cancelar / excluir   → vermelho  (Ban)
```
⚠️ ALTERAR tem cor PRÓPRIA (laranja) e não divide o emerald com "ver": são as duas ações
mais clicadas da linha, e com a mesma cor a pessoa erra qual está apertando. Encaminhamento
e Exames não têm ação de alterar na lista — lá o `podeEditar` gateia só o Cancelar.
O antipadrão era `text-gray-400 hover:text-blue-600`: o ícone só ganhava cor no hover, e
a linha inteira parecia desabilitada. Se a ação NÃO pode ser executada, ela não é
renderizada (28-d) — logo, cinza no botão nunca significa "disponível".
⚠️ EXCEÇÃO: o `X` de fechar modal SEGUE cinza. É cromo, não ação do registro.
Aplicado em Evolução, Prescrição, Exames, Vacina, Encaminhamento e no Histórico do
Paciente (`Atendimento.tsx`), tanto nos ícones do desktop quanto nas pílulas do card
mobile. Tela nova do módulo já nasce assim.

#### AÇÃO DE REGISTRO — `components/AcaoRegistro.tsx` é FONTE ÚNICA (2026-08-28)
```
≥ md (desktop) → só o ÍCONE, pintado          (linha de tabela)
< md (mobile)  → BOTÃO com rótulo, em pílula  (card)
```
A ação é declarada UMA vez; quem escolhe a forma é o CSS. Antes o par
"ícone na tabela / pílula no card" estava copiado nos dois blocos de cada tela —
dez cópias que divergiam a cada correção (o card da Prescrição ficou sem o
Finalizar; o do Orçamento escondia o Editar em vez de explicar por que ele está
travado; Ver/Imprimir do Orçamento eram CINZA, que a §6 reserva ao indisponível).
```tsx
<AcoesRegistro>
  <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar" visivel={podeEditar} onClick={…} />
  <AcaoRegistro tom="ver"     icone={Eye}    rotulo="Visualizar" onClick={…} />
  <AcaoRegistro tom="cancelar" icone={Ban}   rotulo="Cancelar" visivel={cancelavel} onClick={…} />
</AcoesRegistro>
```
`tom` (não a cor) escolhe a paleta da §6: `alterar` laranja · `ver`/`finalizar`/
`executar` emerald · `assumir` teal · `aprovar` âmbar · `imprimir` azul ·
`whatsapp` verde · `email` azul · `ativar` azul (é uma CHAVE, o ícone
ToggleRight/ToggleLeft é que diz a posição) · `cancelar` vermelho · `neutro` cinza.
⚠️ `icone` recebe o COMPONENTE (`Pencil`), não um elemento (`<Pencil />`) — o
tamanho acompanha o breakpoint por classe (`w-3 h-3 md:w-[15px]`), que vence o
`width`/`height` que o lucide escreve no `<svg>`.
⚠️ `visivel={false}` NÃO renderiza. Ação sem permissão não vira botão cinza —
cinza é o indisponível, e botão que só falha depois do clique é a armadilha 28-d.
⚠️ Sem rótulo visível no desktop, quem dá nome ao botão é `aria-label` + `title`,
os dois vindos de `rotulo`/`titulo`. Por isso `rotulo` é obrigatório.
🔴 `AcoesRegistro` é `flex-wrap md:flex-nowrap` — **no desktop as ações ficam TODAS
NA MESMA LINHA**, e isso não é cosmético: com `flex-wrap`, a largura MÍNIMA do
contêiner é a de UM ícone, então a `<table className="w-full">` espreme a coluna
"Ações" até isso e as 8 ações da Evolução saem EMPILHADAS, uma por linha (defeito
relatado em 2026-08-30, no módulo de Atendimento). Não adianta `whitespace-nowrap`
no `<td>`: aquilo governa quebra de TEXTO, não de item flex — quem precisa de
largura é o contêiner. A quebra continua valendo abaixo de `md`, que é onde serve
para alguma coisa: ali a ação é PÍLULA COM RÓTULO e várias não cabem lado a lado.
⚠️ NÃO reintroduzir `flex-wrap` no desktop. A justificativa antiga ("celular DEITADO
passa de 768px e os ícones saíam do card") caducou quando o rótulo passou a sumir no
`md:` — de 768px para cima cada ação ocupa ~27px, e as 8 juntas cabem em ~230px.
⚠️ Onde a tela tem os dois blocos (`hidden md:block` + `md:hidden`), extraia a
lista para UMA função/componente (`acoesDoGrupo`, `AcoesEncaminhamento`…) e chame
das duas — é isso que impede a divergência voltar. A autoria/permissão de cada
ação se resolve DENTRO dela, não em cada bloco.
Aplicado em TODA lista de registro do sistema: Atendimento (Evolução, Prescrição,
Vacina, Exames, Encaminhamento), Execução de Prescrição e Painel Principal (fila do
plantão), Orçamento, Farmácia, Estoque de Vacinas, Exames Nutricionais + Resultados,
`ExamesSolicitadosPanel`, Exame de Compra, Medicamentos, Procedimentos, e os
CADASTROS: Fornecedor, Prestador, Tratador, Proprietário, Localização, Vacina,
combos do Cadastro de Procedimento, Equipe, Pacientes (`AnimaisVet`) e
`VetDashboard`. `CompartilharPdfBotoes` também passou a sair por ele, então
WhatsApp/E-mail do PDF ficam responsivos em qualquer tela que o use.
⚠️ **CARD de cadastro põe as ações no RODAPÉ** (`mt-3 pt-3 border-t border-gray-50`),
nunca numa coluna lateral: com rótulo elas espremem o nome do registro. Foi por isso
que os cards de `AnimaisVet` e `VetDashboard` deixaram de ser `flex items-center` com
uma tira de ícones à direita.
FICAM de fora, de propósito:
- o `X` de fechar modal, o refresh de cabeçalho e as setas de paginação — são CROMO,
  não ação do registro;
- os dois ícones da linha de item da FATURA, que convivem com o valor à direita e
  viram cartão alto demais se ganharem rótulo;
- o chip de item DENTRO do formulário (Prescrição/Vacina) e as linhas da tabela de
  digitação manual do resultado — são controles de FORMULÁRIO, não ações de registro;
- os botões por item DENTRO do modal de execução (§ "Execução de Prescrição"), que já
  têm decisão própria registrada;
- `Usuarios.tsx`, tabela ADMIN-only sem card mobile (rola na horizontal por projeto);
- o cabeçalho do acordeão de vacina LEGADA (`CadastroVacina`), onde a linha inteira já
  é o botão de expandir;
- a Central de Documentos (`modules/documentos/`), que tem padrão próprio: card com
  botão primário + menu de overflow no desktop e um fluxo MOBILE dedicado
  (`Mobile.tsx`), que não é o desktop encolhido.

#### DATA E HORA — `utils/dateUtils.ts` é FONTE ÚNICA (2026-08-23)
```
DATA PURA (dia do calendário, sem hora)  → formatDate / formatDateShort
   dataInicio, dataAplicacao, dataNascimento. NÃO converte fuso.
INSTANTE (timestamp com hora)            → formatHora / formatDiaMes /
   formatDiaMesHora / formatDataHora / formatHoraComDia / diaISO / hojeISO
   createdAt, executadoEm, proximaDoseEm, dataHora. Converte para o fuso de quem olha.
```
⚠️ **NUNCA passe um INSTANTE para `formatDate`/`formatDateShort`** — elas leem a data
em UTC (`split('T')`), então uma dose às 22:00 em Brasília (= 01:00 UTC do dia
seguinte) aparece com a data ERRADA. Foi assim que a linha da dose noturna saiu no
dia errado.
⚠️ **NUNCA `.toISOString().slice(0, 10)` para saber "que dia é"** — devolve o dia em
UTC, que à noite já é amanhã. Use `hojeISO()` / `diaISO(x)`. Os 8 pontos que faziam
isso foram convertidos; a busca por esse padrão no `frontend/src` hoje só acha
comentário.
⚠️ **NUNCA fixe `timeZone: 'America/Sao_Paulo'` no front.** A aplicação roda em
TODO O BRASIL, que tem **4 fusos** (UTC−2 Noronha · UTC−3 Brasília/SP/Sul/NE ·
UTC−4 Manaus/Cuiabá/Campo Grande/Porto Velho · UTC−5 Rio Branco). Fixar SP mostra
07:44 para uma clínica no Acre cujo relógio marca 05:44 — o plantão inteiro sai
deslocado. Era o que `formatDateTime` e o convite do `ControleAcesso` faziam.
⚠️ Horário digitado em campo `HH:MM` é LOCAL — montar com `setUTCHours` foi a
origem do "sistema 3 horas atrás" (ver a entrada de 2026-08-23 no topo).
✅ **O fuso é da EMPRESA e é DEDUZIDO DO ENDEREÇO — o gestor NÃO escolhe fuso.**
Ninguém deveria precisar saber o que é "America/Cuiaba" para cadastrar uma clínica,
então o valor sai do CEP/UF que o cadastro já coleta (`fusoPorEndereco` →
`fusoPorCep` → `fusoPorUf`, em `lib/fusoEmpresa.js`).
🔴 **O fuso NÃO APARECE em tela nenhuma** (2026-08-24). A tela de Configurações
(`CadastroEmpresa.tsx`) chegou a exibi-lo em campo read-only ("Manaus (UTC−4)"), e o
campo foi REMOVIDO a pedido: sendo só leitura, não havia o que fazer com ele ali. O
`fusoLabel` saiu junto do `useConfiguracaoOperacional` (estado sem consumidor é estado
morto), mas o backend CONTINUA devolvendo `fusoLabel` em `GET/PUT
/equipes/configuracoes` — contrato inalterado, basta voltar a ler se a exibição
retornar. O FUSO EM SI não mudou nada: segue deduzido do endereço, aplicado no front
pelo `EmpresaContext` (via `GET /equipes/logo`) e no backend por `fusoDaEmpresa`.
⚠️ Não reintroduzir como campo EDITÁVEL — foi por isso que o seletor saiu em
2026-08-23. O caso raro que o endereço não decide se resolve pelo override
`EmpresaConfiguracao.fusoHorario`, fora da UI do gestor.
⚠️ **O CEP vence a UF**, e não o contrário: é o único jeito de separar Fernando de
Noronha (UTC−2) do resto de Pernambuco (UTC−3).
⚠️ As faixas de CEP são por INTERVALO, nunca por prefixo: o mesmo "69" cobre
Amazonas, Roraima e Acre (fusos diferentes), e DF/GO se intercalam no 7xxxx.
⚠️ `EmpresaConfiguracao.fusoHorario` (migration `20260823000000`) continua existindo
como OVERRIDE, fora da UI do gestor — serve ao caso raro que o endereço não decide
(extremo oeste do AM é UTC−5 embora a UF seja AM/UTC−4) e ao ADMIN corrigir sem
deploy. Ordem em `fusoDaEmpresa`: coluna → endereço → `FUSO_PADRAO`.
⚠️ O fuso é cacheado 60s por empresa; `EmpresaCadastroController.salvar` invalida na
hora, senão a fila do plantão rodaria até um minuto no fuso antigo após mudar o CEP.

Vale nos DOIS lados:
```
BACKEND  lib/fusoEmpresa.js  → fusoDaEmpresa(empresaId) (cache 60s) +
                               hojeNaEmpresa / diaNaEmpresa / formatarNaEmpresa /
                               instanteNoFuso (o caminho INVERSO: "HH:MM na clínica"
                               → instante UTC, usado pela Hora Início)
FRONT    utils/dateUtils.ts  → definirFusoDaEmpresa(tz), chamado pelo EmpresaContext;
                               `fusoDeExibicao()` = fuso da clínica ?? do dispositivo
```
`null` = não escolhido → `America/Sao_Paulo` no servidor e fuso do dispositivo na
tela: exatamente o comportamento anterior, então NENHUMA empresa muda de
comportamento ao aplicar a migration (por isso ela não tem backfill).
⚠️ O fuso chega ao front por **`GET /equipes/logo`**, e não por
`/equipes/configuracoes` — esta última é GESTOR-only e o fuso precisa alcançar a
enfermeira que abre o plantão. `EmpresaContext` zera o fuso ao trocar de empresa
antes de recarregar, senão a clínica nova exibiria horários no fuso da anterior.
⚠️ **NUNCA trocar `process.env.TZ` em runtime para "virar" o fuso do tenant** — é
global ao processo e o servidor atende várias clínicas ao mesmo tempo. Tudo passa
por `Intl` com `timeZone` explícito, que é isolado por chamada.
⚠️ O fuso da CLÍNICA vence o do dispositivo de propósito: o gestor que abre o
plantão de Manaus de um notebook em SP precisa ver o horário de Manaus, que é onde
a dose será aplicada — e é assim que a tela concorda com o backend, que decide o dia
pelo fuso da empresa.
✅ **Convertidos** (nada mais formata em Brasília fixo): `PrescricaoGrupoController`
(fila do plantão + auditoria), `AgendamentoController` — incluindo
`diaEHoraNaEmpresa`, que decide se o horário cabe no EXPEDIENTE (era o pior: em
Manaus a janela saía 1h deslocada, e sábado 23:00 no Acre virava domingo e era
recusado) —, `lembreteDosePrescricaoService`, `lembreteAgendamentoService`,
`DashboardController` (o `AT TIME ZONE` do gráfico por dia, como BIND — nunca
interpolado) e `emailService` (5 templates ganharam `fuso = FUSO_PADRAO` opcional:
quem não passa mantém o comportamento antigo).
🔴 **Dois `America/Sao_Paulo` que FICAM, de propósito:**
- `emailService.js` (alerta de cron) — é da PLATAFORMA para o ADMIN, não de clínica.
- `lib/cronManager.js` — é o fuso do AGENDAMENTO do job, e cada job varre TODAS as
  empresas numa passada; não existe "o fuso" dele. Consequência conhecida: um job de
  23:30 roda 22:30 em Manaus. Para cada clínica fechar no próprio fim de dia, o
  caminho é agendar por empresa (ou rodar de hora em hora filtrando por
  `hojeNaEmpresa`) — decisão de produto em aberto.

#### 🔴 SQL CRU: `NOW() AT TIME ZONE 'UTC'`, NUNCA `NOW()` puro (2026-09-05)
Toda coluna de data/hora do schema é **`timestamp WITHOUT time zone`** (é o que o
`DateTime` do Prisma gera), e o Prisma a lê e escreve como **UTC NAIVE**. Já o `NOW()`
do Postgres é `timestamptz`: gravado numa coluna `timestamp`, ele é convertido para o
fuso da **SESSÃO** — `America/Sao_Paulo` nesta base. Resultado: a hora LOCAL vai para o
banco com cara de UTC e volta **3h ATRASADA** na tela.
```sql
SET "inativo_em" = NOW()                     -- ❌ grava 07:34 (local) como se fosse UTC
SET "inativo_em" = NOW() AT TIME ZONE 'UTC'  -- ✅ grava 10:34, o instante de verdade
```
Foi assim que a faixa do paciente inativo dizia *"somente leitura desde 04:34"* para
quem havia inativado às **07:34**. Corrigido em `lib/animalInativo.js#marcarInativo`,
`lib/agendamentoAssumido.js#marcarAssumido`, `EmpresaCadastroController` (assinatura) e
nos seeds 003/004.
⚠️ Vale só para SQL CRU — escrita pelo client Prisma (`new Date()`) já vai em UTC.
⚠️ Linha gravada ANTES da correção continua com o valor errado: o `NOW()` não volta
atrás sozinho.

#### CAMPO DE DATA — `DateInput`, NUNCA `<input type="date">` (2026-08-28)
```
Campo de formulário  → <DateInput ... />              (mensagem de erro ABAIXO)
Filtro de toolbar    → <DateInput ... compacto />     (erro no `title` + vermelho)
```
⚠️ **`<input type="date">` cru exibe MM/DD/AAAA** quando o locale do navegador é
en-US — o nativo segue o browser e o Chrome IGNORA o `lang` da página. É por isso que
`DateInput` existe: ele mantém o valor em ISO (`YYYY-MM-DD`, ou `YYYY-MM-DDTHH:MM`
com `withTime`) e exibe/aceita sempre DD/MM/AAAA.
🔴 **DATA INVÁLIDA RECLAMA, e diz O QUE está errado.** Até 2026-08-28 os dois
componentes de data recusavam `31/02/2026` em SILÊNCIO, e o `DateInput` fazia pior: ao
sair do campo VOLTAVA ao último valor válido — quem digitava errado via o campo
"consertar-se" sozinho para a data ANTERIOR e salvava aquela achando que tinha trocado.
Agora o texto digitado PERMANECE (dá para corrigir o dígito, não recomeçar) e a
mensagem é específica: "Dia inválido — fevereiro de 2026 tem 28 dias", "Mês inválido
(use de 01 a 12)", "Ano inválido", "Data posterior ao permitido (DD/MM/AAAA)".
Genérico ("data inválida") deixa a pessoa olhando para os três campos sem saber qual.
Regra em `utils/dataValidacao.ts` — FONTE ÚNICA de `DateInput` e `DateInputBR`; duas
validações davam veredictos diferentes para o mesmo texto.
🔴 **`onChange('')` no inválido — e o CALLER decide o que fazer com isso:**
```
FORMULÁRIO → deixe zerar. É o que impede salvar o valor ANTIGO sem ninguém notar,
             e o que faz a validação de campo obrigatório disparar.
FILTRO     → `onChange={v => { if (v) setX(v); }}`. Nada é gravado, então não há
             valor velho a proteger; apagar a tela enquanto a pessoa corrige um
             dígito não ajuda ninguém. Ver MapaAtendimento, onde `dataFiltro` vai
             direto para a query e para `new Date(x + 'T12:00:00')` — vazio ali
             viraria `Invalid Date` e uma chamada `?data=`.
```
⚠️ `min`/`max` deixam de ser só limite do calendário: passam a ser VALIDADOS com
mensagem. No `MapaAtendimento` é o que impede início depois do fim.
⚠️ **NÃO converter `PeriodoSelector`**: lá o `<input type="date">` é `opacity-0` atrás
de um ícone — é seletor puro, sem texto para formatar. `DateInput` renderiza texto
visível e quebraria o botão.
⚠️ Ao converter, troque `focus:` por `focus-within:` no `className`: o foco passa a
estar no input DENTRO do wrapper, e sem isso a borda de foco nunca acende.

#### Onde o ERRO aparece — ABAIXO DO BOTÃO QUE O DISPAROU
```
Erro de AÇÃO  → logo abaixo do botão/rodapé que a disparou
Erro de CARGA → topo da tela (não veio de clique nenhum)
```
Uma tela pode ter VÁRIAS superfícies de erro, e deve ter: quem clica em "Salvar" no
rodapé de um formulário longo não enxerga um `InlineError` no topo da página — clica e
parece que nada aconteceu. Separe os estados (`erroInline` para carga, `erroSalvar` /
`erroModal` / `erroLista` / `erroGrade` para as ações) em vez de reusar um só.
⚠️ Só posicionar não basta quando o container ROLA: o erro nasce no fim do formulário e
pode cair fora da dobra. Use um `ref` + `scrollIntoView({ block: 'nearest' })` —
`nearest` não mexe na tela quando ele já está visível.
⚠️ Erro de ação dentro de MODAL vai no modal (depois do rodapé), nunca na página atrás
do overlay. `UsuarioFormModal.erroServidor` e `ModalJustificativa.erro` existem para isso.
Aplicado em: Agenda (reagendar / trocar profissional / transferir dia), Exame de Compra,
Configurações, Equipe e ControleAcesso.

#### Padrão de controle de acesso por página
```tsx
// OBRIGATÓRIO em páginas que têm controle granular de permissão:
const { podeExecutar, loading: loadingPerms } = usePermissoes();
const podeCriar   = podeExecutar('modulo.submodulo.criar');
const podeEditar  = podeExecutar('modulo.submodulo.editar');
const podeImprimir = podeExecutar('modulo.submodulo.imprimir');

// Helper de feedback ao usuário:
const semPermissao = (acao: string) =>
  toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

// 1. Guard de acesso à página (antes de qualquer render):
if (!loadingPerms && !podeExecutar('modulo.submodulo.ler')) {
  return (
    <PageContainer>
      <div className="text-center py-16">
        <h2>Acesso não autorizado</h2>
        <p>Você não tem permissão para visualizar esta página.</p>
      </div>
    </PageContainer>
  );
}

// 2. Gating de useEffects — CRÍTICO: evita chamadas prematuras ao backend antes
//    de carregar permissões (resultaria em 403s desnecessários):
useEffect(() => {
  if (loadingPerms) return;  // ← nunca omitir
  carregarDados();
}, [dependencias, loadingPerms]);

// 3. Guards em handlers de escrita (checa ANTES de chamar a API):
const handleSalvar = async () => {
  if (!podeCriar) { semPermissao('criar X'); return; }
  // ... chamada API
};

// 4. UI condicional — ocultar botões sem permissão:
{podeCriar && <button>Novo</button>}
```

#### Comportamento do interceptor Axios para 403
```typescript
// api.ts (services/api.ts) — interceptor de resposta:
// GET 403  → Promise.resolve({ data: null, status: 403, ... })
//            componente deve checar: if (!res.data) return;
//            NÃO usar res.data.dados diretamente — usar res.data?.dados
// POST/PUT/DELETE/PATCH 403 → Promise.reject(permErr) com { isPermissionError: true, status: 403 }
//            handler deve checar permissão ANTES da chamada (evita gerar o 403)
//            catch silencioso: catch { /* silencioso */ } — não logar permErrs no console
//            ⚠️ (2026-08-04) o permErr PRESERVA `response` e usa a mensagem do backend
//            como `message`. Antes era um `new Error('Sem permissão para esta operação.')`
//            NU — sem `response` —, então TODO handler que lê `err.response?.data?.error`
//            caía no fallback genérico e o motivo real do 403 morria no interceptor.
//            Sintoma clássico: "está dando erro" sem texto útil (foi assim que o 403 de
//            regra de negócio do reagendamento apareceu como "Erro ao reagendar").
```

#### i18n — OBRIGATÓRIO
```tsx
// NUNCA hardcodar strings visíveis ao usuário
// SEMPRE usar useTranslation() e chaves i18n
import { useTranslation } from 'react-i18next'
const { t } = useTranslation()
// Uso: t('nutrition.diet.title')
```

#### TypeScript
```typescript
// NUNCA usar 'any'
// SEMPRE tipar props, returns, estados
// SEMPRE usar interfaces para contratos entre camadas
// Generics onde aplicável
```

#### Hooks de polling (notificações em tempo real)
```typescript
// Padrão: useRef<Map<id, status>> para detectar mudanças sem re-render excessivo
// Primeira carga: inicializa o mapa apenas com PENDENTE/ACEITO — RECUSADO/CANCELADO excluídos
//   propositalmente para que o check de updatedAt detecte recusas ocorridas antes da sessão
// Polling a cada 15s com setInterval, limpado no cleanup
// Fire-and-forget: nunca bloquear UI por falha de polling
// Janela de detecção retroativa: updatedAt < 10min → notifica mesmo sem ter visto PENDENTE antes

// Hooks existentes (chamados no Sidebar para todos os perfis):
// useProprietarioNotificacoes — /animais/minhas-solicitacoes (só PROPRIETARIO)
//   Detecta: PENDENTE→ACEITO, PENDENTE→RECUSADO, ACEITO→PENDENTE (vet inicia DESVINCULO),
//            ACEITO→CANCELADO (vet se desvinculou), undefined+PENDENTE (nova solicitação V→P)
// useVetSolicitacaoMonitor — /veterinarios/solicitacoes (só VETERINARIO)
//   Detecta: novas solicitações PENDENTE, mudanças PENDENTE/ACEITO→CANCELADO
```

#### SolicitacaoCard — padrão de card para solicitações de vínculo/desvinculo
```tsx
// Presente em: VetDashboard.tsx (inline) e AnimaisVet.tsx (inline)
// Props: sol: Solicitacao, onResponder: (id, 'ACEITO'|'RECUSADO') => void
// Renderização diferenciada por sol.tipo:
//   DESVINCULO → border-red-200, banner vermelho, botões "Aceitar remoção" / "Manter acesso"
//   VINCULO    → border-amber-200, banner âmbar, botões "Aceitar" / "Recusar"
// Exibe: foto animal, nome, espécie·raça·idade, proprietário, telefone, email
```

### Backend

#### Controllers — devem ser ENXUTOS
```javascript
// Controller só: valida input, chama service, retorna response
// NUNCA: regra de negócio no controller
// NUNCA: query direta no controller

// Padrão:
async (req, res) => {
  const result = await SomeService.doSomething(req.body)
  return res.json(result)
}
```

#### Services — regra de negócio aqui
```javascript
// Toda lógica de domínio vive nos services
// Services chamam outros services quando necessário
// Services NÃO conhecem req/res
```

#### Estrutura de resposta padrão
```javascript
// Sucesso:
res.json({ data: result })
res.json({ data: result, meta: { total, page } })

// Erro:
res.status(400).json({ error: 'mensagem', code: 'ERROR_CODE' })
res.status(401).json({ error: 'Não autorizado' })
res.status(404).json({ error: 'Recurso não encontrado' })
```

---

## 7. ARQUITETURA DE IA

### Provider ÚNICO: Google Gemini (2026-07-28)
Groq, OpenAI e Anthropic foram REMOVIDOS (providers deletados; `groq-sdk` sem uso).
Todo acesso a LLM — texto, visão e transcrição de áudio — passa por
`src/ai/geminiClient.ts` (`gerarConteudo` / `gerarTexto` / `transcreverAudio`).
NUNCA chamar a API do Gemini com `fetch` fora desse arquivo: o log de tokens depende dele.

```
Modelo:  MODELO_PADRAO = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
Chave:   GEMINI_API_KEY (única — AI_PROVIDER e GROQ_API_KEY saíram do .env)
```
⚠️ `gemini-1.5-flash` foi RETIRADO da API do Google (404 em chaves novas). Projetos
legados que ainda tenham acesso podem usá-lo via `GEMINI_MODEL=gemini-1.5-flash`.
Ao trocar o modelo, registre o preço em `services/aiLogger.service.js#PRECOS` — sem
isso o custo cai no fallback `default` (chamadas e tokens seguem exatos).

### Princípios AI-ready
```
- NUNCA acoplar código ao provider sem abstração (AIProvider em src/ai/types.ts)
- Fallback entre providers: buildChain() em src/ai/index.ts (hoje só Gemini)
- Versionar prompts (catálogo src/ai/prompts — nunca hardcodar prompt no código)
- Logar toda inferência em AiUsageLog
- TODA chamada declara `modulo` (MODULOS_IA) — é o "quem chamou" do relatório
```

### `modulo` — obrigatório em toda chamada
`callAI({ operacao, modulo, prompt, ... })` e `logAiUsage({ ..., modulo })` exigem o
módulo de origem. Valores em `MODULOS_IA` (`src/ai/index.ts`): ATENDIMENTO,
MEMORIA_CLINICA, FINANCEIRO, EXAMES, NUTRICAO, AGENDA, TRANSCRICAO.
`AiUsageLog.modulo` (migration `20260731000000`) — registros anteriores = `'LEGADO'`.

### Padrão de escrita de prompt (revisão 2026-07-28)
Todos os prompts do catálogo foram reescritos em voz IMPERATIVA e assertiva.
Regras obrigatórias para prompt novo ou editado:
```
- Comando direto ("Extraia", "Ignore", "Omita") — nunca "Você é um assistente que..."
- Não justificar a regra dentro do prompt
- Saída = só o artefato pedido. Proibido preâmbulo, comentário, markdown, explicação
- Terminar com o bloco SAÍDA + a constante SO_JSON (proibições padronizadas)
```

### Operações de IA existentes (catálogo `src/ai/prompts/index.js`)
| Chave | Versão | Módulo | Onde |
|---|---|---|---|
| `memoria_clinica` | v1 | MEMORIA_CLINICA | `resumoAtendimentoService` — AnimalDetail |
| `analise_financeira` | v1 | FINANCEIRO | `financeiroLLMService` — Relatórios > Financeiro |
| `parse_laudo` | v5 | EXAMES | `exameParserService` |
| `interpretacao_clinica` | v3 | ATENDIMENTO | `clinicaLLMService.interpretarEvolucao` |
| `resumo_historico` | v2 | ATENDIMENTO | `clinicaLLMService.resumirHistorico` |
| `extrair_resultado_sessao_equino` | v7 | ATENDIMENTO | `laudoEquinoExtracao.service` (body-map) |
| `interpretacao_agendamento` | v2 | AGENDA | `agendamentoLLMService` |
| `analise_nota_clinica` | v1 | ATENDIMENTO | `AudioController` (rota ainda não montada) |
| `parse_composicao_visao` | v2 | NUTRICAO | `composicaoParserService` (multimodal) |
| `parse_composicao_texto` | v2 | NUTRICAO | `composicaoParserService` |
| `assistente_documento` | v1 | DOCUMENTOS | `documentoLLMService` — chat da Central de Documentos, ancorado no ACERVO |
| `converter_documento` | v1 | DOCUMENTOS | `documentoConversaoService` — documento ENVIADO (PDF/foto) → blocos com variáveis e lacunas. MULTIMODAL |

### Metering de IA por cliente (2026-07-28)
Modelo de mercado adotado: **conta única no Google + medição interna por tenant**
(migration `20260801000000`). O `usage_metadata` do Gemini já vinha sendo capturado
por `geminiClient.ts`; o que faltava era ATRIBUIR o consumo ao cliente que paga —
num SaaS multi-tenant o cliente é a EMPRESA, não o usuário.

```
AiUsageLog.empresaId  — sem FK (o log sobrevive à exclusão da empresa, igual AuditLog)
IaPlanoEmpresa        — plano por empresa: limiteTokensMes, limiteChamadasMes,
                        bloquearAoExceder, ativo. SEM LINHA = sem limite (só medição).
                        Limite null = ilimitado naquela dimensão.
```

**TODA chamada de IA deve passar `empresaId: req.empresaId`.** Sem isso o consumo cai
em "Sem empresa" e não é faturável. Os serviços recebem `empresaId` como último
parâmetro (`interpretarEvolucao`, `resumirHistorico`, `processarExame`,
`processarArquivo`, `interpretarAgendamento`, `extrairResumoAtendimento`,
`extrairResultadoSessao`) ou via `req` (memória clínica, financeiro, transcrição).

**Gate de quota** (`services/iaQuotaService.js`): `garantirQuota(empresaId)` roda DENTRO
de `callAI`, ANTES de gastar token. Estourou o plano com `bloquearAoExceder` → lança
`QuotaIaExcedidaError` (`code: 'IA_QUOTA_EXCEDIDA'`), traduzido para **HTTP 429** pelo
error handler global de `server.ts`. Controllers com try/catch próprio precisam
repassar: `if (err.code === 'IA_QUOTA_EXCEDIDA') return next(err);`.
Só conta chamada com `sucesso: true` — falha de provider não é consumo do cliente.
Sem `empresaId` (ADMIN global, job sem tenant) NÃO bloqueia.
POR QUÊ o gate existe: na conta única o rate limit e a fatura são COMPARTILHADOS —
sem teto por tenant, um cliente sozinho derruba a IA de todos (já aconteceu: 429
`limit: 0` do free tier).

Painel ADMIN: `GET /api/ai-usage/por-empresa` + `GET/PUT /api/ai-usage/planos/:empresaId`
→ `components/ConsumoPorClienteIA.tsx` em `/ai-usage` (consumo, % do limite e edição
do plano). O % só é exibido no período **Este mês** — é a janela que o gate usa.

### Memória Clínica do Paciente (`memoria_clinica`)
Duas camadas persistidas em `tb_resumo_atendimento_ia` (1 registro por animal+empresa):
```
highlights[] — padrões factuais entre atendimentos, cada um ancorado nos tópicos que
               o comprovam (mín. 2). Ex.: "Perda progressiva de peso: 70 kg (20/06)
               → 60 kg (22/06) → 50 kg (27/07)."
               tipo: TENDENCIA|RECORRENCIA|PENDENCIA|ALTERACAO
               direcao: aumento|reducao|estavel|nao_aplicavel
topicos[]    — um por evento, com `ref` = id do Histórico (evolucao-31, vacina-7…),
               o que torna cada tópico clicável até o registro de origem
```
INCREMENTAL: o LLM só é chamado quando há evento NOVO (colunas `total_eventos` e
`ultimo_evento_em`). Abrir a tela de novo NÃO varre as evoluções. Bump de versão do
prompt (`versao_prompt`) força reconstrução completa.
ANTI-ALUCINAÇÃO: os ids dos tópicos são atribuídos pelo SERVIÇO (t1..tN), nunca pelo
modelo — ele apenas os ecoa. `normalizarTopicos`/`normalizarHighlights` descartam
qualquer id/ref que não case com um evento realmente coletado.
A IA é PROIBIDA de sugerir conduta, diagnosticar, prognosticar ou emitir laudo — ela
apenas descreve e correlaciona o que está registrado.
Front: `components/MemoriaClinicaPanel.tsx` (highlights no topo → clicar realça e rola
até os tópicos que o sustentam; tópico → abre o registro de origem).
Rotas: `GET /clinica/resumo-atendimento/animal/:animalId` (não chama IA) e
`POST /clinica/resumo-atendimento/animal/:animalId/atualizar`.

### IA Financeira (`analise_financeira`)
Análise gerencial do período para a empresa do contexto ativo. NÃO persiste nada: lê
os indicadores já apurados por `RelatoriosController.computarFinanceiro` (fonte única
de cálculo — desconto por item, escopo por empresa e janela do período já vêm
resolvidos de lá) e devolve `{ highlights[], analise[] }`.
Proibida de recomendar ação, projetar cenário ou qualificar o resultado — descreve,
quantifica e compara.
Rota: `GET /api/relatorios/financeiro/analise-ia` (`relatorios.gerencial.ler`).
Front: `components/relatorios/AnaliseFinanceiraIA.tsx` — chamada SOB DEMANDA (botão
"Analisar período"), nunca ao abrir a página, para controlar custo.

---

## 8. UPLOAD E STORAGE

### 🔴 O ARQUIVO MORA NO BANCO (bytea) — nada é servido do filesystem

```
Tabela:  schs2vet.tb_midia_arquivos  (model MidiaArquivo, coluna `conteudo` BYTEA)
Driver:  STORAGE_DRIVER=db  (padrão) — src/storage/DbStorageProvider.ts
Saída:   GET /api/midia/:chave  → autenticado e AUTORIZADO por dono do arquivo
         GET /api/marca         → público, e SÓ a marca do produto
Teto:    150 MB por arquivo (UPLOAD_MAX_BYTES) — ver abaixo
Migration: 20260816000000_midia_arquivos
```

**POR QUÊ saiu do disco:** `/uploads` era servido por `express.static`, ou seja, o byte
saía da aplicação **sem passar por autenticação nenhuma** — o único gate era acertar o
nome aleatório do arquivo (capability URL). Quem obtivesse o link seguia lendo a foto do
paciente ou o laudo depois de perder o acesso, inclusive de outra empresa. Com o conteúdo
no banco **não existe caminho que não passe pelo controller**: o gate deixou de ser o
segredo da URL e passou a ser a mesma regra de acesso do resto do sistema.

**AUTORIZAÇÃO do download** (`MidiaController`), nesta ordem: `publico` → ADMIN da
plataforma → `animalId` presente → `verificarAcessoAnimal` → `empresaId` presente → tem de
ser a empresa do contexto → sem dono → só o autor. Negado responde **404**, não 403: não se
confirma a existência do arquivo a quem não pode vê-lo.

⚠️ **Todo `storage.upload` DEVE passar o contexto de dono** — `{ empresaId, animalId,
criadoPorId }`. Sem ele o arquivo nasce sem dono e só o ADMIN o alcança.

⚠️ **Vídeo grande não é carregado em memória:** o `Range` é atendido com `substring()` no
Postgres (`substring(conteudo from $1::int for $2::int)` — o `::int` é obrigatório, o
Prisma manda `bigint` e o Postgres só tem `substring(bytea, integer, integer)`). O player
mantém o seek e o consumo fica limitado à fatia pedida.

⚠️ **Teto de 150 MB mora no PROVIDER, não só no multer.** O `limits.fileSize` é por rota:
rota nova que esqueça de declará-lo aceitaria qualquer tamanho e o binário iria para o
banco. O provider é o funil por onde tudo passa. Estouro → **413** com
`code: 'ARQUIVO_GRANDE_DEMAIS'` (cobre `LIMIT_FILE_SIZE` do multer e o erro do provider).

### 🚀 CRESCEU O BANCO? O CAMINHO É O `S3StorageProvider` — TROCA SÓ O `STORAGE_DRIVER`

> **Guardar binário no banco tem um custo conhecido: o dump do backup cresce junto.**
> Quando isso incomodar (vídeo de prontuário a 150 MB chega lá rápido), **NÃO** volte a
> servir arquivo do filesystem e **NÃO** mexa em controller. A saída já está prevista pela
> arquitetura:
>
> 1. Implemente `S3StorageProvider` respeitando a interface `StorageProvider`
>    (`upload` / `delete` / `getUrl` — src/storage/StorageProvider.ts).
> 2. Registre no `switch` de `src/storage/index.ts` (o `case 's3'` já está lá, comentado).
> 3. Ligue com **`STORAGE_DRIVER=s3`**. Só isso.
>
> **NENHUM controller muda**: todos chamam `storage.upload(...)` / `storage.delete(...)`
> pela interface, nunca o driver. E o **download continua saindo pela mesma rota
> autorizada** (`/api/midia/:chave`), que faz o proxy do objeto — o bucket permanece
> PRIVADO. Jamais devolver URL pública/assinada do S3 direto ao cliente: isso recria
> exatamente o furo do `express.static` (byte acessível sem passar pela regra de acesso).
>
> Mesma receita vale para `GCSStorageProvider` (`case 'gcs'`, também já previsto).

### Regras invioláveis de storage
- **NUNCA** reintroduzir `express.static` sobre `uploads/` (nem "só para a logo").
- **NUNCA** acoplar controller a um driver — sempre a interface `StorageProvider`.
- **NUNCA** expor URL pública/assinada do bucket: o download passa pela rota autorizada.
- Driver `local` (`STORAGE_DRIVER=local`) existe só para depurar. Não usar em produção.

### Marca do produto
Fica no banco também (`pasta='marca'`, `publico=true`), servida por `GET /api/marca` —
rota **sem parâmetro** de propósito: não recebe chave do cliente, então não serve de
atalho para arquivo de paciente. É pública por necessidade (aparece na tela de login,
antes de existir sessão) — o ganho de tê-la no banco **não é segurança**, é não sobrar
código servindo arquivo de disco. Carga: `scripts/carregarMarcaProduto.js`.

### Migração do legado
`scripts/migrarUploadsParaBanco.js` (idempotente, aceita `--dry`) importa os arquivos de
`backend/uploads/` e reescreve as URLs em `Animal.photoUrl`, `EvolucaoMidia.url`,
`ExameNutricional/ExameClinico/ExameImagemAnexo.arquivoUrl`, `EmpresaConfiguracao.logoUrl`
e `UsuarioEmpresa.foto_url`. Não apaga nada do disco.

### Frontend
- Upload de fotos: compressão via Canvas (máx 1200px, 82% JPEG) antes do envio.
- A URL guardada continua **relativa** (`/api/midia/<chave>`), então `<img src>` e
  `printUrl` funcionam sem mudança: é requisição same-origin e o cookie HttpOnly viaja.
- O proxy `/uploads` do Vite foi REMOVIDO — `/api` já cobre as duas rotas.

---

## 9. DECISÕES ARQUITETURAIS ATIVAS

| Decisão | Escolha | Motivo |
|---|---|---|
| ORM | Prisma | Type-safety, migrations, multi-db |
| Auth Google | useGoogleLogin (access_token) | Remove "Continuar como X", força seleção |
| Layout scroll | overflow-y-auto no main | Páginas públicas livres, internas controladas |
| Mobile pattern | cards mobile / tabela desktop | UX otimizada por breakpoint |
| Upload | Canvas compress antes do envio | Reduz tráfego e storage |
| Storage | Arquivo no BANCO (bytea), `STORAGE_DRIVER=db` | Nada servido do FS: download passa pela regra de acesso |
| Escala de storage | `S3StorageProvider` + `STORAGE_DRIVER=s3` | Interface pronta; nenhum controller muda (ver §8) |
| IA Provider | Google Gemini (único) | Um só fornecedor p/ texto, visão e áudio — abstraído por AIProvider |
| Schema PG | schs2vet | Isolamento multi-tenant futuro |
| Soft delete | campo `ativo` | Preservação histórica |

---

## 10. REGRAS INVIOLÁVEIS

### NUNCA fazer
- Usar `any` no TypeScript
- Hardcodar strings visíveis (sempre i18n)
- Colocar regra de negócio no controller
- Fazer query direta fora de service/repository
- Criar componente com mais de ~300 linhas sem decompor
- Acoplar código ao provider de cloud/storage/IA sem abstração
- Servir arquivo do filesystem (`express.static`/`sendFile`) — ver §8
- Expor URL pública/assinada de bucket ao cliente — o download passa por `/api/midia/:chave`
- Criar `min-h-screen` em páginas internas (quebra o layout)
- Deixar arquivos residuais (App copy.tsx, test-*.js, etc)
- Hardcodar URLs, portas ou credenciais (sempre env vars)

### SEMPRE fazer
- `PageContainer` como wrapper de toda página interna
- Mobile-first: cards mobile → tabela desktop
- Tipar completamente props, retornos e estados
- Usar chaves i18n para todo texto visível
- Controllers enxutos → services com regra de negócio
- Variáveis de ambiente para toda configuração externa
- Logar operações de IA em `AiUsageLog`
- Soft delete via campo `ativo` (não deletar registros clínicos)
- Índices explícitos em FKs e campos de busca

---

## 11. CONTEXTO DE DESENVOLVIMENTO

```
OS: Windows
Editor: VS Code + Claude Code Extension
Frontend URL: via Cloudflare Tunnel (HTTPS)
Backend: localhost:3001
Banco: PostgreSQL (schema: schs2vet) — dev e prod
```

### Comandos úteis
```bash
# Frontend
cd frontend && npm run dev

# Backend
cd backend && npm run dev

# Prisma
npx prisma migrate dev --name <nome>   # cria + aplica migration (usa shadow DB)
npx prisma migrate deploy              # aplica migrations pendentes (sem shadow DB — usar após P3006)
npx prisma migrate resolve --rolled-back <migration_name>  # desmarca migration falha
npx prisma studio
npx prisma generate

# Seeds (rodar sempre após nova migration que adiciona módulos)
node backend/seed.js

# Testes
cd backend && npm test
cd backend && npm run test:coverage
```

### ⚠️ Windows — Prisma type resolution
O Prisma gera o client em `node_modules/.prisma/client/` mas o TypeScript
resolve via `@prisma/client` que espera o caminho relativo `.prisma/client/`.
No Windows, o npm **não** cria o symlink automaticamente. Após `npm install`,
`npx prisma generate` ou quando os tipos não resolverem, execute:

```powershell
# Remove pasta real (se existir) e cria junction
Remove-Item -Recurse -Force "backend\node_modules\@prisma\client\.prisma" -ErrorAction SilentlyContinue
New-Item -ItemType Junction `
  -Path "backend\node_modules\@prisma\client\.prisma" `
  -Target "backend\node_modules\.prisma"
```

---

## 12. PRÓXIMAS EVOLUÇÕES PLANEJADAS

### Sessão 2026-09-16 — A chave única sem empresa e o erro cru na tela

> ✅ **MIGRATION APLICADA** (autorizada nesta sessão) —
> `20261011000000_medicamento_unique_por_empresa`. Substitui a UNIQUE legada
> `(nome, formaFarmaceutica, apresentacao)` por
> `(nome, formaFarmaceutica, apresentacao, unidade, empresa_id) NULLS NOT DISTINCT`.
> Não altera nem remove NENHUMA linha. Aplicada com o DONO (`nutriadmin`):
> `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy` — com o usuário da
> APLICAÇÃO morreria com `42501 must be owner of table`.
> `migrate status` depois: **199 migrations, "Database schema is up to date!"**, e o
> índice conferido no banco:
> `(nome, "formaFarmaceutica", apresentacao, unidade, empresa_id) NULLS NOT DISTINCT`.
> **`prisma generate` não é necessário**: a chave não está no `schema.prisma` (o Prisma
> não expressa `NULLS NOT DISTINCT`), exatamente como a chave ANTIGA também não estava.

- [x] 🔴 **O COPY-ON-WRITE DO CATÁLOGO NUNCA FUNCIONOU — e o erro ia cru para a tela.**
      O relato foi "ao alterar o medicamento explode o erro na tela", com o dump do
      Prisma inteiro. São DOIS defeitos empilhados, e cada um precisa da sua correção:
      o banco recusava a cópia, e o controller publicava a recusa crua.
      **A prova de que nunca funcionou não é inferência**: `tb_medicamentos` tem 8.255
      linhas e **ZERO** com `empresa_id` preenchido. A regra está escrita em
      `lib/unidadeMedicamento.js` desde 2026-09-12 e em `lib/catalogoEmpresa.js` desde
      2026-09-15; o índice a recusava desde antes das duas.
- [x] **A chave nova**: `(nome, formaFarmaceutica, apresentacao, unidade, empresa_id)`.
      ⚠️ `empresa_id` é o que resolve o defeito — é ele que dá a cada clínica o seu
      espaço de nomes. `unidade` entra **a pedido** (2026-09-16) e tem efeito próprio:
      a mesma apresentação em unidade diferente passa a poder coexistir no catálogo.
      ⚠️ **`NULLS NOT DISTINCT`** mantém o lado GLOBAL tão protegido quanto antes: sem
      ele, NULL seria valor distinto e duas linhas globais idênticas passariam.
      ⚠️ **"vias" não entra**: é 1:N em `tb_medicamento_vias`, e índice único só alcança
      colunas da própria tabela. A unicidade das vias já existe lá
      (`@@unique([medicamentoId, via])`).
- [x] ✅ **VERIFICADA AO VIVO, em transação REVERTIDA** (0 linhas ao fim, índice antigo
      intacto no banco):
      ```
      ANTES  da migration  RECUSADO  cópia da empresa 58 (o defeito relatado)
      DEPOIS da migration  ACEITO    cópia da empresa 58
                           ACEITO    cópia da empresa 42 do MESMO item (tenant vizinho)
                           RECUSADO  2ª cópia idêntica da 58
                           RECUSADO  2ª linha GLOBAL idêntica (NULLS NOT DISTINCT)
                           ACEITO    linha GLOBAL com outra unidade
      ```
- [x] 🔴 **`lib/erroResposta.js` — o erro cru parou de chegar à tela.**
      O padrão exato do defeito era `error: err.message || 'texto amigável'`: o fallback
      **nunca dispara**, porque a mensagem do erro quase sempre está preenchida. Para
      quem usa o sistema, "Invalid `tx.medicamento.create()` invocation in
      D:\Projetos\…" não diz nada acionável; e é vazamento de caminho de arquivo, nome
      de tabela e estrutura interna do servidor.
      ⚠️ **Regra de negócio continua passando inteira** — é a metade que importa: o
      texto de `UnidadeIndisponivelError` ("este item já teve saída de estoque na
      unidade atual (g)") é o que resolve o caso da pessoa. O helper distingue os dois
      pelo `status` (4xx = escrito para ser lido).
      Traduções: P2002→409, P2003→409, P2025→404, `IA_QUOTA_EXCEDIDA`→429. O resto é
      500 com a frase que o controller escolheu; o original vai ao log com stack.
      ⚠️ **`err.meta.target` NUNCA vai na resposta**: são nomes de coluna do banco, e
      com o índice fora do schema o Prisma devolve "(not available)" — na tela viraria
      uma frase sem sentido.
- [x] 🔴 **O GATE ACHOU MAIS SEIS ARQUIVOS com o mesmo defeito**, que é o que o pedido
      mandava procurar: `PermissaoController` (7 handlers iguais), `AudioController`,
      `ComposicaoAlimentarController`, `EquipeController`, `relatorio.controller`,
      `RelatorioNutricionalController`, `ExameController` (2) e `NotaFiscalController`
      — neste último o `motivo` é EXIBIDO na tela e vinha da mensagem crua.
      ⚠️ `GoogleController` usa `parsed.error.message ||` para montar um `Error`
      INTERNO, não uma resposta — o gate foi apertado para olhar a CHAVE DE RESPOSTA
      (`error:`/`mensagem:`/`motivo:`), senão ele acusaria código correto.
- [x] ⚠️ **O FRONT não foi tocado, de propósito.** `Produtos.tsx` já fazia
      `e.response?.data?.error ?? 'Erro ao salvar o produto.'` — ele exibiu fielmente o
      que o backend mandou. Um sanitizador na tela esconderia junto as mensagens de
      NEGÓCIO, que são justamente as que ajudam.
- [x] Gate novo `__tests__/erroNaoVazaParaTela.test.js` (9 casos): o comportamento do
      helper (dump não vaza, stack não vaza, negócio passa, P2002/P2025 traduzem) e a
      VARREDURA dos controllers.
      ⚠️ A varredura IGNORA COMENTÁRIOS — sem isso ela acusa a própria documentação da
      regra e vira ruído que se aprende a ignorar (mesma lição do gate de e-mail).
      ✅ **Verificado que REPROVA**: reintroduzido o `err.message || …` em
      `ProdutoController.criar`, **2 dos 9 falharam**. Suíte: **1032**;
      `tsc --noEmit` (backend) limpo.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [x] ✅ **CONFERIDO COM O CÓDIGO REAL depois de aplicar**, em transação REVERTIDA:
      `salvarItemDoCatalogo` foi chamada contra a base trocando **só o fabricante**, **só
      as vias**, **só a unidade** e **só o "controlado"**, em MEDICAMENTO e em VACINA
      globais — os 5 casos passaram, todos com `copiado: true`. E duas edições SEGUIDAS
      do mesmo item global devolvem o MESMO id (1 cópia no catálogo da clínica, não 2):
      quem garante isso é `copiaExistente`, que casa por (nome, empresa).
      ⚠️ A correção de TELA e a de BANCO são independentes de propósito: a primeira vale
      para QUALQUER erro futuro, inclusive os que ainda não existem.
- [ ] O `err.message` ainda aparece em `lib/concorrenciaRegistro.js` e no handler global
      de `server.ts` — os dois são casos legítimos (mensagem de conflito escrita para
      ser lida; e o global já troca 500 por "Erro interno do servidor"). O gate cobre só
      `src/controllers`; estender a `src/lib` exigiria distinguir, um a um, os erros de
      negócio que nascem lá.

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

### Sessão 2026-09-15 (parte 4) - Catálogo da empresa antes do global; laboratório da vacina

> **SEM MIGRATION nas duas frentes.** `migrate status` conferido: 198 migrations, banco
> em dia, nada pendente — e as colunas das duas últimas conferidas no
> `information_schema`. O laboratório reusa uma tabela que JÁ EXISTE.

#### A. Ordem: o que é da empresa vem antes do catálogo global

- [x] 🔴 **O PROBLEMA, medido:** para o animal 93 (empresa 58, Equino) o catálogo visível
      tem **2 medicamentos em estoque + 3 cadastrados pela clínica contra 4.368 globais**.
      Em ordem alfabética pura os cinco ficavam perdidos no meio — e são exatamente os que
      ela usa todo dia.
- [x] 🔴 **"DA EMPRESA" É A UNIÃO DE TRÊS COISAS** (definição do usuário, 2026-09-15):
      ```
      0. EM ESTOQUE              - a clínica tem o frasco (mesmo que a linha do
                                   catálogo seja GLOBAL: estoque é sempre de UMA empresa)
      1. PRODUTO de fornecedor   - não tem, mas sabe de quem comprar
      2. CADASTRADO pela clínica - a cópia dela no catálogo (`empresa_id`), que é o que
                                   `/cadastro/produtos` grava, sem estoque nem fornecedor
      3. GLOBAL puro             - o resto do catálogo do sistema
      ```
      ⚠️ **NÃO reduzir o grupo a `empresaId != null`**: foi a primeira versão desta
      sessão, e ela mandava para baixo o medicamento GLOBAL que a clínica TEM EM ESTOQUE —
      justamente o que está na prateleira.
      ⚠️ Os três grupos de 2026-09-10 (estoque → produto → o resto) CONTINUAM valendo: o
      antigo grupo 2 foi PARTIDO em dois, separando a cópia da clínica do catálogo global.
      ⚠️ Vale para MEDICAMENTO e VACINA — é a mesma função.
      ⚠️ `empresaId` **não vai para o payload**: a origem viaja num `Map` id → booleano
      montado logo após a consulta, porque `dados` remonta os objetos e perderia o campo.
- [x] 🔴 **A PRIMEIRA PÁGINA SAI ORDENADA PELO BANCO** — `ordemEmpresaPrimeiro(req,
      relacaoEstoque)`, fonte única usada por `listar` e `paraAtendimento`:
      `[{ <estoque>: { _count: 'desc' } }, { empresaId: 'asc' }, { nome: 'asc' }]`.
      **Ordenar só em JS não bastaria**, e o modo de falhar é silencioso: `listar` PAGINA
      (a Farmácia pede `limit=5000`, o catálogo do ADMIN pagina de 30 em 30) e a Prescrição
      abre o dropdown com **`limit=5`** enquanto o catálogo completo carrega em paralelo.
      Com `ORDER BY nome`, o item da clínica nem entraria nessa primeira página quando o
      nome fosse alfabeticamente tarde — a pessoa abriria o seletor, veria só globais e
      concluiria que o cadastro dela não funcionou.
      ⚠️ **A CONTAGEM É ESCOPADA PELO RLS**, não por `where`: `tb_estoque_clinica` e
      `tb_lotes_vacina` estão com ENABLE+FORCE, então a subconsulta do `_count` só enxerga
      as linhas da empresa da sessão. **Verificado ao vivo**: carimbando 58 e 42, o topo
      vem com itens diferentes e nada vaza.
      ⚠️ Ela conta a entrada **INATIVA** também (o `_count` do Prisma não aceita filtro) —
      aceitável: é item com que a clínica já lidou, e quem decide o grupo de verdade é o sort.
      ⚠️ **A relação muda por TIPO** — `lotes` na vacina, `estoques` no medicamento.
      Passar a errada faz a contagem sair sempre ZERO, em silêncio.
      ⚠️ `empresaId: 'asc'` e NUNCA `'desc'`: no Postgres ASC é NULLS LAST, então o
      não-nulo (a empresa) vem primeiro. Mesma precedência de `garantirMedicamentoDaEmpresa`.
      ⚠️ **ADMIN da plataforma fica de fora** (`escopado = userType !== 'ADMIN' &&
      req.empresaId`): ele vê o catálogo de TODAS as clínicas, e ali `empresaId asc`
      agruparia por id de empresa — ordem sem sentido na tela dele.
      ⚠️ O sort em JS **não é redundante**: ele conhece o vínculo de FORNECEDOR, que só
      existe depois do mapeamento.
- [x] ⚠️ **A LISTA DE LOTES da Farmácia NÃO foi reordenada.** Chegou a ser (primeira
      versão) e foi REVERTIDA: ali TODO item está em estoque, logo todos são "da empresa"
      pela definição acima, e agrupar por origem da linha do catálogo seria ruído.
- [x] **O front não precisou de nada** — `SubModuloPrescricao` e `Farmacia` filtram com
      `.filter` (que preserva a ordem); os únicos `.sort()` dessas telas são de
      especialidade e de unidade.
- [x] ✅ **Verificado ao vivo** (leitura, com `app.plataforma`/`app.empresa_id` carimbados —
      sem carimbo o FORCE RLS devolve 0 e parece catálogo vazio, armadilha 42): a simulação
      completa do `paraAtendimento` para o animal 93 devolveu 2 / 0 / 3 / 4.368 nos quatro
      grupos, com a primeira página (`limit=5`) em **9 ms**. Os `orderBy` também foram
      executados pelo client Prisma para validar o SHAPE — erro de forma de `orderBy` só
      aparece na chamada e derrubaria a tela em runtime.
- [x] **Gate ampliado** em `__tests__/produtosContasPagar.test.js` (4 grupos, o `Map` de
      origem, `ordemEmpresaPrimeiro` nas duas consultas, o `_count`, o `asc` e a exclusão
      do ADMIN). ✅ **Verificado que REPROVA** duas vezes.
- [ ] O **Estoque de Vacinas** não entrou nesta ordenação: o seletor dele é SQL cru com
      `ORDER BY nome ASC` e a lista de lotes é **FEFO** (`validade asc`) — ali a ordem é
      regra clínica, não preferência de exibição.
- [ ] A tela não DIZ de onde vem cada item (não há selo "do sistema" na busca da
      prescrição, como já existe em `/cadastro/produtos`): a ordem agrupa sem explicar o
      agrupamento. Se incomodar, o gancho é o mesmo `Map` de origem.

#### B. Laboratório no Estoque de Vacinas

- [x] 🔴 **O LABORATÓRIO NÃO TEM TABELA PRÓPRIA** — sempre foi texto na coluna
      `fabricante` de `tb_medicamentos`. Consequência: ele só passava a existir DEPOIS que
      alguém cadastrasse uma vacina com ele, e `listarFabricantes` filtra
      `fabricante IS NOT NULL`. Logo, **vacina sem laboratório não tinha como ser filtrada**:
      escolher qualquer laboratório a escondia, e só "Todos" a mostrava. Medido: **52
      vacinas** nesse estado nesta base, contra **6 laboratórios** conhecidos.
- [x] **O campo virou "Laboratório"** e ganhou três coisas:
      **"Outros (sem laboratório informado)"**, **"+ Cadastrar novo laboratório..."** e a
      lista como **UNIÃO** do que está nas vacinas com o catálogo da clínica.
- [x] 🔴 **SEM MIGRATION — reusa `tb_catalogo_tipo_servico`, categoria `LABORATORIO`**,
      a MESMA tabela dos tipos de fornecedor/prestador/localização. Reusá-la traz de graça
      o tenant, a policy de RLS (ENABLE+FORCE) e o gate de permissão; um catálogo novo
      exigiria repetir os três — **mesma decisão de 2026-09-08 para os tipos de local**.
      Conferido no banco: `categoria` é `VARCHAR(20)` **sem CHECK** e 'LABORATORIO' tem 11
      caracteres.
      ⚠️ Gate `vacina.estoque.criar` — quem dá entrada de vacina é quem conhece o
      laboratório. **NÃO** `medicamentos.catalogo.criar`, que é ADMIN-only (catálogo
      GLOBAL) e deixaria a opção morta para a clínica.
      ⚠️ Categoria em `CATEGORIAS_VALIDAS` **sem entrada em `SLUG_CRIAR`** faz
      `getNivelEfetivo` receber `undefined` e devolver NENHUM: a opção aparece e nunca
      grava, sem dizer por quê. Há gate para isso.
- [x] 🔴 **A SENTINELA `__SEM_FABRICANTE__` precisa ser IDÊNTICA nos dois lados.** String
      vazia já significa "todos", então "sem laboratório" precisa de valor próprio.
      Divergindo, o backend procura um laboratório com esse NOME e "Outros" volta vazio —
      a pessoa conclui que não há vacina sem laboratório. Há gate travando os dois arquivos.
      ⚠️ Ela **NÃO vira parâmetro** da consulta: o filtro é a própria ausência do campo.
- [x] ⚠️ **O VAZIO CONTA COMO AUSENTE** (`btrim(...) = ''`), não só o NULL: o campo
      Fabricante do cadastro é opcional e grava string vazia quando alguém passa por ele sem
      digitar. Olhando só o NULL, essas vacinas ficariam fora de "Outros" **E** de todo
      laboratório — exatamente o problema que "Outros" veio resolver. Nos DOIS ramos da
      consulta (com e sem recorte por espécie).
- [x] ⚠️ **"Outros" só aparece havendo o que filtrar** (`semFabricante`, respondido pelo
      BACKEND): opção que não filtra nada é botão morto — a mesma regra da aba vazia. Quem
      sabe disso é o servidor: a tela só conhece as vacinas do laboratório filtrado.
- [x] ⚠️ **Laboratório novo digitado no CADASTRO da vacina já entra no seletor**, sem
      recarregar a tela: a lista de laboratórios só é recarregada em `carregarLotes`, e sem
      isso o nome recém-digitado no modal só apareceria depois de um refresh — a pessoa
      concluiria que o cadastro dele não pegou. Vacina cadastrada SEM laboratório liga o
      `temSemFabricante`, porque agora existe algo em "Outros".
- [x] ⚠️ **Dedup sem olhar a caixa**, nos dois lados: 'Zoetis' e 'ZOETIS' são o mesmo
      laboratório, e duas linhas iguais no seletor fariam a pessoa escolher uma ao acaso. A
      grafia da VACINA vence a do catálogo — é a que já está gravada no item.
- [x] ⚠️ **A leitura do catálogo NÃO lança**: base sem a tabela devolve lista vazia e a
      tela cai no comportamento antigo. Derrubar a lista de laboratórios impediria TODA
      entrada de vacina por causa de um recurso acessório.
- [x] **UM SÓ CAMINHO DE ESCRITA** — `criarTipoCatalogo(categoria, nome)` foi extraído e
      EXPORTADO de `TipoServicoSelect.tsx`, e o `useCatalogoTipoServico` passou a usá-lo.
      `NovoTipoInput` também foi exportado (com `rotulo` opcional, que só troca as
      PALAVRAS). Duas versões divergiriam no QUE ENTRA no catálogo da clínica (28-g).
      ⚠️ `__novo_lab__` é valor **só da TELA** e nunca vai ao backend — mandá-lo
      procuraria um laboratório com esse nome e a lista de vacinas voltaria vazia.
- [x] ✅ **RLS conferido ao vivo, em transação REVERTIDA** (0 linhas ao fim): a empresa 58
      grava o laboratório e o lê de volta; a empresa 42 enxerga **0**.
- [x] **Gate novo** `__tests__/laboratorioVacina.test.js` (15 casos). ✅ **Verificado que
      REPROVA**: sentinela divergente + só NULL → 2 casos falharam; removida a chamada de
      `labsDoCatalogo` da união → 1 caso falhou.
      ⚠️ Um dos casos nasceu FROUXO (casava a DEFINIÇÃO de `labsDoCatalogo`, que continua
      existindo com a chamada removida) e foi apertado para exigir a chamada dentro da
      união. Lição repetida: "a função aparece" não é asserção — sabote e confira.
      Suíte: **1009**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] O laboratório cadastrado pela tela **NÃO é aplicado à vacina** — ele passa a existir
      no seletor e filtra, mas quem grava `fabricante` no item continua sendo o cadastro da
      vacina (`CadastroCatalogoModal`, campo opcional). Corrigir o laboratório de uma vacina
      já cadastrada segue sendo pelo catálogo.
- [ ] Não há tela para EDITAR ou REMOVER laboratório do catálogo (o
      `CatalogoTipoServicoController` só expõe listar e criar) — vale para as quatro
      categorias, não só esta. Nome digitado errado fica na lista.
- [ ] A opção "Outros" existe só no seletor do FORMULÁRIO de entrada. A busca da lista de
      lotes (topo da tela) continua por texto livre.

### Sessão 2026-09-15 (parte 3) — O e-mail traz o cadastro que a clínica já tem

> **SEM MIGRATION.** Nenhuma coluna nova: a funcionalidade só LÊ `tb_prestadores`,
> `tb_fornecedores`, `tb_proprietario_perfis` e `tb_usuario_empresa`. `migrate status`
> conferido — 198 migrations, schema em dia, nada pendente.

- [x] 🔴 **O PROBLEMA: o cadastro que a clínica já tinha era redigitado — e o e-mail
      repetido só aparecia no SALVAR.** Prestador, Fornecedor e Proprietário são
      cadastros de PESSOA, e a mesma pessoa aparece em mais de um deles (a prestadora
      que também é cliente, a veterinária que passa a atender como externa). Até aqui o
      gestor preenchia documento, telefone e endereço do zero e, quando o e-mail já
      existia, levava **409 no fim** — com o formulário inteiro preenchido.
      Agora, ao SAIR do campo de e-mail, o backend responde uma de três coisas:
      ```
      CADASTRO → já existe o registro DAQUELE tipo aqui → a tela CARREGA e passa a EDITAR
      PESSOA   → conhecida em OUTRO papel nesta empresa → preenche só o que está VAZIO
      nada     → desconhecida AQUI                      → segue como sempre foi
      ```
      Vale nas QUATRO telas de cadastro de pessoa: **Prestador, Fornecedor,
      Proprietário e Incluir Membro** (Cadastro › Equipe).
- [x] 🔴 **FONTE ÚNICA `lib/cadastroPorEmail.js`** (espelho no front em
      `utils/cadastroPorEmail.ts`). As três regras que não se afrouxam:
      **(1)** o `users` é IDENTIDADE — a busca por e-mail ali pede `select: { id: true }`
      e nada mais; nome/telefone/documento/endereço saem SEMPRE de `tb_usuario_empresa`
      DESTA empresa (§36). Ler do `users` devolveria o cadastro que a clínica vizinha
      digitou, e a tela o exibiria como se fosse dela — **o sintoma é um formulário
      preenchido "certo"**, que ninguém desconfia.
      **(2)** **FAIL-CLOSED sem `req.empresaId`**: sem empresa não existe "cadastro desta
      empresa" a trazer. Nunca cair no vínculo mais recente.
      **(3)** **NUNCA `comEscopoPlataforma`** neste caminho — é ele que levanta o filtro
      de tenant, e é justamente ele que impede o vazamento. Há gate travando os três.
      ⚠️ **"Não existe" e "existe em OUTRA clínica" são a MESMA resposta**, de propósito:
      distingui-las transformaria o campo num verificador de cadastro alheio.
      ⚠️ Campo `null`, vazio **ou só com espaços** não entra no pacote — `null` aqui é
      "vazio NESTA empresa", não "use o da outra". Mandar dois espaços faria a tela dar o
      campo por preenchido (`preencherVazios` para de vê-lo em branco) e o formulário
      sairia com um espaço. **Foi o teste que pegou o caso do espaço em branco.**
      ⚠️ Remuneração, mensalista e dia de vencimento ficam FORA de `CAMPOS_PESSOA`: são o
      acordo de UM papel, e herdá-los noutro cadastro afirmaria um combinado que ninguém
      fez. Há teste travando a lista.
- [x] ✅ **RLS CONFERIDO AO VIVO**, e é ele quem garante — não o `where` do controller.
      `tb_prestadores`, `tb_fornecedores`, `tb_proprietario_perfis` e
      `tb_usuario_empresa`: **ENABLE + FORCE** com `app_plataforma() OR empresa_id =
      app_empresa_id()`. Medido com a consulta mais frouxa possível (**só o e-mail, sem
      nenhum filtro de empresa**): a sessão da DONA encontra, a da VIZINHA **não
      encontra**, e sem contexto de empresa também não. Verificado também o fluxo
      completo em transaction REVERTIDA (0 linhas ao fim): a empresa A lê o cadastro de
      `tb_usuario_empresa`, o nome legado do `users` **não vaza**, e a empresa B não
      enxerga nada. E os 4 endpoints foram chamados de verdade contra a base (e-mail que
      existe → CADASTRO com o registro completo; o MESMO e-mail na clínica vizinha →
      `encontrado: false`; sem e-mail → 400; membro sem gestor → 403).
      ⚠️ A policy de `tb_prestadores`/`tb_fornecedores` **não tem o termo
      `empresa_id IS NULL`** — linha GLOBAL (SYSTEM) é invisível para o tenant. O ramo
      `{ empresaId: null }` do `where` da listagem é, na prática, letra morta sob RLS.
- [x] 🔴 **O ESCOPO DA BUSCA É O MESMO DA LISTAGEM** — `escopoVisivel(req)` foi EXTRAÍDO
      do `listar` de Prestador e de Fornecedor e passou a ser consumido pelos dois
      caminhos. Duas cópias divergiriam, e o que divergiria é a resposta a "este cadastro
      existe aqui?": a busca carregaria para edição um registro que a lista não mostra —
      ou deixaria criar a duplicata de um que ela mostra. No Proprietário o recorte é o
      de `listar`/`obterPorId` (`whereEhClienteDaEmpresa` + `whereProprietarioNoEscopo`).
      ⚠️ **As duas cláusulas do Proprietário são empilhadas em `AND`, NUNCA espalhadas**:
      as duas devolvem `{ OR: [...] }`, e no mesmo objeto a segunda APAGA a primeira —
      o recorte por empresa sumiria em silêncio. Foi assim que a primeira versão saiu, e
      é o que o gate estrutural trava.
- [x] **Rotas novas, todas LITERAIS antes de `/:id`** (armadilha 1 — o Express leria
      "por-email" como id e o formulário nunca preencheria, sem erro na tela):
      `GET /cadastro/{prestadores,fornecedores,proprietarios}/por-email?email=` (gate
      `cadastro.<modulo>.ler`) e `GET /equipes/cadastro-por-email?email=`.
      ⚠️ **O Incluir Membro é GESTOR-only** (checado no controller, como o próprio
      `incluirMembroDireto`): a rota devolve CPF e endereço de terceiros, e com só
      leitura ela entregaria isso a qualquer um.
      ⚠️ Lá **nunca se carrega para edição** — quem edita membro é a linha da lista, com
      o fluxo próprio. `jaMembro` é AVISO ANTECIPADO; o veredito continua sendo o 409 do
      salvar (a inclusão é por EQUIPE, e a checagem aqui é por EMPRESA).
- [x] **Front**: `CampoValidado` ganhou `aoSairDoCampo` (dispara junto da validação —
      um gancho por tecla viraria uma consulta por caractere) e nasceu
      `components/AvisoCadastroEncontrado.tsx`, fonte ÚNICA da faixa nas quatro telas.
      Preencher sozinho SEM dizer por quê assusta: a faixa conta de onde vieram os dados
      e se o Salvar vai CRIAR ou ATUALIZAR (âmbar quando a consequência muda).
      ⚠️ **Só no cadastro NOVO**: em edição, trocar o registro debaixo de quem está
      editando seria pior que o erro que isto evita.
      ⚠️ `setForm` **funcional**: a resposta chega depois, e um patch calculado sobre o
      `form` da closure apagaria o que foi digitado durante a espera.
      ⚠️ O documento preenche `cpf`/`cnpj` **e acerta o seletor CPF/CNPJ junto** — só o
      campo deixaria o número invisível atrás do botão do outro tipo.
      ⚠️ `emailConsultado` (ref) evita consultar de novo quando a pessoa só PASSA pelo
      campo sem mudar nada — `blur` dispara igual.
      ⚠️ A consulta **NUNCA lança** (`consultarCadastroPorEmail` engole falha, 403 e
      e-mail inválido): preenchimento automático é conveniência, e derrubar o formulário
      porque a consulta falhou trocaria um atalho por um impedimento.
- [x] **`formDeProprietario` extraída** (`ProprietarioFormModal`) — a conversão cadastro
      → formulário agora tem UM lugar, usado pelo "Alterar" da lista, pelo preenchimento
      por e-mail e pela TROCA DE PROPRIETÁRIO. Nesta última o modal resolve sozinho e
      **só preenche** (lá não existe "editar"), inclusive localidades e dia de
      vencimento, que a transferência exige preenchidos.
- [x] Testes: `__tests__/cadastroPorEmail.test.js` (24 casos) — o cadastro que vem do
      vínculo da empresa, a mesma pessoa em OUTRA empresa não encontrada, o fail-closed
      sem empresa, o `users` que não vaza, o vazio que não entra, e os GATES ESTRUTURAIS
      (rota antes de `/:id`, escopo único, o `AND` do Proprietário, o gate de gestor e a
      ausência de `comEscopoPlataforma`).
      ✅ **Verificado que REPROVA**: movida a rota para depois de `/:id` e feita a lib ler
      `fullName` do `users`, **2 casos falharam**; restaurado, os 24 voltaram.
      Suíte: **977**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [x] 🔴 **TESTE INSTÁVEL ACHADO E CORRIGIDO NA RAIZ** (`externoNaoEhEquipe.test.js`):
      o caso "revogar NÃO apaga o vínculo" falhava ~1 em 8 execuções da suite COMPLETA
      (isolado passava sempre). Causa: `jest.mock(..., { virtual: true })` em
      `lib/usuarioEmpresa` e `lib/logger`, que são `.js` REAIS — um worker que já
      tivesse carregado o módulo verdadeiro num arquivo anterior resolvia o REAL, e
      `salvarPagamentoEAcesso` deixava de ser um `jest.fn()`. O flag saiu dos dois.
      ⚠️ **`virtual: true` SÓ em módulo que o jest realmente não resolve** (`lib/prisma`
      é TypeScript). É a MESMA lição de 2026-09-10 (parte 2), e o defeito estava
      dormindo desde 2026-09-09 — só apareceu porque o arquivo de teste novo mudou o
      escalonamento dos workers. 10 execuções completas em verde depois da correção.
- [ ] **Tratador não tem e-mail** (`tb_tratadores` só guarda nome/telefone/local), então
      ficou de fora — não há chave por onde reconhecer a pessoa. Localizações, Produtos,
      Procedimentos e Vacina não são cadastros de pessoa.
- [ ] O cadastro do PACIENTE já trazia o proprietário por e-mail desde antes
      (`GET /users/buscar-proprietario`, tenant-scoped), e continua no caminho próprio:
      lá o formulário só tem nome e telefone do cliente, então não há endereço a
      preencher. Se um dia ganhar mais campos, o lugar de unificar é este endpoint novo.
- [ ] A consulta dispara no `blur`. Quem digita o e-mail e clica DIRETO em "Salvar" pode
      ter o salvar no mesmo instante da consulta — o backend continua sendo a autoridade
      (409 de duplicata), então o pior caso é o comportamento antigo.

### Sessão 2026-09-15 (parte 2) — O prestador passou a ter VÁRIOS tipos de serviço

> ✅ **MIGRATION APLICADA** (autorizada) — `20261010000000_prestador_tipos_servico`:
> `tb_prestadores.tipo_servico` de `VARCHAR(50)` para `VARCHAR(255)`. ALARGAR não perde
> dado e não muda linha nenhuma. Conferido no `information_schema`: `tb_prestadores` em
> 255, **`tb_fornecedores` intacta em 50**; e as 3 linhas existentes seguem lá, todas com
> um tipo só (maior = 13 caracteres).
> ⚠️ A contagem exigiu `set_config('app.plataforma','on',true)` — sem o carimbo o FORCE
> RLS devolve 0 e parece tabela vazia (armadilha 42). A primeira leitura caiu nisso.
> ⚠️ `prisma generate` falhou com EPERM (§11, backend rodando) e **não faz falta**:
> `@db.VarChar` é metadado de schema, o Client não valida comprimento — quem recusava o
> valor era o Postgres, e ele já aceita 255. Mesmo precedente da `20260914000000`.

- [x] 🔴 **O CADASTRO OBRIGAVA A ESCOLHER UMA ATUAÇÃO SÓ.** O prestador é o profissional
      EXTERNO, e ele acumula: o mesmo profissional é ferrador **e** fisioterapeuta. Com
      um valor só, quem cadastrava escolhia uma e a outra sumia do filtro por serviço do
      encaminhamento — sem erro nenhum, porque o campo estava "preenchido".
      Agora o campo é **Tipos de Serviço**, no molde do "Especialidades" do Cadastro
      Pessoal (a pedido): um `<select>` que só ACRESCENTA + chips com X.
- [x] 🔴 **A CONVENÇÃO JÁ EXISTIA — o que faltava era o cadastro saber produzi-la.**
      Os leitores a jusante já tratam `tipo_servico` como LISTA:
      `EncaminhamentoController` monta o filtro de serviços com `tipoServico.split(',')`,
      `SubModuloEncaminhamento.servicosDoPrestador` faz o mesmo no front, e
      `PrestadorController.normalizarTipos` já comparava a lista ORDENADA na checagem de
      duplicidade. Por isso a lista continua na MESMA coluna, como CSV — **nenhuma tabela
      nova, nenhuma policy de RLS nova, nenhum backfill**.
      ⚠️ NÃO confundir com `Fornecedor.tipoServico`, que segue `VARCHAR(50)`: lá o campo é
      DERIVADO da 1ª especialidade (`tb_fornecedor_especialidades`), nunca uma lista
      digitada. Alargar os dois "por simetria" apagaria essa diferença.
- [x] 🔴 **50 CARACTERES NÃO ERAM VALIDAÇÃO — ERAM UM 500 MUDO.** Três tipos cabem
      raspando (`Fisioterapeuta, Quiroprata, Radiologista` = 40); o QUARTO passa de 50 e
      o Postgres responde `22001 value too long`, que virava "Erro ao criar prestador" na
      tela. É a mesma armadilha do status `VARCHAR(20)` de 2026-08-23 (parte 4).
      O teto do controller passou a ser `LIMITE_TIPO_SERVICO = 255`, o MESMO da coluna.
      ⚠️ E há rede: `ehColunaCurtaDeTipoServico` traduz o 22001 num **400 legível** que
      nomeia a migration. Numa base que ainda não a aplicou, o pior caso é uma frase
      explicando o que fazer — nunca um 500 sem motivo (a regra do fallback silencioso).
- [x] **`sanearTiposServico` é a fonte única do que vai para a coluna**: descarta vazio e
      vírgula solta, **remove repetido sem olhar a caixa** ("Ferrador, ferrador" → um
      chip só) e grava com o separador `", "` que os leitores esperam.
      ⚠️ Preserva a grafia do PRIMEIRO — é o nome que está no catálogo da clínica.
      ⚠️ Em `atualizar`, `tipoServico === undefined` **PRESERVA** o gravado (PATCH
      parcial); sem essa distinção, um salvar que não mencione o campo o APAGARIA.
- [x] **Um catálogo, duas formas** — `TipoServicoSelect.tsx` ganhou
      `TipoServicoMultiSelect` ao lado do `TipoServicoSelect` de sempre (Fornecedor e
      Localização seguem escolhendo UM, sem alteração de API).
      🔴 A carga do catálogo tenant-scoped e a criação de tipo novo moram em
      `useCatalogoTipoServico`, compartilhado pelas duas: duas cópias divergiriam na
      primeira correção, e o que divergiria é **o que ENTRA no catálogo da clínica**
      (armadilha 28-g). Há teste travando o hook único e o POST único.
      ⚠️ O `<select>` do multi fica em `value=""` e volta ao placeholder a cada escolha:
      deixá-lo com o último escolhido faria o campo parecer ter UM valor, que é
      exatamente o que ele existe para desfazer.
      ⚠️ Tipo já gravado que não veio no catálogo desta sessão continua aparecendo como
      CHIP (o chip sai de `value`, não das opções) — o que ele não pode é reaparecer na
      lista de "adicionar".
- [x] **A lista mostra um chip por tipo** (card mobile e tabela), e o cabeçalho da coluna
      virou "Tipos de Serviço". O par `tiposServicoDaString`/`tiposServicoParaString`
      (exportado do seletor) é quem converte nas duas pontas da tela.
- [x] Testes: `__tests__/prestadorTiposServico.test.js` (17 casos) — o CSV canônico, a
      duplicidade independente de ORDEM, a migration que alarga sem tocar em
      `tb_fornecedores` nem apagar dado, o schema em dia com a coluna, e um GATE
      ESTRUTURAL nos elos que somem em silêncio (o saneamento em criar/atualizar, o
      `undefined` que preserva, a conversão nas duas pontas da tela e o catálogo único).
      Suíte: **953**; `tsc -b` e `vite build` limpos.
      ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.
- [ ] `EquipeController` ainda corta o tipo em `slice(0, 50)` ao criar o cadastro a
      partir do "Incluir Membro" (`tipoServicoNovo`). Continua correto para FORNECEDOR
      (coluna de 50) e seguro para PRESTADOR (um tipo só, derivado da 1ª especialidade) —
      mas se aquele caminho passar a mandar lista, é ali que o corte precisa sair.

### Sessão 2026-09-15 — Produtos vira cadastro do ITEM, prestador na execução e 3 defeitos silenciosos

> ✅ **MIGRATION APLICADA** (autorizada) — `20261009000000_medicamento_multidose_empresa`:
> `multidose BOOLEAN NOT NULL DEFAULT false` + `doses_por_embalagem INTEGER` em
> **`tb_medicamentos`**. ADITIVA, sem backfill: `false`/`NULL` = o comportamento de
> hoje, nenhuma cobrança existente muda de valor.
> ⚠️ **POR QUE AGORA É SEGURO PÔR ISTO NO CATÁLOGO MISTO** — o CLAUDE.md de 12/09 dizia
> "NUNCA em `tb_medicamentos`, a linha é GLOBAL e marcá-la mudaria a cobrança de TODAS
> as clínicas". Continua verdade, e é por isso que **toda edição da tela passa por
> COPY-ON-WRITE** (`lib/catalogoEmpresa.js`): a linha global NUNCA é escrita, e o RLS
> (`WITH CHECK empresa_id = app_empresa_id()`) a recusaria mesmo que o código tentasse.
> ⚠️ `prisma generate` falhou com EPERM (§11, backend rodando) — as duas colunas são
> lidas/gravadas por **SQL cru com `catch`**, então a base não migrada cai no
> comportamento antigo em vez de derrubar o cadastro.

- [x] 🔴 **A TELA DE PRODUTOS DEIXOU DE CADASTRAR A COMPRA E PASSOU A CADASTRAR O ITEM.**
      Saíram (a pedido) **Fornecedor, Nota fiscal, Valor de compra, Valor de venda, "Ler
      documento de compra" e "Dar entrada no estoque"**. Entraram **Forma Farmacêutica\*,
      Apresentação\*, Unidade\*, Via de administração\*, Controlado\*** e **Quantidade de
      Doses**. O nome deixou de ser seletor e virou campo livre, e o **"+" saiu dos
      botões** — nem no rótulo nem como ícone.
      ⚠️ **REVERTE o escopo de 2026-09-10**, mas NÃO remove o backend daquilo:
      `tb_produtos_fornecedor`, `lib/produtoFornecedor.js`, o lançamento da conta a pagar
      na execução e `NotaFiscalController` seguem existindo e funcionando. O que sumiu é
      a porta de entrada NESTA tela. `POST /cadastro/produtos/nota-fiscal` foi
      desmontada e o controller diz onde remontá-la em uma linha.
      ⚠️ `components/produtos/LeitorNotaFiscal.tsx` foi REMOVIDO: sem chamador, seria
      código morto apontando para uma rota que não existe mais.
- [x] 🔴 **A BUSCA TRAZ O QUE JÁ ESTÁ CADASTRADO, e Alterar CARREGA os dados.** A lista é
      o catálogo VISÍVEL da clínica — o global do sistema + o próprio dela —, com selo
      "do sistema" no global. Não achou? **Novo produto** abre o formulário JÁ com o nome
      digitado na busca.
      ⚠️ **Excluir só aparece no item DA CLÍNICA**: o do sistema é de todas, e o botão
      que só falha depois do clique é a armadilha 28-d. Item da empresa é INATIVADO
      (soft delete — há prescrição e estoque apontando para ele).
- [x] 🔴 **COPY-ON-WRITE PARA TODOS OS CAMPOS** — `lib/catalogoEmpresa.js`, construído
      sobre `lib/unidadeMedicamento.js` (que passou a exportar `copiaExistente`,
      `criarCopiaDaEmpresa` e `reapontarParaCopia`). Duas implementações da cópia
      divergiriam, e o que divergiria é **para onde o estoque e a prescrição pendente
      passam a apontar** — com o item na cópia e o estoque no antigo, a dose é executada
      SEM baixa e SEM linha na fatura, em silêncio.
      ```
      item GLOBAL     → nasce a CÓPIA da empresa; ela recebe tudo; reaponta estoque
                        ATIVO, prescrição SALVO/FINALIZADO e produto de fornecedor
      item da EMPRESA → alterado no lugar
      item de OUTRA   → 404 (nunca os dados)
      ```
      ⚠️ **Cópia anterior é REAPROVEITADA e REATIVADA** (editou, voltou, editou): sem
      isso o catálogo da clínica encheria de linhas iguais.
      ⚠️ **A `classificacao` só é reescrita quando o LADO muda** (medicamento ↔ vacina):
      o global traz classificações descritivas ("Vacina viral inativada") que não devem
      virar o genérico "Vacina" por uma edição que nem tocou nisso.
      ⚠️ **A UNIDADE é o único campo com GUARD**, e só quando muda de verdade: com saldo
      gravado, trocar 'g' por 'Un.' transformaria 5.000 g em "5.000 Un.". Abrir e salvar
      sem mexer nela nunca é recusado.
      ⚠️ **Vias são apagadas e recriadas**: `createMany({ skipDuplicates })` só sabe
      acrescentar, e sem o delete não haveria como REMOVER uma via que saiu da escolha.
      🔴 **NÃO-VACINA NUNCA NASCE COM `classificacao` NULA** (`CLASSIFICACAO_MEDICAMENTO
      = 'Cadastrado na clínica'` — o MESMO valor de `lib/catalogoManual.js`). O recorte
      de "não é vacina" é `NOT: { classificacao: { contains: 'vacin' } }`, e em SQL o NOT
      sobre NULL **não é verdadeiro**: a linha fica FORA do filtro. Medido nesta base:
      `NOT (classificacao ILIKE '%vacin%')` → 7.796 linhas; com `IS NULL OR NOT (...)` →
      7.827. As 31 de diferença são INVISÍVEIS na Farmácia, na busca da Prescrição e na
      própria aba Medicamentos. A primeira versão desta lib gravava `null` e
      reintroduziu o defeito que `catalogoManual` já documentava; item salvo por esta
      tela agora também CONSERTA o legado com classificação nula.
- [x] **Quantidade de Doses: o NÚMERO É A MARCAÇÃO.** Informado (> 1), o item já nasce
      multidose; apagado, volta a ser cobrado pela embalagem inteira. Um checkbox à parte
      daria DOIS estados para a mesma decisão, e eles divergiriam.
      ⚠️ `dosesPorEmbalagemDeMedicamentos` passou a consultar DUAS fontes, e **o vínculo
      com o FORNECEDOR VENCE** quando existe: é o dado mais específico (aquele frasco,
      daquele fornecedor) e é o que já está gravado nas bases que usaram a tela antiga —
      mudar a precedência trocaria a cobrança por dose de quem já cadastrou.
      ⚠️ No ESTOQUE DE VACINAS o número do catálogo vira o **padrão de `dosesPorFrasco`**
      quando a entrada não o informa: sem isso a clínica cadastrava "10 doses" no produto
      e o lote nascia valendo 1, cobrando o frasco inteiro a cada aplicação.
- [x] **Os SELETORES são os MESMOS do cadastro rápido do atendimento** —
      `components/catalogo/SeletoresCatalogo.tsx` (`SeletorBusca`, `SeletorVias`),
      extraídos de `CadastroCatalogoModal`. Duas cópias divergiriam na primeira correção,
      e o que divergiria é o que NASCE no catálogo — item com via numa tela e sem via na
      outra (28-g). O modal do atendimento ganhou o campo de doses pelo mesmo motivo, e é
      ele que a Prescrição e a Vacina abrem conforme o tipo escolhido.
      ⚠️ As opções continuam vindo do BANCO (`/medicamentos/opcoes-catalogo`), recortadas
      por TIPO: a vacina tem forma, unidade e via PRÓPRIAS.
- [x] **O item novo nasce VISÍVEL nas telas de estoque** — `especiesParaItemSemPaciente`
      (reusada do `MedicamentoController`) é a UNIÃO das duas fontes que a Farmácia
      (`especieDaEmpresa`) e o Estoque de Vacinas (`getEspeciesIds`) consultam. Uma
      versão própria cobriria só uma delas, e o produto ficaria visível numa tela e
      ausente na outra.
      ⚠️ A vacina SEM fabricante aparece no seletor de vacinas com "Todos os
      fabricantes..." (o padrão da tela), mas NÃO entra na lista de fabricantes —
      `listarFabricantes` exige `fabricante IS NOT NULL`. Por isso o campo Fabricante
      existe no formulário de vacina, ainda que opcional.

- [x] 🔴 **QUEM EXECUTOU O PROCEDIMENTO É INFORMADO NA EXECUÇÃO** (a pedido). Campo novo
      no modal de `/execucao-prescricao`, só em item PROCEDIMENTO e enquanto há dose a
      executar. O prestador escolhido **VENCE** o gravado na prescrição, é persistido no
      item (`gravarPrestadorDoItem`) e governa o preço, o **Recibo de Prestador** e a
      **conta a pagar** — tudo na MESMA transaction da cobrança do cliente.
      ⚠️ **NUNCA é obrigatório**: sem escolha a execução acontece normalmente. Travar a
      aplicação por causa de um cadastro pararia o plantão.
      ⚠️ Aplicado ANTES do laço da fatura: depois, a cobrança sairia com um prestador e o
      recibo com outro.
      ⚠️ Prestador de OUTRA empresa é descartado — o id vem do cliente.
      ⚠️ Formato `{ itemId: prestadorId }`: o "Executar Todos" manda vários procedimentos
      e cada um pode ter sido feito por uma pessoa.
- [x] **"Por procedimento" SAIU do tipo de pagamento do Prestador** (a pedido): ficam
      SALÁRIO e COMISSÃO. ⚠️ O valor `POR_PROCEDIMENTO` continua ACEITO em
      `calcularValorAPagar` — prestador já gravado assim precisa continuar tendo recibo
      apurado. O que deixou de existir é a opção de ESCOLHER isso daqui em diante.
- [x] ✅ **A COMISSÃO JÁ INCIDIA sobre o valor do procedimento/combo cadastrado** e o
      **valor TOTAL já ia para a fatura do cliente** — conferido ponta a ponta, nada
      precisou mudar (`resolverValorProcedimento` → vínculo → combo → padrão da empresa →
      catálogo; `PERCENTUAL_CLIENTE` incide sobre esse valor).
- [x] 🔴 **O QUE SOBRA DEPOIS DA COMISSÃO É O QUE APARECE NO RELATÓRIO.**
      `totalComissaoNoPeriodo` (lib do prestador) soma `valor_a_pagar` do LEDGER —
      **nunca recalcula**: o ledger é SNAPSHOT do acordo vigente na execução, e recalcular
      faria o relatório de março usar o percentual renegociado em setembro.
      ⚠️ Sai da CATEGORIA "Procedimentos" e do lucro bruto, **nunca do FATURAMENTO**:
      faturamento é o que foi cobrado, e abatê-lo ali faria o total discordar da soma das
      faturas emitidas.
      ⚠️ A categoria nunca fica NEGATIVA (piso zero): receita negativa seria lida como
      estorno.

- [x] 🔴 **A DOSE QUE NÃO FOI DADA EMPURRA AS SEGUINTES** — `agendaDaDose`
      (`ExecucaoPrescricao.tsx`). O DEFEITO relatado: procedimento 1x/dia por 2 dias
      (12/09 e 13/09); no dia 13, com a dose de 12/09 ainda não executada, a tela mostrava
      a 2ª dose com data **e hora** definidas e já vencendo — duas doses disputando o
      mesmo dia e a segunda "atrasada" antes de a primeira acontecer.
      A regra do sistema sempre foi ROLLING (o horário nasce da execução da ANTERIOR); o
      que a tela fazia era ANTECIPAR essa conta a partir do calendário original.
      Agora: a dose pendente é reapresentada HOJE com **"prescrição em atraso desde
      DD/MM"**, e as seguintes deslizam o mesmo tanto de dias.
      ⚠️ **Dose futura NÃO tem horário**, e isso não é omissão: quem o fixa é a execução
      da anterior. Mostrar a hora prescrita afirmaria um compromisso que ninguém assumiu.
      ⚠️ **Só a dose de AGORA é pintada de atrasada** — marcar as duas diria que a clínica
      perdeu duas aplicações quando perdeu uma.
      ⚠️ O deslocamento é em DIAS INTEIROS sobre o instante previsto, nunca remontando a
      data com a hora "na mão": a hora prescrita é local e o ISO é UTC (§6).
      ⚠️ É EXIBIÇÃO: quem decide o horário de verdade continua sendo o backend.

- [x] 🔴 **TRÊS DEFEITOS QUE QUEBRAVAM EM SILÊNCIO:**
      **(a) `EquipeController.criarGestor` — 500 em TODA criação de gestor.**
      `const SENHA_INICIAL = gerarSenhaInicial({ email: emailNorm, … })` estava ANTES de
      `const emailNorm = …`: `ReferenceError: Cannot access 'emailNorm' before
      initialization` (TDZ do `const`). Ordem invertida.
      **(b) O paciente mandava uma senha que NUNCA existiu.** `AnimalController.criar`
      hasheava o literal `'Inicial#001'` e o e-mail anunciava `gerarSenhaInicial(...)` —
      o cliente recebia credencial que não abria a conta, sem erro nenhum no sistema,
      porque as duas pontas nunca se comparavam. É a MESMA divergência corrigida em
      2026-09-08 no e-mail; o lado do HASH ficou para trás. ⚠️ O TELEFONE entra na
      derivação: hash com telefone e e-mail sem ele (era o caso) dão senhas diferentes.
      Agora a senha é calculada UMA vez (`senhaInicialNovoProp`) e usada nos dois lados.
      **(c) A troca de proprietário criava o login e não mandava senha nenhuma.**
      `transferirPropriedadeAnimal` passou a DEVOLVER a senha que gerou, e
      `enviarTransferenciaPropriedade` ganhou o bloco de acesso. ⚠️ `null` para quem JÁ
      tinha login — anunciar uma senha a quem já tem a sua faria a pessoa achar que a
      antiga foi trocada.
      A mensagem da tela virou **"Proprietário não encontrado, encaminhado e-mail com as
      informações de acesso"**: a senha é DERIVADA e sai só pelo e-mail — exibi-la ali a
      entregava a um TERCEIRO (quem cadastra).

- [x] 🔴 **A TELA EM BRANCO ERA O `ErrorBoundary` NO LUGAR ERRADO.** Ele só existia
      DENTRO de `ProtectedApp` — abaixo de `AuthProvider`, `EmpresaProvider`,
      `PeriodoProvider`, `SelectedAnimalProvider`, do `Router` e do `Toaster`. Erro de
      render em QUALQUER um deles passava por cima do boundary, o React desmontava a
      árvore inteira e sobrava **página branca**; e, como o console é silenciado em
      produção (`main.tsx`), sem nenhuma pista. Clicar não fazia nada porque não havia
      mais nada montado — só o recarregamento completo trazia o sistema de volta, que é
      exatamente o sintoma relatado. Agora ele também envolve a aplicação INTEIRA.
      ⚠️ Guarda o último erro em `sessionStorage` (`s2vet_ultimo_erro`) ANTES de tudo: o
      console de produção é noop, e sem isso não sobra rastro para investigar.
      ⚠️ Segunda saída: **"Limpar dados locais e entrar de novo"** — recarregar sozinho
      repete o erro quando o que está corrompido é o estado do navegador (contexto de
      empresa, paciente selecionado, rascunhos). Limpa só o LOCAL; a sessão continua
      sendo do cookie HttpOnly.
      ⚠️ O boundary NÃO captura rejeição de promessa — limitação do React, não omissão.
      ⚠️ É MITIGAÇÃO com diagnóstico, não a causa raiz identificada: o erro concreto não
      foi reproduzido. `s2vet_ultimo_erro` é o que vai permitir achá-lo da próxima vez.

- [x] **O MESMO PROFISSIONAL PODE SER VETERINÁRIO E PRESTADOR NA MESMA EMPRESA, com
      pagamentos distintos.** Os dois acordos já moravam em tabelas separadas — o do
      membro em `tb_usuario_empresa`, o do prestador em `tb_prestadores` —, e o recibo já
      lia o do PRESTADOR. O que faltava: `emitirCartaoAcesso` gravava o `cadastro` do
      prestador POR CIMA do vínculo, sobrescrevendo nome, telefone e endereço que a
      pessoa tem como MEMBRO. Agora o `cadastro` só preenche quando o vínculo NASCE ali —
      mesma razão do `perfil` e do cargo, que já eram preservados.

- [x] **UI (a pedido):**
      • **Faturamento** — o status da fatura saiu de baixo do card do proprietário e foi
        para o LADO da busca. Ao lado não cabe fileira de pílulas (a coluna tem 240px),
        então o modo compacto é um `<select>` com as MESMAS contagens.
      • **Cadastro da Empresa** — duas linhas de três: *Tempo de Consulta · Fechamento da
        Fatura · Data de Fechamento* / *Validade do Orçamento · Forma de Cobrança ·
        Percentual*. ⚠️ As duas colunas variáveis ocupam lugar FIXO na grade em vez de
        nascerem embaixo do seletor: assim a linha não se reorganiza ao trocar a forma.
      • **Sidebar › Cadastro** reordenado: Pessoal · Equipe · Pacientes · Proprietários ·
        Localizações · Tratadores · Prestadores · Fornecedores · Produtos · Procedimentos.
      • **Paciente** — Raça e Pelagem viraram `DropdownSelect` (abrem PARA BAIXO; o
        `<select>` nativo decide sozinho e não há CSS que force). **Local criável na
        hora** (`NovaLocalizacaoModal`) no cadastro do Paciente e na troca de
        proprietário: o campo é obrigatório, e sem isso a pessoa tinha de abandonar o
        formulário preenchido. ⚠️ O escopo (CLIENTE + empresa/equipe do CONTEXTO) quem
        decide é o BACKEND, nunca o corpo da requisição. ⚠️ `onMouseDown`, nunca
        `onClick`: o `onBlur` fecha a lista antes de o clique registrar.
      • **Farmácia** — "Val por Embalagem" → **Valor Unitário**; "Val Repassado por
        Embalagem" → **Valor Unitário Cobrado**; o aviso "Unidade alterada (…)" saiu. A
        REGRA da troca de unidade não mudou (segue copy-on-write) — saiu o texto.

- [x] **Documentos (MarcoVet):** removidos os 6 modelos de teste nomeados no pedido
      (`Receita Controlada`, `Receita Controlada2`, `teste1`, `rec co`,
      `Receita Controlada 3`, `controlada 4`) e criada a **Receita Controlada** a partir
      da folha em papel — `seeds/007_receita_controlada.seed.js` +
      `scripts/receitaControladaMarcoVet.js` (rodado; acervo final: `teste` e a nova).
      ⚠️ **Exclusão de verdade**, não soft delete: são modelos de TESTE, e um deles
      precisava sair do caminho — a busca da Prescrição é PELO NOME, e dois com o mesmo
      nome deixariam o recorte de controlados imprevisível. `DocumentoEmitido` não é
      tocado (é SNAPSHOT, e o FK é `SetNull`).
      ⚠️ **O modelo é DA EMPRESA, não global**: os 12 do CFMV são globais porque o
      conteúdo mínimo vem de norma federal; esta folha é o desenho desta clínica.
      ⚠️ A medicação usa a fonte `prescricao.controlados` com `formato: 'campos'` — nasce
      PREENCHIDA com o recorte que a tela de Prescrição manda. Concentração, Quantidade e
      os dados de Comprador/Fornecedor são LACUNAS: o S2Vet não os tem, e virar variável
      "parecida" produziria documento errado com cara de documento certo.
      ⚠️ O rodapé "Emitir em 2 vias: 1ª via: Farmácia | 2ª via: Proprietário(a) do
      animal" é o que faz a impressão sair em DUAS VIAS (`viasDoDocumento` lê o próprio
      papel). Some a frase, some a segunda via — e nada acusa.
      ⚠️ Rodar exige o client de TENANT dentro de `comEscopoPlataforma`: sem o carimbo o
      SELECT devolve 0 linhas e o INSERT é recusado, inclusive para o dono do schema
      (armadilha 42).

- [ ] O `ProdutoController` não oferece mais entrada de estoque nem preço de compra —
      então o item cadastrado ali só vira **conta a pagar ao fornecedor** depois que
      alguém o vincular a um fornecedor por outro caminho (`tb_produtos_fornecedor`
      continua existindo, mas ficou sem tela). Se a clínica precisar disso, o lugar é a
      Farmácia, que é quem trata de compra.
- [ ] A leitura do DOCUMENTO DE COMPRA por IA (`ler_nota_fiscal@v2`) ficou sem porta de
      entrada. `NotaFiscalController` e o serviço estão inteiros; remontar é uma linha em
      `routes/produtos.js` (ou na Farmácia).
- [ ] A comissão do prestador entra no relatório pelo LEDGER, que só existe a partir de
      2026-09-10 — execução anterior a isso não tem linha e continua contando bruto.
- [ ] As linhas LEGADAS com `classificacao` nula (**33** nesta base, medidas em
      2026-09-15) continuam invisíveis até alguém salvá-las pela tela de Produtos. Um
      `UPDATE` de backfill resolveria de uma vez — não foi feito por ser escrita em
      massa no catálogo, que pede autorização.
      ⚠️ CONSEQUÊNCIA CONHECIDA do reconhecimento por nome (§12, item 7b): o
      `por-nome` usa `coalesce` e RECONHECE essas linhas, enquanto a LISTAGEM (que usa
      o `NOT` do Prisma) não as mostra — então a faixa diz "já existe no catálogo do
      sistema" sobre um item que a busca da própria tela não acha. O lado do
      reconhecimento é o CERTO, e salvar CONSERTA a linha (`aplicarCampos` carimba a
      classificação na cópia). Alinhar a listagem seria consertar a armadilha — muda o
      que a aba Medicamentos exibe e não foi pedido.

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

### Sessão 2026-09-11 — Salvar/Cancelar na grade e o atalho "cadastrar os valores agora"

- [x] 🔴 **A GRADE DE PROCEDIMENTOS DEIXOU DE SALVAR SOZINHA** (a pedido). Os valores
      continuam SEMPRE editáveis, mas gravar virou ato EXPLÍCITO: alterou algo, aparecem
      **✓ Salvar** (emerald) e **✕ Cancelar** (vermelho) na coluna de ações da linha.
      ⚠️ **REVERTE o auto-save no blur de 10/09**, e o motivo daquela decisão continua
      valendo — não se dispara um PUT por célula visitada com Tab. É justamente por isso
      que a confirmação virou explícita em vez de mudar de evento.
      ⚠️ **NÃO existe ícone "Alterar"**, embora o pedido o citasse: com os campos sempre
      editáveis ele não teria o que destravar. Decidido com o usuário entre as duas
      formas (travar até clicar no lápis × sempre editável) — ficou a segunda.
      ⚠️ Os ícones **só são RENDERIZADOS quando há alteração pendente**: botão que na
      maior parte do tempo não faz nada é ruído, e desabilitado cairia no cinza que a §6
      reserva ao indisponível.
      🔴 **SAEM PELO `AcaoRegistro`**, a fonte única da §6 (a pedido, mesma data):
      **ícone pintado no desktop, PÍLULA COM RÓTULO no mobile**. Uma versão própria
      divergiria do resto da aplicação na primeira correção — e no celular, sem rótulo,
      ✓ e ✕ pequenos ao lado de um campo de dinheiro são alvo difícil e ambíguo.
      ⚠️ **No CARD as ações vão no RODAPÉ**, nunca ao lado do campo (§6): com rótulo
      elas espremeriam o valor até ele quebrar de linha. No bloco do prestador,
      Salvar/Cancelar e **Remover se ALTERNAM** no mesmo rodapé — remover a linha que
      está sendo editada descartaria o que foi digitado sem dizer nada.
      ⚠️ Vale na grade INTEIRA (especialidades e imagem). Dois comportamentos na mesma
      tabela fariam o gestor reaprender como salvar ao trocar de seletor.
- [x] **A LINHA virou componente** — `LinhaProcedimento`/`LinhaPrestador` (desktop) e
      `CardProcedimento`/`CardPrestador` (mobile). Dentro de um `.map` não há como ter
      estado por linha, e é a linha que guarda o texto em edição.
      🔴 **Na linha do PRESTADOR os dois valores gravam JUNTOS, numa chamada só**: eles
      moram no mesmo vínculo, e salvá-los em duas requisições deixaria a linha meio
      gravada se a segunda falhasse.
      ⚠️ O payload manda **só o que mudou**: `undefined` não toca no gravado (PATCH
      parcial) e vazio APAGA — mandar os dois sempre transformaria "não mexi" em
      "apague", que é como o valor do prestador sumiria ao editar só o do cliente.
      ⚠️ Cada linha **ressincroniza com o valor de fora, mas só sem edição pendente**:
      sobrescrever o que a pessoa está digitando porque a lista recarregou é perder
      trabalho em silêncio.
      ⚠️ Falha na gravação **devolve a linha ao valor do banco** — a tela nunca fica
      exibindo número que não foi salvo (regra preservada de 10/09).
      ⚠️ O **Remover prestador (lixeira) some enquanto há edição pendente**: excluir a
      linha que está sendo editada descartaria o que foi digitado sem dizer nada.
- [x] 🔴 **"CADASTRAR OS VALORES AGORA" — do pedido de exame para o cadastro** (a
      pedido). Escolhido o prestador na aba Imagem, os exames MARCADOS que ele ainda não
      executa por um valor (`temVinculo: false`) viram uma faixa âmbar com o atalho.
      O botão abre `/cadastro/procedimentos` com a lista **recortada só naqueles
      exames** e o prestador **já vinculado em cada um** — o gestor só digita os valores.
      ⚠️ Sem o recorte, o gestor cairia numa categoria de 56 radiografias para achar as
      3 que faltam.
      ⚠️ **NÃO bloqueia o pedido**: o exame pode ser pedido e o valor ajustado depois;
      travar aqui pararia o atendimento por causa de um cadastro.
      ⚠️ Só existe **com prestador escolhido**: sem ele o exame é da própria equipe e o
      valor padrão é o correto, não uma pendência.
      ⚠️ O aviso vem DEPOIS da escolha do exame, nunca antes — alertar sobre 56 exames
      que ninguém marcou seria ruído.
- [x] **`?codigos=PR-0302,PR-0310` no `listarComValores`** — recorte por CÓDIGO, não por
      id: é a chave estável do catálogo (a mesma do seed), enquanto id de procedimento
      global muda entre bases. Teto de 200 (a lista vem da URL, e um `in` sem limite é
      consulta cara aberta ao cliente). Exame sem código (cadastrado à mão pela clínica)
      fica fora do recorte — sem chave não há como pedi-lo.
- [x] **A tela DIZ que a lista está recortada**, com faixa emerald e o botão "Ver todos
      de <categoria>". Sem o aviso, o gestor veria 3 radiografias onde existem 56 e
      concluiria que o catálogo sumiu.
- [x] **`?vincularPrestador=<id>` cria os vínculos em LOTE** na chegada, em SEQUÊNCIA
      (nunca `Promise.all` — algumas dezenas de exames virariam uma rajada de
      requisições). A query é consumida ANTES das chamadas, senão o efeito reexecutaria
      a cada atualização da lista, que é o que ele mesmo provoca. Idempotente do lado do
      servidor: o vínculo é unique por (empresa, procedimento, prestador).
- [x] Verificado contra o banco: `Radiografia` inteira devolve 47 itens e o recorte por
      3 códigos devolve exatamente 3; código inexistente devolve 0; e
      `especialidades-minhas` não traz mais 'Diagnóstico por Imagem'.
      Suíte: **794**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] `listarComValores` não seleciona `codigo` no retorno — a tela não o exibe hoje. Se
      um dia o gestor precisar conferir o código do exame recortado, é um campo a somar
      no `select`.

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

### Sessão 2026-09-10 (parte 2) — Migrations aplicadas, grade sem lápis e dois defeitos de tela

> ✅ **APLICADAS** (autorizado): `20261001000000_procedimento_prestador` e, junto,
> `20260930000000_cargo_prestador` — que estava pendente desde 09/09 e vinha PRIMEIRO na
> fila. `node backend/seed.js` rodado.
> ✅ **APLICADA também** (autorizada em seguida): `20261002000000_combo_prestador`
> (`prestador_id` + `valor_prestador` em `tb_procedimento_combos`, ADITIVA, sem
> backfill). Conferido: as duas colunas existem e os 6 combos da base ficaram sem
> prestador — que é o estado correto (executados pela própria equipe até alguém dizer o
> contrário). `migrate status`: schema em dia, 189 migrations.

- [x] 🔴 **A MIGRATION ANTERIOR ESTAVA COM DEFEITO E BLOQUEOU A FILA.**
      `20260930000000_cargo_prestador` inseria em `tb_perfis_equipe` sem informar
      `updatedAt` → `23502 null value in column "updatedAt"`, e o Prisma marcou a
      migration como **FAILED**, o que impede aplicar qualquer outra até resolver.
      🔴 **A LIÇÃO, que vale para todo INSERT por SQL cru:** `@updatedAt` no Prisma
      significa que quem preenche o campo é o **CLIENT** — a coluna nasce NOT NULL e
      **SEM DEFAULT** no banco. Já `@default(now())` gera um DEFAULT de verdade. As duas
      anotações se parecem no `schema.prisma` e se comportam de formas opostas em SQL
      cru; `createdAt` passa, `updatedAt` estoura.
      Recuperação: `npx prisma migrate resolve --rolled-back <nome>` (o Prisma roda cada
      migration em transaction, então nada parcial ficou — conferido: 0 perfis, 0 linhas
      de matriz) → correção do SQL (`"updatedAt"` com `NOW() AT TIME ZONE 'UTC'`, nunca
      `NOW()` puro) → `migrate deploy`.
      ⚠️ Editar uma migration só é aceitável porque ela **nunca foi aplicada com
      sucesso** em base nenhuma; depois de aplicada, o checksum divergiria e o caminho é
      uma migration NOVA.
- [x] ✅ **Resultado conferido no banco**: 6 equipes → 6 perfis `PRESTADOR` + 847 linhas
      de matriz copiadas do `FORNECEDOR`; `tb_procedimento_prestadores` e
      `tb_execucoes_procedimento_prestador` com `relrowsecurity`/`relforcerowsecurity`
      true e policy `tenant_*` criada; `tb_prescricoes.prestador_id` presente; os slugs
      `financeiro.recibos.ler`/`.imprimir` no catálogo de módulos.
      As duas tabelas entraram em `TENANT_PLANE` (`__tests__/tenancyRls.test.js`) —
      agora que EXISTEM, o teste 2 as exigiria classificadas.
      🔴 **A VERIFICAÇÃO CAIU NA ARMADILHA 42.** O primeiro `SELECT count(*)` devolveu
      **0** perfis PRESTADOR e parecia que a migration não havia gravado nada — era o
      `FORCE ROW LEVEL SECURITY` escondendo as linhas de quem não carimbou
      `app.plataforma`, inclusive o dono do schema. **Conferir tabela do tenant plane
      exige o carimbo TAMBÉM na leitura** (`set_config('app.plataforma','on',true)`
      dentro da transaction), não só na escrita da migration.
- [x] 🔴 **A GRADE DE PROCEDIMENTOS PERDEU O LÁPIS** (a pedido). Os dois valores viraram
      campos SEMPRE editáveis — componente novo `ValorInline`:
      ⚠️ **grava no BLUR e SÓ SE O TEXTO MUDOU.** Sem a comparação, percorrer a tabela
      com Tab dispararia um PUT por célula visitada — dezenas de gravações idênticas.
      ⚠️ `Enter` confirma (tira o foco); **`Esc` DESFAZ** para o último valor salvo. Sem
      a volta, quem começou a digitar por engano numa lista de centenas de linhas não
      tem como cancelar, e o blur gravaria o meio da digitação.
      ⚠️ **Falha na gravação devolve a célula ao valor do banco.** A tela nunca fica
      exibindo um número que não foi salvo — é o mesmo princípio do 409 da concorrência.
      ⚠️ Ressincroniza quando o valor muda POR FORA (recarga da lista, salvamento de
      outra célula): sem isso a célula congelaria num valor antigo.
      Com o lápis saíram `editandoValorId`/`valorEdit`/`salvandoValor` e o par ✓/✕ de
      cada célula — quem confirma é o blur.
- [x] **Rótulos curtos**: "Valor Cobrado pelo Prestador" → **Valor Prestador**;
      "Valor Cobrado para o Cliente" → **Valor Cliente** (a pedido). Os nomes longos
      ocupavam duas linhas no cabeçalho e empurravam a coluna do procedimento; o que
      cada um significa está na linha em que aparece, e no `title` do campo.
      ⚠️ `placeholder` do Valor Cliente do VÍNCULO é **"Padrão"**, não "R$ 0,00": vazio
      ali significa "usa o valor padrão da empresa", e não zero. A linha ainda mostra
      "usa R$ X" embaixo, para a herança não depender de o gestor lembrar da regra.
- [x] 🔴 **O PRESTADOR VIROU SELETOR, SEM ÍCONE** (a pedido) — `PrestadorCombo`: digita
      para filtrar, marca um que exista, ou cadastra um novo.
      ⚠️ **Escolher JÁ CRIA o vínculo** (sem valores; os campos nascem editáveis na linha
      nova). Um passo de confirmação para uma escolha que já foi feita é o que o pedido
      dispensa ao dizer "não precisa de um ícone para isso".
      ⚠️ Escolha por `onMouseDown` + `preventDefault`: o foco não sai do input, então o
      blur não fecha a lista antes de o clique registrar — a armadilha do combo da Agenda.
      ⚠️ Só oferece quem AINDA NÃO está vinculado: o unique recusaria o repetido e o
      clique falharia depois (28-d).
      ⚠️ **"Cadastrar X" NÃO cria o prestador aqui**: `PrestadorController.criar` exige
      nome **e telefone**, então criar pelo nome produziria cadastro incompleto. Leva a
      `/cadastro/prestadores?novo=1&nome=&depois=…&vincularNome=` e, ao salvar, VOLTA
      para cá — o efeito de chegada acha o prestador **pelo NOME** (o id não existia
      quando a URL foi montada) e abre o vínculo sozinho. Sem esse retorno, o gestor
      teria de reencontrar o procedimento na lista para terminar o que começou.
- [x] **Buscador POR PRESTADOR nas duas abas** (a pedido). Campo PRÓPRIO, ao lado da
      busca por nome/categoria: num campo só, "Silva" daria resultado imprevisível
      (nome de procedimento OU de prestador). O estado vazio distingue "nenhum
      procedimento nesta especialidade" de "nenhum vinculado a esse prestador" — sem a
      distinção, o gestor conclui que o catálogo está vazio.
- [x] **O COMBO ganhou prestador e os dois valores** (a pedido) — `prestador_id` e
      `valor_prestador` em `tb_procedimento_combos`, mesma forma da tela de
      procedimentos.
      ⚠️ **`valor` NÃO foi renomeado.** Ele já era, e continua sendo, o **Valor Cliente**
      do pacote; renomear a coluna obrigaria a tocar `resolverValorProcedimento`, o
      Orçamento, a Prescrição e os dois renderizadores para não ganhar nada. O que mudou
      foi o RÓTULO na tela.
      ⚠️ O prestador é **OPCIONAL**: sem ele o pacote é executado pela própria equipe.
      "Valor Prestador" fica desabilitado enquanto não houver prestador — valor de quem
      não existe não tem onde ser cobrado.
      ⚠️ Prestador conferido contra a EMPRESA (`prestadorDoComboInvalido`): o RLS não
      cruza tabelas, então a policy do combo não impede gravar o id de outra clínica.
      🔴 **`recursos.comboPrestador` na resposta de `listarCombos`** diz se as colunas
      EXISTEM. A migration já foi aplicada, mas a bandeira FICA: numa base que ainda não
      a tenha, a tela ofereceria o seletor e a escolha DESAPARECERIA no salvar — falha
      silenciosa, o pior resultado possível. Com ela, os campos são trocados por um aviso
      que nomeia a migration. Não remover ao supor que "agora todo mundo já migrou".
- [x] 🔴 **"Arquivo anexado:" mostrava a descrição DO PEDIDO.** No aviso de divergência
      de exame (`ExamesSolicitadosPanel`), a linha exibia o estado `descricao` — que a
      regra "o que já está escrito não é sobrescrito" PRESERVA a partir do pedido. As
      duas linhas do modal saíam com o MESMO texto ("Pedido: Laboratorial · Hemograma" /
      "Arquivo anexado: Hemograma"), e comparar uma coisa com ela mesma não ajuda a
      responder a única pergunta daquela tela: "anexei o laudo errado?".
      Agora mostra o **NOME DO ARQUIVO** analisado e, em linha à parte e só quando existe,
      **o que a IA leu dentro dele**.
      ⚠️ O retrato vem de `files` (o lote DESTA análise), não de `arquivos`: no modo
      ADICIONAR aquele já traz os anteriores, e o modal citaria arquivo que não foi lido
      agora.
- [x] 🔴 **O COMBO DE VACINAS DO ATESTADO NÃO MOSTRAVA TODAS.** Dois cortes silenciosos:
      (a) o dropdown renderizava `.slice(0, 60)` de **231** nomes — tudo depois do 60º
      alfabético era invisível e nada dizia que a lista tinha sido cortada; (b) a
      consulta tinha `take: 500` aplicado ANTES da deduplicação por nome (426 linhas →
      231 nomes), então hoje não cortava, mas bastava a clínica cadastrar as próprias
      vacinas para o fim do catálogo desaparecer do atestado.
      O `take` SAIU (catálogo de vacinas é finito e pequeno; o custo de trazê-lo inteiro
      é menor que o de descobrir o corte no papel) e o teto de RENDERIZAÇÃO subiu para
      200, com a última linha dizendo quantas faltam quando ainda corta.
      ⚠️ Num documento com valor legal, opção que falta é vacina que deixa de ser
      atestada — corte silencioso aqui é pior que lista longa.
- [x] **AS APLICADAS NO ÚLTIMO ANO VÊM NO TOPO, COM ✅** (a pedido).
      ⚠️ **Só `EXECUTADA`.** `SALVA` é rascunho e `FINALIZADA` está na fila do plantão
      aguardando aplicação — marcar as duas afirmaria no atestado que o animal recebeu
      uma dose que ninguém aplicou.
      ⚠️ **ERGUE, nunca FILTRA**: um atestado pode registrar vacina que o paciente nunca
      tomou — a primeira dose é exatamente esse caso —, então o catálogo inteiro continua
      abaixo.
      ⚠️ **A ordenação é do BACKEND**, não da tela: é lá que se sabe QUANDO cada uma foi
      aplicada. Mandar a data e deixar a tela ordenar seria a mesma regra escrita duas
      vezes.
      ⚠️ Janela de **12 meses** (o intervalo do reforço anual): sem ela, o atestado de um
      paciente antigo subiria dezenas de vacinas de anos atrás e o atalho deixaria de ser
      atalho.
      ⚠️ O casamento é pelo **NOME**, sem caixa nem espaço em volta — o registro de vacina
      guarda o nome, não uma FK garantida.
      ⚠️ Sem `animalId` (editor de modelos) sai em ordem alfabética, como antes.
- [x] Testes: `__tests__/vacinasAplicadasOpcoes.test.js` (12 casos) — lista completa sem
      teto (o mock REPROVA qualquer `take` na consulta crua), deduplicação, ordem
      alfabética sem paciente, erguidas por recência, `SALVA`/`FINALIZADA` sem marca,
      fora da janela, nome com caixa/espaço diferentes, e a data da dose mais recente.
      ✅ **Verificado que REPROVA**: reintroduzido o `take: 500` e afrouxado o filtro de
      status, **10 dos 12 falharam**.
      🔴 **E ELE NASCEU INSTÁVEL — `jest.mock` com `{ virtual: true }` num módulo que
      EXISTE.** `virtual` diz ao jest "este módulo não existe em disco", e é necessário
      só para `lib/prisma` (que é `.ts`, e o babel-jest não transpila). Aplicado também a
      `lib/fusoEmpresa` (um `.js` real), o mock às vezes NÃO pegava: um worker que já
      tivesse carregado o módulo verdadeiro num arquivo anterior resolvia o real, e a
      data saía em dd/MM/aaaa no lugar do ISO. Falhava ~1 vez a cada 8, **só no run
      COMPLETO** — isolado passava sempre, que é o pior formato de teste instável.
      Removido o flag; 12 execuções completas seguidas em verde.
      ⚠️ Regra: `virtual: true` só em módulo que o jest realmente não resolve.
      Suíte: **747**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
- [ ] **`ValorInline` grava no blur, sem debounce.** Digitar e clicar direto em outra
      célula gera duas requisições em sequência (uma por célula), o que é o correto — mas
      não há fila: se a primeira falhar, a segunda já partiu. Na prática cada célula é
      independente (endpoints distintos por vínculo), então não há corrida sobre o mesmo
      dado; se um dia a tela ganhar um "salvar tudo", é aqui que a coordenação entra.
- [ ] O vínculo prestador×procedimento não permite TROCAR o prestador de uma linha — só
      remover e escolher outro. Trocar significaria mover preço de uma pessoa para outra,
      e o ledger do recibo já registrou execuções sob o vínculo antigo; remover + criar
      deixa isso explícito.
- [ ] O combo aceita UM prestador. Pacote executado por dois profissionais diferentes
      (o cirurgião e o anestesista) não tem como dividir o valor entre eles — exigiria
      uma tabela de rateio, e não foi pedido.

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

### Sessão 2026-09-09 (parte 2) — Fornecedor e Prestador saem da EQUIPE

> **SEM migration nesta parte.** Nada de dado gravado é tocado — foi o pedido: quem já
> está cadastrado continua exatamente como está. A migration da parte 1
> (`20260930000000_cargo_prestador`) segue GERADA E NÃO APLICADA.

- [x] 🔴 **A PREMISSA: os dois são ATUAÇÕES ESTANQUES, não equipe.** Perguntado se era
      assim que estava configurado, a resposta era **não**: incluir um Fornecedor ou
      Prestador criava `MembroEquipe` como qualquer outro cargo, e eles apareciam na
      tela Equipe, no Controle de Acesso, na grade da Agenda e nos contadores.
- [x] 🔴 **O QUE **NÃO** MUDOU, e por quê: `MembroEquipe` CONTINUA existindo para eles.**
      Não é contradição — é infraestrutura, e apagá-lo derrubaria o acesso inteiro:
      `resolveEquipeId` procura o vínculo; sem ele `checkPermission` cai no ramo final e
      responde **403 "Nenhuma equipe ativa encontrada"**, e `userType FORNECEDOR` NÃO
      tem rota de escape (os dois bypasses de dono têm `&& userType !== 'FORNECEDOR'`
      explícito). Fora isso, `PermissaoMembro` é chaveada por `(equipeId, userId,
      moduloSlug)` e `DesignacaoPrestador` é por equipe.
      **O vínculo virou um CARTÃO DE ACESSO emitido pelo CADASTRO** — `lib/acessoExterno.js`
      —, não uma cadeira na equipe. Quem o cria e o revoga é `/cadastro/prestadores`; a
      tela Equipe nem o enxerga.
- [x] **Eles somem da listagem de membros** — `lib/cargosPrestador.js#SEM_EXTERNOS`
      aplicado às 4 consultas de `listarMembros`/`listarMembrosPorEquipe`.
      ⚠️ Filtrar no **ENDPOINT** é o que faz a tela Equipe, o Controle de Acesso e a
      **grade da Agenda** saírem juntos: os três comem o mesmo `/equipes/membros`.
      Filtrar em cada tela deixaria a próxima nascer errada.
      ⚠️ O filtro é pelo cargo **PRIMÁRIO**: quem é VETERINARIO e ACUMULA prestador em
      `cargos[]` CONTINUA na equipe — é da casa e também atende como externo, e sumir da
      lista o tornaria ingerenciável. É o oposto de `membroEhPrestador`, que existe para
      RESTRINGIR acesso (ali qualquer cargo da família basta).
      ⚠️ `?incluirExternos=1` é a porta de saída explícita (nada usa hoje) — sem ela,
      quem precisasse da lista completa reescreveria o filtro por conta própria.
      ⚠️ `listarTodasEmpresasAdmin` FICA de fora: é o inventário da plataforma, onde o
      ADMIN precisa ver todo vínculo que existe.
- [x] 🔴 **O CADASTRO PASSOU A ENTREGAR O ACESSO QUE PROMETIA.** `Prestador.acessoSistema`
      existia desde 2026-08-21 e criava um `User` **sem** `MembroEquipe` — o próprio
      schema documentava a consequência: *"dá para logar, mas sem RBAC; quem precisa de
      tela de verdade continua indo por Equipe > Incluir Membro"*. A pessoa entrava e
      não via nada. Agora `PrestadorController` emite o cartão (`emitirCartaoAcesso` +
      vínculo por empresa + Matriz do perfil PRESTADOR) na criação **e a cada salvar com
      o acesso ligado** — é isso que faz o cadastro ANTIGO passar a enxergar tela ao ser
      salvo de novo, sem migration nenhuma.
      ⚠️ **Não reescreve cargo nem perfil de quem já é membro**: a veterinária que também
      tem cadastro de prestador não pode ser REBAIXADA porque alguém marcou "terá acesso"
      num cadastro homônimo.
      ⚠️ **Desmarcar NÃO apaga o `MembroEquipe`** — o cascade levaria junto a
      `PermissaoMembro`, e religar devolveria a pessoa sem nenhuma das permissões que o
      gestor configurou, em silêncio. Quem corta o login é `acesso_sistema = false`, que
      `podeAcessarSistema` já consulta.
      ⚠️ As permissões padrão são propagadas FORA da transaction (`PermissaoService` abre
      a própria) e em best-effort: falhar ali deixa o acesso sem permissão configurada,
      nunca desfaz o cadastro que já gravou.
- [x] **"Gerenciar Acesso" (designações) MUDOU DE CASA** — saiu do Controle de Acesso e
      foi para `/cadastro/fornecedores` e `/cadastro/prestadores`. A designação é o que
      define quais pacientes o externo enxerga (deny-by-default): ela tem de estar onde a
      pessoa é gerida, senão o cadastro concede login e não há por onde dizer QUEM ele
      atende. Componente único `components/GerenciarAcessoPrestadorModal.tsx` (extraído
      de `ControleAcesso.tsx`) — duas cópias divergiriam, e o que divergiria seria o
      alcance de um externo aos prontuários.
      ⚠️ O botão só aparece com **login E cartão** (`userId` + `acessoEquipeId`): sem um
      dos dois a rota de designação não existe, e ele só falharia depois do clique (28-d).
      ⚠️ `acessoEquipeId` vem do BACKEND (`anexarEquipeDoAcesso`), e **não** do `equipeId`
      do cadastro: aquele é `req.equipeId ?? null` na criação, e em empresa com CNPJ o
      seletor de contexto resolve no nível da EMPRESA — ou seja, vem nulo. O cartão, esse
      sim, sempre nasce numa equipe concreta.
- [x] **O formulário de MEMBRO deixou de oferecê-los** (`PERFIS_ACESSO`), e com eles saiu
      toda a maquinaria do seletor de cadastro (busca, `fornecedorId`/`prestadorId`,
      `comFornecedor`, `ModalNovoFornecedor` — que continua vivo, é usado pela Farmácia).
      O ramo de INCLUSÃO DIRETA do `ControleAcesso` também saiu: ali só resta o convite.
      ⚠️ Os dois FICAM em `PERFIS_LEGADOS`: vínculo antigo aberto por algum caminho mostra
      o rótulo em vez de um `<select>` em branco sobre um cargo que existe no banco.
- [x] **MAPA DE ATENDIMENTO DE VOLTA AO MENU** (pedido à parte, mesma data). Ele havia
      sido **escondido** em 2026-09-05 por um flag no `Sidebar`
      (`MOSTRAR_MAPA_ATENDIMENTO = false`) — nunca removido: a rota `/mapa-atendimento`,
      a tela (`pages/MapaAtendimento.tsx`), o `MapaAtendimentoController`, a rota do
      backend e o gate `dashboard.geral.ler` seguiram montados o tempo todo, e só o item
      do menu ficou de fora. **Foi essa escolha que fez a volta custar uma linha em vez
      de uma reconstrução.** O flag saiu junto — um `if (true)` não configura nada.
      ⚠️ O item e a TELA usam o MESMO gate (`dashboard.geral.ler`): quem vê o menu entra,
      e quem não vê não recebe um botão que falha depois do clique (28-d).
      ⚠️ A seção ficou SEM número no comentário do `Sidebar`: renumerar as nove seguintes
      só para encaixar um item seria ruído.
      ⚠️ NÃO confundir com o **atalho** "Mapa de atendimento" do Painel Principal, que foi
      REMOVIDO a pedido em 2026-09-05 e continua removido — não foi pedido de volta.
- [x] Testes: `__tests__/externoNaoEhEquipe.test.js` (15). ✅ **Verificado que REPROVA** —
      removido o filtro de UMA das quatro consultas, um caso falhou.
      🔴 **E o gate achou um defeito real durante a escrita**: o bloco que emite/revoga o
      cartão na EDIÇÃO do prestador nunca tinha sido aplicado (a edição anterior falhou
      por âncora e foi descartada inteira). Sem o teste, "salvar o cadastro com acesso
      ligado" seguiria sem emitir cartão nenhum — em silêncio.
      Suíte: **709**; `tsc --noEmit`, `tsc -b` e `vite build` limpos.
- [ ] `Agendamentos.tsx` ainda tem o ramo que lê `tipoServico` do cadastro para cargo
      FORNECEDOR/PRESTADOR. Ficou INALCANÇÁVEL (o endpoint não os devolve mais) e foi
      mantido de propósito: é o que mantém a grade correta se alguém um dia usar
      `?incluirExternos=1`. Se a decisão virar definitiva, ele pode sair.
- [ ] **FORNECEDOR não tem caminho próprio para conceder login.** `tb_prestadores` tem
      `acesso_sistema`; `tb_fornecedores` não. Com os dois fora do "Incluir Membro", criar
      um fornecedor COM LOGIN deixou de ter porta de entrada — quem já tem continua
      funcionando (nada foi migrado), e o "Gerenciar Acesso" dele já está no cadastro.
      É coerente com a separação (fornecedor é quem ABASTECE; quem ATUA é o prestador),
      mas se a clínica precisar disso, o caminho é uma coluna `acesso_sistema` em
      `tb_fornecedores` espelhando o Prestador — migration aditiva, nada a migrar.
- [ ] Eles continuam **consumindo assento do plano** (`consomeAssento` só isenta
      PROPRIETARIO). É defensável — são logins ativos —, mas é uma decisão COMERCIAL que
      não foi tomada aqui: se "não é equipe" tiver de valer também para a cobrança, o
      lugar é `lib/planoEmpresa.js`.

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

### Sessão 2026-09-06 (parte 4) — O paciente do cliente inativado vai para "Inativos"

- [x] 🔴 **O DEFEITO: dois acertos que, somados, apagavam o paciente.**
      `removerDaEmpresa` inativa os animais do cliente removido (com trilha e cascata
      de cancelamento das pendências) — correto. `lib/visibilidade.js` esconde o animal
      de quem não é cliente ativo da empresa — também correto, e é o que impede o
      prontuário do cliente que saiu de continuar circulando. Juntos, faziam o paciente
      sumir da **aplicação inteira**: `AnimalController.listar` aplicava o filtro do
      dono TAMBÉM na aba de Pacientes, então nem em "Inativos" ele aparecia. O gestor
      inativava o cliente, os animais evaporavam e não havia tela onde conferir o que
      tinha acontecido — nem botão por onde desfazer.
- [x] 🔴 **NA ABA DE PACIENTES O ESTADO DO DONO DEIXA DE FILTRAR E PASSA A SER
      REPORTADO.** `whereAtivo` da aba passou a falar só de `Animal.ativo`; o estado do
      cliente vira o campo `proprietarioInativo` de cada linha, e quem CLASSIFICA é a
      tela (`pacienteInativo` inclui o campo → aba "Inativos", selo vermelho, e a
      justificativa que `removerDaEmpresa` gravou aparece na coluna).
      ⚠️ **SÓ ali**: `abaDePacientes = ehGestorNoContexto(req) && req.query.ativo !==
      undefined` — a MESMA trava que já protegia o `ativo:false`. Sem ela, qualquer
      perfil que soubesse mandar o parâmetro veria o que a exclusão lógica esconde.
      ⚠️ **Nenhuma outra listagem mudou.** Agenda, plantão, dashboard, relatórios e
      busca global continuam em `animalVisivelNaEmpresa`/`ANIMAL_VISIVEL` — ou seja,
      tratando o paciente de cliente inativo como INATIVO, que é exatamente o que a
      tela passa a dizer dele. É essa coerência que faz a aba não mentir: ele está lá
      porque não está em mais lugar nenhum.
- [x] 🔴 **A MARCA SAI DA REGRA POSITIVA, NUNCA DE UMA NEGAÇÃO À MÃO.**
      `marcarProprietarioInativo` consulta quem PASSA por `animalVisivelNaEmpresa` e
      marca o complemento. Escrever a negação (perfil da empresa × `users.ativo` do
      legado, §36) criaria uma segunda cópia da regra, que divergiria da primeira na
      correção seguinte — e a divergência apareceria como "o paciente está na lista e o
      dono consta ativo na tela ao lado", que é justamente o que ninguém depura.
      ⚠️ Uma consulta a mais, só no caminho da aba.
- [x] **A SAÍDA já existia e agora é DITA**: "Ativar" na aba Inativos chama
      `/animais/:id/reativar`, que reativa o cadastro do CLIENTE na mesma transaction
      (`lib/donoAtivoDoPaciente.js`, sessão anterior). `AnimaisVet` passou a ler
      `donoReativado`/`loginGlobalInativo` do retorno — mesmo padrão de
      `Animal.tsx#handleAtivarPacienteDuplicado` — e avisa quando o login global do
      cliente segue desligado por OUTRA clínica (este botão não o religa, de propósito).
- [x] **Cobre também a opção "manter os animais"** de `removerDaEmpresa` (2026-09-04):
      ali o paciente fica `ativo = true` e SEM trilha própria (ninguém o inativou), mas
      está fora de todas as telas por causa do cliente. Ele cai na aba Inativos com o
      selo explicando, e `rastroInativacao` devolve "Proprietário inativo nesta clínica
      — reative o cliente em Cadastro › Proprietários", em vez de coluna vazia.
      ⚠️ Não há ação no card para esse caso, e é correto: o que se desfaz ali é o
      cadastro do CLIENTE, e ele tem tela própria.
- [x] **Gate novo `__tests__/pacienteDeClienteInativo.test.js`** (8 casos): varre os
      DOIS lados, porque os dois falham em silêncio — o backend voltar a filtrar pelo
      dono faz o paciente sumir de novo sem erro nenhum; a tela deixar de contar o
      `proprietarioInativo` o devolve à aba "Ativos", prometendo uma atividade que não
      existe em tela alguma. Inclui a asserção de que as listagens operacionais NÃO
      foram afrouxadas junto.
      ⚠️ A varredura IGNORA COMENTÁRIOS (`semComentarios`): sem isso ela passaria só
      porque o comentário que EXPLICA a regra cita as mesmas palavras — e um gate que
      se satisfaz com a própria documentação é um gate que se aprende a ignorar.
      ✅ **Verificado que REPROVA**: revertido o filtro do backend e o predicado da
      tela, os dois casos 🔴 falharam. Suíte: **584**; `tsc -b` limpo.
- [x] 🔴 **PACIENTE + CLIENTE INATIVOS VIRARAM UMA PERGUNTA SÓ** (a pedido, mesma
      sessão). Cadastrar um paciente que já existe INATIVO para um cliente também
      inativo abria DUAS caixas em sequência: o backend recusa primeiro pelo CLIENTE
      (`criar`, o guard do cliente inativo vem antes do de duplicidade), a tela pedia
      o motivo, reativava e salvava — e então o backend recusava de novo, agora pela
      duplicidade, pedindo o MESMO motivo outra vez. Era o mesmo ato perguntado duas
      vezes: **reativar o paciente já reativa o cliente junto**, na mesma transaction
      (`lib/donoAtivoDoPaciente.js`), então a segunda caixa não tinha o que decidir.
      Agora, quando a checagem em tempo real já sabe do paciente inativo
      (`dupInativoConhecido`), a caixa do cliente nomeia os dois — *"O cliente "X" e o
      paciente "Y" estão inativos nesta clínica, caso deseje reativá-los, informe o
      motivo."* (o cadastro não é "feito", é REAPROVEITADO: quem volta é o paciente que
      já existe) —, o botão diz **"Reativar Paciente
      e Proprietário"** e o confirmar faz UMA chamada, a de reativação do paciente.
      ⚠️ Restrito ao **GESTOR**: as rotas de reativação do PACIENTE são dele, e sem a
      trava quem tem só `cadastro.proprietario.ativar` veria o botão e levaria 403
      depois do clique (28-d). Para esse perfil o fluxo segue como era.
      ⚠️ O alvo vai por PARÂMETRO (`handleAtivarPacienteDuplicado(motivo, alvo)`), não
      por `setDupInativoAlvo` antes da chamada: o estado só existe no próximo render e
      a função leria o valor ANTIGO da closure.
      ⚠️ Cliente inativo com paciente NOVO não muda — segue "Reativar cliente e
      cadastrar", que ali é o que a ação faz.
      ⚠️ E a caixa do PACIENTE duplicado inativo (a de cima) deixou de prometer o
      proprietário: virou *"O paciente "Y" já existe neste local para este
      proprietário, mas está inativo. Caso deseje ativá-lo informe o motivo."* +
      **"Reativar Paciente"**. Não é uma escolha da tela — é consequência da ordem dos
      guards: com o cliente inativo quem abre é a OUTRA caixa, então esta só existe
      com o cliente ATIVO, e ali `garantirDonoAtivo` não tem o que reativar. O texto
      antigo ("ele é reativado junto") descrevia um efeito que nunca acontecia por
      este caminho.
- [x] **O aviso "O acesso do proprietário ao sistema está desativado…" SAIU** das três
      telas que o exibiam (a pedido: "não quero duas validações, quero uma só"). O
      `loginGlobalInativo` continua vindo na resposta e é deliberadamente ignorado —
      o acesso ao SISTEMA é outra dimensão, resolvida por quem o desligou, e dizê-lo
      junto transformava a confirmação de um clique em duas mensagens sobre o mesmo
      ato. ⚠️ Não reintroduzir como toast; se um dia precisar aparecer, o lugar é a
      tela do CADASTRO do cliente, não a confirmação da reativação do paciente.
- [x] 🔴 **A FATURA PASSOU A SAIR PELO MESMO CAMINHO DA PRESCRIÇÃO** (a pedido): os
      botões WhatsApp/E-mail da fatura trocaram o envio por LINK PÚBLICO pelo par
      `enviarPdfWhatsAppComAviso`/`enviarPdfEmailComAviso` (`utils/compartilharPdf.ts`)
      — **PDF anexado de verdade**, a mesma folha do Imprimir, com a barra de progresso
      no centro da tela, o botão Cancelar e o veredito no mesmo lugar.
      ⚠️ **REVERTE** o envio por link (`/clinica/faturas/:id/enviar-{whatsapp,email}` +
      `lib/faturaLinkPublico.js`), que existia para não depender de o Puppeteer terminar
      dentro da janela de "user activation" do navegador. Isso deixou de ser risco em
      2026-09-05, quando o envio passou a ser feito PELO BACKEND: o Chromium roda no
      servidor, e a janela do navegador só importa no FALLBACK (sem telefone/e-mail ou
      sem provider, a tela baixa o PDF e abre o app para anexar).
      🔴 **O botão "Links enviados" e todo o painel dele SAÍRAM da tela** (a pedido, na
      mesma sessão): sem envio por link, ele nascia vazio em toda fatura nova. Foram
      junto o estado, o `carregarLinks`/`toggleLinks`/`confirmarRevogar`, o
      `ConfirmModal` de revogação, o tipo `FaturaLink`, os mapas `LINK_STATUS_*` e o
      tom `TOM_ACAO.links` — UI inalcançável é pior que UI ausente, e o `tsc -b`
      reprova o que sobra sem leitor.
      ⚠️ **CONSEQUÊNCIA ACEITA: revogar um link já enviado ficou SEM PORTA DE ENTRADA.**
      As rotas continuam montadas e funcionais (`GET /clinica/faturas/:id/links`,
      `PATCH .../links/:id/revogar`), e o cron `reenviar_links_fatura` segue
      trabalhando em cima da tabela — mas nenhuma tela as chama. Os links que já saíram
      permanecem VÁLIDOS até expirar, com um token de 64 caracteres como única
      proteção. Se for preciso cortar o acesso de um deles, hoje é pela API ou pelo
      banco; para devolver o painel, o lugar é este mesmo (está no git).
      ⚠️ Sem `try/catch` em volta: `enviarPdf*ComAviso` NUNCA lança — ela mesma conta o
      resultado e o motivo da falha no card central; um catch só produziria uma segunda
      mensagem sobre o mesmo clique.
      ⚠️ A logo já era convertida para `data:` no carregamento da tela
      (`carregarComoDataUri`), então a folha não nasce sem imagem no PDF do servidor —
      é a armadilha que derruba todo gerador novo.
- [ ] O envio EM LOTE do fechamento de faturas (o modal com uma linha por proprietário)
      continua mandando TEXTO por `abrirWhatsApp`/`abrirEmail`. Ali as faturas são de
      OUTROS clientes, não carregados na tela: não há itens, animais nem logo para
      montar o HTML de cada uma, e migrar exige buscar cada fatura inteira para gerar N
      PDFs. Mesma exclusão registrada em 2026-09-05.
- [ ] O `?ativo=true` da aba "Ativos" passou a não filtrar pelo dono no BACKEND — quem
      recorta é a tela. Não muda nada hoje (`AnimaisVet` só pede `ativo=all` e filtra
      em memória), mas um consumidor novo dessa query precisa saber que a classificação
      mora no front, não na resposta.
- [ ] O paciente do cliente inativado continua fora do seletor de paciente, da agenda e
      do plantão. É o desejado enquanto "cliente inativo ⇒ paciente inativo" valer; se
      um dia a opção "manter os animais" tiver de deixá-los OPERÁVEIS, a decisão é de
      produto e o lugar é `lib/visibilidade.js`, não esta listagem.

### Sessão 2026-09-06 (parte 3) — Duplicidade de paciente e troca de dono na tela de cadastro

- [x] 🔴 **DUPLICATA DE PACIENTE = NOME + LOCAL + DONO** (`lib/duplicidadeAnimal.js`).
      Cascata, a pedido: mesmo NOME no mesmo LOCAL é **pergunta** ("deseja continuar?");
      respondido que sim, o que decide é o **DONO** — mesmo dono é duplicata e não se
      cadastra; dono diferente segue, porque dois clientes podem ter cada um o seu
      "Thor" no mesmo haras. Existindo e estando INATIVO, a tela oferece **reativar**
      aquele cadastro; recusando, informa que não é permitido duplicar.
      ⚠️ **REVERTE o bloqueio por NOME** (`statusBuscaAnimal === 'ja_cadastrado'`), que
      barrava qualquer homônimo da clínica e deixava o vet sem saída no caso legítimo.
      O Salvar agora é bloqueado por `dupBloqueado`, não pelo nome repetido.
      ⚠️ "INATIVO" são os DOIS estados, de propósito: `ativo = false` (exclusão lógica)
      e `inativo = true` (prontuário congelado). Para quem cadastra, os dois significam
      "existe e não está em uso", e a saída é a mesma — reaproveitar em vez de criar um
      segundo, que partiria o histórico clínico em dois. A tela chama `/reativar` e/ou
      `/ativar` conforme o caso (um paciente pode estar nos dois).
- [x] **EM TEMPO REAL** — `GET /animais/verificar-duplicidade?nome=&localizacaoId=&email=`,
      com 500ms de espera, refeito a cada mudança de nome, local ou e-mail do dono (a
      tríade se completa aos poucos; o dono é o último a ser digitado).
      ⚠️ **É o AVISO, não a garantia**: o `POST /animais` roda o MESMO helper e recusa
      com 409 (`duplicado` / `duplicadoInativo`). Entre a verificação e o Salvar outra
      pessoa pode ter cadastrado o mesmo paciente — tela nenhuma segura integridade.
      ⚠️ A confirmação do "deseja continuar" vale para o PAR nome+local conferido:
      trocar qualquer um dos dois é outra pergunta.
- [x] 🔴 **A COMPARAÇÃO DE NOME ACONTECE NO BANCO** — e foi um TESTE que pegou isto,
      não o uso. A primeira versão buscava com `contains` e normalizava em JS: no
      Postgres, `contains: 'Mel'` (mesmo `insensitive`) **NÃO casa "Mél"**, então o
      candidato acentuado nunca chegava ao filtro e a duplicata passava batido. Agora a
      consulta compara `translate(lower(btrim(nome)))`.
      ⚠️ `translate()` e não `unaccent()`: a extensão pode não estar instalada na base
      do cliente, e uma verificação que só funciona em algumas instalações é pior que
      nenhuma. ⚠️ As duas tabelas do `translate` precisam ter o MESMO comprimento —
      uma sobra desloca todo o resto e passa a trocar letras erradas. Há teste para os
      dois pontos.
- [x] 🔴 **PACIENTE ATIVO ⇒ DONO ATIVO NESTA CLÍNICA** (`lib/donoAtivoDoPaciente.js`),
      nos TRÊS cenários — a pedido, depois de relatado que ativar o paciente deixava o
      dono inativo:
      ```
      paciente inativo + dono ATIVO    → justificativa do PACIENTE (só ele volta)
      paciente inativo + dono INATIVO  → UMA justificativa, os DOIS voltam juntos
      paciente NOVO    + dono INATIVO  → justificativa do CLIENTE, e só então o cadastro
      ```
      Reativar o paciente sem o dono devolve um cadastro que NASCE INVISÍVEL — a
      visibilidade esconde o animal de quem não é cliente ativo da empresa. A pessoa lê
      "reativado com sucesso" e o paciente não aparece em lugar nenhum (o sintoma
      "Horse1", por outro caminho).
      O helper entra nas DUAS rotas de ativação (`/ativar`, que descongela, e
      `/reativar`, que desfaz a exclusão lógica), DENTRO da transaction do paciente: ou
      os dois voltam, ou nenhum volta.
      ⚠️ **NUNCA religa o `users.ativo`** — aquele é o LOGIN, é global, e cai quando a
      pessoa é inativada como PROFISSIONAL em qualquer clínica. Ligá-lo daqui desfaria
      em silêncio a decisão de OUTRA empresa sobre o acesso dela ao sistema, que é o
      vazamento que a regra de visibilidade acabou de corrigir. O retorno traz
      `loginGlobalInativo` e a tela AVISA, em vez de fingir que resolveu tudo.
      ⚠️ Não toca `UsuarioEmpresa`: lá mora o vínculo de qualquer papel, o profissional
      inclusive — reativar ali devolveria o CARGO de quem também trabalha na clínica.
      ⚠️ A reativação do cliente é auditada À PARTE (`ATIVACAO`/`PROPRIETARIO`), com o
      mesmo motivo: quem abrir a trilha do CADASTRO DELE precisa achar lá o porquê, não
      só na trilha do animal.
      ⚠️ Cliente LEGADO (sem cadastro na empresa) não ganha um cadastro criado do nada:
      a visibilidade já não o esconde, e criar seria afirmar um vínculo que ninguém
      registrou.
      Os dois modais passaram a ser o `ModalJustificativa` (`tom="neutro"`, §33) — o
      motivo era EXIGIDO pelo backend e a tela não o pedia: `/ativar` respondia 400
      "É obrigatório informar o motivo da reativação" e o botão só falhava.
      Testes: `__tests__/donoAtivoDoPaciente.test.js` (8 casos), incluindo o LIMITE
      (nenhuma escrita em `user`) e um gate que exige o helper nas duas rotas, dentro
      da transaction. Suíte: **572**.
- [x] **TROCAR O PROPRIETÁRIO na tela de cadastro do paciente** (`/animais/:id`) — botão
      "Trocar proprietário" na seção Proprietário, só na EDIÇÃO e só para gestor/ADMIN.
      ⚠️ **REUSO, não implementação nova**: abre o MESMO `ProprietarioFormModal`
      (`modoTransferencia`) e a MESMA rota `POST /animais/:id/transferir-propriedade`
      que a tela do paciente (`/animal/:id`) já usava desde antes — com MOTIVO
      obrigatório (Doação/Venda/Aluguel), fechamento da janela de posse em
      `tb_animal_proprietario_historico` e registro na auditoria (`TRANSFERENCIA`).
      Uma segunda implementação divergiria na primeira correção, e o que divergiria
      seria justamente COMO a troca fica registrada.
      ⚠️ O e-mail do dono continua TRAVADO na edição: trocar de dono não é editar um
      campo, é um ato com motivo e registro próprios — por isso um botão.
- [x] Testes: `__tests__/duplicidadeAnimal.test.js` (17 casos) — a cascata inteira, o
      que NÃO é duplicata (outro local, outra empresa, o próprio animal na edição,
      nome parecido), acento/caixa, e um gate estrutural que exige o `translate` na
      consulta e o mesmo comprimento das tabelas.
      ✅ **Verificado que REPROVA**: removida a regra do dono, 2 casos falharam.
      Suíte: **563**. Provado também contra a base real, em transação revertida.
- [ ] A verificação não cobre a EDIÇÃO (`PUT /animais/:id`): renomear um paciente para
      o nome de outro do mesmo dono e local ainda passa. O helper já aceita `ignorarId`
      para isso — falta chamar no `atualizar`.
- [ ] O aviso em tempo real não distingue "dono ainda não digitado" de "dono diferente"
      no texto do banner (os dois caem no mesmo aviso âmbar). Como o veredito final é
      do backend, isso não deixa passar duplicata — só é menos informativo.

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

### Sessão 2026-09-02 (parte 2) — Paciente inativo: prontuário congelado, não escondido

- [x] 🔴 **A regra que mudou.** Inativar o paciente NÃO o esconde: ele aparece como um
      paciente normal e TODAS as atividades dele seguem visíveis. O que muda é que, da
      data e hora da inativação em diante, nada mais pode ser criado, alterado,
      finalizado, executado, cancelado ou excluído — até o gestor reativar, quando o
      histórico volta a seguir o trâmite normal.
      ⚠️ NÃO confundir com `Animal.ativo` (exclusão lógica, §5): ali o paciente e tudo
      que pende dele SOMEM. São dois estados diferentes e continuam diferentes.
- [x] 🔴 **O congelamento descongelava.** O estado `Animal.inativo` já existia (migration
      `20260818000000`), mas o bloqueio estava só nos `criar`: a evolução seguia sendo
      reaberta, assumida e cancelada; a prescrição, finalizada, executada e cancelada;
      o agendamento, remarcado; o exame, finalizado; o encaminhamento, concluído.
      Guard único `bloquearSeAnimalInativo` aplicado a **34 caminhos de escrita** em 8
      controllers. Ver o topo para as armadilhas (ordem em relação ao gate de acesso,
      400 × 403, formato da resposta) e para o que fica deliberadamente de fora.
- [x] **No front, o bloqueio entra nas PERMISSÕES**, não em cada botão: `podeCriar`,
      `podeEditar`, `podeFinalizar` e `podeDeletar` dos cinco submódulos passaram a ser
      `!pacienteInativo && (...)`. É o que faz a regra alcançar todo botão de uma vez —
      e cobrir o botão que ainda vai nascer. `podeImprimir`/`podeCompartilhar` ficam
      inteiros: imprimir e enviar são saída de conteúdo, não escrita.
- [x] **Faixa âmbar** no shell de Atendimento e na tela de Vacina (estado, desde quando,
      por quem, motivo e a saída) + selo "Somente leitura" no card de Pacientes. Sem
      isso os botões apenas SOMEM e quem olha conclui que perdeu permissão.
- [x] **Gate estrutural** `__tests__/pacienteInativo.test.js` (55 casos): varre o código
      dos controllers e reprova handler de escrita sem o guard. Verificado que ele
      REPROVA de verdade — um handler sem guard foi acrescentado à lista de propósito e
      o teste falhou, como tem de falhar. Suíte: 352.
- [x] **O paciente inativo CONTINUA na fila do plantão, sem ação** — a primeira versão
      o excluía da fila e foi REVERTIDA a pedido: sumir com ele esconderia da equipe que
      o tratamento existe e ficou parado. As duas `listarParaExecucao` devolvem
      `animalInativo` por linha; Execução de Prescrição e Painel Principal apagam
      Executar/Aplicar e Cancelar e mostram o selo "Somente leitura". Ver e Imprimir
      ficam. ⚠️ Não reintroduzir o filtro que tira a linha da RESPOSTA DO BACKEND.
      ⚠️ **A posição na TELA mudou em 2026-09-05** — ver a sessão daquele dia: em
      `/execucao-prescricao` a linha desceu da fila "a executar" para o Histórico.
- [x] 🔴 **Fatura PAGA é somente leitura** — ver o item no topo. O buraco não era o
      item (esse já era recusado), era `atualizarStatus`: PAGA → ABERTA reabria tudo.
- [ ] O congelamento do PACIENTE não alcança o financeiro dele (fatura e orçamento de
      paciente inativo seguem operáveis) — é dinheiro já lançado, e travar o fechamento
      prenderia a cobrança da clínica. Diferente da fatura PAGA, que é somente leitura
      por si. Se a regra tiver de alcançar o financeiro do paciente inativo, o guard já
      está pronto para ser chamado lá.
- [ ] `EvolucaoController.transcrever` e `interpretar` (IA sobre o texto digitado) não
      recebem o guard: não gravam nada no prontuário. Se algum dia passarem a gravar,
      entram na lista do gate.

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

### Sessão 2026-08-01 (parte 2) — Foto do profissional
- [x] **Foto no Cadastro Pessoal, exibida na Equipe** (migration `20260814000000`) —
      `UsuarioEmpresa.fotoUrl`, rota `PUT`/`DELETE /api/users/me/foto` (multipart),
      helpers em `lib/usuarioEmpresa.js`, `getMe` devolve `fotoUrl` e `listarMembros`
      anexa a de cada membro. Ver o bloco de `UsuarioEmpresa` na seção 5.
      A foto é enviada **ao salvar o formulário**, não ao escolher o arquivo — sair da
      tela sem salvar não pode trocar a foto que a clínica já tem.
- [x] `/equipe`: avatar de **48px** (≈3 linhas da lista) no card mobile e na coluna Nome
      do desktop; clicar abre a **ficha do membro** (somente leitura) com especialidade,
      local, horário, telefone e e-mail. É `<button>`, não `<div onClick>`: foco por
      teclado e Enter/Espaço são o mínimo para o que abre um diálogo.
- [x] **Foto com zoom e reposicionamento** — `components/FotoEditorModal.tsx`. Escolher o
      arquivo NÃO grava: abre o editor, e o que sobe é o recorte. Botão "Ajustar foto"
      reabre o editor sobre a foto já salva (mesma origem `/uploads`, sem taint de canvas).
- [x] **Ordem das seções do Incluir/Editar Membro** (`UsuarioFormModal`): Dados Pessoais →
      Endereço → Locais de trabalho → **Forma de Pagamento** (extraída de Dados Pessoais,
      onde estava embutida). O checkbox "Terá acesso ao sistema" FICA em Dados Pessoais —
      é a outra metade do "o que essa pessoa é aqui", não remuneração.
      Rodapé no padrão da aplicação, alinhado à direita.
- [ ] `ControleAcesso > Equipe` e a Agenda listam as mesmas pessoas e continuam sem foto —
      usam outros endpoints (`listarMembrosPorEquipe`, `/equipes/membros`). Ligar quando
      for pedido: basta o `anexarFotoEmRelacao` no controller correspondente.

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

### Sessão 2026-07-28 (parte 5) — Profissional isolado por empresa
- [x] **`ProfissionalPerfil`** (migration `20260807000000`, com backfill) — o cadastro do
      profissional passou a ser POR EMPRESA, igual ao do proprietário: mesmo login,
      cadastros independentes. Incluir numa empresa nova não carrega NADA da outra; editar
      numa não altera a outra. `lib/profissionalPerfil.js` é a fonte única. Ver seção 5.
- [x] **Especialidade por empresa** — `UsuarioEspecialidade.empresaId` + unique novo; o
      backfill deu as especialidades existentes à empresa do vínculo mais ANTIGO (a que
      cadastrou o profissional) e nas demais ele começa sem — que é a regra de cadastro novo.
- [x] `atualizarMembro` deixou de gravar nome/telefone/endereço no `User` (era o vazamento
      entre clínicas); no User ficaram só e-mail, senha e o `ativo` global.
- [x] **Senha só do ADMIN e do próprio dono** — campo "Nova senha" saiu do Editar Membro
      (Equipe) e o backend passou a responder 403 para troca de senha por terceiros
      (`atualizarMembro`, `ProprietarioController.atualizar`); `adicionarMembro` ignora
      `senha` do body. Ver seção 14.
- [ ] `ativo` por empresa existe na tabela mas ainda NÃO é usado no login/seletor: desativar
      o membro numa clínica continua desativando o login global (`toggleMembro` mexe em
      `User.ativo`). Para isolar de verdade, `toggleMembro` deve gravar `perfil.ativo` e
      `meusContextos` deve esconder a empresa em que o perfil está inativo.
- [ ] Nome do profissional em telas clínicas (evolução/prescrição/histórico/relatórios)
      ainda sai de `User.fullName` — aplicar `aplicarPerfilEmRelacao` ao tocar cada uma.

### Sessão 2026-07-28 (parte 4) — Herança do padrão da empresa + erro na tela do cadastro
- [x] **Tempo de consulta padrão da empresa** (migration `20260806000000`) —
      `EmpresaConfiguracao.tempoConsultaPadraoMin` + campo em `/configuracoes`.
      Dias, horário e tempo em branco no card "Locais de trabalho" passam a HERDAR o
      da empresa (herança dinâmica). Ver seção 15.
- [x] **Erro do cadastro dentro do modal** — `UsuarioFormModal` ganhou a prop
      `erroServidor`, exibida no rodapé do próprio modal. `Equipe.tsx` e
      `ControleAcesso.TabEquipe` pararam de mandar o erro de incluir/editar membro para
      o `InlineError` do topo da página (que fica atrás do modal, colado no botão Voltar).
      Padrão para telas novas: erro de ação de modal é do MODAL, não da página.
- [x] **Busca limpa após salvar** — incluir/editar membro faz `setBusca('')` (com a busca
      antiga em aberto, quem acabou de ser cadastrado não aparecia na lista) e os campos
      de busca ganharam `name`/`autoComplete` neutros para o navegador não reoferecer o
      nome digitado no cadastro.
- [x] **Cadastro Pessoal: `temposConsulta` sumia no round-trip** — `UserController.getMe`
      montava `locaisTrabalho` SEM `temposConsulta`, então a tela reabria sem o tempo e o
      salvava vazio, APAGANDO o que o gestor configurou na inclusão do membro. O campo
      voltou no `getMe` e o seletor "Tempo de consulta" (mesmo do Incluir Membro, com a
      opção "Padrão da empresa") passou a existir também no Cadastro Pessoal, além do
      tempo aparecer nos chips dos locais já salvos.
      LIÇÃO: campo novo em formulário compartilhado precisa entrar no GET e no PUT na
      mesma leva — um lado só transforma "não editável" em "apagado ao salvar".
- [x] **Especialidade deixou de ser obrigatória** — regra por PERFIL:
      `VETERINARIO` sem especialidade assume **Clínica Médica**;
      `FORNECEDOR` segue a mesma regra do vet mas aceita especialidade NULA;
      **todos os demais perfis** (estagiário, enfermeiro, secretaria, financeiro e o
      próprio GESTOR — que tem userType VETERINARIO mas não preenche dados
      profissionais) não têm especialidade NEM tempo de consulta, e o backend descarta
      o que vier no body. Ver seção 15.
- [x] Migration aplicada (`migrate deploy`) e client regerado nesta máquina. Em outra
      máquina, rodar os dois — sem o `generate` o client não conhece
      `tempoConsultaPadraoMin` e salvar Configurações falha.

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

- [x] Migrar `backend/src/server.js` → TypeScript (`src/server.ts`)
- [x] Mover `prismaClient.ts` → `src/lib/prisma.ts` (singleton, injetável)
- [x] Implementar `StorageProvider` abstrato (LocalStorageProvider + factory)
- [x] Repository Pattern no backend (BaseRepository + Animal/User/Equipe)
- [x] Criar camada de AI services desacoplada (`src/ai/` — AIProvider interface + GeminiProvider)
- [x] Prompt versioning (`src/ai/prompts/index.js` — catálogo com `operacao@vN`)
- [x] Rate limiting nas rotas (express-rate-limit: 200/min geral, 20/15min auth)
- [x] Logs estruturados (Winston — substituiu console.log, override global)
- [x] Testes unitários nos services de nutrição (56 testes, >90% cobertura)
- [x] Multi-tenant prep (Animal.empresaId, AuditLog.empresaId, auto-set no accept)
- [x] Health check endpoint (`/health`) — com status banco, uptime, versão
- [x] Multi-tenant enforcement — `injectTenant` middleware em animais e evolução
- [x] Input validation — express-validator em auth, animais, equipes, evolução
- [x] JWT Refresh Token — rotação, endpoint /api/auth/refresh, /api/auth/logout
- [x] Correlation ID — `x-request-id` em toda requisição, aparece nos logs e erros
- [x] CI pipeline — GitHub Actions (backend: tsc + jest; frontend: tsc + vite build)
- [x] Axios interceptor com refresh automático em 401 (sem redirect para login)
- [x] Google OAuth gera refresh token consistente com login email/senha
- [x] URLs hardcoded removidas — tudo via `APP_URL` env var
- [x] Login: ícone olho para mostrar/esconder senha (Login.tsx)
- [x] CadastroPessoal: redirect corrigido — `/animais` só no onboarding (`s2vet_ob==='p'`), senão `/meus-animais`
- [x] Fluxo DESVINCULO vet-animal — `VetAnimalSolicitacao.tipo` (migration `20260523`), email `enviarSolicitacaoDesvinculo`, cron 24h auto-accept em `server.ts`
- [x] Hooks polling: `useProprietarioNotificacoes` + `useVetSolicitacaoMonitor` — ambos chamados no Sidebar
- [x] AnimaisVet.tsx (aba Pacientes do vet): exibe solicitações pendentes (VINCULO + DESVINCULO) com SolicitacaoCard antes da lista de animais
- [x] VetDashboard.tsx: SolicitacaoCard com diferenciação visual VINCULO vs DESVINCULO
- [x] `GET /animais/minhas-solicitacoes` — novo endpoint para proprietários acompanharem status
- [x] Fluxo TROCA_VET — `novoVetUserId` (migration `20260523140000_add_troca_vet`), email `enviarSolicitacaoTrocaVet`, cron 24h auto-accept com step2 VINCULO PENDENTE para novo vet
- [x] `DELETE /animais/:id/cancelar-solicitacao` — proprietário cancela (rollback por tipo: VINCULO→CANCELADO, DESVINCULO→restaura VINCULO ACEITO, TROCA_VET→restaura VINCULO ACEITO)
- [x] MeusAnimais.tsx — badge por tipo (VINCULO=amber, DESVINCULO=red, TROCA_VET=blue) + botão cancelar com modal de confirmação
- [x] VetNotificationModal — modal bloqueante para vets (localStorage tracking de IDs vistos, suporte VINCULO/DESVINCULO/TROCA_VET)
- [x] SolicitacaoCard com TROCA_VET em VetDashboard.tsx e AnimaisVet.tsx (border orange, "Aceitar troca" / "Manter vínculo")
- [x] useProprietarioNotificacoes: toast TROCA_VET (ACEITO = aprovação step1, RECUSADO = troca recusada)
- [x] useVetSolicitacaoMonitor: toast para novas solicitações detectadas durante polling
- [x] EvolucaoClinica.titulo — campo opcional para nomear a evolução (migration `20260524`)
- [x] EvolucaoMidia — tabela para anexar imagens/vídeos/áudio à evolução (migration `20260524`)
- [x] EvolucaoController expandido: `transcrever` (Whisper), `adicionarMidia`, `removerMidia`, `salvarTitulo`, rota `interpretar` com LLM
- [x] Prescrição expandida — campos `tipo`, `status`, `dosagem`, `unidade`, `duracaoDias`, `horaInicio`, `horariosGerados` (JSONB), `diasAplicacaoInicio/Fim` (migration `20260526`)
- [x] PrescricaoController.js — CRUD + `finalizarTodas` (RASCUNHO→ATIVA + cria FaturaItems)
- [x] Rotas `/api/clinica/prescricoes` montadas em server.ts
- [x] Atendimento.tsx refatorado como shell — delega a SubModuloEvolucao, SubModuloPrescricao, SubModuloVacina, SubModuloExames, SubModuloEncaminhamento
- [x] SubModulo* com speech recognition online (Web Speech API) + Whisper offline (whisperService)
- [x] EvolucaoPrint.ts — utilitário de impressão de evoluções clínicas
- [x] ModuloSistema + PermissaoMembro + AuditoriaPermissao + PermissaoProprietario (migration `20260524`)
- [x] PermissaoController.js + seeds/002_permissoes_padrao.seed.js
- [x] RBAC dois níveis: ADMIN global (locked=true em MatrizPerfil, propagado via raw SQL) + Gestor por equipe (locked=false)
- [x] PROPRIETARIO como perfil do sistema na MatrizPerfil — ações restritas a ler/imprimir; minhasPermissoes lê MatrizPerfil das equipes vinculadas aos animais do proprietário (union de níveis)
- [x] ControleAcesso.tsx refatorado: TabPermissoesGlobais (ADMIN, UserTypes VETERINARIO/ESTAGIARIO/PROPRIETARIO), TabMatriz com lock icon em itens imutáveis, PROPRIETARIO como perfil SISTEMA na lista, sem TabProprietarios
- [x] MatrizPerfil.locked (campo Boolean, adicionado via raw SQL — `npx prisma generate` necessário após parar backend)
- [x] alterarCargo valida contra PerfilEquipe (aceita customizados) — bloqueia PROPRIETARIO como cargo de membro
- [x] AnimalCard.tsx: campo `tipo` adicionado à interface Solicitacao; lógica de resolução do vet corrigida (DESVINCULO PENDENTE e TROCA_VET PENDENTE → vet ainda ativo; VINCULO PENDENTE → badge âmbar)
- [x] DESVINCULO aceito: `veterinarioNome` e `veterinarioClinica` limpos em 3 pontos (proprietarioAprovar, responderSolicitacaoVet, cron autoAceitarSolicitacoesPendentes)
- [x] TROCA_VET: `solicitanteId` incluído no UPDATE branch do upsert em VeterinarioController e server.ts (corrige popup de autorização aparecendo para proprietário errado)
- [x] TROCA_VET recusa: restaura `{tipo:'VINCULO', status:'ACEITO'}` ao invés de RECUSADO + email ao proprietário notificando recusa — em `responderSolicitacao` e `responderViaEmail`
- [x] VetDashboard.tsx + AnimaisVet.tsx: toasts diferenciados por tipo ao responder solicitações (ACEITO: toast.success; RECUSADO: toast() com ícone 🔒/🔄/❌ por tipo); try-catch em handleResponderModal
- [x] useProprietarioNotificacoes: inicialização exclui RECUSADO/CANCELADO do mapa inicial; janela de updatedAt ampliada de 90s para 10min; polling reduzido de 30s para 15s
- [x] SubModuloEvolucao.tsx: botões Salvar e Finalizar desabilitados enquanto gravacaoAtiva, transcrevendo, ou texto vazio
- [x] Módulo Cadastro — migration `20260605005109_add_proprietario_tratador_fields`:
  - User: cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas, isConvidado (agora em migration)
  - Model Tratador (tb_tratadores): nome, telefone, localTrabalho, ativo, empresaId
  - Fatura: animalId nullable, proprietarioId, mesReferencia (drift aplicado via migration)
  - FaturaItem: animalId adicionado
  - MatrizPerfil.locked agora na migration (não mais só via raw SQL)
- [x] ProprietarioController.js + TratadorController.js + rotas `/api/cadastro/proprietarios` e `/api/cadastro/tratadores`
- [x] Seeds `cadastro.proprietario.*` e `cadastro.tratador.*` (8 novos slugs, padrões VET/EST/PROP)
- [x] CadastroProprietario.tsx — CRUD com CPF/CNPJ (validação + máscara), CNPJ auto-fill via BrasilAPI, toggle mensalista → valor assistência, combo frequência de visitas (1-7x/semana), CEP via ViaCEP, mobile-first
- [x] CadastroTratador.tsx — CRUD simples (nome, telefone, local de trabalho), mobile-first
- [x] Sidebar: sub-accordion **Cadastro** dentro de GERAL — Cadastro Pessoal + Pacientes + Proprietários + Tratadores
- [x] Migrations `20260601000001` e `20260601000002` corrigidas com DO $$ IF EXISTS para shadow DB (proprietarioId e animalId adicionados fora de migration)
- [x] Módulo Localização de Animal — `LocalizacaoAnimal` (tabela global `tb_localizacoes_animal`), `LocalizacaoAnimalController.js`, rota `/api/cadastro/localizacoes`, `CadastroLocalizacao.tsx`. ADMIN cria SYSTEM (imutável), outros criam CLIENTE. Mapeamento `TIPO_ESPECIES` estático. Migration `20260609120000`.
- [x] Animal.tsx — campo `local` (free text) substituído por combobox pesquisável de `LocalizacaoAnimal`. Filtra por espécie. "Criar [nome]" abre mini-modal inline (nome + tipo). Salva `localizacaoId` + `local` (nome para compat). Migration `20260609130000`. ANIMAL_INCLUDE inclui relação `localizacao`.
- [x] RBAC enforcement real para PROPRIETARIO — `getNivelPermissaoProprietario()` em `permissao.middleware.js` (era bypass total — bug crítico corrigido)
- [x] Nível NEGADO (ordinal -1, deny-wins) adicionado a MatrizPerfil, PermissaoMembro, frontend `usePermissoes`, ControleAcesso UI
- [x] Cargo PRESTADOR (userType FORNECEDOR) adicionado ao sistema — PerfilEquipe, MatrizPerfil, seed 002, ControleAcesso UI, `convidarParaEquipe`
- [x] `getFornecedoresPorEquipe` — endpoint GET `/api/equipes/:equipeId/fornecedores` (busca fornecedores da empresa, exclui já-membros)
- [x] ControleAcesso.tsx refatorado com 5 abas para GESTOR: Matriz de Perfis, Equipe, Proprietários, Convites, Logs de Auditoria. TabEquipe com modal 2 passos (tipo → busca/formulário). TabProprietarios lista read-only. TabConvites com cancel.
- [x] `checkPermission` isolamento por empresa — `listarMembrosPorEquipe` verifica que a equipe pertence à empresa do gestor requisitante
- [x] `getPermissoesProprietarios` corrigido — filtro por `empresaId` da equipe (era global — vazamento de dados entre empresas)
- [x] `minhasPermissoes` para PROPRIETARIO — deny-wins explícito: NEGADO de qualquer equipe bloqueia módulo, sem override por nível positivo de outra equipe
- [x] Permission enforcement em `Dieta.tsx` — guard de página, gating de useEffects em `loadingPerms`, guards em 6 handlers de escrita, UI condicional por `podeCriar`/`podeEditar`/`podeImprimir`
- [x] `DietaAcoesBar.tsx` — props `podeImprimir`, `podeCompartilhar`, `podeExportar`; botões ocultam/bloqueiam com toast quando sem permissão
- [x] Axios interceptor 403 — GET resolve com `{ data: null }` silencioso; mutations rejeitam com `isPermissionError: true` (sem log)
- [x] Console suppression em produção — `main.tsx` sobrescreve `console.*` com noop quando `!import.meta.env.DEV` (escape hatch: `VITE_SUPPRESS_CONSOLE=true` em dev)
- [x] `UsuarioFormModal.tsx` — formulário compartilhado de criação/edição de usuário (abas Dados/Endereço, busca CEP). Usado em `Usuarios.tsx` (Novo/Editar) e `Equipe.tsx` (Incluir/Editar Membro). Perfil de acesso: VETERINARIO/ESTAGIARIO/PRESTADOR(label Fornecedor)/GESTOR — sem "tipo de usuário" e sem campo senha na criação (padrão `Inicial_001` + `mustChangePassword`); telefone obrigatório. Edição: prop `permitirSenha` exibe "Nova senha" — hoje SÓ na auto-edição em `Equipe.tsx`; `Usuarios.tsx` deixou de passar a prop em 2026-08-04 (ver §14); prop `emailBloqueado` desabilita e-mail (usado na edição de membro). Backend: `POST /users` cria sem senha (default Inicial_001, `mustChangePassword: !senha`, phone obrigatório); `POST /equipes/incluir-membro` aceita fullName/phone/endereço (obrigatórios: nome e telefone) e `cargoToUserType` ganhou `GESTOR→VETERINARIO` (antes caía em ESTAGIARIO); `atualizarMembro` (PUT /equipes/membros/:id) ganhou autorização (ADMIN ou gestor da empresa da equipe; gestor não edita gestor — antes QUALQUER autenticado podia editar/trocar senha — bug crítico) + campos endereço/ativo + validação de senha. `listarMembros` retorna phone/endereço. Usuarios.tsx: tabela com `overflow-x-auto` (estourava à direita). Equipe.tsx: edição antiga chamava PATCH inexistente (404) — corrigido para PUT
- [x] CadastroProprietario.tsx sem campo senha — criação usa padrão `Inicial_001` (`ProprietarioController.criar`: senha opcional, telefone obrigatório no backend); e-mail `enviarBoasVindasProprietario` segue com a senha efetiva; botão "Novo Proprietário" do empty state removido (só header). `POST /users` também envia `enviarBoasVindasProprietario` quando criado sem senha (lógica de e-mail unificada entre Usuários e Proprietários)
- [x] RBAC por contexto ativo — `minhasPermissoes` e `checkPermission`/`resolveEquipeId` resolvem cargo/permissões da equipe/empresa ATIVA (não mais o vínculo mais recente); bypass de dono restrito à empresa ativa; bypass de dono-da-equipe quando sem MembroEquipe; `PermissaoController` com guard `autorizarGestorDaEquipe` em todas as rotas `/:equipeId` (antes qualquer autenticado podia ler/editar matriz de qualquer equipe — gap crítico)
- [x] Seletor de contexto ativo (gestor multi-empresa/multi-equipe) — `EmpresaContext.tsx` (localStorage `s2vet_empresa_id`/`s2vet_equipe_id`), headers `x-empresa-id`/`x-equipe-id` no axios, seletor no Sidebar (só com >1 opção; trocar = reload). Empresa CNPJ = opção por empresa; empresa pessoal CPF = opção por equipe. Backend: `auth.js` valida vínculo dos headers antes de setar `req.empresaId`/`req.equipeId`; `getEmpresaDoGestor(userId, req.empresaId)` prioriza a selecionada; `getEquipeAtiva(empresaId, req.equipeId)` em listarConvites/removerConvite; `garantirEquipePadrao`/`getMinhaEquipe`/`listarMembros` preferem a equipe ativa; `AnimalController` usa `req.empresaId` nos vínculos iniciados via request; `Fornecedor.empresaId` (migration `20260611130000`, null = SYSTEM/legado global, CLIENTE escopado à empresa ativa)
- [x] Gestor multi-empresa/equipe — migration `20260611120000_unique_empresa_equipe_por_gestor`: drop do unique global de `Empresa.cnpj`, add unique(ownerId, nome, cnpj) em Empresa + unique(empresaId, nome) em Equipe. Checks de duplicidade (case-insensitive) em `criarEmpresa`, `criarEquipe`, `setup`, `convidarGestorAdmin` (reuso de empresa por CNPJ agora exige CNPJ+nome; empresa pessoal exige owner+nome) e `EquipeService.criarEmpresaEEquipe` (removido bloqueio "1 empresa por gestor")
- [x] `Animal.equipeId` (migration `20260611150000`) — segregação de permissões PROPRIETARIO por equipe; `getContextoDoVet` em vetUtils; equipeId setado/limpo em todos os fluxos de vínculo (AnimalController, VeterinarioController, cron server.ts); `getEquipeIdsDoProprietario` compartilhado entre middleware e `minhasPermissoes`; backfill incluído na migration
- [x] Módulo Encaminhamento + Designação de Prestador (migration `20260611170000_designacao_prestador`) —
      `DesignacaoPrestador` (escopo de acesso do FORNECEDOR por animal), `Fornecedor.userId`,
      `EncaminhamentoClinico.prestadorId`, `EncaminhamentoController` + rotas `/api/clinica/encaminhamentos`,
      branch FORNECEDOR em `animalAccess.js` e `AnimalController.listar` (deny-by-default: prestador só vê
      animais com designação ativa), `SubModuloEncaminhamento.tsx` completo
- [x] `Fornecedor.email` (migration `20260611180000_add_fornecedor_email`) — email/telefone obrigatórios
      na app (nullable p/ legado); CadastroFornecedor.tsx com Documento (CPF/CNPJ) como 1ª seção do modal
- [x] Vínculo automático `Fornecedor.userId` na inclusão de membro PRESTADOR — `incluirMembroDireto`
      aceita `fornecedorId` (vincula cadastro existente; 409 se já vinculado a outro user) ou
      `tipoServico` (cria cadastro CLIENTE novo). Fluxos: UsuarioFormModal `comFornecedor` (Equipe.tsx,
      perfil de acesso como 1º campo + seletor de fornecedores disponíveis = ativo && !userId) e
      ControleAcesso TabEquipe passo 2 PRESTADOR (lista tb_fornecedores disponíveis + "Cadastrar novo
      fornecedor"; inclusão DIRETA via /equipes/incluir-membro — VET/EST seguem via convite)
- [x] Tela do animal redesenhada (AnimalDetail.tsx) — Histórico unificado + Agendamentos.
      `AgendamentoClinico` (migration `20260611190000`), `HistoricoController` (agregação de 5 origens),
      `AgendamentoController` (CRUD com acesso via verificarAcessoAnimal), rotas em `routes/agenda.js`
      montadas em `/api/clinica`. Botões de acesso rápido aos módulos removidos da tela
- [x] **RBAC enforcement completo — auditoria 2026-06-24:**
  - Bug crítico corrigido em `medicamentos.js` e `procedimentos.js`: `requireAdmin` checava `req.user?.role`
    (sempre `undefined`) ao invés de `req.user?.userType` → nenhum usuário (nem ADMIN) conseguia
    criar/editar/excluir medicamentos ou procedimentos. Corrigido para `req.user?.userType`.
  - `checkPermission` adicionado a 6 route files que tinham slugs no seed mas nenhum enforcement:
    `farmacia.js` (farmacia.estoque.*/movimentacoes.ler), `estoqueVacina.js` (vacina.estoque.*),
    `proprietarios.js` (cadastro.proprietario.*), `tratadores.js` (cadastro.tratador.*),
    `fornecedores.js` (cadastro.fornecedor.*), `localizacoes.js` (cadastro.localizacao.* + soAdmin inline para PUT/PATCH)
  - Catálogos ADMIN-only protegidos com `soAdmin` inline: `alimentos.js`, `nutrientes.js`,
    `composicaoAlimentar.js` (POST/PUT/DELETE + analisar-llm + importar-completo). GETs livres (usados em dropdowns).
  - `resenha-grafica.js` PUT protegido: apenas ADMIN e VETERINARIO podem salvar resenha gráfica.
  - `ExameClinicoController.js` — método `atualizar` adicionado; `clinica-exames.js` — `PUT /:id`
    com `checkPermission('atendimento.exames.editar', 'PROPRIO')` (slug existia no seed sem rota).
  - `Exames.tsx` — slug mismatch corrigido: `exames.laboratorial.*` → `atendimento.exames.*`
    (frontend estava usando slug diferente do backend, desconectando o controle de acesso).
  - `CriaExameNutricional.tsx` — adicionados `usePermissoes`, page guard e handler guards para
    `atendimento.exames.criar` (página não tinha nenhuma verificação de permissão).
- [x] **Regra de finalização por autoria** — `atendimento.{evolucoes|prescricoes|vacinas|encaminhamentos|exames}.finalizar`:
  - GESTOR: bypass total (checkPermission). FORNECEDOR: finaliza apenas itens com `veterinarioId === req.user.id`. VET/ESTAGIARIO/outros: NENHUM no seed → bloqueados em checkPermission.
  - Seed: VET finalizar PROPRIO → NENHUM; FORNECEDOR recebeu PROPRIO em todos os módulos; novos slugs `atendimento.encaminhamentos.finalizar` e `atendimento.exames.finalizar` adicionados ao ModuloSistema + todos os perfis.
  - Rotas: `PATCH aprovar` (evolucoes) usa `finalizar PROPRIO`; prescricoes `/grupos/:id/finalizar|cancelar` e legados usam `finalizar PROPRIO`. Novos: `PATCH /:id/finalizar` em `clinica-exames.js` (→ status CONCLUIDO) e `encaminhamentos.js` (→ CONCLUIDO + inativa designação).
  - Controllers: `PrescricaoGrupoController` — removido check hardcoded `membroEquipe.cargo=GESTOR`; adicionado FORNECEDOR ownership check. `PrescricaoController.finalizarTodas` — FORNECEDOR filtra por `veterinarioId`. `ExameClinicoController.criar` — `veterinarioId` sempre `req.user.id` (antes: null para não-VET). `EvolucaoController.aprovar` e `EncaminhamentoController` — FORNECEDOR ownership check.
  - VacinaClinica: ciclo `status` SALVA→FINALIZADA→EXECUTADA (migration `20260729000000` adicionou
    `status`; EXECUTADA é só valor novo, sem migration). **Mesma lógica da Prescrição — a fatura e o
    débito de estoque acontecem SÓ na EXECUÇÃO, não no registro:**
    - `registrar` → cria SALVA. NÃO debita lote nem lança fatura (só fixa o lote sugerido/valor de referência).
    - `PATCH /clinica/vacinas/:id/finalizar` (`atendimento.vacinas.finalizar PROPRIO`) → SALVA→FINALIZADA;
      a vacina passa a aparecer na tela de **Execução de Prescrição** (plantão).
    - `PATCH /clinica/vacinas/:id/executar` (`enfermagem.prescricao.executar PROPRIO`) → FINALIZADA→EXECUTADA:
      debita o lote (usa o vinculado ou FEFO) + lança `FaturaItem` (tipo VACINA, `vacinaClinicaId`). Guarda
      contra legado: se já existe FaturaItem do registro (vacinas criadas na lógica ANTIGA que faturava no
      `registrar`), NÃO refatura nem redebita — só muda o status.
    - `GET /clinica/vacinas/para-execucao` (`enfermagem.prescricao.ler`) → vacinas FINALIZADAS aguardando
      aplicação, escopo por empresa (`escopoFilhoEvolucaoWhere`). Consumido por `ExecucaoPrescricao.tsx`
      (seção "Vacinas a aplicar", executa via o endpoint acima).
- [x] **Regra de autoria em editar** — `EvolucaoController.atualizar`, `PrescricaoController.atualizar`, `ExameClinicoController.atualizar`, `EncaminhamentoController.atualizar`: GESTOR edita qualquer item (via `req.membroCargo === 'GESTOR'`); demais só editam itens que criaram (`veterinarioId === req.user.id` → 403 caso contrário). VacinaClinica.atualizar: pendente de migration para campo `status`.
- [x] **Rastreabilidade FaturaItem ↔ origem clínica** (migration `20260701000001_fatura_item_origem`) —
      `FaturaItem` ganhou 4 FKs nullable: `exameClinicoId`, `prescricaoId`, `vacinaClinicaId`,
      `encaminhamentoClinicoId`, setadas por `adicionarFaturaItem` (`faturaUtils.js`) em todo ponto que
      lança cobrança (`ExameClinicoController.finalizar`, `VacinaClinicaController.registrar`,
      `EncaminhamentoController.criar`, `PrescricaoGrupoController.executar`).
      **Exame → fatura (premissa 2026-07-16):** o exame é lançado com VALOR ZERADO assim que a
      EVOLUÇÃO é FINALIZADA (`EvolucaoController.atualizar` quando `vaiFinalizar`), não só ao concluir o
      exame. Helper idempotente `lancarExameNaFatura(tx, exame, proprietarioUserId)` (`faturaUtils.js`)
      evita duplicar entre os dois gatilhos (checa `exameClinicoId` já faturado); `ExameClinicoController.finalizar`
      também passou a usá-lo. `medicamentoCliente` (prescrição) NÃO gera FaturaItem ao executar. Editar (descrição) ou
      excluir um exame/vacina/encaminhamento já faturado agora sincroniza (`atualizarFaturaItensDaOrigem`/
      `removerFaturaItensDaOrigem`) o(s) `FaturaItem` vinculado(s) dentro da mesma transaction — se a
      fatura de destino já estiver `PAGA`, a operação é bloqueada com 400 `{ code: 'FATURA_PAGA' }` e
      nada muda (nem o item de origem). Prescrição não precisou de bloqueio novo: `PrescricaoGrupoController`
      já impede editar/excluir item fora do status `SALVO`, e `FaturaItem` só existe a partir de
      `FINALIZADO`/`executar` — logo o gate de status existente já cobre a regra; `prescricaoId` foi
      adicionado só para rastreabilidade/relatórios. `HistoricoController` não precisou de mudança — já
      filtra `ativo: true` nas 4 origens, então soft delete já remove do histórico automaticamente.
      `FaturaController.recalcularTotal` foi movido para `faturaUtils.js` (aceita `prisma` ou `tx`) e é
      reusado pelos helpers novos.
- [x] **Página Configurações (logotipo + dia de fechamento de fatura)** — migrations `20260702000001_empresa_configuracao`
      e `20260702010000_fatura_tipo_fechamento`. Model `EmpresaConfiguracao` (único por empresa CNPJ ou
      por equipe/empresa pessoal — mesmo critério do `EmpresaContext`) com `logoUrl`, `tipoFechamento`
      (`DIA_FIXO` | `DIA_UTIL` | `ULTIMO_DIA_MES` | `null`=compat) e `diaFechamentoFatura` (dia do mês
      1-31 p/ `DIA_FIXO`, Nº do dia útil 1-10 p/ `DIA_UTIL`). `EquipeController.obterConfiguracao`/
      `salvarConfiguracao` (reusam os helpers privados `getEmpresaDoGestor`/`getEquipeAtiva` já
      existentes no arquivo); rotas `GET/PUT /api/equipes/configuracoes` (antes de `/:equipeId`), upload
      de logo via `storage` (`StorageProvider`, pasta `empresas/`) igual ao padrão de foto de animal.
      Frontend: `Configuracoes.tsx` (baseada em `Animal.tsx` — mesma função `comprimirImagem` e widget
      de upload), select com 4 opções amigáveis (Último dia do mês / Primeiro dia do mês / Dia
      específico / Dia útil do mês — "Primeiro dia do mês" é só um atalho de UX pra `DIA_FIXO` dia=1,
      o backend não distingue os dois), rota `/configuracoes`, link no Sidebar dentro de **Geral**
      (`isGestor &&`, não dentro do sub-accordion Cadastro).
      **Cálculo de dia útil** (`faturaUtils.js`): considera fins de semana + feriados nacionais
      obrigatórios por lei federal (sem estaduais/municipais, sem pontos facultativos como Carnaval/
      Corpus Christi). Feriados móveis (Sexta-feira Santa) calculados via algoritmo de Gauss para a
      Páscoa — não depende de tabela mantida ano a ano. `deveFecharHoje(config, hoje)` é o dispatcher
      único (usado tanto pelo cron quanto testável isoladamente); tem compat com configs antigas
      (linhas com `diaFechamentoFatura` mas sem `tipoFechamento` são tratadas como `DIA_FIXO`).
      **Mudança de comportamento em produção:** o cron `fecharFaturasDoMes` (`server.ts`) que antes
      rodava só no último dia do mês para TODAS as faturas `ABERTA` agora roda **todo dia às 23:45** e
      decide por fatura, via `resolverConfigsFechamento` (resolve as equipes do proprietário com
      `getEquipeIdsDoProprietario`, já exportado de `permissao.middleware.js`, mapeia para o escopo de
      `EmpresaConfiguracao` de cada uma). Fallback: se nenhuma equipe do proprietário tiver
      configuração, o comportamento antigo é preservado — fecha só no último dia do mês.
      **Fatura fechada vs paga:** `FECHADA` continua permitindo edição de itens existentes E
      lançamento manual de novos itens pelo financeiro (`FaturaController.adicionarItem`) — só `PAGA`
      bloqueia qualquer alteração (`adicionarItem`/`atualizarItem`/`removerItem` agora checam
      `fatura.status === 'PAGA'` → 400 `FATURA_PAGA`, mesmo código usado pelos helpers de sincronização
      de `faturaUtils.js`). Itens de origem clínica (exame/vacina/encaminhamento/prescrição) nunca
      caem numa fatura fechada por construção: `getOrCreateFatura` só busca fatura `status: 'ABERTA'` —
      se a do mês já fechou, cria uma nova automaticamente. Não precisou de nenhuma mudança pra isso.
- [x] **Farmácia — Ajuste de Estoque + regra de item "em uso" (2026-07-10):**
      Bug corrigido: `EstoqueController.atualizar` bloqueava edição de quantidade/lote/validade
      contando QUALQUER movimento — mas `criar` gera automaticamente um movimento ENTRADA
      ("Entrada inicial") quando qtdEstoque > 0, travando o item recém-cadastrado. Agora
      `contarMovimentos()` conta apenas movimentos **SAIDA** (mesmo critério do flag `emUso`
      da listagem): item só trava depois de uso real. `ajustarEstoque` aceita **delta com
      sinal** no tipo AJUSTE (correção para baixo não vira SAIDA — não marca `emUso`).
      UI (Farmacia.tsx): botão "Ajuste de Estoque" ao lado de "Entrada de Estoque"; modal no
      mesmo padrão da entrada com seletor pesquisável de item do estoque (nome/lote/qtd);
      campo "Quantidade em Estoque" **pré-preenchido com a atual** — usuário informa a contagem
      real e a diferença é registrada como AJUSTE com motivo obrigatório (delta 0 não registra;
      zerar é permitido). Slug novo `farmacia.estoque.ajustar` na rota + seed + coluna AJUSTAR
      no ControleAcesso (`MODULO_ACAO_COLS_OVERRIDE.farmacia`). Gráfico de movimentos usa
      `Math.abs` na barra de ajuste (pode ser negativo).
- [x] **Modais arrastáveis no desktop (2026-07-10)** — hook global `useDraggableModals`
      (montado uma vez em App.tsx), delegação de eventos: alça = cabeçalho `.rounded-t-2xl`/
      `.rounded-t-3xl`/`h2`/`h3`/`[data-drag-handle]`; painel = primeiro ancestral `fixed`
      OU filho direto de overlay `fixed` de tela cheia (backdrop nunca move). Só mouse e
      viewport ≥768px; clamp mantém o modal ao alcance; deslocamento vive no nó DOM (reset ao
      reabrir); suprime o click pós-arraste (evita fechar modais close-on-backdrop quando o
      mouse solta sobre o overlay). Cursor `move` nas alças via index.css. Nenhum modal
      precisou ser alterado — modais novos ganham o comportamento automaticamente.
- [x] **WhatsApp da empresa em Configurações (2026-07-10)** — `EmpresaConfiguracao.whatsapp`
      (migration `20260710000002_empresa_config_whatsapp`, TEXT nullable, somente dígitos
      DDD+número). `EquipeController.obterConfiguracao`/`salvarConfiguracao` leem/gravam o campo
      (normaliza p/ dígitos; valida 10-15; string vazia remove). `Configuracoes.tsx`: campo com
      máscara BR `(11) 98765-4321` e ícone MessageCircle. Apenas armazenamento — integração de
      envio/recebimento de mensagens ainda não implementada.
- [x] **Auditoria de exclusões/cancelamentos com justificativa obrigatória (2026-07-10):**
      AuditLog estendido (migration `20260710000003_audit_exclusoes`): `categoria`
      (EXCLUSAO|CANCELAMENTO), `entidade`, `entidadeId`, `animalId`, `motivo`, `detalhes` +
      índices categoria/timestamp; `ip` adicionado na migration `20260710000004_audit_ip`.
      Helper `lib/auditoria.js` → `registrarAuditoria(clientOuTx, req, dados)` — INSERT via SQL
      parametrizado (funciona com client desatualizado), grava `ip` via `ipDoRequest(req)`;
      passar `tx` quando a operação já roda em transaction (atomicidade). Motivo OBRIGATÓRIO (400 sem
      ele) + registro central em: Evolucao excluir/cancelar (já exigia justificativa — agora
      audita estruturado), VacinaClinica.excluir (já exigia motivo), ExameClinico.excluir,
      ExameController.delete (nutricional), Prescricao.excluir (legado), PrescricaoGrupo
      removerItem/cancelar, Encaminhamento excluir/atualizarStatus(CANCELADO), Agendamento
      excluir/atualizarStatus(CANCELADO), EstoqueController.excluir (farmácia),
      EstoqueVacina.excluir, Medicamento.excluir, Procedimento.excluir, DietaItem.excluirItem,
      e (2026-07-10, fechamento das exceções da regra) Animal.excluir (entidade ANIMAL —
      soft delete GLOBAL: o animal some para todos, inclusive proprietário),
      FaturaController.removerItem (FATURA_ITEM — além do registrarCorrecaoFatura) e
      ProprietarioController.removerDaEmpresa (PROPRIETARIO — detalhes incluem contagem
      de animais inativados no escopo). Frontend desses três: MeusAnimais/AnimalView
      (ModalJustificativa no lugar do modal antigo), Faturamento (remoção de item via
      modal) e CadastroProprietario (ConfirmModal → ModalJustificativa).
      Frontend: `components/ModalJustificativa.tsx` (modal padrão de exclusão/cancelamento com
      textarea obrigatória ≥3 chars, header vermelho) integrado em Farmacia, EstoqueVacina,
      SubModuloExames, Exames, SubModuloPrescricao (remover item; CancelarModal agora exige
      motivo), SubModuloEncaminhamento, SubModuloMinhaAgenda, AnimalDetail, Medicamentos,
      CadastroVacina, Procedimentos e Dieta — Agendamentos.tsx já coletava motivo (dropdown).
      Tela `/auditoria-geral` (`AuditoriaGeral.tsx`) no Sidebar > Geral (GESTOR/ADMIN):
      GET `/api/audit/logs` — ADMIN global (?empresaId opcional); GESTOR/dono → empresa ativa;
      demais 403. Filtros: categoria, entidade, busca, período; paginação (50/pág).
- [x] **Reserva de estoque multi-lote FEFO em prescrições (2026-07-10):**
      Bug estrutural: `criarReservas` NUNCA era chamado (reservas só eram liberadas) e todos os
      helpers de estoque usavam `findFirst` (uma única entrada por medicamento) — segunda
      entrada do mesmo medicamento era ignorada em verificação e baixa. Agora:
      `buscarEstoquesFEFO` (todas as entradas ativas; validade mais próxima primeiro, sem
      validade por último). `finalizar` verifica disponibilidade AGREGADA (soma dos lotes −
      reservas de outras prescrições; insuficiente → 409 `ESTOQUE_INSUFICIENTE` com alertas,
      reenvio com `forcarFinalizacao: true` prossegue — frontend AlertaEstoqueModal já suportava)
      e CRIA reservas distribuídas entre os lotes (restante forçado no último lote quando não há
      saldo). `debitarEstoqueDia(tx, itens, empresaId, grupoId?)` debita a dose do dia em FEFO
      através dos lotes (um MovimentoEstoque SAIDA por lote; valor da dose soma o
      precoUnitarioBase de cada lote debitado) e ABATE as reservas do grupo na mesma proporção.
      `verificarEstoqueParaDia`/`verificarDisponibilidade` somam todas as entradas. `executar`
      libera reservas remanescentes no último dia; `removerItem` recalcula as reservas dos itens
      restantes (remove órfãs do medicamento excluído). `cancelar` já liberava via
      `liberarReservas`.
- [ ] Slugs orphans `exames.laboratorial.*` e `exames.imagem.*` — existem no seed e aparecem no ControleAcesso mas não protegem nenhum endpoint real (backends usam `atendimento.exames.*`). Gestores que configurarem esses slugs não controlam nada efetivamente. Decisão pendente: remover do seed ou implementar granularidade real por tipo de exame.
- [x] Sidebar/páginas de agenda: migrar gate de role check (`isVetOuSuperior`) para `podeExecutar('atendimento.agendamentos.ler')` — Agenda usa permissão real; Minha Agenda mantém `isVetOuSuperior && podeVerAgendamentos` (sub-view específica de vet). Dashboard oculto para VET (non-Gestor) e ESTAGIÁRIO no Sidebar — eles têm "Pacientes" como home; GESTOR (bypass) continua vendo.
- [x] UI de gestão de designações no ControleAcesso (aba Profissionais → membro PRESTADOR →
      "Gerenciar Acesso"), no MESMO padrão do "inserir exames" (`SubModuloExames`): filtro por LOCAL
      (localização cadastrada, com fallback no campo textual legado `local`; só lista locais que têm
      animal a designar, com a contagem) + dropdown de SELEÇÃO MÚLTIPLA com busca própria (sem
      acento/caixa) e checkbox por animal, exibindo **apenas o nome do animal**; marcados viram chips
      numerados com X e "Limpar tudo". Dentro do dropdown, **Marcar todos (N)** cobre o "conceder o
      local inteiro" — por isso existe UM só botão de ação, **Inserir**, no visual do "Incluir Membro"
      da tela (emerald, canto direito). Na lista "Com acesso ativo", botão **Remover todos** (vermelho,
      ao lado da contagem) revoga tudo de uma vez via `DELETE …/designacoes` sem `:animalId`, com
      `ConfirmModal` antes. O histórico de acessos removidos NÃO é exibido (segue no banco).
      Backend: `POST …/designacoes/lote` numa transaction — marcar 1 ou 20 é a mesma chamada (um POST
      por animal parava no meio e deixava acesso concedido pela metade).
- [ ] Backfill empresaId nos animais existentes via VetAnimalSolicitacao
- [ ] `empresaId` em EvolucaoClinica, Fatura (após enforcement)
- [ ] Row-Level Security no PostgreSQL (fase enterprise)
- [ ] Testes unitários nos services de permissão e equipe
- [ ] Frontend: migrar raw `fetch('/api...')` restantes para `authFetch` ou `api` (axios)

---

## 15. AGENDA — TEMPO DE CONSULTA POR ESPECIALIDADE

Cadastro (card "Locais de trabalho" do membro):
```
MembroLocalTrabalho.temposConsulta  JSONB  { "<especialidadeId>": minutos }
```
O tempo é POR LOCAL e POR ESPECIALIDADE — a mesma especialidade pode levar 30min na
clínica e 60min a campo. Aceita múltiplos de 5, de 5 a 480 min — a grade é regerada a
partir do início do expediente a cada dia, então 45/90min não desalinham nada.

**OPCIONAL desde 2026-07-28 (parte 4)** — dias, horário e tempo de consulta em branco
HERDAM o que estiver configurado na empresa (`EmpresaConfiguracao`):
`diasAtendimento` / `horaInicioAtendimento` / `horaFimAtendimento` e o novo
`tempoConsultaPadraoMin` (migration `20260806000000`; null = 60 min, o
`TEMPO_CONSULTA_PADRAO_SISTEMA`). A herança é DINÂMICA — o valor da empresa NUNCA é
copiado para dentro do local; mudou em Configurações, mudou a agenda de todo mundo que
não configurou. `parseLocaisTrabalho` grava a ausência como ausência (a especialidade
some do JSON) e só valida o valor quando ele é informado.
**Quem tem especialidade e tempo de consulta (2026-07-28, parte 4; GESTOR em 2026-08-04)**
```
VETERINARIO → tem. Sem nenhuma informada, assume CLÍNICA MÉDICA.
FORNECEDOR  → tem, mas aceita NULA (fica sem especialidade mesmo).
GESTOR      → PODE informar, NUNCA é obrigado. Sem nenhuma, fica sem — o padrão
              "assume Clínica Médica" vale só para VETERINARIO.
demais      → NÃO têm especialidade nem tempo de consulta: informam APENAS local e
              horário de trabalho. Cobre ESTAGIARIO, ENFERMEIRO, SECRETARIA e FINANCEIRO.
```
⚠️ O GESTOR entra em `perfilComEspecialidade` nos TRÊS pontos que decidem isso —
`UserController.updateMe`, `EquipeController.atualizarMembro` e `incluirMembroDireto` —
e fora de `ehVet`/`especPadrao` (é isso que o mantém opcional). Deixar de fora qualquer
um dos dois últimos faria a edição do membro pela tela de Equipe gravar os locais com
`semEspecialidade` e APAGAR o que o gestor cadastrou no Cadastro Pessoal.
No front, `CARGOS_COM_ESPECIALIDADE` (CadastroPessoal) ganhou GESTOR, e o texto de ajuda
do seletor passou a seguir `atuaComoVet` — com `form.tipoUsuario` ele prometia ao gestor
o padrão "Clínica Médica" que o backend não aplica (gestor tem userType VETERINARIO).
Fonte única no front: `PERFIS_COM_ESPECIALIDADE` (`UsuarioFormModal`), usada pelo modal e
pelo Cadastro Pessoal — não repetir o `perfil === 'VETERINARIO' || …` em tela nova.
Perfil sem especialidade envia `especialidadeIds: []` e locais com `especialidadeIds`/
`temposConsulta` zerados, então trocar o perfil no meio do preenchimento não deixa resíduo.
⚠️ `UsuarioEspecialidade` é GLOBAL (por usuário, não por equipe): quem é VETERINARIO/
FORNECEDOR por `userType` NÃO tem o cadastro apagado por ocupar cargo sem atuação clínica
numa equipe — senão a edição numa empresa apagaria as especialidades dele na outra
(guarda em `atualizarMembro` e `updateMe`).
O padrão do vet sai de `EquipeController.especialidadesPadraoVeterinario(req, equipeId?,
especiesFallback?)`: o catálogo é POR ESPÉCIE e cada uma tem seu rótulo, então o match é
por PREFIXO `clínica médica` (Equino/Canino → "Clínica Médica", Felino → "Clínica Médica
de Felinos", Bovino → "Clínica Médica (Buiatria)"; Réptil não tem → fica sem padrão) e
devolve UMA especialidade por espécie atendida (`resolverEspeciesAtendidas`, extraída de
`obterEspeciesAtendidas`). Empresa sem espécies configuradas → sem padrão (o fallback das
espécies do próprio vet só é usado no Cadastro Pessoal, onde ele acabou de informá-las).
Aplicado em `incluirMembroDireto`, `atualizarMembro` e `UserController.updateMe` — os três
também têm a garantia final "vet sem NENHUM vínculo `UsuarioEspecialidade` recebe o padrão",
e passam `semEspecialidade` a `parseLocaisTrabalho` para os perfis sem atuação clínica.
NUNCA voltar a exigir especialidade no frontend: o backend é a autoridade da regra.

Resolução do tempo: tempo do local → `EquipeController.tempoConsultaPadraoDaEmpresa(req)`
→ 60. `AgendamentoController.tempoConsultaDoProfissional(vetId, espId, req)` nunca mais
devolve null e o 400 `SEM_TEMPO_CONSULTA` deixou de existir. No front, `passoDe(tempoMin)`
(Agendamentos.tsx) faz o mesmo — e a lista de especialidades do local passou a sair de
`especialidadeIds` (não mais das chaves de `temposConsulta`), senão a especialidade sem
tempo próprio sumiria da grade.

Agendamento:
```
AgendamentoClinico.especialidadeId  → para qual especialidade é o atendimento
AgendamentoClinico.duracaoMin       → SNAPSHOT dos minutos no momento da marcação
```
`duracaoMin` é gravado, **não derivado na leitura**: se o profissional mudar o tempo
da especialidade depois, os agendamentos já marcados mantêm a duração com que
nasceram — senão a agenda do passado se reescreveria sozinha. `null` = agendamento
anterior à migration → tratado como 60min (a grade que a agenda sempre teve).

Regras no backend (`AgendamentoController`):
- `tempoConsultaDoProfissional(vetId, espId)` — varre os locais do profissional e usa
  o MENOR tempo daquela especialidade (é o que cabe em qualquer local). Sem
  configuração → 400 `SEM_TEMPO_CONSULTA`.
- `conflitoDeAgenda(vetId, inicio, duracaoMin)` — colisão por INTERVALO `[ini, fim)`.
  NUNCA voltar a comparar só o `dataHora` de início: uma consulta de 60min às 08:00
  ocupa o slot das 08:30. A janela de busca recua 8h (maior atendimento possível)
  para não perder um agendamento longo ainda em curso.
- O atendimento INTEIRO precisa caber no expediente (`dentroDoExpediente` é chamado
  para o início e para o fim previsto).

**Tela "Expediente Ativo" — uma linha por PROFISSIONAL × LOCAL × ESPECIALIDADE**
(`linhasAtendimento`). Colunas: Profissional · Local de trabalho · Especialidade ·
Dias e horário (coluna única) · Horários Disponíveis. Sem coluna de Função e sem
avatar de iniciais — o nome do profissional aparece por extenso.
A linha SÓ entra quando (1) o local atende no dia selecionado (`exp.dias.includes(wd)`),
(2) a grade não é vazia e (3) sobrou ao menos UM horário livre — clicar numa quinta
não pode listar quem não trabalha na quinta, e profissional lotado não aparece
(não existe estado "Lotado" na tela: a linha simplesmente sai). Ex. real: Marina Sereno tem 3 locais (Sáb/Dermatologia, Seg-Qua/Fisioterapia,
Ter-Qui/Cardiologia) → 3 linhas no total, 1 por dia consultado.
Profissional SEM local cadastrado gera uma linha com local "—" usando o expediente
herdado da empresa (senão sumiria da agenda sem explicação).
`expedienteDoLocal(local)` intersecta o horário/dias DO LOCAL com o da empresa —
`expedienteDoVet` (agregado do profissional) só é usado nesse caso de fallback.
Filtros (4 numa linha só): Profissional · Especialidade · Local de trabalho ·
Período do dia (Manhã até 12:00 / Tarde 12:00-18:00 / Noite a partir das 18:00 —
`faixaHorarioFiltro`). Os filtros de "Horário de/até" e "Tipo de Atendimento" foram
REMOVIDOS a pedido; com o Tipo saiu também o recorte por tipo na lista de
agendamentos abaixo.

Frontend (`Agendamentos.tsx`):
- `espDoVet(vetId)` / `passoDoVet(vetId)` — especialidade ativa do profissional na
  grade (chips clicáveis na coluna Especialidade) e o passo em minutos. O filtro
  global de especialidade tem precedência sobre a escolha por linha.
- `gerarSlots(ini, fim, passo)` — slots de `passo` em `passo`; só entra o horário em
  que o atendimento inteiro cabe (`m + passo <= fim`), igual ao backend.
- `ocupacoesDoVet(vetId)` devolve INTERVALOS (contexto ativo + ocupação global de
  todas as empresas); `slotsLivres` descarta o slot que cruza qualquer um deles.
- Profissional sem tempo configurado (`especialidadesCat` vazio) cai em
  `PASSO_PADRAO_MIN = 60` — a grade antiga, sem regressão para quem não configurar.

---

## 16. SHELL DA APLICAÇÃO E BUSCA GLOBAL

### Shell (App.tsx)
```
<div flex flex-col h-full overflow-hidden>   ← trava na viewport
  <AppHeader />                              ← flex-shrink-0, h-16 md:h-20
  <div flex flex-1 min-h-0>                  ← min-h-0 é o que deixa o <main> rolar
    <Sidebar />                              ← w-72 (fixed no mobile, static no desktop)
    <main flex-1 min-w-0 overflow-y-scroll>  ← ÚNICO elemento que rola
  </div>
  <AppFooter />                              ← flex-shrink-0, h-12
</div>
```
Rotas públicas (login, register, reset, aprovar-vínculo) NÃO têm shell — ficam fora do
`ProtectedRoute` e rolam livremente.

**Alinhamento do logo com o sidebar:** o bloco da marca no header tem `md:w-72`
(a MESMA largura do sidebar) + `md:justify-center`, e o padding lateral do `<header>`
existe só à DIREITA (`pr-4 md:pr-6`). Com `px` no header o bloco começaria deslocado e o
centro não coincidiria com o do menu. No mobile não há sidebar (é drawer): largura
natural, à esquerda, ao lado do gatilho do menu.

### Busca global — `GET /api/busca?q=termo&limit=5`
Duas regras que NÃO podem ser afrouxadas:

**1. Escopo é a EMPRESA DO CONTEXTO ATIVO — nunca "todos os vínculos do usuário".**
`buildAnimalScopeWhere` inclui, na base própria, vínculos de QUALQUER empresa (regra
base × convidado da seção 5). Para a busca isso seria vazamento entre tenants: o
resultado é intersectado com `req.empresaId`, e evoluções/agendamentos usam o escopo
clínico por empresa (`escopoEvolucaoWhere` / mesmo critério para `AgendamentoClinico`,
que tem `empresaId`/`veterinarioId` próprios).

**2. Permissão é POR GRUPO, resolvida em runtime.** A rota atravessa três módulos, então
não tem `checkPermission` de slug único (barraria quem só enxerga um deles). O contexto
vem de `resolverContextoPermissao` e cada bloco só entra no resultado se
`getNivelEfetivo` devolver ≥ LEITURA para o seu slug: `animais.ler`,
`atendimento.evolucoes.ler`, `atendimento.agendamentos.ler`. Sem nenhum dos três →
resultado vazio (não 403). **Grupo novo exige o seu próprio slug** — nunca herdar o gate.

A `rota` de cada resultado é montada no BACKEND (`/animal/:id`,
`/clinica/evolucao/:animalId`) para o front não replicar regra de rota.

---

## 13. MAPA DE ARQUIVOS — REFERÊNCIA RÁPIDA

> Leia esta seção antes de explorar o código. Evita reads desnecessários.

### Backend — Controllers

| Arquivo | Responsabilidade principal |
|---|---|
| `AnimalController.js` | CRUD animais, `ANIMAL_INCLUDE`, `criarSolicitacaoPendente`, todos os fluxos de vínculo (VINCULO/DESVINCULO/TROCA_VET), `proprietarioAprovar`, `responderSolicitacaoVet`, `minhasSolicitacoes`, `cancelarSolicitacao`, `vincularVet`, `desvincularVet`, `buscarPorNome` |
| `VeterinarioController.js` | Perfil vet, `solicitarVinculo` (P→V), `solicitarVinculoVet` (V→P), `listarSolicitacoes`, `responderSolicitacao`, `responderViaEmail`, `listarPendentes`, `meusAnimais` |
| `AuthController.js` | Login email/senha, registro, refresh token, logout |
| `GoogleController.js` | OAuth Google — troca `access_token` por JWT interno |
| `UserController.js` | CRUD usuários, `/me`, troca de senha |
| `DietaController.js` | CRUD dietas e itens de dieta por animal |
| `RelatorioNutricionalController.js` | Geração e persistência de relatórios nutricionais |
| `ExameController.js` | Exames nutricionais e clínicos |
| `EvolucaoController.js` | Prontuário clínico — INCLUDE_PADRAO (veterinario, modificadoPor, midias), `listarPorAnimal`, `obterPorId`, `criar`, `atualizar`, `excluir`, `aprovar`, `salvarTitulo`, `transcrever` (Whisper), `adicionarMidia`, `removerMidia`, `listarResponsaveis` |
| `PrescricaoController.js` | Prescrições médicas — `listarPorAnimal` (page/limit/tipo/status/busca), `criar` (gera `horariosGerados` via `gerarHorarios()`), `atualizar`, `excluir` (soft), `finalizarTodas` (RASCUNHO→ATIVA + cria FaturaItems em fatura ABERTA) |
| `PermissaoController.js` | CRUD de permissões por membro/módulo e por proprietário dentro de uma equipe |
| `PermissaoService.js` | `PERFIS_PADRAO` inclui PRESTADOR. `getPermissoesProprietarios` filtrado por `empresaId` da equipe (não global). |
| `ProprietarioController.js` | CRUD de proprietários (userType=PROPRIETARIO) com campos extras: cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas |
| `TratadorController.js` | CRUD de tratadores (model Tratador) — nome, telefone, localTrabalho |
| `LocalizacaoAnimalController.js` | CRUD global de localizações — `listar` (filtro por busca/ativo/especie), `listarTipos`, `criar` (ADMIN→SYSTEM, outros→CLIENTE), `atualizar` (ADMIN only), `toggleAtivo` (ADMIN only). Exporta `TIPO_ESPECIES` e `TIPOS_VALIDOS`. |
| `EquipeController.js` | Equipes, membros, convites. `getFornecedoresPorEquipe` — busca fornecedores da empresa da equipe (exclui já-membros). `listarMembrosPorEquipe` — valida isolamento por empresa. `convidarParaEquipe` — suporta cargo PRESTADOR (userType FORNECEDOR). `minhasPermissoes` PROPRIETARIO usa deny-wins para NEGADO. |
| `AlimentoController.js` | Banco de alimentos |
| `ComposicaoAlimentarController.js` | Composição nutricional por alimento/espécie |
| `NutrientesController.js` | Banco de nutrientes |
| `AnaliseController.js` | Análise nutricional via NRC |
| `BuscaGlobalController.js` | Busca global do header — pacientes, evoluções e agendamentos da EMPRESA ATIVA. Escopo intersectado com `req.empresaId`; permissão POR GRUPO via `getNivelEfetivo`; devolve a `rota` de destino pronta. Ver seção 16 |
| `emailService.js` | Todos os templates de email (ver lista abaixo) |

### Backend — Funções e Constantes Críticas

```javascript
// permissao.middleware.js
getEquipeIdsDoProprietario(userId)  // exportado — usado também em minhasPermissoes
// Equipes vinculadas ao proprietário via seus animais:
// Animal.equipeId quando presente (segregação por equipe);
// animal legado sem equipeId → todas as equipes do Animal.empresaId (fallback)

getNivelPermissaoProprietario(userId, moduloSlug)
// Resolve o nível efetivo de um PROPRIETARIO para um módulo:
// 1. equipeIds = getEquipeIdsDoProprietario(userId)
// 2. Lê MatrizPerfil[perfilSlug='PROPRIETARIO', moduloSlug] dessas equipes
// 3. Se qualquer equipe tem NEGADO → retorna 'NEGADO' (deny-wins)
// 4. Caso contrário → retorna o nível máximo positivo entre as equipes
// 5. Se sem animais ou sem equipes → retorna 'NENHUM'

// EquipeController.js
getFornecedoresPorEquipe(req, res)
// GET /equipes/:equipeId/fornecedores
// Requer: equipe pertence à empresa do gestor requisitante
// Retorna: usuários com userType='FORNECEDOR' da empresa, excluindo já-membros da equipe

// AnimalController.js
ANIMAL_INCLUDE          // Include Prisma padrão para todas as queries de animal
                        // inclui: especie, raca, user, solicitacoes(PENDENTE + VINCULO ACEITO)
                        // solicitacoes.select: id, tipo, status, vetUserId, novoVetUserId,
                        //   solicitanteId, veterinario{id,fullName,email}, novoVeterinario{id,fullName}

criarSolicitacaoPendente({ animalId, novoVetId, animalNome, solicitanteId,
                           proprietarioNome, proprietarioEmail, proprietarioPhone })
// Lógica de roteamento:
//   sem vet ativo → VINCULO PENDENTE
//   com vet ACEITO → TROCA_VET PENDENTE (email ao vet atual)
//   solicitanteId === novoVetId → vet iniciou → email ao PROPRIETÁRIO
//   caso contrário → email ao VET

// VetAnimalSolicitacao: unique constraint (animalId, vetUserId)
// Um registro por par animal-vet, sempre reutilizado (upsert)
// solicitanteId === vetUserId → solicitação iniciada pelo VET (proprietário deve responder)
// solicitanteId !== vetUserId → solicitação iniciada pelo PROPRIETÁRIO (vet deve responder)
```

### Backend — Templates de Email (`emailService.js`)

| Função | Destinatário | Quando |
|---|---|---|
| `enviarSolicitacaoVinculo` | Vet | Proprietário solicita vínculo |
| `enviarSolicitacaoVinculoProprietario` | Proprietário | Vet solicita vínculo (link `/proprietario/aprovar-vinculo`) |
| `enviarConfirmacaoVinculo` | Vet ou Proprietário | V→P: vet recebe confirmação quando proprietário decide. P→V: proprietário recebe notificação quando vet recusa. Destinatário varia por call site. |
| `enviarSolicitacaoDesvinculo` | Vet | Proprietário inicia desvinculo |
| `enviarSolicitacaoTrocaVet` | Vet atual | Proprietário inicia troca de vet |

### Backend — Rotas completas

```
# animais.js — prefixo /api/animais
GET    /buscar-por-nome?nome=X          → AnimalController.buscarPorNome (vet)
GET    /minhas-solicitacoes             → AnimalController.minhasSolicitacoes (proprietário, polling)
PATCH  /solicitacoes/:id/responder      → AnimalController.responderSolicitacaoVet (proprietário responde V→P)
POST   /proprietario/aprovar            → AnimalController.proprietarioAprovar (email token, público)
POST   /vincular-vet                    → AnimalController.vincularVet (vínculo direto ACEITO)
GET    /                                → AnimalController.listar
POST   /                                → AnimalController.criar
GET    /:id                             → AnimalController.obterPorId
PUT    /:id                             → AnimalController.atualizar
DELETE /:id                             → AnimalController.excluir
DELETE /:id/desvincular-vet             → AnimalController.desvincularVet
DELETE /:id/cancelar-solicitacao        → AnimalController.cancelarSolicitacao

# veterinarios.js — prefixo /api/veterinarios
GET    /solicitacoes/responder-email    → VeterinarioController.responderViaEmail (público, token)
GET    /proprietarios                   → VeterinarioController.listarProprietarios
GET    /                                → VeterinarioController.listar
GET    /perfil                          → VeterinarioController.obterPerfil
PUT    /perfil                          → VeterinarioController.atualizarPerfil
GET    /meus-animais                    → VeterinarioController.meusAnimais
GET    /solicitacoes/pendentes          → VeterinarioController.listarPendentes
GET    /solicitacoes                    → VeterinarioController.listarSolicitacoes
POST   /solicitacoes                    → VeterinarioController.solicitarVinculo (P→V, legacy)
PATCH  /solicitacoes/:id                → VeterinarioController.responderSolicitacao (vet responde)
POST   /solicitar-vinculo               → VeterinarioController.solicitarVinculoVet (V→P)

# clinica/evolucoes — prefixo /api/clinica/evolucoes
POST   /interpretar                     → LLM extrai ações clínicas + título (body: {texto})
POST   /transcrever                     → Whisper: transcreve áudio (multipart: audio)
GET    /responsaveis/:animalId          → lista vets que atenderam o animal
GET    /animal/:animalId                → lista evoluções (page/limit/status/dataInicio/dataFim/responsavelId/busca)
GET    /:id                             → obter por ID
POST   /                                → criar evolução (409 EVOLUCAO_EM_ANDAMENTO se já há uma aberta;
                                          reenviar com `confirmarConcorrente: true` cria em paralelo)
PUT    /:id                             → atualizar
DELETE /:id                             → soft delete
PATCH  /:id/aprovar                     → aprovar evolução
PATCH  /:id/assumir                     → assumir evolução EM_ANDAMENTO de outro profissional
                                          (e-mail + WhatsApp ao anterior) — atendimento.evolucoes.editar
PATCH  /:id/titulo                      → salvar título
POST   /:id/midias                      → upload de mídia (multipart: midia, máx 100MB, image|video|audio)
DELETE /:id/midias/:midiaId             → remover mídia

# clinica/prescricoes — prefixo /api/clinica/prescricoes
# Quem FORNECE e quem APLICA são do ITEM, nunca do documento (migration
# `20260812000001`). `Prescricao.medicamentoCliente` (fornecido pelo cliente → sem baixa de
# estoque) e `Prescricao.aplicadaPeloProprietario` (aplicado em casa → fora do plantão)
# são irmãos e viajam no payload de CADA item — em `POST /grupos`
# (criação), `POST /grupos/:id/itens` e `PUT /grupos/:id/itens/:itemId` (edição). A mesma
# prescrição mistura o injetável que a clínica aplica na baia com a pomada que o tratador
# passa em casa; com a marca no GRUPO (como era até 2026-08-01) o vet tinha de escolher entre
# dois documentos e cobrar o que ninguém da clínica aplica.
# `aplicadaPeloProprietario` é lida/gravada por SQL CRU (`anexarAplicadaProprietario` /
# `anexarFlagEmGrupos` / `gravarAplicadaProprietario`) — o client Prisma pode não conhecer a
# coluna (no Windows o `generate` falha com o backend rodando). TODA leitura que decida
# EXECUÇÃO, FATURA ou ESTOQUE precisa passar pelo helper: sem a flag, o item aplicado em casa
# volta a ser cobrado e a debitar estoque. Já aplicado em `finalizar` (fatura + reservas),
# `executar` (inclusive contra POST com `itemIds`), `listarParaExecucao` (filtra ITENS; grupo
# que ficou sem nenhum some da tela) e nos 6 helpers de estoque.
# ⚠️ O item aplicado pelo proprietário também sai da conta do "tudo executado" em `executar` —
# senão o documento ficaria eternamente FINALIZADO, preso na tela de execução.
#
# MATRIZ "quem FORNECE × quem APLICA" (2026-08-01) — é ela que decide execução e fatura.
# Vale para MEDICAMENTO:
#   fornecido p/ Cliente | aplicado p/ Proprietário | Execução de Prescrição | Fatura
#           não         |           não            |         ENTRA          | na EXECUÇÃO
#           SIM         |           não            |         ENTRA          | nunca
#           não         |           SIM            |        não vai         | na FINALIZAÇÃO
#           SIM         |           SIM            |        não vai         | nunca
# PROCEDIMENTO marcado "Será executado pelo Proprietário" NÃO vai à execução e **NUNCA
# é cobrado** — não existe a linha "na FINALIZAÇÃO" para ele. Procedimento é SERVIÇO,
# não bem entregue: se quem executa é o proprietário, a clínica não faz nada e não há o
# que faturar; o medicamento é diferente porque a clínica ainda entrega o frasco mesmo
# sem aplicar. Por isso `itensParaFaturarAgora` (em `finalizar`) filtra por
# `i.tipo === 'MEDICAMENTO'` — critério POSITIVO ("só o que a clínica entrega pode ser
# cobrado sem execução"), e não "não é procedimento". Espelho no front: `destinoDoItem()`
# recebe `isMed` e escreve "não é cobrado" nesse caso.
# ⚠️ MUDANÇA DE PREMISSA: até 2026-08-01 a finalização lançava TODO item cobrável na
# fatura (medicamento zerado, valor preenchido na 1ª execução). Agora `finalizar` só
# lança o item que a clínica FORNECE e o proprietário APLICA — ele nunca chega ao
# plantão, então aquela é a única chance de cobrá-lo. Todo o resto vira linha de fatura
# em `executar`, quando o serviço acontece. `finalizar` também não abre mais fatura
# quando não há nada a cobrar agora (evitava fatura vazia todo mês).
# Prescrição finalizada ANTES da mudança tem a linha zerada da finalização: `executar`
# a reaproveita na 1ª execução (não duplica) — não remover esse caminho.
# ⚠️ LACUNA CONHECIDA: MEDICAMENTO fornecido pela clínica e aplicado pelo proprietário
# entra na fatura com valor 0, porque o preço nasce do LOTE debitado e esse item nunca é
# executado (logo, não há lote nem baixa de estoque). Saídas hoje: orçar o item antes
# (`valorOrcado` tem precedência) ou ajustar o valor na fatura. Debitar estoque na
# finalização para esse caso é decisão em aberto — não foi pedida.
# Front: `destinoDoItem()` (SubModuloPrescricao) é o espelho da matriz e escreve a
# consequência em uma linha só sob os dois checkboxes — dicas separadas por checkbox se
# contradiziam ("fora da fatura" quando o item É cobrado ao salvar).
POST   /finalizar/:animalId             → finaliza rascunhos → ATIVA + cria FaturaItems
GET    /animal/:animalId                → lista prescrições (page/limit/tipo/status/busca)
POST   /                                → criar prescrição (status RASCUNHO, gera horariosGerados se horaInicio)
PUT    /:id                             → atualizar
DELETE /:id                             → soft delete

# clinica/exames — prefixo /api/clinica/exames (ExameClinicoController)
# Tipos: Laboratorial | Bioquímico | Imagem | Compra
# (ExameNutricional usa /api/exames — modelo e controller distintos)
GET    /animal/:animalId                → listarPorAnimal (page/limit) — atendimento.exames.ler LEITURA
GET    /:id                             → obterPorId — atendimento.exames.ler LEITURA
POST   /                                → criar (body: animalId, tipo, descricao, evolucaoId?) — atendimento.exames.criar PROPRIO
PUT    /:id                             → atualizar — atendimento.exames.editar PROPRIO
PATCH  /:id/finalizar                   → status→CONCLUIDO, regra de autoria — atendimento.exames.finalizar PROPRIO
DELETE /:id                             → soft delete — atendimento.exames.deletar PROPRIO

# Cadastro — Proprietários e Tratadores
GET/POST    /api/cadastro/proprietarios     → ProprietarioController (CRUD userType=PROPRIETARIO)
GET/PUT     /api/cadastro/proprietarios/:id
PATCH       /api/cadastro/proprietarios/:id/toggle
DELETE      /api/cadastro/proprietarios/:id

GET/POST    /api/cadastro/tratadores        → TratadorController (CRUD tb_tratadores)
GET/PUT     /api/cadastro/tratadores/:id
PATCH       /api/cadastro/tratadores/:id/toggle
DELETE      /api/cadastro/tratadores/:id

GET         /api/cadastro/localizacoes/tipos → LocalizacaoAnimalController.listarTipos (tipos + espécies mapeadas)
GET/POST    /api/cadastro/localizacoes        → LocalizacaoAnimalController (tabela global tb_localizacoes_animal)
GET/PUT     /api/cadastro/localizacoes/:id    → obterPorId / atualizar (ADMIN only)
PATCH       /api/cadastro/localizacoes/:id/toggle → toggleAtivo (ADMIN only, somente inativar)

# clinica/encaminhamentos — prefixo /api/clinica/encaminhamentos (EncaminhamentoController)
GET    /prestadores/:animalId           → prestadores (cargo PRESTADOR) das equipes do animal,
                                          com tipoServico (via Fornecedor.userId) + flag jaDesignado
GET    /animal/:animalId                → lista encaminhamentos (?status=)
POST   /                                → criar (prestadorId presente → upsert DesignacaoPrestador na transação)
PATCH  /:id/finalizar                   → CONCLUIDO com regra de autoria (atendimento.encaminhamentos.finalizar PROPRIO)
PATCH  /:id/status                      → PENDENTE|CONCLUIDO|CANCELADO sem regra de autoria (atendimento.encaminhamentos.editar PROPRIO)
PUT    /:id                             → editar campos textuais (só PENDENTE)
DELETE /:id                             → soft delete + inativa designação vinculada

# clinica — histórico e agendamentos (routes/agenda.js, montado em /api/clinica)
GET    /clinica/historico/animal/:animalId    → HistoricoController — timeline unificada (evoluções,
                                                vacinas, exames, prescrições-grupos, encaminhamentos)
GET    /clinica/agendamentos/animal/:animalId → AgendamentoController.listarPorAnimal (?futuros=1)
POST   /clinica/agendamentos                  → criar (ADMIN/VET/EST; body: animalId, tipo, titulo, dataHora)
PATCH  /clinica/agendamentos/:id/status       → AGENDADO|CONCLUIDO|CANCELADO
DELETE /clinica/agendamentos/:id              → soft delete

# busca.js — prefixo /api/busca (BuscaGlobalController)
GET    /?q=termo&limit=5                → busca global do header: { dados: { pacientes[],
                                          atendimentos[], agendamentos[] }, total }.
                                          Mínimo 2 caracteres; SEM checkPermission de slug
                                          único (gate por grupo no controller). Ver seção 16

# Outros prefixos relevantes
/api/auth          → AuthController (login, refresh, logout)
/api/users         → UserController (/me, CRUD)
/api/dietas        → DietaController
/api/exames        → ExameController
/api/equipes       → EquipeController
/api/relatorio     → RelatorioNutricionalController
/api/alimentos     → AlimentoController
/api/nutrientes    → NutrientesController
/api/composicoes-alimentares → ComposicaoAlimentarController
/api/clinica/faturas → FaturaController
GET  /api/equipes/:equipeId/fornecedores → EquipeController.getFornecedoresPorEquipe (busca FORNECEDOR da empresa, exclui já-membros)
GET    /api/equipes/:equipeId/prestadores/:userId/designacoes      → designações + animaisDisponiveis
                                          (animal traz `localizacao`/`local` — filtro por local da tela)
POST   /api/equipes/:equipeId/prestadores/:userId/designacoes      → concede acesso a 1 animal
POST   /api/equipes/:equipeId/prestadores/:userId/designacoes/lote → { animalIds[], motivo? } concede em
                                          LOTE numa transaction (botão "Inserir todos"); ids fora da
                                          equipe/empresa são descartados antes do upsert
DELETE /api/equipes/:equipeId/prestadores/:userId/designacoes/:animalId → inativa a designação
DELETE /api/equipes/:equipeId/prestadores/:userId/designacoes      → SEM :animalId, revoga TODO o
                                          acesso vigente do prestador (botão "Remover todos");
                                          soft delete (ativo=false + dataFim), devolve { removidos }
GET  /api/equipes/configuracoes → EquipeController.obterConfiguracao (logo + diaFechamentoFatura do escopo ativo)
PUT  /api/equipes/configuracoes → EquipeController.salvarConfiguracao (multipart: logo?, diaFechamentoFatura, removerLogo?) — GESTOR/dono only

# documentos.js — prefixo /api/documentos (Central de Documentos)
# Duas famílias de permissão, separadas de propósito: `documentos.templates.*` (o
# MODELO) e `documentos.emitidos.*` (o DOCUMENTO entregue). Quem emite atestado no
# campo não precisa poder reescrever o modelo da clínica.
POST   /whatsapp | /email | /pdf         → DocumentoCompartilharController (só authenticate:
                                           quem chama já teve acesso ao dado na tela de origem)
POST   /chat                             → chat da IA, ancorado no ACERVO (templates.criar)
GET    /contexto/:animalId               → variáveis do paciente JÁ RESOLVIDAS + marca
                                           (logo, assinatura, CRMV). templates.ler + o
                                           acesso ao ANIMAL por verificarAcessoAnimal
GET    /emitidos?animalId=               → emitidos.ler
POST   /emitidos                         → emite (resolve as variáveis AQUI e grava o
                                           snapshot). emitidos.criar
GET    /emitidos/:id                     → emitidos.ler
DELETE /emitidos/:id  { motivo }         → cancela (soft delete + auditoria). emitidos.criar
POST   /templates/converter              → páginas do documento ENVIADO → blocos com
                                           `{{variáveis}}` e `[[lacunas]]` (IA multimodal).
                                           NÃO grava: devolve a proposta. templates.criar
GET    /templates                        → globais + os da empresa. templates.ler
POST   /templates                        → templates.criar
GET    /templates/:id                    → templates.ler
PUT    /templates/:id                    → salva; em modelo GLOBAL devolve a CÓPIA da
                                           empresa (`copiado: true`). templates.editar
POST   /templates/:id/duplicar           → templates.criar
PATCH  /templates/:id/favorito           → também passa pelo copy-on-write. templates.editar
PATCH  /templates/:id/restaurar          → templates.editar
DELETE /templates/:id  { motivo }        → lixeira. templates.deletar

# orcamentos.js — prefixo /api/orcamentos (OrcamentoController)
GET    /para-importar?animalId=&tipos=   → itens ACEITO p/ importar na Prescrição/Vacina (OUTROS nunca entra)
POST   /importar                         → marca itens como importados (após SALVAR a prescrição/vacina)
GET    /outros-para-fatura?proprietarioId= → itens OUTROS ACEITO pendentes, por orçamento, com
                                           `pendentesClinicos` (AVISO — não bloqueia o lançamento)
POST   /lancar-na-fatura                 → { faturaId, itemIds } cria FaturaItem tipo OUTROS + marca
                                           importadoEm + recalcularTotal. Permissão financeiro.faturas.lancar
```

### Backend — Middlewares

| Arquivo | Uso |
|---|---|
| `auth.js` | `authenticate` — valida JWT, injeta `req.user` |
| `tenant.js` | `injectTenant` — injeta `empresaId` no contexto (usado em animais e evolução) |
| `validate.js` | Roda express-validator, retorna 422 em erros |
| `permissao.middleware.js` | ⚠️ Além do abaixo, exporta `resolverContextoPermissao(req)` — resolve `req.equipeId`/`req.membroCargo` na mesma ordem do `checkPermission` mas SEM 403. Para rotas multi-módulo que não podem ser gateadas por um slug único (busca global). RBAC por userType. `checkPermission(moduloSlug, nivelMinimo)` — verifica permissão real para todos os roles. ADMIN: bypass. GESTOR: bypass. PROPRIETARIO: chama `getNivelPermissaoProprietario()` — lê MatrizPerfil[perfilSlug='PROPRIETARIO'] das equipes vinculadas via Animal.empresaId; aplica deny-wins se NEGADO. `NIVEL_ORDINAL` inclui `NEGADO: -1`. |
| `requestId.js` | Injeta `x-request-id` em toda requisição |

### Frontend — Páginas

| Arquivo | Rota / Propósito |
|---|---|
| `Home.tsx` | `/` — página institucional PÚBLICA (só para quem não está logado; `RootGate` em `App.tsx` decide). Composta por `components/home/*` |
| `Login.tsx` | `/login` — autenticação email/senha + Google |
| `Register.tsx` | `/register` — cadastro de usuário |
| `CadastroPessoal.tsx` | `/cadastro-pessoal` — onboarding pós-registro |
| `AlterarSenhaObrigatoria.tsx` | `/alterar-senha` — bloqueio `mustChangePassword` |
| `Dashboard.tsx` | `/` — dashboard principal (PROPRIETARIO/ESTAGIARIO) |
| `VetDashboard.tsx` | `/vet-dashboard` — dashboard VETERINARIO com SolicitacaoCard |
| `ClinicaDashboard.tsx` | `/clinica-dashboard` — dashboard clínica |
| `MeusAnimais.tsx` | `/meus-animais` — lista animais do PROPRIETARIO + botões Autorizar/Recusar (V→P) |
| `AnimaisVet.tsx` | `/vet-animais` — lista pacientes do VET + "Buscar Paciente" modal + SolicitacaoCard |
| `Animal.tsx` | `/animais` — formulário criar/editar animal |
| `AnimalDetail.tsx` | `/animal/:id` — tela do animal: header compacto (foto + nome/espécie/raça/idade/peso/baia/local/tipo de trabalho/proprietário/vet), painel **Histórico** unificado (GET /clinica/historico/animal/:id, busca client-side, itens expansíveis com badge por origem) e painel **Agendamentos** (futuros; ADMIN/VET/EST criam via modal, concluem e excluem). Substituiu a antiga grade de botões de módulos |
| `AnimalView.tsx` | visualização detalhada do animal |
| `Dieta.tsx` | `/dieta` — visualização da dieta do animal selecionado. Controle de acesso completo: guard de página (`nutricao.dietas.ler`), gating de useEffects em `loadingPerms`, guards nos 6 handlers de escrita, UI condicional por `podeCriar`/`podeEditar`. Loaders verificam `if (!res.data) return` (GET 403 → null). |
| `CriaDieta.tsx` | `/cria-dieta` — formulário de criação/edição de dieta |
| `RelatorioNutricional.tsx` | `/relatorio` — relatório nutricional do animal selecionado |
| `Exames.tsx` | `/exames`, `/exames/:animalId` — **Exames Nutricionais** (modelo `ExameNutricional`, backend `/api/exames`). Guard de página e botões usam `atendimento.exames.*` (corrigido — era `exames.laboratorial.*`, mismatch com o backend). |
| `CriaExameNutricional.tsx` | `/exames/:animalId/novo` — criação de exame nutricional via upload de laudo (LLM) ou manual. Guard de página + handlers protegidos com `atendimento.exames.criar`. |
| `Atendimento.tsx` | `/atendimento` — shell clínico com abas: evolucao, prescricao, vacina, exames, encaminhamento. Delega a SubModulo* |
| `SubModuloEvolucao.tsx` | Prontuário clínico — speech recognition (Web Speech API) + Whisper offline, anexo de mídias, impressão via `EvolucaoPrint` |
| `SubModuloPrescricao.tsx` | Prescrições — speech recognition + Whisper offline, fluxo RASCUNHO→ATIVA via `finalizarTodas` |
| `SubModuloVacina.tsx` | Registro de vacinas do animal |
| `SubModuloExames.tsx` | Exames clínicos do animal |
| `SubModuloEncaminhamento.tsx` | Encaminhamentos — props `{ animalId }`. Destino EQUIPE (lista prestadores via GET /clinica/encaminhamentos/prestadores/:animalId, filtro por tipoServico, badge "já tem acesso") ou EXTERNO (texto livre). Criar com prestador → designação automática + toast de acesso liberado. Concluir/Cancelar/Excluir encerram o acesso do prestador |
| `AprovarVinculo.tsx` | `/aprovar-vinculo` — vet aprova vínculo via link de email (público) |
| `AprovarVinculoProprietario.tsx` | `/proprietario/aprovar-vinculo` — proprietário aprova via email (público) |
| `CadastroProprietario.tsx` | `/cadastro/proprietarios` — CRUD de proprietários com CPF/CNPJ, mensalista, frequência de visitas |
| `CadastroTratador.tsx` | `/cadastro/tratadores` — CRUD de tratadores (nome, telefone, local de trabalho) |
| `CadastroLocalizacao.tsx` | `/cadastro/localizacoes` — CRUD global de localizações. ADMIN: cria SYSTEM, edita e inativa tudo. Não-ADMIN: cria CLIENTE (read-only após). Badge SYSTEM/CLIENTE. Filtro por espécie via `TIPO_ESPECIES`. Busca CEP via ViaCEP. |
| `ControleAcesso.tsx` | `/controle-acesso` — gerenciamento de permissões. Abas para ADMIN: TabPermissoesGlobais (UserTypes VET/EST/PROP). Abas para GESTOR (5): Matriz de Perfis (TabMatriz, locked items imutáveis), Equipe (TabEquipe, modal 2 passos), Proprietários (TabProprietarios), Convites (TabConvites), Logs de Auditoria. Nível NEGADO como 3º estado no PermCheck (ciclo: NENHUM→EQUIPE→NEGADO→NENHUM). |
| `Equipe.tsx` | `/equipe` — gestão de equipe do vet |
| `EquipeManager.tsx` | `/equipe-manager` — admin de equipes |
| `Configuracoes.tsx` | `/configuracoes` — GESTOR only. Logotipo (upload, base em `Animal.tsx`) + dia de fechamento de fatura (1-31). Única por empresa (CNPJ) ou equipe (empresa pessoal). Link no Sidebar dentro de Geral (`isGestor &&`). |
| `Alimentos.tsx` | `/alimentos` — banco de alimentos |
| `ComposicaoAlimentar.tsx` | `/composicao` — composição nutricional |
| `Nutrientes.tsx` | `/nutrientes` — banco de nutrientes |
| `Analise.tsx` | `/analise` — análise NRC |
| `Auditoria.tsx` | `/auditoria` — log de acesso legado (LOGIN/LOGOUT via AuthContext) |
| `AuditoriaGeral.tsx` | `/auditoria-geral` — Auditoria (Sidebar > Geral, GESTOR/ADMIN). Exclusões/cancelamentos com justificativa: GET /api/audit/logs, filtros por categoria/entidade/busca/período, tabela desktop + cards mobile, paginação |
| `Documentos.tsx` | `/documentos` — Central de Documentos, EMISSÃO (a tela do dia a dia). Layout de `/agendamentos`: uma linha com **Paciente · Nome do Documento · Tipo**, os campos a preencher em largura cheia com **Cancelar/Inserir/Salvar**, e o Histórico de Documentos do paciente. O seletor de documento lista o ACERVO INTEIRO (agrupado por `<optgroup>`) e é ele que preenche o Tipo, que é campo de leitura. Cria documento/categoria (`documentos.templates.criar`) e leva ao editor por `/documentos/modelos?templateId=`. Aceita `?animalId=`. Ver a sessão 2026-08-30 na §12 |
| `CentralDocumentos.tsx` | `/documentos/modelos` — EDITOR de modelos por blocos (biblioteca · modelos · editor+preview), o chat da IA e o copy-on-write dos 12 anexos do CFMV. Era a rota `/documentos` até 2026-08-30; montar modelo é configuração feita uma vez, então saiu da frente do fluxo de emitir |
| `Usuarios.tsx` | `/usuarios` — gestão de usuários (admin) |
| `AiUsageDashboard.tsx` | `/ai-usage` — monitoramento de uso de IA |

### Frontend — Componentes Globais

| Arquivo | Propósito |
|---|---|
| `PageContainer.tsx` | Wrapper obrigatório de toda página interna. Props: `maxWidth` (`7xl`\|`5xl`\|`3xl`), `noPadding` |
| `AppHeader.tsx` | Header global do shell: marca do produto (alinhada ao eixo do sidebar via `md:w-72`), `BuscaGlobal`, sino de notificações (`useVetPendentes`) e menu do usuário — nome, e-mail, selo de perfil, Cadastro Pessoal, Configurações (gestor) e **Sair**. Abriga o gatilho do menu no mobile. Ver seção 16 |
| `AppFooter.tsx` | Rodapé global: logomarca + nome da clínica assinante (`EmpresaContext.marca`) à esquerda, marca do produto à direita |
| `BrandS2Vet.tsx` | Marca do PRODUTO (`/uploads/empresas/s2vet-logo.png`). Só a arte — o PNG já traz nome e tagline, por isso header e rodapé não escrevem "S2Vet" ao lado. Ver armadilha 40 |
| `BuscaGlobal.tsx` | Campo de busca do header: debounce 350ms, mínimo 2 caracteres, resultado agrupado (Pacientes/Atendimentos/Agenda), navegação por setas/Enter/Esc, clique-fora. Navega pela `rota` que o backend devolve |
| `Sidebar.tsx` | Navegação lateral. Chama `useProprietarioNotificacoes` e `useVetSolicitacaoMonitor`. Topo = card da empresa com SÓ o logo (centralizado); NÃO tem mais rodapé de usuário (foi para o `AppHeader`) |
| `AnimalCard.tsx` | Card de resumo do animal. Resolve vet via `solicitacaoAceita ?? veterinarioNome`. Exibe badge PENDENTE |
| `VetNotificationModal.tsx` | Modal bloqueante para vets: mostra solicitações recebidas (não as que o vet iniciou). Tracking via localStorage |
| `ProtectedRoute.tsx` | Guarda de rota por `userType` |
| `SeletorAnimal.tsx` | Dropdown de seleção de animal (alimenta SelectedAnimalContext) |
| `PageContainer.tsx` | Wrapper com padding e maxWidth padronizados |
| `DietaAcoesBar.tsx` | Barra de ações da dieta. Props: `podeImprimir?`, `podeCompartilhar?`, `podeExportar?` (default true). Botões ocultam em modo compacto ou exibem toast quando sem permissão. |
| `CardSegurancaAdmin.tsx` | Seletor GLOBAL de 2FA (só ADMIN), na tela Configuração (`/configuracao-alertas`). Salva sozinho — não é config de empresa. Ver seção 14. |
| `Verificacao2FA.tsx` | Segundo passo do login: código de 6 dígitos enviado ao e-mail. Auto-submete ao completar, reenvio com espera. A sessão nasce só quando ele recebe 200. Ver seção 14. |
| `ConsumoPorClienteIA.tsx` | Metering de IA por empresa em /ai-usage (ADMIN): consumo, % do limite e edição do plano. Ver seção 7. |
| `MemoriaClinicaPanel.tsx` | Memória Clínica do Paciente (IA) em AnimalDetail. Highlights clicáveis no topo (realçam e rolam até os tópicos que os comprovam) + resumo por tópicos; tópico abre o registro de origem via `onAbrirRef`. Ver seção 7. |
| `relatorios/AnaliseFinanceiraIA.tsx` | IA Financeira em Relatórios > Financeiro. Highlights + análise textual do período; chamada SOB DEMANDA (botão), nunca no load. |
| `FotoEditorModal.tsx` | Editor da foto do Cadastro Pessoal: ZOOM (slider) + ARRASTAR (pointer events — mouse e toque no mesmo código), devolvendo o arquivo já RECORTADO (512px). Sem biblioteca externa: preview e canvas usam a MESMA conta, só multiplicada por `SAIDA/lado`. ⚠️ O lado do quadro é MEDIDO (`ResizeObserver`), não constante — em tela estreita o quadro encolhe, e com valor fixo o canvas geraria um recorte diferente do que a pessoa enquadrou. |
| `AcaoRegistro.tsx` | **Ação de um registro (Alterar/Ver/Imprimir/WhatsApp/E-mail/Executar/Cancelar…) — FONTE ÚNICA da forma.** Uma declaração, duas apresentações decididas por CSS: ícone pintado no desktop (≥md), botão com rótulo no mobile. Props: `rotulo` (obrigatório — vira o texto da pílula e o `aria-label` do ícone), `icone` (o COMPONENTE lucide, não o elemento), `tom` (escolhe a cor pela §6), `visivel` (false = não renderiza), `desabilitado`, `carregando`, `titulo`. Exporta também `AcoesRegistro`, o contêiner que envolve a lista — `flex-wrap md:flex-nowrap`: quebra no mobile (pílulas com rótulo), TUDO NA MESMA LINHA no desktop. Ver a regra completa, e por que a quebra no desktop empilhava as ações da tabela, na §6. |
| `modules/documentos/Emitidos.tsx` | **FONTE ÚNICA do documento JÁ EMITIDO**: `ListaDocumentosEmitidos` (cards mobile / tabela desktop; prop `compacto` para coluna estreita), `VisualizarDocumentoModal` (folha A4 pelo MESMO `BlocoView` do editor) e `AcoesDocumento` (Visualizar · Imprimir · WhatsApp · E-mail · Cancelar). Usado pelo histórico de `/documentos` E pelo card "Documentos" de `/animal/:id` — duas listas divergiriam (28-g). Exporta `useImagensDocumento`, que converte logo/assinatura em `data:` URI (sem isso o PDF do backend nasce sem imagem) |
| `modules/documentos/cabecalho.ts` | **A REGRA do cabeçalho padrão da folha** (logo → título → Veterinário → Proprietário → Paciente): quais campos entram, em que ordem, o que some vazio, e a ABSORÇÃO do primeiro bloco `titulo`. `prepararFolha` devolve `{ cabecalho, corpo }` — todo renderizador consome `corpo`, nunca `blocos` cru. Consumida pelos DOIS desenhos: `CabecalhoFolha.tsx` e `utils/DocumentoPrint.ts` |
| `modules/documentos/CabecalhoFolha.tsx` | O cabeçalho padrão desenhado em JSX (preview A4, emissão, mobile, visualização do emitido). Estilo INLINE: o PDF do editor é html2canvas fotografando este DOM |
| `modules/documentos/CamposForm.tsx` | `CampoInput` + `tipoDoCampo` + `AJUDA_ORIGEM` — FONTE ÚNICA do campo a preencher de um documento, usada pela tela de emissão e pelo `ModalPreencher` do editor |
| `modules/documentos/upload.ts` | Documento ENVIADO pela clínica → blocos do modelo. **O que sobe é sempre IMAGEM**: PDF é convertido no navegador (`pdfjs-dist`, `import()` dinâmico), uma imagem por página. É o que faz o documento enviado seguir as MESMAS regras dos outros — sem desvio no preview, na impressão, no PDF do Puppeteer nem no snapshot. Ver a sessão 2026-08-30 na §12 |
| `utils/DocumentoPrint.ts` | HTML do documento EMITIDO para impressão e PDF (`gerarHtmlDocumento`/`imprimirDocumento`/`nomeArquivoDocumento`). Espelho em STRING de `BlocoView.tsx` — mexeu no visual de um bloco, mexa nos dois. Não resolve variável: os blocos do emitido já vêm resolvidos, e `{{`/`[[` que sobrar é apagado |
| `ModalJustificativa.tsx` | Modal padrão de exclusão/cancelamento com justificativa OBRIGATÓRIA (textarea ≥3 chars, header vermelho). Props: `aberto`, `titulo`, `descricao?`, `acaoLabel?`, `onConfirmar(motivo)`, `onFechar`. Usar em toda ação destrutiva — o motivo é exigido pelo backend e vai para a Auditoria. |
| `FormularioNovaSenha.tsx` | Formulário de definição de senha — fonte ÚNICA de aparência e regras (`REGRAS_SENHA`, checklist ao vivo, indicador de coincidência, `InlineError`). Usado por `AlterarSenhaObrigatoria` (sessão) e `ResetPassword` (token do e-mail). Só COLETA e valida — quem submete é a tela, com a credencial que tiver. Ver §14. |

### Frontend — Hooks e Contextos

| Arquivo | Propósito |
|---|---|
| `AuthContext.tsx` | `useAuth()` → `{ user, login, logout, loading }`. `user` tem `{ id, email, fullName, userType }` |
| `SelectedAnimalContext.tsx` | `useSelectedAnimal()` → `{ selectedAnimal, setSelectedAnimal, refreshSelectedAnimal }` |
| `EmpresaContext.tsx` | `useEmpresa()` → `{ opcoes, contextoAtivo, trocarContexto, loading, marca }`. **`marca` = `{ logoUrl, empresaNome }`** de `/equipes/logo` — FONTE ÚNICA da identidade visual da clínica, consumida por Sidebar e `AppFooter` (antes o fetch vivia na Sidebar; três consumidores dariam três requisições e estados divergentes). Recarrega no evento `s2vet:config-atualizada` e na troca de contexto. Busca `/equipes/empresas` (só VETERINARIO/ADMIN). Opções: empresa CNPJ = 1 por empresa (equipeId null); empresa pessoal/CPF = 1 por equipe. Persiste `s2vet_empresa_id`/`s2vet_equipe_id`; `trocarContexto` faz reload. Seletor no Sidebar quando `opcoes.length > 1` (label "Empresa ativa" ou "Equipe ativa") |
| `useProprietarioNotificacoes.ts` | Polling 15s em `/animais/minhas-solicitacoes`. Inicializa mapa apenas com PENDENTE/ACEITO — RECUSADO/CANCELADO excluídos para detecção retroativa via updatedAt <10min. Só para PROPRIETARIO |
| `useVetSolicitacaoMonitor.ts` | Polling 30s em `/veterinarios/solicitacoes`. Detecta novas solicitações PENDENTE e mudanças CANCELADO. Só para VETERINARIO |
| `useVetPendentes.ts` | Contagem de pendências do vet — badge de Pacientes (Sidebar) E sino (AppHeader). **STORE ÚNICO de módulo**: um só `setInterval` (30s) compartilhado por assinantes, encerrado quando o último sai. Um estado por componente daria polling dobrado e DOIS toasts para a mesma solicitação. Padrão obrigatório para hook de polling com mais de um consumidor |
| `useDraggableModals.ts` | Modais arrastáveis no desktop — delegação global de eventos (montado 1x no App.tsx). Alça: `.rounded-t-2xl`/`h2`/`h3`/`[data-drag-handle]`. Só mouse ≥768px; backdrop não move; suprime click pós-arraste |
| `services/api.ts` | Instância Axios configurada. Interceptor 401 → refresh automático. Interceptor 403 → GET resolve `{ data: null }` (silencioso); mutations rejeitam com `{ isPermissionError: true }` (sem log). Base URL: `/api` |
| `hooks/usePermissoes.ts` | `Nivel` inclui `'NEGADO'`. `NIVEL_ORDINAL` inclui `NEGADO: -1`. `podeExecutar` retorna false para NEGADO (ordinal -1 < qualquer mínimo). `loading` deve ser usado para gating de useEffects. |
| `services/whisperService.ts` | Transcrição: online → Web Speech API, offline → Whisper local. Funções: `isMobile()`, `estaOnline()`, `carregarModelo()`, `transcreverOffline()` |
| `utils/EvolucaoPrint.ts` | `imprimirEvolucao(evolucao)` — abre janela de impressão formatada para evolução clínica |
| `lib/concorrenciaRegistro.js` (backend) | **FONTE ÚNICA da concorrência de edição.** `reservarVersao` (trava otimista antes do update tipado), `gravarComVersao`, `assumirComLock` (assunção atômica), **`invalidarVersoes`** (bump em lote — é o que trava o profissional anterior no ARRASTO, inclusive o gestor), `definirAutor`, `anexarControle` (põe `versao`/`autorId` na leitura), `versaoDoBody`, `responderConflito` (409 legível). `TABELAS` cobre EVOLUCAO, AGENDAMENTO, PRESCRICAO_GRUPO e EXAME_CLINICO — ⚠️ a coluna do editor DIFERE por tabela (armadilha 41). SQL cru — funciona antes do `prisma generate`. Ver a §12, sessões de 2026-09-05 (partes 4 e 5) |
| `lib/eventosTempoReal.js` (backend) | Canal SSE por sessão: `abrirCanal` (registra a resposta + heartbeat com `unref`), `publicar` (fire-and-forget, SEMPRE fora da transaction), `estatisticas`, `encerrarTudo`. ⚠️ NÃO é fonte da verdade — só avisa; quem garante é a trava otimista |
| `routes/eventos.js` (backend) | `GET /api/eventos/stream` (SSE, autenticado por cookie; o cliente NUNCA diz para quem escutar) e `/status` (ADMIN). Isento do rate limit geral — ver §12 |
| `hooks/useEventosTempoReal.ts` | Assina o canal SSE. **STORE ÚNICO de módulo** (um `EventSource` por aba, não por componente). `aoEvento` vai num `ref`, não nas dependências: arrow inline reabriria a conexão a cada tecla digitada |
| `components/AvisoRegistroAssumido.tsx` | Aviso de registro perdido para outro profissional + **Atualizar** / **Descartar**. Renderizado FORA do `<fieldset disabled>` (os botões precisam funcionar com o formulário travado). Não fecha a tela e não apaga o texto digitado |
| `lib/fusoEmpresa.js` (backend) | **FONTE ÚNICA de fuso do servidor.** `fusoDaEmpresa(empresaId)` (cache 60s), `hojeNaEmpresa`/`diaNaEmpresa`/`formatarNaEmpresa`/`formatarHoraNaEmpresa` e `instanteNoFuso` (HH:MM da clínica → instante UTC). Sempre `Intl` com `timeZone` explícito — NUNCA `process.env.TZ` em runtime. Ver §6 |
| `utils/dateUtils.ts` | **FONTE ÚNICA de data/hora do front.** Duas famílias: DATA PURA (`formatDate`/`formatDateShort`, sem conversão de fuso) e INSTANTE (`formatHora`/`formatDiaMes`/`formatDiaMesHora`/`formatDataHora`/`formatHoraComDia`/`diaISO`/`hojeISO`/`mesmoDia`, no fuso de quem olha). `fusoDoUsuario()` é o ponto único de troca se o fuso passar a vir da empresa. Ver a regra completa na seção 6 |

### Frontend — Fluxo Vínculo V→P (Vet solicita, Proprietário aprova)

```
1. VET: AnimaisVet.tsx → "Buscar Paciente" → GET /animais/buscar-por-nome?nome=X
2. VET: modal → "Solicitar Vínculo" → POST /veterinarios/solicitar-vinculo {animalId}
   → cria VetAnimalSolicitacao {tipo:'VINCULO', status:'PENDENTE', solicitanteId=vetId}
   → email ao proprietário (enviarSolicitacaoVinculoProprietario)
3. PROPRIETÁRIO: MeusAnimais.tsx → animal aparece com badge verde "Aguardando sua aprovação"
   → botões "Autorizar" / "Recusar" → PATCH /animais/solicitacoes/:id/responder {status}
   → AnimalController.responderSolicitacaoVet
4. VET: recebe email de confirmação (enviarConfirmacaoVinculo)
   OU: AprovarVinculoProprietario.tsx (link do email) → POST /animais/proprietario/aprovar
IDENTIFICAÇÃO: sol.solicitanteId === sol.vetUserId → iniciado pelo VET
```

### Frontend — Fluxo Vínculo P→V (Proprietário solicita, Vet aprova) — NÃO MODIFICAR

```
1. PROPRIETÁRIO: Animal.tsx (editar) → seleciona vet → PUT /animais/:id
   → criarSolicitacaoPendente → email ao vet (enviarSolicitacaoVinculo)
2. VET: AnimaisVet.tsx → SolicitacaoCard (border-amber) → "Aceitar" / "Recusar"
   → PATCH /veterinarios/solicitacoes/:id {status}
   OU: link email → GET /veterinarios/solicitacoes/responder-email?token=X&acao=aceitar
3. PROPRIETÁRIO: recebe email de confirmação + toast via useProprietarioNotificacoes
IDENTIFICAÇÃO: sol.solicitanteId !== sol.vetUserId → iniciado pelo PROPRIETÁRIO
```

### Armadilhas conhecidas (evita re-leitura para descobrir)

```
1. Rotas literais ANTES de /:id no Express — sempre registrar /buscar-por-nome, /minhas-solicitacoes
   ANTES de /:id, senão Express interpreta o literal como valor do parâmetro.

2. prisma.membroEquipe (correto) — não usar prisma.equipeMembro (está errado em buscarPorNome,
   ignorar aquela instância). Modelo no schema: MembroEquipe → prisma.membroEquipe.

3. VetNotificationModal recebe solicitacoesRecebidas (não solicitacoes completo) — filtra
   as iniciadas pelo próprio vet para não mostrar modal das próprias solicitações.

4. SolicitacaoCard em AnimaisVet: solicitacoesRecebidas = sol onde solicitanteId !== vetId
   solicitacoesEnviadas = sol onde solicitanteId === vetId (aguardando proprietário)

5. ANIMAL_INCLUDE filtra solicitacoes: apenas PENDENTE + (VINCULO ACEITO). DESVINCULO ACEITO
   é excluído propositalmente (vet perdeu acesso, não deve aparecer no form de edição).

6. Template literals em PowerShell: usar [System.IO.File]::ReadAllText + .Replace() em vez
   de Edit tool quando o conteúdo tem backticks. Edit tool falha por encoding em arquivos TSX.

7. Prisma + Windows: após npm install, criar junction manualmente:
   New-Item -ItemType Junction -Path "backend\node_modules\@prisma\client\.prisma"
                               -Target "backend\node_modules\.prisma"

8. Evoluções clínicas — prefixo de rota é /api/clinica/evolucoes (NÃO /api/animais/:id/evolucoes).
   O filtro por animal é via query param/rota /animal/:animalId dentro do mesmo prefixo.

9. Prescricao.finalizarTodas — transita status RASCUNHO→ATIVA e cria FaturaItems na fatura ABERTA
   do animal (criando a fatura se não existir). Retorna { dados: { finalizado: N } }.

10. SubModulo* em Atendimento.tsx — cada sub-aba é um componente autônomo que gerencia
    seu próprio estado/fetch. Atendimento.tsx só cuida da navegação entre abas e do header do animal.

11. TROCA_VET recusa: ao recusar, o registro volta a {tipo:'VINCULO', status:'ACEITO'} — NÃO
    fica como RECUSADO. veterinarioNome NÃO é limpo (vet antigo mantém o acesso). Só o novoVetUserId
    é nullado. Email ao proprietário via enviarConfirmacaoVinculo.

12. useProprietarioNotificacoes: RECUSADO/CANCELADO NÃO entram no mapa de inicialização.
    Na segunda chamada, esses registros têm anterior===undefined e caem no check de updatedAt.
    Janela: 10 minutos. Se a recusa tem mais de 10min quando o proprietário abre a página,
    não há toast in-app — somente o email (se configurado).

13. VetDashboard/AnimaisVet handleResponder e handleResponderModal: ao recusar, usar toast()
    com ícone (não toast.success) — visual diferente do aceite. VINCULO=❌, DESVINCULO=🔒, TROCA_VET=🔄.

14. MatrizPerfil.locked — campo inicialmente adicionado via raw SQL, agora formalizado na migration
    `20260605005109_add_proprietario_tratador_fields`. Após `npx prisma generate` o campo está disponível
    no client tipado. PermissaoService.js ainda usa `$queryRawUnsafe`/`$executeRawUnsafe` — pode migrar
    para Prisma tipado normalmente após confirmar que o generate foi executado.

15. PROPRIETARIO como perfil: não é MembroEquipe. minhasPermissoes lê MatrizPerfil das equipes vinculadas
    via Animal.empresaId → Equipe. Permissões usam union (nível máximo entre equipes). PROPRIETARIO não
    pode ser atribuído como cargo de membro da equipe (bloqueado em alterarCargo).

16. req.empresaId — injetado pelo próprio `authenticate` (auth.js) via MembroEquipe lookup.
    NÃO é mais necessário adicionar `injectTenant` por rota.
    🔴 (2026-08-17) `injectTenant` (middleware/tenant.js) DEIXOU DE SER INOFENSIVO e foi
    REMOVIDO das rotas que ainda o usavam (`routes/animais.js` GET/POST `/`, `routes/evolucao.js`
    6 rotas). Ele reatribuía `req.empresaId` pela equipe MAIS RECENTE do usuário (`orderBy:
    createdAt desc`), ignorando o contexto ativo (headers x-empresa-id/x-equipe-id) que o
    `authenticate` já resolveu. Isso era só "impreciso" enquanto o RLS não existia; com a
    fase 7c (fail-closed — ver §12, "RLS geral"/"fim do escape"), o `app.empresa_id` já foi
    CARIMBADO na sessão do Postgres com o valor original de `authenticate` no fim do próprio
    middleware (`comEmpresa(req.empresaId ?? null, () => next())`) — reatribuir `req.empresaId`
    DEPOIS disso não muda o que o RLS já carimbou. Toda escrita cujo `empresaId` viesse do
    valor reatribuído (diferente do carimbado) morria com `new row violates row-level security
    policy`. Sintoma típico: 500 ao cadastrar animal/proprietário para quem pertence a mais de
    uma equipe/empresa. NUNCA reintroduzir `injectTenant`: `req.empresaId` já vem pronto do
    `authenticate`, e é ELE que fixa o tenant carimbado no banco — qualquer reatribuição
    posterior diverge da sessão do Postgres.
    Se req.empresaId for null, verificarAcessoAnimal cai no check de VetAnimalSolicitacao individual.
    Gestores de empresa com múltiplos gestores precisam de req.empresaId para acessar animais vinculados a
    qualquer vet da empresa — sem ele, apenas o vet diretamente vinculado consegue acesso.

17. Migrations shadow DB — colunas adicionadas fora de migration causam P3006 no `prisma migrate dev`.
    Sintoma: "column X referenced in foreign key constraint does not exist".
    Fix: envolver o ADD CONSTRAINT em bloco condicional DO $$ BEGIN IF EXISTS (...) THEN ... END IF; END $$.
    Exemplos corrigidos: `20260601000001` (proprietarioId em tb_faturas) e `20260601000002`
    (animalId em tb_faturas e tb_fatura_itens). Após corrigir, rodar:
      npx prisma migrate resolve --rolled-back <migration_name>
      npx prisma migrate deploy

18. isConvidado — campo agora presente na migration `20260605005109` (ADD COLUMN). UserController.js
    ainda usa `$queryRawUnsafe` para ler o campo (código legado). Pode ser migrado para Prisma tipado
    após confirmar que `npx prisma generate` foi executado.

19. CadastroProprietario.tsx usa BrasilAPI pública (brasilapi.com.br/api/cnpj/v1/{cnpj}) para auto-fill
    de CNPJ — chamada feita direto do frontend (CORS liberado pela API). Nenhum proxy no backend.
    Falha silenciosa: se a API estiver indisponível, exibe toast informativo e mantém campos editáveis.

20. PROPRIETARIO era bypass total em checkPermission (BUG CRÍTICO corrigido).
    O bloco antigo: `if (req.user.userType === 'PROPRIETARIO') return next();`
    permitia que PROPRIETARIO acessasse qualquer rota protegida com `checkPermission`, mesmo com NEGADO
    na MatrizPerfil. Corrigido: `getNivelPermissaoProprietario()` realiza lookup real em MatrizPerfil.
    Entrada direta por URL (`/#/dieta/4`) NÃO bypassava o frontend (React router ainda carregava), mas
    bypassava o backend completamente. A correção é no middleware, não no frontend.

21. NEGADO deny-wins — ao agregar permissões de múltiplas equipes para PROPRIETARIO:
    - Se qualquer equipe tem NEGADO para aquele módulo, o resultado final é NEGADO (bloqueia).
    - Não é "máximo entre equipes" — NEGADO tem ordinal -1 mas ganha sobre qualquer positivo.
    - Implementado com Set de negados no `minhasPermissoes` e com verificação prévia em
      `getNivelPermissaoProprietario()`.

22. loadingPerms deve gating useEffects — se `usePermissoes` ainda carrega (`loading: true`),
    `podeExecutar()` retorna false para tudo (permissoes é {}). Chamar APIs neste estado gera
    403s desnecessários que poluem logs e ativam o interceptor. Sempre verificar:
    `useEffect(() => { if (loadingPerms) return; carregarDados(); }, [deps, loadingPerms]);`

23. GET 403 retorna `{ data: null }` — o interceptor em api.ts resolve (não rejeita) GETs com 403.
    Portanto, `res.data` pode ser null. NUNCA fazer `res.data.dados` — usar `res.data?.dados`.
    Também adicionar guard: `if (!res.data) return;` imediatamente após await da chamada GET.
    Sem o guard: `TypeError: Cannot read properties of null (reading 'dados')`.

24. Console suppression em produção — main.tsx sobrescreve console.* com noop quando !DEV.
    Erros de rede (403, 404, etc.) ainda aparecem na aba Network do DevTools mas NÃO no console.
    Erros JavaScript (TypeError, etc.) também são suprimidos no console em produção.
    Para reativar em desenvolvimento: setar VITE_SUPPRESS_CONSOLE=true no .env NÃO é o caminho;
    o noop só é ativado quando !DEV OU VITE_SUPPRESS_CONSOLE=true. Em DEV normal, console funciona.

25. Contexto ativo (multi-empresa/multi-equipe): axios envia headers `x-empresa-id` e `x-equipe-id`
    (localStorage `s2vet_empresa_id`/`s2vet_equipe_id`, gerenciados por EmpresaContext).
    Empresa CNPJ → gestor trabalha por EMPRESA (1 opção por empresa, só x-empresa-id).
    Empresa pessoal/CPF (cnpj null) → gestor trabalha por EQUIPE (1 opção por equipe; x-equipe-id
    define também req.empresaId a partir da equipe). auth.js valida o vínculo (membro da equipe OU
    owner da empresa) antes de aceitar — valor inválido é ignorado e cai no fallback (MembroEquipe
    mais recente → ownerId). getEmpresaDoGestor(userId, req.empresaId) exige owner OU cargo GESTOR;
    getEquipeAtiva(empresaId, req.equipeId) prefere a equipe ativa, senão primeira da empresa
    (usado em listarConvites/removerConvite; garantirEquipePadrao e getMinhaEquipe seguem a mesma ordem).
    Seletor no Sidebar só renderiza com opcoes.length > 1; trocar contexto faz window.location.reload().
    Logout limpa as duas chaves.
    RBAC por contexto: cargo e permissões PODEM DIFERIR entre equipes/empresas (GESTOR na A,
    VETERINARIO na B). minhasPermissoes e checkPermission resolvem o vínculo do CONTEXTO ATIVO
    (equipe ativa > equipe da empresa ativa > mais recente) — nunca união entre equipes (exceto
    PROPRIETARIO, que mantém union+deny-wins). Bypass de dono de empresa vale APENAS para a
    empresa ativa. PermissaoController: todas as rotas /:equipeId exigem ADMIN, GESTOR da equipe
    ou dono da empresa dela (autorizarGestorDaEquipe) — antes só exigiam authenticate (gap).

26. medicamentos.js e procedimentos.js — requireAdmin histórico usava `req.user?.role` (campo
    inexistente no JWT do S2Vet — o campo correto é `userType`). Resultado: `undefined !== 'ADMIN'`
    era sempre true, gerando 403 para todos. Corrigido para `req.user?.userType !== 'ADMIN'`.
    Se criar novos guards inline de "admin only" em qualquer route file, SEMPRE usar `req.user?.userType`.

27. Dois sistemas de exame COMPLETAMENTE distintos — não confundir:
    Sistema A — ExameNutricional: rota /api/exames, controller ExameController, páginas Exames.tsx +
      CriaExameNutricional.tsx. Backend usa slugs atendimento.exames.*. Frontend (após fix 2026-06-24)
      usa os mesmos slugs. Exame nutricional de nutrientes (hemograma, minerais, etc.)
    Sistema B — ExameClinico: rota /api/clinica/exames, controller ExameClinicoController, página
      SubModuloExames.tsx (dentro de Atendimento). Slugs: atendimento.exames.*. Tipos: Laboratorial,
      Bioquímico, Imagem, Compra. Exames pedidos no atendimento clínico.
    exames.laboratorial.* e exames.imagem.* ERAM órfãos (não protegiam rota) até 2026-07-10 — ver #28.
    Farmácia, vacina.estoque e todos os módulos de cadastro têm checkPermission — os slugs do seed
    estão alinhados com os routes a partir de 2026-06-24.

28-f. **VER a agenda é tudo-ou-nada: quem tem o slug vê a de TODOS (2026-07-30).**
    `atendimento.agendamentos.ler` concedido = enxerga os agendamentos de todo o contexto,
    em QUALQUER nível e para QUALQUER perfil (vet, estagiário, enfermeiro, secretaria,
    financeiro, prestador). `AgendamentoController.listarGlobal` filtrava
    `OR: [{veterinarioId}, {criadoPorId}]` para quem não fosse GESTOR — restrição que a
    matriz nem oferece configurar (28-c) e que impedia a equipe de saber quem atende quem.
    O recorte da listagem é o CONTEXTO (empresa/equipe), não a autoria.
    Continuam valendo, porque são ISOLAMENTO e não permissão:
    - PROPRIETARIO → só os agendamentos dos animais dele;
    - sem empresa ativa → só os próprios (não há equipe a que pertencer);
    - **PRESTADOR** (cargo FORNECEDOR) → só animais com designação ativa
      (`buildAnimalScopeWhere`, deny-by-default do DesignacaoPrestador) **OR os próprios**.
      O `OR` não é opcional: a designação é INATIVADA ao concluir o encaminhamento, então
      sem ele o prestador perderia de vista os atendimentos que ele mesmo fez (medido numa
      base real: um caso ia de 5 para 0).
    AGIR sobre o agendamento de outro segue sendo outra história — ver 28-b (só GESTOR
    agenda/transfere para outro; o resto usa "assumir").

28-c. **A ação vale sobre O QUE É DE QUEM A EXECUTA (2026-08-04) — premissa de AUTORIA.**
    ⚠️ REVERTE a regra de 2026-07-30 ("sem filtro de autoria; quem decide é só o Controle
    de Acesso"), que está preservada abaixo só para explicar por que NÃO se volta a ela.
    **REGRA VIGENTE:** ter a ação concedida = poder executá-la sobre o registro que a
    pessoa CRIOU ou ASSUMIU. O ÚNICO perfil que opera registro de outro é o GESTOR
    (e o ADMIN da plataforma). Assumir transfere a autoria (`veterinarioId` passa a ser
    de quem assumiu), então "criado ou assumido" é uma comparação só.
    ```js
    podeOperarRegistro(req, autorId)   // ← assinatura NOVA: req, não o nível solto
    // nível < PROPRIO        → false (o checkPermission da rota já teria barrado)
    // ehGestorNoContexto(req) → true  (cargo GESTOR, dono da empresa ou ADMIN)
    // senão                   → Number(autorId) === req.user.id
    // autorId null (registro órfão) → só o gestor
    ```
    `ehGestorNoContexto(req)` é a checagem canônica de "sou gestor aqui" —
    `checkPermission` seta `req.membroCargo = 'GESTOR'` em TODOS os caminhos de bypass.
    ⚠️ **NUNCA usar `req.permissaoNivel === 'FULL'` como sinônimo de gestor**: FULL é um
    NÍVEL da matriz e, concedido a um perfil comum, viraria passe livre para o prontuário
    alheio. Foi por isso que `AgendamentoController.podeAgendarParaOutro` deixou de
    aceitar FULL, e que "editar evolução FINALIZADA" trocou o teste de nível por
    `ehGestorNoContexto`.
    Cobertura: os 19 call sites de Evolução/Prescrição/PrescriçãoGrupo/Exame/
    Encaminhamento/Vacina + os guards NOVOS de `adicionarItem`/`atualizarItem`/
    `removerItem` do `PrescricaoGrupoController`, que **não tinham nenhum** — qualquer um
    com "alterar prescrição" reescrevia a posologia prescrita por outro, e o
    `data.veterinarioId = <quem editou>` ainda fazia o documento trocar de dono calado.
    Editar NÃO transfere mais autoria: a troca de dono tem caminho próprio (assumir /
    transferir), e um ajuste do gestor não pode tirar do veterinário o que ele conduz.
    No FRONT o espelho é `meuRegistro = isGestor || eProprioAutor` (Evolução, Prescrição,
    Exames, Vacina, Encaminhamento). ⚠️ O botão **assumir** usa o nível CRU
    (`temNivelEditar`), nunca `podeEditarEsta` — que já exige autoria e, por definição, é
    falso na evolução do outro, que é justamente a que se assume.
    Regressão de 2026-07-30 que a regra nova NÃO pode reintroduzir: a tela de Controle de
    Acesso é BINÁRIA (o `PermCheck` marca/desmarca; não escolhe entre PROPRIO e EQUIPE).
    Por isso a autoria é REGRA BASAL e não um nível configurável — e por isso o gestor
    segue com bypass. Para dar a alguém acesso ao registro alheio, o caminho é o cargo de
    GESTOR, não um nível maior na matriz.

28-d. **Só VER = NENHUM botão de ação no Atendimento (2026-07-30).** Perfil com apenas
    `*.ler` marcado não pode ter nada acionável na tela — nem escondido atrás de um
    handler que só falha depois do clique. Corrigido em Evolução, Prescrição, Vacina,
    Exames, Encaminhamento e no shell (`Atendimento.tsx`):
    - **Aprovar** evolução era `role === 'ADMIN' || 'VETERINARIO'` → passou a seguir
      `atendimento.evolucoes.finalizar` (é o slug que a rota `PATCH /aprovar` exige).
    - **Cancelar** evolução finalizada era role → segue `...evolucoes.deletar`
      (slug da rota `PATCH /cancelar`). NUNCA gatear botão por `user.role`/`userType`:
      o tipo é por empresa (36-e) e o gestor não configura role, configura a matriz.
    - **Imprimir** só aparece com `*.imprimir` (faltava em Evolução, Exames e no
      Histórico do Paciente do shell).
    - **WhatsApp / E-mail** são conteúdo SAINDO do sistema: mesmo gate do IMPRIMIR
      (não existe coluna própria para eles no Controle de Acesso).
    - `abrirEdicao` (Evolução) abre em SOMENTE LEITURA quando não há permissão de
      alterar — o `editItemId` vem do shell e não pode ser a porta dos fundos.
    Ao criar tela nova: todo botão que não seja "ver" nasce dentro de `{podeX && …}`,
    e o handler mantém o guard `if (!podeX) { semPermissao(...); return; }`.

28-b. **Agenda: "só o gestor agenda/transfere para OUTRO" é regra BASAL (2026-07-30,
    endurecida em 2026-08-04).** Não é permissão da matriz e não se configura: escolher
    quem atende o paciente é decisão de quem coordena a equipe. Apenas GESTOR (cargo
    GESTOR / dono) e ADMIN criam, transferem e trocam profissional na agenda.
    ⚠️ `podeAgendarParaOutro` é só `ehGestorNoContexto(req)` — o nível `FULL` saiu da
    conta (ver 28-c).
    ⚠️ **REVERTE a permissão de 2026-07-28** que deixava o profissional transferir a
    agenda DELE (tanto o atendimento avulso quanto o dia inteiro em `transferirDia`).
    Os dois caminhos são o MESMO ato e agora seguem a MESMA regra — mantê-los divergentes
    só gerava dúvida sobre quem pode passar paciente para quem. Quem não é gestor tem o
    **ASSUMIR** como caminho: puxa para si, nunca empurra para terceiro.
    EXCEÇÃO: atribuir profissional a um agendamento SEM responsável continua liberado —
    não há de quem tirar, então não é transferência.
    Front: `podeTransferir` = `isGestor && podeOperarLinha`; o botão "Transferir dia
    inteiro" e o "Trocar" da Minha Agenda (que no MOBILE não tinha o gate) idem.

28-g. **`/clinica/agenda` É `Agendamentos.tsx` (2026-08-04) — não existe agenda paralela.**
    A aba "Agenda" do Atendimento renderiza a MESMA tela de `/agendamentos` com a prop
    `modoMinhaAgenda`, que:
    - mostra SÓ o card "Agendamentos do Dia" (esconde cabeçalho de página, `BotaoVoltar`,
      a barra Animal↔Proprietário, o calendário, os filtros e o Expediente Ativo);
    - troca o `PageContainer` por um fragmento (o shell do Atendimento já dá o container);
    - escopa a lista ao próprio profissional — `modoMinhaAgenda && !isGestor` filtra por
      `veterinario.id === meuUserId`. **É a ÚNICA diferença de comportamento**; o gestor
      continua vendo a equipe, com o filtro por profissional.
    A prop `onSelecionarAnimal` (opcional) transforma o nome do paciente em botão, que era
    o comportamento da aba antiga.
    Com isso, layout, ações (Iniciar, Reagendar, Assumir, Transferir, Cancelar), filtro de
    status, estado vazio e o **modal de reagendamento com calendário e grade de horários**
    são literalmente os mesmos — não há o que sincronizar.
    ⚠️ `SubModuloMinhaAgenda.tsx` foi **REMOVIDO**. Era uma segunda implementação da mesma
    lista, e a divergência entre as duas gerou uma série de "sumiu o botão X" (a aba ficou
    sem Assumir, com o Trocar liberado no mobile e sem filtro de status). **NUNCA recriar
    uma agenda paralela**: para variar o comportamento, use uma prop nesta tela.
    Se o modo aba crescer, o caminho é extrair o card do dia em um componente — nunca
    copiar o arquivo de novo. O Controle de Acesso decide SE a pessoa agenda; esta regra decide PARA
    QUEM. Quem não é gestor tem o **assumir** como caminho para pegar atendimento de outro.
    ⚠️ O ESTAGIÁRIO não conseguia agendar NADA por causa da GRADE, não da regra: a lista de
    colunas filtrava `cargo VETERINARIO|GESTOR|FORNECEDOR`, então ele não tinha coluna
    própria e toda coluna era "de outro". A grade passou a listar todos os PROFISSIONAIS da
    equipe (exclui só cargo PROPRIETARIO e ADMIN) — cada um com a sua coluna. Corolário:
    quem precisa marcar precisa de coluna na grade, não de nível maior na matriz.

28. **Autoria clínica = RBAC (o SE) + AUTORIA (o SOBRE O QUÊ).** Padrão nos controllers de
    editar/finalizar/excluir/cancelar (Evolucao, Prescricao, PrescricaoGrupo, ExameClinico,
    Encaminhamento, Vacina, Agendamento):
      `if (!podeOperarRegistro(req, item.veterinarioId)) → 403`
    O Controle de Acesso decide SE a pessoa executa a ação; a autoria decide SOBRE QUAL
    registro — ver 28-c para a regra completa e a assinatura. "Só o gestor finaliza uma
    evolução" continua sendo CONFIGURAÇÃO da matriz (seed dá VET/EST NENHUM em
    `*.finalizar`); "ninguém finaliza a evolução de outro" é código.
    Reabrir evolução FINALIZADA é ato de GESTOR (`ehGestorNoContexto`), não nível de matriz.
    Exclusão de evolução FINALIZADA por não-ADMIN segue bloqueada.
    VacinaClinica: ciclo `status` SALVA→FINALIZADA→EXECUTADA (fatura/estoque só na execução,
    no plantão via `enfermagem.prescricao.executar` — ver seção do fluxo da vacina).
    EXCEÇÃO deliberada — "assumir": `AgendamentoController.assumir` e
    `EvolucaoController.assumir` NÃO chamam `podeOperarRegistro`. Assumir é um PUXAR PARA SI
    (quem assume passa a ser o responsável), não a edição do registro alheio: o gate é o
    slug de `editar` da rota + acesso ao animal + escopo clínico. Quem perdeu o registro é
    comunicado por e-mail e WhatsApp. Não "consertar" isso adicionando check de autoria —
    seria o único caminho para pegar o atendimento de outro, e ele ficaria fechado.
    Escopo de DADOS de prestador (quais animais o FORNECEDOR vê via DesignacaoPrestador) e a
    resolução de contexto (MapaAtendimento isGestor) usam membroCargo/userType — isso é
    modelo de acesso/tenant, NÃO regra de autorização de ação.

28-e. **Assumir/transferir ARRASTA o atendimento inteiro (2026-08-04) —
    `lib/transferenciaAtendimento.js`.** Hierarquia:
    `AGENDAMENTO → EVOLUÇÃO (EM_ANDAMENTO) → { PRESCRIÇÃO (grupo + itens), EXAME,
    ENCAMINHAMENTO, VACINA }`. Sem o arrasto, a premissa de autoria (28-c) TRANCA quem
    assumiu: ele conduz o atendimento mas não pode editar nem finalizar a prescrição/exame
    que ficaram com o profissional anterior — que, por sua vez, segue podendo mexer num
    atendimento que não é mais dele.
    Aplicado em `EvolucaoController.assumir`, `AgendamentoController.assumir`,
    `AgendamentoController.atualizar` (troca de `veterinarioId`) e `transferirDia`.
    Detalhes que não são acidentais:
    - Só evolução **EM_ANDAMENTO** é arrastada — finalizada é histórico fechado e não muda
      de responsável por troca de plantão.
    - Os **ITENS** da prescrição vão junto do grupo: a autoria do item é avaliada por
      `Prescricao.veterinarioId`, e mover só o grupo os deixaria presos ao dono antigo.
    - Registro **órfão** (`veterinarioId` null) É arrastado — é justamente o que ninguém
      consegue operar. Por isso o filtro "já é dele" roda em JS, e não como
      `{ not: X }` no Prisma (semântica de NULL varia entre versões).
    - **`FaturaItem.veterinarioId` NÃO é arrastado**: ali o campo é atribuição FINANCEIRA
      (quem gerou a cobrança / a quem a comissão pertence), não condução clínica.
      Reatribuir receita já lançada por causa de uma troca de plantão é decisão comercial
      e não foi pedida.
    - `PrescricaoGrupo` não tem `ativo` (o soft delete dele é o status CANCELADO) — por
      isso o filtro é por modelo em `FILHOS_DA_EVOLUCAO`, e não uma constante única.
    Testes: `src/__tests__/autoriaAtendimento.test.js` (autoria + arrasto, com tx falsa).

28-f-bis. **Toda troca de responsável e toda edição do atendimento vão para a AUDITORIA
    (2026-08-04).** Duas categorias novas em `lib/auditoria.js`
    (`CATEGORIAS` += `TRANSFERENCIA`, `ALTERACAO`) e dois helpers:
    - `registrarTransferencia(client, req, { entidade, entidadeId, animalId, deVetId,
      paraVetId, motivo, origem })` → grava **quem era o dono anterior e quem passou a
      ser**, com `origem` dizendo o que disparou a cascata (`EVOLUCAO #12 assumida`).
      Uma linha por registro afetado — é o que faz a tela responder "esta prescrição
      mudou de dono, e por quê".
    - `registrarAlteracao(client, req, { entidade, entidadeId, campos, donoAnteriorId,
      donoAtualId })` → **antes → depois** por campo, sempre amarrado ao responsável de
      cada lado. Campo sem mudança real é descartado; lista vazia não grava nada.
    ⚠️ As duas SEMPRE dentro da MESMA transaction da operação: ou a troca e o seu rastro
    existem juntos, ou nenhum dos dois existe.
    ⚠️ Campo longo (texto da evolução, observação) passa por `resumoTexto()` — o AuditLog
    é um LEDGER, não um versionador de conteúdo.
    ⚠️ `entidade` reusa os rótulos que a tela já traduz (`ENTIDADE_LABEL` em
    `AuditoriaGeral.tsx`) — exame clínico é `EXAME_CLINICO`, nunca `EXAME`.
    `finalizar` da prescrição grava `veterinarioId = quem finalizou`: quando isso muda o
    dono (gestor finalizando a de outro), sai TRANSFERENCIA além da ALTERACAO.

29-b. **Exame de COMPRA: um por paciente POR DATA (2026-08-04).** ⚠️ NÃO é "um por
    animal" — o mesmo cavalo é vendido de novo e ganha outro laudo de compra, quantas
    vezes for negociado. O que não pode existir é DOIS laudos na MESMA data: o laudo é a
    fotografia do animal naquele dia, então dois ali são duplicidade (ou reenvio de
    formulário), não dois exames. A checagem é por `(animalId, data)` — nunca por
    `animalId` sozinho. Vale SÓ para
    `tipo === 'Compra'` — os demais tipos são PEDIDOS e podem se repetir no dia à
    vontade (dois hemogramas, dois raios-x). Backend: `compraNoMesmoDia()` em
    `ExameClinicoController`, chamado por `criar` e por `atualizar` → **409
    `COMPRA_DUPLICADA`**. No `atualizar` passa-se `ignorarId` com o próprio exame, senão
    salvar sem mudar a data acusaria conflito consigo mesmo e travaria toda edição.
    ⚠️ Compara pela DATA (`YYYY-MM-DD`), nunca pelo instante: `dataSolicitacao` é
    DateTime e o front manda meia-noite UTC, mas registro criado por outro caminho pode
    ter hora — igualdade exata deixaria a duplicata passar.
    O front (`ExameCompra.tsx`) repete a checagem contra o histórico que já tem em
    memória, só para avisar ANTES de o usuário perder o preenchimento de um formulário
    de 4 abas. Quem manda é o backend.

29. **PEDIDO de exame × RESULTADO de exame são módulos distintos (2026-07-25)** — apesar dos nomes
    parecidos, são fluxos diferentes:
    - **PEDIDO** (solicitar/editar/finalizar/excluir o exame no atendimento — `ExameClinicoController`):
      protegido APENAS por `atendimento.exames.*` (checkPermission na rota + autoria via
      `req.permissaoNivel`), MESMO padrão de evolução/prescrição/vacina/encaminhamento.
    - **RESULTADO/laudo** (carregar/salvar/alterar/ver o resultado): é quem deve usar
      `exames.laboratorial.*` / `exames.imagem.*` (ações ver/carregar/salvar/alterar).
    **REVERTIDO o gate por tipo de 2026-07-10**: o `ExameClinicoController` (pedido) NÃO consulta mais
    `exames.laboratorial.*`/`exames.imagem.*` em criar/editar/excluir — isso causava 403 ao criar um
    pedido mesmo com `atendimento.exames.criar` concedido (o gestor concedia o slug de atendimento mas
    não o do módulo "Exames"/resultado). `SLUG_BASE_POR_TIPO`/`nivelDoTipo` removidos do controller;
    frontend `SubModuloExames.tsx` — abas Laboratorial/Imagem gateadas só por `atendimento.exames.criar`
    (`podeCriarLab`/`podeCriarImg = podeCriar`). NUNCA reamarrar os slugs de resultado ao pedido.
    **FLUXO DE RESULTADO IMPLEMENTADO (2026-07-25, migration `20260730000000`):** `PATCH /clinica/exames/:id/resultado`
    (multipart, `ExameClinicoController.salvarResultado`) carrega o resultado e transita o exame para
    status `REALIZADO` (front exibe "Realizada"). Gate pelos slugs de RESULTADO por tipo, resolvido no
    controller via `getNivelEfetivo` (Lab/Bioquímico→`exames.laboratorial.editar`; Imagem→`exames.imagem.editar`)
    — distinto do pedido (`atendimento.exames.*`). A rota entra por `atendimento.exames.ler` só para popular
    o contexto (bypass do gestor); o gate real é no controller. **Laboratorial/Bioquímico:** reusa
    `processarExame` (LLM, mesmo do exame nutricional) → grava a tabela em `ExameClinicoResultadoItem`
    (parametro/valor/unidade/referencia) + `storage.upload` do arquivo (`arquivoUrl`). **Imagem:** laudo
    VERBATIM (sem LLM) em `ExameClinico.resultado` + imagens em `ExameImagemAnexo` (ganhou `exameClinicoId`).
    Correlação exame×evolução via `ExameClinico.evolucaoId` já existente. Front (`SubModuloExames.tsx`):
    seletor "Carregar resultado" com os exames SOLICITADO do animal + opção "carregar exame não pedido"
    (cria o pedido com a evolução do atendimento e então carrega), modal `CarregarResultadoModal`, exibição
    (tabela + laudo + miniaturas) no ViewModal, status "Realizada" (badge/filtro).

30. Sincronização FaturaItem ↔ origem — helpers `removerFaturaItensDaOrigem`/`atualizarFaturaItensDaOrigem`
    (`faturaUtils.js`) recebem `(tx, campo, origemId, ...)` onde `campo` é o nome literal da FK no
    `FaturaItem` (ex: `'exameClinicoId'`) — usado como chave computada (`where: { [campo]: id }`).
    SEMPRE chamar dentro da mesma `prisma.$transaction` que também altera o registro de origem —
    se a fatura estiver `PAGA`, o helper lança `FaturaPagaError` (`err.code === 'FATURA_PAGA'`) e a
    transaction inteira faz rollback (o registro de origem não é tocado). O controller só precisa
    capturar esse código no catch e responder 400 — não precisa checar `status === 'PAGA'` manualmente
    antes. Para prescrição não existe chamada de remoção/edição: o gate `grupo.status !== 'SALVO'` em
    `PrescricaoGrupoController.atualizarItem`/`removerItem` já impede qualquer alteração em item que
    já tenha `FaturaItem` (que só é criado a partir de `FINALIZADO`/`executar`, ou seja, depois de
    `SALVO`) — `prescricaoId` no `FaturaItem` é só para rastreabilidade, não há novo bloqueio ali.

31. Estoque da farmácia — "em uso" = só movimentos SAIDA. `criar` gera automaticamente um
    MovimentoEstoque ENTRADA ("Entrada inicial") quando qtdEstoque > 0 — por isso NUNCA usar
    contagem total de movimentos para decidir se o item pode ser editado (bug corrigido em
    2026-07-10). `emUso` (listar) e `contarMovimentos` (atualizar) filtram `tipo: 'SAIDA'`.
    O tipo AJUSTE aceita quantidade NEGATIVA (delta assinado) — correção para baixo não deve
    ser registrada como SAIDA, senão marca o item como "em uso" indevidamente. O gráfico de
    movimentações (Farmacia.tsx) usa Math.abs na barra de ajuste por isso. A rota de ajuste
    tem slug próprio `farmacia.estoque.ajustar` (não reusa `editar`).

32. Modais arrastáveis (useDraggableModals) — o comportamento é global por delegação; NÃO
    adicionar lógica de drag em modais individuais. Novos modais ganham o recurso de graça se
    seguirem o padrão (cabeçalho `.rounded-t-2xl` ou título h2/h3 dentro de painel fixed);
    para alça customizada, usar `data-drag-handle`. O painel é resolvido subindo até o
    ancestral `fixed`; overlay que cobre a viewport inteira (backdrop) nunca é movido —
    painéis quase-tela-cheia (ex: `fixed inset-x-4 top-[4vh]`) funcionam porque têm margens.

33. Exclusões/cancelamentos exigem `motivo` no body (400 sem ele) e registram no AuditLog
    via `lib/auditoria.js` — TODO novo endpoint de exclusão/cancelamento DEVE seguir o padrão
    (exigir motivo + `registrarAuditoria`; passar `tx` quando houver transaction). No frontend
    usar `ModalJustificativa` (nunca confirm simples) e enviar via
    `api.delete(url, { data: { motivo } })` — axios exige `data` na config do DELETE.
    Evolução usa a chave `justificativa` (legado); todos os demais usam `motivo`.

34. Reservas de estoque de prescrição são MULTI-LOTE (FEFO) — nunca usar `findFirst` de
    estoqueClinica para verificar/debitar medicamento de prescrição: usar `buscarEstoquesFEFO`
    e agregar. Reservas: criadas no `finalizar`, abatidas pelo `debitarEstoqueDia` (passar
    grupoId!), liberadas em cancelar/último dia/remoção total. `verificarDisponibilidade`
    desconta reservas de OUTRAS prescrições — o alerta 409 `ESTOQUE_INSUFICIENTE` no finalizar
    aceita `forcarFinalizacao: true` (o restante fica reservado no último lote, podendo
    exceder o saldo físico — comportamento intencional de finalização forçada).

35. Escopo clínico (`lib/clinicalScope.js`) — segregação multi-clínica dos registros clínicos:
    `escopoEvolucaoWhere`/`escopoFilhoEvolucaoWhere`/`escopoPrescricaoGrupoWhere` filtram por
    `{ OR: [{ empresaId: req.empresaId }, { veterinarioId: userId }] }` (a clínica ativa vê seus
    registros + os próprios do usuário). `semEscopoClinico(req)` BYPASSA o escopo (retorna {}) para:
    ADMIN, PROPRIETARIO (dono do animal vê tudo) e **GESTOR do contexto ativo**
    (`req.membroCargo === 'GESTOR'`). Regra de negócio: "gestor não é perfil no controle de acesso —
    tem acesso a TUDO". O gestor precisa ver e FINALIZAR evoluções/exames/vacinas/encaminhamentos/
    prescrições criados por QUALQUER membro da equipe, sem depender de autoria nem de `empresaId`
    corretamente resolvido (evolução criada com `empresaId` divergente por race de contexto NÃO some
    para o gestor). `req.membroCargo` é setado pelo `checkPermission` da rota — todas as rotas de
    listagem clínica por animal têm `checkPermission(...'ler'...)`, então o bypass é confiável ali.
    Exceção conhecida: `GET /clinica/historico/animal/:id` NÃO tem `checkPermission` → `req.membroCargo`
    fica undefined → gestor NÃO bypassa no histórico (usa escopo por empresa). Botão Finalizar no
    front continua sendo `isGestor || nível de finalizar (EQUIPE/FULL = qualquer registro; PROPRIO =
    só os próprios)` — o bypass do escopo só garante que o registro APAREÇA para o gestor decidir.

36-b. **Resolver "sou gestor?" e "qual é o meu cargo?" NUNCA pode ter fallback para outra
    empresa (corrigido 2026-07-29).** Dois helpers faziam isso e vazavam papel entre clínicas:
    - `EquipeController.getEmpresaDoGestor(userId, empresaIdPreferida)` — quando a empresa
      PREFERIDA (o contexto ativo) não tinha o usuário como dono/GESTOR, caía em "qualquer
      empresa que ele possua/gerencie". Um profissional GESTOR na empresa A e VETERINÁRIO na
      B, trabalhando em B, era resolvido para A: `listarMembros` devolvia o roster de A com
      `isGestor: true`, `GET /equipes/configuracoes` devolvia a config de A (e o Sidebar
      bloqueava os módulos de B com "Complete a Configuração da Empresa") e toda ação de
      gestão gravava em A. Agora, com `empresaIdPreferida` informado, a resolução é EXCLUSIVA
      daquela empresa (null = "não é gestor aqui"). Fallback só sem contexto (bootstrap do vet
      autônomo). `garantirEquipePadrao` devolve `{ empresa: null, equipe: null }` nesse caso —
      NUNCA cria empresa nova nem usa a do usuário — e os 3 callers respondem 403.
    - `UserController.getMe` — `cargoEquipe` vinha de `membroEquipe.findFirst({ userId })`
      ordenado por `createdAt asc`, isto é, o vínculo MAIS ANTIGO. Quem é GESTOR na própria
      clínica aparecia como "Gestor(a)" no Cadastro Pessoal (com os dados profissionais
      travados) ao entrar em outra empresa onde é estagiário. Agora usa
      `resolverMembroDoContexto`, que também deixou de cair em outro vínculo quando existe
      contexto ativo (o mesmo valia para expediente e locais de trabalho — a herança de
      expediente agora é escopada à EMPRESA ativa).
    REGRA: todo "quem sou eu aqui" (cargo, isGestor, expediente, locais, configuração) se
    resolve pelo par (req.empresaId, req.equipeId) e, na ausência de vínculo nele, responde
    vazio/404 — nunca o vínculo de outra empresa. Cadastro incompleto numa empresa nova é
    ESPERADO (o `ProfissionalPerfil` é por empresa): o gestor inclui com nome+telefone e o
    profissional completa endereço/CEP ao entrar naquele contexto.

36-d. **Empresa NUNCA existe sem gestor (2026-07-30).** Dois furos fechados:
    - `EquipeController.criarEmpresa` criava a linha de `Empresa` com `ownerId` e mais nada —
      a equipe e o vínculo GESTOR vinham depois (ou não). Agora nasce empresa + "Equipe
      Principal" + `MembroEquipe{cargo:'GESTOR'}` na MESMA transaction (igual `setup` e
      `EquipeService.criarEmpresaEEquipe`).
    - `UserAdminController.excluir` (ADMIN) apagava o usuário sem olhar as empresas dele:
      `Empresa.owner` é `onDelete: SetNull` e `MembroEquipe` é cascade, então excluir o dono
      zerava o `ownerId` E removia o vínculo GESTOR — a empresa ficava ÓRFÃ, ainda com
      paciente/proprietário/tratador dentro, invisível para todos (nenhum gestor a alcança) e
      sem aparecer em `meusContextos`. Agora responde **409 `USUARIO_DONO_DE_EMPRESA`**
      listando as empresas: transfira a gestão ou exclua a empresa antes de excluir a conta.
    Para achar órfãs: empresa cujo `ownerId` é null/inexistente E sem nenhum `MembroEquipe`
    com cargo GESTOR nas suas equipes.
    **Nome da equipe é OBRIGATÓRIO e nunca genérico.** `criarEmpresa` exige `equipeNome`
    (400 `EQUIPE_NOME_OBRIGATORIO` + `criarEmpresaRules`): o sistema não inventa nome de
    equipe. Onde não há ninguém para informar o nome (bootstrap de empresa legada sem equipe
    em `garantirEquipePadrao`; `convidarGestorAdmin` sem `nomeEquipe`), usa-se o NOME DA
    PRÓPRIA EMPRESA — nunca "Equipe Principal" (em empresa pessoal/CPF é o nome da EQUIPE que
    aparece no seletor de contexto, então o genérico fazia o gestor ver "Equipe Principal" no
    lugar da clínica dele). E `criarEquipe` RENOMEIA a equipe inicial em vez de criar uma
    segunda quando ela ainda é a AUTOMÁTICA (nome == nome da empresa, ou "Equipe Principal")
    e está intocada (só o gestor, 0 animais, 0 convites) — senão a empresa ficava com a
    clínica + a equipe automática, e o unique(empresaId, nome) dava 409 quando o gestor
    tentava usar o mesmo nome. O nome é o que distingue automática de escolhida: sem essa
    checagem, TODA equipe nova renomeava a única existente e o gestor perdia a anterior.

36-h. **Módulos só liberam com o cadastro CONFIRMADO PELO PRÓPRIO usuário na empresa
    (migration `20260809000000`).** `UsuarioEmpresa.cadastroConfirmadoEm` (null = pendente)
    é gravado no `PUT /users/me` — isto é, quando a PESSOA salva o Cadastro Pessoal naquela
    empresa. `getMe` devolve `cadastroConfirmado`, e o `SelectedAnimalContext` passou a
    exigir `cadastroConfirmado && phone && endereco && cep` para `cadastroCompleto` (que
    alimenta `isNewUser` → o bloqueio do Sidebar/ProtectedRoute). POR QUÊ: o GESTOR preenche
    telefone e endereço ao incluir o membro, então o cadastro "parecia" completo e a pessoa
    entrava com tudo liberado sem nunca abrir a tela nem conferir o que a clínica preencheu
    por ela. Sem backfill de propósito: cada vínculo (inclusive os existentes) exige a
    confirmação UMA vez, por empresa. Coluna lida/gravada por SQL cru (client Prisma pode
    estar desatualizado — mesmo padrão do `isConvidado`).
    ⚠️ **Empresa do login (sem contexto escolhido) = a PRÓPRIA.** `auth.js` passou a
    procurar primeiro a empresa em que o usuário é dono/GESTOR e só depois o vínculo de
    equipe mais recente. Como `AuthContext.login()` LIMPA a seleção do localStorage, todo
    login entra sem contexto — e o fallback antigo ("mais recente") jogava o dono de
    clínica na empresa alheia em que foi convidado. Com o gate de cadastro sendo POR
    EMPRESA, ele salvava o cadastro na clínica dele e, ao logar, a tela pedia de novo:
    caía na outra empresa, onde de fato não havia confirmação.
    ⚠️ **Sem empresa no contexto, `cadastroConfirmado` é `true`** (e idem quando não há linha
    de vínculo naquela empresa). Não é permissividade: a GRAVAÇÃO também depende de
    `req.empresaId`, então retornar `false` ali criava DEADLOCK — a tela pedia o cadastro,
    o usuário salvava, nada era confirmado e ela pedia de novo. Quem não tem empresa
    resolvida não tem o que confirmar.

36-g. **`fetch` cru NÃO leva o contexto de empresa (2026-07-30).** Só o interceptor do
    axios (`services/api.ts`) injeta `x-empresa-id`/`x-equipe-id`. Chamada escopada por
    empresa feita com `fetch('/api/...')` sai SEM contexto e o backend cai no fallback do
    `auth.js` — `membroEquipe.findFirst({ orderBy: { createdAt: 'desc' } })`, o vínculo MAIS
    RECENTE. Foi o que fazia o Cadastro Pessoal mostrar o cadastro/tipo de OUTRA empresa
    mesmo com `tb_usuario_empresa` correta: `CadastroPessoal` usava `fetch` no GET e no PUT,
    e `AuthContext.fetchMe` (que alimenta `user` no app inteiro) também. Corrigido: a tela
    usa `api.get/put` e o `fetchMe` monta os headers do mesmo `localStorage` que o
    `EmpresaContext` escreve. REGRA: toda chamada escopada por empresa vai por `api`
    (axios); `fetch` cru só para rotas de auth (login, refresh, logout, 2FA, register).
    O `CadastroPessoal` também passou a esperar `useEmpresa().loading` e a recarregar na
    troca de contexto — mesmo gate do `usePermissoes` e do `SelectedAnimalContext`.

36-f. **`UsuarioEmpresa` — tabela de ligação usuário × empresa (migration `20260808000000`).**
    Modelo pedido em 30/07 e implementado: `users` guarda SÓ identidade/autenticação
    (e-mail, senha, refresh token, 2FA, `role`, `ativo` global). O **perfil** do usuário
    naquela empresa e TODO o cadastro dele ali (nome, telefone, cpf/cnpj, endereço, CRMV,
    condição comercial de cliente) vivem em `tb_usuario_empresa`, unique(userId, empresaId).
    Unifica `ProfissionalPerfil` + `ProprietarioPerfil` e acrescenta a coluna `perfil`, que
    antes só existia como `MembroEquipe.cargo` (por EQUIPE) ou como o `users.userType`
    GLOBAL — este último era a origem do vazamento entre clínicas.
    **Remuneração e acesso ao sistema (migration `20260812000002`)** — `tipoPagamento`
    (SALARIO|COMISSAO) + `formaPagamento` (VALOR|PERCENTUAL) + `valorPagamento`, e
    `acessoSistema` (default true). POR EMPRESA, porque o acordo é com cada clínica
    (salário aqui, comissão ali) e o acesso concedido por uma não vale pela outra.
    OBRIGATÓRIOS na inclusão/edição do membro — validação da APLICAÇÃO
    (`normalizarPagamento`); a coluna é nullable para não inventar salário nos vínculos
    legados. O CONVITE (`tb_convites_equipe`) carrega o mesmo acordo e o aplica no
    aceite: sem isso, quem entra por convite (vet/estagiário) nasceria sem remuneração e
    o campo só seria "obrigatório" no caminho da inclusão direta.
    **`acessoSistema = false` impede LOGIN** (`podeAcessarSistema`): barrado em `login`
    (antes do 2FA — não se manda código a quem não pode entrar), `2fa/verificar`, Google
    OAuth e `refresh` (a sessão já aberta morre no próximo refresh). A empresa que
    revogou some do seletor de contexto (`empresasSemAcesso` em `meusContextos`), com o
    DONO sempre preservado — senão ele se trancaria para fora da própria clínica. Sem
    vínculo nenhum (vet autônomo, ADMIN de plataforma) NÃO bloqueia: não há quem tenha
    concedido ou negado nada. Base do futuro controle de usuários por plano.
    **Foto da pessoa (migration `20260814000000`)** — `fotoUrl` (coluna `foto_url`), POR
    EMPRESA pela mesma razão do nome/endereço: o cadastro é da clínica, e trocar a foto
    numa não reescreve o cadastro da outra. Enviada pelo PRÓPRIO usuário em
    `/cadastro-pessoal` (`PUT`/`DELETE /api/users/me/foto`, multipart — rota à parte
    porque `updateMe` é JSON e virar multipart obrigaria a reescrever o payload inteiro
    da tela) e exibida HOJE só em `/equipe` (avatar de 48px que abre a ficha do membro
    com especialidade, local, horário, telefone e e-mail). Lida/gravada por SQL cru
    (`lerFoto`/`lerFotos`/`salvarFoto`/`anexarFotoEmRelacao`) — mesma razão do
    `acessoSistema`. `salvarFoto` devolve a URL ANTERIOR: o arquivo velho só é apagado
    do storage DEPOIS de o banco apontar para o novo — senão uma falha na gravação
    deixaria o cadastro apontando para arquivo que não existe mais.
    ⚠️ SOMENTE LEITURA no Cadastro Pessoal: `getMe` os devolve para conferência e
    `updateMe` não os grava — por construção, `salvarVinculo` só escreve CAMPOS_CADASTRO,
    então nem postando no PUT alguém edita o próprio salário ou se autoconcede acesso.
    ⚠️ As 4 colunas são lidas/gravadas por SQL CRU (`salvarPagamentoEAcesso`,
    `lerPagamentoEAcesso`, `anexarPagamentoEmRelacao`) — passar campo desconhecido ao
    `usuarioEmpresa.upsert` derrubaria a INCLUSÃO DE MEMBRO inteira quando o client
    Prisma está desatualizado (no Windows o `generate` falha com o backend rodando).
    LEITURA/ESCRITA: SEMPRE por `lib/usuarioEmpresa.js` (`perfilDaEmpresa`,
    `aplicarVinculo`/`aplicarVinculoEmLista`/`aplicarVinculoEmRelacao`, `salvarVinculo`,
    `definirPerfil`). NUNCA leia nome/telefone/endereço/documento de `users` numa tela de
    empresa. `resolverTipoNoContexto` lê o `perfil` daqui primeiro (origem `VINCULO`).
    Backfill da migration: vínculos de equipe (perfil = cargo, cadastro do
    ProfissionalPerfil e, na falta, do `users`), cadastros de proprietário, proprietários
    legados que só tinham animal na empresa e donos de empresa sem vínculo (GESTOR).
    ⚠️ As tabelas antigas seguem existindo e são gravadas em paralelo (dual-write) até a
    migração dos leitores terminar — ver PENDENTE abaixo. Não apagar antes disso.
    PENDENTE: `listarMembros`, `ProprietarioController.listar/obter`, `AnimalController` e
    `FaturaController` ainda leem pelos libs antigos (`profissionalPerfil`/
    `proprietarioPerfil`), que apontam para as tabelas legadas mantidas em sincronia.

36-e. **`req.user.userType` é o tipo NA EMPRESA ATIVA, não o do login (2026-07-30).**
    `lib/tipoContexto.js#resolverTipoNoContexto` roda no `authenticate` e sobrescreve
    `req.user.userType`; o valor do token fica em `req.user.userTypeGlobal`. Ordem:
    (1) vínculo de equipe no contexto → `CARGO_PARA_TIPO[cargo]`; (2) sem vínculo mas com
    `ProprietarioPerfil` ativo OU animal ativo na empresa → `PROPRIETARIO`; (3) sem nada →
    `User.userType` (legado/autônomo). ADMIN é global e nunca é reescrito.
    `GET /users/me` devolve `userType` (contexto) + `userTypeGlobal`, e escolhe entre
    `ProprietarioPerfil` e `ProfissionalPerfil` pelo tipo do CONTEXTO.
    É o que permite o mesmo e-mail ser gestora na empresa 1, veterinária na 2, estagiária na
    3 e CLIENTE na 4 — com endereço/telefone próprios em cada uma — mantendo UMA linha em
    `users` (a alternativa, 4 linhas com o mesmo e-mail, exigiria refazer login/2FA/OAuth/
    reset de senha e as 31 chamadas que assumem 1 usuário por e-mail; decisão de 30/07 foi
    NÃO fazer isso). Consequência esperada: quem é VETERINARIO no login mas FORNECEDOR na
    empresa ativa perde ali as ações de vet — é a regra, não bug.
    ⚠️ Guardas de plataforma (ADMIN) devem usar `role`/`userTypeGlobal`, nunca o `userType`
    de contexto.
    ⚠️ **No FRONT, lista/filtro por empresa se decide pelo `cargo` do membro, NUNCA pelo
    `user.userType`** (que é o do login e vale para todas as empresas). Dois casos reais
    corrigidos em 30/07: `ControleAcesso.TabEquipe` filtrava `user.userType !== 'PROPRIETARIO'`
    e SUMIA com a veterinária que é cliente em outra clínica; `Agendamentos` montava a lista de
    quem atende com `user.userType === 'VETERINARIO'`, colocando na agenda a ESTAGIÁRIA daqui
    (veterinária em outra empresa) e deixando de fora a VETERINÁRIA daqui. Só o corte de ADMIN
    continua pelo userType.
    ⚠️⚠️ **No BACK, `SELECT userType FROM users` para decidir ACESSO é sempre bug.** As duas
    libs de escopo de animal liam o tipo GLOBAL do banco em vez do tipo do contexto, e
    quebravam junto (corrigidas em 30/07, com o mesmo `resolverTipoNoContexto`):
    - `lib/animalScope.js#buildAnimalScopeWhere` → o `where` da LISTAGEM virava
      `{ userId }` (só os animais próprios). Usado por Animal/Prescricao/Orcamento/
      Agendamento — 5 controllers.
    - `lib/animalAccess.js#verificarAcessoAnimal` → caía no ramo PROPRIETARIO
      (`animal.userId === userId`) e devolvia **403 em todo paciente que não fosse dele**.
      Usada em 47 call sites de 8 controllers, então derrubava de uma vez o card do
      paciente, histórico, evoluções, prescrições, exames e agendamentos daquele animal.
    Sintoma clássico (relatado como "não carrega o card do animal mesmo com tudo liberado
    no Controle de Acesso"): a LISTA vem cheia mas abrir qualquer animal dá 403 — ou pior,
    a lista vem vazia. Se a matriz está FULL e ainda dá 403, o suspeito é o TIPO usado na
    decisão, não a permissão. `verificarAcessoAnimal` aceita `userType` opcional (passe
    `req.user.userType` quando tiver) e, sem ele, resolve pelo par empresaId/equipeId.

36-c. **"Tipo de usuário" é POR EMPRESA e é o CARGO (2026-07-30).** O identificador
    compartilhado entre empresas é só o E-MAIL (para o seletor de contexto); nome, telefone,
    endereço e tipo são de cada empresa. O tipo dentro da empresa NÃO é o `User.userType`
    global — é `MembroEquipe.cargo`, que o gestor define ao incluir o membro (a mesma pessoa
    é ESTAGIÁRIA numa clínica e VETERINÁRIA na outra). Consequências:
    - `CadastroPessoal`: havendo vínculo no contexto (`cargoEquipe`), o campo "Tipo de
      Usuário" é SOMENTE LEITURA e mostra o rótulo do cargo (`LABEL_CARGO_EQUIPE`). O select
      Proprietário/Médico Veterinário só aparece para cadastro direto, sem equipe. Antes o
      lock valia só para GESTOR/convite, então nas outras empresas o campo virava editável e
      mostrava o `userType` global em vez do cargo.
    - Dados profissionais (CRMV, espécies, especialidade, tempo de consulta) seguem o CARGO:
      `atuaComoVet`/`CARGOS_COM_ESPECIALIDADE` no front, `semEspecialidade` no back. Uma
      estagiária com `userType` VETERINARIO não preenche CRMV.
    - `UserController.updateMe`: quem tem vínculo no contexto ativo NÃO altera o `userType`
      global (body ignorado). Só o DONO da empresa ativa (caso documentado: convidada que
      assinou a aplicação e virou gestora da própria clínica) ou quem não tem vínculo nenhum.
      A regra antiga liberava para dono/gestor de QUALQUER empresa — de dentro da empresa
      onde era estagiária, ela reescrevia o tipo que vale para todas.

36. **Proprietário é isolado por empresa (2026-07-24)** — o cadastro do cliente NÃO mora mais no
    `User`: mora em `ProprietarioPerfil` (uma linha por empresa). NUNCA leia nome/telefone/documento
    /endereço/condição comercial de um proprietário direto do `User` numa tela de clínica — use
    `lib/proprietarioPerfil.js` (`aplicarPerfil` / `aplicarPerfilEmLista` / `aplicarPerfilEmRelacao`)
    com `req.empresaId`; para gravar, `salvarPerfil`/`garantirPerfil`. Escrever no `User` volta a
    vazar a edição de uma clínica para a outra. No `User` só ficam e-mail, senha, userType e o
    `ativo` global (ADMIN).
    - Cliente que já existe no sistema NÃO é mais erro 409 ao ser cadastrado por outra clínica:
      `ProprietarioController.criar` cria só o PERFIL da empresa e responde 201 com `mensagem`.
      `AnimalController.criar` faz o mesmo via `garantirPerfil` ao reaproveitar o login por e-mail.
    - `GET /users/buscar-proprietario` é ESCOPADO à empresa ativa (antes era global e vazava o
      cliente de outra clínica); `GET /animais/buscar-por-nome` não devolve mais `proprietario`.
    - **Portal do proprietário**: `meusContextos` devolve uma opção por empresa que o atende
      (`cargo: 'PROPRIETARIO'`), então o seletor do Sidebar aparece igual ao do vet multi-empresa.
      `auth.js` aceita `x-empresa-id` do proprietário quando ele tem animal ativo OU perfil na
      empresa. As permissões passaram a ser resolvidas pela empresa ATIVA — `getEquipeIdsDoProprietario
      (userId, empresaId)` e `getNivelPermissaoProprietario(userId, slug, empresaId)`, idem
      `minhasPermissoes`. Ou seja: se a empresa A liberou a fatura e a B não, ele vê a fatura só
      enquanto estiver com a empresa A selecionada (antes era união entre TODAS as equipes).

39. **`space-y-*` só separa FILHOS DIRETOS — cuidado ao agrupar itens de menu (2026-07-31).**
    O `<nav>` da Sidebar usava `space-y-4`, mas os itens não são todos filhos diretos: Mapa
    e Cadastro são, enquanto Agendamento, Atendimento, Nutricional etc. moram DENTRO do
    bloco de módulos, que usa `space-y-0.5`. Resultado visível: 16px entre Mapa↔Cadastro e
    Cadastro↔Agendamento, 2px entre Agendamento↔Atendimento. Corrigido com `space-y-0.5`
    no `<nav>` + separação PONTUAL onde ela é intencional (`pt-4` antes de Administração,
    que é cabeçalho de seção; `my-4` no aviso de bloqueio). Ao agrupar itens de mesmo
    nível em wrappers diferentes, o espaçamento tem de vir do item, não do wrapper.

40. **Marca do produto: `backend/uploads/empresas/s2vet-logo.png` (2026-07-31).**
    Mora no MESMO diretório das logomarcas das clínicas (decisão do produto), servido em
    `/uploads/empresas/s2vet-logo.png` — o Vite proxia `/uploads` em dev e o backend serve
    o estático em produção. `backend/uploads/` NÃO é gitignorado: o arquivo é versionado.
    Diferenças propositais em relação às logos de cliente:
    - **Nome FIXO** (o `LocalStorageProvider` gera nome aleatório — capability URL — porque
      logo de cliente é conteúdo de tenant; esta é asset do produto e precisa ser
      referenciável estaticamente por `BrandS2Vet.tsx`).
    - **Não tem linha em `EmpresaConfiguracao.logoUrl`** — não é logo de tenant nenhum.
    - Referenciada por caminho e não por `import` de asset: import quebra o BUILD se o
      arquivo faltar; daqui a ausência é só um 404, tratado pelo `onError` do componente.
    ⚠️ **A arte precisa de margem ZERO.** O PNG entregue vinha com 62% da tela em vazio
    (arte de 1131x529 numa tela de 1536x1024) e SEM canal alfa (colorType 2), com o xadrez
    de transparência RASTERIZADO como pixels (`254,254,254` e `242,242,242` alternados) —
    por isso `sharp().trim()` não cortava nada. Foi reprocessada para RGBA recortada
    (640x299, 1206 kB → 183 kB). Logo com margem embutida parece minúsculo: a altura CSS
    passa a ser a da moldura, não a do desenho.

41. **`tb_empresa_configuracoes` NÃO tem `@map` nas FKs — SQL cru ali precisa de aspas
    (2026-08-01).** Quase toda tabela do schema mapeia `empresaId → empresa_id`; esta não:
    `EmpresaConfiguracao.empresaId`/`equipeId` estão sem `@map`, então as colunas reais
    chamam-se `"empresaId"`/`"equipeId"` em camelCase. No Postgres, identificador sem aspas
    é dobrado para minúsculas, e a query morre com `column "empresa_id" does not exist`
    (foi exatamente o erro ao escrever `lib/validadeOrcamento.js`). Query nova nessa tabela:
    `WHERE "empresaId" = $1 AND "equipeId" IS NULL`. Pelo client tipado o problema não
    aparece — só quem usa `$queryRawUnsafe` esbarra nisso.

37. **Item de fatura tem DESCONTO (2026-07-23) — nunca somar `valor * quantidade`.**
    O total de um FaturaItem é o LÍQUIDO: `valorLiquidoItem(item)` (= valor×qtd − desconto) de
    `lib/faturaUtils.js`; `recalcularTotal(client, faturaId)` já usa isso e é o único caminho
    correto para gravar `Fatura.total`. Qualquer soma nova (relatório, export, tela) precisa
    trazer `descontoTipo`/`descontoValor` no `select` — sem eles o helper devolve o bruto
    silenciosamente. Espelhos no front (mesma fórmula, mantidos em sincronia): `totalItem`/
    `descontoDoItem` em `Faturamento.tsx` e em `utils/FaturaExport.ts`. PERCENTUAL é 0-100 e
    incide sobre o bruto; VALOR é abatimento em R$; o abatimento nunca passa do bruto.
    Entradas do request passam por `normalizarDesconto` (400 em tipo inválido ou % > 100);
    em `atualizarItem` o desconto só é tocado se o body mencionar um dos dois campos — assim
    um PATCH parcial não zera desconto existente.
42. 🔴 **`UPDATE` DE MIGRATION EM TABELA DO TENANT PLANE NÃO AFETA NADA (2026-09-06).**
    As tabelas sob RLS estão com **FORCE ROW LEVEL SECURITY**: a policy vale até para o
    DONO do schema, que é justamente quem roda as migrations (`DATABASE_URL_MIGRATIONS`).
    Sem `app.empresa_id` nem `app.plataforma` carimbados, `(app_plataforma() OR
    empresa_id = app_empresa_id())` é falsa para TODA linha — e o backfill afeta ZERO
    delas, **com sucesso e sem aviso**. `ALTER TABLE` passa (DDL não consulta policy);
    só o DML é filtrado, e é por isso que a migration "funciona" e o dado não aparece.
    Medido em 2026-09-06: o backfill de `20260924000000_cadeia_responsaveis` deixou 2
    evoluções e 14 agendamentos sem semear, e a migration reportou sucesso.
    REGRA: `UPDATE`/`INSERT`/`DELETE` de migration em tabela do tenant plane começa com
    `SELECT set_config('app.plataforma', 'on', true);` — `true` = LOCAL à transação da
    migration, para o carimbo não vazar para a conexão seguinte do pool.
    ⚠️ Migration JÁ APLICADA não se corrige editando o arquivo (o checksum registrado
    passa a divergir e o Prisma acusa "migration alterada depois de aplicada" em todo
    ambiente que já a tem): crie uma migration NOVA só com o backfill — foi o que
    `20260924000001_cadeia_responsaveis_backfill` faz.
    ⚠️ CONFERIR o resultado tem o mesmo problema: um `count(*)` pelo client comum
    devolve 0 por RLS, não por tabela vazia. Compare com `pg_class.reltuples` ou consulte
    dentro de uma transação com o mesmo `set_config`.

```

---

*Este arquivo deve ser mantido atualizado a cada evolução arquitetural significativa.*
*É o contrato vivo entre o time e a arquitetura do S2Vet.*
---

## 14. SEGURANÇA

### Decisões de segurança implementadas
| Item | Decisão | Motivo |
|---|---|---|
| Roteamento | HashRouter (`/#/path`) | Servidor recebe sempre `/`; path fica no fragment, não no request |
| CORS | Lista explícita via `ALLOWED_ORIGINS` env | `cors()` sem config permite qualquer origem — vetor de CSRF |
| JWT_SECRET | Validação no startup (min 32 chars, exit 1 se fraco) | Secret previsível é quebrável por força bruta |
| SQL Injection | Protegido pelo Prisma ORM | Queries parametrizadas — sem `$queryRaw` com interpolação de usuário |
| Headers HTTP | Helmet ativo (`app.use(helmet())`) | CSP, X-Frame-Options, HSTS, etc. |
| Rate limiting | 200 req/min geral · 20 req/15min em /auth | Defesa contra brute force e scraping |
| API keys | `GEMINI_API_KEY` apenas no backend `.env` | Nunca expor no bundle JS do frontend |
| Google Client ID | `VITE_GOOGLE_CLIENT_ID` no frontend — intencional | Client ID é público por design do OAuth |
| Console output | Suprimido em produção via main.tsx (`console.*` → noop quando `!import.meta.env.DEV`) | Não expor stack traces e erros internos ao usuário final |
| 403 silenciosos | GET 403 resolve como `{ data: null }` (não rejeita, não loga) | Evitar ruído de erro para operações bloqueadas por permissão normal |

### CORS — configuração correta
```
// ALLOWED_ORIGINS=https://app.s2vet.com.br,https://www.s2vet.com.br
// Sem config: apenas http://localhost:5173
```

### JWT_SECRET — geração segura
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
O backend RECUSA INICIAR com segredo fraco, e desde 2026-08-25 a checagem não é mais
só de comprimento (`segredoFraco()` em `server.ts`): rejeita também palavra previsível
(o placeholder do `.env.example` é o caso mais comum), menos de 10 caracteres distintos
e repetição longa do mesmo caractere. `trocar-isso-antes-de-producao-123` tem 33
caracteres e passava no teste de tamanho sem ter entropia nenhuma.

⚠️ **`JWT_REFRESH_SECRET` ausente NÃO impede subir** — `lib/sessionTokens.js` deriva
`JWT_SECRET + '_refresh'`. Mas aí os dois deixam de ser INDEPENDENTES: quem obtiver um
deriva o outro numa linha, e o refresh token vale pela janela de inatividade inteira. O
boot emite `[AVISO]` nesse caso (e também quando os dois são iguais). Definir os dois
separadamente é o correto.

POR QUE é crítico: o segredo é a chave HMAC dos tokens (`lib/sessionTokens.js` é a fonte
ÚNICA de assinatura). Quem o descobre FABRICA um token com qualquer `id`/`userType` —
entra como ADMIN de qualquer empresa, sem senha e **sem passar pelo 2FA** (o segundo
fator acontece ANTES de o token ser emitido; token forjado pula a etapa inteira). E o
ataque é OFFLINE: basta capturar um JWT e testar chaves localmente, onde rate limit não
alcança.

⚠️ **A anotação antiga "o valor atual é fraco" foi REMOVIDA em 2026-08-25 por estar
DESATUALIZADA** — o segredo em uso já era 64 caracteres hex (256 bits), exatamente a
saída do comando acima. Alarme falso repetido é como se ensina a ignorar alarme. Para
auditar um segredo configurado sem imprimi-lo:
```bash
node -e "require('dotenv').config();const v=process.env.JWT_SECRET||'';console.log('tam:',v.length,'| distintos:',new Set(v).size,'| hex:',/^[0-9a-f]+$/i.test(v))"
```

### HashRouter — regra de ouro para links de email
```javascript
// SEMPRE usar /#/ antes do path nos links enviados por email
`${appUrl}/#/veterinarios/solicitacoes/aprovar?token=X&acao=aceitar`
`${appUrl}/#/proprietario/aprovar-vinculo?token=X&acao=aceitar`
`${appUrl}/#/reset-password?token=X`
`${appUrl}/#/equipe/convite/${token}`
```

**A mesma regra vale DENTRO do app (corrigido 2026-07-29).** A rota mora no
FRAGMENTO — `window.location.pathname` é sempre `/` e `window.location.search` é
sempre vazio, em qualquer tela. Logo:
```javascript
// Redirect fora do router (interceptor, listener…): sempre com /#/
window.location.href = '/#/login';   // ✅ mesma path → troca de hash, sem reload
window.location.href = '/login';     // ❌ vai para um PATH de servidor
// Ler a rota atual (returnUrl, deep link, etc.): sempre pelo ROUTER
const { pathname, search } = useLocation();  // ✅ rota + query do fragmento
window.location.pathname + window.location.search;  // ❌ devolve "/" sempre
```
Sintoma de ter violado a regra: URL com **path e query reais + `#/rota` no fim**
(ex.: `localhost:5173/login?returnUrl=…&msg=…#/login`). O dev server do Vite faz
fallback de qualquer path para o `index.html`, então a tela até renderiza — mas o
HashRouter só lê o fragmento, o `?query` real fica inerte (`useLocation().search`
vazio) e o parâmetro é silenciosamente ignorado. Foi o que quebrava o retorno
pós-login do link de aprovação de vínculo: `returnUrl`/`msg` viravam `null`, o aviso
não aparecia e o usuário caía na home em vez de voltar ao token.

### Autenticação por cookie HttpOnly (2026-07-10)
```
Tokens em cookies HttpOnly: s2vet_at (access JWT 24h) + s2vet_rt (refresh JWT 30d).
Opções: httpOnly, SameSite=Lax, Secure em produção (COOKIE_SECURE força), path=/.
Helper: lib/authCookies.js (setAuthCookies/clearAuthCookies/getAccessTokenFromCookie/
getRefreshTokenFromCookie — parser próprio, sem cookie-parser; res.cookie nativo).
Backend: auth.js lê cookie PRIMEIRO, header Authorization é fallback (clientes não-navegador).
  Login/register(login)/Google/refresh setam cookies; logout limpa; updateMe renova o access.
  refreshTokenRules virou opcional (refresh vem do cookie); refreshToken controller lê cookie||body.
Frontend: api.ts com withCredentials:true, SEM Authorization e SEM token em storage;
  refresh via POST /auth/refresh {} (cookie). AuthContext: identidade vem de /api/users/me
  (não decodifica token); login()→/me; logout()→/auth/logout; authFetch usa credentials:'include'.
  Login/Register/CadastroPessoal: fetch com credentials:'include', chamam login() sem token.
  /me passou a retornar `role`. NUNCA voltar a ler token em JS nem usar sessionStorage p/ token.
```

### trust proxy + IP na auditoria (2026-07-10)
```
server.ts: app.set('trust proxy', TRUST_PROXY_HOPS ?? 1) — resolve req.ip real atrás do
proxy (Cloudflare Tunnel/reverse proxy) E elimina o ValidationError do express-rate-limit
(X-Forwarded-For). NÃO usar `true` (permissivo — flagged pelo rate-limit); usar Nº de hops.
AuditLog.ip (migration 20260710000004): login/logout (AuditController.registrar via SQL) e
exclusões/cancelamentos (lib/auditoria.js — ipDoRequest(req), normaliza ::ffff:). IP sempre
do req (nunca do body). Tela AuditoriaGeral.tsx exibe coluna IP.
```

### 2FA por e-mail no login (2026-07-28)
```
Migration 20260802000000. users.mfa_ativo (default true) + tb_mfa_desafios.
Fluxo: POST /auth/login (senha OK) → NÃO emite cookie → cria desafio, envia código
       → 200 { mfaRequerido: true, desafioId, emailMascarado, validadeMinutos }
       → POST /auth/2fa/verificar { desafioId, codigo } → aí sim emite a sessão
       → POST /auth/2fa/reenviar { desafioId } (novo código, renova a janela)
```
`emitirSessao(res, user)` em `auth/UserController.js` é o **ponto único** de nascimento
de sessão por senha (login sem 2FA e verificação do 2º fator). Não duplicar.

Regras (`services/mfaService.js`):
- Código de 6 dígitos por `crypto.randomInt` (CSPRNG). **Nunca** `Math.random` para OTP.
- Persistido só como **SHA-256**; comparação com `timingSafeEqual`.
- 10 min de validade · 5 tentativas · 3 reenvios · `desafioId` opaco (32 bytes) que
  não revela o usuário. Criar desafio novo INVALIDA os anteriores do usuário.
- Erros são genéricos ("Código inválido.") — não dá para distinguir código errado de
  desafio inexistente, nem enumerar usuário.
- `ativo` é revalidado na verificação: conta desativada entre a senha e o código não entra.
- Rate limit por IP nas rotas: 10/5min em `/2fa/verificar`, 3/10min em `/2fa/reenviar`.
- Falha ao enviar o e-mail → **503 e nenhuma sessão** (não existe fallback que pule o fator).
- Cron `limpeza_desafios_2fa` (04:15) remove desafios vencidos/consumidos com +24h.

**Google OAuth NÃO passa por 2FA de e-mail** — o Google já autenticou e aplica o 2FA
da própria conta; somar um OTP em cima disso é atrito sem ganho.

**Chave mestra do ADMIN** (migration `20260803000000`) — `ConfiguracaoSeguranca`
(`tb_configuracao_seguranca`, linha única id=1, CHECK trava o id). Ordem de resolução
em `mfaService.exigeMfa()` (que é **async** — sempre `await`):
```
1. MFA_EMAIL_ENABLED=false no .env  → OFF (kill-switch de emergência, vence tudo)
2. ConfiguracaoSeguranca.mfaEmailAtivo → seletor do ADMIN em /configuracoes
3. User.mfaAtivo                    → exceção por usuário
```
Cache de 30s no valor global (o login não paga um SELECT por tentativa);
`invalidarCacheGlobal()` zera na hora ao salvar. Banco fora do ar → mantém o último
valor conhecido; sem valor conhecido, fica DESLIGADO (não trancar a base fora).
**Estado entregue: DESATIVADO** (default `false` na migration).

Rotas `GET/PUT /api/seguranca/config` (`authorize('ADMIN')`). Front:
`components/CardSegurancaAdmin.tsx` em **`ConfiguracaoAlerta.tsx`** (rota
`/configuracao-alertas`, Sidebar > Geral > "Configuração", ADMIN) — salva SOZINHO,
fora do form de alertas, porque é config global da plataforma e não da clínica.
⚠️ NÃO colocar em `Configuracoes.tsx`: **o ADMIN não alcança aquela tela**.
`usePermissoes` faz `precisaCarregar = user && !isAdminUser` — para ADMIN o hook nem
chama o backend e deixa `isGestor = false`, então o link do Sidebar (`{isGestor &&}`)
some e o guard da página barra o ADMIN. Por isso o Sidebar usa `(isGestor || isAdmin)`
onde o ADMIN também precisa entrar. Para gates de ADMIN use o `role`/`userType` do
`useAuth`, nunca o `isGestor` do `usePermissoes`.
Na tela hospedeira, `isAdmin` inclui GESTOR — o card usa `isAdminPlataforma`
(role/userType estritos) para o gestor não ver o seletor global. Quando o kill-switch de ambiente está ativo,
o toggle aparece desabilitado com aviso de que não tem efeito.
Ligar/desligar gera AuditLog categoria `CONFIGURACAO` (categoria nova em
`lib/auditoria.js`, com badge e filtro próprios em `AuditoriaGeral.tsx`).

**Kill-switch**: `MFA_EMAIL_ENABLED=false` desliga globalmente sem migration (usar se o
SMTP cair). Por usuário: `UPDATE schs2vet.users SET mfa_ativo = false WHERE id = <id>;`
⚠️ A tabela do usuário é `users` (NÃO `tb_users`) — atenção ao escrever migration.

Front: `components/Verificacao2FA.tsx` (auto-submete aos 6 dígitos, reenvio com espera
de 45s, `autoComplete="one-time-code"` para o preenchimento automático do SO).

### Tela de senha é UMA SÓ — `components/FormularioNovaSenha.tsx` (2026-08-04)

O formulário de definição de senha é compartilhado por **duas** telas:
```
AlterarSenhaObrigatoria  → dentro da app (primeiro acesso / senha temporária)
ResetPassword            → link do e-mail (/#/reset-password?token=...)
```
Antes eram implementações separadas: a do e-mail tinha fundo escuro, emoji (🙈/👁️) no
lugar dos ícones lucide e só revelava os requisitos DEPOIS de o envio falhar — quem
chegava pelo link achava que tinha caído em outro sistema. As regras (`REGRAS_SENHA`), o
checklist ao vivo, o indicador de "as senhas coincidem" e o `InlineError` moram no
componente; tela nova de senha usa ele, não copia.

⚠️ **O que NÃO é compartilhado é a CREDENCIAL, e isso é deliberado:**
```
na aplicação → SESSÃO ativa  → PATCH /users/me/senha
no e-mail    → TOKEN do link → POST  /api/auth/reset-password
```
Não se pede a senha ANTIGA no fluxo do e-mail: quem esqueceu não a tem. Quem prova a
identidade ali é o token — uso único, com prazo, conferido contra
`resetPasswordToken`/`resetPasswordExpires`. Reaproveitar a interface não afrouxa nada;
reaproveitar a checagem de credencial, sim. `ResetPassword` sem `token` na URL mostra
"Link inválido" em vez de um formulário que só falharia no envio.

### "Esqueci minha senha" volta sozinho para o login (2026-08-04)

`ForgotPassword` mostra a confirmação e redireciona para `/login?msg=reset_link_enviado`
(4s), onde o `Login` repete o aviso num banner. Antes a tela parava num card com link
manual e o usuário não sabia que já podia sair dali.

⚠️ **A mensagem é a MESMA exista ou não o e-mail.** O backend responde 200 genérico
(`respostaGenerica` em `AuthController.forgotPassword`) e o banner do login diz "se
houver uma conta com o e-mail informado". NUNCA "melhorar" isso avisando que o e-mail
não foi encontrado: transformaria a tela num verificador de cadastro (enumeração de
usuário) — mesma razão pela qual o login diz "Usuário ou Senha Inválidos" nos dois casos.

### Senha é da PESSOA — ninguém a troca POR ela (2026-08-04)
```
Próprio usuário → PATCH /users/me/senha  +  "Nova senha" ao editar a SI MESMO (Equipe)
                  + "esqueci minha senha"
Conta nova      → padrão Inicial_001 + mustChangePassword no primeiro acesso
ADMIN da plataforma / GESTOR / qualquer outro → NÃO trocam a senha de ninguém pela tela
```
⚠️ **O campo de senha foi RETIRADO do módulo Usuários (`/usuarios`, tela ADMIN-only)** —
`permitirSenha` não é mais passado ali, o `payload.senha` saiu do submit e o estado
`erroSenha` foi removido junto (sem o campo na tela, o erro desviado para ele sumiria).
Não reintroduzir. Em `Equipe.tsx` o campo permanece, mas SÓ na auto-edição
(`membroEditando.user.id === user?.id`).
A rota `PUT /users/:id` (authorize('ADMIN')) ainda ACEITA `senha` no corpo — o que mudou
foi a interface, não o contrato. Se a intenção for fechar também o backend, é ali que se
mexe; hoje nenhuma tela envia o campo.
Regra que NÃO mudou: `EquipeController.atualizarMembro` e
`ProprietarioController.atualizar` respondem **403** para troca de senha por terceiros, e
`adicionarMembro` ignora `senha` do body.
O gestor administra a EQUIPE, não a credencial de quem está nela: quem esqueceu usa
"esqueci minha senha" e conta nova nasce com a padrão `Inicial_001` + troca obrigatória
no primeiro acesso. Enforcement: `EquipeController.atualizarMembro` (PUT
/equipes/membros/:id) e `ProprietarioController.atualizar` (PUT
/cadastro/proprietarios/:id) respondem **403** se vier `senha` de quem não é ADMIN nem o
dono da conta; `EquipeController.adicionarMembro` ignora `senha` do body.
Frontend: `UsuarioFormModal.permitirSenha` só pode ser `true` para o PRÓPRIO dono da conta
— `Equipe.tsx` passa `membroEditando.user.id === user?.id` (antes era `isGestor`, que
deixava o gestor trocar a senha do membro). `Usuarios.tsx` NÃO passa mais a prop
(retirado em 2026-08-04 — ver o bloco acima).

### Pendências de segurança (futuro)
- [x] Migrar tokens para HttpOnly Cookies (feito 2026-07-10)
- [ ] Vincular acesso à mídia (uploads) à sessão via cookie (capability URL ainda é o único gate)
- [ ] UUIDs em vez de IDs sequenciais (dificulta enumeração via URL)
- [x] ~~Renovar JWT_SECRET antes de produção~~ — já é 64 chars hex (256 bits). O que FALTA é definir `JWT_REFRESH_SECRET` próprio (hoje é derivado do JWT_SECRET; o boot avisa)
- [ ] Configurar ALLOWED_ORIGINS com domínio real em produção
- [ ] Definir COOKIE_SECURE=true e TRUST_PROXY_HOPS conforme a topologia de proxy em produção
- [ ] 2FA: "lembrar este dispositivo" por 30 dias (hoje o código é pedido em todo login)

### Varredura de segurança — 2026-06-11 (CORRIGIDA)

> Auditoria de código. SQL injection: **sem vetor** — todas as queries raw
> (`$queryRawUnsafe`/`$executeRawUnsafe` em PermissaoService, UserController,
> EquipeController, scripts) usam placeholders parametrizados (`$1`, `$2`…), nenhuma
> interpolação de input do usuário. Defesas confirmadas ativas: JWT_SECRET validado no
> startup (≥32), Helmet, CORS allowlist, rate limit (200/min + 20/15min em /auth), bcrypt,
> login Google valida access_token server-side (GoogleController), conta desativada
> rejeitada em todo request autenticado. Sem `child_process`/`eval`.

Todos os 7 achados foram tratados (commit de segurança 2026-06-11). Resumo do que foi feito:

| # | Severidade | Status | O que foi feito |
|---|---|---|---|
| 1 | **ALTA** | ✅ Mitigado | `/uploads` (server.ts) endurecido: `dotfiles:'deny'`, `index:false`, `X-Content-Type-Options:nosniff`, CSP `default-src 'none'; sandbox`, e `Content-Disposition: attachment` para extensões fora da whitelist de mídia. Nomes de arquivo agora gerados com `crypto.randomBytes` (capability URL não-enumerável) em `routes/evolucao.js` e `LocalStorageProvider`. **Residual:** acesso ainda não é vinculado à sessão (img/video direto não envia Authorization) — auth de sessão por mídia depende da migração para HttpOnly cookie (ver pendência acima). |
| 2 | **MÉDIA** | ✅ Corrigido | XSS armazenado fechado: `fileFilter` em `routes/evolucao.js` agora valida **mimetype E extensão** (whitelist `MIDIA_EXT_PERMITIDAS`/`MIDIA_MIME_PERMITIDOS`, SVG/HTML rejeitados); nome final nunca usa `originalname`; servido com nosniff + CSP sandbox + attachment. `routes/animais.js` já validava ext+mime. |
| 3 | **MÉDIA** | ✅ Corrigido | `userType` no registro restrito a PROPRIETARIO/VETERINARIO em **dois pontos**: `auth.validators.js` (`registerRules` — removidos ESTAGIARIO/ADMIN) e `auth/UserController.register` (`userTypeSeguro`, fallback PROPRIETARIO). |
| 4 | BAIXA | ✅ Corrigido | `AuthController.forgotPassword` responde **sempre 200 genérico** ("se houver conta, enviaremos o link"), inclusive em erro interno. Frontend (`ForgotPassword.tsx`) usa `res.ok` → continua funcionando. |
| 5 | BAIXA | ✅ Corrigido | Refresh token virou **JWT assinado com expiração 30d** (`generateRefreshToken(userId)` em AuthController/auth.UserController/GoogleController; `REFRESH_SECRET = JWT_REFRESH_SECRET ?? JWT_SECRET+'_refresh'`). `AuthController.refreshToken` faz `jwt.verify` antes do lookup e casa `id`. **Cabe na coluna `refreshToken VarChar(512)` — sem migração.** Tokens legados (hex) falham o verify → cliente refaz login uma vez. |
| 6 | INFO | ✅ Removido | Método morto `AuthController.googleLogin` (confiava no e-mail do body) removido; comentário alerta para não reintroduzir. Rota `/google` usa só o `GoogleController` validado. |
| 7 | INFO | ✅ Corrigido | `AuthController.resetPassword` ganhou guard de comprimento (≥8) além do já existente em `resetPasswordRules`. |

> Observação não-segurança (NÃO alterada): CORS `allowedHeaders` (server.ts) não inclui `x-empresa-id`/`x-equipe-id` — pode quebrar preflight cross-origin do seletor de contexto em produção. Adicionar quando for para deploy cross-origin.
>
> **Variáveis de ambiente novas (opcional):** `JWT_REFRESH_SECRET` — se não definida, deriva de `JWT_SECRET + '_refresh'` (não quebra nada; defina em produção para isolar os segredos).

