const express = require("express");
const axios = require("axios");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
const ExamPrice = require("../models/ExamPrice");

const defaultPrices = {
  waec:           3500,
  neco:           3500,
  jamb_de:        3500,
  jamb_utme_only: 4700,
  jamb_utme_mock: 5200,
  jamb_mock:      2000,
  nabteb:         3500,
};

async function getPrice(service) {
  try {
    const record = await ExamPrice.findOne({ service: service.toLowerCase() });
    return record ? record.price : defaultPrices[service] || 0;
  } catch {
    return defaultPrices[service] || 0;
  }
}

const DALTECH_BASE = "https://daltechsubapi.com.ng/api/exampin/";
const DALTECH_TOKEN = process.env.DALTECH_TOKEN;

const providerMap = {
  waec: "1",
  neco: "2",
  jamb: "3",
  nabteb: "4",
};

// prices now come from DB via getPrice()
const generateRef = () =>
  `EXAM_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;


// ── GET WAEC VARIATIONS ───────────────────────────────────────────────────────
router.get("/waec-result/variations", async (req, res) => {
  try {
    const price = await getPrice("waec");
    return res.json({
      variations: [
        {
          variation_code: "waecdirect",
          name: "WAEC Result Checker PIN",
          variation_amount: String(price),
        },
      ],
    });
  } catch (err) {
    console.error("WAEC VARIATIONS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
});


// ── GET JAMB VARIATIONS ───────────────────────────────────────────────────────
router.get("/jamb/variations", async (req, res) => {
  try {
    const [de, utme, utmeMock, mock] = await Promise.all([
      getPrice("jamb_de"),
      getPrice("jamb_utme_only"),
      getPrice("jamb_utme_mock"),
      getPrice("jamb_mock"),
    ]);
    return res.json({
      variations: [
        { variation_code: "de",           name: "JAMB Direct Entry PIN",    variation_amount: String(de) },
        { variation_code: "utme-no-mock", name: "JAMB UTME PIN (No Mock)",  variation_amount: String(utme) },
        { variation_code: "utme-mock",    name: "JAMB UTME + Mock PIN",     variation_amount: String(utmeMock) },
        { variation_code: "mock",         name: "JAMB Mock PIN",            variation_amount: String(mock) },
      ],
    });
  } catch (err) {
    console.error("JAMB VARIATIONS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
});


// ── BUY EXAM PINS (DALTECH) ───────────────────────────────────────────────────
router.post("/daltech/buy", authMiddleware, async (req, res) => {
  try {
    // ── Validation ────────────────────────────────────────────────────────────
    const { provider } = req.body;
    const qty = Number(req.body.quantity ?? 1);

    if (!provider) {
      return res.status(400).json({ message: "provider is required" });
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number between 1 and 50" });
    }

    const providerCode = providerMap[provider.toLowerCase()];
    if (!providerCode) {
      return res.status(400).json({
        message: `Invalid provider. Use: ${Object.keys(providerMap).join(", ")}`,
      });
    }

    // ── Pricing ───────────────────────────────────────────────────────────────
    // TODO: replace with a real price lookup from your DB/config
  const pricePerPin = await getPrice(provider.toLowerCase());

    // ── Atomic balance deduction (prevents double-spend race condition) ────────
    const user = await User.findOneAndUpdate(
      { _id: req.user.id, walletBalance: { $gte: totalAmount } },
      { $inc: { walletBalance: -totalAmount } },
      { new: true }
    );

    if (!user) {
      return res.status(400).json({
        message: `Insufficient balance. You need ₦${totalAmount} to complete this purchase.`,
      });
    }

    const ref = generateRef();

    console.log("=== DALTECH EXAMPIN DEBUG ===");
    console.log("PROVIDER:", provider, "→", providerCode);
    console.log("QUANTITY:", qty);
    console.log("REF:", ref);
    console.log("=============================");

    // ── Call Daltech API ──────────────────────────────────────────────────────
    let daltechResponse;
    try {
      daltechResponse = await axios.get(DALTECH_BASE, {
        params: {
          provider: providerCode,
          quantity: String(qty),
          ref,
        },
        headers: { Authorization: `Token ${DALTECH_TOKEN}` },
      });
    } catch (apiErr) {
      // Network/timeout error — refund immediately
      console.error("DALTECH EXAMPIN API CALL FAILED:", apiErr.message);
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { walletBalance: totalAmount },
      });
      return res.status(502).json({
        message: "Could not reach the pin provider. Your wallet was not charged.",
      });
    }

    console.log(
      "DALTECH EXAMPIN RESPONSE:",
      JSON.stringify(daltechResponse.data, null, 2)
    );

    const { status, pin, msg } = daltechResponse.data;

    if (status !== "success" || !pin) {
      // API responded but failed — refund immediately
      console.warn("DALTECH EXAMPIN non-success:", daltechResponse.data);
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { walletBalance: totalAmount },
      });
      return res.status(400).json({
        message:
          msg ||
          daltechResponse.data?.Status ||
          "Failed to generate exam pins. Your wallet was not charged.",
      });
    }

    // ── Save transaction record ───────────────────────────────────────────────
    const pins = pin.split(",").map((p) => p.trim());

    try {
      await Transaction.create({
        userId: user._id,
        user: user._id,
        type: "education",
        subtype: provider.toLowerCase(),
        amount: totalAmount,
        status: "success",
        requestId: ref,
        meta: { provider, providerCode, quantity: qty, pins },
      });
    } catch (dbErr) {
      // Pins were delivered — do NOT refund. Log for manual reconciliation.
      console.error(
        "CRITICAL: Transaction record failed after successful exam pin generation.",
        { ref, userId: user._id, error: dbErr.message }
      );
    }

    // ── Success ───────────────────────────────────────────────────────────────
    return res.json({
      message: "Exam pins generated successfully",
      pins,
      amount: totalAmount,
      newWalletBalance: user.walletBalance,
      status: "success",
    });
  } catch (err) {
    console.error("DALTECH EXAMPIN UNHANDLED ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;