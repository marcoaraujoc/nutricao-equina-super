// backend/src/controllers/EmpresaCadastroController.js
//
// CADASTRO DO ASSINANTE — fase 2 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md §5.1).
//
// ⚠️ NÃO confundir com `EquipeController.obterConfiguracao` (`/api/equipes/configuracoes`):
// lá ficam as PREFERÊNCIAS OPERACIONAIS da clínica (logo, fechamento de fatura,
// expediente, espécies atendidas). Aqui fica a IDENTIDADE de quem assina o SaaS — razão
// social, documento, endereço fiscal, contato e situação da conta. São coisas diferentes
// e por isso moram em telas diferentes.

const prisma = require('../lib/prisma').default;
const { usoDeAssentos } = require('../lib/planoEmpresa');
// Documento da empresa: obrigatório e único entre empresas (ver lib/documentoEmpresa.js)
const { resolverDocumento } = require('../lib/documentoEmpresa');
const axios = require('axios');

/** Só dígitos — documento é gravado sem máscara. */
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

const STATUS_VALIDOS = ['ATIVA', 'SUSPENSA', 'CANCELADA'];

/**
 * Empresa do contexto ativo, exigindo que o usuário seja DONO ou GESTOR dela.
 *
 * ⚠️ Sem fallback para outra empresa (armadilha 36-b): se ele não é gestor NA empresa
 * ativa, a resposta é 403 — nunca "achar" outra empresa em que ele seja.
 */
async function empresaDoGestorNoContexto(req) {
  const empresaId = req.empresaId ? Number(req.empresaId) : null;
  if (!empresaId) return null;

  const ehAdminPlataforma = req.user?.role === 'ADMIN' || req.user?.userTypeGlobal === 'ADMIN';
  if (ehAdminPlataforma) return prisma.empresa.findUnique({ where: { id: empresaId } });

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) return null;
  if (empresa.ownerId === req.user.id) return empresa;

  const membro = await prisma.membroEquipe.findFirst({
    where:  { userId: req.user.id, cargo: 'GESTOR', equipe: { empresaId } },
    select: { id: true },
  });
  return membro ? empresa : null;
}

module.exports = {
  // GET /api/empresas/cadastro — dados do assinante + plano, uso de assentos, gestor
  // responsável e demais gestores da empresa
  obter: async (req, res) => {
    try {
      const empresa = await empresaDoGestorNoContexto(req);
      if (!empresa) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas o gestor da empresa ativa pode ver este cadastro.' });
      }

      // Plano e consumo de assentos — o gestor VÊ (para saber quanto ainda cabe), mas
      // não escolhe: trocar de plano é ato comercial, do ADMIN da plataforma.
      const uso = await usoDeAssentos(empresa.id);
      let plano = null;
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT p.slug, p.nome, p.limite_usuarios AS "limiteUsuarios",
                  p.preco_mensal AS "valor", p.validade_dias AS "validadeDias",
                  a.status, a.inicio_em AS "inicioEm", a.fim_em AS "fimEm",
                  a.limite_usuarios_override AS "limiteOverride"
             FROM schs2vet.tb_assinaturas_empresa a
             JOIN schs2vet.tb_planos p ON p.id = a.plano_id
            WHERE a.empresa_id = $1`,
          empresa.id,
        );
        plano = rows?.[0] ?? null;
      } catch { /* tabelas ainda não migradas */ }

      // Gestor responsável — quem o Admin cadastrou em "Criação de Gestor" (owner da
      // empresa). Somente leitura aqui: é o cadastro do ADMIN, não desta tela.
      const dono = empresa.ownerId
        ? await prisma.user.findUnique({
            where:  { id: empresa.ownerId },
            select: { fullName: true, email: true, phone: true },
          })
        : null;

      // Demais gestores da empresa (qualquer MembroEquipe com cargo GESTOR, incluindo
      // o dono) — alimenta a seção "Outros gestores" sem precisar de uma 2ª chamada.
      // `createdAt` do vínculo é a Data de Inclusão NESTA empresa — não a data de
      // criação da conta do usuário, que pode ser bem anterior (login reaproveitado).
      const membrosGestores = await prisma.membroEquipe.findMany({
        where:   { cargo: 'GESTOR', equipe: { empresaId: empresa.id } },
        select:  { userId: true, createdAt: true, user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true } } },
        orderBy: { createdAt: 'asc' },
        distinct: ['userId'],
      });
      const gestores = membrosGestores
        .filter((m) => m.user)
        .map((m) => ({ ...m.user, dataInclusao: m.createdAt }));

      res.json({
        sucesso: true,
        dados: {
          id:                empresa.id,
          // Legado: `nome` continua sendo o que aparece no seletor de contexto e no
          // rodapé. `razaoSocial`/`nomeFantasia` são o cadastro novo.
          nome:              empresa.nome,
          razaoSocial:       empresa.razaoSocial       ?? null,
          nomeFantasia:      empresa.nomeFantasia      ?? null,
          // Empresa antiga não tem `documento`: cai no `cnpj` legado, sem máscara.
          documento:         empresa.documento ?? (soDigitos(empresa.cnpj) || null),
          tipoDocumento:     empresa.tipoDocumento     ?? (empresa.cnpj ? 'CNPJ' : null),
          inscricaoEstadual: empresa.inscricaoEstadual ?? null,
          emailContato:      empresa.emailContato      ?? null,
          telefone:          empresa.telefone          ?? null,
          whatsapp:          empresa.whatsapp          ?? null,
          cep:               empresa.cep               ?? null,
          endereco:          empresa.endereco          ?? null,
          numero:            empresa.numero            ?? null,
          complemento:       empresa.complemento       ?? null,
          bairro:            empresa.bairro            ?? null,
          cidade:            empresa.cidade            ?? null,
          estado:            empresa.estado            ?? null,
          status:            empresa.status            ?? 'ATIVA',
          plano,
          uso,
          gestorResponsavel: dono,
          gestores,
        },
      });
    } catch (err) {
      console.error('Erro ao obter cadastro da empresa:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // PUT /api/empresas/cadastro
  //
  // 🔴 EDITADO PELO GESTOR (2026-08-17) — reverte a restrição de 2026-08-16. Com o
  // Admin agora criando só o GESTOR (ver EquipeController.criarGestor), é o próprio
  // gestor quem completa a identidade da empresa (nome, documento, razão social/
  // fantasia/IE, endereço, espécies — espécies via `PUT /equipes/configuracoes`, ver
  // EquipeController.salvarConfiguracao). O ADMIN continua podendo editar (mesma
  // resolução de `empresaDoGestorNoContexto`), mas não é mais o único.
  salvar: async (req, res) => {
    try {
      const empresa = await empresaDoGestorNoContexto(req);
      if (!empresa) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas o gestor da empresa ativa pode editar este cadastro.' });
      }

      const b = req.body ?? {};

      const nome = texto(b.nome, 255);
      if (!nome) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome da empresa é obrigatório', code: 'NOME_OBRIGATORIO' });
      }

      // Documento OBRIGATÓRIO e ÚNICO entre empresas — a mesma regra da criação.
      // Fechar só a criação não bastaria: daria para contornar em dois cliques,
      // criando com um documento e trocando por um já usado aqui.
      // ⚠️ `ignorarEmpresaId` é a própria empresa; sem ele, salvar o cadastro sem
      // mexer no documento acusaria conflito com ela mesma.
      const doc = await resolverDocumento(b.documento, { ignorarEmpresaId: empresa.id });
      if (doc.erro) return res.status(doc.status).json({ sucesso: false, mensagem: doc.erro, code: doc.code });
      const documento     = doc.digitos;
      const tipoDocumento = doc.tipo;

      if (b.estado && String(b.estado).trim().length !== 2) {
        return res.status(400).json({ sucesso: false, mensagem: 'Estado deve ter 2 letras (UF).' });
      }

      // Telefone OBRIGATÓRIO, como na criação. Exigir só lá deixaria a regra pela
      // metade: bastava salvar aqui com o campo vazio para a empresa ficar sem contato.
      const telefone = texto(b.telefone, 30);
      if (!telefone) {
        return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório', code: 'TELEFONE_OBRIGATORIO' });
      }

      // Endereço da empresa é OBRIGATÓRIO (exceto complemento) — faz parte do gate de
      // onboarding do gestor (ver ProtectedRoute + UserController.getMe).
      const cep         = soDigitos(b.cep).slice(0, 10) || null;
      const endereco     = texto(b.endereco, 255);
      const bairro       = texto(b.bairro, 100);
      const cidade       = texto(b.cidade, 100);
      const estadoUpper  = texto(b.estado, 2)?.toUpperCase() ?? null;
      if (!cep || !endereco || !bairro || !cidade || !estadoUpper) {
        return res.status(400).json({
          sucesso: false, mensagem: 'Endereço é obrigatório (CEP, logradouro, bairro, cidade e UF).',
          code: 'ENDERECO_OBRIGATORIO',
        });
      }

      const razaoSocial       = texto(b.razaoSocial, 255);
      const nomeFantasia      = texto(b.nomeFantasia, 255);
      const inscricaoEstadual = texto(b.inscricaoEstadual, 20);
      // Razão Social / Nome Fantasia / Inscrição Estadual só existem para pessoa
      // jurídica — CPF (empresa pessoal) não tem nenhum dos três.
      if (tipoDocumento === 'CNPJ' && !(razaoSocial && nomeFantasia && inscricaoEstadual)) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Razão Social, Nome Fantasia e Inscrição Estadual são obrigatórios para CNPJ.',
          code: 'CNPJ_DADOS_OBRIGATORIOS',
        });
      }

      // ⚠️ `status` NÃO é editável aqui. Suspender/cancelar é ato do ADMIN da plataforma
      // (D3: suspensa bloqueia o login de todos) — se o gestor pudesse mexer, a empresa
      // inadimplente se reativaria sozinha.
      const dados = {
        nome,
        razaoSocial,
        nomeFantasia,
        documento,
        tipoDocumento,
        // `cnpj` LEGADO acompanha o documento — senão a empresa ocuparia DOIS documentos
        // na checagem de unicidade (o novo em `documento` e o antigo, órfão, em `cnpj`).
        // ⚠️ Só quando o documento É um CNPJ: aquela coluna também SINALIZA "empresa
        // pessoal" para `resolverEscopoConfiguracao` (cnpj presente = config da empresa;
        // null = config da equipe). Gravar um CPF ali trocaria o escopo e a clínica
        // pessoal abriria as Configurações sem o logo e o expediente que já tinha.
        cnpj:              tipoDocumento === 'CNPJ' ? documento : null,
        inscricaoEstadual,
        emailContato:      texto(b.emailContato, 255)?.toLowerCase() ?? null,
        telefone,
        whatsapp:          soDigitos(b.whatsapp).slice(0, 15) || null,
        cep,
        endereco,
        numero:            texto(b.numero, 20),
        complemento:       texto(b.complemento, 100),
        bairro,
        cidade,
        estado:            estadoUpper,
      };

      // ⚠️ Trocar CPF ↔ CNPJ (ou definir o documento pela 1ª vez) pode MOVER o escopo
      // da EmpresaConfiguracao (empresa × equipe — ver resolverEscopoConfiguracao).
      // Sem mover a linha junto, o que já foi configurado (logo, expediente, espécies)
      // ficaria órfão no escopo antigo e o gestor veria tudo em branco. Só migra
      // quando o TIPO efetivamente muda — setar o mesmo tipo de novo é no-op.
      const tipoAntigo = empresa.cnpj ? 'CNPJ' : (empresa.documento ? 'CPF' : null);
      const precisaMigrarEscopo = tipoAntigo && tipoAntigo !== tipoDocumento;

      await prisma.$transaction(async (tx) => {
        await tx.empresa.update({ where: { id: empresa.id }, data: dados });

        if (precisaMigrarEscopo) {
          const primeiraEquipe = await tx.equipe.findFirst({
            where: { empresaId: empresa.id }, orderBy: { id: 'asc' }, select: { id: true },
          });
          const equipeId    = primeiraEquipe?.id ?? null;
          const escopoAntigo = { empresaId: empresa.id, equipeId: tipoAntigo === 'CNPJ' ? null : equipeId };
          const escopoNovo   = { empresaId: empresa.id, equipeId: tipoDocumento === 'CNPJ' ? null : equipeId };

          const config = await tx.empresaConfiguracao.findFirst({ where: escopoAntigo });
          if (config) {
            const jaHaNoNovo = await tx.empresaConfiguracao.findFirst({ where: escopoNovo });
            if (jaHaNoNovo && jaHaNoNovo.id !== config.id) {
              // Já existe uma linha no escopo de destino (raro) — mantém a de destino,
              // descarta a antiga (evita violar o unique(empresaId, equipeId)).
              await tx.empresaConfiguracao.delete({ where: { id: config.id } });
            } else {
              await tx.empresaConfiguracao.update({ where: { id: config.id }, data: { equipeId: escopoNovo.equipeId } });
            }
          }
        }
      });

      res.json({ sucesso: true, mensagem: 'Cadastro da empresa atualizado.' });
    } catch (err) {
      // Rede de segurança do banco: o unique de `documento` e o unique(ownerId, nome,
      // cnpj) — este último pode disparar porque o `cnpj` legado passou a acompanhar
      // o documento. Sem tratar, o gestor receberia "Erro interno" para uma duplicata.
      if (err.code === 'P2002') {
        return res.status(409).json({
          sucesso:  false,
          mensagem: 'Este CPF/CNPJ já está cadastrado para outra empresa.',
          code:     'DOCUMENTO_DUPLICADO',
        });
      }
      console.error('Erro ao salvar cadastro da empresa:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── ADMIN da plataforma ────────────────────────────────────────────────────

  // GET /api/empresas/planos — catálogo, para o seletor
  listarPlanos: async (_req, res) => {
    try {
      const planos = await prisma.$queryRawUnsafe(
        `SELECT id, slug, nome, limite_usuarios AS "limiteUsuarios",
                limite_animais AS "limiteAnimais", preco_mensal AS "precoMensal"
           FROM schs2vet.tb_planos WHERE ativo = true ORDER BY ordem, nome`,
      );
      res.json({ sucesso: true, dados: planos });
    } catch (err) {
      console.error('Erro ao listar planos:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // PUT /api/empresas/:empresaId/assinatura — atribui plano e situação (ADMIN)
  salvarAssinatura: async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      const { planoId, status, limiteUsuariosOverride, observacao, statusEmpresa } = req.body ?? {};

      if (!Number.isInteger(empresaId)) return res.status(400).json({ sucesso: false, mensagem: 'Empresa inválida' });
      if (!Number.isInteger(Number(planoId))) return res.status(400).json({ sucesso: false, mensagem: 'Plano é obrigatório' });
      if (statusEmpresa && !STATUS_VALIDOS.includes(statusEmpresa)) {
        return res.status(400).json({ sucesso: false, mensagem: `Situação inválida. Use: ${STATUS_VALIDOS.join(', ')}` });
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO schs2vet.tb_assinaturas_empresa
           (empresa_id, plano_id, status, limite_usuarios_override, observacao, inicio_em, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3, 'TRIAL'), $4, $5, NOW(), NOW(), NOW())
         ON CONFLICT (empresa_id) DO UPDATE SET
           plano_id = EXCLUDED.plano_id,
           status   = EXCLUDED.status,
           limite_usuarios_override = EXCLUDED.limite_usuarios_override,
           observacao = EXCLUDED.observacao,
           updated_at = NOW()`,
        empresaId, Number(planoId), status ?? null,
        limiteUsuariosOverride != null ? Number(limiteUsuariosOverride) : null,
        texto(observacao, 500),
      );

      // ⚠️ Suspender é decisão SEPARADA da situação comercial: `tb_empresas.status` é
      // quem bloqueia o login (D3), e só muda se o ADMIN pedir explicitamente. Uma
      // fatura em atraso não tranca a clínica sozinha.
      if (statusEmpresa) {
        await prisma.empresa.update({
          where: { id: empresaId },
          data:  { status: statusEmpresa, canceladoEm: statusEmpresa === 'CANCELADA' ? new Date() : null },
        });
      }

      const uso = await usoDeAssentos(empresaId);
      res.json({ sucesso: true, mensagem: 'Assinatura atualizada.', dados: { uso } });
    } catch (err) {
      console.error('Erro ao salvar assinatura:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // GET /api/empresas/cnpj/:cnpj — proxy do auto-fill de CNPJ (BrasilAPI).
  //
  // POR QUÊ no backend: a chamada era feita direto do navegador
  // (`fetch('https://brasilapi.com.br/...')`), e passou a estourar
  // "blocked by CORS policy" no console. A BrasilAPI só garante o cabeçalho
  // Access-Control-Allow-Origin na resposta de SUCESSO — numa instabilidade dela (erro
  // 5xx, timeout, rate limit) o cabeçalho some, e o navegador reporta isso como bloqueio
  // de CORS mesmo o problema real sendo outro. Chamada servidor→servidor não tem CORS,
  // então o front nunca mais vê esse erro — só "não foi possível buscar os dados".
  buscarCnpj: async (req, res) => {
    const cnpj = String(req.params.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      return res.status(400).json({ sucesso: false, mensagem: 'CNPJ deve ter 14 dígitos.' });
    }
    try {
      const resposta = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 8000 });
      res.json({ sucesso: true, dados: resposta.data });
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(404).json({ sucesso: false, mensagem: 'CNPJ não encontrado.' });
      }
      console.error('Erro ao consultar CNPJ na BrasilAPI:', err.message);
      res.status(502).json({ sucesso: false, mensagem: 'Não foi possível consultar o CNPJ agora.' });
    }
  },
};
