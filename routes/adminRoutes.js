// routes/adminRoutes.js
const express = require("express");
const User = require("../models/Users");
const DataMarkup = require("../models/DataMarkup");
const Transaction = require("../models/Transaction");
const ProfitLedger = require("../models/ProfitLedger");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ── Helper: ensure the requester is an admin ──
function requireAdmin(req, res) {
  if (!req.user?.isAdmin) {
    res.status(403).json({ message: "Admin access required" });
    return false;
  }
  return true;
}

// ── Helper: get current profit ledger (creates one if missing) ──
async function getLedger() {
  let ledger = await ProfitLedger.findOne();
  if (!ledger) ledger = await ProfitLedger.create({ withdrawals: [] });
  return ledger;
}

// ── Helper: compute profit summary ──
async function computeProfitSummary() {
  const transactions = await Transaction.find({ status: "success" });
  const totalProfit = transactions.reduce(
    (sum, t) => sum + (Number(t.meta?.profit) || 0),
    0
  );

  const ledger = await getLedger();
  const withdrawn = ledger.withdrawals.reduce((sum, w) => sum + w.amount, 0);

  return {
    totalProfit,
    withdrawn,
    profitBalance: totalProfit - withdrawn,
    withdrawals: ledger.withdrawals,
  };
}

// ─── GET ALL USERS ───────────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const users = await User.find();
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── MAKE USER ADMIN ─────────────────────────────────────────
router.post("/make-admin", async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        user.isAdmin = true;
        await user.save();
        res.json({ message: "User promoted to admin" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET ALL NETWORK MARKUPS ─────────────────────────────────
// GET /api/admin/markup
router.get("/markup", async (req, res) => {
    try {
        const markups = await DataMarkup.find();
        res.json(markups);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET MARKUP FOR ONE NETWORK ──────────────────────────────
// GET /api/admin/markup/:network
router.get("/markup/:network", async (req, res) => {
    try {
        const markup = await DataMarkup.findOne({
            network: req.params.network.toLowerCase(),
        });
        res.json(markup || { network: req.params.network, markupPercent: 0, markupFixed: 0 });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── SET / UPDATE MARKUP FOR A NETWORK ───────────────────────
// POST /api/admin/markup
// Body: { network: "mtn", markupPercent: 10, markupFixed: 0 }
router.post("/markup", async (req, res) => {
    try {
        const { network, markupPercent, markupFixed } = req.body;

        if (!network) {
            return res.status(400).json({ message: "Network is required" });
        }

        const markup = await DataMarkup.findOneAndUpdate(
            { network: network.toLowerCase() },
            {
                markupPercent: Number(markupPercent) || 0,
                markupFixed: Number(markupFixed) || 0,
                isActive: true,
            },
            { upsert: true, new: true }
        );

        res.json({ message: "Markup updated successfully", markup });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── RESET MARKUP FOR A NETWORK ──────────────────────────────
// DELETE /api/admin/markup/:network
router.delete("/markup/:network", async (req, res) => {
    try {
        await DataMarkup.findOneAndUpdate(
            { network: req.params.network.toLowerCase() },
            { markupPercent: 0, markupFixed: 0 },
            { upsert: true, new: true }
        );
        res.json({ message: "Markup reset to zero" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ════════════════════════════════════════════════════════════
//  WALLET CONTROL
// ════════════════════════════════════════════════════════════

// ─── MANUALLY FUND A USER'S WALLET ────────────────────────────
// POST /api/admin/fund-wallet
// Body: { username, amount, note }
router.post("/fund-wallet", authMiddleware, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { username, amount, note } = req.body;
    const amt = Number(amount);

    if (!username || !username.trim()) {
      return res.status(400).json({ message: "Username is required" });
    }
    if (!amt || amt <= 0) {
      return res.status(400).json({ message: "Enter a valid amount" });
    }

    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.walletBalance += amt;
    await user.save();

    await Transaction.create({
      userId: user._id,
      user: user._id,
      type: "fund",
      subtype: "manual-fund",
      amount: amt,
      status: "success",
      reference: `ADMINFUND-${Date.now()}`,
      description: note?.trim() || "Manual wallet credit",
      meta: { source: "admin", adminId: req.user.id },
    });

    return res.json({
      message: "Wallet funded successfully",
      walletBalance: user.walletBalance,
      user: { _id: user._id, username: user.username, walletBalance: user.walletBalance },
    });
  } catch (err) {
    console.error("FUND WALLET ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ─── REVERSE A TRANSACTION ─────────────────────────────────────
// POST /api/admin/reverse-transaction/:id
router.post("/reverse-transaction/:id", authMiddleware, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });

    if (tx.status === "reversed") {
      return res.status(400).json({ message: "Transaction already reversed" });
    }

    const userId = tx.user || tx.userId;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User for this transaction not found" });

    const amt = Number(tx.amount) || 0;

    if (String(tx.type).toLowerCase() === "fund") {
      // Reversing a wallet credit -> remove the funds
      if (user.walletBalance < amt) {
        return res.status(400).json({
          message: `Cannot reverse — user balance (₦${user.walletBalance}) is less than the funded amount (₦${amt}).`,
        });
      }
      user.walletBalance -= amt;
    } else {
      // Reversing a debit/purchase -> refund the user
      user.walletBalance += amt;
    }

    await user.save();

    tx.status = "reversed";
    await tx.save();

    return res.json({
      message: "Transaction reversed successfully",
      walletBalance: user.walletBalance,
      transaction: tx,
    });
  } catch (err) {
    console.error("REVERSE TRANSACTION ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ─── GET PROFIT SUMMARY ─────────────────────────────────────────
// GET /api/admin/profit-summary
router.get("/profit-summary", authMiddleware, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const summary = await computeProfitSummary();
    return res.json(summary);
  } catch (err) {
    console.error("PROFIT SUMMARY ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ─── WITHDRAW PROFIT ─────────────────────────────────────────────
// POST /api/admin/withdraw-profit
// Body: { amount, note }
router.post("/withdraw-profit", authMiddleware, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { amount, note } = req.body;
    const amt = Number(amount);

    if (!amt || amt <= 0) {
      return res.status(400).json({ message: "Enter a valid amount" });
    }

    const summary = await computeProfitSummary();
    if (amt > summary.profitBalance) {
      return res.status(400).json({
        message: `Insufficient profit balance. Available: ₦${summary.profitBalance.toLocaleString()}`,
      });
    }

    const ledger = await getLedger();
    ledger.withdrawals.push({ amount: amt, note: note?.trim() || "Profit withdrawal" });
    await ledger.save();

    const updated = await computeProfitSummary();

    return res.json({
      message: "Profit withdrawn successfully",
      ...updated,
    });
  } catch (err) {
    console.error("WITHDRAW PROFIT ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;