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

export enum FORK_MAPPING {
    "0x00000000" = 1, // Mainnet
    "0x00001020" = 5, // Goerli/Prater
    "0x00000064" = 100, // Gnosis Chain
    "0x70000069" = 1337802, // Kiln
    "0x80000069" = 3, // Ropsten
  }