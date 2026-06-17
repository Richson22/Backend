const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/Users");

router.post("/", async (req, res) => {
  const { token } = req.body;

  console.log("1. Route hit");
  console.log("2. Token received:", token ? "YES" : "NO");

  try {
    console.log("3. Calling Google userinfo...");

    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("4. Google response status:", googleRes.status);

    const googleData = await googleRes.json();
    console.log("5. Google data:", googleData);

    if (!googleRes.ok) {
      return res.status(401).json({ success: false, message: "Invalid Google token" });
    }

    const { email, name, sub: googleId } = googleData;

    console.log("6. Email:", email);
    console.log("7. Name:", name);

    if (!email) {
      return res.status(400).json({ success: false, message: "Could not get email from Google" });
    }

    let user = await User.findOne({ email });
    console.log("8. Existing user found:", user ? "YES" : "NO");

    if (!user) {
      // Create new user
      const baseUsername = name.toLowerCase().replace(/\s+/g, "") + Math.floor(Math.random() * 1000);
      console.log("9. Creating new user with username:", baseUsername);

      user = await User.create({
        name,
        email,
        username: baseUsername,
        password: googleId,
        isVerified: true,
        role: "user",
        status: "active",
      });

      console.log("10. New user created:", user._id);
    } else {
      // 👇 Update name from Google every time they sign in
      user.name = name;
      await user.save();
      console.log("9. Existing user name updated to:", name);
    }

    if (user.status === "suspended") {
      return res.status(403).json({ success: false, message: "Your account has been suspended." });
    }

    const jwtToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("11. JWT created successfully");

    res.status(200).json({
      success: true,
      token: jwtToken,
      user: {
        id: user._id,
        name: user.name,       // 👈 now returns Google's name
        email: user.email,
        username: user.username,
        role: user.role,
        walletBalance: user.walletBalance,
      },
    });

  } catch (error) {
    console.error("GOOGLE AUTH ERROR:", error.message);
    console.error("FULL ERROR:", error);
    res.status(500).json({ success: false, message: "Google authentication failed" });
  }
});

module.exports = router;