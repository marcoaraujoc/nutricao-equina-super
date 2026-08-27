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

const { aplicarEmTexto, aplicarEmBlocos, coletarCampos, chaveDaLacuna, idadeDe, resenhaDe } = require('../lib/documentoVariaveis');
const { normalizarBlocos, VARIAVEIS_VALIDAS } = require('../services/documentoLLMService');
const { MODELOS, montarBlocos } = require('../seeds/006_documentos_cfmv.seed');

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
    const campos = coletarCampos(montarBlocos(vac), variaveis);
    const rotulos = campos.map(c => c.rotulo);

    // O que o formulário oficial tem em branco:
    expect(rotulos).toEqual(expect.arrayContaining([
      'Tatuagem', 'Brinco',
      'Nome comercial da vacina', 'Número da partida', 'Fabricante',
    ]));
    // O que o cadastro DESTE animal não tinha:
    expect(rotulos).toEqual(expect.arrayContaining(['Microchip', 'Registro Genealógico']));
    // E o que JÁ está preenchido não pode ser pedido de novo:
    expect(rotulos).not.toContain('Nome do animal');
    expect(rotulos).not.toContain('Responsável');
    expect(rotulos).not.toContain('CRMV');
    // Os campos da vacina ficam agrupados na seção da folha:
    expect(campos.find(c => c.rotulo === 'Número da partida').secao).toBe('Vacinação');
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
