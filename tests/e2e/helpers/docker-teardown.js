'use strict';

const { teardown } = require('./docker');

module.exports = async () => { await teardown(); };
