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
const { ehFalhaTransitoria } = require('../ai/retentativa');

/**
 * O motivo que vai À TELA, a partir da falha real.
 *
 * 🔴 A MENSAGEM ÚNICA MENTIA SOBRE A CAUSA (2026-09-19). Toda falha saía como
 * "confira se a foto/PDF está legível" — inclusive o `Gemini API error 503: high
 * demand`, que foi o que aconteceu de verdade (log de IA id 517). A pessoa tinha um
 * cupom perfeitamente legível na mão, já lido com sucesso sete minutos antes, e a
 * tela mandava ela desconfiar da foto: refotografar, recortar, trocar o arquivo —
 * tudo sobre o que estava certo, enquanto a ação útil era esperar um minuto.
 * ⚠️ Mensagem que aponta a causa errada é pior que mensagem genérica: ela não só
 * deixa de ajudar, ela MANDA trabalhar no lugar errado.
 * ⚠️ O texto cru do provedor não vai à tela ("fetch failed", dump de JSON): ele não
 * diz o que fazer. O detalhe fica no log, que é onde se investiga (lição de
 * 2026-09-01, `documentoConversaoService`).
 */
function motivoDaFalha(err) {
  if (ehFalhaTransitoria(err)) {
    return 'O serviço de leitura automática está sobrecarregado neste momento — '
         + 'não é problema do seu documento. Aguarde alguns instantes e tente de novo.';
  }
  return 'Não foi possível ler o documento enviado. Confira se a foto/PDF está legível e tente de novo.';
}

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

// ⚠️ DUAS ROTAS, UM CONTROLLER — não duplicar ao acrescentar uma terceira tela:
//   POST /api/farmacia/estoque/documento-compra   (gate farmacia.estoque.criar)
//   POST /api/vacinas/estoque/documento-compra    (gate vacina.estoque.criar)
// Só o GATE difere; o que muda na tela é `tipoItem`, resolvido no front. Duas leituras
// divergiriam na primeira correção (armadilha 28-g).
// Histórico: nasceu em `/cadastro/produtos/nota-fiscal`, foi desmontada em 2026-09-15
// (a tela de Produtos passou a cadastrar o ITEM, não a compra) e remontada na Farmácia
// em 2026-09-18 — o controller ficou inteiro de propósito, e a volta custou uma linha.
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
        // ⚠️ O motivo aparece NA TELA e precisa dizer o que a pessoa pode fazer —
        // "tente de novo" e "troque a foto" são ações DIFERENTES, e mandar a errada
        // custa o trabalho de refazer um documento que estava certo. Ver
        // `motivoDaFalha` acima. O detalhe técnico fica no log, que é onde se investiga.
        dados: { ehNotaFiscal: false, motivo: motivoDaFalha(err) },
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
