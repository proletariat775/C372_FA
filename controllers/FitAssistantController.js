//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026


const fitAssistant = require('../models/fitAssistant');
const sizeGuideService = require('../services/sizeGuideService');

function buildViewModel(req, overrides = {}) {
  const profile = overrides.profile || req.session.fitProfile || { ...fitAssistant.DEFAULT_PROFILE };
  const fitType = sizeGuideService.normalizeFitType(profile.fitType);

  return {
    title: 'Shirt Shop | Fit Assistant',
    user: req.session.user,
    profile: { ...profile, fitType },
    result: overrides.result || null,
    sizeCharts: {
      shirt: sizeGuideService.getShirtSizeChart(fitType),
      pants: sizeGuideService.getPantsSizeChart()
    },
    fitNotes: sizeGuideService.SHIRT_FIT_NOTES,
    cmToIn: sizeGuideService.cmToIn,
    sizeDisclaimer: sizeGuideService.SIZE_DISCLAIMER,
    errors: overrides.errors || []
  };
}

exports.show = (req, res) => {
  res.render('fitAssistant', buildViewModel(req));
};

exports.calculate = (req, res) => {
  const { profile, errors } = fitAssistant.normalizeInput(req.body);

  if (errors.length) {
    return res.render('fitAssistant', buildViewModel(req, { profile, errors }));
  }

  const result = fitAssistant.recommend(profile);
  req.session.fitProfile = profile;

  return res.render('fitAssistant', buildViewModel(req, { profile, result }));
};
