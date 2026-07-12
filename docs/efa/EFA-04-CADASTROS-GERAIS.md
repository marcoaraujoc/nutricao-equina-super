# EFA-04 — Cadastros Gerais

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> Abrange: Cadastro Pessoal (onboarding), Proprietários, Tratadores, Fornecedores,
> Localizações e Usuários (ADMIN).

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Cadastros Gerais |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Manter os dados mestres de pessoas e locais que alimentam todos os módulos: quem é o
usuário (cadastro pessoal), quem são os clientes (proprietários), quem cuida dos
animais (tratadores), quem presta serviços/fornece produtos (fornecedores), onde os
animais vivem (localizações) e as contas da plataforma (usuários — ADMIN).

## 3. Escopo

**Inclui:** onboarding pós-registro com validação de CRMV; CRUD de proprietários com
mensalista; CRUD de tratadores; CRUD de fornecedores com vínculo a login; cadastro
global de localizações com registros SYSTEM/CLIENTE; CRUD de usuários (ADMIN) com o
formulário compartilhado `UsuarioFormModal`.

**Não inclui:** cadastro de animais (EFA-05); membros de equipe (EFA-02); catálogos
clínicos (EFA-10).

## 4. Glossário

EFA-00 §4. Específicos: **SYSTEM/CLIENTE** — origem do registro global (SYSTEM = criado
pelo ADMIN, imutável para os demais; CLIENTE = criado por usuário, escopado quando
aplicável); **Mensalista** — proprietário com assistência mensal contratada.

## 5. Personas

GESTOR/VET (cadastram clientes e apoio), SECRETARIA (cadastros operacionais), ADMIN
(usuários e localizações SYSTEM), PROPRIETARIO (edita o próprio cadastro pessoal).

## 6. Fluxo geral

Registro → Cadastro Pessoal (onboarding) → operação. Vet cadastra proprietários (ou o
proprietário se registra sozinho); fornecedores e tratadores são cadastrados pela
equipe; localizações são compartilhadas globalmente.

## 7. Casos de uso

### UC-04-01 — Completar cadastro pessoal (`/cadastro-pessoal`)
- **Principal:** nome, telefone, e-mail, endereço (CEP→ViaCEP), tipo (padrão
  Veterinário). Se veterinário: CRMV com **validação online no CFMV** (UF + número),
  espécies atendidas (multi) e subespecialidades.
- **Pós:** módulos desbloqueados (RN-G-009). Redirect: `/animais` no onboarding de
  proprietário; senão `/meus-animais`.
- **Erros:** CRMV inválido → mensagem; CFMV indisponível → orientação de tentar depois.

### UC-04-02 — CRUD de proprietários (`/cadastro/proprietarios`)
- **Principal (criar):** nome, CPF **ou** CNPJ (máscara + dígitos verificadores; CNPJ
  auto-preenche razão social via BrasilAPI), telefone obrigatório, e-mail, endereço via
  CEP, toggle **mensalista** → campo valor de assistência mensal, frequência de visitas
  (1–7×/semana). **Sem campo de senha** — cria conta com `Inicial_001` +
  `mustChangePassword` + e-mail de boas-vindas com a senha efetiva.
- **Alternativos:** editar; ativar/inativar (toggle); "Remover da empresa" (inativa
  apenas os animais do escopo da equipe ativa, preservando o usuário).
- **Escopo:** aparecem proprietários com animal ativo na(s) equipe(s) do contexto ou
  cadastrados diretamente pela equipe (segregação por `User.equipeId`).
- **Regras:** RN-04-002..004.

### UC-04-03 — CRUD de tratadores (`/cadastro/tratadores`)
- Nome, telefone, local de trabalho; ativo/inativo; escopo por empresa.

### UC-04-04 — CRUD de fornecedores (`/cadastro/fornecedores`)
- Documento (CPF/CNPJ) como primeira seção; nome, **e-mail e telefone obrigatórios**;
  tipo de serviço (especialidade). Registros SYSTEM (globais/legado) e CLIENTE
  (escopados à empresa ativa). Vínculo opcional a login (`Fornecedor.userId`, único) —
  estabelecido na inclusão do prestador como membro (EFA-02 UC-02-03).
- Tipos com papel especial: `Farmácia`/`Laboratório`/`Loja` aparecem como fornecedores
  de estoque (EFA-10).

### UC-04-05 — Localizações (`/cadastro/localizacoes`)
- Cadastro **global**: nome, tipo (haras, clube hípico, clínica, fazenda, canil, gatil,
  petshop etc. — cada tipo mapeia espécies compatíveis), CEP/endereço, responsável,
  telefone. ADMIN cria SYSTEM (imutável para os demais), edita e inativa qualquer;
  não-ADMIN cria CLIENTE (read-only depois de criado).
- Consumido pelo formulário do animal (combobox com criação inline — EFA-05).

### UC-04-06 — Usuários (`/usuarios`, ADMIN)
- CRUD completo via `UsuarioFormModal` (abas Dados/Endereço, CEP automático): perfil de
  acesso VETERINARIO/ESTAGIARIO/PRESTADOR/GESTOR; criação sem senha (padrão +
  `mustChangePassword`); edição com nova senha; telefone obrigatório;
  ativar/desativar; exclusão restrita a ADMIN.

## 8. Especificação das telas

Padrão de lista (EFA-00 §8): busca no topo, abas/filtro ativo-inativo, cards mobile /
tabela desktop (com `overflow-x-auto`), botão primário no cabeçalho, modal de
formulário. Formulários com CEP: campo CEP dispara busca e preenche
logradouro/bairro/cidade/UF editáveis.

Específicos: Proprietários — badge Mensalista; combo frequência de visitas.
Fornecedores — badge SYSTEM/CLIENTE; badge "vinculado a login". Localizações — filtro
por espécie via mapeamento de tipos; badge SYSTEM/CLIENTE. Usuários — coluna perfil e
status; ação de senha na edição.

## 9. Especificação dos campos (destaques)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| CPF/CNPJ | dígitos | Cond. | dígitos verificadores; máscara; CNPJ → BrasilAPI. |
| Telefone | dígitos | Sim (proprietário, fornecedor, usuário) | 10–11 dígitos. |
| Mensalista | boolean | Não | liga o campo Valor assistência (decimal ≥ 0). |
| Frequência de visitas | inteiro | Não | 1–7 (×/semana). |
| CRMV | UF + número | Sim (vet) | validação online CFMV. |
| Tipo de serviço | texto | Sim (fornecedor) | exibido em encaminhamentos. |
| Tipo de localização | enum | Sim | define espécies compatíveis. |

## 10. Regras de negócio

**RN-04-001 — Cadastro completo desbloqueia módulos.** (= RN-G-009.) Proprietário
também precisa de 1 animal. Motivo: dados mínimos de operação/cobrança.

**RN-04-002 — Criação de conta sem senha.** Proprietários e usuários criados por
terceiros recebem `Inicial_001` + troca obrigatória + e-mail de boas-vindas. Motivo:
o operador nunca conhece a senha definitiva do cliente.

**RN-04-003 — Escopo de proprietários por equipe.** Lista/edição restritas ao escopo
(animal ativo na equipe OU cadastro direto na equipe); legados sem equipe → empresa
toda. "Remover da empresa" não apaga o usuário — inativa os animais do escopo.

**RN-04-004 — Mensalista.** Toggle liga valor de assistência; o fechamento mensal lança
o item automaticamente (EFA-12). Exemplo: mensalista R$ 800 → item "Assistência
Veterinária Mensal" na fatura do mês.

**RN-04-005 — Fornecedor 1:1 com login.** `Fornecedor.userId` é único; vínculo a
cadastro já ocupado → 409. Motivo: especialidade e identidade consistentes.

**RN-04-006 — Localização SYSTEM é imutável para não-ADMIN.** CLIENTE é read-only após
criação (não-ADMIN não edita nem inativa). Motivo: cadastro global compartilhado —
edições livres afetariam todos os tenants.

**RN-04-007 — Baia única.** A baia do animal é única por (local + empresa/proprietário);
o mesmo número pode existir em locais distintos.

## 11. Fluxograma

Registro → Cadastro Pessoal → [vet] CRMV validado → módulos liberados → operação de
cadastros conforme permissão (`cadastro.*`).

## 12. Estados do objeto

Todos os cadastros: `ativo ⇄ inativo` (toggle; exclusões com justificativa quando
disponíveis). Conta de usuário: adicionalmente `mustChangePassword` (até a troca).

## 13. Segurança

Slugs `cadastro.proprietario|tratador|fornecedor|localizacao.*` com checkPermission em
todas as rotas; usuários: ADMIN (authorize). LGPD: CPF/CNPJ/endereço visíveis somente
no escopo da equipe; e-mail de boas-vindas contém senha temporária (trocada no primeiro
acesso).

## 14. Auditoria

Exclusões destes cadastros seguem RN-G-002. "Remover da empresa" (proprietário) exige
justificativa e grava EXCLUSAO/PROPRIETARIO no AuditLog (nome, contagem de animais
inativados no escopo, motivo, autor — na mesma transação). Alterações comuns não têm
trilha campo-a-campo (EFA-00 §14).

## 15. Integrações

ViaCEP, BrasilAPI, CFMV, e-mail de boas-vindas. EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-04-001 | "CPF inválido." / "CNPJ inválido." | Dígitos verificadores. |
| MSG-04-002 | "Não foi possível consultar o CNPJ — preencha os dados manualmente." | BrasilAPI indisponível. |
| MSG-04-003 | "CRMV inválido ou não encontrado no CFMV." | Validação CRMV. |
| MSG-04-004 | "Proprietário criado — enviamos um e-mail de boas-vindas com a senha inicial." | Criação. |
| MSG-04-005 | "Este fornecedor já está vinculado a outro usuário." | 409 vínculo. |
| MSG-04-006 | "Complete seu cadastro para acessar os módulos." | Banner de bloqueio. |

## 17. Tratamento de erros

EFA-00 §17. APIs públicas externas falham de forma silenciosa/informativa sem travar o
formulário.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que sou veterinário no onboarding
Quando informo um CRMV válido no CFMV
Então o cadastro é aceito e os módulos são liberados.

Dado que criei um proprietário mensalista com valor 800
Quando o fechamento do mês ocorre
Então a fatura dele contém o item "Assistência Veterinária Mensal" de R$ 800 (uma única vez).

Dado que sou usuário comum
Quando tento editar uma localização SYSTEM
Então a ação não está disponível e a API rejeita a tentativa.

Dado que digitei um CEP válido
Quando o campo perde o foco
Então logradouro, bairro, cidade e UF são preenchidos e permanecem editáveis.
```

## 19. Casos de teste

Positivos: fluxo completo de proprietário (criar → e-mail → primeiro login → troca de
senha); fornecedor vinculado a login exibindo especialidade no encaminhamento.
Negativos: CPF inválido; telefone ausente; vínculo duplicado de fornecedor. Limites:
frequência 1 e 7; valor assistência 0. Segurança: listagem de proprietários de outra
equipe vazia; edição de localização SYSTEM por não-ADMIN → 403. Concorrência: dois
operadores criando o mesmo CNPJ → segundo recebe duplicidade.

## 20. Requisitos não funcionais

EFA-00 §20.

## 21. Melhorias futuras

Trilha de alterações de cadastro; importação em lote de proprietários; deduplicação
assistida por CPF/CNPJ; edição de localização CLIENTE pelo criador com histórico.
