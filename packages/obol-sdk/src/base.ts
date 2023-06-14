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



  constructor({ baseUrl = 'https://f17d-2a01-9700-16b9-fe00-c959-451a-dfd8-85af.eu.ngrok.io', chainId = 5 }: Config) {
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
