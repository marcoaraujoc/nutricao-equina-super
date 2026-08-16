# Notificações Push (PWA) + avaliação de Redis — plano

> # 🔴 REGRA DE TRABALHO — NADA ENTRA NO BANCO SEM AUTORIZAÇÃO
>
> **Nenhuma migration é APLICADA, nenhuma dependência é instalada, nenhum arquivo de
> produção é criado a partir deste documento sem o "ok" explícito do Marco.** O fluxo,
> quando for autorizado a começar, é sempre: escrever o `schema.prisma` e gerar o SQL da
> migration com `npx prisma migrate dev --create-only` (cria o arquivo, não aplica) → ler
> o SQL → autorizar → só então `migrate deploy`.
>
> **Status: PROPOSTA COMPLETA. Nada foi criado ou alterado no projeto a partir deste
> plano.** Este arquivo é só o registro da decisão.

---

## 1. O que muda, em uma frase

Hoje o S2Vet avisa a equipe por WhatsApp (lembretes de agendamento, de dose de
prescrição). Depois desta mudança, o sistema também empurra um aviso direto para o
celular/computador de quem está logado — sem WhatsApp, sem depender do usuário estar
com o app aberto — e guarda um histórico consultável de tudo que já foi avisado.

O achado principal da análise: **a maior parte da infraestrutura que isso precisa já
existe** — RLS multi-tenant automático, providers plugáveis, cron com idempotência,
RBAC por catálogo. Este plano é, em boa parte, um plano de **reaproveitamento**, não de
construção do zero. As duas peças novas de verdade são o canal Web Push em si (Service
Worker, VAPID, PWA) e três tabelas.

Redis foi avaliado à parte (§11-§12) porque foi levantado como dúvida separada:
**recomendação é não instalar agora** — nenhum dos usos clássicos (sessão, cache,
rate-limit distribuído) se aplica a uma aplicação de instância única e sem estado de
sessão no servidor.

---

## 2. Levantamento — o que já existe e será reaproveitado

Antes de desenhar tabela nova, isto é o que já está construído e resolve, sozinho,
metade dos requisitos do pedido original:

| Peça | Onde | O que resolve aqui |
|---|---|---|
| RLS automático por tenant (fase 7c) | `lib/prismaTenant.js`, `lib/tenantDb.js` | Isolamento entre empresas e "nunca aceitar empresaId do frontend" — já são a regra do sistema inteiro, não algo a inventar para Push |
| Provider plugável | `messaging/whatsappProvider.js` | Molde para o `pushProvider` — classe abstrata + fábrica por env var, mesmo padrão de `StorageProvider`/`AIProvider` |
| Cron com idempotência, por empresa | `lib/cronManager.js`, `lembreteAgendamentoService.js`, `lembreteDosePrescricaoService.js` | O exemplo do pedido ("consulta em 15 minutos") já roda a cada 5 min via `paraCadaEmpresaComEnvio` — não é cron novo, é o mesmo tick chamando um canal a mais |
| RBAC por catálogo + matriz por perfil | `ModuloSistema`, `MatrizPerfil`, `PermissaoMembro` | Gabarito direto para "o gestor define qual alerta vai para qual perfil" (§7) |
| Lugar na UI já reservado | `AppHeader.tsx` | O sino foi removido na fase 3 do multi-tenancy com o comentário explícito "volta quando houver notificação de verdade" — este é esse retorno |

O que **não existe** e precisa nascer: PWA (manifest, ícones, Service Worker),
`web-push` + chaves VAPID, e as três tabelas da seção 3. Nada disso está no
`package.json` nem no `schema.prisma` hoje.

---

## 3. Modelo de dados

O desenho pedido original (UUID, uma tabela `PushSubscription` com `empresaId` solto)
não cabe direto no schema real (IDs inteiros em todo o projeto) e quebra num caso que o
próprio pedido descreve.

### 3.1 🔴 Achado — a chave de unicidade original quebra com 1 usuário em 2 empresas

Fixar `@@unique([userId, endpoint])` com um `empresaId` solto na mesma linha não
representa o exemplo dado no pedido (João: Push ligado na Empresa A, desligado na B, no
mesmo celular). Um endpoint de push é um por navegador/dispositivo — não existem duas
subscriptions reais para o mesmo endpoint. **Correção:** separar o "aparelho"
(`PushSubscription`) do "isso vale para esta empresa, ligado ou desligado"
(`NotificacaoPreferencia`). O `empresaId` na subscription vira metadado (em qual
empresa o aparelho foi registrado), nunca o campo que decide se um envio sai.

### 3.2 🔴 Achado — idempotência não pode ser 1 coluna por tipo de lembrete

O padrão atual para WhatsApp é uma coluna por tipo
(`lembreteWa1DiaEnviadoEm`, `proximaDoseAvisoEnviado`...). O próprio pedido (item 15)
exige "adicionar tipos novos sem alterar a arquitetura" — uma coluna nova por tipo é o
oposto disso. **Correção:** uma chave única `(userId, tipoSlug, refType, refId)` em
`Notification` resolve sozinha, sem tocar na tabela de origem (`AgendamentoClinico`,
`Prescricao`, etc.).

### 3.3 `PushSubscription` — o dispositivo

```prisma
model PushSubscription {
  id           Int       @id @default(autoincrement())
  userId       Int
  empresaId    Int       // empresa ativa no registro — informativo, não filtra envio
  endpoint     String    @db.VarChar(500)
  p256dh       String    @db.VarChar(255)
  auth         String    @db.VarChar(255)
  enabled      Boolean   @default(true)   // interruptor PRÓPRIO — nunca só Notification.permission
  deviceName   String?   @db.VarChar(150)
  userAgent    String?   @db.VarChar(255)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  lastUsedAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, endpoint])
  @@index([userId, empresaId])
  @@map("tb_push_subscriptions")
  @@schema("schs2vet")
}
```

### 3.4 `NotificacaoTipo` — catálogo, não enum fechado

Mesma decisão que `ModuloSistema` já tomou: tipo de notificação é uma linha, não um
valor fixo no código. `STOCK_ALERT` daqui a um ano é um `INSERT`, não uma migration.

```prisma
model NotificacaoTipo {
  id          Int     @id @default(autoincrement())
  slug        String  @unique @db.VarChar(60)  // "APPOINTMENT_REMINDER"
  categoria   String  @db.VarChar(30)          // "lembrete" | "alerta" | "administrativo"
  label       String  @db.VarChar(150)         // "Lembrete de consulta"
  padraoAtivo Boolean @default(true)           // valor de fábrica sem configuração nenhuma

  @@map("tb_notificacao_tipos")
  @@schema("schs2vet")
}
```

### 3.5 `NotificacaoPreferencia` — o liga/desliga que decide o envio

```prisma
model NotificacaoPreferencia {
  id        Int      @id @default(autoincrement())
  userId    Int
  empresaId Int
  tipoSlug  String   @db.VarChar(60)
  ativo     Boolean  @default(true)
  updatedAt DateTime @updatedAt

  user User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  tipo NotificacaoTipo @relation(fields: [tipoSlug], references: [slug])

  @@unique([userId, empresaId, tipoSlug])
  @@index([userId, empresaId])
  @@map("tb_notificacao_preferencias")
  @@schema("schs2vet")
}
```

Sem linha aqui = usa `NotificacaoTipo.padraoAtivo`. Evita popular 6 linhas por usuário
no cadastro (mesmo espírito do `EmpresaConfiguracao`: ausência tem significado).

### 3.6 `Notification` — o histórico persistente

```prisma
model Notification {
  id        Int       @id @default(autoincrement())
  empresaId Int
  userId    Int
  tipoSlug  String    @db.VarChar(60)
  titulo    String    @db.VarChar(200)
  corpo     String    @db.VarChar(500)
  url       String?   @db.VarChar(300)
  refType   String?   @db.VarChar(40)   // "AGENDAMENTO" | "VACINA" | "EXAME" ...
  refId     Int?                         // id do registro de origem — idempotência E navegação
  readAt    DateTime?
  createdAt DateTime  @default(now())

  user User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  tipo NotificacaoTipo @relation(fields: [tipoSlug], references: [slug])

  @@unique([userId, tipoSlug, refType, refId])
  @@index([userId, empresaId])
  @@index([userId, readAt])
  @@map("tb_notificacoes")
  @@schema("schs2vet")
}
```

`refType`/`refId` nulos (alerta administrativo, sem origem única) não colidem entre si
— o Postgres trata `NULL` como distinto em `UNIQUE`, então cada linha continua isolada
por `id`.

### 3.7 RLS — as três tabelas entram no mecanismo existente, não em um paralelo

Nenhuma das três é catálogo global nem tem linha legada sem empresa (diferente de
`tb_prestadores`, que mantém o escape `app_empresa_id() IS NULL OR …` para linhas
`SYSTEM`). Aqui a policy é a forma **estrita**, coerente com a fase 7c: sem tenant no
contexto, zero linhas.

```sql
-- adicionar as 3 tabelas a lib/tenancyMap.js como TENANT DIRETO
-- e regenerar via scripts/gerarPoliciesRls.js — não escrever a policy à mão

ALTER TABLE "schs2vet"."tb_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_push_subscriptions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tenant_tb_push_subscriptions" ON "schs2vet"."tb_push_subscriptions"
  USING       ("empresa_id" = "schs2vet"."app_empresa_id"())
  WITH CHECK  ("empresa_id" = "schs2vet"."app_empresa_id"());
-- mesma forma para tb_notificacao_preferencias e tb_notificacoes
```

---

## 4. Serviço central (backend)

Um único ponto de entrada, no padrão *service enxuto chamado pelo controller* — não uma
pasta `modules/` nova ao lado de `controllers/`/`services/` (ver §13).

### 4.1 Arquivos

| Arquivo | Papel |
|---|---|
| `backend/src/services/notificationService.js` | Ponto único: recebe `{ userId, empresaId, tipoSlug, titulo, corpo, url, refType, refId }`, decide se envia e para onde |
| `backend/src/messaging/pushProvider.js` | Envelope fino sobre `web-push` — mesmo molde de `whatsappProvider.js` |
| `backend/src/controllers/PushController.js` | `subscribe` / `unsubscribe` — enxuto, delega ao service |
| `backend/src/controllers/NotificationController.js` | Listar / marcar como lida — alimenta o sino |
| `backend/src/routes/push.js`, `routes/notificacoes.js` | Registro de rota, no padrão de `routes/prestadores.js` |

### 4.2 Algoritmo de `notificationService.send()`

1. Resolve o nível efetivo do tipo para o perfil do usuário (regra do gestor, §7). Sem
   permissão para o tipo → para aqui, nada é gravado.
2. Grava a `Notification` no Postgres **sempre**, mesmo que o Push falhe depois ou o
   usuário esteja com tudo desligado — é o requisito de histórico independente do canal.
3. Lê `NotificacaoPreferencia` (userId+empresaId+tipo). Ausente → usa o padrão do tipo.
   Desligado → encerra aqui; a notificação já está no histórico, só não gera Push.
4. Busca `PushSubscription` com `enabled = true` do usuário (todos os dispositivos).
5. Dispara para cada uma via `pushProvider`, em paralelo, **sem transação em volta**
   (mesma razão do `lembreteAgendamentoService`: I/O de rede nunca dentro de uma
   transação de banco).
6. Trata cada resposta: `404`/`410` marca aquela subscription `enabled = false`;
   qualquer outro erro só loga.

"Nunca aceitar empresaId arbitrário" (item 22 do pedido original) se resolve sozinho: o
service nunca recebe `empresaId` do corpo HTTP — só de `req.empresaId`, já validado por
`authenticate`, dentro do `comEmpresa` que o RLS exige.

---

## 5. Consentimento do usuário e Service Worker

O sistema nunca ativa notificação sozinho — tecnicamente é a única opção
(`Notification.requestPermission()` só funciona a partir de um clique real), mas a
disciplina de produto é *explicar* o estado bloqueado, não fingir que o botão funciona.

### 5.1 Sequência ao ativar

1. Registra `public/sw.js`, se ainda não registrado.
2. Pede permissão do navegador.
3. Negado → não insiste sozinho; mostra o texto "as notificações estão bloqueadas nas
   configurações do dispositivo", com o caminho específico quando der para detectar
   (Chrome Android difere de Safari iOS).
4. Concedido → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
5. `POST /api/push/subscribe` com `{ endpoint, keys: { p256dh, auth } }` — nada além
   disso; `userId`/`empresaId` vêm de `req.user`/`req.empresaId`.
6. Backend faz upsert por `(userId, endpoint)`, marca `enabled = true`.

Reativar depois de desligar repete os 6 passos inteiros, nunca um `PATCH enabled=true`
direto — a subscription do navegador pode ter expirado no meio do caminho.

### 5.2 `public/sw.js` — o mínimo

```js
self.addEventListener('push', (event) => {
  const dados = event.data.json(); // { titulo, corpo, url }
  event.waitUntil(self.registration.showNotification(dados.titulo, {
    body: dados.corpo,
    icon: '/icons/notificacao-192.png',
    data: { url: dados.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

### 5.3 🟡 iOS/iPadOS — particularidade que muda o roteiro, não o destino

Web Push em Safari só funciona com o PWA **instalado na tela de início** (iOS 16.4+) —
dentro da aba normal do Safari a API nem existe. Duas consequências:

- A tela de configuração precisa detectar `navigator.standalone` e, fora do modo
  instalado, mostrar "Adicione à tela de início para ativar notificações" em vez do
  toggle.
- O manifest deixa de ser um extra: é pré-requisito funcional do Push para qualquer
  clínica com iPhone/iPad na equipe.

---

## 6. Lembretes automáticos — estender o cron existente

O pedido original (item 17) descreve exatamente o que `lembreteAgendamentoService.js`
já resolve para WhatsApp. A decisão correta é não duplicar a consulta.

| Hoje (WhatsApp) | Proposto (+ Push) |
|---|---|
| `registrarJob('lembrete_whatsapp', …)`, a cada 5 min | Mesmo job — `enviarLembretesWhatsapp` também chama `notificationService.send()` para o mesmo agendamento, no mesmo tick |
| Janela de 1h/15min, flags `lembreteWa1DiaEnviadoEm`/`lembreteWa2hEnviadoEm` | Continua definindo *quando* disparar; idempotência do Push é o `@@unique` de `Notification`, não uma flag nova |
| `paraCadaEmpresaComEnvio` | Sem mudança |

Manter os dois no mesmo job: a janela "quinze minutos antes" existe num lugar só. Um
ajuste futuro (janela, regra de quais agendamentos avisam) vale para os dois canais ao
mesmo tempo.

> **Nota (item 18 do pedido — fila para o futuro):** nada no `notificationService` deve
> chamar `webpush.sendNotification` direto dentro do loop do cron. Um método de uma
> linha — `enfileirarEnvio(payload)`, hoje só `await pushProvider.enviar(payload)` — é
> o que permite trocar o corpo por `fila.add(...)` mais tarde sem tocar em quem chama.
> Ver §12.

---

## 7. "O gestor define qual alerta vai para qual perfil"

Esta frase muda a forma do problema: deixa de ser preferência pessoal e vira regra
corporativa — o mesmo formato que o RBAC de módulos já resolve para "quem pode fazer o
quê".

### 7.1 Reaproveitar o formato de `MatrizPerfil`

```prisma
model NotificacaoRegraPerfil {
  id         Int     @id @default(autoincrement())
  equipeId   Int
  perfilSlug String  @db.VarChar(50)   // mesmo perfilSlug de PerfilEquipe
  tipoSlug   String  @db.VarChar(60)   // mesmo slug de NotificacaoTipo
  ativo      Boolean @default(true)

  perfil PerfilEquipe    @relation(fields: [equipeId, perfilSlug], references: [equipeId, slug], onDelete: Cascade)
  tipo   NotificacaoTipo @relation(fields: [tipoSlug], references: [slug])

  @@unique([equipeId, perfilSlug, tipoSlug])
  @@index([equipeId, perfilSlug])
  @@map("tb_notificacao_regras_perfil")
  @@schema("schs2vet")
}
```

É `MatrizPerfil` com `moduloSlug` trocado por `tipoSlug` e `nivel` simplificado para
booleano (notificação não tem os 5 graus NENHUM…FULL — ou o perfil recebe, ou não). A
tela é a mesma grade de checkbox do Controle de Acesso: linhas = perfil, colunas = tipo
de notificação.

### 7.2 Como as três camadas se combinam no envio

1. **Regra do gestor** (`NotificacaoRegraPerfil`): este tipo existe para o perfil desta
   pessoa na equipe? Não → nem grava a `Notification`.
2. **Interruptor geral do usuário** ("Receber no celular" = OFF): grava o histórico,
   não manda Push.
3. **Preferência por tipo do usuário** (`NotificacaoPreferencia`): mesmo efeito do
   passo 2, granular por tipo.

Sem linha em `NotificacaoRegraPerfil` para `(equipe, perfil, tipo)` = herda
`NotificacaoTipo.padraoAtivo`, igual ao `MatrizPerfil` já faz para módulo nunca
configurado.

> **Decisão de faseamento:** isto é a Fase 4 (§10), não a Fase 1. Entregar a matriz por
> perfil junto com a primeira versão do Push atrasa a entrega sem necessidade — a Fase
> 1 nasce com `NotificacaoTipo.padraoAtivo` valendo para todo mundo, regra fixa no
> seed (molde de `002_permissoes_padrao.seed.js`).

---

## 8. Interface

### 8.1 Sino no `AppHeader`

Volta ao lugar de onde saiu, seguindo o padrão de *store único* que
`useVetPendentes.ts` já documenta como obrigatório para hooks de polling com mais de um
consumidor: um `setInterval` só, compartilhado entre o sino e a lista completa.

### 8.2 Tela "Configurações → Notificações"

| O que a tela mostra | De onde vem |
|---|---|
| Toggle mestre "Receber no celular" | `PushSubscription.enabled` do dispositivo atual + `Notification.permission` do navegador |
| Toggles por tipo (Consultas, Vacinas…) | `NotificacaoPreferencia`, com `NotificacaoTipo.padraoAtivo` quando não houver linha |
| Aviso "bloqueado nas configurações do dispositivo" | `Notification.permission === 'denied'` — texto fixo, nunca um botão que finge funcionar |
| "Adicione à tela de início" (iOS) | `navigator.standalone === false` em Safari/iOS |

### 8.3 PWA — o mínimo que faz o resto funcionar

- `frontend/public/manifest.webmanifest` — nome, ícones (192/512 + maskable Android),
  `display: standalone`, cor de tema.
- `public/sw.js` registrado em `main.tsx`, só em produção/HTTPS.
- `vite-plugin-pwa` é opcional — o Service Worker deste caso de uso é simples o
  bastante para escrever à mão e manter controle total do `push`/`notificationclick`.

---

## 9. Segurança — de-para com o que já existe

| Exigência do pedido | Mecanismo existente que resolve |
|---|---|
| Autenticação existente | `authenticate` (JWT via cookie HttpOnly) — sem alteração |
| Nunca aceitar `empresaId` do frontend | `req.empresaId` resolvido só pelo backend; rotas de Push nunca leem esse campo do body |
| Isolamento multi-tenant | RLS fail-closed nas 3 tabelas novas (§3.7) |
| Impedir registrar subscription para outro usuário | `userId` vem de `req.user.id`, nunca do body |
| Nunca expor `VAPID_PRIVATE_KEY` | Só em `.env` do backend; front recebe só `VITE_VAPID_PUBLIC_KEY` |
| Rate limit em subscribe/unsubscribe | `express-rate-limit` já global (200/min); sem necessidade de limite dedicado no volume esperado |
| Validação de payload | `express-validator`, mesmo padrão de auth/animais/equipes |

---

## 10. Fases de entrega

Ordenadas para que cada fase produza algo demonstrável sozinha.

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0 — Fundação de dados** | 3 tabelas + catálogo de tipos, entrada em `lib/tenancyMap.js`, migration de RLS, seed dos 7 tipos | Tabelas existem, RLS ativo, sem UI |
| **1 — Canal ponta a ponta** | `web-push`+VAPID, `pushProvider.js`, `notificationService.send()`, rotas subscribe/unsubscribe, manifest+`sw.js`, botão único "Ativar notificações" | Uma chamada manual do service chega no celular |
| **2 — Preferências e histórico** | Toggles por tipo, tela "Configurações → Notificações" completa, sino no `AppHeader`, lista com marcar-como-lida e navegação | Usuário liga/desliga por tipo e revê o histórico |
| **3 — Lembretes automáticos** | `lembreteAgendamentoService` chama `notificationService.send()` no mesmo tick do WhatsApp | Primeiro tipo real em produção: `APPOINTMENT_REMINDER` |
| **4 — Regra por perfil** | `NotificacaoRegraPerfil` + aba nova no Controle de Acesso | Gestor configura por perfil na mesma grade de `MatrizPerfil` |
| **5 — Demais tipos** | Vacina, procedimento, exame disponível, estoque, administrativo | Cada um é uma chamada nova a `notificationService.send()` onde o evento já acontece + 1 linha em `NotificacaoTipo` |

---

## 11. Redis — avaliação

A pergunta não é "Redis é bom" — é o que, especificamente, nesta aplicação, hoje,
precisa do que só Redis resolve.

| Uso clássico de Redis | Estado real do S2Vet | Veredito |
|---|---|---|
| Sessão de servidor compartilhada | Não existe sessão de servidor — JWT em cookie HttpOnly, sem estado no backend | Não se aplica |
| Rate limiting distribuído | `express-rate-limit` em memória, backend é **instância única** (`docker-compose.yml` sem réplica, sem PM2 cluster, sem load balancer) | Não se aplica |
| Cache de leitura | Nenhuma tela sofre de leitura cara o bastante hoje — o padrão observado é otimizar a query (índices, `select` enxuto), não cachear resposta | Não se aplica |
| Fila de jobs (retry, backoff, concorrência) | Único ponto onde faria diferença real: envio de Push em massa. Volume esperado (avisos de agenda de uma clínica) é dezenas por tick de 5 min, não milhares | Parcial — ver §12 |

**Recomendação: não instalar Redis nesta etapa.** Uma peça de infraestrutura nova
(processo a monitorar, variável a proteger, ponto a falhar) sem um problema concreto
que ela resolva é custo operacional puro. O ganho de "estar pronto para o futuro" se
obtém isolando a interface de envio (§12), não provisionando o serviço com
antecedência.

---

## 12. Redis — gatilhos para reabrir a decisão, e caminho de adoção

### 12.1 Gatilhos objetivos (qualquer um já justifica reavaliar)

- **Mais de uma instância do backend** — escala horizontal, PM2 `cluster`, ou múltiplos
  containers atrás de load balancer. Nesse momento o rate-limit em memória para de
  fazer sentido, e `rate-limit-redis` volta a ser necessário.
- **Volume de Push que trave o tick do cron** — se o envio de um lote passar a demorar
  perto dos 5 minutos do próprio intervalo do job, ou erros em massa (provedor fora do
  ar) precisarem de retry com backoff em vez de "tentar de novo no próximo tick".
- **Um segundo caso de uso de fila** — e-mail em lote, processamento assíncrono de IA,
  exportação pesada — que justifique dividir o custo operacional entre mais de uma
  necessidade.
- **Pub/sub entre instâncias** — se o sino precisar de tempo real (WebSocket) com mais
  de um processo Node servindo, Redis pub/sub é o jeito padrão de sincronizar.

### 12.2 Deixar a porta aberta sem pagar o preço agora

```js
// notificationService.js — hoje
async function enfileirarEnvio(payload) {
  return pushProvider.enviar(payload);   // execução imediata
}

// no dia da migração para fila — MESMA assinatura, ninguém que chama muda
async function enfileirarEnvio(payload) {
  return filaPush.add('enviar', payload, { attempts: 3, backoff: 'exponential' });
}
```

Isto resolve o item 18 do pedido original por isolamento de função, não por instalar a
infraestrutura com antecedência.

### 12.3 Roteiro de adoção, quando o gatilho aparecer

1. `docker-compose.yml` ganha um serviço `redis` (`redis:7-alpine`), ao lado de `db`.
2. `REDIS_URL` em `.env`, no mesmo padrão de `DATABASE_URL`/`GEMINI_API_KEY`.
3. `npm install ioredis bullmq` no backend.
4. Rate limit: trocar o store padrão por `rate-limit-redis` — configuração, não lógica.
5. `enfileirarEnvio()` passa a publicar numa `Queue` do BullMQ; um `Worker` novo
   (`backend/src/jobs/pushWorker.js`) consome e chama o mesmo `pushProvider` de sempre.

---

## 13. Estrutura de pastas — adaptada, não a sugerida no pedido original

O pedido original sugere `backend/src/modules/notifications/*`. O projeto real é
`controllers/`, `services/`, `routes/`, `lib/`, `messaging/` como pastas de topo, sem
agrupamento por módulo — seguir a estrutura existente evita que este seja o único
recurso organizado de um jeito diferente do resto do sistema.

```
backend/src/
├── controllers/
│   ├── PushController.js           (subscribe / unsubscribe)
│   └── NotificationController.js   (listar / marcar como lida)
├── services/
│   └── notificationService.js      (ponto único — §4)
├── messaging/
│   └── pushProvider.js             (molde de whatsappProvider.js)
├── routes/
│   ├── push.js
│   └── notificacoes.js
├── seeds/
│   └── 003_notificacao_tipos.seed.js
└── (o cron não ganha arquivo novo — estende lembreteAgendamentoService.js)

frontend/
├── public/
│   ├── manifest.webmanifest
│   └── sw.js
└── src/
    ├── components/
    │   ├── NotificationBell.tsx
    │   └── NotificationList.tsx
    ├── pages/
    │   └── ConfiguracaoNotificacoes.tsx
    ├── hooks/
    │   └── useNotificacoes.ts        (store único, molde de useVetPendentes.ts)
    └── services/
        └── push.ts                  (registro do SW + subscribe/unsubscribe)
```

---

## 14. Decisões que preciso de você

| # | Pergunta | Recomendação proposta |
|---|---|---|
| D1 | WhatsApp some ou os dois canais convivem? | Conviver por um período — desligar o WhatsApp de uma vez é reversível só numa direção (cliente que dependia dele perde o aviso se o Push falhar silenciosamente, ex.: clínica inteira em iPhone fora do modo instalado). Medir taxa de entrega do Push antes de desligar. |
| D2 | Quais tipos vêm ligados por padrão, e para qual perfil, na Fase 1? | Seed fixo: lembrete de consulta ligado para Veterinário/Gestor, desligado para Estagiário/Proprietário, até a Fase 4 (matriz por perfil) existir. Precisa de validação de quem opera as clínicas hoje. |
| D3 | Retenção do histórico de `Notification`? | Manter tudo por padrão; se o volume incomodar, cron de limpeza do que passou de `readAt` + 90 dias, no espírito do `cancelar_orcamentos_vencidos` (regra visível, não faxina silenciosa). |
| D4 | Redis: instalar agora "por segurança" ou só quando um gatilho do §12.1 aparecer? | Só quando um gatilho aparecer — ver §11. |

---

## 15. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| iOS exige PWA instalado para Web Push funcionar | Parte da equipe em iPhone/iPad não recebe nada até instalar | UI detecta e orienta explicitamente (§5.3); manifest é pré-requisito, não enfeite |
| Usuário nega a permissão do navegador | Sem Push possível para aquele dispositivo | Mensagem clara de como reverter nas configurações do SO/navegador (item 20 do pedido original) — nunca simular que o botão funcionou |
| Subscription expira sem avisar (troca de aparelho, cache limpo) | Envio falha silenciosamente até o próximo ciclo de erro 404/410 | `notificationService` marca `enabled=false` no primeiro 404/410 — não tenta indefinidamente |
| Dois canais (WhatsApp + Push) divergirem com o tempo | Mensagem chega diferente ou só por um dos dois | Mesmo tick de cron gera os dois (§6) — não duas fontes de verdade |
