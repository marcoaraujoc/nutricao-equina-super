// backend/src/lib/uploadEmPartes.js
//
// UPLOAD EM PARTES (2026-10-09) — o arquivo grande chega em pedaços e é remontado aqui.
//
// 🔴 POR QUÊ: o acesso passa pelo Cloudflare, que CORTA a requisição cujo servidor não
// responde em 100 s (HTTP 524). Num upload único, a resposta só pode sair depois que o
// ÚLTIMO byte chegou — então o limite real de tamanho virava a velocidade de UPLOAD de
// quem envia: um MP4 de 89 MB levou mais de 4 minutos e morreu em 524, sem gravar nada.
// O banco NÃO é o gargalo (medido: 90 MB gravados em ~7 s).
// Com partes de poucos MB, cada requisição termina bem antes dos 100 s em qualquer
// conexão razoável, e só a ÚLTIMA paga a gravação no banco.
//
// ⚠️ As partes moram em disco, numa pasta amarrada a (usuário, evolução, uploadId):
//    outro usuário não consegue completar nem sobrescrever o envio de ninguém.
// ⚠️ `uploadId` é validado como hex — ele vira nome de pasta (path traversal).
// ⚠️ O teto do sistema (150 MB) vale para a SOMA das partes, não por parte.
// ⚠️ Envio abandonado no meio fica para trás: a varredura apaga pastas com mais de
//    2 h a cada envio novo (não há cron para isto — não precisa).
'use strict';

const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

const PASTA_PARTES     = path.join('uploads', 'evolucoes', 'partes');
const VALIDADE_MS      = 2 * 60 * 60 * 1000;
const MAX_BYTES_PARTE  = 8 * 1024 * 1024;   // o front manda 4 MB; folga para não recusar por pouco

const UPLOAD_ID_RE = /^[a-f0-9]{16,64}$/;

// Whitelist da mídia de evolução — FONTE ÚNICA, usada pelo multer da rota de envio
// inteiro E pela validação do envio em partes (que não passa por `fileFilter`).
// SVG/HTML ficam de fora de propósito (XSS armazenado).
const MIDIA_EXT_PERMITIDAS  = /\.(jpe?g|png|gif|webp|mp4|webm|ogg|mov|m4v|mp3|wav|m4a|aac)$/i;
const MIDIA_MIME_PERMITIDOS = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg|quicktime|x-m4v)|audio\/(mpeg|mp3|webm|ogg|wav|mp4|x-m4a|aac))$/i;

/** Validação dos campos de uma parte. Devolve mensagem de erro ou null. */
function validarParte({ uploadId, indice, total, tamanhoTotal }, tetoBytes) {
  if (!UPLOAD_ID_RE.test(String(uploadId || ''))) return 'Identificador de envio inválido.';
  const i = Number(indice), t = Number(total), tam = Number(tamanhoTotal);
  if (!Number.isInteger(t) || t < 1 || t > Math.ceil(tetoBytes / (1024 * 1024)) + 1) return 'Quantidade de partes inválida.';
  if (!Number.isInteger(i) || i < 0 || i >= t) return 'Número da parte inválido.';
  if (!Number.isFinite(tam) || tam <= 0) return 'Tamanho do arquivo inválido.';
  if (tam > tetoBytes) {
    return `Arquivo de ${(tam / 1048576).toFixed(1)} MB excede o limite de ${(tetoBytes / 1048576).toFixed(0)} MB.`;
  }
  return null;
}

function pastaDoEnvio(userId, evolucaoId, uploadId) {
  return path.join(PASTA_PARTES, `${Number(userId)}-${Number(evolucaoId)}-${uploadId}`);
}

/** Apaga envios abandonados. Nunca lança — é faxina, não pode derrubar o upload. */
async function varrerAbandonados(agora = Date.now()) {
  try {
    const nomes = await fsp.readdir(PASTA_PARTES);
    await Promise.all(nomes.map(async (n) => {
      const p = path.join(PASTA_PARTES, n);
      const st = await fsp.stat(p).catch(() => null);
      if (st && agora - st.mtimeMs > VALIDADE_MS) await fsp.rm(p, { recursive: true, force: true });
    }));
  } catch { /* pasta ainda não existe */ }
}

/**
 * Grava UMA parte. Quando todas chegaram, remonta o arquivo em `destinoDir` e devolve
 * `{ completo: true, caminho, tamanho }`; senão `{ completo: false, recebidas }`.
 * Lança Error com `.status` para recusa de negócio (400/413).
 */
async function receberParte({ userId, evolucaoId, uploadId, indice, total, tamanhoTotal, buffer, extensao, destinoDir, tetoBytes }) {
  const pasta = pastaDoEnvio(userId, evolucaoId, uploadId);
  if (Number(indice) === 0) {
    await varrerAbandonados();
    await fsp.rm(pasta, { recursive: true, force: true });   // recomeço limpo
  }
  await fsp.mkdir(pasta, { recursive: true });
  await fsp.writeFile(path.join(pasta, String(Number(indice))), buffer);

  const nomes = await fsp.readdir(pasta);
  let soma = 0;
  for (const n of nomes) soma += (await fsp.stat(path.join(pasta, n))).size;
  if (soma > tetoBytes || soma > Number(tamanhoTotal)) {
    await fsp.rm(pasta, { recursive: true, force: true });
    const e = new Error(`Arquivo excede o limite de ${(tetoBytes / 1048576).toFixed(0)} MB.`);
    e.status = 413; e.code = 'ARQUIVO_GRANDE_DEMAIS';
    throw e;
  }
  if (nomes.length < Number(total)) return { completo: false, recebidas: nomes.length };
  if (soma !== Number(tamanhoTotal)) {
    await fsp.rm(pasta, { recursive: true, force: true });
    const e = new Error('O arquivo chegou incompleto. Envie novamente.');
    e.status = 400; e.code = 'UPLOAD_INCOMPLETO';
    throw e;
  }

  // Remonta na ORDEM das partes, por stream (não carrega 150 MB na memória de uma vez).
  const nomeFinal = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${extensao}`;
  const caminho   = path.join(destinoDir, nomeFinal);
  const saida     = fs.createWriteStream(caminho);
  try {
    for (let i = 0; i < Number(total); i++) {
      await new Promise((resolve, reject) => {
        const entrada = fs.createReadStream(path.join(pasta, String(i)));
        entrada.on('error', reject);
        entrada.on('end', resolve);
        entrada.pipe(saida, { end: false });
      });
    }
    await new Promise((resolve, reject) => saida.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    saida.destroy();
    await fsp.rm(caminho, { force: true });
    throw err;
  } finally {
    await fsp.rm(pasta, { recursive: true, force: true });
  }
  return { completo: true, caminho, nomeFinal, tamanho: soma };
}

module.exports = { MIDIA_EXT_PERMITIDAS, MIDIA_MIME_PERMITIDOS, receberParte, validarParte, varrerAbandonados, pastaDoEnvio, MAX_BYTES_PARTE, PASTA_PARTES };
