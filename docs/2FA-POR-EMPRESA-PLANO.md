# 2FA por empresa — levantamento

> # 🔴 REGRA DE TRABALHO — NADA FOI APLICADO
>
> Este documento é só **levantamento** (pedido explícito: "não aplique nada, só faça o
> levantamento e gere o contexto para uma nova sessão"). Nenhum schema, migration, rota
> ou componente foi tocado. É o ponto de partida para a sessão que for implementar —
> lida como o `docs/MULTI-TENANCY-PLANO.md` já é lido hoje.
>
> Mesma regra de sempre vale quando a implementação começar: migration é **gerada**
> (`--create-only`), nunca **aplicada**, sem autorização explícita do Marco.
>
> Levantamento feito em 2026-08-18 contra o código em `feature/mvp-v1.0`.

---

## 1. O pedido, em uma frase

Hoje "ligar o 2FA por e-mail" é um interruptor **único, global, do ADMIN da
plataforma** (`ConfiguracaoSeguranca`, linha `id=1`) — vale para toda empresa e todo
usuário ao mesmo tempo. O pedido é: cada **gestor** decide, **para a empresa dele**,
se o 2FA é exigido no login de quem trabalha/atende ali — sem abrir mão do
Multi-Tenant nem do RLS que já protege o resto do banco.

---

## 2. Estado atual (medido, com referência exata)

### 2.1 Onde a decisão é tomada hoje

```
backend/src/services/mfaService.js
  exigeMfa(user)                     ← única função que decide "pede código?"
  mfaHabilitadoGlobalmente()         ← lê ConfiguracaoSeguranca.mfaEmailAtivo (cache 30s)
```

Ordem de resolução atual (comentário no próprio arquivo, linha 27-31):
```
1. MFA_EMAIL_ENABLED=false no .env   → OFF, kill-switch de emergência, vence tudo
2. ConfiguracaoSeguranca.mfaEmailAtivo → chave do ADMIN (linha id=1, singleton)
3. User.mfaAtivo                      → exceção POR USUÁRIO (já existe, granular)
```

### 2.2 Onde isso é chamado — `backend/src/controllers/auth/UserController.js`

```js
async login(req, res) {
  // ...valida e-mail/senha...
  if (await acessoBloqueado(user)) return 403;      // linha 138

  if (await mfa.exigeMfa(user)) {                    // linha 143
    const { desafioId, emailMascarado } = await mfa.criarDesafio(user, req);
    return res.status(200).json({ mfaRequerido: true, desafioId, emailMascarado, ... });
    // NENHUM cookie é emitido aqui — a sessão só nasce em verificar2fa()
  }
  res.json(await emitirSessao(req, res, user));
}
```

🔴 **Achado central, o que muda tudo daqui pra baixo:** `routes/auth.js` (linhas 38-48)
mostra que `/login`, `/2fa/verificar` e `/2fa/reenviar` **não passam pelo middleware
`authenticate`**. Ou seja, no momento em que `exigeMfa(user)` decide se pede o código,
**não existe `req.empresaId` nenhum** — o usuário ainda não escolheu contexto (isso só
acontece DEPOIS do login, via `x-empresa-id`/`x-equipe-id`, e pode mudar a qualquer
momento na mesma sessão, sem novo login). Ver §4 — este é o ponto que qualquer proposta
de "2FA por empresa" precisa resolver primeiro.

### 2.3 Modelo de dados atual

```prisma
model ConfiguracaoSeguranca {              // schema.prisma:1515
  id              Int      @id @default(1) // singleton — sempre id=1
  mfaEmailAtivo   Boolean  @default(false)
  atualizadoPorId Int?
  ...
  @@map("tb_configuracao_seguranca")
}

model User {                                // schema.prisma:22
  ...
  mfaAtivo Boolean @default(true)           // exceção por usuário — já existe
}
```

`ConfiguracaoSeguranca` está classificada como **CONTROL_PLANE, sem RLS, por decisão**
(`backend/src/lib/tenancyMap.js:29` — junto de `users`, `tb_mfa_desafios`,
`tb_password_history`). Isso está **correto** hoje porque é literalmente global. Se
virar per-empresa, a tabela/coluna nova PRECISA nascer do lado tenant (RLS), não aqui.

### 2.4 Backend/frontend do controle atual (para inventário do que muda)

| Camada | Arquivo | O que faz |
|---|---|---|
| Service | `backend/src/services/mfaService.js` | `exigeMfa`, `mfaHabilitadoGlobalmente`, `obterConfigSeguranca`, `salvarConfigSeguranca`, cache de 30s |
| Controller | `backend/src/controllers/SegurancaController.js` | `GET/PUT /api/seguranca/config` — só ADMIN |
| Rota | `backend/src/routes/seguranca.js` | `authenticate, authorize('ADMIN')` nos dois verbos |
| Frontend | `frontend/src/components/CardSegurancaAdmin.tsx` | toggle único, chama `/seguranca/config`, mostra "vale para todas as empresas" |
| Onde mora | `ConfiguracaoAlerta.tsx` (rota `/configuracao-alertas`, ADMIN) | CLAUDE.md §14 documenta a razão de não estar em `Configuracoes.tsx`: `usePermissoes` não carrega nada pro ADMIN (`isGestor` fica false) |

---

## 3. Precedentes no código — a MESMA pergunta já foi resolvida 3 vezes

Isto é o achado mais importante do levantamento: o problema "preciso decidir algo
por-empresa ANTES de existir um `req.empresaId`, para um usuário que pode pertencer a
N empresas" **já apareceu três vezes** no multi-tenancy (fase 7 / RLS geral) e tem um
padrão estabelecido, testado e documentado. A implementação do 2FA por empresa deve
seguir o MESMO padrão, não inventar um novo.

### 3.1 `podeAcessarSistema` — a leitura "por userId" que atravessa empresas

`backend/src/lib/usuarioEmpresa.js:419-445`. Resolve "este usuário tem acesso ao
sistema em ALGUMA empresa?" — exatamente a mesma forma de pergunta que "este usuário
precisa de 2FA em ALGUMA empresa?".

```js
async function podeAcessarSistema(userId, client = prisma) {
  // roda sob comEscopoPlataforma() — levanta o filtro de tenant
  const rows = await comEscopoPlataforma(() => client.$queryRawUnsafe(`
    SELECT ue.acesso_sistema AND ${EMPRESA_ATIVA_SQL} AS liberado
      FROM schs2vet.tb_usuario_empresa ue
      JOIN schs2vet.tb_empresas e ON e.id = ue.empresa_id
     WHERE ue.user_id = $1          -- ⚠️ ISTO mantém a leitura restrita a ESTE usuário
    UNION ALL
    SELECT p.acesso_sistema AS liberado
      FROM schs2vet.tb_prestadores p
     WHERE p.user_id = $1
  `, ...));
  // sem vínculo nenhum → true (não tranca autônomo/legado)
  // ao menos um vínculo liberado → true
}
```

### 3.2 `meusContextos` — enumera TODOS os (empresa, equipe, cargo) do usuário

`backend/src/controllers/EquipeController.js:959-1050`. É a rotina que alimenta o
seletor de contexto. Já faz, com `comEscopoPlataforma` + `where: { userId }`, a
travessia completa: empresas próprias (`Empresa.ownerId`), vínculos de equipe
(`MembroEquipe`), e mais abaixo (não colado aqui) o bloco PROPRIETÁRIO (cliente em
empresas onde não tem papel profissional, via `ProprietarioPerfil`/`Animal` ativo).

**Isto é potencialmente reusável DIRETO**: a lista de `{empresaId, equipeId}` que o
2FA por empresa precisa varrer é, por definição, a MESMA lista que `meusContextos` já
calcula. Duas opções de design, ver §6.3.

### 3.3 O próprio `authenticate` (RLS em `tb_usuario_empresa`, 2026-08-06)

`docs/MULTI-TENANCY-PLANO.md`, §16.5 (linhas 1710-1774) — histórico real de quando
essa MESMA classe de problema apareceu para `tb_usuario_empresa` (que também é lida
"antes do tenant existir", pela resolução do header `x-empresa-id`). A "regra que
fica" (citação literal, é a política que qualquer coisa nova precisa seguir):

> **Toda leitura "por userId" que precise atravessar empresas** (seletor de contexto,
> verificação de pertencimento, gate de acesso do login) roda sob
> `comEscopoPlataforma` com `WHERE user_id` — nunca sob o carimbo de uma empresa (via
> só ela) nem sem carimbo (RLS devolve vazio). É o padrão para qualquer tela nova que
> liste "minhas empresas".

Isso resolve, de cara, a preocupação de "respeitar o Multi-Tenant e o RLS": **o
mecanismo para isso já existe e já foi provado** (pentest de 15 vetores, §16 do plano;
o caso real "Marina, profissional em 5 clínicas" documentado em §16.5).

### 3.4 `EmpresaConfiguracao` — o padrão de "configuração por empresa, editável pelo gestor"

`backend/prisma/schema.prisma:1848-1888`. Já existe, já tem RLS (`tb_empresa_configuracoes`
é **TENANT DIRETO**, migration `20260806180000_fase7_rls_geral` linhas 116-122:
`USING (app_empresa_id() IS NULL OR "empresaId" = app_empresa_id())`), e já guarda
várias flags exatamente deste feitio — nullable, "null = herda o padrão do sistema":

```prisma
model EmpresaConfiguracao {
  empresaId Int
  equipeId  Int?              // dual-key: empresa CNPJ usa só empresaId; empresa
                               // pessoal/CPF usa (empresaId, equipeId) — ver §5.2
  whatsapp  String?
  diasAtendimento String?     // null = sem restrição
  tempoConsultaPadraoMin Int? // null = usa TEMPO_CONSULTA_PADRAO_SISTEMA
  validadeOrcamentoDias  Int? // null = sem validade
  ...
  @@unique([empresaId, equipeId])
}
```

Backend que lê/grava: `EquipeController.obterConfiguracao`/`salvarConfiguracao`
(linhas 1109-1168 e 1233+), rota `GET/PUT /api/equipes/configuracoes`, gate
`resolverEscopoConfiguracao(req)` = GESTOR/dono da empresa **ativa** (do request, já
resolvida pelo `authenticate` — funciona porque quem CHAMA essa rota já está logado e
já tem contexto, diferente do login).

Frontend que edita: `frontend/src/pages/CadastroEmpresa.tsx` — **não é mais
`Configuracoes.tsx`** (essa tela foi absorvida no cadastro da empresa em 2026-08-17,
comentário na própria página: "Quem edita agora é o GESTOR da empresa ativa"). Gate:
`podeEditar = isGestor || isAdminPlataforma` (linha 173). Já tem seções de WhatsApp,
dias/horário de atendimento, etc. — é o lugar natural para o novo toggle.

⚠️ **CLAUDE.md ainda documenta a tela antiga `/configuracoes`** (§12/§13, mapa de
páginas) — está desatualizado nesse ponto, à parte deste levantamento.

---

## 4. O problema arquitetural central — precisa de decisão ANTES de codar

Sessão do S2Vet **não é presa a uma empresa**: o mesmo login (mesmo JWT) navega entre
todas as empresas às quais o usuário pertence, trocando só o header `x-empresa-id` a
cada request — sem novo login, sem novo 2FA. É por isso que `EmpresaContext`/seletor de
contexto existe. Duas consequências diretas para "2FA por empresa":

1. **No momento do login, o sistema ainda não sabe em qual empresa o usuário VAI
   trabalhar nesta sessão** (ele escolhe DEPOIS, e pode trocar quantas vezes quiser).
2. Um mesmo e-mail pode ser **gestor da empresa A** (2FA ligado), **veterinário da
   empresa B** (2FA desligado) e **cliente da empresa C** (2FA ligado) — tudo ao mesmo
   tempo, na mesma linha de `users`.

Duas famílias de solução, com trade-offs bem diferentes:

### Opção A — agregação no LOGIN (recomendada como ponto de partida)

Continua pedindo o 2FA (ou não) **uma vez, no login**, como hoje — mas a decisão passa
a olhar TODAS as empresas do usuário (via o padrão do §3.1/§3.2) e agrega por **OR**:
se QUALQUER empresa à qual ele pertence exige 2FA, o login pede o código. Mesmo
espírito do `NEGADO` deny-wins da MatrizPerfil (§4 do CLAUDE.md) — a postura mais
seguradora vence, nunca a mais permissiva.

- ✅ Não muda o modelo de sessão. Reaproveita 100% do fluxo de desafio já existente
  (`MfaDesafio`, e-mail, `Verificacao2FA.tsx`).
- ✅ Consistente com o padrão RLS já estabelecido (§3.1-3.3) — é literalmente o mesmo
  tipo de leitura, só que decidindo um booleano em vez de "pode acessar?".
- ⚠️ Efeito colateral que precisa ser EXPLICADO ao gestor na tela: ligar 2FA na SUA
  empresa também passa a exigir código de login para qualquer usuário que, além de
  estar na empresa dele, também acessa OUTRA empresa que não pediria — mesmo quando a
  pessoa entrar para trabalhar só nessa outra. É um efeito, não um bug: a pessoa É a
  mesma em ambas, e a política mais forte tem que valer sempre que ela pode alcançar a
  empresa protegida.
- ⚠️ Um usuário sem NENHUMA empresa vinculada (raro — talvez só ADMIN puro) cai no
  default global (`ConfiguracaoSeguranca`, vira "piso da plataforma").

### Opção B — 2FA como STEP-UP ao trocar de contexto (`x-empresa-id`)

Login normal sem 2FA; ao trocar para (ou abrir sessão já dentro d)e uma empresa que
exige 2FA, o backend recusa a troca de contexto até um segundo fator ser verificado
PARA aquela empresa especificamente.

- ✅ Precisão cirúrgica: só pede o código para quem realmente vai *usar* a empresa
  protegida, nunca para quem só passa por ela no seletor.
- 🔴 Mudança de modelo bem maior: hoje o header `x-empresa-id` é resolvido de forma
  síncrona e stateless dentro de `authenticate` (`auth.js`, linhas ~34-128, o mesmo
  trecho que o §16.5 do plano de multi-tenancy já teve que carimbar com
  `comEscopoPlataforma`)."step-up" precisa de um estado de sessão novo (algo como
  "esta sessão já verificou 2FA para a empresa X" — cookie/claim adicional, expiração
  própria, revalidação), UI nova (bloquear o app no meio da troca de contexto, não só
  no login), e reabre toda a superfície de ataque de sessão parcialmente autenticada
  que o `emitirSessao` único de hoje evita de propósito.
- Encaixa melhor num pedido do tipo "quero proteger só quem ENTRA nessa clínica
  específica", não no pedido atual ("o gestor liga pra empresa dele").

**Recomendação do levantamento:** Opção A. É o que o pedido descreve literalmente
("ficar ao cargo do gestor habilitar ou não para empresa dele"), reaproveita a
infraestrutura de 2FA e o padrão RLS já provados, e não introduz um segundo modelo de
autenticação parcial. B fica registrada para o caso de o produto realmente precisar da
precisão cirúrgica (decisão de negócio, não técnica — ver §8).

---

## 5. Modelo de dados proposto (não aplicado)

### 5.1 Novo campo em `EmpresaConfiguracao` (tenant direto, JÁ COM RLS)

```prisma
model EmpresaConfiguracao {
  ...
  // 2FA por e-mail no login — null = herda o padrão da PLATAFORMA
  // (ConfiguracaoSeguranca.mfaEmailAtivo). true/false = escolha explícita do gestor,
  // que VENCE o padrão da plataforma para quem pertence a esta empresa.
  mfaEmailAtivo Boolean? @map("mfa_email_ativo")
}
```

Mesmo padrão tri-state (`null` = herda) já usado em `tempoConsultaPadraoMin`,
`diasAtendimento`, `validadeOrcamentoDias` na mesma tabela — nenhuma novidade de
design, só mais um campo. **Não precisa de policy RLS nova**: a tabela já tem
`ENABLE + FORCE ROW LEVEL SECURITY` com `empresaId = app_empresa_id()`
(migration `20260806180000`, linhas 116-122). Uma coluna a mais não muda a policy.

### 5.2 A armadilha do dual-key (empresaId, equipeId)

`EmpresaConfiguracao` é única por `(empresaId, equipeId)` — empresa CNPJ usa
`equipeId: null`; empresa pessoal/CPF (o vet autônomo) configura **por equipe**. Isso
significa que "todas as empresas do usuário" (§3.2) não é suficiente sozinho: para
empresa pessoal, é preciso considerar CADA EQUIPE em que o usuário está, porque cada
equipe pode ter uma config de 2FA diferente dentro da "mesma" empresa pessoal.
`meusContextos` já resolve essa distinção linha a linha (ver `add()`, chave
`${empresaId}:${equipeId ?? ''}`) — a leitura do 2FA no login precisa da MESMA
granularidade, não só do `empresaId`.

### 5.3 `ConfiguracaoSeguranca` muda de papel, não desaparece

Passa a ser **"piso da plataforma" + kill-switch**, não mais "o único controle":

```
Ordem de resolução NOVA:
1. MFA_EMAIL_ENABLED=false (.env)         → OFF, vence tudo (kill-switch, mantém)
2. User.mfaAtivo === false                → OFF para ESTE usuário (mantém, ex.: ADMIN)
3. OR de EmpresaConfiguracao.mfaEmailAtivo
   por CADA (empresaId,equipeId) do usuário,
   caindo no passo 4 quando a empresa não   → decide por empresa (NOVO)
   tem escolha explícita (null)
4. ConfiguracaoSeguranca.mfaEmailAtivo      → piso da plataforma p/ quem não
                                               escolheu nada (era o passo 2 antigo)
```

Isto preserva 100% da superfície de segurança que existe hoje (kill-switch de
emergência do .env, exceção por usuário) e SÓ insere o novo passo 3 no meio.

---

## 6. Pontos de código a levantar/alterar (inventário, não plano de execução)

### 6.1 Backend — nova função de resolução

`mfaService.exigeMfa(user)` precisa parar de olhar só `ConfiguracaoSeguranca` e passar
a considerar as empresas do usuário. Sugestão de forma (não é código final — é o
formato que respeita o padrão do §3):

```js
// novo, mirando exatamente o SQL de podeAcessarSistema (§3.1):
// UNION de tb_usuario_empresa (profissional/gestor/proprietário) + tb_prestadores,
// join em tb_empresa_configuracoes por (empresa_id, equipe_id), sob
// comEscopoPlataforma() e WHERE user_id = $1, agregando BOOL_OR(COALESCE(cfg, ???)).
async function empresaAlgumaExigeMfa(userId) { ... }

async function exigeMfa(user) {
  if (user?.mfaAtivo === false) return false;
  if (await empresaAlgumaExigeMfa(user.id)) return true;    // NOVO
  return mfaHabilitadoGlobalmente();                        // piso, como hoje
}
```

⚠️ Ponto em aberto de PERFORMANCE: `mfaHabilitadoGlobalmente()` hoje cacheia 30s
porque roda em TODO login. A nova consulta por-empresa também roda em todo login e
não pode custar um join pesado sem cache — decidir se cacheia por `userId` (mais
memória, invalida em qualquer troca de vínculo/config — mais gatilhos de invalidação)
ou se aceita o custo (é 1 query indexada por `user_id`, provavelmente barata; medir).

### 6.2 Backend — endpoint do gestor

Estender `EquipeController.obterConfiguracao`/`salvarConfiguracao` (que já fazem
exatamente este tipo de leitura/escrita por `(empresaId, equipeId)` do contexto ATIVO)
com o campo novo. Não precisa rota nova — é mais um campo no mesmo payload de
`GET/PUT /api/equipes/configuracoes`, mesmo gate (`resolverEscopoConfiguracao`, GESTOR
da empresa ativa).

### 6.3 Backend — decisão de reuso: extrair ou duplicar a travessia?

Duas rotinas vão precisar "todas as (empresa, equipe) do usuário": `meusContextos`
(já existe) e o novo `exigeMfa`. Decidir explicitamente:

- **(a) Extrair** a parte de enumeração de `meusContextos` para uma lib compartilhada
  (ex. `lib/contextosUsuario.js`), reusada pelos dois. Mais DRY, mas acopla o hot-path
  do login à mesma query que monta labels/cargos que ele não precisa.
- **(b) Duplicar** uma consulta SQL mais enxuta, no mesmo espírito de
  `podeAcessarSistema` (que já é uma segunda cópia consciente do mesmo tipo de
  travessia, e o comentário da lib documenta por quê). Mais rápida no login, mais uma
  cópia da mesma regra ("quais empresas o user pertence") para manter sincronizada se
  o modelo de vínculo mudar de novo.

Este levantamento não fecha qual — é decisão de quem implementar, mas registrar que
`podeAcessarSistema` já tomou o caminho (b) é o precedente mais forte no código atual.

### 6.4 Backend — `SegurancaController`/rota `/api/seguranca/config`

Continua existindo, sem mudança de contrato — agora é só o "piso da plataforma", não
"o" controle. Talvez precise de um texto novo na resposta avisando isso (ex. um campo
informativo "empresas podem sobrescrever"), mas é ajuste de UI, não de API.

### 6.5 Frontend — dois lugares, dois públicos

| Onde | Quem edita | O que muda |
|---|---|---|
| `CardSegurancaAdmin.tsx` | ADMIN | Texto/copy: deixa de dizer "vale para todas as empresas" — passa a dizer algo como "piso padrão; cada empresa pode ligar/desligar por conta" |
| `CadastroEmpresa.tsx` | GESTOR (`podeEditar`) | Novo toggle na seção de configurações da empresa, mesmo estilo dos já existentes (WhatsApp, dias de atendimento) |

`Verificacao2FA.tsx` (a tela do código de 6 dígitos) **não muda** — ela não sabe, e
não precisa saber, POR QUE o 2FA foi pedido; só reage a `mfaRequerido: true`.

### 6.6 Migration

Uma migration simples — `ALTER TABLE tb_empresa_configuracoes ADD COLUMN
mfa_email_ativo boolean NULL`. Não mexe em RLS (a tabela já tem policy). Gerar com
`prisma migrate dev --create-only` e AGUARDAR autorização antes de `migrate deploy`
(regra de sempre, ver cabeçalho deste documento e a memória `feedback_nada_no_banco_
sem_autorizacao`).

### 6.7 Testes

`backend/src/__tests__/tenancyRls.test.js` é o gate de RLS na CI — como
`tb_empresa_configuracoes` já está classificada como TENANT_PLANE, uma coluna nova
não deveria mexer no placar do gate. Vale escrever teste(s) NOVOS, no espírito dos já
existentes em `autoriaAtendimento.test.js`/`tenancyRls.test.js`, cobrindo
especificamente:
- usuário em 2 empresas, uma com `mfaEmailAtivo: true` e outra `false`/`null` → login
  exige 2FA (OR).
- usuário só em empresas com `false`/`null`, plataforma com piso `false` → não exige.
- leitura da nova função RODA sob `comEscopoPlataforma` e não vaza vínculo de outro
  usuário (mesmo padrão de invasão do §16 do plano de multi-tenancy).

---

## 7. Quem fica de fora / casos de borda a decidir

- **ADMIN da plataforma**: hoje não tem exceção própria no código além de
  `User.mfaAtivo`. Faz sentido o ADMIN nunca ser puxado por regra de empresa (ele não
  "pertence" a nenhuma no sentido operacional) — mas isso já é coberto por
  `user.mfaAtivo === false` sendo setado manualmes por conta própria; não é automático
  hoje. Vale decidir se o ADMIN deveria ser AUTOMATICAMENTE isento da agregação por
  empresa (só respondendo ao piso/kill-switch), já que ele não é "gestor" nem
  "profissional" de clínica nenhuma.
- **PROPRIETÁRIO (cliente)**: `meusContextos` já trata cliente como um tipo de vínculo
  a empresa (§3.2, bloco PROPRIETÁRIO). Se a agregação por OR (§4, opção A) incluir
  esse vínculo, um cliente que é atendido por UMA clínica que exigiu 2FA passa a
  precisar de 2FA para logar — mesmo que ele só use o portal do proprietário. Decisão
  de produto: 2FA por empresa vale para TODOS os papéis (gestor/profissional/cliente/
  prestador) ou só para quem TRABALHA na empresa (gestor/profissional/prestador)?
- **PRESTADOR** (fornecedor externo, `tb_prestadores`): mesmo tipo de pergunta —
  `podeAcessarSistema` já trata prestador como vínculo de acesso; se entrar na
  agregação, precisa da MESMA junção com `EmpresaConfiguracao` que o vínculo
  profissional usa (prestador não tem linha em `tb_usuario_empresa`, então a query
  do §6.1 precisa cobrir os dois UNIONs, como `podeAcessarSistema` já faz).
- **Empresa sem config nenhuma** (nunca abriu `CadastroEmpresa.tsx`/nunca salvou):
  `mfaEmailAtivo` fica `null` → cai no piso da plataforma. Consistente com o resto da
  tabela (todo campo novo nasce `null` = "não decidiu ainda").
- **Kill-switch em runtime**: `MFA_EMAIL_ENABLED=false` continua vencendo TUDO — isso
  não muda, é a única forma de destravar a base inteira numa emergência (SMTP fora,
  etc.) sem depender de nenhuma linha de config de empresa.

---

## 8. Decisões que a sessão de implementação precisa fechar antes de codar

Estas são perguntas de PRODUTO, não de arquitetura — o levantamento técnico (§3-§7) já
tem caminho claro; o que falta é a escolha:

1. **Opção A (agregação no login) confirmada, ou vale investigar B (step-up por
   troca de contexto)?** Recomendação deste levantamento: A.
2. **Regra de agregação entre múltiplas empresas do mesmo usuário**: OR
   (deny-wins/mais seguro, recomendado) ou alguma outra regra (ex. só a empresa
   "principal"/ativa no momento — que não existe como conceito antes do login, ver §4)?
3. **`ConfiguracaoSeguranca` (piso da plataforma) continua existindo como está, ou o
   ADMIN ganha um modo "travar" que impede o gestor de DESLIGAR o 2FA da empresa dele**
   (irmão do `MatrizPerfil.locked` que já existe para permissões)? Não foi pedido, mas
   é uma pergunta natural quando um controle vira delegável.
4. **Quais papéis entram na agregação** — só profissional/gestor, ou também
   proprietário e prestador (§7)?
5. **ADMIN da plataforma fica automaticamente isento** da agregação por empresa, ou
   segue dependendo de alguém setar `mfaAtivo: false` nele manualmente?

---

## 9. Checklist de conformidade Multi-Tenant/RLS (para a sessão de implementação)

- [ ] Nenhuma leitura nova "por userId" cross-empresa roda sem `comEscopoPlataforma`
      (§3.3, a "regra que fica" do plano de multi-tenancy).
- [ ] Toda query cross-empresa filtra explicitamente por `WHERE user_id = $1` (ou
      equivalente Prisma) — nunca confia em RLS sozinho para restringir ao usuário
      certo (RLS restringe por EMPRESA, não por usuário).
- [ ] Coluna nova em `tb_empresa_configuracoes` não precisa de policy nova (tabela já
      é tenant direto) — só confirmar que a migration não mexe em `ENABLE`/`FORCE RLS`
      por engano.
- [ ] `tb_configuracao_seguranca` continua CONTROL_PLANE (sem RLS) — ela é
      legitimamente global (piso da plataforma), não deve ganhar RLS.
- [ ] `tenancyRls.test.js` continua passando sem precisar reclassificar nenhuma
      tabela (nem `tb_empresa_configuracoes`, que já é TENANT_PLANE, nem
      `tb_configuracao_seguranca`, que segue CONTROL_PLANE).
- [ ] Escrita do toggle pelo gestor (`salvarConfiguracao`) continua escopada à
      empresa/equipe ATIVA do request (`resolverEscopoConfiguracao`) — gestor da
      empresa A não pode, nem por engano, alterar a config da empresa B.
- [ ] Teste de invasão dedicado (mesmo estilo do §16 do plano de multi-tenancy):
      usuário da empresa A não consegue, via a nova leitura, descobrir se a empresa B
      (da qual não faz parte) tem 2FA ligado.

---

## 10. Arquivos-chave para a sessão de implementação (atalho de leitura)

```
backend/src/services/mfaService.js                        ← exigeMfa() muda aqui
backend/src/controllers/auth/UserController.js             ← chama exigeMfa() no login
backend/src/lib/usuarioEmpresa.js                          ← precedente podeAcessarSistema
backend/src/controllers/EquipeController.js                ← meusContextos + obterConfiguracao/salvarConfiguracao
backend/src/lib/prismaTenant.js                             ← comEmpresa/comEscopoPlataforma (mecanismo de RLS)
backend/src/lib/tenancyMap.js                                ← classificação CONTROL_PLANE x TENANT_PLANE
backend/prisma/schema.prisma                                 ← ConfiguracaoSeguranca (1515) + EmpresaConfiguracao (1848)
backend/prisma/migrations/20260806180000_fase7_rls_geral/    ← policy atual de tb_empresa_configuracoes
backend/src/__tests__/tenancyRls.test.js                     ← gate de RLS na CI
docs/MULTI-TENANCY-PLANO.md  §16.5                            ← o precedente mais próximo, ponta a ponta
frontend/src/components/CardSegurancaAdmin.tsx               ← UI do ADMIN (piso)
frontend/src/pages/CadastroEmpresa.tsx                        ← UI do GESTOR (novo toggle entra aqui)
frontend/src/components/Verificacao2FA.tsx                    ← tela do código (não muda)
```
