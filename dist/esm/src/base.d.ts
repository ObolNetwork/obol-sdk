import { FORK_MAPPING } from './types.js';
type Config = {
    baseUrl?: string;
    chainId?: FORK_MAPPING;
};
export declare abstract class Base {
    baseUrl: string;
    chainId: number;
    fork_version: string;
    constructor({ baseUrl, chainId }: Config);
    protected request<T>(endpoint: string, options?: RequestInit): Promise<T>;
}
export {};
