// backend/src/controllers/LocalizacaoAnimalController.js
'use strict';

const prisma = require('../lib/prisma').default;

// Mapeamento estático: tipoLocalizacao → espécies atendidas (null = TODOS)
const TIPO_ESPECIES = {
  CANIL:               ['Canino'],
  CENTRO_REPRODUCAO:   ['Equino', 'Canino', 'Felino', 'Bovino'],
  CENTRO_TREINAMENTO:  ['Equino', 'Canino', 'Felino', 'Bovino'],
  CLINICA:             null,
  CLUBE:               null,
  CLUBE_HIPICO:        ['Equino'],
  CRIADOR:             null,
  FAZENDA:             null,
  GATIL:               ['Felino'],
  HARAS:               ['Equino'],
  HOSPITAL:            null,
  HOTEL_ANIMAL:        ['Canino', 'Felino', 'Réptil'],
  ONG:                 null,
  OUTRO:               null,
  PETSHOP:             ['Canino', 'Felino', 'Réptil'],
  PROPRIETARIO:        null,
};

const TIPOS_VALIDOS = Object.keys(TIPO_ESPECIES);

const LocalizacaoAnimalController = {

  // GET /api/cadastro/localizacoes?busca=X&ativo=true|false|all&especie=Equino
  listar: async (req, res) => {
    try {
      const { busca, ativo, especie } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.OR = [
          { nome:              { contains: busca.trim(), mode: 'insensitive' } },
          { pessoaResponsavel: { contains: busca.trim(), mode: 'insensitive' } },
          { endereco:          { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:              { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      if (especie) {
        const tiposCompativeis = TIPOS_VALIDOS.filter(tipo => {
          const especies = TIPO_ESPECIES[tipo];
          return especies === null || especies.includes(especie);
        });
        where.tipoLocalizacao = { in: tiposCompativeis };
      }

      const localizacoes = await prisma.localizacaoAnimal.findMany({
        where,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      res.json({ sucesso: true, dados: localizacoes });
    } catch (err) {
      console.error('Erro ao listar localizações:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar localizações' });
    }
  },

  // GET /api/cadastro/localizacoes/tipos
  listarTipos: async (_req, res) => {
    const tipos = TIPOS_VALIDOS.map(tipo => ({
      value:   tipo,
      label:   tipo.replace(/_/g, ' '),
      especies: TIPO_ESPECIES[tipo] ?? ['TODOS'],
    }));
    res.json({ sucesso: true, dados: tipos });
  },

  // GET /api/cadastro/localizacoes/:id
  obterPorId: async (req, res) => {
    try {
      const loc = await prisma.localizacaoAnimal.findUnique({
        where: { id: Number(req.params.id) },
      });
      if (!loc) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      res.json({ sucesso: true, dados: loc });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar localização' });
    }
  },

  // POST /api/cadastro/localizacoes
  // ADMIN cria com tipoEntrada=SYSTEM; demais criam com tipoEntrada=CLIENTE
  criar: async (req, res) => {
    const { nome, cnpj, cep, endereco, pessoaResponsavel, telefone, tipoLocalizacao } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!tipoLocalizacao || !TIPOS_VALIDOS.includes(tipoLocalizacao))
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de localização inválido' });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';

    try {
      const duplicado = await prisma.localizacaoAnimal.findFirst({
        where: { nome: { equals: nome.trim(), mode: 'insensitive' } },
      });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });

      const loc = await prisma.localizacaoAnimal.create({
        data: {
          nome:              nome.trim(),
          cnpj:              cnpj?.replace(/\D/g, '') || null,
          cep:               cep?.replace(/\D/g, '')  || null,
          endereco:          endereco?.trim()          || null,
          pessoaResponsavel: pessoaResponsavel?.trim() || null,
          telefone:          telefone?.trim()          || null,
          tipoLocalizacao,
          tipoEntrada,
        },
      });
      res.status(201).json({ sucesso: true, dados: loc });
    } catch (err) {
      if (err.code === 'P2002')
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });
      console.error('Erro ao criar localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar localização' });
    }
  },

  // PUT /api/cadastro/localizacoes/:id — apenas ADMIN
  atualizar: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode editar localizações diretamente' });

    const { id } = req.params;
    const { nome, cnpj, cep, endereco, pessoaResponsavel, telefone, tipoLocalizacao } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (tipoLocalizacao && !TIPOS_VALIDOS.includes(tipoLocalizacao))
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de localização inválido' });

    try {
      const existe = await prisma.localizacaoAnimal.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });

      const duplicado = await prisma.localizacaoAnimal.findFirst({
        where: { nome: { equals: nome.trim(), mode: 'insensitive' }, id: { not: Number(id) } },
      });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });

      const loc = await prisma.localizacaoAnimal.update({
        where: { id: Number(id) },
        data: {
          nome:              nome.trim(),
          cnpj:              cnpj?.replace(/\D/g, '') || null,
          cep:               cep?.replace(/\D/g, '')  || null,
          endereco:          endereco?.trim()          || null,
          pessoaResponsavel: pessoaResponsavel?.trim() || null,
          telefone:          telefone?.trim()          || null,
          ...(tipoLocalizacao && { tipoLocalizacao }),
        },
      });
      res.json({ sucesso: true, dados: loc });
    } catch (err) {
      if (err.code === 'P2002')
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      console.error('Erro ao atualizar localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar localização' });
    }
  },

  // PATCH /api/cadastro/localizacoes/:id/toggle — apenas ADMIN
  toggleAtivo: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode ativar/inativar localizações' });

    const { id } = req.params;
    try {
      const existe = await prisma.localizacaoAnimal.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });

      const loc = await prisma.localizacaoAnimal.update({
        where: { id: Number(id) },
        data: { ativo: !existe.ativo },
      });
      res.json({
        sucesso: true,
        dados: loc,
        mensagem: `Localização ${loc.ativo ? 'ativada' : 'inativada'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status da localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = LocalizacaoAnimalController;
module.exports.TIPO_ESPECIES = TIPO_ESPECIES;
module.exports.TIPOS_VALIDOS = TIPOS_VALIDOS;
