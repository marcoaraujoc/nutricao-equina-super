# S2Vet — Subida para produção

> Documento vivo. Cada item foi conferido contra o código deste repositório, e o
> **porquê** está registrado junto do **o quê** — quando algo mudar, é o porquê que diz
> se o passo ainda faz sentido ou se virou lixo.
>
> Atualizado em: 2026-08-25 · Topologia alvo: **um provedor, domínio `s2vet.com.br`**

---

## 1. A topologia, e por que é esta

```
                       ┌──────────────────────────────┐
   navegador  ────────►│  proxy reverso (Nginx / CDN) │
                       │      https://s2vet.com.br    │
                       └───────┬──────────────┬───────┘
                               │              │
                        /api/* │              │ resto
                               ▼              ▼
                    ┌────────────────┐  ┌──────────────────┐
                    │ backend Node   │  │ estático do front│
                    │ :3001          │  │ (frontend/dist)  │
                    └───────┬────────┘  └──────────────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ PostgreSQL     │  ← schema schs2vet, RLS ligado
                    └────────────────┘
```

**O backend NÃO tem host público próprio.** O navegador enxerga uma origem só. Isso não
é preferência de estilo — três coisas do código dependem disso:

1. **Não há proteção CSRF dedicada** (não existe `csurf`, token double-submit, nada). A
   defesa contra CSRF **é** o `SameSite=Lax` do cookie de sessão (`lib/authCookies.js`).
   Front e back em domínios diferentes obrigariam a `SameSite=None`, que manda o cookie
   em requisição disparada por qualquer site — e aí CSRF passa a ser trabalho a fazer,
   não proteção existente.
2. **As URLs de mídia são gravadas RELATIVAS no banco.** `DbStorageProvider` grava
   `/api/midia/<chave>` em `Animal.photoUrl`, `EvolucaoMidia.url`,
   `ExameClinico.arquivoUrl`, `EmpresaConfiguracao.logoUrl`. Servidas de um host
   diferente do backend, todo `<img src>` resolve contra o host do FRONT e dá 404 —
   foto de paciente, logo da clínica, anexo de exame.
3. **Todo request carrega `x-empresa-id` / `x-equipe-id`** (interceptor de
   `services/api.ts`). Header customizado não é "simple request": cross-origin, cada
   chamada vira duas viagens (preflight + real).

`app.s2vet.com.br` + `api.s2vet.com.br` (subdomínios do MESMO domínio) preservam o
`SameSite=Lax` — SameSite olha o domínio registrável, não a origem —, mas reintroduzem
o preflight e exigem resolver CORS + cookie nas tags `<img>`/`<video>` da mídia
(`lib/midiaEnvio.js` **não** emite `Access-Control-Allow-*`, e `<img>` cross-origin não
manda cookie por padrão). Sem ganho à vista.

### Bônus: o front NÃO precisa de rewrite de SPA

`App.tsx` usa **`HashRouter`** — as rotas vivem em `/#/caminho`. Toda navegação é
request para `/`. Não configure `try_files $uri /index.html`: não é necessário aqui, e
é uma fonte clássica de erro a menos.

⚠️ Consequência que aparece em outro lugar: **todo link de e-mail precisa do `/#/`**
(`${APP_URL}/#/reset-password?token=...`). Já é assim no código — não "corrigir".

---

## 2. Variáveis de ambiente

Todas em `backend/.env.example`, com o porquê de cada uma. As que mudam de valor em
produção:

| Variável | Produção | Consequência de errar |
|---|---|---|
| `DATABASE_URL` | usuário da APLICAÇÃO (sem dono) | Ver §3 — é o que impede a app de desligar o próprio RLS |
| `DATABASE_URL_MIGRATIONS` | usuário DONO do schema | Sem ela, `migrate deploy` falha por falta de DDL |
| `JWT_SECRET` | gerar um **próprio** para produção | Ver §2.1 |
| `JWT_REFRESH_SECRET` | 🔴 **definir** (hoje ausente) | Ausente, é DERIVADO do `JWT_SECRET` — os dois deixam de ser independentes. Ver §2.1 |
| `APP_URL` | `https://s2vet.com.br` | Link de e-mail (reset de senha, convite, aprovação de vínculo) aponta para localhost |
| `ALLOWED_ORIGINS` | `https://s2vet.com.br` | Default é `http://localhost:5173` |
| `COOKIE_SECURE` | `true` | Cookie de sessão viaja em claro |
| `TRUST_PROXY_HOPS` | nº de proxies (default `1`) | Ver a nota abaixo |
| `STORAGE_DRIVER` | `db` (default) | Ver §6 |
| `LIBREOFFICE_BIN` | `soffice` (já no Dockerfile) | `.doc` não pré-visualiza — degrada com gracia, não quebra |
| `MFA_EMAIL_ENABLED` | decisão de produto | Kill-switch do 2FA; hoje o seletor global do ADMIN entrega DESATIVADO |

### 2.1 Segredos de sessão

O `JWT_SECRET` é a chave HMAC dos tokens (`lib/sessionTokens.js`, fonte única de
assinatura). Quem o descobre **fabrica** um token com qualquer `id`/`userType` — entra
como ADMIN de qualquer empresa, sem senha e **sem passar pelo 2FA** (o segundo fator
acontece antes de o token ser emitido; token forjado pula a etapa). O ataque é
**offline**: basta capturar um JWT e testar chaves localmente, onde rate limit não
alcança.

O backend recusa iniciar com segredo fraco — e desde 2026-08-25 não é só comprimento:
`segredoFraco()` em `server.ts` rejeita palavra previsível (placeholder do
`.env.example`), poucos caracteres distintos e repetição longa.

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ **`JWT_REFRESH_SECRET` está ausente hoje** e `lib/sessionTokens.js` o deriva de
`JWT_SECRET + '_refresh'`: quem obtiver um deriva o outro numa linha, e o refresh token
vale pela janela de inatividade inteira. O boot emite `[AVISO]` — defina um próprio.

⚠️ **Rotacionar desloga todo mundo.** Access e refresh assinados com o valor antigo
deixam de validar juntos. Indolor antes de abrir para clientes; depois, exige janela
combinada.

Auditar um segredo já configurado, sem imprimi-lo:
```bash
node -e "require('dotenv').config();const v=process.env.JWT_SECRET||'';console.log('tam:',v.length,'| distintos:',new Set(v).size,'| hex:',/^[0-9a-f]+$/i.test(v))"
```

**Sobre `TRUST_PROXY_HOPS`:** o default já é `1`, que serve para UM proxy reverso — não
é um passo obrigatório. Conte os saltos: Cloudflare **+** Nginx = `2`. Errar para menos
faz `req.ip` virar o IP do proxy (rate limit vira balde único e a auditoria grava o IP
errado em todo login); errar para mais deixa o cliente forjar o próprio IP.
⚠️ Nunca `true` — o código comenta isso e o `express-rate-limit` reclama.

---

## 3. Banco: dois usuários, e por quê

A aplicação conecta com um usuário **sem privilégio de dono**. É isso que garante que
ela **não consegue desligar o Row-Level Security** que a limita a um tenant. As
migrations conectam com o dono, que tem `CREATE`/`ALTER`.

Testado e registrado em `docs/MULTI-TENANCY-PLANO.md`: com a app conectada como o
usuário restrito, `UPDATE` em massa sem `WHERE` atinge **só** as linhas da empresa do
contexto, e a role não consegue `DISABLE ROW LEVEL SECURITY` nem `TRUNCATE`.

⚠️ **Ao criar uma tabela nova, ela nasce SEM policy.** Com o RLS fail-closed da fase 7c,
tabela sob tenancy sem policy devolve **zero linha, sem erro** — o pior modo de falhar.
O gate é `src/__tests__/tenancyRls.test.js`; o gerador é `scripts/gerarPoliciesRls.js`.

⚠️ Policy órfã afrouxa o isolamento **em silêncio**: o PostgreSQL combina policies
permissivas com `OR`, então basta uma antiga permitir. Confira `pg_policies` por tabela
— mais de uma é suspeita.

---

## 4. Subida — ordem dos passos

### 4.1 Banco

```bash
# 1. Migrations com o usuário DONO (são 172 no repo nesta data)
cd backend
DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy

# 2. Client tipado
npx prisma generate

# 3. Catálogo de módulos do Controle de Acesso (upsert, idempotente)
node seed.js
```

⚠️ **Banco novo** aplica as 172 de uma vez, limpo. **Banco existente**: rode
`npx prisma migrate status` ANTES — o CLAUDE.md tem migrations anotadas como "gerada,
não aplicada" e essa anotação pode estar desatualizada em relação ao banco real.

⚠️ `npx prisma generate` falha com `EPERM` no Windows se o backend estiver rodando
(lock do query engine — CLAUDE.md §11). Pare o processo antes.

### 4.2 Backend

```bash
cd backend
npm ci
npm run build        # tsc + scripts/copy-assets.js
npm start            # node dist/server.js
```

⚠️ `npm run build` **não é só `tsc`**: `copy-assets.js` copia os SVG/PNG dos laudos
(anatomia equina, casco, odontologia) que o `tsc` ignora. Pular isso derruba a geração
desses laudos em produção, e só na hora de emitir um.

### 4.3 Frontend

```bash
cd frontend
npm ci
npm run build        # tsc && vite build  →  dist/
```

Publique `frontend/dist/` como estático atrás do proxy. Sem regra de rewrite (§1).

### 4.4 Proxy

Rotear `/api/*` → `http://backend:3001` preservando:
- `X-Forwarded-For` (senão `TRUST_PROXY_HOPS` não tem o que ler)
- cabeçalhos de `Range` e `Accept-Ranges` (vídeo de prontuário tem seek — `midiaEnvio.js`
  atende `Range` com `substring()` no Postgres, sem carregar o arquivo em memória)
- corpo de até **150 MB** (`UPLOAD_MAX_BYTES`) nas rotas de upload — o default de
  `client_max_body_size` do Nginx é 1 MB e corta o anexo com 413 antes de chegar na app

⚠️ **`/health` NÃO está sob `/api`** — é `app.get('/health')` na raiz do backend
(`server.ts`). Com o proxy roteando só `/api/*`, `https://s2vet.com.br/health` cai no
ESTÁTICO do frontend, não no backend. Escolha um:
- deixar o healthcheck INTERNO (orquestrador → `http://backend:3001/health`), que é o
  normal e não expõe o diagnóstico do banco para a internet; **ou**
- rotear `/health` explicitamente no proxy, se precisar de check externo.
A rota devolve `200`/`503` e o corpo traz latência do banco e uptime.

⚠️ `/api` também é o prefixo do **rate limit** (`app.use('/api', limiter)`): o que não
passa por `/api` não é limitado.

---

## 5. Verificação depois de subir

Nesta ordem — cada uma cobre uma camada diferente:

| # | O que | Como | Esperado |
|---|---|---|---|
| 1 | Processo + banco | `curl http://backend:3001/health` (interno — ver ⚠️ em §4.4) | `200` com `status: "ok"` e `checks.database.status: "ok"` |
| 2 | Login | entrar pela tela | Sessão criada; **sem 401 no console** (o cookie-dica evita a sondagem) |
| 3 | Cookie | DevTools → Application → Cookies | `s2vet_at` e `s2vet_rt` com `Secure` ✅ e `SameSite=Lax` |
| 4 | Mídia | abrir um paciente com foto | Imagem carrega (prova que `/api/midia` está same-origin e autorizado) |
| 5 | Upload | anexar um laudo num resultado de exame | Salva e aparece na lista |
| 6 | Conversor `.doc` | `npm run doc:check` no servidor | `✓ CONVERSÃO OK`. Se der `✗`, ver §7 |
| 7 | IP real | fazer um login e abrir `/auditoria-geral` | Coluna IP com o IP do cliente, não o do proxy |
| 8 | Cron | tela **Monitoração** (`/monitoracao`, ADMIN) | Execuções aparecendo; use "Executar agora" na tela Configuração para testar um job |

⚠️ **O cron só roda se o processo estiver de pé naquele minuto** — `node-cron` não
recupera disparo perdido. Um restart às 23:45 faz o fechamento de fatura daquele dia
não acontecer (CLAUDE.md, sessão 2026-08-23 parte 4). Se o provedor hiberna o
container por inatividade, isso vira um problema recorrente: confirme que o plano
mantém o processo vivo 24h.

⚠️ **A execução manual de job dispara de verdade** — grava no banco e manda
WhatsApp/e-mail. Não use `lembrete_*` nem `reenviar_links_fatura` como teste de fumaça.

---

## 6. Dimensionamento — o que cresce

**Os arquivos moram no Postgres** (`bytea`, CLAUDE.md §8): foto de paciente, laudo,
vídeo de prontuário até 150 MB cada. Consequência direta: **o dump de backup cresce
junto com os anexos**. Não impede subir; muda o dimensionamento de disco e a janela de
backup.

Quando incomodar, o caminho **já está previsto na arquitetura** e não passa por
controller nenhum:

1. Implementar `S3StorageProvider` respeitando `StorageProvider` (`upload`/`delete`/`getUrl`).
2. Registrar no `switch` de `src/storage/index.ts` (o `case 's3'` já está lá, comentado).
3. `STORAGE_DRIVER=s3`.

⚠️ **Jamais devolver URL pública/assinada do bucket ao cliente.** O download continua
saindo por `/api/midia/:chave`, que faz o proxy do objeto — o bucket fica PRIVADO.
Expor a URL assinada recria exatamente o furo do `express.static` que motivou tirar os
arquivos do disco.

---

## 7. LibreOffice (conversão `.doc`)

Só no **servidor de backend** — a conversão roda no processo Node (`execFile` em
`lib/documentoConversao.js`). O frontend é build estático e nunca toca nisso.

- **Docker**: já vem na imagem (`backend/Dockerfile`, `libreoffice-writer` + fontes).
- **Debian/Ubuntu direto**: `apt-get install -y libreoffice-writer fonts-liberation`
- **Windows (dev)**: instalar o LibreOffice e definir
  `LIBREOFFICE_BIN=C:\Program Files\LibreOffice\program\soffice.exe`

Diagnóstico em qualquer ambiente: **`npm run doc:check`** (sai 0/1, serve em healthcheck).

⚠️ `fonts-liberation` não é opcional: sem fonte instalada o LibreOffice headless
converte com métricas erradas e o `.docx` derivado sai com o texto embaralhado.

**Ausente, não quebra nada**: o `.doc` é guardado como veio e apenas não ganha
pré-visualização (e não é lido pela IA). É degradação deliberada — derrubar o
lançamento de um resultado clínico por causa de um conversor de formato seria trocar um
inconveniente por perda de trabalho.

---

## 8. Pendências conhecidas antes de abrir para clientes

- [ ] 🔴 **Definir `JWT_REFRESH_SECRET` próprio** — hoje ausente, logo derivado do
      `JWT_SECRET` (ver §2.1). Gerar um `JWT_SECRET` próprio de produção também, já que
      o de desenvolvimento não deve viajar para o servidor.
- [ ] Confirmar se o provedor mantém o processo do backend vivo 24h (ver §5, cron).
- [ ] Decidir o 2FA por e-mail: entregue **desativado** no seletor global do ADMIN
      (`/configuracao-alertas`).
- [ ] `WHATSAPP_PROVIDER` — `noop` só loga. Para enviar de verdade, configurar a
      Evolution API (`docs/INTEGRACAO_EVOLUTION_API.md`).
- [ ] Rever o teto de `RATE_LIMIT_MAX` (300/min por usuário) com uso real de clínica.
- [x] ~~Aplicar a migration `20260915000000_bloqueio_login_tentativas`~~ — APLICADA no
      banco de desenvolvimento em 2026-08-25 (bloqueio de conta após 6 senhas erradas).
      No banco de PRODUÇÃO ela entra junto das demais no `migrate deploy` da §4.1.
- [ ] Vincular o acesso à mídia à sessão por cookie continua sendo capability URL +
      autorização por dono — suficiente hoje; revisar se o acervo crescer.

---

## 9. Como manter este documento

Este arquivo descreve o **estado verificado** do deploy, não a intenção. Ao mudar
topologia, variável de ambiente ou passo de subida, atualize aqui **junto** com o
código — um checklist que descreve um deploy que não existe mais é pior que nenhum,
porque é seguido com confiança.

Registre sempre o **porquê**: é ele que permite a quem vier depois decidir se o passo
ainda vale ou se caiu junto com a razão que o criou.
