'use strict';
/**
 * LEITURA DE NOTA FISCAL na tela de Produtos (2026-09-10)
 *
 * 🔴 NÃO GRAVA NADA. Devolve o que leu; quem cadastra é o `POST /cadastro/produtos`
 * de sempre, depois de a pessoa conferir na tela. É isso que permite mostrar o
 * resultado antes de comprometer o cadastro — e que faz uma leitura errada custar uma
 * correção de campo, não um produto errado no catálogo.
 *
 * 🔴 FALHA NÃO É ERRO DE TELA. Arquivo que não é nota, JSON inválido ou IA fora do ar
 * respondem **200** com `ehNotaFiscal: false` e o motivo — a tela avisa e o cadastro
 * segue manual, que é o comportamento de sempre e nunca falha. Perder o cadastro
 * inteiro por causa de um 500 do modelo seria trocar "digitar os campos" por "não
 * conseguir cadastrar".
 *
 * ⚠️ O ÚNICO erro propagado é o **429 de QUOTA** (`IA_QUOTA_EXCEDIDA`): é decisão do
 * plano do cliente e precisa ser dita. Como este controller tem try/catch próprio,
 * ele é repassado com `next(err)` — engolir daria 500 genérico (§7).
 */

const prisma = require('../lib/prisma').default;
const notaFiscalService = require('../services/notaFiscalService');

/**
 * O fornecedor lido na nota JÁ existe nesta empresa?
 *
 * ⚠️ Casa por CNPJ/CPF primeiro (é a identidade fiscal, e não muda com o nome
 * fantasia) e só então pelo NOME, sem acento nem caixa. Casar só pelo nome faria
 * "Distribuidora Vet" e "DISTRIBUIDORA VET LTDA" virarem dois cadastros do mesmo
 * fornecedor; casar só pelo documento perderia o cadastro antigo que nunca teve CNPJ
 * preenchido — e a base tem vários.
 */
async function acharFornecedor(empresaId, { cnpj, cpf, nome }) {
  const doc = cnpj || cpf;
  const escopo = { ativo: true, OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] };

  if (doc) {
    // O cadastro guarda o documento COM máscara em parte da base e sem em outra, então
    // a comparação é feita sobre os dígitos dos dois lados.
    const porDoc = await prisma.$queryRawUnsafe(
      `SELECT id, nome, cnpj, cpf, telefone, email, tipo_servico AS "tipoServico"
         FROM schs2vet.tb_fornecedores
        WHERE ativo = true
          AND (empresa_id IS NULL OR empresa_id = $2)
          AND (regexp_replace(COALESCE(cnpj, ''), '\\D', '', 'g') = $1
            OR regexp_replace(COALESCE(cpf,  ''), '\\D', '', 'g') = $1)
        LIMIT 1`,
      String(doc), empresaId ? Number(empresaId) : -1,
    ).catch(() => []);
    if (porDoc.length > 0) return porDoc[0];
  }

  if (nome) {
    const porNome = await prisma.fornecedor.findFirst({
      where:  { ...escopo, nome: { equals: nome, mode: 'insensitive' } },
      select: { id: true, nome: true, cnpj: true, cpf: true, telefone: true, email: true, tipoServico: true },
    });
    if (porNome) return porNome;
  }
  return null;
}

// POST /api/cadastro/produtos/nota-fiscal  (multipart: paginas[] + texto)
const ler = async (req, res, next) => {
  try {
    const paginas = (req.files ?? []).map(f => ({ buffer: f.buffer, mimetype: f.mimetype }));
    if (paginas.length === 0) {
      return res.json({ dados: { ehNotaFiscal: false, motivo: 'Nenhuma página foi enviada.' } });
    }

    let lido;
    try {
      lido = await notaFiscalService.ler(req, { paginas, texto: req.body?.texto ?? '' });
    } catch (err) {
      // Quota é decisão do plano — sobe para o error handler virar 429.
      if (err.code === 'IA_QUOTA_EXCEDIDA') return next(err);
      // Todo o resto vira "não consegui ler", com o motivo VISÍVEL: cair no cadastro
      // manual é aceitável; cair sem saber por quê, não (lição de 2026-09-01).
      console.error('NotaFiscalController.ler:', err);
      return res.json({
        dados: { ehNotaFiscal: false, motivo: err.message || 'Não foi possível ler a nota.' },
      });
    }

    if (!lido.ehNotaFiscal) return res.json({ dados: lido });

    // O fornecedor da nota já está cadastrado? A resposta decide o que a tela faz:
    // achado, ela o pré-seleciona; não achado, ela leva ao cadastro de fornecedor com
    // o que a nota trouxe já preenchido — que é o pedido de 2026-09-10.
    const existente = await acharFornecedor(req.empresaId, lido.fornecedor ?? {});

    return res.json({
      dados: {
        ...lido,
        fornecedorExistente: existente
          ? { id: existente.id, nome: existente.nome, tipoServico: existente.tipoServico ?? null }
          : null,
      },
    });
  } catch (err) {
    console.error('NotaFiscalController.ler (inesperado):', err);
    return res.status(500).json({ error: 'Erro ao ler a nota fiscal.' });
  }
};

module.exports = { ler };
