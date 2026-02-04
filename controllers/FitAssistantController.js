const fitAssistant = require('../models/fitAssistant');

function buildViewModel(req, overrides = {}) {
  return {
    title: 'Shirt Shop | Fit Assistant',
    user: req.session.user,
    profile: overrides.profile || req.session.fitProfile || { ...fitAssistant.DEFAULT_PROFILE },
    result: overrides.result || null,
    chart: fitAssistant.SIZE_CHART,
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
