#!/usr/bin/env node

/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import chalk from 'chalk';
import {start} from './start';

const program = require('commander');
const logdown = require('logdown');
const {description, version} = require('../package.json');

const logger = logdown('@wireapp/changelog-bot/cli', {
  logger: console,
  markdown: false,
});

logger.state.isEnabled = true;

program
  .version(version)
  .description(description)
  .option('-c, --conversations <conversationId,...>', 'The conversation IDs to write in')
  .option('-e, --email <address>', 'Your email address')
  .option('-p, --password <password>', 'Your password')
  .parse(process.argv);

const TRAVIS_ENV_VARS = ['TRAVIS_COMMIT_RANGE', 'TRAVIS_EVENT_TYPE', 'TRAVIS_REPO_SLUG'];

const parameters = {
  WIRE_CHANGELOG_BOT_CONVERSATION_IDS: program.conversations || process.env.WIRE_CHANGELOG_BOT_CONVERSATION_IDS,
  WIRE_CHANGELOG_BOT_EMAIL: program.email || process.env.WIRE_CHANGELOG_BOT_EMAIL,
  WIRE_CHANGELOG_BOT_PASSWORD: program.password || process.env.WIRE_CHANGELOG_BOT_PASSWORD,
};

logger.info(chalk`{bold wire-changelog-bot v${version}}`);

TRAVIS_ENV_VARS.forEach(envVar => {
  if (!process.env[envVar]) {
    logger.error(
      chalk`{bold Error:} Travis environment variable "${envVar}" is not set.` +
        '\nRead more: https://docs.travis-ci.com/user/environment-variables/#Default-Environment-Variables'
    );
    process.exit(1);
  }
});

start(parameters)
  .then(() => process.exit(0))
  .catch(error => {
    // Info:
    // Don't log error payloads here (on a global level) as they can leak sensitive information. Stack traces are ok!
    logger.error('Error at:', error.stack);
    process.exit(1);
  });
