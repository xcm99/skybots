print("🛡️ 开始处理 Cloudflare 验证框...")
                time.sleep(3)

                # 【增强 1】将 CF 盾强制滚动到页面中央，确保 xdotool 能点到物理屏幕内
                cf_iframe_sel = "iframe[src*='cloudflare'], iframe[src*='turnstile']"
                if sb.is_element_present(cf_iframe_sel):
                    sb.scroll_to(cf_iframe_sel)
                    time.sleep(1)
                    # 随便点一下页面空白处，激活窗口焦点
                    sb.click('body', timeout=2) 
                    time.sleep(1)

                sb.execute_script(EXPAND_POPUP_JS)
                time.sleep(1)

                # 尝试突破 CF 盾
                cf_passed = False
                for attempt in range(5): # 增加到 5 次尝试
                    # 校验 1：判断底层 token 是否已生成
                    is_done = sb.execute_script("var cf = document.querySelector(\"input[name='cf-turnstile-response']\"); return cf && cf.value.length > 20;")
                    if is_done:
                        print("✅ CF 盾底层验证已通过！")
                        cf_passed = True
                        break
                    
                    print(f"🖱️ 尝试验证 (第 {attempt + 1} 次)...")
                    try:
                        # 方案 A：使用 SeleniumBase 原生专杀工具
                        sb.uc_gui_click_captcha()
                        print("⏳ 触发原生点击过盾，等待反应 (4秒)...")
                        time.sleep(4)
                    except Exception as e:
                        print(f"⚠️ 原生点击抛出异常: {e}")

                    # 校验 2：原生方法点完后，再次检查是否通过
                    if sb.execute_script("var cf = document.querySelector(\"input[name='cf-turnstile-response']\"); return cf && cf.value.length > 20;"):
                        print("✅ 原生方法点击成功！")
                        cf_passed = True
                        break

                    # 方案 B：使用获取坐标的底层硬件点击
                    print("⚠️ 原生未通过，尝试 xdotool 物理点击...")
                    coords = get_turnstile_coords(sb)
                    if coords:
                        # 【增强 2】加入随机偏移，防止被识别为机械点击，并兼容微小的坐标误差
                        import random
                        click_x = coords['x'] + random.randint(-8, 8)
                        click_y = coords['y'] + random.randint(-4, 4)
                        
                        os_hardware_click(click_x, click_y)
                        print("⏳ 等待物理点击后的验证动画 (5秒)...")
                        time.sleep(5)
                    else:
                        print("⚠️ 仍未找到盾的位置坐标，等待重试...")
                        time.sleep(3)

                # 【增强 3】强校验拦截：如果 5 次都没过盾，先不要点登录，否则会被风控
                if not cf_passed:
                    print("❌ 警告：5 次尝试后 CF 盾仍未通过，登录极大概率会被拦截！")
                    sb.save_screenshot("cf_failed_state.png")
                    send_tg_photo("❌ 警告：CF 过盾失败，停止提交登录。", "cf_failed_state.png")
                    # 可根据需求选择继续往下走或者直接 return/sys.exit
                else:
                    print("📤 盾已通过，提交登录...")
                    sb.click('button[type="submit"], button:contains("Login"), button:contains("Se connecter")')
