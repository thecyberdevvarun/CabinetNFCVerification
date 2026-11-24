// Existing PC reader sends "UID;serial" (e.g. "04:A1:B2:C3:D4:E5:F6;12345678901234567890").
// Two different cards have different UIDs, so only the 20-digit serial is compared.
const NFC_PAYLOAD = /^(?:[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})*;)?(\d{20})$/;
const UID_PREFIX = /^([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})*);/;
const CARD_ID = /^[0-9A-F]{2}(?::[0-9A-F]{2})*$/;

export function normalizeNfc(value) {
  const text = String(value ?? '').trim();
  const match = text.match(NFC_PAYLOAD);
  return match ? match[1] : text;
}

// Card hardware ID from a typed "UID;serial" value (keyboard-wedge readers). Empty string if absent.
export function extractNfcUid(value) {
  const match = String(value ?? '').trim().match(UID_PREFIX);
  return match ? match[1].toUpperCase() : '';
}

// Backend check: '' = not provided, uppercase ID = valid, null = invalid format.
export function normalizeCardId(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return '';
  return CARD_ID.test(text) && text.length <= 50 ? text : null;
}