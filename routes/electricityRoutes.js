const express = require("express");
const axios = require("axios");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");
const { verifyMeter, buyElectricity } = require("../services/vtuService");

const router = express.Router();

// GET ELECTRICITY PLANS
router.get("/plans", async (req, res) => {
    try {
        const result = await axios.get("https://www.neuraotp.com.ng/stubs/vtu.php", {
            params: {
                action: "getPlans",
                api_key: process.env.NEURA_API_KEY,
                type: "electricity",
            },
        });
        console.log("ELECTRICITY PLANS:", JSON.stringify(result.data));
        res.json(result.data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// VERIFY METER
router.post("/verify", async (req, res) => {
    console.log("VERIFY BODY:", req.body);
    try {
        const { meterNumber, meterType, provider } = req.body;

        if (!meterNumber || !meterType || !provider) {
            return res.status(400).json({
                message: `Missing fields — meterNumber: ${meterNumber}, meterType: ${meterType}, provider: ${provider}`,
            });
        }

        const result = await verifyMeter({ meterNumber, meterType, provider });
        console.log("METER VERIFY RESPONSE:", result);

        if (result.status !== "success" || !result.name) {
            return res.status(400).json({ message: result.message || "Invalid meter number" });
        }

        return res.json({
            message: "Meter verified",
            customerName: result.name,
        });
    } catch (err) {
        console.error("METER VERIFY ERROR:", err);
        return res.status(500).json({ message: "Verification failed" });
    }
});

// PAY ELECTRICITY
router.post("/pay", async (req, res) => {
    console.log("PAY BODY:", req.body);
    try {
        const { meterNumber, meterType, provider, amount, phone, userId } = req.body;

        if (!meterNumber || !meterType || !amount || !phone || !userId || !provider) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const parsedAmount = Number(amount);
        if (isNaN(parsedAmount) || parsedAmount < 500) {
            return res.status(400).json({ message: "Minimum amount is ₦500" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.walletBalance < parsedAmount) {
            return res.status(400).json({
                message: `Insufficient balance. Need ₦${parsedAmount}, have ₦${user.walletBalance}`,
            });
        }

        const result = await buyElectricity({
            meterNumber,
            meterType,
            provider,
            amount: parsedAmount,
            phone,
        });

        console.log("ELECTRICITY PAY RESPONSE:", result);

        const isSuccess = result.status === "success";

        // ── FIX: added user: user._id so admin can see this transaction ──
        await Transaction.create({
            userId: user._id,
            user: user._id,
            type: "electricity",
            amount: parsedAmount,
            status: isSuccess ? "success" : "failed",
            reference: result.request_id || `ELEC-${Date.now()}`,
            description: `${provider} ${meterType} payment for meter ${meterNumber}`,
        });

        if (!isSuccess) {
            return res.status(400).json({
                message: result.message || "Payment failed",
            });
        }

        // Only deduct wallet on success
        user.walletBalance -= parsedAmount;
        await user.save();

        return res.json({
            message: result.message || "Electricity payment successful.",
            status: "success",
            token: result.token || null,
            newWalletBalance: user.walletBalance,
        });
    } catch (err) {
        console.error("ELECTRICITY PAY ERROR:", err);
        return res.status(500).json({ message: err.message || "Server error" });
    }
});

module.exports = router;