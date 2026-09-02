/**
 * Label settlement untuk UI.
 * Sumber kebenaran: baris di merchant_settlement_items (bukan is_settled saja).
 * FLAG_ORPHAN = is_settled=1 tapi belum ada item/ledger → saldo belum naik.
 */
exports.settlementStatusLabel = ({ is_settled, has_settlement_item } = {}) => {
  if (Number(has_settlement_item) === 1) return "SETTLED";
  if (Number(is_settled) === 1) return "FLAG_ORPHAN";
  return "NOT_SETTLED";
};

exports.settlementStatusBadgeClass = (label) => {
  if (label === "SETTLED") return "b-settled";
  if (label === "FLAG_ORPHAN") return "b-orphan";
  return "b-not-settled";
};
