import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

/**
 * @title NetValueCalculator
 * @dev 链下净值计算器，用于批量计算杠杆币净值并生成Merkle证明
 */
export class NetValueCalculator {
    private custodian: any;
    private liquidationEngine: any;
    private keeperPrivateKey: string;
    
    constructor(
        custodianAddress: string,
        liquidationEngineAddress: string,
        keeperPrivateKey: string
    ) {
        this.custodian = await ethers.getContractAt("CustodianFixed", custodianAddress);
        this.liquidationEngine = await ethers.getContractAt("OptimizedLiquidationEngine", liquidationEngineAddress);
        this.keeperPrivateKey = keeperPrivateKey;
    }
    
    /**
     * @dev 计算所有活跃杠杆币的净值
     */
    async calculateBatchNetValues(): Promise<LiquidationBatch> {
        console.log("开始计算批量净值...");
        
        // 1. 获取所有活跃的杠杆币
        const activeTokens = await this.getActiveLeverageTokens();
        console.log(`找到 ${activeTokens.length} 个活跃杠杆币`);
        
        // 2. 并行计算净值
        const calculations = await Promise.all(
            activeTokens.map(token => this.calculateSingleNetValue(token))
        );
        
        // 3. 筛选需要清算的仓位
        const liquidations = calculations.filter(item => 
            item.nav < await this.getLiquidationThreshold()
        );
        
        console.log(`发现 ${liquidations.length} 个需要清算的仓位`);
        
        // 4. 生成Merkle树
        const { merkleRoot, proofs } = this.generateMerkleTree(liquidations);
        
        // 5. 生成Keeper签名
        const signature = await this.signBatch(merkleRoot, liquidations.length);
        
        return {
            tokenIds: liquidations.map(l => l.tokenId),
            users: liquidations.map(l => l.user),
            navValues: liquidations.map(l => l.nav),
            merkleRoot,
            proofs,
            timestamp: Math.floor(Date.now() / 1000),
            signature
        };
    }
    
    /**
     * @dev 获取所有活跃的杠杆币
     */
    private async getActiveLeverageTokens(): Promise<LeverageTokenInfo[]> {
        // TODO: 实现获取所有活跃杠杆币的逻辑
        // 这里需要从链上获取所有有余额的杠杆币
        const activeTokens: LeverageTokenInfo[] = [];
        
        // 示例实现 - 实际需要根据项目结构调整
        try {
            // 假设我们可以通过某些方式获取活跃的tokenId和用户
            // 这里返回示例数据
            return [
                { user: "0x123...", tokenId: 1 },
                { user: "0x456...", tokenId: 2 },
                // ... 更多数据
            ];
        } catch (error) {
            console.error("获取活跃杠杆币失败:", error);
            return [];
        }
    }
    
    /**
     * @dev 计算单个杠杆币的净值
     */
    private async calculateSingleNetValue(tokenInfo: LeverageTokenInfo): Promise<LiquidationCalculation> {
        try {
            const nav = await this.custodian.getSingleLeverageTokenNavV2(
                tokenInfo.user,
                tokenInfo.tokenId
            );
            
            return {
                user: tokenInfo.user,
                tokenId: tokenInfo.tokenId,
                nav: nav.netNavInWei // 使用除息净值
            };
        } catch (error) {
            console.error(`计算净值失败 - 用户: ${tokenInfo.user}, TokenID: ${tokenInfo.tokenId}`, error);
            return {
                user: tokenInfo.user,
                tokenId: tokenInfo.tokenId,
                nav: ethers.MaxUint256 // 返回最大值表示计算失败
            };
        }
    }
    
    /**
     * @dev 生成Merkle树和证明
     */
    private generateMerkleTree(liquidations: LiquidationCalculation[]): { merkleRoot: string, proofs: any } {
        const leaves = liquidations.map(liquidation => 
            keccak256(ethers.solidityPacked(
                ["address", "uint256", "uint256"],
                [liquidation.user, liquidation.tokenId, liquidation.nav]
            ))
        );
        
        const tree = new MerkleTree(leaves, keccak256, { sort: true });
        const merkleRoot = tree.getHexRoot();
        
        // 为每个叶子生成证明
        const proofs: any = {};
        liquidations.forEach((liquidation, index) => {
            const leaf = leaves[index];
            const proof = tree.getHexProof(leaf);
            proofs[`${liquidation.user}-${liquidation.tokenId}`] = proof;
        });
        
        return { merkleRoot, proofs };
    }
    
    /**
     * @dev 生成批次签名
     */
    private async signBatch(merkleRoot: string, totalPositions: number): Promise<string> {
        const messageHash = ethers.keccak256(
            ethers.solidityPacked(
                ["bytes32", "uint256", "uint256", "address"],
                [merkleRoot, totalPositions, await this.getChainId(), this.liquidationEngine.address]
            )
        );
        
        const wallet = new ethers.Wallet(this.keeperPrivateKey);
        const signature = await wallet.signMessage(ethers.getBytes(messageHash));
        
        return signature;
    }
    
    /**
     * @dev 获取清算阈值
     */
    private async getLiquidationThreshold(): Promise<bigint> {
        const config = await this.liquidationEngine.config();
        return config.liquidationThreshold;
    }
    
    /**
     * @dev 获取当前链ID
     */
    private async getChainId(): Promise<number> {
        return (await ethers.provider.getNetwork()).chainId;
    }
    
    /**
     * @dev 提交批量清算到链上
     */
    async submitLiquidationBatch(batch: LiquidationBatch): Promise<number> {
        try {
            const tx = await this.liquidationEngine.submitLiquidationBatch(
                batch.merkleRoot,
                batch.tokenIds.length,
                batch.signature
            );
            
            const receipt = await tx.wait();
            console.log(`批量清算提交成功，交易哈希: ${receipt.hash}`);
            
            // 从事件中获取batchId
            const event = receipt.logs.find((log: any) => 
                log.fragment?.name === "BatchLiquidationCreated"
            );
            
            if (event) {
                const batchId = event.args.batchId;
                console.log(`批次ID: ${batchId}`);
                return batchId;
            }
            
            throw new Error("未找到BatchLiquidationCreated事件");
        } catch (error) {
            console.error("提交批量清算失败:", error);
            throw error;
        }
    }
    
    /**
     * @dev 执行批量清算中的单个仓位
     */
    async executeSingleLiquidation(
        batchId: number,
        user: string,
        tokenId: number,
        nav: bigint,
        proof: string[]
    ): Promise<boolean> {
        try {
            const tx = await this.liquidationEngine.executeBatchLiquidation(
                batchId,
                user,
                tokenId,
                nav,
                proof
            );
            
            await tx.wait();
            console.log(`清算执行成功 - 用户: ${user}, TokenID: ${tokenId}`);
            return true;
        } catch (error) {
            console.error(`清算执行失败 - 用户: ${user}, TokenID: ${tokenId}`, error);
            return false;
        }
    }
}

// ================= 类型定义 =================

interface LeverageTokenInfo {
    user: string;
    tokenId: number;
}

interface LiquidationCalculation {
    user: string;
    tokenId: number;
    nav: bigint;
}

interface LiquidationBatch {
    tokenIds: number[];
    users: string[];
    navValues: bigint[];
    merkleRoot: string;
    proofs: any;
    timestamp: number;
    signature: string;
}

// ================= 使用示例 =================

/**
 * @dev 使用示例
 */
async function main() {
    // 配置参数
    const CUSTODIAN_ADDRESS = "0x...";
    const LIQUIDATION_ENGINE_ADDRESS = "0x...";
    const KEEPER_PRIVATE_KEY = "0x...";
    
    // 创建计算器实例
    const calculator = new NetValueCalculator(
        CUSTODIAN_ADDRESS,
        LIQUIDATION_ENGINE_ADDRESS,
        KEEPER_PRIVATE_KEY
    );
    
    try {
        // 1. 计算批量净值
        console.log("开始批量净值计算...");
        const batch = await calculator.calculateBatchNetValues();
        
        // 2. 提交到链上
        console.log("提交批量清算到链上...");
        const batchId = await calculator.submitLiquidationBatch(batch);
        
        // 3. 执行清算
        console.log("开始执行清算...");
        let successCount = 0;
        
        for (let i = 0; i < batch.tokenIds.length; i++) {
            const user = batch.users[i];
            const tokenId = batch.tokenIds[i];
            const nav = batch.navValues[i];
            const proof = batch.proofs[`${user}-${tokenId}`];
            
            const success = await calculator.executeSingleLiquidation(
                batchId,
                user,
                tokenId,
                nav,
                proof
            );
            
            if (success) {
                successCount++;
            }
            
            // 添加延迟避免Gas过高
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`清算执行完成，成功: ${successCount}/${batch.tokenIds.length}`);
        
    } catch (error) {
        console.error("批量清算流程失败:", error);
    }
}

// 如果直接运行此文件
if (require.main === module) {
    main().catch(console.error);
}

export default NetValueCalculator;
