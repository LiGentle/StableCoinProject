// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title LPToken
 * @dev StableToken-USDC 池的流动性提供者代币
 * 只有指定的池合约可以铸造和销毁代币
 * 無需直接部署，在AMM中由StableUSDCAMM合约创建：lpToken = new LPToken(_lpName, _lpSymbol);
 */
contract LPToken is ERC20 {
    
    // ============= 状态变量 =============
    
    address public immutable pool;  // 唯一授权的池合约地址
    
    // ============= 事件定义 =============
    
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);

    // ============= 修饰符 =============
    
    modifier onlyPool() {
        require(msg.sender == pool, "LPToken: Only pool contract can call this function");
        _;
    }

    // ============= 构造函数 =============
    constructor(
        string memory _name, 
        string memory _symbol
    ) ERC20(_name, _symbol) {

        pool = msg.sender;// msg.sender 是创建此代币的 StableUSDCPool 合约
    }

    // ============= 代币管理 =============
    
    /**
     * @dev 铸造代币（仅池合约可调用）
     */
    function mint(address to, uint256 amount) external onlyPool {
        require(to != address(0), "LPToken: mint to zero address");
        require(amount > 0, "LPToken: amount must be positive");
        
        _mint(to, amount);
        emit Minted(to, amount);
    }
    
    /**
     * @dev 销毁代币（仅池合约可调用）
     */
    function burn(address from, uint256 amount) external onlyPool {
        require(from != address(0), "LPToken: burn from zero address");
        require(amount > 0, "LPToken: amount must be positive");
        require(balanceOf(from) >= amount, "LPToken: insufficient balance");
        
        _burn(from, amount);
        emit Burned(from, amount);
    }

    // ============= 查询函数 =============
    
    /**
     * @dev 获取代币信息
     */
    function getTokenInfo() external view returns (
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 tokenTotalSupply,
        address authorizedPool
    ) {
        return (name(), symbol(), decimals(), totalSupply(), pool);
    }
    
    /**
     * @dev 检查地址是否是授权的池合约
     */
    function isAuthorizedPool(address account) external view returns (bool) {
        return account == pool;
    }
}