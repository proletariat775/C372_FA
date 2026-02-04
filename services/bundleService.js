const DEFAULT_BUNDLE_RATE = 0.1;

const toNumber = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeProductIds = (ids) => {
    if (!Array.isArray(ids)) {
        return [];
    }
    const unique = Array.from(new Set(ids.map(id => Number(id)).filter(Number.isFinite)));
    return unique.sort((a, b) => a - b);
};

const buildBundleId = (productIds) => `bundle-${productIds.join('-')}`;

const normalizeBundleDefinition = (bundle) => {
    if (!bundle) {
        return null;
    }

    const productIds = normalizeProductIds(bundle.productIds || bundle.items || []);
    if (productIds.length < 2) {
        return null;
    }

    const discountRate = Number.isFinite(Number(bundle.discountRate))
        ? Number(bundle.discountRate)
        : DEFAULT_BUNDLE_RATE;

    const safeRate = discountRate > 0 ? discountRate : DEFAULT_BUNDLE_RATE;

    return {
        id: bundle.id || buildBundleId(productIds),
        title: bundle.title || null,
        productIds,
        discountRate: safeRate
    };
};

const registerBundleDefinition = (session, bundle) => {
    if (!session) {
        return null;
    }

    const normalized = normalizeBundleDefinition(bundle);
    if (!normalized) {
        return null;
    }

    if (!Array.isArray(session.bundleDefinitions)) {
        session.bundleDefinitions = [];
    }

    const exists = session.bundleDefinitions.some(entry => entry.id === normalized.id);
    if (!exists) {
        session.bundleDefinitions.push(normalized);
    }

    return normalized;
};

const calculateBundleDiscount = (cartItems, bundleDefinitions) => {
    const rawBundles = Array.isArray(bundleDefinitions)
        ? bundleDefinitions
        : (bundleDefinitions ? [bundleDefinitions] : []);

    const bundles = rawBundles
        .map(normalizeBundleDefinition)
        .filter(Boolean);

    if (!Array.isArray(cartItems) || cartItems.length === 0 || bundles.length === 0) {
        return {
            totalBundleSets: 0,
            discountPercent: 0,
            discountAmount: 0,
            appliedBundles: []
        };
    }

    const quantityByProduct = {};
    const valueByProduct = {};

    cartItems.forEach((item) => {
        const productId = Number(item.productId);
        const quantity = toNumber(item.quantity);
        const price = toNumber(item.price);

        if (!Number.isFinite(productId) || quantity <= 0 || price < 0) {
            return;
        }

        quantityByProduct[productId] = (quantityByProduct[productId] || 0) + quantity;
        valueByProduct[productId] = (valueByProduct[productId] || 0) + (price * quantity);
    });

    const remainingQty = { ...quantityByProduct };
    const averagePrice = Object.keys(quantityByProduct).reduce((acc, key) => {
        const productId = Number(key);
        const qty = quantityByProduct[productId] || 0;
        acc[productId] = qty > 0 ? valueByProduct[productId] / qty : 0;
        return acc;
    }, {});

    let totalBundleSets = 0;
    let discountAmount = 0;
    const appliedBundles = [];

    bundles.forEach((bundle) => {
        const requiredIds = bundle.productIds;
        const setsCompleted = requiredIds.reduce((minSets, productId) => {
            const available = remainingQty[productId] || 0;
            return Math.min(minSets, available);
        }, Number.POSITIVE_INFINITY);

        if (!Number.isFinite(setsCompleted) || setsCompleted <= 0) {
            return;
        }

        // Example: If cart has product_1 qty 3 and product_2 qty 1, bundle [1,2] => setsCompleted = 1.
        // Extra qty of product_1 does NOT increase discount without another product_2.
        // Consume quantities so overlapping bundles are not double-counted.
        requiredIds.forEach((productId) => {
            remainingQty[productId] -= setsCompleted;
        });

        // Discount is calculated against the bundle-eligible subtotal (current UI behavior),
        // not the full cart subtotal.
        const setValue = requiredIds.reduce((sum, productId) => sum + (averagePrice[productId] || 0), 0);
        const bundleValue = setValue * setsCompleted;
        const rate = Number.isFinite(bundle.discountRate) ? bundle.discountRate : DEFAULT_BUNDLE_RATE;
        discountAmount += bundleValue * rate;
        totalBundleSets += setsCompleted;

        // Example: Completing another full set (e.g., product_1 qty 2 and product_2 qty 2) => setsCompleted = 2
        // which correctly doubles the discount for the same bundle.
        appliedBundles.push({
            bundleId: bundle.id,
            setsCompleted
        });
    });

    const discountPercent = totalBundleSets * (DEFAULT_BUNDLE_RATE * 100);

    return {
        totalBundleSets,
        discountPercent,
        discountAmount: Number(discountAmount.toFixed(2)),
        appliedBundles
    };
};

module.exports = {
    calculateBundleDiscount,
    registerBundleDefinition,
    normalizeBundleDefinition
};
