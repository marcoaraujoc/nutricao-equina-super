# EFA-09 — Agenda, Agendamentos e Mapa de Atendimento

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Agenda, Agendamentos e Mapa de Atendimento |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Organizar a rotina clínica: marcar atendimentos por animal/profissional, acompanhar o
dia de cada veterinário e dar ao gestor a visão operacional consolidada (Mapa de
Atendimento — home dos perfis clínicos). Conecta a agenda ao prontuário: iniciar um
agendamento abre a evolução já vinculada (numeração AG-XXXX).

## 3. Escopo

**Inclui:** agenda global mensal/diária; CRUD de agendamento (com voz/LLM); conflito de
horário; cancelamento com motivo; transferir dia entre profissionais; Minha Agenda
(dia do profissional); Mapa de Atendimento (indicadores + cronograma do dia);
agendamentos futuros no detalhe do animal.

**Não inclui:** evolução em si (EFA-06); execução de prescrição (EFA-07 — o modal é
reutilizado no Mapa); relatórios históricos (EFA-13).

## 4. Glossário

EFA-00 §4. Específicos: **AG-XXXX** — numeração do agendamento herdada pela evolução;
**Transferir dia** — mover todos os agendamentos AGENDADO de um profissional numa data
para outro profissional; **Cronograma** — linha do tempo do dia no Mapa.

## 5. Personas

Secretária/Recepção (marca), Veterinário/Estagiário (opera o dia), Gestor (visão e
remanejamento), Proprietário/Prestador (somente visualização dos agendamentos do
animal).

## 6. Fluxo geral

Marcar (manual ou por voz) → dia do atendimento → Iniciar pela Minha Agenda → evolução
vinculada (EM_ANDAMENTO) → finalizar evolução → agendamento FINALIZADO. Alternativos:
concluir direto (CONCLUIDO), cancelar com motivo, reagendar (cancela + cria novo),
transferir o dia.

## 7. Casos de uso

### UC-09-01 — Criar agendamento (`/agendamentos`)
- **Pré:** perfil gerenciador (ADMIN/VETERINARIO/ESTAGIARIO) com
  `atendimento.agendamentos.criar`.
- **Principal:** calendário mensal (marcadores por dia) → dia → horário (00h–23h) →
  animal, tipo (CONSULTA/VACINA/RETORNO/EXAME/PROCEDIMENTO), título, data/hora,
  veterinário responsável (membros da equipe), observação → salvar.
- **Alternativos:** **por voz** — ditado interpretado por LLM pré-preenche o
  formulário; conflito de horário do profissional → aviso (não bloqueia).
- **Erros:** data/hora inválida; animal sem acesso.

### UC-09-02 — Atualizar status
- AGENDADO → EM_ANDAMENTO (início da evolução) → FINALIZADO (finalizar evolução) ou
  CONCLUIDO (conclusão manual sem prontuário); AGENDADO → CANCELADO com **motivo
  obrigatório** (motivos pré-definidos + texto), registrado na observação e na
  auditoria (cancelamento).
- Reagendar = cancela o original (motivo automático "Reagendado para ...") + cria novo.

### UC-09-03 — Transferir dia
- Gestor seleciona data, profissional de origem e destino → todos os AGENDADO daquele
  dia migram. Erros: origem=destino; sem agendamentos no dia.

### UC-09-04 — Minha Agenda (aba do Atendimento)
- Lista do **dia** do profissional logado (exclui cancelados); botão **Iniciar** abre a
  evolução do animal vinculada (`?agendamentoId=`, persistido por animal em
  localStorage entre navegações/re-login); concluir/cancelar com motivo.

### UC-09-05 — Mapa de Atendimento (`/mapa-atendimento`)
- Home de VET/EST/ADMIN (redirect de `/`). Painéis: distribuição por localização
  (donut interativo), consultas do dia (agendado×concluído×cancelado, % progresso),
  prescrições (total/ativas), animais sem atendimento, **cronograma do dia**
  (agendamentos + execuções de prescrição; filtros por localização e veterinário;
  status AGENDADO/EM_ANDAMENTO/CONCLUIDO/FINALIZADO/EXECUTADO/CANCELADO/
  SEM_ATENDIMENTO; abre execução em modal e navega ao atendimento).

## 8. Especificação das telas

**`/agendamentos`:** calendário mensal com badges; painel diário por hora; modal de
criação/edição; modal de cancelamento com select de motivos; botão de voz com
indicador; ação Transferir dia. **Minha Agenda:** cards do dia com hora, animal, tipo,
status e ações. **Mapa:** grid de cards + cronograma; donut clicável filtra o
cronograma. Estados: dia vazio, conflito (aviso âmbar), carregando, sem permissão.

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Animal | referência | Sim | escopo do contexto. |
| Tipo | enum (5) | Sim | CONSULTA/VACINA/RETORNO/EXAME/PROCEDIMENTO. |
| Título | texto | Sim | descritivo curto. |
| Data/hora | datetime | Sim | agenda 00h–23h. |
| Veterinário | referência membro | Não | conflito gera aviso. |
| Motivo de cancelamento | enum + texto | Sim (cancelar) | pré-definidos; auditado. |

## 10. Regras de negócio

**RN-09-001 — Só perfis clínicos gerenciam.** PROPRIETARIO/FORNECEDOR apenas
visualizam. Motivo: agenda é operação interna.

**RN-09-002 — Cancelamento exige motivo.** (= RN-G-002) com motivos pré-definidos;
reagendamento gera motivo automático. Auditoria: CANCELAMENTO/AGENDAMENTO.

**RN-09-003 — Conflito avisa, não bloqueia.** Dois agendamentos no mesmo horário do
mesmo profissional são permitidos com alerta. Motivo: encaixes são rotina em clínica.

**RN-09-004 — Vínculo agenda↔prontuário.** Iniciar cria/retoma a evolução vinculada
(AG-XXXX); finalizar a evolução finaliza o agendamento; cancelar/excluir a evolução
devolve o agendamento a AGENDADO (EFA-06 RN-06-004).

**RN-09-005 — Exclusão com justificativa.** Soft delete auditado.

## 11. Fluxograma

Marcar → (dia) Iniciar → evolução EM_ANDAMENTO → finalizar → FINALIZADO. Desvios:
concluir manual; cancelar (motivo); transferir dia; reagendar.

## 12. Estados do objeto

`AGENDADO → EM_ANDAMENTO → FINALIZADO` | `AGENDADO → CONCLUIDO` | `AGENDADO →
CANCELADO` | qualquer → excluído (soft). Retrocesso EM_ANDAMENTO→AGENDADO quando a
evolução é cancelada/excluída.

## 13. Segurança

Slugs `atendimento.agendamentos.*` (colunas próprias no Controle de Acesso);
`verificarAcessoAnimal` em todas as operações; Mapa restrito a perfis clínicos.

## 14. Auditoria

Cancelamentos e exclusões no AuditLog com motivo (entidade AGENDAMENTO).

## 15. Integrações

LLM para agendamento por voz (degradação graciosa); modal de execução de prescrição
(EFA-07). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-09-001 | "Já existe agendamento para este profissional neste horário." | Conflito (aviso). |
| MSG-09-002 | "Informe o motivo do cancelamento." | RN-09-002. |
| MSG-09-003 | "Agendamentos transferidos para {profissional}." | Transferir dia. |
| MSG-09-004 | "Agendamento criado a partir do ditado — revise os campos." | Voz/LLM. |

## 17. Tratamento de erros

EFA-00 §17. Falha do LLM de voz → formulário em branco para preenchimento manual.

## 18. Critérios de aceite (BDD)

```gherkin
Dado um agendamento AGENDADO para hoje
Quando clico Iniciar na Minha Agenda
Então a evolução abre vinculada (numeração AG-)
E o agendamento passa a EM_ANDAMENTO.

Dado que cancelei um agendamento
Quando informo o motivo
Então o status vira CANCELADO, o motivo fica na observação
E a Auditoria registra o cancelamento.

Dado que sou PROPRIETARIO
Quando acesso os agendamentos do meu animal
Então vejo a lista sem botões de criação/edição.
```

## 19. Casos de teste

Positivos: ciclo agendar→iniciar→finalizar; voz preenchendo formulário; transferir dia.
Negativos: cancelar sem motivo; transferir com origem=destino; criar para animal sem
acesso. Limites: agendamento 23h; dois no mesmo horário (aviso). Segurança: proprietário
forjando POST → 403. Concorrência: iniciar o mesmo agendamento em duas abas → uma
evolução única (RN-06-001).

## 20. Requisitos não funcionais

EFA-00 §20. Mapa consolida em um endpoint (`/api/mapa-atendimento`) para carga única.

## 21. Melhorias futuras

Lembretes automáticos (WhatsApp/e-mail) ao proprietário; agenda recorrente; bloqueios
de agenda (férias); visão semanal.
