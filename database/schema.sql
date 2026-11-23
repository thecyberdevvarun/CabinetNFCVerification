-- Run this in the database named in backend/.env (DB_DATABASE).
-- Example: USE CabinetValidation;  (create the database first if needed)

CREATE TABLE dbo.cabinet_nfc_verification (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    foaming_barcode VARCHAR(15) NOT NULL,
    inner_ncf VARCHAR(255) NOT NULL,
    outer_nfc VARCHAR(255) NOT NULL,

    area VARCHAR(20) NOT NULL,

    validation_status VARCHAR(20) NOT NULL
        DEFAULT ('MATCHED'),

    created_at DATETIME2(0) NOT NULL
        DEFAULT (SYSDATETIME()),

    -- One verification per barcode in each area
    CONSTRAINT UQ_cabinet_barcode_area
        UNIQUE (foaming_barcode, area),

    -- Only two permitted areas
    CONSTRAINT CK_cabinet_area
        CHECK (area IN ('FREEZER_PRE', 'FREEZER_POST')),

    -- Only successfully matched records can be saved
    CONSTRAINT CK_cabinet_status
        CHECK (validation_status = 'MATCHED')
);
GO

-- Index for date-wise verification reports
CREATE INDEX IX_cabinet_nfc_created_at
ON dbo.cabinet_nfc_verification (created_at);
GO
