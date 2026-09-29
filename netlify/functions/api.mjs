import { connectLambda } from '@netlify/blobs';
import serverless from 'serverless-http';

let expressHandler;

export const handler = async (event, context) => {
  // Lambda compatibility functions do not receive the Blobs environment
  // automatically. Connect it before api.mjs creates the account store.
  connectLambda(event);

  if (!expressHandler) {
    const { default: app } = await import('../../api.mjs');
    expressHandler = serverless(app);
  }

  return expressHandler(event, context);
};
