import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { wrapFunctionWithAsyncResource, wrapPromiseInAsyncResource } from '../async';
import { recordQuery } from '../effects';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { makeClassCallable, wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

function redisArgToString(arg: any): string {
  if (typeof arg === 'string') {
    return `"${arg}"`;
  }

  if (arg === null) {
    return `(nil)`;
  }

  if (arg === undefined) {
    return ``;
  }

  return arg.toString();
}

function peekQueue(queue: any) {
  if ('peek' in queue) {
    return queue.peek();
  }

  return queue.get(0);
}

type Denque<T> = { peek(): Command };
type Command = { _address: string; _selected_db: number; _asyncResource: AsyncResource };
type Client = { command_queue: Denque<Command>; address: string; selected_db: number };
type ClientQueueView = () => AsyncResource | null;
type ParametersOnOptionalCallback<F> = F extends (...args: any[]) => any ? Parameters<F> : [];

const ASYNC_RESOURCE = Symbol('ASYNC_RESOURCE');

export function load() {
  const clientsConstructing: ClientQueueView[] = [];

  patchModules([path.join('redis-parser', 'lib', 'parser.js')], (OriginalParser: any) => {
    const execute = OriginalParser.prototype.execute;

    class Parser extends OriginalParser {
      _clientCommandView: ClientQueueView | null;

      constructor(...args: Parameters<typeof OriginalParser>[]) {
        super(...args);
        this._clientCommandView = clientsConstructing[0];
      }

      execute(...args: Parameters<typeof execute>[]) {
        if (this._clientCommandView) {
          const asyncResource = this._clientCommandView();

          if (asyncResource) {
            return asyncResource.runInAsyncScope(execute, this, ...args);
          }
        }

        return execute.apply(this, args);
      }
    }

    return makeClassCallable(Parser);
  });

  patchModules(['redis'], (exports) => {
    const original_internal_send_command = exports.RedisClient.prototype.internal_send_command;

    const OriginalRedisClient = exports.RedisClient;

    function RedisClient(this: Client, ...args: Parameters<typeof OriginalRedisClient>[]) {
      clientsConstructing.unshift(() => {
        const val = peekQueue(this.command_queue);

        if (val) {
          return val._asyncResource;
        }

        return val;
      });

      const client = OriginalRedisClient.apply(this, args);
      clientsConstructing.shift();
      return client;
    }

    RedisClient.prototype = OriginalRedisClient.prototype;

    function internal_send_command(this: Client, command: Command) {
      command._address = this.address;
      command._selected_db = this.selected_db;

      return original_internal_send_command.call(this, command);
    }

    RedisClient.prototype.internal_send_command = internal_send_command;

    exports.RedisClient = RedisClient;

    const originalCreateClient = exports.createClient;

    function createClient(...args: Parameters<typeof originalCreateClient>[]) {
      const options = require('redis/lib/createClient')(...args);
      // TS has trouble inferring the return type of old style constructors
      return new (RedisClient as any)(options);
    }

    exports.createClient = createClient;

    return exports;
  });

  patchModules([path.join('redis', 'lib', 'command.js')], (exports) => {
    const OriginalCommand = wrapType(exports, [], []);

    function Command<This, Args, Callback extends (...args: any[]) => any, AdditionalArgs>(
      this: Command,
      command: string,
      args: Args[],
      originalCallback?: Callback,
      ...additionalArgs: AdditionalArgs[]
    ) {
      const startTime = now();
      const asyncId = executionAsyncId();
      const queryEvents = recordQuery(`redis`, startTime, asyncId);
      const commandObject = this;

      function callback<CallbackThis, Results>(
        this: CallbackThis,
        ...callbackArgs: ParametersOnOptionalCallback<typeof originalCallback>[]
      ) {
        const endTime = now();
        let returnValue = null;

        if (originalCallback) {
          returnValue = originalCallback.apply(this, callbackArgs);
        }

        const duration = BI.subtract(endTime, startTime);

        const argString = args.map(redisArgToString).join(' ');
        const query = `${command} ${argString}`;

        queryEvents.emit('complete', {
          startTime,
          duration,
          provider: 'redis',
          query,
          host: commandObject._address || 'unknown',
          database: (commandObject._selected_db || 0).toString(),
          triggerAsyncId: asyncId,
        });

        return returnValue;
      }

      OriginalCommand.call(this, command, args, callback, ...additionalArgs);
    }

    Command.prototype = OriginalCommand.prototype;

    return Command;
  });

  const ioredisMainPaths = [
    path.join('ioredis', 'built', 'redis', 'index.js'),
    path.join('ioredis', 'built', 'redis.js'),
    path.join('ioredis', 'lib', 'redis', 'index.js'),
    path.join('ioredis', 'lib', 'redis.js'),
  ];

  patchModules(ioredisMainPaths, (exports) => {
    let Redis = exports;

    if ('default' in exports) {
      Redis = exports.default;
    }

    const originalSendCommand = Redis.prototype.sendCommand;

    Redis.prototype.sendCommand = function sendCommand(this: any, command: any, stream: any) {
      const startTime = now();
      const asyncId = executionAsyncId();
      const client = this;
      const queryEvents = recordQuery(`ioredis`, startTime, asyncId);

      command.promise.then(() => {
        const duration = BI.subtract(now(), startTime);

        const query = `${command.name} ${command.args.map(redisArgToString).join(' ')}`;

        queryEvents.emit('complete', {
          startTime,
          duration,
          provider: 'redis',
          query,
          host: `${client.options.host}:${client.options.port}`,
          database: `${client.options.db}`,
          triggerAsyncId: asyncId,
        });
      });

      return originalSendCommand.call(this, command, stream);
    };

    return exports;
  });

  patchModules(
    [path.join('ioredis', 'built', 'command.js'), path.join('ioredis', 'lib', 'command.js')],
    (exports) => {
      const OriginalCommand = exports.default;
      type Args = ConstructorParameters<typeof OriginalCommand>[1];
      type Options = ConstructorParameters<typeof OriginalCommand>[2];
      type Callback = Parameters<typeof wrapFunctionWithAsyncResource>[0];

      class Command extends OriginalCommand {
        [ASYNC_RESOURCE]: AsyncResource;

        constructor(name: string, args: Args, options: Options, callback: Callback) {
          const asyncResource = new AsyncResource('IOREDIS_COMMAND');
          super(name, args, options, wrapFunctionWithAsyncResource(callback, null, asyncResource));
          this[ASYNC_RESOURCE] = asyncResource;
          this.promise = wrapPromiseInAsyncResource(this.promise, asyncResource);
        }
      }

      exports.default = Command;
      return exports;
    },
  );

  patchModules(
    [
      path.join('ioredis', 'built', 'redis', 'event_handler.js'),
      path.join('ioredis', 'lib', 'redis', 'event_handler.js'),
    ],
    (exports) => {
      const originalConnectHandler = exports.connectHandler;

      function connectHandler(this: any, self: any) {
        const f = originalConnectHandler.call(this, self);

        return function () {
          clientsConstructing.unshift(() => {
            const val = self.commandQueue.peek();

            if (val) {
              return val.command[ASYNC_RESOURCE];
            }

            return null;
          });

          const ret = f();

          clientsConstructing.shift();

          return f;
        };
      }

      exports.connectHandler = connectHandler;

      return exports;
    },
  );
}
