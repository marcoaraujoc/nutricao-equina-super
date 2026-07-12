# EFA-07 — Atendimento: Prescrição e Execução (Enfermagem)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> Integra-se ao Estoque (EFA-10) e ao Financeiro (EFA-12).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Prescrição e Execução |
| Versão | 1.1 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: inicial. 1.1 (2026-07-10): reserva de estoque multi-lote FEFO ativada na finalização; justificativa obrigatória em cancelar/remover item. |

## 2. Objetivo

Formalizar a prescrição médica do animal (documento numerado com itens de medicamento/
procedimento), reservar o estoque necessário na finalização e controlar a administração
diária (execução) com baixa real de estoque e lançamento automático na fatura.
Elimina divergência entre o prescrito, o administrado, o estoque e o cobrado.

## 3. Escopo

**Inclui:** documento de prescrição (grupo) e itens; rascunho local; salvar+finalizar
unificado com verificação/reserva de estoque multi-lote (FEFO) e finalização forçada;
cancelamento e remoção de item com justificativa; execução diária (enfermagem) com
baixa FEFO, insumos de aplicação injetável e faturamento; impressão.

**Não inclui:** cadastro de medicamentos/procedimentos (EFA-10); regras de fatura
(EFA-12); evolução (EFA-06).

## 4. Glossário

EFA-00 §4. Específicos: **Grupo (PrescricaoGrupo)** — o documento `#0001` por animal;
**Posologia** — frequência (16 opções); **Janela do item** — `dataInicio` até
`dataInicio + duracaoDias`; **Dose do dia** — quantidade diária = dose × doses/dia;
**Medicamento do cliente** — item sem baixa/reserva de estoque; **Reserva** — EFA-00
§4/FEFO.

## 5. Personas

Veterinário (prescreve), Gestor (finaliza/cancela qualquer), Enfermeiro/Estagiário
(executam — `enfermagem.prescricao.executar`, EST tem EQUIPE por padrão), Prestador
(prescreve/finaliza só o próprio), Financeiro (consome lançamentos).

## 6. Fluxo geral

Evolução em andamento → montar itens (rascunho local) → **Salvar** (salva e finaliza se
tiver permissão; sem permissão fica SALVO) → verificação de disponibilidade agregada →
[insuficiente → alerta com detalhes → "Continuar mesmo assim"] → FINALIZADO + reservas
FEFO → execução diária pela enfermagem (baixa + fatura) → último dia → EXECUTADO.
Alternativos: cancelar (libera reservas); remover item (recalcula reservas); editar item
em execução apenas para os dias restantes.

## 7. Casos de uso

### UC-07-01 — Montar prescrição
- **Pré:** evolução EM_ANDAMENTO (criação vinculada ao atendimento);
  `atendimento.prescricoes.criar`.
- **Principal:** adicionar itens: medicamento do catálogo (combobox híbrida
  client/server com indicação de estoque) ou procedimento; dosagem + unidade (conversão
  L→mL/kg→g), via (restrita às vias do catálogo), frequência (16 posologias), hora de
  início (gera horários), duração (dias), data de início, observação, checkbox
  "Medicamento fornecido pelo Cliente". Reordenação drag-and-drop. Rascunho persistido
  em localStorage por animal+evolução.
- **Erros:** duplicidade de item no documento; campos obrigatórios por tipo.

### UC-07-02 — Salvar e finalizar (com estoque)
- **Principal:** botão **Salvar** único → cria/atualiza grupo → com permissão de
  finalizar: verificação de **disponibilidade agregada multi-lote** (soma dos lotes −
  reservas de outras prescrições) → OK → FINALIZADO + **reservas FEFO** distribuídas
  entre lotes + itens ATIVA.
- **Alternativo (insuficiente):** 409 `ESTOQUE_INSUFICIENTE` → modal de alerta com,
  por medicamento: necessário, disponível, total em estoque, reservado e a lista de
  reservas (animal + nº da prescrição) → "Continuar mesmo assim" reenvia com
  `forcarFinalizacao` (o restante fica reservado no último lote, podendo exceder o
  saldo físico — decisão consciente do usuário).
- **Alternativo (sem permissão):** apenas salva (status SALVO); gestor finaliza depois.
- **Regras:** RN-07-002..005.

### UC-07-03 — Cancelar grupo / remover item
- **Cancelar:** justificativa obrigatória → itens CANCELADA, grupo CANCELADO, reservas
  liberadas. Bloqueado se houve QUALQUER execução (`EXECUTADO`).
- **Remover item:** justificativa obrigatória; item executado não pode ser removido;
  em grupo finalizado, o status vira CANCELADO_PARCIALMENTE (ou CANCELADO se era o
  último) e as **reservas são recalculadas** com os itens restantes.

### UC-07-04 — Executar (enfermagem, `/execucao-prescricao`)
- **Pré:** grupo FINALIZADO/CANCELADO_PARCIALMENTE com janela cobrindo hoje; evolução
  do atendimento FINALIZADA; permissão `enfermagem.prescricao.executar`.
- **Principal:** lista de prescrições aptas do dia (busca/paginação) → marcar itens
  administrados → sistema debita a **dose do dia em FEFO** (um movimento SAÍDA por lote
  debitado; abate as reservas do grupo), lança consumo na fatura (valor pelo preço
  unitário de cada lote), registra executor e `executadoEm`; via injetável
  (IM/IV/SC/ID/EV) debita 1 seringa + 1 agulha (se houver estoque; sem bloquear) e
  lança na fatura.
- **Alternativos:** último dia de todas as janelas → grupo EXECUTADO + reservas
  remanescentes liberadas. Item de duração menor não é re-debitado.
- **Erros:** estoque do dia insuficiente (soma dos lotes) → 409 com alertas (bloqueia);
  evolução não finalizada → 400.

### UC-07-05 — Editar item em execução parcial
- Item já em execução só pode ser editado para os **dias restantes** (dataInicio vira
  hoje; duração = dias restantes). Item totalmente executado é imutável.

## 8. Especificação das telas

**Aba Prescrição (Atendimento):** formulário inline de item (combobox medicamento com
badge de estoque; campos por tipo), lista de itens do documento (drag-and-drop,
editar/remover), documentos anteriores com status e ações (visualizar, imprimir,
cancelar); modal de alerta de estoque (`AlertaEstoqueModal`) com detalhe por
medicamento e reservas; modal de cancelamento com justificativa; modal de remoção de
item (`ModalJustificativa`).

**`/execucao-prescricao`:** lista do dia com busca; visão do documento; checklist por
item com horários previstos pela posologia e dia atual (ex.: "dia 3 de 7"); impressão.
O mesmo modal de execução é reutilizado no Mapa de Atendimento (EFA-09).

Estados: rascunho local restaurado; salvando/finalizando (spinner); alerta de estoque;
grupo salvo aguardando finalização (badge âmbar com contagem).

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Tipo do item | enum | Sim | MEDICAMENTO \| PROCEDIMENTO. |
| Medicamento/Procedimento | referência catálogo | Sim | busca híbrida; vias restritas às do catálogo. |
| Dosagem | número + unidade | Sim (medicamento) | conversão kg↔g, L↔mL na comparação com estoque. |
| Frequência | enum (16) | Sim | 1x/dia, 12/12h, 8/8h, 6/6h, 4/4h, 1/1h, contínuo, dose única ("agora"), se necessário, SOS, 1x/2dias, 1x/3dias, 1x/semana, 1x/21dias, 1x/30dias, 1x/90dias. |
| Duração (dias) | inteiro ≥1 | Sim | define a janela do item. |
| Data de início | data | Sim | itens podem ter janelas distintas. |
| Hora de início | hora | Não | gera horários previstos. |
| Medicamento do cliente | boolean | Não | exclui o item de reserva/baixa/fatura de estoque. |
| Justificativa | texto ≥3 | Sim (cancelar/remover) | RN-G-002. |

## 10. Regras de negócio

**RN-07-001 — Prescrição nasce do atendimento.** Criação exige evolução EM_ANDAMENTO.
Motivo: rastreabilidade clínica. Exceção: visualização/edição de documentos antigos não
exige.

**RN-07-002 — Verificação agregada multi-lote.** Disponibilidade = Σ(qtd dos lotes
ativos) − Σ(reservas de outras prescrições). Um lote insuficiente **não bloqueia** se
outro cobre o restante. Motivo: estoque real da clínica é o conjunto dos lotes.

**RN-07-003 — Reserva FEFO na finalização.** O curso completo é reservado distribuído
entre lotes por validade (vence primeiro, reserva primeiro); faltando saldo com
`forcarFinalizacao`, o restante é reservado no último lote (pode exceder o físico).
Motivo: compromisso de estoque por paciente e alerta honesto de déficit.

**RN-07-004 — Execução debita FEFO e abate reservas.** Um movimento SAÍDA por lote
debitado; o valor da dose soma o preço unitário de cada lote; reservas do grupo são
abatidas na mesma proporção; último dia libera o remanescente. Motivo: custo correto
por lote e disponibilidade sem dupla contagem.

**RN-07-005 — Prescrição executada é imutável.** Qualquer execução bloqueia
cancelar/editar/remover o que foi executado (código `EXECUTADO`). Motivo: registro de
administração é fato clínico.

**RN-07-006 — Justificativa em cancelar/remover.** (= RN-G-002.) Motivo gravado em
`motivoCancelamento` e na Auditoria.

**RN-07-007 — Medicamento do cliente não movimenta estoque.** Sem reserva, baixa ou
lançamento de custo de estoque (o item clínico permanece no documento).

**RN-07-008 — Execução exige evolução finalizada.** A prescrição só entra na fila de
execução quando a evolução do atendimento está FINALIZADA (grupos legados sem evolução
continuam aptos).

## 11. Fluxograma

Montar itens → Salvar → [permissão finalizar?] não → SALVO (fim) / sim → verificar
disponibilidade → OK ou forçar → FINALIZADO + reservas FEFO → (diariamente) executar →
baixa FEFO + fatura + abate reserva → [último dia?] → EXECUTADO + libera remanescente.
Cancelar (a qualquer momento sem execução) → CANCELADO + libera reservas.

## 12. Estados do objeto

**Grupo:** `SALVO → FINALIZADO → EXECUTADO`; `SALVO|FINALIZADO →
CANCELADO`; remoção parcial em finalizado → `CANCELADO_PARCIALMENTE` (segue executável
nos itens restantes). **Item:** `RASCUNHO/SALVO → ATIVA → CANCELADA`; `executadoEm`
marca administração (trava).

## 13. Segurança

Slugs `atendimento.prescricoes.*` e `enfermagem.prescricao.executar`; autoria
(RN-G-003/004); FORNECEDOR cancela/finaliza apenas o próprio documento.

## 14. Auditoria

Cancelamento (CANCELAMENTO/PRESCRICAO) e remoção de item (EXCLUSAO/PRESCRICAO_ITEM) no
AuditLog com motivo; `motivoCancelamento` no grupo; executor e `executadoEm` por item;
movimentos de estoque imutáveis com descrição da dose.

## 15. Integrações

Estoque (EFA-10), Fatura (EFA-12 — itens rastreados por `prescricaoId`), impressão
(`PrescricaoPrint`). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-07-001 | "Adicione ao menos um item na prescrição" | Salvar vazio. |
| MSG-07-002 | Alerta de estoque: "Necessário X, disponível Y" + reservas por animal/prescrição | 409 finalizar. |
| MSG-07-003 | "Prescrição finalizada com sucesso" | Finalizar ok. |
| MSG-07-004 | "Esta prescrição já foi executada e não pode ser alterada ou cancelada." | code EXECUTADO. |
| MSG-07-005 | "É obrigatório informar o motivo do cancelamento/exclusão" | RN-G-002. |
| MSG-07-006 | "Prescrição cancelada. Estoque reservado liberado." | Cancelar ok. |
| MSG-07-007 | "A evolução do atendimento precisa estar finalizada para executar a prescrição." | Execução. |

## 17. Tratamento de erros

EFA-00 §17. Códigos de negócio: `ESTOQUE_INSUFICIENTE` (409 — modal), `EXECUTADO`
(400 — toast específica), `FATURA_PAGA` (400 — sincronização financeira bloqueada).

## 18. Critérios de aceite (BDD)

```gherkin
Dado que o medicamento tem lote A com 20 e lote B com 100 unidades
Quando finalizo uma prescrição que precisa de 50
Então a finalização é aceita
E as reservas ficam 20 no lote A e 30 no lote B (FEFO).

Dado que a disponibilidade agregada é menor que o necessário
Quando finalizo
Então recebo o alerta com necessário/disponível/reservas por prescrição
E posso continuar mesmo assim, com o déficit reservado no último lote.

Dado que a enfermagem executou a dose do dia
Quando consulto o estoque
Então há um movimento SAÍDA por lote debitado
E as reservas do grupo diminuíram na mesma proporção
E a fatura do proprietário recebeu o item com o valor da dose.

Dado que um item já teve execução
Quando tento cancelar o documento
Então a operação é bloqueada com a mensagem de prescrição executada.
```

## 19. Casos de teste

Positivos: curso de 7 dias com execução diária até EXECUTADO; item "agora" (dose
única); medicamento do cliente sem movimentação. Negativos: cancelar sem motivo;
executar com evolução em andamento; remover item executado. Limites: dose do dia
exatamente igual ao lote (zera e passa ao próximo no dia seguinte); duração 1 dia.
Segurança: fornecedor cancelando documento alheio → 403. Concorrência: duas
finalizações da mesma prescrição → segunda falha por status; duas execuções do mesmo
dia → itens já com `executadoEm` não são re-debitados (validar em teste).

## 20. Requisitos não funcionais

EFA-00 §20. Operações de estoque/fatura em transação única; rascunho local resiliente a
recarregamento.

## 21. Melhorias futuras

Registro por dose (horário efetivo de cada administração, não só por dia); dupla
checagem (dois profissionais) para controlados; impressão de etiquetas; prescrição
modelo (favoritos).
