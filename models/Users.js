const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },

  username: {
    type: String,
    required: true,
    unique: true,
  },

  email: {
    type: String,
    unique: true,
    sparse: true,
  },

  password: {
    type: String,
    required: false,
  },

  walletBalance: {
    type: Number,
    default: 0,
  },

  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },

  isVerified: {
    type: Boolean,
    default: false,
  },

  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);