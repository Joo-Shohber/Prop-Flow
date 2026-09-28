import { Controller, Get } from '@nestjs/common';

import { Public } from './common/decorators/public.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipResponseTransform } from './common/decorators/skip-response.decorator.js';

@Controller()
@Public()
@SkipThrottle()
@SkipResponseTransform()
export class AppController {
  @Get('/')
  public getHome() {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta
            name="description"
            content="PropFlow is a property and rental management platform."
          />
          <title>PropFlow | Property Management Platform</title>

          <style>
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }

            body {
              font-family: Arial, sans-serif;
              background: #0f172a;
              color: #f8fafc;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }

            .container {
              width: 100%;
              max-width: 900px;
              text-align: center;
            }

            .badge {
              display: inline-block;
              padding: 8px 16px;
              margin-bottom: 24px;
              border: 1px solid #334155;
              border-radius: 999px;
              color: #94a3b8;
              font-size: 14px;
            }

            h1 {
              font-size: clamp(48px, 8vw, 82px);
              margin-bottom: 16px;
              letter-spacing: -3px;
            }

            .highlight {
              color: #38bdf8;
            }

            .subtitle {
              max-width: 680px;
              margin: 0 auto;
              color: #cbd5e1;
              font-size: 20px;
              line-height: 1.7;
            }

            .features {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 16px;
              margin-top: 48px;
            }

            .feature {
              padding: 24px;
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 16px;
            }

            .feature h3 {
              margin-bottom: 10px;
              font-size: 18px;
            }

            .feature p {
              color: #94a3b8;
              line-height: 1.6;
              font-size: 14px;
            }

            .footer {
              margin-top: 48px;
              color: #64748b;
              font-size: 14px;
            }

            @media (max-width: 700px) {
              .features {
                grid-template-columns: 1fr;
              }

              .subtitle {
                font-size: 17px;
              }
            }
          </style>
        </head>

        <body>
          <main class="container">
            <span class="badge">Property & Rental Management Platform</span>

            <h1>Prop<span class="highlight">Flow</span></h1>

            <p class="subtitle">
              A modern platform for managing properties, rental units,
              leases, maintenance requests, notifications, and analytics
              in one centralized system.
            </p>

            <section class="features">
              <article class="feature">
                <h3>🏢 Properties</h3>
                <p>
                  Manage properties and units with clear availability
                  and occupancy tracking.
                </p>
              </article>

              <article class="feature">
                <h3>📄 Leases</h3>
                <p>
                  Create, activate, track, and manage rental leases
                  throughout their lifecycle.
                </p>
              </article>

              <article class="feature">
                <h3>🔧 Maintenance</h3>
                <p>
                  Submit, assign, track, and resolve maintenance requests
                  from start to finish.
                </p>
              </article>
            </section>

            <p class="footer">
              PropFlow API · Built with NestJS, PostgreSQL & Redis
            </p>
          </main>
        </body>
      </html>
    `;
  }
}
