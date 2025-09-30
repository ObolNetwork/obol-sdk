import pdf from 'pdf-parse';
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
      data?.text.replace(/[^a-zA-Z0-9]/g, ''),
    );

    return (
      '0x' +
      Buffer.from(termsType.hashTreeRoot(termsHasVal).buffer).toString('hex')
    );
  } catch (err) {
    return null;
  }
};
