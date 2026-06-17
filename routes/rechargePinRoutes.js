const express = require("express");
const axios = require("axios");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");

const router = express.Router();

const BASE_URL = "https://www.nellobytesystems.com";
const USER_ID = process.env.CLUBKONNECT_USER_ID;
const API_KEY = process.env.CLUBKONNECT_API_KEY;

const networkMap = {
    mtn: "01",
    glo: "02",
    "9mobile": "03",
    airtel: "04",
};

const generateRequestId = () => `EPIN${Date.now()}`;

// ─── BUY RECHARGE PINS ────────────────────────────────────────────────────────
router.post("/buy", async (req, res) => {
    try {
        const { userId, network, amount, quantity } = req.body;

        if (!userId || !network || !amount || !quantity) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const allowedAmounts = [100, 200, 500];
        if (!allowedAmounts.includes(Number(amount))) {
            return res.status(400).json({ message: "Allowed amounts are ₦100, ₦200, ₦500 only" });
        }

        if (Number(quantity) < 1 || Number(quantity) > 100) {
            return res.status(400).json({ message: "Quantity must be between 1 and 100" });
        }

        const networkCode = networkMap[network.toLowerCase()];
        if (!networkCode) {
            return res.status(400).json({ message: "Invalid network" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const totalCost = Number(amount) * Number(quantity);
        if (user.walletBalance < totalCost) {
            return res.status(400).json({ message: "Insufficient wallet balance" });
        }

        const requestId = generateRequestId();

        console.log("=== CLUBKONNECT EPIN DEBUG ===");
        console.log("USER_ID:", USER_ID);
        console.log("API_KEY:", API_KEY);
        console.log("NETWORK CODE:", networkCode);
        console.log("AMOUNT:", amount);
        console.log("QUANTITY:", quantity);
        console.log("REQUEST ID:", requestId);
        console.log("==============================");

        const url = `${BASE_URL}/APIEPINV1.asp?UserID=${USER_ID}&APIKey=${API_KEY}&MobileNetwork=${networkCode}&Value=${amount}&Quantity=${quantity}&RequestID=${requestId}`;

        console.log("FULL URL:", url);

        const response = await axios.get(url);

        console.log("CLUBKONNECT EPIN RESPONSE:", JSON.stringify(response.data));

        const pins = response.data?.TXN_EPIN;

        if (!pins || !Array.isArray(pins) || pins.length === 0) {
            return res.status(400).json({
                message: response.data?.status || response.data?.StatusCode || "Failed to generate pins. Try again.",
            });
        }

        user.walletBalance -= totalCost;
        await user.save();

        // ── FIX: type was "education" — changed to "recharge-pin" so it
        //         appears in the correct category for both user and admin ──
        await Transaction.create({
            userId: user._id,
            user: user._id,
            type: "recharge-pin",
            amount: totalCost,
            status: "success",
            reference: requestId,
            description: `${network.toUpperCase()} ₦${amount} x${quantity} Recharge PIN(s)`,
        });

        return res.json({
            message: "Pins generated successfully",
            pins,
            walletBalance: user.walletBalance,
        });

    } catch (err) {
        console.error("RECHARGE PIN ERROR:", err);
        res.status(500).json({ message: err.message || "Server error" });
    }
});

module.exports = router;