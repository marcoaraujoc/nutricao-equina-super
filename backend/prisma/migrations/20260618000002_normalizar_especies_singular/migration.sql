-- Migration: 20260618000002_normalizar_especies_singular
-- Normaliza nomes de espécies para o singular e elimina duplicatas.
-- Para cada par (plural, singular): migra todas as FKs para o ID singular e exclui o registro plural.
-- Idempotente: opera apenas quando os registros existem.

DO $$
DECLARE
  v_singular_id INTEGER;
  v_plural_id   INTEGER;

  -- ─── helper: mescla v_plural_id → v_singular_id em todas as tabelas de FK ───
  -- Declarado como bloco inline por não suportar funções aninhadas em DO-blocks.
  -- Repetido para cada par abaixo.
BEGIN

  -- ═══════════════════════════════════════════════════════════════════════
  -- 1. Equinos → Equino
  -- ═══════════════════════════════════════════════════════════════════════
  SELECT id INTO v_singular_id FROM schs2vet.tb_especies WHERE lower(nome) = 'equino'  LIMIT 1;
  SELECT id INTO v_plural_id   FROM schs2vet.tb_especies WHERE lower(nome) = 'equinos' LIMIT 1;

  IF v_plural_id IS NOT NULL THEN
    IF v_singular_id IS NOT NULL THEN
      -- Ambos existem: migrar FKs e deletar o plural
      UPDATE schs2vet.tb_animais             SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_racas               SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_composicao_alimento SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_exigencias_nrc      SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      -- tb_vet_especies: unique(vetPerfilId, especieId) — remove duplicatas antes de atualizar
      DELETE FROM schs2vet.tb_vet_especies
        WHERE "especieId" = v_plural_id
          AND "vetPerfilId" IN (
            SELECT "vetPerfilId" FROM schs2vet.tb_vet_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_vet_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      -- tb_medicamento_especies: unique(medicamentoId, especieId) — remove duplicatas antes
      DELETE FROM schs2vet.tb_medicamento_especies
        WHERE "especieId" = v_plural_id
          AND "medicamentoId" IN (
            SELECT "medicamentoId" FROM schs2vet.tb_medicamento_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_medicamento_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_especies WHERE id = v_plural_id;
    ELSE
      -- Só o plural existe: renomear no lugar
      UPDATE schs2vet.tb_especies SET nome = 'Equino' WHERE id = v_plural_id;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 2. Bovinos → Bovino
  -- ═══════════════════════════════════════════════════════════════════════
  SELECT id INTO v_singular_id FROM schs2vet.tb_especies WHERE lower(nome) = 'bovino'  LIMIT 1;
  SELECT id INTO v_plural_id   FROM schs2vet.tb_especies WHERE lower(nome) = 'bovinos' LIMIT 1;

  IF v_plural_id IS NOT NULL THEN
    IF v_singular_id IS NOT NULL THEN
      UPDATE schs2vet.tb_animais             SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_racas               SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_composicao_alimento SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_exigencias_nrc      SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_vet_especies
        WHERE "especieId" = v_plural_id
          AND "vetPerfilId" IN (
            SELECT "vetPerfilId" FROM schs2vet.tb_vet_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_vet_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_medicamento_especies
        WHERE "especieId" = v_plural_id
          AND "medicamentoId" IN (
            SELECT "medicamentoId" FROM schs2vet.tb_medicamento_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_medicamento_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_especies WHERE id = v_plural_id;
    ELSE
      UPDATE schs2vet.tb_especies SET nome = 'Bovino' WHERE id = v_plural_id;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 3. Caninos → Canino (precaução)
  -- ═══════════════════════════════════════════════════════════════════════
  SELECT id INTO v_singular_id FROM schs2vet.tb_especies WHERE lower(nome) = 'canino'  LIMIT 1;
  SELECT id INTO v_plural_id   FROM schs2vet.tb_especies WHERE lower(nome) = 'caninos' LIMIT 1;

  IF v_plural_id IS NOT NULL THEN
    IF v_singular_id IS NOT NULL THEN
      UPDATE schs2vet.tb_animais             SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_racas               SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_composicao_alimento SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_exigencias_nrc      SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_vet_especies
        WHERE "especieId" = v_plural_id
          AND "vetPerfilId" IN (
            SELECT "vetPerfilId" FROM schs2vet.tb_vet_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_vet_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_medicamento_especies
        WHERE "especieId" = v_plural_id
          AND "medicamentoId" IN (
            SELECT "medicamentoId" FROM schs2vet.tb_medicamento_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_medicamento_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_especies WHERE id = v_plural_id;
    ELSE
      UPDATE schs2vet.tb_especies SET nome = 'Canino' WHERE id = v_plural_id;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 4. Felinos → Felino (precaução)
  -- ═══════════════════════════════════════════════════════════════════════
  SELECT id INTO v_singular_id FROM schs2vet.tb_especies WHERE lower(nome) = 'felino'  LIMIT 1;
  SELECT id INTO v_plural_id   FROM schs2vet.tb_especies WHERE lower(nome) = 'felinos' LIMIT 1;

  IF v_plural_id IS NOT NULL THEN
    IF v_singular_id IS NOT NULL THEN
      UPDATE schs2vet.tb_animais             SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_racas               SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_composicao_alimento SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_exigencias_nrc      SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_vet_especies
        WHERE "especieId" = v_plural_id
          AND "vetPerfilId" IN (
            SELECT "vetPerfilId" FROM schs2vet.tb_vet_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_vet_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_medicamento_especies
        WHERE "especieId" = v_plural_id
          AND "medicamentoId" IN (
            SELECT "medicamentoId" FROM schs2vet.tb_medicamento_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_medicamento_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_especies WHERE id = v_plural_id;
    ELSE
      UPDATE schs2vet.tb_especies SET nome = 'Felino' WHERE id = v_plural_id;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 5. Répteis / Repteis → Réptil (precaução)
  -- ═══════════════════════════════════════════════════════════════════════
  SELECT id INTO v_singular_id FROM schs2vet.tb_especies WHERE lower(nome) = 'réptil'  LIMIT 1;

  SELECT id INTO v_plural_id   FROM schs2vet.tb_especies
    WHERE lower(nome) IN ('répteis', 'repteis', 'reptil') LIMIT 1;

  IF v_plural_id IS NOT NULL THEN
    IF v_singular_id IS NOT NULL THEN
      UPDATE schs2vet.tb_animais             SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_racas               SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_composicao_alimento SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;
      UPDATE schs2vet.tb_exigencias_nrc      SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_vet_especies
        WHERE "especieId" = v_plural_id
          AND "vetPerfilId" IN (
            SELECT "vetPerfilId" FROM schs2vet.tb_vet_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_vet_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_medicamento_especies
        WHERE "especieId" = v_plural_id
          AND "medicamentoId" IN (
            SELECT "medicamentoId" FROM schs2vet.tb_medicamento_especies WHERE "especieId" = v_singular_id
          );
      UPDATE schs2vet.tb_medicamento_especies SET "especieId" = v_singular_id WHERE "especieId" = v_plural_id;

      DELETE FROM schs2vet.tb_especies WHERE id = v_plural_id;
    ELSE
      UPDATE schs2vet.tb_especies SET nome = 'Réptil' WHERE id = v_plural_id;
    END IF;
  END IF;

END $$;
