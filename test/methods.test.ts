import { ethers } from 'ethers'
import { Client, validateClusterLock } from '../src/index'
import { clusterConfigV1X7, clusterLockV1X6, clusterLockV1X7, clusterLockV1X8 } from './fixtures.js'
import { SDK_VERSION } from '../src/constants'
import { Base } from '../src/base'
import { validatePayload } from '../src/ajv'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { hashTermsAndConditions } from '../src/verification/termsAndConditions'

/* eslint no-new: 0 */
describe('Cluster Client', () => {
  const mockConfigHash =
    '0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd'
  const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? ''
  const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey
  const wallet = new ethers.Wallet(privateKey)
  const mockSigner = wallet.connect(null)

  const clientInstance = new Client(
    { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 5 },
    mockSigner,
  )

  // test('throws invalid ChainId when it is equal to 1', async () => {
  //   try {
  //     new Client({ chainId: 1 }, mockSigner)
  //   } catch (error: any) {
  //     expect(error.message).toBe('Obol-SDK is in Beta phase, mainnet is not yet supported')
  //   }
  // })

  test('createTermsAndConditions should return "successful authorization"', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ message: 'successful authorization' }))

    const isAuthorized =
      await clientInstance.acceptObolLatestTermsAndConditions()
    expect(isAuthorized).toEqual('successful authorization')
  })

  test('createClusterDefinition should return config_hash', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }))

    const configHash =
      await clientInstance.createClusterDefinition(clusterConfigV1X7)
    expect(configHash).toEqual(mockConfigHash)
  })

  test('acceptClusterDefinition should return cluster definition', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition))

    const clusterDefinition = await clientInstance.acceptClusterDefinition(
      {
        enr: clusterLockV1X7.cluster_definition.operators[0].enr,
        version: clusterLockV1X7.cluster_definition.version,
      },
      clusterLockV1X7.cluster_definition.config_hash,
    )
    expect(clusterDefinition).toEqual(clusterLockV1X7.cluster_definition)
  })

  test('createClusterDefinition should throw an error on invalid operators', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }))
    try {
      await clientInstance.createClusterDefinition({
        ...clusterConfigV1X7,
        operators: [],
      })
    } catch (error: any) {
      expect(error.message).toEqual(
        "Schema compilation errors', must NOT have fewer than 4 items",
      )
    }
  })

  test('validatePayload should throw an error on empty schema', async () => {
    try {
      validatePayload({ ...clusterConfigV1X7, operators: [] }, '')
    } catch (error: any) {
      expect(error.message).toEqual('schema must be object or boolean')
    }
  })

  test('getClusterdefinition should return cluster definition if config hash exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition))

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X7.cluster_definition.config_hash,
    )

    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X7.cluster_definition.config_hash,
    )
  })

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X7))

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X7.cluster_definition.config_hash,
    )
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X7.lock_hash)
  })

  test('request method should set user agent header', async () => {
    const server = setupServer(
      http.get('http://testexample.com/test', ({ request }) => {
        // Check if the request contains specific headers
        if (request.headers.get('User-Agent') === `Obol-SDK/${SDK_VERSION}`) {
          return HttpResponse.json({ message: 'user-agent header exist' })
        }
      }),
    )
    server.listen()
    class TestBase extends Base {
      async callProtectedRequest<T>(
        endpoint: string,
        options?: RequestInit,
      ): Promise<T> {
        return await this['request'](endpoint, options)
      }
    }
    const testBaseInstance = new TestBase({ baseUrl: 'http://testExample.com' })

    const result: { message: string } =
      await testBaseInstance.callProtectedRequest('/test', {
        method: 'GET',
      })
    expect(result?.message).toEqual('user-agent header exist')
    server.close()
  })
})

describe('Cluster Client without a signer', () => {
  const clientInstance = new Client({
    baseUrl: 'https://obol-api-dev.gcp.obol.tech',
    chainId: 5,
  })

  test('createClusterDefinition should throw an error without signer', async () => {
    try {
      await clientInstance.createClusterDefinition(clusterConfigV1X7)
    } catch (err: any) {
      expect(err.message).toEqual('Signer is required in createClusterDefinition')
    }
  })

  test('acceptClusterDefinition should throw an error without signer', async () => {
    try {
      await clientInstance.acceptClusterDefinition(
        {
          enr: clusterLockV1X7.cluster_definition.operators[0].enr,
          version: clusterLockV1X7.cluster_definition.version,
        },
        clusterLockV1X7.cluster_definition.config_hash,
      )
    } catch (err: any) {
      expect(err.message).toEqual('Signer is required in acceptClusterDefinition')
    }
  })

  test('getClusterdefinition should return cluster definition if config hash exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition))

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X7.cluster_definition.config_hash,
    )
    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X7.cluster_definition.config_hash,
    )
  })

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X7))

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X7.cluster_definition.config_hash,
    )
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X7.lock_hash)
  })

  test.each([{ version: 'v1.6.0', clusterLock: clusterLockV1X6 }, { version: 'v1.7.0', clusterLock: clusterLockV1X7 }, { version: 'v1.8.0', clusterLock: clusterLockV1X8 }])(
    '$version: \'should return true on verified cluster lock\'',
    async ({ clusterLock }) => {
      const isValidLock: boolean = await validateClusterLock(clusterLock)
      expect(isValidLock).toEqual(true)
    })

  test('Finds the hash of the latest version of terms and conditions', async () => {
    const termsAndConditionsHash = await hashTermsAndConditions()
    expect(termsAndConditionsHash).toEqual('0xa27f806434a2a26572582a87baf908bb0c01adcb497a0e61c58867e7c3b6743e')
  })
})
