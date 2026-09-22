-- 🔴 AS ORIGENS DE UMA LINHA DE FATURA (2026-09-17) — a observação por baixo da cobrança.
--
-- Até aqui a linha da fatura era 1:1 com o registro que a originou: a chave de
-- consolidação incluía a FK de origem e a descrição carregava o número do atendimento
-- (`[AG-0012] Amoxicilina — …`). Consequência: o MESMO medicamento, na MESMA dose e
-- pelo MESMO preço, aplicado em dois atendimentos do mês, virava DUAS linhas idênticas
-- fora o número — e o financeiro somava a olho.
--
-- Agora a linha consolida por (tipo, descrição, animal, valor unitário) e cada execução
-- vira uma CONTRIBUIÇÃO aqui: de qual registro veio, quando e quantas unidades.
--
-- ⚠️ É esta tabela que mantém o ESTORNO certo. Era a FK na chave que impedia "cancelar
-- uma prescrição levar embora a cobrança da outra"; agora quem impede é isto —
-- `removerFaturaItensDaOrigem` SUBTRAI o que era daquela origem e só apaga a linha
-- quando não sobra contribuição nenhuma.
--
-- ⚠️ ADITIVA e SEM BACKFILL (decisão de 2026-09-17). Linha de fatura já lançada fica
-- exatamente como está: sem contribuição, ela cai no comportamento anterior (o estorno
-- apaga a linha inteira, como sempre apagou) e a tela não mostra observação nenhuma.
-- Fundir retroativamente as linhas de faturas ABERTAS mudaria um documento que o
-- cliente talvez já tenha visto, e isso não foi pedido.

-- CreateTable
CREATE TABLE "schs2vet"."tb_fatura_item_origens" (
    "id" SERIAL NOT NULL,
    "fatura_item_id" INTEGER NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL DEFAULT 1,
    -- Quando a execução aconteceu — é a data que aparece na observação. NÃO é
    -- `criado_em`: o lançamento pode ser reprocessado, a aplicação não.
    "ocorrido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exame_clinico_id" INTEGER,
    "prescricao_id" INTEGER,
    "vacina_clinica_id" INTEGER,
    "encaminhamento_clinico_id" INTEGER,

    CONSTRAINT "tb_fatura_item_origens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tb_fatura_item_origens_fatura_item_id_idx" ON "schs2vet"."tb_fatura_item_origens"("fatura_item_id");
CREATE INDEX "tb_fatura_item_origens_prescricao_id_idx" ON "schs2vet"."tb_fatura_item_origens"("prescricao_id");
CREATE INDEX "tb_fatura_item_origens_vacina_clinica_id_idx" ON "schs2vet"."tb_fatura_item_origens"("vacina_clinica_id");
CREATE INDEX "tb_fatura_item_origens_exame_clinico_id_idx" ON "schs2vet"."tb_fatura_item_origens"("exame_clinico_id");
CREATE INDEX "tb_fatura_item_origens_encaminhamento_clinico_id_idx" ON "schs2vet"."tb_fatura_item_origens"("encaminhamento_clinico_id");

-- AddForeignKey — só o PAI. Quando a linha da fatura morre, as contribuições dela
-- morrem junto (elas só existem para explicá-la).
ALTER TABLE "schs2vet"."tb_fatura_item_origens"
  ADD CONSTRAINT "tb_fatura_item_origens_fatura_item_id_fkey"
  FOREIGN KEY ("fatura_item_id") REFERENCES "schs2vet"."tb_fatura_itens"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ As COLUNAS DE ORIGEM ficam SEM FK, de propósito — mesmo precedente de
-- `tb_prescricoes.prestador_id` e de `tb_execucoes_procedimento_prestador.credor_id`:
-- a contribuição é o registro histórico de uma cobrança que aconteceu, e não pode mudar
-- (nem sumir) porque o registro clínico foi excluído. Com `SET NULL` a contribuição
-- viraria uma linha sem origem nenhuma — pior que apontar para um registro inativo;
-- com `CASCADE` a cobrança perderia a explicação dela em silêncio. Na prática nada
-- disso acontece: prescrição, vacina, exame e encaminhamento são SOFT delete.

-- RLS — TENANT VIA PAI (tb_fatura_itens → tb_faturas), espelhando exatamente a policy
-- de `tb_fatura_itens` com um salto a mais. Ver lib/tenancyMap.js#CAMINHO_EXPLICITO.
-- ⚠️ `tb_faturas` mapeia a coluna como "empresa_id" (com underscore) — ao contrário de
-- `tb_estoque_clinica`, que é "empresaId". Errar isso não dá erro de sintaxe: dá uma
-- policy que nunca casa, e a tabela some inteira da leitura.
ALTER TABLE "schs2vet"."tb_fatura_item_origens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fatura_item_origens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fatura_item_origens" ON "schs2vet"."tb_fatura_item_origens";
CREATE POLICY "tenant_tb_fatura_item_origens" ON "schs2vet"."tb_fatura_item_origens"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_fatura_itens" p0 WHERE p0."id" = "fatura_item_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_faturas" p1 WHERE p1."id" = p0."faturaId" AND p1."empresa_id" = "schs2vet"."app_empresa_id"()))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_fatura_itens" p0 WHERE p0."id" = "fatura_item_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_faturas" p1 WHERE p1."id" = p0."faturaId" AND p1."empresa_id" = "schs2vet"."app_empresa_id"()))));
