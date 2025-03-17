import { type Signer, type JsonRpcSigner } from 'ethers';
import { DEFAULT_BASE_VERSION, CONFLICT_ERROR_MSG } from './constants.js';
import { ConflictError } from './errors.js';
import {
  type CreateMigrateValidatorDto,
  type MigrateValidator,
} from './types.js';
import { validatePayload } from './ajv.js';
import { migrateValidatorSchema } from './schema.js';
import { Base } from './base.js';

/**
 * Migrate validator functionality for Obol SDK
 */
export class Migrate extends Base {
  private readonly signer: Signer | JsonRpcSigner | undefined;

  constructor(signer?: Signer | JsonRpcSigner) {
    super({});
    this.signer = signer;
  }

  /**
   * Creates a new migrate validator entry.
   * @param {CreateMigrateValidatorDto} createMigrateValidatorDto - Data needed to create migrate validator
   * @returns {Promise<MigrateValidator>} The created migrate validator entry
   * @throws On invalid input or duplicate validator
   *
   * An example of how to use createMigrateValidator:
   * [createMigrateValidator](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L200)
   */
  async createMigrateValidator(
    createMigrateValidatorDto: CreateMigrateValidatorDto,
  ): Promise<MigrateValidator> {
    if (!this.signer) {
      throw new Error('Signer is required in createMigrateValidator');
    }

    validatePayload(createMigrateValidatorDto, migrateValidatorSchema);

    try {
      const migrateValidator: MigrateValidator = await this.request(
        `/${DEFAULT_BASE_VERSION}/migrate/${createMigrateValidatorDto.network}`,
        {
          method: 'POST',
          body: JSON.stringify(createMigrateValidatorDto),
        },
      );
      return migrateValidator;
    } catch (err: any) {
      if (err?.message === CONFLICT_ERROR_MSG) {
        throw new ConflictError();
      }
      throw err;
    }
  }
} 