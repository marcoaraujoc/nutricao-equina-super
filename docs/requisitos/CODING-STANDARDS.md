# CODING STANDARDS - Nutricao Equina Super

## 1. Princípios Gerais
- Código limpo, legível e bem comentado
- TypeScript obrigatório no frontend
- Consistência acima de tudo

## 2. Backend (Node.js + Express)

- Arquivos em CommonJS (`.js`)
- Nome de controllers: `NomeEntidadeController.js`
- Rotas em arquivos separados dentro de `src/routes/`
- Middlewares em `src/middlewares/`
- Sempre usar `async/await` + try/catch
- Logs claros com emojis para facilitar debug

## 3. Frontend (React + TypeScript)

- Componentes funcionais
- Hooks customizados quando necessário
- Nome de arquivos: PascalCase (`App.tsx`, `Cavalos.tsx`)
- Estilos exclusivamente com Tailwind (sem CSS inline desnecessário)
- Todo componente deve ter tipagem clara

## 4. Prisma / Banco

- Sempre usar `@map` para manter nomes das tabelas originais
- Campos obrigatórios com `?` apenas quando realmente opcional
- Migrations sempre com nome descritivo (`add_users_rbac`)

## 5. Commits e Branches

- Usar Conventional Commits:
  - `feat:` nova funcionalidade
  - `fix:` correção de bug
  - `refactor:` melhoria de código
  - `docs:` alteração na documentação
- Branchs: `feature/nome-da-funcionalidade` ou `fix/descricao`

## 6. Formatação

- Prettier configurado (padrão do projeto)
- ESLint ativo no frontend
- Sempre rodar `npm run dev` após alterações

---

**Este documento é obrigatório para novas contribuições.**