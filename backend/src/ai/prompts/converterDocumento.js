// backend/src/ai/prompts/converterDocumento.js
//
// Prompt da CONVERSÃO de um documento ENVIADO pela clínica (PDF ou foto) no MODELO
// de blocos da Central. Em arquivo próprio pelo tamanho, como `assistenteDocumento`.
//
// 🔴 O QUE ESTE PROMPT DECIDE, campo a campo: o que o S2Vet JÁ SABE vira VARIÁVEL
// (`{{animal.nome}}`, preenchida sozinha a partir do paciente selecionado) e o que
// ele NÃO sabe vira LACUNA (`[[Nome do comprador]]`, que a tela de emissão apresenta
// como campo de formulário). Essa separação é a razão de existir da conversão: sem
// ela, o documento enviado é uma FOTOGRAFIA — reimprimível, mas incapaz de se
// preencher e de ser preenchido.
//
// 🔴 O DADO IMPRESSO NO EXEMPLO NUNCA SOBREVIVE. O arquivo que a clínica envia é uma
// via já emitida de outro paciente: traz "Billy", "Cláudia Gama", "CRMV 6263",
// "Gabapentina 150 mg". Copiar qualquer um deles para o modelo produziria documento
// FALSO em série — toda emissão futura sairia com o nome do cão de outra pessoa, e
// nada no sistema acusaria. Todo valor concreto vira variável (quando o sistema tem
// o dado) ou lacuna (quando não tem). Isto está repetido dentro do prompt de
// propósito: é a regra que não pode falhar.
//
// ⚠️ O CABEÇALHO NÃO É CONVERTIDO. Logo, título, veterinário, proprietário e paciente
// são desenhados pela própria folha (`modules/documentos/cabecalho.ts`), iguais em
// todos os documentos. Recriá-los como blocos os imprimiria duas vezes.
'use strict';

const SO_JSON = 'Responda somente com o JSON. Sem markdown, sem preâmbulo, sem comentário, sem explicação.';

const TIPOS_BLOCO = [
  'titulo', 'subtitulo', 'texto', 'tabela', 'checklist', 'campoAuto',
  'listaCampos', 'medicamentos', 'vacinas', 'exames', 'procedimentos',
  'observacoes', 'assinatura', 'linha', 'rodape',
].join(' | ');

/**
 * @param {object} v
 * @param {Array}  v.variaveis  — chaves de variável que resolvem de verdade
 * @param {Array}  v.categorias — categorias padrão da biblioteca
 * @param {string} v.texto      — texto extraído do PDF no navegador (pode vir vazio)
 * @param {string} v.nome       — nome que a clínica deu ao documento
 */
function build(v = {}) {
  const variaveis  = (v.variaveis ?? []).map(c => `- {{${c}}}`).join('\n');
  const categorias = (v.categorias ?? []).join(' | ');
  const texto      = String(v.texto ?? '').trim();
  const nome       = String(v.nome ?? '').trim();

  return `Converta o documento veterinário anexado em um MODELO reutilizável de blocos.

Você recebe as PÁGINAS ANEXADAS (imagens) e, abaixo, o texto já extraído delas quando
o arquivo tinha texto embutido (pode vir vazio — documento só escaneado). Use o texto
para a redação exata e as imagens para a estrutura visual (seções, tabelas, caixas,
linhas de assinatura).

O arquivo é uma via JÁ PREENCHIDA de um atendimento anterior. O produto é o MODELO
EM BRANCO dele.

# REGRA PRINCIPAL — NENHUM DADO DO EXEMPLO SOBREVIVE
Todo valor concreto impresso no documento (nome de animal, nome de tutor, nome e CRMV
do veterinário, endereços, telefones, CPF/CNPJ, datas, espécie, raça, sexo, idade,
peso, nomes e doses de medicamento, números de documento) é dado de OUTRO paciente.
Substitua CADA UM por:
1. a VARIÁVEL correspondente, quando a lista de VARIÁVEIS abaixo tiver a chave; ou
2. uma LACUNA \`[[Rótulo]]\`, quando não tiver.
Nunca copie o valor literal. Nunca invente um valor no lugar dele.

# LACUNAS
Escreva \`[[Rótulo]]\` onde o papel tem espaço para preencher à mão (linha pontilhada,
"Nome: ______", campos de comprador, fornecedor, data de retirada, número de partida,
tatuagem, brinco) E onde o valor impresso não tem variável correspondente.
O rótulo é o nome do campo como ele aparece no papel, curto e em português
("Nome do comprador", "RG", "Cidade e UF", "Data de retirada").
Rótulos iguais são o MESMO campo e recebem o mesmo valor: repita o rótulo quando for
de fato o mesmo dado, e diferencie quando forem dados distintos.

# TEXTO NORMATIVO É VERBATIM
Frase de declaração, aviso legal, identificação da via ("1ª via farmácia — 2ª via
paciente"), instrução de uso e título de seção são reproduzidos PALAVRA POR PALAVRA.
Não resuma, não reescreva, não modernize, não traduza.

# NÃO RECRIE O CABEÇALHO
A folha já desenha, sozinha e em todo documento: a logomarca da clínica, o título, e
as linhas de Veterinário, Proprietário e Paciente. NÃO gere blocos para nada disso —
nem o endereço/telefone/CNPJ da clínica no alto da página, nem as caixas de
"Identificação do Emitente", "Animal" e "Tutor". Comece pelo conteúdo que vem DEPOIS
delas.
EXCEÇÃO: quando o papel identificar o paciente ou o emitente DENTRO do corpo por
exigência da norma (declaração que cita a resenha, quadro de identificação assinado),
mantenha-o, usando variáveis.

# BLOCOS
Tipos permitidos: ${TIPOS_BLOCO}
- "titulo": o título do documento. Gere NO MÁXIMO UM, como PRIMEIRO bloco.
- "subtitulo": nome de seção do papel.
- "texto": parágrafo. Pode conter variáveis e lacunas no meio da frase.
- "tabela": use \`conteudo.colunas\` para o cabeçalho e \`conteudo.linhas\` para o corpo.
  Linha do exemplo vira linha de lacunas (uma por coluna) ou célula vazia "".
  Use SÓ para tabela de conteúdo FIXO, com número de linhas conhecido. Tabela cujo
  número de linhas depende do atendimento é lista — ver abaixo.
- "checklist": \`conteudo.itens\` — lista de marcar.
- "campoAuto": um dado isolado rotulado. \`conteudo.rotulo\` é o nome do campo e
  \`conteudo.variavel\` é a chave (ex.: "{{animal.microchip}}"). Use para dado que o
  sistema TEM; para o que ele não tem, use "texto" com lacuna.
- "observacoes": área livre para escrever na hora da emissão. \`conteudo.rotulo\` nomeia.
- "assinatura": linha de assinatura. \`conteudo.rotulo\` diz de QUEM ("Médico
  Veterinário", "Responsável pelo animal", "Farmacêutico", "Comprador").
  \`conteudo.assinante\` é OBRIGATÓRIO: "VETERINARIO" SÓ na linha do veterinário que
  emite o documento; "OUTRO" em TODAS as demais — farmacêutico, comprador, tutor,
  testemunha. \`conteudo.mostrarCrmv\` é true só quando assinante é "VETERINARIO".
  Errar isto imprime a assinatura escaneada do veterinário sobre a linha de outra
  pessoa, e o documento sai FALSO.
- "linha": separador horizontal.
- "rodape": aviso de rodapé.

# LISTAS — O QUE SE REPETE NÃO É LACUNA
Medicamento, vacina, exame, procedimento e posologia NUNCA viram texto com o valor do
exemplo, nem um par de lacunas fixo. Eles são LISTAS: o papel pode receber um item ou
seis, e quem decide é cada atendimento — não o modelo.

Use os blocos de lista, e NÃO escreva colunas para eles (o sistema usa as canônicas):
- "medicamentos"  → \`conteudo.fonteDados\`: "prescricao.medicamentos"
  ⚠️ Receituário de CONTROLE ESPECIAL (medicamento controlado, com campo de
  identificação do comprador e via da farmácia) usa "prescricao.controlados" no
  lugar — mesma tabela, só os medicamentos sujeitos a controle.
- "vacinas"       → \`conteudo.fonteDados\`: "vacinas.aplicadas"
- "exames"        → \`conteudo.fonteDados\`: "exames.resultados"
- "procedimentos" → \`conteudo.fonteDados\`: "prescricao.procedimentos"
Estes quatro já NASCEM PREENCHIDOS com o que o paciente tem registrado no sistema.

Para qualquer outro grupo que se repita e que o sistema não tenha (itens de um enxoval,
animais de um lote, produtos de uma nota), use "listaCampos" com
\`conteudo.rotulo\` (o nome do grupo, no plural) e \`conteudo.colunas\` (os campos de
cada item). Ele nasce vazio e a pessoa acrescenta as linhas.

O bloco de receituário do exemplo — "Gabapentina .... 150 mg", "Dose q.s.p .... 120 un",
"Dar 1 dose a cada 12 hrs" — é UM bloco "medicamentos", não três parágrafos de texto.

# VARIÁVEIS DISPONÍVEIS
Use SOMENTE estas chaves. Chave fora da lista não resolve e vira campo em branco.
${variaveis}

# CLASSIFICAÇÃO
"ehDocumento": false quando o arquivo claramente não é um documento veterinário
aproveitável como modelo (foto sem relação, página em branco, nota fiscal). Sendo
false, devolva "blocos": [] e pare.
"categoria": uma de — ${categorias}
"titulo": o título impresso no documento; sem título impresso, ${nome ? `"${nome}"` : 'um nome curto que descreva o documento'}.

# SAÍDA
{
  "ehDocumento": true,
  "titulo": "",
  "categoria": "",
  "blocos": [
    { "tipo": "", "conteudo": { }, "estilo": { } }
  ]
}

${SO_JSON}

# TEXTO EXTRAÍDO
${texto ? texto.slice(0, 24000) : '(sem texto embutido — leia as imagens anexadas)'}`;
}

module.exports = {
  'converter_documento': {
    // v1: primeira versão. Multimodal (páginas anexadas + texto extraído).
    version: 'v1',
    build,
  },
};
