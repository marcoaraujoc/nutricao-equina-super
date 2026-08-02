-- Vacina APLICADA PELO PROPRIETÁRIO — irmã de `cliente` (quem FORNECE a dose),
-- exatamente como em `tb_prescricoes` (migration 20260812000001).
--
-- `cliente`                     = quem FORNECE a dose (clínica ou o próprio cliente)
-- `aplicada_pelo_proprietario`  = quem APLICA a dose (a clínica no plantão ou o dono)
--
-- São decisões independentes, e é o CRUZAMENTO delas que decide execução e fatura
-- (mesma matriz da prescrição, documentada no CLAUDE.md):
--
--   fornecida p/ Cliente | aplicada p/ Proprietário | Execução de Prescrição | Fatura
--           não          |           não            |         ENTRA          | na EXECUÇÃO
--           SIM          |           não            |         ENTRA          | nunca
--           não          |           SIM            |        não vai         | na FINALIZAÇÃO
--           SIM          |           SIM            |        não vai         | nunca
--
-- A dose que o dono aplica em casa nunca chega ao plantão: a finalização é a única
-- oportunidade de cobrá-la e de dar baixa no lote que saiu do estoque da clínica.
--
-- NOT NULL DEFAULT false: registro antigo é vacina que a clínica aplica — que é o
-- comportamento que sempre existiu.

ALTER TABLE "schs2vet"."tb_vacinas_clinicas"
  ADD COLUMN IF NOT EXISTS "aplicada_pelo_proprietario" BOOLEAN NOT NULL DEFAULT false;
