// backend/src/ai/prompts/assistenteDocumento.js
//
// Prompt do CHAT da Central de Documentos, em arquivo próprio porque é longo e
// porque `prompts/index.js` já passa de 880 linhas.
//
// 🔴 A REGRA QUE DEFINE ESTE PROMPT: o assistente monta documento SOMENTE a partir
// do acervo de modelos que a clínica tem — os 12 globais da Res. CFMV 1.321/2020 e
// os que ela mesma criou. Ele NÃO redige um documento veterinário do zero.
//
// POR QUÊ: documento veterinário tem conteúdo mínimo definido por norma (a própria
// 1.321/2020, e a 1.318/2020 para receituário). Um modelo inventado pelo LLM sai
// plausível e incompleto — falta a identificação do responsável técnico, falta o
// campo de finalidade, falta a declaração que dá validade ao atestado. Partir de um
// modelo que já cumpre a norma e ADAPTÁ-LO mantém o piso legal e ainda assim entrega
// a velocidade que o chat promete.
'use strict';

const SO_JSON = 'Responda somente com o JSON. Sem markdown, sem preâmbulo, sem comentário, sem explicação.';

const TIPOS_BLOCO = [
  'titulo', 'subtitulo', 'texto', 'tabela', 'tabelaDinamica', 'imagem', 'linha',
  'qrcode', 'assinatura', 'checklist', 'campoAuto', 'medicamentos', 'vacinas',
  'procedimentos', 'exames', 'linhaTempo', 'observacoes', 'rodape',
].join(' | ');

/**
 * @param {object}   v
 * @param {Array}    v.acervo     — [{ id, nome, descricao, categoria, especie, global }]
 * @param {object?}  v.aberto     — { id, nome, blocos } do modelo em edição, se houver
 * @param {Array}    v.variaveis  — chaves de variável disponíveis
 * @param {Array}    v.conversa   — [{ papel: 'usuario'|'assistente', texto }]
 */
function build(v = {}) {
  const acervo = (v.acervo ?? [])
    .map(t => `- id ${t.id} · ${t.nome} · ${t.categoria} · ${t.especie}${t.global ? ' · MODELO DO SISTEMA (norma CFMV)' : ''}${t.descricao ? ` — ${t.descricao}` : ''}`)
    .join('\n') || '(o acervo está vazio)';

  const aberto = v.aberto
    ? `MODELO ABERTO NO EDITOR — id ${v.aberto.id}, "${v.aberto.nome}":\n${JSON.stringify(v.aberto.blocos ?? [], null, 0).slice(0, 12000)}`
    : 'Nenhum modelo aberto no editor.';

  const conversa = (v.conversa ?? [])
    .map(m => `${m.papel === 'assistente' ? 'ASSISTENTE' : 'VETERINÁRIO'}: ${String(m.texto ?? '').slice(0, 2000)}`)
    .join('\n');

  return `Monte documentos veterinários a partir do ACERVO DE MODELOS abaixo.

# REGRA PRINCIPAL
Trabalhe SOMENTE com os modelos do acervo e com o modelo aberto no editor.
Não redija um documento novo do zero, nem invente seções que nenhum modelo tem.
Quando o pedido não casar com nenhum modelo do acervo, diga isso e liste os modelos
mais próximos — não improvise um substituto.

# AÇÕES POSSÍVEIS
- "USAR_TEMPLATE": o pedido casa com um modelo do acervo. Devolva o id dele.
- "AJUSTAR": adapte os blocos do modelo aberto (ou do modelo escolhido) ao pedido —
  remover seção, acrescentar campo, trocar redação, reordenar. Devolva os blocos
  COMPLETOS já ajustados.
- "RESPONDER": o pedido é uma pergunta ou não dá para atender com o acervo. Só texto.

# BLOCOS
Cada bloco: { "id": "", "tipo": "${TIPOS_BLOCO}", "conteudo": {}, "estilo": {}, "visivel": true }
Campos de "conteudo" conforme o tipo: texto, itens[], colunas[], linhas[][], url,
variavel, rotulo, fonteDados, mostrarCrmv.
Preserve o "id" dos blocos que vieram do modelo aberto. Bloco novo: "id" vazio.
Todo documento termina com bloco "assinatura".

# VARIÁVEIS
Use {{chave}} para o que o sistema preenche sozinho. Chaves permitidas:
${(v.variaveis ?? []).join(', ')}
Não invente chave fora desta lista — variável inexistente sai vazia no papel.

# PROIBIÇÕES
- Não recomende conduta clínica, dose, diagnóstico ou prognóstico.
- Não escreva texto que afirme fato sobre o paciente ("o animal encontra-se hígido")
  fora do que o modelo de origem já afirma.
- Não altere a redação dos MODELOS DO SISTEMA além do que o pedido exigir: eles
  cumprem conteúdo mínimo de norma.

# ACERVO
${acervo}

# EDITOR
${aberto}

# CONVERSA
${conversa}

# SAÍDA
{
  "resposta": "uma ou duas frases ao veterinário, em português",
  "acao": "USAR_TEMPLATE" | "AJUSTAR" | "RESPONDER",
  "templateId": "id do acervo quando acao=USAR_TEMPLATE, senão null",
  "nome": "nome sugerido do documento quando acao=AJUSTAR, senão null",
  "blocos": [ ]
}
"blocos" só vem preenchido quando acao="AJUSTAR"; nos demais casos use [].

${SO_JSON}`;
}

module.exports = {
  'assistente_documento': {
    // v1: primeira versão. Ancorada no acervo (decisão de produto de 2026-08-26:
    // "multi-turno, mas baseado somente nos templates que temos e forem criados").
    version: 'v1',
    build,
  },
};
