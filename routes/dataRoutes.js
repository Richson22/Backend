const express = require("express");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");
const DataMarkup = require("../models/DataMarkup");
const { buyData, getVariations } = require("../services/vtuService");

const router = express.Router();

// ─── GET DATA PLANS ──────────────────────────────────────────
router.get("/variations/:network", async (req, res) => {
  try {
    const variations = await getVariations(req.params.network);
    res.json({ variations });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
});

// ─── BUY DATA ────────────────────────────────────────────────
router.post("/buy", async (req, res) => {
  try {
    const { userId, phone, network, variation_code, amount } = req.body;

    if (!userId || !phone || !network || !variation_code || !amount) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const markedUpAmount = Number(amount);

    if (user.walletBalance < markedUpAmount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // ── Get base price from Neura plans (before markup) ──
    let baseAmount = markedUpAmount;
    try {
      const variations = await getVariations(network);
      const plan = variations.find(
        (v) => String(v.variation_code) === String(variation_code)
      );
      if (plan && plan.base_amount) {
        baseAmount = parseFloat(plan.base_amount);
      }
      console.log(
        `MARKUP: base=₦${baseAmount} | charged=₦${markedUpAmount} | profit=₦${(markedUpAmount - baseAmount).toFixed(2)}`
      );
    } catch (err) {
      console.log("Could not fetch base price, using amount:", err.message);
    }

    // ── Call Neura API to buy data ──
    const vtuResponse = await buyData({ phone, network, plan: variation_code });

    console.log("NEURA BUY RESPONSE:", JSON.stringify(vtuResponse));

    const responseCode = String(
      vtuResponse?.ResponseCode ||
        vtuResponse?.response_code ||
        vtuResponse?.code ||
        vtuResponse?.Status ||
        vtuResponse?.status ||
        ""
    ).trim();

    const responseDesc = String(
      vtuResponse?.ResponseDescription ||
        vtuResponse?.response_description ||
        vtuResponse?.message ||
        vtuResponse?.Message ||
        vtuResponse?.Status ||
        "Transaction failed"
    ).trim();

    console.log("RESPONSE CODE:", responseCode);
    console.log("RESPONSE DESC:", responseDesc);

    const isSuccess =
      responseCode === "00" ||
      responseCode === "000" ||
      responseCode === "0" ||
      responseDesc.toLowerCase().includes("successful") ||
      responseDesc.toLowerCase().includes("success") ||
      responseDesc.toLowerCase().includes("delivered");

    const isPending =
      responseCode === "099" ||
      responseCode === "01" ||
      responseDesc.toLowerCase().includes("pending") ||
      responseDesc.toLowerCase().includes("processing");

    if (isSuccess || isPending) {
      // ── Deduct wallet ──
      user.walletBalance -= markedUpAmount;
      await user.save();

      // ── Save transaction with BOTH user fields so admin + user queries both work ──
      await Transaction.create({
        userId: user._id,   // ← for $or query in user transactions
        user: user._id,     // ← FIX: was missing; needed for admin populate + query
        type: "data",
        amount: markedUpAmount,
        status: isSuccess ? "success" : "pending",
        reference:
          vtuResponse?.OrderID ||
          vtuResponse?.RequestID ||
          vtuResponse?.requestId ||
          `DATA-${Date.now()}`,
        description: `${network.toUpperCase()} Data - ${variation_code} for ${phone}`,
        meta: {
          baseAmount,
          profit: parseFloat((markedUpAmount - baseAmount).toFixed(2)),
          network,
          phone,
          plan: variation_code,
        },
      });

      return res.json({
        message: isSuccess
          ? "Data purchased successfully"
          : "Transaction is pending. We will update you shortly.",
        walletBalance: user.walletBalance,
        status: isSuccess ? "success" : "pending",
      });
    }

    return res.status(400).json({
      message: responseDesc || "Data purchase failed. Please try again.",
    });
  } catch (err) {
    console.error("BUY DATA ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;