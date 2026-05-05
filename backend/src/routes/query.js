const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

router.post('/adhoc', async (req, res) => {
  console.log('🔥 [ADHOC] Requisição recebida!');
  console.log('📦 Body recebido:', req.body);

  const { query } = req.body;

  if (!query) {
    console.log('❌ Nenhuma query enviada');
    return res.status(400).json({ error: 'Query não informada' });
  }

  console.log('📝 Query a executar:', query);

  try {
    const result = await prisma.$queryRawUnsafe(query);
    console.log('✅ Query executada com sucesso. Linhas:', Array.isArray(result) ? result.length : 1);

    const serialized = JSON.parse(JSON.stringify(result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));

    res.json({
      success: true,
      rowCount: Array.isArray(serialized) ? serialized.length : 1,
      data: serialized
    });
  } catch (error) {
    console.error('❌ ERRO ao executar query:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
});

module.exports = router;