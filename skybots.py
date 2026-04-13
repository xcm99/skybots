#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import subprocess
import requests
from datetime import datetime
from seleniumbase import SB

# ================= 配置区 =================
TARGET_URL = "https://dash.skybots.tech/auth/login" # 更新了登录 URL 路径
DASHBOARD_URL = "https://dash.skybots.tech/projects"

ACCOUNT = os.environ.get("SKYBOTS_ACCOUNT", "")
PASSWORD = os.environ.get("SKYBOTS_PASSWORD", "")
PROXY = os.environ.get("PROXY_URL", "")

TG_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID", "")

# ================= 辅助函数 =================
def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def send_tg_photo(caption, image_path):
    if not TG_TOKEN or not TG_CHAT_ID or not os.path.exists(image_path):
        return
    try:
        url = f"https://api.telegram.org/bot{TG_TOKEN}/sendPhoto"
        with open(image_path, "rb") as f:
            requests.post(url, data={"chat_id": TG_CHAT_ID, "caption": f"[🤖 Skybots] {now_str()}\n{caption}"}, files={"photo": f}, timeout=30)
        print("📨 TG 图片推送成功！")
    except Exception as e:
        print(f"⚠️ TG 推送失败: {e}")

# 获取 Turnstile 盾的坐标逻辑保持不变
def get_turnstile_coords(sb):
    return sb.execute_script("""
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            var src = iframes[i].src || '';
            if (src.includes('cloudflare') || src.includes('turnstile')) {
                var rect = iframes[i].getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return {x: rect.x + 30, y: rect.y + rect.height / 2};
                }
            }
        }
        return null;
    """)

# ================= 主逻辑 =================
def main():
    if not ACCOUNT or not PASSWORD:
        print("❌ 缺少账号或密码环境变量")
        sys.exit(1)

    print("🔧 启动 SeleniumBase UC 模式...")
    opts = {
        "uc": True,
        "headless": False, # 如果在服务器运行，请确保有虚拟显示器
        "locale": "fr",    # 设为 fr 以匹配页面语言
        "chromium_arg": "--disable-dev-shm-usage,--no-sandbox"
    }
    if PROXY:
        opts["proxy"] = PROXY

    with SB(**opts) as sb:
        sb.set_window_size(1280, 1024)
        
        try:
            print(f"🌐 访问登录页: {TARGET_URL}")
            sb.uc_open_with_reconnect(TARGET_URL, reconnect_time=5)
            time.sleep(5)

            if "projects" in sb.get_current_url():
                print("✅ 已处于登录状态")
            else:
                # 1. 输入账号密码 (使用图中显示的 ID 或类型)
                print("✏️ 填写表单...")
                # 针对新版界面更精确的选择器
                sb.update_text('input[name="email"], input[type="email"]', ACCOUNT)
                sb.update_text('input[name="password"], input[type="password"]', PASSWORD)
                
                # 2. 处理 CF Turnstile 验证码
                print("🛡️ 等待验证码加载...")
                time.sleep(3)
                
                # 尝试点击验证码
                for attempt in range(3):
                    is_done = sb.execute_script('var cf = document.querySelector("[name=\'cf-turnstile-response\']"); return cf && cf.value.length > 20;')
                    if is_done:
                        print("✅ 验证码已通过")
                        break
                    
                    print(f"🖱️ 尝试过盾 (第 {attempt + 1} 次)...")
                    try:
                        # 优先使用原生定位点击
                        sb.uc_gui_click_captcha()
                        time.sleep(4)
                    except:
                        # 备选：物理坐标点击（针对截图中的复选框位置）
                        coords = get_turnstile_coords(sb)
                        if coords:
                            sb.click_with_offset('iframe[src*="cloudflare"]', 30, 0)
                            time.sleep(4)

                # 3. 点击登录按钮 (匹配 "Se connecter")
                print("📤 提交登录...")
                login_btn = 'button:contains("Se connecter"), button:contains("Login"), .btn-primary'
                sb.click(login_btn)
                
                time.sleep(8)

            # 4. 续期逻辑
            print("🚀 检查续期状态...")
            # 兼容法文和英文的续期按钮
            renew_btn_selector = 'button:contains("Renouveler"), button:contains("Renew"), a:contains("Renouveler")'
            
            # 检测“提前3天”的提示（法语：La prolongation sera disponible 3 jours avant...）
            too_early_fr = "//*[contains(text(), 'disponible 3 jours avant')]"
            
            if sb.is_element_visible(too_early_fr):
                msg = "⏰ 尚未到续期时间 (需提前3天)。"
                print(msg)
                sb.save_screenshot("status.png")
                send_tg_photo(msg, "status.png")
            elif sb.is_element_visible(renew_btn_selector):
                print("🔘 找到续期按钮，正在点击...")
                sb.click(renew_btn_selector)
                time.sleep(5)
                sb.save_screenshot("success.png")
                send_tg_photo("🎉 续期操作已完成！", "success.png")
            else:
                print("❓ 未发现续期按钮或提示")
                sb.save_screenshot("unknown.png")
                send_tg_photo("❌ 未能识别续期按钮，请检查截图", "unknown.png")

        except Exception as e:
            print(f"❌ 运行错误: {e}")
            sb.save_screenshot("error.png")
            send_tg_photo(f"❌ 脚本异常: {str(e)[:100]}", "error.png")

if __name__ == "__main__":
    main()
