// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../Types.sol";

contract MultiLeverageToken is ERC1155, Ownable {

    // ✅ 添加baseURI相关变量
    string private _baseTokenURI;

    address public custodian;
    
    // 定义内部精度
    uint8 public constant PRECISION_DECIMALS = 18;
    uint256 public constant PRECISION_UNIT = 1e18;
    
    // ✅ 统一的token配置
    uint256 public constant MAX_STATIC_TOKEN_ID = 9;// 静态token ID范围1-9, 無法增加，從10開始的都是動態token
    uint256 public nextTokenId = 10; // 动态token从10开始
    
    // ✅ 统一的token信息结构体
    struct TokenInfo {
        LeverageType leverage;
        uint256 mintPrice;
        uint256 creationTime;    // 静态token设为0，动态token设为实际时间
        bool exists;             // 替代原来的initialized和exists
        bool isStatic;           // 标识是否为静态token
    }
    
    // ✅ 统一使用一个mapping
    mapping(uint256 => TokenInfo) public tokens;
    
    // 快速查找已存在的动态组合 (leverage + P0 -> tokenId)
    mapping(bytes32 => uint256) private combinationHash;
    
    // 事件
    event StaticTokenInitialized(uint256 indexed tokenId, LeverageType leverage, uint256 mintPrice);
    event TokenCreated(uint256 indexed tokenId, LeverageType leverage, uint256 mintPrice, uint256 timestamp);
    event TokensMinted(address indexed to, uint256 indexed tokenId, uint256 amount);
    event TokensBurned(address indexed from, uint256 indexed tokenId, uint256 amount);
    event CustodianChanged(address indexed oldCustodian, address indexed newCustodian);
    event BaseURIUpdated(string oldURI, string newURI);
    
    // ✅ 构造函数
    constructor(string memory staticMetadataURI) ERC1155("") Ownable(msg.sender) {
        _baseTokenURI = staticMetadataURI;
        _initializeStaticTokens();
    }

    // ✅ 实现_baseURI()函数
    function _baseURI() internal view returns (string memory) {
        return _baseTokenURI;
    }
    
    // ✅ 外部接口获取baseURI
    function baseURI() external view returns (string memory) {
        return _baseURI();
    }
    
    // ✅ Owner可以更新baseURI
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        string memory oldURI = _baseTokenURI;
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(oldURI, newBaseURI);
    }    
    
    // ✅ 初始化9个静态token - 使用统一结构体
    function _initializeStaticTokens() private {
        // 静态token配置
        tokens[1] = TokenInfo(LeverageType.AGGRESSIVE, 110 * 1e18, 0, true, true);
        tokens[2] = TokenInfo(LeverageType.AGGRESSIVE, 120 * 1e18, 0, true, true);    
        tokens[3] = TokenInfo(LeverageType.AGGRESSIVE, 130 * 1e18, 0, true, true);  
        tokens[4] = TokenInfo(LeverageType.CONSERVATIVE, 110 * 1e18, 0, true, true);       
        tokens[5] = TokenInfo(LeverageType.CONSERVATIVE, 120 * 1e18, 0, true, true);
        tokens[6] = TokenInfo(LeverageType.CONSERVATIVE, 130 * 1e18, 0, true, true);
        tokens[7] = TokenInfo(LeverageType.MODERATE, 110 * 1e18, 0, true, true);
        tokens[8] = TokenInfo(LeverageType.MODERATE, 120 * 1e18, 0, true, true);
        tokens[9] = TokenInfo(LeverageType.MODERATE, 130 * 1e18, 0, true, true);
        
        // 发出初始化事件
        for (uint256 i = 1; i <= MAX_STATIC_TOKEN_ID; i++) {
            TokenInfo memory info = tokens[i];
            emit StaticTokenInitialized(i, info.leverage, info.mintPrice);
        }
    }
    
    // ✅ 重写uri函数 - 使用统一结构体
    function uri(uint256 tokenId) public view override returns (string memory) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists, "Token does not exist");
        
        if (tokenInfo.isStatic) {
            // 静态token: 使用文件名格式
            string memory filename = _generateFilename(tokenInfo.leverage, tokenInfo.mintPrice);
            return string(abi.encodePacked(_baseURI(), filename, ".json"));
        } else {
            // 动态token: 生成动态URI
            return string(abi.encodePacked(
                _baseURI(), 
                "dynamic/", 
                Strings.toString(tokenId), 
                ".json"
            ));
        }
    }
    
    // ✅ 根据杠杆类型和mint价格生成文件名
    function _generateFilename(LeverageType leverageType, uint256 mintPriceInWei) 
        internal pure returns (string memory) {
        
        string memory typeName;
        if (leverageType == LeverageType.CONSERVATIVE) {
            typeName = "Conservative";
        } else if (leverageType == LeverageType.MODERATE) {
            typeName = "Moderate";  
        } else {
            typeName = "Aggressive";
        }
        
        uint256 priceInDollars = mintPriceInWei / 1e18;
        return string(abi.encodePacked(typeName, Strings.toString(priceInDollars)));
    }
    
    function setCustodian(address _custodian) external onlyOwner {
        require(_custodian != address(0), "Invalid custodian address");
        address oldCustodian = custodian;
        custodian = _custodian;
        emit CustodianChanged(oldCustodian, _custodian);
    }
    
    // 個人用戶是無法鑄幣，只有Custodian合約可以鑄幣
    modifier onlyCustodian() {
        require(msg.sender == custodian, "Only custodian");
        _;
    }
    
    // ✅ 铸造静态token - 使用统一结构体
    function mintStaticToken(
        address to,
        uint256 tokenId,
        uint256 amountInWei
    ) external onlyCustodian {
        require(tokenId >= 1 && tokenId <= MAX_STATIC_TOKEN_ID, "Invalid static token ID");
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists && tokenInfo.isStatic, "Static token not available");
        
        _mint(to, tokenId, amountInWei, "");
        emit TokensMinted(to, tokenId, amountInWei);
    }
    
    // ✅ 批量铸造静态token
    function mintStaticTokenBatch(
        address to,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external onlyCustodian {
        require(tokenIds.length == amounts.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(tokenId >= 1 && tokenId <= MAX_STATIC_TOKEN_ID, "Invalid static token ID");
            TokenInfo memory tokenInfo = tokens[tokenId];
            require(tokenInfo.exists && tokenInfo.isStatic, "Static token not available");
        }
        
        _mintBatch(to, tokenIds, amounts, "");
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            emit TokensMinted(to, tokenIds[i], amounts[i]);
        }
    }
    
    // ✅ 创建动态token - 使用统一结构体
    function createDynamicLeverageToken(
        LeverageType leverage,
        uint256 mintPriceInWei
    ) public onlyCustodian returns (uint256 tokenId) {
        
        // 生成组合的唯一哈希
        bytes32 combHash = keccak256(abi.encodePacked(leverage, mintPriceInWei));
        
        // 检查是否已存在相同动态组合
        uint256 existingTokenId = combinationHash[combHash];
        if (existingTokenId != 0 && tokens[existingTokenId].exists) {
            return existingTokenId;
        }
        
        // 创建新的动态token
        tokenId = nextTokenId++;
        
        tokens[tokenId] = TokenInfo({
            leverage: leverage,
            mintPrice: mintPriceInWei,
            creationTime: block.timestamp,  // 动态token有创建时间
            exists: true,
            isStatic: false                 // 标记为动态token
        });
        
        // 记录组合哈希
        combinationHash[combHash] = tokenId;
        
        emit TokenCreated(tokenId, leverage, mintPriceInWei, block.timestamp);
        return tokenId;
    }
    
    // ✅ 铸造动态token
    function mintDynamicToken(
        address to,
        uint256 tokenId,
        uint256 amountInWei
    ) external onlyCustodian {
        require(tokenId >= 10, "Not a dynamic token ID");
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists && !tokenInfo.isStatic, "Dynamic token not available");
        
        _mint(to, tokenId, amountInWei, "");
        emit TokensMinted(to, tokenId, amountInWei);
    }
    
    // ✅ 一步创建并铸造动态token
    function createAndMintDynamicToken(
        address to,
        LeverageType leverage,
        uint256 mintPriceInWei,
        uint256 amountInWei
    ) external onlyCustodian returns (uint256 tokenId) {
        tokenId = createDynamicLeverageToken(leverage, mintPriceInWei);
        _mint(to, tokenId, amountInWei, "");
        emit TokensMinted(to, tokenId, amountInWei);
        return tokenId;
    }
    
    // ✅ 销毁代币
    function burn(
        address from,
        uint256 tokenId,
        uint256 amountInWei
    ) external onlyCustodian {
        require(tokens[tokenId].exists, "Token does not exist");
        _burn(from, tokenId, amountInWei);
        emit TokensBurned(from, tokenId, amountInWei);
    }
    
    // ✅ 获取token详细信息 - 使用统一结构体
    function getTokenInfo(uint256 tokenId) external view returns (
        LeverageType leverage,
        uint256 mintPrice,
        uint256 creationTime,
        string memory tokenName,
        bool isStatic
    ) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists, "Token does not exist");
        
        return (
            tokenInfo.leverage,
            tokenInfo.mintPrice,
            tokenInfo.creationTime,
            generateTokenName(tokenInfo.leverage, tokenInfo.mintPrice),
            tokenInfo.isStatic
        );
    }
    
    // ✅ 生成代币名称
    function generateTokenName(LeverageType leverage, uint256 mintPrice) 
        public pure returns (string memory) {
        string memory typeName;

        if (leverage == LeverageType.CONSERVATIVE) {
            typeName = "Conservative";
        } else if (leverage == LeverageType.MODERATE) {
            typeName = "Moderate";  
        } else {
            typeName = "Aggressive";
        }
        
        uint256 priceInDollars = mintPrice / 1e18;
        return string(abi.encodePacked(
            typeName, 
            " Leverage Token (P0: $", 
            Strings.toString(priceInDollars), 
            ")"
        ));
    }
    
    // ✅ 检查tokenId是否存在 - 简化逻辑
    function tokenExists(uint256 tokenId) public view returns (bool) {
        return tokens[tokenId].exists;
    }
    
    // ✅ 检查是否为静态token
    function isStaticToken(uint256 tokenId) public view returns (bool) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        return tokenInfo.exists && tokenInfo.isStatic;
    }
    
    // ✅ 检查是否为动态token
    function isDynamicToken(uint256 tokenId) public view returns (bool) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        return tokenInfo.exists && !tokenInfo.isStatic;
    }
    
    // ✅ 查找静态token
    function findStaticTokenId(LeverageType leverage, uint256 mintPriceInWei) 
        external view returns (uint256) {
        for (uint256 i = 1; i <= MAX_STATIC_TOKEN_ID; i++) {
            TokenInfo memory info = tokens[i];
            if (info.exists && info.isStatic && 
                info.leverage == leverage && 
                info.mintPrice == mintPriceInWei) {
                return i;
            }
        }
        return 0;
    }
    
    // ✅ 查找动态token
    function findDynamicTokenId(LeverageType leverage, uint256 mintPriceInWei) 
        external view returns (uint256) {
        bytes32 combHash = keccak256(abi.encodePacked(leverage, mintPriceInWei));
        return combinationHash[combHash];
    }

    
    // ✅ 计算token价值 - 使用统一结构体
    function calculateTokenValue(uint256 tokenId, uint256 currentPriceInWei) 
        external view returns (uint256) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists, "Token does not exist");
        
        LeverageType leverage = tokenInfo.leverage;
        uint256 mintPriceInWei = tokenInfo.mintPrice;
        
        uint256 navInWei = 0;
        if(leverage == LeverageType.CONSERVATIVE){
            navInWei = (9 * currentPriceInWei - mintPriceInWei) * 1e18 / (8 * mintPriceInWei);
        } else if(leverage == LeverageType.MODERATE){
            navInWei = (5 * currentPriceInWei - mintPriceInWei) * 1e18 / (4 * mintPriceInWei);
        } else if(leverage == LeverageType.AGGRESSIVE){
            navInWei = (2 * currentPriceInWei - mintPriceInWei) * 1e18 / mintPriceInWei;
        }
        
        return navInWei;
    }
    
    // ✅ 获取所有静态token信息
    function getAllStaticTokens() external view returns (
        uint256[] memory tokenIds,
        LeverageType[] memory leverageTypes,
        uint256[] memory mintPrices
    ) {
        tokenIds = new uint256[](MAX_STATIC_TOKEN_ID);
        leverageTypes = new LeverageType[](MAX_STATIC_TOKEN_ID);
        mintPrices = new uint256[](MAX_STATIC_TOKEN_ID);
        
        for (uint256 i = 1; i <= MAX_STATIC_TOKEN_ID; i++) {
            tokenIds[i-1] = i;
            leverageTypes[i-1] = tokens[i].leverage;
            mintPrices[i-1] = tokens[i].mintPrice;
        }
    }
    
    // ✅ 获取所有token信息（静态+动态）
    function getTokensByRange(uint256 startId, uint256 endId) external view returns (
        uint256[] memory tokenIds,
        LeverageType[] memory leverages,
        uint256[] memory mintPrices,
        bool[] memory isStaticFlags
    ) {
        require(startId <= endId, "Invalid range");
        uint256 length = endId - startId + 1;
        
        tokenIds = new uint256[](length);
        leverages = new LeverageType[](length);
        mintPrices = new uint256[](length);
        isStaticFlags = new bool[](length);
        
        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = startId + i;
            TokenInfo memory info = tokens[tokenId];
            
            tokenIds[i] = tokenId;
            leverages[i] = info.leverage;
            mintPrices[i] = info.mintPrice;
            isStaticFlags[i] = info.isStatic;
        }
    }

    function getMintPrice(uint256 tokenId) external view returns (uint256) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        require(tokenInfo.exists, "Token does not exist");
        return tokenInfo.mintPrice;
    }

    function getNextTokenId() external view returns (uint256) {
        return nextTokenId;
    }
    
    // 查询余额
    function balanceOfInWei(address account, uint256 id) 
        public view returns (uint256) {
        return balanceOf(account, id);
    }
    
    // 格式化显示
    function formatBalance(address account, uint256 id) 
        external view returns (string memory) {
        uint256 balance = balanceOf(account, id);
        uint256 integerPart = balance / PRECISION_UNIT;
        uint256 decimalPart = balance % PRECISION_UNIT;
        
        return string(abi.encodePacked(
            Strings.toString(integerPart), 
            ".",
            Strings.toString(decimalPart)
        ));
    }
    
    // ✅ Owner函数：更新动态token的baseURI
    function setDynamicTokenURI(string calldata dynamicURI) external onlyOwner {
        // 这个函数可以用来将来更新动态token的URI
        // 暂时不实现，等API服务器部署后再添加
    }


}
