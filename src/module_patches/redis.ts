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

  patchModules([path.join('redis-parser', 'lib', 'parser.js')], (Parser: any) => {
    const execute = Parser.prototype.execute;

    class WrappedParser extends Parser {
      _clientCommandView: ClientQueueView | null;

      constructor(...args: Parameters<typeof Parser>[]) {
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

    return makeClassCallable(WrappedParser);
  });

  patchModules(['redis'], (exports) => {
    const internal_send_command = exports.RedisClient.prototype.internal_send_command;

    const RedisClient = exports.RedisClient;

    function WrappedRedisClient(this: Client, ...args: Parameters<typeof RedisClient>[]) {
      clientsConstructing.unshift(() => {
        const val = peekQueue(this.command_queue);

        if (val) {
          return val._asyncResource;
        }

        return val;
      });

      const client = RedisClient.apply(this, args);
      clientsConstructing.shift();
      return client;
    }

    WrappedRedisClient.prototype = RedisClient.prototype;

    function wrapped_internal_send_command(this: Client, command: Command) {
      command._address = this.address;
      command._selected_db = this.selected_db;

      return internal_send_command.call(this, command);
    }

    WrappedRedisClient.prototype.internal_send_command = wrapped_internal_send_command;

    exports.RedisClient = WrappedRedisClient;

    const createClient = exports.createClient;

    function wrappedCreateClient(...args: Parameters<typeof createClient>[]) {
      const options = require('redis/lib/createClient')(...args);
      // TS has trouble inferring the return type of old style constructors
      return new (WrappedRedisClient as any)(options);
    }

    exports.createClient = wrappedCreateClient;

    return exports;
  });

  patchModules([path.join('redis', 'lib', 'command.js')], (exports) => {
    const Command = wrapType(exports, [], []);

    function WrappedCommand<This, Args, Callback extends (...args: any[]) => any, AdditionalArgs>(
      this: Command,
      command: string,
      args: Args[],
      callback?: Callback,
      ...additionalArgs: AdditionalArgs[]
    ) {
      const startTime = now();
      const asyncId = executionAsyncId();
      const queryEvents = recordQuery(`redis`, startTime, asyncId);
      const commandObject = this;

      function wrappedCallback<CallbackThis, Results>(
        this: CallbackThis,
        ...callbackArgs: ParametersOnOptionalCallback<typeof callback>[]
      ) {
        const endTime = now();
        let returnValue = null;

        if (callback) {
          returnValue = callback.apply(this, callbackArgs);
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

      Command.call(this, command, args, wrappedCallback, ...additionalArgs);
    }

    WrappedCommand.prototype = Command.prototype;

    return WrappedCommand;
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

    const sendCommand = Redis.prototype.sendCommand;

    Redis.prototype.sendCommand = function wrappedSendCommand(
      this: any,
      command: any,
      stream: any,
    ) {
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

      return sendCommand.call(this, command, stream);
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
      const connectHandler = exports.connectHandler;

      function wrappedConnectHandler(this: any, self: any) {
        const f = connectHandler.call(this, self);

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

      exports.connectHandler = wrappedConnectHandler;

      return exports;
    },
  );
}
