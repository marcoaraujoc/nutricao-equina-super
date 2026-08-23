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
const { registrarAcessoNegado } = require('../lib/auditoria');
const { enviarArquivo } = require('../lib/midiaEnvio');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

// Categoria reservada à MARCA DO PRODUTO. Uma linha só, `publico: true`.
const PASTA_MARCA = 'marca';

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
        // A auditoria continua registrando a TENTATIVA — o 404 esconde a informação
        // do ATACANTE, não do gestor da empresa dona do arquivo. Fire-and-forget
        // (nunca lança, nunca atrasa a resposta), mesmo padrão de podeOperarRegistro.
        registrarAcessoNegado(req, {
          motivo:   'Tentativa de acesso a arquivo fora do escopo',
          entidade: 'MIDIA',
          entidadeId: midia.id,
          animalId: midia.animalId,
        });
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
        registrarAcessoNegado(req, {
          motivo:   'Tentativa de acesso a arquivo fora do escopo (pré-visualização)',
          entidade: 'MIDIA',
          entidadeId: midia.id,
          animalId: midia.animalId,
        });
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
