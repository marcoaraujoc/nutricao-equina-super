# EFA-02 — Controle de Acesso e Permissões (RBAC, Equipes e Convites)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)** (§13 Segurança é
> pré-requisito de leitura deste documento).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Controle de Acesso e Permissões |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Permitir que o ADMIN defina permissões globais imutáveis e que cada GESTOR configure,
por equipe, o que cada perfil/membro pode fazer em cada funcionalidade — incluindo a
gestão dos membros (convites, inclusão direta, cargos múltiplos, ativação) e do acesso
de prestadores a pacientes (designações). Elimina acessos indevidos e dá autonomia de
configuração sem intervenção do suporte.

## 3. Escopo

**Inclui:** matriz de permissões por perfil (níveis, deny), perfis customizados,
permissões individuais de fornecedor, permissões do perfil PROPRIETARIO, gestão de
membros (convite por e-mail, inclusão direta de fornecedor, multi-cargo,
ativar/desativar), convites (listagem/cancelamento), designações de prestador, logs de
auditoria de permissão, permissões globais do ADMIN (locked).

**Não inclui:** criação de empresas/equipes e contexto ativo (EFA-03); CRUD de usuários
ADMIN (EFA-04); autenticação (EFA-01).

## 4. Glossário

EFA-00 §4. Específicos: **MatrizPerfil** — template de níveis por (equipe, perfil,
slug); **PermissaoMembro** — nível individual por (equipe, usuário, slug); **locked** —
item da matriz definido pelo ADMIN, imutável para o gestor; **PermCheck** — checkbox de
3 estados (NENHUM → EQUIPE → NEGADO).

## 5. Personas

ADMIN (permissões globais), GESTOR (matriz e membros da própria equipe), demais perfis
(consumidores das permissões). PROPRIETARIO não é membro de equipe — perfil de sistema.

## 6. Fluxo geral

ADMIN define padrões globais (locked) → gestor cria/ajusta a matriz da equipe e inclui
membros → membros herdam a matriz do cargo ao entrar/trocar de cargo → em cada request,
o backend resolve o nível efetivo pelo contexto ativo → telas ocultam o que o nível não
permite.

**Modelo de resolução (ordem):**
1. ADMIN → bypass total. 2. Cargo GESTOR ou dono da empresa ativa → bypass na empresa
(exceto userType FORNECEDOR, coberto pelo MembroEquipe GESTOR criado no setup).
3. FORNECEDOR → `PermissaoMembro` (individual). 4. Demais cargos → `MatrizPerfil` do
cargo no contexto; multi-cargo usa a união dos cargos. 5. PROPRIETARIO → união das
matrizes `PROPRIETARIO` das equipes vinculadas aos seus animais, com **deny-wins**.

## 7. Casos de uso

### UC-02-01 — Configurar matriz de um perfil (GESTOR)
- **Pré:** GESTOR/dono no contexto ativo; desktop (aba é desktop-only).
- **Principal:** Controle de Acesso → aba *Matriz de Perfis* → seleciona o perfil →
  ajusta células (PermCheck 3 estados) por módulo/ação → "Aplicar ao perfil" propaga aos
  membros do cargo.
- **Alternativos:** criar perfil customizado (nome novo → matriz zerada); excluir perfil
  customizado sem membros.
- **Erros:** alterar item `locked` → bloqueado com cadeado (sem request); perfil padrão
  ou com membros não pode ser excluído.
- **Pós:** matriz gravada; `AuditoriaPermissao` registra cada mudança.
- **Regras:** RN-02-001..004.

### UC-02-02 — Definir permissões globais (ADMIN)
- **Principal:** aba *Permissões Globais* → matriz por userType
  (VETERINARIO/ESTAGIARIO/PROPRIETARIO) → itens marcados viram `locked=true` em todas as
  equipes (propagação).
- **Pós:** gestores veem cadeado nesses itens.

### UC-02-03 — Incluir membro na equipe
- **Principal (VET/EST/demais):** aba *Profissionais* → **Incluir Membro** → formulário
  (nome, e-mail, telefone obrigatórios; endereço opcional) → convite por e-mail com
  token → convidado aceita → vira membro com o cargo definido e herda a matriz.
- **Alternativo (FORNECEDOR):** inclusão **direta** (sem convite): seleciona um cadastro
  de fornecedor disponível (`ativo && !userId`) ou cria novo com tipo de serviço →
  vínculo `Fornecedor.userId` estabelecido (409 se o cadastro já pertence a outro login).
- **Erros:** e-mail já membro; convite duplicado pendente.
- **Regras:** RN-02-005, RN-02-006.

### UC-02-04 — Gerenciar membro
- Editar cargos (multi-cargo, badges), ativar/desativar usuário, editar dados/senha
  (gestor edita membros da própria equipe; **gestor não edita gestor**). Coluna *Perfis*
  mostra cargos locais (badges cheios) e perfis em outras equipes (atenuados, tooltip).

### UC-02-05 — Gerenciar acesso de prestador (designações)
- **Principal:** membro FORNECEDOR → botão **Gerenciar Acesso** → seleção dos animais
  que o prestador pode acessar → cria/inativa `DesignacaoPrestador`.
- **Observação:** encaminhamentos criam/encerram designações automaticamente (EFA-08).

### UC-02-06 — Gerenciar convites
- Aba *Convites*: lista com status Pendente/Aceito/Expirado/Cancelado; cancelar apenas
  PENDENTE não expirado.

### UC-02-07 — Consultar logs de permissão
- Aba *Logs de Auditoria*: quem alterou, alvo, nível anterior/novo, motivo, IP —
  registro imutável.

## 8. Especificação das telas — `/controle-acesso`

**Visão ADMIN (3 abas):** Permissões Globais · Profissionais (com seletor de equipe;
sem equipe → árvore de todas as empresas/equipes; convite de gestor por CNPJ com
BrasilAPI ou por equipe CPF) · Logs.

**Visão GESTOR (4 abas):** Matriz de Perfis (desktop-only; lista de perfis à esquerda
com contagem de membros; matriz à direita) · Profissionais (busca nome/e-mail, filtro
por perfil) · Convites · Logs.

**Colunas da matriz:** padrão VER / CRIAR / ALTERAR / EXCLUIR / FINALIZAR / IMPRIMIR.
Módulos com override: *Agendamento* e *Agenda* (VER/CONFIRMAR/REAGENDAR/TROCAR
PROF./CANCELAR e VER/EDITAR/CONCLUIR/TROCAR PROF./CANCELAR), *Farmácia*
(VER/CRIAR/ALTERAR/**AJUSTAR**/EXCLUIR/IMPRIMIR). Célula sem ação correspondente exibe
placeholder tracejado "Não disponível".

Estados: carregando, matriz vazia (equipe recém-criada usa seed), item locked
(cadeado), mobile (aba Matriz oculta com aviso). Mensagens: toasts de sucesso/erro por
célula ou por "Aplicar ao perfil".

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nível de permissão | enum | Sim | NEGADO/NENHUM/LEITURA/PROPRIO/EQUIPE/FULL; UI cicla NENHUM→EQUIPE→NEGADO. |
| Nome do perfil customizado | texto | Sim | único por equipe; não pode colidir com perfis de sistema. |
| E-mail do convidado | e-mail | Sim | não pode ser membro atual. |
| Cargo do membro | multi-seleção | Sim (≥1) | PROPRIETARIO proibido como cargo (RN-02-002). |
| Tipo de serviço (fornecedor) | texto | Sim (na criação) | especialidade exibida em encaminhamentos. |

## 10. Regras de negócio

**RN-02-001 — Deny-wins.** NEGADO em qualquer equipe vinculada bloqueia o módulo do
proprietário, mesmo com nível positivo em outra. Motivo: bloqueio explícito confiável.

**RN-02-002 — PROPRIETARIO é perfil de sistema.** Não pode ser atribuído como cargo de
membro nem excluído da lista de perfis. Motivo: proprietário não é membro de equipe;
suas permissões derivam dos vínculos dos animais.

**RN-02-003 — Itens locked são imutáveis para o gestor.** Motivo: piso de segurança
definido pela plataforma. Exceção: apenas o ADMIN altera (e a alteração propaga).

**RN-02-004 — Propagação da matriz.** Membro herda a matriz do cargo ao entrar ou
trocar de cargo; "Aplicar ao perfil" repropaga aos membros atuais. FORNECEDOR é
configurado individualmente (PermissaoMembro) — a matriz do cargo FORNECEDOR serve de
template inicial.

**RN-02-005 — Fornecedor entra por inclusão direta.** Sem convite por e-mail; exige
vínculo a um cadastro de fornecedor (novo ou existente sem login). Motivo: o cadastro
carrega a especialidade e o vínculo 1:1 evita contas duplicadas. Erro: cadastro já
vinculado → 409.

**RN-02-006 — Convite expira e é cancelável.** Apenas PENDENTE não expirado pode ser
cancelado; aceite de convite expirado é rejeitado.

**RN-02-007 — Gestor não edita gestor.** Motivo: evitar escalonamento horizontal;
somente ADMIN ou o próprio.

**RN-02-008 — Isolamento por empresa.** Toda rota `/equipes/:equipeId/...` valida que a
equipe pertence à empresa do requisitante (ADMIN, gestor da equipe ou dono).

**RN-02-009 — Enforcement duplo.** Ocultação no frontend nunca substitui o middleware:
toda rota protegida usa `checkPermission(slug, nívelMínimo)`.

**RN-02-010 — Autoria 100% dirigida pela matriz.** Regras de "quem pode editar/finalizar/
excluir o registro de outra pessoa" NÃO são hardcoded por cargo no backend — derivam do
**nível efetivo** do slug (`PROPRIO` = só o próprio; `EQUIPE`/`FULL` = qualquer da
equipe), via `req.permissaoNivel`. A **única** regra fixa no backend é o bypass de ADMIN.
Assim, "só o gestor finaliza uma evolução" é uma *configuração* da matriz (VET/EST com
`NENHUM` em finalizar), não código — o gestor pode conceder finalizar a qualquer perfil.
Motivo: todo o controle de acesso é governado pelo Controle de Acesso, sem exceções de
negócio embutidas.

## 11. Fluxograma

Gestor abre matriz → altera célula → backend valida (gestor da equipe? item locked?) →
grava MatrizPerfil → grava AuditoriaPermissao → propaga a membros (quando aplicável) →
membros recebem novo nível no próximo `minhas-permissoes`.

## 12. Estados do objeto

**Convite:** `PENDENTE → ACEITO | EXPIRADO | CANCELADO` (aceito cria MembroEquipe).
**Membro:** `ativo ⇄ inativo`; cargos editáveis. **Designação:** `ativa ⇄ inativa`
(dataFim marcada ao encerrar). **Item de matriz:** nível atual + flag locked.

## 13. Segurança

Este módulo É a segurança da aplicação — modelo completo em EFA-00 §13. Riscos
mitigados no código: rotas de permissão exigiam apenas autenticação (corrigido —
`autorizarGestorDaEquipe`); PROPRIETARIO tinha bypass total (corrigido —
`getNivelPermissaoProprietario`). LGPD: dados de membros restritos ao gestor da equipe.

## 14. Auditoria

`AuditoriaPermissao` (imutável): autor, alvo (perfil/membro), slug, nível anterior,
nível novo, motivo, IP, timestamp. Inclusões/remoções de membros não geram entrada
própria (*lacuna — melhoria futura*).

## 15. Integrações

E-mail (convites, com link `/#/equipe/convite/{token}`); BrasilAPI (convite de gestor
por CNPJ). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-02-001 | "Permissão atualizada." | Célula gravada. |
| MSG-02-002 | "Este item é definido pelo administrador e não pode ser alterado." | Item locked. |
| MSG-02-003 | "Convite enviado para {e-mail}." | Convite criado. |
| MSG-02-004 | "Este fornecedor já está vinculado a outro usuário." | 409 no vínculo. |
| MSG-02-005 | "Perfis com membros não podem ser removidos." | Exclusão de perfil. |
| MSG-02-006 | "Acesso do prestador atualizado." | Designações salvas. |

## 17. Tratamento de erros

EFA-00 §17. Específicos: 403 em rota `/equipes/:id` de outra empresa; convite expirado
no aceite → página pública com mensagem e orientação a pedir novo convite.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que sou GESTOR da equipe A e defini NEGADO em "atendimento.evolucoes.ler" para o perfil VETERINARIO
Quando um veterinário do cargo abre o Atendimento
Então a aba Evolução não carrega dados e a API responde 403.

Dado que o ADMIN marcou um item como global (locked)
Quando abro a matriz como gestor
Então o item aparece com cadeado e não aceita clique.

Dado que incluí um fornecedor por inclusão direta vinculado ao cadastro X
Quando o fornecedor faz login
Então ele vê apenas os animais com designação ativa
E sua especialidade exibida vem do cadastro X.

Dado que um proprietário tem animais nas equipes A (LEITURA) e B (NEGADO) para faturas
Quando ele acessa o módulo de faturas
Então o acesso é negado (deny-wins).
```

## 19. Casos de teste

Positivos: ciclo completo convite→aceite→herança de matriz; multi-cargo com união de
níveis. Negativos: gestor tentando editar outra equipe → 403; cargo PROPRIETARIO em
membro → rejeitado. Limites: perfil customizado duplicado; convite reenviado com
pendente ativo. Segurança: request direto a `PUT matriz` por membro comum → 403;
escalonamento gestor→gestor bloqueado. Concorrência: dois gestores editando a mesma
célula → última escrita vence, ambas auditadas.

## 20. Requisitos não funcionais

EFA-00 §20. Matriz usa gravação por célula (latência percebida < 500ms);
`minhas-permissoes` é cacheada por sessão de tela (hook `usePermissoes`).

## 21. Melhorias futuras

Auditoria de inclusão/remoção de membros; visão ADMIN com perfis globais na árvore de
empresas; templates de matriz reutilizáveis entre equipes; expiração configurável de
convites.
