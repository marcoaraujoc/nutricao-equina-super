// backend/src/controllers/ExportacaoController.js
//
// Administração > Exportação — exporta o prontuário COMPLETO de um paciente, ou de
// todos os pacientes de um proprietário, num ZIP (relatório HTML + mídias reais).
//
// ACESSO: só GESTOR (da empresa ativa) ou ADMIN da plataforma — mesmo padrão de
// `AuditController.listar` (não é uma ação do dia a dia clínico, é administração).
//
// MULTI-TENANT/RLS: a lista de animais exportáveis usa `buildAnimalScopeWhere` — a
// MESMA fonte que a tela de Pacientes usa — e a geração do ZIP RE-VALIDA cada
// `animalId` recebido contra esse mesmo escopo antes de tocar num único registro
// clínico. Nunca confia na lista de ids que o cliente mandou: um front comprometido
// ou uma chamada direta à API não alcança paciente fora do escopo — o filtro é
// sempre recalculado no servidor, e a leitura em si passa pelo client `prisma`
// ESTENDIDO (RLS carimbado pelo `authenticate`), então mesmo um id que escapasse
// desse filtro ainda esbarraria no banco.
'use strict';

const archiver = require('archiver');
const prisma = require('../lib/prisma').default;
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { aplicarPerfilEmLista } = require('../lib/proprietarioPerfil');
const { coletarProntuario, coletarMidias, montarHtmlRelatorio, nomeArquivoSeguro } = require('../lib/exportacaoPaciente');
const { registrarAuditoria } = require('../lib/auditoria');

function podeExportar(req) {
  const { role, userType } = req.user ?? {};
  return role === 'ADMIN' || userType === 'ADMIN' || req.membroCargo === 'GESTOR';
}

const ExportacaoController = {

  // GET /api/admin/exportacao/animais
  // Lista os pacientes que o usuário pode exportar, já com o proprietário anexado —
  // o front agrupa por proprietário para o modo "todos os pacientes dele".
  listarAnimais: async (req, res) => {
    try {
      if (!podeExportar(req)) {
        return res.status(403).json({ error: 'Apenas gestores podem exportar dados de pacientes.' });
      }

      const { where } = await buildAnimalScopeWhere(req);
      const animais = await prisma.animal.findMany({
        where: { ...where, ...ANIMAL_VISIVEL },
        select: {
          id: true, nome: true,
          especie: { select: { nome: true } },
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { nome: 'asc' },
      });

      // Nome do proprietário POR EMPRESA (ProprietarioPerfil) — o `user.fullName` cru
      // é o legado global e pode divergir do que a clínica cadastrou (§36 CLAUDE.md).
      const proprietarios = animais.map(a => a.user).filter(Boolean);
      await aplicarPerfilEmLista(proprietarios, req.empresaId ?? null);

      // Donos ANTERIORES (Transferência de Propriedade) — janelas FECHADAS de cada
      // animal, para a tela oferecer "exportar como o período de <ex-dono>".
      const animalIds = animais.map(a => a.id);
      const janelasFechadas = animalIds.length > 0
        ? await prisma.animalProprietarioHistorico.findMany({
            where: { animalId: { in: animalIds }, dataFim: { not: null } },
            select: {
              animalId: true, dataInicio: true, dataFim: true,
              proprietario: { select: { id: true, fullName: true, email: true } },
            },
            orderBy: { dataInicio: 'desc' },
          })
        : [];
      const donosAnterioresPorAnimal = new Map();
      if (janelasFechadas.length > 0) {
        const exDonos = janelasFechadas.map(j => j.proprietario).filter(Boolean);
        await aplicarPerfilEmLista(exDonos, req.empresaId ?? null);
        for (const j of janelasFechadas) {
          const lista = donosAnterioresPorAnimal.get(j.animalId) ?? [];
          lista.push({
            proprietarioId: j.proprietario?.id ?? null,
            nome:           j.proprietario?.fullName ?? 'Proprietário',
            dataInicio:     j.dataInicio,
            dataFim:        j.dataFim,
          });
          donosAnterioresPorAnimal.set(j.animalId, lista);
        }
      }

      const dados = animais.map(a => ({
        id: a.id, nome: a.nome, especie: a.especie?.nome ?? null,
        proprietario: a.user ? { id: a.user.id, nome: a.user.fullName, email: a.user.email } : null,
        donosAnteriores: donosAnterioresPorAnimal.get(a.id) ?? [],
      }));

      return res.json({ dados });
    } catch (err) {
      console.error('ExportacaoController.listarAnimais:', err);
      return res.status(500).json({ error: 'Erro ao listar pacientes para exportação.' });
    }
  },

  // POST /api/admin/exportacao/gerar — body: { animalIds: number[] }
  // Gera e transmite o ZIP direto na resposta (sem materializar em disco).
  gerar: async (req, res) => {
    try {
      if (!podeExportar(req)) {
        return res.status(403).json({ error: 'Apenas gestores podem exportar dados de pacientes.' });
      }

      const idsRecebidos = [...new Set((req.body?.animalIds ?? []).map(Number).filter(Number.isInteger))];
      if (idsRecebidos.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um paciente.' });
      }
      if (idsRecebidos.length > 200) {
        return res.status(400).json({ error: 'Selecione no máximo 200 pacientes por exportação.' });
      }
      // Exportação é sempre "para um proprietário" — atual (padrão) ou um ANTERIOR
      // (Transferência de Propriedade). Aplicado uniformemente ao lote: exportar para
      // proprietário X é uma operação de UM proprietário só, não vários por vez.
      const proprietarioIdBody = req.body?.proprietarioId != null ? Number(req.body.proprietarioId) : null;

      // RE-VALIDA contra o escopo — nunca confia nos ids recebidos do cliente.
      const { where } = await buildAnimalScopeWhere(req);
      const animaisNoEscopo = await prisma.animal.findMany({
        where: { ...where, ...ANIMAL_VISIVEL, id: { in: idsRecebidos } },
        select: { id: true, nome: true },
      });
      if (animaisNoEscopo.length === 0) {
        return res.status(404).json({ error: 'Nenhum dos pacientes selecionados está no seu escopo de acesso.' });
      }

      // Checagem cedo (antes de abrir o stream do ZIP): `proprietarioId` precisa ser
      // dono — atual ou anterior — de PELO MENOS UM dos animais selecionados, senão
      // o lote inteiro sairia vazio sem explicação nenhuma ao usuário.
      if (proprietarioIdBody != null) {
        const idsNoEscopo = animaisNoEscopo.map(a => a.id);
        const [algumAtual, algumAnterior] = await Promise.all([
          prisma.animal.count({ where: { id: { in: idsNoEscopo }, userId: proprietarioIdBody } }),
          prisma.animalProprietarioHistorico.count({ where: { animalId: { in: idsNoEscopo }, proprietarioId: proprietarioIdBody, dataFim: { not: null } } }),
        ]);
        if (algumAtual === 0 && algumAnterior === 0) {
          return res.status(400).json({ error: 'Este proprietário nunca foi dono de nenhum dos pacientes selecionados.' });
        }
      }

      const empresa = req.empresaId
        ? await prisma.empresa.findUnique({ where: { id: req.empresaId }, select: { nome: true } })
        : null;
      const nomeEmpresa = empresa?.nome ?? 'S2Vet';

      const nomeZip = animaisNoEscopo.length === 1
        ? `prontuario-${nomeArquivoSeguro(animaisNoEscopo[0].nome)}.zip`
        : `prontuarios-${animaisNoEscopo.length}-pacientes-${new Date().toISOString().slice(0, 10)}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeZip}"`);

      const arquivo = archiver('zip', { zlib: { level: 6 } });
      arquivo.on('error', (err) => {
        console.error('ExportacaoController.gerar (archiver):', err);
        if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar o arquivo de exportação.' });
        else res.end();
      });
      arquivo.pipe(res);

      for (const { id, nome } of animaisNoEscopo) {
        const dados = await coletarProntuario(req, id, proprietarioIdBody);
        // `null` = saiu do escopo entre a validação e aqui (raríssimo); `{erro}` =
        // este animal específico nunca teve `proprietarioIdBody` como dono — nos
        // dois casos, não trava o resto do lote, só pula este paciente.
        if (!dados || dados.erro) continue;

        const { arquivos, fotoDataUri } = await coletarMidias(dados);
        const html = montarHtmlRelatorio(dados, fotoDataUri, nomeEmpresa);

        const pasta = `${String(id).padStart(5, '0')}-${nomeArquivoSeguro(nome)}`;
        arquivo.append(html, { name: `${pasta}/relatorio.html` });
        for (const m of arquivos) {
          if (m.conteudo) arquivo.append(m.conteudo, { name: `${pasta}/midias/${m.nomeNoZip}` });
        }
      }

      await arquivo.finalize();

      // Auditoria DEPOIS do finalize — fire-and-forget, nunca atrasa/derruba o
      // download (o ZIP já foi todo transmitido a esta altura).
      const nomes = animaisNoEscopo.map(a => a.nome).slice(0, 30).join(', ');
      let motivoPeriodo = '';
      if (proprietarioIdBody != null) {
        const dono = await prisma.user.findUnique({ where: { id: proprietarioIdBody }, select: { fullName: true } }).catch(() => null);
        motivoPeriodo = ` — período do proprietário ${dono?.fullName ?? `#${proprietarioIdBody}`}`;
      }
      registrarAuditoria(null, req, {
        categoria: 'EXPORTACAO',
        entidade:  'ANIMAL',
        motivo:    `Exportação de prontuário${motivoPeriodo} — ${animaisNoEscopo.length} paciente(s): ${nomes}${animaisNoEscopo.length > 30 ? '…' : ''}`,
      }).catch(() => { /* auditoria nunca derruba a ação — já respondida */ });
    } catch (err) {
      console.error('ExportacaoController.gerar:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar a exportação.' });
      else res.end();
    }
  },
};

module.exports = ExportacaoController;
