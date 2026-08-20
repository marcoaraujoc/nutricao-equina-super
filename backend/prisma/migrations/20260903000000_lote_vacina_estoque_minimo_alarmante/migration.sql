-- Alertas de nível de estoque (doses) para lote de vacina — mesma lógica de
-- tb_estoque_clinica.estoque_minimo/.estoque_alarmante (farmácia): mínimo =
-- alerta vermelho (🔴 Crítico), alarmante = alerta amarelo (🟡 Alarmante).
-- Habilita as mesmas abas "Crítico"/"Alarmante" na tela de Estoque de Vacinas.

ALTER TABLE "schs2vet"."tb_lotes_vacina" ADD COLUMN IF NOT EXISTS "estoque_minimo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "schs2vet"."tb_lotes_vacina" ADD COLUMN IF NOT EXISTS "estoque_alarmante" INTEGER NOT NULL DEFAULT 0;
