const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  type: {
    type: String,
    required: true,
    enum: ["fund", "airtime", "data", "otp", "withdrawal", "education", "waec", "electricity"],
  },

  subtype: {
    type: String,
    default: "",
  },

  amount: {
    type: Number,
    required: true,
  },

  status: {
    type: String,
    default: "success",
    enum: ["success", "failed", "pending"],
  },

  reference: {
    type: String,
  },

  requestId: {
    type: String,
  },

  phone: {
    type: String,
    default: "",
  },

  description: {
    type: String,
    default: "",
  },

  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Transaction", transactionSchema);