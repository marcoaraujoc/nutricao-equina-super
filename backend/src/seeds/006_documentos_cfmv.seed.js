// backend/src/seeds/006_documentos_cfmv.seed.js
//
// Os 12 anexos da RESOLUÇÃO CFMV Nº 1.321/2020 como modelos GLOBAIS da Central de
// Documentos (`tb_documento_templates` com `empresa_id` NULO — catálogo misto).
//
// ORIGEM: transcritos dos PDFs oficiais em `docs/modelos-documentos/cfmv-res-1321/`
// (anexos editáveis publicados pelo CRMV-RJ). O texto das declarações é VERBATIM da
// norma; o que mudou foi a FORMA — a linha pontilhada do papel virou VARIÁVEL
// `{{...}}` quando o S2Vet já tem o dado, e LACUNA `[[Rótulo]]` quando não tem (a
// lacuna é o que a tela de emissão pede à pessoa). Ver o mapa em `CAMPOS_ANIMAL`.
//
// 🔴 POR QUE SÃO GLOBAIS E NÃO DE CADA EMPRESA: o conteúdo mínimo destes documentos é
// definido por norma federal — não é preferência de clínica. Uma cópia por empresa
// significaria 12 × N linhas idênticas e, pior, uma correção de norma teria de ser
// aplicada N vezes. A clínica que quiser redação própria PERSONALIZA (copy-on-write
// em `DocumentoTemplateController`), e aí sim ganha a cópia dela.
//
// ⚠️ ATUALIZAR TEXTO DE NORMA: o upsert é por `chave` e SOBRESCREVE nome/descrição/
// blocos do modelo global. Isso é deliberado — é assim que uma revisão da resolução
// chega às clínicas. A cópia PERSONALIZADA de cada empresa NÃO é tocada (ela tem
// `empresa_id` preenchido), o que é a outra metade da mesma decisão: ninguém reescreve
// o documento que a clínica ajustou.
//
// ⚠️ NORMAS MUDAM. `docs/modelos-documentos/README.md` avisa: confira a vigência antes
// de tratar qualquer um destes como definitivo.
'use strict';

// ── Blocos ──────────────────────────────────────────────────────────────────
// Fábricas curtas para os blocos, no formato de frontend/src/modules/documentos/types.ts.
// `id` fica VAZIO: quem o atribui é o editor ao carregar (`criarBloco`/`novoId`), e
// gravar id no seed daria o mesmo id para o modelo em todas as clínicas.

let seq = 0;
const id = () => `cfmv${(seq++).toString(36)}`;

const bloco = (tipo, conteudo = {}, estilo = {}) => ({ id: id(), tipo, conteudo, estilo, visivel: true });

const titulo = (texto) =>
  bloco('titulo', { texto }, { tamanho: 16, peso: 'bold', alinhamento: 'center', espacamentoBase: 6 });

const subtitulo = (texto) =>
  bloco('subtitulo', { texto }, { tamanho: 12, peso: 'semibold', espacamentoTopo: 12, espacamentoBase: 4 });

const texto = (t, estilo = {}) =>
  bloco('texto', { texto: t }, { tamanho: 11, alinhamento: 'justify', espacamentoBase: 6, ...estilo });

const campo = (rotulo, variavel) =>
  bloco('campoAuto', { rotulo, variavel }, { tamanho: 11, espacamentoBase: 3 });

/**
 * Campo que o sistema NÃO tem — vira LACUNA `[[Rótulo]]`, pedida na tela de emissão.
 *
 * ⚠️ Antes isto era literalmente `______` dentro da string, o que tornava o campo
 * INVISÍVEL para o código: não havia como listar "o que falta preencher", que é
 * justamente a tela de emissão. Com a lacuna, o mesmo traço aparece no papel quando
 * o campo fica em branco, mas o sistema sabe que ali existe um campo "Tatuagem".
 * ⚠️ Nunca transformar um destes em variável "parecida": escrever a pelagem no
 * lugar do brinco produz documento errado com cara de documento certo.
 */
const linhaEmBranco = (rotulo) =>
  bloco('texto', { texto: `${rotulo}: [[${rotulo}]]` },
    { tamanho: 11, espacamentoBase: 3 });

const linha = () => bloco('linha', {}, { espacamentoTopo: 8, espacamentoBase: 8 });

const observacoes = (rotulo) =>
  bloco('observacoes', { texto: '', rotulo },
    { tamanho: 11, borda: 'completa', espacamentoTopo: 8, espacamentoBase: 8, altura: 70 });

const assinatura = (rotulo, mostrarCrmv) =>
  bloco('assinatura', { rotulo, mostrarCrmv }, { alinhamento: 'center', espacamentoTopo: 28, altura: 60 });

const rodape = (t) =>
  bloco('rodape', { texto: t }, { tamanho: 8, alinhamento: 'center', cor: '#9ca3af', espacamentoTopo: 14 });

// ── Trechos comuns aos 12 documentos ────────────────────────────────────────

/** Cabeçalho de identificação — idêntico nos 12 anexos da resolução. */
const IDENTIFICACAO_PROFISSIONAL = () => [
  subtitulo('Identificação do(a) Médico(a) Veterinário(a)'),
  campo('Médico(a) Veterinário(a)', '{{veterinario.nome}}'),
  campo('CRMV',        '{{veterinario.crmv}}'),
  campo('Estabelecimento', '{{veterinario.clinica}}'),
  campo('Telefone',    '{{veterinario.telefone}}'),
];

/**
 * Identificação do animal — o bloco que a norma repete em TODOS os anexos.
 *
 * Mapa campo do papel → dado do S2Vet. Tatuagem e Brinco não existem no cadastro
 * (o equino se identifica por resenha, chip e passaporte), então viram LACUNA — a
 * tela de emissão os pede — em vez de virarem variável de outra coisa.
 * ⚠️ `Microchip`, `Registro` e `Resenha` são VARIÁVEIS, mas o animal pode não os ter:
 * nesse caso a própria tela de emissão os oferece para preencher (origem CADASTRO em
 * `coletarCampos`), porque para quem emite "campo vazio é campo vazio".
 */
const CAMPOS_ANIMAL = () => [
  subtitulo('Identificação do animal'),
  campo('Nome do animal', '{{animal.nome}}'),
  campo('Espécie',        '{{animal.especie}}'),
  campo('Sexo',           '{{animal.sexo}}'),
  campo('Raça',           '{{animal.raca}}'),
  campo('Idade (real ou presumida)', '{{animal.idade}}'),
  campo('Pelagem / Cor',  '{{animal.pelagem}}'),
  linhaEmBranco('Tatuagem'),
  linhaEmBranco('Brinco'),
  campo('Microchip',      '{{animal.microchip}}'),
  campo('Registro Genealógico', '{{animal.registro}}'),
  campo('Resenha',        '{{animal.resenha}}'),
];

/** Identificação do responsável — idêntico nos 12. */
const CAMPOS_RESPONSAVEL = () => [
  subtitulo('Responsável pelo animal'),
  campo('Responsável', '{{cliente.nome}}'),
  campo('CPF / CNPJ',  '{{cliente.documento}}'),
  campo('Telefone',    '{{cliente.telefone}}'),
  campo('Endereço',    '{{propriedade.endereco}}'),
  campo('Município / UF', '{{propriedade.municipio}}'),
];

const LOCAL_E_DATA = () => [
  linha(),
  texto('Local e data: {{propriedade.municipio}}, {{sistema.dataEmissao}}.', { alinhamento: 'left', espacamentoTopo: 8 }),
];

/**
 * Rodapé exigido pela resolução: "Deve ser emitido em 2 vias".
 * Está em TODOS os 12 anexos e é obrigação de forma, não decoração.
 */
const RODAPE_DUAS_VIAS = (anexo) => rodape(
  `Documento em conformidade com a Resolução CFMV nº 1.321/2020, Anexo ${anexo}. `
  + 'Emitir em 2 vias: 1ª via médico(a) veterinário(a); 2ª via proprietário(a), tutor(a)/responsável.',
);

// ── Definição dos 12 ────────────────────────────────────────────────────────
//
// `assinante`: quem assina o papel.
//   VETERINARIO → atestado (o profissional declara um fato técnico)
//   RESPONSAVEL → termo de consentimento (quem consente é o tutor)
// A resolução coloca a assinatura do responsável nos TCLEs e a do veterinário nos
// atestados; inverter descaracteriza o documento.

const MODELOS = [
  {
    chave: 'cfmv_01_atestado_sanitario',
    anexo: 'I',
    nome: 'Atestado Sanitário',
    descricao: 'Atesta que o animal foi examinado e apresentou bom estado geral de saúde (Res. CFMV 1.321/2020, Anexo I).',
    categoria: 'sanidade',
    tags: ['atestado', 'sanitário', 'cfmv', 'trânsito'],
    declaracao:
      'Atesto para os devidos fins que foi por mim examinado nesta data o animal abaixo identificado, '
      + 'o qual apresentou bom estado geral de saúde durante o exame clínico, e que se encontram atendidas '
      + 'as medidas sanitárias definidas pelo(s) Serviço(s) Médico-Veterinário(s) Oficial(is), quando aplicável:',
    assinante: 'VETERINARIO',
    observacoes: ['Outras observações'],
  },
  {
    chave: 'cfmv_02_atestado_obito',
    anexo: 'II',
    nome: 'Atestado de Óbito',
    descricao: 'Atesta o óbito do animal, com local, data, hora e provável causa mortis (Res. CFMV 1.321/2020, Anexo II).',
    categoria: 'atendimento',
    tags: ['atestado', 'óbito', 'cfmv'],
    declaracao:
      'Atesto para os devidos fins que o animal abaixo identificado veio a óbito na localidade '
      + '[[Localidade do óbito]], às [[Hora do óbito]] horas do dia [[Data do óbito]], sendo a '
      + 'provável causa mortis [[Provável causa mortis]].',
    assinante: 'VETERINARIO',
    observacoes: [
      'Informações complementares à provável causa mortis e notificação obrigatória, quando for o caso',
      'Orientações para destinação do corpo (aspectos sanitários e ambientais)',
    ],
  },
  {
    chave: 'cfmv_03_tcle_exames',
    anexo: 'III',
    nome: 'Consentimento — Realização de Exames',
    descricao: 'Termo de consentimento livre e esclarecido para realização de exames (Res. CFMV 1.321/2020, Anexo III).',
    categoria: 'consentimentos',
    tags: ['tcle', 'consentimento', 'exames', 'cfmv'],
    declaracao:
      'Declaro o livre consentimento para a realização do(s) exame(s) '
      + '[[Exame(s) a realizar]] '
      + 'no animal abaixo identificado, a ser realizado pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, '
      + 'CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, ter sido esclarecido(a) acerca dos possíveis riscos inerentes ao procedimento, '
      + 'durante ou após a realização do(s) citado(s) exame(s), estando o(a) referido(a) profissional '
      + 'isento(a) de quaisquer responsabilidades decorrentes de tais riscos.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_04_tcle_procedimento_risco',
    anexo: 'IV',
    nome: 'Consentimento — Procedimento Terapêutico de Risco',
    descricao: 'Termo de consentimento para procedimento terapêutico de risco (Res. CFMV 1.321/2020, Anexo IV).',
    categoria: 'consentimentos',
    tags: ['tcle', 'consentimento', 'risco', 'cfmv'],
    declaracao:
      'Declaro o livre consentimento para a realização do(s) procedimento(s) terapêutico(s) de risco '
      + '[[Procedimento(s) terapêutico(s)]] '
      + 'no animal abaixo identificado, a ser realizado pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, '
      + 'CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, ter sido esclarecido(a) acerca dos possíveis riscos inerentes, durante ou após a '
      + 'realização do(s) procedimento(s) terapêutico(s), estando o(a) referido(a) profissional isento(a) '
      + 'de quaisquer responsabilidades decorrentes de tais riscos.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_05_tcle_retirada_corpo',
    anexo: 'V',
    nome: 'Consentimento — Retirada do Corpo em Óbito',
    descricao: 'Termo de retirada do cadáver pelo responsável, com ciência da destinação ambiental (Res. CFMV 1.321/2020, Anexo V).',
    categoria: 'consentimentos',
    tags: ['tcle', 'óbito', 'corpo', 'cfmv'],
    declaracao:
      'Declaro para os devidos fins que, nesta ocasião, retiro o cadáver do animal abaixo identificado, '
      + 'que veio a óbito na localidade [[Localidade do óbito]], às [[Hora do óbito]] horas do dia '
      + '[[Data do óbito]], cujo óbito, provocado pela provável causa mortis [[Provável causa mortis]], '
      + 'foi constatado pelo médico-veterinário que subscreve a presente, e que recebi esclarecimentos quanto '
      + 'à necessidade de dar tratamento respeitoso e destinação ambiental adequada ao cadáver, em respeito '
      + 'às normas ambientais.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_06_tcle_cirurgico',
    anexo: 'VI',
    nome: 'Consentimento — Procedimento Cirúrgico',
    descricao: 'Termo de consentimento para procedimento cirúrgico (Res. CFMV 1.321/2020, Anexo VI).',
    categoria: 'cirurgias',
    tags: ['tcle', 'consentimento', 'cirurgia', 'cfmv'],
    declaracao:
      'Declaro o livre consentimento para a realização do procedimento cirúrgico de '
      + '[[Procedimento cirúrgico]] '
      + 'no animal abaixo identificado, a ser realizado pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, '
      + 'CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, ter sido esclarecido(a) acerca dos riscos inerentes, durante ou após a realização do '
      + 'procedimento cirúrgico citado, estando o(a) referido(a) profissional isento(a) de quaisquer '
      + 'responsabilidades decorrentes de tais riscos.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_07_tcle_internacao',
    anexo: 'VII',
    nome: 'Consentimento — Internação e Tratamento Clínico',
    descricao: 'Termo de consentimento para internação e tratamento clínico/pós-cirúrgico (Res. CFMV 1.321/2020, Anexo VII).',
    categoria: 'consentimentos',
    tags: ['tcle', 'internação', 'tratamento', 'cfmv'],
    declaracao:
      'Declaro o livre consentimento para a realização de internação e tratamento(s) necessário(s) no animal '
      + 'abaixo identificado, a ser realizado pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, '
      + 'CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, ter sido esclarecido(a) acerca dos possíveis riscos inerentes à situação clínica do '
      + 'animal, bem como do(s) tratamento(s) proposto(s), estando o(a) referido(a) profissional isento(a) '
      + 'de quaisquer responsabilidades decorrentes de tais riscos.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_08_tcle_anestesico',
    anexo: 'VIII',
    nome: 'Consentimento — Procedimentos Anestésicos',
    descricao: 'Termo de consentimento para procedimentos anestésicos (Res. CFMV 1.321/2020, Anexo VIII).',
    categoria: 'consentimentos',
    tags: ['tcle', 'anestesia', 'cfmv'],
    declaracao:
      'Declaro o livre consentimento para a realização do(s) procedimento(s) anestésico(s) necessário(s) no '
      + 'animal abaixo identificado, a ser realizado pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, '
      + 'CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, ter sido esclarecido(a) acerca dos possíveis riscos inerentes ao(s) procedimento(s) '
      + 'proposto(s), estando o(a) referido(a) profissional isento(a) de quaisquer responsabilidades '
      + 'decorrentes de tais riscos.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_09_tcle_eutanasia',
    anexo: 'IX',
    nome: 'Consentimento — Eutanásia',
    descricao: 'Termo de consentimento livre e esclarecido para realização de eutanásia (Res. CFMV 1.321/2020, Anexo IX).',
    categoria: 'consentimentos',
    tags: ['tcle', 'eutanásia', 'cfmv'],
    declaracao:
      'Declaro estar ciente dos motivos que levam à necessidade de realização da eutanásia, que reconheço que '
      + 'esta é a opção escolhida por mim para cessar definitivamente o sofrimento do animal e, portanto, '
      + 'declaro o livre consentimento para a realização da eutanásia do animal abaixo identificado, a ser '
      + 'realizada pelo(a) Médico(a) Veterinário(a) {{veterinario.nome}}, CRMV {{veterinario.crmv}}.',
    ciencia:
      'Declaro, ainda, que fui devidamente esclarecido(a) do método que será utilizado, assim como de que '
      + 'este é um processo irreversível.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_10_retirada_sem_alta',
    anexo: 'X',
    nome: 'Termo — Retirada sem Alta Médica',
    descricao: 'Termo de retirada do animal sem alta médica, com assunção de responsabilidade (Res. CFMV 1.321/2020, Anexo X).',
    categoria: 'consentimentos',
    tags: ['termo', 'alta', 'responsabilidade', 'cfmv'],
    declaracao:
      'Declaro que foi esclarecido ao ora subscritor que o animal abaixo identificado não obteve alta médica '
      + 'e que há recomendação para manter o animal em internação em estabelecimento médico veterinário '
      + 'apropriado.',
    ciencia:
      'Declaro ainda que estou ciente de que há riscos de agravamento da doença, inclusive morte, e que '
      + 'assumo inteira responsabilidade por esse ato.',
    assinante: 'RESPONSAVEL',
  },
  {
    chave: 'cfmv_11_atestado_vacinacao',
    anexo: 'XI',
    nome: 'Atestado de Vacinação',
    descricao: 'Atesta a vacinação do animal, com produto, partida, fabricante e validade (Res. CFMV 1.321/2020, Anexo XI).',
    categoria: 'sanidade',
    tags: ['atestado', 'vacinação', 'cfmv'],
    declaracao:
      'Atesto para os devidos fins que o animal abaixo identificado foi vacinado por mim nesta data, '
      + 'conforme informações abaixo:',
    assinante: 'VETERINARIO',
    // Campos próprios do anexo XI. `vacinas.ultima` puxa a última vacina registrada
    // no S2Vet; partida/fabricante/validade continuam linha em branco porque a
    // vacina do prontuário nem sempre é a que este atestado descreve.
    extras: () => [
      subtitulo('Vacinação'),
      campo('Vacinação contra (última registrada)', '{{vacinas.ultima}}'),
      campo('Próxima dose prevista', '{{vacinas.proximaDose}}'),
      linhaEmBranco('Nome comercial da vacina'),
      linhaEmBranco('Número da partida'),
      linhaEmBranco('Fabricante'),
      linhaEmBranco('Data de fabricação / Data de validade'),
    ],
    observacoes: ['Outras observações'],
  },
  {
    chave: 'cfmv_12_tcle_doacao_corpo',
    anexo: 'XII',
    nome: 'Consentimento — Doação do Corpo para Ensino e Pesquisa',
    descricao: 'Termo de consentimento para doação do corpo do animal a ensino e pesquisa (Res. CFMV 1.321/2020, Anexo XII).',
    categoria: 'consentimentos',
    tags: ['tcle', 'doação', 'ensino', 'pesquisa', 'cfmv'],
    declaracao: 'Declaro o livre consentimento sobre a doação do corpo do animal abaixo identificado.',
    ciencia: 'Declaro, ainda, ter sido esclarecido(a) acerca da destinação do corpo para fins de estudo e pesquisa.',
    assinante: 'RESPONSAVEL',
  },
];

/**
 * Monta os blocos de um modelo. A ORDEM segue a do papel: identificação do
 * profissional → declaração → identificação do animal → [campos próprios] →
 * ciência → observações → responsável → local/data → assinatura → rodapé.
 */
function montarBlocos(def) {
  const blocos = [
    titulo(def.nome.toUpperCase()),
    ...IDENTIFICACAO_PROFISSIONAL(),
    linha(),
    texto(def.declaracao),
    ...CAMPOS_ANIMAL(),
  ];

  if (typeof def.extras === 'function') blocos.push(...def.extras());
  if (def.ciencia) blocos.push(texto(def.ciencia, { espacamentoTopo: 8 }));

  blocos.push(observacoes('Observações do(a) Médico(a) Veterinário(a)'));
  // Só o TCLE tem campo de observação DO RESPONSÁVEL — é o que registra a
  // manifestação de quem consente, e nos atestados ela não existe.
  if (def.assinante === 'RESPONSAVEL') blocos.push(observacoes('Observações do(a) responsável'));
  for (const rot of def.observacoes ?? []) blocos.push(observacoes(rot));

  blocos.push(...CAMPOS_RESPONSAVEL());
  blocos.push(...LOCAL_E_DATA());
  blocos.push(
    def.assinante === 'RESPONSAVEL'
      ? assinatura('Responsável pelo animal', false)
      : assinatura('Médico(a) Veterinário(a) — assinatura e carimbo', true),
  );
  blocos.push(RODAPE_DUAS_VIAS(def.anexo));
  return blocos;
}

/**
 * Semeia/atualiza os 12 modelos globais. Idempotente por `chave`.
 *
 * ⚠️ O `where` usa `chave` + `empresaId: null` via `findFirst`, e não `upsert`: o
 * índice único da chave é PARCIAL (`WHERE empresa_id IS NULL`), e o Prisma não
 * expressa índice parcial como chave única de `upsert`.
 */
async function seedDocumentosCfmv(prisma) {
  let criados = 0;
  let atualizados = 0;

  for (const def of MODELOS) {
    seq = 0;   // ids estáveis entre execuções — evita diff falso no JSONB
    const dados = {
      nome:      def.nome,
      descricao: def.descricao,
      categoria: def.categoria,
      // Os documentos da 1.321/2020 valem para QUALQUER espécie: a norma é geral e a
      // especificidade vem do que se escreve neles. Marcar EQUINO esconderia o
      // atestado sanitário da clínica de bovinos.
      especie:   'AMBOS',
      tags:      def.tags,
      blocos:    montarBlocos(def),
      chave:     def.chave,
      status:    'PUBLICADO',
      autorNome: 'CFMV — Resolução 1.321/2020',
    };

    const existente = await prisma.documentoTemplate.findFirst({
      where:  { chave: def.chave, empresaId: null },
      select: { id: true },
    });

    if (existente) {
      await prisma.documentoTemplate.update({ where: { id: existente.id }, data: dados });
      atualizados += 1;
    } else {
      await prisma.documentoTemplate.create({ data: { ...dados, empresaId: null } });
      criados += 1;
    }
  }
  return { criados, atualizados, total: MODELOS.length };
}

module.exports = { seedDocumentosCfmv, MODELOS, montarBlocos };
