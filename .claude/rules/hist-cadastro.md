---
paths:
  - "**/*Animal*"
  - "**/*Proprietario*"
  - "**/*Prestador*"
  - "**/*Fornecedor*"
  - "**/*Tratador*"
  - "**/*Localizacao*"
  - "**/*Equipe*"
  - "**/*Procedimento*"
  - "**/*Especialidade*"
  - "**/*Catalogo*"
  - "**/catalogo*.js"
  - "**/duplicidadeAnimal.js"
  - "**/proprietarioPerfil.js"
  - "**/profissionalPerfil.js"
  - "**/usuarioEmpresa.js"
  - "**/Cadastro*.tsx"
  - "**/*Membro*"
  - "**/donoAtivoDoPaciente.js"
  - "**/visibilidade.js"
  - "**/*Especie*"
  - "**/*Raca*"
---

# Histórico de decisões — Cadastro (paciente, cliente, equipe, catalogo)

> Arquivo de HISTÓRICO, carregado automaticamente quando você toca um arquivo que casa com
> os `paths` acima. Cada bloco é uma sessão de trabalho, na redação original — o resumo
> (`# Atualizado em:`) e, quando existe, o detalhe (`### Sessão`) logo abaixo.
>
> **Os ⚠️ e 🔴 aqui são REGRA VIGENTE, não curiosidade histórica.** O projeto documenta
> deliberadamente as decisões que quebram EM SILÊNCIO quando alguém as desfaz sem saber.
> Antes de reverter algo que este arquivo marca com ⚠️/🔴, leia o motivo registrado.

As regras permanentes (arquitetura, RBAC, padrões, armadilhas numeradas) estão em `CLAUDE.md`.

---

# Atualizado em: 2026-09-23 (parte 2) (**LEVA DE AJUSTES NOS CADASTROS** — 4 pedidos.
#   O que muda regra, e não só rótulo:
#   1. 🔴 **EXCLUIR PROCEDIMENTO DA CLÍNICA — e SÓ o que nunca foi usado.**
#      `DELETE /procedimentos/cadastro/proprio/:id` (`excluirProprio`), com o MESMO
#      slug do inativar (`cadastro.procedimento.deletar`): são as duas formas de tirar
#      o cadastro da frente, e separá-las faria o gestor configurar duas permissões
#      para uma decisão só — além do absurdo de quem pode APAGAR não poder inativar.
#      ⚠️ **NÃO substitui o inativar, e a tela oferece os dois.** Usado uma vez, o
#      cadastro deixa de ser excluível PARA SEMPRE; sem o soft delete não haveria como
#      tirá-lo da lista. A exclusão é a saída para o erro de digitação recém-cadastrado,
#      que hoje ficava eternamente na aba "Inativos".
#      🔴 **A LIGAÇÃO COM O USO É PELO NOME, NÃO POR FK.** `tb_prescricoes` guarda o
#      procedimento em `medicamento` (texto) com `tipo = 'PROCEDIMENTO'`, e o ledger do
#      recibo em `procedimento_nome` — nenhuma das duas tem `procedimento_id`. Como o
#      banco não tem FK para recusar, o `DELETE` PASSARIA e o prontuário ficaria
#      apontando para um cadastro inexistente: nada quebra na hora, e o buraco só
#      aparece quando alguém abre um atendimento antigo. `usosDoProcedimento` consulta
#      QUATRO origens — prescrição/evolução, item de orçamento (`refId` OU descrição),
#      combo da clínica e execução já lançada — e responde **409
#      `PROCEDIMENTO_EM_USO`** dizendo ONDE e apontando o inativar como saída.
#      ⚠️ **O combo entra na conta porque `tb_procedimento_combo_itens` é
#      `onDelete: Cascade`**: sem a checagem, excluir o procedimento ESVAZIARIA o
#      pacote de alguém em silêncio.
#      ⚠️ **Prescrição CANCELADA ou soft-deletada CONTA.** A pergunta é "este nome já
#      apareceu num prontuário?", não "ainda está ativo".
#      ⚠️ O ledger do prestador é lido por **SQL CRU e atrás de
#      `procedimentoPrestador.temTabelas()`**: a tabela nasceu numa migration que pode
#      não estar aplicada e, pelo client tipado, uma base defasada derrubaria a
#      checagem inteira com 500 — e ninguém saberia que o uso não foi conferido.
#      ⚠️ Linha GLOBAL responde 400 `ITEM_DO_SISTEMA`: vale para todas as clínicas e o
#      RLS recusaria de qualquer forma, virando um 500 sem explicação.
#      ⚠️ `motivo` obrigatório e **auditoria `EXCLUSAO` ANTES do `delete`, na MESMA
#      transação** (armadilha 33): a linha some do catálogo, então o rastro é o único
#      lugar onde ela continua existindo.
#      ⚠️ O erro da recusa é mostrado **DENTRO do `ModalJustificativa`** (§6): no topo
#      da página ficaria atrás do overlay, e o clique pareceria não ter feito nada.
#      Gate: `__tests__/procedimentoExclusaoSemUso.test.js` (verificado que reprova).
#   2. **E-MAIL DEIXOU DE SER OBRIGATÓRIO no "Novo Fornecedor" rápido**
#      (`ModalNovoFornecedor`, aberto pela Farmácia e pelo Estoque de Vacinas). A tela
#      `/cadastro/fornecedores` NUNCA o exigiu — era o modal que divergia dela, e o
#      fornecedor de balcão muitas vezes não tem e-mail. ⚠️ Preenchido, continua tendo
#      de ser VÁLIDO: o que saiu foi a exigência, não a validação.
#   3. **"Novo Proprietário" ganhou o ícone da entidade** (`Users`, 16px) à esquerda do
#      rótulo — era o único botão de Cadastro sem ele (Fornecedor, Prestador e Tratador
#      já seguiam o padrão).
#   4. **O botão "Novo Paciente" trocou a PATA pelo RAIO** (`Zap`), que é o ícone com
#      que o menu lateral chama a tela e com que o título dela se anuncia. A pata tinha
#      entrado no commit anterior e deixava o mesmo assunto com dois símbolos na mesma
#      tela.)

# Atualizado em: 2026-09-22 (parte 2) (**LEVA DE AJUSTES DE TELA NOS CADASTROS** — 9
#   pedidos, todos em Cadastro. O que muda regra, e não só rótulo:
#   1. 🔴 **RAÇA E PELAGEM SE COMPLETAM SOZINHAS AO SAIR DO CAMPO.** O `buscavel` do
#      `DropdownSelect` (2026-09-18) já filtrava ao digitar, mas o blur DESCARTAVA o
#      texto: quem digitava "manga", via a lista reduzir a uma única raça e saía com
#      Tab ficava com o campo **VAZIO**, sem nada explicando. Agora `resolverDigitado`
#      aceita o texto quando ele designa UMA opção — igualdade exata (sem acento/
#      caixa), depois o único que COMEÇA com o termo, depois o único que o CONTÉM.
#      ⚠️ **O valor continua saindo SEMPRE do catálogo.** Texto ambíguo (dois
#      candidatos) ou desconhecido segue sendo descartado: o chamador converte
#      nome → id casando pelo nome EXATO, e aceitar o resto gravaria id nulo em
#      silêncio — que é a razão original de o blur descartar.
#      ⚠️ A ordem não é acidental: a igualdade exata vence tudo, senão quem digitou o
#      nome inteiro de uma raça que é PREFIXO de outra seria levado para a errada.
#   2. **CADASTRADO NA FEI** — `Animal.registradoFei` (migration `20261016000000`,
#      coluna `registrado_fei BOOLEAN NOT NULL DEFAULT false`).
#      🔴 **MIGRATION GERADA, NÃO APLICADA.** Aditiva e SEM backfill: `false` é a
#      verdade de toda base existente. Aplicar com
#      `DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy` + `generate`.
#      ⚠️ **Funciona ANTES do `generate`**: leitura/escrita por `lib/animalFei.js`
#      (SQL cru com guarda de existência da coluna, padrão de `usuarioEmpresa.js`).
#      Passar `registradoFei` para `prisma.animal.create` com o client desatualizado
#      não erraria só o campo — derrubaria o CADASTRO DE PACIENTE inteiro. Sem a
#      migration, o campo aparece, não grava nada e nada quebra.
#      ⚠️ **NÃO é texto dentro de `registro_passaporte`**: aquele guarda o NÚMERO do
#      registro e é livre; "está na FEI" precisa ser filtrável, e procurá-lo lá dentro
#      viraria `LIKE '%fei%'`.
#      ⚠️ Tenancy: `tb_animais` já está sob RLS tenant-direto e o `ALTER TABLE` não
#      toca policy nenhuma — a coluna nasce protegida como as demais.
#   3. **SAIU O ÚLTIMO AVISO SOBRE O E-MAIL DE ACESSO** no cadastro do paciente (a
#      faixa azul "Se o e-mail ainda não estiver cadastrado, será encaminhado e-mail
#      com as informações de acesso…"), completando a remoção começada em 2026-09-18.
#      Só o AVISO — o comportamento é o mesmo: cliente novo nasce com login e recebe o
#      e-mail de boas-vindas. A faixa de cadastro ENCONTRADO
#      (`AvisoCadastroEncontrado`) FICA: ali há decisão a tomar.
#   4. **DIÁRIA na forma de pagamento do membro** (`TIPOS_PAGAMENTO` em
#      `lib/usuarioEmpresa.js` += `DIARIA`). Paga-se UM DIA, e o total sai da
#      multiplicação pelos DIAS DE TRABALHO dos locais cadastrados.
#      ⚠️ **DIÁRIA é SEMPRE em R$** (`FORMAS_POR_TIPO`): "50% de diária" não designa
#      quantia nenhuma. O seletor R$/% fica TRAVADO nesse tipo — deixá-lo escolher
#      para depois o backend recusar é a armadilha 28-d.
#      ⚠️ **O que vai ao banco é o valor do DIA, não o total.** A conta aparece no
#      formulário (`R$ 150,00 × 5 dias = R$ 750,00 por semana`) para o gestor conferir
#      o acordo antes de salvar; gravar o produto congelaria a conta e faria o acordo
#      mentir assim que os dias de trabalho mudassem.
#      ⚠️ `diasDeTrabalhoNaSemana` conta dia DISTINTO, não entrada por local: quem
#      atende segunda no Haras A e segunda no Haras B trabalhou UM dia — somar dois
#      pagaria a diária em dobro por um dia só.
#      ⚠️ Não existe apuração de folha de MEMBRO no sistema (só `RecibosPrestador`,
#      que é de prestador): por ora a multiplicação vive na tela do cadastro.
#   5. **PRODUTOS: "Excluir" virou a CHAVE ativar/inativar.** O botão antigo já fazia
#      soft delete — o rótulo prometia remoção e **não havia caminho de volta**:
#      inativado, o produto sumia para sempre. Rota nova
#      `PATCH /cadastro/produtos/:id/toggle` (`ProdutoController.toggleAtivo`), trio
#      Todos/Ativos/Inativos na busca e selo "inativo" na linha.
#      ⚠️ Mesmo slug do `deletar` (`cadastro.produto.deletar`): inativar É a exclusão
#      lógica deste cadastro, e quem pode tirá-lo da frente é quem pode trazê-lo de
#      volta — slug novo faria o gestor configurar duas permissões para um par que é um.
#      ⚠️ Inativar exige motivo e grava `INATIVACAO`; ativar vai direto (armadilha 33).
#      Entrada nova no gate `__tests__/inativacaoJustificada.test.js` e rótulo
#      `PRODUTO` em `ENTIDADE_LABEL` (sem ele a coluna mostra o identificador cru).
#      ⚠️ `ProdutoController.excluir` FICOU SEM ENTRADA NA UI — segue montado e
#      funcional; ver a nota no próprio controller.
#   6. **PRODUTOS: a lista voltou a ser rolável até o fim.** Eram DUAS causas somadas:
#      a janela mostrava 5 itens (agora 12) e o backend cortava em 60/100 (agora
#      `LIMITE = 300`, com `total` na resposta e a linha "Mostrando N de M — refine a
#      busca"). ⚠️ O teto CONTINUA existindo de propósito: o catálogo GLOBAL tem
#      milhares de linhas. O que mudou é que agora o corte se ANUNCIA — antes era
#      indistinguível do fim do catálogo, que era exatamente a queixa.
#      ⚠️ O teste `produtoMultidose.test.js` travava o literal `take: busca ? 100 : 60`;
#      passou a travar a EXISTÊNCIA do corte (`take: LIMITE`), senão todo ajuste de
#      teto vira teste vermelho sem defeito por trás.
#   7. **Rótulos e ícones** — "Novo Cadastro" (idêntico em Prestador e Fornecedor)
#      virou **Novo Prestador** / **Novo Fornecedor**; "Novo produto" virou **Novo
#      Produto**; **Incluir Membro** virou **Novo Membro** (Equipe). Todos com o ícone
#      da ENTIDADE à esquerda, no padrão do envelope do "Incluir Membro"
#      (`PawPrint` paciente · `HardHat` prestador · `Truck` fornecedor · `Package`
#      produto). ⚠️ O envelope do membro FICA: o cadastro dispara o e-mail de
#      boas-vindas com o acesso, e é isso que ele anuncia — não é decoração.
#   8. **Saiu o ícone "i" (e a faixa azul de regras)** de Tratador, Proprietário e
#      Localização, com o estado `showInfo` junto — estado sem leitor reprova no
#      `tsc` (TS6133). ⚠️ As regras que a faixa listava continuam valendo e vivem
#      neste histórico e no CLAUDE.md; o que saiu foi a repetição na tela.
#   9. **Saiu a linha "Medicamentos e vacinas da clínica — forma, apresentação…"** do
#      topo de Produtos: as abas logo abaixo já dizem Medicamentos × Vacinas e a lista
#      mostra as colunas que ela enumerava.
#   Suíte: **1267 passando**; `tsc --noEmit` (backend), `tsc -b` e `vite build` limpos.
#   ⚠️ NÃO verificado em navegador — sem ferramenta de browser nesta sessão.)

---

# Atualizado em: 2026-09-22 (🔴 **INATIVAR PASSOU A EXIGIR JUSTIFICATIVA EM TODO
#   CADASTRO — e a (in)ativação sumia dos relatórios por causa da CATEGORIA.**
#   1. 🔴 **A PREMISSA (a pedido): "o inativar precisa ser justificado e incluído na
#      auditoria".** Ela já valia em Fornecedor, Prestador, Tratador, Estoque de
#      Farmácia, Estoque de Vacina, Combo de procedimento e Membro de equipe — e
#      **não valia em cinco lugares**, todos passando direto, sem modal e sem rastro:
#      · `LocalizacaoAnimalController.toggleAtivo` — auditava, mas sem `motivo`;
#      · `ProprietarioController.toggleAtivo` (caminho do ADMIN, acesso GLOBAL do
#        cliente) — auditava sem motivo;
#      · `VacinaAdminController.toggleVacina` — **nem motivo nem auditoria**, e é o
#        CATÁLOGO GLOBAL: inativar ali retira a vacina de TODAS as clínicas;
#      · `VacinaAdminController.inativarLote` — idem, e o lote sai da fila FEFO;
#      · `UserAdminController.toggleAtivo` — **nem motivo nem auditoria**, sendo a
#        inativação MAIS FORTE do sistema (fecha o login em todas as empresas e zera
#        o `refreshToken`);
#      · `PlanoController.toggle` — idem, e tira o plano da oferta da plataforma.
#      ⚠️ **ATIVAR continua SEM justificativa**, de propósito: reativar é ato de
#      correção e pedir motivo ali é só atrito. A exceção deliberada segue sendo
#      `EquipeController.toggleMembro`, que pede nos DOIS sentidos — devolver acesso
#      a uma pessoa é a decisão mais sensível das duas (razão registrada lá, 2026-09-04).
#   2. 🔴 **A CATEGORIA ERA O SEGUNDO DEFEITO, e este era invisível.** Estoque de
#      Farmácia, Estoque de Vacina, Combo de procedimento e Localização gravavam
#      `categoria: 'ALTERACAO'`. Como a ação exibida é `${categoria} ${entidade}` e os
#      Relatórios de Cadastro recortam por INATIVACAO/ATIVACAO, a inativação existia
#      no banco e **não aparecia em nenhum recorte de "quem foi inativado"** — o mesmo
#      defeito que o CLIENTE teve até 2026-09-08. Agora os quatro gravam
#      `vaiInativar ? 'INATIVACAO' : 'ATIVACAO'`.
#      ⚠️ Linha JÁ GRAVADA continua ALTERACAO — o AuditLog é um LEDGER IMUTÁVEL. O
#      relatório só enxerga o que for inativado daqui em diante.
#   3. **Entidades novas na trilha** (`AuditoriaGeral.tsx`, `ENTIDADE_LABEL`):
#      `VACINA_CATALOGO`, `PROCEDIMENTO_COMBO` e `PLANO`. Sem o rótulo, a coluna
#      "Entidade" mostra o identificador cru — legível para quem escreveu o código,
#      não para o gestor.
#   4. ✅ **GATE ESTRUTURAL: `__tests__/inativacaoJustificada.test.js`** (55 casos,
#      verificado que REPROVA — removida a validação de um único toggle, ele falha).
#      Varre os 13 pontos de inativação e exige, em cada um: leitura de `motivo`,
#      recusa 400 sem ele, chamada a `registrarAuditoria`, categoria INATIVACAO (e
#      **proíbe** `categoria: 'ALTERACAO'`), o motivo CHEGANDO à linha da auditoria
#      (validar e não gravar é o pior dos mundos) e o rótulo da entidade existindo na
#      tela. Ele existe porque a falha aqui é SILENCIOSA nos dois sentidos: nada
#      quebra, a tela funciona, e a trilha só não tem aquelas linhas — foi assim que
#      esses cinco ficaram de fora por meses.
#   5. **Front:** `ModalJustificativa` (o modal padrão) em `CadastroLocalizacao`,
#      `CadastroVacina` (vacina e lote), `Usuarios` e `PlanosAdmin`. No `CadastroVacina`
#      o `ConfirmModal` do lote DEU LUGAR ao `ModalJustificativa` — confirmação simples
#      não coleta o motivo que o backend agora exige, e o botão que só falha depois do
#      clique é a armadilha 28-d.
#   6. **Telas de Cadastro — cabeçalho da lista FIXO e rótulo padronizado.** Ver o
#      detalhe em `hist-ui.md` (a mudança é do `JanelaLista`, que é o componente).
#      Aqui ficou o que é de cadastro: as 6 telas que ainda não tinham janela passaram
#      a ter (Proprietário, Localização, Tratador, Prestador, Fornecedor, Procedimento)
#      e os rótulos com caixa divergente foram normalizados para "Primeira maiúscula"
#      ("Local de Trabalho" → "Local de trabalho", "Tipos de Serviço" → "Tipos de
#      serviço", "Valor Cliente" → "Valor cliente").)

---

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
---

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

---

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
---

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

---

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
---

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

---

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

---

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
---

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

---

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
---

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
---

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

---

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
---

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

---

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
---

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

---

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
---

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

---

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

---

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
---

# Atualizado em: 2026-09-02 (parte 2) (`podeVerMedicamentos`/`podeVerProcedimentos`
#   da Sidebar — decisão de produto que estava em aberto desde 2026-07-31 —
#   RESOLVIDA: assumido ADMIN-only, as duas variáveis mortas foram removidas.
#   Ver a entrada da sessão 2026-07-31, marcada concluída.)
---

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

---

# Atualizado em: 2026-08-21 (Prestador: cadastro NOVO e INDEPENDENTE de Fornecedor —
#   tb_prestadores própria, RLS tenant direto igual tb_fornecedores, rota
#   /cadastro/prestadores; correções de UX/bugs em Agendamentos — voz, animais somem
#   por Set vazio truthy, scroll do "Expediente Ativo" resetando — e padronização de
#   modais de cadastro no estilo Tratador/Localização)
---

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

---

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

---

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
