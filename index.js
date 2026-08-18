'use strict';

const { buildPlayer } = require('./lib/build');
const { DemoRecorder } = require('./lib/recorder');
const { stepsFromTrace } = require('./lib/trace');

module.exports = { buildPlayer, DemoRecorder, stepsFromTrace };
