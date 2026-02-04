const https = require('https');

const getApiHost = () => {
    const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
    return mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
};

const requestPayPal = (options, body) => new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const parsed = data ? JSON.parse(data) : {};
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    return resolve(parsed);
                }
                const error = new Error(parsed.message || 'PayPal API error');
                error.status = res.statusCode;
                error.details = parsed;
                return reject(error);
            } catch (parseErr) {
                return reject(parseErr);
            }
        });
    });

    req.on('error', reject);
    if (body) {
        req.write(body);
    }
    req.end();
});

const getAccessToken = async () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('PayPal credentials are missing.');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = 'grant_type=client_credentials';

    return requestPayPal({
        hostname: getApiHost(),
        path: '/v1/oauth2/token',
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        }
    }, body).then((response) => response.access_token);
};

const createOrder = async ({ amount, currency, returnUrl, cancelUrl }) => {
    const token = await getAccessToken();
    const payload = JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
            {
                amount: {
                    currency_code: currency || 'USD',
                    value: Number(amount || 0).toFixed(2)
                }
            }
        ],
        application_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl
        }
    });

    const response = await requestPayPal({
        hostname: getApiHost(),
        path: '/v2/checkout/orders',
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);

    const approvalLink = (response.links || []).find((link) => link.rel === 'approve');
    return {
        id: response.id,
        approvalUrl: approvalLink ? approvalLink.href : null
    };
};

const captureOrder = async (orderId) => {
    const token = await getAccessToken();
    return requestPayPal({
        hostname: getApiHost(),
        path: `/v2/checkout/orders/${orderId}/capture`,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
};

module.exports = {
    createOrder,
    captureOrder
};
