//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026
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
