import axios from 'axios';
// Relative URL: the Vite server proxies /api to the backend, so the tablet only talks to one HTTPS origin.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 15000 });
export async function saveCabinet(payload) {
  const response = await api.post('/cabinet-scans', payload);
  return response.data;
}
