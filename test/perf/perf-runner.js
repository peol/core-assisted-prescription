const enigma = require('enigma.js');
const WebSocket = require('ws');
const qixSchema = require('enigma.js/schemas/12.20.0.json');
const commandLineArgs = require('command-line-args');
const request = require('request');
const seedrandom = require('seedrandom');
const logger = require('./logger/logger').get();
const scenario = require('./scenarios/custom-analytics');
const os = require('os');

const MAX_RETRIES = 3;

const optionDefinitions = [
  { name: 'gateway', alias: 'g', type: String, defaultValue: 'localhost' },
  { name: 'max', alias: 'm', type: Number },
  { name: 'duration', alias: 'd', type: Number },
  { name: 'selectionInterval', alias: 's', type: Number },
  { name: 'selectionRatio', alias: 'r', type: Number },
];
const args = commandLineArgs(optionDefinitions, { partial: true });

async function getLoginCookie() {
  return new Promise((resolve) => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const loginUrl = '/login/local/callback?username=admin&password=password';
    const fullUrl = `https://${args.gateway}${loginUrl}`;
    request(fullUrl, { followRedirect: false },
      (error, response) => {
        resolve(response.headers['set-cookie'][0].split(';')[0]);
      });
  });
}

function generateGUID() {
  /* eslint-disable no-bitwise */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  /* eslint-enable no-bitwise */
}

function getEnigmaConfig(gateway, cookie) {
  return {
    url: `wss://${gateway}/doc/doc/drugcases.qvf`,
    schema: qixSchema,
    createSocket: url => new WebSocket(url, {
      rejectUnauthorized: false,
      headers: {
        Cookie: cookie,
        'X-Qlik-Session': generateGUID(),
      },
    }),
    responseInterceptors: [{
      onRejected: function retryAbortedError(sessionReference, qixRequest, error) {
        console.log('QIX Request: Rejected', error.message);
        if (error.code === qixSchema.enums.LocalizedErrorCode.LOCERR_GENERIC_ABORTED) {
          qixRequest.tries = (qixRequest.tries || 0) + 1; // eslint-disable-line no-param-reassign
          console.log(`QIX Request: Retry #${qixRequest.tries}`);
          if (qixRequest.tries <= MAX_RETRIES) {
            return qixRequest.retry();
          }
        }
        return this.Promise.reject(error);
      },
    }],
  };
}

async function getFieldNames(app) {
  const sessionObject = await app.createSessionObject(
    {
      qInfo: {
        qId: '',
        qType: 'FieldList',
      },
      qFieldListDef: {
        qShowSemantic: true,
      },
    },
  );

  const sessionLayout = await sessionObject.getLayout();
  return sessionLayout.qFieldList.qItems.map(i => i.qName);
}

function getRandomNumberBetween(start, end) {
  return Math.floor(Math.random() * (end - start)) + start;
}

async function doRandomSelection(app, fieldName) {
  const sessionObject = await app.createSessionObject(
    {
      qInfo: {
        qType: 'filterbox',
      },
      qListObjectDef: {
        qDef: {
          qFieldLabels: [fieldName],
          qFieldDefs: [fieldName],
        },
        qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 0, qHeight: 10 }],
      },
    });

  try {
    const sessionObjectLayout = await sessionObject.getLayout();
    const availableValues = sessionObjectLayout.qListObject.qDataPages[0].qMatrix;
    const randomValue = getRandomNumberBetween(0, availableValues.length);
    await sessionObject.selectListObjectValues('/qListObjectDef', [randomValue], true);
    await app.destroySessionObject(sessionObject.id);
  } catch (e) {
    logger.error(' selections triggered error', e.message);
  }
}

async function sleep(delay) {
  return new Promise((resolve) => {
    setTimeout(() => { resolve(); }, delay);
  });
}

function displayConnections(sessions, errorCount) {
  console.log(`---------------------------------------
  Process id: ${process.pid}
  Connection count: ${sessions.length}
  Total errors: ${errorCount}
  Memory used: ${process.memoryUsage().rss / 1024 / 1024} MB`);
}

async function makeRandomSelection(sessions) {
  const sessionPercentageThatMakesSelections = args.selectionRatio || 0.1;
  const nrOfSelections = Math.ceil(sessions.length * sessionPercentageThatMakesSelections);

  try {
    if (sessions[0]) {
      const firstApp = await sessions[0].getActiveDoc();
      const fieldNames = await getFieldNames(firstApp);

      for (let i = 0; i < nrOfSelections; i += 1) {
        const qix = sessions[getRandomNumberBetween(0, sessions.length)];

        /* eslint-disable no-await-in-loop */
        try {
          const app = await qix.getActiveDoc();
          await doRandomSelection(app, fieldNames[getRandomNumberBetween(0, fieldNames.length)]);
        } catch (e) {
          logger.error('Error occured while selecting: ', e.message);
        }
      }
      console.log(`Process id: ${process.pid} -  Nr of sessions | selections ( ${sessionPercentageThatMakesSelections * 100}% ) >> ${sessions.length} | ${nrOfSelections}`);
    } else {
      console.log(' No sessions to do selections on');
    }
  } catch (err) {
    console.log(' Error caught: ', err);
  }
}

const INTERACTION_AFTER_ADDED_SESSIONS = 50;

async function connect(sessions, gateway, numConnections, delayBetween) {
  let errorCount = 0;
  const interationcFunction = [displayConnections];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 1; i <= numConnections; i += 1) {
    await wait(delayBetween);

    try {
      const cookie = await getLoginCookie();
      const qix = await enigma.create(getEnigmaConfig(gateway, cookie)).open();
      sessions.push(qix);

      await scenario.getScenario(qix);
    } catch (e) {
      // console.log(e);
      logger.error('Error occured while connecting: ', e.message);
      errorCount += 1;
    }

    if (i % INTERACTION_AFTER_ADDED_SESSIONS === 0) {
      // eslint-disable-next-line no-loop-func
      await interationcFunction.forEach(iFn => iFn(sessions, errorCount));
    }
  }
}

// eslint-disable-next-line no-unused-vars
async function verify(sessions) {
  const errors = [];

  try {
    const firstApp = await sessions[0].getActiveDoc();
    const fieldNames = await getFieldNames(firstApp);

    // eslint-disable-next-line no-restricted-syntax
    for (const qix of sessions) {
      /* eslint-disable no-await-in-loop */
      try {
        const app = await qix.getActiveDoc();
        await doRandomSelection(app, fieldNames[getRandomNumberBetween(0, fieldNames.length)]);
      } catch (e) {
        errors.push(e);
      }
    }
  } catch (e) {
    errors.push(e);
  }

  console.log(' Errors caused by selections: ', errors.length);
}

// eslint-disable-next-line no-unused-vars
async function disconnect(sessions, duration) {
  const delay = (duration * 10) / sessions.length;
  // eslint-disable-next-line no-restricted-syntax
  for (const qix of sessions) {
    /* eslint-disable no-await-in-loop */
    await qix.session.close();
    await sleep(delay);
    /* eslint-enable no-await-in-loop */
  }
}

function onUnhandledError(err) {
  console.error('Process encountered an unhandled error', err);
  process.exit(1);
}

process.on('SIGTERM', () => {
  console.log('Process exiting on SIGTERM');
  process.exit(0);
});

process.on('uncaughtException', onUnhandledError);
process.on('unhandledRejection', onUnhandledError);

exports.start = async (workerNr) => {
  seedrandom(`${os.hostname()}_${workerNr}`, { global: true });

  const maxNumUsers = args.max;

  let duration = args.duration;
  let gateway = args.gateway;

  if (!maxNumUsers) {
    console.error('Error - Max number of users not provided (-m, --max)');
    process.exit(1);
  }

  if (!duration) { duration = 60; }
  if (!gateway) { gateway = 'localhost'; }

  console.log('================================================================================');
  console.log(' Running performance benchmarking');
  console.log(` Gateway: ${gateway}`);
  console.log(` Max number of users: ${maxNumUsers}`);
  console.log(` Rate of new sessions (ms): ${duration}`);
  console.log('================================================================================');

  let sessions = [];

  console.log(' Connecting users');

  const selectionsInterval = args.selectionInterval || 10000;

  const selectionsIntevalFn = setInterval(() => {
    makeRandomSelection(sessions);
  }, selectionsInterval);

  sessions = await connect(sessions, gateway, maxNumUsers, duration);

  console.log(' Disconnecting users');

  clearInterval(selectionsIntevalFn);

  // await disconnect(sessions, duration);
  console.log(' Done');

  // process.exit();
};
