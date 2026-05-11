# S2Vet — Coding Standards

> **Versão:** 1.0 — baseada no código-fonte real (maio/2026)  
> **Escopo:** Módulo Nutricional Equino

---

## 1. Princípios Gerais

- **Clareza antes de esperteza.** Código que qualquer dev do time lê em 30 segundos é melhor que código "inteligente".
- **Consistência acima de preferência pessoal.** Siga os padrões existentes no arquivo onde você está trabalhando.
- **Não deixe lixo para trás.** Arquivos `copy`, `_lixo`, `teste` acumulam dívida técnica. Se criou para experimentar, apague antes do commit.
- **Nomes descritivos, sempre.** `handleSubmit` é aceitável. `fn2`, `temp`, `x` não são.

---

## 2. Padrões — Backend

### 2.1 Linguagem e módulos

O backend é **JavaScript puro (Node.js)** com sistema de módulos **CommonJS**.

```js
// ✅ Correto
const express = require('express');
const { PrismaClient } = require('@prisma/client');
module.exports = router;

// ❌ Errado — não usar ESModules ou TypeScript no backend atual
import express from 'express';
export default router;
```

**Não criar arquivos `.ts` no backend.** Os existentes são órfãos e estão marcados para remoção.

---

### 2.2 Estrutura de um Controller

Controllers devem ser **enxutos**: recebem request, delegam para service ou Prisma, retornam response. Sem lógica de negócio inline.

```js
// src/controllers/ExemploController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ExemploController = {

  listar: async (req, res) => {
    try {
      const itens = await prisma.exemplo.findMany({ where: { ativo: true } });
      res.json({ sucesso: true, dados: itens });
    } catch (error) {
      console.error('Erro ao listar exemplos:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  criar: async (req, res) => {
    const { nome, categoria } = req.body;

    if (!nome || !categoria) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome e categoria são obrigatórios' });
    }

    try {
      const item = await prisma.exemplo.create({ data: { nome, categoria } });
      res.status(201).json({ sucesso: true, dados: item });
    } catch (error) {
      console.error('Erro ao criar exemplo:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = ExemploController;
```

**Regras:**
- Um `try/catch` por método
- Sempre logar o erro com `console.error` antes de responder
- Validar campos obrigatórios **antes** de chamar o banco
- Resposta sempre no formato `{ sucesso: boolean, dados?: any, mensagem?: string }`

---

### 2.3 Estrutura de uma Route

```js
// src/routes/exemplos.js

const express = require('express');
const ExemploController = require('../controllers/ExemploController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/',         authenticate, ExemploController.listar);
router.get('/:id',     authenticate, ExemploController.obterPorId);
router.post('/',       authenticate, ExemploController.criar);
router.put('/:id',     authenticate, ExemploController.atualizar);
router.delete('/:id',  authenticate, ExemploController.excluir);

module.exports = router;
```

**Registrar a rota em `server.js`:**
```js
const exemplosRoutes = require('./routes/exemplos');
app.use('/api/exemplos', exemplosRoutes);
```

---

### 2.4 Middleware de autenticação

```js
// Proteger rota — requer token válido
router.get('/', authenticate, controller.listar);

// Proteger rota — requer role específico
router.delete('/:id', authenticate, authorize('ADMIN'), controller.excluir);
```

O middleware `authenticate` popula `req.user` com o payload do JWT:
```js
req.user = { id, email, fullName, role }
```

---

### 2.5 Formato de resposta da API

Usar sempre o mesmo envelope de resposta:

```js
// Sucesso com dados
res.json({ sucesso: true, dados: resultado });

// Sucesso sem dados (ex: delete)
res.json({ sucesso: true, mensagem: 'Removido com sucesso' });

// Erro de validação
res.status(400).json({ sucesso: false, mensagem: 'Campo X é obrigatório' });

// Erro interno
res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });

// Não encontrado
res.status(404).json({ sucesso: false, mensagem: 'Registro não encontrado' });
```

> ⚠️ Alguns controllers legados ainda usam `{ success, error, message }`. Ao fazer manutenção, padronize para `{ sucesso, mensagem, dados }`.

---

### 2.6 Prisma — boas práticas

```js
// ✅ Selecionar apenas campos necessários
const animal = await prisma.animal.findUnique({
  where: { id: Number(id) },
  select: { id: true, nome: true, peso: true, especie: { select: { nome: true } } }
});

// ✅ Verificar se existe antes de atualizar
const existe = await prisma.alimento.findUnique({ where: { id: Number(id) } });
if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });

// ✅ Converter id de string para number sempre
const animalId = Number(req.params.id);

// ❌ Nunca assumir que req.params.id já é número
prisma.animal.findUnique({ where: { id: req.params.id } }); // tipo errado
```

---

### 2.7 Variáveis de ambiente

```js
// ✅ Sempre usar process.env com fallback explícito apenas em dev
const SECRET = process.env.JWT_SECRET || 'fallback-dev-only';
const PORT = process.env.PORT || 3001;

// ❌ Nunca hardcodar segredos para produção
const SECRET = 'minha-senha-super-secreta';
```

---

### 2.8 Nomenclatura — Backend

| Elemento | Convenção | Exemplo |
|---|---|---|
| Arquivos de controller | PascalCase + `Controller` | `DietaController.js` |
| Arquivos de route | camelCase plural | `dietas.js`, `composicaoAlimentar.js` |
| Arquivos de service | camelCase + `.service` | `relatorioNutricional.service.js` |
| Funções de controller | camelCase, verbo descritivo | `listarPorAnimal`, `obterPorId`, `criarItem` |
| Variáveis locais | camelCase | `alimentosRaw`, `animalId` |
| Constantes de módulo | camelCase | `const prisma = new PrismaClient()` |

---

## 3. Padrões — Frontend

### 3.1 Linguagem

TypeScript strict em todos os arquivos `.tsx` e `.ts`. Sem `any` explícito.

```ts
// ✅
const [animais, setAnimais] = useState<Animal[]>([]);

// ❌
const [animais, setAnimais] = useState<any>([]);
```

---

### 3.2 Client HTTP — uso de `api.ts`

**Toda chamada ao backend deve usar a instância centralizada**, nunca `fetch` direto ou `axios` importado avulso.

```ts
// ✅ Correto
import api from '../services/api';

const response = await api.get('/animais');
const animal = response.data;

// ❌ Errado
const response = await fetch('http://localhost:3001/api/animais');
import axios from 'axios'; // importação avulsa
```

A instância `api` já injeta o token JWT automaticamente e trata erros 401 globalmente.

---

### 3.3 Estrutura de um componente de página

```tsx
// src/pages/ExemploPagina.tsx

import { useState, useEffect } from 'react';
import api from '../services/api';

interface Exemplo {
  id: number;
  nome: string;
  categoria: string;
}

export default function ExemploPagina() {
  const [itens, setItens] = useState<Exemplo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregarItens();
  }, []);

  const carregarItens = async () => {
    try {
      setLoading(true);
      const res = await api.get('/exemplos');
      setItens(res.data.dados);
    } catch (error) {
      setErro('Erro ao carregar dados');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6">Carregando...</div>;
  if (erro) return <div className="p-6 text-red-500">{erro}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Exemplos</h1>
      {/* conteúdo */}
    </div>
  );
}
```

**Regras:**
- Estado de loading e erro **sempre** presentes em páginas com chamadas assíncronas
- Interfaces TypeScript **definidas no topo** do arquivo ou em arquivo separado de tipos
- Um `useEffect` por responsabilidade (não empilhar múltiplas chamadas em um único effect sem separação clara)

---

### 3.4 Feedback ao usuário

Usar `react-hot-toast` para feedback de ações:

```tsx
import toast from 'react-hot-toast';

// Sucesso
toast.success('Dieta salva com sucesso!');

// Erro
toast.error('Erro ao salvar. Tente novamente.');

// Loading (para operações longas)
const id = toast.loading('Salvando...');
// ... após a operação:
toast.dismiss(id);
toast.success('Pronto!');
```

**Nunca usar `alert()` ou `confirm()` do browser.**

---

### 3.5 Roteamento

Novas rotas são adicionadas em `App.tsx` dentro do bloco de rotas protegidas:

```tsx
// App.tsx — dentro do <Routes> protegido
<Route path="/novo-modulo" element={<NovoModulo />} />
<Route path="/novo-modulo/:id" element={<NovoModulo />} />
```

Padrão de rotas:
```
/recurso               → listagem
/recurso/novo          → criação
/recurso/:id           → edição
/recurso/:parentId/sub → sub-recurso (ex: /dieta/:animalId)
```

---

### 3.6 Contextos

| Contexto | Hook | O que provê |
|---|---|---|
| `AuthContext` | `useAuth()` | `user`, `login()`, `logout()`, `loading` |
| `SelectedAnimalContext` | `useSelectedAnimal()` | animal selecionado globalmente |

```tsx
// ✅
import { useAuth } from '../contexts/AuthContext';
const { user, logout } = useAuth();

// ✅
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
```

---

### 3.7 Estilização com Tailwind

```tsx
// ✅ Classes utilitárias Tailwind diretamente no JSX
<button className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors">
  Salvar
</button>

// ✅ Classes condicionais com template literal
<div className={`p-4 rounded-lg ${ativo ? 'bg-emerald-50' : 'bg-gray-50'}`}>

// ❌ Não usar style inline para layout
<div style={{ display: 'flex', gap: '16px' }}>
```

**Paleta principal do projeto:**
- Primária: `emerald-600` / `emerald-700`
- Fundo: `white` / `gray-50`
- Texto principal: `gray-900` / `gray-700`
- Texto secundário: `gray-500`
- Erro: `red-500` / `red-50`
- Border: `gray-200` / `gray-300`

---

### 3.8 Nomenclatura — Frontend

| Elemento | Convenção | Exemplo |
|---|---|---|
| Componentes e páginas | PascalCase | `AnimalDetail.tsx`, `CriaDieta.tsx` |
| Hooks customizados | `use` + PascalCase | `useAuth`, `useSelectedAnimal` |
| Funções de handler | `handle` + evento | `handleSubmit`, `handleDelete` |
| Funções de carregamento | `carregar` + recurso | `carregarAnimais`, `carregarDieta` |
| Variáveis de estado | camelCase descritivo | `animaisList`, `dietaAtual`, `loading` |
| Interfaces/Types | PascalCase | `Animal`, `DietaItem`, `AuthContextType` |
| Arquivos de serviço | camelCase + `.service` | `relatorioNutricional.service.ts` |

---

## 4. Gestão de Arquivos

### 4.1 O que nunca commitar

```
# .gitignore já deve conter:
node_modules/
.env
uploads/*          # exceto .gitkeep
*.log
dist/
build/
```

### 4.2 Arquivos temporários e experimentos

- **Nunca nomear com "copy", "lixo", "teste", "backup"** em arquivos que vão para o repositório
- Se precisar experimentar algo, use uma branch separada
- Antes de abrir PR, limpe todos os `console.log` de debug, arquivos duplicados e comentários de código morto

---

## 5. Tratamento de Erros

### 5.1 Backend

```js
// ✅ Erros de constraint do Prisma
} catch (error) {
  if (error.code === 'P2002') {
    return res.status(409).json({ sucesso: false, mensagem: 'Registro já existe' });
  }
  if (error.code === 'P2025') {
    return res.status(404).json({ sucesso: false, mensagem: 'Registro não encontrado' });
  }
  console.error('Erro inesperado:', error);
  res.status(500).json({ sucesso: false, mensagem: 'Erro interno do servidor' });
}
```

### 5.2 Frontend

```tsx
// ✅ Em chamadas de API — sempre tratar o erro
try {
  const res = await api.post('/dietas', payload);
  toast.success('Dieta criada!');
  navigate(-1);
} catch (error: unknown) {
  const mensagem = axios.isAxiosError(error)
    ? error.response?.data?.mensagem ?? 'Erro ao salvar'
    : 'Erro inesperado';
  toast.error(mensagem);
}
```

---

## 6. Integração com IA (Groq)

A integração com o Groq é feita via `fetch` com a API REST diretamente em `exameParserService.js`.

```js
// Padrão de chamada LLM no projeto
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'llama-3.3-70b-versatile',  // modelo padrão atual
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,    // baixo — respostas estruturadas/JSON
    max_tokens: 2000,
  }),
});
```

**Regras para prompts:**
- Sempre incluir instrução explícita de formato de resposta (JSON, campos esperados)
- Usar `temperature` baixo (0.0–0.2) para extração de dados estruturados
- Sempre parsear e validar a resposta antes de usar — o LLM pode retornar JSON mal-formado
- Logar erros de parse separadamente para facilitar debug

---

## 7. O que não fazer

| ❌ Proibido | ✅ Alternativa |
|---|---|
| `any` em TypeScript | Definir interface ou type adequado |
| `fetch()` direto no frontend | Usar `api.ts` (instância axios) |
| Hardcodar URLs de backend no frontend | Usar proxy Vite (`/api/...`) |
| Criar arquivos `copy`, `lixo`, `backup` | Usar branches do Git |
| Lógica de negócio em controller | Mover para service |
| `alert()` / `confirm()` | Usar `react-hot-toast` ou modal |
| Arquivos `.ts` no backend | Backend é JavaScript puro |
| `console.log` em produção | Remover antes do commit ou usar logger estruturado |
| Prisma sem `Number()` em IDs vindos de params | Sempre converter: `Number(req.params.id)` |
| SQL raw sem necessidade | Preferir Prisma ORM; usar `$queryRawUnsafe` só quando pivot/complexidade justificar |
