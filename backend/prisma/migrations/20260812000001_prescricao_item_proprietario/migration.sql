-- "Será aplicada pelo Proprietário" desce do GRUPO para o ITEM.
--
-- POR QUÊ: uma mesma prescrição mistura o que a clínica aplica no plantão com o que
-- o cliente aplica em casa (ex.: antibiótico injetável na baia + pomada 2x/dia pelo
-- tratador). Com a marca no grupo, o vet era obrigado a escolher entre criar dois
-- documentos ou cobrar/executar algo que ninguém da clínica vai aplicar — e é a
-- mesma natureza do `medicamento_cliente`, que sempre foi por item.
--
-- Item marcado: não aparece na Execução de Prescrição (plantão), não gera FaturaItem
-- e não reserva nem debita estoque. Os demais itens do MESMO documento seguem normais.
--
-- Default false: todo item existente continua sendo executado pela clínica.

ALTER TABLE "schs2vet"."tb_prescricoes"
  ADD COLUMN IF NOT EXISTS "aplicada_pelo_proprietario" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: o que estava marcado no grupo passa a valer para TODOS os itens dele —
-- é exatamente o que a marca do grupo significava.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'schs2vet'
       AND table_name   = 'tb_prescricao_grupos'
       AND column_name  = 'executada_pelo_proprietario'
  ) THEN
    UPDATE "schs2vet"."tb_prescricoes" p
       SET "aplicada_pelo_proprietario" = true
      FROM "schs2vet"."tb_prescricao_grupos" g
     WHERE p."grupoId" = g."id"
       AND g."executada_pelo_proprietario" = true;

    -- Fonte única: com a decisão no item, a coluna do grupo só poderia divergir.
    ALTER TABLE "schs2vet"."tb_prescricao_grupos"
      DROP COLUMN "executada_pelo_proprietario";
  END IF;
END $$;
