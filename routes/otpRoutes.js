// routes/otpRoutes.js
const express = require("express");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");
const OtpMarkup = require("../models/OtpMarkup");
const {
    getBalance,
    getServices,
    getNumber,
    getStatus,
    cancelOrder,
    retrySms,
} = require("../services/neuraOtpService");

const router = express.Router();

// ─── Helper: apply markup to a base price ───────────────────
const applyMarkup = (basePrice, markupPercent = 0, markupFixed = 0) => {
    const withFixed = basePrice + markupFixed;
    const withPercent = withFixed * (1 + markupPercent / 100);
    return Math.ceil(withPercent * 100) / 100;
};

// ─── Helper: get current markup settings ────────────────────
const getMarkupSettings = async () => {
    try {
        const markup = await OtpMarkup.findOne({ isActive: true });
        if (markup) {
            return {
                markupPercent: markup.markupPercent || 0,
                markupFixed: markup.markupFixed || 0,
            };
        }
    } catch (err) {
        console.log("Could not fetch OTP markup:", err.message);
    }
    return { markupPercent: 0, markupFixed: 0 };
};

// ─── GET BALANCE ─────────────────────────────────────────────
router.get("/balance", async (req, res) => {
    try {
        const result = await getBalance();
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET SERVICES (with markup applied) ──────────────────────
router.get("/services", async (req, res) => {
    try {
        const result = await getServices();
        const { markupPercent, markupFixed } = await getMarkupSettings();

        const marked = {};
        for (const [key, val] of Object.entries(result)) {
            const basePrice = parseFloat(val.price) || 0;
            const markedPrice = applyMarkup(basePrice, markupPercent, markupFixed);
            marked[key] = {
                ...val,
                price: markedPrice,
                base_price: basePrice,
            };
        }

        res.json(marked);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET NUMBER (deduct wallet) ───────────────────────────────
router.post("/get-number", async (req, res) => {
    try {
        const { service, country, carrier, areaCodes, duration, specificNumber, userId } = req.body;

        if (!service) return res.status(400).json({ message: "service is required" });
        if (!userId) return res.status(400).json({ message: "userId is required" });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const servicesData = await getServices();
        const serviceInfo = servicesData[service];
        if (!serviceInfo) return res.status(400).json({ message: "Invalid service" });

        const { markupPercent, markupFixed } = await getMarkupSettings();
        const basePrice = parseFloat(serviceInfo.price) || 0;
        const markedUpPrice = applyMarkup(basePrice, markupPercent, markupFixed);

        console.log(`OTP MARKUP: base=₦${basePrice} | charged=₦${markedUpPrice} | profit=₦${(markedUpPrice - basePrice).toFixed(2)}`);

        if (user.walletBalance < markedUpPrice) {
            return res.status(400).json({
                message: `Insufficient balance. You need ₦${markedUpPrice.toFixed(2)} but have ₦${user.walletBalance.toFixed(2)}`,
            });
        }

        const result = await getNumber({ service, country, carrier, areaCodes, duration, specificNumber });

        if (result.status !== "success") {
            return res.status(400).json({ message: result.message });
        }

        user.walletBalance -= markedUpPrice;
        await user.save();

        // ── FIX: added user: user._id so admin can see this transaction ──
        await Transaction.create({
            userId: user._id,
            user: user._id,
            type: "otp",
            amount: markedUpPrice,
            status: "success",
            reference: result.orderId || `OTP-${Date.now()}`,
            description: `Virtual Number - ${service} for ${result.phone}`,
            meta: {
                basePrice,
                profit: parseFloat((markedUpPrice - basePrice).toFixed(2)),
                service,
                orderId: result.orderId,
                phone: result.phone,
                country: country || "usa",
            },
        });

        res.json({
            ...result,
            walletBalance: user.walletBalance,
            charged: markedUpPrice,
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET STATUS (poll for OTP) ────────────────────────────────
router.get("/status/:orderId", async (req, res) => {
    try {
        const result = await getStatus(req.params.orderId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── CANCEL ORDER ─────────────────────────────────────────────
router.post("/cancel/:orderId", async (req, res) => {
    try {
        const result = await cancelOrder(req.params.orderId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── RETRY SMS ────────────────────────────────────────────────
router.post("/retry/:orderId", async (req, res) => {
    try {
        const result = await retrySms(req.params.orderId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET MARKUP (admin) ───────────────────────────────────────
router.get("/markup", async (req, res) => {
    try {
        const markup = await OtpMarkup.findOne();
        res.json(markup || { markupPercent: 0, markupFixed: 0, isActive: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── SET MARKUP (admin) ───────────────────────────────────────
router.post("/markup", async (req, res) => {
    try {
        const { markupPercent, markupFixed, isActive } = req.body;
        const markup = await OtpMarkup.findOneAndUpdate(
            {},
            {
                markupPercent: Number(markupPercent) || 0,
                markupFixed: Number(markupFixed) || 0,
                isActive: typeof isActive === "boolean" ? isActive : true,
            },
            { upsert: true, new: true }
        );
        res.json({ message: "OTP markup updated successfully", markup });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── RESET MARKUP (admin) ─────────────────────────────────────
router.delete("/markup", async (req, res) => {
    try {
        await OtpMarkup.findOneAndUpdate(
            {},
            { markupPercent: 0, markupFixed: 0, isActive: true },
            { upsert: true, new: true }
        );
        res.json({ message: "OTP markup reset to zero" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;