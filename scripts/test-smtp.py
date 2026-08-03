"""本地测试 SMTP 登录是否成功，密码不回显、不外传。
用法: python scripts/test-smtp.py
"""
import getpass
import smtplib
import ssl

host = input("SMTP host (默认 smtp.qiye.aliyun.com): ").strip() or "smtp.qiye.aliyun.com"
port = int(input("端口 (默认 465): ").strip() or "465")
username = input("完整邮箱地址 (如 support@你的域名): ").strip()
password = getpass.getpass("密码/授权码 (不会显示): ")

try:
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=ctx, timeout=15) as smtp:
        smtp.login(username, password)
        print("OK: 登录成功，SMTP 配置没问题。")
except smtplib.SMTPAuthenticationError as e:
    print(f"FAILED: 认证失败 ({e.smtp_code}) {e.smtp_error!r}")
    print("-> 大概率是密码/授权码不对，或者这个账号没开客户端收发信权限。")
except Exception as e:
    print(f"FAILED: {e!r}")
