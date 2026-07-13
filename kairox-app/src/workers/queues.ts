/**
 * Queue shim — replaces BullMQ queues with direct in-process function calls.
 * No Redis required.
 */

type JobHandler = (data: any) => Promise<any>;

const handlers: Record<string, JobHandler> = {};

/** Register a handler for a named queue */
export function registerQueueHandler(queueName: string, handler: JobHandler) {
  handlers[queueName] = handler;
}

function makeQueue(queueName: string) {
  return {
    name: queueName,
    add: async (_jobName: string, data: any) => {
      const handler = handlers[queueName];
      if (handler) {
        // Fire-and-forget — mirrors BullMQ async behaviour
        handler(data).catch((err: Error) =>
          console.error(`[Queue:${queueName}] Handler error:`, err)
        );
      } else {
        console.warn(`[Queue:${queueName}] No handler registered — dropping job "${_jobName}"`);
      }
      return { id: `local-${Date.now()}` };
    },
    close: async () => {},
  };
}

export const signalQueue     = makeQueue('signal-generation');
export const forexSignalQueue = makeQueue('forex-signal-generation');
export const alertQueue      = makeQueue('alerts');
