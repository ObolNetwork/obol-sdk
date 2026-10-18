/** Definitions for the v3 cluster tests. */
import type { Hex } from 'viem';
import {
  computeDefinitionHash,
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
  prepareDefinition,
} from '../../../src/v3/cluster/index.js';
import { enr } from '../../fixtures.js';
import { accountOf, KEYS } from './wallet.js';

const creator = accountOf(KEYS.creator);
const operator = accountOf(KEYS.operator);
export const OPS = [
  creator.address,
  operator.address,
  '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
  '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
];
export const VALIDATOR = {
  feeRecipientAddress: '0x3456789012345678901234567890123456789012',
  withdrawalAddress: '0x4567890123456789012345678901234567890123',
};

export const prepareInput = (extra: Record<string, unknown> = {}) => ({
  name: 'v3 test',
  operators: OPS.map(address => ({ address })),
  validators: [VALIDATOR],
  creator: creator.address,
  chainId: 560048,
  uuid: '00000000-0000-4000-8000-000000000001',
  timestamp: '2026-10-18T00:00:00.000Z',
  ...extra,
});

/** A prepared definition signed by the creator and, optionally, the operator. */
export const signedDefinition = async (
  options: { operatorSigned?: boolean } = {},
): Promise<{ definition: any; configHash: Hex }> => {
  const { definition, configHash }: { definition: any; configHash: Hex } =
    prepareDefinition(prepareInput());
  definition.creator.config_signature = await creator.signTypedData(
    creatorConfigHashTypedData(configHash, 560048) as any,
  );
  definition.operators = definition.operators.map((o: any) => ({
    address: o.address,
    enr: '',
    config_signature: '',
    enr_signature: '',
  }));
  if (options.operatorSigned === true) {
    const op = definition.operators[1];
    op.enr = enr;
    op.config_signature = await operator.signTypedData(
      operatorConfigHashTypedData(configHash, 560048) as any,
    );
    op.enr_signature = await operator.signTypedData(
      enrTypedData(enr, 560048) as any,
    );
  }
  definition.definition_hash = computeDefinitionHash(definition);
  return { definition, configHash };
};
