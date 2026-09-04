# Secret exposto no histórico do Git — runbook de correção

> **Achado (auditoria 2026-08-29):** um **Google OAuth Client Secret** (`GOCSPX-…`)
> ficou versionado em `frontend/src/main.tsx` e permanece alcançável no **histórico**
> do Git, embora o commit `e6ec280` ("fix: remove google credentials from code") o
> tenha removido do código atual.
>
> **Estado já verificado nesta auditoria:**
> - O working tree ATUAL está **limpo** — `main.tsx` não contém segredo.
> - O secret do histórico **difere** do valor em uso hoje (comparação por hash) → há
>   forte indício de que ele **já foi rotacionado** quando a limpeza foi feita.
> - O repositório tem remoto no GitHub (`github.com/marcoaraujoc/nutricao-equina-super`).
> - Um gate de **varredura de secrets** foi adicionado ao CI (`.github/workflows/ci.yml`,
>   job `secret-scan`) — impede a **reintrodução** de qualquer segredo no código. Essa é
>   a metade da correção que foi automatizada.

As **duas metades restantes** exigem uma decisão/ação humana e por isso **não foram
executadas automaticamente**: uma acontece fora do repositório (Google Console) e a
outra reescreve o histórico público e exige `git push --force` (destrutivo e
irreversível). Ambas estão prontas abaixo.

---

## Metade 1 — ROTAR/REVOGAR o secret antigo (a mais importante)

Purgar o histórico **sem** rotacionar é teatro de segurança: quem já clonou o repo (ou
viu o secret enquanto ele esteve no `main.tsx` servido ao navegador) ainda tem o valor.
O que torna o secret vazado inofensivo é **invalidá-lo na origem**.

1. Acesse o **Google Cloud Console** → *APIs e Serviços* → *Credenciais*.
2. Abra o **OAuth 2.0 Client ID** deste projeto (o `VITE_GOOGLE_CLIENT_ID` em uso).
3. Em **Client secrets**, confirme que o secret antigo `GOCSPX-ZB4o…` está **revogado**
   (removido). Se ainda existir, **adicione um novo** e **remova o antigo**.
4. O S2Vet **não usa** Client Secret no fluxo atual (login Google é `useGoogleLogin`
   com `access_token`, validado server-side em `GoogleController`; o front usa só o
   **Client ID**, que é público por design). Ou seja: revogar o secret antigo **não
   quebra** o login. Se algum dia um secret for necessário, ele mora **só** em
   `backend/.env`, nunca no frontend.

> Sem acesso ao Console, este passo fica com quem administra o projeto Google. É o
> único passo que fecha o risco de verdade.

---

## Metade 2 — REMOVER o secret do histórico do Git (destrutivo)

> ⚠️ **Reescreve TODOS os SHAs** desde o primeiro commit afetado e exige
> **`git push --force`** ao GitHub. Quebra clones, forks e PRs abertos. Faça em janela
> combinada e avise quem tiver clone. **Só execute depois da Metade 1.**

### Preparação (backup obrigatório)

```bash
# clone-espelho de segurança ANTES de qualquer reescrita
git clone --mirror https://github.com/marcoaraujoc/nutricao-equina-super.git backup-antes-do-purge.git
```

### Purge com git-filter-repo (recomendado)

`git filter-repo` **substitui** o valor do secret por `***REMOVED***` em todo o
histórico, preservando os arquivos (não apaga `main.tsx`, só limpa o valor).

```bash
# 1. instalar (uma vez):  pip install git-filter-repo

# 2. liste os valores a remover — UM por linha, no arquivo abaixo.
#    Inclua o secret do histórico E qualquer outro que a auditoria tenha achado.
cat > /tmp/secrets-a-remover.txt <<'TXT'
GOCSPX-ZB4o...   # <- cole aqui o valor COMPLETO do secret antigo
TXT

# 3. reescreve o histórico (rode na raiz de um clone FRESCO do repo):
git filter-repo --replace-text /tmp/secrets-a-remover.txt

# 4. reaponte o remoto (o filter-repo remove o origin por segurança) e force-push:
git remote add origin https://github.com/marcoaraujoc/nutricao-equina-super.git
git push --force --all
git push --force --tags
```

### Alternativa: BFG Repo-Cleaner

```bash
# java -jar bfg.jar --replace-text /tmp/secrets-a-remover.txt
# git reflog expire --expire=now --all && git gc --prune=now --aggressive
# git push --force --all
```

### Depois do purge

- Apague o `apt`/cache de forks e **invalide o cache do GitHub** abrindo um chamado ao
  suporte, se o repo for público (o GitHub mantém blobs alcançáveis por SHA por um tempo).
- Confirme: `git log -S"GOCSPX" --all` não deve retornar nada.
- Rode `gitleaks detect` localmente para conferir.

---

## Por que o CI escaneia só o código atual, não o histórico

O job `secret-scan` usa `gitleaks detect --no-git`, que varre os **arquivos do
checkout**, não o histórico. Se varresse o histórico, **falharia para sempre** por
causa do secret já vazado — um gate que está sempre vermelho é ignorado. Escaneando o
estado atual, ele reprova exatamente o que importa daqui para frente: **um secret novo
entrando no código**. A limpeza do histórico (Metade 2) é o que fecha o passado.
