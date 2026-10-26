// Legacy-feature harnesses explicitly model a fresh profile with no evidence.
// Evidence behavior has its own real-core and native IndexedDB regression suite.
module.exports = () => ({
  structuredClone,
  ThreadLineEvidenceCore: require('../../evidence-core.js'),
  ThreadLineEvidenceDB: {
    async open() { return {}; },
    async snapshot() {
      return {projects:{},conclusions:{},versions:{},sources:{},links:{},operations:{}};
    }
  }
});
