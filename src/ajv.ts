import Ajv, { type ErrorObject } from 'ajv'

import { ETHER_TO_GWEI } from './constants'

function validDpositAmounts (data: boolean, deposits: string[]): boolean {
  let sum = 0
  for (let i = 0; i < deposits.length; i++) {
    const amount = parseInt(deposits[i])
    if (amount % ETHER_TO_GWEI !== 0 || amount > 32 * ETHER_TO_GWEI) {
      return false
    }
    sum += amount
  }
  if (sum !== 32 * ETHER_TO_GWEI) {
    return false
  } else {
    return true
  }
}

export function validatePayload (
  data: any,
  schema: any,
): ErrorObject[] | undefined | null | boolean {
  const ajv = new Ajv()
  ajv.addKeyword({
    keyword: 'validDpositAmounts',
    validate: validDpositAmounts,
    errors: true,
  })
  const validate = ajv.compile(schema)
  const isValid = validate(data)
  if (!isValid) {
    throw new Error(
      `Schema compilation errors', ${validate.errors?.[0].message}`,
    )
  }
  return isValid
}
