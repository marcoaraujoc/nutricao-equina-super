# S2Vet — Developer Handbook

> **Versão:** 1.0 — baseada na análise do código-fonte real (maio/2026)  
> **Escopo:** Módulo Nutricional Equino — projeto `nutricao-equina-super`

---

## 1. Visão Geral do Projeto

O S2Vet é uma plataforma hospitalar veterinária modular. O repositório atual implementa o **módulo nutricional equino**, composto por dois projetos independentes:

| Projeto | Diretório | Tecnologia principal |
|---|---|---|
| Frontend | `/frontend` | React 18 + TypeScript + Vite |
| Backend | `/backend` | Node.js + Express + Prisma (MySQL) |

---

## 2. Stack Real do Projeto

### 2.1 Frontend

| Pacote | Versão | Uso |
|---|---|---|
| `react` | 18.3.1 | UI framework |
| `react-dom` | 18.3.1 | Renderização DOM |
| `react-router-dom` | 7.x | Roteamento SPA |
| `axios` | 1.x | Client HTTP (instância centralizada em `src/services/api.ts`) |
| `chart.js` + `react-chartjs-2` | 4.x / 5.x | Gráficos (Dashboard, Análise) |
| `lucide-react` | 1.x | Ícones |
| `react-hot-toast` | 2.x | Feedback / toasts |
| `jwt-decode` | 4.x | Decode de token JWT no client |
| `@react-oauth/google` | 0.13.x | Login social Google |
| `tailwindcss` | 3.4.x | Estilização utilitária |
| `vite` | 6.x | Bundler + dev server |
| `typescript` | 6.x | Tipagem estática |

**Não estão instalados e não devem ser assumidos como disponíveis:**  
`shadcn/ui`, `TanStack Query`, `React Hook Form`, `Zod`, `react-i18next`

---

### 2.2 Backend

| Pacote | Versão | Uso |
|---|---|---|
| `express` | 4.18.x | HTTP server |
| `@prisma/client` | 5.22.0 | ORM — acesso ao banco |
| `prisma` | 5.22.0 | CLI de migrations e geração |
| `bcryptjs` | 3.x | Hash de senhas |
| `jsonwebtoken` | 9.x | Geração e verificação de JWT |
| `cors` | 2.x | CORS middleware |
| `dotenv` | 16.x | Variáveis de ambiente |
| `multer` | 2.x | Upload de arquivos (fotos de animais, laudos PDF) |
| `nodemailer` | 8.x | Envio de e-mail (reset de senha) |
| `pdf-parse` | 1.x | Extração de texto de laudos PDF |
| `tesseract.js` | 7.x | OCR em imagens de laudos |
| `sharp` | 0.34.x | Pré-processamento de imagens para OCR |
| `groq-sdk` | 1.x | SDK Groq (instalado; chamadas feitas via `fetch` direto) |
| `ollama` | 0.6.x | SDK Ollama (instalado; integração local) |
| `csv-parser` | 3.x | Leitura de CSVs nos scripts de importação |
| `axios` | 1.x | HTTP client (uso interno em serviços) |
| `nodemon` | 3.x | Hot reload em dev |

**Linguagem do backend:** JavaScript puro (CommonJS — `require/module.exports`). Arquivos `.ts` existentes na árvore são **órfãos** e devem ser ignorados ou removidos.

**Banco de dados:** MySQL (provider Prisma: `mysql`). **Não é PostgreSQL.**

---

## 3. Estrutura de Diretórios

### 3.1 Frontend

```
frontend/
├── index.html
├── vite.config.ts           # dev server + proxy para /api e /uploads
├── tailwind.config.js
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── postcss.config.js
├── public/
└── src/
    ├── main.tsx             # entrypoint React
    ├── App.tsx              # roteamento global
    ├── index.css            # estilos globais Tailwind
    ├── assets/
    │   └── hero.png
    ├── components/
    │   ├── ErrorBoundary.tsx
    │   ├── ProtectedRoute.tsx
    │   └── Sidebar.tsx
    ├── contexts/
    │   ├── AuthContext.tsx       # autenticação JWT + auditoria
    │   └── SelectedAnimalContext.tsx
    ├── pages/
    │   ├── Login.tsx
    │   ├── Register.tsx
    │   ├── ResetPassword.tsx
    │   ├── Dashboard.tsx
    │   ├── MeusAnimais.tsx
    │   ├── Animal.tsx           # CRUD animal (criar/editar)
    │   ├── AnimalDetail.tsx     # visualização detalhada
    │   ├── Alimentos.tsx        # listagem
    │   ├── criaAlimentos.tsx    # CRUD alimento
    │   ├── Nutrientes.tsx
    │   ├── CriaNutrientes.tsx
    │   ├── ComposicaoAlimentar.tsx
    │   ├── CriaComposicaoAlimentar.tsx
    │   ├── Dieta.tsx
    │   ├── CriaDieta.tsx
    │   ├── Exames.tsx
    │   ├── CriaExameNutricional.tsx
    │   ├── RelatorioNutricional.tsx
    │   ├── CadastroPessoal.tsx
    │   ├── Analise.tsx          # rota temporária
    │   └── query-adhoc.tsx      # rota temporária de debug
    └── services/
        ├── api.ts                          # instância axios configurada
        └── relatorioNutricional.service.ts # client do relatório
```

**Arquivos a remover (lixo identificado):**

| Arquivo | Motivo |
|---|---|
| `src/App copy.tsx` | Cópia duplicada |
| `src/contexts/AuthContext copy.tsx` | Cópia duplicada |
| `src/pages/CadastroPessoal copy.tsx` | Cópia duplicada |
| `src/pages/AnimalView.tsx` | Não roteado em App.tsx |
| `src/pages/Auditoria.tsx` | Não roteado em App.tsx |
| `src/pages/ForgotPassword.tsx` | Funcionalidade embutida em Login.tsx |
| `src/assets/react.svg` | Asset padrão do template Vite |
| `src/assets/vite.svg` | Asset padrão do template Vite |
| `src/App.css` | CSS residual do template Vite |

---

### 3.2 Backend

```
backend/
├── package.json
├── Dockerfile
├── seed.js                      # seed de dados iniciais
├── prismaClient.ts              # ÓRFÃO — não usado (ignorar)
├── test-relatorio.js            # script de teste manual (não é produção)
├── uploads/                     # arquivos de foto e laudos (multer)
├── prisma/
│   └── schema.prisma
├── scripts/                     # scripts de importação de dados CSV
│   ├── import-alimento.js
│   ├── import-composicao-alimento.js
│   ├── import-nutriente.js
│   ├── import-exigenciasNRC.js
│   └── [outros scripts de importação]
└── src/
    ├── server.js                # entrypoint Express
    ├── middlewares/
    │   └── auth.js              # authenticate + authorize
    ├── routes/
    │   ├── auth.js
    │   ├── animais.js
    │   ├── alimentos.js
    │   ├── nutrientes.js
    │   ├── composicaoAlimentar.js
    │   ├── dietas.js
    │   ├── exames.js
    │   ├── analise.js
    │   ├── audit.js
    │   ├── especies.js
    │   ├── racas.js
    │   ├── user.js
    │   ├── relatorio.routes.js  # rota ativa de relatório
    │   ├── query.js             # temporária (debug)
    │   └── teste.js             # temporária (debug)
    ├── controllers/
    │   ├── auth/
    │   │   └── UserController.js    # login + register ativos
    │   ├── AuthController.js        # forgotPassword + resetPassword
    │   ├── GoogleController.js      # OAuth Google
    │   ├── AnimalController.js
    │   ├── AlimentoController.js
    │   ├── NutrientesController.js
    │   ├── ComposicaoAlimentarController.js
    │   ├── DietaController.js
    │   ├── ExameController.js
    │   ├── AnaliseController.js
    │   ├── AuditController.js
    │   ├── EspecieController.js
    │   ├── RacaController.js
    │   ├── UserController.js
    │   └── relatorio.controller.js  # controller ativo de relatório
    └── services/
        ├── relatorioNutricional.service.js  # lógica de geração do relatório + pivot SQL
        ├── exameParserService.js            # parse de laudos PDF via Groq
        └── composicaoParserService.js       # parse de composições
```

**Arquivos a remover (lixo identificado):**

| Arquivo | Motivo |
|---|---|
| `src/routes/animais copy.js` | Cópia duplicada |
| `src/controllers/AuthController copy.js` | Cópia duplicada |
| `src/controllers/AnimalController.ts` | Arquivo TypeScript órfão em projeto JS |
| `src/routes/animais.ts` | Arquivo TypeScript órfão em projeto JS |
| `src/controllers/relatorio.controller.ts` | Arquivo TypeScript órfão em projeto JS |
| `src/routes/dieta_lixo.js` | Explicitamente marcado como lixo |
| `src/routes/relatorio.js` | Stub de teste substituído por `relatorio.routes.js` |
| `src/controllers/UserController.js` (raiz) | Substituído por `auth/UserController.js` |
| `prismaClient.ts` | Órfão TS; Prisma é instanciado inline nos controllers |
| `test-relatorio.js` (raiz) | Script de teste manual, não é produção |
| `src/test-nutricao.js` | Script de teste manual, não é produção |
| `src/routes/produtos.js` | Não montado em server.js |
| `src/controllers/ProdutoController.js` | Sem rota ativa |

---

## 4. Banco de Dados

**Provider:** MySQL  
**ORM:** Prisma 5.22

### 4.1 Modelos ativos

| Model | Tabela | Descrição |
|---|---|---|
| `User` | `users` | Usuários do sistema (veterinários, proprietários, admins) |
| `Animal` | `tb_animais` | Cadastro de animais |
| `Especie` | `tb_especies` | Espécies (Equino, Bovino…) |
| `Raca` | `tb_racas` | Raças por espécie |
| `Alimento` | `tb_alimentos` | Alimentos cadastrados |
| `Nutriente` | `tb_nutrientes` | Nutrientes cadastrados |
| `ComposicaoAlimento` | `tb_composicao_alimento` | Composição nutricional por kg de alimento |
| `Dieta` | `tb_dieta` | Itens da dieta de um animal |
| `ExameNutricional` | `tb_exames_nutricionais` | Resultados de exames laboratoriais |
| `OcorrenciaSaude` | `tb_ocorrencias_saude` | Ocorrências de saúde |
| `AuditLog` | `tb_audit_logs` | Registro de login/logout |
| `ExigenciasNRC` | `tb_exigencias_nrc` | Tabela NRC: exigência nutricional por peso/exercício |

### 4.2 Comandos Prisma

```bash
# Gerar cliente após alterar schema
npx prisma generate

# Criar e aplicar migration
npx prisma migrate dev --name descricao_da_mudanca

# Aplicar migrations em produção
npx prisma migrate deploy

# Abrir Prisma Studio
npx prisma studio

# Rodar seed
node seed.js
```

### 4.3 Variável de ambiente obrigatória

```env
DATABASE_URL="mysql://usuario:senha@host:3306/nome_do_banco"
```

---

## 5. Autenticação

### 5.1 Fluxo

1. Client faz `POST /api/auth/login` → recebe `token` (JWT)
2. Token é armazenado em `localStorage` (chave `token`)
3. `api.ts` injeta o token automaticamente via interceptor `Authorization: Bearer`
4. Backend valida via middleware `authenticate` em `src/middlewares/auth.js`
5. Expiração de 401 → `api.ts` limpa o storage e redireciona para `/login`

### 5.2 RBAC

Roles disponíveis: `USER`, `ADMIN`  
O middleware `authorize(...roles)` valida o campo `role` do payload JWT.

### 5.3 Variáveis de ambiente

```env
JWT_SECRET=sua-chave-secreta-aqui
EMAIL_USER=seu@email.com
EMAIL_PASS=senha-do-email
```

> ⚠️ O arquivo `src/middlewares/auth.js` possui o secret hardcoded como fallback. **Em produção, sempre setar `JWT_SECRET` via variável de ambiente.**

---

## 6. Integração com IA

### 6.1 Groq (LLM em nuvem)

Utilizado em `exameParserService.js` para interpretar laudos PDF em linguagem natural.

- O texto do laudo é extraído via `pdf-parse` (e `tesseract.js` para imagens)
- Um prompt estruturado é enviado para a API Groq
- A resposta é JSON com os nutrientes e valores extraídos

**Variável necessária:**
```env
GROQ_API_KEY=sua-chave-groq
```

### 6.2 Ollama (LLM local)

Pacote `ollama` instalado para inferência local. Integração disponível para execução sem custo por token.

### 6.3 RelatorioNutricional + LLM

O `relatorioNutricional.service.js` executa uma query pivot no MySQL calculando:
- Consumo real de nutrientes pela dieta
- Exigência NRC por peso e tipo de exercício
- Saldo e status nutricional (`DEFICIÊNCIA CRÍTICA`, `DEFICIÊNCIA`, `ADEQUADO`, `EXCESSO`, `EXCESSO ALTO`)

Esses dados estruturados são preparados para serem consumidos por um LLM que gera a análise clínica final.

---

## 7. Configuração do Ambiente de Desenvolvimento

### 7.1 Pré-requisitos

- Node.js 20+
- MySQL 8+ rodando localmente ou via Docker
- Git

### 7.2 Setup inicial

```bash
# 1. Frontend
cd frontend
npm install
cp .env.example .env   # se existir
npm run dev            # http://localhost:5173

# 2. Backend
cd backend
npm install
cp .env.example .env   # configurar DATABASE_URL, JWT_SECRET etc.
npx prisma generate
npx prisma migrate deploy
node seed.js           # opcional: dados iniciais
npm run dev            # http://localhost:3001
```

### 7.3 Proxy de desenvolvimento

O Vite já está configurado para fazer proxy das chamadas `/api` e `/uploads` para `http://localhost:3001`. O frontend nunca precisa referenciar a porta do backend diretamente.

```ts
// vite.config.ts — já configurado
proxy: {
  '/api':     { target: 'http://localhost:3001', changeOrigin: true },
  '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
}
```

---

## 8. Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register` | Registro |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/forgot-password` | Recuperação de senha |
| POST | `/api/auth/reset-password` | Reset de senha |
| POST | `/api/auth/google` | Login Google OAuth |
| GET/POST/PUT/DELETE | `/api/animais` | CRUD animais |
| GET/POST/PUT/DELETE | `/api/alimentos` | CRUD alimentos |
| GET/POST/PUT/DELETE | `/api/nutrientes` | CRUD nutrientes |
| GET/POST/PUT/DELETE | `/api/composicoes-alimentares` | CRUD composição alimentar |
| GET/POST/PUT/DELETE | `/api/dietas` | CRUD dieta |
| GET/POST/PUT/DELETE | `/api/exames` | CRUD exames nutricionais |
| GET | `/api/relatorio/animal/:animalId` | Relatório nutricional |
| GET | `/api/especies` | Listagem de espécies |
| GET | `/api/racas` | Listagem de raças |
| GET | `/api/users` | Gerenciamento de usuários |
| POST | `/api/audit/log` | Registro de auditoria |
| GET | `/analise/:animalId` | Análise de balanço nutricional |
| GET | `/health` | Health check |

**Rotas temporárias (debug — não usar em feature development):**
- `GET /teste/*`
- `GET /api/query`

---

## 9. Upload de Arquivos

Upload gerenciado pelo `multer`. Arquivos salvos em `backend/uploads/`.

Servidos estaticamente via Express:
```
GET /uploads/nome-do-arquivo.jpg
```

Acessível no frontend via proxy Vite sem configuração adicional.

---

## 10. Scripts de Importação de Dados

Localizados em `backend/scripts/`. Utilizados para carga inicial de:

| Script | Dados |
|---|---|
| `import-alimento.js` | `Alimento.csv` |
| `import-composicao-alimento.js` | `ComposicaoAlimentar.csv` |
| `import-nutriente.js` | `Nutriente.csv` |
| `import-exigenciasNRC.js` | `Exigencias_NRC.csv` |
| `import-dieta.js` | `Dieta.csv` |

```bash
cd backend
node scripts/import-nutriente.js
node scripts/import-alimento.js
node scripts/import-composicao-alimento.js
node scripts/import-exigenciasNRC.js
```

---

## 11. Docker

O projeto possui `Dockerfile` no backend. Para ambiente completo com banco, recomenda-se Docker Compose com os serviços `backend` e `mysql`.

Variáveis de ambiente devem ser injetadas via `.env` ou secrets do orchestrador — nunca hardcoded na imagem.

---

## 12. Health Check

```
GET /health
→ { "status": "online", "timestamp": "..." }
```

Utilizado por load balancers e orquestradores para verificar disponibilidade do serviço.
