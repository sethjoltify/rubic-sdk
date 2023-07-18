import {
    ON_CHAIN_TRADE_TYPE,
    OnChainTradeType
} from 'src/features/on-chain/calculation-manager/providers/common/models/on-chain-trade-type';
import { UniswapV2AbstractTrade } from 'src/features/on-chain/calculation-manager/providers/dexes/common/uniswap-v2-abstract/uniswap-v2-abstract-trade';
import { UNISWAP_V2_SCROLL_TESTNET_CONTRACT_ADDRESS } from 'src/features/on-chain/calculation-manager/providers/dexes/scroll-testnet/uni-swap-v2-scroll-testnet/constants';

export class UniSwapV2ScrollTestnetTrade extends UniswapV2AbstractTrade {
    public static get type(): OnChainTradeType {
        return ON_CHAIN_TRADE_TYPE.UNISWAP_V2;
    }

    public readonly dexContractAddress = UNISWAP_V2_SCROLL_TESTNET_CONTRACT_ADDRESS;
}
