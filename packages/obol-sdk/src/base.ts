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



  constructor({ baseUrl = 'https://016e-2a01-9700-15b3-9500-59d3-ccda-fa6c-51a8.eu.ngrok.io', chainId = 5 }: Config) {
    this.baseUrl = baseUrl;
    this.chainId = chainId;
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
