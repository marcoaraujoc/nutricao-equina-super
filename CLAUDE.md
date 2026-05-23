# S2Vet — CLAUDE.md
# Contexto arquitetural permanente para Claude Code
# Atualizado em: 2026-05-23

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
type UserType = 'ADMIN' | 'VETERINARIO' | 'PROPRIETARIO' | 'ESTAGIARIO'
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

### Fluxo de VÍNCULO vet-animal (VINCULO)
```
Proprietário associa vet → cria VetAnimalSolicitacao {tipo:'VINCULO', status:'PENDENTE'}
Email enviado ao vet com links aceitar/recusar (approvalToken)
Vet responde (dashboard ou email) → status → 'ACEITO' ou 'RECUSADO'
24h sem resposta → cron auto-aceita (status→'ACEITO')
Proprietário notificado via polling (useProprietarioNotificacoes, 30s)
```

### Fluxo de DESVINCULO vet-animal (DESVINCULO)
```
Proprietário remove vet → MESMO registro VetAnimalSolicitacao atualizado:
  {tipo:'DESVINCULO', status:'PENDENTE', approvalToken, expiresAt}
Email enviado ao vet: "Aceitar remoção" / "Manter meu acesso" (24h expiry)
Vet aceita  → status:'ACEITO'  → vet não aparece mais como responsável
Vet recusa  → registro restaurado: {tipo:'VINCULO', status:'ACEITO', mensagem:null}
24h sem resposta → cron auto-aceita (remoção confirmada)
Proprietário notificado via useProprietarioNotificacoes (30s polling)
NOTA: unique constraint (animalId, vetUserId) — só existe 1 registro por par, que é reutilizado
```

### Endpoints de solicitações
- `GET  /api/animais/minhas-solicitacoes` — proprietário: lista todas suas solicitações (inclui tipo)
- `GET  /api/veterinarios/solicitacoes?status=PENDENTE` — vet: lista pendentes (inclui tipo)
- `PATCH /api/veterinarios/solicitacoes/:id/responder` — vet: aceita/recusa (body: {status})
- `GET  /api/veterinarios/solicitacoes/:token/responder-email` — resposta via link de email

---

## 5. BANCO DE DADOS

### Schema: `schs2vet` (PostgreSQL)

### Entidades principais
```
User              → usuários (todos os roles)
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
EvolucaoClinica   → prontuário/evolução clínica
Prescricao        → prescrições médicas
VacinaClinica     → registro de vacinas
EncaminhamentoClinico → encaminhamentos entre especialistas
Fatura / FaturaItem → financeiro básico
RelatorioSalvo    → relatórios nutricionais persistidos
AuditLog          → log de ações dos usuários
AiUsageLog        → rastreabilidade de uso de IA
VetPerfil         → perfil estendido do veterinário (CRMV, bio)
VetEspecie        → especialização do vet por espécie
VetSubespecialidade → subespecialidades do vet
VetAnimalSolicitacao → vínculo/desvinculo vet-animal (tipo: 'VINCULO'|'DESVINCULO', approvalToken, expiresAt)
Empresa           → clínicas/empresas cadastradas
Equipe            → equipes dentro de uma empresa
MembroEquipe      → membros de cada equipe
ConviteEquipe     → convites para entrar em equipes
```

### Regras de modelagem
- `@@schema("schs2vet")` em todos os modelos
- Soft delete via campo `ativo: Boolean`
- Audit fields: `createdAt`, `updatedAt` onde aplicável
- Indexes explícitos em FKs e campos de busca frequente
- `@@unique` composto onde necessário (ex: [animalId, vetUserId])

### Multi-tenant — status atual (prep concluída, enforcement pendente)
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
// Primeira carga: inicializa o mapa sem disparar toast (prevStatusRef.current === null)
// Polling a cada 30s com setInterval, limpado no cleanup
// Fire-and-forget: nunca bloquear UI por falha de polling

// Hooks existentes (chamados no Sidebar para todos os perfis):
// useProprietarioNotificacoes — /animais/minhas-solicitacoes (só PROPRIETARIO)
//   Detecta: PENDENTE→ACEITO e PENDENTE→RECUSADO, diferencia tipo VINCULO vs DESVINCULO
// useVetSolicitacaoMonitor — /veterinarios/solicitacoes (só VETERINARIO)
//   Detecta: novas solicitações PENDENTE, mudanças ACEITO/CANCELADO
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
- (expandir conforme implementado)

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
Banco dev: SQLite / Banco prod: PostgreSQL (schema: schs2vet)
```

### Comandos úteis
```bash
# Frontend
cd frontend && npm run dev

# Backend
cd backend && npm run dev

# Prisma
npx prisma migrate dev
npx prisma studio
npx prisma generate

# Seeds
node scripts/seed.js

# Testes
cd backend && npm test
cd backend && npm run test:coverage
```

### ⚠️ Windows — Prisma type resolution
O Prisma gera o client em `node_modules/.prisma/client/` mas o TypeScript
resolve via `@prisma/client` que espera o caminho relativo `.prisma/client/`.
No Windows, o npm **não** cria o symlink automaticamente. Após `npm install`
ou quando os tipos não resolverem, execute:

```powershell
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
- [ ] Backfill empresaId nos animais existentes via VetAnimalSolicitacao
- [ ] `empresaId` em EvolucaoClinica, Fatura (após enforcement)
- [ ] Row-Level Security no PostgreSQL (fase enterprise)
- [ ] AI: adicionar OpenAIProvider / GeminiProvider para text completions
- [ ] Testes unitários nos services de permissão e equipe
- [ ] Frontend: migrar raw `fetch('/api...')` restantes para `authFetch` ou `api` (axios)

---

*Este arquivo deve ser mantido atualizado a cada evolução arquitetural significativa.*
*É o contrato vivo entre o time e a arquitetura do S2Vet.*