import { getPool, sql } from '../config/db.js';

const AREA_LABELS = { FREEZER_PRE: 'Freezer Pre', FREEZER_POST: 'Freezer Post' };

export async function saveCabinetScan(data) {
  const pool = await getPool();
  try {
    const result = await pool.request()
      .input('foamingBarcode', sql.VarChar(15), data.foamingBarcode)
      .input('innerNfc', sql.VarChar(255), data.innerNfc)
      .input('outerNfc', sql.VarChar(255), data.outerNfc)
      .input('innerMac', sql.VarChar(50), data.innerMac || null)
      .input('outerMac', sql.VarChar(50), data.outerMac || null)
      .input('area', sql.VarChar(20), data.area)
      .query(`
        INSERT INTO dbo.cabinet_nfc_verification
          (foaming_barcode, inner_ncf, outer_nfc, inner_nfc_mac, outer_nfc_mac, area)
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@foamingBarcode, @innerNfc, @outerNfc, @innerMac, @outerMac, @area);
      `);
    return result.recordset[0];
  } catch (error) {
    // 2627 / 2601 = unique constraint violation (foaming_barcode + area)
    if (error.number === 2627 || error.number === 2601) {
      const duplicate = new Error(
        `This Foaming Barcode has already been verified in ${AREA_LABELS[data.area] || data.area}.`
      );
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }
}