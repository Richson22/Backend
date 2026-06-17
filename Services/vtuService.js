// services/vtuService.js - Neura API with admin markup support

const axios = require("axios");
const DataMarkup = require("../models/DataMarkup");

const BASE_URL = "https://www.neuraotp.com.ng/stubs/vtu.php";
const API_KEY = (process.env.NEURA_API_KEY || "").trim();

console.log("=== NEURA API KEY ON STARTUP ===");
console.log("API_KEY:", JSON.stringify(API_KEY));
console.log("================================");

const networkMap = {
    mtn: "1",
    airtel: "2",
    glo: "3",
    "9mobile": "4",
};

const cableMap = {
    gotv: "1",
    dstv: "2",
    startimes: "3",
};

const electricDiscoMap = {
    "ikeja-electric":        "1",
    "eko-electric":          "2",
    "kano-electric":         "3",
    "portharcourt-electric": "4",
    "jos-electric":          "5",
    "ibadan-electric":       "6",
    "kaduna-electric":       "7",
    "abuja-electric":        "8",
    "enugu-electric":        "9",
    "yola-electric":         "10",
    "benin-electric":        "11",
    "aba-electric":          "12",
};

const generateRequestId = () => `REQ${Date.now()}`;

/**
 * Apply admin markup to a base price
 * Formula: (basePrice + fixedMarkup) * (1 + percentMarkup/100)
 */
const applyMarkup = (basePrice, markupPercent = 0, markupFixed = 0) => {
    const withFixed = basePrice + markupFixed;
    const withPercent = withFixed * (1 + markupPercent / 100);
    // Round to 2 decimal places
    return Math.ceil(withPercent * 100) / 100;
};

/**
 * GET DATA VARIATIONS
 * Fetches plans from Neura and applies admin markup on top
 */
const getVariations = async (network) => {
    const networkName = network.toUpperCase();

    // ✅ Fetch plans from Neura
    const res = await axios.get(BASE_URL, {
        params: { action: "getPlans", api_key: API_KEY, type: "data" },
    });

    console.log("RAW PLANS RESPONSE:", JSON.stringify(res.data).slice(0, 1000));

    if (res.data.status !== "success") {
        console.log("getPlans failed:", res.data);
        return [];
    }

    // ✅ Filter by network
    const filtered = res.data.plans.filter(
        (p) => String(p.network || "").toUpperCase() === networkName
    );

    console.log(`PLANS FOR ${networkName}:`, filtered.length);

    // ✅ Fetch admin markup for this network from MongoDB
    let markupPercent = 0;
    let markupFixed = 0;
    try {
        const markup = await DataMarkup.findOne({ network: network.toLowerCase() });
        if (markup && markup.isActive) {
            markupPercent = markup.markupPercent || 0;
            markupFixed = markup.markupFixed || 0;
        }
        console.log(`MARKUP FOR ${networkName}: ${markupPercent}% + ₦${markupFixed} fixed`);
    } catch (err) {
        console.log("Could not fetch markup, using 0:", err.message);
    }

    // ✅ Return plans with markup applied
    return filtered.map((p) => {
        const basePrice = parseFloat(p.price || 0);
        const markedUpPrice = applyMarkup(basePrice, markupPercent, markupFixed);

        return {
            variation_code: String(p.plan_id),
            name: p.name || "Unknown Plan",
            variation_amount: String(markedUpPrice),
            base_amount: String(basePrice),       // original Neura price (for your records)
            plan_type: p.type || "GIFTING",        // for frontend filter
            duration: p.duration || "",            // for subtitle display
        };
    });
};

/**
 * BUY AIRTIME
 */
const buyAirtime = async ({ phone, amount, network }) => {
    try {
        const networkCode = networkMap[network.toLowerCase()];
        if (!networkCode) throw new Error("Invalid network");

        const res = await axios.get(BASE_URL, {
            params: {
                action: "purchase",
                api_key: API_KEY,
                service_type: "airtime",
                network: networkCode,
                phone,
                amount,
                request_id: generateRequestId(),
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * BUY DATA
 */
const buyData = async ({ phone, network, plan }) => {
    try {
        const networkCode = networkMap[network.toLowerCase()];
        if (!networkCode) throw new Error("Invalid network");

        const res = await axios.get(BASE_URL, {
            params: {
                action: "purchase",
                api_key: API_KEY,
                service_type: "data",
                network: networkCode,
                phone,
                plan_id: plan,
                request_id: generateRequestId(),
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * VERIFY METER
 */
const verifyMeter = async ({ meterNumber, meterType, provider }) => {
    try {
        const discoId = electricDiscoMap[provider.toLowerCase()];
        if (!discoId) throw new Error(`Invalid provider: ${provider}`);

        console.log(`verifyMeter: provider=${provider} → discoId=${discoId}`);

        const res = await axios.get(BASE_URL, {
            params: {
                action: "verifyMeter",
                api_key: API_KEY,
                meter_number: meterNumber,
                disco: discoId,
                meter_type: meterType || "prepaid",
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * BUY ELECTRICITY
 */
const buyElectricity = async ({ meterNumber, meterType, provider, amount, phone }) => {
    try {
        const discoId = electricDiscoMap[provider.toLowerCase()];
        if (!discoId) throw new Error(`Invalid provider: ${provider}`);

        console.log(`buyElectricity: provider=${provider} → discoId=${discoId}`);

        const res = await axios.get(BASE_URL, {
            params: {
                action: "purchase",
                api_key: API_KEY,
                service_type: "electricity",
                disco: discoId,
                meter_type: meterType || "prepaid",
                meter_number: meterNumber,
                amount,
                request_id: generateRequestId(),
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * VERIFY CABLE IUC
 */
const verifyIUC = async ({ iuc, cableProvider }) => {
    try {
        const cableId = cableMap[cableProvider.toLowerCase()];
        if (!cableId) throw new Error("Invalid cable provider");

        const res = await axios.get(BASE_URL, {
            params: {
                action: "verifyIUC",
                api_key: API_KEY,
                iuc,
                cable_id: cableId,
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * BUY CABLE
 */
const buyCable = async ({ iuc, cableProvider, planId }) => {
    try {
        const cableId = cableMap[cableProvider.toLowerCase()];
        if (!cableId) throw new Error("Invalid cable provider");

        const res = await axios.get(BASE_URL, {
            params: {
                action: "purchase",
                api_key: API_KEY,
                service_type: "cable",
                cable_id: cableId,
                iuc,
                plan_id: planId,
                request_id: generateRequestId(),
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * BUY EXAM PIN
 */
const buyExamPin = async ({ examId, quantity = 1 }) => {
    try {
        const res = await axios.get(BASE_URL, {
            params: {
                action: "purchase",
                api_key: API_KEY,
                service_type: "exam",
                exam_id: examId,
                quantity,
                request_id: generateRequestId(),
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

/**
 * QUERY TRANSACTION
 */
const queryTransaction = async (requestId) => {
    try {
        const res = await axios.get(BASE_URL, {
            params: {
                action: "getStatus",
                api_key: API_KEY,
                request_id: requestId,
            },
        });

        return res.data;
    } catch (error) {
        throw error.response?.data || error.message;
    }
};

module.exports = {
    buyAirtime,
    buyData,
    getVariations,
    verifyMeter,
    buyElectricity,
    verifyIUC,
    buyCable,
    buyExamPin,
    queryTransaction,
};