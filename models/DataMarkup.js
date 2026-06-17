const mongoose = require("mongoose");
 
const DataMarkupSchema = new mongoose.Schema(
  {
    network: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      enum: ["mtn", "glo", "airtel", "9mobile"],
    },
    markupPercent: {
      type: Number,
      default: 0,   // e.g. 10 means add 10% on top of Neura price
      min: 0,
      max: 100,
    },
    markupFixed: {
      type: Number,
      default: 0,   // e.g. 50 means add ₦50 flat on top of Neura price
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);
 
module.exports = mongoose.model("DataMarkup", DataMarkupSchema);
 