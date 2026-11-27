import { getPool, sql } from "../config/db.js";

const AREA_LABELS = {
  FREEZER_PRE: "Freezer Pre",
  FREEZER_POST: "Freezer Post",
};
const httpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

// Freezer Pre only: the outer card's "<card ID>/<card value>" is stored in MaterialBarcode.Serial2 when a card
// is used on a body. If it is already there, this NFC card was used before: report the body (Serial column).
async function assertNfcNotUsedBefore(pool, data) {
  const serial2 = `${data.outerMac}/${data.outerNfc}`;
  const result = await pool
    .request()
    .input("serial2", sql.NVarChar(400), serial2)
    .query("SELECT TOP 1 Serial FROM MaterialBarcode WHERE Serial2 = @serial2");
  if (result.recordset.length > 0) {
    throw httpError(
      409,
      `Duplicate NFC! This NFC card (${serial2}) was already used on body serial number ${result.recordset[0].Serial}. Cabinet not saved.`,
    );
  }
}

export async function saveCabinetScan(data) {
  const pool = await getPool();

  if (data.area === "FREEZER_PRE") await assertNfcNotUsedBefore(pool, data);

  try {
    const result = await pool
      .request()
      .input("foamingBarcode", sql.VarChar(15), data.foamingBarcode)
      .input("innerNfc", sql.VarChar(255), data.innerNfc)
      .input("outerNfc", sql.VarChar(255), data.outerNfc)
      .input("innerMac", sql.VarChar(50), data.innerMac || null)
      .input("outerMac", sql.VarChar(50), data.outerMac || null)
      .input("area", sql.VarChar(20), data.area).query(`
        INSERT INTO dbo.cabinet_nfc_verification
          (foaming_barcode, inner_ncf, outer_nfc, inner_nfc_mac, outer_nfc_mac, area)
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@foamingBarcode, @innerNfc, @outerNfc, @innerMac, @outerMac, @area);
      `);
    return result.recordset[0];
  } catch (error) {
    // 2627 / 2601 = unique constraint violation (foaming_barcode + area)
    if (error.number === 2627 || error.number === 2601) {
      throw httpError(
        409,
        `This Foaming Barcode has already been verified in ${AREA_LABELS[data.area] || data.area}.`,
      );
    }
    throw error;
  }
}
