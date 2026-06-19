const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/Users");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const otpStore = {};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  family: 4,
});

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(toEmail, otp) {
  await transporter.sendMail({
    from: `"VTU Admin" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Your Admin Login Code",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
        <h2>Admin Verification Code</h2>
        <p>Use the code below to complete your login. It expires in <b>5 minutes</b>.</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; 
                    padding: 16px; background: #f1f5f9; border-radius: 8px; 
                    text-align: center;">
          ${otp}
        </div>
        <p style="color: #94a3b8; margin-top: 16px; font-size: 13px;">
          If you didn't request this, ignore this email.
        </p>
      </div>
    `,
  });
}

// ─── SIGNUP ───────────────────────────────────────────────────────────────────
router.post("/signup", async (req, res) => {
  try {
    const { name, username, password, email } = req.body;

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      walletBalance: 0,
      isAdmin: false,
    });

    return res.status(201).json({ message: "User created", user });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    let { username, password } = req.body;

    username = (username || "").trim();
    password = (password || "").trim();

    console.log("LOGIN ATTEMPT:", username);

    const ADMIN_USER = "RICHSON-DATA-HUB";
    const ADMIN_PASS = "RICHSON-DATA-HUB";

    if (
      username.toLowerCase() === ADMIN_USER.toLowerCase() &&
      password === ADMIN_PASS
    ) {
      const adminEmail = process.env.ADMIN_EMAIL;

      console.log("=== ADMIN LOGIN DEBUG ===");
      console.log("ADMIN_EMAIL:", adminEmail);
      console.log("EMAIL_USER:", process.env.EMAIL_USER);
      console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? "SET ✅" : "NOT SET ❌");
      console.log("JWT_SECRET:", process.env.JWT_SECRET ? "SET ✅" : "NOT SET ❌");
      console.log("=========================");

      if (!adminEmail) {
        return res.status(500).json({ message: "Admin email not configured in .env" });
      }

      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return res.status(500).json({ message: "Email credentials not configured in .env" });
      }

      const otp = generateOtp();
      otpStore[adminEmail] = {
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };

      await sendOtpEmail(adminEmail, otp);

      return res.json({
        message: "OTP sent to admin email",
        requiresOtp: true,
        email: adminEmail,
      });
    }

    // ── Normal user login ──
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isAdmin = Boolean(user.isAdmin);
    const token = jwt.sign(
      { id: user._id, username: user.username, isAdmin },
      process.env.JWT_SECRET || "secretKey123",
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: { ...user._doc, isAdmin },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ─── VERIFY ADMIN OTP ─────────────────────────────────────────────────────────
router.post("/verify-admin-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const record = otpStore[email];

    if (!record) {
      return res.status(400).json({ message: "No OTP found. Please login again." });
    }

    if (Date.now() > record.expiresAt) {
      delete otpStore[email];
      return res.status(400).json({ message: "OTP has expired. Please login again." });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    delete otpStore[email];

    const ADMIN_USER = "RICHSON-DATA-HUB";
    const token = jwt.sign(
      { id: "admin-static", username: ADMIN_USER, isAdmin: true },
      process.env.JWT_SECRET || "secretKey123",
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Admin verified successfully",
      token,
      user: {
        id: "admin-static",
        name: "Super Admin",
        username: ADMIN_USER,
        email,
        isAdmin: true,
      },
    });
  } catch (err) {
    console.error("OTP VERIFY ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

// ─── PROFILE ──────────────────────────────────────────────────────────────────
router.get("/profile", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select("-password");
  return res.json({
    user: { ...user._doc, isAdmin: Boolean(user.isAdmin) },
  });
});

module.exports = router;