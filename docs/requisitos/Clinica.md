## Contexto S2Vet — Resumo para nova sessão

---

### Projeto
**SSVet** — Sistema hospitalar veterinário modular, mobile-first, AI-ready.
Stack: React 18 + TypeScript strict + Vite + Tailwind + shadcn/ui + Lucide | Node.js + Express + Prisma + MySQL.
Padrões: sem `any`, sem `alert()`, feedback inline (banner verde/vermelho/azul), envelope `{ sucesso, dados, mensagem }` no backend, CommonJS no backend.

---

### Módulo atual: Nutricional Equino

#### Arquivos produzidos nesta sessão

**`Dieta.tsx`** — Página única consolidada (antes eram duas: Dieta + CriaDieta).
- Animal card no topo (foto + nome + raça + nascimento + proprietário + email)
- Seletor de animal (dropdown, aparece só se tiver mais de um)
- Busca + filtros (todos/ativos/inativos) + botão "Novo plano"
- Lista de planos como cards clicáveis com pills; plano selecionado abre seção de itens inline (scroll suave)
- **Ações por card de plano:** Ver/Fechar · + Alimento · Editar nome (inline) · Toggle ativo/inativo
- **Header do plano selecionado:** Toggle ativo/inativo + botão Imprimir (lado a lado)
- **Banner de conflito de frequências:** detectado automaticamente ao carregar itens — mostra alimentos com periodicidades diferentes (ex: Alfafa Diário + Semanal)
- **Tabela de itens com edição inline** (padrão Exames.tsx): clica no lápis → campos editáveis na mesma linha → Salvar/Cancelar
- **Validação de frequência no edit:** mesmo alimento não pode ter periodicidades diferentes no mesmo plano
- Todos os inputs com `text-gray-900 bg-white` (fix do texto branco)
- Botão excluir plano: **removido** (decisão de produto)
- Rota App.tsx: apenas `/dieta/:animalId` (rota `/plano/:planoDietaId` removida)

**`dietaPrint.ts`** — Utilitário de impressão extraído do Dieta.tsx (`src/utils/dietaPrint.ts`).
- `gerarHtmlDieta(animal, plano, itens, user)` → retorna HTML completo
- Abre via `window.open('', '_blank')` — não usa `@media print` (que não funciona com React DOM)
- Layout A4: cabeçalho S2Vet + card do animal com foto (espelho do AnimalCard) + plano + alimentos agrupados
- **Agrupamento de impressão:** frequência (DIÁRIO/SEMANAL/…) → período do dia (Manhã/Tarde/Noite/Madrugada)
- Usa `<table>` real com `rowspan` na coluna de período — única forma confiável para print
- CSS totalmente embutido no HTML gerado (necessário para `window.open`)
- Interface `PrintAnimal.photoUrl` é `optional` (`photoUrl?: string | null`) para compatibilidade com `AnimalExtended`

**`Exames.tsx`** — Referência de padrão de edição inline (fornecida pelo usuário, não modificada).

---

### Rotas App.tsx relevantes
```
/dieta/:animalId          → Dieta.tsx (tudo em uma página)
/dieta/:animalId/plano/:planoDietaId/novo    → página de adicionar alimento (existe, não modificada)
/dieta/:animalId/plano/:planoDietaId/editar/:id → página de editar alimento (existe, não modificada)
/exames/:animalId         → Exames.tsx
```

---

### Pendências conhecidas
1. **Validação de frequência na página `/novo`** (CriaDieta ou equivalente) — a validação existe no edit inline mas NÃO na página de adição. Precisamos do arquivo para adicionar.
2. **Alimentos com frequências conflitantes já no banco** — o banner detecta e avisa, mas o usuário precisa remover/editar manualmente os itens duplicados.
3. **Impressão** — o exemplo do usuário (screenshot) mostrou que o layout está correto. Aprovado.

---

### Interfaces TypeScript principais (Dieta.tsx)
```typescript
type AnimalExtended = Animal & {
  dataNascimento?: string | Date | null;
  raca?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
};
interface PlanoDieta { id, animalId, nome, ativo, dataCriacao, _count?: { itens } }
interface DietaItem { id, alimentoId, alimento?: { nome } | null, periodicidade, qtdGramasDia, unidade, horario? }
interface Alimento { id, nome }
interface EditItemValues { alimentoId, qtdGramasDia, unidade, horario, periodicidade } // todos string
```

---

### Padrões obrigatórios do projeto
- **Frontend:** sem `any`, sem `alert()`, feedback inline, `text-gray-900` em todos os inputs de edição, mobile-first, `rounded-3xl` em botões principais, emerald como cor primária
- **Backend:** CommonJS, envelope `{ sucesso, dados, mensagem }`, Repository Pattern, sem SQL inline
- **Arquitetura:** Cloud-agnostic, desacoplada, sem vendor lock-in, preparada para IA


### Premissa
- Sempre entregue a linha que precisa ser alterada como estava antes e o depois
- Só me entregue o arquivo completo se for pedido.
- Use como base os arquivos de Dieta para alterar os layouts, as inserções, edições e exclusões.
- Quando a LLM for usada no código ela deve se reter a entregar o que foi pedido, não inventar, não alucinar, não dar sugestões

### Objetivo 
- Criar o Módulo Clínico
    - Esse módulo será exclusivo para Veterinários e Administradores
    - O Veterinário só poderá ver os animais que ele ou sua equipe forem responsáveis
    - O Veterinário principal poderá ver, editar e excluir toda e qualquer informação porém ele jamais poderá alterar qualquer informação que seja de outro veterinário.
    - Os estagiários ou veterinários não desginados mesmo pertecentes a equipe não poderão editar ou excluir qualquer informação
    - Os Veterinários (estagiários) que são subordinados podem incluir informação  porém não será persistida na base de dados emquanto o(s) veterinário(s) principal não der o ok.
    - Na primeira página deverá abrir o Dashboard, com as opções permitidas para Veterinários.
    - No SideBar deverá ter os sub-módulos, Evolução, Prescrição, Vacina, Exames, Encaminhamento.
    - Ao clicar em qualquer um deles, deverá:
        - Abrir a página correspondente de cada submódulo, mas deverá ter um seletor do animal
        - Embaixo do Card de Animal deverá ter um botão com novo (evolução, Prescrição, Vacina ou Encaminhamento) dependendo da opção que for esclhida, ao lado uma seletor para informar quantos itens por página será apresentado, do lado dieito um box com Busca (evolução, Prescrição, Vacina ou Encaminhamento) dependendo da opção que for esclhida.
        - Embaixo do Card descrito acima, deverá ter um submenu com Evolução, Prescrição, Vacina, Exames, Encaminhamento e em um terço da página do lado direito pegado toda a página na verticao com scrool a fatura com a inclusão dos procedimentos, medicamentos, valores e total e ao lado de cada um deles as duas primeira letras do Veterinário
        - A evolução poderá ser preenchida , digitando ou via fala.
        - Uma LLM deverá avaliar o que está sendo dito, escrever no Banco de Dados e se tiver alguma prescrição, procedimento, medicamento, exame ou encaminhamento a LLM devetá perguntar se o veterinário quer realmente inserir o procedimento, prescrição, medicamento, exame ou encaminhamento e após a confirmação deverá ser incluido na base de dados e incluido no card do lado direito denominada fatura.
        - A tela de evolução deverá ter todas as evoluções incluídas da mais recente para a mais antiga e deverá ter as informações de :
            - Ações (com a opção de editar ou excluir), quando for selecionado a opção de excluir deverá abrir uma tela de confirmação, com a justificativa. A evolução não será apagada da base mas não deverá aparecer mais na tela.
            - Status (Em Andamento, Finalizada ou Cancelada)
            - Responsável (Nome do Veterinário que criou)
            - Especialidade (Clinico, Quiropatra, Nutrição, Oftalmologia, Dermatologia, Cardiologia, Diagnóstico por Imagem, Patologia, Acunpultura, Fisioterapia, Cirurgia), Deverá ser em ordem alfabética
            - Data Inicio (Deverá ser adicionado automáticamente ao incluir a evolução)
            - Data Fim (Quando a evolução for cancelada ou finalizada)
            - Data de Modificação (A data que a evolução foi alterada)
            - Responsável pela Modificação (Nome do Veterinário que modificou)
            - Impressão (Botão de Impressão) ao lado de cada evolução.
            - Quando uma evolução for incluída ou alterada todos os veterinários principais deverão ser notificados via e-mail.
            
        