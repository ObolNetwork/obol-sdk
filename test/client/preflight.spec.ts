// @ts-nocheck
import { jest, describe, test, expect, afterEach } from '@jest/globals';
import {
  Client,
  ChainMismatchError,
  DefinitionVerificationError,
  NotAnOperatorError,
  NotFoundError,
  ObolSdkError,
  PreflightFailedError,
  ResumeMismatchError,
} from '../../src/index';
import { clusterConfigOrDefinitionHash } from '../../src/verification/common.js';
import {
  clusterConfigV1X10,
  clusterLockV1X10,
  soloClusterConfigV1X10,
  TEST_ADDRESSES,
} from '../fixtures.js';

const baseUrl = 'https://obol-api-nonprod-dev.dev.obol.tech';
const lockDefinition = clusterLockV1X10.cluster_definition;
const OPERATOR = lockDefinition.operators[0].address;
const OPERATOR_ENR = lockDefinition.operators[0].enr;
const CREATOR = clusterConfigV1X10.operators[3].address;

const mockSigner = (address: string, chainId?: number) => ({
  getAddress: jest.fn().mockResolvedValue(address),
  signTypedData: jest.fn().mockResolvedValue('0xsigned'),
  sendTransaction: jest.fn(),
  provider:
    chainId === undefined
      ? null
      : {
          getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(chainId) }),
        },
});

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/**
 * Mocks the Obol API: GET definition returns `definition` (404 if null), the
 * terms lookup returns `terms` (a status code if a number), POST echoes the
 * body and PUT returns the definition.
 */
const mockApi = ({
  definition = null,
  terms = true,
}: { definition?: any; terms?: boolean | number } = {}) =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    if (path.includes('/termsAndConditions/')) {
      return typeof terms === 'number'
        ? json(terms, { message: 'unavailable', statusCode: terms })
        : json(200, { isTermsAndConditionsSigned: terms });
    }
    if (method === 'POST') {
      return json(201, JSON.parse(init.body));
    }
    if (definition === null) {
      return json(404, { message: 'Not Found', statusCode: 404 });
    }
    return json(200, definition);
  });

const calls = (fetchSpy, method: string) =>
  fetchSpy.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

const codes = result => result.issues.map(i => i.code);
const issue = (result, code) => result.issues.find(i => i.code === code);

/** The fixture Hoodi definition before any operator has accepted. */
const pendingDefinition = () => {
  const def = structuredClone(lockDefinition);
  def.operators = def.operators.map(o => ({ address: o.address }));
  return def;
};

/** A copy of an address with an invalid EIP-55 checksum. */
const badChecksum = (address: string) => {
  const i = address.slice(2).search(/[a-fA-F]/) + 2;
  const c = address[i];
  const flipped = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
  return address.slice(0, i) + flipped + address.slice(i + 1);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('preflightCreate', () => {
  const client = (signer = mockSigner(CREATOR, 560048), provider?) =>
    new Client({ baseUrl, chainId: 560048 }, signer, provider);

  test('passes a valid payload, reporting the threshold', async () => {
    mockApi();
    const result = await client().preflightCreate(
      structuredClone(clusterConfigV1X10),
    );

    expect(result.ok).toBe(true);
    expect(result.issues.every(i => i.severity !== 'error')).toBe(true);
    expect(issue(result, 'THRESHOLD')).toMatchObject({
      severity: 'info',
      message: 'Threshold will be 3 of 4 operators',
    });
  });

  test('does not modify the payload', async () => {
    mockApi();
    const payload = {
      name: clusterConfigV1X10.name,
      operators: clusterConfigV1X10.operators,
      validators: clusterConfigV1X10.validators,
    };
    await client().preflightCreate(payload);
    expect(Object.keys(payload)).toEqual(['name', 'operators', 'validators']);
  });

  test('accepts a solo payload (empty operator addresses)', async () => {
    mockApi();
    const result = await client().preflightCreate(
      structuredClone(soloClusterConfigV1X10),
    );
    expect(result.ok).toBe(true);
  });

  test('reports schema errors as issues instead of throwing', async () => {
    mockApi();
    const result = await client().preflightCreate({
      ...clusterConfigV1X10,
      unknown_field: 1,
    });

    expect(result.ok).toBe(false);
    expect(issue(result, 'INVALID_PAYLOAD').message).toContain(
      'must NOT have additional properties',
    );
  });

  test('reports an unsupported definition version', async () => {
    mockApi();
    const result = await client().preflightCreate(clusterConfigV1X10, {
      version: 'v1.9.0',
    });
    expect(codes(result)).toContain('UNSUPPORTED_DEFINITION_VERSION');
    expect(result.ok).toBe(false);
  });

  test('warns about an invalid address checksum without failing', async () => {
    mockApi();
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators[1].address = badChecksum(payload.operators[1].address);

    const result = await client().preflightCreate(payload);

    expect(result.ok).toBe(true);
    expect(issue(result, 'OPERATOR_ADDRESS_CHECKSUM')).toMatchObject({
      severity: 'warning',
    });
  });

  test('reports malformed operator addresses', async () => {
    mockApi();
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators[2].address = '0x1234';

    const result = await client().preflightCreate(payload);
    expect(issue(result, 'INVALID_OPERATOR_ADDRESS').message).toContain(
      'Operator 2',
    );
    expect(result.ok).toBe(false);
  });

  test('reports duplicate operators case-insensitively', async () => {
    mockApi();
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators[3].address = payload.operators[0].address.toLowerCase();

    const result = await client().preflightCreate(payload);
    expect(issue(result, 'DUPLICATE_OPERATOR').message).toContain(
      'Operators 0 and 3',
    );
    expect(result.ok).toBe(false);
  });

  test('reports too few operators', async () => {
    mockApi();
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators = payload.operators.slice(0, 3);

    const result = await client().preflightCreate(payload);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['INVALID_PAYLOAD', 'TOO_FEW_OPERATORS']),
    );
    expect(codes(result)).not.toContain('THRESHOLD');
  });

  test('reports zero withdrawal and fee recipient addresses', async () => {
    mockApi();
    const payload = structuredClone(clusterConfigV1X10);
    payload.validators[0].withdrawal_address = TEST_ADDRESSES.ZERO_ADDRESS;
    payload.validators[0].fee_recipient_address = TEST_ADDRESSES.ZERO_ADDRESS;

    const result = await client().preflightCreate(payload);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['ZERO_WITHDRAWAL_ADDRESS', 'ZERO_FEE_RECIPIENT']),
    );
  });

  test('reports whether recipients are contracts when a provider is available', async () => {
    mockApi();
    const { withdrawal_address: withdrawal, fee_recipient_address: fee } =
      clusterConfigV1X10.validators[0];
    const provider = {
      getCode: jest.fn(async (address: string) =>
        address === withdrawal ? '0x6080' : '0x',
      ),
    };

    const result = await client(undefined, provider).preflightCreate(
      structuredClone(clusterConfigV1X10),
    );

    expect(result.ok).toBe(true);
    expect(issue(result, 'RECIPIENT_IS_CONTRACT')).toMatchObject({
      severity: 'info',
      message: `${withdrawal} is a contract`,
    });
    expect(issue(result, 'RECIPIENT_IS_EOA').message).toContain(fee);
  });

  test('reports a provider failure as info', async () => {
    mockApi();
    const provider = {
      getCode: jest.fn(async () => {
        throw new Error('rpc down');
      }),
    };
    const result = await client(undefined, provider).preflightCreate(
      structuredClone(clusterConfigV1X10),
    );
    expect(result.ok).toBe(true);
    expect(issue(result, 'RECIPIENT_CHECK_FAILED').severity).toBe('info');
  });

  test('reports a signer on another chain', async () => {
    mockApi();
    const result = await client(mockSigner(CREATOR, 1)).preflightCreate(
      structuredClone(clusterConfigV1X10),
    );
    expect(issue(result, 'CHAIN_MISMATCH').message).toContain('chain 1');
    expect(result.ok).toBe(false);
  });

  test('reports terms not accepted by the signer', async () => {
    const fetchSpy = mockApi({ terms: false });
    const result = await client().preflightCreate(
      structuredClone(clusterConfigV1X10),
    );

    expect(issue(result, 'TERMS_NOT_ACCEPTED').message).toContain(CREATOR);
    expect(result.ok).toBe(false);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      `/v1/termsAndConditions/${CREATOR}`,
    );
  });

  test('warns when the terms status cannot be read', async () => {
    mockApi({ terms: 503 });
    const result = await client().preflightCreate(
      structuredClone(clusterConfigV1X10),
    );
    expect(result.ok).toBe(true);
    expect(issue(result, 'TERMS_CHECK_FAILED').severity).toBe('warning');
  });

  test('reports a missing signer', async () => {
    const fetchSpy = mockApi();
    const result = await new Client({
      baseUrl,
      chainId: 560048,
    }).preflightCreate(structuredClone(clusterConfigV1X10));

    expect(codes(result)).toContain('SIGNER_REQUIRED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createClusterDefinition pre-flight', () => {
  test('throws PreflightFailedError before signing when terms are not accepted', async () => {
    const fetchSpy = mockApi({ terms: false });
    const signer = mockSigner(CREATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const err = await client
      .createClusterDefinition(structuredClone(clusterConfigV1X10))
      .catch(e => e);

    expect(err).toBeInstanceOf(PreflightFailedError);
    expect(err).toBeInstanceOf(ObolSdkError);
    expect(err.code).toBe('PREFLIGHT_FAILED');
    expect(err.issues.map(i => i.code)).toEqual(['TERMS_NOT_ACCEPTED']);
    expect(err.hint).toContain('acceptObolLatestTermsAndConditions');
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(calls(fetchSpy, 'POST')).toHaveLength(0);
  });

  test('throws PreflightFailedError with every failed payload check', async () => {
    const fetchSpy = mockApi();
    const signer = mockSigner(CREATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators[3].address = payload.operators[0].address;

    const err = await client.createClusterDefinition(payload).catch(e => e);

    expect(err).toBeInstanceOf(PreflightFailedError);
    expect(err.message).toMatch(/^Validation failed: /);
    expect(err.issues.map(i => i.code)).toEqual([
      'INVALID_PAYLOAD',
      'DUPLICATE_OPERATOR',
    ]);
    // Enforced checks failed, so the terms are not looked up.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  test('keeps ChainMismatchError for a signer on another chain', async () => {
    const fetchSpy = mockApi();
    const client = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(CREATOR, 1),
    );

    await expect(
      client.createClusterDefinition(structuredClone(clusterConfigV1X10)),
    ).rejects.toThrow(ChainMismatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('does not fail on warnings or unknown terms status', async () => {
    const fetchSpy = mockApi({ terms: 503 });
    const signer = mockSigner(CREATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);
    const payload = structuredClone(clusterConfigV1X10);
    payload.operators[1].address = badChecksum(payload.operators[1].address);

    const configHash = await client.createClusterDefinition(payload);

    expect(configHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(calls(fetchSpy, 'POST')).toHaveLength(1);
  });
});

describe('createClusterDefinition resumeFrom', () => {
  /** Creates a definition through the SDK and returns the POSTed body. */
  const createDefinition = async (signer, payload) => {
    const fetchSpy = mockApi();
    const client = new Client({ baseUrl, chainId: 560048 }, signer);
    await client.createClusterDefinition(structuredClone(payload));
    const body = JSON.parse(calls(fetchSpy, 'POST')[0][1].body);
    jest.restoreAllMocks();
    return body;
  };

  test('returns the existing config_hash without signing or posting', async () => {
    const definition = await createDefinition(
      mockSigner(CREATOR, 560048),
      clusterConfigV1X10,
    );
    const fetchSpy = mockApi({ definition });
    const signer = mockSigner(CREATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const configHash = await client.createClusterDefinition(
      structuredClone(clusterConfigV1X10),
      { resumeFrom: definition.config_hash },
    );

    expect(configHash).toBe(definition.config_hash);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(calls(fetchSpy, 'POST')).toHaveLength(0);
  });

  test('uses the existing definition version unless one is given', async () => {
    const signer = mockSigner(CREATOR, 560048);
    const definition = await createDefinition(signer, clusterConfigV1X10);
    // Created as the latest version, resumed asking for an older one.
    mockApi({ definition });
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const err = await client
      .createClusterDefinition(structuredClone(clusterConfigV1X10), {
        resumeFrom: definition.config_hash,
        version: 'v1.10.0',
      })
      .catch(e => e);
    expect(err).toBeInstanceOf(ResumeMismatchError);
    expect(err.fields).toEqual(['version']);
  });

  test('rejects a payload that does not match the definition', async () => {
    const definition = await createDefinition(
      mockSigner(CREATOR, 560048),
      clusterConfigV1X10,
    );
    const signer = mockSigner(CREATOR, 560048);
    const fetchSpy = mockApi({ definition });
    const client = new Client({ baseUrl, chainId: 560048 }, signer);
    const payload = structuredClone(clusterConfigV1X10);
    payload.name = 'another name';
    payload.validators[0].withdrawal_address =
      TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1;

    const err = await client
      .createClusterDefinition(payload, { resumeFrom: definition.config_hash })
      .catch(e => e);

    expect(err).toBeInstanceOf(ResumeMismatchError);
    expect(err.code).toBe('RESUME_MISMATCH');
    expect(err.fields).toEqual(['name', 'validators']);
    expect(err.message).toContain('different: name, validators');
    expect(err.hint).toContain('omit resumeFrom');
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(calls(fetchSpy, 'POST')).toHaveLength(0);
  });

  test('rejects a definition created by another address', async () => {
    const definition = await createDefinition(
      mockSigner(CREATOR, 560048),
      clusterConfigV1X10,
    );
    mockApi({ definition });
    const other = clusterConfigV1X10.operators[0].address;
    const client = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(other, 560048),
    );

    const err = await client
      .createClusterDefinition(structuredClone(clusterConfigV1X10), {
        resumeFrom: definition.config_hash,
      })
      .catch(e => e);

    expect(err).toBeInstanceOf(ResumeMismatchError);
    expect(err.message).toContain(`not by the signer ${other}`);
  });

  test('rejects a definition that fails verification', async () => {
    const definition = await createDefinition(
      mockSigner(CREATOR, 560048),
      clusterConfigV1X10,
    );
    definition.name = 'tampered';
    mockApi({ definition });
    const client = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(CREATOR, 560048),
    );

    await expect(
      client.createClusterDefinition(structuredClone(clusterConfigV1X10), {
        resumeFrom: definition.config_hash,
      }),
    ).rejects.toThrow(DefinitionVerificationError);
  });

  test('rejects a malformed resumeFrom', async () => {
    const fetchSpy = mockApi();
    const client = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(CREATOR, 560048),
    );
    await expect(
      client.createClusterDefinition(structuredClone(clusterConfigV1X10), {
        resumeFrom: '0x1234',
      }),
    ).rejects.toThrow('Invalid resumeFrom');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('resumes, then the accept step returns early if the creator already accepted', async () => {
    // The fixture creator is operator 0 and has accepted.
    const payload = {
      name: lockDefinition.name,
      operators: lockDefinition.operators.map(o => ({ address: o.address })),
      validators: lockDefinition.validators,
      deposit_amounts: lockDefinition.deposit_amounts,
      compounding: lockDefinition.compounding,
      target_gas_limit: lockDefinition.target_gas_limit,
      consensus_protocol: lockDefinition.consensus_protocol,
    };
    const fetchSpy = mockApi({ definition: lockDefinition });
    const signer = mockSigner(lockDefinition.creator.address, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const configHash = await client.createClusterDefinition(payload, {
      resumeFrom: lockDefinition.config_hash,
    });
    expect(configHash).toBe(lockDefinition.config_hash);

    const accepted = await client.acceptClusterDefinition(
      { enr: OPERATOR_ENR },
      configHash,
    );
    expect(accepted).toEqual(lockDefinition);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(calls(fetchSpy, 'POST')).toHaveLength(0);
    expect(calls(fetchSpy, 'PUT')).toHaveLength(0);
  });
});

describe('preflightAccept', () => {
  const client = (address = OPERATOR, chainId = 560048) =>
    new Client({ baseUrl, chainId }, mockSigner(address, 560048));

  test('passes for an operator of a verified pending definition', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi({ definition: def });

    const result = await client().preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
    });

    expect(result).toEqual({ ok: true, issues: [] });
    expect(calls(fetchSpy, 'PUT')).toHaveLength(0);
  });

  test('works without a signer when an address is given', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const readOnly = new Client({ baseUrl, chainId: 560048 });

    await expect(
      readOnly.preflightAccept(def.config_hash, {
        enr: OPERATOR_ENR,
        address: OPERATOR,
      }),
    ).resolves.toEqual({ ok: true, issues: [] });

    const noAddress = await readOnly.preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
    });
    expect(codes(noAddress)).toEqual(['ADDRESS_REQUIRED']);
  });

  test('reports an invalid config hash without calling the API', async () => {
    const fetchSpy = mockApi();
    const result = await client().preflightAccept('0x1234', {
      enr: OPERATOR_ENR,
    });
    expect(codes(result)).toEqual(['INVALID_CONFIG_HASH']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reports an invalid address', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const result = await client().preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
      address: '0x1234',
    });
    expect(codes(result)).toContain('INVALID_ADDRESS');
  });

  test('reports a definition that is not found', async () => {
    mockApi({ definition: null });
    const result = await client().preflightAccept(lockDefinition.config_hash, {
      enr: OPERATOR_ENR,
    });
    expect(codes(result)).toEqual(['DEFINITION_NOT_FOUND']);
    expect(result.ok).toBe(false);
  });

  test('reports a definition that fails verification', async () => {
    const def = pendingDefinition();
    def.validators[0].withdrawal_address = TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1;
    mockApi({ definition: def });

    const result = await client().preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
    });
    expect(issue(result, 'DEFINITION_VERIFICATION_FAILED').message).toMatch(
      /does not match its config_hash/,
    );
  });

  test('reports a definition for another network', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const mainnet = new Client({ baseUrl, chainId: 1 });

    const result = await mainnet.preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
      address: OPERATOR,
    });
    expect(issue(result, 'DEFINITION_VERIFICATION_FAILED').message).toMatch(
      /fork_version 0x10000910/,
    );
  });

  test('reports a signer on another chain and still checks the definition', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi({ definition: def });
    const onMainnet = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(OPERATOR, 1),
    );

    const result = await onMainnet.preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
    });
    expect(codes(result)).toEqual(['CHAIN_MISMATCH']);
    expect(calls(fetchSpy, 'GET').length).toBeGreaterThan(0);
  });

  test('reports a version that differs from the definition', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const result = await client().preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
      version: 'v1.11.0',
    });
    expect(codes(result)).toContain('VERSION_MISMATCH');
  });

  test('reports an address that is not an operator', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const result = await client(TEST_ADDRESSES.OVM_OWNER).preflightAccept(
      def.config_hash,
      { enr: OPERATOR_ENR },
    );
    expect(issue(result, 'NOT_AN_OPERATOR').message).toContain(
      TEST_ADDRESSES.OVM_OWNER,
    );
  });

  test('reports an earlier acceptance with the same ENR as info', async () => {
    const fetchSpy = mockApi({ definition: lockDefinition });
    const result = await client().preflightAccept(lockDefinition.config_hash, {
      enr: OPERATOR_ENR,
    });

    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual(['ALREADY_ACCEPTED']);
    expect(result.issues[0].severity).toBe('info');
    // Nothing to sign, so the terms are not looked up.
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('termsAndConditions'),
      ),
    ).toBe(false);
  });

  test('reports an earlier acceptance with a different ENR', async () => {
    mockApi({ definition: lockDefinition });
    const result = await client().preflightAccept(lockDefinition.config_hash, {
      enr: lockDefinition.operators[1].enr,
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['ALREADY_ACCEPTED_DIFFERENT_ENR', 'ENR_IN_USE']),
    );
  });

  test('reports an ENR that does not decode', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const result = await client().preflightAccept(def.config_hash, {
      enr: 'enr:not-an-enr',
    });
    expect(codes(result)).toEqual(['INVALID_ENR']);
  });

  test('reports an ENR used by another operator', async () => {
    const def = pendingDefinition();
    // ENRs are not part of the config hash.
    def.operators[1].enr = lockDefinition.operators[1].enr;
    mockApi({ definition: def });

    const result = await client().preflightAccept(def.config_hash, {
      enr: lockDefinition.operators[1].enr,
    });
    expect(issue(result, 'ENR_IN_USE').message).toContain(
      lockDefinition.operators[1].address,
    );
  });

  test('reports a non-string ENR', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const result = await client().preflightAccept(def.config_hash, {
      enr: 42,
    });
    expect(codes(result)).toEqual(['INVALID_OPERATOR_PAYLOAD']);
  });

  test('reports terms not accepted', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def, terms: false });
    const result = await client().preflightAccept(def.config_hash, {
      enr: OPERATOR_ENR,
    });
    expect(codes(result)).toEqual(['TERMS_NOT_ACCEPTED']);
  });
});

describe('acceptClusterDefinition pre-flight', () => {
  test('throws PreflightFailedError before signing when terms are not accepted', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi({ definition: def, terms: false });
    const signer = mockSigner(OPERATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const err = await client
      .acceptClusterDefinition({ enr: OPERATOR_ENR }, def.config_hash)
      .catch(e => e);

    expect(err).toBeInstanceOf(PreflightFailedError);
    expect(err.issues.map(i => i.code)).toEqual(['TERMS_NOT_ACCEPTED']);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(calls(fetchSpy, 'PUT')).toHaveLength(0);
  });

  test('keeps NotAnOperatorError and NotFoundError', async () => {
    const def = pendingDefinition();
    mockApi({ definition: def });
    const outsider = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(TEST_ADDRESSES.OVM_OWNER, 560048),
    );
    await expect(
      outsider.acceptClusterDefinition({ enr: OPERATOR_ENR }, def.config_hash),
    ).rejects.toThrow(NotAnOperatorError);

    jest.restoreAllMocks();
    mockApi({ definition: null });
    const operator = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(OPERATOR, 560048),
    );
    await expect(
      operator.acceptClusterDefinition({ enr: OPERATOR_ENR }, def.config_hash),
    ).rejects.toThrow(NotFoundError);
  });

  test('leaves ENR problems to the API', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi({ definition: def });
    const signer = mockSigner(OPERATOR, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await client.acceptClusterDefinition(
      { enr: 'enr:not-an-enr' },
      def.config_hash,
    );
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    expect(calls(fetchSpy, 'PUT')).toHaveLength(1);
  });

  test('throws PreflightFailedError for a malformed config hash', async () => {
    const fetchSpy = mockApi();
    const client = new Client(
      { baseUrl, chainId: 560048 },
      mockSigner(OPERATOR, 560048),
    );
    const err = await client
      .acceptClusterDefinition({ enr: OPERATOR_ENR }, '0x1234/../lock')
      .catch(e => e);
    expect(err).toBeInstanceOf(PreflightFailedError);
    expect(err.message).toContain('Invalid configHash');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('payload and definition checks agree with clusterConfigOrDefinitionHash', () => {
    // Sanity check for the fixtures used above.
    expect(clusterConfigOrDefinitionHash(pendingDefinition(), true)).toBe(
      lockDefinition.config_hash,
    );
  });
});
