const express = require("express");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");
const { buyAirtime } = require("../services/vtuService");

const router = express.Router();

router.post("/buy", async (req, res) => {
    try {
        const { userId, phone, amount, network } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.walletBalance < amount) {
            return res.status(400).json({ message: "Insufficient balance" });
        }

        const vtuResponse = await buyAirtime({ phone, amount, network });
        console.log("AIRTIME RESPONSE:", vtuResponse);

        const isSuccess = vtuResponse?.status === "success";

        // ── FIX: added user: user._id so admin can see this transaction ──
        await Transaction.create({
            userId: user._id,
            user: user._id,
            type: "airtime",
            amount,
            status: isSuccess ? "success" : "failed",
            reference: vtuResponse?.request_id || `AIR-${Date.now()}`,
            description: `${network.toUpperCase()} airtime of ₦${amount} to ${phone}`,
        });

        if (!isSuccess) {
            return res.status(400).json({
                message: vtuResponse?.message || "Airtime purchase failed",
            });
        }

        // Only deduct wallet on success
        user.walletBalance -= amount;
        await user.save();

        res.json({
            message: "Airtime sent successfully",
            walletBalance: user.walletBalance,
        });

    } catch (err) {
        console.error("AIRTIME ERROR:", err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;