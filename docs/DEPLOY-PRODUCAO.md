# S2Vet — Subida para produção (KingHost, duas VPS)

> **Atualizado em:** 2026-10-06 · **Provedor:** KingHost · **SO:** Ubuntu 24.04 LTS nas duas
> máquinas · **Endereço da aplicação:** `https://app.s2vet.com.br`
>
> Este documento é o **roteiro de execução**: cada comando tem, logo abaixo, **para que
> serve**. Foi escrito para quem não é da área de redes e segurança: nada aqui pressupõe
> que você saiba o que um comando faz.
>
> Ele **substitui**, para a KingHost, o `PLANO-PRODUCAO-KINGHOST.md` (que supunha uma VPS só
> e Ubuntu 20.04) e reaproveita as decisões do `PLANO-PRODUCAO-HOSTINGER.md` (Cloudflare,
> Tailscale, Brevo, Evolution, backup cifrado). O **porquê** das exigências do código
> (same-origin, dois usuários de banco, RLS, cookie) continua aqui, na [Parte D](#parte-d--referência).

**Legenda**

| Sinal | Significado |
|---|---|
| 🔴 | Se pular, a subida quebra **ou** abre um furo de segurança |
| ⚠️ | Armadilha conhecida — leia antes de executar |
| ✅ | Verificação: prova que o passo funcionou. **Não pule** — é o ponto em que um erro ainda é barato |
| `[PC]` | Executar no **seu computador** (PowerShell do Windows) |
| `[FE]` | Executar na **VPS Frontend** (s2vet02 · 177.153.69.147) |
| `[BE]` | Executar na **VPS Backend** (s2vet01 · 177.153.69.171) |
| `[AMBAS]` | Executar nas duas VPS, uma de cada vez |
| `[WEB]` | Fazer num painel, pelo navegador |

**Como ler um comando neste documento**

```bash
sudo ufw status
```
> **Para que serve:** a explicação vem sempre logo abaixo do bloco, neste formato.

Quando um bloco tem várias linhas, cada linha tem um comentário (`# ...`) dizendo o que
faz. Os comentários podem ser colados junto: o terminal os ignora.

⚠️ **Nunca cole um bloco inteiro sem ler.** Onde aparece `<ALGO_ENTRE_SINAIS>`, você
precisa trocar pelo valor real antes de executar.

---

## Sumário

- [Parte A — Entendendo o desenho](#parte-a--entendendo-o-desenho)
  - [A1. As máquinas e o que cada uma faz](#a1-as-máquinas-e-o-que-cada-uma-faz)
  - [A2. A "VPC": por que um túnel WireGuard](#a2-a-vpc-por-que-um-túnel-wireguard)
  - [A3. O IP público do Backend fica fechado — inclusive para o Frontend](#a3-o-ip-público-do-backend-fica-fechado--inclusive-para-o-frontend)
  - [A4. Acesso administrativo com IP de casa por DHCP: Tailscale](#a4-acesso-administrativo-com-ip-de-casa-por-dhcp-tailscale)
  - [A5. Camadas de defesa](#a5-camadas-de-defesa)
  - [A6. Matriz de tráfego](#a6-matriz-de-tráfego-o-que-pode-falar-com-o-quê)
  - [A7. Dimensionamento — precisa ajustar alguma VPS?](#a7-dimensionamento--precisa-ajustar-alguma-vps)
- [Parte B — Antes de começar](#parte-b--antes-de-começar)
- [Parte C — Roteiro de execução](#parte-c--roteiro-de-execução)
  - [Etapa 1 — Inventário: o que veio instalado](#etapa-1--inventário-o-que-veio-instalado-ambas)
  - [Etapa 2 — Atualizar o sistema](#etapa-2--atualizar-o-sistema-ambas)
  - [Etapa 3 — Usuário administrativo](#etapa-3--usuário-administrativo-ambas)
  - [Etapa 4 — Rede de segurança contra se trancar fora](#etapa-4--rede-de-segurança-contra-se-trancar-fora)
  - [Etapa 5 — SSH só com chave (urgente)](#etapa-5--ssh-só-com-chave-urgente-ambas)
  - [Etapa 6 — Tailscale](#etapa-6--tailscale-o-acesso-administrativo-ambas)
  - [Etapa 7 — Firewall (UFW) e fechamento do SSH público](#etapa-7--firewall-ufw-e-fechamento-do-ssh-público-ambas)
  - [Etapa 8 — Proteções do sistema](#etapa-8--proteções-do-sistema-ambas)
  - [Etapa 9 — A VPC privada (WireGuard)](#etapa-9--a-vpc-privada-wireguard)
  - [Etapa 10 — Banco de dados (PostgreSQL)](#etapa-10--banco-de-dados-postgresql-be)
  - [Etapa 11 — Backup cifrado fora da KingHost](#etapa-11--backup-cifrado-fora-da-kinghost-be)
  - [Etapa 12 — Carga inicial dos dados](#etapa-12--carga-inicial-dos-dados-be)
  - [Etapa 13 — Node, Chrome, LibreOffice e o serviço da API](#etapa-13--node-chrome-libreoffice-e-o-serviço-da-api-be)
  - [Etapa 14 — Evolution API (WhatsApp)](#etapa-14--evolution-api-whatsapp-be)
  - [Etapa 15 — Frontend: Nginx](#etapa-15--frontend-nginx-fe)
  - [Etapa 16 — Cloudflare Tunnel](#etapa-16--cloudflare-tunnel-fe)
  - [Etapa 17 — Primeiro deploy](#etapa-17--primeiro-deploy-be)
  - [Etapa 18 — Cloudflare: WAF, TLS e regras](#etapa-18--cloudflare-waf-tls-e-regras-web)
  - [Etapa 19 — Testes de aceite](#etapa-19--testes-de-aceite)
- [Parte D — Referência](#parte-d--referência)
- [Parte E — Operação](#parte-e--operação)

---

# Parte A — Entendendo o desenho

## A1. As máquinas e o que cada uma faz

```
                         Internet (clínicas, celulares)
                                      │  HTTPS 443
                                      ▼
                  ┌───────────────────────────────────────────┐
                  │ CLOUDFLARE  (DNS · WAF · DDoS · TLS ·     │
                  │             rate limit · oculta os IPs)   │
                  └─────────────────────┬─────────────────────┘
                                        │ Cloudflare Tunnel: conexão de SAÍDA,
                                        │ aberta pela própria VPS Frontend
 ╔══════════════════════════════════════▼══════════════════════════════════════╗
 ║ VPS FRONTEND · s2vet02 · 177.153.69.147 · 4 GB · Ubuntu 24.04               ║
 ║   cloudflared ─► Nginx 127.0.0.1:8080                                       ║
 ║                    ├─ /        → arquivos estáticos do React (build)        ║
 ║                    └─ /api/*   → 10.50.0.2:3001  (pelo túnel WireGuard)     ║
 ║   wg0 = 10.50.0.1   ·   portas públicas abertas: SÓ UDP 51820, só do BE     ║
 ╚══════════════════════════════════════▲══════════════════════════════════════╝
                                        │ WireGuard (cifrado) — quem INICIA
                                        │ é o Backend, nunca o contrário
 ╔══════════════════════════════════════╧══════════════════════════════════════╗
 ║ VPS BACKEND · s2vet01 · 177.153.69.171 · 16 GB · Ubuntu 24.04               ║
 ║   wg0 = 10.50.0.2   ·   portas públicas abertas: NENHUMA                    ║
 ║   Node 22 (API) escutando SÓ em 10.50.0.2:3001                              ║
 ║     ├─ Chrome headless (PDF, CRMV) · LibreOffice (.doc)                     ║
 ║     └─ node-cron (fechamento de fatura, lembretes…)                         ║
 ║   PostgreSQL 18 em 127.0.0.1:5432 (schema schs2vet, RLS por empresa)        ║
 ║   Docker: Evolution API em 127.0.0.1:8080 (+ Postgres e Redis próprios)     ║
 ╚══════════════════════════════════════╤══════════════════════════════════════╝
                                        │ só conexões de SAÍDA
       Gemini · Brevo (e-mail) · WhatsApp · CFMV · GitHub · bucket de backup

 Você (PC, notebook, celular) ── Tailscale ──► SSH nas duas VPS (nenhuma porta 22 pública)
```

| Máquina | Nome KingHost | Nome que vamos usar | IP público | Papel |
|---|---|---|---|---|
| Frontend | `s2vet02.vps-kinghost.net` | **`s2vet-fe`** | `177.153.69.147` | Recebe o tráfego do Cloudflare, entrega a tela e repassa `/api` |
| Backend | `s2vet01.vps-kinghost.net` | **`s2vet-be`** | `177.153.69.171` | API, banco, jobs, WhatsApp. **Invisível para a internet** |

Conferido na Etapa 1 (2026-10-06): as duas com **Ubuntu 24.04.4**, placa de rede **`enX0`**
(virtualização Xen), **sem IPv6 público**, 1 GB de swap em partição e o relógio **sem
sincronizar** (tratado na Etapa 8.6). O SSH das duas aceitava **senha e root** e recebeu
**~17 mil tentativas de invasão em 24 h** — por isso as Etapas 2 a 5 são urgentes.

⚠️ Os nomes da KingHost são "01 = backend" e "02 = frontend". Para não confundir no
terminal, a Etapa 2 renomeia as máquinas para `s2vet-fe` e `s2vet-be`. O endereço
`*.vps-kinghost.net` continua funcionando; só não vamos usá-lo.

## A2. A "VPC": por que um túnel WireGuard

**O que é uma VPC:** nos provedores grandes (AWS, Google), as máquinas de um cliente podem
ficar numa rede **privada**, com IPs do tipo `10.x.x.x` que não existem na internet. O
Frontend fala com o Backend por essa rede, e o Backend não precisa de nenhuma porta pública.

**A KingHost não oferece isso.** Cada VPS tem só o IP público. Se o Frontend falasse com o
Backend pelo IP público, o tráfego da aplicação (senhas, prontuários) passaria em claro pela
rede do datacenter, e a porta da API teria de ficar aberta na internet.

**A solução é construir a rede privada nós mesmos, com WireGuard:** um túnel cifrado entre
as duas máquinas que cria uma placa de rede virtual (`wg0`) em cada uma, com IPs privados:

| Máquina | IP na rede privada |
|---|---|
| Frontend | `10.50.0.1` |
| Backend | `10.50.0.2` |

Tudo que passa por `wg0` vai cifrado, e só entra no túnel quem tem a **chave** certa — não
basta saber o IP. Na prática, é uma VPC de duas máquinas.

⚠️ Os dois IPs públicos estão na mesma faixa (`177.153.69.x`), então as VPS provavelmente
estão no mesmo datacenter: a latência do túnel fica abaixo de 1 ms. Ótimo para a aplicação.

## A3. O IP público do Backend fica fechado — inclusive para o Frontend

O pedido era: **acesso restrito Frontend ↔ Backend e bloqueio do IP público do Backend.**
Este desenho entrega isso de forma mais forte que o plano da Hostinger, por uma escolha
simples: **quem inicia o túnel é o Backend.**

- O Backend **sai** para o Frontend (`177.153.69.147:51820`) e mantém o túnel vivo enviando
  um sinal a cada 25 segundos. Como foi ele que abriu a conexão, as respostas voltam
  normalmente — o firewall reconhece que são respostas.
- Resultado: **o Backend não tem NENHUMA porta aberta na internet.** Nem SSH, nem API, nem
  banco, nem a porta do túnel. Um scanner que bater no `177.153.69.171` não recebe resposta
  de nada.
- O Frontend aceita a porta UDP 51820 **somente vindo do IP do Backend**, e o WireGuard nem
  responde a quem não tiver a chave.

E são **quatro** travas independentes entre o Frontend e a API — uma falhar não abre nada:

| # | Trava | O que garante |
|---|---|---|
| 1 | Chave do WireGuard (+ chave pré-compartilhada) | Só a VPS Frontend entra no túnel |
| 2 | Firewall do Backend (UFW) | A porta 3001 só é aceita **pela interface do túnel** e **vinda de `10.50.0.1`** |
| 3 | A API escuta só em `10.50.0.2` (`HOST=10.50.0.2`) | Na placa de rede pública a porta 3001 **não existe**, mesmo que o firewall seja desligado por engano |
| 4 | Banco e Evolution escutam só em `127.0.0.1` | Nem pelo túnel se chega a eles: só a própria máquina |

## A4. Acesso administrativo com IP de casa por DHCP: Tailscale

O problema: liberar o SSH "só para o meu IP" não funciona quando o IP de casa muda (DHCP) —
no dia em que mudar, você fica trancado para fora.

A solução é o **Tailscale** (você já usa no desenvolvimento): ele cria uma rede privada
entre os **seus aparelhos** (PC, notebook, celular) e as VPS. Quem entra é o **aparelho
autenticado na sua conta**, não um IP. Por isso:

- a porta 22 (SSH) **fecha para a internet** nas duas VPS;
- o SSH só é aceito pela interface do Tailscale;
- o IP de casa pode mudar quantas vezes quiser; de qualquer rede (inclusive 4G) você entra.

O Tailscale **só transporta** a conexão: o SSH continua sendo o do Ubuntu, com a **sua chave**.
Ele não substitui o WireGuard entre as VPS — o tráfego da aplicação não deve depender de um
serviço de terceiros; o Tailscale é só a porta de administração.

## A5. Camadas de defesa

| # | Camada | Onde | O que barra |
|---|---|---|---|
| 1 | **Cloudflare** | borda, antes de tudo | DDoS, ataques web conhecidos (WAF), robôs, força bruta, varredura; esconde os IPs reais |
| 2 | **Cloudflare Tunnel** | VPS Frontend | O Frontend não precisa de porta 80/443 aberta: ele mesmo liga para o Cloudflare |
| 3 | **UFW** (firewall do Linux) | cada VPS | Tudo que não for o túnel WireGuard e o SSH via Tailscale |
| 4 | **WireGuard** | entre as VPS | Cifra Frontend ↔ Backend e só aceita quem tem a chave |
| 5 | **Nginx** | VPS Frontend | Limite de requisições por IP, tamanho de upload, cabeçalhos de segurança |
| 6 | **Aplicação** | Node | Helmet, limite por usuário, permissões (RBAC), autoria, bloqueio de login, 2FA |
| 7 | **Banco** | PostgreSQL | Só localhost, senha forte, usuário sem privilégio de dono, **RLS por empresa** |
| 8 | **Backup cifrado** | fora da KingHost | Mesmo com o servidor comprometido, o backup não pode ser lido nem apagado |

⚠️ **A KingHost não oferece firewall no painel** (situação atual). Isso torna o UFW a única
barreira de rede **dentro** da máquina — e é por isso que as travas 3 e 4 da [A3](#a3-o-ip-público-do-backend-fica-fechado--inclusive-para-o-frontend)
existem: os serviços escutam em interfaces privadas, então um erro no firewall não os expõe.
Se um dia o painel ganhar firewall por IP, configure-o como camada extra com as mesmas
regras da [A6](#a6-matriz-de-tráfego-o-que-pode-falar-com-o-quê).

## A6. Matriz de tráfego (o que pode falar com o quê)

| Origem | Destino | Porta | Caminho | Permitido? |
|---|---|---|---|---|
| Internet | Backend | **qualquer** | IP público | ❌ **nenhuma** |
| Internet | Frontend | qualquer | IP público | ❌ nenhuma (exceto UDP 51820 vindo **só** do IP do Backend) |
| Cloudflare | Frontend | — | túnel aberto pela própria VPS | ✅ |
| Backend | Frontend | UDP 51820 | IP público | ✅ (é o Backend que abre o túnel) |
| Frontend (`10.50.0.1`) | Backend (`10.50.0.2`) | TCP 3001 | túnel WireGuard | ✅ só esta |
| Backend (`10.50.0.2`) | Frontend (`10.50.0.1`) | TCP 22 | túnel WireGuard | ✅ (publicar o build do site) |
| Qualquer um | Backend | 5432 (banco), 8080 (Evolution) | qualquer | ❌ **nunca** — escutam só em 127.0.0.1 |
| Seus aparelhos | as duas VPS | TCP 22 | **só pelo Tailscale** | ✅ |
| Backend | Internet | 443, 587, 7844… | saída | ✅ |

## A7. Dimensionamento — precisa ajustar alguma VPS?

**Não é preciso mudar nada para começar.**

| | Frontend (4 GB, 2 CPU, 70 GB) | Backend (16 GB, 8 CPU, 240 GB) |
|---|---|---|
| Carga | Nginx + cloudflared: usam menos de 300 MB | Node + PostgreSQL + Chrome headless + LibreOffice + Evolution |
| Avaliação | **Folgado.** Se quiser economizar, o menor plano da KingHost (1–2 GB) daria conta. Manter 4 GB também é razoável: sobra para crescer | **Adequado.** O Chrome usa 300–600 MB por PDF; o Postgres quer RAM para cache |
| Swap a criar | 2 GB | 4 GB |

⚠️ **Disco do Backend:** as fotos, laudos e vídeos ficam **dentro do banco** (CLAUDE.md §8).
O banco e o backup crescem junto. O alerta de disco em 80% ([Parte E](#e3-monitoração)) avisa
antes de virar problema; o caminho previsto quando apertar é o `S3StorageProvider`
([D6](#d6-crescimento-do-disco--o-caminho-já-previsto)).

⚠️ **Perguntas para o suporte da KingHost** — mande antes da Etapa 7 (ver a
[Parte B](#parte-b--antes-de-começar)): existe **console de emergência** (acesso pelo
navegador sem SSH)? Existe **snapshot**? A **porta UDP 123 (hora)** sai? A **porta 587 de saída** está
liberada? Existe **firewall de rede** no painel?

---

# Parte B — Antes de começar

### B1. Contas e serviços

| # | Item | Para quê | Necessário a partir da |
|---|---|---|---|
| P1 | **Tailscale** — a mesma conta que você já usa | Acesso administrativo | Etapa 6 |
| P2 | **Gerenciador de senhas** (Bitwarden, 1Password) | Guardar TODOS os segredos abaixo | Etapa 3 |
| P3 | Domínio **`s2vet.com.br`** registrado (Registro.br, no CNPJ) e **`s2vet.com`** | Endereço da aplicação | Etapa 16 |
| P4 | **Cloudflare** com os dois domínios e os *nameservers* trocados no Registro.br | DNS, WAF, Tunnel | Etapa 16 |
| P5 | **Bucket de backup** — Backblaze B2 ou Cloudflare R2, com versionamento | Backup fora da KingHost | Etapa 11 |
| P6 | **Brevo** com o domínio `s2vet.com.br` autenticado e chave SMTP **nova** | E-mail (2FA, senha, convites) | Etapa 13 |
| P7 | **Google Cloud** de produção com billing: chave Gemini e OAuth Client | IA e login Google | Etapa 13 |
| P8 | **GitHub**: acesso ao repositório `marcoaraujoc/nutricao-equina-super` | Baixar o código | Etapa 13 |
| P9 | **Monitor externo** (UptimeRobot ou Better Stack) | Saber que caiu antes do cliente | Parte E |

✅ As Etapas 1 a 10 **não dependem do domínio**: dá para endurecer as máquinas e montar a VPC
hoje, enquanto o domínio e o Cloudflare são resolvidos.

### B2. Segredos a gerar (todos NOVOS — nenhum reaproveitado do desenvolvimento)

🔴 Os segredos de desenvolvimento já circularam (`docs/SEGURANCA-SECRET-HISTORICO.md`).
Produção nasce com valores próprios. Gere cada um **quando a etapa pedir** e guarde no
gerenciador de senhas na hora.

| Segredo | Etapa | Observação |
|---|---|---|
| Senha do usuário `vetprof` (uma por VPS, ou a mesma) | 3 | Só serve para o `sudo` — o login é por chave |
| Chave do WireGuard de cada VPS + chave pré-compartilhada | 9 | Geradas nas próprias VPS; a privada **nunca** sai de lá |
| Senhas das roles `nutriadmin` e `zls2vetp1` | 10 | Sem `/`, `+`, `=`, `@` (quebram a `DATABASE_URL`) |
| Chave do backup (`age`) | 11 | 🔴 A PRIVADA fica **fora** do servidor, em dois lugares seus |
| `JWT_SECRET` e `JWT_REFRESH_SECRET` | 13 | Diferentes entre si |
| `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`, `EVOLUTION_DB_PASSWORD` | 14 | O token do webhook vazio deixa o webhook ABERTO |
| Chave SMTP do Brevo, chave Gemini, OAuth Client ID | 13 | Pegue nos painéis |
| Token do Cloudflare Tunnel | 16 | Só usado no comando de instalação |

### B3. Mensagem para o suporte da KingHost

Mande antes da Etapa 7. As respostas mudam pouco o roteiro, mas **a primeira é crítica**:

1. A VPS tem **console de emergência pelo navegador** (VNC/KVM) ou **modo de recuperação**,
   que funcione mesmo com o SSH bloqueado?
2. É possível tirar **snapshot** da VPS? Quantos, por quanto tempo, com que custo?
3. A **porta UDP 123 de saída** (sincronização de hora, NTP) está liberada? *(A Etapa 1 mostrou
   o relógio sem sincronizar — ver Etapa 8.6.)* *(IPv6: já respondido pela Etapa 1 — as VPS
   **não têm** IPv6 público, só o `fe80::` local.)*
4. A **porta 587 de saída** (SMTP autenticado, Brevo) está liberada? Há limite de envio?
5. Existe **firewall de rede** no painel, ou filtro de tráfego antes da VPS?
6. Existe **rede privada** entre duas VPS da mesma conta?
7. Há **proteção DDoS** de rede incluída?

⚠️ Se a resposta da 1 for **não**, a rede de segurança da [Etapa 4](#etapa-4--rede-de-segurança-contra-se-trancar-fora)
deixa de ser recomendação e vira **obrigatória** em todo passo de firewall e SSH: sem console,
um erro de configuração só se resolve reinstalando a máquina.

### B4. Ferramentas no seu PC

`[PC]` Abra o **PowerShell** (não precisa ser administrador):

```powershell
ssh -V
```
> **Para que serve:** confirma que o cliente SSH do Windows está instalado (mostra algo como
> `OpenSSH_for_Windows_9.x`). Ele vem com o Windows 10/11.

```powershell
Get-ChildItem $env:USERPROFILE\.ssh
```
> **Para que serve:** lista suas chaves SSH. Você deve ver um par como `id_ed25519` (chave
> **privada** — nunca compartilhe) e `id_ed25519.pub` (chave **pública** — é a que foi
> cadastrada nas VPS).

```powershell
tailscale status
```
> **Para que serve:** confirma que o Tailscale está instalado e conectado neste PC. Se der
> "comando não encontrado", instale em `https://tailscale.com/download`.

🔴 **Faça uma cópia da sua chave privada SSH** (`id_ed25519`) dentro do gerenciador de senhas.
Se o PC quebrar, é ela que te deixa entrar nas VPS de outro computador. O passo a passo está
logo abaixo.

#### Backup da chave privada SSH `[PC]`

Sem senha e sem root pela rede (Etapa 5), **só as chaves cadastradas entram nas VPS**. Perdeu o
PC e o celular ao mesmo tempo, sem cópia, e o único caminho volta a ser o console da KingHost.

**1. A chave tem frase-senha?**
```powershell
ssh-keygen -y -f $env:USERPROFILE\.ssh\id_ed25519
```
> **Para que serve:** mostra a chave pública a partir da privada. Se **pedir uma senha**, a
> chave já está protegida: pule para o passo 3. Se mostrar a chave **direto**, ela não tem
> frase-senha — e qualquer cópia dela (pendrive, backup do Windows) entra nas VPS sozinha.

**2. Recomendado: pôr uma frase-senha na chave**
```powershell
ssh-keygen -p -f $env:USERPROFILE\.ssh\id_ed25519
```
> **Para que serve:** cifra a chave privada com uma frase-senha (crie e guarde no gerenciador
> de senhas). A chave continua a **mesma** — nada muda nas VPS. Daí em diante o `ssh` pede a
> frase a cada conexão; para digitar só uma vez por sessão do Windows, num PowerShell **como
> administrador**:
> `Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent`
> e depois, no PowerShell normal, `ssh-add $env:USERPROFILE\.ssh\id_ed25519`.

**3. Guardar no gerenciador de senhas**
```powershell
Get-Content -Raw $env:USERPROFILE\.ssh\id_ed25519 | Set-Clipboard
```
> **Para que serve:** copia a chave privada para a área de transferência. Cole num item do
> gerenciador do tipo **"Chave SSH"** (Bitwarden e 1Password têm) ou numa **nota segura**,
> com o nome "SSH S2Vet — PC", junto da frase-senha e da chave pública (`id_ed25519.pub`).
> Em seguida limpe a área de transferência: `Set-Clipboard -Value ' '`. ⚠️ Se o
> **histórico da área de transferência** do Windows estiver ligado (`Win + V` mostra a lista),
> apague a entrada da chave por ali também.
> 🔴 **Nunca** guarde a chave em e-mail, chat, Google Drive/OneDrive sem cifra ou foto.

**4. Segunda cópia, fora do computador (opcional, recomendado)**
```powershell
Copy-Item $env:USERPROFILE\.ssh\id_ed25519, $env:USERPROFILE\.ssh\id_ed25519.pub E:\
```
> **Para que serve:** copia o par para um pendrive (troque `E:` pela letra dele), guardado em
> lugar seguro — o mesmo pendrive da chave do backup (Etapa 11). Só faça isso **com
> frase-senha** (passo 2): sem ela, quem achar o pendrive entra nas VPS.

**5. Provar que a cópia funciona**

Cole o conteúdo guardado no gerenciador num arquivo de teste e confira:
```powershell
Get-Clipboard -Raw | Set-Content -NoNewline $env:USERPROFILE\.ssh\teste_restauracao
ssh-keygen -y -f $env:USERPROFILE\.ssh\teste_restauracao
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
Remove-Item $env:USERPROFILE\.ssh\teste_restauracao
```
> **Para que serve:** (copie a chave **a partir do gerenciador** antes do primeiro comando)
> recria a chave a partir da cópia e mostra a pública dela. ✅ As duas linhas que aparecem —
> a da cópia e a do `id_ed25519.pub` — têm de começar com o **mesmo** `ssh-ed25519 AAAA…`. O
> último comando apaga o arquivo de teste. Limpe a área de transferência de novo.

**Restaurar num PC novo:** salve o conteúdo como `C:\Users\<você>\.ssh\id_ed25519` (pasta
`.ssh` do seu usuário, sem extensão) e rode `ssh vetprof@s2vet-be` — com o Tailscale instalado
e logado na mesma conta. Se o Windows reclamar de `UNPROTECTED PRIVATE KEY FILE`:
`icacls $env:USERPROFILE\.ssh\id_ed25519 /inheritance:r /grant:r "$($env:USERNAME):R"`
(deixa o arquivo legível só por você).

---

# Parte C — Roteiro de execução

Ordem: **Etapas 1 a 8 nas duas VPS** (uma de cada vez; comece pelo **Backend**, que é o que
tem dado), depois a 9 (as duas juntas), 10 a 14 no Backend, 15 e 16 no Frontend, e 17 em diante.

| Etapa | Onde | Resultado |
|---|---|---|
| 1 | AMBAS | Você sabe o que veio instalado e o que está exposto |
| 2 | AMBAS | Sistema atualizado, fuso e nome configurados |
| 3 | AMBAS | Usuário `vetprof` com `sudo`; o root deixa de ser usado |
| 4 | — | Você sabe como não se trancar para fora |
| 5 | AMBAS | SSH só aceita chave (fim da força bruta de senha) |
| 6 | AMBAS | SSH funcionando pelo Tailscale |
| 7 | AMBAS | Firewall ligado; **porta 22 fechada para a internet** |
| 8 | AMBAS | fail2ban, atualizações automáticas, swap, kernel endurecido |
| 9 | FE + BE | **VPC pronta**: túnel cifrado; Backend sem porta pública |
| 10–14 | BE | Banco, backup, dados, API e WhatsApp |
| 15–16 | FE | Nginx e Cloudflare Tunnel |
| 17 | BE | Primeiro deploy — a aplicação abre no navegador |
| 18–19 | WEB / PC | WAF do Cloudflare e testes de aceite |

### Estado da execução

> Atualize esta tabela a cada etapa concluída — é ela que diz, numa sessão futura, onde parar e
> onde retomar. ✅ concluído e conferido · ⚠️ feito, falta a conferência indicada · ⏳ pendente.

| Etapa | Backend (s2vet-be · .171) | Frontend (s2vet-fe · .147) |
|---|---|---|
| 1 Inventário | ✅ 2026-10-06 | ✅ 2026-10-06 |
| 2 Atualização + nome | ✅ (nome `s2vet-be`) | ✅ (nome `s2vet-fe`) |
| 3 Usuário administrativo | ✅ `vetprof` | ✅ `vetprof` |
| 5 SSH só com chave | ✅ 2026-10-06 (`permitrootlogin no`, `passwordauthentication no`, `allowusers vetprof`) | ✅ 2026-10-06 (`permitrootlogin no`, `allowusers vetprof deploy`; root travado) |
| 6 Tailscale | ✅ `tag:s2vet-server`, sem expiração | ✅ `100.68.176.6`, `tag:s2vet-server`, sem expiração |
| 7 Firewall + porta 22 fechada | ✅ 2026-10-06 (`TcpTestSucceeded : False`) | ✅ 2026-10-06 (portas 22 e 80: `TcpTestSucceeded : False`) |
| 8 Proteções do sistema | ✅ 2026-10-07 — Lynis **65 → 73** · swap 1+3 GB · sessões antigas encerradas · ⏳ chamado KingHost: NTP (UDP 123) bloqueado; hora vem do Xen | ✅ 2026-10-07 — Lynis **65 → 72** · swap 1 GB · ⚠️ confirmar `who` sem as sessões `pts/2`/`pts/3` · ⏳ chamado KingHost (NTP, idem BE) |
| 9 VPC (WireGuard) | ✅ 2026-10-07 túnel no ar · chaves e PSK conferidas (bate cruzado com o FE) · "sem ping" só na `enX0` · `MTU = 1380` · 50 MB pela 3001 em 9 s · 3001 pelo IP público: *timeout* · ⚠️ confirmar `ip link show wg0` = `mtu 1380` e que a re-execução da Etapa 9 gerou chave privada e PSK NOVAS (as antigas foram expostas) | ✅ 2026-10-07 escutando 51820 só para o IP do BE · regra 22 via wg0 · `MTU = 1380` (conferido) · ping de 1380 bytes sem fragmentar ok |
| 10 Banco | ✅ 2026-10-08 `dbs2vet` + `/var/backups/s2vet` conferidos | — |
| 11 Backup | ✅ 2026-10-08 B2 `s2vet-backups` (Object Lock 30 d, lifecycle 91 d) · 5 arquivos por execução · cron 02:30 · ⏳ conferir o `/var/log/s2vet-backup.log` após a 1ª execução agendada · ⏳ teste de decifrar no PC (`age -d`) | — |
| 12 Dados | ✅ 2026-10-08 roles sem superusuário/BYPASSRLS · 0 tabelas da app · **83** tabelas com RLS forçado (= dev) · ✅ limpeza aplicada (`limparOutrasEmpresas.sql`): só a empresa **69 Equipe Veterinária** — 1 empresa · 4 usuários (ADMIN 1, 233, 234, 235) · 2 pacientes · tokens e WhatsApp de dev zerados · backup antes e depois | — |
| 13 Node/serviço | ✅ 2026-10-08 Node 22 · Chrome · LibreOffice · deploy keys (GitHub ok) · `backend.env`/`frontend.env` 640 root:s2vet · `GOOGLE_CLIENT_ID` = `VITE_GOOGLE_CLIENT_ID` (cliente OAuth "S2Vet Produção") · `s2vet-api.service` sem linhas ignoradas | — |
| 14 Evolution | ✅ 2026-10-07/08 `v2.3.7`, só em `127.0.0.1:8080`, `200`, 3 volumes · `EVOLUTION_API_KEY` igual nos dois `.env` · backup com `evolution_*` · ⏳ conectar um WhatsApp de teste (depois do deploy) | — |
| 15 Nginx | — | ✅ 2026-10-08 `deploy` com chave restrita a `from="10.50.0.2"` · Nginx só em `127.0.0.1:8080` · BE → FE como `deploy` ok |
| 16 Tunnel | — | ✅ 2026-10-08 túnel `36f78afd-…` (conta `21fa7…`, criado pelo painel principal, sem Zero Trust) · domínio no Cloudflare (NS `rose`/`vicente`) · `app` → `http://127.0.0.1:8080` · ⏳ apagar `A`/`AAAA`/`www` da Hostinger · ⏳ autenticar o domínio no Brevo |
| 17 Deploy | ✅ 2026-10-08 23:22 release `20261008T232107` · `/health` ok (banco 2 ms) · 3001 só em `10.50.0.2`, 5432/8080 só em loopback · e-mail de teste enviado pelo Brevo · ✅ conversão `.doc` confirmada com laudo real (1,3 s); o `doc:check` acusava falha por causa da amostra artificial — corrigido · ✅ 2026-10-09 login no navegador · ⏳ trocar a senha do Administrador, testar Entrar com Google | ✅ `/api/marca` → `200` pelo Nginx |
| 18 Cloudflare | ✅ 2026-10-09 **plano Pro** · IP visto do BE = `177.153.69.171` (sem saída IPv6) · SSL/TLS (HTTPS sempre, TLS ≥ 1.2, TLS 1.3) · cache *Bypass* em `/api/` · custom rules 1–5 (regra 1 pula: custom, rate limiting, managed, Super Bot Fight Mode, Browser Integrity Check, Security Level) · rate limiting Login + API · Super Bot Fight Mode · notificações · chave Gemini `apis2vet` restrita ao IP do BE · navegador: `/api/marca` e login ok · `curl.exe` recebe `403` em tudo (Super Bot Fight Mode — esperado) · Managed + OWASP (PL1) em **Log** · ⏳ **2026-10-16**: revisar *Security → Events*, criar exceções e mudar para **Block** · ⏳ conferir uma função de IA em produção (restrição da chave) · ⏳ HSTS só depois do go-live | — |
| 19 Aceite | 2026-10-09 ✅ S1 (BE: 22/80/443/3001/5432/8080 fechadas) · ✅ S2 (FE: 22/80/443/8080 fechadas) · ✅ S11 (`server: cloudflare`, sem Nginx) · ✅ S4/S5 caíram em *Custom rules* · ⚠️ `curl.exe` em `/api/marca` bloqueado por *Managed rules* (não pelo Super Bot Fight Mode) — conferir qual regra/conjunto e se ficou em Block · ✅ S6 SSL Labs **A** em todos os IPs (Minimum TLS estava em 1.0 — corrigido para 1.2) · ⏳ demais | — |

**Conferência rápida do estado de uma VPS** (como `vetprof`, entrando pelo Tailscale):
```bash
systemctl list-timers --all | grep s2vet
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|allowusers)'
sudo ufw status verbose
tailscale status --json | jq '.Self.Tags, .Self.KeyExpiry'
```
> **Para que serve:** numa só vez, mostra: se sobrou algum "desfazer" agendado (tem de vir
> **vazio**); se a Etapa 5 está completa (`passwordauthentication no`, `permitrootlogin no`,
> `allowusers vetprof` — no Frontend também `allowusers deploy`); se o firewall está ligado
> (`Status: active`); e se a VPS tem a etiqueta do Tailscale (`["tag:s2vet-server"]`) com chave
> que não expira (`null`).

---

## Etapa 1 — Inventário: o que veio instalado `[AMBAS]`

Antes de mudar qualquer coisa, olhe o que existe. As máquinas estão na internet desde que
foram criadas — com o SSH aberto para o mundo.

`[PC]` Entre na VPS como root (comece pelo Backend):

```powershell
ssh root@177.153.69.171
```
> **Para que serve:** abre um terminal remoto na VPS Backend como `root` (o administrador
> total), usando a chave que você já cadastrou. Para o Frontend, troque o IP por
> `177.153.69.147`. Na primeira vez ele pergunta se confia na máquina: responda `yes`.

A partir daqui, os comandos rodam **na VPS**.

```bash
lsb_release -a
```
> **Para que serve:** mostra a versão do sistema. Esperado: `Ubuntu 24.04.x LTS`. Se vier
> outra, pare e avise — alguns nomes de pacote deste roteiro são específicos do 24.04.

```bash
ip -brief address
```
> **Para que serve:** lista as placas de rede e os IPs de cada uma. Anote o **nome** da placa
> que tem o IP público (geralmente `eth0` ou `ens3`) e se aparece um endereço **IPv6** fora
> do `fe80::` (que é só local). Se houver IPv6 público, o firewall também precisa cobri-lo —
> e já vai cobrir, mas é bom saber.

```bash
ss -tulpn
```
> **Para que serve:** mostra **todas as portas abertas** e qual programa está escutando em
> cada uma. Leia a coluna `Local Address:Port`: `0.0.0.0` ou `[::]` significa "aberto para a
> internet"; `127.0.0.1` significa "só a própria máquina". Esperado agora: `sshd` na 22
> e, no Frontend, provavelmente `nginx` na 80 (o modelo da KingHost veio com Nginx). Anote
> qualquer outra coisa — ela será fechada pelo firewall de qualquer jeito, mas é bom saber
> o que é.

```bash
systemctl list-units --type=service --state=running --no-pager
```
> **Para que serve:** lista os serviços rodando. Serve para notar algo inesperado (um painel,
> um servidor de e-mail, um banco) que o modelo da KingHost tenha instalado.

```bash
awk -F: '$3 >= 1000 && $1 != "nobody" {print $1, $6, $7}' /etc/passwd
```
> **Para que serve:** lista os usuários "humanos" da máquina (nome, pasta, shell). Esperado:
> nenhum ainda. Se aparecer um usuário criado pela KingHost, anote — vamos decidir se ele
> fica na Etapa 5.

```bash
cat /root/.ssh/authorized_keys
```
> **Para que serve:** mostra quais chaves públicas podem entrar como root. Deve haver **só a
> sua** (termina com o comentário que você deu à chave, ex.: `marco@...`). Chave
> desconhecida aqui = alguém mais pode entrar. Se houver, pergunte à KingHost antes de seguir.

```bash
grep -rEi '^\s*(PasswordAuthentication|PermitRootLogin|KbdInteractiveAuthentication)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
```
> **Para que serve:** mostra como o SSH está configurado hoje: se aceita **senha** e se aceita
> **root**. Se aparecer `PasswordAuthentication yes`, a máquina está aceitando tentativas de
> senha da internet inteira **agora** — a Etapa 5 fecha isso.

```bash
grep -n '^Include' /etc/ssh/sshd_config
```
> **Para que serve:** confirma que o arquivo principal do SSH lê a pasta `sshd_config.d/` **logo
> no início** (esperado: `Include /etc/ssh/sshd_config.d/*.conf` numa das primeiras linhas). É
> isso que faz o arquivo `00-s2vet.conf` da Etapa 5 vencer o `PermitRootLogin yes` escrito
> mais abaixo no arquivo principal — o SSH fica com o **primeiro** valor que lê.

```bash
journalctl -u ssh --since "24 hours ago" --no-pager | grep -ciE "invalid user|failed password"
```
> **Para que serve:** conta quantas tentativas de invasão por senha o SSH recebeu nas últimas
> 24 horas. Não se assuste com um número alto (centenas é normal): são robôs varrendo a
> internet. É a melhor demonstração de por que a porta 22 vai ser fechada.

```bash
last -n 20
```
> **Para que serve:** mostra os últimos logins bem-sucedidos (quem, de onde, quando). Todos
> devem ser seus. Login de IP desconhecido = a máquina pode ter sido comprometida; nesse
> caso, **reinstale a VPS pelo painel** antes de colocar qualquer dado nela.
> ⚠️ Se a última linha disser `wtmp begins` com a hora do **seu** login, o histórico só
> começou ali — o `last` não enxerga nada antes. Use o comando seguinte, que lê outro registro.

```bash
journalctl -u ssh --no-pager | grep -E "Accepted (publickey|password)"
```
> **Para que serve:** lista **todos** os logins aceitos que o registro do sistema guardou desde a
> criação da máquina, com a forma (`publickey` = chave, `password` = senha) e o IP de origem.
> 🔴 Todos devem ser **`publickey`** e do **seu** IP. Uma linha `Accepted password` que não foi
> você = alguém acertou a senha do root: **reinstale a VPS** antes de seguir.

```bash
swapon --show; free -h; df -h /
```
> **Para que serve:** mostra se já existe *swap* (memória de reserva em disco), a memória
> total e o espaço em disco. Usado na Etapa 8 para não criar swap duplicada.

```bash
timedatectl
```
> **Para que serve:** mostra o relógio da máquina. Procure **`System clock synchronized: yes`**.
> Relógio errado quebra o código de 2FA, a validade dos tokens de sessão e a ordem dos logs.

✅ Anote: nome da placa de rede, se há IPv6 público, portas abertas e o que chamou atenção.

---

## Etapa 2 — Atualizar o sistema `[AMBAS]`

Ainda como root, na VPS.

```bash
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
```
> **Para que serve:** evita que a instalação de pacotes pare no meio perguntando coisas numa
> tela azul (o `needrestart` do Ubuntu 24.04 faz isso). Vale só para esta sessão do terminal.

```bash
apt update
```
> **Para que serve:** baixa a lista atualizada de pacotes disponíveis. Não instala nada ainda.

```bash
apt -y full-upgrade
```
> **Para que serve:** instala todas as atualizações pendentes, inclusive as de segurança e do
> kernel. O `-y` responde "sim" automaticamente.

```bash
timedatectl set-timezone America/Sao_Paulo
```
> **Para que serve:** coloca o relógio da máquina no horário de Brasília — mesmo fuso do
> ambiente de desenvolvimento e dos logs que você vai ler. (A aplicação calcula o fuso de
> cada clínica sozinha; isto é só para o sistema.)

```bash
hostnamectl set-hostname s2vet-be
```
> **Para que serve:** dá à máquina um nome que diz o que ela é. **No Frontend use
> `s2vet-fe`.** Esse nome aparece no terminal e no Tailscale, e evita o "01/02" da KingHost.

```bash
apt -y install ufw fail2ban unattended-upgrades curl git rsync jq htop ca-certificates gnupg lynis
```
> **Para que serve:** instala as ferramentas base:
> `ufw` (firewall) · `fail2ban` (bloqueia quem erra login repetidamente) ·
> `unattended-upgrades` (atualizações de segurança automáticas) · `curl` (testar endereços) ·
> `git` (baixar o código) · `rsync` (copiar arquivos entre máquinas) · `jq` (ler JSON) ·
> `htop` (ver uso de CPU/RAM) · `ca-certificates`/`gnupg` (validar downloads) ·
> `lynis` (auditoria de segurança, usada na Etapa 8).

```bash
reboot
```
> **Para que serve:** reinicia a máquina para carregar o kernel atualizado. A conexão SSH cai;
> espere ~1 minuto e entre de novo com `ssh root@<IP>`.

---

## Etapa 3 — Usuário administrativo `[AMBAS]`

Trabalhar como `root` é perigoso: um comando errado não tem freio, e o root é o primeiro alvo
de qualquer ataque. Vamos criar o usuário `vetprof`, que vira administrador só quando pede
(`sudo`), e depois **desligar o login do root**.

```bash
adduser vetprof
```
> **Para que serve:** cria o usuário `vetprof` com a pasta `/home/vetprof`. Ele vai pedir uma
> **senha**: gere uma forte no gerenciador de senhas e guarde lá. Essa senha **não** serve
> para entrar por SSH (que será só por chave) — serve para o `sudo` e para um eventual
> console de emergência. As perguntas seguintes (nome completo, telefone) podem ficar em
> branco: só aperte Enter.

```bash
usermod -aG sudo vetprof
```
> **Para que serve:** coloca o `vetprof` no grupo `sudo`, que permite executar comandos como
> administrador digitando `sudo` na frente (e a senha do `vetprof`).

```bash
install -d -m 700 -o vetprof -g vetprof /home/vetprof/.ssh
```
> **Para que serve:** cria a pasta `.ssh` do `vetprof` com permissão `700` (só ele lê e
> escreve). O SSH **recusa** a chave se essa pasta tiver permissão mais aberta.

```bash
cp /root/.ssh/authorized_keys /home/vetprof/.ssh/authorized_keys
```
> **Para que serve:** copia a sua chave pública do root para o `vetprof`. Assim você entra como
> `vetprof` com a mesma chave que já usa.

```bash
chown vetprof:vetprof /home/vetprof/.ssh/authorized_keys && chmod 600 /home/vetprof/.ssh/authorized_keys
```
> **Para que serve:** faz o `vetprof` dono do arquivo e deixa só ele ler (`600`). De novo: o SSH
> ignora o arquivo se as permissões estiverem frouxas.

✅ **Sem fechar o terminal atual**, abra **outro** PowerShell e teste:

```powershell
ssh vetprof@177.153.69.171
```
> **Para que serve:** prova que o novo usuário entra com a sua chave. Troque o IP no Frontend.

```bash
sudo -v
```
> **Para que serve:** (já dentro, como `vetprof`) pede a senha do `vetprof` e confirma que o
> `sudo` funciona. Se responder sem erro, está certo.

🔴 Só siga para a Etapa 5 quando o `ssh vetprof@...` e o `sudo -v` funcionarem. A partir daqui,
**todos os comandos usam `sudo`** e são executados como `vetprof`.

---

## Etapa 4 — Rede de segurança contra se trancar fora

As Etapas 5, 7 e 9 mexem no SSH e no firewall. Um erro ali pode cortar o seu acesso — e,
**sem console de emergência na KingHost**, a única saída seria reinstalar a máquina.

A técnica: **antes** de uma mudança arriscada, você agenda o **desfazer automático** para
daqui a 10 minutos. Se tudo deu certo, cancela o agendamento. Se você ficou trancado, espera
10 minutos e entra de novo.

**Antes de mexer no firewall:**
```bash
sudo systemd-run --unit=s2vet-desfaz-firewall --on-active=10min --timer-property=RemainAfterElapse=no /usr/sbin/ufw disable
```
> **Para que serve:** agenda, para daqui a 10 minutos, o comando que **desliga o firewall**.
> Se a regra que você acabou de criar te trancar para fora, o firewall se desliga sozinho e
> você entra de novo para corrigir.

**Antes de mexer no SSH:**
```bash
sudo systemd-run --unit=s2vet-desfaz-ssh --on-active=10min --timer-property=RemainAfterElapse=no /bin/sh -c 'rm -f /etc/ssh/sshd_config.d/00-s2vet.conf; systemctl restart ssh'
```
> **Para que serve:** agenda, para daqui a 10 minutos, a remoção do arquivo de configuração
> de segurança do SSH (o que a Etapa 5 cria) e o reinício do SSH. Se a configuração nova te
> impedir de entrar, ela se desfaz sozinha.

**Quando tudo funcionou, cancele:**
```bash
sudo systemctl stop s2vet-desfaz-firewall.timer
sudo systemctl stop s2vet-desfaz-ssh.timer
```
> **Para que serve:** cancela o desfazer agendado (use a linha correspondente ao que você
> agendou). 🔴 **Não esqueça**: se não cancelar, em 10 minutos ele desfaz o seu trabalho.

```bash
systemctl list-timers --all | grep s2vet
```
> **Para que serve:** mostra os desfazeres agendados e quanto falta para cada um disparar.
> Vazio = nada agendado.

⚠️ **Erro `Unit s2vet-desfaz-....timer was already loaded`:** já existe um agendamento com esse
nome (de uma tentativa anterior). Antes de agendar de novo, confira se ele **já disparou** — o
`desfaz-ssh` apaga o `00-s2vet.conf`, e o `desfaz-firewall` desliga o UFW (`sudo ufw status`
mostra) — e descarte-o com `sudo systemctl stop s2vet-desfaz-ssh.timer` (ou
`s2vet-desfaz-firewall.timer`). O `--timer-property=RemainAfterElapse=no` dos comandos acima
evita o erro daqui em diante: o agendamento é descartado sozinho depois de disparar.

**As outras redes de segurança:**
- Mantenha **sempre uma sessão SSH aberta** enquanto testa a mudança em **outra** janela.
  Sessão já aberta não cai quando o SSH é reconfigurado.
- Instale o Tailscale também no **celular** (Etapa 6): é o seu acesso reserva se o PC parar.
- Guarde a chave SSH privada no gerenciador de senhas (Parte B4).

---

## Etapa 5 — SSH só com chave (urgente) `[AMBAS]`

Hoje o SSH está aberto para o mundo (a Etapa 1 mostrou as tentativas). Antes mesmo de
fechá-lo, vamos garantir que **senha não funciona** e que **root não entra** — assim as
tentativas viram ruído inofensivo.

🔴 **Armadilha do Ubuntu 24.04:** o SSH usa o **primeiro** valor que encontra para cada
opção, lendo os arquivos de `/etc/ssh/sshd_config.d/` em ordem alfabética. Algumas imagens
trazem um `50-cloud-init.conf` com `PasswordAuthentication yes`. Por isso o nosso arquivo
começa com `00-`: ele é lido primeiro e vence.

Primeiro, a rede de segurança:
```bash
sudo systemd-run --unit=s2vet-desfaz-ssh --on-active=10min --timer-property=RemainAfterElapse=no /bin/sh -c 'rm -f /etc/ssh/sshd_config.d/00-s2vet.conf; systemctl restart ssh'
```
> **Para que serve:** o desfazer automático da [Etapa 4](#etapa-4--rede-de-segurança-contra-se-trancar-fora).

```bash
sudo tee /etc/ssh/sshd_config.d/00-s2vet.conf >/dev/null <<'EOF'
# Ninguém entra como root pela rede.
PermitRootLogin no
# Senha não serve para entrar: só a chave.
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
# No máximo 3 tentativas por conexão e 30 s para concluir o login.
MaxAuthTries 3
LoginGraceTime 30
# Desliga recursos que o servidor não usa (menos superfície de ataque).
X11Forwarding no
AllowAgentForwarding no
# "local" permite abrir um túnel até o banco (DBeaver) sem permitir abrir portas no servidor.
AllowTcpForwarding local
# Derruba sessão sem resposta (janela fechada, rede caída): pergunta a cada 5 min e
# encerra depois de 2 perguntas sem resposta. Evita sessões "fantasmas" penduradas.
ClientAliveInterval 300
ClientAliveCountMax 2
TCPKeepAlive no
# Registra no log a impressão digital da chave usada em cada login (auditoria).
LogLevel VERBOSE
# Só estes usuários podem entrar por SSH.
AllowUsers vetprof
EOF
```
> **Para que serve:** cria o arquivo de configuração de segurança do SSH. O `tee` grava o
> texto entre `<<'EOF'` e `EOF` no arquivo; os comentários explicam cada linha.
> ⚠️ **No Frontend**, troque a última linha por `AllowUsers vetprof deploy` (o usuário `deploy`
> é criado na Etapa 15 para receber o site).

```bash
sudo sshd -t
```
> **Para que serve:** testa a configuração **sem aplicar**. Sem resposta = está correta. Se
> aparecer erro, **não siga**: corrija o arquivo.

```bash
sudo systemctl restart ssh
```
> **Para que serve:** aplica a configuração nova. A sessão em que você está **não cai**.

```bash
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|allowusers|kbdinteractive)'
```
> **Para que serve:** mostra a configuração **efetiva** (depois de juntar todos os arquivos).
> Esperado: `passwordauthentication no`, `permitrootlogin no`, `allowusers vetprof`,
> `kbdinteractiveauthentication no`.

✅ Em **outra** janela do PowerShell:
```powershell
ssh vetprof@177.153.69.171
```
> **Para que serve:** prova que você ainda entra. Deve funcionar normalmente.

```powershell
ssh root@177.153.69.171
```
> **Para que serve:** prova que o root **não** entra mais. Esperado: `Permission denied`.

Funcionou? Cancele o desfazer:
```bash
sudo systemctl stop s2vet-desfaz-ssh.timer
```
> **Para que serve:** impede que o desfazer automático remova a configuração daqui a 10 minutos.

```bash
sudo passwd -l root
```
> **Para que serve:** **trava a senha do root** (o `-l` é de *lock*). Mesmo num console de
> emergência, ninguém entra como root com senha; você entra como `vetprof` (que tem senha) e
> usa `sudo`. Reversível com `sudo passwd -u root`.

```bash
sudo rm -f /root/.ssh/authorized_keys
```
> **Para que serve:** remove a sua chave do root. Com `PermitRootLogin no` ela já não servia;
> apagá-la garante que, se um dia alguém reativar o login do root por engano, não haja chave
> válida ali.

---

## Etapa 6 — Tailscale: o acesso administrativo `[AMBAS]`

### 6.1 No painel do Tailscale `[WEB]` (uma vez só)

Em `https://login.tailscale.com/admin`:

1. **DNS → ative o MagicDNS.** Permite usar `ssh vetprof@s2vet-be` pelo nome, em vez de
   decorar o IP `100.x.y.z` que o Tailscale dá a cada máquina.
2. **Access controls** → clique em **JSON editor** (o *Visual editor* mostra só as regras,
   não o arquivo inteiro) e deixe o arquivo assim:
   ```jsonc
   {
     // Quem pode marcar uma máquina com a etiqueta "s2vet-server": os administradores
     // da rede (você). "autogroup:admin" evita depender da grafia exata do e-mail.
     "tagOwners": {
       "tag:s2vet-server": ["autogroup:admin"],
     },
     // SUBSTITUI a regra padrão "Allow all connections" (src "*" → dst "*"), que deixava
     // TODO aparelho falar com TODO aparelho.
     "grants": [
       // Os SEUS aparelhos ("autogroup:member" = usuários da rede; máquinas com etiqueta
       // NÃO entram) podem falar com tudo, inclusive com as VPS.
       { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },
       // De propósito, NENHUMA regra tem "tag:s2vet-server" como ORIGEM:
       // uma VPS invadida não consegue abrir conexão para o seu PC nem para outro aparelho.
     ],
     // SSH próprio do Tailscale — veio no modelo padrão; não afeta as VPS (rodam com --ssh=false
     // e "autogroup:self" não inclui máquinas com etiqueta).
     "ssh": [
       { "action": "check", "src": ["autogroup:member"], "dst": ["autogroup:self"],
         "users": ["autogroup:nonroot", "root"] }
     ]
   }
   ```
   Este foi o arquivo aplicado em 2026-10-06 (a conta estava no modelo padrão do Tailscale,
   sem `nodeAttrs`). ⚠️ **Não acrescente `nodeAttrs` com `funnel`** sem precisar: ele libera os
   seus aparelhos a publicar serviços na internet pelo Funnel. Se um dia o desenvolvimento usar
   o Funnel (`docs/TAILSCALE_FUNNEL.md`), acrescente
   `"nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]` — as VPS, por terem
   etiqueta, continuam de fora.
   ⚠️ Se a sua política hoje é a padrão ("todos falam com todos"), troque por esta. A padrão
   deixaria uma VPS comprometida alcançar o seu PC de desenvolvimento.
   ⚠️ **Antes de salvar, compare com o arquivo atual.** Blocos que já existem lá e não
   aparecem acima (`groups`, `tests`, `nodeAttrs`) devem ser **mantidos**; troque só a
   regra `"src": ["*"]` do `grants` e acrescente o `tagOwners`. (Contas mais antigas usam
   `"acls"` em vez de `"grants"`: aí a regra equivalente é
   `{ "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] }`.)
   💡 O painel tem **"Preview rules"**/validação: ele recusa salvar um arquivo com erro de
   sintaxe, então não há risco de trancar a rede por vírgula fora do lugar.
   ✅ **MagicDNS** e **HTTPS Certificates** ligados aparecem no painel como botões
   **"Disable MagicDNS…"** e **"Disable HTTPS…"** — o texto do botão é a ação, não o estado.
   Deixe os dois ligados: o HTTPS serve ao Funnel (se um dia o desenvolvimento usar) e não afeta as VPS (elas só
   usariam se alguém rodasse `tailscale cert`/`tailscale funnel` nelas — não rode).
3. **Settings → Keys → Generate auth key…** (`https://login.tailscale.com/admin/settings/keys`).
   A *auth key* é uma "senha de entrada" de **uso único**: permite que a VPS entre na rede sem
   login no navegador e já recebe a etiqueta. Gere **duas** (uma por VPS):

   | Campo | Valor | Por quê |
   |---|---|---|
   | Description | `s2vet-be` / `s2vet-fe` | Saber depois qual chave foi de qual máquina |
   | Reusable | ❌ desligado | Vale para uma máquina só; vazada depois de usada, não serve para nada |
   | Expiration | 1 day | Se não for usada, morre sozinha |
   | **Ephemeral** | ❌ **desligado** | 🔴 Ligado, o Tailscale **apaga a máquina da rede** quando ela fica offline (num reboot) e o SSH some |
   | Pre-approved | ✅ se aparecer | Só existe se a rede exige aprovar aparelho novo |
   | Tags | ✅ `tag:s2vet-server` | A etiqueta das regras de acesso. Só aparece se o `tagOwners` já foi salvo |

   A chave (`tskey-auth-…`) é mostrada **uma única vez**: copie e use direto no comando da 6.2.
   ⚠️ Não cole a chave em chat, e-mail ou documento. Se colar por engano, confira em
   *Settings → Keys* que ela já aparece como usada/expirada — senão, **Revoke**.
   Máquina com etiqueta não tem a "validade de 180 dias" do Tailscale — que, se expirasse,
   derrubaria o seu acesso sem aviso.
4. **Machines** → remova aparelhos que você não usa mais (na rede havia dois iPhones offline
   havia mais de 60 dias). Todo aparelho da rede chega à porta de administração dos servidores;
   ainda precisaria da sua chave SSH, mas aparelho esquecido não deve ter esse caminho. Mantenha
   **um** celular ativo: é o acesso reserva.

### 6.2 Em cada VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```
> **Para que serve:** baixa e roda o instalador oficial do Tailscale, que adiciona o
> repositório deles ao `apt` e instala o programa. O `-fsSL` faz o `curl` falhar em caso de
> erro, não mostrar barra de progresso e seguir redirecionamentos.
> Execute como **`vetprof`, sem `sudo`**: o script percebe que não é root e chama o `sudo`
> sozinho onde precisa (vai pedir a senha do `vetprof`). Para ler o script antes de rodar:
> `curl -fsSL https://tailscale.com/install.sh -o /tmp/ts.sh && less /tmp/ts.sh && sh /tmp/ts.sh`.

```bash
sudo tailscale up --auth-key=<AUTH_KEY_DESTA_VPS> --hostname=s2vet-be --ssh=false --accept-dns=false
```
> **Para que serve:** conecta a VPS à sua rede Tailscale. Parâmetros:
> `--auth-key` — a chave gerada no painel (uma para cada VPS; depois de usada, perde a validade);
> `--hostname` — o nome que aparece no Tailscale (**no Frontend: `s2vet-fe`**);
> `--ssh=false` — o SSH continua sendo o do Ubuntu, com a sua chave (o Tailscale só transporta);
> `--accept-dns=false` — a VPS continua usando o DNS normal; ela não precisa resolver os nomes
> da sua rede, e assim não passa a depender do Tailscale para acessar a internet.

> O comando não mostra nada quando dá certo. (Rodar o instalador como `root` em vez de
> `vetprof` também está certo: o resultado é idêntico — o `tailscaled` roda como root de
> qualquer forma.)

```bash
tailscale ip -4
```
> **Para que serve:** mostra o IP da VPS dentro do Tailscale (`100.x.y.z`). Anote.
> Registrados: `s2vet-fe` = `100.68.176.6` (nome completo `s2vet-fe.tail854f06.ts.net`).

```bash
tailscale status --json | jq '.Self.Tags, .Self.KeyExpiry'
```
> **Para que serve:** ✅ confere a etiqueta. Esperado: `["tag:s2vet-server"]` e, na linha
> seguinte, `null` (a chave da máquina **não expira**). Uma data aqui = a etiqueta não foi
> aplicada e o acesso cairia nessa data: gere outra *auth key* com o campo *Tags* e rode o
> `tailscale up` de novo. No painel, *Machines* mostra a etiqueta e "Expiry disabled".

**Depois que as duas VPS estiverem na rede** — teste do isolamento, no **Frontend**:
```bash
nc -vz -w 5 s2vet-be.tail854f06.ts.net 22
```
> **Para que serve:** a VPS Frontend tenta abrir o SSH do Backend **pela rede do Tailscale**.
> Esperado: **falhar** (`timed out`). Pela regra salva na 6.1, máquina com etiqueta não abre
> conexão com ninguém — é a prova de que um Frontend invadido não usa o Tailscale para chegar
> ao Backend nem ao seu PC.

### 6.3 No seu PC

```powershell
tailscale status
```
> **Para que serve:** lista os aparelhos da sua rede. `s2vet-be` e `s2vet-fe` devem aparecer.

```powershell
ssh vetprof@s2vet-be
```
> **Para que serve:** entra na VPS **pelo Tailscale**, usando o nome. ✅ Tem de funcionar
> antes de seguir para a Etapa 7. (No Frontend: `ssh vetprof@s2vet-fe`.)

**Opcional, mas confortável** — atalho no PC para não digitar usuário toda vez:

```powershell
Add-Content $env:USERPROFILE\.ssh\config "`nHost s2vet-be s2vet-fe`n    User vetprof`n    IdentityFile ~/.ssh/id_ed25519`n"
```
> **Para que serve:** grava no arquivo de configuração do SSH do Windows que, para as duas
> máquinas, o usuário é `vetprof` e a chave é a sua. Depois disso basta `ssh s2vet-be`.

⚠️ Instale o Tailscale também no **celular** e entre com a mesma conta: é o acesso reserva.

### 6.4 No celular (acesso reserva)

1. App **Tailscale**, mesma conta, conexão ligada: `s2vet-be` e `s2vet-fe` aparecem na lista.
2. App de SSH (Termius no iPhone/Android, ou Termux no Android) → **gere uma chave ED25519
   no próprio celular**, com o nome `celular`. 🔴 Nunca copie a chave privada do PC para o
   celular: cada aparelho tem a sua, e o celular perdido se resolve apagando só a linha dele.
   Se o app oferecer sincronizar chaves na nuvem, recuse.
3. Mande a chave **pública** (`ssh-ed25519 AAAA… celular`) para você mesmo e, **pelo PC**, em
   cada VPS:
   ```bash
   echo 'ssh-ed25519 AAAA...COLE_AQUI... celular' >> ~/.ssh/authorized_keys
   ```
   > **Para que serve:** acrescenta a chave do celular às aceitas para o `vetprof`.
   > 🔴 Dois sinais (`>>`): com um só (`>`) a chave do PC é **apagada**. Confira com
   > `cat ~/.ssh/authorized_keys` — duas linhas, a do PC e a `celular`.
4. No app: host `s2vet-be.tail854f06.ts.net`, porta 22, usuário `vetprof`, chave `celular`,
   **senha em branco** — o servidor não aceita senha para entrar (Etapa 5). A senha do
   `vetprof` só é pedida pelo `sudo`: digite na hora e **nunca deixe o app salvar**; assim, quem
   pegar o celular entra como `vetprof` mas não vira administrador. Ative também o PIN/biometria
   do próprio app e, se ele oferecer sincronizar chaves na nuvem, deixe desligado. Na primeira
   conexão, confira a impressão digital que o app mostra com
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` (rodado na VPS pelo PC).
   ✅ `hostname` responde `s2vet-be`. Idem `s2vet-fe`.
5. ✅ Contraprova: com o Tailscale **desligado** no celular, a conexão falha — pelo nome e pelo
   IP público `177.153.69.171`, no 4G.

⚠️ Errar a configuração 5 vezes em 10 min faz o fail2ban (Etapa 8) bloquear o IP do celular por
1 h — só ele; o PC continua entrando. Para liberar antes, pelo PC:
`sudo fail2ban-client set sshd unbanip <IP_100.x_DO_CELULAR>` (o IP aparece no app do Tailscale).
Celular perdido: apague a linha `celular` do `authorized_keys` nas duas VPS e remova o aparelho
em *Machines* no painel do Tailscale.

💡 **Backup da chave do celular: não precisa.** O backup que importa é o da chave do **PC**
([B4](#b4-ferramentas-no-seu-pc)). Celular novo (ou app reinstalado) = **chave nova**, gerada
nele e cadastrada pelo PC com o passo 3 acima — e a linha antiga `celular` é apagada. Restaurar
uma cópia da chave antiga num aparelho novo manteria válida uma chave que pode ter ficado no
aparelho perdido. Se ainda assim quiser guardar, use a opção de copiar/exportar a chave
privada do próprio app (no Termux: `cat ~/.ssh/id_ed25519`) e cole **direto no gerenciador de
senhas**, nunca em e-mail, nota do celular ou nuvem.

---

## Etapa 7 — Firewall (UFW) e fechamento do SSH público `[AMBAS]`

🔴 **Faça esta etapa conectado PELO TAILSCALE** (`ssh vetprof@s2vet-be`), não pelo IP público.
Assim, quando a porta 22 pública fechar, a sua sessão continua de pé.

O UFW ("firewall descomplicado") é a interface amigável do firewall do Linux. A regra de
ouro é: **bloqueia tudo que chega, libera só o que for nomeado**.

**Antes de começar, confira o estado atual:**
```bash
systemctl list-timers --all | grep s2vet
sudo ufw status verbose
```
> **Para que serve:** mostra se sobrou "desfazer" de tentativa anterior e se o firewall já está
> ligado. Se aparecer `s2vet-desfaz-...` agendado, cancele antes
> (`sudo systemctl stop s2vet-desfaz-firewall.timer s2vet-desfaz-ssh.timer`): senão ele dispara
> no meio do seu trabalho. Se o UFW estiver `active` com uma regra `22` ou `OpenSSH` liberada
> para `Anywhere` **sem** `on tailscale0`, apague-a (`sudo ufw status numbered` e
> `sudo ufw delete <número>`). No Frontend havia "desfazer" antigos agendados — confira lá com
> atenção.

```bash
sudo systemd-run --unit=s2vet-desfaz-firewall --on-active=10min --timer-property=RemainAfterElapse=no /usr/sbin/ufw disable
```
> **Para que serve:** o desfazer automático da [Etapa 4](#etapa-4--rede-de-segurança-contra-se-trancar-fora).

```bash
sudo grep '^IPV6=' /etc/default/ufw
```
> **Para que serve:** confirma que o firewall também protege o IPv6. Esperado: `IPV6=yes`. Se
> vier `no`, rode `sudo sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw` — sem isso, uma VPS
> com IPv6 ficaria **aberta** por esse endereço.

```bash
sudo ufw default deny incoming
```
> **Para que serve:** a política padrão para o que **chega**: bloquear. Só passa o que uma
> regra liberar explicitamente.

```bash
sudo ufw default allow outgoing
```
> **Para que serve:** a política para o que **sai** da máquina: liberar. A VPS precisa sair
> para atualizar o sistema, falar com o Cloudflare, o Gemini, o Brevo, o GitHub, o backup.
> As **respostas** dessas conexões voltam normalmente: o firewall lembra quem abriu a conversa.

```bash
sudo ufw default deny routed
```
> **Para que serve:** a máquina não repassa tráfego entre redes (não é roteador). Se um dia
> alguém tentar usá-la como ponte, o firewall recusa.

```bash
sudo ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH so pelo Tailscale'
```
> **Para que serve:** a única regra de entrada desta etapa: aceita SSH (porta 22) **somente
> pela interface do Tailscale** (`tailscale0`). Pelo IP público, a 22 fica fechada. Nenhuma
> regra cita o IP da sua casa — por isso ele pode mudar à vontade.

```bash
sudo ufw --force enable
```
> **Para que serve:** liga o firewall agora e o mantém ligado após reiniciar. O `--force`
> pula a pergunta "isso pode derrubar sua conexão SSH, continuar?".

```bash
sudo ufw status verbose
```
> **Para que serve:** mostra o estado do firewall. Esperado (saída real do Backend, 2026-10-06):
> ```
> Status: active
> Default: deny (incoming), allow (outgoing), disabled (routed)
> 22/tcp on tailscale0       ALLOW IN    Anywhere        # SSH so pelo Tailscale
> 22/tcp (v6) on tailscale0  ALLOW IN    Anywhere (v6)   # SSH so pelo Tailscale
> ```
> ⚠️ `disabled (routed)` em vez de `deny` é **normal**: o UFW mostra assim quando o próprio
> kernel já não repassa tráfego entre redes (`ip_forward` desligado) — não há repasse algum a
> bloquear. É o estado desejado.

✅ Em **outra** janela do PowerShell, teste as duas portas de entrada:

```powershell
ssh vetprof@s2vet-be
```
> **Para que serve:** pelo Tailscale **tem de entrar**.

```powershell
Test-NetConnection 177.153.69.171 -Port 22
```
> **Para que serve:** o PowerShell tenta abrir a porta 22 pelo IP público. Esperado:
> **`TcpTestSucceeded : False`** (com o aviso `TCP connect ... failed`) — a porta fechou para a
> internet. Demora uns 20 segundos. No Frontend, use `177.153.69.147`.
> `PingSucceeded : True` na mesma saída é só o `ping`, que o UFW responde por padrão — ver o
> passo opcional abaixo.
> Se der `TcpTestSucceeded : True`, o firewall não está bloqueando: confira
> `sudo ufw status verbose` (o caso real de 2026-10-06 foi `Status: inactive` no Backend, porque
> a etapa ainda não tinha sido aplicada ali).

Tudo certo? Cancele o desfazer:
```bash
sudo systemctl stop s2vet-desfaz-firewall.timer
```
> **Para que serve:** mantém o firewall ligado (sem isso, ele se desligaria em 10 minutos).

```bash
systemctl list-timers --all | grep s2vet
```
> **Para que serve:** ✅ tem de voltar **vazio**.

**Opcional (recomendado no Backend; desnecessário no Frontend): não responder a ping.**

```bash
sudo sed -i 's/^-A ufw-before-input -p icmp --icmp-type echo-request -j ACCEPT$/-A ufw-before-input -i enX0 -p icmp --icmp-type echo-request -j DROP\n-A ufw-before-input -p icmp --icmp-type echo-request -j ACCEPT/' /etc/ufw/before.rules
sudo ufw reload
grep -n 'ufw-before-input.*echo-request' /etc/ufw/before.rules
```
> **Para que serve:** por padrão o UFW responde ao `ping`, o que avisa a um scanner que existe
> uma máquina viva naquele IP. Esta troca faz o Backend ficar **mudo pela placa pública**
> (`enX0`), continuando a responder pelo túnel WireGuard e pelo Tailscale — que é onde o ping
> serve para diagnóstico. Só IPv4 (o IPv6 precisa do ping para funcionar e não é alterado). O
> `reload` aplica sem derrubar conexões; o `grep` deve mostrar a linha `-i enX0 ... DROP`
> **antes** da linha `ACCEPT`.
> ⚠️ **Correção de 2026-10-07:** a versão anterior deste passo trocava a regra por um `DROP`
> **sem** `-i enX0`, e o Backend parou de responder ping **também pelo túnel** — o teste da
> Etapa 9 (`ping 10.50.0.2`) falhava sem haver problema algum no túnel. Se você aplicou a
> versão antiga, corrija com:
> `sudo sed -i 's/^-A ufw-before-input -p icmp --icmp-type echo-request -j DROP$/-A ufw-before-input -i enX0 -p icmp --icmp-type echo-request -j DROP\n-A ufw-before-input -p icmp --icmp-type echo-request -j ACCEPT/' /etc/ufw/before.rules && sudo ufw reload`

---

## Etapa 8 — Proteções do sistema `[AMBAS]`

### 8.1 fail2ban

```bash
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
# Quem errar 5 vezes em 10 minutos fica bloqueado por 1 hora.
bantime  = 1h
findtime = 10m
maxretry = 5
# Lê os registros do sistema (journald) e bloqueia pelo UFW.
backend  = systemd
banaction = ufw

[sshd]
enabled = true
EOF
```
> **Para que serve:** configura o fail2ban, que observa os logs e bloqueia no firewall o IP que
> erra o login repetidamente. Com o SSH só pelo Tailscale ele quase nunca vai agir — mas é
> barato e cobre o caso de uma regra de firewall ser aberta por engano no futuro.

```bash
sudo systemctl enable --now fail2ban
```
> **Para que serve:** liga o fail2ban agora (`--now`) e em todo reinício (`enable`).

```bash
sudo fail2ban-client status sshd
```
> **Para que serve:** mostra que a proteção do SSH está ativa e quantos IPs estão bloqueados.
> ⚠️ Se der erro mencionando `asynchat`, rode `sudo apt -y upgrade fail2ban` (versão
> corrigida do Ubuntu 24.04) e repita.

### 8.2 Atualizações de segurança automáticas

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
```
> **Para que serve:** ativa a instalação automática das **atualizações de segurança** todos os
> dias. Na tela que aparece, responda **Yes**.

```bash
sudo tee /etc/apt/apt.conf.d/52s2vet-unattended >/dev/null <<'EOF'
// Nunca reiniciar sozinho: um reboot às 23:40 derruba o fechamento de fatura do dia.
Unattended-Upgrade::Automatic-Reboot "false";
// Remove dependências que deixaram de ser usadas (menos software = menos falhas).
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
```
> **Para que serve:** ajusta duas regras das atualizações automáticas. O reinício, quando o
> kernel pedir, é **manual**, na janela de manutenção ([Parte E](#e5-janelas-de-manutenção)).

```bash
cat /var/run/reboot-required 2>/dev/null || echo "nao precisa reiniciar"
```
> **Para que serve:** diz se alguma atualização exige reinício. Use periodicamente.

### 8.3 Swap (memória de reserva)

As VPS da KingHost já vêm com **1 GB de swap** numa partição (`/dev/xvda3`), conferido na
Etapa 1. **No Frontend isso basta: pule esta seção.** No **Backend** (Chrome + banco + Evolution
disputando memória num pico) vale somar mais 3 GB num arquivo, chegando a 4 GB:

```bash
sudo fallocate -l 3G /swapfile
```
> **Para que serve:** `[BE]` reserva um arquivo de 3 GB no disco para servir de memória extra
> quando a RAM encher (evita que o sistema mate a API num pico). Ele soma à partição de 1 GB
> que já existe.

```bash
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```
> **Para que serve:** deixa o arquivo legível só pelo root (a swap pode conter dados da
> memória), formata como swap e liga.

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
> **Para que serve:** faz a swap ser ligada automaticamente em todo reinício.

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-s2vet-swap.conf
```
> **Para que serve:** `[AMBAS]` diz ao Linux para usar a swap só em último caso (10 numa escala
> de 0 a 100). Disco é muito mais lento que RAM. Este comando vale **também no Frontend**.

```bash
swapon --show
```
> **Para que serve:** ✅ no Backend devem aparecer duas linhas: `/dev/xvda3` (1 GB) e
> `/swapfile` (3 GB).

### 8.4 Limite dos logs do sistema

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=2G\n' | sudo tee /etc/systemd/journald.conf.d/s2vet.conf
sudo systemctl restart systemd-journald
```
> **Para que serve:** guarda os logs do sistema em disco (para sobreviverem a um reinício e
> você poder investigar o que aconteceu antes de uma queda) e limita o total a 2 GB, para os
> logs nunca encherem o disco.

### 8.5 Endurecimento do kernel

```bash
sudo tee /etc/sysctl.d/99-s2vet-hardening.conf >/dev/null <<'EOF'
# Recusa pacotes com endereço de origem falsificado.
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
# Ignora "redirecionamentos" de rota enviados por terceiros (usados em ataques de desvio).
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
# Recusa pacotes que dizem por qual caminho querem passar.
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
# Proteção contra inundação de conexões (SYN flood).
net.ipv4.tcp_syncookies = 1
# Não responde a ping enviado para a rede inteira.
net.ipv4.icmp_echo_ignore_broadcasts = 1
# Registra pacotes com endereço impossível (ajuda a investigar).
net.ipv4.conf.all.log_martians = 1
# Esconde endereços de memória do kernel de quem não é root (dificulta exploits).
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
# Impede truques com links simbólicos/físicos em pastas compartilhadas (/tmp).
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
# Programa que trava não deixa um arquivo de memória com dados (senhas, prontuários).
fs.suid_dumpable = 0
EOF
```
> **Para que serve:** grava ajustes de segurança do kernel. Os comentários explicam cada um.
> ⚠️ **Não** ligue `net.ipv4.ip_forward`: nenhuma das VPS é roteador (o WireGuard daqui não
> precisa disso — ele só liga as duas pontas).

```bash
sudo sysctl --system
```
> **Para que serve:** aplica agora todos os arquivos de `/etc/sysctl.d/` (inclusive o da swap).
> A saída lista cada valor aplicado.

### 8.6 Relógio sincronizado (NTP)

A Etapa 1 mostrou **`System clock synchronized: no`** nas duas VPS. O relógio ainda está certo
(ele vem do hipervisor da KingHost), mas sem sincronização ele **deriva** com o tempo. Relógio
errado quebra o código do 2FA (vale por minutos), a validade dos tokens de sessão, o horário dos
jobs (fechamento de fatura) e a ordem dos logs numa investigação.

```bash
timedatectl timesync-status
```
> **Para que serve:** mostra com qual servidor de hora o sistema está tentando falar e se já
> recebeu resposta (`Packet count`). `Server: (null)` ou contagem 0 = nunca conseguiu.

```bash
sudo mkdir -p /etc/systemd/timesyncd.conf.d
printf '[Time]\nNTP=a.st1.ntp.br b.st1.ntp.br c.st1.ntp.br d.st1.ntp.br\nFallbackNTP=ntp.ubuntu.com pool.ntp.org\n' | sudo tee /etc/systemd/timesyncd.conf.d/s2vet.conf
```
> **Para que serve:** aponta a sincronização para os servidores de hora oficiais do Brasil
> (NTP.br, mantidos pelo NIC.br — a hora legal brasileira), com os do Ubuntu como reserva.
> Servidores no Brasil respondem mais rápido e com menos variação.

```bash
sudo systemctl restart systemd-timesyncd && sleep 15 && timedatectl
```
> **Para que serve:** reinicia o serviço de hora, espera 15 segundos e mostra o estado.
> ✅ Esperado: **`System clock synchronized: yes`**.

Se continuar `no`:
```bash
sudo journalctl -u systemd-timesyncd -n 20 --no-pager
```
> **Para que serve:** mostra as mensagens do serviço de hora. `Timed out waiting for reply`
> repetido = a **porta UDP 123 de saída** está bloqueada pela rede da KingHost. Nesse caso,
> pergunte ao suporte (acrescente à lista da B3): o firewall do UFW não bloqueia saída, então
> o bloqueio não é seu.

🔴 **Constatado em 2026-10-06:** é exatamente o caso. No Backend, `Timed out` para **seis**
servidores diferentes (Ubuntu no exterior e NTP.br), inclusive às 17:52, quando o UFW ainda
estava **desligado** — logo, o bloqueio é da rede da KingHost. Chamado a abrir: *"liberar
saída UDP 123 (NTP) nas VPS s2vet01 e s2vet02, ou informar um servidor NTP interno"*.

**Por que a hora está certa mesmo assim:** a VPS roda sobre Xen e o relógio do kernel vem do
servidor físico da KingHost. Confira:
```bash
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
```
> **Para que serve:** mostra de onde o kernel tira a hora. `xen` = vem do servidor físico.

```bash
date -u +%H:%M:%S; curl -sI https://www.google.com | grep -i '^date'
```
> **Para que serve:** compara a hora da VPS com a do Google, obtida por HTTPS (porta 443, que
> não está bloqueada). Diferença de 0–2 s = hora correta.

**Impacto no S2Vet: baixo.** O código do 2FA é gerado **e** conferido pelo mesmo servidor
(guardado no banco por 10 min — não é um código de aplicativo autenticador, que exigiria
relógio exato), e os tokens de sessão também. Segundos de diferença não afetam os jobs.
**Plano B**, se a KingHost não liberar: `htpdate`, que acerta o relógio pela hora de sites
HTTPS, com precisão de ~1 s.

### 8.7 Desligar serviços que um servidor não usa

A imagem da KingHost veio com serviços de computador de mesa. Cada serviço rodando é código que
pode ter falha; o que não serve para nada deve ser desligado.

```bash
sudo systemctl disable --now ModemManager udisks2
```
> **Para que serve:** desliga agora (`--now`) e para sempre (`disable`) o **ModemManager**
> (gerencia modem 3G/4G — uma VPS não tem) e o **udisks2** (monta pendrive e disco externo —
> idem). Nada da aplicação depende deles.

```bash
sudo multipath -ll
```
> **Para que serve:** mostra se existe algum disco de rede com caminhos múltiplos (*multipath*),
> que é para o que serve o `multipathd`. Numa VPS com disco `xvda` a resposta esperada é
> **vazia**.

```bash
sudo systemctl disable --now multipathd multipathd.socket
```
> **Para que serve:** **só se o comando anterior respondeu vazio**: desliga o `multipathd`, que
> fica vigiando discos que esta máquina não tem.

**Opcional — remover dois pacotes da imagem padrão que estas VPS não usam.** Conferido no
Frontend em 2026-10-06 (`apt-mark showmanual`): a imagem é um Ubuntu Server padrão + `nginx` +
`xe-guest-utilities`, sem PHP, banco ou painel. Sobram dois itens genéricos do Ubuntu:

```bash
systemd-detect-virt
```
> **Para que serve:** diz em que tipo de virtualização a VPS roda. Esperado: **`xen`**. Só siga
> com a remoção do `open-vm-tools` se for `xen` (se for `vmware`, ele é necessário).

```bash
snap list
```
> **Para que serve:** lista os programas instalados pelo Snap. Esperado:
> `No snaps are installed yet`. Só remova o `snapd` se a resposta for essa.

```bash
sudo apt -y purge open-vm-tools snapd && sudo apt -y autoremove --purge
```
> **Para que serve:** remove as ferramentas de VMware (inúteis no Xen da KingHost) e o
> gerenciador de pacotes Snap (nada deste roteiro usa), e depois as dependências que ficaram
> órfãs — inclusive kernels antigos. Menos software instalado = menos falhas possíveis.
> ⚠️ A saída mostra `Removing ubuntu-server-minimal`: é **esperado**. Ele é só um pacote-lista
> ("o servidor mínimo deve ter estes pacotes") que incluía o `snapd`; nenhum pacote da lista é
> desinstalado por isso (o `autoremove` removeu só 10 itens pequenos em 2026-10-06, ~245 MB no
> total). **Não reinstale** o `ubuntu-server-minimal`: ele traria o `snapd` de volta.

**Serviços de computador de mesa que sobem sob demanda** — `fwupd` (firmware de BIOS/placas;
numa VPS é a KingHost quem cuida), `packagekit` (instalação de programas por tela gráfica; o
`apt` não precisa dele) e `upower` (bateria de notebook). Como outro programa pode ligá-los a
qualquer momento, `disable` não basta — o certo é **bloquear** (`mask`):

```bash
sudo systemctl disable --now fwupd-refresh.timer
```
> **Para que serve:** desliga o agendamento diário em que o `fwupd` busca firmware na internet.

```bash
sudo systemctl mask --now fwupd packagekit upower
```
> **Para que serve:** para os três agora e impede que voltem a subir, mesmo se outro programa
> pedir. Reversível com `sudo systemctl unmask fwupd packagekit upower`. **Mantenha** o
> `polkit`: o sistema o usa para autorizar ações administrativas.

```bash
who
```
> **Para que serve:** lista quem está conectado. Se aparecer `root` (e na lista de serviços
> aparecer `user@0.service`), é uma janela antiga em que você entrou como root: feche-a com
> `exit`. Depois da Etapa 5 o root não consegue mais entrar.
> ⚠️ **Sessões abertas ANTES do firewall continuam vivas depois dele**: o UFW bloqueia conexão
> **nova**, não a conversa já em andamento. Em 2026-10-06 havia, nas duas VPS, várias sessões de
> `root` e `vetprof` vindas do IP de casa, abertas antes da Etapa 7. Encerre-as:
> `tty` (mostra a SUA sessão — não derrube essa) → `sudo loginctl terminate-user root` (todas
> as do root) → `sudo pkill -KILL -t pts/N` para cada sessão antiga do `vetprof`. Ao final,
> `who` deve mostrar só a sua sessão, vinda de um IP `100.x.x.x` (Tailscale).

⚠️ **Não desligue** `xe-linux-distribution` (é a integração com o hipervisor Xen da KingHost:
desligamento limpo, informações da VM no painel) nem `serial-getty@hvc0` (é o **terminal de
console** do hipervisor — provavelmente o que a KingHost usa como console de emergência; ver B3).

```bash
systemctl list-units --type=service --state=running --no-pager
```
> **Para que serve:** ✅ confere a lista final de serviços. Esperado nas duas VPS: `cron`,
> `dbus`, `fail2ban`, `getty@tty1`, `polkit`, `rsyslog`, `serial-getty@hvc0`, `ssh`,
> `systemd-*` (journald, logind, networkd, resolved, timesyncd, udevd), `tailscaled`,
> `unattended-upgrades`, `user@1000` (você) e `xe-linux-distribution`. No Frontend, também o
> `nginx` (e, depois, o `cloudflared`).

### 8.8 Auditoria de segurança (Lynis)

```bash
sudo lynis audit system --quick 2>/dev/null | tail -n 40
```
> **Para que serve:** o Lynis examina a máquina e dá uma nota de endurecimento
> (**Hardening index**) com sugestões. Rode agora para ter a linha de base e de novo no fim do
> roteiro. ⚠️ Não é para zerar as sugestões: várias não se aplicam a um servidor como este
> (ex.: senha no GRUB, partição separada para `/tmp`). Use como lista para conferir, não
> como meta.
> **Linha de base registrada em 2026-10-06:** **65** nas duas VPS (Backend: 254 testes;
> Frontend: 262), com `Firewall [V]` e `Malware scanner [X]`. **Depois da 8.9 (2026-10-07):
> Backend 73, Frontend 72** (a diferença é o `sysstat`, só no Backend).

```bash
sudo grep -E '^(warning|suggestion)\[\]' /var/log/lynis-report.dat | cut -d'|' -f1-2
```
> **Para que serve:** extrai do relatório só os avisos (`warning`) e as sugestões
> (`suggestion`), cada um com o seu código (ex.: `SSH-7408`), para decidir um a um o que vale
> aplicar.

### 8.9 Rodada de ajustes do Lynis `[AMBAS]`

As duas VPS deram a **mesma** lista em 2026-10-06 (1 aviso + ~45 sugestões). Decisão item a item:

| Código | Sugestão | Decisão | Por quê |
|---|---|---|---|
| **PKGS-7392** (⚠️ aviso) | Pacotes com falha conhecida | ✅ **Aplicar** | Atualização de segurança pendente — passo 1 abaixo |
| SSH-7408 | Endurecer o SSH | ✅ **Aplicar** (parcial) | Derrubar sessão inativa e registrar a chave usada — passo 2. **Não** aplicados: trocar a porta 22 (ela já está fechada para a internet) e proibir túnel (`AllowTcpForwarding local` é o acesso do DBeaver ao banco) |
| KRNL-5820 | Desligar *core dump* | ✅ **Aplicar** | Quando um programa trava, o sistema grava a memória dele em disco — no Backend isso pode conter prontuário e senhas — passo 3 |
| NETW-3200 · USB-1000 | Protocolos `dccp`, `sctp`, `rds`, `tipc` e pendrive | ✅ **Aplicar** | Nenhum é usado; protocolos raros do kernel já tiveram falhas graves — passo 4 |
| PKGS-7346 | Restos de pacotes removidos | ✅ **Aplicar** | Limpeza de configurações órfãs — passo 5 |
| BANN-7126/7130 | Aviso legal no login | ✅ Aplicar (barato) | Deixa registrado que o acesso é restrito — ajuda juridicamente — passo 6 |
| ACCT-9626 | Estatísticas de uso (`sysstat`) | ✅ Aplicar **no Backend** | Histórico de CPU/RAM/disco para saber quando a máquina começa a apertar — passo 7 |
| HTTP-6710 | HTTPS no Nginx | ❌ Não se aplica | O HTTPS termina no Cloudflare e chega cifrado pelo túnel; o Nginx só escuta em `127.0.0.1` |
| BOOT-5122 | Senha no GRUB | ❌ Não aplicar | Só protege contra quem tem o console da máquina — e poderia travar a **sua** recuperação de emergência |
| FILE-6310 | Partições separadas para `/home`, `/tmp`, `/var` | ❌ Não aplicável | Exigiria reinstalar a VPS com outro particionamento; o alerta de disco (Parte E) cobre o risco |
| AUTH-9230/9262/9282/9286 | Regras de senha (validade, força, rodadas) | ❌ Baixo valor | Ninguém entra com senha; a senha do `vetprof` só serve ao `sudo` e é gerada no gerenciador |
| AUTH-9328 | `umask 027` | ⏸️ Adiar | Pode quebrar a leitura do site pelo Nginx no deploy; reavaliar depois da Etapa 17 |
| ACCT-9628 · FINT-4350 · LOGG-2154 | `auditd`, verificação de integridade (AIDE), log externo | ⏸️ Fase 2 | Valem a pena, mas exigem rotina de leitura; listados na D9 |
| HRDN-7230 | Antivírus | ⏸️ Fase 2 | Os anexos ficam no banco, não em arquivos — baixo ganho hoje |
| DEB-0280/0810/0811 · PKGS-7370/7394 · NAME-4028/4404 · FIRE-4513 · TOOL-5002 · FILE-7524 · KRNL-6000 · ACCT-9622 · LYNIS | Ferramentas e ajustes menores | ❌ Não agora | Ganho pequeno ou informativos; o LYNIS só diz que a versão do Ubuntu dele é antiga |

**1. Atualizações pendentes**
```bash
sudo apt update && sudo apt -y upgrade
```
> **Para que serve:** instala agora a atualização de segurança que motivou o aviso (o login
> também mostra "1 update can be applied"). As atualizações automáticas fariam isso sozinhas
> em até um dia — aqui só se adianta.
> 🔴 **Nunca rode `do-release-upgrade`**, mesmo que o login anuncie "New release '26.04 LTS'
> available". Isso troca o Ubuntu inteiro de versão — é um projeto à parte, com teste. O 24.04
> tem suporte até 2029.

**2. SSH: derrubar sessão inativa e registrar a chave usada**
```bash
sudo tee -a /etc/ssh/sshd_config.d/00-s2vet.conf >/dev/null <<'EOF'
ClientAliveInterval 300
ClientAliveCountMax 2
TCPKeepAlive no
LogLevel VERBOSE
EOF
sudo sshd -t && sudo systemctl restart ssh
```
> **Para que serve:** acrescenta ao arquivo da Etapa 5: o SSH pergunta à sua máquina a cada
> 5 min se ela ainda está lá e encerra a sessão depois de 2 perguntas sem resposta (acaba com as
> sessões "fantasmas" de janelas fechadas); e o log passa a registrar **qual chave** entrou.
> O `sshd -t` recusa se houver erro de digitação; teste numa janela nova antes de fechar a
> atual. (Quem montar uma VPS do zero já recebe essas linhas pela Etapa 5.)

**3. Sem gravação de memória de programa que trava (*core dump*)**
```bash
echo '* hard core 0' | sudo tee /etc/security/limits.d/99-s2vet-sem-core.conf
sudo sed -i 's/^enabled=1/enabled=0/' /etc/default/apport
sudo systemctl disable --now apport
```
> **Para que serve:** a primeira linha proíbe todo usuário de gravar *core dump*; as duas
> seguintes desligam o `apport`, o coletor de travamentos do Ubuntu que guarda essas cópias em
> `/var/crash`. Uma cópia da memória da API pode conter dados de paciente e segredos.

**4. Protocolos de rede raros e pendrive desligados**
```bash
sudo tee /etc/modprobe.d/s2vet-desligados.conf >/dev/null <<'EOF'
install dccp /bin/false
install sctp /bin/false
install rds /bin/false
install tipc /bin/false
install usb-storage /bin/false
EOF
```
> **Para que serve:** impede o kernel de carregar esses módulos (protocolos que ninguém usa
> aqui e o suporte a pendrive, que uma VPS não tem). Se algo pedir um deles, o pedido falha.
> Vale a partir de agora, sem reiniciar.

**5. Restos de pacotes removidos**
```bash
dpkg -l | awk '/^rc/ {print $2}'
```
> **Para que serve:** lista os pacotes removidos que deixaram configuração para trás (`rc`).

```bash
dpkg -l | awk '/^rc/ {print $2}' | xargs -r sudo dpkg --purge
```
> **Para que serve:** apaga esses restos.

**6. Aviso legal**
```bash
echo 'Acesso restrito a pessoas autorizadas. Toda atividade e registrada e monitorada. / Authorized access only. All activity is monitored and logged.' | sudo tee /etc/issue /etc/issue.net
```
> **Para que serve:** grava o aviso que aparece no console e nas telas de login. Não protege
> tecnicamente; deixa claro que o acesso é restrito, o que conta numa ação judicial.

**7. `[BE]` Histórico de uso de CPU, memória e disco**
```bash
sudo sed -i 's/^ENABLED="false"/ENABLED="true"/' /etc/default/sysstat
sudo systemctl enable --now sysstat
```
> **Para que serve:** liga a coleta automática (a cada 10 min) do uso da máquina. Com ela,
> `sar -r` mostra a memória de dias anteriores — é como se descobre se o Backend precisa de
> mais RAM antes de ele começar a falhar.

**8. Nova nota**
```bash
sudo lynis audit system --quick 2>/dev/null | grep 'Hardening index'
```
> **Para que serve:** mostra a nova nota (antes: 65). Espere algo em torno de 70–75: o que
> ficou de fora foi decisão, não esquecimento.

✅ Fim da base. As duas VPS agora: atualizadas, sem root, sem senha no SSH, sem porta 22
pública, com firewall e atualização automática. **Repita as Etapas 1 a 8 na outra VPS** antes
de seguir.

---

## Etapa 9 — A VPC privada (WireGuard)

Endereços: **Frontend `10.50.0.1`** (espera a conexão na porta UDP 51820) e
**Backend `10.50.0.2`** (abre a conexão). Ver [A2](#a2-a-vpc-por-que-um-túnel-wireguard) e
[A3](#a3-o-ip-público-do-backend-fica-fechado--inclusive-para-o-frontend).

### 9.1 Instalar e gerar as chaves `[AMBAS]`

```bash
sudo apt -y install wireguard
```
> **Para que serve:** instala as ferramentas do WireGuard (o próprio WireGuard já vem dentro do
> kernel do Ubuntu).

```bash
sudo -i
```
> **Para que serve:** abre um terminal de **root** (você digita a senha do `vetprof`). Os
> próximos comandos mexem em arquivos que só o root lê; fazer tudo como root evita repetir
> `sudo` e evita erros com o redirecionamento de arquivos. **Saia com `exit` no fim da 9.3.**

```bash
cd /etc/wireguard && umask 077
```
> **Para que serve:** entra na pasta do WireGuard e faz com que todo arquivo criado a seguir
> nasça legível **só pelo root** (`umask 077`). As chaves privadas nunca podem ficar abertas.

```bash
wg genkey | tee private.key | wg pubkey > public.key
```
> **Para que serve:** gera o par de chaves desta VPS: `private.key` (secreta — **nunca sai
> desta máquina**) e `public.key` (pode ser mostrada; vai para a outra VPS).

```bash
cat public.key
```
> **Para que serve:** mostra a chave pública. Anote como `PUB_BE` (no Backend) e `PUB_FE`
> (no Frontend). Ela tem 44 caracteres terminando em `=`.

**Só no Frontend** — a chave pré-compartilhada:
```bash
wg genpsk > psk.key && cat psk.key
```
> **Para que serve:** gera uma **segunda** chave, compartilhada entre as duas VPS, que se soma à
> criptografia normal do WireGuard (proteção extra, inclusive contra a quebra futura das
> chaves atuais por computadores quânticos). Copie o valor: ele vai para o Backend.

**Só no Backend** — gravar a mesma chave pré-compartilhada:
```bash
echo '<VALOR_DO_PSK_DO_FRONTEND>' > psk.key
```
> **Para que serve:** grava no Backend a chave pré-compartilhada gerada no Frontend. Ela
> precisa ser **idêntica** nas duas pontas. (Copie e cole pelas duas janelas do terminal; ela
> só viaja dentro da sua sessão SSH, que já é cifrada.)

### 9.2 Arquivo do túnel — Frontend `[FE]` (ainda como root)

```bash
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
# IP desta VPS dentro da rede privada.
Address    = 10.50.0.1/24
# Tamanho máximo do pacote no túnel. O padrão (1420) não passa pela rede da KingHost.
MTU        = 1380
# Porta em que o Frontend espera o Backend chamar.
ListenPort = 51820
PrivateKey = $(cat /etc/wireguard/private.key)

[Peer]
# VPS Backend (s2vet01). Sem "Endpoint": é o Backend que inicia a conexão.
PublicKey    = <PUB_BE>
PresharedKey = $(cat /etc/wireguard/psk.key)
# Só o IP privado do Backend pode falar por este túnel.
AllowedIPs   = 10.50.0.2/32
EOF
```
> **Para que serve:** cria a configuração do túnel no Frontend. Os `$(cat ...)` são
> substituídos automaticamente pelo conteúdo das chaves — você **não precisa** copiar a chave
> privada à mão. **Troque `<PUB_BE>`** pela chave pública do Backend antes de executar.

### 9.3 Arquivo do túnel — Backend `[BE]` (ainda como root)

```bash
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
# IP desta VPS dentro da rede privada. Sem "ListenPort": o Backend não espera
# ninguém — é ele que liga para o Frontend. Por isso não abre porta nenhuma.
Address    = 10.50.0.2/24
# Igual ao do Frontend: as duas pontas precisam do mesmo MTU.
MTU        = 1380
PrivateKey = $(cat /etc/wireguard/private.key)

[Peer]
# VPS Frontend (s2vet02).
PublicKey           = <PUB_FE>
PresharedKey        = $(cat /etc/wireguard/psk.key)
Endpoint            = 177.153.69.147:51820
AllowedIPs          = 10.50.0.1/32
# Manda um sinal a cada 25 s: mantém o túnel aberto e as respostas passando no firewall.
PersistentKeepalive = 25
EOF
```
> **Para que serve:** cria a configuração do túnel no Backend. **Troque `<PUB_FE>`** pela chave
> pública do Frontend. O `PersistentKeepalive` é o que permite ao Backend não ter porta aberta:
> como ele envia um sinal o tempo todo, o firewall dele trata o Frontend como "conversa já
> iniciada" e deixa as respostas entrarem.

**Nas duas VPS**, conferir e sair do root:
```bash
chmod 600 /etc/wireguard/*.key /etc/wireguard/wg0.conf && ls -l /etc/wireguard
```
> **Para que serve:** garante que só o root lê as chaves e a configuração, e lista os arquivos
> para conferir (`-rw-------` em todos).

```bash
exit
```
> **Para que serve:** sai do terminal de root e volta a ser `vetprof`.

### 9.4 Firewall do túnel

`[FE]` — aceitar o túnel **somente** vindo do Backend:
```bash
sudo ufw allow from 177.153.69.171 to any port 51820 proto udp comment 'WireGuard: so o Backend'
```
> **Para que serve:** libera a porta UDP 51820 no Frontend **apenas para o IP do Backend**.
> Qualquer outro IP continua bloqueado — e, mesmo que passasse, o WireGuard não responde a
> quem não tem a chave.

`[FE]` — aceitar o SSH do deploy, só pelo túnel:
```bash
sudo ufw allow in on wg0 from 10.50.0.2 to 10.50.0.1 port 22 proto tcp comment 'Deploy do site via tunel'
```
> **Para que serve:** permite que o Backend envie o site novo para o Frontend (Etapa 17),
> **somente** por dentro do túnel e vindo do IP privado do Backend.

`[BE]` — aceitar a API, só pelo túnel e só vindo do Frontend:
```bash
sudo ufw allow in on wg0 from 10.50.0.1 to 10.50.0.2 port 3001 proto tcp comment 'API: so o Frontend pelo tunel'
```
> **Para que serve:** a **única** porta que o Backend aceita: a da API (3001), e só quando o
> pedido chega pela interface do túnel (`wg0`) vindo de `10.50.0.1`. Nenhuma regra no Backend
> cita o IP público — ele continua **sem nenhuma porta pública**.

### 9.5 Subir o túnel

`[FE]` primeiro (ele precisa estar esperando), depois `[BE]`:
```bash
sudo systemctl enable --now wg-quick@wg0
```
> **Para que serve:** liga o túnel agora e em todo reinício. Cria a placa de rede virtual `wg0`
> com o IP privado.

```bash
sudo wg show
```
> **Para que serve:** mostra o estado do túnel. Procure **`latest handshake: X seconds ago`**
> (o aperto de mão cifrado aconteceu) e contadores `transfer` aumentando. Sem *handshake*,
> veja o [diagnóstico](#se-o-túnel-não-subir) abaixo.

✅ Testes:
```bash
ping -c 3 10.50.0.2
```
> **Para que serve:** `[FE]` testa se o Frontend alcança o Backend **pela rede privada**.
> Esperado: 3 respostas com tempo abaixo de 1–2 ms.

```bash
ping -c 3 10.50.0.1
```
> **Para que serve:** `[BE]` o mesmo, no sentido contrário. (⚠️ No Backend, o teste é para o
> `10.50.0.1` — `ping 10.50.0.2` ali é a própria máquina e não prova nada.)

```bash
ping -c 3 -M do -s 1352 10.50.0.2
```
> **Para que serve:** `[FE]` testa o **MTU**: manda o maior pacote que cabe no túnel (1352 + 28
> = 1380) proibindo que ele seja partido. Esperado: 3 respostas. Se o ping pequeno responde e
> este não, transferências grandes (PDF, upload) vão travar. ⚠️ Com `-s 1392` o erro
> `message too long, mtu=1380` é o esperado — o pacote é maior que o túnel.

**Teste de tráfego real** (o ping só prova o ICMP). `[BE]`, numa janela que fica aberta:
```bash
cd "$(mktemp -d)" && echo 'ok-tunel' > index.html && head -c 50M /dev/urandom > grande.bin
python3 -m http.server 3001 --bind 10.50.0.2
```
`[FE]`:
```bash
curl -sS -o /dev/null -w '%{size_download} bytes em %{time_total}s\n' http://10.50.0.2:3001/grande.bin
```
> **Para que serve:** simula a API: um arquivo de 50 MB atravessa o túnel e a regra do firewall
> da porta 3001. Esperado: `52428800 bytes` em poucos segundos (medido em 2026-10-07: 9 s, numa
> conexão só — não é a capacidade do túnel). Depois: `Ctrl+C` no BE e `cd ~ && rm -rf /tmp/tmp.*`.
> ⚠️ O servidor roda no **Backend**; no Frontend ele falha com `Cannot assign requested address`.

```bash
nc -vz -w 5 10.50.0.2 3001
```
> **Para que serve:** `[FE]` testa a porta da API **pelo túnel e pelo firewall do Backend**.
> Antes de a API existir (Etapa 17), o esperado é **`Connection refused`**: o pedido chegou à
> máquina e só não há ninguém escutando. `timed out` = bloqueado no caminho.

```bash
nc -vz -w 5 10.50.0.1 22
```
> **Para que serve:** `[BE]` confirma que a porta usada pelo deploy (SSH do Frontend) está
> liberada dentro do túnel. Esperado: `succeeded`.

🔴 **Nunca exiba o `wg0.conf` inteiro** (`cat`): ele contém a chave privada. Para conferir, use
`sudo grep -v -E 'PrivateKey|PresharedKey' /etc/wireguard/wg0.conf`. Se a chave privada ou a
pré-compartilhada aparecerem fora da máquina (print, chat, e-mail), troque-as — ver
"Trocar as chaves" logo abaixo.

**Trocar as chaves do túnel** (se vazarem; leva 3 minutos). Em cada VPS, como root
(`sudo -i`, `cd /etc/wireguard && umask 077`):
1. `[FE]` `wg genpsk > psk.key && cat psk.key` — nova chave pré-compartilhada (copie pela tela).
2. `[BE]` `wg genkey | tee private.key | wg pubkey > public.key` · `echo '<NOVO_PSK>' > psk.key` ·
   `sed -i "s|^PrivateKey = .*|PrivateKey = $(cat private.key)|" wg0.conf` ·
   `sed -i "s|^PresharedKey .*|PresharedKey        = $(cat psk.key)|" wg0.conf` · `cat public.key`.
3. `[FE]` `sed -i "s|^PublicKey .*|PublicKey    = <NOVA_PUB_BE>|" wg0.conf` ·
   `sed -i "s|^PresharedKey .*|PresharedKey = $(cat psk.key)|" wg0.conf`.
4. `[FE]` e depois `[BE]`: `systemctl restart wg-quick@wg0 && sleep 30 && wg show` — *handshake*
   recente nas duas. (Para trocar a do Frontend, o mesmo com os papéis invertidos.)
O `|` como separador do `sed` é de propósito: as chaves contêm `/` e `+`, mas nunca `|`.

⚠️ A mensagem `Error: GDBus.Error ... packagekit.service is masked` ao instalar pacotes é
**inofensiva**: é um aviso automático que o `apt` tenta mandar ao `packagekit`, bloqueado na 8.7.
A instalação acontece normalmente.

```powershell
Test-NetConnection 177.153.69.171 -Port 3001
```
> **Para que serve:** `[PC]` prova que a API **não** é alcançável pelo IP público do Backend.
> Esperado: `TcpTestSucceeded : False`. (A API nem está rodando ainda; o teste definitivo é
> na Etapa 19.)

### Se o túnel não subir

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `wg show` sem *handshake* | Chave pública trocada | Em cada VPS, `sudo cat /etc/wireguard/public.key` e confira com o que está no `wg0.conf` da **outra** |
| idem | PSK diferente nas duas | `sudo cat /etc/wireguard/psk.key` nas duas: têm de ser iguais |
| idem | Firewall do FE | `sudo ufw status` no FE deve ter `51820/udp ALLOW IN 177.153.69.171` |
| idem | KingHost filtrando UDP | Pergunte ao suporte (B3, pergunta 5) |
| Funcionou e parou depois de um tempo | Falta o `PersistentKeepalive` no Backend | Conferir o `wg0.conf` do BE |
| BE pinga o FE, mas o FE não pinga o BE | O "sem ping" da Etapa 7 sem `-i enX0` | O túnel está bom. Corrigir a regra (ver a Etapa 7, correção de 2026-10-07) |
| Ping pequeno ok, ping de 1352 bytes ou arquivo grande falham | MTU | `MTU = 1380` no `[Interface]` das duas VPS e `systemctl restart wg-quick@wg0` |
| `wg show` mostra duas chaves diferentes | Normal: a desta VPS e a do outro lado | O que tem de bater é **cruzado**: `wg show wg0 public-key` de uma = `PublicKey` do `wg0.conf` da outra |

```bash
sudo journalctl -u wg-quick@wg0 -n 30 --no-pager
```
> **Para que serve:** mostra as últimas mensagens do serviço do túnel (erros de configuração
> aparecem aqui).

---

## Etapa 10 — Banco de dados (PostgreSQL) `[BE]`

### 10.1 Usuário de serviço e pastas

A aplicação roda com um usuário **próprio e sem poderes** (`s2vet`), nunca como `vetprof` ou
root. Se a aplicação for invadida, o invasor fica preso às permissões desse usuário.

```bash
sudo adduser --system --group --home /opt/s2vet --shell /bin/bash s2vet
```
> **Para que serve:** cria o usuário de sistema `s2vet` (sem senha — ninguém entra como ele por
> SSH) com a pasta `/opt/s2vet`.

```bash
sudo install -d -o s2vet -g s2vet -m 750 /opt/s2vet/{releases,shared,home,bin,.cache}
sudo install -d -o s2vet -g s2vet -m 700 /opt/s2vet/.ssh
sudo install -d -o root  -g root  -m 700 /var/backups/s2vet
```
> **Para que serve:** cria as pastas com dono e permissão corretos:
> `releases/` (cada versão publicada) · `shared/` (arquivos de configuração com segredos) ·
> `home/` (perfil do LibreOffice) · `bin/` (script de deploy) · `.cache/` (Chrome do
> Puppeteer) · `.ssh/` (chaves do deploy, só o `s2vet` lê) · `/var/backups/s2vet` (backups,
> só o root lê).

### 10.2 Instalar o PostgreSQL

🔴 **A produção usa o PostgreSQL 18 — a mesma versão do desenvolvimento** (conferido em
2026-10-07: `18.6 on x86_64-windows`). O Ubuntu 24.04 só traz o **16**, e um backup do 18
**não restaura** no 16 (a Etapa 12 falharia). Por isso o 18 vem do **repositório oficial do
PostgreSQL** (PGDG), e não do Ubuntu.

```bash
dpkg -l 'postgresql*' | grep ^ii || echo "nenhum PostgreSQL instalado"
```
> **Para que serve:** confere que a VPS não veio com outro PostgreSQL. Esperado: `nenhum
> PostgreSQL instalado`, ou só os pacotes `postgresql-common` e `postgresql-client-common`
> (peças compartilhadas, que o 18 também usa — ficam).
> - Se aparecer o **servidor** `postgresql-16`, remova antes (`sudo apt -y purge
>   'postgresql-16*'`): senão os dois disputam a porta 5432 e o 18 sobe na **5433**, onde a
>   aplicação não procura.
> - Se aparecer só o **cliente** `postgresql-client-16` (foi o caso da VPS da KingHost em
>   2026-10-07), ele não atrapalha, mas remova para não haver dois `pg_dump` na máquina:
>   `apt-cache rdepends --installed postgresql-client-16` (nada além dele mesmo) e
>   `sudo apt -y purge postgresql-client-16 && sudo apt -y autoremove`.

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
```
> **Para que serve:** adiciona o repositório oficial do PostgreSQL, com a chave de assinatura
> que prova que os pacotes são legítimos (o `signed-by` faz essa chave valer **só** para este
> repositório). `noble` é o nome do Ubuntu 24.04.

```bash
sudo apt update && sudo apt -y install postgresql-18
```
> **Para que serve:** instala o PostgreSQL 18 e cria o banco inicial (o "cluster" `18/main`).
> As extensões que vinham no antigo pacote `contrib` — entre elas a **`pg_trgm`**, usada pela
> busca de medicamentos — já estão dentro dele.
> ⚠️ **Instale `postgresql-18`, nunca `postgresql` nem `postgresql-contrib`:** com este
> repositório, esses dois apontam para a versão **mais nova** que existir. Quando o 19 sair,
> uma atualização instalaria um segundo PostgreSQL ao lado, vazio, na porta 5433.

```bash
pg_lsclusters
```
> **Para que serve:** ✅ esperado **uma linha só**: `18  main  5432  online  postgres
> /var/lib/postgresql/18/main ...`. Versão 18, porta 5432, ligado.

⚠️ **Atualizações do PostgreSQL são manuais.** As atualizações automáticas da Etapa 8 só
cobrem os pacotes do Ubuntu; as do PGDG ficam de fora **de propósito**, porque instalar uma
versão nova reinicia o banco no meio do dia (ele só escuta em `127.0.0.1`, então esperar a
janela de manutenção não expõe nada). O procedimento mensal está na
[E5](#e5-janelas-de-manutenção).

### 10.3 Configuração

```bash
sudo tee /etc/postgresql/18/main/conf.d/s2vet.conf >/dev/null <<'EOF'
# 🔴 Só a própria máquina conecta. NUNCA '*': o banco não pode sair da VPS.
listen_addresses = 'localhost'
# Senhas guardadas com o algoritmo forte (SCRAM), não o antigo MD5.
password_encryption = scram-sha-256
# Paridade com o desenvolvimento (a base foi testada com a sessão neste fuso).
timezone = 'America/Sao_Paulo'
max_connections = 100
# Memória (VPS de 16 GB dividida com Node, Chrome e Evolution).
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 512MB
wal_compression = on
# Registra consultas lentas (> 1 s), esperas por bloqueio e uso de arquivo temporário.
log_min_duration_statement = 1000
log_lock_waits = on
log_temp_files = 0
EOF
```
> **Para que serve:** grava os ajustes do PostgreSQL num arquivo separado (o arquivo principal
> não é tocado, o que facilita atualizar o PostgreSQL depois). Os comentários explicam cada
> linha.

```bash
sudo cp /etc/postgresql/18/main/pg_hba.conf /etc/postgresql/18/main/pg_hba.conf.original
```
> **Para que serve:** guarda uma cópia do arquivo de regras de acesso antes de alterá-lo.

```bash
sudo tee /etc/postgresql/18/main/pg_hba.conf >/dev/null <<'EOF'
# TIPO   BANCO     USUÁRIO      ENDEREÇO        MÉTODO
# Acesso local (pela própria máquina, sem rede) só para o usuário do sistema de mesmo nome.
local    all       postgres                     peer
local    all       all                          peer
# Pela rede local (127.0.0.1 / ::1): só os dois usuários da aplicação, só no banco dbs2vet, com senha.
host     dbs2vet   nutriadmin   127.0.0.1/32    scram-sha-256
host     dbs2vet   zls2vetp1    127.0.0.1/32    scram-sha-256
host     dbs2vet   nutriadmin   ::1/128         scram-sha-256
host     dbs2vet   zls2vetp1    ::1/128         scram-sha-256
# Qualquer outra combinação é recusada (não há linha que a aceite).
EOF
```
> **Para que serve:** define **quem pode conectar, em qual banco, de onde e como**. Só dois
> usuários, só no banco da aplicação, só da própria máquina, só com senha forte. Qualquer
> outra tentativa é recusada.

```bash
sudo systemctl restart postgresql && sudo systemctl enable postgresql
```
> **Para que serve:** aplica a configuração e garante que o banco sobe em todo reinício.

```bash
sudo ss -tlpn | grep 5432
```
> **Para que serve:** ✅ confirma que o banco escuta **só** em `127.0.0.1:5432` (e `[::1]:5432`).
> Se aparecer `0.0.0.0:5432`, pare: o `listen_addresses` não foi aplicado.

### 10.4 Usuários (roles) e banco

Dois usuários, com papéis diferentes — ver [D3](#d3-banco-dois-usuários-e-por-quê):

| Role | Papel |
|---|---|
| `nutriadmin` | **Dono** das tabelas. Usado **só** para rodar migrations |
| `zls2vetp1` | A **aplicação**. Sem poder de dono: **não consegue desligar o isolamento entre clínicas** |

`[PC]` Gere as duas senhas (PowerShell):
```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```
> **Para que serve:** gera uma senha aleatória de 40 caracteres só com letras e números (sem
> `/`, `+`, `=`, `@`, que quebrariam o endereço de conexão do banco). Rode duas vezes e guarde
> no gerenciador de senhas como "Postgres nutriadmin" e "Postgres zls2vetp1".

```bash
sudo -u postgres psql
```
> **Para que serve:** abre o console do PostgreSQL como o superusuário `postgres`. Os comandos
> seguintes são SQL e rodam dentro dele.

```sql
-- 🔴 Nomes EXATOS: as migrations do projeto os citam pelo nome.
CREATE ROLE nutriadmin LOGIN PASSWORD '<SENHA_NUTRIADMIN>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE zls2vetp1  LOGIN PASSWORD '<SENHA_ZLS2VETP1>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
```
> **Para que serve:** cria os dois usuários, **sem** nenhum superpoder: não são
> superusuários, não criam bancos nem usuários e **não ignoram o RLS** (`NOBYPASSRLS` — o
> isolamento por clínica vale para eles).

```sql
CREATE DATABASE dbs2vet OWNER nutriadmin ENCODING 'UTF8' TEMPLATE template0
  LOCALE_PROVIDER icu ICU_LOCALE 'pt-BR' LOCALE 'C.UTF-8';
REVOKE ALL ON DATABASE dbs2vet FROM PUBLIC;
GRANT CONNECT ON DATABASE dbs2vet TO zls2vetp1;
```
> **Para que serve:** cria o banco da aplicação, com o `nutriadmin` como dono; tira de
> **qualquer** usuário o acesso padrão (`PUBLIC`) e dá ao `zls2vetp1` só o direito de
> **conectar**. As permissões nas tabelas vêm das migrations.
> A linha `LOCALE_PROVIDER icu ICU_LOCALE 'pt-BR'` define a **ordem alfabética** do banco.
> O desenvolvimento (Windows, `English_United States.1252`) ordena como um dicionário:
> "Álvaro" fica junto do "A" e maiúscula ao lado de minúscula. O padrão do Ubuntu (`C.UTF-8`)
> ordena pelo código do caractere: **"Zeca" antes de "Álvaro" e "Bruno" antes de "ana"** —
> toda lista de pacientes, clientes e medicamentos sairia em ordem diferente da que foi
> testada. O ICU em português reproduz a ordem do desenvolvimento e, de quebra, não muda
> quando o Ubuntu é atualizado (mudanças na ordenação do sistema já corromperam índices de
> texto em outras instalações).

```sql
SELECT datlocprovider, datlocale, pg_encoding_to_char(encoding) FROM pg_database WHERE datname = 'dbs2vet';
```
> **Para que serve:** ✅ esperado `i | pt-BR | UTF8` (`i` = ICU).

```sql
\q
```
> **Para que serve:** sai do console do PostgreSQL.

🔴 **A role da aplicação (`zls2vetp1`) NUNCA pode ser dona de tabela, ter `BYPASSRLS`, `CREATE`
no schema ou `TRUNCATE`.** Qualquer uma dessas desliga o isolamento entre clínicas — e o
sintoma é **nenhum**: tudo funciona, só que sem isolamento. A Etapa 12 confere isso.

---

## Etapa 11 — Backup cifrado fora da KingHost `[BE]`

🔴 **Monte o backup ANTES de colocar dado real no servidor** (Etapa 12). A partir do primeiro
restore existe prontuário de verdade na máquina.

O desenho: todo dia, às 02:30, o banco é exportado, **cifrado com uma chave cuja parte secreta
não está no servidor**, e enviado para um bucket fora da KingHost. Se o servidor for invadido,
o invasor não consegue ler os backups; se a KingHost perder a VPS, os backups estão a salvo.

### 11.1 A chave do backup (no seu PC)

`[PC]` Baixe o `age` para Windows em `https://github.com/FiloSottile/age/releases` (arquivo
`age-vX.Y.Z-windows-amd64.zip`), extraia e, na pasta extraída:

```powershell
.\age-keygen.exe -o s2vet-backup.key
```
> **Para que serve:** gera o par de chaves do backup. O arquivo `s2vet-backup.key` contém a
> chave **PRIVADA** (é ela que **abre** os backups). A tela mostra a chave **pública**
> (`age1...`), que só **fecha** — é ela que vai para o servidor.

🔴 Guarde o `s2vet-backup.key` em **dois lugares seus** (gerenciador de senhas + um pendrive
guardado). **Nunca** no servidor. Perdeu a chave = **ninguém** abre os backups, nem você.

### 11.2 Ferramentas no servidor

```bash
sudo apt -y install age rclone
```
> **Para que serve:** instala o `age` (cifra os arquivos) e o `rclone` (envia para o bucket —
> fala com Backblaze B2, Cloudflare R2 e dezenas de outros).

```bash
echo 'age1<SUA_CHAVE_PUBLICA>' | sudo tee /etc/s2vet-backup.pub
```
> **Para que serve:** grava a chave **pública** no servidor. Com ela o servidor consegue
> **cifrar**, mas não decifrar.

### 11.3 O bucket

Provedor escolhido: **Backblaze B2** (2026-10-07). `[WEB]` em `https://secure.backblaze.com`
→ **B2 Cloud Storage**:

**1. Bucket** — *Buckets* → **Create a Bucket**:

| Campo | Valor | Por quê |
|---|---|---|
| Bucket Unique Name | `s2vet-backups` | O nome é único no B2 inteiro. Se já existir, use `s2vet-backups-<algo>` e troque o nome no script (11.4) e nos testes |
| Files in Bucket are | **Private** | Nada acessível por link |
| Default Encryption | **Enable** | Cifra também do lado do B2 (os arquivos já vão cifrados pelo `age`; é uma camada a mais) |
| Object Lock | **Enable** | É o que impede um invasor de **apagar** o backup (abaixo) |

Depois de criado, no bucket:
- **Object Lock → Default Retention:** modo **Governance**, **30 dias**. Cada arquivo enviado fica
  impossível de apagar ou sobrescrever por 30 dias — inclusive com a chave que está no servidor.
  O ataque clássico de ransomware é apagar o backup antes de cifrar o servidor; com o bloqueio,
  um invasor com root no Backend não consegue. (*Governance*, e não *Compliance*: a sua conta
  principal ainda consegue liberar em caso de engano; a chave do servidor não tem esse poder.)
- **Lifecycle Settings → Use custom lifecycle rules:** `fileNamePrefix` vazio,
  `daysFromUploadingToHiding` = **90**, `daysFromHidingToDeleting` = **1**. Apaga cada backup 91
  dias depois do envio. ⚠️ Não use "Keep prior versions for N days": cada backup tem nome
  próprio (data e hora), então nunca vira "versão anterior" e **nada seria apagado** — a conta
  cresceria para sempre.

**2. Chave de aplicação** — *Application Keys* → **Add a New Application Key**:

| Campo | Valor |
|---|---|
| Name of Key | `s2vet-be-backup` |
| Allow access to Bucket(s) | **`s2vet-backups`** (só ele — nunca "All") |
| Type of Access | **Read and Write** |
| Allow List All Bucket Names | ❌ desmarcado |
| File name prefix | em branco |
| Duration (seconds) | em branco (não expira — chave que expira faz o backup parar) |

Ao clicar em **Create New Key**, o B2 mostra **uma única vez** dois valores: **`keyID`** (começa
com `00…`) e **`applicationKey`** (começa com `K00…`). Copie os dois **na hora** para o
gerenciador de senhas ("B2 s2vet-be-backup") — fechou a tela, a `applicationKey` não aparece
mais e é preciso criar outra chave.
⚠️ **Nunca** use a *Master Application Key* da conta: ela alcança todos os buckets e consegue
desligar o Object Lock.
💡 *Read and Write* (e não *Write Only*) porque o `rclone` precisa **listar** o bucket para
enviar os arquivos. Quem impede apagar é o Object Lock, não o tipo da chave.

```bash
sudo rclone config
```
> **Para que serve:** assistente interativo que cadastra o destino do backup. Responda:
> `n` (novo) → nome **`offsite`** → tipo **`b2`** → em `account>` cole o **`keyID`** → em
> `key>` cole a **`applicationKey`** → `hard_delete>` deixe em branco (padrão `false`) →
> `Edit advanced config?` **n** → `y` para confirmar → `q` para sair. A configuração fica em
> `/root/.config/rclone/rclone.conf`, legível só pelo root.

```bash
sudo rclone lsd offsite:
```
> **Para que serve:** ✅ lista os buckets visíveis. `s2vet-backups` deve aparecer.

### 11.4 O script de backup

```bash
sudo tee /usr/local/sbin/s2vet-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Backup diário do S2Vet: banco + configuração + sessão do WhatsApp, cifrados e enviados para fora.
set -euo pipefail                       # para no primeiro erro (nunca envia um backup pela metade)
TS=$(date +%Y%m%d_%H%M)                 # carimbo de data no nome do arquivo
DIR=/var/backups/s2vet
PUB=$(cat /etc/s2vet-backup.pub)

# Banco da aplicação. 🔴 Como "postgres": o FORCE ROW LEVEL SECURITY vale até para o
# dono do schema — exportando como nutriadmin o dump sai VAZIO, sem erro.
runuser -u postgres -- pg_dump -Fc -Z 6 dbs2vet   | age -r "$PUB" > "$DIR/db_$TS.dump.age"
# Usuários e permissões do PostgreSQL (necessários para restaurar em máquina nova).
runuser -u postgres -- pg_dumpall --globals-only  | age -r "$PUB" > "$DIR/globals_$TS.sql.age"
# Arquivos de configuração com segredos.
tar -C /opt -cz s2vet/shared $( [ -f /opt/evolution/.env ] && echo evolution/.env ) \
                                                  | age -r "$PUB" > "$DIR/config_$TS.tgz.age"

# Evolution (WhatsApp): a sessão de cada clínica. Sem isto, perder a VPS obriga
# TODAS as clínicas a escanear o QR Code de novo. Só roda se a Evolution existir.
if [ -f /opt/evolution/docker-compose.yml ]; then
  docker compose -f /opt/evolution/docker-compose.yml exec -T evolution-db \
    pg_dump -U evolution -Fc evolution            | age -r "$PUB" > "$DIR/evolution_db_$TS.dump.age"
  docker run --rm -v evolution_evolution_instances:/d:ro alpine tar -cz -C /d . \
                                                  | age -r "$PUB" > "$DIR/evolution_inst_$TS.tgz.age"
fi

# Envia para o bucket e mantém só 3 dias no disco local (o histórico fica no bucket).
rclone copy "$DIR" "offsite:s2vet-backups/$(hostname)/" --include "*_$TS.*"
find "$DIR" -type f -mtime +3 -delete

# Avisa o monitor que o backup rodou. Se o aviso não chegar em 26 h, o monitor alerta você.
[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" >/dev/null || true
EOF
```
> **Para que serve:** cria o script de backup. Os comentários explicam cada parte. Os arquivos
> saem com a extensão `.age`: estão cifrados e só abrem com a sua chave privada.

```bash
sudo chmod 750 /usr/local/sbin/s2vet-backup.sh
```
> **Para que serve:** torna o script executável, só pelo root (e pelo grupo root).

✅ Rodar uma vez agora (com o banco ainda vazio, só para validar o caminho):
```bash
sudo /usr/local/sbin/s2vet-backup.sh && sudo rclone ls offsite:s2vet-backups/
```
> **Para que serve:** executa o backup e lista o que chegou no bucket. Devem aparecer os
> arquivos `db_...`, `globals_...` e `config_...` dentro da pasta `s2vet-be/`.

### 11.5 Agendamento diário

```bash
echo '30 2 * * * root HEARTBEAT_URL="<URL_DO_MONITOR_DE_BACKUP>" /usr/local/sbin/s2vet-backup.sh >> /var/log/s2vet-backup.log 2>&1' | sudo tee /etc/cron.d/s2vet-backup
```
> **Para que serve:** agenda o backup para **todo dia às 02:30**, como root, gravando a saída
> em `/var/log/s2vet-backup.log`. O horário fica longe da janela dos jobs da aplicação
> (23:15–00:30). Troque `<URL_DO_MONITOR_DE_BACKUP>` pela URL de *heartbeat* do Better Stack ou
> do Healthchecks.io ([Parte E](#e3-monitoração)); se ainda não tiver, apague o trecho
> `HEARTBEAT_URL="..."`.

🔴 **Teste de restauração — mensal e obrigatório.** Backup que nunca foi restaurado não é
backup. Procedimento na [Parte E](#e2-restaurar-um-backup-teste-mensal).

---

## Etapa 12 — Carga inicial dos dados `[BE]`

Decisão D1 do plano: a produção nasce de uma **"imagem dourada"** — o banco de
desenvolvimento, com os catálogos mantidos pelas telas — seguida da **limpeza dos dados de
teste**. ⚠️ O script de limpeza precisa ser escrito e testado **antes**, num ensaio local
(ver `PLANO-PRODUCAO-HOSTINGER.md §7`, Fase 0).

`[PC]` Exportar o banco de desenvolvimento (PowerShell):
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -h localhost -Fc -d dbs2vet -f s2vet_golden.dump
```
> **Para que serve:** exporta o banco de desenvolvimento num arquivo compactado. 🔴 Tem de ser
> com o superusuário `postgres`: com outro usuário o RLS faz o dump sair vazio. O caminho
> completo é necessário porque a instalação do PostgreSQL no Windows não põe o `pg_dump` no
> PATH (conferido em 2026-10-07).

`[PC]` Enviar para o Backend **pelo Tailscale**:
```powershell
scp s2vet_golden.dump vetprof@s2vet-be:/tmp/
```
> **Para que serve:** copia o arquivo para a pasta temporária do Backend, por dentro da conexão
> cifrada do Tailscale.

`[BE]` Restaurar:
```bash
sudo -u postgres pg_restore -d dbs2vet /tmp/s2vet_golden.dump 2>&1 | tee /tmp/restore.log
```
> **Para que serve:** carrega o dump no banco `dbs2vet`, como superusuário, preservando os
> donos e as permissões do desenvolvimento — que usa as **mesmas** roles `nutriadmin` e
> `zls2vetp1` criadas na Etapa 10. A saída fica em `/tmp/restore.log`. ⚠️ Mensagens
> `role "X" does not exist` para outros usuários do desenvolvimento são esperadas — anote
> quais aparecem; as conferências abaixo dizem se algo ficou errado.

```bash
sudo shred -u /tmp/s2vet_golden.dump
```
> **Para que serve:** **apaga com sobrescrita** o dump (ele contém dados pessoais). `rm` comum
> deixaria o conteúdo recuperável no disco.

✅ Conferências de segurança (`sudo -u postgres psql -d dbs2vet`):
```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('nutriadmin','zls2vetp1');
```
> **Para que serve:** as duas linhas devem ter `rolsuper = f` e `rolbypassrls = f`.

```sql
SELECT count(*) FILTER (WHERE tableowner = 'zls2vetp1')  AS tabelas_da_app,
       count(*) FILTER (WHERE tableowner = 'nutriadmin') AS tabelas_do_dono
FROM pg_tables WHERE schemaname = 'schs2vet';
```
> **Para que serve:** `tabelas_da_app` **tem de ser 0**. Se a aplicação for dona de alguma
> tabela, ela consegue desligar o isolamento entre clínicas daquela tabela.

```sql
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'schs2vet' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity;
```
> **Para que serve:** conta as tabelas com o isolamento por empresa ativo e **forçado**. Deve
> bater com o número do ambiente de desenvolvimento (rode a mesma consulta lá).

```sql
\q
```

Em seguida:
1. 🔴 **Rode o script de limpeza de dados de teste** revisado no ensaio (empresas, usuários,
   faturas e pacientes de teste; tokens de sessão, de reset de senha e de 2FA; instâncias de
   WhatsApp que apontam para a Evolution de desenvolvimento).
   Script: `backend/scripts/producao/limparOutrasEmpresas.sql` (2026-10-08) — mantém **só** a
   empresa 69 "Equipe Veterinária" e confere o nome antes de tudo. Roda como `postgres`;
   **sem `-v aplicar=1` é SIMULAÇÃO** (faz tudo, mostra o relatório e desfaz). Aborta sem
   alterar nada se qualquer registro da empresa mantida seria apagado ou teria campo zerado.
   As instruções de uso estão no cabeçalho do arquivo.
2. 🔴 **Rode o backup de novo**: `sudo /usr/local/sbin/s2vet-backup.sh`. Agora há dado real.

---

## Etapa 13 — Node, Chrome, LibreOffice e o serviço da API `[BE]`

### 13.1 Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
```
> **Para que serve:** baixa o script que cadastra o repositório oficial do Node 22 (a mesma
> versão do desenvolvimento, com suporte até abril de 2027).

```bash
less /tmp/nodesource_setup.sh
```
> **Para que serve:** permite **ler** o script antes de rodá-lo como administrador (boa
> prática com qualquer script baixado). Saia com `q`.

```bash
sudo bash /tmp/nodesource_setup.sh && sudo apt -y install nodejs build-essential
```
> **Para que serve:** cadastra o repositório e instala o Node.js e as ferramentas de compilação
> (alguns pacotes npm compilam código nativo na instalação).

```bash
node -v && npm -v
```
> **Para que serve:** ✅ esperado `v22.x`.

### 13.2 Bibliotecas do Chrome (PDF e CRMV)

O backend usa um Chrome sem tela (Puppeteer) para gerar os PDFs enviados por WhatsApp/e-mail e
consultar o CRMV.

```bash
sudo apt -y install unzip rsync jq \
  fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 libcups2t64 \
  libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
  libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 xdg-utils
```
> **Para que serve:** instala as bibliotecas de que o Chrome precisa e as fontes (sem fontes,
> o PDF sai com quadradinhos no lugar das letras).
> 🔴 **`unzip` é obrigatório** (2026-10-08): o `npm ci` do Puppeteer baixa o Chrome compactado
> e, sem `unzip` (o Ubuntu da KingHost não traz), o deploy morre no passo 2/9 com
> `Required native binary ('tar.exe' or 'unzip') was not found`. `rsync` publica a tela no
> Frontend (instale também **no FE**) e `jq` formata a conferência do `/health`. ⚠️ No Ubuntu 24.04 vários nomes ganharam o
> sufixo `t64`: listas antigas da internet falham com "pacote não encontrado".
> ⚠️ O AppArmor do 24.04 bloqueia o *sandbox* do Chrome. O código já o inicia com
> `--no-sandbox` no Linux — **não remova** essa opção do código.

### 13.3 LibreOffice (conversão de `.doc`)

```bash
sudo apt -y install --no-install-recommends libreoffice-writer fontconfig fonts-liberation
```
> **Para que serve:** instala só o editor de texto do LibreOffice (sem a suíte inteira), usado
> para converter laudos `.doc` antigos. Se faltar, nada quebra — o `.doc` só não ganha
> pré-visualização ([D7](#d7-libreoffice-conversão-doc)).

### 13.4 Chaves do usuário de deploy

Duas chaves separadas para o usuário `s2vet`: uma para **ler o código no GitHub** e outra para
**publicar o site no Frontend**. Separadas, uma vazar não compromete a outra.

```bash
sudo -u s2vet ssh-keygen -t ed25519 -N '' -f /opt/s2vet/.ssh/id_github -C s2vet-be-github
sudo -u s2vet ssh-keygen -t ed25519 -N '' -f /opt/s2vet/.ssh/id_frontend -C s2vet-be-frontend
```
> **Para que serve:** gera os dois pares de chaves, sem senha (o deploy roda sem ninguém para
> digitá-la), na pasta `.ssh` do `s2vet`, que só ele lê.

```bash
sudo -u s2vet tee /opt/s2vet/.ssh/config >/dev/null <<'EOF'
Host github.com
    IdentityFile /opt/s2vet/.ssh/id_github
    IdentitiesOnly yes
Host 10.50.0.1
    User deploy
    IdentityFile /opt/s2vet/.ssh/id_frontend
    IdentitiesOnly yes
EOF
sudo chmod 600 /opt/s2vet/.ssh/config
```
> **Para que serve:** diz ao SSH qual chave usar em cada destino. `IdentitiesOnly` impede que
> ele "experimente" outras chaves.

```bash
sudo cat /opt/s2vet/.ssh/id_github.pub
```
> **Para que serve:** mostra a chave pública do GitHub. `[WEB]` GitHub → repositório
> `nutricao-equina-super` → **Settings → Deploy keys → Add deploy key** → cole, nome
> `s2vet-be producao`, e **deixe DESMARCADO "Allow write access"**: o servidor só lê o código;
> se for invadido, não consegue alterar o repositório.

```bash
sudo -u s2vet ssh -T git@github.com
```
> **Para que serve:** ✅ testa a chave. Na primeira vez pergunta se confia no GitHub: `yes`.
> Esperado: `Hi marcoaraujoc/nutricao-equina-super! You've successfully authenticated...`.

A chave `id_frontend.pub` é usada na Etapa 15.

### 13.5 Arquivo de configuração da aplicação

`[PC]` Gere os segredos de sessão (PowerShell, duas vezes — valores **diferentes**):
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```
> **Para que serve:** gera 64 caracteres hexadecimais aleatórios (256 bits) para `JWT_SECRET` e
> `JWT_REFRESH_SECRET`. O backend **recusa iniciar** com segredo fraco.

```bash
sudo install -o root -g s2vet -m 640 /dev/null /opt/s2vet/shared/backend.env
sudo nano /opt/s2vet/shared/backend.env
```
> **Para que serve:** cria o arquivo vazio com permissão `640` (o root escreve; o grupo `s2vet`
> só lê; os demais não veem) e abre no editor `nano`. Cole o conteúdo abaixo com os valores
> reais; salve com `Ctrl+O`, Enter, e saia com `Ctrl+X`.

```bash
NODE_ENV=production
PORT=3001
# 🔴 A API escuta SÓ no IP do túnel. Na placa pública a porta 3001 não existe.
HOST=10.50.0.2

# ── Banco: DOIS usuários (Parte D3) ──
DATABASE_URL="postgresql://zls2vetp1:<SENHA_ZLS2VETP1>@127.0.0.1:5432/dbs2vet?schema=schs2vet&connection_limit=10&options=-c search_path=schs2vet"
DATABASE_URL_MIGRATIONS="postgresql://nutriadmin:<SENHA_NUTRIADMIN>@127.0.0.1:5432/dbs2vet?schema=schs2vet&options=-c search_path=schs2vet"

# ── Sessão (Parte D2) ──
JWT_SECRET=<64 hex>
JWT_REFRESH_SECRET=<outros 64 hex, diferentes>
COOKIE_SECURE=true

# ── Endereço público (o mesmo em tudo: cookie, links de e-mail, CORS) ──
APP_URL=https://app.s2vet.com.br
ALLOWED_ORIGINS=https://app.s2vet.com.br
# Um proxy confiável na frente do Node: o Nginx do Frontend, que reescreve o
# X-Forwarded-For com o IP real do cliente (Etapa 15). Ver Parte D1.
TRUST_PROXY_HOPS=1

# ── Upload: abaixo do teto de 100 MB do Cloudflare ──
UPLOAD_MAX_BYTES=99614720
STORAGE_DRIVER=db

# ── E-mail (Brevo): chave NOVA, só de produção; remetente do domínio autenticado ──
EMAIL_PROVIDER=nodemailer
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=<login SMTP do Brevo>
EMAIL_PASS=<chave SMTP do Brevo>
EMAIL_FROM=noreply@s2vet.com.br
EMAIL_FROM_NAME=S2Vet

# ── Login com Google: o MESMO ID do VITE_GOOGLE_CLIENT_ID (frontend.env) ──
# 🔴 Sem ele o "Entrar com Google" é RECUSADO: é o que impede um token emitido para
#    OUTRO aplicativo de abrir sessão aqui (lib/googleToken.js). Ver Parte D2.
GOOGLE_CLIENT_ID=<client id de PRODUÇÃO>.apps.googleusercontent.com

# ── IA: chave de PRODUÇÃO, restrita ao IP 177.153.69.171 no Google Cloud ──
GEMINI_API_KEY=<chave>
GEMINI_MODEL=gemini-3.1-flash-lite

# ── WhatsApp (Etapa 14) ──
WHATSAPP_PROVIDER=evolution
EVOLUTION_URL=http://127.0.0.1:8080
EVOLUTION_API_KEY=<64 hex>
EVOLUTION_WEBHOOK_TOKEN=<64 hex, diferente>

# ── Diversos ──
LIBREOFFICE_BIN=soffice
PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer
LOG_LEVEL=info
# MFA_EMAIL_ENABLED=false   ← só como interruptor de emergência (SMTP fora do ar)
```

```bash
sudo install -o root -g s2vet -m 640 /dev/null /opt/s2vet/shared/frontend.env
echo 'VITE_GOOGLE_CLIENT_ID=<client id de PRODUÇÃO>.apps.googleusercontent.com' | sudo tee /opt/s2vet/shared/frontend.env
```
> **Para que serve:** a única configuração do build do frontend: o identificador do login com
> Google (é público por natureza — vai no JavaScript do navegador).
> ⚠️ É um **ID do cliente OAuth** (Google Cloud → Credenciais → *Aplicativo da Web*), não a
> chave do Gemini. Use um cliente **só de produção**, com a origem
> `https://app.s2vet.com.br` e nenhuma URI de redirecionamento; a *chave secreta do cliente*
> não é usada em lugar nenhum. A tela de consentimento precisa estar **"Em produção"** (em
> "Teste", só os testadores cadastrados entram). O **mesmo** ID vai no `GOOGLE_CLIENT_ID` do
> `backend.env` — diferente, todo login com Google é recusado.

### 13.6 O serviço da API (systemd)

O `systemd` é quem liga, vigia e religa a API. Se ela travar, volta em 5 segundos; se a
máquina reiniciar, ela sobe sozinha.

```bash
sudo tee /etc/systemd/system/s2vet-api.service >/dev/null <<'EOF'
[Unit]
Description=S2Vet API (Node)
# Sobe depois da rede, do banco e do túnel (a API escuta no IP do túnel).
After=network-online.target postgresql.service wg-quick@wg0.service
Wants=network-online.target wg-quick@wg0.service
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
# Religa sempre que cair (inclusive se subir antes de o túnel existir).
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536
# Endurecimento compatível com Chrome e LibreOffice.
# 🔴 Comentário SÓ em linha própria: o systemd não aceita "# ..." depois do valor — lê o
#    comentário como parte dele e IGNORA a linha inteira (o serviço sobe sem a proteção).
# Nada que ela rode ganha mais privilégio:
NoNewPrivileges=true
# /tmp próprio, invisível para os outros processos:
PrivateTmp=true
# /usr, /boot e /etc ficam somente leitura para ela:
ProtectSystem=full
# Não enxerga /home nem /root:
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
```
> **Para que serve:** define o serviço `s2vet-api`. Os comentários explicam as linhas.
> 🔴 **Uma instância só.** Os jobs (fechamento de fatura, lembretes) rodam **dentro** do
> processo da API: duas instâncias = fatura fechada duas vezes e lembrete duplicado para o
> cliente. Nunca use PM2 em modo *cluster*.

```bash
sudo systemctl daemon-reload && sudo systemctl enable s2vet-api
```
> **Para que serve:** faz o systemd ler o arquivo novo e marca o serviço para subir no boot.
> Ele **ainda não é iniciado**: sobe de verdade no primeiro deploy (Etapa 17).

```bash
sudo systemd-analyze verify /etc/systemd/system/s2vet-api.service
```
> **Para que serve:** ✅ confere o arquivo do serviço. Esperado: **nenhuma linha** com
> `Failed to parse` ou `ignoring`. Se aparecer, a linha citada está sendo ignorada — e o
> serviço sobe sem ela, sem erro nenhum no `status`.

```bash
sudo tee /etc/sudoers.d/s2vet >/dev/null <<'EOF'
s2vet ALL=(root) NOPASSWD: /usr/bin/systemctl restart s2vet-api, /usr/bin/systemctl status s2vet-api, /usr/local/sbin/s2vet-backup.sh
EOF
sudo chmod 440 /etc/sudoers.d/s2vet && sudo visudo -c
```
> **Para que serve:** permite ao usuário `s2vet` (o do deploy) executar **apenas três** comandos
> como administrador: reiniciar a API, ver o estado dela e rodar o backup. Nada além disso. O
> `visudo -c` confere a sintaxe — um erro em `sudoers` pode travar o `sudo` da máquina inteira.

---

## Etapa 14 — Evolution API (WhatsApp) `[BE]`

A Evolution não precisa de domínio nem de porta aberta: ela só **sai** para os servidores do
WhatsApp, e o S2Vet fala com ela em `127.0.0.1:8080`, dentro do Backend.

```bash
sudo apt -y install docker.io docker-compose-v2
```
> **Para que serve:** instala o Docker e o Docker Compose **do repositório do Ubuntu** (recebem
> atualização de segurança pela Etapa 8, sem precisar rodar script de terceiros).

```bash
sudo systemctl enable --now docker
```
> **Para que serve:** liga o Docker agora e em todo reinício.

```bash
sudo install -d -o root -g root -m 750 /opt/evolution
```
> **Para que serve:** cria a pasta da Evolution, acessível só pelo root.

`[PC]` Copiar o arquivo do repositório para o Backend:
```powershell
scp infra\evolution\docker-compose.yml vetprof@s2vet-be:/tmp/
```
> **Para que serve:** envia o arquivo de composição (o "projeto" com Evolution + Postgres +
> Redis próprios) para o servidor.

```bash
sudo mv /tmp/docker-compose.yml /opt/evolution/ && sudo grep -E '^name:|image:|127.0.0.1:8080' /opt/evolution/docker-compose.yml
```
> **Para que serve:** move para a pasta certa e confere três linhas que **não podem** estar
> diferentes (o arquivo já sai certo do repositório desde 2026-10-07):
> `name: evolution` (dá nome aos volumes que o backup procura), `image:
> evoapicloud/evolution-api:v2.3.7` (a versão testada no desenvolvimento — **nunca**
> `:latest`, que atualiza sozinha e pode quebrar o WhatsApp de todas as clínicas) e
> `"127.0.0.1:8080:8080"`. Ele também limita o tamanho dos logs de cada contêiner.
> Para atualizar a Evolution depois: testar a versão nova no desenvolvimento, trocar a
> etiqueta no repositório, copiar o arquivo de novo e rodar o `docker compose up -d` abaixo.

```bash
sudo install -o root -g root -m 600 /dev/null /opt/evolution/.env && sudo nano /opt/evolution/.env
```
> **Para que serve:** cria o arquivo de segredos da Evolution, legível só pelo root, e abre para
> editar. Conteúdo:
> ```bash
> EVOLUTION_API_KEY=<o MESMO valor do backend.env>
> EVOLUTION_DB_PASSWORD=<senha nova, só letras e números>
> EVOLUTION_PUBLIC_URL=http://127.0.0.1:8080
> ```

```bash
sudo docker compose -f /opt/evolution/docker-compose.yml up -d && sudo docker compose -f /opt/evolution/docker-compose.yml ps
```
> **Para que serve:** baixa as imagens e sobe os três contêineres em segundo plano (`-d`);
> `ps` mostra se estão `running`.
> ⚠️ Sempre com `-f /opt/evolution/docker-compose.yml`, nunca `cd /opt/evolution`: a pasta é
> só do root (guarda o `.env` com senhas) e o `cd` do `vetprof` dá `Permission denied` — o
> `sudo` vale para o comando, não para o `cd`. O `.env` é lido da pasta do arquivo, então o
> resultado é o mesmo. Vale para todo comando da Evolution (`ps`, `logs`, `down`…).

```bash
sudo ss -tlpn | grep 8080
```
> **Para que serve:** ✅ 🔴 tem de mostrar **`127.0.0.1:8080`**, NUNCA `0.0.0.0:8080`. O Docker
> escreve regras de firewall próprias que **passam por cima do UFW**: se a porta estiver em
> `0.0.0.0`, a API que controla o WhatsApp de todas as clínicas fica aberta na internet mesmo
> com o UFW dizendo "bloqueado".

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```
> **Para que serve:** ✅ pergunta à Evolution se está viva. Esperado: `200`.

```bash
sudo docker volume ls | grep evolution
```
> **Para que serve:** confere o nome do volume das sessões. O script de backup (Etapa 11)
> espera `evolution_evolution_instances`; se o nome for outro, ajuste no script.

---

## Etapa 15 — Frontend: Nginx `[FE]`

A VPS Frontend **não tem Node.js**: o build é feito no Backend e só o resultado (arquivos
estáticos) é copiado para cá. Menos software instalado = menos coisas para atacar.

### 15.1 Usuário que recebe o site

```bash
sudo adduser --disabled-password --gecos '' deploy
```
> **Para que serve:** cria o usuário `deploy`, **sem senha** (só entra com a chave do Backend).
> É ele que recebe os arquivos do site a cada deploy.

```bash
sudo install -d -o deploy -g www-data -m 755 /var/www/s2vet /var/www/s2vet/releases
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
```
> **Para que serve:** cria a pasta do site (o grupo `www-data` é o do Nginx, que precisa ler) e
> a pasta `.ssh` do `deploy`.

```bash
echo 'from="10.50.0.2",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding <CONTEUDO_DE_id_frontend.pub>' | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```
> **Para que serve:** autoriza a chave do deploy do Backend (o conteúdo de
> `/opt/s2vet/.ssh/id_frontend.pub`, que você vê no BE com `sudo cat`), com **restrições na
> própria chave**: `from="10.50.0.2"` — só vale chegando **pelo túnel** vindo do Backend;
> `no-pty` — não abre terminal interativo; `no-*-forwarding` — não abre túneis nem
> encaminhamentos. Mesmo que a chave vaze, ela não serve de outro lugar.

Lembre: na Etapa 5, o `AllowUsers` do Frontend deve ser `vetprof deploy`. Confira:
```bash
sudo sshd -T | grep -i allowusers
```
> **Para que serve:** ✅ esperado `allowusers vetprof` e `allowusers deploy` (ou os dois na mesma
> linha). Se faltar o `deploy`, edite `/etc/ssh/sshd_config.d/00-s2vet.conf` e rode
> `sudo sshd -t && sudo systemctl restart ssh`.

`[BE]` ✅ Teste a ligação:
```bash
sudo -u s2vet ssh 10.50.0.1 'echo ok'
```
> **Para que serve:** o Backend entra no Frontend como `deploy`, pelo túnel, e roda `echo ok`.
> Na primeira vez pergunta se confia na máquina: `yes` (precisa ser agora, porque o deploy
> roda sem ninguém para responder). Esperado: `ok`.

### 15.2 Nginx

O modelo da KingHost já trouxe o Nginx, escutando na porta 80 para todo mundo. Vamos
reconfigurá-lo para escutar **só em `127.0.0.1:8080`** — quem fala com ele é o `cloudflared`,
na própria máquina.

```bash
sudo apt -y install nginx
```
> **Para que serve:** garante que o Nginx está instalado e atualizado (se já estiver, só confirma).

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```
> **Para que serve:** desativa o site padrão (a página "Welcome to nginx" na porta 80). Depois
> disso a porta 80 deixa de existir na máquina.

```bash
sudo tee /etc/nginx/conf.d/00-s2vet-global.conf >/dev/null <<'EOF'
# Não revela a versão do Nginx nas respostas e páginas de erro.
server_tokens off;

# O cloudflared conecta em 127.0.0.1 e informa o IP real do visitante no cabeçalho
# CF-Connecting-IP. Só confiamos nesse cabeçalho quando ele vem do próprio túnel.
set_real_ip_from 127.0.0.1;
real_ip_header   CF-Connecting-IP;

# Limites de requisições por IP: API em geral e, mais apertado, login/senha.
limit_req_zone $binary_remote_addr zone=s2vet_api:10m  rate=30r/s;
limit_req_zone $binary_remote_addr zone=s2vet_auth:10m rate=30r/m;
limit_req_status 429;

# O Backend, pela rede privada (túnel WireGuard). Conexões reaproveitadas (keepalive).
upstream s2vet_api {
    server 10.50.0.2:3001;
    keepalive 16;
}
EOF
```
> **Para que serve:** configurações gerais do Nginx. Os comentários explicam cada uma.

```bash
sudo tee /etc/nginx/snippets/s2vet-headers.conf >/dev/null <<'EOF'
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.googleusercontent.com; media-src 'self' blob:; connect-src 'self' https://viacep.com.br https://brasilapi.com.br https://accounts.google.com https://www.googleapis.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; frame-src https://accounts.google.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
EOF
```
> **Para que serve:** cabeçalhos de segurança enviados ao navegador:
> `nosniff` (o navegador não "adivinha" tipo de arquivo) · `X-Frame-Options: DENY` (o site não
> pode ser embutido em outro — evita *clickjacking*) · `Referrer-Policy` (não vaza a URL
> completa para outros sites) · `Permissions-Policy` (câmera e microfone só para o próprio
> site; localização bloqueada) · **CSP** (lista de onde o site pode carregar scripts, estilos,
> imagens).
> ⚠️ A CSP começa em **Report-Only** (só avisa, não bloqueia): o login do Google, o ViaCEP e a
> transcrição de áudio precisam estar na lista. Depois de 2 semanas sem avisos no console do
> navegador, troque `Content-Security-Policy-Report-Only` por `Content-Security-Policy`.
> ⚠️ Armadilha do Nginx: um `add_header` dentro de um `location` **descarta** os herdados. Por
> isso estes cabeçalhos ficam num arquivo incluído em **cada** `location`.

```bash
sudo tee /etc/nginx/sites-available/s2vet.conf >/dev/null <<'EOF'
server {
    # Só o cloudflared (na mesma máquina) alcança. Nenhuma porta pública.
    listen 127.0.0.1:8080;
    server_name app.s2vet.com.br;

    root  /var/www/s2vet/current;
    index index.html;

    access_log /var/log/nginx/s2vet.access.log;
    error_log  /var/log/nginx/s2vet.error.log warn;

    # Pouco acima do limite da aplicação (95 MB), para ela devolver a mensagem amigável.
    client_max_body_size 100m;

    # ── Tela (arquivos estáticos do React) ──
    # O app usa HashRouter (/#/rota): toda navegação é "/". NÃO há regra de SPA.
    location = / {
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "no-cache" always;
        try_files /index.html =404;
    }
    location = /index.html {
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
    location /assets/ {                      # arquivos com hash do Vite: cache de 1 ano
        include snippets/s2vet-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }
    location / {
        include snippets/s2vet-headers.conf;
        try_files $uri =404;
    }
    location ~ /\. { deny all; }             # nunca servir arquivos ocultos (.env, .git)

    # ── API ──
    # X-Forwarded-For é SOBRESCRITO com o IP real (não acrescentado): o cliente não
    # consegue forjar o próprio IP, e o Node vê exatamente um salto (TRUST_PROXY_HOPS=1).

    # Tempo real (SSE): sem buffer e com conexão longa.
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

    # Webhook da Evolution: o token vai na URL — fica FORA do log de acesso.
    location = /api/webhooks/evolution {
        access_log off;
        proxy_pass http://s2vet_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-Id $request_id;
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

    # Mídia (vídeo com avanço): o pedido de "pedaço" (Range) passa direto.
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
        # IA e geração de PDF podem demorar. (O Cloudflare corta em 100 s de qualquer jeito.)
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
```
> **Para que serve:** o site do S2Vet. Os comentários explicam cada bloco. Em resumo: tudo que
> não começa com `/api` é arquivo da tela; `/api/*` vai para o Backend pelo túnel.
> ⚠️ `/health` **não** é publicado (não está sob `/api`): fica interno, no Backend.

```bash
sudo ln -s /etc/nginx/sites-available/s2vet.conf /etc/nginx/sites-enabled/
```
> **Para que serve:** ativa o site (o Nginx só carrega o que está em `sites-enabled`).

```bash
sudo install -d -o deploy -g www-data /var/www/s2vet/releases/inicial
echo '<!doctype html><title>S2Vet</title>Em implantação' | sudo -u deploy tee /var/www/s2vet/releases/inicial/index.html >/dev/null
sudo -u deploy ln -sfn /var/www/s2vet/releases/inicial /var/www/s2vet/current
```
> **Para que serve:** cria uma página provisória "Em implantação" e aponta o atalho `current`
> para ela. Cada deploy cria uma pasta nova em `releases/` e só troca esse atalho — por isso a
> troca de versão é instantânea e o retorno à anterior também.

```bash
sudo nginx -t && sudo systemctl reload nginx
```
> **Para que serve:** `nginx -t` testa a configuração; só se estiver correta, `reload` aplica
> sem derrubar conexões.

✅ Conferências:
```bash
sudo ss -tlpn | grep nginx
```
> **Para que serve:** o Nginx deve aparecer **só** em `127.0.0.1:8080`. Nada na 80.

```bash
curl -s -H 'Host: app.s2vet.com.br' http://127.0.0.1:8080/
```
> **Para que serve:** pede a página ao Nginx. Esperado: o HTML "Em implantação".

---

## Etapa 16 — Cloudflare Tunnel `[FE]`

Pré-requisito: o domínio `s2vet.com.br` no Cloudflare (Parte B, P3/P4).

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
```
> **Para que serve:** baixa a chave de assinatura do Cloudflare. Ela prova ao `apt` que o
> pacote veio mesmo do Cloudflare e não foi adulterado.

```bash
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt -y install cloudflared
```
> **Para que serve:** cadastra o repositório oficial e instala o `cloudflared` (recebe
> atualizações junto com o resto do sistema).

`[WEB]` **Painel principal** (`dash.cloudflare.com`) → **Networking → Tunnels** (ou digite
"Tunnels" na busca do topo) → **Create a tunnel** → *Cloudflared* → nome `s2vet-fe` → o painel
mostra um comando com um **token**. Copie só o token.
> 💡 **Não precisa do Zero Trust** (2026-10-08). O mesmo túnel existe dentro de *Zero Trust →
> Networks → Tunnels*, mas a primeira entrada ali cria uma "organização" e pede cartão de
> crédito, mesmo no plano Free. O túnel é gratuito e funciona inteiro pelo painel principal.
> O túnel tem de ficar na **mesma conta** do domínio `s2vet.com.br`.

```bash
sudo cloudflared service install <TOKEN>
```
> **Para que serve:** instala o `cloudflared` como serviço do sistema, ligado à sua conta pelo
> token. Ele abre uma conexão de **saída** para o Cloudflare e mantém aberta — é por ela que os
> visitantes chegam. Nenhuma porta de entrada é necessária.

```bash
sudo systemctl status cloudflared --no-pager
```
> **Para que serve:** ✅ deve estar `active (running)`. No painel, o túnel aparece `HEALTHY`.
> O `cloudflared` atual guarda o token em `/etc/cloudflared/token` (só o root lê) e o serviço o
> lê com `--token-file` — ele **não** aparece na linha de comando do processo.

`[WEB]` No túnel, aba **Published application routes** (antes "Public Hostname") → **Add**:

| Campo | Valor |
|---|---|
| Subdomain | `app` |
| Domain | `s2vet.com.br` |
| Path | **vazio** (o `^/blog` é só exemplo) |
| Service URL | **`http://127.0.0.1:8080`** |
| Additional application settings | todos nos padrões; **Access desligado** |

⚠️ O `https://localhost:8080` que aparece no campo é **exemplo** — escreva por cima.
**`http`**, não `https`: o Nginx fala só HTTP na conversa interna da máquina (o trecho
visitante → Cloudflare é HTTPS e o túnel é cifrado); com `https` o site dá **502**.
**`127.0.0.1`**, não `localhost`: no Ubuntu `localhost` pode virar `::1` (IPv6), onde o Nginx
não escuta.

O Cloudflare cria sozinho o registro DNS `app`. ✅ `Resolve-DnsName app.s2vet.com.br -Server
1.1.1.1` mostra só IPs do Cloudflare (`104.x`/`172.6x.x`/`2606:4700:…`) e `https://app.s2vet.com.br`
abre "Em implantação".
⚠️ Os registros `A`/`AAAA`/`CNAME www` que o Cloudflare importou da Hostinger apontam para a
página de domínio estacionado — apague-os se não houver site ali.

🔴 **Não crie registro DNS do tipo A apontando para `177.153.69.147` nem para
`177.153.69.171`.** Os IPs das VPS não devem aparecer no DNS: o acesso é só pelo túnel.

---

## Etapa 17 — Primeiro deploy `[BE]`

🔴 Pré-requisitos: backup funcionando (Etapa 11), dados carregados (12), Frontend pronto (15–16).

### 17.1 O script de deploy

```bash
sudo -u s2vet tee /opt/s2vet/bin/deploy.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Publica uma versão do S2Vet. Uso:  sudo -u s2vet /opt/s2vet/bin/deploy.sh <branch-ou-tag>
set -euo pipefail                                     # para no primeiro erro
REF="${1:?informe a branch ou tag}"
REPO="git@github.com:marcoaraujoc/nutricao-equina-super.git"
TS=$(date +%Y%m%dT%H%M%S)
REL=/opt/s2vet/releases/$TS
HEALTH=http://10.50.0.2:3001/health                   # a API escuta só no IP do túnel
export PUPPETEER_CACHE_DIR=/opt/s2vet/.cache/puppeteer

echo "▶ 1/9 código ($REF)"
git clone --depth 1 --branch "$REF" "$REPO" "$REL"
ln -s /opt/s2vet/shared/backend.env  "$REL/backend/.env"
cp    /opt/s2vet/shared/frontend.env "$REL/frontend/.env.production"

echo "▶ 2/9 dependências do backend"
cd "$REL/backend"
npm ci --no-audit --no-fund   # 🔴 NÃO usar --omit=dev: @prisma/client está em devDependencies
# O relatório do `npm ci` soma as ferramentas de TESTE e BUILD (jest, tailwind), que não
# rodam na API e fazem o número parecer pior do que é. O que vai para produção é este:
echo "   vulnerabilidades em produção (backend): $(npm audit --omit=dev 2>/dev/null | grep -E 'vulnerabilit' | tail -1)"
npx prisma generate

echo "▶ 3/9 build do backend (tsc + cópia das imagens dos laudos)"
npm run build

echo "▶ 4/9 backup antes de migrar"
sudo -n /usr/local/sbin/s2vet-backup.sh || { echo "🔴 backup falhou — abortando"; exit 1; }

echo "▶ 5/9 migrations (usuário DONO)"
# 🔴 Entre parênteses (subshell): o `set -a` EXPORTA tudo do backend.env. Fora do
#    subshell, o NODE_ENV=production faria o `npm ci` do frontend pular as devDependencies
#    (tsc/vite → "tsc: not found") e as senhas do banco vazariam para o build da tela.
( set -a; . /opt/s2vet/shared/backend.env; set +a
  DATABASE_URL="$DATABASE_URL_MIGRATIONS" npx prisma migrate deploy )
# Só quando a versão alterou o catálogo de permissões ou os modelos CFMV:
# ( set -a; . /opt/s2vet/shared/backend.env; set +a; DATABASE_URL="$DATABASE_URL_MIGRATIONS" node seed.js )

echo "▶ 6/9 build do frontend"
cd "$REL/frontend"
npm ci --include=dev --no-audit --no-fund   # tsc e vite são devDependencies — sem elas não há build
echo "   vulnerabilidades em produção (frontend): $(npm audit --omit=dev 2>/dev/null | grep -E 'vulnerabilit' | tail -1)"
npm run build

echo "▶ 7/9 publica a tela no Frontend (pelo túnel)"
rsync -a --delete dist/ "10.50.0.1:/var/www/s2vet/releases/$TS/"
ssh 10.50.0.1 "ln -sfn /var/www/s2vet/releases/$TS /var/www/s2vet/current"

echo "▶ 8/9 troca a versão do backend e reinicia"
ln -sfn "$REL" /opt/s2vet/current
sudo -n /usr/bin/systemctl restart s2vet-api
# Espera a API subir (até 60 s). Sem mensagem a cada tentativa: a primeira SEMPRE falha,
# porque a API ainda está iniciando — quem acusa de verdade é a linha seguinte.
for i in $(seq 1 30); do curl -fsS "$HEALTH" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$HEALTH" >/dev/null || { echo "🔴 /health não respondeu — faça o rollback (Parte E)"; exit 1; }

echo "▶ 9/9 limpeza (mantém as 5 últimas versões)"
ls -1dt /opt/s2vet/releases/*/ | tail -n +6 | xargs -r rm -rf
ssh 10.50.0.1 'ls -1dt /var/www/s2vet/releases/*/ | tail -n +6 | xargs -r rm -rf'
echo "✅ deploy $TS concluído"
EOF
sudo chmod 750 /opt/s2vet/bin/deploy.sh
```
> **Para que serve:** grava o script que publica uma versão, em 9 passos (escritos nele). O
> mais importante: **faz backup antes de alterar o banco** e **só troca a versão se a nova
> responder ao `/health`**. A versão anterior continua na pasta `releases/` para retorno
> imediato.
> ⚠️ `npm run build` do backend **não é só compilar**: copia as imagens dos laudos (anatomia,
> casco, odontologia). Pular isso derruba a geração desses laudos — e só na hora de emitir um.

### 17.2 Rodar

```bash
sudo -u s2vet /opt/s2vet/bin/deploy.sh feature/mvp-v1.0
```
> **Para que serve:** publica a branch `feature/mvp-v1.0` (troque por uma *tag* de versão
> quando houver). A primeira vez demora mais: baixa todas as dependências e o Chrome.

### 17.3 Conferir

```bash
curl -s http://10.50.0.2:3001/health | jq .
```
> **Para que serve:** ✅ esperado `"status": "ok"` e `"database": {"status": "ok"}`.

```bash
sudo ss -tlpn | grep -E ':(3001|5432|8080)\b'
```
> **Para que serve:** ✅ 🔴 a 3001 em **`10.50.0.2`**; a 5432 e a 8080 em **`127.0.0.1`**.
> Nenhuma em `0.0.0.0`. Esta é a prova de que nada da aplicação existe na placa pública.

```bash
sudo -u s2vet bash -c 'export HOME=/opt/s2vet/home; cd /opt/s2vet/current/backend && npm run doc:check'
```
> **Para que serve:** ✅ testa a conversão de `.doc` (LibreOffice). Esperado `✓ CONVERSÃO OK`.
> ⚠️ O `export HOME` é obrigatório: o `sudo -u s2vet` herda o HOME do `vetprof`, que o `s2vet` não
> acessa, e o `soffice` falha ao voltar para ele. O serviço da API já sobe com esse HOME.
> ⚠️ Antes de 2026-10-08 o teste usava uma amostra `.doc` artificial que o LibreOffice do Linux
> recusa, e acusava falha num servidor que converte normalmente. Agora a amostra é gerada pelo
> próprio LibreOffice. Para testar com um laudo seu: `npm run doc:check -- /caminho/laudo.doc`.

```bash
sudo -u s2vet bash -c 'cd /opt/s2vet/current/backend && npm run email:testar -- marcoaraujoc@gmail.com'
```
> **Para que serve:** ✅ envia um e-mail de teste pelo Brevo. Confira que chegou na caixa de
> entrada (não no spam). Sem e-mail não há código de 2FA nem recuperação de senha.

```bash
sudo journalctl -u s2vet-api -n 50 --no-pager
```
> **Para que serve:** mostra as últimas linhas do log da API. Procure `Servidor iniciado` com
> `host: 10.50.0.2` e nenhum `[AVISO]` sobre segredos.

`[FE]` A ligação inteira, Frontend → túnel → Backend → banco:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.s2vet.com.br' http://127.0.0.1:8080/api/marca
```
> **Para que serve:** ✅ esperado `200`.

`[PC]` ✅ **Abra `https://app.s2vet.com.br` e faça login.**

---

## Etapa 18 — Cloudflare: WAF, TLS e regras `[WEB]`

**SSL/TLS → Edge Certificates**
- **Always Use HTTPS**: On · **Minimum TLS Version**: 1.2 · **TLS 1.3**: On ·
  **Automatic HTTPS Rewrites**: On.
- **HSTS**: ligue **só depois** do go-live validado — `max-age` 6 meses,
  `includeSubDomains` On, `preload` **Off** (preload é difícil de desfazer).

**Caching → Cache Rules** → nova regra "API nunca em cache": `URI Path` *starts with* `/api/`
→ **Bypass cache**. 🔴 Resposta de API é por usuário e por clínica: cachear vazaria dado
de uma clínica para outra.

**Security → WAF → Custom rules**, nesta ordem:

| # | Nome | Expressão | Ação |
|---|---|---|---|
| 1 | Webhook Evolution | `http.request.uri.path eq "/api/webhooks/evolution" and ip.src eq 177.153.69.171` | **Skip** (regras restantes, gerenciadas e rate limit) |
| 2 | Webhook de fora | `http.request.uri.path eq "/api/webhooks/evolution" and ip.src ne 177.153.69.171` | **Block** |
| 3 | Varredura | `http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "wp-" or http.request.uri.path contains "phpmyadmin" or http.request.uri.path contains "/cgi-bin" or ends_with(http.request.uri.path, ".php")` | **Block** |
| 4 | Métodos | `not http.request.method in {"GET" "POST" "PUT" "PATCH" "DELETE" "OPTIONS" "HEAD"}` | **Block** |
| 5 | Fora do Brasil | `ip.src.country ne "BR" and not http.request.uri.path eq "/api/webhooks/evolution" and not cf.client.bot` | **Managed Challenge** |

> As regras 1 e 2 existem porque o webhook da Evolution **sai** do Backend pela internet
> (`177.153.69.171`), passa pelo Cloudflare e volta pelo túnel. Só ele pode chamar essa rota.
> A regra 5 é decisão de produto: protege um SaaS brasileiro, e o veterinário viajando só
> precisa resolver um desafio. Recomendação: ligar.
> O `not cf.client.bot` deixa passar os **robôs verificados pelo Cloudflare** — entre eles os
> monitores de disponibilidade (UptimeRobot/Better Stack, Parte E3), que acessam de fora do
> Brasil e não resolvem desafio: sem a exceção, o monitor acusaria "site fora do ar" o tempo
> todo. A marca é atribuída pelo Cloudflare e não pode ser forjada (o `User-Agent` pode).

**Security → WAF → Rate limiting rules**
- Plano Free (1 regra): `URI Path` *starts with* `/api/auth/` → 10 requisições em 10 s por IP
  → Block por 10 s.
- Plano Pro: `/api/auth/` → 20/min por IP → Block 10 min; e `/api/` → 600/min → Managed Challenge.

**Bots**: no plano Free, **deixe o *Bot Fight Mode* DESLIGADO** — ele não aceita exceção e
bloquearia o webhook da Evolution em silêncio. No Pro: *Super Bot Fight Mode* com a regra 1
pulando o webhook.

**Managed rules**: Free → *Cloudflare Free Managed Ruleset* (já vem ligado). Pro → ligue o
*Cloudflare Managed Ruleset* e o *OWASP Core Ruleset* em modo **Log** por 1 semana, revise
*Security → Events* (formulários longos de evolução e upload de laudo são candidatos a falso
positivo), crie exceções e só então mude para **Block**.

**Notifications**: alertas de DDoS, de túnel caído (*Tunnel health*) e de pico de erros 5xx
para o seu e-mail.

**Google Cloud** `[WEB]`: na chave do Gemini, **Application restrictions → IP addresses →
`177.153.69.171`**. Com isso a chave, se vazar, não funciona de nenhum outro lugar.

---

## Etapa 19 — Testes de aceite

### 19.1 Segurança (de FORA, do seu PC)

| # | Teste | Comando `[PC]` | Esperado |
|---|---|---|---|
| S1 | Backend fechado | `Test-NetConnection 177.153.69.171 -Port 22` (repita com 80, 443, 3001, 5432, 8080) | `TcpTestSucceeded : False` em **todas** |
| S2 | Frontend fechado | `Test-NetConnection 177.153.69.147 -Port 22` (repita com 80, 443, 8080) | `False` em todas |
| S3 | SSH pelo Tailscale | `ssh vetprof@s2vet-be` e `ssh vetprof@s2vet-fe`, de casa **e** pelo 4G do celular (app Tailscale + Termius) | entra nos dois casos |
| S4 | WAF | `curl.exe -s -o NUL -w "%{http_code}" https://app.s2vet.com.br/.env` | `403` |
| S5 | Webhook de fora | `curl.exe -s -o NUL -w "%{http_code}" -X POST https://app.s2vet.com.br/api/webhooks/evolution` | `403` |
| S6 | TLS | `https://www.ssllabs.com/ssltest/` com `app.s2vet.com.br` | nota **A** ou **A+** |
| S7 | Cabeçalhos | `https://securityheaders.com/` | **A** (a CSP em Report-Only pode baixar até ser ativada) |
| S8 | Cookie | DevTools → Application → Cookies | `s2vet_at`/`s2vet_rt` com **Secure**, **HttpOnly**, `SameSite=Lax` |
| S9 | Força bruta | 15 senhas erradas seguidas | bloqueio da conta e/ou `429` |
| S10 | Isolamento | usuário da clínica A tenta abrir paciente da clínica B pela URL | negado |
| S11 | Origem oculta | `curl.exe -sI https://app.s2vet.com.br` | `server: cloudflare`; nenhuma versão de Nginx/Express |

> ⚠️ **Com o Super Bot Fight Mode ligado (plano Pro), o `curl.exe` recebe `403` em QUALQUER
> endereço** — inclusive `/api/marca`, que no navegador abre normalmente: o Cloudflare o classifica
> como *Definitely automated*. Por isso, em S4, S5 e S11 o `403` sozinho não prova qual regra
> agiu: confira em **Security → Events** se `/.env` caiu na custom rule *Varredura* e o webhook
> em *Webhook de fora* (cair no Super Bot Fight Mode também bloqueia, só que por outra camada).
> O que vale para o usuário é o **navegador**.

> `Test-NetConnection` é do PowerShell (já vem no Windows). `curl.exe` (com `.exe`) chama o
> `curl` de verdade, que também vem no Windows 10/11 — sem o `.exe`, o PowerShell usa um
> apelido diferente.

### 19.2 Funcionais

| # | Teste | Esperado |
|---|---|---|
| F1 | `curl -s http://10.50.0.2:3001/health` no BE | `200`, banco `ok` |
| F2 | Login e-mail/senha (+2FA, se ligado) | entra; o código chega por e-mail |
| F3 | Login Google | entra |
| F4 | Foto de paciente | carrega (prova que `/api/midia` está na mesma origem e autorizado) |
| F5 | Upload de laudo de 90 MB | salva; 98 MB → mensagem amigável da aplicação |
| F6 | Vídeo de prontuário | toca e permite avançar |
| F7 | PDF de prescrição por e-mail e WhatsApp | chega com o anexo |
| F8 | IP real | `/auditoria-geral` mostra o IP do seu provedor — **não** `10.50.0.1` nem `127.0.0.1` |
| F9 | Tempo real | dois navegadores na mesma evolução: o segundo recebe o aviso de edição concorrente |
| F10 | Cron | `/monitoracao` mostra execuções (não use jobs que mandam mensagem como teste) |
| F11 | `.doc` | laudo `.doc` pré-visualiza |
| F12 | Backup | restauração de teste do primeiro backup funciona ([Parte E](#e2-restaurar-um-backup-teste-mensal)) |
| F13 | Celular | fluxo completo no 4G |

### 19.3 Go / no-go

**Go** somente com: S1–S11 e F1–F13 OK · backup restaurado com sucesso · monitores ativos e
testados (derrube a API de propósito e confira que o alerta chega) · todos os segredos novos e
guardados · limpeza de dados de teste conferida · Lynis rodado de novo e sem alerta grave novo.

---

# Parte D — Referência

## D1. Por que tudo numa origem só (same-origin)

O navegador enxerga **um endereço só**: `https://app.s2vet.com.br`. O Nginx entrega a tela **e**
repassa `/api/*`. O Backend **não tem domínio próprio**. Não é preferência de estilo — três
coisas do código dependem disso:

1. **Não há proteção CSRF dedicada.** A defesa **é** o `SameSite=Lax` do cookie de sessão
   (`lib/authCookies.js`). Front e back em domínios diferentes obrigariam a `SameSite=None`,
   que manda o cookie em requisição disparada por qualquer site.
2. **As URLs de mídia são gravadas RELATIVAS no banco** (`/api/midia/<chave>`). Servidas de
   outro host, todo `<img src>` resolveria contra o host da tela e daria 404.
3. **Todo request leva `x-empresa-id` / `x-equipe-id`.** Cabeçalho customizado entre origens
   diferentes vira duas viagens por chamada (preflight + real).

**O front NÃO precisa de regra de SPA:** `App.tsx` usa `HashRouter` (rotas em `/#/caminho`),
então toda navegação pede `/`. ⚠️ Consequência: **todo link de e-mail precisa do `/#/`**
(`${APP_URL}/#/reset-password?token=...`). Já é assim no código — não "corrigir".

**Por que `TRUST_PROXY_HOPS=1`:**
```
navegador ─► Cloudflare ─► cloudflared(127.0.0.1) ─► Nginx (FE) ─► túnel ─► Node (BE)
                                                       │
     o Nginx troca o IP pelo CF-Connecting-IP (só vindo de 127.0.0.1) e manda
     X-Forwarded-For: <IP do cliente>  — SOBRESCRITO, com um valor só
```
O Node vê a conexão vinda de `10.50.0.1` e um `X-Forwarded-For` com **um** IP: um salto
confiável. Errar para menos faz `req.ip` virar o IP do Nginx (rate limit vira um balde só e a
auditoria grava o IP errado em todo login); errar para mais deixa o cliente forjar o próprio
IP. ⚠️ Nunca `true`. ✅ Teste F8.

## D2. Variáveis de ambiente que mudam em produção

Todas documentadas em `backend/.env.example`. As que importam aqui:

| Variável | Produção | Consequência de errar |
|---|---|---|
| `HOST` | `10.50.0.2` | Sem ela a API escuta em todas as placas, inclusive a pública — só o firewall a protegeria |
| `DATABASE_URL` | usuário da APLICAÇÃO (`zls2vetp1`) | Ver D3 — é o que impede a app de desligar o próprio RLS |
| `DATABASE_URL_MIGRATIONS` | usuário DONO (`nutriadmin`) | Sem ela, `migrate deploy` falha com `P3018 / 42501 must be owner` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | dois valores próprios e diferentes | Ver abaixo |
| `APP_URL` | `https://app.s2vet.com.br` | Links de e-mail (senha, convite, vínculo) apontariam para localhost |
| `ALLOWED_ORIGINS` | `https://app.s2vet.com.br` | O padrão é `http://localhost:5173` |
| `COOKIE_SECURE` | `true` | Cookie de sessão viajaria sem a marca `Secure` |
| `TRUST_PROXY_HOPS` | `1` | Ver D1 |
| `UPLOAD_MAX_BYTES` | `99614720` (95 MB) | O Cloudflare corta acima de 100 MB com erro próprio, sem a mensagem da aplicação |
| `STORAGE_DRIVER` | `db` | Ver D6 |
| `MFA_EMAIL_ENABLED` | ausente | Interruptor de emergência do 2FA; o seletor global do ADMIN é que decide |
| `GOOGLE_CLIENT_ID` | o ID de produção (igual ao `VITE_GOOGLE_CLIENT_ID`) | Ausente: login com Google recusado (o boot avisa). Diferente do frontend: idem. É ele que impede um token emitido para **outro** app de abrir sessão aqui |

**Segredos de sessão.** O `JWT_SECRET` é a chave que assina os tokens (`lib/sessionTokens.js`).
Quem o descobre **fabrica** um token com qualquer usuário — entra como ADMIN de qualquer
empresa, sem senha e **sem passar pelo 2FA**. O ataque é **offline** (basta capturar um token e
testar chaves no próprio computador), onde rate limit não alcança. O backend recusa iniciar
com segredo fraco (`segredoFraco()` em `server.ts`). ⚠️ Sem `JWT_REFRESH_SECRET`, ele é
**derivado** do `JWT_SECRET` e os dois deixam de ser independentes — o boot avisa.
⚠️ **Trocar os segredos desloga todo mundo.** Indolor antes de abrir para clientes.

Auditar um segredo configurado sem imprimi-lo (no BE):
```bash
sudo -u s2vet bash -c 'cd /opt/s2vet/current/backend && node -e "require(\"dotenv\").config();const v=process.env.JWT_SECRET||\"\";console.log(\"tam:\",v.length,\"| distintos:\",new Set(v).size)"'
```
> **Para que serve:** mostra o tamanho e a variedade de caracteres do segredo, sem exibi-lo.
> Esperado: tamanho 64, distintos 16.

## D3. Banco: dois usuários, e por quê

A aplicação conecta com um usuário **sem privilégio de dono**. É isso que garante que ela **não
consegue desligar o Row-Level Security** que a limita à clínica do usuário logado. As
migrations conectam com o dono, que tem `CREATE`/`ALTER`.

Testado (`docs/MULTI-TENANCY-PLANO.md`): com a app conectada como o usuário restrito, um
`UPDATE` em massa sem `WHERE` atinge **só** as linhas da empresa do contexto, e a role não
consegue `DISABLE ROW LEVEL SECURITY` nem `TRUNCATE`.

⚠️ **Tabela nova nasce SEM policy.** Com o RLS *fail-closed*, tabela sob tenancy sem policy
devolve **zero linha, sem erro**. O gate é `src/__tests__/tenancyRls.test.js`.
⚠️ **Policy órfã afrouxa o isolamento em silêncio:** o PostgreSQL combina policies permissivas
com `OU`. Confira `pg_policies` por tabela — mais de uma é suspeita.
⚠️ São **224 migrations** no repositório nesta data. Banco **existente**: rode
`npx prisma migrate status` **antes** do deploy.

## D4. Tamanho das VPS e o que cresce

Ver [A7](#a7-dimensionamento--precisa-ajustar-alguma-vps). Uso do banco por tabela (os anexos
dominam) — no BE, `sudo -u postgres psql -d dbs2vet`:
```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class
WHERE relnamespace = 'schs2vet'::regnamespace AND relkind = 'r'
ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;
```
> **Para que serve:** lista as 10 tabelas que mais ocupam disco.

## D5. Limites do Cloudflare que afetam a aplicação

| Limite (Free/Pro) | Consequência | Tratamento |
|---|---|---|
| Corpo da requisição: **100 MB** | upload maior recebe erro 413 do Cloudflare | `UPLOAD_MAX_BYTES` = 95 MB |
| Resposta da origem: **100 s** | erro **524** | A IA tem timeout de 60 s; monitore 524 em *Analytics* |

## D6. Crescimento do disco — o caminho já previsto

Os arquivos moram no PostgreSQL (`bytea`, CLAUDE.md §8): o dump do backup cresce junto. Quando
incomodar, o caminho **já está na arquitetura** e não toca controller nenhum:
1. Implementar `S3StorageProvider` respeitando `StorageProvider` (`upload`/`delete`/`getUrl`).
2. Registrar no `switch` de `src/storage/index.ts` (o `case 's3'` já está lá, comentado).
3. `STORAGE_DRIVER=s3`.

⚠️ **Jamais devolver URL pública/assinada do bucket ao cliente.** O download continua saindo por
`/api/midia/:chave`, que faz o proxy — o bucket fica PRIVADO.

## D7. LibreOffice (conversão `.doc`)

Só no Backend. **Ausente, não quebra nada**: o `.doc` é guardado como veio e só não ganha
pré-visualização (nem é lido pela IA). ⚠️ `fonts-liberation` não é opcional: sem fonte, o
LibreOffice converte com medidas erradas e o texto sai embaralhado. Diagnóstico:
`npm run doc:check` (sai 0/1).

## D8. Privacidade e LGPD (não é infraestrutura, mas bloqueia o lançamento)

O que esta infraestrutura já garante:
- Dados de paciente e tutor **nunca** trafegam em claro: HTTPS até o Cloudflare, túnel
  cifrado do Cloudflare ao Frontend, WireGuard do Frontend ao Backend.
- Banco inacessível de fora da máquina; isolamento por clínica no próprio banco (RLS).
- Backups cifrados com chave que **não está** no servidor nem na KingHost.
- IPs das VPS fora do DNS; versões de software escondidas.
- Token do webhook fora dos logs; logs do Nginx guardados por 14 dias.

O que falta e é obrigação do negócio:
- **Papéis:** a clínica é **controladora** dos dados dos tutores; a S2Vet é **operadora**.
  Contrato com cada clínica com cláusulas de tratamento de dados.
- **Política de Privacidade** e **Termos de Uso** publicados (exigidos também pelo Google OAuth).
- **Encarregado (DPO)** indicado, com canal de contato.
- **Suboperadores** a declarar: **KingHost** (hospedagem), Cloudflare (borda), Brevo (e-mail),
  Google (IA e login), provedor do backup, Tailscale (só administração — não vê dados da
  aplicação).
- **Retenção:** registros de acesso à aplicação por no mínimo **6 meses** (Marco Civil da
  Internet, art. 15) — ficam na auditoria do banco; prontuário conforme o CFMV.
- **Plano de resposta a incidente**, com comunicação à ANPD e aos titulares.
- ⚠️ O disco das VPS **não é cifrado** pela KingHost. Os backups são. Registre isso na avaliação
  de risco.

## D9. Pendências conhecidas antes de abrir para clientes

- [ ] Respostas do suporte da KingHost (B3) — principalmente o console de emergência.
- [ ] Domínio e Cloudflare (P3/P4) — bloqueia a Etapa 16 em diante.
- [ ] Script de limpeza dos dados de teste, escrito e testado num ensaio local (Etapa 12).
- [ ] Fixar a versão da imagem da Evolution (hoje `:latest` no repositório).
- [ ] Decidir o 2FA por e-mail: entregue **desativado** no seletor global do ADMIN.
- [ ] Rever `RATE_LIMIT_MAX` (300/min por usuário) com uso real de clínica.
- [ ] CSP: passar de Report-Only para valendo, depois de 2 semanas sem avisos.
- [ ] HSTS no Cloudflare, depois do go-live validado.
- [ ] Fase 2 de segurança: filtro de **saída** no Backend (liberar só os destinos conhecidos),
      `auditd`, e backup contínuo (pgBackRest + WAL) para perda máxima de minutos em vez de 24 h.

---

# Parte E — Operação

## E1. Deploy de rotina e retorno à versão anterior

**Publicar:** `[BE]` `sudo -u s2vet /opt/s2vet/bin/deploy.sh <tag>` — de preferência na janela
de manutenção (E5).

**Voltar à versão anterior:**
```bash
ls -1dt /opt/s2vet/releases/*/
```
> **Para que serve:** lista as versões publicadas, da mais nova para a mais antiga.

```bash
sudo -u s2vet ln -sfn /opt/s2vet/releases/<ANTERIOR> /opt/s2vet/current && sudo systemctl restart s2vet-api
```
> **Para que serve:** aponta o atalho `current` para a versão anterior e reinicia a API.

```bash
sudo -u s2vet ssh 10.50.0.1 'ln -sfn /var/www/s2vet/releases/<ANTERIOR> /var/www/s2vet/current'
```
> **Para que serve:** faz o mesmo com a tela, no Frontend.

🔴 **Migrations não têm "desfazer".** Se a versão nova alterou o banco de um jeito que a anterior
não entende, voltar o código não basta: é preciso **restaurar o backup feito no passo 4 do
deploy**. Por isso as migrations são sempre **aditivas** (coluna nova opcional, tabela nova).

## E2. Restaurar um backup (teste mensal)

`[PC]` Baixe um backup do bucket (painel do B2/R2) e, na pasta do `age`:
```powershell
.\age.exe -d -i s2vet-backup.key -o db.dump db_AAAAMMDD_HHMM.dump.age
```
> **Para que serve:** decifra o backup com a sua chave privada.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -l db.dump | Select-Object -First 20
```
> **Para que serve:** lista o conteúdo do dump — prova que ele está legível. Depois, restaure num
> PostgreSQL de teste (`createdb teste` e `pg_restore -d teste db.dump`, os dois na pasta
> `C:\Program Files\PostgreSQL\18\bin`) e abra a aplicação
> apontando para ele. Apague o `db.dump` ao terminar: ele contém dados pessoais.

## E3. Monitoração

| O quê | Ferramenta | Alerta |
|---|---|---|
| Site no ar | UptimeRobot/Better Stack → `https://app.s2vet.com.br/` a cada 1 min | e-mail + celular |
| Cadeia inteira (FE → túnel → BE → banco) | monitor HTTP em `https://app.s2vet.com.br/api/marca` → espera 200 | idem |
| Backup rodou | *heartbeat* (Better Stack/Healthchecks.io), o `HEARTBEAT_URL` da Etapa 11 | sem sinal em 26 h |
| Jobs da aplicação | tela **Monitoração** + alerta de cron do próprio S2Vet | e-mail ao ADMIN |
| Disco | script abaixo | > 80% |
| Túnel e DDoS | *Notifications* do Cloudflare | e-mail |

Alerta de disco `[AMBAS]`:
```bash
echo '0 * * * * root [ "$(df --output=pcent / | tail -1 | tr -dc 0-9)" -gt 80 ] && curl -fsS "<URL_ALERTA_DISCO>" >/dev/null' | sudo tee /etc/cron.d/s2vet-disco
```
> **Para que serve:** a cada hora confere o uso do disco; acima de 80%, chama a URL de alerta do
> seu monitor (que manda e-mail/celular).

## E4. "Caiu" — o que olhar, em ordem

1. Cloudflare *Analytics*: há tráfego? Erros 5xx ou 524? Túnel saudável?
2. `[FE]` `systemctl status cloudflared nginx` · `sudo wg show` (*handshake* recente?)
3. `[BE]` `systemctl status s2vet-api postgresql wg-quick@wg0` · `journalctl -u s2vet-api -n 200`
4. `[BE]` `df -h` (disco cheio é a causa mais comum, com anexos no banco) · `free -h`
5. `[BE]` `curl http://10.50.0.2:3001/health`
6. Recuperar: voltar versão (E1) → restaurar backup (E2) → VPS nova a partir deste documento.

## E5. Janelas de manutenção

- Deploy e reinício: **fora de 23:15–00:30** (fechamento de fatura, fim da janela de doses e
  lembretes rodam aí) e fora do horário de atendimento. Sugestão: **domingo 06:00**.
- 🔴 O `node-cron` **não recupera disparo perdido**: um reinício às 23:45 faz o fechamento de
  fatura daquele dia não acontecer.
- Reinício após atualização de kernel: `cat /var/run/reboot-required` diz se precisa.
- **PostgreSQL — uma vez por mês** `[BE]` (fica fora das atualizações automáticas, ver 10.2):
  `apt list --upgradable 2>/dev/null | grep postgresql` mostra se há versão nova (ex.:
  18.6 → 18.7). Havendo, **depois do backup do dia**: `sudo apt -y install --only-upgrade
  'postgresql-18*' libpq5 postgresql-common postgresql-client-common` — o banco reinicia
  sozinho em poucos segundos e a API reconecta. Confira com `pg_lsclusters` (`online`).
  Atualize também o PostgreSQL do **desenvolvimento** quando puder, para os testes rodarem na
  mesma versão da produção. Troca de versão principal (18 → 19) é
  outro procedimento (`pg_upgradecluster`), nunca feito por este comando.
- Se o PostgreSQL avisar `collation version mismatch` (acontece raramente, depois de uma
  atualização grande do Ubuntu): `sudo -u postgres psql -d dbs2vet -c 'REINDEX DATABASE
  dbs2vet' -c 'ALTER DATABASE dbs2vet REFRESH COLLATION VERSION'`, na janela de manutenção.

## E6. Acessar o banco pelo DBeaver

`[PC]`:
```powershell
ssh -N -L 5433:127.0.0.1:5432 vetprof@s2vet-be
```
> **Para que serve:** abre um túnel do seu PC até o banco, por dentro do Tailscale + SSH:
> o que você conectar em `localhost:5433` no seu PC chega no `127.0.0.1:5432` do Backend. O
> `-N` não abre terminal (só o túnel); feche com `Ctrl+C`. No DBeaver: host `localhost`, porta
> `5433`, banco `dbs2vet`, usuário `zls2vetp1` (leitura com isolamento) ou `nutriadmin`.
> ⚠️ O banco continua sem nenhuma porta aberta: o túnel só existe enquanto o comando roda.

---

## Como manter este documento

Ele descreve o **estado verificado** da produção, não a intenção. Ao mudar topologia, variável
de ambiente ou passo de subida, atualize aqui **junto** com o código: um roteiro que descreve um
servidor que não existe mais é pior que nenhum, porque é seguido com confiança. Registre sempre
o **porquê** — é ele que diz a quem vier depois se o passo ainda vale.

---

## Pendências

### P-1. Brevo: restringir as chaves SMTP aos IPs autorizados

> **Situação (2026-10-08):** chave SMTP de produção criada (`apis2vet`), login
> `b80165001@smtp-brevo.com`. O Brevo avisa *"Endereços IP não autorizados não são bloqueados
> para suas chaves SMTP"* — o bloqueio **ainda não foi ativado**.

**Por que fazer:** a chave SMTP mora no `backend.env`. Se ela vazar (backup, print, commit por
engano), qualquer um envia e-mail em nome da S2Vet, de qualquer máquina — e queima a reputação
do domínio. Com o bloqueio, a chave só funciona a partir dos IPs cadastrados.

🔴 **Ativar antes de cadastrar o IP PARA o envio de e-mail** — 2FA, "esqueci minha senha" e
convites param de sair. Siga a ordem:

1. `[BE]` Confirme o IP público de **saída** do Backend (é quem envia, não o Frontend):
   ```bash
   curl -4 ifconfig.me
   ```
   > **Para que serve:** mostra com que IP o Backend aparece na internet. Deve ser o
   > `177.153.69.171` (o mesmo restrito no Google Cloud para a chave do Gemini). O
   > WireGuard/Tailscale não muda esse IP, salvo se houver *exit node* configurado.
2. No Brevo: **Segurança → IPs autorizados** → cadastre esse IP.
3. **Desenvolvimento:** se o backend local também envia com a mesma chave, ele passa a ser
   bloqueado. Ou cadastre o IP de casa (residencial muda — o Brevo pede aprovação por e-mail
   quando um IP novo tenta enviar), ou deixe o e-mail desligado no dev (sem
   `EMAIL_USER`/`EMAIL_PASS` no `.env` local).
4. Só então: **Ativar para chaves SMTP**.
5. Teste em produção pelo "Esqueci minha senha" e confira que chegou.

⚠️ Se o envio falhar depois de ativar, o primeiro suspeito é o **IP de saída não cadastrado**
— antes da chave ou do remetente. Trocou de VPS ou de IP: cadastre o novo **antes** da troca.
