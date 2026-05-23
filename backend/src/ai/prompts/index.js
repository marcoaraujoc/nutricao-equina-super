// src/ai/prompts/index.js
// =============================================================================
// Catálogo canônico de prompts do S2Vet.
//
// Convenção:
//   - Cada entrada tem: version (string semântica), build (função ou string)
//   - operacao ao logar = chave do prompt + '@' + version  ex: 'parse_laudo@v1'
//   - Para evoluir um prompt: incremente version e mantenha a entrada antiga
//     comentada para rastreabilidade histórica
// =============================================================================
'use strict';

const PROMPTS = {

  // ── Exames nutricionais: parse de PDF de laudo ──────────────────────────────
  'parse_laudo': {
    version: 'v1',
    build: (texto) => `Você é um especialista em extração de laudos laboratoriais veterinários.

Primeiro, encontre a **data do exame** (data real da análise/coleta):
- Procure por palavras como: "Realizado em", "Data do Exame", "Data da Coleta", "Data de Realização", "Requisição", "Exame realizado", "Coleta".
- **Ignore completamente** qualquer data próxima de: "Nascimento", "Nasc", "Data de Nasc", "Aniversário", "Niver", "Data de Nascimento".

Depois, extraia **TODOS** os exames, incluindo:
- Cobre
- Relação Sódio/Potássio
- Qualquer outro nutriente que aparecer na tabela.

Retorne APENAS um JSON válido, sem markdown, sem texto antes ou depois:

{
  "dataExame": "YYYY-MM-DD",
  "exames": [
    {
      "nomeNutriente": "Cobre",
      "valorEncontrado": 72.4,
      "unidade": "ug/dL",
      "valorMinRef": 0.0,
      "valorMaxRef": 0.0,
      "observacao": "Colorimétrico",
      "statusClinico": "alto"
    }
  ]
}

Texto completo do laudo:
${texto.slice(0, 22000)}`,
  },

  // ── Evolução clínica: interpretação e extração de itens faturáveis ──────────
  'interpretacao_clinica': {
    version: 'v1',
    build: (texto) => `Você é um assistente clínico veterinário especializado.

Analise o texto da evolução clínica abaixo e identifique APENAS itens que possam gerar cobrança ou registro clínico:
- Medicamentos prescritos  → tipo: "MEDICAMENTO"
- Procedimentos realizados → tipo: "PROCEDIMENTO"
- Exames solicitados       → tipo: "EXAME"
- Encaminhamentos          → tipo: "ENCAMINHAMENTO"
- Vacinas aplicadas        → tipo: "VACINA"

Estime valores em reais baseados na tabela veterinária brasileira vigente.

Retorne APENAS um JSON válido, sem markdown, sem texto adicional:
{
  "acoes": [
    {
      "tipo": "MEDICAMENTO",
      "descricao": "Amoxicilina 500mg — 1 comprimido 2x ao dia por 7 dias",
      "valorEstimado": 45.00,
      "quantidade": 1
    }
  ]
}

Se não identificar nenhum item faturável, retorne: { "acoes": [] }

Texto da evolução:
${texto.slice(0, 8000)}`,
  },

  // ── Composição alimentar: rótulo em imagem (Gemini Vision) ──────────────────
  'parse_composicao_visao': {
    version: 'v1',
    // Não tem build — é um prompt de sistema fixo enviado junto com a imagem
    text: `Você é um especialista em nutrição animal. Analise esta imagem de rótulo de produto e extraia TODOS os dados da seção nutricional.

A seção pode ter vários nomes: "Níveis de Garantia", "Níveis de Garantia por Kg", "Informação Nutricional", "Composição Garantida", "Análise Garantida", "Composición", etc.

FORMATOS POSSÍVEIS — saiba identificar cada um:
1. TABELA COM UMA COLUNA DE VALOR: extraia direto.
2. TABELA COM MÚLTIPLAS COLUNAS (ex: "por tablete" e "por kg"): use SEMPRE a coluna "por kg" ou "total/por kg". Ignore colunas "por porção", "por tablete", "por dose".
3. PARÁGRAFO CORRIDO: os nutrientes aparecem em texto contínuo separados por vírgula. Ex: "proteína bruta (mín.) 140 g/kg, extrato etéreo (mín.) 70 g/kg, ...". Extraia cada par nutriente+valor+unidade.
4. LISTA SIMPLES: nutriente em uma linha, valor e unidade na mesma linha ou na próxima.

BASE DE CÁLCULO:
- Se o título disser "por kg" ou "g/kg": use os valores como estão — não altere nada.
- Se o título disser "por 100g" ou "100g": multiplique APENAS O VALOR NUMÉRICO por 10. Nunca altere a unidade. Exemplos corretos: 635mg → valor 6350, unidade "mg"; 2,26g → valor 22,6, unidade "g"; 450UI → valor 4500, unidade "UI".
- Se a unidade for %, mantenha como % (não converta e não multiplique por 10).
- PROIBIDO converter entre unidades: não transforme mg em g, não transforme g em mg, não transforme UI em mg. A unidade de saída deve ser idêntica à unidade impressa no rótulo.

Retorne APENAS um objeto JSON válido, sem texto antes ou depois, sem blocos de código markdown:

{
  "nomeAlimento": "nome do produto conforme aparece no rótulo, ou null se não encontrado",
  "baseCalculo": "kg" ou "100g",
  "nutrientes": [
    {
      "nome": "nome do nutriente sem indicadores como (mín.) (máx.) (min.) (max.)",
      "valor": 0.00,
      "unidade": "g/kg"
    }
  ]
}

Regras finais:
1. Remova os indicadores (mín.), (máx.), (min.), (max.) do nome do nutriente.
2. Não invente valores — use apenas o que está claramente visível.
3. Se não conseguir ler um valor com segurança, use null.
4. Inclua TODOS os nutrientes visíveis, mesmo probióticos (UFC/g) e energia (kcal/kg).
5. Normalize variações de escrita: "Proteina bruta" e "Proteína Bruta" são o mesmo nutriente.`,
  },

  // ── Composição alimentar: rótulo em texto (PDF extraído) ────────────────────
  'parse_composicao_texto': {
    version: 'v1',
    build: (texto) => `Você é um especialista em nutrição animal. Extraia todos os nutrientes do texto abaixo,
proveniente de um rótulo de produto animal.

A seção pode se chamar: "Níveis de Garantia", "Informação Nutricional", "Composição Garantida", etc.

Retorne APENAS um objeto JSON válido, sem texto antes ou depois, sem blocos de código markdown:

{
  "nomeAlimento": "nome do produto se encontrado, ou null",
  "nutrientes": [
    {
      "nome": "nome do nutriente sem (mín.) ou (máx.)",
      "valor": 0.00,
      "unidade": "g/kg"
    }
  ]
}

Regras:
1. Se valores forem por 100g, multiplique APENAS O VALOR NUMÉRICO por 10 para converter para por kg. Nunca altere a unidade (mg continua mg, g continua g). Exemplo: 635mg/100g → valor 6350, unidade "mg".
2. Se a unidade for %, mantenha como % (não converta).
3. Não invente valores — use apenas o que está no texto.
4. Inclua todos os nutrientes encontrados.

Texto:
${texto.slice(0, 20000)}`,
  },
};

/**
 * Retorna o prompt construído para uma operação, já com a versão embutida.
 * @param {string} key  — chave do catálogo (ex: 'parse_laudo')
 * @param {any}    vars — variáveis para o prompt (texto, parâmetros, etc.)
 * @returns {{ operacaoVers: string, prompt: string }}
 */
function buildPrompt(key, vars) {
  const entry = PROMPTS[key];
  if (!entry) throw new Error(`Prompt "${key}" não encontrado no catálogo.`);

  const operacaoVers = `${key}@${entry.version}`;

  if (typeof entry.build === 'function') {
    return { operacaoVers, prompt: entry.build(vars) };
  }
  if (typeof entry.text === 'string') {
    return { operacaoVers, prompt: entry.text };
  }
  throw new Error(`Prompt "${key}" não tem campo "build" nem "text".`);
}

module.exports = { PROMPTS, buildPrompt };