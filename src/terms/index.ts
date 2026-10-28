/** terms: Obol terms and conditions (spec/operations.md "terms"). */
export {
  createTermsModule,
  TERMS_AND_CONDITIONS_HASH,
  TERMS_AND_CONDITIONS_VERSION,
  termsTypedData,
  type TermsModule,
} from './terms.js';

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
