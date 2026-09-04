# S2Vet — Especificação Funcional

> Documento gerado por varredura do código-fonte em 2026-07-09.
> **Atualização abrangente em 2026-08-29** — reflete as mudanças até 2026-08-28
> (multi-tenancy por RLS, storage no banco, IA unificada no Gemini, Central de
> Documentos, Orçamento, shell global + busca, 2FA por e-mail, sessão por inatividade,
> premissa de autoria, fuso horário por empresa, entre outras).
> Descreve fielmente o que está construído — sem propostas, sem melhorias.
> Fontes: rotas do backend (`backend/src/routes/*`), controllers, seeds de permissão,
> schema Prisma, páginas e componentes do frontend (`frontend/src/*`) e CLAUDE.md.

---

## 1. Visão geral

O **S2Vet** é uma plataforma hospitalar veterinária SaaS, mobile-first, com foco atual no
atendimento clínico e nutricional de **equinos** (estrutura preparada para multi-espécie).

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, HashRouter (`/#/rota`).
  Shell global com cabeçalho (marca, busca global, notificações, menu do usuário),
  corpo (sidebar + conteúdo) e rodapé — ver §17.
- **Backend:** Node.js + Express + Prisma, PostgreSQL (schema `schs2vet`), porta 3001.
- **Autenticação:** JWT (access curto) + refresh token (rotação) em **cookies HttpOnly**,
  login por e-mail/senha (com **2FA por e-mail**) e Google OAuth. **Sessão por janela de
  inatividade** (2h) — ver §3.
- **Multi-tenant por Row-Level Security (RLS):** cada empresa é um tenant isolado no
  próprio banco (Postgres, policies `FORCE` fail-closed). O `authenticate` carimba a
  empresa do contexto ativo e o RLS impede que uma clínica leia/escreva dados de outra,
  independentemente do código do controller — ver §22.
- **Storage no banco:** todo arquivo (foto de paciente, laudo, logo, assinatura) mora em
  `tb_midia_arquivos` (bytea) e sai por rota autenticada e autorizada por dono
  (`/api/midia/:chave`); nada é servido do filesystem — ver §22.
- **IA:** **Google Gemini** é o provedor único (texto, visão e transcrição de áudio);
  toda inferência é logada em `AiUsageLog` com o módulo de origem e medida por empresa
  (metering + quota) — ver §19.
- Exclusão de registros é **soft delete** (campo `ativo`), com regra de **exclusão
  lógica** que distingue quem **some** (animal, proprietário, empresa) de quem fica
  **inativo e visível** (profissional, fornecedor, prestador — o autor do registro) — §6.
- **Ação de registro responsiva** (`AcaoRegistro`): a mesma ação vira ícone pintado no
  desktop e botão com rótulo no card mobile; a cor comunica o tipo (alterar laranja, ver/
  executar verde, imprimir/e-mail azul, WhatsApp verde, cancelar vermelho). Cinza =
  indisponível; ação sem permissão não é renderizada.
- **Campo de data** (`DateInput`): sempre DD/MM/AAAA (nunca o nativo, que varia com o
  locale do navegador), com validação e mensagem específica do erro.
- **Modais arrastáveis no desktop:** qualquer modal pode ser reposicionado pelo cabeçalho
  (hook global `useDraggableModals`). Só mouse e viewport ≥ 768px; o backdrop não se move.

---

## 2. Perfis de usuário

### 2.1 Tipos de usuário (`userType`, global e único por conta)

| userType | Descrição |
|---|---|
| `ADMIN` | Administrador global da plataforma. Bypass total de permissões. |
| `VETERINARIO` | Profissional clínico. Pode ser dono/gestor de empresas. |
| `ESTAGIARIO` | Auxiliar clínico com permissões reduzidas. |
| `PROPRIETARIO` | Dono de animais. Vê os próprios animais e faturas. |
| `FORNECEDOR` | Prestador de serviço externo (ferrador, fisioterapeuta etc.). |

### 2.2 Cargos de equipe (`MembroEquipe.cargo` — o "perfil" efetivo)

`GESTOR`, `VETERINARIO`, `ESTAGIARIO`, `FORNECEDOR` (na UI: "Prestador/Fornecedor"),
`SECRETARIA`, `FINANCEIRO`, `ENFERMEIRO` + perfis customizados criados pelo gestor.
`PROPRIETARIO` é perfil **de sistema** — não pode ser atribuído como cargo de membro.

- Um usuário pode ter **múltiplos perfis** no sistema (ex.: FORNECEDOR na equipe A e
  GESTOR da própria empresa B após assinar a aplicação). O perfil efetivo é o **cargo no
  contexto ativo**, não o `userType`.
- Um membro pode ter **múltiplos cargos na mesma equipe** (campo `cargos[]`), editáveis
  pelo gestor no Controle de Acesso ("Editar perfis").

### 2.3 Registro de conta

- Tela de registro (`/register`): nome, e-mail, telefone (máscara), senha e o seletor
  "Você é..." com **Veterinário (padrão)** ou Proprietário.
- Cadastro via Google cria a conta como `PROPRIETARIO` (fixo, sem tela de escolha).
- O backend restringe o `userType` do registro a PROPRIETARIO/VETERINARIO.

---

## 3. Autenticação e conta

| Funcionalidade | Comportamento |
|---|---|
| Login e-mail/senha | `POST /api/auth/login` → access JWT (**30 min**) + refresh JWT em **cookies HttpOnly** (`s2vet_at`/`s2vet_rt`), dentro de uma **janela de inatividade de 2h** rotacionada a cada refresh (fonte única `lib/sessionTokens.js`). Rate limit 20 req/15min em `/auth`. Com 2FA ativo, a sessão só nasce após o 2º fator (ver abaixo). |
| **2FA por e-mail** | Senha correta **não** emite sessão: gera um desafio e envia um código de 6 dígitos por e-mail (`POST /api/auth/2fa/verificar` cria a sessão; `POST /api/auth/2fa/reenviar` renova). Código CSPRNG, guardado só como SHA-256, comparação em tempo constante, 10 min de validade, 5 tentativas, 3 reenvios. Kill-switch `MFA_EMAIL_ENABLED`; seletor global do ADMIN em `/configuracao-alertas` (entregue **desativado**). Login Google **não** passa por 2FA (o Google já autenticou). |
| **Bloqueio por tentativas** | 6 senhas erradas bloqueiam a conta (`tentativas_login`, `LOGIN_MAX_TENTATIVAS`); desbloqueio pelo gestor/ADMIN. E-mail inexistente e senha errada devolvem a **mesma** mensagem ("Usuário ou Senha Inválidos") e o **mesmo tempo de resposta** (bcrypt de isca no ramo sem conta) — sem enumeração por conteúdo nem por timing. |
| Login Google | `useGoogleLogin` com `prompt: 'select_account'`; o backend valida o `access_token` no Google antes de emitir o JWT interno (também em cookies HttpOnly). |
| Refresh automático | Interceptor Axios renova a sessão em 401 via `POST /api/auth/refresh` (refresh vem do cookie; rotaciona e reescreve os cookies) sem redirecionar para login. `sessionVersion` no token derruba na hora uma sessão antiga quando a pessoa loga de novo em outro dispositivo. |
| Esqueci minha senha | `POST /api/auth/forgot-password` — resposta sempre 200 genérica e em **tempo constante** (o e-mail é enviado em segundo plano, não bloqueia a resposta); não revela se o e-mail existe. Confirma na tela e volta ao login com aviso. Link por e-mail → `/#/reset-password?token=...`. |
| Reset de senha | `POST /api/auth/reset-password` (token de uso único, mínimo 8 caracteres). O formulário de senha (`FormularioNovaSenha`) é o **mesmo** da troca obrigatória e da tela do link de e-mail. |
| Troca de senha obrigatória | Usuários criados com senha padrão `Inicial_001` têm `mustChangePassword` e são bloqueados na tela `/alterar-senha` até trocar. |
| Senha é da pessoa | Só o próprio dono (ou o ADMIN da plataforma) troca a própria senha; gestor **não** troca a senha de membro (403). Quem esqueceu usa "esqueci minha senha". |
| Logout por inatividade | 2h sem interação → logout automático (frontend, espelhando a janela do servidor). |
| Logout | Revoga o refresh token no backend, **limpa os cookies HttpOnly** e o contexto ativo do storage. |
| Conta desativada | Qualquer request autenticado de conta com `ativo=false` (global) ou sem acesso ao sistema na empresa é rejeitado com 401/403. |
| Auditoria de sessão | LOGIN, LOGOUT e **tentativas de acesso negadas** (senha errada, conta bloqueada/desativada, 2FA inválido) são gravados em `AuditLog` com o **IP de origem** (categoria `ACESSO_NEGADO`). |

---

## 4. Contexto ativo (multi-empresa / multi-equipe / multi-perfil)

- Todo request envia os headers `x-empresa-id` / `x-equipe-id` (persistidos em
  `localStorage`: `s2vet_empresa_id` / `s2vet_equipe_id`).
- O backend (`auth.js`) **valida o vínculo** antes de aceitar o header (membro da equipe
  ou dono da empresa); valor inválido é ignorado e cai no fallback (MembroEquipe mais
  recente → empresa que o usuário possui).
- `GET /api/equipes/meus-contextos` retorna **todos os vínculos** do usuário como opções
  de contexto: empresas onde é dono/gestor + equipes onde tem qualquer cargo, com label
  `"Nome · Cargo"`.
  - Empresa com CNPJ → 1 opção no nível da empresa.
  - Empresa pessoal (CPF, cnpj null) → 1 opção por equipe.
- O **seletor no Sidebar** ("Empresa ativa"/"Equipe ativa") aparece quando há mais de uma
  opção; trocar o contexto recarrega a aplicação.
- **Preferência no login:** o login limpa o contexto salvo e, ao resolver o padrão, a
  opção com cargo **GESTOR sempre vence**; só cai na primeira opção se não houver perfil
  de gestor. Trocas manuais valem durante a sessão; novo login volta ao gestor.
- Cargo e permissões **podem diferir por contexto** (GESTOR na equipe A, VETERINARIO na
  B); `minhas-permissoes` e o middleware `checkPermission` resolvem sempre pelo contexto
  ativo. Exceção: PROPRIETARIO usa união das equipes vinculadas aos seus animais, com
  regra deny-wins para NEGADO.
- Fornecedor que atua como gestor no contexto ativo (cargo GESTOR ou dono da empresa
  ativa) recebe escopo de equipe normal na listagem e no acesso a animais; fora desse
  contexto mantém o deny-by-default de prestador (só animais com designação ativa).

---

## 5. Controle de acesso (RBAC)

### 5.1 Modelo

- **Níveis:** `NEGADO (-1) < NENHUM (0) < LEITURA (1) < PROPRIO (2) < EQUIPE (3) < FULL (4)`.
  `NEGADO` é bloqueio explícito e vence qualquer nível positivo de outra equipe (deny-wins).
- **Bypass:** ADMIN (global) e GESTOR (na equipe/empresa do contexto ativo) não consultam
  matriz. Dono de empresa sem MembroEquipe também tem bypass **na empresa ativa** (exceto
  userType FORNECEDOR — cobre-se pelo MembroEquipe GESTOR que o setup sempre cria).
- **Fontes de permissão:**
  - `MatrizPerfil` — template por perfil/equipe; fonte canônica para VET, ESTAGIARIO,
    SECRETARIA, FINANCEIRO, ENFERMEIRO e perfis customizados. Itens `locked=true` são
    definidos pelo ADMIN global e imutáveis para o gestor.
  - `PermissaoMembro` — permissões individuais; fonte canônica para o cargo FORNECEDOR
    (configurado por membro).
  - `MatrizPerfil[perfilSlug='PROPRIETARIO']` — permissões do proprietário, resolvidas
    pelas equipes vinculadas via `Animal.equipeId`/`empresaId` (união + deny-wins).
- **Catálogo de módulos** (`ModuloSistema`, via seed): módulos `cadastro.*`
  (proprietário, tratador, fornecedor, **prestador**, localização), `dashboard.geral`,
  `animais`, `atendimento.*` (evoluções, prescrições, vacinas, encaminhamentos, exames,
  agendamentos), `enfermagem.prescricao` (executar + **cancelar pelo plantão**),
  `exames.laboratorial/imagem` (usados no fluxo de RESULTADO — §8.4),
  `nutricao.dietas/relatorios`, `financeiro.faturas` (inclui `fechar` e `lancar`),
  `documentos.templates/emitidos` (Central de Documentos — §), `equipe.membros`,
  `vacina.estoque`, `farmacia.estoque/movimentacoes`, `medicamentos.catalogo`,
  `procedimentos.catalogo`, `relatorios.gerencial`.
  Ações possíveis: ler, criar, editar, deletar, imprimir, finalizar, executar, ativar,
  exportar, compartilhar, desvincular, whatsapp, fechar, lancar, ajustar.
  Re-sincronizar o catálogo: `node backend/seed.js`.

### 5.2 Tela Controle de Acesso (`/controle-acesso`)

**Visão ADMIN (3 abas):**
1. *Permissões Globais* — matriz por userType (VETERINARIO/ESTAGIARIO/PROPRIETARIO);
   itens marcados aqui viram `locked` nas equipes.
2. *Profissionais* — com equipe selecionada: membros da equipe; sem equipe: lista
   hierárquica de todas as empresas/equipes. Seletor de equipe no topo. Permite convidar
   gestor por CNPJ (auto-preenchimento da razão social via BrasilAPI) ou por equipe (CPF).
3. *Logs de Auditoria*.

**Visão GESTOR (4 abas):**
1. *Matriz de Perfis* (desktop only) — lista de perfis/cargos da equipe à esquerda
   (com badge e contagem de membros; perfis padrão e com membros não podem ser removidos;
   é possível criar perfis customizados); matriz de permissões à direita com colunas
   VER / CRIAR / ALTERAR / EXCLUIR / FINALIZAR / IMPRIMIR (módulos com ações próprias
   têm colunas específicas: Agendamento e Agenda usam CONFIRMAR/REAGENDAR/etc.;
   Farmácia usa VER / CRIAR / ALTERAR / **AJUSTAR** / EXCLUIR / IMPRIMIR). Checkbox de 3 estados
   (NENHUM → EQUIPE → NEGADO). Itens `locked` aparecem com cadeado. "Aplicar ao perfil"
   propaga aos membros do cargo.
2. *Profissionais* — busca por nome/e-mail, filtro por perfil. Coluna **Perfis** exibe
   os cargos do membro nesta equipe (badges cheios) e os perfis que ele possui em outras
   equipes/empresas do sistema (badges atenuados com tooltip). Ações: ativar/desativar
   usuário, editar cargos (multi-cargo), e para FORNECEDOR o botão **Gerenciar Acesso**
   (seleção de animais que o prestador pode acessar → `DesignacaoPrestador`).
   Botão **Incluir Membro**: fornecedor entra por inclusão direta (com vínculo a um
   cadastro de fornecedor existente ou criação de novo com tipo de serviço); demais
   cargos entram por convite por e-mail.
3. *Convites* — lista convites enviados com status (Pendente/Aceito/Expirado/Cancelado);
   cancela convite PENDENTE não expirado.
4. *Logs de Auditoria* — alterações de permissão (quem alterou, nível anterior/novo,
   motivo, IP), imutável (`AuditoriaPermissao`).

### 5.3 Padrão de enforcement

- Toda página com controle granular usa `usePermissoes()`: guard de página
  (`podeExecutar('slug.ler')`), gating de `useEffect` em `loadingPerms`, guards em
  handlers de escrita e ocultação de botões sem permissão.
- Interceptor Axios: `GET` com 403 resolve como `{ data: null }` (silencioso); mutações
  rejeitam com `isPermissionError: true`.
- **Premissa de AUTORIA (2026-08-04):** o RBAC decide **se** a pessoa pode executar a
  ação; a autoria decide **sobre qual registro**. A ação vale sobre o que a pessoa
  **criou ou assumiu**; o **único** perfil que opera o registro de outro é o **GESTOR**
  (e o ADMIN). `podeOperarRegistro(req, autorId)`: gestor no contexto → qualquer registro;
  senão → só `autorId === req.user.id`; registro órfão (autor nulo) → só o gestor.
  - "Só o gestor finaliza uma evolução" continua sendo **configuração** (o seed dá
    VET/EST `NENHUM` em `*.finalizar`); "ninguém opera o registro de outro" é **código**.
  - **Assumir** um registro/agendamento transfere a autoria e **arrasta o atendimento
    inteiro** (`lib/transferenciaAtendimento.js`): agendamento → evolução em andamento →
    prescrição (grupo + itens), exame, encaminhamento e vacina passam para quem assumiu.
    Sem o arrasto, quem assume conduziria o atendimento sem poder operar os filhos.
  - Editar registro FINALIZADO (evolução) é ato de gestor; excluir evolução finalizada
    segue restrito a ADMIN. Editar **não** transfere autoria (a troca de dono tem caminho
    próprio: assumir/transferir).
  - Toda troca de responsável gera auditoria `TRANSFERENCIA` (dono anterior → novo) e toda
    edição relevante gera `ALTERACAO` (antes → depois por campo), na mesma transação.
  - Aplicado em evolução, prescrição (item e grupo), exame clínico, encaminhamento, vacina
    e agendamento. O escopo de dados do prestador (designação) permanece deny-by-default.
  - ⚠️ `req.permissaoNivel === 'FULL'` **não** é sinônimo de gestor: FULL é um nível da
    matriz e não dá acesso ao registro alheio — só o cargo GESTOR (ou dono/ADMIN) dá.

---

## 6. Cadastros

> **Isolamento por empresa (perfis por tenant).** O cadastro do **profissional**
> (`UsuarioEmpresa`/`ProfissionalPerfil`) e do **proprietário** (`ProprietarioPerfil`) é
> **por empresa**: o mesmo login pode ser gestor numa clínica, veterinário em outra e
> cliente numa terceira, com telefone/endereço/CRMV/condição comercial **independentes**
> em cada uma. No `users` ficam só a identidade (e-mail/senha), o `ativo` global e o
> `userType` global. Nunca se lê nome/telefone/documento do `users` numa tela de empresa.
>
> **Exclusão lógica — quem some e quem fica inativo (2026-08-06).** Nada é apagado do
> banco; o que muda é o que a aplicação mostra:
> - **Animal · Proprietário · Empresa** → **SOMEM** (e tudo que pende deles some junto):
>   são o *sujeito* do atendimento.
> - **Profissional · Fornecedor · Prestador** → continuam **visíveis, marcados como
>   inativos**: são o *autor* do registro; esconder o autor apagaria a autoria de um
>   prontuário que segue válido.
>
> Inativar responde "aparece?"; a tenancy responde "de quem é?" — inativar **nunca** zera
> o `empresaId` de um registro.

### 6.1 Cadastro Pessoal (`/cadastro-pessoal`)

- Onboarding pós-registro: nome, telefone, e-mail, endereço (busca CEP via ViaCEP),
  tipo de usuário (padrão **Veterinário**).
- Se Veterinário: CRMV com **validação online no CFMV** (estado + número), espécies
  atendidas (multi-seleção) e subespecialidades.
- Redirect pós-salvamento: `/animais` durante onboarding de proprietário; senão
  `/meus-animais`.

### 6.2 Animais / Pacientes (`/animais`, `/animal/:id`, `/animais-vet`, `/meus-animais`)

- **Formulário do animal** (`Animal.tsx`): nome, espécie, raça, sexo, peso, nascimento
  ou idade, foto (comprimida no navegador — máx. 1200px, JPEG 82%), categoria NRC e tipo
  de exercício, baia, **localização** (combobox pesquisável do cadastro global, com
  criação inline), tratador, pelagem, altura, registro/passaporte, finalidade,
  seguradora, proprietário (com criação de proprietário inline pelo vet) e veterinário
  responsável (dispara fluxo de vínculo — §7).
- **Detalhamento do Animal** (`/animal/:id`): título "Detalhamento do Animal" com ícone
  correspondente à espécie do animal (🐴 equino, 🐶 canino, 🐱 felino, 🐮 bovino etc.);
  cabeçalho com dados resumidos; painel **Histórico** unificado (evoluções, vacinas,
  exames, prescrições, encaminhamentos — agrupados por atendimento, com busca client-side
  e modal de detalhe por origem); painel **Agendamentos futuros** (somente visualização).
- **Meus Pacientes** (`/animais-vet`, vet): lista cards/tabela dos pacientes, botão
  "Buscar Paciente" (busca por nome no sistema e solicita vínculo), solicitações
  pendentes exibidas com `SolicitacaoCard`, ações de editar e desvincular.
- **Meus Animais** (`/meus-animais`, proprietário): cards dos animais com badge de status
  do vínculo (VINCULO âmbar / DESVINCULO vermelho / TROCA_VET azul), botões
  Autorizar/Recusar para solicitações de vets e cancelamento de solicitações próprias.
- **Listagem** é segregada por contexto, distinguindo **base** de **convidado**: na
  empresa onde o usuário é **dono/gestor** (sua base), ele vê o escopo da(s) equipe(s) +
  **todos os pacientes que trata** (todos os vínculos diretos), inclusive **co-tratados**
  que pertencem a outra empresa — um mesmo animal atendido por mais de um vet aparece na
  base de cada um. Na empresa onde é **convidado** (membro/fornecedor de outra empresa) o
  isolamento é **estrito**: só os animais **daquela** empresa que ele pode tratar (escopo
  de equipe + vínculo a animal DA empresa + designação); pacientes exclusivos de outra
  empresa **não** vazam. Animal de outra equipe da mesma empresa fica fora do escopo de
  equipe. PROPRIETARIO vê apenas os seus. FORNECEDOR vê apenas animais com **designação
  ativa** (exceto quando atua como gestor no contexto — §4). O multi-vet é modelado por
  múltiplos `VetAnimalSolicitacao` (não há "vet principal" no animal).
- Exclusão de animal = soft delete **global** (o animal sai das listagens de todos,
  inclusive do proprietário; histórico preservado) com **justificativa obrigatória**
  registrada na Auditoria. Criação exige nível EQUIPE em `animais.criar`.

### 6.3 Proprietários (`/cadastro/proprietarios`)

- CRUD de usuários PROPRIETARIO com: CPF/CNPJ (validação + máscara; CNPJ com
  auto-preenchimento via BrasilAPI), endereço via CEP, telefone obrigatório,
  toggle **mensalista** + valor de assistência mensal, frequência de visitas (1–7×/semana).
- Criação **sem campo de senha** — senha padrão `Inicial_001` + `mustChangePassword`;
  e-mail de boas-vindas com a senha efetiva.
- Escopo segregado por equipe: aparecem proprietários com animal ativo na(s) equipe(s) do
  contexto ou cadastrados diretamente pela equipe. "Remover da empresa" inativa apenas os
  animais do escopo da equipe ativa — exige **justificativa obrigatória** (auditada com a
  contagem de animais inativados).

### 6.4 Tratadores (`/cadastro/tratadores`)

- CRUD simples por empresa: nome, telefone, local de trabalho, ativo/inativo.

### 6.5 Fornecedores (`/cadastro/fornecedores`)

- CRUD do cadastro de prestadores: documento (CPF/CNPJ), nome, e-mail e telefone
  obrigatórios, tipo de serviço (especialidade). Registros `SYSTEM` (globais/legado) e
  `CLIENTE` (escopados à empresa ativa).
- O cadastro pode ser **vinculado a um login** (`Fornecedor.userId`, único) quando o
  prestador é incluído como membro da equipe — fornece a especialidade exibida nos
  encaminhamentos.
- Inativar exige **justificativa** (coluna "Justificativa" na aba Inativos); reativar é
  direto. Duplicata inativa oferece "Ativar cadastro existente".

### 6.6 Prestadores (`/cadastro/prestadores`)

- Cadastro **independente** de Fornecedor (tabela e RLS próprios, `tb_prestadores`),
  criado em 2026-08-21: nome, CPF/CNPJ, contato, tipo de serviço (texto livre), endereço.
  Mais simples que Fornecedor — **sem** vínculo a login/estoque e sem catálogo de
  especialidade. Entrada própria no Sidebar. Mesmo padrão de duplicidade e justificativa
  de inativação dos demais cadastros.

### 6.7 Localizações (`/cadastro/localizacoes`)

- Cadastro **global** de localizações de animais (haras, clube hípico, clínica, fazenda,
  canil, gatil, petshop etc.), com espécies mapeadas por tipo, CEP/endereço via ViaCEP,
  responsável e telefone.
- ADMIN cria registros `SYSTEM` (imutáveis para os demais), edita e inativa qualquer um;
  não-ADMIN cria registros `CLIENTE` (read-only depois).

---

## 7. Vínculo veterinário ↔ animal

Registro único por par (animal, vet) em `VetAnimalSolicitacao`, reutilizado nas
transições. Tipos: `VINCULO`, `DESVINCULO`, `TROCA_VET`; status: `PENDENTE`, `ACEITO`,
`RECUSADO`, `CANCELADO`.

| Fluxo | Como funciona |
|---|---|
| **P→V** (proprietário solicita) | Proprietário seleciona vet no formulário do animal → solicitação PENDENTE + e-mail ao vet com links aceitar/recusar (token). Vet responde pelo dashboard, pela aba Pacientes ou pelo link. 24h sem resposta → cron **auto-aceita**. |
| **V→P** (vet solicita) | Vet busca o paciente por nome → "Solicitar Vínculo" → e-mail ao proprietário; proprietário autoriza/recusa em Meus Animais ou pelo link público `/#/proprietario/aprovar-vinculo`. |
| **DESVINCULO** | Proprietário remove o vet → mesmo registro vira DESVINCULO PENDENTE + e-mail ao vet ("Aceitar remoção" / "Manter meu acesso", expira em 24h). Aceito (ou 24h sem resposta) → vet perde o vínculo; recusado → restaura VINCULO ACEITO. |
| **TROCA_VET** | Proprietário troca o vet com vínculo ativo → TROCA_VET PENDENTE + e-mail ao vet atual. Aceite/24h → cria VINCULO PENDENTE para o novo vet (etapa 2). Recusa → restaura VINCULO ACEITO do vet atual e notifica o proprietário. |
| **Cancelamento** | Proprietário cancela a solicitação pendente com rollback por tipo. |
| **Vínculo direto** | `POST /animais/vincular-vet` cria vínculo já ACEITO (fluxos internos). |

Ao aceitar vínculo, o animal recebe `empresaId`/`equipeId` do contexto do vet
(segregação multi-tenant). Notificações in-app por polling (§18).

---

## 8. Atendimento clínico (`/clinica/...`)

Tela shell (`Atendimento.tsx`) com seletor inteligente de paciente (desambiguação de
nomes duplicados por proprietário), card do animal, banner do **atendimento ativo** e
abas: **Agenda · Evolução · Prescrição · Exames · Encaminhamento** (a **Vacina** virou
tela apartada — §8.3), mais o painel lateral **Histórico do Paciente** (timeline agrupada
por atendimento AG-/EV-, com expansão, impressão e pré-visualização do atendimento
completo, e botão Editar/Continuar que carrega os registros do atendimento nas abas). No
mobile o histórico abre por botão flutuante.

- **Atendimento ativo é ESCOLHIDO, não adivinhado (2026-08-25).** O mesmo paciente pode
  ter mais de uma evolução **em andamento** (consultas distintas no mesmo dia — ver
  abaixo). O **Nº no card "Histórico de Evolução Clínica"** (AG-0013/EV-0007) vira um
  **botão** que carrega aquele atendimento na tela; o banner passa a descrevê-lo
  ("Atendimento AG-0013 de 25/08/2026 17:11 – Consulta clínica geral – Em andamento") e
  **todo registro lançado nas abas se vincula a ele**. A escolha é persistida por paciente
  (`s2vet_ev_sel_<animalId>`, lida também pela tela de Vacina); chegar com `?agendamentoId=`
  na URL (o "Iniciar" da agenda) redefine a escolha. O banner é **um só** (a versão em
  lista foi recusada). Fonte única da regra: `utils/evolucaoAtiva.ts`.
- **Duas consultas do mesmo animal no mesmo dia** (ex.: Clínica + Dermatologia) são
  atendimentos **distintos** mesmo com o mesmo profissional: o bloqueio de "evolução
  própria já aberta" casa por `agendamentoId`, não pelo animal inteiro.
- **Finalizar Atendimento** (botão do banner): finaliza a evolução ativa, gera título via
  LLM (best-effort), com confirmação; respeita a permissão de finalizar **e a autoria** —
  só aparece no atendimento que é da própria pessoa (ou para o gestor).

### 8.1 Evolução (prontuário)

- Numeração `EV-0001` (avulsa) ou herdada do agendamento (`AG-XXXX`). Status:
  `EM_ANDAMENTO`, `FINALIZADA`, `CANCELADA`. A **própria** evolução aberta bloqueia abrir
  outra para a **mesma consulta** (casa por `agendamentoId`); consultas **distintas** do
  mesmo animal no mesmo dia (agendamentos diferentes) podem ter evoluções em andamento em
  **paralelo** — o atendimento ativo é o escolhido no shell (§8).
- **Assumir** evolução em andamento de **outro** profissional (§5.3): puxa para si, com
  e-mail + WhatsApp ao anterior e arrasto do atendimento. A própria não se assume.
- Campos: **especialidade** (do catálogo por espécie, `tb_especialidades` — não mais lista
  fixa), texto livre, título (opcional; sugerido por LLM ao finalizar), vínculo opcional a
  agendamento.
- **Ditado por voz:** Web Speech API online + Whisper offline (modelo local, com fila de
  áudios pendentes e opção "transcrever ou apenas anexar").
- **Rascunho automático (2026-07-14):** o texto da evolução **nova** é salvo em localStorage
  a cada alteração (inclui o ditado) e restaurado após um refresh de página (comum no
  celular) — só é perdido no logout. Limpo ao salvar/finalizar.
- **Mídias:** anexos imagem/vídeo/áudio (máx. 100MB, whitelist de extensão + mimetype).
- **Salvar** mantém EM_ANDAMENTO; **Finalizar** grava FINALIZADA, marca `dataFim`,
  dispara interpretação LLM (`/evolucoes/interpretar`) que sugere título e ações de
  encaminhamento (modal de confirmação das ações sugeridas). Finalizar libera o
  agendamento vinculado (status FINALIZADO).
- Evolução FINALIZADA só pode ser editada por **gestor**; CANCELADA é imutável.
  Exclusão e cancelamento exigem justificativa. Edição de texto invalida o cache de
  resumo IA do relatório.
- Lista com paginação e filtros: status, período, responsável, busca textual.
  Impressão individual (`EvolucaoPrint`) e **Relatório de Atendimento** (laudo com mapa
  corporal/escores extraídos por IA, com cache em `resumoIaData`).

### 8.2 Prescrição

- Documento **PrescricaoGrupo** numerado por animal (`#0001`), com itens
  `MEDICAMENTO`/`PROCEDIMENTO`. Status do grupo: `SALVO`, `FINALIZADO`, `EXECUTADO`,
  `CANCELADO`, `CANCELADO_PARCIALMENTE`.
- Criação **exige evolução em andamento** (é vinculada ao atendimento). Formulário
  inline com rascunho persistido em localStorage por animal+evolução.
- Item: medicamento do catálogo (combobox com busca híbrida client/server, indicação de
  estoque por item) ou procedimento do catálogo; dosagem + unidade (com conversão
  L→mL / kg→g), via (restrita às vias do catálogo), frequência (16 posologias: 1x/dia,
  12/12h, 8/8h, 6/6h, 4/4h, 1/1h, contínuo, dose única, se necessário, SOS, 1x/2dias,
  1x/3dias, 1x/semana, 1x/21dias, 1x/30dias, 1x/90dias), hora de início (gera
  `horariosGerados`), duração/**qtd de vezes**, data de início, observação. Nas
  frequências "1x a cada N dias" o campo é **Qtd. de Vezes** (convertida para dias) e a
  hora de início é obrigatória. Dois checkboxes **por item**: "fornecido pelo **Cliente**"
  (sem baixa de estoque) e "aplicado pelo **Proprietário**" (não vai ao plantão). A matriz
  "quem fornece × quem aplica" decide execução e fatura: medicamento aplicado pelo
  proprietário é cobrado na **finalização**; procedimento executado pelo proprietário
  **nunca** é cobrado.
- Validações: campos obrigatórios por tipo, duplicidade de item no mesmo documento.
  Itens reordenáveis por drag-and-drop.
- **Salvar** (botão único — absorveu o antigo Finalizar): salva e **finaliza** o
  documento em uma ação, com verificação de estoque; alerta de estoque
  insuficiente/zerado detalha reservas por animal/prescrição e permite "Continuar mesmo
  assim" (`forcarFinalizacao`). Usuário sem permissão de finalizar apenas salva (status SALVO).
- **Estoque multi-lote (FEFO):** verificação, reserva e baixa consideram TODAS as
  entradas do medicamento no estoque da empresa — quando um lote não é suficiente, o
  restante é reservado/debitado no próximo (validade mais próxima primeiro). A
  disponibilidade desconta reservas de outras prescrições.
- Finalização **reserva o curso completo** no estoque (`ReservaEstoque`, distribuído
  entre os lotes); a execução diária debita em FEFO (um movimento SAÍDA por lote, valor
  da dose com o preço de cada lote) e abate as reservas do grupo; cancelamento libera as
  reservas e o último dia de execução libera o remanescente. Histórico com finalizar
  direto (legado SALVO), cancelar com **motivo obrigatório** (bloqueado se EXECUTADO),
  imprimir (FINALIZADO/EXECUTADO). Remoção de item também exige motivo.
- Edição pós-execução parcial: item já em execução só pode ser editado para os **dias
  restantes** (data de início vira hoje, duração = dias restantes); item totalmente
  executado é imutável; item executado não pode ser removido.

### 8.3 Vacina (tela apartada — `/clinica/vacina[/:animalId]`)

- Deixou de ser aba do Atendimento e virou **tela própria** (mantém o seletor de paciente,
  o card do animal e o vínculo à evolução em andamento do atendimento ativo — §8). O
  Histórico do Paciente navega para ela; o item viaja na URL (`?item=`).
- **Ciclo de vida `SALVA → FINALIZADA → EXECUTADA`** (mesma lógica da Prescrição): a
  fatura e o débito de estoque só acontecem na **execução** (no plantão), não no registro.
  - `registrar` cria SALVA (fixa o lote sugerido/valor de referência, sem debitar).
  - **Finalizar** → FINALIZADA: a vacina passa a aparecer na Execução de Prescrição e
    **reserva o lote** em FEFO (`ReservaEstoqueVacina`, espelho da prescrição).
  - **Executar** (plantão) → EXECUTADA: consome a reserva, debita o lote e lança o
    `FaturaItem`.
- Campos: vacina do catálogo com **lote disponível** (validade/valor por dose) ou avulsa;
  **Tipo Dose** e **Via** obrigatórios já ao inserir na lista; quantidade de doses, data de
  aplicação, data de reforço, observação; flags "fornecida pelo cliente" e "aplicada pelo
  **proprietário**" (dose que o dono aplica em casa não vai ao plantão e é cobrada na
  finalização).
- Selo por status (`SALVA`/`FINALIZADA`/`EXECUTADA`/`CANCELADA`) e abas de filtro por
  status existente. Numeração `#074` (3 dígitos, `utils/numeroClinico.ts`). Cancelar exige
  justificativa e estorna reserva/lote/fatura conforme o momento.
- Também executável e cancelável pelo **plantão** (Execução de Prescrição / Painel
  Principal), com as mesmas rotas e o slug `enfermagem.prescricao.*`.

### 8.4 Exames clínicos

- Requisições com 4 tipos: **Laboratorial**, **Bioquímico**, **Imagem**, **Compra**.
- Laboratorial: catálogo por **laboratório → grupos → exames** (seed com Paddock, Genesi,
  LACVET), tipo de amostra (11 tipos com tubo indicado), quantidade de amostras,
  data/hora da coleta, indicação clínica, observação. Vários grupos por requisição.
- Imagem: catálogo dinâmico de grupos/exames de imagem por espécie.
- Ações do **pedido**: criar (vinculado à evolução ativa), editar, **finalizar** (status
  → CONCLUIDO, lança na fatura, regra de autoria), excluir (soft, sincroniza fatura),
  imprimir requisição, compartilhar por e-mail/WhatsApp. O **pedido** é gateado por
  `atendimento.exames.*` (mesmo padrão de evolução/prescrição).
- **Resultado do exame (2026-08-02)** — tela `ExamesSolicitadosPanel`
  (`/exames/:animalId?tipo=laboratorial|imagem`): os exames **pedidos** aparecem com dois
  caminhos por linha — **Carregar resultado** (anexa o laudo, tabela lida por IA em
  `tb_exame_clinico_resultado_itens`; imagens em anexos) e **Preencher manualmente**
  (digita a tabela ou o laudo). Ambos caem em `PATCH /clinica/exames/:id/resultado` e
  transitam o exame para **REALIZADO**. Existe também **Finalizar sem resultado**. O gate
  do **resultado** é `exames.laboratorial.*` (Lab/Bioquímico) / `exames.imagem.*`
  (Imagem), distinto do slug do pedido — esses slugs deixaram de ser órfãos. Resolve a
  antiga limitação "resultados não anexados à requisição".

### 8.5 Encaminhamento

- Destino **EQUIPE** (lista prestadores/cargo FORNECEDOR das equipes do animal, com
  especialidade e badge "já tem acesso") ou **EXTERNO** (texto livre).
- Campos: especialidade, motivo, urgência (`NORMAL`/`ALTA`/`URGENTE`), status
  (`PENDENTE`/`CONCLUIDO`/`CANCELADO`).
- Encaminhar para prestador da equipe cria/reativa automaticamente a
  **DesignacaoPrestador** (acesso do fornecedor ao animal); concluir, cancelar ou
  excluir o encaminhamento **encerra o acesso**.
- Criar lança item na fatura. Editar só em PENDENTE. Finalizar segue regra de autoria.

### 8.6 Central de Documentos (`/documentos`)

Módulo de emissão de documentos veterinários (atestados, TCLEs, termos), com backend real
sob RLS desde 2026-08-26.

- **Catálogo misto de modelos** (`tb_documento_templates`): modelo **global** do sistema
  (`empresa_id` nulo) que toda clínica lê e nenhuma altera, e modelo **da clínica**. Os
  **12 anexos da Res. CFMV nº 1.321/2020** (atestado sanitário/óbito/vacinação, 8 TCLEs,
  termo de retirada sem alta) são o catálogo global, transcritos verbatim dos PDFs
  oficiais; a linha pontilhada virou `{{variável}}` onde o S2Vet tem o dado.
- **Copy-on-write:** salvar/favoritar um modelo global **não** o altera — cria a cópia da
  empresa (`origem_id`) e a alteração vai para ela; a resposta traz `copiado: true` e o
  front adota o id devolvido. Excluir global → 400 `MODELO_DO_SISTEMA`. Não há autosave em
  modelo global (criaria uma cópia a cada pausa de digitação). Selo **CFMV** no card.
- **Seletor de paciente + preenchimento automático:** usa o **mesmo** par da tela de
  Atendimento (`SeletorAnimalInteligente` + `AnimalCard`); escolhido o animal,
  `GET /documentos/contexto/:animalId` devolve as variáveis já resolvidas + a marca (logo,
  assinatura, CRMV, quem assina). **Variável sem dado sai vazia**, nunca com o exemplo do
  catálogo (um atestado com dado inventado seria documento falso).
- **Quem resolve o que fica gravado é o backend** (`lib/documentoVariaveis.js`), nunca o
  navegador — o documento tem valor legal. Cobre todo campo textual, inclusive células de
  tabela; preserva a chave da variável para auditoria.
- **O emitido é SNAPSHOT** (`tb_documentos_emitidos`, tenant direto): editar o modelo
  depois não reescreve o papel já entregue. Numeração `DOC-0001` por empresa. Entra no
  Histórico do paciente e na Memória Clínica (ref `documento-<id>`). Cancelar exige
  justificativa (soft delete).
- **Chat de IA multi-turno ancorado no acervo** (`assistente_documento@v1`): escolhe um
  modelo do acervo (globais + os da clínica) ou ajusta o aberto — **não** redige do zero.
  A resposta é validada contra o acervo (id/bloco alucinado é descartado).
- **Assinatura do veterinário** (`UsuarioEmpresa.assinatura_url`, por empresa) enviada em
  `/cadastro-pessoal`; renderizada sobre a linha com nome e CRMV. Sem assinatura, sobra o
  espaço em branco para assinar à mão. Logomarca da clínica no timbre da folha.
- Permissões separadas: `documentos.templates.*` (o modelo) × `documentos.emitidos.*` (o
  documento entregue); o acesso ao paciente é verificado à parte.

---

## 9. Agenda e agendamentos

### 9.1 Agenda global (`/agendamentos`)

- Calendário mensal com marcadores por dia e agenda diária por horário (00h–23h).
- Agendamento: animal (o combobox mostra o **local** do animal, não a espécie — quem vai
  atender precisa saber para onde ir), tipo (`CONSULTA`, `VACINA`, `RETORNO`, `EXAME`,
  `PROCEDIMENTO`), **especialidade** (define a **duração** da consulta — §9.4), título,
  data/hora, veterinário responsável, observação.
  Status: `AGENDADO`, `EM_ANDAMENTO`, `CONCLUIDO`, `FINALIZADO` (via evolução),
  `ATRASADA`, `REAGENDADO`, `CANCELADO` (com motivos) e `CANCELADO_AUTOMATICAMENTE`
  (só a rotina noturna grava — recusado como input manual). Conflito de horário é por
  **intervalo** `[início, fim)`, não só pelo horário de início.
- **Reagendar** usa o mesmo calendário + grade de horários livres do profissional (não um
  `datetime-local`); o registro antigo vira **REAGENDADO** (libera a grade, não é
  cancelamento) com a observação "Reagendado para …". **Não** se agenda no passado.
- **Assumir** atendimento/agenda: qualquer profissional puxa para si o agendamento de
  outro (ou o "Não atribuído"), inclusive `EM_ANDAMENTO`, com e-mail + WhatsApp ao anterior
  e **arrasto** do atendimento (§5.3). Rastro "Assumida de/por <Fulano>" na Minha Agenda.
- **Autoria na agenda:** iniciar/reagendar/cancelar/transferir valem sobre a **própria**
  agenda; **só o GESTOR** agenda ou transfere **para outro** (`podeAgendarParaOutro`) —
  quem não é gestor usa o "assumir". A grade lista todos os profissionais da equipe (cada
  um com sua coluna), incluindo estagiário.
- **Agendamento por voz:** ditado interpretado por LLM
  (`POST /clinica/agendamentos/interpretar`) que pré-preenche o formulário.
- **Transferir dia:** move todos os agendamentos de um dia (do próprio profissional, ou de
  qualquer um se gestor) para outra data.
- **Cancelamento automático (cron noturno):** agendamento `AGENDADO`/`ATRASADA`/
  `EM_ANDAMENTO` com data no passado vira `CANCELADO_AUTOMATICAMENTE` (motivo distinto por
  origem); a evolução em andamento que ele abriu **não** é encerrada junto.
- **Expediente configurado (2026-07-14):** os horários livres são liberados apenas nos
  **dias** e na **faixa de horário** definidos em Configurações (§15.3) — ex.: Seg–Sex
  08:00–20:00 abre 08–19h de segunda a sexta. Fora do expediente aparece "0 Livres". O
  bloco "Expediente Ativo" mostra período/dias configurados; no mobile o profissional vira
  card com a contagem de livres + popover ao toque. Config lida por qualquer membro via
  `GET /api/equipes/horario-atendimento`.
- **Lembretes (cron):** e-mail D-1 (08:00) ao proprietário e, quando houver provider de
  mensageria plugado, WhatsApp **1 dia antes e 2h antes** (base pronta em
  `lembreteAgendamentoService`; idempotência por agendamento; provider "noop" por padrão só
  loga). Ver §20 para agenda/alertas dos crons.
- Gerenciado por ADMIN/VETERINARIO/ESTAGIARIO; PROPRIETARIO/FORNECEDOR só visualizam.

### 9.2 Minha Agenda (aba do Atendimento)

- É a **mesma** tela de `/agendamentos` renderizada com a prop `modoMinhaAgenda` (não há
  agenda paralela — `SubModuloMinhaAgenda` foi removido): mostra só o card
  "Agendamentos do Dia", escopado ao próprio profissional (o gestor vê a equipe). Botão
  "Iniciar" abre a evolução do animal já vinculada ao agendamento (`?agendamentoId=`,
  persistido por animal em localStorage entre navegações/re-login).

### 9.3 Mapa de Atendimento (`/mapa-atendimento`)

- Painel-home dos perfis clínicos (redirect automático de `/` para VET/EST/ADMIN):
  - **Distribuição por haras/localização** (gráfico donut interativo).
  - **Consultas clínicas do dia**: agendado × concluído × cancelado, % de progresso.
  - **Prescrições** (total/ativas) e **animais sem atendimento** (com/sem).
  - **Cronograma do dia**: itens de agendamento + execuções de prescrição, com filtros
    por localização e veterinário; status `AGENDADO / EM_ANDAMENTO / CONCLUIDO /
    FINALIZADO / EXECUTADO / CANCELADO / SEM_ATENDIMENTO`; abre execução de prescrição
    em modal (`ModalExecucao`) e navega para o atendimento.

### 9.4 Tempo de consulta por especialidade

- Cada **local de trabalho** do membro define um tempo por especialidade
  (`MembroLocalTrabalho.temposConsulta`, múltiplos de 5, 5–480 min). O agendamento grava
  um **snapshot** da duração (`AgendamentoClinico.duracaoMin`) — mudar o tempo depois não
  reescreve a agenda do passado. A grade da Agenda e o cálculo de conflito usam essa
  duração; sem configuração, cai no **padrão da empresa** (`tempoConsultaPadraoMin`) e,
  na falta, 60 min.
- Dias/horário/tempo em branco **herdam** dinamicamente o expediente da empresa (§15.3).
- Quem tem especialidade e tempo: VETERINARIO (sem informar, assume Clínica Médica),
  FORNECEDOR (aceita nula), GESTOR (opcional); demais perfis (estagiário, enfermeiro,
  secretaria, financeiro) informam **só** local e horário.
- **Restrição por local (2026-08-31):** o checkbox "Atender somente no local de trabalho"
  no membro restringe a lista de pacientes do profissional aos animais cujo local bate com
  um dos locais de trabalho dele válidos para o dia.

### 9.5 Fuso horário por empresa

- A aplicação roda em todo o Brasil (4 fusos). O fuso é **por empresa** e **deduzido do
  endereço** (CEP/UF que o cadastro já coleta) — o gestor **não** escolhe fuso, e ele
  **não** aparece em tela. "Hoje", o expediente, os horários de dose e os lembretes são
  calculados no fuso da clínica, no backend (`lib/fusoEmpresa.js`) e no front
  (`utils/dateUtils.ts`), sempre via `Intl` com `timeZone` explícito. Override raro por
  `EmpresaConfiguracao.fusoHorario` (fora da UI).

---

## 10. Enfermagem — Execução de Prescrição (`/execucao-prescricao`)

- Lista prescrições **FINALIZADAS** aptas a execução no dia (`/prescricoes/grupos/execucao`),
  com busca, paginação e visão do documento.
- Execução por item e por dia: marca os itens administrados (dia atual calculado a partir
  da data de início e duração — mesmo cálculo do backend), horários previstos por
  posologia, dá **baixa real no estoque** (com alerta de insuficiência), registra
  executor e data (`executadoEm`) e lança consumo na fatura quando aplicável.
- Grupo totalmente executado vira `EXECUTADO` (itens travados). Impressão da prescrição.
- Permissão: `enfermagem.prescricao.executar` (estagiários têm EQUIPE por padrão).
- O mesmo modal de execução é reutilizado no Mapa de Atendimento.

---

## 11. Estoque

### 11.1 Farmácia (`/farmacia`)

- Estoque **por clínica/empresa** referenciando o catálogo global de medicamentos.
- Item: medicamento, quantidade, lote e validade (obrigatórios), nº de embalagens e
  peso/volume por embalagem, estoque mínimo e nível alarmante, controlado (sim/não),
  fornecedor (cadastro de fornecedores tipo Farmácia/Laboratório/Loja), valores e nota fiscal.
- Entrada com mesmo medicamento + lote + validade + valor por embalagem (tolerância 1%)
  é **consolidada** no item existente (soma quantidades e valores).
- Indicadores: total, controlados, abaixo do mínimo, abaixo do alarmante; abas de filtro
  (todos/crítico/alarmante/controlados/inativos).
- **Movimentações** imutáveis (ENTRADA / SAÍDA / AJUSTE) com motivo (entradas por nota
  fiscal "NF:..."), gráfico de movimentos por dia.
- **Item "em uso"** = item com pelo menos um movimento de **SAÍDA** (uso real). Só o item
  em uso tem lote, validade, quantidade e embalagens bloqueados na edição; a ENTRADA
  inicial/adicional criada automaticamente não bloqueia nada. Item em uso abre em
  modo visualização, com atalho para o Ajuste de Estoque.
- **Ajuste de Estoque** (botão ao lado de "Entrada de Estoque"): modal com seletor
  pesquisável de item do estoque (nome, lote, quantidade atual); o campo Quantidade em
  Estoque vem **pré-preenchido com a quantidade atual** — o usuário informa a contagem
  real e a diferença (positiva ou negativa) é registrada como movimento AJUSTE com motivo
  obrigatório. Quantidade igual à atual não gera movimento; zerar o estoque é permitido.
  Permissão própria: `farmacia.estoque.ajustar` (VET/ENFERMEIRO: PRÓPRIO; demais: NENHUM;
  GESTOR: bypass) — coluna AJUSTAR na Matriz de Perfis.
- Baixas automáticas ocorrem pela execução de prescrição; reservas pela finalização.

### 11.2 Estoque de Vacinas (`/estoque-vacina`)

- Gestão de **lotes** por clínica: vacina do catálogo (por fabricante), lote, validade,
  frascos × doses por frasco (1–100), total/disponível de doses, validade pós-abertura
  (horas/dias), valor unitário e valor repassado, data de recebimento.
- Indicadores: total de lotes, vencidos, vencendo, total de doses; abas
  todas/ativas/inativas/vencidas/vencendo. Lista responsiva (tabela desktop / cards mobile).
- **Ajuste de Estoque (2026-07-14)** — igual ao da Farmácia: informa a contagem real de
  doses disponíveis, com motivo obrigatório; a diferença é registrada e, se a recontagem for
  maior que o total, eleva o total. `PATCH /vacinas/estoque/:id/ajuste`, slug
  `vacina.estoque.ajustar`, motivo auditado (categoria `AJUSTE`).
- Alimenta a seleção de lotes na aplicação de vacinas (§8.3).

---

## 12. Catálogos globais (ADMIN)

| Catálogo | Tela | Regras |
|---|---|---|
| **Medicamentos** | `/medicamentos` | ~4.900 itens via seed (CSV); nome, fabricante, forma farmacêutica, apresentação, unidade, vias de administração, espécies indicadas, flag vacina, valor. Criar/editar/excluir só ADMIN; leitura livre (usada nos dropdowns clínicos). Endpoint `para-atendimento` retorna itens com situação de estoque da empresa. |
| **Procedimentos** | `/procedimentos` | 301 itens via seed; criar/editar/excluir só ADMIN. |
| **Vacinas (admin)** | `/api/admin/vacinas` + `CadastroVacina.tsx` | Cadastro de vacinas e seus lotes (criar/atualizar/inativar lote). |
| **Laboratórios e exames** | seed + `/api/clinica/laboratorios` | Laboratórios com grupos e itens de exame (tipos de amostra); somente leitura na API. |
| **Exames de imagem** | `/api/clinica/imagem-exames` | 12 grupos / 119 itens via seed; somente leitura. |
| **Espécies e raças** | `/api/especies`, `/api/racas` | Somente leitura (seed). |

---

## 13. Nutrição

### 13.1 Bancos de dados nutricionais (ADMIN edita; leitura livre)

- **Alimentos** (`/alimentos`): banco de alimentos com soft delete.
- **Nutrientes** (`/nutrientes`): banco de nutrientes.
- **Composição Alimentar** (`/composicao`): composição nutricional por alimento/espécie;
  inclui **importação assistida por LLM** (parser de tabela/laudo de composição) e
  importação completa em lote (ADMIN).

### 13.2 Dietas (`/dieta`, `/cria-dieta`)

- **PlanoDieta** por animal agrupando itens de dieta (alimento, quantidades, ocorrências
  de fornecimento). CRUD completo com soft delete via toggle ativo.
- Tela Dieta: visualização da dieta do animal selecionado com filtros
  (todos/ativos/inativos), edição inline de itens, barra de ações (imprimir,
  **compartilhar** por link público, **exportar**) — todas gated por permissão.
- Sugestão/geração de dieta com apoio de IA (Groq).

### 13.3 Análise NRC (`/analise`)

- `GET /api/analise/:animalId` calcula o **balanço nutricional** da dieta ativa versus as
  exigências NRC do animal (peso, categoria, exercício) usando a calculadora equina
  (`nrcCalculatorEquino.js`, registro por espécie em `speciesCalculatorRegistry`).

### 13.4 Exames nutricionais (`/exames`, `/exames/:animalId/novo`)

- Modelo próprio (`ExameNutricional`, API `/api/exames`) — distinto dos exames clínicos.
- Criação por **upload de laudo com extração via LLM** (`analisar-llm`) ou digitação
  manual dos resultados por nutriente; listagem/edição/exclusão por animal.

### 13.5 Relatório Nutricional (`/relatorio-nutricional`)

- Gera relatório do animal (dieta × exigências × exames), com classificação por status
  do nutriente, agrupamento por categoria, snapshot persistido (`RelatorioSalvo`) e
  impressão/exportação.

---

## 14. Resenha e Exame de Compra (equinos)

### 14.1 Resenha (`/resenha`)

- **Resenha descritiva**: nº CBH, país de nascimento, registro de genealogia, pai/mãe/
  pai-da-mãe, sinais da cabeça e membros (AE/AD/PE/PD), pelagem, sinais diversos.
- **Resenha gráfica**: marcação vetorial sobre vistas do cavalo (frente, perfis, posterior,
  focinho) com paleta de marcações padronizadas; salva por vista
  (`PUT /api/animais/:animalId/resenha/:vista` — escrita restrita a ADMIN e VETERINARIO).
- Impressão do documento de resenha.

### 14.2 Exame de Compra (`/exame-compra`)

- Ficha estruturada em 4 abas: **Clínico geral** (inspeção, cardio, respiratório,
  digestório, urogenital, nervoso, cascos), **Fisiologia**, **Músculo-esquelético**
  (locomoção em linha reta/círculo/piso duro-macio, testes de flexão por articulação com
  graus `- ± + ++ +++` por membro AE/AD/PE/PD) e **Imagem** (partes radiografadas).
- Vira um exame clínico tipo "Compra" no histórico; impressão de laudo próprio
  (`ExameCompraPrint`).

---

## 15. Financeiro

### 15.1 Faturamento (`/faturamento`)

- Fatura **mensal por proprietário** (`mesReferencia "AAAA-MM"`), consolidando todos os
  animais. Status: `ABERTA → FECHADA → PAGA` (+ `CANCELADA`).
- A tela lista proprietários do escopo com fatura ativa/fechada/última paga; detalhe da
  fatura com itens por animal (tipo `ASSISTENCIA`/`MEDICAMENTO`/`PROCEDIMENTO`,
  descrição, valor unitário, quantidade, total), edição inline de itens, remoção e
  **lançamento manual** (catálogo rápido: GTA, Assistência Veterinária, Atd. Emergencial,
  ou item livre). O lançamento manual permite **vincular um animal** (seletor no form,
  opcional) — assim itens como "Atd. Emergencial" aparecem por cavalo/localização no
  relatório emergencial (antes ficavam sem animal).
- Lançamentos automáticos de origem clínica (prescrição executada, exame finalizado,
  vacina, encaminhamento) entram na fatura ABERTA do mês (criando-a se preciso) e ficam
  **rastreados** por FK; editar/excluir a origem sincroniza os itens da fatura na mesma
  transação — bloqueado com erro `FATURA_PAGA` se a fatura já estiver paga.
- Proprietário **mensalista**: item "Assistência Veterinária Mensal" é lançado
  automaticamente no fechamento (idempotente).
- Fatura `FECHADA` ainda aceita edição de itens e lançamentos manuais; `PAGA` é imutável.
- Qualquer edição/remoção de item existente registra **correção** na fatura
  (`qtdCorrecoes`, `ultimaCorrecaoEm` — alimenta o relatório gerencial); a remoção
  manual de item também exige **justificativa obrigatória** (auditada como
  EXCLUSAO/FATURA_ITEM).
- Ações: imprimir/PDF, exportar CSV, compartilhar (WhatsApp), fechar fatura, mudar
  status. PROPRIETARIO acessa a própria fatura (visualização).

### 15.2 Fechamento automático

- Cron diário às **23:45** decide por fatura, conforme a configuração do escopo do
  proprietário: `DIA_FIXO` (1–31, com clamp para meses curtos), `DIA_UTIL` (1º–10º dia
  útil — desconta fins de semana e feriados nacionais federais, com Sexta-feira Santa
  calculada pelo algoritmo de Gauss) ou `ULTIMO_DIA_MES` (padrão/fallback).
- O **horário do cron** (assim como os demais) é **editável em runtime** pela tela de
  Configuração de tarefas (§20) — reagendamento dinâmico do node-cron a partir do banco.

### 15.3 Configurações da empresa (`/configuracoes`, GESTOR)

- **Logotipo** da empresa/equipe (upload com compressão; usado em relatórios e impressões)
  e **regra de fechamento de fatura** (4 opções na UI: último dia do mês, primeiro dia do
  mês, dia específico, dia útil N). Configuração única por empresa (CNPJ) ou por equipe
  (empresa pessoal).
- **WhatsApp da empresa** — número para envio/recebimento de mensagens. Máscara BR na UI
  `(11) 98765-4321`; persistido somente com dígitos (`EmpresaConfiguracao.whatsapp`,
  validação 10–15 dígitos no backend); campo em branco remove o número. O campo apenas
  armazena o número — a integração de mensageria em si ainda não existe.
- **Expediente de atendimento** — dias da semana (toggles Dom–Sáb) e faixa de horário
  (abre/fecha) em que a clínica atende (`EmpresaConfiguracao.diasAtendimento` CSV 0-6,
  `horaInicioAtendimento`/`horaFimAtendimento` HH:MM). Usado pela Agenda (§9.1). Ao salvar,
  redireciona para o Mapa de Atendimento.
- **Espécies atendidas** e **expediente** viraram **obrigatórios** na tela (2026-08-01) —
  o salvar recusa (400) com dia/hora/espécie vazios. A UI oferece Equino e Bovino
  (`ESPECIES_PERMITIDAS`). As espécies filtram as especialidades oferecidas nos cadastros.
- **Tempo de consulta padrão** da empresa (`tempoConsultaPadraoMin`) — herdado pelos
  locais de trabalho sem tempo próprio (§9.4).
- **Validade do orçamento** (`validadeOrcamentoDias`, `null` = não expira) — passado o
  prazo desde a criação, o cron `cancelar_orcamentos_vencidos` cancela o orçamento (exceto
  Aprovado/Aprovado Parcialmente) com o motivo acrescentado à observação.
- O **fuso horário** não aparece nesta tela — é deduzido do endereço (§9.5).

### 15.4 Orçamento (`/orcamento`) — etapa OPCIONAL

- Orçamento por **proprietário** (`Orcamento`/`OrcamentoItem`), etapa opcional antes do
  atendimento. Item de tipo **PROCEDIMENTO · COMBO · MEDICAMENTO · VACINA · OUTROS**,
  rateado por animal (ou no nível do proprietário via "Não selecionar animais").
- **Medicamento** captura posologia (dias + frequência) → a quantidade cobrada é derivada
  e volta preenchida na importação para a Prescrição. **Vacina** captura Tipo Dose + Via
  (obrigatórios) + nº de doses. **OUTROS** é cobrança avulsa (nome, qtd, valor).
- Status: `RASCUNHO`, `ENVIADO`, `APROVADO`, `APROVADO_PARCIALMENTE`, `REJEITADO`,
  `CANCELADO`. Envio por WhatsApp/e-mail (PDF). Cancelamento manual e por validade (§15.3).
- **Importação clínica:** itens ACEITOS (exceto OUTROS) entram na Prescrição/Vacina do
  atendimento (`GET /orcamentos/para-importar`), preenchendo posologia/dose. O item
  **OUTROS** vai **direto para a fatura** em Financeiro (botão "Importar do orçamento") —
  sem trava de "importar os demais antes" (removida em 2026-08-01; virou só aviso).
- Desconto por item também existe na **fatura** (`FaturaItem.descontoTipo`/`descontoValor`,
  PERCENTUAL ou VALOR) — o total é sempre a soma do **líquido**.

---

## 16. Relatórios gerenciais (`/relatorios`)

Módulo do gestor (permissão `relatorios.gerencial.ler`: GESTOR FULL, FINANCEIRO EQUIPE,
demais NENHUM), escopado pela empresa ativa. Endpoint único
`GET /api/relatorios/gerencial` com 8 cards:

1. **Atendimentos emergenciais** — lançamentos "Atd. Emergencial" em faturas não
   canceladas: total, por cavalo e por localização.
2. **Receita por localidade** — bruta (faturado: ABERTA/FECHADA/PAGA) × líquida
   (recebido: somente PAGA), agrupada pela localização do animal do item.
3. **Devedores** — proprietários com fatura ABERTA/FECHADA de meses anteriores: meses em
   atraso (desde o mês devido mais antigo), qtd de faturas e total devido.
4. **Melhores pagadores** — ranking por total pago, com selo "em dia".
5. **Animais sem atendimento** — faixas +3/+7/+15 dias/+1 mês desde a última evolução
   (inclui "nunca atendido").
6. **Animais por localização** — contagem de ativos por localização.
7. **Faturas editadas/corrigidas** — total e lista (proprietário, mês, nº de correções,
   última correção). Conta a partir da criação do rastreio (migration 2026-07-07).
8. **Evoluções editadas após finalização** — evoluções FINALIZADAS alteradas depois de
   `dataFim` (tolerância 60s), com atendimento, animal, **responsável original** e quem
   editou.

**Seletor de período (2026-07-14).** No topo de todos os submódulos há um seletor único
**Dia | Semana | Mês | Ano** + data (◀▶ e "Hoje"), persistido em localStorage e compartilhado
entre os submódulos (`PeriodoContext`/`PeriodoSelector`). O backend deriva a janela
`[inicio,fim]` a partir de `granularidade`+`data` (`resolverPeriodo`); métricas de janela
filtram por ela e "snapshots" (base ativa, posição de estoque) são as-of a data escolhida.
Semana = domingo a sábado.

**Submódulos por categoria** (mesma permissão `relatorios.gerencial.ler`, escopo por empresa):
`/relatorios` (Gestão, os 8 cards acima), `/relatorios/financeiro` (faturamento no período,
ticket médio, receita por categoria/especialidade, contas a receber, fluxo de caixa, lucro
bruto), `/relatorios/atendimento`, `/relatorios/cadastro` (novos pacientes/clientes),
`/relatorios/farmacia` (posição de estoque, validades, consumo). As tabelas são responsivas:
tabela no desktop e **cards empilhados no mobile** (rótulo:valor, via `RelatorioUI.Tabela`).

---

## 17. Dashboards e telas iniciais por perfil

| Perfil | Home | Conteúdo |
|---|---|---|
| VETERINARIO / ESTAGIARIO / ADMIN | `/mapa-atendimento` (redirect automático de `/`) | Mapa de Atendimento (§9.3). |
| PROPRIETARIO | `/` (Dashboard) | Onboarding exclusivo do proprietário (saudação → cadastro pessoal → cadastrar primeiro animal → boas-vindas); depois, card do animal selecionado com dados e atalhos. |
| GESTOR / FORNECEDOR | `/` | Sem onboarding de animal; estado vazio padrão quando não há animais. |
| VetDashboard (`/vet-dashboard`) | — | Estatísticas do vet, solicitações pendentes com `SolicitacaoCard` (visual por tipo), gráfico. |
| ClinicaDashboard (`/clinica-dashboard`) | — | Tabela de pacientes com acesso rápido aos módulos clínicos. |
| Dashboard stats (backend) | `GET /api/dashboard/stats` | Atendimentos hoje, pacientes/clientes ativos, estoque crítico, atendimentos/dia (30 dias), top medicamentos e procedimentos. |

**Bloqueio de módulos (Sidebar):** PROPRIETARIO precisa de cadastro completo (telefone +
endereço + CEP) **e** ao menos um animal; os demais perfis precisam apenas do cadastro
completo. Banner com a mensagem correspondente ao perfil.

**Shell global (2026-07-31).** A aplicação tem um **cabeçalho** (marca do produto, **busca
global**, sino de notificações e menu do usuário — identidade, perfil, Cadastro Pessoal,
Configurações do gestor e **Sair**), o corpo (Sidebar + conteúdo, único elemento que rola)
e um **rodapé** (logomarca da clínica + marca do produto). O seletor de contexto ativo e o
card da clínica (só o logo) ficam na Sidebar. Página institucional **pública** em `/`
para quem não está logado (`Home.tsx`); logado, `/` cai no destino do perfil.

**Busca global** (`GET /api/busca?q=`): pacientes, atendimentos (evoluções) e agendamentos
da **empresa ativa**, cada resultado já com a rota de destino. Escopo intersectado com
`req.empresaId` (nunca "todos os vínculos") e permissão **por grupo** (`animais.ler` /
`atendimento.evolucoes.ler` / `atendimento.agendamentos.ler`), resolvida em runtime.

**Sidebar:** Mapa de Atendimento; **Agendamento**; **Atendimento** (folha, leva à Agenda do
paciente — Evolução/Prescrição/Exames/Encaminhamento são as abas de lá); **Vacina** e
**Execução de Prescrição** no primeiro nível; **Painel Principal**; Geral (Relatórios,
Configurações, Cadastro: Pessoal/Pacientes/Proprietários/Tratadores/Fornecedores/
Prestadores/Localizações, Auditoria); Estoque (Farmácia/Vacina); Nutricional (Dieta,
Relatório e, para ADMIN, Alimentos/Nutrientes/Composição); Financeiro (Faturamento,
Orçamento); Documentos; Equipe/Controle de Acesso; Administração. Cada item aparece
conforme `podeExecutar(slug.ler)`.

---

## 18. Notificações (polling in-app)

| Hook | Alvo | Comportamento |
|---|---|---|
| `useProprietarioNotificacoes` | PROPRIETARIO | Polling 15s em `/animais/minhas-solicitacoes`; toasts para aceite/recusa de vínculo, desvinculo iniciado pelo vet, novas solicitações V→P; janela retroativa de 10 min para eventos ocorridos fora da sessão. |
| `useVetSolicitacaoMonitor` | VETERINARIO | Polling em `/veterinarios/solicitacoes`; detecta novas solicitações e cancelamentos. |
| `useVetPendentes` | VETERINARIO | **Store único de módulo** — um só polling (30s) compartilhado pelo badge de Pacientes (Sidebar) **e** pelo sino do cabeçalho. Consumo em dois lugares com um estado cada daria polling dobrado e dois toasts para a mesma solicitação. |
| `VetNotificationModal` | VETERINARIO | Modal bloqueante com solicitações recebidas (rastreio de vistos em localStorage; vets convidados não veem). |

E-mails transacionais (`emailService`): solicitação de vínculo (para vet e para
proprietário), confirmação de vínculo, desvinculo, troca de vet, boas-vindas de
proprietário, convite de equipe, reset de senha. Links de e-mail sempre com `/#/` (HashRouter).

---

## 19. Inteligência Artificial

**Provedor único: Google Gemini (2026-07-28).** Groq, OpenAI e Anthropic foram
**removidos**. Todo acesso a LLM — texto, visão e transcrição de áudio — passa por
`src/ai/geminiClient.ts` (modelo `GEMINI_MODEL`, default `gemini-3.1-flash-lite`). Toda
chamada declara o **módulo de origem** (`MODULOS_IA`) e o **`empresaId`**.

| Operação | Onde | Descrição |
|---|---|---|
| Interpretar evolução | Finalizar evolução / Atendimento | Extrai ações clínicas estruturadas e sugere título. Degradação graciosa. |
| Transcrição de áudio | Evolução/Prescrição | Gemini no backend (WebM/Ogg transcodificados antes); Web Speech API online no cliente. |
| Agendamento por voz | Agenda | Interpreta o ditado e pré-preenche o agendamento. |
| Análise de laudo | Exames nutricionais / resultado de exame clínico | Upload → extração de resultados por parâmetro. |
| Parser de composição | Composição (ADMIN) | Extração de tabela nutricional (texto e visão). |
| Laudo equino (mapa corporal) | Relatório de Atendimento | Mapa corporal + escores; cache versionado. |
| **Memória Clínica do paciente** | Tela do animal (`MemoriaClinicaPanel`) | `memoria_clinica@v1` — highlights factuais entre atendimentos + tópicos clicáveis até o registro de origem. Incremental (só recalcula com evento novo); anti-alucinação (ids atribuídos pelo serviço). Não sugere conduta nem diagnostica. |
| **IA Financeira** | Relatórios > Financeiro (`AnaliseFinanceiraIA`) | `analise_financeira@v1` — análise gerencial do período **sob demanda** (botão). Descreve/quantifica; não recomenda ação. |
| **Assistente de documentos** | Central de Documentos | `assistente_documento@v1` — chat ancorado no acervo de modelos (§8.6). |
| **AiUsageDashboard** (`/ai-usage`) | Resumo p/ autenticados; detalhes/log e **planos por empresa** só ADMIN | Tokens entrada/saída, custo, latência, sucesso, consumo por módulo e **por empresa**. |

**Metering e quota por empresa (2026-07-28):** conta única no Google + medição interna
por tenant. `AiUsageLog.empresaId` e `IaPlanoEmpresa` (limite de tokens/chamadas por mês,
`bloquearAoExceder`). O gate `garantirQuota` roda **dentro** de `callAI`, antes de gastar
token; estouro com bloqueio → **HTTP 429** (`IA_QUOTA_EXCEDIDA`). Sem empresa (ADMIN, job)
não bloqueia. Prompts versionados (`operacao@vN`); toda inferência logada em `AiUsageLog`.

---

## 20. Administração e auditoria

- **Usuários** (`/usuarios`, ADMIN): CRUD completo com perfil de acesso
  (VETERINARIO/ESTAGIARIO/PRESTADOR/GESTOR), criação sem senha (padrão `Inicial_001` +
  troca obrigatória; e-mail de boas-vindas quando proprietário), edição com nova senha,
  ativar/desativar. Formulário compartilhado `UsuarioFormModal` (abas Dados/Endereço,
  CEP automático) — o mesmo usado pelo gestor em Equipe.
- **Equipe** (`/equipe`): gestão da equipe ativa — renomear equipe, incluir membro
  (convite ou inclusão direta de fornecedor), editar membro (gestor edita membros da
  própria equipe, inclusive senha; gestor não edita gestor), ativar/desativar.
- **EquipeManager** (`/equipe-manager`, ADMIN): visão de todas as empresas, equipes,
  membros e convites pendentes.
- **Auditoria** (`/auditoria`): log de acesso legado (login/logout via `AuthContext`).
- **Auditoria de exclusões/cancelamentos** (`/auditoria-geral`, Sidebar > Geral,
  GESTOR/ADMIN): **toda exclusão ou cancelamento na aplicação exige justificativa
  obrigatória** (evolução, prescrição/itens, exames clínicos e nutricionais, vacinas,
  encaminhamentos, agendamentos, estoque de farmácia e de vacinas, itens de dieta,
  catálogos ADMIN de medicamentos/procedimentos e — desde 2026-07-10 — exclusão de
  animal, remoção manual de item de fatura e remoção de proprietário da empresa).
  O motivo é coletado pelo modal padrão
  `ModalJustificativa`, validado no backend (400 sem motivo) e gravado no `AuditLog`
  estruturado (entidade, id, animal, motivo, detalhes, usuário, empresa e **IP de
  origem**). A tela lista os registros com filtros por categoria, tipo de registro, busca
  textual (inclusive por **nome do paciente**) e período, com paginação; GESTOR vê a
  empresa ativa e ADMIN vê tudo (`GET /api/audit/logs`).
- **Categorias de auditoria** (`lib/auditoria.js`): `CRIACAO`, `ALTERACAO`, `EXCLUSAO`,
  `CANCELAMENTO`, `TRANSFERENCIA` (troca de responsável: dono anterior → novo, com a
  origem da cascata), `ACESSO_NEGADO` (tentativa **bloqueada** — 403 de permissão/animal e
  falha de login/2FA, em escopo de plataforma) e `CONFIGURACAO`. Cada uma tem badge e
  filtro próprios; o modal Visualizar mostra o "antes → depois" por campo. As telas de
  auditoria **não exibem referências numéricas** (`#65`) — o id já é coluna.
- **query-adhoc** (`/query-adhoc`): página utilitária de consulta ad-hoc (dev).

### 20.1 Tarefas agendadas — Configuração, Monitoração e agenda dinâmica (2026-07-14)

Tarefas de cron do sistema (globais): `crmv_sync` (SISCAD), `auto_aceite` (solicitações
>24h), `vinculos_provisorios`, `lembrete_d1_email`, `lembrete_whatsapp`,
`fechamento_faturas`. Acesso das telas abaixo: **ADMIN ou GESTOR** (Sidebar > Administração).

- **Configuração** (`/configuracao-alertas`): (a) **alertas por e-mail** — destinatários
  (em branco = usuários ADMIN), "avisar sucessos relevantes" (desligado = só erros),
  ligar/desligar; (b) **agendamento das tarefas** — expressão cron editável por tarefa +
  ligar/desligar, com **reagendamento dinâmico** (aplica ao vivo, sem reiniciar o backend).
  Salvar redireciona para a Monitoração.
- **Monitoração** (`/monitoracao`): histórico das execuções relevantes (erros + sucessos
  com trabalho) por **Dia | Semana | Mês** — totais (execuções/sucessos/erros/alertas),
  resumo por tarefa e lista de eventos (marcando os enviados por e-mail).
- **Regra de alerta:** erro **sempre** notifica (se ativo); sucesso só quando a tarefa fez
  trabalho relevante (evita spam nos crons frequentes). Todo evento relevante é registrado
  para a Monitoração, independentemente do e-mail.
- Modelos: `CronAlertaConfig` (config de e-mail), `CronExecucao` (histórico), `CronAgenda`
  (expressão/estado por tarefa). Backend: `lib/cronManager.js` (registrar/iniciar/reagendar),
  `lib/cronAlert.js` (`reportarCron`), `MonitoracaoController`, rotas
  `GET/PUT /api/monitoracao/{config,execucoes,agendas}`.
- **Execução manual com rastro (2026-08-23):** botão "Executar agora" na Configuração
  (`POST /api/monitoracao/agendas/:chave/executar`, **ADMIN da plataforma** — o job varre
  todas as empresas), `npm run job -- <chave>` na linha de comando, e trace passo-a-passo
  (`lib/cronTrace.js`) que registra a **decisão** ("hoje não é dia"), não só o resultado.
  ⚠️ Roda a tarefa **de verdade** (grava e dispara WhatsApp/e-mail — não há simulação).
- **Jobs adicionais:** `cancelar_agendamentos_nao_realizados`, `cancelar_orcamentos_vencidos`,
  `marcar_faturas_atrasadas`, `cancelar_doses_prescricao_perdidas`, `limpeza_desafios_2fa`,
  além dos já citados. Dentro de `paraCadaEmpresa`/`comTenant`, todo acesso ao banco passa
  pelo cliente da transação — sob RLS, o `prisma` global ali enxergaria **zero** linha.

---

## 21. Impressões e exportações (`frontend/src/utils`)

| Utilitário | Documento |
|---|---|
| `EvolucaoPrint` | Evolução clínica individual. |
| `AtendimentoPrint` | Atendimento completo (evolução + prescrições detalhadas + demais registros), com pré-visualização em iframe A4. |
| `PrescricaoPrint` | Documento de prescrição. |
| `ExamePrint` / `ExameCompraPrint` | Requisição de exames / laudo de exame de compra. |
| `RelatorioAtendimento` | Laudo com mapa corporal e escores (IA). |
| `FaturaExport` | Fatura em PDF de impressão, CSV e compartilhamento. |
| `Dietaprint` | Dieta do animal. |
| `VetPrint` | Impressões do veterinário. |
| `gerarPdf` / `printUrl` | Infra comum de geração/abertura de impressão. |

Impressões usam o **logotipo da empresa/equipe** quando configurado (fallback marca S2Vet).

---

## 22. Segurança (implementado)

- **Isolamento multi-tenant por Row-Level Security (fail-closed).** 72 tabelas com RLS
  `ENABLE + FORCE`; a role da aplicação (`zls2vetp1`) **não** é superusuária, não tem
  `BYPASSRLS`, não é dona de tabela e não pode desligar policy. O `authenticate` carimba a
  empresa do contexto ativo (`app.empresa_id`, via `AsyncLocalStorage` +
  `lib/prismaTenant.js`) em toda operação; **sem** contexto declarado, toda tabela de
  tenant devolve zero linha. Uma clínica não lê, escreve, atualiza nem exclui dados de
  outra — nem pedindo explicitamente o `empresa_id` alheio (WITH CHECK barra o INSERT
  cruzado). Header `x-empresa-id`/`x-equipe-id` é **validado** contra o vínculo antes de
  virar contexto; valor alheio é ignorado. Catálogos globais (medicamentos, especialidades,
  os 12 modelos CFMV) têm `empresa_id` nulo e são compartilhados por design.
- **Storage no banco (2026-08-04).** Todo arquivo mora em `tb_midia_arquivos` (bytea);
  **nada** é servido do filesystem (`express.static` removido). Download por
  `GET /api/midia/:chave`, autenticado e autorizado por dono (animal/empresa/autor) —
  negado responde 404. Teto de 150 MB no provider. Interface `StorageProvider` permite
  trocar para S3/GCS mudando só `STORAGE_DRIVER`, sem tocar controller e mantendo o bucket
  privado. Marca do produto pública por `GET /api/marca` (sem parâmetro).
- **Sessão por cookies HttpOnly + janela de inatividade (2h).** Access JWT curto (30 min)
  e refresh rotacionado a cada uso (fonte única `lib/sessionTokens.js`), em cookies
  `HttpOnly`, `SameSite=Lax`, `Secure` em produção. `sessionVersion` revoga sessão antiga
  no login novo. `JWT_SECRET` validado no startup por **entropia** (não só comprimento);
  aviso se `JWT_REFRESH_SECRET` for derivado/ausente.
- **2FA por e-mail** (código CSPRNG, SHA-256, tempo constante, rate limit próprio) — §3.
- **Bloqueio por tentativas** (6 falhas) e **sem enumeração de usuário** por conteúdo nem
  por **timing** (login com bcrypt de isca; forgot-password com envio em segundo plano).
- **Rate limit** por **usuário** autenticado (`jwt.verify`, não decode; fallback por IP com
  `ipKeyGenerator` para IPv6): 300/min geral, 20/15min em `/auth`, limites próprios no 2FA.
- **`trust proxy`** (`TRUST_PROXY_HOPS`, default 1); Helmet (CSP, HSTS, nosniff, X-Frame);
  CORS com allowlist via `ALLOWED_ORIGINS` (com `credentials`); a proteção CSRF é o
  `SameSite=Lax` (front e back na mesma origem).
- **Uploads** com whitelist de extensão + mimetype e `limits.fileSize` por rota; formato
  não suportado → 415, tamanho → 413. Varredura de secrets no CI (`gitleaks`, job
  `secret-scan`) impede reintroduzir chave no código.
- **Auditoria com IP de origem** em login/logout, tentativas negadas e
  exclusões/cancelamentos/transferências (`AuditLog.ip`, derivado no servidor).
- Registro restrito a PROPRIETARIO/VETERINARIO (allowlist no `create` — `role`/`isAdmin` do
  body são ignorados); console suprimido em produção; `x-request-id` em todo request; logs
  estruturados (Winston); 403 de GET silencioso no frontend.

---

## 23. Limitações e comportamentos conhecidos (fiéis ao código atual)

1. ~~Slugs órfãos `exames.laboratorial.*`/`exames.imagem.*`~~ — **resolvido**: controlam
   o fluxo de **resultado** de exame (§8.4).
2. ~~VacinaClinica sem fluxo de finalização~~ — **resolvido**: ciclo
   `SALVA → FINALIZADA → EXECUTADA` com reserva de estoque (§8.3).
3. ~~Autoria clínica 100% RBAC~~ — **revertido em 2026-08-04**: vale a **premissa de
   autoria** (a ação vale sobre o que a pessoa criou/assumiu; só o gestor opera o de
   outro), com arrasto do atendimento e auditoria de transferência/alteração (§5.3). Nível
   `FULL` da matriz **não** dá acesso ao registro alheio.
4. ~~Multi-tenant sem RLS~~ — **implementado**: Row-Level Security fail-closed em 72
   tabelas; `EvolucaoClinica`/`Fatura`/documentos têm `empresa_id` próprio (§22).
5. ~~Uploads em disco local~~ — **substituído**: arquivo no banco, download autorizado por
   dono (§22). O acesso à mídia passou a ser vinculado à sessão.
6. **Cadastro via Google** cria conta como PROPRIETARIO fixo.
7. **Documento (CPF/CNPJ) da empresa é obrigatório e único** entre empresas (2026-08-16) —
   só o ADMIN da plataforma cria empresa (com plano e gestores); o gestor não cria mais a
   própria. Alguns caminhos legados de bootstrap ainda criam empresa sem documento.
8. **WhatsApp:** integração real via Evolution API (`infra/evolution/`,
   `WHATSAPP_PROVIDER=evolution`); webhook autenticado por token.
9. **i18n** (`react-i18next`) está preparado, mas as telas usam strings em pt-BR hardcoded.
10. **Push/notificação nativa** ainda não implementada (plano em `docs/NOTIFICACOES-PUSH-PLANO.md`).
11. **2FA por empresa** não existe (só o 2FA global do ADMIN) — plano em
    `docs/2FA-POR-EMPRESA-PLANO.md`. O bloco `qrcode` de documentos ainda é placeholder.

---

## Anexo A — Mapa de rotas da API (resumo)

| Prefixo | Recurso |
|---|---|
| `/api/auth` | register, login, forgot/reset-password, refresh, logout, google |
| `/api/users` | /me (perfil próprio + senha), CRUD ADMIN, buscar-proprietario |
| `/api/animais` | CRUD, buscar-por-nome, vínculos/solicitações, logo-empresa |
| `/api/veterinarios` | perfil, meus-animais, solicitações (+ resposta via e-mail) |
| `/api/clinica/evolucoes` | CRUD, interpretar, transcrever, aprovar, cancelar, título, mídias, relatório-atendimento, resumo-ia |
| `/api/clinica/prescricoes` | grupos (CRUD, itens, finalizar, cancelar, executar, execução do dia), itens legados |
| `/api/clinica/vacinas` | catálogo ativo, lotes disponíveis, registrar, listar, excluir |
| `/api/clinica/exames` | exames clínicos (CRUD + finalizar) |
| `/api/clinica/encaminhamentos` | prestadores por animal, CRUD, finalizar, status |
| `/api/clinica` (agenda.js) | histórico do animal (+resumo), agendamentos (CRUD, status, transferir-dia, interpretar voz) |
| `/api/clinica/faturas` | proprietários, fatura do proprietário, itens, fechar, status |
| `/api/clinica/laboratorios`, `/api/clinica/imagem-exames` | catálogos de exames |
| `/api/exames` | exames nutricionais (upload + LLM) |
| `/api/dietas` | planos e itens de dieta, compartilhar |
| `/api/analise` | balanço NRC |
| `/api/relatorio` | relatório nutricional por animal |
| `/api/relatorios` | relatórios gerenciais |
| `/api/alimentos`, `/api/nutrientes`, `/api/composicoes-alimentares` | bancos nutricionais (escrita ADMIN) |
| `/api/medicamentos`, `/api/procedimentos` | catálogos (escrita ADMIN) |
| `/api/farmacia` | estoque + movimentos + ajuste |
| `/api/vacinas/estoque`, `/api/admin/vacinas` | lotes de vacina / catálogo admin |
| `/api/equipes` | empresas, meus-contextos, setup, minha equipe, convites, membros, permissões (matriz, membro, proprietários, auditoria, perfis), fornecedores da equipe, configurações |
| `/api/cadastro/proprietarios|tratadores|fornecedores|localizacoes` | cadastros |
| `/api/resenha`, `/api/animais/:id/resenha` | resenha descritiva e gráfica |
| `/api/mapa-atendimento` | resumo do mapa |
| `/api/dashboard` | estatísticas |
| `/api/busca` | **busca global** do cabeçalho (pacientes/atendimentos/agenda, escopo por empresa) |
| `/api/documentos` | Central de Documentos (templates, emitidos, contexto do paciente, chat IA, compartilhar) |
| `/api/orcamentos` | orçamentos (importar p/ clínica, lançar OUTROS na fatura) |
| `/api/midia`, `/api/marca` | download autorizado de arquivo / marca do produto (público) |
| `/api/ai-usage` | monitoramento e **planos de IA por empresa** (ADMIN) |
| `/api/monitoracao` | crons: config de alertas, execuções, agenda dinâmica, executar-agora |
| `/api/planos`, `/api/empresas` | planos SaaS / cadastro do assinante (ADMIN) |
| `/api/seguranca` | config global de 2FA (ADMIN) |
| `/api/cadastro/prestadores`, `/api/cadastro/tipos-servico` | prestadores e catálogo de tipos de serviço |
| `/api/admin/exportacao` | exportação de prontuário (gestor/ADMIN) |
| `/api/fatura-publica`, `/api/l` | link público da fatura (token) / redirect curto — **sem** login |
| `/api/webhooks` | webhook da Evolution API (token em query) |
| `/api/audit` | log de auditoria |
| `/api/crmv` | validação CRMV (CFMV) |
| `/api/especies`, `/api/racas`, `/api/especialidades`, `/api/produtos` | apoio |
| `/health` | health check (status do banco, uptime, versão) |
