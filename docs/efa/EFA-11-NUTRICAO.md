# EFA-11 — Nutrição (Dietas, Análise NRC, Exames Nutricionais e Relatório)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Nutrição |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Planejar e acompanhar a nutrição do animal: dieta (plano de alimentos com quantidades e
fornecimentos), balanço nutricional versus exigências NRC, exames nutricionais
(laboratoriais de nutrientes) e o relatório consolidado — com bancos de dados de
alimentos/nutrientes/composição mantidos pelo ADMIN e apoio de IA na importação de
laudos e sugestão de dietas.

## 3. Escopo

**Inclui:** bancos nutricionais (alimentos, nutrientes, composição por espécie, com
importação assistida por LLM); planos de dieta e itens; análise NRC; exames
nutricionais (upload de laudo + LLM ou manual); relatório nutricional com snapshot;
compartilhamento público de dieta; impressões/exportações.

**Não inclui:** exames clínicos (EFA-08); catálogo de medicamentos (EFA-10);
faturamento (dieta não fatura).

## 4. Glossário

EFA-00 §4. Específicos: **NRC** — *Nutrient Requirements of Horses* (exigências por
peso/categoria/exercício); **Composição alimentar** — teores de nutrientes por
alimento/espécie; **Plano de dieta** — agrupamento de itens ativos do animal;
**Ocorrência de fornecimento** — horários/vezes do dia em que o item é servido;
**Snapshot** — relatório persistido (`RelatorioSalvo`) imutável.

## 5. Personas

Veterinário/nutricionista (planeja), Gestor (idem), Proprietário (consulta a dieta
conforme permissão), ADMIN (bancos de dados).

## 6. Fluxo geral

ADMIN mantém bancos → vet monta a dieta do animal (`/cria-dieta`) → dieta ativa →
análise NRC compara com exigências → exames nutricionais entram como evidência →
relatório nutricional consolida e persiste snapshot → impressão/compartilhamento.

## 7. Casos de uso

### UC-11-01 — Manter bancos nutricionais (ADMIN)
- **Alimentos** (`/alimentos`), **Nutrientes** (`/nutrientes`), **Composição**
  (`/composicao`): CRUD com soft delete; composição inclui **importação assistida por
  LLM** (parser de tabela/laudo) e importação completa em lote. Leitura livre (usada
  nos formulários de dieta).

### UC-11-02 — Montar dieta (`/cria-dieta`)
- **Pré:** `nutricao.dietas.criar`.
- **Principal:** seleciona animal → adiciona itens (alimento do banco, quantidade,
  unidade, ocorrências de fornecimento) → salva plano (agrupa itens).
- **Alternativos:** **sugestão por IA** (Groq) gera proposta de dieta; edição inline na
  tela Dieta; toggle ativo/inativo do plano.
- **Erros:** alimento sem composição para a espécie → aviso na análise.

### UC-11-03 — Consultar dieta (`/dieta`)
- Visualização da dieta do animal selecionado com filtros (todos/ativos/inativos),
  edição inline, exclusão de item com **justificativa** (auditada), barra de ações
  (imprimir, **compartilhar por link público**, exportar) — tudo gated por permissão
  (`nutricao.dietas.*`).

### UC-11-04 — Análise NRC (`/analise`)
- `GET /api/analise/:animalId` calcula o balanço da dieta ativa × exigências (peso,
  categoria NRC, exercício) via calculadora equina (registro por espécie —
  `speciesCalculatorRegistry`). Exibe nutriente a nutriente: fornecido, exigido, % e
  status.

### UC-11-05 — Exames nutricionais (`/exames`, `/exames/:animalId/novo`)
- **Criação por upload de laudo:** arquivo → extração de resultados por nutriente via
  LLM → revisão → salvar. **Ou manual:** digitação por nutriente.
- Listagem/edição por animal; exclusão com justificativa (auditada).
- Modelo próprio (`ExameNutricional`) — distinto dos exames clínicos (EFA-08).

### UC-11-06 — Relatório nutricional (`/relatorio-nutricional`)
- Gera o consolidado (dieta × exigências × exames), com classificação por status do
  nutriente e agrupamento por categoria; **persiste snapshot** (`RelatorioSalvo`,
  imutável); impressão/exportação.

## 8. Especificação das telas

**Dieta:** guard de página; tabela/cards de itens (alimento, quantidade, fornecimentos);
edição inline; `DietaAcoesBar` (imprimir/compartilhar/exportar, ocultados sem
permissão); `ModalJustificativa` na exclusão de item. **Análise:** tabela de nutrientes
com semáforo. **Exames:** upload com progresso e revisão dos valores extraídos; tabela
por nutriente. **Relatório:** visão agrupada por categoria; histórico de snapshots.
Bancos ADMIN: listas com busca e formulários simples; composição com modal de
importação LLM.

## 9. Especificação dos campos (destaques)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Alimento (item de dieta) | referência banco | Sim | precisa de composição p/ espécie para entrar na análise. |
| Quantidade + unidade | decimal > 0 | Sim | base do cálculo de fornecimento. |
| Ocorrências de fornecimento | lista | Não | vezes/horários do dia. |
| Categoria NRC / exercício (animal) | enum | — | vêm do cadastro do animal (EFA-05). |
| Resultado por nutriente (exame) | decimal | Sim (manual) | unidade do nutriente. |
| Justificativa (exclusões) | texto ≥3 | Sim | RN-G-002. |

## 10. Regras de negócio

**RN-11-001 — Bancos são globais e ADMIN-only na escrita.** Motivo: consistência
científica entre tenants. Leitura livre.

**RN-11-002 — Dieta não é excluída, é inativada.** Plano usa toggle ativo (sem ação de
delete no catálogo de permissões); itens individuais podem ser excluídos com
justificativa. Motivo: histórico nutricional.

**RN-11-003 — Análise usa a dieta ativa.** Somente itens ativos entram no balanço;
animal sem peso/categoria → análise indisponível com orientação.

**RN-11-004 — Relatórios são imutáveis.** Snapshot persistido sem editar/excluir
(catálogo de permissões não tem essas ações). Motivo: documento entregue ao cliente.

**RN-11-005 — IA é assistiva.** Extração de laudo e sugestão de dieta sempre passam por
revisão humana antes de salvar; falha de IA não bloqueia o fluxo manual.

**RN-11-006 — Compartilhamento público de dieta.** Link público (sem login) gerado sob
permissão `nutricao.dietas.compartilhar`; expõe somente a dieta (sem dados clínicos).

## 11. Fluxograma

Bancos (ADMIN) → dieta do animal → análise NRC ⇄ exames nutricionais → relatório →
snapshot → impressão/compartilhamento.

## 12. Estados do objeto

**Plano de dieta:** `ativo ⇄ inativo`. **Item:** ativo → excluído (justificativa).
**Exame nutricional:** registrado → editado → excluído (justificativa).
**RelatorioSalvo:** imutável.

## 13. Segurança

Slugs `nutricao.dietas.*` (inclui compartilhar/exportar/ativar) e
`nutricao.relatorios.*`; bancos com escrita ADMIN; link público de dieta com token
não-enumerável.

## 14. Auditoria

Exclusões de item de dieta e de exame nutricional no AuditLog com motivo (entidades
DIETA_ITEM, EXAME_NUTRICIONAL). Snapshots preservam o histórico de relatórios.

## 15. Integrações

Groq (parser de composição, extração de laudo, sugestão de dieta — degradação
graciosa); impressão/exportação (`Dietaprint`, relatório). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-11-001 | "Alimento sem composição cadastrada para esta espécie." | Análise. |
| MSG-11-002 | "Informe peso e categoria do animal para calcular as exigências." | Análise indisponível. |
| MSG-11-003 | "Resultados extraídos do laudo — revise antes de salvar." | Upload LLM. |
| MSG-11-004 | "Link de compartilhamento copiado." | Compartilhar dieta. |
| MSG-11-005 | "É obrigatório informar o motivo da exclusão" | RN-G-002. |

## 17. Tratamento de erros

EFA-00 §17. Upload de laudo ilegível → mensagem e fallback manual.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que o animal tem dieta ativa, peso e categoria NRC
Quando abro a Análise
Então vejo cada nutriente com fornecido, exigido e status.

Dado que enviei um laudo em PDF/imagem
Quando a IA extrai os resultados
Então reviso os valores em tela editável antes de salvar
E, se a IA falhar, posso digitar manualmente.

Dado que excluí um item de dieta com justificativa
Quando o gestor consulta a Auditoria
Então o registro aparece com entidade, motivo e autor.

Dado que gerei um relatório nutricional
Quando o consulto depois
Então o snapshot está inalterado mesmo que a dieta tenha mudado.
```

## 19. Casos de teste

Positivos: dieta completa → análise coerente; exame por upload e manual; snapshot.
Negativos: exclusão sem motivo; análise sem peso; escrita em banco por não-ADMIN.
Limites: quantidade mínima (>0); dieta sem itens ativos. Segurança: link público não
expõe outros dados; permissões de compartilhar/exportar respeitadas. Concorrência:
edição inline simultânea de itens distintos.

## 20. Requisitos não funcionais

EFA-00 §20. Cálculo NRC no backend (uma chamada por análise); importação em lote
ADMIN é operação administrativa (sem limite de UI).

## 21. Melhorias futuras

Comparativo de snapshots (evolução temporal); metas nutricionais por objetivo
(emagrecimento/ganho); custo da dieta (preço dos alimentos); suporte a outras espécies
na calculadora (registro já preparado).
