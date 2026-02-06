//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: Yeo Jun Long Dave 
// Student ID:24046757
// Class:C372-002
// Date created:06/02/2026
require('dotenv').config();
const Stripe = require('stripe');

let cachedStripe = null;

const getStripe = () => {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
        return null;
    }
    if (!cachedStripe) {
        cachedStripe = new Stripe(secret);
    }
    return cachedStripe;
};

const createCheckoutSession = async (amountOrData, successUrl, cancelUrl, metadata) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }

    let payload = null;
    if (typeof amountOrData === 'object' && amountOrData !== null) {
        payload = amountOrData;
    } else {
        payload = {
            amount: amountOrData,
            successUrl,
            cancelUrl,
            metadata
        };
    }

    const {
        amount,
        currency,
        description,
        successUrl: successLink,
        cancelUrl: cancelLink,
        metadata: meta,
        customerEmail,
        clientReferenceId
    } = payload || {};

    const safeAmount = Number(amount);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        throw new Error('Invalid Stripe amount.');
    }

    const unitAmount = Math.round(safeAmount * 100);
    return stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: String(currency || 'usd').toLowerCase(),
                    unit_amount: unitAmount,
                    product_data: {
                        name: description || 'Order payment'
                    }
                },
                quantity: 1
            }
        ],
        success_url: successLink ? `${successLink}?session_id={CHECKOUT_SESSION_ID}` : undefined,
        cancel_url: cancelLink,
        customer_email: customerEmail || undefined,
        client_reference_id: clientReferenceId || undefined,
        metadata: meta || undefined
    });
};

const retrieveCheckoutSession = async (sessionId) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    if (!sessionId) {
        throw new Error('Missing Stripe session id.');
    }
    return stripe.checkout.sessions.retrieve(sessionId);
};

const retrieveSession = async (sessionId) => retrieveCheckoutSession(sessionId);

const refundPayment = async (paymentIntentId, amount) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    const params = { payment_intent: paymentIntentId };
    if (typeof amount !== 'undefined' && amount !== null) {
        params.amount = Math.round(parseFloat(amount) * 100);
    }
    return stripe.refunds.create(params);
};

// Create a PaymentIntent fallback (used when Checkout cannot be created)
const createPaymentIntent = async (amount, metadata) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    const amtNumber = typeof amount === 'string' ? parseFloat(amount) : amount;
    const amountInCents = Math.round((amtNumber || 0) * 100);
    return stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        metadata: metadata || {}
    });
};

const retrievePaymentIntent = async (intentId) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    return stripe.paymentIntents.retrieve(intentId);
};

const createSubscriptionCheckoutSession = async (priceId, successUrl, cancelUrl, metadata, customerEmail) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    if (!priceId) throw new Error('missing-stripe-price-id');
    return stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        client_reference_id: metadata && metadata.user_id ? metadata.user_id : undefined,
        customer_email: customerEmail || undefined,
        subscription_data: {
            metadata: metadata || {}
        }
    });
};

const retrieveSubscription = async (subscriptionId) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    return stripe.subscriptions.retrieve(subscriptionId);
};

const setCancelAtPeriodEnd = async (subscriptionId, cancelAtPeriodEnd) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured.');
    }
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: !!cancelAtPeriodEnd });
};

module.exports = {
    createCheckoutSession,
    retrieveCheckoutSession,
    retrieveSession,
    refundPayment,
    createPaymentIntent,
    retrievePaymentIntent,
    createSubscriptionCheckoutSession,
    retrieveSubscription,
    setCancelAtPeriodEnd
};
