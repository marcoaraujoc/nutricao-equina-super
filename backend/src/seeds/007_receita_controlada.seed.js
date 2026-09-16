// backend/src/seeds/007_receita_controlada.seed.js
//
// 🔴 RECEITA CONTROLADA ESPECIAL — a folha de preenchimento (2026-09-15).
//
// Transcrita do modelo em papel que a clínica usa (`controlada.png`): identificação
// do médico veterinário, dados do animal, a medicação, a assinatura com carimbo e —
// abaixo da linha de corte — os dados do COMPRADOR e do FORNECEDOR, que é o que
// distingue este papel de uma receita comum.
//
// 🔴 POR QUE ELE PRECISA EXISTIR NO ACERVO: a tela de Prescrição RECORTA os
// medicamentos controlados para este documento (`modules/documentos/receitaControlada.ts`
// — a busca é PELO NOME, "Receita Controlada"). Sem o modelo, os três botões
// (Imprimir / WhatsApp / E-mail) imprimem o grupo INTEIRO e um toast diz o motivo.
// Trocar o nome deste modelo quebra esse elo.
//
// ⚠️ ESTE MODELO É DA EMPRESA, não global. Os 12 do CFMV são globais porque o
// conteúdo mínimo deles vem de norma federal; esta folha é a que a clínica usa, com
// o desenho dela — e criá-la global a imporia a todas as clínicas do SaaS. Quem
// quiser adotá-la em outra empresa roda este seed apontando para ela.
//
// ⚠️ MULTI-TENANT/RLS: `tb_documento_templates` tem RLS com `WITH CHECK` que só aceita
// `empresa_id = app_empresa_id()` (ou escopo de plataforma). Quem roda isto tem de
// estar sob `comEscopoPlataforma` — é o que `backend/seed.js` já faz — ou o INSERT é
// recusado pelo banco.
'use strict';

let seq = 0;
const id = () => `rc${(seq++).toString(36)}`;

const bloco = (tipo, conteudo = {}, estilo = {}) => ({ id: id(), tipo, conteudo, estilo, visivel: true });

const titulo = (texto) =>
  bloco('titulo', { texto }, { tamanho: 16, peso: 'bold', alinhamento: 'center', espacamentoBase: 6 });

const subtitulo = (texto) =>
  bloco('subtitulo', { texto }, { tamanho: 12, peso: 'semibold', espacamentoTopo: 12, espacamentoBase: 4 });

/** Campo automático em DUAS colunas — o papel tem pares lado a lado. */
const campo = (rotulo, variavel, estilo = {}) =>
  bloco('campoAuto', { rotulo, variavel }, { tamanho: 11, espacamentoBase: 3, colunas: 2, ...estilo });

/**
 * Campo que o S2Vet NÃO tem — vira LACUNA `[[Rótulo]]`, pedida na tela de emissão.
 *
 * ⚠️ Nunca virar variável "parecida": escrever o telefone da clínica no lugar do
 * telefone da FARMÁCIA produz documento errado com cara de documento certo. Os dados
 * do comprador e do fornecedor são preenchidos no balcão, e por isso são lacunas.
 */
const lacuna = (rotulo, estilo = {}) =>
  bloco('texto', { texto: `${rotulo}: [[${rotulo}]]` },
    { tamanho: 11, espacamentoBase: 3, colunas: 2, ...estilo });

const linha = () => bloco('linha', {}, { espacamentoTopo: 10, espacamentoBase: 10 });

const assinatura = (rotulo, doVeterinario) =>
  bloco('assinatura',
    // 🔴 `assinante` diz de QUEM é a identidade impressa sobre a linha. Só na do
    // veterinário a folha carimba a assinatura escaneada, o nome e o CRMV de quem
    // emite. Sem isso, o receituário sairia com a assinatura do vet sobre a linha do
    // farmacêutico — documento falso, e nada acusaria.
    { rotulo, mostrarCrmv: doVeterinario, assinante: doVeterinario ? 'VETERINARIO' : 'OUTRO' },
    { alinhamento: 'center', espacamentoTopo: 24, altura: 56 });

const rodape = (t) =>
  bloco('rodape', { texto: t }, { tamanho: 8, alinhamento: 'center', cor: '#9ca3af', espacamentoTopo: 14 });

const CHAVE = 'receita_controlada_especial';
const NOME  = 'Receita Controlada';

function montarBlocos() {
  seq = 0;
  return [
    // O cabeçalho da folha ABSORVE o primeiro bloco `titulo` (não o imprime duas
    // vezes) — ver `modules/documentos/cabecalho.ts#prepararFolha`.
    titulo('RECEITA CONTROLADA ESPECIAL'),

    subtitulo('Identificação do(a) Médico(a) Veterinário(a)'),
    campo('Médico(a) Veterinário(a)', '{{veterinario.nome}}'),
    campo('CRMV',            '{{veterinario.crmv}}'),
    campo('Estabelecimento', '{{veterinario.clinica}}'),
    campo('Telefone',        '{{veterinario.telefone}}'),

    subtitulo('Dados do Animal'),
    campo('Nome do animal', '{{animal.nome}}'),
    campo('Espécie',        '{{animal.especie}}'),
    campo('Sexo',           '{{animal.sexo}}'),
    campo('Raça',           '{{animal.raca}}'),
    campo('Idade',          '{{animal.idade}}'),
    campo('Pelagem',        '{{animal.pelagem}}'),

    subtitulo('Medicação'),
    // 🔴 A LISTA NASCE PREENCHIDA com os CONTROLADOS da prescrição de origem
    // (`prescricao.controlados`) — é justamente o recorte que a tela de Prescrição
    // manda para cá. As COLUNAS são as CANÔNICAS da fonte, nunca as escritas aqui:
    // é o que faz a dose cair na coluna da dose (ver `lib/documentoListas.js`).
    // `formato: 'campos'` desenha "Rótulo: valor" em vez de tabela, que é a cara do
    // papel — cinco colunas numa A4 retrato deixam o nome do medicamento em três
    // linhas.
    bloco('medicamentos',
      { rotulo: 'Medicamentos sujeitos a controle especial', fonteDados: 'prescricao.controlados', formato: 'campos' },
      { tamanho: 11, borda: 'nenhuma', espacamentoTopo: 6, espacamentoBase: 10 }),
    // Concentração e Quantidade não existem como dado estruturado no S2Vet (a
    // prescrição guarda dosagem/unidade). Viram LACUNA em vez de variável "parecida".
    lacuna('Concentração'),
    lacuna('Quantidade'),
    lacuna('Duração do tratamento'),

    // Local e data à DIREITA, logo acima da assinatura — onde ficam no ofício
    // brasileiro. Mesma composição dos 12 modelos do CFMV: não existe uma variável
    // "localData"; o local sai do município da propriedade e a data, da emissão.
    bloco('texto', { texto: 'Local e data: {{propriedade.municipio}}, {{sistema.dataEmissao}}.' },
      { tamanho: 11, alinhamento: 'right', espacamentoTopo: 12 }),
    assinatura('Assinatura e carimbo do(a) Médico(a) Veterinário(a)', true),

    linha(),

    // ── Preenchidos no BALCÃO, na hora da dispensação ────────────────────────
    subtitulo('Dados do Comprador'),
    lacuna('Nome'),
    lacuna('CPF'),
    lacuna('Telefone'),
    lacuna('Endereço', { colunas: 1 }),
    lacuna('Cidade'),
    lacuna('Estado'),

    subtitulo('Dados do Fornecedor'),
    lacuna('Farmácia / Estabelecimento', { colunas: 1 }),
    lacuna('CNPJ'),
    lacuna('Telefone do fornecedor'),
    lacuna('Endereço do fornecedor', { colunas: 1 }),
    lacuna('Cidade do fornecedor'),
    lacuna('Estado do fornecedor'),

    // 🔴 É DAQUI que saem as 2 VIAS na impressão: `DocumentoPrint.viasDoDocumento` lê
    // esta frase do PRÓPRIO papel. Some a frase, some a segunda via — e nada acusa.
    rodape('Emitir em 2 vias: 1ª via: Farmácia | 2ª via: Proprietário(a) do animal'),
  ];
}

/**
 * Cria (ou atualiza) o modelo na empresa informada.
 *
 * @param {object} prisma  client de TENANT, dentro de `comEscopoPlataforma`
 * @param {number} empresaId
 */
async function semear(prisma, empresaId) {
  if (!empresaId) throw new Error('007_receita_controlada: informe a empresa.');

  const existente = await prisma.documentoTemplate.findFirst({
    where:  { empresaId: Number(empresaId), chave: CHAVE },
    select: { id: true },
  });

  const dados = {
    nome:      NOME,
    descricao: 'Receituário de controle especial — 1ª via Farmácia, 2ª via Proprietário.',
    categoria: 'receituarios',
    especie:   'AMBOS',
    blocos:    montarBlocos(),
    status:    'PUBLICADO',
    excluido:  false,
  };

  if (existente) {
    await prisma.documentoTemplate.update({ where: { id: existente.id }, data: dados });
    return { id: existente.id, criado: false };
  }
  const criado = await prisma.documentoTemplate.create({
    data: { ...dados, chave: CHAVE, empresaId: Number(empresaId) },
    select: { id: true },
  });
  return { id: criado.id, criado: true };
}

module.exports = { semear, montarBlocos, CHAVE, NOME };
