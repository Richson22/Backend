require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const airtimeRoutes = require("./routes/airtimeRoutes");
const dataRoutes = require("./routes/dataRoutes");
const adminRoutes = require("./routes/adminRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const educationRoutes = require("./routes/educationRoutes");
const electricityRoutes = require("./routes/electricityRoutes");
const otpRoutes = require("./routes/otpRoutes");
const rechargePinRoutes = require("./routes/rechargePinRoutes");
const googleAuthRoutes = require("./routes/googleAuthRoutes"); 

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
       "https://richsondatahub.vercel.app/",
    ],
    credentials: true,
  })
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/airtime", airtimeRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/education", educationRoutes);
app.use("/api/electricity", electricityRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/auth/google", googleAuthRoutes); 

app.get("/", (req, res) => {
    res.send("Backend is running 🚀");
});

app.use((err, req, res, next) => {
    console.error("UNHANDLED ERROR:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected successfully");

        const PORT = process.env.PORT || 5000;

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Local: http://localhost:${PORT}`);
            console.log(`Network: http://127.0.0.1:${PORT}`);
        });
    })
    .catch((err) => {
        console.log("MongoDB connection error:", err);
    });