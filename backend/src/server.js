import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import cabinetRoutes from './routes/cabinetRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getPool } from './config/db.js';

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '20kb' }));
app.get('/api/health', async (req, res, next) => {
  try { await getPool(); res.json({ success: true, api: 'online', database: 'connected' }); }
  catch (error) { next(error); }
});
app.use('/api/cabinet-scans', cabinetRoutes);
// Serve the built web app (frontend/dist) so the server PC and the Android app need only one address.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}
app.use(errorHandler);
const port = Number(process.env.PORT || 5000);
app.listen(port, '0.0.0.0', () => console.log(`Cabinet Validation API running on port ${port}`));
