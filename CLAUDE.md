# S2Vet — CLAUDE.md
# Contexto arquitetural permanente para Claude Code

> **Como esta documentação está organizada** (reestruturada em 2026-09-22)
>
> Este arquivo guarda o que vale SEMPRE: arquitetura, RBAC, banco, padrões de código,
> armadilhas e segurança. Ele é carregado inteiro em toda sessão.
>
> O **histórico de decisões** — 71 sessões de trabalho, com o porquê de cada regra e as
> armadilhas que cada uma fechou — foi movido, VERBATIM e sem nenhum corte, para
> `.claude/rules/hist-*.md`. Esses arquivos têm `paths:` no frontmatter e entram no contexto
> SOZINHOS quando se toca um arquivo da área correspondente: mexeu em fatura, o histórico do
> financeiro chega junto; mexeu em prescrição, chega o do atendimento.
>
> 🔴 **Nada foi resumido, reescrito ou descartado nessa mudança** — só mudou de lugar. O que era
> uma leitura de 14.030 linhas em toda sessão virou ~3.500 linhas fixas + o histórico da área em
> que se está trabalhando.
>
> ⚠️ **Sessão nova entra no `.claude/rules/hist-<área>.md` da área**, no topo, no mesmo formato
> (`# Atualizado em:` como resumo e/ou `### Sessão` com o detalhe). NÃO volte a acumular
> changelog neste arquivo: foi isso que o fez chegar a 280 mil tokens por sessão.
>
> ⚠️ **Regra que passou a valer SEMPRE** (não é história) não fica só no histórico — promova-a
> para a seção correspondente daqui: §6 padrões, §10 invioláveis, §13 armadilhas, §14 segurança.

## MAPA DO HISTÓRICO — onde está o quê

| Arquivo | Carrega quando você toca | Cobre |
|---|---|---|
| `hist-atendimento.md` | evolução, prescrição, vacina, exame, encaminhamento, agenda | 20 sessões — Atendimento clinico |
| `hist-cadastro.md` | animal, proprietário, prestador, fornecedor, equipe, catálogo, procedimento | 16 sessões — Cadastro (paciente, cliente, equipe, catalogo) |
| `hist-estoque.md` | estoque, farmácia, medicamento, produto, lote, unidade/multidose | 8 sessões — Estoque, produtos e unidades |
| `hist-financeiro.md` | fatura, orçamento, contas a pagar, recibo, relatórios | 10 sessões — Financeiro (fatura, orcamento, contas a pagar) |
| `hist-documentos.md` | Central de Documentos, modelos, folha, impressão, PDF/envio | 8 sessões — Central de Documentos, folha e impressao |
| `hist-rbac.md` | permissões, autoria, escopo de acesso, auditoria, middlewares | 5 sessões — Permissoes, autoria e escopo de acesso |
| `hist-plataforma.md` | prisma/RLS, crons, auth/sessão/2FA, fuso, storage, e-mail/WhatsApp | 8 sessões — Plataforma (RLS, crons, sessao, fuso, concorrencia) |
| `hist-ia.md` | `backend/src/ai/**`, serviços LLM, quota, memória clínica | 4 sessões — IA (prompts, memoria clinica, quota) |
| `hist-ui.md` | componentes, shell, Sidebar, padrões de tela, dashboards | 5 sessões — Padroes de tela, shell e componentes |

Para ler um histórico fora do seu path (ex.: entender uma decisão de fatura sem abrir código de
fatura), abra o arquivo direto: `.claude/rules/hist-financeiro.md`.

<details>
<summary>Índice completo das 71 sessões, por área e data</summary>

**Atendimento clinico** — `.claude/rules/hist-atendimento.md`

- `['2026-09-18', 4]` 2026-09-18 (parte 4) (🔴 **ANTECIPAR DOSE DEIXOU DE SER BLOQUEIO E
- `['2026-09-15', 5]` 2026-09-15 (parte 5) (🔴 **A POSTERGAÇÃO DA DOSE ATRASADA ESTAVA
- `['2026-09-09', 3]` 2026-09-09 (parte 3) (🔴 **O EXAME DE IMAGEM VIROU PROCEDIMENTO** —
- `['2026-09-06', 2]` 2026-09-06 (parte 2) — Cadeia de responsáveis, ordenação nos históricos e filt
- `['2026-09-06', 1]` 2026-09-06 (🔴 INATIVAR O PACIENTE FECHA O ATENDIMENTO ABERTO +
- `['2026-09-05', 5]` 2026-09-05 (parte 5) (🔴 CONCORRÊNCIA CHEGOU À PRESCRIÇÃO E AO
- `['2026-09-02', 3]` 2026-09-02 (parte 3) (🔴 A DESCRIÇÃO DO EXAME SUMIA AO ANEXAR O
- `['2026-08-31', 4]` 2026-08-31 (parte 4) — Execução de Prescrição: histórico dentro da execução
- `['2026-08-31', 3]` 2026-08-31 (parte 3) — Prescrição: "1x a cada N dias" agenda por Qtd. de Vezes
- `['2026-08-25', 1]` 2026-08-25 — Atendimento ativo passou a ser ESCOLHIDO, não adivinhado
- `['2026-08-23', 1]` 2026-08-23 (AGENDA DE DOSES — 4 mudanças ligadas, todas em
- `['2026-08-18', 4]` 2026-08-18 (parte 4) — Vacina: validação de obrigatórios, bug de estoque e col
- `['2026-08-18', 3]` 2026-08-18 (parte 3) — Duas consultas do MESMO animal no MESMO dia são atendim
- `['2026-08-18', 2]` 2026-08-18 (parte 2) — Agendamento: status `CANCELADO_AUTOMATICAMENTE`
- `['2026-08-18', 1]` 2026-08-18 (Vacina ganhou RESERVA de estoque — model novo
- `['2026-07-30', 1]` 2026-07-30 — Agenda: local no lugar da espécie + adiantar × passado
- `['2026-07-29', 1]` 2026-07-29 (Evolução: assumir SÓ a de outro profissional c/ e-mail+WhatsApp, p
- `['2026-07-28', 6]` 2026-07-28 (parte 6) — Agenda: reagendar, transferir e assumir
- `['2026-07-28', 3]` 2026-07-28 (parte 3) — Tempo de consulta por especialidade na grade
- `['2026-07-25', 1]` 2026-07-25 (Vacina com a lógica da Prescrição: SALVA→FINALIZADA→EXECUTADA — fa

**Cadastro (paciente, cliente, equipe, catalogo)** — `.claude/rules/hist-cadastro.md`

- `['2026-09-16', 1]` 2026-09-16 (🔴 **A CHAVE ÚNICA DO CATÁLOGO IGNORAVA A EMPRESA — o
- `['2026-09-15', 4]` 2026-09-15 (parte 4) (🔴 **O QUE É DA EMPRESA VEM ANTES DO CATÁLOGO
- `['2026-09-15', 3]` 2026-09-15 (parte 3) (🔴 **O E-MAIL PASSOU A TRAZER O CADASTRO QUE A
- `['2026-09-15', 2]` 2026-09-15 (parte 2) — O prestador passou a ter VÁRIOS tipos de serviço
- `['2026-09-15', 1]` 2026-09-15 (🔴 **PRODUTOS VIROU O CADASTRO DO ITEM** + prestador na
- `['2026-09-11', 2]` 2026-09-11 (parte 2) (🔴 **O PRESTADOR SAIU DAS TRÊS TELAS** — a pedido,
- `['2026-09-11', 1]` 2026-09-11 (🔴 **A GRADE DE PROCEDIMENTOS DEIXOU DE SALVAR SOZINHA** +
- `['2026-09-10', 2]` 2026-09-10 (parte 2) (✅ **MIGRATIONS APLICADAS** + a grade de
- `['2026-09-09', 2]` 2026-09-09 (parte 2) (🔴 **FORNECEDOR E PRESTADOR NÃO SÃO EQUIPE** —
- `['2026-09-06', 4]` 2026-09-06 (parte 4) (🔴 O PACIENTE DO CLIENTE INATIVADO DEIXOU DE
- `['2026-09-06', 3]` 2026-09-06 (parte 3) — Duplicidade de paciente e troca de dono na tela de cada
- `['2026-09-02', 2]` 2026-09-02 (parte 2) (🔴 PACIENTE INATIVO = PRONTUÁRIO CONGELADO,
- `['2026-08-21', 1]` 2026-08-21 (Prestador: cadastro NOVO e INDEPENDENTE de Fornecedor —
- `['2026-08-01', 2]` 2026-08-01 (parte 2) — Foto do profissional
- `['2026-07-28', 5]` 2026-07-28 (parte 5) — Profissional isolado por empresa
- `['2026-07-28', 4]` 2026-07-28 (parte 4) — Herança do padrão da empresa + erro na tela do cadastro

**Estoque, produtos e unidades** — `.claude/rules/hist-estoque.md`

- `['2026-09-19', 4]` 2026-09-19 (parte 4) (🔴 **O CURSO QUE NÃO CABE NUM FRASCO PASSOU A
- `['2026-09-18', 3]` 2026-09-18 (parte 3) (🔴 **A RECEITA VOLTOU A SER ESCRITA NA UNIDADE
- `['2026-09-17', 2]` 2026-09-17 (parte 2) (🔴 **VALOR COMPRADO E VALOR REPASSADO PASSARAM A
- `['2026-09-17', 1]` 2026-09-17 (🔴 **PRODUTO SEM MULTIDOSE E MEDIDO EM 'Un.'** — a
- `['2026-09-16', 2]` 2026-09-16 (parte 2) (🔴 **A EMBALAGEM DEIXOU DE SER A PROPRIA UNIDADE** —
- `['2026-09-12', 2]` 2026-09-12 (parte 2) (🔴 **PRODUTO MULTIDOSE — e a tela de Produtos
- `['2026-09-12', 1]` 2026-09-12 (🔴 **A UNIDADE DO MEDICAMENTO PASSOU A SER DA CLÍNICA.**
- `['2026-08-18', 5]` 2026-08-18 (parte 5) — Vacina ganhou RESERVA de estoque — mesma lógica do medi

**Financeiro (fatura, orcamento, contas a pagar)** — `.claude/rules/hist-financeiro.md`

- `['2026-09-19', 2]` 2026-09-19 (parte 2) (🔴 **A COMPRA DO ESTOQUE CHEGAVA A TELA DE
- `['2026-09-18', 1]` 2026-09-18 (LEVA DE 12 PEDIDOS. O que mais importa saber ao voltar:
- `['2026-09-17', 3]` 2026-09-17 (parte 3) (🔴 **A LINHA DA FATURA PASSOU A JUNTAR
- `['2026-09-10', 4]` 2026-09-10 (parte 4) (🔴 **FORMA DE COBRANÇA DE MEDICAMENTO/VACINA.**
- `['2026-09-10', 3]` 2026-09-10 (parte 3) (🔴 **PRODUTOS DE FORNECEDOR + CONTAS A PAGAR.**
- `['2026-09-10', 1]` 2026-09-10 (🔴 **O PROCEDIMENTO PASSOU A TER PRESTADOR, DOIS PREÇOS E
- `['2026-09-08', 5]` 2026-09-08 (parte 5) — Avisos de orçamento, PIX na fatura e a senha que ningué
- `['2026-09-08', 1]` 2026-09-08 (partes 3 a 5) (LEVA GRANDE — seis frentes. O que mais
- `['2026-08-01', 1]` 2026-08-01 — Configurações da empresa: obrigatoriedades + validade do orçament
- `['2026-07-23', 1]` 2026-07-23 (Orçamento: posologia do medicamento (dias+frequência), doses da va

**Central de Documentos, folha e impressao** — `.claude/rules/hist-documentos.md`

- `['2026-09-08', 2]` 2026-09-08 (parte 2) (DOCUMENTOS: e-mail do veterinário, TIMBRE do
- `['2026-09-05', 1]` 2026-09-05 (WhatsApp/E-mail passaram a mandar o PDF em Prescrição,
- `['2026-09-03', 1]` 2026-09-03 (🔴 O EMITIDO EXIBIA DADO DE EXEMPLO + a folha e o
- `['2026-09-02', 1]` 2026-09-02 (🔴 A ASSINATURA DO VETERINÁRIO SAÍA NA LINHA DE TODO
- `['2026-09-01', 2]` 2026-09-01 (parte 2) (LISTAS REPETÍVEIS — medicamento, vacina, exame e
- `['2026-09-01', 1]` 2026-09-01 (CABEÇALHO PADRÃO EM TODA FOLHA + DOCUMENTO ENVIADO VIRA
- `['2026-08-30', 1]` 2026-08-30 (🔴 REGRESSÃO CORRIGIDA + `/documentos` REMODELADA.
- `['2026-08-26', 1]` 2026-08-26 (CENTRAL DE DOCUMENTOS DEIXOU DE SER PROTÓTIPO. A tela

**Permissoes, autoria e escopo de acesso** — `.claude/rules/hist-rbac.md`

- `['2026-09-09', 1]` 2026-09-09 (**CARGO PRESTADOR** — agora de verdade — e o cron que
- `['2026-08-31', 1]` 2026-08-31 (Execução de Prescrição: card do item mostra o
- `['2026-08-22', 1]` 2026-08-22 (Auditoria ganhou a categoria ACESSO_NEGADO — tentativa
- `['2026-08-04', 1]` 2026-08-04 (Senha: FormularioNovaSenha compartilhado entre a tela da app e o l
- `['2026-07-16', 1]` 2026-07-16 (Listagem de animais base × convidado: base própria vê todos os vín

**Plataforma (RLS, crons, sessao, fuso, concorrencia)** — `.claude/rules/hist-plataforma.md`

- `['2026-09-18', 2]` 2026-09-18 (parte 2) (🔴 **O JOB DO CRMV SÓ TRAZIA NÚMERO DE 5 DÍGITOS —
- `['2026-09-05', 4]` 2026-09-05 (parte 4) (🔴 CONTROLE DE CONCORRÊNCIA DE EDIÇÃO —
- `['2026-08-23', 4]` 2026-08-23 (parte 4) (🔴 CRONS QUEBRADOS PELO RLS — o fechamento
- `['2026-08-23', 3]` 2026-08-23 (parte 3) (FUSO DEDUZIDO DO ENDEREÇO — o campo de escolha
- `['2026-08-23', 2]` 2026-08-23 (parte 2) (FUSO HORÁRIO POR EMPRESA — a aplicação roda em
- `['2026-08-20', 1]` 2026-08-20 (CRMV: a sincronização diária TROCOU de estratégia —
- `['2026-08-11', 1]` 2026-08-11 (grupo2corrigir FECHADO: bug real em ExameCompra.tsx (setSelectedAn
- `['2026-08-02', 1]` 2026-08-02 (Sessão por INATIVIDADE de 2h (lib/sessionTokens.js), rastro de "as

**IA (prompts, memoria clinica, quota)** — `.claude/rules/hist-ia.md`

- `['2026-09-19', 3]` 2026-09-19 (parte 3) (🔴 **A LEITURA DO DOCUMENTO DE COMPRA MANDAVA
- `['2026-09-08', 3]` 2026-09-08 (parte 3) — Envio único, e a memória clínica que parou de inventar
- `['2026-07-28', 2]` 2026-07-28 (parte 2) — Metering de IA por cliente + 2FA por e-mail
- `['2026-07-28', 1]` 2026-07-28 — IA: provider único, Memória Clínica, IA Financeira, consumo por m

**Padroes de tela, shell e componentes** — `.claude/rules/hist-ui.md`

- `['2026-09-19', 1]` 2026-09-19 (**O LOGIN PASSOU A POUSAR NO MAPA DE ATENDIMENTO** e
- `['2026-08-31', 2]` 2026-08-31 (parte 2) — Prescrição/Exames/Vacina: colunas e ordem/cor de ícone
- `['2026-08-21', 1]` 2026-08-21 (Nova rota PÚBLICA "/" — página institucional, para
- `['2026-07-31', 1]` 2026-07-31 (Shell: header e rodapé globais, busca global por empresa (/api/bus
- `['2026-07-14', 1]` 2026-07-14 (Relatórios com período + Tabela responsiva; expediente de atendime

</details>


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
                    🔴 **CORRIGÍVEL ATÉ A DOSE SER APLICADA** (2026-09-23):
                    `STATUS_ALTERAVEIS = ['SALVA', 'FINALIZADA']` no
                    `VacinaClinicaController`, espelhado em `STATUS_ALTERAVEIS_VAC`
                    (SubModuloVacina). A FINALIZADA não tirou frasco da prateleira —
                    ela tem RESERVA, e o débito e a cobrança só acontecem em
                    `executar`. EXECUTADA e CANCELADA seguem fechadas.
                    ⚠️ **Alterar uma FINALIZADA REFAZ o destino pela MATRIZ "quem
                    FORNECE × quem APLICA"**, com o MESMO encadeamento de `finalizar`:
                    a reserva antiga sai sempre e é recriada se a dose segue no
                    plantão; marcar "aplicada pelo proprietário" debita, fatura, agenda
                    o reforço e vai para EXECUTADA (é a única chance de cobrar);
                    "fornecida pelo cliente" libera a reserva sem débito nem cobrança.
                    Gravar só os campos deixaria a reserva presa no lote do produto
                    ANTIGO. Gate: `__tests__/vacinaAlteravelAteAplicar.test.js`.
                    ⚠️ **SALDO não recusa o registro** (2026-09-23): o 400 `Lote sem
                    saldo disponível` saiu de `registrar` e `atualizar` — mesma decisão
                    da prescrição. **A trava de VALIDADE FICA**: "acabou o saldo" e "o
                    frasco está vencido" são perguntas diferentes.
EncaminhamentoClinico → encaminhamentos (status PENDENTE|CONCLUIDO|CANCELADO;
                    urgencia NORMAL|ALTA|URGENTE)
                    🔴 **O DESTINO INTERNO É O CADASTRO DE PRESTADOR, NÃO UM USUÁRIO**
                    (migration 20261022000000): `prestadorCadastroId` +
                    `prestadorCadastroOrigem` ('PRESTADOR'|'FORNECEDOR'). `tb_prestadores`
                    e `tb_fornecedores` são tabelas distintas e não cabem numa FK só —
                    é o mesmo par (origem, id) de `lib/contasPagar.js`.
                    POR QUÊ: prestador só ganha usuário quando o cadastro é salvo com
                    "acesso ao sistema", então o ferrador/quiroprata cadastrado sem
                    login **não existia no seletor** — e a lista era completada com os
                    VETERINÁRIOS da equipe, que não é o que a aba se propõe a oferecer.
                    LEITURA/ESCRITA: SEMPRE por `lib/encaminhamentoPrestador.js` (SQL
                    cru com guarda de coluna) — passar as colunas ao
                    `encaminhamentoClinico.create` tipado com o client defasado
                    derrubaria a CRIAÇÃO INTEIRA, não só o campo novo. O nome vem por
                    JOIN na leitura, nunca por snapshot: o cadastro é soft-deleted e
                    renomeá-lo deve aparecer no histórico.
                    ⚠️ `prestadorId` (o LOGIN) CONTINUA e continua sendo quem recebe a
                    `DesignacaoPrestador` — designação é ESCOPO DE ACESSO, e sem
                    usuário não há a quem dar acesso. Encaminhar para prestador sem
                    login grava o registro clínico e **NÃO libera o paciente**; a tela
                    diz isso antes de salvar, e o selo "Prestador com acesso a este
                    paciente" olha `enc.prestadorId`, nunca "destino interno".
                    ⚠️ A especialidade da aba sai do `tipo_servico` do CADASTRO —
                    `UsuarioEspecialidade`/`FornecedorEspecialidade` saíram da conta,
                    era por elas que o veterinário entrava na lista.
                    ⚠️ FORNECEDOR entra junto de PRESTADOR: o cargo novo nasceu em
                    2026-09-09 e nada foi migrado. Quem só VENDE (loja, laboratório,
                    farmácia) sai da lista inteira.
                    Gate: `__tests__/encaminhamentoPrestadorCadastro.test.js`.
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
                    mesReferencia? VARCHAR(7) ex: "2026-06", status (ABERTA|REABERTA|PAGA|
                    CANCELADA|FECHADA|ATRASADA)
                    🔴 **QUANDO O CICLO SEGUINTE NASCE** (`faturaUtils.abreProximoCiclo`,
                    2026-09-23) — consultado por `abrirProximaFatura`, logo vale pelas QUATRO
                    portas de fechamento (`fecharFatura`, `atualizarStatus`, `fecharFaturasLote`
                    e o cron, que passaram a informar `statusAnterior`):
                    · **REABERTA fechada de novo NÃO abre nada.** Ela é um documento ANTIGO
                      destravado para corrigir uma linha; abrir um ciclo ali criava uma fatura
                      do mês seguinte a cada correção, e o cliente terminava o ano com faturas
                      vazias de meses que nunca foram faturados.
                    · **Não se abre fatura de mês FUTURO.** Fechar a de setembro no dia 23
                      criava a de outubro com setembro ainda correndo, e toda cobrança do
                      resto do mês caía lá dentro. Quando outubro chegar, o primeiro
                      lançamento clínico cria a fatura sozinho (`getOrCreateFatura`) — a
                      assistência mensal não se perde, ela é lançada no FECHAMENTO de cada
                      fatura, não na criação da seguinte.
                    🔴 **UMA ABERTA NÃO CONVIVE COM UMA REABERTA DO MESMO MÊS** (2026-09-23).
                    Duas faturas do mesmo mês partem a cobrança em dois documentos e
                    `getOrCreateFatura` pega a primeira que achar — metade dos lançamentos vai
                    parar na outra, sem erro e sem log. Fechado pelos dois lados:
                    `getOrCreateFatura` **ADOTA a REABERTA do mês CORRENTE** em vez de criar
                    uma ABERTA ao lado dela, e a reabertura recusa com 400
                    `FATURA_ABERTA_NO_MES` (helper `faturaAbertaNoMes`) quando o par já existe.
                    ⚠️ A REABERTA de mês ANTERIOR CONTINUA fora de `getOrCreateFatura` — é o
                    caso que a regra de 2026-09-06 protege (reabrir agosto e receber a
                    cobrança de setembro). "Reaberta do mês corrente" só existe quando alguém
                    fechou o mês antes do fim e reabriu; ali ela É a fatura corrente.
                    🔴 **FECHAMENTO POR ANIMAL** (migration 20261018000000): `total` passou a
                    ser O QUE A FATURA AINDA COBRA — só os itens ABERTOS; o bloco de um
                    paciente fechado à parte (`FaturaItem.fechadoEm`) sai dele e vai para
                    `totalFechado`. O bloco fechado NÃO é pago nem cancelado: continua
                    DEVIDO, só é acertado separadamente — por isso todo indicador de
                    "a receber" soma `total + totalFechado` (Dashboard, Relatórios
                    Financeiros, devedores e melhores pagadores do Gerencial). Somar só
                    `total` faz o indicador encolher a cada fechamento, sem erro e sem log.
                    ⚠️ O FATURAMENTO do período NÃO muda: ele soma ITENS, e o item fechado
                    à parte continua sendo receita reconhecida.
                    LEITURA/ESCRITA: SEMPRE por `lib/faturaFechamentoAnimal.js` (SQL cru com
                    guarda de coluna, padrão de `lib/formasRecebimentoFatura.js`), e os dois
                    totais são gravados SÓ por `recalcularTotal` (lib/faturaUtils.js) — é
                    isso que faz o fechamento por animal não tocar em nenhum dos ~10 pontos
                    que lançam cobrança. Rotas
                    `PATCH /clinica/faturas/:id/animais/:animalId/{fechar,reabrir}`
                    (`financeiro.faturas.fechar`, o MESMO slug de fechar a fatura inteira).
                    🔴 **PAGAMENTO POR ANIMAL** (migration 20261021000000): `totalPagoAnimal`
                    é o bloco de paciente JÁ ACERTADO (`FaturaItem.pagoEm`) — ele NÃO é mais
                    a receber, e por isso SAI de `totalFechado`. São TRÊS totais, todos
                    gravados só por `recalcularTotal`: `total` (cobra) · `totalFechado`
                    (fechado e ainda DEVIDO) · `totalPagoAnimal` (recebido).
                    ⚠️ **PAGO VENCE FECHADO** no recálculo: todo item pago também está
                    fechado (pagar fecha o que estiver aberto), e contá-lo nos dois somaria
                    o MESMO valor como recebido E como devido.
                    ⚠️ Por isso "a receber" continua sendo `total + totalFechado` em TODO
                    indicador — nada ali mudou. Quem conta RECEBIDO é que soma
                    `totalPagoAnimal` (melhores pagadores, que passou a varrer as faturas do
                    período e não só as quitadas: acerto em fatura ABERTA é dinheiro que
                    entrou).
                    ⚠️ **Pagar o bloco NÃO mexe no status da fatura** — ela segue ABERTA
                    cobrando os outros pacientes, que é o ponto inteiro do pagamento por
                    animal. E **reabrir não toca no que foi pago**: desfazer a baixa é
                    `estornar`, ato de GESTOR (mesmo critério de reabrir fatura paga).
                    Rotas `PATCH .../animais/:animalId/{pagar,estornar}` com
                    `financeiro.faturas.editar` — o MESMO slug de marcar a fatura como paga.
                    Gate: `__tests__/faturaPagamentoPorAnimal.test.js`.
                    FaturaItem: animalId? (adicionado migration 20260605), tipo VARCHAR(50), veterinarioId?
                    FaturaItem.pagoEm/pagoPorId (migration 20261021000000): preenchido = o
                    bloco deste paciente já foi ACERTADO — fora do `total` e fora do
                    `totalFechado`. Item pago é SEMPRE item fechado.
                    FaturaItem.fechadoEm/fechadoPorId (migration 20261018000000): preenchido =
                    a linha foi encerrada junto com o bloco do paciente dela e está FORA do
                    `Fatura.total`. ⚠️ A marca é do ITEM, NUNCA do par (fatura, animal): é o
                    que faz a cobrança que chega DEPOIS do fechamento nascer ABERTA e voltar
                    a contar — com a marca no par, toda dose aplicada depois cairia calada
                    dentro de um bloco encerrado e o cliente deixaria de ser cobrado.
                    🔴 **FECHAR CONGELA A LINHA** (2026-09-23, a pedido — REVERTE "fatura
                    FECHADA segue aceitando correção de item"). Fechado é somente leitura em
                    TODA escala: a fatura FECHADA/ATRASADA, o bloco do PACIENTE fechado
                    (`fechadoEm`) e o bloco PAGO (`pagoEm`). A saída é **Reabrir** (fatura) ou
                    **Reabrir paciente** / **Estornar pagamento** (bloco), que já existem,
                    gravam REABERTA e deixam rastro na auditoria.
                    ⚠️ O enforcement é do SERVIDOR: guarda única `bloqueioDeEscritaNaFatura`
                    (→ `FATURA_PAGA` / `FATURA_NAO_EDITAVEL`) e `bloqueioDoBlocoDoPaciente`
                    (→ `BLOCO_PACIENTE_PAGO` / `BLOCO_PACIENTE_FECHADO`) em `adicionarItem`,
                    `atualizarItem` e `removerItem`, mais `OrcamentoController.lancarNaFatura`,
                    que é a OUTRA porta de entrada de item. Até aqui a regra vivia só no
                    `canEdit` da tela, e um `PUT /itens/:id` passava na fatura fechada.
                    ⚠️ Nenhuma cobrança automática é perdida: o lançamento clínico entra por
                    `getOrCreateFatura`, que só devolve fatura em aberto (ou cria uma).
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
                    🔴 **FORMAS DE RECEBIMENTO DA FATURA** (`formasRecebimentoFatura`,
                    coluna `formas_recebimento_fatura`, migration 20261017000000): CSV de
                    EMAIL|WHATSAPP|IMPRESSO — como o cliente quer receber a fatura NESTA
                    empresa; pode ser mais de uma. É o que a tela de Faturamento HABILITA
                    para ele: o canal não escolhido fica CINZA (§6), com o motivo no
                    `title`, no painel da fatura E no fechamento em lote.
                    ⚠️ **NULL/vazio = TODAS as formas** — é o estado de toda a base
                    anterior à coluna (a migration não tem backfill de propósito) e o que
                    preserva o comportamento atual. Trocar esse default por "nenhuma"
                    apagaria os botões de envio da base inteira, sem erro e sem log.
                    ⚠️ Lista VAZIA no payload é outra coisa: é escolha inválida → 400.
                    ⚠️ Exportar CSV NÃO é forma de recebimento (baixa arquivo para a
                    clínica) e NUNCA é bloqueado por preferência de cliente.
                    LEITURA/ESCRITA: SEMPRE por `lib/formasRecebimentoFatura.js` (SQL cru
                    com guarda de coluna, padrão de `lib/animalFei.js`). A coluna NÃO entra
                    em `CAMPOS_PERFIL` de `lib/proprietarioPerfil.js` — aquele monta o
                    `select` TIPADO, e no Windows um client defasado derrubaria o cadastro
                    de cliente inteiro. Gravar é `UPDATE`, então vai SEMPRE **depois** do
                    `salvarPerfil`. Gate: `__tests__/formasRecebimentoFatura.test.js`.
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
                    🔴 dispensarExecucaoPrescricao (migration 20261023000000, DEFAULT false): a
                    clínica NÃO usa a Execução de Prescrição — fatura, baixa de estoque, recibo e
                    conta a pagar do prestador/fornecedor nascem na FINALIZAÇÃO (prescrição e
                    vacina), pelo curso inteiro, e o documento já nasce EXECUTADO. Só antecipa o
                    que a CLÍNICA aplica (a matriz "quem FORNECE × quem APLICA" não muda).
                    ⚠️ DOIS pontos de entrada, e os dois precisam dela: o `finalizar` de cada
                    controller E a cascata da finalização do atendimento
                    (`lib/finalizacaoEvolucao.js`). Lida/gravada SEMPRE por
                    `lib/etapaExecucaoPrescricao.js`. Gate:
                    `__tests__/execucaoPrescricaoDispensada.test.js`.
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

#### LISTA COM CABEÇALHO FIXO — `JanelaLista` é FONTE ÚNICA (2026-09-22)
```
Cabeçalho     → FIXO no topo da janela, opaco, negrito, "Primeira maiúscula"
Dados         → rolam POR BAIXO dele, dentro da janela
```
O rótulo da coluna é padronizado no próprio `JanelaLista`
(`[&_thead_th]:bg-gray-50 font-bold normal-case tracking-normal text-gray-700
text-xs`), então tela que usa a janela já nasce certa — não repita o estilo no `th`.
⚠️ **`sticky` SEM `background` é transparente** e as linhas rolam POR TRÁS do
rótulo: era o que fazia o cabeçalho parecer embaralhado com os dados. O fundo é o
que o separa do card que rola.
⚠️ A borda inferior vai por `shadow-[inset_0_-1px_0_…]`, nunca `border`: borda em
célula `sticky` não acompanha a célula quando ela descola da tabela.
⚠️ **Não dá para trocar a janela por `sticky` na página**: o card da lista é
`overflow-hidden`, e ancestral com overflow vira o contexto de rolagem — o elemento
nunca gruda. É a janela que cria o scroll em que o cabeçalho se ancora.
⚠️ `normal-case` no seletor da janela VENCE o `uppercase` escrito no `th` (seletor
descendente tem especificidade maior), então converter uma tela não exige limpar as
classes antigas.

#### SELETOR DE PACIENTE — A TELA ABRE EM MODO BUSCA (2026-09-22)
```
Atendimento · Vacina · Resultado de Exame · Dieta · Relatório Nutricional
  → abrem SEM paciente escolhido, com o seletor em "Buscar animal…"
```
Nenhuma dessas telas herda o `selectedAnimal` do contexto nem auto-seleciona o primeiro
da lista. O paciente vem da URL ou da **memória DO MÓDULO** (2026-09-25).
🔴 **ESCOLHIDO, O PACIENTE FICA DENTRO DO MÓDULO — E SÓ NELE.** `hooks/usePacienteDoModulo.ts`
guarda um paciente por módulo (sessionStorage): `atendimento` (Agenda, Evolução, Prescrição,
Exames, Encaminhamento) · `vacina` · `exames` (Laboratorial e Imagem) · `nutricional` (Plano
de Dieta **e** Relatório — compartilham). Escolher o Thor no Atendimento o mantém ao trocar
de aba; ir ao Nutricional abre em busca.
⚠️ Sem a memória o paciente se PERDIA dentro do módulo: a aba Agenda e o menu lateral
navegam SEM id. ⚠️ Escolha sem navegar (paciente clicado na aba Agenda) chama `lembrar`.
⚠️ GET 403 no paciente lembrado → `esquecer` (volta à busca). Login, logout e troca de
empresa limpam todos. Gate: `__tests__/pacientePorModulo.test.js`.
⚠️ **Não reintroduzir auto-seleção.** O argumento antigo ("a tela fica utilizável logo
após o login") custava abrir o prontuário de alguém que ninguém pediu — e, numa tela de
ESCRITA CLÍNICA, o paciente errado na tela é o começo do registro no paciente errado.
Duas delas ainda NAVEGAVAM com `replace: true`, apagando a rota de origem.
⚠️ O estado vazio é `components/PainelSemPaciente.tsx`, **abaixo do cabeçalho e do
seletor** — nunca um `return` antes deles. Ele separa três estados que não podem ser
colapsados: *carregando* · *a base não tem paciente* · *há pacientes, falta escolher*.
Era o colapso do terceiro no segundo que fazia a tela afirmar "Você ainda não possui
animais sob sua responsabilidade" com a base cheia, e sem o seletor não havia como
escolher — o estado padrão virava um beco sem saída.
⚠️ `SeletorAnimal` (o invólucro que navega e escreve no `SelectedAnimalContext`) **não
escreve rótulo**: o `<label>Paciente</label>` é do `SeletorAnimalInteligente`, e os dois
juntos imprimiam "Paciente" DUAS VEZES nas três telas nutricionais.
⚠️ `SeletorAnimal` também não esconde mais o campo quando há um paciente só — com a tela
abrindo vazia, isso deixava a clínica de um paciente sem nenhuma forma de escolher. Quem
decide "não há o que escolher" é o `semEscolha` do combobox.
🔴 **O MENU LATERAL TAMBÉM NÃO CARREGA PACIENTE NA URL** (2026-09-23). As telas
cumpriam a regra e o `Sidebar` a desfazia: ele montava o destino como
`animalId ? `/dieta/${animalId}` : '/dieta'`, com `animalId = selectedAnimal?.id`, e a
tela recebia PELA URL exatamente o paciente que a regra mandava não herdar. Valia para
os QUATRO itens — Plano de Dieta, Relatório Nutricional, Vacina e Resultado de Exame
(Atendimento já apontava para `/clinica/agenda`, sem id).
⚠️ **Não reintroduzir `selectedAnimal?.id` nos destinos do menu.** Para ir a um
paciente, o caminho é o SELETOR da própria tela, que navega e escreve no
`SelectedAnimalContext`. Quebra em SILÊNCIO: nada falha, a tela só abre preenchida com
cara de conveniência. Gate: `__tests__/menuSemPacienteHerdado.test.js`.

#### SELETOR ABRE SEMPRE PARA BAIXO (2026-09-22)
Nenhum combo do sistema decide a direção medindo o espaço na tela. Com pouco
espaço embaixo, o que encolhe é a **altura** (`maxHeight` pelo espaço disponível,
piso de 120px e rolagem interna) — **nunca a direção**.
⚠️ O flip existia em três lugares (`SeletoresCatalogo`, `CamposForm` e o
`DropdownAbaixo` do `Faturamento`, este ancorado por `bottom` de propósito desde
2026-09-08) e foi removido dos três. O preço do flip era a lista cobrir o campo que
se estava preenchendo e a direção mudar conforme a rolagem.
⚠️ `PosicaoFlutuante` não tem mais o campo `bottom` — é o que impede o flip voltar
por descuido: sem ele não há como ancorar pela borda de baixo.
⚠️ **`<select>` nativo fica de fora**: a direção dele é do navegador/SO. Tela que
precise garantir a direção usa um combo próprio, não o `<select>`.

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
- Inativar sem `motivo` e sem `registrarAuditoria` — ver §13, armadilha 33
- Abrir seletor para CIMA (flip por espaço disponível) — ver §6
- Auto-selecionar paciente numa tela clínica/nutricional — ela abre em modo BUSCA, ver §6
- Deixar arquivos residuais (App copy.tsx, test-*.js, etc)
- Hardcodar URLs, portas ou credenciais (sempre env vars)

### SEMPRE fazer
- `PageContainer` como wrapper de toda página interna
- Mobile-first: cards mobile → tabela desktop
- `ModalJustificativa` em toda ação destrutiva E em toda inativação (nunca confirm simples)
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

# 🔴 APLICAR MIGRATION EXIGE O USUÁRIO DONO — não o da aplicação.
# `DATABASE_URL` é o usuário da APP e NÃO é dono das tabelas: `prisma migrate deploy`
# com ele morre em `P3018 / 42501 must be owner of table <x>`, e ainda deixa a
# migration marcada como FAILED (nenhuma outra aplica até destravar).
DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
# Destravar depois de um P3018 (a migration não chegou a aplicar nada):
#   DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate resolve --rolled-back <nome>
# e então repetir o deploy acima.

npx prisma migrate deploy              # SÓ com DATABASE_URL de dono (ver acima); sem shadow DB — usar após P3006
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

> ⚠️ As 71 sessões de trabalho que ficavam AQUI foram movidas para `.claude/rules/hist-*.md`
> (ver o MAPA DO HISTÓRICO no topo deste arquivo). Abaixo fica só o backlog do projeto.

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
      **Fatura fechada vs paga:** 🔴 **REVISADO em 2026-09-23** — `FECHADA` NÃO aceita mais edição
      nem lançamento de item; só `ABERTA`/`REABERTA` aceitam (`faturaEditavel`). O texto original
      dizia o contrário e vale como história: até aqui a recusa era só da PAGA, e quem escondia os
      botões na fechada era a TELA. Ver a linha `FaturaItem.fechadoEm` na §5 para a regra vigente e
      os códigos de erro. Itens de origem clínica (exame/vacina/encaminhamento/prescrição) nunca
      caem numa fatura fechada por construção: `getOrCreateFatura` só busca fatura em aberto —
      se a do mês já fechou, cria uma nova automaticamente.
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
| `PainelSemPaciente.tsx` | O que a tela mostra ENQUANTO nenhum paciente foi escolhido — abaixo do cabeçalho e do seletor, nunca no lugar deles. Props: `icone` (LucideIcon do módulo), `carregando`, `vazio`, `acao`. Separa os três estados (*carregando* · *a base não tem paciente* · *há pacientes, falta escolher*) que a mensagem antiga colapsava num só. Usado por Atendimento, Vacina, Resultado de Exame, Dieta e Relatório Nutricional. Ver §6 |
| `SeletorPrestadorExecutante.tsx` | **"Quem executou" — o campo que liga um serviço ao PAGAMENTO AO PRESTADOR** (ledger do recibo + conta a pagar do mês). Em branco = serviço da própria equipe, e NUNCA é obrigatório. Traz junto o aviso de prestador sem forma de pagamento, que é o que evita a dívida aparecer zerada em Pagamentos sem explicação. `prestadores` é opcional: informado, o chamador já tem a lista (é o caso da Execução de Prescrição, que a busca UMA vez para o plantão inteiro); omitido, o componente busca a sua. Usado pelos dois modais de resultado de exame e por `ExecucaoPrescricao` |
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
    🔴 **INATIVAR ENTROU NA MESMA REGRA (2026-09-22)**: todo `toggle`/`inativar` de
    cadastro exige `motivo` (400 sem ele) e grava `registrarAuditoria` com
    `categoria: vaiInativar ? 'INATIVACAO' : 'ATIVACAO'` — NUNCA `'ALTERACAO'`, que é
    o rótulo exibido na tela e o recorte dos Relatórios de Cadastro (com ALTERACAO a
    inativação existe no banco e some de "quem foi inativado"). ATIVAR segue SEM
    motivo, de propósito — reativar é correção, e pedir justificativa ali é só atrito;
    a exceção é `toggleMembro`, que pede nos dois sentidos porque devolver acesso é a
    decisão mais forte. Gate estrutural: `__tests__/inativacaoJustificada.test.js`
    (varre os 13 pontos de inativação; falha na ausência de qualquer parte). Entidade
    nova precisa de rótulo em `ENTIDADE_LABEL` (`AuditoriaGeral.tsx`), senão a coluna
    mostra o identificador cru.

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
    🔴 **VALE TAMBÉM PARA SCRIPT DE DIAGNÓSTICO, e mordeu de novo em 2026-09-18:** um
    script que carimbava FORA de `$transaction` concluiu "a base não tem nenhuma
    prescrição pendente" e **estava errado** — havia 6 grupos. O `true` é local à
    TRANSAÇÃO; fora dela cada query pega outra conexão do pool, chega sem carimbo e o
    FORCE RLS devolve **0 linhas, com sucesso e sem aviso**. Pior que erro: a consulta
    "funciona" e a conclusão é falsa. Toda leitura de tenant plane por script vai
    DENTRO de `prisma.$transaction(async tx => { await tx.$executeRawUnsafe(...set_config...); ... })`.
    Sintoma para reconhecer: tabela que você SABE que tem dado voltando vazia, enquanto
    `tb_empresas`/`users` (control plane, sem RLS) respondem normalmente.
    ⚠️ Migration JÁ APLICADA não se corrige editando o arquivo (o checksum registrado
    passa a divergir e o Prisma acusa "migration alterada depois de aplicada" em todo
    ambiente que já a tem): crie uma migration NOVA só com o backfill — foi o que
    `20260924000001_cadeia_responsaveis_backfill` faz.
    ⚠️ CONFERIR o resultado tem o mesmo problema: um `count(*)` pelo client comum
    devolve 0 por RLS, não por tabela vazia. Compare com `pg_class.reltuples` ou consulte
    dentro de uma transação com o mesmo `set_config`.

43. 🔴 **"FOI EXECUTADA?" É PERGUNTA DE DOSE, NÃO DE DOCUMENTO (2026-09-22).**
    Desde a migration `20260820_prescricao_execucao_dose` a execução de prescrição é
    POR DOSE, e a única fonte de "esta dose aconteceu" é o log append-only
    `tb_prescricao_execucoes_dose`. `Prescricao.executadoEm` MUDOU DE SENTIDO ali:
    guarda a ÚLTIMA dose, não "o item foi executado" — quem o lê como booleano dá
    por encerrado um "12 em 12h" com metade das aplicações por fazer.
    O Mapa de Atendimento fazia isso: contava GRUPOS (um curso de 15 doses valia 1,
    igual a uma dose única) e decidia por `executadoEm`. Tela nova que exiba execução
    de prescrição conta doses por **`lib/dosesDoPeriodo.js`** — que, por sua vez, só
    faz aritmética de `lib/agendaDoses.js`, a fonte única do plantão e do cron.
    ⚠️ **`horaInicio` NÃO serve para decidir atraso.** Deixou de ser obrigatório em
    2026-08-23 e na base está VAZIO em todo item; quem depende dele nunca classifica
    nada como atrasado (era o caso do Mapa) — e quem trata a meia-noite do item sem
    hora como "previsto" faz a dose nascer atrasada às 00:01. Quem responde é
    `horarioPrevistoDoItem`, que devolve `null` de propósito nesse estado.
    ⚠️ **NUNCA exigir `evolucao.status = 'FINALIZADA'` para a prescrição aparecer.**
    A premissa mudou em 2026-07-16 — a prescrição vai ao plantão quando o GRUPO é
    FINALIZADO. O Mapa manteve a regra antiga e escondia toda prescrição de
    atendimento EM_ANDAMENTO, que é o estado normal de quem está atendendo agora:
    numa base real, uma clínica inteira ficava com o painel zerado por isso.
    ⚠️ Item `aplicadaPeloProprietario` e frequência `seNecessario`/`SOS` ficam FORA
    da conta — não chegam ao plantão, e contá-los cobra trabalho que ninguém deixou
    de fazer. Gate: `__tests__/dosesDoPeriodo.test.js` (verificado que reprova).


44. 🔴 **O PLANTÃO NÃO SEGUE O EXPEDIENTE DA EMPRESA (2026-09-22).**
    A fila da **Execução de Prescrição** (`listarParaExecucao`) pede o escopo com
    `buildAnimalScopeWhere(req, { ignorarDiaDeTrabalho: true })`: a opção "Atender
    somente no local de trabalho" (`MembroEquipe.restringirPorLocal`, e o flag irmão
    em `tb_prestadores`) segue recortando por **LOCAL** e deixa de olhar o **DIA DA
    SEMANA**. Tratamento corre 24/7 — um "8 em 8h por 5 dias" atravessa o fim de
    semana, e a dose não espera a clínica abrir.
    POR QUÊ: os dias do local são validados contra o expediente da empresa
    (`validarLocaisContraExpedienteEmpresa`), então numa clínica seg–sex ninguém pode
    ser cadastrado para sábado; com o filtro por dia, `localizacaoId: { in: [] }`
    deixava o plantão do fim de semana **VAZIO**, e as doses daquele dia eram depois
    canceladas pelo cron `cancelar_doses_prescricao_perdidas` — **sem erro em tela e
    sem log**. Quem estava de plantão lia "nada a aplicar hoje".
    ⚠️ **Não afrouxa o LOCAL**: quem atende só no Haras A segue sem ver o paciente do
    Haras B. A restrição é de ONDE; o DIA não decide se uma dose já prescrita pode ser
    aplicada.
    ⚠️ A opção mora em `lib/animalScope.js` e vale para as DUAS restrições (membro e
    prestador) de uma vez — aplicar só numa deixaria o PRESTADOR de plantão sem fila.
    ⚠️ **Nenhuma outra tela passa a opção.** Na lista de Pacientes o recorte por dia é
    o próprio sentido da configuração; há gate reprovando `ignorarDiaDeTrabalho` em
    `AnimalController`.
    ⚠️ Lista vazia continua sendo "restrição ligada e nenhum local cadastrado" →
    nenhum paciente; colapsá-la em "sem restrição" daria a base inteira.
    Gate: `__tests__/plantaoSemExpediente.test.js` (verificado que reprova).

45. 🔴 **QUEM CONCLUI O EXAME É `salvarResultado`, NUNCA `finalizar` (2026-09-22).**
    `PATCH /clinica/exames/:id/finalizar` (status CONCLUIDO) **não é chamada por tela
    nenhuma** — a conclusão de verdade é `PATCH /clinica/exames/:id/resultado`
    (`salvarResultado`, status REALIZADO), que é o que os modais de resultado usam.
    Foi assim que o recibo do prestador do exame (escrito em 2026-09-09) ficou TRÊS
    semanas como código morto: existia, estava correto, e nunca executava.
    ⚠️ Efeito novo que dependa da conclusão do exame vai em `salvarResultado` — nos
    **DOIS** ramos (Imagem e Laboratorial/Bioquímico, que têm transactions separadas) —
    e em `criarNaoPedido` (exame avulso já nasce REALIZADO). Pôr só em `finalizar` é
    escrever código que nunca roda.
    ⚠️ `salvarResultado` é **REENVIÁVEL** (recarregar o laudo porque a IA falhou,
    corrigir a tabela digitada): todo efeito colateral ali precisa ser IDEMPOTENTE. Sem
    isso, cada reenvio soma outra dívida/cobrança, em silêncio. O pagamento ao prestador
    se protege pelo índice único parcial de
    `tb_execucoes_procedimento_prestador.exame_clinico_id` (migration `20261019000000`)
    e pelo par (`EXAME_PRESTADOR`, id do exame) em `tb_conta_pagar_itens`.
    ⚠️ **Origem de conta a pagar NOVA exige constante NOVA em `contasPagar.ORIGENS`.**
    O par (`origemTipo`, `origemId`) é a chave de idempotência: reusar
    `EXECUCAO_PRESTADOR` para o exame faria o exame 47 colidir com o item de prescrição
    47 e a segunda dívida sumir no `ON CONFLICT DO NOTHING`. Rótulo novo também em
    `ORIGEM_LABEL` (`Pagamentos.tsx`), senão a tela mostra a constante crua.
    Gate: `__tests__/exameImagemProcedimento.test.js` (verificado que reprova).
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
