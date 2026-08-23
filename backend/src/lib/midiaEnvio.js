// backend/src/lib/midiaEnvio.js
//
// Escrita da RESPOSTA HTTP de um `MidiaArquivo` (headers + corpo + Range) —
// extraído de `MidiaController.js` para ser reutilizado por qualquer rota que
// precise servir um arquivo já gravado no storage, mas com uma autorização
// PRÓPRIA (diferente da sessão autenticada padrão de `/api/midia/:chave`).
//
// Primeiro consumidor fora do MidiaController: a rota pública de fatura
// (lib/faturaLinkPublico.js) — o PDF da fatura mora na MESMA tabela
// (`tb_midia_arquivos`), só que o gate de acesso é o token+CPF do link, não
// `verificarAcessoAnimal`/`req.empresaId`. Duas implementações de cabeçalho
// (Range, CSP, Content-Disposition) divergiriam na primeira correção — por
// isso uma função só, não uma cópia por rota.
'use strict';

const prisma = require('./prisma').default;

// Espelha a whitelist que o express.static usava: o que não é mídia reconhecida vai
// como anexo (Content-Disposition: attachment), neutralizando XSS armazenado por
// SVG/HTML. A defesa não podia sumir junto com o static.
const MIME_INLINE = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg',
  'application/pdf',
]);

// Range: "bytes=INICIO-FIM" (só a primeira faixa; é o que os players usam na prática)
function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m) return null;
  const [, iniStr, fimStr] = m;
  if (iniStr === '' && fimStr === '') return null;

  let inicio;
  let fim;
  if (iniStr === '') {
    // sufixo: últimos N bytes
    const n = Number(fimStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    inicio = Math.max(total - n, 0);
    fim    = total - 1;
  } else {
    inicio = Number(iniStr);
    fim    = fimStr === '' ? total - 1 : Number(fimStr);
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || fim < inicio || inicio >= total) return null;
  return { inicio, fim: Math.min(fim, total - 1) };
}

/**
 * Escreve o arquivo na resposta (headers + corpo), com suporte a Range.
 * `midia` precisa de `{ id, mimeType, nomeOriginal, tamanho, publico }` — quem
 * chama já decidiu que o pedido está AUTORIZADO.
 */
async function enviarArquivo(req, res, midia) {
  const inline = MIME_INLINE.has(midia.mimeType.toLowerCase());

  const comuns = (publico) => {
    res.setHeader('Content-Type', midia.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // `frame-ancestors`: inline libera SÓ a própria origem (a UI embute em
    // <iframe> same-origin); anexo para download nunca é embutido em frame.
    res.setHeader('Content-Security-Policy',
      inline ? "default-src 'none'; sandbox; frame-ancestors 'self'"
             : "default-src 'none'; sandbox; frame-ancestors 'none'");
    // Cache PRIVADO para dado de cliente: proxy compartilhado não pode guardá-lo.
    res.setHeader('Cache-Control', publico
      ? 'public, max-age=86400, immutable'
      : 'private, max-age=86400, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
    if (!inline) {
      const nome = (midia.nomeOriginal ?? 'arquivo').replace(/["\\\r\n]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    }
  };

  const faixa = parseRange(req.headers.range, midia.tamanho);

  if (faixa) {
    // Fatia lida direto no Postgres com substring() — não materializa o
    // arquivo inteiro em memória, e o player mantém o seek.
    const tamanhoFaixa = faixa.fim - faixa.inicio + 1;
    const linhas = await prisma.$queryRaw`
      SELECT substring(conteudo from ${faixa.inicio + 1}::int for ${tamanhoFaixa}::int) AS pedaco
      FROM schs2vet.tb_midia_arquivos
      WHERE id = ${midia.id}
    `;
    const pedaco = linhas?.[0]?.pedaco;
    if (!pedaco) return res.status(404).json({ error: 'Arquivo não encontrado' });

    comuns(midia.publico);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${faixa.inicio}-${faixa.fim}/${midia.tamanho}`);
    res.setHeader('Content-Length', String(pedaco.length));
    return res.end(pedaco);
  }

  const completo = await prisma.midiaArquivo.findUnique({
    where:  { id: midia.id },
    select: { conteudo: true },
  });
  if (!completo) return res.status(404).json({ error: 'Arquivo não encontrado' });

  comuns(midia.publico);
  res.setHeader('Content-Length', String(completo.conteudo.length));
  return res.end(completo.conteudo);
}

module.exports = { enviarArquivo, parseRange, MIME_INLINE };
