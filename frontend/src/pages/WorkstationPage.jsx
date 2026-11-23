import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Factory,
  Nfc,
  RotateCcw,
  ScanLine,
  Snowflake,
  XCircle,
} from "lucide-react";
import { saveCabinet } from "../services/api";
import { useNfcReader } from "../hooks/useNfcReader";
import { normalizeNfc } from "../utils/nfc";

const BARCODE_RE = /^F4\d{13}$/;
// Inner and outer are two different physical cards. Reject the same card being tapped twice.
const REJECT_SAME_CARD = true;
const initial = { foamingBarcode: "", innerNfc: "", outerNfc: "" };
const normalizeBarcode = (value) => value.trim().toUpperCase();

export default function WorkstationPage({ freezerType, onBack }) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState({
    type: "idle",
    message: "Ready for Foaming Barcode scan.",
  });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [mismatch, setMismatch] = useState(false); // "Not Matched" popup
  const [toast, setToast] = useState(null);
  const barcodeRef = useRef(null);
  const innerRef = useRef(null);
  const outerRef = useRef(null);
  const valuesRef = useRef(initial); // latest values, readable from NFC events
  const savingRef = useRef(false);
  const mismatchRef = useRef(false);
  const toastTimer = useRef(null);
  const innerUidRef = useRef("");

  function apply(patch) {
    valuesRef.current = { ...valuesRef.current, ...patch };
    setValues(valuesRef.current);
  }
  function resetAll() {
    innerUidRef.current = "";
    apply({ ...initial });
    setSaveFailed(false);
  }
  function showToast(message, type = "success") {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Keep focus on the field that is waiting for the next scan.
  useEffect(() => {
    if (mismatch) return;
    if (!BARCODE_RE.test(values.foamingBarcode)) barcodeRef.current?.focus();
    else if (!values.innerNfc.trim()) innerRef.current?.focus();
    else if (!values.outerNfc.trim()) outerRef.current?.focus();
  }, [values.foamingBarcode, values.innerNfc, values.outerNfc, mismatch]);

  // While the popup is open, nothing is focused, so a scanner's Enter key cannot close it by accident.
  useEffect(() => {
    if (mismatch) document.activeElement?.blur?.();
  }, [mismatch]);

  // ---------- Compare, then auto-save or show the popup ----------
  function checkOuter(outerRaw) {
    const outer = normalizeNfc(outerRaw);
    apply({ outerNfc: outer });
    if (normalizeNfc(valuesRef.current.innerNfc) === outer) {
      performSave();
    } else {
      mismatchRef.current = true;
      setMismatch(true);
      setStatus({
        type: "error",
        message: "NOT MATCHED — Inner and Outer NFC values are different.",
      });
    }
  }

  function closeMismatch() {
    mismatchRef.current = false;
    setMismatch(false);
    resetAll();
    setStatus({ type: "idle", message: "Ready for Foaming Barcode scan." });
  }

  async function performSave() {
    if (savingRef.current) return;
    const v = valuesRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    setStatus({
      type: "saving",
      message: "NFC values matched. Saving cabinet record...",
    });
    try {
      await saveCabinet({
        foamingBarcode: v.foamingBarcode,
        innerNfc: normalizeNfc(v.innerNfc),
        outerNfc: normalizeNfc(v.outerNfc),
        area: freezerType,
      });
      resetAll();
      setStatus({
        type: "success",
        message: "Cabinet saved. Ready for next cabinet.",
      });
      showToast("Cabinet saved successfully", "success");
    } catch (error) {
      const message =
        error.response?.data?.message ||
        "Unable to save. Check the connection and retry.";
      setStatus({ type: "error", message });
      setSaveFailed(true); // scanned values are kept so the operator can retry
      showToast(message, "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // ---------- NFC tap (built-in reader) ----------
  function handleNfcTag({ uid, serial }) {
    if (savingRef.current || mismatchRef.current) return;
    const current = valuesRef.current;
    if (!BARCODE_RE.test(current.foamingBarcode)) {
      setStatus({
        type: "error",
        message: "Scan the Foaming Barcode first, then tap the NFC card.",
      });
      return;
    }
    if (!serial) {
      setStatus({
        type: "error",
        message:
          "Could not read a 20-digit serial from this card. Hold it against the reader and try again.",
      });
      return;
    }
    if (!current.innerNfc.trim()) {
      innerUidRef.current = uid;
      apply({ innerNfc: serial });
      setStatus({
        type: "scanning",
        message: "Inner NFC captured. Tap the Outer NFC card.",
      });
      return;
    }
    if (!current.outerNfc.trim()) {
      if (REJECT_SAME_CARD && uid && uid === innerUidRef.current) {
        setStatus({
          type: "error",
          message: "This is the Inner NFC card again. Tap the Outer NFC card.",
        });
        return;
      }
      checkOuter(serial);
      return;
    }
    setStatus({
      type: "error",
      message:
        "Both cards are already scanned. Press Retry save or Clear & rescan.",
    });
  }
  const nfc = useNfcReader({ onTag: handleNfcTag });

  // ---------- keyboard-wedge / typed input (still supported) ----------
  function handleBarcode(value) {
    const normalized = normalizeBarcode(value);
    apply({ foamingBarcode: value });
    if (!normalized) return;
    if (normalized.length < 15) {
      setStatus({
        type: "error",
        message: "Foaming Barcode must contain exactly 15 characters.",
      });
      return;
    }
    if (!BARCODE_RE.test(normalized)) {
      setStatus({
        type: "error",
        message: "Invalid barcode. Expected F4 followed by 13 digits.",
      });
      return;
    }
    apply({ foamingBarcode: normalized });
    setStatus({
      type: "scanning",
      message: "Barcode accepted. Tap or scan Inner NFC.",
    });
  }
  function handleInner(value) {
    const inner = normalizeNfc(value);
    apply({ innerNfc: inner });
    innerUidRef.current = "";
    if (inner)
      setStatus({
        type: "scanning",
        message: "Inner NFC captured. Tap or scan Outer NFC.",
      });
  }
  function handleOuter(value) {
    if (!value.trim() || savingRef.current || mismatchRef.current) return;
    checkOuter(value);
  }

  function handleClear() {
    resetAll();
    setStatus({
      type: "idle",
      message: "Cleared. Ready for Foaming Barcode scan.",
    });
  }

  const enterKey = (handler) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler(e.currentTarget.value);
    }
  };
  const fields = [
    {
      key: "foamingBarcode",
      label: "Foaming Barcode",
      step: "01",
      ref: barcodeRef,
      placeholder: "Scan F4 + 13 digits",
      onKeyDown: enterKey(handleBarcode),
      disabled: !!values.innerNfc,
    },
    {
      key: "innerNfc",
      label: "Inner NFC Card",
      step: "02",
      ref: innerRef,
      placeholder: "Tap Inner NFC card",
      onKeyDown: enterKey(handleInner),
      disabled: !BARCODE_RE.test(values.foamingBarcode),
    },
    {
      key: "outerNfc",
      label: "Outer NFC Card",
      step: "03",
      ref: outerRef,
      placeholder: "Tap Outer NFC card",
      onKeyDown: enterKey(handleOuter),
      disabled: !values.innerNfc.trim(),
    },
  ];

  const nfcStyles = {
    active: "border-green-200 bg-green-50 text-green-800",
    error: "border-red-200 bg-red-50 text-red-800",
    unsupported: "border-amber-200 bg-amber-50 text-amber-800",
    starting: "border-blue-100 bg-blue-50 text-blue-800",
    idle: "border-blue-100 bg-blue-50 text-blue-800",
  };
  const nfcText = {
    active: "NFC reader ready — hold the card against the back of the device.",
    starting: "Starting NFC reader...",
    idle: "NFC reader is not started.",
    error: nfc.error,
    unsupported: nfc.error,
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-0 top-6 z-40 mx-auto w-fit max-w-[90%] rounded-xl px-6 py-4 text-center text-lg font-bold text-white shadow-lg ${toast.type === "error" ? "bg-red-600" : "bg-green-600"}`}
        >
          {toast.message}
        </div>
      )}

      {mismatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mismatch-title"
            className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-2xl"
          >
            <XCircle className="mx-auto text-red-600" size={72} />
            <h2
              id="mismatch-title"
              className="mt-3 text-4xl font-extrabold text-red-600"
            >
              NOT MATCHED
            </h2>
            <p className="mt-3 text-lg font-semibold text-slate-800">
              Inner NFC and Outer NFC values are different.
            </p>
            <p className="mt-1 text-base text-slate-600">
              This cabinet has 2 different NFC cards, so the cabinet is wrong.
              Do not use it.
            </p>
            <div className="mt-5 space-y-2 rounded-xl bg-slate-100 p-3 text-left text-sm">
              <p>
                <span className="font-bold">Foaming:</span>{" "}
                {values.foamingBarcode}
              </p>
              <p className="break-all">
                <span className="font-bold">Inner:</span> {values.innerNfc}
              </p>
              <p className="break-all">
                <span className="font-bold">Outer:</span> {values.outerNfc}
              </p>
            </div>
            <button
              onClick={closeMismatch}
              className="mt-6 w-full rounded-xl bg-red-600 px-5 py-4 text-lg font-bold text-white hover:bg-red-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-700 p-3 text-white">
              <Factory size={25} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
                Production quality
              </p>
              <h1 className="text-xl font-bold text-slate-900 md:text-2xl">
                Cabinet Validation System
              </h1>
            </div>
          </div>
          <button
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Change workstation
          </button>
        </header>
        <section className="mb-5 flex items-center justify-between rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
          <div>
            <p className="text-sm text-slate-300">Active workstation</p>
            <h2 className="mt-1 text-2xl font-bold">
              {freezerType === "FREEZER_PRE" ? "Freezer Pre" : "Freezer Post"}
            </h2>
          </div>
          <Snowflake size={36} className="text-sky-300" />
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5">
            <h3 className="text-lg font-bold">Scan cabinet identifiers</h3>
            <p className="mt-1 text-sm text-slate-500">
              Scan the barcode, then tap the Inner card, then the Outer card.
              The record saves automatically when both cards match.
            </p>
          </div>

          <div
            className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${nfcStyles[nfc.state]}`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Nfc size={20} className="shrink-0" />
              <span>{nfcText[nfc.state]}</span>
            </div>
            {(nfc.state === "idle" || nfc.state === "error") && (
              <button
                onClick={nfc.start}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                {nfc.state === "error" ? "Retry" : "Enable NFC reader"}
              </button>
            )}
          </div>

          <div className="space-y-5">
            {fields.map((field) => (
              <div key={field.key}>
                <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-700">
                    {field.step}
                  </span>
                  {field.label}
                </label>
                <div className="relative">
                  <ScanLine
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    size={20}
                  />
                  <input
                    ref={field.ref}
                    value={values[field.key]}
                    onChange={(e) => apply({ [field.key]: e.target.value })}
                    onKeyDown={field.onKeyDown}
                    disabled={field.disabled || saving || mismatch}
                    placeholder={field.placeholder}
                    inputMode="none"
                    autoComplete="off"
                    className="w-full rounded-xl border border-slate-300 bg-white py-4 pl-12 pr-4 text-lg font-medium tracking-wide text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
              </div>
            ))}
          </div>

          <div
            className={`mt-7 flex items-start gap-3 rounded-xl border p-4 ${status.type === "success" ? "border-green-200 bg-green-50 text-green-800" : status.type === "error" ? "border-red-200 bg-red-50 text-red-800" : status.type === "saving" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-100 bg-blue-50 text-blue-800"}`}
          >
            {status.type === "error" ? (
              <CircleAlert className="mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 shrink-0" />
            )}
            <div>
              <p className="font-bold">
                {status.type === "success"
                  ? "Success"
                  : status.type === "error"
                    ? "Error"
                    : status.type === "saving"
                      ? "Saving"
                      : "Scan status"}
              </p>
              <p className="mt-1 text-sm">{status.message}</p>
            </div>
          </div>

          {saveFailed && !saving && (
            <button
              onClick={performSave}
              className="mt-5 w-full rounded-xl bg-green-700 px-5 py-4 text-base font-bold text-white shadow-sm hover:bg-green-800"
            >
              RETRY SAVE
            </button>
          )}
          <button
            onClick={handleClear}
            disabled={saving}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw size={16} />
            Clear &amp; rescan
          </button>
        </section>
        <p className="mt-4 text-center text-xs text-slate-500">
          A cabinet is recorded only after the Inner and Outer NFC values match.
        </p>
      </div>
    </main>
  );
}
