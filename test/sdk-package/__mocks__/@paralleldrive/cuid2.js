// Mock for @paralleldrive/cuid2 to avoid ESM import issues in Jest
module.exports = {
  createId: () => 'mock-cuid-' + Math.random().toString(36).substr(2, 9),
  init: () => ({ createId: () => 'mock-cuid' }),
  getConstants: () => ({}),
  isCuid: () => false,
};

