// routes/relatorio.routes.ts
import { Router } from 'express';
import { RelatorioController } from '../controllers/relatorio.controller';

const router = Router();
const controller = new RelatorioController();

router.get('/paty/:animalId', controller.relatorioPaty);

export default router;