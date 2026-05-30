# PRD — Módulo de Farmácia
## Cadastro de Produtos/Medicamentos Veterinários

### 1. Visão geral
O módulo de farmácia tem como objetivo centralizar o cadastro, a manutenção e o controle básico de produtos e medicamentos veterinários usados no sistema de prescrição, estoque e farmácia. Ele deve permitir cadastro simplificado, parametrização farmacêutica, controle de estoque e associação de vias de administração, servindo como base para a operação clínica e financeira do sistema [file:1].

### 2. Objetivo do produto
O objetivo do módulo é garantir que os medicamentos estejam cadastrados de forma padronizada, com informações suficientes para uso na prescrição e no controle de estoque. O cadastro deve apoiar a dispensação correta, permitir alertas de reposição e preparar o sistema para gerar receituário controlado quando necessário [file:1].

### 3. Problema que o produto resolve
Sem uma base farmacêutica estruturada, a prescrição pode ficar inconsistente, o estoque pode ser controlado de forma manual e as regras de via, forma farmacêutica e apresentação podem ficar soltas entre telas. Este módulo resolve isso ao reunir em uma única tela os principais dados do produto e as regras básicas de integridade [file:1].

### 4. Escopo do módulo
#### 4.1 Incluído no escopo
- Cadastro de produto/medicamento veterinário.
- Edição e manutenção do cadastro.
- Parametrização de forma farmacêutica, unidade, apresentação e vias de administração.
- Controle básico de estoque.
- Alerta visual de estoque mínimo.
- Marcação de produto controlado.
- Validação de duplicidade de cadastro [file:1].

#### 4.2 Fora do escopo inicial
- Entrada detalhada de estoque por lote.
- Validade de lote e rastreabilidade por lote.
- Baixa automática por prescrição.
- Integração com compras.
- Controle de lote/serial.
- Integração fiscal ou ERP.

### 5. Objetivos de negócio
- Padronizar o cadastro de medicamentos.
- Facilitar o uso dos produtos no módulo de prescrição.
- Permitir controle mínimo de estoque.
- Alertar quando houver necessidade de reposição.
- Identificar produtos sujeitos a receituário controlado [file:1].

### 6. Perfis de usuário
- **Farmacêutico/Responsável técnico**: cadastra e mantém produtos.
- **Atendente/recepção**: consulta produtos e estoque.
- **Veterinário**: utiliza os produtos já cadastrados na prescrição.
- **Gestor**: acompanha nível de estoque e itens controlados.

### 7. Jornada do usuário
1. Usuário acessa a tela de cadastro de produto.
2. Preenche nome, forma farmacêutica, unidade, apresentação, controlado, estoque mínimo, estoque atual e vias de administração.
3. O sistema valida os campos obrigatórios.
4. O sistema verifica duplicidade de nome, apresentação e forma farmacêutica.
5. O usuário salva o cadastro.
6. O sistema persiste os dados e atualiza a base usada na prescrição.
7. Se o estoque estiver abaixo ou igual ao mínimo, o sistema exibe alerta visual [file:1].

### 8. Requisitos funcionais
#### 8.1 Cadastro de produto
A tela deve permitir criar e manter produtos/medicamentos veterinários com campos obrigatórios e parametrização farmacêutica [file:1].

#### 8.2 Controle de estoque
O sistema deve permitir armazenar quantidade mínima e quantidade em estoque. Quando a quantidade em estoque estiver menor ou igual ao estoque mínimo, deve exibir alerta visível na parte superior da tela [file:1].

#### 8.3 Vias de administração
O sistema deve permitir selecionar múltiplas vias de administração associadas ao produto, com inclusão e remoção dinâmica [file:1].

#### 8.4 Produto controlado
Quando o campo “Controlado” estiver marcado como Sim, o sistema deve considerar o produto para emissão de receituário controlado [file:1].

#### 8.5 Reutilização na prescrição
Os produtos cadastrados devem alimentar o módulo de prescrição com nome, unidade, forma farmacêutica e vias permitidas.

### 9. Requisitos de interface
#### 9.1 Estrutura da tela
A tela deve ser dividida em:
- cabeçalho;
- formulário principal;
- seção de vias de administração;
- ações de salvamento [file:1].

#### 9.2 Campo: Nome
- Tipo: input texto.
- Obrigatório.
- Máximo de 255 caracteres.
- Deve aceitar letras, números e símbolos farmacêuticos.
- Exemplos: Dipirona 500 mg/mL Frasco 10 mL, Fenilbutazona 1g, Omeprazol Pasta Oral [file:1].

#### 9.3 Campo: Forma farmacêutica
- Tipo: select.
- Obrigatório.
- Parametrizável.
- Opções sugeridas: solução oral, solução injetável, comprimido, cápsula, pasta oral, pó oral, suspensão, creme, pomada, spray, gel, shampoo, sachê, sachet, gotas, aerossol [file:1].

#### 9.4 Campo: Unidade
- Tipo: select.
- Obrigatório.
- Opções sugeridas: mg, g, mcg, mL, L, UI, comprimido, cápsula, sachê, frasco, ampola [file:1].

#### 9.5 Campo: Apresentação
- Tipo: select.
- Obrigatório.
- Opções sugeridas: frasco, ampola, caixa, blister, seringa, sachê, bisnaga, bolsa, envelope [file:1].

#### 9.6 Campo: Controlado
- Tipo: boolean select.
- Valor padrão: Não.
- Se Sim, o sistema deve imprimir receituário em formato controlado [file:1].

#### 9.7 Campo: Quantidade estoque mínimo
- Tipo: input numérico.
- Inteiro positivo.
- Mínimo 0.
- Deve gerar alerta quando o estoque estiver igual ou menor que o mínimo cadastrado [file:1].

#### 9.8 Campo: Quantidade em estoque
- Tipo: input numérico.
- Inteiro positivo.
- Mínimo 0.
- Quando `qtd_estoque <= qtd_estoque_minimo`, o sistema deve gerar alerta visual e permitir relatórios de reposição [file:1].

#### 9.9 Campo: Via de administração
- Tipo: multiselect.
- Deve permitir múltiplas vias, inclusão dinâmica e remoção.
- Opções sugeridas:
  - Enterais: oral, retal;
  - Parenterais: intravenosa, intramuscular, subcutânea, intradérmica;
  - Respiratórias: inalatória, intranasal;
  - Tópicas: tópica, otológica, oftálmica [file:1].

### 10. Regras de negócio
#### 10.1 Campos obrigatórios
Os campos obrigatórios são:
- Nome;
- Forma farmacêutica;
- Unidade;
- Apresentação;
- Controlado;
- Via de administração [file:1].

#### 10.2 Duplicidade
O sistema não deve permitir cadastrar o mesmo:
- nome;
- apresentação;
- forma farmacêutica [file:1].

#### 10.3 Estoque
O sistema não deve permitir estoque negativo nem estoque mínimo negativo [file:1]. A quantidade em estoque deve ser atualizada pelo somatório da entrada de medicamentos na futura tela de entrada de medicamento [file:1].

#### 10.4 Alerta de estoque
Quando a quantidade em estoque estiver igual ou menor que o mínimo cadastrado, o sistema deve exibir alerta na parte superior da tela e permitir relatórios de reposição [file:1].

#### 10.5 Produto controlado
Quando o produto estiver marcado como controlado, o sistema deve sinalizar esse status para impressão e emissão de receituário controlado [file:1].

### 11. Critérios de aceite
- O usuário consegue cadastrar um produto completo com todos os campos obrigatórios.
- O sistema valida duplicidade corretamente.
- O sistema bloqueia estoque ou estoque mínimo negativos.
- O sistema exibe alerta quando estoque estiver abaixo ou igual ao mínimo.
- O campo de vias permite múltiplas seleções.
- Produtos controlados são identificados corretamente.
- O produto passa a estar disponível para o módulo de prescrição [file:1].

### 12. Requisitos não funcionais
- Interface responsiva.
- Validação em front-end e back-end.
- Estrutura modular para evolução.
- Tipagem consistente.
- Alta usabilidade para cadastro rápido.
- Preparado para integração com estoque e prescrição.

### 13. Modelo de dados sugerido
#### 13.1 Product
- id
- name
- pharmaceuticalForm
- unit
- presentation
- controlled
- minimumStock
- stockQuantity
- active
- createdAt
- updatedAt

#### 13.2 ProductAdministrationRoute
- id
- productId
- route

#### 13.3 StockMovement
- id
- productId
- type
- quantity
- reason
- createdAt

### 14. Premissas e dependências
- Existe ou existirá tela de entrada de estoque.
- O módulo de prescrição consumirá os dados cadastrados aqui.
- A lista de vias de administração pode ser parametrizável.
- O sistema deve suportar regras distintas para produtos controlados.

### 15. Riscos
- Duplicidade conceitual entre forma farmacêutica, apresentação e unidade.
- Ambiguidade na atualização de estoque sem controle por lote.
- Necessidade futura de rastreabilidade mais avançada.
- Dependência do módulo de receituário controlado para validação completa.

### 16. Evolução futura
O módulo pode evoluir para:
- entrada de estoque;
- saída por prescrição;
- rastreio por lote e validade;
- integração com compras;
- controle de fabricante;
- controle de lote/serial;
- relatórios gerenciais de reposição;
- integração fiscal/ERP.

### 17. Resumo executivo
O módulo de farmácia proposto estrutura o cadastro de medicamentos veterinários com foco em uso clínico, controle básico de estoque e integração com prescrição. Ele padroniza informações farmacêuticas essenciais, reduz inconsistências e prepara a base para fluxos futuros de entrada, saída e reposição [file:1].