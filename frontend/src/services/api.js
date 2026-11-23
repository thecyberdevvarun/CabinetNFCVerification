import axios from 'axios';

// Browser/laptop: relative URL, the Node backend (or Vite proxy) handles it.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 15000 });

// Android app: the APK saves directly to SQL Server and answers through window.__onNativeSaveResult.
const pending = new Map();
let sequence = 0;
if (typeof window !== 'undefined') {
  window.__onNativeSaveResult = (id, result) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (result?.success) request.resolve(result);
    else request.reject({ response: { data: result } });
  };
}

const hasNativeSave = () => typeof window !== 'undefined' && typeof window.AndroidNfc?.saveCabinet === 'function';

export async function saveCabinet(payload) {
  if (hasNativeSave()) {
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      pending.set(id, { resolve, reject });
      window.AndroidNfc.saveCabinet(id, JSON.stringify(payload));
      setTimeout(() => {
        if (pending.delete(id)) reject({ response: { data: { message: 'Save timed out. Check the database connection and retry.' } } });
      }, 30000);
    });
  }
  const response = await api.post('/cabinet-scans', payload);
  return response.data;
}