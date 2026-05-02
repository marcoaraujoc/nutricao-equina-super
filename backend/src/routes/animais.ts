import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import * as animalCtrl from '../controllers/AnimalController.js';

const router = Router();

router.use(authenticate);   // ← Proteção

router.get('/', animalCtrl.listar);
router.post('/', animalCtrl.criar);

export default router;