// src/resources/base.ts
import { DEFAULT_BASE_URL, DEFAULT_CHAIN_ID, SDK_VERSION } from './constants.js'
import { FORK_MAPPING } from './types.js'

interface Config {
  baseUrl?: string
  chainId?: FORK_MAPPING
}

export abstract class Base {
  baseUrl: string
  chainId: number
  fork_version: string

  constructor ({
    baseUrl = DEFAULT_BASE_URL,
    chainId = DEFAULT_CHAIN_ID,
  }: Config) {
    this.baseUrl = baseUrl
    this.chainId = chainId
    this.fork_version = FORK_MAPPING[this.chainId]
  }

  protected async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Obol-SDK/${SDK_VERSION}`,
        ...options?.headers,
      },
    }

    try {
      const response = await fetch(url, config)
      if (response.ok) {
        return await response.json()
      }
      throw new Error(response.statusText)
    } catch (e) {
      throw e
    }
  }
}
