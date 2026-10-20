-- 017_merchant_partnership.sql
-- SUPERSEDED. Jangan jalankan file ini.
-- Kolom bagi hasil dan subscription per merchant sudah dihapus migrasi 026.
-- Fee payout per merchant dan kolom platform_midtrans_fee_amount dibuat oleh
-- scripts/migrate-merchant-partnership.js. Menjalankan ALTER di bawah ini
-- akan menghidupkan kembali flow yang sudah tidak dipakai.

-- partnership_type, revenue_share_percent, subscription_amount,
-- dan midtrans_fee_bearer tidak lagi menjadi bagian schema merchants.
