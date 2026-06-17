const express = require("express");
const Transaction = require("../models/Transaction");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// /all MUST be first before /:userId
router.get("/all", authMiddleware, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const transactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .populate("user", "username email")
      .populate("userId", "username email");

    res.json({ transactions });
  } catch (err) {
    console.error("GET ALL TRANSACTIONS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const transactions = await Transaction.find({
      $or: [{ user: userId }, { userId: userId }],
    }).sort({ createdAt: -1 });

    res.json({ transactions });
  } catch (err) {
    console.error("GET TRANSACTIONS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;