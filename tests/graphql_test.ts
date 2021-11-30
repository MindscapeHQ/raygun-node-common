require('../src/module_patches').loadAll();

import { effects } from '../src/effects';

import assert from 'assert';
import express from 'express';
import superagent from 'superagent';
import bodyParser from 'body-parser';
import { ApolloServer, gql } from 'apollo-server-express';

async function startApolloServer(port: number): Promise<{ graphqlPath: string; stop: () => void }> {
  // Construct a schema, using GraphQL schema language
  const typeDefs = gql`
    type Query {
      hello: String
    }
  `;

  // Provide resolver functions for your schema fields
  const resolvers = {
    Query: {
      hello: () => 'Hello world!',
    },
  };

  const apolloServer = new ApolloServer({ typeDefs, resolvers });
  if ((apolloServer as any).start) {
    await (apolloServer as any).start();
  }

  const app = express();
  apolloServer.applyMiddleware({ app: app as any });

  return new Promise((resolve, reject) => {
    const server = app.listen({ port }, () => {
      function stop() {
        apolloServer.stop();
        server.close();
      }

      resolve({ graphqlPath: apolloServer.graphqlPath, stop });
    });
  });
}

describe('apollo support', () => {
  it('keeps recording the trace until all associated http activity completes', function (done) {
    (async function () {
      const port = 10952;
      const { graphqlPath, stop } = await startApolloServer(port);

      effects.once('graphql', (query) => {
        assert.strictEqual(query.query, '{\n  hello\n}');
        done();
      });

      superagent
        .post(`http://localhost:${port}${graphqlPath}/`)
        .set('Content-Type', 'application/json')
        .send({ operationName: null, query: '{ hello }', variables: null })
        .catch((e) => done(e));
    })();
  }).timeout(10000);
});
