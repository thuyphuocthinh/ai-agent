let counter = 0;
module.exports = {
  v4: () => `mocked-uuid-${++counter}`,
  v7: () => `mocked-uuid-v7-${++counter}`,
};
