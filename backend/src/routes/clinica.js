const multer = require('multer');
const upload = multer({ dest: 'uploads/audio_tmp/' });
const EvolucaoController = require('../controllers/EvolucaoController');

router.get('/evolucoes/responsaveis/:animalId', authenticate, EvolucaoController.listarResponsaveis);
router.get('/evolucoes/animal/:animalId',        authenticate, EvolucaoController.listarPorAnimal);
router.get('/evolucoes/:id',                     authenticate, EvolucaoController.obterPorId);
router.post('/evolucoes/interpretar',            authenticate, EvolucaoController.interpretar);
router.post('/evolucoes/transcrever',            authenticate, upload.single('audio'), EvolucaoController.transcrever);
router.post('/evolucoes',                        authenticate, EvolucaoController.criar);
router.put('/evolucoes/:id',                     authenticate, EvolucaoController.atualizar);
router.patch('/evolucoes/:id/aprovar',           authenticate, EvolucaoController.aprovar);
router.delete('/evolucoes/:id',                  authenticate, EvolucaoController.excluir);