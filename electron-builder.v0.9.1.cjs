'use strict';

const { createHotfixBuildConfig } = require('./scripts/hotfix-build-config');

module.exports = createHotfixBuildConfig(require('./package.json'));
