import { saveCabinetScan } from "../services/cabinetService.js";
import { normalizeNfc, normalizeCardId } from "../utils/nfc.js";

const ALLOWED_AREAS = ["FREEZER_PRE", "FREEZER_POST"];

export async function createCabinetScan(req, res, next) {
  try {
    const {
      foamingBarcode,
      innerNfc,
      outerNfc,
      innerNfcMac,
      outerNfcMac,
      area,
    } = req.body;

    if (!ALLOWED_AREAS.includes(area)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid area. Select Freezer Pre or Freezer Post.",
        });
    }

    // The foaming barcode is scanned only in Freezer Post. Freezer Pre stores it blank (NULL).
    let barcode = null;
    if (area === "FREEZER_POST") {
      barcode = String(foamingBarcode ?? "")
        .trim()
        .toUpperCase();
      if (!/^F4\d{13}$/.test(barcode)) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid Foaming Barcode. Expected F4 followed by 13 digits.",
          });
      }
    }

    const inner = normalizeNfc(innerNfc);
    const outer = normalizeNfc(outerNfc);
    if (!inner || !outer) {
      return res
        .status(400)
        .json({ success: false, message: "Both NFC values are required." });
    }
    if (inner !== outer) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Inner NFC and Outer NFC do not match.",
        });
    }

    const innerMac = normalizeCardId(innerNfcMac);
    const outerMac = normalizeCardId(outerNfcMac);
    if (innerMac === null || outerMac === null) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid NFC card ID format." });
    }

    const saved = await saveCabinetScan({
      foamingBarcode: barcode,
      innerNfc: inner,
      outerNfc: outer,
      innerMac,
      outerMac,
      area,
    });
    return res
      .status(201)
      .json({
        success: true,
        message: "Cabinet saved successfully.",
        data: saved,
      });
  } catch (error) {
    next(error);
  }
}
