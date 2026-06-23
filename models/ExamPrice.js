const mongoose = require("mongoose");

const examPriceSchema = new mongoose.Schema({
  service: { type: String, required: true, unique: true },
  price:   { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model("ExamPrice", examPriceSchema);