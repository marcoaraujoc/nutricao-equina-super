# EFA-01 — Autenticação e Conta

> Padrões globais (glossário, personas, segurança, mensagens, erros, RNFs):
> **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Autenticação e Conta |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente — reflete o sistema implementado |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Controlar o acesso à plataforma: registro, login (senha e Google), recuperação e troca
de senha, renovação de sessão e logout. Garante que apenas contas ativas e autenticadas
acessem dados, e que sessões sejam renovadas de forma transparente ao usuário.

## 3. Escopo

**Inclui:** registro de conta; login e-mail/senha; login/registro Google; esqueci minha
senha; reset de senha por token; troca de senha obrigatória; refresh automático de
token; logout (manual, por inatividade, por conta desativada); auditoria de sessão.

**Não inclui:** MFA/2FA; SSO corporativo; gestão de perfis e permissões (EFA-02);
gestão de usuários pelo ADMIN (EFA-04).

## 4. Glossário

Ver EFA-00 §4. Específicos: **Access token** — JWT de 24h enviado em `Authorization`.
**Refresh token** — JWT de 30d usado apenas em `/api/auth/refresh` (rotacionado a cada
uso). **mustChangePassword** — flag que bloqueia a navegação até a troca da senha padrão.

## 5. Personas

Todas (EFA-00 §5). O registro público cria apenas PROPRIETARIO ou VETERINARIO.

## 6. Fluxo geral

Registro → (login automático ou tela de login) → resolução do contexto → home por perfil.
Alternativos: login Google (conta nova → PROPRIETARIO); `mustChangePassword` →
`/alterar-senha` bloqueante; esqueci senha → e-mail com link `/#/reset-password?token=`.

## 7. Casos de uso

### UC-01-01 — Registrar conta
- **Objetivo:** criar conta nova.
- **Pré-condições:** nenhuma (público).
- **Fluxo principal:** usuário acessa `/register` → informa nome, e-mail, telefone
  (máscara), senha e o seletor "Você é..." (Veterinário — padrão — ou Proprietário) →
  submete → conta criada → autenticado → onboarding (Cadastro Pessoal, EFA-04).
- **Alternativos:** registro via Google → conta criada como PROPRIETARIO (fixo).
- **Erros:** e-mail já cadastrado → mensagem de duplicidade; senha < 8 → validação.
- **Pós-condições:** conta ativa; `userType` restrito a PROPRIETARIO/VETERINARIO
  (RN-01-002).
- **Regras:** RN-01-001, RN-01-002.

### UC-01-02 — Login por e-mail/senha
- **Fluxo principal:** `/login` → e-mail + senha (toggle olho) → `POST /api/auth/login`
  → JWT 24h + refresh 30d → resolve contexto (gestor vence) → home por perfil.
- **Alternativos:** `mustChangePassword=true` → redirect bloqueante a `/alterar-senha`.
- **Erros:** credenciais inválidas → mensagem genérica; conta desativada → 401;
  rate limit → MSG-G-007.
- **Pós-condições:** LOGIN registrado no AuditLog; contexto salvo em localStorage.

### UC-01-03 — Login/registro Google
- **Fluxo:** botão Google → `useGoogleLogin` (`prompt: 'select_account'`) → backend
  valida o `access_token` **no Google** antes de emitir JWT interno → segue UC-01-02.
- **Erros:** token inválido/expirado → erro exibido, login por senha disponível.

### UC-01-04 — Esqueci minha senha
- **Fluxo:** informa e-mail → `POST /api/auth/forgot-password` → **sempre 200 genérico**
  ("se houver conta, enviaremos o link") → e-mail com link tokenizado.
- **Regras:** RN-01-004 (não revelar existência de conta).

### UC-01-05 — Reset de senha
- **Fluxo:** link `/#/reset-password?token=` → nova senha (≥8) → confirmação → login.
- **Erros:** token expirado/inválido → mensagem e reenvio pelo UC-01-04.

### UC-01-06 — Troca de senha obrigatória
- **Pré-condições:** conta criada com senha padrão `Inicial_001`.
- **Fluxo:** qualquer navegação → interceptada para `/alterar-senha` → nova senha (≥8,
  diferente da padrão) → flag limpa → navegação liberada.

### UC-01-07 — Renovação de sessão e logout
- **Fluxo:** 401 em request → interceptor chama `POST /api/auth/refresh` → repete o
  request original (transparente). Logout: botão do Sidebar OU 5 min de inatividade OU
  conta desativada → revoga refresh no backend, limpa storage (token, refresh,
  `s2vet_empresa_id`, `s2vet_equipe_id`) → `/login`. LOGOUT auditado.

## 8. Especificação das telas

| Tela | Especificação |
|---|---|
| `/login` | Card central; campos E-mail e Senha (olho), botão Entrar, botão Google, links "Esqueci minha senha" e "Criar conta". Estados: carregando (botão com spinner), erro (toast). Página pública com scroll livre. |
| `/register` | Nome, E-mail, Telefone (máscara), Senha, seletor "Você é..." (Veterinário padrão / Proprietário), botão Google. |
| `/reset-password` | Nova senha + confirmação; feedback de token inválido. |
| `/alterar-senha` | Bloqueante (sem Sidebar); senha atual/nova/confirmação. |

Responsividade: layout de card único, funciona igualmente em mobile. Acessibilidade:
labels, foco no primeiro campo, submit por Enter.

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Validação |
|---|---|---|---|
| E-mail | texto | Sim | formato e-mail; único (registro). |
| Senha | texto oculto | Sim | ≥ 8 caracteres. |
| Nome | texto | Sim | não vazio. |
| Telefone | dígitos c/ máscara BR | Sim | 10–11 dígitos. |
| Você é... | seleção | Sim | VETERINARIO (padrão) \| PROPRIETARIO. |

## 10. Regras de negócio

**RN-01-001 — E-mail único por conta.** Motivo: identidade global. Mensagem: duplicidade
no registro. Exceção: nenhuma.

**RN-01-002 — Registro restrito a PROPRIETARIO/VETERINARIO.** Motivo: perfis
privilegiados (ADMIN, ESTAGIARIO, FORNECEDOR) só nascem por convite/criação
administrativa. Impacto: validação dupla (validator + controller); Google → PROPRIETARIO
fixo.

**RN-01-003 — Senha padrão exige troca.** Contas criadas por gestor/ADMIN sem senha
recebem `Inicial_001` + `mustChangePassword`; navegação bloqueada até trocar. Motivo:
nunca operar com senha conhecida por terceiros.

**RN-01-004 — Resposta genérica no esqueci-senha.** Sempre 200, inclusive em erro
interno. Motivo: não permitir enumeração de contas.

**RN-01-005 — Conta desativada não opera.** Qualquer request autenticado → 401. Motivo:
desligamento imediato de acesso.

**RN-01-006 — Logout por inatividade em 5 minutos.** Motivo: estações compartilhadas em
clínica. Exceção: nenhuma (valor fixo no frontend).

**RN-01-007 — Refresh com rotação.** Refresh token é JWT 30d verificado antes do lookup;
tokens legados falham e exigem novo login (uma única vez).

## 11. Fluxograma

`/login` → credenciais válidas? → não → mensagem/rate-limit → fim.
→ sim → `mustChangePassword`? → sim → `/alterar-senha` → troca → segue.
→ não → resolve contexto (GESTOR vence) → home por perfil (VET/EST/ADMIN:
`/mapa-atendimento`; PROPRIETARIO: `/`).

## 12. Estados do objeto (Sessão)

`Anônima → Autenticada → (Renovando ⇄ Autenticada) → Encerrada`
Transições: login (→Autenticada); 401+refresh ok (→Autenticada); refresh falha, logout,
inatividade, desativação (→Encerrada).

## 13. Segurança

Rate limit 20/15min em `/auth`; bcrypt nas senhas; validação server-side do token
Google; JWT_SECRET ≥32 chars; refresh verificado por assinatura. **Tokens em cookies
HttpOnly** (`s2vet_at`/`s2vet_rt`, `SameSite=Lax`, `Secure` em produção) — não legíveis
por JavaScript; o backend lê o cookie primeiro e aceita `Authorization: Bearer` só como
fallback. Login/refresh setam os cookies; logout os limpa e revoga o refresh no banco.
LGPD: EFA-00 §13.

## 14. Auditoria

LOGIN e LOGOUT gravados em `AuditLog` (usuário, e-mail, ação, timestamp, empresa e **IP
de origem** — derivado do request no servidor, respeitando `trust proxy`).

## 15. Integrações

Google OAuth (login), SMTP (reset de senha) — detalhes EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando | Ação |
|---|---|---|---|
| MSG-01-001 | "E-mail ou senha inválidos." | Credenciais erradas | Corrigir. |
| MSG-01-002 | "Se houver uma conta com este e-mail, enviaremos o link de recuperação." | Esqueci senha | Verificar e-mail. |
| MSG-01-003 | "A senha deve ter no mínimo 8 caracteres." | Validação | Corrigir. |
| MSG-01-004 | "Sua senha precisa ser alterada antes de continuar." | mustChangePassword | Trocar senha. |
| MSG-G-007 | (rate limit login) | 20 req/15min | Aguardar. |

## 17. Tratamento de erros

Padrão EFA-00 §17. Específicos: token de reset inválido → mensagem com CTA de reenvio;
falha do Google → fallback para login por senha.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que informei credenciais válidas
Quando efetuo login
Então recebo access e refresh tokens e sou direcionado à home do meu perfil
E o evento LOGIN é registrado na auditoria.

Dado que minha conta tem mustChangePassword
Quando tento navegar para qualquer rota interna
Então sou levado à tela de troca de senha e não consigo prosseguir sem trocá-la.

Dado que informei um e-mail inexistente no "esqueci minha senha"
Quando submeto o formulário
Então recebo a MESMA resposta de sucesso genérica de um e-mail existente.

Dado que fico 5 minutos sem interagir
Quando o tempo expira
Então sou deslogado e o contexto ativo é limpo do navegador.
```

## 19. Casos de teste

Positivos: login senha; login Google; refresh transparente em 401; reset por token.
Negativos: senha errada 21× em 15min → 429; token reset reutilizado → falha; conta
desativada → 401 em request autenticado. Limites: senha com 7 e 8 caracteres.
Segurança: refresh token adulterado → rejeitado antes do lookup; registro forjado com
`userType: ADMIN` → gravado como PROPRIETARIO/VETERINARIO. Concorrência: dois refresh
simultâneos → apenas o rotacionado permanece válido.

## 20. Requisitos não funcionais

EFA-00 §20. Específico: login < 2s; refresh imperceptível (< 500ms adicional).

## 21. Melhorias futuras

MFA/TOTP; registro de dispositivo por sessão; lista de sessões ativas com revogação
individual; política de senha configurável por empresa. (HttpOnly cookies e IP nos
eventos já implementados em 2026-07-10.)
