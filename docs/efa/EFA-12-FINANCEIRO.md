# EFA-12 — Financeiro (Faturamento e Fechamento)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> Recebe lançamentos de Prescrição/Execução (EFA-07), Vacinas/Exames/Encaminhamentos
> (EFA-08) e usa as configurações de fechamento (EFA-03).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Financeiro — Faturamento e Fechamento |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Consolidar a cobrança mensal por proprietário: fatura única por mês (`AAAA-MM`) com
itens de todos os seus animais, alimentada automaticamente pelos módulos clínicos e
complementada por lançamentos manuais. Fechamento automático conforme a política da
empresa e rastreio de correções para governança.

## 3. Escopo

**Inclui:** fatura mensal por proprietário; itens automáticos rastreados por FK de
origem; lançamentos manuais (catálogo rápido); edição/remoção de itens com registro de
correção; fechamento manual e automático (cron); status; impressão/PDF/CSV/
compartilhamento; visão do proprietário; item de mensalista.

**Não inclui:** meios de pagamento/conciliação bancária (não implementado); relatórios
gerenciais (EFA-13); configuração da regra de fechamento (EFA-03).

## 4. Glossário

EFA-00 §4. Específicos: **mesReferencia** — competência `AAAA-MM`; **Item de origem
clínica** — FaturaItem com FK para exame/prescrição/vacina/encaminhamento;
**Correção** — qualquer edição/remoção de item existente (contadores `qtdCorrecoes`,
`ultimaCorrecaoEm`); **Catálogo rápido** — atalhos de lançamento manual (GTA,
Assistência Veterinária, Atd. Emergencial, item livre).

## 5. Personas

Financeiro/Gestor (opera), Veterinário (gera lançamentos indiretos; nível PROPRIO por
padrão), Proprietário (visualiza a própria fatura).

## 6. Fluxo geral

Eventos clínicos lançam itens na fatura ABERTA do mês (criando-a se necessário) →
lançamentos manuais complementam → fechamento (manual ou cron) → FECHADA → pagamento
registrado → PAGA (imutável). Alternativos: cancelamento de fatura; reabertura por
status (conforme permissão).

## 7. Casos de uso

### UC-12-01 — Consultar faturamento (`/faturamento`)
- Lista proprietários do escopo com fatura ativa/fechada/última paga → detalhe da
  fatura: itens por animal (tipo ASSISTENCIA/MEDICAMENTO/PROCEDIMENTO, descrição, valor
  unitário, quantidade, total), totalizadores.

### UC-12-02 — Lançar item manual
- **Pré:** `financeiro.faturas.lancar`.
- **Principal:** botão de lançamento → catálogo rápido (GTA, Assistência Veterinária,
  Atd. Emergencial) ou item livre → animal (opcional), descrição, valor, quantidade →
  grava na fatura ABERTA/FECHADA do mês.
- **Erros:** fatura PAGA → bloqueado (`FATURA_PAGA`).

### UC-12-03 — Editar/remover item
- Edição inline; remoção. Ambos registram **correção** (contador + timestamp) e
  sincronizam total. Fatura PAGA → bloqueado.

### UC-12-04 — Fechar fatura / mudar status
- **Fechar** (`financeiro.faturas.fechar`): ABERTA → FECHADA; lança item de mensalista
  se aplicável (idempotente).
- **Status** (`financeiro.faturas.editar`): FECHADA → PAGA; cancelamento → CANCELADA.
- PAGA é imutável (qualquer alteração bloqueada, inclusive sincronizações clínicas).

### UC-12-05 — Fechamento automático (cron 23:45)
- Diariamente decide **por fatura**: resolve as equipes do proprietário → configuração
  de fechamento do escopo (EFA-03): DIA_FIXO (clamp em meses curtos), DIA_UTIL
  (1º–10º dia útil, descontando fins de semana e feriados nacionais; Sexta-feira Santa
  via algoritmo de Gauss) ou ULTIMO_DIA_MES (fallback sem configuração).
- Fecha as ABERTAS elegíveis; lança mensalista.

### UC-12-06 — Exportar/compartilhar
- Impressão/PDF com logotipo; CSV; compartilhamento por WhatsApp
  (`financeiro.faturas.whatsapp`/`exportar`/`imprimir`).

### UC-12-07 — Visão do proprietário
- Proprietário acessa a própria fatura (visualização; permissões via matriz
  PROPRIETARIO).

## 8. Especificação das telas

**`/faturamento`:** lista de proprietários (busca; badges de status; valores); detalhe
com tabela de itens agrupados por animal, edição inline (valor/quantidade/descrição),
botão remover (com confirmação), botão "Lançar cobrança" (modal catálogo rápido),
ações Fechar/Status/Imprimir/CSV/WhatsApp. Mobile: cards por proprietário e por item.
Estados: sem fatura no mês (criação implícita ao lançar), fatura PAGA (somente
leitura, badge), carregando.

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| mesReferencia | `AAAA-MM` | Sim (implícito) | uma fatura ABERTA por proprietário/mês. |
| Tipo do item | enum | Sim | ASSISTENCIA / MEDICAMENTO / PROCEDIMENTO. |
| Descrição | texto | Sim | sincronizada com a origem clínica quando houver FK. |
| Valor unitário / Quantidade | moeda / decimal | Sim | total = unitário × quantidade; recalcula fatura. |
| Animal | referência | Não | itens podem ser do proprietário (ex.: assistência). |

## 10. Regras de negócio

**RN-12-001 — Uma fatura ABERTA por proprietário/mês.** Lançamentos automáticos buscam
a ABERTA do mês; se o mês já fechou, **cria-se nova fatura** automaticamente. Motivo:
nunca perder lançamento clínico.

**RN-12-002 — Itens de origem clínica são rastreados.** FK para exame/prescrição/
vacina/encaminhamento; editar/excluir a origem sincroniza o item na mesma transação;
fatura PAGA bloqueia a operação inteira (rollback na origem também). (= RN-G-008.)

**RN-12-003 — FECHADA ainda aceita ajustes.** Edição de itens e lançamentos manuais
continuam permitidos; somente PAGA é imutável. Motivo: conferência pós-fechamento antes
da cobrança.

**RN-12-004 — Correções são contabilizadas.** Toda edição/remoção de item existente
incrementa `qtdCorrecoes` — insumo do relatório gerencial (EFA-13). Motivo: governança
sobre alterações de cobrança.

**RN-12-005 — Mensalista é idempotente.** Item "Assistência Veterinária Mensal" é
lançado uma única vez por fatura no fechamento (EFA-04 RN-04-004).

**RN-12-006 — Fechamento por política do escopo.** (UC-12-05; configuração em EFA-03.)
Sem configuração → último dia do mês (comportamento legado preservado).

## 11. Fluxograma

Evento clínico → item na ABERTA do mês (cria se preciso) → conferência/manuais →
fechamento (manual/cron) → FECHADA → pagamento → PAGA (imutável) | CANCELADA.

## 12. Estados do objeto (Fatura)

`ABERTA → FECHADA → PAGA` (+ `CANCELADA`). PAGA e CANCELADA são finais (PAGA imutável;
CANCELADA fora dos totais gerenciais).

## 13. Segurança

Slugs `financeiro.faturas.ler|criar|editar|imprimir|whatsapp|exportar|fechar|lancar`
(VET nível PROPRIO por padrão; FINANCEIRO conforme matriz). Proprietário só vê a
própria fatura.

## 14. Auditoria

Correções contabilizadas por fatura (contador + timestamp); remoção de item de origem
clínica decorre da exclusão auditada na origem (RN-G-002). Remoção manual de item exige
justificativa e grava EXCLUSAO/FATURA_ITEM no AuditLog (descrição do item, fatura e
competência, motivo, autor — na mesma transação do delete).

## 15. Integrações

Módulos clínicos (FKs), impressão/CSV, WhatsApp deep link. EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-12-001 | "A fatura deste período já está paga — operação bloqueada." | `FATURA_PAGA`. |
| MSG-12-002 | "Fatura fechada." / "Status atualizado." | Ações de status. |
| MSG-12-003 | "Item lançado na fatura de {mês}." | Lançamento manual. |
| MSG-12-004 | "Assistência mensal lançada." | Fechamento de mensalista. |

## 17. Tratamento de erros

EFA-00 §17 + código `FATURA_PAGA` em todas as mutações de fatura paga (aplicado também
às sincronizações vindas dos módulos clínicos).

## 18. Critérios de aceite (BDD)

```gherkin
Dado que a fatura de junho está FECHADA
Quando uma vacina é registrada em julho
Então o item entra na fatura ABERTA de julho (criada automaticamente).

Dado que a fatura está PAGA
Quando tento excluir o exame de origem de um item dela
Então a operação é bloqueada com FATURA_PAGA e o exame permanece intacto.

Dado que o proprietário é mensalista
Quando o fechamento ocorre duas vezes (manual e cron)
Então o item de assistência mensal aparece uma única vez.

Dado que editei o valor de um item existente
Quando consulto o relatório gerencial de faturas corrigidas
Então a fatura aparece com o contador de correções incrementado.
```

## 19. Casos de teste

Positivos: ciclo ABERTA→FECHADA→PAGA; lançamento pelos 3 atalhos do catálogo rápido;
CSV/impressão. Negativos: lançar em PAGA; status inválido. Limites: DIA_FIXO 31 em
fevereiro (clamp); 10º dia útil com feriado móvel. Segurança: proprietário acessando
fatura alheia → 403. Concorrência: fechamento manual simultâneo ao cron → estados
consistentes (transição única).

## 20. Requisitos não funcionais

EFA-00 §20. Recálculo de total transacional; cron diário único às 23:45.

## 21. Melhorias futuras

Meios de pagamento e conciliação; parcelas; envio automático da fatura por
WhatsApp/e-mail; multa/juros configuráveis.
