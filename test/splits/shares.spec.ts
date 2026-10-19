import {
  formatPercent,
  hashSplitParams,
  percent,
  splitParams,
} from '../../src/splits/shares.js';
import { caught } from './helpers.js';

const A = '0x1234567890123456789012345678901234567890';
const B = '0x2345678901234567890123456789012345678901';
const RAF = '0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5';

describe('splits shares', () => {
  it.each([
    [333333, '33.3333'],
    [10000, '1'],
    [247500, '24.75'],
    [1, '0.0001'],
    [1_000_000, '100'],
    [0, '0'],
  ])('formatPercent(%s) = %s', (ppm, text) => {
    expect(formatPercent(ppm)).toBe(text);
    if (ppm > 0) expect(percent(text)).toBe(ppm);
  });

  it('formatPercent rejects out-of-range and fractional ppm', async () => {
    expect((await caught(() => formatPercent(1_000_001))).code).toBe(
      'PAYLOAD_INVALID',
    );
    expect((await caught(() => formatPercent(1.5))).code).toBe(
      'PAYLOAD_INVALID',
    );
  });

  it('percent rejects a non-finite number and other types', async () => {
    expect((await caught(() => percent(Number.NaN))).code).toBe(
      'PAYLOAD_INVALID',
    );
    expect((await caught(() => percent(null as unknown as string))).code).toBe(
      'PAYLOAD_INVALID',
    );
  });

  it('splitParams sorts by numeric address and sums', () => {
    const params = splitParams(
      [
        { address: B, share: 400_000 },
        { address: A.toUpperCase().replace('0X', '0x'), share: 600_000n },
      ],
      100,
    );
    expect(params).toEqual({
      recipients: [A, B],
      allocations: [600_000n, 400_000n],
      totalAllocation: 1_000_000n,
      distributionIncentive: 100,
    });
  });

  it.each<[string, unknown, string | undefined]>([
    ['empty_recipients', [], 'empty_recipients'],
    [
      'invalid_address',
      [
        {
          address: '0x86b8145C98e5BD25BA722645b15eD65f024a87EC',
          share: 1_000_000,
        },
      ],
      'invalid_address',
    ],
    [
      'duplicate_address',
      [
        { address: A, share: 500_000 },
        { address: A.toLowerCase(), share: 500_000 },
      ],
      'duplicate_address',
    ],
    [
      'share_not_positive_integer',
      [{ address: A, share: '1000000' }],
      'share_not_positive_integer',
    ],
    ['sum_mismatch', [{ address: A, share: 999_999 }], 'sum_mismatch'],
  ])('splitParams rejects %s', async (_name, recipients, issue) => {
    const error = await caught(() => splitParams(recipients as never));
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect((error.details.issues as Array<{ issue?: string }>)[0].issue).toBe(
      issue,
    );
  });

  it('splitParams rejects a distribution incentive above uint16', async () => {
    const error = await caught(() =>
      splitParams([{ address: A, share: 1_000_000 }], 65_536),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('hashSplitParams matches the on-chain splitHash of the vector split', () => {
    expect(
      hashSplitParams({
        recipients: [A, B, RAF],
        allocations: [500_000n, 490_000n, 10_000n],
        totalAllocation: 1_000_000n,
        distributionIncentive: 0,
      }),
    ).toBe(
      '0x511c299d2ed2bdb4546677164aec78700a6e9340930dce9a94da60a1ea9ee461',
    );
  });
});
