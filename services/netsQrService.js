const QRCode = require('qrcode');
const fetchFn = typeof fetch === 'function' ? fetch : null;

const getEnvValue = (...keys) => keys
    .map((key) => (process.env[key] ? String(process.env[key]).trim() : ''))
    .find((value) => value);

const NETS_API_KEY = getEnvValue('NETS_API_KEY', 'API_KEY');
const NETS_PROJECT_ID = getEnvValue('NETS_PROJECT_ID', 'PROJECT_ID');
const NETS_QR_ENDPOINT = getEnvValue('NETS_QR_ENDPOINT', 'OPENAPIPASS_QR_ENDPOINT', 'NETS_OPENAPIPASS_ENDPOINT');
const NETS_REFERENCE_PREFIX = getEnvValue('NETS_MERCHANT_ID', 'NETS_REFERENCE_PREFIX', 'NETS_PROJECT_ID', 'PROJECT_ID') || 'NETS';
const NETS_AMOUNT_UNIT = getEnvValue('NETS_AMOUNT_UNIT') || 'dollars';

const createReference = () => `${NETS_REFERENCE_PREFIX}-${Date.now().toString(36).toUpperCase()}`;

const formatAmount = (amount) => {
    const safeAmount = Number(amount || 0);
    const normalized = Number.isFinite(safeAmount) && safeAmount > 0 ? safeAmount : 0;
    const display = normalized.toFixed(2);
    const payloadAmount = NETS_AMOUNT_UNIT === 'cents'
        ? Math.round(normalized * 100)
        : display;

    return { display, payloadAmount };
};

const pickValue = (obj, keys) => {
    if (!obj) return null;
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            return obj[key];
        }
    }
    return null;
};

const pickFrom = (obj, keys) => pickValue(obj, keys)
    || pickValue(obj && obj.data, keys)
    || pickValue(obj && obj.result, keys)
    || pickValue(obj && obj.payload, keys)
    || pickValue(obj && obj.qr, keys)
    || pickValue(obj && obj.qrCode, keys);

const stripDataUrl = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (trimmed.startsWith('data:image')) {
        const parts = trimmed.split('base64,');
        if (parts.length === 2) {
            return { base64: parts[1], dataUrl: trimmed };
        }
    }
    return { base64: trimmed };
};

const normalizeExpiry = (raw, fallbackMs) => {
    if (!raw) return fallbackMs;
    if (typeof raw === 'number') {
        return raw > 9999999999 ? raw : raw * 1000;
    }
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
        return asNumber > 9999999999 ? asNumber : asNumber * 1000;
    }
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : fallbackMs;
};

const buildPayload = ({ reference, amountPayload, currency }) => ({
    projectId: NETS_PROJECT_ID || undefined,
    amount: amountPayload,
    currency: currency || 'SGD',
    merchantReference: reference,
    description: 'Shirt Shop Order'
});

const buildHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (NETS_API_KEY) {
        headers['x-api-key'] = NETS_API_KEY;
        headers.Authorization = NETS_API_KEY;
    }
    if (NETS_PROJECT_ID) {
        headers['x-project-id'] = NETS_PROJECT_ID;
    }
    return headers;
};

const fetchJson = async (url, options) => {
    if (!fetchFn) {
        return { ok: false, status: 0, data: null, text: '' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetchFn(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (parseErr) {
            data = null;
        }
        return { ok: response.ok, status: response.status, data, text };
    } finally {
        clearTimeout(timeout);
    }
};

const fetchImageAsBase64 = async (imageUrl) => {
    if (!imageUrl) return null;
    if (!fetchFn) return null;
    const response = await fetchFn(imageUrl);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
};

const normalizeApiResponse = async (raw, fallback) => {
    if (typeof raw === 'string') {
        const stripped = stripDataUrl(raw);
        const base64 = stripped ? stripped.base64 : null;
        return {
            reference: fallback.reference,
            amount: fallback.amount,
            currency: fallback.currency,
            expiresAt: fallback.expiresAt,
            qrImageBase64: base64,
            qrImageDataUrl: stripped && stripped.dataUrl ? stripped.dataUrl : (base64 ? `data:image/png;base64,${base64}` : null),
            qrData: null
        };
    }
    const responseData = raw && (raw.data || raw.result || raw.payload || raw) ? (raw.data || raw.result || raw.payload || raw) : raw;
    const reference = pickFrom(responseData, ['reference', 'ref', 'merchantRef', 'merchantReference', 'transactionRef', 'transaction_id', 'paymentRef', 'id']) || fallback.reference;
    const expiry = pickFrom(responseData, ['expiry', 'expiresAt', 'expiryTime', 'expiry_date', 'expiration']);
    const amountValue = pickFrom(responseData, ['amount', 'amountPayable', 'txnAmount', 'total']);
    const currency = pickFrom(responseData, ['currency', 'curr']) || fallback.currency;

    let qrImageBase64 = pickFrom(responseData, [
        'qrImageBase64',
        'qr_image_base64',
        'qrImage',
        'qrCodeImage',
        'qrCodeBase64',
        'imageBase64'
    ]);
    let qrImageUrl = pickFrom(responseData, ['qrImageUrl', 'qr_image_url', 'qrUrl', 'qr_code_url', 'imageUrl']);
    let qrData = pickFrom(responseData, ['qrData', 'qrString', 'qrPayload', 'payload', 'qrContent', 'qr_code']);

    let qrImageDataUrl = null;
    if (qrImageBase64) {
        const stripped = stripDataUrl(qrImageBase64);
        qrImageBase64 = stripped ? stripped.base64 : null;
        qrImageDataUrl = stripped && stripped.dataUrl ? stripped.dataUrl : null;
    }

    if (!qrImageBase64 && qrImageUrl) {
        try {
            qrImageBase64 = await fetchImageAsBase64(qrImageUrl);
        } catch (err) {
            qrImageBase64 = null;
        }
    }

    if (!qrImageBase64 && qrData) {
        qrImageDataUrl = await QRCode.toDataURL(String(qrData), { width: 260, margin: 1 });
        const stripped = stripDataUrl(qrImageDataUrl);
        qrImageBase64 = stripped ? stripped.base64 : null;
    }

    return {
        reference,
        amount: amountValue !== null && amountValue !== undefined ? amountValue : fallback.amount,
        currency,
        expiresAt: normalizeExpiry(expiry, fallback.expiresAt),
        qrImageBase64,
        qrImageDataUrl,
        qrData: qrData || null
    };
};

const createPayment = async ({ amount, currency }) => {
    const reference = createReference();
    const expiresAt = Date.now() + (10 * 60 * 1000);
    const formatted = formatAmount(amount);
    const payload = buildPayload({
        reference,
        amountPayload: formatted.payloadAmount,
        currency: currency || 'SGD'
    });

    let apiResponse = null;
    if (NETS_QR_ENDPOINT && NETS_API_KEY && NETS_PROJECT_ID) {
        try {
            apiResponse = await fetchJson(NETS_QR_ENDPOINT, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify(payload)
            });

            if (!apiResponse.ok) {
                console.warn('NETS QR API returned error:', apiResponse.status);
            }
        } catch (err) {
            console.warn('NETS QR API request failed:', err && err.message ? err.message : err);
        }
    } else {
        console.warn('NETS QR API credentials or endpoint missing. Using fallback QR generation.');
    }

    const fallback = {
        reference,
        amount: formatted.display,
        currency: currency || 'SGD',
        expiresAt
    };

    const rawResponse = apiResponse && (apiResponse.data || apiResponse.text) ? (apiResponse.data || apiResponse.text) : null;
    const normalized = rawResponse
        ? await normalizeApiResponse(rawResponse, fallback)
        : { ...fallback };

    if (!normalized.qrImageBase64 && !normalized.qrData) {
        const fallbackData = `NETS|${normalized.reference}|${normalized.currency}|${formatted.display}`;
        const dataUrl = await QRCode.toDataURL(fallbackData, { width: 260, margin: 1 });
        const stripped = stripDataUrl(dataUrl);
        normalized.qrImageBase64 = stripped ? stripped.base64 : null;
        normalized.qrImageDataUrl = dataUrl;
        normalized.qrData = fallbackData;
    }

    if (!normalized.qrImageDataUrl && normalized.qrImageBase64) {
        normalized.qrImageDataUrl = `data:image/png;base64,${normalized.qrImageBase64}`;
    }

    console.info('NETS QR response:', {
        reference: normalized.reference,
        hasQrImage: Boolean(normalized.qrImageBase64),
        hasQrData: Boolean(normalized.qrData)
    });

    return {
        reference: normalized.reference,
        amount: Number(normalized.amount || formatted.display).toFixed(2),
        currency: normalized.currency || 'SGD',
        expiresAt: normalized.expiresAt,
        qrImageBase64: normalized.qrImageBase64,
        qrImageDataUrl: normalized.qrImageDataUrl,
        qrData: normalized.qrData
    };
};

module.exports = {
    createPayment
};
