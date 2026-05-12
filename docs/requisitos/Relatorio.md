## Contexto S2Vet — Resumo para nova sessão

---

### Projeto
**S2Vet** — Sistema hospitalar veterinário modular, mobile-first, AI-ready.
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

### Objetivo 
- Trabalhar o submódulo Relatórios
    - O relatório é uma junção da tb_composicao_alimento e a tabela tb_exigencias_nrc 
    - O relatório precisa ficar guardado como histórico junto com a Dieta, ou seja, para uma dieta existe um relatório
    - Se a dieta tiver sido alterada o relatório também é alterado e sobrescrito.
    - No relatório deverá conter a seguinte formatação:
    Nutriente       Amino-E     Ração S-280     TOTAL           Exigido     Saldo       %           Status
    Vitamina A      100UI       10UI            110UI           90UI        +20UI       122,22%     Em Excesso
    Cálcio          50g         0,00005g        50,00005g       60g         -9,99g      83,33%      Deficiente
    Cloro           10g         1g              11g             11g         0g          100%        Adequado
    Vitamina E                  300UI           300UI           50UI        +250UI      600%        Altíssimo

    O Nutriente deverá vir da tabela tb_composicao_alimento que tem a informação do nutriente de cada alimento que ele está consumindo na dieta
    O nome dos alimentos (Amino-E, Ração S-280, etc) deverá vir da tabela tb_composicao_alimento que tem a informação de qual alimento ele está consumindo
    o Exigido deverá ser pego na tabela tb_exigencias_nrc e comparado com os nutrientes dos alimentos que estão na tb_composicao_alimento
    O status deverá ser passado de acordo com o percentual e a tabela abaixo:
            - <= 70% = 'DEFICIÊNCIA CRÍTICA'
            - > 70% e <= 90% = 'DEFICIÊNCIA'
            - > 90% e <= 120% = 'ADEQUADO'
            - < 120% e <= 200 = 'EXCESSO'
            - > 200% = 'EXCESSO CRÍTICO'
