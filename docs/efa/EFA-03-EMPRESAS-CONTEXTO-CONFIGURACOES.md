# EFA-03 — Empresas, Contexto Ativo e Configurações da Empresa

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Empresas, Contexto Ativo e Configurações |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial (inclui WhatsApp da empresa, 2026-07-10). |

## 2. Objetivo

Estruturar o multi-tenant: empresas (CNPJ ou pessoais/CPF), equipes, seleção do
contexto de trabalho da sessão e configurações operacionais da empresa (logotipo, regra
de fechamento de fatura, WhatsApp). Permite que um mesmo profissional atue com papéis
diferentes em organizações diferentes sem contas separadas.

## 3. Escopo

**Inclui:** criação/setup de empresa e equipe; múltiplas empresas por gestor; seletor
de contexto ativo; resolução de escopo por request; configurações da empresa (logo,
fechamento de fatura, WhatsApp); renomear equipe; EquipeManager (visão ADMIN).

**Não inclui:** permissões e membros (EFA-02); fechamento de fatura em si (EFA-12);
envio/recebimento de mensagens WhatsApp (não implementado — apenas armazenamento do
número).

## 4. Glossário

EFA-00 §4. Específicos: **Empresa pessoal** — `cnpj null`; o trabalho é organizado por
equipe (1 opção de contexto por equipe). **Setup** — fluxo que garante empresa + equipe
padrão + MembroEquipe GESTOR para o dono.

## 5. Personas

GESTOR/dono (configura), ADMIN (visão global), demais perfis (consomem o contexto).

## 6. Fluxo geral

Assinatura/promoção a gestor → setup cria empresa + equipe padrão → gestor opera no
contexto; usuários multi-vínculo escolhem o contexto no Sidebar → todo request envia
`x-empresa-id`/`x-equipe-id` → backend valida o vínculo e resolve o escopo.

Alternativos: login limpa contexto salvo e escolhe automaticamente a opção com cargo
GESTOR; header inválido é ignorado (fallback: MembroEquipe mais recente → empresa
própria).

## 7. Casos de uso

### UC-03-01 — Criar empresa/equipe (setup)
- **Pré:** usuário VETERINARIO (ou promovido).
- **Principal:** setup cria Empresa (nome, CNPJ opcional) + Equipe padrão +
  MembroEquipe GESTOR. Duplicidade: mesma (owner, nome, CNPJ) bloqueada; empresa
  pessoal exige (owner, nome) únicos (case-insensitive).
- **Regras:** RN-03-001, RN-03-002.

### UC-03-02 — Trocar contexto ativo
- **Pré:** mais de uma opção em `GET /equipes/meus-contextos`.
- **Principal:** seletor no Sidebar ("Empresa ativa"/"Equipe ativa") → seleciona opção
  (`"Nome · Cargo"`) → persiste em localStorage → **reload** da aplicação.
- **Pós:** permissões, listagens e escopo passam a refletir o novo contexto.
- **Regras:** RN-03-003, RN-03-004.

### UC-03-03 — Configurar a empresa
- **Pré:** GESTOR/dono do contexto ativo.
- **Principal:** `/configuracoes` → logotipo (upload comprimido no cliente; remoção
  opcional), regra de fechamento de fatura (4 opções: último dia do mês, primeiro dia
  do mês, dia específico 1–31, N-ésimo dia útil 1–10) e WhatsApp da empresa (máscara
  BR) → Salvar (multipart) → configuração única por empresa (CNPJ) ou por equipe
  (empresa pessoal).
- **Erros:** dia fora do intervalo → MSG-03-002; WhatsApp com menos de 10 dígitos →
  MSG-03-003.
- **Regras:** RN-03-005..007.

### UC-03-04 — Renomear equipe / visão ADMIN
- Gestor renomeia a equipe ativa; ADMIN acessa `/equipe-manager` com todas as empresas,
  equipes, membros e convites.

## 8. Especificação das telas

**Seletor de contexto (Sidebar):** dropdown exibido apenas com >1 opção; label
dinâmico; troca = reload.

**`/configuracoes` (GESTOR):** card central 3xl; widget de logotipo (quadro 32×32 com
câmera; preview imediato; link "Remover logotipo"); select "Fechamento da fatura" com
campo condicional (número 1–31 ou select 1º–10º dia útil) e hint contextual; campo
"WhatsApp da empresa" com ícone e máscara `(11) 98765-4321` + hint "Número usado para
enviar e receber mensagens... Deixe em branco para remover."; botão Salvar full-width.
Estados: carregando (spinner), salvando (botão desabilitado), acesso negado (página
padrão). Guard: `isGestor`; gating de fetch em `loadingPerms`.

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Validação / origem |
|---|---|---|---|
| Nome da empresa | texto | Sim | único por (owner, nome, CNPJ). |
| CNPJ | dígitos | Não | dígitos verificadores; BrasilAPI para razão social. |
| Logotipo | imagem | Não | comprimida no cliente (máx 1200px JPEG 82%); armazenada via StorageProvider (pasta `empresas/`). |
| Tipo de fechamento | enum | Sim | ULTIMO_DIA_MES \| DIA_FIXO \| DIA_UTIL (UI oferece "Primeiro dia do mês" = DIA_FIXO dia 1). |
| Dia (fechamento) | inteiro | Cond. | 1–31 (DIA_FIXO) ou 1–10 (DIA_UTIL). |
| WhatsApp | dígitos | Não | 10–15 dígitos (DDD+número, DDI opcional); vazio remove; persistido só dígitos. |

## 10. Regras de negócio

**RN-03-001 — Multiplicidade de empresas por gestor.** Um gestor pode possuir várias
empresas; duplicata = mesma (owner, nome, CNPJ). Motivo: profissionais com mais de uma
clínica. Exceção: empresa pessoal (CNPJ null) valida (owner, nome) na aplicação.

**RN-03-002 — Setup idempotente.** Garantir empresa+equipe+GESTOR sem duplicar em
re-execuções.

**RN-03-003 — Header de contexto validado.** `x-empresa-id`/`x-equipe-id` só são
aceitos se o usuário é membro/dono; inválido → fallback silencioso. Motivo: impedir
escopo forjado.

**RN-03-004 — Preferência de contexto no login.** Opção com cargo GESTOR vence; troca
manual vale só na sessão. Motivo: gestores caem direto na visão administrativa.

**RN-03-005 — Escopo da configuração.** Uma configuração por empresa (CNPJ) ou por
equipe (empresa pessoal) — mesmo critério do seletor de contexto. Motivo: espelhar a
unidade real de operação.

**RN-03-006 — Fechamento com clamp.** DIA_FIXO 31 em mês curto fecha no último dia;
DIA_UTIL desconta fins de semana e feriados nacionais (Sexta-feira Santa via algoritmo
de Gauss). Detalhes do cron: EFA-12.

**RN-03-007 — WhatsApp somente dígitos.** Normalizado no backend; 10–15 dígitos; string
vazia remove. Motivo: número utilizável por API de mensageria futura sem retrabalho.
Exceção: nenhuma. **Limitação atual:** o campo apenas armazena — não há envio/
recebimento de mensagens.

## 11. Fluxograma

Login → `meus-contextos` → escolhe padrão (GESTOR vence) → sessão opera com headers →
troca manual no Sidebar → localStorage + reload → novo escopo.

## 12. Estados do objeto

**Empresa/Equipe:** ativas (sem fluxo de arquivamento na UI atual). **Configuração:**
inexistente → criada no primeiro salvamento → atualizada (upsert). **Contexto da
sessão:** padrão → manual (até novo login).

## 13. Segurança

RN-03-003 é o pilar (anti-spoofing de tenant). Configurações: somente GESTOR/dono
(rotas `GET/PUT /api/equipes/configuracoes`). Upload de logo segue política global de
uploads (EFA-00 §13).

## 14. Auditoria

Sem trilha específica de alterações de configuração (*lacuna — melhoria futura:
auditar troca de logo/fechamento/WhatsApp*). Ações administrativas de equipe aparecem
nos logs de permissão quando envolvem cargos (EFA-02 §14).

## 15. Integrações

BrasilAPI (CNPJ), ViaCEP (endereços), StorageProvider (logo). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-03-001 | "Configurações salvas com sucesso!" | PUT ok. |
| MSG-03-002 | "Para dia fixo, informe um número entre 1 e 31." / "Para dia útil, informe um número entre 1 e 10." | Validação fechamento. |
| MSG-03-003 | "WhatsApp inválido — informe DDD + número (10 a 15 dígitos)." | Backend. |
| MSG-03-004 | "WhatsApp incompleto — informe DDD + número." | Frontend pré-envio. |
| MSG-03-005 | "Já existe uma empresa com este nome/CNPJ." | Duplicidade. |

## 17. Tratamento de erros

EFA-00 §17. Específicos: falha de upload da logo mantém demais campos gravados? **Não**
— o PUT é único; falha retorna erro e nada é salvo (comportamento transacional do
endpoint).

## 18. Critérios de aceite (BDD)

```gherkin
Dado que sou gestor de duas empresas
Quando faço login
Então o contexto ativo é o de cargo GESTOR
E o seletor do Sidebar lista as duas opções com "Nome · Cargo".

Dado que salvei o WhatsApp "(11) 98765-4321"
Quando recarrego a tela de Configurações
Então o campo exibe o número mascarado
E o banco armazena apenas "11987654321".

Dado que configurei fechamento no 5º dia útil
Quando o 5º dia útil do mês chega (descontando feriados nacionais)
Então as faturas ABERTAS do escopo fecham automaticamente (ver EFA-12).

Dado que enviei x-equipe-id de uma equipe da qual não participo
Quando o backend processa o request
Então o header é ignorado e o escopo cai no meu vínculo válido mais recente.
```

## 19. Casos de teste

Positivos: setup; troca de contexto altera listagem de pacientes; upload+remoção de
logo. Negativos: WhatsApp 9 dígitos → 400; dia útil 11 → 400; PUT configurações por
não-gestor → 404/403. Limites: WhatsApp 10 e 15 dígitos; dia 1 e 31. Segurança: header
forjado (RN-03-003). Concorrência: dois gestores salvando configurações → upsert,
última escrita vence.

## 20. Requisitos não funcionais

EFA-00 §20. Troca de contexto por reload completo (aceitável; melhoria futura: troca
sem reload).

## 21. Melhorias futuras

Integração de mensageria WhatsApp; auditoria de configurações; arquivamento de
empresas/equipes; branding adicional (cores) nas impressões; troca de contexto sem
reload.
