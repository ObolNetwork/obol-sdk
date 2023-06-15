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



  constructor({ baseUrl = 'https://obol-api-dev.gcp.obol.tech', chainId = 5 }: Config) {
    this.baseUrl = baseUrl;
    this.chainId = chainId;
    this.fork_version = FORK_MAPPING[this.chainId]
  }

  protected async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    };

    try {
      const response = await fetch(url, config);
      if (response.ok) {
        return response.json();
      }
      throw new Error(response.statusText);
    } catch (e) {
      throw e
    }
  }
}
