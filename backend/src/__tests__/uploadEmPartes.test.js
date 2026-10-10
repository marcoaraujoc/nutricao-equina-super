// UPLOAD EM PARTES da mídia de evolução (2026-10-09) — lib/uploadEmPartes.js.
//
// Um MP4 de 89 MB enviado numa requisição só levava mais de 4 minutos e morria em 524
// no Cloudflare (100 s por requisição), sem gravar nada. O arquivo passou a subir em
// partes de 4 MB, remontadas no servidor. Estes testes rodam a lib REAL em disco.
'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const { receberParte, validarParte, pastaDoEnvio } = require('../lib/uploadEmPartes');

const TETO  = 150 * 1024 * 1024;
const PARTE = 4 * 1024 * 1024;

let destino;
beforeEach(() => { destino = fs.mkdtempSync(path.join(os.tmpdir(), 'up-teste-')); });
afterEach(() => fs.rmSync(destino, { recursive: true, force: true }));

async function enviar(buf, { userId = 1, evolucaoId = 2, ordem } = {}) {
  const total    = Math.ceil(buf.length / PARTE);
  const uploadId = crypto.randomBytes(16).toString('hex');
  const indices  = ordem ?? [...Array(total).keys()];
  let r;
  for (const i of indices) {
    r = await receberParte({
      userId, evolucaoId, uploadId, indice: i, total, tamanhoTotal: buf.length,
      buffer: buf.subarray(i * PARTE, (i + 1) * PARTE), extensao: '.mp4',
      destinoDir: destino, tetoBytes: TETO,
    });
  }
  return { r, uploadId };
}

describe('receberParte — o arquivo remontado é o original', () => {
  test('🔴 várias partes viram o arquivo idêntico, e a pasta temporária some', async () => {
    const orig = crypto.randomBytes(10 * 1024 * 1024 + 777);
    const { r, uploadId } = await enviar(orig);
    expect(r.completo).toBe(true);
    expect(r.tamanho).toBe(orig.length);
    expect(Buffer.compare(fs.readFileSync(r.caminho), orig)).toBe(0);
    expect(path.extname(r.caminho)).toBe('.mp4');
    expect(fs.existsSync(pastaDoEnvio(1, 2, uploadId))).toBe(false);
  });

  test('parte intermediária responde "ainda faltam" sem remontar', async () => {
    const orig = crypto.randomBytes(9 * 1024 * 1024);
    const uploadId = crypto.randomBytes(16).toString('hex');
    const r = await receberParte({
      userId: 1, evolucaoId: 2, uploadId, indice: 0, total: 3, tamanhoTotal: orig.length,
      buffer: orig.subarray(0, PARTE), extensao: '.mp4', destinoDir: destino, tetoBytes: TETO,
    });
    expect(r).toEqual({ completo: false, recebidas: 1 });
    fs.rmSync(pastaDoEnvio(1, 2, uploadId), { recursive: true, force: true });
  });

  test('arquivo de uma parte só também passa (arquivo pequeno)', async () => {
    const orig = crypto.randomBytes(1000);
    const { r } = await enviar(orig);
    expect(Buffer.compare(fs.readFileSync(r.caminho), orig)).toBe(0);
  });

  test('a soma das partes não pode passar do tamanho declarado', async () => {
    const uploadId = crypto.randomBytes(16).toString('hex');
    await expect(receberParte({
      userId: 1, evolucaoId: 2, uploadId, indice: 0, total: 2, tamanhoTotal: 10,
      buffer: crypto.randomBytes(100), extensao: '.mp4', destinoDir: destino, tetoBytes: TETO,
    })).rejects.toMatchObject({ status: 413 });
  });

  test('o envio é isolado por usuário: a parte de outro não completa o arquivo de ninguém', async () => {
    const orig = crypto.randomBytes(PARTE + 10);
    const uploadId = crypto.randomBytes(16).toString('hex');
    const base = { evolucaoId: 2, uploadId, total: 2, tamanhoTotal: orig.length, extensao: '.mp4', destinoDir: destino, tetoBytes: TETO };
    await receberParte({ ...base, userId: 1, indice: 0, buffer: orig.subarray(0, PARTE) });
    const r = await receberParte({ ...base, userId: 99, indice: 1, buffer: orig.subarray(PARTE) });
    expect(r.completo).toBe(false);   // foi para a pasta do usuário 99, não completou a do 1
    fs.rmSync(pastaDoEnvio(1, 2, uploadId), { recursive: true, force: true });
    fs.rmSync(pastaDoEnvio(99, 2, uploadId), { recursive: true, force: true });
  });
});

describe('validarParte — o que vira nome de pasta é conferido', () => {
  const ok = { uploadId: 'a'.repeat(32), indice: 0, total: 3, tamanhoTotal: 1000 };
  test('aceita o envio válido', () => expect(validarParte(ok, TETO)).toBeNull());
  test('🔴 recusa uploadId que não é hex (path traversal)', () => {
    expect(validarParte({ ...ok, uploadId: '../../etc' }, TETO)).toMatch(/inválido/);
  });
  test('recusa índice fora do total', () => {
    expect(validarParte({ ...ok, indice: 3 }, TETO)).toMatch(/inválido/);
  });
  test('recusa arquivo acima do teto do sistema', () => {
    expect(validarParte({ ...ok, tamanhoTotal: TETO + 1 }, TETO)).toMatch(/excede/);
  });
});

describe('gate — a rota existe e a tela usa o envio em partes', () => {
  test('rota /:id/midias/partes montada com permissão e tenantRls', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '..', 'routes', 'evolucao.js'), 'utf8');
    expect(rotas).toMatch(/router\.post\('\/:id\/midias\/partes',[^\n]*checkPermission\('atendimento\.evolucoes\.criar'[^\n]*tenantRls[^\n]*adicionarMidiaEmPartes/);
  });

  test('a tela de Evolução envia anexo em partes e não finaliza com anexo faltando', () => {
    const tela = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'SubModuloEvolucao.tsx'), 'utf8');
    expect(tela).toMatch(/enviarEmPartes\(`\/clinica\/evolucoes\/\$\{evolucaoId\}\/midias\/partes`/);
    expect(tela).toMatch(/\(await uploadMidias\(editingEv\.id, arquivosModal\)\)\.length > 0\) return;/);
  });
});
