// Legacy-feature harnesses explicitly model a fresh profile with no evidence.
// Evidence behavior has its own real-core and native IndexedDB regression suite.
module.exports = () => ({
  structuredClone,
  TextEncoder,
  ThreadLineEvidenceCore: require('../../evidence-core.js'),
  ThreadLineEvidenceSource: require('../../evidence-source.js'),
  ThreadLineEvidenceLifecycle: require('../../evidence-lifecycle.js'),
  ThreadLineEvidenceWorkflows: require('../../evidence-workflows.js'),
  ThreadLineEvidenceDB: {
    async open() { return {}; },
    async snapshot() {
      return {projects:{},conclusions:{},versions:{},sources:{},links:{},operations:{}};
    }
  }
});
