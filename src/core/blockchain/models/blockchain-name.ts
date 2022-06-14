export const BLOCKCHAIN_NAME = {
    ETHEREUM: 'ETH',
    BINANCE_SMART_CHAIN: 'BSC',
    POLYGON: 'POLYGON',
    AVALANCHE: 'AVALANCHE',
    MOONRIVER: 'MOONRIVER',
    FANTOM: 'FANTOM',
    HARMONY: 'HARMONY',
    ARBITRUM: 'ARBITRUM',
    AURORA: 'AURORA',
    TELOS: 'TELOS'
} as const;

export type BlockchainName = typeof BLOCKCHAIN_NAME[keyof typeof BLOCKCHAIN_NAME];
