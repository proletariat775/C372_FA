//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: Yeo Jun Long Dave 
// Student ID:24046757
// Class:C372-002
// Date created:06/02/2026
const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

const tokenCache = {
    accessToken: null,
    expiresAt: 0
};

const ensureFetch = () => {
    if (typeof fetch !== 'function') {
        throw new Error('Global fetch is not available. Use Node 18+ or add a fetch polyfill.');
    }
};

const getAccessToken = async () => {
    if (!PAYPAL_CLIENT || !PAYPAL_SECRET || !PAYPAL_API) {
        throw new Error('Missing PayPal configuration.');
    }

    ensureFetch();

    if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
        return tokenCache.accessToken;
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
    if (data && data.access_token && data.expires_in) {
        const bufferMs = 60 * 1000;
        tokenCache.accessToken = data.access_token;
        tokenCache.expiresAt = Date.now() + (Number(data.expires_in) * 1000) - bufferMs;
    }
    return data.access_token;
};

const createOrder = async ({ amount, currency, returnUrl, cancelUrl, invoiceNumber, customId }) => {
    const accessToken = await getAccessToken();
    const payload = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                amount: {
                    currency_code: currency || 'USD',
                    value: Number(amount || 0).toFixed(2)
                },
                invoice_id: invoiceNumber || undefined,
                custom_id: customId || undefined
            }
        ]
    };

    if (returnUrl || cancelUrl) {
        payload.application_context = {
            return_url: returnUrl,
            cancel_url: cancelUrl
        };
    }

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    const approvalLink = (data.links || []).find((link) => link.rel === 'approve');
    return {
        id: data.id,
        approvalUrl: approvalLink ? approvalLink.href : null,
        raw: data
    };
};

const captureOrder = async (orderId) => {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        }
    });
    return response.json();
};

module.exports = {
    createOrder,
    captureOrder,
    getAccessToken
};
