const SIZE_CHART = [
  { size: 'XS', minChest: 0, maxChest: 84 },
  { size: 'S', minChest: 84, maxChest: 92 },
  { size: 'M', minChest: 92, maxChest: 100 },
  { size: 'L', minChest: 100, maxChest: 108 },
  { size: 'XL', minChest: 108, maxChest: 116 },
  { size: '2XL', minChest: 116, maxChest: 124 },
  { size: '3XL', minChest: 124, maxChest: 132 },
  { size: '4XL', minChest: 132, maxChest: 1000 }
];

const DEFAULT_PROFILE = {
  heightCm: '',
  weightKg: '',
  chestCm: '',
  waistCm: '',
  fitPreference: 'regular',
  lengthPreference: 'no-preference',
  fitLine: 'unisex'
};

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeInput(body) {
  const errors = [];

  const heightCm = parseNumber(body.heightCm);
  const weightKg = parseNumber(body.weightKg);
  const chestCm = parseNumber(body.chestCm);
  const waistCm = parseNumber(body.waistCm);

  if (!heightCm && !weightKg && !chestCm && !waistCm) {
    errors.push('Add at least one measurement so we can recommend a fit.');
  }

  if (heightCm && (heightCm < 120 || heightCm > 220)) {
    errors.push('Height looks outside our size guide range (120 cm to 220 cm).');
  }

  if (weightKg && (weightKg < 35 || weightKg > 160)) {
    errors.push('Weight looks outside our size guide range (35 kg to 160 kg).');
  }

  if (chestCm && (chestCm < 60 || chestCm > 150)) {
    errors.push('Chest measurement looks outside our size guide range (60 cm to 150 cm).');
  }

  if (waistCm && (waistCm < 50 || waistCm > 150)) {
    errors.push('Waist measurement looks outside our size guide range (50 cm to 150 cm).');
  }

  const fitPreference = body.fitPreference || DEFAULT_PROFILE.fitPreference;
  const lengthPreference = body.lengthPreference || DEFAULT_PROFILE.lengthPreference;
  const fitLine = body.fitLine || DEFAULT_PROFILE.fitLine;

  const profile = {
    heightCm: heightCm || '',
    weightKg: weightKg || '',
    chestCm: chestCm || '',
    waistCm: waistCm || '',
    fitPreference,
    lengthPreference,
    fitLine
  };

  return { profile, errors };
}

function sizeFromChest(chestCm) {
  const entry = SIZE_CHART.find((range) => chestCm >= range.minChest && chestCm < range.maxChest);
  return entry ? entry.size : 'M';
}

function sizeFromWeight(weightKg) {
  if (weightKg <= 55) return 'S';
  if (weightKg <= 65) return 'M';
  if (weightKg <= 75) return 'L';
  if (weightKg <= 85) return 'XL';
  if (weightKg <= 95) return '2XL';
  if (weightKg <= 110) return '3XL';
  return '4XL';
}

function lengthFromHeight(heightCm) {
  if (!heightCm) return 'Regular';
  if (heightCm < 160) return 'Petite';
  if (heightCm > 182) return 'Tall';
  return 'Regular';
}

function fitLineSummary(fitLine) {
  switch (fitLine) {
    case 'curve':
      return 'Curve fit with extra room at chest and hip.';
    case 'straight':
      return 'Straight fit for a clean, classic silhouette.';
    case 'boxy':
      return 'Boxy fit with relaxed shoulders and a wider drape.';
    default:
      return 'Unisex fit designed for flexible styling.';
  }
}

function recommend(profile) {
  const baseSize = profile.chestCm
    ? sizeFromChest(profile.chestCm)
    : profile.weightKg
      ? sizeFromWeight(profile.weightKg)
      : 'M';

  const baseIndex = SIZE_CHART.findIndex((entry) => entry.size === baseSize);
  const adjustment = profile.fitPreference === 'slim' ? -1 : profile.fitPreference === 'relaxed' ? 1 : 0;
  const adjustedIndex = clamp(baseIndex + adjustment, 0, SIZE_CHART.length - 1);

  const altIndex = adjustedIndex < SIZE_CHART.length - 1
    ? adjustedIndex + 1
    : adjustedIndex > 0
      ? adjustedIndex - 1
      : adjustedIndex;

  const length = profile.lengthPreference === 'no-preference'
    ? lengthFromHeight(profile.heightCm)
    : profile.lengthPreference === 'petite'
      ? 'Petite'
      : profile.lengthPreference === 'tall'
        ? 'Tall'
        : 'Regular';

  const confidence = profile.chestCm
    ? 'High'
    : profile.heightCm && profile.weightKg
      ? 'Medium'
      : 'Low';

  const notes = [
    `Fit preference: ${profile.fitPreference.charAt(0).toUpperCase()}${profile.fitPreference.slice(1)}.`,
    fitLineSummary(profile.fitLine),
    `Length recommendation: ${length}.`
  ];

  if (!profile.chestCm) {
    notes.push('For best accuracy, add a chest measurement next time.');
  }

  if (!profile.waistCm) {
    notes.push('Waist measurement helps refine the drape and comfort zone.');
  }

  const tips = [
    'Measure around the fullest part of your chest while wearing a light tee.',
    'Keep the tape relaxed, not tight, for natural movement.',
    'Compare against a favorite shirt for a confidence check.'
  ];

  const trust = [
    'Inclusive sizing from XS to 4XL across core styles.',
    'Fit guidance is personal and never shared outside your session.',
    'Order tracking and returns eligibility are always visible post-purchase.'
  ];

  return {
    recommendedSize: SIZE_CHART[adjustedIndex].size,
    alternateSize: SIZE_CHART[altIndex].size,
    confidence,
    length,
    fitLineLabel: profile.fitLine === 'curve'
      ? 'Curve'
      : profile.fitLine === 'straight'
        ? 'Straight'
        : profile.fitLine === 'boxy'
          ? 'Boxy'
          : 'Unisex',
    notes,
    tips,
    trust,
    chart: SIZE_CHART
  };
}

module.exports = {
  SIZE_CHART,
  DEFAULT_PROFILE,
  normalizeInput,
  recommend
};
