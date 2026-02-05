const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

const getAccessToken = async () => {
    if (!PAYPAL_CLIENT || !PAYPAL_SECRET || !PAYPAL_API) {
        throw new Error('Missing PayPal configuration.');
    }

    if (typeof fetch !== 'function') {
        throw new Error('Global fetch is not available.');
    }

    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    const data = await response.json();
    return data.access_token;
};

const refundCapture = async (captureId, amount, currencyCode) => {
    const accessToken = await getAccessToken();
    const payload = {
        amount: {
            value: Number(amount).toFixed(2),
            currency_code: currencyCode || 'SGD'
        }
    };

    const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    return {
        status: response.status,
        data
    };
};

module.exports = {
    refundCapture
};
