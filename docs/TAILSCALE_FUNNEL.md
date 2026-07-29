# Expor o S2Vet com Tailscale Funnel

Substitui o Cloudflare Tunnel (quick tunnel) usado hoje em dev. A diferença que
importa: **a URL é fixa**. O `*.trycloudflare.com` muda a cada reinício, o que obriga a
refazer o `APP_URL`, os links de e-mail e a origem do Google OAuth toda vez. O endereço
do Funnel (`https://<maquina>.<tailnet>.ts.net`) é sempre o mesmo, e o túnel volta
sozinho quando a máquina liga.

O que é exposto: **a porta 5173 (Vite)**. O backend (3001) continua fechado — o Vite já
faz proxy de `/api` e `/uploads` para ele (`frontend/vite.config.ts`).

```
Internet ──HTTPS──> Tailscale Funnel ──> localhost:5173 (Vite) ──/api──> localhost:3001
```

---

## 1. Instalar e conectar

1. Baixe em <https://tailscale.com/download/windows> e instale.
2. Faça login (Google/GitHub/e-mail). O plano **Personal é gratuito** e já inclui Funnel.
3. Confirme:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status
```

> Para não digitar o caminho todo, adicione `C:\Program Files\Tailscale` ao PATH ou use
> o alias que o instalador cria. Os comandos abaixo assumem `tailscale` no PATH.

---

## 2. Habilitar HTTPS no tailnet (uma vez só)

No admin console <https://login.tailscale.com/admin/dns>:

- **MagicDNS**: ativado.
- **HTTPS Certificates**: ativado. Sem isso o Funnel não emite o certificado e o
  navegador recusa a conexão.

Anote o nome do tailnet que aparece ali (algo como `seu-nome.ts.net`).

---

## 3. Liberar o Funnel na ACL (uma vez só)

Em <https://login.tailscale.com/admin/acls>, garanta o atributo `funnel`:

```json
{
  "nodeAttrs": [
    { "target": ["autogroup:member"], "attr": ["funnel"] }
  ]
}
```

Se ainda não existir, o próprio `tailscale funnel` imprime um link pronto para adicionar
na primeira execução — basta abrir e confirmar.

---

## 4. Subir a aplicação

Dois terminais, como já é hoje:

```powershell
# Terminal 1 — backend
cd backend; npm run dev

# Terminal 2 — frontend (VITE_TUNEL=1 corrige o HMR atrás de HTTPS)
cd frontend; $env:VITE_TUNEL="1"; npm run dev
```

`VITE_TUNEL=1` faz o cliente de HMR conectar em `wss://…:443` em vez de `:5173`. Sem
isso a aplicação funciona, mas o hot reload morre e o console enche de erro de websocket.
Acessando por `http://localhost:5173`, **não** defina a variável.

---

## 5. Ligar o Funnel

Abra o PowerShell **como Administrador** (no Windows o comando precisa falar com o
serviço do Tailscale):

```powershell
tailscale funnel --bg 5173
```

- `--bg` roda em segundo plano e **persiste**: sobrevive a fechar o terminal e volta
  sozinho quando a máquina reinicia.
- O público sai sempre em **443**; o Funnel só aceita 443, 8443 e 10000 como porta
  externa. O `5173` aqui é o destino local.

Conferir e descobrir a URL:

```powershell
tailscale funnel status
```

Saída no formato:

```
https://minha-maquina.seu-nome.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:5173
```

Desligar quando quiser:

```powershell
tailscale funnel --https=443 off
```

---

## 6. Ajustes no S2Vet (com a URL em mãos)

Chame a URL de `https://SUA-MAQUINA.SEU-TAILNET.ts.net`.

### 6.1 `backend/.env` — obrigatório

```ini
APP_URL=https://SUA-MAQUINA.SEU-TAILNET.ts.net
```

É daqui que saem os links dos e-mails (aprovação de vínculo vet-animal, convite de
equipe, reset de senha, 2FA). Com `localhost` neles, ninguém de fora consegue clicar.
**Reinicie o backend** após mudar.

> Lembrete da seção 14 do CLAUDE.md: link de e-mail sempre com `/#/` antes do path
> (HashRouter). Isso já está no código, é só não esquecer ao criar template novo.

### 6.2 Google OAuth — obrigatório se for usar login com Google

No Google Cloud Console → Credenciais → seu OAuth Client → **Authorized JavaScript
origins**, adicione:

```
https://SUA-MAQUINA.SEU-TAILNET.ts.net
```

Este é o maior ganho sobre o Cloudflare quick tunnel: como a URL não muda, você cadastra
**uma vez** e nunca mais mexe.

### 6.3 `ALLOWED_ORIGINS` — não precisa mexer

O proxy do Vite reescreve o header `Origin` para `http://localhost:5173` antes de
encaminhar ao backend (`vite.config.ts`), então o CORS passa sem incluir o domínio
`.ts.net`. Só será necessário quando o frontend passar a ser servido direto pelo backend
(build de produção), e aí é:

```ini
ALLOWED_ORIGINS=https://SUA-MAQUINA.SEU-TAILNET.ts.net
```

### 6.4 `COOKIE_SECURE` — opcional

A sessão usa cookies HttpOnly. Sobre HTTPS eles funcionam sem `Secure`, mas se quiser
endurecer:

```ini
COOKIE_SECURE=true
```

Cuidado: cookie `Secure` continua valendo em `http://localhost` (o navegador trata
localhost como origem confiável), então o acesso local não quebra. Se for testar por
`http://` em **outra** máquina da rede, aí sim quebra.

---

## 7. Checklist de validação

1. `tailscale funnel status` mostra `(Funnel on)`.
2. Abrir a URL `.ts.net` em uma rede **fora** da sua (dados do celular, por exemplo).
3. Fazer login — se a sessão cair na hora, é cookie/HTTPS; revise 6.4.
4. Abrir uma tela que chame `/api` (Pacientes) — se der erro de CORS, o proxy do Vite
   não está sendo usado (você acessou o backend direto).
5. Disparar um e-mail (convite de equipe) e conferir se o link aponta para o `.ts.net`.

---

## 8. Limites que você precisa saber

- **A máquina precisa estar ligada e com o Tailscale rodando.** O Funnel não é
  hospedagem; é um túnel para a sua máquina, igual ao cloudflared nisso.
- **Só HTTP/HTTPS** nas portas 443, 8443 e 10000.
- **O tráfego passa pelos relays da Tailscale.** Para navegar e testar é ótimo; para
  upload pesado (o app aceita mídia de até 100 MB em evolução) espere lentidão.
- **A URL é pública.** Quem tiver o endereço alcança a tela de login. As defesas atuais
  (Helmet, rate limit 200/min e 20/15min em `/auth`, bcrypt, 2FA opcional) valem, mas
  antes de expor de verdade resolva as pendências já listadas na seção 14 do CLAUDE.md —
  em especial **renovar o `JWT_SECRET`**, que lá está marcado como fraco.
- **IP na auditoria**: com o túnel, `req.ip` passa a ser o do proxy local. Se o IP real
  do usuário importar nos logs, será preciso ler o header encaminhado e ajustar
  `TRUST_PROXY_HOPS` conforme a cadeia (hoje o padrão é 1).

---

## 9. Comandos do dia a dia

| Objetivo | Comando |
|---|---|
| Ligar (persistente) | `tailscale funnel --bg 5173` |
| Ver estado e URL | `tailscale funnel status` |
| Desligar | `tailscale funnel --https=443 off` |
| Ver a máquina/tailnet | `tailscale status` |
| Rodar em primeiro plano (log ao vivo) | `tailscale funnel 5173` |

> Em versões mais antigas do Tailscale a sintaxe era em duas etapas:
> `tailscale serve https / http://localhost:5173` seguido de `tailscale funnel 443 on`.
> Se `--bg` não existir na sua versão, atualize o cliente.
