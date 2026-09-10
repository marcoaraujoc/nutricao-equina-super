'use strict';
/**
 * Seed 005 — Exames de imagem COMO PROCEDIMENTOS (2026-09-09)
 *
 * 🔴 POR QUE ESTE SEED EXISTE: até aqui o exame de imagem vivia em um catálogo
 * PRÓPRIO (`tb_imagem_exame_grupos`/`_itens`), paralelo a `tb_procedimentos_vet`.
 * Os dois descreviam a mesma coisa, e era essa duplicidade que deixava o exame de
 * imagem SEM preço, SEM prestador e SEM entrar em combo/orçamento — tudo isso já
 * existe para procedimento e teria de ser reescrito no outro catálogo.
 *
 * Decisão (2026-09-09): UNIFICAR. Os 119 exames passam a ser procedimentos GLOBAIS
 * (`empresa_id IS NULL`, catálogo misto — CLAUDE.md §5) e daí em diante herdam de
 * graça o valor por empresa (`tb_procedimento_valores_empresa`), o vínculo com
 * prestador e os dois valores (`tb_procedimento_prestadores`), o combo e o orçamento.
 *
 * ⚠️ O catálogo `tb_imagem_exame_*` CONTINUA existindo e continua sendo semeado: é a
 * FONTE deste seed (`GRUPOS`/`ITENS` importados do 004). Não apagar.
 *
 * ⚠️ A faixa de códigos PR-0302..PR-0420 foi conferida no banco antes de escrever
 * isto: estava LIVRE em `tb_procedimentos_vet` (o maior código era PR-0301). O
 * `codigo` é @unique e é ele que torna o upsert idempotente — rodar duas vezes não
 * duplica nada.
 *
 * ⚠️ ESCRITA EM TABELA SOB RLS: `tb_procedimentos_vet` é CATÁLOGO MISTO com FORCE ROW
 * LEVEL SECURITY, então a linha global só entra sob `app.plataforma` — o que exige o
 * client ESTENDIDO de tenant rodando dentro de `comEscopoPlataforma` (é o que
 * `backend/seed.js` faz). Um `new PrismaClient()` puro é recusado pela policy.
 */

const { GRUPOS, ITENS } = require('./004_imagem_exames.seed');

/**
 * Grupo do catálogo de imagem → CATEGORIA MAIOR (o que se escolhe na tela) +
 * SUBCATEGORIA (o recorte dentro dela).
 *
 * ⚠️ Mapa EXPLÍCITO, e não `split(' - ')`: nome de catálogo não pode depender de
 * heurística de string — "Laparoscopia Diagnóstica" e "Tomografia e Ressonância
 * (Encaminhamento)" não têm o hífen, e um deles viraria categoria com nome errado
 * sem ninguém notar. Grupo NOVO que não esteja aqui é avisado no console em vez de
 * entrar calado numa categoria inventada.
 */
const CATEGORIA_POR_GRUPO = {
  'Radiografia - Membro Torácico':             { categoria: 'Radiografia',              subcategoria: 'Membro Torácico' },
  'Radiografia - Membro Pélvico':              { categoria: 'Radiografia',              subcategoria: 'Membro Pélvico' },
  'Radiografia - Axial':                       { categoria: 'Radiografia',              subcategoria: 'Axial' },
  'Radiografia - Membro (Bovino)':             { categoria: 'Radiografia',              subcategoria: 'Membro (Bovino)' },
  'Ultrassonografia - Reprodutivo Fêmea':      { categoria: 'Ultrassonografia',         subcategoria: 'Reprodutivo Fêmea' },
  'Ultrassonografia - Reprodutivo Macho':      { categoria: 'Ultrassonografia',         subcategoria: 'Reprodutivo Macho' },
  'Ultrassonografia - Aparelho Locomotor':     { categoria: 'Ultrassonografia',         subcategoria: 'Aparelho Locomotor' },
  'Ultrassonografia - Geral':                  { categoria: 'Ultrassonografia',         subcategoria: 'Geral' },
  'Endoscopia':                                { categoria: 'Endoscopia',               subcategoria: null },
  'Termografia':                               { categoria: 'Termografia',              subcategoria: null },
  'Tomografia e Ressonância (Encaminhamento)': { categoria: 'Tomografia e Ressonância', subcategoria: 'Encaminhamento' },
  'Laparoscopia Diagnóstica':                  { categoria: 'Laparoscopia',             subcategoria: 'Diagnóstica' },
};

/**
 * As categorias na ORDEM em que aparecem no seletor. Exportada porque o cadastro de
 * procedimentos e a aba Imagem do pedido de exames precisam da MESMA lista —
 * deduzi-la de um `SELECT DISTINCT categoria` daria a ordem alfabética, que não é a
 * ordem clínica, e ela mudaria sozinha quando a clínica criasse a primeira categoria
 * própria.
 */
const CATEGORIAS_IMAGEM = [
  'Radiografia', 'Ultrassonografia', 'Endoscopia',
  'Termografia', 'Tomografia e Ressonância', 'Laparoscopia',
];

/** Marca da linha de imagem dentro de `tb_procedimentos_vet`. */
const TIPO_IMAGEM = 'IMAGEM';

/**
 * ⚠️ `especialidade` continua 'Diagnóstico por Imagem' NO DADO, embora ela tenha
 * saído do SELETOR da tela (pedido de 2026-09-09). São coisas diferentes: no dado é
 * a verdade clínica, e é o que mantém o exame compatível com quem lê especialidade
 * (orçamento, combo, filtro de espécies atendidas); na tela quem organiza é a
 * CATEGORIA. Zerar o campo faria cada leitor tratar o null do seu jeito.
 */
const ESPECIALIDADE_IMAGEM = 'Diagnóstico por Imagem';

async function seedProcedimentosImagem(prisma) {
  let inseridos = 0;
  const semMapa = [];

  for (const grupo of GRUPOS) {
    const mapa = CATEGORIA_POR_GRUPO[grupo.nome];
    if (!mapa) { semMapa.push(grupo.nome); continue; }

    for (const item of (ITENS[grupo.nome] ?? [])) {
      // Upsert por `codigo` (@unique). O `nome` NÃO serve de chave: o mesmo exame
      // existe para membro esquerdo e direito, e é o código que os distingue.
      //
      // ⚠️ ARMADILHA: o índice único de `codigo` nesta base é PARCIAL
      // (`... UNIQUE (codigo) WHERE codigo IS NOT NULL` — há 641 procedimentos sem
      // código). `ON CONFLICT (codigo)` sozinho NÃO casa com índice parcial e morre
      // com `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
      // specification`. O predicado tem de ser REPETIDO na cláusula.
      await prisma.$executeRawUnsafe(
        `INSERT INTO schs2vet.tb_procedimentos_vet
           (codigo, nome, "nomeAbreviado", categoria, subcategoria, especialidade,
            "tipoProcedimento", especie, empresa_id, ativo, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, true,
                 NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
         ON CONFLICT (codigo) WHERE codigo IS NOT NULL DO UPDATE SET
           nome               = EXCLUDED.nome,
           "nomeAbreviado"    = EXCLUDED."nomeAbreviado",
           categoria          = EXCLUDED.categoria,
           subcategoria       = EXCLUDED.subcategoria,
           especialidade      = EXCLUDED.especialidade,
           "tipoProcedimento" = EXCLUDED."tipoProcedimento",
           especie            = EXCLUDED.especie,
           ativo              = true,
           "updatedAt"        = NOW() AT TIME ZONE 'UTC'`,
        item.codigo,
        item.nome,
        item.sigla ?? null,
        mapa.categoria,
        mapa.subcategoria,
        ESPECIALIDADE_IMAGEM,
        TIPO_IMAGEM,
        item.especie ?? 'Ambas',
      );
      inseridos++;
    }
  }

  // ── Os genéricos que estes exames SUBSTITUEM ────────────────────────────────
  // 🔴 INATIVA, nunca APAGA: "Radiografia digital", "Ultrassonografia abdominal" e
  // companhia podem estar dentro de orçamento, prescrição ou combo já fechados, e
  // apagá-los deixaria o histórico apontando para o vazio. Inativar tira da tela e
  // preserva o registro — a mesma exclusão lógica do resto do sistema.
  //
  // ⚠️ Só GLOBAL (`empresa_id IS NULL`) e só o que NÃO é de imagem: procedimento que
  // a própria clínica cadastrou é DELA e não se toca daqui (multi-tenant).
  // Reversível com um UPDATE de `ativo = true`.
  const desativados = await prisma.$executeRawUnsafe(
    `UPDATE schs2vet.tb_procedimentos_vet
        SET ativo = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
      WHERE especialidade = $1
        AND empresa_id IS NULL
        AND ("tipoProcedimento" IS DISTINCT FROM $2)
        AND ativo = true`,
    ESPECIALIDADE_IMAGEM,
    TIPO_IMAGEM,
  );

  if (semMapa.length) {
    console.warn(`  ⚠ Grupos de imagem sem categoria mapeada (ignorados): ${semMapa.join(', ')}`);
  }
  console.log(`  ✓ Exames de imagem como procedimentos: ${inseridos} itens; ${desativados} genéricos inativados`);
}

module.exports = {
  seedProcedimentosImagem,
  CATEGORIAS_IMAGEM,
  CATEGORIA_POR_GRUPO,
  TIPO_IMAGEM,
  ESPECIALIDADE_IMAGEM,
};
