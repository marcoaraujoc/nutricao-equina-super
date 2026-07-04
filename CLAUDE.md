# S2Vet — CLAUDE.md
# Contexto arquitetural permanente para Claude Code
# Atualizado em: 2026-06-24 (RBAC enforcement + regra de finalização por autoria)

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
| IA / LLM Integration | 🟡 Parcial (Groq integrado) |
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
Provider atual: Groq
Modelo: configurável por operação
AiUsageLog: tabela já modelada (tokensEntrada, tokensSaida, custoUsd, latenciaMs)
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
PRESTADOR    → userType FORNECEDOR (externo, ex: fisioterapeuta, ferrador)
PROPRIETARIO → perfil de SISTEMA — não pode ser atribuído a membros de equipe;
               permissões lidas de MatrizPerfil[perfilSlug='PROPRIETARIO'] das equipes
               vinculadas ao proprietário via Animal.empresaId → Equipe
```

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
VacinaClinica: pendente de migration para campo `status` antes de implementar.

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
Alimento          → banco de alimentos
Nutriente         → banco de nutrientes
ComposicaoAlimento → composição nutricional por alimento/espécie
ExigenciasNRC     → exigências nutricionais por peso/categoria/exercício
Dieta             → itens de dieta atribuídos a animal
PlanoDieta        → agrupamento de itens de dieta
ExameNutricional  → resultados de exames nutricionais
ExameClinico      → exames clínicos solicitados/resultados
EvolucaoClinica   → prontuário/evolução clínica (campos: titulo VARCHAR255, ativo, status)
EvolucaoMidia     → mídias (imagem/vídeo/áudio) anexadas a evoluções (tipo, url, nome, tamanho)
Prescricao        → prescrições médicas (tipo: MEDICAMENTO|PROCEDIMENTO, status: RASCUNHO|ATIVA,
                    dosagem, unidade, via, frequencia, duracaoDias, horaInicio,
                    horariosGerados: JSONB, diasAplicacaoInicio, diasAplicacaoFim)
VacinaClinica     → registro de vacinas
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
Tratador          → responsável pelo animal (nome, telefone, localTrabalho, ativo, empresaId)
RelatorioSalvo    → relatórios nutricionais persistidos
AuditLog          → log de ações dos usuários
AiUsageLog        → rastreabilidade de uso de IA
VetPerfil         → perfil estendido do veterinário (CRMV, bio)
VetEspecie        → especialização do vet por espécie
VetSubespecialidade → subespecialidades do vet
VetAnimalSolicitacao → vínculo/desvinculo vet-animal (tipo: 'VINCULO'|'DESVINCULO', approvalToken, expiresAt)
Empresa           → clínicas/empresas cadastradas
                    Gestor pode ter VÁRIAS empresas. unique(ownerId, nome, cnpj) — cnpj NÃO é mais
                    único global. Duplicata = mesmo owner (e-mail) + mesmo nome + mesmo CPF/CNPJ.
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
EmpresaConfiguracao → configuração única por empresa (CNPJ) ou por equipe (empresa pessoal/CPF) —
                    mesmo critério de escopo do EmpresaContext. Campos: logoUrl, tipoFechamento
                    (DIA_FIXO|DIA_UTIL|ULTIMO_DIA_MES|null=compat), diaFechamentoFatura (dia do mês
                    1-31 p/ DIA_FIXO, Nº dia útil 1-10 p/ DIA_UTIL). unique(empresaId, equipeId).
                    Gerenciada só por GESTOR/dono via GET/PUT /api/equipes/configuracoes
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
- `atendimento.agendamentos` não tem `finalizar`/`imprimir` — agendamentos são gerenciados por status (AGENDADO/CONCLUIDO/CANCELADO)
- `vacina.estoque` não tem `finalizar` — estoque de vacinas segue o mesmo padrão de farmácia
- Sidebar usa `podeExecutar('vacina.estoque.ler')` para exibir o módulo Vacina; agenda ainda usa role check (`isVetOuSuperior`) — ver TODO em seção 12
- ControleAcesso.tsx ACAO_COLS: VER, CRIAR, ALTERAR, EXCLUIR, FINALIZAR, IMPRIMIR. Ações extras (executar, ativar, exportar, compartilhar, whatsapp, fechar, lancar, desvincular) existem no DB mas não aparecem como colunas na UI — pendente implementação de colunas dinâmicas por módulo
- ControleAcesso exibe `agenda` como módulo virtual (extrai `agendamentos` de `atendimento`) — slugs são os mesmos; alterar em um lugar altera nos dois
- Sidebar: Alimentos, Nutrientes e Composição Alimentar ficam no accordion **Nutricional** (apenas ADMIN)
- Sidebar: Cadastro Pessoal, Pacientes/Animais, Proprietários e Tratadores ficam no sub-accordion **Cadastro** dentro de **Geral**
- Para re-sincronizar módulos no banco após alterações no seed: `node backend/seed.js`
- ControleAcesso: botão **Incluir Membro** (profissionais) e **Incluir Cliente** (cargo PROPRIETARIO) para convites

### Regras de modelagem
- `@@schema("schs2vet")` em todos os modelos
- Soft delete via campo `ativo: Boolean`
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
    Animal de OUTRA equipe da mesma empresa fica fora da lista mesmo com vínculo direto do vet;
    pacientes pessoais fora da empresa ativa (vínculo direto) continuam listados
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

### Provider atual: Groq
- Rastreabilidade completa via `AiUsageLog`
- Campos monitorados: modelo, provedor, tokens, custo, latência, sucesso

### Princípios AI-ready
```
- NUNCA acoplar código ao Groq diretamente sem abstração
- SEMPRE usar AIProvider interface que permite trocar modelo/provedor
- Preparar fallback de modelos
- Versionar prompts (não hardcodar prompts no código)
- Logar toda inferência em AiUsageLog
- Controlar custo por operação
```

### Operações de IA existentes
- Geração/sugestão de dietas nutricionais
- `interpretarEvolucao(texto)` em `clinicaLLMService.js` → extrai ações clínicas estruturadas + sugere título a partir de texto livre do prontuário (rota: `POST /api/clinica/evolucoes/interpretar`, degradação graciosa em caso de falha)

---

## 8. UPLOAD E STORAGE

### Estado atual (⚠️ dívida técnica)
- Upload de fotos de animais: compressão via Canvas (máx 1200px, 82% JPEG) antes do envio
- Storage: pasta `uploads/` local no backend

### Padrão a implementar
```typescript
// StorageProvider interface — cloud-agnostic
interface StorageProvider {
  upload(file: Buffer, path: string): Promise<string>
  delete(path: string): Promise<void>
  getUrl(path: string): string
}
// Implementações: LocalStorageProvider, S3Provider, GCSProvider, etc
```

---

## 9. DECISÕES ARQUITETURAIS ATIVAS

| Decisão | Escolha | Motivo |
|---|---|---|
| ORM | Prisma | Type-safety, migrations, multi-db |
| Auth Google | useGoogleLogin (access_token) | Remove "Continuar como X", força seleção |
| Layout scroll | overflow-y-auto no main | Páginas públicas livres, internas controladas |
| Mobile pattern | cards mobile / tabela desktop | UX otimizada por breakpoint |
| Upload | Canvas compress antes do envio | Reduz tráfego e storage |
| IA Provider | Groq (atual) | Velocidade e custo — mas abstraído |
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

- [x] Migrar `backend/src/server.js` → TypeScript (`src/server.ts`)
- [x] Mover `prismaClient.ts` → `src/lib/prisma.ts` (singleton, injetável)
- [x] Implementar `StorageProvider` abstrato (LocalStorageProvider + factory)
- [x] Repository Pattern no backend (BaseRepository + Animal/User/Equipe)
- [x] Criar camada de AI services desacoplada (`src/ai/` — AIProvider interface + GroqProvider)
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
- [x] `UsuarioFormModal.tsx` — formulário compartilhado de criação/edição de usuário (abas Dados/Endereço, busca CEP). Usado em `Usuarios.tsx` (Novo/Editar) e `Equipe.tsx` (Incluir/Editar Membro). Perfil de acesso: VETERINARIO/ESTAGIARIO/PRESTADOR(label Fornecedor)/GESTOR — sem "tipo de usuário" e sem campo senha na criação (padrão `Inicial_001` + `mustChangePassword`); telefone obrigatório. Edição: prop `permitirSenha` exibe "Nova senha" (ADMIN: todos via PUT /users/:id; GESTOR: membros da equipe via PUT /equipes/membros/:id) com regras de senha do sistema; prop `emailBloqueado` desabilita e-mail (usado na edição de membro). Backend: `POST /users` cria sem senha (default Inicial_001, `mustChangePassword: !senha`, phone obrigatório); `POST /equipes/incluir-membro` aceita fullName/phone/endereço (obrigatórios: nome e telefone) e `cargoToUserType` ganhou `GESTOR→VETERINARIO` (antes caía em ESTAGIARIO); `atualizarMembro` (PUT /equipes/membros/:id) ganhou autorização (ADMIN ou gestor da empresa da equipe; gestor não edita gestor — antes QUALQUER autenticado podia editar/trocar senha — bug crítico) + campos endereço/ativo + validação de senha. `listarMembros` retorna phone/endereço. Usuarios.tsx: tabela com `overflow-x-auto` (estourava à direita). Equipe.tsx: edição antiga chamava PATCH inexistente (404) — corrigido para PUT
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
  - VacinaClinica: sem finalizar (modelo sem status/draft). TODO: migration futura para campo `status`.
- [x] **Regra de autoria em editar** — `EvolucaoController.atualizar`, `PrescricaoController.atualizar`, `ExameClinicoController.atualizar`, `EncaminhamentoController.atualizar`: GESTOR edita qualquer item (via `req.membroCargo === 'GESTOR'`); demais só editam itens que criaram (`veterinarioId === req.user.id` → 403 caso contrário). VacinaClinica.atualizar: pendente de migration para campo `status`.
- [x] **Rastreabilidade FaturaItem ↔ origem clínica** (migration `20260701000001_fatura_item_origem`) —
      `FaturaItem` ganhou 4 FKs nullable: `exameClinicoId`, `prescricaoId`, `vacinaClinicaId`,
      `encaminhamentoClinicoId`, setadas por `adicionarFaturaItem` (`faturaUtils.js`) em todo ponto que
      lança cobrança (`ExameClinicoController.finalizar`, `VacinaClinicaController.registrar`,
      `EncaminhamentoController.criar`, `PrescricaoGrupoController.executar`). Editar (descrição) ou
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
- [ ] Slugs orphans `exames.laboratorial.*` e `exames.imagem.*` — existem no seed e aparecem no ControleAcesso mas não protegem nenhum endpoint real (backends usam `atendimento.exames.*`). Gestores que configurarem esses slugs não controlam nada efetivamente. Decisão pendente: remover do seed ou implementar granularidade real por tipo de exame.
- [x] Sidebar/páginas de agenda: migrar gate de role check (`isVetOuSuperior`) para `podeExecutar('atendimento.agendamentos.ler')` — Agenda usa permissão real; Minha Agenda mantém `isVetOuSuperior && podeVerAgendamentos` (sub-view específica de vet). Dashboard oculto para VET (non-Gestor) e ESTAGIÁRIO no Sidebar — eles têm "Pacientes" como home; GESTOR (bypass) continua vendo.
- [ ] UI de gestão de designações no ControleAcesso (aba Equipe → membro PRESTADOR → animais designados)
- [ ] Backfill empresaId nos animais existentes via VetAnimalSolicitacao
- [ ] `empresaId` em EvolucaoClinica, Fatura (após enforcement)
- [ ] Row-Level Security no PostgreSQL (fase enterprise)
- [ ] AI: adicionar OpenAIProvider / GeminiProvider para text completions
- [ ] Testes unitários nos services de permissão e equipe
- [ ] Frontend: migrar raw `fetch('/api...')` restantes para `authFetch` ou `api` (axios)

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
POST   /                                → criar evolução
PUT    /:id                             → atualizar
DELETE /:id                             → soft delete
PATCH  /:id/aprovar                     → aprovar evolução
PATCH  /:id/titulo                      → salvar título
POST   /:id/midias                      → upload de mídia (multipart: midia, máx 100MB, image|video|audio)
DELETE /:id/midias/:midiaId             → remover mídia

# clinica/prescricoes — prefixo /api/clinica/prescricoes
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
GET  /api/equipes/configuracoes → EquipeController.obterConfiguracao (logo + diaFechamentoFatura do escopo ativo)
PUT  /api/equipes/configuracoes → EquipeController.salvarConfiguracao (multipart: logo?, diaFechamentoFatura, removerLogo?) — GESTOR/dono only
```

### Backend — Middlewares

| Arquivo | Uso |
|---|---|
| `auth.js` | `authenticate` — valida JWT, injeta `req.user` |
| `tenant.js` | `injectTenant` — injeta `empresaId` no contexto (usado em animais e evolução) |
| `validate.js` | Roda express-validator, retorna 422 em erros |
| `permissao.middleware.js` | RBAC por userType. `checkPermission(moduloSlug, nivelMinimo)` — verifica permissão real para todos os roles. ADMIN: bypass. GESTOR: bypass. PROPRIETARIO: chama `getNivelPermissaoProprietario()` — lê MatrizPerfil[perfilSlug='PROPRIETARIO'] das equipes vinculadas via Animal.empresaId; aplica deny-wins se NEGADO. `NIVEL_ORDINAL` inclui `NEGADO: -1`. |
| `requestId.js` | Injeta `x-request-id` em toda requisição |

### Frontend — Páginas

| Arquivo | Rota / Propósito |
|---|---|
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
| `Auditoria.tsx` | `/auditoria` — log de auditoria |
| `Usuarios.tsx` | `/usuarios` — gestão de usuários (admin) |
| `AiUsageDashboard.tsx` | `/ai-usage` — monitoramento de uso de IA |

### Frontend — Componentes Globais

| Arquivo | Propósito |
|---|---|
| `PageContainer.tsx` | Wrapper obrigatório de toda página interna. Props: `maxWidth` (`7xl`\|`5xl`\|`3xl`), `noPadding` |
| `Sidebar.tsx` | Navegação lateral. Chama `useProprietarioNotificacoes` e `useVetSolicitacaoMonitor` |
| `AnimalCard.tsx` | Card de resumo do animal. Resolve vet via `solicitacaoAceita ?? veterinarioNome`. Exibe badge PENDENTE |
| `VetNotificationModal.tsx` | Modal bloqueante para vets: mostra solicitações recebidas (não as que o vet iniciou). Tracking via localStorage |
| `ProtectedRoute.tsx` | Guarda de rota por `userType` |
| `SeletorAnimal.tsx` | Dropdown de seleção de animal (alimenta SelectedAnimalContext) |
| `PageContainer.tsx` | Wrapper com padding e maxWidth padronizados |
| `DietaAcoesBar.tsx` | Barra de ações da dieta. Props: `podeImprimir?`, `podeCompartilhar?`, `podeExportar?` (default true). Botões ocultam em modo compacto ou exibem toast quando sem permissão. |

### Frontend — Hooks e Contextos

| Arquivo | Propósito |
|---|---|
| `AuthContext.tsx` | `useAuth()` → `{ user, login, logout, loading }`. `user` tem `{ id, email, fullName, userType }` |
| `SelectedAnimalContext.tsx` | `useSelectedAnimal()` → `{ selectedAnimal, setSelectedAnimal, refreshSelectedAnimal }` |
| `EmpresaContext.tsx` | `useEmpresa()` → `{ opcoes, contextoAtivo, trocarContexto, loading }`. Busca `/equipes/empresas` (só VETERINARIO/ADMIN). Opções: empresa CNPJ = 1 por empresa (equipeId null); empresa pessoal/CPF = 1 por equipe. Persiste `s2vet_empresa_id`/`s2vet_equipe_id`; `trocarContexto` faz reload. Seletor no Sidebar quando `opcoes.length > 1` (label "Empresa ativa" ou "Equipe ativa") |
| `useProprietarioNotificacoes.ts` | Polling 15s em `/animais/minhas-solicitacoes`. Inicializa mapa apenas com PENDENTE/ACEITO — RECUSADO/CANCELADO excluídos para detecção retroativa via updatedAt <10min. Só para PROPRIETARIO |
| `useVetSolicitacaoMonitor.ts` | Polling 30s em `/veterinarios/solicitacoes`. Detecta novas solicitações PENDENTE e mudanças CANCELADO. Só para VETERINARIO |
| `useVetPendentes.ts` | Badge de contagem de pendentes no sidebar do vet |
| `services/api.ts` | Instância Axios configurada. Interceptor 401 → refresh automático. Interceptor 403 → GET resolve `{ data: null }` (silencioso); mutations rejeitam com `{ isPermissionError: true }` (sem log). Base URL: `/api` |
| `hooks/usePermissoes.ts` | `Nivel` inclui `'NEGADO'`. `NIVEL_ORDINAL` inclui `NEGADO: -1`. `podeExecutar` retorna false para NEGADO (ordinal -1 < qualquer mínimo). `loading` deve ser usado para gating de useEffects. |
| `services/whisperService.ts` | Transcrição: online → Web Speech API, offline → Whisper local. Funções: `isMobile()`, `estaOnline()`, `carregarModelo()`, `transcreverOffline()` |
| `utils/EvolucaoPrint.ts` | `imprimirEvolucao(evolucao)` — abre janela de impressão formatada para evolução clínica |

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
    NÃO é mais necessário adicionar `injectTenant` por rota (middleware tenant.js é redundante mas inofensivo).
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
    Slugs orphans: exames.laboratorial.* e exames.imagem.* existem no seed e aparecem no ControleAcesso
    mas NENHUM backend route os usa. Gestor que configurar esses slugs não controla nada efetivamente.
    Farmácia, vacina.estoque e todos os módulos de cadastro agora têm checkPermission — os slugs do seed
    estão alinhados com os routes a partir de 2026-06-24.

28. Regra de finalização — GESTOR vs FORNECEDOR vs outros:
    checkPermission('*.finalizar', 'PROPRIO') no route determina quem chega ao controller:
    - GESTOR (userType=VETERINARIO com cargo GESTOR) → bypass total em checkPermission → chega sempre
    - FORNECEDOR → MatrizPerfil PROPRIO ≥ PROPRIO → chega; controller verifica veterinarioId === req.user.id
    - VET não-GESTOR → MatrizPerfil NENHUM → 403 no checkPermission → nunca chega ao controller
    - Identificação de autoria: todos os create agora setam veterinarioId = req.user.id (inclusive FORNECEDOR)
      ExameClinico.criar antes setava null para não-VET — bug corrigido em 2026-06-24.
    - VacinaClinica não tem route de finalizar (sem status field no schema). Adicionar migration + route
      futuramente quando workflow draft→aplicada for necessário.
    - EncaminhamentoController.finalizar (novo) é distinto de atualizarStatus: aplica a regra de autoria
      e sempre transita para CONCLUIDO. atualizarStatus continua existindo para mudanças de status gerais
      (usadas por gestores diretamente, que têm bypass em checkPermission).

29. Regra de autoria em editar — GESTOR pode editar qualquer item; demais só editam o que criaram:
    Para `editar`, a barreira do `checkPermission` passa VET/FORNECEDOR (nível PROPRIO), mas o
    controller verifica autoria via `req.membroCargo`. Diferença entre as duas regras:
    - Finalizar (implementado):  GESTOR=qualquer, FORNECEDOR=próprio, VET=bloqueado no checkPermission
    - Editar (implementado):     GESTOR=qualquer, TODOS OS DEMAIS=apenas próprio (VET também limitado)
    Identificação de GESTOR sem query extra: `req.membroCargo` já é setado como `'GESTOR'` pelo
    `checkPermission` em todos os bypass paths (cargo GESTOR, dono de empresa sem MembroEquipe,
    dono da empresa da equipe). No controller: `if (req.membroCargo !== 'GESTOR' && item.veterinarioId !== req.user.id) → 403`.
    O padrão de FORNECEDOR ownership NÃO é suficiente para essa regra — um VET não-GESTOR também
    é barrado de editar itens de outros. Aplicado em: EvolucaoController, PrescricaoController,
    ExameClinicoController, EncaminhamentoController. VacinaClinica pendente de migration `status`.

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
| API keys | Groq e Gemini apenas no backend `.env` | Nunca expor no bundle JS do frontend |
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
Backend recusa iniciar se JWT_SECRET tiver menos de 32 caracteres.
**O valor atual é fraco — gerar novo antes de ir para produção.**

### HashRouter — regra de ouro para links de email
```javascript
// SEMPRE usar /#/ antes do path nos links enviados por email
`${appUrl}/#/veterinarios/solicitacoes/aprovar?token=X&acao=aceitar`
`${appUrl}/#/proprietario/aprovar-vinculo?token=X&acao=aceitar`
`${appUrl}/#/reset-password?token=X`
`${appUrl}/#/equipe/convite/${token}`
```

### Pendências de segurança (futuro)
- [ ] Migrar tokens de localStorage para HttpOnly Cookies
- [ ] UUIDs em vez de IDs sequenciais (dificulta enumeração via URL)
- [ ] Renovar JWT_SECRET antes de produção
- [ ] Configurar ALLOWED_ORIGINS com domínio real em produção

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

