import { orderFactory } from '@0x/order-utils/lib/src/order_factory';
import { Web3ProviderEngine } from '@0x/subproviders';
import { SignedOrder } from '@0x/types';
import { BigNumber } from '@0x/utils';
import { Web3Wrapper } from '@0x/web3-wrapper';
import * as chai from 'chai';
import 'mocha';
import * as TypeMoq from 'typemoq';

import { AssetBuyer } from '../src';
import { constants } from '../src/constants';
import { LiquidityForAssetData, OrderProvider, OrdersAndFillableAmounts } from '../src/types';

import { chaiSetup } from './utils/chai_setup';
import {
    mockAvailableAssetDatas,
    mockedAssetBuyerWithOrdersAndFillableAmounts,
    orderProviderMock,
} from './utils/mocks';

chaiSetup.configure();
const expect = chai.expect;

const FAKE_SRA_URL = 'https://fakeurl.com';
const FAKE_ASSET_DATA = '0xf47261b00000000000000000000000001dc4c1cefef38a777b15aa20260a54e584b16c48';
const TOKEN_DECIMALS = 18;
const WETH_DECIMALS = constants.ETHER_TOKEN_DECIMALS;

const baseUnitAmount = (unitAmount: number, decimals = TOKEN_DECIMALS): BigNumber => {
    return Web3Wrapper.toBaseUnitAmount(new BigNumber(unitAmount), decimals);
};

const expectLiquidityResult = async (
    web3Provider: Web3ProviderEngine,
    orderProvider: OrderProvider,
    ordersAndFillableAmounts: OrdersAndFillableAmounts,
    expectedLiquidityResult: LiquidityForAssetData,
) => {
    const mockedAssetBuyer = mockedAssetBuyerWithOrdersAndFillableAmounts(
        web3Provider,
        orderProvider,
        FAKE_ASSET_DATA,
        ordersAndFillableAmounts,
    );
    const liquidityResult = await mockedAssetBuyer.object.getLiquidityForAssetDataAsync(FAKE_ASSET_DATA);
    expect(liquidityResult).to.deep.equal(expectedLiquidityResult);
};

// tslint:disable:custom-no-magic-numbers
describe('AssetBuyer', () => {
    describe('getLiquidityForAssetDataAsync', () => {
        const mockWeb3Provider = TypeMoq.Mock.ofType(Web3ProviderEngine);
        const mockOrderProvider = orderProviderMock();

        beforeEach(() => {
            mockWeb3Provider.reset();
            mockOrderProvider.reset();
        });

        afterEach(() => {
            mockWeb3Provider.verifyAll();
            mockOrderProvider.verifyAll();
        });

        describe('validation', () => {
            it('should ensure assetData is a string', async () => {
                const assetBuyer = AssetBuyer.getAssetBuyerForStandardRelayerAPIUrl(
                    mockWeb3Provider.object,
                    FAKE_SRA_URL,
                );

                expect(assetBuyer.getLiquidityForAssetDataAsync(false as any)).to.be.rejectedWith(
                    'Expected assetData to be of type string, encountered: false',
                );
            });
        });

        it('should return 0s when asset pair not supported', async () => {
            mockAvailableAssetDatas(mockOrderProvider, FAKE_ASSET_DATA, []);

            const assetBuyer = new AssetBuyer(mockWeb3Provider.object, mockOrderProvider.object);
            const liquidityResult = await assetBuyer.getLiquidityForAssetDataAsync(FAKE_ASSET_DATA);
            expect(liquidityResult).to.deep.equal({
                tokensAvailableInUnitAmount: 0,
                ethValueAvailableInWei: 0,
            });
        });

        describe('assetData is supported', () => {
            // orders
            const sellTwoTokensFor1Weth: SignedOrder = orderFactory.createSignedOrderFromPartial({
                makerAssetAmount: baseUnitAmount(2),
                takerAssetAmount: baseUnitAmount(1, WETH_DECIMALS),
            });
            const sellTenTokensFor10Weth: SignedOrder = orderFactory.createSignedOrderFromPartial({
                makerAssetAmount: baseUnitAmount(10),
                takerAssetAmount: baseUnitAmount(10, WETH_DECIMALS),
            });

            beforeEach(() => {
                mockAvailableAssetDatas(mockOrderProvider, FAKE_ASSET_DATA, [FAKE_ASSET_DATA]);
            });

            it('should return 0s when no orders available', async () => {
                const ordersAndFillableAmounts: OrdersAndFillableAmounts = {
                    orders: [],
                    remainingFillableMakerAssetAmounts: [],
                };
                const mockedAssetBuyer = mockedAssetBuyerWithOrdersAndFillableAmounts(
                    mockWeb3Provider.object,
                    mockOrderProvider.object,
                    FAKE_ASSET_DATA,
                    ordersAndFillableAmounts,
                );

                const liquidityResult = await mockedAssetBuyer.object.getLiquidityForAssetDataAsync(FAKE_ASSET_DATA);
                expect(liquidityResult).to.deep.equal({
                    tokensAvailableInUnitAmount: 0,
                    ethValueAvailableInWei: 0,
                });
            });

            it('should return correct computed value when orders provided with full fillableAmounts', async () => {
                const orders: SignedOrder[] = [sellTwoTokensFor1Weth, sellTenTokensFor10Weth];
                const remainingFillableMakerAssetAmounts: BigNumber[] = orders.map(o => o.makerAssetAmount);
                const mockedAssetBuyer = mockedAssetBuyerWithOrdersAndFillableAmounts(
                    mockWeb3Provider.object,
                    mockOrderProvider.object,
                    FAKE_ASSET_DATA,
                    {
                        orders,
                        remainingFillableMakerAssetAmounts,
                    },
                );

                const expectedTokensAvailable = orders[0].makerAssetAmount.plus(orders[1].makerAssetAmount);
                const expectedEthValueAvailable = orders[0].takerAssetAmount.plus(orders[1].takerAssetAmount);

                const liquidityResult = await mockedAssetBuyer.object.getLiquidityForAssetDataAsync(FAKE_ASSET_DATA);
                expect(liquidityResult).to.deep.equal({
                    tokensAvailableInUnitAmount: expectedTokensAvailable.toNumber(),
                    ethValueAvailableInWei: expectedEthValueAvailable.toNumber(),
                });
            });

            it('should return correct computed value with one partial fillableAmounts', async () => {
                const ordersAndFillableAmounts = {
                    orders: [sellTwoTokensFor1Weth],
                    remainingFillableMakerAssetAmounts: [baseUnitAmount(1)],
                };
                const expectedResult = {
                    tokensAvailableInUnitAmount: baseUnitAmount(1).toNumber(),
                    ethValueAvailableInWei: baseUnitAmount(0.5, WETH_DECIMALS).toNumber(),
                };

                await expectLiquidityResult(
                    mockWeb3Provider.object,
                    mockOrderProvider.object,
                    ordersAndFillableAmounts,
                    expectedResult,
                );
            });

            it('should return correct computed value with multiple orders and fillable amounts', async () => {
                const ordersAndFillableAmounts = {
                    orders: [sellTwoTokensFor1Weth, sellTenTokensFor10Weth],
                    remainingFillableMakerAssetAmounts: [baseUnitAmount(1), baseUnitAmount(3)],
                };
                const expectedResult = {
                    tokensAvailableInUnitAmount: baseUnitAmount(4).toNumber(),
                    ethValueAvailableInWei: baseUnitAmount(3.5, WETH_DECIMALS).toNumber(),
                };

                await expectLiquidityResult(
                    mockWeb3Provider.object,
                    mockOrderProvider.object,
                    ordersAndFillableAmounts,
                    expectedResult,
                );
            });

            it('should return 0s when no amounts fillable', async () => {
                const ordersAndFillableAmounts = {
                    orders: [sellTwoTokensFor1Weth, sellTenTokensFor10Weth],
                    remainingFillableMakerAssetAmounts: [baseUnitAmount(0), baseUnitAmount(0)],
                };
                const expectedResult = {
                    tokensAvailableInUnitAmount: baseUnitAmount(0).toNumber(),
                    ethValueAvailableInWei: baseUnitAmount(0, WETH_DECIMALS).toNumber(),
                };

                await expectLiquidityResult(
                    mockWeb3Provider.object,
                    mockOrderProvider.object,
                    ordersAndFillableAmounts,
                    expectedResult,
                );
            });
        });
    });
});
