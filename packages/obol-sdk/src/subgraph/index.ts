import { getAddress } from '@ethersproject/address'
import { BigNumber } from '@ethersproject/bignumber'
import { AddressZero, One } from '@ethersproject/constants'
import { GraphQLClient, gql } from 'graphql-request'

import { CHAIN_INFO } from '../constants'
import type {
  LiquidSplit,
  Split,
  SplitRecipient,
  TokenBalances,
  VestingModule,
  VestingStream,
  WaterfallModule,
  WaterfallTranche,
} from '../types'
import { fromBigNumberToPercent } from '../utils'
import {
  GqlLiquidSplit,
  GqlSplit,
  GqlTokenBalance,
  GqlVestingModule,
  GqlVestingStream,
  GqlWaterfallModule,
  GqlWaterfallTranche,
} from './types'

const TOKEN_BALANCE_FIELDS_FRAGMENT = gql`
  fragment TokenBalanceFieldsFragment on TokenBalance {
    amount
    token {
      id
    }
  }
`

const RECIPIENT_FIELDS_FRAGMENT = gql`
  fragment RecipientFieldsFragment on Recipient {
    id
    account {
      id
    }
    split {
      id
    }
    ownership
  }
`

const ACCOUNT_BALANCES_FRAGMENT = gql`
  fragment AccountBalancesFragment on Account {
    internalBalances(first: 1000, orderBy: amount, orderDirection: desc) {
      ...TokenBalanceFieldsFragment
    }
    withdrawals(first: 1000, orderBy: amount, orderDirection: desc) {
      ...TokenBalanceFieldsFragment
    }
  }

  ${TOKEN_BALANCE_FIELDS_FRAGMENT}
`

const ACCOUNT_FIELDS_FRAGMENT = gql`
  fragment AccountFieldsFragment on Account {
    id
    upstream(first: 1000) {
      ...RecipientFieldsFragment
    }
    ...AccountBalancesFragment
  }

  ${RECIPIENT_FIELDS_FRAGMENT}
  ${ACCOUNT_BALANCES_FRAGMENT}
`

const SPLIT_FIELDS_FRAGMENT = gql`
  fragment SplitFieldsFragment on Split {
    controller
    distributorFee
    newPotentialController
    createdBlock
    latestBlock
    recipients(first: 1000, orderBy: ownership, orderDirection: desc) {
      ...RecipientFieldsFragment
    }
  }

  ${RECIPIENT_FIELDS_FRAGMENT}
`

const FULL_SPLIT_FIELDS_FRAGMENT = gql`
  fragment FullSplitFieldsFragment on Split {
    ...AccountFieldsFragment
    ...SplitFieldsFragment
  }

  ${ACCOUNT_FIELDS_FRAGMENT}
  ${SPLIT_FIELDS_FRAGMENT}
`

const WATERFALL_TRANCHE_FIELDS_FRAGMENT = gql`
  fragment WaterfallTrancheFieldsFragment on WaterfallTranche {
    startAmount
    size
    claimedAmount
    recipient {
      id
    }
  }
`

const WATERFALL_MODULE_FIELDS_FRAGMENT = gql`
  fragment WaterfallModuleFieldsFragment on WaterfallModule {
    token {
      id
    }
    nonWaterfallRecipient
    latestBlock
    tranches(first: 1000) {
      ...WaterfallTrancheFieldsFragment
    }
  }

  ${WATERFALL_TRANCHE_FIELDS_FRAGMENT}
`

const FULL_WATERFALL_MODULE_FIELDS_FRAGMENT = gql`
  fragment FullWaterfallModuleFieldsFragment on WaterfallModule {
    ...AccountFieldsFragment
    ...WaterfallModuleFieldsFragment
  }

  ${ACCOUNT_FIELDS_FRAGMENT}
  ${WATERFALL_MODULE_FIELDS_FRAGMENT}
`

const VESTING_STREAM_FIELDS_FRAGMENT = gql`
  fragment VestingStreamFieldsFragment on VestingStream {
    token {
      id
    }
    streamId
    startTime
    totalAmount
    claimedAmount
  }
`

const VESTING_MODULE_FIELDS_FRAGMENT = gql`
  fragment VestingModuleFieldsFragment on VestingModule {
    beneficiary {
      id
    }
    vestingPeriod
    streams(first: 1000) {
      ...VestingStreamFieldsFragment
    }
  }

  ${VESTING_STREAM_FIELDS_FRAGMENT}
`

const FULL_VESTING_MODULE_FIELDS_FRAGMENT = gql`
  fragment FullVestingModuleFieldsFragment on VestingModule {
    ...AccountFieldsFragment
    ...VestingModuleFieldsFragment
  }

  ${ACCOUNT_FIELDS_FRAGMENT}
  ${VESTING_MODULE_FIELDS_FRAGMENT}
`

const LIQUID_SPLIT_HOLDERS_FRAGMENT = gql`
  fragment LiquidSplitHoldersFragment on Holder {
    account {
      id
    }
    ownership
  }
`

const LIQUID_SPLIT_FIELDS_FRAGMENT = gql`
  fragment LiquidSplitFieldsFragment on LiquidSplit {
    latestBlock
    holders(first: 1000, where: { ownership_gt: "0" }) {
      ...LiquidSplitHoldersFragment
    }
    distributorFee
    split {
      ...FullSplitFieldsFragment
    }
    isFactoryGenerated
  }

  ${LIQUID_SPLIT_HOLDERS_FRAGMENT}
  ${FULL_SPLIT_FIELDS_FRAGMENT}
`

const FULL_LIQUID_SPLIT_FIELDS_FRAGMENT = gql`
  fragment FullLiquidSplitFieldsFragment on LiquidSplit {
    ...AccountFieldsFragment
    ...LiquidSplitFieldsFragment
  }

  ${ACCOUNT_FIELDS_FRAGMENT}
  ${LIQUID_SPLIT_FIELDS_FRAGMENT}
`

const formatRecipient = (gqlRecipient: {
  account: { id: string }
  ownership: number
}): SplitRecipient => {
  return {
    address: getAddress(gqlRecipient.account.id),
    percentAllocation: fromBigNumberToPercent(gqlRecipient.ownership),
  }
}

// Should only be called by formatSplit on SplitsClient
export const protectedFormatSplit = (gqlSplit: GqlSplit): Split => {
  return {
    type: 'Split',
    id: getAddress(gqlSplit.id),
    controller:
      gqlSplit.controller !== AddressZero
        ? getAddress(gqlSplit.controller)
        : null,
    newPotentialController:
      gqlSplit.newPotentialController !== AddressZero
        ? getAddress(gqlSplit.newPotentialController)
        : null,
    distributorFeePercent: fromBigNumberToPercent(gqlSplit.distributorFee),
    createdBlock: gqlSplit.createdBlock,
    recipients: gqlSplit.recipients
      .map((gqlRecipient) => formatRecipient(gqlRecipient))
      .sort((a, b) => {
        return b.percentAllocation - a.percentAllocation
      }),
  }
}

// Should only be called by formatWaterfallModule on WaterfallClient
export const protectedFormatWaterfallModule = (
  gqlWaterfallModule: GqlWaterfallModule,
  tokenSymbol: string,
  tokenDecimals: number,
): WaterfallModule => {
  return {
    type: 'WaterfallModule',
    id: getAddress(gqlWaterfallModule.id),
    token: {
      address: getAddress(gqlWaterfallModule.token.id),
      symbol: tokenSymbol,
      decimals: tokenDecimals,
    },
    nonWaterfallRecipient:
      gqlWaterfallModule.nonWaterfallRecipient !== AddressZero
        ? getAddress(gqlWaterfallModule.nonWaterfallRecipient)
        : null,
    tranches: gqlWaterfallModule.tranches.map((tranche) =>
      formatWaterfallModuleTranche(tranche, tokenDecimals),
    ),
  }
}

const formatWaterfallModuleTranche = (
  gqlWaterfallTranche: GqlWaterfallTranche,
  tokenDecimals: number,
): WaterfallTranche => {
  return {
    recipientAddress: getAddress(gqlWaterfallTranche.recipient.id),
    startAmount: gqlWaterfallTranche.startAmount / Math.pow(10, tokenDecimals),
    size: gqlWaterfallTranche.size
      ? gqlWaterfallTranche.size / Math.pow(10, tokenDecimals)
      : undefined,
  }
}

// Should only be called by formatVestingModule on VestingClient
export const protectedFormatVestingModule = (
  gqlVestingModule: GqlVestingModule,
  tokenData: { [token: string]: { symbol: string; decimals: number } },
): VestingModule => {
  return {
    type: 'VestingModule',
    id: getAddress(gqlVestingModule.id),
    beneficiary: {
      address: getAddress(gqlVestingModule.beneficiary.id),
    },
    vestingPeriod: parseInt(gqlVestingModule.vestingPeriod),
    ...(gqlVestingModule.streams && {
      streams: gqlVestingModule.streams.map((gqlVestingStream) =>
        formatVestingModuleStream(gqlVestingStream, tokenData),
      ),
    }),
  }
}

const formatVestingModuleStream = (
  gqlVestingStream: GqlVestingStream,
  tokenData: { [token: string]: { symbol: string; decimals: number } },
): VestingStream => {
  const tokenDecimals = tokenData[gqlVestingStream.token.id].decimals

  return {
    streamId: parseInt(gqlVestingStream.streamId),
    startTime: parseInt(gqlVestingStream.startTime),
    totalAmount: gqlVestingStream.totalAmount / Math.pow(10, tokenDecimals),
    releasedAmount:
      gqlVestingStream.claimedAmount / Math.pow(10, tokenDecimals),
    token: {
      address: getAddress(gqlVestingStream.token.id),
      symbol: tokenData[gqlVestingStream.token.id].symbol,
      decimals: tokenData[gqlVestingStream.token.id].decimals,
    },
    // Deprecated
    claimedAmount: gqlVestingStream.claimedAmount / Math.pow(10, tokenDecimals),
  }
}

// Should only be called by formatLiquidSplit on LiquidSplitClient
export const protectedFormatLiquidSplit = (
  gqlLiquidSplit: GqlLiquidSplit,
): LiquidSplit => {
  return {
    type: 'LiquidSplit',
    id: getAddress(gqlLiquidSplit.id),
    distributorFeePercent: fromBigNumberToPercent(
      gqlLiquidSplit.distributorFee,
    ),
    payoutSplitId: getAddress(gqlLiquidSplit.split.id),
    isFactoryGenerated: gqlLiquidSplit.isFactoryGenerated,
    holders: gqlLiquidSplit.holders
      .map((gqlHolder) => formatRecipient(gqlHolder))
      .sort((a, b) => {
        return b.percentAllocation - a.percentAllocation
      }),
  }
}

export const formatAccountBalances = (
  gqlTokenBalances: GqlTokenBalance[],
): TokenBalances => {
  return gqlTokenBalances.reduce((acc, gqlTokenBalance) => {
    const tokenId = getAddress(gqlTokenBalance.token.id)
    const amount = BigNumber.from(gqlTokenBalance.amount)

    if (amount.gt(One)) acc[tokenId] = amount
    return acc
  }, {} as TokenBalances)
}

export const SPLIT_QUERY = gql`
  query split($splitId: ID!) {
    split(id: $splitId) {
      ...FullSplitFieldsFragment
    }
  }

  ${FULL_SPLIT_FIELDS_FRAGMENT}
`

export const WATERFALL_MODULE_QUERY = gql`
  query waterfallModule($waterfallModuleId: ID!) {
    waterfallModule(id: $waterfallModuleId) {
      ...FullWaterfallModuleFieldsFragment
    }
  }

  ${FULL_WATERFALL_MODULE_FIELDS_FRAGMENT}
`

export const VESTING_MODULE_QUERY = gql`
  query vestingModule($vestingModuleId: ID!) {
    vestingModule(id: $vestingModuleId) {
      ...FullVestingModuleFieldsFragment
    }
  }

  ${FULL_VESTING_MODULE_FIELDS_FRAGMENT}
`

export const LIQUID_SPLIT_QUERY = gql`
  query liquidSplit($liquidSplitId: ID!) {
    liquidSplit(id: $liquidSplitId) {
      ...FullLiquidSplitFieldsFragment
    }
  }

  ${FULL_LIQUID_SPLIT_FIELDS_FRAGMENT}
`

export const ACCOUNT_QUERY = gql`
  query account($accountId: ID!) {
    account(id: $accountId) {
      __typename
      ...AccountFieldsFragment
      ...SplitFieldsFragment
      ...WaterfallModuleFieldsFragment
      ...LiquidSplitFieldsFragment
    }
  }

  ${ACCOUNT_FIELDS_FRAGMENT}
  ${SPLIT_FIELDS_FRAGMENT}
  ${WATERFALL_MODULE_FIELDS_FRAGMENT}
  ${LIQUID_SPLIT_FIELDS_FRAGMENT}
`

export const RELATED_SPLITS_QUERY = gql`
  query relatedSplits($accountId: String!) {
    receivingFrom: recipients(where: { account: $accountId }) {
      split {
        ...FullSplitFieldsFragment
      }
    }
    controlling: splits(where: { controller: $accountId }) {
      ...FullSplitFieldsFragment
    }
    pendingControl: splits(where: { newPotentialController: $accountId }) {
      ...FullSplitFieldsFragment
    }
  }

  ${FULL_SPLIT_FIELDS_FRAGMENT}
`

export const ACCOUNT_BALANCES_QUERY = gql`
  query accountBalances($accountId: ID!) {
    accountBalances: account(id: $accountId) {
      __typename
      ...AccountBalancesFragment
    }
  }

  ${ACCOUNT_BALANCES_FRAGMENT}
`

export const getGraphqlClient = (
  chainId: number,
): GraphQLClient | undefined => {
  const gqlEndpoint = CHAIN_INFO[chainId]?.gqlEndpoint
  if (!gqlEndpoint) return

  return new GraphQLClient(gqlEndpoint)
}
