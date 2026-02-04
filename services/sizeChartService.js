const SIZE_CHART = [
    {
        size: '2XS',
        bodyChestMin: 74,
        bodyChestMax: 80,
        garmentChestWidth: 44,
        garmentShoulder: 38,
        garmentLength: 62
    },
    {
        size: 'XS',
        bodyChestMin: 80,
        bodyChestMax: 86,
        garmentChestWidth: 47,
        garmentShoulder: 40,
        garmentLength: 65
    },
    {
        size: 'S',
        bodyChestMin: 86,
        bodyChestMax: 94,
        garmentChestWidth: 50,
        garmentShoulder: 42,
        garmentLength: 68
    },
    {
        size: 'M',
        bodyChestMin: 94,
        bodyChestMax: 102,
        garmentChestWidth: 53,
        garmentShoulder: 44,
        garmentLength: 71
    },
    {
        size: 'L',
        bodyChestMin: 102,
        bodyChestMax: 110,
        garmentChestWidth: 56,
        garmentShoulder: 46,
        garmentLength: 74
    },
    {
        size: 'XL',
        bodyChestMin: 110,
        bodyChestMax: 118,
        garmentChestWidth: 59,
        garmentShoulder: 48,
        garmentLength: 77
    },
    {
        size: '2XL',
        bodyChestMin: 118,
        bodyChestMax: 126,
        garmentChestWidth: 62,
        garmentShoulder: 50,
        garmentLength: 80
    }
];

const SIZE_DISCLAIMER = 'This is a general unisex tee guide. Actual sizing may vary by brand and cut.';

const cmToIn = (cm) => {
    const value = Number(cm);
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Number((value / 2.54).toFixed(1));
};

const getSizeChart = () => SIZE_CHART.map((row) => ({ ...row }));

const findSizeIndexByChest = (chestCm) => {
    const value = Number(chestCm);
    if (!Number.isFinite(value)) {
        return 0;
    }

    const matchIndex = SIZE_CHART.findIndex((row) => value >= row.bodyChestMin && value <= row.bodyChestMax);
    if (matchIndex !== -1) {
        return matchIndex;
    }

    if (value < SIZE_CHART[0].bodyChestMin) {
        return 0;
    }

    return SIZE_CHART.length - 1;
};

const adjustSizeIndex = (index, fitPreference) => {
    let adjustment = 0;
    if (fitPreference === 'oversized') {
        adjustment = 1;
    } else if (fitPreference === 'slim') {
        adjustment = -1;
    }

    const nextIndex = index + adjustment;
    if (nextIndex < 0) {
        return 0;
    }
    if (nextIndex >= SIZE_CHART.length) {
        return SIZE_CHART.length - 1;
    }
    return nextIndex;
};

module.exports = {
    getSizeChart,
    cmToIn,
    findSizeIndexByChest,
    adjustSizeIndex,
    SIZE_DISCLAIMER
};
