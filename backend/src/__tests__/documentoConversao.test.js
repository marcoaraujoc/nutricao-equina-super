'use strict';

/**
 * CONVERSÃO `.doc` → `.docx` (visualizador de documentos).
 *
 * Duas coisas aqui quebram em silêncio e as duas custam caro:
 *
 * 1. `ehDocLegado` errado nos dois sentidos. Deixar passar um `.docx` como se fosse
 *    legado manda o arquivo para o LibreOffice sem necessidade (30s de timeout por
 *    laudo, no meio do upload); não reconhecer um `.doc` de verdade devolve o usuário
 *    ao problema original — anexo que não pré-visualiza e não é lido pela IA.
 *
 * 2. 🔴 A DEGRADAÇÃO GRACIOSA. LibreOffice é binário de SISTEMA: em máquina de
 *    desenvolvimento ou em imagem enxuta ele simplesmente não existe. Se
 *    `normalizarDocLegado` propagar a falha, um resultado de exame com laudo `.doc`
 *    deixa de ser salvo — perda de trabalho clínico por causa de um conversor de
 *    formato. Este teste roda JUSTAMENTE no ambiente sem LibreOffice (o `execFile`
 *    é mockado para falhar), que é o caso que a CI e a máquina do dev exercitam.
 *
 * O adapter é isolado por mock de `child_process`: nada aqui invoca `soffice` de
 * verdade, então o teste vale igual com ou sem LibreOffice instalado.
 */

jest.mock('child_process', () => ({ execFile: jest.fn() }));

const fs = require('fs');

// ⚠️ `execFile` é relido A CADA teste, nunca guardado no topo do arquivo. Cada caso
// precisa de `jest.resetModules()` para zerar o estado interno da lib (ela lembra por
// 5 min que "LibreOffice não existe aqui", e sem o reset o primeiro teste de ENOENT
// deixaria todos os seguintes achando que o conversor está indisponível). Só que o
// reset recria também o mock de `child_process`: uma referência capturada antes dele
// configura um `jest.fn()` ÓRFÃO, a lib chama outro, o callback nunca vem e o teste
// morre por timeout — foi exatamente o que aconteceu na primeira versão deste arquivo.
let execFile;

/** Recarrega a lib com o mock ZERADO e devolve as duas pontas já sincronizadas. */
function carregarLib() {
  jest.resetModules();
  execFile = require('child_process').execFile;
  execFile.mockReset();
  return require('../lib/documentoConversao');
}

/** Faz o `execFile` (usado via `promisify`) falhar como o Node falha quando o binário
 *  não existe no PATH. */
function semLibreOffice() {
  execFile.mockImplementation((_bin, _args, _opts, cb) => {
    const err = new Error('spawn soffice ENOENT');
    err.code = 'ENOENT';
    cb(err);
  });
}

/** Conversão que "funciona": escreve o .docx esperado e retorna sucesso. */
function comLibreOffice() {
  execFile.mockImplementation((_bin, args, _opts, cb) => {
    const entrada = args[args.length - 1];
    const saida   = entrada.replace(/\.doc$/, '.docx');
    fs.writeFileSync(saida, Buffer.from('PK-docx-convertido'));
    cb(null, '', '');
  });
}

const arquivoDoc = () => ({
  originalname: 'Laudo Hemograma.doc',
  mimetype:     'application/msword',
  buffer:       Buffer.from('conteudo binario do word 97'),
  size:         27,
});

describe('ehDocLegado — o que vai (e o que NÃO vai) para o conversor', () => {
  const { ehDocLegado, MIME_DOCX } = carregarLib();

  it('reconhece .doc por MIME', () => {
    expect(ehDocLegado({ originalname: 'laudo.doc', mimetype: 'application/msword' })).toBe(true);
  });

  it('reconhece .doc pela EXTENSÃO quando o navegador manda octet-stream', () => {
    // Navegador antigo (e alguns celulares) não sabem o MIME do .doc — sem esta perna
    // o arquivo passava direto e voltava a não ter pré-visualização.
    expect(ehDocLegado({ originalname: 'LAUDO.DOC', mimetype: 'application/octet-stream' })).toBe(true);
  });

  it('NUNCA trata .docx como legado — nem se o MIME vier errado', () => {
    // `.doc` é sufixo de `.docx`: um teste ingênuo por extensão mandaria todo docx
    // para o LibreOffice, pagando o timeout de conversão em cada upload.
    expect(ehDocLegado({ originalname: 'laudo.docx', mimetype: MIME_DOCX })).toBe(false);
    expect(ehDocLegado({ originalname: 'laudo.docx', mimetype: 'application/msword' })).toBe(false);
  });

  it('ignora PDF, imagem e ausência de arquivo', () => {
    expect(ehDocLegado({ originalname: 'laudo.pdf', mimetype: 'application/pdf' })).toBe(false);
    expect(ehDocLegado({ originalname: 'foto.jpg',  mimetype: 'image/jpeg' })).toBe(false);
    expect(ehDocLegado(null)).toBe(false);
    expect(ehDocLegado(undefined)).toBe(false);
  });
});

describe('normalizarDocLegado — degradação graciosa sem LibreOffice', () => {
  it('🔴 devolve o arquivo ORIGINAL quando o binário não existe — o upload não pode cair', async () => {
    const { normalizarDocLegado } = carregarLib();
    semLibreOffice();
    const original = arquivoDoc();

    const saida = await normalizarDocLegado(original);

    expect(saida).toBe(original);                       // o MESMO objeto, intocado
    expect(saida.mimetype).toBe('application/msword');
    expect(saida.originalname).toBe('Laudo Hemograma.doc');
  });

  it('não lança nem quando a conversão falha por outro motivo', async () => {
    const { normalizarDocLegado } = carregarLib();
    execFile.mockImplementation((_b, _a, _o, cb) => cb(new Error('documento corrompido')));
    await expect(normalizarDocLegado(arquivoDoc())).resolves.toBeDefined();
  });

  it('deixa passar intacto o que não é .doc, sem invocar o conversor', async () => {
    const { normalizarDocLegado } = carregarLib();
    semLibreOffice();
    const pdf = { originalname: 'laudo.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF') };

    expect(await normalizarDocLegado(pdf)).toBe(pdf);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('normalizarDocLegado — conversão bem-sucedida', () => {
  it('devolve um objeto NOVO já como .docx, sem mutar o do multer', async () => {
    const { normalizarDocLegado, MIME_DOCX } = carregarLib();
    comLibreOffice();
    const original = arquivoDoc();

    const saida = await normalizarDocLegado(original);

    expect(saida).not.toBe(original);
    expect(original.mimetype).toBe('application/msword');   // o de entrada segue intacto
    expect(saida.mimetype).toBe(MIME_DOCX);
    expect(saida.originalname).toBe('Laudo Hemograma.docx');
    expect(saida.convertidoDeDoc).toBe(true);
    expect(saida.size).toBe(saida.buffer.length);
  });

  it('isola cada conversão num perfil próprio do LibreOffice', async () => {
    // Sem `-env:UserInstallation` por conversão, dois uploads simultâneos disputam o
    // perfil padrão e o segundo falha em silêncio (sem erro, sem arquivo de saída).
    const { normalizarDocLegado } = carregarLib();
    comLibreOffice();
    await normalizarDocLegado(arquivoDoc());

    const args = execFile.mock.calls[0][1];
    expect(args.some(a => String(a).startsWith('-env:UserInstallation='))).toBe(true);
    expect(args).toContain('--headless');
  });

  it('nunca escreve em disco o nome vindo do cliente (path traversal)', async () => {
    const { normalizarDocLegado } = carregarLib();
    comLibreOffice();
    await normalizarDocLegado({
      ...arquivoDoc(),
      originalname: '../../../etc/passwd.doc',
    });

    const caminhoEntrada = execFile.mock.calls[0][1].slice(-1)[0];
    expect(caminhoEntrada).not.toContain('passwd');
    expect(caminhoEntrada).toMatch(/[0-9a-f]{16}\.doc$/);
  });

  it('impõe timeout — documento corrompido trava o LibreOffice headless', async () => {
    const { normalizarDocLegado } = carregarLib();
    comLibreOffice();
    await normalizarDocLegado(arquivoDoc());

    expect(execFile.mock.calls[0][2].timeout).toBeGreaterThan(0);
  });
});

describe('normalizarDocsLegados — lote do multer', () => {
  it('converte só os .doc e preserva a ORDEM da lista', async () => {
    const { normalizarDocsLegados, MIME_DOCX } = carregarLib();
    comLibreOffice();
    const pdf = { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF') };

    const saida = await normalizarDocsLegados([pdf, arquivoDoc(), pdf]);

    // A ordem importa: `criarNaoPedido` casa o arquivo com o índice ao anexar as
    // imagens do resultado — reordenar aqui trocaria os anexos de lugar.
    expect(saida.map(f => f.mimetype)).toEqual(['application/pdf', MIME_DOCX, 'application/pdf']);
  });

  it('lista vazia ou ausente não invoca o conversor', async () => {
    const { normalizarDocsLegados } = carregarLib();
    semLibreOffice();
    expect(await normalizarDocsLegados([])).toEqual([]);
    expect(await normalizarDocsLegados(undefined)).toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });
});
