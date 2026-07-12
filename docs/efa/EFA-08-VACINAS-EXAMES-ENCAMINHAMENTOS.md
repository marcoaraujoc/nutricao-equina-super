# EFA-08 — Atendimento: Vacinas, Exames Clínicos e Encaminhamentos

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> Três submódulos do Atendimento que compartilham o mesmo shell (EFA-06 §8) e as mesmas
> regras de autoria/faturamento.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Vacinas, Exames Clínicos e Encaminhamentos |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Registrar aplicações de vacina (com baixa de lote), requisições de exames clínicos
(laboratorial, bioquímico, imagem, compra) e encaminhamentos a prestadores internos ou
externos — todos vinculados ao atendimento, lançados na fatura e auditáveis. O
encaminhamento interno também é o mecanismo que **concede acesso** do prestador ao
paciente (designação).

## 3. Escopo

**Inclui:** registro de vacina com lote/valor e status de reforço; requisições de exame
com catálogos por laboratório e por imagem; finalização de exame (fatura); exame de
compra (ficha própria — detalhes em EFA-15); encaminhamento EQUIPE/EXTERNO com
designação automática; impressão/compartilhamento de requisições; exclusões e
cancelamentos com justificativa.

**Não inclui:** estoque de vacinas (EFA-10); exames nutricionais (EFA-11); resenha
(EFA-15); catálogo de laboratórios (EFA-10 §7).

## 4. Glossário

EFA-00 §4. Específicos: **Lote de vacina** — lote do estoque de vacinas com doses
disponíveis e validade; **Reforço** — data prevista de revacinação que deriva o status;
**Designação** — acesso do prestador ao animal; **Requisição** — documento de exame
para coleta/execução externa.

## 5. Personas

Veterinário (registra/solicita), Gestor (finaliza/edita qualquer), Prestador (recebe
encaminhamentos; finaliza o que criou), Estagiário (leitura), Financeiro (consome
lançamentos).

## 6. Fluxo geral

Atendimento aberto → aba Vacina/Exames/Encaminhamento → registro vinculado à evolução
ativa → lançamento automático na fatura → (exames) finalizar quando resultado/execução
concluída → (encaminhamento interno) prestador ganha acesso ao animal até a conclusão.

## 7. Casos de uso

### UC-08-01 — Registrar vacina
- **Pré:** `atendimento.vacinas.criar`; animal selecionado.
- **Principal:** seleciona vacina do catálogo (medicamentos flag vacina) → seleciona
  **lote disponível** (exibe validade e valor por dose) → dose (1ª/2ª/3ª, reforço
  anual, dose única, revacinação), via, quantidade, valor, data de aplicação, data de
  reforço, observação → salvar → numeração `VC-XXXX`, baixa no lote, item na fatura.
- **Alternativos:** vacina avulsa (sem lote — texto livre); flag "fornecida pelo
  cliente" (sem baixa nem cobrança de produto).
- **Erros:** lote sem doses disponíveis; campos obrigatórios.
- **Pós:** status derivado VIGENTE/VENCIDA pela data de reforço; INATIVA quando
  excluída.
- **Regras:** RN-08-001..003.

### UC-08-02 — Excluir vacina
- Justificativa obrigatória → soft delete + **restaura doses ao lote** + remove item da
  fatura (bloqueado se fatura PAGA) → auditoria.

### UC-08-03 — Requisitar exame clínico
- **Pré:** evolução EM_ANDAMENTO (vínculo ao atendimento); `atendimento.exames.criar`
  **E** a permissão do tipo escolhido (ver RN-08-008): Laboratorial/Bioquímico →
  `exames.laboratorial.criar`; Imagem → `exames.imagem.criar`. Na UI, a aba de um tipo
  sem permissão nem aparece.
- **Principal (Laboratorial/Bioquímico):** escolhe laboratório → grupos de exame do
  catálogo (múltiplos por requisição) → tipo de amostra (11 tipos com tubo indicado),
  quantidade de amostras, data/hora da coleta, indicação clínica, observação.
- **Principal (Imagem):** catálogo dinâmico de grupos/exames por espécie.
- **Alternativo (Compra):** ficha de exame de compra (EFA-15) gera exame tipo "Compra".
- **Pós:** requisição PENDENTE; impressão e compartilhamento (e-mail/WhatsApp).

### UC-08-04 — Finalizar / editar / excluir exame
- **Finalizar:** status → CONCLUIDO + item na fatura (regra de autoria RN-G-004).
- **Editar:** apenas autor/gestor (RN-G-003); sincroniza descrição do item de fatura.
- **Excluir:** justificativa obrigatória → soft delete + sincroniza fatura (bloqueio
  `FATURA_PAGA`) → auditoria.

### UC-08-05 — Criar encaminhamento
- **Pré:** `atendimento.encaminhamentos.criar`.
- **Principal (EQUIPE):** lista prestadores (cargo FORNECEDOR) das equipes do animal,
  com especialidade (do cadastro de fornecedor) e badge "já tem acesso" → seleciona →
  especialidade, motivo, urgência (NORMAL/ALTA/URGENTE) → criar → **designação criada/
  reativada automaticamente** + item na fatura.
- **Alternativo (EXTERNO):** destino em texto livre (sem designação).
- **Pós:** encaminhamento PENDENTE; prestador interno passa a ver o animal.

### UC-08-06 — Concluir / cancelar / excluir encaminhamento
- **Concluir (finalizar):** CONCLUIDO (autoria RN-G-004) → **encerra a designação**.
- **Cancelar:** justificativa obrigatória → CANCELADO → encerra designação → auditoria.
- **Excluir:** justificativa obrigatória → soft delete + remove item de fatura +
  encerra designação → auditoria.
- **Editar:** somente PENDENTE (campos textuais).

## 8. Especificação das telas

**Aba Vacina:** formulário com combobox de vacina, select de lote (validade + valor/
dose + doses restantes), campos de dose/via/valores/datas; lista com filtros por status
(VIGENTE/VENCIDA/INATIVA) e busca; impressão de comprovante.

**Aba Exames:** seletor de tipo (Laboratorial/Bioquímico/Imagem/Compra); painel de
grupos por laboratório (checkboxes por grupo, campos de amostra), ou árvore de exames
de imagem por espécie; lista de requisições com status, ações finalizar/editar/excluir/
imprimir/compartilhar; `ModalJustificativa` na exclusão.

**Aba Encaminhamento:** toggle destino EQUIPE/EXTERNO; cards de prestadores com
especialidade e badge de acesso; formulário motivo/urgência; lista com status e ações
(concluir/cancelar/excluir/imprimir); toast informativo "acesso liberado ao prestador"
na criação.

Estados: sem evolução ativa (exames/encaminhamento orientam a abrir atendimento); sem
prestadores na equipe (estado vazio com orientação ao gestor); lote esgotado
(desabilitado no select).

## 9. Especificação dos campos (destaques)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Lote (vacina) | referência estoque | Não (avulsa) | apenas lotes com doses > 0; mostra validade/valor. |
| Dose (vacina) | enum | Sim | 1ª/2ª/3ª, reforço anual, dose única, revacinação. |
| Data de reforço | data | Não | deriva status VIGENTE/VENCIDA. |
| Tipo de amostra | enum (11) | Sim (laboratorial) | com tubo indicado. |
| Urgência | enum | Sim | NORMAL/ALTA/URGENTE. |
| Prestador | referência membro FORNECEDOR | Sim (EQUIPE) | especialidade via cadastro de fornecedor. |
| Destino externo | texto | Sim (EXTERNO) | livre. |
| Justificativa | texto ≥3 | Sim (excluir/cancelar) | RN-G-002. |

## 10. Regras de negócio

**RN-08-001 — Vacina com lote dá baixa imediata.** O registro debita a dose do lote e
lança na fatura; exclusão restaura a dose e remove o item (bloqueio `FATURA_PAGA`).
Motivo: estoque de vacina é por dose; consistência estoque×fatura.

**RN-08-002 — Vacina do cliente não movimenta estoque/fatura de produto.** Igual à
prescrição (RN-07-007).

**RN-08-003 — Vacina não tem fluxo de rascunho.** Registro direto (sem `status` de
finalização); regras de autoria de edição dependem de evolução futura do modelo
(*limitação conhecida*).

**RN-08-004 — Exame vinculado ao atendimento.** Criação exige evolução EM_ANDAMENTO;
autoria sempre registrada (`veterinarioId = usuário logado`, inclusive prestador).

**RN-08-005 — Encaminhamento interno concede acesso.** Criar → designação
ativa; concluir/cancelar/excluir → designação encerrada (`dataFim`). Motivo: acesso do
prestador é temporário e auditável, pelo período do serviço.

**RN-08-006 — Justificativa obrigatória.** (= RN-G-002) em excluir vacina, excluir
exame, cancelar/excluir encaminhamento.

**RN-08-007 — Sincronização com fatura.** (= RN-G-008) para os três submódulos.

**RN-08-008 — Controle por tipo de exame (RBAC).** Além do slug geral
`atendimento.exames.*`, criar/editar/excluir exige a permissão do **tipo**:
Laboratorial e Bioquímico → `exames.laboratorial.*`; Imagem → `exames.imagem.*`; Compra
não tem módulo próprio (vale só o geral). O nível do tipo é resolvido em runtime (o tipo
vem do body/registro) e combina com o slug geral — o mais restritivo vence. Motivo:
permitir que uma equipe deixe, por exemplo, o técnico lançar exames de imagem mas não
laboratoriais. Antes de 2026-07-10 esses slugs eram órfãos (não controlavam nada).

## 11. Fluxograma (encaminhamento interno)

Criar → designação ativa + fatura → prestador atende (vê o animal, registra evolução
própria) → concluir/cancelar → designação encerrada → prestador perde acesso.

## 12. Estados do objeto

**Vacina:** VIGENTE → VENCIDA (por data de reforço); qualquer → INATIVA (exclusão).
**Exame:** `PENDENTE → CONCLUIDO`; qualquer → excluído (soft). **Encaminhamento:**
`PENDENTE → CONCLUIDO | CANCELADO`; qualquer → excluído (soft). **Designação:**
`ativa → inativa` (espelha o encaminhamento).

## 13. Segurança

Slugs `atendimento.vacinas|exames|encaminhamentos.*` **e** `exames.laboratorial|imagem.*`
(controle por tipo, RN-08-008); autoria 100% RBAC (RN-G-003/004 — nível PROPRIO vs
EQUIPE/FULL, sem regra de cargo fixa no backend, exceto ADMIN); prestador só enxerga o
paciente enquanto a designação está ativa (deny-by-default RN-G-007).

## 14. Auditoria

Exclusões/cancelamentos no AuditLog com motivo (entidades VACINA, EXAME_CLINICO,
ENCAMINHAMENTO); `motivoInativacao` na vacina; designações com `dataFim`.

## 15. Integrações

Fatura (EFA-12); estoque de vacinas (EFA-10); catálogos de laboratório/imagem (EFA-10);
compartilhamento por e-mail/WhatsApp (deep link); impressões (`ExamePrint`).

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-08-001 | "Lote sem doses disponíveis." | Seleção de lote esgotado. |
| MSG-08-002 | "Vacina registrada — VC-XXXX." | Registro ok. |
| MSG-08-003 | "É obrigatório informar o motivo da exclusão" | RN-G-002. |
| MSG-08-004 | "Acesso liberado ao prestador {nome} para este animal." | Encaminhamento interno criado. |
| MSG-08-005 | "Apenas encaminhamentos pendentes podem ser editados" | Edição bloqueada. |
| MSG-08-006 | "Exame finalizado e lançado na fatura." | Finalizar. |
| MSG-08-007 | "A fatura deste período já está paga — operação bloqueada." | `FATURA_PAGA`. |

## 17. Tratamento de erros

EFA-00 §17 + código `FATURA_PAGA`. Falha no envio de compartilhamento não desfaz a
requisição (best-effort).

## 18. Critérios de aceite (BDD)

```gherkin
Dado que registrei uma vacina com lote selecionado
Quando confirmo o registro
Então o lote perde as doses aplicadas e a fatura do proprietário ganha o item.

Dado que excluí a vacina informando o motivo
Quando consulto o lote e a fatura
Então as doses foram restauradas e o item removido (se a fatura não estiver paga)
E a Auditoria registra a exclusão com o motivo.

Dado que criei um encaminhamento para um prestador da equipe
Quando o prestador faz login
Então ele vê o animal na lista de pacientes
E ao concluir o encaminhamento ele perde esse acesso.

Dado que tento editar um encaminhamento CONCLUIDO
Então a edição não está disponível.
```

## 19. Casos de teste

Positivos: vacina com lote e avulsa; requisição com 2 grupos de laboratório; ciclo
completo do encaminhamento interno. Negativos: excluir sem motivo (400); finalizar
exame de outro autor sem ser gestor; encaminhar sem prestador/destino. Limites: lote
com exatamente as doses da aplicação; 11º tipo de amostra. Segurança: prestador
acessando animal após conclusão → 403. Concorrência: duas aplicações simultâneas do
mesmo lote com saldo para uma → segunda falha por doses insuficientes.

## 20. Requisitos não funcionais

EFA-00 §20.

## 21. Melhorias futuras

Status/finalização em vacina (workflow rascunho→aplicada); resultados de exame anexados
à requisição (hoje o resultado fica na evolução/mídias); agenda de reforços com
lembretes automáticos; integração laboratorial (envio eletrônico da requisição).
