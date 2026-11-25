import { getPool, sql } from "../config/db.js";

const AREA_LABELS = {
  FREEZER_PRE: "Freezer Pre",
  FREEZER_POST: "Freezer Post",
};
const httpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

// Freezer Post only:
//   1. ProcessStageLabel: find PSNo for the foaming barcode
//   2. MaterialBarcode:   set Serial2 = "<outer card ID>/<outer card value>" where DocNo = PSNo and Type = 400
// Runs inside the same transaction as the verification INSERT, so everything is saved or nothing is.
async function linkToMaterialBarcode(transaction, data) {
  const serial2 = `${data.outerMac}/${data.outerNfc}`;
  if (serial2.length > 100) {
    throw httpError(
      400,
      "Outer NFC ID and value are too long to store in MaterialBarcode.Serial2.",
    );
  }

  const lookup = await new sql.Request(transaction)
    .input("barcode", sql.NVarChar(150), data.foamingBarcode)
    .query(
      "SELECT DISTINCT PSNo FROM ProcessStageLabel WHERE BarcodeNo = @barcode AND PSNo IS NOT NULL",
    );
  const psNos = lookup.recordset.map((row) => row.PSNo);
  if (psNos.length === 0) {
    throw httpError(
      404,
      `Foaming Barcode ${data.foamingBarcode} was not found in ProcessStageLabel. Cabinet not saved.`,
    );
  }
  if (psNos.length > 1) {
    throw httpError(
      409,
      `Foaming Barcode ${data.foamingBarcode} matches more than one PSNo in ProcessStageLabel. Cabinet not saved.`,
    );
  }
  const psNo = psNos[0];

  const update = await new sql.Request(transaction)
    .input("psNo", sql.BigInt, psNo)
    .input("serial2", sql.NVarChar(100), serial2)
    .query(
      "UPDATE MaterialBarcode SET Serial2 = @serial2 WHERE DocNo = @psNo AND Type = 400",
    );
  const updated = update.rowsAffected[0];
  if (updated === 0) {
    throw httpError(
      404,
      `No MaterialBarcode row found for PSNo ${psNo} with Type 400. Cabinet not saved.`,
    );
  }
  if (updated > 1) {
    throw httpError(
      409,
      `More than one MaterialBarcode row found for PSNo ${psNo} with Type 400. Cabinet not saved.`,
    );
  }
}

export async function saveCabinetScan(data) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
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

    if (data.area === "FREEZER_POST")
      await linkToMaterialBarcode(transaction, data);

    await transaction.commit();
    return result.recordset[0];
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }
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
