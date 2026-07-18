# S2Vet — Especificação Funcional

> Documento gerado por varredura do código-fonte em 2026-07-09 (atualizado em 2026-07-14).
> Descreve fielmente o que está construído — sem propostas, sem melhorias.
> Fontes: rotas do backend (`backend/src/routes/*`), controllers, seeds de permissão,
> schema Prisma, páginas e componentes do frontend (`frontend/src/*`) e CLAUDE.md.

---

## 1. Visão geral

O **S2Vet** é uma plataforma hospitalar veterinária SaaS, mobile-first, com foco atual no
atendimento clínico e nutricional de **equinos** (estrutura preparada para multi-espécie).

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, HashRouter (`/#/rota`).
- **Backend:** Node.js + Express + Prisma, PostgreSQL (schema `schs2vet`), porta 3001.
- **Autenticação:** JWT + refresh token (rotação) em **cookies HttpOnly**, login por
  e-mail/senha e Google OAuth.
- **IA:** Groq (LLM) para interpretação de textos clínicos, laudos e voz; Whisper para
  transcrição offline; uso registrado em `AiUsageLog`.
- Exclusão de registros clínicos é sempre **soft delete** (campo `ativo`).
- **Modais arrastáveis no desktop:** qualquer modal da aplicação pode ser reposicionado
  arrastando pelo cabeçalho ou título (hook global `useDraggableModals`, montado no
  `App.tsx`). Só com mouse e viewport ≥ 768px; o backdrop não se move, o modal não pode
  sair da tela e fechar/reabrir volta à posição original.

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
| Login e-mail/senha | `POST /api/auth/login` → JWT (24h) + refresh (JWT 30d) em **cookies HttpOnly** (`s2vet_at`/`s2vet_rt`). Rate limit 20 req/15min em `/auth`. |
| Login Google | `useGoogleLogin` com `prompt: 'select_account'`; o backend valida o `access_token` no Google antes de emitir o JWT interno (também em cookies HttpOnly). |
| Refresh automático | Interceptor Axios renova a sessão em 401 via `POST /api/auth/refresh` (refresh vem do cookie; rotaciona e reescreve os cookies) sem redirecionar para login. |
| Esqueci minha senha | `POST /api/auth/forgot-password` — resposta sempre 200 genérica (não revela se o e-mail existe). Link por e-mail → `/#/reset-password?token=...`. |
| Reset de senha | `POST /api/auth/reset-password` (mínimo 8 caracteres). |
| Troca de senha obrigatória | Usuários criados com senha padrão `Inicial_001` têm `mustChangePassword` e são bloqueados na tela `/alterar-senha` até trocar. |
| Logout por inatividade | 5 minutos sem interação → logout automático (frontend). |
| Logout | Revoga o refresh token no backend, **limpa os cookies HttpOnly** e o contexto ativo do storage. |
| Conta desativada | Qualquer request autenticado de conta com `ativo=false` é rejeitado com 401. |
| Auditoria de sessão | LOGIN e LOGOUT são gravados em `AuditLog` (`POST /api/audit/log`) com o **IP de origem**. |

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
- **Catálogo de módulos** (`ModuloSistema`, 124 slugs via seed): módulos `cadastro.*`
  (proprietário, tratador, fornecedor, localização), `dashboard.geral`, `animais`,
  `atendimento.*` (evoluções, prescrições, vacinas, encaminhamentos, exames,
  agendamentos), `enfermagem.prescricao`, `exames.laboratorial/imagem` (órfãos — ver
  §22), `nutricao.dietas/relatorios`, `financeiro.faturas`, `equipe.membros`,
  `vacina.estoque`, `farmacia.estoque/movimentacoes`, `medicamentos.catalogo`,
  `procedimentos.catalogo`, `relatorios.gerencial`.
  Ações possíveis: ler, criar, editar, deletar, imprimir, finalizar, executar, ativar,
  exportar, compartilhar, desvincular, whatsapp, fechar, lancar.

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
- Regras de autoria em registros clínicos — **100% dirigidas pelo RBAC** (nenhuma regra
  de cargo fixa no backend; a única exceção fixa é o bypass de ADMIN):
  - O controller decide autoria pelo **nível efetivo da matriz** (`req.permissaoNivel`)
    no slug da ação, via `podeOperarRegistro`: nível `PROPRIO` → só o próprio registro;
    `EQUIPE`/`FULL` → qualquer registro da equipe.
  - "Só o gestor finaliza uma evolução" é **configuração** (o seed dá VET/EST `NENHUM`
    em `*.finalizar`), não código — o gestor pode conceder finalizar a qualquer perfil.
  - Editar registro FINALIZADO (evolução) exige nível `FULL` em editar; excluir evolução
    finalizada segue restrito a ADMIN.
  - Aplicado em evolução, prescrição (item e grupo), exame clínico, encaminhamento e
    agendamento. O escopo de dados do prestador (designação) permanece deny-by-default.

---

## 6. Cadastros

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

### 6.6 Localizações (`/cadastro/localizacoes`)

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
nomes duplicados por proprietário), card do animal, banner "**Atendimento EV-XXXX em
andamento**" com botão **Finalizar Atendimento** (mesma ação do finalizar da aba
Evolução: valida texto, finaliza a evolução ativa, gera título via LLM em best-effort;
com confirmação; respeita permissão de finalizar e autoria de fornecedor), abas:
**Agenda · Evolução · Prescrição · Vacina · Exames · Encaminhamento**, e painel lateral
**Histórico do Paciente** (timeline agrupada por atendimento AG-/EV-, com expansão,
impressão e pré-visualização do atendimento completo, e botão Editar/Continuar que
carrega todos os registros do atendimento nas abas correspondentes). No mobile o
histórico abre por botão flutuante.

### 8.1 Evolução (prontuário)

- Numeração `EV-0001` (avulsa) ou herdada do agendamento (`AG-XXXX`). Status:
  `EM_ANDAMENTO`, `FINALIZADA`, `CANCELADA`. Apenas **uma evolução em andamento** por
  animal (criar nova exige finalizar/cancelar a atual).
- Campos: especialidade (15 opções: Acupuntura, Cardiologia, Cirurgia, Clínico,
  Dermatologia, Diagnóstico por Imagem, Ferrageamento, Fisioterapia, Neurologia,
  Nutrição, Odontologia, Oftalmologia, Patologia, Quiropraxia, Radiologia), texto livre,
  título (opcional; sugerido por LLM ao finalizar), vínculo opcional a agendamento.
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
  `horariosGerados`), duração em dias, data de início, observação, checkbox
  "Medicamento fornecido pelo Cliente" (sem baixa de estoque).
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

### 8.3 Vacina

- Registro clínico de aplicação: vacina do catálogo de medicamentos (tipo vacina) com
  seleção de **lote disponível** (validade e valor por dose) ou vacina avulsa; dose
  (1ª/2ª/3ª, reforço anual, dose única, revacinação), via, quantidade, valor, data de
  aplicação, data de reforço, observação, flag "fornecida pelo cliente".
- Status derivado: `VIGENTE` / `VENCIDA` (reforço vencido) / `INATIVA`; filtros por status.
- Registro lança item na fatura e dá baixa no lote; inativação exige motivo.
- Numeração `VC-XXXX`; sem fluxo de rascunho/finalização (registro direto).

### 8.4 Exames clínicos

- Requisições com 4 tipos: **Laboratorial**, **Bioquímico**, **Imagem**, **Compra**.
- Laboratorial: catálogo por **laboratório → grupos → exames** (seed com Paddock, Genesi,
  LACVET), tipo de amostra (11 tipos com tubo indicado), quantidade de amostras,
  data/hora da coleta, indicação clínica, observação. Vários grupos por requisição.
- Imagem: catálogo dinâmico de grupos/exames de imagem por espécie.
- Ações: criar (vinculado à evolução ativa), editar, **finalizar** (status → CONCLUIDO,
  lança na fatura, regra de autoria), excluir (soft, sincroniza fatura), imprimir
  requisição, compartilhar por e-mail/WhatsApp.
- **Controle por tipo de exame (RBAC):** além do slug geral `atendimento.exames.*`,
  criar/editar/excluir exige a permissão do tipo — Laboratorial/Bioquímico →
  `exames.laboratorial.*`; Imagem → `exames.imagem.*` (Compra usa só o geral). O nível do
  tipo é resolvido em runtime e combinado com o geral (o mais restritivo vence). Na tela,
  a aba de um tipo sem permissão de criar nem é exibida. Antes de 2026-07-10 esses slugs
  eram órfãos (apareciam no Controle de Acesso mas não controlavam nada).

### 8.5 Encaminhamento

- Destino **EQUIPE** (lista prestadores/cargo FORNECEDOR das equipes do animal, com
  especialidade e badge "já tem acesso") ou **EXTERNO** (texto livre).
- Campos: especialidade, motivo, urgência (`NORMAL`/`ALTA`/`URGENTE`), status
  (`PENDENTE`/`CONCLUIDO`/`CANCELADO`).
- Encaminhar para prestador da equipe cria/reativa automaticamente a
  **DesignacaoPrestador** (acesso do fornecedor ao animal); concluir, cancelar ou
  excluir o encaminhamento **encerra o acesso**.
- Criar lança item na fatura. Editar só em PENDENTE. Finalizar segue regra de autoria.

---

## 9. Agenda e agendamentos

### 9.1 Agenda global (`/agendamentos`)

- Calendário mensal com marcadores por dia e agenda diária por horário (00h–23h).
- Agendamento: animal, tipo (`CONSULTA`, `VACINA`, `RETORNO`, `EXAME`, `PROCEDIMENTO`),
  título, data/hora, veterinário responsável (membros da equipe), observação.
  Status: `AGENDADO`, `EM_ANDAMENTO`, `CONCLUIDO`, `FINALIZADO` (via evolução),
  `CANCELADO` (com motivos pré-definidos). Detecção de conflito de horário (aviso).
- **Agendamento por voz:** ditado interpretado por LLM
  (`POST /clinica/agendamentos/interpretar`) que pré-preenche o formulário.
- **Transferir dia:** move todos os agendamentos de um dia para outra data.
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

- Atendimentos **do dia** do profissional logado; botão "Iniciar" abre a evolução do
  animal já vinculada ao agendamento (`?agendamentoId=`, persistido por animal em
  localStorage entre navegações/re-login).

### 9.3 Mapa de Atendimento (`/mapa-atendimento`)

- Painel-home dos perfis clínicos (redirect automático de `/` para VET/EST/ADMIN):
  - **Distribuição por haras/localização** (gráfico donut interativo).
  - **Consultas clínicas do dia**: agendado × concluído × cancelado, % de progresso.
  - **Prescrições** (total/ativas) e **animais sem atendimento** (com/sem).
  - **Cronograma do dia**: itens de agendamento + execuções de prescrição, com filtros
    por localização e veterinário; status `AGENDADO / EM_ANDAMENTO / CONCLUIDO /
    FINALIZADO / EXECUTADO / CANCELADO / SEM_ATENDIMENTO`; abre execução de prescrição
    em modal (`ModalExecucao`) e navega para o atendimento.

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
- **Expediente de atendimento (2026-07-14)** — dias da semana (toggles Dom–Sáb) e faixa de
  horário (abre/fecha) em que a clínica atende (`EmpresaConfiguracao.diasAtendimento` CSV
  0-6, `horaInicioAtendimento`/`horaFimAtendimento` HH:MM; vazio = sem restrição). Usado
  pela Agenda para liberar horários (§9.1). Ao salvar as Configurações, redireciona para o
  Mapa de Atendimento.

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

**Sidebar:** accordions Geral (Mapa de Atendimento, Relatórios, Configurações, Cadastro:
Cadastro Pessoal/Pacientes/Proprietários/Tratadores/Fornecedores/Localizações), Agenda,
Clínica (abas do atendimento + Exames nutricionais), Enfermagem, Estoque
(Farmácia/Vacina), Nutricional (Dieta, Relatório, e para ADMIN: Alimentos, Nutrientes,
Composição), Financeiro, Equipe/Controle de Acesso, Admin. Cada item é exibido conforme
`podeExecutar(slug.ler)`; badge do perfil (ADMIN/GESTOR/VET/EST) ao lado do usuário.

---

## 18. Notificações (polling in-app)

| Hook | Alvo | Comportamento |
|---|---|---|
| `useProprietarioNotificacoes` | PROPRIETARIO | Polling 15s em `/animais/minhas-solicitacoes`; toasts para aceite/recusa de vínculo, desvinculo iniciado pelo vet, novas solicitações V→P; janela retroativa de 10 min para eventos ocorridos fora da sessão. |
| `useVetSolicitacaoMonitor` | VETERINARIO | Polling em `/veterinarios/solicitacoes`; detecta novas solicitações e cancelamentos. |
| `useVetPendentes` | VETERINARIO | Badge de contagem de pendências no Sidebar. |
| `VetNotificationModal` | VETERINARIO | Modal bloqueante com solicitações recebidas (rastreio de vistos em localStorage; vets convidados não veem). |

E-mails transacionais (`emailService`): solicitação de vínculo (para vet e para
proprietário), confirmação de vínculo, desvinculo, troca de vet, boas-vindas de
proprietário, convite de equipe, reset de senha. Links de e-mail sempre com `/#/` (HashRouter).

---

## 19. Inteligência Artificial

| Operação | Onde | Descrição |
|---|---|---|
| Interpretar evolução | Finalizar evolução / Finalizar Atendimento | Extrai ações clínicas estruturadas (encaminhamentos sugeridos) e sugere título. Degradação graciosa em falha. |
| Transcrição de áudio | Evolução/Prescrição | Web Speech API (online) e Whisper local (offline), com fila de áudios e transcodificação no backend. |
| Agendamento por voz | Agenda | LLM interpreta o ditado e pré-preenche o agendamento. |
| Análise de laudo de exame | Exames nutricionais | Upload de laudo → extração de resultados por nutriente. |
| Parser de composição alimentar | Composição (ADMIN) | Extração de tabela nutricional. |
| Resumo do atendimento (laudo equino) | Relatório de Atendimento | Extrai mapa corporal + escores do texto da evolução; cache versionado (`resumoIaVersao`). |
| Sugestão de dieta | Nutrição | Geração/sugestão de dietas. |
| **AiUsageDashboard** (`/ai-usage`) | Todos autenticados (resumo e projeção mensal); detalhes por modelo e log recente só ADMIN | Tokens entrada/saída, custo USD, latência, sucesso, evolução diária. |

Arquitetura: interface `AIProvider` (implementação Groq), prompts versionados
(`operacao@vN`), toda inferência logada em `AiUsageLog`.

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
  estruturado (categoria EXCLUSAO/CANCELAMENTO, entidade, id, animal, motivo, detalhes,
  usuário, empresa e **IP de origem**). A tela lista os registros com filtros por
  categoria, tipo de registro, busca textual e período, com paginação (e coluna de IP);
  GESTOR vê a empresa ativa e ADMIN vê tudo (`GET /api/audit/logs`).
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

- **Sessão por cookies HttpOnly** (2026-07-10): access (`s2vet_at`, JWT 24h) e refresh
  (`s2vet_rt`, JWT 30d) em cookies `HttpOnly`, `SameSite=Lax`, `Secure` em produção — o
  token não é legível por JavaScript nem armazenado em storage (defesa contra roubo via
  XSS). O backend lê o cookie primeiro e aceita `Authorization: Bearer` só como fallback
  (clientes não-navegador). Login/refresh/Google setam os cookies; logout limpa e revoga
  o refresh no banco. A identidade do usuário no frontend vem de `/api/users/me`.
- **`trust proxy`** configurado (`TRUST_PROXY_HOPS`, default 1) — resolve o IP real do
  cliente atrás do proxy e elimina o erro do rate-limit com `X-Forwarded-For`.
- Helmet, CORS com allowlist via `ALLOWED_ORIGINS` (com `credentials`), rate limiting
  (200 req/min geral, 20 req/15min em `/auth`), validação de `JWT_SECRET` no startup (≥32).
- Uploads: nomes gerados com `crypto.randomBytes` (capability URL), whitelist de
  extensão + mimetype, servidos com `nosniff`, CSP sandbox e `Content-Disposition:
  attachment` para tipos fora da whitelist de mídia.
- Refresh token é JWT assinado com expiração 30d, rotacionado a cada uso e verificado
  antes do lookup.
- `forgot-password` com resposta genérica; registro restrito a
  PROPRIETARIO/VETERINARIO; console suprimido em produção; correlation id
  (`x-request-id`) em todos os requests; logs estruturados (Winston).
- 403 de GET silencioso no frontend (sem vazamento de erro para o usuário).
- **Auditoria com IP de origem** em login/logout e exclusões/cancelamentos
  (`AuditLog.ip`, derivado do request no servidor).

---

## 23. Limitações e comportamentos conhecidos (fiéis ao código atual)

1. ~~Slugs órfãos `exames.laboratorial.*`/`exames.imagem.*`~~ — **resolvido
   (2026-07-10)**: agora controlam de fato criar/editar/excluir por tipo de exame
   (ver §8.4).
2. **VacinaClinica não tem fluxo de finalização** (sem campo `status`); registro é
   direto. Regras de autoria de edição para vacina dependem de migration futura.
3. **Autoria clínica é 100% RBAC** (2026-07-10): não há mais regra de cargo hardcoded no
   backend (só o bypass de ADMIN). Um FORNECEDOR com nível `EQUIPE`/`FULL` na matriz
   passaria a operar registros de outros — é decisão do gestor no Controle de Acesso, não
   do código. O deny-by-default de dados do prestador (designação) permanece.
4. **Rastreio de correções de fatura** passou a existir em 2026-07-07; correções
   anteriores não são contabilizadas no relatório gerencial.
5. **Cadastro via Google** cria conta como PROPRIETARIO fixo.
6. **Multi-tenant:** `empresaId` existe em Animal/AuditLog/Fornecedor/etc. e o
   enforcement é por middleware/contexto; Fatura e EvolucaoClinica ainda não têm
   `empresaId` próprio (escopo derivado do proprietário/animal). Sem Row-Level Security.
7. **Visão ADMIN do Controle de Acesso sem equipe selecionada** (lista hierárquica de
   todas as empresas) mostra apenas o cargo local do membro, sem os perfis globais.
8. **Uploads em disco local** (`backend/uploads/`) atrás de `StorageProvider` abstrato
   (implementação atual: LocalStorageProvider). Acesso à mídia não é vinculado à sessão
   (capability URL não-enumerável).
9. Arquivos residuais existem no repositório (`AuthContext copy.tsx`, `App copy.tsx`,
   `query-adhoc.tsx`, scripts de teste soltos) — sem função no produto.
10. i18n (`react-i18next`) está preparado, mas as telas usam strings em pt-BR
    hardcoded.

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
| `/api/ai-usage` | monitoramento de IA |
| `/api/audit` | log de auditoria |
| `/api/crmv` | validação CRMV (CFMV) |
| `/api/especies`, `/api/racas`, `/api/produtos` | apoio |
| `/health` | health check (status do banco, uptime, versão) |
