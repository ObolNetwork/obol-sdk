import { ENR } from '@chainsafe/enr';
import { getAddress, isAddress, ZeroAddress } from 'ethers';
import { validatePayload } from './ajv.js';
import { SUPPORTED_DEFINITION_VERSIONS } from './constants.js';
import {
  DefinitionVerificationError,
  NotAnOperatorError,
  NotFoundError,
  type ObolApiError,
  type ObolSdkError,
  PreflightFailedError,
} from './errors.js';
import { definitionSchema, operatorPayloadSchema } from './schema.js';
import {
  type ClusterDefinition,
  type ClusterOperator,
  type ClusterPayload,
  type OperatorPayload,
  type PreflightIssue,
  type PreflightResult,
  type ProviderType,
  type SignerType,
} from './types.js';
import { assertSignerChain } from './utils.js';
import { assertAddress, assertHash32 } from './validation.js';

type CollectedIssue = {
  issue: PreflightIssue;
  /** The write method fails on this issue (it failed there before pre-flight existed). */
  enforced: boolean;
  /**
   * Error the write method threw for this check before pre-flight existed
   * (typed SDK errors, API and network errors); rethrown as is.
   */
  cause?: unknown;
};

const isError = (issue: PreflightIssue): boolean =>
  (issue.severity ?? 'error') === 'error';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Issues collected by a pre-flight run.
 *
 * @internal
 */
export class PreflightIssues {
  private readonly entries: CollectedIssue[] = [];

  add(
    issue: PreflightIssue,
    { enforced = false, cause }: { enforced?: boolean; cause?: unknown } = {},
  ): void {
    this.entries.push({
      issue: { ...issue, severity: issue.severity ?? 'error' },
      enforced: enforced && isError(issue),
      cause,
    });
  }

  hasCode(code: string): boolean {
    return this.entries.some(e => e.issue.code === code);
  }

  /** Whether a write method would fail on the issues collected so far. */
  hasEnforcedErrors(): boolean {
    return this.entries.some(e => e.enforced);
  }

  result(): PreflightResult {
    const issues = this.entries.map(e => e.issue);
    return { ok: !issues.some(isError), issues };
  }

  /**
   * Throws for the enforced issues: the original error of the first one if it
   * has one (so existing error classes are kept), else a
   * {@link PreflightFailedError} with every enforced issue.
   */
  throwIfEnforced(): void {
    const enforced = this.entries.filter(e => e.enforced);
    if (enforced.length === 0) {
      return;
    }
    if (enforced[0].cause !== undefined) {
      throw enforced[0].cause as Error;
    }
    throw new PreflightFailedError(enforced.map(e => e.issue));
  }
}

/**
 * What a pre-flight run needs from the client.
 *
 * @internal
 */
export type PreflightContext = {
  chainId: number;
  signer: SignerType | undefined;
  provider: ProviderType | undefined | null;
  /** `true` / `false` from the terms endpoint, `undefined` if the response has no answer. */
  termsStatus: (address: string) => Promise<boolean | undefined>;
  /** Fetches the definition and verifies its config hash and fork version. */
  getVerifiedDefinition: (configHash: string) => Promise<ClusterDefinition>;
};

const checkSignerChain = async (
  ctx: PreflightContext,
  issues: PreflightIssues,
  method: string,
): Promise<void> => {
  if (!ctx.signer) {
    return;
  }
  try {
    await assertSignerChain(ctx.signer, ctx.chainId, method);
  } catch (err) {
    issues.add(
      {
        code: 'CHAIN_MISMATCH',
        message: errorMessage(err),
        hint:
          (err as ObolSdkError)?.hint ??
          "Switch the wallet to the client's chain.",
      },
      { enforced: true, cause: err },
    );
  }
};

const checkTerms = async (
  ctx: PreflightContext,
  issues: PreflightIssues,
  address: string,
): Promise<void> => {
  let accepted: boolean | undefined;
  let cause: unknown;
  try {
    accepted = await ctx.termsStatus(address);
  } catch (err) {
    cause = err;
  }
  if (accepted === false) {
    // The API rejects definitions from addresses that have not accepted the terms.
    issues.add(
      {
        code: 'TERMS_NOT_ACCEPTED',
        message: `${address} has not accepted the latest Obol terms and conditions`,
        hint: 'Call acceptObolLatestTermsAndConditions() with this signer first.',
      },
      { enforced: true },
    );
  } else if (accepted === undefined) {
    issues.add({
      code: 'TERMS_CHECK_FAILED',
      message: `Could not check whether ${address} accepted the terms and conditions${cause === undefined ? '' : `: ${errorMessage(cause)}`}`,
      hint: 'Call hasAcceptedTerms() to check, and accept the terms if needed.',
      severity: 'warning',
    });
  }
};

/**
 * Pre-flight checks for {@link Client.createClusterDefinition}. Every check
 * that `createClusterDefinition` already enforced (supported version, payload
 * schema, signer chain) is marked as enforced; terms acceptance is enforced
 * too, since the API rejects the definition otherwise.
 *
 * With `failFast`, the terms and recipient lookups are skipped when an
 * enforced check has already failed.
 *
 * @internal
 */
export const runCreatePreflight = async (
  payload: ClusterPayload,
  {
    version,
    checkTerms: shouldCheckTerms = true,
    checkRecipients = true,
    failFast = false,
  }: {
    version: string;
    checkTerms?: boolean;
    checkRecipients?: boolean;
    failFast?: boolean;
  },
  ctx: PreflightContext,
): Promise<PreflightIssues> => {
  const issues = new PreflightIssues();

  if (!SUPPORTED_DEFINITION_VERSIONS.includes(version)) {
    issues.add(
      {
        code: 'UNSUPPORTED_DEFINITION_VERSION',
        message: `Unsupported cluster definition version ${String(version)}; expected one of ${SUPPORTED_DEFINITION_VERSIONS.join(', ')}`,
        hint: 'Use one of SUPPORTED_DEFINITION_VERSIONS, or omit the version to use the latest.',
      },
      { enforced: true },
    );
  }

  try {
    // Validate a copy: AJV fills defaults into the object it validates.
    validatePayload(structuredClone(payload), definitionSchema);
  } catch (err) {
    issues.add(
      {
        code: 'INVALID_PAYLOAD',
        message: errorMessage(err),
        hint: 'Fix the listed fields of the cluster payload.',
      },
      { enforced: true },
    );
  }

  const operators: unknown[] = Array.isArray(payload?.operators)
    ? payload.operators
    : [];
  const addresses = operators.map(o =>
    typeof (o as ClusterOperator)?.address === 'string'
      ? (o as ClusterOperator).address
      : '',
  );
  const solo = addresses.every(a => a === '');

  if (operators.length < 4) {
    issues.add(
      {
        code: 'TOO_FEW_OPERATORS',
        message: `A cluster needs at least 4 operators; got ${operators.length}`,
        hint: 'Add operators until there are at least 4.',
      },
      { enforced: true },
    );
  }

  if (!solo) {
    const seen = new Map<string, number>();
    addresses.forEach((address, index) => {
      // isAddress also rejects mixed-case addresses with a bad checksum.
      const valid: boolean = isAddress(address);
      if (!valid) {
        if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
          issues.add({
            code: 'OPERATOR_ADDRESS_CHECKSUM',
            message: `Operator ${index} address ${address} has an invalid EIP-55 checksum`,
            hint: 'Check the address for typos; use the checksummed form or all lower case.',
            severity: 'warning',
          });
        } else {
          issues.add(
            {
              code: 'INVALID_OPERATOR_ADDRESS',
              message: `Operator ${index} address ${JSON.stringify(address)} is not a 0x-prefixed 20-byte address`,
              hint: 'Give every operator an address, or leave all of them empty for a solo cluster.',
            },
            { enforced: true },
          );
          return;
        }
      }
      const key = address.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        issues.add(
          {
            code: 'DUPLICATE_OPERATOR',
            message: `Operators ${first} and ${index} have the same address ${address}`,
            hint: 'Each operator must have a different address (compared case-insensitively).',
          },
          { enforced: true },
        );
      } else {
        seen.set(key, index);
      }
    });
  }

  if (operators.length >= 4) {
    const threshold = Math.ceil((2 * operators.length) / 3);
    issues.add({
      code: 'THRESHOLD',
      message: `Threshold will be ${threshold} of ${operators.length} operators`,
      hint: `The cluster tolerates ${operators.length - threshold} offline operator(s).`,
      severity: 'info',
    });
  }

  const validators: unknown[] = Array.isArray(payload?.validators)
    ? payload.validators
    : [];
  const recipients = new Set<string>();
  validators.forEach((v, index) => {
    for (const field of ['withdrawal_address', 'fee_recipient_address']) {
      const value = (v as Record<string, unknown>)?.[field];
      if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        continue;
      }
      if (value.toLowerCase() === ZeroAddress) {
        issues.add(
          {
            code:
              field === 'withdrawal_address'
                ? 'ZERO_WITHDRAWAL_ADDRESS'
                : 'ZERO_FEE_RECIPIENT',
            message: `Validator ${index} ${field} is the zero address`,
            hint: `Set ${field} to an address you control (or a splitter contract).`,
          },
          { enforced: true },
        );
      } else {
        recipients.add(getAddress(value.toLowerCase()));
      }
    }
  });

  await checkSignerChain(ctx, issues, 'createClusterDefinition');

  if (failFast && issues.hasEnforcedErrors()) {
    return issues;
  }

  if (checkRecipients && ctx.provider) {
    for (const address of recipients) {
      try {
        const code = await ctx.provider.getCode(address);
        const isContract = typeof code === 'string' && code !== '0x';
        issues.add({
          code: isContract ? 'RECIPIENT_IS_CONTRACT' : 'RECIPIENT_IS_EOA',
          message: `${address} is ${isContract ? 'a contract' : 'not a contract (EOA or not yet deployed)'}`,
          hint: isContract
            ? 'Check the contract is the splitter / validator manager you expect.'
            : 'If this should be a splitter or validator manager contract, deploy it first or check the predicted address.',
          severity: 'info',
        });
      } catch (err) {
        issues.add({
          code: 'RECIPIENT_CHECK_FAILED',
          message: `Could not read code at ${address}: ${errorMessage(err)}`,
          hint: 'Check the provider connection.',
          severity: 'info',
        });
      }
    }
  }

  if (shouldCheckTerms) {
    if (ctx.signer) {
      await checkTerms(ctx, issues, await ctx.signer.getAddress());
    } else {
      issues.add({
        code: 'SIGNER_REQUIRED',
        message:
          'No signer: createClusterDefinition needs a signer, and terms acceptance was not checked',
        hint: 'Construct the Client with the creator signer.',
      });
    }
  }

  return issues;
};

/**
 * Result of {@link runAcceptPreflight}: the issues, plus what
 * {@link Client.acceptClusterDefinition} needs to continue.
 *
 * @internal
 */
export type AcceptPreflight = {
  issues: PreflightIssues;
  definition?: ClusterDefinition;
  address?: string;
  /** The operator has already accepted with this ENR. */
  alreadyAccepted: boolean;
  validatedPayload?: OperatorPayload;
};

/**
 * Pre-flight checks for {@link Client.acceptClusterDefinition}. Checks that
 * `acceptClusterDefinition` already enforced (config hash format, signer
 * chain, definition verification, version, payload schema, operator
 * membership) are marked as enforced, as is terms acceptance (the API rejects
 * the acceptance otherwise). ENR decoding and reuse, and an earlier acceptance
 * with a different ENR, are reported but left to the API.
 *
 * With `failFast`, stops after the first group of checks with an enforced
 * failure (so a chain mismatch stops before the definition is fetched).
 *
 * @internal
 */
export const runAcceptPreflight = async (
  configHash: string,
  {
    enr,
    address: givenAddress,
    version,
  }: { enr: unknown; address?: string; version?: string },
  { failFast = false }: { failFast?: boolean },
  ctx: PreflightContext,
): Promise<AcceptPreflight> => {
  const issues = new PreflightIssues();
  const out: AcceptPreflight = { issues, alreadyAccepted: false };
  const stop = (): boolean => failFast && issues.hasEnforcedErrors();

  try {
    assertHash32(configHash, 'configHash');
  } catch (err) {
    issues.add(
      {
        code: 'INVALID_CONFIG_HASH',
        message: errorMessage(err),
        hint: 'Pass the config_hash returned by createClusterDefinition.',
      },
      { enforced: true },
    );
    return out;
  }

  if (givenAddress !== undefined) {
    try {
      out.address = assertAddress(givenAddress, 'address');
    } catch (err) {
      issues.add({
        code: 'INVALID_ADDRESS',
        message: errorMessage(err),
        hint: 'Pass the operator address as a 0x-prefixed 20-byte hex string.',
      });
    }
  } else if (ctx.signer) {
    out.address = await ctx.signer.getAddress();
  } else {
    issues.add({
      code: 'ADDRESS_REQUIRED',
      message: 'No address given and no signer to take it from',
      hint: 'Pass { address } or construct the Client with the operator signer.',
    });
  }

  await checkSignerChain(ctx, issues, 'acceptClusterDefinition');
  if (stop()) {
    return out;
  }

  let definition: ClusterDefinition;
  try {
    definition = await ctx.getVerifiedDefinition(configHash);
  } catch (err) {
    if (err instanceof DefinitionVerificationError) {
      issues.add(
        {
          code: 'DEFINITION_VERIFICATION_FAILED',
          message: err.message,
          hint: err.hint ?? 'Do not accept this definition.',
        },
        { enforced: true, cause: err },
      );
    } else if (err instanceof NotFoundError) {
      issues.add(
        {
          code: 'DEFINITION_NOT_FOUND',
          message: `No cluster definition found for ${configHash}`,
          hint: 'Check the config hash and the client baseUrl / chainId.',
        },
        { enforced: true, cause: err },
      );
    } else {
      issues.add(
        {
          code: 'DEFINITION_FETCH_FAILED',
          message: `Could not fetch cluster definition ${configHash}: ${errorMessage(err)}`,
          hint: (err as ObolApiError)?.hint ?? 'Retry later.',
        },
        { enforced: true, cause: err },
      );
    }
    return out;
  }
  out.definition = definition;

  if (version !== undefined && version !== definition.version) {
    issues.add(
      {
        code: 'VERSION_MISMATCH',
        message: `Operator payload version ${version} does not match cluster definition version ${definition.version}`,
        hint: 'Omit the version to use the definition version.',
      },
      {
        enforced: true,
        cause: new DefinitionVerificationError(
          `Operator payload version ${version} does not match cluster definition version ${definition.version}`,
        ),
      },
    );
  }
  if (stop()) {
    return out;
  }

  try {
    out.validatedPayload = validatePayload<OperatorPayload>(
      { enr, version: definition.version },
      operatorPayloadSchema,
    );
  } catch (err) {
    issues.add(
      {
        code: 'INVALID_OPERATOR_PAYLOAD',
        message: errorMessage(err),
        hint: 'Pass the operator ENR as a string.',
      },
      { enforced: true },
    );
  }

  const operators = definition.operators ?? [];
  const operator =
    out.address === undefined
      ? undefined
      : operators.find(
          o => o.address?.toLowerCase() === out.address?.toLowerCase(),
        );
  if (out.address !== undefined && !operator) {
    const err = new NotAnOperatorError(out.address, configHash);
    issues.add(
      { code: 'NOT_AN_OPERATOR', message: err.message, hint: err.hint ?? '' },
      { enforced: true, cause: err },
    );
  }
  if (stop()) {
    return out;
  }

  if (operator?.config_signature) {
    if (operator.enr === enr) {
      out.alreadyAccepted = true;
      issues.add({
        code: 'ALREADY_ACCEPTED',
        message: `${operator.address} has already accepted ${configHash} with this ENR`,
        hint: 'Nothing to do; acceptClusterDefinition returns the definition without signing.',
        severity: 'info',
      });
      return out;
    }
    issues.add({
      code: 'ALREADY_ACCEPTED_DIFFERENT_ENR',
      message: `${operator.address} has already accepted ${configHash} with a different ENR`,
      hint: 'Use the ENR the operator accepted with; the API may reject a second acceptance.',
    });
  }

  if (typeof enr === 'string') {
    try {
      ENR.decodeTxt(enr);
    } catch (err) {
      issues.add({
        code: 'INVALID_ENR',
        message: `ENR does not decode: ${errorMessage(err)}`,
        hint: 'Pass the ENR printed by `charon create enr` (it starts with "enr:").',
      });
    }
    const other = operators.find(
      o =>
        o !== operator &&
        typeof o.enr === 'string' &&
        o.enr !== '' &&
        o.enr === enr,
    );
    if (other) {
      issues.add({
        code: 'ENR_IN_USE',
        message: `ENR is already used by operator ${other.address} in this cluster`,
        hint: 'Each operator must run its own charon node with its own ENR.',
      });
    }
  }

  if (out.address !== undefined) {
    await checkTerms(ctx, issues, out.address);
  }

  return out;
};
