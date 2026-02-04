const sizeChartService = require('../services/sizeChartService');

const DEFAULT_PROFILE = {
  chestCm: '',
  fitPreference: 'regular'
};

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInput(body) {
  const errors = [];
  const chestCm = parseNumber(body.chestCm);

  if (!chestCm) {
    errors.push('Chest circumference (cm) is required for a size recommendation.');
  }

  const allowedFit = ['regular', 'slim', 'oversized'];
  const fitPreference = allowedFit.includes(body.fitPreference) ? body.fitPreference : DEFAULT_PROFILE.fitPreference;

  const profile = {
    chestCm: chestCm || '',
    fitPreference
  };

  return { profile, errors };
}

function recommend(profile) {
  const chest = Number(profile.chestCm);
  const chart = sizeChartService.getSizeChart();
  const baseIndex = sizeChartService.findSizeIndexByChest(chest);
  const baseRow = chart[baseIndex];

  const adjustedIndex = sizeChartService.adjustSizeIndex(baseIndex, profile.fitPreference);
  const recommendedRow = chart[adjustedIndex];

  const explanation = `Based on chest ${chest} cm, you fit ${baseRow.size} (${baseRow.bodyChestMin}-${baseRow.bodyChestMax} cm).`;
  const adjustmentNote = recommendedRow.size !== baseRow.size
    ? `Adjusted to ${recommendedRow.size} for a ${profile.fitPreference} fit.`
    : null;

  return {
    recommendedSize: recommendedRow.size,
    baseSize: baseRow.size,
    explanation,
    adjustmentNote,
    fitPreference: profile.fitPreference
  };
}

module.exports = {
  DEFAULT_PROFILE,
  normalizeInput,
  recommend
};
