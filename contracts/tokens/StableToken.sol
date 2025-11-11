// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// StableToken.sol - ERC20 代币
contract StableToken is ERC20, Ownable {

    address public custodian;
    
    //OpenZeppelin 的 ERC20 合约默认 decimals = 18：

    // 事件
    event CustodianChanged(address indexed oldCustodian, address indexed newCustodian);
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);
    
    //構造函數
    constructor() ERC20("Stable Token", "S") Ownable(msg.sender) {}
    
    modifier onlyCustodian() {
        require(msg.sender == custodian, "Only custodian");
        _;
    }
    
    //部署者為Owner, 部署者才可以更新Custodian
    //只有Custodian才可以鑄幣和銷毀代币
    function setCustodian(address _custodian) external onlyOwner {
        require(_custodian != address(0), "Invalid custodian address");
        address oldCustodian = custodian;
        custodian = _custodian;
        emit CustodianChanged(oldCustodian, _custodian);
    }
    
    function mint(address to, uint256 amount) external onlyCustodian {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be positive");
        _mint(to, amount);
        emit Minted(to, amount);
    }
    
    function burn(address from, uint256 amount) external onlyCustodian {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Amount must be positive");
        require(balanceOf(from) >= amount, "Insufficient balance to burn");
        _burn(from, amount);
        emit Burned(from, amount);
    }
    
    // 查询函数
    function getCustodian() external view returns (address) {
        return custodian;
    }
    
    // 检查是否已设置托管合约
    function isCustodianSet() external view returns (bool) {
        return custodian != address(0);
    }
}