-- ════════════════════════════════════════════════════════════════════════════
-- CONCORRÊNCIA DE EDIÇÃO — prescrição e exame (2026-09-05, parte 5)
--
-- Estende a trava otimista de `20260922000000_concorrencia_edicao` aos dois filhos
-- do atendimento que ainda ficaram de fora.
--
-- ── POR QUE A PRESCRIÇÃO PRECISA, se o gate de status já protege ────────────
-- O gate `SALVO` cobre o depois: item de grupo FINALIZADO/EXECUTADO já é recusado.
-- Ele NÃO cobre o durante — dois profissionais que ambos PODEM editar o mesmo
-- rascunho (dois gestores, ou o gestor e o dono) se sobrescrevem em silêncio:
--
--   10:00  A abre o item "Amoxicilina", vê 250 mg
--   10:01  B abre o mesmo item, vê 250 mg
--   10:02  B corrige para 500 mg  → gravado
--   10:03  A corrige para 750 mg  → gravado POR CIMA, sem aviso
--
-- ⚠️ A versão fica no GRUPO, não no item: o que se disputa é o DOCUMENTO. Incluir
-- e remover item mudam o conjunto, e uma versão por item deixaria passar
-- "A removeu o item 3 enquanto B adicionava o item 4" — cada item com a sua versão
-- intacta, e o documento resultante sendo o de ninguém.
--
-- ── E O EXAME ───────────────────────────────────────────────────────────────
-- Mesmo caso, sem sequer o gate de status como rede: `ExameClinico.atualizar` e o
-- `salvarResultado` gravam sobre o que estiver lá. O laudo é o pior lugar para uma
-- sobrescrita calada — é o dado que fundamenta a conduta.
--
-- ── O QUE ESTA MIGRATION *NÃO* FAZ ──────────────────────────────────────────
-- Não cria `autor_id` em nenhuma das duas. Na evolução ele existe porque `assumir`
-- sobrescrevia `veterinarioId` e apagava o criador; aqui a autoria original já é
-- recuperável — o grupo tem `finalizadoPorId`/`executadoPorId` e o arrasto grava
-- TRANSFERENCIA na auditoria com o dono anterior. Coluna nova que só duplica o que
-- já é consultável é dívida, não garantia.
--
-- Sem RLS novo: as duas tabelas já estão no tenant plane com policy própria.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
  ADD COLUMN IF NOT EXISTS "versao" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "schs2vet"."tb_exames_clinicos"
  ADD COLUMN IF NOT EXISTS "versao" INTEGER NOT NULL DEFAULT 1;
