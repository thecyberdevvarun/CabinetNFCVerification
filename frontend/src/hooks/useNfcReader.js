import { useCallback, useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 1500; // a held tag fires repeated reads; ignore the same card within this window

// Inside the Android APK the app exposes window.AndroidNfc (native reader). Otherwise use Chrome's Web NFC.
const hasNative = () => typeof window !== 'undefined' && !!window.AndroidNfc;

function getSupport() {
  if (hasNative()) return { ok: true };
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  if (typeof window === 'undefined' || !('NDEFReader' in window)) {
    return { ok: false, message: secure === false
      ? 'NFC needs a secure (HTTPS) connection, or use the Cabinet Validation Android app.'
      : 'This browser cannot read NFC tags. Use the Cabinet Validation Android app or Chrome on the Zebra TC22.' };
  }
  if (!secure) return { ok: false, message: 'NFC needs a secure (HTTPS) connection, or use the Cabinet Validation Android app.' };
  return { ok: true };
}

// Reads the 20-digit serial from the tag's NDEF message (same data the Python reader extracts).
function extractSerial(message) {
  for (const record of message?.records ?? []) {
    if (!record.data) continue;
    try {
      const text = new TextDecoder(record.encoding || 'utf-8').decode(record.data);
      const match = text.match(/\d{20}/);
      if (match) return match[0];
    } catch { /* try next record */ }
  }
  return null;
}

function friendlyError(error) {
  if (error?.name === 'NotAllowedError') return 'NFC permission was denied. Allow NFC for this site in Chrome, then tap Retry.';
  if (error?.name === 'NotSupportedError') return 'NFC is switched off or not available. Turn NFC on in Android settings, then tap Retry.';
  return error?.message || 'Unable to start the NFC reader.';
}

export function useNfcReader({ onTag }) {
  const support = getSupport();
  const [state, setState] = useState(support.ok ? 'idle' : 'unsupported');
  const [error, setError] = useState(support.ok ? '' : support.message);
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;
  const controllerRef = useRef(null);
  const lastRef = useRef({ uid: '', time: 0 });

  const deliver = useCallback((uid, serial) => {
    const now = Date.now();
    if (uid && uid === lastRef.current.uid && now - lastRef.current.time < DEBOUNCE_MS) return;
    lastRef.current = { uid, time: now };
    onTagRef.current({ uid, serial });
  }, []);

  const startNative = useCallback(() => {
    try {
      if (!window.AndroidNfc.isAvailable()) { setState('unsupported'); setError('This device has no NFC reader.'); return; }
      if (window.AndroidNfc.isEnabled()) { setState('active'); setError(''); }
      else { setState('error'); setError('NFC is switched off. Turn on NFC in Android settings, then tap Retry.'); }
    } catch (err) {
      setState('error'); setError(err?.message || 'Unable to start the NFC reader.');
    }
  }, []);

  const start = useCallback(async () => {
    if (hasNative()) { startNative(); return; }
    if (!getSupport().ok) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('starting');
    setError('');
    try {
      const reader = new window.NDEFReader();
      reader.onreading = event => deliver((event.serialNumber || '').toUpperCase(), extractSerial(event.message));
      reader.onreadingerror = () => onTagRef.current({ uid: '', serial: null });
      await reader.scan({ signal: controller.signal });
      if (!controller.signal.aborted) setState('active');
    } catch (err) {
      if (controller.signal.aborted) return;
      setState('error');
      setError(friendlyError(err));
    }
  }, [deliver, startNative]);

  useEffect(() => {
    // Native Android app: the app pushes each tap into this callback.
    if (hasNative()) {
      window.__onNativeNfcTag = tag => deliver((tag?.uid || '').toUpperCase(), tag?.serial || null);
      startNative();
      return () => { delete window.__onNativeNfcTag; };
    }
    // Chrome: start automatically when permission was already granted; otherwise the operator taps "Enable NFC reader".
    if (!getSupport().ok) return undefined;
    let cancelled = false;
    navigator.permissions?.query({ name: 'nfc' })
      .then(result => { if (!cancelled && result.state === 'granted') start(); })
      .catch(() => {});
    return () => { cancelled = true; controllerRef.current?.abort(); };
  }, [start, startNative, deliver]);

  return { state, error, start };
}
