const https = require('https');
const http = require('http');

// 验证所有图片链接
const imagesCID = "bafybeihwpkrlgcdptwxmdvhqq7ggfjnlrhphlwljhpugqo2qipyccikhpe";

const imageUrls = {
    conservative: {
        ipfs: `ipfs://${imagesCID}/Conservative.png`,
        gateway: `https://${imagesCID}.ipfs.w3s.link/Conservative.png`,
        backup: `https://ipfs.io/ipfs/${imagesCID}/Conservative.png`,
        cloudflare: `https://cloudflare-ipfs.com/ipfs/${imagesCID}/Conservative.png`
    },
    moderate: {
        ipfs: `ipfs://${imagesCID}/Moderate.png`, 
        gateway: `https://${imagesCID}.ipfs.w3s.link/Moderate.png`,
        backup: `https://ipfs.io/ipfs/${imagesCID}/Moderate.png`,
        cloudflare: `https://cloudflare-ipfs.com/ipfs/${imagesCID}/Moderate.png`
    },
    aggressive: {
        ipfs: `ipfs://${imagesCID}/Aggressive.png`,
        gateway: `https://${imagesCID}.ipfs.w3s.link/Aggressive.png`,
        backup: `https://ipfs.io/ipfs/${imagesCID}/Aggressive.png`,
        cloudflare: `https://cloudflare-ipfs.com/ipfs/${imagesCID}/Aggressive.png`
    }
};

console.log("🔍 验证图片访问:");
console.log("Conservative:", imageUrls.conservative.gateway);
console.log("Moderate:", imageUrls.moderate.gateway);  
console.log("Aggressive:", imageUrls.aggressive.gateway);

// ✅ 增强的网络验证功能，支持重定向
function checkUrlWithRedirect(url, name, maxRedirects = 3) {
    return new Promise((resolve) => {
        function makeRequest(currentUrl, redirectCount = 0) {
            const isHttps = currentUrl.startsWith('https:');
            const client = isHttps ? https : http;
            
            const request = client.request(currentUrl, { 
                method: 'HEAD',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }, (response) => {
                const statusCode = response.statusCode;
                
                // 成功状态码
                if (statusCode === 200) {
                    console.log(`${name}: ✅ 可访问 (${statusCode})`);
                    if (response.headers['content-length']) {
                        console.log(`    文件大小: ${response.headers['content-length']} bytes`);
                    }
                    if (response.headers['content-type']) {
                        console.log(`    文件类型: ${response.headers['content-type']}`);
                    }
                    resolve(true);
                    return;
                }
                
                // 重定向状态码
                if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && redirectCount < maxRedirects) {
                    const location = response.headers.location;
                    if (location) {
                        console.log(`${name}: 🔄 重定向 (${statusCode}) -> ${location}`);
                        makeRequest(location, redirectCount + 1);
                        return;
                    }
                }
                
                // 其他状态码
                console.log(`${name}: ❌ HTTP ${statusCode}`);
                resolve(false);
            });
            
            request.on('error', (error) => {
                console.log(`${name}: ❌ 网络错误 - ${error.message}`);
                resolve(false);
            });
            
            request.setTimeout(20000, () => {
                console.log(`${name}: ❌ 请求超时`);
                request.destroy();
                resolve(false);
            });
            
            request.end();
        }
        
        makeRequest(url);
    });
}

async function verifyAllImages() {
    console.log("\n📡 开始网络验证测试 (支持重定向)...");
    
    const results = {
        success: [],
        failed: []
    };
    
    for (const [tokenType, urls] of Object.entries(imageUrls)) {
        const name = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
        console.log(`\n🔍 测试 ${name} 代币图片:`);
        
        let anySuccess = false;
        
        // 测试Web3.Storage网关
        const gatewaySuccess = await checkUrlWithRedirect(urls.gateway, "  Web3.Storage网关");
        if (gatewaySuccess) anySuccess = true;
        
        // 如果Web3.Storage失败，测试Cloudflare网关
        if (!gatewaySuccess) {
            console.log("  Web3.Storage网关问题，尝试Cloudflare网关...");
            const cloudflareSuccess = await checkUrlWithRedirect(urls.cloudflare, "  Cloudflare网关");
            if (cloudflareSuccess) anySuccess = true;
        }
        
        // 如果还是失败，测试IPFS.io网关
        if (!anySuccess) {
            console.log("  前两个网关都失败，尝试IPFS.io网关...");
            const backupSuccess = await checkUrlWithRedirect(urls.backup, "  IPFS.io网关");
            if (backupSuccess) anySuccess = true;
        }
        
        if (anySuccess) {
            results.success.push(tokenType);
        } else {
            results.failed.push(tokenType);
        }
        
        console.log(`  IPFS格式: ${urls.ipfs}`);
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("📊 验证结果总结:");
    console.log(`✅ 成功: ${results.success.length}个文件 (${results.success.join(', ')})`);
    console.log(`❌ 失败: ${results.failed.length}个文件 (${results.failed.join(', ')})`);
    
    if (results.success.length > 0) {
        console.log("\n🎉 部分或全部图片验证成功！");
        if (results.success.length === 3) {
            console.log("✅ 所有图片都可以正常使用");
        } else {
            console.log("⚠️ 部分图片可用，可以先用这些进行测试");
        }
    }
    
    if (results.failed.length > 0) {
        console.log("\n🔧 失败文件的可能原因:");
        console.log("1. 文件名大小写问题 (Conservative vs conservative)");
        console.log("2. 文件还在IPFS网络同步中，稍后重试");
        console.log("3. 网络连接问题");
    }
    
    console.log("\n🎯 用于JSON文件的image字段:");
    console.log(`Conservative: "${imageUrls.conservative.ipfs}"`);
    console.log(`Moderate: "${imageUrls.moderate.ipfs}"`);
    console.log(`Aggressive: "${imageUrls.aggressive.ipfs}"`);
    
    console.log("\n🌐 可用的网关链接 (浏览器测试):");
    for (const [tokenType, urls] of Object.entries(imageUrls)) {
        console.log(`${tokenType}: ${urls.cloudflare}`);
    }
    
    console.log("=".repeat(70));
}

// 延迟执行验证，让URL输出先显示
setTimeout(() => {
    verifyAllImages().catch(console.error);
}, 1000);