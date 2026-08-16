// backend/src/controllers/CatalogoTipoServicoController.js
//
// Catálogo de "tipo de fornecedor" (categoria FORNECEDOR) e "tipo de serviço do
// prestador" (categoria PRESTADOR) — cresce por uso: o formulário oferece uma
// opção "+ Adicionar novo tipo"; o que a pessoa digita é gravado aqui e passa a
// ser oferecido nas próximas vezes, POR EMPRESA (TENANT DIRETO, mesma policy de
// tb_fornecedores/tb_prestadores — ver migration 20260825000000). Nenhuma
// leitura cross-tenant: cada empresa só vê/cria os PRÓPRIOS tipos.
//
// SQL CRU de propósito (não `prisma.catalogoTipoServico`): tabela nova, e no
// Windows o `prisma generate` falha sempre que o backend está rodando (CLAUDE.md
// §11) — o client tipado pode não conhecer o modelo ainda. `temTabela()` degrada
// com segurança (lista vazia / cria nada) até a migration+generate rodarem.
'use strict';

const prisma = require('../lib/prisma').default;
const { getNivelEfetivo, NIVEL_ORDINAL, resolverContextoPermissao } = require('../middlewares/permissao.middleware');

const CATEGORIAS_VALIDAS = ['FORNECEDOR', 'PRESTADOR'];
const SLUG_CRIAR = { FORNECEDOR: 'cadastro.fornecedor.criar', PRESTADOR: 'cadastro.prestador.criar' };
const normalizarTexto = v => (v ?? '').trim().toLowerCase();
const ehAdminPlataforma = req => req.user?.role === 'ADMIN' || req.user?.userType === 'ADMIN';

// Mesma cache de lib/usuarioAtivacao.js: positivo é definitivo, negativo expira
// em 60s (roda a migration com o backend no ar sem precisar de restart).
let _temTabela = null;
let _temTabelaEm = 0;
async function temTabela() {
  if (_temTabela === true) return true;
  if (_temTabela === false && Date.now() - _temTabelaEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_catalogo_tipo_servico' LIMIT 1`,
    );
    _temTabela = rows.length > 0;
  } catch { _temTabela = false; }
  _temTabelaEm = Date.now();
  return _temTabela;
}

const CatalogoTipoServicoController = {

  // GET /api/cadastro/tipos-servico?categoria=FORNECEDOR|PRESTADOR
  listar: async (req, res) => {
    try {
      const categoria = String(req.query.categoria ?? '').toUpperCase();
      if (!CATEGORIAS_VALIDAS.includes(categoria)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Categoria inválida' });
      }
      if (!(await temTabela())) return res.json({ sucesso: true, dados: [] });

      // RLS (tenant_tb_catalogo_tipo_servico) já filtra por empresa — a query só
      // precisa da categoria; o app_empresa_id() da sessão faz o resto.
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, categoria, nome, empresa_id AS "empresaId", criado_por_id AS "criadoPorId", created_at AS "createdAt"
           FROM schs2vet.tb_catalogo_tipo_servico
          WHERE categoria = $1
          ORDER BY nome ASC`,
        categoria,
      );
      res.json({ sucesso: true, dados: rows });
    } catch (err) {
      console.error('Erro ao listar catálogo de tipos:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar tipos' });
    }
  },

  // POST /api/cadastro/tipos-servico  { categoria, nome }
  // Mesmo gate de quem pode CRIAR o cadastro correspondente (fornecedor/prestador) —
  // ensinar um tipo novo ao catálogo é parte do mesmo ato de cadastrar.
  criar: async (req, res) => {
    try {
      const categoria = String(req.body?.categoria ?? '').toUpperCase();
      const nome = String(req.body?.nome ?? '').trim();
      if (!CATEGORIAS_VALIDAS.includes(categoria)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Categoria inválida' });
      }
      if (!nome) return res.status(400).json({ sucesso: false, mensagem: 'Informe o nome do tipo' });
      if (nome.length > 100) return res.status(400).json({ sucesso: false, mensagem: 'Nome muito longo (máx. 100 caracteres)' });
      if (!(await temTabela())) {
        return res.status(503).json({ sucesso: false, mensagem: 'Catálogo de tipos ainda não disponível — tente novamente em instantes.' });
      }

      const isAdminPlataforma = ehAdminPlataforma(req);
      if (!isAdminPlataforma) {
        await resolverContextoPermissao(req);
        const nivel = await getNivelEfetivo(req, SLUG_CRIAR[categoria]);
        if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
          return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão para cadastrar um novo tipo.' });
        }
      }

      const empresaAlvo = isAdminPlataforma && !req.empresaId ? null : (req.empresaId ?? null);
      if (empresaAlvo == null && !isAdminPlataforma) {
        return res.status(400).json({ sucesso: false, mensagem: 'Selecione uma empresa ativa para cadastrar um novo tipo.' });
      }

      // Idempotente: se o tipo já existe no escopo, devolve o existente em vez de
      // duplicar — é o comportamento esperado de um combobox "criável".
      const existentesRows = empresaAlvo == null
        ? await prisma.$queryRawUnsafe(
            `SELECT id, categoria, nome, empresa_id AS "empresaId", criado_por_id AS "criadoPorId", created_at AS "createdAt"
               FROM schs2vet.tb_catalogo_tipo_servico WHERE categoria = $1 AND empresa_id IS NULL`,
            categoria,
          )
        : await prisma.$queryRawUnsafe(
            `SELECT id, categoria, nome, empresa_id AS "empresaId", criado_por_id AS "criadoPorId", created_at AS "createdAt"
               FROM schs2vet.tb_catalogo_tipo_servico WHERE categoria = $1 AND empresa_id = $2`,
            categoria, Number(empresaAlvo),
          );
      const nomeNorm = normalizarTexto(nome);
      const dup = existentesRows.find(e => normalizarTexto(e.nome) === nomeNorm);
      if (dup) return res.json({ sucesso: true, dados: dup });

      const criadoRows = await prisma.$queryRawUnsafe(
        `INSERT INTO schs2vet.tb_catalogo_tipo_servico (categoria, nome, empresa_id, criado_por_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, categoria, nome, empresa_id AS "empresaId", criado_por_id AS "criadoPorId", created_at AS "createdAt"`,
        categoria, nome, empresaAlvo, req.user?.id ?? null,
      );
      res.status(201).json({ sucesso: true, dados: criadoRows[0] });
    } catch (err) {
      console.error('Erro ao criar tipo no catálogo:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar tipo' });
    }
  },
};

module.exports = CatalogoTipoServicoController;
