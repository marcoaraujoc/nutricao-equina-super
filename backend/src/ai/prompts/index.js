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

  // ── Resumo consolidado de atendimentos do animal (painel AnimalDetail) ──────
  // v1: recebe o resumo salvo (pode ser vazio) + eventos novos e devolve o resumo
  // ATUALIZADO completo em texto corrido (append incremental).
  'resumo_atendimentos': {
    version: 'v1',
    build: ({ resumoAtual, eventos, animalNome }) => `Você é um médico-veterinário responsável pelo prontuário do paciente${animalNome ? ` "${animalNome}"` : ''}.

Abaixo está o RESUMO CLÍNICO CONSOLIDADO atual do paciente (pode estar vazio) e uma lista de NOVOS EVENTOS (atendimentos, vacinas, exames, prescrições, encaminhamentos e serviços lançados manualmente na fatura).

Sua tarefa: devolver o resumo consolidado ATUALIZADO, incorporando os novos eventos ao histórico.

Regras:
- Escreva em português do Brasil, tom clínico e objetivo.
- Organize cronologicamente (mais antigo → mais recente), citando datas no formato dd/mm/aaaa.
- Preserve as informações relevantes do resumo atual — não descarte histórico; apenas condense o que ficou redundante.
- Agrupe eventos do mesmo dia numa mesma linha quando fizer sentido.
- Inclua serviços lançados manualmente na fatura (ex.: atendimento emergencial) como parte do histórico.
- Máximo de ~350 palavras. Sem markdown, sem títulos, sem bullets — apenas parágrafos curtos de texto simples.
- Retorne APENAS o texto do resumo atualizado, sem comentários nem explicações.

RESUMO ATUAL:
${(resumoAtual || '(vazio — primeiro resumo do paciente)').slice(0, 4000)}

NOVOS EVENTOS:
${JSON.stringify(eventos.slice(0, 80))}`,
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

  // ── Body-map + scores equinos: texto da evolução → ResumoAtendimento ────────
  // v1: prompt inicial — léxico coloquial, plural→bilateral, anáfora "correspondente",
  //     roteamento de terapia sem local para nao_localizado, sinalização de ditado truncado
  // v2: generalizado para QUALQUER especialidade de evolução (não só ditado de fisio/quiro);
  //     adicionado bloco opcional "resumoClinico" (claudicação AAEP, dor 0-10, tensão
  //     muscular por região, simetria, ROM, orientações de treino) para o relatório
  //     comparativo entre sessões — usado por EvolucaoController.relatorioAtendimento
  // v3: léxico de modalidades (PEMF/campo eletromagnético pulsátil → campo_magnetico,
  //     laser terapêutico → laser_led, etc.) + regra de NEGAÇÃO (achados negados como
  //     "sem dor à palpação" NÃO geram registro no mapa)
  // v4: regra REGIÃO INTEIRA assertiva — "cervical"/"dorso"/"garupa" sem vértebra
  //     explícita = SEMPRE a região completa (grupo cervical / parte dorso / parte
  //     garupa), NUNCA vértebras isoladas; exemplo 1 reescrito com ditado real
  // v5: laudos de FERRAGEAMENTO (alvo tipo:"casco" — partes do casco + membro
  //     AE/AD/PE/PD, pintado sobre casco.png) e ODONTOLOGIA (alvo tipo:"dente" —
  //     Triadan d<q>_<pos>, pintado sobre odontologia.png); modalidade
  //     "procedimento" para intervenções (ferradura, casqueamento, nivelamento...)
  // v6: prompt COMPACTADO — o request (prompt + max_tokens) estourava o teto de
  //     12k tokens/min do Groq on-demand (413 Request too large) e a extração
  //     falhava SEMPRE. Vértebras viram linhas-padrão, grupos sem expansão de
  //     partes, exemplo 3 enxuto, ditado limitado a 6k chars.
  'extrair_resultado_sessao_equino': {
    version: 'v6',
    build: (texto) => {
      // Léxico embutido dinamicamente a partir do domínio (fonte única de verdade —
      // nunca hardcodar IDs aqui: se a taxonomia mudar, o prompt acompanha sozinho).
      const { PARTES_EQUINAS } = require('../../models/anatomia-equina/anatomia-equina.taxonomy');
      const { GRUPOS_EQUINOS } = require('../../models/anatomia-equina/anatomia-equina.grupos');
      const { MODALIDADES_TERAPIA } = require('../../models/anatomia-equina/s2vet-clinica.model');
      const { PARTES_CASCO } = require('../../models/anatomia-casco/casco.model');

      // Compacto: vértebras (41) não são listadas uma a uma — viram o bloco de
      // padrões em "# PARTES ANATÔMICAS"; grupos não expandem suas partes.
      const linhasPartesCompacto = Object.values(PARTES_EQUINAS)
        .filter((p) => p.tipo !== 'vertebra')
        .map((p) => `${p.id} — "${p.nome['pt-BR']}" (${p.paridade})`)
        .join('\n');
      const linhasGruposCompacto = Object.values(GRUPOS_EQUINOS)
        .map((g) => `${g.id} — "${g.nome['pt-BR']}" (${g.paridade})`)
        .join('\n');

      const linhasCasco = Object.values(PARTES_CASCO)
        .map((p) => `${p.id} — "${p.nome}"`)
        .join('\n');

      const linhasModalidades = Object.values(MODALIDADES_TERAPIA)
        .map((m) => `${m.id} (exigeLocal: ${m.exigeLocal})`)
        .join('\n');

      return `Você é um assistente de extração clínica veterinária equina. O texto abaixo é
o registro de uma evolução clínica — pode ser de QUALQUER especialidade (fisioterapia,
quiropraxia, clínica geral, ortopedia, etc.), escrito ou ditado pelo veterinário. Sua
tarefa é extrair DUAS coisas, ambas OPCIONAIS — extraia apenas o que estiver realmente
presente no texto, nunca invente para preencher uma seção:

1. "registros": achados de exame / avaliações funcionais / terapias aplicadas com
   localização anatômica (para pintar o mapa corporal do cavalo).
2. "resumoClinico": indicadores clínicos comparáveis entre sessões (claudicação, dor,
   tensão muscular, simetria, amplitude de movimento, orientações de treino) — só
   preencha os campos que o texto realmente mencionar; a maioria das evoluções (ex.:
   vacinação, exame de rotina) não vai mencionar nada disso, e nesse caso
   "resumoClinico" deve ser omitido inteiramente.

# REGRAS ABSOLUTAS

- NÃO invente achados, testes, terapias ou scores que não estejam explicitamente no texto.
- NÃO force um "parteId"/"grupoId" que não corresponda ao termo dito — se não houver
  correspondência clara na lista abaixo, use tipo:"nao_localizado" com a descrição literal.
- Use APENAS os ids de partes/grupos/modalidades listados abaixo. Nunca invente um id novo.
- Cada frase do ditado deve virar NO MÁXIMO um registro por achado/teste/terapia mencionado
  — não funda dois achados distintos num só registro, não duplique o mesmo achado.
- "proveniencia.trechoOriginal" deve ser um trecho VERBATIM (copiado) do ditado, nunca parafraseado.

# PARTES ANATÔMICAS (parteId — nome — paridade)
${linhasPartesCompacto}
Vértebras individuais (paridade mediano; use SÓ quando o texto NOMEAR a vértebra):
ids no padrão vertebra_c1..c7 (cervicais), vertebra_t1..t18 (torácicas),
vertebra_l1..l6 (lombares), vertebra_s1..s5 (sacrais), vertebra_cd1..cd5 (caudais).
Ex.: "T14" → vertebra_t14; "C3" → vertebra_c3.

# GRUPOS ANATÔMICOS (grupoId — nome — paridade)
${linhasGruposCompacto}

# MODALIDADES DE TERAPIA (modalidadeId — exigeLocal)
${linhasModalidades}

# LÉXICO COLOQUIAL → TÉCNICO (equivalências que o veterinário usa ao falar)
- "espada" / "espádua" → grupo "espadua" (escápula + articulação do ombro)
- "nuca" → grupo "nuca" (C1–C2, atlas/áxis)
- "joelho" (do membro torácico/anterior) → parte "carpo_ant" — no cavalo, o "joelho"
  popular é anatomicamente o carpo (o joelho verdadeiro é a "soldra", membro pélvico)
- "curvilhão" / "jarrete" → parte "jarrete_tarso"
- "canela" → "metacarpo" (anterior) ou "metatarso" (posterior) conforme o membro citado
- "garupa" → parte "garupa" (sacro/pelve, mediano)
- "cernelha" → parte "cernelha"
- "lombo" / "região lombar" / "lombar" → parte "lombo"
- "dorso" / "costas" (região torácica) → parte "dorso"
- "coluna" / "coluna vertebral" (sem indicar um trecho específico) → grupo "coluna"
- "cervical" / "pescoço" → grupo "cervical" — SEMPRE a região INTEIRA (C1–C7); só use
  uma vértebra isolada se o veterinário nomear a vértebra ("C3", "terceira cervical")
- "membros anteriores" / "membros torácicos" → grupo "membro_toracico"
- "membros posteriores" / "membros pélvicos" / "membros traseiros" → grupo "membro_pelvico"
- Se o termo dito não corresponder a nada acima nem à lista de partes/grupos, use
  tipo:"nao_localizado" com "descricao" = o termo tal como foi dito.

# LÉXICO DE MODALIDADES (termos que o veterinário usa → modalidadeId)
- "laser", "laser terapêutico", "laserterapia", "LED", "fotobiomodulação" → "laser_led"
- "campo magnético", "campo eletromagnético", "campo eletromagnético pulsátil",
  "magnetoterapia", "PEMF" → "campo_magnetico"
- "eletroacupuntura", "acupuntura", "agulhamento" → "eletroacupuntura"
- "terapia manual", "mobilização", "massagem", "liberação miofascial",
  "ajuste quiroprático" → "terapia_manual"
- Uma MESMA frase pode aplicar uma modalidade a VÁRIAS regiões ("laser em cervical e
  dorso/garupa") — gere UM registro por região citada, todos com a mesma modalidade.

# REGRA — REGIÃO INTEIRA (OBRIGATÓRIA; nunca subdividir nem encolher o alvo)
Região citada sem vértebra específica = alvo é a região COMPLETA:
"cervical"/"pescoço" → grupo "cervical" (TODA a cervical — é ERRADO usar vértebras
isoladas ou a parte "regiao_cervical"); "dorso"/"costas" → parte "dorso";
"lombar"/"lombo" → parte "lombo"; "garupa" → parte "garupa"; "coluna" → grupo "coluna".
Vértebras individuais SÓ quando o texto nomear a vértebra ("C3", "T10").
"em cervical e dorso/garupa" numa MESMA frase = TRÊS registros de alvo inteiro.

# REGRA — NEGAÇÃO (achados ausentes NÃO pintam)
Frases que NEGAM um achado ("sem dor à palpação dorsal ou cervical", "não apresenta
edema", "ausência de reatividade") NÃO geram registro de achado_exame — o mapa corporal
só pinta o que FOI encontrado/aplicado. Se for uma conclusão clínica relevante, registre
em resumoClinico.observacaoFechamento (ex.: "Sem dor à palpação dorsal ou cervical").

# LAUDO DE CASCO / FERRAGEAMENTO
Quando o texto tratar de casco, ferradura, ferrageamento ou casqueamento, os alvos
devem ser PARTES DO CASCO (não partes do corpo):
alvo: { "tipo": "casco", "parteId": "<id abaixo>", "membro": "AE"|"AD"|"PE"|"PD" (opcional) }
- "membro" = qual casco: AE=anterior esquerdo, AD=anterior direito, PE=posterior
  esquerdo, PD=posterior direito ("mão"=anterior, "pé"=posterior). Preencha APENAS
  quando o texto disser o membro — NUNCA invente; sem membro citado, OMITA o campo.
- Intervenções (ferradura aplicada/trocada, ferrageamento terapêutico, casqueamento,
  ajuste, rebaixamento de talão...) → kind "terapia_aplicada" com modalidade "procedimento".
- Achados (sensibilidade, abscesso, hematoma de sola, linha branca comprometida...)
  → kind "achado_exame" com o achado mais próximo da lista fechada (dor, edema,
  reatividade_palpacao...). "Laminite" → achado_exame "edema" com alvo casco
  "pincas" (e "sola", se o texto citar a sola) — ALÉM do procedimento realizado.
Ex.: "Laminite, ferrageamento terapêutico aliviando a pressão na pinça" (membro NÃO
citado — repare que os alvos ficam SEM "membro"):
  { "kind":"achado_exame", "achado":"edema", "alvo":{ "tipo":"casco", "parteId":"pincas" } }
  { "kind":"terapia_aplicada", "modalidade":"procedimento", "alvo":{ "tipo":"casco", "parteId":"pincas" } }
PARTES DO CASCO (parteId — nome):
${linhasCasco}

# LAUDO ODONTOLÓGICO
Quando o texto tratar de dentes/odontologia, os alvos devem ser DENTES:
alvo: { "tipo": "dente", "parteId": "d<quadrante>_<posição com 2 dígitos>" }
- Quadrantes (Triadan): 1=superior direito, 2=superior esquerdo, 3=inferior
  esquerdo, 4=inferior direito. Posições: 01-03 incisivos, 04 canino, 05 dente de
  lobo (1º pré-molar), 06-08 pré-molares, 09-11 molares.
- Numeração Triadan citada diretamente: "208" → d2_08; "411" → d4_11.
- Descrição por nome: "primeiro molar superior esquerdo" → posição 09, quadrante 2
  → d2_09; "dente de lobo inferior direito" → d4_05.
- Procedimentos (nivelamento, desgaste de pontas, extração...) → kind
  "terapia_aplicada" com modalidade "procedimento"; achados (ponta excessiva de
  esmalte, gancho, fratura, cárie...) → "achado_exame" com o achado mais próximo.

# REGRA — PLURAL IMPLICA BILATERAL
Se o veterinário usar o PLURAL de uma parte/grupo de paridade "bilateral" SEM mencionar um
lado ("joelhos", "boletos", "membros pélvicos") — assuma lateralidade:"bilateral" mesmo sem
a palavra "bilateral" ser dita. Se disser o singular sem lado ("joelho", sem "direito"/"D"/
"esquerdo"/"E") e a parte for bilateral, NÃO invente o lado: omita "lateralidade" (o schema
sinaliza necessitaRevisao automaticamente) e marque necessitaRevisao:true.

# REGRA — ANÁFORA ("correspondente", "o mesmo lado", "idem")
Quando o ditado referir um lado por anáfora (ex.: "reatividade lombar E + garupa
correspondente"), resolva a anáfora usando o ÚLTIMO lado explícito mencionado ANTES no
mesmo ditado (no exemplo, "correspondente" = "esquerdo", porque "lombar E" veio antes).
Preencha a lateralidade do registro anafórico diretamente — não deixe "correspondente"
como texto solto em nenhum campo.

# REGRA — TERAPIA SEM LOCAL
Terapias cuja modalidade tem exigeLocal:false (ex.: eletroacupuntura sistêmica) OU que o
veterinário aplicou sem citar nenhuma parte/grupo do corpo devem usar
alvo: { tipo: "nao_localizado", descricao: "<o que foi dito>" } — nunca invente uma parte
só para ter onde pintar.

# REGRA — ESCOLHA DE "kind" (achado_exame vs. avaliacao_funcional)
"achado_exame.achado" é uma lista FECHADA: reatividade_palpacao, fasciculacao, dor, edema,
assimetria, restricao_articular, hipertonia, atrofia. NUNCA invente um valor fora dessa
lista. Qualquer observação que não seja EXATAMENTE um desses 8 termos (ex.: "déficit
proprioceptivo", "teste de cauda positivo", "reflexo de elevação da cauda diminuído") é
uma avaliacao_funcional, não um achado_exame — use "teste" (string livre, ex.:
"teste.proprioceptivo", "teste.cauda", "reflexo.elevacao_cauda") + "resultado" na escala
que couber (binario positivo/negativo, graduado ausente/diminuido/normal/aumentado, ou
presenca presente/ausente).

# REGRA — DITADO TRUNCADO
Se o texto terminar de forma abrupta (frase incompleta, corte no meio de uma palavra, ou
contiver um marcador como "[truncado]"), defina "completo": false e adicione um aviso em
"avisos" explicando o que ficou incompleto. Extraia normalmente tudo que veio ANTES do corte.

# PROVENIÊNCIA (obrigatória em todo registro)
- "confianca": 0 a 1 — quão certo você está do mapeamento termo→id.
- "trechoOriginal": trecho verbatim do ditado que originou o registro.
- "necessitaRevisao": true sempre que houver ambiguidade de lado, termo não mapeado
  literalmente na lista, ou qualquer inferência (incluindo plural→bilateral e anáfora).

# REGRA — "resumoClinico" (scores comparáveis entre sessões)

Todos os campos abaixo são INDEPENDENTES e OPCIONAIS — preencha só o que o texto disser:

- "claudicacao": só se o texto mencionar um grau de claudicação. Escala AAEP oficial é
  0 a 5; se o veterinário usar outra escala (ex.: "grau 2 de 4"), NÃO converta — use o
  valor literal e registre a conversão como incerta em "observacao".
- "dor": só se houver uma nota de dor à palpação em escala 0–10. Se o texto disser
  apenas "sensível" ou "dolorido" sem número, NÃO invente um valor — omita o campo.
- "tensaoMuscular": lista de { regiao, valor } só para as regiões musculares
  explicitamente avaliadas, escala 0 (tônus normal) a 3 (severa/contratura). Use o nome
  da região como o veterinário disse (ex.: "Longuíssimo lombar", "Glúteos (dir.)").
- "simetria": texto curto só se houver avaliação explícita de simetria/assimetria
  (ex.: "Simétrica", "Assimétrica à direita").
- "rom": lista de { teste, resultado } só para testes de amplitude de movimento
  citados (ex.: flexão lateral, flexão ventral, báscula pélvica) — "resultado" é a
  descrição do estado ATUAL em texto livre (o relatório compara com a sessão anterior
  automaticamente, você só descreve o que este texto diz sobre HOJE).
- "treino": lista de { status: "liberado"|"restrito"|"suspenso", titulo, detalhe } só
  se houver orientações de retorno ao trabalho/treino.
- "observacaoFechamento": uma frase de síntese SÓ se o texto tiver uma conclusão/
  observação de fechamento clara — nunca invente uma conclusão que o texto não tem.

Se NENHUM desses campos tiver dado no texto, omita "resumoClinico" por completo (não
envie um objeto vazio).

# SAÍDA

Retorne SOMENTE um JSON válido, sem markdown, sem explicações, no formato:

{
  "registros": [
    {
      "kind": "achado_exame" | "avaliacao_funcional" | "terapia_aplicada",
      "alvo": { "tipo": "parte", "parteId": "...", "lateralidade": "direito|esquerdo|bilateral (opcional)" }
            | { "tipo": "grupo", "grupoId": "...", "lateralidade": "..." (opcional) }
            | { "tipo": "casco", "parteId": "...", "membro": "AE|AD|PE|PD" (opcional) }
            | { "tipo": "dente", "parteId": "d<quadrante>_<posição>" }
            | { "tipo": "sistema", "sistemaId": "neurologico|musculoesqueletico|vascular|tegumentar" }
            | { "tipo": "nao_localizado", "descricao": "..." },
      // achado_exame:
      "achado": "reatividade_palpacao|fasciculacao|dor|edema|assimetria|restricao_articular|hipertonia|atrofia",
      "intensidade": 0.0,
      // avaliacao_funcional:
      "teste": "descrição curta do teste, ex: teste.cauda, reflexo.elevacao_cauda",
      "resultado": { "escala": "binario", "valor": "positivo|negativo" }
                 | { "escala": "graduado", "valor": "ausente|diminuido|normal|aumentado" }
                 | { "escala": "presenca", "valor": "presente|ausente" },
      // terapia_aplicada:
      "modalidade": "laser_led|campo_magnetico|eletroacupuntura|terapia_manual",
      "observacao": "opcional, texto livre",
      "proveniencia": { "confianca": 0.0, "trechoOriginal": "...", "necessitaRevisao": false }
    }
  ],
  "resumoClinico": {
    "claudicacao": { "grauAAEP": 0, "observacao": "opcional" },
    "dor": { "valor": 0 },
    "tensaoMuscular": [ { "regiao": "...", "valor": 0 } ],
    "simetria": "...",
    "rom": [ { "teste": "...", "resultado": "..." } ],
    "treino": [ { "status": "liberado|restrito|suspenso", "titulo": "...", "detalhe": "..." } ],
    "observacaoFechamento": "..."
  },
  "completo": true,
  "avisos": []
}
(campo "resumoClinico" inteiro é omitido se nada do texto se encaixar nele — não envie
chaves individuais vazias dentro dele.)

# EXEMPLO

Ditado: "Na sessão de fisioterapia foi feito campo eletromagnético pulsátil em cervical,
laser terapêutico em cervical e dorso/garupa, além do laser na região do joelho do lado
direito; eletroacupuntura neurológica. Animal sem dor à palpação dorsal ou cervical."

Saída (note: "cervical" = grupo INTEIRO nos dois registros; "dorso/garupa" = dois alvos
inteiros separados; a NEGAÇÃO "sem dor" não gera achado — vai para observacaoFechamento):
{
  "registros": [
    { "kind": "terapia_aplicada", "modalidade": "campo_magnetico",
      "alvo": { "tipo": "grupo", "grupoId": "cervical" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "campo eletromagnético pulsátil em cervical", "necessitaRevisao": false } },
    { "kind": "terapia_aplicada", "modalidade": "laser_led",
      "alvo": { "tipo": "grupo", "grupoId": "cervical" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "laser terapêutico em cervical", "necessitaRevisao": false } },
    { "kind": "terapia_aplicada", "modalidade": "laser_led",
      "alvo": { "tipo": "parte", "parteId": "dorso" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "laser terapêutico em ... dorso", "necessitaRevisao": false } },
    { "kind": "terapia_aplicada", "modalidade": "laser_led",
      "alvo": { "tipo": "parte", "parteId": "garupa" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "laser terapêutico em ... garupa", "necessitaRevisao": false } },
    { "kind": "terapia_aplicada", "modalidade": "laser_led",
      "alvo": { "tipo": "parte", "parteId": "carpo_ant", "lateralidade": "direito" },
      "proveniencia": { "confianca": 0.85, "trechoOriginal": "laser na região do joelho do lado direito", "necessitaRevisao": false } },
    { "kind": "terapia_aplicada", "modalidade": "eletroacupuntura",
      "alvo": { "tipo": "nao_localizado", "descricao": "eletroacupuntura neurológica" },
      "proveniencia": { "confianca": 0.8, "trechoOriginal": "eletroacupuntura neurológica", "necessitaRevisao": false } }
  ],
  "resumoClinico": {
    "observacaoFechamento": "Sem dor à palpação dorsal ou cervical."
  },
  "completo": true,
  "avisos": []
}

# EXEMPLO 2 (achado_exame + avaliacao_funcional + ditado truncado)

Ditado: "Déficit proprioceptivo em membros pélvicos; teste de cauda positivo; reflexo
elevação cauda diminuído; PEMF [truncado]."

Saída:
{
  "registros": [
    { "kind": "avaliacao_funcional", "teste": "teste.proprioceptivo",
      "resultado": { "escala": "presenca", "valor": "presente" },
      "alvo": { "tipo": "grupo", "grupoId": "membro_pelvico" },
      "proveniencia": { "confianca": 0.85, "trechoOriginal": "Déficit proprioceptivo em membros pélvicos", "necessitaRevisao": false } },
    { "kind": "avaliacao_funcional", "teste": "teste.cauda",
      "resultado": { "escala": "binario", "valor": "positivo" },
      "alvo": { "tipo": "parte", "parteId": "cauda" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "teste de cauda positivo", "necessitaRevisao": false } },
    { "kind": "avaliacao_funcional", "teste": "reflexo.elevacao_cauda",
      "resultado": { "escala": "graduado", "valor": "diminuido" },
      "alvo": { "tipo": "parte", "parteId": "cauda" },
      "proveniencia": { "confianca": 0.9, "trechoOriginal": "reflexo elevação cauda diminuído", "necessitaRevisao": false } }
  ],
  "completo": false,
  "avisos": ["Ditado truncado após \"PEMF\" — modalidade/local da terapia não foram informados."]
}
(Nota: "PEMF" ficou sem modalidade/alvo utilizáveis antes do corte — não gere um registro
para ele; apenas registre o aviso de truncamento.)

# EXEMPLO 3 (resumoClinico — sessão com scores)

Texto: "Claudicação grau 1 (AAEP). Dor à palpação 2/10. Tensão: longuíssimo lombar 1,0,
glúteos direito 0,5. Simétrica. Flexão lateral esq. alcança o flanco. Liberado trote em
linha reta 40 min/dia; suspenso tambores até reavaliar T14."

Saída (só o resumoClinico — "registros" omitido por brevidade):
{
  "resumoClinico": {
    "claudicacao": { "grauAAEP": 1 },
    "dor": { "valor": 2 },
    "tensaoMuscular": [
      { "regiao": "Longuíssimo lombar", "valor": 1.0 },
      { "regiao": "Glúteos (dir.)", "valor": 0.5 }
    ],
    "simetria": "Simétrica",
    "rom": [{ "teste": "Flexão lateral · esq.", "resultado": "alcança o flanco" }],
    "treino": [
      { "status": "liberado", "titulo": "Liberado", "detalhe": "Trote em linha reta, até 40 min/dia." },
      { "status": "suspenso", "titulo": "Suspenso", "detalhe": "Tambores — aguardar reavaliação de T14." }
    ]
  }
}

## DITADO A EXTRAIR:

${texto.slice(0, 6000)}`;
    },
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