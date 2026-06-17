const mongoose = require("mongoose");

// ── Singleton-style ledger that tracks profit withdrawals ──
// Profit balance = (sum of meta.profit across all successful transactions) - (sum of withdrawals)
const profitLedgerSchema = new mongoose.Schema(
  {
    withdrawals: [
      {
        amount: { type: Number, required: true },
        note: { type: String, default: "" },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfitLedger", profitLedgerSchema);