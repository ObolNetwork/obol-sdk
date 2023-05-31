// src/resources/base.ts

import fetch from 'cross-fetch';
import { FORK_MAPPING } from './constants';

type Config = {
  baseUrl?: string;
  chainId?: number;
};

export abstract class Base {
   baseUrl: string;
   chainId: number;
   fork_version: string;



  constructor({ baseUrl, chainId }: Config) {
    this.baseUrl = baseUrl || 'https://obol-api-dev.gcp.obol.tech';
    this.chainId = chainId || 5;
    this.fork_version = FORK_MAPPING[this.chainId]
  }

  protected request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    };

    return fetch(url, config).then((response) => {
      if (response.ok) {
        return response.json();
      }
      throw new Error(response.statusText);
    });
  }
}
