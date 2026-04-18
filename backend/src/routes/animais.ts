import { Router } from 'express';
import { AnimalController } from '../controllers/AnimalController';

const router = Router();
const controller = new AnimalController();

router.get('/', controller.listar);
router.post('/', controller.criar);

export default router;
