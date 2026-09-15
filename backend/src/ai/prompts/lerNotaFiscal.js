'use strict';
/**
 * LEITURA DO DOCUMENTO DE COMPRA → itens de produto (2026-09-10)
 *
 * A clínica recebe o papel do fornecedor e redigita item por item na tela de Produtos.
 * Este prompt lê o documento (imagem ou PDF convertido) e devolve o que ela precisa:
 * NOME do item, QUANTIDADE, VALOR, DATA e o FORNECEDOR.
 *
 * 🔴 O CRITÉRIO É "DOCUMENTO DE COMPRA", NÃO "DOCUMENTO FISCAL" (ampliado em
 * 2026-09-10, depois de um caso real). A v1 exigia uma NOTA FISCAL, e o balcão do
 * fornecedor veterinário entrega o tempo todo papel que diz, em letras garrafais,
 * "ORÇAMENTO - SEM VALOR FISCAL" — com emitente, data, itens, quantidade e preço, ou
 * seja, com TUDO o que a tela precisa. O modelo lia certo e recusava certo; o critério
 * é que estava errado, e o resultado era o cadastro manual que esta função veio evitar.
 * ⚠️ Validade FISCAL nunca foi requisito aqui: o que nasce disto é catálogo de produto,
 * preço de compra e, quando a clínica manda, entrada de estoque — nada disso é
 * escrituração contábil. `tb_lotes_vacina.nota_fiscal` é texto de REFERÊNCIA.
 * ⚠️ Não afrouxar mais que isto: papel que não registra COMPRA (receita, laudo, exame,
 * foto de paciente) continua recusado — dali não sai item nem preço, e aceitar
 * produziria um formulário preenchido com o que não é produto.
 *
 * 🔴 NADA É INVENTADO. Campo que o documento não traz volta `null`, nunca um valor
 * plausível — é a mesma regra do resto do sistema ("nada de inventar valor", §12 de
 * 26/08), e aqui ela vale dinheiro: uma quantidade adivinhada vira estoque que não
 * existe, e um preço adivinhado vira dívida com o fornecedor que ninguém contraiu.
 *
 * 🔴 O QUE SAI DAQUI É PROPOSTA, NÃO CADASTRO. O resultado preenche o formulário e a
 * pessoa confere antes de salvar. Por isso o prompt prefere devolver `null` a
 * arriscar: o custo de um campo vazio é uma digitação; o de um campo errado é um
 * cadastro errado que ninguém revisa depois.
 *
 * ⚠️ A CHAVE DA SAÍDA CONTINUA SENDO `ehNotaFiscal`, de propósito. Renomeá-la para
 * `ehDocumentoCompra` obrigaria a tocar o serviço, o controller, a interface do front
 * e o gate de testes para não mudar comportamento nenhum — a mesma decisão registrada
 * em `tb_procedimento_combos.valor` (§12, 2026-09-10 parte 2). O que muda é o
 * CRITÉRIO, não o contrato.
 *
 * ⚠️ MULTIMODAL — o documento vai anexado (`inlineData`), então a chamada NÃO passa
 * por `callAI` (que só aceita texto). O log de uso e o GATE DE QUOTA são feitos à mão
 * em `services/notaFiscalService.js`; esquecê-los deixaria este caminho fora do teto
 * do plano do cliente (§7).
 */

const SO_JSON = 'Responda somente com o JSON. Sem markdown, sem preâmbulo, sem comentário, sem explicação.';

module.exports = {
  ler_nota_fiscal: {
    version: 'v2',
    build: ({ texto = '' } = {}) => `Extraia os dados de compra deste DOCUMENTO DE COMPRA de produtos veterinários.

# O QUE É UM DOCUMENTO DE COMPRA
Qualquer papel que registre a compra de produtos de um fornecedor: nota fiscal, nota
fiscal eletrônica (DANFE), cupom fiscal, orçamento ou pedido de balcão, recibo, ordem
de compra, comprovante de venda.
- **Documento SEM valor fiscal É ACEITO.** Dizeres impressos como "ORÇAMENTO",
  "SEM VALOR FISCAL", "PEDIDO", "NÃO É DOCUMENTO FISCAL" ou "COMPROVANTE NÃO FISCAL"
  descrevem a validade TRIBUTÁRIA do papel — não impedem a leitura. O que importa é
  haver o que foi comprado, de quem, e por quanto.
- Só devolva \`ehNotaFiscal: false\` quando o arquivo NÃO registrar compra alguma
  (receita, laudo, exame, foto, documento pessoal) ou estiver ilegível a ponto de não
  se ler os itens.

# O QUE EXTRAIR
- Dados do FORNECEDOR (o EMITENTE do documento — quem VENDEU).
- O NÚMERO do documento e a DATA de emissão.
- Cada ITEM comprado, com nome, quantidade, unidade e valores.

# REGRAS
- Devolva \`null\` em todo campo que o documento não traz. NUNCA invente, deduza ou complete.
- O FORNECEDOR é o EMITENTE — o estabelecimento no CABEÇALHO do papel. Ignore o
  DESTINATÁRIO/CLIENTE (blocos como "Dados do Cliente", "Comprador", "Destinatário"):
  é quem recebeu, não quem vendeu.
- Sem CNPJ impresso, devolva \`cnpj: null\` e traga o NOME e o endereço do emitente —
  é o que permite reconhecer ou cadastrar o fornecedor.
- CNPJ e CPF: somente dígitos, sem ponto, barra ou hífen.
- Data no formato AAAA-MM-DD. O documento em pt-BR traz DD/MM/AAAA — converta.
- Valores como número decimal com ponto. Sem "R$", sem separador de milhar.
  O documento em pt-BR usa vírgula decimal ("115,00") — converta para 115.00.
- \`valorUnitario\` é o preço de UMA unidade; \`valorTotal\` é o da linha inteira.
  Trazendo o documento só um dos dois, devolva o outro como \`null\` — não calcule
  dividindo, porque desconto e frete rateados na linha fazem a conta não fechar.
  Trazendo os dois (formato "QTD x UNIT = TOTAL", comum em cupom), devolva os dois.
- \`quantidade\` é o número de unidades da linha. Sem unidade explícita, devolva
  \`unidade: null\` — não presuma "un".
- A descrição pode vir abreviada ou em caixa alta, como está impressa. Copie-a como
  está — não expanda, não corrija e não "traduza" o nome do produto.
- \`tipo\` é "vacina" quando o item é uma vacina; "medicamento" no resto. Na dúvida,
  "medicamento".
- Ignore linhas que não são produto: código de barras solto, frete, desconto, tributos,
  totais, formas de pagamento, troco e observações.

# SAÍDA
{
  "ehNotaFiscal": true,
  "numero": "0001234 ou null",
  "dataEmissao": "2026-09-01 ou null",
  "fornecedor": {
    "nome": "razão social ou nome do emitente, ou null",
    "cnpj": "somente dígitos ou null",
    "cpf": "somente dígitos ou null",
    "telefone": "somente dígitos ou null",
    "email": "ou null",
    "cep": "somente dígitos ou null",
    "endereco": "logradouro e número ou null",
    "bairro": "ou null",
    "cidade": "ou null",
    "estado": "UF com 2 letras ou null"
  },
  "itens": [
    {
      "nome": "descrição do produto como está no documento",
      "tipo": "medicamento",
      "quantidade": 0,
      "unidade": "mL ou null",
      "valorUnitario": 0.00,
      "valorTotal": 0.00,
      "lote": "ou null",
      "validade": "AAAA-MM-DD ou null"
    }
  ]
}

${SO_JSON}

# TEXTO EXTRAÍDO DO DOCUMENTO
${texto.trim() ? texto.slice(0, 22000) : '(nenhum texto embutido — o documento é imagem/scan; use o anexo)'}`,
  },
};
