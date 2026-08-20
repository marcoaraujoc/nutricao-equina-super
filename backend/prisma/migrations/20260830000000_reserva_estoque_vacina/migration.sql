-- Reserva de doses de VACINA — espelho de tb_reservas_estoque (prescrição/medicamento).
-- Criada ao FINALIZAR (SALVA→FINALIZADA), consumida ao EXECUTAR, liberada ao CANCELAR
-- antes da execução. Ver CLAUDE.md e o comentário do model ReservaEstoqueVacina.

-- CreateTable
CREATE TABLE "schs2vet"."tb_reservas_estoque_vacina" (
    "id" SERIAL NOT NULL,
    "loteVacinaId" INTEGER NOT NULL,
    "vacinaClinicaId" INTEGER NOT NULL,
    "animalId" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_reservas_estoque_vacina_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tb_reservas_estoque_vacina_loteVacinaId_idx" ON "schs2vet"."tb_reservas_estoque_vacina"("loteVacinaId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_reservas_estoque_vacina_vacinaClinicaId_loteVacinaId_key" ON "schs2vet"."tb_reservas_estoque_vacina"("vacinaClinicaId", "loteVacinaId");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina" ADD CONSTRAINT "tb_reservas_estoque_vacina_loteVacinaId_fkey" FOREIGN KEY ("loteVacinaId") REFERENCES "schs2vet"."tb_lotes_vacina"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina" ADD CONSTRAINT "tb_reservas_estoque_vacina_vacinaClinicaId_fkey" FOREIGN KEY ("vacinaClinicaId") REFERENCES "schs2vet"."tb_vacinas_clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina" ADD CONSTRAINT "tb_reservas_estoque_vacina_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — TENANT VIA PAI (tb_lotes_vacina), mesmo padrão de tb_reservas_estoque (pai
-- tb_estoque_clinica) — ver fase 7c / lib/tenancyMap.js#CAMINHO_EXPLICITO. LoteVacina
-- carrega empresa_id direto (coluna mapeada, ao contrário de tb_estoque_clinica que é
-- "empresaId" sem underscore), então a subconsulta usa "empresa_id".
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_reservas_estoque_vacina" ON "schs2vet"."tb_reservas_estoque_vacina";
CREATE POLICY "tenant_tb_reservas_estoque_vacina" ON "schs2vet"."tb_reservas_estoque_vacina"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_lotes_vacina" p0 WHERE p0."id" = "loteVacinaId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_lotes_vacina" p0 WHERE p0."id" = "loteVacinaId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));
