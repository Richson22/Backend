const express = require("express");
const axios = require("axios");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");

const router = express.Router();

const BASE_URL = "https://daltechsubapi.com.ng/api/rechargepin/";
const DALTECH_TOKEN = process.env.DALTECH_TOKEN;

const networkMap = {
  mtn: "1",
  glo: "2",
  "9mobile": "3",
  airtel: "4",
};

// More collision-resistant ref generator
const generateRef = () =>
  `EPIN_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

// ─── BUY RECHARGE PINS (DALTECH) ─────────────────────────────────────────────
router.post("/buy", async (req, res) => {
  try {
    const { userId, network, quantity, plan, businessname } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!userId || !network || !quantity || !plan) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number between 1 and 100" });
    }

    const networkCode = networkMap[network.toLowerCase()];
    if (!networkCode) {
      return res.status(400).json({ message: "Invalid network" });
    }

    // ── Pricing ─────────────────────────────────────────────────────────────
    // TODO: Replace with a real plan-price lookup from your DB/config.
    // Example: const pinPrice = await PlanPrice.findOne({ network: networkCode, plan });
    const pinPrice = 100;
    const totalCost = pinPrice * qty;

    // ── Atomic balance deduction (prevents double-spend race condition) ──────
    const user = await User.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: totalCost } },
      { $inc: { walletBalance: -totalCost } },
      { new: true }
    );

    if (!user) {
      // Could be "user not found" OR "insufficient balance" — treat both the same
      return res
        .status(400)
        .json({ message: "Insufficient wallet balance or user not found" });
    }

    const ref = generateRef();

    console.log("=== DALTECH RECHARGEPIN DEBUG ===");
    console.log("NETWORK CODE:", networkCode);
    console.log("QUANTITY:", qty);
    console.log("PLAN:", plan);
    console.log("REF:", ref);
    console.log("=================================");

    // ── Call Daltech API (GET with query params per their docs) ──────────────
    let daltechResponse;
    try {
      daltechResponse = await axios.get(BASE_URL, {
        params: {
          network: networkCode,
          quantity: String(qty),
          plan: String(plan),
          businessname: businessname || "Richson Data Hub",
          ref,
        },
        headers: { Authorization: `Token ${DALTECH_TOKEN}` },
      });
    } catch (apiErr) {
      // Daltech call itself failed — refund the wallet immediately
    console.error("DALTECH API CALL FAILED:", apiErr.message, JSON.stringify(apiErr.response?.data));
      await User.findByIdAndUpdate(user._id, {
        $inc: { walletBalance: totalCost },
      });
      return res.status(502).json({
        message: "Could not reach the pin provider. Your wallet was not charged.",
      });
    }

    console.log(
      "DALTECH RECHARGEPIN RESPONSE:",
      JSON.stringify(daltechResponse.data)
    );

    const { status, pin } = daltechResponse.data;

    if (status !== "success" || !pin) {
      // API returned but reported failure — refund the wallet
      console.warn("DALTECH returned non-success:", daltechResponse.data);
      await User.findByIdAndUpdate(user._id, {
        $inc: { walletBalance: totalCost },
      });
      return res.status(400).json({
        message:
          daltechResponse.data?.msg ||
          "Failed to generate recharge pins. Your wallet was not charged.",
      });
    }

    // ── Save transaction record ──────────────────────────────────────────────
    // If this fails, pins were already generated. Log for manual reconciliation.
    try {
      await Transaction.create({
        userId: user._id,
        user: user._id,
        type: "recharge-pin",
        amount: totalCost,
        status: "success",
        reference: ref,
        description: `${network.toUpperCase()} Recharge PIN x${qty} (Plan: ${plan})`,
      });
    } catch (dbErr) {
      console.error(
        "CRITICAL: Transaction record failed after successful pin generation.",
        { ref, userId: user._id, error: dbErr.message }
      );
      // Do NOT refund — pins were delivered. Reconcile manually using the ref.
      // Optionally: trigger an admin alert here.
    }

    // ── Success ──────────────────────────────────────────────────────────────
    return res.json({
      message: "Recharge pins generated successfully",
      pins: pin.split(",").map((p) => p.trim()),
      serial: daltechResponse.data.serial,
      load_pin: daltechResponse.data.load_pin,
      check_balance: daltechResponse.data.check_balance,
      walletBalance: user.walletBalance,
    });
  } catch (err) {
    console.error("RECHARGE PIN UNHANDLED ERROR:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;