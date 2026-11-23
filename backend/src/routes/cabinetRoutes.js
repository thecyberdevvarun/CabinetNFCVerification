import { Router } from 'express';
import { createCabinetScan } from '../controllers/cabinetController.js';
const router = Router();
router.post('/', createCabinetScan);
export default router;
