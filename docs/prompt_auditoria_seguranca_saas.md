# PROMPT — AUDITORIA COMPLETA DE SEGURANÇA DA APLICAÇÃO SAAS

## PAPEL

Atue como um **especialista sênior em Application Security, Cloud Security, DevSecOps, Network Security, PostgreSQL Security e Pentest**, com experiência em aplicações SaaS multi-tenant.

Você deverá realizar uma **auditoria de segurança autorizada e controlada** da aplicação abaixo.

O objetivo NÃO é apenas procurar vulnerabilidades óbvias. Quero verificar se a arquitetura realmente possui as barreiras de segurança necessárias para operar uma SaaS em produção.

---

# 1. ARQUITETURA

A aplicação possui:

- Frontend: React + Vite
- Backend: Node.js
- Banco: PostgreSQL
- Frontend e backend em servidores separados
- Aplicação SaaS multi-tenant
- HTTPS
- API REST
- Autenticação de usuários
- Controle de permissões
- Usuários podem pertencer a empresas/tenants
- Um usuário pode ter diferentes permissões dependendo do tenant
- Os dados de um tenant NÃO podem ser acessados por outro tenant

Arquitetura esperada:

```text
                         INTERNET
                            |
                     +------+------+
                     | CDN / WAF   |
                     +------+------+
                            |
                          HTTPS
                            |
                +-----------v-----------+
                |       FRONTEND        |
                |     React + Nginx     |
                +-----------+-----------+
                            |
                       HTTPS / API
                            |
                +-----------v-----------+
                |        BACKEND        |
                |       Node.js         |
                +-----------+-----------+
                            |
                     PRIVATE NETWORK
                            |
                +-----------v-----------+
                |      PostgreSQL       |
                +-----------------------+
```

O banco NÃO deve ser acessível diretamente pela Internet.

O frontend NÃO deve possuir credenciais ou segredos do banco.

O backend é o único componente autorizado a acessar o banco.

---

# 2. OBJETIVO DA AUDITORIA

Faça uma auditoria abrangente seguindo, no mínimo:

- OWASP Top 10
- OWASP API Security Top 10
- princípios de Zero Trust
- princípio do menor privilégio
- defesa em profundidade
- segurança específica para SaaS multi-tenant
- segurança de autenticação e sessão
- segurança de infraestrutura
- segurança de PostgreSQL
- segurança de Docker, caso utilizado
- segurança de CI/CD
- proteção de secrets

Não considere a aplicação segura simplesmente porque utiliza HTTPS.

Avalie cada camada individualmente.

---

# 3. PRIMEIRA ETAPA — MAPEAR A SUPERFÍCIE DE ATAQUE

Antes de testar vulnerabilidades, faça um inventário.

Identifique:

- domínios
- subdomínios
- frontend
- backend
- endpoints da API
- portas abertas
- serviços expostos
- banco de dados
- serviços auxiliares
- storage
- filas
- webhooks
- serviços de terceiros
- autenticação
- administração
- endpoints públicos
- endpoints autenticados
- endpoints administrativos

Produza:

```text
COMPONENTE
IP/DNS
PORTA
PROTOCOLO
EXPOSIÇÃO
AUTENTICAÇÃO
RISCO
```

Não assuma que uma porta ou serviço é seguro apenas porque não está documentado.

---

# 4. TESTE DE SEGMENTAÇÃO DE REDE

Verifique:

## Frontend

Deve aceitar somente o tráfego necessário.

Teste:

- 80
- 443
- SSH
- outras portas abertas

Verifique se SSH está acessível publicamente.

## Backend

Verifique:

- portas abertas
- SSH
- API
- portas administrativas
- portas internas

## PostgreSQL

Teste se a porta 5432 está acessível:

- Internet → PostgreSQL
- Frontend → PostgreSQL
- Backend → PostgreSQL

O resultado esperado é:

```text
Internet → PostgreSQL = BLOQUEADO

Frontend → PostgreSQL = BLOQUEADO

Backend → PostgreSQL = PERMITIDO
```

Caso o PostgreSQL esteja exposto publicamente, classifique como vulnerabilidade de alta prioridade.

---

# 5. TESTE DE FIREWALL

Analise as regras de firewall/security groups.

Verifique:

- portas abertas
- origem
- destino
- protocolo
- regras redundantes
- regras excessivamente permissivas
- 0.0.0.0/0
- IPv6
- portas administrativas

Procure especificamente:

```text
0.0.0.0/0 → 22
0.0.0.0/0 → 5432
0.0.0.0/0 → portas administrativas
```

Classifique cada exposição.

---

# 6. TESTE DE SSH

Verifique:

- login por senha
- login como root
- autenticação por chave
- AllowUsers
- firewall
- fail2ban
- VPN
- origem permitida
- chaves antigas
- chaves compartilhadas
- logs

O resultado ideal é:

```text
PasswordAuthentication = no

PermitRootLogin = no
```

Caso exista acesso administrativo por senha, classifique o risco.

---

# 7. TESTE DE TLS / HTTPS

Verifique:

- certificado
- cadeia de certificados
- TLS 1.2/1.3
- protocolos antigos
- cipher suites
- HTTP sem HTTPS
- redirect HTTP → HTTPS
- HSTS
- validade do certificado
- cookies Secure

Teste também:

```text
http://app.dominio.com
http://api.dominio.com
```

O comportamento esperado é redirecionamento seguro para HTTPS.

Verifique:

```text
Strict-Transport-Security
```

---

# 8. TESTE DE SECURITY HEADERS

Analise frontend e backend.

Verifique:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
X-Frame-Options
```

Avalie se cada header está corretamente configurado.

Não apenas informe "existe".

Verifique se a configuração é efetivamente segura.

---

# 9. TESTE DE CORS

Verifique:

- Access-Control-Allow-Origin
- Allow-Credentials
- métodos
- headers
- preflight
- origens permitidas

Procure configurações como:

```text
Access-Control-Allow-Origin: *
```

especialmente em endpoints autenticados.

Teste origens maliciosas.

Exemplo:

```text
https://attacker.example
```

O backend não deve aceitar origens arbitrárias.

---

# 10. AUTENTICAÇÃO

Audite completamente o mecanismo de login.

Teste:

- brute force
- credential stuffing
- enumeração de usuários
- mensagens diferentes para usuário inexistente
- senha fraca
- recuperação de senha
- troca de senha
- logout
- sessão após troca de senha
- múltiplas sessões
- invalidação de sessão
- MFA
- bypass de autenticação

Verifique rate limiting.

Teste:

```text
POST /login
```

com múltiplas tentativas controladas.

Não realize ataques destrutivos.

---

# 11. TESTE DE SESSÃO

Verifique cookies.

Eles devem utilizar, quando aplicável:

```text
HttpOnly
Secure
SameSite
```

Verifique:

- session fixation
- session hijacking
- expiração
- renovação
- invalidação
- logout
- sessão após troca de senha
- sessão após alteração de privilégio

Se JWT for utilizado, analise:

- algoritmo
- assinatura
- expiração
- refresh token
- rotação
- revogação
- armazenamento
- exposição no frontend

Se for possível substituir JWT por sessão server-side, avalie essa arquitetura.

---

# 12. TESTE DE AUTORIZAÇÃO

Este é um dos testes MAIS IMPORTANTES.

Não basta provar que o usuário consegue fazer login.

Verifique se ele pode executar somente as operações permitidas.

Teste:

```text
Usuário comum
→ endpoint administrativo

Veterinário
→ endpoint financeiro

Funcionário
→ endpoint de administrador

Usuário sem permissão
→ endpoint protegido
```

Teste também:

```text
GET
POST
PUT
PATCH
DELETE
```

para cada recurso importante.

---

# 13. TESTE CRÍTICO DE MULTI-TENANCY

Considere:

```text
TENANT A
TENANT B
```

Crie usuários controlados nos dois ambientes.

Cadastre recursos em A:

```text
animal A
cliente A
consulta A
documento A
financeiro A
```

Cadastre recursos equivalentes em B.

Depois tente acessar recursos de A usando a sessão de B.

Teste:

```text
GET /animals/{id}
GET /clients/{id}
GET /appointments/{id}
GET /documents/{id}
GET /financial/{id}
```

Faça o mesmo para:

```text
POST
PUT
PATCH
DELETE
```

O resultado esperado é:

```text
TENANT B → recurso do TENANT A = BLOQUEADO
```

---

# 14. TESTE DE IDOR / BOLA

Procure vulnerabilidades do tipo:

```text
GET /animals/100
```

onde alterar:

```text
100 → 101
```

permite acessar outro recurso.

Teste:

- IDs sequenciais
- UUIDs
- IDs ocultos
- parâmetros
- query strings
- path parameters
- body
- headers

Não assuma que UUID resolve autorização.

---

# 15. TESTE DE TENANT ESCALATION

Tente alterar:

```json
{
  "tenantId": "outro-tenant"
}
```

no request.

Teste também:

```text
tenant_id
company_id
organization_id
account_id
owner_id
```

Verifique se o backend confia em valores enviados pelo frontend.

O backend deve derivar o tenant do contexto autenticado.

---

# 16. TESTE DE MASS ASSIGNMENT

Envie campos que não deveriam ser controlados pelo usuário:

```json
{
  "role": "ADMIN",
  "isAdmin": true,
  "tenantId": "X",
  "permissions": ["ALL"],
  "ownerId": "X"
}
```

Verifique se algum deles é aceito.

Teste todos os endpoints de criação e atualização.

---

# 17. POSTGRESQL ROW LEVEL SECURITY

Verifique se existe RLS.

Caso exista:

- valide policies
- valide SELECT
- INSERT
- UPDATE
- DELETE
- bypass
- roles
- superuser
- conexão da aplicação

Teste se uma query executada pela aplicação consegue escapar do tenant.

Se NÃO existir RLS:

Informe como risco arquitetural, mas NÃO classifique automaticamente como vulnerabilidade crítica.

Explique o risco de depender exclusivamente do backend.

---

# 18. PRINCÍPIO DO MENOR PRIVILÉGIO NO BANCO

Verifique o usuário utilizado pelo Node.js.

Ele deve possuir somente os privilégios necessários.

Teste:

```text
CREATE DATABASE
DROP DATABASE
CREATE ROLE
CREATE EXTENSION
SUPERUSER
```

A aplicação não deve possuir privilégios administrativos desnecessários.

---

# 19. SQL INJECTION

Teste todos os parâmetros controláveis pelo usuário:

- query parameters
- path parameters
- body
- filtros
- ordenação
- busca
- paginação
- relatórios

Procure concatenação de SQL.

Exemplo perigoso:

```javascript
"SELECT * FROM users WHERE name = '" + name + "'"
```

Verifique se são utilizados:

- prepared statements
- parameterized queries
- ORM corretamente
- validação

---

# 20. NOSQL / COMMAND / OS INJECTION

Caso existam integrações ou comandos externos, procure:

- command injection
- shell injection
- template injection
- LDAP injection
- NoSQL injection

Teste somente de maneira não destrutiva.

---

# 21. XSS

Teste:

- Stored XSS
- Reflected XSS
- DOM XSS

Campos relevantes:

- nome
- endereço
- observações
- descrição
- documentos
- mensagens
- comentários
- prontuários
- campos administrativos

Verifique também CSP.

---

# 22. CSRF

Se a aplicação utiliza cookies para autenticação, verifique:

- SameSite
- CSRF token
- origem
- métodos
- endpoints mutáveis

Teste operações como:

```text
POST
PUT
PATCH
DELETE
```

Não considere SameSite isoladamente suficiente sem avaliar o contexto.

---

# 23. FILE UPLOAD

Caso exista upload:

Teste:

- extensão
- MIME
- tamanho
- nome
- path traversal
- arquivos executáveis
- SVG
- HTML
- arquivos duplamente extensíveis
- malware
- arquivos gigantes
- ZIP bombs

Verifique se arquivos enviados podem ser executados pelo servidor.

Idealmente:

```text
upload
 ↓
storage isolado
 ↓
nome aleatório
 ↓
sem execução
```

---

# 24. PATH TRAVERSAL

Teste parâmetros como:

```text
../
../../
```

em:

- downloads
- uploads
- arquivos
- documentos
- relatórios
- exportações

---

# 25. SSRF

Procure funcionalidades que recebem URLs fornecidas pelo usuário:

```text
webhook
URL de imagem
importação
integração
callback
PDF
consulta externa
```

Teste acesso controlado a:

```text
localhost
127.0.0.1
metadata endpoints
rede privada
```

Não execute ações destrutivas.

---

# 26. API SECURITY

Para cada endpoint, documente:

```text
ENDPOINT
MÉTODO
AUTENTICAÇÃO
PERMISSÃO
TENANT
VALIDAÇÃO
RATE LIMIT
RISCO
```

Procure:

- endpoints sem autenticação
- endpoints esquecidos
- endpoints administrativos
- endpoints antigos
- versões antigas da API
- debug endpoints
- Swagger exposto indevidamente
- health endpoints com informações sensíveis

---

# 27. RATE LIMITING

Verifique:

```text
/login
/forgot-password
/reset-password
/2fa
/api/*
```

Teste se o limite pode ser burlado usando:

- IP diferente
- headers
- IPv6
- múltiplas sessões
- múltiplos endpoints

Não realize volume suficiente para causar indisponibilidade.

---

# 28. ENUMERAÇÃO

Verifique se a API revela:

- existência de usuário
- existência de tenant
- existência de animal
- existência de cliente
- existência de documento
- existência de recurso privado

Compare:

```text
200
403
404
```

e mensagens de erro.

Avalie se a diferença permite enumeração.

---

# 29. INFORMATION DISCLOSURE

Procure:

- stack traces
- mensagens internas
- nomes de tabelas
- SQL
- caminhos do filesystem
- versões
- variáveis de ambiente
- secrets
- tokens
- IPs internos
- nomes de servidores

Teste:

```text
/api
/swagger
/docs
/debug
/health
/metrics
```

---

# 30. SECRETS

Procure no código e no repositório:

```text
.env
password
secret
token
apikey
private_key
JWT_SECRET
DATABASE_URL
```

Verifique:

- Git history
- branches
- CI/CD
- Docker
- logs
- frontend bundle

IMPORTANTE:

Tudo que estiver no frontend deve ser tratado como público.

Verifique se algum secret está sendo enviado ao React.

---

# 31. NPM / DEPENDÊNCIAS

Analise:

```text
package.json
package-lock.json
```

Procure:

- vulnerabilidades conhecidas
- pacotes abandonados
- dependências desnecessárias
- dependências com privilégios excessivos
- scripts perigosos

Execute, quando disponível:

```bash
npm audit
```

Não atualize dependências automaticamente em produção durante a auditoria.

---

# 32. DOCKER

Se Docker for utilizado:

Verifique:

- containers rodando como root
- portas expostas
- privileged
- host network
- volumes
- secrets
- Docker socket
- imagens antigas
- imagem base
- CVEs
- capabilities
- filesystem writable

Procure especificamente:

```text
/var/run/docker.sock
```

e:

```text
privileged: true
```

---

# 33. NGINX

Audite:

- versão
- configuração
- headers
- métodos permitidos
- arquivos ocultos
- directory listing
- proxy
- timeouts
- limites de upload
- logs
- acesso a arquivos

Verifique se arquivos como:

```text
.env
.git
.gitignore
package.json
docker-compose.yml
```

não estão publicamente acessíveis.

---

# 34. WAF / CDN

Caso exista WAF:

Verifique:

- proteção contra bots
- rate limiting
- regras OWASP
- DDoS
- origem do backend
- bypass direto da origem

Teste se o atacante consegue descobrir e acessar diretamente o IP do backend sem passar pelo WAF.

Se conseguir, informe:

```text
WAF BYPASS
```

como vulnerabilidade arquitetural.

---

# 35. BACKEND ORIGIN PROTECTION

O backend deve idealmente aceitar tráfego somente:

```text
WAF/CDN → Backend
```

ou das origens necessárias.

Verifique se:

```text
Internet → Backend
```

pode ignorar o WAF.

---

# 36. LOGGING

Verifique se existem logs para:

- login
- logout
- falha de login
- alteração de senha
- MFA
- alteração de permissões
- criação de usuário
- exclusão
- troca de tenant
- operações administrativas
- acesso a dados sensíveis

Verifique também se os logs NÃO armazenam:

- senha
- token
- cookie
- secret
- cartão
- informações excessivamente sensíveis

---

# 37. AUDIT TRAIL

Para operações críticas, determine:

```text
QUEM
QUANDO
O QUÊ
TENANT
IP
RESULTADO
```

Exemplo:

```text
USER 123
TENANT 10
27/08/2026 15:30
ALTEROU PERMISSÃO
USER 456
SUCESSO
IP x.x.x.x
```

Avalie se o log pode ser alterado pelo próprio usuário.

---

# 38. BACKUP

Verifique:

- frequência
- criptografia
- retenção
- localização
- acesso
- isolamento
- PITR
- WAL
- restore

Teste, se autorizado, um restore em ambiente isolado.

Nunca sobrescreva produção durante o teste.

---

# 39. RECOVERY

Determine:

```text
RPO
RTO
```

e responda:

- quanto de dados pode ser perdido?
- quanto tempo para restaurar?
- existe procedimento documentado?
- o restore já foi testado?

---

# 40. CI/CD

Audite:

- GitHub/GitLab
- secrets
- tokens
- runners
- permissões
- branch protection
- revisão de código
- dependency scanning
- SAST
- DAST
- secrets scanning

Verifique se um desenvolvedor consegue publicar diretamente em produção sem revisão.

---

# 41. SEGURANÇA DO FRONTEND

Analise o bundle produzido pelo React.

Procure:

- secrets
- URLs internas
- tokens
- credenciais
- endpoints administrativos
- informações desnecessárias

Lembre-se:

```text
Tudo enviado ao navegador é público.
```

---

# 42. CONTROLE DE ACESSO ADMINISTRATIVO

Admin deve possuir:

- MFA
- privilégios mínimos
- logs
- sessão curta
- possibilidade de revogação
- proteção adicional

Avalie a possibilidade de separar:

```text
usuário
administrador
superadministrador
suporte
```

---

# 43. TESTE DE PRIVILEGE ESCALATION

Teste:

```text
USER
 ↓
MANAGER
 ↓
ADMIN
 ↓
SUPERADMIN
```

Tente escalar privilégios através de:

- alteração de request
- alteração de role
- alteração de tenant
- mass assignment
- endpoints ocultos
- JWT
- cookies
- parâmetros

---

# 44. TESTE DE BUSINESS LOGIC

Não procure somente vulnerabilidades técnicas.

Procure falhas como:

```text
usuário consegue cancelar algo que não deveria
usuário consegue alterar recurso de outro tenant
usuário consegue gerar documento sem permissão
usuário consegue manipular valores
usuário consegue repetir uma operação financeira
usuário consegue ignorar uma etapa obrigatória
```

Analise também race conditions.

---

# 45. RACE CONDITIONS

Identifique operações sensíveis:

- pagamento
- estoque
- agendamento
- emissão
- cancelamento
- alteração de saldo
- permissões

Teste requisições concorrentes de forma controlada.

Verifique:

```text
double submit
double spending
duplicate operation
```

---

# 46. TESTE DE CONCORRÊNCIA ENTRE TENANTS

Simule:

```text
Usuário A → Tenant A
Usuário B → Tenant B
```

executando operações simultaneamente.

Verifique se existe qualquer possibilidade de:

```text
context leakage
tenant leakage
cache leakage
session leakage
```

---

# 47. CACHE

Verifique:

- cache do navegador
- CDN
- Nginx
- backend
- Redis, se existir

Garanta que respostas privadas de Tenant A não possam ser entregues a Tenant B.

Especial atenção a:

```text
Cache-Control
Vary
Authorization
Cookie
tenant context
```

---

# 48. WEBHOOKS

Caso existam:

- valide assinatura
- valide origem
- implemente replay protection
- timestamp
- idempotência
- rate limiting

Nunca confie apenas em:

```text
IP
```

como autenticação de webhook.

---

# 49. INTEGRAÇÕES EXTERNAS

Para cada API externa:

- credencial
- escopo
- rotação
- timeout
- TLS
- validação de resposta
- retry
- rate limit
- armazenamento de segredo

Verifique se uma falha na integração pode comprometer todo o tenant.

---

# 50. CLASSIFICAÇÃO

Cada vulnerabilidade encontrada deverá ser classificada:

```text
CRÍTICA
ALTA
MÉDIA
BAIXA
INFORMATIVA
```

Utilize como referência:

- impacto
- probabilidade
- facilidade de exploração
- exposição
- quantidade de tenants afetados
- possibilidade de vazamento de dados
- possibilidade de takeover
- possibilidade de privilege escalation

---

# 51. PARA CADA VULNERABILIDADE

Informe obrigatoriamente:

```text
ID:
Título:
Severidade:
CVSS aproximado:

Componente:
Endpoint:
Descrição:

Pré-condições:

Como foi detectada:

Evidência:

Impacto:

Tenant afetado:

Exploração possível:

Correção recomendada:

Correção imediata:

Correção definitiva:

Como testar novamente:
```

Não apenas diga:

> "CORS está inseguro."

Explique exatamente:

```text
configuração atual
risco
como reproduzir
como corrigir
como validar a correção
```

---

# 52. NÃO FAÇA ALTERAÇÕES DESTRUTIVAS

A auditoria deve ser:

- autorizada
- controlada
- não destrutiva

NÃO:

- apague dados
- derrube serviços
- altere produção
- faça DDoS
- faça brute force massivo
- altere permissões reais
- exfiltre dados reais
- modifique dados de outros usuários
- execute ransomware
- destrua backups

Sempre que possível utilize:

```text
contas de teste
tenants de teste
dados fictícios
ambiente staging
```

---

# 53. TESTE DE VAZAMENTO

O objetivo principal da auditoria deve ser responder:

> "É possível que um usuário autenticado consiga visualizar ou modificar qualquer dado pertencente a outro tenant?"

Faça testes específicos para isso.

Teste:

```text
IDOR
BOLA
Broken Access Control
tenantId manipulation
JWT manipulation
session manipulation
cache
exports
reports
downloads
uploads
search
filters
pagination
bulk operations
```

---

# 54. MATRIZ FINAL DE SEGURANÇA

Ao terminar, produza uma tabela:

| Área | Status | Risco | Evidência |
|---|---|---|---|
| HTTPS | PASS/FAIL | | |
| Firewall | PASS/FAIL | | |
| SSH | PASS/FAIL | | |
| PostgreSQL público | PASS/FAIL | | |
| CORS | PASS/FAIL | | |
| Headers | PASS/FAIL | | |
| Authentication | PASS/FAIL | | |
| Session | PASS/FAIL | | |
| RBAC | PASS/FAIL | | |
| Multi-tenancy | PASS/FAIL | | |
| IDOR/BOLA | PASS/FAIL | | |
| RLS | PASS/FAIL | | |
| SQL Injection | PASS/FAIL | | |
| XSS | PASS/FAIL | | |
| CSRF | PASS/FAIL | | |
| SSRF | PASS/FAIL | | |
| File Upload | PASS/FAIL | | |
| Secrets | PASS/FAIL | | |
| Docker | PASS/FAIL | | |
| Nginx | PASS/FAIL | | |
| WAF | PASS/FAIL | | |
| Logs | PASS/FAIL | | |
| Backup | PASS/FAIL | | |
| CI/CD | PASS/FAIL | | |

---

# 55. SCORE FINAL

Crie um score de segurança de:

```text
0 a 100
```

Divida em:

```text
90–100 → Excelente
80–89  → Bom
70–79  → Aceitável com melhorias
60–69  → Risco elevado
<60    → Não recomendado para produção
```

Mas NÃO deixe o score esconder vulnerabilidades críticas.

Uma aplicação com:

```text
score = 90
```

mas com:

```text
vazamento entre tenants
```

deve ser considerada **NÃO SEGURA PARA PRODUÇÃO**.

---

# 56. RELATÓRIO EXECUTIVO

Ao final, produza:

## RESUMO EXECUTIVO

Explique em linguagem não técnica:

- se a aplicação está segura
- principais riscos
- maior vulnerabilidade
- possibilidade de vazamento de dados
- risco de takeover
- risco de indisponibilidade
- risco de comprometimento do banco

---

# 57. TOP 10 CORREÇÕES

Liste as dez correções mais importantes em ordem de prioridade.

Formato:

```text
1. [CRÍTICA] Isolar PostgreSQL da Internet
2. [CRÍTICA] Corrigir isolamento entre tenants
3. [ALTA] Implementar MFA administrativo
...
```

---

# 58. PLANO DE CORREÇÃO

Monte:

## FASE 1 — IMEDIATA

Correções que devem ocorrer antes de colocar a aplicação em produção.

## FASE 2 — 7 DIAS

Correções de alta prioridade.

## FASE 3 — 30 DIAS

Melhorias estruturais.

## FASE 4 — CONTÍNUA

Monitoramento, pentest, atualização e DevSecOps.

---

# 59. CRITÉRIO DE APROVAÇÃO PARA PRODUÇÃO

No final responda claramente:

```text
APROVADO PARA PRODUÇÃO
```

ou:

```text
NÃO APROVADO PARA PRODUÇÃO
```

Se não estiver aprovado, informe exatamente quais vulnerabilidades impedem a aprovação.

Uma vulnerabilidade de:

- acesso entre tenants
- acesso público ao banco
- credenciais expostas
- authentication bypass
- privilege escalation crítica

deve impedir a aprovação.

---

# 60. REGRA FINAL

Não presuma que uma medida existe.

Não considere:

```text
"deveria estar protegido"
```

como evidência.

Diferencie:

```text
CONFIRMADO
NÃO TESTADO
NÃO EXISTE
CONFIGURAÇÃO INSEGURA
CONFIGURAÇÃO SEGURA
```

Quando não houver acesso suficiente para testar alguma camada, informe:

```text
NÃO FOI POSSÍVEL VALIDAR
```

e diga exatamente quais informações, acesso ou evidências seriam necessárias.

A auditoria deve priorizar:

1. isolamento entre tenants
2. autenticação
3. autorização
4. proteção do banco
5. exposição de rede
6. secrets
7. API Security
8. infraestrutura
9. logging/monitoramento
10. recuperação de desastre

O objetivo final é determinar se esta SaaS pode operar com segurança em produção e, principalmente, se **um usuário de um tenant consegue de alguma maneira acessar dados de outro tenant**.
