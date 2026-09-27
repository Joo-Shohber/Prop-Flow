import { Controller, Get, Header } from '@nestjs/common';

const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PropFlow API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, 'Segoe UI', Tahoma, sans-serif;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 480px;
      backdrop-filter: blur(10px);
    }
    h1 {
      font-size: 28px;
      margin-bottom: 12px;
      color: #38bdf8;
    }
    p {
      color: #94a3b8;
      margin-bottom: 28px;
      line-height: 1.6;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(34,197,94,0.15);
      color: #4ade80;
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 14px;
      margin-bottom: 28px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    a.btn {
      display: inline-block;
      background: #38bdf8;
      color: #0f172a;
      text-decoration: none;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 10px;
      transition: transform 0.2s;
    }
    a.btn:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="card">
    <div class="status"><span class="dot"></span> النظام شغال</div>
    <h1>PropFlow API</h1>
    <p>نظام إدارة العقارات والإيجارات — الـ Backend شغال بنجاح.</p>
    <a class="btn" href="/api/docs">استعراض التوثيق (Swagger)</a>
  </div>
</body>
</html>`;

@Controller()
export class AppController {
  @Get('/')
  @Header('Content-Type', 'text/html; charset=utf-8')
  public getHome(): string {
    return LANDING_PAGE_HTML;
  }
}