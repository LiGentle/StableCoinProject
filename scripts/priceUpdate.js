// priceUpdater.js - 价格更新服务
const Web3 = require('web3');
const axios = require('axios');
const cron = require('node-cron');

class LTCPriceUpdater {
    constructor(config) {
        this.web3 = new Web3(config.rpcUrl);
        this.contract = new this.web3.eth.Contract(config.contractABI, config.contractAddress);
        this.account = this.web3.eth.accounts.privateKeyToAccount(config.privateKey);
        this.web3.eth.accounts.wallet.add(this.account);
        
        this.apiSources = config.apiSources || [
            {
                name: 'CoinGecko',
                url: 'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd',
                parser: (data) => data.litecoin.usd
            },
            {
                name: 'Binance',
                url: 'https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT',
                parser: (data) => parseFloat(data.price)
            },
            {
                name: 'CoinMarketCap',
                url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=LTC',
                headers: { 'X-CMC_PRO_API_KEY': config.cmcApiKey },
                parser: (data) => data.data.LTC.quote.USD.price
            }
        ];
    }
    
    // 🎯 从多个源获取LTC价格
    async fetchLTCPrice() {
        const prices = [];
        
        for (const source of this.apiSources) {
            try {
                console.log(`Fetching price from ${source.name}...`);
                
                const response = await axios.get(source.url, {
                    headers: source.headers || {},
                    timeout: 10000
                });
                
                const price = source.parser(response.data);
                
                if (price && price > 0) {
                    prices.push({
                        source: source.name,
                        price: price,
                        timestamp: Date.now()
                    });
                    console.log(`${source.name}: $${price}`);
                }
                
            } catch (error) {
                console.error(`Error fetching from ${source.name}:`, error.message);
            }
        }
        
        if (prices.length === 0) {
            throw new Error('No valid price data available');
        }
        
        // 计算加权平均价格（简单平均）
        const avgPrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
        
        return {
            price: avgPrice,
            sources: prices,
            timestamp: Math.floor(Date.now() / 1000)
        };
    }
    
    // 🔄 更新合约价格
    async updateContractPrice() {
        try {
            const priceData = await this.fetchLTCPrice();
            
            console.log(`Average LTC Price: $${priceData.price.toFixed(8)}`);
            console.log(`Sources used: ${priceData.sources.map(s => s.source).join(', ')}`);
            
            // 转换为8位精度的整数
            const priceInWei = Math.floor(priceData.price * 1e8);
            
            // 调用合约更新价格
            const tx = await this.contract.methods
                .updatePriceFromExternal(
                    priceInWei,
                    priceData.timestamp,
                    `Avg:${priceData.sources.map(s => s.source).join(',')}`
                )
                .send({
                    from: this.account.address,
                    gas: 200000,
                    gasPrice: await this.web3.eth.getGasPrice()
                });
            
            console.log(`✅ Price updated successfully!`);
            console.log(`Transaction hash: ${tx.transactionHash}`);
            console.log(`Block number: ${tx.blockNumber}`);
            
            return {
                success: true,
                price: priceData.price,
                txHash: tx.transactionHash
            };
            
        } catch (error) {
            console.error('❌ Failed to update price:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 📊 获取合约当前价格
    async getCurrentContractPrice() {
        try {
            const result = await this.contract.methods.latestRoundData().call();
            
            return {
                price: parseFloat(result.answer) / 1e8,
                timestamp: new Date(result.updatedAt * 1000),
                roundId: result.roundId,
                isValid: result.answer > 0
            };
            
        } catch (error) {
            console.error('Error getting contract price:', error.message);
            return null;
        }
    }
    
    // ⏰ 启动定时更新服务
    startScheduledUpdates() {
        console.log('🚀 Starting LTC price update service...');
        
        // 每5分钟更新一次价格
        cron.schedule('*/5 * * * *', async () => {
            console.log('\n📈 Scheduled price update started...');
            await this.updateContractPrice();
        });
        
        // 每小时显示状态
        cron.schedule('0 * * * *', async () => {
            const contractPrice = await this.getCurrentContractPrice();
            if (contractPrice) {
                console.log(`\n📊 Current contract price: $${contractPrice.price}`);
                console.log(`Last updated: ${contractPrice.timestamp}`);
            }
        });
        
        console.log('✅ Scheduled tasks started!');
        console.log('- Price updates: Every 5 minutes');
        console.log('- Status reports: Every hour');
    }
    
    // 🧪 测试价格获取
    async testPriceFetching() {
        console.log('🧪 Testing price fetching...');
        
        try {
            const priceData = await this.fetchLTCPrice();
            console.log('✅ Price fetching test successful:');
            console.log(`Average price: $${priceData.price.toFixed(8)}`);
            console.log(`Sources: ${priceData.sources.length}`);
            
            for (const source of priceData.sources) {
                console.log(`  - ${source.source}: $${source.price.toFixed(8)}`);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Price fetching test failed:', error.message);
            return false;
        }
    }
}

// 使用示例
const config = {
    rpcUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
    contractAddress: '0x...', // 部署的合约地址
    contractABI: [...], // 合约ABI
    privateKey: '0x...', // 更新者私钥
    cmcApiKey: 'YOUR_CMC_API_KEY' // CoinMarketCap API密钥（可选）
};

const priceUpdater = new LTCPriceUpdater(config);

// 主程序
async function main() {
    // 测试价格获取
    const testResult = await priceUpdater.testPriceFetching();
    if (!testResult) {
        console.error('Price fetching test failed, exiting...');
        process.exit(1);
    }
    
    // 立即更新一次价格
    await priceUpdater.updateContractPrice();
    
    // 启动定时更新服务
    priceUpdater.startScheduledUpdates();
    
    console.log('\n🎉 LTC Price Oracle is running!');
    console.log('Press Ctrl+C to stop the service.');
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down LTC Price Oracle...');
    process.exit(0);
});

// 运行服务
if (require.main === module) {
    main().catch(console.error);
}

module.exports = LTCPriceUpdater;