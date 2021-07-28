import path from 'path';
import type { IncomingMessage } from 'http';

import { patchModules } from '../module_patches';

function recordIncomingGraphQLQuery(query: string) {}

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
