//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026
const sizeGuideService = require('./sizeGuideService');

const getSizeChart = () => sizeGuideService.getShirtSizeChart();

module.exports = {
  getSizeChart,
  cmToIn: sizeGuideService.cmToIn,
  SIZE_DISCLAIMER: sizeGuideService.SIZE_DISCLAIMER
};
