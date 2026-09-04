// backend/src/__tests__/documentosCentral.test.js
//
// Trava as regras da Central de Documentos que quebram EM SILÊNCIO — as que não
// derrubam requisição nenhuma, só produzem um papel errado com cara de papel certo:
//
//   1. Variável sem dado tem de sair VAZIA, nunca com o exemplo do catálogo. Um
//      atestado dizendo "Pelagem: Castanho" porque o cadastro estava em branco é
//      documento falso, e nada no sistema acusaria.
//   2. A resolução tem de alcançar TODO campo textual do bloco — inclusive célula de
//      tabela e item de checklist. Resolver só `conteudo.texto` deixa `{{animal.nome}}`
//      cru no meio da folha impressa.
//   3. O chat da IA só pode aceitar bloco de tipo CONHECIDO e template que esteja de
//      fato NO ACERVO. Bloco alucinado quebra o editor; id alucinado vira consulta que
//      o RLS recusa, e o vet vê erro de banco em vez de resposta.
//   4. Os 12 modelos do CFMV precisam manter a identificação do animal e a assinatura
//      — é o conteúdo mínimo que a Res. 1.321/2020 exige, e é o motivo de eles serem
//      o catálogo global em vez de texto livre.

// `lib/prisma` é TypeScript e o babel-jest não o transpila — mesmo mock dos demais
// testes de lib. Nada aqui toca o banco: são todas funções puras.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
// `ai/index.ts` idem. `normalizarBlocos` e `VARIAVEIS_VALIDAS` são puros e não
// chegam a chamar o provider — o mock só existe para o módulo carregar.
jest.mock('../ai', () => ({ callAI: jest.fn(), MODULOS_IA: { DOCUMENTOS: 'DOCUMENTOS' } }), { virtual: true });
// `storage/index.ts` idem — o `DocumentoTemplateController` passou a importá-lo por
// causa do upload do documento enviado pela clínica. Nada aqui sobe arquivo: só
// `normalizarCategoria`, que é pura.
jest.mock('../storage', () => ({ storage: { upload: jest.fn(), delete: jest.fn(), getUrl: jest.fn() } }), { virtual: true });
// `ai/geminiClient.ts` idem — o `documentoConversaoService` o importa para a chamada
// MULTIMODAL (que não passa por `callAI`). Nada aqui chama o modelo: os casos cobrem
// só as funções puras que validam o que ele devolveu.
jest.mock('../ai/geminiClient', () => ({ gerarConteudo: jest.fn(), PROVEDOR: 'google' }), { virtual: true });

const { aplicarEmTexto, aplicarEmBlocos, coletarCampos, chaveDaLacuna, idadeDe, resenhaDe } = require('../lib/documentoVariaveis');
const { normalizarBlocos, VARIAVEIS_VALIDAS } = require('../services/documentoLLMService');
const { MODELOS, montarBlocos } = require('../seeds/006_documentos_cfmv.seed');
const { coletarListas } = require('../lib/documentoListas');

const bloco = (tipo, conteudo) => ({ id: 'b1', tipo, conteudo, estilo: {}, visivel: true });

describe('resolução de variáveis', () => {
  const ctx = { 'animal.nome': 'Corbela', 'cliente.nome': 'Haras Boa Vista' };

  it('substitui a chave pelo valor do contexto', () => {
    expect(aplicarEmTexto('Animal {{animal.nome}}, de {{cliente.nome}}.', ctx))
      .toBe('Animal Corbela, de Haras Boa Vista.');
  });

  it('tolera espaço dentro das chaves', () => {
    expect(aplicarEmTexto('{{ animal.nome }}', ctx)).toBe('Corbela');
  });

  it('🔴 chave SEM dado vira string vazia — nunca um valor inventado', () => {
    // A regressão que este teste impede: cair no `exemplo` do catálogo do front
    // ("Castanho", "Thor") quando o cadastro do paciente está incompleto.
    expect(aplicarEmTexto('Pelagem: {{animal.pelagem}}.', ctx)).toBe('Pelagem: .');
    expect(aplicarEmTexto('{{variavel.que.nao.existe}}', ctx)).toBe('');
  });

  it('texto sem variável passa intacto', () => {
    expect(aplicarEmTexto('Atesto para os devidos fins.', ctx)).toBe('Atesto para os devidos fins.');
  });
});

describe('aplicarEmBlocos', () => {
  const ctx = { 'animal.nome': 'Corbela', 'animal.peso': '480 kg', 'cliente.nome': 'Haras Boa Vista' };

  it('resolve texto, rótulo, checklist, colunas e CÉLULAS de tabela', () => {
    const [texto, lista, tabela] = aplicarEmBlocos([
      bloco('texto',     { texto: 'Paciente {{animal.nome}}' }),
      bloco('checklist', { itens: ['Pesar {{animal.nome}}', 'Conferir dose'] }),
      bloco('tabela',    { colunas: ['Animal', '{{cliente.nome}}'], linhas: [['{{animal.nome}}', '{{animal.peso}}']] }),
    ], ctx);

    expect(texto.conteudo.texto).toBe('Paciente Corbela');
    expect(lista.conteudo.itens[0]).toBe('Pesar Corbela');
    expect(tabela.conteudo.colunas[1]).toBe('Haras Boa Vista');
    // A célula é o ponto: resolver só `conteudo.texto` deixaria `{{animal.nome}}`
    // impresso dentro da tabela.
    expect(tabela.conteudo.linhas[0]).toEqual(['Corbela', '480 kg']);
  });

  it('campoAuto grava o valor em `texto` e PRESERVA a chave em `variavel`', () => {
    // Preservar a chave é o que permite auditar, no documento já emitido, de qual
    // variável saiu cada valor impresso.
    const [b] = aplicarEmBlocos([bloco('campoAuto', { rotulo: 'Animal', variavel: '{{animal.nome}}' })], ctx);
    expect(b.conteudo.texto).toBe('Corbela');
    expect(b.conteudo.variavel).toBe('{{animal.nome}}');
  });

  it('não muta os blocos recebidos', () => {
    const originais = [bloco('texto', { texto: '{{animal.nome}}' })];
    aplicarEmBlocos(originais, ctx);
    expect(originais[0].conteudo.texto).toBe('{{animal.nome}}');
  });

  it('entrada inválida devolve lista vazia em vez de estourar', () => {
    expect(aplicarEmBlocos(null, ctx)).toEqual([]);
  });
});

describe('formatação de dados do animal', () => {
  it('idade sai por extenso a partir da data de nascimento', () => {
    const cinco = new Date();
    cinco.setFullYear(cinco.getFullYear() - 5);
    expect(idadeDe(cinco.toISOString(), null)).toBe('5 anos');
  });

  it('sem data de nascimento, cai na idade digitada no cadastro', () => {
    expect(idadeDe(null, 7)).toBe('7 anos');
    expect(idadeDe(null, 1)).toBe('1 ano');
  });

  it('sem nenhum dos dois, devolve vazio — não chuta idade', () => {
    expect(idadeDe(null, null)).toBe('');
  });

  it('resenha monta com o que existe e omite o que falta', () => {
    expect(resenhaDe({ pelagem: 'Castanho', altura: null, numeroChip: '985141000123456' }))
      .toBe('Castanho, chip 985141000123456');
    expect(resenhaDe({ pelagem: null, altura: null, numeroChip: null })).toBe('');
  });
});

describe('chat da IA — validação da resposta do modelo', () => {
  it('descarta bloco de tipo desconhecido em vez de convertê-lo', () => {
    // Converter para `texto` mentiria sobre o que o assistente propôs; manter
    // quebraria o editor, que não sabe renderizar o tipo.
    const saida = normalizarBlocos([
      { tipo: 'texto',      conteudo: { texto: 'ok' } },
      { tipo: 'holograma',  conteudo: { texto: 'inventado' } },
    ]);
    expect(saida).toHaveLength(1);
    expect(saida[0].tipo).toBe('texto');
  });

  it('preserva o id do bloco que veio do editor e gera id para o bloco novo', () => {
    const saida = normalizarBlocos([
      { id: 'existente', tipo: 'texto', conteudo: { texto: 'a' } },
      { tipo: 'texto', conteudo: { texto: 'b' } },
    ]);
    expect(saida[0].id).toBe('existente');
    expect(saida[1].id).toBeTruthy();
    expect(saida[1].id).not.toBe('existente');
  });

  it('normaliza conteúdo malformado sem estourar', () => {
    const saida = normalizarBlocos([{ tipo: 'tabela', conteudo: { linhas: [null, ['a']] } }]);
    expect(saida[0].conteudo.linhas[0]).toEqual([]);
    expect(saida[0].conteudo.linhas[1]).toEqual(['a']);
  });

  it('entrada não-array devolve lista vazia', () => {
    expect(normalizarBlocos(undefined)).toEqual([]);
    expect(normalizarBlocos('nada')).toEqual([]);
  });

  it('a lista de variáveis oferecida ao modelo não promete o que não existe', () => {
    // Toda chave aqui tem de ser resolvida por `documentoVariaveis.montarContexto`.
    // Prometer uma chave inexistente faz a IA usá-la e o papel sair com um buraco.
    for (const chave of VARIAVEIS_VALIDAS) {
      expect(chave).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
    expect(VARIAVEIS_VALIDAS).toContain('animal.nome');
    expect(VARIAVEIS_VALIDAS).toContain('veterinario.crmv');
    // Internação/reprodução/financeiro NÃO têm módulo no S2Vet e resolvem vazio —
    // não podem ser oferecidas ao modelo como se preenchessem.
    expect(VARIAVEIS_VALIDAS).not.toContain('reproducao.dg');
    expect(VARIAVEIS_VALIDAS).not.toContain('financeiro.valor');
  });
});

describe('lacunas — os campos em branco do papel', () => {
  const ctx = { 'animal.nome': 'Corbela', 'animal.microchip': '' };

  it('`[[Rótulo]]` é trocado pelo que foi preenchido', () => {
    expect(aplicarEmTexto('Tatuagem: [[Tatuagem]]', ctx, { tatuagem: 'A-42' }))
      .toBe('Tatuagem: A-42');
  });

  it('🔴 lacuna NÃO preenchida vira vazio — nunca `[[Tatuagem]]` impresso', () => {
    // Imprimir a marcação no papel do cliente seria pior que imprimir nada.
    expect(aplicarEmTexto('Tatuagem: [[Tatuagem]]', ctx, {})).toBe('Tatuagem: ');
    expect(aplicarEmTexto('Tatuagem: [[Tatuagem]]', ctx, null)).toBe('Tatuagem: ');
  });

  it('a chave é o rótulo normalizado — caixa e espaço não importam', () => {
    expect(chaveDaLacuna('  Nome Comercial da Vacina ')).toBe('nome comercial da vacina');
    expect(aplicarEmTexto('[[ Tatuagem ]]', ctx, { tatuagem: 'A-42' })).toBe('A-42');
  });

  it('lacunas e variáveis convivem no mesmo texto', () => {
    expect(aplicarEmTexto('{{animal.nome}} — brinco [[Brinco]]', ctx, { brinco: '77' }))
      .toBe('Corbela — brinco 77');
  });

  it('o RÓTULO do bloco não recebe o preenchimento', () => {
    // Resolver a lacuna dentro do rótulo apagaria justamente o nome do campo.
    const [b] = aplicarEmBlocos(
      [bloco('observacoes', { rotulo: 'Observações', texto: '' })], ctx, { 'observações': 'sem alterações' },
    );
    expect(b.conteudo.rotulo).toBe('Observações');
    expect(b.conteudo.texto).toBe('sem alterações');
  });

  it('campoAuto sem dado no cadastro usa o que foi digitado', () => {
    const [b] = aplicarEmBlocos(
      [bloco('campoAuto', { rotulo: 'Microchip', variavel: '{{animal.microchip}}' })],
      ctx, { microchip: '985141000123456' },
    );
    expect(b.conteudo.texto).toBe('985141000123456');
  });

  it('🔴 preencher um campo automático vale para o DOCUMENTO INTEIRO', () => {
    // O caso real: no anexo XI, `{{propriedade.municipio}}` aparece como campo E na
    // linha "Local e data: ..., 26/08/2026". Sem isto o vet preenchia o município e a
    // linha do rodapé continuava com a vírgula solta, como se nada tivesse sido feito.
    const blocos = [
      bloco('campoAuto', { rotulo: 'Município / UF', variavel: '{{propriedade.municipio}}' }),
      bloco('texto',     { texto: 'Local e data: {{propriedade.municipio}}, 26/08/2026.' }),
    ];
    const [campo, linha] = aplicarEmBlocos(blocos, { 'propriedade.municipio': '' },
      { 'município / uf': 'Itu / SP' });
    expect(campo.conteudo.texto).toBe('Itu / SP');
    expect(linha.conteudo.texto).toBe('Local e data: Itu / SP, 26/08/2026.');
  });

  it('mas o CADASTRO continua mandando sobre o digitado', () => {
    const blocos = [
      bloco('campoAuto', { rotulo: 'Município / UF', variavel: '{{propriedade.municipio}}' }),
      bloco('texto',     { texto: 'Local: {{propriedade.municipio}}.' }),
    ];
    const [campo, linha] = aplicarEmBlocos(blocos, { 'propriedade.municipio': 'Itu / SP' },
      { 'município / uf': 'OUTRO LUGAR' });
    expect(campo.conteudo.texto).toBe('Itu / SP');
    expect(linha.conteudo.texto).toBe('Local: Itu / SP.');
  });

  it('campoAuto COM dado no cadastro ignora o digitado — o cadastro manda', () => {
    const [b] = aplicarEmBlocos(
      [bloco('campoAuto', { rotulo: 'Nome do animal', variavel: '{{animal.nome}}' })],
      ctx, { 'nome do animal': 'OUTRO' },
    );
    expect(b.conteudo.texto).toBe('Corbela');
  });
});

describe('coletarCampos — "o que falta preencher"', () => {
  const ctx = { 'animal.nome': 'Corbela', 'animal.microchip': '', 'animal.registro': 'ABCCMM 1' };

  it('coleta lacuna, campo sem cadastro e observação — e SÓ isso', () => {
    const campos = coletarCampos([
      bloco('subtitulo', { texto: 'Identificação do animal' }),
      bloco('campoAuto', { rotulo: 'Nome do animal', variavel: '{{animal.nome}}' }),   // resolvido → fora
      bloco('campoAuto', { rotulo: 'Microchip',      variavel: '{{animal.microchip}}' }), // vazio → entra
      bloco('campoAuto', { rotulo: 'Registro',       variavel: '{{animal.registro}}' }),  // resolvido → fora
      bloco('texto',     { texto: 'Tatuagem: [[Tatuagem]]' }),
      bloco('observacoes', { rotulo: 'Observações', texto: '' }),
    ], ctx);

    expect(campos.map(c => c.rotulo)).toEqual(['Microchip', 'Tatuagem', 'Observações']);
    expect(campos.map(c => c.origem)).toEqual(['CADASTRO', 'LACUNA', 'OBSERVACAO']);
    // A seção vem do subtítulo mais próximo ACIMA — é o que agrupa o formulário.
    expect(campos.every(c => c.secao === 'Identificação do animal')).toBe(true);
    expect(campos.find(c => c.rotulo === 'Observações').multilinha).toBe(true);
  });

  it('rótulo repetido é o MESMO campo, listado uma vez só', () => {
    const campos = coletarCampos([
      bloco('texto', { texto: 'Tatuagem: [[Tatuagem]]' }),
      bloco('texto', { texto: 'Confirmo a tatuagem [[Tatuagem]].' }),
    ], ctx);
    expect(campos).toHaveLength(1);
  });

  it('acha lacuna dentro de célula de tabela e de checklist', () => {
    const campos = coletarCampos([
      bloco('tabela',    { colunas: ['Item'], linhas: [['[[Lote]]']] }),
      bloco('checklist', { itens: ['Conferir [[Validade]]'] }),
    ], ctx);
    expect(campos.map(c => c.rotulo).sort()).toEqual(['Lote', 'Validade']);
  });

  it('observação COM texto no modelo não vira campo — já está escrita', () => {
    const campos = coletarCampos(
      [bloco('observacoes', { rotulo: 'Observações', texto: 'Animal hígido.' })], ctx);
    expect(campos).toHaveLength(0);
  });
});

describe('modelos do CFMV (Res. 1.321/2020)', () => {
  it('são exatamente os 12 anexos, com chave única', () => {
    expect(MODELOS).toHaveLength(12);
    expect(new Set(MODELOS.map(m => m.chave)).size).toBe(12);
  });

  it('todo modelo tem identificação do animal, do responsável e assinatura', () => {
    for (const def of MODELOS) {
      const blocos = montarBlocos(def);
      const variaveis = blocos
        .filter(b => b.tipo === 'campoAuto')
        .map(b => b.conteudo.variavel);

      // Conteúdo mínimo da norma: quem é o animal e quem é o responsável.
      expect(variaveis).toContain('{{animal.nome}}');
      expect(variaveis).toContain('{{cliente.nome}}');
      expect(variaveis).toContain('{{veterinario.nome}}');
      // Documento veterinário sem assinatura do responsável técnico não vale.
      expect(blocos.some(b => b.tipo === 'assinatura')).toBe(true);
      // A resolução exige as 2 vias — o rodapé é obrigação de forma, não decoração.
      expect(blocos.some(b => b.tipo === 'rodape' && /2 vias/i.test(b.conteudo.texto ?? ''))).toBe(true);
    }
  });

  it('atestado é assinado pelo VETERINÁRIO e termo de consentimento pelo RESPONSÁVEL', () => {
    // Inverter descaracteriza o documento: no atestado quem declara o fato técnico é
    // o profissional; no TCLE quem consente é o tutor.
    const porChave = Object.fromEntries(MODELOS.map(m => [m.chave, m]));
    expect(porChave.cfmv_01_atestado_sanitario.assinante).toBe('VETERINARIO');
    expect(porChave.cfmv_02_atestado_obito.assinante).toBe('VETERINARIO');
    expect(porChave.cfmv_11_atestado_vacinacao.assinante).toBe('VETERINARIO');
    expect(porChave.cfmv_09_tcle_eutanasia.assinante).toBe('RESPONSAVEL');
    expect(porChave.cfmv_06_tcle_cirurgico.assinante).toBe('RESPONSAVEL');
  });

  it('só o TCLE tem campo de observação DO RESPONSÁVEL', () => {
    const rotulos = (def) => montarBlocos(def)
      .filter(b => b.tipo === 'observacoes')
      .map(b => b.conteudo.rotulo);
    const porChave = Object.fromEntries(MODELOS.map(m => [m.chave, m]));

    expect(rotulos(porChave.cfmv_09_tcle_eutanasia)).toContain('Observações do(a) responsável');
    expect(rotulos(porChave.cfmv_01_atestado_sanitario)).not.toContain('Observações do(a) responsável');
  });

  it('valem para qualquer espécie — a norma é geral', () => {
    // Marcar EQUINO esconderia o atestado sanitário da clínica de bovinos.
    for (const def of MODELOS) {
      expect(def.categoria).toBeTruthy();
      expect(montarBlocos(def).length).toBeGreaterThan(10);
    }
  });

  it('nenhum modelo tem `______` sobrando — todo campo em branco é uma LACUNA', () => {
    // Underline literal é campo INVISÍVEL para o código: não entra na tela de
    // emissão e sai em branco no papel sem ninguém ser perguntado.
    for (const def of MODELOS) {
      for (const b of montarBlocos(def)) {
        expect(String(b.conteudo.texto ?? '')).not.toMatch(/_{4,}/);
      }
    }
  });

  it('Atestado de Vacinação pede exatamente o que o sistema não sabe', () => {
    // O caso-guia. Animal SEM microchip e SEM registro genealógico — o comum.
    const vac = MODELOS.find(m => m.chave === 'cfmv_11_atestado_vacinacao');
    const variaveis = {
      'animal.nome': 'Hanna', 'animal.especie': 'Equino', 'animal.sexo': 'Fêmea',
      'animal.raca': 'Brasileiro de Hipismo', 'animal.idade': '5 anos',
      'animal.pelagem': 'Castanho', 'animal.resenha': 'Castanho',
      'animal.microchip': '', 'animal.registro': '',
      'cliente.nome': 'Claudio Araujo', 'cliente.documento': '123', 'cliente.telefone': '11999',
      'veterinario.nome': 'Dra. Marina', 'veterinario.crmv': '12345/SP',
      'veterinario.clinica': 'S2Vet', 'veterinario.telefone': '1133334444',
      'propriedade.endereco': 'Rod. dos Bandeirantes', 'propriedade.municipio': 'Itu / SP',
      'vacinas.ultima': 'Influenza', 'vacinas.proximaDose': '12/11/2026',
      'sistema.dataEmissao': '26/08/2026',
    };
    const blocos  = montarBlocos(vac);
    const campos  = coletarCampos(blocos, variaveis);
    const rotulos = campos.map(c => c.rotulo);

    // O que o cadastro DESTE animal não tinha:
    expect(rotulos).toEqual(expect.arrayContaining(['Microchip']));
    // E o que JÁ está preenchido não pode ser pedido de novo:
    expect(rotulos).not.toContain('Nome do animal');
    expect(rotulos).not.toContain('Responsável');
    expect(rotulos).not.toContain('CRMV');

    // 🔴 REMODELADO em 2026-09-03 (a pedido). Tatuagem, Brinco e Registro Genealógico
    // saíram do modelo — o S2Vet não guarda nenhum dos três, e eles só produziam
    // linha em branco no papel.
    for (const fora of ['Tatuagem', 'Brinco', 'Registro Genealógico']) {
      expect(rotulos).not.toContain(fora);
    }
    // "Próxima dose prevista" saiu e "Vacinação contra (última registrada)" virou
    // "Vacinação contra" — o campo do Anexo XI.
    expect(rotulos).not.toContain('Próxima dose prevista');
    // 🔴 "Vacinação contra" NÃO é campo automático: é a DOENÇA, e a única variável
    // disponível (`vacinas.ultima`) devolve o NOME COMERCIAL com a data — escrevê-la
    // nesse rótulo é afirmação errada num documento com valor legal.
    expect(blocos.some(b => b.tipo === 'campoAuto' && /^Vacina/.test(b.conteudo.rotulo ?? ''))).toBe(false);

    // Os dados do frasco viraram um GRUPO REPETÍVEL: um atestado cobre mais de uma
    // vacina, e com campos soltos a segunda não tinha onde entrar.
    const lista = blocos.find(b => b.tipo === 'listaCampos');
    expect(lista).toBeTruthy();
    expect(lista.conteudo.colunas).toEqual([
      // "Vacinação contra" e "Observação" entraram na LINHA da vacina: com duas
      // vacinas no mesmo atestado, um campo único não diz qual é de qual.
      // A ORDEM é a do papel, três por linha (a pedido).
      'Nome comercial da vacina', 'Vacinação contra', 'Fabricante',
      // Fabricação e validade em colunas SEPARADAS (eram um campo só).
      'Número da partida', 'Data de fabricação', 'Data de validade',
      'Observação',
    ]);
    // Sai como os demais CARDS do documento, não como tabela: sete colunas numa A4
    // retrato espremem o nome comercial em tres linhas.
    expect(lista.conteudo.formato).toBe('campos');
    // É o `fonteOpcoes` que faz a coluna do nome virar seletor das vacinas da empresa.
    expect(lista.conteudo.fonteOpcoes).toBe('empresa.vacinas');
    expect(coletarListas(blocos)[0].secao).toBe('Vacinação');

    // NENHUM bloco de observação solto: a do veterinário foi removida e a outra virou
    // COLUNA da lista, para pertencer à vacina em vez de flutuar na seção.
    expect(blocos.filter(b => b.tipo === 'observacoes')).toHaveLength(0);
  });

  it('a identificação sai em DUAS COLUNAS na folha', () => {
    // Um campo por linha empurrava a assinatura para uma segunda página com a
    // primeira metade vazia. `estilo.colunas` é o que os dois renderizadores leem.
    const vac = MODELOS.find(m => m.chave === 'cfmv_11_atestado_vacinacao');
    const campos = montarBlocos(vac).filter(b => b.tipo === 'campoAuto');
    expect(campos.length).toBeGreaterThan(4);
    for (const c of campos) {
      // A seção do RESPONSÁVEL inteira sai em três por linha (a pedido): são campos
      // curtos, lidos juntos. O resto da folha continua em duas.
      // ⚠️ "Telefone" existe DUAS vezes (o do veterinário e o do responsável) — por
      // isso a conta é pela VARIÁVEL, nunca pelo rótulo.
      const doResponsavel = /^\{\{cliente\./.test(c.conteudo.variavel);
      expect(c.estilo.colunas).toBe(doResponsavel ? 3 : 2);
    }
  });

  it('o município da propriedade sai do ENDEREÇO dela, não do cadastro do cliente', () => {
    // Antes: `LocalizacaoAnimal` não tem cidade/estado, e o município caía no cadastro
    // do CLIENTE — que costuma estar vazio e, quando não está, é a cidade DELE. O
    // atestado saía com "Local e data: , 03/09/2026." ou, pior, com o município errado.
    const { municipioDoEndereco } = require('../lib/documentoVariaveis');
    // Os dois formatos que a base tem:
    expect(municipioDoEndereco('AREA RURAL, nº 2020, PEGASUS HARAS, AREA RURAL DE CAMBORIU - CAMBORIU/SC'))
      .toBe('CAMBORIU / SC');
    expect(municipioDoEndereco('Estrada dos Bandeirantes, Vargem Grande, Rio de Janeiro, RJ'))
      .toBe('Rio de Janeiro / RJ');
    // 🔴 Não reconheceu, devolve VAZIO — nunca um palpite. Município errado num
    // atestado sanitário é declaração falsa sobre a origem do animal.
    expect(municipioDoEndereco('Rua sem cidade nenhuma')).toBe('');
    expect(municipioDoEndereco('')).toBe('');
    expect(municipioDoEndereco(null)).toBe('');
  });

  it('as variáveis usadas nos modelos são todas resolvíveis', () => {
    // Um `{{campo.inexistente}}` num modelo do sistema sairia como buraco em TODA
    // clínica, e ninguém veria até alguém imprimir.
    const usadas = new Set();
    for (const def of MODELOS) {
      for (const b of montarBlocos(def)) {
        const alvo = `${b.conteudo.texto ?? ''} ${b.conteudo.variavel ?? ''}`;
        for (const m of alvo.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) usadas.add(m[1]);
      }
    }
    expect(usadas.size).toBeGreaterThan(0);
    for (const chave of usadas) {
      expect(VARIAVEIS_VALIDAS).toContain(chave);
    }
  });
});

// A categoria do modelo deixou de ser uma lista fechada em 2026-08-30: a clínica cria
// as suas na tela de emissão. Afrouxar uma validação pede teste — o que estes casos
// travam é que "livre" não vire "qualquer coisa": a coluna é VARCHAR(30) e o banco
// devolveria 500 num texto maior, e duas grafias do mesmo nome virariam duas gavetas.
describe('categoria do modelo', () => {
  const { normalizarCategoria, CATEGORIAS_PADRAO } = require('../controllers/DocumentoTemplateController');

  it('aceita categoria criada pela clínica', () => {
    expect(normalizarCategoria('Exames de compra')).toBe('Exames de compra');
  });

  it('devolve a padrão no slug canônico, venha como vier', () => {
    expect(normalizarCategoria('Laudos')).toBe('laudos');
    expect(normalizarCategoria('  RECEITUARIOS  ')).toBe('receituarios');
    for (const c of CATEGORIAS_PADRAO) expect(normalizarCategoria(c)).toBe(c);
  });

  it('colapsa espaços — a mesma categoria não pode virar dois grupos', () => {
    expect(normalizarCategoria('Exames   de  compra')).toBe('Exames de compra');
  });

  it('corta em 30 caracteres (o tamanho da coluna)', () => {
    expect(normalizarCategoria('x'.repeat(80))).toHaveLength(30);
  });

  it('vazio devolve null — string em branco não apaga a categoria do modelo', () => {
    expect(normalizarCategoria('   ')).toBeNull();
    expect(normalizarCategoria('')).toBeNull();
    expect(normalizarCategoria(null)).toBeNull();
    expect(normalizarCategoria(undefined)).toBeNull();
  });
});

// ─── Conversão do documento ENVIADO em modelo ────────────────────────────────
// O que estes casos travam é a rede de segurança que vem DEPOIS do modelo de
// linguagem: uma chave de variável alucinada não pode sumir calada do papel, e o
// título do papel original não pode ser impresso duas vezes.
describe('conversão do documento enviado', () => {
  const {
    rotuloDaChave, variaveisDesconhecidas, umTituloSo,
  } = require('../services/documentoConversaoService');

  it('deriva um rótulo legível da chave inventada', () => {
    expect(rotuloDaChave('propriedade.inscricaoEstadual')).toBe('Inscricao Estadual');
    expect(rotuloDaChave('animal.tatuagem')).toBe('Tatuagem');
    expect(rotuloDaChave('numero_da_partida')).toBe('Numero da partida');
  });

  it('preserva a variável que existe de verdade', () => {
    expect(variaveisDesconhecidas('Paciente {{animal.nome}}, de {{cliente.nome}}.'))
      .toBe('Paciente {{animal.nome}}, de {{cliente.nome}}.');
  });

  it('🔴 variável ALUCINADA vira LACUNA — nunca some do papel', () => {
    // A regressão que este teste impede: a chave inventada resolve para vazio na
    // emissão (regra "nada de inventar valor") e o campo desaparece da folha sem que
    // ninguém seja avisado. Virando lacuna, ele aparece no formulário da emissão.
    expect(variaveisDesconhecidas('IE: {{propriedade.inscricaoRural}}'))
      .toBe('IE: [[Inscricao Rural]]');
  });

  it('a lacuna criada a partir da chave alucinada É COLETADA como campo', () => {
    // O elo que fecha a regra: não basta virar `[[...]]`, tem de aparecer na tela de
    // emissão — quem decide isso é `coletarCampos`.
    const texto = variaveisDesconhecidas('Registro no órgão: {{propriedade.registroIbama}}');
    const campos = coletarCampos([bloco('texto', { texto })], {});
    expect(campos.map(c => c.rotulo)).toEqual(['Registro Ibama']);
    expect(campos[0].origem).toBe('LACUNA');
  });

  it('mantém só o PRIMEIRO bloco de título', () => {
    // O cabeçalho da folha absorve o primeiro `titulo`; um segundo é quase sempre o
    // cabeçalho do papel original, e sairia impresso logo abaixo do cabeçalho novo.
    const saida = umTituloSo([
      { tipo: 'titulo', conteudo: { texto: 'RECEITA' } },
      { tipo: 'texto',  conteudo: { texto: 'Uso oral' } },
      { tipo: 'titulo', conteudo: { texto: 'RECEITA' } },
    ]);
    expect(saida.map(b => b.tipo)).toEqual(['titulo', 'texto']);
  });
});

// ─── O que não foi preenchido não vai para o papel ───────────────────────────
// A regra é do DOCUMENTO EMITIDO (2026-09-03, a pedido) e nunca do modelo: no modelo
// o campo em branco é o espaço a preencher; no papel entregue ele é um buraco. O que
// estes casos travam é o LIMITE dela — descartar demais apagaria a declaração que dá
// validade ao documento.
describe('removerVazios (snapshot do emitido)', () => {
  const { removerVazios } = require('../lib/documentoVariaveis');
  const b = (tipo, conteudo) => ({ id: `b${tipo}`, tipo, conteudo, estilo: {}, visivel: true });

  it('descarta campo automático sem valor e mantém o preenchido', () => {
    const saida = removerVazios([
      b('subtitulo', { texto: 'Identificação do animal' }),
      b('campoAuto', { rotulo: 'Nome do animal', texto: 'Super', variavel: '{{animal.nome}}' }),
      b('campoAuto', { rotulo: 'Microchip', texto: '', variavel: '{{animal.microchip}}' }),
    ]);
    expect(saida.map(x => x.conteudo.rotulo ?? x.conteudo.texto))
      .toEqual(['Identificação do animal', 'Nome do animal']);
  });

  it('🔴 NÃO descarta texto normativo — só o que sobrou como "Rótulo:"', () => {
    // O descarte generoso apagaria a declaração que dá validade ao atestado.
    const declaracao = 'Atesto para os devidos fins que o animal foi vacinado por mim nesta data.';
    const saida = removerVazios([
      b('texto', { texto: declaracao }),
      b('texto', { texto: 'Tatuagem: ' }),
      b('texto', { texto: 'Local e data: Itu / SP, 03/09/2026.' }),
    ]);
    expect(saida.map(x => x.conteudo.texto)).toEqual([declaracao, 'Local e data: Itu / SP, 03/09/2026.']);
  });

  it('descarta observação em branco e tabela sem nenhuma linha', () => {
    const saida = removerVazios([
      b('observacoes', { rotulo: 'Observações', texto: '' }),
      b('observacoes', { rotulo: 'Observações', texto: 'Animal em jejum.' }),
      b('tabela', { colunas: ['Vacina'], linhas: [] }),
      b('tabela', { colunas: ['Vacina'], linhas: [['Leptovacin']] }),
    ]);
    expect(saida).toHaveLength(2);
    expect(saida[0].conteudo.texto).toBe('Animal em jejum.');
    expect(saida[1].conteudo.linhas).toEqual([['Leptovacin']]);
  });

  it('subtítulo de seção que ficou vazia some junto', () => {
    // Senão o papel anuncia uma seção e não mostra nada embaixo dela.
    const saida = removerVazios([
      b('subtitulo', { texto: 'Vacinação' }),
      b('campoAuto', { rotulo: 'Vacinação contra', texto: '' }),
      b('subtitulo', { texto: 'Responsável pelo animal' }),
      b('campoAuto', { rotulo: 'Responsável', texto: 'Patricia' }),
      b('rodape',    { texto: 'Res. CFMV 1.321/2020' }),
    ]);
    expect(saida.map(x => x.conteudo.texto ?? x.conteudo.rotulo))
      .toEqual(['Responsável pelo animal', 'Patricia', 'Res. CFMV 1.321/2020']);
  });

  it('assinatura e linha continuam no papel mesmo sem texto', () => {
    // A linha de assinatura EM BRANCO é o espaço de assinar — some ela e o documento
    // deixa de poder ser assinado.
    const saida = removerVazios([
      b('linha', {}),
      b('assinatura', { rotulo: 'Médico(a) Veterinário(a)', mostrarCrmv: true }),
    ]);
    expect(saida).toHaveLength(2);
  });
});

// ─── Listas repetíveis ───────────────────────────────────────────────────────
// O que estes casos travam: as colunas de uma fonte clínica são CANÔNICAS (é o que
// faz o preenchimento automático alinhar com o dado do paciente), e o bloco emitido
// vira uma tabela LITERAL — sem `fonteDados` sobrando, senão a reimpressão de daqui a
// dois anos voltaria ao banco e traria a prescrição de hoje.
describe('listas repetíveis do documento', () => {
  const {
    aplicarListasEmBlocos, colunasDaLista, rotuloDaLista,
  } = require('../lib/documentoListas');

  const listaMed = { id: 'l1', tipo: 'medicamentos', visivel: true, estilo: {},
                     conteudo: { fonteDados: 'prescricao.medicamentos' } };

  it('🔴 as colunas da FONTE vencem as declaradas no modelo', () => {
    // A regressão que isto impede: o modelo pedir ["Remédio", "Qtd"], a consulta
    // devolver cinco campos por item, e a dose cair na coluna da quantidade.
    const b = { ...listaMed, conteudo: { fonteDados: 'prescricao.medicamentos', colunas: ['Remédio', 'Qtd'] } };
    expect(colunasDaLista(b)).toEqual(['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração']);
  });

  it('lista SEM fonte usa as colunas do modelo', () => {
    const b = { id: 'l2', tipo: 'listaCampos', visivel: true, estilo: {},
                conteudo: { rotulo: 'Dados do comprador', colunas: ['Nome', 'RG'] } };
    expect(colunasDaLista(b)).toEqual(['Nome', 'RG']);
    expect(rotuloDaLista(b)).toBe('Dados do comprador');
  });

  it('coleta as listas com a seção em que caem e sem repetir o mesmo grupo', () => {
    const blocos = [
      bloco('subtitulo', { texto: 'Prescrição' }),
      listaMed,
      { ...listaMed, id: 'l1b' },   // mesmo rótulo = MESMO grupo
    ];
    const listas = coletarListas(blocos);
    expect(listas).toHaveLength(1);
    expect(listas[0]).toMatchObject({ chave: 'medicamentos', secao: 'Prescrição', fonteDados: 'prescricao.medicamentos' });
  });

  it('🔴 aplicar vira TABELA literal, sem fonteDados e sem linha vazia', () => {
    const saida = aplicarListasEmBlocos([listaMed], {
      medicamentos: [
        ['Gabapentina', '150 mg', 'Oral', '12/12h', '30 dias'],
        ['', '', '', '', ''],   // linha em branco não vai para o papel
      ],
    });
    expect(saida[0].tipo).toBe('tabela');
    expect(saida[0].conteudo.fonteDados).toBeUndefined();
    expect(saida[0].conteudo.linhas).toEqual([['Gabapentina', '150 mg', 'Oral', '12/12h', '30 dias']]);
  });

  it('variável dentro da célula digitada é resolvida como o resto da folha', () => {
    // As listas entram ANTES da resolução de variáveis, e é isso que faz
    // "aplicar em {{animal.nome}}" digitado numa célula sair com o nome do paciente.
    const saida = aplicarEmBlocos([listaMed], { 'animal.nome': 'Corbela' }, null, {
      medicamentos: [['Gabapentina', '150 mg', 'Oral', 'aplicar em {{animal.nome}}', '']],
    });
    expect(saida[0].conteudo.linhas[0][3]).toBe('aplicar em Corbela');
  });
});

// ─── Assinatura: quem assina não é sempre o veterinário ──────────────────────
//
// 🔴 O renderizador carimbava a assinatura ESCANEADA do veterinário em TODA linha de
// assinatura, qualquer que fosse o papel escrito embaixo: no receituário de controle
// especial o FARMACÊUTICO aparecia assinando com a assinatura do vet, e no termo de
// consentimento o tutor "consentia" com o nome dele. Documento falso, e nada acusava.
// `conteudo.assinante` é o que separa os dois casos — e o que estes testes travam.
describe('assinatura — de quem é a linha', () => {
  it('🔴 os TCLEs marcam a assinatura como do RESPONSÁVEL, não do veterinário', () => {
    for (const def of MODELOS) {
      const ass = montarBlocos(def).filter(b => b.tipo === 'assinatura');
      expect(ass.length).toBeGreaterThan(0);
      for (const b of ass) {
        // A regra é uma só nos dois sentidos: quem assina é o vet ⇔ o CRMV sai no
        // papel. Divergir aqui reabre o caminho para a assinatura de um valer pelo
        // outro, que é a compatibilidade de que o front depende.
        const doVet = b.conteudo.assinante === 'VETERINARIO';
        expect(doVet).toBe(!!b.conteudo.mostrarCrmv);
      }
    }
    const tcle = MODELOS.find(m => m.assinante === 'RESPONSAVEL');
    const ass  = montarBlocos(tcle).filter(b => b.tipo === 'assinatura');
    expect(ass.every(b => b.conteudo.assinante === 'OUTRO')).toBe(true);
  });

  it('normalizarBlocos PRESERVA o assinante e descarta valor inventado', () => {
    // Fora do whitelist, `assinante` seria apagado em silêncio e a linha do
    // farmacêutico voltaria a sair assinada pelo veterinário.
    const saida = normalizarBlocos([
      { tipo: 'assinatura', conteudo: { rotulo: 'Farmacêutico', assinante: 'OUTRO' } },
      { tipo: 'assinatura', conteudo: { rotulo: 'Comprador',    assinante: 'QUALQUER' } },
    ]);
    expect(saida[0].conteudo.assinante).toBe('OUTRO');
    expect(saida[1].conteudo.assinante).toBeUndefined();
  });
});

// ─── Receituário de controle especial ────────────────────────────────────────
describe('fonte prescricao.controlados', () => {
  const { FONTES, colunasDaLista, rotuloDaLista } = require('../lib/documentoListas');

  it('🔴 tem as MESMAS colunas de prescricao.medicamentos', () => {
    // É a mesma linha de receita, só com outro recorte. Colunas diferentes fariam a
    // dose cair na coluna errada ao trocar a fonte de um modelo já montado.
    expect(FONTES['prescricao.controlados'].colunas)
      .toEqual(FONTES['prescricao.medicamentos'].colunas);
  });

  it('o bloco de medicamentos aceita a fonte e ganha as colunas canônicas', () => {
    const b = { id: 'l9', tipo: 'medicamentos', visivel: true, estilo: {},
                conteudo: { fonteDados: 'prescricao.controlados', colunas: ['Remédio'] } };
    expect(colunasDaLista(b)).toEqual(['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração']);
    expect(rotuloDaLista(b)).toBe('Medicamentos sujeitos a controle especial');
  });
});
