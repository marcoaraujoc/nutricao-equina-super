# EFA-14 — Auditoria

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)** (§14 resume o
> modelo; aqui está a especificação completa).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Auditoria |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial (auditoria estruturada de exclusões/cancelamentos, 2026-07-10). |

## 2. Objetivo

Garantir que ações sensíveis — especialmente **toda exclusão ou cancelamento** — sejam
justificadas, imutáveis e consultáveis. Protege a clínica (conformidade, disputas com
clientes), o paciente (integridade do prontuário) e a plataforma (investigação de
incidentes).

## 3. Escopo

**Inclui:** registro estruturado de exclusões/cancelamentos com justificativa
obrigatória em toda a aplicação; tela de consulta (`/auditoria-geral`, Sidebar > Geral)
com filtros e paginação; auditoria de sessão (login/logout); auditoria de permissões
(EFA-02 §14); marcadores de correção (EFA-12/13).

**Não inclui:** trilha campo-a-campo de edições comuns (melhoria futura); logs técnicos
de infraestrutura (Winston — operacional).

## 4. Glossário

Todo evento registra o **IP de origem** (`AuditLog.ip`), derivado do request no servidor
(respeita `trust proxy`; nunca vem do corpo). Aplica-se a login/logout e a todas as
exclusões/cancelamentos.

EFA-00 §4. Específicos: **Categoria** — EXCLUSAO ou CANCELAMENTO; **Entidade** — o tipo
de registro afetado (EVOLUCAO, PRESCRICAO, PRESCRICAO_ITEM, EXAME_CLINICO,
EXAME_NUTRICIONAL, VACINA, ENCAMINHAMENTO, AGENDAMENTO, ESTOQUE_FARMACIA,
ESTOQUE_VACINA, MEDICAMENTO, PROCEDIMENTO, DIETA_ITEM, **ANIMAL, FATURA_ITEM,
PROPRIETARIO** — os três últimos adicionados em 2026-07-10); **Detalhes** — descrição
legível do registro no momento do evento (ex.: nome do medicamento, título da
evolução).

## 5. Personas

Gestor (consulta a empresa ativa), ADMIN (consulta global), demais perfis (geram
eventos ao excluir/cancelar; não consultam).

## 6. Fluxo geral

Usuário aciona exclusão/cancelamento → `ModalJustificativa` exige motivo (≥3
caracteres) → backend valida o motivo (400 sem ele) → executa a operação → grava o
evento estruturado no `AuditLog` (na mesma transação quando a operação é transacional)
→ gestor/ADMIN consulta na tela de Auditoria.

## 7. Casos de uso

### UC-14-01 — Registrar evento de exclusão/cancelamento (sistêmico)
- **Atores:** todos os módulos cobertos (ver §4 Entidades).
- **Fluxo:** operação destrutiva chega com `motivo` → helper central grava: usuário
  (id, nome, e-mail), empresa, categoria, entidade, id do registro, animal (quando
  aplicável), motivo, detalhes, timestamp, além do `action` legado legível.
- **Erros:** motivo ausente → 400 e **nada é executado**.
- **Regras:** RN-14-001..003.

### UC-14-02 — Consultar auditoria (`/auditoria-geral`)
- **Pré:** GESTOR/dono (empresa ativa) ou ADMIN (global, com filtro opcional por
  empresa). Demais perfis → 403.
- **Principal:** lista paginada (50/página, mais recentes primeiro) com filtros:
  categoria (todas/exclusões/cancelamentos), entidade (select), busca textual
  (motivo/detalhes/usuário), período (data inicial/final).
- **Pós:** somente leitura — sem edição ou exclusão de eventos.

### UC-14-03 — Auditoria de sessão (legado)
- LOGIN/LOGOUT gravados; tela `/auditoria` (legada) exibe acessos da sessão.

## 8. Especificação das telas

**`/auditoria-geral`** (Sidebar > Geral, visível a GESTOR/ADMIN): cabeçalho com título
e contagem; barra de filtros (selects de categoria e entidade, campo de busca, datas);
tabela desktop (Data/Hora · Ação · Tipo · Registro · Justificativa · Usuário · **IP**) e
cards mobile equivalentes (IP junto ao autor); paginação.
Estados: vazio ("Nenhum registro de auditoria"), carregando, sem permissão.

## 9. Especificação dos campos (evento)

| Campo | Tipo | Obrig. | Origem |
|---|---|---|---|
| Categoria | enum | Sim | EXCLUSAO \| CANCELAMENTO. |
| Entidade | enum (§4) | Sim | módulo de origem. |
| entidadeId | inteiro | Sim | id do registro afetado. |
| animalId | inteiro | Não | quando o registro pertence a um animal. |
| Motivo | texto ≥3 | Sim | digitado no ModalJustificativa. |
| Detalhes | texto | Não | descrição legível no momento do evento. |
| IP | texto | Não | IP de origem derivado do request (trust proxy). |
| Usuário / e-mail / empresa / timestamp | — | Sim | contexto do request. |

## 10. Regras de negócio

**RN-14-001 — Motivo obrigatório universal.** (= RN-G-002.) Nenhuma exclusão/
cancelamento coberto executa sem motivo. Motivação: responsabilização. Exceção: chave
`justificativa` na evolução (legado de payload — semanticamente idêntica).

**RN-14-002 — Evento imutável.** AuditLog não tem UPDATE/DELETE pela aplicação;
sobrevive à exclusão da empresa (sem FK). Motivação: valor probatório.

**RN-14-003 — Atomicidade.** Quando a operação principal é transacional, o evento entra
na mesma transação (ou tudo, ou nada). Motivação: nunca haver exclusão sem trilha.

**RN-14-004 — Escopo de consulta.** GESTOR vê a empresa ativa; ADMIN vê tudo (filtro
opcional por empresa); demais 403.

## 11. Fluxograma

Ação destrutiva → modal (motivo) → backend valida → executa + grava evento → consulta
filtrada pelo gestor.

## 12. Estados do objeto

Evento: criado (final — imutável).

## 13. Segurança

Endpoint de consulta com verificação de gestor/dono/ADMIN no backend (não confia no
frontend); eventos não expõem dados de outras empresas ao gestor; LGPD: motivo é texto
livre — orientar a não incluir dados sensíveis desnecessários (*política de uso*).

## 14. Auditoria

Este módulo É a auditoria. Autoavaliação: acesso à tela de auditoria não é logado
(*melhoria futura*).

## 15. Integrações

Nenhuma externa.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-14-001 | "É obrigatório informar o motivo da exclusão/cancelamento" | Backend, motivo ausente. |
| MSG-14-002 | "A justificativa é obrigatória e fica registrada na auditoria." | Hint do modal. |
| MSG-14-003 | "Nenhum registro de auditoria encontrado." | Lista vazia. |

## 17. Tratamento de erros

EFA-00 §17. Falha ao gravar o evento em operação transacional → rollback da operação
inteira (RN-14-003).

## 18. Critérios de aceite (BDD)

```gherkin
Dado que excluí um item de estoque com o motivo "vencido"
Quando o gestor filtra por categoria EXCLUSAO e entidade ESTOQUE_FARMACIA
Então o evento aparece com meu nome, o item, o motivo e a data/hora.

Dado que forjei um DELETE sem motivo direto na API
Quando o backend processa
Então recebo 400 e o registro permanece intacto.

Dado que sou VETERINARIO (não gestor)
Quando acesso /auditoria-geral
Então recebo acesso negado.

Dado que sou ADMIN
Quando consulto sem filtro de empresa
Então vejo eventos de todas as empresas.
```

## 19. Casos de teste

Positivos: evento para cada uma das 13 entidades cobertas; filtros combinados; paginação
além de 50. Negativos: motivo com 2 caracteres; consulta por perfil comum. Limites:
busca com termo presente só em `detalhes`; período de um único dia. Segurança: gestor da
empresa A não vê eventos da B. Concorrência: exclusões simultâneas geram eventos
distintos íntegros.

## 20. Requisitos não funcionais

EFA-00 §20. Índices por categoria/timestamp; consulta paginada.

## 21. Melhorias futuras

Log de acesso à tela de auditoria; exportação CSV; retenção configurável; trilha
campo-a-campo de edições. (IP nos eventos já implementado em 2026-07-10.)
