// scripts/deploy-mixed-architecture.js
async function main() {
    const [deployer] = await ethers.getSigners();
    
    // 部署LTC Mock
    const LTCMock = await ethers.getContractFactory("LTCMock");
    const ltc = await LTCMock.deploy();
    
    // 部署稳定币S (ERC20)
    const StableCoin = await ethers.getContractFactory("StableCoin");
    const stableCoin = await StableCoin.deploy();
    
    // 部署杠杆币L (ERC1155)
    const MultiLeverageToken = await ethers.getContractFactory("MultiLeverageToken");
    const leverageToken = await MultiLeverageToken.deploy();
    
    // 部署托管合约
    const LeverageCustodian = await ethers.getContractFactory("LeverageCustodian");
    const custodian = await LeverageCustodian.deploy(
        await ltc.getAddress(),
        await stableCoin.getAddress(),
        await leverageToken.getAddress()
    );
    
    // 设置权限
    await stableCoin.setCustodian(await custodian.getAddress());
    await leverageToken.transferOwnership(await custodian.getAddress());
    
    // 添加杠杆类型
    await leverageToken.addLeverageType(
        ethers.parseEther("5"),  // sharesOfS = 5
        ethers.parseEther("5")   // sharesOfU = 5
    );
    
    console.log("部署完成！");
    console.log("LTC:", await ltc.getAddress());
    console.log("Stable Coin (S):", await stableCoin.getAddress());
    console.log("Leverage Token (L):", await leverageToken.getAddress());
    console.log("Custodian:", await custodian.getAddress());
}