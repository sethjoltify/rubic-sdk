import { SpiritSwapProvider } from 'src/features/swap/dexes/fantom/spirit-swap/spirit-swap-provider';
import { BLOCKCHAIN_NAME } from 'src/core';
import { SpiritSwapTrade } from 'src/features/swap/dexes/fantom/spirit-swap/spirit-swap-trade';
import { SPOOKY_SWAP_PROVIDER_CONFIGURATION } from 'src/features/swap/dexes/fantom/spooky-swap/constants';

export const spiritSwapFantomProviderSpec = () => {
    let spiritSwapProvider: SpiritSwapProvider;

    beforeEach(() => {
        spiritSwapProvider = new SpiritSwapProvider();
    });

    test('Initialize values', () => {
        expect(spiritSwapProvider.blockchain).toBe(BLOCKCHAIN_NAME.FANTOM);
        expect(typeof spiritSwapProvider.InstantTradeClass).toBe(typeof SpiritSwapTrade);
        expect(spiritSwapProvider.providerSettings).toBe(SPOOKY_SWAP_PROVIDER_CONFIGURATION);
    });
};
