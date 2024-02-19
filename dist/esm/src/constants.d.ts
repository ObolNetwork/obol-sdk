export declare const CONFLICT_ERROR_MSG = "Conflict";
export declare const CreatorConfigHashSigningTypes: {
    CreatorConfigHash: {
        name: string;
        type: string;
    }[];
};
export declare const EnrSigningTypes: {
    ENR: {
        name: string;
        type: string;
    }[];
};
export declare const OperatorConfigHashSigningTypes: {
    OperatorConfigHash: {
        name: string;
        type: string;
    }[];
};
export declare const Domain: (chainId: number) => {
    name: string;
    version: string;
    chainId: number;
};
export declare const dkg_algorithm = "default";
export declare const config_version = "v1.7.0";
export declare const SDK_VERSION = "1.0.8";
export declare const DEFAULT_BASE_URL = "https://api.obol.tech";
export declare const DEFAULT_CHAIN_ID = 1;
