import {createBullBoard} from "@bull-board/api";
import {ExpressAdapter} from "@bull-board/express";
import {BullMQAdapter} from "@bull-board/api/bullMQAdapter";
import {BullAdapter} from "@bull-board/api/bullAdapter";
import {Queue} from 'bullmq';
import Bull from 'bull';
import {backOff} from "exponential-backoff";

import {client, redisConfig} from "./redis.js";
import {config, PROXY_PATH} from "./config.js";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(PROXY_PATH)

const {setQueues} = createBullBoard({
	queues: [],
	serverAdapter,
	options: {
		uiConfig: {
			...(config.BULL_BOARD_TITLE && {boardTitle: config.BULL_BOARD_TITLE}),
			...(config.BULL_BOARD_LOGO_PATH && {
				boardLogo: {
					path: config.BULL_BOARD_LOGO_PATH
				},
				...(config.BULL_BOARD_LOGO_WIDTH && {width: config.BULL_BOARD_LOGO_WIDTH}),
				...(config.BULL_BOARD_LOGO_HEIGHT && {height: config.BULL_BOARD_LOGO_HEIGHT}),
			}),
			...(config.BULL_BOARD_FAVICON && {
				favIcon: {
					default: config.BULL_BOARD_FAVICON
				},
				...(config.BULL_BOARD_FAVICON_ALTERNATIVE && {alternative: config.BULL_BOARD_FAVICON_ALTERNATIVE}),
			}),
			locale: {
				...(config.BULL_BOARD_LOCALE && {lng: config.BULL_BOARD_LOCALE}),
			},
			dateFormats: {
				...(config.BULL_BOARD_DATE_FORMATS_SHORT && {short: config.BULL_BOARD_DATE_FORMATS_SHORT}),
				...(config.BULL_BOARD_DATE_FORMATS_COMMON && {common: config.BULL_BOARD_DATE_FORMATS_COMMON}),
				...(config.BULL_BOARD_DATE_FORMATS_FULL && {full: config.BULL_BOARD_DATE_FORMATS_FULL}),
			}
		}
	}
});
export const router = serverAdapter.getRouter();

async function getBullQueues() {
  const prefixes = [];
  if (config.EXTRA_PREFIXES) {
    prefixes.push(...config.EXTRA_PREFIXES.split(','));
  }
  
  prefixes.push(config.BULL_PREFIX);
  const uniqQueues = new Map(); // Map<queueName, prefix>

  for (const prefix of prefixes) {
    const keys = await client.keys(`${prefix}:*`);
    keys.forEach((key) => {
      const parts = key.split(':');
      if (parts.length < 2) return;
      const queueName = parts[1];
      if (!uniqQueues.has(queueName)) {
        uniqQueues.set(queueName, prefix);
      }
    });
  }

  if (uniqQueues.size === 0) {
    throw new Error('No queues found in Redis!');
  }

  const queueList = []
  Array.from(uniqQueues.entries())
    .forEach(([queueName, prefix]) => {
      if (config.BULL_VERSION === 'BULLMQ') {
        queueList.push(new BullMQAdapter(
          new Queue(queueName, 
            { connection: redisConfig.redis, prefix }, 
            client.connection
          )
        ));
      } else {
        queueList.push(
          new BullAdapter(new Bull(queueName, { redis: redisConfig.redis, prefix }, client.connection))
        );
      }
    }
  );

  if (!queueList.length) {
    throw new Error('No queue found.');
  }

  return queueList;
}

async function bullMain() {
	try {
		const queueList = await backOff(() => getBullQueues(), {
			delayFirstAttempt: false,
			jitter: "none",
			startingDelay: config.BACKOFF_STARTING_DELAY,
			maxDelay: config.BACKOFF_MAX_DELAY,
			timeMultiple: config.BACKOFF_TIME_MULTIPLE,
			numOfAttempts: config.BACKOFF_NB_ATTEMPTS,
			retry: (e, attemptNumber) => {
				console.log(`No queue! Retry n°${attemptNumber}`);
				return true;
			},
		});
		setQueues(queueList);
		console.log('🚀 done!')
	} catch (err) {
		console.error(err);
	}
}

// Only run bullMain in non-test environment
if (process.env.NODE_ENV !== 'test') {
	bullMain();
}

// Export for testing
export {bullMain, getBullQueues};
