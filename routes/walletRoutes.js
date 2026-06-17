const express = require("express");
const axios = require("axios");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");

const router = express.Router();

// ─── VERIFY PAYSTACK PAYMENT ──────────────────────────────────────────────────
router.post("/verify-payment", async (req, res) => {
    try {
        const { reference, userId } = req.body;

        // 1. Verify payment with Paystack
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            }
        );

        const payment = response.data.data;

        // 2. Check payment success
        if (payment.status !== "success") {
            return res.status(400).json({ message: "Payment not successful" });
        }

        // 3. Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // 4. Prevent double crediting
        const existingTx = await Transaction.findOne({ reference });
        if (existingTx) {
            return res.status(400).json({ message: "Transaction already processed" });
        }

        // 5. Use Paystack verified amount (convert kobo to naira)
        const verifiedAmount = payment.amount / 100;
        const charge = 30;
        const creditAmount = verifiedAmount - charge;

        if (creditAmount <= 0) {
            return res.status(400).json({ message: "Amount too low. Minimum funding is ₦31." });
        }

        // 6. Update wallet
        user.walletBalance += creditAmount;
        await user.save();

        // 7. Save transaction
        await Transaction.create({
            userId: user._id,
            user: user._id,
            type: "fund",
            amount: creditAmount,
            status: "success",
            reference,
            description: `Wallet funding via Paystack (₦${charge} charge deducted)`,
        });

        res.json({
            message: "Wallet funded successfully",
            walletBalance: user.walletBalance,
        });

    } catch (error) {
        console.error("VERIFY PAYMENT ERROR:", error);
        res.status(500).json({ message: error.message });
    }
});

// ─── GET USER TRANSACTIONS ────────────────────────────────────────────────────
router.get("/transactions/:userId", async (req, res) => {
    try {
        const transactions = await Transaction.find({
            $or: [
                { userId: req.params.userId },
                { user: req.params.userId },
            ],
        }).sort({ createdAt: -1 }).limit(50);

        res.json({ transactions });
    } catch (error) {
        console.error("GET TRANSACTIONS ERROR:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;