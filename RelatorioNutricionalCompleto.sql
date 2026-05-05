WITH ConsumoBase AS (
    SELECT 
        n.id AS nutriente_id,
        n.nome,
        n.unidade,
        al.nome AS alimento,
        (d.quantidade_gramas * ca.valor_por_grama) AS valor_g
    FROM Dieta d
    JOIN Alimentos al ON al.id = d.alimento_id
    JOIN Composicao_Alimento ca ON ca.alimento_id = al.id
    JOIN Nutrientes n ON n.id = ca.nutriente_id
    WHERE d.animal_id = ?   -- parâmetro 1: animal_id
),

Pivo AS (
    SELECT
        nutriente_id,
        nome,
        unidade,
        SUM(CASE WHEN alimento = 'Amino E' THEN valor_g ELSE 0 END) AS AminoE,
        SUM(CASE WHEN alimento = 'Alfafa' THEN valor_g ELSE 0 END) AS Alfafa,
        SUM(CASE WHEN alimento = 'Feno' THEN valor_g ELSE 0 END) AS Feno,
        SUM(CASE WHEN alimento = 'Capim' THEN valor_g ELSE 0 END) AS Capim,
        SUM(CASE WHEN alimento = 'Ração Royal Horse S-280' THEN valor_g ELSE 0 END) AS Racao,
        SUM(CASE WHEN alimento = 'Sal Mineral' THEN valor_g ELSE 0 END) AS Sal,
        SUM(valor_g) AS total_g
    FROM ConsumoBase
    GROUP BY nutriente_id, nome, unidade
),

AvaliacaoNutrientes AS (
    SELECT
        p.nome,
        p.unidade,
        ROUND(
            CASE 
                WHEN p.unidade = 'mg'  THEN p.total_g * 1000
                WHEN p.unidade = 'mcg' THEN p.total_g * 1000000
                ELSE p.total_g 
            END, 2
        ) AS consumo,
        ROUND(e.valor_exigido, 2) AS valor_exigido,
        ROUND(
            e.valor_exigido - 
            (CASE 
                WHEN p.unidade = 'mg'  THEN p.total_g * 1000
                WHEN p.unidade = 'mcg' THEN p.total_g * 1000000
                ELSE p.total_g 
            END), 2
        ) AS saldo,
        ROUND(
            (CASE 
                WHEN p.unidade = 'mg'  THEN p.total_g * 1000
                WHEN p.unidade = 'mcg' THEN p.total_g * 1000000
                ELSE p.total_g 
            END) / NULLIF(e.valor_exigido, 0) * 100, 2
        ) AS percentual_atendido,
        CASE
            WHEN (CASE 
                    WHEN p.unidade = 'mg'  THEN p.total_g * 1000
                    WHEN p.unidade = 'mcg' THEN p.total_g * 1000000
                    ELSE p.total_g 
                 END) / NULLIF(e.valor_exigido, 0) * 100 < 70 THEN 'DEFICIÊNCIA CRÍTICA'
            WHEN ... < 90 THEN 'DEFICIÊNCIA'
            WHEN ... <= 120 THEN 'ADEQUADO'
            WHEN ... <= 200 THEN 'EXCESSO'
            ELSE 'EXCESSO ALTO'
        END AS status_nutricional
    FROM Pivo p
    LEFT JOIN Exigencias_NRC e 
        ON e.nutriente_id = p.nutriente_id 
       AND e.peso = ?               -- parâmetro 2: peso
       AND e.tipo_exercicio = ?     -- parâmetro 3: tipo_exercicio
)

SELECT 
    a.nome AS Nutriente,
    a.unidade,
    ROUND(p.AminoE, 4) AS AminoE,   -- mantemos precisão alta no breakdown
    ROUND(p.Alfafa, 4) AS Alfafa,
    ROUND(p.Feno, 4) AS Feno,
    ROUND(p.Capim, 4) AS Capim,
    ROUND(p.Racao, 4) AS Racao,
    ROUND(p.Sal, 4) AS Sal,
    a.consumo,
    a.valor_exigido,
    a.saldo,
    a.percentual_atendido,
    a.status_nutricional
FROM AvaliacaoNutrientes a
JOIN Pivo p ON p.nutriente_id = a.nutriente_id
ORDER BY 
    CASE a.status_nutricional 
        WHEN 'DEFICIÊNCIA CRÍTICA' THEN 1
        WHEN 'DEFICIÊNCIA' THEN 2
        WHEN 'ADEQUADO' THEN 3
        WHEN 'EXCESSO' THEN 4
        ELSE 5 
    END;