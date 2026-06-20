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
  // v1: prompt inicial — tendia a inventar nutrientes (ex: Cobre) e confundir valores entre linhas
  // v2: regras estritas linha-a-linha — ainda trocava observação entre linhas (pdf-parse extrai por coluna)
  // v3: estratégia de listas paralelas — extrai cada coluna independentemente, depois une por posição
    // v4: adicionado: extração de data, campo dataExame no JSON, nota GENESIMATRIX sobre números concatenados (1 casa decimal)
  'parse_laudo': {
    version: 'v4',
    build: (texto) => `
Você é um extrator de laudos laboratoriais veterinários em PDF.

IMPORTANTE:
PDFs podem ter texto extraído fora da ordem visual.
As colunas podem aparecer separadas.
NUNCA reconstrua a tabela apenas pela ordem dos números.

Seu trabalho é fazer EXTRAÇÃO ANCORADA POR EXAME.

# REGRAS ABSOLUTAS

- NÃO interpretar exames
- NÃO usar conhecimento médico
- NÃO inferir valores ausentes
- NÃO corrigir OCR
- NÃO inventar linhas
- NÃO associar valores apenas por posição
- NÃO assumir que a ordem dos números corresponde à ordem dos exames

# PROCESSO OBRIGATÓRIO

## PASSO 0 — Data do exame

Localize a data de realização. Procure por: "Realizado", "Realizado em", "Data do Exame", "Data da Coleta", "Coletado".
Ignore datas perto de: "Nascimento", "Nasc".
Converta para o formato YYYY-MM-DD. Se não encontrar, use null.

## PASSO 1 — Identificar exames

Localize todos os exames laboratoriais válidos.

Um exame normalmente aparece como:
- "Cálcio - mg/dL"
- "Ferro (ug/dL)"
- "Sódio - mEq/L"

Para cada exame identificado:
- capture o nome
- capture a unidade original exatamente como aparece

Crie uma lista ordenada de exames.

## PASSO 2 — Extração ancorada

Para CADA exame:

### 2.1 Resultado

⚠️ ATENÇÃO — FORMATO GENESIMATRIX (frequente neste tipo de laudo):
Neste formato, os três números aparecem JUNTOS antes do nome do exame, sem separador visual.
Cada número tem EXATAMENTE 1 casa decimal.
Exemplo: "12,79,013,0" = resultado "12,7" + ref_min "9,0" + ref_max "13,0"
Outro exemplo: "142,0+73,0140,0" = resultado "142,0" (flag "+") + ref_min "73,0" + ref_max "140,0"
Regra de divisão: separe o bloco numérico em grupos de "dígitos,1dígito" consecutivos.

Para o resultado:
- NÃO pode ser o valor mínimo/máximo
- pode conter símbolos como "+" ou "*" (são flags, não fazem parte do número)
- Separe o valor numérico da flag

### 2.2 Intervalo de referência
Busque o intervalo associado ao exame (pode estar no bloco concatenado antes do nome).

Formatos válidos:
- "(9,0 a 13,0)"
- "73,0 a 140,0"
- Dois números consecutivos após o resultado no bloco concatenado

Extrair:
- min
- max

### 2.3 Método
Busque o método associado ao exame.
Exemplos:
- Ferrozine
- Azul de Xilidil

## PASSO 3 — Verificação obrigatória

Antes de responder:

- o número de exames deve ser igual ao número de resultados
- cada exame deve ter no máximo 1 resultado
- não reutilizar resultados
- não reutilizar intervalos
- não reutilizar métodos

Se houver ambiguidade:
- retornar campo vazio
- nunca inferir

# SAÍDA

Retorne SOMENTE JSON válido.

Formato:

{
  "dataExame": "YYYY-MM-DD ou null",
  "exames": [
    {
      "nome": "",
      "resultado": "",
      "flag": "",
      "unidade": "",
      "referencia_min": "",
      "referencia_max": "",
      "metodo": ""
    }
  ]
}

# EXEMPLO

Entrada (formato GENESIMATRIX):
12,79,013,0
Colorimétrico Arsenazo III
Cálcio - mg/dL

Saída:
{
  "dataExame": null,
  "exames": [
    {
      "nome": "Cálcio",
      "resultado": "12,7",
      "flag": "",
      "unidade": "mg/dL",
      "referencia_min": "9,0",
      "referencia_max": "13,0",
      "metodo": "Colorimétrico Arsenazo III"
    }
  ]
}

IMPORTANTE:
- Preserve vírgulas decimais
- Preserve unidades originais
- Não converter para ponto decimal
- Não normalizar texto
- Não escrever explicações
- Não usar markdown
- Responder apenas JSON

## LAUDO A EXTRAIR:

${texto.slice(0, 22000)}`,
  },

  // ── Evolução clínica: interpretação, título e extração de itens faturáveis ──
  // v1: retornava apenas "acoes"
  // v2: adicionado campo "titulo" — título conciso gerado pela LLM
  'interpretacao_clinica': {
    version: 'v2',
    build: (texto) => `Você é um assistente clínico veterinário especializado em equinos.

Analise o texto da evolução clínica abaixo e retorne um JSON com DOIS campos:

1. "titulo": título descritivo e conciso (máximo 60 caracteres) que resume o principal achado ou intervenção. Exemplos: "Avaliação clínica - cólica estomacal", "Vacinação anual - influenza equina", "Exame ortopédico - claudicação MAE".

2. "acoes": lista de itens que possam gerar cobrança ou registro clínico:
   - Medicamentos prescritos  → tipo: "MEDICAMENTO"
   - Procedimentos realizados → tipo: "PROCEDIMENTO"
   - Exames solicitados       → tipo: "EXAME"
   - Encaminhamentos          → tipo: "ENCAMINHAMENTO"
   - Vacinas aplicadas        → tipo: "VACINA"

Estime valores em reais baseados na tabela veterinária brasileira vigente.

Retorne APENAS um JSON válido, sem markdown, sem texto adicional:
{
  "titulo": "Título conciso da evolução clínica",
  "acoes": [
    {
      "tipo": "MEDICAMENTO",
      "descricao": "Amoxicilina 500mg — 1 comprimido 2x ao dia por 7 dias",
      "valorEstimado": 45.00,
      "quantidade": 1
    }
  ]
}

Se não identificar nenhum item faturável, retorne: { "titulo": "...", "acoes": [] }

Texto da evolução:
${texto.slice(0, 8000)}`,
  },

  // ── Histórico clínico: resumo de linha do tempo ──────────────────────────────
  // v1: sumariza lote de eventos numa linha cada
  'resumo_historico': {
    version: 'v1',
    build: (eventos) => `Você é um assistente clínico veterinário. Para cada evento do histórico clínico abaixo, gere um resumo de UMA linha (máximo 90 caracteres) em português, descrevendo objetivamente o que foi feito ou observado.

Regras:
- Máximo 90 caracteres por resumo
- Sem markdown, sem bullets, apenas texto simples
- Use linguagem clínica concisa
- Para evoluções: resuma o principal achado ou conduta clínica
- Para vacinas: mencione o nome da vacina e tipo se disponível
- Para exames: mencione o tipo e resultado resumido se disponível
- Para prescrições: mencione os principais medicamentos/procedimentos
- Para encaminhamentos: mencione a especialidade e motivo resumido

Retorne APENAS um JSON array com exatamente ${eventos.length} itens, sem markdown, sem explicações:
[{"resumo":"..."}]

Eventos:
${JSON.stringify(eventos.map(e => ({
  tipo: e.origem,
  titulo: e.titulo,
  detalhe: typeof e.resumo === 'string' ? e.resumo.slice(0, 400) : null,
})))}`,
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