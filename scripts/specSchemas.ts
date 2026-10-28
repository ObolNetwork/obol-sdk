/**
 * JSON Schemas of every operation input, generated from the TypeBox schemas
 * the SDK decodes with (design "Schemas: TypeBox"). `yarn spec:schemas`
 * writes them to spec/schemas/; test/spec/schemas.spec.ts fails when they
 * are out of date.
 *
 * TypeBox `BigInt` (wei, shares) is not JSON: it becomes a decimal string
 * with `"x-obol-type": "bigint"`, the encoding the vectors use.
 */
import type { TSchema } from '@sinclair/typebox';
import { ApiSettings } from '../src/clientContext.js';
import {
  AcceptSchema as ClusterAcceptSchema,
  GetLockSchema,
} from '../src/cluster/api.js';
import {
  DefinitionSchema,
  LockSchema,
  PrepareDefinitionSchema,
} from '../src/cluster/schema.js';
import { VerifyDefinitionSchema } from '../src/cluster/verifyDefinition.js';
import { VerifyLockOptionsSchema } from '../src/cluster/verifyLock.js';
import { FromLockOptionsSchema } from '../src/deposits/fromLock.js';
import { PrepareDepositInputSchema } from '../src/deposits/prepareDeposit.js';
import { DepositStatusOptionsSchema } from '../src/deposits/status.js';
import { VerifyDepositDataSchema } from '../src/deposits/verifyDepositData.js';
import { AggregateSchema } from '../src/exits/aggregate.js';
import { VerifyPartialExitSchema } from '../src/exits/verifyPartialExit.js';
import { IsClaimedInput } from '../src/incentives/incentives.js';
import { PrepareDistributeInputSchema } from '../src/ovm/distribute.js';
import {
  CompleteOwnershipHandoverInputSchema,
  GrantRolesInputSchema,
  OvmOnlyInputSchema,
  RecoverFundsInputSchema,
  RenounceRolesInputSchema,
  SetAmountOfPrincipalStakeInputSchema,
  SetPrincipalRecipientInputSchema,
  SetRewardRecipientInputSchema,
  SweepInputSchema,
  TransferInputSchema,
  WithdrawPullBalanceInputSchema,
} from '../src/ovm/roles.js';
import {
  PrepareConsolidateInputSchema,
  PrepareWithdrawInputSchema,
} from '../src/ovm/withdraw.js';
import { CreateOvmInputSchema } from '../src/setup/ovm.js';
import { OvmWithSplitsInputSchema } from '../src/setup/withSplits.js';
import { SimulateOptionsSchema } from '../src/simulate/simulate.js';
import {
  CreateSplitInputSchema,
  PredictSplitInputSchema,
} from '../src/splits/create.js';
import { DistributionInputSchema } from '../src/splits/distribution.js';
import { GetSplitInputSchema } from '../src/splits/getSplit.js';
import { AcceptSchema as TermsAcceptSchema } from '../src/terms/terms.js';
import { PrepareEoaWithdrawInputSchema } from '../src/withdrawals/withdrawals.js';

/** Operation name (spec/operations.md) → its input schema. */
export const OPERATION_INPUTS: Record<string, TSchema> = {
  'client.api': ApiSettings,
  'cluster.prepareDefinition': PrepareDefinitionSchema,
  'cluster.definition': DefinitionSchema,
  'cluster.lock': LockSchema,
  'cluster.accept': ClusterAcceptSchema,
  'cluster.getLock': GetLockSchema,
  'cluster.verifyDefinition': VerifyDefinitionSchema,
  'cluster.verifyLock.options': VerifyLockOptionsSchema,
  'deposits.fromLock.options': FromLockOptionsSchema,
  'deposits.verifyDepositData': VerifyDepositDataSchema,
  'deposits.status.options': DepositStatusOptionsSchema,
  'deposits.prepareDeposit': PrepareDepositInputSchema,
  'ovm.prepareWithdraw': PrepareWithdrawInputSchema,
  'ovm.prepareConsolidate': PrepareConsolidateInputSchema,
  'ovm.prepareDistribute': PrepareDistributeInputSchema,
  'ovm.prepareGrantRoles': GrantRolesInputSchema,
  'ovm.prepareRevokeRoles': GrantRolesInputSchema,
  'ovm.prepareRenounceRoles': RenounceRolesInputSchema,
  'ovm.prepareRequestOwnershipHandover': OvmOnlyInputSchema,
  'ovm.prepareCancelOwnershipHandover': OvmOnlyInputSchema,
  'ovm.prepareCompleteOwnershipHandover': CompleteOwnershipHandoverInputSchema,
  'ovm.prepareTransfer': TransferInputSchema,
  'ovm.prepareSetPrincipalRecipient': SetPrincipalRecipientInputSchema,
  'ovm.prepareSetRewardRecipient': SetRewardRecipientInputSchema,
  'ovm.prepareSetAmountOfPrincipalStake': SetAmountOfPrincipalStakeInputSchema,
  'ovm.prepareSweep': SweepInputSchema,
  'ovm.prepareWithdrawPullBalance': WithdrawPullBalanceInputSchema,
  'ovm.prepareRecoverFunds': RecoverFundsInputSchema,
  'splits.predictSplit': PredictSplitInputSchema,
  'splits.prepareCreateSplit': CreateSplitInputSchema,
  'splits.getSplit': GetSplitInputSchema,
  'splits.prepareDistribution': DistributionInputSchema,
  'setup.prepareCreateOvm': CreateOvmInputSchema,
  'setup.prepareOvmWithSplits': OvmWithSplitsInputSchema,
  'incentives.isClaimed': IsClaimedInput,
  'exits.verifyPartialExit': VerifyPartialExitSchema,
  'exits.aggregate': AggregateSchema,
  'terms.accept': TermsAcceptSchema,
  'withdrawals.prepareEoaWithdraw': PrepareEoaWithdrawInputSchema,
  'simulate.options': SimulateOptionsSchema,
};

/** A TypeBox BigInt bound (a bigint) as its decimal string. */
const bigintBound = (value: unknown): string => {
  if (typeof value !== 'bigint') {
    throw new TypeError(`Expected a bigint schema bound, got ${typeof value}`);
  }
  return value.toString();
};

const toJson = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(toJson);
  if (schema === null || typeof schema !== 'object') {
    return typeof schema === 'bigint' ? schema.toString() : schema;
  }
  const s = schema as Record<string, unknown>;
  if (s.type === 'bigint') {
    const { type: _t, minimum, maximum, ...rest } = s;
    return {
      ...(toJson(rest) as object),
      type: 'string',
      pattern: '^(0|[1-9][0-9]*)$',
      'x-obol-type': 'bigint',
      ...(minimum !== undefined
        ? { 'x-obol-minimum': bigintBound(minimum) }
        : {}),
      ...(maximum !== undefined
        ? { 'x-obol-maximum': bigintBound(maximum) }
        : {}),
    };
  }
  const out: Record<string, unknown> = {};
  // UTF-16 code-unit order (the default sort's), stated so it is not locale dependent.
  const byCodeUnit = (a: string, b: string): number => {
    if (a < b) return -1;
    return a > b ? 1 : 0;
  };
  for (const key of Object.keys(s).sort(byCodeUnit)) out[key] = toJson(s[key]);
  return out;
};

/** The schema files, by file name. */
export const specSchemas = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const [operation, schema] of Object.entries(OPERATION_INPUTS)) {
    files[`${operation}.json`] = `${JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `https://github.com/ObolNetwork/obol-sdk/spec/schemas/${operation}.json`,
        title: operation,
        ...(toJson(schema) as object),
      },
      null,
      2,
    )}\n`;
  }
  return files;
};
