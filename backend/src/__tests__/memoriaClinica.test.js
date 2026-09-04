// backend/src/__tests__/memoriaClinica.test.js
//
// Trava as duas regras da Memória Clínica que quebram EM SILÊNCIO — nenhuma delas
// derruba requisição, as duas só entregam um painel que parece certo e não é:
//
//   1. O RESUMO DAS ATIVIDADES tem teto de 20 linhas. Sem o corte no serviço, um
//      modelo prolixo devolve a lista inteira de eventos de volta — que é
//      exatamente o que este resumo veio substituir (antes do prompt v2 o campo
//      era montado como UMA LINHA POR TÓPICO: 80 eventos, 80 linhas).
//   2. A `ref` do tópico de EXAME é `exame-<id>`, mas o Histórico grava
//      `exame_lab-<id>` / `exame_img-<id>` / `exame_bio-<id>` / `exame_compra-<id>`
//      (EXAM_ORIGEM). Sem o apelido canônico em AnimalDetail, NENHUM tópico de
//      exame entra em `refsAbriveis` e ele vira texto morto: clicar não abre o
//      laudo, e nada acusa — o tópico continua lá, só não responde.

// `lib/prisma` e `ai` são TypeScript e o babel-jest não os transpila — mesmo mock
// dos demais testes de lib. Nada aqui toca o banco nem chama o modelo.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../ai', () => ({ callAI: jest.fn(), MODULOS_IA: { MEMORIA_CLINICA: 'MEMORIA_CLINICA' } }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const { normalizarResumo, MAX_LINHAS_RESUMO, MAX_LINHAS_MUDANCAS, VERSAO_ATUAL,
        descreverItemPrescrito, resolverAmarras, semAmarras } =
  require('../services/resumoAtendimentoService');

describe('Resumo das atividades — normalização', () => {
  test('devolve as linhas na ordem recebida', () => {
    expect(normalizarResumo(['Primeira.', 'Segunda.'])).toEqual(['Primeira.', 'Segunda.']);
  });

  test('corta em 20 linhas — o teto não pode ficar só no prompt', () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => `Linha ${i + 1}.`);
    const saida = normalizarResumo(cinquenta);
    expect(saida).toHaveLength(MAX_LINHAS_RESUMO);
    expect(MAX_LINHAS_RESUMO).toBe(20);
    expect(saida[0]).toBe('Linha 1.');
  });

  test('aceita texto corrido — modelo que ignora o array não perde o resumo', () => {
    expect(normalizarResumo('Uma.\nOutra.\n\nTerceira.')).toEqual(['Uma.', 'Outra.', 'Terceira.']);
  });

  test('remove bullet e numeração sem descartar a linha', () => {
    expect(normalizarResumo(['- Perdeu peso.', '* Febre.', '• Vacinou.', '3) Exame pedido.']))
      .toEqual(['Perdeu peso.', 'Febre.', 'Vacinou.', 'Exame pedido.']);
  });

  test('linha vazia ou só pontuação de lista não entra', () => {
    expect(normalizarResumo(['', '   ', '-', 'Vale.'])).toEqual(['Vale.']);
  });

  test('sem resumo do LLM devolve lista vazia (o serviço cai no texto por tópico)', () => {
    expect(normalizarResumo(undefined)).toEqual([]);
    expect(normalizarResumo(null)).toEqual([]);
    expect(normalizarResumo([])).toEqual([]);
  });

  test('versão do prompt é a v4 — é o bump que força a reconsolidação do resumo', () => {
    expect(VERSAO_ATUAL).toBe('memoria_clinica@v4');
  });

  test('o "o que mudou" é um aviso, não um segundo resumo', () => {
    expect(MAX_LINHAS_MUDANCAS).toBe(6);
  });
});

describe('Prescrição: o resumo precisa saber QUANTO foi aplicado', () => {
  // O relato de 02/09 foi a IA dizendo "foram executadas as prescrições" de um curso
  // que ninguém aplicou. Ela só recebia o nome do medicamento e o status do grupo —
  // não havia como ela saber. Agora o número vai afirmado no evento.
  test('curso não aplicado sai como 0% executado', () => {
    const texto = descreverItemPrescrito({
      medicamento: '17 Beta', dose: 'frasco-ampola',
      frequencia: '1x ao dia', duracaoDias: 6, dosesExecutadas: 0,
    });
    expect(texto).toMatch(/0 de 6 doses aplicadas/);
    expect(texto).toMatch(/0% executado/);
  });

  test('curso pela metade sai com o percentual real', () => {
    const texto = descreverItemPrescrito({
      medicamento: 'A-D-E Injetável', dose: 'frasco 250 mL',
      frequencia: '1x ao dia', duracaoDias: 4, dosesExecutadas: 2,
    });
    expect(texto).toMatch(/2 de 4 doses aplicadas \(50% executado\)/);
  });

  test('o nome e a dose do item aparecem — é o que o vet procura na linha', () => {
    const texto = descreverItemPrescrito({
      medicamento: 'A-D-E Injetável', dose: 'frasco 250 mL',
      frequencia: '1x ao dia', duracaoDias: 1, dosesExecutadas: 0,
    });
    expect(texto).toContain('A-D-E Injetável frasco 250 mL');
  });
});

describe('Prompt memoria_clinica@v4', () => {
  const { buildPrompt } = require('../ai/prompts');
  const { prompt } = buildPrompt('memoria_clinica', {
    topicosAtuais:  [],
    eventos:        [{ id: 't1', ref: 'evolucao-1', atendimento: 9 }],
    atendimentos:   [{ id: 9, data: '21/08/2026' }],
    resumoAnterior: ['linha antiga'],
    animalNome:     'Corbela',
  });

  test('pede o resumo em 10 a 20 linhas', () => {
    expect(prompt).toMatch(/RESUMO DAS ATIVIDADES/);
    expect(prompt).toMatch(/10 a 20 linhas/);
  });

  test('exige que todo highlight apareça no resumo', () => {
    expect(prompt).toMatch(/nenhum pode ficar de fora/i);
  });

  test('manda AGRUPAR pelo atendimento — é o que liga a consulta ao exame que ela gerou', () => {
    expect(prompt).toMatch(/COMO OS EVENTOS SE LIGAM/);
    expect(prompt).toMatch(/Agrupe pelo ATENDIMENTO/);
    expect(prompt).toMatch(/data que rege a narrativa é a DO ATENDIMENTO/);
  });

  test('proíbe chamar de executado o que não tem prova de execução', () => {
    expect(prompt).toMatch(/N de M doses aplicadas/);
    expect(prompt).toMatch(/Chamar de executado o que está em 0%/);
  });

  test('pede narrativa humanizada, não telegrama de banco de dados', () => {
    expect(prompt).toMatch(/CONTANDO A HISTÓRIA A UM COLEGA/);
    expect(prompt).toMatch(/sem jargão de banco/);
  });

  test('pede a comparação antes × depois', () => {
    expect(prompt).toMatch(/MUDANÇAS DESDE O RESUMO ANTERIOR/);
    expect(prompt).toMatch(/Diga o antes e o depois na mesma linha/);
    expect(prompt).toMatch(/"mudancas":\s*\[/);
  });

  test('recebe as datas dos atendimentos e o resumo anterior', () => {
    expect(prompt).toMatch(/# ATENDIMENTOS/);
    expect(prompt).toContain('21/08/2026');
    expect(prompt).toMatch(/# RESUMO ANTERIOR/);
    expect(prompt).toContain('linha antiga');
  });

  test('declara "resumo" na SAÍDA — sem isso o modelo devolve só tópicos', () => {
    expect(prompt).toMatch(/"resumo":\s*\[/);
  });

  test('mantém as proibições clínicas — descrever, nunca decidir', () => {
    expect(prompt).toMatch(/Não sugira conduta/);
    expect(prompt).toMatch(/Não emita diagnóstico/);
    expect(prompt).toMatch(/não decida/);
  });
});

// ── Gate estrutural: a ref de EXAME tem DUAS grafias ────────────────────────────
// O modo de quebrar isto é mexer numa das duas pontas sem olhar a outra, e o
// sintoma é mudo. Por isso o teste lê o CÓDIGO das três, como o gate de
// pacienteInativo.test.js faz com os controllers.
describe('Memória Clínica → Histórico: a ref do tópico precisa casar', () => {
  const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

  const servico   = fs.readFileSync(path.join(__dirname, '..', 'services', 'resumoAtendimentoService.js'), 'utf8');
  const historico = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'HistoricoController.js'), 'utf8');
  const detalhe   = leia(path.join('frontend', 'src', 'pages', 'AnimalDetail.tsx'));

  test('a Memória grava a ref de exame como `exame-<id>`', () => {
    expect(servico).toMatch(/ref:\s*`exame-\$\{x\.id\}`/);
  });

  test('o Histórico grava o id do exame por TIPO (exame_lab, exame_img…)', () => {
    expect(historico).toMatch(/id:\s*`\$\{origemEx\.toLowerCase\(\)\}-\$\{x\.id\}`/);
  });

  test('AnimalDetail registra o apelido canônico `exame-<id>` — senão o tópico de exame não abre', () => {
    expect(detalhe).toMatch(/registrar\(`exame-\$\{numId\}`, ev\)/);
    expect(detalhe).toMatch(/origem\.startsWith\('EXAME'\)/);
  });

  test('as demais origens usam a MESMA grafia nos dois lados', () => {
    for (const origem of ['evolucao', 'vacina', 'encaminhamento', 'documento']) {
      // Regex montada por concatenacao: dentro de template literal o \\s vira s.
      expect(servico).toMatch(new RegExp('ref:\\s*`' + origem + '-'));
      expect(historico).toMatch(new RegExp('id:\\s*`' + origem + '-'));
    }
  });
});

// ── Gate estrutural: renovar quando o ESTADO muda, não só quando entra evento ──
// A contagem de eventos não enxerga o exame que recebeu resultado nem a prescrição
// que foi de 0 para 3 doses — os dois continuam o mesmo registro, com a mesma data.
// Sem a assinatura, a memória só se renovava ao NASCER um registro, e a comparação
// antes × depois nunca chegaria a dizer "a pendência foi resolvida".
describe('Assinatura de estado — o que dispara a renovação', () => {
  const servico = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'resumoAtendimentoService.js'), 'utf8');

  test('a assinatura é calculada sobre o estado de cada evento', () => {
    expect(servico).toMatch(/function assinaturaDoEstado\(eventos\)/);
    expect(servico).toMatch(/\$\{e\.ref\}=\$\{e\.estado \?\? ''\}/);
  });

  test('o exame entra na assinatura COM_RESULTADO / SEM_RESULTADO', () => {
    expect(servico).toMatch(/COM_RESULTADO/);
    expect(servico).toMatch(/SEM_RESULTADO/);
  });

  test('a prescrição entra na assinatura com a soma das doses executadas', () => {
    expect(servico).toMatch(/reduce\(\(n, i\) => n \+ Number\(i\.dosesExecutadas \?\? 0\), 0\)/);
  });

  test('estado alterado força reconstrução COMPLETA, nunca append', () => {
    // No append os tópicos antigos não são reenviados: o modelo continuaria dizendo
    // "sem resultado" de um exame que já tem laudo.
    expect(servico).toMatch(/const fazAppend = Boolean\([^)]*!estadoMudou/);
  });

  test('assinatura null (consolidado antes dela existir) NÃO conta como desatualizado', () => {
    // Senão toda memória já gravada na base dispararia uma chamada de IA na
    // primeira abertura de tela.
    expect(servico).toMatch(/salvos\.assinatura !== null && salvos\.assinatura !== coleta\.assinatura/);
  });

  test('todo evento com ciclo de vida carrega `atendimento` — o vínculo com a consulta', () => {
    for (const origem of ['VACINA', 'EXAME', 'ENCAMINHAMENTO', 'PRESCRICAO', 'DOCUMENTO']) {
      const bloco = servico.slice(servico.indexOf(`origem: '${origem}'`));
      expect(bloco.slice(0, 200)).toMatch(/atendimento:/);
    }
  });

  test('o vínculo é PERSISTIDO no tópico — senão o agrupamento só valeria na 1ª vez', () => {
    expect(servico).toMatch(/atendimento: evento\.atendimento \?\? null/);
  });
});

// ── Âncoras do resumo ──────────────────────────────────────────────────────────
// O modelo marca o trecho que NOMEIA o registro com [[id|texto]]; o serviço troca o
// id do tópico pela `ref`, que é o que a tela sabe abrir. Id inventado tem de DERRUBAR
// a marcação, nunca virar link: link morto num resumo clínico é pior que texto puro.
describe('Âncoras do resumo — [[id|texto]] → [[ref|texto]]', () => {
  const refs = new Map([['t1', 'evolucao-31'], ['t4', 'prescricao-2']]);

  test('troca o id do tópico pela ref do registro', () => {
    expect(resolverAmarras('No [[t1|atendimento de 09/08/2026]] houve avaliação.', refs))
      .toBe('No [[evolucao-31|atendimento de 09/08/2026]] houve avaliação.');
  });

  test('resolve mais de uma âncora na mesma linha', () => {
    const saida = resolverAmarras(
      'A [[t4|prescrição nº 002]] veio do [[t1|atendimento de 09/08/2026]].', refs);
    expect(saida).toContain('[[prescricao-2|prescrição nº 002]]');
    expect(saida).toContain('[[evolucao-31|atendimento de 09/08/2026]]');
  });

  test('id inventado vira TEXTO PURO, nunca link morto', () => {
    expect(resolverAmarras('No [[t99|atendimento de 01/01/2026]] houve algo.', refs))
      .toBe('No atendimento de 01/01/2026 houve algo.');
  });

  test('não toca parênteses comuns — "(0% executado)" não é referência', () => {
    const linha = 'A [[t4|prescrição nº 002]] registra 17 Beta (0% executado).';
    expect(resolverAmarras(linha, refs)).toContain('(0% executado)');
  });

  test('linha sem marcação nenhuma passa intacta', () => {
    const linha = 'Vacina Encefalogen aplicada em 16/08/2026.';
    expect(resolverAmarras(linha, refs)).toBe(linha);
  });

  test('semAmarras devolve o texto legível, para busca e impressão', () => {
    expect(semAmarras('A [[prescricao-2|prescrição nº 002]] registra 17 Beta.'))
      .toBe('A prescrição nº 002 registra 17 Beta.');
  });

  test('o corte por linha cabe a marcação — 400, não 300', () => {
    // [[evolucao-31|…]] gasta ~18 caracteres que não aparecem na tela; cortar em 300
    // deixaria colchete cru no fim da frase.
    expect(normalizarResumo(['x'.repeat(500)])[0]).toHaveLength(400);
  });
});

describe('Prompt v4 — instrução de marcação', () => {
  const { buildPrompt } = require('../ai/prompts');
  const { prompt } = buildPrompt('memoria_clinica', {
    topicosAtuais: [], eventos: [{ id: 't1', ref: 'evolucao-1' }],
    atendimentos: [], resumoAnterior: [], animalNome: 'Corbela',
  });

  test('manda marcar a referência com [[id|texto]]', () => {
    expect(prompt).toMatch(/MARQUE AS REFERÊNCIAS/);
    expect(prompt).toMatch(/\[\[id\|texto\]\]/);
  });

  test('proíbe marcar a frase inteira — só o nome do registro', () => {
    expect(prompt).toMatch(/Marque apenas o NOME do registro, nunca a frase inteira/);
  });

  test('proíbe o modelo escrever os parênteses em volta da marcação', () => {
    // A tela também não os desenha (decisão de 03/09): o link é a cor. Parêntese ali
    // competiria com o dos números — "(0% executado)" é texto de verdade.
    expect(prompt).toMatch(/NÃO escreva parênteses em volta da marcação/);
  });

  test('manda escrever do MAIS RECENTE para o mais antigo', () => {
    expect(prompt).toMatch(/ORDEM: DO MAIS RECENTE PARA O MAIS ANTIGO/);
    expect(prompt).toMatch(/A primeira linha é a do atendimento mais\s+novo/);
  });

  test('os exemplos do prompt demonstram a ordem decrescente', () => {
    // Exemplo que contradiz a regra vale mais que a regra: o de 21/08 tem de vir
    // ANTES do de 09/08 no texto do prompt.
    const iRecente = prompt.indexOf('atendimento de 21/08/2026');
    const iAntigo  = prompt.indexOf('atendimento de 09/08/2026]] foi realizada');
    expect(iRecente).toBeGreaterThan(-1);
    expect(iAntigo).toBeGreaterThan(iRecente);
  });

  test('exige id existente — é o que evita a âncora alucinada', () => {
    expect(prompt).toMatch(/Use SOMENTE ids que existem/);
  });
});
