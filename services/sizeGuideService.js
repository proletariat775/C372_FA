//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026
const SHIRT_SIZE_CHART = [
  {
    size: '2XS',
    bodyChestMin: 74,
    bodyChestMax: 80,
    waistMin: 62,
    waistMax: 66,
    garmentChestWidth: 44,
    garmentShoulder: 38,
    garmentLength: 62
  },
  {
    size: 'XS',
    bodyChestMin: 80,
    bodyChestMax: 86,
    waistMin: 66,
    waistMax: 70,
    garmentChestWidth: 47,
    garmentShoulder: 40,
    garmentLength: 65
  },
  {
    size: 'S',
    bodyChestMin: 86,
    bodyChestMax: 94,
    waistMin: 70,
    waistMax: 76,
    garmentChestWidth: 50,
    garmentShoulder: 42,
    garmentLength: 68
  },
  {
    size: 'M',
    bodyChestMin: 94,
    bodyChestMax: 102,
    waistMin: 76,
    waistMax: 82,
    garmentChestWidth: 53,
    garmentShoulder: 44,
    garmentLength: 71
  },
  {
    size: 'L',
    bodyChestMin: 102,
    bodyChestMax: 110,
    waistMin: 82,
    waistMax: 88,
    garmentChestWidth: 56,
    garmentShoulder: 46,
    garmentLength: 74
  },
  {
    size: 'XL',
    bodyChestMin: 110,
    bodyChestMax: 118,
    waistMin: 88,
    waistMax: 96,
    garmentChestWidth: 59,
    garmentShoulder: 48,
    garmentLength: 77
  },
  {
    size: '2XL',
    bodyChestMin: 118,
    bodyChestMax: 126,
    waistMin: 96,
    waistMax: 104,
    garmentChestWidth: 62,
    garmentShoulder: 50,
    garmentLength: 80
  }
];

const PANTS_SIZE_CHART = [
  {
    size: 'XS',
    waistMin: 66,
    waistMax: 71,
    hipMin: 84,
    hipMax: 89,
    inseam: 76
  },
  {
    size: 'S',
    waistMin: 71,
    waistMax: 76,
    hipMin: 89,
    hipMax: 94,
    inseam: 78
  },
  {
    size: 'M',
    waistMin: 76,
    waistMax: 81,
    hipMin: 94,
    hipMax: 99,
    inseam: 80
  },
  {
    size: 'L',
    waistMin: 81,
    waistMax: 86,
    hipMin: 99,
    hipMax: 104,
    inseam: 82
  },
  {
    size: 'XL',
    waistMin: 86,
    waistMax: 92,
    hipMin: 104,
    hipMax: 110,
    inseam: 84
  },
  {
    size: '2XL',
    waistMin: 92,
    waistMax: 98,
    hipMin: 110,
    hipMax: 116,
    inseam: 86
  }
];

const SIZE_DISCLAIMER = 'This is a general sizing guide. Actual sizing may vary by brand and cut.';

const SHIRT_FIT_NOTES = {
  regular: 'Standard fit across the chest and shoulders.',
  slimming: 'More fitted; consider sizing up if between sizes.',
  relaxed: 'Roomier; consider sizing down for a closer fit.',
  'dry-fit': 'Stretch fabric; flexible fit for easy movement.'
};

const SHIRT_FIT_LABELS = {
  regular: 'Regular',
  slimming: 'Slimming',
  relaxed: 'Relaxed',
  'dry-fit': 'Dry-fit'
};

const cmToIn = (cm) => {
  const value = Number(cm);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number((value / 2.54).toFixed(1));
};

const cloneChart = (chart) => chart.map((row) => ({ ...row }));

const normalizeFitType = (fitType) => {
  const raw = String(fitType || '').trim().toLowerCase();
  if (raw === 'slim' || raw === 'slimming') {
    return 'slimming';
  }
  if (raw === 'relaxed' || raw === 'oversized') {
    return 'relaxed';
  }
  if (raw === 'dryfit' || raw === 'dry-fit' || raw === 'dry fit') {
    return 'dry-fit';
  }
  return 'regular';
};

const getShirtFitLabel = (fitType) => SHIRT_FIT_LABELS[normalizeFitType(fitType)] || SHIRT_FIT_LABELS.regular;

const getShirtFitNote = (fitType) => SHIRT_FIT_NOTES[normalizeFitType(fitType)] || SHIRT_FIT_NOTES.regular;

const findShirtSizeIndex = (chestCm, stretchAllowance = 0) => {
  const value = Number(chestCm);
  if (!Number.isFinite(value)) {
    return 0;
  }

  const matchIndex = SHIRT_SIZE_CHART.findIndex((row) =>
    value >= (row.bodyChestMin - stretchAllowance) && value <= (row.bodyChestMax + stretchAllowance)
  );

  if (matchIndex !== -1) {
    return matchIndex;
  }

  if (value < SHIRT_SIZE_CHART[0].bodyChestMin) {
    return 0;
  }

  return SHIRT_SIZE_CHART.length - 1;
};

const findPantsSizeIndexByWaist = (waistCm) => {
  const value = Number(waistCm);
  if (!Number.isFinite(value)) {
    return 0;
  }

  const matchIndex = PANTS_SIZE_CHART.findIndex((row) => value >= row.waistMin && value <= row.waistMax);
  if (matchIndex !== -1) {
    return matchIndex;
  }

  if (value < PANTS_SIZE_CHART[0].waistMin) {
    return 0;
  }

  return PANTS_SIZE_CHART.length - 1;
};

const getShirtSizeChart = (fitType) => {
  return cloneChart(SHIRT_SIZE_CHART);
};

const getPantsSizeChart = () => cloneChart(PANTS_SIZE_CHART);

const recommendShirtSize = (inputs = {}) => {
  const chest = Number(inputs.chestCm);
  const waist = Number(inputs.waistCm);
  const height = Number(inputs.heightCm);
  const fitType = normalizeFitType(inputs.fitType);

  const baseIndex = findShirtSizeIndex(chest, 0);
  const baseRow = SHIRT_SIZE_CHART[baseIndex];
  let recommendedIndex = baseIndex;
  let adjustmentNote = null;

  if (fitType === 'slimming') {
    const lowerBuffer = baseRow.bodyChestMin + 2;
    if (baseIndex > 0 && chest > lowerBuffer) {
      recommendedIndex = baseIndex - 1;
      adjustmentNote = 'Slimming fit selected, so we sized down for a closer cut.';
    }
  } else if (fitType === 'relaxed') {
    if (baseIndex < SHIRT_SIZE_CHART.length - 1) {
      recommendedIndex = baseIndex + 1;
      adjustmentNote = 'Relaxed fit selected, so we sized up for more room.';
    }
  } else if (fitType === 'dry-fit') {
    const stretchIndex = findShirtSizeIndex(chest, 2);
    if (stretchIndex !== baseIndex) {
      recommendedIndex = stretchIndex;
      adjustmentNote = 'Dry-fit stretch allows comfortable sizing across adjacent ranges.';
    }
  }

  const recommendedRow = SHIRT_SIZE_CHART[recommendedIndex];
  const fitLabel = getShirtFitLabel(fitType);
  const explanationParts = [
    `Based on chest ${chest} cm`,
    Number.isFinite(waist) && waist > 0 ? `waist ${waist} cm` : null,
    Number.isFinite(height) && height > 0 ? `height ${height} cm` : null,
    `${fitLabel} fit`
  ].filter(Boolean);

  return {
    productType: 'shirt',
    recommendedSize: recommendedRow.size,
    baseSize: baseRow.size,
    fitType,
    fitLabel,
    explanation: `${explanationParts.join(', ')}.`,
    adjustmentNote,
    baseRange: `${baseRow.bodyChestMin}-${baseRow.bodyChestMax} cm`
  };
};

const recommendPantsSize = (inputs = {}) => {
  const waist = Number(inputs.waistCm);
  const hip = Number(inputs.hipCm);
  const height = Number(inputs.heightCm);

  let index = findPantsSizeIndexByWaist(waist);
  let selectedRow = PANTS_SIZE_CHART[index];

  if (Number.isFinite(hip) && hip > 0) {
    if (hip > selectedRow.hipMax) {
      while (index < PANTS_SIZE_CHART.length - 1 && hip > PANTS_SIZE_CHART[index].hipMax) {
        index += 1;
      }
    } else if (hip < selectedRow.hipMin) {
      while (index > 0 && hip < PANTS_SIZE_CHART[index].hipMin) {
        index -= 1;
      }
    }
    selectedRow = PANTS_SIZE_CHART[index];
  }

  const rangeNote = `waist ${selectedRow.waistMin}-${selectedRow.waistMax} cm`;
  const explanationParts = [`Based on waist ${waist} cm (${rangeNote})`];
  if (Number.isFinite(hip) && hip > 0) {
    explanationParts.push(`hip ${hip} cm`);
  }

  if (Number.isFinite(height) && height > 0) {
    explanationParts.push(`height ${height} cm`);
  }

  return {
    productType: 'pants',
    recommendedSize: selectedRow.size,
    explanation: `${explanationParts.join(', ')}.`,
    inseam: selectedRow.inseam,
    waistRange: `${selectedRow.waistMin}-${selectedRow.waistMax} cm`,
    hipRange: `${selectedRow.hipMin}-${selectedRow.hipMax} cm`
  };
};

module.exports = {
  getShirtSizeChart,
  getPantsSizeChart,
  recommendShirtSize,
  recommendPantsSize,
  getShirtFitNote,
  getShirtFitLabel,
  normalizeFitType,
  cmToIn,
  SIZE_DISCLAIMER,
  SHIRT_FIT_NOTES
};
