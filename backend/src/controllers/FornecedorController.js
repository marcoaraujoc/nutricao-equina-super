// backend/src/controllers/FornecedorController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');
const { registrarAtivacao, registrarInativacao, anexarTrilha } = require('../lib/cadastroAtivacao');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');
const { definirAtivoNaEmpresa } = require('../lib/usuarioEmpresa');

// Whitelist fixa SAIU (2026-08-25) — o tipo de fornecedor agora vem do catálogo
// tenant-scoped (tb_catalogo_tipo_servico, CatalogoTipoServicoController), que
// cresce por uso. Validação aqui é só "não vazio, tamanho razoável" — quem
// decide QUAIS tipos aparecem no formulário é o catálogo, não este arquivo.

const normalizarDigitos = v => (v ?? '').replace(/\D/g, '');
const normalizarTexto   = v => (v ?? '').trim().toLowerCase();
const normalizarTipos   = v => (v ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|');

// Resolve as especialidades (catálogo por espécie) enviadas pelo cadastro.
// Retorna { ids, tipoServico } — tipoServico (VARCHAR 50, legado) recebe o nome da
// 1ª especialidade para compatibilidade com quem lê Fornecedor.tipoServico (ex.: encaminhamento).
async function resolverEspecialidades(especialidadeIds) {
  if (!Array.isArray(especialidadeIds) || especialidadeIds.length === 0) return null;
  const ids = [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger);
  if (ids.length === 0) return { ids: [], tipoServico: null };
  const especialidades = await prisma.especialidade.findMany({
    where: { id: { in: ids }, ativo: true },
    select: { id: true, nome: true },
  });
  const validos = especialidades.map(e => e.id);
  const tipoServico = especialidades[0]?.nome?.slice(0, 50) ?? null;
  return { ids: validos, tipoServico };
}

// ─── Helper: verifica duplicidade por CPF ou por nome+tipoServico+telefone ────
// Escopo: mesma visibilidade da listagem (empresaId null = global/SYSTEM, OU empresa alvo)
// excludeId: ignora o próprio registro (usado no update)
// Retorna: { tipo, ativo: boolean, fornecedor } — ativo=true bloqueia; ativo=false avisa (force bypass)
async function verificarDuplicidade({ cpf, nome, tipoServico, telefone, empresaId, excludeId = null }) {
  const candidatos = await prisma.fornecedor.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ empresaId: null }, { empresaId: empresaId ?? -1 }],
    },
  });

  const cpfNum = normalizarDigitos(cpf);
  if (cpfNum) {
    const dupAtivo   = candidatos.find(c =>  c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    const dupInativo = candidatos.find(c => !c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    if (dupAtivo)   return { tipo: 'cpf', ativo: true,  fornecedor: dupAtivo };
    if (dupInativo) return { tipo: 'cpf', ativo: false, fornecedor: dupInativo };
  }

  const nomeNorm = normalizarTexto(nome);
  const tipoNorm = normalizarTipos(tipoServico);
  const telNum   = normalizarDigitos(telefone);
  if (nomeNorm && tipoNorm && telNum) {
    const match = c =>
      normalizarTexto(c.nome) === nomeNorm &&
      normalizarTipos(c.tipoServico) === tipoNorm &&
      normalizarDigitos(c.telefone) === telNum;
    const dupAtivo   = candidatos.find(c =>  c.ativo && match(c));
    const dupInativo = candidatos.find(c => !c.ativo && match(c));
    if (dupAtivo)   return { tipo: 'combo', ativo: true,  fornecedor: dupAtivo };
    if (dupInativo) return { tipo: 'combo', ativo: false, fornecedor: dupInativo };
  }

  return null;
}

const MSG_DUPLICADO = {
  cpf:   'Já existe um fornecedor cadastrado com este CPF.',
  combo: 'Já existe um fornecedor cadastrado com o mesmo nome, tipo de serviço e telefone.',
};

function buildMensagemInativo(tipo, f) {
  if (tipo === 'cpf') {
    return `Já existe o fornecedor "${f.nome}" com o CPF ${f.cpf ?? f.cnpj} (inativo).`;
  }
  const contato = [
    f.telefone ? `telefone ${f.telefone}` : null,
    f.email    ? `e-mail ${f.email}`      : null,
  ].filter(Boolean).join(' e ');
  return `Fornecedor "${f.nome}" com ${contato} já existe (inativo).`;
}

const FornecedorController = {

  // GET /api/cadastro/fornecedores?busca=X&ativo=true|false|all
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      // Escopo por empresa/equipe: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
      // + fornecedores da empresa ativa, segregados pela equipe do contexto (igual Animal)
      if (req.user?.role !== 'ADMIN') {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND = [{
          OR: [
            { empresaId: null },
            { empresaId: req.empresaId ?? -1, equipeId: null },
            ...(equipeScope
              ? [{ empresaId: req.empresaId ?? -1, equipeId: { in: equipeScope } }]
              : [{ empresaId: req.empresaId ?? -1 }]),
          ],
        }];
      }

      if (busca?.trim()) {
        where.OR = [
          { nome:     { contains: busca.trim(), mode: 'insensitive' } },
          { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
          { telefone: { contains: busca.trim(), mode: 'insensitive' } },
          { email:    { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      const fornecedores = await prisma.fornecedor.findMany({
        where,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      res.json({ sucesso: true, dados: await anexarTrilha(fornecedores, 'fornecedor') });
    } catch (err) {
      console.error('Erro ao listar fornecedores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar fornecedores' });
    }
  },

  // GET /api/cadastro/fornecedores/tipos — LEGADO: os tipos hoje vêm do catálogo
  // tenant-scoped (GET /api/cadastro/tipos-servico?categoria=FORNECEDOR).
  // Mantido só para não quebrar chamador antigo; devolve lista vazia.
  listarTipos: async (req, res) => {
    res.json({ sucesso: true, dados: [] });
  },

  // GET /api/cadastro/fornecedores/:id
  obterPorId: async (req, res) => {
    try {
      const fornecedor = await prisma.fornecedor.findUnique({
        where: { id: Number(req.params.id) },
        include: { especialidades: { select: { especialidadeId: true } } },
      });
      if (!fornecedor) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      const { especialidades, ...dados } = fornecedor;
      res.json({ sucesso: true, dados: { ...dados, especialidadeIds: especialidades.map(e => e.especialidadeId) } });
    } catch {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar fornecedor' });
    }
  },

  // POST /api/cadastro/fornecedores
  // ADMIN → tipoEntrada=SYSTEM; demais → tipoEntrada=CLIENTE
  criar: async (req, res) => {
    const {
      nome, cpf, cnpj, telefone, email, tipoServico, especialidadeIds,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });

    // Especialidades do catálogo (legado, só quem ainda envia especialidadeIds) têm
    // precedência; tipoServico (do catálogo tenant-scoped de tipos, ou digitado como
    // novo) é o caminho padrão desde que "Veterinário" saiu do tipo de fornecedor.
    const espec = await resolverEspecialidades(especialidadeIds);
    let tipoServicoFinal;
    if (espec && espec.ids.length > 0) {
      tipoServicoFinal = espec.tipoServico;
    } else {
      if (!tipoServico?.trim())
        return res.status(400).json({ sucesso: false, mensagem: 'Selecione o tipo de fornecedor' });
      if (tipoServico.trim().length > 50)
        return res.status(400).json({ sucesso: false, mensagem: 'Tipo de fornecedor muito longo (máx. 50 caracteres)' });
      tipoServicoFinal = tipoServico.trim();
    }

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;

    try {
      const dup = await verificarDuplicidade({ cpf, nome, tipoServico: tipoServicoFinal, telefone, empresaId: empresaAlvo });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.fornecedor),
          fornecedor: dup.fornecedor,
        });
      }

      const fornecedor = await prisma.fornecedor.create({
        data: {
          // SYSTEM é global; CLIENTE pertence à empresa/equipe ativa do criador
          empresaId:   empresaAlvo,
          equipeId:    equipeAlvo,
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email?.trim() ? email.trim().toLowerCase() : null,
          tipoServico: tipoServicoFinal,
          tipoEntrada,
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
        },
      });

      if (espec && espec.ids.length > 0) {
        await prisma.fornecedorEspecialidade.createMany({
          data: espec.ids.map(especialidadeId => ({ fornecedorId: fornecedor.id, especialidadeId })),
          skipDuplicates: true,
        });
      }

      // Fornecedor nasce ativo=true (default do schema): grava a trilha de ativação
      // também na CRIAÇÃO, senão "Ativado em/por" fica vazio até alguém desativar
      // e reativar o registro.
      await registrarAtivacao(prisma, 'fornecedor', fornecedor.id, req.user.id);

      await registrarAuditoria(prisma, req, {
        categoria:  'CRIACAO',
        entidade:   'FORNECEDOR',
        entidadeId: fornecedor.id,
        detalhes:   `${fornecedor.nome} — ${fornecedor.tipoServico}`,
      });

      res.status(201).json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      console.error('Erro ao criar fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar fornecedor' });
    }
  },

  // PUT /api/cadastro/fornecedores/:id — escopado por empresa/equipe (checkPermission na rota)
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      nome, cpf, cnpj, telefone, email, tipoServico, especialidadeIds,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });

    // Especialidades do catálogo (legado) têm precedência; tipoServico é o caminho padrão.
    const espec = await resolverEspecialidades(especialidadeIds);
    if (!espec && tipoServico && tipoServico.trim().length > 50) {
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de fornecedor muito longo (máx. 50 caracteres)' });
    }

    try {
      const existe = await prisma.fornecedor.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este fornecedor.' });

      const tipoServicoFinal = (espec && espec.ids.length > 0)
        ? espec.tipoServico
        : (tipoServico?.trim() || existe.tipoServico);

      const dup = await verificarDuplicidade({
        cpf, nome, telefone,
        tipoServico: tipoServicoFinal,
        empresaId:   existe.empresaId,
        excludeId:   Number(id),
      });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.fornecedor),
          fornecedor: dup.fornecedor,
        });
      }

      const fornecedor = await prisma.fornecedor.update({
        where: { id: Number(id) },
        data: {
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email?.trim() ? email.trim().toLowerCase() : null,
          tipoServico: tipoServicoFinal,
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
        },
      });

      // Recria os vínculos de especialidade quando enviados (delete + insert).
      if (espec) {
        await prisma.fornecedorEspecialidade.deleteMany({ where: { fornecedorId: fornecedor.id } });
        if (espec.ids.length > 0) {
          await prisma.fornecedorEspecialidade.createMany({
            data: espec.ids.map(especialidadeId => ({ fornecedorId: fornecedor.id, especialidadeId })),
            skipDuplicates: true,
          });
        }
      } else if (Array.isArray(especialidadeIds)) {
        // Array VAZIO enviado explicitamente (ex.: trocou para tipo não-veterinário) —
        // remove os vínculos de especialidade antigos
        await prisma.fornecedorEspecialidade.deleteMany({ where: { fornecedorId: fornecedor.id } });
      }

      await registrarAlteracao(prisma, req, {
        entidade:   'FORNECEDOR',
        entidadeId: Number(id),
        campos: {
          'nome':               { de: existe.nome,        para: fornecedor.nome },
          'CPF':                { de: existe.cpf,         para: fornecedor.cpf },
          'CNPJ':               { de: existe.cnpj,        para: fornecedor.cnpj },
          'telefone':           { de: existe.telefone,    para: fornecedor.telefone },
          'e-mail':             { de: existe.email,       para: fornecedor.email },
          'tipo de fornecedor': { de: existe.tipoServico, para: fornecedor.tipoServico },
          'CEP':                { de: existe.cep,         para: fornecedor.cep },
          'endereço':           { de: existe.endereco,    para: fornecedor.endereco },
          'complemento':        { de: existe.complemento, para: fornecedor.complemento },
          'bairro':             { de: existe.bairro,      para: fornecedor.bairro },
          'cidade':             { de: existe.cidade,      para: fornecedor.cidade },
          'estado':             { de: existe.estado,      para: fornecedor.estado },
        },
      });

      res.json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      console.error('Erro ao atualizar fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar fornecedor' });
    }
  },

  // PATCH /api/cadastro/fornecedores/:id/toggle — escopado por empresa/equipe (checkPermission na rota)
  toggleAtivo: async (req, res) => {
    try {
      const { motivo } = req.body ?? {};
      const existe = await prisma.fornecedor.findUnique({ where: { id: Number(req.params.id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este fornecedor.' });

      const vaiInativar = existe.ativo;

      // Justificativa obrigatória só para INATIVAR — ativar não pede motivo.
      if (vaiInativar && !motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da inativação' });
      }

      if (vaiInativar) {
        await registrarInativacao(prisma, 'fornecedor', existe.id, req.user.id, motivo.trim());
      } else {
        await registrarAtivacao(prisma, 'fornecedor', existe.id, req.user.id);
      }

      // 🔴 O FORNECEDOR COM LOGIN PERDE (E RECUPERA) O ACESSO À EMPRESA JUNTO
      // (2026-09-04, a pedido: "o fornecedor que for desativado não poderá mais
      // acessar os dados da empresa"). Até aqui o toggle mexia só em
      // `tb_fornecedores.ativo` — o cadastro sumia da lista, mas o vínculo de
      // `tb_usuario_empresa` continuava valendo e ele seguia entrando na clínica e
      // enxergando os pacientes designados a ele.
      // ⚠️ Vale SÓ para o cadastro ligado a um login (`Fornecedor.userId`): fornecedor
      // que é só um cadastro de compras não tem acesso nenhum a tirar.
      // ⚠️ O que ele JÁ FEZ na empresa não é tocado — encaminhamento, exame e
      // designação continuam como estão, e é assim que o histórico se mantém íntegro.
      //   A designação inativa sozinha quando o encaminhamento é concluído; inativá-la
      //   aqui reescreveria registro clínico por causa de uma mudança de cadastro.
      if (existe.userId && existe.empresaId) {
        await definirAtivoNaEmpresa(prisma, existe.userId, existe.empresaId, !vaiInativar);
      }

      // Mesma auditoria de Equipe (lib/auditoria.js) — quem foi (in)ativado, quando
      // (timestamp da própria linha) e quem fez (userId/userName/email da linha).
      await registrarAuditoria(prisma, req, {
        // A categoria diz O QUE ACONTECEU: (in)ativar um cadastro não é a mesma
        // coisa que editar um campo dele, e ALTERACAO misturava os dois.
        categoria: vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
        entidade:  'FORNECEDOR',
        entidadeId: existe.id,
        motivo:    vaiInativar ? motivo.trim() : null,
        detalhes:  `${req.user.fullName ?? req.user.email} ${vaiInativar ? 'inativou' : 'ativou'} o fornecedor ${existe.nome}`,
      });

      const fornecedorAtualizado = await prisma.fornecedor.findUnique({ where: { id: existe.id } });
      const [comTrilha] = await anexarTrilha([fornecedorAtualizado], 'fornecedor');
      res.json({
        sucesso:  true,
        dados:    comTrilha,
        mensagem: vaiInativar ? 'Fornecedor inativado' : 'Fornecedor ativado',
      });
    } catch (err) {
      console.error('Erro ao alternar status do fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = FornecedorController;
