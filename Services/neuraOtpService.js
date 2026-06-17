const axios = require("axios");

const BASE_URL = "https://www.neuraotp.com.ng/stubs/handler_api.php";
const API_KEY = (process.env.NEURA_API_KEY || "").trim();

/**
 * GET BALANCE
 */
const getBalance = async () => {
    const res = await axios.get(BASE_URL, {
        params: { action: "getBalance", api_key: API_KEY },
    });
    // Response: ACCESS_BALANCE:9274.56
    const raw = res.data;
    if (String(raw).startsWith("ACCESS_BALANCE:")) {
        return { status: "success", balance: String(raw).split(":")[1] };
    }
    return { status: "error", message: raw };
};

/**
 * GET SERVICES
 */
const getServices = async () => {
    const res = await axios.get(BASE_URL, {
        params: { action: "getServices", api_key: API_KEY },
    });
    return res.data;
};

/**
 * GET NUMBER
 */
const getNumber = async ({ service, country = "usa", carrier, areaCodes, duration, specificNumber }) => {
    const params = { action: "getNumber", api_key: API_KEY, service, country };
    if (carrier) params.carrier = carrier;
    if (areaCodes) params.area_codes = areaCodes;
    if (duration) params.duration = duration;
    if (specificNumber) params.specific_number = specificNumber;

    const res = await axios.get(BASE_URL, { params });

    // Response: ACCESS_NUMBER:ORDER_ID:PHONE_NUMBER
    const raw = String(res.data);
    if (raw.startsWith("ACCESS_NUMBER:")) {
        const parts = raw.split(":");
        return { status: "success", orderId: parts[1], phone: parts[2] };
    }
    return { status: "error", message: raw };
};

/**
 * GET STATUS (check for OTP)
 */
const getStatus = async (orderId) => {
    const res = await axios.get(BASE_URL, {
        params: { action: "getStatus", api_key: API_KEY, id: orderId },
    });

    const raw = String(res.data);

    if (raw.startsWith("STATUS_OK:")) {
        return { status: "success", code: raw.replace("STATUS_OK:", "") };
    }
    if (raw === "STATUS_WAIT_CODE" || raw === "STATUS_WAIT_RETRY") {
        return { status: "waiting" };
    }
    if (raw === "STATUS_CANCEL") {
        return { status: "cancelled" };
    }
    return { status: "error", message: raw };
};

/**
 * CANCEL ORDER
 */
const cancelOrder = async (orderId) => {
    const res = await axios.get(BASE_URL, {
        params: { action: "setStatus", api_key: API_KEY, id: orderId, status: 8 },
    });
    const raw = String(res.data);
    return { status: raw.includes("ACCESS_CANCEL") ? "cancelled" : "error", message: raw };
};

/**
 * RETRY SMS
 */
const retrySms = async (orderId) => {
    const res = await axios.get(BASE_URL, {
        params: { action: "setStatus", api_key: API_KEY, id: orderId, status: 3 },
    });
    const raw = String(res.data);
    return { status: raw.includes("ACCESS_RETRY_GET") ? "retrying" : "error", message: raw };
};

module.exports = {
    getBalance,
    getServices,
    getNumber,
    getStatus,
    cancelOrder,
    retrySms,
};