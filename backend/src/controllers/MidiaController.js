// backend/src/controllers/MidiaController.js
//
// ÚNICA porta de saída de arquivo da aplicação.
//
// Antes o byte saía por `express.static('/uploads')`, sem autenticação: o gate era o
// nome aleatório do arquivo. Quem tivesse a URL continuava lendo a foto do paciente ou
// o laudo mesmo depois de perder o acesso — e de qualquer empresa. Agora todo download
// passa por aqui e responde à MESMA regra de acesso do resto do sistema.
//
// AUTORIZAÇÃO, na ordem:
//   publico            → asset do PRODUTO (marca S2Vet). Nunca dado de cliente.
//   ADMIN da plataforma→ tudo
//   animalId presente  → verificarAcessoAnimal (empresa/equipe/vínculo/designação)
//   empresaId presente → tem de ser a empresa do contexto ativo
//   sem contexto algum → só ADMIN (arquivo legado sem dono identificado)
'use strict';

const prisma  = require('../lib/prisma').default;
const mammoth = require('mammoth');
const { verificarAcessoAnimal } = require('../lib/animalAccess');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Espelha a whitelist que o express.static usava: o que não é mídia reconhecida vai
// como anexo (Content-Disposition: attachment), neutralizando XSS armazenado por
// SVG/HTML. A defesa não podia sumir junto com o static.
const MIME_INLINE = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg',
  'application/pdf',
]);

function ehAdminPlataforma(req) {
  return req.user?.role === 'ADMIN' || req.user?.userType === 'ADMIN';
}

async function autorizar(req, midia) {
  if (midia.publico) return true;
  if (ehAdminPlataforma(req)) return true;

  if (midia.animalId) {
    const acesso = await verificarAcessoAnimal({
      animalId:  midia.animalId,
      userId:    req.user.id,
      empresaId: req.empresaId,
      equipeId:  req.equipeId,
      userType:  req.user.userType,
    });
    return acesso === true;
  }

  if (midia.empresaId) {
    return Boolean(req.empresaId) && Number(req.empresaId) === midia.empresaId;
  }

  // Sem dono identificado: só o autor original (permite o próprio usuário reabrir o
  // que acabou de enviar) — o resto cai para o ADMIN, já tratado acima.
  return midia.criadoPorId != null && Number(midia.criadoPorId) === Number(req.user.id);
}

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

// Categoria reservada à MARCA DO PRODUTO. Uma linha só, `publico: true`.
const PASTA_MARCA = 'marca';

// Escreve o arquivo na resposta (headers + corpo), com suporte a Range.
// Compartilhado por `baixar` (autorizado) e `marca` (público) para não haver duas
// implementações de cabeçalho divergindo.
async function enviarArquivo(req, res, midia) {
  const inline = MIME_INLINE.has(midia.mimeType.toLowerCase());

  const comuns = (publico) => {
    res.setHeader('Content-Type', midia.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // `frame-ancestors`: 'none' bloqueava a PRÓPRIA aplicação de exibir o arquivo —
    // o visualizador embute PDF num <iframe> same-origin (VisualizadorArquivos, em
    // Exames.tsx) e o navegador recusava a navegação do frame ("localhost recusou
    // a conexão" dentro da caixa do visualizador, sem nenhuma requisição de rede
    // sequer aparecer — é bloqueio de CSP, não erro de servidor). Inline (o que a
    // UI efetivamente embute) libera SÓ a própria origem; anexo para download
    // (Content-Disposition abaixo) nunca é embutido em frame nenhum, então segue
    // vedado a todos.
    res.setHeader('Content-Security-Policy',
      inline ? "default-src 'none'; sandbox; frame-ancestors 'self'"
             : "default-src 'none'; sandbox; frame-ancestors 'none'");
    // Cache PRIVADO para dado de cliente: proxy compartilhado não pode guardá-lo.
    // `immutable` é seguro porque a chave é única por conteúdo — trocar a foto gera
    // outra chave. A marca do produto é pública e pode ser cacheada por qualquer um.
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
    // Fatia lida direto no Postgres com substring() — o vídeo NÃO é materializado
    // inteiro em memória, e o player mantém o seek. É o que torna viável guardar
    // binário grande em bytea.
    // `::int` é obrigatório: o Prisma envia número como `bigint` e o Postgres só tem
    // `substring(bytea, integer, integer)` — sem o cast a query morre com 42883.
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

const SELECT_META = {
  id: true, mimeType: true, nomeOriginal: true, tamanho: true,
  empresaId: true, animalId: true, criadoPorId: true, publico: true, criadoEm: true,
};

const MidiaController = {

  // GET /api/marca — MARCA DO PRODUTO, sem autenticação.
  //
  // Precisa ser pública: aparece na tela de login, antes de existir sessão. Rota
  // SEPARADA de propósito — não recebe chave do cliente, então não há como usá-la para
  // alcançar arquivo de paciente. Se a marca ainda não foi carregada, 404 e o
  // componente do front cai no texto (já trata `onError`).
  marca: async (req, res) => {
    try {
      const midia = await prisma.midiaArquivo.findFirst({
        where:   { pasta: PASTA_MARCA, publico: true },
        orderBy: { criadoEm: 'desc' },
        select:  SELECT_META,
      });
      if (!midia) return res.status(404).json({ error: 'Marca não cadastrada' });
      return await enviarArquivo(req, res, midia);
    } catch (err) {
      console.error('MidiaController.marca:', err);
      return res.status(500).json({ error: 'Erro ao obter a marca' });
    }
  },

  // GET /api/midia/:chave
  baixar: async (req, res) => {
    try {
      const chave = String(req.params.chave ?? '');
      if (!/^[a-f0-9]{16,64}$/i.test(chave)) {
        return res.status(400).json({ error: 'Chave inválida' });
      }

      // Metadados primeiro, SEM o conteúdo: autorizar antes de puxar o binário evita
      // carregar um vídeo inteiro para depois responder 403.
      const midia = await prisma.midiaArquivo.findUnique({
        where:  { chave },
        select: SELECT_META,
      });
      if (!midia) return res.status(404).json({ error: 'Arquivo não encontrado' });

      if (!(await autorizar(req, midia))) {
        // 404, não 403: não confirma a existência do arquivo para quem não pode vê-lo.
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }

      // Envio (headers + corpo + Range) é compartilhado com a rota pública da marca:
      // duas implementações de cabeçalho divergiriam na primeira correção.
      return await enviarArquivo(req, res, midia);
    } catch (err) {
      console.error('MidiaController.baixar:', err);
      return res.status(500).json({ error: 'Erro ao obter arquivo' });
    }
  },

  // GET /api/midia/:chave/preview — SÓ para .docx.
  //
  // O navegador não sabe renderizar DOCX nativamente (nem num <iframe>, nem numa
  // <img>) — a única forma de "ver" o arquivo sem passar por um app externo é
  // convertê-lo para algo que ele entenda. Reusa o MESMO `mammoth` que o backend já
  // usa para extrair texto do laudo (exameParserService), agora pedindo HTML em vez
  // de texto puro — parágrafos/negrito/tabelas do documento saem preservados.
  // Mesma autorização de `baixar` (por dono do arquivo); devolve JSON `{ html }`,
  // nunca HTML direto — quem renderiza é o front, dentro de um <iframe sandbox>
  // (sem `allow-scripts`), então mesmo um DOCX malicioso não executa nada.
  visualizarDocx: async (req, res) => {
    try {
      const chave = String(req.params.chave ?? '');
      if (!/^[a-f0-9]{16,64}$/i.test(chave)) {
        return res.status(400).json({ error: 'Chave inválida' });
      }

      const midia = await prisma.midiaArquivo.findUnique({
        where:  { chave },
        select: SELECT_META,
      });
      if (!midia) return res.status(404).json({ error: 'Arquivo não encontrado' });

      if (!(await autorizar(req, midia))) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }

      if (midia.mimeType !== MIME_DOCX) {
        return res.status(415).json({ error: 'Pré-visualização só é suportada para arquivos DOCX' });
      }

      const completo = await prisma.midiaArquivo.findUnique({
        where:  { id: midia.id },
        select: { conteudo: true },
      });
      if (!completo) return res.status(404).json({ error: 'Arquivo não encontrado' });

      const { value: html } = await mammoth.convertToHtml({ buffer: completo.conteudo });
      // Mesmo cache privado do download — a chave é única por conteúdo.
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      return res.json({ dados: { html } });
    } catch (err) {
      console.error('MidiaController.visualizarDocx:', err);
      return res.status(500).json({ error: 'Erro ao gerar a pré-visualização do arquivo' });
    }
  },
};

module.exports = MidiaController;
