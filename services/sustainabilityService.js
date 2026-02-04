const BENCHMARKS = {
    // Estimated savings per shirt based on industry benchmark averages.
    waterSavedLitresPerItem: 500,
    textileWasteReducedKgPerItem: 0.3,
    carbonReducedKgPerItem: 1.0
};

const normaliseQuantity = (itemsOrQty) => {
    if (Array.isArray(itemsOrQty)) {
        return itemsOrQty.reduce((sum, item) => {
            const qty = Number(item.quantity || 0);
            if (!Number.isFinite(qty) || qty <= 0) {
                return sum;
            }
            return sum + qty;
        }, 0);
    }

    const qty = Number(itemsOrQty || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
        return 0;
    }

    return qty;
};

const estimateImpact = (itemsOrQty) => {
    const quantity = normaliseQuantity(itemsOrQty);
    const waterSavedLitres = Math.round(quantity * BENCHMARKS.waterSavedLitresPerItem);
    const textileWasteReducedKg = Number((quantity * BENCHMARKS.textileWasteReducedKgPerItem).toFixed(2));
    const carbonReducedKg = Number((quantity * BENCHMARKS.carbonReducedKgPerItem).toFixed(2));

    return {
        quantity,
        waterSavedLitres,
        textileWasteReducedKg,
        carbonReducedKg
    };
};

module.exports = {
    estimateImpact
};
