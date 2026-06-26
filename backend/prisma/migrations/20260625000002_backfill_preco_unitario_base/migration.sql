-- Migration: backfill_preco_unitario_base
-- Popula preco_unitario_base nos itens de estoque já cadastrados
-- usando a quantidade da primeira movimentação ENTRADA de cada item
-- (quantidade original antes de qualquer consumo).
-- Fórmula: valorRepassado / quantidade_em_unidade_base (R$/g ou R$/mL)
-- Itens com unidade desconhecida (ex: 'un', 'balde') recebem NULL
-- e continuam no fallback da aplicação.

UPDATE schs2vet.tb_estoque_clinica e
SET "preco_unitario_base" = sub.preco
FROM (
  SELECT
    e2.id,
    CASE lower(med.unidade)
      WHEN 'g'   THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / m.quantidade               ELSE NULL END
      WHEN 'mg'  THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / (m.quantidade * 0.001)    ELSE NULL END
      WHEN 'kg'  THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / (m.quantidade * 1000.0)   ELSE NULL END
      WHEN 'mcg' THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / (m.quantidade * 0.000001) ELSE NULL END
      WHEN 'ml'  THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / m.quantidade               ELSE NULL END
      WHEN 'l'   THEN CASE WHEN m.quantidade > 0 THEN e2.valor_repassado / (m.quantidade * 1000.0)   ELSE NULL END
      ELSE NULL
    END AS preco
  FROM schs2vet.tb_estoque_clinica e2
  JOIN schs2vet.tb_medicamentos med ON med.id = e2."medicamentoId"
  -- primeira ENTRADA registrada = quantidade original da nota
  LEFT JOIN LATERAL (
    SELECT quantidade
    FROM schs2vet.tb_movimentos_estoque
    WHERE "estoqueId" = e2.id AND tipo = 'ENTRADA'
    ORDER BY "createdAt" ASC
    LIMIT 1
  ) m ON TRUE
  WHERE e2."preco_unitario_base" IS NULL
    AND e2.valor_repassado > 0
) sub
WHERE e.id = sub.id
  AND sub.preco IS NOT NULL;
