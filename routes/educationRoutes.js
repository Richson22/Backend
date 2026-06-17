const express = require("express");
const axios = require("axios");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/Users");
const Transaction = require("../models/Transaction");

const router = express.Router();

const CK_BASE = "https://www.nellobytesystems.com";
const CK_USER_ID = process.env.CK_USER_ID || "CK101281077";
const CK_API_KEY = process.env.CK_API_KEY || "4XMWR5N06GE1GI00Y49OV98N33CA24FW4EIQ83Y12DUN0L2G48QD9C4D18N6L800";
const CK_CALLBACK_URL = process.env.CK_CALLBACK_URL || "";

const generateRequestId = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const datePart =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  return `${datePart}-${Math.floor(10000000 + Math.random() * 90000000)}`;
};

const parseCardDetails = (carddetails) => {
  if (!carddetails) return [];
  const parts = carddetails.split(",");
  const serial = parts[0]?.replace(/serial no:/i, "").trim();
  const pin = parts[1]?.replace(/pin:/i, "").trim();
  if (serial && pin) return [{ Serial: serial, Pin: pin }];
  return [];
};

const ckIsSuccess = (result) =>
  String(result.statuscode) === "200" ||
  String(result.status).toUpperCase() === "ORDER_COMPLETED";

const ckIsPending = (result) =>
  String(result.status).toUpperCase() === "ORDER_RECEIVED" ||
  String(result.status).toUpperCase() === "ORDER_ONHOLD";

// ── WAEC PACKAGES (public - no auth needed) ──
router.get("/waec-result/variations", async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APIWAECPackagesV2.asp`, {
      params: { UserID: CK_USER_ID },
    });
    const packages = response.data?.EXAM_TYPE || [];
    const variations = packages.map((p) => ({
      variation_code: p.PRODUCT_CODE,
      name: p.PRODUCT_DESCRIPTION,
      variation_amount: String(p.PRODUCT_AMOUNT || "0"),
    }));
    return res.json({ message: "WAEC packages fetched", variations });
  } catch (err) {
    console.error("WAEC PACKAGES ERROR:", err.message);
    return res.status(500).json({ message: "Failed to fetch WAEC packages" });
  }
});

// ── BUY WAEC ──
router.post("/waec-result/buy", authMiddleware, async (req, res) => {
  try {
    const { variation_code, phone, quantity = 1 } = req.body;
    if (!variation_code || !phone)
      return res.status(400).json({ message: "variation_code and phone are required" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const pkgRes = await axios.get(`${CK_BASE}/APIWAECPackagesV2.asp`, { params: { UserID: CK_USER_ID } });
    const packages = pkgRes.data?.EXAM_TYPE || [];
    const selected = packages.find((p) => p.PRODUCT_CODE === variation_code);
    const unitPrice = selected ? parseFloat(selected.PRODUCT_AMOUNT || 0) : 0;
    const totalAmount = unitPrice * quantity;

    if (user.walletBalance < totalAmount)
      return res.status(400).json({ message: `Insufficient balance. Need ₦${totalAmount}, have ₦${user.walletBalance}` });

    const requestId = generateRequestId();
    const ckRes = await axios.get(`${CK_BASE}/APIWAECV1.asp`, {
      params: {
        UserID: CK_USER_ID, APIKey: CK_API_KEY,
        ExamType: variation_code, PhoneNo: phone.replace(/\D/g, ""),
        RequestID: requestId, ...(CK_CALLBACK_URL ? { CallBackURL: CK_CALLBACK_URL } : {}),
      },
    });

    const result = ckRes.data;
    console.log("CK WAEC BUY:", JSON.stringify(result, null, 2));

    if (!ckIsSuccess(result) && !ckIsPending(result))
      return res.status(400).json({ message: result.remark || result.status || "WAEC purchase failed", raw: result });

    user.walletBalance -= totalAmount;
    await user.save();

    const cards = parseCardDetails(result.carddetails);

    await Transaction.create({
      userId: user._id, user: user._id, type: "education", subtype: "waec",
      amount: totalAmount, status: ckIsSuccess(result) ? "success" : "pending",
      requestId, phone,
      meta: { variation_code, quantity, orderId: result.orderid, carddetails: result.carddetails, cards, remark: result.remark },
    });

    return res.json({
      message: ckIsSuccess(result) ? "WAEC PIN purchased successfully" : "Order received, processing...",
      cards, purchased_code: cards[0]?.Pin || result.carddetails,
      amount: totalAmount, newWalletBalance: user.walletBalance,
      orderId: result.orderid, status: ckIsSuccess(result) ? "success" : "pending",
    });
  } catch (err) {
    console.error("BUY WAEC ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ── WAEC REGISTRATION VARIATIONS ──
router.get("/waec-registration/variations", authMiddleware, async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APIWAECPackagesV2.asp`, { params: { UserID: CK_USER_ID } });
    const packages = response.data?.EXAM_TYPE || [];
    const variations = packages.map((p) => ({
      variation_code: p.PRODUCT_CODE,
      name: p.PRODUCT_DESCRIPTION,
      variation_amount: String(p.PRODUCT_AMOUNT || "0"),
    }));
    return res.json({ message: "WAEC Registration variations fetched", variations });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch variations" });
  }
});

// ── BUY WAEC REGISTRATION ──
router.post("/waec-registration/buy", authMiddleware, async (req, res) => {
  try {
    const { phone, quantity = 1 } = req.body;
    if (!phone) return res.status(400).json({ message: "phone is required" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const pkgRes = await axios.get(`${CK_BASE}/APIWAECPackagesV2.asp`, { params: { UserID: CK_USER_ID } });
    const packages = pkgRes.data?.EXAM_TYPE || [];
    const selected = packages.find((p) => String(p.PRODUCT_CODE || "").toLowerCase().includes("registration"));
    const unitPrice = selected ? parseFloat(selected.PRODUCT_AMOUNT || 0) : 0;
    const totalAmount = unitPrice * quantity;

    if (user.walletBalance < totalAmount)
      return res.status(400).json({ message: `Insufficient balance. Need ₦${totalAmount}, have ₦${user.walletBalance}` });

    const requestId = generateRequestId();
    const ckRes = await axios.get(`${CK_BASE}/APIWAECV1.asp`, {
      params: { UserID: CK_USER_ID, APIKey: CK_API_KEY, ExamType: "waec-registration", PhoneNo: phone.replace(/\D/g, ""), RequestID: requestId },
    });

    const result = ckRes.data;
    console.log("CK WAEC REG:", JSON.stringify(result, null, 2));

    if (!ckIsSuccess(result) && !ckIsPending(result))
      return res.status(400).json({ message: result.remark || "WAEC Registration purchase failed" });

    user.walletBalance -= totalAmount;
    await user.save();

    const cards = parseCardDetails(result.carddetails);

    await Transaction.create({
      userId: user._id, user: user._id, type: "education", subtype: "waec-registration",
      amount: totalAmount, status: ckIsSuccess(result) ? "success" : "pending",
      requestId, phone,
      meta: { cards, orderId: result.orderid, carddetails: result.carddetails },
    });

    return res.json({
      message: "WAEC Registration PIN purchased successfully",
      cards, purchased_code: cards[0]?.Pin || result.carddetails,
      amount: totalAmount, newWalletBalance: user.walletBalance,
    });
  } catch (err) {
    console.error("BUY WAEC REG ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ── JAMB PACKAGES (public - no auth needed) ──
router.get("/jamb/variations", async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APIJAMBPackagesV2.asp`, { params: { UserID: CK_USER_ID } });
    const packages = response.data?.EXAM_TYPE || [];
    const variations = packages.map((p) => ({
      variation_code: p.PRODUCT_CODE,
      name: p.PRODUCT_DESCRIPTION,
      variation_amount: String(p.PRODUCT_AMOUNT || "0"),
    }));
    return res.json({ message: "JAMB variations fetched", variations });
  } catch (err) {
    console.error("JAMB PACKAGES ERROR:", err.message);
    return res.status(500).json({ message: "Failed to fetch JAMB variations" });
  }
});

// ── VERIFY JAMB PROFILE ──
router.post("/jamb/verify", authMiddleware, async (req, res) => {
  try {
    const { profileId, variation_code } = req.body;
    if (!profileId) return res.status(400).json({ message: "profileId is required" });

    const response = await axios.get(`${CK_BASE}/APIVerifyJAMBV1.asp`, {
      params: {
        UserID: CK_USER_ID,
        APIKey: CK_API_KEY,
        ExamType: variation_code || "de",
        ProfileID: profileId,
      },
    });

    const data = response.data;
    console.log("CK JAMB VERIFY RESPONSE:", JSON.stringify(data, null, 2));

    const customerName = data.customer_name || "";
    if (!customerName || customerName === "INVALID_ACCOUNTNO")
      return res.status(400).json({ message: "Invalid JAMB Profile ID" });

    return res.json({ message: "Profile ID verified", customerName });
  } catch (err) {
    console.error("JAMB VERIFY ERROR:", err.message);
    return res.status(500).json({ message: "Verification failed" });
  }
});

// ── BUY JAMB PIN ──
router.post("/jamb/buy", authMiddleware, async (req, res) => {
  try {
    const { variation_code, profileId, phone } = req.body;
    if (!variation_code || !phone)
      return res.status(400).json({ message: "variation_code and phone are required" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const pkgRes = await axios.get(`${CK_BASE}/APIJAMBPackagesV2.asp`, { params: { UserID: CK_USER_ID } });
    const packages = pkgRes.data?.EXAM_TYPE || [];
    const selected = packages.find((p) => p.PRODUCT_CODE === variation_code);
    const totalAmount = selected ? parseFloat(selected.PRODUCT_AMOUNT || 0) : 0;

    if (user.walletBalance < totalAmount)
      return res.status(400).json({ message: `Insufficient balance. Need ₦${totalAmount}, have ₦${user.walletBalance}` });

    const requestId = generateRequestId();
    const ckRes = await axios.get(`${CK_BASE}/APIJAMBV1.asp`, {
      params: {
        UserID: CK_USER_ID, APIKey: CK_API_KEY,
        ExamType: variation_code, PhoneNo: phone.replace(/\D/g, ""),
        RequestID: requestId,
        ...(profileId ? { ProfileID: profileId } : {}),
        ...(CK_CALLBACK_URL ? { CallBackURL: CK_CALLBACK_URL } : {}),
      },
    });

    const result = ckRes.data;
    console.log("CK JAMB BUY:", JSON.stringify(result, null, 2));

    if (!ckIsSuccess(result) && !ckIsPending(result))
      return res.status(400).json({ message: result.remark || result.status || "JAMB purchase failed", raw: result });

    user.walletBalance -= totalAmount;
    await user.save();

    const cards = parseCardDetails(result.carddetails);
    const pin = cards[0]?.Pin || result.carddetails || null;

    await Transaction.create({
      userId: user._id, user: user._id, type: "education", subtype: "jamb",
      amount: totalAmount, status: ckIsSuccess(result) ? "success" : "pending",
      requestId, phone,
      meta: { variation_code, profileId: profileId || null, orderId: result.orderid, carddetails: result.carddetails, cards, pin, remark: result.remark },
    });

    return res.json({
      message: ckIsSuccess(result) ? "JAMB PIN purchased successfully" : "Order received, processing...",
      Pin: pin, cards, purchased_code: pin,
      amount: totalAmount, newWalletBalance: user.walletBalance,
      orderId: result.orderid, status: ckIsSuccess(result) ? "success" : "pending",
    });
  } catch (err) {
    console.error("BUY JAMB ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ── QUERY BY ORDER ID ──
router.get("/query/order/:orderId", authMiddleware, async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APIQueryV1.asp`, {
      params: { UserID: CK_USER_ID, APIKey: CK_API_KEY, OrderID: req.params.orderId },
    });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── QUERY BY REQUEST ID ──
router.get("/query/request/:requestId", authMiddleware, async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APIQueryV1.asp`, {
      params: { UserID: CK_USER_ID, APIKey: CK_API_KEY, RequestID: req.params.requestId },
    });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── CANCEL ORDER ──
router.post("/cancel/:orderId", authMiddleware, async (req, res) => {
  try {
    const response = await axios.get(`${CK_BASE}/APICancelV1.asp`, {
      params: { UserID: CK_USER_ID, APIKey: CK_API_KEY, OrderID: req.params.orderId },
    });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── REQUERY (backward compat) ──
router.post("/requery", authMiddleware, async (req, res) => {
  try {
    const { request_id, order_id } = req.body;
    if (!request_id && !order_id)
      return res.status(400).json({ message: "request_id or order_id is required" });
    const response = await axios.get(`${CK_BASE}/APIQueryV1.asp`, {
      params: { UserID: CK_USER_ID, APIKey: CK_API_KEY, ...(order_id ? { OrderID: order_id } : { RequestID: request_id }) },
    });
    return res.json({ message: "Transaction status fetched", data: response.data });
  } catch (err) {
    return res.status(500).json({ message: "Failed to query transaction" });
  }
});

module.exports = router;