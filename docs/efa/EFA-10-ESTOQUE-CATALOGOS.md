# EFA-10 — Estoque (Farmácia e Vacinas) e Catálogos Globais

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> Consumido por Prescrição/Execução (EFA-07) e Vacinas (EFA-08).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Estoque (Farmácia e Vacinas) e Catálogos Globais |
| Versão | 1.1 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: inicial. 1.1 (2026-07-10): Ajuste de Estoque com tela própria e permissão `farmacia.estoque.ajustar`; regra "em uso" = somente SAÍDA; AJUSTE com delta assinado. |

## 2. Objetivo

Controlar o estoque de medicamentos por clínica (multi-lote, com reservas e custo por
lote) e o estoque de vacinas por doses, além dos catálogos globais mantidos pelo ADMIN
(medicamentos, procedimentos, vacinas, laboratórios/exames, espécies/raças). Garante
disponibilidade confiável para a prescrição, custo correto na fatura e inventário
auditável.

## 3. Escopo

**Inclui:** Farmácia — entrada de estoque (com consolidação), edição, inativação com
justificativa, **Ajuste de Estoque** (inventário), movimentações imutáveis com gráfico,
indicadores e filtros; Estoque de Vacinas — lotes com doses; Catálogos ADMIN.

**Não inclui:** reserva/baixa por prescrição (regras em EFA-07; aqui o efeito);
aplicação de vacina (EFA-08).

## 4. Glossário

EFA-00 §4. Específicos: **Item de estoque (entrada)** — registro por medicamento+lote+
validade; **Consolidação** — soma de nova compra a uma entrada idêntica; **Em uso** —
item com ≥1 movimento de SAÍDA; **Ajuste** — movimento de correção de inventário com
delta positivo ou negativo; **Estoque mínimo/alarmante** — limiares de reposição;
**Dose (vacina)** — unidade de controle do estoque de vacinas.

## 5. Personas

Gestor (tudo), Veterinário/Enfermeiro (entradas, ajustes — PRÓPRIO por padrão),
Estagiário (leitura), Financeiro (custos), ADMIN (catálogos globais).

## 6. Fluxo geral

Compra → Entrada de Estoque (ou consolidação) → disponível para prescrição (reserva na
finalização; baixa na execução — EFA-07) → contagens periódicas via Ajuste de Estoque →
reposição orientada pelos indicadores (crítico/alarmante).

## 7. Casos de uso

### UC-10-01 — Entrada de estoque (`/farmacia`)
- **Pré:** `farmacia.estoque.criar`.
- **Principal:** botão **Entrada de Estoque** → combobox de medicamento (catálogo, com
  dados do catálogo exibidos) → fornecedor (tipos Farmácia/Laboratório/Loja) + nota
  fiscal → valor por embalagem e valor repassado por embalagem → **lote e validade
  obrigatórios** (validade ≥ hoje na criação) → nº de embalagens × peso/volume por
  embalagem (calculadora do total) → mínimo/alarmante (na subunidade: mL/g) → salvar.
- **Alternativo (consolidação):** mesmo medicamento + lote + validade + valor por
  embalagem (tolerância 1%) → soma quantidades/valores na entrada existente e gera
  movimento ENTRADA "NF: ..." — banner avisa antes.
- **Pós:** movimento ENTRADA "Entrada inicial"/NF; preço unitário base (R$/g ou R$/mL)
  recalculado.
- **Regras:** RN-10-001..003.

### UC-10-02 — Editar item
- **Pré:** `farmacia.estoque.editar`; item **não** em uso (sem SAÍDA).
- **Principal:** editar valores, lote, validade, quantidade/embalagens, mínimo/
  alarmante, fornecedor/NF, status.
- **Alternativo (em uso):** item abre em modo visualização com atalho para o Ajuste;
  lote/validade/quantidade bloqueados (apenas mínimo/alarmante/valores/status).
- **Regras:** RN-10-004.

### UC-10-03 — Ajuste de Estoque (inventário)
- **Pré:** `farmacia.estoque.ajustar` (GESTOR bypass; VET/ENFERMEIRO PRÓPRIO por
  padrão).
- **Principal:** botão **Ajuste de Estoque** (ao lado da Entrada) → seletor pesquisável
  do item (nome, lote, quantidade atual) → campo **Quantidade em Estoque pré-preenchido
  com a atual** → usuário informa a contagem real → preview "Diferença a registrar:
  +X/−X (atual → nova)" → **motivo obrigatório** → confirmar → movimento AJUSTE com
  delta assinado.
- **Alternativos:** quantidade igual à atual → nada é registrado (aviso); zerar é
  permitido; abertura a partir da visualização de item em uso pré-seleciona o item.
- **Erros:** resultado negativo; motivo ausente.
- **Regras:** RN-10-005.

### UC-10-04 — Inativar item
- Justificativa obrigatória → soft delete → auditoria. Item não some das movimentações.

### UC-10-05 — Movimentações e indicadores
- Clique no nome do item → histórico de movimentos (gráfico por dia
  Entrada/Saída/Ajuste + lista de entradas por NF). Cards: itens ativos, estoque
  crítico, alerta amarelo, controlados. Abas: Ativos/🔴Crítico/🟡Alarmante/🔒Controlados/
  Inativos.

### UC-10-06 — Estoque de Vacinas (`/estoque-vacina`)
- Lote: vacina do catálogo (por fabricante), lote, validade, frascos × doses por frasco
  (1–100), total/disponível de doses, validade pós-abertura (horas/dias), valores,
  data de recebimento. Indicadores: total de lotes, vencidos, vencendo, total de doses;
  abas todas/ativas/inativas/vencidas/vencendo. Exclusão com justificativa. Alimenta a
  aplicação de vacinas (EFA-08).

### UC-10-07 — Catálogos globais (ADMIN)
- **Medicamentos** (`/medicamentos`, ~4.900 itens seed): nome, fabricante, forma,
  apresentação, unidade, vias, espécies, flag vacina, valor; escrita ADMIN; leitura
  livre; endpoint `para-atendimento` com situação de estoque. **Procedimentos** (301
  itens). **Vacinas (admin)** com lotes. **Laboratórios/exames** e **exames de imagem**
  (somente leitura). **Espécies/raças** (seed). Exclusões de catálogo com justificativa.

## 8. Especificação das telas

**`/farmacia`:** cabeçalho com cards-resumo; busca; abas de filtro; lista em grid
(nome clicável p/ histórico, badge de quantidade colorida por nível, lote, validade com
alerta de vencimento, barra de nível, ações Editar/Visualizar/Inativar); modais:
Entrada (painel superior), **Ajuste** (mesmo padrão, com seletor e preview), histórico
(gráfico), visualização de item em uso (com botão Ajuste), `ModalJustificativa`.
**`/estoque-vacina`:** análogo, orientado a lotes/doses.

## 9. Especificação dos campos (Farmácia)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Medicamento | referência catálogo | Sim | imutável na edição. |
| Lote | texto | Sim | comparação case-insensitive na consolidação; bloqueado se em uso. |
| Validade | data | Sim | ≥ hoje na criação; bloqueada se em uso. |
| Valor / Valor repassado (por embalagem) | moeda | Sim / Não | total = valor × nº embalagens; repassado espelha valor até edição manual. |
| Nº de embalagens | inteiro ≥0 | Sim | calculadora do total. |
| Peso/volume por embalagem | decimal | Não | auto-sugerido do catálogo (extração de "3,6 L" etc.). |
| Estoque mínimo / alarmante | decimal ≥0 | Não | informado na subunidade (mL/g); armazenado na unidade maior. |
| Quantidade em Estoque (Ajuste) | decimal ≥0 | Sim | pré-preenchida com a atual; diferença vira AJUSTE. |
| Motivo (Ajuste/Inativação) | texto ≥3 | Sim | RN-G-002/RN-10-005. |

## 10. Regras de negócio

**RN-10-001 — Lote e validade obrigatórios.** Toda entrada identifica o lote; são a
chave da consolidação e do FEFO. Não podem ser apagados na edição.

**RN-10-002 — Consolidação com tolerância de 1%.** Mesmo medicamento+lote+validade e
valor por embalagem com diferença <1% somam-se; caso contrário nova entrada. Motivo:
compras repetidas não devem fragmentar o estoque; variação cambial mínima tolerada.

**RN-10-003 — Preço unitário base por lote.** R$/g ou R$/mL calculado do valor
repassado ÷ quantidade na unidade base; usado no custo da dose (EFA-07 RN-07-004).

**RN-10-004 — "Em uso" = somente SAÍDA.** A ENTRADA automática (inicial/adicional)
não bloqueia a edição; somente uso real (saída) trava lote/validade/quantidade.
Motivo: corrigir erro de digitação de uma entrada recém-criada é legítimo; após uso, a
correção deve ser via Ajuste (rastreável). *(Correção de bug de 2026-07-10.)*

**RN-10-005 — Ajuste com delta assinado e motivo.** Correção para baixo NÃO é
registrada como SAÍDA (não marca uso) e sim como AJUSTE negativo; motivo obrigatório;
diferença zero não registra; zerar é permitido; resultado negativo é rejeitado.

**RN-10-006 — Movimentações imutáveis.** Sem edição/exclusão de movimentos (trilha de
auditoria do estoque).

**RN-10-007 — Estoque por empresa.** Escopo do contexto ativo; ADMIN pode inspecionar
por empresa.

**RN-10-008 — Doses de vacina.** Total = frascos × doses/frasco; aplicação debita doses
do disponível; exclusão de aplicação restaura (EFA-08 RN-08-001).

## 11. Fluxograma (farmácia)

Entrada (nova/consolidada) → disponível → reservas (finalização de prescrição) → saídas
(execução) → item "em uso" → correções via Ajuste → inativação (fim de vida) — tudo
gerando movimentos imutáveis.

## 12. Estados do objeto (item de farmácia)

`ativo (não usado) → ativo (em uso, após 1ª SAÍDA) → inativo (justificativa)`.
Derivados: nível ok/alarmante/crítico (comparação com limiares); vencido/vencendo (por
validade).

## 13. Segurança

Slugs `farmacia.estoque.ler|criar|editar|ajustar|deletar|imprimir` e
`farmacia.movimentacoes.*`; `vacina.estoque.*`; catálogos com escrita ADMIN-only.
Matriz exibe coluna AJUSTAR (override de colunas da Farmácia).

## 14. Auditoria

Movimentos imutáveis com motivo; ajustes com motivo obrigatório; inativações no
AuditLog (entidades ESTOQUE_FARMACIA, ESTOQUE_VACINA, MEDICAMENTO, PROCEDIMENTO)
com justificativa.

## 15. Integrações

Catálogo de medicamentos (interno); fornecedor (EFA-04); prescrição/execução (EFA-07);
vacina clínica (EFA-08). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-10-001 | "Quantidade somada ao estoque existente (NF: ...)." | Consolidação. |
| MSG-10-002 | "Item já movimentado — lote e validade não podem ser alterados." | Edição de item em uso. |
| MSG-10-003 | "Item já movimentado — altere a quantidade pelo Ajuste de Estoque." | Edição de quantidade em uso. |
| MSG-10-004 | "Informe o motivo do ajuste." | RN-10-005. |
| MSG-10-005 | "Estoque resultante seria negativo." | Ajuste inválido. |
| MSG-10-006 | "Quantidade igual ao estoque atual — nenhum ajuste será registrado." | Delta zero. |
| MSG-10-007 | "Validade não pode ser anterior à data de hoje." | Criação. |
| MSG-10-008 | "Estoque ajustado." | Ajuste ok. |

## 17. Tratamento de erros

EFA-00 §17. Item inexistente/da outra empresa → 404/403.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que cadastrei uma entrada com quantidade inicial
Quando edito a quantidade antes de qualquer saída
Então a edição é aceita (a entrada inicial automática não conta como uso).

Dado que o item já teve uma saída por execução de prescrição
Quando abro o item
Então ele abre em visualização com atalho para o Ajuste de Estoque.

Dado que o estoque atual é 200 e a contagem física é 180
Quando registro o ajuste com motivo
Então um movimento AJUSTE de −20 é gravado
E o gráfico de movimentações exibe a barra de ajuste.

Dado que dei entrada do mesmo medicamento, lote, validade e preço
Quando salvo
Então as quantidades são somadas na entrada existente com movimento "NF: ...".
```

## 19. Casos de teste

Positivos: entrada nova + consolidada; ajuste para cima/baixo/zerar; inativação com
motivo. Negativos: validade passada na criação; ajuste sem motivo; edição de
quantidade de item em uso (400). Limites: tolerância 0,99% e 1,01% na consolidação;
doses/frasco 1 e 100. Segurança: ajuste sem o slug → 403; catálogo por não-ADMIN → 403.
Concorrência: duas execuções debitando o mesmo lote → transações serializadas, saldo
nunca negativo.

## 20. Requisitos não funcionais

EFA-00 §20. Indicadores calculados na listagem (uma query agregada).

## 21. Melhorias futuras

Inventário em lote (contagem guiada de todos os itens); código de barras; alerta
automático de reposição/vencimento; transferência entre empresas/equipes; curva ABC.
