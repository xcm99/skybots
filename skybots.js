// skybots.js - 终极修复版 (吸收 SeleniumBase 过盾精髓)
const { chromium } = require('playwright-extra'); 
const stealth = require('puppeteer-extra-plugin-stealth')(); 
chromium.use(stealth); 

const fs = require('fs');
const path = require('path');
const https = require('https');

// ================= 配置区 =================
const TARGET_URL = 'https://dash.skybots.tech/login';
const DASHBOARD_URL = 'https://dash.skybots.tech/projects'; 
const STATE_FILE = path.join(__dirname, 'auth_state.json');

const ACCOUNT = process.env.SKYBOTS_ACCOUNT || '';
const PASSWORD = process.env.SKYBOTS_PASSWORD || '';
const PROXY_SERVER = process.env.PROXY_URL || '';

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
            if (res.statusCode === 200) console.log('📨 TG 图片推送成功！');
            else console.log(`⚠️ TG 推送失败: HTTP ${res.statusCode}`);
            resolve();
        });

        req.on('error', (e) => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.write(postData);
        req.end();
    });
}

// ================= 主逻辑 =================
async function main() {
    let proxyConfig = PROXY_SERVER ? { server: PROXY_SERVER } : undefined;
    
    console.log('🔧 启动带隐身插件的浏览器...');
    const browser = await chromium.launch({
        headless: false, 
        proxy: proxyConfig,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    let contextOptions = {
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
    };
    
    if (fs.existsSync(STATE_FILE)) {
        console.log('📂 发现历史会话文件，加载状态...');
        contextOptions.storageState = STATE_FILE;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.setDefaultTimeout(60000); 

    try {
        console.log(`🌐 访问目标网页: ${TARGET_URL}`);
        await page.goto(TARGET_URL, { waitUntil: 'load' });
        await page.waitForTimeout(5000); 
        
        if (page.url().includes('projects')) {
            console.log('✅ 会话有效，免密登录成功，直接进入 Projects 页面！');
        } else {
            console.log('🛡️ 正在解析登录页面...');
            const accountInput = page.locator('input[type="email"], input[name="email"], input[name="username"], input[type="text"]').first();
            await accountInput.waitFor({ state: 'visible', timeout: 30000 });
            console.log('✅ 登录表单已加载！');

            if (!ACCOUNT || !PASSWORD) throw new Error('❌ 未配置 SKYBOTS secrets');

            console.log('✏️ 填写账号密码...');
            await accountInput.fill(ACCOUNT);
            await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
            
            // =========================================================
            // 👇 融合 Python 逻辑的终极 CF 盾爆破方案
            // =========================================================
            console.log('🛡️ 开始处理 Cloudflare 验证框...');
            await page.waitForTimeout(3000);

            // 秘诀 1：清理可能遮挡 CF 盾的 Cookie 弹窗
            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let i = 0; i < buttons.length; i++) {
                    const text = buttons[i].textContent.trim().toLowerCase();
                    if (['consent', 'accept', 'accept all', 'got it', 'i agree'].includes(text)) {
                        buttons[i].click();
                    }
                }
            });
            console.log('🧹 已清理潜在的 Cookie 遮挡弹窗');
            await page.waitForTimeout(1000);

            // 秘诀 2 & 3：循环尝试点击与底层验证
            let cfPassed = false;
            for (let attempt = 0; attempt < 4; attempt++) {
                // 底层验证：检查 cf-turnstile-response 是否生成
                const isDone = await page.evaluate(() => {
                    const cf = document.querySelector("input[name='cf-turnstile-response']");
                    return cf && cf.value && cf.value.length > 20;
                });

                if (isDone) {
                    console.log(`✅ Turnstile 已底层验证通过！(第 ${attempt} 次尝试)`);
                    cfPassed = true;
                    break;
                }

                console.log(`🖱️ 尝试定位并点击盾 (第 ${attempt + 1} 次)...`);
                const iframes = page.locator('iframe');
                const count = await iframes.count();
                let clicked = false;

                for (let i = 0; i < count; i++) {
                    const frame = iframes.nth(i);
                    const box = await frame.boundingBox();
                    
                    // 尺寸判定
                    if (box && box.width > 200 && box.height > 40) {
                        const targetX = box.x + 30;
                        const targetY = box.y + (box.height / 2);
                        await page.mouse.move(targetX, targetY, { steps: 15 });
                        await page.waitForTimeout(300);
                        await page.mouse.click(targetX, targetY);
                        clicked = true;
                        break;
                    }
                }

                if (clicked) {
                    console.log('⏳ 已点击坐标，等待验证响应 (5秒)...');
                    await page.waitForTimeout(5000);
                } else {
                    console.log('⚠️ 未找到合适尺寸的盾容器，等待重试...');
                    await page.waitForTimeout(3000);
                }
            }
            // =========================================================

            console.log('📤 提交登录请求...');
            await page.locator('button[type="submit"], button:has-text("Se connecter"), button:has-text("Login")').first().click();

            console.log('⏳ 等待页面跳转确认登录成功...');
            await page.waitForURL(/projects/, { timeout: 20000 });
            console.log(`✅ 登录成功！当前页面: ${page.url()}`);
            
            console.log('💾 保存最新会话状态...');
            await context.storageState({ path: STATE_FILE });
        }

        console.log('🚀 开始执行续期检测逻辑...');
        await page.waitForLoadState('networkidle'); 
        await page.waitForTimeout(3000); 

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
