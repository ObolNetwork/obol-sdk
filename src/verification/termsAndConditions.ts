/**
 * Using 'pdf-parse-debugging-disabled' instead of 'pdf-parse' because:
 * - The original pdf-parse has a bug where it checks `!module.parent` to enable debug mode
 * - In Jest ESM environments, module.parent is null, triggering debug mode
 * - Debug mode tries to load './test/data/05-versions-space.pdf' which doesn't exist
 * - This fork is identical to pdf-parse but with debug mode permanently disabled
 * - See: https://www.npmjs.com/package/pdf-parse-debugging-disabled
 *
 * Note: @types/pdf-parse-debugging-disabled doesn't exist, so we ignore the type error.
 * The package has the same API as pdf-parse, so it works fine at runtime.
 */
// @ts-expect-error - No @types package exists for the fork, but API is identical to pdf-parse
import pdf from 'pdf-parse-debugging-disabled';
import { ByteListType, ContainerType } from '@chainsafe/ssz';
import { TERMS_AND_CONDITIONS_URL } from '../constants.js';
import { strToUint8Array } from '../utils.js';

export const hashTermsAndConditions = async (): Promise<string | null> => {
  try {
    // read the pdf
    const response = await fetch(TERMS_AND_CONDITIONS_URL);
    const pdfBuffarrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfBuffarrayBuffer);
    const data = await pdf(pdfBuffer);

    // ssz hash
    const termsType = new ContainerType({
      terms_and_conditions_hash: new ByteListType(Number.MAX_SAFE_INTEGER),
    });

    const termsHasVal = termsType.defaultValue();

    termsHasVal.terms_and_conditions_hash = strToUint8Array(
      data?.text.replace(/[^a-zA-Z0-9]/g, '') as string,
    );

    return (
      '0x' +
      Buffer.from(termsType.hashTreeRoot(termsHasVal).buffer).toString('hex')
    );
  } catch (err) {
    return null;
  }
};
