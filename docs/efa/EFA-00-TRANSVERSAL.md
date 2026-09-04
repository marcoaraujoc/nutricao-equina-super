# EFA-00 — Padrões Transversais da Plataforma S2Vet

> **Documento-base da suíte EFA.** Todos os módulos (EFA-01 a EFA-15) referenciam este
> documento para glossário, personas, segurança, auditoria, mensagens padrão, tratamento
> de erros e requisitos não funcionais. O que está aqui vale para TODA a aplicação,
> salvo exceção explícita no documento do módulo.

---

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Padrões Transversais — Plataforma S2Vet |
| Versão | 1.1 |
| Autor | Equipe S2Vet (gerado por análise do código-fonte) |
| Data | 2026-08-29 (base 2026-07-10) |
| Status | Vigente — reflete o sistema implementado |
| Histórico | 1.0 (2026-07-10): versão inicial da suíte EFA. · 1.1 (2026-08-29): multi-tenancy por RLS, storage no banco, IA unificada no Gemini, shell global + busca, 2FA, sessão por inatividade, premissa de autoria, fuso por empresa, `AcaoRegistro`/`DateInput`. |

---

## 2. Objetivo

O **S2Vet** é uma plataforma hospitalar veterinária SaaS, **mobile-first** e multi-tenant,
com foco atual no atendimento clínico e nutricional de **equinos** (arquitetura preparada
para multi-espécie).

- **Problema que resolve:** clínicas e profissionais veterinários gerenciam pacientes,
  atendimentos, prescrições, estoque e faturamento em planilhas e sistemas desconexos,
  sem trilha de auditoria nem controle de acesso granular.
- **Para quem:** clínicas veterinárias (gestores e equipes), veterinários autônomos,
  prestadores de serviço (ferradores, fisioterapeutas), proprietários de animais e o
  administrador da plataforma.
- **Benefícios:** prontuário único por animal, rastreabilidade financeira
  (origem clínica → fatura), controle de estoque com reservas, RBAC granular por equipe,
  auditoria de exclusões com justificativa, apoio de IA (transcrição, interpretação de
  laudos e evoluções).
- **Impacto no negócio:** redução de perdas de faturamento (lançamentos automáticos),
  conformidade (justificativas + auditoria), padronização do atendimento.

**Stack (referência):** React 18 + TypeScript + Vite + Tailwind (HashRouter `/#/rota`);
Node.js + Express + Prisma; PostgreSQL (schema `schs2vet`); JWT + refresh token; IA Groq
+ Whisper local.

---

## 3. Escopo da suíte

### Inclui (módulos documentados)

| Doc | Módulo |
|---|---|
| EFA-01 | Autenticação e Conta |
| EFA-02 | Controle de Acesso e Permissões (RBAC, equipes, convites) |
| EFA-03 | Empresas, Contexto Ativo e Configurações da Empresa |
| EFA-04 | Cadastros Gerais (proprietários, tratadores, fornecedores, localizações, usuários) |
| EFA-05 | Animais/Pacientes e Vínculo Veterinário |
| EFA-06 | Atendimento — Evolução Clínica (prontuário) |
| EFA-07 | Atendimento — Prescrição e Execução (enfermagem) |
| EFA-08 | Atendimento — Vacinas, Exames Clínicos e Encaminhamentos |
| EFA-09 | Agenda, Agendamentos e Mapa de Atendimento |
| EFA-10 | Estoque (Farmácia e Vacinas) e Catálogos ADMIN |
| EFA-11 | Nutrição (dietas, análise NRC, exames nutricionais, relatório) |
| EFA-12 | Financeiro (faturamento e fechamento) |
| EFA-13 | Relatórios Gerenciais e Dashboards |
| EFA-14 | Auditoria |
| EFA-15 | Resenha e Exame de Compra (equinos) |

### Não inclui

- Especificação técnica de infraestrutura (deploy, CI/CD, tuning de banco).
- Integração de mensageria WhatsApp (apenas armazenamento do número — ver EFA-03).
- Row-Level Security no PostgreSQL (planejado — fase enterprise).
- Aplicativo móvel nativo (a aplicação é web responsiva).
- Internacionalização efetiva (i18n preparado; telas em pt-BR).

---

## 4. Glossário

| Termo | Definição |
|---|---|
| **Paciente / Animal** | Animal cadastrado na plataforma (equino, canino etc.), pertencente a um Proprietário. |
| **Proprietário (Tutor)** | Usuário dono de um ou mais animais. Recebe faturas e autoriza vínculos de veterinários. |
| **Veterinário responsável** | Vet com vínculo ACEITO com o animal (`VetAnimalSolicitacao`). |
| **Empresa** | Entidade jurídica (CNPJ) ou pessoal (CPF, `cnpj null`) dona de equipes. Um gestor pode ter várias. |
| **Equipe** | Grupo de trabalho dentro de uma empresa; unidade de segregação de pacientes e permissões. |
| **Contexto ativo** | Empresa/equipe selecionada no Sidebar; define escopo de dados e permissões da sessão. |
| **Cargo (perfil)** | Papel do membro na equipe: GESTOR, VETERINARIO, ESTAGIARIO, FORNECEDOR, SECRETARIA, FINANCEIRO, ENFERMEIRO ou customizado. |
| **Prestador / Fornecedor** | Profissional externo (ferrador, fisioterapeuta) — userType FORNECEDOR, cargo FORNECEDOR. Acesso a pacientes apenas por Designação. |
| **Designação (DesignacaoPrestador)** | Autorização de acesso de um prestador a UM animal, criada pelo encaminhamento ou pelo gestor. |
| **Tratador** | Pessoa responsável pelos cuidados diários do animal (não é usuário do sistema). |
| **Localização / Haras** | Local físico onde o animal vive (haras, clínica, fazenda...) — cadastro global. |
| **Baia** | Identificação do local individual do animal dentro da localização. Única por (local + empresa/proprietário). |
| **Atendimento** | Conjunto de registros clínicos vinculados a uma Evolução (`EV-XXXX`) ou Agendamento (`AG-XXXX`). |
| **Evolução (Prontuário)** | Registro clínico textual do atendimento, com mídias e ditado por voz. |
| **Prescrição (grupo)** | Documento de prescrição numerado por animal com itens medicamento/procedimento. |
| **Execução** | Administração diária dos itens prescritos (enfermagem), com baixa de estoque. |
| **Lote (estoque)** | Entrada de estoque com lote e validade próprios. Um medicamento pode ter vários lotes. |
| **FEFO** | *First Expire, First Out* — o lote com validade mais próxima é reservado/debitado primeiro. |
| **Reserva de estoque** | Quantidade comprometida por uma prescrição finalizada, descontada da disponibilidade. |
| **Fatura** | Documento mensal por proprietário (`AAAA-MM`) consolidando lançamentos de todos os seus animais. |
| **Mensalista** | Proprietário com assistência mensal contratada (valor fixo lançado no fechamento). |
| **Slug de permissão** | Identificador `modulo.submodulo.acao` (ex.: `farmacia.estoque.ajustar`) do catálogo `ModuloSistema`. |
| **Soft delete** | Exclusão lógica (`ativo=false`) — registros clínicos nunca são apagados fisicamente. |
| **Justificativa (motivo)** | Texto obrigatório em toda exclusão/cancelamento; gravado na Auditoria. |
| **EV- / AG- / VC-** | Prefixos de numeração: Evolução avulsa, Agendamento, Vacina Clínica. |

---

## 5. Personas

| Persona | userType / cargo | Objetivos | Características |
|---|---|---|---|
| **Administrador da plataforma** | ADMIN | Manter catálogos globais, permissões globais, usuários, monitorar IA. | Bypass total de permissões; opera fora do escopo de empresa. |
| **Gestor de clínica** | VETERINARIO (dono) ou cargo GESTOR | Configurar a empresa, equipe, permissões, acompanhar finanças e relatórios. | Bypass na empresa ativa; multi-empresa possível. |
| **Veterinário** | VETERINARIO / cargo VETERINARIO | Atender pacientes, prescrever, solicitar exames, encaminhar. | Edita apenas os próprios registros (autoria); não finaliza por padrão. |
| **Estagiário** | ESTAGIARIO | Apoiar o atendimento, executar prescrições. | Permissões reduzidas; executa prescrição por padrão (EQUIPE). |
| **Enfermeiro/Técnico** | cargo ENFERMEIRO | Executar prescrições, ajustar estoque. | Foco na tela de Execução e Farmácia. |
| **Secretária/Recepção** | cargo SECRETARIA | Agenda, cadastros. | Sem acesso clínico por padrão. |
| **Financeiro** | cargo FINANCEIRO | Faturamento e relatórios. | Acesso ao módulo financeiro/relatórios. |
| **Prestador externo** | FORNECEDOR / cargo FORNECEDOR | Atender apenas os animais designados. | Deny-by-default; finaliza somente o que criou. |
| **Proprietário** | PROPRIETARIO | Acompanhar seus animais, autorizar vínculos, ver faturas. | Permissões via MatrizPerfil PROPRIETARIO (união + deny-wins). |

---

## 6. Fluxo geral da aplicação

1. Usuário acessa `/#/login` → autentica (e-mail/senha ou Google).
2. Sistema resolve o **contexto ativo** (preferência: opção com cargo GESTOR).
3. Redirect por perfil: VET/EST/ADMIN → `/mapa-atendimento`; PROPRIETARIO → `/` (Dashboard
   com onboarding se necessário); demais → `/`.
4. Sidebar exibe apenas módulos permitidos (`podeExecutar('slug.ler')`); bloqueio de
   módulos até completar o cadastro pessoal (e, para proprietário, ter 1 animal).
5. Usuário navega pelos módulos; toda ação de escrita é validada por permissão no
   frontend (ocultação/toast) e no backend (middleware `checkPermission`).
6. Exclusões/cancelamentos exigem justificativa (modal padrão) e alimentam a Auditoria.
7. Logout manual, por inatividade (**2h**) ou por conta desativada.

O **shell global** envolve tudo: cabeçalho (marca, **busca global**, sino de
notificações, menu do usuário com Sair), corpo (Sidebar + conteúdo) e rodapé. Página
institucional **pública** em `/` para quem não está logado.

**Fluxos alternativos:** troca de contexto (reload da aplicação); troca de senha
obrigatória (`mustChangePassword` bloqueia navegação até trocar); sessão expirada
(refresh automático transparente; falha → login).

---

## 7. Casos de uso — convenções da suíte

- Código: `UC-<módulo>-<seq>` (ex.: `UC-05-03`). Regras: `RN-<módulo>-<seq>`.
  Mensagens: `MSG-<módulo>-<seq>`. Globais usam prefixo `G` (ex.: `RN-G-001`).
- Pré-condição implícita de TODOS os casos de uso (não repetida nos módulos):
  usuário autenticado, conta ativa, contexto ativo resolvido e permissão de leitura do
  módulo (`slug.ler`) — exceto casos de uso públicos explicitamente marcados.
- Fluxo de erro implícito de TODOS os casos de uso: ver §17 (tratamento de erros padrão).

---

## 8. Padrões de telas (aplicáveis a toda a aplicação)

| Padrão | Especificação |
|---|---|
| **Wrapper** | Toda página interna usa `PageContainer` (maxWidth 7xl/5xl/3xl; padding `px-6 py-6 md:px-10 md:py-8`). Proibido `min-h-screen` em páginas internas. |
| **Shell global** | Cabeçalho (`AppHeader`: marca, busca global, notificações, menu do usuário) + corpo (Sidebar + `<main>` rolável) + rodapé (`AppFooter`). O gatilho do menu mobile mora no cabeçalho — não há mais barra `fixed`. |
| **Mobile-first** | Listas: cards no mobile (`md:hidden`), tabela no desktop (`hidden md:block`). Sidebar vira drawer no mobile. |
| **Ação de registro** | `AcaoRegistro`/`AcoesRegistro` — FONTE ÚNICA: a ação é declarada uma vez e o CSS escolhe a forma (ícone pintado no desktop, botão com rótulo no card mobile). `tom` escolhe a cor (§ cores): alterar laranja, ver/executar verde, imprimir/e-mail azul, WhatsApp verde, cancelar vermelho, neutro cinza. Ação sem permissão **não** é renderizada (cinza = indisponível). |
| **Campo de data** | `DateInput` — sempre DD/MM/AAAA (nunca `<input type="date">` nativo, que segue o locale do navegador); valida e diz o erro específico ("fevereiro tem 28 dias"). |
| **Modais** | Painel branco `rounded-2xl`, cabeçalho colorido `rounded-t-2xl` (esmeralda para operações; vermelho para destrutivas), backdrop `bg-black/50`. **Arrastáveis no desktop** pelo cabeçalho/título (mouse, ≥768px; clamp na viewport; reset ao reabrir) — comportamento global, sem código por modal. |
| **Exclusão/cancelamento** | SEMPRE via `ModalJustificativa` (justificativa obrigatória ≥3 caracteres, botão desabilitado até preencher). Nunca `window.confirm`. |
| **Feedback** | Toasts (react-hot-toast) topo-direita: sucesso verde, erro vermelho, avisos com ícone contextual (🔒/🔄/❌). |
| **Estados de tela** | Carregando (spinner esmeralda), vazio (ícone + frase orientativa), erro (toast), sem permissão (página "Acesso não autorizado" ou ocultação do item). |
| **Combobox pesquisável** | Botão que vira campo de busca com dropdown (padrão de medicamento/localização/item de estoque); seleção por `onMouseDown`; fechamento por blur com atraso de 150ms. |
| **Paginação** | Botões Anterior/Próxima + "Página X de Y"; tamanho padrão 20–50 itens. |
| **Impressões** | Janela/iframe A4 com logotipo da empresa (fallback marca S2Vet). |
| **Acessibilidade** | Foco automático no primeiro campo de modais; `title` em botões de ícone; áreas clicáveis com `role="button"`/`tabIndex`; contraste Tailwind padrão. *(Lacuna conhecida: sem auditoria WCAG formal — ver §21.)* |

---

## 9. Padrões de campos (formatos e máscaras globais)

| Campo | Tipo | Máscara / formato | Validação |
|---|---|---|---|
| CPF | Texto (dígitos) | `000.000.000-00` | Dígitos verificadores; unicidade conforme módulo. |
| CNPJ | Texto (dígitos) | `00.000.000/0000-00` | Dígitos verificadores; auto-preenchimento razão social via BrasilAPI. |
| CEP | Texto (dígitos) | `00000-000` | Busca automática de endereço via ViaCEP; falha silenciosa mantém campos editáveis. |
| Telefone/WhatsApp | Texto (dígitos) | `(00) 00000-0000` | 10–15 dígitos; persistido somente com dígitos. |
| E-mail | Texto | — | Formato RFC básico; único por conta. |
| Data | Date | `input type=date` (exibição dd/mm/aaaa) | Regras por módulo (ex.: validade ≥ hoje na criação). |
| Moeda | Decimal(10,2) | Digitação em centavos `0,00` (pt-BR) | ≥ 0; obrigatoriedade por módulo. |
| Senha | Texto | oculta com toggle olho | Mínimo 8 caracteres. |
| Quantidades de estoque | Float | número com vírgula na exibição | ≥ 0; unidade do catálogo (g, mg, kg, mL, L, un). |

---

## 10. Regras de negócio transversais

**RN-G-001 — Soft delete de registros clínicos.**
Descrição: registros clínicos e cadastrais nunca são apagados fisicamente; exclusão seta `ativo=false`.
Motivação: preservação de histórico médico e rastreabilidade legal.
Exemplo: excluir uma evolução a remove das listagens, mas ela permanece no banco com a justificativa.
Impacto: todas as listagens filtram `ativo=true`. Exceções: item de dieta e exame nutricional usam delete físico (registrados na auditoria).

**RN-G-002 — Justificativa obrigatória em exclusão/cancelamento.**
Descrição: toda exclusão ou cancelamento exige motivo (mín. 3 caracteres) e gera registro estruturado na Auditoria (EFA-14).
Motivação: conformidade e responsabilização.
Exemplo: cancelar uma prescrição sem motivo → HTTP 400 "É obrigatório informar o motivo do cancelamento".
Impacto: todos os módulos. Exceções: nenhuma (Evolução usa a chave `justificativa` por legado).

**RN-G-003 — Autoria de registros clínicos (editar) — 100% RBAC.**
Descrição: a autoria é decidida pelo **nível efetivo da matriz** no slug de editar, não por
cargo hardcoded. Nível `PROPRIO` → só edita registros que criou; `EQUIPE`/`FULL` → edita
qualquer registro da equipe. GESTOR tem `FULL` por bypass; qualquer perfil pode receber
`EQUIPE`/`FULL` na matriz e passar a editar registros de outros.
Motivação: nenhuma regra de "quem pode" fixa no backend — tudo configurável no Controle de
Acesso. Exceção única no backend: ADMIN (bypass total).
Impacto: evolução, prescrição, exame clínico, encaminhamento, agendamento.

**RN-G-004 — Autoria de finalização — 100% RBAC.**
Descrição: mesma lógica do RN-G-003 aplicada ao slug de finalizar. `PROPRIO` finaliza só o
próprio; `EQUIPE`/`FULL` finaliza qualquer um. Por padrão, o seed dá `NENHUM` a
VET/ESTAGIARIO em finalizar (bloqueia) e `PROPRIO` a perfis operacionais — mas isso é só o
default; o gestor reconfigura livremente.
Motivação: controle de responsabilidade clínica sem regra fixa no código.
Exceção única no backend: ADMIN.

**RN-G-005 — Deny-wins (nível NEGADO).**
Descrição: o nível NEGADO em qualquer equipe vinculada bloqueia o módulo para o proprietário, mesmo que outra equipe conceda acesso.
Motivação: permitir bloqueio explícito sem depender de remoção de vínculos.

**RN-G-006 — Escopo pelo contexto ativo.**
Descrição: listagens e permissões são resolvidas pela empresa/equipe ativa; animal de outra equipe da mesma empresa não aparece.
Motivação: segregação multi-tenant.
Exceções: pacientes pessoais do vet (vínculo direto fora da empresa) continuam visíveis; PROPRIETARIO usa união das equipes dos seus animais.

**RN-G-007 — Prestador deny-by-default.**
Descrição: FORNECEDOR só acessa animais com designação ativa; nunca herda escopo de equipe (exceto quando atua como gestor no contexto ativo).
Motivação: acesso mínimo necessário de terceiros.

**RN-G-008 — Sincronização fatura ↔ origem clínica.**
Descrição: editar/excluir um registro clínico já faturado sincroniza os itens de fatura na mesma transação; fatura PAGA bloqueia a operação (erro `FATURA_PAGA`).
Motivação: consistência financeira.

**RN-G-009 — Bloqueio de módulos até cadastro completo.**
Descrição: usuário sem cadastro completo (telefone + endereço + CEP; proprietário também precisa de 1 animal) vê banner e módulos bloqueados no Sidebar.
Motivação: qualidade de dados mínima para operação.

**RN-G-010 — Rate limiting.**
Descrição: 200 req/min por IP (geral) e 20 req/15min em `/auth`.
Motivação: proteção contra brute force e abuso.
Mensagem: "Muitas requisições. Tente novamente em instantes." / "Muitas tentativas de login...".

---

## 11. Fluxograma geral (macro)

```
Login → resolve contexto ativo → home por perfil
  → [cadastro incompleto?] → banner + módulos bloqueados → Cadastro Pessoal
  → navegação por módulos (Sidebar filtrado por permissão)
       → leitura: GET (403 silencioso → tela vazia/sem acesso)
       → escrita: guard de permissão → validação → gravação → toast
       → exclusão/cancelamento: ModalJustificativa → backend valida motivo
             → grava + auditoria (mesma transação quando aplicável)
  → logout (manual | inatividade 5min | conta desativada)
```

---

## 12. Estados globais

- **Conta:** `ativa` ⇄ `desativada` (ADMIN/gestor). Desativada → 401 em qualquer request.
- **Sessão:** `autenticada` → `renovando` (refresh automático em 401) → `expirada` (login).
- **Registro genérico:** `ativo` → `inativo` (soft delete com justificativa). Reativação
  disponível apenas onde o módulo especifica (ex.: cadastros com toggle).
- Estados específicos (evolução, prescrição, fatura, vínculo etc.) estão nos módulos.

---

## 13. Segurança (global)

- **RBAC:** níveis `NEGADO(-1) < NENHUM(0) < LEITURA(1) < PROPRIO(2) < EQUIPE(3) < FULL(4)`.
  Fontes: `MatrizPerfil` (por perfil/equipe; itens `locked` só o ADMIN altera),
  `PermissaoMembro` (individual; canônica p/ FORNECEDOR), matriz PROPRIETARIO
  (união + deny-wins). Bypass: ADMIN global; GESTOR/dono na empresa ativa.
- **Premissa de autoria (2026-08-04):** o RBAC decide **se** a ação pode ser executada; a
  autoria decide **sobre qual registro** — vale sobre o que a pessoa criou/assumiu, e só o
  **GESTOR** (ou ADMIN) opera o de outro. Nível `FULL` da matriz **não** dá acesso ao
  registro alheio. Assumir arrasta o atendimento; toda troca gera auditoria de
  transferência (REVERTE a "autoria 100% RBAC" de 2026-07-10).
- **Isolamento multi-tenant por RLS (fail-closed):** 72 tabelas com policies `FORCE`; a
  role da aplicação não tem `BYPASSRLS` nem é dona das tabelas. O `authenticate` carimba
  `app.empresa_id` (via `AsyncLocalStorage`, `lib/prismaTenant.js`) e o RLS impede leitura/
  escrita cruzada entre clínicas independentemente do controller; sem contexto declarado,
  tabela de tenant devolve zero. Header `x-empresa-id`/`x-equipe-id` é validado contra o
  vínculo antes de virar contexto.
- **Enforcement:** frontend (ocultação + guards + gating de `useEffect` em `loadingPerms`)
  e backend (`checkPermission(slug, nívelMínimo)` + RLS como backstop no banco).
- **Transporte/sessão:** access JWT **30 min** + refresh rotacionado numa **janela de
  inatividade de 2h**, em **cookies HttpOnly** (`s2vet_at`/`s2vet_rt`, `SameSite=Lax`,
  `Secure` em produção; token não legível por JS). `sessionVersion` revoga sessão antiga.
  **2FA por e-mail** (código CSPRNG/SHA-256/tempo constante) e **bloqueio por tentativas**.
  `trust proxy` (`TRUST_PROXY_HOPS`); Helmet; CORS allowlist com `credentials`;
  `JWT_SECRET` validado por entropia no startup; rate limit por usuário (fallback IP).
- **Storage no banco:** todo arquivo em `tb_midia_arquivos` (bytea); download por
  `/api/midia/:chave` autenticado e autorizado por dono (nada servido do filesystem).
  Uploads com whitelist extensão+mimetype e `limits.fileSize`; interface `StorageProvider`
  para migrar a S3/GCS trocando só `STORAGE_DRIVER`.
- **Anti-enumeração de usuário:** login e forgot-password com mensagem genérica **e tempo
  constante** (bcrypt de isca; envio de e-mail em segundo plano). Varredura de secrets no
  CI (`gitleaks`).
- **LGPD:** dados pessoais restritos ao escopo da empresa (reforçado pelo RLS);
  `forgot-password` genérico; logs sem senha; eliminação por desativação (histórico
  clínico retido por obrigação veterinária — *validar juridicamente*).
- **Console do navegador** suprimido em produção.

---

## 14. Auditoria (global)

| Evento | Onde é registrado | Conteúdo |
|---|---|---|
| Login/Logout/**Acesso negado** | `AuditLog` | usuário, e-mail, ação, timestamp, empresa, **IP de origem**. Tentativas bloqueadas (senha errada, conta bloqueada, 2FA inválido) na categoria `ACESSO_NEGADO`, em escopo de plataforma. |
| Criação/Exclusão/Cancelamento/**Transferência**/Alteração/Configuração | `AuditLog` estruturado | categoria (`CRIACAO`/`EXCLUSAO`/`CANCELAMENTO`/`TRANSFERENCIA`/`ALTERACAO`/`CONFIGURACAO`), entidade, id, animal, **motivo**, "antes → depois" por campo, usuário, empresa, **IP**, timestamp. |
| Alterações de permissão | `AuditoriaPermissao` (imutável) | quem alterou, alvo, nível anterior/novo, motivo, IP. |
| Alterações clínicas relevantes | Campos do registro (`modificadoPorId`, `dataModificacao`, `justificativaExclusao`) + relatório gerencial (evoluções editadas pós-finalização, correções de fatura). |

O **IP de origem** é derivado do request no servidor (respeita `trust proxy`) — nunca do
corpo — e gravado nos eventos de login/logout e de exclusão/cancelamento.

*Lacuna conhecida:* auditoria campo-a-campo (valor anterior/novo) em edições comuns não é
registrada — ver §21 Melhorias.

Tela de consulta: **EFA-14** (`/auditoria-geral`).

---

## 15. Integrações (globais)

| Integração | Uso | Protocolo | Falha |
|---|---|---|---|
| Google OAuth | Login/registro | `useGoogleLogin` (access_token validado server-side) | Erro exibido; login por senha permanece. |
| BrasilAPI (CNPJ) | Auto-preenchimento de razão social | REST público, chamada direta do frontend | Toast informativo; campos permanecem editáveis. |
| ViaCEP | Endereço por CEP | REST público | Falha silenciosa. |
| CFMV | Validação de CRMV | REST via backend (`/api/crmv`) | Mensagem de CRMV inválido/indisponível. |
| **Google Gemini** (LLM único) | Texto, visão e **transcrição de áudio**; interpretação de evolução, laudos, voz, dieta, memória clínica, IA financeira, assistente de documentos | Backend (`geminiClient.ts`), prompts versionados, log em `AiUsageLog` com módulo e empresa; **metering + quota por empresa** (429 ao exceder) | **Degradação graciosa** — a operação principal nunca é bloqueada por falha de IA. |
| Web Speech API | Ditado online no cliente | Navegador | Cai para o Gemini no backend. |
| E-mail (SMTP) | Transacionais (vínculos, convites, boas-vindas, reset, **código 2FA**) | `emailService`; links sempre `/#/` | Erro logado; fluxo segue (best-effort). |
| **WhatsApp (Evolution API)** | Envio de lembretes, faturas, documentos, orçamentos | Instância por empresa; `WHATSAPP_PROVIDER=evolution`; **webhook autenticado por token** (`/api/webhooks/evolution`) | Provider "noop" quando não configurado. |

Groq, OpenAI e Anthropic foram **removidos** (2026-07-28) — Gemini é o provedor único.

---

## 16. Mensagens padrão (globais)

| Código | Mensagem | Quando | Ação esperada |
|---|---|---|---|
| MSG-G-001 | "Sem permissão para {ação}. Verifique com o responsável da equipe." | Guard de permissão no frontend | Usuário solicita acesso ao gestor. |
| MSG-G-002 | "É obrigatório informar o motivo da exclusão" / "...do cancelamento" | Backend, motivo ausente | Preencher a justificativa. |
| MSG-G-003 | "Acesso não autorizado" | 403 em recurso de outro escopo | Verificar contexto ativo. |
| MSG-G-004 | "Registro não encontrado" (variações por entidade) | 404 | Atualizar a lista. |
| MSG-G-005 | "Erro interno" / "Erro ao {operação}" | 500 | Tentar novamente; suporte se persistir. |
| MSG-G-006 | "Muitas requisições. Tente novamente em instantes." | Rate limit geral | Aguardar. |
| MSG-G-007 | "Muitas tentativas de login. Tente novamente em 15 minutos." | Rate limit /auth | Aguardar. |
| MSG-G-008 | "A justificativa é obrigatória e fica registrada na auditoria." | Hint do ModalJustificativa | Informativa. |
| MSG-G-009 | "Sessão expirada" (redirect a login) | Refresh token inválido | Autenticar novamente. |
| MSG-G-010 | "Configurações salvas com sucesso!" (padrão "{X} com sucesso") | Sucesso de gravação | — |

---

## 17. Tratamento de erros (padrão da aplicação)

| Cenário | Comportamento |
|---|---|
| Campo obrigatório ausente | Validação no frontend (toast antes do request) + backend 400 com mensagem específica. |
| Permissão negada (GET) | Interceptor resolve `{ data: null }` **silenciosamente**; tela mostra estado vazio/"Acesso não autorizado". Nunca exibir erro técnico. |
| Permissão negada (mutação) | Interceptor rejeita com `isPermissionError`; handler já validou antes (o 403 não deve ocorrer em uso normal). |
| Registro inexistente | 404 + MSG-G-004; a tela recarrega a listagem. |
| Conflito de negócio | 400/409 com `code` específico (`FATURA_PAGA`, `EXECUTADO`, `ESTOQUE_INSUFICIENTE`) — o frontend trata cada código com UX própria. |
| Sessão expirada | 401 → refresh automático; falha → limpeza de storage e redirect a login. |
| Timeout/falha de rede | Toast "Erro ao {operação}"; nenhuma mutação parcial (transações no backend). |
| Erro interno | 500 genérico + correlation id (`x-request-id`) nos logs estruturados (Winston). |

---

## 18. Critérios de aceite transversais (BDD)

```gherkin
Dado que estou autenticado com um perfil sem a permissão "X.criar"
Quando acesso a tela do módulo X
Então o botão de criação não é exibido
E se eu forçar a chamada da API recebo 403 sem detalhes internos.

Dado que estou excluindo qualquer registro da aplicação
Quando confirmo a exclusão sem informar justificativa de ao menos 3 caracteres
Então o botão de confirmação permanece desabilitado
E o backend rejeita a operação com HTTP 400 caso o request seja forjado.

Dado que excluí um registro informando justificativa
Quando o gestor abre a tela de Auditoria
Então o registro aparece com categoria, entidade, motivo, autor e data/hora.

Dado que minha conta foi desativada
Quando executo qualquer ação autenticada
Então recebo 401 e sou levado ao login.

Dado que estou no desktop (≥768px)
Quando arrasto um modal pelo cabeçalho
Então o modal acompanha o mouse sem sair totalmente da tela
E ao fechá-lo e reabri-lo ele volta à posição original.
```

---

## 19. Casos de teste transversais

| Tipo | Caso |
|---|---|
| Positivo | Login → contexto gestor selecionado automaticamente → módulos do Sidebar coerentes com a matriz. |
| Negativo | Request com `x-equipe-id` de equipe alheia → header ignorado (fallback) e dados do escopo correto. |
| Negativo | DELETE sem `motivo` em todas as entidades cobertas → 400. |
| Limite | Justificativa com 2 caracteres → botão desabilitado; com 3 → habilita. |
| Limite | 201ª requisição no mesmo minuto → 429. |
| Segurança | GET de recurso de outra empresa → 403/404 sem vazamento de dados. |
| Segurança | Upload com extensão fora da whitelist → rejeitado. |
| Concorrência | Duas exclusões simultâneas do mesmo registro → segunda recebe 404/400 ("já está inativo"). |
| Performance | Listagens paginadas ≤ 50 itens; resposta < 2s em rede normal (alvo). |

---

## 20. Requisitos não funcionais

| Categoria | Requisito |
|---|---|
| Performance | Paginação obrigatória em listagens; imagens comprimidas no cliente (máx. 1200px, JPEG 82%); polling limitado (15–30s) só onde especificado. |
| Escalabilidade | Multi-tenant lógico por empresa/equipe; schema PostgreSQL dedicado (`schs2vet`); IA desacoplada por interface de provider. |
| Disponibilidade | Health check `/health` (status do banco, uptime, versão). Backup do banco: responsabilidade operacional (fora da aplicação). |
| Segurança | Ver §13. |
| Acessibilidade | Padrões §8; auditoria WCAG formal pendente (§21). |
| Responsividade | Mobile-first; breakpoint md (768px) separa cards/tabela; recursos desktop-only sinalizados (Matriz de Perfis, drag de modais). |
| Navegadores | Evergreen (Chrome, Edge, Firefox, Safari atuais). HashRouter garante deep links sem configuração de servidor. |
| Observabilidade | Logs estruturados com correlation id; `AiUsageLog` para custo/latência de IA. |

---

## 21. Melhorias futuras (globais)

1. Auditoria campo-a-campo (valor anterior/novo) nas edições — hoje só exclusões/
   cancelamentos e marcadores de correção.
2. Integração real de mensageria WhatsApp (número já armazenado).
3. Row-Level Security no PostgreSQL; `empresaId` próprio em Fatura/EvolucaoClinica.
4. i18n efetivo (chaves preparadas, telas hardcoded pt-BR).
5. ~~Tokens em HttpOnly cookies~~ **implementado (2026-07-10)**; falta ainda vincular a
   mídia (uploads) à sessão.
6. ~~Slugs órfãos de exame~~ **resolvido (2026-07-10)**: `exames.laboratorial.*`/
   `exames.imagem.*` passam a controlar de fato a criação/edição/exclusão por tipo (EFA-08).
7. Auditoria de acessibilidade WCAG 2.1 AA.
8. Notificações push/websocket substituindo polling.
9. Registro de IP nos eventos foi implementado (2026-07-10); estender o mesmo para
   trilha campo-a-campo quando (1) for feito.
