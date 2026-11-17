import { PayloadValidationError } from './errors.js';
import * as schemas from './schema.js';
import * as validators from './generated/validators.js';

// Re-exported for existing importers; defined next to the schemas.
export {
  VALID_DEPOSIT_AMOUNTS,
  VALID_NON_COMPOUNDING_AMOUNTS,
} from './schema.js';

interface ValidationErrorObject {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

type PrecompiledValidator = ((data: unknown) => boolean) & {
  errors?: ValidationErrorObject[] | null;
};

// The schemas are compiled to plain JavaScript at build time by
// scripts/generate-validators.mjs (ajv standalone code), so validation never
// generates code at runtime and works under a CSP without 'unsafe-eval'.
// Validators are looked up by the identity of the schema object exported from
// src/schema.ts, under the same export name.
const precompiled = new Map<object, PrecompiledValidator>();
for (const [name, validate] of Object.entries(validators)) {
  const schema = (schemas as Record<string, unknown>)[name];
  if (typeof validate === 'function' && schema && typeof schema === 'object') {
    precompiled.set(schema, validate as PrecompiledValidator);
  }
}

export function validatePayload<T>(data: unknown, schema: object): T {
  const validate = precompiled.get(schema);
  if (!validate) {
    throw new Error(
      'validatePayload: no precompiled validator for this schema; export it from src/schema.ts and run `yarn generate:validators`',
    );
  }
  const valid = validate(data);
  if (!valid) {
    const errors = validate.errors
      ?.map(e => `${e.instancePath} ${e.message}`)
      .join(', ');
    throw new PayloadValidationError(
      `Validation failed: ${errors}`,
      validate.errors ?? [],
    );
  }
  return data as T;
}
