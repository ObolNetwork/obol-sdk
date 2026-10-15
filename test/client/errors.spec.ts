// @ts-nocheck
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  Client,
  ConflictError,
  NotFoundError,
  ObolApiError,
  RateLimitError,
  RequestTimeoutError,
  UnauthorizedError,
  ValidationError,
  TERMS_ACCEPTED_MSG,
} from '../../src/index.js';
import {
  clusterConfigV1X10,
  clusterLockV1X10,
  enr,
  TEST_ADDRESSES,
} from '../fixtures.js';

const BASE_URL = 'https://obol-api-nonprod-dev.dev.obol.tech';
const SIGNER_ADDRESS = TEST_ADDRESSES.OVM_OWNER;
const CONFIG_HASH = clusterLockV1X10.cluster_definition.config_hash;

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const textResponse = (status: number, text: string): Response =>
  ({
    ok: false,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  }) as unknown as Response;

const makeSigner = () => ({
  getAddress: jest.fn().mockResolvedValue(SIGNER_ADDRESS),
  signTypedData: jest.fn().mockResolvedValue('0xsignature'),
});

describe('Obol API errors', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cases: Array<[number, unknown]> = [
    [400, ValidationError],
    [422, ValidationError],
    [401, UnauthorizedError],
    [403, UnauthorizedError],
    [404, NotFoundError],
    [409, ConflictError],
    [429, RateLimitError],
    [500, ObolApiError],
  ];

  it.each(cases)(
    'maps status %i to the matching error class',
    async (status, ErrorClass) => {
      const body = { message: `failure ${status}`, statusCode: status };
      jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(status, body));
      const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

      const error = await client
        .getClusterDefinition(CONFIG_HASH)
        .catch(e => e as ObolApiError);

      expect(error).toBeInstanceOf(ErrorClass);
      expect(error).toBeInstanceOf(ObolApiError);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(status);
      expect(error.endpoint).toBe(`/v1/definition/${CONFIG_HASH}`);
      expect(error.method).toBe('GET');
      expect(error.body).toEqual(body);
      // Body fields stay readable as before.
      expect(error.message).toBe(`failure ${status}`);
      expect(error.statusCode).toBe(status);
      if (ErrorClass !== ObolApiError) {
        expect(typeof error.hint).toBe('string');
      }
    },
  );

  it('copies extra body fields and joins validation message lists', async () => {
    const body = {
      message: ['name must be a string', 'operators should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(400, body));
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    const error = await client
      .getClusterLock(CONFIG_HASH)
      .catch(e => e as ValidationError);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe(
      'name must be a string; operators should not be empty',
    );
    expect(error.error).toBe('Bad Request');
    expect(error.body).toEqual(body);
  });

  it('does not let body fields overwrite error metadata', async () => {
    const body = { message: 'x', status: 'bad', endpoint: '/evil', name: 'n' };
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(404, body));
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    const error = await client.getClusterLockByHash(CONFIG_HASH).catch(e => e);

    expect(error.status).toBe(404);
    expect(error.endpoint).toBe(`/v1/lock/${CONFIG_HASH}`);
    expect(error.name).toBe('NotFoundError');
  });

  it('handles non-JSON error bodies', async () => {
    const html = '<html><body>502 Bad Gateway</body></html>';
    jest.spyOn(global, 'fetch').mockResolvedValue(textResponse(502, html));
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    const error = await client
      .getClusterDefinition(CONFIG_HASH)
      .catch(e => e as ObolApiError);

    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.status).toBe(502);
    expect(error.body).toBe(html);
    expect(error.message).toBe('Obol API request failed with status 502');
  });

  it('handles empty error bodies', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(textResponse(404, ''));
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    const error = await client.getClusterDefinition(CONFIG_HASH).catch(e => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe('Obol API request failed with status 404');
  });

  it('ConflictError keeps its no-argument constructor', () => {
    const error = new ConflictError();
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('This Cluster has been already posted.');
    expect(error.name).toBe('ConflictError');
  });

  it('createClusterDefinition throws ConflictError with the API message', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(409, { message: 'Duplicate entry', statusCode: 409 }),
      );
    const client = new Client(
      { baseUrl: BASE_URL, chainId: 560048 },
      makeSigner(),
    );

    const error = await client
      .createClusterDefinition(clusterConfigV1X10)
      .catch(e => e as ConflictError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe('Duplicate entry');
    expect(error.method).toBe('POST');
    expect(error.hint).toMatch(/getClusterDefinition\('0x[0-9a-f]+'\)/);
  });

  it('acceptClusterDefinition surfaces conflicts as ConflictError', async () => {
    const definition = structuredClone(clusterLockV1X10.cluster_definition);
    definition.operators = definition.operators.map(o => ({
      address: o.address,
    }));
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'PUT'
        ? jsonResponse(409, {
            message: 'ENR already exists in this cluster',
            error: 'Conflict',
            statusCode: 409,
          })
        : jsonResponse(200, definition),
    );
    const signer = {
      ...makeSigner(),
      getAddress: jest.fn().mockResolvedValue(definition.operators[0].address),
    };
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 }, signer);

    const error = await client
      .acceptClusterDefinition({ enr }, CONFIG_HASH)
      .catch(e => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe('ENR already exists in this cluster');
    expect(error.method).toBe('PUT');
  });
});

describe('request timeout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const hangingFetch = () =>
    jest.spyOn(global, 'fetch').mockImplementation(
      async (_url, init) =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

  it('throws RequestTimeoutError when the API does not respond in time', async () => {
    hangingFetch();
    const client = new Client({
      baseUrl: BASE_URL,
      chainId: 560048,
      timeoutMs: 20,
    });

    const error = await client.getClusterDefinition(CONFIG_HASH).catch(e => e);

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error.timeoutMs).toBe(20);
    expect(error.endpoint).toBe(`/v1/definition/${CONFIG_HASH}`);
    expect(error.method).toBe('GET');
    expect(typeof error.hint).toBe('string');
  });

  it('defaults to a 30 second timeout and passes an AbortSignal', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { config_hash: CONFIG_HASH }));
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    expect(client.timeoutMs).toBe(30_000);
    await client.getClusterDefinition(CONFIG_HASH);
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('rethrows a caller abort unchanged', async () => {
    hangingFetch();
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });
    const controller = new AbortController();

    const pending = client['request']('/v1/test', {
      signal: controller.signal,
    });
    controller.abort();
    const error = await pending.catch(e => e);

    expect(error).not.toBeInstanceOf(RequestTimeoutError);
    expect(error.name).toBe('AbortError');
  });

  it('rejects an invalid timeoutMs', () => {
    expect(
      () => new Client({ baseUrl: BASE_URL, chainId: 560048, timeoutMs: -1 }),
    ).toThrow('timeoutMs');
  });
});

describe('terms and conditions helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hasAcceptedTerms returns the API flag for a given address', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { isTermsAndConditionsSigned: true }),
      );
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });

    await expect(
      client.hasAcceptedTerms(TEST_ADDRESSES.SPLIT_OWNER),
    ).resolves.toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${BASE_URL}/v1/termsAndConditions/${TEST_ADDRESSES.SPLIT_OWNER}`,
    );
  });

  it('hasAcceptedTerms defaults to the signer address', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { isTermsAndConditionsSigned: false }),
      );
    const client = new Client(
      { baseUrl: BASE_URL, chainId: 560048 },
      makeSigner(),
    );

    await expect(client.hasAcceptedTerms()).resolves.toBe(false);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${BASE_URL}/v1/termsAndConditions/${SIGNER_ADDRESS}`,
    );
  });

  it('hasAcceptedTerms requires an address or a signer', async () => {
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });
    await expect(client.hasAcceptedTerms()).rejects.toThrow(
      'Signer is required in hasAcceptedTerms',
    );
  });

  it('hasAcceptedTerms rejects a malformed address before calling the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });
    await expect(client.hasAcceptedTerms('0xnope')).rejects.toThrow(
      'Invalid address: expected a 0x-prefixed 20-byte address',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hasAcceptedTerms surfaces API rejections as ValidationError', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(400, {
        message: 'Address is not a valid ethereum address.',
        error: 'Bad Request',
        statusCode: 400,
      }),
    );
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 });
    await expect(
      client.hasAcceptedTerms(TEST_ADDRESSES.SPLIT_OWNER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ifNotAccepted skips signing when already accepted', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { isTermsAndConditionsSigned: true }),
      );
    const signer = makeSigner();
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 }, signer);

    await expect(
      client.acceptObolLatestTermsAndConditions({ ifNotAccepted: true }),
    ).resolves.toBe(TERMS_ACCEPTED_MSG);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ifNotAccepted signs and posts when not yet accepted', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, { isTermsAndConditionsSigned: false }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          success: true,
          message: 'successful authorization',
        }),
      );
    const signer = makeSigner();
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 }, signer);

    await expect(
      client.acceptObolLatestTermsAndConditions({ ifNotAccepted: true }),
    ).resolves.toBe('successful authorization');
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[1][1].method).toBe('POST');
  });

  it('default behaviour still throws ConflictError when already accepted', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(409, { message: 'Duplicate entry', statusCode: 409 }),
      );
    const signer = makeSigner();
    const client = new Client({ baseUrl: BASE_URL, chainId: 560048 }, signer);

    const error = await client
      .acceptObolLatestTermsAndConditions()
      .catch(e => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe('Duplicate entry');
    expect(error.hint).toMatch(/ifNotAccepted/);
    // No pre-check request without the option.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
  });
});

describe('ObolSdkError', () => {
  it('is the base of the local check errors, with a code and hint', async () => {
    const {
      ChainMismatchError,
      DefinitionVerificationError,
      NotAnOperatorError,
      IncentivesPreflightError,
      ObolSdkError,
    } = await import('../../src/index.js');
    const cases = [
      [new ChainMismatchError(1, 560048, 'deposit'), 'CHAIN_MISMATCH'],
      [
        new DefinitionVerificationError('bad'),
        'DEFINITION_VERIFICATION_FAILED',
      ],
      [new NotAnOperatorError(SIGNER_ADDRESS, CONFIG_HASH), 'NOT_AN_OPERATOR'],
      [
        new IncentivesPreflightError('failed', [
          { code: 'INVALID_PROOF', message: 'm', hint: 'h' },
        ]),
        'INCENTIVES_PREFLIGHT_FAILED',
      ],
    ];
    for (const [error, code] of cases) {
      expect(error).toBeInstanceOf(ObolSdkError);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ObolApiError);
      expect(error.code).toBe(code);
      expect(typeof error.hint).toBe('string');
    }
    const mismatch = cases[0][0];
    expect(mismatch.name).toBe('ChainMismatchError');
    expect(mismatch.expectedChainId).toBe(1);
    expect(mismatch.message).toBe(
      'deposit: signer is connected to chain 560048 but the client is configured for chain 1',
    );
  });
});
