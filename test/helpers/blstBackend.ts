// The shipped @chainsafe/blst adapter (src/blst, `@obolnetwork/obol-sdk/blst`)
// over the devDependency, for the cross-check and fuzz suites.
import * as blst from '@chainsafe/blst';
import { blstBackendFrom } from '../../src/blst/index.js';

export const blstBackend = blstBackendFrom(blst);
