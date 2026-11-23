import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Web NFC only works on HTTPS pages, so serve over HTTPS and proxy the API through the same origin.
const proxy = { '/api': { target: process.env.API_TARGET || 'http://localhost:5000', changeOrigin: true } };

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: { host: true, port: 5173, proxy },
  preview: { host: true, port: 5173, proxy }
});
