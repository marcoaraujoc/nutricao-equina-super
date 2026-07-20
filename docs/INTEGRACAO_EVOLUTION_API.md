# Integração Evolution API — WhatsApp por clínica

> Implementado em 2026-07-18. Cada clínica possui uma **instância exclusiva** da
> Evolution API, administrada 100% dentro da aplicação (sem painel da Evolution).
> O telefone usado é o **WhatsApp principal já cadastrado** na configuração da
> clínica (`EmpresaConfiguracao.whatsapp`) — nenhum campo novo, nenhum re-pedido.

---

## 1. Arquitetura em camadas

```mermaid
flowchart LR
  subgraph Frontend
    CFG[Configuracoes.tsx<br/>Status · Conectar · Reconectar · Desconectar]
  end
  subgraph Backend
    WC[WhatsappController<br/>/api/equipes/whatsapp/*]
    WH[routes/webhooks.js<br/>/api/webhooks/evolution]
    WS[whatsappService.js<br/>fachada p/ a aplicação]
    EV[EvolutionService.js<br/>ÚNICA camada HTTP]
    DB[(tb_empresa_configuracoes<br/>wa_instance · wa_status · wa_status_em)]
    LB[lembreteAgendamentoService<br/>via whatsappProvider 'evolution']
  end
  EXT[[Evolution API]]

  CFG -->|axios /api| WC --> WS
  LB --> WS
  WS --> EV --> EXT
  EXT -->|webhook| WH --> WS --> DB
  WS --> DB
```

Regras de dependência (invioláveis):
- **Só o `EvolutionService`** faz HTTP contra a Evolution (axios). Nenhum outro módulo.
- **Só o `whatsappService`** conhece instância/escopo — o restante da aplicação chama
  `sendMessage(clinic, phone, message)` e nunca vê a Evolution.
- O **frontend nunca recebe** API key, nome de instância ou URL da Evolution — apenas
  `status` e `qrcodeBase64`.

## 2. Identidade da instância

Escopo de "clínica" = mesmo escopo da `EmpresaConfiguracao`:

| Tipo de empresa | Escopo | Nome da instância |
|---|---|---|
| CNPJ | `(empresaId, equipeId=null)` | `s2vet_e{empresaId}` |
| Pessoal (CPF) | `(empresaId, equipeId)` | `s2vet_e{empresaId}_q{equipeId}` |

Colunas novas em `tb_empresa_configuracoes` (migration `20260718170000_whatsapp_instancia`):
`wa_instance` (unique), `wa_status` (`DESCONECTADO` | `AGUARDANDO_QR` | `CONECTADO`),
`wa_status_em`. Acesso via SQL parametrizado (client Prisma pode estar desatualizado).

## 3. Endpoints da Evolution utilizados

| Método do EvolutionService | Endpoint Evolution |
|---|---|
| `createInstance` | `POST /instance/create` (com webhook + events embutidos) |
| `deleteInstance` | `DELETE /instance/delete/{instance}` |
| `connect` / `getQRCode` | `GET /instance/connect/{instance}` |
| `logout` / `disconnect` | `DELETE /instance/logout/{instance}` |
| `restart` | `POST /instance/restart/{instance}` |
| `getStatus` | `GET /instance/connectionState/{instance}` |
| `sendText` | `POST /message/sendText/{instance}` |
| `sendImage` / `sendDocument` / `sendVideo` | `POST /message/sendMedia/{instance}` |
| `sendAudio` | `POST /message/sendWhatsAppAudio/{instance}` |
| `getProfile` | `POST /chat/fetchProfile/{instance}` |

Todas com header `apikey: EVOLUTION_API_KEY`, timeout (`EVOLUTION_TIMEOUT_MS`, default 15s)
e **retry** (2 tentativas extras com backoff para rede/5xx; 4xx não re-tenta). Erros viram
`EvolutionError` com `code` estável (`EVOLUTION_NAO_CONFIGURADA`, `INSTANCIA_NAO_ENCONTRADA`,
`EVOLUTION_INDISPONIVEL`).

## 4. Sequência de chamadas

### Cadastro da clínica (provisão automática)
```mermaid
sequenceDiagram
  participant App as EquipeController/EquipeService
  participant WS as whatsappService
  participant EV as EvolutionService
  App->>WS: provisionarPorEmpresa(empresaId)  [fire-and-forget]
  WS->>WS: resolverEscopoClinica → garantirInstancia
  WS->>EV: createInstance(nome, {numero: config.whatsapp})
  EV-->>WS: ok (ou "already exists" → adota)
  WS->>WS: salva wa_instance + status no banco
  Note over WS: Falhou? loga e NÃO salva (rollback);<br/>o 1º "Conectar" refaz a criação
```

### Conectar pela tela de Configurações
```mermaid
sequenceDiagram
  participant FE as Configuracoes.tsx
  participant BC as WhatsappController
  participant WS as whatsappService
  participant EV as EvolutionService
  participant EX as Evolution API
  FE->>BC: POST /api/equipes/whatsapp/conectar
  BC->>WS: conectar(escopo)
  WS->>EV: garantirInstancia + connect
  EV->>EX: GET /instance/connect/{i}
  EX-->>FE: (via BC) { status: AGUARDANDO_QR, qrcodeBase64 }
  FE->>FE: exibe QR + polling GET /whatsapp/status a cada 4s
  EX->>BC: webhook connection.update (state=open)
  BC->>WS: atualizarStatusPorInstancia → CONECTADO
  FE->>FE: polling detecta CONECTADO → fecha QR + toast
```

### Envio de mensagem (qualquer módulo)
```
whatsappService.sendMessage({ empresaId, equipeId? }, phone, message)
  → resolverEscopoClinica → busca wa_instance → confirma status CONECTADO
  → EvolutionService.sendText(instancia, numero, texto)
  → { sucesso, id } | { sucesso:false, erro: WHATSAPP_DESCONECTADO | ... }
```

## 5. Webhook

`POST /api/webhooks/evolution?token=EVOLUTION_WEBHOOK_TOKEN` (registrado na criação da
instância). Eventos tratados — sempre atualizando o banco automaticamente:

| Evento | Ação |
|---|---|
| `connection.update` | `wa_status` ← estado mapeado (`open`→CONECTADO etc.) |
| `qrcode.updated` | `wa_status` ← AGUARDANDO_QR |
| `logout` / `logout.instance` | `wa_status` ← DESCONECTADO |
| `application.startup` | apenas log (próximo status sincroniza) |
| `messages.upsert` | apenas log (aplicação ainda não tem inbox) |

Token inválido → 401. Erros de processamento nunca derrubam a resposta (200 sempre que
autenticado — evita fila de reentrega na Evolution).

## 6. Pontos alterados na aplicação

| Arquivo | Mudança |
|---|---|
| `prisma/migrations/20260718170000_whatsapp_instancia` + `schema.prisma` | colunas `wa_instance`/`wa_status`/`wa_status_em` na `EmpresaConfiguracao` |
| `src/services/EvolutionService.js` | **novo** — única camada HTTP da Evolution |
| `src/services/whatsappService.js` | fachada Evolution por clínica (API legada Z-API `sendWhatsApp` preservada) |
| `src/controllers/WhatsappController.js` | **novo** — status/conectar/reconectar/desconectar (gestor) |
| `src/routes/equipes.js` | rotas `/whatsapp/*` (antes de `/:equipeId`) |
| `src/routes/webhooks.js` + `server.ts` | **novo** — `/api/webhooks/evolution` |
| `src/controllers/EquipeController.js` | export de `resolverEscopoConfiguracao`; provisão em `criarEmpresa` e `convidarGestorAdmin` |
| `src/services/EquipeService.js` | provisão em `criarEmpresaEEquipe` (pós-transaction) |
| `src/messaging/whatsappProvider.js` | provider `evolution` (lembretes usam a instância da clínica) |
| `src/services/lembreteAgendamentoService.js` | `contexto` ganhou `empresaId`/`equipeId` |
| `frontend/src/pages/Configuracoes.tsx` | seção Status + Conectar (QR inline + polling) + Reconectar + Desconectar |
| `backend/.env.example` | `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`, `EVOLUTION_TIMEOUT_MS`, `WHATSAPP_PROVIDER` |

Nenhum módulo existente teve comportamento alterado: a API legada Z-API segue exportada
(`sendWhatsApp`) e os lembretes continuam no provider `noop` até `WHATSAPP_PROVIDER=evolution`.

## 7. Configuração (env)

```
EVOLUTION_URL=https://seu-servidor-evolution.com
EVOLUTION_API_KEY=...            # apikey global do servidor Evolution
EVOLUTION_WEBHOOK_TOKEN=...      # token aleatório validado no webhook
EVOLUTION_TIMEOUT_MS=15000       # opcional
WHATSAPP_PROVIDER=evolution      # liga os lembretes de agendamento via Evolution
APP_URL=https://app.exemplo.com  # base da URL pública do webhook
```
Sem `EVOLUTION_URL`/`EVOLUTION_API_KEY`, a integração fica inerte: a tela mostra
"Integração não configurada" e a provisão automática é silenciosamente ignorada.

## 8. Passo a passo — subir e configurar

### 8.1 Ambiente LOCAL (Windows, sem Docker) — estado atual

A instalação local já foi feita em 2026-07-18 (clone em `D:\Projetos\evolution-api`,
banco `dbevolution` no PostgreSQL local, build de produção, chaves geradas e gravadas
nos dois `.env`). O passo a passo abaixo serve para reproduzir do zero em outra máquina:

1. **Pré-requisitos**: Node ≥ 20 e PostgreSQL local (os mesmos do S2Vet).
2. **Clonar e instalar**:
   ```powershell
   cd D:\Projetos
   git clone --depth 1 https://github.com/EvolutionAPI/evolution-api.git
   cd evolution-api
   npm install
   ```
3. **Banco próprio da Evolution** (isolado do dbs2vet):
   ```sql
   CREATE DATABASE dbevolution;   -- no mesmo PostgreSQL, usuário nutriadmin
   ```
4. **`.env` da Evolution** (raiz do clone) — mínimo funcional sem Redis:
   ```env
   SERVER_TYPE=http
   SERVER_PORT=8080
   SERVER_URL=http://localhost:8080
   LANGUAGE=pt-BR
   DATABASE_ENABLED=true
   DATABASE_PROVIDER=postgresql
   DATABASE_CONNECTION_URI=postgresql://USUARIO:SENHA@localhost:5432/dbevolution
   DATABASE_CONNECTION_CLIENT_NAME=evolution
   DATABASE_SAVE_DATA_INSTANCE=true
   CACHE_REDIS_ENABLED=false
   CACHE_LOCAL_ENABLED=true
   AUTHENTICATION_API_KEY=<chave forte — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
   DEL_INSTANCE=false
   QRCODE_LIMIT=30
   LOG_LEVEL=ERROR,WARN,INFO
   ```
5. **Migrations + build**:
   ```powershell
   npm run db:generate
   # migrations (equivalente ao db:deploy em bash):
   Remove-Item -Recurse -Force prisma\migrations -ErrorAction SilentlyContinue
   Copy-Item -Recurse prisma\postgresql-migrations prisma\migrations
   npx prisma migrate deploy --schema prisma\postgresql-schema.prisma
   npm run build
   ```
6. **Subir** (a partir do repositório do S2Vet):
   ```powershell
   .\infra\evolution\start-evolution.ps1
   ```
   Teste: `curl http://localhost:8080/` → `"Welcome to the Evolution API..."`.
7. **Ligar o S2Vet** — `backend/.env`:
   ```env
   EVOLUTION_URL=http://localhost:8080
   EVOLUTION_API_KEY=<a MESMA AUTHENTICATION_API_KEY do passo 4>
   EVOLUTION_WEBHOOK_TOKEN=<outra chave aleatória>
   WHATSAPP_PROVIDER=evolution
   ```
   Reinicie o backend do S2Vet.
8. **Conectar a clínica**: login como gestor → **Configurações** → seção WhatsApp →
   **Conectar WhatsApp** → ler o QR com o celular da clínica → status vira "Conectado".
   (Em dev sem webhook público, o polling da tela sincroniza o status; com Cloudflare
   Tunnel no `APP_URL`, o webhook também chega.)

Solução de problemas locais:
- Porta 8080 não responde → confira a janela do node (start-evolution.ps1) e o
  `DATABASE_CONNECTION_URI`; a Evolution não sobe sem Postgres acessível.
- Tela mostra "Integração não configurada" → `EVOLUTION_URL`/`EVOLUTION_API_KEY`
  ausentes no `backend/.env` ou backend não foi reiniciado.
- 401 nas chamadas → `EVOLUTION_API_KEY` (S2Vet) ≠ `AUTHENTICATION_API_KEY` (Evolution).

### 8.2 Migração para a VPS (produção)

Arquivos prontos em `infra/evolution/` (docker-compose.yml + .env.exemplo).

1. **Provisionar a VPS** (Ubuntu 22.04+ recomendado) e instalar Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. **DNS**: crie um subdomínio para a Evolution (ex.: `evo.seudominio.com.br` → IP da VPS).
3. **Copiar a stack**: envie a pasta `infra/evolution/` para a VPS (ex.: `/opt/evolution`).
4. **Configurar**: `cp .env.exemplo .env` e preencha:
   - `EVOLUTION_API_KEY` — **a mesma** do `backend/.env` do S2Vet;
   - `EVOLUTION_DB_PASSWORD` — senha nova do Postgres da Evolution;
   - `EVOLUTION_PUBLIC_URL=https://evo.seudominio.com.br`.
5. **Subir**: `docker compose up -d` (Evolution + Postgres próprio + Redis, com
   volumes persistentes e restart automático). Teste: `curl http://localhost:8080/`.
6. **Reverse proxy com HTTPS** (Caddy é o mais simples):
   ```
   evo.seudominio.com.br {
     reverse_proxy localhost:8080
     # bloqueia o painel da Evolution — administração é 100% pelo S2Vet
     @manager path /manager*
     respond @manager 404
   }
   ```
   Firewall: exponha só 80/443 (a 8080 fica interna).
7. **Apontar o S2Vet da produção** (`backend/.env` da VPS):
   ```env
   EVOLUTION_URL=https://evo.seudominio.com.br
   EVOLUTION_API_KEY=<a mesma do compose>
   EVOLUTION_WEBHOOK_TOKEN=<mesma lógica — chave aleatória>
   WHATSAPP_PROVIDER=evolution
   APP_URL=https://app.seudominio.com.br   # o webhook é montado a partir daqui
   ```
   Reinicie o backend.
8. **Reconectar as clínicas**: as sessões de WhatsApp NÃO migram do ambiente local —
   na primeira vez em produção, cada clínica clica **Conectar WhatsApp** e lê o QR de
   novo (o S2Vet recria a instância automaticamente).
9. **Backup**: os volumes `evolution_pgdata` e `evolution_instances` guardam banco e
   sessões — inclua-os na rotina de backup da VPS.

## 9. Como adicionar funcionalidades futuras

- **Novo tipo de envio** (ex.: enviar fatura em PDF): adicione um método fino no
  `whatsappService` (ex.: `sendDocumentMessage(clinic, phone, url, nome)`) que resolve o
  escopo/instância e delega para `EvolutionService.sendDocument`. Nunca chame o
  EvolutionService direto de um controller.
- **Inbox / respostas de clientes**: trate `messages.upsert` no `routes/webhooks.js`
  (hoje só loga) e persista numa tabela própria; o corpo do evento traz `instance`
  (→ clínica via `wa_instance`) e a mensagem.
- **Novo evento de webhook**: inclua-o em `EVENTOS_WEBHOOK` (EvolutionService) e no
  `switch` do webhook.
- **Excluir instância ao excluir empresa**: chamar `EvolutionService.deleteInstance`
  no fluxo de exclusão (hoje a FK cascade limpa só o banco).
- **Trocar de provedor de WhatsApp**: implemente outro provider em
  `messaging/whatsappProvider.js` e/ou outra fachada — os callers não mudam.
