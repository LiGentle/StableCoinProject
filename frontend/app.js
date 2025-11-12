// =========================
// 稳定币清算系统前端逻辑
// 完整重写 - 解决所有遗留问题
// =========================

const mockData = {
    // =========系统状态=========
    liquidationEnabled: true,
    activeAuctions: 2,
    circuitBreaker: 0,

    // =========清算参数配置=========
    liquidationParams: {
        adjustmentThreshold: "500000000000000000", // 0.5
        liquidationThreshold: "300000000000000000", // 0.3
        penalty: "30000000000000000" // 0.03
    },

    // =========拍卖参数配置=========
    auctionParams: {
        priceMultiplier: "1100000000000000000", // 1.1
        resetTime: 3600,
        priceDropThreshold: "500000000000000000", // 0.5
        percentageReward: "10000000000000000", // 0.01
        fixedReward: "100000000000000000", // 0.1
        minAuctionAmount: 0
    },

    // =========合约地址配置(示例数据)=========
    contractAddresses: {
        custodian: "0x742d35Cc6986a8932107D318E1E7b9eF8C0C8", // 托管合约地址示例
        liquidation: "0x9fB5a56Bee864B2BD37a5A2E4Bc0F8C8F2E3D", // 清算合约地址示例
        auction: "0x1234567890abcdef1234567890abcdef123456", // 拍卖合约地址示例
        chainlink: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318", // Chainlink预言机地址示例
        wltcToken: "0x10e57e8F8481E71D8fD6283dCF8b2A4D1b6Cb4", // WLTC代币合约地址示例
        stableToken: "0x70997970C51812dc3A010C7d01b50e0d17dc75" // 稳定币代币合约地址示例
    },

    // =========权限管理示例=========
    roleHolders: {
        // Custodian合约角色持有者
        custodian: {
            admin: [
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // 部署者地址
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  // 管理员地址1
            ],
            liquidation: [
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // 清算调用者地址
                "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"  // Keeper机器人地址
            ],
            auction: [
                "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // 拍卖管理地址
                "0x90F79bf6EB2c4f870365E785982E1f101E93b906"  // 拍卖监控地址
            ]
        },
        // Liquidation合约角色持有者
        liquidation: {
            admin: [
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // 部署者地址
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  // 清算管理员
            ],
            custodian: [
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // 托管合约地址
                "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" // 清算证书持有者
            ],
            auction: [
                "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // 拍卖调用者
                "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" // 自动拍卖器
            ]
        },
        // Auction合约角色持有者
        auction: {
            admin: [
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // 高级管理员
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  // 拍卖管理员
            ],
            caller: [
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // 清算调用者
                "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Keeper调用者
                "0x976EA74026E726554dB657fA54763abd0C3a0aa9"  // 自动购买者
            ]
        }
    },

    // =========用户持仓数据=========
    userPositions: [
        // =====安全级别token(净值 > 0.5)=====
        {
            tokenId: 1,
            balance: "1000000000000000000", // 1e18
            leverage: "CONSERVATIVE",
            mintPrice: "50000000000000000000", // 50
            exDivNetValue: "1.2", // 除息净值
            riskLevel: 0, // 安全
            accruedInterest: "100000000000000000", // 0.1
            isFrozen: false,
            owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
        },
        {
            tokenId: 2,
            balance: "800000000000000000", // 0.8e18
            leverage: "MODERATE",
            mintPrice: "55000000000000000000", // 55
            exDivNetValue: "0.9", // 除息净值
            riskLevel: 0, // 安全
            accruedInterest: "80000000000000000", // 0.08
            isFrozen: false,
            owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        },
        // =====风险级别token(0.5 ≥ 净值 ≥ 0.3)=====
        {
            tokenId: 3,
            balance: "600000000000000000", // 0.6e18
            leverage: "MODERATE",
            mintPrice: "60000000000000000000", // 60
            exDivNetValue: "0.45", // 净值区间(-0.5,-0.4] → 级别1
            riskLevel: 1, // 低风险
            accruedInterest: "60000000000000000", // 0.06
            isFrozen: false,
            owner: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
        },
        {
            tokenId: 4,
            balance: "400000000000000000", // 0.4e18
            leverage: "AGGRESSIVE",
            mintPrice: "70000000000000000000", // 70
            exDivNetValue: "0.38", // 净值区间(-0.4,-0.3] → 级别2
            riskLevel: 2, // 中风险
            accruedInterest: "40000000000000000", // 0.04
            isFrozen: false,
            owner: "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
        },
        {
            tokenId: 5,
            balance: "300000000000000000", // 0.3e18
            leverage: "AGGRESSIVE",
            mintPrice: "80000000000000000000", // 80
            exDivNetValue: "0.32", // 净值区间(-0.3,-0.2] → 级别3
            riskLevel: 3, // 高风险
            accruedInterest: "30000000000000000", // 0.03
            isFrozen: false,
            owner: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
        },
        // =====极高风险&清算中token(净值 < 0.3)=====
        {
            tokenId: 6,
            balance: "200000000000000000", // 0.2e18
            leverage: "ULTRA_AGGRESSIVE",
            mintPrice: "90000000000000000000", // 90
            exDivNetValue: "0.18", // 净值 ≤0.3 → 极高风险+强制清算
            riskLevel: 4, // 极高风险
            accruedInterest: "20000000000000000", // 0.02
            isFrozen: true, // 已冻结 - Keeper已发起拍卖
            owner: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
        },
        {
            tokenId: 7,
            balance: "150000000000000000", // 0.15e18
            leverage: "ULTRA_AGGRESSIVE",
            mintPrice: "95000000000000000000", // 95
            exDivNetValue: "0.12", // 净值 ≤0.3 → 极高风险+强制清算
            riskLevel: 4, // 极高风险
            accruedInterest: "15000000000000000", // 0.015
            isFrozen: true, // 已冻结 - Keeper已发起拍卖
            owner: "0x976EA74026E726554dB657fA54763abd0C3a0aa9"
        },
        {
            tokenId: 8,
            balance: "100000000000000000", // 0.1e18
            leverage: "ULTRA_AGGRESSIVE",
            mintPrice: "100000000000000000000", // 100
            exDivNetValue: "0.08", // 净值 ≤0.3 → 极高风险+强制清算
            riskLevel: 4, // 极高风险
            accruedInterest: "10000000000000000", // 0.01
            isFrozen: true, // 已冻结 - Keeper已发起拍卖
            owner: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"
        },
        {
            tokenId: 9,
            balance: "50000000000000000", // 0.05e18
            leverage: "ULTRA_AGGRESSIVE",
            mintPrice: "105000000000000000000", // 105
            exDivNetValue: "0.05", // 净值 ≤0.3 → 极高风险但未冻结
            riskLevel: 4, // 极高风险
            accruedInterest: "5000000000000000", // 0.005
            isFrozen: false, // 未冻结 - Keeper尚未处理
            owner: "0x23618e81E3f5cdF7f54C3d65f7FBc0Abd5B6ce"
        }
    ],

    // =========活跃拍卖数据(与清算查看同步)=========
    activeAuctionsList: [
        {
            auctionId: 1,
            tokenId: 6,
            underlyingAmount: "200000000000000000", // 0.2e18
            currentPrice: "36000000000000000000", // 36
            totalPayment: "740000000000000000", // 0.74 - 与清算查看同步
            originalOwner: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
            startTime: Math.floor(Date.now() / 1000) - 1800, // 30分钟前
            status: "正常" // 正常进行中拍卖
        },
        {
            auctionId: 2,
            tokenId: 7,
            underlyingAmount: "150000000000000000", // 0.15e18
            currentPrice: "15000000000000000000", // 15
            totalPayment: "2000000000000000000", // 2.0 - 与清算查看同步
            originalOwner: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
            startTime: Math.floor(Date.now() / 1000) - 7200, // 2小时前
            status: "需要重置" // 需要重置价格的拍卖
        }
        // 注意: 拍卖ID 3 已从活跃拍卖中移除(对应Token 8已在清算查看中显示"拍卖结束")
    ],

    // =========已清算token数据=========
    liquidatedTokens: [
        {
            tokenId: 6,
            auctionId: 1,
            remainingLtc: "100000000000000000", // 0.1
            soldStable: "740000000000000000", // 0.74
            auctionStatus: "正在拍卖", // '正在拍卖' | '需重置拍卖' | '拍卖结束'
            withdrawableAmount: "740000000000000000", // 0.74
            lastActivity: Math.floor(Date.now() / 1000) - 900 // 15分钟前
        },
        {
            tokenId: 7,
            auctionId: 2,
            remainingLtc: "0", // 0
            soldStable: "2000000000000000000", // 2.0
            auctionStatus: "需重置拍卖", // '正在拍卖' | '需重置拍卖' | '拍卖结束'
            withdrawableAmount: "2000000000000000000", // 2.0
            lastActivity: Math.floor(Date.now() / 1000) - 3600 // 1小时前
        },
        {
            tokenId: 8,
            auctionId: 3, // 注意: 虽然拍卖ID 3已从活跃拍卖中移除，但仍保留在此记录
            remainingLtc: "50000000000050000", // 0.05
            soldStable: "1500000000000000000", // 1.5
            auctionStatus: "拍卖结束", // '正在拍卖' | '需重置拍卖' | '拍卖结束'
            withdrawableAmount: "1500000000000000000", // 1.5
            lastActivity: Math.floor(Date.now() / 1000) - 86400 // 1天前
        }
    ]
};

// =========工具函数=========
function formatWeiToEther(weiValue) {
    return (parseFloat(weiValue) / 1e18).toFixed(4);
}

function formatAddress(address) {
    if (!address || address.length < 10) return address;
    return address.substring(0, 6) + '...' + address.substring(address.length - 4);
}

// 显示通知消息
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// =========权限管理函数=========
function loadRoleHolders() {
    const getRoleDisplayText = (addresses) => {
        if (!addresses || addresses.length === 0) return '无';
        return addresses.map(addr => `${formatAddress(addr)}`).join('<br>');
    };

    // Custodian角色持有者显示
    document.getElementById('cust-admin-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.custodian.admin);
    document.getElementById('cust-liquidation-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.custodian.liquidation);
    document.getElementById('cust-auction-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.custodian.auction);

    // Liquidation角色持有者显示
    document.getElementById('liq-admin-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.liquidation.admin);
    document.getElementById('liq-custodian-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.liquidation.custodian);
    document.getElementById('liq-auction-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.liquidation.auction);

    // Auction角色持有者显示
    document.getElementById('auc-admin-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.auction.admin);
    document.getElementById('auc-caller-holders').innerHTML = getRoleDisplayText(mockData.roleHolders.auction.caller);
}

// =========面板切换和初始化=========
document.addEventListener('DOMContentLoaded', function() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');

    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            const target = this.getAttribute('data-target');
            navButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            panels.forEach(panel => panel.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            loadPanelData(target);
        });
    });

    loadPanelData('admin'); // 初始化加载管理员面板
});

// 加载对应面板数据
function loadPanelData(panelId) {
    switch(panelId) {
        case 'admin': loadAdminData(); break;
        case 'user': loadUserData(); break;
        case 'keeper': loadKeeperData(); break;
    }
}

// =========管理员面板功能=========
function loadAdminData() {
    // 系统状态显示
    document.getElementById('liquidationStatus').textContent = mockData.liquidationEnabled ? '已开启' : '已关闭';
    document.getElementById('activeAuctions').textContent = mockData.activeAuctions;
    document.getElementById('circuitBreaker').textContent = mockData.circuitBreaker;
    document.getElementById('circuitBreakerStatus').textContent = mockData.circuitBreaker;

    // 参数配置
    loadLiquidationParams();
    loadAuctionParams();
    getAccumulatedData();

    // 合约地址和权限管理
    loadContractAddresses();
    loadRoleHolders();
}

// 加载参数配置
function loadLiquidationParams() {
    document.getElementById('currentAdjustmentThreshold').textContent = formatWeiToEther(mockData.liquidationParams.adjustmentThreshold);
    document.getElementById('currentLiquidationThreshold').textContent = formatWeiToEther(mockData.liquidationParams.liquidationThreshold);
    document.getElementById('currentPenalty').textContent = formatWeiToEther(mockData.liquidationParams.penalty);
    document.getElementById('liquidationEnabled').textContent = mockData.liquidationEnabled ? '已启用' : '已禁用';
    document.getElementById('liquidationEnabled').className = mockData.liquidationEnabled ? 'status-enabled' : 'status-disabled';
}

function loadAuctionParams() {
    document.getElementById('currentPriceMultiplier').textContent = formatWeiToEther(mockData.auctionParams.priceMultiplier);
    document.getElementById('currentResetTime').textContent = mockData.auctionParams.resetTime + ' 秒';
    document.getElementById('currentPriceDropThreshold').textContent = formatWeiToEther(mockData.auctionParams.priceDropThreshold);
    document.getElementById('currentPercentageReward').textContent = formatWeiToEther(mockData.auctionParams.percentageReward);
    document.getElementById('currentFixedReward').textContent = formatWeiToEther(mockData.auctionParams.fixedReward);
    document.getElementById('currentCircuitBreaker').textContent = mockData.circuitBreaker;
    document.getElementById('currentMinAuctionAmount').textContent = formatWeiToEther(mockData.auctionParams.minAuctionAmount);
}

function loadContractAddresses() {
    document.getElementById('currentCustodianAddress').textContent = mockData.contractAddresses.custodian || '未设置';
    document.getElementById('currentLiquidationAddress').textContent = mockData.contractAddresses.liquidation || '未设置';
    document.getElementById('currentAuctionAddress').textContent = mockData.contractAddresses.auction || '未设置';
}

// =========权限管理操作=========
function grantCustodianAdminRole() {
    const address = document.getElementById('custodianGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.custodian.admin.includes(address)) {
        mockData.roleHolders.custodian.admin.push(address);
        loadRoleHolders();
        showNotification(`已授予Custodian ADMIN角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeCustodianAdminRole() {
    const holders = mockData.roleHolders.custodian.admin;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Custodian ADMIN角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantCustodianLiquidationRole() {
    const address = document.getElementById('custodianGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.custodian.liquidation.includes(address)) {
        mockData.roleHolders.custodian.liquidation.push(address);
        loadRoleHolders();
        showNotification(`已授予Custodian LIQUIDATION角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeCustodianLiquidationRole() {
    const holders = mockData.roleHolders.custodian.liquidation;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Custodian LIQUIDATION角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantCustodianAuctionRole() {
    const address = document.getElementById('custodianGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.custodian.auction.includes(address)) {
        mockData.roleHolders.custodian.auction.push(address);
        loadRoleHolders();
        showNotification(`已授予Custodian AUCTION角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeCustodianAuctionRole() {
    const holders = mockData.roleHolders.custodian.auction;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Custodian AUCTION角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantLiquidationAdminRole() {
    const address = document.getElementById('liquidationGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.liquidation.admin.includes(address)) {
        mockData.roleHolders.liquidation.admin.push(address);
        loadRoleHolders();
        showNotification(`已授予Liquidation ADMIN角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeLiquidationAdminRole() {
    const holders = mockData.roleHolders.liquidation.admin;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Liquidation ADMIN角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantLiquidationCustodianRole() {
    const address = document.getElementById('liquidationGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.liquidation.custodian.includes(address)) {
        mockData.roleHolders.liquidation.custodian.push(address);
        loadRoleHolders();
        showNotification(`已授予Liquidation CUSTODIAN角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeLiquidationCustodianRole() {
    const holders = mockData.roleHolders.liquidation.custodian;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Liquidation CUSTODIAN角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantLiquidationAuctionRole() {
    const address = document.getElementById('liquidationGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.liquidation.auction.includes(address)) {
        mockData.roleHolders.liquidation.auction.push(address);
        loadRoleHolders();
        showNotification(`已授予Liquidation AUCTION角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeLiquidationAuctionRole() {
    const holders = mockData.roleHolders.liquidation.auction;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Liquidation AUCTION角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantAuctionAdminRole() {
    const address = document.getElementById('auctionGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.auction.admin.includes(address)) {
        mockData.roleHolders.auction.admin.push(address);
        loadRoleHolders();
        showNotification(`已授予Auction ADMIN角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeAuctionAdminRole() {
    const holders = mockData.roleHolders.auction.admin;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Auction ADMIN角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

function grantAuctionCallerRole() {
    const address = document.getElementById('auctionGrantAddress').value || '0x' + Math.random().toString(16).substr(2, 40);
    if (!mockData.roleHolders.auction.caller.includes(address)) {
        mockData.roleHolders.auction.caller.push(address);
        loadRoleHolders();
        showNotification(`已授予Auction CALLER角色给 ${formatAddress(address)}`);
    } else {
        showNotification('地址已拥有该角色', 'warning');
    }
}

function revokeAuctionCallerRole() {
    const holders = mockData.roleHolders.auction.caller;
    if (holders.length > 0) {
        const removed = holders.pop();
        loadRoleHolders();
        showNotification(`已撤销Auction CALLER角色: ${formatAddress(removed)}`);
    } else {
        showNotification('无角色可撤销', 'warning');
    }
}

// =========参数设置和配置=========
function setAdjustmentThreshold() {
    const value = document.getElementById('adjustmentThreshold').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.liquidationParams.adjustmentThreshold = (parseFloat(value) * 1e18).toString();
        loadLiquidationParams();
        showNotification(`下折阈值已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setLiquidationThreshold() {
    const value = document.getElementById('liquidationThreshold').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.liquidationParams.liquidationThreshold = (parseFloat(value) * 1e18).toString();
        loadLiquidationParams();
        showNotification(`清算阈值已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setPenalty() {
    const value = document.getElementById('penalty').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.liquidationParams.penalty = (parseFloat(value) * 1e18).toString();
        loadLiquidationParams();
        showNotification(`惩罚金已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function toggleLiquidation(enabled) {
    mockData.liquidationEnabled = enabled;
    loadLiquidationParams();
    loadAdminData();
    showNotification(`清算功能已${enabled ? '启用' : '禁用'}`);
}

function setPriceMultiplier() {
    const value = document.getElementById('priceMultiplier').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.auctionParams.priceMultiplier = (parseFloat(value) * 1e18).toString();
        loadAuctionParams();
        showNotification(`价格乘数已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setResetTime() {
    const value = document.getElementById('resetTime').value;
    if (value && !isNaN(parseInt(value))) {
        mockData.auctionParams.resetTime = parseInt(value);
        loadAuctionParams();
        showNotification(`重置时间已设置为 ${value}秒`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setPriceDropThreshold() {
    const value = document.getElementById('priceDropThreshold').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.auctionParams.priceDropThreshold = (parseFloat(value) * 1e18).toString();
        loadAuctionParams();
        showNotification(`价格下降阈值已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setPercentageReward() {
    const value = document.getElementById('percentageReward').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.auctionParams.percentageReward = (parseFloat(value) * 1e18).toString();
        loadAuctionParams();
        showNotification(`百分比奖励已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setFixedReward() {
    const value = document.getElementById('fixedReward').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.auctionParams.fixedReward = (parseFloat(value) * 1e18).toString();
        loadAuctionParams();
        showNotification(`固定奖励已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setMinAuctionAmount() {
    const value = document.getElementById('minAuctionAmount').value;
    if (value && !isNaN(parseFloat(value))) {
        mockData.auctionParams.minAuctionAmount = (parseFloat(value) * 1e18).toString();
        loadAuctionParams();
        showNotification(`最小可购买量已设置为 ${value}`);
    } else {
        showNotification('请输入有效的数字', 'error');
    }
}

function setCircuitBreaker() {
    const value = document.getElementById('circuitBreaker').value;
    if (value !== undefined && value !== null && !isNaN(parseInt(value))) {
        const level = parseInt(value);
        if (level >= 0 && level <= 3) {
            mockData.circuitBreaker = level;
            loadAuctionParams();
            loadAdminData();
            showNotification(`断路器级别已设置为 ${level}`);
        } else {
            showNotification('断路器级别必须在 0-3 之间', 'error');
        }
    } else {
        showNotification('请选择断路器级别', 'error');
    }
}

function getAccumulatedData() {
    document.getElementById('accumulatedReward').textContent = formatWeiToEther("500000000000000000");
    document.getElementById('accumulatedPenalty').textContent = formatWeiToEther("30000000000000000");
    showNotification('已刷新会计数据');
}

function resetAccounting() {
    document.getElementById('accumulatedReward').textContent = '0.0000';
    document.getElementById('accumulatedPenalty').textContent = '0.0000';
    showNotification('会计数据已重置');
}

// =========地址配置=========
function setCustodianAddress() {
    const address = document.getElementById('custodianAddress').value;
    if (address && address.startsWith('0x') && address.length === 42) {
        mockData.contractAddresses.custodian = address;
        loadContractAddresses();
        showNotification(`Custodian合约地址已设置为 ${formatAddress(address)}`);
    } else {
        showNotification('请输入有效的42位十六进制地址', 'error');
    }
}

function setLiquidationAddress() {
    const address = document.getElementById('liquidationAddress').value;
    if (address && address.startsWith('0x') && address.length === 42) {
        mockData.contractAddresses.liquidation = address;
        loadContractAddresses();
        showNotification(`Liquidation合约地址已设置为 ${formatAddress(address)}`);
    } else {
        showNotification('请输入有效的42位十六进制地址', 'error');
    }
}

function setAuctionAddress() {
    const address = document.getElementById('auctionAddress').value;
    if (address && address.startsWith('0x') && address.length === 42) {
        mockData.contractAddresses.auction = address;
        loadContractAddresses();
        showNotification(`Auction合约地址已设置为 ${formatAddress(address)}`);
    } else {
        showNotification('请输入有效的42位十六进制地址', 'error');
    }
}

// =========用户面板功能=========
function loadUserData() {
    loadUserPositions();
    populateAdjustTokenSelect();
    populateWithdrawTokenSelect();
    viewLiquidations();
}

// 用户持仓显示
function loadUserPositions() {
    const container = document.getElementById('userPositions');
    container.innerHTML = '';

    mockData.userPositions.forEach(position => {
        const positionElement = document.createElement('div');
        positionElement.className = `position-item risk-level-${position.riskLevel}${position.isFrozen ? ' frozen-status' : ''}`;

        positionElement.innerHTML = `
            <div class="position-header">
                <span>Token ID: ${position.tokenId}</span>
                <span class="risk-status">${getRiskLevelText(position.riskLevel, position.isFrozen)}</span>
            </div>
            <div class="position-details">
                <div>余额: ${formatWeiToEther(position.balance)}</div>
                <div>杠杆: ${position.leverage}</div>
                <div>除息净值: ${position.exDivNetValue}</div>
                <div>累计利息: ${formatWeiToEther(position.accruedInterest)}</div>
                <div>冻结状态: ${position.isFrozen ? '已冻结' : '正常'}</div>
            </div>
        `;

        container.appendChild(positionElement);
    });
}

// 获取风险等级文本
function getRiskLevelText(riskLevel, isFrozen = false) {
    if (riskLevel === 4) {
        // 极高风险级别4：根据冻结状态显示不同文本
        return isFrozen ? '强制清算' : '极高风险';
    }
    const levels = ['安全', '低风险', '中风险', '高风险'];
    return levels[riskLevel] || '未知';
}

// 更新单个Token风险等级
function updateSingleTokenRisk() {
    const tokenId = document.getElementById('singleTokenId').value.trim();
    if (!tokenId || isNaN(tokenId)) {
        showNotification('请输入有效的Token ID', 'error');
        return;
    }

    const token = mockData.userPositions.find(p => p.tokenId == parseInt(tokenId));
    if (!token) {
        showNotification('未找到指定的Token', 'error');
        return;
    }

    if (parseFloat(token.exDivNetValue) <= 0.3) {
        showNotification('净值 ≤0.3 的Token保持极高风险等级', 'warning');
        return;
    }

    const oldLevel = token.riskLevel;
    token.riskLevel = Math.floor(Math.random() * 4);

    loadUserPositions();
    showNotification(`Token ${tokenId} 风险等级: ${oldLevel} → ${token.riskLevel}`);
}

// 更新全部Token风险等级
function updateAllTokenRisks() {
    mockData.userPositions.forEach(position => {
        if (parseFloat(position.exDivNetValue) > 0.3) {
            position.riskLevel = Math.floor(Math.random() * 4);
        }
    });

    loadUserPositions();
    showNotification('全部Token风险等级已更新');
}

// =========清算查看功能=========
function viewLiquidations() {
    const container = document.getElementById('liquidationsList');
    container.innerHTML = '';

    // 核心逻辑：只显示级别4（极高风险）且冻结的token
    const extremeRiskFrozenTokens = mockData.userPositions.filter(position =>
        position.riskLevel === 4 && position.isFrozen
    );

    extremeRiskFrozenTokens.forEach(position => {
        const liquidationInfo = mockData.liquidatedTokens.find(token => token.tokenId === position.tokenId);
        if (!liquidationInfo) return;

        const liquidationElement = document.createElement('div');
        liquidationElement.className = 'liquidation-item';

        const auctionStatusClass = getAuctionStatusClass(liquidationInfo.auctionStatus);

        liquidationElement.innerHTML = `
            <div class="liquidation-header">
                <span>清算令牌: Token ${position.tokenId}</span>
                <span>拍卖ID: ${liquidationInfo.auctionId}</span>
            </div>
            <div class="liquidation-details">
                <div>拍卖状态: <span class="${auctionStatusClass}">${liquidationInfo.auctionStatus}</span></div>
                <div>剩余拍卖LTC数量: ${formatWeiToEther(liquidationInfo.remainingLtc)}</div>
                <div>已卖得稳定币数量: ${formatWeiToEther(liquidationInfo.soldStable)}</div>
            </div>
        `;

        container.appendChild(liquidationElement);
    });
}

function getAuctionStatusClass(status) {
    switch (status) {
        case '正在拍卖':
        case 'ongoing':
            return 'auction-status-on';
        case '需重置拍卖':
        case '需重置拍卖':
            return 'auction-status-reset-needed';
        case '拍卖结束':
        case 'ended':
            return 'auction-status-end';
        default:
            return '';
    }
}

// =========净值调整和提取功能=========
function populateAdjustTokenSelect() {
    const select = document.getElementById('adjustTokenId');
    select.innerHTML = '<option value="">请选择Token</option>';

    // 只显示未冻结的有风险token（极高风险的也可以调整，只要未被冻结）
    mockData.userPositions.forEach(position => {
        if (position.riskLevel > 0 && !position.isFrozen) {
            const option = document.createElement('option');
            option.value = position.tokenId;
            option.textContent = `Token ${position.tokenId} (${getRiskLevelText(position.riskLevel, position.isFrozen)})`;
            select.appendChild(option);
        }
    });

    select.addEventListener('change', function() {
        const tokenId = this.value;
        if (tokenId) {
            const position = mockData.userPositions.find(p => p.tokenId == tokenId);
            if (position) {
                document.getElementById('currentNav').textContent = position.exDivNetValue;
                document.getElementById('currentRiskLevel').textContent = getRiskLevelText(position.riskLevel, position.isFrozen);
                const estimatedAmount = (parseFloat(position.exDivNetValue) * 0.1).toFixed(4);
                document.getElementById('estimatedLtcAmount').textContent = estimatedAmount;
            }
        } else {
            document.getElementById('currentNav').textContent = '-';
            document.getElementById('currentRiskLevel').textContent = '-';
            document.getElementById('estimatedLtcAmount').textContent = '-';
        }
    });
}

function populateWithdrawTokenSelect() {
    const select = document.getElementById('withdrawTokenId');
    select.innerHTML = '<option value="">请选择Token</option>';

    // 只显示"拍卖结束"状态的token
    mockData.liquidatedTokens.forEach(token => {
        if (token.auctionStatus === "拍卖结束") {
            const option = document.createElement('option');
            option.value = token.tokenId;
            option.textContent = `Token ${token.tokenId} (可提取: ${formatWeiToEther(token.withdrawableAmount)})`;
            select.appendChild(option);
        }
    });

    select.addEventListener('change', function() {
        const tokenId = this.value;
        if (tokenId) {
            const token = mockData.liquidatedTokens.find(t => t.tokenId == tokenId);
            if (token) {
                document.getElementById('withdrawableAmount').textContent = formatWeiToEther(token.withdrawableAmount);
            }
        } else {
            document.getElementById('withdrawableAmount').textContent = '0';
        }
    });
}

function adjustNetValue() {
    const tokenId = document.getElementById('adjustTokenId').value;
    const percentage = document.getElementById('adjustPercentage').value;

    if (!tokenId) {
        showNotification('请选择要调整的Token', 'error');
        return;
    }

    if (!percentage || percentage < 1 || percentage > 100) {
        showNotification('请输入有效的调整比例(1-100)', 'error');
        return;
    }

    const position = mockData.userPositions.find(p => p.tokenId == tokenId);
    if (position) {
        const oldNav = parseFloat(position.exDivNetValue);
        const adjustmentPercent = parseFloat(percentage) / 100;
        position.exDivNetValue = (oldNav * (1 + adjustmentPercent)).toFixed(4);

        // 重新计算风险等级
        position.riskLevel = calculateRiskLevel(position.exDivNetValue);

        loadUserPositions();
        populateAdjustTokenSelect();

        showNotification(`Token ${tokenId} 净值调整完成: ${oldNav} → ${position.exDivNetValue}`);
    }
}

function withdrawStable() {
    const tokenId = document.getElementById('withdrawTokenId').value;

    if (!tokenId) {
        showNotification('请选择要提取的Token', 'error');
        return;
    }

    const token = mockData.liquidatedTokens.find(t => t.tokenId == tokenId);
    if (token) {
        showNotification(`已成功提取 ${formatWeiToEther(token.withdrawableAmount)} 稳定币`);
        token.withdrawableAmount = "0"; // 标记为已提取
        populateWithdrawTokenSelect();
    }
}

// 根据净值区间计算风险等级
function calculateRiskLevel(nav) {
    const navFloat = parseFloat(nav);
    if (navFloat > 0.5) {
        return 0; // 安全
    } else if (navFloat > 0.4) {
        return 1; // 低风险
    } else if (navFloat > 0.3) {
        return 2; // 中风险
    } else if (navFloat > 0.2) {
        return 3; // 高风险
    } else {
        return 4; // 极高风险
    }
}

// =========Keeper面板功能=========
function loadKeeperData() {
    loadActiveAuctions();
}

// Keeper风险监控 - 显示用户的所有token
function monitorUserRisk() {
    const userAddress = document.getElementById('monitorUser').value;

    if (!userAddress) {
        showNotification('请输入用户地址', 'error');
        return;
    }

    const container = document.getElementById('monitoringResults');
    container.innerHTML = '';

    // 显示用户的完整token信息（类似用户面板的持仓
    // 显示用户的完整token信息（类似用户面板的持仓显示）
    const userPositions = mockData.userPositions;

    userPositions.forEach(position => {
        const positionElement = document.createElement('div');
        positionElement.className = `position-item risk-level-${position.riskLevel}${position.isFrozen ? ' frozen-status' : ''}`;

        positionElement.innerHTML = `
            <div class="position-header">
                <span>Token ID: ${position.tokenId}</span>
                <span class="risk-status">${getRiskLevelText(position.riskLevel, position.isFrozen)}</span>
            </div>
            <div class="position-details">
                <div>余额: ${formatWeiToEther(position.balance)}</div>
                <div>除息净值: ${position.exDivNetValue}</div>
                <div>冻结状态: ${position.isFrozen ? '已冻结' : '正常'}</div>
                <div>累计利息: ${formatWeiToEther(position.accruedInterest)}</div>
            </div>
        `;

        container.appendChild(positionElement);
    });

    showNotification(`用户 ${formatAddress(userAddress)} 的风险监控完成`);
}

// 修改活跃拍卖列表，显示拍卖状态和相应颜色，重置按钮在需要重置的拍卖上
function loadActiveAuctions() {
    const container = document.getElementById('activeAuctionsList');
    container.innerHTML = '';

    mockData.activeAuctionsList.forEach(auction => {
        const auctionElement = document.createElement('div');
        auctionElement.className = 'auction-item';

        const timeElapsed = Math.floor(Date.now() / 1000) - auction.startTime;
        const hours = Math.floor(timeElapsed / 3600);
        const minutes = Math.floor((timeElapsed % 3600) / 60);

        // 根据拍卖状态设置颜色
        const statusColor = auction.status === "正常" ? "green" : "orange";

        // 如果是"需要重置"状态，显示重置按钮
        const resetButton = auction.status === "需要重置" ?
            `<button onclick="resetAuction(${auction.auctionId})" class="reset-btn">重置拍卖</button>` : '';

        auctionElement.innerHTML = `
            <div class="auction-header" style="border-left: 4px solid ${statusColor}">
                <span>拍卖ID: ${auction.auctionId} - <strong style="color: ${statusColor}">${auction.status}</strong></span>
                <span>已进行: ${hours}小时${minutes}分钟</span>
                ${resetButton}
            </div>
            <div class="auction-details">
                <div>Token ID: ${auction.tokenId}</div>
                <div>底层资产: ${formatWeiToEther(auction.underlyingAmount)}</div>
                <div>当前价格: ${formatWeiToEther(auction.currentPrice)}</div>
                <div>累计支付: ${formatWeiToEther(auction.totalPayment)}</div>
                <div>原所有者: ${formatAddress(auction.originalOwner)}</div>
            </div>
        `;

        container.appendChild(auctionElement);
    });
}

function triggerLiquidation() {
    const userAddress = document.getElementById('liquidateUser').value;
    const tokenId = document.getElementById('liquidateTokenId').value;

    if (!userAddress) {
        showNotification('请输入用户地址', 'error');
        return;
    }

    if (!tokenId) {
        showNotification('请输入Token ID', 'error');
        return;
    }

    showNotification(`已对用户 ${formatAddress(userAddress)} 的Token ${tokenId} 发起清算`, 'warning');
}

function purchaseUnderlying() {
    const auctionId = document.getElementById('auctionId').value;
    const maxPurchaseAmount = document.getElementById('maxPurchaseAmount').value;
    const maxAcceptablePrice = document.getElementById('maxAcceptablePrice').value;

    if (!auctionId) {
        showNotification('请输入拍卖ID', 'error');
        return;
    }

    if (!maxPurchaseAmount) {
        showNotification('请输入最大购买数量', 'error');
        return;
    }

    if (!maxAcceptablePrice) {
        showNotification('请输入最高可接受价格', 'error');
        return;
    }

    showNotification(`已提交购买拍卖 ${auctionId} 的请求`);
}

// 重置拍卖功能 - 更新拍卖价格和状态
function resetAuction(auctionId) {
    const auction = mockData.activeAuctionsList.find(a => a.auctionId == auctionId);
    if (auction) {
        // 重置拍卖价格为当前价格 × 0.5，并更新状态为正常
        auction.currentPrice = (parseFloat(auction.currentPrice) * 0.5).toString();
        auction.status = "正常";
        auction.startTime = Math.floor(Date.now() / 1000); // 重置开始时间

        loadActiveAuctions(); // 重新加载拍卖列表
        showNotification(`拍卖 ${auctionId} 已重置，新的拍卖价格为 ${formatWeiToEther(auction.currentPrice)}`);
    } else {
        showNotification('未找到该拍卖ID的拍卖', 'error');
    }
}

function queryAuctionStatus() {
    const auctionId = document.getElementById('queryAuctionId').value;

    if (!auctionId) {
        showNotification('请输入拍卖ID', 'error');
        return;
    }

    const auction = mockData.activeAuctionsList.find(a => a.auctionId == auctionId);

    const container = document.getElementById('auctionStatus');
    container.innerHTML = '';

    if (auction) {
        const auctionResult = document.createElement('div');
        auctionResult.className = 'auction-detail';

        const timeElapsed = Math.floor(Date.now() / 1000) - auction.startTime;
        const hours = Math.floor(timeElapsed / 3600);
        const minutes = Math.floor((timeElapsed % 3600) / 60);

        auctionResult.innerHTML = `
            <div class="auction-header">
                <h3>拍卖ID: ${auction.auctionId}</h3>
                <span>已进行: ${hours}小时${minutes}分钟</span>
            </div>
            <div class="auction-details">
                <div>底层资产: ${formatWeiToEther(auction.underlyingAmount)}</div>
                <div>当前价格: ${formatWeiToEther(auction.currentPrice)}</div>
                <div>累计支付: ${formatWeiToEther(auction.totalPayment)}</div>
                <div>原所有者: ${formatAddress(auction.originalOwner)}</div>
                <div>Token ID: ${auction.tokenId}</div>
                <div>拍卖状态: ${auction.status}</div>
            </div>
        `;

        container.appendChild(auctionResult);
        showNotification(`已查询拍卖 ${auctionId} 的状态`);
    } else {
        container.innerHTML = '<p>未找到该拍卖ID的拍卖</p>';
        showNotification('未找到该拍卖ID的拍卖', 'error');
    }
}
