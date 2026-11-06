// Cloudflare Pages Function: every /api/* request goes to the API router
import { handleApi } from '../../src/server/app.js';

export const onRequest = (context) => handleApi(context);
