#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import random
import subprocess
import requests
from datetime import datetime
from seleniumbase import SB

# ================= 配置区 =================
# 更新了登录 URL 路径
TARGET_URL = "https://dash.skybots.tech/auth/login" 
DASHBOARD_URL = "https://dash.skybots.tech/projects"

ACCOUNT = os.environ.get("SKYBOTS_ACCOUNT", "")
PASSWORD = os.environ.get("SKYBOTS_PASSWORD", "")
PROXY = os.environ.get("skybots_PROXY_NODE", "")

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

def get_turnstile_coords(sb):
    """获取 CF 盾的坐标，针对新版界面优化偏移量"""
    return sb.execute_script("""
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            var src = iframes[i].src || '';
            if (src.includes('cloudflare') || src.includes('turnstile')) {
                var rect = iframes[i].getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    var screenX = window.screenX || 0;
                    var screenY = window.screenY || 0;
                    // 点击左侧复选框位置
                    return {x: Math.round(rect.x + 25) + screenX, y: Math.round(rect.y + rect.height / 2) + screenY};
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

    print("🔧 启动浏览器 (UC 模式)...")
    opts = {
        "uc": True,
        "headless": False, 
        "locale": "fr", # 匹配截图中的法语界面
        "chromium_arg": "--disable-dev-shm-usage,--no-sandbox"
    }
    if PROXY:
        opts["proxy"] = PROXY

    with SB(**opts) as sb:
        sb.set_window_size(1280, 1024)
        
        try:
            print(f"🌐 访问目标网页: {TARGET_URL}")
            sb.uc_open_with_reconnect(TARGET_URL, reconnect_time=8)
            
            # 1. 检查是否已经登录
            if "projects" in sb.get_current_url():
                print("✅ 已经处于登录状态！")
            else:
                print("⏳ 等待登录页面加载...")
                # 增加更稳妥的元素等待逻辑
                user_sel = 'input[name="email"], input[type="email"]'
                sb.wait_for_element_visible(user_sel, timeout=20)
                
                print("✏️ 填写账号密码...")
                sb.update_text(user_sel, ACCOUNT)
                sb.update_text('input[type="password"]', PASSWORD)
                
                print("🛡️ 处理 Cloudflare 验证...")
                time.sleep(2)
                
                cf_passed = False
                for attempt in range(5):
                    # 检查验证是否已通过
                    is_done = sb.execute_script('var cf = document.querySelector("[name=\'cf-turnstile-response\']"); return cf && cf.value.length > 20;')
                    if is_done:
                        print("✅ CF 验证已通过！")
                        cf_passed = True
                        break
                    
                    print(f"🖱️ 尝试验证 (第 {attempt + 1} 次)...")
                    # 优先点击左侧小方框区域
                    coords = get_turnstile_coords(sb)
                    if coords:
                        # 使用 SB 的物理点击模拟
                        sb.click_with_offset('iframe[src*="cloudflare"]', 25, 0)
                    else:
                        sb.uc_gui_click_captcha()
                    
                    time.sleep(5)

                # 提交登录
                print("📤 提交登录按钮 (Se connecter)...")
                sb.click('button[type="submit"]')
                
                # 监控登录状态，处理 "Chargement..."
                print("⏳ 等待跳转至后台...")
                success = False
                for _ in range(10):
                    if "projects" in sb.get_current_url():
                        success = True
                        break
                    time.sleep(2)
                
                if not success:
                    print("⚠️ 尝试直接跳转至 Dashboard...")
                    sb.uc_open_with_reconnect(DASHBOARD_URL, reconnect_time=5)

            # 2. 续期逻辑适配
            print("🚀 查找续期按键...")
            sb.sleep(5)
            
            # 获取剩余时间
            expire_text = "未知"
            try:
                # 针对法文界面适配
                expire_el = sb.wait_for_element('//*[contains(text(), "Expire")]/..', timeout=5)
                expire_text = expire_el.text.replace('\n', ' ').strip()
                print(f"⏱️ 剩余时间: {expire_text}")
            except: pass

            # 检查提前续期限制
            too_early_fr = "//*[contains(text(), 'disponible 3 jours avant')]"
            if sb.is_element_visible(too_early_fr) or sb.is_element_visible("//div[contains(., '3 days')]"):
                print("⏰ 尚未到续期时间。")
                sb.save_screenshot("status.png")
                send_tg_photo(f"⏰ 暂无需续期。\n⏱️ 状态: {expire_text}", "status.png")
            else:
                # 尝试点击续期按钮
                renew_sel = 'button:contains("Renouveler"), button:contains("Renew")'
                if sb.is_element_visible(renew_sel):
                    sb.click(renew_sel)
                    print("🎉 已点击续期按钮！")
                    time.sleep(5)
                    sb.save_screenshot("success.png")
                    send_tg_photo(f"🎉 续期操作成功！\n⏱️ 最新状态: {expire_text}", "success.png")
                else:
                    print("❌ 未发现续期按钮")
                    sb.save_screenshot("not_found.png")
                    send_tg_photo("❌ 未能识别续期按钮，请检查截图。", "not_found.png")

        except Exception as e:
            print(f"❌ 运行报错: {e}")
            sb.save_screenshot("error.png")
            send_tg_photo(f"❌ 脚本运行异常: {str(e)[:100]}", "error.png")
            sys.exit(1)

if __name__ == "__main__":
    main()
