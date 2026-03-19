// skybots.js
const { chromium } = require('playwright-extra'); 
const stealth = require('puppeteer-extra-plugin-stealth')(); 
chromium.use(stealth); 

const fs = require('fs');
const path = require('path');
const https = require('https');

// ================= 配置区 =================
const TARGET_URL = 'https://dash.skybots.tech/login';
const DASHBOARD_URL = 'https://dash.skybots.tech/projects'; // 登录完成后跳转这个网页
const STATE_FILE = path.join(__dirname, 'auth_state.json');

const ACCOUNT = process.env.SKYBOTS_ACCOUNT || '';
const PASSWORD = process.env.SKYBOTS_PASSWORD || '';
const PROXY_SERVER = process.env.PROXY_URL || '';

// TG 通知配置
const TG_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

// ================= 辅助函数 =================
function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Tokyo',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTGPhoto(caption, imagePath) {
    return new Promise((resolve) => {
        if (!TG_TOKEN || !TG_CHAT_ID || !fs.existsSync(imagePath)) {
            console.log('⚠️ TG配置未完成或图片不存在，跳过发送图片。');
            return resolve();
        }

        const boundary = '----PlaywrightBoundary' + Math.random().toString(16).slice(2);
        const fileName = path.basename(imagePath);
        const fileContent = fs.readFileSync(imagePath);
        const finalCaption = `[🤖 Skybots] ${nowStr()}\n${caption}`;

        const postData = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${finalCaption}\r\n`),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`),
            fileContent,
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${TG_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': postData.length,
            },
            timeout: 20000 
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 200) {
                console.log('📨 TG 图片推送成功！');
            } else {
                console.log(`⚠️ TG 推送失败: HTTP ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            console.log(`❌ TG 推送异常: ${e.message}`);
            resolve(); 
        });

        req.on('timeout', () => {
            console.log('⏰ TG 推送超时，跳过。');
            req.destroy();
            resolve();
        });

        req.write(postData);
        req.end();
    });
}

// ================= 主逻辑 =================
async function main() {
    let proxyConfig = PROXY_SERVER ? { server: PROXY_SERVER } : undefined;
    
    console.log('🔧 启动带隐身插件的浏览器...');
    const browser = await chromium.launch({
        headless: false, // 必须配合 xvfb 骗过 CF
        proxy: proxyConfig,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    let contextOptions = {
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
    };
    
    if (fs.existsSync(STATE_FILE)) {
        console.log('📂 发现历史会话文件，尝试免密加载...');
        contextOptions.storageState = STATE_FILE;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.setDefaultTimeout(45000); 

    try {
        console.log(`🌐 访问目标网页: ${TARGET_URL}`);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 1. 判断是否已经免密登录
        await page.waitForTimeout(5000); 
        
        if (page.url().includes('projects')) {
            console.log('✅ 会话有效，免密登录成功，直接进入 Projects 页面！');
        } else {
            console.log('🛡️ 正在解析登录页面...');
            
            // 👈 升级 1：使用多重选择器，兼容 text, email, username 等各种写法的输入框
            const accountInput = page.locator('input[type="email"], input[name="email"], input[name="username"], input[type="text"]').first();
            await accountInput.waitFor({ state: 'visible', timeout: 60000 });
            console.log('✅ 登录表单已加载！');

            if (!ACCOUNT || !PASSWORD) throw new Error('❌ 未配置 SKYBOTS secrets');

            console.log('✏️ 填写账号密码...');
            await accountInput.fill(ACCOUNT);
            await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
            
            // 👈 升级 2：对付 CF Turnstile 验证框
            console.log('🛡️ 尝试处理 Cloudflare 验证框...');
            await page.waitForTimeout(2000); // 稍微等盾加载稳
            try {
                // 寻找包含 challenges 或 turnstile 的 iframe
                const cfIframe = page.locator('iframe[src*="challenges"], iframe[src*="turnstile"]').first();
                if (await cfIframe.isVisible({ timeout: 5000 })) {
                    console.log('👆 发现 CF 验证框，尝试模拟鼠标点击...');
                    const box = await cfIframe.boundingBox();
                    if (box) {
                        // 将鼠标移动到 iframe 的正中心并点击
                        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                        console.log('⏳ 等待 CF 验证打钩 (5秒)...');
                        await page.waitForTimeout(5000); 
                    }
                } else {
                    console.log('未检测到需要点击的 CF 验证框，继续...');
                }
            } catch (e) {
                console.log('⚠️ CF 验证框处理跳过 (可能并未出现)');
            }

            console.log('📤 提交登录请求...');
            // 兼容法文 Se connecter 和英文 Login
            await page.locator('button[type="submit"], button:has-text("Se connecter"), button:has-text("Login")').first().click();

            console.log('⏳ 等待页面跳转确认登录成功...');
            await page.waitForURL(/projects/, { timeout: 20000 });
            console.log(`✅ 登录成功！`);
            
            console.log('💾 保存最新会话状态...');
            await context.storageState({ path: STATE_FILE });
        }

        // ==========================================
        // 👇 核心业务逻辑 (Projects 页面检测续期)
        // ==========================================
        console.log('🚀 开始执行续期检测逻辑...');
        
        await page.waitForLoadState('networkidle'); 
        await page.waitForTimeout(3000); 

        // 寻找包含 Renew 的按钮或链接
        const renewBtn = page.locator('button:has-text("Renew"), a:has-text("Renew")').first();

        if (await renewBtn.isVisible()) {
            console.log('🔘 找到 "Renew" 续期按键，点击续期...');
            await renewBtn.click();
            console.log('✅ 按钮已点击，等待 10 秒后截图结果...');
            
            await page.waitForTimeout(10000);
            
            const shotPath = 'renew_success.png';
            await page.screenshot({ path: shotPath, fullPage: true });
            await sendTGPhoto('🎉 续期按钮已找到并点击！今日续期完成，请查看结果截图。', shotPath);
            console.log('🎉 续期流程处理完毕，已发送图片通知。');

        } else {
            console.log('⏰ 未找到 "Renew" 续期按键，今日可能无需续期。');
            
            const shotPath = 'renew_not_needed.png';
            await page.screenshot({ path: shotPath, fullPage: true });
            await sendTGPhoto('⏰ 今日暂无需续期 (未找到 Renew 按键)。', shotPath);
            console.log('⏰ 已发送暂无需续期通知。');
        }

    } catch (error) {
        console.error(`❌ 脚本执行异常: ${error.message}`);
        const errPath = 'skybots_error.png';
        await page.screenshot({ path: errPath, fullPage: true });
        await sendTGPhoto(`❌ 脚本运行出错了: ${error.message}`, errPath);
        throw error; 
    } finally {
        await context.close();
        await browser.close();
    }
}

main().catch(() => process.exit(1));
