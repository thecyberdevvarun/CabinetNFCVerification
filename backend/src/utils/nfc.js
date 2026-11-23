// Existing PC reader sends "UID;serial" (e.g. "04:A1:B2:C3:D4:E5:F6;12345678901234567890").
// Two different cards have different UIDs, so only the 20-digit serial is compared and stored.
const NFC_PAYLOAD = /^(?:[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})*;)?(\d{20})$/;

export function normalizeNfc(value) {
  const text = String(value ?? '').trim();
  const match = text.match(NFC_PAYLOAD);
  return match ? match[1] : text;
}
