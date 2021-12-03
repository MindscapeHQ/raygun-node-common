import { executionAsyncId } from 'async_hooks';
import type { IncomingMessage } from 'http';
import path from 'path';

import { effects } from '../effects';
import { patchModules } from '../module_patches';

function recordIncomingGraphQLQuery(query: string) {
  effects.emit('graphql', { query, asyncId: executionAsyncId() });
}

export function load() {
  patchModules([path.join('graphql')], (exports) => {
    const originalGraphql = exports.graphql;

    function graphql<This, Schema, OtherArgs>(
      this: This,
      schema: Schema,
      query: string,
      ...args: OtherArgs[]
    ) {
      recordIncomingGraphQLQuery(query);

      return originalGraphql.call(this, schema, query, ...args);
    }

    const originalExecute = exports.execute;

    function execute<This, Args extends { document: Document }, Document, OtherArgs>(
      this: This,
      args: Args,
      ...otherArgs: OtherArgs[]
    ) {
      recordIncomingGraphQLQuery(exports.print(args.document));

      return originalExecute.call(this, args, ...otherArgs);
    }

    return { ...exports, graphql, execute };
  });
}
