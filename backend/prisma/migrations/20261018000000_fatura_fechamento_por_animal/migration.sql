-- 🔴 FECHAR A FATURA POR ANIMAL (2026-09-22) — o bloco de UM paciente fecha sozinho,
-- e o que ele cobra SAI do total da fatura.
--
-- POR QUÊ: a fatura é do PROPRIETÁRIO e junta todos os pacientes dele (seção
-- "Informação do Cavalo" por animal). Quando um cavalo é vendido, muda de responsável
-- ou é acertado à parte no meio do ciclo, não havia como encerrar SÓ a parte dele: ou
-- se fechava a fatura inteira (cobrando junto o que ainda está aberto dos outros
-- pacientes) ou se removia item por item — e remover apaga a cobrança.
--
-- COMO: a marca é NO ITEM (`fechado_em`), não numa tabela de "fechamento por animal".
-- É o que faz a cobrança que chegar DEPOIS do fechamento nascer ABERTA e voltar a
-- contar no total — com a marca no par (fatura, animal), toda dose aplicada depois
-- cairia calada dentro de um bloco já encerrado e o cliente deixaria de ser cobrado.
-- O bloco do animal pode ser fechado de novo quantas vezes o ciclo pedir.
--
-- ⚠️ `total` de `tb_faturas` passa a ser O QUE ESTA FATURA COBRA — só os itens ABERTOS.
-- `total_fechado` guarda o que saiu (os itens fechados por animal), para que nenhum
-- indicador perca dinheiro em silêncio: "contas a receber" e "devedores" somam os DOIS
-- (o bloco fechado continua devido, só é acertado à parte). Quem mantém os dois é
-- `recalcularTotal` em lib/faturaUtils.js — fonte ÚNICA do total, como sempre foi.
--
-- ⚠️ ADITIVA e SEM BACKFILL: item já lançado nasce com `fechado_em` NULO, ou seja,
-- ABERTO — que é exatamente o comportamento de hoje. `total_fechado` começa em 0 em
-- toda fatura e só muda quando alguém fechar um bloco. Nenhuma fatura existente muda
-- de valor ao aplicar esta migration.

ALTER TABLE "schs2vet"."tb_fatura_itens"
  ADD COLUMN IF NOT EXISTS "fechado_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fechado_por_id" INTEGER;

ALTER TABLE "schs2vet"."tb_faturas"
  ADD COLUMN IF NOT EXISTS "total_fechado" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ⚠️ `fechado_por_id` fica SEM FK, de propósito — mesmo precedente de
-- `tb_prescricoes.prestador_id` e de `tb_fatura_item_origens`: é registro HISTÓRICO de
-- quem encerrou o bloco e não pode virar null (nem sumir) porque a conta de quem fechou
-- foi excluída depois. A tela resolve o nome quando precisa e cai em "—" se não achar.

-- O recorte que a tela e o fechamento fazem o tempo todo: os itens de UM animal dentro
-- de UMA fatura, separando abertos de fechados.
CREATE INDEX IF NOT EXISTS "tb_fatura_itens_faturaId_animalId_fechado_em_idx"
  ON "schs2vet"."tb_fatura_itens" ("faturaId", "animalId", "fechado_em");

-- RLS: NADA a fazer. As duas tabelas já têm policy própria (`tb_fatura_itens` pelo pai
-- `faturaId` → `tb_faturas."empresa_id"`, ver lib/tenancyMap.js), e coluna nova entra
-- sob a policy que já existe. É por isso que o fechamento por animal virou COLUNA e não
-- tabela nova: tabela exigiria policy, entrada no tenancyMap e inventário de órfãs.
