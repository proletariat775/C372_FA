const sizeGuideService = require('../services/sizeGuideService');

const DEFAULT_PROFILE = {
  productType: 'shirt',
  chestCm: '',
  heightCm: '',
  fitType: 'regular',
  waistCm: '',
  hipCm: ''
};

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInput(body) {
  const errors = [];
  const productType = body && body.productType === 'pants' ? 'pants' : 'shirt';
  const profile = { ...DEFAULT_PROFILE, productType };

  if (productType === 'pants') {
    const waistCm = parseNumber(body.waistCm);
    const hipCm = parseNumber(body.hipCm);
    const heightCm = parseNumber(body.heightCm);

    if (!waistCm) {
      errors.push('Waist circumference (cm) is required for pants sizing.');
    }

    profile.waistCm = waistCm || '';
    profile.hipCm = hipCm || '';
    profile.heightCm = heightCm || '';
  } else {
    const chestCm = parseNumber(body.chestCm);
    const heightCm = parseNumber(body.heightCm);
    const waistCm = parseNumber(body.waistCm);

    if (!chestCm) {
      errors.push('Chest circumference (cm) is required for a size recommendation.');
    }
    if (!heightCm) {
      errors.push('Height (cm) is required for shirt sizing.');
    }

    profile.chestCm = chestCm || '';
    profile.heightCm = heightCm || '';
    profile.waistCm = waistCm || '';
    profile.fitType = sizeGuideService.normalizeFitType(body.fitType);
  }

  return { profile, errors };
}

function recommend(profile) {
  if (profile.productType === 'pants') {
    return sizeGuideService.recommendPantsSize({
      waistCm: profile.waistCm,
      hipCm: profile.hipCm,
      heightCm: profile.heightCm
    });
  }

  return sizeGuideService.recommendShirtSize({
    chestCm: profile.chestCm,
    heightCm: profile.heightCm,
    fitType: profile.fitType
  });
}

module.exports = {
  DEFAULT_PROFILE,
  normalizeInput,
  recommend
};
