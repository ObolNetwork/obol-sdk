// The SDK validates payloads with validators precompiled at build time
// (src/generated/validators.ts, see scripts/generate-validators.mjs) instead of
// compiling the schemas with ajv at runtime. These tests check, for every
// payload schema, that the precompiled validators accept and reject exactly
// what runtime ajv (the previous implementation) did, with the same errors and
// the same defaults applied.
import Ajv from 'ajv';
import { validatePayload } from '../../src/ajv.js';
import * as schemas from '../../src/schema.js';
import * as customKeywords from '../../src/customKeywords.js';
import * as validators from '../../src/generated/validators.js';
import { PayloadValidationError } from '../../src/errors.js';
import { TEST_ADDRESSES, enr } from '../fixtures.js';

/** The pre-2.17 runtime setup of src/ajv.ts, as the reference. */
const referenceAjv = new Ajv({
  allErrors: true,
  useDefaults: true,
  strict: false,
  $data: true,
});
for (const def of customKeywords.CUSTOM_KEYWORDS) {
  referenceAjv.addKeyword({
    ...def,
    validate: (customKeywords as unknown as Record<string, any>)[def.keyword],
  });
}

const pubkey = `0x${'ab'.repeat(48)}`;
const signature = `0x${'cd'.repeat(96)}`;
const root32 = `0x${'ef'.repeat(32)}`;
const credentials = `0x01${'00'.repeat(11)}${'12'.repeat(20)}`;
const deposit = {
  pubkey,
  withdrawal_credentials: credentials,
  signature,
  deposit_data_root: root32,
  amount: '32000000000',
};
const addr = (i: number): string =>
  `0x${(i + 1).toString(16).padStart(40, 'a')}`;

/** A valid payload for every schema exported from src/schema.ts. */
const validPayloads: Record<string, Record<string, unknown>> = {
  operatorPayloadSchema: { version: 'v1.10.0', enr },
  definitionSchema: {
    name: 'cluster',
    operators: [0, 1, 2, 3].map(i => ({ address: addr(i) })),
    validators: [
      {
        fee_recipient_address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
        withdrawal_address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
      },
    ],
    deposit_amounts: ['32000000000'],
  },
  totalSplitterPayloadSchema: {
    splitRecipients: [
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49.9 },
    ],
  },
  rewardsSplitterPayloadSchema: {
    splitRecipients: [
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
    ],
    principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
    etherAmount: 32,
  },
  ovmRewardsSplitPayloadSchema: {
    rewardSplitRecipients: [
      { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
      { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
    ],
    OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
    principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
  },
  ovmTotalSplitPayloadSchema: {
    rewardSplitRecipients: [
      { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 99 },
    ],
    principalSplitRecipients: [
      { address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1, percentAllocation: 60 },
      { address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2, percentAllocation: 40 },
    ],
    OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
  },
  ovmRequestWithdrawalPayloadSchema: {
    ovmAddress: TEST_ADDRESSES.OVM_OWNER,
    pubKeys: [pubkey],
    amounts: ['32000000000'],
    withdrawalFees: '1',
  },
  eoaWithdrawalPayloadSchema: { pubkey, allocation: 1, requiredFee: '1' },
  ovmDepositPayloadSchema: {
    ovmAddress: TEST_ADDRESSES.OVM_OWNER,
    deposits: [deposit],
    kind: 'deposit',
  },
  eoaDepositPayloadSchema: {
    deposits: [deposit],
    expectedWithdrawalAddress: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
    kind: 'topUp',
  },
};

const JUNK: unknown[] = [
  undefined,
  null,
  true,
  0,
  -1,
  1.005,
  16,
  100,
  101,
  '',
  'x',
  '123',
  '0x1234',
  TEST_ADDRESSES.ZERO_ADDRESS,
  TEST_ADDRESSES.REWARD_RECIPIENT_1.toUpperCase().replace('0X', '0x'),
  [],
  [null],
  ['8000000000'],
  ['256000000000', '1000000000'],
  {},
  { address: '' },
];

const clone = <T>(v: T): T => structuredClone(v);

/** Payload variants: each field (and each field of the first array item) set to junk, removed, duplicated. */
function variants(base: Record<string, unknown>): unknown[] {
  const out: unknown[] = [
    clone(base),
    null,
    'string',
    [],
    {},
    { ...clone(base), unknownField: 1 },
  ];
  for (const key of Object.keys(base)) {
    for (const junk of JUNK) {
      const v = clone(base);
      if (junk === undefined) delete v[key];
      else v[key] = clone(junk);
      out.push(v);
    }
    const value = base[key];
    if (Array.isArray(value) && value.length > 0) {
      out.push({ ...clone(base), [key]: [...clone(value), clone(value[0])] });
      out.push({ ...clone(base), [key]: clone(value).slice(0, 1) });
      const item = value[0];
      if (item && typeof item === 'object') {
        for (const itemKey of Object.keys(item)) {
          for (const junk of JUNK) {
            const v = clone(base);
            const first = (v[key] as Array<Record<string, unknown>>)[0];
            if (junk === undefined) delete first[itemKey];
            else first[itemKey] = clone(junk);
            out.push(v);
          }
        }
      }
    }
  }
  return out;
}

type Outcome =
  | { threw: string }
  | { valid: boolean; errors: unknown; data: unknown };

function run(
  validate: ((d: unknown) => boolean) & { errors?: unknown },
  input: unknown,
): Outcome {
  const data = clone(input);
  try {
    const valid = validate(data);
    return { valid, errors: validate.errors ?? null, data };
  } catch (e) {
    return { threw: String(e) };
  }
}

const schemaNames = Object.keys(validators);

describe('precompiled validators', () => {
  it('cover every payload schema exported from src/schema.ts', () => {
    const exported = Object.entries(schemas)
      .filter(
        ([, v]) =>
          v !== null &&
          typeof v === 'object' &&
          (v as { type?: string }).type === 'object',
      )
      .map(([name]) => name)
      .sort();
    expect(schemaNames.sort()).toEqual(exported);
    expect(Object.keys(validPayloads).sort()).toEqual(exported);
  });

  describe.each(schemaNames)('%s', name => {
    const schema = (schemas as unknown as Record<string, object>)[name];
    const precompiled = (validators as unknown as Record<string, any>)[name];
    const reference = referenceAjv.compile(schema);
    const base = validPayloads[name];

    it('accepts the valid payload', () => {
      const outcome = run(precompiled, base);
      expect(outcome).toMatchObject({ valid: true });
      expect(validatePayload(clone(base), schema)).toBeTruthy();
    });

    it('matches runtime ajv on accept/reject, errors and defaults', () => {
      const cases = variants(base);
      let rejected = 0;
      for (const input of cases) {
        const expected = run(reference, input);
        const actual = run(precompiled, input);
        expect({ input, outcome: actual }).toEqual({
          input,
          outcome: expected,
        });
        if ('valid' in actual && !actual.valid) rejected++;
      }
      // Sanity: the variants exercise the rejecting paths too.
      expect(rejected).toBeGreaterThan(5);
    });
  });

  it('throws PayloadValidationError with the ajv message format', () => {
    const payload = clone(validPayloads.definitionSchema);
    (payload.operators as Array<{ address: string }>)[1].address = addr(0);
    expect(() => validatePayload(payload, schemas.definitionSchema)).toThrow(
      new PayloadValidationError(
        'Validation failed: /operators must pass "validateUniqueAddresses" keyword validation',
      ),
    );
  });

  it('applies schema defaults to the payload', () => {
    const payload = clone(validPayloads.ovmRewardsSplitPayloadSchema);
    const result = validatePayload<Record<string, unknown>>(
      payload,
      schemas.ovmRewardsSplitPayloadSchema,
    );
    expect(result).toBe(payload);
    expect(result).toMatchObject({
      splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS,
      principalThreshold: 16,
      distributorFeePercent: 0,
    });
  });

  it('rejects schemas that were not precompiled', () => {
    expect(() => validatePayload({}, { type: 'object' })).toThrow(
      /no precompiled validator/,
    );
  });
});
