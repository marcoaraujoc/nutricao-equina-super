# Multi-tenancy S2Vet — plano de migração

> # 🔴 REGRA DE TRABALHO — NADA ENTRA NO BANCO SEM AUTORIZAÇÃO
>
> **Nenhuma migration é APLICADA, nenhum DDL/DML roda contra o banco sem o "ok" explícito
> do Marco.** O fluxo é sempre: eu escrevo o `schema.prisma` e gero o SQL da migration com
> `npx prisma migrate dev --create-only` (que **cria o arquivo e não aplica**) → você lê o
> SQL → você autoriza → só então `migrate deploy`.
> Scripts de leitura (`inventarioTenancy.js`) podem rodar a qualquer momento.
>
> **Status (2026-08-29): IMPLEMENTADO — fases 0 a 7 concluídas.** O RLS está ativo e
> **fail-closed**: 72 tabelas com policies `FORCE`, a role da aplicação sem `BYPASSRLS` e
> sem ser dona das tabelas, o tenant carimbado pelo `authenticate` (`app.empresa_id`,
> `lib/prismaTenant.js`), isolamento verificado ao vivo (leitura, escrita, UPDATE/DELETE e
> WITH CHECK cruzados entre empresas → recusados; sem contexto → zero linha) e gate de
> regressão no CI (`__tests__/tenancyRls.test.js`, `rlsCrossTenant`, `rlsVarreduraTenant`,
> `rlsCanario`, `authTenantHeaderSpoof`). Só a **fase 8** (endurecimentos) segue em
> acompanhamento. O texto abaixo é o **plano histórico** que guiou a migração, preservado
> como registro. Decisão: isolamento por **RLS no PostgreSQL**. Levantamento: 2026-08-05.

---

## 1. O que muda, em uma frase

Hoje o isolamento entre clínicas depende de **cada consulta lembrar de filtrar por
empresa** — 431 filtros escritos à mão. Depois desta migração, quem recusa a linha de outro
tenant é o **banco**: a consulta que esquecer o filtro devolve vazio, não o dado do vizinho.

Junto vem a simplificação que você definiu: **acabam os vínculos e aprovações entre
veterinário, proprietário e empresa**. Acesso ao paciente deixa de ser "existe vínculo
aceito?" e passa a ser "o paciente é desta empresa?" — que é o que o RLS responde.

---

## 2. Levantamento (medido, não estimado)

| Item | Número |
|---|---|
| Tabelas físicas | 90 |
| Filtros `req.empresaId` à mão | **431**, em 86 arquivos / 60 controllers |
| Tabelas com RLS hoje | **0** |
| Banco | PostgreSQL, schema único `schs2vet`, conexão direta |
| Usuário da aplicação | `nutriadmin` — **dono das 90 tabelas**, `rolsuper=false`, `rolbypassrls=false` |
| Crons registrados | **12** (o CLAUDE.md ainda diz 7 — desatualizado) |
| Rotas públicas (sem `authenticate`) | 12 |
| Rotas ADMIN cross-tenant | 13 + 6 de Monitoração |

### 2.1 Classificação das 90 tabelas

Via `backend/scripts/inventarioTenancy.js` (somente leitura, com fecho transitivo de FK):

| Classe | Tabelas | O que é |
|---|---:|---|
| TENANT DIRETO | 24 | já têm `empresa_id`/`empresaId` |
| TENANT VIA PAI | 33 | herdam por cadeia de FK (até 3 saltos) |
| CATÁLOGO global | 15 | espécie, raça, alimento, nutriente, NRC… — sem RLS (⚠️ `tb_medicamentos` saiu daqui: é misto, ver §4.1) |
| CONTROL PLANE | 13 | users, empresas, vínculo usuário×empresa, cron, auditoria — sem RLS |
| **PENDENTE** | **5** | sem caminho até a empresa — exigem decisão (§10.2, D8) |

**Pendentes:** `tb_composicao_alimento` (296), `tb_exame_itens` (259),
`tb_imagem_exame_itens` (119), `tb_exame_grupos` (24), `tb_imagem_exame_grupos` (12).

### 2.2 Órfãs — o quadro REAL

⚠️ **Uma versão anterior deste plano classificou o backfill como risco baixo ("≤69
linhas"). Estava errado**: aquilo era contagem de linhas, não de órfãs. Mas a primeira
leitura do inventário também exagerou para o outro lado, porque o script escolhia **um**
caminho de FK arbitrário. Depois de resolver tabela a tabela com o caminho correto:

| Tabela | Bruto | **Órfã real** | Veredito |
|---|---:|---:|---|
| `tb_procedimentos_vet` | 938/940 | **0** | ✅ **catálogo MISTO** (§4.1) — 938 com `empresa_id` nulo + exatamente 2 de empresa (31 e 32). É o padrão SYSTEM × CLIENTE que `Fornecedor` e `LocalizacaoAnimal` já usam |
| `tb_ai_usage_logs` | 182/218 | **0** | ✅ legado anterior ao metering por empresa, já documentado |
| `tb_prescricoes` | 64/69 | **0** | ✅ artefato do script: **todas as 69 têm grupo e animal**; resolve 100% |
| `tb_vacinas_clinicas` | 7/9 | **0** | ✅ 4 sem evolução, **todas resolvem pelo animal** |
| `tb_exames_clinicos` | 7/15 | **1** | 7 sem evolução, 6 resolvem pelo animal |
| `tb_dieta` | 1/10 | **1** | pendurada em animal órfão |
| **`tb_faturas`** | 10/35 | **10** | 🔴 **e 3 são ambíguas** — o proprietário pertence a MAIS DE UMA empresa (§10, D7) |
| `tb_fatura_itens` | 40/97 | 32 | consequência das faturas acima |
| **`tb_animais`** | 5/34 | **5** | 🔴 **raiz de 33 tabelas** |
| `tb_estoque_clinica` · `tb_midia_arquivos` · `tb_lotes_vacina` · `tb_resenha_equino` | 2·2·1·1 | 6 | volume desprezível, resolver caso a caso |

**Conclusão: o backfill é pequeno, mas tem dois bloqueios reais.**

🔴 **Bloqueio 1 — os 5 animais sem empresa.** 33 tabelas herdam o tenant deles, e há
**6 evoluções e 12 itens de fatura** pendurados:

| id | nome | ativo | proprietário |
|---|---|---|---|
| 1 | Administrador | sim | userId 1 (admin) — aparenta ser registro de teste |
| 55 | Kayser | sim | userId 158 |
| 66 | Dudoca | sim | userId 158 |
| 71 | Super Simples | **não** | userId 184 |
| 73 | Fafa | **não** | userId 184 |

🔴 **Bloqueio 2 — 10 faturas sem empresa, 3 delas ambíguas.** Derivar a empresa pelo
proprietário não funciona nessas 3: o mesmo cliente é atendido por mais de uma clínica, e
o backfill não tem como escolher. Chutar aqui é atribuir dinheiro à empresa errada.

### 2.3 Volume por tabela (o backfill em si é barato)

`tb_agendamentos_clinicos` 68 · `tb_evolucoes_clinicas` 42 · `tb_prescricao_grupos` 41 ·
`tb_movimentos_estoque` 36 · `tb_faturas` 35 · `tb_animais` 34 · `tb_exames_clinicos` 15 ·
`tb_dieta` 10 · `tb_orcamentos` 10 · `tb_vacinas_clinicas` 9 ·
`tb_encaminhamentos_clinicos` 2 · `tb_exames_nutricionais` 0.
Fora da curva: `tb_matriz_perfis` 12.593 (escopada por equipe).

---

## 3. Achados que mudam o plano

### 3.1 🔴 O usuário da aplicação é DONO das tabelas — RLS não teria efeito nenhum

`nutriadmin` é `tableowner` das 90 tabelas. No PostgreSQL o **dono ignora as policies** a
menos que a tabela tenha `FORCE ROW LEVEL SECURITY`. Ligar RLS mantendo a aplicação como
`nutriadmin` produz o pior resultado possível: políticas criadas, tudo indicando "isolado",
**e zero isolamento** — falsa segurança, pior que o estado atual.

**Correção obrigatória, antes de qualquer policy:** role de aplicação que **não seja dono**
(`zls2vetp1`, `NOSUPERUSER NOBYPASSRLS`), e a `DATABASE_URL` da aplicação passa a usá-lo.
`nutriadmin` segue dono e roda **migrations e backfill** — ali o bypass é desejável.

### 3.2 🟡 `SET LOCAL` só vale dentro de transação

O Prisma pega uma conexão qualquer do pool por operação. `SET` de sessão vazaria o tenant
para a próxima requisição que reusasse aquela conexão — um vazamento cross-tenant criado
pela própria proteção. A variável tem de ser local à transação.

### 3.3 🟡 O conflito com a regra §5 morreu sozinho

O CLAUDE.md §5 documenta leitura cross-tenant **intencional** (base própria enxerga o
co-tratado de outra empresa) — seria a exceção difícil de acomodar. Com o fim dos vínculos,
a regra deixa de existir.

---

## 4. Arquitetura alvo

```
CONTROL PLANE  (sem RLS — é o cadastro do SaaS, não é de ninguém)
  users · tb_empresas · tb_planos · tb_assinaturas_empresa · tb_usuario_empresa
  tb_mfa_desafios · tb_password_history · tb_configuracao_seguranca
  tb_modulos_sistema · tb_audit_logs · tb_auditoria_permissoes · cron (3 tabelas)

CATÁLOGO GLOBAL PURO (sem RLS — ninguém cria linha própria)
  espécie · raça · alimento · nutriente · NRC · especialidade · CRMV · laboratório ·
  localização · região anatômica · medicamento-espécies · medicamento-vias

CATÁLOGO MISTO  (RLS ligado, policy da forma (2) — parte global + parte da empresa)
  tb_medicamentos · tb_procedimentos_vet · tb_vacinas

TENANT PLANE   (RLS ligado — toda linha pertence a uma empresa)
  animais · evoluções · prescrições · vacinas · exames · encaminhamentos · agendamentos ·
  dietas · faturas · orçamentos · estoque e movimentos · resenhas · resumos de IA · …
```

**Chave:** `empresa_id` em **todas** as tabelas do plano de tenant, inclusive filhas. É
desnormalização deliberada: a policy vira `empresa_id = X` (indexável) em vez de um `EXISTS`
subindo a cadeia de pais a cada linha.

**Contrato da policy** — duas formas, e a escolha entre elas é por tabela:

```sql
-- (1) tabela de tenant puro
ALTER TABLE schs2vet.tb_evolucoes_clinicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE schs2vet.tb_evolucoes_clinicas FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schs2vet.tb_evolucoes_clinicas
  USING      (empresa_id = current_setting('app.empresa_id', true)::int)
  WITH CHECK (empresa_id = current_setting('app.empresa_id', true)::int);

-- (2) CATÁLOGO MISTO — medicamento, vacina e procedimento
--     A parte global é de todos; o que a empresa cadastra é só dela (ver §4.1)
CREATE POLICY tenant_ou_global ON schs2vet.tb_procedimentos_vet
  USING      (empresa_id IS NULL OR empresa_id = current_setting('app.empresa_id', true)::int)
  WITH CHECK (empresa_id = current_setting('app.empresa_id', true)::int);
  --          ↑ lê o global, mas só GRAVA carimbado como seu
```

Três detalhes que não são estilo:

- **`WITH CHECK` junto com `USING`** — sem ele o tenant lê só o que é dele mas **grava**
  linha carimbada com o id de outro.
- **`current_setting(..., true)`** devolve NULL quando a variável não está setada, e
  `empresa_id = NULL` é falso → **nenhuma linha**. Esquecer de setar o tenant fecha o
  banco, não abre.
- **Na forma (2), `WITH CHECK` NÃO repete o `IS NULL`** — senão qualquer tenant criaria
  linha global, visível a todos os clientes.

### 4.1 Catálogo misto: medicamento, vacina e procedimento

Regra: **a parte global é de todos; o que a empresa cadastra é só dela — ver e alterar.**
Medido hoje:

| Tabela | Global | Da empresa | Coluna `empresa_id` |
|---|---:|---:|---|
| `tb_medicamentos` | 4.876 | 2 | ✅ existe |
| `tb_procedimentos_vet` | 938 | 2 | ✅ existe |
| `tb_vacinas` | 0 | 0 | ❌ **não existe — precisa ser criada** |

⚠️ Correção de classificação: `tb_medicamentos` estava listada como catálogo global puro.
Ela já tem `empresa_id` e já tem 2 linhas de empresa — **é catálogo misto** e entra no
tenant plane com a policy da forma (2).

⚠️ `tb_vacinas` ainda não tem a coluna (a tabela está vazia, então o custo é zero agora).
Sem ela, "vacina cadastrada pela empresa" não tem onde ser marcada.

**O `UPDATE`/`DELETE` também precisa da regra**, e a forma (2) já entrega: o `USING` da
policy permite ler o global, mas o `WITH CHECK` exige `empresa_id = tenant` para gravar —
logo o tenant **não consegue alterar nem apagar linha global**, só a própria. Sem esse
detalhe, uma clínica editaria o medicamento do catálogo e a mudança apareceria em todas.

**Como a variável chega ao banco** — extensão do Prisma Client, ponto único:

```ts
prisma.$extends({
  query: { $allModels: { async $allOperations({ args, query }) {
    const empresaId = contexto.get('empresaId');          // AsyncLocalStorage
    if (empresaId == null) return query(args);            // control plane / job
    const [, resultado] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.empresa_id', ${String(empresaId)}, true)`,
      query(args),
    ]);
    return resultado;
  }}},
});
```

⚠️ **Custo:** uma ida a mais ao banco por operação, medível nas telas de lista. Mitigação
prevista para a fase 6, **com medição antes**: envolver a requisição inteira numa transação
interativa e setar a variável uma vez.

---

### 2.3 🔴 FASE 4 — a medição desmentiu D6 e D7 (2026-08-06)

Levantamento ao vivo por `backend/scripts/orfasTenancy.js` (**somente leitura**), depois
da fase 3. **A maioria das "órfãs" NÃO é sujeira: é `empresa_id` que ficou nulo em linha
com dono perfeitamente identificável pelos próprios registros filhos.** D6 e D7 mandavam
`DELETE` nos 5 animais e nas 10 faturas; executar aquilo destruiria histórico clínico real
e alteraria fatura viva.

**Animais** — empresa inferida pelos registros do próprio animal:

| id | nome | ativo | evidência | veredito |
|---|---|---|---|---|
| 1 | Administrador | sim | nenhum registro clínico; dono é o próprio admin | **APAGAR** |
| 55 | Kayser | sim | 4 evoluções + 6 grupos de prescrição + 9 itens de fatura — **todos da empresa 37** | **BACKFILL → 37** |
| 66 | Dudoca | sim | 7 agendamentos — **todos da 37** | **BACKFILL → 37** |
| 71 | Super Simples | não | 2 evoluções + 1 grupo + 5 agendamentos + 1 item — **todos da 52** | **BACKFILL → 52** |
| 73 | Fafa | não | nenhum registro | **APAGAR** |

⚠️ **Apagar o animal 55 tiraria R$ 600 da fatura 63 (empresa 37, ATRASADA, total R$ 1.000)** —
9 dos 12 itens presos aos "órfãos" estão em faturas VIVAS, de empresas identificadas.
Era um efeito colateral que a decisão D6 não previa, porque ninguém tinha olhado os filhos.

**Faturas** — empresa inferida pelos animais dos itens e, na falta, pelo veterinário:

| id | status | total | veredito |
|---|---|---:|---|
| 74 | ABERTA | 0 | **BACKFILL → 31** (5 itens, todos de animal da 31) |
| 76 | ABERTA | 0 | **BACKFILL → 52** |
| 80 | ABERTA | 10 | **BACKFILL → 52** |
| 78 | ABERTA | 0 | **BACKFILL → 52** (itens do animal 71; vet dos itens é da 52) |
| 48 | ATRASADA | 550 | provável **31** — item único, vet 113 pertence só à 31 |
| 47 | FECHADA | 525 | 🔴 **AMBÍGUA** — vets em 31 e 35 |
| 54 | FECHADA | 10 | 🔴 **AMBÍGUA** — vets em 31, 33, 35, 52 e 53 |
| 62 | FECHADA | 450 | **SEM PISTA** — 1 item "Assistência Mensal", sem vet e sem proprietário |
| 72 | ABERTA | 200 | **SEM PISTA** — idem; proprietário 120 está em 3 empresas |
| 58 | FECHADA | 0 | **VAZIA** — 0 itens, sem proprietário |

**Miudezas** — e um quase-acidente:

| Tabela | Linhas | Veredito |
|---|---:|---|
| `tb_estoque_clinica` | 2 | sem empresa (medicamentos 1423 e 2562, lote lt001) |
| `tb_lotes_vacina` | 1 | lote vazio (`''`), sem vacina — lixo de teste |
| `tb_midia_arquivos` | 1 | ⚠️ **NÃO APAGAR — é a MARCA DO PRODUTO** (`pasta='marca'`, `publico=true`), servida por `GET /api/marca` na tela de login. Ela é órfã **por construção** (CLAUDE.md §8): não pertence a tenant nenhum. Classificar como global, nunca como sujeira |

**Auditoria (D11):** 911 de 1.011 linhas sem empresa — 396 LOGOUT, 387 LOGIN, o resto
evolução/configuração. 254 nos últimos 7 dias, de 25 usuários.

### 2.4 ✅ FASE 4 EXECUTADA (2026-08-06) — decisão: apagar tudo

**O usuário optou por APAGAR TODAS as órfãs**, incluindo as 7 que a medição mostrou
recuperáveis por backfill. Fica o registro de que a alternativa existia e foi descartada
conscientemente — base 100% de teste. Script: `backend/scripts/fase4SanearOrfas.js`
(modo seco por padrão, `--apply` para executar, backup JSON antes de tocar em qualquer
linha, tudo numa transaction só).

| O que | Linhas |
|---|---:|
| itens das faturas órfãs (antes das faturas — `faturaId` é **RESTRICT**) | 32 |
| faturas órfãs | 10 |
| animais órfãos (+ 44 filhos clínicos em **CASCADE**, 12 tabelas) | 5 |
| estoque sem empresa · lote de vacina vazio | 2 · 1 |
| auditoria sem empresa (D11, policy (b)) | 911 |
| **2ª passada** — resíduos que nenhum CASCADE alcança | **3** |
| **Total** | **964** |

⚠️ **Correção a um risco que este documento superestimava.** A §2.3 alertava que apagar o
animal 55 tiraria R$ 600 da fatura 63. **Não tirou:** `tb_fatura_itens.animalId` e
`tb_faturas.animalId` são **`SET NULL`**, não `CASCADE` — o item sobrevive e só perde o
vínculo com o animal. Verificado depois: fatura 63 (empresa 37) segue com **R$ 1.000 e os
10 itens**. Antes de estimar impacto de `DELETE`, ler o `delete_rule` no
`information_schema` — o `ON DELETE` é que decide, não a intuição.

⚠️ **A 2ª passada não é detalhe: o DELETE cria órfã nova.** Duas categorias escapam do
CASCADE e, sem elas, o inventário voltaria a acusar órfãs logo depois de "terminar":
- `tb_midia_arquivos.animal_id` é **coluna solta, sem FK** (mesmo padrão de
  `AuditLog.animalId`) → 2 fotos ficaram apontando para animal inexistente;
- `tb_resenha_equino.animal_id` é **`SET NULL`** → 1 resenha virou ficha de ninguém.

✅ **PRESERVADO de propósito: `tb_midia_arquivos` id 11** — a MARCA DO PRODUTO
(`pasta='marca'`, `publico=true`), servida por `GET /api/marca` na tela de login. É órfã
**por construção** (CLAUDE.md §8): não pertence a tenant nenhum. Apagá-la quebraria o logo
do login sem ajudar em nada na migração. Entra como **global**, ao lado de
`tb_composicao_alimento` — nunca como sujeira.

**Estado final verificado:**

| Verificação | Resultado |
|---|---|
| `orfasTenancy.js` (todas as categorias) | **0** |
| animais / faturas sem empresa | 0 / 0 |
| itens de fatura órfãos (fatura inexistente) | 0 |
| marca do produto | preservada |
| suíte de testes | **92 passando** |

⚠️ **O `inventarioTenancy.js` ainda acusa 7 tabelas "SEM DONO" — é ARTEFATO DELE**, não
órfã real: o script segue **um** caminho de FK arbitrário (limitação da §2.2). Conferido
pelo caminho correto, **todas resolvem 100%**:

| Tabela | Caminho que o script seguiu | Caminho correto | Resolve |
|---|---|---|---|
| `tb_fatura_itens` (30) | `animalId` | `faturaId` → fatura | 65/65 |
| `tb_prescricoes` (54) | `orcamento_item_id` | `grupoId` / `animalId` | 59/59 |
| `tb_exames_clinicos` (6) | `evolucao_id` | `animalId` | 13/13 |
| `tb_vacinas_clinicas` (7) | `lote_id` | `animalId` | 8/8 |
| `tb_midia_arquivos` (1) | `empresa_id` | é a marca (global) | 9/9 |
| `tb_procedimentos_vet` (938) | `empresa_id` | catálogo MISTO (§4.1) | — |
| `tb_ai_usage_logs` (182) | `empresa_id` | legado pré-metering | — |

**Antes da fase 5**, `inventarioTenancy.js` precisa aprender o caminho de FK **explícito**
por tabela (o mesmo mapa que o backfill vai usar) — senão ele nunca chegará a "0 órfãs" e
deixará de servir como critério de aceite.

---

### 2.5 ✅ EXCLUSÃO LÓGICA — a regra que impede órfão de nascer (2026-08-06)

Decisão de produto, implementada em `backend/src/lib/visibilidade.js` (fonte única):

| Quem é inativado | O que a aplicação faz |
|---|---|
| **ANIMAL · PROPRIETÁRIO · EMPRESA** | **somem por completo** — nem como "inativo". E TUDO que pende deles some junto: evolução, prescrição, vacina, exame, agendamento, fatura, histórico. São o **sujeito** do atendimento |
| **PROFISSIONAL · FORNECEDOR · PRESTADOR** | **continuam aparecendo, marcados como INATIVOS**. São o **autor**: esconder o autor apagaria a autoria de prontuário que segue válido — "quem prescreveu isto?" precisa ter resposta |

**Por que isso encerra o problema de órfã:** enquanto o pai existir (só inativo), o filho
nunca perde a referência. Era o `DELETE` físico que produzia órfã, de duas formas medidas
nesta base: `ON DELETE SET NULL` (o filho passa a apontar para nada) e **coluna solta,
sem FK**, que nem o CASCADE alcança (`tb_midia_arquivos.animal_id`, `AuditLog.animalId`).

🔴 **Gerador de órfã nº 1 CORRIGIDO.** `ProprietarioController.removerDaEmpresa` fazia:
```js
data: { ativo: false, empresaId: null, equipeId: null }   // ← ANTES
data: { ativo: false }                                     // ← AGORA
```
Zerar a tenancy ao inativar transformava **cada animal do cliente removido** numa linha
sem dono — exatamente o que trava o `NOT NULL` da fase 5. **Inativar responde "aparece?";
a tenancy responde "de quem é?".** São perguntas diferentes, e a segunda não muda quando
a primeira muda. Foi assim que animais como o `Super Simples` (71) e o `Fafa` (73) viraram
órfãos.

**Onde a regra foi aplicada** (as listagens GLOBAIS — as que o usuário vê sem escolher um
paciente; as por `animalId` só se alcançam navegando a partir de uma lista que já filtra):

| Arquivo | O que faltava |
|---|---|
| `AnimalController.listar` | `animalVisivelNaEmpresa(req.empresaId)` — inclui o `ativo` POR EMPRESA do cliente (§36): inativado numa clínica, segue visível nas outras |
| `AgendamentoController.listarGlobal` | paciente inativado saía de Pacientes mas **continuava ocupando horário na agenda** |
| `PrescricaoGrupoController.listarParaExecucao` | tinha `animal.ativo`, faltava o cliente |
| `VacinaClinicaController.listarParaExecucao` | idem |
| `BuscaGlobalController` | um só ponto (`animalNoEscopo`) cobre os três grupos da busca |

⚠️ **`MembroEquipe`/`UsuarioEmpresa` NÃO entram nesses filtros — é deliberado.** Um teste
(`__tests__/visibilidade.test.js`) falha se algum filtro daqui mencionar
`membrosEquipe`, `veterinario`, `prestador` ou `membro`, e outro falha se aparecer
`empresaId: null` — para que a confusão entre "aparece?" e "de quem é?" não volte.

Já resolvidos em fases anteriores: **empresa** inativa bloqueia login e some do seletor
de contexto (D3, `EMPRESA_ATIVA_SQL`); **profissional** inativo já vinha na lista com a
flag `ativo`, sem filtro que o escondesse.

---

### 2.6 ✅ FASE 5 EXECUTADA (2026-08-06) — a invariante do tenant

Migration `20260806120000_fase5_tenant_not_null`, aplicada. **Sem RLS ainda**: aqui só se
estabelece a invariante de que o RLS vai depender — *toda linha de tabela de tenant
pertence a exatamente uma empresa*. Com `empresa_id` nulável, a policy
`empresa_id = current_setting(...)` deixaria a linha nula invisível para todos e editável
por ninguém — ou visível a todos, se alguém "consertasse" a policy com um `OR IS NULL`.

**Backfill: não houve — não havia o que preencher.** As fases 3 e 4 já tinham zerado as
órfãs, e o inventário corrigido confirmou 0 em todas as 24 tabelas de TENANT DIRETO.

**Parte 1 — `SET NULL` → `RESTRICT`** em `tb_animais`, `tb_estoque_clinica` e
`tb_lotes_vacina` (as três FKs para `tb_empresas` que ainda eram `SET NULL`). Combinadas
com o `NOT NULL`, elas produziriam um erro obscuro de constraint no dia em que alguém
apagasse uma empresa. `RESTRICT` diz a mesma coisa explicitamente e — o que importa —
**torna o órfão estruturalmente impossível**: é a regra de EXCLUSÃO LÓGICA (§2.5) escrita
no schema, não só na aplicação. `users.empresa_id` ficou de fora: control plane, coluna
legada.

**Parte 2 — `NOT NULL`** em 11 tabelas: `tb_animais`, `tb_agendamentos_clinicos`,
`tb_evolucoes_clinicas`, `tb_prescricao_grupos`, `tb_faturas`, `tb_tratadores`,
`tb_estoque_clinica`, `tb_lotes_vacina`, `tb_usuario_especialidades`,
`tb_resumo_atendimento_ia`, `tb_fatura_item_catalogo`.

⚠️ **Duas famílias ficaram FORA, e o motivo não é preguiça:**
- `tb_audit_logs` e `tb_ai_usage_logs` → o nulo é **evento de plataforma**. LOGIN/LOGOUT
  acontecem antes de haver empresa resolvida, e chamada de IA de ADMIN global não tem
  pagador. Forçar tenant ali inventaria dado. Ficam nuláveis com a policy (b) de D11 —
  `empresa_id = tenant`, **sem** `OR IS NULL` —, o que já os restringe ao ADMIN.
- `tb_medicamentos`, `tb_procedimentos_vet`, `tb_localizacoes_animal`, `tb_fornecedores`,
  `tb_midia_arquivos` → **catálogo misto**: o nulo é a linha GLOBAL, compartilhada.

**Parte 3 — índices tenant-first.** 39 já citavam a empresa; entraram 6 compostos
`(empresa_id, …)` nos caminhos mais quentes. A empresa passa a ser o primeiro predicado
de toda consulta (é o que a policy acrescenta), então precisa ser a primeira coluna.

**Prova executada contra o banco** — não é leitura de código:

| Tentativa | Resultado |
|---|---|
| inserir tratador **sem empresa** | ✅ recusado (`null value in column "empresa_id"`) |
| apagar empresa **que tem animal** | ✅ recusado (`RESTRICT`) |
| `inventarioTenancy.js` | ✅ **ZERO REGISTROS ÓRFÃOS** |
| `tsc --noEmit` · suíte | ✅ limpo · **101 testes** |

#### 🔴 Achado grave resolvido de passagem: o drift ia APAGAR a Memória Clínica

O §13.9 registrava "drift pré-existente" como bloqueio genérico. Medido, ele era 265
linhas — quase tudo cosmético (`DROP DEFAULT` em `updated_at`, rename de índice, FK com
nome fora da convenção do Prisma). **Mas duas linhas não eram:**

```sql
ALTER TABLE tb_resumo_atendimento_ia DROP COLUMN "dados", DROP COLUMN "versao_prompt";
```

As duas colunas existem no banco com **6/6 linhas preenchidas** e são lidas e gravadas por
`services/resumoAtendimentoService.js` — mas **faltavam no `schema.prisma`**. Um
`prisma migrate dev` descuidado apagaria a Memória Clínica inteira (highlights e tópicos
ancorados, §7 do CLAUDE.md) e o `versao_prompt` que dispara a reconstrução quando a versão
do prompt sobe. Declaradas no schema; o drift dessa tabela virou apenas cosmético.

⏳ **Sobrou uma decisão de schema (não bloqueia RLS):** `tb_tratadores` tem
`empresaId` **e** `empresa_id`. O primeiro está vazio (0/32) e sem leitor — duplicata
morta; `localTrabalho` idem (0/32, substituído por `localizacao_id`, 32/32). Dropar as
duas colunas **exige autorização**, como toda remoção.

---

### 2.7 ✅ FASE 6 EXECUTADA (2026-08-06) — RLS canário, com prova

Migration `20260806140000_fase6_rls_canario`. **Isolamento provado contra o banco**, não
por inspeção de código.

**Canária: `tb_movimentos_estoque`** — 32 linhas, 4 empresas. Escolhida de propósito por
ser **TENANT VIA PAI** (não tem `empresa_id`, herda de `tb_estoque_clinica`): é o caso
DIFÍCIL, que exige subconsulta na policy, e são **32 das 90 tabelas** nessa situação.
Provar o caso fácil não diria nada sobre elas.

🔴 **`FORCE ROW LEVEL SECURITY` é a linha que faz o RLS existir aqui.** O `ENABLE` sozinho
**não se aplica ao dono da tabela**, e a aplicação conecta como `nutriadmin`, que é
exatamente o dono. Sem o `FORCE`, tudo estaria criado e **nada filtraria** — o pior
resultado possível: a aparência de isolamento sem o isolamento.

**A prova:**

| Verificação | Resultado |
|---|---|
| leitura com tenant 31 / 35 / 42 / 33 | ✅ vê 16 / 10 / 4 / 2 — exatamente as suas |
| `INSERT` no estoque de outra empresa | ✅ recusado pelo `WITH CHECK` |
| `UPDATE` em linha de outra empresa | ✅ 0 linhas afetadas |
| tenant vaza para a transação seguinte? | ✅ **não** (`set_config(..., true)`) |
| `ENABLE` + `FORCE` + policy com `USING` e `WITH CHECK` | ✅ |

`WITH CHECK` além de `USING` não é redundância: `USING` filtra o que se LÊ, `WITH CHECK`
valida o que se ESCREVE. Sem ele, uma clínica INSERIA movimento no estoque de outra — leria
de volta vazio, mas a linha estaria lá contaminando o saldo alheio.

#### `lib/tenantDb.js` — por que NÃO é a extensão `$allModels` do §4

O desenho original (envolver **cada operação** em `$transaction([set_config, query])`)
não funciona, e §13.1/13.2 já diziam por quê. A implementação seguiu a correção:
**intercepta o INÍCIO da transação, não cada operação.** `comTenant(empresaId, fn)` abre
UMA transação, roda `set_config` UMA vez e entrega o `tx` — tudo que usar aquele `tx`
(model, raw, aninhado) está coberto, porque é a MESMA conexão. Isso resolve os dois
bloqueios de uma vez: sem transação aninhada (77 `$transaction` em 20 arquivos) e com o
SQL cru coberto (98 chamadas em 23 arquivos).

⚠️ É **explícito de propósito**, não mágico. Uma extensão que às vezes cobre e às vezes
não é pior do que nenhuma: dá a sensação de proteção sem a proteção.

⚠️ **O `true` do `set_config(..., true)` é a linha mais perigosa do arquivo.** Ele torna a
variável local à TRANSAÇÃO. Sem ele a variável fica na SESSÃO e, como o Prisma usa POOL, a
conexão volta ao pool com o tenant da requisição anterior grudado — a próxima requisição,
de outra clínica, o herdaria. É o vazamento mais silencioso que este desenho permite, e há
um teste dedicado a ele (nº 6).

#### 🔴 A role `zls2vetp1` NÃO foi criada — e isso é higiene, não pendência

A migration falhou na primeira tentativa: **`nutriadmin` não tem `CREATEROLE`**. Correto —
o usuário da aplicação não deve poder criar papéis. Criar role é ato de OPERAÇÃO, com
superusuário. A canária não depende dela (quem faz o RLS valer para o dono é o `FORCE`);
a role é o destino da fase 7, quando a aplicação passar a conectar sem ser dona de nada.
O SQL exato está comentado no topo da migration. Duas regras: a senha nunca entra em
migration versionada, e a role **precisa** de `NOBYPASSRLS` — com `BYPASSRLS` ela ignora
todas as policies e transforma a fase 7 em decoração.

#### ⏳ O que a FASE 7 precisa resolver

1. **Remover o escape.** A policy hoje PERMITE quando `app.empresa_id` não está setado —
   necessário porque cron, ADMIN e as 98 chamadas de SQL cru fora de `comTenant` ainda não
   o setam; sem o escape, ligar o RLS devolveria zero linha e quebraria a farmácia.
   **Enquanto ele existir, o RLS protege quem passa por `comTenant` e mais ninguém.**
   O teste nº 7 de `rlsCanario.test.js` documenta o escape e passa a FALHAR quando ele for
   removido — é esse o sinal de troca da asserção.
2. **Instrumentar os caminhos**: fazer as rotas usarem `comTenantDoRequest(req, …)`.
3. **Decidir o padrão das 32 tabelas VIA PAI**: subconsulta na policy (como a canária) ou
   `empresa_id` denormalizado. A subconsulta funciona, mas quando o PAI também tiver RLS
   ela roda com as policies do pai aplicadas — avaliar `SECURITY DEFINER` ou denormalizar.

---

### 2.8 🔨 FASE 7 (parte A) — RLS em 57 tabelas, e dois defeitos que só a medição achou

Migrations `20260806180000_fase7_rls_geral` e `20260806190000_fase7_fix_...`, aplicadas.
**57 de 91 tabelas com `ENABLE` + `FORCE` + policy.** As 34 restantes ficam fora por
decisão (control plane + catálogo global).

⚠️ **Isto NÃO mudou comportamento, e é deliberado.** Toda policy carrega o escape
`app_empresa_id() IS NULL OR …`, e nenhuma rota seta a variável ainda. O banco está
**armado e desprotegido ao mesmo tempo** — não confundir "RLS ligado" com "isolado".
Ligar 57 policies e instrumentar as rotas no mesmo passo tornaria impossível saber qual
dos dois quebrou o quê.

**Fonte única:** o mapa saiu de dentro do `inventarioTenancy.js` e virou
`src/lib/tenancyMap.js`, consumido pelo inventário E pelo `scripts/gerarPoliciesRls.js`.
Duas cópias divergiriam na primeira correção — e divergir aqui significa tabela sem
policy sem ninguém perceber.

#### 🔴 Defeito 1 — `OR` entre caminhos numa policy é vazamento

`tb_prescricoes` declara dois caminhos (`grupoId`, `animalId`) e o gerador emitiu
`caminho1 OR caminho2`. **As duas leituras do mapa têm semânticas OPOSTAS:** para
DETECTAR ÓRFÃ, `OR` está certo ("tem dono se qualquer rota resolver"); numa POLICY
significa "visível se qualquer rota casar" — e quando os pais discordam, a linha aparece
para DUAS empresas.

Como apareceu: somando as linhas visíveis por tenant, `tb_prescricoes` deu **61 numa
tabela de 59**. São as prescrições 83 e 84, cujo GRUPO é da empresa 35 e cujo ANIMAL é da
31 (legado do tratamento entre clínicas, encerrado na fase 3). **Nenhuma consulta falha e
nada dá erro** — sem a conferência de partição, passaria. A policy passa a usar só o
caminho AUTORITATIVO (o grupo), e o gerador agora AVISA quando há mais de um.

#### 🔴 Defeito 2 — o inventário só olhava `IS NULL`, e havia 28 órfãs

A soma por tenant não fechava em `tb_faturas` (25 total, 22 visíveis). Causa: **3 faturas
apontam para a empresa 37, que NÃO EXISTE**. Há uma segunda forma de ser órfã que o
inventário não perguntava — `empresa_id` PREENCHIDO apontando para empresa apagada. Ela
só ocorre em tabela **sem FK** para `tb_empresas`. Varredura completa:

| Tabela | Linhas apontando p/ a empresa fantasma **37** |
|---|---:|
| `tb_ai_usage_logs` | 10 |
| `tb_audit_logs` | 8 |
| `tb_tratadores` | 4 (Rogerinho, João Carlos, Cacá, Teste — todos `ativo`) |
| `tb_faturas` | 3 (R$ 250 · R$ 1.150 · R$ 1.000, com 20 itens) |
| `tb_fornecedores` | 3 (Marina Fisioterapia, Drogaria Bezerra, Mari Pegasus) |

Sob RLS elas ficam **invisíveis para todo tenant** — não existe empresa com aquele id
para casar. O `RESTRICT` da fase 5 não as teria impedido: ele cobriu as 3 tabelas que
TINHAM FK; estas cinco não têm nenhuma.

⏳ **Decisão pendente** (exige autorização): apagar as 28 linhas e criar as FKs faltantes
com `RESTRICT` em `tb_faturas`, `tb_fornecedores` e `tb_tratadores`.
`tb_audit_logs`/`tb_ai_usage_logs` são caso à parte — a ausência de FK ali é DECISÃO
documentada ("o log sobrevive à exclusão da empresa", CLAUDE.md §5).

#### ✅ Partição exata verificada

| Tabela | Total | Soma por tenant | |
|---|---:|---:|---|
| `tb_animais` · `tb_evolucoes_clinicas` · `tb_prescricoes` · `tb_exames_clinicos` · `tb_movimentos_estoque` · `tb_vacinas_clinicas` · `tb_agendamentos_clinicos` | — | = total | ✅ partição exata |
| `tb_faturas` / `tb_fatura_itens` | 25 / 65 | 22 / 45 | 🔴 diferença = as órfãs da empresa 37 |

### 2.9 ✅ CRONS NO PADRÃO POR EMPRESA — e por que não precisam de bypass

**"Global" e "cross-tenant" não são a mesma coisa.** O fechamento de fatura é global no
AGENDAMENTO (roda uma vez, para todo mundo) e por empresa na EXECUÇÃO: cada fatura
pertence a uma clínica. Ele nunca precisa ver as faturas de A e de B na mesma consulta.

E o código já era assim, ao contrário: `fecharFaturasDoMes` varria TODAS as faturas e
resolvia `resolverConfigsFechamento(...)` DENTRO do laço, uma vez por fatura;
`marcarFaturasAtrasadas` chamava `diaVencimentoDoProprietario(prop, empresaId)` por
fatura. A regra de fechamento, o dia de vencimento e a validade do orçamento **sempre
foram por empresa**. Global era só o laço.

`lib/cronTenant.js#paraCadaEmpresa` inverte: percorre as EMPRESAS ATIVAS e roda o
trabalho dentro de cada uma, com o tenant carimbado.

| Cron | Como ficou |
|---|---|
| fechamento de faturas · marcação de atraso · lembrete D-1 | laço por empresa em `server.ts` |
| lembrete WhatsApp · cancelar agendamentos · marcar atrasados · cancelar prescrições | service recebe o `db` da transação |
| cancelar orçamentos vencidos | **já iterava por empresa** — só faltava carimbar o tenant |
| `crmv_sync` · `limpeza_desafios_2fa` | inalterados: tocam só control plane/catálogo global, **tabelas sem RLS** |

⚠️ **Correção:** eu havia dito "7 crons"; são **8**. Dos 10, apenas 2 ficam de fora.

**Nenhum precisa de escopo de plataforma.** O que eu apresentei antes como "ADMIN e
crons precisam ver tudo" estava errado quanto aos crons — eles precisam *percorrer* as
empresas, que é outra coisa. `tb_empresas` é control plane (sem RLS), então listar as
clínicas nunca exigiu privilégio.

**O que se ganha, além do RLS continuar valendo:**
- **Isolamento de falha** — antes uma exceção derrubava o lote inteiro; agora a clínica
  A falhar não impede a B de fechar.
- **Auditoria correta** — cada escrita sob um tenant declarado nasce com o `empresa_id`
  certo, em vez do `null` que produziu as órfãs da §2.8.
- **Menos consultas**, não mais: a config é resolvida uma vez por EMPRESA, não por fatura.

⚠️ **`prescricaoCronService` perdeu a `$transaction` interna** — o cron já roda dentro de
uma, e o Prisma não suporta aninhamento (§13.1): a interna abriria outra conexão, sem o
`set_config`, e o RLS devolveria zero linha (ou travaria em deadlock). Efeito colateral
aceito: a atomicidade passou de POR GRUPO para POR EMPRESA. Para uma limpeza noturna é
preferível ao estado anterior, em que metade dos grupos ficava aplicada.

**Prova executada:** 12 empresas percorridas, tenant conferido dentro de cada transação
(`current_setting('app.empresa_id')` == id da empresa), e a soma das faturas vistas pelo
cron **bate com o total real** — nenhuma ficou de fora. 0 falhas.

### 2.10 ✅ FASE 7b — o tenant chega ao banco sem tocar em 60 controllers

**Não foi um middleware que envolve a requisição — e a medição é que decidiu isso.**
9 dos 60 controllers fazem I/O EXTERNO dentro do handler (11 chamadas de IA, 13 envios
de e-mail). Uma chamada ao Gemini leva de 5 a 30 s; a transação ficaria aberta o tempo
todo, segurando conexão do pool. **Transação envolve trabalho de BANCO, nunca a
requisição inteira.**

O desenho: `AsyncLocalStorage` guarda o tenant da requisição (posto no fim do
`authenticate`, único ponto onde `req.empresaId` acaba de ser resolvido) e uma extensão
do Prisma (`lib/prismaTenant.js`) carimba `app.empresa_id` em cada operação. Os
controllers seguem escrevendo `prisma.animal.findMany(...)` — nenhum precisou mudar.

**Três medições que corrigem o §13 do plano:**

| Afirmação do §13 | O que foi medido |
|---|---|
| "extensão de `$allModels` **não alcança** raw query" (§13.2) | ❌ **Alcança.** `$allOperations` intercepta `$queryRawUnsafe`/`$executeRawUnsafe` (chegam com `model: undefined`). As 98 chamadas passam por lá |
| "envolver cada operação aninharia transação" (§13.1) | ✅ Confirmado: a extensão **propaga para dentro de `$transaction``**. Resolvido com a flag `emTransacao` no ALS |
| — | `$transaction` é interceptado pelo componente `client`, carimbando o tenant UMA vez no início |

#### 🔴 Duas armadilhas que só apareceram medindo — as duas silenciosas

**1. `query(args)` executa no client ORIGINAL.** Dentro de `$allOperations`, chamar
`query(args)` roda a operação no client de origem, que pega **outra conexão do pool**: o
`set_config` ia para uma e a consulta para outra. Resultado medido: empresas 31 e 42
viam **29 linhas cada** — o total do banco. Nenhum erro, nenhum aviso. A operação
precisa ser **REEMITIDA no `tx`** (`tx[modelo][operacao](args)`).

**2. `PrismaPromise` é PREGUIÇOSA.** Com o callback de `comEmpresa` síncrono
(`contexto.run(store, () => db.animal.count())`), o `run` devolvia a promise **ainda não
iniciada**, o contexto do ALS saía de escopo, e só então a consulta rodava — sem tenant.
O `$transaction` e o SQL cru isolavam certo, e só a operação de modelo vazava: o tipo de
falha mais difícil de notar. Corrigido com `async () => fn()`.

Nos dois casos o sintoma era **a aparência de isolamento sem o isolamento**.

**Prova (`__tests__/prismaTenant.test.js`, 8 testes):** operação de modelo, SQL cru,
`$transaction` e consulta com `include` — todas isolam por empresa; e a asserção central
é **partição exata** (a soma do que cada empresa enxerga = o total da tabela). Foi ela
que pegou as duas armadilhas: com qualquer uma presente, a soma dava **232 numa tabela
de 29**.

**Servidor validado de pé:** sobe limpo, `/health` com banco em 2 ms, 10 crons agendados,
zero erros no boot.

⚠️ `lib/tenantDb.js` e `lib/cronTenant.js` usam `prismaSemTenant` (o client **sem** a
extensão): eles gerenciam transação e `set_config` à mão, e o estendido empilharia os
dois mecanismos.

### 2.11 ✅ FASE 7c — O ESCAPE SAIU. FASE 7 FECHADA.

Migrations `20260806220000_fase7c_remove_escape_rls` e `…230000_remove_policy_orfa`.

**A inversão que fecha a fase:**

```
ANTES:  contexto ausente → PERMITE tudo   (app_empresa_id() IS NULL OR …)
AGORA:  contexto ausente → NEGA tudo      (fail-closed)
```

Restaram **dois caminhos, ambos EXPLÍCITOS**: `comEmpresa(empresaId, …)` (toda
requisição, pelo `authenticate`; e os 8 crons por `paraCadaEmpresa`) e
`comEscopoPlataforma(…)` — o ÚNICO que atravessa clínicas, atrás de gate de ADMIN.
Quem esquecer de declarar escopo **quebra alto**, em vez de vazar calado.

**`app_plataforma()` e não `BYPASSRLS`:** uma role com `BYPASSRLS` ignora todas as
policies o tempo todo, e o sintoma de concedê-la por engano é NENHUM. A GUC é ligada por
transação, por um caminho com nome, e morre no COMMIT.

#### Teste de invasão — com a aplicação conectada como `zls2vetp1`

| | |
|---|---|
| sem contexto (modelo e SQL cru) | ✅ **0 linhas** |
| por tenant | ✅ partição exata (8+3+1+4+1+6+3+3 = 29) |
| escopo de plataforma | ✅ 29 (vê tudo) |
| `UPDATE` em massa sem `WHERE` pela empresa 42 | ✅ atingiu **só os 6 animais dela** |
| a role consegue `DISABLE ROW LEVEL SECURITY`? | ✅ **não** (não é dona) |
| a role consegue `TRUNCATE`? | ✅ **não** |
| servidor de pé como `zls2vetp1` | ✅ `/health` ok, banco 2 ms, 0 erros |

`DATABASE_URL` agora é `zls2vetp1`; `DATABASE_URL_MIGRATIONS` guarda o `nutriadmin`
(dono) para as migrations. **É essa separação que protege**: a aplicação não pode
desligar o RLS que a limita.

#### 🔴 Achado: policy órfã afrouxando o isolamento em silêncio

`tb_movimentos_estoque` tinha **DUAS** policies — a da fase 6 (`tenant_movimentos_estoque`,
escrita à mão, **com o escape**) e a da 7c (`tenant_tb_movimentos_estoque`, gerada, sem).
⚠️ **O PostgreSQL combina policies permissivas com `OR`**: bastava a antiga permitir. A
policy nova e restritiva era simplesmente ignorada.

Causa: os nomes divergem — o gerador emite `tenant_<tabela>` (com `tb_`), e o
`DROP POLICY IF EXISTS` dele só alcança esse nome. Quem pegou foi o **teste 7 do
`rlsCanario.test.js`**, escrito na fase 6 prevendo a própria obsolescência ("quando o
escape sair, ESTE TESTE PASSA A FALHAR") — e reescrito na 7c para exigir 0 linhas.
Devolveu 32.

**Lição:** `DROP POLICY IF EXISTS` só protege contra o nome que conhece. Policy órfã não
dá erro e não aparece em teste de rota. Conferir `pg_policies` por tabela: **mais de uma
linha por tabela é sinal de alerta, não de reforço.** Estado atual: 57 policies, 57
tabelas, **0 com escape, 0 duplicadas**.

#### Efeitos colaterais do fail-closed, e o que foi feito

| O que quebrou | Correção |
|---|---|
| **Scripts de manutenção** liam ZERO (o `FORCE` alcança o dono). O inventário chegou a acusar "32 de 32 órfãs" em `tb_movimentos_estoque` porque o `LEFT JOIN` no pai voltava vazio | `inventarioTenancy`, `orfasTenancy` e `fase4SanearOrfas` passaram a rodar em `comEscopoPlataforma` — manutenção lê a base inteira por definição |
| **Baselines dos testes** comparavam tudo contra zero (verde sem provar nada) | idem |
| **Auditoria de login** gravava `empresaId: null` → linha invisível para todos, inclusive o gestor da clínica onde o login ocorreu | `registrarAcesso` passou a carimbar `req.empresaId`. É o que o §10.6 prometeu ao rejeitar a opção (c). ADMIN de plataforma segue nulo — é evento de plataforma |

⚠️ **Pré-requisito do 7c que se mostrou menor do que eu previa:** só **duas** tabelas de
ADMIN têm RLS (`tb_ai_usage_logs` e `tb_assinaturas_empresa`). Monitoração, planos e a
lista de empresas são control plane e nem passam por policy. O escopo de plataforma não é
um bypass geral — é uma chave para dois relatórios.

### 2.12 🔎 AVALIAÇÃO PÓS-FASE 7 — o que o fail-closed quebrou (e o que não)

Varredura feita ANTES de abrir a fase 8, porque o fail-closed muda o comportamento de
todo caminho que não declara escopo.

**✅ Não quebrou** (verificado consultando o banco, não lendo código):

| Superfície | Resultado |
|---|---|
| **Marca do produto** na tela de login (antes de existir sessão) | ✅ visível — a policy MISTA de `tb_midia_arquivos` cobre `publico = true` |
| **Catálogos globais** em dropdown, sem contexto | ✅ 4.876 medicamentos · 938 procedimentos · 5.192 localizações |
| **Control plane** que o login lê antes do tenant | ✅ `users`, `tb_usuario_empresa`, `tb_empresas`, `tb_planos` intactos |
| **Rotas sem `authenticate`** | ✅ nenhuma toca tabela de tenant — as 3 suspeitas eram falso positivo de grep (o middleware está na linha seguinte, em definição multi-linha) |

**🔴 Quebrou — encontrado e corrigido:**

`GET /api/ai-usage/*` devolvia **0 de 26 registros** para o ADMIN. O controller retorna
`{}` (sem filtro) quando o usuário é ADMIN, contando com a ausência de filtro — que o RLS
agora fecha. Mesmo problema em `PUT /empresas/:id/assinatura`: o ADMIN grava a assinatura
de OUTRA empresa e o `WITH CHECK` recusaria.

Correção: `middlewares/escopoPlataforma.js`, nas 8 rotas de `/ai-usage` e na de assinatura.
⚠️ Ele **checa o papel em runtime** (`role`/`userTypeGlobal`, nunca o `userType` do
contexto — armadilha 36-e): montado por engano num router aberto, ainda assim só o ADMIN
da plataforma entra em escopo de plataforma.

**⚡ Custo do RLS — a preocupação do §13.3 não se confirmou:**

| Consulta | ms |
|---|---:|
| `tb_movimentos_estoque` (VIA PAI, **subconsulta**) | **5** |
| `tb_prescricoes` (VIA PAI) | 8 |
| `tb_fatura_itens` (VIA PAI) | 9 |
| `tb_medicamentos` (MISTO, 4.878 linhas) | 13 |
| agenda do dia com 2 `include` | 23 |

A subconsulta das 29 tabelas VIA PAI é a **mais rápida** da amostra — os índices
tenant-first da fase 5 e o `EXISTS` (que para no primeiro match) resolvem. Nada a otimizar.

---

## 3. 🛑 FASE 8 — RECOMENDAÇÃO: NÃO EXECUTAR COMO ESTÁ

O plano previa "remoção incremental dos 431 filtros manuais". **Com o RLS já no ar, essa
é a fase de menor valor e maior risco do projeto.**

| | |
|---|---|
| Ganho funcional | nenhum — o usuário não vê diferença |
| Ganho de desempenho | nenhum mensurável: as consultas estão em 5–23 ms |
| Risco | alto: ~431 alterações em 60 controllers, cada uma capaz de mudar em silêncio o que uma tela lista |
| O que se PERDE | **defesa em profundidade.** Hoje há duas camadas: o filtro da aplicação e a policy. Se uma policy for reescrita errada, esquecida numa tabela nova, ou desligada numa manutenção, é o filtro da aplicação que ainda segura |

O próprio plano os classificava como "redundantes, **não urgentes**". Redundância em
controle de acesso não é dívida técnica — é projeto.

**O que vale fazer no lugar, em ordem de valor:**

1. **Exercitar a aplicação de verdade.** `/health` e teste de unidade não cobrem o que
   mais preocupa: a tela que dependia de ler sem contexto. As duas correções acima saíram
   de varredura dirigida; um passe manual pelas telas principais (agenda, plantão,
   faturamento, prontuário, relatórios) fecharia o resto.
2. **Ligar o gate de RLS na CI** — `tenancyRls.test.js` já falha quando uma tabela nova
   fica sem classificação, mas o pipeline precisa de banco (§13.5).
3. **Remover filtro manual APENAS onde ele estiver ERRADO**, não por ser redundante.
   Exemplo real: os resquícios da regra base × convidado, que davam leitura cross-tenant
   deliberada e a fase 3 derrubou.

---

## 5. Modelo de dados novo

### 5.1 Cadastro da empresa

`tb_empresas` hoje tem 6 campos (nome, cnpj, telefone, endereco, ownerId, timestamps).
Vira o cadastro do assinante:

| Campo | Observação |
|---|---|
| `razaoSocial`, `nomeFantasia` | hoje há só `nome` |
| `documento` + `tipoDocumento` | CNPJ ou CPF (a "empresa pessoal" já existe no modelo) |
| `inscricaoEstadual`, `crmvResponsavel` | opcionais |
| `emailContato`, `telefone`, `whatsapp` | ⚠️ `whatsapp` já existe em `EmpresaConfiguracao` (D4) |
| `cep`, `endereco`, `numero`, `complemento`, `bairro`, `cidade`, `estado` | hoje é um texto só |
| `status` | `ATIVA \| SUSPENSA \| CANCELADA` |
| `criadoEm`, `canceladoEm` | |

`EmpresaConfiguracao` (logo, fechamento, expediente, espécies) **não se mistura**: é
preferência operacional, não identidade do assinante.

### 5.2 Plano e assinatura

```
tb_planos                     (control plane, global)
  slug · nome · limiteUsuarios · limiteAnimais? · precoMensal · ativo

tb_assinaturas_empresa        (control plane, 1 por empresa)
  empresaId @unique · planoId · status (TRIAL|ATIVA|INADIMPLENTE|CANCELADA)
  inicioEm · fimEm? · limiteUsuariosOverride?    ← negociação pontual sem plano novo
```

`IaPlanoEmpresa` (cota de IA) continua separado: é medição de consumo, não comercial.

### 5.3 Limite de usuários

A base já existe: `UsuarioEmpresa.acessoSistema` está no schema descrito como *"Base do
futuro controle de usuários por plano"*.

```
assento := UsuarioEmpresa WHERE empresaId = X
                            AND acessoSistema = true
                            AND ativo = true
                            AND perfil <> 'PROPRIETARIO'     ← decisão D2
```

Verificação nos **quatro** pontos (senão vaza por um deles):
`incluirMembroDireto` · `adicionarMembro` · **aceite de convite** (o convite pode ter sido
enviado com vaga e aceito sem) · **religar `acessoSistema`** de um membro existente.

Estourou → **409 `LIMITE_USUARIOS_PLANO`**, dizendo limite, uso atual e caminho de saída.

---

## 6. Fim dos vínculos e aprovações

Some `VetAnimalSolicitacao` e tudo que orbita nele.

**Backend (9 arquivos):** `AnimalController` (`criarSolicitacaoPendente`,
`proprietarioAprovar`, `responderSolicitacaoVet`, `minhasSolicitacoes`,
`cancelarSolicitacao`, `vincularVet`, `desvincularVet`) · `VeterinarioController`
(`solicitarVinculo`, `solicitarVinculoVet`, `listarSolicitacoes`, `responderSolicitacao`,
`responderViaEmail`, `listarPendentes`) · `lib/animalAccess.js` · `lib/animalScope.js` ·
`permissao.middleware.js` · `routes/veterinarios.js` · `server.ts` · `emailService.js`
(5 templates).

**Crons que morrem junto:** `auto_aceite` e `vinculos_provisorios` (12 → 10).

**Rota pública que morre junto:** `POST /api/animais/proprietario/aprovar`.

**Frontend:** `AprovarVinculo.tsx`, `AprovarVinculoProprietario.tsx` (2 rotas públicas),
`VetNotificationModal`, `useProprietarioNotificacoes`, `useVetSolicitacaoMonitor`,
`useVetPendentes` (o sino e o badge ficam sem fonte), `SolicitacaoCard` (inline em
`VetDashboard` e `AnimaisVet`), badges em `AnimalCard`/`MeusAnimais`, seleção de vet em
`Animal.tsx`.

**O que ocupa o lugar:** `buildAnimalScopeWhere` e `verificarAcessoAnimal` deixam de
consultar solicitação e viram "o animal é desta empresa?". É aqui que a migração **paga**:
são hoje as funções mais delicadas do sistema (a armadilha 36-e do CLAUDE.md documenta os
403 em cascata que elas já causaram).

**Campos legados:** `Animal.veterinarioNome` / `veterinarioClinica` — manter como histórico
e parar de escrever.

### 6.1 Estado da fase 3 (checkpoint de 2026-08-05)

⚠️ **ATUALIZADO em 2026-08-06:** a fase começou sem tocar a base, e a tabela só foi
removida na terceira leva, **com autorização explícita** (ver o bloco de remoções abaixo).
Tudo que é código continua revertível por `git revert`; o `DROP TABLE` não — a cópia das
32 linhas ficou guardada fora do repositório.

**✅ FEITO — o núcleo da regra de acesso:**

| Arquivo | O que mudou |
|---|---|
| `lib/animalAccess.js` | removido o ramo final que liberava o animal ao vet com vínculo **independente de empresa** — era ele que deixava abrir pela URL o paciente de outra clínica. Agora a pergunta é só "o animal é desta empresa?" |
| `lib/animalScope.js` | removida a regra **base × convidado** (`vetSolicitacoesWhere` / `vetVinculoNaEmpresa`) — a leitura cross-tenant intencional da §5 deixou de existir |
| `FaturaController.listarProprietarios` | os clientes vinham também dos vínculos, trazendo cliente de animal de QUALQUER empresa para o faturamento desta |
| `server.ts` | removidos os crons `auto_aceite` e `vinculos_provisorios` (12 → **10 jobs**) |
| `routes/animais.js`, `routes/veterinarios.js` | removidas as 12 rotas de vínculo, incluindo a pública `POST /animais/proprietario/aprovar` |
| Frontend | apagados `AprovarVinculo`, `AprovarVinculoProprietario`, `VetNotificationModal`, `useProprietarioNotificacoes`, `useVetSolicitacaoMonitor`; limpos `App.tsx`, `Sidebar`, `AnimaisVet` e `VetDashboard` (cards de solicitação, modal de desvincular e o "Buscar Paciente" que pedia vínculo a paciente de outra clínica) |

**✅ FEITO — segunda leva (mesma sessão): frontend, escrita e código morto**

| Arquivo | O que mudou |
|---|---|
| `hooks/useVetPendentes.ts` | **apagado** (3º hook de polling de vínculo). Com ele saiu o **sino do `AppHeader`**: a única coisa que notificava eram solicitações, e botão sem fonte só teria um estado ("Nenhuma notificação nova.") — cromo morto. Saiu também o badge de "Pacientes" na `Sidebar` |
| `pages/MeusAnimais.tsx` | reescrita: fora `Solicitacao`, os selos Pendente/Remoção/Troca, o banner de aguardo, o cartão acinzentado e os botões Autorizar/Recusar/Aceitar remoção/Manter vínculo. O cartão ficava **bloqueado** enquanto pendente; agora todo animal da lista é operável |
| `components/AnimalCard.tsx` | fora a resolução do vet por `VetAnimalSolicitacao` e o selo âmbar pulsante. O responsável é o campo `veterinarioNome` do próprio animal |
| `pages/Animal.tsx` | removida a seção **"Veterinário Responsável"** (só aparecia para o PROPRIETÁRIO): escolher um vet ali criava vínculo e **movia o animal para a empresa dele** |
| `AnimalController.buscarPorNome` | `temVet` + `vetDaMinhaEquipe` → **`jaCadastradoAqui`**. Perguntavam pela PESSOA responsável; quem responde por um paciente é a CLÍNICA. Efeito colateral corrigido: animal DESTA empresa sem vet designado voltava como "sem_vet" e era **duplicado** por quem o cadastrasse de novo |
| `AnimalController.criar` | removido o ramo `animalExistenteId`/`pedirAutorizacao` (criava solicitação, marcava `bloqueado: AGUARDANDO_APROVACAO`, mandava e-mail) e **todo `VetAnimalSolicitacao` que nascia no cadastro** — o animal já é criado com `empresaId`/`equipeId`; o vínculo só duplicava isso numa segunda tabela |
| `AnimalController.atualizar` | removida a máquina de **troca de vet**: `vetMudou` (movia o animal para a empresa do vet escolhido) e `vetRemovido` (criava DESVINCULO PENDENTE com token de 24h e e-mail pedindo que o vet aceitasse perder o acesso) |
| `ANIMAL_INCLUDE` | `solicitacoes` saiu do include — vinha em **toda** leitura de animal |
| `VeterinarioController.meusAnimais` | ⚠️ **vazamento vivo encontrado aqui**: a rota tinha a SUA PRÓPRIA cópia da regra base × convidado, com `{ solicitacoes: { some: { vetUserId, status:'ACEITO' } } }` **fora** do filtro de empresa. Passou a usar a fonte única `buildAnimalScopeWhere`, e a rota ganhou `checkPermission('animais.ler')` (é ele que popula `req.membroCargo`) |
| Métodos órfãos | removidos de `AnimalController` (`proprietarioAprovar`, `minhasSolicitacoes`, `vincularVet`, `desvincularVet`, `cancelarSolicitacao`, `responderSolicitacaoVet`) e de `VeterinarioController` (`solicitarVinculo`, `solicitarVinculoVet`, `listarSolicitacoes`, `listarPendentes`, `responderSolicitacao`, `responderViaEmail`), mais os helpers `criarSolicitacaoPendente`, `vincularVetDireto`, `podeReceberSolicitacoes`, `gerarToken`/`gerarExpiracao` |
| `pages/AnimalView.tsx` | removida a ação **"Desvincular paciente"**, que chamava rota morta. ⚠️ Esta página **não está roteada em lugar nenhum** — é órfã; ver pendência 2 |

**Verificado após a segunda leva:** `tsc --noEmit` limpo, `vite build` conclui,
**92 testes passando**. Saldo: **−3997 / +734 linhas**.

**✅ FEITO — terceira leva (autorizada em 2026-08-06): as remoções**

| O que | Detalhe |
|---|---|
| **8 templates de e-mail** | `enviarSolicitacaoVinculo`, `enviarSolicitacaoVinculoProprietario`, `enviarConfirmacaoVinculo`, `enviarSolicitacaoDesvinculo`, `enviarSolicitacaoDesvinculoProprietario`, `enviarSolicitacaoTrocaVet`, `enviarNotificacaoProprietario`, `enviarNotificacaoTrocaVet`. Eram **8, não 6** — os dois últimos também estavam órfãos. Montavam links `/#/veterinarios/solicitacoes/aprovar?token=…`. **Ficam** `enviarVinculoInformativo` e `enviarBoasVindasProprietario`: informam, não pedem aprovação |
| **`pages/AnimalView.tsx`** | apagada — página órfã, sem nenhum import no projeto |
| **`tb_vet_animal_solicitacoes`** | **REMOVIDA** — migration `20260806000000_remove_vinculos_vet_animal`, aplicada. Antes do DROP: **nenhuma FK apontava para ela** (nada ficou órfão) e as 32 linhas foram copiadas para fora do repositório. `tb_designacoes_prestador` preservada (1 designação ativa) — é concessão do gestor DENTRO da empresa, não vínculo entre partes |
| `schema.prisma` | removido o model `VetAnimalSolicitacao` e as 3 relações que o citavam (`User.vetSolicitacoes`, `User.novasVetSolicitacoes`, `Animal.solicitacoes`) |

⚠️ **O gate de CI pegou a divergência sozinho.** Assim que o DROP rodou, o teste 3 de
`tenancyRls.test.js` ("as listas não citam tabela inexistente") falhou apontando
`tb_vet_animal_solicitacoes` como fantasma na `AGUARDANDO_RLS`. Era exatamente para isso
que ele existe — tabela removida do banco mas ainda "classificada" esconderia uma
sucessora não classificada. Lista corrigida.

⚠️ **`prisma generate` falhou com `EPERM`** (backend rodando segura a DLL — CLAUDE.md
§11). Não bloqueia nada: nenhum código referencia mais o modelo. Rodar após reiniciar
o backend.

**Verificado ao final:** `prisma validate` OK · `tsc --noEmit` limpo · `vite build`
conclui · **92 testes passando** · 32 animais ativos intactos.

**⏳ FALTA (nada bloqueante):**

1. **D9 é no-op nesta base** — medido: o único animal "compartilhado" (`TipTronic`, id 64)
   pertence à empresa 33 e tem **1** vet vinculado, que por acaso é membro de 5 empresas.
   Não há paciente genuinamente tratado por duas clínicas. **Nada a duplicar.**
2. `Animal.veterinarioNome` / `veterinarioClinica` permanecem como campos de **exibição**
   do responsável — não concedem acesso a nada. Continuam sendo gravados no cadastro.

---

## 7. Carve-outs — quem roda SEM tenant

Sem esta lista, a aplicação para de logar no dia do deploy.

### 7.1 Rotas públicas (12) — control plane obrigatório

`POST /auth/register` · `/auth/login` · `/auth/forgot-password` · `/auth/reset-password` ·
`/auth/refresh` · `/auth/logout` · `/auth/2fa/verificar` · `/auth/2fa/reenviar` ·
`/auth/google` · `GET /equipes/convite/:token` · `GET /especies`

⚠️ Duas saíram desta lista e **não voltam**: `POST /animais/proprietario/aprovar` (morreu
com os vínculos, fase 3) e `POST /audit/log` — esta era **pública e confiava no corpo da
requisição** (`userId`, `email`, `action`, `empresaId`), ou seja, qualquer um forjava
registro de auditoria atribuindo qualquer ação a qualquer pessoa em qualquer empresa. O
LOGIN/LOGOUT passou a ser gravado no servidor (`lib/auditoria.js#registrarAcesso`).

### 7.2 O próprio `middlewares/auth.js`

É ele que **descobre** a empresa consultando `tb_usuario_empresa`/`MembroEquipe`. Roda
antes de existir tenant, por definição → as tabelas que ele lê são control plane.

### 7.3 Crons (10 após a remoção dos 2 de vínculo)

`crmv_sync` · `lembrete_d1_email` · `lembrete_whatsapp` · `fechamento_faturas` ·
`marcar_faturas_atrasadas` · `cancelar_agendamentos_nao_realizados` ·
`marcar_agendamentos_atrasados` · `cancelar_prescricoes_nao_executadas` ·
`cancelar_orcamentos_vencidos` · `limpeza_desafios_2fa`

Varrem todas as empresas por definição. **Duas saídas possíveis:** (a) role `zls2vetjob` com
`BYPASSRLS`; (b) o job itera empresas e seta a variável a cada volta. **(b) é mais lento e
mais honesto** — mantém o job sujeito à mesma regra e evita um role com bypass permanente
no ambiente. Proposta: **(b)**, com (a) só para `limpeza_desafios_2fa` e `crmv_sync`, que
são control plane/catálogo puro.

### 7.4 ADMIN da plataforma (19 rotas)

`aiUsage` (5, inclui `por-empresa` e `planos/:empresaId`) · `seguranca` (2) · `users` (6) ·
`monitoracao` (6). Todas cross-tenant por natureza → role de bypass ou consulta em control
plane. **Nenhuma delas lê tabela clínica**, o que simplifica: não precisam de bypass no
tenant plane.

---

## 8. Fases

| Fase | O que entra | Pronto quando | Reversão |
|---|---|---|---|
| **0. Inventário** | ✅ **FEITO** — `inventarioTenancy.js`, §2.1/§2.2, carve-outs §7 | ✅ D1–D10 respondidas | nada (read-only) |
| **1. Gate em CI** | ✅ **FEITO** — `backend/src/__tests__/tenancyRls.test.js` + Postgres de serviço no `ci.yml`. Placar atual: **0/63 com RLS · 27 fora por decisão** | ✅ 74 testes passando; reprovação **verificada** removendo `tb_animais` de propósito | apagar o teste |
| **2. Cadastro + plano** | ✅ **FEITA** — migration aplicada (13 campos + `status`, `tb_planos`, `tb_assinaturas_empresa`); seed dos 4 planos; `lib/planoEmpresa.js`; limite nos **4 pontos**; D3 em `podeAcessarSistema`/`empresasSemAcesso`; `EmpresaCadastroController` + `routes/empresas.js`; tela **`/cadastro/empresa`** (gestor) com plano e assentos em leitura; **18 testes** da regra de assento | ✅ 92 testes passando; backend e frontend compilando | drop das tabelas novas |
| **3. Fim dos vínculos** | ✅ **CONCLUÍDA** (§6.1) — código + tabela removida | Acesso ao paciente só por empresa, telas de paciente sem regressão | `git revert` no código; o `DROP TABLE` não volta (cópia das 32 linhas guardada fora do repo) |
| **4. Saneamento das órfãs** | ✅ **EXECUTADA** (§2.4) — 964 linhas apagadas em 2 passadas, via `scripts/fase4SanearOrfas.js` | `orfasTenancy.js` acusando **0 órfãs** ✅ (o `inventarioTenancy.js` ainda acusa 7 por artefato do caminho de FK — ver §2.4) | backup JSON fora do repo |
| **5. Coluna de tenant** | ✅ **EXECUTADA** (§2.6) — migration `20260806120000_fase5_tenant_not_null`: `SET NULL`→`RESTRICT` + `NOT NULL` em 11 tabelas + 6 índices tenant-first | ✅ 0 nulos; banco RECUSA linha sem empresa e RECUSA apagar empresa com filhos | `DROP NOT NULL` por coluna |
| **6. RLS canário** | ✅ **EXECUTADA** (§2.7) — `FORCE RLS` + policy `USING`/`WITH CHECK` em `tb_movimentos_estoque` + `lib/tenantDb.js` + 8 testes de invasão | ✅ isola em leitura, escrita e update; tenant não vaza no pool; gate de CI conta 1/62 | `DISABLE ROW LEVEL SECURITY` na tabela |
| **7. RLS geral** | ✅ **CONCLUÍDA** (§2.8–2.11) — 57 policies, escape removido, aplicação conectando como `zls2vetp1` | ✅ sem contexto = 0 linhas · partição exata · UPDATE em massa atinge só a própria empresa · a role não desliga o RLS nem trunca | reaplicar as policies com escape, ou `DISABLE ROW LEVEL SECURITY` por tabela |
| **8. Faxina** | Remoção incremental dos 431 filtros manuais | — | redundantes, não urgentes |

**Fases 2 e 3 não dependem do RLS** e podem começar sem risco de acesso a dados.
**Fase 5 não começa antes da 4** — sem dono resolvido, não há `NOT NULL`.

### 8.1 ⚠️ A base é 100% de teste — e isso muda o desenho (2026-08-05)

Confirmado pelo Marco: **não há dado de produção**. Duas consequências que encurtam o
caminho, e uma que NÃO muda:

| | Antes | Agora |
|---|---|---|
| Fase 4 (órfãs) | decidir caso a caso, tabela de arquivo, risco de esconder prontuário | `DELETE` e segue |
| Fase 5 (coluna) | `nullable` → backfill → `NOT NULL` (3 passos, para não travar a app com dado vivo) | **`NOT NULL` direto**, um passo |
| Fases 6 e 7 (RLS) | canário, medição, rollback por tabela | **igual** — ver abaixo |

⚠️ **O RLS continua exigindo o mesmo cuidado.** O risco daquelas fases nunca foi perder
dado: é **a aplicação parar de enxergar o próprio dado** (policy errada = zero linhas em
toda tela; login sem carve-out = ninguém entra). Isso independe de o dado ser de teste ou
não. O canário e os carve-outs ficam como estão.

⚠️ E vale enquanto durar: no dia em que entrar o primeiro cliente real, este parágrafo
deixa de valer e o desenho conservador volta. Migration escrita agora que dependa de
"pode apagar" precisa estar concluída **antes** disso.

---

## 9. Semântica do isolamento — o que fica isolado e o que continua compartilhado

Esta seção responde "o que acontece quando eu inativo/edito algo em UMA empresa".

### 9.1 Regra geral

| Camada | Escopo | Exemplo |
|---|---|---|
| **IDENTIDADE** (compartilhada) | uma linha em `users` por pessoa | e-mail, senha, 2FA, refresh token |
| **CADASTRO** (por empresa) | uma linha em `tb_usuario_empresa` por (pessoa, empresa) | nome, telefone, endereço, CPF, CRMV, foto, remuneração, perfil, `ativo`, `acessoSistema` |
| **DADO CLÍNICO** (por empresa) | linha carimbada com `empresa_id`, protegida por RLS | animal, evolução, prescrição, fatura |

A pessoa é **uma só** para logar (senão ela teria que manter duas senhas); tudo o mais é
por empresa.

### 9.2 Inativar um usuário em uma empresa afeta a outra?

**Depois desta mudança: NÃO.** Hoje: **SIM — e é um defeito.**

`EquipeController.toggleMembro` executa hoje:

```js
await prisma.user.update({ where: { id: membro.userId }, data: { ativo: !membro.user.ativo } });
```

Ou seja, escreve no `User.ativo`, que é **global**: inativar o profissional na clínica A o
derruba na clínica B. A coluna certa (`UsuarioEmpresa.ativo`) já existe e não é usada — o
CLAUDE.md registra isso como pendência.

**Alvo:** `toggleMembro` passa a escrever `UsuarioEmpresa.ativo` da empresa do contexto.
`User.ativo` fica sendo o que o nome diz: desligar a PESSOA da plataforma inteira, ação
exclusiva do ADMIN. Efeito: inativado em A, a empresa A some do seletor de contexto dele;
em B ele continua trabalhando normalmente.

### 9.3 Animal cadastrado em duas empresas — inativar em uma afeta a outra?

**NÃO** — porque, com a decisão **D5**, cada empresa tem a **sua própria linha** de animal.
São dois registros com o mesmo nome e o mesmo cavalo do mundo real, mas independentes:
`ativo`, peso, baia, foto, prontuário e fatura de cada um vivem na sua empresa.

É a consequência direta de "cada empresa como um banco separado" — e é o que torna a
pergunta 9.4 trivialmente respondida.

⚠️ **Isso cria uma pergunta de migração (D9):** hoje o animal é UMA linha e o
compartilhamento entre clínicas é feito pelos vínculos, que vão acabar. Os animais que hoje
são atendidos por mais de uma empresa precisam ser **duplicados** na fase 2, um por empresa
— senão a segunda clínica simplesmente perde o paciente.

### 9.4 Mudar dado do animal, proprietário ou profissional afeta a outra empresa?

**NÃO, em nenhum dos três** — dois já estão prontos, um depende de D5:

| Entidade | Isolado hoje? | Onde mora o dado por empresa |
|---|---|---|
| **Proprietário** | ✅ já | `ProprietarioPerfil` / `UsuarioEmpresa` (§36 do CLAUDE.md) |
| **Profissional** | ✅ já | `ProfissionalPerfil` / `UsuarioEmpresa` (§36-f) |
| **Animal** | ❌ hoje é uma linha só | passa a ser uma linha por empresa (D5) |

Trocar o telefone do cliente na clínica A não toca no cadastro dele na B — isso já funciona
assim e é justamente por isso que `UsuarioEmpresa` existe. O animal é o único dos três que
ainda não tem essa separação, e D5 a cria.

**O que continua compartilhado, de propósito:** e-mail, senha e 2FA. Se fossem duplicados,
a mesma pessoa teria duas senhas e o seletor de contexto (trocar de clínica sem deslogar)
deixaria de existir.

### 9.5 Separar autenticação de autorização — sim, e o caminho é PURGAR, não dividir

A tabela de autorização **já existe**: é `tb_usuario_empresa`, com `perfil` por empresa.
O que nunca foi feito é a outra metade — **limpar o `users`**. Ele tem **30 colunas**, e só
8 são de autenticação:

| Natureza | Colunas | Onde deveria estar |
|---|---|---|
| **AUTENTICAÇÃO** (8) | `id` `email` `passwordHash` `refreshToken` `resetPasswordToken` `resetPasswordExpires` `mustChangePassword` `mfa_ativo` | ✅ aqui mesmo |
| **AUTORIZAÇÃO global** (1) | `role` (ADMIN da plataforma) | ✅ aqui — é global de verdade |
| **AUTORIZAÇÃO por empresa** (2) | `userType` · `ativo` | ❌ `tb_usuario_empresa.perfil` / `.ativo` — **já existem lá** |
| **CADASTRO legado** (16) | `fullName` `phone` `phone2` `cep` `endereco` `complemento` `bairro` `cidade` `estado` `cpf` `cnpj` `mensalista` `valorAssistencia` `frequenciaVisitas` `dia_vencimento_fatura` `isConvidado` | ❌ `tb_usuario_empresa` — **já existem lá** (§36) |
| **TENANCY legado** (2) | `empresa_id` · `equipe_id` | ❌ superados por `tb_usuario_empresa` |

**Criar uma tabela nova custaria 42 FKs em 32 tabelas** apontando para `users.id`, para
ganho funcional zero — a identidade mantém o mesmo `id` de qualquer forma.

**A versão cirúrgica é não dividir: esvaziar.** `users` continua sendo a tabela de
autenticação (já é o alvo do login e a âncora das FKs) e perde as 20 colunas que não são
dela. Passa de 30 para ~10 colunas, todas de autenticação, **sem tocar em uma única FK**.

**Isso melhora a decisão de tenancy? Sim, em três pontos concretos:**

1. **Mata a maior fonte de bug do sistema.** `userType` num campo global fazendo trabalho
   por empresa é a origem das armadilhas 36-c e 36-e do CLAUDE.md — inclusive do
   `resolverTipoNoContexto`, que hoje **sobrescreve** `req.user.userType` em toda
   requisição e guarda o valor original em `userTypeGlobal`. A própria armadilha diz:
   *"`SELECT userType FROM users` para decidir ACESSO é sempre bug"* — e ela já derrubou
   `animalScope` e `animalAccess` (403 em cascata em 8 controllers). **Coluna que não
   existe não pode ser lida errado.**
2. **Resolve o §9.2 na estrutura, não no `toggleMembro`.** Sem `users.ativo`, não há onde
   escrever o flag global por engano — o único `ativo` alcançável é o da empresa.
3. **Tira dado pessoal de fora do RLS.** Hoje `users` guarda nome, telefone, CPF, CNPJ e
   endereço de **todos os clientes de todas as clínicas**, numa tabela que, no plano, fica
   fora do RLS por ser necessária ao login. Depois da purga, esse dado só existe em
   `tb_usuario_empresa` — que passa a poder entrar no **tenant plane com RLS**, usando uma
   função `SECURITY DEFINER` estreita (só `userId → empresas onde ele tem acesso`) para o
   único momento em que o login precisa lê-la antes de existir tenant.

   Esse é o ganho que a sua pergunta destrava: **sem separar, `tb_usuario_empresa` teria de
   ficar fora do RLS para o login funcionar.** Separando, o único dado fora do RLS vira
   e-mail + hash de senha.

**O que a separação NÃO resolve:** credencial por empresa. A pessoa continua com um e-mail
e uma senha. Ter senha por clínica exigiria perguntar "qual empresa?" antes de autenticar e
acabaria com o seletor de contexto — é o desenho oposto, não uma melhoria deste.

**Custo:** as 20 colunas a remover já têm destino pronto e populado (`tb_usuario_empresa`),
mas há código legado ainda lendo delas. É trabalho de fase 1/2, incremental: parar de
escrever → migrar leitores → dropar coluna. Nenhuma FK se move.

---

## 10. Decisões que preciso de você

### 10.1 Respondidas (2026-08-05)

| # | Decisão | **Resposta** | Consequência no plano |
|---|---|---|---|
| **D1** | `DesignacaoPrestador` vai junto com os vínculos? | **Não — FICA** | O prestador continua vendo só os animais designados. `lib/animalAccess.js` mantém o ramo de designação; some só o de solicitação |
| **D2** | Proprietário ocupa assento no plano? | **Não ocupa** — haverá plano próprio no futuro, quando o vet liberar acesso ao proprietário | `perfil <> 'PROPRIETARIO'` na contagem de assentos. `tb_planos` já nasce com espaço para `limiteProprietarios` |
| **D3** | Empresa `SUSPENSA`: bloqueia ou somente-leitura? | **BLOQUEIA o login de todos daquela empresa** | Checagem em `podeAcessarSistema` (mesmo ponto do `acessoSistema`). ⚠️ Bloqueia **por empresa**: quem também trabalha em outra clínica loga nela normalmente — a empresa suspensa some do seletor de contexto |
| **D4** | Quem é dono do `whatsapp`? | **O cadastro da empresa** | `EmpresaConfiguracao.whatsapp` migra para `tb_empresas` e passa a ser lido de lá |
| **D5** | Mesmo paciente em duas clínicas = dois cadastros? | **SIM** | Uma linha de `tb_animais` por empresa. Habilita §9.3 e §9.4 |
| **D6** | Destino dos 5 animais órfãos | **APAGAR** (`DELETE`) — são dados de teste, não há usuário real por trás | Sem tabela de arquivo. Fase 3 executa `DELETE` em cascata |
| **D7** | Destino das 10 faturas órfãs | **APAGAR** (`DELETE`) — idem | Idem |
| **D8** | As 5 tabelas sem caminho até a empresa | **OK à proposta**: `tb_composicao_alimento` = **global**; os 4 de exame = **da empresa** | Composição fica sem RLS; `tb_exame_grupos`, `tb_exame_itens`, `tb_imagem_exame_grupos` e `tb_imagem_exame_itens` ganham `empresa_id` + RLS na fase 4 |

### 10.2 D8 — o que eu estava perguntando (não ficou claro)

Cinco tabelas ficaram **sem nenhum caminho de FK até a empresa**. Não é que estejam
erradas: é que o script não conseguiu deduzir de quem elas são, e **toda tabela precisa ter
dono definido antes de o RLS entrar**, senão ela fica de fora do isolamento sem ninguém
perceber. Preciso que você diga, para cada uma, se o conteúdo é **global** (igual para
todas as clínicas) ou **da empresa** (cada clínica tem o seu):

| Tabela | Linhas | O que aparenta ser | Se for GLOBAL | Se for DA EMPRESA |
|---|---:|---|---|---|
| `tb_composicao_alimento` | 296 | composição nutricional de alimento por espécie — tabela de referência técnica (NRC) | fica sem RLS, todos leem | ganha `empresa_id` + RLS |
| `tb_exame_grupos` | 24 | agrupamento de itens de exame laboratorial | idem | idem |
| `tb_exame_itens` | 259 | os itens dentro do grupo acima | idem | idem |
| `tb_imagem_exame_grupos` | 12 | idem, para exame de imagem | idem | idem |
| `tb_imagem_exame_itens` | 119 | itens do grupo de imagem | idem | idem |

**Meu palpite:** `tb_composicao_alimento` é referência técnica → **global**. Os quatro de
exame são **modelos de laudo** e provavelmente cada clínica monta o seu → **da empresa**.
Mas é palpite, e palpite não entra em migration — daí a pergunta.

### 10.3 ⚠️ D6 e D7 — o que "apagar" leva junto

Registrando o alcance antes de executar, porque é irreversível e são dados clínicos e
financeiros reais:

**D6 — apagar os 5 animais** remove também, por dependência:
- **6 evoluções clínicas** (prontuário)
- **12 itens de fatura**
- o que estiver pendurado neles: 1 dieta, 1 exame clínico, agendamentos, mídias

| id | nome | ativo | |
|---|---|---|---|
| 1 | Administrador | sim | aparenta ser registro de teste |
| 55 | Kayser | sim | com prontuário |
| 66 | Dudoca | sim | com prontuário |
| 71 | Super Simples | não | já inativo |
| 73 | Fafa | não | já inativo |

**D7 — apagar as 10 faturas** remove também os itens de fatura vinculados.

**Recomendação (não bloqueia):** em vez de `DELETE`, mover para uma tabela de arquivo
(`tb_animais_arquivados`, `tb_faturas_arquivadas`) na mesma migration. Mesmo efeito
prático — somem do sistema e deixam de travar o `NOT NULL` —, mas com volta possível se
alguém reclamar do prontuário do "Kayser" daqui a três meses. Prontuário veterinário
costuma ter prazo de guarda; `DELETE` fecha essa porta.
**Se você confirmar `DELETE` de verdade, executo o `DELETE`** — só quero que a escolha seja
consciente, não um efeito colateral da migração.

### 10.4 Respondidas (2026-08-05) — nenhuma decisão em aberto

| # | Decisão | **Resposta** | Consequência |
|---|---|---|---|
| **D9** | Animais hoje atendidos por MAIS DE UMA empresa (via vínculo, que vai acabar) | **DUPLICAR** — um por empresa | Fase 2 duplica antes de remover os vínculos; sem isso a 2ª clínica perde o paciente |
| **D10** | Purgar o `users` (§9.5) — tirar as 20 colunas que não são de autenticação | **SIM**, incremental | Habilita `tb_usuario_empresa` no RLS e mata a origem das armadilhas 36-c/36-e |

**✅ D1–D10 fechadas.**

### 10.5 Surgiu na execução da fase 1

| # | Decisão | Proposta |
|---|---|---|
| **D11** | 🆕 **`tb_audit_logs`: control plane ou tenant plane?** Ver §10.6 — a resposta mudou depois de olhar o dado | ⏳ **ABERTA** entre (b) e (c) |
| **D12** | 🆕 `tb_localizacoes_animal` é catálogo MISTO (5.192 globais + 7 de empresa), estava classificada como global puro | ✅ **MISTO** — entra no tenant plane com a policy da forma (2), igual a medicamento e procedimento |

### 10.6 D11 — por que a proposta anterior foi retirada

**Medição (2026-08-05):** das 1.004 linhas de `tb_audit_logs`, 904 estão sem `empresaId`.
Elas **não são resíduo de teste**:

| Ação | Linhas |
|---|---:|
| LOGOUT | 392 |
| LOGIN | 384 |
| Evolução criada/editada, configuração de segurança | ~128 |

**273 foram criadas nos últimos 7 dias**, de 25 usuários distintos. Não têm empresa por
motivo **estrutural**: `POST /api/audit/log` é rota **pública** (§7.1) e o registro
acontece à margem da resolução de tenant. Apagá-las removeria a trilha de acesso de 25
pessoas e não resolveria nada — 273 novas voltariam na semana seguinte.

⚠️ **Consequência: `empresa_id IS NULL` aqui não é sujeira, é uma CATEGORIA — evento de
plataforma.** E isso invalida a proposta original deste documento (policy mista
`= tenant OR IS NULL`): com ela, **todo gestor veria o LOGIN/LOGOUT de todas as clínicas**,
o oposto do objetivo.

| Opção | Comportamento | Custo |
|---|---|---|
| **(a)** control plane (como hoje) | filtro do controller segue sendo a única proteção | zero, mas mantém o modelo que a migração elimina |
| **(b)** tenant plane, policy `empresa_id = tenant` | isola; linha de plataforma visível só ao ADMIN | gestor deixa de ver o acesso da própria equipe |
| ~~**(c)** (b) + o front carimbar `empresa_id` no audit de login~~ | ❌ **RETIRADA** — ver 10.7 | oficializaria tenant vindo do cliente |

**✅ RESOLVIDO (2026-08-05):** todos os dados da aplicação ainda são de teste → as 904
linhas **serão apagadas** na fase 4. E a policy é a **(b)**: `empresa_id = tenant`, sem
`OR IS NULL`.

O que a opção (c) queria (o gestor continuar vendo o acesso da própria equipe) é entregue
depois, de graça, pela correção do §10.7 — quando o audit de login passar a ser escrito
**no servidor**, ele nasce com a empresa correta e cai sozinho dentro da policy (b).

### 10.7 🔴 Achado de segurança: `POST /api/audit/log` é público e confia no corpo

Encontrado ao investigar D11. **Não é sobre multi-tenancy — é um buraco de hoje:**

```js
// backend/src/routes/audit.js
router.post('/log', controller.registrar);            // ← sem `authenticate`

// backend/src/controllers/AuditController.js
const { userId, userName, email, action, empresaId } = req.body;   // ← tudo do cliente
```

Qualquer um na internet pode **injetar registro de auditoria** atribuindo qualquer ação a
qualquer usuário, em qualquer empresa — e a auditoria é justamente o que deveria ser
inquestionável. O controller até se protege de spoofing **no IP** (`ipDoRequest(req)`, com
comentário explicando), mas aceita `userId`, `email`, `action` e `empresaId` do corpo.

⚠️ Isso também **invalida a opção (c)** do D11: o front mandar `empresaId` seria oficializar
tenant vindo do cliente, o que o CLAUDE.md proíbe explicitamente.

**✅ CORRIGIDO em 2026-08-05.** O registro de LOGIN/LOGOUT saiu do cliente e passou para o
servidor:

| Arquivo | Mudança |
|---|---|
| `lib/auditoria.js` | novo `registrarAcesso(req, user, action)` — identidade vem do usuário que o backend autenticou, IP do request, fire-and-forget |
| `auth/UserController.js` | `emitirSessao(req, res, user)` (ganhou `req`) grava o LOGIN — cobre login por senha **e** 2º fator, por ser o ponto único de sessão |
| `GoogleController.js` | grava o LOGIN — ⚠️ ele **não** passa por `emitirSessao`; sem isso, quem entra pelo Google sumiria da trilha |
| `AuthController.logout` | descobre o dono pelo refresh token **antes** de invalidá-lo e grava o LOGOUT |
| `routes/audit.js` | **`POST /log` REMOVIDA** — não sobra rota pública de escrita |
| `AuditController.registrar` | removido |
| `AuthContext.tsx` (front) | deixou de chamar a rota; o logout já era server-side e agora audita junto |

⚠️ **`empresa_id` fica NULL nesses registros, por ora.** A resolução da empresa ativa mora
inline no `middlewares/auth.js` (≈90 linhas de prioridade) e duplicá-la no login seria pior
do que não carimbar. Quando a migração extrair esse resolvedor para uma função reusável, é
plugá-lo em `registrarAcesso` — aí a policy (b) passa a mostrar ao gestor o acesso da
própria equipe, que era o objetivo da opção (c), sem o problema de segurança.

**Achado colateral, corrigido junto:** o jest rodava **cada teste duas vezes** (a fonte em
`src/` e a cópia compilada em `dist/`). Além de dobrar tempo e consultas ao banco, tornava
o gate não confiável — a cópia de `dist/` é o retrato do último build, então editar as
listas em `src/` podia reprovar (ou passar) pelo motivo errado.
Corrigido com `testPathIgnorePatterns: ['/node_modules/', '/dist/']` em `jest.config.js`.

---

## 11. Como se prova que funcionou

Sem isto, "RLS ligado" é fé. Critério de aceite da fase 6:

1. **Teste de invasão** — com a variável na empresa A, tentar `SELECT`, `UPDATE` e `INSERT`
   carimbado para a empresa B, em cada tabela do tenant plane. Tudo volta vazio ou estoura.
2. **Falha fechada** — sem a variável, toda tabela de tenant devolve zero linhas.
3. **Teste do dono** — provar que o role da aplicação **não** é dono e não tem `BYPASSRLS`
   (é o achado 3.1 virando teste de regressão).
4. **Fumaça sem tenant** — as 12 rotas públicas, os 10 crons e as 19 rotas ADMIN.
5. **Catálogo com linha global** — o tenant LÊ os 938 procedimentos globais e **não
   consegue criar** um global (o `WITH CHECK` da forma (2)).

---

## 12. Riscos

| Risco | Gravidade | Contenção |
|---|---|---|
| RLS sem efeito pelo dono da tabela (§3.1) | **Alta** | Role separado + `FORCE RLS` + teste 10.3 |
| Variável vazando entre requisições pelo pool | **Alta** | `set_config(..., true)` na transação; nunca `SET` de sessão |
| Login/cron parando no deploy | **Alta** | Carve-outs §7 mapeados + fumaça 10.4 antes de virar a chave |
| Órfãs bloqueando o `NOT NULL` | **Média** | Fase 3 dedicada; hoje são 5 animais + 10 faturas + 8 avulsas |
| Backfill escolhendo caminho errado | Média | Caminho **explícito por tabela**, nunca o que o script achou primeiro (§2.2) |
| Latência do round-trip extra | Média | Fase 5 mede na canário; transação por requisição nos caminhos pesados |
| Remoção dos vínculos derrubando telas de paciente | Média | Fase 2 isolada, telas de paciente como critério de aceite |
| `$queryRawUnsafe` espalhado | Baixa | Passa pelo RLS igual; o cuidado é com o que roda antes do tenant — mapeado em §7 |

---

## 13. Revisão crítica do próprio plano (SW / arquiteto / DBA)

Direção: **correta** — RLS é o mecanismo certo para as restrições reais (um PostgreSQL,
Prisma, poucos tenants, exigência de garantia no banco e não na aplicação). Mas o plano,
como estava escrito, tinha **duas falhas que o quebrariam na semana 3** e outras cinco
lacunas. Registradas aqui para não virarem descoberta em produção.

### 13.1 🔴 Transação aninhada — a extensão do §4 não funciona como escrita

**77 usos de `$transaction` em 20 arquivos.** A extensão proposta envolve **cada operação**
em `prisma.$transaction([set_config, query])`. Dentro de um `prisma.$transaction(async tx
=> …)` já aberto (o padrão do `faturaUtils`, da auditoria e de todo o fluxo de execução de
prescrição), isso significa abrir uma **segunda** transação, em outra conexão:

- a variável setada na transação interna **não vale** para a externa → as consultas da
  externa rodam sem tenant e o RLS devolve zero linhas;
- a interna pode ficar esperando lock que a externa segura → **deadlock**.

**Desenho correto:** interceptar o **início da transação**, não cada operação. O
`set_config` roda uma vez por transação; operações avulsas (fora de transação) ganham a
sua própria. A extensão precisa saber se já está dentro de uma — Prisma **não suporta
transação aninhada**, então isso não é otimização, é requisito.

### 13.2 🔴 98 chamadas de SQL cru que a extensão não intercepta

`$queryRawUnsafe` / `$executeRawUnsafe` em **23 arquivos**. Extensão de `$allModels` **não
alcança** raw query — ela rodaria **sem** a variável de tenant e o RLS devolveria vazio.

Agrava que o SQL cru aqui não é exceção: é padrão documentado no CLAUDE.md para colunas que
o client Prisma não conhece (`acessoSistema`, `aplicadaPeloProprietario`,
`cadastroConfirmadoEm`, `assumidoDeId`…). Parte lê control plane (`tb_usuario_empresa`, sem
RLS, tudo bem), mas parte lê **tenant plane** — `anexarFlagEmGrupos` e
`gravarAplicadaProprietario` batem em `tb_prescricoes`.

**Consequência para o plano:** a extensão precisa cobrir **client-level operations** além
de model-level, e a fase 5 (canário) tem de incluir **um caminho com SQL cru**, senão o
canário passa e o resto quebra.

### 13.3 🟡 Índices precisam virar tenant-first

Acrescentar `empresa_id` sem revisar os índices existentes faz o Postgres varrer por
`animalId`/`data` e só depois filtrar por empresa. Os índices quentes devem virar
compostos com a empresa **na frente** (`(empresa_id, animal_id)`, `(empresa_id, data)`).
Sem isso, o RLS entra e a aplicação fica mais lenta sem motivo aparente.

### 13.4 🟡 RLS não fecha canal de erro e de constraint

`UNIQUE` é verificado **antes** da policy: ao tentar gravar um valor que já existe em
**outro tenant**, o erro de violação confirma que aquela linha existe lá. Onde houver
unique global em coluna sensível, ele precisa virar `UNIQUE (empresa_id, coluna)`. Vale
revisar caso a caso na fase 4.

### 13.5 🟡 Sem gate em CI, o isolamento apodrece → virou a FASE 1

**O modo de falha:** meses depois da migração, alguém cria `tb_nova_coisa` numa migration
normal. Ela nasce sem RLS. A aplicação funciona, nenhum erro aparece, os testes passam — e
aquela tabela simplesmente não tem isolamento. Você descobre quando um cliente vê o dado de
outro. **A ausência de policy é invisível em runtime**, diferente de um `checkPermission`
esquecido, que ao menos dá 403 em algum lugar.

**A trava** (`backend/src/__tests__/tenancyRls.test.js`, junto dos 3 testes já existentes):

```js
const TENANT_PLANE = ['tb_animais', 'tb_evolucoes_clinicas', /* … */]; // decisão humana, em código
const SEM_RLS      = ['users', 'tb_empresas', 'tb_especies', /* … */]; // control plane + catálogo

test('toda tabela do tenant plane tem RLS, FORCE e policy', async () => {
  const estado = await prisma.$queryRaw`
    SELECT c.relname AS tabela, c.relrowsecurity AS enable, c.relforcerowsecurity AS force,
           count(p.polname)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'schs2vet' AND c.relkind = 'r'
     GROUP BY 1,2,3`;

  const desprotegidas = estado.filter(t => TENANT_PLANE.includes(t.tabela))
                              .filter(t => !t.enable || !t.force || t.policies === 0);
  expect(desprotegidas).toEqual([]);                       // ① proteção de fato

  const naoClassificadas = estado.map(t => t.tabela)
    .filter(t => !TENANT_PLANE.includes(t) && !SEM_RLS.includes(t));
  expect(naoClassificadas).toEqual([]);                    // ② ninguém entra sem decisão
});
```

**A asserção ② é a que faz o trabalho.** A lista mora em CÓDIGO: tabela nova que não esteja
em nenhuma das duas listas **reprova o build**. O teste não decide se `tb_nova_coisa` é de
tenant — ele **obriga alguém a decidir**, no PR, com o contexto fresco. É o que transforma
"lembrar de proteger" em "não conseguir esquecer". A ① cobre o `FORCE`, a armadilha do
§3.1: sem ele o dono ignora a policy e o isolamento é decorativo.

**Custo na CI atual:** o workflow hoje só faz `prisma generate` com uma `DATABASE_URL` de
mentira — não há Postgres de verdade. O gate precisa de banco real:

```yaml
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: ci_db }
    options: >-
      --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
# e, antes do npm test:
- run: npx prisma migrate deploy
```

Efeito colateral bom: com Postgres real na CI, o **teste de invasão do §11** também passa a
rodar a cada PR, em vez de ser conferência única na virada da chave.

⚠️ **Este é um banco EFÊMERO da CI** — não é o banco de vocês. Não conflita com a regra de
autorização do topo deste documento.

### 13.6 🟡 Ciclo de vida do tenant só está meio coberto

Provisionamento existe (`criarEmpresa` já semeia equipe, perfis e matriz). **Não existe**:
exportar os dados de um cliente e apagá-los sob demanda (LGPD). Com schema único, exportar
é uma query com o tenant setado — mas **restaurar** um cliente sozinho é difícil, e é aí
que schema-por-empresa teria ganhado. Foi trocado por custo operacional; a troca é
defensável, mas é uma troca, não um almoço grátis.

### 13.7 🟡 Vizinho barulhento

Base compartilhada: consulta pesada de um cliente degrada todos. Não há contenção prevista
(nem `statement_timeout` por role, nem limite de conexão por tenant). Aceitável na escala
atual; vira problema com dezenas de clínicas ativas.

### 13.8 🟡 Os 431 filtros não são todos redundantes

O plano os chamou de "redundantes, não urgentes". **Parte deles implementa regra de
negócio, não tenancy** — a segregação por equipe e o escopo do prestador, por exemplo.
Remover em bloco mudaria comportamento. A faxina da fase 7 é caso a caso, e o critério é:
*"este filtro repete o que o RLS já faz?"* — só então sai.

### 13.9 🔴 DRIFT entre o banco e o schema Prisma (achado na fase 2)

Ao gerar a migration da fase 2 com `prisma migrate diff --from-schema-datasource`, o
resultado vieram **326 linhas** — e só ~40 eram da fase 2. O resto é **drift acumulado**
entre o banco real e o que o Prisma acha que o schema deveria ser:

| Operação | Ocorrências |
|---|---:|
| ADD FOREIGN KEY | 21 |
| DROP FOREIGN KEY | 19 |
| RENAME INDEX | 15 |
| DROP / CREATE INDEX | 7 / 7 |
| ALTER TABLE (default de `updated_at`) | vários |

Causa provável: as migrations deste projeto são escritas à mão há tempos (padrão
documentado no CLAUDE.md), então nomes de índice e constraints divergiram do que o Prisma
geraria. **Não é corrupção** — o banco funciona —, mas tem duas consequências sérias:

1. **`prisma migrate dev` é uma arma carregada aqui.** Rodado de forma interativa, ele
   proporia "consertar" todo esse drift numa migration só, reestruturando o banco a
   pretexto de uma alteração pequena. A migration da fase 2 foi escrita **à mão**, com só
   as ~40 linhas dela, exatamente para não levar isso de carona.
2. **Na fase 5 o problema volta maior**, quando forem ~33 tabelas ganhando `empresa_id`.

**Encaminhamento proposto (tarefa própria, antes da fase 5):** rodar o diff, revisar as
326 linhas e decidir item a item o que é renomeação cosmética (aceitar) e o que é
divergência real de constraint (corrigir). Enquanto isso não acontece, **toda migration
deste projeto é escrita à mão** — o `--create-only` do Prisma não é confiável aqui.

### 13.10 Veredito

| Pergunta | Resposta honesta |
|---|---|
| RLS é o mecanismo certo aqui? | **Sim**, dadas as restrições (um Postgres, Prisma, exigência de garantia no banco) |
| O plano garante multi-tenancy? | **Depois de 13.1 e 13.2**, sim para o acesso a dados. **RLS sozinho não é garantia** — garantia é RLS + teste de invasão + gate em CI (13.5) |
| Alguma alternativa seria melhor? | Schema-por-empresa ganha em **portabilidade e restore por cliente**; perde em custo de migration (×N). Extensão só na aplicação é mais barata e não dá garantia nenhuma no banco |
| O que eu faria diferente se recomeçasse? | Começaria por 13.5 (gate em CI) — é o que impede a arquitetura de se degradar depois que o projeto sair da cabeça de quem a construiu |

---

## 14. O que NÃO está neste plano

- **Schema por empresa de verdade** — descartado com você: o Prisma trata multi-schema de
  forma estática, cada migration rodaria N vezes e provisionar cliente novo viraria
  processo operacional. O RLS entrega o mesmo isolamento lógico sem esse custo.
- **Cobrança** (gateway, recorrência, nota fiscal). O plano prepara o modelo e o limite.
- **RLS por EQUIPE dentro da empresa.** A segregação por equipe continua na aplicação;
  levá-la ao RLS multiplicaria a policy sem demanda declarada.
- **Correção do CLAUDE.md** (diz 7 crons, hoje são 12) — anotar quando a fase 2 mexer neles.

---

## 15. Verificação pós-fase 7 — os três caminhos (2026-08-06)

Executados antes de decidir a fase 8, para responder com MEDIÇÃO, e não com opinião, se
o isolamento está de pé.

### 15.1 Caminho 1 — exercitar as ROTAS, não os testes

`backend/scripts/exercitarRotas.js`. Emite um JWT real para dois GESTORES de empresas
diferentes e chama 12 rotas de leitura das telas principais, comparando as respostas.

**Por que existia esse buraco:** `/health` e teste de unidade não cobrem o risco que o
RLS fail-closed cria. A tela que dependia de ler SEM contexto não dá erro — ela devolve
VAZIO. É a falha mais cara de achar, porque parece funcionamento normal.

Ele encontrou **3 HTTP 500** que nenhum teste pegava, todos da mesma raiz: a fase 5 tornou
`empresa_id` NOT NULL, e onde o código ainda filtrava `{ empresaId: null }` o Prisma passou
a recusar a consulta inteira (`Argument 'empresaId' is missing`). Corrigidos 11 pontos em 7
arquivos. Resultado final: as 12 telas em 200/200, com contagens DIFERENTES entre as duas
empresas, e o acesso cruzado (A abrindo o paciente de B) devolvendo 404.

### 15.2 Caminho 2 — o gate de RLS na CI

Três armadilhas apareceram ao ligar, e todas valem para quem for mexer no workflow:

1. **A CI quebraria antes de testar qualquer coisa.** A migration `20260806160000` concede
   privilégios a `zls2vetp1` e usa `ALTER DEFAULT PRIVILEGES FOR ROLE "nutriadmin"` —
   roles que não existem num Postgres recém-criado. O `GRANT` aborta e leva a migration
   junto. Corrigido criando as duas roles no workflow, **antes** do `migrate deploy`.
   ⚠️ Editar aquela migration para "criar a role se faltar" NÃO era alternativa: ela já
   está aplicada no banco real e o Prisma guarda o checksum de cada arquivo — alterar o
   conteúdo faz o `migrate deploy` seguinte falhar com *"migration file has been
   modified"*. **Migration aplicada é imutável; quem se adapta é o ambiente.**

2. **Testar como superusuário daria VERDE FALSO.** O `postgres` do container ignora todas
   as policies. O gate de invasão passaria com o RLS desligado. Por isso há duas URLs:
   `CI_DATABASE_URL` (admin — migration e fixture) e `CI_APP_DATABASE_URL` (`zls2vetp1` —
   os testes). É também a topologia de produção, então a CI passou a exercitar a mesma
   separação de papéis que o ambiente real usa.

3. **Banco vazio compara zero com zero.** `rlsCanario` pergunta "a empresa A vê as linhas
   de B?" — sem dados, `expect(visto).toBe(n)` é `0 === 0` e passa sem provar nada. Daí
   `backend/prisma/ci-fixture.sql`: duas empresas, um animal e dois movimentos de estoque
   cada. Dois movimentos, e não um, porque com um só um bug do tipo "devolve a primeira
   linha que encontrar" passaria despercebido na contagem. Roda como superusuário — a role
   da aplicação, sujeita às policies, não conseguiria semear a segunda empresa.

Com isso os três gates passam a valer na CI: o ESTRUTURAL (`tenancyRls` — tabela nova sem
classificação, RLS desligado, policy ausente, escape reintroduzido) e os dois de
COMPORTAMENTO (`rlsCanario`, `prismaTenant`).

### 15.3 Caminho 3 — remover só os filtros ERRADOS

Convergiu com o caminho 1: exercitar as rotas foi o que revelou quais filtros manuais
estavam errados. Nenhum filtro foi removido por ser "redundante com o RLS" (§13.8) — só os
que a fase 5 tornou **inválidos**.

Dois deles não eram `empresaId: null` solto, e são o caso mais instrutivo: usavam
`escopoCatalogoEmpresa` sobre `Animal` e `LoteVacina`. Aquele helper é de **CATÁLOGO**, onde
`empresa_id IS NULL` significa *linha global compartilhada* — conceito que não existe em
tabela de tenant. As duas viraram `empresaId: empresaId ? Number(empresaId) : -1`
(o `-1` não casa com empresa alguma: fail-closed).

**Regra que fica:** `escopoCatalogoEmpresa` só se aplica a tabela classificada como
CATÁLOGO MISTO em `lib/tenancyMap.js`. Em tabela TENANT, `empresa_id` nulo não é "global",
é linha órfã — e desde a fase 5 nem existe.

---

## 16. Auditoria de prontidão para produção (2026-08-06)

Cinco papéis (dev, DBA, segurança, eng. de SW, arquiteto). Método: MEDIÇÃO — auditoria
estrutural do banco (91 tabelas), varredura estática das 300+ rotas e **pentest ao vivo**
contra o backend em execução. Só se afirma o que foi provado.

### 16.1 Pentest — 15 vetores de ataque, todos contidos

Dois gestores de empresas diferentes (A=31, B=35). Cada vetor abaixo foi executado com
sessão real (JWT assinado, cookie HttpOnly, header de contexto):

| # | Vetor | Resultado |
|---|---|---|
| 1 | IDOR: A abre animal/fatura/evolução/histórico/agenda de B por ID | **404** em todos |
| 2 | Spoof: token de A + `x-empresa-id` de B | header recusado, A vê só os seus |
| 3 | Token forjado com segredo errado | **401** |
| 4 | Gestor comum em rota de plataforma (`/ai-usage/por-empresa`) | **403** |
| 5 | Escrita cruzada: A lança item na fatura de B | **404** |
| 6 | Sem `x-empresa-id`: fallback de tenant | cai na empresa de A, não amplia |
| 7 | `/equipes/empresas`: A enxerga empresa de B? | não — só [31] |
| 8 | `/audit/logs`: escopo | 48 de 113 (exatamente os de A) |
| 9-13 | IDOR por `equipeId` na URL: auditoria de permissões, membros, matriz, proprietários, config, passando a equipe de B | **403/404** em todos |

**Conclusão:** o isolamento cross-tenant está de pé nos dois níveis — RLS no banco
(fase 7) e autorização na aplicação (`autorizarGestorDaEquipe`, `verificarAcessoAnimal`,
`escopoPlataforma`). Nenhum vazamento em 15 tentativas.

⚠️ **Falso positivo registrado, para não voltar a assustar:** forjar `role: ADMIN` no JWT
"vê todas as empresas" — mas só porque o teste assinou com o `JWT_SECRET` real (acesso ao
`.env`). Sem o segredo o token é rejeitado (vetor 3). Não é escalada; é "quem tem o
segredo pode tudo", que vale para qualquer sistema. O `role` do token é setado no login a
partir do banco. Risco residual conhecido de JWT stateless: token de um ADMIN rebaixado
vale até expirar (≤30 min). Aceito.

### 16.2 Bugs de disponibilidade achados e CORRIGIDOS

A fase 5 (NOT NULL nas colunas de tenant) deixou quatro pontos que o Prisma passou a
recusar — `Argument 'not' must not be null` — ou que criariam órfão. Todos geram HTTP 500
ou registro sem dono; todos corrigidos nesta auditoria:

| Local | Sintoma | Correção |
|---|---|---|
| `permissao.middleware.js` `getEquipeIdsDoProprietario` | `{ empresaId: { not: null } }` → **500 na home do proprietário** sem empresa no contexto (achado pelo pentest) | filtro de empresa OMITIDO quando ausente |
| `auth.js` fallback do proprietário | mesmo `{ not: null }` no Animal → **quebra a AUTENTICAÇÃO** no 1º acesso (achado pela varredura estática — o pentest não chega nesse ramo) | idem |
| `EquipeController.js` `meusContextos` do proprietário | mesmo `{ not: null }` | idem |
| `UserController.js` `updateMe` especialidades | `createMany` com `empresaId: null` em coluna NOT NULL → **500** ao profissional autônomo salvar Cadastro Pessoal | escrita de especialidade pulada sem empresa (é POR empresa) |
| `AnimalController.js` `criar` | `empresaId: vetEmpresaId ?? undefined` omitia o campo → 500 e **risco de animal órfão** | **guarda anti-órfão**: 400 `EMPRESA_NAO_RESOLVIDA` antes do INSERT |

`diaVencimentoFatura`/`loteId` com `{ not: null }` foram verificados e são `Int?`
(nuláveis) — filtros corretos, não tocados.

### 16.3 Defesa em profundidade — RLS ausente/frouxo (decisão pendente)

Não são vazamentos ativos (a aplicação filtra corretamente, comprovado), mas faltam a
segunda camada. Precisam da sua autorização — nenhum foi aplicado:

1. **`tb_usuario_empresa` sem RLS** (control plane — `auth.js` a lê antes de existir
   tenant). Guarda dado pessoal (CPF/CNPJ, endereço) e REMUNERAÇÃO de todas as empresas.
   Todas as 6 leituras (Prisma + raw) filtram por `empresaId` na aplicação — verificado
   uma a uma, sem exceção. Risco: um call site futuro sem filtro vazaria, e o RLS não
   seguraria. Endurecimento possível: RLS por `user_id` (exige um GUC `app.user_id` no
   `auth.js`) — arquitetura nova, fora do plano atual.

2. **Policy de `tb_midia_arquivos` frouxa**: o ramo `empresa_id IS NULL AND animal_id IS
   NOT NULL` deixa arquivo órfão-com-animal visível a qualquer empresa. Medição: **0
   arquivos** nessa condição hoje (o único sem empresa é a marca do produto, `publico`).
   O download já é autorizado no `MidiaController` (`verificarAcessoAnimal`), então a rota
   HTTP está protegida mesmo com a policy larga. Endurecimento: policy = `empresa_id =
   tenant OR publico = true` (uma migration; não quebra nada, pois nenhum arquivo real
   depende do ramo removido).

3. **Colunas fantasma em `tb_tratadores`**: `empresaId` (camelCase, nullable, **0/29**) e
   `localTrabalho` (**0/29**) — duplicatas mortas das colunas reais `empresa_id` (NOT NULL)
   e `localizacao_id`. O Prisma não as conhece; nenhum filtro as lê. Não vazam, mas são
   ambiguidade estrutural. `DROP COLUMN` as elimina (DDL destrutivo — pede autorização).
   O comentário do schema ("empresaId null = visível para todos") está desatualizado desde
   a fase 5 e deve sair junto.

### 16.4 Veredito

Funcional, segura e segregada para ir ao ar, com a ressalva dos três itens de §16.3, que
são ENDURECIMENTO (2ª camada), não correção de vazamento. Os quatro bugs de 500/órfão de
§16.2 estão corrigidos. `tsc` limpo, 117 testes verdes, 15/15 vetores de ataque contidos.

---

## 16.5 RLS em tb_usuario_empresa + dois bugs de acesso multi-empresa (2026-08-06)

Ao implementar o endurecimento escolhido (RLS na tabela de dado pessoal + remuneração),
a investigação revelou **dois bugs funcionais pré-existentes** (introduzidos pela fase 7,
não pela mudança) que trancavam o profissional multi-clínica. Ambos corrigidos.

### O caso Marina — o profissional que trabalha em 5 clínicas

Marina é dona de 1 empresa (33) e membro de outras 4 (31/35 fornecedora, 52/53
veterinária). Nenhuma revogou acesso. Antes:

- **Seletor de contexto** (`/meus-contextos`) mostrava **1 de 5** empresas.
- **Acesso**: com o header de qualquer empresa onde é só MEMBRO, ela caía sempre na 33
  (a que possui). Medido: header 52 → via o animal da 33, não os 3 da 52. Presa numa clínica.

Depois: as 5 empresas no seletor, e cada uma abre com o **perfil daquela empresa**
(FORNECEDOR na 35, VETERINARIO na 52), com o escopo de pacientes correto por perfil.

### Causa comum — leitura de tenant SEM carimbo

Os dois bugs e o RLS novo têm a mesma raiz: código que lê tabela com RLS **fora de um
contexto de empresa**. A fase 7 ligou RLS em `tb_membros_equipe`/`tb_equipes`/`tb_animais`,
e três lugares as leem cross-empresa (ou antes de o tenant existir):

1. **`meusContextos`** (EquipeController) — lista "todas as minhas empresas". Roda sob o
   carimbo da empresa ATIVA, então via só ela. **Fix:** as leituras (`empresa`,
   `membroEquipe`, `animal`, `proprietarioPerfil`, `empresasSemAcesso`) rodam sob
   `comEscopoPlataforma`, com `where: { userId }` em cada uma — vê todos os vínculos
   DAQUELE usuário, de nenhum outro.

2. **Resolução de contexto no `authenticate`** — a validação do header `x-empresa-id`
   pergunta "este usuário pertence a esta empresa?" via subconsultas em `equipes.some.
   membros.some.userId` etc. Sem carimbo, voltavam vazias e o header do NÃO-DONO era
   rejeitado. **Fix:** todo o bloco de resolução (34–128 de `auth.js`) roda sob
   `comEscopoPlataforma`; como cada query filtra por `decoded.id`, o usuário só resolve
   contexto contra os próprios vínculos — o pentest confirma que A segue sem alcançar B.

3. **RLS em `tb_usuario_empresa`** (a tarefa escolhida) — a tabela era control plane
   (sem RLS) porque o login a lê antes de existir tenant. Para ligar o RLS por empresa
   sem trancar o login:
   - `resolverTipoNoContexto` (auth) passou a rodar sob `comEmpresa(req.empresaId)` —
     carimba a empresa para a leitura por (userId, empresaId), que devolve o `perfil`
     gravado (é ele que define o tipo na clínica);
   - `podeAcessarSistema` e `empresasSemAcesso` (leituras "por user_id", cross-empresa, do
     LOGIN) rodam sob `comEscopoPlataforma` + `WHERE user_id = $1`.
   Migration `20260806240000`: ENABLE+FORCE+policy `app_plataforma() OR empresa_id =
   app_empresa_id()`. Aplicada como `nutriadmin` (a app, `zls2vetp1`, não é dona — é o que
   impede desligar o RLS por injeção). Reclassificada de CONTROL_PLANE para TENANT_PLANE
   em `tenancyMap.js` e no gate `tenancyRls.test.js` (agora o teste 1 a verifica).

### Verificação

- `tb_usuario_empresa` sob RLS: empresa 31 vê 14 de 67 vínculos; **sem carimbo vê 0**
  (fail-closed); WITH CHECK recusa gravar linha de outra empresa.
- Marina: 5/5 no seletor; perfil correto por empresa; acesso a cada clínica com o escopo
  do perfil.
- Isolamento cross-tenant mantido (A não alcança B, header de B rejeitado).
- `tsc` limpo · **117 testes + 20 de RLS** (com banco) + `exercitarRotas` verdes.

### Regra que fica

**Toda leitura "por userId" que precise atravessar empresas** (seletor de contexto,
verificação de pertencimento, gate de acesso do login) roda sob `comEscopoPlataforma`
com `WHERE user_id` — nunca sob o carimbo de uma empresa (via só ela) nem sem carimbo
(RLS devolve vazio). É o padrão para qualquer tela nova que liste "minhas empresas".
