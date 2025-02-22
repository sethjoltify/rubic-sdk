import BigNumber from 'bignumber.js';
import {
    FailedToCheckForTransactionReceiptError,
    InsufficientFundsGasPriceValueError,
    LowGasError,
    LowSlippageDeflationaryTokenError,
    LowSlippageError,
    RubicSdkError,
    TransactionRevertedError,
    UserRejectError
} from 'src/common/errors';
import { parseError } from 'src/common/utils/errors';
import { getGasOptions } from 'src/common/utils/options';
import { BlockchainName } from 'src/core/blockchain/models/blockchain-name';
import { BlockchainsInfo } from 'src/core/blockchain/utils/blockchains-info/blockchains-info';
import { EvmTransactionOptions } from 'src/core/blockchain/web3-private-service/web3-private/evm-web3-private/models/evm-transaction-options';
import { Web3Error } from 'src/core/blockchain/web3-private-service/web3-private/models/web3.error';
import { Web3Private } from 'src/core/blockchain/web3-private-service/web3-private/web3-private';
import { ERC20_TOKEN_ABI } from 'src/core/blockchain/web3-public-service/web3-public/evm-web3-public/constants/erc-20-token-abi';
import { EvmWeb3Pure } from 'src/core/blockchain/web3-pure/typed-web3-pure/evm-web3-pure/evm-web3-pure';
import { WalletProviderCore } from 'src/core/sdk/models/wallet-provider';
import { proxyHashErrors } from 'src/features/cross-chain/calculation-manager/providers/common/constants/proxy-hash-errors';
import Web3 from 'web3';
import { TransactionConfig } from 'web3-core';
import { TransactionReceipt } from 'web3-eth';
import { AbiItem } from 'web3-utils';

export class EvmWeb3Private extends Web3Private {
    /**
     * Parses web3 error by its code or message.
     * @param err Web3 error to parse.
     */
    public static parseError(err: Web3Error): RubicSdkError {
        if (err.message.includes('Transaction has been reverted by the EVM')) {
            return new TransactionRevertedError();
        }
        if (err.message.includes('execution reverted: UNIV3R: min return')) {
            return new LowSlippageError();
        }
        if (err.message.includes('execution reverted: Address: low-level call with value failed')) {
            return new InsufficientFundsGasPriceValueError();
        }
        if (err.message.includes('Failed to check for transaction receipt')) {
            return new FailedToCheckForTransactionReceiptError();
        }
        if (err.code === -32603) {
            return new LowGasError();
        }
        if (err.code === 4001) {
            return new UserRejectError();
        }
        try {
            const error = EvmWeb3Private.tryParseProxyError(err);
            if (error) {
                return error;
            }
            if (err.message.includes('0x6c544f')) {
                return new InsufficientFundsGasPriceValueError();
            }
            if (
                err.message.includes('0xf32bec2f') ||
                err.message.includes(
                    'execution reverted: Received amount of tokens are less then expected'
                ) ||
                err.message.includes('0x275c273c')
            ) {
                return new LowSlippageDeflationaryTokenError();
            }
            const errorMessage = JSON.parse(err.message.slice(24)).message;
            if (errorMessage) {
                return new Error(errorMessage);
            }
        } catch {}
        return parseError(err);
    }

    private static tryParseProxyError(err: Error | { data: string }): RubicSdkError | undefined {
        if ('data' in err) {
            const error = proxyHashErrors.find(error => error.hash === err.data);
            if (error) {
                return new RubicSdkError(error.text);
            }
        }

        return undefined;
    }

    protected readonly Web3Pure = EvmWeb3Pure;

    /**
     * Instance of web3, initialized with ethereum wallet, e.g. Metamask, WalletConnect.
     */
    public readonly web3: Web3;

    constructor(walletProviderCore: WalletProviderCore<Web3>) {
        super(walletProviderCore.address);
        this.web3 = walletProviderCore.core;

        this.checkAddressCorrect();
    }

    public async getBlockchainName(): Promise<BlockchainName | undefined> {
        const userChainId = await this.web3.eth.getChainId();
        return BlockchainsInfo.getBlockchainNameById(userChainId);
    }

    /**
     * Sends Eth in transaction and resolve the promise when the transaction is included in the block.
     * @param toAddress Eth receiver address.
     * @param [options] Additional options.
     * @returns Transaction receipt.
     */
    public async sendTransaction(
        toAddress: string,
        options: EvmTransactionOptions = {}
    ): Promise<TransactionReceipt> {
        return new Promise((resolve, reject) => {
            this.web3.eth
                .sendTransaction({
                    from: this.address,
                    to: toAddress,
                    value: Web3Private.stringifyAmount(options.value || 0),
                    ...(options.gas && { gas: Web3Private.stringifyAmount(options.gas) }),
                    ...getGasOptions(options),
                    ...(options.data && { data: options.data })
                })
                .on('transactionHash', options.onTransactionHash || (() => {}))
                .on('receipt', receipt => resolve(receipt))
                .on('error', err => {
                    console.error(`Send transaction error. ${err}`);
                    reject(EvmWeb3Private.parseError(err as Web3Error));
                });
        });
    }

    /**
     * Tries to send Eth in transaction and resolve the promise when the transaction is included in the block or rejects the error.
     * @param toAddress Eth receiver address.
     * @param [options] Additional options.
     * @returns Transaction receipt.
     */
    public async trySendTransaction(
        toAddress: string,
        options: EvmTransactionOptions = {}
    ): Promise<TransactionReceipt> {
        try {
            const gaslessParams = {
                from: this.address,
                to: toAddress,
                value: Web3Private.stringifyAmount(options.value || 0),
                ...(options.data && { data: options.data })
            };
            const gas = await this.web3.eth.estimateGas(gaslessParams);

            const gasfullParams = {
                ...gaslessParams,
                ...getGasOptions(options),
                gas: Web3Private.stringifyAmount(gas, 1.05)
            };
            await this.web3.eth.estimateGas(gasfullParams);

            const sendParams = {
                ...options,
                ...gasfullParams
            };

            return this.sendTransaction(toAddress, sendParams);
        } catch (err) {
            console.debug('Call tokens transfer error', err);
            const shouldIgnore = this.shouldIgnoreError(err);
            if (shouldIgnore) {
                return this.sendTransaction(toAddress, options);
            }
            throw EvmWeb3Private.parseError(err as Web3Error);
        }
    }

    /**
     * Executes method of smart-contract and resolve the promise when the transaction is included in the block.
     * @param contractAddress Address of smart-contract which method is to be executed.
     * @param contractAbi Abi of smart-contract which method is to be executed.
     * @param methodName Method name to execute.
     * @param methodArguments Method arguments.
     * @param [options] Additional options.
     * @returns Smart-contract method returned value.
     */
    public async executeContractMethod(
        contractAddress: string,
        contractAbi: AbiItem[],
        methodName: string,
        methodArguments: unknown[],
        options: EvmTransactionOptions = {}
    ): Promise<TransactionReceipt> {
        const contract = new this.web3.eth.Contract(contractAbi, contractAddress);

        return new Promise((resolve, reject) => {
            contract.methods[methodName](...methodArguments)
                .send({
                    from: this.address,
                    ...(options.value && {
                        value: Web3Private.stringifyAmount(options.value)
                    }),
                    ...(options.gas && {
                        gas: Web3Private.stringifyAmount(options.gas)
                    }),
                    ...getGasOptions(options)
                })
                .on('transactionHash', options.onTransactionHash || (() => {}))
                .on('receipt', resolve)
                .on('error', (err: Web3Error) => {
                    console.error(`Method execution error. ${err}`);
                    reject(EvmWeb3Private.parseError(err));
                });
        });
    }

    /**
     * Tries to execute method of smart-contract and resolve the promise when the transaction is included in the block or rejects the error.
     * @param contractAddress Address of smart-contract which method is to be executed.
     * @param contractAbi Abi of smart-contract which method is to be executed.
     * @param methodName Method name to execute.
     * @param methodArguments Method arguments.
     * @param [options] Additional options.
     * @param allowError Check error and decides to execute contact if error is allowed.
     */
    public async tryExecuteContractMethod(
        contractAddress: string,
        contractAbi: AbiItem[],
        methodName: string,
        methodArguments: unknown[],
        options: EvmTransactionOptions = {},
        allowError?: (err: Web3Error) => boolean
    ): Promise<TransactionReceipt> {
        const contract = new this.web3.eth.Contract(contractAbi, contractAddress);

        try {
            const gaslessParams = {
                from: this.address,
                ...(options.value && { value: Web3Private.stringifyAmount(options.value) })
            };

            const gas = await contract.methods[methodName](...methodArguments).estimateGas(
                gaslessParams
            );

            const gasfullParams = {
                ...gaslessParams,
                ...getGasOptions(options),
                gas: Web3Private.stringifyAmount(gas, 1.05)
            };

            await contract.methods[methodName](...methodArguments).estimateGas(gasfullParams);

            const sendParams = {
                ...options,
                ...gasfullParams
            };

            return this.executeContractMethod(
                contractAddress,
                contractAbi,
                methodName,
                methodArguments,
                sendParams
            );
        } catch (err) {
            if ((allowError && allowError(err as Web3Error)) || this.shouldIgnoreError(err)) {
                return this.executeContractMethod(
                    contractAddress,
                    contractAbi,
                    methodName,
                    methodArguments,
                    options
                );
            }
            console.error('Method execution error: ', err);
            throw EvmWeb3Private.parseError(err as Web3Error);
        }
    }

    private shouldIgnoreError(error: Web3Error): boolean {
        const ignoreCallErrors = [
            'STF',
            'execution reverted: ERC20: transfer amount exceeds allowance',
            'Anyswaperc20: request exceed allowance',
            'gas required exceeds allowance',
            'execution reverted: SafeERC20: low-level call failed'
        ];

        const test = ignoreCallErrors.some(err =>
            error?.message?.toLowerCase().includes(err.toLowerCase())
        );
        console.debug(test);
        return test;
    }

    /**
     * Executes approve method in ERC-20 token contract.
     * @param tokenAddress Address of the smart-contract corresponding to the token.
     * @param spenderAddress Wallet or contract address to approve.
     * @param amount Token amount to approve in wei.
     * @param [options] Additional options.
     * @returns Approval transaction receipt.
     */
    public async approveTokens(
        tokenAddress: string,
        spenderAddress: string,
        amount: BigNumber | 'infinity' = 'infinity',
        options: EvmTransactionOptions = {}
    ): Promise<TransactionReceipt> {
        const contract = new this.web3.eth.Contract(ERC20_TOKEN_ABI, tokenAddress);
        const rawValue = amount === 'infinity' ? new BigNumber(2).pow(256).minus(1) : amount;
        const gaslessParams = { from: this.address };

        const gas = await contract.methods
            .approve(spenderAddress, rawValue.toFixed(0))
            .estimateGas(gaslessParams);

        const gasfullParams = {
            ...gaslessParams,
            ...getGasOptions(options),
            gas: Web3Private.stringifyAmount(gas, 1)
        };

        await contract.methods
            .approve(spenderAddress, rawValue.toFixed(0))
            .estimateGas(gasfullParams);

        return new Promise((resolve, reject) => {
            contract.methods
                .approve(spenderAddress, rawValue.toFixed(0))
                .send(gasfullParams)
                .on('transactionHash', options.onTransactionHash || (() => {}))
                .on('receipt', resolve)
                .on('error', (err: Web3Error) => {
                    console.error(`Tokens approve error. ${err}`);
                    reject(EvmWeb3Private.parseError(err));
                });
        });
    }

    /**
     * Build encoded approve transaction config.
     * @param tokenAddress Address of the smart-contract corresponding to the token.
     * @param spenderAddress Wallet or contract address to approve.
     * @param value Amount of tokens in approval window in spending cap field
     * @param [options] Additional options.
     * @returns Encoded approve transaction config.
     */
    public async encodeApprove(
        tokenAddress: string,
        spenderAddress: string,
        value: BigNumber | 'infinity',
        options: EvmTransactionOptions = {}
    ): Promise<TransactionConfig> {
        const rawValue = value === 'infinity' ? new BigNumber(2).pow(256).minus(1) : value;
        const contract = new this.web3.eth.Contract(ERC20_TOKEN_ABI, tokenAddress);
        const gaslessParams = { from: this.address };

        const gas = await contract.methods
            .approve(spenderAddress, rawValue.toFixed(0))
            .estimateGas(gaslessParams);

        const gasfullParams = {
            ...gaslessParams,
            ...getGasOptions(options),
            gas: Web3Private.stringifyAmount(gas)
        };

        await contract.methods
            .approve(spenderAddress, rawValue.toFixed(0))
            .estimateGas(gasfullParams);

        return EvmWeb3Pure.encodeMethodCall(
            tokenAddress,
            ERC20_TOKEN_ABI,
            'approve',
            [spenderAddress, rawValue.toFixed(0)],
            undefined,
            gasfullParams
        );
    }
}
