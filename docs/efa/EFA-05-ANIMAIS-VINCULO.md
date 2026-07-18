# EFA-05 — Animais/Pacientes e Vínculo Veterinário

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Animais/Pacientes e Vínculo Veterinário |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Centralizar o cadastro do paciente e o relacionamento formal entre veterinário e animal
(vínculo com consentimento do proprietário), que é a chave de acesso ao prontuário.
Beneficia vets (carteira de pacientes), proprietários (controle de quem acessa os dados
do animal) e a clínica (segregação por equipe).

## 3. Escopo

**Inclui:** CRUD do animal; detalhamento com histórico unificado e agendamentos;
listagens por perfil (Meus Pacientes/Meus Animais); busca de paciente por nome;
fluxos de vínculo (P→V, V→P), desvinculo, troca de vet, cancelamento, vínculo direto;
notificações in-app e por e-mail dos vínculos.

**Não inclui:** registros clínicos (EFA-06/07/08); resenha (EFA-15); dieta (EFA-11).

## 4. Glossário

EFA-00 §4. Específicos: **VetAnimalSolicitacao** — registro único por par (animal, vet)
reutilizado nas transições; **Solicitante** — quem iniciou (se `solicitanteId ==
vetUserId`, foi o vet; senão, o proprietário); **Categoria NRC / tipo de exercício** —
parâmetros nutricionais do animal usados pela análise NRC (EFA-11).

## 5. Personas

Proprietário (dono do animal, autoriza vínculos), Veterinário (atende), Gestor/equipe
(escopo), Prestador (acesso via designação — EFA-02/08).

## 6. Fluxo geral

Proprietário (ou vet, criando o proprietário inline) cadastra o animal → define vet
responsável → fluxo de vínculo com consentimento → animal entra no escopo da
empresa/equipe do vet → atendimento. Alternativos: vet busca paciente já cadastrado e
solicita vínculo; proprietário troca/remove o vet; cancelamentos com rollback.

## 7. Casos de uso

### UC-05-01 — Cadastrar/editar animal (`/animais`)
- **Pré:** `animais.criar` nível EQUIPE (criação) / `animais.editar` (edição).
- **Principal:** preencher formulário (ver §9) → salvar. Foto comprimida no navegador.
  Localização via combobox global com criação inline (mini-modal nome+tipo).
  Proprietário selecionável ou criado inline pelo vet (EFA-04 RN-04-002).
- **Alternativos:** informar veterinário responsável dispara o fluxo de vínculo
  (UC-05-03/05); cadastro com vet já vinculado ao animal existente cria vínculo
  **adicional** sem solicitação (multi-vet); na edição, trocar o vet dispara TROCA_VET.
- **Erros:** baia duplicada no mesmo local/escopo (RN-04-007); campos obrigatórios.
- **Pós:** animal ativo, com `empresaId`/`equipeId` conforme contexto do vet.

### UC-05-02 — Consultar detalhamento (`/animal/:id`)
- Cabeçalho com foto e resumo (espécie com ícone 🐴/🐶/🐱/🐮, raça, idade, peso, baia,
  local, tipo de trabalho, proprietário, vet); painel **Histórico** unificado
  (evoluções, vacinas, exames, prescrições, encaminhamentos agrupados por atendimento,
  busca client-side, modal de detalhe por origem); painel **Agendamentos futuros**
  (somente visualização).

### UC-05-03 — Proprietário solicita vínculo (P→V)
- **Principal:** seleciona vet no formulário → `VINCULO PENDENTE` + e-mail ao vet
  (aceitar/recusar por token) → vet responde (dashboard, aba Pacientes ou link).
- **Alternativo:** 24h sem resposta → cron **auto-aceita**.
- **Pós (aceito):** vínculo ACEITO; animal recebe empresa/equipe do vet; proprietário
  notificado (polling 15s).

### UC-05-04 — Vet solicita vínculo (V→P)
- **Principal:** "Buscar Paciente" (por nome; desambiguação por proprietário) →
  "Solicitar Vínculo" → e-mail ao proprietário → proprietário Autoriza/Recusa em Meus
  Animais ou pelo link público `/#/proprietario/aprovar-vinculo`.

### UC-05-05 — Desvinculo e troca de vet
- **DESVINCULO:** proprietário remove o vet → registro vira `DESVINCULO PENDENTE` +
  e-mail ao vet ("Aceitar remoção"/"Manter meu acesso", 24h). Aceito ou expirado → vet
  perde acesso; recusado → restaura `VINCULO ACEITO`.
- **TROCA_VET:** com vínculo ativo, proprietário indica novo vet → `TROCA_VET PENDENTE`
  + e-mail ao vet atual. Aceite/24h → cria `VINCULO PENDENTE` para o novo vet (etapa
  2); recusa → restaura vínculo atual e notifica o proprietário.
- **Cancelamento:** proprietário cancela pendência com rollback por tipo (VINCULO →
  CANCELADO; DESVINCULO/TROCA_VET → restaura VINCULO ACEITO).

### UC-05-06 — Excluir animal
- Soft delete com **justificativa obrigatória** (RN-G-002); some das listagens,
  histórico preservado.

## 8. Especificação das telas

| Tela | Especificação |
|---|---|
| `/animais` (form) | Seções: identificação (nome, espécie→raça dependente, sexo, nascimento/idade, peso, altura, pelagem), manejo (categoria NRC, tipo de exercício, baia, localização combobox + criação inline, tratador), documentos (registro/passaporte, finalidade, seguradora), pessoas (proprietário c/ criação inline, veterinário responsável), foto (upload comprimido). |
| `/animal/:id` | Detalhamento (UC-05-02); mobile: painéis empilhados, histórico com busca. |
| `/animais-vet` (Meus Pacientes) | Cards/tabela; `SolicitacaoCard` no topo (pendências VINCULO âmbar / DESVINCULO vermelho / TROCA_VET laranja, com Aceitar/Recusar); botão "Buscar Paciente"; ações editar/desvincular. |
| `/meus-animais` (proprietário) | Cards com badge de status do vínculo; Autorizar/Recusar (V→P); cancelar solicitação própria (modal de confirmação). |
| `VetNotificationModal` | Modal bloqueante ao vet com solicitações recebidas (rastreio de vistos em localStorage). |

## 9. Especificação dos campos (principais)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome do animal | texto | Sim | busca por nome usa este campo. |
| Espécie / Raça | seleção dependente | Sim | catálogo seed. |
| Sexo | enum | Sim | macho/fêmea. |
| Nascimento ou idade | data/número | Um dos dois | idade derivada. |
| Peso | decimal | Não | > 0; usado pela análise NRC. |
| Categoria NRC / exercício | enum | Não | parametriza exigências NRC. |
| Baia | texto | Não | única por local+escopo (RN-04-007). |
| Localização | referência global | Não | combobox pesquisável; criação inline (nome+tipo). |
| Proprietário | referência | Sim | criação inline pelo vet. |
| Veterinário responsável | referência | Não | dispara fluxo de vínculo. |
| Foto | imagem | Não | compressão no cliente (máx. 1200px, JPEG 82%). |

## 10. Regras de negócio

**RN-05-001 — Vínculo exige consentimento.** Toda associação vet↔animal passa por
solicitação com aceite da outra parte (exceto vínculo direto interno). Motivo: dado
clínico é sensível; o proprietário controla o acesso.

**RN-05-002 — Auto-aceite em 24h.** Solicitação PENDENTE sem resposta é aceita pelo
cron. Motivo: não travar o atendimento por inércia; o e-mail alerta para a janela.
Exceção: cancelamento antes do prazo.

**RN-05-003 — Registro único por par.** Um `VetAnimalSolicitacao` por (animal, vet),
reutilizado nas transições (constraint única). Impacto: transições sempre atualizam o
mesmo registro; histórico de estados não é versionado (*limitação*).

**RN-05-004 — Multi-vet.** Um animal pode ter vários vets vinculados; cadastro com vet
adicional não exige solicitação quando iniciado pelo proprietário no formulário
(vínculo adicional); TROCA_VET aplica-se à troca do responsável na edição.

**RN-05-005 — Segregação de listagem por contexto (base × convidado).** A listagem
depende do papel do usuário na empresa **ativa** do seletor:
- **Empresa própria (usuário é dono/gestor = "base"):** vê o escopo da(s) equipe(s) +
  **todos os pacientes que trata** — ou seja, todos os seus vínculos diretos (VINCULO
  ACEITO), inclusive **co-tratados** que pertencem a outra empresa (um mesmo animal
  atendido por mais de um vet, cada um na sua empresa, aparece na base de ambos).
- **Empresa alheia (usuário é convidado — membro/fornecedor):** **isolamento estrito** —
  só os animais **daquela** empresa que ele pode tratar (escopo de equipe + vínculo
  direto a animal DA empresa + designação de fornecedora). Pacientes **exclusivos** de
  outra empresa (ex.: os do próprio vet) **não** vazam para este contexto.
- Animal de outra equipe da mesma empresa não aparece por escopo de equipe (aparece por
  vínculo direto quando é da empresa ativa). **PROPRIETARIO** vê os seus; **FORNECEDOR**
  (sem cargo de gestor no contexto) só os designados.

O multi-vet é representado por múltiplos registros `VetAnimalSolicitacao` (um por vet) —
não há campo de "vet principal" no animal; o animal pertence a uma única empresa
(`empresaId`), e a coexistência entre empresas é resolvida por esta regra de exibição.

**RN-05-006 — Vínculo aceito propaga tenant.** Ao aceitar, o animal recebe
`empresaId`/`equipeId` do contexto do vet. Motivo: segregação e permissões do
proprietário derivam daí.

**RN-05-007 — Recusa de TROCA_VET restaura o vínculo.** O registro volta a `VINCULO
ACEITO` (não fica RECUSADO) e o vet atual mantém acesso; proprietário é notificado.

## 11. Fluxograma (vínculo)

Solicitação criada → e-mail à contraparte → resposta em app/link → ACEITO (propaga
tenant) | RECUSADO (notifica) | 24h → auto-aceite → notificações por polling.

## 12. Estados do objeto

**Solicitação:** `PENDENTE → ACEITO | RECUSADO | CANCELADO`, com `tipo` VINCULO /
DESVINCULO / TROCA_VET comandando o significado (ver UC-05-05). **Animal:** `ativo ⇄
inativo` (soft delete c/ justificativa).

## 13. Segurança

Slugs `animais.*` (criar exige EQUIPE; desvincular PROPRIO). Acesso por ID validado por
`verificarAcessoAnimal` (mesma empresa exige equipe do contexto; vínculo direto garante
o paciente próprio). Links de e-mail com token de aprovação de uso único.

## 14. Auditoria

Exclusão de animal exige justificativa e grava EXCLUSAO/ANIMAL no AuditLog (motivo,
nome/espécie do animal, autor, empresa — na mesma transação do soft delete). Transições
de vínculo ficam no próprio registro (updatedAt) — sem trilha por transição (*melhoria
futura*).

## 15. Integrações

E-mails transacionais de vínculo (5 templates); polling in-app (15s proprietário / 30s
vet). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-05-001 | "Solicitação enviada ao veterinário/proprietário." | Criação de vínculo. |
| MSG-05-002 | "Vínculo autorizado!" / recusa com ícone (❌ vínculo, 🔒 desvinculo, 🔄 troca) | Resposta. |
| MSG-05-003 | "Aguardando sua aprovação" (badge) | V→P pendente. |
| MSG-05-004 | "Já existe um animal nesta baia neste local." | Baia duplicada. |
| MSG-05-005 | "Solicitação cancelada." | Cancelamento com rollback. |

## 17. Tratamento de erros

EFA-00 §17. Token de aprovação expirado → página pública informa e orienta novo fluxo.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que um proprietário indicou um vet para seu animal
Quando o vet não responde em 24 horas
Então o vínculo é aceito automaticamente e ambos são notificados.

Dado que um vet da equipe A da empresa X está no contexto da equipe A
Quando um animal pertence à equipe B da mesma empresa
Então o animal não aparece na listagem por escopo de equipe (aparece por vínculo direto se for da empresa ativa).

Dado que a vet Marina é dona/gestora da própria empresa e fornecedora convidada na empresa Laura
E um animal da Laura é co-tratado por ela (vínculo direto) e pelo vet principal da Laura
Quando ela seleciona o contexto "Laura" (convidada)
Então o animal aparece; e os pacientes exclusivos da empresa dela NÃO aparecem nesse contexto.

Dado o mesmo cenário de coexistência
Quando ela seleciona o contexto da própria empresa (base)
Então ela vê todos os pacientes que trata — os exclusivos dela E o animal co-tratado da Laura.

Dado que o proprietário iniciou uma TROCA_VET e o vet atual recusou
Quando consulto o vínculo
Então ele está VINCULO ACEITO com o vet atual e o proprietário recebeu a notificação.

Dado que excluí um animal com justificativa
Quando o gestor consulta a Auditoria
Então há um registro EXCLUSAO/ANIMAL com o motivo, o nome do animal e o autor.
```

## 19. Casos de teste

Positivos: P→V aceito manual e por cron; V→P via link público; troca de vet completa
(2 etapas). Negativos: resposta a solicitação de outro usuário → 403; baia duplicada.
Limites: animal sem nascimento e sem idade → validação. Segurança: acesso por ID de
animal de outra equipe → 403/404. Concorrência: aceite manual simultâneo ao cron →
estado final ACEITO único (registro único por par).

## 20. Requisitos não funcionais

EFA-00 §20. Polling limitado (15s/30s) apenas nas telas dos perfis interessados.

## 21. Melhorias futuras

Trilha de transições de vínculo; histórico de peso; transferência de proprietário;
exclusão de animal por escopo (hoje o soft delete é global — o animal some para todos,
inclusive o proprietário; alternativa por empresa seria desvincular/remover do escopo).
