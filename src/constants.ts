export const CONFLICT_ERROR_MSG = "Conflict"
const EIP712_DOMAIN_NAME = "Obol";
const EIP712_DOMAIN_VERSION = "1";
export const CreatorConfigHashSigningTypes = {
  CreatorConfigHash: [{ name: "creator_config_hash", type: "string" }],
};
export const EnrSigningTypes = {
  ENR: [{ name: "enr", type: "string" }],
};
export const OperatorConfigHashSigningTypes = {
  OperatorConfigHash: [{ name: "operator_config_hash", type: "string" }],
};
export const Domain = (chainId: number) => {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
  }
}
export const dkg_algorithm = "default";
export const config_version = "v1.7.0";
export const SDK_VERSION = "1.0.8";
export const DEFAULT_BASE_URL = "https://api.obol.tech";
export const DEFAULT_CHAIN_ID = 1;