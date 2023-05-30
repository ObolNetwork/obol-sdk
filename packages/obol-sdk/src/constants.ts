export const CONFLICT_ERROR_MSG = "Conflict"

const EIP712_DOMAIN_NAME = "Obol";
const EIP712_DOMAIN_VERSION = "1";
const chainId = 5;
export const CreatorConfigHashSigningTypes = {
    CreatorConfigHash: [{ name: "creator_config_hash", type: "string" }],
};
export const Domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
}