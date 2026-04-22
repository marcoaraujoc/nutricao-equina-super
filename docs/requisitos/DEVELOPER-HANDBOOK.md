# DEVELOPER HANDBOOK - Nutricao Equina Super

**Versão:** 1.0 (MVP - feature/mvp-v1.0)  
**Data:** 19 de abril de 2026  
**Branch atual de desenvolvimento:** `feature/mvp-v1.0`

---

## 1. Visão Geral do Projeto

**Nome:** Nutricao Equina Super  
**Objetivo:** Sistema completo para gerenciamento de nutrição de cavalos de hipismo, baseado na planilha “alimentação Super.xlsx”.  
**Domínio:** Nutrição equina (cálculo de balanço nutricional, exigências NRC, dieta diária, exames laboratoriais e análise inteligente).

**Principais funcionalidades já implementadas:**
- Autenticação completa com RBAC (ADMIN / USER)
- Tela de login no estilo Grok/X.ai (com botões X, Google, Apple e e-mail)
- Protected Routes e AuthContext no frontend
- Sidebar responsivo e navegação
- Backend com Express + Prisma + JWT

**Status atual:** MVP em construção (autenticação e base técnica 100% pronta).

---

## 2. Stack Tecnológica

| Camada          | Tecnologia                        | Versão / Observação                     |
|-----------------|-----------------------------------|-----------------------------------------|
| Backend         | Node.js + Express                 | v20                                     |
| ORM             | Prisma                            | v5.22.0                                 |
| Banco           | SQLite (desenvolvimento)          | Futuro PostgreSQL + Docker              |
| Autenticação    | JWT + bcrypt                      | RBAC implementado                       |
| Frontend        | React + Vite + TypeScript         | Vite + React 18                         |
| Estilização     | Tailwind CSS                      | v3                                      |
| Roteamento      | React Router DOM                  | v6                                      |
| Google Login    | @react-oauth/google               | Em integração (parcial)                 |

---

## 3. Estrutura do Projeto (Branch feature/mvp-v1.0)

nutricao-equina-super/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma                  ← Modelo completo do banco
│   │   └── migrations/                    ← Migrações do Prisma
│   ├── src/
│   │   ├── server.js                      ← Servidor Express (ponto de entrada)
│   │   ├── controllers/
│   │   │   └── auth/UserController.js     ← Cadastro e login de usuários
│   │   ├── routes/
│   │   │   └── auth.js                    ← Rotas de autenticação
│   │   └── middlewares/                   ← Auth middleware + RBAC
│   ├── .env                               ← Variáveis de ambiente
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                        ← Arquivo principal (roteamento, AuthContext, Sidebar, tela de login)
│   │   ├── main.tsx                       ← Ponto de entrada do React
│   │   └── index.css                      ← Estilos globais + Tailwind
│   ├── vite.config.ts                     ← Proxy para backend + configurações Vite
│   ├── tailwind.config.js
│   └── package.json
├── docs/                                  ← Documentação interna (este handbook)
├── .gitignore
├── README.md
└── LICENSE
text

## 4. Função de Cada Arquivo Principal

### Backend
- `backend/prisma/schema.prisma` → Definição de **todas** as tabelas do banco (User, Animal, Produto, Nutriente, Dieta, ExameNutricional, ComposicaoProduto, etc.)
- `backend/src/server.js` → Inicialização do Express, middlewares globais e montagem de rotas
- `backend/src/controllers/auth/UserController.js` → Lógica de register e login (bcrypt + JWT)
- `backend/src/routes/auth.js` → Rotas `/auth/register` e `/auth/login`

### Frontend
- `frontend/src/App.tsx` → **Coração da aplicação**:
  - AuthContext + Provider
  - ProtectedRoute
  - Sidebar com menu condicional
  - Tela de login (estilo Grok/X.ai)
  - Rotas protegidas (/dashboard, /cavalos, /dieta, /exames, /analise)
- `frontend/src/main.tsx` → Renderiza o App com GoogleOAuthProvider
- `frontend/vite.config.ts` → Configura proxy `/api` → backend (porta 3001)

---

## 5. Banco de Dados (Atual)

**Tipo atual:** SQLite (`file:./dev.db`)  
**Tipo futuro:** PostgreSQL (Cloud SQL no GCP)

**Models principais (schema.prisma):**
- User (RBAC)
- Animal (cavalos)
- Produto (alimentos, rações, suplementos)
- Nutriente
- ComposicaoProduto
- Dieta
- ExameNutricional
- OcorrenciaSaude

---

## 6. Autenticação e RBAC

- Token JWT armazenado em `localStorage`
- Roles: `ADMIN` e `USER`
- Middleware de autenticação no backend
- AuthContext + ProtectedRoute no frontend

---

## 7. Como Rodar o Projeto (Onboarding)

```bash
# Raiz do projeto
cd /workspaces/nutricao-equina-super

# Backend
cd backend && npm install && npx prisma migrate dev && npm run dev

# Frontend (em outro terminal)
cd frontend && npm install && npm run dev

## 8. Roadmap Técnico (MVP)
Fase 1 (Concluída)

Autenticação + RBAC
Tela de login moderna

Fase 2 (Próxima)

Tela de Cadastro de Cavalos (com foto)
Tela de Dieta Diária
Integração real Google OAuth

Fase 3

Dashboard com gráficos
Tela de Exames
Cálculo de balanço nutricional + LLM