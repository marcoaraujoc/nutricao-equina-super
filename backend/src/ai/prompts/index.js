// src/ai/prompts/index.js
// =============================================================================
// Catálogo canônico de prompts do S2Vet.
//
// Convenção:
//   - Cada entrada tem: version (string semântica), build (função) ou text (fixo)
//   - operacao ao logar = chave do prompt + '@' + version  ex: 'parse_laudo@v5'
//   - Para evoluir um prompt: incremente version e registre a mudança no
//     comentário acima da entrada
//
// PADRÃO DE ESCRITA (obrigatório em todo prompt novo ou editado):
//   - Voz imperativa. Sem "Você é um assistente que...", sem cortesia,
//     sem justificar a regra dentro do prompt.
//   - Regras como comandos diretos ("Extraia", "Ignore", "Omita"), não como
//     descrições ("o modelo deve procurar...").
//   - A saída é SEMPRE só o artefato pedido: proibido preâmbulo, comentário,
//     markdown, justificativa ou pergunta de volta.
//   - Todo prompt termina com o bloco SAÍDA e a linha de proibições.
// =============================================================================
'use strict';

// Linha de fechamento reaproveitada — mantém a proibição idêntica em todo prompt.
const SO_JSON = 'Responda somente com o JSON. Sem markdown, sem preâmbulo, sem comentário, sem explicação.';

const PROMPTS = {

  // ── Exames nutricionais: parse de PDF de laudo ──────────────────────────────
  // v1..v3: evolução das regras de ancoragem (ver histórico no git)
  // v4: extração de data + nota GENESIMATRIX (números concatenados, 1 casa decimal)
  // v5: reescrito em voz imperativa; removidas as justificativas das regras
  // v6: + laboratorio, nomeExame e tipoSugerido — para o cadastro de exame CLÍNICO
  //     "não pedido" (upload direto do laudo, sem passar pelo Pedido de Exames)
  // v7: + ehLaudoExame — classifica se o documento É um laudo de exame antes de
  //     tentar extrair qualquer coisa dele (rejeita nota fiscal, contrato, foto
  //     qualquer etc. anexados por engano no fluxo de exame não pedido)
  // v8: chamada virou MULTIMODAL — o documento (PDF/foto) vai anexado junto do
  //     texto, não só o texto. PASSO 2 passou a mandar usar a LOGOMARCA (brasão,
  //     papel timbrado, marca d'água) para identificar o laboratório quando o
  //     nome não aparece em texto simples — antes só o texto extraído do PDF era
  //     considerado, e um laboratório cujo nome existisse só como imagem no
  //     cabeçalho nunca era encontrado.
  'parse_laudo': {
    version: 'v8',
    build: (texto) => `Extraia os dados do laudo laboratorial veterinário anexado.

Você recebe o DOCUMENTO ANEXADO (imagem ou PDF) e, abaixo, o texto já extraído
dele quando havia texto embutido (pode vir vazio — documento só com imagem/scan).
O texto, quando presente, é a fonte mais confiável para os VALORES da tabela
(PASSO 6) — não releia número em imagem se o texto já o traz. O documento anexado
é a fonte para o que só existe visualmente: a LOGOMARCA do laboratório (PASSO 2).

O texto pode estar fora da ordem visual, com colunas separadas.
Ancore cada valor no NOME do exame. Não reconstrua a tabela pela ordem dos números.

# PROIBIÇÕES
- Não interprete resultados.
- Não aplique conhecimento médico.
- Não infira valor ausente.
- Não corrija OCR.
- Não crie linhas.
- Não associe valores por posição.

# PASSO 0 — É UM LAUDO DE EXAME?
Classifique "ehLaudoExame" como false quando o documento claramente NÃO é um
laudo/resultado de exame laboratorial (ex.: nota fiscal, contrato, receita de
medicamento, ficha de cadastro, mensagem, foto qualquer sem relação com exame,
página em branco). Classifique true quando houver nomes de exames/parâmetros com
resultados, unidades ou valores de referência, mesmo que incompletos ou
malformatados — no texto OU visíveis na imagem. Na dúvida, prefira true — só
rejeite quando não houver NENHUM indício de exame. Sendo false, pare aqui:
devolva a SAÍDA com "ehLaudoExame": false e os demais campos vazios ("exames": []).

# PASSO 1 — DATA
Localize a data de realização em: "Realizado", "Realizado em", "Data do Exame",
"Data da Coleta", "Coletado". Ignore datas próximas a "Nascimento" ou "Nasc".
Converta para YYYY-MM-DD. Não encontrou: null.

# PASSO 2 — LABORATÓRIO
Identifique o laboratório emissor (razão social ou nome fantasia). Procure em
DUAS fontes, nesta ordem:
1. Texto: cabeçalho, rodapé ou marca d'água escrita.
2. IMAGEM DO DOCUMENTO ANEXADO: a LOGOMARCA impressa no papel timbrado (brasão,
   selo, logotipo) — o nome do laboratório muitas vezes existe SÓ como parte da
   logo, sem aparecer como texto simples em lugar nenhum do documento. Reconheça
   o laboratório pela logo mesmo sem nenhum texto correspondente.
Não encontrou em nenhuma das duas: null. Nunca invente um nome plausível — só
devolva o que estiver de fato escrito ou identificável na logomarca.

# PASSO 3 — NOME DO EXAME
Extraia o nome do painel/perfil impresso no cabeçalho do laudo (ex.: "Hemograma
Completo", "Perfil Bioquímico Renal", "Eletrólitos"). Sem um nome de painel
explícito, componha um nome curto (máx. 60 caracteres) a partir dos parâmetros
mais relevantes do PASSO 5, separados por vírgula. Nunca devolva vazio.

# PASSO 4 — TIPO SUGERIDO
Classifique "Bioquímico" quando a maioria dos parâmetros for bioquímica sérica
(ex.: glicose, ureia, creatinina, proteínas totais, albumina, globulina, AST/TGO,
ALT/TGP, GGT, fosfatase alcalina, bilirrubina, colesterol, triglicerídeos, CK/CPK,
cálcio, fósforo, magnésio, sódio, potássio, cloro, ácido úrico). Classifique
"Laboratorial" em qualquer outro caso (hemograma, coagulograma, urinálise,
parasitológico, sorologia, hormônios etc.).

# PASSO 5 — EXAMES
Liste todos os exames. Formatos típicos: "Cálcio - mg/dL", "Ferro (ug/dL)", "Sódio - mEq/L".
Capture nome e unidade exatamente como aparecem.

# PASSO 6 — VALORES (por exame)

## Resultado
FORMATO GENESIMATRIX: os três números vêm colados ANTES do nome do exame, cada um
com 1 casa decimal. Separe em grupos "dígitos,1dígito" consecutivos.
"12,79,013,0" → resultado 12,7 · ref_min 9,0 · ref_max 13,0
"142,0+73,0140,0" → resultado 142,0 (flag "+") · ref_min 73,0 · ref_max 140,0
O resultado nunca é o mínimo nem o máximo. Separe a flag ("+", "*") do número.

## Referência
Extraia min e max de "(9,0 a 13,0)", "73,0 a 140,0" ou dos dois números após o
resultado no bloco concatenado.

## Método
Extraia o método associado ao exame (ex.: Ferrozine, Azul de Xilidil).

# PASSO 7 — VERIFICAÇÃO
Nº de exames = nº de resultados. Um resultado por exame. Não reutilize resultado,
intervalo nem método. Havendo ambiguidade, devolva o campo vazio.

# FORMATO
Preserve vírgula decimal. Preserve a unidade original. Não converta para ponto.
Não normalize texto.

# SAÍDA
{
  "ehLaudoExame": true ou false,
  "dataExame": "YYYY-MM-DD ou null",
  "laboratorio": "nome do laboratório ou null",
  "nomeExame": "nome do painel/perfil",
  "tipoSugerido": "Laboratorial ou Bioquímico",
  "exames": [
    { "nome": "", "resultado": "", "flag": "", "unidade": "",
      "referencia_min": "", "referencia_max": "", "metodo": "" }
  ]
}

Exemplo de entrada (laudo):
Laboratório Paddock
Perfil Bioquímico
12,79,013,0
Colorimétrico Arsenazo III
Cálcio - mg/dL

Saída correspondente:
{"ehLaudoExame":true,"dataExame":null,"laboratorio":"Laboratório Paddock","nomeExame":"Perfil Bioquímico","tipoSugerido":"Bioquímico","exames":[{"nome":"Cálcio","resultado":"12,7","flag":"","unidade":"mg/dL","referencia_min":"9,0","referencia_max":"13,0","metodo":"Colorimétrico Arsenazo III"}]}

Exemplo de entrada (NÃO é laudo — nota fiscal):
NOTA FISCAL ELETRÔNICA Nº 00123
Cliente: Haras Boa Vista
Valor total: R$ 350,00

Saída correspondente:
{"ehLaudoExame":false,"dataExame":null,"laboratorio":null,"nomeExame":"","tipoSugerido":"Laboratorial","exames":[]}

${SO_JSON}

# TEXTO EXTRAÍDO DO DOCUMENTO
${texto.trim() ? texto.slice(0, 22000) : '(nenhum texto embutido — documento é imagem/scan; use o anexo)'}`,
  },

  // ── Exame de Imagem: laudo em PDF com texto embutido → TRANSCRIÇÃO literal ──
  // v1: só transcreve o texto do laudo (radiografia/US/etc.), nunca interpreta —
  //     mesma regra do exame de Imagem: laudo verbatim (ver CLAUDE.md §12/28-d).
  // v2: + "tipoExame" — a MODALIDADE do laudo (Ultrassonografia, Radiografia...),
  //     copiada do próprio documento. Existe para rotular cada laudo quando o
  //     exame recebe MAIS de um arquivo (ex.: Ultrassom + Raio-X no mesmo
  //     registro) — sem isso os textos eram concatenados com um separador
  //     genérico ("---"), sem dizer qual seção é qual.
  'parse_laudo_imagem_texto': {
    version: 'v2',
    build: (texto) => `Transcreva o laudo de exame de imagem veterinário abaixo.

O texto vem de PDF e pode estar fora da ordem visual, com colunas separadas.

# PROIBIÇÕES
- Não resuma o laudo.
- Não interprete o achado.
- Não diagnostique, não opine, não conclua nada que o texto não escreva.
- Não corrija ortografia, gramática ou terminologia do texto original.
- Não invente conteúdo ausente do documento.
- Não descreva a imagem radiográfica/ultrassonográfica em si — transcreva
  somente o texto do documento.

# PASSO 0 — É UM LAUDO DE EXAME DE IMAGEM?
Classifique "ehLaudoImagem" como false quando o texto claramente NÃO é um laudo
de exame de imagem veterinário (radiografia, ultrassonografia, tomografia,
ressonância, endoscopia etc.) — ex.: nota fiscal, contrato, receita de
medicamento, ficha de cadastro, mensagem, página em branco. Classifique true
quando houver texto de um laudo/relatório de exame por imagem, mesmo que
incompleto. Na dúvida, prefira true — só rejeite quando não houver NENHUM
indício de laudo. Sendo false, pare aqui: devolva a SAÍDA com "ehLaudoImagem":
false, "tipoExame": null e "laudo": "".

# TIPO DE EXAME
Identifique a MODALIDADE do exame (ex.: "Ultrassonografia Abdominal",
"Radiografia de Tórax", "Tomografia Computadorizada", "Endoscopia") a partir do
título/cabeçalho do próprio documento. Copie o que está escrito — nunca
deduza pela imagem clínica nem invente uma modalidade que o documento não
nomeie. Não encontrou um nome explícito: null.

# DATA
Localize a data de realização em: "Realizado", "Realizado em", "Data do Exame".
Ignore datas próximas a "Nascimento" ou "Nasc". Converta para YYYY-MM-DD. Não
encontrou: null.

# LAUDO
Copie o texto do corpo do laudo (achados, descrição, conclusão/impressão) na
ordem em que aparece, exatamente como está escrito. Preserve quebras de
parágrafo com \\n. Ignore cabeçalho/rodapé de identificação (logotipo,
contato, numeração de página) — extraia só o conteúdo clínico do laudo.

# SAÍDA
{
  "ehLaudoImagem": true ou false,
  "tipoExame": "modalidade copiada do documento ou null",
  "dataExame": "YYYY-MM-DD ou null",
  "laudo": ""
}

${SO_JSON}

# DOCUMENTO
${texto.slice(0, 22000)}`,
  },

  // ── Exame de Imagem: laudo fotografado/escaneado → TRANSCRIÇÃO literal (visão) ──
  // v1: irmão do parse_laudo_imagem_texto, para quando o arquivo é foto/scan sem
  //     texto embutido — mesmo mecanismo multimodal de parse_composicao_visao.
  // v2: + "tipoExame" — mesmo campo/motivo do irmão de texto (v2), acima.
  'parse_laudo_imagem_visao': {
    version: 'v2',
    // Sem build — prompt fixo enviado junto com a imagem
    text: `Transcreva o laudo de exame de imagem veterinário fotografado nesta imagem.

# PROIBIÇÕES
- Não resuma o laudo.
- Não interprete o achado.
- Não diagnostique, não opine, não conclua nada que o texto não escreva.
- Não corrija ortografia, gramática ou terminologia do texto original.
- Não invente conteúdo ausente do documento.
- Não descreva a imagem radiográfica/ultrassonográfica em si — transcreva
  somente o TEXTO impresso ou manuscrito no documento fotografado.

# É UM LAUDO DE EXAME DE IMAGEM?
Classifique "ehLaudoImagem" como false quando a imagem claramente NÃO mostra um
laudo/relatório de exame de imagem veterinário (radiografia, ultrassonografia,
tomografia, ressonância, endoscopia etc.) — ex.: foto do próprio animal, nota
fiscal, documento não relacionado, página em branco, imagem ilegível.
Classifique true quando houver texto de um laudo, mesmo que parcialmente
legível. Na dúvida, prefira true.
Sendo false: devolva a SAÍDA com "ehLaudoImagem": false, "tipoExame": null e
"laudo": "".

# TIPO DE EXAME
Identifique a MODALIDADE do exame (ex.: "Ultrassonografia Abdominal",
"Radiografia de Tórax", "Tomografia Computadorizada", "Endoscopia") a partir do
título/cabeçalho impresso no documento fotografado. Copie o que está escrito —
nunca deduza pela imagem clínica nem invente uma modalidade que o documento não
nomeie. Não encontrou um nome explícito: null.

# DATA
Localize a data de realização do exame, se impressa no documento. Converta
para YYYY-MM-DD. Não encontrou: null.

# LAUDO
Transcreva o texto do corpo do laudo (achados, descrição, conclusão/impressão)
na ordem em que aparece, exatamente como está escrito. Preserve quebras de
parágrafo com \\n. Ignore cabeçalho/rodapé de identificação (logotipo,
contato, numeração de página) — extraia só o conteúdo clínico do laudo.

# SAÍDA
{
  "ehLaudoImagem": true ou false,
  "tipoExame": "modalidade copiada do documento ou null",
  "dataExame": "YYYY-MM-DD ou null",
  "laudo": ""
}

${SO_JSON}`,
  },

  // ── Evolução clínica: título + itens faturáveis ─────────────────────────────
  // v1: só "acoes" · v2: + "titulo"
  // v3: voz imperativa; proibição explícita de inventar item não citado
  'interpretacao_clinica': {
    version: 'v3',
    build: (texto) => `Extraia da evolução clínica veterinária abaixo o título e os itens faturáveis.

# TÍTULO
Máximo 60 caracteres. Descreva o principal achado ou intervenção registrado.
Exemplos: "Avaliação clínica - cólica estomacal"; "Vacinação anual - influenza equina";
"Exame ortopédico - claudicação MAE".

# AÇÕES
Extraia apenas itens EXPLICITAMENTE citados no texto. Tipos permitidos:
MEDICAMENTO (prescrito), PROCEDIMENTO (realizado), EXAME (solicitado),
ENCAMINHAMENTO, VACINA (aplicada).
Não crie item que o texto não menciona. Nenhum item citado: "acoes": [].
Estime "valorEstimado" em reais pela tabela veterinária brasileira vigente.

# SAÍDA
{
  "titulo": "",
  "acoes": [
    { "tipo": "MEDICAMENTO", "descricao": "Amoxicilina 500mg — 1 comprimido 2x ao dia por 7 dias",
      "valorEstimado": 45.00, "quantidade": 1 }
  ]
}

${SO_JSON}

# EVOLUÇÃO
${texto.slice(0, 8000)}`,
  },

  // ── Histórico clínico: resumo de linha do tempo ─────────────────────────────
  // v1: sumariza lote de eventos · v2: voz imperativa
  'resumo_historico': {
    version: 'v2',
    build: (eventos) => `Resuma cada evento do histórico clínico veterinário abaixo em UMA linha.

# REGRAS
- Máximo 90 caracteres por resumo.
- Português do Brasil, linguagem clínica, texto simples.
- Sem markdown, sem bullet, sem prefixo.
- Evolução: o principal achado ou conduta registrada.
- Vacina: nome e tipo, quando houver.
- Exame: tipo e resultado resumido, quando houver.
- Prescrição: os principais medicamentos ou procedimentos.
- Encaminhamento: especialidade e motivo resumido.
- Descreva apenas o que o evento traz. Não complete lacuna.

# SAÍDA
Array com exatamente ${eventos.length} itens, na mesma ordem da entrada:
[{"resumo":"..."}]

${SO_JSON}

# EVENTOS
${JSON.stringify(eventos.map(e => ({
  tipo: e.origem,
  titulo: e.titulo,
  detalhe: typeof e.resumo === 'string' ? e.resumo.slice(0, 400) : null,
})))}`,
  },

  // ── MEMÓRIA CLÍNICA DO PACIENTE ─────────────────────────────────────────────
  // v1: substitui 'resumo_atendimentos'. Devolve DUAS camadas navegáveis:
  //     highlights (padrões factuais entre atendimentos, cada um ancorado nos
  //     tópicos que o comprovam) + tópicos (um por evento, ancorado no registro
  //     de origem via "ref"). Incremental: recebe os tópicos já consolidados e
  //     apenas os eventos novos; devolve os tópicos novos + highlights recalculados.
  //     A LLM é PROIBIDA de sugerir conduta, diagnosticar ou emitir laudo.
  'memoria_clinica': {
    version: 'v1',
    build: ({ topicosAtuais, eventos, animalNome }) => `Consolide a memória clínica do paciente${animalNome ? ` "${animalNome}"` : ''}.

Você recebe os TÓPICOS JÁ CONSOLIDADOS e os EVENTOS NOVOS. Descreva o que está
registrado e aponte padrões factuais entre atendimentos.

# PROIBIÇÕES ABSOLUTAS
- Não sugira conduta, tratamento, exame ou medicação.
- Não emita diagnóstico, hipótese diagnóstica, prognóstico ou laudo.
- Não recomende, não oriente, não alerte, não opine.
- Não afirme relação de causa e efeito.
- Não use dado que não esteja nos eventos. Não estime valor ausente.
Você descreve e correlaciona o que foi registrado. Nada além disso.

# TÓPICOS
Gere um tópico para CADA evento novo, na ordem recebida.
- "id": copie o id que veio no evento. Não crie id.
- "ref": copie a ref que veio no evento. Não altere.
- "texto": 1 a 2 frases, português do Brasil, tom clínico, factual.
  Cite números medidos (peso, temperatura, dose, resultado) exatamente como registrados.
  Máximo 240 caracteres.

# HIGHLIGHTS
Recalcule sobre TODOS os tópicos (consolidados + novos). Máximo 6, ordenados do
mais relevante para o menos. Um highlight só existe se 2 ou mais tópicos o comprovam.
Cada highlight é um padrão VERIFICÁVEL nos registros:
- evolução de um valor medido ao longo das datas;
- repetição do mesmo achado, queixa ou procedimento;
- item registrado como solicitado e sem resultado registrado depois;
- alteração de conduta registrada entre atendimentos.
- "texto": máximo 120 caracteres, com as datas e os números que sustentam o padrão.
  Exemplo de forma: "Perda progressiva de peso: 70 kg (20/06) → 60 kg (22/06) → 50 kg (27/07)."
- "tipo": TENDENCIA | RECORRENCIA | PENDENCIA | ALTERACAO
- "direcao": aumento | reducao | estavel | nao_aplicavel
- "topicos": ids dos tópicos que comprovam o padrão, em ordem cronológica.
  Use somente ids existentes. Mínimo 2.
Nenhum padrão comprovável: "highlights": [].

# SAÍDA
{
  "topicos": [ { "id": "t7", "ref": "evolucao-31", "texto": "" } ],
  "highlights": [ { "texto": "", "tipo": "TENDENCIA", "direcao": "reducao", "topicos": ["t3","t5","t7"] } ]
}

${SO_JSON}

# TÓPICOS JÁ CONSOLIDADOS
${JSON.stringify(topicosAtuais ?? [])}

# EVENTOS NOVOS
${JSON.stringify(eventos ?? [])}`,
  },

  // ── ANÁLISE FINANCEIRA GERENCIAL ────────────────────────────────────────────
  // v1: lê os indicadores já apurados do período (RelatoriosController.financeiro)
  //     e devolve highlights + análise em texto. Descreve e compara números.
  //     Não recomenda ação — a decisão é do gestor.
  'analise_financeira': {
    version: 'v1',
    build: ({ periodo, indicadores, comparativo }) => `Analise os indicadores financeiros da clínica veterinária abaixo.

Período analisado: ${periodo}.
Valores monetários em reais (BRL).

# PROIBIÇÕES ABSOLUTAS
- Não recomende ação, meta, preço, corte de custo ou estratégia.
- Não projete cenário que não esteja nos indicadores.
- Não invente número. Use exclusivamente os valores recebidos.
- Não classifique resultado como bom, ruim, saudável ou preocupante.
Você descreve, quantifica e compara. Nada além disso.

# HIGHLIGHTS
Máximo 5, ordenados por materialidade financeira. Cada um é um fato numérico do período:
- "texto": máximo 120 caracteres, com o valor e a variação que o sustentam.
- "tipo": FATURAMENTO | INADIMPLENCIA | CONCENTRACAO | MARGEM | TICKET
- "direcao": aumento | reducao | estavel | nao_aplicavel
- "valor": número principal do highlight (sem símbolo de moeda), ou null.

# ANÁLISE
2 a 4 parágrafos curtos, português do Brasil, tom gerencial e objetivo.
Cubra: composição do faturamento, ticket médio, contas a receber e inadimplência,
margem sobre produtos consumidos. Cite os números. Sem markdown, sem título, sem bullet.
Indicador com valor zero ou ausente: declare que não houve registro no período.

# SAÍDA
{
  "highlights": [ { "texto": "", "tipo": "FATURAMENTO", "direcao": "aumento", "valor": 0 } ],
  "analise": [ "parágrafo 1", "parágrafo 2" ]
}

${SO_JSON}

# INDICADORES DO PERÍODO
${JSON.stringify(indicadores)}

# COMPARATIVO
${JSON.stringify(comparativo ?? null)}`,
  },

  // ── Agendamento: interpretação de solicitação em texto livre ────────────────
  // v1: prompt inline em agendamentoLLMService
  // v2: movido para o catálogo + voz imperativa
  'interpretacao_agendamento': {
    version: 'v2',
    build: ({ texto, vetsStr, animaisStr, dataReferencia, hints }) => `Extraia os dados de agendamento da solicitação veterinária abaixo.

DATA DE REFERÊNCIA (hoje): ${dataReferencia}

VETERINÁRIOS:
${vetsStr}

ANIMAIS:
${animaisStr}
${hints ? `\n${hints}\n` : ''}
# REGRAS
- "amanhã" = data de referência + 1 dia. "próxima segunda" = a próxima segunda-feira.
- Sem data no texto: use a data de referência.
- "9h", "09:00", "nove horas" → "09:00". "14h30" → "14:30".
- Horários válidos: 08:00 a 18:00.
- Case nomes por similaridade fonética ("Dr. João" = "João Silva").
- Animal fora da lista: preencha animalNomeNaoEncontrado e deixe animalId null.
- Veterinário fora da lista: preencha vetNomeNaoEncontrado e deixe vetId null.
- Não invente id. Use somente os ids listados acima.

# SAÍDA
{
  "data": "YYYY-MM-DD ou null",
  "hora": "HH:MM ou null",
  "animalId": null,
  "vetId": null,
  "animalNomeNaoEncontrado": null,
  "vetNomeNaoEncontrado": null,
  "confianca": 0.0,
  "resumo": "frase curta do que foi entendido"
}

${SO_JSON}

# SOLICITAÇÃO
"${texto}"`,
  },

  // ── Nota clínica ditada: texto organizado + itens faturáveis ────────────────
  // v1: prompt inline em AudioController
  'analise_nota_clinica': {
    version: 'v1',
    build: (texto) => `Organize a nota clínica veterinária abaixo e extraia os itens faturáveis.

# TEXTO
"evolucaoTexto" = a nota reescrita para o prontuário: sem repetição, sem marca de
oralidade, sem ordenar conteúdo que o texto não traz. Não acrescente informação.

# AÇÕES
Extraia apenas o que a nota menciona explicitamente.
Tipos permitidos: MEDICAMENTO, PROCEDIMENTO, EXAME, ENCAMINHAMENTO.
Estime "valor" em reais pela tabela veterinária brasileira vigente.
Nenhum item citado: "acoes": [].
Não invente item.

# SAÍDA
{
  "evolucaoTexto": "",
  "acoes": [ { "tipo": "MEDICAMENTO", "descricao": "", "valor": 0.00 } ]
}

${SO_JSON}

# NOTA
${texto}`,
  },

  // ── Composição alimentar: rótulo em imagem (Gemini Vision) ──────────────────
  // v1: prompt inicial · v2: voz imperativa
  'parse_composicao_visao': {
    version: 'v2',
    // Sem build — prompt fixo enviado junto com a imagem
    text: `Extraia a seção nutricional do rótulo de produto animal desta imagem.

A seção pode aparecer como: "Níveis de Garantia", "Níveis de Garantia por Kg",
"Informação Nutricional", "Composição Garantida", "Análise Garantida", "Composición".

# FORMATOS
1. Tabela com uma coluna de valor: extraia direto.
2. Tabela com várias colunas: use a coluna "por kg" ou "total". Ignore "por porção",
   "por tablete", "por dose".
3. Parágrafo corrido: extraia cada par nutriente + valor + unidade.
4. Lista simples: valor na mesma linha do nutriente ou na linha seguinte.

# BASE DE CÁLCULO
- Título "por kg" ou "g/kg": mantenha os valores como estão.
- Título "por 100g" ou "100g": multiplique SOMENTE o valor numérico por 10.
  635mg → 6350 mg · 2,26g → 22,6 g · 450UI → 4500 UI.
- Unidade %: mantenha como está, sem multiplicar.
- Nunca converta entre unidades. A unidade de saída é idêntica à impressa no rótulo.

# REGRAS
- Remova (mín.), (máx.), (min.), (max.) do nome do nutriente.
- Use apenas o que está legível. Valor incerto: null.
- Inclua todos os nutrientes visíveis, incluindo probióticos (UFC/g) e energia (kcal/kg).
- Trate "Proteina bruta" e "Proteína Bruta" como o mesmo nutriente.
- Não invente valor.

# SAÍDA
{
  "nomeAlimento": "conforme o rótulo, ou null",
  "baseCalculo": "kg" ou "100g",
  "nutrientes": [ { "nome": "", "valor": 0.00, "unidade": "g/kg" } ]
}

${SO_JSON}`,
  },

  // ── Body-map + scores equinos: texto da evolução → ResumoAtendimento ────────
  // v1..v5: léxico, plural→bilateral, anáfora, negação, região inteira, casco e dentes
  // v6: prompt compactado (o request estourava o teto de tokens/min do provider antigo)
  // v7: voz imperativa; regras convertidas em comandos; saída sem justificativa
  'extrair_resultado_sessao_equino': {
    version: 'v7',
    build: (texto) => {
      // Léxico embutido dinamicamente a partir do domínio (fonte única de verdade —
      // nunca hardcodar IDs aqui: se a taxonomia mudar, o prompt acompanha sozinho).
      const { PARTES_EQUINAS } = require('../../models/anatomia-equina/anatomia-equina.taxonomy');
      const { GRUPOS_EQUINOS } = require('../../models/anatomia-equina/anatomia-equina.grupos');
      const { MODALIDADES_TERAPIA } = require('../../models/anatomia-equina/s2vet-clinica.model');
      const { PARTES_CASCO } = require('../../models/anatomia-casco/casco.model');

      // Compacto: vértebras (41) não são listadas uma a uma — viram o bloco de
      // padrões em "# PARTES"; grupos não expandem suas partes.
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

      return `Extraia da evolução clínica equina abaixo (qualquer especialidade, escrita ou ditada)
duas estruturas, ambas OPCIONAIS:

1. "registros" — achados de exame, avaliações funcionais e terapias aplicadas com
   localização anatômica, para pintar o mapa corporal.
2. "resumoClinico" — indicadores comparáveis entre sessões.

Extraia somente o que o texto contém. Seção sem dado no texto: omita a seção inteira.

# PROIBIÇÕES
- Não crie achado, teste, terapia ou score ausente do texto.
- Não force parteId/grupoId que não corresponda ao termo dito. Sem correspondência
  clara na lista: use tipo "nao_localizado" com a descrição literal.
- Use apenas ids listados abaixo. Não invente id.
- Gere no máximo um registro por achado/teste/terapia citado. Não funda nem duplique.
- "proveniencia.trechoOriginal" é cópia VERBATIM do texto. Não parafraseie.

# PARTES (parteId — nome — paridade)
${linhasPartesCompacto}
Vértebras (paridade mediano; use SÓ quando o texto NOMEAR a vértebra):
padrão vertebra_c1..c7, vertebra_t1..t18, vertebra_l1..l6, vertebra_s1..s5, vertebra_cd1..cd5.
"T14" → vertebra_t14. "C3" → vertebra_c3.

# GRUPOS (grupoId — nome — paridade)
${linhasGruposCompacto}

# MODALIDADES (modalidadeId — exigeLocal)
${linhasModalidades}

# LÉXICO COLOQUIAL → ID
"espada"/"espádua" → grupo espadua · "nuca" → grupo nuca
"joelho" (membro anterior) → parte carpo_ant · "curvilhão"/"jarrete" → parte jarrete_tarso
"canela" → metacarpo (anterior) ou metatarso (posterior), conforme o membro citado
"garupa" → parte garupa · "cernelha" → parte cernelha
"lombo"/"lombar" → parte lombo · "dorso"/"costas" → parte dorso
"coluna" (sem trecho) → grupo coluna · "cervical"/"pescoço" → grupo cervical
"membros anteriores"/"torácicos" → grupo membro_toracico
"membros posteriores"/"pélvicos"/"traseiros" → grupo membro_pelvico
Termo fora dessas listas → tipo "nao_localizado" com o termo como foi dito.

# LÉXICO DE MODALIDADES
"laser"/"laserterapia"/"LED"/"fotobiomodulação" → laser_led
"campo magnético"/"eletromagnético"/"pulsátil"/"magnetoterapia"/"PEMF" → campo_magnetico
"eletroacupuntura"/"acupuntura"/"agulhamento" → eletroacupuntura
"terapia manual"/"mobilização"/"massagem"/"liberação miofascial"/"ajuste quiroprático" → terapia_manual
Uma frase pode aplicar a mesma modalidade a várias regiões: gere um registro por região.

# REGIÃO INTEIRA
Região citada sem vértebra nomeada = alvo é a região COMPLETA.
"cervical"/"pescoço" → grupo cervical (nunca vértebras isoladas, nunca regiao_cervical).
"dorso"/"costas" → parte dorso · "lombar"/"lombo" → parte lombo · "garupa" → parte garupa ·
"coluna" → grupo coluna. Vértebra individual só com a vértebra nomeada.
"em cervical e dorso/garupa" numa mesma frase = três registros de alvo inteiro.

# NEGAÇÃO
Achado negado ("sem dor à palpação", "não apresenta edema", "ausência de reatividade")
NÃO gera registro. Sendo conclusão de fechamento, registre em
resumoClinico.observacaoFechamento.

# CASCO / FERRAGEAMENTO
Texto sobre casco, ferradura, ferrageamento ou casqueamento usa alvo de casco:
{ "tipo": "casco", "parteId": "<id>", "membro": "AE|AD|PE|PD" (opcional) }
"membro": AE=anterior esquerdo, AD=anterior direito, PE=posterior esquerdo,
PD=posterior direito ("mão"=anterior, "pé"=posterior). Membro não citado: OMITA o campo.
Intervenção (ferradura, ferrageamento terapêutico, casqueamento, ajuste, rebaixamento
de talão) → kind "terapia_aplicada", modalidade "procedimento".
Achado (sensibilidade, abscesso, hematoma de sola, linha branca comprometida) →
kind "achado_exame" com o achado mais próximo da lista fechada.
"Laminite" → achado_exame "edema" no alvo casco "pincas" (e "sola" se citada), ALÉM do
procedimento realizado.
Exemplo — "Laminite, ferrageamento terapêutico aliviando a pressão na pinça" (sem membro):
{ "kind":"achado_exame", "achado":"edema", "alvo":{ "tipo":"casco", "parteId":"pincas" } }
{ "kind":"terapia_aplicada", "modalidade":"procedimento", "alvo":{ "tipo":"casco", "parteId":"pincas" } }
PARTES DO CASCO (parteId — nome):
${linhasCasco}

# ODONTOLOGIA
Texto sobre dentes usa alvo { "tipo": "dente", "parteId": "d<quadrante>_<posição 2 dígitos>" }.
Quadrantes Triadan: 1=superior direito, 2=superior esquerdo, 3=inferior esquerdo,
4=inferior direito. Posições: 01-03 incisivos, 04 canino, 05 dente de lobo,
06-08 pré-molares, 09-11 molares.
"208" → d2_08 · "411" → d4_11 · "primeiro molar superior esquerdo" → d2_09 ·
"dente de lobo inferior direito" → d4_05.
Procedimento (nivelamento, desgaste de pontas, extração) → terapia_aplicada,
modalidade "procedimento". Achado (ponta de esmalte, gancho, fratura, cárie) → achado_exame.

# PLURAL = BILATERAL
Plural de parte/grupo bilateral sem lado citado ("joelhos", "boletos", "membros pélvicos"):
lateralidade "bilateral" e necessitaRevisao true.
Singular sem lado ("joelho") em parte bilateral: OMITA "lateralidade" e marque
necessitaRevisao true. Não invente o lado.

# ANÁFORA
"correspondente", "o mesmo lado", "idem" resolvem para o ÚLTIMO lado explícito citado
antes no mesmo texto. Preencha a lateralidade resolvida. Não deixe "correspondente"
como texto em nenhum campo.

# TERAPIA SEM LOCAL
Modalidade com exigeLocal false, ou terapia aplicada sem parte/grupo citado:
alvo { "tipo": "nao_localizado", "descricao": "<o que foi dito>" }. Não invente parte.

# ESCOLHA DE kind
"achado_exame.achado" é lista FECHADA: reatividade_palpacao, fasciculacao, dor, edema,
assimetria, restricao_articular, hipertonia, atrofia. Não use valor fora dela.
Observação que não seja exatamente um desses 8 termos (ex.: "déficit proprioceptivo",
"teste de cauda positivo") é "avaliacao_funcional": use "teste" (string livre) +
"resultado" na escala cabível.

# TEXTO TRUNCADO
Texto cortado no meio, frase incompleta ou marcador "[truncado]": defina "completo" false
e registre o corte em "avisos". Extraia normalmente tudo que veio antes do corte.

# PROVENIÊNCIA (obrigatória em todo registro)
"confianca": 0 a 1 · "trechoOriginal": verbatim · "necessitaRevisao": true em ambiguidade
de lado, termo não mapeado literalmente ou qualquer inferência (inclui plural→bilateral e anáfora).

# resumoClinico (campos independentes; preencha só o que o texto disser)
- "claudicacao": só com grau citado. Escala AAEP 0-5. Outra escala ("grau 2 de 4"):
  use o valor literal e registre a incerteza em "observacao". Não converta.
- "dor": só com nota 0-10 explícita. "sensível"/"dolorido" sem número: omita.
- "tensaoMuscular": [{ regiao, valor }] só das regiões avaliadas. Escala 0 (normal) a 3
  (contratura). Use o nome da região como foi dito.
- "simetria": texto curto, só com avaliação explícita de simetria/assimetria.
- "rom": [{ teste, resultado }] só dos testes de amplitude citados. "resultado" descreve
  o estado ATUAL em texto livre.
- "treino": [{ status: liberado|restrito|suspenso, titulo, detalhe }] só com orientação
  de retorno ao trabalho registrada no texto.
- "observacaoFechamento": uma frase, só com conclusão de fechamento presente no texto.
Nenhum campo com dado: omita "resumoClinico" inteiro. Não envie objeto vazio.

# SAÍDA
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
      "achado": "reatividade_palpacao|fasciculacao|dor|edema|assimetria|restricao_articular|hipertonia|atrofia",
      "intensidade": 0.0,
      "teste": "ex: teste.cauda, reflexo.elevacao_cauda",
      "resultado": { "escala": "binario", "valor": "positivo|negativo" }
                 | { "escala": "graduado", "valor": "ausente|diminuido|normal|aumentado" }
                 | { "escala": "presenca", "valor": "presente|ausente" },
      "modalidade": "laser_led|campo_magnetico|eletroacupuntura|terapia_manual",
      "observacao": "opcional",
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

${SO_JSON}

# EXEMPLO 1 — região inteira, múltiplos alvos, negação
Texto: "Na sessão de fisioterapia foi feito campo eletromagnético pulsátil em cervical,
laser terapêutico em cervical e dorso/garupa, além do laser na região do joelho do lado
direito; eletroacupuntura neurológica. Animal sem dor à palpação dorsal ou cervical."
Saída:
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
  "resumoClinico": { "observacaoFechamento": "Sem dor à palpação dorsal ou cervical." },
  "completo": true,
  "avisos": []
}

# EXEMPLO 2 — avaliação funcional e truncamento
Texto: "Déficit proprioceptivo em membros pélvicos; teste de cauda positivo; reflexo
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
  "avisos": ["Ditado truncado após \\"PEMF\\" — modalidade e local não informados."]
}

# EXEMPLO 3 — resumoClinico com scores
Texto: "Claudicação grau 1 (AAEP). Dor à palpação 2/10. Tensão: longuíssimo lombar 1,0,
glúteos direito 0,5. Simétrica. Flexão lateral esq. alcança o flanco. Liberado trote em
linha reta 40 min/dia; suspenso tambores até reavaliar T14."
Saída (só o resumoClinico):
{
  "resumoClinico": {
    "claudicacao": { "grauAAEP": 1 },
    "dor": { "valor": 2 },
    "tensaoMuscular": [ { "regiao": "Longuíssimo lombar", "valor": 1.0 }, { "regiao": "Glúteos (dir.)", "valor": 0.5 } ],
    "simetria": "Simétrica",
    "rom": [ { "teste": "Flexão lateral · esq.", "resultado": "alcança o flanco" } ],
    "treino": [
      { "status": "liberado", "titulo": "Liberado", "detalhe": "Trote em linha reta, até 40 min/dia." },
      { "status": "suspenso", "titulo": "Suspenso", "detalhe": "Tambores — aguardar reavaliação de T14." }
    ]
  }
}

# TEXTO
${texto.slice(0, 6000)}`;
    },
  },

  // ── Composição alimentar: rótulo em texto (PDF extraído) ────────────────────
  // v1: prompt inicial · v2: voz imperativa
  'parse_composicao_texto': {
    version: 'v2',
    build: (texto) => `Extraia os nutrientes do rótulo de produto animal abaixo.

A seção pode aparecer como: "Níveis de Garantia", "Informação Nutricional",
"Composição Garantida", "Análise Garantida".

# REGRAS
- Valores por 100g: multiplique SOMENTE o valor numérico por 10. Não altere a unidade
  (mg continua mg, g continua g). 635mg/100g → valor 6350, unidade "mg".
- Unidade %: mantenha como está, sem converter.
- Remova (mín.) e (máx.) do nome do nutriente.
- Use apenas o que está no texto. Não invente valor.
- Inclua todos os nutrientes encontrados.

# SAÍDA
{
  "nomeAlimento": "se encontrado, ou null",
  "nutrientes": [ { "nome": "", "valor": 0.00, "unidade": "g/kg" } ]
}

${SO_JSON}

# TEXTO
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

module.exports = { PROMPTS, buildPrompt, SO_JSON };
