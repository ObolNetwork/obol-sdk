import Ajv, { type ErrorObject } from 'ajv'

export function validatePayload (
  data: any,
  schema: any,
): ErrorObject[] | undefined | null | boolean {
  const ajv = new Ajv()
  const validate = ajv.compile(schema)
  const isValid = validate(data)
  if (!isValid) {
    throw new Error(
      `Schema compilation errors', ${validate.errors?.[0].message}`,
    )
  }
  return isValid
}
