import Ajv, { ErrorObject } from 'ajv';
import definitionSchema from './definitionSchema.json';
import { ClusterPayload } from './types';

export function validateDefinition(data: ClusterPayload): ErrorObject[] | undefined | null {
    const ajv = new Ajv();
    const validate = ajv.compile(definitionSchema);
    const isValid = validate(data);
    console.log(isValid, "isValid")
    if (!isValid) {
        return validate.errors;
    }
    return null;
}