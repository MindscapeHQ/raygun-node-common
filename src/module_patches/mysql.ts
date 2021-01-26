import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { recordQueryWithExitPoint } from '../async_effect_helpers';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

const StartTime = Symbol('StartTime');
const RecordQuery = Symbol('RecordQuery');

patchModules([path.join('mysql', 'lib', 'protocol', 'sequences', 'Query.js')], (exports) => {
  const wrappedType = wrapType(
    exports,
    [
      'OkPacket',
      'ErrorPacket',
      'ResultSetHeaderPacket',
      'FieldPacket',
      'EofPacket',
      'stream',
      'RowDataPacket',
    ],
    [],
  );

  class WrappedQuery<T, Args> extends wrappedType<T> {
    [StartTime]: BI.PortableBigInt;
    [RecordQuery]: (q: Omit<QueryInformation, 'threadId'>) => void;

    constructor(...args: Args[]) {
      super(...args);
      this[StartTime] = now();
      this[RecordQuery] = recordQueryWithExitPoint(`mysql`);
    }

    end(...args: Args[]) {
      const endTime = now();
      super.end(...args);

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

  return WrappedQuery;
});
