# S2Vet — Plano de subida para produção na Hostinger

> **Papéis assumidos neste documento:** arquitetura de software, arquitetura de
> infraestrutura, segurança e gerência de projeto.
>
> **Data:** 2026-10-01 · **Branch de referência:** `feature/mvp-v1.0` (commit `546385d`)
>
> **Complementa** `docs/DEPLOY-PRODUCAO.md` — aquele explica o PORQUÊ de cada exigência
> do código (same-origin, dois usuários de banco, RLS, cookie). Este diz COMO montar
> isso na Hostinger, em duas VPS, com WAF e firewall, passo a passo.
>
> Tudo o que está marcado com 🔴 derruba a subida ou abre um furo de segurança se for
> pulado. ⚠️ é armadilha conhecida. ✅ é verificação que prova que o passo funcionou.

---

## Sumário

0. [Resumo executivo — respostas diretas](#0-resumo-executivo--respostas-diretas)
1. [Decisões que só você pode tomar (antes de começar)](#1-decisões-que-só-você-pode-tomar)
2. [Particularidades da Hostinger (verificadas)](#2-particularidades-da-hostinger-verificadas)
3. [Arquitetura alvo](#3-arquitetura-alvo)
4. [Domínios e DNS](#4-domínios-e-dns)
5. [Pré-requisitos — contas, serviços e segredos](#5-pré-requisitos--contas-serviços-e-segredos)
6. [Dimensionamento](#6-dimensionamento)
7. [Fase 0 — Ensaio geral local](#7-fase-0--ensaio-geral-local-obrigatório)
8. [Fase 1 — Provisionamento e hardening base (as duas VPS)](#8-fase-1--provisionamento-e-hardening-base-as-duas-vps)
9. [Fase 2 — Túnel WireGuard (a "VPC" privada)](#9-fase-2--túnel-wireguard-a-vpc-privada)
10. [Fase 3 — VPS Backend + Banco](#10-fase-3--vps-backend--banco)
11. [Fase 4 — VPS Frontend](#11-fase-4--vps-frontend)
12. [Fase 5 — WAF (Cloudflare) e Firewall (hPanel + UFW)](#12-fase-5--waf-cloudflare-e-firewall-hpanel--ufw)
13. [Fase 6 — Integrações externas](#13-fase-6--integrações-externas)
14. [Fase 7 — Backup, monitoração e logs](#14-fase-7--backup-monitoração-e-logs)
15. [Fase 8 — Testes de aceite e go-live](#15-fase-8--testes-de-aceite-e-go-live)
16. [Rotina de atualização (deploy) e rollback](#16-rotina-de-atualização-deploy-e-rollback)
17. [Gestão do projeto — cronograma, riscos, LGPD](#17-gestão-do-projeto--cronograma-riscos-lgpd)
18. [Ajustes recomendados no código (não aplicados)](#18-ajustes-recomendados-no-código-não-aplicados)
19. [Fontes](#19-fontes)

---

## 0. Resumo executivo — respostas diretas

| Pergunta | Resposta curta |
|---|---|
| **Ubuntu é problema?** | Não. **Ubuntu Server 24.04 LTS** é a escolha recomendada (suporte até 2029, 10 anos com Ubuntu Pro gratuito para até 5 máquinas). Há 4 armadilhas específicas do 24.04, todas tratadas neste plano: nomes de pacote com sufixo `t64`, `sshd_config.d/50-cloud-init.conf` que reabilita senha, AppArmor bloqueando o sandbox do Chrome e o Docker furando o UFW. Use o template **"Ubuntu 24.04" puro** — não os templates com painel (CloudPanel, Coolify etc.). |
| **Hostinger tem particularidade?** | Sim, e a principal muda o desenho: **a Hostinger NÃO oferece rede privada/VPC entre VPS** (cada VPS tem só um IP público). A "VPC" vira um **túnel WireGuard** cifrado entre as duas máquinas + firewall. Outras: firewall do hPanel filtra **só entrada**; backup automático é **semanal** (diário é pago); snapshot é **um por vez**. Detalhes na [§2](#2-particularidades-da-hostinger-verificadas). |
| **Duas VPS (Frontend / Backend+Banco) faz sentido?** | Faz, e é o que este plano monta. O ganho real: a VPS de Backend **não tem nenhuma porta web aberta para a internet** — só aceita o túnel vindo da VPS de Frontend. Comprometer o Frontend não dá acesso direto ao banco. |
| **WAF?** | **Cloudflare** na frente (plano Free para começar; **Pro recomendado** em produção pelo conjunto de regras OWASP). A Hostinger não oferece WAF para VPS — o "DDoS protection" dela é de rede (camada 3/4), não de aplicação. |
| **Firewall?** | Três camadas: **firewall gerenciado do hPanel** (antes do pacote chegar à VPS) + **UFW** em cada VPS + **Cloudflare Tunnel**, que elimina a porta 443 pública da VPS de Frontend. Não existe "appliance" de firewall (pfSense) na Hostinger sem rede privada. |
| **`s2vet.com.br` e `s2vet.com`?** | Registre **os dois**. **`.com.br` é o domínio canônico** (público brasileiro, exige CPF/CNPJ — passa confiança). `.com` só redireciona (301) para o `.com.br` e protege a marca contra terceiros. **Nunca rode a aplicação nos dois** (cookie, login Google, links de e-mail e CORS assumem UMA origem). Recomendação: aplicação em **`app.s2vet.com.br`** — ver decisão D2. |

### A sequência inteira em uma tela

```
Semana 1  D1–D6 decididas · domínios registrados · contas criadas · Fase 0 (ensaio local)
Semana 2  Fase 1 (VPS + hardening) · Fase 2 (WireGuard) · Fase 3 (banco + backend)
Semana 3  Fase 4 (frontend) · Fase 5 (Cloudflare + firewalls) · Fase 6 (integrações)
Semana 4  Fase 7 (backup + monitoração) · Fase 8 (aceite) · piloto com 1 clínica · go-live
```

---

## 1. Decisões que só você pode tomar

O plano assume a opção **recomendada** em cada uma. Mudar qualquer uma muda passos
específicos (indicados).

| # | Decisão | Opções | Recomendação | Afeta |
|---|---|---|---|---|
| **D1** | **Com que dados a produção nasce?** | **A)** "Imagem dourada": dump do banco de desenvolvimento → produção, depois limpeza das empresas/usuários de teste. **B)** Banco vazio: 220 migrations do zero + seeds. | **A.** Os catálogos (medicamentos, procedimentos, especialidades, modelos de documento, planos, regiões anatômicas…) foram mantidos **pelas telas**, no banco — as planilhas foram só carga inicial e **não devem ser reaplicadas**. A opção B nasce com catálogo vazio ou desatualizado. ⚠️ A limpeza de dados de teste precisa de um script revisado por você antes de rodar. | §7, §10.3 |
| **D2** | **Endereço da aplicação** | **A)** `app.s2vet.com.br` (apex `s2vet.com.br` redireciona para ele). **B)** `s2vet.com.br` direto (é o que o `DEPLOY-PRODUCAO.md` assumia). | **A.** Deixa o apex livre para um site institucional no futuro sem trocar o `APP_URL` — que fica gravado em todo link de e-mail já enviado (reset de senha, convite, fatura). Trocar depois quebra esses links. Funciona igual tecnicamente (cookie é host-only). | §4, §11, §12 |
| **D3** | **Plano do Cloudflare** | Free · Pro (~US$ 20–25/mês) | **Free para o ensaio, Pro no go-live.** O Pro adiciona o *Cloudflare Managed Ruleset* + *OWASP Core Ruleset*, 20 regras customizadas e *Super Bot Fight Mode* com exceções. | §12 |
| **D4** | **Limite de upload** | Manter 150 MB (exige Cloudflare Business ~US$ 200/mês) · Baixar para ~95 MB | **95 MB.** Cloudflare Free/Pro corta qualquer requisição acima de **100 MB** com um 413 próprio, antes de chegar à aplicação. Vídeo de prontuário maior que isso precisa ser comprimido. | §10.6, §12 |
| **D5** | **WhatsApp em produção no dia 1?** | Sim (Evolution API) · Não (`WHATSAPP_PROVIDER=noop`) | Sim, mas ciente do risco: a Evolution usa o protocolo **não oficial** do WhatsApp Web (Baileys). A Meta pode banir o número. Plano de longo prazo: WhatsApp Cloud API oficial. | §10.8, §17.2 |
| **D6** | **Acesso administrativo (SSH)** | **A)** SSH aberto só para o seu IP fixo. **B)** Tailscale (VPN de administração) e nenhuma porta SSH pública. | **B** se seu IP de casa/escritório muda (quase sempre muda). **A** se você tem IP fixo. O plano mostra as duas. | §8.4, §12.3 |

---

## 2. Particularidades da Hostinger (verificadas)

Conferidas na documentação oficial da Hostinger em 2026-10-01 (links na [§19](#19-fontes)).

| # | Particularidade | Impacto no plano |
|---|---|---|
| H1 | 🔴 **Não há rede privada / VPC entre VPS.** Cada VPS recebe um IP público dedicado; não existe segunda interface com IP privado. | O "isolamento de VPCs" é feito com **WireGuard** (túnel cifrado) + **firewall**. O tráfego Frontend → Backend passa cifrado pela internet entre os dois datacenters. Coloque **as duas VPS no MESMO datacenter** (Brasil) para latência mínima. |
| H2 | **Firewall gerenciado no hPanel** (VPS → Segurança → Firewall): filtra **antes** do pacote chegar à VPS, padrão **DROP**, suporta IPv4 e IPv6, TCP/UDP/ICMP/GRE, origem "qualquer lugar" ou personalizada, um grupo pode ser aplicado a vários servidores, e a mudança leva **até 2 minutos**. Filtra **só entrada**. | É a 1ª barreira de rede. Como roda fora da VPS, protege inclusive quando o Docker fura o UFW. Saída (egress) é controlada no UFW. Crie **dois grupos** (Frontend e Backend) — as regras são diferentes. |
| H3 | **Backup automático semanal gratuito**; diário é pago. Até 4 retidos (2 diários + 2 semanais). **Snapshot manual: um por vez**, apagado ao reinstalar o SO ou restaurar backup, e com validade curta. | 🔴 **O backup da Hostinger NÃO substitui o backup do banco.** Uma semana de prontuário perdida é inaceitável. O plano faz `pg_dump` diário, cifrado, **fora da Hostinger** ([§14](#14-fase-7--backup-monitoração-e-logs)). Snapshot só antes de mudança grande. |
| H4 | **Porta 25 não é bloqueada**, mas a Hostinger documenta limite de **5 e-mails/minuto por servidor**. | A aplicação já usa **Brevo pela porta 587** (relay autenticado). Teste no servidor (`npm run email:testar`). Se houver bloqueio/limitação, trocar para **Resend via HTTPS (443)** — é só variável de ambiente, já previsto no código. |
| H5 | **DDoS protection** de rede incluída. | Não cobre camada 7 (aplicação). Isso é papel do **Cloudflare**. |
| H6 | **Datacenter no Brasil** disponível. | Escolha Brasil: latência para as clínicas e conveniência de LGPD (a lei não exige dado no Brasil, mas simplifica). |
| H7 | **Monarx** (scanner de malware) pode vir instalado no template. | Pode manter — é leve. Não substitui as outras camadas. |
| H8 | **Reverse DNS (PTR)** configurável no hPanel. | Irrelevante para envio (usamos Brevo), mas configure o PTR com o hostname para higiene. |
| H9 | **Terminal pelo navegador / modo de recuperação** no hPanel. | É o seu "break-glass" se o firewall trancar o SSH. 🔴 **Teste que ele funciona ANTES de restringir o SSH.** |
| H10 | O template pode habilitar **login root por senha**. | Desligado na [§8.4](#84-ssh-endurecido). |

⚠️ **Não verificado na documentação** (confirme com o suporte se for relevante): limite
de regras do firewall do hPanel e se ele é *stateful* (deixa voltar a resposta de uma
conexão iniciada pela VPS). O plano inclui uma regra redundante que funciona nos dois
casos ([§12.2](#122-firewall-do-hpanel-1ª-barreira-de-rede)).

---

## 3. Arquitetura alvo

### 3.1 Diagrama

```
                         Internet (clínicas, celulares)
                                      │  HTTPS 443
                                      ▼
                  ┌───────────────────────────────────────────┐
                  │ CLOUDFLARE  (DNS · WAF · DDoS L7 · TLS ·   │
                  │             rate limit · HSTS · cache)    │
                  └─────────────────────┬─────────────────────┘
                                        │ Cloudflare Tunnel (conexão de SAÍDA
                                        │ iniciada pela VPS — nenhuma porta aberta)
   ╔════════════════════════════════════▼═══════════════════════════════════╗
   ║ VPS FRONTEND  ("VPC Frontend")            IP público: <IP_FE>          ║
   ║  firewall hPanel: só SSH do admin (ou nada, com Tailscale)             ║
   ║  cloudflared ──► nginx 127.0.0.1:8080                                  ║
   ║                    ├─ /         → estático (frontend/dist)             ║
   ║                    └─ /api/*    → 10.50.0.2:3001 (pelo túnel WG)       ║
   ║  wg0 = 10.50.0.1                                                       ║
   ╚════════════════════════════════════╤═══════════════════════════════════╝
                                        │ WireGuard UDP 51820 (cifrado)
   ╔════════════════════════════════════▼═══════════════════════════════════╗
   ║ VPS BACKEND + BANCO  ("VPC Backend")      IP público: <IP_BE>          ║
   ║  firewall hPanel: UDP 51820 só de <IP_FE> · SSH só do admin            ║
   ║  wg0 = 10.50.0.2                                                       ║
   ║  Node 22 (systemd, 1 instância) :3001  ← aceita só via wg0             ║
   ║    ├─ Puppeteer/Chrome (PDF, CRMV) · LibreOffice (.doc) · ffmpeg       ║
   ║    └─ node-cron (jobs internos)                                        ║
   ║  PostgreSQL 16  127.0.0.1:5432  (schema schs2vet, RLS fail-closed)     ║
   ║  Docker: Evolution API 127.0.0.1:8080 + Postgres + Redis próprios      ║
   ╚════════════════════════════════════╤═══════════════════════════════════╝
                                        │ só SAÍDA (HTTPS/587)
          Gemini API · Brevo SMTP · WhatsApp (via Evolution) · SISCAD/CFMV
          Backblaze B2 / Cloudflare R2 (backup cifrado)
```

### 3.2 Por que este desenho (e não outro)

1. **Same-origin é exigência do código, não preferência** (`DEPLOY-PRODUCAO.md §1`):
   a defesa contra CSRF **é** o `SameSite=Lax` do cookie; as URLs de mídia são gravadas
   **relativas** (`/api/midia/<chave>`); e todo request leva `x-empresa-id`. Por isso o
   navegador só enxerga `https://app.s2vet.com.br` — o Nginx do Frontend entrega o
   estático E repassa `/api/*` ao Backend. O Backend **não tem domínio próprio**.
2. **Cloudflare Tunnel em vez de porta 443 aberta:** o `cloudflared` abre uma conexão de
   **saída** para o Cloudflare. A VPS de Frontend não precisa de nenhuma porta web
   aberta, o IP dela pode vazar sem consequência, e não há certificado de origem para
   renovar. (Alternativa sem túnel na [§12.5](#125-alternativa-sem-tunnel-porta-443-restrita-ao-cloudflare).)
3. **WireGuard entre as VPS** substitui a rede privada que a Hostinger não tem (H1).
4. **Banco na mesma VPS do Backend** (como você pediu) e escutando **só em
   `127.0.0.1`**: nunca há porta 5432 exposta, nem pelo túnel.
5. **Uma única instância do Node.** 🔴 Os jobs (`node-cron`) rodam DENTRO do processo da
   API: duas instâncias = fechamento de fatura duas vezes e lembrete de WhatsApp
   duplicado para o cliente. **Nunca** usar PM2 em modo *cluster* nem `instances > 1`.
   Escalar horizontalmente exige antes tirar os crons para um worker separado.

### 3.3 Matriz de tráfego (o que pode falar com o quê)

| Origem | Destino | Porta | Caminho | Permitido? |
|---|---|---|---|---|
| Internet | VPS Frontend | qualquer | público | ❌ (só SSH do admin, se D6=A) |
| Cloudflare | VPS Frontend | — | túnel iniciado pela VPS | ✅ (saída da VPS) |
| VPS Frontend | VPS Backend | UDP 51820 | público | ✅ só do `<IP_FE>` |
| Frontend (wg0) | Backend (wg0) | TCP 3001 | túnel | ✅ |
| Backend (wg0) | Frontend (wg0) | TCP 22 | túnel | ✅ (deploy do estático) |
| Internet | VPS Backend | 3001 / 5432 / 8080 | público | ❌ **nunca** |
| VPS Backend | Internet | 443, 587, 7844 | saída | ✅ |
| Seu PC | as duas VPS | TCP 22 | público ou Tailscale | ✅ só você |

---

## 4. Domínios e DNS

### 4.1 Recomendação

| Domínio | Papel | Onde registrar |
|---|---|---|
| **`s2vet.com.br`** | **Canônico.** Aplicação (`app.`), e-mail transacional (`noreply@`), futuro site no apex. | **Registro.br** (exige CPF/CNPJ). 🔴 Registre no **CNPJ da empresa** que vai operar o SaaS, não no seu CPF — é ativo da empresa e aparece em due diligence. |
| **`s2vet.com`** | **Proteção de marca** + 301 para o `.com.br`. Evita que alguém registre e faça phishing com os seus clientes. | Cloudflare Registrar (preço de custo) ou Hostinger. |

**Por que não usar os dois para a aplicação:** o cookie de sessão é *host-only*, o login
Google só aceita origens cadastradas, `APP_URL` é um valor só (vai nos links de e-mail)
e `ALLOWED_ORIGINS` precisa ser exato. Dois domínios ativos = metade dos usuários com
login quebrado.

💡 Considere também registrar a marca **S2Vet no INPI** (classe 42 — software/SaaS; e
classe 44 — serviços veterinários, se fizer sentido). Domínio não é marca.

### 4.2 DNS no Cloudflare

1. Crie a conta Cloudflare → *Add a site* → `s2vet.com.br` → plano (D3).
2. No **Registro.br** → seu domínio → **DNS** → "Alterar servidores DNS" → coloque os
   dois *nameservers* que o Cloudflare informar. Propagação: minutos a algumas horas.
3. Repita para `s2vet.com`.
4. **DNSSEC:** Cloudflare → DNS → Settings → *Enable DNSSEC* → copie o registro DS →
   Registro.br → DNSSEC → cole. ✅ `https://dnsviz.net/d/s2vet.com.br/dnssec/` sem erros.

Registros (`s2vet.com.br`):

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| CNAME | `app` | *criado automaticamente pelo Cloudflare Tunnel* (§11.4) | 🟠 sim |
| A | `@` | `192.0.2.1` (placeholder — só para a regra de redirect) | 🟠 sim |
| CNAME | `www` | `s2vet.com.br` | 🟠 sim |
| TXT | `@` | SPF — valor do painel do **Brevo** (+ provedor de caixa postal, se houver) | — |
| TXT/CNAME | *(Brevo)* | DKIM — valores do painel do Brevo | — |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@s2vet.com.br; fo=1` | — |
| MX | `@` | do provedor de caixa postal (Google Workspace, Zoho, Hostinger Email…) | — |
| CAA | `@` | `0 issue "letsencrypt.org"` + `0 issue "pki.goog"` + `0 issue "digicert.com"` *(opcional; o Cloudflare usa essas ACs)* | — |

🔴 **Não crie registro A apontando para `<IP_BE>`.** O Backend não tem nome público.
🔴 Não crie registro para `<IP_FE>` se usar o Tunnel — o IP da origem não deve aparecer
no DNS.

DMARC: comece em `p=none`, leia os relatórios por 2–4 semanas, depois `p=quarantine`.

Redirects (Cloudflare → *Rules* → *Redirect Rules*):
- `s2vet.com.br` e `www.s2vet.com.br` → `https://app.s2vet.com.br` (302 enquanto não
  houver site; 301 quando for definitivo).
- `s2vet.com` e `www.s2vet.com` → `https://app.s2vet.com.br` (301, preservando path e
  query).

> Se escolher D2 = B (aplicação no apex), troque `app.s2vet.com.br` por
> `s2vet.com.br` em TODO este documento e faça `www` → apex.

---

## 5. Pré-requisitos — contas, serviços e segredos

### 5.1 Contas e serviços

| # | Item | Para quê | Status |
|---|---|---|---|
| P1 | Hostinger — 2 VPS KVM no **datacenter Brasil** | Frontend e Backend | ☐ |
| P2 | Registro.br (`s2vet.com.br`) + registrador do `.com` | Domínios | ☐ |
| P3 | Cloudflare (conta + Zero Trust para o Tunnel) | DNS, WAF, Tunnel | ☐ |
| P4 | **Brevo** (ou Resend) com o domínio **verificado** (SPF+DKIM) | 2FA, reset de senha, convite, PDF por e-mail | ☐ |
| P5 | Caixa postal do domínio (`contato@`, `dmarc@`) | Receber e-mail | ☐ |
| P6 | Google Cloud — projeto de **produção** com **billing** | Gemini API (o *free tier* devolve 429 `limit: 0` — já aconteceu) e OAuth | ☐ |
| P7 | Google Cloud — **OAuth Client ID** (Web) | Login com Google (`VITE_GOOGLE_CLIENT_ID`) | ☐ |
| P8 | Armazenamento externo de backup: **Backblaze B2** ou **Cloudflare R2**, com versionamento/Object Lock | Backup fora da Hostinger | ☐ |
| P9 | Monitor externo: **UptimeRobot** ou **Better Stack** | Saber que caiu antes do cliente | ☐ |
| P10 | Gerenciador de senhas (Bitwarden/1Password) | Guardar TODOS os segredos abaixo | ☐ |
| P11 | Chip/número dedicado de WhatsApp por clínica (se D5 = sim) | Evolution API | ☐ |
| P12 | GitHub: *deploy key* **somente leitura** no repositório | A VPS baixa o código | ☐ |
| P13 | Tailscale (se D6 = B) | Acesso administrativo | ☐ |

### 5.2 Segredos a gerar (todos NOVOS — nenhum reaproveitado do desenvolvimento)

🔴 Os segredos de desenvolvimento já circularam (ver `docs/SEGURANCA-SECRET-HISTORICO.md`).
Produção nasce com valores próprios.

| Segredo | Como gerar | Onde fica |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | `.env` do backend |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (🔴 **diferente** do anterior) | `.env` do backend |
| Senha da role `nutriadmin` (dona/migrations) | `openssl rand -base64 33 \| tr -d '/+='` | `.env` + gerenciador |
| Senha da role `zls2vetp1` (aplicação) | idem | `.env` + gerenciador |
| `EVOLUTION_API_KEY` | `openssl rand -hex 32` | `.env` backend + `.env` Evolution |
| `EVOLUTION_WEBHOOK_TOKEN` | `openssl rand -hex 32` (🔴 obrigatório — vazio deixa o webhook ABERTO) | `.env` backend |
| `EVOLUTION_DB_PASSWORD` | `openssl rand -base64 33 \| tr -d '/+='` | `.env` Evolution |
| Chave SMTP do Brevo | painel do Brevo | `.env` backend |
| `GEMINI_API_KEY` (produção, restrita por IP) | Google Cloud | `.env` backend |
| Chave de cifragem de backup (`age`) | `age-keygen` **no seu PC** | 🔴 chave PRIVADA **fora** do servidor; pública no servidor |
| Token do Cloudflare Tunnel | painel Zero Trust | só no comando de instalação |

⚠️ O `tr -d '/+='` evita caracteres que precisariam de *URL-encoding* dentro da
`DATABASE_URL` — senha com `/` ou `@` quebra a conexão com erro confuso.

---

## 6. Dimensionamento

| | VPS Frontend | VPS Backend + Banco |
|---|---|---|
| Plano Hostinger | **KVM 1** (1 vCPU · 4 GB · 50 GB NVMe) | **KVM 4** (4 vCPU · 16 GB · 200 GB NVMe) — mínimo aceitável KVM 2 (8 GB) |
| Carga | Nginx + cloudflared (leve) | Node + PostgreSQL + Chrome headless + LibreOffice + Evolution (Node+Postgres+Redis) |
| Swap | 1 GB | 4 GB |
| SO | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Datacenter | Brasil | Brasil (o MESMO) |

**Por que 16 GB no Backend:** Chrome headless (PDF por WhatsApp/e-mail, raspagem do
CRMV) consome 300–600 MB por execução; LibreOffice outro tanto na conversão de `.doc`;
o Postgres quer RAM para cache; e a Evolution sobe três contêineres. Em 8 GB funciona,
mas um pico de PDF + conversão + IA ao mesmo tempo leva o sistema ao swap.

**Disco:** os anexos (foto, laudo, vídeo até 95–150 MB) moram **no Postgres** (`bytea`).
O banco e o dump crescem com eles. Monitore (§14.3); quando passar de ~60% do disco, o
caminho previsto é o `S3StorageProvider` (`DEPLOY-PRODUCAO.md §6`), sem mudar controller.

*(Confira as especificações e preços vigentes no checkout da Hostinger — os planos
mudam.)*

---

## 7. Fase 0 — Ensaio geral local (obrigatório)

🔴 **Nada vai para a Hostinger antes de este ensaio passar.** São 220 migrations, RLS
*fail-closed* e roles com nome fixo — o tipo de coisa que dá erro na primeira vez e
precisa dar erro **no seu PC**, não no servidor de produção.

Faça num Ubuntu 24.04 local (WSL2 no Windows, VirtualBox ou uma VPS de teste barata).

### 7.1 Fatos que o ensaio precisa confirmar

1. **Versão do Postgres de desenvolvimento** (produção usa a mesma *major*):
   ```sql
   SELECT version();
   SHOW timezone;          -- produção replica este valor (§10.2)
   \dx                     -- extensões: pg_trgm e em qual schema
   ```
2. **As roles têm nome FIXO nas migrations.** `20260806160000_fase6_grants_zls2vetp1`
   faz `GRANT ... TO "zls2vetp1"` e `ALTER DEFAULT PRIVILEGES FOR ROLE "nutriadmin"`.
   Em produção as roles **precisam se chamar exatamente** `nutriadmin` (dona do schema,
   roda migrations) e `zls2vetp1` (aplicação). Outro nome = migration falha.

### 7.2 Gerar a "imagem dourada" (D1 = A)

No PC de desenvolvimento (PowerShell), **como superusuário `postgres`**:

```powershell
pg_dump -U postgres -h localhost -Fc -d dbs2vet -f s2vet_golden.dump
```

🔴 **Tem de ser superusuário.** As tabelas estão com `FORCE ROW LEVEL SECURITY`, que
vale **até para o dono**: `pg_dump` como `nutriadmin` ou `zls2vetp1` falha com
`query would be affected by row-level security policy` (ou, pior, exporta vazio). Isso
vale também para o backup diário em produção (§14).

### 7.3 Restaurar no Ubuntu de ensaio

Execute exatamente a [§10.2](#102-postgresql-16) e a [§10.3](#103-carga-inicial-dos-dados-d1--a)
neste ambiente. Depois:

```bash
cd backend
npm ci && npx prisma generate && npm run build
DATABASE_URL="$DATABASE_URL_MIGRATIONS" npx prisma migrate status   # deve dizer: up to date
npm start   # sobe? /health responde 200?
```

✅ Critério de saída da Fase 0:
- [ ] restore sem erro relevante (erro de `role "X" does not exist` para roles de dev é esperado — anote quais)
- [ ] `migrate status` = *Database schema is up to date*
- [ ] login funciona com a aplicação conectada como **`zls2vetp1`**
- [ ] `SELECT rolbypassrls FROM pg_roles WHERE rolname='zls2vetp1'` → `false`
- [ ] gerar um PDF (prescrição → WhatsApp/e-mail) funciona no Linux (prova do Chrome)
- [ ] `npm run doc:check` → `✓ CONVERSÃO OK`
- [ ] o **script de limpeza de dados de teste** (D1) foi escrito, revisado e testado aqui

---

## 8. Fase 1 — Provisionamento e hardening base (as duas VPS)

Execute esta fase **igual nas duas VPS**. Onde diferir, está marcado `[FE]` / `[BE]`.

### 8.1 Criar as VPS no hPanel

1. hPanel → VPS → contratar KVM 1 `[FE]` e KVM 4 `[BE]`, **datacenter Brasil**.
2. SO: **Ubuntu 24.04** (template limpo, sem painel).
3. **Cadastre sua chave SSH pública** no assistente (gere no seu PC se não tiver:
   `ssh-keygen -t ed25519 -C "marco@s2vet"`).
4. Hostname: `s2vet-fe-01` / `s2vet-be-01`.
5. Anote `<IP_FE>` e `<IP_BE>` (IPv4 e IPv6).
6. hPanel → **ative o firewall gerenciado já agora**, com UMA regra: aceitar TCP 22 do
   seu IP. (As regras completas vêm na §12.2.)
7. 🔴 **Teste o terminal do navegador do hPanel** (H9) com o firewall ativo. Ele é sua
   saída se você se trancar fora.

### 8.2 Primeiro acesso e atualização

```bash
ssh root@<IP>

# Evita os prompts interativos do needrestart do Ubuntu 24.04 durante o apt
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

apt update && apt -y full-upgrade
timedatectl set-timezone America/Sao_Paulo      # paridade com o ambiente de desenvolvimento
hostnamectl set-hostname s2vet-be-01            # [FE]: s2vet-fe-01
apt -y install ufw fail2ban unattended-upgrades curl git rsync jq htop ca-certificates gnupg
reboot
```

### 8.3 Usuário administrativo (nunca operar como root)

```bash
adduser marco                      # use uma senha forte (para sudo)
usermod -aG sudo marco
install -d -m 700 -o marco -g marco /home/marco/.ssh
cp /root/.ssh/authorized_keys /home/marco/.ssh/
chown marco:marco /home/marco/.ssh/authorized_keys && chmod 600 /home/marco/.ssh/authorized_keys
```

✅ Em **outro** terminal: `ssh marco@<IP>` e `sudo -v` funcionam. Só então siga.

### 8.4 SSH endurecido

🔴 **Armadilha do Ubuntu 24.04:** o cloud-init grava
`/etc/ssh/sshd_config.d/50-cloud-init.conf` com `PasswordAuthentication yes`, e o
`sshd` usa o **PRIMEIRO** valor que lê. Um arquivo `99-...` seria ignorado. Por isso o
nome começa com `00-`:

```bash
sudo tee /etc/ssh/sshd_config.d/00-s2vet.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
# "local" permite túnel SSH para o Postgres (DBeaver) sem permitir abrir portas remotas
AllowTcpForwarding local
AllowUsers marco
EOF
# [FE] troque a última linha por:  AllowUsers marco deploy
sudo sshd -t && sudo systemctl restart ssh
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|allowusers)'
```

✅ Esperado: `passwordauthentication no`, `permitrootlogin no`. Teste um novo login
**antes** de fechar a sessão atual.

### 8.5 UFW (firewall do host — 2ª barreira)

Regras base agora; as específicas de cada VPS entram nas §9 e §12.3.

```bash
sudo sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <IP_ADMIN> to any port 22 proto tcp comment 'SSH admin'   # D6=A
sudo ufw enable
sudo ufw status verbose
```

### 8.6 fail2ban

```bash
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd
banaction = ufw

[sshd]
enabled = true
EOF
sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd
```

⚠️ Se o fail2ban não subir no 24.04 (erro de `asynchat` com Python 3.12), rode
`sudo apt -y upgrade fail2ban` — o pacote corrigido está no repositório de updates.
⚠️ fail2ban no Nginx **não serve** aqui: atrás do Cloudflare todo IP visto é do túnel.
Bloqueio de IP de cliente é feito no Cloudflare (§12.1).

### 8.7 Atualizações automáticas de segurança

```bash
sudo dpkg-reconfigure -plow unattended-upgrades     # responda "Yes"
sudo tee /etc/apt/apt.conf.d/52s2vet-unattended >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
```

Reboot é **manual**, em janela combinada (§16.4) — um reboot às 23:40 derruba o
fechamento de fatura daquele dia.

### 8.8 Swap e limites de log

```bash
sudo fallocate -l 4G /swapfile        # [FE]: 1G
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-s2vet.conf && sudo sysctl --system

sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=2G\n' | sudo tee /etc/systemd/journald.conf.d/s2vet.conf
sudo systemctl restart systemd-journald
```

### 8.9 Ubuntu Pro (opcional, gratuito até 5 máquinas)

`sudo pro attach <TOKEN>` → habilita **Livepatch** (patch de kernel sem reboot) e ESM.
Token em `ubuntu.com/pro`.

---

## 9. Fase 2 — Túnel WireGuard (a "VPC" privada)

Substitui a rede privada que a Hostinger não oferece (H1). Endereços: Frontend
`10.50.0.1`, Backend `10.50.0.2`.

### 9.1 Nas duas VPS

```bash
sudo apt -y install wireguard
cd /etc/wireguard && sudo sh -c 'umask 077; wg genkey | tee private.key | wg pubkey > public.key'
sudo cat /etc/wireguard/public.key      # anote: <PUB_FE> e <PUB_BE>
```

### 9.2 `[BE]` `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address    = 10.50.0.2/24
ListenPort = 51820
PrivateKey = <conteúdo de /etc/wireguard/private.key do BE>

[Peer]
# VPS Frontend
PublicKey  = <PUB_FE>
AllowedIPs = 10.50.0.1/32
```

### 9.3 `[FE]` `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address    = 10.50.0.1/24
PrivateKey = <conteúdo de /etc/wireguard/private.key do FE>

[Peer]
# VPS Backend
PublicKey           = <PUB_BE>
Endpoint            = <IP_BE>:51820
AllowedIPs          = 10.50.0.2/32
PersistentKeepalive = 25
```

### 9.4 Firewall do túnel e subida

```bash
# [BE]
sudo ufw allow from <IP_FE> to any port 51820 proto udp comment 'WireGuard do FE'
sudo ufw allow in on wg0 from 10.50.0.1 to 10.50.0.2 port 3001 proto tcp comment 'API via tunel'
# [FE]
sudo ufw allow in on wg0 from 10.50.0.2 to 10.50.0.1 port 22 proto tcp comment 'deploy do estatico via tunel'

# [AMBAS]
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo wg show
```

✅ `[FE]` `ping -c3 10.50.0.2` responde e `sudo wg show` mostra *latest handshake* recente.
✅ `[BE]` `sudo ss -ulpn | grep 51820` escuta.

Lembre de liberar `UDP 51820 de <IP_FE>` também no firewall do hPanel do BE (§12.2) —
são duas barreiras e as duas precisam deixar passar.

---

## 10. Fase 3 — VPS Backend + Banco

Tudo nesta seção é `[BE]`.

### 10.1 Usuário de serviço e diretórios

```bash
sudo adduser --system --group --home /opt/s2vet --shell /bin/bash s2vet
sudo install -d -o s2vet -g s2vet -m 750 /opt/s2vet/{releases,shared,home,bin,.cache}
sudo install -d -o root  -g root  -m 700 /var/backups/s2vet
```

Layout:
```
/opt/s2vet/
  releases/20261015T1030/     ← cada deploy é uma pasta nova (clone do git)
  current -> releases/...     ← symlink que o systemd usa
  shared/backend.env          ← segredos (0640 root:s2vet)
  shared/frontend.env         ← VITE_GOOGLE_CLIENT_ID (build do front)
  home/                       ← HOME do serviço (perfil do LibreOffice)
  .cache/puppeteer/           ← Chrome baixado pelo Puppeteer
  bin/deploy.sh
```

### 10.2 PostgreSQL 16

Ubuntu 24.04 traz o PostgreSQL 16 no repositório oficial (mesma *major* do CI do
projeto). Se a Fase 0 mostrar outra *major* em desenvolvimento, instale a mesma pelo
repositório PGDG (`apt.postgresql.org`).

```bash
sudo apt -y install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

**`/etc/postgresql/16/main/conf.d/s2vet.conf`** (para 16 GB de RAM dividida com o resto):

```ini
listen_addresses = 'localhost'           # 🔴 nunca '*': o banco não sai da máquina
password_encryption = scram-sha-256
timezone = 'America/Sao_Paulo'           # 🔴 paridade com o desenvolvimento (confirme na Fase 0)
max_connections = 100
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 512MB
wal_compression = on
log_min_duration_statement = 1000        # loga consultas acima de 1s
log_lock_waits = on
log_temp_files = 0
```

⚠️ **Por que o `timezone`:** a base foi desenvolvida e testada com a sessão em
`America/Sao_Paulo`. O código foi corrigido para `NOW() AT TIME ZONE 'UTC'`
(CLAUDE.md §6), mas trocar o fuso da sessão em produção é testar em produção uma
combinação que nunca rodou.

**`/etc/postgresql/16/main/pg_hba.conf`** — substitua as linhas `host` por:

```
# TYPE  DATABASE  USER         ADDRESS        METHOD
local   all       postgres                    peer
local   all       all                         peer
host    dbs2vet   nutriadmin   127.0.0.1/32   scram-sha-256
host    dbs2vet   zls2vetp1    127.0.0.1/32   scram-sha-256
host    dbs2vet   nutriadmin   ::1/128        scram-sha-256
host    dbs2vet   zls2vetp1    ::1/128        scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

**Roles e banco** (`sudo -u postgres psql`):

```sql
-- 🔴 Nomes EXATOS — as migrations os referenciam (§7.1).
CREATE ROLE nutriadmin LOGIN PASSWORD '<SENHA_NUTRIADMIN>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE zls2vetp1  LOGIN PASSWORD '<SENHA_ZLS2VETP1>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE dbs2vet OWNER nutriadmin ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE dbs2vet FROM PUBLIC;
GRANT CONNECT ON DATABASE dbs2vet TO zls2vetp1;
```

🔴 **A role da aplicação (`zls2vetp1`) NUNCA pode ser dona de tabela, ter `BYPASSRLS`,
`CREATE` no schema ou `TRUNCATE`.** Qualquer um desses desliga o isolamento entre
clínicas — e o sintoma é **nenhum**: tudo funciona, sem isolamento. Os motivos estão
escritos na própria migration `20260806160000`.

⚠️ **Não crie a extensão `pg_trgm` manualmente** num banco vazio: a migration cria no
schema certo. No restore da imagem dourada (D1 = A) ela vem no dump.

### 10.3 Carga inicial dos dados (D1 = A)

```bash
# do seu PC:   scp s2vet_golden.dump marco@<IP_BE>:/tmp/
sudo -u postgres pg_restore --exit-on-error=false -d dbs2vet /tmp/s2vet_golden.dump 2>&1 | tee /tmp/restore.log
sudo shred -u /tmp/s2vet_golden.dump          # o dump tem dado pessoal — não deixe largado
```

Depois, como `postgres`:
```sql
\c dbs2vet
-- conferências de segurança
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('nutriadmin','zls2vetp1');
SELECT count(*) FILTER (WHERE tableowner = 'zls2vetp1') AS tabelas_da_app,   -- tem de ser 0
       count(*) FILTER (WHERE tableowner = 'nutriadmin') AS tabelas_do_dono
FROM pg_tables WHERE schemaname = 'schs2vet';
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'schs2vet' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity;
```

Em seguida:
1. 🔴 **Rodar o script de limpeza de dados de teste** revisado na Fase 0 (empresas,
   usuários, faturas e pacientes de teste; tokens de refresh, reset de senha e desafios
   de 2FA; instâncias de WhatsApp apontando para a Evolution de desenvolvimento).
2. Trocar a senha da conta ADMIN da plataforma pelo fluxo da tela, depois do go-live.

> D1 = B (banco vazio): pule o restore e rode `migrate deploy` + `node seed.js`
> (permissões e modelos CFMV) + `node scripts/seedEspecialidades.js` +
> `node scripts/carregarMarcaProduto.js`, e crie o ADMIN. Os catálogos nascem vazios.

### 10.4 Node.js 22 LTS

Mesma *major* do desenvolvimento (v22). LTS até abril/2027.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt -y install nodejs build-essential
node -v && npm -v
```

### 10.5 Dependências de sistema da aplicação

**Chrome headless (Puppeteer)** — gera os PDFs enviados por WhatsApp/e-mail e raspa o
CRMV. 🔴 No Ubuntu 24.04 várias bibliotecas mudaram de nome (sufixo `t64`); a lista
antiga da internet falha com "pacote não encontrado".

```bash
sudo apt -y install \
  fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 libcups2t64 \
  libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
  libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 xdg-utils
```

⚠️ O AppArmor do 24.04 bloqueia o *sandbox* do Chrome. O código já lança com
`--no-sandbox` no Linux (`documentoWhatsappService.js`, `crmvScraperService.js`) — não
remova essas flags.

**LibreOffice** (conversão `.doc` → `.docx`; opcional, degrada sem quebrar):
```bash
sudo apt -y install --no-install-recommends libreoffice-writer fontconfig fonts-liberation
```

`ffmpeg` vem embutido no pacote npm (`@ffmpeg-installer`) e os modelos do Tesseract
(`eng/por.traineddata`) estão versionados no repositório — nada a instalar.

**Chave de leitura do repositório** (como `s2vet`):
```bash
sudo -u s2vet ssh-keygen -t ed25519 -N '' -f /opt/s2vet/.ssh/id_ed25519 -C s2vet-be-deploy
sudo cat /opt/s2vet/.ssh/id_ed25519.pub
# GitHub → repositório → Settings → Deploy keys → Add (SEM "Allow write access")
sudo -u s2vet ssh -T git@github.com     # aceite a fingerprint
```

### 10.6 Arquivo de ambiente do backend

`/opt/s2vet/shared/backend.env` — `sudo chown root:s2vet` e `sudo chmod 640`:

```bash
NODE_ENV=production
PORT=3001

# ── Banco: DOIS usuários (DEPLOY-PRODUCAO.md §3) ──
DATABASE_URL="postgresql://zls2vetp1:<SENHA_ZLS2VETP1>@127.0.0.1:5432/dbs2vet?schema=schs2vet&connection_limit=10&options=-c search_path=schs2vet"
DATABASE_URL_MIGRATIONS="postgresql://nutriadmin:<SENHA_NUTRIADMIN>@127.0.0.1:5432/dbs2vet?schema=schs2vet&options=-c search_path=schs2vet"

# ── Sessão ──
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32, diferente>
COOKIE_SECURE=true

# ── Origem pública (D2) ──
APP_URL=https://app.s2vet.com.br
ALLOWED_ORIGINS=https://app.s2vet.com.br
# Um único proxy CONFIÁVEL na frente do Node: o Nginx do FE, que já reescreve o
# X-Forwarded-For com o IP real do cliente (§11.3). Ver a explicação lá.
TRUST_PROXY_HOPS=1

# ── Upload (D4) — abaixo do teto de 100 MB do Cloudflare Free/Pro ──
UPLOAD_MAX_BYTES=99614720
STORAGE_DRIVER=db

# ── E-mail (Brevo) ──
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=<login SMTP do Brevo>
EMAIL_PASS=<chave SMTP do Brevo>
EMAIL_FROM=noreply@s2vet.com.br
EMAIL_FROM_NAME=S2Vet

# ── IA ──
GEMINI_API_KEY=<chave de PRODUÇÃO, restrita ao IP do BE>
GEMINI_MODEL=gemini-3.1-flash-lite

# ── WhatsApp (D5) ──
WHATSAPP_PROVIDER=evolution
EVOLUTION_URL=http://127.0.0.1:8080
EVOLUTION_API_KEY=<openssl rand -hex 32>
EVOLUTION_WEBHOOK_TOKEN=<openssl rand -hex 32>

# ── LibreOffice ──
LIBREOFFICE_BIN=soffice

# ── 2FA: decisão de produto (seletor global do ADMIN em /configuracao-alertas) ──
# MFA_EMAIL_ENABLED=false   ← só como kill-switch de emergência

PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer
LOG_LEVEL=info
```

`/opt/s2vet/shared/frontend.env`:
```bash
VITE_GOOGLE_CLIENT_ID=<client id de PRODUÇÃO>.apps.googleusercontent.com
```

⚠️ `UPLOAD_MAX_BYTES` só vale se o valor for respeitado em todo upload — confira na
Fase 0 que um arquivo de 98 MB recebe a mensagem amigável da aplicação (413
`ARQUIVO_GRANDE_DEMAIS`), e não a página de erro do Cloudflare.

### 10.7 Serviço systemd da API

`/etc/systemd/system/s2vet-api.service`:

```ini
[Unit]
Description=S2Vet API (Node)
After=network-online.target postgresql.service wg-quick@wg0.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=s2vet
Group=s2vet
WorkingDirectory=/opt/s2vet/current/backend
Environment=NODE_ENV=production
Environment=HOME=/opt/s2vet/home
Environment=PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536
# Endurecimento compatível com Chrome e LibreOffice
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

🔴 **Uma instância só** (§3.2). Não use PM2 *cluster*.
⚠️ O `.env` do backend é lido por `dotenv` a partir do `WorkingDirectory` — por isso o
deploy cria o symlink `backend/.env → /opt/s2vet/shared/backend.env` em cada release.

```bash
sudo systemctl daemon-reload
sudo systemctl enable s2vet-api      # sobe de verdade no primeiro deploy (§10.9)
```

Permita ao usuário `s2vet` reiniciar **só** este serviço:
```bash
echo 's2vet ALL=(root) NOPASSWD: /usr/bin/systemctl restart s2vet-api, /usr/bin/systemctl status s2vet-api' \
 | sudo tee /etc/sudoers.d/s2vet && sudo chmod 440 /etc/sudoers.d/s2vet && sudo visudo -c
```

### 10.8 Evolution API (WhatsApp) em Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo install -d -o root -g root -m 750 /opt/evolution
```

Copie `infra/evolution/docker-compose.yml` para `/opt/evolution/` com **dois ajustes
obrigatórios para produção**:

```yaml
services:
  evolution-api:
    image: evoapicloud/evolution-api:<VERSÃO TESTADA EM DEV>   # 🔴 nunca :latest em produção
    ports:
      - "127.0.0.1:8080:8080"                                 # 🔴 só localhost
    environment:
      SERVER_URL: http://127.0.0.1:8080
      # ... resto igual ao arquivo do repositório
```

🔴 **Por que o `127.0.0.1:`:** o Docker escreve regras de iptables próprias que
**passam por cima do UFW**. Com `"8080:8080"` a Evolution (que controla o WhatsApp de
todas as clínicas) fica exposta na internet mesmo com o UFW dizendo "deny". O firewall
do hPanel (H2) ainda bloquearia — mas uma barreira só não é defesa em profundidade.

`/opt/evolution/.env` (`chmod 600`):
```bash
EVOLUTION_API_KEY=<o MESMO valor do backend.env>
EVOLUTION_DB_PASSWORD=<openssl rand -base64 33 | tr -d '/+='>
```

```bash
cd /opt/evolution && sudo docker compose up -d && sudo docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/      # 200
sudo ss -tlpn | grep 8080        # tem de mostrar 127.0.0.1:8080, NUNCA 0.0.0.0:8080
```

⚠️ O webhook da Evolution para o S2Vet é montado a partir do `APP_URL`, então ele sai da
VPS, passa pelo Cloudflare e volta pelo túnel. A §12.1 tem a regra que impede o WAF de
bloqueá-lo. As instâncias de cada clínica são recriadas pelo S2Vet
(`docs/INTEGRACAO_EVOLUTION_API.md §8.2`).

### 10.9 Primeiro deploy

Use o script da [§16.1](#161-script-de-deploy). O primeiro deploy faz, nesta ordem:
clone → `.env` → `npm ci` (baixa o Chrome) → `prisma generate` → `build` → backup →
`migrate deploy` (com o usuário **dono**) → build do frontend → envio ao FE → troca do
symlink → restart.

✅ Depois dele:
```bash
curl -s http://127.0.0.1:3001/health | jq .        # status "ok", database "ok"
sudo -u s2vet bash -c 'cd /opt/s2vet/current/backend && npm run doc:check'
sudo -u s2vet bash -c 'cd /opt/s2vet/current/backend && PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer \
  node -e "require(\"puppeteer\").launch({args:[\"--no-sandbox\"]}).then(b=>b.version().then(v=>{console.log(v);return b.close()}))"'
sudo -u s2vet bash -c 'cd /opt/s2vet/current/backend && npm run email:testar -- marcoaraujoc@gmail.com'
sudo ss -tlpn | grep -E ':(3001|5432|8080)\b'
```
O último comando deve mostrar `5432` e `8080` **só em 127.0.0.1**. A `3001` aparece em
`0.0.0.0` (o código não aceita *host* de escuta hoje — ver §18) e é bloqueada pelo UFW e
pelo hPanel; o teste externo na §15 prova isso.

---

## 11. Fase 4 — VPS Frontend

Tudo nesta seção é `[FE]`. A VPS de Frontend **não tem Node.js**: o build é feito no
Backend e só o resultado (`dist/`) é copiado para cá. Menos software = menos superfície.

### 11.1 Usuário de deploy e diretórios

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo install -d -o deploy -g www-data -m 755 /var/www/s2vet /var/www/s2vet/releases
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
# Cole a chave pública do usuário s2vet do BE, restrita ao IP do túnel:
echo 'from="10.50.0.2",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding <conteúdo de /opt/s2vet/.ssh/id_ed25519.pub do BE>' \
 | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

✅ `[BE]` `sudo -u s2vet ssh deploy@10.50.0.1 'echo ok'` → `ok`.

⚠️ `no-pty` impede shell interativo, mas permite os comandos do deploy. O `from=` faz a
chave só valer chegando pelo túnel.

### 11.2 Nginx

```bash
sudo apt -y install nginx
sudo rm -f /etc/nginx/sites-enabled/default
```

`/etc/nginx/conf.d/00-s2vet-global.conf`:
```nginx
server_tokens off;

# O cloudflared conecta em 127.0.0.1 e informa o IP real do visitante em
# CF-Connecting-IP. Só confiamos nesse cabeçalho vindo do próprio túnel.
set_real_ip_from 127.0.0.1;
real_ip_header   CF-Connecting-IP;

limit_req_zone $binary_remote_addr zone=s2vet_api:10m  rate=30r/s;
limit_req_zone $binary_remote_addr zone=s2vet_auth:10m rate=30r/m;
limit_req_status 429;

upstream s2vet_api {
    server 10.50.0.2:3001;     # Backend pelo túnel WireGuard
    keepalive 16;
}
```

`/etc/nginx/snippets/s2vet-headers.conf`:
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
# CSP começa em REPORT-ONLY: o login Google, ViaCEP/BrasilAPI e a transcrição offline
# (modelos baixados do Hugging Face/jsDelivr) precisam estar na lista. Rode 2 semanas,
# veja o console do navegador, ajuste e só então troque para Content-Security-Policy.
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.googleusercontent.com; media-src 'self' blob:; connect-src 'self' https://viacep.com.br https://brasilapi.com.br https://accounts.google.com https://www.googleapis.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; frame-src https://accounts.google.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

⚠️ **Armadilha do Nginx:** `add_header` dentro de um `location` **descarta** os
`add_header` herdados do `server`. Por isso os cabeçalhos estão num *snippet* incluído
em cada `location`.
⚠️ HSTS é configurado no Cloudflare (§12.1), não aqui.

`/etc/nginx/sites-available/s2vet.conf`:
```nginx
server {
    # Só o cloudflared (mesma máquina) alcança. Nenhuma porta pública.
    listen 127.0.0.1:8080;
    server_name app.s2vet.com.br;

    root  /var/www/s2vet/current;
    index index.html;

    access_log /var/log/nginx/s2vet.access.log;
    error_log  /var/log/nginx/s2vet.error.log warn;

    # O teto de verdade é o UPLOAD_MAX_BYTES do backend (D4). Aqui fica um pouco acima
    # para a aplicação devolver a mensagem amigável em vez de o Nginx cortar antes.
    client_max_body_size 100m;

    # ── Estático ──────────────────────────────────────────────────────────
    # HashRouter: toda navegação é "/" — NÃO há rewrite de SPA (DEPLOY-PRODUCAO §1).
    location = / {
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "no-cache" always;
        try_files /index.html =404;
    }
    location = /index.html {
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
    location /assets/ {            # arquivos com hash do Vite
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }
    location / {
        include snippets/s2vet-headers.conf;
        try_files $uri =404;
    }
    location ~ /\. { deny all; }

    # ── API: cabeçalhos comuns de proxy ───────────────────────────────────
    # X-Forwarded-For é SOBRESCRITO (não acrescentado) com o IP real resolvido acima.
    # Com isso o Node vê exatamente um salto confiável → TRUST_PROXY_HOPS=1, e o
    # cliente não consegue forjar o próprio IP mandando um X-Forwarded-For falso.

    # Tempo real (SSE): sem buffer e com conexão longa — heartbeat do servidor é 25s.
    location = /api/eventos/stream {
        proxy_pass http://s2vet_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-Id $request_id;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    # Login, 2FA, refresh, esqueci a senha: limite mais apertado por IP.
    location ^~ /api/auth/ {
        limit_req zone=s2vet_auth burst=20 nodelay;
        proxy_pass http://s2vet_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-Id $request_id;
    }

    # Mídia (vídeo com seek): sem arquivo temporário, Range passa direto.
    location ^~ /api/midia/ {
        limit_req zone=s2vet_api burst=100 nodelay;
        proxy_pass http://s2vet_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_max_temp_file_size 0;
        proxy_read_timeout 300s;
    }

    location ^~ /api/ {
        limit_req zone=s2vet_api burst=100 nodelay;
        proxy_pass http://s2vet_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-Id $request_id;
        # IA (laudo, memória clínica) e geração de PDF podem demorar. O Cloudflare
        # Free/Pro corta em 100s (erro 524) — este valor maior não muda aquele teto.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/s2vet.conf /etc/nginx/sites-enabled/
sudo install -d -o deploy -g www-data /var/www/s2vet/releases/inicial
echo '<!doctype html><title>S2Vet</title>Em implantação' | sudo -u deploy tee /var/www/s2vet/releases/inicial/index.html
sudo -u deploy ln -sfn /var/www/s2vet/releases/inicial /var/www/s2vet/current
sudo nginx -t && sudo systemctl reload nginx
curl -s -H 'Host: app.s2vet.com.br' http://127.0.0.1:8080/ | head -3
curl -s -H 'Host: app.s2vet.com.br' http://127.0.0.1:8080/api/marca -o /dev/null -w '%{http_code}\n'   # 200 = FE→túnel→BE→banco OK
```

⚠️ `/health` **não** está sob `/api` e **não** é publicado — fica interno
(`curl http://127.0.0.1:3001/health` no BE). Para checagem externa use
`/api/marca` (§14.3): é pública, atravessa FE → túnel → BE → banco.

⚠️ Os limites `30r/s` e `30r/m` são por **IP**. Uma clínica inteira atrás de um único
roteador compartilha o IP. Se aparecer 429 em uso normal, aumente o `burst` antes de
mexer na taxa. A aplicação ainda tem o próprio limite por usuário (`RATE_LIMIT_MAX`).

### 11.3 Por que `TRUST_PROXY_HOPS=1`

```
navegador ─► Cloudflare ─► cloudflared(127.0.0.1) ─► Nginx ─► Node
                                                      │
               Nginx troca $remote_addr pelo CF-Connecting-IP (só vindo de 127.0.0.1)
               e manda  X-Forwarded-For: <IP do cliente>   (sobrescrito, um valor só)
```

O Node vê a conexão vindo do Nginx (10.50.0.1) e um X-Forwarded-For com **um** IP —
um salto. Com `1`, `req.ip` = IP real (rate limit por IP e coluna IP da auditoria
corretos). ✅ Verificação na §15 (item 7). Se a coluna IP da auditoria mostrar
`10.50.0.1` ou `127.0.0.1`, a cadeia está errada.

### 11.4 Cloudflare Tunnel

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
 | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt -y install cloudflared
```

No painel: **Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel** →
*Cloudflared* → nome `s2vet-fe-01` → copie o comando com o token e rode na VPS:

```bash
sudo cloudflared service install <TOKEN>
sudo systemctl status cloudflared
```

Em **Public Hostname** do túnel:
| Subdomain | Domain | Service |
|---|---|---|
| `app` | `s2vet.com.br` | `HTTP` → `127.0.0.1:8080` |

O Cloudflare cria o CNAME `app` sozinho. ✅ `https://app.s2vet.com.br` abre a página
"Em implantação" (antes do primeiro deploy) ou a tela de login.

⚠️ O túnel sai pelas portas 7844 (UDP/TCP) e 443. A Hostinger não filtra saída; o UFW
está com `allow outgoing`.

---

## 12. Fase 5 — WAF (Cloudflare) e Firewall (hPanel + UFW)

### Camadas de defesa (de fora para dentro)

| # | Camada | Onde | O que barra |
|---|---|---|---|
| 1 | **Cloudflare** | borda | DDoS L3–L7, OWASP Top 10 (WAF), bots, força bruta, varredura, origem oculta |
| 2 | **Firewall hPanel** | rede Hostinger, antes da VPS | tudo que não for SSH do admin / WireGuard do FE |
| 3 | **UFW** | kernel de cada VPS | idem, + tráfego dentro do túnel por porta |
| 4 | **Nginx** | VPS FE | taxa por IP, tamanho de corpo, cabeçalhos, arquivos ocultos |
| 5 | **Aplicação** | Node | Helmet, rate limit por usuário, RBAC, autoria, bloqueio de login, 2FA |
| 6 | **Banco** | Postgres | só localhost, scram, role sem privilégio de dono, **RLS por empresa** |

### 12.1 Cloudflare — configuração

**SSL/TLS**
- *Edge Certificates* → **Always Use HTTPS**: On · **Minimum TLS**: 1.2 · **TLS 1.3**: On ·
  **Automatic HTTPS Rewrites**: On.
- **HSTS** → habilite **só depois** do go-live validado: `max-age` 6 meses,
  `includeSubDomains` On, `preload` **Off** por enquanto (preload é difícil de desfazer).

**Cache** — *Rules → Cache Rules*:
- Regra "API nunca em cache": `URI Path starts with /api/` → **Bypass cache**.
  (Resposta de API é por usuário/clínica; cachear vazaria dado entre clínicas.)

**WAF — regras gerenciadas** (*Security → WAF → Managed rules*)
- Free: *Cloudflare Free Managed Ruleset* (já vem ligado).
- Pro (D3): ligue **Cloudflare Managed Ruleset** e **Cloudflare OWASP Core Ruleset**.
  Comece o OWASP com *Paranoia Level 1* e *Anomaly threshold: Medium*, ação **Log**
  por 1 semana; olhe *Security → Events* procurando falso positivo (formulários longos
  de evolução clínica e upload de laudo são os candidatos); crie exceções; então mude
  para **Block**.

**WAF — regras customizadas** (*Security → WAF → Custom rules*), nesta ordem:

| # | Nome | Expressão | Ação |
|---|---|---|---|
| 1 | Webhook Evolution | `http.request.uri.path eq "/api/webhooks/evolution" and ip.src eq <IP_BE>` | **Skip** (todas as regras restantes + gerenciadas + rate limit) |
| 2 | Webhook de fora | `http.request.uri.path eq "/api/webhooks/evolution" and ip.src ne <IP_BE>` | **Block** |
| 3 | Varredura | `http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "wp-" or http.request.uri.path contains "phpmyadmin" or http.request.uri.path contains "/cgi-bin" or ends_with(http.request.uri.path, ".php")` | **Block** |
| 4 | Métodos | `not http.request.method in {"GET" "POST" "PUT" "PATCH" "DELETE" "OPTIONS" "HEAD"}` | **Block** |
| 5 | Fora do Brasil (opcional) | `ip.src.country ne "BR" and not http.request.uri.path eq "/api/webhooks/evolution"` | **Managed Challenge** |

A regra 5 é decisão de produto: protege bem um SaaS só brasileiro, mas atrapalha
veterinário viajando (que só precisa resolver um desafio). Recomendação: ligar.

**Rate limiting** (*Security → WAF → Rate limiting rules*):
- Free (1 regra, janela de 10s): `URI Path starts with /api/auth/` → **10 requisições
  em 10s por IP** → Block por 10s.
- Pro: `URI Path starts with /api/auth/` → **20 req/min por IP** → Block 10 min; e
  `URI Path starts with /api/` → **600 req/min por IP** → Managed Challenge.

**Bots**
- Free: **deixe *Bot Fight Mode* DESLIGADO.** No plano Free ele não aceita exceção e
  desafia clientes que não são navegador — inclusive o webhook da Evolution, que
  silenciosamente pararia de atualizar o status do WhatsApp.
- Pro: *Super Bot Fight Mode* → *Definitely automated*: Managed Challenge, com a regra
  customizada 1 pulando o webhook.

**Outros**
- *Security → Settings* → **Browser Integrity Check**: On. **Security Level**: Medium.
- *Network* → **WebSockets**: On (não usado hoje; inofensivo).
- Emergência: *Under Attack Mode* (desafio em toda visita) — sabendo que ele também
  pega o webhook se não houver Skip (regra 1 cobre).
- **Notificações**: *Notifications* → alertas de DDoS, de túnel caído (*Tunnel health*)
  e de pico de 5xx para o seu e-mail.

**Limites do Cloudflare que afetam a aplicação**
| Limite | Free/Pro | Consequência | Tratamento |
|---|---|---|---|
| Corpo da requisição | **100 MB** | upload maior dá 413 do Cloudflare | `UPLOAD_MAX_BYTES=95 MB` (D4) |
| Tempo de resposta da origem | **100 s** | erro **524** | IA tem timeout de 60s (`GEMINI_TIMEOUT_MS`); monitore 524 em *Analytics* |

### 12.2 Firewall do hPanel (1ª barreira de rede)

hPanel → VPS → **Segurança → Firewall** → crie **dois** grupos.

**Grupo `s2vet-fe`** → aplique à VPS Frontend:
| Ação | Protocolo | Porta | Origem | Por quê |
|---|---|---|---|---|
| Accept | TCP | 22 | `<IP_ADMIN>` | SSH (D6 = A). Com Tailscale (D6 = B): **nenhuma** regra de SSH. |
| Accept | UDP | 51820 | `<IP_BE>` | Retorno do WireGuard caso o firewall não seja *stateful* (redundante se for) |
| *(padrão)* | | | | **Drop** em todo o resto — inclusive 80/443: o Tunnel não precisa |

**Grupo `s2vet-be`** → aplique à VPS Backend:
| Ação | Protocolo | Porta | Origem | Por quê |
|---|---|---|---|---|
| Accept | TCP | 22 | `<IP_ADMIN>` | SSH (D6 = A) |
| Accept | UDP | 51820 | `<IP_FE>` | Túnel WireGuard |
| *(padrão)* | | | | **Drop** — 3001, 5432, 8080 **nunca** |

Crie as regras também para IPv6 se as VPS tiverem IPv6 e a origem tiver IPv6.
Mudanças levam até 2 minutos (H2). ✅ Depois de aplicar: `sudo apt update` funciona nas
duas VPS (prova que a saída não foi afetada) e `sudo wg show` continua com handshake.

### 12.3 UFW — estado final esperado

`[FE]` `sudo ufw status numbered`:
```
22/tcp                ALLOW IN   <IP_ADMIN>        # SSH admin (D6=A)
10.50.0.1 22/tcp on wg0  ALLOW IN   10.50.0.2      # deploy via túnel
```
`[BE]`:
```
22/tcp                ALLOW IN   <IP_ADMIN>        # SSH admin (D6=A)
51820/udp             ALLOW IN   <IP_FE>           # WireGuard
10.50.0.2 3001/tcp on wg0 ALLOW IN 10.50.0.1       # API só pelo túnel
```

**D6 = B (Tailscale):** instale nas duas VPS e no seu PC
(`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --ssh=false`),
troque as regras de SSH por `sudo ufw allow in on tailscale0 to any port 22 proto tcp`,
remova a regra de `<IP_ADMIN>` do UFW e do hPanel. Resultado: **zero portas públicas**
na VPS Frontend e só a UDP 51820 (para um único IP) na Backend. Mantenha o terminal do
hPanel (H9) como acesso de emergência.

### 12.4 Hardening de kernel (as duas VPS)

`/etc/sysctl.d/99-s2vet.conf` (acrescente):
```ini
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
```
`sudo sysctl --system`. ⚠️ **Não** ligue `net.ipv4.ip_forward` — nenhuma das VPS é roteador.

### 12.5 Alternativa sem Tunnel: porta 443 restrita ao Cloudflare

Use só se não quiser depender do `cloudflared`:
1. Nginx do FE escuta `443 ssl` com um **Cloudflare Origin Certificate** (15 anos,
   *SSL/TLS → Origin Server*).
2. Cloudflare: **SSL/TLS mode = Full (strict)** + **Authenticated Origin Pulls** ligado
   (o Nginx exige o certificado de cliente do Cloudflare: `ssl_verify_client on`).
3. hPanel e UFW: TCP 443 aceito **só das faixas do Cloudflare**
   (`https://www.cloudflare.com/ips/`), uma regra por faixa.
4. `set_real_ip_from` com essas faixas no lugar de `127.0.0.1`.
5. Registro DNS `app` = A `<IP_FE>` proxied.

Desvantagens: ~20 regras de firewall para manter, certificado de origem e o IP da origem
fica no histórico de DNS. Por isso o Tunnel é a recomendação.

---

## 13. Fase 6 — Integrações externas

| Integração | Passos | ✅ Verificação |
|---|---|---|
| **Brevo** | *Senders & Domains* → adicionar `s2vet.com.br` → publicar SPF/DKIM no Cloudflare → criar remetente `noreply@s2vet.com.br` → *SMTP & API* → nova chave SMTP para produção | `npm run email:testar -- marcoaraujoc@gmail.com` no BE: chega na caixa de entrada (não no spam) e o cabeçalho mostra `spf=pass dkim=pass dmarc=pass` |
| **Google OAuth** | Google Cloud (projeto de produção) → *APIs & Services → Credentials* → OAuth Client (Web) → **Authorized JavaScript origins**: `https://app.s2vet.com.br` → *OAuth consent screen*: publicar ("In production"), escopos só `email`/`profile`/`openid`, logo, links de política de privacidade e termos | Login com Google em aba anônima |
| **Gemini** | Mesmo projeto → *Generative Language API* → nova chave → **Restrições: endereço IP = `<IP_BE>`** → *Billing → Budgets*: alerta em 50/90/100% | Memória clínica de um paciente gera; `/ai-usage` registra a chamada com a empresa |
| **Evolution** | §10.8 → tela de Configurações da clínica → conectar (QR Code) | Lembrete/PDF chega no WhatsApp; status da conexão atualiza sozinho (prova do webhook) |
| **SISCAD/CFMV (CRMV)** | Nada a configurar — job diário com Chrome headless | Tela de Monitoração mostra a execução da "Sincronização CRMV" |

⚠️ O CRMV é raspagem de site público. Se o CFMV bloquear o IP do datacenter, o job falha
— a aplicação continua; o alerta de cron avisa o ADMIN.

---

## 14. Fase 7 — Backup, monitoração e logs

### 14.1 Backup do banco (diário, cifrado, fora da Hostinger)

Ferramentas no BE:
```bash
sudo apt -y install age rclone
# A chave PÚBLICA do age (gerada no SEU PC com `age-keygen -o s2vet-backup.key`) vai para o servidor:
echo 'age1...sua_chave_publica...' | sudo tee /etc/s2vet-backup.pub
sudo rclone config        # remote "offsite": Backblaze B2 ou Cloudflare R2, bucket s2vet-backups
```

🔴 **A chave PRIVADA do `age` nunca fica no servidor.** Guarde em dois lugares seus
(gerenciador de senhas + mídia offline). Se o servidor for comprometido, o atacante não
consegue ler os backups; se você perder a chave, **ninguém** consegue — inclusive você.

🔴 No bucket: **versionamento** ligado (ou *Object Lock*) e regra de ciclo de vida
(apagar após 90 dias). A credencial do rclone no servidor deve poder **escrever** mas,
idealmente, não **apagar** — ransomware que apaga o backup é o caso clássico.

`/usr/local/sbin/s2vet-backup.sh` (`sudo chmod 750`):
```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M)
DIR=/var/backups/s2vet
PUB=$(cat /etc/s2vet-backup.pub)

# 🔴 Como superusuário: FORCE ROW LEVEL SECURITY vale até para o dono do schema.
runuser -u postgres -- pg_dump -Fc -Z 6 dbs2vet           | age -r "$PUB" > "$DIR/db_$TS.dump.age"
runuser -u postgres -- pg_dumpall --globals-only         | age -r "$PUB" > "$DIR/globals_$TS.sql.age"
tar -C /opt -cz evolution/.env s2vet/shared              | age -r "$PUB" > "$DIR/config_$TS.tgz.age"

rclone copy "$DIR" offsite:s2vet-backups/$(hostname)/ --include "*_$TS.*"
find "$DIR" -type f -mtime +3 -delete     # 3 dias locais; o histórico fica no bucket

# "Dead man's switch": se este ping não chegar, o monitor avisa (§14.3)
curl -fsS -m 10 "<URL_HEARTBEAT_BACKUP>" >/dev/null || true
```

Agendamento (`sudo crontab -e`) — fora da janela dos jobs da aplicação (23:30–00:00):
```
30 2 * * *  /usr/local/sbin/s2vet-backup.sh >> /var/log/s2vet-backup.log 2>&1
```

**Teste de restauração — mensal, obrigatório** (backup não testado não é backup):
```bash
age -d -i s2vet-backup.key db_AAAAMMDD_HHMM.dump.age > db.dump      # no seu PC/ambiente de teste
pg_restore -l db.dump | head                                         # o catálogo lê?
# restaure num Postgres de teste e abra a aplicação apontando para ele
```

Complementos:
- **Backup diário da Hostinger** (pago) na VPS Backend: recomendado — restaura a
  máquina inteira rápido. **Não** substitui o `pg_dump`.
- **Snapshot** antes de cada mudança grande (go-live, upgrade de SO, upgrade do Postgres).
- Fase 2 (quando o volume justificar): **pgBackRest** com WAL contínuo → recuperação
  para qualquer minuto (hoje a perda máxima é de até 24h).

### 14.2 Metas de recuperação (declare e teste)

| Métrica | Meta inicial | Como se atinge |
|---|---|---|
| **RPO** (quanto dado se pode perder) | 24 h | `pg_dump` diário. Para < 15 min: pgBackRest + WAL |
| **RTO** (quanto tempo fora do ar) | 4 h | Runbook §16.3 + VPS nova a partir deste documento |

### 14.3 Monitoração

| O quê | Ferramenta | Alerta |
|---|---|---|
| Site no ar | UptimeRobot / Better Stack → `https://app.s2vet.com.br/` (procura o texto "S2Vet") a cada 1 min | e-mail + celular |
| Cadeia inteira (FE → túnel → BE → banco) | monitor HTTP em `https://app.s2vet.com.br/api/marca` → espera 200 | idem |
| Backup rodou | *heartbeat* do Better Stack/Healthchecks.io (o `curl` no fim do script) | sem ping em 26h |
| Jobs da aplicação | tela **Monitoração** (`/monitoracao`) + alerta de cron do próprio S2Vet (`/configuracao-alertas`) | e-mail ao ADMIN |
| Disco, RAM, CPU | gráficos do hPanel + script abaixo | > 80% de disco |
| Túnel e DDoS | *Notifications* do Cloudflare (§12.1) | e-mail |
| Certificados | automáticos (Cloudflare) | — |

Alerta de disco simples (BE, `crontab` do root, de hora em hora):
```bash
0 * * * * [ "$(df --output=pcent / | tail -1 | tr -dc 0-9)" -gt 80 ] && curl -fsS "<URL_ALERTA_DISCO>"
```

Uso do banco por tabela (os anexos `bytea` dominam):
```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class
WHERE relnamespace = 'schs2vet'::regnamespace AND relkind='r'
ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;
```

### 14.4 Logs

| Log | Onde | Retenção |
|---|---|---|
| API (Winston → stdout) | `journalctl -u s2vet-api` | até 2 GB (journald) |
| Nginx | `/var/log/nginx/s2vet.*.log` | logrotate padrão (14 dias) |
| Postgres | `/var/log/postgresql/` | logrotate padrão |
| Acesso à aplicação (login/logout, IP) | tabela de auditoria no banco | 🔴 **mínimo 6 meses** (Marco Civil da Internet, art. 15 — provedor de aplicação com fins econômicos) |
| Eventos de segurança na borda | Cloudflare → *Security → Events* | conforme plano |

---

## 15. Fase 8 — Testes de aceite e go-live

### 15.1 Testes de segurança (de FORA, do seu PC)

| # | Teste | Comando / ferramenta | Esperado |
|---|---|---|---|
| S1 | Portas do Backend | `nmap -Pn -p 22,80,443,3001,5432,8080 <IP_BE>` | tudo `filtered` (22 `open` só a partir do seu IP) |
| S2 | Portas do Frontend | `nmap -Pn -p 22,80,443,8080 <IP_FE>` | tudo `filtered` |
| S3 | UDP do túnel | `nmap -sU -Pn -p 51820 <IP_BE>` de outro IP | `open\|filtered` sem resposta (WireGuard não responde a quem não tem a chave) |
| S4 | WAF | `curl -s -o /dev/null -w '%{http_code}' https://app.s2vet.com.br/.env` | `403` (bloqueio do Cloudflare) |
| S5 | Webhook de fora | `curl -X POST https://app.s2vet.com.br/api/webhooks/evolution` | `403` |
| S6 | TLS | `https://www.ssllabs.com/ssltest/` | nota **A** ou **A+** |
| S7 | Cabeçalhos | `https://securityheaders.com/` | **A** (CSP em report-only pode baixar a nota até ser ativada) |
| S8 | Cookie | DevTools → Cookies | `s2vet_at`/`s2vet_rt` com **Secure**, **HttpOnly**, `SameSite=Lax` |
| S9 | Força bruta | 15 senhas erradas seguidas | bloqueio da conta (aplicação) e/ou 429 (Nginx/Cloudflare) |
| S10 | Isolamento | usuário da clínica A tenta abrir paciente da clínica B pela URL | negado |
| S11 | Origem oculta | `curl -sI https://app.s2vet.com.br` | `server: cloudflare`; nenhum cabeçalho com versão de Nginx/Express |

### 15.2 Testes funcionais (com o `DEPLOY-PRODUCAO.md §5`)

| # | Teste | Esperado |
|---|---|---|
| F1 | `/health` interno | `200`, banco `ok` |
| F2 | Login e-mail/senha (+2FA, se ligado) | entra; código chega por e-mail |
| F3 | Login Google | entra |
| F4 | Foto de paciente | carrega (prova `/api/midia` same-origin e autorizado) |
| F5 | Upload de laudo de 90 MB | salva; 98 MB → mensagem amigável da aplicação |
| F6 | Vídeo de prontuário | toca e permite avançar (Range) |
| F7 | PDF de prescrição por e-mail e WhatsApp | chega com o anexo (prova Chrome + Brevo + Evolution) |
| F8 | IP real | `/auditoria-geral` mostra o IP do seu provedor, não `10.50.0.1`/`127.0.0.1` |
| F9 | Tempo real (SSE) | dois navegadores na mesma evolução: o segundo recebe o aviso de edição concorrente |
| F10 | Cron | `/monitoracao` mostra execuções; **não** use jobs que mandam mensagem como teste |
| F11 | `.doc` | `npm run doc:check` → OK; laudo `.doc` pré-visualiza |
| F12 | Backup | restauração de teste do primeiro backup funciona (§14.1) |
| F13 | Celular | fluxo completo no 4G (mobile-first) |

### 15.3 Critérios de go/no-go

**Go** somente com: Fase 0 aprovada · S1–S11 OK · F1–F13 OK · backup restaurado com
sucesso · monitores ativos e testados (derrube o serviço de propósito e confira que o
alerta chega) · todos os segredos novos e guardados no gerenciador · limpeza de dados de
teste conferida.

### 15.4 Estratégia de lançamento

1. **Piloto** (1–2 semanas): uma clínica parceira, você acompanhando de perto.
2. Observar: erros 5xx/524 no Cloudflare, falsos positivos do WAF, uso de disco,
   tempo de resposta da IA, execuções de cron.
3. Ajustar (WAF para *Block*, CSP para valer, HSTS).
4. Abrir para as demais clínicas.

---

## 16. Rotina de atualização (deploy) e rollback

### 16.1 Script de deploy

`/opt/s2vet/bin/deploy.sh` (dono `s2vet`, `chmod 750`), executado no BE como
`sudo -u s2vet /opt/s2vet/bin/deploy.sh <branch-ou-tag>`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REF="${1:?informe a branch ou tag}"
REPO="git@github.com:<usuario>/<repositorio>.git"
TS=$(date +%Y%m%dT%H%M%S)
REL=/opt/s2vet/releases/$TS
export PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer
export HOME=/opt/s2vet/home

echo "▶ 1/9 código ($REF)"
git clone --depth 1 --branch "$REF" "$REPO" "$REL"
ln -s /opt/s2vet/shared/backend.env  "$REL/backend/.env"
cp    /opt/s2vet/shared/frontend.env "$REL/frontend/.env.production"

echo "▶ 2/9 dependências do backend"
cd "$REL/backend"
npm ci                      # 🔴 NÃO usar --omit=dev: @prisma/client está em devDependencies (§18)
npx prisma generate

echo "▶ 3/9 build do backend (tsc + copy-assets dos SVG/PNG dos laudos)"
npm run build

echo "▶ 4/9 backup antes de migrar"
sudo -n /usr/local/sbin/s2vet-backup.sh || { echo "backup falhou — abortando"; exit 1; }

echo "▶ 5/9 migrations (usuário DONO)"
set -a; . /opt/s2vet/shared/backend.env; set +a
DATABASE_URL="$DATABASE_URL_MIGRATIONS" npx prisma migrate deploy
# Só quando a release alterou o catálogo de módulos/permissões (seed 002) ou modelos CFMV (006):
# DATABASE_URL="$DATABASE_URL_MIGRATIONS" node seed.js

echo "▶ 6/9 build do frontend"
cd "$REL/frontend"
npm ci
npm run build

echo "▶ 7/9 publica o estático na VPS Frontend (pelo túnel)"
rsync -a --delete dist/ "deploy@10.50.0.1:/var/www/s2vet/releases/$TS/"
ssh deploy@10.50.0.1 "ln -sfn /var/www/s2vet/releases/$TS /var/www/s2vet/current"

echo "▶ 8/9 troca a versão do backend e reinicia"
ln -sfn "$REL" /opt/s2vet/current
sudo -n /usr/bin/systemctl restart s2vet-api
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3001/health >/dev/null && break; sleep 2
done
curl -fsS http://127.0.0.1:3001/health >/dev/null || { echo "🔴 /health não respondeu — faça rollback (§16.2)"; exit 1; }

echo "▶ 9/9 limpeza (mantém as 5 últimas releases)"
ls -1dt /opt/s2vet/releases/*/ | tail -n +6 | xargs -r rm -rf
ssh deploy@10.50.0.1 'ls -1dt /var/www/s2vet/releases/*/ | tail -n +6 | xargs -r rm -rf'
echo "✅ deploy $TS concluído"
```

Acrescente ao sudoers do `s2vet` (§10.7) o backup:
`/usr/local/sbin/s2vet-backup.sh`.

⚠️ O `ssh` para o FE com `no-pty` aceita comandos não interativos (os acima). Se
preferir travar ainda mais, troque por `rrsync` + um *hook* de troca de symlink.

### 16.2 Rollback

```bash
# Backend: volta o symlink para a release anterior e reinicia
ls -1dt /opt/s2vet/releases/*/
sudo -u s2vet ln -sfn /opt/s2vet/releases/<ANTERIOR> /opt/s2vet/current
sudo systemctl restart s2vet-api
# Frontend
sudo -u s2vet ssh deploy@10.50.0.1 'ln -sfn /var/www/s2vet/releases/<ANTERIOR> /var/www/s2vet/current'
```

🔴 **Migrations do Prisma não têm "down".** Se a release nova aplicou uma migration que
a versão anterior não entende, voltar o código não basta — é **restaurar o backup feito
no passo 4** do deploy. Por isso: migrations sempre **aditivas** (coluna nova nullable,
tabela nova) e remoção de coluna só numa release posterior, quando nenhum código a lê.

### 16.3 Runbook — "caiu"

1. Cloudflare *Analytics*: há tráfego? 5xx? 524? Túnel saudável?
2. FE: `systemctl status cloudflared nginx` · `sudo wg show` (handshake recente?)
3. BE: `systemctl status s2vet-api postgresql` · `journalctl -u s2vet-api -n 200`
4. BE: `df -h` (disco cheio é a causa mais comum com anexos no banco) · `free -h`
5. BE: `curl http://127.0.0.1:3001/health`
6. Restaurar: rollback (§16.2) → snapshot/backup da Hostinger → VPS nova + este
   documento + `pg_dump` do bucket.

### 16.4 Janelas de manutenção

- Deploy e reboot: **fora de 23:15–00:30** (fechamento de fatura, fim de janela de doses
  e lembretes rodam aí) e fora do horário de atendimento. Sugestão: **domingo 06:00**.
- Reboot após atualização de kernel: `cat /var/run/reboot-required` diz se precisa.

---

## 17. Gestão do projeto — cronograma, riscos, LGPD

### 17.1 Cronograma (estimativa para 1 pessoa, dedicação parcial)

| Semana | Entregas | Esforço | Dependências |
|---|---|---|---|
| **1** | D1–D6 decididas · domínios registrados e DNS no Cloudflare · contas P1–P13 · **Fase 0** (ensaio local + script de limpeza) | 12–16 h | CNPJ para o `.com.br`; billing do Google |
| **2** | Fases 1–3: VPS, hardening, WireGuard, Postgres, restore, backend, Evolution | 12–16 h | Fase 0 aprovada |
| **3** | Fases 4–6: Nginx, Tunnel, Cloudflare WAF, firewalls, Brevo/Google/Gemini | 8–12 h | DNS propagado; domínio verificado no Brevo |
| **4** | Fase 7 (backup + monitores) · Fase 8 (aceite) · **piloto** · go-live | 8–12 h + acompanhamento | Clínica piloto disponível |

**Caminho crítico:** registro do `.com.br` (Registro.br pode pedir documentação) →
verificação do domínio no Brevo (sem ela não há 2FA nem reset de senha) → Fase 0.

### 17.2 Registro de riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Migration falha no banco de produção | Média | Alto | Fase 0 com o MESMO dump; backup antes de migrar; snapshot |
| R2 | Perda de dados (disco, erro humano, ransomware) | Baixa | **Crítico** | `pg_dump` diário cifrado fora da Hostinger + versionamento + teste mensal |
| R3 | Vazamento entre clínicas | Baixa | **Crítico** | RLS *fail-closed* + role sem privilégio de dono (verificar na §10.3) + teste S10 |
| R4 | Número de WhatsApp banido (Evolution/Baileys não oficial) | Média | Médio | Volume baixo, sem disparo em massa; número por clínica; plano de migrar para a API oficial |
| R5 | Cloudflare corta upload > 100 MB ou resposta > 100 s | Alta | Baixo | D4 (95 MB); timeout da IA em 60 s; monitorar 524 |
| R6 | Disco cheio (anexos no banco) | Média (cresce) | Alto | alerta 80%; plano do `S3StorageProvider` |
| R7 | Crons duplicados (2 instâncias) | Baixa | Médio | uma instância (§3.2); nunca PM2 cluster |
| R8 | Restart na janela de jobs | Média | Médio | janela de manutenção (§16.4) |
| R9 | WAF bloqueando uso legítimo | Média | Médio | OWASP em *Log* por 1 semana; webhook com Skip |
| R10 | Trancar-se fora do servidor | Média | Alto | testar terminal do hPanel antes; nunca fechar a sessão SSH antes de testar a nova |
| R11 | Limite de e-mail da Hostinger (5/min) | Baixa | Médio | relay Brevo na 587; plano B Resend via HTTPS |
| R12 | Chave do Gemini vazada / custo | Baixa | Médio | restrição por IP + orçamento com alerta + quota por empresa (já existe na aplicação) |
| R13 | Dependência de uma pessoa (você) | Alta | Alto | este documento + runbook + segredos no gerenciador com acesso de emergência para uma 2ª pessoa |

### 17.3 LGPD e obrigações (não é infraestrutura, mas bloqueia o lançamento)

- **Papéis:** a clínica é **controladora** dos dados dos tutores; a S2Vet é
  **operadora**. Contrato com cada clínica com cláusulas de tratamento de dados (DPA).
- **Política de Privacidade** e **Termos de Uso** publicados (também exigidos pelo
  Google OAuth).
- **Encarregado (DPO)** indicado, com canal de contato.
- **Registro das operações de tratamento** (que dado, para quê, onde fica, quem acessa).
- **Plano de resposta a incidente**, incluindo comunicação à ANPD e aos titulares.
- **Retenção:** logs de acesso por 6 meses (Marco Civil); prontuário conforme normas do
  CFMV.
- **Suboperadores** a declarar: Hostinger (hospedagem), Cloudflare (borda), Brevo
  (e-mail), Google (IA e login), provedor do backup.
- Disco da VPS **não é cifrado** pela Hostinger — os backups são (§14.1). Anote isso na
  avaliação de risco.

---

## 18. Ajustes recomendados no código (não aplicados)

Encontrados no levantamento. **Nenhum foi alterado** — cada um precisa da sua
autorização. Nenhum bloqueia o go-live com este plano (as mitigações estão acima).

| # | Ajuste | Por quê | Prioridade |
|---|---|---|---|
| C1 | `app.listen(PORT, process.env.HOST)` no `server.ts`, com `HOST=10.50.0.2` em produção | Hoje a API escuta em `0.0.0.0:3001`; só os firewalls a protegem. Com o *host* do túnel, ela nem existiria na interface pública | Alta |
| C2 | Mover `@prisma/client` (e `prisma`) para `dependencies` | Está em `devDependencies`, mas é usado em runtime: um `npm ci --omit=dev` derruba a aplicação | Média |
| C3 | Atualizar ou aposentar o `backend/Dockerfile` | Usa `node:20` (dev usa 22), `npm install` em vez de `npm ci`, não instala as bibliotecas do Chrome (PDF falharia) e não roda `prisma generate`/`build` | Média |
| C4 | `infra/evolution/docker-compose.yml`: porta `127.0.0.1:8080:8080` e imagem com versão fixa | Hoje publica `8080` em todas as interfaces e usa `:latest` | Alta (antes de usar o arquivo em produção) |
| C5 | Remover `groq-sdk` e `ollama` do `package.json` | Sem uso desde que o Gemini virou provider único — dependência sem uso é superfície de ataque | Baixa |
| C6 | Atualizar `docs/DEPLOY-PRODUCAO.md` com a topologia escolhida (D2) e o link para este plano | Hoje diz `https://s2vet.com.br` e "um provedor" | Baixa |
| C7 | Pipeline de CI que gera os artefatos (build) e roda os testes antes do deploy | Hoje o build acontece no servidor de produção | Média (pós go-live) |
| C8 | Checar se o frontend informa o limite de upload ao usuário (antes de enviar) | Com D4, um vídeo de 120 MB deve ser recusado na tela, não após subir 100 MB | Média |

---

## 19. Fontes

Documentação da Hostinger consultada em 2026-10-01:
- [Firewall gerenciado no VPS (pt-BR)](https://www.hostinger.com/br/support/?p=1617)
- [Porta SMTP 25 no VPS](https://www.hostinger.com/support/7854530-is-smtp-port-25-blocked-on-vps/)
- [Backup e restauração de VPS](https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps)
- [Coleção "VPS Management"](https://www.hostinger.com/support/collections/2690701-vps-management)
- [Endereço IP do VPS](https://www.hostinger.com/support/5139756-how-to-find-your-vps-ip-address-at-hostinger/)
- [Comparativo de recursos (datacenter Brasil, DDoS, backups)](https://www.vpsbenchmarks.com/compare/features/hostinger_vs_hostup)

Referências do próprio repositório:
- `docs/DEPLOY-PRODUCAO.md` — exigências do código (same-origin, cookies, RLS, verificação)
- `docs/MULTI-TENANCY-PLANO.md` — RLS e roles
- `docs/INTEGRACAO_EVOLUTION_API.md` — WhatsApp
- `backend/.env.example` — todas as variáveis, com o porquê
- `backend/prisma/migrations/20260806160000_fase6_grants_zls2vetp1` — privilégios da role da aplicação

Outras: [Faixas de IP do Cloudflare](https://www.cloudflare.com/ips/) ·
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) ·
[Limites do Cloudflare](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)

---

*Mantenha este documento junto com o código: ao mudar topologia, variável ou passo de
subida, atualize aqui. Um runbook que descreve um servidor que não existe mais é pior
que nenhum — porque é seguido com confiança.*
