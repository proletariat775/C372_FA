const sizeGuideService = require('./sizeGuideService');

const getSizeChart = () => sizeGuideService.getShirtSizeChart();

module.exports = {
  getSizeChart,
  cmToIn: sizeGuideService.cmToIn,
  SIZE_DISCLAIMER: sizeGuideService.SIZE_DISCLAIMER
};
