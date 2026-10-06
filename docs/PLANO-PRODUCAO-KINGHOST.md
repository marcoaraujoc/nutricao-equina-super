# S2Vet — Plano de subida para produção na KingHost

> 🔴 **SUBSTITUÍDO em 2026-10-06 por `docs/DEPLOY-PRODUCAO.md`.** As VPS foram criadas com
> **Ubuntu 24.04** (não 20.04) e em **duas máquinas** (Frontend 177.153.69.147 e Backend
> 177.153.69.171), com VPC por WireGuard. Este arquivo fica só como histórico da avaliação
> do provedor — **não execute os passos daqui**.

> **Data:** 2026-10-03 · **Branch:** `feature/mvp-v1.0`
>
> **Complementa** `docs/PLANO-PRODUCAO-HOSTINGER.md` (a base: Cloudflare, backup, Nginx,
> deploy, testes) e `docs/DEPLOY-PRODUCAO.md` (o porquê de cada exigência do código).
> Este documento diz **o que muda** ao trocar de provedor, e só repete o que muda.
> Onde diz "igual à Hostinger §X", execute aquela seção sem alteração.
>
> ✅ confirmado nas páginas públicas da KingHost em 2026-10-03 · ❓ **não confirmado** —
> pergunte ao suporte antes de contratar.

---

## 1. A KingHost é equivalente à Hostinger?

**Para este projeto: sim, com três diferenças que mudam o plano.** A KingHost serve — tem
root, SSD, IP dedicado, datacenter no Brasil, SLA 99,9% e firewall por regras — mas **não é
um espelho** da Hostinger.

| Requisito do S2Vet | Hostinger | KingHost | Veredito |
|---|---|---|---|
| Root + SSH por chave | ✅ | ✅ root; senha e chave | Equivalente |
| Datacenter no Brasil | ✅ | ✅ (infra nacional) | Equivalente |
| Docker (Evolution) e Node | ✅ | ✅ (planos citam Docker/Node) | Equivalente |
| Firewall antes da VPS | ✅ grupo hPanel, só **entrada** | ✅ regras de **entrada e saída**, no painel do **IP** | Equivalente, até melhor (tem saída) |
| Snapshot | ✅ um por vez | ✅ citado na wiki; ❓ limites | Confirmar |
| Backup automático da VPS | semanal grátis | ❓ não encontrado | **Irrelevante**: o backup que vale é o `pg_dump` cifrado fora do provedor (Hostinger §14.1) |
| **Ubuntu 24.04** | ✅ | ❌ **só Ubuntu 20.04** (sem suporte padrão desde 04/2025) | **DIFERENÇA 1** |
| **Rede privada entre VPS** | ❌ (por isso o WireGuard) | ❓ não encontrada | **DIFERENÇA 2** |
| **Porta 587 de saída (Brevo)** | ✅ | ❓ não documentado para VPS | **Testar antes** (§6) |
| WAF / DDoS de aplicação | ❌ (usa Cloudflare) | ❓ a wiki cita um "Smart WAF", provavelmente do produto de hospedagem | Manter **Cloudflare** |
| **NAT estático** | n/a | ⚠️ na wiki: com NAT estático **todas as portas ficam abertas por padrão** | **DIFERENÇA 3** |
| Preço (16 GB) | KVM 4 | **R$ 125,90/mês** (8 vCPU, 240 GB SSD) | KingHost é competitiva |

### As três diferenças

1. **Sistema operacional.** O plano da Hostinger assume Ubuntu 24.04. Na KingHost a wiki
   lista Ubuntu **20.04**, Debian 10/11/**12**, Rocky 8/9 e AlmaLinux 8/9. Ubuntu 20.04 saiu
   do suporte padrão em abril/2025: **não use**. A escolha recomendada é **Debian 12** — usa
   `apt` e `ufw`, então 90% dos comandos do plano da Hostinger valem. Rocky/Alma 9 também
   servem, mas trocam `apt` por `dnf` e exigem lidar com SELinux. ❓ A wiki pode estar
   desatualizada: se o painel oferecer **Ubuntu 22.04/24.04**, prefira.
2. **Topologia.** Sem rede privada confirmada, as duas VPS do plano original exigiriam
   WireGuard (que continua funcionando igual). **Recomendação: começar com UMA VPS** (§2). É
   mais simples e, com a API escutando em `127.0.0.1`, **não perde segurança** — a porta
   3001 e o banco nem existem para a rede.
3. **NAT estático = tudo aberto.** Ao contrário da Hostinger (padrão *drop*), na KingHost
   você deve **criar as regras de entrada explicitamente** e conferir de fora que o resto
   está fechado. O S2Vet usa Cloudflare Tunnel: **nenhuma porta de entrada é necessária**.

---

## 2. Arquitetura alvo (UMA VPS)

```
Internet ─► Cloudflare (DNS · WAF · TLS) ─► Cloudflare Tunnel (saída da VPS)
                                                    │
 VPS KingHost 16 GB (Debian 12) ─────────────────────▼───────────────────────
   cloudflared ─► Nginx 127.0.0.1:8090
                    ├─ /       → /var/www/s2vet/current  (estático do Vite)
                    └─ /api/*  → 127.0.0.1:3001           (Node, HOST=127.0.0.1)
   PostgreSQL 16     127.0.0.1:5432  (schema schs2vet, RLS fail-closed)
   Docker: Evolution 127.0.0.1:8080  (ver §5)
   Tailscale (SSH) · UFW · backup cifrado → bucket externo
```

Pontos que **não mudam** e continuam obrigatórios (Hostinger §3.2): same-origin
(`app.s2vet.com.br` serve estático **e** `/api`), **uma única instância** do Node (os
crons rodam dentro dele), dois usuários de banco (`nutriadmin` dono / `zls2vetp1` app),
cookie `Secure`, upload ≤ 95 MB (Cloudflare corta em 100 MB).

> **Quando migrar para duas VPS:** se a clínica-cliente exigir isolamento, ou o disco/RAM
> apertarem. Aí vale a Hostinger §9–§11 inteira (WireGuard + Nginx no FE); troque só o SO.

**Tamanho:** plano **VPS 16 GB** (8 vCPU, 240 GB). O de 8 GB (R$ 63,90) funciona no
piloto, mas Chrome headless + LibreOffice + Postgres + Evolution disputam RAM.

---

## 3. O que muda, seção a seção da Hostinger

| Seção da Hostinger | Na KingHost |
|---|---|
| §0–§1 Decisões D1–D7 | **Iguais.** D6 (Tailscale) continua valendo |
| §2 Particularidades H1–H10 | **Substituída pela tabela do item 1 acima** |
| §3 Arquitetura (2 VPS) | **Substituída pelo item 2** (1 VPS) |
| §4 DNS, §5 contas, §13 integrações | **Iguais** |
| §7 Fase 0 (ensaio local) | **Igual** — faça num **Debian 12** local/VM, não Ubuntu |
| §8 Provisionamento | Igual, **com os ajustes do item 4** |
| §9 WireGuard | **Pular** (1 VPS) |
| §10 Backend/Banco | Igual, **com os ajustes dos itens 4 e 5**; `HOST=127.0.0.1` |
| §11 Frontend | Nginx e Tunnel **na mesma VPS**; `upstream` aponta para `127.0.0.1:3001`; sem usuário `deploy` nem rsync |
| §12 Firewall | **KingHost** (item 3) no lugar do hPanel; UFW igual |
| §14 Backup, §15 aceite, §16 deploy | Iguais, **com os ajustes do item 6** |

---

## 4. Ajustes de sistema (Debian 12 em vez de Ubuntu 24.04)

```bash
# 8.2 — igual, mas sem 'needrestart' (é do Ubuntu) e com sudo explícito
apt update && apt -y full-upgrade
apt -y install sudo ufw fail2ban unattended-upgrades curl git rsync jq htop ca-certificates gnupg
```

- **SSH:** o Debian não tem o `50-cloud-init.conf` do Ubuntu, mas o arquivo
  `00-s2vet.conf` da Hostinger §8.4 funciona igual. Se a KingHost injetar um arquivo
  próprio em `sshd_config.d/`, confira com `sshd -T | grep -i passwordauth`.
- **Pacotes do Chrome (Puppeteer):** os nomes **sem `t64`** (isso era do Ubuntu 24.04):
  `libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libglib2.0-0 libgtk-3-0` + o resto da
  lista. Se algum nome falhar: `apt-cache search <nome>`.
- **PostgreSQL 16:** o Debian 12 traz o **15**. Instale o 16 pelo repositório oficial:
  ```bash
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt update && apt -y install postgresql-16 postgresql-contrib
  ```
  Os caminhos `/etc/postgresql/16/main/` da Hostinger §10.2 passam a valer.
  🔴 Confirme na Fase 0 que o **dump de dev** foi gerado numa versão ≤ 16 (`SELECT version()`).
- **Node 22:** NodeSource funciona no Debian 12 (Hostinger §10.4 igual).
- **Docker:** `curl -fsSL https://get.docker.com | sh` igual.
- **Tailscale:** igual (§8.3.1). `--ssh=false` e a ACL com tag continuam valendo.
- **systemd, UFW, fail2ban, swap, journald:** iguais.

---

## 5. Evolution (WhatsApp) na mesma VPS

Na Hostinger a Evolution ocupava `127.0.0.1:8080` na VPS do Backend. Aqui o **Nginx usa o
8080** (listener do túnel). Duas saídas — escolha a **primeira**:

1. Nginx escuta `127.0.0.1:8090` (ajuste o *service* do túnel e o `listen`) e a Evolution
   fica em `127.0.0.1:8080`, **sem tocar** em `EVOLUTION_URL=http://127.0.0.1:8080`.
2. Deixar o Nginx em 8080 e publicar a Evolution em `127.0.0.1:8081` (`"127.0.0.1:8081:8080"`),
   com `EVOLUTION_URL=http://127.0.0.1:8081` e `SERVER_URL` igual.

O `infra/evolution/docker-compose.yml` **já foi corrigido neste repositório** para publicar
só em loopback (era `"8080:8080"`, que o Docker expõe por cima do UFW). Falta fixar a
**versão** da imagem (hoje `:latest`).

---

## 6. Firewall e testes específicos da KingHost

### 6.1 Firewall do painel (substitui Hostinger §12.2)

No painel: **IP público da VPS → aba Firewall**.

| Direção | Regra | Por quê |
|---|---|---|
| Entrada | **nenhuma** (política padrão bloqueando) | SSH vem pelo Tailscale; o site, pelo Cloudflare Tunnel — ambos são conexões **de saída** da VPS |
| Saída | liberar 443, 587, 7844 (TCP/UDP), 53, 80, 123 | Cloudflare, Brevo, Gemini, Tailscale, apt, NTP |

🔴 Com NAT estático, **sem regra de entrada explícita tudo fica aberto**. Confirme o estado
real antes de qualquer outra coisa.
❓ Pergunte ao suporte: o firewall é *stateful*? Há restrição de **UDP** de saída (Tailscale
usa 41641 e relays; o túnel usa 7844)?

### 6.2 Testes antes de contratar o plano definitivo (peça um mês de teste ou use o menor plano)

```bash
# 1. Porta de saída do e-mail (Brevo) — o ponto mais provável de bloqueio
nc -vz smtp-relay.brevo.com 587
# 2. Saída do túnel Cloudflare
nc -vz region1.v2.argotunnel.com 7844
# 3. Versões disponíveis no painel: há Ubuntu 22.04/24.04?
# 4. De fora (seu PC): nada responde nas portas da VPS
nmap -Pn -p 22,80,443,3001,5432,8080 <IP_VPS>      # tudo filtered
```

Se a **587 estiver bloqueada**: plano B do e-mail = Resend por HTTPS (exige adicionar o
pacote `resend` ao `backend/package.json` — Hostinger C9, ainda **não** feito). Sem e-mail
não há código de 2FA nem reset de senha: **teste isso primeiro**.

### 6.3 Aceite

Igual à Hostinger §15, **mais**: S1/S2 passam a testar a VPS única (tudo `filtered`), e F1–F13
rodam como estão. O item "tudo filtered" pesa mais aqui, por causa do NAT estático.

---

## 7. Mudanças feitas no código (neste commit de trabalho, **não commitadas**)

| Arquivo | Mudança | Por quê |
|---|---|---|
| `backend/src/server.ts` | `app.listen` aceita `HOST` (env). Sem ele, escuta em todas as interfaces como antes | Com `HOST=127.0.0.1` a API **não existe** fora da máquina, mesmo que o firewall falhe. Era o ajuste C1 do plano da Hostinger |
| `backend/.env.example` | documenta `HOST` | — |
| `infra/evolution/docker-compose.yml` | porta `127.0.0.1:8080:8080` + aviso para fixar versão | Era C4: o Docker ignora o UFW e expunha a API que controla o WhatsApp de todas as clínicas |

Validado: `npx tsc --noEmit` do backend sem erros. **Nenhuma migration, nenhum dado e nenhum
serviço externo foram tocados.**

No `backend.env` de produção desta topologia:
```
HOST=127.0.0.1
TRUST_PROXY_HOPS=1      # Nginx → Node: um salto confiável (o Nginx reescreve o X-Forwarded-For)
APP_URL=https://app.s2vet.com.br
ALLOWED_ORIGINS=https://app.s2vet.com.br
COOKIE_SECURE=true
```

**Não alterados (e por quê):**
- C2 (`@prisma/client` para `dependencies`): o `deploy.sh` usa `npm ci` completo, então não
  derruba nada; mexer exigiria regenerar o `package-lock.json` num working tree já cheio de mudanças.
- C3 (`backend/Dockerfile`): este plano não usa Docker para a aplicação. O arquivo está em
  UTF-16 e usa `node:20` — se um dia for usado, precisa de revisão.
- Fixar a versão da imagem da Evolution: depende de qual versão você testou em dev.

---

## 8. Roteiro resumido

1. Contratar o menor plano de teste; rodar os testes do **§6.2**. **Decisão go/no-go do provedor.**
2. Fase 0 (Hostinger §7) num Debian 12 local, com o dump real e o script de limpeza.
3. Criar a VPS 16 GB (Debian 12, ou Ubuntu 22.04/24.04 se existir), chave SSH, regras de firewall do §6.1.
4. Base: Hostinger §8, com o §4 acima. SSH só pelo Tailscale, depois fechar tudo.
5. Postgres 16 (PGDG), roles, restore, **backup antes de qualquer deploy** (Hostinger §10.2–10.3, §14.1).
6. Node, Chrome, LibreOffice, Evolution (§5), `backend.env` com `HOST=127.0.0.1`.
7. Nginx + Cloudflare Tunnel na mesma VPS (Hostinger §11 sem rsync/deploy-user).
8. `deploy.sh` adaptado: sem `rsync` para outra máquina — publique `dist/` direto em `/var/www/s2vet/releases/$TS` e troque o symlink local.
9. Cloudflare WAF/rate limit (Hostinger §12.1), integrações (§13), monitores (§14.3).
10. Aceite (§6.3), piloto com uma clínica, go-live.

## 9. Perguntas para o suporte da KingHost (mandar antes de contratar)

1. Há imagem **Ubuntu 22.04 ou 24.04** (ou Debian 12 com kernel atualizado) na VPS Linux?
2. A porta **587 de saída** está liberada em VPS? Existe limite de e-mails por minuto?
3. O firewall do IP é *stateful*? Qual o limite de regras? Filtra **UDP** de saída?
4. Como o **NAT estático** se comporta: qual é o estado padrão das portas de entrada?
5. Snapshot: quantos, retenção, custo? Existe backup automático da VPS?
6. Há **console web/modo de recuperação** caso o SSH/firewall trave?
7. Há proteção **DDoS** de rede incluída? Rede privada entre duas VPS?
8. O disco é NVMe ou SSD SATA? (o banco guarda anexos de até 150 MB em `bytea`)

---

*Fontes (consultadas em 2026-10-03):* [Planos VPS KingHost](https://king.host/servidor-vps) ·
[Sistemas operacionais da VPS](https://king.host/wiki/artigo/vps-kinghost-quais-sistemas-operacionais-posso-instalar/) ·
[VPS Linux](https://king.host/wiki/artigo/vps-linux/) ·
[Política SMTP](https://king.host/wiki/artigo/politica-smtp/) ·
[Checklist VPS](https://king.host/blog/solucoes-em-nuvem/configurar-vps/)
