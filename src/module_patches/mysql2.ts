import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { recordQuery } from '../effects';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;
const StartTime = Symbol('StartTime');
const RecordQuery = Symbol('RecordQuery');

export function load() {
  patchModules([path.join('mysql2', 'lib', 'commands', 'command.js')], (exports) => {
    const wrappedType = wrapType(exports, ['execute'], []);

    return wrappedType;
  });

  patchModules([path.join('mysql2', 'lib', 'commands', 'query.js')], (exports) => {
    const WrappedQuery = wrapType(exports, ['execute'], []);

    // Versions of mysql2 prior to 1.7 rely on the classname to set up exports correctly
    // This class must be called Query or support for older versions will break
    class Query<T, Args> extends WrappedQuery<T> {
      [StartTime]: BI.PortableBigInt;
      [RecordQuery]: (q: Omit<QueryInformation, 'threadId'>) => void;

      constructor(...args: Args[]) {
        super(...args);
        this[StartTime] = now();
        const triggerEvents = recordQuery(`mysql`, this[StartTime], executionAsyncId());
        this[RecordQuery] = (q) => triggerEvents.emit('complete', q);
      }

      done(...args: Args[]) {
        const endTime = now();
        super.done(...args);

        const duration = BI.subtract(endTime, this[StartTime]);

        const query = {
          provider: 'mysql',
          host: this._connection.config.host,
          database: this._connection.config.database,
          triggerAsyncId: this._asyncResource.triggerAsyncId(),
          query: this.sql,
          startTime: this[StartTime],
          duration,
        };

        this[RecordQuery](query);
      }
    }

    return Query;
  });
}
