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



  constructor({ baseUrl = 'https://d924-2a01-9700-111d-9f00-249f-5ebb-7be2-2d62.eu.ngrok.io', chainId = 5 }: Config) {
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

  protected pollRequest<T>(endpoint: string, options?: RequestInit, timeOut = 1000000): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    };

    return new Promise((resolve, reject) => {

      var pollReqIntervalId = setInterval(function () {
        fetch(url, config).then((response) => {
          if (response.ok) {
            clearInterval(pollReqIntervalId);
            resolve(response.json());
          }
        });
      }, 1000);

      setTimeout(function () {
        clearInterval(pollReqIntervalId);
        reject("Time out")
      }, timeOut)
    })
  }
}
