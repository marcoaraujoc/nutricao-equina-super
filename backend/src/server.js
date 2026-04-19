const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Rotas
app.use('/auth', require('./routes/auth'));
app.use('/animais', require('./routes/animais'));
app.use('/produtos', require('./routes/produtos'));
app.use('/dietas', require('./routes/dietas'));
app.use('/exames', require('./routes/exames'));
app.use('/analise', require('./routes/analise'));
app.use('/audit', require('./routes/audit'));
app.use('/api/especies', require('./routes/especies'));
app.use('/api/racas', require('./routes/racas'));

app.get('/', (req, res) => res.json({ message: '🚀 API Equine Nutrition - Super está rodando!' }));

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
