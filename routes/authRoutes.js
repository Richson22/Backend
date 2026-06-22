const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const User = require("../models/Users");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

const otpStore = {};

// A real bcryptjs hash always looks like $2a$12$..., $2b$12$..., etc.
// Anything in `password` that doesn't match this is not a hash we created —
// almost always a raw Google `sub` ID from an OAuth-created account.
const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$/;
const isLocalPassword = (password) => Boolean(password) && BCRYPT_HASH_REGEX.test(password);

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(toEmail, otp) {
  const { error } = await resend.emails.send({
    from: "VTU Admin <onboarding@resend.dev>", // Change to your domain email in production
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

  if (error) throw new Error(error.message);
}

// Strip the password hash before a user object ever goes in a response.
function sanitizeUser(user, isAdminOverride) {
  const obj = user.toObject ? user.toObject() : { ...user._doc };
  delete obj.password;
  return { ...obj, isAdmin: isAdminOverride ?? Boolean(obj.isAdmin) };
}

// ─── SIGNUP ───────────────────────────────────────────────────────────────────
router.post("/signup", async (req, res) => {
  try {
    const { name, username, password, email } = req.body;

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      // Fix: a Google-created account has a non-bcrypt value in `password`
      // (or none at all, if you've updated /google to stop setting it).
      // Give a useful message instead of a dead-end "already exists".
      if (!isLocalPassword(existingUser.password)) {
        return res.status(400).json({
          message: "This email is already registered via Google Sign-In. Please log in with Google instead.",
        });
      }
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

    return res.status(201).json({ message: "User created", user: sanitizeUser(user) });
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

    // ⚠️ These are hardcoded in source and identical to each other.
    // Move to env vars and use a real, distinct password — see note above the file.
    const ADMIN_USER = process.env.ADMIN_USERNAME || "RICHSON-DATA-HUB";
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || "RICHSON-DATA-HUB";

    if (
      username.toLowerCase() === ADMIN_USER.toLowerCase() &&
      password === ADMIN_PASS
    ) {
      const adminEmail = process.env.ADMIN_EMAIL;

      if (!adminEmail) {
        return res.status(500).json({ message: "Admin email not configured in .env" });
      }
      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ message: "RESEND_API_KEY not configured in .env" });
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
    // Fix: match by username OR email, same as signup's duplicate check.
    const user = await User.findOne({ $or: [{ username }, { email: username }] });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Fix: catch Google-only accounts before attempting bcrypt.compare
    // against a value that was never a bcrypt hash to begin with.
    if (!isLocalPassword(user.password)) {
      return res.status(400).json({
        message: "This account uses Google Sign-In. Please log in with Google.",
      });
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
      user: sanitizeUser(user, isAdmin),
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

    const ADMIN_USER = process.env.ADMIN_USERNAME || "RICHSON-DATA-HUB";
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

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email: email.trim() });
    if (!user) return res.status(400).json({ message: "No account found with that email" });

    if (!isLocalPassword(user.password)) {
      return res.status(400).json({ message: "This account uses Google Sign-In. Password reset is not available." });
    }

    const otp = generateOtp();
    otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

    await resend.emails.send({
      from: "VTU Admin <onboarding@resend.dev>",
      to: email,
      subject: "Your Password Reset Code",
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
          <h2>Password Reset Code</h2>
          <p>Use the code below to reset your password. It expires in <b>5 minutes</b>.</p>
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

    return res.json({ message: "Reset code sent to your email" });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ─── VERIFY RESET OTP ─────────────────────────────────────────────────────────
router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and code are required" });

    const record = otpStore[email];
    if (!record) return res.status(400).json({ message: "No reset code found. Please request a new one." });
    if (Date.now() > record.expiresAt) {
      delete otpStore[email];
      return res.status(400).json({ message: "Code has expired. Please request a new one." });
    }
    if (record.otp !== otp) return res.status(400).json({ message: "Invalid code" });

    return res.json({ message: "Code verified" });
  } catch (err) {
    console.error("VERIFY RESET OTP ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const record = otpStore[email];
    if (!record) return res.status(400).json({ message: "No reset code found. Please start over." });
    if (Date.now() > record.expiresAt) {
      delete otpStore[email];
      return res.status(400).json({ message: "Code has expired. Please start over." });
    }
    if (record.otp !== otp) return res.status(400).json({ message: "Invalid code" });

    const hashed = await bcrypt.hash(newPassword, 12);
    await User.findOneAndUpdate({ email: email.trim() }, { password: hashed });

    delete otpStore[email];

    return res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
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